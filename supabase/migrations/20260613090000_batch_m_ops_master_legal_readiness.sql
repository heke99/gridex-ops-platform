-- Batch M / A-Q: OPS master for legal versions, acceptances, POA scope, snapshots,
-- customer readiness and tenant website readiness.
-- Safe/idempotent migration: extends existing tables and keeps previous Ediel/OPS flows intact.

-- -----------------------------------------------------------------------------
-- 1. Legal text versions per tenant
-- -----------------------------------------------------------------------------
create table if not exists public.legal_text_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  type text not null check (type in ('terms','privacy_policy','withdrawal','power_of_attorney','price_terms')),
  version text not null,
  title text not null,
  body text not null,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  published_at timestamptz,
  published_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  constraint legal_text_versions_company_type_version_uidx unique(company_id, type, version)
);

create index if not exists legal_text_versions_company_type_status_idx
  on public.legal_text_versions(company_id, type, status, created_at desc);

create unique index if not exists legal_text_versions_one_published_per_type_uidx
  on public.legal_text_versions(company_id, type)
  where status = 'published';

alter table public.legal_text_versions enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='legal_text_versions' and policyname='legal_text_versions_select_company') then
    create policy legal_text_versions_select_company
      on public.legal_text_versions
      for select
      using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='legal_text_versions' and policyname='legal_text_versions_insert_platform') then
    create policy legal_text_versions_insert_platform
      on public.legal_text_versions
      for insert
      with check (public.gridex_user_is_platform_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='legal_text_versions' and policyname='legal_text_versions_update_platform') then
    create policy legal_text_versions_update_platform
      on public.legal_text_versions
      for update
      using (public.gridex_user_is_platform_admin())
      with check (public.gridex_user_is_platform_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='legal_text_versions' and policyname='legal_text_versions_delete_platform_drafts_only') then
    create policy legal_text_versions_delete_platform_drafts_only
      on public.legal_text_versions
      for delete
      using (public.gridex_user_is_platform_admin() and status = 'draft');
  end if;
end $$;

create or replace function public.gridex_legal_text_versions_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end $$;

drop trigger if exists legal_text_versions_set_updated_at on public.legal_text_versions;
create trigger legal_text_versions_set_updated_at
  before insert or update on public.legal_text_versions
  for each row execute function public.gridex_legal_text_versions_set_updated_at();

create or replace function public.gridex_prevent_published_legal_text_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'published' then
      raise exception 'Published legal text versions cannot be deleted. Archive by publishing a new version instead.';
    end if;
    return old;
  end if;

  if old.status = 'published' and (
    old.company_id is distinct from new.company_id or
    old.type is distinct from new.type or
    old.version is distinct from new.version or
    old.title is distinct from new.title or
    old.body is distinct from new.body
  ) then
    raise exception 'Published legal text content is immutable. Create a new version instead.';
  end if;

  return new;
end $$;

drop trigger if exists legal_text_versions_immutable_when_published on public.legal_text_versions;
create trigger legal_text_versions_immutable_when_published
  before update or delete on public.legal_text_versions
  for each row execute function public.gridex_prevent_published_legal_text_mutation();

-- -----------------------------------------------------------------------------
-- 2. Customer legal acceptances: immutable, tenant-scoped snapshots
-- -----------------------------------------------------------------------------
create table if not exists public.customer_legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  contract_id uuid references public.customer_contracts(id) on delete set null,
  contract_application_id uuid,
  acceptance_type text not null check (acceptance_type in ('terms','privacy_policy','withdrawal_info','price_snapshot','power_of_attorney')),
  legal_text_version_id uuid references public.legal_text_versions(id) on delete restrict,
  accepted_at timestamptz not null default now(),
  accepted_ip text,
  accepted_ip_hash text,
  accepted_user_agent text,
  source text not null default 'website' check (source in ('website','customer_portal','admin_manual')),
  snapshot jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  reason text,
  constraint customer_legal_acceptances_admin_reason_chk check (source <> 'admin_manual' or nullif(btrim(coalesce(reason, '')), '') is not null)
);

create index if not exists customer_legal_acceptances_customer_idx
  on public.customer_legal_acceptances(company_id, customer_id, accepted_at desc);
