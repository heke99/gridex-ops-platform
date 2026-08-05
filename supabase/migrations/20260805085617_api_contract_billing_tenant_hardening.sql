begin;

-- ---------------------------------------------------------------------------
-- 1. Public RPC privilege repair.
-- Legal-requirement resolution is internal authenticated/service-role logic.
-- SECURITY DEFINER must never remain executable by PUBLIC/anon.
-- ---------------------------------------------------------------------------
revoke execute on function public.gridex_required_legal_modules(text,text,text,boolean,boolean) from public, anon;
revoke execute on function public.gridex_required_legal_modules(text,text,text,boolean,boolean,boolean) from public, anon;
grant execute on function public.gridex_required_legal_modules(text,text,text,boolean,boolean) to authenticated, service_role;
grant execute on function public.gridex_required_legal_modules(text,text,text,boolean,boolean,boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Repair nullable tenant identities from authoritative parents.
-- The updates are deterministic and the following preflight raises instead of
-- silently choosing a tenant when the graph is inconsistent.
-- ---------------------------------------------------------------------------
update public.customer_contracts contract
set company_id = customer.company_id
from public.customers customer
where contract.company_id is null
  and customer.id = contract.customer_id;

update public.billing_underlays underlay
set company_id = contract.company_id
from public.customer_contracts contract
where underlay.company_id is null
  and contract.id = underlay.customer_contract_id;

update public.billing_underlays underlay
set company_id = customer.company_id
from public.customers customer
where underlay.company_id is null
  and customer.id = underlay.customer_id;

update public.customer_invoices invoice
set company_id = contract.company_id
from public.customer_contracts contract
where invoice.company_id is null
  and contract.id = coalesce(invoice.customer_contract_id, invoice.contract_id);

update public.customer_invoices invoice
set company_id = customer.company_id
from public.customers customer
where invoice.company_id is null
  and customer.id = invoice.customer_id;

update public.customer_invoice_lines line
set company_id = invoice.company_id
from public.customer_invoices invoice
where line.company_id is null
  and invoice.id = line.invoice_id;

update public.customer_invoice_lines
set vat_amount = round(amount_ex_vat * vat_rate, 2)
where vat_amount is null
  and amount_ex_vat is not null
  and vat_rate is not null;

update public.customer_invoice_lines
set amount_inc_vat = round(amount_ex_vat + vat_amount, 2)
where amount_inc_vat is null
  and amount_ex_vat is not null
  and vat_amount is not null;

do $$
begin
  if exists (select 1 from public.customer_contracts where company_id is null) then
    raise exception using errcode='23514', message='customer_contract_company_backfill_incomplete';
  end if;
  if exists (select 1 from public.billing_underlays where company_id is null) then
    raise exception using errcode='23514', message='billing_underlay_company_backfill_incomplete';
  end if;
  if exists (select 1 from public.customer_invoices where company_id is null) then
    raise exception using errcode='23514', message='customer_invoice_company_backfill_incomplete';
  end if;
  if exists (select 1 from public.customer_invoice_lines where company_id is null) then
    raise exception using errcode='23514', message='customer_invoice_line_company_backfill_incomplete';
  end if;
  if exists (
    select 1
    from public.customer_invoice_lines line
    join public.customer_invoices invoice on invoice.id=line.invoice_id
    where line.company_id is distinct from invoice.company_id
  ) then
    raise exception using errcode='23514', message='customer_invoice_line_tenant_mismatch';
  end if;
  if exists (
    select 1
    from public.billing_underlay_items item
    join public.billing_underlays underlay on underlay.id=item.billing_underlay_id
    where item.company_id is distinct from underlay.company_id
  ) then
    raise exception using errcode='23514', message='billing_underlay_item_tenant_mismatch';
  end if;
  if exists (
    select 1
    from public.contract_charge_ledger charge
    join public.customer_contracts contract on contract.id=charge.customer_contract_id
    where charge.company_id is distinct from contract.company_id
  ) then
    raise exception using errcode='23514', message='contract_charge_tenant_mismatch';
  end if;
  if exists (
    select 1
    from public.contract_price_snapshots snapshot
    join public.customer_contracts contract on contract.id=snapshot.contract_id
    where snapshot.company_id is distinct from contract.company_id
  ) then
    raise exception using errcode='23514', message='contract_price_snapshot_tenant_mismatch';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Tenant identities on financial records are mandatory and retained.
-- A company cannot be deleted while signed/billing evidence remains.
-- ---------------------------------------------------------------------------
alter table public.customer_contracts alter column company_id set not null;
alter table public.billing_underlays alter column company_id set not null;
alter table public.customer_invoices alter column company_id set not null;
alter table public.customer_invoice_lines alter column company_id set not null;

alter table public.customer_contracts drop constraint if exists customer_contracts_company_id_fkey;
alter table public.customer_contracts
  add constraint customer_contracts_company_id_fkey
  foreign key (company_id) references public.companies(id) on delete restrict;

alter table public.billing_underlays drop constraint if exists billing_underlays_company_id_fkey;
alter table public.billing_underlays
  add constraint billing_underlays_company_id_fkey
  foreign key (company_id) references public.companies(id) on delete restrict;

alter table public.customer_invoices drop constraint if exists customer_invoices_company_id_fkey;
alter table public.customer_invoices
  add constraint customer_invoices_company_id_fkey
  foreign key (company_id) references public.companies(id) on delete restrict;

-- ---------------------------------------------------------------------------
-- 4. Tenant-scoped partner invoice idempotency.
-- The old global uniqueness incorrectly prevented two tenants from receiving
-- the same provider reference and could not support ON CONFLICT(company_id,...).
-- ---------------------------------------------------------------------------
alter table public.customer_invoices
  drop constraint if exists customer_invoices_partner_invoice_reference_key;
drop index if exists public.customer_invoices_partner_invoice_reference_key;
drop index if exists public.customer_invoices_company_partner_ref_uidx;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.customer_invoices'::regclass
      and conname='customer_invoices_company_partner_reference_key'
  ) then
    alter table public.customer_invoices
      add constraint customer_invoices_company_partner_reference_key
      unique (company_id, partner_invoice_reference);
  end if;
