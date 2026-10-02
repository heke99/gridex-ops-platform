-- READ ONLY: run on OPS piidsfebjqjmnepdpnas after the single frozen migration.
-- Account link: link_6aa08570afb48191a4eb728ab8e93c81 (never the Web account).
-- File: 20261002230000_customer_merge_portal_lifecycle.sql
-- File SHA256: 836c083fad0f231a145cf4117527057a20bdc2f73d094c3fbaa53fbab525a4c9
-- Baseline: customer-merge-catalog-before-2026-10-02.json, ledger count 366.
-- No customer rows, fixtures, temporary tables or ledger mutations are used.
-- MCP may record an apply timestamp instead of the repository filename version.
-- Verify the one exact name and report its observed version; do not repair it.
do $assert$
declare
  expected_fks constant jsonb := $fks$
  [
    {"name":"customer_case_attachments_case_owner_fk","type":"f","table":"customer_case_attachments","columns":["customer_case_id","company_id","customer_id"],"validated":true,"deferrable":true,"match_type":"s","references":"customer_cases","delete_action":"c","update_action":"a","initially_deferred":false,"referenced_columns":["id","company_id","customer_id"]},
    {"name":"customer_case_events_case_owner_fk","type":"f","table":"customer_case_events","columns":["customer_case_id","company_id","customer_id"],"validated":true,"deferrable":true,"match_type":"s","references":"customer_cases","delete_action":"c","update_action":"a","initially_deferred":false,"referenced_columns":["id","company_id","customer_id"]},
    {"name":"customer_contracts_company_customer_customer_site_rel_fkey","type":"f","table":"customer_contracts","columns":["company_id","customer_id","customer_site_id"],"validated":true,"deferrable":true,"match_type":"s","references":"customer_sites","delete_action":"a","update_action":"a","initially_deferred":false,"referenced_columns":["company_id","customer_id","id"]},
    {"name":"customer_contracts_company_customer_site_rel_fkey","type":"f","table":"customer_contracts","columns":["company_id","customer_id","site_id"],"validated":true,"deferrable":true,"match_type":"s","references":"customer_sites","delete_action":"a","update_action":"a","initially_deferred":false,"referenced_columns":["company_id","customer_id","id"]},
    {"name":"customer_info_requests_company_customer_site_rel_fkey","type":"f","table":"customer_info_requests","columns":["company_id","customer_id","site_id"],"validated":true,"deferrable":true,"match_type":"s","references":"customer_sites","delete_action":"a","update_action":"a","initially_deferred":false,"referenced_columns":["company_id","customer_id","id"]},
    {"name":"grid_owner_data_requests_company_customer_site_rel_fkey","type":"f","table":"grid_owner_data_requests","columns":["company_id","customer_id","site_id"],"validated":true,"deferrable":true,"match_type":"s","references":"customer_sites","delete_action":"a","update_action":"a","initially_deferred":false,"referenced_columns":["company_id","customer_id","id"]},
    {"name":"grid_owner_information_requests_company_customer_site_rel_fkey","type":"f","table":"grid_owner_information_requests","columns":["company_id","customer_id","customer_site_id"],"validated":true,"deferrable":true,"match_type":"s","references":"customer_sites","delete_action":"a","update_action":"a","initially_deferred":false,"referenced_columns":["company_id","customer_id","id"]},
    {"name":"metering_points_company_customer_site_rel_fkey","type":"f","table":"metering_points","columns":["company_id","customer_id","site_id"],"validated":true,"deferrable":true,"match_type":"s","references":"customer_sites","delete_action":"a","update_action":"a","initially_deferred":false,"referenced_columns":["company_id","customer_id","id"]},
    {"name":"outbound_requests_company_customer_customer_site_rel_fkey","type":"f","table":"outbound_requests","columns":["company_id","customer_id","customer_site_id"],"validated":true,"deferrable":true,"match_type":"s","references":"customer_sites","delete_action":"a","update_action":"a","initially_deferred":false,"referenced_columns":["company_id","customer_id","id"]},
    {"name":"outbound_requests_company_customer_site_rel_fkey","type":"f","table":"outbound_requests","columns":["company_id","customer_id","site_id"],"validated":true,"deferrable":true,"match_type":"s","references":"customer_sites","delete_action":"a","update_action":"a","initially_deferred":false,"referenced_columns":["company_id","customer_id","id"]},
    {"name":"powers_of_attorney_company_customer_customer_site_rel_fkey","type":"f","table":"powers_of_attorney","columns":["company_id","customer_id","customer_site_id"],"validated":true,"deferrable":true,"match_type":"s","references":"customer_sites","delete_action":"a","update_action":"a","initially_deferred":false,"referenced_columns":["company_id","customer_id","id"]},
    {"name":"powers_of_attorney_company_customer_site_rel_fkey","type":"f","table":"powers_of_attorney","columns":["company_id","customer_id","site_id"],"validated":true,"deferrable":true,"match_type":"s","references":"customer_sites","delete_action":"a","update_action":"a","initially_deferred":false,"referenced_columns":["company_id","customer_id","id"]},
    {"name":"supplier_switch_requests_company_customer_customer_site_rel_fke","type":"f","table":"supplier_switch_requests","columns":["company_id","customer_id","customer_site_id"],"validated":true,"deferrable":true,"match_type":"s","references":"customer_sites","delete_action":"a","update_action":"a","initially_deferred":false,"referenced_columns":["company_id","customer_id","id"]},
    {"name":"supplier_switch_requests_company_customer_site_rel_fkey","type":"f","table":"supplier_switch_requests","columns":["company_id","customer_id","site_id"],"validated":true,"deferrable":true,"match_type":"s","references":"customer_sites","delete_action":"a","update_action":"a","initially_deferred":false,"referenced_columns":["company_id","customer_id","id"]}
  ]
