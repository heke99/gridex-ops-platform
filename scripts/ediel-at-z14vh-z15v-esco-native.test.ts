// masterplan: AT-Z14VH-ESCO, AT-Z15V-ESCO, SC-031
// Genuine full-schema PostgreSQL/PostgREST consumers after canonical clean
// replay. Only upstream legal/issuer/mail input and the SMTP provider are
// synthetic; they confer no TGT/LIVE market or legal approval.
import {createHash,createHmac,randomUUID} from 'node:crypto'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import type {SupabaseClient} from '@supabase/supabase-js'
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
import {segmentComposite,segmentElementCount,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {prepareNativeEscoPermissionFixture} from './fixtures/ediel-service-evidence-native'
import {seedNormalSwitchNativeFixture} from './helpers/ediel-normal-switch-native-fixture'
import {createInboundEdielMessage} from '@/lib/inbound-mail/inboundStatusUpdater'
import {matchOutboundRequestForInbound,matchMeteringPointForInbound} from '@/lib/inbound-mail/inboundMatcher'
import {resolveCanonicalRuntimeDecisionWithRegistry,readReceivedCanonicalProdatApplicationObjects} from '@/lib/ediel/core/runtimeDecision'
import {bindReceivedProdatIgnoredFields} from '@/lib/ediel/core/receivedProdatIgnoredFieldBinding'
import {recordReceivedSourceValidation} from '@/lib/ediel/core/receivedSourceValidationLedger'
import {captureFreshEdielSourceRulePackEvidence} from '@/lib/ediel/core/sourceRulePackEvidence'
import {approveEdielInboundCase,createOrUpdateInboundProdatCase,type EdielInboundCaseRow} from '@/lib/ediel/inboundCases'
import {supabaseService} from '@/lib/supabase/service'
import {readReceivedProdatApplicationObjects} from '@/lib/ediel/core/receivedProdatApplicationObjects'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {edielCodeLabel} from '@/lib/ediel/codeLabels'
import {guideOrderedFixtureBody,guideOrderedFixtureRaw} from '../__tests__/helpers/prodatGuideOrderedFixture'
import {characteristic,type Parts} from '../__tests__/fixtures/prodat-register'
import {nationalRescissionNativeChain} from './helpers/nationalRescissionNative'
import {prepareIndependentNationalEndTarget} from './helpers/ediel-z05-independent-end-native-fixture'

// Only the new national prerequisite uses this real disposable Auth client.
// Other cases retain the original server-client factory and SMTP fixture.
const sc031Auth=vi.hoisted(()=>({client:null as SupabaseClient|null}))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/supabase/server',async original=>{
 const actual=await original<typeof import('@/lib/supabase/server')>()
 return {...actual,createSupabaseServerClient:async()=>sc031Auth.client??actual.createSupabaseServerClient()}
})
afterEach(()=>{sc031Auth.client=null})

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
 const opening=await receive(f,z14vh(p),'Z14',VH_PROFILE);await processed(f,opening);await ownAcks(f,opening,p.profile)
 const opened=historyRows(p.permissionId)
 expect(opened.jobs).toHaveLength(1);expect(opened.jobs[0]).toMatchObject({company_id:f.ids.company,permission_id:p.permissionId,opening_source_message_id:opening.id,state:'approved_or_receiving'})
 expect(opened.objects).toHaveLength(1);expect(opened.skips).toEqual([]);expect(opened.closures).toEqual([])
 const vBefore=market(v.f,v.permissionId),before=market(f,p.permissionId)
 const closing=await receive(f,z15vh(p),'Z15','PRODAT:Z15:VH:26.A:r3');await processed(f,closing);await ownAcks(f,closing,p.profile)
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

// The actual signed request is bounded. Omitting its own reply end is a
// field-321 rejection, not an admitted open-ended primary history effect.
// The separately declared SQL component preserves already-admitted NULL-end
// primary effects; this public VH producer requires a finite historical end.
it('bounded Z14VH missing own report end gets a correlated negative APERAK and leaves every market/history effect unchanged on retry',async()=>{
 const p=await pendingVH(),{f}=p,c=lit(f.ids.company)
 const snapshot=()=>sql(`SELECT jsonb_build_object(
  'permissions',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]') FROM public.metering_permissions x WHERE company_id=${c}),
  'sites',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]') FROM public.metering_permission_sites x WHERE company_id=${c}),
  'grants',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]') FROM public.ediel_data_access_grants x WHERE company_id=${c}),
  'supply',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]') FROM public.customer_supply_periods x WHERE company_id=${c}),
  'assignments',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]') FROM public.ediel_service_assignments x WHERE company_id=${c}),
  'links',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]') FROM public.ediel_assignment_permission_links x WHERE company_id=${c}),
  'z13',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]') FROM public.ediel_messages x WHERE company_id=${c} AND message_code='Z13'),
  'receipts',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]') FROM gridex_received_sources.permission_effect_receipts x WHERE company_id=${c}),
  'transitions',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.source_message_id,x.permission_id),'[]') FROM gridex_received_sources.permission_effect_transitions_v1 x WHERE company_id=${c}))`)
 const before=snapshot(),historyBefore=historyRows(p.permissionId)
 expect(historyBefore).toEqual({jobs:[],objects:[],closures:[],skips:[]})
 const raw=z14vh(p,{reportEndDate:null}),wire=tokenizeEdifact(raw)
 expect(wire.segments.filter(s=>s.tag==='DTM'&&segmentComposite(s,1,wire.una)[0]==='91')).toEqual([])
 const requestWire=tokenizeEdifact(p.z13.raw_payload!)
 expect(requestWire.segments.filter(s=>s.tag==='DTM'&&segmentComposite(s,1,requestWire.una)[0]==='91')).toHaveLength(1)
 const source=await receive(f,raw,'Z14',VH_PROFILE),actual=await processed(f,source)
 expect(actual.validation_report).toMatchObject({applicationDecision:'rejected',canonicalRuntime:{issues:expect.arrayContaining([
  expect.objectContaining({code:'PRODAT_RECEIVED_REPORTING_321_MISSING',prodatDiagnostic:expect.objectContaining({kind:'field',fieldNumber:'321',errorKind:'missing'})}),
 ])}})
 expect(snapshot()).toEqual(before);expect(historyRows(p.permissionId)).toEqual(historyBefore)
 expect(positiveAperaks(f,source)).toBe(0)
 const readAcks=()=>sql<{acks:EdielMessageRow[];outbox:Record<string,unknown>[]}>(`SELECT jsonb_build_object(
  'acks',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.message_family,a.id),'[]') FROM public.ediel_messages a WHERE related_message_id=${lit(source.id)} AND direction='outbound'),
  'outbox',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.id),'[]') FROM public.ediel_outbox o WHERE source_message_id=${lit(source.id)} OR EXISTS(SELECT FROM public.ediel_messages a WHERE a.id=o.ediel_message_id AND a.related_message_id=${lit(source.id)} AND a.direction='outbound')))`)
 const acks=readAcks()
 expect(acks.acks.map(a=>a.message_family)).toEqual(['APERAK','CONTRL'])
 expect(acks.outbox).toHaveLength(2)
 const env=EdifactEnvelopeCodec.decode(raw),line=wire.segments.find(s=>s.tag==='LIN')!
 const document=segmentComposite(wire.segments.find(s=>s.tag==='BGM'),2,wire.una)[0]
 for(const ack of acks.acks){
  const outcome=ack.message_family==='APERAK'?'negative':'positive'
  expect(ack).toMatchObject({company_id:f.ids.company,environment:'test',direction:'outbound',related_message_id:source.id,ack_outcome:outcome})
  expect(validateEdifactEnvelope(ack.raw_payload!).syntaxOk).toBe(true)
  const ackEnv=EdifactEnvelopeCodec.decode(ack.raw_payload!)
  expect([ackEnv.sender,ackEnv.receiver]).toEqual([env.receiver,env.sender])
  const correlation=readPhysicalAckSourceCorrelation(ack,source)
  expect(correlation.classification.outcome).toBe(outcome)
  if(ack.message_family==='CONTRL')expect(correlation.acknowledgedReferences).toEqual([env.interchangeReference])
  else{
   expect(ack.route_profile_id).toBe(p.profile)
   expect(correlation.lookupReferences).toContainEqual({type:'BGM_REF',value:document})
   expect(correlation.acknowledgedReferences).toEqual([p.li])
   expect(correlation.prodatObjectOutcomes).toEqual([{objectId:f.point,identityAgency:'9',firstLineIndex:line.index,lineItemReference:p.li,outcome:'negative'}])
  }
  expect(acks.outbox.filter(o=>o.ediel_message_id===ack.id)).toEqual([expect.objectContaining({company_id:f.ids.company,source_message_id:source.id,message_family:ack.message_family,ack_outcome:outcome})])
 }
 await processed(f,source)
 expect(snapshot()).toEqual(before);expect(historyRows(p.permissionId)).toEqual(historyBefore)
 expect(readAcks()).toEqual(acks);expect(positiveAperaks(f,source)).toBe(0)
})

