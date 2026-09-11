#!/usr/bin/env python3
"""Pinned P/A/B/C/W construction only; no staged-loop insertion or test authority.

All native ownership, fresh clone lifecycle and characterizing readers live in
selftest support. This module never adopts a handle or imports a selftest.
"""
from dataclasses import dataclass
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT/'scripts'/filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


replay = load('alignment_replay_loader', 'canonical-auth-provisioning-replay.py').controller()
legacy, repair = replay.load_batch(), replay.load_repair()
BoundaryError = legacy.BoundaryError
model = load('alignment_source_models', 'canonical-user-rbac-customer-alignment-oracles.py')
catalog = load('alignment_catalog_projection', 'canonical-user-rbac-customer-alignment-catalog.py')
SPECS = (
 ('P', '20260911114442_canonical_user_rbac_customer_alignment_prerequisites.sql', '3459cc3fa1afc04aae659a5702eebd22d41f171d42079ab0b14aa0049b951983', None),
 ('A', '20260525_debug_step2_code_schema_alignment.sql', 'e7be5cf935817846dcbe65e64c3b3d558d5e442c9bf7f7af5863f2180f108f04', 87),
 ('B', '20260525_debug_step2b_tenant_scope_and_customer_card_performance.sql', 'afd5c2693cbb1a9f9bd40055cd993189e0118d4871bbb2bfcfb18e4124c2fcb2', 280),
 ('C', '20260526_debug_step1_2c_full_schema_code_alignment.sql', '5a4a2326232ab847d23fed32af2be13a046ee3e3a2dae41dead6f5b4eba16472', 374),
 ('W', '20260911114443_canonical_user_rbac_customer_alignment_boundary.sql', '80f58edf6d9a48baef4999202744040979cd7af1cc0e61b812e52369ad13aff1', None),
)
FUNCTIONS = ('gridex_debug_column_exists(text,text)', 'gridex_get_user_roles(uuid)',
 'gridex_get_user_permission_overrides(uuid)', 'admin_customer_latest_contract_counts(text,text)',
 'ediel_resolve_message_rule(text,text,text,text,date)',
 'ediel_resolve_inbound_message_rules(text,text,text,date)')
DIAGNOSTIC = 'public.gridex_debug_step1_2_schema_alignment_v'
VIEW_SOURCE = '20260526_debug_step1_2f_customer_import_foundation.sql'
CLOCK = '__ALIGNMENT_TRANSACTION_TIME__'


@dataclass(frozen=True, repr=False)
class Source:
    key: str
    path: Path
    sha256: str
    data: bytes


def check(condition, label='ALIGNMENT_ASSERTION_FAILED'):
    if not condition:
        raise BoundaryError(label)


def reviewed_paths():
    return tuple(ROOT/'supabase/migrations'/name for _, name, _, _ in SPECS)


def validate_sources(paths, staging=None):
    check(tuple(paths) == reviewed_paths(), 'ALIGNMENT_SOURCE_ORDER')
    check(staging is None or type(staging) is legacy.StagedSources, 'PRIVATE_STAGE_REQUIRED')
    result = []
    for path, (key, _, pin, lines) in zip(paths, SPECS):
        physical = path if staging is None else staging.hold/path.name
        check(physical.is_file() and not physical.is_symlink() and physical.resolve() == physical
              and physical.stat().st_uid == os.getuid(), 'ALIGNMENT_SOURCE_OWNER')
        data = repair.read_source(path, staging)
        legacy.verify_bytes(data, pin, lines)
        check(not re.search(rb'^\s*(?:commit|rollback|begin\s*;)\s*;', data, re.I | re.M),
              'ALIGNMENT_OUTER_TRANSACTION_REQUIRED')
        result.append(Source(key, path, pin, data))
    return tuple(result)


def literal(value):
    return legacy.literal(value)


def json_sql(value):
    return literal(json.dumps(value, sort_keys=True, separators=(',', ':'))) + '::jsonb'


def ident(value):
    check(re.fullmatch('[a-z_][a-z0-9_]*', value) is not None, 'ALIGNMENT_IDENTIFIER_REQUIRED')
    return '"' + value + '"'


def qualified(value):
    parts = value.split('.')
    check(len(parts) == 2 and parts[0] in ('public', 'auth', 'storage'), 'ALIGNMENT_RELATION_REQUIRED')
    return '.'.join(ident(part) for part in parts)


