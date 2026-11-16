"""Fixed original-four EDIEL native observations. Import performs no I/O.

Only the sole producer calls these ports. SQL is own-DB READ ONLY/8s/5s;
three role-sensitive getters use a genuine current service JWT at owned REST.
No role/JWT/GUC fabrication, fixture DML, retry or original-case verdict.
"""
import hashlib, http.client, importlib.util, json, os, pathlib, re, time

P = pathlib.Path(__file__).parent
ROOT = pathlib.Path('/tmp/gridex-ediel-four-case-actual-20261116-b')
DB = 'gridex_local_partner_http_20261113_a'
A = 'b36f6a30-18cd-4a70-8652-5b2da9b4eb64'
EE = 'ee029de5-22a8-4916-9c36-388d13f19cb1'
USER = 'ediel-four-owned-20261116-a@fixture.invalid'
CASES = ('WRONG_PARTY', 'SMTP_451', 'SMTP_550', 'SMTP_DROP_DATA')
CAP = 8 * 1024 * 1024
CORE_SHA = '71f78c9405ad51da6d24a22fa1a9484f088ff0f0cda09e5df3d1d60186382595'
UUID = re.compile(r'^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$')
SAFE = re.compile(r'^[a-z_][a-z0-9_]*$')
GETTERS = {
 'gridex_read_utilts_issuer_identity_authority_v1': ('p_company_id','p_message_id'),
 'ediel_read_technical_source_endpoint_v2': ('p_source_message_id','p_actor_user_id','p_phase'),
 'ediel_read_persisted_technical_contrl_basis_v2': ('p_company_id','p_environment','p_ack_message_id','p_actor_user_id','p_phase'),
}
GETTER_MD5 = ('2274f10079a350313054093c8096f3c3','ca9ddbe67589e9324fec89c6f23a265f','c8232f5ed82a0630570eebe7d7830b0b')

# The full522 table catalog is taken from the actual qualified clone snapshot.
# These finite exceptions have full old/new row witnesses below; no company-only
# or regex table exemption exists. All other522 and all386 private hashes match.
PUBLIC_PHASES = {
 'receiver_issue': {'public.tenant_actor_identifiers','public.tenant_actor_roles','public.tenant_ediel_profiles','gridex_controlled_test_receiver.registrations'},
 'routes': {'public.communication_routes','public.ediel_route_profiles','public.ediel_agt_readiness','public.ediel_retest_invalidations','public.audit_logs','public.ediel_route_history','public.ediel_configuration_snapshots','public.company_provisioning_jobs','public.ediel_test_runs','public.actor_test_results','public.ediel_production_readiness_checks','public.ediel_go_live_events','public.ediel_production_state'},
 'mailbox': {'public.ediel_mailboxes'},
 'poll': {'public.ediel_mailboxes','public.inbound_email_messages','public.inbound_processing_jobs'},
 'sources': {'public.inbound_email_messages','public.inbound_processing_jobs','public.inbound_ediel_parse_results','public.inbound_ediel_match_attempts','public.ediel_messages','public.ediel_message_events','public.ediel_business_references'},
 'contrl': {'public.ediel_messages','public.ediel_message_events','public.ediel_outbox','public.ediel_business_references'},
 'smtp': {'public.ediel_outbox','public.ediel_messages','public.ediel_message_events','public.ediel_message_payloads','storage.objects'},
}
PRIVATE_EXTRA = {
 'sources': {'gridex_unattributed_intake.parse_births','gridex_ediel_common_header.sources','gridex_ediel_inbound_context.receipts'},
 'contrl': {'gridex_ediel_inbound_context.receipts','gridex_ediel_common_header.negative_witnesses','gridex_ediel_common_header.negative_route_bindings','gridex_ediel_common_header.negative_consumptions','gridex_ediel_ack_guide.source_bindings','gridex_ediel_ack_guide.outbound_prodat_scopes'},
 'smtp': {'gridex_ediel_transport.reconciliation_cases','gridex_ediel_transport.reconciliation_case_events'},
}
EXTRA_LINKS = {
 'gridex_unattributed_intake.parse_births': ('inbound_email_message_id','emailIds'),
 'gridex_ediel_common_header.sources': ('source_message_id','sourceIds'),
 'gridex_ediel_inbound_context.receipts': ('source_message_id','messageIds'),
 'gridex_ediel_common_header.negative_witnesses': ('source_message_id','sourceIds'),
 'gridex_ediel_common_header.negative_route_bindings': ('witness_id','headerWitnessIds'),
 'gridex_ediel_common_header.negative_consumptions': ('ack_message_id','ackIds'),
 'gridex_ediel_ack_guide.source_bindings': ('source_message_id','sourceIds'),
 'gridex_ediel_ack_guide.outbound_prodat_scopes': ('ack_message_id','ackIds'),
 'gridex_ediel_transport.reconciliation_cases': ('message_id','ackIds'),
 'gridex_ediel_transport.reconciliation_case_events': ('case_id','reconciliationIds'),
}
CONFIG_MUTABLE = {
 'public.ediel_test_runs': {'is_stale','stale_reason','stale_at'},
 'public.actor_test_results': {'is_stale','stale_reason','updated_at'},
 'public.ediel_production_readiness_checks': {'is_stale','stale_reason'},
 'public.ediel_go_live_events': {'is_stale','stale_reason'},
 'public.ediel_production_state': {'configuration_snapshot_id','updated_at'},
}

def _config_columns(key,before,after,ids):
 fields=CONFIG_MUTABLE[key]
 project=lambda r:{k:v for k,v in r.items() if k not in fields}
 need(len(before)==len(after),'NORMAL_CONFIGURATION_UPDATE_NEVER_ADDS_OR_DELETES_ROWS')
 for old in before:
  matches=[r for r in after if project(r)==project(old)]
  need(len(matches)==1,'NORMAL_CONFIGURATION_ALL_OTHER_COLUMNS_EXACT')
  row=matches[0]
  if row==old:continue
  need(old.get('company_id')==A,'NO_FOREIGN_CONFIGURATION_UPDATE')
  if key=='public.ediel_production_state':
   need(row.get('configuration_snapshot_id') in ids.get('configurationSnapshotIds',[]),'ONLY_ACTUAL_NEW_CONFIGURATION_SNAPSHOT_REFERENCE')
  else:
   need(row.get('is_stale') is True and row.get('stale_reason')=='configuration_changed','ONLY_NORMAL_CONFIGURATION_STALE_FIELDS')
   if key=='public.ediel_test_runs':need(old.get('completed_at') is not None,'ONLY_COMPLETED_TEST_RUNS_BECOME_STALE')
   if key=='public.ediel_go_live_events':need(old.get('event_type')=='production_dry_run','ONLY_EXISTING_DRY_RUN_STALE_MARKER')

def need(value, message):
 if not value: raise AssertionError(message)