end $$;

-- Composite identities required by tenant-bound foreign keys.
create unique index if not exists customer_contracts_company_id_id_uidx
  on public.customer_contracts(company_id,id);
create unique index if not exists contract_price_snapshots_company_id_id_uidx
  on public.contract_price_snapshots(company_id,id);
create unique index if not exists billing_underlays_company_id_id_canonical_uidx
  on public.billing_underlays(company_id,id);
create unique index if not exists customer_invoices_company_id_id_canonical_uidx
  on public.customer_invoices(company_id,id);
create unique index if not exists website_customer_applications_company_id_id_uidx
  on public.website_customer_applications(company_id,id);
create unique index if not exists integration_api_clients_company_id_id_canonical_uidx
  on public.integration_api_clients(company_id,id);

-- ---------------------------------------------------------------------------
-- 5. Composite tenant foreign keys across quote, contract and billing graphs.
-- Independent UUID foreign keys are not sufficient: they permit company A to
-- reference a globally valid object owned by company B.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname='integration_api_write_idempotency_company_client_fkey') then
    alter table public.integration_api_write_idempotency
      add constraint integration_api_write_idempotency_company_client_fkey
      foreign key(company_id,api_client_id)
      references public.integration_api_clients(company_id,id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname='website_contract_quotes_company_client_fkey') then
    alter table public.website_contract_quotes
      add constraint website_contract_quotes_company_client_fkey
      foreign key(company_id,api_client_id)
      references public.integration_api_clients(company_id,id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname='website_contract_quotes_company_application_fkey') then
    alter table public.website_contract_quotes
      add constraint website_contract_quotes_company_application_fkey
      foreign key(company_id,consumed_application_id)
      references public.website_customer_applications(company_id,id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname='contract_price_snapshots_company_contract_fkey') then
    alter table public.contract_price_snapshots
      add constraint contract_price_snapshots_company_contract_fkey
      foreign key(company_id,contract_id)
      references public.customer_contracts(company_id,id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname='billing_underlays_company_snapshot_fkey') then
    alter table public.billing_underlays
      add constraint billing_underlays_company_snapshot_fkey
      foreign key(company_id,contract_price_snapshot_id)
      references public.contract_price_snapshots(company_id,id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname='billing_underlay_items_company_underlay_fkey') then
    alter table public.billing_underlay_items
      add constraint billing_underlay_items_company_underlay_fkey
      foreign key(company_id,billing_underlay_id)
      references public.billing_underlays(company_id,id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname='billing_underlay_items_company_contract_fkey') then
    alter table public.billing_underlay_items
      add constraint billing_underlay_items_company_contract_fkey
      foreign key(company_id,contract_id)
      references public.customer_contracts(company_id,id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname='customer_invoice_lines_company_invoice_fkey') then
    alter table public.customer_invoice_lines
      add constraint customer_invoice_lines_company_invoice_fkey
      foreign key(company_id,invoice_id)
      references public.customer_invoices(company_id,id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname='customer_invoice_lines_company_snapshot_fkey') then
    alter table public.customer_invoice_lines
      add constraint customer_invoice_lines_company_snapshot_fkey
      foreign key(company_id,contract_price_snapshot_id)
      references public.contract_price_snapshots(company_id,id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname='contract_charge_ledger_company_contract_fkey') then
    alter table public.contract_charge_ledger
      add constraint contract_charge_ledger_company_contract_fkey
      foreign key(company_id,customer_contract_id)
      references public.customer_contracts(company_id,id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname='contract_charge_ledger_company_invoice_fkey') then
    alter table public.contract_charge_ledger
      add constraint contract_charge_ledger_company_invoice_fkey
      foreign key(company_id,invoice_id)
      references public.customer_invoices(company_id,id) not valid;
  end if;
