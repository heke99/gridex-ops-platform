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
const actor=(ediel,name='Synthetic actor',org='SYNTHETIC-ORG')=>({name,legalName:name,orgNumber:org,edielId:ediel,eic:null,svkId:null,market:'EL',countryCode:'SE',roles:['energy_service_company'],routes:[{messageFamily:'PRODAT',environment:'production',communicationType:'smtp',communicationAddress:'synthetic@example.invalid',partyId:ediel,interchangePartyId:ediel,applicationReference:'SYNTHETIC-APP'}],certificates:[],raw:{fixture:true}})
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid primary key);CREATE TABLE user_profiles(id uuid,user_status text);CREATE TABLE admin_users(user_id uuid);CREATE TABLE user_roles(id uuid,user_id uuid);CREATE FUNCTION canonical_actor_is_platform_admin(uuid) RETURNS bool LANGUAGE sql AS 'SELECT $1=''${uid(1)}''::uuid';INSERT INTO auth.users VALUES('${uid(1)}');INSERT INTO user_profiles VALUES('${uid(1)}','active');INSERT INTO admin_users VALUES('${uid(1)}');`)
 const root=new URL('../supabase/migrations/',import.meta.url)
 const base=readFileSync(new URL('20260611123000_actor_registry_message_semantics_tenant_automation.sql',root),'utf8');await db.exec(base.slice(base.indexOf('create table if not exists public.platform_market_actors'),base.indexOf('-- 2) Message semantics')))
 const staging=readFileSync(new URL('20260615130000_batch_o3_o6_actor_registry_certificate_hardening.sql',root),'utf8');await db.exec(staging.slice(staging.indexOf('create table if not exists public.actor_registry_import_runs'),staging.indexOf('-- Complete existing certificate cache')))
 const cert=readFileSync(new URL('20260613100000_actor_auto_readiness_certificates.sql',root),'utf8');await db.exec(cert.slice(cert.indexOf('create table if not exists public.platform_actor_certificates'),cert.indexOf('create unique index')));await db.exec(`CREATE UNIQUE INDEX fixture_cert_key ON platform_actor_certificates(actor_id,environment,purpose,fingerprint_sha256) WHERE fingerprint_sha256 IS NOT NULL`)
 await db.exec(readFileSync(new URL('20260930153118_ediel_actor_legal_identity_name_search_v1.sql',root),'utf8'))
 await db.exec(readFileSync(new URL('20260930172759_ediel_atomic_registry_import_v1.sql',root),'utf8'));checks++
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
 const held=await apply('SYNTHETIC MISSING ID',[actor(null)]);assert.equal(held.conflicts,1);assert.equal(held.created,0);checks++
 await db.exec(`INSERT INTO actor_registry_import_runs(source,source_hash,status) VALUES('legacy',encode(sha256(convert_to('LEGACY SOURCE','UTF8')),'hex'),'running')`)
 await assert.rejects(apply('LEGACY SOURCE',[actor('LEGACY')]),/legacy_run_requires_reconciliation/);checks++
 await assert.rejects(db.exec(`DELETE FROM gridex_registry_import.batches`),/batch_immutable/);checks++
 assert.equal((await db.query(`SELECT has_function_privilege('authenticated','public.ediel_apply_actor_registry_v1(uuid,text,text,text,text,jsonb)','EXECUTE') allowed`)).rows[0].allowed,false);checks++
 console.log(`PASS ${checks} targeted atomic registry PostgreSQL checks; synthetic source/authorization fixture, not native/issuer evidence`)
}finally{await db.close()}
