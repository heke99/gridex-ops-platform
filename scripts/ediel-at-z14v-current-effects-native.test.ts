// masterplan: AT-Z14V-ESCO
// Genuine full-schema PostgreSQL/PostgREST consumers. Synthetic external
// issuer/legal/mail/SMTP inputs confer no formal TGT/LIVE or legal approval.
import {createHash,randomUUID} from 'node:crypto'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {resetNativeEscoFixture,nativeEscoSql as sql,nativeEscoLiteral as lit} from './fixtures/ediel-service-evidence-native'
import {pendingZ14,currentAssignment,z14Market,z14Wire,receiveZ14,omitZ14Field,z14RequiredFields,setOwnAckApplication,type PendingZ14} from './helpers/ediel-z14v-current-native-fixture'
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {readReceivedProdatFinalResponsePlan} from '@/lib/ediel/core/receivedProdatFinalResponsePlan'
import {readPhysicalAckSourceCorrelation} from '@/lib/ediel/ack/sourceCorrelation'
import {validateEdifactEnvelope} from '@/lib/ediel/core/edifactValidation'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {serializeUna} from '@/lib/ediel/core/una'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {projectEdielSeriesToBeneficiary} from '@/lib/ediel/services/projection'
import {assertUtiltsPositiveAckAuthorityForSend} from '@/lib/ediel/utilts/positiveAckAuthority'
import {getEdielMessageById} from '@/lib/ediel/db'
import {applyPermissionMarketSource} from '@/lib/ediel/permissions/permissionMarketTransition'
import type {EdielMessageRow} from '@/lib/ediel/types'

