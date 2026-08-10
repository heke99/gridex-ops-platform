-- Forward-only closure of canonical architecture review findings.
-- Applied migrations remain immutable; active contracts are corrected here.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '180s';

create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;

-- Never expose the stored credential hash through public authentication RPCs.
drop function public.authenticate_integration_request_v1(
  text,text,text,text[],text[],text,text,integer,integer
);
drop function public.authenticate_provisioning_smoke_request_v1(
  text,text,uuid,text,text[],text[],text,text,integer,integer
);

alter function public.authenticate_integration_request_v1_credential_core(
  text,text,text,text[],text[],text,text,integer,integer
) set schema private;
alter function private.authenticate_integration_request_v1_credential_core(
  text,text,text,text[],text[],text,text,integer,integer
) rename to authenticate_integration_request_v1_secret_internal;

revoke all on function private.authenticate_integration_request_v1_secret_internal(
  text,text,text,text[],text[],text,text,integer,integer
) from public, anon, authenticated, service_role;

create function public.authenticate_integration_request_v1_credential_core(
  p_key_prefix text,
  p_secret_hash text,
  p_route text,
  p_required_all text[] default array[]::text[],
  p_required_any text[] default array[]::text[],
  p_client_ip text default null,
  p_origin text default null,
  p_rate_limit_cost integer default 1,
  p_window_seconds integer default 60
)
returns table(
  auth_outcome text,
  error_code text,
  tenant_status text,
  client_id uuid,
  company_id uuid,
  client_name text,
  client_status text,
  key_prefix text,
  scopes text[],
  allowed_ips text[],
  allowed_origins text[],
  metadata jsonb,
  rate_limit_per_minute integer,
  expires_at timestamptz,
  request_count integer,
  route_limit integer,
  reset_at timestamptz
)
language sql
security definer
set search_path = public, private, pg_temp
as $function$
  select
    auth.auth_outcome,
    auth.error_code,
    auth.tenant_status,
    auth.client_id,
    auth.company_id,
    auth.client_name,
    auth.client_status,
    auth.key_prefix,
    auth.scopes,
    auth.allowed_ips,
    auth.allowed_origins,
    auth.metadata,
    auth.rate_limit_per_minute,
    auth.expires_at,
    auth.request_count,
    auth.route_limit,
    auth.reset_at
  from private.authenticate_integration_request_v1_secret_internal(
    p_key_prefix,p_secret_hash,p_route,p_required_all,p_required_any,
    p_client_ip,p_origin,p_rate_limit_cost,p_window_seconds
  ) auth
$function$;

create function public.authenticate_integration_request_v1(
  p_key_prefix text,
  p_secret_hash text,
  p_route text,
  p_required_all text[] default array[]::text[],
  p_required_any text[] default array[]::text[],
  p_client_ip text default null,
  p_origin text default null,
  p_rate_limit_cost integer default 1,
  p_window_seconds integer default 60
)
returns table(
  auth_outcome text,
  error_code text,
  tenant_status text,
  client_id uuid,
  company_id uuid,
  client_name text,
  client_status text,
  key_prefix text,
  scopes text[],
  allowed_ips text[],
  allowed_origins text[],
  metadata jsonb,
  rate_limit_per_minute integer,
  expires_at timestamptz,
  request_count integer,
  route_limit integer,
  reset_at timestamptz
)
language sql
security definer
set search_path = public, pg_temp
as $function$
  with auth as (
    select *
    from public.authenticate_integration_request_v1_credential_core(
      p_key_prefix,p_secret_hash,p_route,p_required_all,p_required_any,
      p_client_ip,p_origin,p_rate_limit_cost,p_window_seconds
    )
  ), readiness as (
    select
      auth.*,
      exists (
        select 1 from public.integration_api_clients client
        where client.id=auth.client_id and client.company_id=auth.company_id
          and client.launch_ready is true
          and jsonb_typeof(coalesce(client.launch_blockers,'[]'::jsonb))='array'
          and jsonb_array_length(coalesce(client.launch_blockers,'[]'::jsonb))=0
      ) as client_ready,
      exists (
        select 1 from public.tenant_website_installation_receipts receipt
        where receipt.api_client_id=auth.client_id and receipt.company_id=auth.company_id
          and receipt.state='completed' and receipt.completed_at is not null
          and nullif(receipt.receipt_sha256,'') is not null
      ) as receipt_ready,
      exists (
        select 1 from public.company_capabilities capability
        where capability.company_id=auth.company_id
          and capability.capability_code='api_sales'
          and capability.enabled is true and capability.readiness_status='ready'
      ) as capability_ready
    from auth
  )
  select
    case
      when readiness.auth_outcome<>'allowed' then readiness.auth_outcome
      when readiness.client_ready and readiness.receipt_ready and readiness.capability_ready then 'allowed'
      else 'denied'
    end,
    case
      when readiness.auth_outcome<>'allowed' then readiness.error_code
      when not readiness.client_ready then 'api_client_not_launch_ready'
      when not readiness.receipt_ready then 'integration_receipt_not_verified'
      when not readiness.capability_ready then 'integration_capability_not_ready'
      else null
    end,
    readiness.tenant_status,
    readiness.client_id,
    readiness.company_id,
    readiness.client_name,
    readiness.client_status,
    readiness.key_prefix,
    readiness.scopes,
    readiness.allowed_ips,
    readiness.allowed_origins,
    readiness.metadata,
    readiness.rate_limit_per_minute,
    readiness.expires_at,
    readiness.request_count,
    readiness.route_limit,
    readiness.reset_at
  from readiness