create index if not exists customer_legal_acceptances_contract_idx
  on public.customer_legal_acceptances(company_id, contract_id, acceptance_type)
  where contract_id is not null;
create index if not exists customer_legal_acceptances_type_idx
  on public.customer_legal_acceptances(company_id, customer_id, acceptance_type, accepted_at desc);

alter table public.customer_legal_acceptances enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='customer_legal_acceptances' and policyname='customer_legal_acceptances_select_company') then
    create policy customer_legal_acceptances_select_company
      on public.customer_legal_acceptances
      for select
      using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='customer_legal_acceptances' and policyname='customer_legal_acceptances_insert_company') then
    create policy customer_legal_acceptances_insert_company
      on public.customer_legal_acceptances
      for insert
      with check (public.gridex_user_is_platform_admin() or public.gridex_can_write_company(company_id));
  end if;
end $$;

create or replace function public.gridex_customer_legal_acceptances_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Customer legal acceptances are immutable. Add a new acceptance record instead.';
end $$;

drop trigger if exists customer_legal_acceptances_immutable_update on public.customer_legal_acceptances;
create trigger customer_legal_acceptances_immutable_update
  before update or delete on public.customer_legal_acceptances
  for each row execute function public.gridex_customer_legal_acceptances_immutable();

-- -----------------------------------------------------------------------------
-- 3. Harden existing POA, contracts, documents, communication and notes tables
-- -----------------------------------------------------------------------------
alter table if exists public.powers_of_attorney
  add column if not exists contract_id uuid references public.customer_contracts(id) on delete set null,
  add column if not exists customer_site_id uuid references public.customer_sites(id) on delete set null,
  add column if not exists accepted_at timestamptz,
  add column if not exists revoked_at timestamptz,
  add column if not exists valid_until date,
  add column if not exists legal_text_version_id uuid references public.legal_text_versions(id) on delete restrict,
  add column if not exists fullmakt_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists accepted_ip text,
  add column if not exists accepted_ip_hash text,
  add column if not exists accepted_user_agent text,
  add column if not exists accepted_source text default 'admin_manual',
  add column if not exists scope_summary jsonb not null default '{}'::jsonb;

update public.powers_of_attorney
set customer_site_id = coalesce(customer_site_id, site_id),
    accepted_at = coalesce(accepted_at, signed_at),
    valid_until = coalesce(valid_until, valid_to)
where customer_site_id is null or accepted_at is null or valid_until is null;

create index if not exists powers_of_attorney_company_customer_scope_status_idx
  on public.powers_of_attorney(company_id, customer_id, scope, status, created_at desc);
create index if not exists powers_of_attorney_company_site_status_idx
  on public.powers_of_attorney(company_id, customer_site_id, status, created_at desc)
  where customer_site_id is not null;
create index if not exists powers_of_attorney_company_contract_status_idx
  on public.powers_of_attorney(company_id, contract_id, status, created_at desc)
  where contract_id is not null;

alter table if exists public.customer_contracts
  add column if not exists legal_acceptance_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists legal_readiness_status text not null default 'pending',
  add column if not exists legal_readiness_reasons jsonb not null default '[]'::jsonb,
  add column if not exists application_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists website_application_id uuid;

alter table if exists public.customer_documents
  add column if not exists contract_id uuid references public.customer_contracts(id) on delete set null,
  add column if not exists document_version text,
  add column if not exists storage_key text,
  add column if not exists source text,
  add column if not exists audit jsonb not null default '{}'::jsonb,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

update public.customer_documents
set storage_key = coalesce(storage_key, file_path),
    source = coalesce(source, source_system)
where storage_key is null or source is null;

create index if not exists customer_documents_company_customer_created_idx
  on public.customer_documents(company_id, customer_id, created_at desc);
create index if not exists customer_documents_company_contract_idx
  on public.customer_documents(company_id, contract_id, created_at desc)
  where contract_id is not null;

alter table if exists public.communication_logs
  add column if not exists template_id uuid,
  add column if not exists template_version text,
  add column if not exists sender text,
  add column if not exists recipient text,
  add column if not exists error_reason text,
  add column if not exists blocked_at timestamptz,
  add column if not exists skipped_at timestamptz;