$fks$::jsonb;
  expected jsonb;
  actual jsonb;
  procedure_oid oid;
  role_name text;
  target_version text;
  guard_tables constant text[] := array['customer_case_attachments','customer_case_events','customer_cases','customer_contacts','customer_events','customer_portal_accounts','customer_portal_claims','customer_portal_completions','customer_portal_events','customer_portal_identities','customer_portal_requests','customer_portal_write_idempotency','tenant_portal_customer_links'];
begin
  -- Three replacement/new procedures plus unchanged signed-contract protection.
  -- Exact source bodies include comments/whitespace from the frozen SQL file.
  for expected in select value from jsonb_array_elements($functions$
[
  {
    "signature": "public.gridex_customer_contact_change_v1(uuid,uuid,text,uuid,uuid,text,text,timestamptz,jsonb,jsonb,text)",
    "name": "gridex_customer_contact_change_v1",
    "source_md5": "83f9c57db3eff44e1dbb6481ebeaf9f6",
    "returns": "jsonb",
    "security_definer": false,
    "search_path": [
      "search_path=\"\""
    ],
    "volatility": "v",
    "identity_arguments": "p_company_id uuid, p_customer_id uuid, p_actor_kind text, p_actor_user_id uuid, p_api_client_id uuid, p_portal_identity_id text, p_channel text, p_expected_updated_at timestamp with time zone, p_customer_patch jsonb, p_contact_patch jsonb, p_idempotency_key text",
    "acl": [
      {
        "grantee": "postgres",
        "grantor": "postgres",
        "grantable": false,
        "privilege": "EXECUTE"
      },
      {
        "grantee": "service_role",
        "grantor": "postgres",
        "grantable": false,
        "privilege": "EXECUTE"
      }
    ]
  },
  {
    "signature": "public.gridex_lock_signed_customer_contract()",
    "name": "gridex_lock_signed_customer_contract",
    "source_md5": "e37e13a157f91f401e526b53d5eefdc1",
    "returns": "trigger",
    "security_definer": false,
    "search_path": [
      "search_path=public, pg_catalog, pg_temp"
    ],
    "volatility": "v",
    "identity_arguments": "",
    "acl": [
      {
        "grantee": "PUBLIC",
        "grantor": "postgres",
        "grantable": false,
        "privilege": "EXECUTE"
      },
      {
        "grantee": "anon",
        "grantor": "postgres",
        "grantable": false,
        "privilege": "EXECUTE"
      },
      {
        "grantee": "authenticated",
        "grantor": "postgres",
        "grantable": false,
        "privilege": "EXECUTE"
      },
      {
        "grantee": "postgres",
        "grantor": "postgres",
        "grantable": false,
        "privilege": "EXECUTE"
      },
      {
        "grantee": "service_role",
        "grantor": "postgres",
        "grantable": false,
        "privilege": "EXECUTE"
      }
    ]
  },
  {
    "signature": "public.gridex_merge_customers_v1(uuid,uuid,uuid[],uuid,text)",
    "name": "gridex_merge_customers_v1",
    "source_md5": "e8413db921fcfe7f72b5c12d76a97bb4",
    "returns": "jsonb",
    "security_definer": true,
    "search_path": [
      "search_path=public, extensions, pg_catalog, pg_temp"
    ],
    "volatility": "v",
    "identity_arguments": "p_company_id uuid, p_primary_customer_id uuid, p_source_customer_ids uuid[], p_actor_user_id uuid, p_reason text",
    "acl": [
      {
        "grantee": "postgres",
        "grantor": "postgres",
        "grantable": false,
        "privilege": "EXECUTE"
      },
      {
        "grantee": "service_role",
        "grantor": "postgres",
        "grantable": false,
        "privilege": "EXECUTE"
      }
    ]
  },
  {
    "signature": "public.gridex_guard_merged_portal_customer_write()",
    "name": "gridex_guard_merged_portal_customer_write",
    "source_md5": "e22ac569a323f83b7ecfa4d9a19e1b9d",
    "returns": "trigger",
    "security_definer": true,
    "search_path": [
      "search_path=public, extensions, pg_catalog, pg_temp"
    ],
    "volatility": "v",
    "identity_arguments": "",
    "acl": [
      {
        "grantee": "postgres",
        "grantor": "postgres",
        "grantable": false,
        "privilege": "EXECUTE"
      },
      {
        "grantee": "service_role",
        "grantor": "postgres",
        "grantable": false,
        "privilege": "EXECUTE"
      }
    ]
  }
]
$functions$::jsonb) loop
    procedure_oid:=to_regprocedure(expected->>'signature');
    if procedure_oid is null then
      raise exception 'OPS lifecycle procedure missing: %',expected->>'signature';
    end if;
    select jsonb_build_object(
      'name',p.proname,'source_md5',md5(p.prosrc),
      'returns',pg_get_function_result(p.oid),'security_definer',p.prosecdef,
      'search_path',p.proconfig,'volatility',p.provolatile,
      'identity_arguments',pg_get_function_identity_arguments(p.oid),
      'acl',(select jsonb_agg(jsonb_build_object(
        'grantee',case when a.grantee=0 then 'PUBLIC' else r.rolname end,
        'grantor',o.rolname,'privilege',a.privilege_type,'grantable',a.is_grantable)
        order by case when a.grantee=0 then 'PUBLIC' else r.rolname end collate "C",
          o.rolname collate "C",a.privilege_type)
        from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        left join pg_roles r on r.oid=a.grantee left join pg_roles o on o.oid=a.grantor))
      into actual from pg_proc p where p.oid=procedure_oid;
    if actual is distinct from expected-'signature' then
      raise exception 'OPS lifecycle procedure body/contract/ACL changed: %; actual %',
        expected->>'signature',actual;
    end if;
    if expected->>'name'<>'gridex_lock_signed_customer_contract' then
      foreach role_name in array array['anon','authenticated'] loop
        if has_function_privilege(role_name,procedure_oid,'EXECUTE') then
          raise exception 'Browser role % can invoke %',role_name,expected->>'signature';
        end if;
      end loop;
      if not has_function_privilege('service_role',procedure_oid,'EXECUTE') then
        raise exception 'Service EXECUTE missing: %',expected->>'signature';
      end if;
    end if;
  end loop;

  -- Same FK relations, ordered columns, reference targets and actions as live
  -- before application. Only deferrable=false -> true is an intended change.
  select jsonb_agg(jsonb_build_object(
    'table',c.conrelid::regclass::text,'name',c.conname,'type',c.contype,
    'references',c.confrelid::regclass::text,
    'columns',(select jsonb_agg(a.attname order by u.position)
      from unnest(c.conkey) with ordinality u(attnum,position)
      join pg_attribute a on a.attrelid=c.conrelid and a.attnum=u.attnum),
    'referenced_columns',(select jsonb_agg(a.attname order by u.position)
      from unnest(c.confkey) with ordinality u(attnum,position)
      join pg_attribute a on a.attrelid=c.confrelid and a.attnum=u.attnum),
    'update_action',c.confupdtype,'delete_action',c.confdeltype,'match_type',c.confmatchtype,
    'validated',c.convalidated,'deferrable',c.condeferrable,'initially_deferred',c.condeferred)
    order by c.conname) into actual
  from pg_constraint c join pg_namespace n on n.oid=c.connamespace
  where n.nspname='public' and c.conname in(
    select value->>'name' from jsonb_array_elements(expected_fks));
  if actual is distinct from expected_fks then
    raise exception 'OPS lifecycle ownership FK topology/validation/deferral mismatch';
  end if;

  if (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and (t.tgname='guard_merged_portal_customer_write'
        or t.tgfoid='public.gridex_guard_merged_portal_customer_write()'::regprocedure))<>13 then
    raise exception 'Expected exactly 13 merged-customer guard trigger bindings';
  end if;
  foreach role_name in array guard_tables loop
    if not exists(select 1 from pg_trigger t where t.tgrelid=to_regclass('public.'||role_name)
      and t.tgname='guard_merged_portal_customer_write'
      and t.tgfoid='public.gridex_guard_merged_portal_customer_write()'::regprocedure
      and t.tgtype=23 and t.tgenabled='O' and not t.tgisinternal
      and t.tgconstraint=0 and t.tgqual is null and t.tgnargs=0
      and (select array_agg(a.attname::text order by u.position)
        from unnest(t.tgattr::smallint[]) with ordinality u(attnum,position)
        join pg_attribute a on a.attrelid=t.tgrelid and a.attnum=u.attnum)
        =array['company_id','customer_id']::text[]) then
      raise exception 'Merged-customer BEFORE INSERT/owner UPDATE guard mismatch: %',role_name;
    end if;
  end loop;

  select jsonb_agg(jsonb_build_object(
    'table',t.tgrelid::regclass::text,'name',t.tgname,
    'function',t.tgfoid::regprocedure::text,'type',t.tgtype,'enabled',t.tgenabled,
    'internal',t.tgisinternal,
    'columns',(select jsonb_agg(a.attname order by u.position)
      from unnest(t.tgattr::smallint[]) with ordinality u(attnum,position)
      join pg_attribute a on a.attrelid=t.tgrelid and a.attnum=u.attnum),
    'definition',pg_get_triggerdef(t.oid)) order by t.tgrelid::regclass::text,t.tgname)
    into actual from pg_trigger t where not t.tgisinternal
    and t.tgfoid='public.gridex_lock_signed_customer_contract()'::regprocedure;
  if actual is distinct from $signed_triggers$
