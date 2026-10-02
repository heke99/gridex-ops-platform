-- Billing-underlay file import as one transaction.
--
-- Before: the admin import action inserted the batch, then each underlay and
-- each import-row log entry as separate calls (row-log errors were ignored),
-- and finally updated the batch by id alone. An interruption left committed
-- underlays under a batch still marked 'previewed', and importing the same file
-- twice created duplicate underlays.
-- After: gridex_import_billing_underlays_v1 writes the batch, every underlay and
-- every row log in one transaction. A row that the database rejects is recorded
-- as failed (savepoint per row) without aborting the others. The same file
-- content can only be imported once per tenant.

create or replace function public.gridex_import_billing_underlays_v1(
  p_company_id uuid,
  p_actor_user_id uuid,
  p_batch jsonb,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_content_sha text := nullif(p_batch->>'content_sha256', '');
  v_batch_id uuid;
  v_existing record;
  v_row jsonb;
  v_underlay jsonb;
  v_underlay_id uuid;
  v_columns text;
  v_status text;
  v_issues jsonb;
  v_imported integer := 0;
  v_failed integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'billing_import_service_role_required';
  end if;
  if p_company_id is null or p_actor_user_id is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception using errcode = '22023', message = 'billing_import_payload_invalid';
  end if;

  if v_content_sha is not null then
    perform pg_advisory_xact_lock(hashtextextended('billing_import:' || p_company_id::text || ':' || v_content_sha, 0));
    select id, rows_imported, rows_failed into v_existing
    from public.billing_import_batches
    where company_id = p_company_id
      and metadata->>'content_sha256' = v_content_sha
      and status in ('imported', 'partially_imported')
    order by created_at desc
    limit 1;
    if found then
      return jsonb_build_object('batch_id', v_existing.id, 'duplicate', true,
        'imported', v_existing.rows_imported, 'failed', v_existing.rows_failed);
    end if;
  end if;

  insert into public.billing_import_batches (
    company_id, file_name, source_type, status, rows_total, issues, metadata, created_by
  ) values (
    p_company_id,
    nullif(p_batch->>'file_name', ''),
    coalesce(nullif(p_batch->>'source_type', ''), 'manual_paste'),
    'previewed',
    jsonb_array_length(p_rows),
    coalesce(p_batch->'issues', '[]'::jsonb),
    coalesce(p_batch->'metadata', '{}'::jsonb) || jsonb_build_object('content_sha256', v_content_sha),
    p_actor_user_id
  )
  returning id into v_batch_id;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_underlay_id := null;
    v_issues := coalesce(v_row->'issues', '[]'::jsonb);
    v_status := case when coalesce((v_row->>'has_errors')::boolean, false) then 'failed' else 'imported' end;
    v_underlay := v_row->'underlay';

    if v_status = 'imported' and v_underlay is not null and jsonb_typeof(v_underlay) = 'object' then
      v_underlay := (v_underlay - array['id', 'company_id', 'created_by', 'updated_by'])
        || jsonb_build_object(
          'company_id', p_company_id,
          'created_by', p_actor_user_id,
          'updated_by', p_actor_user_id,
          'payload', coalesce(v_underlay->'payload', '{}'::jsonb) || jsonb_build_object('importBatchId', v_batch_id)
        );
      select string_agg(quote_ident(key), ', ' order by key) into v_columns
      from jsonb_object_keys(v_underlay) as key
      where key in (
        select attname from pg_attribute
        where attrelid = 'public.billing_underlays'::regclass and attnum > 0 and not attisdropped
      );
      begin
        execute format(
          'insert into public.billing_underlays (%1$s) select %1$s from jsonb_populate_record(null::public.billing_underlays, $1) returning id',
          v_columns
        ) into v_underlay_id using v_underlay;
      exception when others then
        v_status := 'failed';
        v_issues := v_issues || jsonb_build_array(jsonb_build_object(
          'code', 'db_insert_failed',
          'severity', 'error',
          'title', 'Raden kunde inte importeras',
          'description', sqlerrm
        ));
      end;
    elsif v_status = 'imported' then
      -- Nothing to import (no customer): never count it as imported.
      v_status := 'failed';
      v_issues := v_issues || jsonb_build_array(jsonb_build_object(
        'code', 'customer_missing',
        'severity', 'error',
        'title', 'Kund saknas',
        'description', 'Raden saknar kund och importerades inte.'
      ));
    end if;

    if v_status = 'imported' then v_imported := v_imported + 1; else v_failed := v_failed + 1; end if;

    insert into public.billing_import_rows (
      import_batch_id, company_id, row_number, status, billing_underlay_id, normalized_payload, issues
    ) values (
      v_batch_id,
      p_company_id,
      nullif(v_row->>'row_number', '')::integer,
      v_status,
      v_underlay_id,
      coalesce(v_row->'normalized_payload', '{}'::jsonb),
      v_issues
    );
  end loop;

  update public.billing_import_batches
  set status = case
        when v_failed > 0 and v_imported > 0 then 'partially_imported'
        when v_failed > 0 then 'failed'
        else 'imported' end,
      rows_imported = v_imported,
      rows_failed = v_failed,
      imported_at = now()
  where id = v_batch_id and company_id = p_company_id;

  return jsonb_build_object('batch_id', v_batch_id, 'duplicate', false, 'imported', v_imported, 'failed', v_failed);
end
$function$;

revoke all on function public.gridex_import_billing_underlays_v1(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.gridex_import_billing_underlays_v1(uuid, uuid, jsonb, jsonb) to service_role;
