-- Tenant-scoped unique business keys.
--
-- Findings F-8, F-9, F-10, F-11: several unique indexes were written when the
-- platform served a single electricity retailer and were never re-scoped when it
-- became multi-tenant. Each one means the second tenant collides with the first.
--
-- Rule applied here: every unique business key on a tenant-owned table includes
-- company_id. Market-wide identifiers stay global and say so explicitly.
--
-- Forward-only. Preflight verified zero existing rows violate the new keys.

begin;

-- ---------------------------------------------------------------------------
-- F-10  metering points
--
-- metering_point_id is a national facility identifier. Supplier switching moves
-- the same facility between retailers, so two tenants must be able to hold a row
-- for the same metering point. Global uniqueness made tenant B's insert fail with
-- 23505 during onboarding.
-- ---------------------------------------------------------------------------

-- these are constraint-backed; dropping the constraint drops its index
alter table public.metering_points
  drop constraint if exists metering_points_metering_point_id_key,
  drop constraint if exists metering_points_meter_point_id_key,
  drop constraint if exists metering_points_ediel_reference_key;

drop index if exists public.metering_points_metering_point_id_key;
drop index if exists public.metering_points_meter_point_id_key;
drop index if exists public.metering_points_ediel_reference_key;

create unique index if not exists metering_points_company_metering_point_uk
  on public.metering_points (company_id, metering_point_id)
  where company_id is not null;

create unique index if not exists metering_points_company_meter_point_uk
  on public.metering_points (company_id, meter_point_id)
  where company_id is not null and meter_point_id is not null;

create unique index if not exists metering_points_company_ediel_reference_uk
  on public.metering_points (company_id, ediel_reference)
  where company_id is not null and ediel_reference is not null;

comment on index public.metering_points_company_metering_point_uk is
  'F-10: a national metering point may be held by several tenants over time; uniqueness is per company.';

-- ---------------------------------------------------------------------------
-- F-8  customer numbers
--
-- Numbers are allocated per company by gridex_next_customer_number, but the
-- unique index was global and the distinguishing prefix is neither unique nor
-- enforced. Two tenants resolving to the same prefix collided on their first
-- customer.
-- ---------------------------------------------------------------------------

alter table public.customers
  drop constraint if exists customers_customer_number_key;

drop index if exists public.customers_customer_number_key;

create unique index if not exists customers_company_customer_number_uk
  on public.customers (company_id, customer_number)
  where customer_number is not null;

comment on index public.customers_company_customer_number_uk is
  'F-8: customer numbers are allocated per company; the prefix is presentation, not a correctness guarantee.';

-- ---------------------------------------------------------------------------
-- F-9  electricity suppliers
--
-- Every tenant is itself an electricity retailer and needs its own
-- is_own_supplier row. The old partial index allowed exactly one such row in the
-- entire database. Counterparty rows with company_id IS NULL are shared platform
-- masterdata and keep global uniqueness; tenant-owned rows are scoped.
-- ---------------------------------------------------------------------------

drop index if exists public.electricity_suppliers_single_own_supplier_idx;
drop index if exists public.electricity_suppliers_org_number_unique_idx;
drop index if exists public.electricity_suppliers_name_unique_idx;

create unique index if not exists electricity_suppliers_one_own_per_company_uk
  on public.electricity_suppliers (company_id)
  where is_own_supplier and company_id is not null;

-- shared counterparty registry keeps its global uniqueness
create unique index if not exists electricity_suppliers_shared_org_number_uk
  on public.electricity_suppliers (org_number)
  where company_id is null and org_number is not null;

create unique index if not exists electricity_suppliers_shared_name_uk
  on public.electricity_suppliers (lower(name))
  where company_id is null;

-- tenant-owned counterparty records are unique within their own company
create unique index if not exists electricity_suppliers_company_org_number_uk
  on public.electricity_suppliers (company_id, org_number)
  where company_id is not null and org_number is not null;

create unique index if not exists electricity_suppliers_company_name_uk
  on public.electricity_suppliers (company_id, lower(name))
  where company_id is not null;

-- an "own supplier" without a company is meaningless and was the shape that made
-- the single-row index look correct
alter table public.electricity_suppliers
  drop constraint if exists electricity_suppliers_own_requires_company;

alter table public.electricity_suppliers
  add constraint electricity_suppliers_own_requires_company
  check (not coalesce(is_own_supplier, false) or company_id is not null)
  not valid;

alter table public.electricity_suppliers
  validate constraint electricity_suppliers_own_requires_company;

comment on index public.electricity_suppliers_one_own_per_company_uk is
  'F-9: one own-supplier row per tenant, not one per platform.';

-- ---------------------------------------------------------------------------
-- F-11  legal bundle versions
--
-- Two tenants publishing the same standard terms produce the same content hash.
-- That is the normal case when both start from a template.
-- ---------------------------------------------------------------------------

alter table public.legal_bundle_versions
  drop constraint if exists legal_bundle_versions_content_sha256_key;

drop index if exists public.legal_bundle_versions_content_sha256_key;

create unique index if not exists legal_bundle_versions_company_content_uk
  on public.legal_bundle_versions (company_id, content_sha256)
  where content_sha256 is not null;

comment on index public.legal_bundle_versions_company_content_uk is
  'F-11: identical legal text in two tenants is expected, not a conflict.';

commit;