$function$;

create function public.authenticate_provisioning_smoke_request_v1(
  p_key_prefix text,
  p_secret_hash text,
  p_receipt_id uuid,
  p_route text,
  p_required_all text[] default array[]::text[],
  p_required_any text[] default array[]::text[],
  p_client_ip text default null,
  p_origin text default null,
  p_rate_limit_cost integer default 1,
  p_window_seconds integer default 60
)
returns table(
  auth_outcome text,
  error_code text,
  tenant_status text,
  client_id uuid,
  company_id uuid,
  client_name text,
  client_status text,
  key_prefix text,
  scopes text[],
  allowed_ips text[],
  allowed_origins text[],
  metadata jsonb,
  rate_limit_per_minute integer,
  expires_at timestamptz,
  request_count integer,
  route_limit integer,
  reset_at timestamptz
)
language sql
security definer
set search_path = public, pg_temp
as $function$
  with auth as (
    select *
    from public.authenticate_integration_request_v1_credential_core(
      p_key_prefix,p_secret_hash,p_route,p_required_all,p_required_any,
      p_client_ip,p_origin,p_rate_limit_cost,p_window_seconds
    )
  ), checked as (
    select
      auth.*,
      p_route like 'provisioning-smoke:%'
      and exists (
        select 1 from public.tenant_website_installation_receipts receipt
        where receipt.id=p_receipt_id
          and receipt.api_client_id=auth.client_id
          and receipt.company_id=auth.company_id
          and receipt.state in (
            'client_ready','credential_created','preflight_passed',
            'feed_verified','failed'
          )
      ) as smoke_allowed
    from auth
  )
  select
    case
      when checked.auth_outcome<>'allowed' then checked.auth_outcome
      when checked.smoke_allowed then 'allowed'
      else 'denied'
    end,
    case
      when checked.auth_outcome<>'allowed' then checked.error_code
      when not checked.smoke_allowed then 'provisioning_smoke_receipt_invalid'
      else null
    end,
    checked.tenant_status,
    checked.client_id,
    checked.company_id,
    checked.client_name,
    checked.client_status,
    checked.key_prefix,
    checked.scopes,
    checked.allowed_ips,
    checked.allowed_origins,
    checked.metadata,
    checked.rate_limit_per_minute,
    checked.expires_at,
    checked.request_count,
    checked.route_limit,
    checked.reset_at
  from checked
$function$;

revoke all on function public.authenticate_integration_request_v1_credential_core(
  text,text,text,text[],text[],text,text,integer,integer
) from public, anon, authenticated;
revoke all on function public.authenticate_integration_request_v1(
  text,text,text,text[],text[],text,text,integer,integer
) from public, anon, authenticated;
revoke all on function public.authenticate_provisioning_smoke_request_v1(
  text,text,uuid,text,text[],text[],text,text,integer,integer
) from public, anon, authenticated;
grant execute on function public.authenticate_integration_request_v1_credential_core(
  text,text,text,text[],text[],text,text,integer,integer
) to service_role;
grant execute on function public.authenticate_integration_request_v1(
  text,text,text,text[],text[],text,text,integer,integer
) to service_role;
grant execute on function public.authenticate_provisioning_smoke_request_v1(
  text,text,uuid,text,text[],text[],text,text,integer,integer
) to service_role;

