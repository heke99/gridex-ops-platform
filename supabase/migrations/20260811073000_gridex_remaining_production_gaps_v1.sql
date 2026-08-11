-- Forward-only completion of remaining Gridex OPS production gaps.
-- This migration strengthens existing canonical tables/functions only.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '180s';

-- 1) Make the existing inbound processing queue operational for manual review.
alter table public.inbound_processing_jobs
  add column if not exists review_owner text,
  add column if not exists review_owner_user_id uuid,
  add column if not exists review_priority text not null default 'normal',
  add column if not exists review_reason_code text,
  add column if not exists review_sla_due_at timestamptz,
  add column if not exists review_resolution text,
  add column if not exists review_resolved_at timestamptz,
  add column if not exists review_resolved_by uuid;

alter table public.inbound_processing_jobs
  drop constraint if exists inbound_processing_jobs_review_priority_check;
alter table public.inbound_processing_jobs
  add constraint inbound_processing_jobs_review_priority_check
  check (review_priority in ('low','normal','high','critical')) not valid;
alter table public.inbound_processing_jobs
  validate constraint inbound_processing_jobs_review_priority_check;

alter table public.inbound_processing_jobs
  drop constraint if exists inbound_processing_jobs_review_owner_user_fk;
alter table public.inbound_processing_jobs
  add constraint inbound_processing_jobs_review_owner_user_fk
  foreign key (review_owner_user_id) references auth.users(id) on delete set null not valid;
alter table public.inbound_processing_jobs
  validate constraint inbound_processing_jobs_review_owner_user_fk;

alter table public.inbound_processing_jobs
  drop constraint if exists inbound_processing_jobs_review_resolved_by_fk;
alter table public.inbound_processing_jobs
  add constraint inbound_processing_jobs_review_resolved_by_fk
  foreign key (review_resolved_by) references auth.users(id) on delete set null not valid;
alter table public.inbound_processing_jobs
  validate constraint inbound_processing_jobs_review_resolved_by_fk;

alter table public.inbound_processing_jobs
  drop constraint if exists inbound_processing_jobs_review_resolution_consistency_check;
alter table public.inbound_processing_jobs
  add constraint inbound_processing_jobs_review_resolution_consistency_check
  check (
    (review_resolved_at is null and review_resolution is null and review_resolved_by is null)
    or
    (review_resolved_at is not null and nullif(btrim(review_resolution),'') is not null)
  ) not valid;
alter table public.inbound_processing_jobs
  validate constraint inbound_processing_jobs_review_resolution_consistency_check;

update public.inbound_processing_jobs job
set review_owner = coalesce(nullif(job.review_owner,''),'platform_operations'),
    review_priority = case
      when job.created_at < now() - interval '7 days' then 'high'
      else coalesce(nullif(job.review_priority,''),'normal')
    end,
    review_reason_code = coalesce(
      nullif(job.review_reason_code,''),
      nullif(job.error_message,''),
      'inbound_processing_requires_manual_review'
    ),
    review_sla_due_at = coalesce(job.review_sla_due_at, job.created_at + interval '24 hours'),
    updated_at = now()
where job.status = 'manual_review'
  and job.review_resolved_at is null;

create index if not exists inbound_processing_jobs_manual_review_queue_idx
  on public.inbound_processing_jobs(company_id, review_priority, review_sla_due_at, created_at)
  where status='manual_review' and review_resolved_at is null;