def sha(value): return hashlib.sha256(value).hexdigest()
def canon(value): return json.dumps(value, sort_keys=True, separators=(',',':'), ensure_ascii=False)
def uid(value):
 need(isinstance(value,str) and UUID.fullmatch(value), 'ACTUAL_UUID_REQUIRED')
 return "'"+value+"'::uuid"

def table(value):
 parts=value.split('.')
 need(len(parts)==2 and all(SAFE.fullmatch(x) for x in parts), 'FIXED_SAFE_TABLE_IDENTIFIER')
 return '.'.join('"'+x+'"' for x in parts)

def load_core():
 path=P/'four-case-native.v3.py'; review=P/'qa-FOUR-NATIVE-CORE-V3-SOURCE-REVIEW.safe.json'
 need(path.is_file() and not path.is_symlink() and sha(path.read_bytes())==CORE_SHA, 'QUALIFIED_CORE_V3_PIN')
 r=json.loads(review.read_bytes())
 need(r['reviewerAgent']=='/root/qa_remaining_checks' and r['entry']['sha256']==CORE_SHA and r['verdict']=='SOURCE_APPROVE_NARROW_CAPTURE_WITNESS_CORE_UNARMED', 'REAL_QA_CORE_V3_REVIEW')
 spec=importlib.util.spec_from_file_location('qualified_four_native_v3',path)
 mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
 return mod

def sql(rt, query):
 need(callable(rt.get('sql')), 'QUALIFIED_OWN_READONLY_SQL_PORT')
 raw=rt['sql'](DB,"BEGIN READ ONLY;SET LOCAL statement_timeout='8s';SET LOCAL lock_timeout='5s';"+query+';ROLLBACK;')
 data=raw.encode() if isinstance(raw,str) else raw
 need(isinstance(data,bytes) and len(data)<=CAP, 'BOUNDED_NATIVE_JSON')
 return json.loads(data)

def read_ref(ref, own=False):
 path=pathlib.Path(ref['path'])
 need(path.is_absolute() and path.resolve()==path and path.is_file() and not path.is_symlink() and path.stat().st_size<=CAP, 'REAL_BOUNDED_REF')
 if own: need(str(path).startswith(str(ROOT)+'/') and path.stat().st_mode&511==384,'OWN_MODE600_REF')
 data=path.read_bytes(); need(sha(data)==ref['sha256'],'ACTUAL_REF_HASH')
 return json.loads(data)

def actor(rt):
 value=rt.get('actorReadyProof')
 if isinstance(value,dict) and 'path' in value: value=read_ref(value,True)
 need(isinstance(value,dict) and value.get('state')=='GENUINE_HEADLESS_FOUR_CASE_ACTOR_READY' and value.get('actorId')==EE and value.get('companyId')==A, 'ACTUAL_WORKER_READY_PROOF')
 u=read_ref(value['getUser'],True); c=read_ref(value['canonicalAccess'],True); s=read_ref(value['privateSession'],True)
 d=c.get('data',{})
 need(u.get('error') is None and u.get('user',{}).get('id')==EE and c.get('error') is None and d.get('user_id')==EE and d.get('selected_company_id')==A and d.get('authorized') is True and d.get('access_invariant_ok') is True and d.get('is_platform_admin') is True, 'REAL_GETUSER_AND_CANONICAL_COMPANY')
 need(s.get('user_id')==EE and s.get('expires_at',0)>time.time() and s.get('session_id'), 'ACTUAL_REAL_SESSION_STILL_FINITE')
 return EE

def rpc(rt, name, args):
 actor(rt)
 need(name in GETTERS and set(args)==set(GETTERS[name]), 'EXACT_PROTECTED_RPC_SIGNATURE')
 need(args.get('p_actor_user_id',EE)==EE and args.get('p_company_id',A)==A and args.get('p_environment','test')=='test', 'REAL_ACTOR_AND_TENANT_PROTECTED_GETTER')
 need(re.fullmatch(r'172\.\d{1,3}\.\d{1,3}\.\d{1,3}',rt['restIP']) and rt['restPort']==3000 and re.fullmatch(r'[a-f0-9]{64}',rt['restId']), 'EXACT_OWN_REST_CID_IP')
 keys=rt['serverKeys']; token=keys['serviceRoleKey']
 need(isinstance(token,str) and token.count('.')==2,'GENUINE_CURRENT_SERVICE_CARRIER')
 body=json.dumps(args).encode(); conn=http.client.HTTPConnection(rt['restIP'],3000,timeout=15)
 try:
  conn.request('POST','/rpc/'+name,body,{'Authorization':'Bearer '+token,'apikey':token,'Content-Type':'application/json','Accept':'application/json'})
  r=conn.getresponse(); raw=r.read(CAP+1)
  need(r.status==200 and len(raw)<=CAP,'REAL_SERVICE_GETTER_RESPONSE_NO_RETRY')
  return json.loads(raw)
 finally: conn.close()

def persist(rt, name, value):
 need(re.fullmatch(r'[a-z0-9.-]+',name) and callable(rt.get('save')), 'QUALIFIED_OWN_EVIDENCE_SAVE_PORT')
 raw=(json.dumps(value,indent=2)+'\n').encode(); need(len(raw)<=CAP,'BOUNDED_PHASE_ARTIFACT')
 path=ROOT/('semantic-'+name+'.private.json'); rt['save'](path,value)
 need(path.is_file() and not path.is_symlink() and path.stat().st_mode&511==384, 'DURABLE_OWN_PHASE_EVIDENCE')
 return {'path':str(path),'sha256':sha(path.read_bytes())}

def _rows(rt, tables):
 keys=sorted(tables);allowed=set().union(*PHASE_PUBLIC_TABLES.values(),*PHASE_PRIVATE_TABLES.values())
 need(len(keys)<=64 and len(set(keys))==len(keys) and set(keys)<=allowed,'FINITE_EXACT_PHASE_ROW_CATALOG')
 output={};core=load_core()
 for i in range(0,len(keys),50):output.update(core.capture_changed_rows(rt,keys[i:i+50]))
 need(len(json.dumps(output).encode())<=CAP,'BOUNDED_COMBINED_PHASE_ROW_ARTIFACT')
 return output

def _maps(rt):
 keys=sorted(rt['cloneBefore']['rows'])
 need(len(keys)==522 and len(set(keys))==522,'EXACT_QUALIFIED_522_CATALOG')
 parts=[]
 for key in keys:
  rows="coalesce(jsonb_agg(to_jsonb(v) ORDER BY to_jsonb(v)::text),'[]'::jsonb)"
  parts.append("SELECT '"+key+"' k,jsonb_build_object('count',count(*),'sha256',encode(sha256(convert_to("+rows+"::text,'UTF8')),'hex')) v FROM "+table(key)+' v')
 return sql(rt,"SELECT jsonb_object_agg(k,v) FROM ("+' UNION ALL '.join(parts)+') closed_catalog')

def _all_candidates(core):
 return set().union(*PUBLIC_PHASES.values(),*core.PRIVATE_PHASES.values(),*PRIVATE_EXTRA.values())

