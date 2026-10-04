// Focused embedded PostgreSQL identity/version/atomicity/ACL mechanics.
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
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA extensions;CREATE SCHEMA gridex_utilts_binding;
 CREATE FUNCTION extensions.digest(value bytea,algorithm text) RETURNS bytea LANGUAGE sql IMMUTABLE AS $$SELECT sha256(value) WHERE algorithm='sha256'$$;
 CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_family text,message_code text,raw_payload text);
 CREATE TABLE gridex_utilts_binding.receipts(source_message_id uuid PRIMARY KEY,company_id uuid,environment text,message_code text,raw_hash text,source_context jsonb,membership jsonb,contract_version int CONSTRAINT receipts_contract_version_check CHECK(contract_version=1),bound_at timestamptz);
 CREATE TABLE gridex_utilts_binding.contracts(series_id uuid,company_id uuid,environment text,source_message_id uuid,transaction_id text,contract_version int CONSTRAINT contracts_contract_version_check CHECK(contract_version=1),contract jsonb,contract_hash text);
 CREATE TABLE public.meter_reading_series(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,metering_point_id uuid,source_ediel_message_id uuid,external_metering_point_id text,grid_area_id text,period_start timestamptz,period_end timestamptz,resolution text,unit text,quality_status text,dedupe_key text,message_code text,source_transaction_reference text,series_kind text,product_id text,time_series_product jsonb,actor_context jsonb,registration_date timestamptz,latest_update_date timestamptz,version_no integer,supersedes_series_id uuid,is_current boolean,correction_reason text,raw_transaction jsonb,immutable_hash text,UNIQUE(company_id,dedupe_key));
 CREATE TABLE public.meter_reading_values(id uuid DEFAULT gen_random_uuid(),company_id uuid,series_id uuid,reading_at timestamptz,quantity numeric,unit text,quality text,source_order integer,observation_id text,qualifier text,raw_value text,metadata jsonb);
 CREATE TABLE public.ediel_ack_transaction_results(company_id uuid,environment text,source_message_id uuid,source_transaction_id text,syntax_result text,guide_validation_result text,processability_result text,disposition text,planned_response_type text,final_response_type text,issue_codes text[],persistence_status text,persisted_series_id uuid,persistence_error text,updated_at timestamptz,UNIQUE(company_id,environment,source_message_id,source_transaction_id));
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
 const skip={capability:'skip',reason:'no_attribution',customerId:null,siteId:null,customerSiteId:null,meteringPointId:null,gridOwnerId:null,sourceRequestId:null}
 const contract={version:2,projectionVersion:'utilts-consumption-v2',attributionVersion:'tenant-match-v1',companyId:uid(2),environment:'test',messageCode:'E66',transactionId:' OWN A+B:C?D',seriesKind:'actual',profileKey:null,profileVersion:null,rulePackHash:null,guideRevision:'25-A-4',sourceType:'ediel_utilts',interpretation:{localPeriodStart:null,localPeriodEnd:null,localRegistration:null,resolutionValue:null,resolutionFormat:null,timezoneRaw:null,timezoneFormat:null,offsetMinutes:null,timestampPolicy:'no-consumption-v1'},observations:[],metering:skip,billing:{...skip,requestScope:null,periodStart:null,periodEnd:null,month:null,year:null,status:'received',sourceSystem:'ediel_utilts',currency:'SEK'},billingContributionOrdinals:[]}
 async function validate(c,expected){const r=await db.query('SELECT gridex_utilts_binding.validate_contract_v1($1::jsonb) valid',[JSON.stringify(c)]);assert.equal(r.rows[0].valid,expected);checks++}
 await validate(contract,true)
 for(const transactionId of ['OWN ',' ','X'.repeat(36),'OWN\tREF','OWN\u0100'])await validate({...contract,transactionId},false)
 await validate({...contract,version:1,projectionVersion:'utilts-consumption-v1'},false)
 await validate({...contract,version:1,projectionVersion:'utilts-consumption-v1',transactionId:'LEGACY'},true)
 const company=uid(2),source=uid(1),legacy=uid(3)
 await db.query(`INSERT INTO public.ediel_messages VALUES($1,$2,'test','inbound','UTILTS','E66',$3)`,[source,company,"UNH+1+UTILTS'BGM+E66'IDE+24+ OWN A?+B?:C??D'IDE+24+OWN A?+B?:C??D'UNT+5+1'"])
 await db.query(`INSERT INTO gridex_utilts_binding.receipts(source_message_id,company_id,environment,message_code,contract_version)VALUES($1,$2,'test','E66',2)`,[source,company])
 const item=id=>({transactionId:id,disposition:'accepted',responseType:'positive_aperak',issueCodes:[],seriesKind:'actual',resolution:'PT15M',unit:'KWH',quantities:[{value:'9007199254740993',qualifier:'136',readingAt:'2026-10-01T00:15:00Z',raw:'QTY+136:9007199254740993'}]})
 const items=[item(' OWN A+B:C?D'),item('OWN A+B:C?D')]
 async function persist(sourceId,transactions,tenant=company){return(await db.query(`SELECT gridex_utilts_binding.persist_series_v1($1,'test',$2,'E66',$3::jsonb) result`,[tenant,sourceId,JSON.stringify(transactions)])).rows[0].result}
 const first=await persist(source,items)
 assert.deepEqual(first.map(r=>r.transactionId),items.map(r=>r.transactionId));checks++
 const rows=(await db.query('SELECT source_transaction_reference,raw_transaction FROM public.meter_reading_series ORDER BY source_transaction_reference')).rows
 assert.equal(rows.length,2);assert.deepEqual(rows.map(r=>r.source_transaction_reference),items.map(r=>r.transactionId));checks++
 assert.deepEqual(rows.map(r=>r.raw_transaction.transactionId),items.map(r=>r.transactionId));checks++
 assert.equal((await db.query('SELECT min(quantity)::text amount FROM public.meter_reading_values')).rows[0].amount,'9007199254740993');checks++
 const before=(await db.query('SELECT * FROM public.ediel_ack_transaction_results ORDER BY source_transaction_id')).rows
 const repeated=await persist(source,items)
 assert.deepEqual(repeated.map(r=>r.seriesId),first.map(r=>r.seriesId));assert.ok(repeated.every(r=>r.idempotentReplay));checks++
 assert.deepEqual((await db.query('SELECT * FROM public.ediel_ack_transaction_results ORDER BY source_transaction_id')).rows,before);checks++
 await assert.rejects(persist(source,items,uid(9)),/receipt_missing/);checks++
 await assert.rejects(persist(uid(9),items),/receipt_missing/);checks++
 await db.query(`INSERT INTO public.ediel_messages VALUES($1,$2,'test','inbound','UTILTS','E66',$3)`,[legacy,company,"UNH+1+UTILTS'BGM+E66'IDE+24+LEGACY'UNT+4+1'"])
 await db.query(`INSERT INTO gridex_utilts_binding.receipts(source_message_id,company_id,environment,message_code,contract_version)VALUES($1,$2,'test','E66',1)`,[legacy,company])
 const old=await persist(legacy,[item('LEGACY')]),oldRows=(await db.query('SELECT * FROM public.ediel_ack_transaction_results WHERE source_message_id=$1',[legacy])).rows
 assert.deepEqual(await persist(legacy,[item('LEGACY')]),old.map(r=>({...r,idempotentReplay:true})));checks++
 assert.deepEqual((await db.query('SELECT * FROM public.ediel_ack_transaction_results WHERE source_message_id=$1',[legacy])).rows,oldRows);checks++
 // A sibling failure rolls back its earlier insert/reservation in the SAME
 // actual private owner invocation. No partial logical identity is committed.
 const seriesBefore=(await db.query('SELECT count(*)::int n FROM public.meter_reading_series')).rows[0].n
 await assert.rejects(persist(source,[item('NEW'),item('INVALID ')]),/identity_unsupported/);checks++
 assert.equal((await db.query('SELECT count(*)::int n FROM public.meter_reading_series')).rows[0].n,seriesBefore);checks++
 for(const role of ['anon','authenticated','service_role'])for(const name of ['persist_series_v1','persist_series_v2','persist_series_legacy_v1']) {
  const r=await db.query(`SELECT has_function_privilege($1,$2,'EXECUTE') allowed`,[role,`gridex_utilts_binding.${name}(uuid,text,uuid,text,jsonb)`]);assert.equal(r.rows[0].allowed,false);checks++
 }
 console.log(`PASS ${checks} focused PostgreSQL leading-reference/V2-store/V1-replay/atomicity/ACL checks; native replay pending`)
}finally{await db.close()}
