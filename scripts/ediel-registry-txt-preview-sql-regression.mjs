// Bounded PostgreSQL mechanics with an explicit synthetic platform actor. This
// is not full Supabase, real import authorization or certificate/readiness proof.
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite(),uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,literal=s=>"'"+s.replaceAll("'","''")+"'"
const migrations=new URL('../supabase/migrations/',import.meta.url),source=name=>readFileSync(new URL(name,migrations),'utf8')
let count=0
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid primary key);CREATE TABLE user_profiles(id uuid,user_status text);CREATE TABLE admin_users(user_id uuid);CREATE TABLE user_roles(id uuid,user_id uuid);CREATE FUNCTION canonical_actor_is_platform_admin(uuid) RETURNS bool LANGUAGE sql AS 'SELECT $1=''${uid(1)}''::uuid';INSERT INTO auth.users VALUES('${uid(1)}');INSERT INTO user_profiles VALUES('${uid(1)}','active');INSERT INTO admin_users VALUES('${uid(1)}');CREATE SCHEMA gridex_received_sources;CREATE FUNCTION gridex_received_sources.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'immutable';END$$;`)
 const base=source('20260611123000_actor_registry_message_semantics_tenant_automation.sql');await db.exec(base.slice(base.indexOf('create table if not exists public.platform_market_actors'),base.indexOf('-- 2) Message semantics')))
 const staging=source('20260615130000_batch_o3_o6_actor_registry_certificate_hardening.sql');await db.exec(staging.slice(staging.indexOf('create table if not exists public.actor_registry_import_runs'),staging.indexOf('-- Complete existing certificate cache')))
 const cert=source('20260613100000_actor_auto_readiness_certificates.sql');await db.exec(cert.slice(cert.indexOf('create table if not exists public.platform_actor_certificates'),cert.indexOf('create unique index')));await db.exec('CREATE UNIQUE INDEX fixture_cert_key ON platform_actor_certificates(actor_id,environment,purpose,fingerprint_sha256) WHERE fingerprint_sha256 IS NOT NULL')
 await db.exec(source('20260930153118_ediel_actor_legal_identity_name_search_v1.sql'));await db.exec(source('20260930172759_ediel_atomic_registry_import_v1.sql'))
 const guards=source('20260930182758_ediel_current_service_origin_and_registry_conflict_guards.sql');await db.exec(guards.slice(guards.indexOf('CREATE OR REPLACE FUNCTION public.ediel_apply_actor_registry_v1'),guards.indexOf('-- Atomic projection')))
 await db.exec(source('20261001000600_ediel_registry_txt_preview_and_route_history.sql'));count++
 const actor={name:'Synthetic TXT actor',market:'EL',countryCode:'DK',edielId:'12345',roles:[],routes:[{messageFamily:'PRODAT',environment:'production',applicationReference:'PRODAT',communicationAddress:'old@example.invalid',subaddress:null,communicationType:'smtp',partyId:'12345',interchangePartyId:'54321'}],certificates:[],raw:{sourceKind:'companies_txt'}}
 async function apply(bytes,record=actor){const hash=createHash('sha256').update(bytes).digest('hex');await db.exec('SET ROLE service_role');try{return(await db.query(`SELECT public.ediel_apply_actor_registry_v1('${uid(1)}',${literal(Buffer.from(bytes).toString('base64'))},'${hash}','companies_txt','synthetic.txt',${literal(JSON.stringify([record]))}::jsonb) result`)).rows[0].result}finally{await db.exec('RESET ROLE')}}
 const first=await apply('Synthetic distinct TXT bytes');assert.equal(first.created,1);assert.equal((await db.query('SELECT source_kind FROM gridex_registry_import.batches')).rows[0].source_kind,'companies_txt');count++
 const replay=await apply('Synthetic distinct TXT bytes');assert.equal(replay.reusedExistingRun,true);count++
 const preview=async()=>(await db.query(`SELECT public.ediel_read_registry_preview_snapshot_v1('${uid(1)}',ARRAY['12345']) p`)).rows[0].p
 const p=await preview();assert.equal(p.actors[0].countryCode,'DK');assert.equal(p.actors[0].routes[0].interchangePartyId,'54321');assert.equal(p.snapshotHash,(await preview()).snapshotHash);count++
 await apply('Synthetic later TXT bytes with same values');assert.equal((await preview()).snapshotHash,p.snapshotHash);count++
 await apply('Synthetic SMTP change',{...actor,routes:[{...actor.routes[0],communicationAddress:'new@example.invalid'}]});const after=await preview();assert.notEqual(after.snapshotHash,p.snapshotHash);assert.ok(after.actors[0].routes.some(r=>r.communicationAddress==='new@example.invalid'));count++
 await apply('Synthetic country correction',{...actor,countryCode:'SE'});assert.equal((await preview()).actors[0].countryCode,'SE');count++
 await db.exec("UPDATE platform_actor_routes SET edi_charset='UNOC' WHERE communication_address='new@example.invalid'")
 const history=(await db.query('SELECT snapshot,snapshot_hash FROM gridex_registry_import.route_versions ORDER BY observed_at DESC LIMIT 1')).rows[0];assert.equal(history.snapshot.communication_address,'new@example.invalid');assert.equal(history.snapshot.edi_charset,null);count++
 await db.exec("DELETE FROM public.platform_actor_routes WHERE communication_address='new@example.invalid'");assert.ok((await db.query('SELECT count(*)::int n FROM gridex_registry_import.route_versions')).rows[0].n>=2);count++
 await assert.rejects(()=>db.exec('DELETE FROM gridex_registry_import.route_versions'),/immutable/);count++
 await assert.rejects(()=>db.query(`SELECT public.ediel_read_registry_preview_snapshot_v1('${uid(9)}',ARRAY['12345'])`),/platform_actor_required/);count++
 await db.exec('SET ROLE authenticated');try{await assert.rejects(()=>db.query(`SELECT public.ediel_read_registry_preview_snapshot_v1('${uid(1)}',ARRAY['12345'])`),/permission denied/);count++}finally{await db.exec('RESET ROLE')}
 console.log(`PASS ${count} bounded TXT-kind/preview-snapshot/historical-route/ACL PostgreSQL checks; synthetic platform actor, NOT native/certification`)
}finally{await db.close()}
