-- Forward-port the remaining production capabilities from superseded PR #107.
-- This migration only adds capabilities still missing on the current canonical schema:
-- 1) audited resolution of existing inbound_processing_jobs manual-review rows;
-- 2) one service-role-only writer for complete platform release receipts.
-- It intentionally does not replace current reconciliation, anonymization or org-number logic.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';
set local search_path = public, auth, pg_catalog;

do $preflight$
begin
  if to_regclass('public.inbound_processing_jobs') is null then
    raise exception 'inbound_processing_jobs_missing';
  end if;
  if to_regclass('public.platform_release_receipts') is null then
    raise exception 'platform_release_receipts_missing';
  end if;
  if to_regclass('public.audit_logs') is null then
    raise exception 'audit_logs_missing';
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inbound_processing_jobs'
      and column_name = 'review_resolution'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inbound_processing_jobs'
      and column_name = 'review_resolved_at'
  ) then
    raise exception 'inbound_manual_review_columns_missing';
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'platform_release_receipts'
      and column_name = 'performance_evidence'
  ) then
    raise exception 'platform_release_receipts_performance_evidence_missing';
  end if;
end
$preflight$;

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
  v_resolved_at timestamptz := now();
begin
  if p_actor_user_id is null
     or not public.canonical_actor_is_platform_admin(p_actor_user_id) then
    raise exception using
      errcode = '42501',
      message = 'platform_admin_required';
  end if;

  if nullif(btrim(coalesce(p_resolution, '')), '') is null then
    raise exception using
      errcode = '22023',
      message = 'manual_review_resolution_required';
  end if;

  if p_next_status not in ('queued', 'completed', 'failed') then
    raise exception using
      errcode = '22023',
      message = 'manual_review_next_status_invalid';
  end if;

  select *
  into v_job
  from public.inbound_processing_jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'inbound_processing_job_not_found';
  end if;

  if v_job.status <> 'manual_review'
     or v_job.review_resolved_at is not null then
    raise exception using
      errcode = '22023',
      message = 'inbound_processing_job_not_open_for_manual_review';
  end if;

  update public.inbound_processing_jobs
  set status = p_next_status,
      review_resolution = btrim(p_resolution),
      review_resolved_at = v_resolved_at,
      locked_at = null,
      locked_by = null,
      finished_at = case
        when p_next_status in ('completed', 'failed') then coalesce(finished_at, v_resolved_at)
        else null
      end,
      updated_at = v_resolved_at
  where id = p_job_id;

  insert into public.audit_logs(
    company_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    new_values
  )
  values (
    v_job.company_id,
    p_actor_user_id,
    'INBOUND_MANUAL_REVIEW_RESOLVED',
    'inbound_processing_jobs',
    p_job_id,
    jsonb_build_object(
      'previous_status', v_job.status,
      'next_status', p_next_status,
      'resolution', btrim(p_resolution),
      'review_owner', v_job.review_owner,
      'review_priority', v_job.review_priority,
      'review_reason', v_job.review_reason,
      'resolved_at', v_resolved_at
    )
  );

  return jsonb_build_object(
    'ok', true,
    'job_id', p_job_id,
    'status', p_next_status,
    'resolved_at', v_resolved_at
  );
end
$function$;

