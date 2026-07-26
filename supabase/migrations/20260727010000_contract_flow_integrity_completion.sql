-- GRIDEX OPS: canonical contract-flow integrity completion.
-- Forward-only migration. Historical migrations remain immutable.

begin;

create or replace function public.gridex_normalize_platform_role(p_role text)
returns text
language sql
immutable
security invoker
set search_path=public,pg_temp
as $$
  select case lower(trim(coalesce(p_role,'')))
    when 'super_admin' then 'super_admin'
    when 'superadmin' then 'super_admin'
    when 'platform_superadmin' then 'super_admin'
    when 'platformsuperadmin' then 'super_admin'
    when 'platform_admin' then 'platform_admin'
    when 'platformadmin' then 'platform_admin'
    else lower(trim(coalesce(p_role,'')))
  end
$$;

create or replace function public.gridex_user_is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path=public,auth,pg_temp
as $$
  select auth.uid() is not null and (
    exists(
      select 1 from public.admin_users au
      where au.user_id=auth.uid()
        and coalesce(au.is_active,true)
        and public.gridex_normalize_platform_role(au.role)
          in ('super_admin','platform_admin')
    )
    or exists(
      select 1
      from public.user_roles ur
      left join public.roles r on r.id=ur.role_id
      where ur.user_id=auth.uid()
        and coalesce(ur.is_active,true)
        and coalesce(ur.status,'active')='active'
        and public.gridex_normalize_platform_role(
          coalesce(ur.role,r.key,r.name)
        ) in ('super_admin','platform_admin')
    )
  )
$$;

create or replace function public.gridex_contract_actor_has_permission(
  p_actor_user_id uuid,
  p_permission text
) returns boolean
language sql
stable
security definer
set search_path=public,auth,pg_temp
as $$
  select p_actor_user_id is not null
    and (coalesce(auth.role(),'')='service_role' or p_actor_user_id=auth.uid())
    and (
      exists(
        select 1 from public.admin_users au
        where au.user_id=p_actor_user_id
          and coalesce(au.is_active,true)
          and public.gridex_normalize_platform_role(au.role)
            in ('super_admin','platform_admin')
      )
      or exists(
        select 1
        from public.user_roles ur
        left join public.roles r on r.id=ur.role_id
        where ur.user_id=p_actor_user_id
          and coalesce(ur.status,'active')='active'
          and coalesce(ur.is_active,true)
          and public.gridex_normalize_platform_role(
            coalesce(ur.role,r.key,r.name)
          ) in ('super_admin','platform_admin')
      )
      or public.gridex_has_permission(p_actor_user_id,p_permission)
    )
$$;

revoke all on function public.gridex_normalize_platform_role(text)
  from public,anon;
grant execute on function public.gridex_normalize_platform_role(text)
  to authenticated,service_role;
revoke all on function public.gridex_contract_actor_has_permission(uuid,text)
  from public,anon,authenticated;
grant execute on function public.gridex_contract_actor_has_permission(uuid,text)
  to service_role;

-- Canonical billing/export identities. The old partner_export_id column on
-- customer_invoices remains readable for compatibility but is no longer the
-- canonical invoice-export relation.
alter table public.billing_underlays
  add column if not exists customer_contract_id uuid;
update public.billing_underlays
set customer_contract_id=contract_id
where customer_contract_id is null and contract_id is not null;

alter table public.customer_supply_periods
  add column if not exists customer_contract_id uuid;
update public.customer_supply_periods
set customer_contract_id=contract_id
where customer_contract_id is null and contract_id is not null;

alter table public.invoice_export_items
  add column if not exists customer_contract_id uuid,
  add column if not exists metering_point_id uuid,
  add column if not exists period_start date,
  add column if not exists period_end date,
  add column if not exists total_kwh numeric,
  add column if not exists currency text not null default 'SEK',
  add column if not exists billing_export_run_item_id uuid;
alter table public.invoice_export_runs
  add column if not exists idempotency_key text;

alter table public.customer_invoices
  add column if not exists contract_id uuid,
  add column if not exists customer_contract_id uuid,
  add column if not exists invoice_export_item_id uuid,
  add column if not exists canonical_export_item_id uuid;

alter table public.website_customer_applications
  add column if not exists quote_reference text,
  add column if not exists contract_product_version_id uuid
    references public.contract_product_versions(id) on delete restrict;
alter table public.customer_contracts
  add column if not exists quote_reference text;

