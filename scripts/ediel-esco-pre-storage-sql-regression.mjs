// Actual pre-storage/precision/current-private-review SQL over bounded synthetic
// source-facet/storage dependencies. Not native, concurrency or external proof.
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
const base=readFileSync(new URL('./ediel-service-evidence-sql-regression.mjs',import.meta.url),'utf8')
const marker=" console.log('Actual ESCO archived-source/issuer/separate-review/current-grant mechanism: "
assert.equal(base.split(marker).length,2)
const extension=String.raw`
 const bindingSql=readFileSync(new URL('../supabase/migrations/20260923135706_ediel_utilts_consumption_binding_v1.sql',import.meta.url),'utf8')
 const piece=(sql,prefix)=>{const start=sql.indexOf(prefix),end=sql.indexOf('END $$;',start);assert.ok(start>=0&&end>start,prefix);return sql.slice(start,end+7)}
 for(const name of ['exact_keys_v1','absolute_v1','validate_contract_v1'])await db.exec(piece(bindingSql,'CREATE FUNCTION gridex_utilts_binding.'+name).replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION'))
 await db.exec(piece(readFileSync(new URL('../supabase/migrations/20260928130148_utilts_mixed_172_175_consumption_fence.sql',import.meta.url),'utf8'),'CREATE OR REPLACE FUNCTION gridex_utilts_binding.supported_point_v1'))
 await db.exec("CREATE TABLE gridex_ediel_inbound_context.receipts(source_message_id uuid,company_id uuid,environment text,status text,context jsonb);CREATE SCHEMA gridex_ediel_source_rules;CREATE TABLE public.esco_facet_fixture(sourceid uuid,transactionid text,disposition text,response text,allowed bool);CREATE TABLE public.esco_storage_effect_fixture(kind text);ALTER TABLE ediel_ack_transaction_results ADD finalized_at timestamptz;ALTER TABLE gridex_utilts_binding.receipts ADD company_id uuid,ADD environment text,ADD raw_hash text,ADD source_context jsonb,ADD contract_version integer;CREATE TABLE public.user_permission_overrides(id uuid);CREATE TABLE public.metering_points(id uuid,company_id uuid,customer_id uuid,ediel_metering_point_id text,meter_point_id text,metering_point_id text,customer_site_id uuid,site_id uuid);ALTER TABLE meter_reading_series ADD raw_transaction jsonb,ADD immutable_hash text;ALTER TABLE ediel_messages ADD sender_ediel_id text,ADD receiver_ediel_id text,ADD sender_sub_address text,ADD receiver_sub_address text,ADD interchange_reference text,ADD transaction_reference text,ADD original_message_id uuid,ADD external_reference text;")
 // Real immutable comparison functions; the historical storage tables here
 // remain declared finite dependencies, never native accepted-data evidence.
 const sourceContext=bindingSql.match(/CREATE FUNCTION gridex_utilts_binding\.source_context_v1[\s\S]*?\$\$;/)[0];await db.exec(sourceContext)
 const exactSql=readFileSync(new URL('../supabase/migrations/20260930145350_ediel_utilts_exact_decimal_contract_v2.sql',import.meta.url),'utf8');await db.exec(piece(exactSql,'CREATE FUNCTION gridex_utilts_binding.legacy_retry_item_v1'))
 // Finite explicit lower owner dependencies; no caller acceptance is trusted.
 await db.exec("CREATE FUNCTION gridex_received_sources.require_utilts_transaction_v1(c uuid,s uuid,t text,d text,r text,i jsonb) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF NOT EXISTS(SELECT FROM public.esco_facet_fixture x WHERE x.sourceid=s AND x.transactionid=t AND x.disposition=d AND x.response=r AND x.allowed) THEN RAISE EXCEPTION 'actual_source_facet_unavailable';END IF;END$$;CREATE FUNCTION gridex_ediel_source_rules.require_v1(c uuid,s uuid) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF NOT EXISTS(SELECT FROM public.esco_facet_fixture x WHERE x.sourceid=s AND x.allowed) THEN RAISE EXCEPTION 'actual_source_rules_unavailable';END IF;END$$;")
 await db.exec("CREATE FUNCTION gridex_utilts_binding.persist_consumption_before_precision_v1(c uuid,e text,s uuid,code text,raw text,t jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN INSERT INTO public.esco_storage_effect_fixture VALUES('lower_storage_entered');RETURN t;END$$;")
 const precisionSql=readFileSync(new URL('../supabase/migrations/20260930191608_ediel_utilts_source_precision_guards.sql',import.meta.url),'utf8')
 await db.exec(piece(precisionSql,'CREATE FUNCTION gridex_utilts_binding.decimal_rules_v1'));await db.exec(piece(precisionSql,'CREATE FUNCTION public.gridex_persist_utilts_consumption_v1'));await db.exec('GRANT EXECUTE ON FUNCTION public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb) TO service_role')
 const storageRaw="UNB+UNOC:3+54321:ZZ+21660:ZZ+261001:1200+STORAGE++23-DGI-E66-T++++1'UNH+1+UTILTS:D:02B:UN:E5SE5A'BGM+E66::260+OWN+9+AB'DTM+735:?+0200:406'NAD+MS+54321:SVK:260'NAD+MR+21660:SVK:260'NAD+DGI'IDE+24+tx'LOC+172+point-a::9'LIN+++8716867000030:::9'DTM+324:202607010000202607010015:719'DTM+354:15:806'M EA+AAZ++KWH'SEQ++1'QTY+136:500'UNT+15+1'UNZ+1+STORAGE'".replace('M EA','MEA')
 const attribution={capability:'skip',reason:'bounded unrelated consumer withheld',customerId:null,siteId:null,customerSiteId:null,meteringPointId:null,gridOwnerId:null,sourceRequestId:null}
 const ownContract={version:1,projectionVersion:'utilts-consumption-v1',attributionVersion:'tenant-match-v1',companyId:uid(1),environment:'test',messageCode:'E66',transactionId:'tx',seriesKind:'actual',profileKey:null,profileVersion:null,rulePackHash:null,guideRevision:'bounded',interpretation:{localPeriodStart:'2026-07-01T00:00:00',localPeriodEnd:'2026-07-01T00:15:00',localRegistration:null,resolutionValue:'15',resolutionFormat:'806',timezoneRaw:'+0200',timezoneFormat:'406',offsetMinutes:120,timestampPolicy:'explicit-offset-v1'},observations:[],metering:attribution,billing:{...attribution,requestScope:null,periodStart:null,periodEnd:null,month:null,year:null,status:'received',sourceSystem:'ediel_utilts',currency:'SEK'},billingContributionOrdinals:[],sourceType:'ediel_utilts'}
 const storageItem={transactionId:'tx',disposition:'accepted',responseType:'positive_aperak',issueCodes:[],seriesKind:'actual',externalMeteringPointId:'point-a',productId:'8716867000030',periodStart:'2026-06-30T22:00:00Z',periodEnd:'2026-06-30T22:15:00Z',consumptionContract:ownContract}
 await db.query('UPDATE ediel_messages SET raw_payload=$1 WHERE id=$2',[storageRaw,uid(210)]);await db.query('INSERT INTO gridex_ediel_inbound_context.receipts VALUES($1,$2,\'test\',\'ready\',$3)',[uid(210),uid(1),serviceBasis]);await db.query("INSERT INTO esco_facet_fixture VALUES($1,'tx','accepted','positive_aperak',true)",[uid(210)]);await db.exec('DELETE FROM ediel_ack_transaction_results')
 const storageCall=async(item=storageItem)=>{await db.exec('SET ROLE service_role');try{return(await db.query('SELECT gridex_persist_utilts_consumption_v1($1,$2,$3,$4,$5,$6) r',[uid(1),'test',uid(210),'E66',storageRaw,[item]])).rows[0].r}finally{await db.exec('RESET ROLE').catch(()=>{})}}
 // RED: exact previous public precision wrapper reaches storage with missing
 // native private review. We revoke a real archived/reviewed evidence row.
 await db.exec('BEGIN');await db.query("UPDATE ediel_service_evidence SET status='revoked' WHERE id=$1",[lastEvidence]);assert.equal((await heldAssessment()).status,'held');await storageCall();assert.equal((await db.query('SELECT count(*) n FROM esco_storage_effect_fixture')).rows[0].n,1);await db.exec('ROLLBACK')
 const forward=new URL('../supabase/migrations/20261001003807_ediel_utilts_esco_pre_storage_scope.sql',import.meta.url),oldOid=(await db.query("SELECT 'public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb)'::regprocedure::oid o")).rows[0].o
 // The preceding scope fixture deliberately used a finite source-only
 // positive-authority port with different parameter names. Rename that fixture
 // before installing the authentic full SEND body; this does not claim its OID
 // retention or execute its native storage/reservation/wire checks.
 await db.exec('ALTER FUNCTION public.gridex_require_utilts_positive_ack_authority_v1(uuid,text,uuid,text,uuid,text) RENAME TO finite_positive_authority_fixture_v1')
 await db.exec(readFileSync(forward,'utf8'));assert.equal((await db.query("SELECT 'public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb)'::regprocedure::oid o")).rows[0].o,oldOid)
 let storageChecks=1;const storageEffects=async()=>(await db.query('SELECT count(*) n FROM esco_storage_effect_fixture')).rows[0].n
 const probe=async(change,pattern)=>{const effects=await storageEffects();await db.exec('BEGIN');try{await db.exec(change);await db.exec('SAVEPOINT gate');await assert.rejects(storageCall(),pattern);await db.exec('ROLLBACK TO SAVEPOINT gate');assert.equal(await storageEffects(),effects)}finally{await db.exec('ROLLBACK')}storageChecks++}
 await storageCall();assert.equal(await storageEffects(),1);storageChecks++
 await probe("UPDATE ediel_service_evidence SET status='revoked' WHERE id='"+lastEvidence+"'",/unique_current_grant_required/)
 await probe("UPDATE ediel_data_access_grants SET status='revoked',revoked_at=now()",/unique_current_grant_required/)
 await probe("UPDATE company_memberships SET is_active=false WHERE user_id='"+reviewer+"'",/unique_current_grant_required/)
 await probe("UPDATE user_permissions SET is_active=false WHERE user_id='"+reviewer+"'",/unique_current_grant_required/)
 await probe("INSERT INTO gridex_ediel_services.issuer_revocations VALUES('key','"+keyid+"','SYNTHETIC REVOKED',repeat('a',64),now())",/unique_current_grant_required/)
 await probe("UPDATE metering_permission_sites SET end_at='2026-06-30'",/unique_current_grant_required/)
 await probe("UPDATE metering_permissions SET status='z13_sent'",/unique_current_grant_required/)
 await probe("UPDATE tenant_actor_roles SET valid_to=now()",/current_captured_role_unavailable/)
 await probe("UPDATE esco_facet_fixture SET allowed=false",/actual_source_facet_unavailable/)
 const noEffect=await storageEffects()
 for(const changed of [{...storageItem,externalMeteringPointId:'foreign'},{...storageItem,productId:'foreign'},{...storageItem,periodEnd:'2099-01-01T00:00:00Z'},{...storageItem,consumptionContract:{...ownContract,interpretation:{...ownContract.interpretation,timezoneRaw:'+0100'}}}]){await assert.rejects(storageCall(changed),/physical_scope_unqualified/);assert.equal(await storageEffects(),noEffect);storageChecks++}
 // A negative actual own facet is not a positive-data authorization request.
 await db.exec('BEGIN');try{await db.exec("UPDATE ediel_data_access_grants SET status='revoked',revoked_at=now();UPDATE esco_facet_fixture SET disposition='processability_rejected',response='utilts_err'");await storageCall({...storageItem,disposition:'processability_rejected',responseType:'utilts_err'});assert.equal(await storageEffects(),noEffect+1)}finally{await db.exec('ROLLBACK')}storageChecks++
 const acl=(await db.query("SELECT has_function_privilege('service_role','gridex_utilts_binding.require_current_esco_storage_v1(uuid,text,uuid,jsonb)','EXECUTE') gate,has_function_privilege('authenticated','public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb)','EXECUTE') public")).rows[0];assert.deepEqual(acl,{gate:false,public:false});storageChecks++
 // Real retained-comparison owner over explicit historical dependency rows:
 // full original raw hash/context/immutable series equality is mandatory.
 // These rows do not constitute a native accepted-series fixture.
 await db.exec('BEGIN');try{
  const oldItem={...storageItem,periodStart:ownContract.interpretation.localPeriodStart,periodEnd:ownContract.interpretation.localPeriodEnd};delete oldItem.productId
  await db.query("INSERT INTO gridex_utilts_binding.receipts(source_message_id,company_id,environment,raw_hash,source_context,contract_version) SELECT id,company_id,environment,encode(sha256(convert_to(raw_payload,'UTF8')),'hex'),gridex_utilts_binding.source_context_v1(m),1 FROM ediel_messages m WHERE id=$1",[uid(210)])
  await db.query("UPDATE meter_reading_series SET raw_transaction=$1,immutable_hash=encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') WHERE id=$2",[oldItem,uid(211)])
  await db.query("INSERT INTO ediel_ack_transaction_results(company_id,environment,source_message_id,source_transaction_id,persisted_series_id,disposition,persistence_status,planned_response_type) VALUES($1,'test',$2,'tx',$3,'accepted','persisted','positive_aperak')",[uid(1),uid(210),uid(211)])
  const retained=async(item=storageItem)=>(await db.query('SELECT gridex_utilts_binding.preserve_committed_projection_v1($1,$2,$3,$4) r',[uid(1),'test',uid(210),[item]])).rows[0].r
  assert.deepEqual(await retained(),[oldItem]);storageChecks++
  const changed={...storageItem,issueCodes:['foreign']};assert.deepEqual(await retained(changed),[changed]);storageChecks++
  await db.exec('SAVEPOINT comparison');await db.exec("UPDATE gridex_utilts_binding.receipts SET raw_hash=repeat('0',64)");assert.deepEqual(await retained(),[storageItem]);await db.exec('ROLLBACK TO SAVEPOINT comparison');storageChecks++
  await db.exec("UPDATE meter_reading_series SET immutable_hash=repeat('0',64)");assert.deepEqual(await retained(),[storageItem]);await db.exec('ROLLBACK TO SAVEPOINT comparison');storageChecks++
  const currentV2={...storageItem,consumptionContract:{...ownContract,version:2,projectionVersion:'utilts-consumption-v2'}},oldV2={...oldItem,consumptionContract:currentV2.consumptionContract}
  await db.exec('UPDATE gridex_utilts_binding.receipts SET contract_version=2');await db.query("UPDATE meter_reading_series SET raw_transaction=$1,immutable_hash=encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') WHERE id=$2",[oldV2,uid(211)]);assert.deepEqual(await retained(currentV2),[oldV2]);storageChecks++
 }finally{await db.exec('ROLLBACK')}
 const originalSendSql=readFileSync(new URL('../supabase/migrations/20260930150622_utilts_positive_ack_own_dm_scope.sql',import.meta.url),'utf8')
 const originalSend=piece(originalSendSql,'CREATE OR REPLACE FUNCTION public.gridex_require_utilts_positive_ack_authority_v1')
 const forwardedSend=piece(readFileSync(forward,'utf8'),'CREATE OR REPLACE FUNCTION public.gridex_require_utilts_positive_ack_authority_v1')
 const retainedSendBody=forwardedSend.replace(' PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();\n','').replace(/ IF p_ack_message_id IS NOT NULL AND EXISTS\(SELECT FROM gridex_ediel_inbound_context\.receipts[\s\S]*? END IF;\n RETURN jsonb_build_object/,' RETURN jsonb_build_object')
 assert.equal(retainedSendBody,originalSend);storageChecks++
 console.log('ESCO native pre-storage current-private-scope SQL: '+storageChecks+' PASS incl independent RED; finite synthetic storage/facet ports, NOT native/race/legal approval proof')
`
const generated=base.replace(marker,()=>extension+marker),temp=fileURLToPath(new URL('./.ediel-esco-pre-storage.tmp.mjs',import.meta.url))
writeFileSync(temp,generated)
try{const run=spawnSync(process.execPath,[temp],{stdio:'inherit',env:{...process.env,EDIEL_ATOMIC_ACK_FORWARD:process.env.EDIEL_ATOMIC_ACK_FORWARD||fileURLToPath(new URL('../supabase/migrations/20260930231958_ediel_atomic_ack_owner_persistence.sql',import.meta.url))}});if(run.error)throw run.error;process.exitCode=run.status??1}finally{unlinkSync(temp)}
