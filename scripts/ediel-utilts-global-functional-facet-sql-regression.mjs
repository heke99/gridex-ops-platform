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

 await db.exec(readFileSync(new URL('../supabase/migrations/20260930212911_ediel_utilts_canonical_functional_response_facets.sql',import.meta.url),'utf8'));checks++
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930220523_ediel_utilts_global_functional_response_facets.sql',import.meta.url),'utf8'));checks++
 const facts={version:1,owner:'canonical-runtime-with-registry-v1',sourceDisposition:'not_established',objectDisposition:'not_checked',partyDisposition:'not_checked',coverage:'canonical_runtime_only',originalTenantMatch:'matched',syntaxDecision:'accepted',applicationDecision:'accepted',functionalDecision:'rejected',messageReference:'DOC',reasonCodes:['ACTUAL_GLOBAL_OWNER_FAULT'],rulePackEvidence:pack}
 const facet={version:1,sourcePayloadHash:hash,transactions:[{transactionIndex:0,transactionId:'GOOD',disposition:'accepted',responseType:'positive_aperak',issueCodes:[]},{transactionIndex:1,transactionId:'BAD',disposition:'processability_rejected',responseType:'utilts_err',issueCodes:['ACTUAL_GLOBAL_OWNER_FAULT']}]}
 const functional={version:2,sourcePayloadHash:hash,transactions:[{transactionIndex:1,transactionId:'BAD',errors:[{code:'E55',ownerIssueCodes:['ACTUAL_GLOBAL_OWNER_FAULT'],originalScope:'message',referenceQualifier:'TN',referenceNumber:null,responseReference:{qualifier:'TN',number:'BAD'}}]}]}
 async function append(u=functional,t=facet,f=facts,c=company){await db.exec('set role service_role');try{return(await db.query("select public.gridex_record_utilts_source_validation_v4($1,'test',$2,$3,$4,$5,NULL,$6) r",[c,source,hash,JSON.stringify(f),t===null?null:JSON.stringify(t),u===null?null:JSON.stringify(u)])).rows[0].r}finally{await db.exec('reset role')}}
 const requireFunctional=()=>db.query('select gridex_received_sources.require_utilts_functional_responses_v1($1,$2) r',[company,source])
 const first=await append();assert.equal(first.version,4);assert.equal(first.headerFactsHash,null);assert.equal(first.functionalFactsHash,createHash('sha256').update(JSON.stringify(functional)).digest('hex'));checks++
 assert.deepEqual((await requireFunctional()).rows[0].r,{version:2,assessmentId:first.assessmentId,sourcePayloadHash:hash,transactions:functional.transactions.map(item=>({...item,errorCodes:['E55']}))});checks++
 await db.exec('BEGIN');await append();await assert.rejects(requireFunctional,/owner_evidence_required/);await db.exec('ROLLBACK');checks++
 const before=(await db.query('select count(*)::int n from gridex_received_sources.validation_assessments')).rows[0].n
 for(const mutate of [u=>u.sourcePayloadHash='0'.repeat(64),u=>u.transactions=[],u=>u.transactions[0].transactionIndex=0,u=>u.transactions[0].transactionId='GOOD',u=>u.transactions[0].errors=[],u=>u.transactions[0].errors[0].code='INTERNAL_ERROR',u=>u.transactions[0].errors[0].referenceNumber='BAD',u=>u.transactions[0].errors[0].responseReference.number='GOOD',u=>u.transactions[0].errors[0].responseReference.qualifier='ACW',u=>u.transactions[0].errors[0].originalScope='unknown',u=>u.transactions[0].errors[0].ownerIssueCodes=['FOREIGN_CODE'],u=>u.transactions[0].errors[0].ownerIssueCodes=[],u=>u.transactions[0].errors[0].ownerIssueCodes.push('ACTUAL_GLOBAL_OWNER_FAULT'),u=>u.transactions[0].errors.push({...u.transactions[0].errors[0]}),u=>u.extra=true,u=>u.transactions[0].extra=true]){const invalid=structuredClone(functional);mutate(invalid);await assert.rejects(append(invalid),/functional_facts_invalid/);checks++}
 assert.equal((await db.query('select count(*)::int n from gridex_received_sources.validation_assessments')).rows[0].n,before);checks++
 const accepted=structuredClone(facet);Object.assign(accepted.transactions[1],{disposition:'accepted',responseType:'positive_aperak',issueCodes:[]});await assert.rejects(append(functional,accepted),/functional_facts_invalid/);checks++
 await assert.rejects(append(functional,null),/functional_facts_invalid/);checks++
 await assert.rejects(append(functional,facet,{...facts,syntaxDecision:'rejected'}),/functional_facts_invalid/);checks++
 await assert.rejects(append(functional,facet,{...facts,functionalDecision:'accepted'}),/functional_facts_invalid/);checks++
 await assert.rejects(append(functional,facet,facts,uid(99)),/functional_facts_invalid/);checks++
 await append(null);await assert.rejects(requireFunctional,/owner_evidence_required/);checks++
 await append();await requireFunctional();checks++
 await db.query("update public.fixture_rule_basis set evidence=jsonb_set(evidence,'{version}','\"25-A-4:r999\"')");await assert.rejects(requireFunctional,/original_rule_witness_mismatch/);checks++
 await db.query('update public.fixture_rule_basis set evidence=$1',[JSON.stringify(pack)]);await requireFunctional();checks++
 const mixed=structuredClone(facet);Object.assign(mixed.transactions[0],{disposition:'guide_rejected',responseType:'negative_aperak',issueCodes:['GUIDE_BAD']});await append(functional,mixed,{...facts,applicationDecision:'rejected'});await requireFunctional();checks++
 // Transaction-origin and truly absent original qualifier remain distinct.
 const own=structuredClone(functional);Object.assign(own.transactions[0].errors[0],{originalScope:'transaction',referenceNumber:'BAD'});await append(own);assert.equal((await requireFunctional()).rows[0].r.transactions[0].errors[0].originalScope,'transaction');checks++
 own.transactions[0].errors[0].referenceQualifier='ACW';await assert.rejects(append(own),/functional_facts_invalid/);checks++
 const absent=structuredClone(functional);absent.transactions[0].errors[0].referenceQualifier=null;await append(absent);assert.equal((await requireFunctional()).rows[0].r.transactions[0].errors[0].referenceQualifier,null);checks++
 // Retained v1 projection dispatch stays byte-for-byte original shape.
 const legacy={version:1,sourcePayloadHash:hash,transactions:[{transactionIndex:1,transactionId:'BAD',errors:[{code:'E55',referenceQualifier:'TN',referenceNumber:'BAD'}]}]}
 await append(legacy);const retained=(await requireFunctional()).rows[0].r;assert.equal(retained.version,1);assert.deepEqual(retained.transactions[0].errors,legacy.transactions[0].errors);checks++
 await append();await requireFunctional();checks++
 await assert.rejects(db.exec('UPDATE gridex_received_sources.utilts_functional_validations_v2 SET functional_facts_hash=functional_facts_hash'),/immutable_source_facet/);checks++
 await assert.rejects(db.exec('TRUNCATE gridex_received_sources.utilts_functional_validations_v2'),/immutable_source_facet/);checks++
 await db.exec('set role authenticated');try{await assert.rejects(()=>db.query("select public.gridex_record_utilts_source_validation_v4(null,null,null,null,null,null,null,null)"),/permission denied/);checks++}finally{await db.exec('reset role')}
 await db.exec('set role service_role');try{await assert.rejects(()=>db.exec('select * from gridex_received_sources.utilts_functional_validations_v2'),/permission denied/);await assert.rejects(()=>db.query('select gridex_received_sources.require_utilts_functional_responses_v1($1,$2)',[company,source]),/permission denied/);checks+=2}finally{await db.exec('reset role')}
 console.log(`Canonical UTILTS functional v4 original-global NULL/explicit own response TN/assigned owner issue codes/immutable v1 dispatch/atomicity/latest committed leaf/original pack/ACL: ${checks} PASS`)
}finally{await db.close()}
