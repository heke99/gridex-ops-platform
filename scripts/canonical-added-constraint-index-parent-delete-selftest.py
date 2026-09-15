#!/usr/bin/env python3
"""Bounded five-table FK/real-trigger qualification on the fixed owned PG17 service.

Parent tables and non-key payload columns are synthetic. All 18 coexisting FKs,
three user triggers and two function bodies are exact source/artifact selections.
No application graph, authentication, final public catalog or schema acceptance
is implied. No URL, SQL, table, artifact or database input is accepted.
"""
import argparse
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
TABLES = ('billing_disputes', 'customer_import_rows', 'customer_sync_events',
          'data_quality_findings', 'document_parse_jobs')
REGISTER = 'quality/audits/PR310_ADDED_CONSTRAINT_INDEX_CONSTRAINTS_2026-09-15.json'
COVERAGE = 'quality/audits/PR310_SCHEMA_ACCEPTANCE_COVERAGE_2026-09-15.json'
COLUMNS = 'quality/audits/PR310_ADDED_RELATION_COLUMN_CATALOG_2026-09-15.json'
BASE = 'scripts/canonical-composite-customer-fk-selftest.py'
GUARD = 'supabase/migrations/20260519_batch_6d2_runtime_governance_completion.sql'
AUDIT = 'supabase/migrations/20260522_batch4e_switch_pdf_audit_rbac_completion.sql'
HARDENING = 'supabase/migrations/20260611190000_launch_linter_hardening_security_definer_rls.sql'
INTENT = 'quality/audits/PR310_ADDED_CONSTRAINT_INDEX_PARENT_DELETE_INTENT_2026-09-15.json'
CANDIDATE = 'scripts/sql/forward-candidates/preserve-retained-customer-history-on-delete.sql'
CANDIDATE_SHA = '00f8a844fc5c72274d697558d57f216acf56388b6d36f6aad6063ca255283734'
PINS = {
    'supabase/schema.sql': 'b46b90d7ff066d71964c9157044ac70b31b47cab114cfcbce5d270751012dd30',
    COLUMNS: 'b46bf6bb763f7ecfa982efdb4fa3a51bb6148a353df4a57ea6ea9ef5b2b75920',
    INTENT: '09349ed1b95aaea0aa60d7e10188e07e15c7998ef524be00ba8955157709f562',
    BASE: 'ca6786f0d9d80a710a5a0f6467ca716b05b237c24d3ea19299da080855891226',
    REGISTER: '7f15c8c45668e38a0ed1fc8e390107bf4382ffdc1b4d9cac5f4c3141c2005899',
    COVERAGE: '64cc257b053c59fb4113b801b96d159cd2b638e644fe2c402e488de2c329c835',
    GUARD: 'b7d9d48b9cd3093b5546b04225f9c6151b0f674d2ae73441d8086f51922de9ab',
    AUDIT: 'e28a7956e18e6704de79b3be29245974faaef5a33aebcec4fa741c7daa06c98d',
    HARDENING: 'b696379a5e1d26bde5fae150d7c51e9d40df029a9dfd605810ad9051b1fb74d1',
}
FUNCTION_MD5 = {'gridex_assert_company_operational_for_write': 'fcdd8e61b45af7096cf2654d767e12a0',
                'gridex_audit_critical_row_change': '0bb25c59cc22963c529f3e7dce21d883'}


def digest(value):
    if not isinstance(value, bytes):
        value = json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()
    return hashlib.sha256(value).hexdigest()


def pinned(path, expected):
    source = ROOT / path
    if source.resolve() != source.absolute() or not source.is_file() or digest(source.read_bytes()) != expected:
        raise ValueError('EXACT_SOURCE_REQUIRED')
    return source.read_text()


pinned(BASE, PINS[BASE])
SPEC = importlib.util.spec_from_file_location('parent_delete_owner', ROOT / BASE)
fixture = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(fixture)
PARENT, COMPANY, OTHER = fixture.PARENT, fixture.COMPANY, fixture.OTHER


def selected_records():
    register = json.loads(pinned(REGISTER, PINS[REGISTER]))
    records = [r for r in register['records'] if r['row']['relname'] in TABLES and r['row']['contype'] == 'f']
    if len(records) != 18:
        raise ValueError('EXACT_EIGHTEEN_FKS_REQUIRED')
    return records


