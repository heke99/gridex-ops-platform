-- Canonical contract/tenant lifecycle completion.
--
-- Adds the missing terminal contract state, fail-closed tenant API gating,
-- resumable tenant onboarding state and atomic tenant lifecycle transitions.
-- Existing signed contracts, quotes, applications and billing history are
-- retained. Pausing or closing a sales resource revokes only unused quotes.

begin;

alter table public.contract_offers
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references auth.users(id) on delete set null,
  add column if not exists close_reason text;

alter table public.public_contract_offers
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references auth.users(id) on delete set null,
  add column if not exists close_reason text;

alter table public.contract_offers
  drop constraint if exists contract_offers_lifecycle_status_check;
alter table public.contract_offers
  add constraint contract_offers_lifecycle_status_check
  check(lifecycle_status in ('draft','ready','published','paused','expired','closed','archived','superseded'));

alter table public.public_contract_offers
  drop constraint if exists public_contract_offers_lifecycle_status_check;
alter table public.public_contract_offers
  add constraint public_contract_offers_lifecycle_status_check
  check(lifecycle_status in ('draft','ready','published','paused','expired','closed','archived','superseded'));

alter table public.companies
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references auth.users(id) on delete set null,
  add column if not exists closure_reason text;

alter table public.companies drop constraint if exists companies_status_check;
alter table public.companies add constraint companies_status_check
  check(status in (
    'active','onboarding','paused','suspended','closed','archived',
    'pending_deletion','deleted_test_only'
  ));

create table if not exists public.company_onboarding_lifecycle (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  current_step text not null default 'created',
  status text not null default 'in_progress',
  completed_steps text[] not null default '{}'::text[],
  blocking_reasons jsonb not null default '[]'::jsonb,
  last_error_code text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  activated_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_onboarding_lifecycle_company_uidx unique(company_id),
  constraint company_onboarding_lifecycle_step_check check(current_step in (
    'created','legal_setup','admin_setup','energy_setup','integration_setup',
    'branding_setup','contracts_setup','review','ready','activated','blocked','cancelled'
  )),
  constraint company_onboarding_lifecycle_status_check check(status in (
    'in_progress','blocked','ready','activated','cancelled'
  ))
);

alter table public.company_onboarding_lifecycle enable row level security;
drop policy if exists company_onboarding_lifecycle_service_role_all
  on public.company_onboarding_lifecycle;
create policy company_onboarding_lifecycle_service_role_all
  on public.company_onboarding_lifecycle for all to service_role
  using(true) with check(true);
drop policy if exists company_onboarding_lifecycle_tenant_read
  on public.company_onboarding_lifecycle;
create policy company_onboarding_lifecycle_tenant_read
  on public.company_onboarding_lifecycle for select to authenticated
  using(public.gridex_can_read_company(company_id));

insert into public.company_onboarding_lifecycle(company_id,current_step,status)
select c.id,
  case when c.status='active' then 'activated' else 'created' end,
  case when c.status='active' then 'activated' else 'in_progress' end
from public.companies c
on conflict(company_id) do nothing;

-- Register the separate close permission without assuming one historical
-- permissions-table shape.
do $$
declare
  v_has_name boolean;
  v_has_label boolean;
  v_has_description boolean;
  v_has_category boolean;
  v_has_area boolean;
  v_has_risk boolean;
  v_has_is_active boolean;
  v_columns text[]:=array['key'];
  v_values text[]:=array[quote_literal('contracts.close')];
  v_updates text[]:=array[]::text[];
