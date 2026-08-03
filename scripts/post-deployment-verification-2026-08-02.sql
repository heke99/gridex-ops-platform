\set ON_ERROR_STOP on
\echo '1. Supabase migration ledger'
select count(*) as registered_versions,min(version) as first_version,max(version) as last_version
from supabase_migrations.schema_migrations;

\echo '2. Runtime schema capability gate (must be ready with zero blockers)'
select * from public.gridex_runtime_schema_capabilities_v3;

\echo '3. Migration governance (must be ready; no time-based expiration)'
select * from public.gridex_migration_governance_v3;

\echo '4. Canonical manifest mapping/effect summary'
select verification_kind,count(*) as rows,
       count(*) filter(where effect_verified) as effect_verified,
       count(*) filter(where checksum ~ '^[a-f0-9]{64}$') as valid_checksums,
       count(*) filter(where schema_fingerprint ~ '^[a-f0-9]{64}$') as valid_fingerprints,
       max(verified_at) as last_verified_at
from public.canonical_migration_manifest
group by verification_kind order by verification_kind;

\echo '5. Legacy compatibility mirror used only by older deployments'
select id,current_version,is_ready,blocking_issues,verified_at,updated_at
from public.platform_schema_state where id=true;

\echo '6. Public-contract delivery readiness per tenant/channel'
select company_id,channel,count(*) as total,count(*) filter(where visible) as visible,
       jsonb_agg(jsonb_build_object(
         'offer_reference',offer_reference,'publication_version_id',publication_version_id,
         'canonical_graph_consistent',canonical_graph_consistent,'visible',visible,'blockers',blockers
       ) order by name) as offers
from public.canonical_public_contract_delivery_readiness_v
group by company_id,channel order by company_id,channel;

\echo '7. Duplicate primary tenant website clients (must return zero rows)'
select company_id,coalesce(nullif(metadata->>'environment',''),'production') as environment,
       count(*) as active_primary_count,array_agg(id order by created_at) as client_ids
from public.integration_api_clients
where profile_key='tenant_website' and status='active' and deleted_at is null
  and lower(coalesce(metadata->>'primary','true')) not in ('false','0','no')
group by company_id,coalesce(nullif(metadata->>'environment',''),'production')
having count(*)>1;

\echo '8. Tenant website API clients'
select id,company_id,name,status,profile_key,key_prefix,scopes,allowed_origins,
       launch_ready,launch_blockers,metadata->>'environment' environment,
       metadata->>'primary' is_primary,last_used_at
from public.integration_api_clients
where profile_key='tenant_website' and deleted_at is null
order by company_id,created_at;

\echo '9. Required runtime function ACLs'
select p.oid::regprocedure::text signature,
       has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
       has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute,
       has_function_privilege('service_role',p.oid,'EXECUTE') service_role_execute
from pg_proc p where p.oid in (
  to_regprocedure('public.integration_api_rate_limit_check(uuid,text,integer,integer)'),
  to_regprocedure('public.gridex_provision_tenant_website_client_v1(uuid,text,text,text,text,text[],text[],integer,uuid,text)'),
  to_regprocedure('public.gridex_repair_duplicate_primary_website_client_v1(uuid,text,uuid,uuid,text)'),
  to_regprocedure('public.canonical_onboard_customer_graph(jsonb)'),
  to_regprocedure('public.gridex_create_website_customer_contract(uuid,jsonb,text)'),
  to_regprocedure('public.gridex_submit_customer_move_out_v1(jsonb)')
) order by signature;

\echo '10. Runtime/governance views are service-role only'
select relation_name,
       has_table_privilege('anon','public.'||relation_name,'select') anon_select,
       has_table_privilege('authenticated','public.'||relation_name,'select') authenticated_select,
       has_table_privilege('service_role','public.'||relation_name,'select') service_role_select
from unnest(array[
  'gridex_runtime_schema_catalog_v3','gridex_runtime_schema_capabilities_v3',
  'gridex_migration_governance_v3','canonical_migration_manifest',
  'tenant_website_installation_receipts'
]) relation_name order by relation_name;
