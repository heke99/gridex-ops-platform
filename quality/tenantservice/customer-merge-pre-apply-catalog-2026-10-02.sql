-- READ ONLY: rerun on OPS piidsfebjqjmnepdpnas immediately before application.
-- Link: link_6aa08570afb48191a4eb728ab8e93c81. No business rows are read.
-- Compare the single returned object with "before" in the adjacent catalog JSON.
-- Exact overwritten bodies/ACL/security/search_path, fourteen prior FK topologies,
-- guard absence, signed protection and target ledger absence are all included.
-- An MCP apply timestamp may differ from repository version 20261002230000.
select current_setting('server_version') as server_version,
  (select count(*) from supabase_migrations.schema_migrations) as ledger_count,
  (select jsonb_agg(jsonb_build_object(
    'schema',n.nspname,'name',p.proname,'identity_arguments',pg_get_function_identity_arguments(p.oid),
    'source_md5',md5(p.prosrc),'definition_md5',md5(pg_get_functiondef(p.oid)),
    'returns',pg_get_function_result(p.oid),'security_definer',p.prosecdef,
    'search_path',p.proconfig,'volatility',p.provolatile,
    'acl',(select jsonb_agg(jsonb_build_object('grantee',case when a.grantee=0 then 'PUBLIC' else r.rolname end,'grantor',o.rolname,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee,a.grantor,a.privilege_type)
      from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a left join pg_roles r on r.oid=a.grantee left join pg_roles o on o.oid=a.grantor))
    order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.oid in(
      to_regprocedure('public.gridex_merge_customers_v1(uuid,uuid,uuid[],uuid,text)'),
      to_regprocedure('public.gridex_customer_contact_change_v1(uuid,uuid,text,uuid,uuid,text,text,timestamptz,jsonb,jsonb,text)'),
      to_regprocedure('public.gridex_guard_merged_portal_customer_write()'),
      to_regprocedure('public.gridex_lock_signed_customer_contract()'))) as procedures,
  (select jsonb_agg(jsonb_build_object(
    'table',c.conrelid::regclass::text,'name',c.conname,'type',c.contype,
    'references',c.confrelid::regclass::text,
    'columns',(select jsonb_agg(a.attname order by u.position) from unnest(c.conkey) with ordinality u(attnum,position) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=u.attnum),
    'referenced_columns',(select jsonb_agg(a.attname order by u.position) from unnest(c.confkey) with ordinality u(attnum,position) join pg_attribute a on a.attrelid=c.confrelid and a.attnum=u.attnum),
    'update_action',c.confupdtype,'delete_action',c.confdeltype,'match_type',c.confmatchtype,
    'validated',c.convalidated,'deferrable',c.condeferrable,'initially_deferred',c.condeferred)
    order by c.conname) from pg_constraint c where c.conname in(
      'customer_case_attachments_case_owner_fk','customer_case_events_case_owner_fk',
      'customer_contracts_company_customer_customer_site_rel_fkey','customer_contracts_company_customer_site_rel_fkey',
      'customer_info_requests_company_customer_site_rel_fkey','grid_owner_data_requests_company_customer_site_rel_fkey',
      'grid_owner_information_requests_company_customer_site_rel_fkey','metering_points_company_customer_site_rel_fkey',
      'outbound_requests_company_customer_customer_site_rel_fkey','outbound_requests_company_customer_site_rel_fkey',
      'powers_of_attorney_company_customer_customer_site_rel_fkey','powers_of_attorney_company_customer_site_rel_fkey',
      'supplier_switch_requests_company_customer_customer_site_rel_fke','supplier_switch_requests_company_customer_site_rel_fkey')) as ownership_fks,
  (select jsonb_agg(jsonb_build_object('table',t.tgrelid::regclass::text,'name',t.tgname,
    'function',t.tgfoid::regprocedure::text,'type',t.tgtype,'enabled',t.tgenabled,'internal',t.tgisinternal,
    'columns',(select jsonb_agg(a.attname order by u.position) from unnest(t.tgattr::smallint[]) with ordinality u(attnum,position) join pg_attribute a on a.attrelid=t.tgrelid and a.attnum=u.attnum),
    'definition',pg_get_triggerdef(t.oid))
    order by t.tgrelid::regclass::text,t.tgname) from pg_trigger t where not t.tgisinternal and (
      t.tgname='guard_merged_portal_customer_write' or t.tgfoid=to_regprocedure('public.gridex_lock_signed_customer_contract()'))) as relevant_triggers,
  (select jsonb_agg(jsonb_build_object('version',version,'name',name,'statements_null',statements is null) order by version)
    from supabase_migrations.schema_migrations where version='20261002230000' or name='customer_merge_portal_lifecycle') as target_ledger;
