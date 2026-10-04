/** Declared synthetic mechanical probe only. Legal-owner/network overrides below
 * are explicit test-only branches; no native/RLS/authentic-original claims. */
import {readFileSync} from 'node:fs'
import assert from 'node:assert/strict'
if(!process.env.PGLITE_MODULE_URL)throw Error('PGLITE_MODULE_URL required')
const {PGlite}=await import(process.env.PGLITE_MODULE_URL),db=new PGlite()
await db.exec(readFileSync(new URL('./fixtures/ediel-ai-source-embedded-schema.sql',import.meta.url),'utf8'))
await db.exec(`CREATE TABLE public.inbound_email_messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,environment text,raw_email text,raw_edifact_payload text,body_text text,body_html text,message_family text);
CREATE TABLE public.inbound_email_attachments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,inbound_email_message_id uuid,raw_text text);
CREATE TABLE public.ediel_message_payloads(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,ediel_message_id uuid,raw_payload text,created_by uuid);
ALTER TABLE public.ediel_messages ADD COLUMN message_version text,ADD COLUMN mime_type text;
CREATE SCHEMA gridex_ediel_readiness;CREATE TABLE gridex_ediel_readiness.evidence(company_id uuid,scope jsonb,dependencies jsonb,expires_at timestamptz);
CREATE FUNCTION public.ediel_require_scoped_capability_for_message_v1(uuid,uuid) RETURNS void LANGUAGE sql AS $$SELECT NULL::void$$;`)
for(const file of ['20260930165219_ediel_ai_processing_decision_consumer.sql','20260930174145_ediel_ai_source_atomic_reconciliation.sql','20260930181141_ediel_ai_personal_mail_storage_guards.sql','20260930190501_ediel_ai_message_personal_scope_guard.sql','20260930201813_ediel_ai_outbound_source_authority.sql'])await db.exec(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'))
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,company=id(1),actor=id(2),source=id(3),decision=id(4)
const csv='AI;54321;Network;12345;Supplier;202610011200;;20261001;20261101;Ver20140401\nNET;735123456789012345;9;;;;;Street;12345;Town;12345;;;;;;;199001011234;Person;;;'
await db.query('INSERT INTO public.companies VALUES($1)',[company])
await db.query("INSERT INTO public.company_memberships VALUES($1,$2,'active',true,now())",[company,actor])
await db.query("INSERT INTO public.user_profiles VALUES($1,'active')",[actor])
await db.query("INSERT INTO public.tenant_ediel_profiles(company_id,environment,market,is_enabled,valid_from) VALUES($1,'test','electricity',true,now()-interval '1 day')",[company])
await db.query("INSERT INTO public.tenant_actor_identifiers(company_id,environment,actor_id,identifier_type,identifier_value,valid_from) VALUES($1,'test',$2,'EdielId','12345',now()-interval '1 day')",[company,actor])
await db.query("INSERT INTO public.tenant_actor_roles(company_id,environment,actor_id,role_code,valid_from) VALUES($1,'test',$2,'electricity_supplier',now()-interval '1 day')",[company,actor])
const insert=(raw=csv,sender='12345',receiver='54321')=>db.query("INSERT INTO public.ediel_messages(id,company_id,created_by,direction,message_standard,message_family,message_code,message_version,raw_payload,sender_ediel_id,receiver_ediel_id,file_name,mime_type) VALUES($1,$2,$3,'outbound','ai_list','AI_LIST','AI','Ver20140401',$4,$5,$6,'AI.csv','text/csv; charset=utf-8')",[source,company,actor,raw,sender,receiver])
const wire=raw=>db.query('SELECT gridex_ai_processing.outbound_wire_v1($1) AS wire',[raw])
assert.equal((await wire(csv)).rows[0].wire.rowCount,1)
assert.equal((await wire('\uFEFF'+csv.replaceAll('\n','\r\n')+'\r\n')).rows[0].wire.profile.provenance,'frozen_masterplan_projection')
for(const raw of [csv.replace('Ver20140401','OTHER'),csv.replace('20261101','20261001'),csv.replace('202610011200','202602301200'),csv.replace(';Person;;;',';Person;20261020;20261010;'),csv.replace(';9;;;;;',';9;ILLEGAL;;;;'),csv.replace(';;;;;;;199001011234',';METER;;;;;;199001011234'),csv+'\n\n'])await assert.rejects(()=>wire(raw))
await assert.rejects(()=>insert(),/ai_bi_processing_decision_missing/)
assert.equal((await db.query('SELECT count(*)::int AS n FROM public.ediel_messages')).rows[0].n,0)
await db.query("INSERT INTO gridex_ai_processing.decisions(id,company_id,list_type,purpose,revision,gdpr_basis,retention_days,valid_from,valid_until,source_reference,source_sha256,decision_owner_registry_id,decision_owner_registry_version) VALUES($1,$2,'AI','ediel_list_export',1,'SYNTHETIC_UNQUALIFIED',30,now()-interval '1 hour',now()+interval '1 hour','synthetic-only',repeat('a',64),$3,'synthetic-only')",[decision,company,id(9)])
await assert.rejects(()=>insert(),/ai_bi_processing_decision_owner_registry_unqualified/)
// Preserve actual current membership/profile/purpose/unique decision guards;
// replace ONLY the final missing-owner branch for synthetic mechanics.
let migration=readFileSync(new URL('../supabase/migrations/20260930201813_ediel_ai_outbound_source_authority.sql',import.meta.url),'utf8')
let owner=migration.slice(migration.indexOf('CREATE FUNCTION gridex_ai_processing.current_purpose_decision_v1'),migration.indexOf('REVOKE ALL ON FUNCTION gridex_ai_processing.current_purpose_decision_v1'))
owner=owner.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION').replace("RETURN jsonb_build_object('status','held','blocker','ai_bi_processing_decision_owner_registry_unqualified');","RETURN jsonb_build_object('status','authorized','decision',jsonb_build_object('id',d.id,'companyId',c,'listType',list_type,'purpose',purpose,'syntheticUnqualified',true));")
await db.exec(owner)
await assert.rejects(()=>insert(),/ai_bi_network_registry_version_unqualified/)
await assert.rejects(()=>insert(csv.replace(';12345;Supplier;',';99999;Supplier;'),'99999'),/ai_bi_header_supplier_tenant_mismatch/)
await db.exec("CREATE OR REPLACE FUNCTION gridex_ai_processing.network_registry_basis_v1(network_id text,env text) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('status','authorized','syntheticUnqualified',true)$$")
await insert()
const qualify=(c=company,a=actor)=>db.query('SELECT gridex_ai_processing.require_ai_outbound_source_v1($1,$2,$3) AS basis',[c,source,a])
const basis=(await qualify()).rows[0].basis
assert.equal(basis.rowCount,1);assert.equal(basis.decisionId,decision);assert.match(basis.sourceHash,/^[a-f0-9]{64}$/)
assert.equal(basis.profile.provenance,'frozen_masterplan_projection');assert.equal(basis.headerBasis.legalSupplier,'12345')
await assert.rejects(()=>qualify(id(88)),/ai_list_sealed_outbound_source_required/)
await assert.rejects(()=>qualify(company,id(88)),/ediel_tenant_actor_forbidden/)
await db.query("UPDATE public.company_memberships SET status='revoked' WHERE company_id=$1",[company])
await assert.rejects(()=>qualify(),/ediel_tenant_actor_forbidden/)
assert.equal((await db.query("SELECT has_function_privilege('service_role','gridex_ai_processing.require_ai_outbound_source_v1(uuid,uuid,uuid)','EXECUTE') AS allowed")).rows[0].allowed,false)
await db.close()
console.log('PASS: synthetic full AI native codec/purpose/profile/tenant/supplier/network/actor source gate; UTF8 CSV and exact canonical profile derivative. Native/journal replay/RLS/authentic original/actual legal approval NOT RUN.')