def validate_fk_rows(rows):
    expected = {r['row']['conname']: r['sha256'] for r in selected_records()}
    if len(rows) != 18 or {r['conname']: digest(r) for r in rows} != expected:
        raise ValueError('EXACT_EIGHTEEN_FKS_REQUIRED')


def selection():
    files = {p: pinned(p, h) for p, h in PINS.items()}
    parent_declaration = fixture.exactly_one(r'CREATE TABLE public\.customers \((.*?)\n\);', files['supabase/schema.sql'])
    if not re.search(r'^    company_id uuid,$', parent_declaration, re.M) or not re.search(r'^    id uuid DEFAULT gen_random_uuid\(\) NOT NULL,$', parent_declaration, re.M):
        raise ValueError('EXACT_PARENT_KEY_NULLABILITY_REQUIRED')
    columns = [r for r in json.loads(files[COLUMNS])['records'] if r['identity'][1] in TABLES and r['identity'][2] in ('customer_id','company_id')]
    if len(columns) != 10 or any(digest(r['row']) != r['sha256'] or r['row']['data_type'] != 'uuid' for r in columns):
        raise ValueError('EXACT_TEN_KEY_COLUMN_ROWS_REQUIRED')
    intent = json.loads(files[INTENT])
    def check_evidence(value):
        if isinstance(value, dict):
            if 'path' in value and 'sourceSha256' in value:
                source = pinned(value['path'], value['sourceSha256'])
                if 'line' in value and source.splitlines()[value['line'] - 1] != value['lineText']:
                    raise ValueError('EXACT_INTENT_SOURCE_LINE_REQUIRED')
            for nested in value.values():
                check_evidence(nested)
        elif isinstance(value, list):
            for nested in value:
                check_evidence(nested)
    check_evidence(intent)
    records = selected_records()
    for record in records:
        for source in record['sources']:
            text = pinned(source['path'], source['sourceSha256'])
            if text.splitlines()[source['line'] - 1] != source['lineText']:
                raise ValueError('EXACT_FK_DECLARATION_REQUIRED')
    fks = [r['row'] for r in records]
    validate_fk_rows(fks)
    triggers = []
    for record in json.loads(files[COVERAGE])['records']:
        if record['section'] == 'triggers' and record['identity'][1] in TABLES:
            row = record['expectedRow']
            if digest(row) != record['sha256'] or row['enabled'] != 'O':
                raise ValueError('EXACT_REAL_TRIGGER_REQUIRED')
            for source in record['sourceEvidence']:
                pinned(source['path'], source['sha256'])
            triggers.append(row)
    if len(triggers) != 3:
        raise ValueError('EXACT_THREE_USER_TRIGGERS_REQUIRED')
    functions = [fixture.exactly_one(r'(create or replace function public\.gridex_assert_company_operational_for_write\(\).*?\$\$;)', files[GUARD]),
                 fixture.exactly_one(r'(create or replace function public\.gridex_audit_critical_row_change\(\).*?\$body\$;)', files[AUDIT])]
    # The retained final function rows include the later source-authored
    # search_path configuration. Replay that exact block, not rewritten bodies.
    function_configuration = fixture.exactly_one(
        r'-- Function search_path: every public function.*?\n(do \$\$.*?end \$\$;)', files[HARDENING])
    if [r['row'] for r in intent['foreignKeys']] != fks:
        raise ValueError('EXACT_INTENT_FOREIGN_KEYS_REQUIRED')
    return dict(fks=fks, triggers=triggers, functions=functions, columns=[r['row'] for r in columns],
                functionConfiguration=function_configuration,
                functionRows=[r['row'] for r in intent['functions']],
                candidate=pinned(CANDIDATE, CANDIDATE_SHA))


def repaired_rows(rows):
    result = copy.deepcopy(rows)
    for row in result:
        if row['conname'] == row['relname'] + '_customer_company_fk':
            row['definition'] = row['definition'].split(' ON DELETE ')[0] + ' ON DELETE SET NULL (customer_id)'
    return result


