// Proposed actual native evidence for AT-Z15C-ESCO / AT-Z18V-ESCO.
// These references do not promote coverage. Complete contract approval also
// needs the frozen negative/field matrix and reviewed, executed receipts.
// Only upstream legal/issuer/mail input and SMTP provider are synthetic.
import {createHash,randomUUID} from 'node:crypto'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {seedNativeEscoFixture as seed,qualifyNativeEscoFixture as qualify,resetNativeEscoFixture,nativeEscoSql as sql,nativeEscoLiteral as lit,nativeEscoExternal} from './fixtures/ediel-service-evidence-native'
import {seedOriginalMailboxNative,recordOriginalMailboxNativeReception} from './helpers/originalMailboxNative'
import {renderProdat} from '@/lib/ediel/prodatEngine'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {readReceivedProdatFinalResponsePlan} from '@/lib/ediel/core/receivedProdatFinalResponsePlan'
import {readPhysicalAckSourceCorrelation} from '@/lib/ediel/ack/sourceCorrelation'
import {validateEdifactEnvelope} from '@/lib/ediel/core/edifactValidation'
import {edielSmtpConfig} from '@/lib/ediel/mailReadiness'
import {sendEdielMessageViaSmtp} from '@/lib/ediel/transport'
import {getEdielMessageById} from '@/lib/ediel/db'
import {buildContrlDraft,buildAperakDraft} from '@/lib/ediel/ack'
import {readCommittedInboundAck} from '@/lib/ediel/ack/committedInboundAck'
import {prodatDate203} from '@/lib/ediel/prodat/render/dates'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {executeEdielServiceAdministration} from '@/lib/ediel/services/administration'
import {applyPermissionMarketSource} from '@/lib/ediel/permissions/permissionMarketTransition'
import {omitPermissionField,permissionRequiredFields} from './helpers/ediel-permission-field-omissions'
import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {buildReceivedSourceValidationEvidence} from '@/lib/ediel/core/receivedSourceValidationEvidence'
import {supabaseService} from '@/lib/supabase/service'
import type {EdielMessageRow} from '@/lib/ediel/types'

beforeEach(resetNativeEscoFixture)
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks()})
type Fixture=Awaited<ReturnType<typeof seed>>
type Authority=Awaited<ReturnType<typeof qualify>>
const end='2026-09-01T00:00:00Z'