-- Older application rows only stored the public offer identity. Recover the
-- immutable product version through that same-tenant canonical relation; do
-- not infer a version from mutable names, price plans or "latest" rows.
update public.website_customer_applications a
set contract_product_version_id=pco.contract_product_version_id
from public.public_contract_offers pco
where a.contract_product_version_id is null
  and a.public_contract_offer_id=pco.id
  and a.company_id=pco.company_id
  and pco.contract_product_version_id is not null;

update public.website_customer_applications
set quote_reference=coalesce(
  nullif(response_payload->>'quote_reference',''),
  nullif(payload->>'quote_reference',''),
  nullif(payload->'contract'->>'quote_reference','')
)
where quote_reference is null
  and coalesce(
    nullif(response_payload->>'quote_reference',''),
    nullif(payload->>'quote_reference',''),
    nullif(payload->'contract'->>'quote_reference','')
  ) is not null;
create index if not exists website_customer_applications_company_quote_idx
  on public.website_customer_applications(company_id,quote_reference)
  where quote_reference is not null;
create index if not exists customer_contracts_company_quote_idx
  on public.customer_contracts(company_id,quote_reference)
  where quote_reference is not null;

create or replace function public.gridex_enforce_quote_binding_v1()
returns trigger
language plpgsql
security invoker
set search_path=public,pg_temp
as $$
declare
  v_row jsonb:=to_jsonb(new);
  v_quote public.website_contract_quotes%rowtype;
  v_quote_reference text:=nullif(v_row->>'quote_reference','');
  v_version_id uuid:=nullif(v_row->>'contract_product_version_id','')::uuid;
begin
  if v_quote_reference is null then return new; end if;
  select * into v_quote
  from public.website_contract_quotes q
  where q.company_id=nullif(v_row->>'company_id','')::uuid
    and q.quote_reference=v_quote_reference;
  if not found then
    raise exception using errcode='23503',message='quote_binding_not_found_for_tenant';
  end if;
  if v_version_id is not null
     and v_quote.contract_product_version_id is distinct from v_version_id then
    raise exception using errcode='23514',message='quote_binding_contract_version_mismatch';
  end if;
  return new;
end
$$;

drop trigger if exists website_application_quote_binding_v1
  on public.website_customer_applications;
create trigger website_application_quote_binding_v1
before insert or update of company_id,quote_reference,contract_product_version_id
on public.website_customer_applications
for each row execute function public.gridex_enforce_quote_binding_v1();
drop trigger if exists customer_contract_quote_binding_v1
  on public.customer_contracts;
create trigger customer_contract_quote_binding_v1
before insert or update of company_id,quote_reference,contract_product_version_id
on public.customer_contracts
for each row execute function public.gridex_enforce_quote_binding_v1();

update public.customer_invoices ci
set invoice_export_item_id=ci.partner_export_id,
    canonical_export_item_id=ci.partner_export_id
where ci.invoice_export_item_id is null
  and ci.partner_export_id is not null
  and exists(
    select 1 from public.invoice_export_items iei
    where iei.id=ci.partner_export_id and iei.company_id=ci.company_id
  );
update public.customer_invoices ci
set customer_contract_id=coalesce(
      ci.customer_contract_id,
      iei.customer_contract_id
    ),
    contract_id=coalesce(
      ci.contract_id,
      iei.customer_contract_id
    )
from public.invoice_export_items iei
where iei.id=ci.invoice_export_item_id
  and iei.company_id=ci.company_id;
update public.customer_invoices ci
set customer_contract_id=coalesce(
      ci.customer_contract_id,
      bu.customer_contract_id,
      bu.contract_id
    ),
    contract_id=coalesce(
      ci.contract_id,
      bu.customer_contract_id,
      bu.contract_id
    )
from public.billing_underlays bu
where bu.id=ci.billing_underlay_id
  and bu.company_id=ci.company_id;

create unique index if not exists customer_contracts_company_id_id_uidx
  on public.customer_contracts(company_id,id);
create unique index if not exists invoice_export_items_company_id_id_uidx
  on public.invoice_export_items(company_id,id);
create unique index if not exists customer_invoices_company_export_item_uidx
  on public.customer_invoices(company_id,invoice_export_item_id)
  where invoice_export_item_id is not null;
create unique index if not exists invoice_export_items_company_legacy_bridge_uidx
  on public.invoice_export_items(company_id,billing_export_run_item_id)
  where billing_export_run_item_id is not null;
