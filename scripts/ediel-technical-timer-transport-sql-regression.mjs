// Bounded embedded SQL consumer tests. Inner journal/source-plan ports here
// are declared probes; these checks are not native or authentic source proof.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
if(!process.env.EDIEL_PGLITE_MODULE)throw Error('EDIEL_PGLITE_MODULE required')
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const company=id(1),message=id(2),attempt=id(3)
const quote=value=>`'${String(value).replaceAll("'","''")}'`
const plan={version:1,declaredProbe:'same-admission'}
let checks=0
async function run(lane,action,extra={}){
 const input={companyId:company,environment:'test',messageId:message,attemptId:attempt,action,...extra}
 const results=await db.exec(`SET ROLE service_role;SELECT ${lane}.mutate_v1(${quote(JSON.stringify(input))}::jsonb) receipt;RESET ROLE;`)
 return results[1].rows[0].receipt
}
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_standard text,message_family text,message_code text);
 CREATE SCHEMA gridex_ediel_transport;CREATE SCHEMA gridex_outbound_dispatch;
 CREATE TABLE gridex_ediel_transport.attempts(id uuid PRIMARY KEY,message_id uuid,company_id uuid,environment text,binding jsonb);
 CREATE TABLE gridex_outbound_dispatch.attempts(LIKE gridex_ediel_transport.attempts INCLUDING ALL);
 CREATE TABLE public.synthetic_timer_probe_calls(lane text,message_id uuid,binding jsonb);
 CREATE FUNCTION gridex_ediel_transport.require_technical_expectation_binding_v1(m public.ediel_messages,b jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN
 IF b->'technicalExpectationPlan' IS DISTINCT FROM '${JSON.stringify(plan)}'::jsonb THEN RAISE EXCEPTION 'synthetic_same_admission_plan_required';END IF;
 INSERT INTO public.synthetic_timer_probe_calls VALUES('plan',m.id,b);RETURN b;END$$;
 CREATE FUNCTION public.require_metering_method_expectation_binding_v1(m public.ediel_messages,b jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN
 IF b->>'invalidMethodProbe'='true' THEN RAISE EXCEPTION 'synthetic_same_method_admission_required';END IF;RETURN b;END$$;
 CREATE FUNCTION public.ediel_require_metering_method_change_source_current_v1(c uuid,m uuid,a uuid) RETURNS void LANGUAGE plpgsql AS $$BEGIN
 RAISE EXCEPTION 'synthetic_current_method_source_held';END$$;
 INSERT INTO public.ediel_messages VALUES('${message}','${company}','test','outbound',NULL,NULL,NULL);
 GRANT USAGE ON SCHEMA gridex_ediel_transport,gridex_outbound_dispatch TO service_role;`)
 for(const lane of ['gridex_ediel_transport','gridex_outbound_dispatch']){
  await db.exec(`CREATE FUNCTION ${lane}.mutate_v1(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
   IF p->>'replay'='true' THEN RETURN '{"scoped":true,"proceed":false,"acceptedReceipt":{"unchangedOriginal":true}}'::jsonb;END IF;
   IF p->>'scoped'='false' THEN RETURN '{"scoped":false}'::jsonb;END IF;
   IF p->>'action'='prepare' THEN INSERT INTO ${lane}.attempts VALUES((p->>'attemptId')::uuid,(p->>'messageId')::uuid,(p->>'companyId')::uuid,p->>'environment',p->'binding');END IF;
   RETURN '{"scoped":true,"proceed":true}'::jsonb;END$$;`)
 }
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930231350_ediel_same_admission_technical_timer_transport_guards.sql',import.meta.url),'utf8'));checks++
 for(const lane of ['gridex_ediel_transport','gridex_outbound_dispatch']){
  await assert.rejects(run(lane,'prepare',{binding:{technicalExpectationPlan:null}}),/synthetic_same_admission_plan_required/);await db.exec('RESET ROLE');checks++
  assert.equal((await db.query(`SELECT count(*) n FROM ${lane}.attempts`)).rows[0].n,0);checks++
  await assert.rejects(run(lane,'prepare',{binding:{technicalExpectationPlan:plan,invalidMethodProbe:true}}),/synthetic_same_method_admission_required/);await db.exec('RESET ROLE');checks++
  assert.equal((await db.query(`SELECT count(*) n FROM ${lane}.attempts`)).rows[0].n,0);checks++
  assert.equal((await run(lane,'prepare',{binding:{technicalExpectationPlan:plan}})).proceed,true);checks++
  assert.equal((await run(lane,'enter',{binding:{technicalExpectationPlan:'caller-mutated'}})).proceed,true);checks++
  const before=(await db.query('SELECT count(*) n FROM public.synthetic_timer_probe_calls')).rows[0].n
  const replay=await run(lane,'prepare',{replay:true,binding:{technicalExpectationPlan:null}})
  assert.deepEqual(replay.acceptedReceipt,{unchangedOriginal:true});assert.equal(replay.proceed,false);checks++
  assert.equal((await db.query('SELECT count(*) n FROM public.synthetic_timer_probe_calls')).rows[0].n,before);checks++
  assert.equal((await run(lane,'observe')).proceed,true);checks++
  assert.equal((await db.query('SELECT count(*) n FROM public.synthetic_timer_probe_calls')).rows[0].n,before);checks++
  const acl=(await db.query(`SELECT has_function_privilege('service_role','${lane}.mutate_before_technical_expectation_v1(jsonb)','execute') old,
   has_function_privilege('anon','${lane}.mutate_v1(jsonb)','execute') anon,
   has_function_privilege('service_role','${lane}.mutate_v1(jsonb)','execute') current`)).rows[0]
  assert.deepEqual(acl,{old:false,anon:false,current:true});checks++
 }
 assert.deepEqual(await run('gridex_outbound_dispatch','prepare',{scoped:false,binding:null}),{scoped:false});checks++
 await db.exec("UPDATE ediel_messages SET message_standard='edifact',message_family='PRODAT',message_code='Z09'")
 for(const lane of ['gridex_ediel_transport','gridex_outbound_dispatch']){
  await assert.rejects(run(lane,'enter'),/synthetic_current_method_source_held/);await db.exec('RESET ROLE');checks++
  const before=(await db.query('SELECT count(*) n FROM public.synthetic_timer_probe_calls')).rows[0].n
  assert.equal((await run(lane,'prepare',{replay:true,binding:null})).proceed,false)
  assert.equal((await db.query('SELECT count(*) n FROM public.synthetic_timer_probe_calls')).rows[0].n,before);checks++
 }
 console.log(`PASS ${checks} embedded SQL timer consumer checks; declared journal/plan probes, not native or authentic source evidence`)
}finally{await db.close()}
