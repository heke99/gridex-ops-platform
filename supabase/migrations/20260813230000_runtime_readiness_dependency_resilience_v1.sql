-- Persist expensive runtime readiness, add distributed dependency state,
-- legacy auth telemetry and a set-based geodata staging path.

create table if not exists public.platform_runtime_readiness (
  id boolean primary key default true check (id),
  schema_version text not null,
  schema_fingerprint text not null check (schema_fingerprint ~ '^[a-f0-9]{64}$'),
  is_ready boolean not null default false,
  blocking_issues jsonb not null default '[]'::jsonb check (jsonb_typeof(blocking_issues) = 'array'),
  capabilities jsonb not null default '{}'::jsonb check (jsonb_typeof(capabilities) = 'object'),
  verified_at timestamptz not null,
  deployment_id text,
  migration_version text not null check (migration_version ~ '^[0-9]{14}$'),
  updated_at timestamptz not null default now()
);
alter table public.platform_runtime_readiness enable row level security;
revoke all on table public.platform_runtime_readiness from public, anon, authenticated;
grant select, insert, update, delete on table public.platform_runtime_readiness to service_role;

create or replace function public.gridex_refresh_platform_runtime_readiness_v1(
  p_schema_version text, p_deployment_id text default null, p_migration_version text default null
) returns public.platform_runtime_readiness
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_runtime record;
  v_result public.platform_runtime_readiness%rowtype;
  v_schema_version text := nullif(btrim(coalesce(p_schema_version, '')), '');
  v_migration_version text := nullif(btrim(coalesce(p_migration_version, '')), '');
begin
  if v_schema_version is null then raise exception using errcode='22023', message='runtime_schema_version_required'; end if;
  if v_migration_version is null then
    select max(version::text) into v_migration_version from supabase_migrations.schema_migrations;
  end if;
  if v_migration_version is null or v_migration_version !~ '^[0-9]{14}$' then
    raise exception using errcode='22023', message='runtime_migration_version_invalid';
  end if;
  select is_ready, schema_fingerprint, blocking_issues, capabilities into strict v_runtime
  from public.gridex_runtime_schema_capabilities_v3;
  insert into public.platform_runtime_readiness(id,schema_version,schema_fingerprint,is_ready,blocking_issues,capabilities,verified_at,deployment_id,migration_version,updated_at)
  values(true,v_schema_version,v_runtime.schema_fingerprint,v_runtime.is_ready and coalesce(cardinality(v_runtime.blocking_issues),0)=0,to_jsonb(coalesce(v_runtime.blocking_issues,'{}'::text[])),coalesce(v_runtime.capabilities,'{}'::jsonb),now(),nullif(btrim(coalesce(p_deployment_id,'')),''),v_migration_version,now())
  on conflict(id) do update set schema_version=excluded.schema_version,schema_fingerprint=excluded.schema_fingerprint,is_ready=excluded.is_ready,blocking_issues=excluded.blocking_issues,capabilities=excluded.capabilities,verified_at=excluded.verified_at,deployment_id=excluded.deployment_id,migration_version=excluded.migration_version,updated_at=excluded.updated_at
  returning * into v_result;
  return v_result;
end $$;
revoke all on function public.gridex_refresh_platform_runtime_readiness_v1(text,text,text) from public,anon,authenticated;
grant execute on function public.gridex_refresh_platform_runtime_readiness_v1(text,text,text) to service_role;

create table if not exists public.dependency_circuit_state (
  dependency_key text primary key,
  state text not null default 'closed' check (state in ('closed','open','half_open')),
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  opened_at timestamptz, half_open_after timestamptz, probe_lease_expires_at timestamptz,
  last_attempt_at timestamptz, last_success_at timestamptz, last_failure_at timestamptz,
  last_error_code text, updated_at timestamptz not null default now()
);
alter table public.dependency_circuit_state enable row level security;
revoke all on table public.dependency_circuit_state from public,anon,authenticated;
grant select,insert,update,delete on table public.dependency_circuit_state to service_role;