def columns(shape, table):
    prefix = 'column/public.' + table + '/'
    return {key[len(prefix):]: value for key, value in shape.items() if key.startswith(prefix)}


def index_declarations(sources):
    result = []
    for source in sources[1:4]:
        text = source.data.decode()
        if source.key == 'C':
            statements = re.findall(r"execute '(create index if not exists [^']+)';", text)
        else:
            statements = re.findall(r'create (?:unique )?index if not exists \w+\s+on public\.\w+\s*\([^;]+;', text, re.I)
        check(len(statements) == {'A': 9, 'B': 17, 'C': 31}[source.key], 'ALIGNMENT_DECLARATION_COUNT')
        for sql in statements:
            match = re.match(r'create (?:unique )?index if not exists (\w+)\s+on public\.(\w+)\s*\((.*)\);?$', sql, re.I | re.S)
            check(match is not None, 'ALIGNMENT_INDEX_DECLARATION')
            result.append((source.key, match[1], match[2], match[3], sql.rstrip(';') + ';'))
    check(len({item[1] for item in result}) == 57, 'ALIGNMENT_INDEX_IDENTITIES')
    return tuple(result)


def index_selected(item, shape):
    stage, name, table, keys, _ = item
    present = 'relation/public.' + table in shape
    if stage == 'A':
        return True
    if not present:
        return False
    attrs = columns(shape, table)
    if stage == 'C':
        return True
    required = [key.strip() for key in keys.split(',')[:2]]
    if not all(key in attrs for key in required):
        return False
    if name.startswith('metering_values_customer_company_'):
        return name.endswith('_read_idx') == ('read_at' in attrs)
    return True


def new_index_keys(sources, base, stages=('A', 'B', 'C'), staging=None):
    check(sources == validate_sources(reviewed_paths(), staging), 'ALIGNMENT_SOURCE_BYTES_CHANGED')
    check(stages in (('A', 'B', 'C'), ('B',), ('C',)), 'ALIGNMENT_SOURCE_STAGE_REQUIRED')
    return tuple('alignment_index/public.' + item[1] for item in index_declarations(sources)
                 if item[0] in stages and index_selected(item, base)
                 and 'alignment_index/public.' + item[1] not in base
                 and 'index/public.' + item[1] not in base)


def diagnostic_source(staging=None):
    path = ROOT/'supabase/migrations'/VIEW_SOURCE
    data = repair.read_source(path, staging).decode()
    match = re.search(r'create or replace view public\.gridex_debug_step1_2_schema_alignment_v as\n.*?order by table_name;', data, re.S)
    check(match is not None, 'SELECTED_DIAGNOSTIC_SOURCE_REQUIRED')
    tables = ('companies', 'company_memberships', 'user_roles', 'customers',
              'customer_sites', 'metering_points', 'customer_contracts',
              'customer_import_batches', 'customer_import_rows', 'billing_export_runs',
              'billing_export_run_items', 'ediel_messages', 'ediel_inbound_cases',
              'customer_portal_accounts', 'customer_portal_claims')
    required = re.search(r'\nwith required_tables\(table_name\) as \(\s*values\s*(.*?)\s*\), table_status as \(', match[0], re.S)
    # Bind only the complete VALUES grammar; to_regclass and NOT IN elsewhere
    # in this source-backed view also contain parenthesized string literals.
    rows = r'\s*,\s*'.join(re.escape("('" + table + "')") for table in tables)
    check(required is not None and re.fullmatch(rows, required[1]) is not None,
          'SELECTED_DIAGNOSTIC_SOURCE_REQUIRED')
    return match[0]