def _decorate(rt, value):
 ctx=rt['_fourSemantic']; actual=_maps(rt)
 value['financial']={k:v for k,v in actual.items() if k not in ctx['mutable522']}
 need(value['financial']==ctx['financial'],'ALL_NONEXCEPTED_522_TABLES_UNCHANGED')
 return value

def pre_auth(rt):
 core=load_core(); p=core.prerequisites(rt)
 need(p['database']==DB and p['queueRows']==0 and p['functionCount']==3443,'PRISTINE_OWN_QUEUE_3443')
 checks=sql(rt,"SELECT jsonb_build_object('claimBodyMD5',md5((SELECT prosrc FROM pg_proc WHERE oid='public.claim_inbound_processing_jobs(text,integer,text,interval)'::regprocedure)),'queueRowsFull',(SELECT coalesce(jsonb_agg(to_jsonb(v)),'[]') FROM public.inbound_processing_jobs v),'getterBodies',(SELECT jsonb_agg(jsonb_build_object('name',p.proname,'bodyMD5',md5(p.prosrc),'argumentNames',p.proargnames) ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('gridex_read_utilts_issuer_identity_authority_v1','ediel_read_technical_source_endpoint_v2','ediel_read_persisted_technical_contrl_basis_v2')))")
 need(checks['claimBodyMD5']=='63dde69fa26d48381b510aa2837a5627' and checks['queueRowsFull']==[],'EXACT_CLAIM_AND_ZERO_TOTAL_JOBS')
 need({x['bodyMD5'] for x in checks['getterBodies']}==set(GETTER_MD5) and len(checks['getterBodies'])==3,'PROTECTED_THREE_NATIVE_PREIMAGES')
 p.update(checks); p['state']='ACTUAL_FOUR_CASE_NATIVE_PREREQUISITES'; receiver_before(rt); p['unknownPartyBefore']=unknown_party_before(rt); p['freshRLS']=fresh_rls(rt)
 return p

def receiver_before(rt):
 q="""SELECT jsonb_build_object(
 'global99003',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (
 SELECT 'tenant' scope,to_jsonb(v) row FROM public.tenant_actor_identifiers v WHERE identifier_type='EdielId' AND identifier_value='99003'
 UNION ALL SELECT 'platform',to_jsonb(v) FROM public.platform_actor_identifiers v WHERE identifier_type='EdielId' AND identifier_value='99003')x),
 'currentConflicts',(SELECT coalesce(jsonb_agg(to_jsonb(v)),'[]') FROM gridex_controlled_test_receiver.registrations v WHERE company_id='COMPANY'::uuid AND expires_at>clock_timestamp() AND NOT EXISTS(SELECT FROM gridex_controlled_test_receiver.revocations r WHERE r.registration_id=v.id)),
 'profileConflicts',(SELECT count(*) FROM public.tenant_ediel_profiles WHERE company_id='COMPANY'::uuid AND environment='test' AND is_enabled AND valid_from<=clock_timestamp() AND(valid_to IS NULL OR valid_to>clock_timestamp())),
 'identifierConflicts',(SELECT count(*) FROM public.tenant_actor_identifiers WHERE company_id='COMPANY'::uuid AND environment='test' AND valid_from<=clock_timestamp() AND(valid_to IS NULL OR valid_to>clock_timestamp())),
 'roleConflicts',(SELECT count(*) FROM public.tenant_actor_roles WHERE company_id='COMPANY'::uuid AND environment='test' AND valid_from<=clock_timestamp() AND(valid_to IS NULL OR valid_to>clock_timestamp())),
 'relationConflicts',(SELECT count(*) FROM public.tenant_counterparty_relations WHERE company_id='COMPANY'::uuid AND environment='test' AND relation_type='ediel_transport_agent' AND is_enabled AND valid_from<=clock_timestamp() AND(valid_to IS NULL OR valid_to>clock_timestamp())))""".replace('COMPANY',A)
 value=sql(rt,q)
 need(value['global99003']==[] and value['currentConflicts']==[] and all(value[k]==0 for k in ['profileConflicts','identifierConflicts','roleConflicts','relationConflicts']),'ACTUAL_ISSUE_ONLY_UNUSED_NAMESPACE_AND_NO_CURRENT_CONFLICT')
 return value

def unknown_party_before(rt):
 # The declared formatter uses NAD+MS+99103:SVK:260 and UNB sender99103.
 # A zero result over this broader first-component universe proves the exact
 # pair has no current approved issuer/mandate; no positive issuer is created.
 value=sql(rt,"""SELECT coalesce(jsonb_agg(jsonb_build_object('namespace',to_jsonb(n),'issuer',to_jsonb(i),'mandate',to_jsonb(m))),'[]')
 FROM gridex_utilts_issuer.issuer_versions i
 JOIN gridex_utilts_issuer.namespaces n ON n.id=i.namespace_id
 JOIN gridex_utilts_issuer.transport_mandate_versions m ON m.issuer_version_id=i.id
 WHERE n.environment='test' AND i.legal_identity->>0='99103' AND m.transport_sender->>0='99103'
 AND i.approved_at<=clock_timestamp() AND m.approved_at<=clock_timestamp()
 AND i.valid_from<=clock_timestamp() AND(i.valid_until IS NULL OR clock_timestamp()<i.valid_until)
 AND m.valid_from<=clock_timestamp() AND(m.valid_until IS NULL OR clock_timestamp()<m.valid_until)
 AND NOT EXISTS(SELECT FROM gridex_utilts_issuer.revocations r WHERE r.namespace_id=n.id AND(r.issuer_version_id=i.id OR r.mandate_version_id=m.id)AND r.approved_at<=clock_timestamp() AND r.effective_at<=clock_timestamp())""")
 need(value==[],'DECLARED_UNKNOWN_99103_CURRENT_NATIVE_ISSUER_PAIR_NOT_EMPTY')
 return {'senderEdielId':'99103','matchingCurrentIssuerMandates':value,'scope':'native current TEST legal/transport first-components; superset of exact formatter identity'}

def fresh_rls(rt):
 root=pathlib.Path('/tmp/gridex-four-cohort-native-prereq-prep-20261116-a')
 pairs=(('PROFILE-RLS-GRANTS.v2.READONLY.sql','MAIN-PROFILE-RLS-GRANTS.private.json'),('COMMUNICATION-ROUTE-RLS-GRANTS.READONLY.sql','MAIN-COMMUNICATION-ROUTE-RLS-GRANTS.private.json'))
 result=[]
 for queryFile,factFile in pairs:
  # Exact source files and hashes are additionally bound in this component's
  # immutable freeze/outer target before any invocation.
  q=(root/queryFile).read_text(); need('statement_timeout' in q and 'lock_timeout' in q,'FIXED_READONLY_RLS_SOURCE');q=q if q.lstrip().upper().startswith('BEGIN READ ONLY;') else 'BEGIN READ ONLY;'+q+';ROLLBACK;'
  raw=rt['sql'](DB,q); raw=raw.encode() if isinstance(raw,str) else raw
  need(isinstance(raw,bytes) and len(raw)<=CAP,'BOUNDED_CURRENT_RLS_RESULT')
  actual=json.loads(raw); expected=json.loads((root/factFile).read_bytes())
  need(actual['database']==DB and {k:v for k,v in actual.items() if k!='database'}=={k:v for k,v in expected.items() if k!='database'},'OWN_CLONE_NORMAL_AUTHENTICATED_RLS_GRANTS_COLUMNS_MATCH')
  result.append(actual)
 return result