do $$
begin
  if to_regclass('public.communication_logs') is not null then
    alter table public.communication_logs drop constraint if exists communication_logs_status_check;
    alter table public.communication_logs
      add constraint communication_logs_status_check
      check (status in ('queued','sent','delivered','bounced','complained','failed','cancelled','blocked','skipped'));
  end if;
end $$;

update public.communication_logs
set sender = coalesce(sender, sender_email),
    recipient = coalesce(recipient, recipient_email),
    error_reason = coalesce(error_reason, error_message)
where sender is null or recipient is null or error_reason is null;

create index if not exists communication_logs_company_contract_created_idx
  on public.communication_logs(company_id, contract_id, created_at desc)
  where contract_id is not null;

alter table if exists public.customer_internal_notes
  add column if not exists note text,
  add column if not exists visibility text not null default 'internal',
  add column if not exists created_by_user_id uuid;

update public.customer_internal_notes
set note = coalesce(note, body),
    created_by_user_id = coalesce(created_by_user_id, created_by)
where note is null or created_by_user_id is null;

create index if not exists customer_internal_notes_company_customer_created_idx
  on public.customer_internal_notes(company_id, customer_id, created_at desc);

-- -----------------------------------------------------------------------------
-- 4. Readiness views: customer, timeline, tenant website readiness
-- -----------------------------------------------------------------------------
create or replace view public.customer_ops_master_readiness_v as
select
  c.company_id,
  c.id as customer_id,
  c.customer_number,
  c.status as customer_status,
  exists (
    select 1 from public.customer_legal_acceptances a
    where a.company_id = c.company_id and a.customer_id = c.id and a.acceptance_type = 'terms'
  ) as has_terms_acceptance,
  exists (
    select 1 from public.customer_legal_acceptances a
    where a.company_id = c.company_id and a.customer_id = c.id and a.acceptance_type = 'privacy_policy'
  ) as has_privacy_acceptance,
  exists (
    select 1 from public.customer_legal_acceptances a
    where a.company_id = c.company_id and a.customer_id = c.id and a.acceptance_type = 'withdrawal_info'
  ) as has_withdrawal_acceptance,
  exists (
    select 1 from public.customer_legal_acceptances a
    where a.company_id = c.company_id and a.customer_id = c.id and a.acceptance_type = 'price_snapshot'
  ) as has_price_snapshot_acceptance,
  exists (
    select 1 from public.customer_legal_acceptances a
    where a.company_id = c.company_id and a.customer_id = c.id and a.acceptance_type = 'power_of_attorney'
  ) as has_power_of_attorney_acceptance,
  exists (
    select 1 from public.powers_of_attorney p
    where p.company_id = c.company_id
      and p.customer_id = c.id
      and p.status in ('signed','accepted','active','completed')
      and coalesce(p.revoked_at, p.valid_until::timestamptz + interval '1 day', p.valid_to::timestamptz + interval '1 day', now() + interval '1 day') > now()
      and (
        p.scope in ('facility_data_request','metering_point_lookup','supplier_switch','metering_values','ediel_communication')
        or p.scope_summary ?| array['facility_data_request','metering_point_lookup','supplier_switch','metering_values','ediel_communication']
      )
  ) as has_active_power_of_attorney,
  exists (
    select 1 from public.customer_contracts cc
    where cc.company_id = c.company_id
      and cc.customer_id = c.id
      and cc.status in ('pending_signature','signed','active','draft')
  ) as has_contract,
  exists (
    select 1 from public.customer_contracts cc
    left join public.contract_price_snapshots cps on cps.id = cc.contract_price_snapshot_id and cps.company_id = cc.company_id
    where cc.company_id = c.company_id
      and cc.customer_id = c.id
      and (
        cc.contract_price_snapshot_id is not null
        or cps.id is not null
        or coalesce(cc.price_snapshot, '{}'::jsonb) <> '{}'::jsonb
        or coalesce(cc.version_snapshot, '{}'::jsonb) <> '{}'::jsonb
      )
  ) as has_contract_snapshot,
  exists (
    select 1 from public.customer_sites s
    where s.company_id = c.company_id and s.customer_id = c.id and s.status in ('active','pending_validation','draft')
  ) as has_site,
  exists (
    select 1 from public.customer_sites s
    join public.metering_points mp on mp.site_id = s.id and mp.company_id = s.company_id
    where s.company_id = c.company_id
      and s.customer_id = c.id
      and nullif(coalesce(mp.meter_point_id, mp.metering_point_id, mp.ediel_metering_point_id), '') is not null
  ) as has_metering_point_id,
  exists (
    select 1 from public.customer_sites s
    where s.company_id = c.company_id and s.customer_id = c.id and s.grid_owner_id is not null
  ) as has_grid_owner,
  exists (
    select 1 from public.customer_sites s
    where s.company_id = c.company_id and s.customer_id = c.id and nullif(coalesce(s.grid_area_code, ''), '') is not null
  ) as has_grid_area,
  exists (
    select 1 from public.communication_routes r
    left join public.ediel_route_profiles rp on rp.communication_route_id = r.id and rp.company_id = r.company_id
    where r.company_id = c.company_id
      and r.is_active = true
      and coalesce(r.route_scope, '') in ('supplier_switch','customer_masterdata','meter_values','billing_underlay','facility_data_request','customer_data_request','ediel_partner','billing_metering')
      and coalesce(rp.is_enabled, true) = true
  ) as has_ediel_route,
  array_remove(array[
    case when not exists (select 1 from public.customer_legal_acceptances a where a.company_id = c.company_id and a.customer_id = c.id and a.acceptance_type = 'terms') then 'Villkor saknas' end,
    case when not exists (select 1 from public.customer_legal_acceptances a where a.company_id = c.company_id and a.customer_id = c.id and a.acceptance_type = 'privacy_policy') then 'Integritetspolicy saknas' end,
    case when not exists (select 1 from public.customer_legal_acceptances a where a.company_id = c.company_id and a.customer_id = c.id and a.acceptance_type = 'withdrawal_info') then 'Ångerrättsinformation saknas' end,
    case when not exists (select 1 from public.customer_legal_acceptances a where a.company_id = c.company_id and a.customer_id = c.id and a.acceptance_type = 'price_snapshot') then 'Prissnapshot/godkänd prisbild saknas' end,
    case when not exists (select 1 from public.powers_of_attorney p where p.company_id = c.company_id and p.customer_id = c.id and p.status in ('signed','accepted','active','completed') and coalesce(p.revoked_at, p.valid_until::timestamptz + interval '1 day', p.valid_to::timestamptz + interval '1 day', now() + interval '1 day') > now()) then 'Aktiv fullmakt saknas' end,
    case when not exists (select 1 from public.customer_contracts cc where cc.company_id = c.company_id and cc.customer_id = c.id) then 'Kundavtal saknas' end,
    case when not exists (select 1 from public.customer_sites s where s.company_id = c.company_id and s.customer_id = c.id) then 'Anläggning saknas' end,
    case when not exists (select 1 from public.customer_sites s join public.metering_points mp on mp.site_id = s.id and mp.company_id = s.company_id where s.company_id = c.company_id and s.customer_id = c.id and nullif(coalesce(mp.meter_point_id, mp.metering_point_id, mp.ediel_metering_point_id), '') is not null) then 'Mätpunkts-ID saknas' end,
    case when not exists (select 1 from public.customer_sites s where s.company_id = c.company_id and s.customer_id = c.id and s.grid_owner_id is not null) then 'Nätägare saknas' end,
    case when not exists (select 1 from public.customer_sites s where s.company_id = c.company_id and s.customer_id = c.id and nullif(coalesce(s.grid_area_code, ''), '') is not null) then 'Nätområde saknas' end,
    case when not exists (select 1 from public.communication_routes r where r.company_id = c.company_id and r.is_active = true) then 'Ediel-route saknas' end
  ], null) as blocking_reasons,
  now() as evaluated_at
