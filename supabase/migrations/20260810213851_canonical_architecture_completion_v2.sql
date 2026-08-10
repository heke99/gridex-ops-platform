begin;

alter table public.website_customer_applications
  add column if not exists repair_status text,
  add column if not exists repair_owner text,
  add column if not exists repair_owner_user_id uuid,
  add column if not exists repair_reason_code text,
  add column if not exists repair_sla_due_at timestamptz,
  add column if not exists repair_attempts integer not null default 0,
  add column if not exists last_repair_at timestamptz;

alter table public.website_customer_applications
  drop constraint if exists website_customer_applications_repair_status_check;
alter table public.website_customer_applications
  add constraint website_customer_applications_repair_status_check
  check (repair_status is null or repair_status in (
    'awaiting_input','ready_to_retry','queued','processing','completed','needs_review','failed'
  )) not valid;
alter table public.website_customer_applications
  validate constraint website_customer_applications_repair_status_check;

alter table public.website_customer_applications
  drop constraint if exists website_customer_applications_repair_owner_user_fk;
alter table public.website_customer_applications
  add constraint website_customer_applications_repair_owner_user_fk
  foreign key (repair_owner_user_id) references auth.users(id) on delete set null not valid;
alter table public.website_customer_applications
  validate constraint website_customer_applications_repair_owner_user_fk;

create index if not exists website_customer_applications_repair_queue_idx
  on public.website_customer_applications(repair_status, repair_sla_due_at, updated_at)
  where repair_status is not null and repair_status not in ('completed');

alter table public.customer_operation_jobs
  add column if not exists review_owner text,
  add column if not exists review_owner_user_id uuid,
  add column if not exists review_reason_code text,
  add column if not exists review_sla_due_at timestamptz,
  add column if not exists review_environment text not null default 'unknown',
  add column if not exists review_resolved_at timestamptz;

alter table public.customer_operation_jobs
  drop constraint if exists customer_operation_jobs_review_owner_user_fk;
alter table public.customer_operation_jobs
  add constraint customer_operation_jobs_review_owner_user_fk
  foreign key (review_owner_user_id) references auth.users(id) on delete set null not valid;
alter table public.customer_operation_jobs
  validate constraint customer_operation_jobs_review_owner_user_fk;

create index if not exists customer_operation_jobs_manual_review_sla_idx
  on public.customer_operation_jobs(review_sla_due_at, company_id, created_at)
  where status = 'needs_review' and review_resolved_at is null;

update public.customer_operation_jobs job
set review_owner = coalesce(job.review_owner, 'tenant_operations'),
    review_reason_code = coalesce(job.review_reason_code, job.last_error_code, job.stale_reason, 'manual_review_required'),
    review_sla_due_at = coalesce(job.review_sla_due_at, now() + interval '24 hours'),
    review_environment = coalesce(nullif(company.operating_environment, ''), 'unknown'),
    updated_at = now()
from public.companies company
where company.id = job.company_id
  and job.status = 'needs_review'
  and (job.review_owner is null or job.review_reason_code is null or job.review_sla_due_at is null);

update public.website_customer_applications application
set repair_status = 'awaiting_input',
    repair_owner = 'platform_operations',
    repair_reason_code = case
      when application.api_client_id is null then 'legacy_payload_missing_canonical_api_client'
      else coalesce(application.error_code, 'legacy_application_incomplete')
    end,
    repair_sla_due_at = now() + interval '24 hours',
    next_step = 'complete_canonical_identity_and_requeue',
    metadata = coalesce(application.metadata, '{}'::jsonb) || jsonb_build_object(
      'repair_workflow', jsonb_build_object(
        'status','awaiting_input',
        'owner','platform_operations',
        'action','complete_canonical_identity_and_requeue',
        'classified_at',now()
      )
    ),
    updated_at = now()