def baseline(rt):
 need('_fourSemantic' not in rt,'ONE_BASELINE_BEFORE_NATIVE_BUSINESS')
 core=load_core(); maps=_maps(rt); mutable522=set().union(*PUBLIC_PHASES.values())
 rt['_fourSemantic']={'core':core,'mutable522':mutable522,'financial':{k:v for k,v in maps.items() if k not in mutable522},'index':0,'ids':{},'pending':{},'mailbox':None}
 value=core.capture(rt); need(value['allJobs']==[],'BASELINE_QUEUE0');rt['_fourSemantic']['baselineMail']=value
 return _decorate(rt,value)

def _delta(core, before, after, pred, mutable=False):
 old=list(before); new=list(after); remain=[canon(x) for x in new]
 for row in old:
  enc=canon(row)
  if enc in remain: remain.remove(enc); continue
  need(mutable and pred(row) and any(v.get('id')==row.get('id') for v in new),'OLD_FOREIGN_ROW_CHANGE_OR_DELETE')
 for raw in remain: need(pred(json.loads(raw)),'NEW_ROW_WITHOUT_EXACT_OWN_LINEAGE')
 return {'old':len(old),'new':len(new),'oldForeignRowsExact':True,'appendOnly':not mutable}

def _public_pred(key, ids):
 def pred(row):
  if row.get('company_id') is not None and row['company_id']!=A:return False
  if key=='public.ediel_agt_readiness':return row.get('company_id')==A
  if key in CONFIG_MUTABLE:return row.get('company_id')==A
  if key=='public.ediel_route_history':return row.get('route_profile_id') in ids.get('routeProfileIds',[]) and row.get('created_by')==EE and row.get('change_reason')=='created'
  if key=='public.ediel_configuration_snapshots':return row.get('id') in ids.get('configurationSnapshotIds',[]) and row.get('company_id')==A and row.get('created_by')==EE and row.get('reason')=='ediel_route_profiles_changed' and row.get('payload',{}).get('company',{}).get('id')==A and any(x.get('id') in ids.get('routeProfileIds',[]) for x in row.get('payload',{}).get('routes',[]))
  if key=='public.company_provisioning_jobs':return row.get('company_id')==A and row.get('job_key')=='ediel_readiness_revalidate' and row.get('status')=='pending' and row.get('idempotency_key') in ids.get('configurationSnapshotIds',[])
  if key=='public.audit_logs':return row.get('entity_id') in ids.get('routeIds',[]) and row.get('actor_user_id')==EE and row.get('action')=='ediel_agt_retest_required'
  if key=='public.ediel_retest_invalidations':return row.get('source_id') in ids.get('routeIds',[]) and row.get('created_by')==EE and row.get('source_type')=='route_change'
  if key=='storage.objects':
   return row.get('bucket_id')=='ediel-files' and any(re.fullmatch('transport/'+A+'/'+x+r'/[a-f0-9]{64}\.eml',row.get('name','')) for x in ids.get('ackIds',[]))
  links={
   'public.tenant_actor_identifiers':('id','identifierIds'),'public.tenant_actor_roles':('id','roleIds'),'public.tenant_ediel_profiles':('id','profileIds'),'gridex_controlled_test_receiver.registrations':('id','registrationIds'),
   'public.communication_routes':('id','routeIds'),'public.ediel_route_profiles':('id','routeProfileIds'),'public.ediel_mailboxes':('id','mailboxIds'),'public.inbound_email_messages':('id','emailIds'),'public.inbound_processing_jobs':('id','jobIds'),
   'public.inbound_ediel_parse_results':('inbound_email_message_id','emailIds'),'public.inbound_ediel_match_attempts':('inbound_email_message_id','emailIds'),'public.ediel_messages':('id','messageIds'),'public.ediel_message_events':('ediel_message_id','messageIds'),'public.ediel_outbox':('id','outboxIds'),'public.ediel_business_references':('source_message_id','messageIds'),'public.ediel_message_payloads':('ediel_message_id','ackIds'),
  }
  need(key in links,'NO_GENERIC_PUBLIC_MUTATION_EXCEPTION'); column,n=links[key]
  return row.get(column) in ids.get(n,[])
 return pred

def _phase(rt, phase, ids):
 # Native semantic methods record only actual observed parent IDs here.
 # The outer calls phase_witness AFTER the whole phase; no duplicate full
 # snapshot/private capture and no false claim of an already-performed fence.
 ctx=rt['_fourSemantic']
 for key, values in ids.items():
  need(isinstance(values,list) and all(isinstance(v,str) and UUID.fullmatch(v) for v in values),'ACTUAL_OBSERVED_NATIVE_IDS_ONLY')
  ctx['pending'].setdefault(key,[])
  ctx['pending'][key]=sorted(set(ctx['pending'][key])|set(values))
 return {'state':'OUTER_PHASE_WITNESS_STILL_REQUIRED','phase':phase,'actualIDs':ids}

def _capture(rt, mailbox_id=None):
 value=rt['_fourSemantic']['core'].capture(rt,mailbox_id)
 return _decorate(rt,value)

def receiver_issued(rt, normalReturn):
 actor(rt); registration=uid(normalReturn['registrationId'])
 value=sql(rt,"SELECT jsonb_build_object('receiver',(SELECT gridex_controlled_test_receiver.receipt_v1(r) FROM gridex_controlled_test_receiver.registrations r WHERE id="+registration+"),'registration',(SELECT to_jsonb(r) FROM gridex_controlled_test_receiver.registrations r WHERE id="+registration+"),'current99003Matches',(SELECT count(*) FROM gridex_controlled_test_receiver.registrations r WHERE receiver_ediel_id='99003' AND expires_at>clock_timestamp() AND NOT EXISTS(SELECT FROM gridex_controlled_test_receiver.revocations v WHERE v.registration_id=r.id)))")
 r=value['registration']; need(r and r['company_id']==A and r['issued_by']==EE and value['receiver']==normalReturn and value['current99003Matches']==1,'ACTUAL_C6_RECEIPT_GRAPH_PRODUCT_ACTOR_AND_ISSUER')
 ids={'registrationIds':[r['id']],'identifierIds':[r['identifier_id']],'roleIds':[r['role_id']],'profileIds':[r['profile_id']]}
 value['phaseFence']=_phase(rt,'receiver_issue',ids);rt['_fourSemantic']['registration']=r
 out=_capture(rt);out.update({'receiver':value['receiver'],'receiverIssuedBy':r['issued_by'],'current99003Matches':value['current99003Matches']});return out