create unique index if not exists invoice_export_runs_company_idempotency_uidx
  on public.invoice_export_runs(company_id,idempotency_key)
  where idempotency_key is not null;

alter table public.billing_underlays
  drop constraint if exists billing_underlays_company_customer_contract_fkey;
alter table public.billing_underlays
  add constraint billing_underlays_company_customer_contract_fkey
  foreign key(company_id,customer_contract_id)
  references public.customer_contracts(company_id,id) not valid;
alter table public.customer_supply_periods
  drop constraint if exists customer_supply_periods_company_customer_contract_fkey;
alter table public.customer_supply_periods
  add constraint customer_supply_periods_company_customer_contract_fkey
  foreign key(company_id,customer_contract_id)
  references public.customer_contracts(company_id,id) not valid;
alter table public.invoice_export_items
  drop constraint if exists invoice_export_items_company_customer_contract_fkey;
alter table public.invoice_export_items
  add constraint invoice_export_items_company_customer_contract_fkey
  foreign key(company_id,customer_contract_id)
  references public.customer_contracts(company_id,id) not valid;
alter table public.customer_invoices
  drop constraint if exists customer_invoices_company_customer_contract_fkey;
alter table public.customer_invoices
  add constraint customer_invoices_company_customer_contract_fkey
  foreign key(company_id,customer_contract_id)
  references public.customer_contracts(company_id,id) not valid;
alter table public.customer_invoices
  drop constraint if exists customer_invoices_company_invoice_export_item_fkey;
alter table public.customer_invoices
  add constraint customer_invoices_company_invoice_export_item_fkey
  foreign key(company_id,invoice_export_item_id)
  references public.invoice_export_items(company_id,id) not valid;

create or replace function public.gridex_enforce_customer_contract_chain_v1()
returns trigger
language plpgsql
security invoker
set search_path=public,pg_temp
as $$
declare
  v_row jsonb:=to_jsonb(new);
  v_company_id uuid:=nullif(v_row->>'company_id','')::uuid;
  v_customer_id uuid:=nullif(v_row->>'customer_id','')::uuid;
  v_contract_id uuid:=coalesce(
    nullif(v_row->>'customer_contract_id','')::uuid,
    nullif(v_row->>'contract_id','')::uuid
  );
  v_metering_point_id uuid:=nullif(v_row->>'metering_point_id','')::uuid;
  v_underlay_id uuid:=nullif(v_row->>'billing_underlay_id','')::uuid;
  v_export_item_id uuid:=coalesce(
    nullif(v_row->>'invoice_export_item_id','')::uuid,
    nullif(v_row->>'canonical_export_item_id','')::uuid
  );
begin
  if v_company_id is null or v_customer_id is null then
    raise exception using errcode='23502',message='customer_chain_company_customer_required';
  end if;
  if v_contract_id is not null and not exists(
    select 1 from public.customer_contracts cc
    where cc.id=v_contract_id
      and cc.company_id=v_company_id
      and cc.customer_id=v_customer_id
  ) then
    raise exception using errcode='23514',message='customer_chain_contract_mismatch';
  end if;
  if v_metering_point_id is not null and not exists(
    select 1 from public.metering_points mp
    where mp.id=v_metering_point_id
      and mp.company_id=v_company_id
      and mp.customer_id=v_customer_id
  ) then
    raise exception using errcode='23514',message='customer_chain_metering_point_mismatch';
  end if;
  if v_underlay_id is not null and not exists(
    select 1 from public.billing_underlays bu
    where bu.id=v_underlay_id
      and bu.company_id=v_company_id
      and bu.customer_id=v_customer_id
      and (
        v_contract_id is null
        or coalesce(bu.customer_contract_id,bu.contract_id)=v_contract_id
      )
  ) then
    raise exception using errcode='23514',message='customer_chain_underlay_mismatch';
  end if;
  if v_export_item_id is not null and not exists(
    select 1 from public.invoice_export_items iei
    where iei.id=v_export_item_id
      and iei.company_id=v_company_id
      and iei.customer_id=v_customer_id
      and (
        v_contract_id is null
        or iei.customer_contract_id=v_contract_id
      )
  ) then
    raise exception using errcode='23514',message='customer_chain_export_item_mismatch';
  end if;
  return new;
end
$$;

