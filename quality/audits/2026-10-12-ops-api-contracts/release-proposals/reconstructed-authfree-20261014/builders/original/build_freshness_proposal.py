from pathlib import Path
import hashlib,json,re,sys
OUT=Path(__file__).parent
INV=OUT.parent/'reconstruction-inventory'
sys.path.insert(0,str(INV/'python-deps'))
from pglast import parse_sql
report=json.loads((INV/'reconstruction-inventory.json').read_text())
source=Path(report['published_inputs'][0]['path']).read_text()
m=re.search(r'EXECUTE (\$ops_exact_[a-f0-9]+\$)',source);inner=source[m.end():source.index(m[1],m.end())]
functions={}
for raw in parse_sql(inner):
 s=raw.stmt
 if type(s).__name__=='CreateFunctionStmt':
  name='.'.join(x.sval for x in s.funcname);body=next(x.arg[0].sval for x in s.options if x.defname=='as');start=inner.index('CREATE ',raw.stmt_location);end=raw.stmt_location+raw.stmt_len
  functions[name]=(body,inner[start:end]+';')
changes=[]
def rep(b,a,v):
 assert b.count(a)==1,(a,b.count(a));return b.replace(a,v)
def put(name,b,why):
 old,stmt=functions[name];assert old!=b
 (OUT/(name+'.proposed-body.sql')).write_text(b)
 # String body itself is exactly the dollar-quoted AS payload, all ABI/header attributes retained.
 assert stmt.count(old)==1,name
 newstmt=stmt.replace(old,b)
 parse_sql(newstmt)
 (OUT/(name+'.proposed-create.sql')).write_text(newstmt+'\n')
 changes.append({'name':name,'original_body_md5':hashlib.md5(old.encode()).hexdigest(),'proposed_body_md5':hashlib.md5(b.encode()).hexdigest(),'original_body_sha256':hashlib.sha256(old.encode()).hexdigest(),'proposed_body_sha256':hashlib.sha256(b.encode()).hexdigest(),'original_body':old,'proposed_body':b,'rationale':why,'source_path':report['published_inputs'][0]['path'],'abi_header_and_all_statement_suffix_bytes_preserved':True})
for short in ['blob_receipt_v1','receipt_v1','finance_receipt_v1','process_receipt_v1','record_receipt_v1']:
 name='gridex_ediel_retention.'+short;b=functions[name][0]
 b=rep(b,'BEGIN','observed_at timestamptz;BEGIN')
 assert b
 match=re.search(r'SELECT \* INTO (?:k|issuer) FROM gridex_ediel_retention\.issuers[^;]+ FOR SHARE;',b);assert match
 b=rep(b,match[0],match[0]+'\n observed_at:=clock_timestamp();')
 b=b.replace('now()','observed_at')
 put(name,b,'Capture one wall-clock instant after the actual issuer FOR SHARE lock; reuse it for issuer validity, issued/expiry, and fresh journal deadline. Original retainUntil and stored period bounds remain unchanged.')
name='gridex_ediel_retention.record_permission_v1';b=functions[name][0]
b=rep(b,'DECLARE wanted text;BEGIN','DECLARE wanted text;observed_at timestamptz;BEGIN\n LOCK TABLE public.permissions,public.roles,public.user_roles,public.role_permissions,public.user_permissions,public.user_permission_overrides IN SHARE MODE;\n PERFORM public.ediel_retention_lock_auth_actor_v1(actor);\n PERFORM id FROM public.companies WHERE id=c FOR SHARE;\n PERFORM id FROM public.user_profiles WHERE id=actor FOR SHARE;\n PERFORM user_id FROM public.company_memberships WHERE company_id=c AND user_id=actor FOR SHARE;\n observed_at:=clock_timestamp();')
b=b.replace('now()','observed_at')
put(name,b,'Hold actual authorization registry and actor/company/profile/membership rows before capturing fresh grant evaluation time. Evaluate all scheduled allows and denies at the same fresh instant; no direct Auth access or added privilege.')
for short,receipt in [('blob_current_v1','blob_receipt_v1'),('record_current_review_v1','record_receipt_v1')]:
 name='gridex_ediel_retention.'+short;b=functions[name][0];b=rep(b,'claims jsonb;BEGIN','claims jsonb;observed_at timestamptz;BEGIN')
 anchor='claims:=gridex_ediel_retention.'+receipt+'(d);'
 # Earlier review checks may be stale after issuer lock wait; repeat exact existing checks now, all prior locks held.
 conditions=[line.strip() for line in b.splitlines() if line.strip().startswith('IF ') and 'RETURN NULL;END IF;' in line and 'claims' not in line]
 
 if short=='blob_current_v1':conditions.append("IF gridex_ediel_retention.class_permission_v1(d.company_id,r.actor_user_id,d.retention_class) IS NOT TRUE THEN RETURN NULL;END IF;")
 b=rep(b,'claims jsonb;observed_at timestamptz;BEGIN','claims jsonb;observed_at timestamptz;BEGIN\n LOCK TABLE public.permissions,public.roles,public.user_roles,public.role_permissions,public.user_permissions,public.user_permission_overrides IN SHARE MODE;')
 b=rep(b,anchor,anchor+'\n '+ '\n '.join(conditions)+'\n observed_at:=clock_timestamp();')
 b=b.replace('>now()','>observed_at')
 put(name,b,'Refresh separate reviewer authority after receipt/issuer waits with existing review and actor graph locks held; compare retainUntil against fresh captured wall clock.')
