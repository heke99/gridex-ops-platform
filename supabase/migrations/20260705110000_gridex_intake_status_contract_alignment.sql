-- Align DB CHECK constraints with the values production code actually writes
-- (Workstream B of the flow consolidation audit).
--
--  1) customers.intake_status: the compact intake enum from
--     20260610171000_customer_application_status_hardening.sql did not include
--     the customer intake orchestrator states
--     (lib/customer-operations/customerIntakeOrchestrator.ts) or the facility
--     lookup automation states (lib/customer-operations/facilityLookupAutomation.ts).
--     Those writers silently failed against the CHECK, leaving intake_status
--     frozen at its creation value. The constraint is recreated with the full
--     union so the orchestrator lifecycle persists.
--  2) external_contract_intakes.status: the replay path in
--     lib/external-contracts/intake.ts writes 'processing' and recognizes
--     'partially_created', neither of which the original CHECK allowed —
--     every teckna-avtal replay failed at the DB layer.
--
-- CHECK changes follow the repo convention: drop-and-recreate with the full
-- value set, preceded by a normalizing backfill so the new constraint always
-- validates. Forward-only and production-safe.

-- ---------------------------------------------------------------------------
-- 1) customers.intake_status
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.customers') is null then
    return;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'customers' and column_name = 'intake_status'
  ) then
    return;
  end if;

  -- Normalize any legacy values outside the union before tightening.
  update public.customers
  set intake_status = 'needs_completion'
  where intake_status is not null
    and intake_status not in (
      -- compact intake enum
      'draft', 'incomplete', 'needs_completion', 'pending_information',
      'pending_power_of_attorney', 'pending_duplicate_review', 'blocked',
      'rejected', 'ready_for_contract', 'ready_for_operations',
      -- customer intake orchestrator lifecycle
      'application_received', 'needs_contract_or_poa', 'needs_grid_owner_resolution',
      'needs_facility_lookup', 'facility_lookup_ready_to_send',
      'facility_lookup_waiting_response', 'ready_for_supplier_switch',
      'supplier_switch_waiting_response', 'active_supply', 'needs_admin_review'
    );

  alter table public.customers drop constraint if exists customers_intake_status_check;
  alter table public.customers
    add constraint customers_intake_status_check
    check (
      intake_status is null or intake_status in (
        'draft',
        'incomplete',
        'needs_completion',
        'pending_information',
        'pending_power_of_attorney',
        'pending_duplicate_review',
        'blocked',
        'rejected',
        'ready_for_contract',
        'ready_for_operations',
        'application_received',
        'needs_contract_or_poa',
        'needs_grid_owner_resolution',
        'needs_facility_lookup',
        'facility_lookup_ready_to_send',
        'facility_lookup_waiting_response',
        'ready_for_supplier_switch',
        'supplier_switch_waiting_response',
        'active_supply',
        'needs_admin_review'
      )
    );
end $$;

-- ---------------------------------------------------------------------------
-- 2) external_contract_intakes.status
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.external_contract_intakes') is null then
    return;
  end if;

  update public.external_contract_intakes
  set status = 'needs_review'
  where status is not null
    and status not in (
      'received', 'processing', 'created', 'partially_created',
      'needs_review', 'duplicate', 'failed', 'cancelled'
    );

  alter table public.external_contract_intakes drop constraint if exists external_contract_intakes_status_check;
  alter table public.external_contract_intakes
    add constraint external_contract_intakes_status_check
    check (status in (
      'received',
      'processing',
      'created',
      'partially_created',
      'needs_review',
      'duplicate',
      'failed',
      'cancelled'
    ));
end $$;
