-- Supabase CLI 2.118.0 forward. Preserve actual positive resolver and OID/ACL;
-- active own-company/global denies constrain every existing current actor gate.
-- No permission assignment, historic migration edit, or positive resolver change.
BEGIN;
create or replace function public.gridex_actor_has_company_permission(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select (p_actor_user_id is not null and p_company_id is not null
  and exists(
    select 1 from auth.users u
    where u.id = p_actor_user_id and u.deleted_at is null
      and (u.banned_until is null or u.banned_until <= now())
  )
  and (
    exists(
      select 1 from public.admin_users au
      where au.user_id = p_actor_user_id
        and coalesce(au.is_active, true)
        and lower(coalesce(au.role, '')) in ('super_admin', 'superadmin', 'platform_superadmin')
    )
    or exists(
      select 1
      from public.user_roles ur left join public.roles r on r.id = ur.role_id
      where ur.user_id = p_actor_user_id and ur.company_id is null
        and coalesce(ur.status, 'active') = 'active' and coalesce(ur.is_active, true)
        and lower(coalesce(ur.role, r.key, r.name, '')) in ('super_admin', 'superadmin', 'platform_superadmin')
    )
    or (
      exists(
        select 1 from public.company_memberships cm
        join public.companies c on c.id = cm.company_id
        where cm.user_id = p_actor_user_id and cm.company_id = p_company_id
          and coalesce(cm.status, 'active') = 'active' and coalesce(cm.is_active, true)
          and coalesce(c.is_active, true)
          and coalesce(c.status, 'active') not in ('archived', 'suspended', 'pending_deletion', 'deleted')
      )
      and p_permission = any(
        public.gridex_get_user_permissions_in_company(p_actor_user_id, p_company_id)
      )
    )
  )
  ) and not exists(
    select 1 from public.user_permissions d left join public.permissions p on p.id=d.permission_id
    where d.user_id=p_actor_user_id and (d.company_id is null or d.company_id=p_company_id)
      and d.is_active and d.status='active' and d.effect='deny'
      and coalesce(nullif(d.permission_key,''),p.key)=p_permission
  ) and not exists(
    select 1 from public.user_permission_overrides d
    where d.user_id=p_actor_user_id and (d.company_id is null or d.company_id=p_company_id)
      and d.is_active and d.effect='deny' and d.permission_key=p_permission
      and (d.valid_from is null or d.valid_from<=now()) and (d.valid_to is null or now()<d.valid_to)
  )
$function$;
CREATE OR REPLACE FUNCTION gridex_ediel_ack_replay.lock_current_graph_v2() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 LOCK TABLE auth.users,public.user_profiles,public.companies,public.company_memberships,public.admin_users,
  public.user_roles,public.roles,public.role_permissions,public.permissions,public.user_permissions,public.user_permission_overrides,
  public.tenant_actor_identifiers,public.tenant_actor_roles,public.tenant_ediel_profiles,public.tenant_counterparty_relations,public.platform_actor_identifiers,
  public.ediel_service_assignments,public.ediel_service_evidence,public.ediel_data_access_grants,public.ediel_assignment_permission_links,
  public.metering_permissions,public.metering_permission_sites,public.ediel_ack_transaction_results,public.meter_reading_series,
  gridex_utilts_binding.receipts,gridex_utilts_binding.contracts,gridex_service_administration.scope_versions,
  gridex_received_sources.permission_transitions,gridex_received_sources.validation_assessments IN SHARE MODE;
END $$;
COMMIT;
