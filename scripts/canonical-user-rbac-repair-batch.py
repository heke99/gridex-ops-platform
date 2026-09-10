#!/usr/bin/env python3
"""Strict unselected R2/E2/S2/W envelope on an existing exact owned handle.

The legacy target is reused unchanged, including its closed database namespace,
private transport and logging. No arbitrary URL, handle adoption or source SQL
callback exists here. Reference construction never executes W.
"""
from dataclasses import dataclass
import importlib.util
import json
from pathlib import Path
import re
import sys
import weakref

ROOT = Path(__file__).resolve().parents[1]
SUPPORT = ROOT/'scripts/sql'
W = '20260910174947_canonical_user_rbac_repair_boundary.sql'
W_SHA256 = '51849cf92903f175c548f2a8e853282e01217a55505a9b096b7635d55ee5bbe1'
SPECS = (
 ('R2', '20260525_debug_batch_2_rbac_tenant_alignment.sql', 'cba0a78a519d84b44585133046c56117bf05674c1834467eb8b78fbc1d79cb7d', 230),
 ('E2', '20260525_debug_batch_2e_verify_dashboard_user_provisioning.sql', 'b1cd650eeb7e923b7fb7c761064e9269fff309d34fe3383d07764149d3abc19f', 85),
 ('S2', '20260526_debug_batch_2_tenant_rbac_server_actions.sql', 'f99af4186539ade7455e7241275339352a23c8572bda7cfd05aba987bac8c727', 141),
)
TARGETS = ('customer_blockers','customer_authorization_documents','customer_documents','customer_contacts',
 'customer_internal_notes','customer_info_requests','customer_info_request_events','authorization_scopes',
 'metering_permissions','power_of_attorney_scopes','customer_lifecycle_events','customer_lifecycle_decisions',
 'customer_cases','grid_owner_data_requests','partner_exports','outbound_dispatch_events','supplier_switch_events')
SEEDS = ('super_admin','company_admin','admin','operations_manager','operations_agent','customer_service_manager',
 'customer_service_agent','pricing_manager','pricing_approver','compliance_manager','sales_manager','partner_manager',
 'finance_readonly','executive_readonly','partner_api_user','customer')
FUNCTIONS = ('gridex_get_user_roles(uuid)', 'gridex_table_has_company_id(text)')
VIEWS = ('gridex_debug_batch2_rbac_v','gridex_debug_batch2_tenant_policy_gaps_v')


def load_legacy():
    name = 'repair_owned_legacy_batch'
    if name not in sys.modules:
        spec = importlib.util.spec_from_file_location(name, ROOT/'scripts/canonical-auth-provisioning-legacy-batch.py')
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
    return sys.modules[name]


legacy = load_legacy()
BoundaryError = legacy.BoundaryError
literal = legacy.literal
REFERENCES = weakref.WeakKeyDictionary()


@dataclass(frozen=True)
class Reference:
    directory: str
    base: dict
    final: dict


def reviewed_paths():
    return tuple(ROOT/'supabase/migrations'/s[1] for s in SPECS)+(ROOT/'supabase/migrations'/W,)


def validate_sources(paths):
    if tuple(paths) != reviewed_paths() or any(p.is_symlink() or p.resolve()!=p for p in paths):
        raise BoundaryError('SOURCE_ORDER_MISMATCH')
    manifests = [json.loads((ROOT/'scripts'/name).read_text())['files'] for name in
                 ('migration-history-manifest.json','migration-history-manifest.additions.json','migration-history-manifest.runtime.additions.json')]
    sources = []
    for index, path in enumerate(paths):
        alias, expected, length = (SPECS[index][0], SPECS[index][2], SPECS[index][3]) if index<3 else ('W',W_SHA256,None)
        pins = [m[path.name] for m in manifests if path.name in m]
        if not pins or any(pin != expected for pin in pins):
            raise BoundaryError('SOURCE_HASH_MISMATCH')
        data = path.read_bytes()
        legacy.verify_bytes(data, expected, length)
        if alias == 'W':
            legacy.check_support(data.decode())
        sources.append(legacy.Source(alias,path,expected,data))
    for part in ('admission','assertions','catalog'):
        sql = (SUPPORT/f'canonical-user-rbac-repair-{part}.sql').read_text()
        legacy.check_support(sql)
        if part=='admission':
            # The accepted preamble validator enforces the shared mutex FIRST.
            legacy.validate_admission(sql.replace('DO $repair$', 'DO $legacy$'))
    return tuple(sources)


def require_owned(target, reference=True):
    if (type(target) is not legacy.OwnedPostgres or not target.active or
        target.name != target._created_name or target.directory is None):
        raise BoundaryError('OWNED_TARGET_REQUIRED')
    if reference and (target not in REFERENCES or REFERENCES[target].directory != target.directory.name):
        raise BoundaryError('OWNED_REFERENCE_REQUIRED')


