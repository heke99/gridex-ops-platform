// Explicit embedded PostgreSQL fixtures: atomicity/idempotency/ownership only.
// Shared platform authorization is declared here; this is not native evidence.
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
if(!process.env.EDIEL_PGLITE_MODULE)throw new Error('EDIEL_PGLITE_MODULE required')
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite()
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const sqlText=s=>"'"+s.replaceAll("'","''")+"'"
let checks=0
 async function apply(bytes,records,actor=uid(1),hash=createHash('sha256').update(bytes).digest('hex')){await db.exec('SET ROLE service_role');try{return(await db.query(`SELECT ediel_apply_actor_registry_v1('${actor}',${sqlText(Buffer.from(bytes).toString('base64'))},'${hash}','companies_xml','synthetic.xml',${sqlText(JSON.stringify(records))}::jsonb) result`)).rows[0].result}finally{await db.exec('RESET ROLE')}}
async function readPrior(bytes,actor=uid(1),hash=createHash('sha256').update(bytes).digest('hex'),kind='companies_xml'){await db.exec('SET ROLE service_role');try{return(await db.query(`SELECT ediel_read_actor_registry_batch_v1('${actor}',${sqlText(Buffer.from(bytes).toString('base64'))},'${hash}',${sqlText(kind)}) result`)).rows[0].result}finally{await db.exec('RESET ROLE')}}
const actor=(ediel,name='Synthetic actor',org='SYNTHETIC-ORG')=>({name,legalName:name,orgNumber:org,edielId:ediel,eic:null,svkId:null,market:'EL',countryCode:'SE',roles:['energy_service_company'],routes:[{messageFamily:'PRODAT',environment:'production',communicationType:'smtp',communicationAddress:'synthetic@example.invalid',partyId:ediel,interchangePartyId:ediel,applicationReference:'SYNTHETIC-APP'}],certificates:[],raw:{fixture:true}})
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid primary key);CREATE TABLE user_profiles(id uuid,user_status text);CREATE TABLE admin_users(user_id uuid);CREATE TABLE user_roles(id uuid,user_id uuid);CREATE FUNCTION canonical_actor_is_platform_admin(uuid) RETURNS bool LANGUAGE sql AS 'SELECT $1=''${uid(1)}''::uuid';INSERT INTO auth.users VALUES('${uid(1)}');INSERT INTO user_profiles VALUES('${uid(1)}','active');INSERT INTO admin_users VALUES('${uid(1)}');`)
 const root=new URL('../supabase/migrations/',import.meta.url)
 const base=readFileSync(new URL('20260611123000_actor_registry_message_semantics_tenant_automation.sql',root),'utf8');await db.exec(base.slice(base.indexOf('create table if not exists public.platform_market_actors'),base.indexOf('-- 2) Message semantics')))
 const staging=readFileSync(new URL('20260615130000_batch_o3_o6_actor_registry_certificate_hardening.sql',root),'utf8');await db.exec(staging.slice(staging.indexOf('create table if not exists public.actor_registry_import_runs'),staging.indexOf('-- Complete existing certificate cache')))
 const cert=readFileSync(new URL('20260613100000_actor_auto_readiness_certificates.sql',root),'utf8');await db.exec(cert.slice(cert.indexOf('create table if not exists public.platform_actor_certificates'),cert.indexOf('create unique index')));await db.exec(`CREATE UNIQUE INDEX fixture_cert_key ON platform_actor_certificates(actor_id,environment,purpose,fingerprint_sha256) WHERE fingerprint_sha256 IS NOT NULL`)
 await db.exec(readFileSync(new URL('20260930153118_ediel_actor_legal_identity_name_search_v1.sql',root),'utf8'))
 await db.exec(readFileSync(new URL('20260930172759_ediel_atomic_registry_import_v1.sql',root),'utf8'));checks++
 const forward=readFileSync(new URL('20260930182758_ediel_current_service_origin_and_registry_conflict_guards.sql',root),'utf8');await db.exec(forward.slice(forward.indexOf('CREATE OR REPLACE FUNCTION public.ediel_apply_actor_registry_v1'),forward.indexOf('-- Atomic projection')));
 const first=await apply('SYNTHETIC SOURCE ONE',[actor('21660')]);assert.equal(first.created,1);assert.equal(first.activation,'held_pending_current_source_readiness');checks++
 const replay=await apply('SYNTHETIC SOURCE ONE',[actor('21660')]);assert.equal(replay.reusedExistingRun,true);assert.equal(replay.importRunId,first.importRunId);checks++
 await assert.rejects(apply('SYNTHETIC SOURCE ONE',[actor('99999')]),/normalization_conflict/);checks++
 await assert.rejects(apply('SYNTHETIC SOURCE TWO',[actor('22222')],uid(99)),/platform_actor_required/);checks++
 await assert.rejects(apply('SYNTHETIC SOURCE TWO',[actor('22222')],uid(1),'a'.repeat(64)),/exact_source_hash/);checks++
 // A later conflict rolls back every earlier candidate and header/item write.
 await assert.rejects(apply('SYNTHETIC CONFLICT BATCH',[actor('NEW-ID'),actor('21660','Conflicting','OTHER-ORG')]),/legal_org_conflict/)
 assert.equal((await db.query(`SELECT count(*)::int count FROM platform_market_actors`)).rows[0].count,1)
 assert.equal((await db.query(`SELECT count(*)::int count FROM actor_registry_import_runs`)).rows[0].count,1);checks++
 await assert.rejects(apply('SYNTHETIC DUPLICATE BATCH',[actor('DUP'),actor('DUP')]),/duplicate_source_legal_identity/);checks++
 const shared=await apply('SYNTHETIC SHARED ORG',[actor('22222','Synthetic actor')]);assert.equal(shared.created,1)
 assert.equal((await db.query(`SELECT count(*)::int count FROM platform_market_actors WHERE org_number='SYNTHETIC-ORG'`)).rows[0].count,2)
 assert.equal((await db.query(`SELECT count(*)::int count FROM platform_actor_identifiers WHERE identifier_type='OrgNo'`)).rows[0].count,1);checks++
 const routes=(await db.query(`SELECT is_verified,auto_send_allowed,status FROM platform_actor_routes`)).rows;assert.ok(routes.every(r=>r.status==='needs_review'&&!r.is_verified&&!r.auto_send_allowed));checks++
 await db.exec(`UPDATE platform_actor_routes SET is_verified=true,auto_send_allowed=true,status='active' WHERE party_id='21660'`)
 await apply('SYNTHETIC SAME TECHNICAL SOURCE REVISION',[actor('21660')])
 assert.equal((await db.query(`SELECT auto_send_allowed FROM platform_actor_routes WHERE party_id='21660'`)).rows[0].auto_send_allowed,true);checks++
 const changed=actor('21660');changed.routes[0].interchangePartyId='OTHER-TECHNICAL-IDENTITY'
 await apply('SYNTHETIC CHANGED TECHNICAL ROUTE',[changed])
 const changedRoute=(await db.query(`SELECT status,is_verified,auto_send_allowed FROM platform_actor_routes WHERE party_id='21660'`)).rows[0]
 assert.deepEqual(changedRoute,{status:'needs_review',is_verified:false,auto_send_allowed:false});checks++
 await db.exec(`UPDATE platform_actor_routes SET is_verified=true,auto_send_allowed=true,status='active' WHERE party_id='21660'`)
 const moved=actor('21660');moved.routes[0].communicationAddress='new-target@example.invalid'
 await apply('SYNTHETIC CONTRADICTORY TARGET',[moved])
 const both=(await db.query(`SELECT communication_address,status,is_verified,auto_send_allowed FROM platform_actor_routes WHERE party_id='21660' ORDER BY communication_address`)).rows
 assert.equal(both.length,2);assert.ok(both.every(r=>r.status==='needs_review'&&!r.is_verified&&!r.auto_send_allowed));checks++
 // A separate genuine application does not replace the other application's route.
 await db.exec(`UPDATE platform_actor_routes SET is_verified=true,auto_send_allowed=true,status='active' WHERE party_id='21660' AND communication_address='new-target@example.invalid'`)
 const separate=actor('21660');separate.routes[0].applicationReference='OTHER-SOURCE-APP';separate.routes[0].communicationAddress='separate@example.invalid'
 await apply('SYNTHETIC SEPARATE APPLICATION',[separate])
 assert.equal((await db.query(`SELECT auto_send_allowed FROM platform_actor_routes WHERE party_id='21660' AND communication_address='new-target@example.invalid'`)).rows[0].auto_send_allowed,true);checks++
 const held=await apply('SYNTHETIC MISSING ID',[actor(null)]);assert.equal(held.conflicts,1);assert.equal(held.created,0);checks++
 await db.exec(`INSERT INTO actor_registry_import_runs(source,source_hash,status) VALUES('legacy',encode(sha256(convert_to('LEGACY SOURCE','UTF8')),'hex'),'running')`)
 await assert.rejects(apply('LEGACY SOURCE',[actor('LEGACY')]),/legacy_run_requires_reconciliation/);checks++
 await assert.rejects(db.exec(`DELETE FROM gridex_registry_import.batches`),/batch_immutable/);checks++
 assert.equal((await db.query(`SELECT has_function_privilege('authenticated','public.ediel_apply_actor_registry_v1(uuid,text,text,text,text,jsonb)','EXECUTE') allowed`)).rows[0].allowed,false);checks++
 // Create an actual immutable prior zero-route result under the previous sole
 // owner, then install the forward. Replay must retain that exact prior result.
 const priorZeroActor={...actor('LEGACY-NO-ROUTE'),routes:[]}
 const priorZero=await apply('SYNTHETIC PRIOR ZERO ROUTES',[priorZeroActor]);assert.deepEqual(priorZero.routeIds,[])
 await db.exec(readFileSync(new URL('20261001025903_ediel_registry_zero_route_import_hold.sql',root),'utf8'));checks++
 const priorZeroReplay=await apply('SYNTHETIC PRIOR ZERO ROUTES',[priorZeroActor])
 assert.deepEqual(priorZeroReplay,{...priorZero,reusedExistingRun:true});checks++
 const counts=async()=> (await db.query(`SELECT
  (SELECT count(*)::int FROM platform_market_actors) actors,
  (SELECT count(*)::int FROM platform_actor_identifiers) identifiers,
  (SELECT count(*)::int FROM platform_actor_roles) roles,
  (SELECT count(*)::int FROM platform_actor_routes) routes,
  (SELECT count(*)::int FROM platform_actor_certificates) certificates,
  (SELECT count(*)::int FROM actor_registry_import_runs) runs,
  (SELECT count(*)::int FROM actor_registry_import_items) items,
  (SELECT count(*)::int FROM platform_actor_import_runs) ui_runs,
  (SELECT count(*)::int FROM platform_actor_import_issues) issues,
  (SELECT count(*)::int FROM gridex_registry_import.batches) batches`)).rows[0]
 const beforeZero=await counts()
 await assert.rejects(apply('SYNTHETIC FRESH ZERO ROUTES',[{...actor('FRESH-ZERO'),routes:[]}]),/zero_routes_source_held/)
 assert.deepEqual(await counts(),beforeZero);checks++
 await assert.rejects(apply('SYNTHETIC HELD ALL ROUTES',[actor(null)]),/zero_routes_source_held/)
 assert.deepEqual(await counts(),beforeZero);checks++
 await assert.rejects(apply('SYNTHETIC ZERO ROUTES UNAUTHORIZED',[{...actor('ZERO-UNAUTHORIZED'),routes:[]}],uid(99)),/platform_actor_required/)
 await assert.rejects(apply('SYNTHETIC PRIOR ZERO ROUTES',[priorZeroActor],uid(99)),/platform_actor_required/);checks++
 await assert.rejects(apply('SYNTHETIC ZERO ROUTES BAD HASH',[{...actor('ZERO-BAD-HASH'),routes:[]}],uid(1),'a'.repeat(64)),/exact_source_hash/);checks++
 const mixed=await apply('SYNTHETIC MIXED LEGAL SOURCE',[{...actor('MIXED-NO-ROUTE'),routes:[]},actor('MIXED-OWN-ROUTE')])
 assert.equal(mixed.created,2);assert.equal(mixed.routeIds.length,1);assert.equal(mixed.activation,'held_pending_current_source_readiness');checks++
 const priorIncomplete=actor('LEGACY-PARTIAL-ROUTE');delete priorIncomplete.routes[0].interchangePartyId
 const oldIncomplete=await apply('SYNTHETIC PRIOR PARTIAL ROUTE',[priorIncomplete])
 await db.exec(readFileSync(new URL('20261001031233_ediel_registry_declared_route_source_fields.sql',root),'utf8'));checks++
 assert.deepEqual(await apply('SYNTHETIC PRIOR PARTIAL ROUTE',[priorIncomplete]),{...oldIncomplete,reusedExistingRun:true});checks++
 assert.deepEqual(await readPrior('SYNTHETIC PRIOR PARTIAL ROUTE'),{...oldIncomplete,reusedExistingRun:true});checks++
 assert.equal(await readPrior('SYNTHETIC UNKNOWN NEW SOURCE'),null);checks++
 await assert.rejects(readPrior('SYNTHETIC PRIOR PARTIAL ROUTE',uid(99)),/platform_actor_required/);checks++
 await assert.rejects(readPrior('SYNTHETIC CHANGED SOURCE',uid(1),createHash('sha256').update('SYNTHETIC PRIOR PARTIAL ROUTE').digest('hex')),/exact_source_hash/);checks++
 await assert.rejects(readPrior('SYNTHETIC PRIOR PARTIAL ROUTE',uid(1),createHash('sha256').update('SYNTHETIC PRIOR PARTIAL ROUTE').digest('hex'),'csv'),/exact_original_source/);checks++
 await assert.rejects(apply('SYNTHETIC PRIOR PARTIAL ROUTE',[actor('DIFFERENT-NORMALIZED-RECORD')]),/normalization_conflict/);checks++
 assert.equal((await db.query(`SELECT has_function_privilege('authenticated','public.ediel_read_actor_registry_batch_v1(uuid,text,text,text)','EXECUTE') allowed`)).rows[0].allowed,false);checks++
 const beforeMissingFields=await counts()
 for(const field of ['partyId','interchangePartyId','communicationType','communicationAddress']){
  const missing=actor(`MISSING-${field}`);delete missing.routes[0][field]
  await assert.rejects(apply(`SYNTHETIC MISSING ${field}`,[missing]),/declared_transport_source_required/)
  assert.deepEqual(await counts(),beforeMissingFields);checks++
 }
 const noCountry={...actor('MISSING-SOURCE-COUNTRY'),countryCode:null}
 await assert.rejects(apply('SYNTHETIC MISSING SOURCE COUNTRY',[noCountry]),/zero_routes_source_held/)
 assert.deepEqual(await counts(),beforeMissingFields);checks++
 const exactSource=actor('EXACT-DECLARED-TRANSPORT');exactSource.routes[0].applicationReference=null
 const exactResult=await apply('SYNTHETIC EXACT DECLARED TRANSPORT',[exactSource])
 assert.equal(exactResult.routeIds.length,1)
 const exactRoute=(await db.query(`SELECT party_id,interchange_party_id,application_reference,communication_type,is_verified,auto_send_allowed FROM platform_actor_routes WHERE party_id='EXACT-DECLARED-TRANSPORT'`)).rows[0]
 assert.deepEqual(exactRoute,{party_id:'EXACT-DECLARED-TRANSPORT',interchange_party_id:'EXACT-DECLARED-TRANSPORT',application_reference:null,communication_type:'smtp',is_verified:false,auto_send_allowed:false});checks++
 assert.equal((await db.query(`SELECT has_function_privilege('authenticated','public.ediel_apply_actor_registry_v1(uuid,text,text,text,text,jsonb)','EXECUTE') allowed`)).rows[0].allowed,false);checks++
 // External transport/readiness ports are declared explicitly. The actual new
 // importer/private market qualifier/admin verifier/wrappers below execute.
 await db.exec(`CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,company_id uuid,direction text,message_family text,message_code text,route_profile_id uuid,communication_route_id uuid,environment text,application_reference text,receiver_ediel_id text,receiver_sub_address text,receiver_email text,transport_type text,raw_payload text);
 CREATE TABLE public.ediel_route_profiles(id uuid PRIMARY KEY,company_id uuid,communication_route_id uuid,metadata jsonb,environment text,message_family text,transport_type text,receiver_ediel_id text,receiver_subaddress text,receiver_sub_address text,application_reference text);
 CREATE TABLE public.communication_routes(id uuid PRIMARY KEY,company_id uuid,auth_config jsonb,target_email text,route_type text,environment_type text);
 CREATE SCHEMA gridex_ediel_readiness;CREATE FUNCTION gridex_ediel_readiness.capture(uuid,uuid,uuid,text,text,text,text,uuid,text,text) RETURNS jsonb LANGUAGE sql AS 'SELECT jsonb_build_object(''scope'',jsonb_build_object(''companyId'',$1,''messageId'',$2),''dependencies'',''{}''::jsonb,''dependencyHash'',''fixture-old'')';
 CREATE SCHEMA gridex_ediel_transport;CREATE FUNCTION gridex_ediel_transport.mutate_v1(jsonb) RETURNS jsonb LANGUAGE sql AS 'SELECT CASE WHEN $1->>''fixtureDisposition''=''frozen'' THEN jsonb_build_object(''proceed'',false,''receipt'',''declared-existing-private-outcome'') ELSE jsonb_build_object(''proceed'',true,''stage'',''declared-fresh'') END';`)
 const tokenizer=readFileSync(new URL('20260923135706_ediel_utilts_consumption_binding_v1.sql',root),'utf8');await db.exec('CREATE SCHEMA gridex_utilts_binding');await db.exec(tokenizer.slice(tokenizer.indexOf('CREATE FUNCTION gridex_utilts_binding.wire_tokens_v1'),tokenizer.indexOf('-- Private existing insertion/ACK')));
 const publicJournal=readFileSync(new URL('20260930145115_ediel_generic_transport_attempts_v1.sql',root),'utf8');await db.exec(publicJournal.slice(publicJournal.indexOf('create function public.gridex_ediel_transport_attempt_v1'),publicJournal.indexOf('create function gridex_ediel_transport.dsn_candidates_v1')));await db.exec('GRANT USAGE ON SCHEMA gridex_ediel_transport TO service_role');
 await db.exec(readFileSync(new URL('20261001040159_ediel_registry_market_source_isolation.sql',root),'utf8'));checks++
 const readMarket=async routeId=>{await db.exec('SET ROLE service_role');try{return(await db.query(`SELECT public.ediel_registry_route_source_v1('${routeId}') q`)).rows[0].q}finally{await db.exec('RESET ROLE')}};
 const verify=async(aid,rid=null,who=uid(1))=>{await db.exec('SET ROLE service_role');try{return(await db.query(`SELECT public.ediel_verify_registry_el_actor_v1('${who}','${aid}',${rid?`'${rid}'`:'NULL'}) q`)).rows[0].q}finally{await db.exec('RESET ROLE')}};
 const oldPositiveReplay=await apply('SYNTHETIC SOURCE ONE',[actor('21660')]);assert.equal(oldPositiveReplay.reusedExistingRun,true);assert.equal(oldPositiveReplay.importRunId,first.importRunId);checks++
 const oldRouteId=(await db.query(`SELECT id FROM platform_actor_routes WHERE party_id='EXACT-DECLARED-TRANSPORT'`)).rows[0].id;
 assert.equal((await readMarket(oldRouteId)).status,'held');assert.equal((await db.query(`SELECT registry_market FROM platform_actor_routes WHERE id='${oldRouteId}'`)).rows[0].registry_market,null);checks++
 const el=actor('MARKET-SAME');el.roles=['grid_owner'];el.routes[0].communicationAddress='same-el@example.invalid';
 const gas={...actor('MARKET-SAME'),market:'GAS',roles:['grid_owner']};gas.routes[0].communicationAddress='same-gas@example.invalid';
 const sameBatch=await apply('SYNTHETIC SAME ACTOR DISTINCT EL GAS',[el,gas]);assert.equal(sameBatch.created,1);assert.equal(sameBatch.routeIds.length,2);checks++
 const markets=(await db.query(`SELECT id,registry_market,communication_address,status FROM platform_actor_routes WHERE party_id='MARKET-SAME' ORDER BY registry_market`)).rows;
 assert.deepEqual(markets.map(r=>[r.registry_market,r.communication_address]),[['EL','same-el@example.invalid'],['GAS','same-gas@example.invalid']]);assert.equal(markets[1].status,'blocked');checks++
 const elId=markets[0].id,gasId=markets[1].id,aid=(await db.query(`SELECT actor_id FROM platform_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value='MARKET-SAME'`)).rows[0].actor_id;
 assert.deepEqual((await db.query(`SELECT actor_role,is_active,metadata->>'market' market FROM platform_actor_roles WHERE actor_id='${aid}'`)).rows,[{actor_role:'grid_owner',is_active:true,market:'EL'}]);checks++
 assert.equal((await readMarket(elId)).market,'EL');assert.equal((await readMarket(gasId)).market,'GAS');checks++
 assert.equal((await db.query(`SELECT count(*)::int n FROM gridex_registry_import.market_records WHERE actor_id='${aid}'`)).rows[0].n,2);checks++
 await verify(aid);const verifiedRows=(await db.query(`SELECT registry_market,is_verified,auto_send_allowed,status FROM platform_actor_routes WHERE actor_id='${aid}' ORDER BY registry_market`)).rows;
 assert.deepEqual(verifiedRows,[{registry_market:'EL',is_verified:true,auto_send_allowed:false,status:'active'},{registry_market:'GAS',is_verified:false,auto_send_allowed:false,status:'blocked'}]);checks++
 await assert.rejects(verify(aid,gasId),/current_el_route_source_required/);await assert.rejects(verify(aid,elId,uid(99)),/platform_actor_required/);checks++
 await db.exec(`UPDATE platform_actor_routes SET auto_send_allowed=true WHERE id='${elId}'`);
 const laterGas={...gas};laterGas.routes=[{...gas.routes[0],communicationAddress:'new-gas@example.invalid'}];
 await apply('SYNTHETIC GAS SIBLING UPDATE',[laterGas]);const retainedEL=(await db.query(`SELECT status,is_verified,auto_send_allowed FROM platform_actor_routes WHERE id='${elId}'`)).rows[0];assert.deepEqual(retainedEL,{status:'active',is_verified:true,auto_send_allowed:true});assert.equal((await readMarket(elId)).status,'source_qualified');checks++
 assert.equal((await db.query(`SELECT is_active FROM platform_actor_roles WHERE actor_id='${aid}' AND actor_role='grid_owner'`)).rows[0].is_active,true);checks++
 const sameEndpointEL=actor('SAME-ENDPOINT');const sameEndpointGas={...actor('SAME-ENDPOINT'),market:'GAS'};
 const sameEndpoint=await apply('SYNTHETIC SHARED SMTP DISTINCT MARKETS',[sameEndpointEL,sameEndpointGas]);assert.equal(sameEndpoint.routeIds.length,2);checks++
 const otherApp={...el,routes:[{...el.routes[0],applicationReference:'INDEPENDENT-APP'}]};await apply('SYNTHETIC SAME SMTP DISTINCT APPLICATION',[el,{...actor('INDEPENDENT'),routes:[{...actor('INDEPENDENT').routes[0],applicationReference:'INDEPENDENT-APP'}]}]);
 await apply('SYNTHETIC MARKET SAME APPLICATION REVISION',[otherApp]);assert.equal((await db.query(`SELECT count(*)::int n FROM platform_actor_routes WHERE party_id='MARKET-SAME' AND registry_market='EL' AND communication_address='same-el@example.invalid'`)).rows[0].n,2);checks++
 await assert.rejects(apply('SYNTHETIC REPEATED SAME MARKET',[actor('DUP-MARKET'),actor('DUP-MARKET')]),/duplicate_source_legal_identity/);checks++
 const conflictEL=actor('LEGAL-CONFLICT'),conflictGAS={...actor('LEGAL-CONFLICT','Same legal','WRONG-ORG'),market:'GAS'};const beforeConflict=await counts();await assert.rejects(apply('SYNTHETIC CONFLICTING SAME LEGAL MARKET',[conflictEL,conflictGAS]),/source_legal_org_conflict/);assert.deepEqual(await counts(),beforeConflict);checks++
 const wrongRoute={...actor('BAD-ROUTE-MARKET'),routes:[{...actor('BAD-ROUTE-MARKET').routes[0],market:'GAS'}]};await assert.rejects(apply('SYNTHETIC MIXED DECLARED ROUTE MARKET',[wrongRoute]),/route_market_source_conflict/);assert.deepEqual(await counts(),beforeConflict);checks++
 // Public JSON cannot mint/copy a private market source for an old route.
 await db.exec(`UPDATE platform_actor_routes SET registry_market='EL',metadata=metadata||'{"market":"EL"}'::jsonb WHERE id='${oldRouteId}'`);assert.equal((await readMarket(oldRouteId)).status,'held');checks++
 const currentEL=(await db.query(`SELECT id FROM platform_actor_routes WHERE party_id='MARKET-SAME' AND registry_market='EL' AND application_reference='INDEPENDENT-APP'`)).rows[0].id;
 await db.exec(`UPDATE platform_actor_routes SET communication_address='tampered@example.invalid' WHERE id='${currentEL}'`);assert.equal((await readMarket(currentEL)).status,'held');await db.exec(`UPDATE platform_actor_routes SET communication_address='same-el@example.invalid' WHERE id='${currentEL}'`);assert.equal((await readMarket(currentEL)).status,'source_qualified');checks++
 const mid=uid(400),company=uid(401),profile=uid(402),communication=uid(403);
 const exactWire="UNB+UNOC:3+SENDER:ZZ+MARKET-SAME:ZZ+261001:0410+UNB1+PASSWORD+INDEPENDENT-APP'UNH+M1+PRODAT:D:96A:UN:EDIEL2'BGM+Z01+OWN1+9'NAD+FR+SENDER:160:SVK'NAD+DO+MARKET-SAME:160:SVK'LIN+1++POINT:ZZZ'UNT+6+M1'UNZ+1+UNB1'";
 await db.exec(`INSERT INTO communication_routes VALUES('${communication}','${company}',jsonb_build_object('platform_actor_route_id','${currentEL}','materialized_from','platform_actor_routes'),'same-el@example.invalid','ediel_partner','production');INSERT INTO ediel_route_profiles VALUES('${profile}','${company}','${communication}',jsonb_build_object('platform_actor_route_id','${currentEL}','materialized_from','platform_actor_routes'),'production','PRODAT','smtp','MARKET-SAME',NULL,NULL,'INDEPENDENT-APP');INSERT INTO ediel_messages VALUES('${mid}','${company}','outbound','PRODAT','Z01','${profile}','${communication}','production','INDEPENDENT-APP','MARKET-SAME',NULL,'same-el@example.invalid','smtp',${sqlText(exactWire)})`);
 const mutate=async(action='prepare',extra={})=>(await db.query(`SELECT gridex_ediel_transport.mutate_v1(${sqlText(JSON.stringify({action,companyId:company,messageId:mid,...extra}))}::jsonb) result`)).rows[0].result;
 assert.equal((await mutate()).proceed,true);checks++
 // The real SECURITY INVOKER public RPC must reach the NEW guarded private
 // owner under service_role; checking a superuser private call is insufficient.
 await db.exec('SET ROLE service_role');try{assert.equal((await db.query(`SELECT public.gridex_ediel_transport_attempt_v1(${sqlText(JSON.stringify({action:'prepare',companyId:company,messageId:mid}))}::jsonb) q`)).rows[0].q.proceed,true);checks++}finally{await db.exec('RESET ROLE')}
 const altered=async(sql,pattern,restore)=>{await db.exec(sql);await assert.rejects(mutate(),pattern);await db.exec(restore);checks++};
 await altered(`UPDATE communication_routes SET target_email='gas-laundered@example.invalid' WHERE id='${communication}'`,/dispatch_source_mismatch/,`UPDATE communication_routes SET target_email='same-el@example.invalid' WHERE id='${communication}'`);
 await altered(`UPDATE ediel_route_profiles SET receiver_ediel_id='OTHER-TRANSPORT' WHERE id='${profile}'`,/dispatch_source_mismatch/,`UPDATE ediel_route_profiles SET receiver_ediel_id='MARKET-SAME' WHERE id='${profile}'`);
 await altered(`UPDATE ediel_route_profiles SET environment='test' WHERE id='${profile}'`,/dispatch_source_mismatch/,`UPDATE ediel_route_profiles SET environment='production' WHERE id='${profile}'`);
 await altered(`UPDATE ediel_route_profiles SET message_family='UTILTS' WHERE id='${profile}'`,/dispatch_source_mismatch/,`UPDATE ediel_route_profiles SET message_family='PRODAT' WHERE id='${profile}'`);
 await altered(`UPDATE ediel_route_profiles SET application_reference='WRONG-APP' WHERE id='${profile}'`,/dispatch_source_mismatch/,`UPDATE ediel_route_profiles SET application_reference='INDEPENDENT-APP' WHERE id='${profile}'`);
 await altered(`UPDATE ediel_route_profiles SET receiver_subaddress='WRONG-SUB' WHERE id='${profile}'`,/dispatch_source_mismatch/,`UPDATE ediel_route_profiles SET receiver_subaddress=NULL WHERE id='${profile}'`);
 await altered(`UPDATE ediel_messages SET receiver_email='WRONG-TARGET' WHERE id='${mid}'`,/message_dispatch_source_mismatch/,`UPDATE ediel_messages SET receiver_email='same-el@example.invalid' WHERE id='${mid}'`);
 for(const [fragment,replacement,pattern] of [['MARKET-SAME:ZZ','WRONG-TRANSPORT:ZZ',/wire_source_mismatch/],['INDEPENDENT-APP','WRONG-APP',/wire_source_mismatch/],['NAD+DO+MARKET-SAME','NAD+DO+WRONG-LEGAL',/legal_receiver_source_mismatch/]]){await altered(`UPDATE ediel_messages SET raw_payload=${sqlText(exactWire.replace(fragment,replacement))} WHERE id='${mid}'`,pattern,`UPDATE ediel_messages SET raw_payload=${sqlText(exactWire)} WHERE id='${mid}'`)}
 await altered(`UPDATE ediel_route_profiles SET company_id='${uid(999)}' WHERE id='${profile}'`,/owned_route_profile_required/,`UPDATE ediel_route_profiles SET company_id='${company}' WHERE id='${profile}'`);
 // A fresh GAS sibling must never deactivate a pre-existing operational role
 // whose historical metadata has no source market; no market is backfilled.
 await db.exec(`UPDATE platform_actor_roles SET metadata='{}'::jsonb,is_active=true WHERE actor_id='${aid}' AND actor_role='grid_owner'`);
 await apply('SYNTHETIC GAS AFTER LEGACY MANUAL ROLE',[{...laterGas,routes:[{...laterGas.routes[0],communicationAddress:'another-gas@example.invalid'}]}]);assert.deepEqual((await db.query(`SELECT is_active,metadata FROM platform_actor_roles WHERE actor_id='${aid}' AND actor_role='grid_owner'`)).rows[0],{is_active:true,metadata:{}});checks++;

 const captured=(await db.query(`SELECT gridex_ediel_readiness.capture('${company}','${mid}',NULL,NULL,'PRODAT','Z01',NULL,NULL,NULL,NULL) result`)).rows[0].result;assert.equal(captured.dependencies.sourceQualifiedRegistryMarket.market,'EL');assert.notEqual(captured.dependencyHash,'fixture-old');checks++
 await db.exec(`UPDATE communication_routes SET auth_config=jsonb_build_object('platform_actor_route_id','${gasId}') WHERE id='${communication}';UPDATE ediel_route_profiles SET metadata=jsonb_build_object('platform_actor_route_id','${gasId}') WHERE id='${profile}'`);
 await assert.rejects(mutate('enter'),/current_el_route_source_required/);checks++
 const frozen=await mutate('enter',{fixtureDisposition:'frozen'});assert.deepEqual(frozen,{proceed:false,receipt:'declared-existing-private-outcome'});checks++
 assert.equal((await mutate('observe')).proceed,true);checks++
 await db.exec(`UPDATE ediel_messages SET message_family='CONTRL',message_code='CONTRL' WHERE id='${mid}'`);assert.equal((await mutate()).proceed,true);checks++
 await db.exec(`UPDATE ediel_messages SET message_family='PRODAT',message_code='Z01' WHERE id='${mid}';UPDATE communication_routes SET auth_config=jsonb_build_object('platform_actor_route_id','${currentEL}') WHERE id='${communication}'`);await assert.rejects(mutate(),/route_mapping_conflict/);checks++
 // Actual legal receiver may differ from the actual transport endpoint.
 const independent=actor('U-LEGAL');independent.routes[0].messageFamily='UTILTS';independent.routes[0].interchangePartyId='U-TRANSPORT';independent.routes[0].applicationReference='U-SOURCE-APP';
 const independentResult=await apply('SYNTHETIC DISTINCT LEGAL TRANSPORT U',[independent]);const uRoute=independentResult.routeIds[0];assert.equal((await readMarket(uRoute)).legalEdielId,'U-LEGAL');checks++;
 const uWire="UNB+UNOC:3+SENDER:ZZ+U-TRANSPORT:ZZ+261001:0410+U1+PASSWORD+U-SOURCE-APP'UNH+U1+UTILTS:D:99B:UN:EDIEL2'BGM+E66+OWN1+9'NAD+MS+SENDER:160:SVK'NAD+MR+U-LEGAL:160:SVK'IDE+24+OWN-IDE'UNT+6+U1'UNZ+1+U1'";
 await db.exec(`UPDATE communication_routes SET auth_config=jsonb_build_object('platform_actor_route_id','${uRoute}'),target_email='synthetic@example.invalid' WHERE id='${communication}';UPDATE ediel_route_profiles SET metadata=jsonb_build_object('platform_actor_route_id','${uRoute}'),message_family='UTILTS',receiver_ediel_id='U-TRANSPORT',application_reference='U-SOURCE-APP' WHERE id='${profile}';UPDATE ediel_messages SET message_family='UTILTS',message_code='E66',application_reference='U-SOURCE-APP',receiver_ediel_id='U-TRANSPORT',receiver_email='synthetic@example.invalid',raw_payload=${sqlText(uWire)} WHERE id='${mid}'`);assert.equal((await mutate()).proceed,true);checks++;
 await altered(`UPDATE ediel_messages SET raw_payload=${sqlText(uWire.replace('NAD+MR+U-LEGAL','NAD+MR+U-TRANSPORT'))} WHERE id='${mid}'`,/legal_receiver_source_mismatch/,`UPDATE ediel_messages SET raw_payload=${sqlText(uWire)} WHERE id='${mid}'`);
 await altered(`UPDATE ediel_messages SET raw_payload=${sqlText(uWire.replace("NAD+MR+U-LEGAL:160:SVK'IDE+24+OWN-IDE'","IDE+24+OWN-IDE'NAD+MR+U-LEGAL:160:SVK'"))} WHERE id='${mid}'`,/legal_receiver_required/,`UPDATE ediel_messages SET raw_payload=${sqlText(uWire)} WHERE id='${mid}'`);
 for(const table of ['normalized_batches','market_records','route_market_sources']){await assert.rejects(db.exec(`DELETE FROM gridex_registry_import.${table}`),/batch_immutable/);checks++}
 assert.equal((await db.query(`SELECT has_table_privilege('service_role','gridex_registry_import.market_current','UPDATE') ok`)).rows[0].ok,false);checks++
 assert.equal((await db.query(`SELECT has_function_privilege('authenticated','public.ediel_registry_route_source_v1(uuid)','EXECUTE') ok`)).rows[0].ok,false);checks++
 if(process.env.EDIEL_REGISTRY_PROBE_MODULE){const{default:probe}=await import(pathToFileURL(process.env.EDIEL_REGISTRY_PROBE_MODULE).href);await probe({db,uid,sqlText,apply,actor,company,profile,communication,mid,mutate})}
 console.log(`PASS ${checks} targeted market-source PostgreSQL checks; declared external registry/readiness/transport authorization ports, not native/authentic evidence`)

}finally{await db.close()}
