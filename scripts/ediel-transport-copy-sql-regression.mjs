// Explicit embedded PostgreSQL risk checks. Not native/replay or archive/provider evidence.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
if (!process.env.EDIEL_PGLITE_MODULE) throw new Error('EDIEL_PGLITE_MODULE required')
const { PGlite } = await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const db = new PGlite(), uid = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
let checks = 0
try {
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE company_memberships(company_id uuid,user_id uuid,status text,is_active bool,accepted_at timestamptz);
 CREATE TABLE user_profiles(id uuid,user_status text);
 CREATE FUNCTION gridex_actor_has_company_permission(uuid,uuid,text) RETURNS bool LANGUAGE sql AS 'SELECT true';
 CREATE TABLE ediel_messages(id uuid,company_id uuid,direction text,environment text);
 CREATE TABLE ediel_message_payloads(id uuid,company_id uuid,ediel_message_id uuid,encrypted_payload_ref text,payload_kind text,metadata jsonb);
 CREATE SCHEMA gridex_ediel_transport;CREATE SCHEMA gridex_outbound_dispatch;
 CREATE TABLE gridex_ediel_transport.attempts(id uuid,company_id uuid,message_id uuid,environment text,binding jsonb,entered_at timestamptz,observed_at timestamptz,classification text);
 CREATE TABLE gridex_outbound_dispatch.attempts(id uuid,company_id uuid,message_id uuid,environment text,binding jsonb);
 CREATE TABLE gridex_outbound_dispatch.events(attempt_id uuid,company_id uuid,message_id uuid,environment text,kind text,observed_at timestamptz,facts jsonb);`)
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930164356_ediel_transport_copy_read_v1.sql', import.meta.url),'utf8')); checks++
 const read = async () => (await db.query(`SELECT public.gridex_ediel_transport_copy_v1('${uid(1)}','${uid(2)}','${uid(3)}') AS result`)).rows[0].result
 await assert.rejects(read(), /ediel_transport_copy_forbidden/);checks++
 await db.exec(`INSERT INTO company_memberships VALUES('${uid(1)}','${uid(2)}','active',true,now());INSERT INTO user_profiles VALUES('${uid(2)}','active');INSERT INTO ediel_messages VALUES('${uid(3)}','${uid(1)}','outbound','test');`)
 assert.equal((await read()).status,'unavailable');checks++
 const binding={mimeArchiveRef:'storage://private/fixture',mimeSha256:'a'.repeat(64),mimeLength:123,rfcMessageId:'<fixture>',payloadBase64:'MUST_NOT_LEAK',from:'PRIVATE_MAIL'}
 await db.exec(`INSERT INTO gridex_ediel_transport.attempts VALUES('${uid(4)}','${uid(1)}','${uid(3)}','test','${JSON.stringify(binding)}',null,null,null)`)
 assert.equal((await read()).status,'unavailable');checks++
 await db.exec(`UPDATE gridex_ediel_transport.attempts SET entered_at=now()`)
 assert.equal((await read()).status,'held');checks++
 await db.exec(`INSERT INTO ediel_message_payloads VALUES('${uid(5)}','${uid(1)}','${uid(3)}','${binding.mimeArchiveRef}','raw_mime','${JSON.stringify({archive_verified:true,archived_mime_sha256:binding.mimeSha256,archived_mime_bytes:binding.mimeLength,archived_rfc_message_id:binding.rfcMessageId})}')`)
 const available=await read();assert.equal(available.status,'available');assert.equal(available.copies[0].mimePayloadSnapshotId,uid(5));assert.equal(available.copies[0].archiveReadbackRequired,true);assert.equal(available.authorizesResend,false);assert.equal(available.deliveryProven,false);assert.ok(!JSON.stringify(available).includes('MUST_NOT_LEAK'));assert.ok(!JSON.stringify(available).includes('PRIVATE_MAIL'));checks++
 await db.exec(`UPDATE ediel_message_payloads SET company_id='${uid(9)}'`);assert.equal((await read()).status,'held');checks++
 await db.exec(`UPDATE ediel_message_payloads SET company_id='${uid(1)}',metadata=jsonb_set(metadata,'{archived_mime_sha256}','"wrong"')`);assert.equal((await read()).status,'held');checks++
 await db.exec(`UPDATE ediel_message_payloads SET metadata=jsonb_set(metadata,'{archived_mime_sha256}','"${binding.mimeSha256}"');INSERT INTO gridex_outbound_dispatch.attempts VALUES('${uid(6)}','${uid(1)}','${uid(3)}','test','${JSON.stringify(binding)}');INSERT INTO gridex_outbound_dispatch.events VALUES('${uid(6)}','${uid(1)}','${uid(3)}','test','provider_call_entered',now(),'{}')`)
 assert.deepEqual((await read()).copies.map(c=>c.lane).sort(),['generic_journal','sealed_z08']);checks++
 await db.exec(`UPDATE company_memberships SET accepted_at=null`);await assert.rejects(read(),/ediel_transport_copy_forbidden/);checks++
 const acl=(await db.query(`SELECT has_function_privilege('authenticated','public.gridex_ediel_transport_copy_v1(uuid,uuid,uuid)','execute') AS allowed`)).rows[0];assert.equal(acl.allowed,false);checks++
 console.log(`PASS ${checks} targeted transport copy checks; synthetic metadata, actual archive readback and native/replay deferred`)
} finally { await db.close() }