def routes(rt, normalReturn):
 actor(rt); need(isinstance(normalReturn,list) and len(normalReturn)==3,'THREE_ACTUAL_RETURNED_ROUTE_PAIRS')
 output=[]
 for i,x in enumerate(normalReturn):
  need(x['caseName']==CASES[i+1],'EXACT_ROUTE_CASE_ORDER')
  item=sql(rt,"SELECT jsonb_build_object('caseName','"+CASES[i+1]+"','route',(SELECT to_jsonb(v) FROM public.communication_routes v WHERE id="+uid(x['route']['id'])+"),'profile',(SELECT to_jsonb(v) FROM public.ediel_route_profiles v WHERE id="+uid(x['profile']['id'])+'))')
  need(item['route']==x['route'] and item['profile']==x['profile'],'ACTUAL_ROUTE_AND_PROFILE_RETURN_READBACK');output.append(item)
 ids={'routeIds':[x['route']['id'] for x in output],'routeProfileIds':[x['profile']['id'] for x in output]}
 cfg=sql(rt,"SELECT coalesce(jsonb_agg(v.id),'[]') FROM public.ediel_configuration_snapshots v WHERE company_id="+uid(A)+" AND reason='ediel_route_profiles_changed' AND EXISTS(SELECT FROM jsonb_array_elements(v.payload->'routes') r WHERE r->>'id' IN("+','.join("'"+x+"'" for x in ids['routeProfileIds'])+'))');ids['configurationSnapshotIds']=cfg
 _phase(rt,'routes',ids); rt['_fourSemantic']['routes']=output
 out=_capture(rt);out['routes']=output;return out

def capture(rt, mailbox_id):
 ctx=rt['_fourSemantic']; core=ctx['core']; value=core.capture(rt,mailbox_id)
 if ctx['mailbox'] is None:
  need(value['mailbox'] and value['mailbox']['company_id'] is None and value['mailbox']['email_address']==USER and value['ownEmails']==[] and value['allJobs']==[],'ONE_NORMAL_NEW_EMPTY_SHARED_MAILBOX');core.mailbox_ack(ctx['baselineMail'],value)
  _phase(rt,'mailbox',{'mailboxIds':[mailbox_id]});ctx['mailbox']=mailbox_id;ctx['ids']['mailboxIds']=[mailbox_id]
 elif not ctx.get('polled') and value['ownEmails']:
  need(ctx['mailbox']==mailbox_id and len(value['ownEmails'])==len(value['allJobs'])==4,'EXACT_FOUR_OWN_POLL_ROWS')
  ids={'mailboxIds':[mailbox_id],'emailIds':[x['id'] for x in value['ownEmails']],'jobIds':[x['id'] for x in value['allJobs']]}
  need(all(x['mailbox_id']==mailbox_id and x['inbound_email_message_id'] in ids['emailIds'] for x in value['allJobs']),'EXACT_FOUR_OWN_JOB_PARENTS')
  _phase(rt,'poll',ids);ctx['ids'].update(ids);ctx['polled']=True
 else: need(ctx['mailbox']==mailbox_id,'ACTUAL_OWN_MAILBOX_ONLY')
 return _decorate(rt,value)

def sources(rt, mailbox_id, payloadRefs):
 actor(rt); ctx=rt['_fourSemantic']; value=ctx['core'].capture(rt,mailbox_id)
 need(len(payloadRefs)==len(value['sources'])==4,'FOUR_ACTUAL_RETAINED_SOURCES')
 ordered=[]
 for i,p in enumerate(payloadRefs):
  need(p['caseName']==CASES[i],'EXACT_PHYSICAL_CASE_ORDER')
  own=[s for s in value['sources'] if sha((s.get('raw_payload') or '').encode())==p['source']['sha256']]
  need(len(own)==1 and own[0]['company_id']==A and own[0]['direction']=='inbound' and own[0]['environment']=='test','REAL_RETAINED_HASHED_SOURCE');ordered.append(own[0])
 unknown=ordered[0]; authority=rpc(rt,'gridex_read_utilts_issuer_identity_authority_v1',{'p_company_id':A,'p_message_id':unknown['id']})
 admission=sql(rt,'SELECT to_jsonb(v) FROM gridex_utilts_issuer.source_admissions v WHERE source_message_id='+uid(unknown['id'])+' AND company_id='+uid(A))
 need(authority and authority['sourceMessageId']==unknown['id'] and authority['sourcePayloadHash']==payloadRefs[0]['source']['sha256'] and authority['status']=='held' and authority['holdReason']=='ediel_utilts_foreign_issuer_basis_unavailable' and admission and all(admission[k] is None for k in ['namespace_id','issuer_version_id','mandate_version_id']),'TARGETED_NATIVE_UNKNOWN_ISSUER_HOLD')
 ids={**ctx['ids'],'sourceIds':[s['id'] for s in ordered],'messageIds':[s['id'] for s in ordered]}
 _phase(rt,'sources',ids);ctx['ids'].update(ids);ctx['sources']=ordered
 value.update({'sources':ordered,'wrongPartyAuthority':authority,'wrongPartyAdmission':admission});return _decorate(rt,value)

def contrl(rt, mailbox_id, sources, routes):
 actor(rt); ctx=rt['_fourSemantic']; sources=sources['sources'] if isinstance(sources,dict) else sources; routes=routes['routes'] if isinstance(routes,dict) else routes; original=[x.get('message',x) for x in sources]
 need(len(original)==4 and len(routes)==3,'ACTUAL_THREE_PRODAT_PARENTS')
 own=sql(rt,"SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY id),'[]') FROM public.ediel_messages v WHERE direction='outbound' AND company_id="+uid(A)+" AND environment='test' AND related_message_id IN("+','.join(uid(x['id']) for x in original[1:])+')')
 cases=[]
 for i,s in enumerate(original[1:]):
  msgs=[m for m in own if m['related_message_id']==s['id'] and m['message_family']=='CONTRL'];need(len(msgs)==1,'ONE_ACTUAL_NORMAL_CONTRL_PER_SOURCE');m=msgs[0]
  basis=rpc(rt,'ediel_read_persisted_technical_contrl_basis_v2',{'p_company_id':A,'p_environment':'test','p_ack_message_id':m['id'],'p_actor_user_id':EE,'p_phase':'prepare'})
  endpoint=rpc(rt,'ediel_read_technical_source_endpoint_v2',{'p_source_message_id':s['id'],'p_actor_user_id':EE,'p_phase':'prepare'})
  need(basis and basis.get('ackMessage')==m and basis.get('executionActorUserId')==EE and endpoint and endpoint.get('sourceMessageId')==s['id'] and endpoint.get('companyId')==A,'REAL_CURRENT_NATIVE_SYNTAX_AND_ENDPOINT_GETTERS')
  syntax=basis['technicalSyntaxAckEvidence'];need(syntax['sourceMessageId']==s['id'] and syntax['sourceHash']==sha(s['raw_payload'].encode()) and syntax['syntaxDecision']=='accepted','ACTUAL_COMMITTED_ACCEPTED_SYNTAX')
  boxes=sql(rt,'SELECT coalesce(jsonb_agg(to_jsonb(v)),\'[]\') FROM public.ediel_outbox v WHERE ediel_message_id='+uid(m['id']));need(len(boxes)==1,'ONE_NATIVE_TECHNICAL_OUTBOX')
  cases.append({'caseName':CASES[i+1],'sourceId':s['id'],'syntax':syntax,'technicalEndpoint':endpoint,'message':m,'outbox':boxes[0],'persistedTechnicalBasis':basis})
 allBoxes=sql(rt,"SELECT coalesce(jsonb_agg(to_jsonb(v)),'[]') FROM public.ediel_outbox v WHERE ediel_message_id IN("+','.join(uid(x['id']) for x in own)+')');need(all(x['company_id']==A and x['ediel_message_id'] in {m['id'] for m in own} for x in allBoxes),'ONLY_ACTUAL_NORMAL_ACK_OUTBOXES_INCLUDING_UNSENT_APERAK')
 ids={**ctx['ids'],'sourceIds':[s['id'] for s in original[1:]],'messageIds':[s['id'] for s in original[1:]]+[m['id'] for m in own],'ackIds':[m['id'] for m in own],'outboxIds':[x['id'] for x in allBoxes]}
 ids['headerWitnessIds']=sql(rt,"SELECT coalesce(jsonb_agg(id),'[]') FROM gridex_ediel_common_header.negative_witnesses WHERE company_id="+uid(A)+" AND environment='test' AND source_message_id IN("+','.join(uid(x['id']) for x in original[1:])+')')
 _phase(rt,'contrl',ids);ctx['contrlCases']=cases;ctx['ids'].update(ids)
 value=ctx['core'].capture(rt,mailbox_id);value['contrlCases']=cases;return _decorate(rt,value)

