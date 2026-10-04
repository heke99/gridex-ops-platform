// Explicit embedded PostgreSQL mechanics. No authentic T policy, issuer, mail
// trust or native migration/replay acceptance is asserted by these fixtures.
import{readFileSync}from'node:fs';import{pathToFileURL}from'node:url';import assert from'node:assert/strict'
if(!process.env.EDIEL_PGLITE_MODULE)throw Error('EDIEL_PGLITE_MODULE required')
const{PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite(),u=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
let checks=0
const priorCatalog=()=>db.query("SELECT to_jsonb(p) value FROM pg_proc p WHERE p.oid IN('gridex_ediel_inbound_receptions.guard_original_v1()'::regprocedure,'public.ediel_record_inbound_reception_v1(uuid,uuid,uuid,uuid,uuid)'::regprocedure) ORDER BY p.proname")
const raw="UNB+UNOC:3+54321:ZZ+21660:ZZ+261001:0000+OLD+++++23-DDQ-PRODAT'UNH+1+PRODAT:D:96B:UN:E2SE6A'BGM+Z02+OWN+9'LIN+1'UNT+4+1'UNZ+1+OLD'"
const record=async(mail=10,parse=20,company=1,message=5,actor=3)=>{await db.exec('SET ROLE service_role');try{return(await db.query('SELECT public.ediel_record_inbound_reception_v1($1,$2,$3,$4,$5) result',[u(company),u(message),actor===null?null:u(actor),u(mail),u(parse)])).rows[0].result}finally{await db.exec('RESET ROLE')}}
const read=async(mail=10,company=1,message=5,actor=3)=>{await db.exec('SET ROLE service_role');try{return(await db.query('SELECT public.ediel_inbound_reception_request_v1($1,$2,$3,$4) result',[u(company),u(message),u(actor),mail===null?null:u(mail)])).rows[0].result}finally{await db.exec('RESET ROLE')}}
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE TABLE companies(id uuid PRIMARY KEY);
 CREATE TABLE user_profiles(id uuid,user_status text);CREATE TABLE company_memberships(company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);
 CREATE TABLE public.permissions(key text PRIMARY KEY,name text,description text,category text,is_active boolean DEFAULT true);CREATE TABLE fixture_permissions(company_id uuid,actor_user_id uuid,permission text,allowed boolean,PRIMARY KEY(company_id,actor_user_id,permission));INSERT INTO fixture_permissions VALUES('${u(1)}','${u(3)}','communication.send',true),('${u(1)}','${u(3)}','communication.read',true);
 CREATE FUNCTION public.gridex_actor_has_company_permission(uuid,uuid,text) RETURNS boolean LANGUAGE sql AS 'SELECT f.allowed FROM public.fixture_permissions f JOIN public.permissions p ON p.key=f.permission WHERE f.company_id=$2 AND f.actor_user_id=$1 AND f.permission=$3 AND p.is_active';
 CREATE TABLE ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,raw_payload text,sender_ediel_id text,receiver_ediel_id text,application_reference text,interchange_reference text,mailbox_message_id text,status text,ack_status text,message_standard text,message_family text,message_code text,message_received_at timestamptz);
 CREATE TABLE ediel_mailboxes(id uuid PRIMARY KEY,company_id uuid,environment text,is_shared_platform_mailbox boolean);
 CREATE TABLE inbound_email_messages(id uuid PRIMARY KEY,company_id uuid,environment text,mailbox_id uuid,received_at timestamptz,raw_edifact_payload text,body_text text,raw_email text,internet_message_id text,raw_message_sha256 text,processing_status text,match_status text,error_message text,match_payload jsonb,updated_at timestamptz);
 CREATE TABLE inbound_email_attachments(id uuid PRIMARY KEY,inbound_email_message_id uuid,company_id uuid,raw_text text);
 CREATE TABLE inbound_ediel_parse_results(id uuid PRIMARY KEY,inbound_email_message_id uuid,company_id uuid,raw_payload text,sender_ediel_id text,receiver_ediel_id text,application_reference text,interchange_reference text,message_family text,message_code text);
 CREATE SCHEMA gridex_received_sources;CREATE TABLE gridex_received_sources.validation_assessments(id uuid PRIMARY KEY,source_message_id uuid,company_id uuid,environment text,source_payload_hash text,previous_assessment_id uuid);
 CREATE UNIQUE INDEX first_assessment ON gridex_received_sources.validation_assessments(source_message_id) WHERE previous_assessment_id IS NULL;`)
 const immutable=readFileSync(new URL('../supabase/migrations/20260930144205_ediel_permission_source_atomic_transitions.sql',import.meta.url),'utf8').match(/CREATE FUNCTION gridex_received_sources\.permission_transition_immutable_v1\(\)[\s\S]*?END \$\$;/)[0]
 await db.exec(immutable)
 await db.exec(readFileSync(new URL('../supabase/migrations/20260924003708_communication_permission_registry_completion.sql',import.meta.url),'utf8'))
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001000459_ediel_immutable_inbound_reception_response_requests.sql',import.meta.url),'utf8'));checks++
 await db.exec(`INSERT INTO companies VALUES('${u(1)}'),('${u(2)}');INSERT INTO auth.users VALUES('${u(3)}');INSERT INTO user_profiles VALUES('${u(3)}','active');INSERT INTO company_memberships VALUES('${u(1)}','${u(3)}','active',true,now());INSERT INTO ediel_mailboxes VALUES('${u(4)}','${u(1)}','test',false);`)
 await db.query(`INSERT INTO ediel_messages VALUES($1,$2,'test','inbound',$3,'54321','21660','23-DDQ-PRODAT','OLD',$4,'acknowledged','accepted','edifact','PRODAT','Z02','2026-10-01T00:00:00Z')`,[u(5),u(1),raw,u(10)])
 await assert.rejects(()=>db.exec(`UPDATE ediel_messages SET status='parsed' WHERE id='${u(5)}'`),e=>e.code==='42703'&&/inbound_email_message_id/.test(e.message));checks++
 // Retain the actual033 qualified erase prefix while reversing ONLY the two
 // published60131 selector replacements for the actual before-forward probe.
 const actualGuard=readFileSync(new URL('../quality/audits/ediel-masterplan-v2/integration-20261001/inbound-reception-actual-columns-restored/actual-installed-guard.sql',import.meta.url),'utf8')
 await db.exec('CREATE FUNCTION public.ediel_is_qualified_retention_transition_v1(public.ediel_messages,public.ediel_messages) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;')
 await db.exec(actualGuard.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION').replace('NEW.mailbox_message_id','NEW.inbound_email_message_id,NEW.mailbox_message_id').replace('OLD.mailbox_message_id','OLD.inbound_email_message_id,OLD.mailbox_message_id'))
 const catalogBefore=(await priorCatalog()).rows.map(r=>r.value)
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001060131_ediel_inbound_reception_actual_original_columns.sql',import.meta.url),'utf8'))
 const catalogAfter=(await priorCatalog()).rows.map(r=>r.value)
 for(let i=0;i<catalogBefore.length;i++){
  const {prosrc:before,...beforeMeta}=catalogBefore[i],{prosrc:after,...afterMeta}=catalogAfter[i]
  assert.deepEqual(afterMeta,beforeMeta);checks++
  assert.equal(after,before.replaceAll('NEW.inbound_email_message_id,NEW.mailbox_message_id','NEW.mailbox_message_id').replaceAll('OLD.inbound_email_message_id,OLD.mailbox_message_id','OLD.mailbox_message_id').replace('(m.inbound_email_message_id=mail.id OR m.mailbox_message_id=mail.id::text)','(m.mailbox_message_id=mail.id::text)'));checks++
 }
 assert.ok(catalogAfter.find(r=>r.proname==='guard_original_v1').prosrc.includes('public.ediel_is_qualified_retention_transition_v1(OLD,NEW) THEN RETURN NEW;END IF;'));checks++
 const shape=(await db.query("SELECT attname,atttypid::regtype::text type FROM pg_attribute WHERE attrelid='public.ediel_messages'::regclass AND attname IN('inbound_email_message_id','mailbox_message_id') AND NOT attisdropped")).rows
 assert.deepEqual(shape,[{attname:'mailbox_message_id',type:'text'}]);checks++
 const add=async(mail,parse,payload=raw)=>{await db.query(`INSERT INTO inbound_email_messages(id,company_id,environment,mailbox_id,received_at,body_text,processing_status,match_status,match_payload) VALUES($1,$2,'test',$3,'2026-10-01T00:00:00Z',$4,'received','unmatched','{}')`,[u(mail),u(1),u(4),payload]);await db.query(`INSERT INTO inbound_ediel_parse_results VALUES($1,$2,$3,$4,'54321','21660','23-DDQ-PRODAT','OLD','PRODAT','Z02')`,[u(parse),u(mail),u(1),payload])}
 await add(10,20);await assert.rejects(record(),/actor_forbidden/);checks++
 const authBefore=(await db.query("SELECT to_jsonb(p) row FROM pg_proc p WHERE p.oid='gridex_ediel_inbound_receptions.authorize_v1(uuid,uuid,text)'::regprocedure")).rows[0].row
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001084343_ediel_inbound_reception_canonical_permission.sql',import.meta.url),'utf8'))
 const authAfter=(await db.query("SELECT to_jsonb(p) row FROM pg_proc p WHERE p.oid='gridex_ediel_inbound_receptions.authorize_v1(uuid,uuid,text)'::regprocedure")).rows[0].row
 const {prosrc:oldBody,...oldAuth}=authBefore,{prosrc:newBody,...newAuth}=authAfter;assert.deepEqual(newAuth,oldAuth);checks++
 assert.equal(newBody,oldBody.replaceAll("public.gridex_actor_has_company_permission(actor,c,'communication.write')","public.gridex_actor_has_company_permission(actor,c,'communication.send')"));checks++
 assert.equal((await db.query("SELECT count(*)::int value FROM public.permissions WHERE key='communication.write'")).rows[0].value,0);checks++
 const before=(await db.query('SELECT to_jsonb(m) row FROM ediel_messages m')).rows[0].row
 const first=await record();assert.equal(first.classification,'first_reception');assert.equal(first.status,'observed');assert.equal(first.responseRequestId,null);assert.equal(first.isReplay,false);checks++
 const replay=await record();assert.equal(replay.isReplay,true);assert.equal(replay.receptionId,first.receptionId);assert.equal(replay.responseRequestId,null);checks++
 assert.equal((await read()).firstOutcomeAvailable,false);checks++
 await add(11,21);const duplicate=await record(11,21);assert.equal(duplicate.classification,'protocol_duplicate');assert.equal(duplicate.status,'held');assert.equal(duplicate.businessEffectAuthorized,false);assert.equal(duplicate.reason,'authentic_duplicate_transport_response_policy_required');checks++
 const hold=(await db.query('SELECT processing_status,match_status,match_payload FROM inbound_email_messages WHERE id=$1',[u(11)])).rows[0];assert.equal(hold.processing_status,'manual_review');assert.equal(hold.match_status,'protocol_response_held');assert.equal(hold.match_payload.protocolReception.responseRequestId,duplicate.responseRequestId);checks++
 assert.equal((await record(11,21)).responseRequestId,duplicate.responseRequestId);checks++
 await add(12,22,raw.replace('BGM+Z02+OWN','BGM+Z02+CHANGED'));const conflict=await record(12,22);assert.equal(conflict.classification,'identity_conflict');assert.equal(conflict.status,'held');checks++
 assert.deepEqual((await db.query('SELECT to_jsonb(m) row FROM ediel_messages m')).rows[0].row,before);checks++
 await assert.rejects(db.exec(`UPDATE ediel_messages SET mailbox_message_id='${u(11)}' WHERE id='${u(5)}'`),/original_immutable/);checks++
 await assert.rejects(db.exec(`UPDATE ediel_messages SET raw_payload='CHANGED' WHERE id='${u(5)}'`),/original_immutable/);checks++
 await db.exec(`UPDATE ediel_messages SET status='delivered' WHERE id='${u(5)}'`);assert.equal((await db.query(`SELECT status FROM ediel_messages WHERE id='${u(5)}'`)).rows[0].status,'delivered');checks++
 await assert.rejects(record(10,20,1,5,null),/actor_forbidden/);checks++
 await assert.rejects(record(10,20,2),/actor_forbidden/);checks++
 await db.exec(`INSERT INTO company_memberships VALUES('${u(2)}','${u(3)}','active',true,now());INSERT INTO fixture_permissions VALUES('${u(2)}','${u(3)}','communication.send',true)`);await assert.rejects(record(10,20,2),/original_not_owned/);checks++
 await assert.rejects(record(10,21),/source_scope_required/);checks++
 await add(13,23);await db.query('UPDATE inbound_email_messages SET company_id=$1 WHERE id=$2',[u(2),u(13)]);await assert.rejects(record(13,23),/source_scope_required/);checks++
 await add(14,24);await db.exec(`UPDATE inbound_ediel_parse_results SET receiver_ediel_id='FOREIGN' WHERE id='${u(24)}'`);await assert.rejects(record(14,24),/source_scope_required/);checks++
 await add(15,25);await db.exec(`UPDATE inbound_ediel_parse_results SET raw_payload='FORGED-UNRETAINED' WHERE id='${u(25)}'`);await assert.rejects(record(15,25),/retained_transport_bytes_required/);checks++
 await add(16,26);await db.exec(`UPDATE inbound_email_messages SET environment='production' WHERE id='${u(16)}'`);await assert.rejects(record(16,26),/source_scope_required/);checks++
 await add(17,27);await db.exec(`UPDATE inbound_email_messages SET received_at=NULL WHERE id='${u(17)}'`);await assert.rejects(record(17,27),/source_scope_required/);checks++
 await add(18,28);await db.exec(`UPDATE inbound_email_messages SET company_id=NULL WHERE id='${u(18)}'`);assert.equal((await record(18,28)).status,'held');assert.equal((await db.query(`SELECT company_id FROM inbound_email_messages WHERE id='${u(18)}'`)).rows[0].company_id,u(1));checks++
 await assert.rejects(read(null),/exact_reception_selector/);checks++
 assert.equal(await read(13),null);checks++
 assert.equal((await db.query('SELECT count(*)::int value FROM gridex_received_sources.validation_assessments')).rows[0].value,0);const request=await read(11);assert.equal(request.firstValidationAssessmentId,null);assert.equal(request.firstOutcomeAvailable,false);assert.equal(request.duplicateResponseActivated,false);checks++
 for(const table of ['receptions','response_requests']){await assert.rejects(db.exec(`DELETE FROM gridex_ediel_inbound_receptions.${table}`),/immutable/);await assert.rejects(db.exec(`TRUNCATE gridex_ediel_inbound_receptions.${table} CASCADE`),/immutable/);assert.equal((await db.query(`SELECT has_table_privilege('service_role','gridex_ediel_inbound_receptions.${table}','UPDATE') allowed`)).rows[0].allowed,false);checks+=3}
 assert.equal((await db.query(`SELECT has_function_privilege('authenticated','public.ediel_record_inbound_reception_v1(uuid,uuid,uuid,uuid,uuid)','EXECUTE') allowed`)).rows[0].allowed,false);checks++
 await db.exec(`UPDATE fixture_permissions SET allowed=false WHERE permission='communication.send'`);await assert.rejects(record(10,20),/actor_forbidden/);checks++
 await db.exec(`UPDATE fixture_permissions SET allowed=true WHERE permission='communication.send';UPDATE fixture_permissions SET allowed=false WHERE permission='communication.read'`);assert.equal((await read(11)).receptionId,duplicate.receptionId);checks++
 await db.exec(`UPDATE fixture_permissions SET allowed=false`);await assert.rejects(read(11),/actor_forbidden/);checks++
 await db.exec(`UPDATE fixture_permissions SET allowed=true;UPDATE public.permissions SET is_active=false WHERE key='communication.send'`);await assert.rejects(record(),/actor_forbidden/);checks++;await db.exec(`UPDATE public.permissions SET is_active=true WHERE key='communication.send'`);
 await db.exec(`UPDATE fixture_permissions SET allowed=true;UPDATE user_profiles SET user_status='disabled'`);await assert.rejects(read(11),/actor_forbidden/);checks++
 await db.exec(`UPDATE company_memberships SET status='revoked' WHERE company_id='${u(1)}'`);await assert.rejects(record(10,20),/actor_forbidden/);checks++
 console.log(JSON.stringify({status:'PASS',checks,evidenceKind:'BOUNDED_ACTUAL_PUBLIC_COLUMNS',native:false,wholeCriterionApproved:false},null,2))
}finally{await db.close()}
