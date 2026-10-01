// Execute the actual scoped wallclock permission body and forward wrapper in
// a declared reduced DB. Graph locks and preceding storage are mechanical
// models; original/source/concurrency/native acceptance remains separate.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import {fileURLToPath,pathToFileURL} from 'node:url'
if(!process.env.EDIEL_PGLITE_MODULE)throw Error('EDIEL_PGLITE_MODULE required')
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const db=new PGlite(),root=fileURLToPath(new URL('..',import.meta.url)),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
let checks=0
try {
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE SCHEMA auth;CREATE SCHEMA gridex_utilts_binding;CREATE SCHEMA gridex_bilateral_customer_sources;CREATE SCHEMA gridex_ediel_ack_replay;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz);
 CREATE TABLE public.user_profiles(id uuid PRIMARY KEY,user_status text);
 CREATE TABLE public.companies(id uuid PRIMARY KEY,is_active boolean,status text);
 CREATE TABLE public.company_memberships(company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);
 CREATE TABLE public.admin_users(user_id uuid,is_active boolean,role text);
 CREATE TABLE public.user_roles(id uuid DEFAULT gen_random_uuid(),user_id uuid,company_id uuid,role_id uuid,status text,is_active boolean,role text);
 CREATE TABLE public.roles(id uuid,key text,name text,is_active boolean);
 CREATE TABLE public.permissions(id uuid,key text,is_active boolean);
 CREATE TABLE public.role_permissions(id uuid DEFAULT gen_random_uuid(),role_id uuid,permission_id uuid,permission_key text,effect text);
 CREATE TABLE public.user_permissions(id uuid DEFAULT gen_random_uuid(),user_id uuid,company_id uuid,permission_id uuid,is_active boolean,status text,effect text,permission_key text);
 CREATE TABLE public.user_permission_overrides(user_id uuid,company_id uuid,is_active boolean,effect text,permission_key text,valid_from timestamptz,valid_to timestamptz);
 CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_family text,message_code text,raw_payload text);
 CREATE TABLE gridex_utilts_binding.fixture_effects(actorless_source uuid,company uuid);
 CREATE TABLE gridex_utilts_binding.fixture_inner_delay(milliseconds int);
 -- Models deliberately cannot establish concurrent transaction acceptance.
 CREATE FUNCTION gridex_ediel_ack_replay.lock_current_graph_v2() RETURNS void LANGUAGE sql AS $$SELECT NULL::void$$;
 CREATE FUNCTION gridex_utilts_binding.lock_storage_graph_v1() RETURNS void LANGUAGE sql AS $$SELECT NULL::void$$;
 CREATE FUNCTION public.gridex_persist_utilts_consumption_v1(c uuid,env text,sid uuid,code text,raw text,transactions jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$BEGIN
 PERFORM pg_sleep(milliseconds/1000.0) FROM gridex_utilts_binding.fixture_inner_delay;
 INSERT INTO gridex_utilts_binding.fixture_effects VALUES(sid,c);RETURN jsonb_build_object('source',sid,'outcomes',transactions);END$$;
 GRANT EXECUTE ON FUNCTION public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb) TO service_role;`)
 // Match the installed faithful port from 92425: full actual10758 permission
 // function renamed and now() replaced; no positive resolver fixture.
 const permission=fs.readFileSync(root+'/supabase/migrations/20261001010758_ediel_bilateral_customer_source_owner.sql','utf8')
 const body=permission.slice(permission.indexOf('CREATE OR REPLACE FUNCTION gridex_requested_changes.scoped_permission_v1'),permission.indexOf('CREATE OR REPLACE FUNCTION gridex_requested_changes.actor_v1'))
 await db.exec(body.replaceAll('gridex_requested_changes.scoped_permission_v1','gridex_bilateral_customer_sources.classified_scoped_permission_wallclock_v1').replaceAll('now()','clock_timestamp()'))
 await db.exec(fs.readFileSync(root+'/supabase/migrations/20261001110500_ediel_utilts_current_execution_actor.sql','utf8'));checks++
 const company=id(1),actor=id(2),foreign=id(3),source=id(4),permissionId=id(5)
 await db.query('INSERT INTO auth.users VALUES($1,NULL,NULL),($2,NULL,NULL)',[actor,foreign])
 await db.query("INSERT INTO public.user_profiles VALUES($1,'active'),($2,'active')",[actor,foreign])
 await db.query("INSERT INTO public.companies VALUES($1,true,'active')",[company])
 await db.query("INSERT INTO public.company_memberships VALUES($1,$2,'active',true,now())",[company,actor])
 await db.query("INSERT INTO public.permissions VALUES($1,'metering.write',true)",[permissionId])
 await db.query("INSERT INTO public.user_permissions(user_id,company_id,permission_id,is_active,status,effect,permission_key) VALUES($1,$2,$3,true,'active','allow','metering.write')",[actor,company,permissionId])
 await db.query("INSERT INTO public.ediel_messages VALUES($1,$2,'test','inbound','UTILTS','E66','OWN ORIGINAL')",[source,company])
 const call="SELECT public.gridex_persist_utilts_consumption_v1($1,'test',$2,'E66',$3,'[]'::jsonb,$4) result"
 async function invoke(operator=actor,tenant=company,raw='OWN ORIGINAL'){
  await db.exec('SET ROLE service_role')
  try{return (await db.query(call,[tenant,source,raw,operator])).rows[0].result}
  finally{await db.exec('RESET ROLE')}
 }
 const effects=async()=>Number((await db.query('SELECT count(*)::int n FROM gridex_utilts_binding.fixture_effects')).rows[0].n)
 assert.deepEqual(await invoke(),{source,outcomes:[]});assert.equal(await effects(),1);checks++
 async function denied(operator,tenant=company,raw='OWN ORIGINAL',code='42501'){
  const before=await effects();await assert.rejects(invoke(operator,tenant,raw),error=>error.code===code);assert.equal(await effects(),before);checks++
 }
 await denied(null);await denied(foreign);await denied(actor,id(9),'OWN ORIGINAL','P0U01');await denied(actor,company,'FORGED BYTES','P0U01')
 await db.query('UPDATE public.company_memberships SET is_active=false WHERE user_id=$1',[actor]);await denied(actor)
 await db.query('UPDATE public.company_memberships SET is_active=true,accepted_at=NULL WHERE user_id=$1',[actor]);await denied(actor)
 await db.query('UPDATE public.company_memberships SET accepted_at=now() WHERE user_id=$1',[actor])
 await db.query("UPDATE public.user_profiles SET user_status='inactive' WHERE id=$1",[actor]);await denied(actor)
 await db.query("UPDATE public.user_profiles SET user_status='active' WHERE id=$1",[actor])
 await db.query("UPDATE public.companies SET status='suspended' WHERE id=$1",[company]);await denied(actor)
 await db.query("UPDATE public.companies SET status='active' WHERE id=$1",[company])
 await db.query('UPDATE auth.users SET deleted_at=clock_timestamp() WHERE id=$1',[actor]);await denied(actor)
 await db.query('UPDATE auth.users SET deleted_at=NULL WHERE id=$1',[actor])
 await db.query("INSERT INTO public.user_permission_overrides VALUES($1,$2,true,'deny','metering.write',NULL,NULL)",[actor,company]);await denied(actor)
 await db.exec('TRUNCATE public.user_permission_overrides')
 await db.query("INSERT INTO public.user_permissions(user_id,company_id,permission_id,is_active,status,effect,permission_key) VALUES($1,NULL,NULL,true,'active','deny','metering.write')",[actor]);await denied(actor)
 await db.query("DELETE FROM public.user_permissions WHERE effect='deny'")
 // A global administrator still needs an actual own-company permission.
 await db.query("INSERT INTO public.admin_users VALUES($1,true,'super_admin')",[actor])
 await db.query("UPDATE public.user_permissions SET company_id=NULL WHERE user_id=$1",[actor]);await denied(actor)
 await db.query('UPDATE public.user_permissions SET company_id=$1 WHERE user_id=$2',[company,actor])
 // A scoped role deny wins over a direct tenant allow.
 const role=id(6)
 await db.query("INSERT INTO public.roles VALUES($1,'operator','Operator',true)",[role])
 await db.query("INSERT INTO public.user_roles(user_id,company_id,role_id,status,is_active) VALUES($1,$2,$3,'active',true)",[actor,company,role])
 await db.query("INSERT INTO public.role_permissions(role_id,permission_id,effect) VALUES($1,$2,'deny')",[role,permissionId]);await denied(actor)
 await db.exec('TRUNCATE public.role_permissions')
 // Transaction-start now() is earlier than an effective deny after a wait.
 // The actual permission port must use execution clock and reject no-effects.
 async function afterTransactionWait(kind){
  await db.exec('TRUNCATE public.user_permission_overrides')
  const before=await effects()
  const timed=kind==='becomes-denied'?'clock_timestamp()+interval \'0.20 seconds\',NULL':'NULL,clock_timestamp()+interval \'0.20 seconds\''
  await db.query(`INSERT INTO public.user_permission_overrides VALUES($1,$2,true,'deny','metering.write',${timed})`,[actor,company])
  await db.exec('BEGIN')
  const start=(await db.query("SELECT now()<coalesce(valid_from,valid_to) stale FROM public.user_permission_overrides")).rows[0].stale
  assert.equal(start,true)
  await new Promise(resolve=>setTimeout(resolve,300))
  await db.exec('SET LOCAL ROLE service_role')
  if(kind==='becomes-denied'){
   await assert.rejects(db.query(call,[company,source,'OWN ORIGINAL',actor]),error=>error.code==='42501')
   await db.exec('ROLLBACK');assert.equal(await effects(),before)
  }else{
   assert.deepEqual((await db.query(call,[company,source,'OWN ORIGINAL',actor])).rows[0].result,{source,outcomes:[]})
   await db.exec('COMMIT');assert.equal(await effects(),before+1)
  }
  checks++
 }
 await afterTransactionWait('becomes-denied');await afterTransactionWait('becomes-allowed')
 await db.exec('TRUNCATE public.user_permission_overrides')
 // Authority may expire inside the prior owner. Final guard rolls its effect
 // back. Delay is an explicit model, not a concurrent native lock claim.
 await db.query("INSERT INTO public.user_permission_overrides VALUES($1,$2,true,'deny','metering.write',clock_timestamp()+interval '0.20 seconds',NULL)",[actor,company])
 await db.exec('INSERT INTO gridex_utilts_binding.fixture_inner_delay VALUES(300)')
 await denied(actor)
 await db.exec('TRUNCATE gridex_utilts_binding.fixture_inner_delay,public.user_permission_overrides')
 assert.deepEqual(await invoke(),{source,outcomes:[]});checks++
 assert.equal((await db.query("SELECT to_regprocedure('public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb)') IS NULL absent")).rows[0].absent,true);checks++
 assert.equal((await db.query("SELECT has_function_privilege('authenticated','public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb,uuid)','EXECUTE') allowed")).rows[0].allowed,false);checks++
 assert.equal((await db.query("SELECT has_function_privilege('service_role','gridex_utilts_binding.persist_consumption_before_actor_v1(uuid,text,uuid,text,text,jsonb)','EXECUTE') allowed")).rows[0].allowed,false);checks++
 assert.equal((await db.query("SELECT has_function_privilege('service_role','gridex_utilts_binding.require_execution_actor_v1(uuid,uuid)','EXECUTE') allowed")).rows[0].allowed,false);checks++
 console.log(JSON.stringify({status:'PASS',checks,evidence:'reduced-mechanical-only',nativeAcceptance:'NOT_RUN',temporalCases:'deny/allow after transaction-start wait;inner-owner wait rollback'}))
} finally {await db.close()}
