-- Review fixes for the remaining Gridex OPS production-gap remediation.
-- Keeps the same public canonical APIs while correcting fail-closed semantics.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

-- Preserve the existing full reconciliation implementation as a private base.
alter function public.canonical_run_architecture_reconciliation(uuid)
  rename to canonical_run_architecture_reconciliation_base_internal;
alter function public.canonical_run_architecture_reconciliation_base_internal(uuid)
  set schema private;

revoke all on function private.canonical_run_architecture_reconciliation_base_internal(uuid)
  from public, anon, authenticated, service_role;

-- Keep one public canonical reconciliation API and correct both outbox checks
-- against their actual status contracts.
create or replace function public.canonical_run_architecture_reconciliation(
  p_company_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, private, pg_temp
as $function$
declare
  v_result jsonb;
  v_count bigint;
begin
  if p_company_id is null then
    raise exception using errcode='22023', message='reconciliation_company_scope_required';
  end if;

  v_result := private.canonical_run_architecture_reconciliation_base_internal(p_company_id);

  begin
    select count(*) into v_count
    from public.event_outbox outbox
    where outbox.company_id=p_company_id
      and outbox.sent_at is null
      and (
        (
          outbox.status in ('queued','failed')
          and outbox.available_at<=now()
          and (outbox.locked_at is null or outbox.locked_at<now()-interval '15 minutes')
          and outbox.created_at<now()-interval '5 minutes'
        )
        or
        (
          outbox.status='processing'
          and coalesce(outbox.locked_at,outbox.created_at)<now()-interval '15 minutes'
        )
      );

    perform public.canonical_set_architecture_finding(
      p_company_id,'due-stranded-event-outbox','events','critical',
      'Due active event-outbox rows are stranded',v_count,'platform_operations',
      'Recover and process the existing event_outbox worker queue',null
    );

    v_result := jsonb_set(
      v_result,
      array['companies',p_company_id::text,'due_stranded_active_outbox'],
      to_jsonb(v_count),
      true
    );
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id,'check-error:due-stranded-event-outbox','reconciliation','critical',
      'Active event-outbox check failed',1,'platform_operations',
      'Repair the check before treating event delivery as healthy',sqlstate||':'||sqlerrm
    );
    v_result := jsonb_set(
      v_result,
      array['companies',p_company_id::text,'due_stranded_active_outbox_error'],
      to_jsonb(sqlstate),
      true
    );
  end;

  begin
    select count(*) into v_count
    from public.canonical_event_outbox outbox
    where outbox.company_id=p_company_id
      and outbox.processed_at is null
      and (
        (
          outbox.status in ('pending','failed')
          and outbox.available_at<=now()
          and outbox.claimed_at is null
          and outbox.created_at<now()-interval '5 minutes'
        )
        or
        (
          outbox.status='processing'
          and coalesce(outbox.claimed_at,outbox.created_at)<now()-interval '15 minutes'
        )
      );

    perform public.canonical_set_architecture_finding(
      p_company_id,'due-stranded-canonical-outbox','events','critical',
      'Due compatibility canonical-outbox rows are stranded',v_count,'platform_operations',
      'Allow the existing deprecation bridge to mirror or resolve the compatibility row',null
    );

    v_result := jsonb_set(
      v_result,
      array['companies',p_company_id::text,'due_stranded_compatibility_outbox'],
      to_jsonb(v_count),
      true
    );
  exception when others then
    perform public.canonical_set_architecture_finding(
      p_company_id,'check-error:due-stranded-canonical-outbox','reconciliation','critical',
      'Compatibility outbox check failed',1,'platform_operations',
      'Repair the compatibility check before treating event delivery as healthy',sqlstate||':'||sqlerrm
    );
    v_result := jsonb_set(
      v_result,
      array['companies',p_company_id::text,'due_stranded_compatibility_outbox_error'],
      to_jsonb(sqlstate),
      true
    );
  end;

  return v_result;
end
$function$;

revoke all on function public.canonical_run_architecture_reconciliation(uuid)
  from public, anon, authenticated;
grant execute on function public.canonical_run_architecture_reconciliation(uuid)
  to service_role;

-- Preserve failed/superseded release verdicts. Re-verification is only valid
-- for candidate/verified identities and never erases prior negative evidence.
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
  p_performance_snapshot jsonb,
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
  if nullif(btrim(coalesce(p_release_sha,'')),'') is null
     or nullif(btrim(coalesce(p_ci_run_id,'')),'') is null
     or nullif(btrim(coalesce(p_deployment_id,'')),'') is null
     or nullif(btrim(coalesce(p_schema_migration_version,'')),'') is null
     or nullif(btrim(coalesce(p_migration_manifest_hash,'')),'') is null
     or nullif(btrim(coalesce(p_database_schema_fingerprint,'')),'') is null
     or nullif(btrim(coalesce(p_generated_types_hash,'')),'') is null
     or nullif(btrim(coalesce(p_openapi_contract_version,'')),'') is null
     or nullif(btrim(coalesce(p_openapi_hash,'')),'') is null then
    raise exception using errcode='22023', message='release_identity_incomplete';
  end if;

  if p_environment not in ('development','preview','staging','production') then
    raise exception using errcode='22023', message='release_environment_invalid';
  end if;
  if jsonb_typeof(coalesce(p_reconciliation_result,'null'::jsonb)) <> 'object' then
    raise exception using errcode='22023', message='release_reconciliation_result_required';
  end if;
  if jsonb_typeof(coalesce(p_performance_snapshot,'null'::jsonb)) <> 'object' then
    raise exception using errcode='22023', message='release_performance_snapshot_required';
  end if;
  if jsonb_typeof(coalesce(p_evidence,'{}'::jsonb)) <> 'object' then
    raise exception using errcode='22023', message='release_evidence_must_be_object';
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
    performance_snapshot
  ) values (
    btrim(p_release_sha),
    btrim(p_ci_run_id),
    btrim(p_deployment_id),
    p_environment,
    btrim(p_schema_migration_version),
    'verified',
    coalesce(p_evidence,'{}'::jsonb),
    auth.uid(),
    now(),
    now(),
    btrim(p_migration_manifest_hash),
    btrim(p_database_schema_fingerprint),
    btrim(p_generated_types_hash),
    btrim(p_openapi_contract_version),
    btrim(p_openapi_hash),
    p_reconciliation_result,
    p_performance_snapshot
  )
  on conflict(environment,release_sha,schema_migration_version) do update
  set ci_run_id=excluded.ci_run_id,
      deployment_id=excluded.deployment_id,
      status='verified',
      evidence=excluded.evidence,
      verified_at=now(),
      migration_manifest_hash=excluded.migration_manifest_hash,
      database_schema_fingerprint=excluded.database_schema_fingerprint,
      generated_types_hash=excluded.generated_types_hash,
      openapi_contract_version=excluded.openapi_contract_version,
      openapi_hash=excluded.openapi_hash,
      reconciliation_result=excluded.reconciliation_result,
      performance_snapshot=excluded.performance_snapshot
  where public.platform_release_receipts.status in ('candidate','verified')
  returning id into v_id;

  if v_id is null then
    raise exception using errcode='22023', message='release_receipt_not_reverifiable';
  end if;

  return v_id;
end
$function$;

revoke all on function public.canonical_record_platform_release_receipt(
  text,text,text,text,text,text,text,text,text,text,jsonb,jsonb,jsonb
) from public, anon, authenticated;
grant execute on function public.canonical_record_platform_release_receipt(
  text,text,text,text,text,text,text,text,text,text,jsonb,jsonb,jsonb
) to service_role;

commit;
