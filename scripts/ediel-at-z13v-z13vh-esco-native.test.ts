// masterplan: AT-Z13V-ESCO, AT-Z13VH-ESCO
// Genuine full-schema PostgreSQL/PostgREST consumers after canonical clean
// replay. Only upstream issuer/legal/mail input, counterparty response bytes
// and the SMTP provider are synthetic; they confer no TGT/LIVE market or legal
// approval. The ESCO Z13 is sent through the real request_access command path,
// physically acknowledged (CONTRL, APERAK) and answered (Z14/Z14N) by the DSO.
import {createHash,createHmac,randomUUID} from 'node:crypto'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {seedNativeEscoFixture as seed,resetNativeEscoFixture,nativeEscoSql as sql,nativeEscoLiteral as lit,nativeEscoExternal} from './fixtures/ediel-service-evidence-native'
import {seedOriginalMailboxNative} from './helpers/originalMailboxNative'
import {currentAssignment,setOwnAckApplication,z14Market,z14Wire,receiveZ14,type PendingZ14} from './helpers/ediel-z14v-current-native-fixture'
import {archiveEdielServiceEvidence,readEdielServiceEvidenceArchive,reviewEdielServiceEvidence} from '@/lib/ediel/services/evidenceReview'
import {reviewPeriodicDgiE66Reason} from '@/lib/ediel/services/periodicReason'
import {sendEdielMessageViaSmtp} from '@/lib/ediel/transport'
import {renderProdat} from '@/lib/ediel/prodatEngine'
import {renderContrl2Ediel2} from '@/lib/ediel/contrlEngine'
import {renderAperakEdiel} from '@/lib/ediel/aperakEngine'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {processInboundAckMessage} from '@/lib/ediel/flows/inboundAckProcessing'
import {readCommittedInboundAck} from '@/lib/ediel/ack/committedInboundAck'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {recordReceivedSourceValidation} from '@/lib/ediel/core/receivedSourceValidationLedger'
import {matchOutboundRequestForInbound} from '@/lib/inbound-mail/inboundMatcher'
import {createInboundEdielMessage} from '@/lib/inbound-mail/inboundStatusUpdater'
import {applyPermissionMarketSource} from '@/lib/ediel/permissions/permissionMarketTransition'
import {edielSmtpConfig} from '@/lib/ediel/mailReadiness'
import {getEdielMessageById} from '@/lib/ediel/db'
import type {EdielMessageRow} from '@/lib/ediel/types'

beforeEach(resetNativeEscoFixture)
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks()})
type Fixture=Awaited<ReturnType<typeof seed>>
type Mode='V'|'VH'
type Pending=PendingZ14&{mode:Mode;li:string}
const version={selectedVersion:'E2SE6A',messageTypeToken:'PRODAT:D:97A:UN:E2SE6A'}
const reasonFor=(mode:Mode)=>mode==='V'?'S17':'S18'
const hash=(raw:string)=>createHash('sha256').update(raw).digest('hex')
// V: ongoing reporting with no end. VH: a bounded history window that lies
// wholly before the request day (same window as the qualified Z14VH proof).
const window:Record<Mode,{start:string;end:string|null}>={V:{start:'2026-06-01T00:00:00Z',end:null},VH:{start:'2026-01-01T00:00:00Z',end:'2026-06-01T00:00:00Z'}}

