-- Runtime capability evidence used by the external API gate.
-- This view validates only capabilities required by the deployed API. Migration
-- history is audited separately and never expires merely because time passes.

create extension if not exists pgcrypto with schema extensions;

create or replace view public.gridex_runtime_schema_catalog_v3
with (security_invoker=true) as
with
required_relations(name) as (values
  ('companies'),('company_memberships'),('integration_api_clients'),
  ('integration_api_rate_limit_events'),('customers'),('customer_sites'),
  ('metering_points'),('customer_contracts'),('customer_invoices'),
  ('customer_documents'),('customer_events'),('customer_notifications'),
  ('powers_of_attorney'),('ediel_messages'),('ediel_outbox'),('metering_values'),
  ('normalized_metering_values'),('billing_underlays'),('manual_email_outbox'),
  ('website_customer_applications'),('website_contract_quotes'),
  ('canonical_public_contract_delivery_readiness_v'),
  ('canonical_public_contract_diagnostics_v'),('canonical_public_contract_offers_v'),
  ('tenant_website_installation_receipts'),('canonical_migration_manifest')
),
required_columns(table_name,column_name) as (values
  ('canonical_migration_manifest','applied_ledger_version'),
  ('canonical_migration_manifest','applied_ledger_name'),
  ('canonical_migration_manifest','verification_kind'),
  ('canonical_migration_manifest','effect_verified'),
  ('canonical_migration_manifest','effect_evidence'),
  ('integration_api_clients','company_id'),('integration_api_clients','status'),
  ('integration_api_clients','profile_key'),('integration_api_clients','key_prefix'),
  ('integration_api_clients','secret_hash'),('integration_api_clients','scopes'),
  ('integration_api_clients','allowed_ips'),('integration_api_clients','allowed_origins'),
  ('integration_api_clients','metadata'),('integration_api_clients','rate_limit_per_minute'),
  ('integration_api_clients','expires_at'),('integration_api_clients','launch_ready'),
  ('integration_api_clients','launch_blockers'),('integration_api_clients','deleted_at'),
  ('website_customer_applications','company_id'),
  ('website_customer_applications','application_number'),
  ('website_customer_applications','status'),('website_customer_applications','customer_id'),
  ('website_customer_applications','contract_id'),
  ('website_customer_applications','offer_reference'),
  ('website_customer_applications','quote_reference'),
  ('website_customer_applications','requested_start_mode'),
  ('website_contract_quotes','company_id'),('website_contract_quotes','quote_reference'),
  ('website_contract_quotes','offer_reference'),('website_contract_quotes','valid_until'),
  ('website_contract_quotes','status'),('website_contract_quotes','price_option_reference'),
  ('website_contract_quotes','area_price_reference'),
  ('website_contract_quotes','invoice_delivery_method'),
  ('website_contract_quotes','selected_component_references'),
  ('website_contract_quotes','mandatory_component_references'),
  ('website_contract_quotes','conditional_component_references'),
  ('website_contract_quotes','site_count'),
  ('canonical_public_contract_delivery_readiness_v','company_id'),
  ('canonical_public_contract_delivery_readiness_v','channel'),
  ('canonical_public_contract_delivery_readiness_v','offer_reference'),
  ('canonical_public_contract_delivery_readiness_v','publication_version_id'),
  ('canonical_public_contract_delivery_readiness_v','canonical_graph_consistent'),
  ('canonical_public_contract_delivery_readiness_v','blockers'),
  ('canonical_public_contract_delivery_readiness_v','visible')
),
required_functions(signature) as (values
  ('integration_api_rate_limit_check(uuid,text,integer,integer)'),
  ('gridex_provision_tenant_website_client_v1(uuid,text,text,text,text,text[],text[],integer,uuid,text)'),
  ('gridex_repair_duplicate_primary_website_client_v1(uuid,text,uuid,uuid,text)'),
  ('gridex_validate_contract_channel_readiness(uuid,uuid,text)'),
  ('canonical_onboard_customer_graph(jsonb)'),
  ('gridex_create_website_customer_contract(uuid,jsonb,text)'),
  ('gridex_submit_customer_move_out_v1(jsonb)'),
  ('gridex_run_end_to_end_reconciliation(uuid)'),
  ('resolve_canonical_ediel_rule_pack(text,text,text,text,text,date)')
),
rls_relations(name) as (values
  ('companies'),('company_memberships'),('integration_api_clients'),
  ('integration_api_rate_limit_events'),('customers'),('customer_sites'),
  ('metering_points'),('customer_contracts'),('customer_invoices'),
  ('customer_documents'),('customer_events'),('customer_notifications'),
  ('powers_of_attorney'),('ediel_messages'),('ediel_outbox'),('metering_values'),
  ('normalized_metering_values'),('billing_underlays'),('manual_email_outbox'),
  ('website_customer_applications'),('website_contract_quotes'),
  ('tenant_website_installation_receipts'),('canonical_migration_manifest')
),
policy_required(name) as (values
  ('companies'),('company_memberships'),('integration_api_clients'),
  ('integration_api_rate_limit_events'),('customers'),('customer_sites'),
  ('metering_points'),('customer_contracts'),('customer_invoices'),
  ('customer_documents'),('customer_events'),('customer_notifications'),
  ('powers_of_attorney'),('ediel_messages'),('ediel_outbox'),('metering_values'),
  ('normalized_metering_values'),('billing_underlays'),('manual_email_outbox'),
  ('website_customer_applications'),('website_contract_quotes')
),
invoker_views(name) as (values
  ('canonical_public_contract_delivery_readiness_v'),
  ('canonical_public_contract_diagnostics_v'),('canonical_public_contract_offers_v')
),
missing_relations as (
  select coalesce(array_agg(name order by name),'{}'::text[]) items
  from required_relations where to_regclass(format('public.%I',name)) is null
),
missing_columns as (
  select coalesce(array_agg(table_name||'.'||column_name order by table_name,column_name),'{}'::text[]) items
  from required_columns r where not exists (
    select 1 from information_schema.columns c
    where c.table_schema='public' and c.table_name=r.table_name and c.column_name=r.column_name
  )
),
missing_functions as (
  select coalesce(array_agg(signature order by signature),'{}'::text[]) items
  from required_functions where to_regprocedure('public.'||signature) is null
),
rls_gaps as (
  select coalesce(array_agg(r.name order by r.name),'{}'::text[]) items
  from rls_relations r left join pg_class c on c.oid=to_regclass(format('public.%I',r.name))
  where c.oid is null or not c.relrowsecurity
),
policy_gaps as (
  select coalesce(array_agg(r.name order by r.name),'{}'::text[]) items
  from policy_required r where not exists (
    select 1 from pg_policies p where p.schemaname='public' and p.tablename=r.name
  )
),
view_gaps as (
  select coalesce(array_agg(v.name order by v.name),'{}'::text[]) items
  from invoker_views v join pg_class c on c.oid=to_regclass(format('public.%I',v.name))
  where not ('security_invoker=true'=any(coalesce(c.reloptions,'{}'::text[])))
),
acl_gaps as (
  select coalesce(array_agg(r.signature order by r.signature),'{}'::text[]) items
  from required_functions r join pg_proc p on p.oid=to_regprocedure('public.'||r.signature)
  where has_function_privilege('anon',p.oid,'EXECUTE')
     or has_function_privilege('authenticated',p.oid,'EXECUTE')
     or not has_function_privilege('service_role',p.oid,'EXECUTE')
),
fingerprint_material as (
  select concat_ws(E'\n',
    coalesce((select string_agg(c.relname||':'||c.relkind::text||':'||c.relrowsecurity::text||':'||coalesce(array_to_string(c.reloptions,','),''),E'\n' order by c.relname)
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in (select name from required_relations)),''),
    coalesce((select string_agg(c.table_name||'.'||c.column_name||':'||c.udt_name||':'||c.is_nullable||':'||coalesce(c.column_default,''),E'\n' order by c.table_name,c.ordinal_position)
      from information_schema.columns c
      where c.table_schema='public' and c.table_name in (select name from required_relations)),''),
    coalesce((select string_agg(p.oid::regprocedure::text||':'||p.prosecdef::text||':'||coalesce(array_to_string(p.proconfig,','),'')||':'||pg_get_functiondef(p.oid),E'\n' order by p.oid::regprocedure::text)
      from pg_proc p where p.oid in (select to_regprocedure('public.'||signature) from required_functions)),''),
    coalesce((select string_agg(p.tablename||':'||p.policyname||':'||p.cmd||':'||array_to_string(p.roles,',')||':'||coalesce(p.qual,'')||':'||coalesce(p.with_check,''),E'\n' order by p.tablename,p.policyname)
      from pg_policies p where p.schemaname='public' and p.tablename in (select name from rls_relations)),'')
  ) value
)
select missing_relations.items missing_relations,
       missing_columns.items missing_columns,
       missing_functions.items missing_functions,
       rls_gaps.items rls_gaps,policy_gaps.items policy_gaps,
       view_gaps.items view_security_gaps,acl_gaps.items function_acl_gaps,
       encode(extensions.digest(convert_to(fingerprint_material.value,'UTF8'),'sha256'),'hex') schema_fingerprint
