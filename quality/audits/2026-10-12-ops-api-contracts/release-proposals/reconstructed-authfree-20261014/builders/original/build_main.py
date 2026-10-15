from pathlib import Path
import sys,re,json,hashlib,difflib
sys.path.insert(0,'/tmp/gridex-api-rebuild-20261014/reconstruction-inventory/python-deps')
from pglast import parse_sql
from pglast.stream import RawStream

ROOT=Path('/tmp/gridex-ops-final')
OUT=Path(__file__).parent
base=ROOT/'quality/audits/2026-10-12-ops-api-contracts/release-proposals'
original=(base/'native-additive-reconciliation.sql').read_text()
assert hashlib.sha256(original.encode()).hexdigest()=='bacf8944718c984d117f0400ed19fadd978feed6613ea9196784eff4591ac600'
inventory=json.loads(Path('/tmp/gridex-api-rebuild-20261014/reconstruction-inventory/reconstruction-inventory.json').read_text())
patches={}
def add(start,end,new,why):
    key=(start,end)
    if key in patches:assert patches[key]['new']==new
    patches[key]={'start':start,'end':end,'old':original[start:end],'new':new,'reason':why}
def replace_once(old,new,why):
    assert original.count(old)==1,(why,original.count(old))
    pos=original.index(old);add(pos,pos+len(old),new,why)
marker=re.search(r'EXECUTE (\$ops_exact_[a-f0-9]+\$)',original)
offset=marker.end();inner=original[offset:original.index(marker[1],offset)]
functions={}
newhashes={}
for raw in parse_sql(inner):
    t=raw.stmt
    if type(t).__name__!='CreateFunctionStmt':continue
    name='.'.join(x.sval for x in t.funcname)
    body=next(x.arg[0].sval for x in t.options if x.defname=='as')
    functions[name]=body
    if not name.startswith('gridex_ediel_retention.finance_guard_'):continue
    old="BEGIN IF TG_OP='UPDATE' AND public.ediel_is_qualified_finance_retention_transition_v1(TG_TABLE_SCHEMA,TG_TABLE_NAME,to_jsonb(OLD),to_jsonb(NEW)) THEN RETURN NEW;END IF;"
    assert body.count(old)==1,name
    new="BEGIN IF TG_OP='UPDATE' THEN IF pg_catalog.has_function_privilege(current_user,'public.ediel_is_qualified_finance_retention_transition_v1(text,text,jsonb,jsonb)','EXECUTE') THEN IF public.ediel_is_qualified_finance_retention_transition_v1(TG_TABLE_SCHEMA,TG_TABLE_NAME,to_jsonb(OLD),to_jsonb(NEW)) IS TRUE THEN RETURN NEW;END IF;END IF;END IF;"
    revised=body.replace(old,new)
    pos=original.index(body,offset+raw.stmt_location)
    add(pos,pos+len(body),revised,'six-finance-capability-gate:'+name)
    newhashes[hashlib.md5(body.encode()).hexdigest()]=hashlib.md5(revised.encode()).hexdigest()
    (OUT/(name.split('.')[-1]+'.body.sql')).write_text(revised)
assert len(newhashes)==6
freshness_path=Path('/tmp/gridex-api-rebuild-20261014/freshness-proposal/manifest.json')
freshness=json.loads(freshness_path.read_text())
assert freshness['source_sha256']==hashlib.sha256(original.encode()).hexdigest()
assert len(freshness['changes'])==13
for change in freshness['changes']:
    assert functions[change['name']]==change['original_body']
    revised=change['proposed_body']
    assert hashlib.md5(revised.encode()).hexdigest()==change['proposed_body_md5']
    replace_once(change['original_body'],revised,'thirteen-freshness-source-body:'+change['name'])
    newhashes[change['original_body_md5']]=change['proposed_body_md5']
assert len(newhashes)==19

