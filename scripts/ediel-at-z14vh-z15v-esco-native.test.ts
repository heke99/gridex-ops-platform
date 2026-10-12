// masterplan: AT-Z14VH-ESCO, AT-Z15V-ESCO
// Genuine full-schema PostgreSQL/PostgREST consumers after canonical clean
// replay. Only upstream legal/issuer/mail input and the SMTP provider are
// synthetic; they confer no TGT/LIVE market or legal approval.
import {createHash,createHmac,randomUUID} from 'node:crypto'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {seedNativeEscoFixture as seed,qualifyNativeEscoFixture as qualify,resetNativeEscoFixture,nativeEscoSql as sql,nativeEscoLiteral as lit} from './fixtures/ediel-service-evidence-native'
import {seedOriginalMailboxNative,recordOriginalMailboxNativeReception} from './helpers/originalMailboxNative'
import {omitPermissionField} from './helpers/ediel-permission-field-omissions'
import {omitZ14Field,currentAssignment,setOwnAckApplication} from './helpers/ediel-z14v-current-native-fixture'
import {assertUtiltsPositiveAckAuthorityForSend} from '@/lib/ediel/utilts/positiveAckAuthority'
import {archiveEdielServiceEvidence,readEdielServiceEvidenceArchive,reviewEdielServiceEvidence} from '@/lib/ediel/services/evidenceReview'
import {reviewPeriodicDgiE66Reason} from '@/lib/ediel/services/periodicReason'
import {sendEdielMessageViaSmtp} from '@/lib/ediel/transport'
import {nativeEscoExternal} from './fixtures/ediel-service-evidence-native'
import {projectEdielSeriesToBeneficiary} from '@/lib/ediel/services/projection'
import {renderProdat} from '@/lib/ediel/prodatEngine'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {readReceivedProdatFinalResponsePlan} from '@/lib/ediel/core/receivedProdatFinalResponsePlan'
import {readPhysicalAckSourceCorrelation} from '@/lib/ediel/ack/sourceCorrelation'
import {validateEdifactEnvelope} from '@/lib/ediel/core/edifactValidation'
import {edielSmtpConfig} from '@/lib/ediel/mailReadiness'
import {getEdielMessageById} from '@/lib/ediel/db'
import {applyPermissionMarketSource} from '@/lib/ediel/permissions/permissionMarketTransition'
import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import type {EdielMessageRow} from '@/lib/ediel/types'

beforeEach(resetNativeEscoFixture)
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks()})
type Fixture=Awaited<ReturnType<typeof seed>>
const version={selectedVersion:'E2SE6A',messageTypeToken:'PRODAT:D:97A:UN:E2SE6A'}
const end='2026-09-01T00:00:00Z'

function ackRoute(f:Fixture){
 const smtp=edielSmtpConfig()
 expect(sql(`UPDATE public.ediel_route_profiles SET application_reference=${lit(f.app)},route_name='Synthetic DGI PRODAT ACK',mailbox=${lit(smtp.from)},smtp_host=${lit(smtp.host)},smtp_port=${lit(smtp.port)} WHERE id=${lit(f.ids.ackProfile)} AND company_id=${lit(f.ids.company)} AND communication_route_id=${lit(f.ids.ackRoute)} RETURNING to_jsonb(id)`)).toBe(f.ids.ackProfile)
 return f.ids.ackProfile
}
function envelope(f:Fixture,segments:unknown,sender=f.receiver,receiver=f.sender){
 return EdifactEnvelopeCodec.encode({sender,receiver,applicationReference:f.app,interchangeReference:randomUUID().replaceAll('-','').slice(0,14),environment:'test',acknowledgementRequest:true,messages:[{messageReference:'1',messageTypeToken:version.messageTypeToken,businessSegments:segments as never}]})
}
async function receive(f:Fixture,raw:string,code:string,profile?:string){
 const mail=await seedOriginalMailboxNative(sql,lit,{companyId:f.ids.company,environment:'test',raw,smtpFrom:edielSmtpConfig().from,senderEmail:'dso-native@example.invalid'})
 const observedCode=mail.parsed.messageCode??code
 const source=await f.insert(raw,'PRODAT',observedCode,observedCode===code?profile:undefined,mail)
 await recordOriginalMailboxNativeReception({companyId:f.ids.company,sourceMessageId:source.id,actorUserId:f.ids.actor,inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId,sourcePayloadHash:mail.sourcePayloadHash})
 return source
}
async function processed(f:Fixture,source:EdielMessageRow){
 await processInboundEdielMessage({actorUserId:f.ids.actor,edielMessageId:source.id})
 const actual=await getEdielMessageById(source.id)
 // Received bytes are immutable through every consumer.
 expect(actual?.raw_payload).toBe(source.raw_payload)
 return actual!
}
function market(f:Fixture,permissionId:string){
 const c=lit(f.ids.company)
 return sql<{permission:Record<string,unknown>;sites:Record<string,unknown>[];grants:Record<string,unknown>[];supply:Record<string,unknown>[];z13:number;receipts:number}>(`SELECT jsonb_build_object(
 'permission',(SELECT to_jsonb(p) FROM public.metering_permissions p WHERE company_id=${c} AND id=${lit(permissionId)}),
 'sites',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.metering_permission_sites s WHERE company_id=${c} AND metering_permission_id=${lit(permissionId)}),
 'grants',(SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY g.id),'[]') FROM public.ediel_data_access_grants g WHERE company_id=${c}),
 'supply',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]') FROM public.customer_supply_periods x WHERE company_id=${c}),
 'z13',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${c} AND message_code='Z13'),
 'receipts',(SELECT count(*) FROM gridex_received_sources.permission_effect_receipts WHERE company_id=${c}))`)
}
function positiveAperaks(f:Fixture,source:EdielMessageRow){
 return sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${lit(f.ids.company)} AND related_message_id=${lit(source.id)} AND message_family='APERAK' AND ack_outcome='positive'`)
}
// Genuine own CONTRL + APERAK: correct counterparty, correlation to the exact
// received interchange/document/object, outbox entry and committed effect plan.
async function ownAcks(f:Fixture,source:EdielMessageRow,profile:string){
 const actual=sql<{acks:EdielMessageRow[];outbox:Record<string,unknown>[]}>(`SELECT jsonb_build_object(
 'acks',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.message_family),'[]') FROM public.ediel_messages a WHERE company_id=${lit(f.ids.company)} AND related_message_id=${lit(source.id)} AND direction='outbound'),
 'outbox',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.id),'[]') FROM public.ediel_outbox o WHERE company_id=${lit(f.ids.company)} AND source_message_id=${lit(source.id)}))`)
 const events=sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('message',message,'status',event_status)),'[]') FROM public.ediel_message_events WHERE company_id=${lit(f.ids.company)} AND ediel_message_id=${lit(source.id)}`)
 expect(actual.acks.map(a=>a.message_family),JSON.stringify(events)).toEqual(['APERAK','CONTRL'])
 const env=EdifactEnvelopeCodec.decode(source.raw_payload!),wire=tokenizeEdifact(source.raw_payload!)
 const line=wire.segments.find(s=>s.tag==='LIN')!,li=wire.segments.find(s=>s.tag==='RFF'&&segmentComposite(s,1,wire.una)[0]==='LI')!
 for(const ack of actual.acks){
  expect(ack).toMatchObject({company_id:f.ids.company,environment:'test',direction:'outbound',related_message_id:source.id,ack_outcome:'positive'})
  expect(validateEdifactEnvelope(ack.raw_payload!).syntaxOk).toBe(true)
  const ackEnv=EdifactEnvelopeCodec.decode(ack.raw_payload!)
  expect([ackEnv.sender,ackEnv.receiver]).toEqual([env.receiver,env.sender])
  const correlation=readPhysicalAckSourceCorrelation(ack,source)
  expect(correlation.classification.outcome).toBe('positive')
  if(ack.message_family==='CONTRL')expect(correlation.acknowledgedReferences).toEqual([env.interchangeReference])
  else{
   expect(ack.route_profile_id).toBe(profile)
   expect(correlation.lookupReferences).toContainEqual({type:'BGM_REF',value:segmentComposite(wire.segments.find(s=>s.tag==='BGM'),2,wire.una)[0]})
   expect(correlation.prodatObjectOutcomes).toEqual([{objectId:f.point,identityAgency:'9',firstLineIndex:line.index,lineItemReference:segmentComposite(li,1,wire.una)[1],outcome:'positive'}])
  }
  expect(actual.outbox.filter(o=>o.ediel_message_id===ack.id)).toEqual([expect.objectContaining({company_id:f.ids.company,source_message_id:source.id,message_family:ack.message_family,ack_outcome:'positive'})])
 }
 const plan=await readReceivedProdatFinalResponsePlan({companyId:f.ids.company,sourceMessageId:source.id,rawPayload:source.raw_payload!})
 expect(plan?.plans).toHaveLength(1)
 expect(plan!.plans[0]).toMatchObject({effectKind:'metering_permission',outcome:'positive',objectLineIndices:[line.index]})
 expect(sql(`SELECT jsonb_build_object('source',source_message_id,'company',company_id,'hash',payload_hash) FROM gridex_received_sources.permission_effect_receipts WHERE id=${lit(plan!.plans[0].effectReceiptId)}`)).toEqual({source:source.id,company:f.ids.company,hash:createHash('sha256').update(source.raw_payload!).digest('hex')})
 return actual
}