// ------------------------------------------------------ Z13 via request_access
// The same public evidence path as the approved Z14V/Z14VH native proofs. The
// queued Z13 is returned unsent so a test may first attempt to mutate it.
async function queueRequest(mode:Mode){
 let f:Fixture=await seed(mode)
 if(mode==='VH'){
  const fields={...f.fields,mode:'VH' as const,data_start:window.VH.start,data_end:window.VH.end}
  const created=await f.command({action:'create_assignment',commandId:randomUUID(),fields})
  expect(created.status).toBe('held');f={...f,fields,assignment:String(created.assignmentId)}
 }
 setOwnAckApplication(f,f.app)
 const pdf=Buffer.from('%PDF-1.7\nSYNTHETIC CODE FIXTURE ONLY. NO EXTERNAL MARKET OR LEGAL APPROVAL.\n%%EOF')
 const sourceHash=createHash('sha256').update(pdf).digest('hex'),key=Buffer.alloc(32,0x67),keyId=randomUUID()
 sql(`INSERT INTO gridex_ediel_services.issuer_keys(id,company_id,environment,issuer_code,legal_issuer_reference,legal_authority_source_hash,receipt_signing_key,valid_from,valid_to) VALUES(${lit(keyId)},${lit(f.ids.company)},'test','synthetic-native-issuer','SYNTHETIC EXTERNAL REGISTRY INPUT ONLY',${lit(sourceHash)},decode(${lit(key.toString('hex'))},'hex'),'2000-01-01','2099-01-01')`)
 for(const kind of ['end_user_contract','dso_contract','service_contract','downstream_use','privacy_roles'] as const){
  const a=await currentAssignment(f),representation=randomUUID(),reference='z13-'+mode+'-'+kind+'-'+randomUUID()
  const terms={valid_from:f.fields.valid_from,valid_to:f.fields.valid_to,permission_purpose_code:'B72' as const,permission_reporting_frequency:'D',permission_request_grid_area:'TES',
   permission_reporting_term_kind:mode==='V'?'indefinite' as const:'bounded' as const,permission_customer_classification:'private' as const,
   permission_agreement_reference:kind==='end_user_contract'?'SYN-'+f.ids.customer.slice(0,20):null,permission_requested_method:kind==='end_user_contract'?'Z04' as const:null,
   permission_network_contract_start:kind==='dso_contract'?(mode==='V'?'2026-05-01':'2026-01-01'):null,permission_network_contract_end:null}
  const bootstrap=await archiveEdielServiceEvidence({companyId:f.ids.company,actorUserId:f.ids.actor,submission:{assignmentId:f.assignment,scopeBasisVersion:a.scope_basis_version,kind,terms,source:{bytesBase64:pdf.toString('base64'),mimeType:'application/pdf',reference:'z13-bootstrap-'+randomUUID(),version:'synthetic-v1'}}})
  expect(bootstrap.missing).toContain('authentic_current_issuer_and_representation_receipt')
  const canonical=await readEdielServiceEvidenceArchive({companyId:f.ids.company,actorUserId:f.ids.reviewer,artifactId:bootstrap.artifactId})
  sql(`INSERT INTO gridex_ediel_services.issuer_representations(id,company_id,environment,issuer_key_id,legal_actor_id,beneficiary_company_id,customer_id,dso_actor_id,evidence_kind,scope_hash,legal_representation_reference,legal_authority_source_hash,valid_from,valid_to) VALUES(${lit(representation)},${lit(f.ids.company)},'test',${lit(keyId)},${lit(f.ids.legal)},${lit(f.ids.beneficiary)},${lit(f.ids.customer)},${lit(f.ids.dso)},${lit(kind)},${lit(canonical.scopeHash)},'SYNTHETIC EXTERNAL REPRESENTATION INPUT ONLY',${lit(sourceHash)},'2000-01-01','2099-01-01')`)
  const payload={format:'ediel_service_evidence_receipt_v1',issuerCode:'synthetic-native-issuer',receiptId:randomUUID(),companyId:f.ids.company,environment:'test',assignmentId:f.assignment,scopeBasisVersion:canonical.scopeBasisVersion,scope:canonical.scope,evidenceKind:kind,evidenceTerms:canonical.evidenceTerms,
   ...(kind==='dso_contract'||kind==='service_contract'?{periodicE66Reason:{version:1,reasonCode:'E23',applicationReference:'23-DGI-E66-T',senderEdielId:f.receiver,receiverEdielId:f.sender}}:{}),
   sourceHash,sourceReference:reference,sourceVersion:'synthetic-v1',transportRelationId:null,transportActorId:null,issuedAt:new Date().toISOString(),expiresAt:'2090-01-01T00:00:00Z'}
  const wire=Buffer.from(JSON.stringify(payload))
  const artifact=await archiveEdielServiceEvidence({companyId:f.ids.company,actorUserId:f.ids.actor,submission:{assignmentId:f.assignment,scopeBasisVersion:a.scope_basis_version,kind,terms,source:{bytesBase64:pdf.toString('base64'),mimeType:'application/pdf',reference,version:'synthetic-v1'},issuerReceipt:{keyId,representationId:representation,payloadBase64:wire.toString('base64'),signatureHex:createHmac('sha256',key).update(wire).digest('hex')}}})
  expect(artifact.missing).toEqual(['separate_qualified_reviewer_required'])
  const staged=await f.command({action:'stage_evidence',commandId:randomUUID(),assignmentId:f.assignment,expectedVersion:(await currentAssignment(f)).version,fields:{kind,source_reference:reference,source_sha256:sourceHash,source_version:'synthetic-v1',...terms}})
  expect(staged).toMatchObject({status:'pending',approvalGranted:false})
  const review={decision:'approve',reason:'Separate synthetic CODE review of public canonical scope, signed archive and exact bytes',sourceHash:artifact.sourceHash,scopeHash:artifact.scopeHash}
  expect(await reviewEdielServiceEvidence({companyId:f.ids.company,actorUserId:f.ids.reviewer,artifactId:artifact.artifactId,evidenceId:String(staged.evidenceId),review})).toMatchObject({status:'verified',missing:[],marketActivationGranted:false})
  if(kind==='dso_contract'||kind==='service_contract')expect(await reviewPeriodicDgiE66Reason({companyId:f.ids.company,actorUserId:f.ids.reviewer,artifactId:artifact.artifactId,evidenceId:String(staged.evidenceId),review:{...review,reason:'Separate review of synthetic signed DGI E23 clause'}})).toMatchObject({status:'approved',reasonCode:'E23',marketActivationGranted:false})
 }
 expect(await f.command({action:'approve_assignment',commandId:randomUUID(),assignmentId:f.assignment,expectedVersion:(await currentAssignment(f)).version})).toMatchObject({status:'approved_waiting_permission'})
 const prepared=await f.command({action:'request_access',assignmentId:f.assignment,expectedVersion:(await currentAssignment(f)).version,preferredRouteId:f.ids.route})
 expect(prepared,JSON.stringify(prepared)).toMatchObject({status:'queued',message:{message_code:'Z13'},blockingReasons:[]})
 return {f,queued:prepared.message as EdielMessageRow}
}
async function sendRequest(f:Fixture,queued:EdielMessageRow,mode:Mode):Promise<Pending>{
 const sends=nativeEscoExternal.send.mock.calls.length
 await sendEdielMessageViaSmtp(queued,{actorUserId:f.ids.actor,smtpMimeMode:'nodemailer-attachment'})
 expect(nativeEscoExternal.send).toHaveBeenCalledTimes(sends+1)
 const z13=(await getEdielMessageById(queued.id))!;expect(z13.status).toBe('sent')
 const permission=sql<{id:string;li:string}>(`SELECT jsonb_build_object('id',id,'li',rff_li_reference) FROM public.metering_permissions WHERE company_id=${lit(f.ids.company)} AND source_z13_message_id=${lit(z13.id)}`)
 expect(permission.id).toMatch(/^[0-9a-f-]{36}$/)
 return {f,permissionId:permission.id,li:permission.li,z13,bounded:mode==='VH',mode}
}
async function request(mode:Mode){const {f,queued}=await queueRequest(mode);return sendRequest(f,queued,mode)}

