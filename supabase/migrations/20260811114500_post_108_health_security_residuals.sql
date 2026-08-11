-- GRIDEX post-#108 health/security residuals.
-- 1) Restore service-role-only EXECUTE on canonical reconciliation (SECURITY DEFINER).
-- 2) Restore success-path check-error clears and drain the renamed outbox finding key.
-- 3) Revoke inherited PUBLIC grants on readiness surfaces (O-008 residual).
-- Forward tip after 20260811080000. Do not reuse 20260810230000 from unmerged #106.

begin;

set local search_path = public, pg_catalog;

-- -----------------------------------------------------------------------------
-- O-008 PUBLIC privilege residual
-- -----------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.actor_readiness_status') is null then
    raise exception 'actor_readiness_status_missing';
  end if;
end;
$$;

revoke all privileges on public.actor_readiness_status from public, anon;
grant select on public.actor_readiness_status to authenticated, service_role;

revoke all privileges on
  public.actor_readiness_by_role_v,
  public.grid_owner_supplier_switch_readiness_v,
  public.electricity_supplier_readiness_v,
  public.system_supplier_readiness_v,
  public.non_electricity_actor_readiness_v
from public, anon, authenticated;

grant select on
  public.actor_readiness_by_role_v,
  public.grid_owner_supplier_switch_readiness_v,
  public.electricity_supplier_readiness_v,
  public.system_supplier_readiness_v,
  public.non_electricity_actor_readiness_v
to service_role;

do $$
declare
  v_view text;
begin
  if has_table_privilege('anon', 'public.actor_readiness_status', 'SELECT') then
    raise exception 'anon_still_has_actor_readiness_status_select';
  end if;

  if not has_table_privilege('authenticated', 'public.actor_readiness_status', 'SELECT') then
    raise exception 'authenticated_missing_actor_readiness_status_select';
  end if;

  foreach v_view in array array[
    'actor_readiness_by_role_v',
    'grid_owner_supplier_switch_readiness_v',
    'electricity_supplier_readiness_v',
    'system_supplier_readiness_v',
    'non_electricity_actor_readiness_v'
  ] loop
    if has_table_privilege('anon', format('public.%I', v_view), 'SELECT')
       or has_table_privilege('authenticated', format('public.%I', v_view), 'SELECT') then
      raise exception 'readiness_dashboard_still_externally_selectable:%', v_view;
    end if;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Reconciliation privilege + check-error clear residual
-- -----------------------------------------------------------------------------