-- Preserve one request-scoped canonical access call while aggregating unscoped
-- roles and permissions across every active company membership.
alter function public.canonical_authenticated_tenant_context(uuid)
  rename to canonical_authenticated_tenant_context_v1_scoped;
revoke all on function public.canonical_authenticated_tenant_context_v1_scoped(uuid)
  from public, anon, authenticated, service_role;

create function public.canonical_authenticated_tenant_context(
  p_selected_company_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $function$
declare
  v_context jsonb;
  v_user_id uuid := auth.uid();
  v_roles jsonb := '[]'::jsonb;
  v_permissions jsonb := '[]'::jsonb;
begin
  v_context := public.canonical_authenticated_tenant_context_v1_scoped(
    p_selected_company_id
  );
  if p_selected_company_id is not null
     or not coalesce((v_context->>'authorized')::boolean,false)
     or v_user_id is null then
    return v_context;
  end if;

  select coalesce(jsonb_agg(role_key order by role_key),'[]'::jsonb)
  into v_roles
  from (
    select distinct role.key as role_key
    from public.user_roles user_role
    join public.roles role on role.id=user_role.role_id and coalesce(role.is_active,true)
    where user_role.user_id=v_user_id
      and coalesce(user_role.status,'active')='active'
      and coalesce(user_role.is_active,true)
      and (
        user_role.company_id is null
        or exists (
          select 1 from public.company_memberships membership
          where membership.user_id=v_user_id
            and membership.company_id=user_role.company_id
            and membership.status='active'
            and coalesce(membership.is_active,true)
        )
      )
  ) scoped_roles;

  select coalesce(jsonb_agg(permission_key order by permission_key),'[]'::jsonb)
  into v_permissions
  from (
    select distinct permission.key as permission_key
    from public.user_roles user_role
    join public.roles role on role.id=user_role.role_id and coalesce(role.is_active,true)
    join public.role_permissions role_permission on role_permission.role_id=role.id
      and coalesce(role_permission.effect,'allow')='allow'
    join public.permissions permission on permission.id=role_permission.permission_id
    where user_role.user_id=v_user_id
      and coalesce(user_role.status,'active')='active'
      and coalesce(user_role.is_active,true)
      and (
        user_role.company_id is null
        or exists (
          select 1 from public.company_memberships membership
          where membership.user_id=v_user_id
            and membership.company_id=user_role.company_id
            and membership.status='active'
            and coalesce(membership.is_active,true)
        )
      )
  ) scoped_permissions;

  return v_context || jsonb_build_object(
    'roles',v_roles,
    'permissions',v_permissions
  );
end
$function$;

revoke all on function public.canonical_authenticated_tenant_context(uuid)
  from public, anon;
grant execute on function public.canonical_authenticated_tenant_context(uuid)
  to authenticated;

-- Serialize lifecycle transitions, return cached results before side effects,
-- skip no-op side effects and attach a canonical side-effect audit receipt.
alter function public.canonical_transition_tenant_lifecycle(
  uuid,text,bigint,text,uuid,text
) rename to canonical_transition_tenant_lifecycle_v4_pre_replay_guard;
revoke all on function public.canonical_transition_tenant_lifecycle_v4_pre_replay_guard(
  uuid,text,bigint,text,uuid,text
) from public, anon, authenticated, service_role;

do $privilege_check$
declare
  v_owner text;
begin
  select pg_get_userbyid(p.proowner) into v_owner
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='canonical_transition_tenant_lifecycle_v4_pre_replay_guard';
  if v_owner is null or not has_table_privilege(v_owner,'auth.sessions','DELETE') then
    raise exception 'canonical_lifecycle_owner_lacks_auth_sessions_delete';
  end if;
end
$privilege_check$;

create function public.canonical_transition_tenant_lifecycle(
  p_company_id uuid,
  p_target_status text,
  p_expected_state_version bigint,
  p_reason text,
  p_actor_user_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $function$
declare
  v_cached jsonb;
  v_current_status text;
  v_current_version bigint;
  v_result jsonb;
  v_session_count bigint := 0;
  v_client_count bigint := 0;
  v_portal_count bigint := 0;
begin
  if nullif(btrim(coalesce(p_idempotency_key,'')),'') is null then
    raise exception using errcode='22023',message='tenant_lifecycle_idempotency_key_required';
  end if;

  select result_payload into v_cached
  from public.canonical_command_results
  where company_id=p_company_id
    and command_type='tenant.lifecycle.transition'
    and idempotency_key=p_idempotency_key;
  if found then
    return v_cached || jsonb_build_object(
      'offboarding_policy','canonical_lifecycle_offboarding_v1',
      'idempotent_replay',true
    );
  end if;

  select lifecycle_status,lifecycle_state_version
  into v_current_status,v_current_version
  from public.companies
  where id=p_company_id
  for update;
  if not found then raise exception 'tenant_not_found'; end if;

  if v_current_status=p_target_status then
    return jsonb_build_object(
      'ok',true,
      'changed',false,
      'code','tenant_lifecycle_unchanged',
      'company_id',p_company_id,
      'status',p_target_status,
      'state_version',v_current_version,
      'offboarding_policy','canonical_lifecycle_offboarding_v1'
    );
  end if;

  select count(*) into v_client_count
  from public.integration_api_clients
  where company_id=p_company_id and deleted_at is null
    and status in ('active','paused');

  select count(*) into v_portal_count
  from public.customer_portal_identities
  where company_id=p_company_id and status in ('active','disabled');

  if p_target_status='closed' then
    select count(*) into v_session_count
    from auth.sessions session
    where session.user_id in (
      select membership.user_id
      from public.company_memberships membership
      where membership.company_id=p_company_id
        and membership.status='active'
        and coalesce(membership.is_active,true)
    );
  end if;

  v_result := public.canonical_transition_tenant_lifecycle_v4_pre_replay_guard(
    p_company_id,p_target_status,p_expected_state_version,p_reason,
    p_actor_user_id,p_idempotency_key
  );

  if coalesce((v_result->>'changed')::boolean,false) then
    insert into public.canonical_audit_events(
      company_id,event_type,aggregate_type,aggregate_id,actor_user_id,reason,
      idempotency_key,after_state
    ) values (
      p_company_id,'TENANT_LIFECYCLE_SIDE_EFFECTS_APPLIED','company',p_company_id,
      p_actor_user_id,p_reason,p_idempotency_key||':side-effects',
      jsonb_build_object(
        'target_status',p_target_status,
        'sessions_revoked',v_session_count,
        'api_clients_evaluated',v_client_count,
        'portal_identities_evaluated',v_portal_count
      )
    );
  end if;

  return v_result || jsonb_build_object(
    'offboarding_policy','canonical_lifecycle_offboarding_v1'
  );
end
$function$;

revoke all on function public.canonical_transition_tenant_lifecycle(
  uuid,text,bigint,text,uuid,text
) from public, anon, authenticated;
grant execute on function public.canonical_transition_tenant_lifecycle(
  uuid,text,bigint,text,uuid,text
) to service_role;

-- Preserve dead-letter history when a reset job later succeeds.
alter function public.canonical_complete_company_provisioning_job(
  uuid,uuid,boolean,text,text,jsonb
) rename to canonical_complete_company_provisioning_job_v1_pre_history_guard;
revoke all on function public.canonical_complete_company_provisioning_job_v1_pre_history_guard(
  uuid,uuid,boolean,text,text,jsonb
) from public, anon, authenticated, service_role;

create function public.canonical_complete_company_provisioning_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_succeeded boolean,
  p_error_code text default null,
  p_error_message text default null,
  p_error_details jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_previous_dead_letter_at timestamptz;
  v_result jsonb;
begin
  select dead_letter_at into v_previous_dead_letter_at
  from public.company_provisioning_jobs
  where id=p_job_id
  for update;

  v_result := public.canonical_complete_company_provisioning_job_v1_pre_history_guard(
    p_job_id,p_lease_token,p_succeeded,p_error_code,p_error_message,p_error_details
  );

  if v_previous_dead_letter_at is not null then
    update public.company_provisioning_jobs
    set dead_letter_at=v_previous_dead_letter_at
    where id=p_job_id and dead_letter_at is null;
  end if;
  return v_result;
end
$function$;

revoke all on function public.canonical_complete_company_provisioning_job(
  uuid,uuid,boolean,text,text,jsonb
) from public, anon, authenticated;
grant execute on function public.canonical_complete_company_provisioning_job(
  uuid,uuid,boolean,text,text,jsonb
) to service_role;

-- Every durable invitation intent receives exactly one idempotent worker job.
create or replace function public.canonical_enqueue_invitation_delivery_job()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if new.status='pending' and nullif(new.idempotency_key,'') is not null then
    insert into public.company_provisioning_jobs(company_id,job_key,idempotency_key)
    values(new.company_id,'auth_invite',new.idempotency_key)
    on conflict(company_id,job_key,idempotency_key) do nothing;
  end if;
  return new;
end
$function$;

revoke all on function public.canonical_enqueue_invitation_delivery_job()
  from public, anon, authenticated, service_role;
drop trigger if exists canonical_enqueue_invitation_delivery_job
  on public.company_invitations;
create trigger canonical_enqueue_invitation_delivery_job
after insert on public.company_invitations
for each row execute function public.canonical_enqueue_invitation_delivery_job();

insert into public.company_provisioning_jobs(company_id,job_key,idempotency_key)
select invitation.company_id,'auth_invite',invitation.idempotency_key
from public.company_invitations invitation
where invitation.status='pending'
  and nullif(invitation.idempotency_key,'') is not null
on conflict(company_id,job_key,idempotency_key) do nothing;

-- Tenant-scoped reconciliation returns all six checks and clears recovered
-- check-error findings. Null scope is rejected to prevent unbounded work.
create or replace function public.canonical_run_architecture_reconciliation(
  p_company_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $function$
declare
  v_count bigint;
  v_results jsonb := '{}'::jsonb;
begin
  if p_company_id is null then
    raise exception using errcode='22023',message='reconciliation_company_scope_required';
  end if;
  if not exists(select 1 from public.companies where id=p_company_id) then
    raise exception 'reconciliation_company_not_found';
  end if;

  begin
    select count(*) into v_count
    from public.company_memberships membership
    where membership.company_id=p_company_id
      and membership.status='active' and coalesce(membership.is_active,true)
      and not exists (
        select 1 from public.user_roles role
        where role.company_id=membership.company_id and role.user_id=membership.user_id
          and coalesce(role.status,'active')='active' and coalesce(role.is_active,true)
      );
    perform public.canonical_set_architecture_finding(
      p_company_id,'active-membership-missing-role','access','critical',
      'Active memberships without canonical roles',v_count,'platform_security',
      'Repair membership and role atomically through canonical_change_tenant_user_access',null);
    perform public.canonical_set_architecture_finding(
      p_company_id,'check-error:active-membership-missing-role','reconciliation','critical',
      'Membership reconciliation check failed',0,'platform_operations',
      'Repair the check before treating access as healthy',null);
    v_results:=v_results||jsonb_build_object('membership_without_role',v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id,'check-error:active-membership-missing-role','reconciliation','critical',
      'Membership reconciliation check failed',1,'platform_operations',
      'Repair the check before treating access as healthy',sqlstate||':'||sqlerrm);
    v_results:=v_results||jsonb_build_object('membership_without_role_error',sqlstate);
  end;

  begin
    select count(*) into v_count from public.integration_api_clients client
    where client.company_id=p_company_id and client.status='active'
      and coalesce(client.launch_ready,false)=false;
    perform public.canonical_set_architecture_finding(
      p_company_id,'active-api-client-not-launch-ready','integration','critical',
      'Active API clients without verified launch readiness',v_count,'integration_operations',
      'Run canonical readiness smoke and pause clients that cannot pass',null);
    perform public.canonical_set_architecture_finding(
      p_company_id,'check-error:active-api-client-not-launch-ready','reconciliation','critical',
      'API client readiness check failed',0,'platform_operations',
      'Repair the check before treating integrations as healthy',null);
    v_results:=v_results||jsonb_build_object('active_client_not_ready',v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id,'check-error:active-api-client-not-launch-ready','reconciliation','critical',
      'API client readiness check failed',1,'platform_operations',
      'Repair the check before treating integrations as healthy',sqlstate||':'||sqlerrm);
    v_results:=v_results||jsonb_build_object('active_client_not_ready_error',sqlstate);
  end;

  begin
    select count(*) into v_count from public.canonical_event_outbox outbox
    where outbox.company_id=p_company_id and outbox.status in ('pending','retry','failed')
      and outbox.available_at<=now() and outbox.claimed_at is null
      and outbox.created_at<now()-interval '5 minutes';
    perform public.canonical_set_architecture_finding(
      p_company_id,'due-stranded-canonical-outbox','events','critical',
      'Due canonical outbox rows are stranded',v_count,'platform_operations',
      'Claim and process the canonical event outbox; inspect dead letters',null);
    perform public.canonical_set_architecture_finding(
      p_company_id,'check-error:due-stranded-canonical-outbox','reconciliation','critical',
      'Canonical outbox check failed',0,'platform_operations',
      'Repair the check before treating event delivery as healthy',null);
    v_results:=v_results||jsonb_build_object('due_stranded_outbox',v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id,'check-error:due-stranded-canonical-outbox','reconciliation','critical',
      'Canonical outbox check failed',1,'platform_operations',
      'Repair the check before treating event delivery as healthy',sqlstate||':'||sqlerrm);
    v_results:=v_results||jsonb_build_object('due_stranded_outbox_error',sqlstate);
  end;

  begin
    select count(*) into v_count from public.company_provisioning_jobs job
    where job.company_id=p_company_id and job.status='dead_letter';
    perform public.canonical_set_architecture_finding(
      p_company_id,'provisioning-dead-letter','provisioning','critical',
      'Tenant provisioning jobs are dead-lettered',v_count,'tenant_operations',
      'Correct the provider/configuration fault and explicitly requeue',null);
    perform public.canonical_set_architecture_finding(
      p_company_id,'check-error:provisioning-dead-letter','reconciliation','critical',
      'Provisioning reconciliation check failed',0,'platform_operations',
      'Repair the check before treating provisioning as healthy',null);
    v_results:=v_results||jsonb_build_object('provisioning_dead_letter',v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id,'check-error:provisioning-dead-letter','reconciliation','critical',
      'Provisioning reconciliation check failed',1,'platform_operations',
      'Repair the check before treating provisioning as healthy',sqlstate||':'||sqlerrm);
    v_results:=v_results||jsonb_build_object('provisioning_dead_letter_error',sqlstate);
  end;

  begin
    select count(*) into v_count from public.customer_operation_jobs job
    where job.company_id=p_company_id and job.status='needs_review'
      and job.review_resolved_at is null and job.review_sla_due_at<now();
    perform public.canonical_set_architecture_finding(
      p_company_id,'manual-review-over-sla','customer_operations','warning',
      'Manual-review jobs exceeded their SLA',v_count,'tenant_operations',
      'Assign an owner, resolve the blocker and record resolution',null);
    perform public.canonical_set_architecture_finding(
      p_company_id,'check-error:manual-review-over-sla','reconciliation','critical',
      'Manual-review SLA check failed',0,'platform_operations',
      'Repair the check before treating manual review as healthy',null);
    v_results:=v_results||jsonb_build_object('manual_review_over_sla',v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id,'check-error:manual-review-over-sla','reconciliation','critical',
      'Manual-review SLA check failed',1,'platform_operations',
      'Repair the check before treating manual review as healthy',sqlstate||':'||sqlerrm);
    v_results:=v_results||jsonb_build_object('manual_review_over_sla_error',sqlstate);
  end;

  begin
    select count(*) into v_count from public.website_customer_applications application
    where application.company_id=p_company_id
      and application.status in ('failed','pending_review','manual_review')
      and application.customer_id is null
      and application.repair_status is null;
    perform public.canonical_set_architecture_finding(
      p_company_id,'customer-application-without-repair-workflow','customer_intake','critical',
      'Incomplete customer applications lack a repair workflow',v_count,'platform_operations',
      'Classify the payload and attach the canonical repair workflow',null);
    perform public.canonical_set_architecture_finding(
      p_company_id,'check-error:customer-application-without-repair-workflow','reconciliation','critical',
      'Customer-application repair check failed',0,'platform_operations',
      'Repair the check before treating customer intake as healthy',null);
    v_results:=v_results||jsonb_build_object('application_without_repair',v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id,'check-error:customer-application-without-repair-workflow','reconciliation','critical',
      'Customer-application repair check failed',1,'platform_operations',
      'Repair the check before treating customer intake as healthy',sqlstate||':'||sqlerrm);
    v_results:=v_results||jsonb_build_object('application_without_repair_error',sqlstate);
  end;

  return jsonb_build_object(
    'checked_at',now(),
    'companies',jsonb_build_object(p_company_id::text,v_results)
  );
end
$function$;

revoke all on function public.canonical_run_architecture_reconciliation(uuid)
  from public, anon, authenticated;
grant execute on function public.canonical_run_architecture_reconciliation(uuid)
  to service_role;

-- Create the actual workflow and continuation job before reporting queued=true.
create or replace function public.canonical_queue_customer_application_repair(
  p_application_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $function$
declare
  application public.website_customer_applications%rowtype;
  v_missing text[] := '{}'::text[];
  v_workflow_id uuid;
  v_job_id uuid;
begin
  select * into application
  from public.website_customer_applications
  where id=p_application_id
  for update;
  if not found then raise exception 'customer_application_not_found'; end if;
  if not public.canonical_actor_is_platform_admin(p_actor_user_id) then
    raise exception using errcode='42501',message='platform_admin_required';
  end if;

  if application.customer_id is null then v_missing:=array_append(v_missing,'customer_id'); end if;
  if application.api_client_id is null then v_missing:=array_append(v_missing,'api_client_id'); end if;
  if nullif(application.payload->>'auth_user_id','') is null then
    v_missing:=array_append(v_missing,'auth_user_id');
  end if;
  if nullif(application.payload->>'customer_portal_user_id','') is null then
    v_missing:=array_append(v_missing,'customer_portal_user_id');
  end if;

  if cardinality(v_missing)>0 then
    update public.website_customer_applications
    set repair_status='awaiting_input',
        repair_owner_user_id=p_actor_user_id,
        repair_reason_code='canonical_repair_input_missing',
        repair_attempts=repair_attempts+1,
        last_repair_at=now(),
        updated_at=now()
    where id=p_application_id;
    return jsonb_build_object(
      'queued',false,
      'status','awaiting_input',
      'missing_fields',to_jsonb(v_missing)
    );
  end if;

  insert into public.customer_application_workflows(
    company_id,customer_application_id,customer_id,customer_site_id,
    metering_point_id,state,snapshot,next_action
  ) values (
    application.company_id,application.id,application.customer_id,
    application.customer_site_id,application.metering_point_id,
    'received',coalesce(application.payload,'{}'::jsonb),'canonical_repair_retry'
  )
  on conflict(company_id,customer_application_id) do update
  set next_action='canonical_repair_retry',updated_at=now()
  returning id into v_workflow_id;

  insert into public.customer_operation_jobs(
    company_id,customer_id,customer_site_id,metering_point_id,
    job_type,status,idempotency_key,payload,created_by,workflow_id,request_snapshot
  ) values (
    application.company_id,application.customer_id,application.customer_site_id,
    application.metering_point_id,'customer_application_continuation','queued',
    'canonical-repair:'||application.id,
    jsonb_build_object('customer_application_id',application.id,'repair',true),
    p_actor_user_id,v_workflow_id,coalesce(application.payload,'{}'::jsonb)
  )
  on conflict do nothing
  returning id into v_job_id;

  if v_job_id is null then
    select id into v_job_id
    from public.customer_operation_jobs
    where company_id=application.company_id
      and workflow_id=v_workflow_id
      and job_type='customer_application_continuation'
    order by created_at desc
    limit 1;
  end if;
  if v_job_id is null then raise exception 'canonical_repair_job_not_created'; end if;

  update public.customer_application_workflows
  set last_job_id=v_job_id,updated_at=now()
  where id=v_workflow_id;

  update public.website_customer_applications
  set repair_status='ready_to_retry',
      repair_owner_user_id=p_actor_user_id,
      repair_reason_code=null,
      repair_attempts=repair_attempts+1,
      last_repair_at=now(),
      next_step='canonical_repair_retry',
      updated_at=now()
  where id=p_application_id;

  return jsonb_build_object(
    'queued',true,
    'status','ready_to_retry',
    'missing_fields','[]'::jsonb,
    'workflow_id',v_workflow_id,
    'job_id',v_job_id
  );
end
$function$;

revoke all on function public.canonical_queue_customer_application_repair(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.canonical_queue_customer_application_repair(uuid,uuid)
  to service_role;

commit;