beforeEach(resetNativeEscoFixture)
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks()})
const process=(p:PendingZ14,source:EdielMessageRow)=>processInboundEdielMessage({actorUserId:p.f.ids.actor,edielMessageId:source.id})
function replies(p:PendingZ14,source:EdielMessageRow){
 return sql<{acks:EdielMessageRow[];outbox:Record<string,unknown>[]}>(`SELECT jsonb_build_object(
 'acks',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.message_family),'[]') FROM public.ediel_messages x WHERE company_id=${lit(p.f.ids.company)} AND related_message_id=${lit(source.id)} AND direction='outbound'),
 'outbox',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]') FROM public.ediel_outbox x WHERE company_id=${lit(p.f.ids.company)} AND source_message_id=${lit(source.id)}))`)
}
function noPositiveObjectAck(p:PendingZ14,source:EdielMessageRow){
 expect(replies(p,source).acks.filter(x=>x.message_family==='APERAK'&&x.ack_outcome==='positive')).toEqual([])
}
function ackEvidence(p:PendingZ14,source:EdielMessageRow){
 const actual=replies(p,source)
 return {sourceMessageId:source.id,acks:actual.acks.map(a=>({id:a.id,family:a.message_family,outcome:a.ack_outcome})),outbox:actual.outbox.map(x=>({id:x.id,messageId:x.ediel_message_id,family:x.message_family})),blockedEvents:sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('type',event_type,'status',event_status,'message',message,'payload',payload) ORDER BY created_at,id),'[]') FROM public.ediel_message_events WHERE company_id=${lit(p.f.ids.company)} AND ediel_message_id=${lit(source.id)} AND payload->>'blockedBy'='canonical_inbound_ack_guard'`)}
}
function observedPositiveReplies(p:PendingZ14,source:EdielMessageRow){
 const actual=replies(p,source),wire=tokenizeEdifact(source.raw_payload!),envelope=EdifactEnvelopeCodec.decode(source.raw_payload!)
 const line=wire.segments.find(s=>s.tag==='LIN')!,li=wire.segments.find(s=>s.tag==='RFF'&&segmentComposite(s,1,wire.una)[0]==='LI')!
 for(const ack of actual.acks){
  expect(ack).toMatchObject({company_id:p.f.ids.company,environment:'test',direction:'outbound',related_message_id:source.id,ack_outcome:'positive'})
  expect(validateEdifactEnvelope(ack.raw_payload!).syntaxOk).toBe(true)
  const physical=EdifactEnvelopeCodec.decode(ack.raw_payload!),correlation=readPhysicalAckSourceCorrelation(ack,source)
  expect([physical.sender,physical.receiver]).toEqual([envelope.receiver,envelope.sender]);expect(correlation.classification.outcome).toBe('positive')
  if(ack.message_family==='CONTRL')expect(correlation.acknowledgedReferences).toEqual([envelope.interchangeReference])
  else{
   expect(ack.route_profile_id).toBe(p.f.ids.ackProfile)
   expect(correlation.lookupReferences).toContainEqual({type:'BGM_REF',value:segmentComposite(wire.segments.find(s=>s.tag==='BGM'),2,wire.una)[0]})
   expect(correlation.prodatObjectOutcomes).toEqual([{objectId:p.f.point,identityAgency:'9',firstLineIndex:line.index,lineItemReference:segmentComposite(li,1,wire.una)[1],outcome:'positive'}])
   const parsed=tokenizeEdifact(ack.raw_payload!)
   expect(parsed.segments.filter(s=>s.tag==='ERC').map(s=>segmentComposite(s,1,parsed.una)[0])).toEqual(['100'])
  }
  expect(actual.outbox.filter(x=>x.ediel_message_id===ack.id)).toEqual([expect.objectContaining({company_id:p.f.ids.company,environment:'test',source_message_id:source.id,message_family:ack.message_family,ack_outcome:'positive'})])
 }
 return actual
}
async function committedReplies(p:PendingZ14,source:EdielMessageRow){
 const diagnostic=JSON.stringify(ackEvidence(p,source))
 console.info('Z14 final ACK evidence',diagnostic)
 const actual=observedPositiveReplies(p,source)
 expect(actual.acks.map(a=>a.message_family),diagnostic).toEqual(['APERAK','CONTRL']);expect(actual.outbox,diagnostic).toHaveLength(2)
 const line=tokenizeEdifact(source.raw_payload!).segments.find(s=>s.tag==='LIN')!
 const plan=await readReceivedProdatFinalResponsePlan({companyId:p.f.ids.company,sourceMessageId:source.id,rawPayload:source.raw_payload!})
 expect(plan?.plans).toHaveLength(1);expect(plan!.plans[0]).toMatchObject({effectKind:'metering_permission',outcome:'positive',objectLineIndices:[line.index]})
 expect(sql(`SELECT jsonb_build_object('source',source_message_id,'company',company_id,'hash',payload_hash,'canonical',canonical_assessment_id) FROM gridex_received_sources.permission_effect_receipts WHERE id=${lit(plan!.plans[0].effectReceiptId)}`)).toEqual({source:source.id,company:p.f.ids.company,hash:createHash('sha256').update(source.raw_payload!).digest('hex'),canonical:plan!.plans[0].canonicalAssessmentId})
 return actual
}
async function firstPositive(p:PendingZ14){
 const raw=z14Wire(p)
 // Every independent omission must actually change the positive baseline.
 for(const field of z14RequiredFields)expect(omitZ14Field(raw,field),field).not.toBe(raw)
 if(p.bounded)expect(omitZ14Field(raw,'321')).not.toBe(raw)
 const before=z14Market(p),source=await receiveZ14(p,raw)
 expect(z14Market(p)).toEqual(before);expect(replies(p,source)).toEqual({acks:[],outbox:[]})
 // This is the FIRST domain/validation invocation. No fixture prefix applies
 // permission, records accepted validation or captures a passing private facet.
 await process(p,source)
 const after=z14Market(p)
 expect(after.permission).toMatchObject({status:'active',source_z14_message_id:source.id,inbound_z14_message_id:source.id})
 expect(after.permission.metadata).toMatchObject({marketPermission:{mode:'S17',legalActor:p.f.sender,dsoActor:p.f.receiver,sourceZ14:source.id,objects:expect.arrayContaining([expect.objectContaining({point:p.f.point,product:p.f.product,status:'A74'})])}})
 expect(await currentAssignment(p.f)).toMatchObject({mode:'V'})
 expect(Number(after.permission.market_state_version)).toBe(Number(before.permission.market_state_version)+1)
 expect(after.sites).toHaveLength(1);expect(after.sites[0]).toMatchObject({customer_id:p.f.ids.customer,facility_id:p.f.point,status:'approved'})
 expect(after.sites[0].metadata).toMatchObject({source:'inbound_prodat_z14',edielMessageId:source.id,mode:'S17',product:p.f.product})
 expect(Date.parse(String(after.sites[0].start_at))).toBe(Date.parse(p.f.fields.data_start))
 expect(after.sites[0].end_at===null).toBe(!p.bounded)
 if(p.bounded)expect(Date.parse(String(after.sites[0].end_at))).toBe(Date.parse(p.f.fields.data_end!))
 expect(after.permission.permission_id).toBe('SYNTHETIC-PERMISSION-'+p.permissionId.slice(0,8))
 expect(after.permission.rff_li_reference).toBe(before.permission.rff_li_reference)
 expect(after.grants).toEqual([]);expect(after.supply).toEqual(before.supply)
 expect(after.receipts).toHaveLength(1)
 expect(after.receipts[0]).toMatchObject({source_message_id:source.id,qualified_original_message_id:p.z13.id,permission_id:p.permissionId,company_id:p.f.ids.company})
 expect(sql(`SELECT jsonb_build_object('source',source_message_id,'hash',payload_hash,'result',result) FROM gridex_received_sources.permission_partition_receipts WHERE company_id=${lit(p.f.ids.company)} AND source_message_id=${lit(source.id)}`)).toMatchObject({source:source.id,hash:createHash('sha256').update(raw).digest('hex'),result:{applied:true}})
 console.info('Z14 first-processing ACK evidence',JSON.stringify(ackEvidence(p,source)))
 const acks=observedPositiveReplies(p,source)
 expect((await getEdielMessageById(source.id))?.raw_payload).toBe(raw)
 await process(p,source)
 console.info('Z14 replay ACK evidence',JSON.stringify(ackEvidence(p,source)))
 expect(z14Market(p)).toEqual(after);expect(observedPositiveReplies(p,source)).toEqual(acks)
 expect((await getEdielMessageById(source.id))?.raw_payload).toBe(raw)
 expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${lit(p.f.ids.company)} AND message_code='Z04'`)).toBe(0)
 return source
}