from missing_relations,missing_columns,missing_functions,rls_gaps,policy_gaps,
     view_gaps,acl_gaps,fingerprint_material;

revoke all on public.gridex_runtime_schema_catalog_v3 from public,anon,authenticated;
grant select on public.gridex_runtime_schema_catalog_v3 to service_role;

create or replace view public.gridex_runtime_operational_integrity_v3
with (security_invoker=true) as
select
  (select count(*) from (
    select company_id,coalesce(nullif(metadata->>'environment',''),'production') environment
    from public.integration_api_clients
    where profile_key='tenant_website' and status='active' and deleted_at is null
      and lower(coalesce(metadata->>'primary','true')) not in ('false','0','no')
    group by company_id,coalesce(nullif(metadata->>'environment',''),'production')
    having count(*)>1
  ) duplicate_groups)::bigint duplicate_primary_groups,
  ((select count(*) from public.ediel_messages where company_id is null)
   +(select count(*) from public.ediel_outbox where company_id is null)
   +(select count(*) from public.billing_underlays where company_id is null))::bigint tenantless_operational_rows,
  (select count(*) from public.integration_api_clients
   where status='active' and deleted_at is null
     and (rate_limit_per_minute is null or rate_limit_per_minute<=0))::bigint invalid_active_api_clients;

