-- Tenant-isolation invariants (F-6, F-8) for the F27 confirmation continuation:
-- classify the table as tenant data and scope its unique key by company_id.

insert into public.platform_table_classification (table_name, kind, rationale, classified_by)
values (
  'customer_contract_confirmation_deliveries',
  'tenant',
  'Per-company durable continuation for the signed-contract confirmation mail; service-role only.',
  'migration'
)
on conflict (table_name) do update
  set kind = excluded.kind, rationale = excluded.rationale;

alter table public.customer_contract_confirmation_deliveries
  drop constraint if exists customer_contract_confirmation_deliveries_request_key;
alter table public.customer_contract_confirmation_deliveries
  add constraint customer_contract_confirmation_deliveries_company_request_key
  unique (company_id, signature_request_id);

create or replace function public.gridex_enqueue_contract_confirmation_delivery()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  insert into public.customer_contract_confirmation_deliveries(
    company_id, customer_contract_id, signature_request_id
  ) values (
    new.company_id, new.customer_contract_id, new.id
  )
  on conflict (company_id, signature_request_id) do nothing;
  return new;
end;
$$;