function ackRoute(f:Fixture){
 const smtp=edielSmtpConfig()
 // These permission scenarios do not consume E66. Each communication route
 // has one runtime profile; two profiles make its actual maybeSingle read fail.
 expect(sql(`UPDATE public.ediel_route_profiles SET application_reference=${lit(f.app)},route_name='Synthetic DGI PRODAT ACK',mailbox=${lit(smtp.from)},smtp_host=${lit(smtp.host)},smtp_port=${lit(smtp.port)} WHERE id=${lit(f.ids.ackProfile)} AND company_id=${lit(f.ids.company)} AND communication_route_id=${lit(f.ids.ackRoute)} RETURNING to_jsonb(id)`)).toBe(f.ids.ackProfile)
 return f.ids.ackProfile
}
async function receive(f:Fixture,raw:string,family:'PRODAT'|'CONTRL'|'APERAK',code:string,profile?:string){
 const mail=await seedOriginalMailboxNative(sql,lit,{companyId:f.ids.company,environment:'test',raw,smtpFrom:edielSmtpConfig().from,senderEmail:'dso-native@example.invalid'})
 // A missing BGM cannot be born as a caller-labelled Z15. Keep the actual
 // parser's unknown code and let the national header owner reject its bytes.
 const observedCode=mail.parsed.messageCode??code
 const source=await f.insert(raw,family,observedCode,observedCode===code?profile:undefined,mail)
 await recordOriginalMailboxNativeReception({companyId:f.ids.company,sourceMessageId:source.id,actorUserId:f.ids.actor,inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId,sourcePayloadHash:mail.sourcePayloadHash})
 return source
}
function market(f:Fixture,permissionId:string){
 return sql<{permission:Record<string,unknown>;sites:Record<string,unknown>[];grants:Record<string,unknown>[];receipts:number;transitions:number}>(`SELECT jsonb_build_object(
 'permission',(SELECT to_jsonb(p) FROM public.metering_permissions p WHERE company_id=${lit(f.ids.company)} AND id=${lit(permissionId)}),
 'sites',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.metering_permission_sites s WHERE company_id=${lit(f.ids.company)} AND metering_permission_id=${lit(permissionId)}),
 'grants',(SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY g.id),'[]') FROM public.ediel_data_access_grants g WHERE company_id=${lit(f.ids.company)}),
 'receipts',(SELECT count(*) FROM gridex_received_sources.permission_effect_receipts WHERE company_id=${lit(f.ids.company)}),
 'transitions',(SELECT count(*) FROM gridex_received_sources.permission_effect_transitions_v1 WHERE company_id=${lit(f.ids.company)}))`)
}
function z15(f:Fixture,a:Authority,cancel:boolean,change:Record<string,unknown>={}){
 const permission=market(f,a.permissionId).permission
 const rendered=renderProdat({code:'Z15',variant:cancel?'C':'V',mode:'test',actor:{senderEdielId:f.receiver,receiverEdielId:f.sender},route:{applicationReference:f.app},version:{selectedVersion:'E2SE6A',messageTypeToken:'PRODAT:D:97A:UN:E2SE6A'},context:{code:'Z15',bgmReference:randomUUID().replaceAll('-','').slice(0,20),transactionReference:String(permission.rff_li_reference),senderEdielId:f.receiver,receiverEdielId:f.sender,legalSenderId:f.receiver,legalReceiverId:f.sender,customerName:'Synthetic Customer',customerId:'199001011234',customerIdCodeListQualifier:'SE2',customerIdAgency:'260',customerCountry:'SE',meterPointId:f.point,siteIdAgency:'9',gridAreaId:'TES',reasonForTransaction:cancel?'Z24':'S17',permissionStatus:'A74',permissionId:String(permission.permission_id),permissionEndDate:end,permissionEndReason:cancel?'E37':'B79',...change}})
 expect(rendered.issues.filter(x=>x.severity==='error'&&!/_UNDETERMINED$/.test(x.code)),JSON.stringify(rendered.issues)).toEqual([])
 return EdifactEnvelopeCodec.encode({sender:f.receiver,receiver:f.sender,applicationReference:f.app,interchangeReference:randomUUID().replaceAll('-','').slice(0,14),environment:'test',acknowledgementRequest:true,messages:[{messageReference:'1',messageTypeToken:'PRODAT:D:97A:UN:E2SE6A',businessSegments:rendered.segments}]})
}
async function process(f:Fixture,source:EdielMessageRow){
 await processInboundEdielMessage({actorUserId:f.ids.actor,edielMessageId:source.id})
 const actual=await getEdielMessageById(source.id)
 expect(actual?.raw_payload).toBe(source.raw_payload)
 return actual!
}
async function ownAcks(f:Fixture,source:EdielMessageRow,profile:string){
 const actual=sql<{acks:EdielMessageRow[];outbox:Record<string,unknown>[]}>(`SELECT jsonb_build_object(
 'acks',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.message_family),'[]') FROM public.ediel_messages a WHERE company_id=${lit(f.ids.company)} AND related_message_id=${lit(source.id)} AND direction='outbound'),
 'outbox',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.id),'[]') FROM public.ediel_outbox o WHERE company_id=${lit(f.ids.company)} AND source_message_id=${lit(source.id)}))`)
 const diagnostics=sql(`SELECT jsonb_build_object('events',(SELECT coalesce(jsonb_agg(jsonb_build_object('message',message,'status',event_status)),'[]') FROM public.ediel_message_events WHERE company_id=${lit(f.ids.company)} AND ediel_message_id=${lit(source.id)}),'permissionPartition',(SELECT result FROM gridex_received_sources.permission_partition_receipts WHERE company_id=${lit(f.ids.company)} AND source_message_id=${lit(source.id)}))`)
 expect(actual.acks.map(a=>a.message_family),JSON.stringify(diagnostics)).toEqual(['APERAK','CONTRL'])
 const envelope=EdifactEnvelopeCodec.decode(source.raw_payload!)
 const wire=tokenizeEdifact(source.raw_payload!),line=wire.segments.find(s=>s.tag==='LIN')!,li=wire.segments.find(s=>s.tag==='RFF'&&segmentComposite(s,1,wire.una)[0]==='LI')!
 for(const ack of actual.acks){
  expect(ack).toMatchObject({company_id:f.ids.company,environment:'test',direction:'outbound',related_message_id:source.id,ack_outcome:'positive'})
  expect(validateEdifactEnvelope(ack.raw_payload!).syntaxOk).toBe(true)
  const ackEnvelope=EdifactEnvelopeCodec.decode(ack.raw_payload!)
  expect([ackEnvelope.sender,ackEnvelope.receiver]).toEqual([envelope.receiver,envelope.sender])
  const correlation=readPhysicalAckSourceCorrelation(ack,source)
  expect(correlation.classification.outcome).toBe('positive')
  if(ack.message_family==='CONTRL')expect(correlation.acknowledgedReferences).toEqual([envelope.interchangeReference])
  else{
   expect(ack.route_profile_id).toBe(profile)
   const document=segmentComposite(wire.segments.find(s=>s.tag==='BGM'),2,wire.una)[0]
   expect(correlation.lookupReferences).toContainEqual({type:'BGM_REF',value:document})
   expect(correlation.prodatObjectOutcomes).toEqual([{objectId:f.point,identityAgency:'9',firstLineIndex:line.index,lineItemReference:segmentComposite(li,1,wire.una)[1],outcome:'positive'}])
   const physical=tokenizeEdifact(ack.raw_payload!)
   expect(physical.segments.filter(s=>s.tag==='ERC').map(s=>segmentComposite(s,1,physical.una)[0])).toEqual(['100'])
  }
  const entries=actual.outbox.filter(o=>o.ediel_message_id===ack.id)
  expect(entries).toHaveLength(1)
  expect(entries[0]).toMatchObject({company_id:f.ids.company,environment:'test',source_message_id:source.id,message_family:ack.message_family,ack_outcome:'positive'})
 }
 expect(actual.outbox).toHaveLength(2)
 const plan=await readReceivedProdatFinalResponsePlan({companyId:f.ids.company,sourceMessageId:source.id,rawPayload:source.raw_payload!})
 expect(plan?.plans).toHaveLength(1)
 expect(plan!.plans[0]).toMatchObject({effectKind:'metering_permission',outcome:'positive',objectLineIndices:[line.index]})
 expect(plan!.plans[0].effectReceiptId).toMatch(/^[0-9a-f-]{36}$/)
 expect(sql(`SELECT jsonb_build_object('source',source_message_id,'company',company_id,'hash',payload_hash,'canonical',canonical_assessment_id) FROM gridex_received_sources.permission_effect_receipts WHERE id=${lit(plan!.plans[0].effectReceiptId)}`)).toEqual({source:source.id,company:f.ids.company,hash:createHash('sha256').update(source.raw_payload!).digest('hex'),canonical:plan!.plans[0].canonicalAssessmentId})
 return actual
}
function z18Count(f:Fixture){return sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${lit(f.ids.company)} AND message_code='Z18'`)}

it('unsolicited received Z15 then exact Z15C restores only its market permission, with genuine own ACKs and a still-revoked grant',async()=>{
 const f=await seed(),a=await qualify(f),profile=ackRoute(f)
 const grantVersion=sql<number>(`SELECT to_jsonb(version) FROM public.ediel_data_access_grants WHERE id=${lit(a.grantId)}`)
 expect(await f.command({action:'revoke_grant',commandId:randomUUID(),assignmentId:f.assignment,expectedVersion:f.current().version,grantId:a.grantId,expectedGrantVersion:grantVersion})).toMatchObject({status:'revoked'})
 const before=market(f,a.permissionId)
 expect(before.permission.status).toBe('active');expect(before.grants.find(g=>g.id===a.grantId)?.status).toBe('revoked')
 const ended=await receive(f,z15(f,a,false),'PRODAT','Z15','PRODAT:Z15:V:26.A:r3')
 await process(f,ended);await ownAcks(f,ended,profile)
 expect(market(f,a.permissionId).permission.status).toBe('ended');expect(z18Count(f)).toBe(0)
 const cancellation=await receive(f,z15(f,a,true),'PRODAT','Z15','PRODAT:Z15:C:26.A:r3')
 await process(f,cancellation);const acks=await ownAcks(f,cancellation,profile)
 const restored=market(f,a.permissionId)
 expect(restored.permission.status).toBe('active')
 expect(restored.sites.map(({updated_at,...s})=>s)).toEqual(before.sites.map(({updated_at,...s})=>s))
 expect(restored.grants).toEqual(before.grants);expect(z18Count(f)).toBe(0)
 await process(f,cancellation)
 expect(market(f,a.permissionId)).toEqual(restored)
 expect(await ownAcks(f,cancellation,profile)).toEqual(acks)
 const revoked=restored.grants.find(g=>g.id===a.grantId)!
 await expect(f.command({action:'publish_grant',commandId:randomUUID(),assignmentId:f.assignment,expectedVersion:f.current().version,grantId:a.grantId,expectedGrantVersion:revoked.version})).rejects.toThrow(/revoked_grant_requires_new_basis/)
 expect(market(f,a.permissionId).grants).toEqual(before.grants)
})

it.each([
 ['LI',{transactionReference:'NO-PRIOR-LI'}],
 ['Z09',{permissionId:'NO-PRIOR-PERMISSION'}],
 ['object',{meterPointId:'735999260731000014'}],
 ['DTM164',{permissionEndDate:'2026-09-02T00:00:00Z'}],
] as const)('Z15C foreign %s cannot restore the real ended permission or emit positive APERAK',async(_name,change)=>{
 const f=await seed(),a=await qualify(f);ackRoute(f)
 const ended=await receive(f,z15(f,a,false),'PRODAT','Z15','PRODAT:Z15:V:26.A:r3');await process(f,ended)
 const before=market(f,a.permissionId);expect(before.permission.status).toBe('ended')
 const source=await receive(f,z15(f,a,true,change),'PRODAT','Z15','PRODAT:Z15:C:26.A:r3');await process(f,source)
 expect(market(f,a.permissionId)).toEqual(before)
 expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${lit(f.ids.company)} AND related_message_id=${lit(source.id)} AND message_family='APERAK' AND ack_outcome='positive'`)).toBe(0)
 expect(z18Count(f)).toBe(0)
})