def smtp(rt, caseName, contrlCase, storageEvidence, physicalEvidence, baselineEvidence=None):
 actor(rt);ctx=rt['_fourSemantic'];need(caseName in CASES[1:] and contrlCase['caseName']==caseName and physicalEvidence['caseName']==caseName,'EXACT_ACTUAL_SMTP_CASE')
 mid=contrlCase['message']['id']; oid=contrlCase['outbox']['id']
 value=sql(rt,"SELECT jsonb_build_object('outbox',(SELECT to_jsonb(v) FROM public.ediel_outbox v WHERE id="+uid(oid)+"),'attempts',(SELECT coalesce(jsonb_agg(to_jsonb(v)),'[]') FROM gridex_ediel_transport.attempts v WHERE message_id="+uid(mid)+"),'reservations',(SELECT coalesce(jsonb_agg(to_jsonb(v)),'[]') FROM gridex_ediel_transport.reservations v WHERE message_id="+uid(mid)+"),'archives',(SELECT coalesce(jsonb_agg(to_jsonb(v)),'[]') FROM public.ediel_message_payloads v WHERE ediel_message_id="+uid(mid)+" AND payload_kind='raw_mime'),'reconciliationCases',(SELECT coalesce(jsonb_agg(to_jsonb(v)),'[]') FROM gridex_ediel_transport.reconciliation_cases v WHERE message_id="+uid(mid)+"),'reconciliationEvents',(SELECT coalesce(jsonb_agg(to_jsonb(v)),'[]') FROM gridex_ediel_transport.reconciliation_case_events v WHERE case_id IN(SELECT id FROM gridex_ediel_transport.reconciliation_cases WHERE message_id="+uid(mid)+')) )')
 attempts=value['attempts'];archives=value['archives'];need(len(attempts)==len(archives)==1,'ONE_REAL_NATIVE_ATTEMPT_AND_ARCHIVE')
 attempt=attempts[0];archive=archives[0];binding=attempt['binding'];owner=attempt['owner'];o=value['outbox']
 need(attempt['message_id']==mid and attempt['company_id']==A and attempt['actor_user_id']==EE and attempt['entered_at'] and owner.get('kind')=='worker' and owner.get('outboxId')==oid and owner.get('sendAttemptId')==o['current_send_attempt_id'] and binding['originalHash']==contrlCase['message']['immutable_payload_hash'],'ACTUAL_ENTERED_WORKER_OWNER_AND_FROZEN_ORIGINAL')
 h=binding['mimeSha256'];path='/storage/v1/object/ediel-files/transport/'+A+'/'+mid+'/'+h+'.eml'
 reads=[r for r in storageEvidence['observations'] if r.get('method')=='GET' and r.get('path')==path and r.get('httpStatus')==200 and r.get('actualReadbackHashMatched') is True and r.get('responseSHA256')==h]
 need(reads and archive['metadata'].get('archive_verified') is True and archive['raw_payload_hash']==h and archive['metadata'].get('archived_mime_sha256')==h and archive['encrypted_payload_ref']==binding['mimeArchiveRef'] and physicalEvidence['SMTPDataSHA256']==h,'REAL_SDK_READBACK_NATIVE_ARCHIVE_AND_EXACT_PHYSICAL_MIME')
 ids={'ackIds':[mid],'messageIds':[mid],'outboxIds':[oid],'reconciliationIds':[x['id'] for x in value['reconciliationCases']]}
 for r in value['reconciliationCases']:need(r['message_id']==mid and r['attempt_id']==attempt['id'] and r['company_id']==A and r['actor_user_id']==EE and r['mime_sha256']==h and r['mime_payload_snapshot_id']==archive['id'],'REAL_NATIVE_RECONCILIATION_PARENT')
 for r in value['reconciliationEvents']:need(r['case_id'] in ids['reconciliationIds'] and r['company_id']==A and r['actor_user_id']==EE,'REAL_NATIVE_RECONCILIATION_EVENT_PARENT')
 _phase(rt,'smtp',ids)
 out=ctx['core'].capture(rt,ctx['mailbox']);out.update({'outbox':o,'transport':{'messageId':mid,'providerEntryCount':sum(bool(x['entered_at']) for x in attempts),'attempts':attempts,'reservations':value['reservations']},'archive':{'messageId':mid,'mimeSHA256':h,'storageReadbackSHA256':reads[-1]['responseSHA256'],'nativePayloadSnapshotId':archive['id'],'nativeSnapshot':archive},'physical':physicalEvidence,'retrySchedule':{'nativeOutboxColumns':sorted(o),'nextAttemptFieldPresent':any(k in o for k in ['next_attempt_at','next_attempt','nextAttempt']),'deadlineFieldPresent':any(k in o for k in ['deadline','deadline_at'])},'recovery':{'cases':value['reconciliationCases'],'events':value['reconciliationEvents']},'originalVerdict':'INDEPENDENT_ORACLE_REQUIRED_NO_RETRY'})
 return _decorate(rt,out)