create or replace function public.canonical_resolve_inbound_manual_review(
  p_job_id uuid,
  p_resolution text,
  p_next_status text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $function$
declare
  v_job public.inbound_processing_jobs%rowtype;
begin
  if p_actor_user_id is null or not public.canonical_actor_is_platform_admin(p_actor_user_id) then
    raise exception using errcode='42501', message='platform_admin_required';
  end if;
  if nullif(btrim(coalesce(p_resolution,'')),'') is null then
    raise exception using errcode='22023', message='manual_review_resolution_required';
  end if;
  if p_next_status not in ('queued','completed','failed') then
    raise exception using errcode='22023', message='manual_review_next_status_invalid';
  end if;

  select * into v_job
  from public.inbound_processing_jobs
  where id=p_job_id
  for update;
  if not found then
    raise exception using errcode='P0002', message='inbound_processing_job_not_found';
  end if;
  if v_job.status <> 'manual_review' or v_job.review_resolved_at is not null then
    raise exception using errcode='22023', message='inbound_processing_job_not_open_for_manual_review';
  end if;

  update public.inbound_processing_jobs
  set status=p_next_status,
      review_resolution=btrim(p_resolution),
      review_resolved_at=now(),
      review_resolved_by=p_actor_user_id,
      locked_at=null,
      locked_by=null,
      finished_at=case when p_next_status in ('completed','failed') then coalesce(finished_at,now()) else null end,
      updated_at=now()
  where id=p_job_id;

  insert into public.audit_logs(
    company_id,actor_user_id,action,entity_type,entity_id,new_values
  ) values (
    v_job.company_id,p_actor_user_id,'INBOUND_MANUAL_REVIEW_RESOLVED',
    'inbound_processing_jobs',p_job_id,
    jsonb_build_object(
      'previous_status',v_job.status,
      'next_status',p_next_status,
      'resolution',btrim(p_resolution),
      'review_owner',v_job.review_owner,
      'review_reason_code',v_job.review_reason_code
    )
  );

  return jsonb_build_object(
    'ok',true,'job_id',p_job_id,'status',p_next_status,'resolved_at',now()
  );
end
$function$;

revoke all on function public.canonical_resolve_inbound_manual_review(uuid,text,text,uuid)
  from public, anon, authenticated;
grant execute on function public.canonical_resolve_inbound_manual_review(uuid,text,text,uuid)
  to service_role;

-- 2) Complete the existing account anonymisation transaction.
create or replace function public.anonymize_user_account(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_catalog, pg_temp
as $function$
begin
  if auth.uid() is distinct from target_user_id then
    raise exception using
      errcode='42501',
      message='Can only anonymize your own account';
  end if;

  if exists (
    select 1
    from public.company_memberships membership
    join public.companies company on company.id=membership.company_id
    where membership.user_id=target_user_id
      and coalesce(membership.status,'active')='active'
      and coalesce(
        nullif(lower(membership.membership_role),''),
        nullif(lower(membership.role),''),
        nullif(lower(membership.role_key),'')
      )='owner'
      and company.archived_at is null
  ) then
    raise exception using
      errcode='P0001',
      message='Active companies must be transferred or archived first';
  end if;

  update public.company_invitations
  set status='revoked',
      revoked_at=coalesce(revoked_at,now()),
      accept_token_hash=null,
      temporary_password_expires_at=least(
        coalesce(temporary_password_expires_at,now()),
        now()
      ),
      updated_at=now(),
      metadata=coalesce(metadata,'{}'::jsonb)
        || jsonb_build_object('revocation_reason','account_anonymized')
  where invited_user_id=target_user_id
    and accepted_at is null
    and revoked_at is null;

  delete from public.user_permission_overrides where user_id=target_user_id;
  delete from public.user_roles where user_id=target_user_id;
  delete from public.company_memberships where user_id=target_user_id;

  if to_regclass('public.user_preferences') is not null then
    execute 'delete from public.user_preferences where user_id = $1' using target_user_id;
  end if;
  if to_regclass('public.agency_members') is not null then
    execute 'delete from public.agency_members where user_id = $1' using target_user_id;
  end if;
  if to_regclass('public.team_members') is not null then
    execute 'delete from public.team_members where user_id = $1' using target_user_id;
  end if;
  if to_regclass('public.bankid_enrichment') is not null then
    execute 'delete from public.bankid_enrichment where user_id = $1' using target_user_id;
  end if;
  if to_regclass('public.extension_data') is not null then
    execute
      'delete from public.extension_data where user_id = $1 and key = ''bankid_enrichment'''
      using target_user_id;
  end if;

  delete from auth.refresh_tokens
  where user_id=target_user_id::text
     or session_id in (select id from auth.sessions where user_id=target_user_id);
  delete from auth.sessions where user_id=target_user_id;

  update public.user_profiles
  set email=null,
      full_name=null,
      phone=null,
      user_status='disabled',
      active_company_id=null,
      updated_at=now()
  where id=target_user_id;
end
$function$;

revoke all on function public.anonymize_user_account(uuid) from public, anon;
grant execute on function public.anonymize_user_account(uuid) to authenticated, service_role;

-- 3) Keep one canonical organisation number while preserving legacy writers.
update public.companies
set org_number=organization_number,
    updated_at=now()