// --------------------------------------------------------------- SC-031 ----
// Native assertions, NOT a local mocked graph. The existing ordinary lane
// must supply its real current canonical replay and local PostgREST backend.
// Reintroducing raw ignored319 into staging/onboarding must break these
// field-value oracles; counts alone cannot satisfy them. Native source phase
// does not claim these new cases have executed.
type Sc031Row=Record<string,unknown>
const sc031Sha=(text:string)=>createHash('sha256').update(text).digest('hex')
function sc031Master(companyId:string){
 return sql<{customers:Sc031Row[];sites:Sc031Row[];meters:Sc031Row[]}>(`SELECT jsonb_build_object(
 'customers',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]') FROM public.customers c WHERE company_id=${lit(companyId)}),
 'sites',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.customer_sites s WHERE company_id=${lit(companyId)}),
 'meters',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.id),'[]') FROM public.metering_points m WHERE company_id=${lit(companyId)}))`)
}
function sc031SourceEvidence(companyId:string,sourceId:string,assessmentId:string){
 return sql<{source:Sc031Row;assessment:Sc031Row;ignored:Sc031Row;application:Sc031Row;receptions:Sc031Row[];mail:Sc031Row}>(`SELECT jsonb_build_object(
 'source',(SELECT to_jsonb(s) FROM gridex_received_sources.sources s WHERE company_id=${lit(companyId)} AND source_message_id=${lit(sourceId)}),
 'assessment',(SELECT to_jsonb(a) FROM gridex_received_sources.validation_assessments a WHERE company_id=${lit(companyId)} AND source_message_id=${lit(sourceId)} AND id=${lit(assessmentId)}),
 'ignored',(SELECT to_jsonb(i) FROM gridex_received_sources.prodat_ignored_field_facets i WHERE company_id=${lit(companyId)} AND source_message_id=${lit(sourceId)} AND canonical_assessment_id=${lit(assessmentId)}),
 'application',(SELECT to_jsonb(a) FROM gridex_received_sources.prodat_application_facets a WHERE company_id=${lit(companyId)} AND source_message_id=${lit(sourceId)} AND assessment_id=${lit(assessmentId)}),
 'receptions',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM gridex_ediel_inbound_receptions.receptions r WHERE company_id=${lit(companyId)} AND source_message_id=${lit(sourceId)}),
 'mail',(SELECT to_jsonb(m) FROM public.inbound_email_messages m JOIN public.ediel_messages e ON e.inbound_email_message_id=m.id AND e.company_id=m.company_id WHERE e.company_id=${lit(companyId)} AND e.id=${lit(sourceId)}))`)
}
function sc031ActualAcks(companyId:string,sourceId:string){
 return sql<{acks:EdielMessageRow[];outbox:Sc031Row[]}>(`SELECT jsonb_build_object(
 'acks',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]') FROM public.ediel_messages a WHERE company_id=${lit(companyId)} AND direction='outbound' AND related_message_id=${lit(sourceId)}),
 'outbox',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.id),'[]') FROM public.ediel_outbox o WHERE company_id=${lit(companyId)} AND source_message_id=${lit(sourceId)}))`)
}
function sc031BindEvidence(companyId:string,message:EdielMessageRow,assessmentId:string){
 const evidence=sc031SourceEvidence(companyId,message.id,assessmentId),hash=sc031Sha(message.raw_payload!)
 expect(evidence.source).toMatchObject({company_id:companyId,source_message_id:message.id,environment:'test',origin:'database_insert',raw_payload:message.raw_payload,payload_hash:hash})
 expect(evidence.source.received_context).toEqual((message.execution_context_snapshot as Sc031Row)?.receivedProdatContext)
 expect(Date.parse(String(evidence.source.source_received_at))).toBe(Date.parse(String(message.message_received_at)))
 expect(evidence.assessment).toMatchObject({id:assessmentId,company_id:companyId,source_message_id:message.id,environment:'test',source_payload_hash:hash})
 expect(sc031Sha(String(evidence.assessment.facts_text))).toBe(evidence.assessment.facts_hash)
 expect(evidence.ignored).toMatchObject({canonical_assessment_id:assessmentId,company_id:companyId,source_message_id:message.id,environment:'test',source_payload_hash:hash})
 expect(sc031Sha(String(evidence.ignored.fields_text))).toBe(evidence.ignored.fields_hash)
 expect(evidence.application).toMatchObject({assessment_id:assessmentId,company_id:companyId,source_message_id:message.id,environment:'test',source_payload_hash:hash})
 expect(sc031Sha(String(evidence.application.application_facts_text))).toBe(evidence.application.application_facts_hash)
 expect(evidence.mail.raw_edifact_payload).toBe(message.raw_payload)
 expect(evidence.receptions).toHaveLength(1)
 expect(evidence.receptions[0]).toMatchObject({source_message_id:message.id,company_id:companyId,environment:'test',classification:'first_reception',canonical_payload_hash:hash,received_payload_hash:hash,inbound_email_message_id:message.inbound_email_message_id})
 expect(Date.parse(String(evidence.mail.received_at))).toBe(Date.parse(String(evidence.receptions[0].received_at)))
 const fields=bindReceivedProdatIgnoredFields(JSON.parse(String(evidence.ignored.fields_text)),message.raw_payload!)
 expect(fields).not.toBeNull()
 return {evidence,fields:fields!}
}
type Sc031Supplier=Awaited<ReturnType<typeof sc031Supplier>>
async function sc031Supplier(subtype:'L'|'LK',extra:boolean,count:1|2){
 const base=await seedNormalSwitchNativeFixture({deferOriginal:true}),document='S'+randomUUID().replaceAll('-','').slice(0,13).toUpperCase()
 // Agency89 point labels are independent prospective fixture identities,
 // not immutable existing masterdata or a fabricated accepted source.
 const points=Array.from({length:count},(_,i)=>String.fromCharCode(65+i)+randomUUID().replaceAll('-','').slice(0,23).toUpperCase())
 const markers=points.map((_,i)=>'SC031-IGNORED-'+i)
 const reason=subtype==='L'?'Z22':'Z23'
 const segments=[`UNH+${document}+PRODAT:D:97A:UN:E2SE6A`,`BGM+Z04+${document}+9+AB`,'DTM+137:202610011200:203','DTM+ZZZ:1:805',`NAD+FR+${base.receiver}:160:SVK+++++++SE`,`NAD+DO+${base.sender}:160:SVK+++++++SE`,
  ...points.flatMap((point,i)=>[`LIN+${i+1}++${point}:::89`,'DTM+92:202611010000:203','DTM+354:15:806',`QTY+31:${i+1}00:KWH`,'CCI++Z13',`CAV+${reason}`,'CCI++Z04','CAV+Z03','CCI++Z07','CAV+Z12','CCI++Z12','CAV+:::W','CCI++Z15','CAV+Z32','CCI++Z14','CAV+:::L917:8716867000030','CCI++Z02','CAV+:::1','CCI++Z05','CAV+:::6','CCI++Z16','CAV+:::111',`RFF+MG:METER-${i}`,'RFF+Z05:TES',`RFF+LI:SC031-CASE-${i}`,...(extra?[`RFF+Z07:${markers[i]}`]:[]),`NAD+UD+CUSTOMER${i}::89++Synthetic ${i}+Testgatan+Teststad++12345+SE`,`NAD+IT+${point}::89+++Testgatan+Teststad++12345+SE`,`NAD+Z02+${base.brpEdielId}:160:SVK`])]
 const raw=`UNA:+.? 'UNB+UNOC:3+${base.receiver}:14+${base.sender}:14+261001:1200+${document}++23-DDQ-PRODAT++1++1'${segments.join("'")}'UNT+${segments.length+1}+${document}'UNZ+1+${document}'`
 expect(validateEdifactEnvelope(raw).syntaxOk).toBe(true)
 sql(`INSERT INTO public.permissions(key,name,is_active) VALUES('communication.write','Synthetic SC031 communication',true),('customers.write','Synthetic SC031 customer',true) ON CONFLICT(key) DO NOTHING;
 INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key,effect,status,is_active) SELECT ${lit(base.actorUserId)},${lit(base.companyId)},p.id,p.key,'allow','active',true FROM public.permissions p WHERE p.key IN('communication.write','customers.write');`)
 const masterBefore=sc031Master(base.companyId)
 const mail=await seedOriginalMailboxNative(sql,lit,{companyId:base.companyId,environment:'test',raw,smtpFrom:edielSmtpConfig().from})
 const outboundMatch=await matchOutboundRequestForInbound({companyId:base.companyId,parsed:mail.parsed,inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId})
 const meteringPointMatch=await matchMeteringPointForInbound({companyId:base.companyId,parsed:mail.parsed})
 const sourceId=await createInboundEdielMessage({companyId:base.companyId,actorUserId:base.actorUserId,environment:'test',inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId,parsed:mail.parsed,outboundMatch,meteringPointMatch})
 expect(sourceId).toMatch(/^[a-f0-9-]{36}$/)
 const message=(await getEdielMessageById(sourceId!))!
 expect(message).toMatchObject({company_id:base.companyId,direction:'inbound',environment:'test',message_code:'Z04',rule_profile_key:`PRODAT:Z04:${subtype}:26.A:r3`,raw_payload:raw,inbound_email_message_id:mail.inboundEmailMessageId})
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(message,{actorUserId:base.actorUserId})
 expect({syntax:decision.syntaxDecision,application:decision.applicationDecision,functional:decision.functionalDecision},JSON.stringify(decision.issues)).toEqual({syntax:'accepted',application:'accepted',functional:'accepted'})
 const application=readReceivedCanonicalProdatApplicationObjects(decision,message)
 expect(application?.headerDecision).toBe('accepted')
 expect(application?.objects.map(o=>[o.objectId,o.identityAgency,o.applicationDecision])).toEqual(points.map(point=>[point,'89','accepted']))
 const ignored=bindReceivedProdatIgnoredFields(decision.prodatIgnoredFields,raw)
 expect(ignored).not.toBeNull()
 expect(ignored!.filter(field=>field.fieldNumber==='319').map(field=>field.occurrence.objectId)).toEqual(extra?points:[])
 const recorded=await recordReceivedSourceValidation({original:message,validated:message,resolvedCompanyId:base.companyId,decision})
 expect(recorded.status).toBe('recorded')
 if(recorded.status!=='recorded')throw Error('SC031_native_real_canonical_receipt_required')
 await captureFreshEdielSourceRulePackEvidence(base.companyId,message.id)
 const bound=sc031BindEvidence(base.companyId,message,recorded.assessmentId)
 expect(bound.fields).toEqual(ignored)
 // Actual intake/ACK processing, then actual source-owned staging. No mocked
 // positive plan or accepted/private facet is inserted by this test.
 await processInboundEdielMessage({actorUserId:base.actorUserId,edielMessageId:message.id})
 const stored=(await getEdielMessageById(message.id))!
 expect(stored.validation_report).toMatchObject({syntaxDecision:'accepted',applicationDecision:'accepted'})
 expect(stored.raw_payload).toBe(raw)
 const inboundCase=await createOrUpdateInboundProdatCase({actorUserId:base.actorUserId,message:stored})
 expect(inboundCase?.status).toBe('pending_review')
 expect(inboundCase?.parsed_metering_point.referenceToMeteringPoint).toBeNull()
 expect(inboundCase?.parsed_production.referenceToMeteringPoint).toBeNull()
 expect(sc031Master(base.companyId)).toEqual(masterBefore)
 if(count===2){
  const protectedSource=await supabaseService.rpc('ediel_read_prodat_object_batch_source_v1',{p_company_id:base.companyId,p_source_message_id:message.id,p_actor_user_id:base.actorUserId})
  expect(protectedSource.error).toBeNull()
  expect(protectedSource.data).toMatchObject({version:1,assessmentId:recorded.assessmentId,sourcePayloadHash:sc031Sha(raw),sourceMessage:{id:message.id,company_id:base.companyId,raw_payload:raw}})
 }else{
  // A single object is a valid complete canonical application, while the
  // native batch owner deliberately requires at least two. This existing
  // service read binds the committed original/current owner, not actor/role
  // approval; the actual single approval and graph consumers remain below.
  const single=await readReceivedProdatApplicationObjects({companyId:base.companyId,sourceMessageId:message.id,rawPayload:raw})
  expect(single).not.toBeNull()
  expect(single).toMatchObject({assessmentId:recorded.assessmentId,sourcePayloadHash:sc031Sha(raw),owner:'canonical-prodat-application-all-v1',coverage:'canonical_own_application_only',headerDecision:'accepted'})
  expect(single!.objects).toHaveLength(1)
  expect(single!.objects).toEqual(application!.objects)
  expect(single!.objects[0]).toMatchObject({objectId:points[0],identityAgency:'89',applicationDecision:'accepted'})
 }
 const acks=sc031ActualAcks(base.companyId,message.id)
 expect(acks.acks.filter(a=>a.message_family==='APERAK'&&a.ack_outcome==='negative')).toEqual([])
 expect(acks.acks.filter(a=>a.message_family==='APERAK'&&a.ack_outcome==='positive')).toEqual([])
 // No native supply receipt exists for these unmatched prospective points;
 // generic onboarding alone cannot manufacture a positive domain reply.
 const finalPlan=await readReceivedProdatFinalResponsePlan({companyId:base.companyId,sourceMessageId:message.id,rawPayload:raw})
 expect(finalPlan?.plans??[]).toEqual([])
 return {...base,subtype,extra,points,markers,raw,mail,message:stored,case:inboundCase!,assessmentId:recorded.assessmentId,sourceEvidence:bound.evidence,masterBefore,processingAcks:acks}
}
function sc031SupplierApprove(f:Sc031Supplier){
 return approveEdielInboundCase({companyId:f.companyId,actorUserId:f.actorUserId,caseId:f.case.id,
  ...(f.points.length===1?{mode:'create_new_customer' as const}:{objectDecisions:f.points.map(meteringPointId=>({meteringPointId,identityAgency:'89',mode:'create_new_customer' as const}))})})
}
type Sc031Graph={operation:Sc031Row;customer:Sc031Row;site:Sc031Row;meter:Sc031Row;application:Sc031Row}
function sc031ResultGraphs(f:Sc031Supplier,applied:EdielInboundCaseRow){
 const ids=f.points.length===1?[String(applied.review_decision?.onboardingOperationId)]:sql<string[]>(`SELECT coalesce(jsonb_agg(operation_id ORDER BY object_key),'[]') FROM gridex_prodat_object_batch.graph_receipts WHERE company_id=${lit(f.companyId)} AND case_id=${lit(f.case.id)} AND source_message_id=${lit(f.message.id)}`)
 expect(ids).toHaveLength(f.points.length)
 return ids.map(id=>{
  expect(id).toMatch(/^[a-f0-9-]{36}$/)
  const graph=sql<Sc031Graph>(`SELECT jsonb_build_object('operation',to_jsonb(o),'customer',to_jsonb(c),'site',to_jsonb(s),'meter',to_jsonb(m),'application',to_jsonb(a))
   FROM public.customer_onboarding_operations o
   JOIN public.customers c ON c.id=(o.result_snapshot->>'customer_id')::uuid AND c.company_id=o.company_id
   JOIN public.customer_sites s ON s.id=(o.result_snapshot->>'site_id')::uuid AND s.company_id=o.company_id AND s.customer_id=c.id
   JOIN public.metering_points m ON m.id=(o.result_snapshot->>'metering_point_id')::uuid AND m.company_id=o.company_id AND m.customer_id=c.id AND m.site_id=s.id
   JOIN public.customer_onboarding_applications a ON a.id=(o.result_snapshot->>'application_id')::uuid AND a.company_id=o.company_id AND a.onboarding_operation_id=o.id AND a.customer_id=c.id AND a.customer_site_id=s.id AND a.metering_point_id=m.id
   WHERE o.company_id=${lit(f.companyId)} AND o.id=${lit(id)}`)
  expect(graph).toBeTruthy()
  expect(graph.operation).toMatchObject({id,company_id:f.companyId,channel:'ediel_inbound',status:'completed'})
  const command=graph.operation.command_snapshot as {actor_user_id:string;company_id:string;customer:Sc031Row;site:Sc031Row;metering_point:Sc031Row;application:{source_record_type:string;source_record_id:string;payload_snapshot:Sc031Row}}
  expect(command).toMatchObject({company_id:f.companyId,actor_user_id:f.actorUserId})
  expect(graph.meter.ediel_reference).toBeNull()
  expect(command.metering_point.ediel_reference).toBeNull()
  expect(graph.site.internal_notes).toBe(command.site.internal_notes)
  expect(String(graph.site.internal_notes)).not.toContain('SC031-IGNORED-')
  expect(JSON.stringify({customer:command.customer,site:command.site,meter:command.metering_point})).not.toContain('SC031-IGNORED-')
  // Raw register snapshots intentionally retain the ignored reference. They
  // are source evidence, not the meter/site/customer business command.
  const rawRegisters=JSON.stringify(command.application.payload_snapshot.prodatRegisters)
  expect(rawRegisters.includes('SC031-IGNORED-')).toBe(f.extra)
  expect(graph.application).toMatchObject({company_id:f.companyId,onboarding_operation_id:id,customer_id:graph.customer.id,customer_site_id:graph.site.id,metering_point_id:graph.meter.id,channel:'ediel_inbound',source_record_type:'ediel_inbound_case',source_record_id:command.application.source_record_id,status:'committed'})
  expect(graph.application.payload_snapshot).toEqual(command.application.payload_snapshot)
  expect((graph.application.payload_snapshot as Sc031Row).edielMessageId).toBe(f.message.id)
  expect(graph.customer).toMatchObject({id:(graph.operation.result_snapshot as Sc031Row).customer_id,company_id:f.companyId})
  expect(graph.site).toMatchObject({id:(graph.operation.result_snapshot as Sc031Row).site_id,company_id:f.companyId,customer_id:graph.customer.id,grid_owner_id:f.gridId})
  expect(graph.meter).toMatchObject({id:(graph.operation.result_snapshot as Sc031Row).metering_point_id,company_id:f.companyId,customer_id:graph.customer.id,site_id:graph.site.id,grid_owner_id:f.gridId})
  expect(f.points).toContain(graph.meter.meter_point_id)
  expect(graph.meter.metering_point_id).toBe(graph.meter.meter_point_id)
  expect(graph.site.facility_id).toBe(graph.meter.meter_point_id)
  expect(graph.meter.site_facility_id).toBe(graph.meter.meter_point_id)
  expect(command.site.facility_id).toBe(graph.site.facility_id)
  expect(command.metering_point.meter_point_id).toBe(graph.meter.meter_point_id)
  const index=f.points.indexOf(String(graph.meter.meter_point_id))
  expect(graph.customer).toMatchObject({customer_type:'private',status:'draft',first_name:'Synthetic',last_name:String(index),full_name:`Synthetic ${index}`,source:'ediel_inbound'})
  expect(graph.site).toMatchObject({site_type:'consumption',status:'draft',street:'Testgatan',postal_code:'12345',city:'Teststad',country:'SE',annual_consumption_kwh:(index+1)*100})
  expect(graph.meter).toMatchObject({status:'draft',measurement_type:'consumption',is_settlement_relevant:true})
  return graph
 }).sort((a,b)=>f.points.indexOf(String(a.meter.meter_point_id))-f.points.indexOf(String(b.meter.meter_point_id)))
}
function sc031Business(graph:Sc031Graph,ownPoint:string){
 const pick=(row:Sc031Row,keys:readonly string[])=>Object.fromEntries(keys.map(key=>[key,row[key]??null]))
 // Physical point labels are prospective per-cohort inputs, not ignored data:
 // their exact values/relationships are asserted above. Normalize ONLY that
 // one explicit identity in a fixture-derived site name; do not omit notes,
 // addresses, reference, production or any other projected business field.
 const site=pick(graph.site,['site_name','site_type','status','move_in_date','annual_consumption_kwh','street','postal_code','city','country','internal_notes'])
 site.site_name=String(site.site_name).replaceAll(ownPoint,'<OWN-PHYSICAL-POINT>')
 return {customer:pick(graph.customer,['customer_type','status','first_name','last_name','full_name','company_name','personal_number','org_number','source']),
  site,meter:pick(graph.meter,['ediel_reference','status','measurement_type','reading_frequency','start_date','is_settlement_relevant'])}
}
for(const subtype of ['L','LK'] as const)for(const count of [1,2] as const){
 it(`SC031 ${subtype} ${count===1?'single':'two own objects'}: ignored319 preserves real staged and committed customer/site/meter business values and original lineage`,async()=>{
  const baseline=await sc031Supplier(subtype,false,count),extra=await sc031Supplier(subtype,true,count)
  const baselineApplied=await sc031SupplierApprove(baseline),extraApplied=await sc031SupplierApprove(extra)
  expect(baselineApplied.status).toBe('applied');expect(extraApplied.status).toBe('applied')
  const baselineGraphs=sc031ResultGraphs(baseline,baselineApplied),extraGraphs=sc031ResultGraphs(extra,extraApplied)
  expect(extraGraphs.map((g,i)=>sc031Business(g,extra.points[i]))).toEqual(baselineGraphs.map((g,i)=>sc031Business(g,baseline.points[i])))
  // Preserve complete seeded sibling graphs, not only new customer counts.
  for(const f of [baseline,extra]){
   const after=sc031Master(f.companyId)
   expect(after.customers.filter(r=>f.masterBefore.customers.some(old=>old.id===r.id))).toEqual(f.masterBefore.customers)
   expect(after.sites.filter(r=>f.masterBefore.sites.some(old=>old.id===r.id))).toEqual(f.masterBefore.sites)
   expect(after.meters.filter(r=>f.masterBefore.meters.some(old=>old.id===r.id))).toEqual(f.masterBefore.meters)
   expect(after.customers).toHaveLength(f.masterBefore.customers.length+count)
   expect(after.sites).toHaveLength(f.masterBefore.sites.length+count)
   expect(after.meters).toHaveLength(f.masterBefore.meters.length+count)
   const evidence=sc031BindEvidence(f.companyId,f.message,f.assessmentId)
   expect(evidence.evidence).toEqual(f.sourceEvidence)
   expect((await getEdielMessageById(f.message.id))?.raw_payload).toBe(f.raw)
   expect(sc031ActualAcks(f.companyId,f.message.id)).toEqual(f.processingAcks)
   if(count===1)await expect(sc031SupplierApprove(f)).rejects.toThrow(/Inbound-caset har status applied/)
   else expect((await sc031SupplierApprove(f)).status).toBe('applied')
   expect(sc031Master(f.companyId)).toEqual(after)
   expect(sc031ActualAcks(f.companyId,f.message.id)).toEqual(f.processingAcks)
  }
 },120000)
}
function sc031N(p:Awaited<ReturnType<typeof prepareNativeEscoPermissionFixture>>,f:Fixture,extra:boolean,scalarProbe=false){
 const rendered=renderProdat({code:'Z14',variant:'N',mode:'test',actor:{senderEdielId:f.receiver,receiverEdielId:f.sender},route:{applicationReference:f.app},version,
  context:{code:'Z14',customerName:'',meterPointId:'',bgmReference:randomUUID().replaceAll('-','').slice(0,20),transactionReference:p.li,senderEdielId:f.receiver,receiverEdielId:f.sender,legalSenderId:f.receiver,legalReceiverId:f.sender,reasonForTransaction:'Z96',permissionStatus:'A76'}})
 expect(rendered.issues.filter(x=>x.severity==='error'&&!/_UNDETERMINED$/.test(x.code))).toEqual([])
 const segments=structuredClone(rendered.segments)
 if(scalarProbe&&extra){
  // Four canonical-minus Z14 fields on this same physical own LIN. Keep
  // SG8 dates before SG14 characteristics, SG16 references before SG17 NAD.
  const line=segments.findIndex(segment=>segment.startsWith('LIN+'))
  expect(line).toBeGreaterThanOrEqual(0)
  expect(segments.filter(segment=>segment.startsWith('LIN+'))).toHaveLength(1)
  segments.splice(line+1,0,'DTM+329:19900101:102','DTM+51:202610011200:203')
  const refs=segments.findIndex((segment,index)=>index>line&&/^(RFF|NAD)\+/.test(segment))
  expect(refs).toBeGreaterThan(line)
  segments.splice(refs,0,'CCI++Z07','CAV+Z12','RFF+ANJ:SC031-SCALAR-ANJ')
 }
 if(extra){
  // Extra national parents, with legal D97A NAD shapes and unchanged actual
  // own N object, register, LI and request. Never change accepted receipts.
  segments.push('NAD+UD+199001011234:SE2:260++SC031 Ignored Person+SC031 Ignored Street+SC031 Ignored City++54321+NO')
  segments.push('NAD+IT+SC031-IGNORED-IT::89+++SC031 Ignored Site+SC031 Ignored City++54321+NO')
 }
 return envelope(f,segments)
}
async function sc031NativeN(extra:boolean,scalarProbe=false){
 const f=await seed(),p=await prepareNativeEscoPermissionFixture(f),profile=ackRoute(f),before=sc031Master(f.ids.company),raw=sc031N(p,f,extra,scalarProbe)
 expect(validateEdifactEnvelope(raw).syntaxOk).toBe(true)
 const source=await receive(f,raw,'Z14','PRODAT:Z14:N:26.A:r3'),stored=await processed(f,source)
 expect(stored.validation_report).toMatchObject({syntaxDecision:'accepted',applicationDecision:'accepted'})
 const permission=market(f,p.permissionId)
 expect(permission.permission).toMatchObject({status:'rejected_passive_timeout',inbound_z14_message_id:source.id})
 expect(permission.sites).toEqual([])
 const plan=await readReceivedProdatFinalResponsePlan({companyId:f.ids.company,sourceMessageId:source.id,rawPayload:raw})
 expect(plan?.plans).toHaveLength(1)
 expect(plan!.plans[0]).toMatchObject({effectKind:'metering_permission',outcome:'positive'})
 const bound=sc031BindEvidence(f.ids.company,stored,plan!.plans[0].canonicalAssessmentId)
 const parents=bound.fields.filter(field=>['END_USER_GROUP','INSTALLATION_GROUP'].includes(field.fieldNumber))
 expect(parents.map(field=>field.fieldNumber).sort()).toEqual(extra?['END_USER_GROUP','INSTALLATION_GROUP']:[])
 const staged=await createOrUpdateInboundProdatCase({actorUserId:f.ids.actor,message:stored})
 expect(staged).not.toBeNull()
 expect(staged?.parsed_customer.personalNumber).toBeNull()
 expect(staged?.parsed_customer.fullName).not.toBe('SC031 Ignored Person')
 expect(staged?.parsed_site.street).not.toBe('SC031 Ignored Site')
 expect(staged?.parsed_site.city).not.toBe('SC031 Ignored City')
 let persisted:EdielInboundCaseRow|null=null
 if(scalarProbe){
  const wire=tokenizeEdifact(raw),groups=prodatRegisterGroups(wire.segments,wire.una,'Z14').groups
  expect(groups).toHaveLength(1)
  const own=groups[0],ownRaw=own.segments.map(segment=>segment.raw)
  expect(own.lineIndex).toBe(0)
  expect(own.firstLineIndex).toBe(0)
  expect(own.validRegisterChain).toBe(true)
  const scalars=[
   {field:'249',tokens:['DTM+329:19900101:102']},
   {field:'261',tokens:['RFF+ANJ:SC031-SCALAR-ANJ']},
   {field:'306',tokens:['CCI++Z07','CAV+Z12']},
   {field:'212',tokens:['DTM+51:202610011200:203']},
  ]
  for(const scalar of scalars){
   for(const token of scalar.tokens)expect(ownRaw.filter(segment=>segment===token)).toHaveLength(extra?1:0)
   if(scalar.field==='306'&&extra)expect(ownRaw[ownRaw.indexOf('CCI++Z07')+1]).toBe('CAV+Z12')
   const ignored=bound.fields.filter(field=>field.fieldNumber===scalar.field)
   expect(ignored).toHaveLength(extra?1:0)
   if(extra)expect(ignored[0]).toMatchObject({fieldNumber:scalar.field,sourceRule:'PRODAT26A:P119',occurrence:{scope:'object',lineIndex:own.lineIndex,lineNumber:own.lineNumber,registerPosition:1,objectId:own.itemId,identityAgency:own.identityAgency,lineItemReference:p.li,messageReference:segmentComposite(wire.segments.find(segment=>segment.tag==='UNH'),1,wire.una)[0]}})
  }
  persisted=sql<EdielInboundCaseRow>(`SELECT to_jsonb(c) FROM public.ediel_inbound_cases c WHERE company_id=${lit(f.ids.company)} AND ediel_message_id=${lit(source.id)} AND id=${lit(staged!.id)}`)
  expect(persisted).toMatchObject({id:staged!.id,company_id:f.ids.company,ediel_message_id:source.id})
  for(const column of ['parsed_customer','parsed_site','parsed_metering_point','parsed_contract','parsed_production'] as const)expect(persisted[column]).toEqual(staged![column])
  expect(persisted.parsed_customer.birthDate).toBeNull()
  expect(persisted.parsed_contract.agreementReference).toBeNull()
  expect(persisted.parsed_metering_point.firstMeterReadingDate).toBeNull()
  expect(persisted.parsed_production.installationStatus).toBeNull()
  expect(persisted.parsed_production.installationStatusLabel).toBe(edielCodeLabel('installation_status',null))
  const registers=persisted.parsed_metering_point.registers as {rawSegments:string[]}[]
  expect(registers).toHaveLength(1)
  expect(registers[0].rawSegments).toEqual(ownRaw)
 }
 const acks=sc031ActualAcks(f.ids.company,source.id)
 expect(acks.acks.map(a=>a.message_family).sort()).toEqual(['APERAK','CONTRL'])
 for(const ack of acks.acks){
  expect(ack).toMatchObject({company_id:f.ids.company,environment:'test',direction:'outbound',related_message_id:source.id,ack_outcome:'positive'})
  expect(validateEdifactEnvelope(ack.raw_payload!).syntaxOk).toBe(true)
  const physical=readPhysicalAckSourceCorrelation(ack,source)
  expect(physical.classification.outcome).toBe('positive')
  expect(physical.acknowledgedReferences).toContain(ack.message_family==='CONTRL'?EdifactEnvelopeCodec.decode(raw).interchangeReference:p.li)
  const outer=EdifactEnvelopeCodec.decode(ack.raw_payload!)
  expect([outer.sender,outer.receiver]).toEqual([f.sender,f.receiver])
  if(ack.message_family==='APERAK'){
   expect(ack.route_profile_id).toBe(profile)
   const wire=tokenizeEdifact(raw),line=wire.segments.find(segment=>segment.tag==='LIN')!
   expect(physical.prodatObjectOutcomes).toMatchObject([{objectId:null,firstLineIndex:line.index,lineItemReference:p.li,outcome:'positive'}])
   expect(physical.lookupReferences).toContainEqual({type:'BGM_REF',value:segmentComposite(wire.segments.find(segment=>segment.tag==='BGM'),2,wire.una)[0]})
  }
  expect(acks.outbox.filter(o=>o.ediel_message_id===ack.id)).toEqual([expect.objectContaining({company_id:f.ids.company,source_message_id:source.id,ack_outcome:'positive',message_family:ack.message_family})])
 }
 expect(acks.outbox).toHaveLength(2)
 expect(sc031Master(f.ids.company)).toEqual(before)
 const graphCount=()=>sql<number>(`SELECT to_jsonb(count(*)) FROM public.customer_onboarding_operations WHERE company_id=${lit(f.ids.company)} AND channel='ediel_inbound'`)
 expect(graphCount()).toBe(0)
 const held=await supabaseService.rpc('ediel_read_prodat_object_batch_source_v1',{p_company_id:f.ids.company,p_source_message_id:source.id,p_actor_user_id:f.ids.actor})
 expect(held.error).not.toBeNull()
 expect(held.error?.message).toMatch(/prodat_object_batch_current_receiver_role_required/)
 expect(graphCount()).toBe(0)
 expect(sc031Master(f.ids.company)).toEqual(before)
 expect(sc031ActualAcks(f.ids.company,source.id)).toEqual(acks)
 expect(sc031BindEvidence(f.ids.company,stored,plan!.plans[0].canonicalAssessmentId).evidence).toEqual(bound.evidence)
 await processed(f,source)
 expect(sc031Master(f.ids.company)).toEqual(before)
 expect(sc031ActualAcks(f.ids.company,source.id)).toEqual(acks)
 // Registers retain physical raw parents and can legitimately differ. Only
 // their business projection is compared; exact raw/facet custody above is
 // asserted separately and must not be erased to obtain equality.
 const {registers,...meterBusiness}=staged!.parsed_metering_point
 expect(Array.isArray(registers)).toBe(true)
 expect(JSON.stringify(registers).includes('SC031 Ignored')).toBe(extra)
 if(scalarProbe){
  expect((await getEdielMessageById(source.id))?.raw_payload).toBe(raw)
  expect(sc031BindEvidence(f.ids.company,stored,plan!.plans[0].canonicalAssessmentId).evidence).toEqual(bound.evidence)
  const after=sql<EdielInboundCaseRow>(`SELECT to_jsonb(c) FROM public.ediel_inbound_cases c WHERE company_id=${lit(f.ids.company)} AND ediel_message_id=${lit(source.id)} AND id=${lit(staged!.id)}`)
  for(const column of ['parsed_customer','parsed_site','parsed_metering_point','parsed_contract','parsed_production'] as const)expect(after[column]).toEqual(persisted![column])
  const {registers:rawRegisters,...persistedMeter}=persisted!.parsed_metering_point
  return {customer:persisted!.parsed_customer,site:persisted!.parsed_site,meter:persistedMeter,contract:persisted!.parsed_contract,production:persisted!.parsed_production,rawRegisters}
 }
 return {customer:staged!.parsed_customer,site:staged!.parsed_site,meter:meterBusiness,production:staged!.parsed_production}
}
it('SC031 real N extra UD/IT preserves staging and actual masterdata, positive processing ACKs and the supplier-only generic graph ROLE_HOLD',async()=>{
 const baseline=await sc031NativeN(false),extra=await sc031NativeN(true)
 expect(extra).toEqual(baseline)
},120000)
it('SC031 real N extra UD/IT and ignored249/261/306/212 preserve five persisted business projections, masterdata, positive ACKs and ROLE_HOLD',async()=>{
 const baseline=await sc031NativeN(false,true),extra=await sc031NativeN(true,true)
 expect(baseline).toHaveProperty('contract')
 expect(extra).toHaveProperty('contract')
 if(!('rawRegisters' in baseline)||!('rawRegisters' in extra))throw Error('SC031_native_persisted_scalar_probe_required')
 const {rawRegisters:baselineRaw,...baselineBusiness}=baseline
 const {rawRegisters:extraRaw,...extraBusiness}=extra
 expect(extraBusiness).toEqual(baselineBusiness)
 expect(extraRaw).not.toEqual(baselineRaw)
},120000)

