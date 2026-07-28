-- Live schema/code canonical synchronization.
--
-- Source of truth for this repair:
--   gridex-live-audit-2026-07-28.zip (active pg_get_functiondef/schema/lint)
--   gridex-ops-platform-main(93).zip
--
-- Forward-only and fail-closed. The migration takes one transaction-scoped
-- advisory lock and aborts if an expected live definition is neither the
-- audited definition nor the already-repaired definition.

begin;

set local lock_timeout = '15s';
set local statement_timeout = '5min';
select pg_advisory_xact_lock(hashtextextended('gridex:live-schema-code-sync:20260728170000', 0));

do $$
begin
  if to_regnamespace('extensions') is null
     or to_regprocedure('extensions.digest(text,text)') is null
     or to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception using
      errcode = '55000',
      message = 'gridex_repair_requires_pgcrypto_in_extensions';
  end if;
end
$$;

-- Exact-definition patch helper. It makes this migration safe against both the
-- audited live definition and an idempotent re-run of an already patched body.
create or replace function public.gridex__repair_replace_function_text(
  p_signature text,
  p_old text,
  p_new text
) returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_oid regprocedure;
  v_definition text;
begin
  v_oid := to_regprocedure(p_signature);
  if v_oid is null then
    raise exception using
      errcode = '55000',
      message = 'gridex_repair_function_missing:' || p_signature;
  end if;
  v_definition := pg_get_functiondef(v_oid);
  if strpos(v_definition, p_old) > 0 then
    execute replace(v_definition, p_old, p_new);
  elsif strpos(v_definition, p_new) = 0 then
    raise exception using
      errcode = '55000',
      message = 'gridex_repair_unexpected_function_definition:' || p_signature,
      detail = p_old;
  end if;
end
$$;

