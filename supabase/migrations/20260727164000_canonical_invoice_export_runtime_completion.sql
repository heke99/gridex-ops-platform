-- Make the canonical invoice graph the only runtime entry point.
-- The legacy billing-export rows remain a compatibility read/send projection,
-- but both graphs are now reserved by one database transaction.

begin;

alter table public.invoice_export_runs
  add column if not exists payload_hash text;
alter table public.billing_export_runs
  add column if not exists payload_hash text;

alter function public.gridex_create_invoice_export_graph_v1(
  jsonb, jsonb, jsonb
) rename to gridex_create_invoice_export_graph_v1_core;

create or replace function public.gridex_create_invoice_export_graph_v1(
  p_run jsonb,
  p_items jsonb,
  p_invoices jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog, pg_temp
as $$
declare
  v_company_id uuid := nullif(p_run->>'company_id', '')::uuid;
  v_idempotency_key text := nullif(p_run->>'idempotency_key', '');
  v_core_run jsonb := p_run - array['legacy_run', 'legacy_items'];
  v_logical_items jsonb;
  v_logical_invoices jsonb;
  v_payload_hash text;
  v_existing_run_id uuid;
  v_existing_payload_hash text;
  v_legacy_existing_id uuid;
  v_core_result jsonb;
  v_legacy_result jsonb;
  v_event_id uuid;
  v_item jsonb;
  v_invoice jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'invoice_export_graph_service_role_required';
  end if;
  if v_company_id is null or v_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'invoice_export_company_idempotency_required';
  end if;
  if jsonb_typeof(coalesce(p_run->'legacy_run', 'null'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_run->'legacy_items', 'null'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_items, 'null'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_invoices, 'null'::jsonb)) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'invoice_export_graph_payload_invalid';
  end if;
  if jsonb_array_length(p_items) <> jsonb_array_length(p_invoices) then
    raise exception using
      errcode = '22023',
      message = 'invoice_export_graph_array_mismatch';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item->'total_kwh') <> 'number'
       or jsonb_typeof(v_item->'amount_ex_vat') <> 'number'
       or jsonb_typeof(v_item->'vat_amount') <> 'number'
       or jsonb_typeof(v_item->'amount_inc_vat') <> 'number'
       or nullif(v_item->>'currency', '') is null then
      raise exception using
        errcode = '22023',
        message = 'invoice_export_item_financial_values_required';
    end if;
  end loop;
  for v_invoice in select value from jsonb_array_elements(p_invoices)
  loop
    if jsonb_typeof(v_invoice->'total_kwh') <> 'number'
       or jsonb_typeof(v_invoice->'amount_ex_vat') <> 'number'
       or jsonb_typeof(v_invoice->'vat_amount') <> 'number'
       or jsonb_typeof(v_invoice->'amount_inc_vat') <> 'number'
       or nullif(v_invoice->>'currency', '') is null then
      raise exception using
        errcode = '22023',
        message = 'customer_invoice_financial_values_required';
    end if;
  end loop;

  select coalesce(
    jsonb_agg(
      value - array['id', 'metadata', 'idempotency_key']
      order by value->>'billing_underlay_id'
    ),
    '[]'::jsonb
  )
  into v_logical_items
  from jsonb_array_elements(p_items);

  select coalesce(
    jsonb_agg(
      value - array['invoice_export_item_id', 'metadata']
      order by value->>'customer_id', value->>'period_start'
    ),
    '[]'::jsonb
  )
  into v_logical_invoices
  from jsonb_array_elements(p_invoices);

  v_payload_hash := encode(
    digest(
      jsonb_build_object(
        'run',
          v_core_run - array[
            'id',
            'requested_by',
            'idempotency_key',
            'payload_hash'
          ],
        'items', v_logical_items,
        'invoices', v_logical_invoices
      )::text,
      'sha256'
    ),
    'hex'
  );

  perform pg_advisory_xact_lock(
    hashtextextended(v_company_id::text || ':' || v_idempotency_key, 0)
  );

  select run.id, run.payload_hash
  into v_existing_run_id, v_existing_payload_hash
  from public.invoice_export_runs run
  where run.company_id = v_company_id
    and run.idempotency_key = v_idempotency_key
  for update;

  if v_existing_run_id is not null
     and v_existing_payload_hash is not null
     and v_existing_payload_hash <> v_payload_hash then
    raise exception using
      errcode = '23505',
      message = 'invoice_export_idempotency_payload_mismatch';
  end if;

  -- If a compatibility run predates the canonical graph, preserve its durable
  -- identity when creating the canonical side.
  select run.id
  into v_legacy_existing_id
  from public.billing_export_runs run
  where run.company_id = v_company_id
    and run.idempotency_key = v_idempotency_key
  for update;
  if v_existing_run_id is null and v_legacy_existing_id is not null then
    v_core_run := jsonb_set(
      v_core_run,
      '{id}',
      to_jsonb(v_legacy_existing_id::text),
      true
    );
  end if;

  v_core_result :=
    public.gridex_create_invoice_export_graph_v1_core(
      v_core_run,
      p_items,
      p_invoices
    );
  v_existing_run_id := nullif(v_core_result->>'run_id', '')::uuid;
  if v_existing_run_id is null then
    raise exception using
      errcode = '23502',
      message = 'invoice_export_graph_result_missing_run_id';
  end if;

  update public.invoice_export_runs
  set payload_hash = coalesce(payload_hash, v_payload_hash),
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object(
          'payload_hash', v_payload_hash,
          'canonical_runtime', 'gridex_create_invoice_export_graph_v1'
        )
  where id = v_existing_run_id
    and company_id = v_company_id;

  v_legacy_result := public.gridex_create_billing_export_run(
    jsonb_set(
      p_run->'legacy_run',
      '{id}',
      to_jsonb(v_existing_run_id::text),
      true
    ) || jsonb_build_object(
      'idempotency_key', v_idempotency_key,
      'payload_hash', v_payload_hash
    ),
    p_run->'legacy_items'
  );
  if nullif(v_legacy_result->>'id', '')::uuid
       is distinct from v_existing_run_id then
    raise exception using
      errcode = '23514',
      message = 'invoice_export_compatibility_run_identity_mismatch';
  end if;
  update public.billing_export_runs
  set payload_hash = coalesce(payload_hash, v_payload_hash),
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object(
          'canonical_invoice_export_run_id', v_existing_run_id,
          'payload_hash', v_payload_hash
        )
  where id = v_existing_run_id
    and company_id = v_company_id;
  select to_jsonb(run)
  into v_legacy_result
  from public.billing_export_runs run
  where run.id = v_existing_run_id
    and run.company_id = v_company_id;

  if not coalesce((v_core_result->>'existing')::boolean, false) then
    insert into public.domain_events(
      company_id,
      event_type,
      aggregate_type,
      aggregate_id,
      actor_user_id,
      source,
      idempotency_key,
      payload
    ) values (
      v_company_id,
      'invoice.export_graph.created',
      'invoice_export_run',
      v_existing_run_id,
      nullif(p_run->>'requested_by', '')::uuid,
      'gridex_create_invoice_export_graph_v1',
      'invoice-export-created:' || v_existing_run_id::text,
      jsonb_build_object(
        'invoice_export_run_id', v_existing_run_id,
        'item_count', jsonb_array_length(p_items),
        'payload_hash', v_payload_hash
      )
    ) returning id into v_event_id;

    insert into public.event_outbox(
      company_id,
      domain_event_id,
      destination_type,
      destination_key,
      payload
    ) values (
      v_company_id,
      v_event_id,
      'webhook',
      'invoice.export_graph.created',
      jsonb_build_object(
        'domain_event_id', v_event_id,
        'event_type', 'invoice.export_graph.created',
        'invoice_export_run_id', v_existing_run_id
      )
    ) on conflict do nothing;
  end if;

  return v_core_result || jsonb_build_object(
    'payload_hash', v_payload_hash,
    'legacy_run', v_legacy_result
  );
end
$$;

revoke all on function public.gridex_create_invoice_export_graph_v1(
  jsonb, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.gridex_create_invoice_export_graph_v1(
  jsonb, jsonb, jsonb
) to service_role;

comment on function public.gridex_create_invoice_export_graph_v1(
  jsonb, jsonb, jsonb
) is
  'Canonical atomic invoice-export entry point. Reserves canonical export items, invoice mirrors, legacy send projections, domain event and outbox with payload-safe idempotency.';

commit;