// ---------------------------------------------------------------- Z14VH ----
// The same public evidence path as the approved Z14V proof, bound to the
// CURRENT assignment's canonical scope (read back from the real archive).
async function approveAndRequest(f:Fixture){
 const pdf=Buffer.from('%PDF-1.7\nSYNTHETIC CODE FIXTURE ONLY. NO EXTERNAL MARKET OR LEGAL APPROVAL.\n%%EOF')
 const hash=createHash('sha256').update(pdf).digest('hex'),key=Buffer.alloc(32,0x66),keyId=randomUUID()
 sql(`INSERT INTO gridex_ediel_services.issuer_keys(id,company_id,environment,issuer_code,legal_issuer_reference,legal_authority_source_hash,receipt_signing_key,valid_from,valid_to) VALUES(${lit(keyId)},${lit(f.ids.company)},'test','synthetic-native-issuer','SYNTHETIC EXTERNAL REGISTRY INPUT ONLY',${lit(hash)},decode(${lit(key.toString('hex'))},'hex'),'2000-01-01','2099-01-01')`)
 for(const kind of ['end_user_contract','dso_contract','service_contract','downstream_use','privacy_roles'] as const){
  const a=await currentAssignment(f),representation=randomUUID(),reference='z14vh-'+kind+'-'+randomUUID()
  const terms={valid_from:f.fields.valid_from,valid_to:f.fields.valid_to,permission_purpose_code:'B72' as const,permission_reporting_frequency:'D',permission_request_grid_area:'TES',
   permission_reporting_term_kind:'bounded' as const,permission_customer_classification:'private' as const,
   permission_agreement_reference:kind==='end_user_contract'?'SYN-'+f.ids.customer.slice(0,20):null,permission_requested_method:kind==='end_user_contract'?'Z04' as const:null,
   permission_network_contract_start:kind==='dso_contract'?'2026-01-01':null,permission_network_contract_end:null}
  const bootstrap=await archiveEdielServiceEvidence({companyId:f.ids.company,actorUserId:f.ids.actor,submission:{assignmentId:f.assignment,scopeBasisVersion:a.scope_basis_version,kind,terms,source:{bytesBase64:pdf.toString('base64'),mimeType:'application/pdf',reference:'bootstrap-'+randomUUID(),version:'synthetic-v1'}}})
  expect(bootstrap.missing).toContain('authentic_current_issuer_and_representation_receipt')
  const canonical=await readEdielServiceEvidenceArchive({companyId:f.ids.company,actorUserId:f.ids.reviewer,artifactId:bootstrap.artifactId})
  sql(`INSERT INTO gridex_ediel_services.issuer_representations(id,company_id,environment,issuer_key_id,legal_actor_id,beneficiary_company_id,customer_id,dso_actor_id,evidence_kind,scope_hash,legal_representation_reference,legal_authority_source_hash,valid_from,valid_to) VALUES(${lit(representation)},${lit(f.ids.company)},'test',${lit(keyId)},${lit(f.ids.legal)},${lit(f.ids.beneficiary)},${lit(f.ids.customer)},${lit(f.ids.dso)},${lit(kind)},${lit(canonical.scopeHash)},'SYNTHETIC EXTERNAL REPRESENTATION INPUT ONLY',${lit(hash)},'2000-01-01','2099-01-01')`)
  const payload={format:'ediel_service_evidence_receipt_v1',issuerCode:'synthetic-native-issuer',receiptId:randomUUID(),companyId:f.ids.company,environment:'test',assignmentId:f.assignment,scopeBasisVersion:canonical.scopeBasisVersion,scope:canonical.scope,evidenceKind:kind,evidenceTerms:canonical.evidenceTerms,
   ...(kind==='dso_contract'||kind==='service_contract'?{periodicE66Reason:{version:1,reasonCode:'E23',applicationReference:'23-DGI-E66-T',senderEdielId:f.receiver,receiverEdielId:f.sender}}:{}),
   sourceHash:hash,sourceReference:reference,sourceVersion:'synthetic-v1',transportRelationId:null,transportActorId:null,issuedAt:new Date().toISOString(),expiresAt:'2090-01-01T00:00:00Z'}
  const wire=Buffer.from(JSON.stringify(payload))
  const artifact=await archiveEdielServiceEvidence({companyId:f.ids.company,actorUserId:f.ids.actor,submission:{assignmentId:f.assignment,scopeBasisVersion:a.scope_basis_version,kind,terms,source:{bytesBase64:pdf.toString('base64'),mimeType:'application/pdf',reference,version:'synthetic-v1'},issuerReceipt:{keyId,representationId:representation,payloadBase64:wire.toString('base64'),signatureHex:createHmac('sha256',key).update(wire).digest('hex')}}})
  expect(artifact.missing).toEqual(['separate_qualified_reviewer_required'])
  const staged=await f.command({action:'stage_evidence',commandId:randomUUID(),assignmentId:f.assignment,expectedVersion:(await currentAssignment(f)).version,fields:{kind,source_reference:reference,source_sha256:hash,source_version:'synthetic-v1',...terms}})
  expect(staged).toMatchObject({status:'pending',approvalGranted:false})
  const review={decision:'approve',reason:'Separate synthetic review of public canonical scope, signed archive and exact bytes',sourceHash:artifact.sourceHash,scopeHash:artifact.scopeHash}
  expect(await reviewEdielServiceEvidence({companyId:f.ids.company,actorUserId:f.ids.reviewer,artifactId:artifact.artifactId,evidenceId:String(staged.evidenceId),review})).toMatchObject({status:'verified',missing:[],marketActivationGranted:false})
  if(kind==='dso_contract'||kind==='service_contract')expect(await reviewPeriodicDgiE66Reason({companyId:f.ids.company,actorUserId:f.ids.reviewer,artifactId:artifact.artifactId,evidenceId:String(staged.evidenceId),review:{...review,reason:'Separate review of synthetic signed DGI E23 clause'}})).toMatchObject({status:'approved',reasonCode:'E23',marketActivationGranted:false})
 }
 expect(await f.command({action:'approve_assignment',commandId:randomUUID(),assignmentId:f.assignment,expectedVersion:(await currentAssignment(f)).version})).toMatchObject({status:'approved_waiting_permission'})
 const queuedResult=await f.command({action:'request_access',assignmentId:f.assignment,expectedVersion:(await currentAssignment(f)).version,preferredRouteId:f.ids.route})
 expect(queuedResult,JSON.stringify(queuedResult)).toMatchObject({status:'queued',message:{message_code:'Z13'},blockingReasons:[]})
 const queued=queuedResult.message as EdielMessageRow,sends=nativeEscoExternal.send.mock.calls.length
 await sendEdielMessageViaSmtp(queued,{actorUserId:f.ids.actor,smtpMimeMode:'nodemailer-attachment'})
 expect(nativeEscoExternal.send).toHaveBeenCalledTimes(sends+1)
 const z13=(await getEdielMessageById(queued.id))!;expect(z13.status).toBe('sent')
 const permission=sql<{id:string;li:string}>(`SELECT jsonb_build_object('id',id,'li',rff_li_reference) FROM public.metering_permissions WHERE company_id=${lit(f.ids.company)} AND source_z13_message_id=${lit(z13.id)}`)
 return {permissionId:permission.id,li:permission.li,z13}
}
type PendingVH={f:Fixture;permissionId:string;li:string;z13:EdielMessageRow;profile:string}
async function pendingVH(opts:{f?:Fixture;start?:string;end?:string}={}):Promise<PendingVH>{
 let f=opts.f??await seed('VH')
 // Z13VH history must lie before the request day; a second public
 // prospective assignment carries that bounded past period. Given an
 // existing V fixture, the VH assignment is a separate one for the same customer.
 const fields={...f.fields,mode:'VH' as const,data_start:opts.start??'2026-01-01T00:00:00Z',data_end:opts.end??'2026-06-01T00:00:00Z'}
 const created=await f.command({action:'create_assignment',commandId:randomUUID(),fields})
 expect(created.status).toBe('held');f={...f,mode:'VH',fields,assignment:String(created.assignmentId)}
 const prepared=await approveAndRequest(f),profile=ackRoute(f)
 const state=market(f,prepared.permissionId)
 // A sent S18 Z13 alone grants nothing: no active permission, site or grant.
 expect(state.permission.status).not.toBe('active');expect(state.permission.source_z14_message_id).toBeNull()
 expect(state.sites.filter(s=>['approved','active'].includes(String(s.status)))).toEqual([]);expect(opts.f?state.grants.filter(g=>g.assignment_id===f.assignment):state.grants).toEqual([])
 const sent=tokenizeEdifact(prepared.z13.raw_payload!)
 expect(segmentComposite(sent.segments[sent.segments.findIndex(s=>s.tag==='CCI'&&segmentComposite(s,2,sent.una)[0]==='Z13')+1],1,sent.una)[0]).toBe('S18')
 return {f,permissionId:prepared.permissionId,li:prepared.li,z13:prepared.z13,profile}
}
function z14vh(p:PendingVH,change:Record<string,unknown>={},asEsco=false){
 const {f}=p
 const rendered=renderProdat({code:'Z14',variant:'VH',mode:'test',actor:{senderEdielId:f.receiver,receiverEdielId:f.sender},route:{applicationReference:f.app},version,context:{code:'Z14',bgmReference:randomUUID().replaceAll('-','').slice(0,20),transactionReference:p.li,senderEdielId:f.receiver,receiverEdielId:f.sender,legalSenderId:f.receiver,legalReceiverId:f.sender,customerName:'Synthetic Customer',customerId:'199001011234',customerIdCodeListQualifier:'SE2',customerIdAgency:'260',customerCountry:'SE',meterPointId:f.point,gridAreaId:'TES',reasonForTransaction:'S18',permissionStatus:'A74',permissionPurpose:'B72',permissionId:'SYNTHETIC-PERMISSION-'+p.permissionId.slice(0,8),permissionTimestamp:new Date().toISOString(),reportStartDate:f.fields.data_start,reportEndDate:f.fields.data_end,reportingFrequency:'D',energyProductId:f.product,observationLength:'60',observationLengthFormat:'806',meteringMethod:'Z04',installationDirection:'E19',siteAddress:'Synthetic Street 1',siteCity:'Teststad',sitePostalCode:'12345',siteCountry:'SE',siteIdAgency:'9',...change}})
 expect(rendered.issues.filter(x=>x.severity==='error'&&!/_UNDETERMINED$/.test(x.code)),JSON.stringify(rendered.issues)).toEqual([])
 return asEsco?envelope(f,rendered.segments,f.sender,f.receiver):envelope(f,rendered.segments)
}
const VH_PROFILE='PRODAT:Z14:VH:26.A:r3'
// Exact physical mutation of one segment; the renderer would normalise a
// caller-supplied reason/product back to its own variant.
function mutate(raw:string,from:string,to:string){
 expect(raw.split(from).length,from).toBe(2)
 const changed=raw.replace(from,to);expect(changed).not.toBe(raw);return changed
}