begin
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='permissions' and column_name='name') into v_has_name;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='permissions' and column_name='label') into v_has_label;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='permissions' and column_name='description') into v_has_description;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='permissions' and column_name='category') into v_has_category;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='permissions' and column_name='area') into v_has_area;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='permissions' and column_name='risk') into v_has_risk;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='permissions' and column_name='is_active') into v_has_is_active;
  if v_has_name then v_columns:=array_append(v_columns,'name'); v_values:=array_append(v_values,quote_literal('Stäng avtal')); v_updates:=array_append(v_updates,'name=excluded.name'); end if;
  if v_has_label then v_columns:=array_append(v_columns,'label'); v_values:=array_append(v_values,quote_literal('Stäng avtal')); v_updates:=array_append(v_updates,'label=excluded.label'); end if;
  if v_has_description then v_columns:=array_append(v_columns,'description'); v_values:=array_append(v_values,quote_literal('Kan terminalt stänga en avtalsprodukt för all nyförsäljning.')); v_updates:=array_append(v_updates,'description=excluded.description'); end if;
  if v_has_category then v_columns:=array_append(v_columns,'category'); v_values:=array_append(v_values,quote_literal('contracts')); v_updates:=array_append(v_updates,'category=excluded.category'); end if;
  if v_has_area then v_columns:=array_append(v_columns,'area'); v_values:=array_append(v_values,quote_literal('Avtal')); v_updates:=array_append(v_updates,'area=excluded.area'); end if;
  if v_has_risk then v_columns:=array_append(v_columns,'risk'); v_values:=array_append(v_values,quote_literal('high')); v_updates:=array_append(v_updates,'risk=excluded.risk'); end if;
  if v_has_is_active then v_columns:=array_append(v_columns,'is_active'); v_values:=array_append(v_values,'true'); v_updates:=array_append(v_updates,'is_active=true'); end if;
  execute format(
    'insert into public.permissions(%s) values(%s) on conflict(key) do %s',
    array_to_string(v_columns,','),array_to_string(v_values,','),
    case when cardinality(v_updates)>0 then 'update set '||array_to_string(v_updates,',') else 'nothing' end
  );
end $$;

