\set ON_ERROR_STOP on

select p.oid::regprocedure,p.prosecdef,p.proconfig,pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in ('gridex_publish_contract_channel','gridex_archive_contract_product')
order by p.oid::regprocedure::text;

select routine_name,grantee,privilege_type
from information_schema.role_routine_grants
where specific_schema='public'
  and routine_name in ('gridex_publish_contract_channel','gridex_archive_contract_product')
order by routine_name,grantee;

select con.conname,pg_get_constraintdef(con.oid)
from pg_constraint con
where con.conrelid='public.contract_offers'::regclass
order by con.conname;

select indexname,indexdef
from pg_indexes
where schemaname='public' and tablename='contract_offers' and indexdef ilike '%slug%'
order by indexname;

select company_id,lower(btrim(slug)) as slug_key,count(*) as row_count,
  jsonb_agg(jsonb_build_object(
    'id',id,'name',name,'status',status,'lifecycle_status',lifecycle_status,
    'archived_at',archived_at,'contract_product_id',contract_product_id,'created_at',created_at
  ) order by created_at) as rows
from public.contract_offers
where nullif(btrim(slug),'') is not null
group by company_id,lower(btrim(slug))
having count(*)>1
order by row_count desc;

do $$
declare
  v_publish regprocedure := 'public.gridex_publish_contract_channel(uuid,uuid,text,uuid)'::regprocedure;
  v_archive regprocedure := 'public.gridex_archive_contract_product(uuid,uuid,uuid)'::regprocedure;
  v_publish_def text := pg_get_functiondef(v_publish);
  v_archive_def text := pg_get_functiondef(v_archive);
  v_contract_type_def text;
begin
  if v_publish_def ~* 'coalesce[[:space:]]*\([[:space:]]*valid_to([[:space:]],|[[:space:]]*\))' then
    raise exception using errcode='42702',message='publish_contract_channel_unqualified_valid_to';
  end if;
  if position('old_channel.valid_to' in v_publish_def)=0
     or position('old_publication_version.valid_to' in v_publish_def)=0 then
    raise exception using errcode='P0001',message='publish_contract_channel_qualification_missing';
  end if;
  if v_archive_def ~* 'coalesce[[:space:]]*\([[:space:]]*valid_to([[:space:]],|[[:space:]]*\))' then
    raise exception using errcode='42702',message='archive_contract_product_unqualified_valid_to';
  end if;
  if position('ch.valid_to' in v_archive_def)=0
     or position('pv.valid_to' in v_archive_def)=0
     or position('ta.valid_to' in v_archive_def)=0 then
    raise exception using errcode='P0001',message='archive_contract_product_qualification_missing';
  end if;

  if exists(
    select 1 from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) privilege
    where p.oid in (v_publish::oid,v_archive::oid)
      and privilege.privilege_type='EXECUTE'
      and (privilege.grantee=0 or privilege.grantee in (
        select oid from pg_roles where rolname in ('anon','authenticated')
      ))
  ) then
    raise exception using errcode='42501',message='contract_repair_rpc_grant_too_broad';
  end if;
  if not has_function_privilege('service_role',v_publish,'EXECUTE')
     or not has_function_privilege('service_role',v_archive,'EXECUTE') then
    raise exception using errcode='42501',message='contract_repair_service_role_grant_missing';
  end if;

  select pg_get_constraintdef(con.oid) into v_contract_type_def
  from pg_constraint con
  where con.conrelid='public.contract_offers'::regclass
    and con.conname='contract_offers_contract_type_check';
  if v_contract_type_def is null then
    raise exception using errcode='23514',message='contract_offers_contract_type_check_missing';
  end if;
  if not (v_contract_type_def ilike '%fixed%'
    and v_contract_type_def ilike '%variable_monthly%'
    and v_contract_type_def ilike '%variable_hourly%'
    and v_contract_type_def ilike '%variable_quarterly%'
    and v_contract_type_def ilike '%portfolio%'
    and v_contract_type_def ilike '%mixed%') then
    raise exception using errcode='23514',message='contract_offers_contract_type_check_incomplete';
  end if;

  if not exists(
    select 1
    from pg_indexes
    where schemaname='public'
      and tablename='contract_offers'
      and indexname='contract_offers_company_live_slug_uidx'
      and indexdef ilike 'create unique index%'
      and indexdef ilike '%company_id%'
      and indexdef ilike '%lower(btrim(slug))%'
      and indexdef ilike '%archived_at is null%'
      and indexdef ilike '%lifecycle_status <>%archived%'
  ) then
    raise exception using
      errcode='23514',
      message='contract_offer_live_slug_unique_index_missing';
  end if;

  if exists(
    select 1
    from public.contract_offers
    where company_id is not null
      and nullif(btrim(slug),'') is not null
      and archived_at is null
      and lifecycle_status<>'archived'
    group by company_id,lower(btrim(slug))
    having count(*)>1
  ) then
    raise exception using
      errcode='23505',
      message='contract_offer_live_slug_duplicates_present';
  end if;

  if exists(
    select 1
    from public.contract_product_versions version
    where version.created_at >= timestamp with time zone '2026-07-27 00:00:00+00'
      and version.commercial_snapshot->>'contract_type'
        is distinct from version.contract_type
  ) then
    raise exception using
      errcode='23514',
      message='contract_product_version_snapshot_alignment_failed';
  end if;
end
$$;

select jsonb_build_object('ok',true,'code','gridex_contract_repair_post_apply_verified','verified_at',now()) as result;
