/** Declared synthetic first-source storage probe, not native/RLS/authentic
 * legal-owner or registry approval evidence. Test-only qualification stubs
 * below exercise mechanical ordering; deployed owner boundaries stay closed. */
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
const company='00000000-0000-4000-8000-000000000001',actor='00000000-0000-4000-8000-000000000002',source='00000000-0000-4000-8000-000000000003'
const csv='AI;54321;Network;12345;Supplier;202610011200;;20261001;20261101;Ver20140401\nNET;735123456789012345;9;;;;;Street;12345;Town;12345;;;;;;;199001011234;Person;;;'
await db.query('INSERT INTO public.companies(id) VALUES($1)',[company])
await db.query("INSERT INTO public.company_memberships VALUES($1,$2,'active',true,now())",[company,actor])
await db.query("INSERT INTO public.user_profiles VALUES($1,'active')",[actor])
await db.query("INSERT INTO public.tenant_ediel_profiles(company_id,environment,market,is_enabled,valid_from) VALUES($1,'test','electricity',true,now()-interval '1 day')",[company])
await db.query("INSERT INTO public.tenant_actor_identifiers(company_id,environment,actor_id,identifier_type,identifier_value,valid_from) VALUES($1,'test',$2,'EdielId','12345',now()-interval '1 day')",[company,actor])
await db.query("INSERT INTO public.tenant_actor_roles(company_id,environment,actor_id,role_code,valid_from) VALUES($1,'test',$2,'electricity_supplier',now()-interval '1 day')",[company,actor])
const insert=(raw=csv,sender='54321',receiver='12345',environment='test')=>db.query("INSERT INTO public.ediel_messages(id,company_id,created_by,direction,message_standard,message_family,message_code,raw_payload,sender_ediel_id,receiver_ediel_id,environment) VALUES($1,$2,$3,'inbound','ai_list','AI_LIST','AI',$4,$5,$6,$7)",[source,company,actor,raw,sender,receiver,environment])
const count=async()=>(await db.query('SELECT count(*)::int AS count FROM public.ediel_messages')).rows[0].count
await assert.rejects(()=>insert(),/ai_bi_processing_decision_missing/);assert.equal(await count(),0)
// Synthetic legal decision alone must NOT authorize foreign parties or a
// network lacking authenticated version/owner qualification.
await db.exec("CREATE OR REPLACE FUNCTION gridex_ai_processing.current_decision_v1(c uuid,actor uuid,list_type text) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('status','authorized','decision',jsonb_build_object('id','00000000-0000-4000-8000-000000000004'))$$")
await assert.rejects(()=>insert(csv.replace(';12345;Supplier;',';99999;Supplier;'),'54321','99999'),/ai_bi_header_supplier_tenant_mismatch/);assert.equal(await count(),0)
await assert.rejects(()=>insert(csv,'54321','99999'),/ai_bi_personal_storage_source_context_mismatch/);assert.equal(await count(),0)
await assert.rejects(()=>insert(csv,'54321','12345','production'),/ai_bi_header_supplier_tenant_mismatch/);assert.equal(await count(),0)
await assert.rejects(()=>insert(),/ai_bi_network_registry_version_unqualified/);assert.equal(await count(),0)
await assert.rejects(()=>db.query("INSERT INTO public.ediel_messages(id,company_id,created_by,direction,message_standard,message_family,message_code,raw_payload) VALUES($1,$2,$3,'inbound','edifact','OTHER','OTHER',$4)",[source,company,actor,csv]),/ai_bi_personal_storage_source_context_mismatch/);assert.equal(await count(),0)
// Explicit synthetic header-only qualification for sealing mechanics, never
// claimed as a real network owner or production acceptance.
await db.exec("CREATE OR REPLACE FUNCTION gridex_ai_processing.network_registry_basis_v1(network_id text,env text) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('status','authorized','syntheticUnqualified',true)$$")
await insert()
const sealed=(await db.query('SELECT * FROM public.ediel_messages WHERE id=$1',[source])).rows[0]
assert.ok(sealed.immutable_rendered_at);assert.match(sealed.immutable_payload_hash,/^[a-f0-9]{64}$/)
await db.exec("CREATE OR REPLACE FUNCTION gridex_ai_processing.current_decision_v1(c uuid,actor uuid,list_type text) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('status','held','blocker','ai_bi_processing_decision_missing')$$")
await db.query('UPDATE public.ediel_messages SET raw_payload=raw_payload WHERE id=$1',[source])
for(const column of ['raw_payload','environment','sender_ediel_id','receiver_ediel_id','message_family','message_code'])await assert.rejects(()=>db.query(`UPDATE public.ediel_messages SET ${column}='changed' WHERE id=$1`,[source]),/ai_bi_personal_source_immutable/)
assert.equal((await db.query('SELECT raw_payload FROM public.ediel_messages WHERE id=$1',[source])).rows[0].raw_payload,csv)
assert.equal((await db.query("SELECT has_function_privilege('authenticated','gridex_ai_processing.guard_message_storage_v1()','EXECUTE') AS allowed")).rows[0].allowed,false)
await db.close()
console.log('PASS: synthetic first-message storage binds whole physical header/tenant/environment/network before raw INSERT; legal decision alone insufficient, wrong metadata and mutable old AI source blocked. Native/replay/RLS/actual-owner acceptance NOT RUN.')