it.each([false,true])('first mailbox-born private Z14V/S17 commits permission and physical ACKs, bounded=%s; V triggers no VH historical job',async bounded=>{
 const p=await pendingZ14(bounded),source=await firstPositive(p)
 // Preserve adverse historical review at independent-at-z14v-review.md:44/110.
 // Frozen CASE-Z14V is actual V/S17, so ST-E08 historical_delivery/VH is
 // not triggered. No S18/VH job is claimed completed by this V proof.
 const stable=z14Market(p),z13Bytes=p.z13.raw_payload
 expect(z14Market(p).sites[0].end_at===null).toBe(!bounded)
 expect(()=>sql(`UPDATE public.ediel_messages SET raw_payload=raw_payload||'changed' WHERE id=${lit(source.id)}`)).toThrow(/immutable/)
 expect(()=>sql(`UPDATE public.ediel_messages SET direction='outbound' WHERE id=${lit(source.id)}`)).toThrow(/immutable/)
 expect(await applyPermissionMarketSource({actorUserId:p.f.ids.actor,message:{...source,direction:'outbound'}})).toMatchObject({applied:false,reason:'not_inbound_permission_source'})
 expect(z14Market(p)).toEqual(stable);expect((await getEdielMessageById(p.z13.id))?.raw_payload).toBe(z13Bytes)
 await committedReplies(p,source)
})

