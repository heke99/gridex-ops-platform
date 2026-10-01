// Mechanical PostgreSQL composition only. Actual issuer/review/supply/seal and
// provider journals below are explicit synthetic boundary ports. This cannot
// qualify a native replay, legal fact or any original masterplan criterion.
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import assert from 'node:assert/strict'
import {pathToFileURL} from 'node:url'
if(!process.env.EDIEL_PGLITE_MODULE)throw Error('EDIEL_PGLITE_MODULE required')
const{PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite(),uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,c=uid(1),actor=uid(2),q=v=>`'${String(typeof v==='object'?JSON.stringify(v):v).replaceAll("'","''")}'`,j=v=>q(v)+'::jsonb'
const watch=readFileSync(new URL('../supabase/migrations/20260930230944_ediel_source_bound_metering_method_expectations_v1.sql',import.meta.url),'utf8'),edition=JSON.parse(watch.match(/FROM \(SELECT '((?:[^']|'')*)'::jsonb value\) edition;/)[1].replaceAll("''","'")),policy={guideRevision:'26-A',referenceDate:'2026-10-01',profileKey:'prodat_z09_masterdata_supplier_to_grid',sourceTrace:[{authority:'guide',document:'SYNTHETIC policy boundary',section:'fixture'}]}
const ownerRoot=process.env.EDIEL_METHOD_OWNER_MIGRATION_ROOT??resolve(new URL('../supabase/migrations',import.meta.url).pathname),ownerMigration=name=>readFileSync(resolve(ownerRoot,name),'utf8')
const service=async(query)=>{try{return(await db.exec('SET ROLE service_role;'+query+';RESET ROLE;'))[1].rows[0]}finally{await db.exec('RESET ROLE')}}
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE companies(id uuid PRIMARY KEY);CREATE TABLE user_profiles(id uuid,user_status text);CREATE TABLE company_memberships(id uuid,company_id uuid,user_id uuid,status text,is_active bool,accepted_at timestamptz);
 CREATE FUNCTION public.gridex_actor_has_company_permission(uuid,uuid,text) RETURNS bool LANGUAGE sql AS $$SELECT true$$;
 CREATE TABLE ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_family text,message_code text,raw_payload text,status text,message_standard text DEFAULT 'edifact',immutable_payload_hash text,immutable_rendered_at timestamptz,created_by uuid,intent_id uuid,source_operation_id text);
 CREATE TABLE ediel_business_expectations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,environment text,source_message_id uuid,source_operation_id text,expected_family text,expected_code text,expected_subtype text,due_at timestamptz,status text DEFAULT 'pending',fulfilled_by_message_id uuid,metadata jsonb DEFAULT '{}',created_at timestamptz DEFAULT clock_timestamp(),updated_at timestamptz DEFAULT clock_timestamp());
 CREATE SCHEMA gridex_received_sources;CREATE TABLE gridex_received_sources.structural_apply_receipts(source_message_id uuid PRIMARY KEY,company_id uuid,environment text,applied_at timestamptz);
 CREATE FUNCTION gridex_received_sources.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'immutable_fixture_boundary';END$$;
 CREATE SCHEMA gridex_metering_method_changes;CREATE TABLE gridex_metering_method_changes.origins(company_id uuid,message_id uuid);CREATE TABLE gridex_metering_method_changes.desired_change_receipts(event_id uuid PRIMARY KEY,company_id uuid,environment text,message_id uuid);
 CREATE TABLE fixture_originals(message_id uuid PRIMARY KEY,basis jsonb,wire jsonb);CREATE TABLE fixture_applied(message_id uuid PRIMARY KEY,objects jsonb);CREATE TABLE fixture_accepted(message_id uuid PRIMARY KEY,basis jsonb);
 CREATE SCHEMA gridex_ediel_transport;CREATE TABLE gridex_ediel_transport.attempts(id uuid PRIMARY KEY,company_id uuid,environment text,message_id uuid,binding jsonb,actor_user_id uuid,entered_at timestamptz);
 CREATE FUNCTION gridex_metering_method_changes.canonical_tuple_projection_v1() RETURNS jsonb LANGUAGE sql AS $$SELECT '{"F":{"reason":"E64"},"G":{"reason":"E32"}}'::jsonb$$;
 CREATE FUNCTION gridex_metering_method_changes.wire_v1(raw text) RETURNS jsonb LANGUAGE sql AS $$SELECT f.wire FROM public.fixture_originals f JOIN public.ediel_messages m ON m.id=f.message_id WHERE m.raw_payload=raw$$;
 CREATE FUNCTION gridex_metering_method_changes.frozen_original_basis_v1(c uuid,msg uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT f.basis FROM public.fixture_originals f WHERE f.message_id=msg$$;
 CREATE FUNCTION gridex_ediel_transport.accepted_source_basis_v1(m ediel_messages) RETURNS jsonb LANGUAGE sql AS $$SELECT a.basis FROM public.fixture_accepted a WHERE a.message_id=m.id$$;
 CREATE FUNCTION gridex_received_sources.applied_structural_method_objects_v1(c uuid,msg uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT objects FROM public.fixture_applied WHERE message_id=msg$$;
 CREATE SCHEMA gridex_requested_changes;CREATE TABLE gridex_requested_changes.origins(event_id uuid PRIMARY KEY,company_id uuid,actor_user_id uuid,intent_id uuid,message_id uuid,payload_hash text,basis jsonb);
 CREATE TABLE boundary_current(message_id uuid PRIMARY KEY,basis jsonb,qualified bool);
 CREATE FUNCTION gridex_requested_changes.require_message_v1(m ediel_messages,actor uuid,permission text DEFAULT 'communication.write') RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE b jsonb;BEGIN SELECT basis INTO b FROM public.boundary_current WHERE message_id=m.id AND qualified;if b IS NULL THEN RAISE EXCEPTION 'synthetic_current_requested_source_missing';END IF;RETURN b;END$$;
 CREATE SCHEMA gridex_ediel_ack_replay;CREATE FUNCTION gridex_ediel_ack_replay.lock_current_graph_v2() RETURNS void LANGUAGE sql AS $$SELECT$$;
 CREATE SCHEMA gridex_ediel_source_rules;CREATE FUNCTION gridex_ediel_source_rules.require_v1(uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
 CREATE SCHEMA gridex_negative_fixtures;CREATE TABLE gridex_negative_fixtures.positive_consumptions(company_id uuid,message_id uuid);CREATE TABLE gridex_negative_fixtures.negative_prepared_consumptions(company_id uuid,message_id uuid);CREATE FUNCTION gridex_negative_fixtures.require_negative_message_v1(uuid,uuid,text) RETURNS jsonb LANGUAGE sql AS $$SELECT NULL::jsonb$$;CREATE FUNCTION gridex_metering_method_changes.fixture_qualification_v1(jsonb,uuid,boolean) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;CREATE FUNCTION gridex_negative_fixtures.require_positive_message_v1(uuid,uuid,text) RETURNS jsonb LANGUAGE sql AS $$SELECT NULL::jsonb$$;
 CREATE FUNCTION public.ediel_require_metering_method_change_source_current_v1(uuid,uuid,uuid) RETURNS void LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic_legacy_method_source_missing';END$$;CREATE TABLE provider_effects(id uuid);CREATE TABLE projection_effects(id uuid);
 CREATE FUNCTION gridex_ediel_transport.mutate_v1(i jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN IF i->>'action' IN('prepare','enter') THEN IF i->>'fixtureReplay'='true' THEN RETURN '{"proceed":false,"classification":"accepted"}';END IF;INSERT INTO public.provider_effects VALUES((i->>'messageId')::uuid);IF i->>'action'='enter' THEN UPDATE gridex_ediel_transport.attempts SET entered_at=clock_timestamp() WHERE id=(i->>'attemptId')::uuid;END IF;RETURN '{"proceed":true}';END IF;RETURN '{}';END$$;
 CREATE FUNCTION public.ediel_project_accepted_source_state_v1(c uuid,env text,actor uuid,msg uuid,h text) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN INSERT INTO public.projection_effects VALUES(msg);RETURN jsonb_build_object('status','source_projection','companyId',c,'environment',env,'messageId',msg,'originalHash',h);END$$;
 CREATE FUNCTION public.gridex_ediel_repair_accepted_transport_projection_v1(c uuid,env text,actor uuid,msg uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT public.ediel_project_accepted_source_state_v1(c,env,actor,msg,(SELECT immutable_payload_hash FROM public.ediel_messages WHERE id=msg))$$;
 CREATE FUNCTION gridex_ediel_transport.require_technical_expectation_binding_v1(public.ediel_messages,jsonb) RETURNS jsonb LANGUAGE sql AS $$SELECT $2$$;CREATE SCHEMA gridex_outbound_dispatch;CREATE TABLE gridex_outbound_dispatch.attempts(id uuid,company_id uuid,environment text,message_id uuid,binding jsonb);CREATE FUNCTION gridex_outbound_dispatch.mutate_v1(jsonb) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
 INSERT INTO companies VALUES('${c}');INSERT INTO user_profiles VALUES('${actor}','active');INSERT INTO company_memberships VALUES('${uid(3)}','${c}','${actor}','active',true,now());`)
 await db.exec(watch);await db.exec(readFileSync(new URL('../supabase/migrations/20260930233558_ediel_method_expectation_actor_scope_v1.sql',import.meta.url),'utf8'))
 await db.exec(ownerMigration('20260930231350_ediel_same_admission_technical_timer_transport_guards.sql'));await db.exec(ownerMigration('20260930234515_ediel_accepted_metering_method_watch_projection.sql'));await db.exec(ownerMigration('20260930235044_ediel_method_watch_certification_source_kind.sql'))
 await db.exec('GRANT USAGE ON SCHEMA gridex_ediel_transport TO service_role')
 const forward=readFileSync(new URL('../supabase/migrations/20261001031906_ediel_requested_change_method_watch_consumers.sql',import.meta.url),'utf8');if(forward.trim())await db.exec(forward)
 async function request(n,variant='F',accept=true,ownScope={}){
  const mid=uid(n),event=uid(n+100),attempt=uid(n+200),raw=`SYNTHETIC-PROTECTED-REQUEST-${n}`,basis={status:'authorized',companyId:c,environment:'test',eventId:event,variant,eventKind:variant==='F'?'quarter_contract':'method_contract',customerId:uid(4),meteringPointId:uid(n+300),legalSenderId:'12345',legalReceiverId:'54321',pointId:`POINT-${n}`,identityAgency:'9',effectiveAt:'2026-10-05T00:00:00Z',...ownScope}
  const hash=(await db.query(`SELECT encode(sha256(convert_to(${q(raw)},'UTF8')),'hex') h`)).rows[0].h,plan={...edition.projection,sourceSubtype:variant,validityDay:'2026-10-05',policy},binding={originalHash:hash,meteringMethodExpectationPlan:plan,admissionDecision:{version:1,family:'PRODAT',code:'Z09',guide:{guideRevision:policy.guideRevision},referenceDate:policy.referenceDate,profileKey:policy.profileKey,sourceTrace:policy.sourceTrace}}
  await db.exec(`INSERT INTO ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,status,immutable_payload_hash,immutable_rendered_at,created_by,intent_id,source_operation_id) VALUES('${mid}','${c}','test','outbound','PRODAT','Z09',${q(raw)},'prepared','${hash}',now(),'${actor}','${uid(n+400)}','${event}');INSERT INTO gridex_requested_changes.origins VALUES('${event}','${c}','${actor}','${uid(n+400)}','${mid}','${hash}',${j(basis)});INSERT INTO boundary_current VALUES('${mid}',${j(basis)},true);INSERT INTO fixture_originals VALUES('${mid}',NULL,${j({code:'Z09',object:{reason:variant==='F'?'E64':'E32',effective:'202610050100'}})});INSERT INTO gridex_ediel_transport.attempts(id,company_id,environment,message_id,binding,actor_user_id) VALUES('${attempt}','${c}','test','${mid}',${j(binding)},'${actor}')`)
  let acceptedBasis=null;if(accept){for(const action of ['prepare','enter'])await service(`SELECT gridex_ediel_transport.mutate_v1(${j({action,companyId:c,environment:'test',actorUserId:actor,messageId:mid,attemptId:attempt,binding})}) result`);acceptedBasis={lane:'generic_journal',attemptId:attempt,observedAt:(await db.query('SELECT clock_timestamp() observed')).rows[0].observed};await db.exec(`INSERT INTO fixture_accepted VALUES('${mid}',${j(acceptedBasis)})`)}
  return{mid,event,attempt,basis,hash,binding,acceptedBasis}
 }
 const f=await request(10),g=await request(11,'G')
 const frozen=async(r)=>(await db.query(`SELECT gridex_metering_method_changes.frozen_original_basis_v1('${c}','${r.mid}') b`)).rows[0].b
 assert.equal((await frozen(f))?.authorized,true,'Actual requested-change origin must reach the frozen method-watch source port')
 assert.equal((await frozen(f)).basis.subtype,'F');assert.equal((await frozen(g)).basis.method,'Z03')
 const project=async(r)=>service(`SELECT public.gridex_ediel_repair_accepted_transport_projection_v1('${c}','test','${actor}','${r.mid}') result`)
 await project(f);await project(g)
 assert.equal((await db.query('SELECT count(*)::int n FROM gridex_method_expectations.bindings')).rows[0].n,2)
 const row=(await db.query(`SELECT * FROM ediel_business_expectations WHERE source_message_id='${f.mid}'`)).rows[0];assert.equal(row.metadata.dueDay,'2026-11-14');assert.equal(row.metadata.actualAcceptedAt,new Date(f.acceptedBasis.observedAt).toISOString())
 const bad=await request(12);await db.exec(`UPDATE gridex_ediel_transport.attempts SET binding=binding-'meteringMethodExpectationPlan' WHERE id='${bad.attempt}'`)
 await assert.rejects(()=>project(bad),/same_admission_required|original_required/);assert.equal((await db.query(`SELECT count(*)::int n FROM projection_effects WHERE id='${bad.mid}'`)).rows[0].n,0)
 await db.exec(`UPDATE boundary_current SET qualified=false WHERE message_id='${g.mid}'`);assert.equal((await frozen(g)).authorized,true,'Accepted immutable entry-source remains historical observation authority after current source revocation')
 const beforeProviderEffects=(await db.query(`SELECT count(*)::int n FROM provider_effects WHERE id='${g.mid}'`)).rows[0].n
 await assert.rejects(()=>service(`SELECT gridex_ediel_transport.mutate_v1(${j({action:'prepare',companyId:c,environment:'test',actorUserId:actor,messageId:g.mid,attemptId:g.attempt,binding:g.binding})}) result`),/original_required|synthetic_current_requested_source_missing/)
 assert.equal((await db.query(`SELECT count(*)::int n FROM provider_effects WHERE id='${g.mid}'`)).rows[0].n,beforeProviderEffects)
 assert.equal((await service(`SELECT gridex_ediel_transport.mutate_v1(${j({action:'prepare',companyId:c,environment:'test',actorUserId:actor,messageId:g.mid,fixtureReplay:true})}) result`)).result.proceed,false)
 async function apply(request,n){
  const source=uid(n),observed=new Date(new Date(request.acceptedBasis.observedAt).getTime()+1000).toISOString(),own={companyId:c,environment:'test',customerId:request.basis.customerId,meteringPointId:request.basis.meteringPointId,objectId:request.basis.pointId,identityAgency:'9',legalSupplier:'12345',legalNetwork:'54321',measurementMethod:'Z04',sourceReceivedAt:observed,effectiveAt:'2026-10-05T00:00:00Z',sourcePayloadHash:'a'.repeat(64),appliedAt:observed}
  await db.exec(`INSERT INTO ediel_messages(id,company_id,environment,direction,message_family,message_code) VALUES('${source}','${c}','test','inbound','PRODAT','Z06');INSERT INTO fixture_applied VALUES('${source}',${j([own])});INSERT INTO gridex_received_sources.structural_apply_receipts VALUES('${source}','${c}','test',clock_timestamp())`)
  return source
 }
 // Receipt-triggered observation uses its genuine immutable original, not a
 // recomputation from customer/supply fields that the Z06 itself may change.
 await db.exec(`UPDATE boundary_current SET qualified=false WHERE message_id='${f.mid}'`)
 const actualResponse=await apply(f,1000)
 assert.equal((await db.query(`SELECT status,fulfilled_by_message_id FROM ediel_business_expectations WHERE source_message_id='${f.mid}'`)).rows[0].status,'fulfilled')
 assert.equal((await db.query(`SELECT fulfilled_by_message_id FROM ediel_business_expectations WHERE source_message_id='${f.mid}'`)).rows[0].fulfilled_by_message_id,actualResponse)
 // Include an accepted-but-not-yet-registered new request in the ambiguity
 // candidate set; one Z06 cannot be borrowed by two matching live requests.
 const overlap={pointId:'SYNTHETIC-OVERLAP',meteringPointId:uid(900)},first=await request(16,'F',true,overlap),second=await request(17,'F',true,overlap)
 await project(first);await apply(first,1001)
 assert.equal((await db.query(`SELECT status FROM ediel_business_expectations WHERE source_message_id='${first.mid}'`)).rows[0].status,'pending')
 assert.equal((await db.query(`SELECT count(*)::int n FROM gridex_method_expectations.bindings WHERE source_message_id='${second.mid}'`)).rows[0].n,0)
 await db.exec(`UPDATE ediel_messages SET immutable_payload_hash='${'f'.repeat(64)}' WHERE id='${f.mid}'`);assert.equal(await frozen(f),null)
 console.log('PASS SQL composition: requested-change F/G source/current qualification/same-admission entry seal/atomic watch/immutable historical observation/ambiguity; PGlite and synthetic qualification/provider boundaries, NOT genuine native replay/issuer/masterplan acceptance')
}catch(error){console.error('FAIL',error.message,error.code??'',error.where??'');process.exitCode=1}finally{await db.close()}