def ordered_fks(rows, table, composite_first):
    selected = [r for r in rows if r['relname'] == table]
    selected.sort(key=lambda r: (r['conname'].endswith('_customer_company_fk') != composite_first, r['conname']))
    return ['ALTER TABLE public.' + table + ' ADD CONSTRAINT ' + r['conname'] + ' ' + r['definition'] + ';' for r in selected]


def state():
    # Complete owned public/auth data plus catalog properties. OIDs deliberately
    # retained here to prove failed statements/repeats did not recreate objects.
    tables = ('companies', 'customers', 'audit_logs', 'invoice_export_items',
              'customer_import_batches', 'document_ai_extractions') + TABLES
    data = {t: json.loads(fixture.sql('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),\'[]\'::jsonb) from public.' + t + ' t;')) for t in tables}
    data['auth.users'] = json.loads(fixture.sql("select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from auth.users t;"))
    data['catalog'] = json.loads(fixture.sql("""select jsonb_build_object(
      'constraints',(select jsonb_agg(jsonb_build_array(oid,conrelid,conname,pg_get_constraintdef(oid),convalidated,
        condeferrable,condeferred,obj_description(oid,'pg_constraint')) order by oid)
        from pg_constraint where connamespace in ('public'::regnamespace,'auth'::regnamespace)),
      'triggers',(select jsonb_agg(jsonb_build_array(t.oid,pg_get_triggerdef(t.oid),tgenabled,tgconstraint) order by t.oid)
        from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace in ('public'::regnamespace,'auth'::regnamespace)),
      'relations',(select jsonb_agg(jsonb_build_array(oid,relname,relkind,relowner,relacl,relrowsecurity,relforcerowsecurity) order by oid)
        from pg_class where relnamespace in ('public'::regnamespace,'auth'::regnamespace)),
      'functions',(select jsonb_agg(jsonb_build_array(oid,pg_get_functiondef(oid),proacl) order by oid)
        from pg_proc where pronamespace='public'::regnamespace),
      'columns',(select jsonb_agg(jsonb_build_array(attrelid,attnum,attname,atttypid,attnotnull,attacl) order by attrelid,attnum)
        from pg_attribute where attrelid in (select oid from pg_class where relnamespace in ('public'::regnamespace,'auth'::regnamespace)) and attnum>0),
      'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by oid),'[]'::jsonb) from pg_policy p));"""))
    return data


def probe(statement, assertion='true', expected=None):
    before = state()
    value = fixture.sql("begin; update public.customers set marker='rollback marker'; " + statement
                        + '\nselect (' + assertion + '); rollback;', expected=expected)
    if expected is None and value != 't':
        raise ValueError('ACTION_EFFECT_NOT_PROVED')
    if state() != before:
        raise ValueError('WHOLE_FIXTURE_ROLLBACK_REQUIRED')


def catalog_rows():
    names = ','.join("'" + t + "'" for t in TABLES)
    return json.loads(fixture.sql("""select jsonb_agg(jsonb_build_object('nspname',n.nspname,'relname',c.relname,
      'conname',k.conname,'contype',k.contype,'definition',pg_get_constraintdef(k.oid,true),'convalidated',k.convalidated)
      order by c.relname,k.conname) from pg_constraint k join pg_class c on c.oid=k.conrelid
      join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and k.contype='f' and c.relname in (""" + names + ');'))


