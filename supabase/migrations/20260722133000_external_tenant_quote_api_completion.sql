-- External tenant identity, canonical website quotes, API publication feed and
-- publication webhook completion. Forward-only and tenant safe.
begin;

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. Stable opaque tenant identity for external integrations.
-- ---------------------------------------------------------------------------
create or replace function public.gridex_new_external_tenant_reference()
returns text
language sql
volatile
set search_path=public,pg_catalog,pg_temp
as $$
  select 'tenant_'
    || replace(gen_random_uuid()::text, '-', '')
    || substr(replace(gen_random_uuid()::text, '-', ''), 1, 4)
$$;

alter table public.companies
  add column if not exists external_tenant_reference text;

update public.companies
set external_tenant_reference = public.gridex_new_external_tenant_reference()
where external_tenant_reference is null or btrim(external_tenant_reference) = '';

alter table public.companies
  alter column external_tenant_reference set default public.gridex_new_external_tenant_reference(),
  alter column external_tenant_reference set not null;

create unique index if not exists companies_external_tenant_reference_uidx
  on public.companies(external_tenant_reference);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.companies'::regclass
      and conname='companies_external_tenant_reference_format_check'
  ) then
    alter table public.companies
      add constraint companies_external_tenant_reference_format_check
      check (external_tenant_reference ~ '^tenant_[0-9a-f]{36}$');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Persistent, tenant-bound quote lifecycle.
-- ---------------------------------------------------------------------------
create table if not exists public.website_contract_quotes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  api_client_id uuid references public.integration_api_clients(id) on delete set null,
  quote_reference text not null,
  offer_reference text not null,
  contract_product_version_id uuid references public.contract_product_versions(id) on delete restrict,
  contract_publication_version_id uuid references public.contract_publication_versions(id) on delete restrict,
  price_plan_version_id uuid references public.price_plan_versions(id) on delete restrict,
  legal_bundle_version_id uuid references public.legal_bundle_versions(id) on delete restrict,
  customer_type text not null check (customer_type in ('private','business')),
  price_area text not null check (price_area in ('SE1','SE2','SE3','SE4')),
  grid_area_code text,
  postal_code text,
  annual_consumption_kwh numeric(18,3) not null check (annual_consumption_kwh > 0),
  start_date date not null,
  market_data_timestamp timestamptz,
  market_sources jsonb not null default '[]'::jsonb,
  assumptions jsonb not null default '[]'::jsonb,
  pricing_snapshot_schema_version text not null,
  quote_snapshot jsonb not null,
  valid_until timestamptz not null,
  status text not null default 'active' check (status in ('active','consumed','expired','revoked')),
  consumed_at timestamptz,
  consumed_application_id uuid references public.website_customer_applications(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (quote_reference)
);

create index if not exists website_contract_quotes_company_created_idx
  on public.website_contract_quotes(company_id,created_at desc);
create index if not exists website_contract_quotes_company_offer_idx
  on public.website_contract_quotes(company_id,offer_reference,created_at desc);
create index if not exists website_contract_quotes_active_expiry_idx
  on public.website_contract_quotes(valid_until)
  where status='active';

alter table public.website_contract_quotes enable row level security;
drop policy if exists website_contract_quotes_service_role_all on public.website_contract_quotes;
create policy website_contract_quotes_service_role_all
on public.website_contract_quotes for all to service_role
using(true) with check(true);
drop policy if exists website_contract_quotes_tenant_read on public.website_contract_quotes;
create policy website_contract_quotes_tenant_read
on public.website_contract_quotes for select to authenticated
using(public.gridex_can_read_company(company_id));

