"""Alignment-only additions to the accepted complete portable catalog reader."""

from collections import Counter


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