create or replace function public.gridex_close_contract_product(
  p_company_id uuid,
  p_offer_id uuid,
  p_actor_user_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  o public.contract_offers%rowtype;
  v_before jsonb;
  v_channels bigint:=0;
  v_publications bigint:=0;
  v_versions bigint:=0;
  v_public_offers bigint:=0;
  v_quotes bigint:=0;
  v_event_id uuid;
begin
  perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.close');
  if nullif(btrim(coalesce(p_reason,'')),'') is null then
    return jsonb_build_object('ok',false,'changed',false,'code','contract_close_reason_required');
  end if;

  select * into o from public.contract_offers
  where id=p_offer_id and company_id=p_company_id for update;
  if not found then
    return jsonb_build_object('ok',false,'changed',false,'code','contract_not_found');
  end if;
  if o.lifecycle_status='closed' then
    return jsonb_build_object('ok',true,'changed',false,'mode','closed','code','contract_already_closed');
  end if;
  if o.lifecycle_status='archived' then
    return jsonb_build_object('ok',false,'changed',false,'code','contract_already_archived');
  end if;
  v_before:=to_jsonb(o);

  perform set_config('gridex.version_transition','on',true);
  perform set_config('gridex.public_offer_write','on',true);

  update public.tenant_contract_channels ch
  set status='ended',valid_to=coalesce(valid_to,now()),updated_by=p_actor_user_id,updated_at=now()
  from public.tenant_contract_assignments ta
  join public.contract_product_versions cpv on cpv.id=ta.contract_product_version_id
  where ch.assignment_id=ta.id and ta.company_id=p_company_id
    and cpv.contract_product_id=o.contract_product_id and ch.status<>'ended';
  get diagnostics v_channels=row_count;

  update public.contract_publications p
  set status='ended',updated_at=now()
  from public.tenant_contract_assignments ta
  join public.contract_product_versions cpv on cpv.id=ta.contract_product_version_id
  where p.assignment_id=ta.id and ta.company_id=p_company_id
    and cpv.contract_product_id=o.contract_product_id and p.status not in ('ended','archived');
  get diagnostics v_publications=row_count;

  update public.contract_publication_versions pv
  set status='ended',valid_to=coalesce(valid_to,now())
  from public.contract_publications p
  join public.tenant_contract_assignments ta on ta.id=p.assignment_id
  join public.contract_product_versions cpv on cpv.id=ta.contract_product_version_id
  where pv.contract_publication_id=p.id and ta.company_id=p_company_id
    and cpv.contract_product_id=o.contract_product_id and pv.status not in ('ended','archived');
  get diagnostics v_versions=row_count;

  update public.public_contract_offers pco
  set lifecycle_status='closed',publication_status='unpublished',is_public=false,
      website_enabled=false,website_cta_enabled=false,
      closed_at=coalesce(closed_at,now()),closed_by=p_actor_user_id,
      close_reason=btrim(p_reason),updated_by=p_actor_user_id,updated_at=now()
  where pco.company_id=p_company_id and pco.source_contract_offer_id in (
    select co.id from public.contract_offers co
    where co.company_id=p_company_id and co.contract_product_id=o.contract_product_id
  );
  get diagnostics v_public_offers=row_count;

  update public.website_contract_quotes q
  set status='revoked',updated_at=now()
  where q.company_id=p_company_id and q.status='active' and q.offer_reference in (
    select pco.canonical_offer_reference
    from public.public_contract_offers pco
    where pco.company_id=p_company_id and pco.source_contract_offer_id in (
      select co.id from public.contract_offers co
      where co.company_id=p_company_id and co.contract_product_id=o.contract_product_id
    )
  );
  get diagnostics v_quotes=row_count;

  update public.tenant_contract_assignments ta
  set status='ended',valid_to=coalesce(valid_to,now()),updated_at=now()
  from public.contract_product_versions cpv
  where cpv.id=ta.contract_product_version_id and ta.company_id=p_company_id
    and cpv.contract_product_id=o.contract_product_id and ta.status<>'ended';

  update public.contract_offers
  set lifecycle_status='closed',status='inactive',is_active=false,
      closed_at=coalesce(closed_at,now()),closed_by=p_actor_user_id,
      close_reason=btrim(p_reason),updated_by=p_actor_user_id,updated_at=now()
  where company_id=p_company_id and contract_product_id=o.contract_product_id;

  update public.contract_products
  set status='archived',updated_at=now()
  where id=o.contract_product_id and company_id=p_company_id;

  insert into public.audit_logs(
    company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata
  ) values(
    p_company_id,p_actor_user_id,'contract_product',o.contract_product_id::text,
    'contract.closed',v_before,
    jsonb_build_object('lifecycle_status','closed','closed_at',now(),'close_reason',btrim(p_reason)),
    jsonb_build_object(
      'offer_id',o.id,'affected_channels',v_channels,'affected_publications',v_publications,
      'affected_publication_versions',v_versions,'affected_public_offers',v_public_offers,
      'revoked_unused_quotes',v_quotes
    )
  );

  insert into public.domain_events(
    company_id,event_type,aggregate_type,aggregate_id,actor_user_id,source,idempotency_key,payload
  ) values(
    p_company_id,'contract.closed','contract_product',o.contract_product_id::text,
    p_actor_user_id,'database',
    format('contract.closed:%s:%s',o.contract_product_id,extract(epoch from now())::bigint),
    jsonb_build_object('contract_product_id',o.contract_product_id,'offer_id',o.id,'reason',btrim(p_reason))
  ) returning id into v_event_id;
  insert into public.event_outbox(company_id,domain_event_id,destination_type,destination_key,payload)
  values(p_company_id,v_event_id,'webhook','contract.closed',
    jsonb_build_object('domain_event_id',v_event_id,'event_type','contract.closed'))
  on conflict do nothing;

  perform public.gridex_bump_contract_publication_revision(
    p_company_id,'website','contract_closed',o.contract_product_id::text
  );
  perform public.gridex_bump_contract_publication_revision(
    p_company_id,'api','contract_closed',o.contract_product_id::text
  );

  return jsonb_build_object(
    'ok',true,'changed',true,'mode','closed','code','contract_closed',
    'contract_product_id',o.contract_product_id,'offer_id',o.id,
    'affected_channels',v_channels,'affected_publications',v_publications,
    'affected_publication_versions',v_versions,'affected_public_offers',v_public_offers,
    'revoked_unused_quotes',v_quotes,'event_id',v_event_id
  );
end $$;

create or replace function public.gridex_protect_closed_contract_delete()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if old.lifecycle_status='closed' then
    raise exception using errcode='55000',message='contract_closed_terminal';
  end if;
  return old;
end $$;

drop trigger if exists contract_offers_closed_delete_guard on public.contract_offers;
create trigger contract_offers_closed_delete_guard
before delete on public.contract_offers
for each row execute function public.gridex_protect_closed_contract_delete();

create or replace function public.gridex_tenant_activation_readiness(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  c public.companies%rowtype;
  v_blockers jsonb:='[]'::jsonb;
  v_missing_tasks jsonb;
begin
  select * into c from public.companies where id=p_company_id;
  if not found then
    return jsonb_build_object('ready',false,'blocking_reasons',
      jsonb_build_array(jsonb_build_object('code','tenant_not_found','message','Tenant hittades inte.')));
  end if;

  if nullif(btrim(coalesce(c.legal_name,c.name,'')),'') is null
     or nullif(btrim(coalesce(c.org_number,'')),'') is null then
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','tenant_missing_legal_entity','message','Juridiskt namn eller organisationsnummer saknas.'));
  end if;
  if not exists(
    select 1 from public.company_memberships m
    where m.company_id=p_company_id and m.status='active'
      and coalesce(m.membership_role,'') in ('owner','admin','company_admin')
  ) then
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','tenant_missing_admin','message','Aktiv bolagsadministratör saknas.'));
  end if;
  if nullif(btrim(coalesce(c.external_tenant_reference,'')),'') is null then
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','tenant_missing_external_reference','message','Extern tenantreferens saknas.'));
  end if;
  if not exists(
    select 1 from public.integration_api_clients i
    where i.company_id=p_company_id and i.status='active'
  ) then
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','tenant_missing_api_key','message','Aktiv API-klient saknas.'));
  end if;
  if not exists(
    select 1 from public.integration_api_clients i
    where i.company_id=p_company_id and i.status='active'
      and array[
        'integration_context.read','website_contracts.read','website_contracts.diagnostics',
        'website_energy_area.resolve','website_quotes.write','website_quotes.validate',
        'website_applications.write','website_legal.read'
      ]::text[] <@ coalesce(i.scopes,'{}'::text[])
  ) then
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','tenant_missing_required_scopes','message','API-klienten saknar obligatoriska website_sales-scopes.'));
  end if;
  if not exists(
    select 1 from public.tenant_contract_channels ch
    join public.tenant_contract_assignments ta on ta.id=ch.assignment_id
    where ta.company_id=p_company_id and ch.channel in ('website','api')
  ) then
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','tenant_missing_contract_channel','message','Försäljningskanal för hemsida/API saknas.'));
  end if;
  if nullif(btrim(coalesce(c.primary_contact_email,c.support_email,'')),'') is null then
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','tenant_missing_customer_communication','message','Kund- eller supportadress saknas.'));
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'code','tenant_onboarding_task_incomplete',
    'task_key',t.task_key,'message',coalesce(t.blocker_reason,t.next_required_action,t.title)
  ) order by t.category,t.task_key),'[]'::jsonb)
  into v_missing_tasks
  from public.company_onboarding_tasks t
  where t.company_id=p_company_id and t.status<>'complete';
  v_blockers:=v_blockers||coalesce(v_missing_tasks,'[]'::jsonb);

  return jsonb_build_object(
    'ready',jsonb_array_length(v_blockers)=0,
    'tenant_id',p_company_id,'status',c.status,
    'blocking_reasons',v_blockers,'evaluated_at',now()
  );
