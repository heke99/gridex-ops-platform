-- Website application ops chain hardening.
--
-- Keeps website_customer_applications as the canonical admin source, makes old
-- external intakes cheaper to correlate by idempotency key, and prevents legacy
-- customer rows from carrying contract/signature state in customers.status.

update public.customers
   set status = 'draft',
       updated_at = coalesce(updated_at, now())
 where status = 'pending_signature';

create index if not exists website_customer_applications_company_idempotency_chain_idx
  on public.website_customer_applications(company_id, idempotency_key, created_at desc)
  where idempotency_key is not null;

create index if not exists website_customer_applications_company_customer_chain_idx
  on public.website_customer_applications(company_id, customer_id, created_at desc)
  where customer_id is not null;

create index if not exists external_contract_intakes_company_idempotency_chain_idx
  on public.external_contract_intakes(company_id, idempotency_key, created_at desc)
  where idempotency_key is not null;

create index if not exists external_contract_intakes_company_created_customer_chain_idx
  on public.external_contract_intakes(company_id, created_customer_id, created_at desc)
  where created_customer_id is not null;

create index if not exists customer_info_requests_company_customer_created_chain_idx
  on public.customer_info_requests(company_id, customer_id, created_at desc)
  where customer_id is not null;

create index if not exists customer_operation_tasks_company_customer_created_chain_idx
  on public.customer_operation_tasks(company_id, customer_id, created_at desc)
  where customer_id is not null;

comment on table public.website_customer_applications is
  'Canonical source for website signups in OPS admin. External contract intakes may be shown as mirrors/fallbacks but must not hide this row.';

comment on table public.external_contract_intakes is
  'Legacy/external intake source. Admin must treat rows with matching idempotency_key as secondary mirror data to website_customer_applications.';

do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception when others then
  null;
end $$;
