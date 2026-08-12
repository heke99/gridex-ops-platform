-- Keep the runtime capability gate semantically identical while avoiding the
-- full information_schema.columns expansion on every readiness check.
-- The direct pg_catalog projection below was compared against all 1,478
-- information_schema column rows in the required relation set before rollout.

create or replace view public.gridex_runtime_schema_catalog_v3
with (security_invoker = true)
as
with required_relations(name) as (
  values
    ('companies'::text),
    ('company_memberships'),
    ('integration_api_clients'),
    ('integration_api_rate_limit_events'),
    ('customers'),
    ('customer_sites'),
    ('metering_points'),
    ('customer_contracts'),
    ('customer_invoices'),
    ('customer_documents'),
    ('customer_events'),
    ('customer_notifications'),
    ('powers_of_attorney'),
    ('ediel_messages'),
    ('ediel_outbox'),
    ('metering_values'),
    ('normalized_metering_values'),
    ('billing_underlays'),
    ('manual_email_outbox'),
    ('website_customer_applications'),
    ('website_contract_quotes'),
    ('canonical_public_contract_delivery_readiness_v'),
    ('canonical_public_contract_diagnostics_v'),
    ('canonical_public_contract_offers_v'),
    ('tenant_website_installation_receipts'),
    ('canonical_migration_manifest')
),
required_columns(table_name, column_name) as (
  values
    ('canonical_migration_manifest'::text,'applied_ledger_version'::text),
    ('canonical_migration_manifest','applied_ledger_name'),
    ('canonical_migration_manifest','verification_kind'),
    ('canonical_migration_manifest','effect_verified'),
    ('canonical_migration_manifest','effect_evidence'),
    ('integration_api_clients','company_id'),
    ('integration_api_clients','status'),
    ('integration_api_clients','profile_key'),
    ('integration_api_clients','key_prefix'),
    ('integration_api_clients','secret_hash'),
    ('integration_api_clients','scopes'),
    ('integration_api_clients','allowed_ips'),
    ('integration_api_clients','allowed_origins'),
    ('integration_api_clients','metadata'),
    ('integration_api_clients','rate_limit_per_minute'),
    ('integration_api_clients','expires_at'),
    ('integration_api_clients','launch_ready'),
    ('integration_api_clients','launch_blockers'),
    ('integration_api_clients','deleted_at'),
    ('website_customer_applications','company_id'),
    ('website_customer_applications','application_number'),
    ('website_customer_applications','status'),
    ('website_customer_applications','customer_id'),
    ('website_customer_applications','contract_id'),
    ('website_customer_applications','offer_reference'),
    ('website_customer_applications','quote_reference'),
    ('website_customer_applications','requested_start_mode'),
    ('website_contract_quotes','company_id'),
    ('website_contract_quotes','quote_reference'),
    ('website_contract_quotes','offer_reference'),
    ('website_contract_quotes','valid_until'),
    ('website_contract_quotes','status'),
    ('website_contract_quotes','price_option_reference'),
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
required_functions(signature) as (
  values
    ('integration_api_rate_limit_check(uuid,text,integer,integer)'::text),
    ('gridex_provision_tenant_website_client_v1(uuid,text,text,text,text,text[],text[],integer,uuid,text)'),
    ('gridex_repair_duplicate_primary_website_client_v1(uuid,text,uuid,uuid,text)'),
    ('gridex_validate_contract_channel_readiness(uuid,uuid,text)'),
    ('canonical_onboard_customer_graph(jsonb)'),
    ('gridex_create_website_customer_contract(uuid,jsonb,text)'),
    ('gridex_submit_customer_move_out_v1(jsonb)'),
    ('gridex_run_end_to_end_reconciliation(uuid)'),
    ('resolve_canonical_ediel_rule_pack(text,text,text,text,text,date)')
),
rls_relations(name) as (
  values
    ('companies'::text),
    ('company_memberships'),
    ('integration_api_clients'),
    ('integration_api_rate_limit_events'),
    ('customers'),
    ('customer_sites'),
    ('metering_points'),
    ('customer_contracts'),
    ('customer_invoices'),
    ('customer_documents'),
    ('customer_events'),
    ('customer_notifications'),
    ('powers_of_attorney'),
    ('ediel_messages'),
    ('ediel_outbox'),
    ('metering_values'),
    ('normalized_metering_values'),
    ('billing_underlays'),
    ('manual_email_outbox'),
    ('website_customer_applications'),
    ('website_contract_quotes'),
    ('tenant_website_installation_receipts'),
    ('canonical_migration_manifest')
),
policy_required(name) as (
  values
    ('companies'::text),
    ('company_memberships'),
    ('integration_api_clients'),
    ('integration_api_rate_limit_events'),
    ('customers'),
    ('customer_sites'),
    ('metering_points'),
    ('customer_contracts'),
    ('customer_invoices'),
    ('customer_documents'),
    ('customer_events'),
    ('customer_notifications'),
    ('powers_of_attorney'),
    ('ediel_messages'),
    ('ediel_outbox'),
    ('metering_values'),
    ('normalized_metering_values'),
    ('billing_underlays'),
    ('manual_email_outbox'),
    ('website_customer_applications'),
    ('website_contract_quotes')
),
invoker_views(name) as (
  values
    ('canonical_public_contract_delivery_readiness_v'::text),
    ('canonical_public_contract_diagnostics_v'),
    ('canonical_public_contract_offers_v')
),
catalog_columns as materialized (
  select
    cls.relname::text as table_name,
    a.attname::text as column_name,
    a.attnum::integer as ordinal_position,
    t.typname::text as udt_name,
    case
      when a.attnotnull or (t.typtype = 'd' and t.typnotnull) then 'NO'::text
      else 'YES'::text
    end as is_nullable,
    case
      when a.attgenerated <> '' then ''::text
      else coalesce(pg_get_expr(ad.adbin, ad.adrelid), '')
    end as column_default
  from required_relations r
  join pg_namespace n
    on n.nspname = 'public'
  join pg_class cls
    on cls.relnamespace = n.oid
   and cls.relname = r.name
   and cls.relkind = any (array['r'::"char", 'v'::"char", 'f'::"char", 'p'::"char"])
  join pg_attribute a
    on a.attrelid = cls.oid
   and a.attnum > 0
   and not a.attisdropped
  join pg_type t
    on t.oid = a.atttypid
  left join pg_attrdef ad
    on ad.adrelid = a.attrelid
   and ad.adnum = a.attnum
),
missing_relations as (
  select coalesce(array_agg(r.name order by r.name), '{}'::text[]) as items
  from required_relations r
  where to_regclass(format('public.%I', r.name)) is null
),
missing_columns as (
  select coalesce(array_agg(r.table_name || '.' || r.column_name order by r.table_name, r.column_name), '{}'::text[]) as items
  from required_columns r
  where not exists (
    select 1
    from catalog_columns c
    where c.table_name = r.table_name
      and c.column_name = r.column_name
  )
),
missing_functions as (
  select coalesce(array_agg(r.signature order by r.signature), '{}'::text[]) as items
  from required_functions r
  where to_regprocedure('public.' || r.signature) is null
),
rls_gaps as (
  select coalesce(array_agg(r.name order by r.name), '{}'::text[]) as items
  from rls_relations r
  left join pg_class c
    on c.oid = to_regclass(format('public.%I', r.name))::oid
  where c.oid is null or not c.relrowsecurity
),
policy_gaps as (
  select coalesce(array_agg(r.name order by r.name), '{}'::text[]) as items
  from policy_required r
  where not exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = r.name
  )
),
view_gaps as (
  select coalesce(array_agg(v.name order by v.name), '{}'::text[]) as items
  from invoker_views v
  join pg_class c
    on c.oid = to_regclass(format('public.%I', v.name))::oid
  where not ('security_invoker=true' = any (coalesce(c.reloptions, '{}'::text[])))
),
acl_gaps as (
  select coalesce(array_agg(r.signature order by r.signature), '{}'::text[]) as items
  from required_functions r
  join pg_proc p
    on p.oid = to_regprocedure('public.' || r.signature)::oid
  where has_function_privilege('anon', p.oid, 'EXECUTE')
     or has_function_privilege('authenticated', p.oid, 'EXECUTE')
     or not has_function_privilege('service_role', p.oid, 'EXECUTE')
),
fingerprint_material as (
  select concat_ws(
    E'\n',
    coalesce((
      select string_agg(
        c.relname::text || ':' || c.relkind::text || ':' || c.relrowsecurity::text || ':' || coalesce(array_to_string(c.reloptions, ','), ''),
        E'\n' order by c.relname
      )
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in (select name from required_relations)
    ), ''),
    coalesce((
      select string_agg(
        c.table_name || '.' || c.column_name || ':' || c.udt_name || ':' || c.is_nullable || ':' || c.column_default,
        E'\n' order by c.table_name, c.ordinal_position
      )
      from catalog_columns c
    ), ''),
    coalesce((
      select string_agg(
        p.oid::regprocedure::text || ':' || p.prosecdef::text || ':' || coalesce(array_to_string(p.proconfig, ','), '') || ':' || pg_get_functiondef(p.oid),
        E'\n' order by p.oid::regprocedure::text
      )
      from pg_proc p
      where p.oid in (
        select to_regprocedure('public.' || r.signature)
        from required_functions r
      )
    ), ''),
    coalesce((
      select string_agg(
        p.tablename::text || ':' || p.policyname::text || ':' || p.cmd || ':' || array_to_string(p.roles, ',') || ':' || coalesce(p.qual, '') || ':' || coalesce(p.with_check, ''),
        E'\n' order by p.tablename, p.policyname
      )
      from pg_policies p
      where p.schemaname = 'public'
        and p.tablename in (select name from rls_relations)
    ), '')
  ) as value
)
select
  missing_relations.items as missing_relations,
  missing_columns.items as missing_columns,
  missing_functions.items as missing_functions,
  rls_gaps.items as rls_gaps,
  policy_gaps.items as policy_gaps,
  view_gaps.items as view_security_gaps,
  acl_gaps.items as function_acl_gaps,
  encode(digest(convert_to(fingerprint_material.value, 'UTF8'), 'sha256'), 'hex') as schema_fingerprint
from missing_relations,
     missing_columns,
     missing_functions,
     rls_gaps,
     policy_gaps,
     view_gaps,
     acl_gaps,
     fingerprint_material;

comment on view public.gridex_runtime_schema_catalog_v3 is
  'Runtime capability catalog v3 using targeted pg_catalog metadata for the required Gridex relation set; preserves the existing fingerprint contract while avoiding broad information_schema expansion.';
