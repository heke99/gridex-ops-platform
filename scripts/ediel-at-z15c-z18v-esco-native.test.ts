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
import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import type {EdielMessageRow} from '@/lib/ediel/types'

beforeEach(resetNativeEscoFixture)
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks()})
type Fixture=Awaited<ReturnType<typeof seed>>
type Authority=Awaited<ReturnType<typeof qualify>>
const end='2026-09-01T00:00:00Z'

function ackRoute(f:Fixture){
 const id=randomUUID(),smtp=edielSmtpConfig()
 sql(`INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,payload_format,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,is_active,mailbox,smtp_host,smtp_port,smtp_to,receiver_email)
 VALUES(${lit(id)},${lit(f.ids.company)},${lit(f.ids.ackRoute)},'Synthetic DGI PRODAT ACK','test','edifact','edifact',${lit(f.sender)},${lit(f.receiver)},${lit(f.app)},true,true,${lit(smtp.from)},${lit(smtp.host)},${lit(smtp.port)},'dso-native@example.invalid','dso-native@example.invalid')`)
 return id
}
async function receive(f:Fixture,raw:string,family:'PRODAT'|'CONTRL'|'APERAK',code:string,profile?:string){
 const mail=await seedOriginalMailboxNative(sql,lit,{companyId:f.ids.company,environment:'test',raw,smtpFrom:edielSmtpConfig().from,senderEmail:'dso-native@example.invalid'})
 const source=await f.insert(raw,family,code,profile,mail)
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
 expect(actual.acks.map(a=>a.message_family)).toEqual(['APERAK','CONTRL'])
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
 await sendEdielMessageViaSmtp(outgoing,{actorUserId:f.ids.actor,smtpMimeMode:'nodemailer-attachment'})
 const sent=(await getEdielMessageById(outgoing.id))!;expect(sent.status).toBe('sent')
 expect(market(f,a.permissionId).permission.status).toBe('active')
 // External reply bytes are built by the existing pure wire renderer only;
 // original reception, ACK admission/correlation/consumption are actual owners.
 // A synthetic DSO view is used only as pure wire-renderer input. It never
 // replaces the actual outbound original or enters any admission/effect port.
 const counterpart={...sent,direction:'inbound' as const}
 const beforeAck=market(f,a.permissionId)
 expect(beforeAck.grants.filter(g=>[a.grantId,b.grantId].includes(String(g.id))).map(g=>g.status)).toEqual(['revoked','revoked'])
 for(const [family,draft] of [['CONTRL',buildContrlDraft({sourceMessage:counterpart,outcome:'positive'})],['APERAK',buildAperakDraft({sourceMessage:counterpart,outcome:'positive'})]] as const){
  const reply=await receive(f,draft.rawPayload!,family,family),actual=await process(f,reply)
  const committed=await readCommittedInboundAck({actorUserId:f.ids.actor,message:actual})
  expect(committed).toMatchObject({kind:'exact_receipt',sourceMessageId:sent.id,result:{outcome:'positive',sourceMessage:{id:sent.id}}})
  expect((await getEdielMessageById(sent.id))![family==='CONTRL'?'contrl_status':'aperak_status']).toBe('received')
  expect(market(f,a.permissionId)).toEqual(beforeAck)
  await process(f,reply)
  expect(await readCommittedInboundAck({actorUserId:f.ids.actor,message:(await getEdielMessageById(reply.id))!})).toEqual(committed)
 }
 const received=await receive(f,z15(f,a,false),'PRODAT','Z15','PRODAT:Z15:V:26.A:r3');await process(f,received);await ownAcks(f,received,profile)
 const completed=market(f,a.permissionId);expect(completed.permission.status).toBe('ended');expect(completed.permission.outbound_z18_message_id).toBe(sent.id)
 expect(completed.grants).toEqual(beforeAck.grants)
 expect(sql<Record<string,unknown>[]>(`SELECT coalesce(jsonb_agg(jsonb_build_object('status',status,'fulfilled',fulfilled_by_message_id)),'[]') FROM public.ediel_business_expectations WHERE company_id=${lit(f.ids.company)} AND source_message_id=${lit(sent.id)} AND expected_family='PRODAT' AND expected_code='Z15'`)).toContainEqual({status:'fulfilled',fulfilled:received.id})
 await process(f,received);expect(market(f,a.permissionId)).toEqual(completed);expect(z18Count(f)).toBe(1)
})