it('every required common/own/UD Z15C omission reaches its actual syntax/guide/field barrier without market, grant or positive APERAK effects',async()=>{
 const f=await seed(),a=await qualify(f);ackRoute(f)
 const ended=await receive(f,z15(f,a,false),'PRODAT','Z15','PRODAT:Z15:V:26.A:r3');await process(f,ended)
 const before=market(f,a.permissionId);expect(before.permission.status).toBe('ended')
 const processingFailures:string[]=[]
 for(const field of permissionRequiredFields){
  if(field==='202'){
   // A physical message without BGM code has no selectable guide. The actual
   // parser calls it PRODAT_UNKNOWN and native canonical birth refuses it;
   // never invent a Z15 row/profile to reach a later business consumer.
   const effects=f.effects(),sends=nativeEscoExternal.send.mock.calls.length
   await expect(receive(f,omitPermissionField(z15(f,a,true),field),'PRODAT','Z15','PRODAT:Z15:C:26.A:r3')).rejects.toThrow(/canonical_inbound_rule_profile_resolution_failed:PRODAT:PRODAT_UNKNOWN:/)
   expect(market(f,a.permissionId)).toEqual(before);expect(f.effects()).toEqual(effects)
   expect(nativeEscoExternal.send).toHaveBeenCalledTimes(sends)
   continue
  }
  const source=await receive(f,omitPermissionField(z15(f,a,true),field),'PRODAT','Z15','PRODAT:Z15:C:26.A:r3').catch(error=>{throw new Error(`required Z15C field ${field}: ${error instanceof Error?error.message:JSON.stringify(error)}`,{cause:error})})
  const decision=await resolveCanonicalRuntimeDecisionWithRegistry(source)
  if(['207','208','227'].includes(field)){
   expect(decision.syntaxDecision,field).toBe('rejected')
   expect(decision.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'UNSM_MANDATORY_ELEMENT_MISSING'})]))
  }else if(field==='311'){
   expect(decision.applicationDecision).toBe('manual_review')
   expect(decision.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'CANONICAL_POLICY_RESOLUTION_FAILED'})]))
  }else{
   expect(decision.applicationDecision,field).toBe('rejected')
   expect(decision.issues).toEqual(expect.arrayContaining([expect.objectContaining({prodatDiagnostic:expect.objectContaining({fieldNumber:field,errorKind:'missing'})})]))
  }
  if(field==='314'){
   const protectedEffects=f.effects(),sends=nativeEscoExternal.send.mock.calls.length
   const ownerReplies=()=>sql<{witness:Record<string,unknown>;consumption:Record<string,unknown>;ack:EdielMessageRow}[]>(`SELECT coalesce(jsonb_agg(jsonb_build_object('witness',to_jsonb(w),'consumption',to_jsonb(c),'ack',to_jsonb(m)) ORDER BY w.id),'[]') FROM gridex_ediel_outbound_owner.witnesses w LEFT JOIN gridex_ediel_outbound_owner.consumptions c ON c.witness_id=w.id LEFT JOIN public.ediel_messages m ON m.id=c.source_message_id WHERE w.company_id=${lit(f.ids.company)} AND w.related_message_id=${lit(source.id)}`)
   expect(ownerReplies()).toEqual([])
   const wire=tokenizeEdifact(source.raw_payload!)
   expect(segmentComposite(wire.segments.find(s=>s.tag==='LIN'),1,wire.una)[0]).toBe('')
   const evidence=buildReceivedSourceValidationEvidence({original:source,validated:source,resolvedCompanyId:f.ids.company,decision})
   expect(evidence).not.toBeNull()
   const assessments=()=>sql<number>(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.validation_assessments WHERE source_message_id=${lit(source.id)}`)
   const originalAssessments=assessments()
   // A missing sequence can carry rejection evidence, never accepted objects
   // or a caller-selected physical offset. All are real native owner calls.
   for(const alteration of ['segmentIndex','lineIndex','accepted'] as const){
    const facts=JSON.parse(evidence!.factsText),objects=structuredClone(evidence!.prodatObjectValidation!)
    if(alteration==='accepted'){objects.sharedAccepted=true;objects.objects[0].disposition='accepted';objects.objects[0].reasons=[];objects.objects[0].negativeFields=[]}
    else{
     facts.registerValidation.objects[0].registers[0][alteration]++
     if(alteration==='lineIndex')objects.objects[0].firstLineIndex++
    }
    const refused=await supabaseService.rpc('gridex_record_prodat_source_validation_v6',{
     p_company_id:evidence!.companyId,p_environment:evidence!.environment,p_source_message_id:evidence!.sourceMessageId,
     p_source_payload_hash:evidence!.sourcePayloadHash,p_facts_text:JSON.stringify(facts),
     p_ignored_fields_text:evidence!.prodatIgnoredFields?JSON.stringify(evidence!.prodatIgnoredFields):null,
     p_object_facts_text:JSON.stringify(objects),
     p_response_facts_text:evidence!.prodatResponseValidation?JSON.stringify(evidence!.prodatResponseValidation):null,
     p_application_facts_text:evidence!.prodatApplicationValidation?JSON.stringify(evidence!.prodatApplicationValidation):null,
     p_source_function_facts_text:evidence!.prodatSourceFunctionValidation?JSON.stringify(evidence!.prodatSourceFunctionValidation):null,
    })
    expect(refused.data,alteration).toBeNull();expect(refused.error,alteration).not.toBeNull()
    expect(assessments(),alteration).toBe(originalAssessments)
    expect(f.effects(),alteration).toEqual(protectedEffects)
    expect(ownerReplies(),alteration).toEqual([])
    expect(market(f,a.permissionId),alteration).toEqual(before)
   }
   await process(f,source)
   const replies=()=>sql<{acks:EdielMessageRow[];outbox:Record<string,unknown>[]}>(`SELECT jsonb_build_object('acks',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.message_family),'[]') FROM public.ediel_messages a WHERE company_id=${lit(f.ids.company)} AND related_message_id=${lit(source.id)} AND direction='outbound'),'outbox',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.id),'[]') FROM public.ediel_outbox o WHERE company_id=${lit(f.ids.company)} AND source_message_id=${lit(source.id)}))`)
   const actual=replies();expect(actual.acks.map(x=>[x.message_family,x.ack_outcome])).toEqual([['APERAK','negative'],['CONTRL','positive']]);expect(actual.outbox).toHaveLength(2)
   for(const ack of actual.acks){
    expect(ack).toMatchObject({company_id:f.ids.company,environment:'test',direction:'outbound',related_message_id:source.id,communication_route_id:f.ids.ackRoute,route_profile_id:f.ids.ackProfile})
    expect(validateEdifactEnvelope(ack.raw_payload!).syntaxOk).toBe(true)
    const sourceEnvelope=EdifactEnvelopeCodec.decode(source.raw_payload!),ackEnvelope=EdifactEnvelopeCodec.decode(ack.raw_payload!)
    expect([ackEnvelope.sender,ackEnvelope.receiver]).toEqual([sourceEnvelope.receiver,sourceEnvelope.sender])
    expect(ackEnvelope.applicationReference).toBe(sourceEnvelope.applicationReference)
    const correlation=readPhysicalAckSourceCorrelation(ack,source)
    expect(correlation.classification.outcome).toBe(ack.ack_outcome)
    if(ack.message_family==='CONTRL')expect(correlation.acknowledgedReferences).toEqual([EdifactEnvelopeCodec.decode(source.raw_payload!).interchangeReference])
    else{
     const response=tokenizeEdifact(ack.raw_payload!)
     expect(segmentComposite(response.segments.find(t=>t.tag==='BGM'),3,response.una)[0]).toBe('27')
     expect(response.segments.some(t=>t.tag==='ERC'&&segmentComposite(t,1,response.una)[0]==='41')).toBe(true)
     expect(response.segments.some(t=>t.tag==='FTX'&&segmentComposite(t,3,response.una)[0]==='314')).toBe(true)
     expect(correlation.lookupReferences).toContainEqual({type:'BGM_REF',value:segmentComposite(wire.segments.find(t=>t.tag==='BGM'),2,wire.una)[0]})
    }
    const entries=actual.outbox.filter(x=>x.ediel_message_id===ack.id);expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({company_id:f.ids.company,environment:'test',source_message_id:source.id,message_family:ack.message_family,ack_outcome:ack.ack_outcome})
   }
   // The negative APERAK alone consumes one real outbound-owner witness.
   // This receipt qualifies the ACK bytes; it grants no positive service scope.
   const negative=actual.acks.find(ack=>ack.message_family==='APERAK')!,qualification=ownerReplies()
   expect(qualification).toHaveLength(1)
   const {witness,consumption,ack:qualifiedAck}=qualification[0]
   const ackHash=createHash('sha256').update(negative.raw_payload!,'utf8').digest('hex')
   expect(witness).toMatchObject({company_id:f.ids.company,actor_user_id:f.ids.actor,environment:'test',family:'APERAK',code:negative.message_code,related_message_id:source.id,payload_sha256:ackHash,context:expect.objectContaining({basisKind:'prescribed_outbound_ack',direction:'outbound',wireFamily:'APERAK',originalSourceMessageId:source.id,originalSourceHash:createHash('sha256').update(source.raw_payload!,'utf8').digest('hex')})})
   expect(consumption).toMatchObject({witness_id:witness.id,source_message_id:negative.id,company_id:f.ids.company,environment:'test',payload_sha256:ackHash})
   expect(qualifiedAck).toEqual(negative)
   expect(qualifiedAck.execution_context_snapshot).toMatchObject({outboundOwnerWitnessId:witness.id})
   expect(sql<number>(`SELECT to_jsonb(count(*)) FROM gridex_ediel_ack_replay.positive_service_scope_receipts WHERE company_id=${lit(f.ids.company)} AND source_message_id=${lit(source.id)}`)).toBe(0)
   expect(market(f,a.permissionId)).toEqual(before)
   expect((await getEdielMessageById(source.id))?.raw_payload).toBe(source.raw_payload)
   expect(nativeEscoExternal.send).toHaveBeenCalledTimes(sends)
   const {events:diagnosticEvents,...afterEffects}=f.effects();void diagnosticEvents
   const {events:initialDiagnosticEvents,...beforeEffects}=protectedEffects;void initialDiagnosticEvents
   expect(afterEffects).toEqual({...beforeEffects,messages:beforeEffects.messages+2,acks:beforeEffects.acks+2,creationReceipts:beforeEffects.creationReceipts+2,namespace:beforeEffects.namespace+2,outbox:beforeEffects.outbox+2,witnesses:beforeEffects.witnesses+1,consumptions:beforeEffects.consumptions+1})
   await process(f,source)
   const {events:replayEvents,...replayEffects}=f.effects();void replayEvents
   expect(replies()).toEqual(actual);expect(ownerReplies()).toEqual(qualification);expect(replayEffects).toEqual(afterEffects)
   expect(market(f,a.permissionId)).toEqual(before);expect(nativeEscoExternal.send).toHaveBeenCalledTimes(sends)
  }else{
   if(field==='209'){
    // Diagnose the real protected recorder; a source error remains a failure,
    // never an accepted negative outcome or a substituted JSON receipt.
    const evidence=buildReceivedSourceValidationEvidence({original:source,validated:source,resolvedCompanyId:f.ids.company,decision})
    expect(evidence).not.toBeNull()
    const protectedEffects=f.effects(),assessments=sql<number>(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.validation_assessments WHERE source_message_id=${lit(source.id)}`)
    const recorded=await supabaseService.rpc('gridex_record_prodat_source_validation_v6',{
     p_company_id:evidence!.companyId,p_environment:evidence!.environment,p_source_message_id:evidence!.sourceMessageId,
     p_source_payload_hash:evidence!.sourcePayloadHash,p_facts_text:evidence!.factsText,
     p_ignored_fields_text:evidence!.prodatIgnoredFields?JSON.stringify(evidence!.prodatIgnoredFields):null,
     p_object_facts_text:evidence!.prodatObjectValidation?JSON.stringify(evidence!.prodatObjectValidation):null,
     p_response_facts_text:evidence!.prodatResponseValidation?JSON.stringify(evidence!.prodatResponseValidation):null,
     p_application_facts_text:evidence!.prodatApplicationValidation?JSON.stringify(evidence!.prodatApplicationValidation):null,
     p_source_function_facts_text:evidence!.prodatSourceFunctionValidation?JSON.stringify(evidence!.prodatSourceFunctionValidation):null,
    })
    if(recorded.error){
     processingFailures.push(`required Z15C field 209 native recorder: ${JSON.stringify(recorded.error)}; facts=${JSON.stringify({globalReasons:JSON.parse(evidence!.factsText).reasonCodes,registerReasons:JSON.parse(evidence!.factsText).registerValidation.objects[0].reasons,ownReasons:evidence!.prodatObjectValidation?.objects[0].reasons,objects:!!evidence!.prodatObjectValidation,response:!!evidence!.prodatResponseValidation,application:!!evidence!.prodatApplicationValidation,sourceFunction:!!evidence!.prodatSourceFunctionValidation})}`)
     expect(recorded.data).toBeNull();expect(f.effects()).toEqual(protectedEffects)
     expect(sql<number>(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.validation_assessments WHERE source_message_id=${lit(source.id)}`)).toBe(assessments)
    }
   }
   // Preserve failure for every ordinary processing path, while exercising
   // each independent omission before reporting the complete failing set.
   if(field==='223'){
    // Vitest's default spy calls the actual RPC unchanged. Observe names only;
    // no return value, builder, request or error is substituted or awaited twice.
    const trace=vi.spyOn(supabaseService,'rpc')
    try{await process(f,source)}
    catch(error){processingFailures.push(`required Z15C field 223: ${error instanceof Error?error.message+'; stack='+error.stack:JSON.stringify(error)}; actual RPC names=${JSON.stringify(trace.mock.calls.map(([name])=>name))}`)}
    finally{trace.mockRestore()}
   }else await process(f,source).catch(error=>{processingFailures.push(`required Z15C field ${field}: ${error instanceof Error?error.message+'; stack='+error.stack:JSON.stringify(error)}`)})
  }
  expect(market(f,a.permissionId),field).toEqual(before)
  expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${lit(f.ids.company)} AND related_message_id=${lit(source.id)} AND message_family='APERAK' AND ack_outcome='positive'`),field).toBe(0)
 }
 expect(z18Count(f)).toBe(0)
 expect(processingFailures).toEqual([])
})