create or replace function public.gridex_dependency_circuit_before_request_v1(p_dependency_key text,p_probe_lease_seconds integer default 30)
returns table(allowed boolean,circuit_state text,retry_at timestamptz)
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_key text:=lower(btrim(coalesce(p_dependency_key,''))); v_row public.dependency_circuit_state%rowtype;
begin
  if v_key !~ '^[a-z0-9._:-]{2,100}$' or p_probe_lease_seconds<5 or p_probe_lease_seconds>300 then raise exception using errcode='22023',message='dependency_circuit_input_invalid'; end if;
  insert into public.dependency_circuit_state(dependency_key) values(v_key) on conflict(dependency_key) do nothing;
  select * into v_row from public.dependency_circuit_state where dependency_key=v_key for update;
  if v_row.state='closed' then update public.dependency_circuit_state set last_attempt_at=now(),updated_at=now() where dependency_key=v_key; return query select true,'closed'::text,null::timestamptz; return; end if;
  if v_row.state='open' and v_row.half_open_after<=now() then update public.dependency_circuit_state set state='half_open',probe_lease_expires_at=now()+make_interval(secs=>p_probe_lease_seconds),last_attempt_at=now(),updated_at=now() where dependency_key=v_key; return query select true,'half_open'::text,null::timestamptz; return; end if;
  if v_row.state='half_open' and (v_row.probe_lease_expires_at is null or v_row.probe_lease_expires_at<=now()) then update public.dependency_circuit_state set probe_lease_expires_at=now()+make_interval(secs=>p_probe_lease_seconds),last_attempt_at=now(),updated_at=now() where dependency_key=v_key; return query select true,'half_open'::text,null::timestamptz; return; end if;
  return query select false,v_row.state,coalesce(v_row.half_open_after,v_row.probe_lease_expires_at);
end $$;

create or replace function public.gridex_dependency_circuit_record_v1(p_dependency_key text,p_outcome text,p_error_code text default null,p_failure_threshold integer default 5,p_open_seconds integer default 60)
returns public.dependency_circuit_state language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_key text:=lower(btrim(coalesce(p_dependency_key,''))); v_outcome text:=lower(btrim(coalesce(p_outcome,''))); v_result public.dependency_circuit_state%rowtype;
begin
  if v_key !~ '^[a-z0-9._:-]{2,100}$' or v_outcome not in ('success','failure') or p_failure_threshold<1 or p_failure_threshold>100 or p_open_seconds<5 or p_open_seconds>3600 then raise exception using errcode='22023',message='dependency_circuit_input_invalid'; end if;
  insert into public.dependency_circuit_state(dependency_key) values(v_key) on conflict(dependency_key) do nothing;
  if v_outcome='success' then update public.dependency_circuit_state set state='closed',consecutive_failures=0,opened_at=null,half_open_after=null,probe_lease_expires_at=null,last_success_at=now(),last_attempt_at=now(),last_error_code=null,updated_at=now() where dependency_key=v_key returning * into v_result;
  else update public.dependency_circuit_state set consecutive_failures=consecutive_failures+1,state=case when state='half_open' or consecutive_failures+1>=p_failure_threshold then 'open' else state end,opened_at=case when state='half_open' or consecutive_failures+1>=p_failure_threshold then now() else opened_at end,half_open_after=case when state='half_open' or consecutive_failures+1>=p_failure_threshold then now()+make_interval(secs=>p_open_seconds) else half_open_after end,probe_lease_expires_at=null,last_failure_at=now(),last_attempt_at=now(),last_error_code=nullif(left(btrim(coalesce(p_error_code,'')),100),''),updated_at=now() where dependency_key=v_key returning * into v_result; end if;
  return v_result;