it.each(z14RequiredFields)('fresh pending private V omits required field %s before its FIRST processing: no permission, grant, supply or committed positive object ACK',async field=>{
 const p=await pendingZ14(),before=z14Market(p),raw=omitZ14Field(z14Wire(p),field)
 if(field==='202'){
  await expect(receiveZ14(p,raw)).rejects.toThrow(/canonical_inbound_rule_profile_resolution_failed:PRODAT:PRODAT_UNKNOWN:/)
  expect(z14Market(p)).toEqual(before);return
 }
 const source=await receiveZ14(p,raw),decision=await resolveCanonicalRuntimeDecisionWithRegistry(source)
 if(field==='209')await expect(process(p,source)).rejects.toThrow(/^prodat_canonical_source_validation_unconfirmed$/)
 else await process(p,source)
 expect(z14Market(p)).toEqual(before);noPositiveObjectAck(p,source)
 expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify({field,issues:decision.issues})).not.toEqual(['accepted','accepted','accepted'])
 if(field==='233')expect(decision.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'UNSM_MANDATORY_ELEMENT_MISSING',layer:'syntax',severity:'error',description:'PRODAT:D:97A:UN: obligatoriskt NAD/C082/3039[1] saknas.'})]))
 else if(field==='209')expect(decision.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'PRODAT_REPORTING_PURPOSE_SCOPE_UNQUALIFIED',layer:'application',severity:'error',prodatDiagnostic:{kind:'internal',reason:'Supplied323 has no qualified own process/first object',sourceRule:'PRODAT26A:P21/74/119/123'}})]))
 else if(!['207','208','227','311','312'].includes(field))expect(decision.issues,field).toEqual(expect.arrayContaining([expect.objectContaining({prodatDiagnostic:expect.objectContaining({fieldNumber:field})})]))
})

it('fresh bounded V omits required 321 and cannot mutate the still-pending permission',async()=>{
 const p=await pendingZ14(true),before=z14Market(p),source=await receiveZ14(p,omitZ14Field(z14Wire(p),'321'))
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(source)
 await process(p,source);expect(z14Market(p)).toEqual(before);noPositiveObjectAck(p,source)
 expect(decision.issues).toEqual(expect.arrayContaining([expect.objectContaining({prodatDiagnostic:expect.objectContaining({fieldNumber:'321'})})]))
})

it.each([
 ['LI',{transactionReference:'UNRELATED-LI'}],['customer',{customerId:'198001011234'}],
 ['object',{meterPointId:'735999260731000014'}],['agency',{siteIdAgency:'89'}],
 ['purpose',{permissionPurpose:'B71'}],
 ['expanded start',{reportStartDate:'2026-05-01T00:00:00Z'}],
] as const)('fresh first-response wrong %s cannot authorize V or create committed positive APERAK',async(_name,change)=>{
 const p=await pendingZ14(),before=z14Market(p),source=await receiveZ14(p,z14Wire(p,change))
 await process(p,source);expect(z14Market(p)).toEqual(before);noPositiveObjectAck(p,source)
})

it('fresh bounded V cannot expand its reporting end beyond the exact sent request',async()=>{
 const p=await pendingZ14(true),before=z14Market(p),source=await receiveZ14(p,z14Wire(p,{reportEndDate:'2027-07-01T00:00:00Z'}))
 await process(p,source);expect(z14Market(p)).toEqual(before);noPositiveObjectAck(p,source)
})

it('a pending first original cannot be relabelled outbound or have its received raw/hash changed',async()=>{
 const p=await pendingZ14(),source=await receiveZ14(p),before=z14Market(p)
 expect(()=>sql(`UPDATE public.ediel_messages SET direction='outbound' WHERE id=${lit(source.id)}`)).toThrow(/immutable/)
 expect(()=>sql(`UPDATE public.ediel_messages SET raw_payload=raw_payload||'changed' WHERE id=${lit(source.id)}`)).toThrow(/immutable/)
 expect(await applyPermissionMarketSource({actorUserId:p.f.ids.actor,message:p.z13})).toMatchObject({applied:false,reason:'not_inbound_permission_source'})
 expect(z14Market(p)).toEqual(before);expect((await getEdielMessageById(source.id))?.raw_payload).toBe(source.raw_payload)
 noPositiveObjectAck(p,source)
})

