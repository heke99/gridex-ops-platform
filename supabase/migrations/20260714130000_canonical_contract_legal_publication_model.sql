-- Canonical, versioned contract/legal/publication model for Gridex OPS.
-- Additive migration: legacy public_contract_offers remains a compatibility surface,
-- while every published offer is synchronized to immutable canonical versions.
-- 2026-07-14

begin;
create extension if not exists pgcrypto;

create table if not exists public.contract_products (
  id uuid primary key default gen_random_uuid(),
  product_code text not null,
  name text not null,
  product_category text not null,
  description text,
  status text not null default 'active' check (status in ('draft','active','paused','archived')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_code)
);

create table if not exists public.contract_product_versions (
  id uuid primary key default gen_random_uuid(),
  contract_product_id uuid not null references public.contract_products(id) on delete restrict,
  version_number integer not null,
  customer_type text not null check (customer_type in ('private','business','both')),
  contract_type text not null,
  pricing_model text not null,
  price_plan_id uuid,
  price_plan_version_id uuid,
  binding_months integer,
  notice_months integer,
  price_areas text[] not null default '{}',
  start_rules jsonb not null default '{}'::jsonb,
  campaign_rules jsonb not null default '{}'::jsonb,
  automatic_renewal boolean not null default false,
  power_of_attorney_required boolean not null default true,
  withdrawal_rules jsonb not null default '{}'::jsonb,
  required_legal_modules text[] not null default '{}',
  commercial_snapshot jsonb not null default '{}'::jsonb,
  content_sha256 text not null,
  status text not null default 'draft' check (status in ('draft','review','approved','paused','archived')),
  approved_at timestamptz,
  approved_by uuid,
  locked_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (contract_product_id, version_number),
  unique (content_sha256)
);

create table if not exists public.tenant_contract_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  contract_product_version_id uuid not null references public.contract_product_versions(id) on delete restrict,
  internal_sales_allowed boolean not null default true,
  website_publication_allowed boolean not null default false,
  status text not null default 'active' check (status in ('active','paused','ended')),
  legal_mode text not null default 'ops_standard' check (legal_mode in ('ops_standard','ops_standard_with_addendum','tenant_legal')),
  valid_from date,
  valid_to date,
  assigned_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, contract_product_version_id)
);

create table if not exists public.tenant_contract_channels (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.tenant_contract_assignments(id) on delete cascade,
  channel text not null check (channel in ('internal','website','phone','partner','api')),
  status text not null default 'paused' check (status in ('active','paused','ended')),
  valid_from timestamptz,
  valid_to timestamptz,
  marketing_content jsonb not null default '{}'::jsonb,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, channel)
);

