\set ON_ERROR_STOP on
\pset pager off

-- GRIDEX-OPS-BL-001 post-migration regression. All fixture mutations roll back.
begin;

-- Structural gate across the exact seven-table family.
do $$
declare
  v_table text;
  v_bad integer;
  v_canonical integer;
begin
  foreach v_table in array array[
    'batch4c_security_checks',
    'customer_duplicate_resolution_events',
    'customer_lifecycle_decisions',
    'customer_merge_events',
    'customer_readiness_snapshots',
    'document_ai_extractions',
    'power_of_attorney_scopes'
  ] loop
    select count(*)::integer into v_bad
    from pg_policy p
    where p.polrelid=to_regclass('public.'||v_table)
      and p.polcmd in ('*','a','w','d')
      and exists (
        select 1 from unnest(p.polroles) x(oid)
        left join pg_roles r on r.oid=x.oid
        where x.oid=0 or r.rolname in ('anon','authenticated','authenticator')
      )
      and (
        coalesce(pg_get_expr(p.polqual,p.polrelid,true),'') ilike '%company_memberships%'
        or coalesce(pg_get_expr(p.polwithcheck,p.polrelid,true),'') ilike '%company_memberships%'
      );
    if v_bad<>0 then raise exception 'raw_membership_write_policy_residual:%:%',v_table,v_bad; end if;

    select count(*)::integer into v_canonical
    from pg_policy p
    where p.polrelid=to_regclass('public.'||v_table)
      and p.polname in (v_table||'_bl001_insert',v_table||'_bl001_update',v_table||'_bl001_delete')
      and exists (select 1 from unnest(p.polroles)x(oid) join pg_roles r on r.oid=x.oid where r.rolname='authenticated')
      and (
        coalesce(pg_get_expr(p.polqual,p.polrelid,true),'') ilike '%gridex_can_write_company%'
        or coalesce(pg_get_expr(p.polwithcheck,p.polrelid,true),'') ilike '%gridex_can_write_company%'
      );
    if v_canonical<>3 then raise exception 'canonical_write_policy_count:%:%',v_table,v_canonical; end if;
  end loop;
end $$;

-- Helper role matrix with rollback-only auth fixtures.
select set_config('gridex.test.company_a',id::text,true) from public.companies where coalesce(is_active,true)=true and coalesce(status,'active') in ('active','onboarding') order by id limit 1;
select set_config('gridex.test.company_b',id::text,true) from public.companies where id<>current_setting('gridex.test.company_a')::uuid and coalesce(is_active,true)=true and coalesce(status,'active') in ('active','onboarding') order by id limit 1;
select set_config('gridex.test.readonly_user',gen_random_uuid()::text,true);
select set_config('gridex.test.admin_user',gen_random_uuid()::text,true);

do $$ begin
  if nullif(current_setting('gridex.test.company_a',true),'') is null or nullif(current_setting('gridex.test.company_b',true),'') is null then
    raise exception 'two_active_company_fixtures_required';
  end if;
end $$;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
select id,'authenticated','authenticated','bl001-'||id::text||'@example.invalid',now(),'{}'::jsonb,'{}'::jsonb,now(),now(),false,false
from (values(current_setting('gridex.test.readonly_user')::uuid),(current_setting('gridex.test.admin_user')::uuid)) f(id);

insert into public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key)
values
(current_setting('gridex.test.company_a')::uuid,current_setting('gridex.test.readonly_user')::uuid,'viewer','active',now(),'{}'::jsonb,'viewer',true,now(),'executive_readonly'),
(current_setting('gridex.test.company_a')::uuid,current_setting('gridex.test.admin_user')::uuid,'company_admin','active',now(),'{}'::jsonb,'company_admin',true,now(),'company_admin');

set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('gridex.test.readonly_user'),true);
do $$ begin
  if public.gridex_can_write_company(current_setting('gridex.test.company_a')::uuid) then raise exception 'readonly_can_write_company'; end if;
end $$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('gridex.test.admin_user'),true);
do $$ begin
  if not public.gridex_can_write_company(current_setting('gridex.test.company_a')::uuid) then raise exception 'company_admin_cannot_write_company'; end if;
  if public.gridex_can_write_company(current_setting('gridex.test.company_b')::uuid) then raise exception 'company_admin_cross_tenant_write'; end if;
end $$;

reset role;
rollback;
\echo 'GRIDEX-OPS-BL-001 rollback regression passed.'