# Outer-facing phase ports. Every frame contains the complete522 row map,
# unchanged schema/role/function metadata and all386 private observations.
# Full native RAW snapshots remain solely in the producer's ten-file budget.
PHASE_PUBLIC_TABLES = {
 'fixture': PUBLIC_PHASES['receiver_issue'] | PUBLIC_PHASES['routes'] | PUBLIC_PHASES['mailbox'],
 **{k:v for k,v in PUBLIC_PHASES.items() if k in {'poll','sources','contrl','smtp'}},
}
PHASE_PRIVATE_TABLES = {
 'fixture': {'gridex_controlled_test_receiver.registrations'},
 'poll': {'gridex_unattributed_intake.raw_births','gridex_ediel_inbound_receptions.technical_mailbox_births'},
 'sources': {'gridex_received_sources.sources','gridex_ediel_header_negative_birth.receipts','gridex_ediel_technical_ack.sources','gridex_utilts_issuer.source_admissions','gridex_ediel_inbound_receptions.receptions','gridex_ediel_inbound_receptions.response_requests','gridex_unattributed_intake.parse_births','gridex_ediel_common_header.sources','gridex_ediel_inbound_context.receipts'},
 'contrl': {'gridex_ediel_inbound_context.receipts','gridex_ediel_common_header.negative_witnesses','gridex_ediel_common_header.negative_route_bindings','gridex_ediel_common_header.negative_consumptions','gridex_ediel_ack_guide.source_bindings','gridex_ediel_ack_guide.outbound_prodat_scopes','gridex_ediel_technical_ack.syntax_facets','gridex_ediel_technical_ack.replies','gridex_ediel_ack_replay.creation_receipts'},
 'smtp': {'gridex_ediel_transport.reservations','gridex_ediel_transport.attempts','gridex_ediel_transport.reconciliation_cases','gridex_ediel_transport.reconciliation_case_events'},
}

def _snapshot_nonrows(snapshot, permitted):
 raw=dict(snapshot['raw'])
 # Only the exact corresponding derived table summaries can vary. All other
 # raw metadata and all schema/function/ACL/role semantic hashes stay exact.
 for key in permitted:
  name=key.split('.')[1]
  if name in raw and isinstance(raw[name],dict) and set(raw[name])=={'hash','count'}: del raw[name]
 return {**{k:v for k,v in snapshot.items() if k not in {'rows','raw'}},'raw':raw}

def _private_parent_links(key,rows,ids,afterRows):
 messages={x['id']:x for x in afterRows.get('public.ediel_messages',{}).get('rows',[])}
 witnesses={x['id']:x for x in afterRows.get('gridex_ediel_common_header.negative_witnesses',{}).get('rows',[])}
 own=set(ids.get('messageIds',[]))|set(ids.get('ackIds',[]))
 for r in rows:
  # Retained foreign rows are checked byte-for-byte by the multiset verifier;
  # the extra graph checks below are only for the actual current own edge.
  source=r.get('source_message_id');ack=r.get('ack_message_id')
  if key=='gridex_ediel_inbound_context.receipts' and source in own:
   m=messages.get(source)
   need(m and r['company_id']==m['company_id'] and r['environment']==m['environment'] and r['direction']==m['direction'] and r['source_received_at']==m['message_received_at'] and r['payload_sha256']==sha(m['raw_payload'].encode()),'NATIVE_CONTEXT_EXACT_RAW_DIRECTION_AND_RECEIVED_AT')
  elif key=='gridex_ediel_ack_guide.source_bindings' and source in ids.get('sourceIds',[]):
   m=messages.get(source);need(m and r['company_id']==A and r['environment']=='test' and r['payload_sha256']==sha(m['raw_payload'].encode()) and r['kind'] in {'technical','common'},'NATIVE_GUIDE_SOURCE_BYTES_AND_NEGATIVE_TECHNICAL_KIND')
  elif key=='gridex_ediel_ack_guide.outbound_prodat_scopes' and ack in ids.get('ackIds',[]):
   m=messages.get(ack);s=messages.get(source)
   need(m and s and source in ids.get('sourceIds',[]) and m['related_message_id']==source and r['company_id']==A and r['environment']=='test' and r['source_payload_sha256']==sha(s['raw_payload'].encode()) and r['ack_payload_sha256']==sha(m['raw_payload'].encode()),'NATIVE_PRODAT_SCOPE_BOTH_REAL_ORIGINAL_HASHES')
  elif key=='gridex_ediel_common_header.negative_witnesses' and source in ids.get('sourceIds',[]):
   need(r['id'] in ids.get('headerWitnessIds',[]) and r['company_id']==A and r['environment']=='test' and r['actor_user_id']==EE and any(m['id'] in ids.get('ackIds',[]) and m['message_family']=='APERAK' and m['related_message_id']==source and sha(m['raw_payload'].encode())==r['payload_sha256'] and m['execution_context_snapshot'].get('prodatCommonHeaderNegativeWitnessId')==r['id'] for m in messages.values()),'NATIVE_COMMON_HEADER_WITNESS_REAL_COLLATERAL_APERAK')
  elif key=='gridex_ediel_common_header.negative_consumptions' and ack in ids.get('ackIds',[]):
   m=messages.get(ack);w=witnesses.get(r['witness_id'])
   need(m and w and r['witness_id'] in ids.get('headerWitnessIds',[]) and r['company_id']==A and r['environment']=='test' and w['source_message_id']==m['related_message_id'] and r['payload_sha256']==w['payload_sha256']==sha(m['raw_payload'].encode()),'NATIVE_NEGATIVE_CONSUMPTION_EXACT_WITNESS_AND_ACK')
  elif key=='gridex_ediel_common_header.negative_route_bindings' and r.get('witness_id') in ids.get('headerWitnessIds',[]):
   w=witnesses.get(r['witness_id']);route=r['route']
   need(w and route['companyId']==A and route['sourceMessageId']==w['source_message_id'] and any(m['id'] in ids.get('ackIds',[]) and m['message_family']=='APERAK' and (m.get('execution_context_snapshot') or {}).get('prodatCommonHeaderNegativeWitnessId')==w['id'] and m['communication_route_id']==route['route']['id'] and m['route_profile_id']==route['routeRuntime']['route_profile_id'] and m['mailbox']==route['mailbox']==USER and m['receiver_email']==route['receiverEmail'] for m in messages.values()),'NATIVE_NEGATIVE_ROUTE_EXACT_ACTUAL_ACK_PROFILE')

