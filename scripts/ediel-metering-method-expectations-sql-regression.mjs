// Executes the new prospective watch in embedded PostgreSQL. Source-origin,
// applied-object and SMTP owner ports are explicitly synthetic boundary fixtures;
// this is not native replay, authentic agreement or counterparty evidence.
import {readFileSync} from 'node:fs'
import assert from 'node:assert/strict'
import {pathToFileURL} from 'node:url'
if(!process.env.EDIEL_PGLITE_MODULE)throw Error('EDIEL_PGLITE_MODULE required')
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite()
const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`,c=uid(1),actor=uid(2),literal=v=>`'${String(v).replaceAll("'","''")}'`,json=v=>`${literal(JSON.stringify(v))}::jsonb`
const sql=readFileSync(new URL('../supabase/migrations/20260930230944_ediel_source_bound_metering_method_expectations_v1.sql',import.meta.url),'utf8')
const edition=JSON.parse(sql.match(/FROM \(SELECT '((?:[^']|'')*)'::jsonb value\) edition;/)[1].replaceAll("''","'")),cfg=edition.projection
const policy={guideRevision:'26-A',referenceDate:'2026-09-30',profileKey:'prodat_z09_masterdata_supplier_to_grid',sourceTrace:[{authority:'guide',document:'source fixture',section:'fixture'}]}
let checks=0
const call=(action,extra={})=>`set role service_role;select public.gridex_ediel_metering_method_expectations_v1(${json({companyId:c,environment:'test',actorUserId:actor,action,...extra})}) result;reset role;`
async function invoke(action,extra={}){return(await db.exec(call(action,extra)))[1].rows[0].result}
async function rejects(query,re){try{await assert.rejects(db.exec(query),re);checks++}finally{await db.exec('reset role')}}
async function seed(n,{subtype='F',day='20261231',point=`POINT-${n}`,acceptedAt='2026-09-30T12:00:00Z',accept=true}={}){
 const mid=uid(n),event=uid(n+1000),attempt=uid(n+2000),raw=`SYNTHETIC-ORIGINAL-${n}`
 const basis={companyId:c,environment:'test',customerId:uid(3),meteringPointId:uid(n+3000),legalSenderId:'SUPPLIER',legalReceiverId:'NETWORK',pointId:point,identityAgency:'9',subtype,method:subtype==='F'?'Z04':'Z03'}
 const original={authorized:true,eventId:event,sourceMessageId:mid,basis,validityDay:day}
 const plan={...cfg,sourceSubtype:subtype,validityDay:`${day.slice(0,4)}-${day.slice(4,6)}-${day.slice(6)}`,policy}
 const admission={version:1,family:'PRODAT',code:'Z09',guide:{guideRevision:policy.guideRevision},referenceDate:policy.referenceDate,profileKey:policy.profileKey,sourceTrace:policy.sourceTrace}
 const binding={meteringMethodExpectationPlan:plan,admissionDecision:admission}
 await db.exec(`insert into ediel_messages values('${mid}','${c}','test','outbound','PRODAT','Z09',${literal(raw)},'prepared');
 insert into fixture_originals values('${mid}',${json(original)},${json({code:'Z09',object:{reason:subtype==='F'?'E64':'E32'}})});
 insert into gridex_metering_method_changes.desired_change_receipts values('${event}','${c}','test','${mid}');
 insert into gridex_ediel_transport.attempts values('${attempt}','${c}','test','${mid}',${json(binding)});
 ${accept?`insert into fixture_accepted values('${mid}',${json({lane:'generic_journal',attemptId:attempt,observedAt:acceptedAt})});`:''}`)
 return{mid,event,attempt,basis,plan,binding,original}
}
async function received(n,request,changes={},apply=true){
 const mid=uid(n),raw=`SYNTHETIC-APPLIED-${n}`,own={companyId:c,environment:'test',sourceMessageId:mid,customerId:request.basis.customerId,meteringPointId:request.basis.meteringPointId,
  objectId:request.basis.pointId,identityAgency:'9',legalSupplier:'SUPPLIER',legalNetwork:'NETWORK',measurementMethod:'Z04',effectiveAt:'2027-01-01T00:00:00Z',sourceReceivedAt:'2027-01-02T10:00:00Z',appliedAt:'2027-01-02T10:01:00Z',...changes}
 await db.exec(`insert into ediel_messages values('${mid}','${c}','test','inbound','PRODAT','Z06',${literal(raw)},'received');insert into fixture_applied values('${mid}',${json([own])});`)
 if(apply)await db.exec(`insert into gridex_received_sources.structural_apply_receipts values('${mid}','${c}','test',${literal(own.appliedAt)});`)
 return mid
}
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table companies(id uuid primary key);create table user_profiles(id uuid,user_status text);create table company_memberships(id uuid,company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);
 create table fixture_permissions(permission text primary key);insert into fixture_permissions values('communication.read'),('communication.write'),('communication.send');
 create function gridex_actor_has_company_permission(uuid,uuid,p text) returns boolean language sql as $$select exists(select from public.fixture_permissions where permission=p)$$;
 create table ediel_messages(id uuid primary key,company_id uuid,environment text,direction text,message_family text,message_code text,raw_payload text,status text);
 create table ediel_business_expectations(id uuid primary key default gen_random_uuid(),company_id uuid,environment text,source_message_id uuid,source_operation_id text,expected_family text,expected_code text,expected_subtype text,due_at timestamptz,status text default 'pending',fulfilled_by_message_id uuid,metadata jsonb default '{}',created_at timestamptz default clock_timestamp(),updated_at timestamptz default clock_timestamp());
 create unique index expectation_identity on ediel_business_expectations(company_id,environment,source_message_id,expected_family,expected_code,coalesce(expected_subtype,''));
 create schema gridex_received_sources;create table gridex_received_sources.structural_apply_receipts(source_message_id uuid primary key,company_id uuid,environment text,applied_at timestamptz);
 create function gridex_received_sources.reject_mutation() returns trigger language plpgsql as $$begin raise exception 'immutable_fixture_boundary';end$$;
 create schema gridex_metering_method_changes;create table gridex_metering_method_changes.desired_change_receipts(event_id uuid primary key,company_id uuid,environment text,message_id uuid);
 create table fixture_originals(message_id uuid primary key,basis jsonb,wire jsonb);create table fixture_applied(message_id uuid primary key,objects jsonb);create table fixture_accepted(message_id uuid primary key,basis jsonb);
 create schema gridex_ediel_transport;create table gridex_ediel_transport.attempts(id uuid primary key,company_id uuid,environment text,message_id uuid,binding jsonb);
 create function gridex_metering_method_changes.canonical_tuple_projection_v1() returns jsonb language sql as $$select '{"F":{"reason":"E64"},"G":{"reason":"E32"}}'::jsonb$$;
 create function gridex_metering_method_changes.wire_v1(raw text) returns jsonb language sql as $$select f.wire from public.fixture_originals f join public.ediel_messages m on m.id=f.message_id where m.raw_payload=raw$$;
 create function gridex_metering_method_changes.frozen_original_basis_v1(c uuid,msg uuid) returns jsonb language sql as $$select f.basis||jsonb_build_object('sourcePayloadHash',encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')) from public.fixture_originals f join public.ediel_messages m on m.id=f.message_id where m.id=msg and m.company_id=c$$;
 create function gridex_ediel_transport.accepted_source_basis_v1(m ediel_messages) returns jsonb language sql as $$select a.basis from public.fixture_accepted a where a.message_id=m.id$$;
 create function gridex_received_sources.applied_structural_method_objects_v1(c uuid,msg uuid) returns jsonb language sql as $$select coalesce(jsonb_agg(o||jsonb_build_object('sourcePayloadHash',encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'))),'[]') from public.fixture_applied f join public.ediel_messages m on m.id=f.message_id cross join jsonb_array_elements(f.objects)o where m.id=msg and m.company_id=c$$;
 insert into companies values('${c}');insert into user_profiles values('${actor}','active');insert into company_memberships values('${uid(4)}','${c}','${actor}','active',true,now());`)
 await db.exec(sql);checks++
 const request=await seed(10),row=(await invoke('register',{messageId:request.mid}))[0]
 assert.equal(row.status,'pending');assert.equal(row.metadata.validityDay,'2026-12-31');assert.equal(row.metadata.dueDay,'2027-02-09');assert.equal(new Date(row.due_at).toISOString(),'2027-02-09T23:00:00.000Z');checks++
 assert.equal(row.metadata.anchorType,'z09_validity_day');assert.equal(row.metadata.actualAcceptedAt,'2026-09-30T12:00:00Z');assert.equal(row.metadata.automaticResendAllowed,false);checks++
 await db.exec(`update gridex_ediel_transport.attempts set binding='{}' where id='${request.attempt}';update ediel_messages set status='failed' where id='${request.mid}'`)
 assert.equal((await invoke('register',{messageId:request.mid}))[0].id,row.id);checks++ // existing sealed binding precedes current projections
 const noAcceptance=await seed(11,{accept:false});await rejects(call('register',{messageId:noAcceptance.mid}),/actual_accepted_send_required/)
 assert.equal((await db.query(`select count(*)::int n from ediel_business_expectations where source_message_id='${noAcceptance.mid}'`)).rows[0].n,0);checks++
 const noPlan=await seed(12);await db.exec(`update gridex_ediel_transport.attempts set binding=binding-'meteringMethodExpectationPlan' where id='${noPlan.attempt}'`)
 await rejects(call('register',{messageId:noPlan.mid}),/same_admission_required/)
 const spoofPlan=await seed(13);await db.exec(`update gridex_ediel_transport.attempts set binding=jsonb_set(binding,'{meteringMethodExpectationPlan,offset}','41') where id='${spoofPlan.attempt}'`)
 await rejects(call('register',{messageId:spoofPlan.mid}),/same_admission_required/)
 const response=await received(110,request);assert.equal((await invoke('read',{messageId:request.mid}))[0].status,'fulfilled');checks++
 assert.equal((await invoke('read',{messageId:request.mid}))[0].fulfilled_by_message_id,response);assert.equal((await invoke('read',{messageId:request.mid}))[0].metadata.authorizesMarketEffects,false);checks++
 const race=await seed(20),raceResponse=await received(120,race);assert.equal((await invoke('register',{messageId:race.mid}))[0].fulfilled_by_message_id,raceResponse);checks++
 const missing=await seed(30,{subtype:'G'});await invoke('register',{messageId:missing.mid});await received(130,missing,{measurementMethod:null});assert.equal((await invoke('read',{messageId:missing.mid}))[0].status,'pending');checks++
 const wrongAgency=await seed(40);await invoke('register',{messageId:wrongAgency.mid});await received(140,wrongAgency,{identityAgency:'89'});assert.equal((await invoke('read',{messageId:wrongAgency.mid}))[0].status,'pending');checks++
 const wrongMethod=await seed(50);await invoke('register',{messageId:wrongMethod.mid});await received(150,wrongMethod,{measurementMethod:'Z03'});assert.equal((await invoke('read',{messageId:wrongMethod.mid}))[0].status,'pending');checks++
 const oldEpoch=await seed(60);await invoke('register',{messageId:oldEpoch.mid});await received(160,oldEpoch,{effectiveAt:'2026-12-30T10:00:00Z'});assert.equal((await invoke('read',{messageId:oldEpoch.mid}))[0].status,'pending');checks++
 const beforeRequest=await seed(70);await invoke('register',{messageId:beforeRequest.mid});await received(170,beforeRequest,{sourceReceivedAt:'2026-09-29T12:00:00Z'});assert.equal((await invoke('read',{messageId:beforeRequest.mid}))[0].status,'pending');checks++
 const ambiguous=await seed(80),second=await seed(81,{point:ambiguous.basis.pointId});second.basis.meteringPointId=ambiguous.basis.meteringPointId
 await db.exec(`update fixture_originals set basis=jsonb_set(basis,'{basis,meteringPointId}',${json(ambiguous.basis.meteringPointId)}) where message_id='${second.mid}'`)
 await invoke('register',{messageId:ambiguous.mid});await received(180,ambiguous);assert.equal((await invoke('read',{messageId:ambiguous.mid}))[0].status,'pending');assert.equal((await invoke('register',{messageId:second.mid}))[0].status,'pending');checks++
 const expired=await seed(90,{day:'20260701',acceptedAt:'2026-06-30T12:00:00Z'});await invoke('register',{messageId:expired.mid});await invoke('expire');assert.equal((await invoke('read',{messageId:expired.mid}))[0].status,'manual_review');checks++
 const late=await received(190,expired,{effectiveAt:'2026-07-01T12:00:00Z',sourceReceivedAt:'2026-09-01T12:00:00Z',appliedAt:'2026-09-01T12:01:00Z'});assert.equal((await invoke('read',{messageId:expired.mid}))[0].fulfilled_by_message_id,late);assert.equal((await invoke('read',{messageId:expired.mid}))[0].metadata.receivedAfterDueDay,true);checks++
 const g=await seed(95,{subtype:'G'});await invoke('register',{messageId:g.mid});await received(195,g,{measurementMethod:'Z03'});assert.equal((await invoke('read',{messageId:g.mid}))[0].status,'fulfilled');checks++ // explicit actual network-assigned method, no inferred quarter choice
 const dst=await seed(96,{day:'20260930'}),dstRow=(await invoke('register',{messageId:dst.mid}))[0];assert.equal(dstRow.metadata.dueDay,'2026-11-09');assert.equal(new Date(dstRow.due_at).toISOString(),'2026-11-09T23:00:00.000Z');checks++ //40 date steps across Stockholm DST, not40*24 hours from SMTP
 await rejects(call('read',{companyId:uid(999)}),/actor_forbidden/)
 await rejects(call('observe',{messageId:request.mid}),/observed_source_scope_required/)
 await rejects(`set role service_role;update gridex_method_expectations.bindings set due_day=current_date`,/permission denied/)
 await rejects(`update gridex_method_expectations.bindings set due_day=current_date`,/immutable_fixture_boundary/)
 const acl=(await db.query(`select has_function_privilege('anon','public.gridex_ediel_metering_method_expectations_v1(jsonb)','execute') exposed,has_function_privilege('service_role','public.require_metering_method_expectation_binding_v1(ediel_messages,jsonb)','execute') internal,has_table_privilege('service_role','gridex_method_expectations.observations','insert') forged`)).rows[0]
 assert.deepEqual(acl,{exposed:false,internal:false,forged:false});checks++
 console.log(`PASS ${checks} targeted TM40 PostgreSQL checks; synthetic immutable-owner boundaries, not native replay/authentic source proof`)
}catch(error){console.error(error.message,error.where??'');process.exitCode=1}finally{await db.close()}
