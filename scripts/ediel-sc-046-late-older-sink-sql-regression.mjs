// masterplan: SC-046
// SC-046 sink effects over the existing U-04/U-14 PGlite harness: an older
// data version (own 512 or own 532 older) arriving after the newer one is
// persisted through the real public persistence wrapper with a positive APERAK
// and versionState 'late_older_history', and the real forward metering and
// billing consumers skip it: the newer metering value and the single billing
// underlay stay untouched, no conflict is raised, and no ERR/negative ACK is
// planned. Boundary stubs (stored contract lookup, attribution lock, reduced
// metering writer/conflict check, actor checks) are declared below.
// Focused embedded PostgreSQL mechanics, not native replay or market evidence.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const base = readFileSync(new URL('./ediel-utilts-u04-u14-effects-sql-regression.mjs', import.meta.url), 'utf8')
const marker = ' console.log(`PASS ${checks} U-04/U-14'
assert.equal(base.split(marker).length, 2, 'existing U-04/U-14 harness insertion seam must be unique')

const extension = String.raw`
 let sc046=0
 await db.exec(` + '`' + String.raw`
 CREATE TABLE public.metering_values(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,canonical_dedupe_key text,is_current boolean DEFAULT true,value_kwh numeric,source_ediel_message_id uuid,source_transaction_reference text,created_at timestamptz DEFAULT clock_timestamp());
 CREATE TABLE public.billing_underlays(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,customer_id uuid,site_id uuid,customer_site_id uuid,metering_point_id uuid,source_request_id uuid,grid_owner_id uuid,underlay_month int,underlay_year int,
  status text,total_kwh numeric,currency text,source_system text,payload jsonb,readiness_status text,readiness_issues jsonb,created_by uuid,updated_by uuid,received_at timestamptz,created_at timestamptz DEFAULT clock_timestamp());
 -- Boundary stubs: the stored contract is read from the contracts table only for
 -- a persisted accepted transaction (the real lookup also proves hashes/receipt).
 CREATE OR REPLACE FUNCTION gridex_utilts_binding.stored_contract_v1(p_company uuid,p_source uuid,p_transaction text) RETURNS jsonb LANGUAGE plpgsql AS $f$
 DECLARE c jsonb;BEGIN
  SELECT k.contract INTO c FROM gridex_utilts_binding.contracts k JOIN public.ediel_ack_transaction_results a ON a.company_id=k.company_id AND a.source_message_id=k.source_message_id AND a.source_transaction_id=k.transaction_id
   WHERE k.company_id=p_company AND k.source_message_id=p_source AND k.transaction_id=p_transaction AND a.disposition='accepted' AND a.persistence_status='persisted' AND a.planned_response_type='positive_aperak';
  IF c IS NULL THEN RAISE EXCEPTION 'utilts_consumption_not_accepted';END IF;RETURN c;END$f$;
 CREATE OR REPLACE FUNCTION gridex_utilts_binding.lock_attribution_v1(uuid,jsonb,boolean) RETURNS void LANGUAGE sql AS $f$SELECT$f$;
 CREATE OR REPLACE FUNCTION gridex_utilts_binding.lock_storage_graph_v1() RETURNS void LANGUAGE sql AS $f$SELECT$f$;
 CREATE OR REPLACE FUNCTION gridex_utilts_binding.require_execution_actor_v1(uuid,uuid) RETURNS void LANGUAGE sql AS $f$SELECT$f$;
 CREATE OR REPLACE FUNCTION gridex_utilts_binding.persist_consumption_before_actor_v1(c uuid,env text,sid uuid,code text,raw text,t jsonb) RETURNS jsonb LANGUAGE sql AS $f$SELECT gridex_utilts_binding.persist_series_v1(c,env,sid,code,t)$f$;
 -- Reduced stand-in for the real meter_reading_series_tenant_guard version
 -- default (new.version_no := coalesce(new.version_no,1)), absent from the base harness.
 CREATE FUNCTION public.sc046_version_default() RETURNS trigger LANGUAGE plpgsql AS $f$BEGIN new.version_no:=coalesce(new.version_no,1);RETURN new;END$f$;
 CREATE TRIGGER sc046_version_default BEFORE INSERT ON public.meter_reading_series FOR EACH ROW EXECUTE FUNCTION public.sc046_version_default();
 -- Reduced conflict check: the real one raises the same code on a differing value.
 CREATE OR REPLACE FUNCTION gridex_utilts_binding.check_metering_result_v1(p_result public.metering_values,p_payload jsonb,p_environment text) RETURNS void LANGUAGE plpgsql AS $f$BEGIN
  IF p_result.value_kwh IS DISTINCT FROM (p_payload->>'value_kwh')::numeric THEN RAISE EXCEPTION 'utilts_consumption_existing_metering_conflict';END IF;END$f$;
 CREATE OR REPLACE FUNCTION public.gridex_ingest_metering_value_atomic(p jsonb) RETURNS public.metering_values LANGUAGE plpgsql AS $f$DECLARE r public.metering_values;BEGIN
  SELECT * INTO r FROM public.metering_values WHERE company_id=(p->>'company_id')::uuid AND canonical_dedupe_key=p->>'canonical_dedupe_key' AND is_current;
  IF FOUND THEN RETURN r;END IF;
  INSERT INTO public.metering_values(company_id,canonical_dedupe_key,value_kwh,source_ediel_message_id,source_transaction_reference)
   VALUES((p->>'company_id')::uuid,p->>'canonical_dedupe_key',(p->>'value_kwh')::numeric,(p->>'source_ediel_message_id')::uuid,p->>'source_transaction_reference') RETURNING * INTO r;RETURN r;END$f$;` + '`' + String.raw`)
 await db.exec(fs.readFileSync(root+'/supabase/migrations/20261011090000_ediel_utilts_late_older_sink_exclusion.sql','utf8'))
 await db.exec('GRANT USAGE ON SCHEMA gridex_utilts_binding TO service_role');sc046++

 const billing={capability:'write',customerId:uid(901),siteId:uid(902),customerSiteId:uid(902),meteringPointId:uid(903),gridOwnerId:uid(904),sourceRequestId:uid(905),month:9,year:2026,status:'received',sourceSystem:'ediel_utilts',currency:'SEK'}
 const contractFor=(tx,q)=>({transactionId:tx,environment:'test',sourceType:'ediel_utilts',metering:{capability:'write',meteringPointId:uid(903)},billing,billingContributionOrdinals:[0],
  observations:[{periodStart:'2026-09-01T00:00:00Z',periodEnd:'2026-10-01T00:00:00Z',quantity:q,direction:'consumption',unit:'kWh'}]})
 // The real public wrapper, called as service_role exactly as the adapter does.
 const wrapped=async(id,t)=>{const raw=(await db.query('SELECT raw_payload FROM public.ediel_messages WHERE id=$1',[id])).rows[0].raw_payload
  await db.exec('SET ROLE service_role')
  try{return (await db.query("SELECT public.gridex_persist_utilts_consumption_v1($1,'test',$2,'E66',$3,$4::jsonb,$5) r",[company,id,raw,JSON.stringify([t]),uid(999)])).rows[0].r}
  finally{await db.exec('RESET ROLE')}}
 const store=async(id,tx,q)=>{const sid=(await db.query('SELECT persisted_series_id s FROM public.ediel_ack_transaction_results WHERE source_message_id=$1',[id])).rows[0].s
  await db.query("INSERT INTO gridex_utilts_binding.contracts(series_id,company_id,environment,source_message_id,transaction_id,contract_version,contract,contract_hash)VALUES($1,$2,'test',$3,$4,1,$5::jsonb,'h')",[sid,company,id,tx,JSON.stringify(contractFor(tx,q))])}
 const meter=async(id,tx,q)=>(await db.query('SELECT to_jsonb(public.gridex_consume_utilts_metering_v1($1,$2,$3,0,$4,$5::jsonb)) r',[company,id,tx,uid(999),JSON.stringify(contractFor(tx,q))])).rows[0].r
 const bill=async(id,list)=>(await db.query('SELECT to_jsonb(public.gridex_consume_utilts_billing_v1($1,$2,$3,$4::jsonb)) r',[company,id,uid(999),JSON.stringify(list)])).rows[0].r
 const underlays=async()=>(await db.query('SELECT total_kwh::text t,payload->>$1 m FROM public.billing_underlays ORDER BY created_at',['edielMessageId'])).rows

 await db.exec('GRANT EXECUTE ON FUNCTION public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb,uuid) TO service_role')
 const cases=[
  // Only 512 (registrationDate) carries the version time; 532 is absent on both.
  {name:'512',point:'735999999999999101',newer:{registrationDate:'2026-10-02T08:00:00Z',latestUpdateDate:null},older:{registrationDate:'2026-09-20T08:00:00Z',latestUpdateDate:null},n:41,o:42},
  // Only 532 (latestUpdateDate) differs; 512 is identical on both.
  {name:'532',point:'735999999999999102',newer:{registrationDate:'2026-09-01T08:00:00Z',latestUpdateDate:'2026-10-02T08:00:00Z'},older:{registrationDate:'2026-09-01T08:00:00Z',latestUpdateDate:'2026-09-20T08:00:00Z'},n:43,o:44}]
 for(const c of cases){
  await db.query('DELETE FROM public.metering_values');await db.query('DELETE FROM public.billing_underlays')
  const NEW='SC046N'+c.name,OLD='SC046O'+c.name
  const mk=(tx,dates,v)=>({...item(tx,null,v),externalMeteringPointId:c.point,...dates})
  await message(uid(c.n),NEW);const [newer]=await wrapped(uid(c.n),mk(NEW,c.newer,'10'))
  assert.equal(newer.versionState,'current',c.name);await store(uid(c.n),NEW,'10')
  assert.equal((await meter(uid(c.n),NEW,'10')).value_kwh,10);assert.equal(Number((await bill(uid(c.n),[contractFor(NEW,'10')])).total_kwh),10);sc046++
  const before=(await db.query('SELECT * FROM public.metering_values')).rows
  // NEWER then OLDER: positive APERAK, persisted, marked late older history.
  await message(uid(c.o),OLD);const [late]=await wrapped(uid(c.o),mk(OLD,c.older,'7'))
  assert.deepEqual({d:late.disposition,r:late.responseType,p:late.persistenceStatus,v:late.versionState},{d:'accepted',r:'positive_aperak',p:'persisted',v:'late_older_history'},c.name);sc046++
  assert.deepEqual((await db.query('SELECT source_transaction_reference t,is_current FROM public.meter_reading_series WHERE external_metering_point_id=$1 ORDER BY version_no',[c.point])).rows,
   [{t:NEW,is_current:true},{t:OLD,is_current:false}],c.name);sc046++
  await store(uid(c.o),OLD,'7')
  // Prohibited: no conflict exception and no metering write for the late version.
  assert.equal(await meter(uid(c.o),OLD,'7'),null,c.name)
  assert.deepEqual((await db.query('SELECT * FROM public.metering_values')).rows,before,c.name);sc046++
  // Prohibited: no billing contribution or second underlay for the same point/month.
  assert.equal(await bill(uid(c.o),[]),null,c.name)
  assert.deepEqual(await underlays(),[{t:'10',m:uid(c.n)}],c.name);sc046++
  // The newer billing basis replays unchanged.
  assert.equal(Number((await bill(uid(c.n),[contractFor(NEW,'10')])).total_kwh),10);assert.equal((await underlays()).length,1);sc046++
  // No ERR or negative ACK is planned, and no outbound message exists.
  assert.equal((await db.query("SELECT count(*)::int n FROM public.ediel_ack_transaction_results WHERE planned_response_type<>'positive_aperak' AND source_transaction_id LIKE 'SC046%'")).rows[0].n,0)
  assert.equal((await db.query("SELECT count(*)::int n FROM public.ediel_messages WHERE direction='outbound'")).rows[0].n,0);sc046++
 }
 // The classification helper stays private.
 for(const role of ['anon','authenticated','service_role'])
  assert.equal((await db.query('SELECT has_function_privilege($1,$2,$3) a',[role,'gridex_utilts_binding.transaction_version_state_v1(uuid,uuid,text)','EXECUTE'])).rows[0].a,false)
 sc046++
 console.log('SC046_LATE_OLDER_SINK_RESULT '+JSON.stringify({checks:sc046,boundary:'focused PGlite over real persist wrapper and forward sink consumers',native:'NOT_EXERCISED'}))
`

// Preserve every existing assertion; a disjoint temporary filename isolates
// this runner from the original U-04/U-14 runner.
const source = base.replace(marker, () => extension + marker)
const temp = fileURLToPath(new URL('./.ediel-sc046-late-older-sink.tmp.mjs', import.meta.url))
writeFileSync(temp, source)
try {
  const result = spawnSync(process.execPath, [temp], { stdio: 'inherit', env: process.env })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally {
  unlinkSync(temp)
}
