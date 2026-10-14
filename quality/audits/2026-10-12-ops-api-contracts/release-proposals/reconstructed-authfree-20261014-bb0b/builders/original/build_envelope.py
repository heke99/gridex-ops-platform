from pathlib import Path
import sys,re,json,hashlib
sys.path.insert(0,'/tmp/gridex-api-rebuild-20261014/reconstruction-inventory/python-deps')
from pglast import parse_sql
from pglast.stream import RawStream
OUT=Path(__file__).parent
BASE=Path('/tmp/gridex-ops-final/quality/audits/2026-10-12-ops-api-contracts/release-proposals')
native=json.loads((OUT/'native-protected-metadata.json').read_text())
edits=json.loads((OUT/'source-edits.json').read_text())
derived=(OUT/'effective-main-source.sql').read_text()
old=(BASE/'installer-capability/003-qualified-atomic-install.sql').read_text()
q=lambda s:"'"+s.replace("'","''")+"'"
expected_acl=lambda values:'ARRAY['+','.join(q(x) for x in values)+']::aclitem[]'
auth_schema=next(x for x in native['namespaces'] if x['nspname']=='auth')
users=next(x for x in native['protected_relations'] if x['relname']=='users')
uid=next(x for x in native['auth_functions'] if x['proname']=='uid')
acl=lambda expression,values:"(SELECT array_agg(a::text ORDER BY a::text COLLATE \"C\") FROM unnest("+expression+") a) IS DISTINCT FROM (SELECT array_agg(a::text ORDER BY a::text COLLATE \"C\") FROM unnest("+expected_acl(values)+") a)"
guards={
'auth_namespace':" IF (SELECT nspowner FROM pg_catalog.pg_namespace WHERE nspname='auth')<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='supabase_admin') OR "+acl("(SELECT nspacl FROM pg_catalog.pg_namespace WHERE nspname='auth')",auth_schema['nspacl'])+" THEN RAISE EXCEPTION 'ops_auth_free_protected_auth_namespace_drift'; END IF;",
'auth_users':" IF (SELECT relowner FROM pg_catalog.pg_class WHERE oid='auth.users'::regclass)<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='supabase_auth_admin') OR "+acl("(SELECT relacl FROM pg_catalog.pg_class WHERE oid='auth.users'::regclass)",users['relacl'])+" THEN RAISE EXCEPTION 'ops_auth_free_protected_auth_users_acl_drift'; END IF;",
'auth_uid':" IF (SELECT proowner FROM pg_catalog.pg_proc WHERE oid='auth.uid()'::regprocedure)<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='supabase_auth_admin') OR "+acl("(SELECT proacl FROM pg_catalog.pg_proc WHERE oid='auth.uid()'::regprocedure)",uid['proacl'])+" THEN RAISE EXCEPTION 'ops_auth_free_protected_auth_uid_acl_drift'; END IF;"
}
out=[];counts={key:0 for key in guards}
for line in old.splitlines():
    if 'ops_atomic_existing_retention_namespace_acl_drift' in line:
        line=" IF NOT EXISTS(SELECT FROM pg_catalog.pg_namespace n WHERE n.nspname='gridex_ediel_retention' AND n.nspowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='gridex_ediel_retention_owner') AND (SELECT array_agg(a::text ORDER BY a::text COLLATE \"C\") FROM unnest(n.nspacl)a) IN (ARRAY['gridex_ediel_retention_owner=UC/gridex_ediel_retention_owner']::text[],ARRAY['gridex_ediel_retention_owner=UC/gridex_ediel_retention_owner','postgres=U/gridex_ediel_retention_owner']::text[])) THEN RAISE EXCEPTION 'ops_atomic_existing_retention_namespace_acl_drift'; END IF;"
    if "ops_atomic_storage_objects_acl_contract_drift" in line:
        # Preserve the canonical RET rw alternatives and every other ACL entry.
        # Native app roles have arwd only; never grant privileges to fit a stale fixture.
        assert line.count('authenticated=arwdDxtm/supabase_storage_admin')==3
        assert line.count('anon=arwdDxtm/supabase_storage_admin')==3
        line=line.replace('authenticated=arwdDxtm/supabase_storage_admin','authenticated=arwd/supabase_storage_admin').replace('anon=arwdDxtm/supabase_storage_admin','anon=arwd/supabase_storage_admin')
    if 'Protected Auth rights must exist' in line:out.append(' -- Canonical postgres SECURITY DEFINER actor/session boundaries require no direct retention Auth grant.');continue
    if '-- cannot grant these missing owner privileges' in line:continue
    if "ops_atomic_protected_auth_owner_prerequisite_required" in line:
        out.append(" IF pg_catalog.has_schema_privilege('gridex_ediel_retention_owner','auth','USAGE') OR pg_catalog.has_table_privilege('gridex_ediel_retention_owner','auth.users','SELECT') OR pg_catalog.has_table_privilege('gridex_ediel_retention_owner','auth.users','UPDATE') THEN RAISE EXCEPTION 'ops_auth_free_direct_retention_auth_capability_drift'; END IF;")
        continue
    if line.startswith(" IF (SELECT nspowner") and "nspname='auth'" in line:key='auth_namespace'
    elif line.startswith(" IF (SELECT relowner") and "'auth.users'::regclass" in line:key='auth_users'
    elif line.startswith(" IF (SELECT proowner") and "'auth.uid()'::regprocedure" in line:key='auth_uid'
    else:out.append(line);continue
    counts[key]+=1;out.append(guards[key])
