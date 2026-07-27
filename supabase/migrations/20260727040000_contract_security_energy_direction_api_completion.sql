-- GRIDEX OPS: close the remaining contract RPC grant surface and bind energy
-- direction plus every canonical pricing identity through quote/application.
-- Forward-only migration; historical migrations remain immutable.

begin;

-- ---------------------------------------------------------------------------
-- 1. First-class energy direction on internal products and offers.
-- ---------------------------------------------------------------------------
alter table public.contract_products
  add column if not exists energy_direction text;
alter table public.contract_product_versions
  add column if not exists energy_direction text;
alter table public.contract_publication_versions
  add column if not exists energy_direction text;
alter table public.contract_offers
  add column if not exists energy_direction text;
alter table public.public_contract_offers
  add column if not exists energy_direction text;

update public.contract_offers o
set energy_direction=coalesce(
  nullif(o.energy_direction,''),
  nullif(o.commercial_snapshot->>'energy_direction',''),
  nullif(o.version_snapshot#>>'{pricing_snapshot,energy_direction}',''),
  case when coalesce(
    (o.commercial_snapshot#>>'{production,enabled}')::boolean,
    (o.version_snapshot#>>'{pricing_snapshot,production,enabled}')::boolean,
    false
  ) then 'production' else 'consumption' end
);

update public.contract_products cp
set energy_direction=coalesce(cp.energy_direction,(
  select o.energy_direction
  from public.contract_offers o
  where o.contract_product_id=cp.id
  order by o.version_number desc,o.created_at desc,o.id desc
  limit 1
));

update public.contract_products set energy_direction='consumption'
where energy_direction is null;

-- Historical immutable rows need a one-time canonical backfill. The immutable
-- guards are recreated in the same transaction before any application write.
drop trigger if exists contract_product_versions_immutable
  on public.contract_product_versions;
drop trigger if exists contract_publication_versions_immutable
  on public.contract_publication_versions;
select set_config('gridex.public_offer_write','on',true);

update public.contract_product_versions cpv
set energy_direction=coalesce(
  nullif(cpv.energy_direction,''),
  nullif(cpv.commercial_snapshot->>'energy_direction',''),
  nullif(cpv.commercial_snapshot#>>'{pricing_snapshot,energy_direction}',''),
  case when coalesce(
    (cpv.commercial_snapshot#>>'{production,enabled}')::boolean,
    (cpv.commercial_snapshot#>>'{pricing_snapshot,production,enabled}')::boolean,
    false
  ) then 'production' else null end,
  cp.energy_direction,
  'consumption'
)
from public.contract_products cp
where cp.id=cpv.contract_product_id;

update public.contract_product_versions
set energy_direction='consumption'
where energy_direction is null;

update public.contract_publication_versions publication_version
set energy_direction=coalesce(
  nullif(publication_version.energy_direction,''),
  nullif(publication_version.publication_snapshot->>'energy_direction',''),
  product_version.energy_direction
)
from public.contract_product_versions product_version
where product_version.id=publication_version.contract_product_version_id;

update public.contract_publication_versions
set energy_direction='consumption'
where energy_direction is null;

update public.public_contract_offers public_offer
set energy_direction=coalesce(
  nullif(public_offer.energy_direction,''),
  (
    select publication_version.energy_direction
    from public.contract_publication_versions publication_version
    where publication_version.id=public_offer.contract_publication_version_id
  ),
  (
    select product_version.energy_direction
    from public.contract_product_versions product_version
    where product_version.id=public_offer.contract_product_version_id
  ),
  (
    select source_offer.energy_direction
    from public.contract_offers source_offer
    where source_offer.id=public_offer.source_contract_offer_id
      and source_offer.company_id=public_offer.company_id
  ),
  nullif(public_offer.metadata->>'energy_direction',''),
  (
    select product.energy_direction
    from public.contract_products product
    where product.id=public_offer.contract_product_id
  ),
  'consumption'
);

update public.contract_offers set energy_direction='consumption'
where energy_direction is null;

alter table public.contract_products
  alter column energy_direction set not null,
  alter column energy_direction set default 'consumption';
alter table public.contract_product_versions
  alter column energy_direction set not null,
  alter column energy_direction drop default;
alter table public.contract_publication_versions
  alter column energy_direction set not null,
  alter column energy_direction drop default;
alter table public.contract_offers
  alter column energy_direction set not null,
  alter column energy_direction set default 'consumption';
alter table public.public_contract_offers
  alter column energy_direction set not null,
  alter column energy_direction drop default;

alter table public.contract_products
  drop constraint if exists contract_products_energy_direction_check;
alter table public.contract_products
  add constraint contract_products_energy_direction_check
  check(energy_direction in ('consumption','production'));
alter table public.contract_product_versions
  drop constraint if exists contract_product_versions_energy_direction_check;
alter table public.contract_product_versions
  add constraint contract_product_versions_energy_direction_check
  check(energy_direction in ('consumption','production'));
alter table public.contract_publication_versions
  drop constraint if exists contract_publication_versions_energy_direction_check;
alter table public.contract_publication_versions
  add constraint contract_publication_versions_energy_direction_check
  check(energy_direction in ('consumption','production'));
alter table public.contract_offers
  drop constraint if exists contract_offers_energy_direction_check;
alter table public.contract_offers
  add constraint contract_offers_energy_direction_check
  check(energy_direction in ('consumption','production'));
alter table public.public_contract_offers
  drop constraint if exists public_contract_offers_energy_direction_check;
alter table public.public_contract_offers
  add constraint public_contract_offers_energy_direction_check
  check(energy_direction in ('consumption','production'));

create index if not exists contract_products_company_energy_direction_idx
  on public.contract_products(company_id,energy_direction,status,created_at desc);
create index if not exists contract_product_versions_direction_idx
  on public.contract_product_versions(contract_product_id,energy_direction,version_number desc,id);
create index if not exists contract_publication_versions_direction_idx
  on public.contract_publication_versions(
    contract_publication_id,energy_direction,version_number desc,id
  );
create index if not exists contract_offers_company_energy_direction_idx
  on public.contract_offers(company_id,energy_direction,lifecycle_status,created_at desc);
create index if not exists public_contract_offers_company_direction_idx
  on public.public_contract_offers(
    company_id,energy_direction,publication_status,valid_from desc,id
  );

-- Keep direction identical across product -> immutable product version ->
-- immutable publication version -> compatibility public offer.
create or replace function public.gridex_contract_energy_direction_guard_v1()
returns trigger
language plpgsql
security invoker
set search_path=public,pg_temp
as $$
declare
  v_expected text;
begin
  if tg_table_name='contract_product_versions' then
    select energy_direction into v_expected
    from public.contract_products
    where id=new.contract_product_id;
  elsif tg_table_name='contract_publication_versions' then
    select energy_direction into v_expected
    from public.contract_product_versions
    where id=new.contract_product_version_id;
  elsif tg_table_name='public_contract_offers' then
    if new.contract_publication_version_id is not null then
      select energy_direction into v_expected
      from public.contract_publication_versions
      where id=new.contract_publication_version_id;
    elsif new.contract_product_version_id is not null then
      select energy_direction into v_expected
      from public.contract_product_versions
      where id=new.contract_product_version_id;
    elsif new.source_contract_offer_id is not null then
      select energy_direction into v_expected
      from public.contract_offers
      where id=new.source_contract_offer_id
        and company_id=new.company_id;
    elsif new.contract_product_id is not null then
      select energy_direction into v_expected
      from public.contract_products
      where id=new.contract_product_id;
    else
      v_expected:=coalesce(
        nullif(new.energy_direction,''),
        nullif(new.metadata->>'energy_direction',''),
        'consumption'
      );
    end if;
  else
    raise exception using errcode='42809',message='energy_direction_guard_wrong_table';
  end if;

  if v_expected is null or v_expected not in ('consumption','production') then
    raise exception using errcode='23514',message='canonical_energy_direction_missing';
  end if;
  if new.energy_direction is not null and new.energy_direction<>v_expected then
    raise exception using errcode='23514',message='canonical_energy_direction_mismatch';
  end if;
  new.energy_direction:=v_expected;
  return new;
end
$$;

drop trigger if exists contract_product_versions_energy_direction_guard
  on public.contract_product_versions;
create trigger contract_product_versions_energy_direction_guard
before insert or update of contract_product_id,energy_direction
on public.contract_product_versions
for each row execute function public.gridex_contract_energy_direction_guard_v1();

drop trigger if exists contract_publication_versions_energy_direction_guard
  on public.contract_publication_versions;
create trigger contract_publication_versions_energy_direction_guard
before insert or update of contract_product_version_id,energy_direction
on public.contract_publication_versions
for each row execute function public.gridex_contract_energy_direction_guard_v1();

drop trigger if exists public_contract_offers_energy_direction_guard
  on public.public_contract_offers;
create trigger public_contract_offers_energy_direction_guard
before insert or update of
  contract_product_id,contract_product_version_id,contract_publication_version_id,
  source_contract_offer_id,energy_direction,metadata
on public.public_contract_offers
for each row execute function public.gridex_contract_energy_direction_guard_v1();

-- Restore immutable guards after the controlled backfill.
create trigger contract_product_versions_immutable
before update or delete on public.contract_product_versions
for each row execute function public.gridex_reject_locked_row_mutation();
create trigger contract_publication_versions_immutable
before update or delete on public.contract_publication_versions
for each row execute function public.gridex_reject_locked_row_mutation();
select set_config('gridex.public_offer_write','off',true);

revoke all on function public.gridex_contract_energy_direction_guard_v1()
  from public,anon,authenticated;
grant execute on function public.gridex_contract_energy_direction_guard_v1()
  to service_role;

-- ---------------------------------------------------------------------------
-- 2. First-class immutable quote/application/contract identities.
-- ---------------------------------------------------------------------------
alter table public.website_contract_quotes
  add column if not exists contract_product_id uuid
    references public.contract_products(id) on delete restrict,
  add column if not exists price_plan_id uuid
    references public.price_plans(id) on delete restrict,
  add column if not exists price_book_id uuid
    references public.price_books(id) on delete restrict,
  add column if not exists energy_direction text;

update public.website_contract_quotes q
set contract_product_id=coalesce(q.contract_product_id,cpv.contract_product_id),
    price_plan_id=coalesce(q.price_plan_id,cpv.price_plan_id),
    energy_direction=coalesce(
      nullif(q.energy_direction,''),
      nullif(q.quote_snapshot->>'energy_direction',''),
      nullif(q.quote_snapshot#>>'{offer,energy_direction}',''),
      nullif(cpv.commercial_snapshot->>'energy_direction',''),
      case when coalesce((cpv.commercial_snapshot#>>'{production,enabled}')::boolean,false)
        then 'production' else 'consumption' end
    )
from public.contract_product_versions cpv
where cpv.id=q.contract_product_version_id;

update public.website_contract_quotes q
set price_plan_id=coalesce(q.price_plan_id,pco.price_plan_id),
    price_book_id=coalesce(q.price_book_id,pco.price_book_id)
from public.public_contract_offers pco
where pco.company_id=q.company_id
  and pco.contract_publication_version_id=q.contract_publication_version_id;

update public.website_contract_quotes
set energy_direction='consumption'
where energy_direction is null;

alter table public.website_contract_quotes
  alter column energy_direction set not null;

alter table public.website_contract_quotes
  drop constraint if exists website_contract_quotes_energy_direction_check;
alter table public.website_contract_quotes
  add constraint website_contract_quotes_energy_direction_check
  check(energy_direction in ('consumption','production'));

create index if not exists website_contract_quotes_canonical_identity_idx
  on public.website_contract_quotes(
    company_id,contract_product_id,contract_product_version_id,
    contract_publication_version_id,price_plan_id,price_plan_version_id,
    price_book_id,legal_bundle_version_id,energy_direction,created_at desc
  );

alter table public.website_customer_applications
  add column if not exists contract_product_id uuid
    references public.contract_products(id) on delete restrict,
  add column if not exists contract_publication_version_id uuid
    references public.contract_publication_versions(id) on delete restrict,
  add column if not exists price_book_id uuid
    references public.price_books(id) on delete restrict,
  add column if not exists legal_bundle_version_id uuid
    references public.legal_bundle_versions(id) on delete restrict,
  add column if not exists energy_direction text;

update public.website_customer_applications a
set contract_product_id=coalesce(a.contract_product_id,q.contract_product_id),
    contract_product_version_id=coalesce(a.contract_product_version_id,q.contract_product_version_id),
    contract_publication_version_id=coalesce(a.contract_publication_version_id,q.contract_publication_version_id),
    price_plan_id=coalesce(a.price_plan_id,q.price_plan_id),
    price_plan_version_id=coalesce(a.price_plan_version_id,q.price_plan_version_id),
    price_book_id=coalesce(a.price_book_id,q.price_book_id),
    legal_bundle_version_id=coalesce(
      a.legal_bundle_version_id,
      q.legal_bundle_version_id
    ),
    energy_direction=coalesce(a.energy_direction,q.energy_direction)
from public.website_contract_quotes q
where q.company_id=a.company_id
  and q.quote_reference=a.quote_reference;

update public.website_customer_applications a
set contract_product_id=coalesce(a.contract_product_id,pco.contract_product_id),
    contract_product_version_id=coalesce(a.contract_product_version_id,pco.contract_product_version_id),
    contract_publication_version_id=coalesce(a.contract_publication_version_id,pco.contract_publication_version_id),
    price_plan_id=coalesce(a.price_plan_id,pco.price_plan_id),
    price_plan_version_id=coalesce(a.price_plan_version_id,pco.price_plan_version_id),
    price_book_id=coalesce(a.price_book_id,pco.price_book_id),
    legal_bundle_version_id=coalesce(
      a.legal_bundle_version_id,
      pco.legal_bundle_version_id
    ),
    energy_direction=coalesce(
      a.energy_direction,
      pco.energy_direction,
      'consumption'
    )
from public.public_contract_offers pco
where pco.company_id=a.company_id
  and pco.id=a.public_contract_offer_id;

alter table public.website_customer_applications
  drop constraint if exists website_customer_applications_energy_direction_check;
alter table public.website_customer_applications
  add constraint website_customer_applications_energy_direction_check
  check(energy_direction is null or energy_direction in ('consumption','production'));

create index if not exists website_customer_applications_canonical_binding_idx
  on public.website_customer_applications(
    company_id,contract_product_id,contract_product_version_id,
    contract_publication_version_id,price_plan_id,price_plan_version_id,
    price_book_id,legal_bundle_version_id,energy_direction,created_at desc
  );

alter table public.customer_contracts
  add column if not exists energy_direction text;

update public.customer_contracts cc
set energy_direction=coalesce(
  nullif(cc.energy_direction,''),
  nullif(cc.commercial_snapshot->>'energy_direction',''),
  nullif(cc.price_snapshot->>'energy_direction',''),
  nullif(cc.price_snapshot#>>'{snapshot_json,energy_direction}',''),
  case when coalesce(
    (cc.commercial_snapshot#>>'{production,enabled}')::boolean,
    (cc.price_snapshot#>>'{production,enabled}')::boolean,
    (cc.price_snapshot#>>'{snapshot_json,production,enabled}')::boolean,
    false
  ) then 'production' else 'consumption' end
);

update public.customer_contracts cc
set energy_direction=q.energy_direction
from public.website_contract_quotes q
where q.company_id=cc.company_id
  and q.quote_reference=cc.quote_reference
  and cc.energy_direction is distinct from q.energy_direction;

update public.customer_contracts
set energy_direction='consumption'
where energy_direction is null;

alter table public.customer_contracts
  alter column energy_direction set not null,
  alter column energy_direction set default 'consumption';
alter table public.customer_contracts
  drop constraint if exists customer_contracts_energy_direction_check;
alter table public.customer_contracts
  add constraint customer_contracts_energy_direction_check
  check(energy_direction in ('consumption','production'));

create index if not exists customer_contracts_company_energy_direction_idx
  on public.customer_contracts(company_id,energy_direction,status,created_at desc);

-- A new quote is valid only when the exact canonical product, publication,
-- pricing and legal identities are present and agree with the immutable graph.
create or replace function public.gridex_enforce_quote_canonical_identity_v1()
returns trigger
language plpgsql
security invoker
set search_path=public,pg_temp
as $$
declare
  v_publication public.contract_publication_versions%rowtype;
  v_product_version public.contract_product_versions%rowtype;
  v_product_company_id uuid;
  v_publication_company_id uuid;
  v_price_plan_company_id uuid;
  v_price_book_company_id uuid;
  v_legal_company_id uuid;
begin
  if new.contract_product_id is null
     or new.contract_product_version_id is null
     or new.contract_publication_version_id is null
     or new.price_plan_id is null
     or new.price_plan_version_id is null
     or new.price_book_id is null
     or new.legal_bundle_version_id is null
     or new.energy_direction is null then
    raise exception using errcode='23502',message='quote_canonical_identity_incomplete';
  end if;

  select * into v_publication
  from public.contract_publication_versions
  where id=new.contract_publication_version_id;
  if not found then
    raise exception using errcode='23503',message='quote_publication_version_not_found';
  end if;

  select * into v_product_version
  from public.contract_product_versions
  where id=new.contract_product_version_id;
  if not found then
    raise exception using errcode='23503',message='quote_product_version_not_found';
  end if;

  select company_id into v_product_company_id
  from public.contract_products
  where id=new.contract_product_id;
  if v_product_company_id is not null and v_product_company_id is distinct from new.company_id then
    raise exception using errcode='23514',message='quote_contract_product_tenant_mismatch';
  end if;

  select assignment.company_id into v_publication_company_id
  from public.contract_publications publication
  join public.tenant_contract_assignments assignment
    on assignment.id=publication.assignment_id
  where publication.id=v_publication.contract_publication_id;
  if v_publication_company_id is distinct from new.company_id then
    raise exception using errcode='23514',message='quote_publication_tenant_mismatch';
  end if;

  select company_id into v_price_plan_company_id
  from public.price_plans
  where id=new.price_plan_id;
  if v_price_plan_company_id is distinct from new.company_id then
    raise exception using errcode='23514',message='quote_price_plan_tenant_mismatch';
  end if;

  select company_id into v_price_book_company_id
  from public.price_books
  where id=new.price_book_id;
  if v_price_book_company_id is distinct from new.company_id then
    raise exception using errcode='23514',message='quote_price_book_tenant_mismatch';
  end if;

  select company_id into v_legal_company_id
  from public.legal_bundle_versions
  where id=new.legal_bundle_version_id;
  if v_legal_company_id is distinct from new.company_id then
    raise exception using errcode='23514',message='quote_legal_bundle_tenant_mismatch';
  end if;

  if v_product_version.contract_product_id is distinct from new.contract_product_id
     or v_publication.contract_product_version_id is distinct from new.contract_product_version_id
     or v_publication.price_plan_id is distinct from new.price_plan_id
     or v_publication.price_plan_version_id is distinct from new.price_plan_version_id
     or v_publication.price_book_id is distinct from new.price_book_id
     or v_publication.legal_bundle_version_id is distinct from new.legal_bundle_version_id
     or v_publication.offer_reference is distinct from new.offer_reference
     or v_publication.customer_type not in (new.customer_type,'both')
     or v_product_version.energy_direction is distinct from new.energy_direction
     or v_publication.energy_direction is distinct from new.energy_direction then
    raise exception using errcode='23514',message='quote_canonical_identity_mismatch';
  end if;

  return new;
end
$$;

drop trigger if exists website_contract_quotes_canonical_identity_v1
  on public.website_contract_quotes;
create trigger website_contract_quotes_canonical_identity_v1
before insert or update of
  company_id,contract_product_id,contract_product_version_id,
  contract_publication_version_id,price_plan_id,price_plan_version_id,
  price_book_id,legal_bundle_version_id,energy_direction
on public.website_contract_quotes
for each row execute function public.gridex_enforce_quote_canonical_identity_v1();

revoke all on function public.gridex_enforce_quote_canonical_identity_v1()
  from public,anon,authenticated;
grant execute on function public.gridex_enforce_quote_canonical_identity_v1()
  to service_role;

-- Enforce all identities on the target row whenever a quote reference exists.
-- The trigger is shared by website applications and customer contracts and
-- always scopes by tenant.
create or replace function public.gridex_enforce_quote_binding_v2()
returns trigger
language plpgsql
security invoker
set search_path=public,pg_temp
as $$
declare
  v_row jsonb:=to_jsonb(new);
  v_quote public.website_contract_quotes%rowtype;
  v_company_id uuid:=nullif(v_row->>'company_id','')::uuid;
  v_quote_reference text:=nullif(v_row->>'quote_reference','');
  v_text text;
begin
  if v_quote_reference is null then return new; end if;

  select * into v_quote
  from public.website_contract_quotes q
  where q.company_id=v_company_id
    and q.quote_reference=v_quote_reference;
  if not found then
    raise exception using errcode='23503',message='quote_binding_not_found_for_tenant';
  end if;

  foreach v_text in array array[
    nullif(v_row->>'contract_product_id',''),
    nullif(v_row->>'contract_product_version_id',''),
    nullif(v_row->>'contract_publication_version_id',''),
    nullif(v_row->>'price_plan_id',''),
    nullif(v_row->>'price_plan_version_id',''),
    nullif(v_row->>'price_book_id',''),
    nullif(v_row->>'legal_bundle_version_id',''),
    nullif(v_row->>'energy_direction','')
  ] loop
    if v_text is null then
      raise exception using errcode='23502',message='quote_binding_target_identity_incomplete';
    end if;
  end loop;

  if v_quote.contract_product_id is distinct from (v_row->>'contract_product_id')::uuid then
    raise exception using errcode='23514',message='quote_binding_contract_product_mismatch';
  end if;
  if v_quote.contract_product_version_id is distinct from (v_row->>'contract_product_version_id')::uuid then
    raise exception using errcode='23514',message='quote_binding_contract_version_mismatch';
  end if;
  if v_quote.contract_publication_version_id is distinct from (v_row->>'contract_publication_version_id')::uuid then
    raise exception using errcode='23514',message='quote_binding_publication_version_mismatch';
  end if;
  if v_quote.price_plan_id is distinct from (v_row->>'price_plan_id')::uuid then
    raise exception using errcode='23514',message='quote_binding_price_plan_mismatch';
  end if;
  if v_quote.price_plan_version_id is distinct from (v_row->>'price_plan_version_id')::uuid then
    raise exception using errcode='23514',message='quote_binding_price_plan_version_mismatch';
  end if;
  if v_quote.price_book_id is distinct from (v_row->>'price_book_id')::uuid then
    raise exception using errcode='23514',message='quote_binding_price_book_mismatch';
  end if;
  if v_quote.legal_bundle_version_id is distinct from (v_row->>'legal_bundle_version_id')::uuid then
    raise exception using errcode='23514',message='quote_binding_legal_bundle_mismatch';
  end if;
  if v_quote.energy_direction is distinct from (v_row->>'energy_direction') then
    raise exception using errcode='23514',message='quote_binding_energy_direction_mismatch';
  end if;

  return new;
end
$$;

drop trigger if exists website_application_quote_binding_v1
  on public.website_customer_applications;
drop trigger if exists website_application_quote_binding_v2
  on public.website_customer_applications;
create trigger website_application_quote_binding_v2
before insert or update of
  company_id,quote_reference,contract_product_id,contract_product_version_id,
  contract_publication_version_id,price_plan_id,price_plan_version_id,
  price_book_id,legal_bundle_version_id,energy_direction
on public.website_customer_applications
for each row execute function public.gridex_enforce_quote_binding_v2();

drop trigger if exists customer_contract_quote_binding_v1
  on public.customer_contracts;
drop trigger if exists customer_contract_quote_binding_v2
  on public.customer_contracts;
create trigger customer_contract_quote_binding_v2
before insert or update of
  company_id,quote_reference,contract_product_id,contract_product_version_id,
  contract_publication_version_id,price_plan_id,price_plan_version_id,
  price_book_id,legal_bundle_version_id,energy_direction
on public.customer_contracts
for each row execute function public.gridex_enforce_quote_binding_v2();

revoke all on function public.gridex_enforce_quote_binding_v2() from public,anon,authenticated;
grant execute on function public.gridex_enforce_quote_binding_v2() to service_role;

-- ---------------------------------------------------------------------------
-- 3. Audit records carry explicit actor and request context.
-- ---------------------------------------------------------------------------
alter table public.audit_logs
  add column if not exists actor_type text,
  add column if not exists system_actor text,
  add column if not exists request_id text,
  add column if not exists correlation_id text,
  add column if not exists resource_type text,
  add column if not exists resource_id text,
  add column if not exists previous_status text,
  add column if not exists new_status text;

update public.audit_logs
set actor_type=coalesce(actor_type,case when actor_user_id is null then 'system' else 'user' end),
    system_actor=case
      when actor_user_id is null then coalesce(nullif(system_actor,''),nullif(metadata->>'system_actor',''),'legacy_system_actor')
      else null
    end,
    request_id=coalesce(nullif(request_id,''),nullif(metadata->>'request_id',''),id::text),
    correlation_id=coalesce(nullif(correlation_id,''),nullif(metadata->>'correlation_id',''),nullif(request_id,''),id::text),
    resource_type=coalesce(nullif(resource_type,''),entity_type),
    resource_id=coalesce(nullif(resource_id,''),entity_id),
    previous_status=coalesce(nullif(previous_status,''),nullif(old_values->>'lifecycle_status',''),nullif(old_values->>'status','')),
    new_status=coalesce(nullif(new_status,''),nullif(new_values->>'lifecycle_status',''),nullif(new_values->>'status',''));

create or replace function public.gridex_normalize_audit_context_v1()
returns trigger
language plpgsql
security invoker
set search_path=public,pg_temp
as $$
declare
  v_headers jsonb:='{}'::jsonb;
  v_raw_headers text:=nullif(current_setting('request.headers',true),'');
begin
  if v_raw_headers is not null then
    begin
      v_headers:=v_raw_headers::jsonb;
    exception when others then
      v_headers:='{}'::jsonb;
    end;
  end if;

  new.actor_type:=coalesce(
    nullif(new.actor_type,''),
    case when new.actor_user_id is null then 'system' else 'user' end
  );
  if new.actor_user_id is null then
    new.system_actor:=coalesce(
      nullif(new.system_actor,''),
      nullif(new.metadata->>'system_actor',''),
      'unspecified_system_actor'
    );
  else
    new.system_actor:=null;
  end if;

  new.request_id:=coalesce(
    nullif(new.request_id,''),
    nullif(new.metadata->>'request_id',''),
    nullif(v_headers->>'x-request-id',''),
    gen_random_uuid()::text
  );
  new.correlation_id:=coalesce(
    nullif(new.correlation_id,''),
    nullif(new.metadata->>'correlation_id',''),
    nullif(v_headers->>'x-correlation-id',''),
    new.request_id
  );
  new.resource_type:=coalesce(nullif(new.resource_type,''),new.entity_type);
  new.resource_id:=coalesce(nullif(new.resource_id,''),new.entity_id);
  new.previous_status:=coalesce(
    nullif(new.previous_status,''),
    nullif(new.old_values->>'lifecycle_status',''),
    nullif(new.old_values->>'status','')
  );
  new.new_status:=coalesce(
    nullif(new.new_status,''),
    nullif(new.new_values->>'lifecycle_status',''),
    nullif(new.new_values->>'status','')
  );
  new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object(
    'actor_type',new.actor_type,
    'system_actor',new.system_actor,
    'request_id',new.request_id,
    'correlation_id',new.correlation_id,
    'resource_type',new.resource_type,
    'resource_id',new.resource_id,
    'previous_status',new.previous_status,
    'new_status',new.new_status
  ));
  return new;
end
$$;

drop trigger if exists audit_logs_normalize_context_v1 on public.audit_logs;
create trigger audit_logs_normalize_context_v1
before insert or update on public.audit_logs
for each row execute function public.gridex_normalize_audit_context_v1();

alter table public.audit_logs
  alter column actor_type set not null,
  alter column request_id set not null,
  alter column correlation_id set not null,
  alter column resource_type set not null,
  alter column resource_id set not null;

alter table public.audit_logs
  drop constraint if exists audit_logs_actor_type_check;
alter table public.audit_logs
  add constraint audit_logs_actor_type_check
  check(actor_type in ('user','system'));
alter table public.audit_logs
  drop constraint if exists audit_logs_system_actor_check;
alter table public.audit_logs
  add constraint audit_logs_system_actor_check
  check(actor_user_id is not null or nullif(system_actor,'') is not null);

create index if not exists audit_logs_request_id_idx
  on public.audit_logs(request_id,created_at desc);
create index if not exists audit_logs_correlation_id_idx
  on public.audit_logs(correlation_id,created_at desc);
create index if not exists audit_logs_contract_resource_idx
  on public.audit_logs(company_id,resource_type,resource_id,created_at desc);

revoke all on function public.gridex_normalize_audit_context_v1()
  from public,anon,authenticated;
grant execute on function public.gridex_normalize_audit_context_v1()
  to service_role;

-- ---------------------------------------------------------------------------
-- 4. Archived is terminal for ordinary version creation.
-- ---------------------------------------------------------------------------
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
  v_lifecycle_status text;
  v_existing_direction text;
  v_energy_direction text:=lower(coalesce(
    nullif(p_pricing_snapshot->>'energy_direction',''),
    nullif(p_payload->>'energy_direction','')
  ));
begin
  if v_energy_direction is null or v_energy_direction not in ('consumption','production') then
    return jsonb_build_object(
      'ok',false,'code','energy_direction_invalid',
      'message','Avtalsriktningen måste vara consumption eller production.',
      'blockers',jsonb_build_array(public.gridex_contract_readiness_blocker_v2(
        'energy_direction_invalid','energy_direction',
        'Avtalsriktningen måste vara consumption eller production.',
        to_jsonb(v_energy_direction),'contract_offer',p_offer_id
      ))
    );
  end if;
  perform public.gridex_assert_contract_permission(
    p_actor_user_id,
    case when p_offer_id is null then 'contracts.create' else 'contracts.edit_draft' end
  );

  if p_offer_id is not null then
    select o.lifecycle_status,o.energy_direction
      into v_lifecycle_status,v_existing_direction
    from public.contract_offers o
    where o.id=p_offer_id and o.company_id=p_company_id
    for update;
    if not found then
      return jsonb_build_object(
        'ok',false,'code','contract_not_found','message','Avtalet hittades inte för valt bolag.',
        'blockers',jsonb_build_array(public.gridex_contract_readiness_blocker_v2(
          'contract_offer_not_found','contract_offer_id',
          'Avtalsversionen hittades inte för valt bolag.',to_jsonb(p_offer_id),
          'contract_offer',p_offer_id
        ))
      );
    end if;
    if v_existing_direction is not null and v_existing_direction<>v_energy_direction then
      return jsonb_build_object(
        'ok',false,'code','energy_direction_change_requires_successor',
        'message','Avtalsriktningen är produktidentitet och får inte ändras i samma produktserie.',
        'blockers',jsonb_build_array(public.gridex_contract_readiness_blocker_v2(
          'energy_direction_change_requires_successor','energy_direction',
          'Skapa en separat efterföljande produkt för den andra energiriktningen.',
          to_jsonb(v_energy_direction),'contract_offer',p_offer_id,
          jsonb_build_object('current_direction',v_existing_direction,'recommended_action','create_successor_product')
        )),
        'recommended_action','create_successor_product'
      );
    end if;
    if v_lifecycle_status='archived' then
      return jsonb_build_object(
        'ok',false,'code','contract_archived','message','Ett arkiverat avtal är terminalt. Skapa en separat efterföljande produkt i stället.',
        'blockers',jsonb_build_array(public.gridex_contract_readiness_blocker_v2(
          'contract_archived','lifecycle_status',
          'Arkiverade avtal får inte redigeras eller få en vanlig ny version.',
          to_jsonb(v_lifecycle_status),'contract_offer',p_offer_id,
          jsonb_build_object('recommended_action','create_successor_product')
        )),
        'recommended_action','create_successor_product'
      );
    end if;
    if v_lifecycle_status='closed' then
      return jsonb_build_object(
        'ok',false,'code','contract_closed','message','Ett stängt avtal är terminalt och får inte versioneras.',
        'blockers',jsonb_build_array(public.gridex_contract_readiness_blocker_v2(
          'contract_closed_terminal','lifecycle_status',
          'Stängda avtal får inte redigeras eller versioneras.',
          to_jsonb(v_lifecycle_status),'contract_offer',p_offer_id
        ))
      );
    end if;
  end if;

  v_result:=public.gridex_upsert_internal_contract_offer(
    p_company_id,p_offer_id,p_payload,p_pricing_snapshot,p_actor_user_id
  );
  v_offer_id:=nullif(v_result#>>'{offer,id}','')::uuid;
  v_product_id:=nullif(v_result->>'contract_product_id','')::uuid;
  v_version_id:=nullif(v_result->>'contract_product_version_id','')::uuid;

  if v_offer_id is null or v_product_id is null or v_version_id is null then
    raise exception using errcode='23502',message='contract_create_canonical_ids_incomplete';
  end if;

  update public.contract_offers
  set energy_direction=v_energy_direction,updated_at=now()
  where id=v_offer_id and company_id=p_company_id;
  update public.contract_products
  set energy_direction=v_energy_direction,updated_at=now()
  where id=v_product_id and company_id=p_company_id;
  update public.contract_product_versions
  set energy_direction=v_energy_direction
  where id=v_version_id
    and contract_product_id=v_product_id
    and locked_at is null;
  if not exists(
    select 1
    from public.contract_offers o
    join public.contract_products cp on cp.id=o.contract_product_id
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
    'ok',true,
    'tenant_contract_assignment_id',v_assignment_id,
    'company_id',p_company_id
  );
end
$$;

-- Archive remains terminal. This compatibility RPC returns a structured
-- business failure instead of throwing an exception that callers must parse.
create or replace function public.gridex_restore_archived_contract(
  p_company_id uuid,
  p_offer_id uuid,
  p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_status text;
begin
  perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.create_version');
  select lifecycle_status into v_status
  from public.contract_offers
  where id=p_offer_id and company_id=p_company_id
  for update;
  if not found then
    return jsonb_build_object(
      'ok',false,'code','contract_not_found',
      'message','Avtalet hittades inte för valt bolag.',
      'blockers',jsonb_build_array(public.gridex_contract_readiness_blocker_v2(
        'contract_offer_not_found','contract_offer_id',
        'Avtalsversionen hittades inte för valt bolag.',to_jsonb(p_offer_id),
        'contract_offer',p_offer_id
      ))
    );
  end if;
  if v_status<>'archived' then
    return jsonb_build_object(
      'ok',false,'code','contract_not_archived',
      'message','Endast ett arkiverat avtal kan använda kompatibilitetskommandot.',
      'blockers',jsonb_build_array(public.gridex_contract_readiness_blocker_v2(
        'contract_not_archived','lifecycle_status',
        'Avtalet är inte arkiverat.',to_jsonb(v_status),'contract_offer',p_offer_id
      ))
    );
  end if;
  return jsonb_build_object(
    'ok',false,'code','contract_archived',
    'message','Arkiverade avtal är terminala. Skapa en separat efterföljande produkt.',
    'recommended_action','create_successor_product',
    'blockers',jsonb_build_array(public.gridex_contract_readiness_blocker_v2(
      'contract_archived','lifecycle_status',
      'Arkiverade avtal får inte återställas eller återaktiveras.',to_jsonb(v_status),
      'contract_offer',p_offer_id,
      jsonb_build_object('recommended_action','create_successor_product')
    ))
  );
end
$$;

-- ---------------------------------------------------------------------------
-- 5. Contract mutations are service-only. The server action binds actor and
-- tenant from the authenticated session before using the service client.
-- ---------------------------------------------------------------------------
revoke all on function public.gridex_upsert_internal_contract_offer(uuid,uuid,jsonb,jsonb,uuid)
  from public,anon,authenticated;
grant execute on function public.gridex_upsert_internal_contract_offer(uuid,uuid,jsonb,jsonb,uuid)
  to service_role;

revoke all on function public.gridex_upsert_internal_contract_offer_v2(uuid,uuid,jsonb,jsonb,uuid)
  from public,anon,authenticated;
grant execute on function public.gridex_upsert_internal_contract_offer_v2(uuid,uuid,jsonb,jsonb,uuid)
  to service_role;

revoke all on function public.gridex_publish_contract_version(uuid,uuid,text,jsonb,jsonb,uuid)
  from public,anon,authenticated;
grant execute on function public.gridex_publish_contract_version(uuid,uuid,text,jsonb,jsonb,uuid)
  to service_role;

revoke all on function public.gridex_publish_internal_contract_version(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.gridex_publish_internal_contract_version(uuid,uuid,uuid)
  to service_role;

revoke all on function public.gridex_publish_contract_channel(uuid,uuid,text,uuid)
  from public,anon,authenticated;
grant execute on function public.gridex_publish_contract_channel(uuid,uuid,text,uuid)
  to service_role;

revoke all on function public.gridex_unpublish_contract_channel(uuid,uuid,text,uuid)
  from public,anon,authenticated;
grant execute on function public.gridex_unpublish_contract_channel(uuid,uuid,text,uuid)
  to service_role;

revoke all on function public.gridex_pause_contract_channels(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.gridex_pause_contract_channels(uuid,uuid,uuid)
  to service_role;

revoke all on function public.gridex_close_contract_product(uuid,uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.gridex_close_contract_product(uuid,uuid,uuid,text)
  to service_role;

revoke all on function public.gridex_archive_contract_product(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.gridex_archive_contract_product(uuid,uuid,uuid)
  to service_role;

revoke all on function public.gridex_preview_delete_unused_contract(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.gridex_preview_delete_unused_contract(uuid,uuid)
  to service_role;

revoke all on function public.gridex_delete_unused_contract(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.gridex_delete_unused_contract(uuid,uuid,uuid)
  to service_role;

revoke all on function public.gridex_remove_internal_contract_offer(uuid,uuid,text,uuid)
  from public,anon,authenticated;
grant execute on function public.gridex_remove_internal_contract_offer(uuid,uuid,text,uuid)
  to service_role;

revoke all on function public.gridex_cleanup_unused_contract_drafts(uuid,uuid,boolean)
  from public,anon,authenticated;
grant execute on function public.gridex_cleanup_unused_contract_drafts(uuid,uuid,boolean)
  to service_role;

revoke all on function public.gridex_restore_archived_contract(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.gridex_restore_archived_contract(uuid,uuid,uuid)
  to service_role;

comment on function public.gridex_normalize_audit_context_v1() is
  'Normalizes actor, request, correlation, resource and status context for every audit row.';
comment on column public.contract_products.energy_direction is
  'Stable product identity: consumption or production. A direction change requires a successor product.';
comment on column public.contract_product_versions.energy_direction is
  'Immutable direction copied from the owning product and included in quote/customer bindings.';
comment on column public.contract_publication_versions.energy_direction is
  'Immutable direction copied from the exact published product version.';
comment on column public.contract_offers.energy_direction is
  'Direction copied from the immutable pricing snapshot for deterministic admin and runtime behavior.';
comment on column public.public_contract_offers.energy_direction is
  'Compatibility DTO direction copied from the canonical publication graph.';
comment on function public.gridex_upsert_internal_contract_offer_v2(uuid,uuid,jsonb,jsonb,uuid) is
  'Service-only canonical create/version command. Actor is session-verified by the server action; archived and closed products are terminal.';
comment on function public.gridex_enforce_quote_canonical_identity_v1() is
  'Rejects quotes without the exact product, publication, price and legal identities or with cross-tenant/mismatched graph references.';
comment on function public.gridex_enforce_quote_binding_v2() is
  'Tenant-scoped immutable binding guard for quote -> application -> customer contract, including energy direction and pricing identities.';
comment on column public.website_contract_quotes.energy_direction is
  'Immutable consumption/production direction copied from the exact published product version.';
comment on column public.website_customer_applications.energy_direction is
  'Direction copied from the validated quote; never selected from a mutable latest product.';
comment on column public.customer_contracts.energy_direction is
  'Canonical economic direction. Production uses credit/self-billing and must not create ordinary consumption supply/invoice flows.';

commit;