def source_oracle(sources):
    """Declarations/seeds independently pinned to historical bytes, never W."""
    r2, _, s2 = [source.data.decode() for source in sources[:3]]
    rows = re.findall(r"\('([^']+)', '([^']+)', '([^']+)', '(platform|company)'\)", r2)
    if tuple(row[0] for row in rows) != SEEDS:
        raise BoundaryError('SEED_ORACLE_MISMATCH')
    declarations = []
    for sql,name in ((r2,'gridex_get_user_roles'),(s2,'gridex_table_has_company_id')):
        match = re.search(r'create or replace function public\.'+name+r'\(.*?\$\$;',sql,re.S|re.I)
        if not match: raise BoundaryError('DECLARATION_ORACLE_MISMATCH')
        declarations.append(match.group())
    for sql,name in ((r2,VIEWS[0]),(s2,VIEWS[1])):
        match = re.search(r'create or replace view public\.'+name+r'\s+as\s+.*?;\s*$',sql,re.S|re.I)
        if not match: raise BoundaryError('DECLARATION_ORACLE_MISMATCH')
        declarations.append(match.group())
    return rows, '\n'.join(declarations)


def seed_oracle_sql(sources):
    rows,_ = source_oracle(sources)
    values = ','.join('('+','.join(literal(v) for v in row)+')' for row in rows)
    return '''CREATE TEMP TABLE repair_expected_roles (LIKE public.roles INCLUDING DEFAULTS) ON COMMIT DROP;
INSERT INTO repair_expected_roles(key,name,description,scope,is_system)
SELECT s.*,true FROM (VALUES '''+values+''') s(key,name,description,scope)
WHERE NOT EXISTS (SELECT 1 FROM public.roles r WHERE r.key=s.key);'''


def diagnostic_guard(sources):
    # Source-bound fixed literals remain in memory/private SQL; never receipts.
    sql = sources[1].data.decode()
    params = re.search(r'with\s+params\s+as\s*\((.*?)\)\s*,',sql,re.I|re.S)
    if not params: raise BoundaryError('DIAGNOSTIC_ORACLE_MISMATCH')
    emails = re.findall(r"'([^']+@[^']+)'",params.group(1))
    if len(emails)!=1: raise BoundaryError('DIAGNOSTIC_ORACLE_MISMATCH')
    return "IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email)=lower("+literal(emails[0])+")) THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='DIRTY_DATA'; END IF;"


def catalog_sql():
    return (SUPPORT/'canonical-user-rbac-repair-catalog.sql').read_text()


def catalog_capture(table):
    query = catalog_sql().replace("SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) FROM objects;",
                                "SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) AS catalog FROM objects;")
    return 'CREATE TEMP TABLE '+table+' ON COMMIT DROP AS '+query


def catalog(target,database):
    require_owned(target, False)
    return json.loads(target.sql(database,catalog_sql(),'catalog'))


def stage_sql(previous,current):
    return f'''DO $repair$ BEGIN
IF (SELECT count(*) FROM pg_temp.repair_context WHERE stage={literal(previous)}
 AND txid=txid_current() AND backend=pg_backend_pid() AND database_name=current_database())<>1 THEN
 RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='ENVELOPE_REQUIRED'; END IF;
UPDATE pg_temp.repair_context SET stage={literal(current)};
END $repair$;
SELECT 'REPAIR_STAGE_{current}';'''


def envelope_files(target,paths):
    require_owned(target)
    sources = validate_sources(paths)
    target.verify_logging()
    ref = REFERENCES[target]
    context = '''SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
CREATE TEMP TABLE repair_reference(base jsonb NOT NULL,final jsonb NOT NULL,hashes text[] NOT NULL) ON COMMIT DROP;
INSERT INTO repair_reference VALUES ('''+literal(json.dumps(ref.base))+'::jsonb,'+literal(json.dumps(ref.final))+"::jsonb,ARRAY["+','.join(literal(s.sha256) for s in sources)+']);'
    admission = (SUPPORT/'canonical-user-rbac-repair-admission.sql').read_text()
    admission = admission.replace('-- REPAIR_CATALOG_CAPTURE', catalog_capture('repair_catalog_before'))
    admission = admission.replace('-- REPAIR_SEED_ORACLE',seed_oracle_sql(sources))
    admission = admission.replace('-- REPAIR_DIAGNOSTIC_GUARD',diagnostic_guard(sources))
    files = [target.private('repair-context.sql',context),target.private('repair-admission.sql',admission)]
    previous='admitted'
    for source in sources:
        files.append(target.private('repair-whole-'+source.alias+'.sql',source.data))
        if source.alias!='W':
            files.append(target.private('repair-stage-'+source.alias+'.sql',stage_sql(previous,source.alias)))
        previous=source.alias
    assertions = (SUPPORT/'canonical-user-rbac-repair-assertions.sql').read_text()
    assertions = assertions.replace('-- REPAIR_CATALOG_CAPTURE',catalog_capture('repair_catalog_after'))
    files.append(target.private('repair-assertions.sql',assertions))
    for path in files:
        if not path.name.startswith('repair-whole-'): legacy.check_support(path.read_text())
    return files