it('actual Z15C consumer refuses foreign tenant/actor selectors and native source raw/direction mutation before restoring the unchanged qualified original',async()=>{
 const f=await seed(),a=await qualify(f),foreign=await seed(),profile=ackRoute(f)
 const ended=await receive(f,z15(f,a,false),'PRODAT','Z15','PRODAT:Z15:V:26.A:r3');await process(f,ended)
 const source=await receive(f,z15(f,a,true),'PRODAT','Z15','PRODAT:Z15:C:26.A:r3')
 const before=market(f,a.permissionId),effects=f.effects(),foreignEffects=foreign.effects()
 expect(before.permission.status).toBe('ended')
 expect(await applyPermissionMarketSource({actorUserId:foreign.ids.actor,message:source})).toMatchObject({applied:false,reason:'permission_execution_actor_unqualified'})
 expect(await applyPermissionMarketSource({actorUserId:foreign.ids.actor,message:{...source,company_id:foreign.ids.company}})).toMatchObject({applied:false,reason:'permission_source_unavailable'})
 expect(await applyPermissionMarketSource({actorUserId:f.ids.actor,message:{...source,direction:'outbound'}})).toMatchObject({applied:false,reason:'not_inbound_permission_source'})
 expect(()=>sql(`UPDATE public.ediel_messages SET raw_payload=${lit(source.raw_payload!.replace('Z09:','Z09:MUTATED-'))} WHERE id=${lit(source.id)}`)).toThrow(/immutable_ediel_payload_cannot_change/)
 expect(()=>sql(`UPDATE public.ediel_messages SET direction='outbound' WHERE id=${lit(source.id)}`)).toThrow(/immutable_ediel_received_context_cannot_change/)
 expect((await getEdielMessageById(source.id))!).toMatchObject({raw_payload:source.raw_payload,direction:'inbound'})
 expect(market(f,a.permissionId)).toEqual(before);expect(f.effects()).toEqual(effects);expect(foreign.effects()).toEqual(foreignEffects)
 await process(f,source);await ownAcks(f,source,profile)
 expect(market(f,a.permissionId).permission.status).toBe('active');expect(z18Count(f)).toBe(0)
})