it('fresh reply needs the actual current ESCO role',async()=>{
 const p=await pendingZ14(),raw=z14Wire(p),source=await receiveZ14(p,raw),before=z14Market(p)
 sql(`UPDATE public.tenant_actor_roles SET role_code='supplier' WHERE company_id=${lit(p.f.ids.company)} AND actor_id=${lit(p.f.ids.legal)} AND environment='test'`)
 await process(p,source);expect(z14Market(p)).toEqual(before);noPositiveObjectAck(p,source)
})

it('fresh reply needs the actual current DSO grid-owner role',async()=>{
 const p=await pendingZ14(),source=await receiveZ14(p),before=z14Market(p)
 sql(`UPDATE public.platform_actor_roles SET is_active=false WHERE actor_id=${lit(p.f.ids.dso)} AND actor_role='grid_owner'`)
 await process(p,source);expect(z14Market(p)).toEqual(before);noPositiveObjectAck(p,source)
})

it.each(['product','sender','receiver','environment','S18'] as const)('fresh physical wrong %s is checked by actual inbound custody and consumers',async target=>{
 const p=await pendingZ14(target==='S18'),before=z14Market(p),raw=z14Wire(p),wire=tokenizeEdifact(raw)
 // Mutate prospective external bytes, never a frozen canonical source or a
 // caller-supplied admission decision. Outbound rendering is not the oracle.
 const segments=wire.segments.map(s=>{
  const parts=s.raw.split('+')
  // P26.A field506 is C889/7110[4], distinct from the shared Z14 sibling242.
  if(target==='product'&&parts[0]==='CAV'&&parts[1]==='::::8716867000030')parts[1]='::::8716867000047'
  if(target==='S18'&&parts[0]==='CAV'&&parts[1]==='S17')parts[1]='S18'
  if(parts[0]==='UNB'){
   if(target==='sender')parts[2]=parts[2].replace(p.f.receiver,p.f.sender)
   if(target==='receiver')parts[3]=parts[3].replace(p.f.sender,p.f.receiver)
   if(target==='environment')parts[11]=''
  }
  if(parts[0]==='NAD'){
   if(target==='sender'&&parts[1]==='FR')parts[2]=parts[2].replace(p.f.receiver,p.f.sender)
   if(target==='receiver'&&parts[1]==='DO')parts[2]=parts[2].replace(p.f.sender,p.f.receiver)
  }
  return parts.join('+')
 })
 const changed=serializeUna(wire.una)+segments.join(wire.una.segmentTerminator)+wire.una.segmentTerminator
 expect(changed).not.toBe(raw)
 if(target==='product')expect(changed).toContain("CCI++Z14'CAV+::::8716867000047")
 if(target==='S18'){
  expect(raw).toContain("CCI++Z13'CAV+S17")
  expect(changed).toContain("CCI++Z13'CAV+S18")
  expect(p.z13.raw_payload).toContain("CCI++Z13'CAV+S17")
 }
 const source=await receiveZ14(p,changed)
 if(target==='environment')await expect(process(p,source)).rejects.toThrow(/^prodat_canonical_source_validation_unconfirmed$/)
 else await process(p,source)
 expect(z14Market(p)).toEqual(before);noPositiveObjectAck(p,source)
})