assert all(v==2 for v in counts.values()),counts
sql='\n'.join(out)+'\n'
restore_lines=[line for line in sql.splitlines() if 'IS DISTINCT FROM original_retention_acl THEN' in line]
assert len(restore_lines)==1
before_restore=restore_lines[0]
prefix,object_expr=before_restore.split(" OR (SELECT jsonb_build_object('namespace'",1)
object_expr="(SELECT jsonb_build_object('namespace'"+object_expr
expr,tail=object_expr.split(' IS DISTINCT FROM original_retention_acl THEN',1)
after_restore=prefix+" OR ("+expr+" #- '{namespace,2}') IS DISTINCT FROM (original_retention_acl #- '{namespace,2}') THEN"+tail
sql=sql.replace(before_restore,after_restore)
sql=sql.replace('original_retention_acl jsonb;', 'original_retention_acl jsonb; original_auth_functions jsonb; original_auth_columns jsonb; original_auth_triggers jsonb; original_auth_classes jsonb; edited bytea; patch jsonb; previous_end integer:=0; patch_start integer; patch_length integer; patch_new bytea;')

# Reconstruct exact derived source from immutable code-only B3 stage bytes.
overlay="""
 edited:=''::bytea;
 FOR patch IN SELECT value FROM jsonb_array_elements(%s::jsonb) LOOP
  patch_start:=(patch->>'start_byte')::integer; patch_length:=(patch->>'delete_bytes')::integer;
  IF patch_start<previous_end OR patch_start+patch_length>octet_length(source) OR encode(sha256(substring(source FROM patch_start+1 FOR patch_length)),'hex') IS DISTINCT FROM patch->>'old_sha256' THEN RAISE EXCEPTION 'ops_auth_free_source_patch_precondition_drift'; END IF;
  patch_new:=convert_to(patch->>'new_text','UTF8');
  edited:=edited||substring(source FROM previous_end+1 FOR patch_start-previous_end)||patch_new;
  previous_end:=patch_start+patch_length;
 END LOOP;
 source:=edited||substring(source FROM previous_end+1);
 IF octet_length(source)<>%s OR encode(sha256(source),'hex')<>%s THEN RAISE EXCEPTION 'ops_auth_free_derived_source_sha256_drift'; END IF;
"""%(q(json.dumps([{k:v for k,v in p.items() if k!='reason'} for p in edits['edits']],separators=(',',':'),ensure_ascii=False)),edits['derived_bytes'],q(edits['derived_sha256']))
assert derived.count('\nBEGIN;\n')==1
assert derived.endswith('COMMIT;\n')
begin=derived.index('\nBEGIN;\n')+1
commit=len(derived)-len('COMMIT;\n')
executable=derived[:begin]+derived[begin+6:commit]+derived[commit+7:]
executable_sha=hashlib.sha256(executable.encode()).hexdigest()
statement=" executable:=pg_catalog.substring(source,1,%s)||pg_catalog.substring(source,%s,%s)||pg_catalog.substring(source,%s);"%(len(derived[:begin].encode()),len(derived[:begin+6].encode())+1,len(derived[begin+6:commit].encode()),len(derived[:commit+7].encode())+1)
sql=re.sub(r'^ executable:=.*$',lambda _:overlay+statement,sql,flags=re.M)
sql=re.sub(r'^ IF pg_catalog.octet_length\(executable\).+$'," IF pg_catalog.octet_length(executable)<>"+str(len(executable.encode()))+" OR pg_catalog.encode(pg_catalog.sha256(executable),'hex')<>"+q(executable_sha)+" THEN RAISE EXCEPTION 'ops_auth_free_executable_source_sha256_drift'; END IF;",sql,flags=re.M)