end $$;

alter table public.integration_api_write_idempotency validate constraint integration_api_write_idempotency_company_client_fkey;
alter table public.website_contract_quotes validate constraint website_contract_quotes_company_client_fkey;
alter table public.website_contract_quotes validate constraint website_contract_quotes_company_application_fkey;
alter table public.contract_price_snapshots validate constraint contract_price_snapshots_company_contract_fkey;
alter table public.billing_underlays validate constraint billing_underlays_company_snapshot_fkey;
alter table public.billing_underlay_items validate constraint billing_underlay_items_company_underlay_fkey;
alter table public.billing_underlay_items validate constraint billing_underlay_items_company_contract_fkey;
alter table public.customer_invoice_lines validate constraint customer_invoice_lines_company_invoice_fkey;
alter table public.customer_invoice_lines validate constraint customer_invoice_lines_company_snapshot_fkey;
alter table public.contract_charge_ledger validate constraint contract_charge_ledger_company_contract_fkey;
alter table public.contract_charge_ledger validate constraint contract_charge_ledger_company_invoice_fkey;

-- ---------------------------------------------------------------------------
-- 6. Monetary consistency and canonical billing readiness.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname='customer_invoice_lines_vat_rate_fraction_check') then
    alter table public.customer_invoice_lines
      add constraint customer_invoice_lines_vat_rate_fraction_check
      check (vat_rate is null or (vat_rate >= 0 and vat_rate <= 1)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname='customer_invoice_lines_amount_consistency_check') then
    alter table public.customer_invoice_lines
      add constraint customer_invoice_lines_amount_consistency_check
      check (
        (vat_amount is null and amount_inc_vat is null)
        or (
          amount_ex_vat is not null
          and vat_amount is not null
          and amount_inc_vat is not null
          and abs(amount_inc_vat - (amount_ex_vat + vat_amount)) <= 0.01
        )
      ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname='customer_contracts_billing_identity_check') then
    alter table public.customer_contracts
      add constraint customer_contracts_billing_identity_check
      check (
        billing_eligible_at is null
        or (
          contract_price_snapshot_id is not null
          and contract_product_version_id is not null
          and contract_publication_version_id is not null
          and price_area_used in ('SE1','SE2','SE3','SE4')
          and nullif(snapshot_hash,'') is not null
        )
      ) not valid;
  end if;
end $$;

alter table public.customer_invoice_lines validate constraint customer_invoice_lines_vat_rate_fraction_check;
alter table public.customer_invoice_lines validate constraint customer_invoice_lines_amount_consistency_check;
alter table public.customer_contracts validate constraint customer_contracts_billing_identity_check;

commit;