// Current source extension. These are executable native assertions, NOT a
// claim of execution during source preparation. Every new tested source is
// born through the public mailbox creator; prerequisite helpers keep their
// existing declared setup provenance. No protected source/facet is rewritten.
const sc031PhysicalFields=[
 {field:'213',parts:[['QTY',['31','777','KWH']]]},
 {field:'214',parts:characteristic('Z02','7',3)},
 {field:'216',parts:[['DTM',['157','202610010000','203']]]},
 {field:'217',parts:characteristic('Z04','Z02')},
 {field:'218',parts:characteristic('Z05','7',3)},
 {field:'222',parts:characteristic('Z12','D',3)},
 {field:'224',parts:[['RFF',['MG','SC031-METER']]]},
 {field:'242',parts:characteristic('Z14','L641Q',3)},
 {field:'254',parts:characteristic('Z15','Z32')},
 {field:'259',parts:characteristic('Z16','4',3)},
 {field:'260',parts:[['RFF',['Z05','TES']]]},
 {field:'262',parts:[['NAD','Z02',['54321','160','SVK'],'','','','','','','SE']]},
 {field:'508',parts:[['DTM',['354','15','806']]]},
] satisfies {field:string;parts:Parts[]}[]
const sc031Z05Fields=sc031PhysicalFields.filter(({field})=>!['224','260','262'].includes(field))
function sc031RenderPart(part:Parts){
 return part.map(value=>(typeof value==='string'?[value]:value).map(component=>component.replace(/[?':+]/g,c=>'?'+c)).join(':')).join('+')
}
function sc031PhysicalNRaw(p:Awaited<ReturnType<typeof prepareNativeEscoPermissionFixture>>,f:Fixture,extra:boolean){
 const raw=sc031N(p,f,false),wire=tokenizeEdifact(raw)
 const parts:Parts[]=wire.segments.filter(s=>!['UNB','UNH','UNT','UNZ'].includes(s.tag)).map(s=>[s.tag,
  ...Array.from({length:segmentElementCount(s,wire.una)},(_,index)=>{const values=segmentComposite(s,index+1,wire.una);return values.length===1?values[0]:values})])
 const body=guideOrderedFixtureBody([...parts,...(extra?sc031PhysicalFields.flatMap(field=>field.parts):[])])
 const outer=EdifactEnvelopeCodec.decode(raw)
 return EdifactEnvelopeCodec.encode({sender:outer.sender!,receiver:outer.receiver!,applicationReference:outer.applicationReference,
  interchangeReference:outer.interchangeReference!,environment:'test',acknowledgementRequest:true,
  messages:[{messageReference:segmentComposite(wire.segments.find(s=>s.tag==='UNH'),1,wire.una)[0],messageTypeToken:version.messageTypeToken,businessSegments:body.map(sc031RenderPart)}]})
}
async function sc031PublicReceive(companyId:string,actorUserId:string,raw:string){
 expect(validateEdifactEnvelope(raw).syntaxOk).toBe(true)
 const receivedAt=new Date().toISOString()
 const mail=await seedOriginalMailboxNative(sql,lit,{companyId,environment:'test',raw,receivedAt,smtpFrom:edielSmtpConfig().from})
 const outboundMatch=await matchOutboundRequestForInbound({companyId,parsed:mail.parsed,inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId})
 const meteringPointMatch=await matchMeteringPointForInbound({companyId,parsed:mail.parsed})
 const input={companyId,actorUserId,environment:'test',inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId,parsed:mail.parsed,outboundMatch,meteringPointMatch}
 const id=await createInboundEdielMessage(input)
 expect(id).toMatch(/^[a-f0-9-]{36}$/)
 const message=(await getEdielMessageById(id!))!
 expect(message).toMatchObject({id,company_id:companyId,environment:'test',direction:'inbound',raw_payload:raw,
  inbound_email_message_id:mail.inboundEmailMessageId,mailbox_message_id:mail.inboundEmailMessageId})
 expect(Date.parse(String(message.message_received_at))).toBe(Date.parse(receivedAt))
 return {message,mail,input}
}
function sc031PersistedCase(companyId:string,sourceId:string,caseId:string){
 const row=sql<EdielInboundCaseRow>(`SELECT to_jsonb(c) FROM public.ediel_inbound_cases c WHERE company_id=${lit(companyId)} AND ediel_message_id=${lit(sourceId)} AND id=${lit(caseId)}`)
 expect(row).toMatchObject({id:caseId,company_id:companyId,ediel_message_id:sourceId})
 return row
}
function sc031Projection(row:EdielInboundCaseRow){
 const {registers,...meter}=row.parsed_metering_point
 expect(Array.isArray(registers)).toBe(true)
 return {customer:row.parsed_customer,site:row.parsed_site,meter,contract:row.parsed_contract,production:row.parsed_production}
}
function sc031GraphOperations(companyId:string){
 return sql<Sc031Row[]>(`SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY id),'[]') FROM public.customer_onboarding_operations o WHERE company_id=${lit(companyId)} AND channel='ediel_inbound'`)
}
function sc031CompanyOutbox(companyId:string){
 return sql<Sc031Row[]>(`SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY id),'[]') FROM public.ediel_outbox o WHERE company_id=${lit(companyId)}`)
}
async function sc031PublicProcess(companyId:string,actorUserId:string,raw:string,fields:readonly string[],objects:number,positiveEffect=true){
 const received=await sc031PublicReceive(companyId,actorUserId,raw),decision=await resolveCanonicalRuntimeDecisionWithRegistry(received.message,{actorUserId})
 expect([decision.syntaxDecision,decision.applicationDecision],JSON.stringify(decision.issues)).toEqual(['accepted','accepted'])
 if(positiveEffect)expect(decision.functionalDecision,JSON.stringify(decision.issues)).toBe('accepted')
 const ignored=bindReceivedProdatIgnoredFields(decision.prodatIgnoredFields,raw)
 expect(ignored).not.toBeNull()
 for(const field of fields){
  const own=ignored!.filter(f=>f.fieldNumber===field)
  expect(own,field).toHaveLength(objects)
  expect(own.every(f=>f.sourceRule==='PRODAT26A:P119')).toBe(true)
 }
 const recorded=await recordReceivedSourceValidation({original:received.message,validated:received.message,resolvedCompanyId:companyId,decision})
 expect(recorded.status).toBe('recorded')
 if(recorded.status!=='recorded')throw Error('SC031_public_canonical_record_required')
 await captureFreshEdielSourceRulePackEvidence(companyId,received.message.id)
 await processInboundEdielMessage({actorUserId,edielMessageId:received.message.id})
 const message=(await getEdielMessageById(received.message.id))!
 expect(message.raw_payload).toBe(raw)
 expect(message.validation_report).toMatchObject({syntaxDecision:'accepted',applicationDecision:'accepted'})
 const plan=await readReceivedProdatFinalResponsePlan({companyId,sourceMessageId:message.id,rawPayload:raw})
 if(positiveEffect){expect(plan?.plans).toHaveLength(objects);expect(plan!.plans.every(p=>p.outcome==='positive')).toBe(true)}
 const assessmentId=positiveEffect?plan!.plans[0].canonicalAssessmentId:recorded.assessmentId
 const evidence=sc031BindEvidence(companyId,message,assessmentId)
 expect(evidence.fields).toEqual(ignored)
 const staged=await createOrUpdateInboundProdatCase({actorUserId,message})
 expect(staged?.status).toBe('pending_review')
 const persisted=sc031PersistedCase(companyId,message.id,staged!.id)
 expect(sc031Projection(persisted)).toEqual(sc031Projection(staged!))
 const acks=sc031ActualAcks(companyId,message.id),outer=EdifactEnvelopeCodec.decode(raw),aperakObjects:NonNullable<ReturnType<typeof readPhysicalAckSourceCorrelation>['prodatObjectOutcomes']>=[],aperakReferences:string[]=[]
 if(positiveEffect)expect(acks.acks.filter(a=>a.message_family==='CONTRL')).toHaveLength(1)
 if(positiveEffect)expect(acks.acks.filter(a=>a.message_family==='APERAK').length).toBeGreaterThanOrEqual(1)
 for(const ack of acks.acks){
  expect(ack).toMatchObject({company_id:companyId,environment:'test',direction:'outbound',related_message_id:message.id})
  expect(validateEdifactEnvelope(ack.raw_payload!).syntaxOk).toBe(true)
  const correlation=readPhysicalAckSourceCorrelation(ack,message)
  expect(['positive','negative']).toContain(correlation.classification.outcome)
  expect(ack.ack_outcome).toBe(correlation.classification.outcome)
  if(positiveEffect)expect(correlation.classification.outcome).toBe('positive')
  const envelope=EdifactEnvelopeCodec.decode(ack.raw_payload!)
  expect([envelope.sender,envelope.receiver]).toEqual([outer.receiver,outer.sender])
  if(ack.message_family==='CONTRL')expect(correlation.acknowledgedReferences).toEqual([outer.interchangeReference])
  else{
   const outcomes=correlation.prodatObjectOutcomes??[]
   if(positiveEffect){expect(outcomes.length).toBeGreaterThan(0);expect(outcomes.every(o=>o.outcome==='positive')).toBe(true)}
   aperakObjects.push(...outcomes);aperakReferences.push(...correlation.acknowledgedReferences)
  }
  expect(acks.outbox.filter(o=>o.ediel_message_id===ack.id)).toEqual([expect.objectContaining({company_id:companyId,source_message_id:message.id,message_family:ack.message_family,ack_outcome:ack.ack_outcome})])
 }
 const wire=tokenizeEdifact(raw),li=wire.segments.filter(s=>s.tag==='RFF'&&segmentComposite(s,1,wire.una)[0]==='LI').map(s=>segmentComposite(s,1,wire.una)[1])
 if(positiveEffect){
  expect(aperakObjects).toHaveLength(objects)
  expect(new Set(aperakObjects.map(o=>`${o.firstLineIndex}:${o.objectId}:${o.lineItemReference}`)).size).toBe(objects)
  for(const reference of li)expect(aperakReferences).toContain(reference)
 }
 expect(acks.outbox).toHaveLength(acks.acks.length)
 const groups=prodatRegisterGroups(wire.segments,wire.una,message.message_code).groups
 const outcomeShape={syntax:decision.syntaxDecision,application:decision.applicationDecision,functional:decision.functionalDecision,functionalIssues:decision.issues.filter(issue=>issue.layer==='functional').map(issue=>[issue.code,issue.severity]).sort(),
  acks:acks.acks.map(ack=>[ack.message_family,ack.ack_outcome]).sort(),
  objectOutcomes:aperakObjects.map(o=>({object:groups.findIndex(group=>group.itemId===o.objectId),outcome:o.outcome})).sort((a,b)=>a.object-b.object),
  effects:(plan?.plans??[]).map(p=>[p.effectKind,p.outcome]).sort()}
 return {...received,message,case:persisted,assessmentId,plan,evidence:evidence.evidence,acks,outcomeShape}
}
async function sc031PublicReplay(f:Awaited<ReturnType<typeof sc031PublicProcess>>,actorUserId:string){
 const companyId=f.message.company_id!,master=sc031Master(companyId),operations=sc031GraphOperations(companyId),outbox=sc031CompanyOutbox(companyId),before=sc031PersistedCase(companyId,f.message.id,f.case.id)
 expect(await createInboundEdielMessage(f.input)).toBe(f.message.id)
 await processInboundEdielMessage({actorUserId,edielMessageId:f.message.id})
 expect((await getEdielMessageById(f.message.id))?.raw_payload).toBe(f.message.raw_payload)
 expect(sc031Master(companyId)).toEqual(master)
 expect(sc031GraphOperations(companyId)).toEqual(operations)
 expect(sc031ActualAcks(companyId,f.message.id)).toEqual(f.acks)
 expect(sc031CompanyOutbox(companyId)).toEqual(outbox)
 expect(sc031PersistedCase(companyId,f.message.id,f.case.id)).toEqual(before)
 // Original and immutable canonical facets stay tied to the first assessment.
 expect(sc031SourceEvidence(companyId,f.message.id,f.assessmentId)).toMatchObject({source:f.evidence.source,assessment:f.evidence.assessment,ignored:f.evidence.ignored,application:f.evidence.application,mail:f.evidence.mail})
}
it('SC031 public N thirteen ignored fields preserve physical positive ACKs and five persisted business projections, stale-cache hold and tenant isolation',async()=>{
 const results=[]
 for(const extra of [false,true]){
  const f=await seed(),p=await prepareNativeEscoPermissionFixture(f)
  ackRoute(f)
  const master=sc031Master(f.ids.company),operations=sc031GraphOperations(f.ids.company),raw=sc031PhysicalNRaw(p,f,extra)
  const result=await sc031PublicProcess(f.ids.company,f.ids.actor,raw,extra?sc031PhysicalFields.map(field=>field.field):[],1)
  expect(market(f,p.permissionId).permission).toMatchObject({status:'rejected_passive_timeout',inbound_z14_message_id:result.message.id})
  expect(sc031Master(f.ids.company)).toEqual(master);expect(sc031GraphOperations(f.ids.company)).toEqual(operations)
  const projection=sc031Projection(result.case)
  expect(projection.meter).toMatchObject({meteringMethod:null,readingFrequency:null,observationLength:null,observationLengthFormat:null})
  expect(projection.site.gridAreaCode).toBeNull();expect(projection.contract.gridAreaCode).toBeNull()
  const role=await supabaseService.rpc('ediel_read_prodat_object_batch_source_v1',{p_company_id:f.ids.company,p_source_message_id:result.message.id,p_actor_user_id:f.ids.actor})
  expect(role.error?.message).toMatch(/prodat_object_batch_current_receiver_role_required/)
  if(extra){
   // Only the own pending cache models predecessor state. Source originals,
   // reception, canonical decisions and immutable evidence are never edited.
   for(const [column,key,value] of [
    ['parsed_metering_point','meteringMethod','Z02'],['parsed_metering_point','readingFrequency','D'],
    ['parsed_metering_point','observationLength','15'],['parsed_metering_point','observationLengthFormat','806'],
    ['parsed_site','gridAreaCode','TES'],['parsed_contract','gridAreaCode','TES'],
   ] as const){
    const original=result.case[column],stale={...original,[key]:value}
    expect(sql(`UPDATE public.ediel_inbound_cases SET ${column}=${lit(stale)}::jsonb WHERE company_id=${lit(f.ids.company)} AND ediel_message_id=${lit(result.message.id)} AND id=${lit(result.case.id)} AND status='pending_review' RETURNING to_jsonb(id)`)).toBe(result.case.id)
    const pending=sc031PersistedCase(f.ids.company,result.message.id,result.case.id),outbox=sc031CompanyOutbox(f.ids.company)
    for(let replay=0;replay<2;replay++)await expect(approveEdielInboundCase({companyId:f.ids.company,actorUserId:f.ids.actor,caseId:result.case.id,mode:'create_new_customer'})).rejects.toThrow('PRODAT_INBOUND_CASE_PROJECTION_OBSOLETE')
    expect(sc031PersistedCase(f.ids.company,result.message.id,result.case.id)).toEqual(pending)
    expect(sc031Master(f.ids.company)).toEqual(master);expect(sc031GraphOperations(f.ids.company)).toEqual(operations);expect(sc031ActualAcks(f.ids.company,result.message.id)).toEqual(result.acks)
    expect(sc031CompanyOutbox(f.ids.company)).toEqual(outbox)
    expect(sql(`UPDATE public.ediel_inbound_cases SET ${column}=${lit(original)}::jsonb WHERE company_id=${lit(f.ids.company)} AND id=${lit(result.case.id)} AND ${column}=${lit(stale)}::jsonb RETURNING to_jsonb(id)`)).toBe(result.case.id)
   }
  }
  await sc031PublicReplay(result,f.ids.actor)
  results.push({f,result,projection})
 }
 expect(results[1].projection).toEqual(results[0].projection)
 for(const [own,foreign] of [[results[0],results[1]],[results[1],results[0]]]){
  const before=sc031Master(foreign.f.ids.company),acks=sc031ActualAcks(foreign.f.ids.company,foreign.result.message.id)
  await expect(createInboundEdielMessage({...own.result.input,companyId:foreign.f.ids.company})).rejects.toThrow()
  await expect(approveEdielInboundCase({companyId:foreign.f.ids.company,actorUserId:own.f.ids.actor,caseId:own.result.case.id,mode:'create_new_customer'})).rejects.toThrow('TENANT_CONTEXT_MISMATCH')
  expect(sc031Master(foreign.f.ids.company)).toEqual(before);expect(sc031ActualAcks(foreign.f.ids.company,foreign.result.message.id)).toEqual(acks)
 }
},240000)

const sc031National=nationalRescissionNativeChain({provider:nativeEscoExternal.send,sourceSession:sc031Auth})
type Sc031EndObject={external:string;gridAreaCode:string;customerIdentity:{id:string;qualifier:string;agency:string};brpEdielId:string;li:string}
function sc031EndObject(f:Omit<Sc031EndObject,'li'>,li:string,end:string,sequence:string,extra:boolean,agency:string):Parts[]{
 return [['LIN',sequence,'',[f.external,'','',agency]],['DTM',['93',end,'203']],...characteristic('Z13','Z22'),
  ['RFF',['LI',li]],['RFF',['Z05',f.gridAreaCode]],['RFF',['MG','SC031-METER']],
  ['NAD','UD',[f.customerIdentity.id,f.customerIdentity.qualifier,f.customerIdentity.agency],'','Synthetic','Street','City','','12345','SE'],
  ['NAD','IT',[f.external,'',agency],'','','Street','Town','','12345','SE'],['NAD','Z02',[f.brpEdielId,'160','SVK']],
  ...(extra?sc031Z05Fields.flatMap(field=>field.parts):[])]
}
function sc031EndRaw(header:{sender:string;receiver:string},rows:readonly Sc031EndObject[],end:string,extra:boolean,agency='9'){
 const objects=rows.flatMap((row,index)=>sc031EndObject(row,row.li,end,String(index+1),extra,agency))
 const body:Parts[]=[['NAD','FR',[header.receiver,'160','SVK'],'','','','','','','SE'],['NAD','DO',[header.sender,'160','SVK'],'','','','','','','SE'],...objects]
 const raw=guideOrderedFixtureRaw(body,'Z05').replace('+S+R+',`+${header.receiver}:14+${header.sender}:14+`).replace("++23-DDQ-PRODAT'","++23-DDQ-PRODAT++1++1'")
 const outer=EdifactEnvelopeCodec.decode(raw),wire=tokenizeEdifact(raw),identity='S'+randomUUID().replaceAll('-','').slice(0,13)
 return EdifactEnvelopeCodec.encode({sender:outer.sender!,receiver:outer.receiver!,senderQualifier:outer.senderQualifier,receiverQualifier:outer.receiverQualifier,applicationReference:outer.applicationReference,
  interchangeReference:identity,environment:'test',acknowledgementRequest:true,messages:[{messageReference:identity,messageTypeToken:version.messageTypeToken,
   businessSegments:wire.segments.filter(s=>!['UNB','UNH','UNT','UNZ'].includes(s.tag)).map(s=>s.tag==='BGM'?s.raw.replace(/BGM\+Z05\+[^+]+/,'BGM+Z05+'+identity):s.raw)}]})
}
async function sc031PublicZ05(extra:boolean){
 const sibling=await sc031National.nationalRescissionOperation()
 nativeEscoExternal.send.mockResolvedValue({accepted:['recipient@example.invalid'],rejected:[],messageId:'synthetic-SC031-Z08-original',response:'250 synthetic accepted'})
 await sendEdielMessageViaSmtp((await getEdielMessageById(sibling.original.id))!,{actorUserId:sibling.currentExecutor,smtpMimeMode:'nodemailer-attachment'})
 // Own existing national builder remains strict: the actual persisted/sent
 // Z08 H original never acquires the incoming Z05 extras. These are own-wire
 // omission assertions, not a fabricated outbound producer/candidate grant.
 const strictOriginal=(await getEdielMessageById(sibling.original.id))!,strictWire=tokenizeEdifact(strictOriginal.raw_payload!)
 expect(strictOriginal).toMatchObject({message_code:'Z08',direction:'outbound',status:'sent',raw_payload:sibling.original.raw_payload})
 expect(strictWire.segments.filter(s=>s.tag==='QTY'&&segmentComposite(s,1,strictWire.una)[0]==='31')).toEqual([])
 expect(strictWire.segments.filter(s=>s.tag==='CCI'&&segmentComposite(s,2,strictWire.una)[0]==='Z12')).toEqual([])
 const target=await prepareIndependentNationalEndTarget(sibling,nativeEscoExternal.send)
 target.assertSiblingPreserved()
 sc031Auth.client=await sc031National.actualNationalSourceSession(target.actorUserId)
 const targetWire=tokenizeEdifact(target.source.raw_payload!),targetLi=targetWire.segments.filter(s=>s.tag==='RFF'&&segmentComposite(s,1,targetWire.una)[0]==='LI')
 expect(targetLi).toHaveLength(1)
 const rows=[{...target,li:segmentComposite(targetLi[0],1,targetWire.una)[1]}]
 expect(rows.every(row=>row.companyId===target.companyId)).toBe(true)
 const finalRaw=sc031EndRaw(target,rows,sibling.nationalEndPlan.endWireMinute,extra)
 const config=edielSmtpConfig()
 expect(sql(`WITH configured AS(UPDATE public.ediel_route_profiles p SET mailbox=${lit(config.from)},smtp_host=${lit(config.host)},smtp_port=${lit(config.port)},is_active=true FROM public.communication_routes r WHERE r.id=p.communication_route_id AND r.company_id=p.company_id AND r.company_id=${lit(target.companyId)} AND r.route_scope='ediel_ack' AND p.environment='test' RETURNING p.id) SELECT to_jsonb(count(*)) FROM configured`)).toBe(1)
 const master=sc031Master(target.companyId)
 const result=await sc031PublicProcess(target.companyId,target.actorUserId,finalRaw,extra?sc031Z05Fields.map(field=>field.field):[],rows.length)
 expect(sc031Master(target.companyId)).toEqual(master)
 for(const row of rows){
  const period=sql<{source:string;end:string}>(`SELECT jsonb_build_object('source',source_end_message_id,'end',market_end_at) FROM public.customer_supply_periods WHERE company_id=${lit(target.companyId)} AND id=${lit(row.periodId)}`)
  expect(period.source).toBe(result.message.id);expect(Date.parse(period.end)).toBe(Date.parse(sibling.nationalEndPlan.effectiveAt))
 }
 target.assertSiblingPreserved()
 return {target,sibling,rows,result,master}
}
function sc031CommittedGraphs(companyId:string,caseId:string){
 return sql<Sc031Graph[]>(`SELECT coalesce(jsonb_agg(jsonb_build_object('operation',to_jsonb(o),'customer',to_jsonb(c),'site',to_jsonb(s),'meter',to_jsonb(m),'application',to_jsonb(a)) ORDER BY o.id),'[]')
  FROM public.customer_onboarding_operations o JOIN public.customer_onboarding_applications a ON a.onboarding_operation_id=o.id AND a.company_id=o.company_id
  JOIN public.customers c ON c.id=(o.result_snapshot->>'customer_id')::uuid AND c.company_id=o.company_id
  JOIN public.customer_sites s ON s.id=(o.result_snapshot->>'site_id')::uuid AND s.company_id=o.company_id AND s.customer_id=c.id
  JOIN public.metering_points m ON m.id=(o.result_snapshot->>'metering_point_id')::uuid AND m.company_id=o.company_id AND m.customer_id=c.id AND m.site_id=s.id
  WHERE o.company_id=${lit(companyId)} AND o.channel='ediel_inbound' AND (a.source_record_id=${lit(caseId)} OR a.source_record_id LIKE ${lit(caseId+':object:%')})`)
}
it('SC031 public Z05L own ten unused fields preserve physical ACKs, selected committed graphs, raw evidence and replay',async()=>{
 const business=[]
 for(const extra of [false,true]){
  const f=await sc031PublicZ05(extra),{target,result}=f
  expect(result.case.parsed_site.annualEnergyKwh).toBeNull();expect(result.case.parsed_metering_point.readingFrequency).toBeNull()
  expect(result.case.parsed_site.gridAreaCode).toBe(target.gridAreaCode)
  expect(result.case.parsed_metering_point.meterNumber).toBe('SC031-METER')
  expect(result.case.parsed_contract.balanceResponsibleId).toBe(target.brpEdielId)
  await approveEdielInboundCase({companyId:target.companyId,actorUserId:target.actorUserId,caseId:result.case.id,mode:'update_existing_customer',selectedCustomerId:target.customerId,selectedSiteId:target.siteId,selectedMeteringPointId:target.pointId})
  const graphs=sc031CommittedGraphs(target.companyId,result.case.id)
  expect(graphs).toHaveLength(1)
  expect(graphs[0].operation).toMatchObject({company_id:target.companyId,status:'completed',result_snapshot:expect.objectContaining({ok:true,customer_id:target.customerId,site_id:target.siteId,metering_point_id:target.pointId})})
  const command=graphs[0].operation.command_snapshot as {site:Sc031Row;metering_point:Sc031Row;application:{payload_snapshot:Sc031Row}}
  expect(command.site.annual_consumption_kwh).toBeNull();expect(command.metering_point.reading_frequency).toBe('hourly')
  expect(graphs[0].site.annual_consumption_kwh).toBeNull();expect(graphs[0].meter.reading_frequency).toBe('hourly')
  expect(JSON.stringify(command.application.payload_snapshot.prodatRegisters).includes('777')).toBe(extra)
  business.push({graph:sc031Business(graphs[0],target.external),projection:{...sc031Projection(result.case),site:{...result.case.parsed_site,facilityId:null,siteName:null},meter:{...sc031Projection(result.case).meter,meterPointId:null}}})
  const persisted=sc031PersistedCase(target.companyId,result.message.id,result.case.id),master=sc031Master(target.companyId),operations=sc031GraphOperations(target.companyId)
  await expect(approveEdielInboundCase({companyId:target.companyId,actorUserId:target.actorUserId,caseId:result.case.id,mode:'update_existing_customer',selectedCustomerId:target.customerId})).rejects.toThrow(/status applied/)
  expect(sc031Master(target.companyId)).toEqual(master);expect(sc031GraphOperations(target.companyId)).toEqual(operations)
  expect(sc031PersistedCase(target.companyId,result.message.id,result.case.id)).toEqual(persisted)
  await sc031PublicReplay(result,target.actorUserId)
  target.assertSiblingPreserved()
 }
 expect(business[1]).toEqual(business[0])
},480000)
async function sc031PublicProspectiveZ05(extra:boolean){
 const base=await seedNormalSwitchNativeFixture({deferOriginal:true}),points=Array.from({length:2},(_,index)=>String.fromCharCode(65+index)+randomUUID().replaceAll('-','').slice(0,23).toUpperCase())
 sql(`INSERT INTO public.permissions(key,name,is_active) VALUES('customers.write','Synthetic SC031 customer',true) ON CONFLICT(key) DO NOTHING;
  INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key,effect,status,is_active) SELECT ${lit(base.actorUserId)},${lit(base.companyId)},p.id,p.key,'allow','active',true FROM public.permissions p WHERE p.key='customers.write';`)
 const rows=points.map((external,index)=>({external,gridAreaCode:base.gridAreaCode,customerIdentity:{id:`SC031-CUSTOMER-${index}`,qualifier:'',agency:'89'},brpEdielId:base.brpEdielId,li:`SC031-${index}`}))
 const raw=sc031EndRaw(base,rows,'202610171200',extra,'89'),master=sc031Master(base.companyId)
 // Free prospective objects have no qualified end period. Preserve actual
 // functional/ACK outcomes and compare them; never call this an end ACK.
 const result=await sc031PublicProcess(base.companyId,base.actorUserId,raw,extra?sc031Z05Fields.map(field=>field.field):[],2,false)
 expect(sc031Master(base.companyId)).toEqual(master)
 return {...base,points,result,master}
}
it('SC031 public prospective two-object Z05L create_new preserves actual ACK outcomes and must commit masked213/222/242',async()=>{
 // This deliberately retains the desired behavior oracle. Current SQL's
 // raw comparator is expected to expose RED here until its separately owned
 // forward fix is qualified; a caught comparator error is never a PASS.
 const baseline=await sc031PublicProspectiveZ05(false),extra=await sc031PublicProspectiveZ05(true),business=[]
 expect(extra.result.outcomeShape).toEqual(baseline.result.outcomeShape)
 for(const f of [baseline,extra]){
  const {result}=f
  const applied=await approveEdielInboundCase({companyId:f.companyId,actorUserId:f.actorUserId,caseId:result.case.id,
   objectDecisions:f.points.map(meteringPointId=>({meteringPointId,identityAgency:'89',mode:'create_new_customer' as const}))})
  expect(applied.status).toBe('applied')
  const graphs=sc031CommittedGraphs(f.companyId,result.case.id)
  expect(graphs).toHaveLength(2)
  for(const graph of graphs){
   expect(graph.operation).toMatchObject({status:'completed',company_id:f.companyId})
   expect(graph.site).toMatchObject({annual_consumption_kwh:null,site_type:'consumption'})
   expect(graph.meter).toMatchObject({reading_frequency:'hourly',measurement_type:'consumption'})
  }
  business.push(f.points.map(point=>{
   const own=graphs.filter(graph=>graph.meter.meter_point_id===point)
   expect(own).toHaveLength(1)
   return sc031Business(own[0],point)
  }))
  const after=sc031Master(f.companyId)
  expect(after.customers.filter(row=>f.master.customers.some(old=>old.id===row.id))).toEqual(f.master.customers)
  expect(after.sites.filter(row=>f.master.sites.some(old=>old.id===row.id))).toEqual(f.master.sites)
  expect(after.meters.filter(row=>f.master.meters.some(old=>old.id===row.id))).toEqual(f.master.meters)
  await sc031PublicReplay(result,f.actorUserId)
 }
 expect(business[1]).toEqual(business[0])
},480000)