// Durable market/business state of the request's tenant. Supply periods, Z04
// (supply-side metering) and Z13 counts prove "inte elleverans" throughout.
function state(p:Pick<Pending,'f'|'permissionId'>){
 const c=lit(p.f.ids.company)
 return {...z14Market(p),...sql<{z04:number;z13:number;switches:Record<string,unknown>[];correlations:number}>(`SELECT jsonb_build_object(
 'z04',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${c} AND message_code='Z04'),
 'z13',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${c} AND message_code='Z13'),
 'switches',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.supplier_switch_requests s WHERE company_id=${c}),
 'correlations',(SELECT count(*) FROM gridex_ack_authority.source_correlations x JOIN public.ediel_messages m ON m.id=x.source_message_id WHERE m.company_id=${c}))`)}
}
function noRights(s:ReturnType<typeof state>,before:ReturnType<typeof state>){
 expect(s.permission.status).not.toBe('active');expect(s.permission.source_z14_message_id).toBeNull();expect(s.permission.inbound_z14_message_id).toBeNull()
 expect(Number(s.permission.market_state_version)).toBe(0)
 expect(s.sites.filter(x=>['approved','active'].includes(String(x.status)))).toEqual([])
 expect(s.grants).toEqual(before.grants);expect(s.receipts).toEqual(before.receipts)
 expect(s.supply).toEqual(before.supply);expect(s.switches).toEqual(before.switches);expect(s.z04).toBe(0);expect(s.z13).toBe(before.z13)
}

