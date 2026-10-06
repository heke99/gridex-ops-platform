import {existsSync,readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
import {expect,it} from 'vitest'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {raw,line,characteristic} from './fixtures/prodat-register'

// Finite SQL contract regression, NOT native authority/effect/ACK proof.
// The tables, response wrapper, legacy receipt reader and public materializer
// are copied verbatim from the qualified captured schema. Canonical admission,
// current customer-source qualification, selection and guide catalogue are
// explicitly declared IO ports. Inserting a fixture version is not a claim that
// these ports were produced by the real business/custody owners.
const schema=readFileSync(new URL('../supabase/schema.sql',import.meta.url),'utf8')
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const literal=(value:string)=>`'${value.replaceAll("'","''")}'`
const json=(value:unknown)=>literal(JSON.stringify(value))+'::jsonb'
const wrapper='gridex_received_sources.prodat_structural_response_v1(uuid,uuid,integer[])'
const materializer='public.ediel_read_prodat_structural_final_response_v1(uuid,uuid,integer[])'
const forward=new URL('../supabase/migrations/20261006231000_ediel_confirmed_death_final_response.sql',import.meta.url)
const altered=[wrapper,
 'gridex_ediel_ack_guide.bound_prodat_response_before_domain_effects_v1(public.ediel_messages,public.ediel_messages)',
 'gridex_ediel_outbound_owner.prepare_before_fresh_ack_envelope_v1(jsonb)',
 'gridex_received_sources.require_domain_response_at_birth_v1()',
]
const metadataQuery=`SELECT oid,to_jsonb(p)-'prosrc' metadata FROM pg_proc p WHERE oid=ANY(ARRAY[${altered.map(name=>literal(name)+'::regprocedure').join(',')}]) ORDER BY oid`
function table(name:string){
 const start=schema.indexOf(`CREATE TABLE ${name} (`),end=schema.indexOf('\n);',start)
 if(start<0||end<start)throw Error('actual_table_required:'+name)
 return schema.slice(start,end+3)
}
function fn(name:string){
 const start=schema.indexOf(`CREATE FUNCTION ${name}(`)
 const delimiter=schema.slice(start).match(/\bAS (\$[\w]*\$)/)?.[1]
 const end=delimiter?schema.indexOf(delimiter+';',schema.indexOf(delimiter,start)+delimiter.length):-1
 if(start<0||end<start||!delimiter)throw Error('actual_function_required:'+name)
 return schema.slice(start,end+delimiter.length+1)
}

function fixture(){
 const point='735999123456789012',customerIdentity='199001011234',li='OWN-DEATH-LI'
 const receivedAt='2026-10-04T10:00:00Z',effectiveAt='2026-10-07T23:00:00Z',observedAt='2026-10-05T10:00:00Z'
 const wire=raw([
  ['NAD','FR',['54321','160','SVK'],'','','','','','','SE'],
  ['NAD','DO',['12345','160','SVK'],'','','','','','','SE'],
  line('1',point,undefined,'9'),['DTM',['157','202610080000','203']],
  ...characteristic('Z13','E34'),...characteristic('Z17','Z41'),
  ['RFF',['LI',li]],['NAD','UD',[customerIdentity,'SE2','260'],'','SYNTHETIC DECEASED CUSTOMER','TEST ROAD 1','TEST','','12345','SE'],
 ],'Z06')
 const index=tokenizeEdifact(wire).segments.find(s=>s.tag==='LIN')!.index
 const hash=createHash('sha256').update(wire).digest('hex')
 const scope={objectId:point,identityAgency:'9',registers:[{registerPosition:1,segmentIndex:index,lineNumber:'1'}],lineIndexes:[index]}
 const party={id:customerIdentity,agency:'260',qualifier:'SE2',name:'SYNTHETIC DECEASED CUSTOMER',deathStatus:'Z41'}
 const facet={version:1,sourcePayloadHash:hash,assessmentId:id(3),objects:[{lineIndex:index,registerLineIndices:[index],id:point,li,outcome:'held'}],responses:[]}
 const result={applied:true,sourceMessageId:id(2),appliedCount:1,owner:'confirmed-customer-source-v1',payloadHash:hash,eventId:id(8),objects:[{meteringPointId:id(6),siteId:id(5),effectiveAt,sourceReceivedAt:receivedAt}]}
 return {point,customerIdentity,li,receivedAt,effectiveAt,observedAt,wire,index,hash,scope,party,facet,result}
}

async function setup(){
 const f=fixture(),db=new PGlite()
 await db.exec(`CREATE ROLE service_role;CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE declared_reader;CREATE SCHEMA gridex_received_sources;
 CREATE SCHEMA gridex_requested_changes;CREATE SCHEMA gridex_ediel_ack_guide;CREATE SCHEMA gridex_ediel_outbound_owner;CREATE SCHEMA gridex_ediel_ack_replay;
 -- Explicit finite graph-lock port: single disposable DB, no concurrent owners.
 CREATE FUNCTION gridex_ediel_ack_replay.lock_current_graph_v2() RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN;END$$;
 ${[
  'public.ediel_messages','gridex_received_sources.customer_primary_response_receipts',
  'gridex_received_sources.object_assessments','gridex_received_sources.structural_object_apply_receipts',
  'gridex_ediel_ack_guide.source_bindings','gridex_requested_changes.confirmed_customer_versions',
  'gridex_requested_changes.customer_version_availability','gridex_requested_changes.events',
  'gridex_ediel_ack_guide.prodat_structural_response_bindings','gridex_ediel_outbound_owner.witnesses',
  'gridex_ediel_outbound_owner.consumptions','gridex_received_sources.prodat_response_facets',
 ].map(table).join('\n')}
 CREATE TABLE public.declared_response_ports(canonical jsonb,current_source jsonb,selection jsonb,guide jsonb,function_objects jsonb);
 INSERT INTO public.declared_response_ports VALUES(
 ${json(f.facet)},
 ${json({sourceMessageId:id(2),payloadHash:f.hash,companyId:id(1),environment:'test',customerId:id(4),siteId:id(5),meteringPointId:id(6),supplyPeriodId:id(7),objectId:f.point,identityAgency:'9',legalSender:'54321',legalReceiver:'12345',effectiveAt:f.effectiveAt,availableAt:f.observedAt,party:f.party})},
 ${json({version:1,companyId:id(1),environment:'test',complete:true,sources:[]})},
 ${json({constraints:{common:{positiveText:'OK'},PRODAT:{allowedErc:['100']}}})},
 ${json({assessmentId:id(3),objects:[{...f.scope,functionalDecision:'accepted',reasonCodes:[]}]})});
 CREATE FUNCTION gridex_received_sources.read_prodat_response_assessment_v1(c uuid,s uuid,a uuid) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN
 IF c IS DISTINCT FROM '${id(1)}'::uuid OR s IS DISTINCT FROM '${id(2)}'::uuid OR a IS DISTINCT FROM '${id(3)}'::uuid THEN RAISE EXCEPTION 'declared_canonical_scope_refused';END IF;
 RETURN(SELECT canonical FROM public.declared_response_ports);END$$;
 CREATE FUNCTION gridex_received_sources.require_prodat_source_function_objects_v1(c uuid,s uuid) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN
 IF c IS DISTINCT FROM '${id(1)}'::uuid OR s IS DISTINCT FROM '${id(2)}'::uuid THEN RAISE EXCEPTION 'declared_function_scope_refused';END IF;
 RETURN(SELECT function_objects FROM public.declared_response_ports);END$$;
 CREATE FUNCTION gridex_received_sources.open_object_selection_snapshot(c uuid,e text,t timestamptz) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN
 IF c IS DISTINCT FROM '${id(1)}'::uuid OR e IS DISTINCT FROM 'test' THEN RAISE EXCEPTION 'declared_selection_scope_refused';END IF;
 RETURN(SELECT jsonb_build_object('readsetText',(selection||jsonb_build_object('cutoffAt',t))::text) FROM public.declared_response_ports);END$$;
 CREATE FUNCTION gridex_requested_changes.customer_facet_basis_v1(b jsonb,t timestamptz,c uuid,e text,customer uuid,site uuid,s text,o text,a text) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN
 IF b->>'complete' IS DISTINCT FROM 'true' OR b->>'companyId' IS DISTINCT FROM c::text OR b->>'environment' IS DISTINCT FROM e OR (b->>'cutoffAt')::timestamptz IS DISTINCT FROM t
 OR c IS DISTINCT FROM '${id(1)}'::uuid OR e IS DISTINCT FROM 'test' OR customer IS DISTINCT FROM '${id(4)}'::uuid OR site IS DISTINCT FROM '${id(5)}'::uuid OR s IS DISTINCT FROM '${id(2)}' OR o IS DISTINCT FROM '${f.point}' OR a IS DISTINCT FROM '9' THEN RETURN NULL;END IF;
 RETURN(SELECT current_source FROM public.declared_response_ports);END$$;
 CREATE FUNCTION gridex_ediel_ack_guide.projection_for_original_v1(v text) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN
 IF v IS DISTINCT FROM 'DECLARED-NATIONAL' THEN RAISE EXCEPTION 'declared_guide_scope_refused';END IF;
 RETURN(SELECT guide FROM public.declared_response_ports);END$$;
 ${fn('gridex_received_sources.wire_tokens_bounded_v1')}
 ${fn('gridex_received_sources.closure_wire_tokens_v2')}
 ${fn('gridex_received_sources.prodat_first_register_characteristic_v1')}
 ${fn('gridex_received_sources.permission_date_v1')}
 ${fn('gridex_received_sources.permission_time_v1')}
 ${fn('gridex_received_sources.prodat_response_before_domain_effects_v1')}
 ${fn('gridex_received_sources.prodat_structural_response_before_customer_v1')}
 ${fn('gridex_received_sources.prodat_structural_response_v1')}
 ${fn('public.ediel_read_prodat_structural_final_response_v1')}
 ${fn('gridex_ediel_ack_guide.bound_prodat_response_before_domain_effects_v1')}
 ${fn('gridex_ediel_outbound_owner.prepare_before_fresh_ack_envelope_v1')}
 ${fn('gridex_received_sources.require_domain_response_at_birth_v1')}
 ${altered.map(name=>`REVOKE ALL ON FUNCTION ${name} FROM PUBLIC;GRANT EXECUTE ON FUNCTION ${name} TO declared_reader;`).join('\n')}
 REVOKE ALL ON FUNCTION ${materializer} FROM PUBLIC;GRANT EXECUTE ON FUNCTION ${materializer} TO service_role;
 INSERT INTO public.ediel_messages(id,company_id,direction,message_standard,message_family,message_code,environment,raw_payload,message_received_at,customer_id,site_id,metering_point_id,sender_ediel_id,receiver_ediel_id,created_by)
 VALUES('${id(2)}','${id(1)}','inbound','edifact','PRODAT','Z06','test',${literal(f.wire)},'${f.receivedAt}','${id(4)}','${id(5)}','${id(6)}','54321','12345','${id(9)}');
 INSERT INTO gridex_requested_changes.events(id,company_id,environment,supply_period_id,supply_source_message_id,supply_state_version,contract_id,protected_contract_hash,customer_id,metering_point_id,customer_snapshot_hash,legal_actor_id,legal_sender_id,legal_receiver_id,point_id,identity_agency,grid_area_code,brp_ediel_id,variant,event_kind,effective_at,customer_identity,invoicee_profile,source_reference,source_sha256,source_version,approved_by,approved_at)
 VALUES('${id(8)}','${id(1)}','test','${id(7)}','${id(10)}',1,'${id(11)}',repeat('a',64),'${id(4)}','${id(6)}',repeat('b',64),'${id(12)}','12345','54321','${f.point}','9','TES','99999','E','death','${f.effectiveAt}',${json(f.party)},'{}','DECLARED-DEATH',repeat('c',64),'1','${id(9)}','${f.observedAt}');
 INSERT INTO gridex_ediel_ack_guide.source_bindings VALUES('${id(2)}','national','${id(1)}','test','${f.hash}','DECLARED-NATIONAL','{}');`)
 // Separate successful statements/transactions retain the real created_xid
 // and snapshot semantics. The witness is never created in the version's tx.
 await db.exec(`INSERT INTO gridex_requested_changes.confirmed_customer_versions(source_message_id,event_id,company_id,environment,payload_hash,customer_id,metering_point_id,effective_at,received_at,party,actor_user_id,canonical_assessment_id,supply_period_id,site_id,object_id,identity_agency,legal_sender,legal_receiver,result)
 VALUES('${id(2)}','${id(8)}','${id(1)}','test','${f.hash}','${id(4)}','${id(6)}','${f.effectiveAt}','${f.receivedAt}',${json(f.party)},'${id(9)}','${id(3)}','${id(7)}','${id(5)}','${f.point}','9','54321','12345',${json(f.result)});`)
 await db.exec(`INSERT INTO gridex_requested_changes.customer_version_availability(source_message_id,company_id,environment,payload_hash,visibility_snapshot,observed_at)
 VALUES('${id(2)}','${id(1)}','test','${f.hash}',pg_current_snapshot()::text,'${f.observedAt}');`)
 const metadata=(await db.query(metadataQuery)).rows
 const publicMetadata=(await db.query(`SELECT to_jsonb(p) metadata FROM pg_proc p WHERE oid='${materializer}'::regprocedure`)).rows
 // Before the forward exists, the same consumer assertion supplies real RED.
 // Once authored, apply its complete SQL without rewriting any function body
 // or omitting other altered owners from the metadata preservation checks.
 if(existsSync(forward))await db.exec(readFileSync(forward,'utf8'))
 expect((await db.query(metadataQuery)).rows).toEqual(metadata)
 expect((await db.query(`SELECT to_jsonb(p) metadata FROM pg_proc p WHERE oid='${materializer}'::regprocedure`)).rows).toEqual(publicMetadata)
 return {db,f,metadata,publicMetadata}
}

const read=(db:PGlite,company=id(1),requested='NULL')=>db.query<{facet:Record<string,unknown>|null}>(`SELECT gridex_received_sources.prodat_structural_response_v1('${company}','${id(2)}',${requested}) facet`)
async function stored(db:PGlite){
 return (await db.query(`SELECT jsonb_build_object(
 'source',(SELECT to_jsonb(m) FROM public.ediel_messages m WHERE id='${id(2)}'),
 'versions',(SELECT coalesce(jsonb_agg(to_jsonb(v)),'[]') FROM gridex_requested_changes.confirmed_customer_versions v),
 'availability',(SELECT coalesce(jsonb_agg(to_jsonb(w)),'[]') FROM gridex_requested_changes.customer_version_availability w),
 'primary',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM gridex_received_sources.customer_primary_response_receipts r),
 'structural',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM gridex_received_sources.structural_object_apply_receipts r),
 'bindings',(SELECT coalesce(jsonb_agg(to_jsonb(b)),'[]') FROM gridex_ediel_ack_guide.prodat_structural_response_bindings b)) value`)).rows
}

// Adversarial finite records ONLY: these updates do not propose a lawful
// production custody/authority producer. Keeping declared ports/hash fixtures
// aligned deliberately isolates a later physical guard from an earlier hash
// refusal. Native tests must use prospective actual producer inputs instead.
async function replaceDeclaredWire(db:PGlite,wire:string){
 const hash=createHash('sha256').update(wire).digest('hex')
 await db.exec(`UPDATE public.ediel_messages SET raw_payload=${literal(wire)};
 UPDATE gridex_requested_changes.confirmed_customer_versions SET payload_hash='${hash}',result=jsonb_set(result,'{payloadHash}',to_jsonb('${hash}'::text));
 UPDATE gridex_requested_changes.customer_version_availability SET payload_hash='${hash}';
 UPDATE gridex_ediel_ack_guide.source_bindings SET payload_sha256='${hash}';
 UPDATE public.declared_response_ports SET canonical=jsonb_set(canonical,'{sourcePayloadHash}',to_jsonb('${hash}'::text)),current_source=jsonb_set(current_source,'{payloadHash}',to_jsonb('${hash}'::text));`)
}

it('the actual final-response wrapper recognizes a committed confirmed death version and its separate availability without modern or structural receipts',async()=>{
 const {db,f,metadata,publicMetadata}=await setup()
 try{
  expect((await db.query(`SELECT v.event_id,w.payload_hash=v.payload_hash same_hash,
   v.created_xid<>pg_current_xact_id() version_committed,pg_visible_in_snapshot(v.created_xid,w.visibility_snapshot::pg_snapshot) version_visible,
   w.xmin::text::numeric<>mod(pg_current_xact_id()::text::numeric,4294967296) witness_committed,
   (SELECT count(*)::int FROM gridex_received_sources.customer_primary_response_receipts) primary_receipts,
   (SELECT count(*)::int FROM gridex_received_sources.structural_object_apply_receipts) structural_receipts
   FROM gridex_requested_changes.confirmed_customer_versions v JOIN gridex_requested_changes.customer_version_availability w USING(source_message_id)`)).rows)
   .toEqual([{event_id:id(8),same_hash:true,version_committed:true,version_visible:true,witness_committed:true,primary_receipts:0,structural_receipts:0}])
  const result=(await db.query<{facet:Record<string,unknown>|null}>(`SELECT gridex_received_sources.prodat_structural_response_v1('${id(1)}','${id(2)}',NULL) facet`)).rows[0].facet
  // Initial RED must be this consumer assertion: the retained real function
  // currently returns NULL, despite the stored version and separate witness.
  expect(result,'a confirmed death own effect must produce its final positive response').not.toBeNull()
  expect(result).toMatchObject({assessmentId:id(3),objects:[{lineIndex:f.index,id:f.point,li:f.li,outcome:'positive'}],
   responses:[{scope:'object',lineIndex:f.index,ercCode:'100',fieldCode:null,text:'OK',id:f.point,li:f.li}],
   effectScopes:[{lineIndex:f.index,canonicalAssessmentId:id(3),objectAssessmentId:null,effectReceiptId:id(2),effectKind:'confirmed_customer_version'}]})
  const effects=result!.effectScopes as {effectFactsHash:string;appliedAt:string}[]
  expect(effects).toHaveLength(1)
  expect(effects[0].effectFactsHash).toMatch(/^[a-f0-9]{64}$/)
  expect((await db.query<{hash:string}>(`SELECT encode(sha256(convert_to(to_jsonb(v)::text,'UTF8')),'hex') hash FROM gridex_requested_changes.confirmed_customer_versions v`)).rows[0].hash).toBe(effects[0].effectFactsHash)
  expect(Date.parse(effects[0].appliedAt)).toBe(Date.parse(f.observedAt))
  expect((await db.query(`SELECT has_function_privilege('anon','gridex_received_sources.confirmed_death_response_v1(uuid,uuid,integer[])','EXECUTE') anon,
   has_function_privilege('authenticated','gridex_received_sources.confirmed_death_response_v1(uuid,uuid,integer[])','EXECUTE') authenticated,
   has_function_privilege('service_role','gridex_received_sources.confirmed_death_response_v1(uuid,uuid,integer[])','EXECUTE') service_role`)).rows)
   .toEqual([{anon:false,authenticated:false,service_role:false}])
  const frozen=await stored(db)
  // A fresh legitimate selection cutoff does not change the immutable owner
  // receipt hash, availability clock, plan, source or any effect/binding row.
  expect((await read(db)).rows[0].facet).toEqual(result)
  expect(await stored(db)).toEqual(frozen)
  await db.exec('SET ROLE service_role')
  const materialized=(await db.query<{response:unknown}>(`SELECT public.ediel_read_prodat_structural_final_response_v1('${id(1)}','${id(2)}',NULL) response`)).rows[0].response
  expect(materialized).toMatchObject({version:1,sourceMessage:{id:id(2),company_id:id(1),raw_payload:f.wire},responseFacet:result})
  await db.exec('RESET ROLE')
  expect((await db.query(metadataQuery)).rows).toEqual(metadata)
  expect((await db.query(`SELECT to_jsonb(p) metadata FROM pg_proc p WHERE oid='${materializer}'::regprocedure`)).rows).toEqual(publicMetadata)
 }finally{await db.close()}
},20000)

const ownEffect='prodat_confirmed_death_response_own_effect_unavailable'
const availability='prodat_confirmed_death_response_committed_availability_required'
const currentOwner='prodat_confirmed_death_response_current_owner_required'
const canonicalScope='prodat_confirmed_death_response_canonical_scope_required'
const physicalScope='prodat_confirmed_death_response_physical_scope_required'
const ownParty='prodat_confirmed_death_response_own_party_clock_reference_required'
const ownPlan='prodat_confirmed_death_response_own_plan_required'
type Refusal={name:string;error:string;change:(db:PGlite,f:ReturnType<typeof fixture>)=>Promise<unknown>}
const refusals:Refusal[]=[
 {name:'missing separately observed availability',error:availability,change:db=>db.exec('DELETE FROM gridex_requested_changes.customer_version_availability')},
 {name:'availability cannot see the version transaction',error:availability,change:db=>db.exec(`UPDATE gridex_requested_changes.customer_version_availability w SET visibility_snapshot=(SELECT format('%s:%s:',v.created_xid,v.created_xid) FROM gridex_requested_changes.confirmed_customer_versions v)`)},
 {name:'missing current source authority',error:currentOwner,change:db=>db.exec('UPDATE public.declared_response_ports SET current_source=NULL')},
 {name:'incomplete current selection',error:'prodat_confirmed_death_response_complete_readset_required',change:db=>db.exec(`UPDATE public.declared_response_ports SET selection=jsonb_set(selection,'{complete}','false')`)},
 {name:'foreign selection tenant',error:'prodat_confirmed_death_response_complete_readset_required',change:db=>db.exec(`UPDATE public.declared_response_ports SET selection=jsonb_set(selection,'{companyId}',to_jsonb('${id(99)}'::text))`)},
 {name:'current source is a foreign customer',error:currentOwner,change:db=>db.exec(`UPDATE public.declared_response_ports SET current_source=jsonb_set(current_source,'{customerId}',to_jsonb('${id(99)}'::text))`)},
 {name:'source bytes differ from the committed version',error:ownEffect,change:db=>db.exec(`UPDATE public.ediel_messages SET raw_payload=raw_payload||' '`)},
 {name:'source reception clock differs from the version',error:ownEffect,change:db=>db.exec(`UPDATE public.ediel_messages SET message_received_at=message_received_at+interval '1 minute'`)},
 {name:'death event no longer belongs to the tenant',error:ownEffect,change:db=>db.exec(`UPDATE gridex_requested_changes.events SET company_id='${id(99)}'`)},
 {name:'missing death event',error:ownEffect,change:db=>db.exec('DELETE FROM gridex_requested_changes.events')},
 {name:'canonical function assessment differs from the version',error:canonicalScope,change:db=>db.exec(`UPDATE public.declared_response_ports SET function_objects=jsonb_set(function_objects,'{assessmentId}',to_jsonb('${id(99)}'::text))`)},
 {name:'canonical function object is held',error:canonicalScope,change:db=>db.exec(`UPDATE public.declared_response_ports SET function_objects=jsonb_set(function_objects,'{objects,0,functionalDecision}','"held"')`)},
 {name:'actual first own customer status is not death',error:physicalScope,change:(db,f)=>replaceDeclaredWire(db,f.wire.replace('CAV+Z41','CAV+Z40'))},
 {name:'later register death cannot replace the first own nondeath status',error:physicalScope,change:(db,f)=>{
  const later=`LIN+2++${f.point}:::9'CCI++Z17'CAV+Z41'`
  const candidate=f.wire.replace('CAV+Z41','CAV+Z40').replace('UNT+',later+'UNT+')
  const parsed=tokenizeEdifact(candidate),unh=parsed.segments.find(s=>s.tag==='UNH')!,unt=parsed.segments.find(s=>s.tag==='UNT')!
  return replaceDeclaredWire(db,candidate.replace(unt.raw,`UNT+${unt.index-unh.index+1}+M`))
 }},
 {name:'actual first own customer identity differs',error:ownParty,change:(db,f)=>replaceDeclaredWire(db,f.wire.replace(f.customerIdentity,'199101011234'))},
 {name:'actual first own effective minute differs',error:ownParty,change:(db,f)=>replaceDeclaredWire(db,f.wire.replace('202610080000','202610090000'))},
 {name:'actual first own LI differs from its canonical plan',error:ownPlan,change:(db,f)=>replaceDeclaredWire(db,f.wire.replace(f.li,'FOREIGN-LI'))},
 {name:'canonical own response is negative',error:ownPlan,change:db=>db.exec(`UPDATE public.declared_response_ports SET canonical=jsonb_set(canonical,'{objects,0,outcome}','"negative"')`)},
 {name:'canonical own object identity differs',error:ownPlan,change:db=>db.exec(`UPDATE public.declared_response_ports SET canonical=jsonb_set(canonical,'{objects,0,id}','"FOREIGN-POINT"')`)},
 {name:'applied result belongs to another source',error:'prodat_confirmed_death_response_result_required',change:db=>db.exec(`UPDATE gridex_requested_changes.confirmed_customer_versions SET result=jsonb_set(result,'{sourceMessageId}',to_jsonb('${id(99)}'::text))`)},
 {name:'applied result has no own objects',error:'prodat_confirmed_death_response_result_required',change:db=>db.exec(`UPDATE gridex_requested_changes.confirmed_customer_versions SET result=jsonb_set(result,'{objects}','[]')`)},
 {name:'original national binding hash differs',error:'prodat_confirmed_death_response_original_guide_required',change:db=>db.exec(`UPDATE gridex_ediel_ack_guide.source_bindings SET payload_sha256=repeat('f',64)`)},
 {name:'original national projection does not admit ERC100',error:'prodat_confirmed_death_response_original_guide_required',change:db=>db.exec(`UPDATE public.declared_response_ports SET guide=jsonb_set(guide,'{constraints,PRODAT,allowedErc}','[]')`)},
]
it.each(refusals)('actual confirmed death response refuses $name without modifying owner rows',async({change,error})=>{
 const {db,f,metadata,publicMetadata}=await setup()
 try{
  // Each refusal independently proves the same real wrapper can first read a
  // positive own effect under its explicitly declared finite authority ports.
  expect((await read(db)).rows[0].facet).not.toBeNull()
  await change(db,f)
  const before=await stored(db)
  await expect(read(db)).rejects.toThrow(error)
  expect(await stored(db)).toEqual(before)
  expect((await db.query(metadataQuery)).rows).toEqual(metadata)
  expect((await db.query(`SELECT to_jsonb(p) metadata FROM pg_proc p WHERE oid='${materializer}'::regprocedure`)).rows).toEqual(publicMetadata)
 }finally{await db.close()}
},20000)

it.each(['version','availability'] as const)('the actual response refuses an uncommitted %s transaction',async kind=>{
 const {db}=await setup()
 try{
  expect((await read(db)).rows[0].facet).not.toBeNull()
  const committed=await stored(db)
  await db.exec('BEGIN')
  if(kind==='version')await db.exec('UPDATE gridex_requested_changes.confirmed_customer_versions SET created_xid=pg_current_xact_id()')
  else await db.exec('UPDATE gridex_requested_changes.customer_version_availability SET observed_at=observed_at')
  await expect(read(db)).rejects.toThrow(kind==='version'?ownEffect:availability)
  await db.exec('ROLLBACK')
  expect(await stored(db)).toEqual(committed)
 }finally{await db.close()}
},20000)

it('the real wrapper refuses foreign tenant and sibling selections and the public read retains its service boundary',async()=>{
 const {db,f}=await setup()
 try{
  expect((await read(db,id(1),`ARRAY[${f.index}]`)).rows[0].facet).not.toBeNull()
  const before=await stored(db)
  await expect(read(db,id(99))).rejects.toThrow('prodat_domain_response_source_required')
  await expect(read(db,id(1),`ARRAY[${f.index+1}]`)).rejects.toThrow('prodat_confirmed_death_response_scope_required')
  await expect(db.query(`SELECT public.ediel_read_prodat_structural_final_response_v1('${id(1)}','${id(2)}',NULL)`)).rejects.toThrow('received_evidence_service_required')
  expect(await stored(db)).toEqual(before)
 }finally{await db.close()}
},20000)

it('a source without any confirmed or primary effect preserves the existing no-positive result',async()=>{
 const {db}=await setup()
 try{
  await db.exec('DELETE FROM gridex_requested_changes.confirmed_customer_versions;DELETE FROM gridex_requested_changes.customer_version_availability')
  const before=await stored(db)
  expect((await read(db)).rows[0].facet).toBeNull()
  expect(await stored(db)).toEqual(before)
 }finally{await db.close()}
},20000)

it.each(['modern','structural'] as const)('the retained actual %s receipt reader keeps its distinct proof when no generic death version exists',async kind=>{
 const {db,f}=await setup()
 try{
  const withoutDeath=f.wire.replace("CCI++Z17'CAV+Z41'",'')
  const parsed=tokenizeEdifact(withoutDeath),unh=parsed.segments.find(s=>s.tag==='UNH')!,unt=parsed.segments.find(s=>s.tag==='UNT')!
  let wire=withoutDeath.replace(unt.raw,`UNT+${unt.index-unh.index+1}+M`)
  if(kind==='structural')wire=wire.replace('BGM+Z06','BGM+Z10')
  await replaceDeclaredWire(db,wire)
  await db.exec(`DELETE FROM gridex_requested_changes.confirmed_customer_versions;DELETE FROM gridex_requested_changes.customer_version_availability;
   UPDATE public.declared_response_ports SET current_source=NULL;
   UPDATE public.ediel_messages SET message_code='${kind==='modern'?'Z06':'Z10'}';`)
  const hash=createHash('sha256').update(wire).digest('hex')
  const business=kind==='modern'
   ?{owner:'inbound-customer-life-event-v1',customerId:id(4),customerVersion:1,effectiveAt:f.effectiveAt}
   :{owner:'reviewed-received-structure-v1',companyId:id(1),environment:'test',sourceMessageId:id(2),sourcePayloadHash:hash,wire:{point:f.point},meteringPointId:id(6),siteId:id(5)}
  const owner={object:f.scope,disposition:'accepted',business,party:{id:f.customerIdentity}}
  const facts=JSON.stringify({objects:[owner]})
  // Independent business proof is declared ONLY for this finite modern
  // compatibility case. Its real receipt reader remains under test; this is
  // not an actual native primary/classification producer or stored effect.
  if(kind==='modern')await db.exec(`CREATE SCHEMA gridex_customer_life_events;
   CREATE FUNCTION gridex_customer_life_events.owner_proof_consistent_v1(p jsonb,b jsonb,s uuid) RETURNS boolean LANGUAGE sql AS $$
   SELECT s='${id(2)}'::uuid AND p=${json(owner.party)} AND b=${json(business)}$$;`)
  await db.exec(`INSERT INTO gridex_received_sources.object_assessments(id,source_message_id,company_id,environment,source_payload_hash,canonical_assessment_id,facts_text,facts_hash,owner_readsets)
   VALUES('${id(13)}','${id(2)}','${id(1)}','test','${hash}','${id(3)}',${literal(facts)},encode(sha256(convert_to(${literal(facts)},'UTF8')),'hex'),'[]');`)
  if(kind==='modern')await db.exec(`INSERT INTO gridex_received_sources.customer_primary_response_receipts(source_message_id,first_line_index,company_id,environment,payload_hash,canonical_assessment_id,object_assessment_id,customer_id,customer_version,effective_at,applied_at,object_scope,owner_fact)
   VALUES('${id(2)}',${f.index},'${id(1)}','test','${hash}','${id(3)}','${id(13)}','${id(4)}',1,'${f.effectiveAt}','${f.observedAt}',${json(f.scope)},${json(owner)});`)
  else await db.exec(`INSERT INTO gridex_received_sources.structural_object_apply_receipts(source_message_id,first_line_index,company_id,environment,payload_hash,canonical_assessment_id,object_assessment_id,actor_user_id,applied_at,source_received_at,object_scope,effect)
   VALUES('${id(2)}',${f.index},'${id(1)}','test','${hash}','${id(3)}','${id(13)}','${id(9)}','${f.observedAt}','${f.receivedAt}',${json(f.scope)},${json({object:f.scope,wire:{point:f.point},meteringPointId:id(6),siteId:id(5)})});`)
  const before=await stored(db),result=(await read(db)).rows[0].facet
  expect(result).toMatchObject({assessmentId:id(3),responses:[{scope:'object',lineIndex:f.index,ercCode:'100',id:f.point,li:f.li}],effectScopes:[{lineIndex:f.index,canonicalAssessmentId:id(3),objectAssessmentId:id(13)}]})
  const effects=result!.effectScopes as Record<string,unknown>[]
  if(kind==='modern')expect(effects[0].effectKind).toBe('customer_version')
  else expect(effects[0]).not.toHaveProperty('effectKind')
  expect(effects[0]).not.toHaveProperty('effectReceiptId')
  expect(await stored(db)).toEqual(before)
 }finally{await db.close()}
},20000)