def admit_graph(shape, staging=None):
    write = {'public.' + table for table in model.DML_TABLES}
    source = repair.read_source(ROOT/'supabase/migrations/20260519_batch_6d2_runtime_governance_completion.sql', staging).decode()
    body = re.search(r'create or replace function public\.gridex_assert_company_operational_for_write\(\).*?as \$\$(.*?)\$\$;', source, re.S)
    check(body is not None, 'ALIGNMENT_TRIGGER_SOURCE_REQUIRED')
    for key, value in shape.items():
        if key.startswith('event_trigger/'):
            check(value['enabled'] == 'D', 'ALIGNMENT_EVENT_TRIGGER_REJECTED')
        if key.startswith('trigger/') and key.split('/')[1] in write:
            definition = value['definition']
            check(value['enabled'] == 'O' and 'BEFORE INSERT OR UPDATE OF company_id' in definition
                  and 'gridex_assert_company_operational_for_write()' in definition,
                  'ALIGNMENT_UNKNOWN_WRITE_TRIGGER')
            functions = [v for k, v in shape.items() if k.startswith('function/public.gridex_assert_company_operational_for_write(')]
            check(len(functions) == 1 and body[1] in functions[0]['definition'], 'ALIGNMENT_TRIGGER_BODY_MISMATCH')
        if key.startswith('rule/') and key.split('/')[1] in write:
            raise BoundaryError('ALIGNMENT_UNKNOWN_WRITE_RULE')
        if key.startswith('relation/') and key.split('/')[1] in write:
            check(value['kind'] == 'r', 'ALIGNMENT_ORDINARY_TARGET_REQUIRED')
    # Entire actual independently bound catalog covers all FK parents, checks,
    # domains, incoming actions, dependency identities and effective role graph.
    # A controlled fixture may add only explicitly modeled test probes.


def expected_ddl(sources, shape, staging=None):
    """Reviewed source declarations; independent of P/W and complete DML runner."""
    a, b, c = (source.data.decode().splitlines() for source in sources[1:4])
    result = []
    if 'contract_id' not in columns(shape, 'billing_export_run_items'):
        result.append('ALTER TABLE public.billing_export_run_items ADD COLUMN contract_id uuid;')
    result += ['\n'.join(a[6:33]), '\n'.join(b[4:17])]
    result += [item[4] for item in index_declarations(sources) if index_selected(item, shape)]
    # C4..C11 declarations, preserving the real DROP/return-shape transition.
    result.append('\n'.join(c[168:]))
    result.append(diagnostic_source(staging))
    # Independent declarative private ACL policy, deliberately not W bytes.
    for function in FUNCTIONS:
        result.append('REVOKE ALL ON FUNCTION public.' + function + ' FROM PUBLIC;')
    result.append('ALTER VIEW public.gridex_debug_batch2_rbac_v SET (security_invoker=true);')
    result.append('REVOKE ALL ON TABLE public.gridex_debug_batch2_rbac_v FROM PUBLIC;')
    for key, role in shape.items():
        if not key.startswith('database_role/') or key == 'database_role/postgres':
            continue
        name = key.split('/', 1)[1]
        quoted = '"' + name.replace('"', '""') + '"'
        result += ['REVOKE ALL ON FUNCTION public.' + function + ' FROM ' + quoted + ';' for function in FUNCTIONS]
        result.append('REVOKE ALL ON TABLE public.gridex_debug_batch2_rbac_v FROM ' + quoted + ';')
    # Newly recreated C view has no column grants. Exact expected catalog proves it.
    return '\n'.join(result)


def expected_rows(before):
    state, other = {}, []
    for table, row in before:
        if table.startswith('public.'):
            state.setdefault(table[7:], []).append(row)
        else:
            other.append([table, row])
    state = model.copy.deepcopy(state)
    if 'billing_export_run_items' in state:
        for row in state['billing_export_run_items']:
            row.setdefault('contract_id', None)
    state['ediel_tgt_test_data'] = model.apply_a(state.get('ediel_tgt_test_data', []))
    state = model.backfills(model.backfills(state, 'B', CLOCK), 'C', CLOCK)
    return sorted(other + [['public.' + table, row] for table, rows in state.items() for row in rows],
                  key=lambda value: json.dumps(value, sort_keys=True))


def rows_sql():
    return '''CREATE TEMP TABLE alignment_rows(name text,value jsonb) ON COMMIT DROP;
DO $$ DECLARE r record; BEGIN
FOR r IN SELECT n.nspname,c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','auth','storage') AND c.relkind IN ('r','p','S') ORDER BY n.nspname,c.relname LOOP
 IF r.relkind='S' THEN
  EXECUTE format('INSERT INTO alignment_rows SELECT %L,jsonb_build_object(''last_value'',last_value,''log_cnt'',log_cnt,''is_called'',is_called) FROM %I.%I',r.nspname||'.'||r.relname,r.nspname,r.relname);
 ELSE
  EXECUTE format('INSERT INTO alignment_rows SELECT %L,to_jsonb(x) FROM %I.%I x',r.nspname||'.'||r.relname,r.nspname,r.relname);
 END IF;
END LOOP; END $$;'''


