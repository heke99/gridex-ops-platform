// masterplan: SC-037
// SC-037 (P-11): a correct Z04 with a future start is not activated early.
// Extends the existing normal-switch PGlite harness (real Z04 confirmation and
// canonical activation) through marker insertion; the base script is unchanged.
// The latest schema.sql definitions of the canonical activation, the canonical
// sweep, the legacy Stockholm-DATE sweep (gridex_process_ready_supplier_switch_
// activations -> gridex_finalize_supplier_switch_activation) and the Z04
// completion trigger are loaded and executed. Time is real now(): rows are
// created relative to it and the regression waits for one real minute
// boundary. pg_catalog.now is never replaced.
//
// Review finding (masterplan-sc037-sc052-review-checkpoint): "legacy
// Stockholm-DATE sweep may complete switch and alter site/point projections
// early". NOT REPRODUCED. The legacy sweep selects by Stockholm date, so it
// does pick up a switch whose date is reached while its exact market_start_at
// (DTM at +01:00) is still in the future. But finalize performs no write
// before calling the canonical activate_customer_supply_v1, whose
// `market_start_at > now()` guard raises normal_supply_activation_not_due;
// the sweep's per-row exception block rolls the whole finalize back, so the
// switch, period, site, point and event rows are unchanged (the row is only
// counted as `failed`). Canonical activation also requires the period to be
// still `confirmed_by_grid_owner` with unchanged market_state_version and
// start, and the switch to be `accepted`, so the legacy path cannot bypass
// those checks either. No production change is made.
// Focused embedded PostgreSQL mechanics, not native replay or market evidence.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const base = readFileSync(new URL('./ediel-normal-switch-source-sql-regression.mjs', import.meta.url), 'utf8')
const marker = ' console.log(`PASS ${checks} focused normal switch'
assert.equal(base.split(marker).length, 2, 'normal-switch harness insertion seam must be unique')

