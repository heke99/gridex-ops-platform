-- Pipeline hardening guards (production-readiness mismatch audit):
--  1. manual_email_outbox idempotency scoped per tenant.
--  2. ediel_message_intents idempotency keys always present (NULLs allowed
--     duplicate intents because unique indexes treat NULLs as distinct).
--  3. manual_inbound_messages provider_message_id unique (DB-level double
--     ingestion guard; skipped with a NOTICE if historical duplicates exist).
--  4. gridex_validate_outbound_payload trigger: a customer_masterdata outbound
--     can never be INSERTed/UPDATEd into an active queued/prepared state when
--     both metering_point_id and payload facility identity are missing. The
--     row is demoted to 'failed' with explicit blocking reasons instead of the
--     silent split-brain state observed in production.
-- Additive and forward-only. No RLS/audit/security triggers are weakened.

-- 1) manual_email_outbox: tenant-scoped idempotency.
do $$
begin
  if to_regclass('public.manual_email_outbox') is not null then
    if exists (
      select 1 from pg_indexes
      where schemaname = 'public' and indexname = 'manual_email_outbox_idempotency_uidx'
    ) then
      drop index if exists public.manual_email_outbox_idempotency_uidx;
    end if;
    if not exists (
      select 1 from pg_indexes
      where schemaname = 'public' and indexname = 'manual_email_outbox_company_idempotency_uidx'
    ) then
      begin
        create unique index manual_email_outbox_company_idempotency_uidx
          on public.manual_email_outbox (company_id, idempotency_key);
      exception when unique_violation then
        raise notice 'manual_email_outbox_company_idempotency_uidx skipped: duplicate (company_id, idempotency_key) rows exist and must be reviewed manually.';
      end;
    end if;
  end if;
end $$;

-- 2) ediel_message_intents: idempotency_key must always exist.
do $$
begin
  if to_regclass('public.ediel_message_intents') is not null then
    update public.ediel_message_intents
      set idempotency_key = 'legacy:' || id::text
      where idempotency_key is null;
    begin
      alter table public.ediel_message_intents
        alter column idempotency_key set not null;
    exception when others then
      raise notice 'ediel_message_intents.idempotency_key NOT NULL skipped: %', sqlerrm;
    end;
  end if;
end $$;

-- 3) manual_inbound_messages: provider message id unique when present.
do $$
begin
  if to_regclass('public.manual_inbound_messages') is not null then
    if not exists (
      select 1 from pg_indexes
      where schemaname = 'public' and indexname = 'manual_inbound_messages_provider_message_uidx'
    ) then
      begin
        create unique index manual_inbound_messages_provider_message_uidx
          on public.manual_inbound_messages (provider_message_id)
          where provider_message_id is not null;
      exception when unique_violation then
        raise notice 'manual_inbound_messages_provider_message_uidx skipped: duplicate provider_message_id rows exist and must be reviewed manually.';
      end;
    end if;
  end if;
end $$;

-- 4) DB-level Z01/customer_masterdata facility guard.
create or replace function public.gridex_validate_outbound_payload()
returns trigger
language plpgsql
as $$
declare
  v_facility text;
begin
  -- Only guard the customer_masterdata (PRODAT Z01) business process in
  -- active pre-send states. Other processes and terminal states pass through.
  if coalesce(new.business_process, '') <> 'customer_masterdata'
     and coalesce(new.request_type, '') not in ('customer_masterdata', 'customer_masterdata_request') then
    return new;
  end if;
  if coalesce(new.status, '') not in ('queued', 'prepared', 'ready') then
    return new;
  end if;
  if new.metering_point_id is not null then
    return new;
  end if;

  v_facility := coalesce(
    new.payload #>> '{site,facility_id}',
    new.payload #>> '{site,normalized_facility_id}',
    new.payload #>> '{metering_point,meter_point_id}',
    new.payload #>> '{metering_point,ediel_reference}',
    new.payload #>> '{metering_point,site_facility_id}',
    new.payload ->> 'facility_id'
  );
  if v_facility is not null and length(trim(v_facility)) > 0 then
    return new;
  end if;

  -- Demote instead of raising: the row is preserved for audit but can never
  -- claim an active queued/prepared state without facility identity.
  new.status := 'failed';
  new.failed_at := coalesce(new.failed_at, now());
  new.failure_reason := coalesce(
    nullif(new.failure_reason, ''),
    'Blockerad av gridex_validate_outbound_payload: anläggnings-ID/mätpunkts-ID saknas för customer_masterdata.'
  );
  new.blocking_reasons := coalesce(new.blocking_reasons, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'code', 'facility_or_metering_point_missing',
      'message', 'Anläggnings-ID/mätpunkts-ID saknas. Databas-guarden blockerade aktiv status.',
      'source', 'gridex_validate_outbound_payload'
    )
  );
  new.required_admin_actions := (
    select coalesce(jsonb_agg(distinct value), '[]'::jsonb)
    from jsonb_array_elements_text(
      coalesce(new.required_admin_actions, '[]'::jsonb) || '["request_facility_information"]'::jsonb
    ) as value
  );
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.outbound_requests') is not null then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'outbound_requests'
        and column_name in ('business_process', 'blocking_reasons', 'required_admin_actions')
      group by table_name having count(*) = 3
    ) then
      drop trigger if exists gridex_validate_outbound_payload_trigger on public.outbound_requests;
      create trigger gridex_validate_outbound_payload_trigger
        before insert or update of status, metering_point_id, payload
        on public.outbound_requests
        for each row
        execute function public.gridex_validate_outbound_payload();
    else
      raise notice 'gridex_validate_outbound_payload trigger skipped: outbound_requests is missing business_process/blocking_reasons/required_admin_actions columns.';
    end if;
  end if;
end $$;