from public.customers c
where c.company_id is not null;

create or replace view public.customer_ops_timeline_v as
select
  e.company_id,
  e.subject_customer_id as customer_id,
  e.created_at,
  e.event_type,
  case e.event_type
    when 'customer.created' then 'Ansökan mottagen'
    when 'customer_number.assigned' then 'Kundnummer skapat'
    when 'contract.application_received' then 'Ansökan mottagen'
    when 'contract.confirmation_sent' then 'Avtalsbekräftelse skickad'
    when 'contract.cooling_off_sent' then 'Ångerrättsinformation skickad'
    when 'invoice.sent' then 'Faktura skickad'
    when 'metering_values.updated' then 'Mätvärden uppdaterade'
    else replace(e.event_type, '.', ' ')
  end as title,
  'domain_event'::text as source,
  e.id as source_id,
  e.payload as metadata
from public.domain_events e
where e.subject_customer_id is not null
union all
select
  l.company_id,
  l.customer_id,
  l.created_at,
  coalesce(l.event_key, l.template_key, 'email') as event_type,
  case coalesce(l.event_key, l.template_key, 'email')
    when 'contract.application_received' then 'Ansökan mottagen-mail skickat'
    when 'contract.confirmation_sent' then 'Avtalsbekräftelse skickad'
    when 'contract.cooling_off_sent' then 'Ångerrättsinformation skickad'
    else 'Kundmail: ' || coalesce(l.event_key, l.template_key, 'e-post')
  end as title,
  'communication_log'::text as source,
  l.id as source_id,
  jsonb_build_object('status', l.status, 'recipient', coalesce(l.recipient, l.recipient_email), 'subject', l.subject, 'error', coalesce(l.error_reason, l.error_message)) as metadata
