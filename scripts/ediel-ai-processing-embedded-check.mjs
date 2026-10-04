/** Isolated synthetic SQL probe only. Not native/replay, legal-owner, RLS,
 * actor authorization or real counterpart acceptance evidence. */
import {readFileSync} from 'node:fs'
import assert from 'node:assert/strict'
if(!process.env.PGLITE_MODULE_URL)throw Error('PGLITE_MODULE_URL required')
const {PGlite}=await import(process.env.PGLITE_MODULE_URL)
const db=new PGlite()
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
CREATE TABLE public.companies(id uuid PRIMARY KEY);
CREATE TABLE public.company_memberships(company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);
CREATE TABLE public.user_profiles(id uuid,user_status text);
CREATE FUNCTION public.gridex_actor_has_company_permission(uuid,uuid,text) RETURNS boolean LANGUAGE sql AS 'SELECT true';
CREATE SCHEMA gridex_received_sources;
CREATE FUNCTION gridex_received_sources.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'received_source_evidence_is_append_only'; END$$;
CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,company_id uuid,created_by uuid,message_standard text,message_family text,message_code text,direction text,raw_payload text,immutable_rendered_at timestamptz,immutable_payload_hash text);
CREATE TABLE public.ai_list_imports(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,created_by uuid,list_type text,gdpr_basis text,retention_until date,raw_payload text);`)
await db.exec(readFileSync(new URL('../supabase/migrations/20260930165219_ediel_ai_processing_decision_consumer.sql',import.meta.url),'utf8'))
const company='00000000-0000-4000-8000-000000000001',actor='00000000-0000-4000-8000-000000000002',decision='00000000-0000-4000-8000-000000000003'
await db.query('INSERT INTO public.companies(id) VALUES($1)',[company])
await db.query("INSERT INTO public.company_memberships VALUES($1,$2,'active',true,now())",[company,actor])
await db.query("INSERT INTO public.user_profiles VALUES($1,'active')",[actor])
const read=async()=>(await db.query('SELECT gridex_ai_processing.current_decision_v1($1,$2,$3) AS assessment',[company,actor,'AI'])).rows[0].assessment
assert.equal((await read()).blocker,'ai_bi_processing_decision_missing')
await assert.rejects(()=>db.query("INSERT INTO public.ediel_messages(id,company_id,created_by,message_standard,message_family,raw_payload) VALUES($1,$2,$3,'edifact','OTHER','AI;contains personal data')",[decision,company,actor]),/ai_bi_processing_decision_missing/)
assert.equal((await db.query('SELECT count(*)::int AS count FROM public.ediel_messages')).rows[0].count,0)
await assert.rejects(()=>db.query("INSERT INTO public.ai_list_imports(company_id,created_by,list_type,gdpr_basis,retention_until) VALUES($1,$2,'AI','guessed',current_date+365)",[company,actor]),/ai_bi_processing_decision_missing/)
await db.query("INSERT INTO gridex_ai_processing.decisions(id,company_id,list_type,purpose,revision,gdpr_basis,retention_days,valid_from,source_reference,source_sha256,decision_owner_registry_id,decision_owner_registry_version) VALUES($1,$2,'AI','ediel_list_reconciliation',1,'alleged',1,now()-interval '1 day','synthetic-unqualified',repeat('a',64),$3,'unqualified')",[decision,company,actor])
assert.equal((await read()).blocker,'ai_bi_processing_decision_owner_registry_unqualified')
await assert.rejects(()=>db.query("INSERT INTO public.ai_list_imports(company_id,created_by,list_type,gdpr_basis,retention_until,processing_decision_id) VALUES($1,$2,'AI','alleged',current_date+1,$3)",[company,actor,decision]),/ai_bi_processing_decision_owner_registry_unqualified/)
assert.equal((await db.query('SELECT count(*)::int AS count FROM public.ai_list_imports')).rows[0].count,0)
assert.equal((await db.query("SELECT has_table_privilege('service_role','gridex_ai_processing.decisions','INSERT') AS allowed")).rows[0].allowed,false)
assert.equal((await db.query("SELECT has_function_privilege('authenticated','public.gridex_ai_bi_processing_decision_v1(uuid,uuid,text)','EXECUTE') AS allowed")).rows[0].allowed,false)
await assert.rejects(()=>db.query('UPDATE gridex_ai_processing.decisions SET retention_days=365'),/received_source_evidence_is_append_only/)
await db.close()
console.log('PASS: declared synthetic AI decision SQL probes; absent/unqualified owner remains held, no import write/default/legal activation, append-only records and no registration grant. Native/replay/legal-owner acceptance NOT RUN.')
