-- Portable catalog projection: object names replace database-local OIDs.
-- Includes every existing public/Auth/storage object, not merely changed tables.
WITH relations AS (
 SELECT c.*, n.nspname, format('%I.%I',n.nspname,c.relname) AS qualified
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','auth','storage')
), objects AS (
 SELECT 'relation/'||qualified AS key,
 jsonb_build_object('kind',relkind,'owner',pg_get_userbyid(relowner),'acl',relacl,
 'rls',relrowsecurity,'force',relforcerowsecurity,'options',reloptions,
 'definition',CASE WHEN relkind IN ('v','m') THEN pg_get_viewdef(oid,false) END) AS value
 FROM relations WHERE relkind IN ('r','p','v','m','S','f')
 UNION ALL
 SELECT 'column/'||r.qualified||'/'||a.attname,
 jsonb_build_object('type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,
 'default',pg_get_expr(d.adbin,d.adrelid,false),'identity',a.attidentity,'generated',a.attgenerated,
 'collation',a.attcollation::regcollation::text,'acl',a.attacl)
 FROM relations r JOIN pg_attribute a ON a.attrelid=r.oid
 LEFT JOIN pg_attrdef d ON d.adrelid=r.oid AND d.adnum=a.attnum
 WHERE a.attnum>0 AND NOT a.attisdropped AND r.relkind IN ('r','p','v','m','f')
 UNION ALL
 SELECT 'constraint/'||r.qualified||'/'||c.conname,
 jsonb_build_object('kind',c.contype,'definition',pg_get_constraintdef(c.oid,false),
 'validated',c.convalidated,'deferrable',c.condeferrable,'deferred',c.condeferred,'noinherit',c.connoinherit)
 FROM relations r JOIN pg_constraint c ON c.conrelid=r.oid
 UNION ALL
 SELECT 'index/'||r.qualified,
 jsonb_build_object('definition',pg_get_indexdef(i.indexrelid,0,false),'valid',i.indisvalid,
 'ready',i.indisready,'unique',i.indisunique,'primary',i.indisprimary,
 'exclusion',i.indisexclusion,'immediate',i.indimmediate,'nulls_not_distinct',i.indnullsnotdistinct)
 FROM relations r JOIN pg_index i ON i.indexrelid=r.oid
 UNION ALL
 SELECT 'trigger/'||r.qualified||'/'||t.tgname,
 jsonb_build_object('definition',pg_get_triggerdef(t.oid,false),'enabled',t.tgenabled)
 FROM relations r JOIN pg_trigger t ON t.tgrelid=r.oid WHERE NOT t.tgisinternal
 UNION ALL
 SELECT 'rule/'||r.qualified||'/'||w.rulename,
 jsonb_build_object('definition',pg_get_ruledef(w.oid,false),'enabled',w.ev_enabled)
 FROM relations r JOIN pg_rewrite w ON w.ev_class=r.oid
 UNION ALL
 SELECT 'policy/'||r.qualified||'/'||p.polname,
 jsonb_build_object('command',p.polcmd,'permissive',p.polpermissive,'roles',p.polroles,
 'using',pg_get_expr(p.polqual,p.polrelid,false),'check',pg_get_expr(p.polwithcheck,p.polrelid,false))
 FROM relations r JOIN pg_policy p ON p.polrelid=r.oid
 UNION ALL
 SELECT 'function/'||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
 jsonb_build_object('definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl)
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('public','auth','storage') AND p.prokind<>'a'
 UNION ALL
 SELECT 'default_acl/'||pg_get_userbyid(d.defaclrole)||'/'||coalesce(n.nspname,'')||'/'||d.defaclobjtype::text,
 to_jsonb(d.defaclacl)
 FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
 UNION ALL
 SELECT 'database_role/'||r.rolname,to_jsonb(r)-'oid'-'rolpassword' FROM pg_roles r
 UNION ALL
 SELECT 'role_membership/'||m.roleid::regrole::text||'/'||m.member::regrole::text||'/'||m.grantor::regrole::text,
 to_jsonb(m)-'oid' FROM pg_auth_members m
 UNION ALL
 SELECT 'extension/'||e.extname,jsonb_build_object('owner',pg_get_userbyid(e.extowner),
 'schema',n.nspname,'version',e.extversion,'relocatable',e.extrelocatable)
 FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
 UNION ALL
 SELECT 'event_trigger/'||e.evtname,jsonb_build_object('event',e.evtevent,'owner',pg_get_userbyid(e.evtowner),
 'function',e.evtfoid::regprocedure::text,'enabled',e.evtenabled,'tags',e.evttags)
 FROM pg_event_trigger e
 UNION ALL
 SELECT 'type/'||n.nspname||'.'||t.typname,jsonb_build_object('kind',t.typtype,'owner',pg_get_userbyid(t.typowner),
 'base',format_type(t.typbasetype,t.typtypmod),'notnull',t.typnotnull,'default',t.typdefault,
 'labels',(SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid=t.oid))
 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
 WHERE n.nspname IN ('public','auth','storage') AND t.typtype IN ('d','e')
 UNION ALL
 SELECT 'dependency/'||pg_describe_object(d.classid,d.objid,d.objsubid)||'/'||
 pg_describe_object(d.refclassid,d.refobjid,d.refobjsubid)||'/'||d.deptype,
 to_jsonb(d.deptype::text)
 FROM pg_depend d
 WHERE (d.classid='pg_proc'::regclass AND EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE p.oid=d.objid AND n.nspname IN ('public','auth','storage')))
 OR (d.classid='pg_rewrite'::regclass AND EXISTS (SELECT 1 FROM pg_rewrite w JOIN relations r ON r.oid=w.ev_class WHERE w.oid=d.objid))
 OR (d.classid='pg_policy'::regclass AND EXISTS (SELECT 1 FROM pg_policy p JOIN relations r ON r.oid=p.polrelid WHERE p.oid=d.objid))
)
SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) FROM objects;