from public.communication_logs l
where l.customer_id is not null
union all
select
  a.company_id,
  a.customer_id,
  a.accepted_at as created_at,
  a.acceptance_type as event_type,
  case a.acceptance_type
    when 'terms' then 'Villkor godkända'
    when 'privacy_policy' then 'Integritetspolicy godkänd'
    when 'withdrawal_info' then 'Ångerrättsinformation lämnad'
    when 'power_of_attorney' then 'Fullmakt godkänd'
    when 'price_snapshot' then 'Prisbild godkänd'
    else 'Juridiskt godkännande'
  end as title,
  'customer_legal_acceptance'::text as source,
  a.id as source_id,
  jsonb_build_object('source', a.source, 'legal_text_version_id', a.legal_text_version_id) || coalesce(a.metadata, '{}'::jsonb) as metadata
from public.customer_legal_acceptances a;

create or replace view public.tenant_website_readiness_v as
select
  c.id as company_id,
  c.name as company_name,
  exists (
    select 1 from public.integration_api_clients i
    where i.company_id = c.id and i.status = 'active' and i.scopes @> array['website_contracts.read','website_applications.write']::text[]
  ) as has_api_client,
  exists (
    select 1 from public.integration_api_clients i
    where i.company_id = c.id and i.status = 'active' and coalesce(array_length(i.allowed_origins, 1), 0) > 0
  ) as has_allowed_origin,
  exists (
    select 1 from public.price_plan_versions ppv
    join public.price_plans pp on pp.id = ppv.price_plan_id and pp.company_id = ppv.company_id
    where ppv.company_id = c.id
      and ppv.status in ('active','published')
      and coalesce(ppv.snapshot_json ->> 'website_visible', ppv.snapshot_json ->> 'is_public', 'false') in ('true','1')
  ) as has_public_contracts,
  exists (select 1 from public.legal_text_versions l where l.company_id = c.id and l.type = 'terms' and l.status = 'published') as has_terms,
  exists (select 1 from public.legal_text_versions l where l.company_id = c.id and l.type = 'privacy_policy' and l.status = 'published') as has_privacy_policy,
  exists (select 1 from public.legal_text_versions l where l.company_id = c.id and l.type = 'withdrawal' and l.status = 'published') as has_withdrawal,
  exists (select 1 from public.legal_text_versions l where l.company_id = c.id and l.type = 'power_of_attorney' and l.status = 'published') as has_power_of_attorney_text,
  exists (select 1 from public.legal_text_versions l where l.company_id = c.id and l.type = 'price_terms' and l.status = 'published') as has_price_terms,
  exists (
    select 1 from public.company_email_settings s
    where s.company_id = c.id and coalesce(s.verification_status, '') in ('verified','completed')
  ) as has_verified_sender,
  exists (
    select 1 from public.company_email_templates t
    where t.company_id = c.id and t.is_active = true
  ) as has_mail_templates,
  array_remove(array[
    case when not exists (select 1 from public.integration_api_clients i where i.company_id = c.id and i.status = 'active' and i.scopes @> array['website_contracts.read','website_applications.write']::text[]) then 'API-klient för hemsida/Mina sidor saknas' end,
    case when not exists (select 1 from public.integration_api_clients i where i.company_id = c.id and i.status = 'active' and coalesce(array_length(i.allowed_origins, 1), 0) > 0) then 'Tillåten hemsidedomän/origin saknas' end,
    case when not exists (select 1 from public.price_plan_versions ppv join public.price_plans pp on pp.id = ppv.price_plan_id and pp.company_id = ppv.company_id where ppv.company_id = c.id and ppv.status in ('active','published') and coalesce(ppv.snapshot_json ->> 'website_visible', ppv.snapshot_json ->> 'is_public', 'false') in ('true','1')) then 'Publicerade avtal saknas' end,
    case when not exists (select 1 from public.legal_text_versions l where l.company_id = c.id and l.type = 'terms' and l.status = 'published') then 'Allmänna villkor saknas' end,
    case when not exists (select 1 from public.legal_text_versions l where l.company_id = c.id and l.type = 'privacy_policy' and l.status = 'published') then 'Integritetspolicy saknas' end,
    case when not exists (select 1 from public.legal_text_versions l where l.company_id = c.id and l.type = 'withdrawal' and l.status = 'published') then 'Ångerrättstext saknas' end,
    case when not exists (select 1 from public.legal_text_versions l where l.company_id = c.id and l.type = 'power_of_attorney' and l.status = 'published') then 'Fullmaktstext saknas' end,
    case when not exists (select 1 from public.legal_text_versions l where l.company_id = c.id and l.type = 'price_terms' and l.status = 'published') then 'Prisvillkor saknas' end,
    case when not exists (select 1 from public.company_email_templates t where t.company_id = c.id and t.is_active = true) then 'Aktiva mailmallar saknas' end
  ], null) as missing_items,
  now() as evaluated_at
