"""Owned four-case READ ONLY capture and strict row witnesses. No import effects.
Outer producer owns execution/phase semantics; this module never issues commands.
The pinned 388/386 donor captures every private table, without regex omission.
"""
import hashlib, importlib.util, json, pathlib, re
DB='gridex_local_partner_http_20261113_a'
COMPANY='b36f6a30-18cd-4a70-8652-5b2da9b4eb64'
ACTOR='ee029de5-22a8-4916-9c36-388d13f19cb1'
CAP=8*1024*1024
DONOR=pathlib.Path('/tmp/gridex-ediel06-headless-prep-20261116-b/private-table-batch.v2.py')
DONOR_SHA='292729715c426751ae12a8f59c711c3ff5201c45fa323dbbaf0df3d9fb653c68'
IDENT=re.compile(r'^[A-Za-z_][A-Za-z0-9_]*$')
UUID=re.compile(r'^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$')
# These are direct writes in saved actual native bodies, not broad schema grants.
PRIVATE_PHASES={
 'receiver_issue':{'gridex_controlled_test_receiver.registrations'},
 'receiver_revoke':{'gridex_controlled_test_receiver.revocations'},
 'routes':set(), 'mailbox':set(),
 'poll':{'gridex_unattributed_intake.raw_births','gridex_ediel_inbound_receptions.technical_mailbox_births'},
 'sources':{'gridex_received_sources.sources','gridex_ediel_header_negative_birth.receipts','gridex_ediel_technical_ack.sources','gridex_utilts_issuer.source_admissions','gridex_ediel_inbound_receptions.receptions','gridex_ediel_inbound_receptions.response_requests'},
 'contrl':{'gridex_ediel_technical_ack.syntax_facets','gridex_ediel_technical_ack.replies','gridex_ediel_ack_replay.creation_receipts'},
 'smtp':{'gridex_ediel_transport.reservations','gridex_ediel_transport.attempts'},
}
# Fixed direct native ownership columns; caller binds actual returned IDs only.
LINKS={
 'gridex_controlled_test_receiver.registrations':('id','registrationIds'),
 'gridex_controlled_test_receiver.revocations':('registration_id','registrationIds'),
 'gridex_unattributed_intake.raw_births':('inbound_email_message_id','emailIds'),
 'gridex_ediel_inbound_receptions.technical_mailbox_births':('inbound_email_message_id','emailIds'),
 'gridex_received_sources.sources':('source_message_id','sourceIds'),
 'gridex_ediel_header_negative_birth.receipts':('source_message_id','sourceIds'),
 'gridex_ediel_technical_ack.sources':('source_message_id','sourceIds'),
 'gridex_utilts_issuer.source_admissions':('source_message_id','sourceIds'),
 'gridex_ediel_inbound_receptions.receptions':('inbound_email_message_id','emailIds'),
 'gridex_ediel_inbound_receptions.response_requests':('source_message_id','sourceIds'),
 'gridex_ediel_technical_ack.syntax_facets':('source_message_id','sourceIds'),
 'gridex_ediel_technical_ack.replies':('source_message_id','sourceIds'),
 'gridex_ediel_ack_replay.creation_receipts':('source_message_id','sourceIds'),
 'gridex_ediel_transport.reservations':('message_id','ackIds'),
 'gridex_ediel_transport.attempts':('message_id','ackIds'),
}
def need(v,m):
 if not v: raise AssertionError(m)
def ident(v):
 need(isinstance(v,str) and UUID.fullmatch(v),'ACTUAL_UUID_REQUIRED'); return "'"+v+"'::uuid"
def table(v):
 p=v.split('.');need(len(p)==2 and all(IDENT.fullmatch(x) for x in p),'EXACT_CATALOG_TABLE_KEY');return '.'.join('"'+x+'"' for x in p)
def decode(raw):
 b=raw.encode() if isinstance(raw,str) else raw;need(isinstance(b,bytes) and len(b)<=CAP,'BOUNDED_NATIVE_OUTPUT');return json.loads(b)
def sql(rt,q):
 # Producer rt.sql is the qualified fixed own-DB readonly process port.
 need(callable(rt.get('sql')),'QUALIFIED_READONLY_SQL_PORT_REQUIRED')
 return decode(rt['sql'](DB,"BEGIN READ ONLY;SET LOCAL statement_timeout='8s';SET LOCAL lock_timeout='5s';"+q+';ROLLBACK;'))
def prerequisites(rt):
 return sql(rt,"SELECT jsonb_build_object('database',current_database(),'queueRows',(SELECT count(*) FROM public.inbound_processing_jobs),'functionCount',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prokind IN('f','p') AND n.nspname NOT IN('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'), 'current99003',(SELECT coalesce(jsonb_agg(to_jsonb(v)),'[]') FROM gridex_controlled_test_receiver.registrations v WHERE v.receiver_ediel_id='99003'))")
def capture(rt,mailbox_id=None):
 m=ident(mailbox_id) if mailbox_id else 'NULL::uuid'
 arrays={
 'ownEmails':('public.inbound_email_messages','v.mailbox_id='+m),
 'foreignEmails':('public.inbound_email_messages',m+' IS NULL OR v.mailbox_id IS DISTINCT FROM '+m),
 'foreignMailboxes':('public.ediel_mailboxes','v.id IS DISTINCT FROM '+m),
 'allJobs':('public.inbound_processing_jobs','true'),
 'sources':('public.ediel_messages',"to_jsonb(v)->>'inbound_email_message_id' IN (SELECT id::text FROM public.inbound_email_messages WHERE mailbox_id="+m+')'),
 }
 fields=["'state','ACTUAL_FOUR_CASE_NATIVE_READONLY'","'database',current_database()","'observedAt',clock_timestamp()","'mailboxNameCount',(SELECT count(*) FROM public.ediel_mailboxes WHERE mailbox_name='Gridex shared test Ediel')","'mailbox',(SELECT to_jsonb(v) FROM public.ediel_mailboxes v WHERE v.id="+m+')']
 for name,(key,pred) in arrays.items():
  fields.append("'"+name+"',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY to_jsonb(v)::text),'[]') FROM "+table(key)+' v WHERE '+pred+')')
 d=sql(rt,'SELECT jsonb_build_object('+','.join(fields)+')');need(d['database']==DB,'OWN_DATABASE_ONLY');return d