end $$;

create or replace function public.gridex_transition_tenant_lifecycle(
  p_company_id uuid,
  p_next_status text,
  p_actor_user_id uuid,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path=public,auth,pg_temp
as $$
declare
  c public.companies%rowtype;
  v_before jsonb;
  v_readiness jsonb;
  v_blockers jsonb:='[]'::jsonb;
  v_event_id uuid;
begin
  if p_actor_user_id is null or not (
    exists(select 1 from public.admin_users a where a.user_id=p_actor_user_id
      and coalesce(a.is_active,true)
      and lower(coalesce(a.role,'')) in ('super_admin','superadmin','platform_superadmin'))
    or exists(select 1 from public.user_roles ur left join public.roles r on r.id=ur.role_id
      where ur.user_id=p_actor_user_id and coalesce(ur.status,'active')='active'
        and coalesce(ur.is_active,true)
        and lower(coalesce(ur.role,r.key,r.name,'')) in ('super_admin','superadmin','platform_superadmin'))
  ) then
    raise exception using errcode='42501',message='tenant_lifecycle_forbidden';
  end if;
  if p_next_status not in ('active','onboarding','paused','suspended','closed','archived','pending_deletion') then
    raise exception using errcode='22023',message='tenant_lifecycle_status_invalid';
  end if;
  if p_next_status not in ('active','onboarding') and nullif(btrim(coalesce(p_reason,'')),'') is null then
    return jsonb_build_object('ok',false,'changed',false,'code','tenant_reason_required');
  end if;

  select * into c from public.companies where id=p_company_id for update;
  if not found then return jsonb_build_object('ok',false,'changed',false,'code','tenant_not_found'); end if;
  v_before:=to_jsonb(c);
  if c.status='closed' and p_next_status<>'closed' then
    return jsonb_build_object('ok',false,'changed',false,'code','tenant_closed_terminal');
  end if;

  if p_next_status='active' then
    v_readiness:=public.gridex_tenant_activation_readiness(p_company_id);
    if not coalesce((v_readiness->>'ready')::boolean,false) then
      insert into public.company_onboarding_lifecycle(
        company_id,current_step,status,blocking_reasons,last_error_code,updated_at
      ) values(
        p_company_id,'blocked','blocked',coalesce(v_readiness->'blocking_reasons','[]'::jsonb),
        'tenant_not_operationally_ready',now()
      ) on conflict(company_id) do update set
        current_step='blocked',status='blocked',
        blocking_reasons=excluded.blocking_reasons,last_error_code=excluded.last_error_code,updated_at=now();
      return jsonb_build_object(
        'ok',false,'changed',false,'code','tenant_not_operationally_ready',
        'blocking_reasons',v_readiness->'blocking_reasons','readiness',v_readiness
      );
    end if;
  end if;

  if p_next_status='closed' then
    if exists(select 1 from public.customer_contracts cc
      where cc.company_id=p_company_id and cc.status in ('active','signed','current')) then
      v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
        'code','tenant_has_active_customer_contracts','message','Aktiva kundavtal måste överföras eller avslutas.'));
    end if;
    if exists(select 1 from public.supplier_switch_requests s
      where s.company_id=p_company_id and s.status not in ('completed','failed','cancelled','rejected')) then
      v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
        'code','tenant_has_open_supplier_switches','message','Pågående leverantörsbyten måste slutföras.'));
    end if;
    if exists(select 1 from public.billing_underlays b
      where b.company_id=p_company_id and b.status not in ('completed','exported','cancelled','rejected')) then
      v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
        'code','tenant_has_unsettled_billing','message','Ofärdig fakturering måste regleras.'));
    end if;
    if jsonb_array_length(v_blockers)>0 then
      return jsonb_build_object('ok',false,'changed',false,'code','tenant_closure_blocked',
        'blocking_reasons',v_blockers);
    end if;
  end if;

  update public.companies set
    status=p_next_status,
    status_reason=p_reason,
    is_active=(p_next_status='active'),
    is_paused=(p_next_status in ('paused','suspended','closed','archived','pending_deletion')),
    paused_at=case when p_next_status='paused' then coalesce(paused_at,now()) when p_next_status='active' then null else paused_at end,
    paused_by=case when p_next_status='paused' then p_actor_user_id when p_next_status='active' then null else paused_by end,
    closed_at=case when p_next_status='closed' then coalesce(closed_at,now()) else closed_at end,
    closed_by=case when p_next_status='closed' then p_actor_user_id else closed_by end,
    closure_reason=case when p_next_status='closed' then p_reason else closure_reason end,
    updated_at=now()
  where id=p_company_id;

  if p_next_status in ('paused','suspended','closed','archived','pending_deletion') then
    update public.integration_api_clients
    set status=case when p_next_status='closed' then 'revoked' else 'paused' end,
        revoked_at=case when p_next_status='closed' then coalesce(revoked_at,now()) else revoked_at end,
        revoked_by=case when p_next_status='closed' then p_actor_user_id else revoked_by end,
        revoke_reason=case when p_next_status='closed' then p_reason else revoke_reason end,
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'tenant_lifecycle_pause',true,'tenant_lifecycle_status',p_next_status
        ),updated_at=now()
    where company_id=p_company_id and status in ('active','paused');

    update public.tenant_contract_channels ch set
      status=case when p_next_status='closed' then 'ended' else 'paused' end,
      valid_to=case when p_next_status='closed' then coalesce(valid_to,now()) else valid_to end,
      updated_by=p_actor_user_id,updated_at=now()
    from public.tenant_contract_assignments ta
    where ch.assignment_id=ta.id and ta.company_id=p_company_id and ch.status='active';

    update public.website_contract_quotes set status='revoked',updated_at=now()
    where company_id=p_company_id and status='active';
  elsif p_next_status='active' then
    update public.integration_api_clients set
      status='active',
      metadata=coalesce(metadata,'{}'::jsonb)-'tenant_lifecycle_pause'-'tenant_lifecycle_status',
      updated_at=now()
    where company_id=p_company_id and status='paused'
      and coalesce((metadata->>'tenant_lifecycle_pause')::boolean,false);
  end if;

  insert into public.company_onboarding_lifecycle(
    company_id,current_step,status,completed_steps,blocking_reasons,
    last_error_code,completed_at,activated_at,updated_at
  ) values(
    p_company_id,
    case when p_next_status='active' then 'activated'
         when p_next_status='onboarding' then 'created' else 'blocked' end,
    case when p_next_status='active' then 'activated'
         when p_next_status='onboarding' then 'in_progress' else 'blocked' end,
    case when p_next_status='active' then array[
      'created','legal_setup','admin_setup','energy_setup','integration_setup',
      'branding_setup','contracts_setup','review','ready','activated'
    ]::text[] else '{}'::text[] end,
    '[]'::jsonb,null,
    case when p_next_status='active' then now() else null end,
    case when p_next_status='active' then now() else null end,now()
  ) on conflict(company_id) do update set
    current_step=excluded.current_step,status=excluded.status,
    completed_steps=case when p_next_status='active' then excluded.completed_steps
      else public.company_onboarding_lifecycle.completed_steps end,
    blocking_reasons='[]'::jsonb,last_error_code=null,
    completed_at=case when p_next_status='active' then now()
      else public.company_onboarding_lifecycle.completed_at end,
    activated_at=case when p_next_status='active' then now()
      else public.company_onboarding_lifecycle.activated_at end,
    updated_at=now();

  insert into public.audit_logs(
    company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata
  ) values(
    p_company_id,p_actor_user_id,'company',p_company_id::text,
    'tenant.'||p_next_status,v_before,
    jsonb_build_object('status',p_next_status,'reason',p_reason),
    jsonb_build_object('previous_status',c.status,'next_status',p_next_status)
  );
  insert into public.domain_events(
    company_id,event_type,aggregate_type,aggregate_id,actor_user_id,source,idempotency_key,payload
  ) values(
    p_company_id,'tenant.'||p_next_status,'company',p_company_id::text,p_actor_user_id,'database',
    format('tenant.%s:%s:%s',p_next_status,p_company_id,extract(epoch from now())::bigint),
    jsonb_build_object('previous_status',c.status,'status',p_next_status,'reason',p_reason)
  ) returning id into v_event_id;
  insert into public.event_outbox(company_id,domain_event_id,destination_type,destination_key,payload)
  values(p_company_id,v_event_id,'internal','tenant.'||p_next_status,
    jsonb_build_object('domain_event_id',v_event_id,'event_type','tenant.'||p_next_status))
  on conflict do nothing;

  return jsonb_build_object('ok',true,'changed',c.status is distinct from p_next_status,
    'mode',p_next_status,'previous_status',c.status,'status',p_next_status,'event_id',v_event_id);