create or replace function public.canonical_run_architecture_reconciliation(p_company_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_count bigint;
  v_results jsonb := '{}'::jsonb;
  v_sql text;
begin
  if p_company_id is null then
    raise exception using errcode = '22023', message = 'reconciliation_company_scope_required';
  end if;
  if not exists(select 1 from public.companies where id = p_company_id) then
    raise exception 'reconciliation_company_not_found';
  end if;

  -- Access: active membership without a canonical role.
  begin
    select count(*) into v_count
    from public.company_memberships membership
    where membership.company_id = p_company_id
      and membership.status = 'active' and coalesce(membership.is_active, true)
      and not exists (
        select 1 from public.user_roles role
        where role.company_id = membership.company_id
          and role.user_id = membership.user_id
          and coalesce(role.status, 'active') = 'active'
          and coalesce(role.is_active, true)
      );
    perform public.canonical_set_architecture_finding(
      p_company_id, 'active-membership-missing-role', 'access', 'critical',
      'Active memberships without canonical roles', v_count, 'platform_security',
      'Repair membership and role atomically through canonical_change_tenant_user_access', null);
    perform public.canonical_set_architecture_finding(
      p_company_id, 'check-error:active-membership-missing-role', 'reconciliation', 'critical',
      'Membership reconciliation check failed', 0, 'platform_operations',
      'Repair the check before treating access as healthy', null);
    v_results := v_results || jsonb_build_object('membership_without_role', v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id, 'check-error:active-membership-missing-role', 'reconciliation', 'critical',
      'Membership reconciliation check failed', 1, 'platform_operations',
      'Repair the check before treating access as healthy', sqlstate || ':' || sqlerrm);
    v_results := v_results || jsonb_build_object('membership_without_role_error', sqlstate);
  end;

  -- Access: active role without an auth identity.
  begin
    select count(*) into v_count
    from public.user_roles role
    where role.company_id = p_company_id
      and coalesce(role.status, 'active') = 'active'
      and coalesce(role.is_active, true)
      and not exists (select 1 from auth.users identity where identity.id = role.user_id);
    perform public.canonical_set_architecture_finding(
      p_company_id, 'role-without-auth-identity', 'access', 'critical',
      'Active roles without an auth identity', v_count, 'platform_security',
      'Remove stale authorization state or restore the authoritative identity', null);
    perform public.canonical_set_architecture_finding(
      p_company_id, 'check-error:role-without-auth-identity', 'reconciliation', 'critical',
      'Role identity reconciliation check failed', 0, 'platform_operations',
      'Repair the check before treating access as healthy', null);
    v_results := v_results || jsonb_build_object('role_without_auth_identity', v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id, 'check-error:role-without-auth-identity', 'reconciliation', 'critical',
      'Role identity reconciliation check failed', 1, 'platform_operations',
      'Repair the check before treating access as healthy', sqlstate || ':' || sqlerrm);
    v_results := v_results || jsonb_build_object('role_without_auth_identity_error', sqlstate);
  end;

  -- Access: duplicate active memberships.
  begin
    select count(*) into v_count
    from (
      select membership.company_id, membership.user_id
      from public.company_memberships membership
      where membership.company_id = p_company_id
        and coalesce(membership.status, 'active') = 'active'
        and coalesce(membership.is_active, true)
      group by membership.company_id, membership.user_id
      having count(*) > 1
    ) duplicates;
    perform public.canonical_set_architecture_finding(
      p_company_id, 'duplicate-active-membership', 'access', 'critical',
      'Duplicate active tenant memberships', v_count, 'platform_security',
      'Converge duplicate memberships into the canonical access mutation', null);
    perform public.canonical_set_architecture_finding(
      p_company_id, 'check-error:duplicate-active-membership', 'reconciliation', 'critical',
      'Membership duplicate check failed', 0, 'platform_operations',
      'Repair the check before treating access as healthy', null);
    v_results := v_results || jsonb_build_object('duplicate_membership', v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id, 'check-error:duplicate-active-membership', 'reconciliation', 'critical',
      'Membership duplicate check failed', 1, 'platform_operations',
      'Repair the check before treating access as healthy', sqlstate || ':' || sqlerrm);
    v_results := v_results || jsonb_build_object('duplicate_membership_error', sqlstate);
  end;

  -- Access: duplicate active canonical roles per role identity.
  begin
    select count(*) into v_count
    from (
      select role.company_id, role.user_id,
             coalesce(to_jsonb(role) ->> 'role_key', to_jsonb(role) ->> 'role', to_jsonb(role) ->> 'permission_key', '') as role_identity
      from public.user_roles role
      where role.company_id = p_company_id
        and coalesce(role.status, 'active') = 'active'
        and coalesce(role.is_active, true)
      group by role.company_id, role.user_id,
               coalesce(to_jsonb(role) ->> 'role_key', to_jsonb(role) ->> 'role', to_jsonb(role) ->> 'permission_key', '')
      having count(*) > 1
    ) duplicates;
    perform public.canonical_set_architecture_finding(
      p_company_id, 'duplicate-active-role', 'access', 'critical',
      'Duplicate active canonical roles', v_count, 'platform_security',
      'Converge duplicate role rows through canonical_change_tenant_user_access', null);
    perform public.canonical_set_architecture_finding(
      p_company_id, 'check-error:duplicate-active-role', 'reconciliation', 'critical',
      'Role duplicate check failed', 0, 'platform_operations',
      'Repair the check before treating access as healthy', null);
    v_results := v_results || jsonb_build_object('duplicate_role', v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id, 'check-error:duplicate-active-role', 'reconciliation', 'critical',
      'Role duplicate check failed', 1, 'platform_operations',
      'Repair the check before treating access as healthy', sqlstate || ':' || sqlerrm);
    v_results := v_results || jsonb_build_object('duplicate_role_error', sqlstate);
  end;

  -- Invitations accepted without active access.
  begin
    if to_regclass('public.company_invitations') is not null then
      execute $q$
        select count(*)
        from public.company_invitations invitation
        where invitation.company_id = $1
          and lower(coalesce(to_jsonb(invitation) ->> 'status', '')) in ('accepted', 'completed')
          and (to_jsonb(invitation) ->> 'invited_user_id') is not null
          and not exists (
            select 1 from public.company_memberships membership
            where membership.company_id = invitation.company_id
              and membership.user_id::text = to_jsonb(invitation) ->> 'invited_user_id'
              and coalesce(membership.status, 'active') = 'active'
              and coalesce(membership.is_active, true)
          )
      $q$ into v_count using p_company_id;
    else
      v_count := 0;
    end if;
    perform public.canonical_set_architecture_finding(
      p_company_id, 'accepted-invite-without-access', 'access', 'critical',
      'Accepted invitations without active tenant access', v_count, 'tenant_operations',
      'Replay canonical invitation acceptance or revoke the invalid invitation state', null);
    perform public.canonical_set_architecture_finding(
      p_company_id, 'check-error:accepted-invite-without-access', 'reconciliation', 'critical',
      'Invitation/access reconciliation check failed', 0, 'platform_operations',
      'Repair the check before treating invitations as healthy', null);
    v_results := v_results || jsonb_build_object('accepted_invite_without_access', v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id, 'check-error:accepted-invite-without-access', 'reconciliation', 'critical',
      'Invitation/access reconciliation check failed', 1, 'platform_operations',
      'Repair the check before treating invitations as healthy', sqlstate || ':' || sqlerrm);
    v_results := v_results || jsonb_build_object('accepted_invite_without_access_error', sqlstate);
  end;

  -- Integration readiness.
  begin
    select count(*) into v_count
    from public.integration_api_clients client
    where client.company_id = p_company_id
      and client.status = 'active'
      and coalesce(client.launch_ready, false) = false;
    perform public.canonical_set_architecture_finding(
      p_company_id, 'active-api-client-not-launch-ready', 'integration', 'critical',
      'Active API clients without verified launch readiness', v_count, 'integration_operations',
      'Run canonical readiness smoke and pause clients that cannot pass', null);
    perform public.canonical_set_architecture_finding(
      p_company_id, 'check-error:active-api-client-not-launch-ready', 'reconciliation', 'critical',
      'API client readiness check failed', 0, 'platform_operations',
      'Repair the check before treating integrations as healthy', null);
    v_results := v_results || jsonb_build_object('active_client_not_ready', v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id, 'check-error:active-api-client-not-launch-ready', 'reconciliation', 'critical',
      'API client readiness check failed', 1, 'platform_operations',
      'Repair the check before treating integrations as healthy', sqlstate || ':' || sqlerrm);
    v_results := v_results || jsonb_build_object('active_client_not_ready_error', sqlstate);
  end;

  -- Canonical event ingress must not accumulate. Delivery remains the established
  -- domain_events/event_outbox path until all deprecated producers are removed.
  begin
    if to_regclass('public.canonical_event_outbox') is not null then
      select count(*) into v_count
      from public.canonical_event_outbox outbox
      where outbox.company_id = p_company_id
        and outbox.status in ('pending', 'retry', 'failed')
        and outbox.available_at <= now()
        and outbox.created_at < now() - interval '5 minutes';
    else
      v_count := 0;
    end if;
    perform public.canonical_set_architecture_finding(
      p_company_id, 'deprecated-canonical-event-bus-backlog', 'events', 'critical',
      'Deprecated canonical event ingress has a backlog', v_count, 'platform_operations',
      'Drain through the established event_outbox bridge and remove the remaining deprecated producer', null);
    perform public.canonical_set_architecture_finding(
      p_company_id, 'check-error:deprecated-canonical-event-bus-backlog', 'reconciliation', 'critical',
      'Deprecated event ingress check failed', 0, 'platform_operations',
      'Repair the check before treating event delivery as healthy', null);
    perform public.canonical_set_architecture_finding(
      p_company_id, 'due-stranded-canonical-outbox', 'events', 'critical',
      'Due canonical outbox rows are stranded', 0, 'platform_operations',
      'Claim and process the canonical event outbox; inspect dead letters', null);
    perform public.canonical_set_architecture_finding(
      p_company_id, 'check-error:due-stranded-canonical-outbox', 'reconciliation', 'critical',
      'Canonical outbox check failed', 0, 'platform_operations',
      'Repair the check before treating event delivery as healthy', null);
    v_results := v_results || jsonb_build_object('deprecated_event_bus_backlog', v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id, 'check-error:deprecated-canonical-event-bus-backlog', 'reconciliation', 'critical',
      'Deprecated event ingress check failed', 1, 'platform_operations',
      'Repair the check before treating event delivery as healthy', sqlstate || ':' || sqlerrm);
    v_results := v_results || jsonb_build_object('deprecated_event_bus_backlog_error', sqlstate);
  end;

  -- Active event outbox must not have due stranded work.
  begin
    if to_regclass('public.event_outbox') is not null then
      execute $q$
        select count(*)
        from public.event_outbox outbox
        where outbox.company_id = $1
          and lower(coalesce(to_jsonb(outbox) ->> 'status', '')) in ('queued', 'pending', 'retry', 'failed', 'failed_retryable')
          and coalesce((to_jsonb(outbox) ->> 'available_at')::timestamptz, now()) <= now()
          and coalesce((to_jsonb(outbox) ->> 'created_at')::timestamptz, now()) < now() - interval '5 minutes'
      $q$ into v_count using p_company_id;
    else
      v_count := 0;
    end if;
    perform public.canonical_set_architecture_finding(
      p_company_id, 'due-stranded-event-outbox', 'events', 'critical',
      'Due active event outbox rows are stranded', v_count, 'platform_operations',
      'Run the existing outbox worker and inspect retry/dead-letter causes', null);
    perform public.canonical_set_architecture_finding(
      p_company_id, 'check-error:due-stranded-event-outbox', 'reconciliation', 'critical',
      'Active event outbox check failed', 0, 'platform_operations',
      'Repair the check before treating event delivery as healthy', null);
    v_results := v_results || jsonb_build_object('due_stranded_outbox', v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id, 'check-error:due-stranded-event-outbox', 'reconciliation', 'critical',
      'Active event outbox check failed', 1, 'platform_operations',
      'Repair the check before treating event delivery as healthy', sqlstate || ':' || sqlerrm);
    v_results := v_results || jsonb_build_object('due_stranded_outbox_error', sqlstate);
  end;

  -- Provisioning: dead letters and jobs stuck in an in-flight state.
  begin
    select count(*) into v_count
    from public.company_provisioning_jobs job
    where job.company_id = p_company_id and job.status = 'dead_letter';
    perform public.canonical_set_architecture_finding(
      p_company_id, 'provisioning-dead-letter', 'provisioning', 'critical',
      'Tenant provisioning jobs are dead-lettered', v_count, 'tenant_operations',
      'Correct the provider/configuration fault and explicitly requeue', null);
    perform public.canonical_set_architecture_finding(
      p_company_id, 'check-error:provisioning-dead-letter', 'reconciliation', 'critical',
      'Provisioning dead-letter check failed', 0, 'platform_operations',
      'Repair the check before treating provisioning as healthy', null);
    v_results := v_results || jsonb_build_object('provisioning_dead_letter', v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id, 'check-error:provisioning-dead-letter', 'reconciliation', 'critical',
      'Provisioning dead-letter check failed', 1, 'platform_operations',
      'Repair the check before treating provisioning as healthy', sqlstate || ':' || sqlerrm);
    v_results := v_results || jsonb_build_object('provisioning_dead_letter_error', sqlstate);
  end;

  begin
    if to_regclass('public.company_provisioning_jobs') is not null then
      execute $q$
        select count(*)
        from public.company_provisioning_jobs job
        where job.company_id = $1
          and lower(coalesce(to_jsonb(job) ->> 'status', '')) in ('queued', 'pending', 'running', 'processing', 'retry')
          and coalesce(
                nullif(to_jsonb(job) ->> 'updated_at', '')::timestamptz,
                nullif(to_jsonb(job) ->> 'created_at', '')::timestamptz,
                now()
              ) < now() - interval '30 minutes'
      $q$ into v_count using p_company_id;
    else
      v_count := 0;
    end if;
    perform public.canonical_set_architecture_finding(
      p_company_id, 'stuck-provisioning', 'provisioning', 'critical',
      'Tenant provisioning jobs are stuck', v_count, 'tenant_operations',
      'Recover the existing provisioning lease/retry path; do not create a second provisioner', null);
    perform public.canonical_set_architecture_finding(
      p_company_id, 'check-error:stuck-provisioning', 'reconciliation', 'critical',
      'Stuck provisioning check failed', 0, 'platform_operations',
      'Repair the check before treating provisioning as healthy', null);
    v_results := v_results || jsonb_build_object('stuck_provisioning', v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id, 'check-error:stuck-provisioning', 'reconciliation', 'critical',
      'Stuck provisioning check failed', 1, 'platform_operations',
      'Repair the check before treating provisioning as healthy', sqlstate || ':' || sqlerrm);
    v_results := v_results || jsonb_build_object('stuck_provisioning_error', sqlstate);
  end;

  -- Manual review: both the existing customer-operation path and inbound mail
  -- must have explicit ownership and SLA semantics.
  begin
    if to_regclass('public.customer_operation_jobs') is not null then
      select count(*) into v_count
      from public.customer_operation_jobs job
      where job.company_id = p_company_id
        and job.status = 'needs_review'
        and job.review_resolved_at is null
        and job.review_sla_due_at < now();
    else
      v_count := 0;
    end if;
    perform public.canonical_set_architecture_finding(
      p_company_id, 'manual-review-over-sla', 'customer_operations', 'warning',
      'Manual-review jobs exceeded their SLA', v_count, 'tenant_operations',
      'Resolve the blocker and record the resolution on the existing job', null);
    perform public.canonical_set_architecture_finding(
      p_company_id, 'check-error:manual-review-over-sla', 'reconciliation', 'critical',
      'Manual-review SLA check failed', 0, 'platform_operations',
      'Repair the check before treating manual review as healthy', null);
    v_results := v_results || jsonb_build_object('manual_review_over_sla', v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id, 'check-error:manual-review-over-sla', 'reconciliation', 'critical',
      'Manual-review SLA check failed', 1, 'platform_operations',
      'Repair the check before treating manual review as healthy', sqlstate || ':' || sqlerrm);
    v_results := v_results || jsonb_build_object('manual_review_over_sla_error', sqlstate);
  end;

  begin
    if to_regclass('public.inbound_processing_jobs') is not null then
      select count(*) into v_count
      from public.inbound_processing_jobs job
      where job.company_id = p_company_id
        and job.status = 'manual_review'
        and job.review_resolved_at is null
        and (nullif(job.review_owner, '') is null
          or nullif(job.review_reason, '') is null
          or job.review_sla_due_at is null);
    else
      v_count := 0;
    end if;
    perform public.canonical_set_architecture_finding(
      p_company_id, 'manual-review-without-owner-or-sla', 'customer_operations', 'critical',
      'Manual-review work lacks owner, reason or SLA', v_count, 'tenant_operations',
      'Complete ownership, reason and SLA fields on the existing inbound processing job', null);
    perform public.canonical_set_architecture_finding(
      p_company_id, 'check-error:manual-review-without-owner-or-sla', 'reconciliation', 'critical',
      'Inbound manual-review check failed', 0, 'platform_operations',
      'Repair the check before treating manual review as healthy', null);
    v_results := v_results || jsonb_build_object('manual_review_without_owner', v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id, 'check-error:manual-review-without-owner-or-sla', 'reconciliation', 'critical',
      'Inbound manual-review check failed', 1, 'platform_operations',
      'Repair the check before treating manual review as healthy', sqlstate || ':' || sqlerrm);
    v_results := v_results || jsonb_build_object('manual_review_without_owner_error', sqlstate);
  end;

  -- Customer intake repair workflow.
  begin
    select count(*) into v_count
    from public.website_customer_applications application
    where application.company_id = p_company_id
      and application.status in ('failed', 'pending_review', 'manual_review')
      and application.customer_id is null
      and application.repair_status is null;
    perform public.canonical_set_architecture_finding(
      p_company_id, 'customer-application-without-repair-workflow', 'customer_intake', 'critical',
      'Incomplete customer applications lack a repair workflow', v_count, 'platform_operations',
      'Classify the payload and attach the canonical repair workflow', null);
    perform public.canonical_set_architecture_finding(
      p_company_id, 'check-error:customer-application-without-repair-workflow', 'reconciliation', 'critical',
      'Customer-application repair check failed', 0, 'platform_operations',
      'Repair the check before treating customer intake as healthy', null);
    v_results := v_results || jsonb_build_object('application_without_repair', v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id, 'check-error:customer-application-without-repair-workflow', 'reconciliation', 'critical',
      'Customer-application repair check failed', 1, 'platform_operations',
      'Repair the check before treating customer intake as healthy', sqlstate || ':' || sqlerrm);
    v_results := v_results || jsonb_build_object('application_without_repair_error', sqlstate);
  end;

  -- Contracts must have their customer, site and metering-point prerequisites.
  begin
    if to_regclass('public.customer_contracts') is not null then
      execute $q$
        select count(*)
        from public.customer_contracts contract
        where contract.company_id = $1
          and lower(coalesce(to_jsonb(contract) ->> 'status', '')) in ('active', 'signed')
          and (
            nullif(to_jsonb(contract) ->> 'customer_id', '') is null
            or coalesce(
                 nullif(to_jsonb(contract) ->> 'customer_site_id', ''),
                 nullif(to_jsonb(contract) ->> 'site_id', '')
               ) is null
          )
      $q$ into v_count using p_company_id;
    else
      v_count := 0;
    end if;
    perform public.canonical_set_architecture_finding(
      p_company_id, 'contract-missing-customer-or-site', 'customer_operations', 'critical',
      'Active contracts are missing customer or site links', v_count, 'tenant_operations',
      'Repair the canonical contract relationship before billing or supplier switch', null);
    perform public.canonical_set_architecture_finding(
      p_company_id, 'check-error:contract-missing-customer-or-site', 'reconciliation', 'critical',
      'Contract relationship check failed', 0, 'platform_operations',
      'Repair the check before treating contracts as healthy', null);
    v_results := v_results || jsonb_build_object('contract_missing_customer_or_site', v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id, 'check-error:contract-missing-customer-or-site', 'reconciliation', 'critical',
      'Contract relationship check failed', 1, 'platform_operations',
      'Repair the check before treating contracts as healthy', sqlstate || ':' || sqlerrm);
    v_results := v_results || jsonb_build_object('contract_missing_customer_or_site_error', sqlstate);
  end;

  begin
    if to_regclass('public.customer_contracts') is not null
       and to_regclass('public.metering_points') is not null then
      execute $q$
        select count(*)
        from public.customer_contracts contract
        where contract.company_id = $1
          and lower(coalesce(to_jsonb(contract) ->> 'status', '')) in ('active', 'signed')
          and coalesce(
                nullif(to_jsonb(contract) ->> 'customer_site_id', ''),
                nullif(to_jsonb(contract) ->> 'site_id', '')
              ) is not null
          and not exists (
            select 1 from public.metering_points point
            where coalesce(
                    nullif(to_jsonb(point) ->> 'site_id', ''),
                    nullif(to_jsonb(point) ->> 'customer_site_id', '')
                  ) = coalesce(
                        nullif(to_jsonb(contract) ->> 'customer_site_id', ''),
                        nullif(to_jsonb(contract) ->> 'site_id', '')
                      )
          )
      $q$ into v_count using p_company_id;
    else
      v_count := 0;
    end if;
    perform public.canonical_set_architecture_finding(
      p_company_id, 'contract-without-metering-point', 'customer_operations', 'critical',
      'Active contracts have no metering point on their site', v_count, 'tenant_operations',
      'Attach the authoritative metering point before supplier switch or settlement', null);
    perform public.canonical_set_architecture_finding(
      p_company_id, 'check-error:contract-without-metering-point', 'reconciliation', 'critical',
      'Contract metering-point check failed', 0, 'platform_operations',
      'Repair the check before treating contracts as healthy', null);
    v_results := v_results || jsonb_build_object('contract_without_metering_point', v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id, 'check-error:contract-without-metering-point', 'reconciliation', 'critical',
      'Contract metering-point check failed', 1, 'platform_operations',
      'Repair the check before treating contracts as healthy', sqlstate || ':' || sqlerrm);
    v_results := v_results || jsonb_build_object('contract_without_metering_point_error', sqlstate);
  end;

  -- Supplier switches must retain a contract relationship when the schema exposes
  -- one. The JSON projection keeps this check compatible with older columns.
  begin
    if to_regclass('public.supplier_switch_requests') is not null then
      execute $q$
        select count(*)
        from public.supplier_switch_requests switch
        where switch.company_id = $1
          and lower(coalesce(to_jsonb(switch) ->> 'status', '')) in
              ('ready', 'queued', 'sending', 'sent', 'pending', 'in_progress', 'awaiting_response')
          and (to_jsonb(switch) ? 'contract_id')
          and nullif(to_jsonb(switch) ->> 'contract_id', '') is null
      $q$ into v_count using p_company_id;
    else
      v_count := 0;
    end if;
    perform public.canonical_set_architecture_finding(
      p_company_id, 'switch-without-contract', 'customer_operations', 'critical',
      'Open supplier switches lack a contract relationship', v_count, 'tenant_operations',
      'Repair the existing switch request before dispatch', null);
    perform public.canonical_set_architecture_finding(
      p_company_id, 'check-error:switch-without-contract', 'reconciliation', 'critical',
      'Supplier-switch contract check failed', 0, 'platform_operations',
      'Repair the check before treating supplier switches as healthy', null);
    v_results := v_results || jsonb_build_object('switch_without_contract', v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id, 'check-error:switch-without-contract', 'reconciliation', 'critical',
      'Supplier-switch contract check failed', 1, 'platform_operations',
      'Repair the check before treating supplier switches as healthy', sqlstate || ':' || sqlerrm);
    v_results := v_results || jsonb_build_object('switch_without_contract_error', sqlstate);
  end;

  -- EDIEL live state must never coexist with a non-active tenant.
  begin
    if to_regclass('public.ediel_production_state') is not null then
      execute $q$
        select count(*)
        from public.ediel_production_state state
        join public.companies company on company.id::text = to_jsonb(state) ->> 'company_id'
        where company.id = $1
          and lower(coalesce(to_jsonb(state) ->> 'status', to_jsonb(state) ->> 'state', '')) in ('live', 'production', 'active')
          and (company.status <> 'active' or company.lifecycle_status <> 'active' or not coalesce(company.is_active, true))
      $q$ into v_count using p_company_id;
    else
      v_count := 0;
    end if;
    perform public.canonical_set_architecture_finding(
      p_company_id, 'ediel-live-without-valid-tenant', 'ediel', 'critical',
      'EDIEL production state is live for a non-active tenant', v_count, 'platform_operations',
      'Pause EDIEL through the canonical lifecycle/EDIEL transition before tenant suspension', null);
    perform public.canonical_set_architecture_finding(
      p_company_id, 'check-error:ediel-live-without-valid-tenant', 'reconciliation', 'critical',
      'EDIEL lifecycle check failed', 0, 'platform_operations',
      'Repair the check before treating EDIEL state as healthy', null);
    v_results := v_results || jsonb_build_object('ediel_live_without_valid_tenant', v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id, 'check-error:ediel-live-without-valid-tenant', 'reconciliation', 'critical',
      'EDIEL lifecycle check failed', 1, 'platform_operations',
      'Repair the check before treating EDIEL state as healthy', sqlstate || ':' || sqlerrm);
    v_results := v_results || jsonb_build_object('ediel_live_without_valid_tenant_error', sqlstate);
  end;

  -- Tenant lifecycle projection must agree with the existing status model.
  begin
    select count(*) into v_count
    from public.companies company
    where company.id = p_company_id
      and company.lifecycle_status is distinct from case company.status
        when 'active' then 'active'
        when 'onboarding' then 'onboarding'
        when 'paused' then 'suspended'
        when 'suspended' then 'suspended'
        when 'archived' then 'closing'
        when 'pending_deletion' then 'closing'
        when 'closed' then 'closed'
        when 'deleted_test_only' then 'closed'
        else company.lifecycle_status
      end;
    perform public.canonical_set_architecture_finding(
      p_company_id, 'invalid-tenant-lifecycle-projection', 'tenant_lifecycle', 'critical',
      'Tenant status and lifecycle projection disagree', v_count, 'tenant_operations',
      'Use canonical_transition_tenant_lifecycle; do not patch lifecycle columns independently', null);
    perform public.canonical_set_architecture_finding(
      p_company_id, 'check-error:invalid-tenant-lifecycle-projection', 'reconciliation', 'critical',
      'Tenant lifecycle check failed', 0, 'platform_operations',
      'Repair the check before treating lifecycle state as healthy', null);
    v_results := v_results || jsonb_build_object('invalid_lifecycle', v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id, 'check-error:invalid-tenant-lifecycle-projection', 'reconciliation', 'critical',
      'Tenant lifecycle check failed', 1, 'platform_operations',
      'Repair the check before treating lifecycle state as healthy', sqlstate || ':' || sqlerrm);
    v_results := v_results || jsonb_build_object('invalid_lifecycle_error', sqlstate);
  end;

  return jsonb_build_object(
    'checked_at', now(),
    'companies', jsonb_build_object(p_company_id::text, v_results)
  );
end
$$;

revoke all on function public.canonical_run_architecture_reconciliation(uuid)
  from public, anon, authenticated;
grant execute on function public.canonical_run_architecture_reconciliation(uuid)
  to service_role;

commit;