it('actual Z14 permission still grants no access: separate public publication, genuine E66 storage/ACK, scoped projection, and refreshed revocation',async()=>{
 const p=await pendingZ14(),outsider=await pendingZ14(),foreignBefore=z14Market(outsider),{f}=p
 expect(outsider.f.point).toBe(f.point);expect(foreignBefore.permission.id).toBe(outsider.permissionId)
 const source=await firstPositive(p);expect(z14Market(outsider)).toEqual(foreignBefore)
 const link=sql<string>(`SELECT to_jsonb(id) FROM public.ediel_assignment_permission_links WHERE company_id=${lit(f.ids.company)} AND assignment_id=${lit(f.assignment)} AND permission_id=${lit(p.permissionId)}`)
 const grant=await f.command({action:'create_grant',commandId:randomUUID(),assignmentId:f.assignment,expectedVersion:(await currentAssignment(f)).version,fields:{permission_link_id:link,object_ids:[f.point],product_ids:[f.product],fields:f.fields.field_sets,data_start:f.fields.data_start,data_end:f.fields.data_end,valid_from:f.fields.valid_from,valid_to:f.fields.valid_to}})
 expect(grant).toMatchObject({status:'held',accessGranted:false})
 const published=await f.command({action:'publish_grant',commandId:randomUUID(),assignmentId:f.assignment,expectedVersion:(await currentAssignment(f)).version,grantId:grant.grantId,expectedGrantVersion:grant.grantVersion})
 // Read the actual guards and persisted terms for diagnosis only. This adds
 // no caller readiness flag, source assessment or authority-bearing write.
 const publicationEvidence=JSON.stringify({published,scope:sql(`SELECT jsonb_build_object(
 'sourceCurrent',public.ediel_permission_source_is_current_v1(a.company_id,mp.id,coalesce(mp.inbound_z14_message_id,mp.source_z14_message_id)),
 'assignmentMatches',gridex_service_administration.permission_matches_assignment_v1(a,mp),
 'assignment',jsonb_build_object('id',a.id,'version',a.version,'mode',a.mode,'environment',a.environment,'purpose',a.purpose,'dataStart',a.data_start,'dataEnd',a.data_end),
 'permission',jsonb_build_object('id',mp.id,'status',mp.status,'mode',mp.metadata#>>'{marketPermission,mode}','sourceZ14',coalesce(mp.inbound_z14_message_id,mp.source_z14_message_id)),
 'grant',(SELECT to_jsonb(g) FROM public.ediel_data_access_grants g WHERE g.company_id=a.company_id AND g.id=${lit(grant.grantId)}),
 'sites',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.metering_permission_sites s WHERE s.company_id=a.company_id AND s.metering_permission_id=mp.id))
 FROM public.ediel_service_assignments a JOIN public.metering_permissions mp ON mp.company_id=a.company_id AND mp.id=${lit(p.permissionId)} WHERE a.company_id=${lit(f.ids.company)} AND a.id=${lit(f.assignment)}`)})
 console.info('Z14 public grant publication evidence',publicationEvidence)
 expect(published,publicationEvidence).toMatchObject({status:'active'})
 setOwnAckApplication(f,'23-DGI-E66-T')
 const incoming=await f.utilts('accepted','Z14-NATIVE-'+randomUUID().slice(0,8))
 expect(await incoming.persist()).toMatchObject([{disposition:'accepted',persistenceStatus:'persisted',contractVersion:2}])
 const ack=await incoming.ack();await incoming.finalize(ack)
 await expect(assertUtiltsPositiveAckAuthorityForSend(ack)).resolves.toBeUndefined()
 expect(ack).toMatchObject({message_family:'APERAK',ack_outcome:'positive',related_message_id:incoming.source.id})
 expect(readPhysicalAckSourceCorrelation(ack,incoming.source).classification.outcome).toBe('positive')
 const series=sql<{id:string;start:string;end:string}>(`SELECT jsonb_build_object('id',id,'start',period_start,'end',period_end) FROM public.meter_reading_series WHERE company_id=${lit(f.ids.company)} AND source_ediel_message_id=${lit(incoming.source.id)}`)
 sql(`INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,role,is_active,role_key) VALUES(${lit(f.ids.beneficiary)},${lit(f.ids.actor)},'operations','active',now(),'member',true,'operations');INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key) SELECT ${lit(f.ids.actor)},${lit(f.ids.beneficiary)},id,key FROM public.permissions WHERE key='metering.read'`)
 const request={beneficiaryCompanyId:f.ids.beneficiary,actorUserId:f.ids.actor,grantId:String(grant.grantId),expectedGrantVersion:sql<number>(`SELECT to_jsonb(version) FROM public.ediel_data_access_grants WHERE id=${lit(grant.grantId)}`),purpose:f.fields.purpose,seriesId:series.id,fields:['reading_at','quantity'] as const,startInclusive:series.start,endExclusive:series.end}
 const stable=()=>sql(`SELECT jsonb_build_object('source',(SELECT to_jsonb(m) FROM public.ediel_messages m WHERE id=${lit(incoming.source.id)}),'series',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.meter_reading_series s WHERE source_ediel_message_id=${lit(incoming.source.id)}),'values',(SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM public.meter_reading_values v WHERE series_id=${lit(series.id)}),'binding',(SELECT to_jsonb(r) FROM gridex_utilts_binding.receipts r WHERE source_message_id=${lit(incoming.source.id)}),'contracts',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.series_id) FROM gridex_utilts_binding.contracts c WHERE source_message_id=${lit(incoming.source.id)}))`)
 const upstream=stable(),page=await projectEdielSeriesToBeneficiary(request)
 expect(page.rows.length).toBeGreaterThan(0);expect(page.rows.every(r=>Object.keys(r).sort().join(',')==='quantity,reading_at')).toBe(true)
 expect(page.provenance).toMatchObject({sourceMessageId:incoming.source.id,sourceRawHash:createHash('sha256').update(incoming.source.raw_payload!).digest('hex'),sourceRole:'DGI',sourceCode:'E66',purpose:f.fields.purpose,receiverRole:'energy_service_company'})
 expect(page.rows).toEqual(sql(`SELECT jsonb_agg(jsonb_build_object('reading_at',reading_at,'quantity',quantity::text) ORDER BY reading_at,id) FROM public.meter_reading_values WHERE series_id=${lit(series.id)} AND reading_at>=${lit(series.start)}::timestamptz AND reading_at<${lit(series.end)}::timestamptz`))
 expect(sql(`SELECT jsonb_build_object('source',source_message_id,'hash',raw_hash,'version',contract_version) FROM gridex_utilts_binding.receipts WHERE source_message_id=${lit(incoming.source.id)}`)).toEqual({source:incoming.source.id,hash:createHash('sha256').update(incoming.source.raw_payload!).digest('hex'),version:2})
 expect(incoming.source.raw_payload).not.toContain(p.permissionId)
 expect(incoming.source.raw_payload).not.toContain('SYNTHETIC-PERMISSION-')
 for(const change of [{purpose:'ungranted billing'},{fields:['secret'] as never},{startInclusive:'1990-01-01T00:00:00Z'},{endExclusive:'2099-01-01T00:00:00Z'},{expectedGrantVersion:request.expectedGrantVersion+1},{actorUserId:f.ids.reviewer},{beneficiaryCompanyId:outsider.f.ids.company}]){
  await expect(projectEdielSeriesToBeneficiary({...request,...change})).rejects.toBeDefined();expect(stable()).toEqual(upstream)
 }
 expect(await projectEdielSeriesToBeneficiary(request)).toEqual(page)
 expect(await f.command({action:'revoke_grant',commandId:randomUUID(),assignmentId:f.assignment,expectedVersion:(await currentAssignment(f)).version,grantId:grant.grantId,expectedGrantVersion:request.expectedGrantVersion})).toMatchObject({status:'revoked'})
 await expect(projectEdielSeriesToBeneficiary({...request,expectedGrantVersion:sql<number>(`SELECT to_jsonb(version) FROM public.ediel_data_access_grants WHERE id=${lit(grant.grantId)}`)})).rejects.toBeDefined()
 await expect(incoming.persist()).rejects.toBeDefined();await expect(assertUtiltsPositiveAckAuthorityForSend(ack)).rejects.toBeDefined()
 expect(stable()).toEqual(upstream);expect(z14Market(outsider)).toEqual(foreignBefore)
 await committedReplies(p,source)
})
