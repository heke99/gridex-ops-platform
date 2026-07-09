-- Supplier switch automation idempotency: unique automation_key per company.
--
-- Migration notes
--   Context: website customer application intake now creates
--   supplier_switch_requests automatically (automation_origin =
--   'website_customer_application', automation_key =
--   'website_application_<application_id>_supplier_switch'). Retries recover
--   duplicates through getSupplierSwitchRequestByAutomationKey, so at most ONE
--   OPEN row may exist per automation_key. The index is restricted to open
--   statuses (same set as supplier_switch_requests_open_site_uidx) so that a
--   legitimately completed/cancelled switch never blocks a later re-switch
--   that reuses a static automation key (e.g. customer-operation:* keys).
--   Indexes added (guarded, partial-unique; if live duplicates exist the index
--   is skipped with a NOTICE and must be cleaned up manually before
--   re-running):
--     - supplier_switch_requests_open_automation_key_uidx: max one OPEN switch
--       request per company + automation_key (automation_key IS NOT NULL)
--   Backfill behavior: none (index only).
--   Rollback: drop index supplier_switch_requests_open_automation_key_uidx.

set lock_timeout = '5s';
set statement_timeout = '120s';

do $$
declare
  duplicate_count integer;
begin
  if to_regclass('public.supplier_switch_requests') is null then
    return;
  end if;

  select count(*) into duplicate_count
  from (
    select company_id, automation_key
    from public.supplier_switch_requests
    where automation_key is not null
      and company_id is not null
      and status in (
        'draft','queued','submitted','accepted','cancellation_requested',
        'cancellation_sent','manual_followup_required',
        'pending','ready','prepared','in_progress','sent',
        'waiting_response','awaiting_confirmation','confirmed'
      )
    group by company_id, automation_key
    having count(*) > 1
  ) duplicates;

  if duplicate_count > 0 then
    raise notice 'gridex: skipped supplier_switch_requests_open_automation_key_uidx — % automation key(s) already have multiple open switch requests. Resolve duplicates manually (cancel/complete the stale requests), then re-run: create unique index supplier_switch_requests_open_automation_key_uidx on public.supplier_switch_requests (company_id, automation_key) where automation_key is not null and company_id is not null and status in (...);', duplicate_count;
  else
    create unique index if not exists supplier_switch_requests_open_automation_key_uidx
      on public.supplier_switch_requests (company_id, automation_key)
      where automation_key is not null
        and company_id is not null
        and status in (
          'draft','queued','submitted','accepted','cancellation_requested',
          'cancellation_sent','manual_followup_required',
          'pending','ready','prepared','in_progress','sent',
          'waiting_response','awaiting_confirmation','confirmed'
        );
  end if;
end $$;