from public.companies c;

-- -----------------------------------------------------------------------------
-- 5. Helper RPC: create or keep a customer operation task for a blocker
-- -----------------------------------------------------------------------------
create or replace function public.gridex_upsert_customer_action_task(
  p_company_id uuid,
  p_customer_id uuid,
  p_task_type text,
  p_title text,
  p_description text default null,
  p_priority text default 'normal',
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task_id uuid;
begin
  if p_company_id is null or p_customer_id is null or nullif(btrim(coalesce(p_task_type, '')), '') is null then
    raise exception 'company_id, customer_id and task_type are required';
  end if;

  select id into v_task_id
  from public.customer_operation_tasks
  where company_id = p_company_id
    and customer_id = p_customer_id
    and task_type = p_task_type
    and status in ('open','in_progress','blocked')
  order by created_at desc
  limit 1;

  if v_task_id is null then
    insert into public.customer_operation_tasks(company_id, customer_id, task_type, status, priority, title, description, metadata)
    values (p_company_id, p_customer_id, p_task_type, 'open', coalesce(p_priority, 'normal'), p_title, p_description, coalesce(p_metadata, '{}'::jsonb))
    returning id into v_task_id;
  else
    update public.customer_operation_tasks
    set title = p_title,
        description = p_description,
        priority = coalesce(p_priority, priority),
        metadata = coalesce(p_metadata, '{}'::jsonb),
        updated_at = now()
    where id = v_task_id;
  end if;

  return v_task_id;
end $$;

comment on table public.legal_text_versions is 'Tenant-scoped legal master texts. Published content is immutable; create a new version for every change.';
comment on table public.customer_legal_acceptances is 'Immutable customer acceptance snapshots for terms, privacy, withdrawal info, price snapshot and power of attorney.';
comment on view public.customer_ops_master_readiness_v is 'Plain-language customer readiness for supplier switch, facility data request and OPS master status.';
comment on view public.tenant_website_readiness_v is 'Plain-language tenant readiness for website contracts, applications, legal texts and mail setup.';