it('mailbox-born Z14VH/S18 on 23-DGI-PRODAT creates and versions exactly its market permission and object scope, with genuine CONTRL+APERAK and no tenant access',async()=>{
 const other=await pendingVH(),otherBefore=market(other.f,other.permissionId)
 const p=await pendingVH(),{f}=p,raw=z14vh(p),before=market(f,p.permissionId)
 const physical=tokenizeEdifact(raw)
 expect(EdifactEnvelopeCodec.decode(raw).applicationReference).toBe('23-DGI-PRODAT')
 expect(segmentComposite(physical.segments.find(s=>s.tag==='BGM'),1,physical.una)[0]).toBe('Z14')
 const source=await receive(f,raw,'Z14',VH_PROFILE)
 expect(market(f,p.permissionId)).toEqual(before)
 await processed(f,source)
 const after=market(f,p.permissionId)
 expect(after.permission).toMatchObject({status:'active',source_z14_message_id:source.id,inbound_z14_message_id:source.id,rff_li_reference:p.li})
 expect(after.permission.metadata).toMatchObject({marketPermission:{mode:'S18',sourceZ14:source.id,objects:[expect.objectContaining({point:f.point,product:f.product,status:'A74'})]}})
 expect(Number(after.permission.market_state_version)).toBe(Number(before.permission.market_state_version)+1)
 // Only the listed object; the bounded historical period exactly as requested.
 expect(after.sites).toHaveLength(1)
 expect(after.sites[0]).toMatchObject({customer_id:f.ids.customer,facility_id:f.point,status:'approved'})
 expect(after.sites[0].metadata).toMatchObject({source:'inbound_prodat_z14',edielMessageId:source.id,mode:'S18',product:f.product})
 expect(Date.parse(String(after.sites[0].start_at))).toBe(Date.parse(f.fields.data_start))
 expect(Date.parse(String(after.sites[0].end_at))).toBe(Date.parse(f.fields.data_end!))
 // Projection access is never implicit: no grant, no supply, no extra Z13/Z04.
 expect(after.grants).toEqual([]);expect(after.supply).toEqual(before.supply);expect(after.z13).toBe(before.z13)
 expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${lit(f.ids.company)} AND message_code='Z04'`)).toBe(0)
 const acks=await ownAcks(f,source,p.profile)
 // Idempotent replay: no second version, receipt or acknowledgement.
 await processed(f,source)
 expect(market(f,p.permissionId)).toEqual(after);expect((await ownAcks(f,source,p.profile)).acks).toEqual(acks.acks)
 // Another tenant's pending VH permission, created before the source, is untouched.
 expect(market(other.f,other.permissionId)).toEqual(otherBefore)
})

it('customer-bound Z13VH: the DSO-declared installation is the only approved object and grants no access',async()=>{
 // Z13 carries no physical point (CASE-Z13VH); the DSO lawfully names the
 // installation. ESCO-04: only that approved object, never other sites/tenants.
 const p=await pendingVH(),{f}=p,declared='735999260731000014',before=market(f,p.permissionId)
 const source=await receive(f,z14vh(p,{meterPointId:declared}),'Z14',VH_PROFILE)
 await processed(f,source)
 const after=market(f,p.permissionId)
 expect(after.permission).toMatchObject({status:'active',source_z14_message_id:source.id})
 expect(after.sites.map(s=>[s.facility_id,s.status])).toEqual([[declared,'approved']])
 expect(after.grants).toEqual(before.grants);expect(after.supply).toEqual(before.supply)
})

it.each([
 ['S17 reason on the S18 request',{},["CCI++Z13'CAV+S18","CCI++Z13'CAV+S17"]],
 ['foreign LI correlation',{transactionReference:'NO-PRIOR-LI'},null],
 ['broadened report end',{reportEndDate:'2026-09-01T00:00:00Z'},null],
 ['broadened product',{},["CCI++Z14'CAV+::::8716867000030","CCI++Z14'CAV+::::8716867000047"]],
 ['another customer',{customerId:'198001011235'},null],
] as const)('Z14VH with %s cannot create or widen the permission and gets no positive APERAK',async(_name,change,swap)=>{
 const p=await pendingVH(),{f}=p,before=market(f,p.permissionId),base=z14vh(p,change)
 const raw=swap?mutate(base,swap[0],swap[1]):base
 const source=await receive(f,raw,'Z14',swap?.[1].endsWith('S17')?'PRODAT:Z14:V:26.A:r3':VH_PROFILE)
 await processed(f,source)
 const after=market(f,p.permissionId)
 expect(after.permission.status).not.toBe('active');expect(after.permission.source_z14_message_id).toBeNull()
 expect(after.sites.filter(s=>['approved','active'].includes(String(s.status)))).toEqual([])
 expect(after.grants).toEqual(before.grants);expect(after.receipts).toBe(before.receipts)
 expect(positiveAperaks(f,source)).toBe(0)
})

it('Z14VH from a foreign sender role and in the outbound direction is never executed',async()=>{
 const p=await pendingVH(),{f}=p,before=market(f,p.permissionId)
 // Wrong role: the ESCO itself appears as sender of a DSO answer.
 const wrongRole=await receive(f,z14vh(p,{senderEdielId:f.sender,receiverEdielId:f.receiver,legalSenderId:f.sender,legalReceiverId:f.receiver},true),'Z14',VH_PROFILE)
 await processed(f,wrongRole)
 expect(market(f,p.permissionId).permission.status).not.toBe('active');expect(positiveAperaks(f,wrongRole)).toBe(0)
 // Wrong direction: the actual permission adapter refuses before its RPC.
 const valid=await receive(f,z14vh(p),'Z14',VH_PROFILE)
 expect(await applyPermissionMarketSource({actorUserId:f.ids.actor,message:{...valid,direction:'outbound'}})).toMatchObject({applied:false,reason:'not_inbound_permission_source'})
 expect(()=>sql(`UPDATE public.ediel_messages SET direction='outbound' WHERE id=${lit(valid.id)}`)).toThrow(/immutable/)
 expect(market(f,p.permissionId)).toMatchObject({permission:before.permission,sites:before.sites,grants:before.grants})
})

it.each(['223','202','226','322'] as const)('Z14VH missing required field %s is refused before any permission, site or positive APERAK effect',async field=>{
 const p=await pendingVH(),{f}=p,raw=z14vh(p),omitted=omitZ14Field(raw,field)
 expect(omitted).not.toBe(raw)
 const before=market(f,p.permissionId)
 if(field==='223'||field==='202'){
  // Without own field 223 no canonical profile exists: the original is never born.
  await expect(receive(f,omitted,'Z14')).rejects.toThrow(/canonical_inbound_rule_profile_resolution_failed/)
  expect(market(f,p.permissionId)).toEqual(before);return
 }
 const source=await receive(f,omitted,'Z14',VH_PROFILE)
 await processed(f,source)
 const after=market(f,p.permissionId)
 expect(after.permission.status).not.toBe('active');expect(after.sites).toEqual(before.sites);expect(after.grants).toEqual(before.grants)
 expect(positiveAperaks(f,source)).toBe(0)
})

// ----------------------------------------------------------------- Z15V ----
type Active={f:Fixture;permissionId:string;grantId:string;profile:string}
async function activeV():Promise<Active>{
 const f=await seed('V'),a=await qualify(f),profile=ackRoute(f)
 const state=market(f,a.permissionId)
 expect(state.permission.status).toBe('active');expect(state.grants.find(g=>g.id===a.grantId)?.status).toBe('active')
 return {f,permissionId:a.permissionId,grantId:a.grantId,profile}
}
function z15v(a:Active,change:Record<string,unknown>={},asEsco=false){
 const {f}=a,permission=market(f,a.permissionId).permission
 const rendered=renderProdat({code:'Z15',variant:'V',mode:'test',actor:{senderEdielId:f.receiver,receiverEdielId:f.sender},route:{applicationReference:f.app},version,context:{code:'Z15',bgmReference:randomUUID().replaceAll('-','').slice(0,20),transactionReference:String(permission.rff_li_reference),senderEdielId:f.receiver,receiverEdielId:f.sender,legalSenderId:f.receiver,legalReceiverId:f.sender,customerName:'Synthetic Customer',customerId:'199001011234',customerIdCodeListQualifier:'SE2',customerIdAgency:'260',customerCountry:'SE',meterPointId:f.point,siteIdAgency:'9',gridAreaId:'TES',reasonForTransaction:'S17',permissionStatus:'A74',permissionId:String(permission.permission_id),permissionEndDate:end,permissionEndReason:'B79',...change}})
 expect(rendered.issues.filter(x=>x.severity==='error'&&!/_UNDETERMINED$/.test(x.code)),JSON.stringify(rendered.issues)).toEqual([])
 return asEsco?envelope(f,rendered.segments,f.sender,f.receiver):envelope(f,rendered.segments)
}
const V15_PROFILE='PRODAT:Z15:V:26.A:r3'

it('received Z15V/S17 stops distribution: the grant that projected before the end can no longer project after it',async()=>{
 const a=await activeV(),{f}=a
 const incoming=await f.utilts('accepted','Z15V-'+randomUUID().slice(0,8));await incoming.persist()
 const series=sql<{id:string;start:string;end:string}>(`SELECT jsonb_build_object('id',id,'start',period_start,'end',period_end) FROM public.meter_reading_series WHERE company_id=${lit(f.ids.company)} AND source_ediel_message_id=${lit(incoming.source.id)}`)
 sql(`INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,role,is_active,role_key) VALUES(${lit(f.ids.beneficiary)},${lit(f.ids.actor)},'operations','active',now(),'member',true,'operations');INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key) SELECT ${lit(f.ids.actor)},${lit(f.ids.beneficiary)},id,key FROM public.permissions WHERE key='metering.read'`)
 const grantVersion=()=>sql<number>(`SELECT to_jsonb(version) FROM public.ediel_data_access_grants WHERE id=${lit(a.grantId)}`)
 const read=()=>projectEdielSeriesToBeneficiary({beneficiaryCompanyId:f.ids.beneficiary,actorUserId:f.ids.actor,grantId:a.grantId,expectedGrantVersion:grantVersion(),purpose:f.fields.purpose,seriesId:series.id,fields:['quantity'] as const,startInclusive:series.start,endExclusive:series.end})
 // Precondition: the active V permission really distributes before the end.
 expect((await read()).grantId).toBe(a.grantId)
 const source=await receive(f,z15v(a),'Z15',V15_PROFILE)
 await processed(f,source)
 expect(market(f,a.permissionId).permission.status).toBe('ended')
 const refusal=await read().then(()=>null,(e:unknown)=>e as {message?:string;code?:string})
 expect(refusal,'projection after Z15V must be refused').not.toBeNull()
})

it('received Z15V/S17 ends exactly its V permission and objects, versions the end, sends own CONTRL+APERAK and no new Z13',async()=>{
 const a=await activeV(),{f}=a,raw=z15v(a),before=market(f,a.permissionId)
 const physical=tokenizeEdifact(raw)
 expect(EdifactEnvelopeCodec.decode(raw).applicationReference).toBe('23-DGI-PRODAT')
 expect(segmentComposite(physical.segments.find(s=>s.tag==='BGM'),1,physical.una)[0]).toBe('Z15')
 const source=await receive(f,raw,'Z15',V15_PROFILE)
 await processed(f,source)
 const after=market(f,a.permissionId)
 expect(after.permission).toMatchObject({status:'ended',inbound_z15_message_id:source.id})
 expect(after.permission.metadata).toMatchObject({z15:{edielMessageId:source.id,reason:'S17'}})
 expect(Number(after.permission.market_state_version)).toBe(Number(before.permission.market_state_version)+1)
 expect(after.sites).toHaveLength(before.sites.length)
 for(const site of after.sites){
  expect(site).toMatchObject({facility_id:f.point,status:'ended'})
  expect(Date.parse(String(site.permission_end_at))).toBe(Date.parse(end))
 }
 // ST-E07: no automatic new Z13 or Z18 and no supply change. The ended sites
 // are what the projection gate requires to be approved/active.
 expect(after.z13).toBe(before.z13);expect(after.supply).toEqual(before.supply)
 expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${lit(f.ids.company)} AND message_code='Z18'`)).toBe(0)
 const acks=await ownAcks(f,source,a.profile)
 // Idempotent replay: no second version, receipt, acknowledgement or outbox row.
 await processed(f,source)
 expect(market(f,a.permissionId)).toEqual(after);expect((await ownAcks(f,source,a.profile)).acks).toEqual(acks.acks)
})

