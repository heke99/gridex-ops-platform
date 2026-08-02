-- Read-only postflight for 20260802190000.
-- Run with psql -v ON_ERROR_STOP=1 after the migration is applied.

begin read only;

select exists (
  select 1
  from supabase_migrations.schema_migrations
  where version = '20260802190000'
) as emergency_access_lockdown_applied;

select
  c.relname as view_name,
  'security_invoker=true' = any(coalesce(c.reloptions, array[]::text[]))
    as security_invoker,
  has_table_privilege('anon', c.oid, 'SELECT') as anon_can_select,
  has_table_privilege('authenticated', c.oid, 'SELECT')
    as authenticated_can_select,
  has_table_privilege('service_role', c.oid, 'SELECT')
    as service_role_can_select
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'billing_export_readiness_v',
    'contract_publication_readiness_v',
    'gridex_tenant_contract_readiness_v',
    'gridex_tenant_email_dispatch_readiness_v'
  )
order by c.relname;

select
  p.oid::regprocedure::text as function_signature,
  p.prosecdef as security_definer,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE')
    as authenticated_can_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE')
    as service_role_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'canonical_seed_company_capabilities',
    'gridex_publish_contract_publication_version',
    'gridex_refresh_billing_export_run',
    'gridex_upsert_company_legal_profile_defaults'
  )
order by p.oid::regprocedure::text;

select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced,
  has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
    as anon_has_any_data_privilege,
  has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
    as authenticated_has_any_data_privilege,
  has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE')
    as service_role_has_required_privileges
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'canonical_migration_manifest',
    'canonical_hardening_preflight_results'
  )
order by c.relname;

select
  owner.rolname as owner,
  d.defaclobjtype as object_type,
  case when x.grantee = 0 then 'PUBLIC' else grantee.rolname end as grantee,
  x.privilege_type
from pg_default_acl d
join pg_roles owner on owner.oid = d.defaclrole
left join pg_namespace ns on ns.oid = d.defaclnamespace
cross join lateral aclexplode(d.defaclacl) x
left join pg_roles grantee on grantee.oid = x.grantee
where owner.rolname in ('postgres', 'supabase_admin')
  and coalesce(ns.nspname, 'public') = 'public'
  and (x.grantee = 0 or grantee.rolname in ('anon', 'authenticated'))
order by owner.rolname, d.defaclobjtype, grantee, x.privilege_type;

select
  pg_get_functiondef('public.gridex_user_is_platform_admin()'::regprocedure)
    ilike '%ur.company_id is null%' as global_helper_requires_null_company,
  (
    select count(*)
    from public.user_roles ur
    left join public.roles r on r.id = ur.role_id
    where ur.company_id is not null
      and public.gridex_normalize_platform_role(
        coalesce(ur.role, r.key, r.name)
      ) in ('super_admin', 'platform_admin')
      and coalesce(ur.is_active, true)
      and coalesce(ur.status, 'active') = 'active'
  ) as active_tenant_bound_global_role_count;

commit;