[
  {
    "name": "customer_contracts_lock_signed",
    "type": 27,
    "table": "customer_contracts",
    "columns": null,
    "enabled": "O",
    "function": "gridex_lock_signed_customer_contract()",
    "internal": false,
    "definition": "CREATE TRIGGER customer_contracts_lock_signed BEFORE DELETE OR UPDATE ON public.customer_contracts FOR EACH ROW EXECUTE FUNCTION gridex_lock_signed_customer_contract()"
  }
]
$signed_triggers$::jsonb then
    raise exception 'Existing signed-contract immutable trigger binding changed';
  end if;

  if (select count(*) from supabase_migrations.schema_migrations
      where name='customer_merge_portal_lifecycle')<>1 then
    raise exception 'Expected one customer_merge_portal_lifecycle ledger entry, with no duplicate';
  end if;
  select version into strict target_version from supabase_migrations.schema_migrations
    where name='customer_merge_portal_lifecycle';
  if target_version !~ '^[0-9]{14}$' then
    raise exception 'Unexpected lifecycle ledger version: %',target_version;
  end if;
  if exists(select 1 from supabase_migrations.schema_migrations
      where version='20261002230000' and name is distinct from 'customer_merge_portal_lifecycle') then
    raise exception 'Repository 230000 ledger version collides with another migration name';
  end if;
end
$assert$;

select jsonb_build_object(
  'result','OPS lifecycle catalog assertions passed',
  'migration','customer_merge_portal_lifecycle',
  'observed_version',(select version from supabase_migrations.schema_migrations
    where name='customer_merge_portal_lifecycle'),
  'ledger_count',(select count(*) from supabase_migrations.schema_migrations),
  'procedure_count',3,'ownership_fk_count',14,'guard_trigger_count',13,
  'signed_protection','unchanged') as ops_customer_merge_post_apply;
