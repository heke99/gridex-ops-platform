#!/usr/bin/env python3
"""Read-only final-failure evidence around the unchanged ordinary owned shell.

Never accepts schema, source privacy, migration ledger or generated types. The
original terminal handler ALWAYS runs, even when evidence collection fails.
No source/body/default/row/exception contents are printed or uploaded.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
PINS = {
    'supabase/schema.sql': 'b46b90d7ff066d71964c9157044ac70b31b47cab114cfcbce5d270751012dd30',
    'scripts/gridex-aud-003-schema-fingerprint.sql': '7c861698fe8d3034805ca0599a6679fe0eb8543679a00058fd1e242a8ea6fa28',
}
TABLES = ('companies', 'price_plans', 'price_plan_versions', 'contract_products',
          'contract_product_versions', 'contract_price_options', 'contract_price_option_area_prices',
          'portfolios', 'portfolio_monthly_settlements', 'canonical_migration_manifest',
          'integration_api_clients', 'website_customer_applications', 'ediel_message_intents')
FUNCTIONS = ('gridex_contract_platform_readiness', 'gridex_contract_platform_readiness_internal_v1')


def sha(data):
    return hashlib.sha256(data.encode() if isinstance(data, str) else data).hexdigest()


def pinned_inputs():
    output = []
    for relative, expected in PINS.items():
        path = ROOT/relative
        if path.is_symlink() or not path.is_file() or path.resolve() != path:
            raise ValueError('DIAGNOSTIC_SOURCE_CHANGED')
        raw = path.read_bytes()
        if sha(raw) != expected:
            raise ValueError('DIAGNOSTIC_SOURCE_CHANGED')
        output.append(raw.decode())
    return tuple(output)


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r'[a-z_][a-z0-9_]{0,127}', value):
        raise ValueError('DIAGNOSTIC_IDENTIFIER_REJECTED')
    return value


def function_body_hash(definition):
    match = re.search(r'\bAS (\$[A-Za-z_0-9]*\$)([\s\S]*?)\1', definition)
    if match is None:
        raise ValueError('SNAPSHOT_FUNCTION_BODY_REQUIRED')
    return sha(match[2])


def type_key(declaration):
    declaration = declaration.strip()
    mapping = {'uuid':'uuid', 'text':'text', 'jsonb':'jsonb', 'json':'json',
               'boolean':'bool', 'integer':'int4', 'bigint':'int8', 'smallint':'int2',
               'date':'date', 'timestamp with time zone':'timestamptz',
               'timestamp without time zone':'timestamp', 'numeric':'numeric',
               'double precision':'float8', 'real':'float4', 'bytea':'bytea'}
    is_array = declaration.endswith('[]')
    base = declaration[:-2] if is_array else declaration
    base = re.sub(r'\([0-9, ]+\)$', '', base)
    if base.startswith('character varying'):
        result = 'varchar'
    elif base in mapping:
        result = mapping[base]
    else:
        raise ValueError('SNAPSHOT_COLUMN_TYPE_UNCLASSIFIED')
    return ('_' if is_array else '')+result


def snapshot_projection(text):
    """Strict pg_dump-format projection; not a replacement schema fingerprint.

    Comparison covers column presence/order/type/nullability, constraint names
    and function bodies. It deliberately does NOT certify defaults, constraint
    semantics, RLS, ACLs, indexes, physical dropped-column positions or ledger.
    """
    tables = {}
    for name in TABLES:
        matches = list(re.finditer(r'^CREATE TABLE public\.'+name+r' \(\n(.*?)\n\);', text, re.S|re.M))
        if len(matches) != 1:
            raise ValueError('SNAPSHOT_TABLE_REQUIRED')
        columns = []
        for line in matches[0][1].splitlines():
            if line.lstrip().startswith('CONSTRAINT '):
                continue
            found = re.fullmatch(r'    ([a-z_][a-z0-9_]*) (.+),?', line)
            if found is None:
                raise ValueError('SNAPSHOT_COLUMN_REQUIRED')
            field, declaration = found.groups()
            datatype = re.split(r'\s+(?:DEFAULT|GENERATED|NOT NULL|COLLATE|CONSTRAINT)\b', declaration, maxsplit=1)[0].rstrip(',')
            columns.append({'name':field, 'udt':type_key(datatype),
                            'nullable':not bool(re.search(r'\bNOT NULL\b', declaration))})
        if not columns or len({c['name'] for c in columns}) != len(columns):
            raise ValueError('SNAPSHOT_COLUMN_REQUIRED')
        constraints = re.findall(r'\bCONSTRAINT ([a-z_][a-z0-9_]*)\b', matches[0][1])
        constraints += re.findall(r'^ALTER TABLE (?:ONLY )?public\.'+name+r'\n\s+ADD CONSTRAINT ([a-z_][a-z0-9_]*)\b', text, re.M)
        if len(constraints) != len(set(constraints)):
            raise ValueError('SNAPSHOT_CONSTRAINT_DUPLICATE')
        tables[name] = {'columns':columns, 'constraints':sorted(constraints)}
    functions = {}
    for name in FUNCTIONS:
        matches = list(re.finditer(r'^CREATE FUNCTION public\.'+name+r'\(', text, re.M))
        if len(matches) != 1:
            raise ValueError('SNAPSHOT_FUNCTION_REQUIRED')
        start = matches[0].start(); end = text.find('\n\n--', start)
        if end < 0:
            raise ValueError('SNAPSHOT_FUNCTION_END_REQUIRED')
        definition = text[start:end]
        functions[name] = {'bodySha256':function_body_hash(definition),
                           'securityDefiner':'SECURITY DEFINER' in definition.split('AS $',1)[0]}
    return {'tables':tables, 'functions':functions}


def compare_projection(expected, actual):
    if not isinstance(actual, dict) or set(actual) != {'columns','constraints','functions'}:
        raise ValueError('CATALOG_PROJECTION_REQUIRED')
    changes = []
    for table in TABLES:
        rows = [r for r in actual['columns'] if r.get('table_name') == table]
        rows.sort(key=lambda r:r['ordinal_position'])
        wanted = expected['tables'][table]['columns']
        existing = {identifier(r['column_name']):r for r in rows}
        names = [c['name'] for c in wanted]
        missing = [n for n in names if n not in existing]
        added = [identifier(r['column_name']) for r in rows if r['column_name'] not in names]
        fields = []
        for c in wanted:
            if c['name'] not in existing:
                continue
            row = existing[c['name']]
            different = []
            if c['udt'] != row['udt_name']:
                different.append('type')
            if c['nullable'] != (row['is_nullable'] == 'YES'):
                different.append('nullability')
            if different:
                fields.append({'column':c['name'], 'different':different})
        constraints = sorted(identifier(r['conname']) for r in actual['constraints'] if r.get('table_name') == table)
        original_constraints = expected['tables'][table]['constraints']
        order_equal = names == [r['column_name'] for r in rows]
        if missing or added or fields or not order_equal or constraints != original_constraints:
            changes.append({'table':table,'missingColumns':missing,'additionalColumns':added,
                            'columnDifferences':fields,'columnOrderEqual':order_equal,
                            'missingConstraints':sorted(set(original_constraints)-set(constraints)),
                            'additionalConstraints':sorted(set(constraints)-set(original_constraints))})
    functions = []
    for name in FUNCTIONS:
        rows = [r for r in actual['functions'] if r.get('proname') == name]
        if len(rows) != 1:
            functions.append({'function':name,'overloadCount':len(rows),'matchesSnapshot':False})
            continue
        row = rows[0]
        body = function_body_hash(row['definition'])
        functions.append({'function':name,'bodyMatchesSnapshot':body == expected['functions'][name]['bodySha256'],
                          'bodySha256':body,
                          'securityDefinerMatchesSnapshot':row['prosecdef'] == expected['functions'][name]['securityDefiner']})
    return {'stage':'final_schema_projection','schemaAccepted':False,
            'scope':'PINNED_SNAPSHOT_LIMITED_PROJECTION_ONLY',
            'snapshotSha256':PINS['supabase/schema.sql'],
            'tableDifferences':changes,'functions':functions,
            'defaultsConstraintSemanticsRlsAclIndexesAndLedgerVerified':False}


def private_census(directory, values, records, original_hashes):
    """Read privately. Report only safe file identities, counts and hashes."""
    if not values or any(type(v) is not bytes or not v for v in values):
        raise ValueError('PROTECTED_MARKERS_REQUIRED')
    matches = []
    for path in sorted(directory.rglob('*')):
        if path.is_symlink():
            raise ValueError('DIAGNOSTIC_SYMLINK_REJECTED')
        if not path.is_file():
            continue
        raw = path.read_bytes()
        count = sum(v in raw for v in values)
        if count:
            safe = re.fullmatch(r'(?:fixture-[0-9a-f]{16}|replay-source-[0-9]{1,3}|prefix-[0-9]{1,3}|repair-whole-[A-Z][0-9]?|dedupe-whole-H2)\.sql', path.name)
            matches.append({'artifact':path.name if safe else 'UNCLASSIFIED_PRIVATE_ARTIFACT',
                            'sha256':sha(raw),'markerCount':count,
                            'recordedWholeInputName':path.name in records,
                            'exactOriginal':original_hashes.get(sha(raw))})
    return {'stage':'final_private_artifact_census','matchingArtifactCount':len(matches),
            'artifacts':matches,'privacyAccepted':False}


def collect(controller, handle):
    # Called only at the actual full-shell post-child failure, before disposal.
    controller.load_repair().require_owned(handle, reference=True)
    controller.load_dedupe().require_live(handle)
    snapshot, query = pinned_inputs()
    ending = "select encode(extensions.digest(body,'sha256'),'hex') from payload;"
    if query.count(ending) != 1:
        raise ValueError('FINGERPRINT_QUERY_SHAPE_CHANGED')
    raw = handle.sql(controller.DATABASE, 'BEGIN READ ONLY;\n'+query.replace(ending,'select body from payload;')+'\nCOMMIT;',
                     'final_schema_projection', transaction=False).strip()
    actual = json.loads(raw)
    report = compare_projection(snapshot_projection(snapshot), actual)
    report['actualFingerprint'] = sha(raw)
    print(json.dumps(report, sort_keys=True), flush=True)
    fixed = controller.load_fixed()
    reference = fixed._REFERENCES[handle]
    sources = [s for s in reference.sources if s.key in fixed.SPECS]
    values = {value.encode() for source in sources for value in source.slots.values()}
    for source in sources:
        for line in {'B0':(226,227,228,231),'C2':(33,),'D2':(33,66),'F2':(40,)}[source.key]:
            values.add(source.literal(line).encode())
    manifest = json.loads((ROOT/'scripts/migration-history-manifest.json').read_text())['files']
    hashes = {digest:'migrations/'+name for name,digest in manifest.items()}
    report = private_census(Path(reference.directory), values, reference.inputs.records, hashes)
    print(json.dumps(report, sort_keys=True), flush=True)


def terminal_observer(controller, original):
    seen = set()
    def observed(handle):
        # No success interception: finish/release/privacy methods stay unchanged.
        try:
            frame = sys._getframe(1)
            code = getattr(controller._serve_child, '__code__', None)
            tail = frame.f_locals.get('tail')
            loop = frame.f_locals.get('loop')
            child = frame.f_locals.get('child')
            if (code is not None and frame.f_code is code and frame.f_locals.get('h') is handle
                    and frame.f_locals.get('scope') == 'full' and getattr(tail,'state',None) == 'executed'
                    and getattr(loop,'applied',False) is True and child is not None
                    and child.poll() not in (None,0) and id(handle) not in seen):
                seen.add(id(handle))
                collect(controller, handle)
        except Exception:
            # Exception text/raw subprocess details are never diagnostics.
            print(json.dumps({'stage':'final_diagnostic','outcome':'EVIDENCE_UNAVAILABLE',
                              'schemaAccepted':False,'privacyAccepted':False}), flush=True)
        finally:
            return original(handle)
    return observed


def load_controller():
    path = ROOT/'scripts/canonical-auth-provisioning-replay.py'
    spec = importlib.util.spec_from_file_location('terminal_diagnostic_loader', path)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    return m.controller()


def main():
    if len(sys.argv) != 1:
        raise ValueError('NO_DIAGNOSTIC_ARGUMENTS_ACCEPTED')
    pinned_inputs()
    controller = load_controller(); dedupe = controller.load_dedupe()
    original, argv = dedupe.fail, sys.argv
    dedupe.fail = terminal_observer(controller, original)
    sys.argv = [str(ROOT/'scripts/canonical-auth-provisioning-replay.py'), '--owned-compatible']
    try:
        controller.main()
    finally:
        dedupe.fail, sys.argv = original, argv


if __name__ == '__main__':
    try:
        main()
    except (Exception, KeyboardInterrupt):
        print('FAIL ordinary replay; diagnostics do not change acceptance', file=sys.stderr)
        raise SystemExit(1) from None