-- ---------------------------------------------------------------------------
-- 3. Permission groups and safe compatibility grants for existing website keys.
-- ---------------------------------------------------------------------------
insert into public.integration_api_permission_groups(
  group_key,label,description,category,scopes,recommended_default,risk_level,sort_order
) values
  (
    'integration_context','Verifiera tenantkontext',
    'Serverintegrationen kan verifiera den opaka tenantreferens som API-nyckeln tillhör.',
    'website',array['integration_context.read']::text[],true,'low',5
  ),
  (
    'website_quotes','Beräkna och validera prisquote',
    'Hemsidan kan skapa canonical prisquotes i OPS och validera dem före kundansökan.',
    'website',array['website_quotes.write','website_quotes.validate']::text[],true,'normal',15
  ),
  (
    'website_energy_area','Lös el- och nätområde',
    'Hemsidan kan använda OPS canonical resolver för prisområde, nätområde och nätägare.',
    'website',array['website_energy_area.resolve']::text[],true,'normal',16
  ),
  (
    'website_switch_status','Läs leverantörsbytesstatus',
    'Hemsidan kan läsa aktuell status och händelser för en tenant-skopad kundansökan.',
    'website',array['website_switch_status.read']::text[],true,'normal',17
  ),
  (
    'api_contracts','Hämta API-publicerade avtal',
    'Partnerintegrationer kan läsa avtal som tenant har publicerat till API-kanalen.',
    'api',array['api_contracts.read']::text[],false,'normal',18
  )
on conflict(group_key) do update set
  label=excluded.label,
  description=excluded.description,
  category=excluded.category,
  scopes=excluded.scopes,
  recommended_default=excluded.recommended_default,
  risk_level=excluded.risk_level,
  sort_order=excluded.sort_order,
  is_active=true,
  updated_at=now();

update public.integration_api_clients c
set scopes = (
  select coalesce(array_agg(distinct scope order by scope),'{}'::text[])
  from unnest(
    coalesce(c.scopes,'{}'::text[]) ||
    array[
      'integration_context.read','website_quotes.write','website_quotes.validate',
      'website_energy_area.resolve','website_switch_status.read'
    ]::text[]
  ) scope
), updated_at=now()
where coalesce(c.scopes,'{}'::text[]) &&
      array['website_contracts.read','website_applications.write']::text[];

-- ---------------------------------------------------------------------------
-- 4. Tenant-admin market data policy fields.
-- ---------------------------------------------------------------------------
alter table public.company_market_price_sources
  add column if not exists price_areas text[] not null default array['SE1','SE2','SE3','SE4']::text[],
  add column if not exists forecast_policy text not null default 'latest_available_indication',
  add column if not exists portfolio_policy text not null default 'require_locked_period_price',
  add column if not exists last_tested_at timestamptz,
  add column if not exists last_success_at timestamptz,
  add column if not exists last_error text;

-- ---------------------------------------------------------------------------
-- 5. Real external feed for the API publication channel.
-- ---------------------------------------------------------------------------
create or replace function public.gridex_list_external_api_contracts(
  p_company_id uuid,
  p_customer_type text default null
) returns table(data jsonb)
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select
    (
      cpv.publication_snapshot
        - 'company_id' - 'companyId' - 'tenant_id' - 'tenantId'
        - 'source_contract_offer_id' - 'commercial_snapshot'
    ) || jsonb_build_object(
      'commercial_snapshot',
      coalesce(cpv.publication_snapshot->'commercial_snapshot','{}'::jsonb)
        - 'company_id' - 'companyId' - 'tenant_id' - 'tenantId',
      'offer_reference',cpv.offer_reference,
      'channel','api',
      'customer_type',cpv.customer_type,
      'valid_from',cpv.valid_from,
      'valid_to',cpv.valid_to,
      'contract_product_version_id',cpv.contract_product_version_id,
      'contract_publication_version_id',cpv.id,
      'price_plan_version_id',cpv.price_plan_version_id,
      'legal_bundle_version_id',cpv.legal_bundle_version_id,
      'published_at',cpv.published_at
    ) as data
  from public.contract_publication_versions cpv
  join public.contract_publications cp
    on cp.id=cpv.contract_publication_id
  join public.tenant_contract_assignments ta
    on ta.id=cp.assignment_id
  join public.tenant_contract_channels tcc
    on tcc.assignment_id=ta.id and tcc.channel='api'
  where ta.company_id=p_company_id
    and ta.status='active'
    and cp.channel='api'
    and cp.status='published'
    and cpv.channel='api'
    and cpv.status='published'
    and cpv.locked_at is not null
    and tcc.status='active'
    and (ta.valid_from is null or ta.valid_from<=current_date)
    and (ta.valid_to is null or ta.valid_to>=current_date)
    and (tcc.valid_from is null or tcc.valid_from<=now())
    and (tcc.valid_to is null or tcc.valid_to>=now())
    and (cpv.valid_from is null or cpv.valid_from<=now())
    and (cpv.valid_to is null or cpv.valid_to>=now())
    and (
      p_customer_type is null
      or cpv.customer_type='both'
      or cpv.customer_type=p_customer_type
    )
  order by cpv.published_at desc nulls last,cpv.created_at desc
