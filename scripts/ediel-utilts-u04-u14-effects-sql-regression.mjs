// masterplan: U-04, AT-U-04, U-14, AT-U-14
// Effects not covered by the narrow late-version/ERR-dispatcher regressions:
// U-04 positive ACK intent and no ERR/retroactive change for late arrival;
// U-14 atomic series+disposition+ACK intent and the real ordinary-UTILTS
// positive-ACK storage authority refusing received/queued-only data (its
// refusals fire at the reservation check, before the contract lookup that this
// reduced harness does not populate; the positive path stays in native replay).
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
 CREATE TABLE public.ediel_ack_transaction_results(company_id uuid,environment text,source_message_id uuid,source_transaction_id text,syntax_result text,guide_validation_result text,processability_result text,disposition text,planned_response_type text,final_response_type text,issue_codes text[],persistence_status text,persisted_series_id uuid,persistence_error text,updated_at timestamptz,response_message_id uuid,finalized_at timestamptz,UNIQUE(company_id,environment,source_message_id,source_transaction_id));
 -- Object ownership is outside this narrow identity regression; no LOC175
 -- appears in these fixtures. The actual source fence remains in both stores.
 CREATE SCHEMA gridex_ediel_ack_replay;CREATE SCHEMA gridex_ediel_inbound_context;
 -- Boundary fixtures: the replay graph lock and the reduced message-context projection.
 CREATE FUNCTION gridex_ediel_ack_replay.lock_current_graph_v2() RETURNS void LANGUAGE sql AS $$SELECT$$;
 CREATE FUNCTION gridex_utilts_binding.source_context_v1(s public.ediel_messages) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$SELECT jsonb_build_object('id',s.id,'company',s.company_id,'environment',s.environment,'code',s.message_code)$$;
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
 {const fix=fs.readFileSync(root+'/supabase/migrations/20261003150200_ediel_utilts_late_version_and_err_ack_dispatcher.sql','utf8');await db.exec(fix.slice(fix.indexOf('DO $u04$'),fix.indexOf('END$u04$;')+'END$u04$;'.length));checks++}
 const company=uid(2)
 const authoritySql=fs.readFileSync(root+'/supabase/migrations/20261001003807_ediel_utilts_esco_pre_storage_scope.sql','utf8')
 {const at=authoritySql.indexOf('CREATE OR REPLACE FUNCTION public.gridex_require_utilts_positive_ack_authority_v1(');await db.exec(authoritySql.slice(at,authoritySql.indexOf('END $$;',at)+'END $$;'.length))}
 async function message(id,tx){const raw=`UNH+1+UTILTS'BGM+E66+DOC-${tx}+9'IDE+24+${tx}'UNT+4+1'`
  await db.query(`INSERT INTO public.ediel_messages VALUES($1,$2,'test','inbound','UTILTS','E66',$3)`,[id,company,raw])
  await db.query(`INSERT INTO gridex_utilts_binding.receipts(source_message_id,company_id,environment,message_code,raw_hash,source_context,membership,contract_version)
   SELECT m.id,m.company_id,m.environment,m.message_code,encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'),gridex_utilts_binding.source_context_v1(m),jsonb_build_object($2::text,true),2 FROM public.ediel_messages m WHERE m.id=$1`,[id,tx])}
 const item=(tx,latest,value)=>({transactionId:tx,disposition:'accepted',responseType:'positive_aperak',issueCodes:[],seriesKind:'actual',resolution:'PT15M',unit:'KWH',externalMeteringPointId:'735999999999999999',
  periodStart:'2026-09-01T00:00:00Z',periodEnd:'2026-10-01T00:00:00Z',registrationDate:latest,latestUpdateDate:latest,quantities:[{value,qualifier:'136',readingAt:'2026-09-01T00:15:00Z',raw:`QTY+136:${value}`}]})
 const persist=async(id,t)=>(await db.query(`SELECT gridex_utilts_binding.persist_series_v1($1,'test',$2,'E66',$3::jsonb) result`,[company,id,JSON.stringify([t])])).rows[0].result
 const authority=(id,tx)=>db.query(`SELECT public.gridex_require_utilts_positive_ack_authority_v1($1,'test',$2,$3) r`,[company,id,tx])
 const ackRow=async id=>(await db.query(`SELECT * FROM public.ediel_ack_transaction_results WHERE source_message_id=$1`,[id])).rows
 const values=async tx=>(await db.query(`SELECT v.quantity::text q,s.is_current FROM public.meter_reading_values v JOIN public.meter_reading_series s ON s.id=v.series_id WHERE s.source_transaction_reference=$1`,[tx])).rows

 // U-14 prohibited: a received message with a binding receipt but no stored series is not stored data.
 await message(uid(21),'RECEIVED')
 await assert.rejects(authority(uid(21),'RECEIVED'),/utilts_positive_ack_storage_unavailable/);checks++
 // U-14 prohibited: a queued (planned, not persisted) reservation is not stored data either.
 await db.query(`INSERT INTO public.ediel_ack_transaction_results(company_id,environment,source_message_id,source_transaction_id,disposition,planned_response_type,persistence_status)VALUES($1,'test',$2,'RECEIVED','accepted','positive_aperak','queued')`,[company,uid(21)])
 await assert.rejects(authority(uid(21),'RECEIVED'),/utilts_positive_ack_storage_unavailable/);checks++

 // Newer data (532 = 2026-10-02) first, then an older version arrives late.
 await message(uid(11),'NEWER');await persist(uid(11),item('NEWER','2026-10-02T08:00:00Z','10'))
 await message(uid(12),'OLDER');const [late]=await persist(uid(12),item('OLDER','2026-09-20T08:00:00Z','7'))
 // U-04 on_pass: late arrival alone is no rejection; positive APERAK is planned.
 assert.deepEqual({d:late.disposition,r:late.responseType,p:late.persistenceStatus},{d:'accepted',r:'positive_aperak',p:'persisted'});checks++
 // U-14 expected: series, disposition and ACK intent are written in the same call and bind each other.
 const [reservation]=await ackRow(uid(12))
 assert.equal(reservation.persisted_series_id,late.seriesId);assert.equal(reservation.planned_response_type,'positive_aperak')
 assert.equal(reservation.disposition,'accepted');assert.deepEqual(reservation.issue_codes,[]);checks++
 // U-04 prohibited: no ERR is planned and the newer current data (the billing basis) is untouched.
 assert.equal((await db.query(`SELECT count(*)::int n FROM public.ediel_ack_transaction_results WHERE planned_response_type<>'positive_aperak' OR cardinality(issue_codes)>0`)).rows[0].n,0)
 assert.equal((await db.query(`SELECT count(*)::int n FROM public.ediel_messages WHERE direction='outbound'`)).rows[0].n,0);checks++
 assert.deepEqual(await values('NEWER'),[{q:'10',is_current:true}]);assert.deepEqual(await values('OLDER'),[{q:'7',is_current:false}]);checks++
 // U-14 atomic rollback: a storage failure leaves neither series nor ACK intent behind.
 await message(uid(13),'BROKEN')
 await assert.rejects(persist(uid(13),{...item('BROKEN','2026-10-03T08:00:00Z','x'),quantities:[{value:'x',qualifier:'136',readingAt:'not-a-time',raw:'QTY+136:x'}]}))
 assert.deepEqual(await ackRow(uid(13)),[]);assert.deepEqual(await values('BROKEN'),[]);checks++
 await assert.rejects(authority(uid(13),'BROKEN'),/utilts_positive_ack_storage_unavailable/);checks++
 console.log(`PASS ${checks} U-04/U-14 effect checks (focused PGlite mechanics, not native replay)`)
}finally{await db.close()}