it('actual current legal role prevents Z15C restoration and positive APERAK after a genuine prior received ending',async()=>{
 const f=await seed(),a=await qualify(f);ackRoute(f)
 const ended=await receive(f,z15(f,a,false),'PRODAT','Z15','PRODAT:Z15:V:26.A:r3');await process(f,ended)
 const before=market(f,a.permissionId);expect(before.permission.status).toBe('ended')
 sql(`UPDATE public.tenant_actor_roles SET role_code='supplier' WHERE company_id=${lit(f.ids.company)} AND actor_id=${lit(f.ids.legal)} AND environment='test'`)
 const source=await receive(f,z15(f,a,true),'PRODAT','Z15','PRODAT:Z15:C:26.A:r3');await process(f,source)
 expect(market(f,a.permissionId)).toEqual(before)
 expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${lit(f.ids.company)} AND related_message_id=${lit(source.id)} AND message_family='APERAK' AND ack_outcome='positive'`)).toBe(0)
 expect(z18Count(f)).toBe(0)
})

async function secondMission(f:Fixture){
 const beneficiary=randomUUID(),key=randomUUID()
 sql(`INSERT INTO public.companies(id,name,status) VALUES(${lit(beneficiary)},'Synthetic independent shared-permission beneficiary','active')`)
 const fields={...f.fields,beneficiary_company_id:beneficiary,field_sets:['reading_at','quantity','unit']}
 const made=await f.command({action:'create_assignment',commandId:randomUUID(),fields});expect(made.status).toBe('held')
 const assignment=String(made.assignmentId),current=()=>sql<ReturnType<Fixture['current']>>(`SELECT jsonb_build_object('version',version,'basis',scope_basis_version,'scope',gridex_service_administration.scope_v1(a),'hash',encode(sha256(convert_to(gridex_service_administration.scope_v1(a)::text,'UTF8')),'hex')) FROM public.ediel_service_assignments a WHERE company_id=${lit(f.ids.company)} AND id=${lit(assignment)}`)
 return {...f,ids:{...f.ids,beneficiary,key},fields,assignment,current}
}
it('actual ESCO terminate command protects a shared active mission then sends its source-qualified Z18 and consumes physical ACKs and matching Z15',async()=>{
 const f=await seed(),a=await qualify(f,undefined,{reason:'B79',at:end}),second=await secondMission(f),b=await qualify(second,a,{reason:'B79',at:end}),profile=ackRoute(f)
 expect(b.permissionId).toBe(a.permissionId)
 const terminate=()=>f.command({action:'terminate_permission',assignmentId:f.assignment,expectedVersion:f.current().version,permissionId:a.permissionId,preferredRouteId:f.ids.route})
 expect(await f.command({action:'end_assignment',assignmentId:f.assignment,expectedVersion:f.current().version})).toMatchObject({status:'assignment_ended',permissionId:a.permissionId})
 const protectedState=market(f,a.permissionId),sends=nativeEscoExternal.send.mock.calls.length
 expect(await terminate()).toMatchObject({status:'held'})
 expect(market(f,a.permissionId)).toEqual(protectedState);expect(z18Count(f)).toBe(0);expect(nativeEscoExternal.send).toHaveBeenCalledTimes(sends)
 expect(protectedState.grants.find(g=>g.id===b.grantId)?.status).toBe('active')
 expect(protectedState.grants.find(g=>g.id===a.grantId)?.status).toBe('revoked')
 expect(await second.command({action:'end_assignment',assignmentId:second.assignment,expectedVersion:second.current().version})).toMatchObject({status:'market_termination_required',permissionId:a.permissionId})
 const queued=await terminate();expect(queued).toMatchObject({status:'queued',message:{message_code:'Z18'},blockingReasons:[]})
 const outgoing=queued.message as EdielMessageRow,wire=tokenizeEdifact(outgoing.raw_payload!),segments=wire.segments.map(s=>s.raw)
 expect(EdifactEnvelopeCodec.decode(outgoing.raw_payload!)).toMatchObject({sender:f.sender,receiver:f.receiver,applicationReference:f.app})
 expect(segments.some(s=>s.startsWith('BGM+Z18+'))).toBe(true)
 expect(segments.some(s=>s.startsWith('DTM+164:'))).toBe(true)
 expect(segments.some(s=>s.startsWith('CCI+')&&s.includes('Z25'))).toBe(true)
 expect(segments.some(s=>s.startsWith('RFF+Z09:'))).toBe(true)
 const physical=sql<{code:string;objects:Record<string,unknown>[]}>(`SELECT gridex_received_sources.permission_wire_v1(${lit(outgoing.raw_payload)})`)
 expect(physical).toMatchObject({code:'Z18',objects:[{reason:'S17',endReason:'B79',permissionEnd:prodatDate203(end),permissionId:protectedState.permission.permission_id,li:protectedState.permission.rff_li_reference,point:f.point}]})
 for(const internal of [f.ids.company,f.ids.beneficiary,second.ids.beneficiary,f.assignment,second.assignment])expect(outgoing.raw_payload).not.toContain(internal)
 const queuedOriginal=(await getEdielMessageById(outgoing.id))!
 expect(queuedOriginal).toMatchObject({status:'queued',direction:'outbound',raw_payload:outgoing.raw_payload})
 const queuedEffects=f.effects(),queuedMarket=market(f,a.permissionId),queuedSends=nativeEscoExternal.send.mock.calls.length
 const originalLi=String(protectedState.permission.rff_li_reference),foreignLi=(originalLi.startsWith('X')?'Y':'X')+originalLi.slice(1)
 expect(foreignLi.length).toBe(originalLi.length)
 const foreignLiPayload=queuedOriginal.raw_payload!.replace(`RFF+LI:${originalLi}`,`RFF+LI:${foreignLi}`)
 expect(foreignLiPayload).not.toBe(queuedOriginal.raw_payload)
 expect(validateEdifactEnvelope(foreignLiPayload).syntaxOk).toBe(true)
 for(const attempted of [{...queuedOriginal,direction:'inbound' as const},{...queuedOriginal,raw_payload:foreignLiPayload}]){
  await expect(sendEdielMessageViaSmtp(attempted,{actorUserId:f.ids.actor,smtpMimeMode:'nodemailer-attachment'})).rejects.toBeTruthy()
  expect(await getEdielMessageById(outgoing.id)).toEqual(queuedOriginal)
  expect(f.effects()).toEqual(queuedEffects);expect(market(f,a.permissionId)).toEqual(queuedMarket)
  expect(nativeEscoExternal.send).toHaveBeenCalledTimes(queuedSends)
 }
 expect(()=>sql(`UPDATE public.ediel_messages SET direction='inbound' WHERE id=${lit(outgoing.id)}`)).toThrow(/ediel_wire_reference_namespace_context_immutable/)
 expect(await getEdielMessageById(outgoing.id)).toEqual(queuedOriginal)
 expect(f.effects()).toEqual(queuedEffects);expect(market(f,a.permissionId)).toEqual(queuedMarket)
 expect(nativeEscoExternal.send).toHaveBeenCalledTimes(queuedSends)
 await sendEdielMessageViaSmtp(outgoing,{actorUserId:f.ids.actor,smtpMimeMode:'nodemailer-attachment'})
 const sent=(await getEdielMessageById(outgoing.id))!;expect(sent.status).toBe('sent')
 expect(market(f,a.permissionId).permission.status).toBe('active')
 const acceptedEffects=f.effects(),acceptedMarket=market(f,a.permissionId),acceptedSends=nativeEscoExternal.send.mock.calls.length
 for(const attempted of [{...sent,direction:'inbound' as const},{...sent,raw_payload:sent.raw_payload!.replace('RFF+LI:','RFF+LI:MUTATED-')}]){
  expect(attempted).not.toEqual(sent)
  await expect(sendEdielMessageViaSmtp(attempted,{actorUserId:f.ids.actor,smtpMimeMode:'nodemailer-attachment'})).rejects.toThrow(/ediel_accepted_projection_original_changed/)
  expect(await getEdielMessageById(sent.id)).toEqual(sent)
  expect(f.effects()).toEqual(acceptedEffects);expect(market(f,a.permissionId)).toEqual(acceptedMarket)
  expect(nativeEscoExternal.send).toHaveBeenCalledTimes(acceptedSends)
 }
 // External reply bytes are built by the existing pure wire renderer only;
 // original reception, ACK admission/correlation/consumption are actual owners.
 // A synthetic DSO view is used only as pure wire-renderer input. It never
 // replaces the actual outbound original or enters any admission/effect port.
 const counterpart={...sent,direction:'inbound' as const}
 const beforeAck=market(f,a.permissionId)
 expect(beforeAck.grants.filter(g=>[a.grantId,b.grantId].includes(String(g.id))).map(g=>g.status)).toEqual(['revoked','revoked'])
 const expectationState=()=>sql(`SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]') FROM public.ediel_business_expectations e WHERE company_id=${lit(f.ids.company)} AND source_message_id=${lit(sent.id)}`)
 const pending=expectationState()
 const badContrl=buildContrlDraft({sourceMessage:counterpart,outcome:'positive'}).rawPayload!.replace(`UCI+${sent.interchange_reference}`,`UCI+WRONG-${sent.interchange_reference}`)
 const aperak=buildAperakDraft({sourceMessage:counterpart,outcome:'positive'}).rawPayload!
 const badAperak=aperak.replace('RFF+ACW:','RFF+ACW:WRONG-')
 expect(badContrl).toContain('UCI+WRONG-');expect(badAperak).not.toBe(aperak)
 for(const [family,raw] of [['CONTRL',badContrl],['APERAK',badAperak]] as const){
  const reply=await receive(f,raw,family,family),actual=await process(f,reply)
  expect(await readCommittedInboundAck({actorUserId:f.ids.actor,message:actual})).toBeNull()
  expect(await getEdielMessageById(sent.id)).toEqual(sent)
  expect(market(f,a.permissionId)).toEqual(beforeAck);expect(expectationState()).toEqual(pending)
 }
 for(const [family,draft] of [['CONTRL',buildContrlDraft({sourceMessage:counterpart,outcome:'positive'})],['APERAK',buildAperakDraft({sourceMessage:counterpart,outcome:'positive'})]] as const){
  const reply=await receive(f,draft.rawPayload!,family,family),actual=await process(f,reply)
  const committed=await readCommittedInboundAck({actorUserId:f.ids.actor,message:actual})
  expect(committed).toMatchObject({kind:'exact_receipt',sourceMessageId:sent.id,result:{outcome:'positive',sourceMessage:{id:sent.id}}})
  expect((await getEdielMessageById(sent.id))![family==='CONTRL'?'contrl_status':'aperak_status']).toBe('received')
  expect(market(f,a.permissionId)).toEqual(beforeAck)
  await process(f,reply)
  expect(await readCommittedInboundAck({actorUserId:f.ids.actor,message:(await getEdielMessageById(reply.id))!})).toEqual(committed)
 }
 for(const change of [{transactionReference:'FOREIGN-Z18-LI'},{permissionId:'FOREIGN-Z18-PERMISSION'},{meterPointId:'735999260731000014'}]){
  const wrong=await receive(f,z15(f,a,false,change),'PRODAT','Z15','PRODAT:Z15:V:26.A:r3');await process(f,wrong)
  expect(market(f,a.permissionId)).toEqual(beforeAck);expect(expectationState()).toEqual(pending)
  expect(sql<number>(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.permission_effect_receipts WHERE company_id=${lit(f.ids.company)} AND source_message_id=${lit(wrong.id)}`)).toBe(0)
  expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${lit(f.ids.company)} AND related_message_id=${lit(wrong.id)} AND message_family='APERAK' AND ack_outcome='positive'`)).toBe(0)
 }
 const received=await receive(f,z15(f,a,false),'PRODAT','Z15','PRODAT:Z15:V:26.A:r3');await process(f,received);await ownAcks(f,received,profile)
 const completed=market(f,a.permissionId);expect(completed.permission.status).toBe('ended');expect(completed.permission.outbound_z18_message_id).toBe(sent.id)
 expect(completed.grants).toEqual(beforeAck.grants)
 expect(completed.sites).toHaveLength(1)
 expect(new Date(String(completed.sites[0].permission_end_at)).toISOString()).toBe(new Date(end).toISOString())
 expect(sql(`SELECT jsonb_build_object('original',qualified_original_message_id,'code',qualified_expected_message_code,'hash',payload_hash) FROM gridex_received_sources.permission_effect_receipts WHERE company_id=${lit(f.ids.company)} AND source_message_id=${lit(received.id)} AND permission_id=${lit(a.permissionId)}`)).toEqual({original:sent.id,code:'Z15',hash:createHash('sha256').update(received.raw_payload!).digest('hex')})
 expect(sql<Record<string,unknown>[]>(`SELECT coalesce(jsonb_agg(jsonb_build_object('status',status,'fulfilled',fulfilled_by_message_id)),'[]') FROM public.ediel_business_expectations WHERE company_id=${lit(f.ids.company)} AND source_message_id=${lit(sent.id)} AND expected_family='PRODAT' AND expected_code='Z15'`)).toContainEqual({status:'fulfilled',fulfilled:received.id})
 await process(f,received);expect(market(f,a.permissionId)).toEqual(completed);expect(z18Count(f)).toBe(1)
})

