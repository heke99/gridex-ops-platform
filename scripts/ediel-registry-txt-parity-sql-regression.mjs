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
 async function apply(bytes,records,actor=uid(1),hash=createHash('sha256').update(bytes).digest('hex'),kind='companies_xml'){await db.exec('SET ROLE service_role');try{return(await db.query(`SELECT ediel_apply_actor_registry_v1('${actor}',${sqlText(Buffer.from(bytes).toString('base64'))},'${hash}',${sqlText(kind)},'synthetic-registry',${sqlText(JSON.stringify(records))}::jsonb) result`)).rows[0].result}finally{await db.exec('RESET ROLE')}}
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
 await db.exec(`ALTER TABLE gridex_registry_import.batches DROP CONSTRAINT batches_source_kind_check;ALTER TABLE gridex_registry_import.batches ADD CONSTRAINT batches_source_kind_check CHECK(source_kind IN('companies_xml','companies_txt','csv'))`)
 await db.exec(readFileSync(new URL('20261001031233_ediel_registry_declared_route_source_fields.sql',root),'utf8'))
 const bytes='SYNTHETIC predeclared UTF8 TXT source',records=[actor('21660')],hash=createHash('sha256').update(bytes).digest('hex')
 await assert.rejects(readPrior(bytes,uid(1),hash,'companies_txt'),/source_shape_required/);checks++
 await assert.rejects(apply(bytes,records,uid(1),hash,'companies_txt'),/source_shape_required/);checks++
 const before=(await db.query(`SELECT oid,proowner,proacl,proconfig FROM pg_proc WHERE oid IN('public.ediel_apply_actor_registry_v1(uuid,text,text,text,text,jsonb)'::regprocedure,'public.ediel_read_actor_registry_batch_v1(uuid,text,text,text)'::regprocedure) ORDER BY oid`)).rows
 await db.exec(readFileSync(new URL('20261001040446_ediel_current_registry_txt_source_parity.sql',root),'utf8'))
 const after=(await db.query(`SELECT oid,proowner,proacl,proconfig FROM pg_proc WHERE oid IN('public.ediel_apply_actor_registry_v1(uuid,text,text,text,text,jsonb)'::regprocedure,'public.ediel_read_actor_registry_batch_v1(uuid,text,text,text)'::regprocedure) ORDER BY oid`)).rows
 assert.deepEqual(after,before);checks++
 assert.equal(await readPrior(bytes,uid(1),hash,'companies_txt'),null);checks++
 const result=await apply(bytes,records,uid(1),hash,'companies_txt');assert.equal(result.created,1);assert.equal(result.routeIds.length,1);assert.equal(result.activation,'held_pending_current_source_readiness');checks++
 assert.deepEqual(await readPrior(bytes,uid(1),hash,'companies_txt'),{...result,reusedExistingRun:true});checks++
 assert.deepEqual(await apply(bytes,records,uid(1),hash,'companies_txt'),{...result,reusedExistingRun:true});checks++
 for(const kind of ['companies_xml','csv']){const text=`SYNTHETIC parity ${kind}`,digest=createHash('sha256').update(text).digest('hex');const applied=await apply(text,[actor(kind==='csv'?'33333':'22222')],uid(1),digest,kind);assert.equal(applied.routeIds.length,1);assert.deepEqual(await readPrior(text,uid(1),digest,kind),{...applied,reusedExistingRun:true});checks++}
 for(const field of ['partyId','interchangePartyId','communicationType','communicationAddress']){const missing=actor(`MISSING-${field}`);delete missing.routes[0][field];missing.raw={...missing.raw,declaredSourceQualified:true};await assert.rejects(apply(`SYNTHETIC invalid ${field}`,[missing],uid(1),createHash('sha256').update(`SYNTHETIC invalid ${field}`).digest('hex'),'companies_txt'),/declared_transport_source_required/);checks++}
 const noRoute={...actor('ZERO'),routes:[],raw:{sourceRouteReady:true}};await assert.rejects(apply('ZERO TXT',[noRoute],uid(1),createHash('sha256').update('ZERO TXT').digest('hex'),'companies_txt'),/zero_routes_source_held/);checks++
 await assert.rejects(readPrior(bytes,uid(99),hash,'companies_txt'),/platform_actor_required/);checks++
 await assert.rejects(readPrior(bytes,uid(1),'a'.repeat(64),'companies_txt'),/exact_source_hash_required/);checks++
 await assert.rejects(readPrior(bytes,uid(1),hash,'csv'),/exact_original_source_required/);checks++
 await assert.rejects(apply('UNKNOWN TXT',[actor('44444')],uid(1),createHash('sha256').update('UNKNOWN TXT').digest('hex'),'caller_custom_kind'),/source_shape_required/);checks++
 assert.ok((await db.query(`SELECT status,is_verified,auto_send_allowed FROM platform_actor_routes`)).rows.every(r=>r.status==='needs_review'&&!r.is_verified&&!r.auto_send_allowed));checks++
 const changedCountry={...actor('21660'),countryCode:'FI'};const changedText='SYNTHETIC independent declared FI country',changedHash=createHash('sha256').update(changedText).digest('hex')
 const countryResult=await apply(changedText,[changedCountry],uid(1),changedHash,'companies_txt');assert.equal(countryResult.updated,1)
 assert.equal((await db.query(`SELECT country_code FROM platform_market_actors WHERE id=(SELECT actor_id FROM platform_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value='21660')`)).rows[0].country_code,'FI');checks++
 for(const [name,record] of [['NULL',{...actor('21660'),countryCode:null}],['unknown-source-country',{...actor('21660'),countryCode:null,raw:{unknownCountry:'SE',sourceQualified:true}}],['postal-country-metadata-only',{...actor('21660'),countryCode:null,raw:{postalCountry:'SE',registryDiagnostics:[{code:'actor_registry_source_country_required'}]}}]]){
  const text=`SYNTHETIC held ${name}`,digest=createHash('sha256').update(text).digest('hex')
  await assert.rejects(apply(text,[record],uid(1),digest,'companies_txt'),/zero_routes_source_held/)
  assert.equal((await db.query(`SELECT country_code FROM platform_market_actors WHERE id=(SELECT actor_id FROM platform_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value='21660')`)).rows[0].country_code,'FI');checks++
 }
 console.log(`PASS ${checks} targeted current-registry TXT parity checks; actual PostgreSQL functions and OID/owner/ACL invariants, synthetic source/admin fixture; NOT native legal/readiness approval`)
}finally{await db.close()}