$$;

revoke all on function public.gridex_list_external_api_contracts(uuid,text)
  from public,anon,authenticated;
grant execute on function public.gridex_list_external_api_contracts(uuid,text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 6. Publication revision emits through the ONE live webhook delivery table.
-- ---------------------------------------------------------------------------
create or replace function public.gridex_bump_contract_publication_revision(
  p_company_id uuid,p_channel text,p_reason text,p_entity_id text default null
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  r public.contract_publication_revisions%rowtype;
  v_event_id uuid;
  v_tenant_reference text;
  v_event_data jsonb;
  v_occurred_at timestamptz:=now();
begin
  if p_company_id is null or p_channel not in ('website','api','internal','phone','partner') then
    raise exception using errcode='22023',message='publication_revision_scope_invalid';
  end if;

  select external_tenant_reference into v_tenant_reference
  from public.companies where id=p_company_id;
  if v_tenant_reference is null then
    raise exception using errcode='23502',message='external_tenant_reference_missing';
  end if;

  insert into public.contract_publication_revisions(company_id,channel,revision,revision_token,updated_at)
  values(p_company_id,p_channel,1,gen_random_uuid(),v_occurred_at)
  on conflict(company_id,channel) do update set
    revision=public.contract_publication_revisions.revision+1,
    revision_token=gen_random_uuid(),
    updated_at=v_occurred_at
  returning * into r;

  v_event_data:=jsonb_build_object(
    'tenant_reference',v_tenant_reference,
    'channel',p_channel,
    'publication_revision',r.revision,
    'revision_token',r.revision_token,
    'reason',p_reason,
    'timestamp',r.updated_at
  );

  insert into public.domain_events(
    company_id,event_type,aggregate_type,aggregate_id,source,idempotency_key,payload,occurred_at
  ) values(
    p_company_id,'contracts.publication.changed','contract_publication',
    coalesce(p_entity_id,'publication:'||p_channel),'database',
    format('contracts.publication.changed:%s:%s:%s',p_company_id,p_channel,r.revision),
    v_event_data,v_occurred_at
  ) on conflict(idempotency_key) where idempotency_key is not null do nothing
  returning id into v_event_id;

  if v_event_id is not null then
    insert into public.webhook_deliveries(
      company_id,webhook_subscription_id,domain_event_id,event_type,
      max_attempts,target_url,idempotency_key,payload
    )
    select
      p_company_id,ws.id,v_event_id,'contracts.publication.changed',
      ws.max_attempts,ws.endpoint_url,
      format('webhook:%s:%s',ws.id,v_event_id),
      jsonb_build_object(
        'id',v_event_id,
        'type','contracts.publication.changed',
        'event_id',v_event_id,
        'event_type','contracts.publication.changed',
        'created_at',v_occurred_at,
        'tenant_reference',v_tenant_reference,
        'environment',null,
        'customer_id',null,
        'customer_number',null,
        'external_customer_id',null,
        'aggregate',jsonb_build_object(
          'type','contract_publication',
          'id',coalesce(p_entity_id,'publication:'||p_channel)
        ),
        'data',v_event_data
      )
    from public.webhook_subscriptions ws
    where ws.company_id=p_company_id
      and ws.status='active'
      and ('*'=any(coalesce(ws.event_types,'{}'::text[]))
           or 'contracts.publication.changed'=any(coalesce(ws.event_types,'{}'::text[])))
    on conflict(idempotency_key) do nothing;
  end if;

  return jsonb_build_object(
    'tenant_reference',v_tenant_reference,
    'channel',r.channel,
    'revision',r.revision,
    'revision_token',r.revision_token,
    'updated_at',r.updated_at,
    'event_id',v_event_id
  );
end $$;

-- Catch every mutation that can change externally visible publication state.
-- NEW is unavailable for DELETE triggers and OLD is unavailable for INSERT.
-- Resolve the row side explicitly so permanent delete cannot fail with
-- "record NEW is not assigned yet" and leave the cache revision stale.
create or replace function public.gridex_contract_publication_revision_trigger()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_company_id uuid;
  v_channel text;
  v_entity_id text;
  v_assignment_id uuid;
  v_publication_id uuid;
begin
  if tg_table_name='public_contract_offers' then
    if tg_op='DELETE' then
      v_company_id:=old.company_id;
      v_entity_id:=old.id::text;
    else
      v_company_id:=new.company_id;
      v_entity_id:=new.id::text;
    end if;
    v_channel:='website';
  elsif tg_table_name='tenant_contract_channels' then
    if tg_op='DELETE' then
      v_assignment_id:=old.assignment_id;
      v_channel:=old.channel;
      v_entity_id:=old.id::text;
    else
      v_assignment_id:=new.assignment_id;
      v_channel:=new.channel;
      v_entity_id:=new.id::text;
    end if;
    select ta.company_id into v_company_id
    from public.tenant_contract_assignments ta where ta.id=v_assignment_id;
  elsif tg_table_name='contract_publications' then
    if tg_op='DELETE' then
      v_assignment_id:=old.assignment_id;
      v_channel:=old.channel;
      v_entity_id:=old.id::text;
    else
      v_assignment_id:=new.assignment_id;
      v_channel:=new.channel;
      v_entity_id:=new.id::text;
    end if;
    select ta.company_id into v_company_id
    from public.tenant_contract_assignments ta where ta.id=v_assignment_id;
  elsif tg_table_name='contract_publication_versions' then
    if tg_op='DELETE' then
      v_publication_id:=old.contract_publication_id;
      v_channel:=old.channel;
      v_entity_id:=old.id::text;
    else
      v_publication_id:=new.contract_publication_id;
      v_channel:=new.channel;
      v_entity_id:=new.id::text;
    end if;
    select ta.company_id,cp.channel
      into v_company_id,v_channel
    from public.contract_publications cp
    join public.tenant_contract_assignments ta on ta.id=cp.assignment_id
    where cp.id=v_publication_id;
  end if;

  if v_company_id is not null and v_channel is not null then
    perform public.gridex_bump_contract_publication_revision(
      v_company_id,v_channel,tg_table_name||'.'||lower(tg_op),v_entity_id
    );
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists trg_public_contract_offers_publication_revision on public.public_contract_offers;
create trigger trg_public_contract_offers_publication_revision
after insert or update or delete on public.public_contract_offers
for each row execute function public.gridex_contract_publication_revision_trigger();

drop trigger if exists trg_tenant_contract_channels_publication_revision on public.tenant_contract_channels;
create trigger trg_tenant_contract_channels_publication_revision
after insert or update or delete on public.tenant_contract_channels
for each row execute function public.gridex_contract_publication_revision_trigger();

drop trigger if exists trg_contract_publications_publication_revision on public.contract_publications;
create trigger trg_contract_publications_publication_revision
after insert or update or delete on public.contract_publications
for each row execute function public.gridex_contract_publication_revision_trigger();

drop trigger if exists trg_contract_publication_versions_publication_revision on public.contract_publication_versions;
create trigger trg_contract_publication_versions_publication_revision
after insert or update or delete on public.contract_publication_versions
for each row execute function public.gridex_contract_publication_revision_trigger();

insert into public.contract_publication_revisions(company_id,channel,revision,revision_token,updated_at)
select c.id,ch.channel,0,gen_random_uuid(),now()
from public.companies c
cross join (values('website'),('api')) ch(channel)
on conflict(company_id,channel) do nothing;

grant select on public.website_contract_quotes to authenticated,service_role;
grant insert,update,delete on public.website_contract_quotes to service_role;
grant select,insert,update,delete on public.company_market_price_sources to authenticated,service_role;

comment on column public.companies.external_tenant_reference is
  'Stable opaque tenant identity exposed to external API clients. Never use the internal company UUID as an external tenant selector.';
comment on table public.website_contract_quotes is
  'Immutable price calculation inputs and snapshot bound to tenant, publication versions and customer application.';
comment on function public.gridex_list_external_api_contracts(uuid,text) is
  'Tenant-scoped external feed for contracts published to the api channel.';

commit;
