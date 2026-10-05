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
 // U-04: apply only the late-version part of the forward migration when asked.
 if(process.env.U04_APPLY_FIX!=='0'){const fix=fs.readFileSync(root+'/supabase/migrations/20261003150200_ediel_utilts_late_version_and_err_ack_dispatcher.sql','utf8');await db.exec(fix.slice(fix.indexOf('DO $u04$'),fix.indexOf('END$u04$;')+'END$u04$;'.length));checks++}
 const company=uid(2)
 async function message(id,tx){await db.query(`INSERT INTO public.ediel_messages VALUES($1,$2,'test','inbound','UTILTS','E66',$3)`,[id,company,`UNH+1+UTILTS'BGM+E66'IDE+24+${tx}'UNT+4+1'`]);await db.query(`INSERT INTO gridex_utilts_binding.receipts(source_message_id,company_id,environment,message_code,contract_version)VALUES($1,$2,'test','E66',2)`,[id,company])}
 const item=(tx,latest,value)=>({transactionId:tx,disposition:'accepted',responseType:'positive_aperak',issueCodes:[],seriesKind:'actual',resolution:'PT15M',unit:'KWH',externalMeteringPointId:'735999999999999999',
  periodStart:'2026-09-01T00:00:00Z',periodEnd:'2026-10-01T00:00:00Z',registrationDate:latest,latestUpdateDate:latest,quantities:[{value,qualifier:'136',readingAt:'2026-09-01T00:15:00Z',raw:`QTY+136:${value}`}]})
 async function persist(id,t){return(await db.query(`SELECT gridex_utilts_binding.persist_series_v1($1,'test',$2,'E66',$3::jsonb) result`,[company,id,JSON.stringify([t])])).rows[0].result}
 const current=async()=>(await db.query(`SELECT source_transaction_reference tx FROM public.meter_reading_series WHERE company_id=$1 AND is_current`,[company])).rows.map(r=>r.tx)
 // Newer data (532 = 2026-10-02) arrives first, an older version (532 = 2026-09-20) arrives late.
 await message(uid(11),'NEWER');await persist(uid(11),item('NEWER','2026-10-02T08:00:00Z','10'))
 await message(uid(12),'OLDER');const late=await persist(uid(12),item('OLDER','2026-09-20T08:00:00Z','7'))
 assert.equal(late.length,1);checks++
 assert.deepEqual(await current(),['NEWER'],'a late older version must not displace newer current data');checks++
 const rows=(await db.query(`SELECT source_transaction_reference tx,is_current,supersedes_series_id FROM public.meter_reading_series WHERE company_id=$1 ORDER BY tx`,[company])).rows
 assert.equal(rows.length,2,'older history is retained');assert.equal(rows.find(r=>r.tx==='OLDER').supersedes_series_id,null);checks++
 // A genuinely newer correction still supersedes the current version.
 await message(uid(13),'NEWEST');await persist(uid(13),item('NEWEST','2026-10-03T08:00:00Z','11'))
 assert.deepEqual(await current(),['NEWEST']);checks++
 // SC-046: the source may carry only field 512 (registration) or only field 532
 // (latest update). Each shape alone keeps newer current data on a late older arrival.
 for(const [label,field,mp] of [['512-only','registrationDate','735999999999999512'],['532-only','latestUpdateDate','735999999999999532']]){
  const shaped=(tx,at,value)=>({...item(tx,null,value),externalMeteringPointId:mp,registrationDate:null,latestUpdateDate:null,[field]:at})
  const cur=async()=>(await db.query(`SELECT source_transaction_reference tx FROM public.meter_reading_series WHERE company_id=$1 AND external_metering_point_id=$2 AND is_current`,[company,mp])).rows.map(r=>r.tx)
  const n=label==='512-only'?20:30
  await message(uid(n),label+'-NEWER');await persist(uid(n),shaped(label+'-NEWER','2026-10-02T08:00:00Z','10'))
  await message(uid(n+1),label+'-OLDER');const older=await persist(uid(n+1),shaped(label+'-OLDER','2026-09-20T08:00:00Z','7'))
  assert.equal(older[0].disposition,'accepted',label);assert.equal(older[0].responseType,'positive_aperak',label);checks++
  assert.deepEqual(await cur(),[label+'-NEWER'],label+': a late older version must not displace newer current data');checks++
 }
 console.log(`PASS ${checks} U-04 late-version checks (focused PGlite mechanics, not native replay)`)
}finally{await db.close()}