it('Z15V never ends another tenant permission or a DDQ supply relation',async()=>{
 const a=await activeV(),other=await activeV()
 const otherBefore=market(other.f,other.permissionId),ownSupply=market(a.f,a.permissionId).supply
 const source=await receive(a.f,z15v(a),'Z15',V15_PROFILE)
 await processed(a.f,source)
 expect(market(a.f,a.permissionId).permission.status).toBe('ended')
 expect(market(other.f,other.permissionId)).toEqual(otherBefore)
 expect(market(a.f,a.permissionId).supply).toEqual(ownSupply)
 // A Z15V addressed with the other tenant's permission identity cannot reach it.
 const crossed=await receive(a.f,z15v(a,{permissionId:String(otherBefore.permission.permission_id),transactionReference:String(otherBefore.permission.rff_li_reference)}),'Z15',V15_PROFILE)
 await processed(a.f,crossed)
 expect(market(other.f,other.permissionId)).toEqual(otherBefore);expect(positiveAperaks(a.f,crossed)).toBe(0)
})

it.each([
 ['S18 reason on a V permission',{},["CCI++Z13'CAV+S17","CCI++Z13'CAV+S18"]],
 ['foreign LI correlation',{transactionReference:'NO-PRIOR-LI'},null],
 ['foreign Z09 permission id',{permissionId:'NO-PRIOR-PERMISSION'},null],
 ['foreign object',{meterPointId:'735999260731000014'},null],
] as const)('Z15V with %s does not end the permission and gets no positive APERAK',async(_name,change,swap)=>{
 const a=await activeV(),{f}=a,before=market(f,a.permissionId),base=z15v(a,change)
 const raw=swap?mutate(base,swap[0],swap[1]):base
 const source=await receive(f,raw,'Z15',swap?'PRODAT:Z15:VH:26.A:r3':V15_PROFILE)
 await processed(f,source)
 const after=market(f,a.permissionId)
 expect(after.permission.status).toBe('active');expect(after.sites).toEqual(before.sites);expect(after.grants).toEqual(before.grants)
 expect(positiveAperaks(f,source)).toBe(0)
})