// ------------------------------------------------- physical counterparty ACKs
function externalAck(z13:EdielMessageRow,family:'CONTRL'|'APERAK',defect?:'unknown'|'wrongLI'){
 const e=EdifactEnvelopeCodec.decode(z13.raw_payload!)
 let segments=family==='CONTRL'?renderContrl2Ediel2({source:{rawPayload:z13.raw_payload},outcome:'positive'}).segments:renderAperakEdiel({source:{id:z13.id,messageFamily:'PRODAT',messageCode:'Z13',rawPayload:z13.raw_payload},refs:{},externalReference:randomUUID(),transactionReference:randomUUID(),outcome:'positive'}).segments
 if(defect==='unknown')segments=segments.map(s=>s.startsWith('UCI+')?s.replace(/^(UCI\+)[^+]*/,'$1UNKNOWN'):s.startsWith('RFF+ACW:')?'RFF+ACW:UNKNOWN':s)
 if(defect==='wrongLI')segments=segments.map(s=>s.startsWith('RFF+LI:')?'RFF+LI:UNKNOWN':s)
 return EdifactEnvelopeCodec.encode({sender:e.receiver!,receiver:e.sender!,senderQualifier:e.receiverQualifier,receiverQualifier:e.senderQualifier,senderSubAddress:e.receiverSubAddress,receiverSubAddress:e.senderSubAddress,applicationReference:e.applicationReference,acknowledgementRequest:false,environment:'test',interchangeReference:randomUUID().replaceAll('-','').slice(0,14),messages:[{messageReference:randomUUID().replaceAll('-','').slice(0,14),messageTypeToken:family==='CONTRL'?'CONTRL:2:2:UN:EDIEL2':'APERAK:D:96A:UN:E2SE6A',businessSegments:segments}]})
}
async function receiveAck(p:Pending,raw:string){
 const {f}=p
 const mail=await seedOriginalMailboxNative(sql,lit,{companyId:f.ids.company,environment:'test',raw,smtpFrom:edielSmtpConfig().from,senderEmail:'dso-native@example.invalid'})
 const outboundMatch=await matchOutboundRequestForInbound({companyId:f.ids.company,parsed:mail.parsed,inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId})
 const id=await createInboundEdielMessage({companyId:f.ids.company,actorUserId:f.ids.actor,environment:'test',inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId,parsed:mail.parsed,outboundMatch})
 expect(id).toBeTruthy();if(!id)throw new Error('actual_z13_ack_intake_required')
 const message=(await getEdielMessageById(id))!
 expect(message).toMatchObject({company_id:f.ids.company,direction:'inbound',inbound_email_message_id:mail.inboundEmailMessageId,raw_payload:raw})
 expect(Date.parse(message.message_received_at!)).toBeGreaterThan(Date.parse(p.z13.message_sent_at!))
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(message)
 expect(await recordReceivedSourceValidation({original:message,validated:message,resolvedCompanyId:f.ids.company,decision})).toMatchObject({status:'recorded'})
 return {message,decision}
}
async function acknowledge(p:Pending){
 const acks:EdielMessageRow[]=[]
 for(const family of ['CONTRL','APERAK'] as const){
  const before=state(p),{message,decision}=await receiveAck(p,externalAck(p.z13,family))
  expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision.issues)).toEqual(['accepted','accepted','accepted'])
  expect(await processInboundAckMessage({actorUserId:p.f.ids.actor,message})).toMatchObject({outcome:'positive',sourceMessage:{id:p.z13.id},sourceAccepted:family==='APERAK',finalAckReached:family==='APERAK'})
  expect(await readCommittedInboundAck({actorUserId:p.f.ids.actor,message})).toMatchObject({kind:'exact_receipt',sourceMessageId:p.z13.id,result:{outcome:'positive',sourceAccepted:family==='APERAK'}})
  expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ack_authority.source_correlations WHERE ack_message_id=${lit(message.id)} AND source_message_id=${lit(p.z13.id)} AND ack_payload_hash=${lit(hash(message.raw_payload!))}`)).toBe(1)
  const after=state(p)
  // CONTRL alone is technical: the request is still only sent. The completed
  // CONTRL+APERAK pair projects ONLY the customer-waiting phase.
  if(family==='CONTRL')expect(after.permission).toEqual(before.permission)
  else expect(after.permission).toEqual({...before.permission,status:'waiting_for_customer_approval',updated_at:after.permission.updated_at,updated_by:p.f.ids.actor})
  noRights(after,before);acks.push(message)
 }
 const z13=(await getEdielMessageById(p.z13.id))!
 expect(z13).toMatchObject({contrl_status:'received',aperak_status:'received',raw_payload:p.z13.raw_payload})
 return acks
}

// ----------------------------------------------------- DSO business answers
function z14(p:Pending,change:Record<string,unknown>={}){
 if(p.mode==='V')return z14Wire(p,change)
 const {f}=p
 const rendered=renderProdat({code:'Z14',variant:'VH',mode:'test',actor:{senderEdielId:f.receiver,receiverEdielId:f.sender},route:{applicationReference:f.app},version,context:{code:'Z14',bgmReference:randomUUID().replaceAll('-','').slice(0,20),transactionReference:p.li,senderEdielId:f.receiver,receiverEdielId:f.sender,legalSenderId:f.receiver,legalReceiverId:f.sender,customerName:'Synthetic Customer',customerId:'199001011234',customerIdCodeListQualifier:'SE2',customerIdAgency:'260',customerCountry:'SE',meterPointId:f.point,gridAreaId:'TES',reasonForTransaction:'S18',permissionStatus:'A74',permissionPurpose:'B72',permissionId:'SYNTHETIC-PERMISSION-'+p.permissionId.slice(0,8),permissionTimestamp:new Date().toISOString(),reportStartDate:f.fields.data_start,reportEndDate:f.fields.data_end,reportingFrequency:'D',energyProductId:f.product,observationLength:'60',observationLengthFormat:'806',meteringMethod:'Z04',installationDirection:'E19',siteAddress:'Synthetic Street 1',siteCity:'Teststad',sitePostalCode:'12345',siteCountry:'SE',siteIdAgency:'9',...change}})
 expect(rendered.issues.filter(x=>x.severity==='error'&&!/_UNDETERMINED$/.test(x.code)),JSON.stringify(rendered.issues)).toEqual([])
 return EdifactEnvelopeCodec.encode({sender:f.receiver,receiver:f.sender,applicationReference:f.app,interchangeReference:randomUUID().replaceAll('-','').slice(0,20),environment:'test',acknowledgementRequest:true,messages:[{messageReference:'1',messageTypeToken:version.messageTypeToken,businessSegments:rendered.segments}]})
}
function z14n(p:Pending){
 const {f}=p
 const rendered=renderProdat({code:'Z14',variant:'N',mode:'test',actor:{senderEdielId:f.receiver,receiverEdielId:f.sender},route:{applicationReference:f.app},version,context:{code:'Z14',customerName:'',meterPointId:'',bgmReference:randomUUID().replaceAll('-','').slice(0,20),transactionReference:p.li,senderEdielId:f.receiver,receiverEdielId:f.sender,legalSenderId:f.receiver,legalReceiverId:f.sender,reasonForTransaction:'Z96',permissionStatus:'A13'}})
 expect(rendered.issues.filter(x=>x.severity==='error'&&!/_UNDETERMINED$/.test(x.code)),JSON.stringify(rendered.issues)).toEqual([])
 return EdifactEnvelopeCodec.encode({sender:f.receiver,receiver:f.sender,applicationReference:f.app,interchangeReference:randomUUID().replaceAll('-','').slice(0,14),environment:'test',acknowledgementRequest:true,messages:[{messageReference:'1',messageTypeToken:version.messageTypeToken,businessSegments:rendered.segments}]})
}
async function process(p:Pending,source:EdielMessageRow){
 await processInboundEdielMessage({actorUserId:p.f.ids.actor,edielMessageId:source.id})
 const actual=(await getEdielMessageById(source.id))!
 expect(actual.raw_payload).toBe(source.raw_payload)
 return actual
}
function positiveAperaks(p:Pending,source:EdielMessageRow){
 return sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${lit(p.f.ids.company)} AND related_message_id=${lit(source.id)} AND direction='outbound' AND message_family='APERAK' AND ack_outcome='positive'`)
}

