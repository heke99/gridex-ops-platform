"""Alignment-only additions to the accepted complete portable catalog reader."""

from collections import Counter
from datetime import datetime
import hashlib
import re


# Diagnostic names are fixed projection fields, never object names or values.
MISMATCH_FIELDS = {
    'relation': 'kind owner acl rls force options definition',
    'column': 'type notnull default identity generated collation acl',
    'constraint': 'kind definition validated deferrable deferred noinherit',
    'index': 'definition valid ready unique primary exclusion immediate nulls_not_distinct',
    'trigger': 'definition enabled', 'rule': 'definition enabled',
    'policy': 'command permissive roles using check',
    'function': 'definition owner acl', 'default_acl': '',
    'database_role': 'rolname rolsuper rolinherit rolcreaterole rolcreatedb rolcanlogin rolreplication rolconnlimit rolvaliduntil rolbypassrls rolconfig',
    'role_membership': 'roleid member grantor admin_option inherit_option set_option',
    'extension': 'owner schema version relocatable',
    'event_trigger': 'event owner function enabled tags',
    'type': 'kind owner base notnull default labels', 'dependency': '',
    'alignment_attribute': 'ordinal type dimensions storage compression local inheritance missing missing_value options',
    'alignment_index': 'table method owner options tablespace keys key_count attribute_count collations opclasses ordering expressions predicate clustered replica_identity live check_xmin',
    'alignment_function': 'result language volatility security_definer leakproof strict parallel config arguments body',
    'alignment_dependency': '',
}
MISMATCH_FIELDS = {kind: frozenset(fields.split()) for kind, fields in MISMATCH_FIELDS.items()}


# Selected #1/#2 CREATE declarations omit these ten updated_at columns; #2's
# compatibility loop adds precisely timestamptz DEFAULT now(). Selected #34
# creates the two import tables without updated_at; #36 adds it NOT NULL.
# These are the only qualified identities, with their exact source nullability.
MISSING_TIMESTAMPS = { 'public.' + name + '/updated_at': False for name in (
    'supplier_switch_events', 'outbound_dispatch_events', 'metering_values',
    'ediel_message_events', 'ediel_message_validation_issues', 'ediel_aperak_error_details',
    'audit_logs', 'customer_portal_events', 'customer_invoice_lines', 'customer_invoice_documents') }
MISSING_TIMESTAMPS.update({'public.customer_import_batches/updated_at': True,
                           'public.customer_import_rows/updated_at': True})
TIMESTAMP_SOURCE_PINS = (
    (0, '01_db1_schema_repair_core_helpers_and_canonical_tables.sql', '85f3561be4d91cee063bbf626302de7726a09c5ce08743b250e62cee959bb5f2'),
    (1, '02_db1_operations_ediel_billing_dedupe_and_storage.sql', '0413f4dca84aca387297954b900a163aa63d0f84552570c372c12e8f8abdd693'),
    (33, '20260519_customer_intake_contracts_tenant_hardening.sql', 'a448184e58e8777c41f8bdefb32e45a1365bd37fd9a8e316065da657e57e19f4'),
    (35, '20260526_debug_step1_2f_customer_import_foundation.sql', 'b2e764f4533f0539af021669831e9077582b1a90a257cbb8564777f42971465a'))


def independent_equal(actual, expected, actual_bounds, expected_bounds, prefix):
    """Compare separate builds only; snapshots and same-origin guards stay raw.

    PG17 caches a nonvolatile ADD COLUMN default in attmissingval. Its now()
    value belongs to that build, not the schema. On these source-pinned empty
    ordinary tables it cannot supply a historical row value. Everything else,
    including atthasmissing and the complete attribute/column shape, stays exact.
    """
    try:
        if len(prefix) != 43 or any(prefix[i][0] != 'migrations/' + name
                or type(prefix[i][1]) is not str
                or hashlib.sha256(prefix[i][1].encode()).hexdigest() != digest
                for i, name, digest in TIMESTAMP_SOURCE_PINS):
            return False
        for bounds in (actual_bounds, expected_bounds):
            if (type(bounds) is not tuple or len(bounds) != 2
                    or any(type(value) is not datetime or value.utcoffset() is None for value in bounds)
                    or bounds[0] >= bounds[1]):
                return False
        if expected_bounds[1] > actual_bounds[0]:
            return False
        left, right = actual[0], expected[0]
        if type(left) is not dict or type(right) is not dict or left.keys() != right.keys():
            return False
        tables = {name.split('/')[0] for name in MISSING_TIMESTAMPS}
        for snapshot, bounds in ((actual, actual_bounds), (expected, expected_bounds)):
            shape, rows = snapshot
            if type(rows) is not list or any(type(row) is not list or len(row) != 2
                    or type(row[0]) is not str or type(row[1]) is not dict
                    or row[0] in tables for row in rows):
                return False
            for name, notnull in MISSING_TIMESTAMPS.items():
                relation = shape['relation/' + name.split('/')[0]]
                column = shape['column/' + name]
                attribute = shape['alignment_attribute/' + name]
                if (type(relation) is not dict or relation.get('kind') != 'r'
                        or type(column) is not dict or set(column) != MISMATCH_FIELDS['column']
                        or column['type'] != 'timestamp with time zone' or column['default'] != 'now()'
                        or column['notnull'] is not notnull or column['identity'] != '' or column['generated'] != ''
                        or type(attribute) is not dict or set(attribute) != MISMATCH_FIELDS['alignment_attribute']
                        or attribute['type'] != 'timestamp with time zone' or attribute['missing'] is not True
                        or type(attribute['dimensions']) is not int or attribute['dimensions'] != 0):
                    return False
                value = attribute['missing_value']
                if (type(value) is not list or len(value) != 1 or type(value[0]) is not str
                        or re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?[+-]\d{2}:\d{2}', value[0]) is None
                        or not bounds[0] <= datetime.fromisoformat(value[0]) <= bounds[1]):
                    return False
        qualified = {'alignment_attribute/' + name for name in MISSING_TIMESTAMPS}
        return all(left[key] == right[key] or (key in qualified
            and {field: value for field, value in left[key].items() if field != 'missing_value'}
                == {field: value for field, value in right[key].items() if field != 'missing_value'})
            for key in left)
    except (ValueError, TypeError, KeyError, IndexError):
        return False