revoke all on function public.gridex__repair_replace_function_text(text,text,text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Missing live table used by tenant activation readiness.
-- This removes the active gridex_tenant_activation_readiness relation error.
-- ---------------------------------------------------------------------------

create table if not exists public.company_onboarding_tasks (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  task_key text not null,
  title text not null,
  category text not null,
  environment text null,
  status text not null default 'pending',
  blocker_reason text null,
  next_required_action text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_onboarding_tasks_status_check
    check (status in ('pending','in_progress','blocked','complete','skipped'))
);

create unique index if not exists company_onboarding_tasks_company_key_uidx
  on public.company_onboarding_tasks(company_id, task_key);
create index if not exists company_onboarding_tasks_company_status_idx
  on public.company_onboarding_tasks(company_id, status);

alter table public.company_onboarding_tasks enable row level security;

drop policy if exists company_onboarding_tasks_service_role_all
  on public.company_onboarding_tasks;
create policy company_onboarding_tasks_service_role_all
  on public.company_onboarding_tasks
  for all to service_role
  using (true) with check (true);

drop policy if exists company_onboarding_tasks_tenant_read
  on public.company_onboarding_tasks;
create policy company_onboarding_tasks_tenant_read
  on public.company_onboarding_tasks
  for select to authenticated
  using (
    public.gridex_user_is_platform_admin()
    or public.gridex_can_read_company(company_id)
  );

revoke all on table public.company_onboarding_tasks
  from public, anon;
grant select on table public.company_onboarding_tasks
  to authenticated;
grant select, insert, update, delete on table public.company_onboarding_tasks
  to service_role;

create or replace function public.gridex_seed_company_onboarding_tasks(
  p_company_id uuid
) returns void
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
begin
  if p_company_id is null
     or not exists (select 1 from public.companies where id = p_company_id) then
    raise exception using
      errcode = '22023',
      message = 'valid_company_id_required';
  end if;

  insert into public.company_onboarding_tasks(
    company_id, task_key, title, category, environment, next_required_action
  ) values
    (p_company_id,'test_ediel_actor_settings','Test: Ediel-aktörsinställningar','ediel','test','Lägg in test-Ediel-aktör (Ediel-ID, roll, subadress).'),
    (p_company_id,'production_ediel_actor_settings','Produktion: Ediel-aktörsinställningar','ediel','production','Lägg in produktions-Ediel-aktör och verifiera.'),
    (p_company_id,'brp_settings','BRP / balansansvarig','brp',null,'Konfigurera balansansvarig (BRP) för bolaget.'),
    (p_company_id,'shared_mailbox_transport','Delad mailbox / transport','transport',null,'Koppla delad mailbox och transport för Ediel.'),
    (p_company_id,'production_certificate','Produktion: certifikat/säkerhet','certificate','production','Lägg in och verifiera produktionscertifikat där det krävs.'),
    (p_company_id,'test_route_readiness','Test: operativa routes','route','test','Materialisera operativa test-routes för nätägare.'),
    (p_company_id,'production_route_readiness','Produktion: operativa routes','route','production','Materialisera operativa produktions-routes för nätägare.'),
    (p_company_id,'legal_default_package','Juridik / standardpaket','legal',null,'Publicera juridiska standardtexter eller skapa arbetsuppgift.'),
    (p_company_id,'api_client_scopes','API-klient & scopes','api',null,'Skapa API-klient med rätt scopes för integrationer.'),
    (p_company_id,'website_portal_integration','Webbplats / kundportal-integration','website',null,'Koppla webbplats/kundportal-integration.'),
    (p_company_id,'customer_automation_readiness','Kundautomation redo','automation',null,'Kräver produktions-route och produktionsgodkännande innan automation.')
  on conflict (company_id, task_key) do nothing;
end
$$;

revoke all on function public.gridex_seed_company_onboarding_tasks(uuid)
  from public, anon, authenticated;
grant execute on function public.gridex_seed_company_onboarding_tasks(uuid)
  to service_role;

do $$
declare
  v_company record;
begin
  for v_company in select id from public.companies loop
    perform public.gridex_seed_company_onboarding_tasks(v_company.id);
  end loop;
end
$$;

-- The Resend webhook runtime persists every verified provider event here.
-- This table exists in repository history but was absent from the live schema.
create table if not exists public.communication_log_events (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  communication_log_id uuid
    references public.communication_logs(id) on delete set null,
  provider text not null default 'resend',
  provider_message_id text null,
  provider_event_id text null,
  event_type text not null,
  event_payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists
  communication_log_events_provider_event_uidx
  on public.communication_log_events(provider, provider_event_id)
  where provider_event_id is not null;
create index if not exists communication_log_events_company_occurred_idx
  on public.communication_log_events(company_id, occurred_at desc);
create index if not exists communication_log_events_log_occurred_idx
  on public.communication_log_events(communication_log_id, occurred_at desc);
create index if not exists communication_log_events_provider_message_idx
  on public.communication_log_events(provider, provider_message_id);
create index if not exists communication_log_events_event_type_idx
  on public.communication_log_events(event_type, occurred_at desc);

alter table public.communication_log_events enable row level security;
drop policy if exists communication_log_events_service_role_all
  on public.communication_log_events;
create policy communication_log_events_service_role_all
  on public.communication_log_events
  for all to service_role
  using (true) with check (true);
drop policy if exists communication_log_events_tenant_read
  on public.communication_log_events;
create policy communication_log_events_tenant_read
  on public.communication_log_events
  for select to authenticated
  using (
    public.gridex_user_is_platform_admin()
    or (
      company_id is not null
      and public.gridex_can_read_company(company_id)
    )
  );

revoke all on table public.communication_log_events from public, anon;
grant select on table public.communication_log_events to authenticated;
grant select, insert, update, delete on table public.communication_log_events
  to service_role;

-- ---------------------------------------------------------------------------
-- Invoice graph: align the live table with the runtime and the core command.
-- ---------------------------------------------------------------------------

alter table public.customer_invoices
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.customer_invoices
  drop constraint if exists customer_invoices_status_check;
alter table public.customer_invoices
  add constraint customer_invoices_status_check check (
    status in (
      'draft','issued','sent','paid','overdue','cancelled','credited','failed'
    )
  );

-- The older live table predates the canonical invoice-line VAT columns even
-- though repository migrations and the customer API already use them.
alter table public.customer_invoice_lines
  add column if not exists vat_amount numeric(14,2),
  add column if not exists amount_inc_vat numeric(14,2);

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

-- Provider webhook runtime and its tenant-scoped idempotency keys require the
-- environment and connection evidence that the live tables never received.
alter table public.invoice_provider_events
  add column if not exists environment text;

alter table public.billing_provider_webhook_events
  add column if not exists environment text,
  add column if not exists billing_provider_connection_id uuid,
  add column if not exists signature_timestamp timestamptz;

update public.invoice_provider_events event
set environment = export_item.environment
from public.invoice_export_items export_item
where event.environment is null
  and event.matched_invoice_export_item_id = export_item.id;

update public.invoice_provider_events
set status = 'dead_letter',
    failure_reason = coalesce(
      failure_reason,
      'environment_missing_in_pre_canonical_provider_event'
    )
where environment is null
  and status in ('received','processing','needs_review','failed');

update public.billing_provider_webhook_events
set status = 'needs_review',
    processing_result = coalesce(processing_result, '{}'::jsonb)
      || jsonb_build_object(
        'blocker', 'environment_missing_in_pre_canonical_webhook'
      )
where environment is null
  and status = 'received';

alter table public.invoice_provider_events
  drop constraint if exists invoice_provider_events_environment_check;
alter table public.invoice_provider_events
  add constraint invoice_provider_events_environment_check
  check (environment is null or environment in ('test','production'));

alter table public.billing_provider_webhook_events
  drop constraint if exists billing_provider_webhook_events_environment_check;
alter table public.billing_provider_webhook_events
  add constraint billing_provider_webhook_events_environment_check
  check (environment is null or environment in ('test','production'));

alter table public.billing_provider_webhook_events
  drop constraint if exists billing_provider_webhook_events_connection_fkey;
alter table public.billing_provider_webhook_events
  add constraint billing_provider_webhook_events_connection_fkey
  foreign key (billing_provider_connection_id)
  references public.billing_provider_connections(id) on delete restrict;

drop index if exists
  public.billing_provider_webhook_events_provider_idempotency_uidx;
create unique index
  billing_provider_webhook_events_provider_idempotency_uidx
  on public.billing_provider_webhook_events(
    company_id, provider, environment, idempotency_key
  );

drop index if exists public.invoice_provider_events_provider_idempotency_uidx;
create unique index invoice_provider_events_provider_idempotency_uidx
  on public.invoice_provider_events(
    company_id, provider, environment, idempotency_hash
  );

select public.gridex__repair_replace_function_text(
  'public.gridex_create_invoice_export_graph_v1_core(jsonb,jsonb,jsonb)',
  'billing_underlay_id,partner_export_id,invoice_export_item_id,',
  'billing_underlay_id,partner_export_id,partner_invoice_reference,invoice_export_item_id,'
);
select public.gridex__repair_replace_function_text(
  'public.gridex_create_invoice_export_graph_v1_core(jsonb,jsonb,jsonb)',
  'v_underlay.id,v_export_item_id,v_export_item_id,v_export_item_id,',
  $$v_underlay.id,v_export_item_id,
      coalesce(
        nullif(v_invoice->>'partner_invoice_reference',''),
        'pending:' || v_export_item_id::text
      ),
      v_export_item_id,v_export_item_id,$$
);

-- ---------------------------------------------------------------------------
-- pgcrypto resolution and immutable energy direction propagation.
-- ---------------------------------------------------------------------------

alter function public.gridex_sync_public_offer_to_canonical(uuid)
  set search_path = public, extensions, pg_catalog, pg_temp;
alter function public.gridex_sync_internal_offer_to_canonical(uuid)
  set search_path = public, extensions, pg_catalog, pg_temp;
alter function public.gridex_onboard_customer_graph_core(jsonb)
  set search_path = public, extensions, pg_catalog, pg_temp;

select public.gridex__repair_replace_function_text(
  'public.gridex_sync_internal_offer_to_canonical(uuid)',
  $$'contract_type',o.contract_type,
    'price_plan_id'$$,
  $$'contract_type',o.contract_type,
    'energy_direction',coalesce(nullif(lower(o.energy_direction),''),'consumption'),
    'price_plan_id'$$
);
select public.gridex__repair_replace_function_text(
  'public.gridex_sync_internal_offer_to_canonical(uuid)',
  'contract_product_id,version_number,customer_type,contract_type,pricing_model,',
  'contract_product_id,version_number,customer_type,contract_type,energy_direction,pricing_model,'
);
select public.gridex__repair_replace_function_text(
  'public.gridex_sync_internal_offer_to_canonical(uuid)',
  $$v_product_id,v_number,o.customer_type,o.contract_type,
      coalesce(v_snapshot->>'pricing_model',o.contract_type)$$,
  $$v_product_id,v_number,o.customer_type,o.contract_type,
      coalesce(nullif(lower(o.energy_direction),''),'consumption'),
      coalesce(v_snapshot->>'pricing_model',o.contract_type)$$
);

select public.gridex__repair_replace_function_text(
  'public.gridex_sync_public_offer_to_canonical(uuid)',
  $$'contract_type',o.contract_type,'billing_model'$$,
  $$'contract_type',o.contract_type,'energy_direction',coalesce(nullif(lower(o.energy_direction),''),'consumption'),'billing_model'$$
);
select public.gridex__repair_replace_function_text(
  'public.gridex_sync_public_offer_to_canonical(uuid)',
  'contract_product_id,version_number,customer_type,contract_type,pricing_model,',
  'contract_product_id,version_number,customer_type,contract_type,energy_direction,pricing_model,'
);
select public.gridex__repair_replace_function_text(
  'public.gridex_sync_public_offer_to_canonical(uuid)',
  'v_product_id,v_number,o.customer_type,o.contract_type,coalesce(',
  $$v_product_id,v_number,o.customer_type,o.contract_type,
      coalesce(nullif(lower(o.energy_direction),''),'consumption'),coalesce($$
);
select public.gridex__repair_replace_function_text(
  'public.gridex_sync_public_offer_to_canonical(uuid)',
  $$'price_book_id',o.price_book_id,'customer_type'$$,
  $$'price_book_id',o.price_book_id,'energy_direction',coalesce(nullif(lower(o.energy_direction),''),'consumption'),'customer_type'$$
);
select public.gridex__repair_replace_function_text(
  'public.gridex_sync_public_offer_to_canonical(uuid)',
  'legacy_public_contract_offer_id,customer_type,channel,valid_from,valid_to,publication_snapshot,',
  'legacy_public_contract_offer_id,customer_type,energy_direction,channel,valid_from,valid_to,publication_snapshot,'
);
select public.gridex__repair_replace_function_text(
  'public.gridex_sync_public_offer_to_canonical(uuid)',
  $$v_legal_version_id,o.id,o.customer_type,'website',$$,
  $$v_legal_version_id,o.id,o.customer_type,
      coalesce(nullif(lower(o.energy_direction),''),'consumption'),'website',$$
);

-- Date columns are inclusive. Timestamp channel/publication windows use the
-- exclusive start of the following day.
select public.gridex__repair_replace_function_text(
  'public.gridex_sync_public_offer_to_canonical(uuid)',
  'o.valid_from::timestamptz,o.valid_to::timestamptz',
  $$o.valid_from::timestamptz,
    case when o.valid_to is null then null else (o.valid_to + 1)::timestamptz end$$
);
select public.gridex__repair_replace_function_text(
  'public.gridex_sync_internal_offer_to_canonical(uuid)',
  'o.valid_from::timestamptz,o.valid_to::timestamptz',
  $$o.valid_from::timestamptz,
    case when o.valid_to is null then null else (o.valid_to + 1)::timestamptz end$$
);

-- ---------------------------------------------------------------------------
-- Canonical public view and publication integrity.
-- Existing columns keep their exact order; live columns are appended explicitly.
-- ---------------------------------------------------------------------------

create or replace view public.canonical_public_contract_offers_v
with (security_invoker = true) as
select
  pco.id,
  pco.company_id,
  pco.price_plan_id,
  pco.price_plan_version_id,
  pco.campaign_version_id,
  pco.product_code,
  pco.public_name,
  pco.public_description,
  pco.contract_type,
  pco.billing_model,
  pco.customer_type,
  pco.monthly_fee_sek,
  pco.invoice_fee_sek,
  pco.markup_ore_per_kwh,
  pco.spot_markup_ore_per_kwh,
  pco.variable_fee_ore_per_kwh,
  pco.fixed_price_ore_per_kwh,
  pco.green_fee_mode,
  pco.green_fee_value,
  pco.terms_version,
  pco.valid_from,
  pco.valid_to,
  pco.is_public,
  pco.is_archived,
  pco.sort_order,
  pco.metadata,
  pco.created_by,
  pco.updated_by,
  pco.created_at,
  pco.updated_at,
  pco.offer_code,
  pco.publication_status,
  pco.website_enabled,
  pco.website_cta_enabled,
  pco.public_price_text,
  pco.terms_url,
  pco.binding_months,
  pco.notice_months,
  pco.spot_weight_percent,
  pco.portfolio_weight_percent,
  pco.fixed_weight_percent,
  pco.price_area,
  pco.published_at,
  pco.archived_at,
  pco.readiness_issues,
  pco.publication_notes,
  pco.legal_bundle_id,
  pco.price_book_id,
  pco.readiness_status,
  pco.readiness_blockers,
  pco.electricity_certificate_ore_per_kwh,
  pco.start_fee_sek,
  pco.administration_fee_sek,
  pco.break_fee_sek,
  pco.portfolio_management_fee_ore_per_kwh,
  pco.discount_value,
  pco.discount_unit,
  pco.discount_months,
  pco.vat_rate,
  pco.price_areas,
  pco.automatic_renewal,
  pco.power_of_attorney_required,
  pco.version_series_id,
  pco.version_number,
  pco.supersedes_offer_id,
  pco.contract_product_id,
  pco.contract_product_version_id,
  pco.legal_bundle_version_id,
  pco.contract_publication_version_id,
  cpv.offer_reference as canonical_offer_reference,
  cpv.locked_at as publication_locked_at,
  cpv.content_sha256 as publication_content_sha256,
  ppv.snapshot_json as canonical_pricing_snapshot,
  coalesce(pco.metadata, '{}'::jsonb) || jsonb_build_object(
    'contract_publication_version_id', cpv.id,
    'contract_product_version_id', cpv.contract_product_version_id,
    'contract_product_id', pco.contract_product_id,
    'legal_bundle_version_id', cpv.legal_bundle_version_id,
    'canonical_offer_reference', cpv.offer_reference,
    'publication_content_sha256', cpv.content_sha256,
    'pricing_snapshot', ppv.snapshot_json,
    'source_of_truth', 'contract_publication_versions'
  ) as canonical_metadata,
  pco.source_contract_offer_id,
  pco.lifecycle_status,
  pco.closed_at,
  pco.closed_by,
  pco.close_reason,
  coalesce(
    nullif(lower(pco.energy_direction), ''),
    nullif(lower(cpv.energy_direction), ''),
    'consumption'
  ) as energy_direction
from public.public_contract_offers pco
join public.contract_publication_versions cpv
  on cpv.id = pco.contract_publication_version_id
 and cpv.status = 'published'
 and cpv.locked_at is not null
join public.price_plan_versions ppv
  on ppv.id = cpv.price_plan_version_id
 and ppv.locked_at is not null
where pco.publication_status = 'published'
  and pco.website_enabled
  and not pco.is_archived;

create or replace view public.contract_publication_graph_integrity_v
with (security_invoker = true) as
select
  po.company_id,
  po.id as public_contract_offer_id,
  po.source_contract_offer_id,
  po.contract_product_version_id as public_offer_product_version_id,
  po.contract_publication_version_id as canonical_publication_version_id,
  cpv.id as publication_version_id,
  cpv.contract_product_version_id as publication_product_version_id,
  cpv.legacy_public_contract_offer_id,
  cp.channel,
  ta.company_id as publication_company_id,
  (
    po.contract_publication_version_id is not null
    and cpv.id = po.contract_publication_version_id
  ) as forward_publication_link_valid,
  (cpv.legacy_public_contract_offer_id = po.id) as reverse_legacy_link_valid,
  (ta.company_id = po.company_id) as company_chain_valid,
  (
    ta.contract_product_version_id = cpv.contract_product_version_id
  ) as tenant_assignment_valid,
  (cp.channel = 'website' and cpv.channel = 'website') as channel_valid,
  (
    cpv.contract_product_version_id = po.contract_product_version_id
  ) as product_version_valid,
  (
    cpv.publication_snapshot->>'source_contract_offer_id'
      = po.source_contract_offer_id::text
  ) as source_offer_consistent,
  (cp.status = 'published' and cpv.status = 'published') as publication_active,
  (
    po.contract_publication_version_id is not null
    and cpv.id = po.contract_publication_version_id
    and cpv.legacy_public_contract_offer_id = po.id
    and ta.company_id = po.company_id
    and ta.contract_product_version_id = cpv.contract_product_version_id
    and cp.channel = 'website'
    and cpv.channel = 'website'
    and cpv.contract_product_version_id = po.contract_product_version_id
    and cpv.publication_snapshot->>'source_contract_offer_id'
      = po.source_contract_offer_id::text
    and cp.status = 'published'
    and cpv.status = 'published'
    and cpv.content_sha256 = encode(
      extensions.digest(cpv.publication_snapshot::text, 'sha256'),
      'hex'
    )
    and coalesce(
      nullif(lower(cpv.publication_snapshot->>'energy_direction'), ''),
      nullif(lower(cpv.energy_direction), ''),
      'consumption'
    ) = coalesce(nullif(lower(po.energy_direction), ''), 'consumption')
    and coalesce(
      nullif(lower(cpv.energy_direction), ''),
      'consumption'
    ) = coalesce(
      nullif(lower(cpv_product.energy_direction), ''),
      'consumption'
    )
    and coalesce(
      nullif(lower(cpv.publication_snapshot->>'contract_type'), ''),
      nullif(lower(cpv_product.contract_type), '')
    ) = lower(po.contract_type)
    and not exists (
      select 1
      from public.contract_offers successor
      where successor.supersedes_offer_id = po.source_contract_offer_id
        and successor.lifecycle_status = 'published'
        and successor.is_active
    )
  ) as canonical_graph_consistent,
  (
    cpv.content_sha256 = encode(
      extensions.digest(cpv.publication_snapshot::text, 'sha256'),
      'hex'
    )
  ) as snapshot_hash_valid,
  (
    coalesce(
      nullif(lower(cpv.publication_snapshot->>'energy_direction'), ''),
      nullif(lower(cpv.energy_direction), ''),
      'consumption'
    ) = coalesce(nullif(lower(po.energy_direction), ''), 'consumption')
    and coalesce(
      nullif(lower(cpv.energy_direction), ''),
      'consumption'
    ) = coalesce(
      nullif(lower(cpv_product.energy_direction), ''),
      'consumption'
    )
  ) as energy_direction_valid,
  (
    coalesce(
      nullif(lower(cpv.publication_snapshot->>'contract_type'), ''),
      nullif(lower(cpv_product.contract_type), '')
    ) = lower(po.contract_type)
  ) as contract_type_valid,
  not exists (
    select 1
    from public.contract_offers successor
    where successor.supersedes_offer_id = po.source_contract_offer_id
      and successor.lifecycle_status = 'published'
      and successor.is_active
  ) as successor_chain_valid
from public.public_contract_offers po
left join public.contract_publication_versions cpv
  on cpv.id = po.contract_publication_version_id
left join public.contract_publications cp
  on cp.id = cpv.contract_publication_id
left join public.tenant_contract_assignments ta
  on ta.id = cp.assignment_id
left join public.contract_product_versions cpv_product
  on cpv_product.id = cpv.contract_product_version_id;

-- ---------------------------------------------------------------------------
-- Website onboarding: exact quote/publication binding, optional site state,
-- inclusive date validity and nullable site persistence.
-- ---------------------------------------------------------------------------

select public.gridex__repair_replace_function_text(
  'public.gridex_onboard_customer_graph(jsonb)',
  $$and (offer.valid_from is null or offer.valid_from <= now())
      and (offer.valid_to is null or offer.valid_to > now())$$,
  $$and (offer.valid_from is null or offer.valid_from <= current_date)
      and (offer.valid_to is null or offer.valid_to >= current_date)$$
);
select public.gridex__repair_replace_function_text(
  'public.gridex_onboard_customer_graph(jsonb)',
  $$if nullif(v_result->>'contract_id', '') is null
     or nullif(v_result->>'site_id', '') is null
     or nullif(v_result->>'application_id', '') is null then$$,
  $$if nullif(v_result->>'contract_id', '') is null
     or nullif(v_result->>'application_id', '') is null then$$
);
select public.gridex__repair_replace_function_text(
  'public.gridex_onboard_customer_graph(jsonb)',
  $$customer_site_id = (v_result->>'site_id')::uuid,$$,
  $$customer_site_id = nullif(v_result->>'site_id', '')::uuid,$$
);

-- External API validity uses the same inclusive calendar-date contract.
select public.gridex__repair_replace_function_text(
  'public.gridex_list_external_api_contracts(uuid,text)',
  $$and (tcc.valid_to is null or tcc.valid_to>=now())
    and (cpv.valid_from is null or cpv.valid_from<=now())
    and (cpv.valid_to is null or cpv.valid_to>=now())$$,
  $$and (tcc.valid_to is null or tcc.valid_to::date>=current_date)
    and (cpv.valid_from is null or cpv.valid_from::date<=current_date)
    and (cpv.valid_to is null or cpv.valid_to::date>=current_date)$$
);

-- ---------------------------------------------------------------------------
-- Repair every active function error reported by the 2026-07-28 live lint.
-- ---------------------------------------------------------------------------

select public.gridex__repair_replace_function_text(
  'public.select_onboarding_start_path(uuid,text)',
  'public.user_can_access_company_v2(p_company_id)',
  'public.gridex_can_write_company(p_company_id)'
);
select public.gridex__repair_replace_function_text(
  'public.complete_core_onboarding(uuid)',
  'public.user_can_access_company_v2(p_company_id)',
  'public.gridex_can_write_company(p_company_id)'
);

select public.gridex__repair_replace_function_text(
  'public.gridex_current_user_context()',
  $$select coalesce(jsonb_agg(distinct company_id), '[]'::jsonb), min(company_id)$$,
  $$select coalesce(jsonb_agg(distinct c.company_id), '[]'::jsonb),
         min(c.company_id::text)::uuid$$
);

select public.gridex__repair_replace_function_text(
  'public.gridex_commit_customer_application_provisioning(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb)',
  $$select id,operation_id into v_workflow_id,v_existing_operation_id
  from public.customer_application_workflows
  where company_id=p_company_id and customer_application_id=p_customer_application_id$$,
  $$select workflow.id,workflow.operation_id
  into v_workflow_id,v_existing_operation_id
  from public.customer_application_workflows workflow
  where workflow.company_id=p_company_id
    and workflow.customer_application_id=p_customer_application_id$$
);

select public.gridex__repair_replace_function_text(
  'public.gridex_transition_customer_application_workflow(uuid,uuid,text,text,text,jsonb,uuid,integer,text)',
  $$update public.customer_application_workflows
  set state=p_to_state,
      next_action=coalesce(p_metadata->>'next_action',next_action),
      snapshot=coalesce(snapshot,'{}'::jsonb) || coalesce(p_metadata,'{}'::jsonb),
      failure_code=case when p_to_state='failed' then coalesce(nullif(btrim(p_reason_code),''),failure_code) else null end,
      completed_at=case when p_to_state in ('completed','cancelled') then now() else null end,
      last_transition_at=now(),
      workflow_version=workflow_version+1,
      updated_at=now()
  where id=v_row.id$$,
  $$update public.customer_application_workflows workflow
  set state=p_to_state,
      next_action=coalesce(p_metadata->>'next_action',workflow.next_action),
      snapshot=coalesce(workflow.snapshot,'{}'::jsonb) || coalesce(p_metadata,'{}'::jsonb),
      failure_code=case when p_to_state='failed' then coalesce(nullif(btrim(p_reason_code),''),workflow.failure_code) else null end,
      completed_at=case when p_to_state in ('completed','cancelled') then now() else null end,
      last_transition_at=now(),
      workflow_version=workflow.workflow_version+1,
      updated_at=now()
  where workflow.id=v_row.id$$
);

select public.gridex__repair_replace_function_text(
  'public.gridex_is_current_session_allowed()',
  $$select user_status, disabled_at
    into v_status, v_disabled_at$$,
  $$select profile.user_status
    into v_status$$
);
select public.gridex__repair_replace_function_text(
  'public.gridex_is_current_session_allowed()',
  'from public.user_profiles',
  'from public.user_profiles profile'
);
select public.gridex__repair_replace_function_text(
  'public.gridex_is_current_session_allowed()',
  $$  if v_disabled_at is not null then
    return false;
  end if;

$$,
  ''
);
-- Remove the declaration only after every reference has been removed. Each
-- helper call executes CREATE OR REPLACE FUNCTION immediately, so this order
-- keeps every intermediate function definition compilable.
select public.gridex__repair_replace_function_text(
  'public.gridex_is_current_session_allowed()',
  $$  v_disabled_at timestamptz;
begin$$,
  $$begin$$
);

select public.gridex__repair_replace_function_text(
  'public.gridex_customer_cleanup_external_ref(uuid)',
  $$and column_name = 'external_customer_id'
  ) then
    execute '
      select external_customer_id::text
      from public.external_contract_intakes
      where customer_id = $1$$,
  $$and column_name = 'external_customer_id'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'external_contract_intakes'
      and column_name = 'created_customer_id'
  ) then
    execute '
      select external_customer_id::text
      from public.external_contract_intakes
      where created_customer_id = $1$$
);

select public.gridex__repair_replace_function_text(
  'public.gridex_run_launch_retention_cleanup(boolean)',
  'from public.gridex_data_retention_policies where data_category=',
  'from public.gridex_data_retention_policies policy where policy.data_category='
);
select public.gridex__repair_replace_function_text(
  'public.gridex_ops_health_checks()',
  $$from public.customer_operation_jobs
    where status in ('queued', 'running', 'waiting_response')$$,
  $$from public.customer_operation_jobs job
    where job.status in ('queued', 'running', 'waiting_response')$$
);
select public.gridex__repair_replace_function_text(
  'public.gridex_ops_health_checks()',
  $$from public.customer_operation_jobs
  where status = 'running'$$,
  $$from public.customer_operation_jobs job
  where job.status = 'running'$$
);
select public.gridex__repair_replace_function_text(
  'public.activate_customer_supply_v1(uuid,uuid,uuid,date,uuid,text)',
  $$select * into v_workflow
  from public.customer_application_workflows
  where company_id = p_company_id
    and customer_id = v_switch.customer_id
    and contract_id = v_contract_id$$,
  $$select workflow.* into v_workflow
  from public.customer_application_workflows workflow
  where workflow.company_id = p_company_id
    and workflow.customer_id = v_switch.customer_id
    and workflow.contract_id = v_contract_id$$
);

-- Four one-time legacy backfills target tables/columns that no longer exist.
-- They are not runtime commands and retaining broken entry points is unsafe.
drop function if exists public.backfill_customer_sites();
drop function if exists public.backfill_contracts();
drop function if exists public.backfill_customers();
drop function if exists public.backfill_metering_points();

create or replace function public.anonymize_user_account(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_catalog, pg_temp
as $$
begin
  if auth.uid() is distinct from target_user_id then
    raise exception using
      errcode = '42501',
      message = 'Can only anonymize your own account';
  end if;

  if exists (
    select 1
    from public.company_memberships membership
    join public.companies company on company.id = membership.company_id
    where membership.user_id = target_user_id
      and coalesce(membership.status, 'active') = 'active'
      and coalesce(
        nullif(lower(membership.membership_role), ''),
        nullif(lower(membership.role), ''),
        nullif(lower(membership.role_key), '')
      ) = 'owner'
      and company.archived_at is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Active companies must be transferred or archived first';
  end if;

  if to_regclass('public.user_preferences') is not null then
    execute 'delete from public.user_preferences where user_id = $1'
      using target_user_id;
  end if;
  delete from public.company_memberships where user_id = target_user_id;
  if to_regclass('public.agency_members') is not null then
    execute 'delete from public.agency_members where user_id = $1'
      using target_user_id;
  end if;
  if to_regclass('public.team_members') is not null then
    execute 'delete from public.team_members where user_id = $1'
      using target_user_id;
  end if;
  if to_regclass('public.bankid_enrichment') is not null then
    execute 'delete from public.bankid_enrichment where user_id = $1'
      using target_user_id;
  end if;
  if to_regclass('public.extension_data') is not null then
    execute
      'delete from public.extension_data where user_id = $1 and key = ''bankid_enrichment'''
      using target_user_id;
  end if;

  update public.user_profiles
  set email = null,
      full_name = null,
      phone = null,
      user_status = 'disabled',
      active_company_id = null,
      updated_at = now()
  where id = target_user_id;
end
$$;

revoke all on function public.anonymize_user_account(uuid)
  from public, anon;
grant execute on function public.anonymize_user_account(uuid)
  to authenticated;

create or replace function public.agent_top_accounts_for_company(
  p_company_id uuid,
  p_limit integer default 20
) returns table(account_number text, abs_amount numeric)
language plpgsql
stable
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_entries regclass := to_regclass('public.journal_entries');
  v_lines regclass := to_regclass('public.journal_entry_lines');
begin
  if v_entries is null
     or v_lines is null
     or not exists (
       select 1
       from pg_attribute
       where attrelid = v_entries
         and attname = 'company_id'
         and not attisdropped
     ) then
    return;
  end if;

  return query execute $sql$
    select
      line.account_number::text,
      sum(abs(
        coalesce(line.debit_amount, 0)
        - coalesce(line.credit_amount, 0)
      ))::numeric
    from public.journal_entry_lines line
    join public.journal_entries entry on entry.id = line.journal_entry_id
    where entry.company_id = $1
      and entry.status = 'posted'
    group by line.account_number
    order by 2 desc, line.account_number
    limit least(greatest(coalesce($2, 20), 1), 100)
  $sql$ using p_company_id, p_limit;
end
$$;

-- The old DB4B helper referenced a removed customer_profiles shadow table.
-- Preserve its canonical customer behavior and report that legacy shadow count
-- as zero instead of keeping a permanently broken function.
create or replace function public.gridex_db4b_archive_customer_registry_row(
  p_lookup text,
  p_email text default null,
  p_apply boolean default false,
  p_reason text default 'Archived old/test customer from active customer registry.'
) returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_catalog, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_customer_count integer := 0;
  v_updated_customers integer := 0;
begin
  if nullif(btrim(coalesce(p_lookup, '')), '') is null
     and nullif(btrim(coalesce(p_email, '')), '') is null then
    raise exception using
      errcode = '22023',
      message = 'p_lookup or p_email is required';
  end if;

  select count(*) into v_customer_count
  from public.customers customer
  where (
    p_lookup is not null
    and (
      customer.id::text = p_lookup
      or customer.customer_number = p_lookup
      or customer.personal_number = p_lookup
    )
  ) or (
    p_email is not null
    and lower(coalesce(customer.email, '')) = lower(p_email)
  );

  if not p_apply then
    return jsonb_build_object(
      'apply', false,
      'matched_customers', v_customer_count,
      'matched_customer_profiles', 0,
      'message', 'Dry-run only. Re-run with p_apply=true to archive matching canonical customer rows.'
    );
  end if;

  insert into public.gridex_archived_customer_registry_rows(
    archived_by, archive_reason, source_table, source_id, source_email, source_row
  )
  select
    v_actor, p_reason, 'customers', customer.id::text, customer.email,
    to_jsonb(customer)
  from public.customers customer
  where (
    p_lookup is not null
    and (
      customer.id::text = p_lookup
      or customer.customer_number = p_lookup
      or customer.personal_number = p_lookup
    )
  ) or (
    p_email is not null
    and lower(coalesce(customer.email, '')) = lower(p_email)
  );

  update public.customers customer
  set status = 'archived',
      metadata = coalesce(customer.metadata, '{}'::jsonb) || jsonb_build_object(
        'archived_from_active_registry', true,
        'archived_at', now(),
        'archived_reason', p_reason,
        'db4b_cleanup', true
      ),
      updated_at = now(),
      updated_by = coalesce(v_actor, customer.updated_by)
  where (
    p_lookup is not null
    and (
      customer.id::text = p_lookup
      or customer.customer_number = p_lookup
      or customer.personal_number = p_lookup
    )
  ) or (
    p_email is not null
    and lower(coalesce(customer.email, '')) = lower(p_email)
  );
  get diagnostics v_updated_customers = row_count;

  return jsonb_build_object(
    'apply', true,
    'matched_customers_before_apply', v_customer_count,
    'matched_customer_profiles_before_apply', 0,
    'archived_customers', v_updated_customers,
    'removed_customer_profiles', 0,
    'message', 'Matching canonical customer rows were archived. Authentication and tenant memberships were not touched.'
  );
end
$$;

-- ---------------------------------------------------------------------------
-- Signature failure/retry is a first-class lifecycle path.
-- ---------------------------------------------------------------------------

alter table public.customer_contract_events
  drop constraint if exists customer_contract_events_event_type_check;
alter table public.customer_contract_events
  add constraint customer_contract_events_event_type_check check (
    event_type in (
      'created','signature_requested','signature_failed',
      'signature_retry_requested','signed','activated','updated',
      'termination_notice_received','terminated','cancelled','note'
    )
  );

select public.gridex__repair_replace_function_text(
  'public.gridex_record_customer_contract_event_v1(uuid,uuid,uuid,text,timestamptz,text,jsonb,uuid,timestamptz,text)',
  $$'created', 'signature_requested', 'signed', 'activated', 'updated',
       'termination_notice_received', 'terminated', 'cancelled', 'note'$$,
  $$'created', 'signature_requested', 'signature_failed',
       'signature_retry_requested', 'signed', 'activated', 'updated',
       'termination_notice_received', 'terminated', 'cancelled', 'note'$$
);
select public.gridex__repair_replace_function_text(
  'public.gridex_record_customer_contract_event_v1(uuid,uuid,uuid,text,timestamptz,text,jsonb,uuid,timestamptz,text)',
  $$  if p_event_type = 'signed' then$$,
  $$  if p_event_type = 'signature_failed' then
    if v_contract.status <> 'pending_signature' then
      raise exception using
        errcode = '23514',
        message = 'signature_failure_requires_pending_signature';
    end if;
    v_new_status := 'signature_failed';
    update public.customer_contracts contract
    set status = v_new_status,
        lifecycle_stage = 'agreement_ready',
        metadata = coalesce(contract.metadata, '{}'::jsonb)
          || coalesce(p_metadata, '{}'::jsonb)
          || jsonb_build_object(
            'signature_status', 'failed',
            'signature_failed_at', p_happened_at,
            'recoverable_by_new_signature_attempt', true
          ),
        updated_by = p_actor_user_id,
        updated_at = now()
    where contract.id = p_customer_contract_id
      and contract.company_id = p_company_id;
  elsif p_event_type = 'signature_retry_requested' then
    if v_contract.status <> 'signature_failed' then
      raise exception using
        errcode = '23514',
        message = 'signature_retry_requires_signature_failed';
    end if;
    v_new_status := 'pending_signature';
    update public.customer_contracts contract
    set status = v_new_status,
        metadata = coalesce(contract.metadata, '{}'::jsonb)
          || coalesce(p_metadata, '{}'::jsonb)
          || jsonb_build_object(
            'signature_status', 'pending',
            'signature_retry_requested_at', p_happened_at,
            'recoverable_by_new_signature_attempt', false
          ),
        updated_by = p_actor_user_id,
        updated_at = now()
    where contract.id = p_customer_contract_id
      and contract.company_id = p_company_id;
  elsif p_event_type = 'signed' then$$
);

create or replace function public.gridex_fail_website_contract_signature(
  p_company_id uuid,
  p_contract_id uuid,
  p_application_id uuid,
  p_error_code text,
  p_error_stage text
) returns void
language plpgsql
security definer
set search_path = public, extensions, auth, pg_catalog, pg_temp
as $$
declare
  v_contract public.customer_contracts%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'signature_failure_service_role_required';
  end if;
  select * into v_contract
  from public.customer_contracts contract
  where contract.id = p_contract_id
    and contract.company_id = p_company_id
    and contract.metadata->>'website_application_id' = p_application_id::text
  for update;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'website_signature_contract_not_found_for_application';
  end if;
  if v_contract.status = 'signature_failed' then
    return;
  end if;
  perform public.gridex_record_customer_contract_event_v1(
    p_company_id,
    p_contract_id,
    v_contract.customer_id,
    'signature_failed',
    now(),
    'Webbsigneringen misslyckades och kan återupptas med ett nytt försök.',
    jsonb_build_object(
      'website_application_id', p_application_id,
      'signature_failure_code', nullif(p_error_code, ''),
      'signature_failure_stage', nullif(p_error_stage, '')
    ),
    null,
    null,
    'website-signature-failed:' || p_application_id::text
  );
end
$$;

create or replace function public.gridex_retry_website_contract_signature(
  p_company_id uuid,
  p_contract_id uuid,
  p_application_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, auth, pg_catalog, pg_temp
as $$
declare
  v_contract public.customer_contracts%rowtype;
  v_result jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'signature_retry_service_role_required';
  end if;
  select * into v_contract
  from public.customer_contracts contract
  where contract.id = p_contract_id
    and contract.company_id = p_company_id
    and contract.metadata->>'website_application_id' = p_application_id::text
  for update;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'website_signature_contract_not_found_for_application';
  end if;
  if v_contract.status in ('pending_signature', 'signed') then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'status', v_contract.status
    );
  end if;
  if v_contract.status <> 'signature_failed' then
    raise exception using
      errcode = '23514',
      message = 'website_signature_contract_not_retryable';
  end if;
  v_result := public.gridex_record_customer_contract_event_v1(
    p_company_id,
    p_contract_id,
    v_contract.customer_id,
    'signature_retry_requested',
    now(),
    'Ett nytt verifierat webbsigneringsförsök startades.',
    jsonb_build_object('website_application_id', p_application_id),
    null,
    null,
    'website-signature-retry:' || p_application_id::text
  );
  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'status', v_result->>'contract_status'
  );
end
$$;

revoke all on function public.gridex_fail_website_contract_signature(
  uuid,uuid,uuid,text,text
) from public, anon, authenticated;
grant execute on function public.gridex_fail_website_contract_signature(
  uuid,uuid,uuid,text,text
) to service_role;
revoke all on function public.gridex_retry_website_contract_signature(
  uuid,uuid,uuid
) from public, anon, authenticated;
grant execute on function public.gridex_retry_website_contract_signature(
  uuid,uuid,uuid
) to service_role;

-- ---------------------------------------------------------------------------
-- Paused and ended channels are distinct lifecycle commands.
-- ---------------------------------------------------------------------------

create or replace function public.gridex_end_contract_channel(
  p_company_id uuid,
  p_offer_id uuid,
  p_channel text,
  p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_channel text := lower(coalesce(p_channel, ''));
  v_offer public.contract_offers%rowtype;
  v_assignment_id uuid;
  v_unpublish jsonb;
  v_channels bigint := 0;
  v_publications bigint := 0;
  v_public_offers bigint := 0;
begin
  if v_channel not in ('internal','website','api','partner','phone') then
    raise exception using
      errcode = '22023',
      message = 'invalid_contract_channel';
  end if;

  -- The canonical pause command performs permission checking, locks the graph
  -- and closes published immutable publication versions first.
  v_unpublish := public.gridex_unpublish_contract_channel(
    p_company_id, p_offer_id, v_channel, p_actor_user_id
  );
  if not coalesce((v_unpublish->>'ok')::boolean, false) then
    return v_unpublish;
  end if;

  select * into v_offer
  from public.contract_offers offer
  where offer.id = p_offer_id
    and offer.company_id = p_company_id
  for update;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'contract_offer_not_found';
  end if;

  select assignment.id into v_assignment_id
  from public.tenant_contract_assignments assignment
  where assignment.company_id = p_company_id
    and assignment.contract_product_version_id
      = v_offer.contract_product_version_id
  for update;
  if v_assignment_id is null then
    raise exception using
      errcode = 'P0002',
      message = 'contract_assignment_not_found';
  end if;

  update public.tenant_contract_channels channel
  set status = 'ended',
      valid_to = coalesce(channel.valid_to, now()),
      updated_by = p_actor_user_id,
      updated_at = now()
  where channel.assignment_id = v_assignment_id
    and channel.channel = v_channel
    and channel.status <> 'ended';
  get diagnostics v_channels = row_count;

  update public.contract_publications publication
  set status = 'ended',
      updated_at = now()
  where publication.assignment_id = v_assignment_id
    and publication.channel = v_channel
    and publication.status not in ('ended', 'archived');
  get diagnostics v_publications = row_count;

  if v_channel = 'website' then
    perform set_config('gridex.public_offer_write', 'on', true);
    update public.public_contract_offers public_offer
    set lifecycle_status = 'closed',
        publication_status = 'unpublished',
        is_public = false,
        website_enabled = false,
        website_cta_enabled = false,
        closed_at = coalesce(public_offer.closed_at, now()),
        closed_by = coalesce(public_offer.closed_by, p_actor_user_id),
        close_reason = coalesce(
          nullif(public_offer.close_reason, ''),
          'contract_channel_ended'
        ),
        updated_by = p_actor_user_id,
        updated_at = now()
    where public_offer.company_id = p_company_id
      and public_offer.source_contract_offer_id = p_offer_id
      and public_offer.lifecycle_status <> 'closed';
    get diagnostics v_public_offers = row_count;
  end if;

  if not exists (
    select 1
    from public.tenant_contract_channels channel
    join public.tenant_contract_assignments assignment
      on assignment.id = channel.assignment_id
    where assignment.company_id = p_company_id
      and assignment.contract_product_version_id
        = v_offer.contract_product_version_id
      and channel.status = 'active'
  ) then
    update public.contract_offers offer
    set lifecycle_status = 'closed',
        status = 'inactive',
        is_active = false,
        closed_at = coalesce(offer.closed_at, now()),
        closed_by = coalesce(offer.closed_by, p_actor_user_id),
        close_reason = coalesce(
          nullif(offer.close_reason, ''),
          'all_contract_channels_ended'
        ),
        updated_by = p_actor_user_id,
        updated_at = now()
    where offer.id = p_offer_id
      and offer.company_id = p_company_id;
  end if;

  insert into public.audit_logs(
    company_id, actor_user_id, entity_type, entity_id, action, metadata
  ) values (
    p_company_id,
    p_actor_user_id,
    'contract_product_version',
    v_offer.contract_product_version_id::text,
    'contract.channel.ended',
    jsonb_build_object(
      'offer_id', p_offer_id,
      'channel', v_channel,
      'affected_channels', v_channels,
      'affected_publications', v_publications,
      'affected_public_offers', v_public_offers
    )
  );

  return jsonb_build_object(
    'ok', true,
    'changed', (v_channels + v_publications + v_public_offers) > 0,
    'mode', 'ended',
    'offer_id', p_offer_id,
    'channel', v_channel,
    'resulting_status', 'ended',
    'affected_channels', v_channels,
    'affected_publications', v_publications,
    'affected_public_offers', v_public_offers
  );
end
$$;

revoke all on function public.gridex_end_contract_channel(
  uuid,uuid,text,uuid
) from public, anon, authenticated;
grant execute on function public.gridex_end_contract_channel(
  uuid,uuid,text,uuid
) to service_role;

-- Canonical wrappers remain service-role entry points. Core/legacy functions
-- are callable only by their owner through SECURITY DEFINER wrappers.
revoke all on function public.gridex_onboard_customer_graph_core(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.gridex_upsert_internal_contract_offer(
  uuid,uuid,jsonb,jsonb,uuid
) from public, anon, authenticated, service_role;
revoke all on function public.gridex_create_invoice_export_graph_v1_core(
  jsonb,jsonb,jsonb
) from public, anon, authenticated, service_role;

revoke all on function public.gridex_onboard_customer_graph(jsonb)
  from public, anon, authenticated;
grant execute on function public.gridex_onboard_customer_graph(jsonb)
  to service_role;
revoke all on function public.gridex_upsert_internal_contract_offer_v2(
  uuid,uuid,jsonb,jsonb,uuid
) from public, anon, authenticated;
grant execute on function public.gridex_upsert_internal_contract_offer_v2(
  uuid,uuid,jsonb,jsonb,uuid
) to service_role;

-- Resolve live lint type warnings caused by untyped empty array literals and
-- the explicitly shadowed Luhn loop variable.
select public.gridex__repair_replace_function_text(
  'public.gridex_materialize_legal_bundle_version(uuid,uuid,uuid,uuid)',
  $$v_unresolved text[] := '{}';$$,
  $$v_unresolved text[] := array[]::text[];$$
);
select public.gridex__repair_replace_function_text(
  'public.gridex_tenant_legal_profile_missing_fields(public.tenant_legal_profiles)',
  $$v_missing text[] := '{}';$$,
  $$v_missing text[] := array[]::text[];$$
);
select public.gridex__repair_replace_function_text(
  'public.gridex_required_legal_modules(text,text,text,boolean,boolean,boolean)',
  $$v_modules text[]:='{}';$$,
  $$v_modules text[]:=array[]::text[];$$
);
select public.gridex__repair_replace_function_text(
  'public.gridex_required_legal_modules(text,text,text,boolean,boolean,boolean)',
  $$coalesce(array_agg(distinct m order by m),'{}')$$,
  $$coalesce(array_agg(distinct m order by m),array[]::text[])$$
);
select public.gridex__repair_replace_function_text(
  'public.gridex_required_legal_modules(text,text,text,boolean,boolean,boolean)',
  $$return coalesce(v_modules,'{}');$$,
  $$return coalesce(v_modules,array[]::text[]);$$
);
select public.gridex__repair_replace_function_text(
  'public.gridex_generate_portfolio_price_estimate(uuid,uuid,uuid,uuid,text,date,text,numeric,text,text)',
  $$v_ids uuid[]:='{}'$$,
  $$v_ids uuid[]:=array[]::uuid[]$$
);
select public.gridex__repair_replace_function_text(
  'public.gridex_grant_portfolio_settlement_role(uuid,uuid,text,uuid,uuid,timestamptz,text)',
  $$v_ids uuid[]:='{}'$$,
  $$v_ids uuid[]:=array[]::uuid[]$$
);
select public.gridex__repair_replace_function_text(
  'public.gridex_luhn_valid(text)',
  $$  v_digit integer;
  i integer;$$,
  $$  v_digit integer;$$
);

-- SECURITY DEFINER functions touched by this migration use explicit trusted
-- schemas. This does not expose extension or temporary objects ahead of
-- pg_catalog during name resolution.
alter function public.select_onboarding_start_path(uuid,text)
  set search_path = public, auth, pg_catalog, pg_temp;
alter function public.complete_core_onboarding(uuid)
  set search_path = public, auth, pg_catalog, pg_temp;
alter function public.gridex_customer_cleanup_external_ref(uuid)
  set search_path = public, pg_catalog, pg_temp;
alter function public.gridex_current_user_context()
  set search_path = public, auth, pg_catalog, pg_temp;
alter function public.gridex_ops_health_checks()
  set search_path = public, pg_catalog, pg_temp;

-- The repair helper itself must not survive the migration.
drop function public.gridex__repair_replace_function_text(text,text,text);

comment on view public.canonical_public_contract_offers_v is
  'Canonical website offer projection. Uses an explicit compatibility column order and appends source lifecycle plus energy direction.';
comment on view public.contract_publication_graph_integrity_v is
  'Fail-closed canonical publication integrity including bidirectional links, tenant/channel/product chain, immutable hash, energy direction, contract type and successor use.';
comment on function public.gridex_end_contract_channel(uuid,uuid,text,uuid) is
  'Canonical terminal channel command. Distinct from pause/unpublish and preserves immutable signed history.';
comment on function public.gridex_retry_website_contract_signature(uuid,uuid,uuid) is
  'Idempotently recovers signature_failed website contracts to pending_signature before a new exact-evidence finalization.';

commit;
