\set ON_ERROR_STOP on
\echo '1. Supabase migration ledger'
select count(*) as registered_versions, min(version) as first_version, max(version) as last_version
from supabase_migrations.schema_migrations;

\echo '2. Canonical manifest completeness and checksum state'
select count(*) as manifest_files,
       count(distinct version) as manifest_versions,
       count(*) filter (where verified_at is not null) as verified_files,
       count(*) filter (where checksum !~ '^[a-f0-9]{64}$') as invalid_checksums,
       max(verified_at) as last_verified_at,
       array_agg(distinct release_identifier) filter (where release_identifier is not null) as releases
from public.canonical_migration_manifest;

\echo '3. Canonical migration readiness'
select * from public.canonical_migration_readiness_v;

\echo '4. Platform schema readiness'
select id,current_version,is_ready,blocking_issues,verified_at,updated_at
from public.platform_schema_state;

\echo '5. Public-contract delivery readiness per tenant/channel'
select company_id,channel,
       count(*) as total,
       count(*) filter(where visible) as visible,
       jsonb_agg(jsonb_build_object(
         'offer_reference',offer_reference,
         'publication_version_id',publication_version_id,
         'canonical_graph_consistent',canonical_graph_consistent,
         'visible',visible,
         'blockers',blockers
       ) order by name) as offers
from public.canonical_public_contract_delivery_readiness_v
group by company_id,channel
order by company_id,channel;

\echo '6. Duplicate primary tenant website clients (must return zero rows)'
select company_id,
       coalesce(nullif(metadata->>'environment',''),'production') as environment,
       count(*) as active_primary_count,
       array_agg(id order by created_at) as client_ids
from public.integration_api_clients
where profile_key='tenant_website'
  and status='active'
  and deleted_at is null
  and lower(coalesce(metadata->>'primary','true')) not in ('false','0','no')
group by company_id,coalesce(nullif(metadata->>'environment',''),'production')
having count(*) > 1;

\echo '7. API client scopes/origins/readiness'
select id,company_id,name,status,profile_key,scopes,allowed_origins,
       launch_ready,launch_blockers,
       metadata->>'environment' as environment,
       metadata->>'primary' as is_primary
from public.integration_api_clients
where profile_key='tenant_website' and deleted_at is null
order by company_id,created_at;

\echo '8. External SECURITY DEFINER execution (must be intentionally empty/classified)'
select n.nspname as schema_name,p.proname,
       pg_get_function_identity_arguments(p.oid) as arguments,
       p.prorettype='pg_catalog.trigger'::regtype as trigger_function,
       has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
       has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
       coalesce(array_to_string(p.proconfig,','),'') as function_config
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prosecdef
  and (has_function_privilege('anon',p.oid,'EXECUTE')
       or has_function_privilege('authenticated',p.oid,'EXECUTE'))
order by p.proname,arguments;

\echo '9. View security mode'
select c.relname as view_name,
       coalesce(array_to_string(c.reloptions,','),'') as reloptions
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public'
  and c.relkind in ('v','m')
  and c.relname in (
    'canonical_public_contract_delivery_readiness_v',
    'canonical_public_contract_diagnostics_v',
    'canonical_migration_readiness_v'
  )
order by c.relname;

\echo '10. Installation receipts contain hashes, not reusable plaintext secrets'
select id,company_id,api_client_id,environment,state,tenant_reference,
       contract_schema_version,receipt_sha256,failure_code,created_at,completed_at
from public.tenant_website_installation_receipts
order by created_at desc
limit 50;
