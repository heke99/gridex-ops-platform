// Embedded read-only projection fixtures. No rule selection/provider I/O or
// legal acceptance is fabricated; native immutable journal provenance is later.
import{readFileSync}from'node:fs';import{pathToFileURL}from'node:url';import assert from'node:assert/strict';import{createHash}from'node:crypto';import{resolve}from'node:path'
const migration=n=>readFileSync(resolve(process.env.EDIEL_SQL_REPOSITORY||new URL('..',import.meta.url).pathname,'supabase/migrations',n),'utf8')
if(!process.env.EDIEL_PGLITE_MODULE)throw Error('EDIEL_PGLITE_MODULE required')
const{PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite(),uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const raw='SYNTHETIC immutable fixture, not real Ediel',hash=createHash('sha256').update(raw).digest('hex'),json=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb"
const plan={version:1,sourceCode:'Z13',expectedFamily:'PRODAT',anchor:'actual_accepted_smtp_observed_at',policy:{referenceDate:'2026-09-30',guideRevision:'SYNTHETIC-FROZEN'}}
const binding={originalHash:hash,to:'recipient@example.invalid',businessExpectationPlan:plan},provider={accepted:['recipient@example.invalid'],rejected:[],messageId:'FROZEN-PROVIDER-ID',response:'SYNTHETIC 250'}
let checks=0
async function read(company=uid(1),actor=uid(2),message=uid(3)){await db.exec('SET ROLE service_role');try{return(await db.query(`SELECT public.gridex_ediel_accepted_transport_projection_v1('${company}','test','${actor}','${message}') result`)).rows[0].result}finally{await db.exec('RESET ROLE')}}
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE TABLE user_profiles(id uuid,user_status text);CREATE TABLE company_memberships(id uuid,company_id uuid,user_id uuid,status text,is_active bool,accepted_at timestamptz);CREATE TABLE fixture_permissions(permission text);INSERT INTO fixture_permissions VALUES('communication.send');CREATE FUNCTION gridex_actor_has_company_permission(uuid,uuid,text) RETURNS bool LANGUAGE sql AS 'SELECT CASE WHEN EXISTS(SELECT FROM public.fixture_permissions WHERE permission=$3) THEN true ELSE null END';CREATE TABLE ediel_messages(id uuid,company_id uuid,environment text,direction text,raw_payload text,immutable_payload_hash text,immutable_rendered_at timestamptz,message_code text,status text,processing_status text,message_sent_at timestamptz,updated_by uuid,updated_at timestamptz);
 CREATE SCHEMA gridex_ediel_transport;CREATE TABLE gridex_ediel_transport.attempts(id uuid,message_id uuid,company_id uuid,environment text,binding jsonb,provider_result jsonb,classification text,entered_at timestamptz,observed_at timestamptz);
 CREATE SCHEMA gridex_outbound_dispatch;CREATE TABLE gridex_outbound_dispatch.attempts(id uuid,message_id uuid,company_id uuid,environment text,binding jsonb);CREATE TABLE gridex_outbound_dispatch.originals(message_id uuid,company_id uuid,environment text,payload_hash text,raw_payload text);CREATE TABLE gridex_outbound_dispatch.events(id uuid,attempt_id uuid,message_id uuid,company_id uuid,environment text,kind text,facts jsonb,observed_at timestamptz);
 INSERT INTO user_profiles VALUES('${uid(2)}','active');INSERT INTO company_memberships VALUES('${uid(10)}','${uid(1)}','${uid(2)}','active',true,now());INSERT INTO ediel_messages(id,company_id,environment,direction,raw_payload,immutable_payload_hash,immutable_rendered_at,message_code) VALUES('${uid(3)}','${uid(1)}','test','outbound','${raw}','${hash}',now(),'Z13');`)
 await db.exec(migration('20260930180445_ediel_accepted_transport_projection_v1.sql'));checks++
 await db.exec(migration('20260930204937_ediel_shared_accepted_source_basis.sql'));checks++
 const forward=migration('20260930182758_ediel_current_service_origin_and_registry_conflict_guards.sql');await db.exec(forward.slice(forward.indexOf('-- Atomic projection'),forward.lastIndexOf('COMMIT;')));
 await db.exec(`CREATE SCHEMA gridex_brp_changes;CREATE TABLE gridex_brp_changes.origins(company_id uuid,message_id uuid,event_id uuid,actor_user_id uuid,basis jsonb,intent_id uuid);CREATE SCHEMA gridex_service_permission;CREATE TABLE gridex_service_permission.origins(company_id uuid,message_id uuid,basis jsonb,actor_user_id uuid,intent_id uuid);CREATE FUNCTION public.ediel_require_service_permission_origin_current_v1(uuid,uuid) RETURNS void LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'fixture_current_source_required';END$$;`)
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930220932_ediel_source_read_send_permission_contract.sql',import.meta.url),'utf8'));checks++
 assert.equal(await read(),null);checks++
 await db.exec(`INSERT INTO gridex_ediel_transport.attempts VALUES('${uid(4)}','${uid(3)}','${uid(1)}','test',${json(binding)},${json(provider)},'accepted','2026-09-30 12:00+00','2026-09-30 12:01+00')`)
 const frozen=await read();assert.equal(frozen.status,'accepted_projection');assert.equal(frozen.observedAt,'2026-09-30T12:01:00+00:00');assert.deepEqual(frozen.businessExpectationPlan,plan);assert.equal(frozen.authorizesProviderEntry,false);checks++
 await db.exec("UPDATE user_profiles SET user_status='inactive'");
 assert.deepEqual((await db.query('SELECT gridex_ediel_transport.accepted_source_basis_v1(m) result FROM ediel_messages m')).rows[0].result,frozen);checks++
 await assert.rejects(read(),/actor_forbidden/);checks++
 await db.exec("UPDATE user_profiles SET user_status='active'");
 assert.equal((await db.query("SELECT has_function_privilege('service_role','gridex_ediel_transport.accepted_source_basis_v1(public.ediel_messages)','EXECUTE') allowed")).rows[0].allowed,false);checks++
 const repair=()=>db.query(`SELECT gridex_ediel_repair_accepted_transport_projection_v1('${uid(1)}','test','${uid(2)}','${uid(3)}') result`)
 await db.exec(`UPDATE ediel_messages SET status='dispatching',processing_status='dispatching'`);assert.equal((await repair()).rows[0].result.projectionStatus,'sent');checks++
 await db.exec(`UPDATE ediel_messages SET status='acknowledged',processing_status='acknowledged'`);assert.equal((await repair()).rows[0].result.projectionStatus,'acknowledged');assert.equal((await db.query('SELECT processing_status,message_sent_at FROM ediel_messages')).rows[0].processing_status,'acknowledged');checks++
 await db.exec(`UPDATE ediel_messages SET status='failed',processing_status='failed'`);assert.equal((await repair()).rows[0].result.projectionStatus,'failed');checks++
 // No current route/profile/permission table is needed to reselect old facts.
 assert.deepEqual((await read()).providerReceipt,frozen.providerReceipt);checks++
 await assert.rejects(read(uid(99)),/actor_forbidden/);checks++
 await assert.rejects(read(uid(1),uid(99)),/actor_forbidden/);checks++
 await db.exec(`UPDATE company_memberships SET is_active=false`);await assert.rejects(read(),/actor_forbidden/);await db.exec(`UPDATE company_memberships SET is_active=true`);checks++
 await db.exec(`UPDATE ediel_messages SET raw_payload='CHANGED'`);await assert.rejects(read(),/original_changed/);await db.exec(`UPDATE ediel_messages SET raw_payload='${raw}'`);checks++
 await db.exec(`UPDATE gridex_ediel_transport.attempts SET provider_result=${json({...provider,accepted:['other@example.invalid']})}`);await assert.rejects(read(),/expected_recipient/);await db.exec(`UPDATE gridex_ediel_transport.attempts SET provider_result=${json(provider)}`);checks++
 await db.exec(`INSERT INTO gridex_ediel_transport.attempts SELECT '${uid(5)}',message_id,company_id,environment,binding,provider_result,classification,entered_at,observed_at FROM gridex_ediel_transport.attempts`);await assert.rejects(read(),/ambiguous/);await db.exec(`DELETE FROM gridex_ediel_transport.attempts WHERE id='${uid(5)}'`);checks++
 await db.exec(`UPDATE gridex_ediel_transport.attempts SET classification='unknown'`);assert.equal(await read(),null);checks++
 await db.exec(`INSERT INTO gridex_outbound_dispatch.originals VALUES('${uid(3)}','${uid(1)}','test','${hash}','${raw}');INSERT INTO gridex_outbound_dispatch.attempts VALUES('${uid(6)}','${uid(3)}','${uid(1)}','test',${json(binding)});INSERT INTO gridex_outbound_dispatch.events VALUES('${uid(7)}','${uid(6)}','${uid(3)}','${uid(1)}','test','provider_call_entered','{}','2026-09-30 12:00+00'),('${uid(8)}','${uid(6)}','${uid(3)}','${uid(1)}','test','provider_result',${json({classification:'accepted',provider})},'2026-09-30 12:02+00')`)
 assert.equal((await read()).lane,'sealed_z08');checks++
 assert.equal((await db.query(`SELECT has_function_privilege('authenticated','public.gridex_ediel_accepted_transport_projection_v1(uuid,text,uuid,uuid)','EXECUTE') allowed`)).rows[0].allowed,false);checks++
 await db.exec(`TRUNCATE fixture_permissions;INSERT INTO fixture_permissions VALUES('ediel.send')`)
 assert.deepEqual((await read()).providerReceipt,provider);checks++
 assert.equal((await repair()).rows[0].result.projectionStatus,'failed');checks++
 assert.equal((await db.query('SELECT ediel_brp_change_message_basis_v1($1,$2,$3) r',[uid(1),uid(3),uid(2)])).rows[0].r,null);checks++
 await assert.rejects(db.query('SELECT ediel_service_permission_message_basis_v1($1,$2,$3)',[uid(1),uid(3),uid(2)]),/message_unbound/);checks++
 await db.query('INSERT INTO gridex_service_permission.origins VALUES($1,$2,$3,$4,$5)',[uid(1),uid(3),{fixture:'actual source qualification port required separately'},uid(2),uid(11)])
 await assert.rejects(db.query('SELECT ediel_service_permission_message_basis_v1($1,$2,$3)',[uid(1),uid(3),uid(2)]),/fixture_current_source_required/);checks++
 for(const permission of ['communication.read','communication.write','ediel_testing.write']){
  await db.exec('TRUNCATE fixture_permissions');await db.query('INSERT INTO fixture_permissions VALUES($1)',[permission])
  await assert.rejects(read(),/actor_forbidden/);await assert.rejects(repair(),/actor_forbidden/);await assert.rejects(db.query('SELECT ediel_brp_change_message_basis_v1($1,$2,$3)',[uid(1),uid(3),uid(2)]),/actor_forbidden/);await assert.rejects(db.query('SELECT ediel_service_permission_message_basis_v1($1,$2,$3)',[uid(1),uid(3),uid(2)]),/message_forbidden/);checks++
 }
 await db.exec('TRUNCATE fixture_permissions');await assert.rejects(read(),/actor_forbidden/);checks++
 const privateFrozen=(await db.query('SELECT gridex_ediel_transport.accepted_source_basis_v1(m) r FROM ediel_messages m')).rows[0].r;assert.equal(privateFrozen.observedAt,'2026-09-30T12:02:00+00:00');checks++
 console.log(`PASS ${checks} targeted current-send contract and immutable accepted projection PostgreSQL checks; immutable journal fixtures, not native/provider/legal evidence`)
}finally{await db.close()}
