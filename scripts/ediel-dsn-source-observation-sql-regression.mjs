// Bounded embedded SQL integrity checks with declared synthetic transport/mail
// fixtures. No native replay, authentic DSN, archive or delivery evidence.
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
if(!process.env.EDIEL_PGLITE_MODULE)throw Error('EDIEL_PGLITE_MODULE required')
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const db=new PGlite(),uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
const c=uid(1),actor=uid(2),message=uid(3),mailbox=uid(4),attempt=uid(5),mail=uid(6),attachment=uid(7)
const raw='Content-Type: multipart/report; report-type=delivery-status; boundary=dsn\r\n\r\n--dsn\r\nContent-Type: message/delivery-status\r\n\r\nReporting-MTA: dns; synthetic.invalid\r\n\r\nFinal-Recipient: rfc822; to@example.invalid\r\nAction: failed\r\nStatus: 5.1.1\r\nDiagnostic-Code: smtp; 550 synthetic fixture\r\n\r\n--dsn\r\nContent-Type: text/rfc822-headers\r\n\r\nMessage-ID: <original@example.invalid>\r\n\r\n--dsn--'
const report={version:1,transportCorrelation:'unverified',reportingMta:{type:'dns',address:'synthetic.invalid'},originalEnvelopeId:null,
 originalMessageIds:['<original@example.invalid>'],recipients:[{finalRecipient:{type:'rfc822',address:'to@example.invalid'},originalRecipient:null,
 action:'failed',status:'5.1.1',diagnosticCode:{type:'smtp',text:'550 synthetic fixture'},remoteMta:null,lastAttemptDate:null,willRetryUntil:null}],issues:[]}