create table if not exists public.legal_templates (
  id uuid primary key default gen_random_uuid(),
  module_key text not null unique,
  name text not null,
  description text,
  mandatory boolean not null default false,
  status text not null default 'active' check (status in ('active','paused','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.legal_template_versions (
  id uuid primary key default gen_random_uuid(),
  legal_template_id uuid not null references public.legal_templates(id) on delete restrict,
  version_number integer not null,
  title text not null,
  body text not null,
  variables text[] not null default '{}',
  content_sha256 text not null,
  status text not null default 'draft' check (status in ('draft','review','published','replaced','archived')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  published_at timestamptz,
  locked_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (legal_template_id, version_number),
  unique (content_sha256)
);

create table if not exists public.tenant_legal_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.companies(id) on delete cascade,
  legal_name text,
  organization_number text,
  postal_address jsonb not null default '{}'::jsonb,
  customer_service_address jsonb not null default '{}'::jsonb,
  customer_service_email text,
  phone text,
  website text,
  complaints_contact jsonb not null default '{}'::jsonb,
  data_protection_contact jsonb not null default '{}'::jsonb,
  billing_information jsonb not null default '{}'::jsonb,
  dispute_resolution_information jsonb not null default '{}'::jsonb,
  memberships jsonb not null default '[]'::jsonb,
  completeness_status text not null default 'incomplete' check (completeness_status in ('incomplete','complete','verified')),
  verified_at timestamptz,
  verified_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tenant_legal_overrides (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  module_key text not null,
  legal_mode text not null check (legal_mode in ('addendum','replacement')),
  title text not null,
  body text not null,
  content_sha256 text not null,
  status text not null default 'draft' check (status in ('draft','submitted','approved','published','replaced','archived','rejected')),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid,
  review_notes text,
  locked_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (company_id, module_key, content_sha256)
);

create table if not exists public.legal_bundle_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  contract_product_version_id uuid not null references public.contract_product_versions(id) on delete restrict,
  legacy_legal_bundle_id uuid,
  version_number integer not null,
  legal_mode text not null check (legal_mode in ('ops_standard','ops_standard_with_addendum','tenant_legal')),
  rendered_snapshot jsonb not null default '{}'::jsonb,
  unresolved_variables text[] not null default '{}',
  content_sha256 text not null,
  status text not null default 'draft' check (status in ('draft','review','published','replaced','archived')),
  published_at timestamptz,
  locked_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (company_id, contract_product_version_id, version_number),
  unique (content_sha256)
);

create table if not exists public.legal_bundle_version_documents (
  id uuid primary key default gen_random_uuid(),
  legal_bundle_version_id uuid not null references public.legal_bundle_versions(id) on delete restrict,
  module_key text not null,
  legal_template_version_id uuid references public.legal_template_versions(id) on delete restrict,
  tenant_legal_override_id uuid references public.tenant_legal_overrides(id) on delete restrict,
  legacy_legal_text_version_id uuid,
  title text not null,
  rendered_body text not null,
  content_sha256 text not null,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  unique (legal_bundle_version_id, module_key)
);

create table if not exists public.contract_publications (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.tenant_contract_assignments(id) on delete restrict,
  channel text not null check (channel in ('website','api','internal','phone','partner')),
  status text not null default 'draft' check (status in ('draft','review','published','paused','ended','archived')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, channel)
);

create table if not exists public.contract_publication_versions (
  id uuid primary key default gen_random_uuid(),
  contract_publication_id uuid not null references public.contract_publications(id) on delete restrict,
  version_number integer not null,
  contract_product_version_id uuid not null references public.contract_product_versions(id) on delete restrict,
  price_plan_id uuid,
  price_plan_version_id uuid,
  price_book_id uuid,
  legal_bundle_version_id uuid not null references public.legal_bundle_versions(id) on delete restrict,
  legacy_public_contract_offer_id uuid,
  customer_type text not null check (customer_type in ('private','business','both')),
  channel text not null,
  valid_from timestamptz,
  valid_to timestamptz,
  publication_snapshot jsonb not null default '{}'::jsonb,
  offer_reference text,
  content_sha256 text not null,
  status text not null default 'draft' check (status in ('draft','review','published','paused','ended','archived')),
  published_at timestamptz,
  locked_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (contract_publication_id, version_number),
  unique (content_sha256),
  unique (offer_reference)
);

alter table if exists public.customer_contracts
  add column if not exists contract_product_id uuid,
  add column if not exists contract_product_version_id uuid,
  add column if not exists contract_publication_version_id uuid,
  add column if not exists legal_bundle_version_id uuid,
  add column if not exists commercial_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists legal_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists document_sha256 text,
  add column if not exists locked_at timestamptz;

create table if not exists public.customer_contract_acceptances (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  customer_contract_id uuid not null references public.customer_contracts(id) on delete restrict,
  contract_publication_version_id uuid references public.contract_publication_versions(id) on delete restrict,
  accepted_at timestamptz not null,
  channel text not null,
  signing_method text,
  ip_hash text,
  user_agent text,
  customer_identity_snapshot jsonb not null default '{}'::jsonb,
  power_of_attorney_snapshot jsonb not null default '{}'::jsonb,
  acceptance_snapshot jsonb not null default '{}'::jsonb,
  acceptance_sha256 text not null,
  created_at timestamptz not null default now(),
  unique (customer_contract_id, acceptance_sha256)
);

create table if not exists public.customer_contract_evidence (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  customer_contract_id uuid not null references public.customer_contracts(id) on delete restrict,
  evidence_type text not null,
  evidence_snapshot jsonb not null default '{}'::jsonb,
  evidence_sha256 text not null,
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (customer_contract_id, evidence_type, evidence_sha256)
);

create table if not exists public.customer_contract_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  customer_contract_id uuid not null references public.customer_contracts(id) on delete restrict,
  document_type text not null,
  storage_path text,
  mime_type text not null default 'application/pdf',
  document_sha256 text not null,
  generated_at timestamptz not null default now(),
  generation_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (customer_contract_id, document_type, document_sha256)
);

-- Add FKs only when the referenced legacy tables exist.
do $$
begin
  if to_regclass('public.price_plans') is not null then
    alter table public.contract_product_versions drop constraint if exists contract_product_versions_price_plan_fk;
    alter table public.contract_product_versions add constraint contract_product_versions_price_plan_fk foreign key (price_plan_id) references public.price_plans(id) on delete restrict;
    alter table public.contract_publication_versions drop constraint if exists contract_publication_versions_price_plan_fk;
    alter table public.contract_publication_versions add constraint contract_publication_versions_price_plan_fk foreign key (price_plan_id) references public.price_plans(id) on delete restrict;
  end if;
  if to_regclass('public.price_plan_versions') is not null then
    alter table public.contract_product_versions drop constraint if exists contract_product_versions_price_plan_version_fk;
    alter table public.contract_product_versions add constraint contract_product_versions_price_plan_version_fk foreign key (price_plan_version_id) references public.price_plan_versions(id) on delete restrict;
    alter table public.contract_publication_versions drop constraint if exists contract_publication_versions_price_plan_version_fk;
    alter table public.contract_publication_versions add constraint contract_publication_versions_price_plan_version_fk foreign key (price_plan_version_id) references public.price_plan_versions(id) on delete restrict;
  end if;
  if to_regclass('public.price_books') is not null then
    alter table public.contract_publication_versions drop constraint if exists contract_publication_versions_price_book_fk;
    alter table public.contract_publication_versions add constraint contract_publication_versions_price_book_fk foreign key (price_book_id) references public.price_books(id) on delete restrict;
  end if;
  if to_regclass('public.legal_bundles') is not null then
    alter table public.legal_bundle_versions drop constraint if exists legal_bundle_versions_legacy_bundle_fk;
    alter table public.legal_bundle_versions add constraint legal_bundle_versions_legacy_bundle_fk foreign key (legacy_legal_bundle_id) references public.legal_bundles(id) on delete restrict;
  end if;
  if to_regclass('public.public_contract_offers') is not null then
    alter table public.contract_publication_versions drop constraint if exists contract_publication_versions_legacy_offer_fk;
    alter table public.contract_publication_versions add constraint contract_publication_versions_legacy_offer_fk foreign key (legacy_public_contract_offer_id) references public.public_contract_offers(id) on delete restrict;
  end if;
end $$;

create index if not exists contract_product_versions_product_status_idx on public.contract_product_versions(contract_product_id,status,version_number desc);
create index if not exists tenant_contract_assignments_company_status_idx on public.tenant_contract_assignments(company_id,status);
create index if not exists legal_bundle_versions_company_contract_idx on public.legal_bundle_versions(company_id,contract_product_version_id,version_number desc);
create index if not exists contract_publication_versions_publication_status_idx on public.contract_publication_versions(contract_publication_id,status,version_number desc);
create index if not exists customer_contract_acceptances_contract_idx on public.customer_contract_acceptances(customer_contract_id,accepted_at desc);
create index if not exists customer_contract_documents_contract_idx on public.customer_contract_documents(customer_contract_id,generated_at desc);

-- RLS: platform-owned catalog tables are superadmin-readable; company-bound
-- tables are tenant-readable through the existing canonical company guard.
do $$
declare t text;
begin
  foreach t in array array[
    'contract_products','contract_product_versions','legal_templates','legal_template_versions'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists %I on public.%I',t || '_platform_read',t);
    execute format('create policy %I on public.%I for select to authenticated using (public.gridex_user_is_platform_admin())',t || '_platform_read',t);
  end loop;
end $$;

-- Tenants may read only products/versions explicitly assigned to one of their companies.
drop policy if exists contract_product_versions_platform_read on public.contract_product_versions;
create policy contract_product_versions_assigned_read on public.contract_product_versions for select to authenticated using (
  public.gridex_user_is_platform_admin() or exists (
    select 1 from public.tenant_contract_assignments a
    where a.contract_product_version_id = contract_product_versions.id
      and public.gridex_can_read_company(a.company_id)
  )
);
drop policy if exists contract_products_platform_read on public.contract_products;
create policy contract_products_assigned_read on public.contract_products for select to authenticated using (
  public.gridex_user_is_platform_admin() or exists (
    select 1 from public.contract_product_versions v
    join public.tenant_contract_assignments a on a.contract_product_version_id=v.id
    where v.contract_product_id = contract_products.id
      and public.gridex_can_read_company(a.company_id)
  )
);

do $$
declare t text;
begin
  foreach t in array array[
    'tenant_contract_assignments','tenant_legal_profiles','tenant_legal_overrides',
    'legal_bundle_versions','customer_contract_acceptances','customer_contract_evidence','customer_contract_documents'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists %I on public.%I',t || '_tenant_read',t);
    execute format('create policy %I on public.%I for select to authenticated using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id))',t || '_tenant_read',t);
  end loop;
end $$;

alter table public.tenant_contract_channels enable row level security;
drop policy if exists tenant_contract_channels_tenant_read on public.tenant_contract_channels;
create policy tenant_contract_channels_tenant_read on public.tenant_contract_channels for select to authenticated using (
  public.gridex_user_is_platform_admin() or exists (
    select 1
    from public.tenant_contract_assignments a
    where a.id = tenant_contract_channels.assignment_id
      and public.gridex_can_read_company(a.company_id)
  )
);
alter table public.legal_bundle_version_documents enable row level security;
drop policy if exists legal_bundle_version_documents_tenant_read on public.legal_bundle_version_documents;
create policy legal_bundle_version_documents_tenant_read on public.legal_bundle_version_documents for select to authenticated using (
  public.gridex_user_is_platform_admin() or exists (
    select 1
    from public.legal_bundle_versions b
    where b.id = legal_bundle_version_documents.legal_bundle_version_id
      and public.gridex_can_read_company(b.company_id)
  )
);
alter table public.contract_publications enable row level security;
drop policy if exists contract_publications_tenant_read on public.contract_publications;
create policy contract_publications_tenant_read on public.contract_publications for select to authenticated using (
  public.gridex_user_is_platform_admin() or exists (
    select 1
    from public.tenant_contract_assignments a
    where a.id = contract_publications.assignment_id
      and public.gridex_can_read_company(a.company_id)
  )
);
alter table public.contract_publication_versions enable row level security;
drop policy if exists contract_publication_versions_tenant_read on public.contract_publication_versions;
create policy contract_publication_versions_tenant_read on public.contract_publication_versions for select to authenticated using (
  public.gridex_user_is_platform_admin() or exists (
    select 1 from public.contract_publications p
    join public.tenant_contract_assignments a on a.id=p.assignment_id
    where p.id = contract_publication_versions.contract_publication_id
      and public.gridex_can_read_company(a.company_id)
  )
);

create or replace function public.gridex_reject_locked_row_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if nullif(to_jsonb(old)->>'locked_at','') is not null
     or nullif(to_jsonb(old)->>'published_at','') is not null then
    raise exception using errcode='55000', message='immutable_version_locked';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create or replace function public.gridex_reject_any_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception using errcode='55000', message='immutable_evidence';
  return null;
end $$;

create or replace function public.gridex_lock_signed_customer_contract()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.status in ('signed','active','terminated','cancelled','expired') or old.signed_at is not null or old.locked_at is not null then
    if new.company_id is distinct from old.company_id
       or new.customer_id is distinct from old.customer_id
       or new.contract_product_id is distinct from old.contract_product_id
       or new.contract_product_version_id is distinct from old.contract_product_version_id
       or new.contract_publication_version_id is distinct from old.contract_publication_version_id
       or new.legal_bundle_version_id is distinct from old.legal_bundle_version_id
       or new.offer_reference is distinct from old.offer_reference
       or new.commercial_snapshot is distinct from old.commercial_snapshot
       or new.legal_snapshot is distinct from old.legal_snapshot
       or new.signature_snapshot is distinct from old.signature_snapshot
       or new.signature_snapshot_sha256 is distinct from old.signature_snapshot_sha256
       or new.document_sha256 is distinct from old.document_sha256
       or new.signed_at is distinct from old.signed_at then
      raise exception using errcode='55000', message='signed_customer_contract_immutable';
    end if;
    new.locked_at := coalesce(old.locked_at, old.signed_at, now());
  elsif new.signed_at is not null or new.status in ('signed','active') then
    new.locked_at := coalesce(new.locked_at, new.signed_at, now());
  end if;
  return new;
end $$;


drop trigger if exists contract_product_versions_immutable on public.contract_product_versions;
create trigger contract_product_versions_immutable before update or delete on public.contract_product_versions for each row execute function public.gridex_reject_locked_row_mutation();
drop trigger if exists legal_template_versions_immutable on public.legal_template_versions;
create trigger legal_template_versions_immutable before update or delete on public.legal_template_versions for each row execute function public.gridex_reject_locked_row_mutation();
drop trigger if exists legal_bundle_versions_immutable on public.legal_bundle_versions;
create trigger legal_bundle_versions_immutable before update or delete on public.legal_bundle_versions for each row execute function public.gridex_reject_locked_row_mutation();
drop trigger if exists contract_publication_versions_immutable on public.contract_publication_versions;
create trigger contract_publication_versions_immutable before update or delete on public.contract_publication_versions for each row execute function public.gridex_reject_locked_row_mutation();
drop trigger if exists tenant_legal_overrides_immutable on public.tenant_legal_overrides;
create trigger tenant_legal_overrides_immutable before update or delete on public.tenant_legal_overrides for each row execute function public.gridex_reject_locked_row_mutation();

drop trigger if exists customer_contract_acceptances_immutable on public.customer_contract_acceptances;
create trigger customer_contract_acceptances_immutable before update or delete on public.customer_contract_acceptances for each row execute function public.gridex_reject_any_mutation();
drop trigger if exists customer_contract_evidence_immutable on public.customer_contract_evidence;
create trigger customer_contract_evidence_immutable before update or delete on public.customer_contract_evidence for each row execute function public.gridex_reject_any_mutation();
drop trigger if exists customer_contract_documents_immutable on public.customer_contract_documents;
create trigger customer_contract_documents_immutable before update or delete on public.customer_contract_documents for each row execute function public.gridex_reject_any_mutation();
drop trigger if exists customer_contracts_signed_immutable on public.customer_contracts;
create trigger customer_contracts_signed_immutable before update on public.customer_contracts for each row execute function public.gridex_lock_signed_customer_contract();

-- Compatibility synchronizer: each legacy website offer becomes a canonical product,
-- immutable commercial version, tenant assignment, legal bundle version and publication version.
create or replace function public.gridex_sync_public_offer_to_canonical(p_offer_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o record;
  v_product_id uuid;
  v_contract_version_id uuid;
  v_assignment_id uuid;
  v_publication_id uuid;
  v_legal_version_id uuid;
  v_publication_version_id uuid;
  v_commercial jsonb;
  v_publication jsonb;
  v_contract_hash text;
  v_legal_hash text;
  v_publication_hash text;
  v_contract_version integer;
  v_legal_version integer;
  v_publication_version integer;
begin
  select pco.*
    into o
    from public.public_contract_offers pco
    where pco.id = p_offer_id;
  if not found then return null; end if;

  insert into public.contract_products(product_code,name,product_category,description,status)
  values (coalesce(nullif(o.product_code,''), 'electricity') || ':' || coalesce(nullif(o.contract_type,''),'unknown'), o.public_name, coalesce(nullif(o.contract_type,''),'unknown'), o.public_description, 'active')
  on conflict (product_code) do update set name=excluded.name, description=coalesce(excluded.description,public.contract_products.description), updated_at=now()
  returning id into v_product_id;

  v_commercial := jsonb_strip_nulls(jsonb_build_object(
    'legacy_public_contract_offer_id',o.id,'company_id',o.company_id,'product_code',o.product_code,
    'contract_type',o.contract_type,'billing_model',o.billing_model,'customer_type',o.customer_type,
    'price_plan_id',o.price_plan_id,'price_plan_version_id',o.price_plan_version_id,
    'monthly_fee_sek',o.monthly_fee_sek,'invoice_fee_sek',o.invoice_fee_sek,
    'markup_ore_per_kwh',o.markup_ore_per_kwh,'spot_markup_ore_per_kwh',o.spot_markup_ore_per_kwh,
    'variable_fee_ore_per_kwh',o.variable_fee_ore_per_kwh,'fixed_price_ore_per_kwh',o.fixed_price_ore_per_kwh,
    'binding_months',o.binding_months,'notice_months',o.notice_months,
    'spot_weight_percent',o.spot_weight_percent,'portfolio_weight_percent',o.portfolio_weight_percent,'fixed_weight_percent',o.fixed_weight_percent
  ));
  v_contract_hash := encode(digest(v_commercial::text,'sha256'),'hex');
  select cpv.id
    into v_contract_version_id
    from public.contract_product_versions cpv
    where cpv.content_sha256 = v_contract_hash;
  if v_contract_version_id is null then
    select coalesce(max(version_number),0)+1 into v_contract_version from public.contract_product_versions where contract_product_id=v_product_id;
    insert into public.contract_product_versions(contract_product_id,version_number,customer_type,contract_type,pricing_model,price_plan_id,price_plan_version_id,binding_months,notice_months,commercial_snapshot,content_sha256,status,approved_at,locked_at)
    values(v_product_id,v_contract_version,case when o.customer_type in ('private','business','both') then o.customer_type else 'both' end,coalesce(o.contract_type,'unknown'),coalesce(o.billing_model,o.contract_type,'unknown'),o.price_plan_id,o.price_plan_version_id,o.binding_months,o.notice_months,v_commercial,v_contract_hash,'approved',now(),now())
    returning id into v_contract_version_id;
  end if;

  insert into public.tenant_contract_assignments(company_id,contract_product_version_id,internal_sales_allowed,website_publication_allowed,status,legal_mode,valid_from,valid_to)
  values(o.company_id,v_contract_version_id,true,true,case when coalesce(o.is_archived,false) then 'ended' else 'active' end,'ops_standard',o.valid_from,o.valid_to)
  on conflict(company_id,contract_product_version_id) do update set website_publication_allowed=true,status=excluded.status,valid_from=excluded.valid_from,valid_to=excluded.valid_to,updated_at=now()
  returning id into v_assignment_id;

  insert into public.tenant_contract_channels(assignment_id,channel,status,valid_from,valid_to,marketing_content)
  values(v_assignment_id,'website',case when o.publication_status='published' and coalesce(o.website_enabled,false) then 'active' when coalesce(o.is_archived,false) then 'ended' else 'paused' end,o.valid_from::timestamptz,o.valid_to::timestamptz,jsonb_build_object('name',o.public_name,'description',o.public_description,'sort_order',o.sort_order))
  on conflict(assignment_id,channel) do update set status=excluded.status,valid_from=excluded.valid_from,valid_to=excluded.valid_to,marketing_content=excluded.marketing_content,updated_at=now();

  v_legal_hash := encode(digest(concat_ws('|',o.company_id::text,v_contract_version_id::text,coalesce(o.legal_bundle_id::text,'')),'sha256'),'hex');
  select lbv.id
    into v_legal_version_id
    from public.legal_bundle_versions lbv
    where lbv.content_sha256 = v_legal_hash;
  if v_legal_version_id is null then
    select coalesce(max(version_number),0)+1 into v_legal_version from public.legal_bundle_versions where company_id=o.company_id and contract_product_version_id=v_contract_version_id;
    insert into public.legal_bundle_versions(company_id,contract_product_version_id,legacy_legal_bundle_id,version_number,legal_mode,rendered_snapshot,content_sha256,status,published_at,locked_at)
    values(o.company_id,v_contract_version_id,o.legal_bundle_id,v_legal_version,'ops_standard',jsonb_build_object('legacy_legal_bundle_id',o.legal_bundle_id),v_legal_hash,case when o.publication_status='published' then 'published' else 'draft' end,case when o.publication_status='published' then coalesce(o.published_at,now()) end,case when o.publication_status='published' then coalesce(o.published_at,now()) end)
    returning id into v_legal_version_id;
  elsif o.publication_status='published' then
    update public.legal_bundle_versions lbv
       set status = 'published',
           published_at = coalesce(lbv.published_at, o.published_at, now()),
           locked_at = coalesce(lbv.locked_at, o.published_at, now())
     where lbv.id = v_legal_version_id
       and lbv.locked_at is null;
  end if;

  insert into public.contract_publications(assignment_id,channel,status)
  values(v_assignment_id,'website',case when o.publication_status='published' and coalesce(o.website_enabled,false) then 'published' when coalesce(o.is_archived,false) then 'archived' else 'paused' end)
  on conflict(assignment_id,channel) do update set status=excluded.status,updated_at=now()
  returning id into v_publication_id;

  v_publication := jsonb_strip_nulls(jsonb_build_object(
    'legacy_public_contract_offer_id',o.id,'company_id',o.company_id,'contract_product_id',v_product_id,
    'contract_product_version_id',v_contract_version_id,'legal_bundle_version_id',v_legal_version_id,
    'price_plan_id',o.price_plan_id,'price_plan_version_id',o.price_plan_version_id,'price_book_id',o.price_book_id,
    'customer_type',o.customer_type,'channel','website','valid_from',o.valid_from,'valid_to',o.valid_to,
    'terms_version',o.terms_version,'website_cta_enabled',o.website_cta_enabled,
    'publication_status',o.publication_status,'website_enabled',o.website_enabled,'is_archived',o.is_archived
  ));
  v_publication_hash := encode(digest(v_publication::text,'sha256'),'hex');
  select cpv.id
    into v_publication_version_id
    from public.contract_publication_versions cpv
    where cpv.content_sha256 = v_publication_hash;
  if v_publication_version_id is null then
    select coalesce(max(version_number),0)+1 into v_publication_version from public.contract_publication_versions where contract_publication_id=v_publication_id;
    insert into public.contract_publication_versions(contract_publication_id,version_number,contract_product_version_id,price_plan_id,price_plan_version_id,price_book_id,legal_bundle_version_id,legacy_public_contract_offer_id,customer_type,channel,valid_from,valid_to,publication_snapshot,content_sha256,status,published_at,locked_at)
    values(v_publication_id,v_publication_version,v_contract_version_id,o.price_plan_id,o.price_plan_version_id,o.price_book_id,v_legal_version_id,o.id,case when o.customer_type in ('private','business','both') then o.customer_type else 'both' end,'website',o.valid_from::timestamptz,o.valid_to::timestamptz,v_publication,v_publication_hash,case when o.publication_status='published' and coalesce(o.website_enabled,false) then 'published' when coalesce(o.is_archived,false) then 'archived' else 'paused' end,case when o.publication_status='published' then coalesce(o.published_at,now()) end,case when o.publication_status='published' then coalesce(o.published_at,now()) end)
    returning id into v_publication_version_id;
  end if;

  update public.public_contract_offers
     set metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
       'contract_product_id',v_product_id,'contract_product_version_id',v_contract_version_id,
       'tenant_contract_assignment_id',v_assignment_id,'legal_bundle_version_id',v_legal_version_id,
       'contract_publication_id',v_publication_id,'contract_publication_version_id',v_publication_version_id,
       'canonical_publication_sha256',v_publication_hash
     )
   where public_contract_offers.id = o.id;
  return v_publication_version_id;
end $$;

revoke all on function public.gridex_sync_public_offer_to_canonical(uuid) from public, anon, authenticated;

grant execute on function public.gridex_sync_public_offer_to_canonical(uuid) to service_role;

create or replace function public.gridex_sync_public_offer_trigger()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if pg_trigger_depth() = 1 then perform public.gridex_sync_public_offer_to_canonical(new.id); end if;
  return new;
end $$;

drop trigger if exists public_contract_offers_canonical_sync on public.public_contract_offers;
create trigger public_contract_offers_canonical_sync after insert or update of publication_status,website_enabled,website_cta_enabled,is_public,is_archived,price_plan_id,price_plan_version_id,price_book_id,legal_bundle_id,valid_from,valid_to,customer_type,contract_type,billing_model,monthly_fee_sek,invoice_fee_sek,markup_ore_per_kwh,spot_markup_ore_per_kwh,variable_fee_ore_per_kwh,fixed_price_ore_per_kwh,binding_months,notice_months,public_name,public_description on public.public_contract_offers for each row execute function public.gridex_sync_public_offer_trigger();

-- Backfill all current offers.
do $$
declare
  r record;
begin
  for r in
    select pco.id
    from public.public_contract_offers pco
  loop
    perform public.gridex_sync_public_offer_to_canonical(r.id);
  end loop;
end $$;

-- Link existing customer contracts through durable same-tenant public offer metadata.
update public.customer_contracts c
set contract_product_id = nullif(p.metadata->>'contract_product_id','')::uuid,
    contract_product_version_id = nullif(p.metadata->>'contract_product_version_id','')::uuid,
    contract_publication_version_id = nullif(p.metadata->>'contract_publication_version_id','')::uuid,
    legal_bundle_version_id = nullif(p.metadata->>'legal_bundle_version_id','')::uuid,
    locked_at = case when c.signed_at is not null or c.status in ('signed','active','terminated','cancelled','expired') then coalesce(c.locked_at,c.signed_at,c.updated_at,c.created_at,now()) else c.locked_at end
from public.public_contract_offers p
where c.company_id=p.company_id and c.public_contract_offer_id=p.id
  and (c.contract_product_version_id is null or c.contract_publication_version_id is null or c.legal_bundle_version_id is null);

-- Read model for tenant contract catalogue and API diagnostics.
create or replace view public.tenant_contract_catalog_v
with (security_invoker=true)
as
select a.company_id,a.id assignment_id,p.id contract_product_id,p.product_code,p.name product_name,p.product_category,
       v.id contract_product_version_id,v.version_number,v.customer_type,v.contract_type,v.pricing_model,v.price_plan_id,v.price_plan_version_id,
       v.binding_months,v.notice_months,v.status version_status,a.internal_sales_allowed,a.website_publication_allowed,a.status assignment_status,a.legal_mode,a.valid_from,a.valid_to,
       ch.status website_channel_status,pub.status publication_status,pv.id publication_version_id,pv.version_number publication_version_number,pv.price_book_id,pv.legal_bundle_version_id,pv.offer_reference,pv.content_sha256 publication_sha256
from public.tenant_contract_assignments a
join public.contract_product_versions v on v.id=a.contract_product_version_id
join public.contract_products p on p.id=v.contract_product_id
left join public.tenant_contract_channels ch on ch.assignment_id=a.id and ch.channel='website'
left join public.contract_publications pub on pub.assignment_id=a.id and pub.channel='website'
left join lateral (select x.* from public.contract_publication_versions x where x.contract_publication_id=pub.id order by x.version_number desc limit 1) pv on true;

grant select on public.tenant_contract_catalog_v to authenticated;
revoke all on public.contract_products,public.contract_product_versions,public.tenant_contract_assignments,public.tenant_contract_channels,public.legal_templates,public.legal_template_versions,public.tenant_legal_profiles,public.tenant_legal_overrides,public.legal_bundle_versions,public.legal_bundle_version_documents,public.contract_publications,public.contract_publication_versions,public.customer_contract_acceptances,public.customer_contract_evidence,public.customer_contract_documents from anon;

commit;