def capture_private(rt,snapshot):
 need(DONOR.is_file() and not DONOR.is_symlink() and hashlib.sha256(DONOR.read_bytes()).hexdigest()==DONOR_SHA,'QUALIFIED_388_386_DONOR_PIN')
 spec=importlib.util.spec_from_file_location('four_case_private_donor',DONOR);mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
 return mod.capture(rt['sql'],DB,snapshot)
def capture_changed_rows(rt,keys):
 need(isinstance(keys,(list,tuple,set)) and len(keys)<=50 and len(set(keys))==len(keys),'FINITE_EXACT_CHANGED_TABLES')
 fields=[]
 for k in sorted(keys):
  rows="coalesce(jsonb_agg(to_jsonb(v) ORDER BY to_jsonb(v)::text),'[]'::jsonb)"
  fields.append("'"+k+"',(SELECT jsonb_build_object('count',count(*),'sha256',encode(sha256(convert_to("+rows+"::text,'UTF8')),'hex'),'rows',"+rows+") FROM "+table(k)+' v)')
 return sql(rt,'SELECT jsonb_build_object('+','.join(fields)+')') if fields else {}
def _canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False)
def assert_row_delta(before,after,column,ids,company=COMPANY,append_only=True):
 """Exact multiset subtraction. EVERY old row remains unless its exact own key
 is bound and append_only=False. A matching company alone NEVER authorizes it.
 """
 need(isinstance(before,list) and isinstance(after,list) and IDENT.fullmatch(column),'FULL_ROW_ARRAYS_REQUIRED')
 need(isinstance(ids,(list,tuple,set)) and ids and all(isinstance(x,str) and UUID.fullmatch(x) for x in ids),'ACTUAL_RETURNED_OWN_IDS_REQUIRED')
 ids=set(ids);remaining=[_canonical(v) for v in after]
 for row in before:
  encoded=_canonical(row)
  if encoded in remaining:remaining.remove(encoded);continue
  need(not append_only and row.get(column) in ids and ('company_id' not in row or row['company_id']==company),'OLD_FOREIGN_ROW_CHANGED_OR_DELETED')
  need(any(v.get(column)==row.get(column) and ('id' not in row or v.get('id')==row['id']) for v in after),'OWN_ROW_DELETE_OR_ID_REPLACEMENT')
 # Every newly appearing/updated row has a direct native own-ID edge.
 for encoded in remaining:
  row=json.loads(encoded);need(row.get(column) in ids and ('company_id' not in row or row['company_id']==company),'NEW_ROW_NOT_EXACT_OWN_LINEAGE')
 return {'oldRows':len(before),'newRows':len(after),'allOldForeignRowsExact':True,'appendOnly':append_only,'directOwnColumn':column}
def assert_private_delta(before,after,phase,actualIDs,beforeRows,afterRows):
 need(phase in PRIVATE_PHASES and set(before)==set(after),'ALL_PRIVATE_CATALOG_KEYS_EXACT')
 changed={k for k in before if before[k]!=after[k]};need(changed<=PRIVATE_PHASES[phase],'UNQUALIFIED_PRIVATE_TABLE_CHANGE')
 need(set(beforeRows)==set(afterRows)==changed,'EVERY_CHANGED_TABLE_FULL_ROWS_SAVED')
 checks={}
 for key in sorted(changed):
  column,idskey=LINKS[key]
  # Existing own reservations may change at provider entry/observation. Other
  # private receipts are append-only; absent source proof is a hard STOP.
  append_only=key not in {'gridex_ediel_transport.reservations','gridex_ediel_transport.attempts'}
  for maps,records in [(before,beforeRows),(after,afterRows)]:
   record=records[key];need(isinstance(record,dict) and set(record)=={'count','sha256','rows'} and record['count']==maps[key]['count'] and record['sha256']==maps[key]['sha256'] and len(record['rows'])==record['count'],'FULL_ROWS_SAME_NATIVE_HASH_AND_COUNT')
  checks[key]=assert_row_delta(beforeRows[key]['rows'],afterRows[key]['rows'],column,actualIDs.get(idskey,[]),append_only=append_only)
 return {'phase':phase,'changedTables':sorted(changed),'rowChecks':checks,'allOtherPrivateHashesExact':True,'scope':'strict source-proven subset; unknown extra normal writes need source qualification before execution'}
def mailbox_ack(before,after):
 m=after.get('mailbox');need(m and m['company_id'] is None and m['environment']=='test' and m['is_active'] is True and m['imap_host']=='127.0.0.1' and m['imap_port']==21996 and m['metadata']['imap_secure'] is True,'NORMAL_OWN_STRICT_IMAP_MAILBOX')
 need(before['foreignMailboxes']==after['foreignMailboxes'] and before['foreignEmails']==after['foreignEmails'] and before['allJobs']==after['allJobs']==[],'FOREIGN_MAIL_OR_QUEUE_DRIFT');return m