end $$;

revoke all on function public.gridex_close_contract_product(uuid,uuid,uuid,text)
  from public,anon;
grant execute on function public.gridex_close_contract_product(uuid,uuid,uuid,text)
  to authenticated,service_role;
revoke all on function public.gridex_tenant_activation_readiness(uuid)
  from public,anon,authenticated;
grant execute on function public.gridex_tenant_activation_readiness(uuid)
  to service_role;
revoke all on function public.gridex_transition_tenant_lifecycle(uuid,text,uuid,text)
  from public,anon,authenticated;
grant execute on function public.gridex_transition_tenant_lifecycle(uuid,text,uuid,text)
  to service_role;

comment on function public.gridex_close_contract_product(uuid,uuid,uuid,text) is
  'Terminal, tenant-scoped contract close. Ends every sales channel, revokes unused quotes, preserves signed/history rows and emits audit/outbox events atomically.';
comment on function public.gridex_tenant_activation_readiness(uuid) is
  'Structured activation blockers derived from persisted legal/admin/API/channel/communication/onboarding state.';
comment on function public.gridex_transition_tenant_lifecycle(uuid,text,uuid,text) is
  'Canonical tenant lifecycle transaction. Activation is readiness-gated; pause/close centrally disable integration and sales writes.';

commit;