it('actual Z18 origination rejects a foreign tenant actor and a missing current legal ESCO role before any wire or provider effect',async()=>{
 const f=await seed(),a=await qualify(f,undefined,{reason:'B79',at:end})
 expect(await f.command({action:'end_assignment',assignmentId:f.assignment,expectedVersion:f.current().version})).toMatchObject({status:'market_termination_required'})
 const before=market(f,a.permissionId),effects=f.effects(),sends=nativeEscoExternal.send.mock.calls.length
 const command={action:'terminate_permission',assignmentId:f.assignment,expectedVersion:f.current().version,permissionId:a.permissionId,preferredRouteId:f.ids.route}
 await expect(executeEdielServiceAdministration({companyId:f.ids.beneficiary,actorUserId:f.ids.actor,command})).rejects.toThrow(/ediel_tenant_actor_forbidden/)
 expect(market(f,a.permissionId)).toEqual(before);expect(f.effects()).toEqual(effects)
 sql(`UPDATE public.tenant_actor_roles SET role_code='supplier' WHERE company_id=${lit(f.ids.company)} AND actor_id=${lit(f.ids.legal)} AND environment='test'`)
 expect(await f.command(command)).toMatchObject({status:'held',missing:['current_provider_electricity_profile_and_esco_role']})
 expect(market(f,a.permissionId)).toEqual(before);expect(f.effects()).toEqual(effects)
 expect(z18Count(f)).toBe(0);expect(nativeEscoExternal.send).toHaveBeenCalledTimes(sends)
})