end $$;
revoke all on function public.gridex_dependency_circuit_before_request_v1(text,integer) from public,anon,authenticated;
revoke all on function public.gridex_dependency_circuit_record_v1(text,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.gridex_dependency_circuit_before_request_v1(text,integer) to service_role;
grant execute on function public.gridex_dependency_circuit_record_v1(text,text,text,integer,integer) to service_role;

alter table public.integration_api_clients add column if not exists legacy_api_key_request_count bigint not null default 0;
alter table public.integration_api_clients add column if not exists last_legacy_api_key_used_at timestamptz;
alter table public.integration_api_clients add column if not exists last_legacy_api_key_route text;
alter table public.integration_api_clients add column if not exists legacy_api_key_migration_status text not null default 'unknown';
create or replace function public.gridex_record_legacy_api_key_use_v1(p_api_client_id uuid,p_route text) returns void language sql security definer set search_path=pg_catalog,public,pg_temp as $$
 update public.integration_api_clients set legacy_api_key_request_count=legacy_api_key_request_count+1,last_legacy_api_key_used_at=now(),last_legacy_api_key_route=left(nullif(btrim(coalesce(p_route,'')),''),500),legacy_api_key_migration_status=case when legacy_api_key_migration_status='migrated' then 'in_progress' when legacy_api_key_migration_status='unknown' then 'not_started' else legacy_api_key_migration_status end,updated_at=now() where id=p_api_client_id;
$$;
revoke all on function public.gridex_record_legacy_api_key_use_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.gridex_record_legacy_api_key_use_v1(uuid,text) to service_role;
create or replace view public.integration_legacy_api_key_sunset_v with (security_invoker=true) as
select id api_client_id,company_id,name api_client_name,status,legacy_api_key_request_count,last_legacy_api_key_used_at,last_legacy_api_key_route,legacy_api_key_migration_status,date '2026-10-31' sunset_date,status='active' and legacy_api_key_request_count>0 and coalesce(last_legacy_api_key_used_at,'-infinity'::timestamptz)>=now()-interval '30 days' blocks_removal from public.integration_api_clients where deleted_at is null;
revoke all on public.integration_legacy_api_key_sunset_v from public,anon,authenticated;
grant select on public.integration_legacy_api_key_sunset_v to service_role;

create or replace function public.gridex_stage_energy_geodata_features_v2(p_geodata_version_id uuid,p_features jsonb)
returns table(rows_received integer,rows_upserted integer) language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_received integer; v_upserted integer;
begin
 if p_geodata_version_id is null or p_features is null or jsonb_typeof(p_features)<>'array' or jsonb_array_length(p_features)<1 or jsonb_array_length(p_features)>1000 then raise exception using errcode='22023',message='invalid_energy_geodata_feature_batch'; end if;
 if not exists(select 1 from public.energy_geodata_versions where id=p_geodata_version_id and provider='svk_arcgis' and status='importing') then raise exception using errcode='55000',message='energy_geodata_version_not_importing'; end if;
 select count(*)::integer into v_received from jsonb_array_elements(p_features);
 if exists(select 1 from jsonb_to_recordset(p_features) f(feature_id text,properties jsonb,geometry_geojson jsonb,source_url text) where nullif(btrim(feature_id),'') is null or geometry_geojson is null or jsonb_typeof(geometry_geojson)<>'object') then raise exception using errcode='22023',message='invalid_energy_geodata_feature'; end if;
 insert into public.energy_geodata_features_staging(geodata_version_id,feature_id,source_url,properties,geometry_geojson,updated_at)
 select p_geodata_version_id,btrim(f.feature_id),nullif(btrim(coalesce(f.source_url,'')),''),coalesce(f.properties,'{}'::jsonb),f.geometry_geojson,now() from jsonb_to_recordset(p_features) f(feature_id text,properties jsonb,geometry_geojson jsonb,source_url text)
 on conflict(geodata_version_id,feature_id) do update set source_url=excluded.source_url,properties=excluded.properties,geometry_geojson=excluded.geometry_geojson,updated_at=now();
 get diagnostics v_upserted=row_count; return query select v_received,v_upserted;
end $$;
revoke all on function public.gridex_stage_energy_geodata_features_v2(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.gridex_stage_energy_geodata_features_v2(uuid,jsonb) to service_role;

select public.gridex_refresh_platform_runtime_readiness_v1('20260803093300-gridex-runtime-readiness-v3',null,'20260813230000');