def reset(selected, composite_first, repaired=False):
    fixture.sql('drop schema public cascade; create schema public; drop schema if exists auth cascade; create schema auth;')
    fixture.sql("""create table public.companies(id uuid primary key,status text);
      create table public.customers(id uuid primary key,company_id uuid,marker text default 'parent',unique(id,company_id));
      create table auth.users(id uuid primary key);
      create table public.invoice_export_items(id uuid primary key);
      create table public.customer_import_batches(id uuid primary key);
      create table public.document_ai_extractions(id uuid primary key);
      create table public.audit_logs(company_id uuid,actor_user_id uuid,entity_type text,entity_id text,
        action text,old_values jsonb,new_values jsonb,metadata jsonb);""")
    rows = repaired_rows(selected['fks']) if repaired else selected['fks']
    for table in TABLES:
        columns = {'customer_id', 'company_id'}
        for row in rows:
            if row['relname'] == table:
                columns.update(re.search(r'FOREIGN KEY \(([^)]+)\)', row['definition'])[1].split(', '))
        not_null = {r['attname'] for r in selected['columns'] if r['relname'] == table and not r['is_nullable']}
        declaration = ','.join(name + ' uuid' + (' not null' if name in not_null else '') for name in sorted(columns))
        fixture.sql('create table public.' + table + '(id uuid primary key,marker text default \'retained payload\',' + declaration + ');')
        fixture.sql('\n'.join(ordered_fks(rows, table, composite_first)))
    fixture.sql('\n'.join(selected['functions']))
    fixture.sql(selected['functionConfiguration'])
    fixture.sql('\n'.join(row['definition'] + ';' for row in selected['triggers']))
    if catalog_rows() != rows:
        raise ValueError('NATIVE_EXACT_EIGHTEEN_FKS_REQUIRED')
    actual = json.loads(fixture.sql("select jsonb_object_agg(proname,md5(pg_get_functiondef(oid))) from pg_proc where pronamespace='public'::regnamespace;"))
    if actual != FUNCTION_MD5:
        raise ValueError('NATIVE_REAL_FUNCTION_BODIES_REQUIRED')
    function_rows = json.loads(fixture.sql("""select jsonb_agg(jsonb_build_object('nspname','public','proname',proname,
      'identity_arguments',pg_get_function_identity_arguments(oid),'arguments',pg_get_function_arguments(oid),
      'return_type',pg_get_function_result(oid),'security_definer',prosecdef,'volatility',provolatile,
      'kind',prokind,'body_md5',md5(pg_get_functiondef(oid))) order by proname)
      from pg_proc where pronamespace='public'::regnamespace;"""))
    if function_rows != sorted(selected['functionRows'], key=lambda r:r['proname']):
        raise ValueError('NATIVE_FULL_FUNCTION_ROWS_REQUIRED')
    actual_triggers = json.loads(fixture.sql("""select jsonb_agg(jsonb_build_object('nspname','public','relname',c.relname,
      'tgname',t.tgname,'definition',pg_get_triggerdef(t.oid,true),'enabled',t.tgenabled) order by c.relname,t.tgname)
      from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal and c.relnamespace='public'::regnamespace;"""))
    if actual_triggers != sorted(selected['triggers'], key=lambda r: (r['relname'],r['tgname'])):
        raise ValueError('NATIVE_REAL_TRIGGER_ROWS_REQUIRED')
    for table in TABLES:
        fixture.sql(f"comment on constraint {table}_customer_company_fk on public.{table} is 'retention comment';")
    fixture.sql(f"insert into public.companies values('{COMPANY}','active'),('{OTHER}','active'); insert into public.customers(id,company_id) values('{PARENT}','{COMPANY}');")