it('every required common/own/UD Z18V omission is rejected by the actual registry and send consumer without modifying the queued original or entering SMTP',async()=>{
 const f=await seed(),a=await qualify(f,undefined,{reason:'B79',at:end})
 expect(await f.command({action:'end_assignment',assignmentId:f.assignment,expectedVersion:f.current().version})).toMatchObject({status:'market_termination_required'})
 const queued=await f.command({action:'terminate_permission',assignmentId:f.assignment,expectedVersion:f.current().version,permissionId:a.permissionId,preferredRouteId:f.ids.route})
 expect(queued).toMatchObject({status:'queued',blockingReasons:[]})
 const original=(await getEdielMessageById((queued.message as EdielMessageRow).id))!,before=market(f,a.permissionId),effects=f.effects(),sends=nativeEscoExternal.send.mock.calls.length
 expect(original).toMatchObject({status:'queued',raw_payload:(queued.message as EdielMessageRow).raw_payload})
 for(const field of permissionRequiredFields.filter(field=>field!=='322')){
  // Deliberately malformed caller bytes; the stored original and its source
  // authority stay unchanged. Real consumers must refuse this attempted send.
  const attempt={...original,raw_payload:omitPermissionField(original.raw_payload!,field)}
  const decision=await resolveCanonicalRuntimeDecisionWithRegistry(attempt)
  if(['207','208','227'].includes(field)){
   expect(decision.syntaxDecision,field).toBe('rejected')
   expect(decision.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'UNSM_MANDATORY_ELEMENT_MISSING'})]))
  }else{
   expect(decision.applicationDecision,field).toBe('rejected')
   expect(decision.issues).toEqual(expect.arrayContaining([expect.objectContaining({prodatDiagnostic:expect.objectContaining({fieldNumber:field,errorKind:'missing'})})]))
  }
  await expect(sendEdielMessageViaSmtp(attempt,{actorUserId:f.ids.actor,smtpMimeMode:'nodemailer-attachment'}),field).rejects.toBeTruthy()
  expect(await getEdielMessageById(original.id),field).toEqual(original)
  expect(market(f,a.permissionId),field).toEqual(before);expect(f.effects(),field).toEqual(effects)
  expect(nativeEscoExternal.send,field).toHaveBeenCalledTimes(sends)
 }
})
