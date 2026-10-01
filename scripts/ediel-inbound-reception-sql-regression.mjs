// Explicit embedded PostgreSQL mechanics. No authentic T policy, issuer, mail
// trust or native migration/replay acceptance is asserted by these fixtures.
import{readFileSync}from'node:fs';import{pathToFileURL}from'node:url';import assert from'node:assert/strict'
if(!process.env.EDIEL_PGLITE_MODULE)throw Error('EDIEL_PGLITE_MODULE required')
const{PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite(),u=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
let checks=0
const raw="UNB+UNOC:3+54321:ZZ+21660:ZZ+261001:0000+OLD+++++23-DDQ-PRODAT'UNH+1+PRODAT:D:96B:UN:E2SE6A'BGM+Z02+OWN+9'LIN+1'UNT+4+1'UNZ+1+OLD'"
const record=async(mail=10,parse=20,company=1,message=5,actor=3)=>{await db.exec('SET ROLE service_role');try{return(await db.query('SELECT public.ediel_record_inbound_reception_v1($1,$2,$3,$4,$5) result',[u(company),u(message),actor===null?null:u(actor),u(mail),u(parse)])).rows[0].result}finally{await db.exec('RESET ROLE')}}
const read=async(mail=10,company=1,message=5,actor=3)=>{await db.exec('SET ROLE service_role');try{return(await db.query('SELECT public.ediel_inbound_reception_request_v1($1,$2,$3,$4) result',[u(company),u(message),u(actor),mail===null?null:u(mail)])).rows[0].result}finally{await db.exec('RESET ROLE')}}
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE TABLE companies(id uuid PRIMARY KEY);
 CREATE TABLE user_profiles(id uuid,user_status text);CREATE TABLE company_memberships(company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);
 CREATE TABLE fixture_permissions(permission text PRIMARY KEY,allowed boolean);INSERT INTO fixture_permissions VALUES('communication.write',true),('communication.read',true);
 CREATE FUNCTION public.gridex_actor_has_company_permission(uuid,uuid,text) RETURNS boolean LANGUAGE sql AS 'SELECT allowed FROM public.fixture_permissions WHERE permission=$3';
 CREATE TABLE ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,raw_payload text,sender_ediel_id text,receiver_ediel_id text,application_reference text,interchange_reference text,inbound_email_message_id uuid,mailbox_message_id text,status text,ack_status text,message_standard text,message_family text,message_code text,message_received_at timestamptz);
 CREATE TABLE ediel_mailboxes(id uuid PRIMARY KEY,company_id uuid,environment text,is_shared_platform_mailbox boolean);
 CREATE TABLE inbound_email_messages(id uuid PRIMARY KEY,company_id uuid,environment text,mailbox_id uuid,received_at timestamptz,raw_edifact_payload text,body_text text,raw_email text,internet_message_id text,raw_message_sha256 text,processing_status text,match_status text,error_message text,match_payload jsonb,updated_at timestamptz);
 CREATE TABLE inbound_email_attachments(id uuid PRIMARY KEY,inbound_email_message_id uuid,company_id uuid,raw_text text);
 CREATE TABLE inbound_ediel_parse_results(id uuid PRIMARY KEY,inbound_email_message_id uuid,company_id uuid,raw_payload text,sender_ediel_id text,receiver_ediel_id text,application_reference text,interchange_reference text,message_family text,message_code text);
 CREATE SCHEMA gridex_received_sources;CREATE TABLE gridex_received_sources.validation_assessments(id uuid PRIMARY KEY,source_message_id uuid,company_id uuid,environment text,source_payload_hash text,previous_assessment_id uuid);
 CREATE UNIQUE INDEX first_assessment ON gridex_received_sources.validation_assessments(source_message_id) WHERE previous_assessment_id IS NULL;`)
 const immutable=readFileSync(new URL('../supabase/migrations/20260930144205_ediel_permission_source_atomic_transitions.sql',import.meta.url),'utf8').match(/CREATE FUNCTION gridex_received_sources\.permission_transition_immutable_v1\(\)[\s\S]*?END \$\$;/)[0]
 await db.exec(immutable)
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001000459_ediel_immutable_inbound_reception_response_requests.sql',import.meta.url),'utf8'));checks++
 await db.exec(`INSERT INTO companies VALUES('${u(1)}'),('${u(2)}');INSERT INTO auth.users VALUES('${u(3)}');INSERT INTO user_profiles VALUES('${u(3)}','active');INSERT INTO company_memberships VALUES('${u(1)}','${u(3)}','active',true,now());INSERT INTO ediel_mailboxes VALUES('${u(4)}','${u(1)}','test',false);`)
 await db.query(`INSERT INTO ediel_messages VALUES($1,$2,'test','inbound',$3,'54321','21660','23-DDQ-PRODAT','OLD',$4,NULL,'acknowledged','accepted','edifact','PRODAT','Z02','2026-10-01T00:00:00Z')`,[u(5),u(1),raw,u(10)])
 const add=async(mail,parse,payload=raw)=>{await db.query(`INSERT INTO inbound_email_messages(id,company_id,environment,mailbox_id,received_at,body_text,processing_status,match_status,match_payload) VALUES($1,$2,'test',$3,'2026-10-01T00:00:00Z',$4,'received','unmatched','{}')`,[u(mail),u(1),u(4),payload]);await db.query(`INSERT INTO inbound_ediel_parse_results VALUES($1,$2,$3,$4,'54321','21660','23-DDQ-PRODAT','OLD','PRODAT','Z02')`,[u(parse),u(mail),u(1),payload])}
 await add(10,20);const before=(await db.query('SELECT to_jsonb(m) row FROM ediel_messages m')).rows[0].row
 const first=await record();assert.equal(first.classification,'first_reception');assert.equal(first.status,'observed');assert.equal(first.responseRequestId,null);assert.equal(first.isReplay,false);checks++
 const replay=await record();assert.equal(replay.isReplay,true);assert.equal(replay.receptionId,first.receptionId);assert.equal(replay.responseRequestId,null);checks++
 assert.equal((await read()).firstOutcomeAvailable,false);checks++
 await add(11,21);const duplicate=await record(11,21);assert.equal(duplicate.classification,'protocol_duplicate');assert.equal(duplicate.status,'held');assert.equal(duplicate.businessEffectAuthorized,false);assert.equal(duplicate.reason,'authentic_duplicate_transport_response_policy_required');checks++
 const hold=(await db.query('SELECT processing_status,match_status,match_payload FROM inbound_email_messages WHERE id=$1',[u(11)])).rows[0];assert.equal(hold.processing_status,'manual_review');assert.equal(hold.match_status,'protocol_response_held');assert.equal(hold.match_payload.protocolReception.responseRequestId,duplicate.responseRequestId);checks++
 assert.equal((await record(11,21)).responseRequestId,duplicate.responseRequestId);checks++
 await add(12,22,raw.replace('BGM+Z02+OWN','BGM+Z02+CHANGED'));const conflict=await record(12,22);assert.equal(conflict.classification,'identity_conflict');assert.equal(conflict.status,'held');checks++
 assert.deepEqual((await db.query('SELECT to_jsonb(m) row FROM ediel_messages m')).rows[0].row,before);checks++
 await assert.rejects(db.exec(`UPDATE ediel_messages SET inbound_email_message_id='${u(11)}' WHERE id='${u(5)}'`),/original_immutable/);checks++
 await assert.rejects(db.exec(`UPDATE ediel_messages SET raw_payload='CHANGED' WHERE id='${u(5)}'`),/original_immutable/);checks++
 await db.exec(`UPDATE ediel_messages SET status='delivered' WHERE id='${u(5)}'`);assert.equal((await db.query(`SELECT status FROM ediel_messages WHERE id='${u(5)}'`)).rows[0].status,'delivered');checks++
 await assert.rejects(record(10,20,1,5,null),/actor_forbidden/);checks++
 await assert.rejects(record(10,20,2),/actor_forbidden/);checks++
 await db.exec(`INSERT INTO company_memberships VALUES('${u(2)}','${u(3)}','active',true,now())`);await assert.rejects(record(10,20,2),/original_not_owned/);checks++
 await assert.rejects(record(10,21),/source_scope_required/);checks++
 await add(13,23);await db.query('UPDATE inbound_email_messages SET company_id=$1 WHERE id=$2',[u(2),u(13)]);await assert.rejects(record(13,23),/source_scope_required/);checks++
 await add(14,24);await db.exec(`UPDATE inbound_ediel_parse_results SET receiver_ediel_id='FOREIGN' WHERE id='${u(24)}'`);await assert.rejects(record(14,24),/source_scope_required/);checks++
 await add(15,25);await db.exec(`UPDATE inbound_ediel_parse_results SET raw_payload='FORGED-UNRETAINED' WHERE id='${u(25)}'`);await assert.rejects(record(15,25),/retained_transport_bytes_required/);checks++
 await add(16,26);await db.exec(`UPDATE inbound_email_messages SET environment='production' WHERE id='${u(16)}'`);await assert.rejects(record(16,26),/source_scope_required/);checks++
 await add(17,27);await db.exec(`UPDATE inbound_email_messages SET received_at=NULL WHERE id='${u(17)}'`);await assert.rejects(record(17,27),/source_scope_required/);checks++
 await add(18,28);await db.exec(`UPDATE inbound_email_messages SET company_id=NULL WHERE id='${u(18)}'`);assert.equal((await record(18,28)).status,'held');assert.equal((await db.query(`SELECT company_id FROM inbound_email_messages WHERE id='${u(18)}'`)).rows[0].company_id,u(1));checks++
 await assert.rejects(read(null),/exact_reception_selector/);checks++
 assert.equal(await read(13),null);checks++
 await db.query(`INSERT INTO gridex_received_sources.validation_assessments VALUES($1,$2,$3,'test',$4,NULL)`,[u(30),u(5),u(1),first.canonicalPayloadHash]);const request=await read(11);assert.equal(request.firstValidationAssessmentId,u(30));assert.equal(request.duplicateResponseActivated,false);checks++
 for(const table of ['receptions','response_requests']){await assert.rejects(db.exec(`DELETE FROM gridex_ediel_inbound_receptions.${table}`),/immutable/);await assert.rejects(db.exec(`TRUNCATE gridex_ediel_inbound_receptions.${table} CASCADE`),/immutable/);assert.equal((await db.query(`SELECT has_table_privilege('service_role','gridex_ediel_inbound_receptions.${table}','UPDATE') allowed`)).rows[0].allowed,false);checks+=3}
 assert.equal((await db.query(`SELECT has_function_privilege('authenticated','public.ediel_record_inbound_reception_v1(uuid,uuid,uuid,uuid,uuid)','EXECUTE') allowed`)).rows[0].allowed,false);checks++
 await db.exec(`UPDATE fixture_permissions SET allowed=false WHERE permission='communication.write'`);await assert.rejects(record(10,20),/actor_forbidden/);checks++
 await db.exec(`UPDATE fixture_permissions SET allowed=true WHERE permission='communication.write';UPDATE fixture_permissions SET allowed=false WHERE permission='communication.read'`);assert.equal((await read(11)).receptionId,duplicate.receptionId);checks++
 await db.exec(`UPDATE fixture_permissions SET allowed=false`);await assert.rejects(read(11),/actor_forbidden/);checks++
 await db.exec(`UPDATE fixture_permissions SET allowed=true;UPDATE user_profiles SET user_status='disabled'`);await assert.rejects(read(11),/actor_forbidden/);checks++
 console.log(`PASS ${checks} embedded PostgreSQL reception checks; genuine policy/mail trust/native replay NOT verified`)
}finally{await db.close()}