create or replace function public.gridex_sync_supply_customer_contract_v1()
returns trigger
language plpgsql
security invoker
set search_path=public,pg_temp
as $$
begin
  if new.contract_id is not null and new.customer_contract_id is not null
     and new.contract_id is distinct from new.customer_contract_id then
    raise exception using errcode='23514',message='supply_contract_alias_mismatch';
  end if;
  new.customer_contract_id:=coalesce(new.customer_contract_id,new.contract_id);
  new.contract_id:=coalesce(new.contract_id,new.customer_contract_id);
  return new;
end
$$;

drop trigger if exists a_customer_supply_periods_contract_alias_v1
  on public.customer_supply_periods;
create trigger a_customer_supply_periods_contract_alias_v1
before insert or update of contract_id,customer_contract_id
on public.customer_supply_periods
for each row execute function public.gridex_sync_supply_customer_contract_v1();

drop trigger if exists billing_underlays_customer_chain_v1
  on public.billing_underlays;
create trigger billing_underlays_customer_chain_v1
before insert or update of company_id,customer_id,contract_id,
  customer_contract_id,metering_point_id
on public.billing_underlays
for each row execute function public.gridex_enforce_customer_contract_chain_v1();

drop trigger if exists customer_supply_periods_customer_chain_v1
  on public.customer_supply_periods;
create trigger customer_supply_periods_customer_chain_v1
before insert or update of company_id,customer_id,contract_id,
  customer_contract_id,metering_point_id
on public.customer_supply_periods
for each row execute function public.gridex_enforce_customer_contract_chain_v1();

drop trigger if exists invoice_export_items_customer_chain_v1
  on public.invoice_export_items;
create trigger invoice_export_items_customer_chain_v1
before insert or update of company_id,customer_id,customer_contract_id,
  metering_point_id,billing_underlay_id
on public.invoice_export_items
for each row execute function public.gridex_enforce_customer_contract_chain_v1();

drop trigger if exists customer_invoices_customer_chain_v1
  on public.customer_invoices;
create trigger customer_invoices_customer_chain_v1
before insert or update of company_id,customer_id,contract_id,
  customer_contract_id,billing_underlay_id,invoice_export_item_id,
  canonical_export_item_id
on public.customer_invoices
for each row execute function public.gridex_enforce_customer_contract_chain_v1();

