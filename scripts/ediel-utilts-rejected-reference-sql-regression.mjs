// Focused actual parser/bound owner/V3 negative/atomicity/ACL mechanics.
// Declared source fixtures and reduced row schema are not native replay,
// canonical/legal market evidence, generated schema/type parity or activation.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import {pathToFileURL,fileURLToPath} from 'node:url'
if(!process.env.EDIEL_PGLITE_MODULE)throw new Error('EDIEL_PGLITE_MODULE required')
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const root=fileURLToPath(new URL('..',import.meta.url)),db=new PGlite(),uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
let checks=0
try {
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA extensions;CREATE SCHEMA gridex_utilts_binding; CREATE SCHEMA gridex_received_sources;CREATE SCHEMA gridex_ediel_source_rules;CREATE SCHEMA gridex_ediel_inbound_context;CREATE SCHEMA gridex_billing_source;CREATE SCHEMA gridex_ediel_ack_guide;
 CREATE FUNCTION extensions.digest(value bytea,algorithm text) RETURNS bytea LANGUAGE sql IMMUTABLE AS $$SELECT sha256(value) WHERE algorithm='sha256'$$;
 CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_family text,message_code text,raw_payload text);
 CREATE TABLE gridex_utilts_binding.receipts(source_message_id uuid PRIMARY KEY,company_id uuid,environment text,message_code text,raw_hash text,source_context jsonb,membership jsonb,contract_version int CONSTRAINT receipts_contract_version_check CHECK(contract_version=1),bound_at timestamptz DEFAULT now());
 CREATE TABLE gridex_utilts_binding.contracts(series_id uuid,company_id uuid,environment text,source_message_id uuid,transaction_id text,contract_version int CONSTRAINT contracts_contract_version_check CHECK(contract_version=1),contract jsonb,contract_hash text);
 CREATE TABLE public.meter_reading_series(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,metering_point_id uuid,source_ediel_message_id uuid,external_metering_point_id text,grid_area_id text,period_start timestamptz,period_end timestamptz,resolution text,unit text,quality_status text,dedupe_key text,message_code text,source_transaction_reference text,series_kind text,product_id text,time_series_product jsonb,actor_context jsonb,registration_date timestamptz,latest_update_date timestamptz,version_no integer,supersedes_series_id uuid,is_current boolean,correction_reason text,raw_transaction jsonb,immutable_hash text,UNIQUE(company_id,dedupe_key));
 CREATE TABLE public.meter_reading_values(id uuid DEFAULT gen_random_uuid(),company_id uuid,series_id uuid,reading_at timestamptz,quantity numeric,unit text,quality text,source_order integer,observation_id text,qualifier text,raw_value text,metadata jsonb);
 CREATE TABLE public.ediel_ack_transaction_results(company_id uuid,environment text,source_message_id uuid,source_transaction_id text,syntax_result text,guide_validation_result text,processability_result text,disposition text,planned_response_type text,final_response_type text,issue_codes text[],persistence_status text,persisted_series_id uuid,persistence_error text,finalized_at timestamptz,updated_at timestamptz,UNIQUE(company_id,environment,source_message_id,source_transaction_id));
 -- Object ownership is outside this narrow identity regression; no LOC175
 -- appears in these fixtures. The actual source fence remains in both stores.
 CREATE FUNCTION gridex_utilts_binding.unowned_regulating_object_v1(jsonb,text) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;`)
 const binding=fs.readFileSync(root+'/supabase/migrations/20260923135706_ediel_utilts_consumption_binding_v1.sql','utf8')
 await db.exec(binding.slice(binding.indexOf('CREATE FUNCTION gridex_utilts_binding.wire_tokens_v1'),binding.indexOf('REVOKE ALL ON FUNCTION gridex_utilts_binding.wire_tokens_v1')))
 await db.exec(binding.slice(binding.indexOf('CREATE FUNCTION gridex_utilts_binding.exact_keys_v1'),binding.indexOf('CREATE FUNCTION gridex_utilts_binding.validate_contract_v1')))
 const validators=fs.readFileSync(root+'/supabase/migrations/20260923150649_ediel_utilts_bound_sink_authority.sql','utf8')
 await db.exec(validators.slice(validators.indexOf('CREATE FUNCTION gridex_utilts_binding.validate_contract_base_v1'),validators.indexOf('-- Authoritative lookup')))
 await db.exec(fs.readFileSync(root+'/supabase/migrations/20260928181500_utilts_held_retry_stable_reservation.sql','utf8'))
 await db.exec(fs.readFileSync(root+'/supabase/migrations/20260930145350_ediel_utilts_exact_decimal_contract_v2.sql','utf8'))
 await db.exec(fs.readFileSync(root+'/supabase/migrations/20261001010230_ediel_utilts_lossless_transaction_reference_v2.sql','utf8'));checks++

 await db.exec(`ALTER TABLE public.ediel_messages ADD sender_ediel_id text,ADD receiver_ediel_id text,ADD sender_sub_address text,ADD receiver_sub_address text,ADD interchange_reference text,ADD transaction_reference text,ADD application_reference text,ADD original_message_id uuid,ADD external_reference text;`)
 await db.exec(binding.slice(binding.indexOf('CREATE FUNCTION gridex_utilts_binding.source_context_v1'),binding.indexOf('CREATE FUNCTION gridex_utilts_binding.guard_source_v1')))
 await db.exec(fs.readFileSync(root+'/supabase/migrations/20260928215000_utilts_late_172_physical_ide_fence.sql','utf8'))
 await db.exec(fs.readFileSync(root+'/supabase/migrations/20260930161718_ediel_utilts_e30_energy_source_and_null_quality.sql','utf8'))
 // Canonical ownfacet, immutable named pack/legal and response edition are
 // declared IO fixtures. The actual public/private owner, lexer, validators,
 // series store, outcome immutability and role grants below are executed.
 await db.exec(`CREATE TABLE gridex_received_sources.fixture_owners(company uuid,source uuid,raw_hash text,transaction_id text,disposition text,response_type text,issues jsonb);
 CREATE FUNCTION gridex_received_sources.require_utilts_transaction_v1(c uuid,s uuid,t text,d text,r text,i jsonb) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF NOT EXISTS(SELECT FROM gridex_received_sources.fixture_owners o JOIN public.ediel_messages m ON m.id=o.source WHERE o.company=c AND o.source=s AND o.transaction_id=t AND o.disposition=d AND o.response_type=r AND o.issues=i AND o.raw_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')) THEN RAISE EXCEPTION 'fixture_committed_own_facet_required';END IF; END$$;
 CREATE FUNCTION gridex_ediel_source_rules.require_v1(uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{"fixtureImmutableNamedWitness":true}'::jsonb$$;
 CREATE FUNCTION gridex_ediel_inbound_context.require_v1(uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{"fixtureProtectedLegalContext":true}'::jsonb$$;
 CREATE FUNCTION gridex_billing_source.basis_v1(uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{"qualified":false}'::jsonb$$;
 CREATE TABLE gridex_ediel_ack_guide.editions(source_version text primary key,input_manifest jsonb,projection jsonb);CREATE TABLE gridex_ediel_ack_guide.edition_extensions(original_source_version text primary key,extended_source_version text);
 CREATE TABLE public.normalized_metering_values(id uuid,company_id uuid,source_message_id uuid,source_transaction_reference text);`)
 const publication=fs.readFileSync(root+'/supabase/migrations/20261001034855_ediel_prodat_aperak_unused_document_fields.sql','utf8')
 await db.exec(publication.slice(publication.indexOf('-- BEGIN CANONICAL RESPONSE GUIDE PROJECTION'),publication.indexOf('-- END CANONICAL RESPONSE GUIDE PROJECTION')))
 const dm=fs.readFileSync(root+'/supabase/migrations/20261001051413_ediel_utilts_aperak_dm_source_capacity.sql','utf8')
 await db.exec(dm.slice(dm.indexOf('CREATE FUNCTION gridex_ediel_ack_guide.utilts_reference_constraints_v1'),dm.indexOf('CREATE OR REPLACE FUNCTION gridex_ediel_wire_namespace.keys')))
 await db.exec(fs.readFileSync(root+'/supabase/migrations/20260930191608_ediel_utilts_source_precision_guards.sql','utf8'))
 await db.exec(fs.readFileSync(root+'/supabase/migrations/20261001053437_ediel_utilts_rejected_reference_diagnostic_v3.sql','utf8'));checks++
 const company=uid(2),source=uid(1),ids=['OWN','X'.repeat(36),'X'.repeat(70)]
 const skip={capability:'skip',reason:'no_consumption',customerId:null,siteId:null,customerSiteId:null,meteringPointId:null,gridOwnerId:null,sourceRequestId:null}
 const contract=id=>({version:id==='OWN'?2:3,projectionVersion:id==='OWN'?'utilts-consumption-v2':'utilts-rejected-diagnostic-v3',attributionVersion:'tenant-match-v1',companyId:company,environment:'test',messageCode:'E66',transactionId:id,seriesKind:'actual',profileKey:null,profileVersion:null,rulePackHash:null,guideRevision:'25-A-4',sourceType:'ediel_utilts',interpretation:{localPeriodStart:null,localPeriodEnd:null,localRegistration:null,resolutionValue:null,resolutionFormat:null,timezoneRaw:null,timezoneFormat:null,offsetMinutes:null,timestampPolicy:'no-consumption-v1'},observations:[],metering:skip,billing:{...skip,requestScope:null,periodStart:null,periodEnd:null,month:null,year:null,status:'received',sourceSystem:'ediel_utilts',currency:'SEK'},billingContributionOrdinals:[]})
 const item=id=>({transactionId:id,disposition:id==='OWN'?'accepted':'guide_rejected',responseType:id==='OWN'?'positive_aperak':'negative_aperak',issueCodes:id==='OWN'?[]:['UTILTS_TRANSACTION_ID_INVALID'],seriesKind:'actual',externalMeteringPointId:'735999260731000007',resolution:'PT15M',unit:'KWH',quantities:[{value:'500',qualifier:'136',readingAt:'2026-10-01T00:15:00Z',raw:'QTY+136:500'}],consumptionContract:contract(id)})
 const ownWire=id=>`IDE+24+${id}'LOC+172+735999260731000007::9'LIN+++8716867000030:::9'DTM+354:15:806'M EA+AAZ++KWH'SEQ++1'QTY+136:500'`.replace('M EA','MEA')
 const raw=`UNH+1+UTILTS:D:02B:UN:E5SE5A'BGM+E66::260+DOC+9+AB'NAD+MS+91100:SVK:260'NAD+MR+21660:SVK:260'${ids.map(ownWire).join('')}UNT+27+1'`
 await db.query("INSERT INTO public.ediel_messages VALUES($1,$2,'test','inbound','UTILTS','E66',$3)",[source,company,raw])
 for(const transaction of ids.map(item))await db.query("INSERT INTO gridex_received_sources.fixture_owners VALUES($1,$2,encode(sha256(convert_to($3,'UTF8')),'hex'),$4,$5,$6,$7)",[company,source,raw,transaction.transactionId,transaction.disposition,transaction.responseType,transaction.issueCodes])
 async function call(items,tenant=company,wire=raw){await db.exec('SET ROLE service_role');try{return(await db.query("SELECT public.gridex_persist_utilts_consumption_v1($1,'test',$2,'E66',$3,$4) result",[tenant,source,wire,items])).rows[0].result}finally{await db.exec('RESET ROLE')}}
 const items=ids.map(item),before=await call(items)
 assert.deepEqual(before.map(row=>[row.transactionId,row.persistenceStatus]),[['OWN','persisted'],[ids[1],'not_applicable'],[ids[2],'not_applicable']]);checks++
 assert.equal((await db.query('SELECT count(*)::int n FROM public.meter_reading_series')).rows[0].n,1);checks++
 assert.equal((await db.query('SELECT count(*)::int n FROM gridex_utilts_binding.contracts WHERE contract_version=2')).rows[0].n,1);checks++
 assert.equal((await db.query('SELECT count(*)::int n FROM public.meter_reading_values')).rows[0].n,1);checks++
 assert.equal((await db.query('SELECT contract_version FROM gridex_utilts_binding.receipts')).rows[0].contract_version,2);checks++
 assert.ok(before.slice(1).every(row=>!row.consumptionContract&&!row.seriesId));checks++
 const outcomes=(await db.query('SELECT * FROM public.ediel_ack_transaction_results ORDER BY source_transaction_id')).rows
 assert.equal((await call(items))[0].seriesId,before[0].seriesId);checks++
 assert.deepEqual((await db.query('SELECT * FROM public.ediel_ack_transaction_results ORDER BY source_transaction_id')).rows,outcomes);checks++
 for(const [field,value] of [['observations',[{}]],['billingContributionOrdinals',[0]],['transactionId','OWN'],['version',2]]){
  const bad=structuredClone(items);bad[1].consumptionContract[field]=value;await assert.rejects(call(bad),/contract_invalid/);checks++
 }
 const badPositive=structuredClone(items);badPositive[1].disposition='accepted';badPositive[1].responseType='positive_aperak'
 await assert.rejects(call(badPositive),/fixture_committed_own_facet_required/);checks++
 await assert.rejects(call(items,uid(9)),/source_binding_conflict/);checks++
 await assert.rejects(call(items,company,raw+' '),/source_binding_conflict/);checks++
 await db.exec("UPDATE gridex_received_sources.fixture_owners SET issues='[]' WHERE transaction_id<>'OWN'")
 await assert.rejects(call(items),/fixture_committed_own_facet_required/);checks++
 // A genuine already finalized negative retry precedes today's unavailable
 // facet. It remains bound to exactly the same source/raw/outcome receipt.
 await db.exec("UPDATE public.ediel_ack_transaction_results SET finalized_at=now() WHERE disposition='guide_rejected'")
 await call(items);checks++
 const finalRows=(await db.query('SELECT * FROM public.ediel_ack_transaction_results ORDER BY source_transaction_id')).rows
 await call(items);assert.deepEqual((await db.query('SELECT * FROM public.ediel_ack_transaction_results ORDER BY source_transaction_id')).rows,finalRows);checks++
 // Model an authentic pre-existing frozen V1 negative receipt explicitly;
 // its source tuple/raw hash and fixed own outcome must remain untouched.
 const legacy=uid(9),legacyRaw=raw.replace("IDE+24+OWN'", "IDE+24+LEGACY'")
 const legacyIds=['LEGACY',...ids.slice(1)],legacyItems=legacyIds.map(id=>({...item(id),disposition:'guide_rejected',responseType:'negative_aperak',issueCodes:id==='LEGACY'?['OLD_GUIDE']:['UTILTS_TRANSACTION_ID_INVALID'],consumptionContract:id==='LEGACY'?{...contract(id),version:2,projectionVersion:'utilts-consumption-v2'}:contract(id)}))
 await db.query("INSERT INTO public.ediel_messages VALUES($1,$2,'test','inbound','UTILTS','E66',$3)",[legacy,company,legacyRaw])
 await db.query("INSERT INTO gridex_utilts_binding.receipts VALUES($1,$2,'test','E66',encode(sha256(convert_to($3,'UTF8')),'hex'),gridex_utilts_binding.source_context_v1((SELECT m FROM public.ediel_messages m WHERE id=$1)),$4,1,now())",[legacy,company,legacyRaw,legacyIds])
 for(const id of legacyIds)await db.query("INSERT INTO public.ediel_ack_transaction_results(company_id,environment,source_message_id,source_transaction_id,disposition,planned_response_type,final_response_type,issue_codes,persistence_status,finalized_at)VALUES($1,'test',$2,$3,'guide_rejected','negative_aperak','negative_aperak',$4::text[],'not_applicable',now())",[company,legacy,id,id==='LEGACY'?['OLD_GUIDE']:['UTILTS_TRANSACTION_ID_INVALID']])
 const oldRows=(await db.query('SELECT * FROM public.ediel_ack_transaction_results WHERE source_message_id=$1 ORDER BY source_transaction_id',[legacy])).rows
 await db.exec('SET ROLE service_role');try{const result=(await db.query("SELECT public.gridex_persist_utilts_consumption_v1($1,'test',$2,'E66',$3,$4) result",[company,legacy,legacyRaw,legacyItems])).rows[0].result;assert.ok(result.every(row=>row.persistenceStatus==='not_applicable'));checks++}finally{await db.exec('RESET ROLE')}
 assert.deepEqual((await db.query('SELECT * FROM public.ediel_ack_transaction_results WHERE source_message_id=$1 ORDER BY source_transaction_id',[legacy])).rows,oldRows);checks++
 assert.equal((await db.query('SELECT contract_version FROM gridex_utilts_binding.receipts WHERE source_message_id=$1',[legacy])).rows[0].contract_version,1);checks++
 assert.equal((await db.query('SELECT count(*)::int n FROM public.meter_reading_series')).rows[0].n,1);checks++
 for(const role of ['anon','authenticated','service_role'])for(const name of ['validate_rejected_contract_v3(jsonb)','valid_rejected_item_v3(jsonb)','persist_consumption_before_precision_v1(uuid,text,uuid,text,text,jsonb)']){
  assert.equal((await db.query("SELECT has_function_privilege($1,$2,'EXECUTE') allowed",[role,'gridex_utilts_binding.'+name])).rows[0].allowed,false);checks++
 }
 await db.exec('SET ROLE authenticated');try{await assert.rejects(()=>db.query("SELECT public.gridex_persist_utilts_consumption_v1(null,null,null,null,null,'[]')"),/permission denied/);checks++}finally{await db.exec('RESET ROLE')}
 console.log(`Focused rejected V3/current public owner/V2/mixed atomic effects/old negative replay/ACL mechanics: ${checks} PASS`)
}finally{await db.close()}
