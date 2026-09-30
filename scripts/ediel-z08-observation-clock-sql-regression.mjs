// Explicit embedded receipt fixtures: existing sealed mutation is a declared
// test double here; this checks only observation clock propagation/ACL/scope.
import{readFileSync}from'node:fs'
import{pathToFileURL}from'node:url'
import assert from'node:assert/strict'
if(!process.env.EDIEL_PGLITE_MODULE)throw Error('EDIEL_PGLITE_MODULE required')
const{PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite()
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
let checks=0
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA gridex_outbound_dispatch;GRANT USAGE ON SCHEMA gridex_outbound_dispatch TO service_role;CREATE TABLE gridex_outbound_dispatch.events(id uuid,attempt_id uuid,message_id uuid,company_id uuid,environment text,kind text,observed_at timestamptz);
 INSERT INTO gridex_outbound_dispatch.events VALUES('${uid(4)}','${uid(3)}','${uid(2)}','${uid(1)}','test','provider_result','2026-09-30 12:00:00+00');
 CREATE FUNCTION gridex_outbound_dispatch.mutate_v1(jsonb) RETURNS jsonb LANGUAGE sql AS 'SELECT jsonb_build_object(''scoped'',true,''eventId'',''${uid(4)}'',''facts'',jsonb_build_object(''classification'',''accepted''))';`)
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930175554_ediel_z08_dispatch_observation_clock_v1.sql',import.meta.url),'utf8'));checks++
 const input={companyId:uid(1),messageId:uid(2),attemptId:uid(3),environment:'test',action:'result'}
 async function call(value){await db.exec('SET ROLE service_role');try{return(await db.query('SELECT gridex_outbound_dispatch_v1($1::jsonb) result',[JSON.stringify(value)])).rows[0].result}finally{await db.exec('RESET ROLE')}}
 const actual=await call(input);assert.equal(actual.observedAt,'2026-09-30T12:00:00+00:00');assert.equal(actual.observationClock,'database_provider_result_capture');assert.equal(actual.facts.classification,'accepted');checks++
 assert.equal((await call(input)).observedAt,actual.observedAt);checks++
 await assert.rejects(call({...input,companyId:uid(99)}),/query returned no rows/);checks++
 await assert.rejects(call({...input,attemptId:uid(99)}),/query returned no rows/);checks++
 assert.equal((await call({...input,action:'enter'})).observedAt,undefined);checks++
 assert.equal((await db.query(`SELECT has_function_privilege('service_role','gridex_outbound_dispatch.mutate_before_observed_clock_v1(jsonb)','EXECUTE') allowed`)).rows[0].allowed,false);checks++
 assert.equal((await db.query(`SELECT has_function_privilege('authenticated','public.gridex_outbound_dispatch_v1(jsonb)','EXECUTE') allowed`)).rows[0].allowed,false);checks++
 console.log(`PASS ${checks} targeted Z08 clock checks; baseline mutation fixture, not native/provider evidence`)
}finally{await db.close()}