revoke all on public.gridex_runtime_operational_integrity_v3 from public,anon,authenticated;
grant select on public.gridex_runtime_operational_integrity_v3 to service_role;

create or replace view public.gridex_runtime_schema_capabilities_v3
with (security_invoker=true) as
with result as (
  select array_remove(array[
    case when cardinality(c.missing_relations)>0 then 'RUNTIME_RELATION_MISSING' end,
    case when cardinality(c.missing_columns)>0 then 'RUNTIME_COLUMN_MISSING' end,
    case when cardinality(c.missing_functions)>0 then 'RUNTIME_FUNCTION_MISSING' end,
    case when cardinality(c.rls_gaps)>0 then 'RUNTIME_RLS_DISABLED' end,
    case when cardinality(c.policy_gaps)>0 then 'RUNTIME_RLS_POLICY_MISSING' end,
    case when cardinality(c.view_security_gaps)>0 then 'RUNTIME_VIEW_SECURITY_INVOKER_MISSING' end,
    case when cardinality(c.function_acl_gaps)>0 then 'RUNTIME_FUNCTION_PRIVILEGE_DRIFT' end,
    case when o.duplicate_primary_groups>0 then 'DUPLICATE_PRIMARY_TENANT_WEBSITE_CLIENT' end,
    case when o.tenantless_operational_rows>0 then 'TENANTLESS_OPERATIONAL_ROWS' end,
    case when o.invalid_active_api_clients>0 then 'ACTIVE_API_CLIENT_CONFIGURATION_INVALID' end
  ],null)::text[] blockers,
  jsonb_build_object(
    'missing_relations',c.missing_relations,'missing_columns',c.missing_columns,
    'missing_functions',c.missing_functions,'rls_gaps',c.rls_gaps,
    'policy_gaps',c.policy_gaps,'view_security_gaps',c.view_security_gaps,
    'function_acl_gaps',c.function_acl_gaps,
    'duplicate_primary_groups',o.duplicate_primary_groups,
    'tenantless_operational_rows',o.tenantless_operational_rows,
    'invalid_active_api_clients',o.invalid_active_api_clients
  ) capabilities,c.schema_fingerprint
  from public.gridex_runtime_schema_catalog_v3 c
  cross join public.gridex_runtime_operational_integrity_v3 o
)
select cardinality(blockers)=0 is_ready,schema_fingerprint,blockers blocking_issues,
       capabilities,now() evaluated_at
from result;

comment on view public.gridex_runtime_schema_capabilities_v3 is
  'Fail-closed runtime capability and security gate. Migration governance is separate.';
revoke all on public.gridex_runtime_schema_capabilities_v3 from public,anon,authenticated;
grant select on public.gridex_runtime_schema_capabilities_v3 to service_role;
