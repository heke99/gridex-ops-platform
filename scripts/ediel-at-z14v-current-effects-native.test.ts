// masterplan: AT-Z14V-ESCO
// Genuine full-schema PostgreSQL/PostgREST consumers. Synthetic external
// issuer/legal/mail/SMTP inputs confer no formal TGT/LIVE or legal approval.
import {createHash,randomUUID} from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'
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
import {isProdatCalendarMinute,prodatDate203} from '@/lib/ediel/prodat/render/dates'
import {supabaseService} from '@/lib/supabase/service'
import {parseSourceReceiptInstant} from '@/lib/ediel/utilts/receivedSourceInventory'
import {isEvidenceRecord,isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
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
function canonicalLineageEvidence(p:PendingZ14,source:EdielMessageRow){
 // Diagnose actual owner observations only; never install assessment facts.
 return sql(`SELECT jsonb_build_object('source',${lit(source.id)},'payloadHash',${lit(createHash('sha256').update(source.raw_payload!).digest('hex'))},
 'sourceCurrent',public.ediel_permission_source_is_current_v1(a.company_id,mp.id,${lit(source.id)}),
 'assignmentMatches',gridex_service_administration.permission_matches_assignment_v1(a,mp),
 'receipts',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'canonical',e.canonical_assessment_id,'company',e.company_id,'source',e.source_message_id,'payloadHash',e.payload_hash,'objectScopes',e.object_scopes) ORDER BY e.id),'[]') FROM gridex_received_sources.permission_effect_receipts e WHERE e.company_id=a.company_id AND e.permission_id=mp.id AND e.source_message_id=${lit(source.id)}),
 'assessments',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',v.id,'previous',v.previous_assessment_id,'company',v.company_id,'source',v.source_message_id,'environment',v.environment,'payloadHash',v.source_payload_hash,'factsHash',v.facts_hash,
 'syntax',v.facts_text::jsonb->>'syntaxDecision','application',v.facts_text::jsonb->>'applicationDecision','functional',v.facts_text::jsonb->>'functionalDecision',
 'leaf',NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id),
 'applicationFacetHash',(SELECT f.application_facts_hash FROM gridex_received_sources.prodat_application_facets f WHERE f.assessment_id=v.id AND f.company_id=v.company_id AND f.source_message_id=v.source_message_id AND f.environment=v.environment AND f.source_payload_hash=v.source_payload_hash)) ORDER BY v.assessed_at,v.id),'[]') FROM gridex_received_sources.validation_assessments v WHERE v.company_id=a.company_id AND v.source_message_id=${lit(source.id)})
 ) FROM public.ediel_service_assignments a JOIN public.metering_permissions mp ON mp.company_id=a.company_id AND mp.id=${lit(p.permissionId)} WHERE a.company_id=${lit(p.f.ids.company)} AND a.id=${lit(p.f.assignment)}`)
}
async function reportingReadEvidence(p:PendingZ14,source:EdielMessageRow){
 // Observation only, AFTER processing. This later READ cannot prove that the
 // earlier runtime READ or its opaque capability qualified. Never pass its
 // result to canonical validation, a capability loader or any write port.
 const digest=(v:unknown)=>{const value=typeof v==='string'?v:JSON.stringify(v)??String(v);return {length:value.length,sha256:createHash('sha256').update(value).digest('hex')}}
 const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)
 const text=(v:unknown,empty=false)=>typeof v==='string'&&(empty||v.length>0)&&v.length<=200&&v===v.trim()&&!/[\x00-\x1f\x7f]/.test(v)
 const safeNames=new Set(['received_reporting_service_required','received_reporting_actor_required','received_reporting_read_actor_forbidden',
  'immutable_received_reporting_scope_required','complete_received_reporting_wire_required','complete_own_received_reporting_identity_required',
  'current_received_reporting_legal_role_required','unique_immutable_service_original_required','unique_immutable_service_origin_required',
  'sealed_sent_immutable_service_original_required','actual_unique_accepted_original_before_receive_required','exact_independent_original_reporting_identity_required',
  'exact_historical_assignment_scope_required','explicit_historical_classification_and_reporting_terms_required','independent_bounded_reporting_end_required','explicit_indefinite_reporting_term_required',
  ...['end_user_contract','dso_contract','service_contract','downstream_use','privacy_roles'].map(k=>'historical_review:'+k)])
 const safe=(v:unknown)=>typeof v==='string'&&safeNames.has(v)?v:digest(v)
 const missing=(v:unknown)=>Array.isArray(v)?{count:v.length,names:v.slice(0,32).map(safe)}:{array:false}
 const sourceIdentity=(m:EdielMessageRow)=>digest(['id','company_id','environment','direction','message_standard','message_family','message_code','raw_payload','message_received_at','immutable_payload_hash','execution_context_snapshot']
  .map(k=>(m as unknown as Record<string,unknown>)[k])).sha256
 const protectedIdentity=()=>sql<string|null>(`SELECT to_jsonb(encode(sha256(convert_to(jsonb_build_object('source',source_message_id,'company',company_id,'environment',environment,'origin',origin,'code',message_code,'rawHash',encode(sha256(convert_to(raw_payload,'UTF8')),'hex'),'payloadHash',payload_hash,'receivedAt',source_received_at,'capturedAt',captured_at,'birth',received_context)::text,'UTF8')),'hex')) FROM gridex_received_sources.sources WHERE company_id=${lit(p.f.ids.company)} AND source_message_id=${lit(source.id)}`)
 let sourceBefore:string|undefined,protectedBefore:string|null|undefined,marketBefore:string|undefined
 const readStart=Date.now(),output:Record<string,unknown>={sourceMessageId:source.id,readStart,observation:'post_processing_read_only'}
 try{
  const current=await getEdielMessageById(source.id)
  if(!current){output.currentSourceAvailable=false;return}
  output.currentSourceAvailable=true
  output.sourceUnchanged=['id','company_id','environment','direction','message_standard','message_family','message_code','raw_payload','message_received_at','immutable_payload_hash','execution_context_snapshot']
   .every(k=>isDeepStrictEqual((current as unknown as Record<string,unknown>)[k],(source as unknown as Record<string,unknown>)[k]))
  sourceBefore=sourceIdentity(current);protectedBefore=protectedIdentity();marketBefore=digest(z14Market(p)).sha256
  const {data:b,error}=await supabaseService.rpc('gridex_ediel_received_z14_reporting_source_basis_v1',
   {p_source_message_id:source.id,p_actor_user_id:p.f.ids.actor}).abortSignal(AbortSignal.timeout(2000))
  const readEnd=Date.now();output.readEnd=readEnd;output.elapsedMs=readEnd-readStart
  if(error){output.rpcError={code:typeof error.code==='string'&&/^[A-Z0-9]{5}$/.test(error.code)?error.code:digest(error.code),message:safe(error.message)};return}
  if(b===null){output.rpcResult='unavailable';return}
  if(!isEvidenceRecord(b)){output.rpcResult='invalid_record';return}
  output.rpcResult=['qualified','held'].includes(String(b.status))?b.status:digest(b.status)
  output.missing=missing(b.missing)
  output.objectCount=Array.isArray(b.objects)?b.objects.length:null;output.heldObjectCount=Array.isArray(b.heldObjects)?b.heldObjects.length:null
  output.heldMissing=Array.isArray(b.heldObjects)?b.heldObjects.slice(0,2).map(o=>missing(isEvidenceRecord(o)?o.missing:undefined)):[]
  const received=parseSourceReceiptInstant(current.message_received_at),born=isEvidenceRecord(current.execution_context_snapshot)?current.execution_context_snapshot.receivedProdatContext:undefined
  const payloadHash=createHash('sha256').update(current.raw_payload??'').digest('hex')
  const captured=isEvidenceRecord(born)?parseSourceReceiptInstant(born.capturedAt):null
  output.envelopeChecks={actorUuid:isEvidenceUuid(p.f.ids.actor),companyUuid:isEvidenceUuid(current.company_id),receivedClock:received!==null,
   companyMatches:b.companyId===current.company_id,sourceMatches:b.sourceMessageId===current.id,environmentMatches:b.environment===current.environment,
   payloadHashMatches:b.sourcePayloadHash===payloadHash,actorMatches:b.actorUserId===p.f.ids.actor,contextHashFormat:hash(b.sourceContextHash),
   nestedContextMatches:isDeepStrictEqual(b.sourceReceivedContext,born),receivedClockMatches:received!==null&&parseSourceReceiptInstant(b.sourceReceivedAt)===received,
   birthIdentity:isEvidenceRecord(born)&&born.sourceMessageId===current.id&&born.companyId===current.company_id&&born.environment===current.environment&&born.messageCode==='Z14'&&born.payloadHash===payloadHash&&born.version===1&&born.contextOrigin==='database_insert',
   birthReceivedClock:isEvidenceRecord(born)&&received!==null&&parseSourceReceiptInstant(born.sourceReceivedAt)===received,
   birthCapturedClock:captured!==null&&received!==null&&captured>=received&&captured<(BigInt(readEnd)+BigInt(1))*BigInt(1000),
   evaluationClockInteger:Number.isSafeInteger(b.evaluationUtcMs),evaluationNotAfterReadEnd:Number.isSafeInteger(b.evaluationUtcMs)&&Number(b.evaluationUtcMs)<=readEnd,
   evaluationAfterReceive:Number.isSafeInteger(b.evaluationUtcMs)&&received!==null&&(BigInt(Number(b.evaluationUtcMs))+BigInt(1))*BigInt(1000)>received,
   evaluationWithinDiagnosticRead:Number.isSafeInteger(b.evaluationUtcMs)&&Number(b.evaluationUtcMs)>=readStart&&Number(b.evaluationUtcMs)<=readEnd,
   arraysBounded:Array.isArray(b.objects)&&b.objects.length<=1000&&Array.isArray(b.heldObjects)&&b.heldObjects.length<=1000,
   objectScopesUnique:Array.isArray(b.objects)&&b.objects.length<=1000&&new Set(b.objects.map(o=>JSON.stringify(isEvidenceRecord(o)?o.scope:null))).size===b.objects.length}
  const wire=tokenizeEdifact(current.raw_payload??''),{groups}=prodatRegisterGroups(wire.segments,wire.una,'Z14')
  output.objectChecks=Array.isArray(b.objects)?b.objects.slice(0,2).map(v=>{
   if(!isEvidenceRecord(v)||!isEvidenceRecord(v.scope)||!isEvidenceRecord(v.scope.customer)||!isEvidenceRecord(v.original)||!isEvidenceRecord(v.term)||!isEvidenceRecord(v.purpose))return {recordShape:false}
   const s=v.scope,c=s.customer as Record<string,unknown>,o=v.original,t=v.term,purpose=v.purpose
   const clocks=['originCreatedAt','sealedAt','acceptedObservedAt','evidenceReviewedAt','evidenceArchivedAt'].map(k=>parseSourceReceiptInstant(o[k]))
   const scopeMatches=groups.some(g=>{
    const own=g.segments,refs=own.filter(x=>x.tag==='RFF'&&segmentComposite(x,1,wire.una)[0]==='LI'),customers=own.filter(x=>x.tag==='NAD'&&segmentComposite(x,1,wire.una)[0]==='UD'),reasons=own.filter(x=>x.tag==='CCI'&&segmentComposite(x,2,wire.una)[0]==='Z13')
    if(refs.length!==1||customers.length!==1||reasons.length!==1)return false
    const ref=segmentComposite(refs[0],1,wire.una),customer=segmentComposite(customers[0],2,wire.una),cav=own[own.indexOf(reasons[0])+1]
    return cav?.tag==='CAV'&&isDeepStrictEqual(s,{lineIndex:g.lineIndex,objectId:g.itemId,identityAgency:g.identityAgency,lineItemReference:ref[1],customer:{id:customer[0],qualifier:customer[1]??'',agency:customer[2]},reason:segmentComposite(cav,1,wire.una)[0]})
   })
   return {recordShape:true,scopeShape:Number.isSafeInteger(s.lineIndex)&&Number(s.lineIndex)>=0&&text(s.objectId)&&['9','89'].includes(String(s.identityAgency))&&text(s.lineItemReference)&&text(c.id)&&text(c.qualifier,true)&&text(c.agency)&&['S17','S18'].includes(String(s.reason)),scopeMatches,
    classificationKnown:['private','nonprivate'].includes(String(v.classification)),originalUuids:['messageId','originIntentId','assignmentId','permissionId','acceptedAttemptId','evidenceId'].every(k=>isEvidenceUuid(o[k])),
    originalHashes:hash(o.payloadHash)&&hash(o.evidenceSha256),scopeVersion:Number.isSafeInteger(o.scopeBasisVersion)&&Number(o.scopeBasisVersion)>=1,evidenceVersionText:text(o.evidenceVersion),
    clocksParse:clocks.map(x=>x!==null),clocksBeforeReceive:received!==null&&clocks.every(x=>x!==null&&x<=received),
    originBeforeSeal:clocks[0]!==null&&clocks[1]!==null&&clocks[0]<=clocks[1],sealBeforeAccepted:clocks[1]!==null&&clocks[2]!==null&&clocks[1]<=clocks[2],archiveBeforeReview:clocks[4]!==null&&clocks[3]!==null&&clocks[4]<=clocks[3],reviewBeforeOrigin:clocks[3]!==null&&clocks[0]!==null&&clocks[3]<=clocks[0],
    termShape:t.kind==='indefinite'||t.kind==='bounded'&&typeof t.endMinute==='string'&&isProdatCalendarMinute(t.endMinute),purposeShape:purpose.kind==='absent'||purpose.kind==='present'&&['B71','B72','B73','B74','B75','B76'].includes(String(purpose.code))}
  }):[]
 }catch(error){output.diagnosticError={name:error instanceof Error?digest(error.name):digest(typeof error),message:safe(error instanceof Error?error.message:error)}}
 finally{
  try{
   const after=await getEdielMessageById(source.id),protectedAfter=protectedIdentity(),marketAfter=digest(z14Market(p)).sha256
   output.diagnosticSourceUnchanged=sourceBefore===undefined||!after?null:sourceBefore===sourceIdentity(after)
   output.diagnosticProtectedSourceUnchanged=protectedBefore===undefined||protectedBefore===null||protectedAfter===null?null:protectedBefore===protectedAfter
   output.diagnosticMarketUnchanged=marketBefore===undefined?null:marketBefore===marketAfter
  }catch(error){output.nonmutationObservationError=safe(error instanceof Error?error.message:error)}
  output.finishedAt=Date.now();console.info('Z14 post-processing reporting READ diagnostics',JSON.stringify(output))
 }
}
function observedPositiveReplies(p:PendingZ14,source:EdielMessageRow,expectedPoint=p.f.point){
 const actual=replies(p,source),wire=tokenizeEdifact(source.raw_payload!),envelope=EdifactEnvelopeCodec.decode(source.raw_payload!)
 const line=wire.segments.find(s=>s.tag==='LIN')!,li=wire.segments.find(s=>s.tag==='RFF'&&segmentComposite(s,1,wire.una)[0]==='LI')!
 for(const ack of actual.acks){
  expect(ack).toMatchObject({company_id:p.f.ids.company,environment:'test',direction:'outbound',related_message_id:source.id,ack_outcome:'positive'})
  expect(validateEdifactEnvelope(ack.raw_payload!).syntaxOk).toBe(true)
  const physical=EdifactEnvelopeCodec.decode(ack.raw_payload!),correlation=readPhysicalAckSourceCorrelation(ack,source)
  expect([physical.sender,physical.receiver]).toEqual([envelope.receiver,envelope.sender]);expect(correlation.classification.outcome).toBe('positive')
  if(ack.message_family==='CONTRL'){
   expect(envelope.interchangeReference).toHaveLength(20)
   expect(correlation.acknowledgedReferences).toEqual([envelope.interchangeReference!.slice(0,14)])
  }
  else{
   expect(ack.route_profile_id).toBe(p.f.ids.ackProfile)
   expect(correlation.lookupReferences).toContainEqual({type:'BGM_REF',value:segmentComposite(wire.segments.find(s=>s.tag==='BGM'),2,wire.una)[0]})
   expect(correlation.prodatObjectOutcomes).toEqual([{objectId:expectedPoint,identityAgency:'9',firstLineIndex:line.index,lineItemReference:segmentComposite(li,1,wire.una)[1],outcome:'positive'}])
   const parsed=tokenizeEdifact(ack.raw_payload!)
   expect(parsed.segments.filter(s=>s.tag==='ERC').map(s=>segmentComposite(s,1,parsed.una)[0])).toEqual(['100'])
  }
  expect(actual.outbox.filter(x=>x.ediel_message_id===ack.id)).toEqual([expect.objectContaining({company_id:p.f.ids.company,environment:'test',source_message_id:source.id,message_family:ack.message_family,ack_outcome:'positive'})])
 }
 return actual
}
async function committedReplies(p:PendingZ14,source:EdielMessageRow,expectedPoint=p.f.point){
 const diagnostic=JSON.stringify(ackEvidence(p,source))
 console.info('Z14 final ACK evidence',diagnostic)
 const actual=observedPositiveReplies(p,source,expectedPoint)
 expect(actual.acks.map(a=>a.message_family),diagnostic).toEqual(['APERAK','CONTRL']);expect(actual.outbox,diagnostic).toHaveLength(2)
 const line=tokenizeEdifact(source.raw_payload!).segments.find(s=>s.tag==='LIN')!
 const plan=await readReceivedProdatFinalResponsePlan({companyId:p.f.ids.company,sourceMessageId:source.id,rawPayload:source.raw_payload!})
 expect(plan?.plans).toHaveLength(1);expect(plan!.plans[0]).toMatchObject({effectKind:'metering_permission',outcome:'positive',objectLineIndices:[line.index]})
 expect(sql(`SELECT jsonb_build_object('source',source_message_id,'company',company_id,'hash',payload_hash,'canonical',canonical_assessment_id) FROM gridex_received_sources.permission_effect_receipts WHERE id=${lit(plan!.plans[0].effectReceiptId)}`)).toEqual({source:source.id,company:p.f.ids.company,hash:createHash('sha256').update(source.raw_payload!).digest('hex'),canonical:plan!.plans[0].canonicalAssessmentId})
 return actual
}
async function firstPositive(p:PendingZ14,options:{change?:Record<string,unknown>;expectedPoint?:string;expectedStart?:string;afterBirth?:()=>void}={}){
 const expectedPoint=options.expectedPoint??p.f.point,expectedStart=options.expectedStart??p.f.fields.data_start
 const raw=z14Wire(p,options.change),physical=tokenizeEdifact(raw),original=(await getEdielMessageById(p.z13.id))!
 expect(original).toMatchObject({id:p.z13.id,company_id:p.f.ids.company,customer_id:p.f.ids.customer,direction:'outbound',environment:'test',message_family:'PRODAT',message_code:'Z13',status:'sent'})
 expect(original.raw_payload).toBe(p.z13.raw_payload)
 const sealed=sql<{renderedAt:string;hash:string}>(`SELECT jsonb_build_object('renderedAt',immutable_rendered_at,'hash',immutable_payload_hash) FROM public.ediel_messages WHERE company_id=${lit(p.f.ids.company)} AND id=${lit(original.id)}`)
 expect(sealed.renderedAt).not.toBeNull();expect(sealed.hash).toBe(createHash('sha256').update(original.raw_payload!).digest('hex'))
 const sent=tokenizeEdifact(original.raw_payload!),sentEnvelope=EdifactEnvelopeCodec.decode(original.raw_payload!)
 expect([sentEnvelope.sender,sentEnvelope.receiver]).toEqual([p.f.sender,p.f.receiver])
 expect(segmentComposite(sent.segments.find(s=>s.tag==='LIN'),1,sent.una)).toEqual(['1'])
 expect(segmentComposite(sent.segments.find(s=>s.tag==='LIN'),3,sent.una).some(Boolean)).toBe(false)
 const party=(wire:ReturnType<typeof tokenizeEdifact>,qualifier:string)=>segmentComposite(wire.segments.find(s=>s.tag==='NAD'&&segmentComposite(s,1,wire.una)[0]===qualifier),2,wire.una)
 expect(party(sent,'UD')).toEqual(['199001011234','SE2','260']);expect(party(physical,'UD')).toEqual(party(sent,'UD'))
 expect(party(sent,'FR')).toEqual([p.f.sender,'160','SVK']);expect(party(sent,'DO')).toEqual([p.f.receiver,'160','SVK'])
 expect(party(physical,'FR')).toEqual(party(sent,'DO'));expect(party(physical,'DO')).toEqual(party(sent,'FR'))
 const characteristic=(wire:ReturnType<typeof tokenizeEdifact>,qualifier:string)=>segmentComposite(wire.segments[wire.segments.findIndex(s=>s.tag==='CCI'&&segmentComposite(s,2,wire.una)[0]===qualifier)+1],1,wire.una)[0]
 expect(characteristic(sent,'Z13')).toBe('S17');expect(characteristic(physical,'Z13')).toBe('S17')
 expect(characteristic(sent,'Z24')).toBe('B72');expect(characteristic(physical,'Z24')).toBe('B72')
 const ownLi=(wire:ReturnType<typeof tokenizeEdifact>)=>segmentComposite(wire.segments.find(s=>s.tag==='RFF'&&segmentComposite(s,1,wire.una)[0]==='LI'),1,wire.una)[1]
 expect(ownLi(sent)).toBe(String(z14Market(p).permission.rff_li_reference));expect(ownLi(physical)).toBe(ownLi(sent))
 expect(segmentComposite(physical.segments.find(s=>s.tag==='LIN'),3,physical.una)).toEqual([expectedPoint,'','','9'])
 expect(segmentComposite(physical.segments.find(s=>s.tag==='DTM'&&segmentComposite(s,1,physical.una)[0]==='90'),1,physical.una)).toEqual(['90',prodatDate203(expectedStart),'203'])
 // Every independent omission must actually change the positive baseline.
 for(const field of z14RequiredFields)expect(omitZ14Field(raw,field),field).not.toBe(raw)
 if(p.bounded)expect(omitZ14Field(raw,'321')).not.toBe(raw)
 const before=z14Market(p),source=await receiveZ14(p,raw)
 const assignment=before.assignments.find(a=>a.id===p.f.assignment)!
 expect(assignment).toMatchObject({object_ids:['735999260731000007'],product_ids:[p.f.product],mode:'V'})
 expect(Date.parse(String(assignment.data_start))).toBe(Date.parse('2026-06-01T00:00:00Z'))
 expect(z14Market(p)).toEqual(before);expect(replies(p,source)).toEqual({acks:[],outbox:[]})
 options.afterBirth?.()
 // This is the FIRST domain/validation invocation. No fixture prefix applies
 // permission, records accepted validation or captures a passing private facet.
 await process(p,source)
 console.info('Z14 first-processing canonical lineage',JSON.stringify(canonicalLineageEvidence(p,source)))
 await reportingReadEvidence(p,source)
 const after=z14Market(p)
 expect(after.permission).toMatchObject({status:'active',source_z14_message_id:source.id,inbound_z14_message_id:source.id})
 expect(after.permission.metadata).toMatchObject({marketPermission:{mode:'S17',legalActor:p.f.sender,dsoActor:p.f.receiver,sourceZ14:source.id,objects:expect.arrayContaining([expect.objectContaining({point:expectedPoint,product:p.f.product,status:'A74'})])}})
 expect(await currentAssignment(p.f)).toMatchObject({mode:'V'})
 expect(Number(after.permission.market_state_version)).toBe(Number(before.permission.market_state_version)+1)
 expect(after.sites).toHaveLength(1);expect(after.sites[0]).toMatchObject({customer_id:p.f.ids.customer,facility_id:expectedPoint,status:'approved'})
 expect(after.sites[0].metadata).toMatchObject({source:'inbound_prodat_z14',edielMessageId:source.id,mode:'S17',product:p.f.product})
 expect(Date.parse(String(after.sites[0].start_at))).toBe(Date.parse(expectedStart))
 expect(after.sites[0].end_at===null).toBe(!p.bounded)
 if(p.bounded)expect(Date.parse(String(after.sites[0].end_at))).toBe(Date.parse(p.f.fields.data_end!))
 expect(after.permission.permission_id).toBe('SYNTHETIC-PERMISSION-'+p.permissionId.slice(0,8))
 expect(after.permission.rff_li_reference).toBe(before.permission.rff_li_reference)
 expect(after.grants).toEqual([]);expect(after.supply).toEqual(before.supply)
 expect(after.assignments).toEqual(before.assignments);expect(after.links).toEqual(before.links)
 expect(after.receipts).toHaveLength(1)
 expect(after.receipts[0]).toMatchObject({source_message_id:source.id,qualified_original_message_id:p.z13.id,permission_id:p.permissionId,company_id:p.f.ids.company})
 expect(sql(`SELECT jsonb_build_object('source',source_message_id,'hash',payload_hash,'result',result) FROM gridex_received_sources.permission_partition_receipts WHERE company_id=${lit(p.f.ids.company)} AND source_message_id=${lit(source.id)}`)).toMatchObject({source:source.id,hash:createHash('sha256').update(raw).digest('hex'),result:{applied:true}})
 console.info('Z14 first-processing ACK evidence',JSON.stringify(ackEvidence(p,source)))
 const acks=observedPositiveReplies(p,source,expectedPoint)
 expect((await getEdielMessageById(source.id))?.raw_payload).toBe(raw)
 await process(p,source)
 console.info('Z14 replay canonical lineage',JSON.stringify(canonicalLineageEvidence(p,source)))
 console.info('Z14 replay ACK evidence',JSON.stringify(ackEvidence(p,source)))
 expect(z14Market(p)).toEqual(after);expect(observedPositiveReplies(p,source,expectedPoint)).toEqual(acks)
 expect((await getEdielMessageById(source.id))?.raw_payload).toBe(raw)
 expect((await getEdielMessageById(original.id))?.raw_payload).toBe(original.raw_payload)
 expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${lit(p.f.ids.company)} AND message_code='Z04'`)).toBe(0)
 return source
}
function currentScope(p:PendingZ14,source:EdielMessageRow,assignmentMatches=true){
 const actual=sql(`SELECT jsonb_build_object('sourceCurrent',public.ediel_permission_source_is_current_v1(a.company_id,mp.id,${lit(source.id)}),'assignmentMatches',gridex_service_administration.permission_matches_assignment_v1(a,mp),'assessment',public.ediel_service_assignment_assessment_v1(a.company_id,a.id)) FROM public.ediel_service_assignments a JOIN public.metering_permissions mp ON mp.company_id=a.company_id AND mp.id=${lit(p.permissionId)} WHERE a.company_id=${lit(p.f.ids.company)} AND a.id=${lit(p.f.assignment)}`)
 expect(actual,JSON.stringify(actual)).toMatchObject({sourceCurrent:true,assignmentMatches,assessment:{status:'authorized'}})
}
async function createGrant(p:PendingZ14,change:Record<string,unknown>={}){
 const {f}=p,link=sql<string>(`SELECT to_jsonb(id) FROM public.ediel_assignment_permission_links WHERE company_id=${lit(f.ids.company)} AND assignment_id=${lit(f.assignment)} AND permission_id=${lit(p.permissionId)}`)
 return f.command({action:'create_grant',commandId:randomUUID(),assignmentId:f.assignment,expectedVersion:(await currentAssignment(f)).version,fields:{permission_link_id:link,object_ids:[f.point],product_ids:[f.product],fields:f.fields.field_sets,data_start:f.fields.data_start,data_end:f.fields.data_end,valid_from:f.fields.valid_from,valid_to:f.fields.valid_to,...change}})
}
async function publishGrant(p:PendingZ14,grant:Record<string,unknown>){
 return p.f.command({action:'publish_grant',commandId:randomUUID(),assignmentId:p.f.assignment,expectedVersion:(await currentAssignment(p.f)).version,grantId:grant.grantId,expectedGrantVersion:sql<number>(`SELECT to_jsonb(version) FROM public.ediel_data_access_grants WHERE company_id=${lit(p.f.ids.company)} AND id=${lit(grant.grantId)}`)})
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
 // Private323 is receiver knowledge: read the genuine protected source with
 // the actual actor; the public processor performs its own fresh READ below.
 const source=await receiveZ14(p,raw),decision=await resolveCanonicalRuntimeDecisionWithRegistry(source,field==='323'?{actorUserId:p.f.ids.actor}:{})
 if(field==='209')await expect(process(p,source)).rejects.toThrow(/^prodat_canonical_source_validation_unconfirmed$/)
 else await process(p,source)
 if(field==='323')await reportingReadEvidence(p,source)
 expect(z14Market(p)).toEqual(before);noPositiveObjectAck(p,source)
 expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify({field,issues:decision.issues})).not.toEqual(['accepted','accepted','accepted'])
 if(field==='233')expect(decision.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'UNSM_MANDATORY_ELEMENT_MISSING',layer:'syntax',severity:'error',description:'PRODAT:D:97A:UN: obligatoriskt NAD/C082/3039[1] saknas.'})]))
 else if(field==='209')expect(decision.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'PRODAT_REPORTING_PURPOSE_SCOPE_UNQUALIFIED',layer:'application',severity:'error',prodatDiagnostic:{kind:'internal',reason:'Supplied323 has no qualified own process/first object',sourceRule:'PRODAT26A:P21/74/119/123'}})]))
 else if(!['207','208','227','311','312'].includes(field))expect(decision.issues,field).toEqual(expect.arrayContaining([expect.objectContaining({prodatDiagnostic:expect.objectContaining({fieldNumber:field})})]))
})

it('fresh bounded V omits required 321 and cannot mutate the still-pending permission',async()=>{
 const p=await pendingZ14(true),before=z14Market(p),source=await receiveZ14(p,omitZ14Field(z14Wire(p),'321'))
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(source,{actorUserId:p.f.ids.actor})
 await process(p,source);await reportingReadEvidence(p,source);expect(z14Market(p)).toEqual(before);noPositiveObjectAck(p,source)
 expect(decision.issues).toEqual(expect.arrayContaining([expect.objectContaining({prodatDiagnostic:expect.objectContaining({fieldNumber:'321'})})]))
})

it.each([
 ['LI',{transactionReference:'UNRELATED-LI'}],['customer',{customerId:'198001011234'}],
 ['object',{meterPointId:'735999260731000014'}],['agency',{siteIdAgency:'89'}],
 ['purpose',{permissionPurpose:'B71'}],
 ['expanded start',{reportStartDate:'2026-05-01T00:00:00Z'}],
] as const)('fresh first-response %s obeys the original customer scope and independent grant boundary',async(name,change)=>{
 const p=await pendingZ14(),mutation:Record<string,unknown>=change
 if(['LI','customer','purpose'].includes(name)){
  const before=z14Market(p),source=await receiveZ14(p,z14Wire(p,change))
  await process(p,source);expect(z14Market(p)).toEqual(before);noPositiveObjectAck(p,source);return
 }
 // Preserve the exact original adverse mutant bytes. Customer-bound Z13 has
 // no physical point; NAD IT89 and a declared May start are lawful inputs.
 // Original RED artifacts remain adverse history, not waived native results.
 const outsider=await pendingZ14(),foreignBefore=z14Market(outsider)
 const expectedPoint=name==='object'?String(mutation.meterPointId):p.f.point
 const source=await firstPositive(p,{change,expectedPoint,expectedStart:name==='expanded start'?String(mutation.reportStartDate):undefined})
 expect(z14Market(outsider)).toEqual(foreignBefore)
 if(name==='object'||name==='expanded start'){
  const unchanged=z14Market(p)
  await expect(createGrant(p,name==='object'?{object_ids:[expectedPoint]}:{data_start:String(mutation.reportStartDate)}))
   .rejects.toMatchObject({message:'ediel_grant_scope_exceeds_assignment'})
  expect(z14Market(p)).toEqual(unchanged);expect(z14Market(outsider)).toEqual(foreignBefore)
  currentScope(p,source)
  const grant=await createGrant(p);expect(grant).toMatchObject({status:'held',accessGranted:false})
  if(name==='object'){
   const stable=z14Market(p)
   expect(await publishGrant(p,grant)).toMatchObject({status:'held',missing:['explicit_approved_object_product_period']})
   expect(z14Market(p)).toEqual(stable);expect(z14Market(p).grants.every(g=>g.status!=='active')).toBe(true)
  }else await proveConsumer(p,source,outsider,foreignBefore,{grant,preJune:true})
 }else{
  const wire=tokenizeEdifact(source.raw_payload!)
  expect(segmentComposite(wire.segments.find(s=>s.tag==='NAD'&&segmentComposite(s,1,wire.una)[0]==='IT'),2,wire.una)[2]).toBe('89')
  expect(segmentComposite(wire.segments.find(s=>s.tag==='LIN'),3,wire.una)[3]).toBe('9')
  // A separate fresh mailbox source changes ONLY the actual LIN agency.
  const invalid=await pendingZ14(),raw=z14Wire(invalid),physical=tokenizeEdifact(raw)
  const segments=physical.segments.map(s=>s.tag==='LIN'?s.raw.replace(':::9',':::ZZ'):s.raw)
  const changed=serializeUna(physical.una)+segments.join(physical.una.segmentTerminator)+physical.una.segmentTerminator
  const bad=tokenizeEdifact(changed)
  expect(changed).not.toBe(raw);expect(segmentComposite(bad.segments.find(s=>s.tag==='LIN'),3,bad.una)).toEqual([invalid.f.point,'','','ZZ'])
  expect(bad.segments.filter(s=>s.tag!=='LIN').map(s=>s.raw)).toEqual(physical.segments.filter(s=>s.tag!=='LIN').map(s=>s.raw))
  const before=z14Market(invalid),rejected=await receiveZ14(invalid,changed),decision=await resolveCanonicalRuntimeDecisionWithRegistry(rejected,{actorUserId:invalid.f.ids.actor})
  expect(decision.applicationDecision).toBe('rejected')
  expect(decision.issues).toContainEqual(expect.objectContaining({layer:'application',severity:'error',prodatDiagnostic:expect.objectContaining({kind:'field',fieldNumber:'209',errorKind:'invalid'})}))
  await expect(process(invalid,rejected)).rejects.toThrow(/^prodat_canonical_source_validation_unconfirmed$/);expect(z14Market(invalid)).toEqual(before);noPositiveObjectAck(invalid,rejected)
 }
 expect(z14Market(outsider)).toEqual(foreignBefore)
 await committedReplies(p,source,expectedPoint)
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

it('DSO platform-flag control preserves born permission, while current verified identity gates public grant publication',async()=>{
 const p=await pendingZ14(),outsider=await pendingZ14(),foreignBefore=z14Market(outsider)
 const source=await firstPositive(p,{afterBirth:()=>sql(`UPDATE public.platform_actor_roles SET is_active=false WHERE actor_id=${lit(p.f.ids.dso)} AND actor_role='grid_owner'`)})
 expect(sql(`SELECT to_jsonb(is_active) FROM public.platform_actor_roles WHERE actor_id=${lit(p.f.ids.dso)} AND actor_role='grid_owner'`)).toBe(false)
 currentScope(p,source)
 const grant=await createGrant(p);expect(grant).toMatchObject({status:'held',accessGranted:false})
 const stable=z14Market(p),acks=replies(p,source)
 const identifier=sql<string>(`UPDATE public.platform_actor_identifiers SET is_verified=false WHERE actor_id=${lit(p.f.ids.dso)} AND identifier_type='EdielId' AND identifier_value=${lit(p.f.receiver)} RETURNING to_jsonb(id)`)
 expect(identifier).toMatch(/^[0-9a-f-]{36}$/);currentScope(p,source,false)
 expect(await publishGrant(p,grant)).toMatchObject({status:'held',missing:['current_source_approved_market_permission']})
 expect(z14Market(p)).toEqual(stable);expect(replies(p,source)).toEqual(acks);expect(z14Market(outsider)).toEqual(foreignBefore)
 expect(z14Market(p).grants.every(g=>g.status!=='active')).toBe(true)
 expect(sql(`UPDATE public.platform_actor_identifiers SET is_verified=true WHERE id=${lit(identifier)} AND actor_id=${lit(p.f.ids.dso)} AND identifier_type='EdielId' AND identifier_value=${lit(p.f.receiver)} RETURNING to_jsonb(id)`)).toBe(identifier)
 expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.platform_actor_identifiers WHERE actor_id=${lit(p.f.ids.dso)} AND identifier_type='EdielId' AND is_verified`)).toBe(1)
 currentScope(p,source)
 await proveConsumer(p,source,outsider,foreignBefore,{grant})
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