it('Z15V in the outbound direction or from the ESCO role itself is never executed',async()=>{
 const a=await activeV(),{f}=a,before=market(f,a.permissionId)
 const valid=await receive(f,z15v(a),'Z15',V15_PROFILE)
 expect(await applyPermissionMarketSource({actorUserId:f.ids.actor,message:{...valid,direction:'outbound'}})).toMatchObject({applied:false,reason:'not_inbound_permission_source'})
 expect(market(f,a.permissionId).permission.status).toBe('active')
 const wrongRole=await receive(f,z15v(a,{senderEdielId:f.sender,receiverEdielId:f.receiver,legalSenderId:f.sender,legalReceiverId:f.receiver},true),'Z15',V15_PROFILE)
 await processed(f,wrongRole)
 expect(market(f,a.permissionId)).toMatchObject({permission:{status:'active'},sites:before.sites})
 expect(positiveAperaks(f,wrongRole)).toBe(0)
})

it.each(['327','325','226','223','322','324'] as const)('Z15V missing required field %s is refused before ending or positive APERAK',async field=>{
 const a=await activeV(),{f}=a,raw=z15v(a),omitted=omitPermissionField(raw,field)
 expect(omitted).not.toBe(raw)
 const before=market(f,a.permissionId)
 if(field==='223'){
  await expect(receive(f,omitted,'Z15')).rejects.toThrow(/canonical_inbound_rule_profile_resolution_failed/)
  expect(market(f,a.permissionId)).toEqual(before);return
 }
 const source=await receive(f,omitted,'Z15',V15_PROFILE)
 await processed(f,source)
 expect(market(f,a.permissionId)).toMatchObject({permission:{status:'active'},sites:before.sites,grants:before.grants})
 expect(positiveAperaks(f,source)).toBe(0)
})