where nullif(btrim(coalesce(org_number,'')),'') is null
  and nullif(btrim(coalesce(organization_number,'')),'') is not null;

update public.companies
set organization_number=org_number,
    updated_at=now()
where organization_number is distinct from org_number;

create or replace function public.gridex_sync_company_org_number_compatibility()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if tg_op='UPDATE'
     and new.org_number is not distinct from old.org_number
     and new.organization_number is distinct from old.organization_number then
    new.org_number := new.organization_number;
  end if;

  new.org_number := nullif(btrim(coalesce(new.org_number,new.organization_number,'')),'');
  new.organization_number := new.org_number;
  return new;
end
$function$;

drop trigger if exists companies_org_number_compatibility on public.companies;
create trigger companies_org_number_compatibility
before insert or update of org_number,organization_number on public.companies
for each row execute function public.gridex_sync_company_org_number_compatibility();

-- 4) Enrich the existing release receipt instead of creating another release ledger.
alter table public.platform_release_receipts
  add column if not exists migration_manifest_hash text,
  add column if not exists database_schema_fingerprint text,
  add column if not exists generated_types_hash text,
  add column if not exists openapi_contract_version text,
  add column if not exists openapi_hash text,
  add column if not exists reconciliation_result jsonb,
  add column if not exists performance_snapshot jsonb;

