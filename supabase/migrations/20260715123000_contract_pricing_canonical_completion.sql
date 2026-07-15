-- Complete the canonical chain for internal offers and enforce exact tenant/version references.

begin;
create extension if not exists pgcrypto;

create or replace function public.gridex_validate_contract_pricing_references()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.price_plan_id is not null and not exists(
    select 1 from public.price_plans p where p.id=new.price_plan_id and p.company_id=new.company_id
  ) then raise exception 'Prisplanen tillhör inte bolaget.' using errcode='23514'; end if;

  if new.price_plan_version_id is not null and not exists(
    select 1 from public.price_plan_versions v
    where v.id=new.price_plan_version_id and v.company_id=new.company_id and v.price_plan_id=new.price_plan_id
  ) then raise exception 'Prisversionen tillhör inte bolaget eller vald prisplan.' using errcode='23514'; end if;

  if new.price_book_id is not null and not exists(
    select 1 from public.price_books b
    where b.id=new.price_book_id and b.company_id=new.company_id
      and (new.price_plan_id is null or b.price_plan_id=new.price_plan_id)
      and (new.price_plan_version_id is null or b.price_plan_version_id=new.price_plan_version_id)
  ) then raise exception 'Prislistan tillhör inte bolaget eller vald prisversion.' using errcode='23514'; end if;
  return new;
end $$;

drop trigger if exists public_contract_offers_pricing_reference_guard on public.public_contract_offers;
create trigger public_contract_offers_pricing_reference_guard
before insert or update of company_id,price_plan_id,price_plan_version_id,price_book_id on public.public_contract_offers
for each row execute function public.gridex_validate_contract_pricing_references();

drop trigger if exists contract_offers_pricing_reference_guard on public.contract_offers;
create trigger contract_offers_pricing_reference_guard
before insert or update of company_id,price_plan_id,price_plan_version_id,price_book_id on public.contract_offers
for each row execute function public.gridex_validate_contract_pricing_references();

create or replace function public.gridex_sync_internal_offer_to_canonical(p_offer_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  o record;
  v_product_id uuid;
  v_version_id uuid;
  v_assignment_id uuid;
  v_snapshot jsonb;
  v_hash text;
  v_number integer;
begin
  select * into o from public.contract_offers where id=p_offer_id;
  if not found or o.company_id is null then return null; end if;

  insert into public.contract_products(product_code,name,product_category,description,status,created_by)
  values('internal:' || o.company_id::text || ':' || o.id::text, o.name, coalesce(o.contract_type,'electricity'), o.description,
    case when coalesce(o.is_active,false) and o.status='active' then 'active' else 'paused' end, o.created_by)
  on conflict(product_code) do update set name=excluded.name,description=excluded.description,status=excluded.status,updated_at=now()
  returning id into v_product_id;

  v_snapshot := coalesce(o.commercial_snapshot,'{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
    'legacy_contract_offer_id',o.id,'company_id',o.company_id,'name',o.name,'contract_type',o.contract_type,
    'price_plan_id',o.price_plan_id,'price_plan_version_id',o.price_plan_version_id,'price_book_id',o.price_book_id,
    'price_version',o.price_version,'terms_version',o.terms_version,'valid_from',o.valid_from,'valid_to',o.valid_to
  ));
  v_hash := encode(digest(v_snapshot::text,'sha256'),'hex');

  select id into v_version_id from public.contract_product_versions where contract_product_id=v_product_id and content_sha256=v_hash limit 1;
  if v_version_id is null then
    select coalesce(max(version_number),0)+1 into v_number from public.contract_product_versions where contract_product_id=v_product_id;
    insert into public.contract_product_versions(
      contract_product_id,version_number,customer_type,contract_type,pricing_model,price_plan_id,price_plan_version_id,
      binding_months,notice_months,commercial_snapshot,content_sha256,status,approved_at,locked_at,created_by
    ) values(
      v_product_id,v_number,'both',coalesce(o.contract_type,'unknown'),coalesce(o.contract_type,'unknown'),o.price_plan_id,o.price_plan_version_id,
      o.default_binding_months,o.default_notice_months,v_snapshot,v_hash,
      case when coalesce(o.is_active,false) and o.status='active' then 'approved' else 'draft' end,
      case when coalesce(o.is_active,false) and o.status='active' then now() end,
      case when coalesce(o.is_active,false) and o.status='active' then now() end,o.created_by
    ) returning id into v_version_id;
  end if;

  insert into public.tenant_contract_assignments(company_id,contract_product_version_id,internal_sales_allowed,website_publication_allowed,status,legal_mode,valid_from,valid_to,assigned_by)
  values(o.company_id,v_version_id,true,false,case when coalesce(o.is_active,false) and o.status='active' then 'active' else 'paused' end,'ops_standard',o.valid_from,o.valid_to,o.updated_by)
  on conflict(company_id,contract_product_version_id) do update
    set internal_sales_allowed=true,status=excluded.status,valid_from=excluded.valid_from,valid_to=excluded.valid_to,updated_at=now()
  returning id into v_assignment_id;

  insert into public.tenant_contract_channels(assignment_id,channel,status,valid_from,valid_to,marketing_content,updated_by)
  values(v_assignment_id,'internal',case when coalesce(o.is_active,false) and o.status='active' then 'active' else 'paused' end,o.valid_from::timestamptz,o.valid_to::timestamptz,jsonb_build_object('name',o.name),o.updated_by)
  on conflict(assignment_id,channel) do update set status=excluded.status,valid_from=excluded.valid_from,valid_to=excluded.valid_to,marketing_content=excluded.marketing_content,updated_by=excluded.updated_by,updated_at=now();

  return v_version_id;
end $$;

revoke all on function public.gridex_sync_internal_offer_to_canonical(uuid) from public,anon,authenticated;
grant execute on function public.gridex_sync_internal_offer_to_canonical(uuid) to service_role;

create or replace function public.gridex_sync_internal_offer_trigger()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if pg_trigger_depth()=1 then perform public.gridex_sync_internal_offer_to_canonical(new.id); end if;
  return new;
end $$;

drop trigger if exists contract_offers_canonical_sync on public.contract_offers;
create trigger contract_offers_canonical_sync
after insert or update of name,status,is_active,contract_type,price_plan_id,price_plan_version_id,price_book_id,commercial_snapshot,price_version,terms_version,valid_from,valid_to
on public.contract_offers for each row execute function public.gridex_sync_internal_offer_trigger();

commit;
