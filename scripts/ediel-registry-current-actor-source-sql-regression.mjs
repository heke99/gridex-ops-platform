// Bounded actual installed registry owner + NEW composition. Platform admin,
// tenant configuration and minimal catalogue fixtures are declared synthetic.
// No private market/current/approved source is seeded. NOT full Supabase/native
// issuer, certificate/readiness, traffic, masterplan or criterion acceptance.
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite(),uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,literal=s=>"'"+s.replaceAll("'","''")+"'"
const migrations=new URL('../supabase/migrations/',import.meta.url),source=name=>readFileSync(new URL(name,migrations),'utf8')
let count=0
async function check(){try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid primary key);CREATE TABLE user_profiles(id uuid,user_status text);CREATE TABLE admin_users(user_id uuid);CREATE TABLE user_roles(id uuid,user_id uuid);CREATE FUNCTION canonical_actor_is_platform_admin(uuid) RETURNS bool LANGUAGE sql AS 'SELECT $1=''${uid(1)}''::uuid';INSERT INTO auth.users VALUES('${uid(1)}');INSERT INTO user_profiles VALUES('${uid(1)}','active');INSERT INTO admin_users VALUES('${uid(1)}');CREATE SCHEMA gridex_received_sources;CREATE FUNCTION gridex_received_sources.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'immutable';END$$;`)
 const base=source('20260611123000_actor_registry_message_semantics_tenant_automation.sql');await db.exec(base.slice(base.indexOf('create table if not exists public.platform_market_actors'),base.indexOf('-- 2) Message semantics')))
 const staging=source('20260615130000_batch_o3_o6_actor_registry_certificate_hardening.sql');await db.exec(staging.slice(staging.indexOf('create table if not exists public.actor_registry_import_runs'),staging.indexOf('-- Complete existing certificate cache')))
 const cert=source('20260613100000_actor_auto_readiness_certificates.sql');await db.exec(cert.slice(cert.indexOf('create table if not exists public.platform_actor_certificates'),cert.indexOf('create unique index')));await db.exec('CREATE UNIQUE INDEX fixture_cert_key ON platform_actor_certificates(actor_id,environment,purpose,fingerprint_sha256) WHERE fingerprint_sha256 IS NOT NULL')
 await db.exec(source('20260930153118_ediel_actor_legal_identity_name_search_v1.sql'));await db.exec(source('20260930172759_ediel_atomic_registry_import_v1.sql'))
 const guards=source('20260930182758_ediel_current_service_origin_and_registry_conflict_guards.sql');await db.exec(guards.slice(guards.indexOf('CREATE OR REPLACE FUNCTION public.ediel_apply_actor_registry_v1'),guards.indexOf('-- Atomic projection')))
 await db.exec(source('20261001000600_ediel_registry_txt_preview_and_route_history.sql'));count++

 await db.exec(source('20261001031233_ediel_registry_declared_route_source_fields.sql'))
 await db.exec(`CREATE SCHEMA gridex_ediel_ack_replay;CREATE FUNCTION gridex_ediel_ack_replay.lock_current_graph_v2() RETURNS void LANGUAGE plpgsql AS $$BEGIN LOCK TABLE auth.users,public.user_profiles,public.admin_users,public.user_roles,public.platform_actor_identifiers IN SHARE MODE;END$$;
 CREATE TABLE public.companies(id uuid PRIMARY KEY);
 CREATE TABLE public.tenant_actor_identifiers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,environment text,actor_id uuid,identifier_type text,identifier_value text,valid_from timestamptz,valid_to timestamptz);
 CREATE TABLE public.tenant_actor_roles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,environment text,actor_id uuid,role_code text,valid_from timestamptz,valid_to timestamptz);
 CREATE TABLE public.tenant_ediel_profiles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,environment text,market text,is_enabled bool,valid_from timestamptz,valid_to timestamptz);
 CREATE TABLE public.ediel_route_profiles(id uuid PRIMARY KEY,company_id uuid,communication_route_id uuid,metadata jsonb,receiver_subaddress text,environment text,message_family text,transport_type text,receiver_ediel_id text,application_reference text,is_active bool,is_enabled bool,message_standard text,payload_format text);
 CREATE TABLE public.communication_routes(id uuid PRIMARY KEY,company_id uuid,auth_config jsonb,route_type text,environment_type text,target_email text,is_active bool);
 CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,company_id uuid,direction text,message_family text,message_code text,communication_route_id uuid,route_profile_id uuid,environment text,application_reference text,receiver_ediel_id text,receiver_sub_address text,receiver_email text,transport_type text,raw_payload text);
 CREATE SCHEMA gridex_utilts_binding;CREATE FUNCTION gridex_utilts_binding.wire_tokens_v1(text) RETURNS jsonb LANGUAGE sql AS 'SELECT ''[]''::jsonb';`)
 await db.exec(`CREATE SCHEMA gridex_ediel_readiness;CREATE FUNCTION gridex_ediel_readiness.capture(uuid,uuid,uuid,text,text,text,text,uuid,text,text) RETURNS jsonb LANGUAGE sql AS 'SELECT ''{}''::jsonb';CREATE SCHEMA gridex_ediel_transport;CREATE FUNCTION gridex_ediel_transport.mutate_v1(jsonb) RETURNS jsonb LANGUAGE sql AS 'SELECT ''{}''::jsonb';`)
 const upgrade=process.env.EDIEL_REGISTRY_RECORDED_TXT_UPGRADE==='1'
 // Simulates a branch that applied40446 while its own older importer was current,
 // then receives40159 from the other published history. No old bytes are edited.
 if(upgrade)await db.exec(source('20261001040446_ediel_current_registry_txt_source_parity.sql'))
 await db.exec(source('20261001040159_ediel_registry_market_source_isolation.sql'));
 // The independent published market replacement and TXT forward did not compose.
 // Pristine replay applies the additive prerequisite without rewriting either.
 if(process.env.EDIEL_REGISTRY_PREREQUISITE_CONTROL==='1'){
  try{await db.exec(source('20261001040446_ediel_current_registry_txt_source_parity.sql'))}catch(error){console.error('RED chronological40159→40446:',error.message);process.exitCode=2;return}
 }
 await db.exec(source('20261001040445_ediel_registry_market_txt_prerequisite.sql'));
 if(!upgrade)await db.exec(source('20261001040446_ediel_current_registry_txt_source_parity.sql'));
 await db.exec(source('20261001055536_ediel_registry_ai_list_dispatch_source_alias.sql'));
 // Exercise the already-recorded40446 upgrade predicate too: the prerequisite
 // is additive and must not alter this now qualified public function identity.
 if(!upgrade)await db.exec(source('20261001040445_ediel_registry_market_txt_prerequisite.sql'));
 const metadata=async()=>(await db.query("SELECT oid,proacl::text,proowner,proconfig::text,prosecdef,provolatile FROM pg_proc WHERE oid='public.ediel_apply_actor_registry_v1(uuid,text,text,text,text,jsonb)'::regprocedure")).rows[0]
 const before=await metadata();assert.equal((await db.query("SELECT to_regprocedure('gridex_registry_import.current_el_tenant_actor_source_v1(uuid,uuid,text)') IS NULL missing")).rows[0].missing,true);count++;console.log('RED same installed market owner: current tenant/registry legal alias absent')
 if(process.env.EDIEL_REGISTRY_LEGACY_CONTROL==='1')process.exit(2)
 await db.exec(`CREATE SCHEMA gridex_ai_purpose_sources;CREATE SCHEMA gridex_ai_processing;
 CREATE FUNCTION gridex_ai_processing.authorize_original_actor_v1(uuid,uuid) RETURNS void LANGUAGE sql AS 'SELECT NULL::void';
 CREATE FUNCTION gridex_ai_purpose_sources.legal_scope_v1(uuid,text) RETURNS void LANGUAGE sql AS 'SELECT NULL::void';
 CREATE SCHEMA gridex_bilateral_customer_sources;
 CREATE FUNCTION gridex_bilateral_customer_sources.classified_actor_wallclock_v1(uuid,uuid,text,text) RETURNS boolean LANGUAGE sql AS 'SELECT false';
 CREATE FUNCTION gridex_bilateral_customer_sources.classified_scoped_permission_wallclock_v1(uuid,uuid,text) RETURNS boolean LANGUAGE sql AS 'SELECT false';`)
 const purpose=source('20261001020550_ediel_ai_purpose_source_owner.sql')
 const phaseBody=purpose.slice(purpose.indexOf('CREATE FUNCTION gridex_ai_purpose_sources.consumer_v1'),purpose.indexOf('CREATE FUNCTION public.ediel_ai_export_decision_v2'))
 await db.exec(phaseBody.replaceAll('gridex_requested_changes.actor_v1','gridex_bilateral_customer_sources.classified_actor_wallclock_v1').replaceAll('gridex_requested_changes.scoped_permission_v1','gridex_bilateral_customer_sources.classified_scoped_permission_wallclock_v1').replaceAll("'communication.write'","'communication.send'"))
 await db.exec(source('20261001103439_ediel_registry_current_actor_source_guards.sql'));assert.deepEqual(await metadata(),before);count++
 const previewBody=(await db.query("SELECT pg_get_functiondef('public.ediel_read_registry_preview_snapshot_v1(uuid,text[])'::regprocedure) body")).rows[0].body
 assert.ok(previewBody.indexOf('lock_current_graph_v2')<previewBody.indexOf('pg_advisory_xact_lock'));count++
 const verifyBody=(await db.query("SELECT pg_get_functiondef('public.ediel_verify_registry_el_actor_v1(uuid,uuid,uuid)'::regprocedure) body")).rows[0].body
 assert.ok(verifyBody.indexOf('lock_import_graph_v1')<verifyBody.indexOf('FOR UPDATE'));count++
 assert.ok(verifyBody.includes('SHARE ROW EXCLUSIVE'));count++
 const actor={name:'Synthetic primary EL supplier',market:'EL',countryCode:'SE',edielId:'12345',roles:['electricity_supplier'],routes:[{messageFamily:'AI',environment:'test',applicationReference:null,communicationAddress:'recipient@example.invalid',subaddress:null,communicationType:'smtp',partyId:'12345',interchangePartyId:'54321'}],certificates:[],raw:{sourceKind:'companies_txt'}}
 async function apply(bytes,records=[actor]){const hash=createHash('sha256').update(bytes).digest('hex');await db.exec('SET ROLE service_role');try{return(await db.query(`SELECT public.ediel_apply_actor_registry_v1('${uid(1)}',${literal(Buffer.from(bytes).toString('base64'))},'${hash}','companies_txt','synthetic.txt',${literal(JSON.stringify(records))}::jsonb) result`)).rows[0].result}finally{await db.exec('RESET ROLE')}}
 const first=await apply('SYNTHETIC exact actual TXT bytes');assert.equal(first.created,1);assert.equal(first.activation,'held_pending_current_source_readiness');count++
 const route=first.routeIds[0],aid=first.actors[0].actorId
 const src=async()=>(await db.query(`SELECT gridex_registry_import.route_source_v1('${route}') q`)).rows[0].q
 assert.equal((await src()).status,'source_qualified');assert.equal((await src()).legalEdielId,'12345');assert.equal((await src()).wire.interchangePartyId,'54321');count++
 const flags=(await db.query(`SELECT status,is_verified,auto_send_allowed FROM public.platform_actor_routes WHERE id='${route}'`)).rows[0];assert.deepEqual(flags,{status:'needs_review',is_verified:false,auto_send_allowed:false});count++
 const sourceHash=(await src()).sourceSha256;assert.equal(sourceHash,createHash('sha256').update('SYNTHETIC exact actual TXT bytes').digest('hex'));assert.equal((await db.query('SELECT count(*)::int n FROM gridex_registry_import.normalized_batches')).rows[0].n,1);count++
 assert.equal((await apply('SYNTHETIC exact actual TXT bytes')).reusedExistingRun,true);assert.equal((await db.query('SELECT count(*)::int n FROM gridex_registry_import.market_records')).rows[0].n,1);count++
 await db.exec(`INSERT INTO public.tenant_actor_identifiers(company_id,environment,actor_id,identifier_type,identifier_value,valid_from) VALUES('${uid(20)}','test','${uid(21)}','EdielId','12345',clock_timestamp()-interval '1 day');INSERT INTO public.tenant_actor_roles(company_id,environment,actor_id,role_code,valid_from) VALUES('${uid(20)}','test','${uid(21)}','electricity_supplier',clock_timestamp()-interval '1 day');INSERT INTO public.tenant_ediel_profiles(company_id,environment,market,is_enabled,valid_from) VALUES('${uid(20)}','test','electricity',true,clock_timestamp()-interval '1 day')`)
 const tenant=async(c=uid(20),env='test')=>(await db.query(`SELECT gridex_registry_import.current_el_tenant_actor_source_v1('${c}','${uid(21)}','${env}') q`)).rows[0].q
 const q=await tenant();assert.equal(q.sourceActorId,aid);assert.equal(q.legalActorId,uid(21));assert.notEqual(q.sourceActorId,q.legalActorId);assert.equal(q.companyId,uid(20));count++
 await assert.rejects(()=>tenant(uid(99)),/unique_current_tenant/);await assert.rejects(()=>tenant(uid(20),'production'),/unique_current_tenant/);count++
 await db.exec(`UPDATE public.tenant_actor_roles SET valid_to=clock_timestamp()-interval '1 second'`);await assert.rejects(()=>tenant(),/current_tenant_el_supplier/);await db.exec('UPDATE public.tenant_actor_roles SET valid_to=NULL');count++
 const gas=await apply('SYNTHETIC GAS same legal ID',[{...actor,name:'Synthetic GAS must not replace EL',market:'GAS',roles:['electricity_supplier']}]);assert.notEqual(gas.routeIds[0],route);assert.equal((await tenant()).legalName,actor.name);assert.equal((await db.query(`SELECT is_active FROM public.platform_actor_roles WHERE actor_id='${aid}'`)).rows[0].is_active,true);assert.equal((await db.query(`SELECT name FROM public.platform_market_actors WHERE id='${aid}'`)).rows[0].name,actor.name);count++
 await assert.rejects(()=>db.query(`SELECT gridex_registry_import.require_el_route_v1('${gas.routeIds[0]}')`),/current_el_route_source_required/);count++
 const profile=uid(31),comm=uid(32);await db.exec(`INSERT INTO public.communication_routes VALUES('${comm}','${uid(20)}','{"platform_actor_route_id":"${route}"}','ediel_partner','bilateral_test','recipient@example.invalid',true);INSERT INTO public.ediel_route_profiles VALUES('${profile}','${uid(20)}','${comm}','{"platform_actor_route_id":"${route}"}',NULL,'test','AI_LIST','smtp','54321',NULL,true,true,'ai_list','raw')`)
 const dispatch=async(c=uid(20))=>(await db.query(`SELECT gridex_registry_import.dispatch_source_v1('${c}','${comm}','${profile}','test','AI_LIST',NULL) q`)).rows[0].q
 assert.equal((await dispatch()).canonicalFamily,'AI');assert.equal((await dispatch()).legalEdielId,'12345');count++
 await assert.rejects(()=>dispatch(uid(99)),/owned_route_profile_required/);count++
 await db.exec(`UPDATE public.communication_routes SET target_email='forged@example.invalid'`);await assert.rejects(()=>dispatch(),/dispatch_source_mismatch/);await db.exec(`UPDATE public.communication_routes SET target_email='recipient@example.invalid'`);count++
 await db.exec(`UPDATE public.platform_actor_routes SET interchange_party_id='98765' WHERE id='${route}'`);assert.equal((await src()).status,'held');await db.exec(`UPDATE public.platform_actor_routes SET interchange_party_id='54321' WHERE id='${route}'`);count++
 await db.exec(`UPDATE public.platform_actor_identifiers SET valid_to=current_date-1 WHERE actor_id='${aid}'`);assert.equal((await src()).status,'held');assert.equal((await tenant()).status,'held');await db.exec(`UPDATE public.platform_actor_identifiers SET valid_to=NULL WHERE actor_id='${aid}'`);count++
 await db.exec(`UPDATE public.platform_actor_roles SET is_active=false WHERE actor_id='${aid}'`);assert.equal((await tenant()).status,'held');await db.exec(`UPDATE public.platform_actor_roles SET is_active=true WHERE actor_id='${aid}'`);count++
 await db.exec(`UPDATE public.platform_market_actors SET status='blocked' WHERE id='${aid}'`);assert.equal((await src()).status,'held');assert.equal((await tenant()).status,'held');await db.exec(`UPDATE public.platform_market_actors SET status='active' WHERE id='${aid}'`);count++
 await db.exec(`UPDATE public.platform_actor_routes SET valid_to=current_date-1 WHERE id='${route}'`);assert.equal((await src()).status,'held');await db.exec(`UPDATE public.platform_actor_routes SET valid_to=NULL WHERE id='${route}'`);count++
 const later=await apply('SYNTHETIC later EL byte original',[{...actor,name:'Synthetic newer actual EL owner'}]);assert.equal(later.routeIds[0],route);assert.equal((await src()).legalName,'Synthetic newer actual EL owner');assert.notEqual((await src()).sourceSha256,sourceHash);count++
 await assert.rejects(()=>db.exec('DELETE FROM gridex_registry_import.market_records'),/immutable/);await assert.rejects(()=>db.exec('DELETE FROM gridex_registry_import.normalized_batches'),/immutable/);count++
 await db.exec(`INSERT INTO public.ediel_messages VALUES('${uid(40)}','${uid(20)}','outbound','AI_LIST','AI','${comm}','${profile}','test',NULL,'54321',NULL,'recipient@example.invalid','smtp','physical CSV owned elsewhere')`);assert.equal((await db.query(`SELECT gridex_registry_import.require_message_market_v1('${uid(20)}','${uid(40)}') q`)).rows[0].q.status,'source_qualified');count++
 await db.exec('SET ROLE authenticated');try{await assert.rejects(()=>db.query(`SELECT gridex_registry_import.current_el_actor_source_v1('${aid}')`),/permission denied/);await assert.rejects(()=>db.query(`SELECT public.ediel_registry_route_source_v1('${route}')`),/permission denied/);count++}finally{await db.exec('RESET ROLE')}
 console.log(`PASS ${count} bounded actual registry public-import/new EL owner/tenant alias/current route/hash/TXT/market separation/replay/ACL checks; NOT genuine native/Supabase/legal issuer/route activation/masterplan approval`)
}finally{await db.close()}}
await check()