revoke all on function public.canonical_resolve_inbound_manual_review(uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.canonical_resolve_inbound_manual_review(uuid, text, text, uuid)
  to service_role;

comment on function public.canonical_resolve_inbound_manual_review(uuid, text, text, uuid) is
  'Platform-admin audited command for resolving an existing inbound_processing_jobs manual_review row without creating a parallel review queue.';

create or replace function public.canonical_record_platform_release_receipt(
  p_release_sha text,
  p_ci_run_id text,
  p_deployment_id text,
  p_environment text,
  p_schema_migration_version text,
  p_migration_manifest_hash text,
  p_database_schema_fingerprint text,
  p_generated_types_hash text,
  p_openapi_contract_version text,
  p_openapi_hash text,
  p_reconciliation_result jsonb,
  p_performance_evidence jsonb,
  p_evidence jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $function$
declare
  v_id uuid;
begin
  if nullif(btrim(coalesce(p_release_sha, '')), '') is null
     or nullif(btrim(coalesce(p_ci_run_id, '')), '') is null
     or nullif(btrim(coalesce(p_deployment_id, '')), '') is null
     or nullif(btrim(coalesce(p_schema_migration_version, '')), '') is null
     or nullif(btrim(coalesce(p_migration_manifest_hash, '')), '') is null
     or nullif(btrim(coalesce(p_database_schema_fingerprint, '')), '') is null
     or nullif(btrim(coalesce(p_generated_types_hash, '')), '') is null
     or nullif(btrim(coalesce(p_openapi_contract_version, '')), '') is null
     or nullif(btrim(coalesce(p_openapi_hash, '')), '') is null then
    raise exception using
      errcode = '22023',
      message = 'release_identity_incomplete';
  end if;

  if p_environment not in ('development', 'preview', 'staging', 'production') then
    raise exception using
      errcode = '22023',
      message = 'release_environment_invalid';
  end if;

  if jsonb_typeof(coalesce(p_reconciliation_result, 'null'::jsonb)) <> 'object' then
    raise exception using
      errcode = '22023',
      message = 'release_reconciliation_result_required';
  end if;

  if jsonb_typeof(coalesce(p_performance_evidence, 'null'::jsonb)) <> 'object' then
    raise exception using
      errcode = '22023',
      message = 'release_performance_evidence_required';
  end if;

  if jsonb_typeof(coalesce(p_evidence, '{}'::jsonb)) <> 'object' then
    raise exception using
      errcode = '22023',
      message = 'release_evidence_must_be_object';
  end if;

  insert into public.platform_release_receipts(
    release_sha,
    ci_run_id,
    deployment_id,
    environment,
    schema_migration_version,
    status,
    evidence,
    recorded_by,
    recorded_at,
    verified_at,
    migration_manifest_hash,
    database_schema_fingerprint,
    generated_types_hash,
    openapi_contract_version,
    openapi_hash,
    reconciliation_result,
    performance_evidence
  )
  values (
    btrim(p_release_sha),
    btrim(p_ci_run_id),
    btrim(p_deployment_id),
    p_environment,
    btrim(p_schema_migration_version),
    'verified',
    coalesce(p_evidence, '{}'::jsonb),
    auth.uid(),
    now(),
    now(),
    btrim(p_migration_manifest_hash),
    btrim(p_database_schema_fingerprint),
    btrim(p_generated_types_hash),
    btrim(p_openapi_contract_version),
    btrim(p_openapi_hash),
    p_reconciliation_result,
    p_performance_evidence
  )
  on conflict(environment, release_sha, schema_migration_version) do update
  set ci_run_id = excluded.ci_run_id,
      deployment_id = excluded.deployment_id,
      status = 'verified',
      evidence = excluded.evidence,
      verified_at = now(),
      migration_manifest_hash = excluded.migration_manifest_hash,
      database_schema_fingerprint = excluded.database_schema_fingerprint,
      generated_types_hash = excluded.generated_types_hash,
      openapi_contract_version = excluded.openapi_contract_version,
      openapi_hash = excluded.openapi_hash,
      reconciliation_result = excluded.reconciliation_result,
      performance_evidence = excluded.performance_evidence
  where public.platform_release_receipts.status in ('candidate', 'verified')
  returning id into v_id;

  if v_id is null then
    raise exception using
      errcode = '22023',
      message = 'release_receipt_not_reverifiable';
  end if;

  return v_id;
end
$function$;

revoke all on function public.canonical_record_platform_release_receipt(
  text, text, text, text, text, text, text, text, text, text, jsonb, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.canonical_record_platform_release_receipt(
  text, text, text, text, text, text, text, text, text, text, jsonb, jsonb, jsonb
) to service_role;

comment on function public.canonical_record_platform_release_receipt(
  text, text, text, text, text, text, text, text, text, text, jsonb, jsonb, jsonb
) is
  'Service-role-only idempotent release evidence writer. Failed or superseded receipts cannot be overwritten as verified.';

do $verify$
begin
  if has_function_privilege(
    'anon',
    'public.canonical_resolve_inbound_manual_review(uuid,text,text,uuid)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.canonical_resolve_inbound_manual_review(uuid,text,text,uuid)',
    'EXECUTE'
  ) then
    raise exception 'inbound_manual_review_command_exposed_to_external_roles';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.canonical_resolve_inbound_manual_review(uuid,text,text,uuid)',
    'EXECUTE'
  ) then
    raise exception 'service_role_missing_inbound_manual_review_command';
  end if;

  if has_function_privilege(
    'anon',
    'public.canonical_record_platform_release_receipt(text,text,text,text,text,text,text,text,text,text,jsonb,jsonb,jsonb)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.canonical_record_platform_release_receipt(text,text,text,text,text,text,text,text,text,text,jsonb,jsonb,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'platform_release_receipt_writer_exposed_to_external_roles';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.canonical_record_platform_release_receipt(text,text,text,text,text,text,text,text,text,text,jsonb,jsonb,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'service_role_missing_platform_release_receipt_writer';
  end if;
end
$verify$;

commit;