-- Reserve the canonical run, its export items and the customer invoice mirrors
-- in one transaction. Provider network calls happen only after this commit.
create or replace function public.gridex_create_invoice_export_graph_v1(
  p_run jsonb,
  p_items jsonb,
  p_invoices jsonb
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_company_id uuid:=nullif(p_run->>'company_id','')::uuid;
  v_run_id uuid:=coalesce(nullif(p_run->>'id','')::uuid,gen_random_uuid());
  v_idempotency_key text:=nullif(p_run->>'idempotency_key','');
  v_existing_id uuid;
  v_item jsonb;
  v_invoice jsonb;
  v_underlay public.billing_underlays%rowtype;
  v_export_item_id uuid;
  v_count integer:=0;
begin
  if auth.role()<>'service_role' then
    raise exception using errcode='42501',message='invoice_export_graph_service_role_required';
  end if;
  if v_company_id is null or v_idempotency_key is null then
    raise exception using errcode='22023',message='invoice_export_company_idempotency_required';
  end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array'
     or jsonb_typeof(coalesce(p_invoices,'[]'::jsonb))<>'array'
     or jsonb_array_length(coalesce(p_items,'[]'::jsonb))
        <>jsonb_array_length(coalesce(p_invoices,'[]'::jsonb)) then
    raise exception using errcode='22023',message='invoice_export_graph_array_mismatch';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(v_company_id::text||':'||v_idempotency_key,0)
  );
  select id into v_existing_id
  from public.invoice_export_runs
  where company_id=v_company_id and idempotency_key=v_idempotency_key;
  if v_existing_id is not null then
    return jsonb_build_object('run_id',v_existing_id,'existing',true);
  end if;

  insert into public.invoice_export_runs(
    id,company_id,provider,environment,billing_month,financing_mode,status,
    total_items,readiness_snapshot,metadata,requested_by,idempotency_key
  ) values (
    v_run_id,v_company_id,coalesce(nullif(p_run->>'provider',''),'capway_aptic'),
    coalesce(nullif(p_run->>'environment',''),'test'),p_run->>'billing_month',
    coalesce(nullif(p_run->>'financing_mode',''),'invoice_service'),'draft',
    jsonb_array_length(p_items),coalesce(p_run->'readiness_snapshot','{}'::jsonb),
    coalesce(p_run->'metadata','{}'::jsonb),nullif(p_run->>'requested_by','')::uuid,
    v_idempotency_key
  );

  for v_item,v_invoice in
    select i.value,n.value
    from jsonb_array_elements(p_items) with ordinality i(value,ordinality)
    join jsonb_array_elements(p_invoices) with ordinality n(value,ordinality)
      using(ordinality)
  loop
    v_export_item_id:=nullif(v_item->>'id','')::uuid;
    select * into v_underlay
    from public.billing_underlays
    where id=nullif(v_item->>'billing_underlay_id','')::uuid
      and company_id=v_company_id
    for share;
    if not found
       or v_underlay.customer_id is distinct from nullif(v_item->>'customer_id','')::uuid
       or coalesce(v_underlay.customer_contract_id,v_underlay.contract_id)
          is distinct from nullif(v_item->>'customer_contract_id','')::uuid then
      raise exception using errcode='23514',message='invoice_export_underlay_customer_contract_mismatch';
    end if;
    insert into public.invoice_export_items(
      id,company_id,export_run_id,customer_id,billing_underlay_id,
      pricing_run_id,customer_contract_id,metering_point_id,period_start,
      period_end,total_kwh,currency,provider,environment,status,financing_mode,
      amount_ex_vat,vat_amount,amount_inc_vat,idempotency_key,metadata
    ) values (
      v_export_item_id,v_company_id,v_run_id,nullif(v_item->>'customer_id','')::uuid,
      v_underlay.id,nullif(v_item->>'pricing_run_id','')::uuid,
      nullif(v_item->>'customer_contract_id','')::uuid,
      nullif(v_item->>'metering_point_id','')::uuid,
      nullif(v_item->>'period_start','')::date,nullif(v_item->>'period_end','')::date,
      nullif(v_item->>'total_kwh','')::numeric,
      coalesce(nullif(v_item->>'currency',''),'SEK'),
      coalesce(nullif(v_item->>'provider',''),'capway_aptic'),
      coalesce(nullif(v_item->>'environment',''),'test'),'pending',
      coalesce(nullif(v_item->>'financing_mode',''),'invoice_service'),
      coalesce(nullif(v_item->>'amount_ex_vat','')::numeric,0),
      coalesce(nullif(v_item->>'vat_amount','')::numeric,0),
      coalesce(nullif(v_item->>'amount_inc_vat','')::numeric,0),
      nullif(v_item->>'idempotency_key',''),coalesce(v_item->'metadata','{}'::jsonb)
    );
    if nullif(v_invoice->>'invoice_export_item_id','')::uuid is distinct from v_export_item_id
       or nullif(v_invoice->>'customer_id','')::uuid is distinct from v_underlay.customer_id
       or nullif(v_invoice->>'customer_contract_id','')::uuid
          is distinct from coalesce(v_underlay.customer_contract_id,v_underlay.contract_id) then
      raise exception using errcode='23514',message='customer_invoice_export_identity_mismatch';
    end if;
    insert into public.customer_invoices(
      company_id,customer_id,contract_id,customer_contract_id,
      billing_underlay_id,partner_export_id,invoice_export_item_id,
      canonical_export_item_id,
      period_start,period_end,total_kwh,amount_ex_vat,vat_amount,amount_inc_vat,
      currency,status,source_system,metadata,updated_at
    ) values (
      v_company_id,v_underlay.customer_id,
      coalesce(v_underlay.customer_contract_id,v_underlay.contract_id),
      coalesce(v_underlay.customer_contract_id,v_underlay.contract_id),
      v_underlay.id,v_export_item_id,v_export_item_id,v_export_item_id,
      nullif(v_invoice->>'period_start','')::date,
      nullif(v_invoice->>'period_end','')::date,
      nullif(v_invoice->>'total_kwh','')::numeric,
      coalesce(nullif(v_invoice->>'amount_ex_vat','')::numeric,0),
      coalesce(nullif(v_invoice->>'vat_amount','')::numeric,0),
      coalesce(nullif(v_invoice->>'amount_inc_vat','')::numeric,0),
      coalesce(nullif(v_invoice->>'currency',''),'SEK'),'draft',
      'canonical_invoice_export',coalesce(v_invoice->'metadata','{}'::jsonb),now()
    );
    v_count:=v_count+1;
  end loop;
  return jsonb_build_object(
    'run_id',v_run_id,'existing',false,'item_count',v_count
  );