async function proveConsumer(p:PendingZ14,source:EdielMessageRow,outsider:PendingZ14,foreignBefore:ReturnType<typeof z14Market>,options:{grant?:Record<string,unknown>;preJune?:boolean}={}){
 const {f}=p
 expect(outsider.f.point).toBe(f.point);expect(foreignBefore.permission.id).toBe(outsider.permissionId)
 expect(z14Market(outsider)).toEqual(foreignBefore);currentScope(p,source)
 const grant=options.grant??await createGrant(p)
 expect(grant).toMatchObject({status:'held',accessGranted:false})
 const published=await publishGrant(p,grant)
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
 if(options.preJune){
  // Actual fixture measurements are July; the live grant starts in June.
  expect(Date.parse(series.start)).toBeGreaterThanOrEqual(Date.parse(f.fields.data_start))
  await expect(projectEdielSeriesToBeneficiary({...request,startInclusive:'2026-05-01T00:00:00Z'}))
   .rejects.toMatchObject({message:'ediel_projection_outside_grant'})
  expect(stable()).toEqual(upstream)
 }
 for(const change of [{purpose:'ungranted billing'},{fields:['secret'] as never},{startInclusive:'1990-01-01T00:00:00Z'},{endExclusive:'2099-01-01T00:00:00Z'},{expectedGrantVersion:request.expectedGrantVersion+1},{actorUserId:f.ids.reviewer},{beneficiaryCompanyId:outsider.f.ids.company}]){
  await expect(projectEdielSeriesToBeneficiary({...request,...change})).rejects.toBeDefined();expect(stable()).toEqual(upstream)
 }
 expect(await projectEdielSeriesToBeneficiary(request)).toEqual(page)
 expect(await f.command({action:'revoke_grant',commandId:randomUUID(),assignmentId:f.assignment,expectedVersion:(await currentAssignment(f)).version,grantId:grant.grantId,expectedGrantVersion:request.expectedGrantVersion})).toMatchObject({status:'revoked'})
 await expect(projectEdielSeriesToBeneficiary({...request,expectedGrantVersion:sql<number>(`SELECT to_jsonb(version) FROM public.ediel_data_access_grants WHERE id=${lit(grant.grantId)}`)})).rejects.toBeDefined()
 await expect(incoming.persist()).rejects.toBeDefined();await expect(assertUtiltsPositiveAckAuthorityForSend(ack)).rejects.toBeDefined()
 expect(stable()).toEqual(upstream);expect(z14Market(outsider)).toEqual(foreignBefore)
 await committedReplies(p,source)
}
it('actual Z14 permission still grants no access: separate public publication, genuine E66 storage/ACK, scoped projection, and refreshed revocation',async()=>{
 const p=await pendingZ14(),outsider=await pendingZ14(),foreignBefore=z14Market(outsider)
 const source=await firstPositive(p)
 await proveConsumer(p,source,outsider,foreignBefore)
})