def mismatch_summary(actual, expected):
    """Count exact disagreements without returning identities, keys or values.

    Read-only diagnostic projection; never normalizes either equality operand.
    Unknown kinds/fields collapse to fixed 'other', including private names.
    """
    counts = Counter()
    objects = 0
    for key in actual.keys() | expected.keys():
        if key in actual and key in expected and actual[key] == expected[key]:
            continue
        objects += 1
        kind = next((name for name in MISMATCH_FIELDS
                     if type(key) is str and key.startswith(name + '/')), 'other')
        if key not in actual or key not in expected:
            counts[kind, 'missing_actual' if key not in actual else 'extra_actual', 'object'] += 1
            continue
        left, right = actual[key], expected[key]
        if type(left) is not dict or type(right) is not dict:
            counts[kind, 'changed', 'value'] += 1
            continue
        allowed = MISMATCH_FIELDS.get(kind, frozenset())
        for field in left.keys() | right.keys():
            if field not in left or field not in right or left[field] != right[field]:
                label = field if type(field) is str and field in allowed else 'other'
                counts[kind, 'changed', label] += 1
    return {'objects': objects, 'groups': [dict(kind=kind, change=change, field=field, count=count)
            for (kind, change, field), count in sorted(counts.items())]}


def sql(repair):
    base = repair.catalog_sql().strip().removesuffix(';')
    return '''WITH alignment_base(catalog) AS (''' + base + '''), alignment_objects AS (
SELECT 'alignment_attribute/'||n.nspname||'.'||c.relname||'/'||a.attname AS key,
 jsonb_build_object('ordinal',a.attnum,'type',format_type(a.atttypid,a.atttypmod),
 'dimensions',a.attndims,'storage',a.attstorage,'compression',a.attcompression,
 'local',a.attislocal,'inheritance',a.attinhcount,'missing',a.atthasmissing,
 'missing_value',a.attmissingval,'options',a.attoptions) AS value
 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','auth','storage') AND a.attnum>0 AND NOT a.attisdropped
 AND c.relkind IN ('r','p','v','m','f')
UNION ALL
SELECT 'alignment_index/'||n.nspname||'.'||c.relname,
 jsonb_build_object('table',i.indrelid::regclass::text,'method',am.amname,
 'owner',pg_get_userbyid(c.relowner),'options',c.reloptions,'tablespace',t.spcname,
 'keys',i.indkey::text,'key_count',i.indnkeyatts,'attribute_count',i.indnatts,
 'collations',(SELECT jsonb_agg(x::regcollation::text ORDER BY ordinal) FROM unnest(i.indcollation) WITH ORDINALITY q(x,ordinal)),
 'opclasses',(SELECT jsonb_agg(ns.nspname||'.'||op.opcname ORDER BY ordinal) FROM unnest(i.indclass) WITH ORDINALITY q(x,ordinal) JOIN pg_opclass op ON op.oid=x JOIN pg_namespace ns ON ns.oid=op.opcnamespace),
 'ordering',i.indoption::text,'expressions',pg_get_expr(i.indexprs,i.indrelid),
 'predicate',pg_get_expr(i.indpred,i.indrelid),'clustered',i.indisclustered,
 'replica_identity',i.indisreplident,'live',i.indislive,'check_xmin',i.indcheckxmin)
 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_am am ON am.oid=c.relam LEFT JOIN pg_tablespace t ON t.oid=c.reltablespace
 WHERE n.nspname IN ('public','auth','storage')
UNION ALL
SELECT 'alignment_function/'||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
 jsonb_build_object('result',pg_get_function_result(p.oid),'language',l.lanname,'volatility',p.provolatile,
 'security_definer',p.prosecdef,'leakproof',p.proleakproof,'strict',p.proisstrict,'parallel',p.proparallel,
 'config',p.proconfig,'arguments',pg_get_function_arguments(p.oid),'body',p.prosrc)
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
 WHERE n.nspname IN ('public','auth','storage') AND p.prokind<>'a'
UNION ALL
SELECT 'alignment_dependency/'||pg_describe_object(d.classid,d.objid,d.objsubid)||'/'||
 pg_describe_object(d.refclassid,d.refobjid,d.refobjsubid)||'/'||d.deptype::text,to_jsonb(d.deptype::text)
 FROM pg_depend d
 WHERE (d.classid='pg_class'::regclass AND EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.oid=d.objid AND n.nspname IN ('public','auth','storage')))
 OR (d.classid='pg_constraint'::regclass AND EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.oid=d.objid AND n.nspname IN ('public','auth','storage')))
)
SELECT catalog || (SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) FROM alignment_objects)
FROM alignment_base;'''