def assert_rows(expected_field):
    check(expected_field in ('before_rows', 'after_rows'), 'ALIGNMENT_EXPECTATION_FIELD')
    return rows_sql() + '''
DO $$ BEGIN
 IF EXISTS ((SELECT name,value FROM alignment_rows EXCEPT ALL
 SELECT x->>0,x->1 FROM alignment_reference r CROSS JOIN LATERAL jsonb_array_elements(r.''' + expected_field + ''') x)
 UNION ALL (SELECT x->>0,x->1 FROM alignment_reference r CROSS JOIN LATERAL jsonb_array_elements(r.''' + expected_field + ''') x
 EXCEPT ALL SELECT name,value FROM alignment_rows)) THEN
 RAISE EXCEPTION USING ERRCODE='P0004',MESSAGE='ALIGNMENT_FULL_ROWS_MISMATCH'; END IF;
END $$;
DROP TABLE alignment_rows;'''


def stage_sql(previous, stage):
    check((previous, stage) in (('ADMITTED', 'P'), ('P', 'A'), ('A', 'B'), ('B', 'C')), 'ALIGNMENT_STAGE_ORDER')
    return "DO $$ BEGIN IF (SELECT count(*) FROM alignment_context WHERE stage=" + literal(previous) + ")<>1 THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='ALIGNMENT_STAGE_MISMATCH'; END IF; UPDATE alignment_context SET stage=" + literal(stage) + "; END $$;"


def prelude(sources, before, after_catalog, token, rollback_only=False, staging=None, target_database=None):
    check(re.fullmatch('[0-9a-f]{32}', token) is not None, 'ALIGNMENT_TOKEN_REQUIRED')
    check(type(rollback_only) is bool, 'ALIGNMENT_MODE_REQUIRED')
    check(target_database is None or target_database == replay.DATABASE, 'ALIGNMENT_TARGET_DATABASE_REQUIRED')
    databases = (replay.DATABASE,) if target_database is not None else (
        'gridex_auth_legacy_native', 'gridex_auth_legacy_dirty', 'gridex_auth_legacy_atomic', 'gridex_auth_legacy_lock')
    check(CLOCK not in json.dumps(before), 'ALIGNMENT_CLOCK_COLLISION')
    if not rollback_only:
        model.admit_a([row for table, row in before[1] if table == 'public.ediel_tgt_test_data'])
    body = before[0]['relation/' + DIAGNOSTIC]['definition']
    pins = 'ARRAY[' + ','.join(literal(source.sha256) for source in sources) + ']::text[]'
    result = '''SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='60s';
SET LOCAL search_path=public,extensions,pg_temp;
SELECT pg_advisory_xact_lock(20260910,140053);
CREATE TEMP TABLE alignment_reference(base jsonb,final jsonb,before_rows jsonb,after_rows jsonb,
 hashes text[],token text,diagnostic_definition text,new_indexes jsonb) ON COMMIT DROP;
CREATE TEMP TABLE alignment_context(database_name name,backend integer,txid bigint,hashes text[],token text,stage text) ON COMMIT DROP;
INSERT INTO alignment_reference VALUES (''' + ','.join((json_sql(before[0]), json_sql(after_catalog), json_sql(before[1]),
    "replace(" + literal(json.dumps(expected_rows(before[1]), sort_keys=True)) + "," + literal('"' + CLOCK + '"') + ",to_jsonb(now())::text)::jsonb",
    pins, literal(token), literal(body), json_sql(new_index_keys(sources, before[0], staging=staging)))) + ''');
DO $$ DECLARE r record; BEGIN
 IF current_user<>'postgres' OR current_database() NOT IN (''' + ','.join(literal(name) for name in databases) + ''') THEN
 RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='ALIGNMENT_OWNER_REQUIRED'; END IF;
 FOR r IN SELECT key,value FROM jsonb_each((SELECT base FROM alignment_reference))
 WHERE key LIKE 'relation/%' AND value->>'kind' IN ('r','p') ORDER BY key LOOP
 EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE',substr(r.key,10)::regclass);
 END LOOP;
 LOCK TABLE pg_catalog.pg_proc,pg_catalog.pg_rewrite,pg_catalog.pg_depend,pg_catalog.pg_auth_members IN SHARE ROW EXCLUSIVE MODE;
END $$;
CREATE TEMP TABLE alignment_admission_catalog ON COMMIT DROP AS ''' + catalog.sql(repair) + '''
DO $$ BEGIN IF (SELECT * FROM alignment_admission_catalog) IS DISTINCT FROM (SELECT base FROM alignment_reference) THEN
 RAISE EXCEPTION USING ERRCODE='42804',MESSAGE='ALIGNMENT_CATALOG_MISMATCH'; END IF; END $$;
''' + assert_rows('before_rows')
    if not rollback_only:
        result += '''DO $$ BEGIN IF EXISTS (SELECT 1 FROM public.ediel_tgt_test_data GROUP BY test_suite,role_code,test_case_code HAVING count(*)>1) THEN
 RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='A6_LOSS_REJECTED'; END IF; END $$;'''
    return result + "\nINSERT INTO alignment_context SELECT current_database(),pg_backend_pid(),txid_current(),hashes,token,'ADMITTED' FROM alignment_reference;\n"