// ------------------------------------------------- VH history E66 + V/VH ----
// AT-Z14VH-ESCO "E66 enligt bekräftade villkor": the approved S18 history
// window delivers E66 only through a separately published grant, only inside
// that window, and never to another tenant. The window must end before the
// request day; the synthetic E66 measurements are July 2026.
it('Z14VH history: confirmed E66 inside the approved window reaches the beneficiary only through a published grant',async()=>{
 const outsider=await pendingVH(),outsiderBefore=market(outsider.f,outsider.permissionId)
 const p=await pendingVH({start:'2026-06-01T00:00:00Z',end:'2026-08-01T00:00:00Z'}),{f}=p
 await processed(f,await receive(f,z14vh(p),'Z14',VH_PROFILE))
 expect(market(f,p.permissionId).permission.status).toBe('active')
 const link=sql<string>(`SELECT to_jsonb(id) FROM public.ediel_assignment_permission_links WHERE company_id=${lit(f.ids.company)} AND assignment_id=${lit(f.assignment)} AND permission_id=${lit(p.permissionId)}`)
 const grant=await f.command({action:'create_grant',commandId:randomUUID(),assignmentId:f.assignment,expectedVersion:(await currentAssignment(f)).version,fields:{permission_link_id:link,object_ids:[f.point],product_ids:[f.product],fields:f.fields.field_sets,data_start:f.fields.data_start,data_end:f.fields.data_end,valid_from:f.fields.valid_from,valid_to:f.fields.valid_to}})
 expect(grant).toMatchObject({status:'held',accessGranted:false})
 setOwnAckApplication(f,'23-DGI-E66-T')
 // The active S18 permission with only a held grant gives no current service
 // scope: confirmed E66 is not stored for distribution.
 const early=await f.utilts('accepted','Z14VH-E66-'+randomUUID().slice(0,8))
 await expect(early.persist()).rejects.toMatchObject({message:expect.stringContaining('ediel_ack_service_scope_current_grant_required')})
 expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.meter_reading_series WHERE company_id=${lit(f.ids.company)} AND source_ediel_message_id=${lit(early.source.id)}`)).toBe(0)
 expect(await f.command({action:'publish_grant',commandId:randomUUID(),assignmentId:f.assignment,expectedVersion:(await currentAssignment(f)).version,grantId:grant.grantId,expectedGrantVersion:grant.grantVersion})).toMatchObject({status:'active'})
 const incoming=await f.utilts('accepted','Z14VH-E66-'+randomUUID().slice(0,8))
 expect(await incoming.persist()).toMatchObject([{disposition:'accepted',persistenceStatus:'persisted'}])
 const ack=await incoming.ack();await incoming.finalize(ack)
 await expect(assertUtiltsPositiveAckAuthorityForSend(ack)).resolves.toBeUndefined()
 expect(readPhysicalAckSourceCorrelation(ack,incoming.source).classification.outcome).toBe('positive')
 const series=sql<{id:string;start:string;end:string}>(`SELECT jsonb_build_object('id',id,'start',period_start,'end',period_end) FROM public.meter_reading_series WHERE company_id=${lit(f.ids.company)} AND source_ediel_message_id=${lit(incoming.source.id)}`)
 expect(Date.parse(series.start)).toBeGreaterThanOrEqual(Date.parse(f.fields.data_start))
 expect(Date.parse(series.end)).toBeLessThanOrEqual(Date.parse(f.fields.data_end!))
 sql(`INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,role,is_active,role_key) VALUES(${lit(f.ids.beneficiary)},${lit(f.ids.actor)},'operations','active',now(),'member',true,'operations');INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key) SELECT ${lit(f.ids.actor)},${lit(f.ids.beneficiary)},id,key FROM public.permissions WHERE key='metering.read'`)
 const grantVersion=()=>sql<number>(`SELECT to_jsonb(version) FROM public.ediel_data_access_grants WHERE id=${lit(grant.grantId)}`)
 const request=()=>({beneficiaryCompanyId:f.ids.beneficiary,actorUserId:f.ids.actor,grantId:String(grant.grantId),expectedGrantVersion:grantVersion(),purpose:f.fields.purpose,seriesId:series.id,fields:['reading_at','quantity'] as const,startInclusive:series.start,endExclusive:series.end})
 const page=await projectEdielSeriesToBeneficiary(request())
 expect(page.rows.length).toBeGreaterThan(0)
 expect(page.rows).toEqual(sql(`SELECT jsonb_agg(jsonb_build_object('reading_at',reading_at,'quantity',quantity::text) ORDER BY reading_at,id) FROM public.meter_reading_values WHERE series_id=${lit(series.id)} AND reading_at>=${lit(series.start)}::timestamptz AND reading_at<${lit(series.end)}::timestamptz`))
 expect(page.provenance).toMatchObject({sourceMessageId:incoming.source.id,sourceRawHash:createHash('sha256').update(incoming.source.raw_payload!).digest('hex'),sourceRole:'DGI',sourceCode:'E66',receiverRole:'energy_service_company'})
 // Outside the history window, another purpose/field, a stale version or another tenant: refused.
 // The unentitled company is a real beneficiary the actor may read for, so
 // only the grant (not membership) can refuse it.
 sql(`INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,role,is_active,role_key) VALUES(${lit(outsider.f.ids.beneficiary)},${lit(f.ids.actor)},'operations','active',now(),'member',true,'operations');INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key) SELECT ${lit(f.ids.actor)},${lit(outsider.f.ids.beneficiary)},id,key FROM public.permissions WHERE key='metering.read'`)
 // Each refusal comes from its own gate (observed natively): the window and
 // purpose from the grant, a stale version from grant currency, and an
 // unentitled beneficiary from the grant lookup itself.
 for(const [change,code] of [[{startInclusive:'2026-05-01T00:00:00Z'},'ediel_projection_outside_grant'],[{endExclusive:'2026-09-01T00:00:00Z'},'ediel_projection_outside_grant'],[{purpose:'ungranted billing'},'ediel_projection_outside_grant'],[{fields:['secret'] as never},'ediel_projection_outside_grant'],[{expectedGrantVersion:grantVersion()+1},'ediel_grant_not_current'],[{beneficiaryCompanyId:outsider.f.ids.beneficiary},'query returned no rows']] as const){
  await expect(projectEdielSeriesToBeneficiary({...request(),...change}),JSON.stringify(change)).rejects.toMatchObject({message:expect.stringContaining(code)})
 }
 expect(market(outsider.f,outsider.permissionId)).toEqual(outsiderBefore)
})

// AT-Z15V-ESCO "VH slutför historikjobbet, inte separat V-tillstånd": a Z15V
// ends only its continuous V permission, never a coexisting VH history
// permission for the same customer and object. (The Z15VH direction belongs
// to SC-023/ST-E08.)
it('Z15V/S17 ends the V permission and leaves a coexisting VH history permission of the same customer untouched',async()=>{
 const a=await activeV(),{f}=a
 const vh=await pendingVH({f,start:'2026-06-01T00:00:00Z',end:'2026-08-01T00:00:00Z'})
 expect(vh.permissionId).not.toBe(a.permissionId)
 await processed(vh.f,await receive(vh.f,z14vh(vh),'Z14',VH_PROFILE))
 const vhBefore=market(vh.f,vh.permissionId)
 expect(vhBefore.permission.status).toBe('active')
 expect(vhBefore.sites.map(s=>[s.facility_id,s.status])).toEqual([[f.point,'approved']])
 const source=await receive(f,z15v(a),'Z15',V15_PROFILE)
 await processed(f,source)
 expect(market(f,a.permissionId).permission).toMatchObject({status:'ended',inbound_z15_message_id:source.id})
 const vhAfter=market(vh.f,vh.permissionId)
 expect(vhAfter.permission).toEqual(vhBefore.permission);expect(vhAfter.sites).toEqual(vhBefore.sites)
 // ESCO-07: no supply (DDQ) change and no new Z13 from ending V.
 expect(vhAfter.supply).toEqual(vhBefore.supply);expect(vhAfter.z13).toBe(vhBefore.z13)
})

// Source-bound SC-023 hooks: actual mailbox/validation/writer/ACK consumers.
// History jobs never confer beneficiary, DDQ, send or automatic Z13 authority.
function z15vh(p:PendingVH){
 const {f}=p,permission=market(f,p.permissionId).permission
 const rendered=renderProdat({code:'Z15',variant:'VH',mode:'test',actor:{senderEdielId:f.receiver,receiverEdielId:f.sender},route:{applicationReference:f.app},version,
  context:{code:'Z15',bgmReference:randomUUID().replaceAll('-','').slice(0,20),transactionReference:String(permission.rff_li_reference),senderEdielId:f.receiver,receiverEdielId:f.sender,
   legalSenderId:f.receiver,legalReceiverId:f.sender,customerName:'Synthetic Customer',customerId:'199001011234',customerIdCodeListQualifier:'SE2',customerIdAgency:'260',customerCountry:'SE',
   meterPointId:f.point,siteIdAgency:'9',gridAreaId:'TES',reasonForTransaction:'S18',permissionStatus:'A74',permissionId:String(permission.permission_id),
   permissionEndDate:f.fields.data_end,permissionEndReason:'B79'}})
 expect(rendered.issues.filter(x=>x.severity==='error'&&!/_UNDETERMINED$/.test(x.code)),JSON.stringify(rendered.issues)).toEqual([])
 return envelope(f,rendered.segments)
}
const historyRows=(permissionId:string)=>sql<{jobs:Record<string,unknown>[];objects:Record<string,unknown>[];closures:Record<string,unknown>[];skips:Record<string,unknown>[]}>(`SELECT jsonb_build_object(
 'jobs',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.permission_id),'[]') FROM gridex_vh_history.deliveries x WHERE permission_id=${lit(permissionId)}),
 'objects',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.site_id),'[]') FROM gridex_vh_history.objects x WHERE permission_id=${lit(permissionId)}),
 'closures',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.source_message_id,x.site_id),'[]') FROM gridex_vh_history.closures x WHERE permission_id=${lit(permissionId)}),
 'skips',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.source_message_id),'[]') FROM gridex_vh_history.skipped_bases x WHERE permission_id=${lit(permissionId)}))`)

it('finite Z14VH opens its history job and same-chain Z15VH closes it without ending the coexisting V or DDQ relation',async()=>{
 const v=await activeV(),p=await pendingVH({f:v.f,start:'2026-01-01T00:00:00Z',end:'2026-06-01T00:00:00Z'}),{f}=p
 const opening=await receive(f,z14vh(p),'Z14',VH_PROFILE);await processed(f,opening);await ownAcks(f,opening,VH_PROFILE)
 const opened=historyRows(p.permissionId)
 expect(opened.jobs).toHaveLength(1);expect(opened.jobs[0]).toMatchObject({company_id:f.ids.company,permission_id:p.permissionId,opening_source_message_id:opening.id,state:'approved_or_receiving'})
 expect(opened.objects).toHaveLength(1);expect(opened.skips).toEqual([]);expect(opened.closures).toEqual([])
 const vBefore=market(v.f,v.permissionId),before=market(f,p.permissionId)
 const closing=await receive(f,z15vh(p),'Z15','PRODAT:Z15:VH:26.A:r3');await processed(f,closing);await ownAcks(f,closing,'PRODAT:Z15:VH:26.A:r3')
 const closed=historyRows(p.permissionId),after=market(f,p.permissionId)
 expect(closed.jobs[0]).toMatchObject({company_id:f.ids.company,permission_id:p.permissionId,state:'historical_delivery_closed'})
 expect(closed.closures).toHaveLength(1);expect(closed.closures[0]).toMatchObject({company_id:f.ids.company,permission_id:p.permissionId,source_message_id:closing.id,source_payload_hash:createHash('sha256').update(closing.raw_payload!).digest('hex')})
 // No E66 was supplied: a frozen review must report missing coverage. A
 // separately held historical admission may also hold that review, never
 // manufacture complete values or confer beneficiary access.
 expect(['gaps','held']).toContain(closed.closures[0].coverage_status)
 expect(closed.closures[0].review).toMatchObject({approvedStart:opened.objects[0].period_start,approvedEnd:opened.objects[0].period_end,intervals:[],dataAccessGranted:false,gaps:expect.arrayContaining([expect.objectContaining({reason:'missing_values'})])})
 expect(closed.objects).toEqual(opened.objects);expect(closed.skips).toEqual([])
 expect(after.permission).toMatchObject({status:'ended',inbound_z15_message_id:closing.id})
 const vAfter=market(v.f,v.permissionId);expect(vAfter.permission).toEqual(vBefore.permission);expect(vAfter.sites).toEqual(vBefore.sites)
 expect(after.supply).toEqual(before.supply);expect(after.z13).toBe(before.z13)
 await processed(f,closing);expect(historyRows(p.permissionId)).toEqual(closed)
 expect(positiveAperaks(f,closing)).toBe(1)
})

it('admitted NULL-end Z14VH and its same-chain Z15VH preserve primary effects and explicitly skip optional finite history',async()=>{
 const p=await pendingVH(),{f}=p
 const opening=await receive(f,z14vh(p,{reportEndDate:null}),'Z14',VH_PROFILE);await processed(f,opening);await ownAcks(f,opening,VH_PROFILE)
 const opened=historyRows(p.permissionId),before=market(f,p.permissionId)
 expect(before.permission.status).toBe('active');expect(before.sites).toHaveLength(1);expect(before.sites[0]).toMatchObject({status:'approved',end_at:null})
 expect(opened.jobs).toEqual([]);expect(opened.objects).toEqual([]);expect(opened.closures).toEqual([])
 expect(opened.skips).toHaveLength(1);expect(opened.skips[0]).toMatchObject({company_id:f.ids.company,permission_id:p.permissionId,source_message_id:opening.id,opening_source_message_id:opening.id,source_payload_hash:createHash('sha256').update(opening.raw_payload!).digest('hex'),reason:'vh_history_open_ended_approved_window',basis:{status:'skipped',dataAccessGranted:false,transportAuthorityGranted:false}})
 await processed(f,opening);expect(historyRows(p.permissionId)).toEqual(opened)
 const closing=await receive(f,z15vh(p),'Z15','PRODAT:Z15:VH:26.A:r3');await processed(f,closing);await ownAcks(f,closing,'PRODAT:Z15:VH:26.A:r3')
 const closed=historyRows(p.permissionId),after=market(f,p.permissionId)
 expect(after.permission).toMatchObject({status:'ended',inbound_z15_message_id:closing.id});expect(after.sites.every(s=>s.status==='ended')).toBe(true)
 expect(closed.jobs).toEqual([]);expect(closed.objects).toEqual([]);expect(closed.closures).toEqual([]);expect(closed.skips).toHaveLength(2)
 expect(closed.skips.find(row=>row.source_message_id===closing.id)).toMatchObject({company_id:f.ids.company,permission_id:p.permissionId,opening_source_message_id:opening.id,source_payload_hash:createHash('sha256').update(closing.raw_payload!).digest('hex'),reason:'vh_history_open_ended_approved_window',basis:{status:'skipped',dataAccessGranted:false,transportAuthorityGranted:false}})
 expect(after.supply).toEqual(before.supply);expect(after.z13).toBe(before.z13)
 await processed(f,closing);expect(historyRows(p.permissionId)).toEqual(closed)
 expect(positiveAperaks(f,closing)).toBe(1)
})