capture="""
 original_auth_functions:=(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_proc p WHERE p.pronamespace='auth'::regnamespace);
 original_auth_columns:=(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attrelid,a.attnum) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid WHERE c.relnamespace='auth'::regnamespace AND a.attnum>0);
 original_auth_classes:=(SELECT jsonb_agg(to_jsonb(c)-ARRAY['relpages','reltuples','relallvisible','relallfrozen','relfrozenxid','relminmxid'] ORDER BY c.oid) FROM pg_class c WHERE c.relnamespace='auth'::regnamespace);
 original_auth_triggers:=(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='auth'::regnamespace);
"""
sql=sql.replace(' GRANT gridex_ediel_retention_owner TO postgres WITH ADMIN FALSE, INHERIT TRUE, SET TRUE GRANTED BY postgres;',capture+' GRANT gridex_ediel_retention_owner TO postgres WITH ADMIN FALSE, INHERIT TRUE, SET TRUE GRANTED BY postgres;')

# Only canonical new FK hooks on auth.users may extend the protected trigger set.
m=re.search(r'EXECUTE (\$ops_exact_[a-f0-9]+\$)',derived);start=m.end();ddl=derived[start:derived.index(m[1],start)]
fk=[]
for raw in parse_sql(ddl):
 t=raw.stmt
 if type(t).__name__=='AlterTableStmt':
  for cmd in t.cmds:
   con=cmd.def_
   if con and type(con).__name__=='Constraint' and getattr(con,'pktable',None) and con.pktable.schemaname=='auth':
    assert con.pktable.relname=='users'
    fk.append((t.relation.schemaname+'.'+t.relation.relname,con.conname))