const extension = String.raw`
 let sc037=0
 const latest=(name)=>fn('../supabase/schema.sql',name).replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION')
 await db.exec("UPDATE user_profiles SET user_status='active' WHERE id='"+id(2)+"'")
 // Columns/stubs the legacy finalize and latest canonical activation read.
 await db.exec("ALTER TABLE supplier_switch_requests ADD COLUMN requested_start_date date,ADD COLUMN incoming_supplier_name text,ADD COLUMN incoming_supplier_org_number text,ADD COLUMN current_supplier_name text,ADD COLUMN grid_owner_id uuid,ADD COLUMN price_area_code text,ADD COLUMN failure_reason text,ADD COLUMN created_at timestamptz DEFAULT now(),ADD COLUMN submitted_at timestamptz,ADD COLUMN completed_at timestamptz;"+
  "ALTER TABLE customer_sites ADD COLUMN status text DEFAULT 'pending',ADD COLUMN current_supplier_name text,ADD COLUMN current_supplier_org_number text,ADD COLUMN grid_owner_id uuid,ADD COLUMN price_area_code text,ADD COLUMN updated_by uuid,ADD COLUMN updated_at timestamptz;"+
  "ALTER TABLE metering_points ADD COLUMN status text DEFAULT 'pending',ADD COLUMN grid_owner_id uuid,ADD COLUMN price_area_code text,ADD COLUMN updated_by uuid,ADD COLUMN updated_at timestamptz;"+
  "CREATE TABLE supplier_switch_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,switch_request_id uuid,event_type text,event_status text,message text,payload jsonb,created_by uuid,created_at timestamptz DEFAULT now());"+
  "CREATE SCHEMA gridex_bilateral_prodat;CREATE FUNCTION gridex_bilateral_prodat.lock_supply_v1() RETURNS void LANGUAGE sql AS 'SELECT';"+
  "CREATE FUNCTION gridex_bilateral_prodat.recorded_supply_current_v1(uuid,uuid) RETURNS boolean LANGUAGE sql AS 'SELECT true';"+
  "CREATE FUNCTION public.ediel_require_contract_records_available_v1(uuid,uuid) RETURNS void LANGUAGE sql AS 'SELECT';"+
  "CREATE FUNCTION public.ediel_require_source_bytes_available_v1(uuid,uuid) RETURNS void LANGUAGE sql AS 'SELECT';")
 for(const name of ['public.activate_customer_supply_v1','public.ediel_advance_supply_deadlines_v1','public.gridex_enforce_supplier_switch_z04_confirmation_v1','public.gridex_finalize_supplier_switch_activation','public.gridex_process_ready_supplier_switch_activations'])await db.exec(latest(name))
 await db.exec('CREATE TRIGGER trg_supplier_switch_requires_z04_confirmation BEFORE INSERT OR UPDATE OF status, inbound_z04_message_id, company_id ON public.supplier_switch_requests FOR EACH ROW EXECUTE FUNCTION public.gridex_enforce_supplier_switch_z04_confirmation_v1()')
 const legacy=async()=>(await db.query('SELECT public.gridex_process_ready_supplier_switch_activations($1,50) b',[id(2)])).rows[0].b
 const canonical=async()=>(await db.query('SELECT public.ediel_advance_supply_deadlines_v1($1,$2,50) b',[id(1),id(2)])).rows[0].b
 // Drain base leftovers so the scenario counts only its own rows.
 await canonical();await legacy()

 const minute=60000,dtm=ms=>new Date(ms+3600000).toISOString().slice(0,16).replace(/[-T:]/g,'')
 const stockholm=(await db.query("SELECT to_char((now() AT TIME ZONE 'Europe/Stockholm')::date,'YYYYMMDD') d")).rows[0].d
 let startA=Math.ceil(Date.now()/minute)*minute;if(startA-Date.now()<25000)startA+=minute
 const past=Math.floor(Date.now()/minute)*minute-2*minute
 const cases=[{key:'A',start:dtm(startA)},{key:'C1',start:dtm(past)},{key:'C2',start:dtm(past)}]
 // B: the date-vs-instant gap. Its DTM date is today's Stockholm date (so the
 // legacy DATE filter selects it) while its instant is later today.
 const startB=Date.parse(stockholm.slice(0,4)+'-'+stockholm.slice(4,6)+'-'+stockholm.slice(6,8)+'T23:59:00+01:00')
 if(startB-Date.now()>5*minute)cases.push({key:'B',start:stockholm+'2359'})
 const objects=cases.map((c,i)=>({...c,n:1000+i*100,point:'7351234567890'+String(13000+i),li:'LI-SC037-'+c.key,customer:'PERSON-SC037-'+c.key}))
 for(const o of objects){
  const n=o.n
  await db.exec("INSERT INTO customers VALUES('"+id(3+n)+"','"+id(1)+"',NULL,'"+o.customer+"');INSERT INTO customer_sites(id,company_id,customer_id) VALUES('"+id(4+n)+"','"+id(1)+"','"+id(3+n)+"');INSERT INTO metering_points(id,company_id,customer_id,site_id,ediel_metering_point_id,grid_owner_ediel_id,grid_area_code) VALUES('"+id(5+n)+"','"+id(1)+"','"+id(3+n)+"','"+id(4+n)+"','"+o.point+"','54321','TES');INSERT INTO customer_contracts VALUES('"+id(6+n)+"','"+id(1)+"','"+id(3+n)+"','"+id(5+n)+"','signed','1','1','2025-12-01','{}');")
  const original=raw('Z03',[o],'12345','54321')
  await db.query("INSERT INTO ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,raw_payload,status,message_sent_at,immutable_rendered_at,immutable_payload_hash,customer_id,metering_point_id) VALUES($1,$2,'test','outbound','edifact','PRODAT','Z03',$3,'sent',now()-interval '2 days',now()-interval '2 days',encode(sha256(convert_to($3,'UTF8')),'hex'),$4,$5)",[id(20+n),id(1),original,id(3+n),id(5+n)])
  await db.query("INSERT INTO gridex_ediel_transport.attempts VALUES($1,$2,$3,'test',jsonb_build_object('originalHash',encode(sha256(convert_to($4,'UTF8')),'hex'),'to','dso@example.invalid'),'accepted','{\"accepted\":[\"dso@example.invalid\"],\"rejected\":[]}',now()-interval '2 days',now()-interval '2 days')",[id(80+n),id(20+n),id(1),original])
  await db.exec("INSERT INTO supplier_switch_requests(id,company_id,customer_id,metering_point_id,site_id,customer_site_id,contract_id,customer_contract_id,outbound_z03_message_id,inbound_z04_message_id,rff_li_reference,status,lifecycle_blocked,confirmed_start_date,updated_at) VALUES('"+id(10+n)+"','"+id(1)+"','"+id(3+n)+"','"+id(5+n)+"','"+id(4+n)+"',NULL,'"+id(6+n)+"',NULL,'"+id(20+n)+"',NULL,'"+o.li+"','sent',false,NULL,now())")
 }
 const z04=raw('Z04',objects),z04Id=id(1030)
 await db.query("INSERT INTO ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,raw_payload,status,message_received_at) VALUES($1,$2,'test','inbound','edifact','PRODAT','Z04',$3,'received',now())",[z04Id,id(1),z04])
 await db.query('INSERT INTO legal_context_fixture VALUES($1,$2)',[z04Id,{companyId:id(1),family:'PRODAT',code:'Z04',actorRole:'electricity_supplier',legalActorId:id(50),legalEdielId:'12345'}])
 await db.query("INSERT INTO gridex_received_sources.validation_assessments VALUES($1,$2,$3,'test',encode(sha256(convert_to($4,'UTF8')),'hex'),$5,NULL)",[id(1040),z04Id,id(1),z04,JSON.stringify({syntaxDecision:'accepted',applicationDecision:'accepted',functionalDecision:'accepted',registerValidation:{owner:'validateProdatRegisterPolicy',coverage:'canonical_register_only',objects:objects.map(o=>({disposition:'accepted',messageIndex:0,objectId:o.point,identityAgency:'9',registers:[{}]}))}})])
 const confirm=(await run(z04Id)).rows[0].b
 assert.equal(confirm.applied,true,JSON.stringify(confirm));assert.equal(confirm.commits.length,objects.length);sc037++
 const of=key=>objects.find(o=>o.key===key),sw=key=>id(10+of(key).n)
 const state=async key=>(await db.query("SELECT s.status sw,s.confirmed_start_date::text d,p.id pid,p.status ps,p.market_start_at,p.market_state_version v,site.status site,mp.status point,(SELECT count(*)::int FROM gridex_received_sources.normal_supply_activations a WHERE a.period_id=p.id) acts,(SELECT count(*)::int FROM supplier_switch_events e WHERE e.switch_request_id=s.id) events FROM supplier_switch_requests s JOIN customer_supply_periods p ON p.source_switch_request_id=s.id JOIN customer_sites site ON site.id=s.site_id JOIN metering_points mp ON mp.id=s.metering_point_id WHERE s.id=$1",[sw(key)])).rows[0]
 const untouched=(s)=>{assert.equal(s.sw,'accepted');assert.equal(s.ps,'confirmed_by_grid_owner');assert.equal(s.acts,0);assert.equal(s.events,0);assert.equal(s.site,'pending');assert.equal(s.point,'pending')}
 const a0=await state('A')
 assert.equal(new Date(a0.market_start_at).getTime(),startA);assert.ok(new Date(a0.market_start_at).getTime()>Date.now());untouched(a0);sc037++

 // Cancelled / replaced (new market version) periods: confirmation no longer valid.
 await db.query("UPDATE customer_supply_periods SET status='cancelled' WHERE source_switch_request_id=$1",[sw('C1')])
 await db.query("UPDATE customer_supply_periods SET market_state_version=market_state_version+1 WHERE source_switch_request_id=$1",[sw('C2')])

 // Prohibited: SMTP 250 / CONTRL / APERAK rows timestamped before the start do
 // not move the start or trigger activation.
 const ackAt="now()-interval '1 day'"
 await db.query("UPDATE gridex_ediel_transport.attempts SET provider_result='{\"accepted\":[\"dso@example.invalid\"],\"rejected\":[],\"smtp\":\"250 2.0.0 OK\"}',observed_at="+ackAt+" WHERE message_id=$1",[id(20+of('A').n)])
 await db.query("UPDATE ediel_messages SET status='acknowledged' WHERE id=$1",[id(20+of('A').n)])
 await db.query("INSERT INTO ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,raw_payload,status,message_received_at) VALUES($1,$2,'test','inbound','edifact','CONTRL','CONTRL','UNH+C+CONTRL:D:3:UN',  'received',"+ackAt+"),($3,$2,'test','inbound','edifact','APERAK','APERAK','UNH+A+APERAK:D:96A:UN','received',"+ackAt+")",[id(1050),id(1),id(1051)])
 assert.equal((await run(z04Id)).rows[0].b.idempotent,true);sc037++

 // Before the start: both jobs run; nothing of A (or B) is activated or completed.
 const before=await legacy(),beforeCanonical=await canonical()
 const failedNotDue=key=>before.failures.some(f=>f.requestId===sw(key)&&/normal_supply_activation_not_due/.test(f.message||''))
 const gap=['A','B'].filter(k=>of(k)&&of(k).start.slice(0,8)<=stockholm)
 assert.ok(gap.length>=1,'at least one Stockholm-date-reached future instant must be exercised');sc037++
 for(const k of gap){assert.ok(failedNotDue(k),JSON.stringify(before));sc037++} // legacy picked it up and canonical refused it
 assert.equal(before.activated,0,JSON.stringify(before));assert.equal(beforeCanonical.normalActivated,0);sc037++
 untouched(await state('A'));sc037++
 if(of('B')){untouched(await state('B'));sc037++}
 // The trigger also refuses an early completion on a not-yet-reached date.
 await assert.rejects(db.query("UPDATE supplier_switch_requests SET status='completed' WHERE id=$1",[id(210)]),/supplier_switch_effective_date_not_reached/);sc037++
 for(const k of ['C1','C2']){const s=await state(k);assert.equal(s.acts,0);assert.equal(s.sw,'accepted');assert.equal(s.events,0);assert.notEqual(s.ps,'active')};sc037++

 // At the start: wait for the real minute boundary, then run the jobs again.
 while(Date.now()<startA+1500)await new Promise(r=>setTimeout(r,250))
 const atLegacy=await legacy(),atCanonical=await canonical()
 const a1=await state('A')
 assert.equal(a1.sw,'completed');assert.equal(a1.ps,'active');assert.equal(a1.acts,1);assert.equal(a1.events,1);assert.equal(a1.site,'active');assert.equal(a1.point,'active');sc037++
 assert.equal(new Date(a1.market_start_at).getTime(),startA);assert.equal(Number(a1.v),1);sc037++
 assert.equal(atLegacy.activated+atCanonical.normalActivated,1,JSON.stringify({atLegacy,atCanonical}));sc037++
 // Only the still-valid period: cancelled/replaced stay unactivated, B stays waiting.
 for(const k of ['C1','C2']){const s=await state(k);assert.equal(s.acts,0);assert.equal(s.sw,'accepted');assert.equal(s.events,0);assert.notEqual(s.ps,'active')};sc037++
 if(of('B')){untouched(await state('B'));sc037++}
 assert.equal((await db.query("SELECT count(*)::int n FROM gridex_received_sources.normal_supply_activations a JOIN customer_supply_periods p ON p.id=a.period_id WHERE p.source_message_id=$1",[z04Id])).rows[0].n,1);sc037++
 console.log('SC037_FUTURE_START_RESULT '+JSON.stringify({checks:sc037,gapCases:gap,legacyFindingReproduced:false,boundary:'focused PGlite over latest schema.sql activation/sweep/trigger functions',native:'NOT_EXERCISED'}))
`

const source = base.replace(marker, () => extension + marker)
const temp = fileURLToPath(new URL('./.ediel-sc037-future-start.tmp.mjs', import.meta.url))
writeFileSync(temp, source)
try {
  const result = spawnSync(process.execPath, [temp], { stdio: 'inherit', env: process.env })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally {
  unlinkSync(temp)
}