def assert_phase_delta(phase,beforeSnapshot,afterSnapshot,beforePrivate,afterPrivate,beforeRows,afterRows,actualIDs):
 core=load_core()
 need(phase in PHASE_PUBLIC_TABLES and set(beforeSnapshot)==set(afterSnapshot),'FIXED_PHASE_AND_SNAPSHOT_SHAPE')
 need(set(beforeSnapshot['rows'])==set(afterSnapshot['rows']) and len(beforeSnapshot['rows'])==522,'ALL_522_TABLES_PRESERVED')
 need(set(beforePrivate)==set(afterPrivate) and len(beforePrivate)==386,'ALL_386_PRIVATE_TABLES_PRESERVED')
 need(_snapshot_nonrows(beforeSnapshot,PHASE_PUBLIC_TABLES[phase])==_snapshot_nonrows(afterSnapshot,PHASE_PUBLIC_TABLES[phase]),'NONROW_SCHEMA_ROLES_FUNCTIONS_ACL_SETTINGS_DRIFT')
 pub={k for k,v in beforeSnapshot['rows'].items() if v!=afterSnapshot['rows'][k]}
 private={k for k,v in beforePrivate.items() if v!=afterPrivate[k]}
 need(pub<=PHASE_PUBLIC_TABLES[phase] and private<=PHASE_PRIVATE_TABLES[phase],'UNKNOWN_PHASE_TABLE_CHANGE')
 changed=pub|private; need(changed<=set(beforeRows) and changed<=set(afterRows),'EVERY_CHANGED_TABLE_FULL_OLD_AND_NEW_ROWS')
 checks={}
 for key in sorted(changed):
  b=beforeRows[key];a=afterRows[key]
  need(b['count']==len(b['rows']) and a['count']==len(a['rows']),'COMPLETE_NATIVE_FULL_ROW_COUNT')
  if key in private:
   need(b['sha256']==beforePrivate[key]['sha256'] and a['sha256']==afterPrivate[key]['sha256'] and b['count']==beforePrivate[key]['count'] and a['count']==afterPrivate[key]['count'],'PRIVATE_FULL_ROWS_NATIVE_HASH_COUNT_BINDING')
   col,kind=EXTRA_LINKS.get(key,core.LINKS.get(key,(None,None)))
   need(col is not None,'EXACT_PRIVATE_NATIVE_LINK_REQUIRED')
   _private_parent_links(key,a['rows'],actualIDs,afterRows)
   checks[key]=core.assert_row_delta(b['rows'],a['rows'],col,actualIDs.get(kind,[]),append_only=key not in {'gridex_ediel_transport.reservations','gridex_ediel_transport.attempts'})
  else:
   need(b['count']==beforeSnapshot['rows'][key]['count'] and a['count']==afterSnapshot['rows'][key]['count'],'PUBLIC_FULL_ROWS_NATIVE_SNAPSHOT_COUNT_BINDING')
   mutable=key in {'public.ediel_agt_readiness','public.ediel_mailboxes','public.inbound_email_messages','public.inbound_processing_jobs','public.ediel_messages','public.ediel_outbox'}|set(CONFIG_MUTABLE)
   if key in CONFIG_MUTABLE:_config_columns(key,b['rows'],a['rows'],actualIDs)
   if key=='public.ediel_agt_readiness':
    fields={'needs_retest','retest_reason','invalidated_at','invalidated_by','invalidation_source','updated_by','updated_at'}
    for old in b['rows']:
     current=[v for v in a['rows'] if v.get('id')==old.get('id')]
     if current and current[0]!=old:
      need(old.get('company_id')==A and {k:v for k,v in old.items() if k not in fields}=={k:v for k,v in current[0].items() if k not in fields} and current[0].get('needs_retest') is True and current[0].get('invalidated_by')==EE and current[0].get('updated_by')==EE and current[0].get('invalidation_source')=='route_change','EXACT_NORMAL_AGT_INVALIDATION_ONLY')
   checks[key]=_delta(core,b['rows'],a['rows'],_public_pred(key,actualIDs),mutable)
 return {'state':'EXACT_OWN_PHASE_DELTA_SOURCE_WITNESS','phase':phase,'changed522':sorted(pub),'changed386':sorted(private),'allOther522And386Exact':True,'checks':checks,'crossQueryAtomicSnapshotClaim':False,'caseCredit':0}

def _frame_compact(frame):
 snapshot=frame['snapshot']
 return {'phase':frame['label'],'observedAtEpoch':frame['observedAtEpoch'],'rows522':snapshot['rows'],'nonrowSHA256':sha(canon({k:v for k,v in snapshot.items() if k!='rows'}).encode()),'private386':frame['private'],'fullRows':frame['rows'],'actualIDs':frame.get('actualIDs',{}),'phaseWitness':frame.get('phaseWitness'),'fullRAWNotEmbedded':True}

def frame(rt,label,mailbox_id,save,snapshot=None):
 need(re.fullmatch(r'[a-z0-9-]+',label),'FIXED_PHASE_LABEL')
 core=load_core(); snap=snapshot if snapshot is not None else rt['snapshot'](DB)
 need(len(snap['rows'])==522 and len(snap['allRawFunctions'])==3443,'ACTUAL_FULL_522_3443_FRAME')
 private=core.capture_private(rt,snap)
 candidates=set().union(*PHASE_PUBLIC_TABLES.values(),*PHASE_PRIVATE_TABLES.values())
 need(len(candidates)<=64,'FINITE_SOURCE_QUALIFIED_PHASE_ROW_CANDIDATES')
 full=_rows(rt,candidates)
 out={'label':label,'observedAtEpoch':time.time(),'snapshot':snap,'private':private,'rows':full,'mailboxId':mailbox_id}
 persist({**rt,'save':save},'frame-'+label,_frame_compact(out));return out

def phase_witness(rt,priorFrame,phase,actualOutputs,save,fullName=None,snapshot=None):
 need(phase in PHASE_PUBLIC_TABLES,'CLOSED_FIVE_PHASES_ONLY')
 core=load_core(); snap=snapshot if snapshot is not None else rt['snapshot'](DB)
 private=core.capture_private(rt,snap)
 changed={k for k,v in priorFrame['snapshot']['rows'].items() if v!=snap['rows'][k]}|{k for k,v in priorFrame['private'].items() if v!=private[k]}
 need(changed<=PHASE_PUBLIC_TABLES[phase]|PHASE_PRIVATE_TABLES[phase],'UNKNOWN_NATIVE_PHASE_TABLE_CHANGE')
 after=dict(priorFrame['rows']); after.update(_rows(rt,changed))
 ids=rt['_fourSemantic']['pending']
 need(ids and actualOutputs.get('mailboxId') in ids.get('mailboxIds',[]) or ids and phase in {'contrl','smtp','sources'},'ACTUAL_NATIVE_OPERATION_OUTPUTS_AND_IDS')
 check=assert_phase_delta(phase,priorFrame['snapshot'],snap,priorFrame['private'],private,priorFrame['rows'],after,ids)
 label=phase+'-'+str(rt['_fourSemantic']['index']); rt['_fourSemantic']['index']+=1
 out={'label':label,'observedAtEpoch':time.time(),'snapshot':snap,'private':private,'rows':after,'actualIDs':ids,'phaseWitness':check,'mailboxId':actualOutputs.get('mailboxId')}
 persist({**rt,'save':save},'frame-'+label,_frame_compact(out))
 if fullName is not None:
  need(re.fullmatch(r'clone-after-[A-Za-z0-9_-]+\.private\.json',fullName),'FIXED_OWN_FULL_CAPTURE_NAME')
  save(ROOT/fullName,snap)
 rt['_fourSemantic']['pending']={};return out