describe.each([['V','S17'],['VH','S18']] as const)('Z13%s/%s ESCO request',(mode,reason)=>{
 it('real request_access sends a DGI Z13 with identityless LIN+1, correlated CONTRL then APERAK move it only to customer waiting',async()=>{
  const outsider=await request(mode),outsiderBefore=state(outsider)
  const p=await request(mode),before=state(p)
  const sent=tokenizeEdifact(p.z13.raw_payload!),envelope=EdifactEnvelopeCodec.decode(p.z13.raw_payload!)
  expect(envelope.applicationReference).toBe('23-DGI-PRODAT');expect([envelope.sender,envelope.receiver]).toEqual([p.f.sender,p.f.receiver])
  expect(segmentComposite(sent.segments.find(s=>s.tag==='BGM'),1,sent.una)[0]).toBe('Z13')
  expect(segmentComposite(sent.segments[sent.segments.findIndex(s=>s.tag==='CCI'&&segmentComposite(s,2,sent.una)[0]==='Z13')+1],1,sent.una)[0]).toBe(reason)
  expect(sent.segments.filter(s=>s.tag==='LIN').map(s=>segmentComposite(s,1,sent.una)[0])).toEqual(['1'])
  expect(segmentComposite(sent.segments.find(s=>s.tag==='LIN'),3,sent.una).some(Boolean)).toBe(false)
  // Customer identity is the national identity, never a birth date.
  expect(segmentComposite(sent.segments.find(s=>s.tag==='NAD'&&segmentComposite(s,1,sent.una)[0]==='UD'),2,sent.una)).toEqual(['199001011234','SE2','260'])
  expect(sent.segments.some(s=>s.tag==='DTM'&&segmentComposite(s,1,sent.una)[0]==='329')).toBe(false)
  // The service scope/beneficiary stays internal: no tenant identifiers on the wire.
  for(const internal of [p.f.ids.company,p.f.ids.beneficiary,p.f.assignment,p.permissionId])expect(p.z13.raw_payload).not.toContain(internal)
  expect(p.z13).toMatchObject({direction:'outbound',message_family:'PRODAT',message_code:'Z13',company_id:p.f.ids.company,customer_id:p.f.ids.customer})
  expect(sql(`SELECT jsonb_build_object('hash',immutable_payload_hash,'sealed',immutable_rendered_at IS NOT NULL) FROM public.ediel_messages WHERE id=${lit(p.z13.id)}`)).toEqual({hash:hash(p.z13.raw_payload!),sealed:true})
  // A sent request alone confers nothing (the permission stays in its request phase).
  expect(before.permission).toMatchObject({status:'z13_ready',source_z13_message_id:p.z13.id,outbound_z13_message_id:p.z13.id,rff_li_reference:p.li})
  noRights(before,before)
  const acks=await acknowledge(p),waiting=state(p)
  expect(waiting.permission.status).toBe('waiting_for_customer_approval')
  expect(waiting.correlations).toBe(before.correlations+2)
  // Replaying both physical ACKs is idempotent and still grants nothing.
  for(const message of acks){
   expect(await processInboundAckMessage({actorUserId:p.f.ids.actor,message})).toMatchObject({outcome:'positive',sourceMessage:{id:p.z13.id}})
   expect(state(p)).toEqual(waiting)
  }
  // The DSO answers only with Z14 or Z14N; the ACK pair alone creates no answer.
  expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${lit(p.f.ids.company)} AND direction='inbound' AND message_code='Z14'`)).toBe(0)
  expect(state(outsider)).toEqual(outsiderBefore)
 },240000)

 it('APERAK alone, an unknown CONTRL interchange and a wrong-LI APERAK change nothing',async()=>{
  const p=await request(mode),before=state(p)
  for(const [family,defect] of [['CONTRL','unknown'],['APERAK','wrongLI']] as const){
   const {message,decision}=await receiveAck(p,externalAck(p.z13,family,defect))
   expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision.issues)).toEqual(['accepted','manual_review','manual_review'])
   expect(decision.issues.map(i=>i.code)).toContain('CANONICAL_ACK_SOURCE_EVIDENCE_UNAVAILABLE')
   expect(await processInboundAckMessage({actorUserId:p.f.ids.actor,message})).toMatchObject({sourceMessage:null,sourceAccepted:false,finalAckReached:false})
   expect(await readCommittedInboundAck({actorUserId:p.f.ids.actor,message})).toBeNull()
   expect(state(p)).toEqual(before)
  }
  // A correctly correlated APERAK without the technical CONTRL never projects the waiting phase.
  const {message,decision}=await receiveAck(p,externalAck(p.z13,'APERAK'))
  expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision.issues)).toEqual(['accepted','accepted','accepted'])
  expect(await processInboundAckMessage({actorUserId:p.f.ids.actor,message})).toMatchObject({outcome:'positive',sourceMessage:{id:p.z13.id}})
  const after=state(p)
  expect(after.permission).toEqual(before.permission);noRights(after,before)
  expect((await getEdielMessageById(p.z13.id))!.raw_payload).toBe(p.z13.raw_payload)
 },240000)

 it('positive Z14 after the ACK pair creates exactly the requested object rights, idempotently, with no supply or grant',async()=>{
  const outsider=await request(mode),outsiderBefore=state(outsider)
  const p=await request(mode);await acknowledge(p)
  const before=state(p),raw=z14(p),physical=tokenizeEdifact(raw)
  expect(EdifactEnvelopeCodec.decode(raw).applicationReference).toBe('23-DGI-PRODAT')
  expect(segmentComposite(physical.segments[physical.segments.findIndex(s=>s.tag==='CCI'&&segmentComposite(s,2,physical.una)[0]==='Z13')+1],1,physical.una)[0]).toBe(reason)
  const source=await receiveZ14(p,raw)
  expect(state(p)).toEqual(before)
  await process(p,source)
  const after=state(p)
  expect(after.permission).toMatchObject({status:'active',source_z14_message_id:source.id,inbound_z14_message_id:source.id,rff_li_reference:p.li,source_z13_message_id:p.z13.id})
  expect(after.permission.metadata).toMatchObject({marketPermission:{mode:reason,sourceZ14:source.id,objects:[expect.objectContaining({point:p.f.point,product:p.f.product,status:'A74'})]}})
  expect(Number(after.permission.market_state_version)).toBe(1)
  expect(after.sites).toHaveLength(1)
  expect(after.sites[0]).toMatchObject({customer_id:p.f.ids.customer,facility_id:p.f.point,status:'approved',metering_permission_id:p.permissionId})
  expect(after.sites[0].metadata).toMatchObject({source:'inbound_prodat_z14',edielMessageId:source.id,mode:reason,product:p.f.product})
  expect(Date.parse(String(after.sites[0].start_at))).toBe(Date.parse(window[mode].start))
  if(mode==='VH')expect(Date.parse(String(after.sites[0].end_at))).toBe(Date.parse(window.VH.end!))
  else expect(after.sites[0].end_at).toBeNull()
  // Object rights only: projection access, supply and new requests are never implied.
  expect(after.grants).toEqual([]);expect(after.supply).toEqual(before.supply);expect(after.switches).toEqual(before.switches)
  expect(after.z04).toBe(0);expect(after.z13).toBe(before.z13)
  expect(after.receipts).toHaveLength(1);expect(after.receipts[0]).toMatchObject({source_message_id:source.id,qualified_original_message_id:p.z13.id,permission_id:p.permissionId,company_id:p.f.ids.company})
  expect(positiveAperaks(p,source)).toBe(1)
  // Replay of the same Z14: no second version, site, receipt or ACK.
  await process(p,source)
  expect(state(p)).toEqual(after);expect(positiveAperaks(p,source)).toBe(1)
  expect(await applyPermissionMarketSource({actorUserId:p.f.ids.actor,message:(await getEdielMessageById(source.id))!,expectedPermissionId:p.permissionId})).toMatchObject({applied:true,idempotent:true,permissionId:p.permissionId,status:'active'})
  expect(state(p)).toEqual(after)
  expect(state(outsider)).toEqual(outsiderBefore)
  expect((await getEdielMessageById(p.z13.id))!.raw_payload).toBe(p.z13.raw_payload)
 },240000)

 it('Z14N after the ACK pair records the denial and creates no object right, grant or supply',async()=>{
  const p=await request(mode);await acknowledge(p)
  const before=state(p),source=await receiveZ14(p,z14n(p))
  await process(p,source)
  const after=state(p)
  expect(after.permission).toMatchObject({status:'rejected_active',inbound_z14_message_id:source.id,approved_start_at:null,approved_end_at:null})
  expect(after.sites).toEqual(before.sites);expect(after.sites.filter(s=>['approved','active'].includes(String(s.status)))).toEqual([])
  expect(after.grants).toEqual(before.grants);expect(after.supply).toEqual(before.supply);expect(after.z04).toBe(0);expect(after.z13).toBe(before.z13)
  await process(p,source)
  expect(state(p)).toEqual(after)
 },240000)

 it('wrong role, wrong direction and a mutated outbound Z13 are never executed',async()=>{
  // Mutation of the queued request before it leaves: the sealed original refuses it.
  const {f,queued}=await queueRequest(mode),bytes=queued.raw_payload!
  const other=reason==='S17'?'S18':'S17'
  expect(bytes.split(`CAV+${reason}'`)).toHaveLength(2)
  expect(()=>sql(`UPDATE public.ediel_messages SET raw_payload=replace(raw_payload,${lit(`CAV+${reason}'`)},${lit(`CAV+${other}'`)}) WHERE id=${lit(queued.id)}`)).toThrow(/immutable/)
  expect((await getEdielMessageById(queued.id))!.raw_payload).toBe(bytes)
  const p=await sendRequest(f,queued,mode)
  expect(p.z13.raw_payload).toBe(bytes)
  expect(()=>sql(`UPDATE public.ediel_messages SET raw_payload=raw_payload||'changed' WHERE id=${lit(p.z13.id)}`)).toThrow(/immutable/)
  expect(()=>sql(`UPDATE public.ediel_messages SET direction='inbound' WHERE id=${lit(p.z13.id)}`)).toThrow(/immutable/)
  await acknowledge(p)
  const before=state(p)
  // Wrong direction: the outbound request itself and an outbound-labelled answer are refused before any RPC.
  expect(await applyPermissionMarketSource({actorUserId:f.ids.actor,message:p.z13})).toMatchObject({applied:false,reason:'not_inbound_permission_source'})
  const valid=await receiveZ14(p,z14(p))
  expect(await applyPermissionMarketSource({actorUserId:f.ids.actor,message:{...valid,direction:'outbound'}})).toMatchObject({applied:false,reason:'not_inbound_permission_source'})
  expect(()=>sql(`UPDATE public.ediel_messages SET direction='outbound' WHERE id=${lit(valid.id)}`)).toThrow(/immutable/)
  expect(state(p)).toEqual(before)
  // Wrong role: the ESCO no longer holds its current market role.
  sql(`UPDATE public.tenant_actor_roles SET role_code='supplier' WHERE company_id=${lit(f.ids.company)} AND actor_id=${lit(f.ids.legal)} AND environment='test' AND role_code='energy_service_company'`)
  await process(p,valid)
  const after=state(p)
  expect(after.permission).toEqual(before.permission);noRights(after,before);expect(positiveAperaks(p,valid)).toBe(0)
 },240000)
})