end
$$;

revoke all on function public.gridex_create_invoice_export_graph_v1(
  jsonb,jsonb,jsonb
) from public,anon,authenticated;
grant execute on function public.gridex_create_invoice_export_graph_v1(
  jsonb,jsonb,jsonb
) to service_role;

-- The canonical underlay writer must persist the new canonical contract column;
-- otherwise a blocked no-meter-values row would lose the same-contract proof.
do $repair_underlay_writer$
declare
  v_before text;
  v_after text;
  v_columns text:='metering_point_id,supply_period_id,contract_id,pricing_snapshot_id';
  v_columns_new text:='metering_point_id,supply_period_id,contract_id,customer_contract_id,pricing_snapshot_id';
  v_values text:=$needle$
    nullif(p_underlay->>'supply_period_id','')::uuid,nullif(p_underlay->>'contract_id','')::uuid,nullif(p_underlay->>'pricing_snapshot_id','')::uuid,
$needle$;
  v_values_new text:=$needle$
    nullif(p_underlay->>'supply_period_id','')::uuid,nullif(p_underlay->>'contract_id','')::uuid,
    coalesce(nullif(p_underlay->>'customer_contract_id','')::uuid,nullif(p_underlay->>'contract_id','')::uuid),
    nullif(p_underlay->>'pricing_snapshot_id','')::uuid,
$needle$;
  v_update text:='supply_period_id=excluded.supply_period_id,contract_id=excluded.contract_id,';
  v_update_new text:='supply_period_id=excluded.supply_period_id,contract_id=excluded.contract_id,customer_contract_id=excluded.customer_contract_id,';
begin
  select pg_get_functiondef(
    'public.gridex_store_billing_underlay(uuid,jsonb,jsonb,uuid)'::regprocedure
  ) into v_before;
  if position(v_columns in v_before)=0
     or position(v_values in v_before)=0
     or position(v_update in v_before)=0 then
    raise exception using
      errcode='55000',
      message='billing_underlay_writer_final_definition_mismatch';
  end if;
  v_after:=replace(v_before,v_columns,v_columns_new);
  v_after:=replace(v_after,v_values,v_values_new);
  v_after:=replace(v_after,v_update,v_update_new);
  execute v_after;
end
$repair_underlay_writer$;

-- The admin list is deliberately cheap and failure-isolated. Full readiness
-- and the deletion graph are commands loaded for one offer at a time.
drop view if exists public.canonical_internal_contract_offers_v;
create view public.canonical_internal_contract_offers_v
with (security_invoker=true)
as
select
  o.*,
  cp.product_code as canonical_product_code,
  cp.status as canonical_product_status,
  cpv.version_number as canonical_version_number,
  cpv.status as canonical_version_status,
  cpv.content_sha256 as canonical_content_sha256,
  null::jsonb as readiness,
  null::jsonb as deletion_preview,
  case
    when o.contract_product_version_id is null then 'missing_product_version'
    when cpv.id is null then 'broken_product_version'
    when cp.id is null then 'missing_product'
    else 'ok'
  end as relation_status,
  coalesce((
    select ch.status
    from public.tenant_contract_assignments ta
    join public.tenant_contract_channels ch on ch.assignment_id=ta.id
    where ta.company_id=o.company_id
      and ta.contract_product_version_id=o.contract_product_version_id
      and ch.channel='internal'
    order by ch.updated_at desc nulls last,ch.id
    limit 1
  ),'missing') as internal_channel_status,
  coalesce((
    select ch.status
    from public.tenant_contract_assignments ta
    join public.tenant_contract_channels ch on ch.assignment_id=ta.id
    where ta.company_id=o.company_id
      and ta.contract_product_version_id=o.contract_product_version_id
      and ch.channel='website'
    order by ch.updated_at desc nulls last,ch.id
    limit 1
  ),'missing') as website_channel_status,
  coalesce((
    select ch.status
    from public.tenant_contract_assignments ta
    join public.tenant_contract_channels ch on ch.assignment_id=ta.id
    where ta.company_id=o.company_id
      and ta.contract_product_version_id=o.contract_product_version_id
      and ch.channel='api'
    order by ch.updated_at desc nulls last,ch.id
    limit 1
  ),'missing') as api_channel_status,
  exists(
    select 1
    from public.tenant_contract_assignments ta
    join public.tenant_contract_channels ch on ch.assignment_id=ta.id
    where ta.company_id=o.company_id
      and ta.contract_product_version_id=o.contract_product_version_id
      and ta.status='active'
      and ta.internal_sales_allowed
      and ch.channel='internal'
      and ch.status='active'
      and (ch.valid_from is null or ch.valid_from<=now())
      and (ch.valid_to is null or ch.valid_to>=now())
  ) and o.lifecycle_status='published'
    and (o.valid_from is null or o.valid_from<=current_date)
    and (o.valid_to is null or o.valid_to>=current_date)
    as currently_sellable
