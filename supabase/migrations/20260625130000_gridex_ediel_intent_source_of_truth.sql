-- Ediel intent source-of-truth hardening.
--
-- Additive, idempotent and RLS-safe. No DROP of business tables, no destructive
-- DELETE, no data rewrites. Adds:
--   * performance indexes matching the real query shapes used by the dispatch
--     state resolver, the stuck-intent resume sweep, facility-lookup dispatch and
--     the legacy outbound diagnostic lookup (PART 14);
--   * an optional facility_verification_status column on
--     grid_owner_information_requests so an inbound Z02 can record verification
--     state without overloading the generic status column (PART 8).
--
-- Every statement is guarded so re-running is safe and a partial schema never
-- aborts the migration.

-- ---------------------------------------------------------------------------
-- 1) facility_verification_status on grid_owner_information_requests (additive)
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.grid_owner_information_requests') is not null then
    alter table public.grid_owner_information_requests
      add column if not exists facility_verification_status text;
  end if;
end $$;

comment on column public.grid_owner_information_requests.facility_verification_status is
  'Verification outcome of the facility lookup response (e.g. verified / needs_review). Set when an inbound PRODAT Z02 is applied. Nullable + additive.';

-- ---------------------------------------------------------------------------
-- 2) Composite indexes for the intent -> outbox -> message resolver / sweeps
-- ---------------------------------------------------------------------------
do $$
begin
  -- Resume sweep: validated + not_rendered/failed + not_queued, per company.
  if to_regclass('public.ediel_message_intents') is not null then
    create index if not exists ediel_message_intents_lifecycle_idx
      on public.ediel_message_intents (company_id, validation_status, render_status, outbox_status);

    -- Dispatch-state resolver "by customer" path.
    create index if not exists ediel_message_intents_customer_process_idx
      on public.ediel_message_intents (company_id, customer_id, business_process)
      where customer_id is not null;
  end if;

  -- Outbox worker + resolver lookups by company/status and by intent/message.
  if to_regclass('public.ediel_outbox') is not null then
    create index if not exists ediel_outbox_company_status_idx
      on public.ediel_outbox (company_id, status);

    create index if not exists ediel_outbox_company_intent_idx
      on public.ediel_outbox (company_id, intent_id)
      where intent_id is not null;

    create index if not exists ediel_outbox_company_message_idx
      on public.ediel_outbox (company_id, ediel_message_id)
      where ediel_message_id is not null;
  end if;

  -- Resolver joins intent.ediel_message_id -> message status, scoped by company.
  if to_regclass('public.ediel_messages') is not null then
    create index if not exists ediel_messages_company_intent_idx
      on public.ediel_messages (company_id, intent_id)
      where intent_id is not null;
  end if;

  -- Facility-lookup dispatch sweep + resolver completion lookup.
  if to_regclass('public.grid_owner_information_requests') is not null then
    create index if not exists grid_owner_information_requests_type_status_idx
      on public.grid_owner_information_requests (company_id, request_type, status);

    create index if not exists grid_owner_information_requests_message_idx
      on public.grid_owner_information_requests (company_id, ediel_message_id)
      where ediel_message_id is not null;
  end if;

  -- Legacy outbound diagnostic lookup by source + reuse detection.
  if to_regclass('public.outbound_requests') is not null then
    create index if not exists outbound_requests_company_source_idx
      on public.outbound_requests (company_id, source_type, source_id);
  end if;
end $$;
