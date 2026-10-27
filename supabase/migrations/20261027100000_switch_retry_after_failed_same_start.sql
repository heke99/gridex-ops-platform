-- FINDINGS I-B8 (reality scenario I, batch 5c, I9): the tenant's "Försök igen" on a switch the grid owner rejected
-- (owner decision 32: the agreed start date is never moved automatically) creates a new switch request for the same
-- metering point and start. The legacy dedupe index ux_switch_company_meter_start_contract
-- (02_db1_operations_ediel_billing_dedupe_and_storage.sql) covered every status, so the failed request blocked it
-- forever: every retry job failed with 23505 on (company_id, metering_point_id, requested_start_date, contract).
--
-- Change: the index no longer covers a request that ended without effect (failed, rejected, cancelled,
-- cancelled_before_start). Two live requests for the same metering point, start and contract stay refused here, and
-- two open requests per site stay refused by supplier_switch_requests_open_site_uidx. Same name, same key columns.
begin;

do $ib8$
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'supplier_switch_requests'
                 and indexname = 'ux_switch_company_meter_start_contract'
                 and indexdef not ilike '%status%') then
    raise exception 'ib8_switch_start_index_predecessor_required' using errcode = 'P0U01';
  end if;
end
$ib8$;

drop index public.ux_switch_company_meter_start_contract;
create unique index ux_switch_company_meter_start_contract
  on public.supplier_switch_requests (company_id, metering_point_id, requested_start_date, coalesce((metadata ->> 'customer_contract_id'), ''))
  where metering_point_id is not null and requested_start_date is not null
    and status not in ('failed', 'rejected', 'cancelled', 'cancelled_before_start');

commit;
