// Actual same-OID public persist wrapper and callback fences. Native scope,
// original facet, sourcepack and prior accepted persist use finite declared
// dependencies below. This proves ordering/rollback, NOT a reading approval.
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite()
const c='11111111-1111-4111-8111-111111111111',sid='22222222-2222-4222-8222-222222222222',raw='DECLARED IMMUTABLE UTILTS ORIGINAL'
let count=0
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE SCHEMA gridex_utilts_binding;CREATE SCHEMA gridex_received_sources;CREATE SCHEMA gridex_ediel_inbound_context;CREATE SCHEMA gridex_ediel_source_rules;CREATE SCHEMA gridex_received_reading_expectations;
 CREATE TABLE ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,message_code text,direction text,message_family text,raw_payload text);
 CREATE TABLE gridex_utilts_binding.receipts(source_message_id uuid,company_id uuid,environment text,raw_hash text);
 CREATE TABLE ediel_ack_transaction_results(source_message_id uuid,company_id uuid,environment text,source_transaction_id text,disposition text,persistence_status text,planned_response_type text,finalized_at timestamptz);
 CREATE TABLE declared_owner_state(current_scope bool,own_facet bool,valid_precision bool,delegate_error bool,observer_error bool);INSERT INTO declared_owner_state VALUES(true,true,true,false,false);
 CREATE TABLE declared_effects(n bigint GENERATED ALWAYS AS IDENTITY,kind text,source_id uuid,company_id uuid,environment text);
 CREATE FUNCTION gridex_utilts_binding.lock_storage_graph_v1() RETURNS void LANGUAGE sql AS $$INSERT INTO public.declared_effects(kind) VALUES('lock_storage')$$;
 CREATE FUNCTION gridex_utilts_binding.require_current_esco_storage_v1(uuid,text,uuid,jsonb) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF (SELECT current_scope FROM public.declared_owner_state) IS NOT TRUE THEN RAISE EXCEPTION 'declared_current_scope_missing';END IF;INSERT INTO public.declared_effects(kind) VALUES('current_scope');END$$;
 CREATE FUNCTION gridex_utilts_binding.preserve_committed_projection_v1(uuid,text,uuid,jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN INSERT INTO public.declared_effects(kind) VALUES('preserve_committed');RETURN $4;END$$;
 CREATE FUNCTION gridex_received_sources.require_utilts_transaction_v1(uuid,uuid,text,text,text,jsonb) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF (SELECT own_facet FROM public.declared_owner_state) IS NOT TRUE OR $3 IS DISTINCT FROM 'OWN' OR $4 IS DISTINCT FROM 'accepted' OR $5 IS DISTINCT FROM 'positive_aperak' OR $6 IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'declared_actual_own_facet_required';END IF;INSERT INTO public.declared_effects(kind) VALUES('actual_own_facet');END$$;
 CREATE FUNCTION gridex_ediel_inbound_context.require_v1(uuid,uuid) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN INSERT INTO public.declared_effects(kind) VALUES('original_context');RETURN '{"declared":"context-boundary"}'::jsonb;END$$;
 CREATE FUNCTION gridex_ediel_source_rules.require_v1(uuid,uuid) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN INSERT INTO public.declared_effects(kind) VALUES('source_rule_pack');RETURN '{"declared":"source-pack-boundary"}'::jsonb;END$$;
 CREATE FUNCTION gridex_utilts_binding.wire_tokens_v1(text) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_array(jsonb_build_object('declaredRaw',$1))$$;
 CREATE FUNCTION gridex_utilts_binding.decimal_rules_v1(jsonb,text,text) RETURNS jsonb LANGUAGE sql AS $$SELECT CASE WHEN valid_precision THEN '{"guide":[],"functional":[]}'::jsonb ELSE '{"guide":["516"],"functional":[]}'::jsonb END FROM public.declared_owner_state$$;
 CREATE FUNCTION gridex_utilts_binding.persist_consumption_before_precision_v1(uuid,text,uuid,text,text,jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN IF (SELECT delegate_error FROM public.declared_owner_state) THEN RAISE EXCEPTION 'declared_native_persist_failed';END IF;INSERT INTO public.declared_effects(kind,source_id,company_id,environment) VALUES('native_persist',$3,$1,$2);RETURN jsonb_build_object('declaredNativeResult',true,'unchangedTransactions',$6);END$$;
 CREATE FUNCTION gridex_received_reading_expectations.consider_utilts_source_v1(uuid,text,uuid) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF NOT EXISTS(SELECT FROM public.declared_effects WHERE kind='native_persist' AND source_id=$3 AND company_id=$1 AND environment=$2) THEN RAISE EXCEPTION 'observer_before_actual_persist';END IF;IF (SELECT observer_error FROM public.declared_owner_state) THEN RAISE EXCEPTION 'declared_observer_failed';END IF;INSERT INTO public.declared_effects(kind,source_id,company_id,environment) VALUES('after_persist_observer',$3,$1,$2);END$$;`)
 const old=readFileSync(new URL('../supabase/migrations/20261001003807_ediel_utilts_esco_pre_storage_scope.sql',import.meta.url),'utf8'),start=old.indexOf('CREATE OR REPLACE FUNCTION public.gridex_persist_utilts_consumption_v1'),end=old.indexOf('-- SEND requalifies',start)
 await db.exec(old.slice(start,end))
 const identity=async()=> (await db.query("SELECT oid,proacl::text acl FROM pg_proc WHERE oid='public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb)'::regprocedure")).rows[0]
 const before=await identity()
 if(process.env.EDIEL_READING_PERSIST_BASELINE!=='1')await db.exec(readFileSync(new URL('../supabase/migrations/20261001051410_ediel_utilts_persist_reading_followup_owner.sql',import.meta.url),'utf8'))
 assert.deepEqual(await identity(),before);count++
 await db.query("INSERT INTO ediel_messages VALUES($1,$2,'test','E30','inbound','UTILTS',$3)",[sid,c,raw])
 const tx=[{transactionId:'OWN',disposition:'accepted',responseType:'positive_aperak',issueCodes:[]}]
 const call=async(company=c,payload=raw)=>{await db.exec('SET ROLE service_role');try{return(await db.query("SELECT gridex_persist_utilts_consumption_v1($1,'test',$2,'E30',$3,$4) result",[company,sid,payload,tx])).rows[0].result}finally{await db.exec('RESET ROLE')}}
 const effects=async()=>(await db.query('SELECT kind,source_id,company_id,environment FROM declared_effects ORDER BY n')).rows
 const reset=()=>db.exec('DELETE FROM declared_effects;UPDATE declared_owner_state SET current_scope=true,own_facet=true,valid_precision=true,delegate_error=false,observer_error=false')
 const result=await call();assert.deepEqual(result,{declaredNativeResult:true,unchangedTransactions:tx});assert.deepEqual((await effects()).map(x=>x.kind),['lock_storage','current_scope','preserve_committed','actual_own_facet','original_context','source_rule_pack','native_persist','after_persist_observer']);assert.deepEqual((await effects()).at(-1),{kind:'after_persist_observer',source_id:sid,company_id:c,environment:'test'});count++
 for(const [change,error] of [["current_scope=false",/current_scope_missing/],["own_facet=false",/actual_own_facet_required/],["valid_precision=false",/source_decimal_or_unit_rules_failed/],["delegate_error=true",/native_persist_failed/],["observer_error=true",/observer_failed/]]){
  await reset();await db.exec('UPDATE declared_owner_state SET '+change);await assert.rejects(call,error);assert.deepEqual(await effects(),[],'Callback failure and native owner failure must roll back the same statement');count++
 }
 await reset();await assert.rejects(()=>call('33333333-3333-4333-8333-333333333333'),/source_binding_conflict/);assert.deepEqual(await effects(),[]);await assert.rejects(()=>call(c,raw+' ALTERED'),/source_binding_conflict/);assert.deepEqual(await effects(),[]);count+=2
 await db.exec('SET ROLE authenticated');try{await assert.rejects(()=>db.query("SELECT gridex_persist_utilts_consumption_v1(null,null,null,null,null,'[]')"),/permission denied/);count++}finally{await db.exec('RESET ROLE')}
 const definition=(await db.query("SELECT pg_get_functiondef('public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb)'::regprocedure) d")).rows[0].d
 assert.ok(definition.indexOf('persist_consumption_before_precision_v1')<definition.indexOf('consider_utilts_source_v1'))
 assert.ok(!definition.includes("->>'fulfilled'")&&!definition.includes("->>'approved'"));count++
 console.log('Actual UTILTS AFTER-persist wrapper: '+count+' PASS; sameOID/ACL/source/current scope/first-effect/precision/order/rollback/callback fences. Prior native ownership and observer are finite declared boundaries, NOT native accepted readings or whole criterion approval.')
}finally{await db.close()}
