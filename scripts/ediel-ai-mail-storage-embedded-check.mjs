/** Declared synthetic SQL storage probe only. No native/RLS/real owner,
 * authenticated source, production approval or real counterpart evidence. */
import {readFileSync} from 'node:fs'
import assert from 'node:assert/strict'
if(!process.env.PGLITE_MODULE_URL)throw Error('PGLITE_MODULE_URL required')
const {PGlite}=await import(process.env.PGLITE_MODULE_URL)
const db=new PGlite()
await db.exec(readFileSync(new URL('./fixtures/ediel-ai-source-embedded-schema.sql',import.meta.url),'utf8'))
await db.exec(`CREATE TABLE public.inbound_email_messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,environment text,raw_email text,raw_edifact_payload text,body_text text,body_html text,message_family text);
CREATE TABLE public.inbound_email_attachments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,inbound_email_message_id uuid,raw_text text);
CREATE TABLE public.ediel_message_payloads(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,ediel_message_id uuid,raw_payload text,created_by uuid);`)
for(const file of ['20260930165219_ediel_ai_processing_decision_consumer.sql','20260930174145_ediel_ai_source_atomic_reconciliation.sql','20260930181141_ediel_ai_personal_mail_storage_guards.sql','20260930190501_ediel_ai_message_personal_scope_guard.sql'])await db.exec(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'))
const company='00000000-0000-4000-8000-000000000001',actor='00000000-0000-4000-8000-000000000002',parent='00000000-0000-4000-8000-000000000003',source='00000000-0000-4000-8000-000000000004'
const header='AI;54321;Network;12345;Supplier;202610011200;;20261001;20261101;Ver20140401'
await db.query('INSERT INTO public.companies(id) VALUES($1)',[company])
await db.query("INSERT INTO public.company_memberships VALUES($1,$2,'active',true,now())",[company,actor])
await db.query("INSERT INTO public.user_profiles VALUES($1,'active')",[actor])
for(const column of ['raw_email','raw_edifact_payload','body_text','body_html']){
 await assert.rejects(()=>db.query(`INSERT INTO public.inbound_email_messages(company_id,environment,ai_processing_actor_user_id,${column}) VALUES($1,'test',$2,$3)`,[company,actor,'Content-Type: text/plain\n\n'+header]),/ai_bi_processing_decision_missing/)
 assert.equal((await db.query('SELECT count(*)::int AS count FROM public.inbound_email_messages')).rows[0].count,0)
}
await assert.rejects(()=>db.query("INSERT INTO public.inbound_email_messages(company_id,environment,raw_email) VALUES(NULL,'test',$1)",[header]),/ai_bi_processing_scope_required/)
await db.query("INSERT INTO public.inbound_email_messages(id,company_id,environment,raw_email) VALUES($1,$2,'test','ordinary source')",[parent,company])
await assert.rejects(()=>db.query('INSERT INTO public.inbound_email_attachments(company_id,inbound_email_message_id,raw_text) VALUES($1,$2,$3)',[company,parent,header]),/ai_bi_processing_scope_required/)
assert.equal((await db.query('SELECT count(*)::int AS count FROM public.inbound_email_attachments')).rows[0].count,0)
await assert.rejects(()=>db.query('INSERT INTO public.ediel_message_payloads(company_id,created_by,raw_payload) VALUES($1,$2,$3)',[company,actor,header]),/ai_bi_personal_storage_parent_required/)
await assert.rejects(()=>db.query('INSERT INTO public.ediel_message_payloads(company_id,created_by,inbound_email_message_id,raw_payload) VALUES($1,$2,$3,$4)',[company,actor,parent,header]),/ai_bi_personal_storage_parent_required/)
assert.equal((await db.query('SELECT count(*)::int AS count FROM public.ediel_message_payloads')).rows[0].count,0)
await assert.rejects(()=>db.query('UPDATE public.inbound_email_messages SET body_text=$1 WHERE id=$2',[header,parent]),/ai_bi_processing_scope_required/)
assert.equal((await db.query('SELECT body_text FROM public.inbound_email_messages WHERE id=$1',[parent])).rows[0].body_text,null)
// Synthetic legacy raw source, deliberately not qualified as a legal receipt.
await db.exec('ALTER TABLE public.inbound_email_messages DISABLE TRIGGER ai_bi_mail_requires_legal_decision')
await db.query("INSERT INTO public.inbound_email_messages(id,company_id,environment,raw_email) VALUES($1,$2,'test',$3)",[source,company,header])
await db.exec('ALTER TABLE public.inbound_email_messages ENABLE TRIGGER ai_bi_mail_requires_legal_decision')
await assert.rejects(()=>db.query("UPDATE public.inbound_email_messages SET raw_email='replaced' WHERE id=$1",[source]),/ai_bi_personal_source_immutable/)
assert.equal((await db.query('SELECT raw_email FROM public.inbound_email_messages WHERE id=$1',[source])).rows[0].raw_email,header)
assert.equal((await db.query("SELECT has_function_privilege('authenticated','gridex_ai_processing.personal_storage_basis_v1(uuid,uuid,text,text)','EXECUTE') AS allowed")).rows[0].allowed,false)
await db.close()
console.log('PASS: synthetic first mail/body/attachment/payload storage held without actual owners; shared unknown-tenant/actor and unlinked payload blocked; source replacements cannot erase original AI bytes. Native/replay/RLS/approved-owner acceptance NOT RUN.')