# Five mutation gateways: original historical source periods and replay payloads remain unchanged.
name='public.ediel_begin_customer_record_retention_v1';b=functions[name][0]
anchor='claims:=gridex_ediel_retention.record_receipt_v1(d);'
block="""EXECUTE format('SELECT id FROM public.%I WHERE id=$1 AND company_id=$2 FOR UPDATE',spec.source_table) USING d.target_id,p_company_id;
 claims:=gridex_ediel_retention.record_receipt_v1(d);
 PERFORM gridex_ediel_retention.actor_v1(p_company_id,p_actor_user_id,'ediel.retention.purge');
 IF gridex_ediel_retention.record_permission_v1(p_company_id,p_actor_user_id,d.retention_class) IS NOT TRUE THEN RAISE EXCEPTION 'retention_current_record_class_grant_required';END IF;
 r:=gridex_ediel_retention.record_current_review_v1(d);at:=clock_timestamp();
 IF r IS NULL OR claims IS NULL OR (claims->>'retainUntil')::timestamptz>at THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_exact_class_legal_review_deadline']);END IF;"""
b=rep(b,anchor,block);put(name,b,'Acquire actual source row FOR UPDATE before portal/tombstone/redaction effects. Refresh purger and separate review plus receipt after all target/issuer waits; capture effect timestamp then.')
name='public.ediel_purge_artifact_retention_v1';b=functions[name][0]
b=rep(b,"  INSERT INTO gridex_requested_changes.revocations", " END IF;\n"+" PERFORM gridex_ediel_retention.actor_v1(p_company_id,p_actor_user_id,'ediel.retention.purge');\n IF gridex_ediel_retention.class_permission_v1(p_company_id,p_actor_user_id,'requested_change_source_artifact_bytes') IS NOT TRUE THEN RAISE EXCEPTION 'retention_current_class_grant_required';END IF;\n"+" claims:=gridex_ediel_retention.receipt_v1(d);\n"+" IF NOT public.ediel_retention_lock_auth_actor_v1(r.actor_user_id) OR gridex_ediel_retention.permission_v1(p_company_id,r.actor_user_id,'ediel.retention.review') IS NOT TRUE OR gridex_ediel_retention.class_permission_v1(p_company_id,r.actor_user_id,'requested_change_source_artifact_bytes') IS NOT TRUE THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_retention_reviewer_authority']);END IF;\n at:=clock_timestamp();IF r.outcome IS DISTINCT FROM 'approved' OR claims IS NULL OR (claims->>'retainUntil')::timestamptz>at THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_approved_legal_retention_deadline']);END IF;\n IF o.event_id IS NOT NULL THEN\n  INSERT INTO gridex_requested_changes.revocations")
b=b.replace('>now()','>clock_timestamp()');put(name,b,'Refresh purger/reviewer/issuer receipt after actual operational event FOR UPDATE, before revocation or byte purge. Reuse final captured instant for purge metadata.')
name='public.ediel_purge_process_journal_retention_v1';b=functions[name][0]
b=rep(b,'LIMIT 1;IF r.outcome','LIMIT 1 FOR SHARE;IF r.outcome')
anchor=' UPDATE public.customer_portal_accounts'
block=""" SELECT * INTO STRICT spec FROM gridex_ediel_retention.process_class_catalog WHERE retention_class=d.retention_class;
 EXECUTE format('SELECT id FROM gridex_correction_process.%I WHERE id::text=$1 AND company_id=$2 FOR UPDATE',spec.source_table) USING d.target_id,p_company_id;
 PERFORM gridex_ediel_retention.record_actor_v1(p_company_id,p_actor_user_id,'legal_acceptance_personal_snapshot','ediel.retention.purge');
 PERFORM gridex_ediel_retention.record_lock_review_actor_v1(p_company_id,r.actor_user_id);
 p:=gridex_ediel_retention.process_receipt_v1(d);
 PERFORM gridex_ediel_retention.record_actor_v1(p_company_id,p_actor_user_id,'legal_acceptance_personal_snapshot','ediel.retention.purge');
 PERFORM gridex_ediel_retention.record_lock_review_actor_v1(p_company_id,r.actor_user_id);
 at:=clock_timestamp();IF p IS NULL OR (p->>'retainUntil')::timestamptz>at THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_exact_class_legal_deadline']);END IF;
"""
b=rep(b,anchor,block+anchor);put(name,b,'Hold separate review row and actual process source FOR UPDATE before portal effects. Recheck current purger/reviewer and receipt after basis/table/source/issuer waits; capture one final effect time.')
name='public.ediel_purge_finance_copy_retention_v1';b=functions[name][0]
b=rep(b,'cols text;BEGIN','cols text;at timestamptz;BEGIN');b=rep(b,'LIMIT 1;SELECT * INTO STRICT spec','LIMIT 1 FOR SHARE;SELECT * INTO STRICT spec')
old="EXECUTE format('SELECT to_jsonb(x) FROM %I.%I x WHERE %I::text=$1 AND company_id=$2 FOR UPDATE',spec.source_schema,spec.source_table,spec.id_column) INTO oldrow USING d.target_id,p_company_id;"
b=rep(b,old,'')
anchor='LOCK TABLE public.customer_portal_accounts,public.customer_portal_claims IN SHARE ROW EXCLUSIVE MODE;'
review="IF r.outcome IS DISTINCT FROM 'approved' OR r.actor_user_id=d.submitted_by OR public.ediel_retention_lock_auth_actor_v1(r.actor_user_id) IS NOT TRUE OR gridex_ediel_retention.permission_v1(p_company_id,r.actor_user_id,spec.permission_key) IS NOT TRUE OR gridex_ediel_retention.permission_v1(p_company_id,r.actor_user_id,'ediel.retention.review') IS NOT TRUE THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_separate_exact_class_review']);END IF;"
block=anchor+old+"\n PERFORM id FROM public.user_profiles WHERE id=r.actor_user_id FOR SHARE;PERFORM user_id FROM public.company_memberships WHERE company_id=p_company_id AND user_id=r.actor_user_id FOR SHARE;\n p:=gridex_ediel_retention.finance_receipt_v1(d);\n PERFORM gridex_ediel_retention.finance_actor_v1(p_company_id,p_actor_user_id,d.retention_class,'ediel.retention.purge');\n "+review+"\n at:=clock_timestamp();IF p IS NULL OR (p->>'retainUntil')::timestamptz>at THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_exact_class_legal_deadline']);END IF;\n"
b=rep(b,anchor,block);b=b.replace('updated_at=clock_timestamp()','updated_at=at');put(name,b,'Move actual source FOR UPDATE before first portal/tombstone effect; hold separate review row and reviewer profile/membership, refresh receipt and both actors after final waits; portal writes reuse captured time.')
name='public.ediel_purge_decision_evidence_retention_v1';b=functions[name][0]
anchor=' -- Invalidate the consumed original policy'
block=""" PERFORM gridex_ediel_retention.decision_evidence_actor_v1(p_company_id,p_actor_user_id,d.retention_class,'ediel.retention.purge');
 PERFORM gridex_ediel_retention.decision_evidence_lock_reviewer_v1(p_company_id,r.actor_user_id,d.retention_class);
 p:=gridex_ediel_retention.decision_evidence_receipt_v1(d);
 PERFORM gridex_ediel_retention.decision_evidence_actor_v1(p_company_id,p_actor_user_id,d.retention_class,'ediel.retention.purge');
 PERFORM gridex_ediel_retention.decision_evidence_lock_reviewer_v1(p_company_id,r.actor_user_id,d.retention_class);
 at:=clock_timestamp();IF p IS NULL OR (p->>'retainUntil')::timestamptz>at THEN RETURN jsonb_build_object('status','held','policyId',d.id,'missing',ARRAY['current_exact_original_deadline']);END IF;
"""
b=rep(b,anchor,block+anchor);put(name,b,'Actual source basis obtains source FOR UPDATE after earlier checks. Refresh exact-class purger/reviewer and receipt after this wait, before consuming original policy; existing post-revocation receipt check retained.')
assert len(changes)==13
manifest={'status':'PRIVATE_NEW_RECONSTRUCTION_PROPOSAL_NOT_APPLIED_NOT_FROZEN_A6','source_sha256':report['published_inputs'][0]['sha256'],'changes':changes,'unchanged_historical_guard':'gridex_ediel_retention.record_c40a67d5fa7766230451_guard_v1','requires':['independent full body/source review','complete-state body hash synchronization','genuine PostgreSQL qualification and late rollback','native applicability readback before installation']}
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
(OUT/'proposal.sql').write_text('-- PRIVATE new reconstruction proposal; not frozen A6, not applied.\n'+'\n'.join((OUT/(c['name']+'.proposed-create.sql')).read_text() for c in changes))
print(json.dumps({'count':len(changes),'manifest_sha256':hashlib.sha256((OUT/'manifest.json').read_bytes()).hexdigest(),'proposal_sha256':hashlib.sha256((OUT/'proposal.sql').read_bytes()).hexdigest(),'bodies':[{k:c[k] for k in ['name','original_body_md5','proposed_body_md5']} for c in changes]},indent=2))