def assertions(rollback=False):
    equal = catalog.final_equal_sql('(SELECT base FROM alignment_reference)',
        '(SELECT * FROM alignment_final_catalog)', '(SELECT final FROM alignment_reference)',
        '(SELECT new_indexes FROM alignment_reference)')
    result = '''DO $$ BEGIN IF (SELECT count(*) FROM alignment_context WHERE stage='W' AND backend=pg_backend_pid() AND txid=txid_current())<>1 THEN
 RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='ALIGNMENT_COMPLETION_REQUIRED'; END IF; END $$;
CREATE TEMP TABLE alignment_final_catalog ON COMMIT DROP AS ''' + catalog.sql(repair) + '''
SELECT 'ALIGNMENT_PRIVATE_FINAL_CATALOGS'
WHERE NOT ''' + equal + ''';
SELECT jsonb_build_array((SELECT * FROM alignment_final_catalog),(SELECT final FROM alignment_reference))
WHERE NOT ''' + equal + ''';
DO $$ BEGIN IF NOT ''' + equal + ''' THEN
 RAISE EXCEPTION USING ERRCODE='P0004',MESSAGE='ALIGNMENT_FINAL_CATALOG_MISMATCH'; END IF; END $$;
''' + assert_rows('after_rows') + "\nSELECT 'ALIGNMENT_COMPLETE';\n"
    return result + ('ROLLBACK;\n' if rollback else '')


def identities_sql():
    """Database-local identities; never compared across independent databases."""
    return '''SELECT coalesce(jsonb_object_agg(key,oid),'{}') FROM (
 SELECT 'relation/'||n.nspname||'.'||c.relname AS key,c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','auth','storage') AND c.relkind IN ('r','p','v','m','S','i','I','f')
 UNION ALL SELECT 'function/'||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',p.oid
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','auth','storage') AND p.prokind<>'a'
) objects;'''


def identity_assertions():
    return '''CREATE TEMP TABLE alignment_final_identities ON COMMIT DROP AS ''' + identities_sql() + '''
DO $$ DECLARE before jsonb; after jsonb; item record; BEGIN
 SELECT value INTO STRICT before FROM alignment_identity_reference;
 SELECT * INTO STRICT after FROM alignment_final_identities;
 FOR item IN SELECT key,value FROM jsonb_each(before) LOOP
  IF item.key='relation/public.gridex_debug_batch2_rbac_v' OR item.key LIKE 'function/public.gridex_get_user_roles(%' THEN
   IF after->item.key IS NOT DISTINCT FROM item.value THEN
    RAISE EXCEPTION USING ERRCODE='P0004',MESSAGE='ALIGNMENT_SOURCE_DROP_IDENTITY_REQUIRED'; END IF;
  ELSIF after->item.key IS DISTINCT FROM item.value THEN
   RAISE EXCEPTION USING ERRCODE='P0004',MESSAGE='ALIGNMENT_EXISTING_IDENTITY_CHANGED';
  END IF;
 END LOOP;
END $$;'''