-- 5) Expand the existing bounded reconciliation engine.
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
    v_results:=v_results||jsonb_build_object('membership_without_role',v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id,'check-error:active-membership-missing-role','reconciliation','critical',
      'Membership reconciliation check failed',1,'platform_operations',
      'Repair the check before treating access as healthy',sqlstate||':'||sqlerrm);
    v_results:=v_results||jsonb_build_object('membership_without_role_error',sqlstate);
  end;

  begin
    select count(*) into v_count
    from public.user_roles role
    where role.company_id=p_company_id
      and coalesce(role.status,'active')='active' and coalesce(role.is_active,true)
      and not exists(select 1 from auth.users u where u.id=role.user_id);
    perform public.canonical_set_architecture_finding(
      p_company_id,'role-without-auth-identity','access','critical',
      'Active roles without an Auth identity',v_count,'platform_security',
      'Revoke orphaned roles and repair the canonical identity chain',null);
    v_results:=v_results||jsonb_build_object('role_without_auth_identity',v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id,'check-error:role-without-auth-identity','reconciliation','critical',
      'Role identity reconciliation check failed',1,'platform_operations',
      'Repair the check before treating access as healthy',sqlstate||':'||sqlerrm);
  end;

  begin
    select count(*) into v_count
    from public.user_roles user_role
    join public.roles role on role.id=user_role.role_id
    where user_role.company_id=p_company_id
      and coalesce(user_role.status,'active')='active'
      and coalesce(user_role.is_active,true)
      and role.key in ('owner','admin','company_admin','operations_manager','compliance_manager','pricing_approver')
      and not exists (
        select 1 from public.company_memberships membership
        where membership.company_id=p_company_id
          and membership.user_id=user_role.user_id
          and membership.status='active'
          and coalesce(membership.is_active,true)
      );
    perform public.canonical_set_architecture_finding(
      p_company_id,'stale-privileged-role','access','critical',
      'Privileged tenant roles without active membership',v_count,'platform_security',
      'Revoke stale privileged roles through canonical tenant access mutation',null);
    v_results:=v_results||jsonb_build_object('stale_privileged_role',v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id,'check-error:stale-privileged-role','reconciliation','critical',
      'Privileged-role reconciliation check failed',1,'platform_operations',
      'Repair the check before treating privileged access as healthy',sqlstate||':'||sqlerrm);
  end;

  begin
    select count(*) into v_count from (
      select user_id
      from public.company_memberships
      where company_id=p_company_id and status='active' and coalesce(is_active,true)
      group by user_id having count(*)>1
    ) duplicate_membership;
    perform public.canonical_set_architecture_finding(
      p_company_id,'duplicate-active-membership','access','critical',
      'Duplicate active tenant memberships',v_count,'platform_security',
      'Collapse duplicate memberships to the canonical company/user row',null);
    v_results:=v_results||jsonb_build_object('duplicate_membership',v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id,'check-error:duplicate-active-membership','reconciliation','critical',
      'Duplicate-membership reconciliation check failed',1,'platform_operations',
      'Repair the check before treating membership identity as healthy',sqlstate||':'||sqlerrm);
  end;

  begin
    select count(*) into v_count from (
      select user_id,role_id
      from public.user_roles
      where company_id=p_company_id and status='active' and coalesce(is_active,true)
      group by user_id,role_id having count(*)>1
    ) duplicate_role;
    perform public.canonical_set_architecture_finding(
      p_company_id,'duplicate-active-role','access','critical',
      'Duplicate active tenant role grants',v_count,'platform_security',
      'Collapse duplicate grants through the canonical role mutation',null);
    v_results:=v_results||jsonb_build_object('duplicate_role',v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id,'check-error:duplicate-active-role','reconciliation','critical',
      'Duplicate-role reconciliation check failed',1,'platform_operations',
      'Repair the check before treating role identity as healthy',sqlstate||':'||sqlerrm);
  end;

  begin
    select count(*) into v_count
    from public.company_invitations invitation
    where invitation.company_id=p_company_id
      and invitation.status='accepted'
      and invitation.accepted_at is not null
      and invitation.invited_user_id is not null
      and not exists (
        select 1 from public.company_memberships membership
        where membership.company_id=invitation.company_id
          and membership.user_id=invitation.invited_user_id
          and membership.status='active'
          and coalesce(membership.is_active,true)
      );
    perform public.canonical_set_architecture_finding(
      p_company_id,'accepted-invite-without-access','access','critical',
      'Accepted invitations without active tenant access',v_count,'tenant_operations',
      'Repair acceptance atomically through canonical_accept_tenant_invitation',null);
    v_results:=v_results||jsonb_build_object('accepted_invite_without_access',v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id,'check-error:accepted-invite-without-access','reconciliation','critical',
      'Invitation acceptance reconciliation failed',1,'platform_operations',
      'Repair the check before treating invitations as healthy',sqlstate||':'||sqlerrm);
  end;

  begin
    select count(*) into v_count
    from public.integration_api_clients client
    where client.company_id=p_company_id and client.status='active'
      and coalesce(client.launch_ready,false)=false;
    perform public.canonical_set_architecture_finding(
      p_company_id,'active-api-client-not-launch-ready','integration','critical',
      'Active API clients without verified launch readiness',v_count,'integration_operations',
      'Run canonical readiness smoke and pause clients that cannot pass',null);
    v_results:=v_results||jsonb_build_object('active_client_not_ready',v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id,'check-error:active-api-client-not-launch-ready','reconciliation','critical',
      'API client readiness check failed',1,'platform_operations',
      'Repair the check before treating integrations as healthy',sqlstate||':'||sqlerrm);
  end;

  begin
    select count(*) into v_count
    from public.company_provisioning_jobs job
    where job.company_id=p_company_id
      and job.status in ('pending','queued','retry','processing','running','claimed')
      and coalesce(job.claimed_at,job.started_at,job.created_at) < now()-interval '15 minutes'
      and job.completed_at is null;
    perform public.canonical_set_architecture_finding(
      p_company_id,'stuck-provisioning-job','provisioning','critical',
      'Provisioning jobs are stuck beyond the operational threshold',v_count,'tenant_operations',
      'Recover the existing provisioning job lease and retry idempotently',null);
    v_results:=v_results||jsonb_build_object('stuck_provisioning',v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id,'check-error:stuck-provisioning-job','reconciliation','critical',
      'Provisioning liveness check failed',1,'platform_operations',
      'Repair the check before treating provisioning as healthy',sqlstate||':'||sqlerrm);
  end;

  begin
    select count(*) into v_count
    from public.company_provisioning_jobs job
    where job.company_id=p_company_id and job.status='dead_letter';
    perform public.canonical_set_architecture_finding(
      p_company_id,'provisioning-dead-letter','provisioning','critical',
      'Tenant provisioning jobs are dead-lettered',v_count,'tenant_operations',
      'Correct the provider/configuration fault and explicitly requeue',null);
    v_results:=v_results||jsonb_build_object('provisioning_dead_letter',v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id,'check-error:provisioning-dead-letter','reconciliation','critical',
      'Provisioning reconciliation check failed',1,'platform_operations',
      'Repair the check before treating provisioning as healthy',sqlstate||':'||sqlerrm);
  end;

  begin
    select count(*) into v_count
    from public.event_outbox outbox
    where outbox.company_id=p_company_id
      and outbox.status in ('pending','queued','retry','failed')
      and outbox.available_at<=now()
      and outbox.sent_at is null
      and (outbox.locked_at is null or outbox.locked_at<now()-interval '15 minutes')
      and outbox.created_at<now()-interval '5 minutes';
    perform public.canonical_set_architecture_finding(
      p_company_id,'due-stranded-event-outbox','events','critical',
      'Due active event-outbox rows are stranded',v_count,'platform_operations',
      'Recover and process the existing event_outbox worker queue',null);
    v_results:=v_results||jsonb_build_object('due_stranded_active_outbox',v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id,'check-error:due-stranded-event-outbox','reconciliation','critical',
      'Active event-outbox check failed',1,'platform_operations',
      'Repair the check before treating event delivery as healthy',sqlstate||':'||sqlerrm);
  end;

  begin
    select count(*) into v_count
    from public.canonical_event_outbox outbox
    where outbox.company_id=p_company_id
      and outbox.status in ('pending','retry','failed')
      and outbox.available_at<=now() and outbox.claimed_at is null
      and outbox.created_at<now()-interval '5 minutes';
    perform public.canonical_set_architecture_finding(
      p_company_id,'due-stranded-canonical-outbox','events','critical',
      'Due compatibility canonical-outbox rows are stranded',v_count,'platform_operations',
      'Allow the existing deprecation bridge to mirror or resolve the compatibility row',null);
    v_results:=v_results||jsonb_build_object('due_stranded_compatibility_outbox',v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id,'check-error:due-stranded-canonical-outbox','reconciliation','critical',
      'Compatibility outbox check failed',1,'platform_operations',
      'Repair the compatibility check before treating event delivery as healthy',sqlstate||':'||sqlerrm);
  end;

  begin
    select count(*) into v_count
    from public.customer_contracts contract
    where contract.company_id=p_company_id
      and (contract.customer_id is null or not exists (
        select 1 from public.customers customer
        where customer.id=contract.customer_id and customer.company_id=p_company_id
      ));
    perform public.canonical_set_architecture_finding(
      p_company_id,'contract-without-customer','customer_graph','critical',
      'Customer contracts without a canonical customer',v_count,'tenant_operations',
      'Repair the existing contract/customer relationship before further automation',null);
    v_results:=v_results||jsonb_build_object('contract_without_customer',v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id,'check-error:contract-without-customer','reconciliation','critical',
      'Contract/customer reconciliation failed',1,'platform_operations',
      'Repair the check before treating customer graph as healthy',sqlstate||':'||sqlerrm);
  end;

  begin
    select count(*) into v_count
    from public.customer_contracts contract
    where contract.company_id=p_company_id
      and contract.status in ('signed','active')
      and (contract.site_id is null or not exists (
        select 1 from public.customer_sites site
        where site.id=contract.site_id and site.company_id=p_company_id
      ));
    perform public.canonical_set_architecture_finding(
      p_company_id,'contract-without-site','customer_graph','critical',
      'Signed or active contracts without a canonical site',v_count,'tenant_operations',
      'Attach the contract to the existing canonical customer site',null);
    v_results:=v_results||jsonb_build_object('contract_without_site',v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id,'check-error:contract-without-site','reconciliation','critical',
      'Contract/site reconciliation failed',1,'platform_operations',
      'Repair the check before treating customer graph as healthy',sqlstate||':'||sqlerrm);
  end;

  begin
    select count(*) into v_count
    from public.customer_contracts contract
    where contract.company_id=p_company_id
      and contract.status in ('signed','active')
      and (contract.metering_point_id is null or not exists (
        select 1 from public.metering_points mp
        where mp.id=contract.metering_point_id and mp.company_id=p_company_id
      ));
    perform public.canonical_set_architecture_finding(
      p_company_id,'contract-without-metering-point','customer_graph','critical',
      'Signed or active contracts without a canonical metering point',v_count,'tenant_operations',
      'Attach the contract to the existing canonical metering point',null);
    v_results:=v_results||jsonb_build_object('contract_without_metering_point',v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id,'check-error:contract-without-metering-point','reconciliation','critical',
      'Contract/metering-point reconciliation failed',1,'platform_operations',
      'Repair the check before treating customer graph as healthy',sqlstate||':'||sqlerrm);
  end;

  begin
    select count(*) into v_count
    from public.supplier_switch_requests switch_request
    where switch_request.company_id=p_company_id
      and switch_request.status not in ('draft','cancelled_before_start')
      and (switch_request.customer_contract_id is null or not exists (
        select 1 from public.customer_contracts contract
        where contract.id=switch_request.customer_contract_id
          and contract.company_id=p_company_id
      ));
    perform public.canonical_set_architecture_finding(
      p_company_id,'switch-without-contract','customer_graph','critical',
      'Supplier-switch requests without a canonical contract',v_count,'tenant_operations',
      'Repair the switch/contract link before outbound Ediel processing',null);
    v_results:=v_results||jsonb_build_object('switch_without_contract',v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id,'check-error:switch-without-contract','reconciliation','critical',
      'Supplier-switch reconciliation failed',1,'platform_operations',
      'Repair the check before treating switching as healthy',sqlstate||':'||sqlerrm);
  end;

  begin
    select count(*) into v_count
    from public.ediel_production_state eps
    join public.companies company on company.id=eps.company_id
    where eps.company_id=p_company_id
      and eps.state='live'
      and (
        company.status<>'active'
        or company.lifecycle_status<>'active'
        or coalesce(company.is_active,true)=false
        or company.archived_at is not null
        or company.closed_at is not null
      );
    perform public.canonical_set_architecture_finding(
      p_company_id,'ediel-live-without-valid-tenant','ediel','critical',
      'Live Ediel state on an invalid tenant lifecycle',v_count,'platform_operations',
      'Pause Ediel through the canonical production-state transition before lifecycle repair',null);
    v_results:=v_results||jsonb_build_object('ediel_live_without_valid_tenant',v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id,'check-error:ediel-live-without-valid-tenant','reconciliation','critical',
      'Ediel/tenant lifecycle reconciliation failed',1,'platform_operations',
      'Repair the check before treating Ediel as healthy',sqlstate||':'||sqlerrm);
  end;

  begin
    select count(*) into v_count
    from public.companies company
    where company.id=p_company_id
      and company.lifecycle_status <> case company.status
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
      p_company_id,'invalid-tenant-lifecycle-projection','tenant_lifecycle','critical',
      'Tenant status and lifecycle projection disagree',v_count,'tenant_operations',
      'Repair status through canonical_transition_tenant_lifecycle',null);
    v_results:=v_results||jsonb_build_object('invalid_lifecycle',v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id,'check-error:invalid-tenant-lifecycle-projection','reconciliation','critical',
      'Tenant lifecycle reconciliation failed',1,'platform_operations',
      'Repair the check before treating tenant lifecycle as healthy',sqlstate||':'||sqlerrm);
  end;

  begin
    select count(*) into v_count
    from public.customer_operation_jobs job
    where job.company_id=p_company_id and job.status='needs_review'
      and job.review_resolved_at is null and job.review_sla_due_at<now();
    perform public.canonical_set_architecture_finding(
      p_company_id,'manual-review-over-sla','customer_operations','warning',
      'Customer-operation manual reviews exceeded their SLA',v_count,'tenant_operations',
      'Assign an owner, resolve the blocker and record resolution',null);
    v_results:=v_results||jsonb_build_object('customer_operation_review_over_sla',v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id,'check-error:manual-review-over-sla','reconciliation','critical',
      'Customer-operation manual-review SLA check failed',1,'platform_operations',
      'Repair the check before treating manual review as healthy',sqlstate||':'||sqlerrm);
  end;

  begin
    select count(*) into v_count
    from public.inbound_processing_jobs job
    where job.company_id=p_company_id and job.status='manual_review'
      and job.review_resolved_at is null
      and nullif(btrim(coalesce(job.review_owner,'')),'') is null;
    perform public.canonical_set_architecture_finding(
      p_company_id,'inbound-manual-review-without-owner','inbound_mail','warning',
      'Inbound manual-review jobs without an operational owner',v_count,'platform_operations',
      'Assign the existing inbound job to an operational owner',null);
    v_results:=v_results||jsonb_build_object('inbound_manual_review_without_owner',v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id,'check-error:inbound-manual-review-without-owner','reconciliation','critical',
      'Inbound manual-review ownership check failed',1,'platform_operations',
      'Repair the check before treating inbound review as healthy',sqlstate||':'||sqlerrm);
  end;

  begin
    select count(*) into v_count
    from public.inbound_processing_jobs job
    where job.company_id=p_company_id and job.status='manual_review'
      and job.review_resolved_at is null
      and job.review_sla_due_at<now();
    perform public.canonical_set_architecture_finding(
      p_company_id,'inbound-manual-review-over-sla','inbound_mail','warning',
      'Inbound manual-review jobs exceeded their SLA',v_count,'platform_operations',
      'Resolve the existing inbound review or record an explicit disposition',null);
    v_results:=v_results||jsonb_build_object('inbound_manual_review_over_sla',v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id,'check-error:inbound-manual-review-over-sla','reconciliation','critical',
      'Inbound manual-review SLA check failed',1,'platform_operations',
      'Repair the check before treating inbound review as healthy',sqlstate||':'||sqlerrm);
  end;

  begin
    select count(*) into v_count
    from public.website_customer_applications application
    where application.company_id=p_company_id
      and application.status in ('failed','pending_review','manual_review')
      and application.customer_id is null
      and application.repair_status is null;
    perform public.canonical_set_architecture_finding(
      p_company_id,'customer-application-without-repair-workflow','customer_intake','critical',
      'Incomplete customer applications lack a repair workflow',v_count,'platform_operations',
      'Classify the payload and attach the canonical repair workflow',null);
    v_results:=v_results||jsonb_build_object('application_without_repair',v_count);
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id,'check-error:customer-application-without-repair-workflow','reconciliation','critical',
      'Customer-application repair check failed',1,'platform_operations',
      'Repair the check before treating customer intake as healthy',sqlstate||':'||sqlerrm);
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

commit;
