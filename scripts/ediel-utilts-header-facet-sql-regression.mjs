// Actual new append/facet predicates on declared existing-schema boundaries.
// Synthetic registry/source fixtures are not native replay or legal evidence.
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite()
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,company=uid(1),source=uid(2)
const raw="UNA:+.? 'UNH+1+UTILTS:D:02B:UN:E5SE5A'BGM+E66::9+DOC+9+AB'IDE+24+GOOD'IDE+24+BAD'UNT+5+1'",hash=createHash('sha256').update(raw).digest('hex');let checks=0
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA gridex_received_sources;CREATE SCHEMA gridex_utilts_binding;CREATE SCHEMA gridex_ediel_source_rules;
 CREATE TABLE public.ediel_rule_packs(id uuid PRIMARY KEY,market text,family text,guide_version text,guide_revision text,unh_association_code text,valid_from date,valid_to date,source_document text,source_hash text,field_matrix_version text,status text);
 CREATE TABLE public.ediel_message_profiles(id uuid PRIMARY KEY,rule_pack_id uuid,message_code text,transaction_subtype text,direction text,business_process text,phase text,profile_key text,profile jsonb,is_enabled boolean);
 CREATE TABLE public.ediel_runtime_capabilities(rule_pack_id uuid,message_code text,transaction_subtype text,direction text,parser_ready boolean,builder_ready boolean,validator_ready boolean,ack_ready boolean,state_machine_ready boolean);
 CREATE TABLE public.ediel_rule_pack_sources(id uuid PRIMARY KEY,rule_pack_id uuid,title text,source_hash text);
 CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,message_family text,direction text,raw_payload text);
 CREATE TABLE gridex_received_sources.sources(source_message_id uuid PRIMARY KEY,company_id uuid,environment text,payload_hash text,received_context jsonb,raw_payload text);
 CREATE TABLE gridex_received_sources.validation_assessments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_message_id uuid,company_id uuid,environment text,source_payload_hash text,previous_assessment_id uuid,owner text DEFAULT 'canonical-runtime-with-registry-v1',facts_text text,facts_hash text);
 CREATE TABLE public.fixture_rule_basis(evidence jsonb);
 CREATE FUNCTION gridex_ediel_source_rules.require_v1(uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT evidence FROM public.fixture_rule_basis$$;
 CREATE FUNCTION gridex_received_sources.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'immutable_source_facet';END$$;
 CREATE FUNCTION public.gridex_read_inbound_ack_source_v1(uuid,text,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT NULL::jsonb$$;
 GRANT USAGE ON SCHEMA gridex_received_sources TO service_role;
 INSERT INTO public.ediel_rule_packs VALUES('${uid(3)}','electricity','UTILTS','25-A-4','4','E5SE5A','2026-10-01',NULL,'declared synthetic source','${'a'.repeat(64)}','v4','active');
 INSERT INTO public.ediel_message_profiles VALUES('${uid(4)}','${uid(3)}','E66','','inbound','metering',NULL,'UTILTS:E66:E5SE5A:4','{}',true);
 INSERT INTO public.ediel_rule_pack_sources VALUES('${uid(5)}','${uid(3)}','declared synthetic source row','${'b'.repeat(64)}');`)
 await db.query("insert into public.ediel_messages values($1,$2,'test','UTILTS','inbound',$3)",[source,company,raw])
 await db.query("insert into gridex_received_sources.sources values($1,$2,'test',$3,'{\"contextOrigin\":\"database_insert\"}',$4)",[source,company,hash,raw])
 const old=readFileSync(new URL('../supabase/migrations/20260923135706_ediel_utilts_consumption_binding_v1.sql',import.meta.url),'utf8');await db.exec(old.slice(old.indexOf('CREATE FUNCTION gridex_utilts_binding.wire_tokens_v1'),old.indexOf('REVOKE ALL ON FUNCTION gridex_utilts_binding.wire_tokens_v1')))
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930193136_ediel_locked_original_rule_pack_witness.sql',import.meta.url),'utf8'))
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930193740_ediel_utilts_canonical_transaction_facets.sql',import.meta.url),'utf8'));checks++
 const pack=(await db.query("select jsonb_build_object('rulePackId',p.id,'messageProfileId',m.id,'profileKey',m.profile_key,'sourceHash',p.source_hash,'version','25-A-4:r4','snapshot',jsonb_build_object('rulePack',to_jsonb(p),'messageProfile',to_jsonb(m),'guideSources',(select jsonb_agg(to_jsonb(s) order by id) from public.ediel_rule_pack_sources s))) p from public.ediel_rule_packs p join public.ediel_message_profiles m on m.rule_pack_id=p.id")).rows[0].p
 await db.query('insert into public.fixture_rule_basis values($1)',[JSON.stringify(pack)])
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930211020_ediel_utilts_canonical_header_facets.sql',import.meta.url),'utf8'));checks++

 const facts={version:1,owner:'canonical-runtime-with-registry-v1',sourceDisposition:'not_established',objectDisposition:'not_checked',partyDisposition:'not_checked',coverage:'canonical_runtime_only',originalTenantMatch:'matched',syntaxDecision:'accepted',applicationDecision:'rejected',functionalDecision:'accepted',messageReference:'DOC',reasonCodes:['UTILTS_DOCUMENT_AGENCY_INVALID'],rulePackEvidence:pack}
 const facet={version:1,sourcePayloadHash:hash,transactions:['GOOD','BAD'].map((transactionId,transactionIndex)=>({transactionIndex,transactionId,disposition:'guide_rejected',responseType:'negative_aperak',issueCodes:['UTILTS_DOCUMENT_AGENCY_INVALID']}))}
 const header={version:1,sourcePayloadHash:hash,applicationErrors:[{ercCode:'42',fieldCode:'202',text:'INCORRECT DATA 9'}]}
 async function append(h=header,t=facet,f=facts,c=company){await db.exec('set role service_role');try{return(await db.query("select public.gridex_record_utilts_source_validation_v2($1,'test',$2,$3,$4,$5,$6) r",[c,source,hash,JSON.stringify(f),t===null?null:JSON.stringify(t),h===null?null:JSON.stringify(h)])).rows[0].r}finally{await db.exec('reset role')}}
 const requireHeader=()=>db.query('select gridex_received_sources.require_utilts_header_v1($1,$2) r',[company,source])
 const first=await append();assert.equal(first.version,2);assert.equal(first.headerFactsHash,createHash('sha256').update(JSON.stringify(header)).digest('hex'));checks++
 assert.deepEqual((await requireHeader()).rows[0].r,{version:1,assessmentId:first.assessmentId,sourcePayloadHash:hash,applicationErrors:header.applicationErrors});checks++
 await db.exec('BEGIN');await append();await assert.rejects(requireHeader,/owner_evidence_required/);await db.exec('ROLLBACK');checks++
 const before=(await db.query('select count(*)::int n from gridex_received_sources.validation_assessments')).rows[0].n
 for(const mutate of [h=>h.sourcePayloadHash='0'.repeat(64),h=>h.applicationErrors=[],h=>h.applicationErrors[0].ercCode='100',h=>h.applicationErrors[0].fieldCode='',h=>h.applicationErrors[0].text='X\nY',h=>h.extra=true,h=>h.applicationErrors[0].extra=true]){const invalid=structuredClone(header);mutate(invalid);await assert.rejects(append(invalid),/header_facts_invalid/);checks++}
 assert.equal((await db.query('select count(*)::int n from gridex_received_sources.validation_assessments')).rows[0].n,before);checks++
 const accepted=structuredClone(facet);Object.assign(accepted.transactions[0],{disposition:'accepted',responseType:'positive_aperak',issueCodes:[]});await assert.rejects(append(header,accepted),/header_facts_invalid/);checks++
 await assert.rejects(append(header,null),/header_facts_invalid/);checks++
 await assert.rejects(append(header,facet,{...facts,syntaxDecision:'rejected'}),/header_facts_invalid/);checks++
 await assert.rejects(append(header,facet,{...facts,applicationDecision:'accepted'}),/header_facts_invalid/);checks++
 await assert.rejects(append(header,facet,facts,uid(99)),/header_facts_invalid/);checks++
 await append(null);await assert.rejects(requireHeader,/owner_evidence_required/);checks++
 await append();await requireHeader();checks++
 await db.query("update public.fixture_rule_basis set evidence=jsonb_set(evidence,'{version}','\"25-A-4:r999\"')");await assert.rejects(requireHeader,/original_rule_witness_mismatch/);checks++
 await db.query('update public.fixture_rule_basis set evidence=$1',[JSON.stringify(pack)]);await requireHeader();checks++
 await append(header,facet,{...facts,applicationDecision:'manual_review',functionalDecision:'manual_review',rulePackEvidence:null});await assert.rejects(requireHeader,/owner_outcome_mismatch/);checks++
 await append();await requireHeader();checks++
 await assert.rejects(db.exec('UPDATE gridex_received_sources.utilts_header_validations SET header_facts_hash=header_facts_hash'),/immutable_source_facet/);checks++
 await assert.rejects(db.exec('TRUNCATE gridex_received_sources.utilts_header_validations'),/immutable_source_facet/);checks++
 await db.exec('set role authenticated');try{await assert.rejects(()=>db.query("select public.gridex_record_utilts_source_validation_v2(null,null,null,null,null,null,null)"),/permission denied/);checks++}finally{await db.exec('reset role')}
 await db.exec('set role service_role');try{await assert.rejects(()=>db.exec('select * from gridex_received_sources.utilts_header_validations'),/permission denied/);await assert.rejects(()=>db.query('select gridex_received_sources.require_utilts_header_v1($1,$2)',[company,source]),/permission denied/);checks+=2}finally{await db.exec('reset role')}
 console.log(`Canonical UTILTS header v2 atomic append/exact own diagnostics/latest committed leaf/no accepted IDE/immutability/ACL: ${checks} PASS`)
}finally{await db.close()}
