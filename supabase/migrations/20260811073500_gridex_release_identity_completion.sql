-- Extend the existing platform release receipt with one canonical service-role writer.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

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
  returning id into v_id;

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