def qualify_actions(selected, composite_first, repaired):
    reset(selected, composite_first, repaired)
    receipts = []
    for table in TABLES:
        probe('delete from public.customers;', 'not exists(select 1 from public.customers)')
        fixture.sql(f"insert into public.{table}(id,customer_id,company_id) values('{OTHER}','{PARENT}','{COMPANY}');")
        order = json.loads(fixture.sql(f"""select jsonb_agg(k.conname order by t.tgname)
          from pg_trigger t join pg_constraint k on k.oid=t.tgconstraint
          where t.tgrelid='public.customers'::regclass and k.conrelid='public.{table}'::regclass
            and (t.tgtype & 8)=8;"""))
        expected_order = [table + '_customer_company_fk']
        if table != 'customer_sync_events':
            expected_order.insert(1 if composite_first else 0, table + '_customer_id_fkey')
        if order != expected_order:
            raise ValueError('MEASURED_RI_TRIGGER_ORDER_REQUIRED')
        probe(f"insert into public.{table}(id,customer_id,company_id) values('{COMPANY}','{OTHER}','{COMPANY}');", expected='23503')
        probe(f"insert into public.{table}(id,customer_id,company_id) values('{COMPANY}','{PARENT}','{OTHER}');", expected='23503')
        retained = repaired or not composite_first or table == 'customer_sync_events'
        tenant = COMPANY if repaired or table != 'customer_sync_events' else None
        assertion = (f"(select count(*)=1 and bool_and(customer_id is null and company_id "
                     + (f"= '{tenant}'" if tenant else 'is null') + f" and marker='retained payload') from public.{table})") if retained else f'not exists(select 1 from public.{table})'
        if table == 'customer_import_rows':
            op = 'UPDATE' if retained else 'DELETE'
            assertion += " and exists(select 1 from public.audit_logs where metadata->>'operation'='" + op + "' and old_values->>'customer_id'='" + PARENT + "')"
        probe('delete from public.customers;', 'not exists(select 1 from public.customers) and ' + assertion)
        # Operational guard participates in the real RI UPDATE; DELETE does not
        # call a BEFORE INSERT/UPDATE guard. Sync's old NULL-company branch skips it.
        guarded = table in ('customer_import_rows', 'customer_sync_events') and retained and tenant is not None
        probe("update public.companies set status='paused'; delete from public.customers;",
              'not exists(select 1 from public.customers) and ' + assertion,
              expected='P0001' if guarded else None)
        if table in ('customer_sync_events', 'data_quality_findings'):
            probe(f"insert into public.{table}(id,customer_id,company_id) values('{COMPANY}',null,null);",
                  f"exists(select 1 from public.{table} where id='{COMPANY}' and company_id is null)")
        receipts.append(dict(table=table, compositeCreatedFirst=composite_first, repaired=repaired,
                             parentDelete='RETAIN' if retained else 'CASCADE', knownTenantPreserved=retained and tenant is not None,
                             measuredDeleteTriggerOrder=order,
                             pausedTenantDeleteSqlstate='P0001' if guarded else None, rollbackVerified=True))
        fixture.sql(f'delete from public.{table}; delete from public.audit_logs;')
    return receipts


def verify_candidate_delta(before, after):
    names = {t + '_customer_company_fk' for t in TABLES}
    expected = copy.deepcopy(before)
    def normalize(snapshot, repair):
        catalog = snapshot['catalog']
        replaced_ids = {r[0] for r in catalog['constraints'] if r[2] in names}
        normalized = []
        for raw in catalog['constraints']:
            row = raw[:]
            if row[2] in names:
                row[0] = 0
                if repair:
                    row[3] = row[3].split(' ON DELETE ')[0] + ' ON DELETE SET NULL (customer_id)'
            normalized.append(row)
        catalog['constraints'] = sorted(normalized, key=lambda r:(r[1],r[2]))
        catalog['triggers'] = [r for r in catalog['triggers'] if r[3] not in replaced_ids]
        return snapshot
    if normalize(expected, True) != normalize(copy.deepcopy(after), False):
        raise ValueError('ONLY_FIVE_COMPOSITE_DELETE_ACTIONS_MAY_CHANGE')


def verify_forward_postcondition(expected):
    from canonical_native_forward_runtime import assertion
    if fixture.sql('select ('+assertion(7)+');') != ('t' if expected else 'f'):
        raise ValueError('SEVENTH_FORWARD_POSTCONDITION_REQUIRED')