where application.status in ('failed','pending_review','manual_review')
  and application.customer_id is null
  and not exists (
    select 1
    from public.customer_application_workflows workflow
    where workflow.company_id = application.company_id
      and workflow.customer_application_id = application.id
  )
  and application.repair_status is null;

create table if not exists public.platform_release_receipts (
  id uuid primary key default gen_random_uuid(),
  release_sha text not null,
  ci_run_id text not null,
  deployment_id text not null,
  environment text not null check (environment in ('development','preview','staging','production')),
  schema_migration_version text not null,
  status text not null check (status in ('candidate','verified','failed','superseded')),
  evidence jsonb not null default '{}'::jsonb,
  recorded_by uuid references auth.users(id) on delete set null,
  recorded_at timestamptz not null default now(),
  verified_at timestamptz,
  unique(environment, release_sha, schema_migration_version)
);
alter table public.platform_release_receipts enable row level security;
revoke all on table public.platform_release_receipts from public, anon, authenticated;
grant select, insert, update on table public.platform_release_receipts to service_role;

create table if not exists public.platform_performance_budgets (
  route_key text not null,
  environment text not null check (environment in ('development','preview','staging','production')),
  p50_ms integer not null check (p50_ms > 0),
  p95_ms integer not null check (p95_ms >= p50_ms),
  p99_ms integer not null check (p99_ms >= p95_ms),
  max_db_queries integer check (max_db_queries is null or max_db_queries > 0),
  updated_at timestamptz not null default now(),
  primary key(route_key, environment)
);
alter table public.platform_performance_budgets enable row level security;
revoke all on table public.platform_performance_budgets from public, anon, authenticated;
grant select, insert, update, delete on table public.platform_performance_budgets to service_role;

insert into public.platform_performance_budgets(route_key,environment,p50_ms,p95_ms,p99_ms,max_db_queries)
values
  ('admin.dashboard','production',800,1800,3000,12),
  ('admin.customers.list','production',900,2000,3500,10),
  ('api.website.public-contracts','production',300,800,1500,6),
  ('api.portal.customer-context','production',400,1000,1800,8)
on conflict(route_key,environment) do update
set p50_ms=excluded.p50_ms,p95_ms=excluded.p95_ms,p99_ms=excluded.p99_ms,
    max_db_queries=excluded.max_db_queries,updated_at=now();

