"""Alignment-only additions to the accepted complete portable catalog reader."""


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