# The active signing API is an existing prerequisite, outside the 1,205 created
# definitions. Preserve the exact stronger body installed by the scoped forward.
signing_sig='public.gridex_prepare_customer_contract_signature_request_v1(uuid, uuid, uuid, text, text, timestamp with time zone, uuid, text)'
signing_old='8bd61eb144c72df71c050350a6ed0e57'
signing_strong='cee1222f070383e440a9fd4f71cdf591'
allowed_match=re.search(r"^ allowed constant jsonb := '(.*)'::jsonb;$",original,re.M)
allowed=json.loads(allowed_match[1].replace("''","'"))
strong_case=json.loads(json.dumps(next(x for x in allowed[signing_sig] if x['body_md5']==signing_old)))
strong_case['body_md5']=signing_strong
old_signing_cases=json.dumps(allowed[signing_sig],separators=(',',':'),ensure_ascii=False).replace("'","''")
assert allowed_match[1].count(old_signing_cases)==1
insertion=allowed_match.start(1)+allowed_match[1].index(old_signing_cases)+len(old_signing_cases)-1
new_signing_case=','+json.dumps(strong_case,separators=(',',':'),ensure_ascii=False).replace("'","''")
add(insertion,insertion,new_signing_case,'source-proven-strong-active-signing-existing-variant')
replace_once('repair_attributes jsonb;','repair_attributes jsonb; signing_prepare_before jsonb;','capture-existing-active-signing-full-row-variable')
signing_guard="""
 -- Preserve the source-proven stronger active signature API; never replace it
 -- with its dormant historical predecessor or a simpler canonical body.
 signing_prepare_before:=(SELECT to_jsonb(p) FROM pg_proc p WHERE p.oid=to_regprocedure('SIGNATURE'));
 IF signing_prepare_before->>'prosrc' IS NOT NULL AND md5(signing_prepare_before->>'prosrc')='cee1222f070383e440a9fd4f71cdf591' THEN
  IF NOT EXISTS(SELECT FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure('SIGNATURE')
   AND md5(pg_get_functiondef(p.oid))='0e6cbec5c3c542330d33e88be75ed060'
   AND p.proowner=(SELECT oid FROM pg_roles WHERE rolname='postgres') AND p.prokind='f'
   AND p.proacl=ARRAY['postgres=X/postgres','service_role=X/postgres']::aclitem[]
   AND p.proargtypes=ARRAY['uuid'::regtype::oid,'uuid'::regtype::oid,'uuid'::regtype::oid,'text'::regtype::oid,'text'::regtype::oid,'timestamptz'::regtype::oid,'uuid'::regtype::oid,'text'::regtype::oid]::oidvector
   AND p.pronargs=8 AND p.proallargtypes IS NULL AND p.proargmodes IS NULL AND p.proargnames=ARRAY['p_company_id','p_customer_id','p_contract_id','p_token_hash','p_recipient_email','p_expires_at','p_actor_user_id','p_channel']::text[]
   AND p.prorettype='jsonb'::regtype AND NOT p.proretset AND p.pronargdefaults=1 AND pg_get_expr(p.proargdefaults,0)='''internal''::text'
   AND p.prosecdef AND NOT p.proisstrict AND NOT p.proleakproof AND p.provolatile='v' AND p.proparallel='u'
   AND p.proconfig=ARRAY['search_path=public, private, extensions, pg_temp']::text[] AND l.lanname='plpgsql'
   AND p.procost=100 AND p.prorows=0 AND p.provariadic=0 AND p.prosupport=0 AND p.protrftypes IS NULL AND p.probin IS NULL AND p.prosqlbody IS NULL)
  THEN RAISE EXCEPTION 'ops_strong_active_signing_full_metadata_required'; END IF;
 END IF;
""".replace('SIGNATURE',signing_sig)
outer_begin=original.index('\nBEGIN\n',allowed_match.end())+len('\nBEGIN\n')
add(outer_begin,outer_begin,signing_guard,'strong-active-signing-full-preflight-and-snapshot')
for line in original.splitlines(keepends=True):
    if line.startswith('IF ') and signing_sig in line and signing_old in line and 'md5(prosrc)' in line:
        replace_once(line,line.replace("<> '"+signing_old+"'","NOT IN ('"+signing_old+"','"+signing_strong+"')"),'recognize-exact-strong-active-signing-preserved-body')
postcheck=" IF signing_prepare_before IS DISTINCT FROM (SELECT to_jsonb(p) FROM pg_proc p WHERE p.oid=to_regprocedure('"+signing_sig+"')) THEN RAISE EXCEPTION 'ops_active_signing_full_metadata_or_body_changed'; END IF;\n"
replace_once('END $ops_portable_delivery$;',postcheck+'END $ops_portable_delivery$;','preserve-entire-existing-active-signing-function-row')
for g in inventory['remove_only_three_obsolete_grants']:replace_once(g['text']+'\n','', 'remove-unnecessary-direct-auth-grant')
alias='public.ediel_revoke_blob_retention_before_class_guard_v1'
sig=inventory['canonical_private_delegate_owner_restore']['manifest_signatures'][0]
replace_once(f'ALTER FUNCTION {sig} OWNER TO "postgres";',f'ALTER FUNCTION {sig} OWNER TO "gridex_ediel_retention_owner";','restore-source-private-delegate-owner')
relations={r['name'] for r in inventory['seven_tables_eighteen_views_owner_restore_candidates']}
for name in sorted(relations):
    schema,relation=name.split('.')
    kind='VIEW' if next(r for r in inventory['seven_tables_eighteen_views_owner_restore_candidates'] if r['name']==name)['kind']=='v' else 'TABLE'
    old=f'ALTER {kind} "{schema}"."{relation}" OWNER TO "postgres";'
    replace_once(old,old.replace('"postgres"','"gridex_ediel_retention_owner"'),'restore-source-relation-owner:'+name)

# The complete-state guard uses a sealed digest rather than embedding metadata
# literals. Reconstruct its exact typed JSON manifest and preserve every field.
complete=json.loads((base/'native-additive-reconciliation-complete-state-manifest.json').read_text())
def pg_jsonb(value):
    if isinstance(value,dict):return '{'+', '.join(json.dumps(k,ensure_ascii=False)+': '+pg_jsonb(v) for k,v in sorted(value.items(),key=lambda item:(len(item[0].encode()),item[0].encode())))+'}'
    if isinstance(value,list):return '['+', '.join(map(pg_jsonb,value))+']'
    return json.dumps(value,ensure_ascii=False)