from public.contract_offers o
left join public.contract_product_versions cpv
  on cpv.id=o.contract_product_version_id
 and cpv.contract_product_id=o.contract_product_id
left join public.contract_products cp
  on cp.id=o.contract_product_id;

revoke all on public.canonical_internal_contract_offers_v from public,anon;
grant select on public.canonical_internal_contract_offers_v to authenticated,service_role;

comment on view public.canonical_internal_contract_offers_v is
  'Cheap tenant-safe admin list. Never executes readiness or deletion graph per row; relation_status exposes broken canonical links.';

-- Versioned wrapper around the existing atomic command. It fails the same
-- transaction unless every canonical identity and the tenant assignment can be
-- proven to belong to the requested company.
create or replace function public.gridex_upsert_internal_contract_offer_v2(
  p_company_id uuid,
  p_offer_id uuid,
  p_payload jsonb,
  p_pricing_snapshot jsonb,
  p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_result jsonb;
  v_offer_id uuid;
  v_product_id uuid;
  v_version_id uuid;
  v_assignment_id uuid;
begin
  v_result:=public.gridex_upsert_internal_contract_offer(
    p_company_id,p_offer_id,p_payload,p_pricing_snapshot,p_actor_user_id
  );
  v_offer_id:=nullif(v_result#>>'{offer,id}','')::uuid;
  v_product_id:=nullif(v_result->>'contract_product_id','')::uuid;
  v_version_id:=nullif(v_result->>'contract_product_version_id','')::uuid;

  if v_offer_id is null or v_product_id is null or v_version_id is null then
    raise exception using errcode='23502',message='contract_create_canonical_ids_incomplete';
  end if;
  if not exists(
    select 1
    from public.contract_offers o
    join public.contract_products cp
      on cp.id=o.contract_product_id
    join public.contract_product_versions cpv
      on cpv.id=o.contract_product_version_id
     and cpv.contract_product_id=cp.id
    where o.id=v_offer_id
      and o.company_id=p_company_id
      and cp.id=v_product_id
      and cpv.id=v_version_id
  ) then
    raise exception using errcode='23514',message='contract_create_canonical_graph_mismatch';
  end if;

  select ta.id into v_assignment_id
  from public.tenant_contract_assignments ta
  where ta.company_id=p_company_id
    and ta.contract_product_version_id=v_version_id
  order by ta.created_at desc,ta.id
  limit 1;
  if v_assignment_id is null then
    raise exception using errcode='23502',message='contract_create_tenant_assignment_missing';
  end if;

  return v_result||jsonb_build_object(
    'tenant_contract_assignment_id',v_assignment_id,
    'company_id',p_company_id
  );
end
$$;

revoke all on function public.gridex_upsert_internal_contract_offer_v2(
  uuid,uuid,jsonb,jsonb,uuid
) from public,anon;
grant execute on function public.gridex_upsert_internal_contract_offer_v2(
  uuid,uuid,jsonb,jsonb,uuid
) to authenticated,service_role;

-- A submitted/sent request is not a confirmed delivery start. Tighten the
-- already versioned activation RPC while retaining its exact signature.
do $repair_activation$
declare
  v_before text;
  v_after text;
  v_old_statuses text:=$needle$
  if v_switch.status not in (
    'queued',
    'submitted',
    'sent',
    'waiting_response',
    'awaiting_confirmation',
    'confirmed',
    'accepted',
    'completed'
  ) then
$needle$;
  v_new_statuses text:=$needle$
  if v_switch.status not in (
    'confirmed',
    'accepted',
    'completed'
  ) then
$needle$;
  v_start_marker text:=$needle$
  v_start_date := coalesce(
$needle$;
  v_integrity_guard text:=$needle$
  if not exists(
    select 1
    from public.customer_contracts cc
    join public.metering_points mp
      on mp.id=v_switch.metering_point_id
     and mp.company_id=cc.company_id
     and mp.customer_id=cc.customer_id
    left join public.customer_sites cs
      on cs.id=coalesce(v_switch.customer_site_id,v_switch.site_id)
     and cs.company_id=cc.company_id
     and cs.customer_id=cc.customer_id
    where cc.id=v_contract_id
      and cc.company_id=p_company_id
      and cc.customer_id=v_switch.customer_id
      and (
        coalesce(v_switch.customer_site_id,v_switch.site_id) is null
        or cs.id is not null
      )
  ) then
    raise exception using
      errcode='23514',
      message='supply_activation_customer_contract_site_meter_mismatch';
  end if;

  v_start_date := coalesce(
$needle$;
begin
  select pg_get_functiondef(
    'public.activate_customer_supply_v1(uuid,uuid,uuid,date,uuid,text)'::regprocedure
  ) into v_before;
  if position(v_old_statuses in v_before)=0
     or position(v_start_marker in v_before)=0 then
    raise exception using
      errcode='55000',
      message='supply_activation_final_definition_mismatch';
  end if;
  v_after:=replace(v_before,v_old_statuses,v_new_statuses);
  v_after:=replace(v_after,v_start_marker,v_integrity_guard);
  execute v_after;
end
$repair_activation$;

-- Repair the final onboarding RPC in place without changing its signature or
-- return type. Facility/meter identities are delivery-point evidence and may
-- no longer select a legal customer.
do $repair_onboarding$
declare
  v_before text;
  v_after text;
  v_delivery_candidates text:=$needle$
        union all
        select s.customer_id
          from public.customer_sites s
         where s.company_id = v_company_id
           and nullif(btrim(v_site_payload->>'facility_id'), '') is not null
           and s.normalized_facility_id = public.gridex_normalize_facility_id(v_site_payload->>'facility_id')
        union all
        select m.customer_id
          from public.metering_points m
         where m.company_id = v_company_id
           and nullif(btrim(coalesce(v_meter_payload->>'meter_point_id', v_meter_payload->>'metering_point_id')), '') is not null
           and m.normalized_metering_point_id = public.gridex_normalize_metering_point_id(coalesce(v_meter_payload->>'meter_point_id', v_meter_payload->>'metering_point_id'))
$needle$;
  v_selected_guard text:=$needle$
    v_candidate_ids := array[v_existing_customer_id];
$needle$;
  v_selected_guard_replacement text:=$needle$
    if exists(
      select 1
      from public.customers c
      where c.id=v_existing_customer_id
        and c.company_id=v_company_id
        and (
          (
            nullif(btrim(v_customer_payload->>'personal_number'),'') is not null
            and c.normalized_personal_number is distinct from
                public.gridex_normalize_personal_number(v_customer_payload->>'personal_number')
          )
          or (
            nullif(btrim(v_customer_payload->>'org_number'),'') is not null
            and c.normalized_org_number is distinct from
                public.gridex_normalize_org_number(v_customer_payload->>'org_number')
          )
          or (
            nullif(btrim(v_customer_payload->>'customer_type'),'') is not null
            and lower(coalesce(c.customer_type,'')) is distinct from
                lower(v_customer_payload->>'customer_type')
          )
        )
    ) then
      raise exception using
        errcode='23514',
        message='selected_customer_legal_identity_mismatch',
        detail=jsonb_build_object(
          'requires_manual_review',true,
          'match_method','selected_customer',
          'match_strength','conflicting',
          'conflicting_identifiers',jsonb_build_array(
            'customer_type','personal_number','org_number'
          )
        )::text;
    end if;
    v_candidate_ids := array[v_existing_customer_id];
$needle$;
begin
  select pg_get_functiondef(
    'public.gridex_onboard_customer_graph(jsonb)'::regprocedure
  ) into v_before;
  if position(v_delivery_candidates in v_before)=0
     or position(v_selected_guard in v_before)=0 then
    raise exception using
      errcode='55000',
      message='canonical_onboarding_final_definition_mismatch',
      hint='Inspect gridex_onboard_customer_graph before applying this migration.';
  end if;
  v_after:=replace(v_before,v_delivery_candidates,'');
  v_after:=replace(v_after,v_selected_guard,v_selected_guard_replacement);
  execute v_after;
end
$repair_onboarding$;

commit;