const quote=s=>"'"+s.replaceAll("'","''")+"'"
let checks=0
const hash=(await db.query(`SELECT encode(sha256(convert_to(${quote(raw)},'UTF8')),'hex') hash`)).rows[0].hash
const call=(extra={})=>`SET ROLE service_role;SELECT public.ediel_record_dsn_source_observation_v1(${quote(JSON.stringify({companyId:c,actorUserId:actor,inboundEmailMessageId:mail,sourceField:'raw_email',sourceHash:hash,report,...extra}))}::jsonb) receipt;RESET ROLE;`
async function result(sql){return (await db.exec(sql))[1].rows[0].receipt}
async function refuses(sql,pattern){try{await assert.rejects(db.exec(sql),pattern);checks++}finally{await db.exec('RESET ROLE')}}
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE companies(id uuid PRIMARY KEY);CREATE TABLE company_memberships(company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);CREATE TABLE user_profiles(id uuid,user_status text);
 CREATE FUNCTION gridex_actor_has_company_permission(uuid,uuid,text) RETURNS boolean LANGUAGE SQL AS 'SELECT true';
 CREATE TABLE ediel_messages(id uuid PRIMARY KEY,company_id uuid,direction text,environment text);
 CREATE TABLE ediel_mailboxes(id uuid PRIMARY KEY,company_id uuid,environment text,is_active boolean,is_shared_platform_mailbox boolean,email_address text);
 CREATE TABLE inbound_email_messages(id uuid PRIMARY KEY,company_id uuid,ediel_mailbox_id uuid,environment text,raw_email text,body_text text,processing_status text);
 CREATE TABLE inbound_email_attachments(id uuid PRIMARY KEY,inbound_email_message_id uuid,raw_text text);
 CREATE SCHEMA gridex_ediel_transport;CREATE SCHEMA gridex_outbound_dispatch;
 GRANT USAGE ON SCHEMA gridex_ediel_transport TO service_role;
 CREATE TABLE gridex_ediel_transport.attempts(id uuid,message_id uuid,company_id uuid,environment text,binding jsonb,created_at timestamptz,entered_at timestamptz,observed_at timestamptz,classification text);
 CREATE TABLE gridex_outbound_dispatch.attempts(id uuid,message_id uuid,company_id uuid,environment text,binding jsonb,created_at timestamptz);
 CREATE TABLE gridex_outbound_dispatch.events(id uuid,attempt_id uuid,company_id uuid,environment text,kind text,observed_at timestamptz,facts jsonb);
 CREATE TABLE gridex_outbound_dispatch.witnesses(event_id uuid,company_id uuid,environment text);
 CREATE FUNCTION gridex_outbound_dispatch.immutable_v1() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'immutable';END$$;`)
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930194905_ediel_dsn_source_observation_journal.sql',import.meta.url),'utf8'));checks++
 await refuses(call(),/ediel_dsn_actor_scope_invalid/)
 await db.exec(`INSERT INTO companies VALUES('${c}');INSERT INTO company_memberships VALUES('${c}','${actor}','active',true,now());INSERT INTO user_profiles VALUES('${actor}','active');
 INSERT INTO ediel_messages VALUES('${message}','${c}','outbound','test');INSERT INTO ediel_mailboxes VALUES('${mailbox}','${c}','test',true,false,'sender@example.invalid');
 INSERT INTO inbound_email_messages VALUES('${mail}','${c}','${mailbox}','test',${quote(raw)},null,'received');
 INSERT INTO inbound_email_attachments VALUES('${attachment}','${mail}',${quote(raw)});`)
 const sendingMailbox=()=>db.query(`SELECT gridex_ediel_transport.dsn_sending_mailbox_v1('${c}','test','sender@example.invalid') mailbox`)
 assert.equal((await sendingMailbox()).rows[0].mailbox,mailbox);checks++
 await db.exec(`INSERT INTO ediel_mailboxes VALUES('${uid(20)}','${c}','test',true,false,'sender@example.invalid')`)
 assert.equal((await sendingMailbox()).rows[0].mailbox,null);checks++
 await db.exec(`UPDATE ediel_mailboxes SET is_active=false WHERE id='${uid(20)}';UPDATE ediel_mailboxes SET is_active=false WHERE id='${mailbox}'`)
 assert.equal((await sendingMailbox()).rows[0].mailbox,null);checks++
 await db.exec(`UPDATE ediel_mailboxes SET is_active=true WHERE id='${mailbox}'`)
 await refuses(call(),/ediel_dsn_attempt_ambiguous_or_missing/)
 await db.exec(`INSERT INTO gridex_ediel_transport.attempts VALUES('${attempt}','${message}','${c}','test','{"rfcMessageId":"<original@example.invalid>","to":"to@example.invalid","sourceMailboxId":"${mailbox}"}',now(),null,null,null);`)
 await refuses(call(),/ediel_dsn_attempt_ambiguous_or_missing/)
 await db.exec('UPDATE gridex_ediel_transport.attempts SET entered_at=now()')
 await db.exec(`UPDATE gridex_ediel_transport.attempts SET binding=binding||'{"sourceMailboxId":"${uid(20)}"}'::jsonb`)
 await refuses(call(),/ediel_dsn_attempt_ambiguous_or_missing/)
 await db.exec("UPDATE gridex_ediel_transport.attempts SET binding=binding-'sourceMailboxId'")
 await refuses(call(),/ediel_dsn_attempt_ambiguous_or_missing/)
 await db.exec(`UPDATE gridex_ediel_transport.attempts SET binding=binding||'{"sourceMailboxId":"${mailbox}"}'::jsonb`)
 await refuses(call({sourceHash:'a'.repeat(64)}),/ediel_dsn_source_invalid/)
 await refuses(call({report:{...report,originalMessageIds:['<wrong@example.invalid>']}}),/ediel_dsn_source_invalid/)
 await refuses(call({report:{...report,recipients:[{...report.recipients[0],finalRecipient:{type:'rfc822',address:'wrong@example.invalid'}}]}}),/ediel_dsn_source_invalid/)
 await refuses(call({report:{...report,recipients:[{...report.recipients[0],action:'delivered'}]}}),/ediel_dsn_source_invalid/)
 const first=await result(call());assert.equal(first.authorizesResend,false);assert.equal(first.deliveryProven,false);assert.equal(first.transportCorrelation,'source_matched_unverified');checks++
 assert.equal(first.attemptId,attempt);assert.equal(first.messageId,message)
 assert.deepEqual((await db.query('SELECT report FROM gridex_ediel_transport.dsn_observations WHERE id=$1',[first.observationId])).rows[0].report,report);checks++
 assert.deepEqual(await result(call()),first);checks++
 await refuses('UPDATE inbound_email_messages SET raw_email=raw_email||\'changed\'',/ediel_dsn_observation_source_immutable/)
 await refuses(`UPDATE inbound_email_messages SET company_id='${uid(99)}'`,/ediel_dsn_observation_source_immutable/)
 await db.exec("UPDATE inbound_email_messages SET processing_status='manual_review'");checks++
 const attached=await result(call({sourceField:'attachment',attachmentId:attachment}));assert.notEqual(attached.observationId,first.observationId);checks++
 await refuses("UPDATE inbound_email_attachments SET raw_text='changed'",/ediel_dsn_observation_source_immutable/)
 const read=()=>`SET ROLE service_role;SELECT public.ediel_read_dsn_source_observations_v1('${c}','${actor}','${message}') receipt;RESET ROLE;`
 const projection=await result(read());assert.equal(projection.observations.length,2);assert.equal(projection.authorizesResend,false);assert.equal(projection.deliveryProven,false);assert.ok(!JSON.stringify(projection).includes('Content-Type'));checks++
 assert.deepEqual(projection.observations[0].recipient,report.recipients[0]);checks++
 await refuses(`SET ROLE service_role;SELECT public.ediel_read_dsn_source_observations_v1('${uid(99)}','${actor}','${message}');RESET ROLE;`,/ediel_dsn_actor_scope_invalid/)
 await refuses("SET ROLE service_role;UPDATE gridex_ediel_transport.dsn_observations SET delivery_proven=true;RESET ROLE;",/permission denied/)
 await db.exec(`INSERT INTO gridex_outbound_dispatch.attempts VALUES('${uid(8)}','${message}','${c}','test','{"rfcMessageId":"<original@example.invalid>","to":"to@example.invalid","sourceMailboxId":"${mailbox}"}',now());
 INSERT INTO gridex_outbound_dispatch.events VALUES('${uid(9)}','${uid(8)}','${c}','test','provider_call_entered',now(),'{}');INSERT INTO gridex_outbound_dispatch.witnesses VALUES('${uid(9)}','${c}','test');`)
 await refuses(call(),/ediel_dsn_attempt_ambiguous_or_missing/)
 const acl=(await db.query("SELECT has_function_privilege('anon','public.ediel_record_dsn_source_observation_v1(jsonb)','execute') rpc,has_table_privilege('service_role','gridex_ediel_transport.dsn_observations','update') direct_edit")).rows[0]
 assert.deepEqual(acl,{rpc:false,direct_edit:false});checks++
 console.log(`PASS ${checks} bounded DSN source/tenant/immutable/ACL checks; explicitly synthetic fixtures, not native/replay or authentic delivery evidence`)
}catch(error){console.error(`FAIL after ${checks} checks: ${error instanceof Error?error.message:String(error)}`);console.error({position:error.position,internalPosition:error.internalPosition,where:error.where});process.exitCode=1}
finally{if(!process.env.EDIEL_DSN_EXTENDED_REGRESSION||process.exitCode)await db.close()}
export {db,uid,c,actor,message,mailbox,attempt,mail,raw,report,quote}