old_complete_hash=hashlib.md5(pg_jsonb(complete).encode()).hexdigest()
assert old_complete_hash=='f9abdb805ca293af299c3f4efcbfe1e6'
metadata_edits=0
for obj in complete['functions']+complete['relations']:
    if obj.get('body_md5') in newhashes:obj['body_md5']=newhashes[obj['body_md5']];metadata_edits+=1
    if obj.get('name') in relations or obj.get('signature','').split('(')[0]==alias:
        assert obj['owner']=='postgres'
        obj['owner']='gridex_ediel_retention_owner';metadata_edits+=1
        for acl in obj.get('acl',[]):
            for key in ('grantee','grantor'):
                if acl.get(key)=='postgres':acl[key]='gridex_ediel_retention_owner';metadata_edits+=1
    if obj.get('signature','').split('(')[0] in inventory['five_predicate_grants']:
        assert not any(a['grantee']=='postgres' for a in obj['acl'])
        obj['acl'].append({'grantee':'postgres','grantable':False,'privilege':'EXECUTE'})
        obj['acl'].sort(key=lambda a:(a['grantee'].encode(),a['privilege'].encode()))
        metadata_edits+=1
new_complete_hash=hashlib.md5(pg_jsonb(complete).encode()).hexdigest()
assert original.count(old_complete_hash)==2
for m in re.finditer(old_complete_hash,original):add(m.start(),m.end(),new_complete_hash,'synchronize-complete-state-manifest-digest')
(OUT/'effective-complete-state-manifest.json').write_text(json.dumps(complete,indent=2,ensure_ascii=False)+'\n')
(OUT/'complete-state-manifest-byte-proof.json').write_text(json.dumps({'original_pg_jsonb_text_md5':old_complete_hash,'new_pg_jsonb_text_md5':new_complete_hash,'method':'Exact PostgreSQL jsonb key ordering and whitespace reconstruction; original computed digest equals both published B3 guard occurrences. New digest still requires actual PostgreSQL verification.'},indent=2)+'\n')

grants=[]
for v in inventory['five_predicate_grants'].values():
    grants.append('GRANT EXECUTE ON FUNCTION '+v['target']['manifest_signatures'][0]+' TO postgres;')
for table in inventory['four_finance_source_grants']['tables']:grants.append('GRANT SELECT, UPDATE ON TABLE '+table+' TO gridex_ediel_retention_owner;')
endinner=original.index(marker[1],offset)
add(endinner,endinner,'\n-- Restore omitted canonical source privileges; no application or Auth grant.\n'+'\n'.join(grants)+'\n','canonical-consumer-privileges')
ordered=sorted(patches.values(),key=lambda x:x['start'])
for a,b in zip(ordered,ordered[1:]):assert a['end']<=b['start'],(a,b)
derived=original
for p in reversed(ordered):derived=derived[:p['start']]+p['new']+derived[p['end']:]
parse_sql(derived)
def bodies(source):
    m=re.search(r'EXECUTE (\$ops_exact_[a-f0-9]+\$)',source);i=m.end()
    result={}
    for n in parse_sql(source[i:source.index(m[1],i)]):
        t=n.stmt
        if type(t).__name__=='CreateFunctionStmt':
            name='.'.join(x.sval for x in t.funcname)+'('+','.join(RawStream()(p.argType) for p in (t.parameters or ()) if p.mode.value in ('d','i','b','v'))+')'
            # Compare exact argument identities, including existing overloads.
            assert name not in result,name
            result[name]=next(x.arg[0].sval for x in t.options if x.defname=='as')
    return result
before=bodies(original);after=bodies(derived)
changed=[x for x in before if before[x]!=after[x]]
assert len(before)==len(after)==1205
assert len(changed)==19
(OUT/'effective-main-source.sql').write_text(derived)
records=[]
for p in ordered:
    records.append({'start_byte':len(original[:p['start']].encode()),'delete_bytes':len(p['old'].encode()),'old_sha256':hashlib.sha256(p['old'].encode()).hexdigest(),'new_text':p['new'],'reason':p['reason']})
manifest={'status':'PRIVATE_NEW_SOURCE_PROPOSAL_NOT_REVIEWED_NOT_APPLIED','base_sha256':hashlib.sha256(original.encode()).hexdigest(),'base_bytes':len(original.encode()),'derived_sha256':hashlib.sha256(derived.encode()).hexdigest(),'derived_bytes':len(derived.encode()),'changed_function_bodies':changed,'unchanged_function_bodies':1186,'metadata_field_edits':metadata_edits,'edits':records,'clock_edits_included':True,'freshness_input_manifest_sha256':hashlib.sha256(freshness_path.read_bytes()).hexdigest(),'finance_adapters_included':False,'frozen_a6_equality_claim':False}
(OUT/'source-edits.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({k:v for k,v in manifest.items() if k!='edits'}))