create or replace function public.canonical_set_architecture_finding(
  p_company_id uuid,
  p_finding_key text,
  p_category text,
  p_severity text,
  p_title text,
  p_count bigint,
  p_owner text,
  p_repair_action text,
  p_check_error text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if p_count > 0 or p_check_error is not null then
    insert into public.platform_reconciliation_findings(
      company_id,finding_key,category,severity,entity_type,status,title,details,
      owner,repair_action,sla_due_at,check_error,first_detected_at,last_detected_at,
      created_at,updated_at
    ) values (
      p_company_id,p_finding_key,p_category,
      case when p_check_error is not null then 'critical' else p_severity end,
      'company','open',p_title,
      jsonb_build_object('count',p_count,'checked_at',now()),
      p_owner,p_repair_action,now()+interval '24 hours',p_check_error,
      now(),now(),now(),now()
    )
    on conflict(company_id,finding_key) do update
    set category=excluded.category,severity=excluded.severity,status='open',
        title=excluded.title,details=excluded.details,owner=excluded.owner,
        repair_action=excluded.repair_action,
        sla_due_at=coalesce(platform_reconciliation_findings.sla_due_at,excluded.sla_due_at),
        check_error=excluded.check_error,resolved_at=null,last_detected_at=now(),updated_at=now();
  else
    update public.platform_reconciliation_findings
    set status='resolved',resolved_at=coalesce(resolved_at,now()),check_error=null,updated_at=now()
    where company_id=p_company_id and finding_key=p_finding_key and status='open';
  end if;
end
$function$;

revoke all on function public.canonical_set_architecture_finding(uuid,text,text,text,text,bigint,text,text,text)
  from public, anon, authenticated;
grant execute on function public.canonical_set_architecture_finding(uuid,text,text,text,text,bigint,text,text,text)
  to service_role;

create or replace function public.canonical_run_architecture_reconciliation(
  p_company_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $function$
declare
  company record;
  v_count bigint;
  v_results jsonb := '{}'::jsonb;
begin
  for company in
    select id from public.companies
    where p_company_id is null or id=p_company_id
    order by id
  loop
    begin
      select count(*) into v_count
      from public.company_memberships membership
      where membership.company_id=company.id
        and membership.status='active' and coalesce(membership.is_active,true)
        and not exists (
          select 1 from public.user_roles role
          where role.company_id=membership.company_id and role.user_id=membership.user_id
            and coalesce(role.status,'active')='active' and coalesce(role.is_active,true)
        );
      perform public.canonical_set_architecture_finding(
        company.id,'active-membership-missing-role','access','critical',
        'Active memberships without canonical roles',v_count,'platform_security',
        'Repair membership and role atomically through canonical_change_tenant_user_access',null);
      v_results := v_results || jsonb_build_object(company.id::text,
        coalesce(v_results->company.id::text,'{}'::jsonb) || jsonb_build_object('membership_without_role',v_count));
    exception when others then
      perform public.canonical_set_architecture_finding(
        company.id,'check-error:active-membership-missing-role','reconciliation','critical',
        'Membership reconciliation check failed',1,'platform_operations',
        'Repair the check before treating access as healthy',sqlstate||':'||sqlerrm);
    end;

    begin
      select count(*) into v_count from public.integration_api_clients client
      where client.company_id=company.id and client.status='active'
        and coalesce(client.launch_ready,false)=false;
      perform public.canonical_set_architecture_finding(
        company.id,'active-api-client-not-launch-ready','integration','critical',
        'Active API clients without verified launch readiness',v_count,'integration_operations',
        'Run canonical readiness smoke and pause clients that cannot pass',null);
      v_results := v_results || jsonb_build_object(company.id::text,
        coalesce(v_results->company.id::text,'{}'::jsonb) || jsonb_build_object('active_client_not_ready',v_count));
    exception when others then
      perform public.canonical_set_architecture_finding(
        company.id,'check-error:active-api-client-not-launch-ready','reconciliation','critical',
        'API client readiness check failed',1,'platform_operations',
        'Repair the check before treating integrations as healthy',sqlstate||':'||sqlerrm);
    end;

    begin
      select count(*) into v_count from public.canonical_event_outbox outbox
      where outbox.company_id=company.id and outbox.status in ('pending','retry','failed')
        and outbox.available_at<=now() and outbox.claimed_at is null
        and outbox.created_at<now()-interval '5 minutes';
      perform public.canonical_set_architecture_finding(
        company.id,'due-stranded-canonical-outbox','events','critical',
        'Due canonical outbox rows are stranded',v_count,'platform_operations',
        'Claim and process the canonical event outbox; inspect dead letters',null);
      v_results := v_results || jsonb_build_object(company.id::text,
        coalesce(v_results->company.id::text,'{}'::jsonb) || jsonb_build_object('due_stranded_outbox',v_count));
    exception when others then
      perform public.canonical_set_architecture_finding(
        company.id,'check-error:due-stranded-canonical-outbox','reconciliation','critical',
        'Canonical outbox check failed',1,'platform_operations',
        'Repair the check before treating event delivery as healthy',sqlstate||':'||sqlerrm);
    end;

    begin
      select count(*) into v_count from public.company_provisioning_jobs job
      where job.company_id=company.id and job.status='dead_letter';
      perform public.canonical_set_architecture_finding(
        company.id,'provisioning-dead-letter','provisioning','critical',
        'Tenant provisioning jobs are dead-lettered',v_count,'tenant_operations',
        'Correct the provider/configuration fault and explicitly requeue',null);
    exception when others then
      perform public.canonical_set_architecture_finding(
        company.id,'check-error:provisioning-dead-letter','reconciliation','critical',
        'Provisioning reconciliation check failed',1,'platform_operations',
        'Repair the check before treating provisioning as healthy',sqlstate||':'||sqlerrm);
    end;

    begin
      select count(*) into v_count from public.customer_operation_jobs job
      where job.company_id=company.id and job.status='needs_review'
        and job.review_resolved_at is null and job.review_sla_due_at<now();
      perform public.canonical_set_architecture_finding(
        company.id,'manual-review-over-sla','customer_operations','warning',
        'Manual-review jobs exceeded their SLA',v_count,'tenant_operations',
        'Assign an owner, resolve the blocker and record resolution',null);
    exception when others then
      perform public.canonical_set_architecture_finding(
        company.id,'check-error:manual-review-over-sla','reconciliation','critical',
        'Manual-review SLA check failed',1,'platform_operations',
        'Repair the check before treating manual review as healthy',sqlstate||':'||sqlerrm);
    end;

    begin
      select count(*) into v_count from public.website_customer_applications application
      where application.company_id=company.id
        and application.status in ('failed','pending_review','manual_review')
        and application.customer_id is null
        and application.repair_status is null;
      perform public.canonical_set_architecture_finding(
        company.id,'customer-application-without-repair-workflow','customer_intake','critical',
        'Incomplete customer applications lack a repair workflow',v_count,'platform_operations',
        'Classify the payload and attach the canonical repair workflow',null);
    exception when others then
      perform public.canonical_set_architecture_finding(
        company.id,'check-error:customer-application-without-repair-workflow','reconciliation','critical',
        'Customer-application repair check failed',1,'platform_operations',
        'Repair the check before treating customer intake as healthy',sqlstate||':'||sqlerrm);
    end;
  end loop;
  return jsonb_build_object('checked_at',now(),'companies',v_results);
end
$function$;

revoke all on function public.canonical_run_architecture_reconciliation(uuid)
  from public, anon, authenticated;
grant execute on function public.canonical_run_architecture_reconciliation(uuid)
  to service_role;

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
begin
  select * into application from public.website_customer_applications
  where id=p_application_id for update;
  if not found then raise exception 'customer_application_not_found'; end if;
  if not public.canonical_actor_is_platform_admin(p_actor_user_id) then
    raise exception using errcode='42501',message='platform_admin_required';
  end if;
  if application.api_client_id is null then v_missing:=array_append(v_missing,'api_client_id'); end if;
  if nullif(application.payload->>'auth_user_id','') is null then v_missing:=array_append(v_missing,'auth_user_id'); end if;
  if nullif(application.payload->>'customer_portal_user_id','') is null then v_missing:=array_append(v_missing,'customer_portal_user_id'); end if;
  if cardinality(v_missing)>0 then
    update public.website_customer_applications
    set repair_status='awaiting_input',repair_owner_user_id=p_actor_user_id,
        repair_reason_code='canonical_repair_input_missing',
        repair_attempts=repair_attempts+1,last_repair_at=now(),updated_at=now()
    where id=p_application_id;
    return jsonb_build_object('queued',false,'status','awaiting_input','missing_fields',v_missing);
  end if;
  update public.website_customer_applications
  set repair_status='ready_to_retry',repair_owner_user_id=p_actor_user_id,
      repair_reason_code=null,repair_attempts=repair_attempts+1,last_repair_at=now(),
      next_step='canonical_repair_retry',updated_at=now()
  where id=p_application_id;
  return jsonb_build_object('queued',true,'status','ready_to_retry','missing_fields','[]'::jsonb);
end
$function$;

revoke all on function public.canonical_queue_customer_application_repair(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.canonical_queue_customer_application_repair(uuid,uuid)
  to service_role;

select public.canonical_run_architecture_reconciliation(null);

commit;