def qualify_candidate(selected):
    reset(selected, False)
    verify_forward_postcondition(False)
    # Retained unrelated rows and comments make an unexpected DML/catalog change
    # observable. Sync also retains its intentionally nullable legacy record.
    for table in TABLES:
        fixture.sql(f"insert into public.{table}(id,customer_id,company_id) values('{OTHER}','{PARENT}','{COMPANY}');")
    fixture.sql(f"insert into public.customer_sync_events(id,customer_id,company_id) values('{COMPANY}',null,null);")
    fixture.sql(f"insert into public.data_quality_findings(id,customer_id,company_id) values('{COMPANY}',null,null);")
    before = state()
    fixture.sql(selected['candidate'])
    after = state()
    verify_candidate_delta(before, after)
    if catalog_rows() != repaired_rows(selected['fks']):
        raise ValueError('FIVE_NATIVE_FINAL_ROWS_REQUIRED')
    verify_forward_postcondition(True)
    fixture.sql(selected['candidate'])
    if state() != after:
        raise ValueError('EXACT_REPEAT_STATE_REQUIRED')
    for table in TABLES:
        probe(f"update public.{table} set customer_id='{OTHER}' where id='{OTHER}';", expected='23503')
        probe(f"update public.{table} set company_id='{OTHER}' where id='{OTHER}';", expected='23503')
    predicates = [f"exists(select 1 from public.{t} where id='{OTHER}' and customer_id is null and company_id='{COMPANY}' and marker='retained payload')" for t in TABLES]
    predicates += [f"exists(select 1 from public.customer_sync_events where id='{COMPANY}' and customer_id is null and company_id is null)",
                   f"exists(select 1 from public.data_quality_findings where id='{COMPANY}' and customer_id is null and company_id is null)",
                   "exists(select 1 from public.audit_logs where metadata->>'operation'='UPDATE' and entity_type='customer_import_rows')",
                   'not exists(select 1 from public.customers)']
    probe('delete from public.customers;', ' and '.join(predicates))
    failures = {
        'missing_last': 'alter table public.document_parse_jobs drop constraint document_parse_jobs_customer_company_fk;',
        'wrong_delete': 'alter table public.document_parse_jobs drop constraint document_parse_jobs_customer_company_fk; alter table public.document_parse_jobs add constraint document_parse_jobs_customer_company_fk foreign key(customer_id,company_id) references public.customers(id,company_id) on update cascade on delete restrict;',
        'unvalidated': 'alter table public.document_parse_jobs drop constraint document_parse_jobs_customer_company_fk; alter table public.document_parse_jobs add constraint document_parse_jobs_customer_company_fk foreign key(customer_id,company_id) references public.customers(id,company_id) on update cascade on delete cascade not valid;',
        'nonnull_customer': 'alter table public.document_parse_jobs alter column customer_id set not null;',
        'nonnull_parent_company': 'alter table public.customers alter column company_id set not null;',
    }
    for mutation in failures.values():
        reset(selected, False)
        fixture.sql(mutation)
        before = state()
        fixture.sql(selected['candidate'], expected='55000')
        if state() != before:
            raise ValueError('UNKNOWN_SHAPE_MUST_NOT_CHANGE_STATE')
    reset(selected, False)
    before = state()
    injected = selected['candidate'].removesuffix('commit;\n') + "do $$begin raise exception 'rollback control' using errcode='P0001'; end$$; commit;"
    fixture.sql(injected, expected='P0001')
    if state() != before:
        raise ValueError('POST_DDL_ATOMIC_ROLLBACK_REQUIRED')
    return dict(exactFiveConstraintDeltaVerified=True, repeatVerified=True,
                missingLastAndUnknownShapeRejected=True, postDdlRollbackVerified=True,
                simultaneousParentDeleteRetainsFiveRows=True, preexistingNullJournalPreserved=True)


def execute(selected):
    if fixture.sql("select current_database()='gridex_auth_test' and current_user='postgres' and current_setting('server_version_num')::int/10000=17", admin=True) != 't':
        raise ValueError('FIXED_LOCAL_PG17_REQUIRED')
    if fixture.sql(f"select count(*) from pg_database where datname='{fixture.DATABASE}'", admin=True) != '0':
        raise ValueError('PREEXISTING_DATABASE_REFUSED')
    receipts = []
    with fixture.owned_database():
        for repaired in (False, True):
            for composite_first in (False, True):
                receipts.extend(qualify_actions(selected, composite_first, repaired))
        candidate_controls = qualify_candidate(selected)
    return dict(scope='LIMITED_FIVE_PARENT_DELETE_FK_AND_REAL_TRIGGER_FIXTURE', foreignKeys=18,
                realUserTriggers=3, realFunctionBodies=2, cases=receipts, cleanupVerified=True,
                fullApplicationGraphVerified=False, actualPublicCatalogVerified=False,
                candidateMigrationExecuted=True, candidateSha256=CANDIDATE_SHA,
                candidateControls=candidate_controls, schemaAccepted=False, productionModified=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--selection-only', action='store_true')
    args = parser.parse_args()
    try:
        selected = selection()
        result = dict(scope='SOURCE_SELECTION_ONLY', foreignKeys=18, realUserTriggers=3,
                      realFunctionBodies=2, nativeSqlExecuted=False) if args.selection_only else execute(selected)
        print(json.dumps(result, sort_keys=True))
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        reason = str(error) if isinstance(error, ValueError) and re.fullmatch('[A-Z_]+', str(error)) else 'QUALIFICATION_FAILED'
        print('FAIL ' + reason)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