values=','.join('('+q(table)+','+q(name)+')' for table,name in fk)
assert fk
check="""
 IF NOT EXISTS(SELECT FROM pg_namespace n WHERE n.nspname='gridex_ediel_retention' AND n.nspowner=(SELECT oid FROM pg_roles WHERE rolname='gridex_ediel_retention_owner') AND (SELECT array_agg(a::text ORDER BY a::text COLLATE "C") FROM unnest(n.nspacl)a)=ARRAY['gridex_ediel_retention_owner=UC/gridex_ediel_retention_owner','postgres=U/gridex_ediel_retention_owner']::text[]) THEN RAISE EXCEPTION 'ops_auth_free_permanent_pg_retention_namespace_usage_drift'; END IF;
 IF NOT has_schema_privilege('postgres','gridex_ediel_retention','USAGE') OR has_schema_privilege('postgres','gridex_ediel_retention','CREATE') THEN RAISE EXCEPTION 'ops_auth_free_pg_retention_namespace_boundary_drift'; END IF;
 IF EXISTS(SELECT FROM pg_roles r WHERE r.rolname IN('anon','authenticated','service_role','authenticator') AND has_schema_privilege(r.oid,'gridex_ediel_retention','USAGE')) THEN RAISE EXCEPTION 'ops_auth_free_application_retention_namespace_usage_drift'; END IF;
 IF original_auth_functions IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_proc p WHERE p.pronamespace='auth'::regnamespace) OR original_auth_columns IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attrelid,a.attnum) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid WHERE c.relnamespace='auth'::regnamespace AND a.attnum>0) OR original_auth_classes IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(c)-ARRAY['relpages','reltuples','relallvisible','relallfrozen','relfrozenxid','relminmxid'] ORDER BY c.oid) FROM pg_class c WHERE c.relnamespace='auth'::regnamespace) THEN RAISE EXCEPTION 'ops_auth_free_protected_auth_metadata_changed'; END IF;
 IF original_auth_triggers IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM pg_trigger t WHERE t.oid IN(SELECT (x->>'oid')::oid FROM jsonb_array_elements(original_auth_triggers)x)) THEN RAISE EXCEPTION 'ops_auth_free_existing_auth_trigger_changed'; END IF;
 IF EXISTS(SELECT FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='auth'::regnamespace AND t.oid NOT IN(SELECT (x->>'oid')::oid FROM jsonb_array_elements(original_auth_triggers)x) AND (NOT t.tgisinternal OR t.tgenabled<>'O' OR NOT EXISTS(SELECT FROM pg_constraint f JOIN (VALUES %s) expected(relation_name,constraint_name) ON f.conrelid=to_regclass(expected.relation_name) AND f.conname=expected.constraint_name JOIN pg_proc p ON p.oid=t.tgfoid WHERE f.oid=t.tgconstraint AND f.contype='f' AND f.confrelid='auth.users'::regclass AND p.pronamespace='pg_catalog'::regnamespace AND p.proname IN('RI_FKey_noaction_del','RI_FKey_noaction_upd','RI_FKey_restrict_del','RI_FKey_restrict_upd','RI_FKey_cascade_del','RI_FKey_cascade_upd','RI_FKey_setnull_del','RI_FKey_setnull_upd','RI_FKey_setdefault_del','RI_FKey_setdefault_upd')))) THEN RAISE EXCEPTION 'ops_auth_free_unqualified_new_auth_trigger'; END IF;
 IF has_schema_privilege('gridex_ediel_retention_owner','auth','USAGE') OR has_table_privilege('gridex_ediel_retention_owner','auth.users','SELECT') OR has_table_privilege('gridex_ediel_retention_owner','auth.users','UPDATE') THEN RAISE EXCEPTION 'ops_auth_free_direct_retention_auth_privilege_added'; END IF;
"""%values
sql=sql.replace(" IF pg_catalog.pg_has_role('postgres','gridex_ediel_retention_owner','USAGE') THEN RAISE EXCEPTION 'ops_atomic_retention_inheritance_not_restored'; END IF;"," IF pg_catalog.pg_has_role('postgres','gridex_ediel_retention_owner','USAGE') THEN RAISE EXCEPTION 'ops_atomic_retention_inheritance_not_restored'; END IF;"+check)
sql=sql.replace('-- The entire unchanged approved semantic installation runs in this final','-- The exact reviewed derived semantic installation runs in this final')
embedded=re.search(r"FOR patch IN SELECT value FROM jsonb_array_elements\('((?:[^']|'')*)'::jsonb\) LOOP",sql,re.S)
assert embedded
decoded_overlay=json.loads(embedded.group(1).replace("''","'"))
assert decoded_overlay==[{k:v for k,v in p.items() if k!='reason'} for p in edits['edits']]
basebytes=(BASE/'native-additive-reconciliation.sql').read_bytes()
rebuilt=b'';previous=0
for p in decoded_overlay:
    lo=p['start_byte'];hi=lo+p['delete_bytes']
    assert hashlib.sha256(basebytes[lo:hi]).hexdigest()==p['old_sha256']
    rebuilt+=basebytes[previous:lo]+p['new_text'].encode();previous=hi
rebuilt+=basebytes[previous:]
assert rebuilt==derived.encode()
parse_sql(sql)
(OUT/'auth-free-main-envelope.sql').write_text(sql)
(OUT/'auth-fk-hook-allowlist.json').write_text(json.dumps(fk,indent=2)+'\n')
(OUT/'envelope-proposal-manifest.json').write_text(json.dumps({'status':'PRIVATE_NEW_MAIN_PROPOSAL_NOT_REVIEWED_NOT_APPLIED','source_edits_sha256':hashlib.sha256((OUT/'source-edits.json').read_bytes()).hexdigest(),'derived_source_sha256':edits['derived_sha256'],'envelope_sha256':hashlib.sha256(sql.encode()).hexdigest(),'envelope_bytes':len(sql.encode()),'executable_sha256':executable_sha,'auth_fk_source_constraints':len(fk),'native_capture_at':native['captured_at'],'native_auth_triggers':len(native['auth_triggers']),'native_ledger_count':native['ledger_count'],'auth_grants_added':False,'dependent_semantic_inputs_composed':False,'clock_edits_composed':edits['clock_edits_included'],'five_adapter_input_composed':False,'source_note':'New source proposal only. Original B3 stages remain byte-identical; all dependent inputs must share the outer atomic transaction before actual application.'},indent=2)+'\n')
print(json.dumps({'envelope_bytes':len(sql.encode()),'sha256':hashlib.sha256(sql.encode()).hexdigest(),'auth_fk_constraints':len(fk)}))