def execute(target,database,paths):
    legacy.validate_database(database)
    output = target.run_files(database,envelope_files(target,paths),'whole_batch')
    stages = re.findall(r'^REPAIR_STAGE_(\w+)$',output,re.M)
    if stages!=['R2','E2','S2','COMPLETED']:
        raise BoundaryError('SOURCE_COMPLETION_MISMATCH')
    return {'sources':4,'stages':stages}


def prepare_reference(target):
    """Full accepted prefix, then independently declared safe delta; no W."""
    require_owned(target,False)
    sources = validate_sources(reviewed_paths())
    # Accepted envelope retains its own first43/base/final reference throughout.
    legacy.prepare_reference(target)
    database='gridex_auth_legacy_reference'
    base=catalog(target,database)
    expected_index={'definition':'CREATE INDEX user_roles_user_active_idx ON public.user_roles USING btree (user_id, status, is_active)',
        'valid':True,'ready':True,'unique':False,'primary':False,'exclusion':False,'immediate':True,'nulls_not_distinct':False}
    if base.get('index/public.user_roles_user_active_idx')!=expected_index:
        raise BoundaryError('SOURCE_INDEX_AUTHORITY_MISMATCH')
    for prefix in ('function/public.gridex_get_user_roles(', 'function/public.gridex_table_has_company_id(',
                   'relation/public.gridex_debug_batch2_rbac_v','relation/public.gridex_debug_batch2_tenant_policy_gaps_v'):
        if any(key.startswith(prefix) for key in base):
            raise BoundaryError('FIRST52_DIAGNOSTIC_ABSENCE_MISMATCH')
    # Bind the selected39/41 source bodies in addition to the full portable
    # definition/options/owner/ACL reference. Never run either source's DML again.
    manifest=json.loads((ROOT/'scripts/migration-history-manifest.json').read_text())['files']
    for filename,names in (
      ('20260520_batch_6e_hard_platform_roles_only.sql',('gridex_user_is_platform_admin',)),
      ('20260520_batch_6e_rbac_tenant_stats_whitelabel.sql',('gridex_can_read_company','gridex_can_write_company'))):
        data=(ROOT/'supabase/migrations'/filename).read_bytes()
        legacy.verify_bytes(data,manifest[filename])
        for name in names:
            match=re.search(r'create or replace function public\.'+name+r'\(.*?as \$\$(.*?)\$\$;',data.decode(),re.I|re.S)
            definitions=[v['definition'] for k,v in base.items() if k.startswith('function/public.'+name+'(')]
            if not match or len(definitions)!=1 or match.group(1) not in definitions[0]:
                raise BoundaryError('SELECTED_HELPER_AUTHORITY_MISMATCH')
    # Preserve actual52 as the immutable cloning template for every proof case.
    target.docker(['exec',target.name,'dropdb','-U','postgres','gridex_auth_legacy_template'])
    target.docker(['exec',target.name,'createdb','-U','postgres','-T',database,'gridex_auth_legacy_template'])
    _,declarations = source_oracle(sources)
    oracle = declarations+'\n'
    # Independent expected ACL construction: revoke every non-owner role,
    # including otherwise unanticipated inherited/default privilege paths.
    for name in FUNCTIONS:
        oracle += 'REVOKE ALL ON FUNCTION public.'+name+' FROM PUBLIC;\n'
    for name in VIEWS:
        oracle += 'ALTER VIEW public.'+name+' SET (security_invoker=true);\n'
        oracle += 'REVOKE ALL ON TABLE public.'+name+' FROM PUBLIC;\n'
    oracle += '''DO $$ DECLARE r record; obj text; BEGIN
FOR r IN SELECT rolname FROM pg_roles WHERE rolname<>current_user LOOP
FOREACH obj IN ARRAY ARRAY['gridex_get_user_roles(uuid)','gridex_table_has_company_id(text)'] LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM %I',obj,r.rolname); END LOOP;
FOREACH obj IN ARRAY ARRAY['gridex_debug_batch2_rbac_v','gridex_debug_batch2_tenant_policy_gaps_v'] LOOP
 EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',obj,r.rolname); END LOOP;
END LOOP; END $$;'''
    legacy.check_support(oracle)
    target.sql(database,oracle,'fixture')
    final=catalog(target,database)
    REFERENCES[target]=Reference(target.directory.name,base,final)
    return REFERENCES[target]
