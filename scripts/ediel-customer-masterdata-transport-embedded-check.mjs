// Runs the actual forward wrapper with declared source/old-journal ports.
// Synthetic mechanics only; not native replay, authentic source, or concurrency.
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite()
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
let checks=0
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE SCHEMA gridex_customer_masterdata;CREATE SCHEMA gridex_ediel_transport;
 CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text);
 CREATE TABLE gridex_ediel_transport.reservations(message_id uuid PRIMARY KEY,attempt_id uuid,state text);
 CREATE TABLE trace(position bigint GENERATED ALWAYS AS IDENTITY,port text);
 CREATE TABLE control(source_ok bool,actor_ok bool,old_calls int);INSERT INTO control VALUES(true,true,0);
 CREATE FUNCTION gridex_customer_masterdata.prelock_message_v1(c uuid,m uuid) RETURNS void LANGUAGE plpgsql AS $$BEGIN INSERT INTO public.trace(port) VALUES('source_prelock');END$$;
 CREATE FUNCTION gridex_customer_masterdata.require_current_v1(c uuid,m uuid,actor uuid,phase text) RETURNS void LANGUAGE plpgsql AS $$BEGIN
 INSERT INTO public.trace(port) VALUES('current_source');IF phase<>'send' OR actor IS DISTINCT FROM '${id(20)}'::uuid OR (SELECT actor_ok FROM public.control) IS NOT TRUE THEN RAISE EXCEPTION 'actual_actor_held';END IF;
 IF(SELECT source_ok FROM public.control) IS NOT TRUE THEN RAISE EXCEPTION 'actual_source_held';END IF;END$$;
 CREATE FUNCTION gridex_ediel_transport.mutate_v1(input jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE state text;BEGIN
 IF input->>'actorUserId' IS DISTINCT FROM '${id(20)}' OR (SELECT actor_ok FROM public.control) IS NOT TRUE THEN RAISE EXCEPTION 'old_actor_held';END IF;
 IF NOT EXISTS(SELECT FROM public.ediel_messages WHERE id=(input->>'messageId')::uuid AND company_id=(input->>'companyId')::uuid AND environment=input->>'environment') THEN RAISE EXCEPTION 'old_scope_held';END IF;
 INSERT INTO public.trace(port) VALUES('old_delegate');UPDATE public.control SET old_calls=old_calls+1;
 SELECT r.state INTO state FROM gridex_ediel_transport.reservations r WHERE r.message_id=(input->>'messageId')::uuid;
 IF input->>'action'='prepare' AND state IS NOT NULL AND state<>'released' OR input->>'action'='enter' AND state IN('entered','observed') THEN RETURN jsonb_build_object('proceed',false,'state',state,'providerReceipt','fixed-old-result');END IF;
 RETURN jsonb_build_object('proceed',true);END$$;
 INSERT INTO public.ediel_messages VALUES('${id(1)}','${id(2)}','test','outbound');`)
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001030524_ediel_customer_masterdata_fresh_transport_source.sql',import.meta.url),'utf8'))
 const base={companyId:id(2),messageId:id(1),actorUserId:id(20),environment:'test',attemptId:id(10)}
 const call=async(action,extra={})=>(await db.query('SELECT gridex_ediel_transport.mutate_v1($1::jsonb) result',[JSON.stringify({...base,action,...extra})])).rows[0].result
 const reset=()=>db.exec('DELETE FROM public.trace;UPDATE public.control SET old_calls=0;')
 for(const action of ['prepare','enter']){
  await reset();assert.equal((await call(action)).proceed,true)
  assert.deepEqual((await db.query('SELECT port FROM public.trace ORDER BY position')).rows.map(r=>r.port),['source_prelock','current_source','old_delegate']);checks+=2
 }
 await db.exec('UPDATE public.control SET source_ok=false')
 for(const action of ['prepare','enter']){
  await reset();await assert.rejects(()=>call(action),/actual_source_held/)
  assert.equal((await db.query('SELECT old_calls FROM public.control')).rows[0].old_calls,0);checks+=2
 }
 for(const state of ['prepared','entered','observed']){
  await db.exec(`INSERT INTO gridex_ediel_transport.reservations VALUES('${id(1)}','${id(10)}','${state}') ON CONFLICT(message_id) DO UPDATE SET state=excluded.state`)
  await reset();const before=(await db.query('SELECT * FROM gridex_ediel_transport.reservations')).rows
  const result=await call('prepare');assert.equal(result.proceed,false);assert.equal(result.providerReceipt,'fixed-old-result')
  assert.equal((await db.query("SELECT count(*)::int n FROM public.trace WHERE port='current_source'")).rows[0].n,0)
  assert.deepEqual((await db.query('SELECT * FROM gridex_ediel_transport.reservations')).rows,before);checks+=3
  if(state!=='prepared'){await reset();assert.equal((await call('enter')).proceed,false);assert.equal((await db.query("SELECT count(*)::int n FROM public.trace WHERE port='current_source'")).rows[0].n,0);checks+=2}
 }
 await reset();await assert.rejects(()=>call('prepare',{companyId:id(3)}),/old_scope_held/);assert.equal((await db.query('SELECT old_calls FROM public.control')).rows[0].old_calls,0);checks+=2
 await reset();await assert.rejects(()=>call('prepare',{actorUserId:id(21)}),/old_actor_held/);assert.equal((await db.query('SELECT old_calls FROM public.control')).rows[0].old_calls,0);checks+=2
 await db.exec(`UPDATE gridex_ediel_transport.reservations SET state='released'`);await reset();await assert.rejects(()=>call('prepare'),/actual_source_held/);checks++
 await reset();assert.equal((await call('observe')).proceed,true);assert.deepEqual((await db.query('SELECT port FROM public.trace ORDER BY position')).rows.map(r=>r.port),['old_delegate']);checks+=2
 for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query("SELECT has_function_privilege($1,'gridex_ediel_transport.mutate_before_customer_masterdata_source_v1(jsonb)','EXECUTE') allowed",[role])).rows[0].allowed,false);checks+=3
 console.log(`PASS ${checks} declared-port source-before-journal / fixed-result / actor / atomic wrapper mechanics; native/replay/concurrency NOT_RUN`)
}finally{await db.close()}
