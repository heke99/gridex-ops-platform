-- Read-only postflight for 20260802203000.
-- Run with: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/sql/06_canonical_runtime_consistency_verification.sql

begin read only;

select exists (
  select 1
  from supabase_migrations.schema_migrations
  where version = '20260802203000'
) as runtime_consistency_migration_registered;

select
  to_regprocedure('public.canonical_manage_platform_user_access(jsonb)') is not null as platform_access_rpc_exists,
  to_regprocedure('public.canonical_accept_tenant_invitation(jsonb)') is not null as invitation_rpc_exists,
  to_regprocedure('public.canonical_project_actor_test_result_state(jsonb)') is not null as actor_projection_rpc_exists,
  to_regprocedure('public.canonical_block_claimed_ediel_outbox_item(uuid,text,text,text,jsonb)') is not null as outbox_block_rpc_exists,
  has_function_privilege('anon', 'public.canonical_manage_platform_user_access(jsonb)', 'EXECUTE') as anon_can_execute_platform_access,
  has_function_privilege('authenticated', 'public.canonical_manage_platform_user_access(jsonb)', 'EXECUTE') as authenticated_can_execute_platform_access,
  has_function_privilege('service_role', 'public.canonical_manage_platform_user_access(jsonb)', 'EXECUTE') as service_role_can_execute_platform_access,
  has_function_privilege('anon', 'public.canonical_project_actor_test_result_state(jsonb)', 'EXECUTE') as anon_can_execute_actor_projection,
  has_function_privilege('authenticated', 'public.canonical_project_actor_test_result_state(jsonb)', 'EXECUTE') as authenticated_can_execute_actor_projection,
  has_function_privilege('service_role', 'public.canonical_project_actor_test_result_state(jsonb)', 'EXECUTE') as service_role_can_execute_actor_projection;

select
  exists(select 1 from pg_trigger where tgrelid='public.ediel_test_runs'::regclass and tgname='canonical_ediel_test_run_authoritative_status_guard' and not tgisinternal) as test_run_pass_guard_exists,
  exists(select 1 from pg_trigger where tgrelid='public.actor_test_results'::regclass and tgname='canonical_actor_test_result_authoritative_status_guard' and not tgisinternal) as actor_result_pass_guard_exists,
  not has_table_privilege('anon','public.actor_test_results','INSERT,UPDATE,DELETE,TRUNCATE') as anon_actor_result_write_revoked,
  not has_table_privilege('authenticated','public.actor_test_results','INSERT,UPDATE,DELETE,TRUNCATE') as authenticated_actor_result_write_revoked;

select pg_get_constraintdef(c.oid) as ediel_test_run_status_constraint
from pg_constraint c
where c.conrelid='public.ediel_test_runs'::regclass
  and c.conname='ediel_test_runs_status_check';

select
  count(*) filter (where ur.company_id is not null) as tenant_bound_global_roles,
  count(*) filter (where ur.company_id is null) as global_platform_roles
from public.user_roles ur
left join public.roles r on r.id = ur.role_id
where public.gridex_normalize_platform_role(coalesce(ur.role, r.key, r.name))
      in ('super_admin', 'platform_admin')
  and coalesce(ur.is_active, true)
  and coalesce(ur.status, 'active') = 'active';

select
  count(*) as active_membership_role_divergence
from public.company_memberships cm
left join public.user_roles ur
  on ur.company_id = cm.company_id
 and ur.user_id = cm.user_id
 and coalesce(ur.is_active, true)
 and coalesce(ur.status, 'active') = 'active'
where coalesce(cm.is_active, true)
  and coalesce(cm.status, 'active') = 'active'
  and ur.id is null;

select
  count(*) filter (where status = 'active') as active_configurations,
  count(*) filter (where status = 'active' and environment_type is null) as active_missing_environment_type,
  count(*) filter (where status = 'active' and configuration_snapshot_id is null) as active_missing_snapshot
from public.ediel_active_test_configurations;

select
  cc.company_id,
  cc.enabled,
  cc.readiness_status,
  cc.blockers
from public.company_capabilities cc
where cc.capability_code = 'ediel_test'
  and cc.enabled
  and not exists (
    select 1
    from public.ediel_active_test_configurations c
    where c.company_id = cc.company_id
      and c.status = 'active'
      and c.environment_type is not null
      and c.configuration_snapshot_id is not null
  );

select
  status,
  count(*)
from public.manual_email_outbox
where status in ('sending', 'delivery_uncertain', 'blocked_tenant_state')
group by status
order by status;

select
  status,
  count(*)
from public.webhook_deliveries
where status in ('processing', 'delivery_uncertain', 'blocked_tenant_state')
group by status
order by status;

select
  status,
  count(*)
from public.ediel_outbox
where status in ('sending', 'delivery_uncertain', 'blocked_tenant_state')
group by status
order by status;

-- Tenant role identity must be company-qualified; the obsolete global constraint
-- would prevent the same user from holding the same role in two tenants.
select
  not exists(
    select 1
    from pg_constraint c
    join pg_class t on t.oid=c.conrelid
    join pg_namespace n on n.oid=t.relnamespace
    where n.nspname='public' and t.relname='user_roles'
      and c.conname='user_roles_user_id_role_id_key'
  ) as obsolete_global_user_role_unique_removed,
  to_regclass('public.user_roles_global_user_role_uidx') is not null
    as global_user_role_unique_exists,
  to_regclass('public.user_roles_company_user_role_active_uidx') is not null
    as tenant_active_role_unique_exists;


commit;
