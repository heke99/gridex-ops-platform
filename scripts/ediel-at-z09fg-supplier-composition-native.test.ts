// Prepared composition source for AT-Z09F/G-SUPPLIER; native remains NOT_RUN.
// The sole existing producer supplies GRIDEX_Z09FG_COMPOSITION_INPUTS as a local
// JSON file matching CompositionInputs below. No executable adapter is loaded.
// Its disposable actors must log in through real GoTrue. Both artifact selectors
// must originate through authenticated ediel_archive_contract_original_source_v1
// and an independent ediel_review_contract_original_source_v1: first a signed
// contract_requested_method, then metering_method_event whose exact claims name
// that declaration. Actual current issuer/representation/signature/contract/BRP,
// network, source clock and post-ledger Z03/Z04 supply prerequisites are owned by
// those existing interfaces. This suite cannot create issuer authority, grants,
// accepted histories, permissions, status JSON or original-capture receipts.
// Missing qualified input FAILS with its current read/held reason, never SKIPs.
// Root resumes with a fresh prospective producer epoch on the adopted source:
// record backendIdentitySql, current authorized artifact read hashes/selectors,
// actor credentials and expected baseline scope. Credentials stay in temporary
// producer input, never an evidence artifact. IDs/expected strings are selectors;
// authenticated intake/source/supply/datetime reads establish their authority.
import {createHash,randomUUID} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {z} from 'zod'
import {createClient} from '@supabase/supabase-js'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
vi.mock('server-only',()=>({}))
const delivery=vi.hoisted(()=>({smtp:vi.fn(),recipient:null as string|null}))
// Declared synthetic external SMTP only. No SQL, source, permission, tenant,
// canonical engine, ACK, case, apply or dated-selection implementation is mocked.
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:delivery.smtp})}}))
import {supabaseService} from '@/lib/supabase/service'
import {readMeteringMethodChangeSource,type MeteringMethodChangeBasis} from '@/lib/ediel/production/meteringMethodChangeSource'
import {prepareAndQueueMeteringMethodChangeZ09} from '@/lib/ediel/flows/prodatMeteringMethodChange'
import {sendEdielMessageViaSmtp} from '@/lib/ediel/transport'
import {getEdielMessageById} from '@/lib/ediel/db'
import {matchOutboundRequestForInbound} from '@/lib/inbound-mail/inboundMatcher'
import {createInboundEdielMessage} from '@/lib/inbound-mail/inboundStatusUpdater'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {recordReceivedSourceValidation} from '@/lib/ediel/core/receivedSourceValidationLedger'
import {processInboundAckMessage} from '@/lib/ediel/flows/inboundAckProcessing'
import {readCommittedInboundAck} from '@/lib/ediel/ack/committedInboundAck'
import {qualifyInboundAckSourceCandidates} from '@/lib/ediel/ack/sourceCorrelation'
import {renderContrl2Ediel2} from '@/lib/ediel/contrlEngine'
import {renderAperakEdiel} from '@/lib/ediel/aperakEngine'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {validateEdifactEnvelope} from '@/lib/ediel/core/edifactValidation'
import {prodatDate203,prodatMarketMinuteToUtc,prodatNowDate203} from '@/lib/ediel/prodat/render/dates'
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {createOrUpdateInboundProdatCase,getEdielInboundCaseForMessage,approveEdielInboundCase} from '@/lib/ediel/inboundCases'
import {reviewReceivedStructuralSource} from '@/lib/ediel/sources/reviewReceivedStructuralSource'
import {readQualifiedCustomerStructure,type QualifiedCustomerStructure} from '@/lib/ediel/sources/qualifiedCustomerStructure'
import {readReceivedProdatFinalResponsePlan} from '@/lib/ediel/core/receivedProdatFinalResponsePlan'
import {nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {seedOriginalMailboxNative} from './helpers/originalMailboxNative'
import {z06fNativeStructureWire,type Z06fNativeWireScope} from './helpers/ediel-z06f-reading-followup-native-wire'
import {structuralOwnerSource} from '../__tests__/helpers/structuralOwnerFixtures'
import type {EdielMessageRow} from '@/lib/ediel/types'

type Actor={id:string;email:string;password:string}
type ArtifactPin={artifactId:string;sourceId:string;sourceHash:string;agreementHash:string;claimsHash:string}
type ProfileInput={
 subtype:'F'|'G';companyId:string;eventId:string;contractId:string;supplyPeriodId:string;
 baselineSourceMessageId:string;preferredRouteId:string;requestActor:Actor;reviewActor:Actor;
 declaration:ArtifactPin;event:ArtifactPin;
 expected:{customerId:string;siteId:string;meteringPointId:string;pointId:string;identityAgency:'9';legalSenderId:string;legalReceiverId:string;gridArea:string;brpEdielId:string;requestedStartDate:string;baselineMarketMinute:string;effectiveMarketMinute:string;baselineMethod:string;confirmedMethod:'Z04'|'Z02'};
}
type BackendIdentity={engineSchemaVersion:string;migrationVersion:string;functionDefinitionsSha256:string}
export type CompositionInputs={schema:'ediel_z09fg_composition_inputs_v1';apiUrl:'http://127.0.0.1:54321';backend:BackendIdentity;profiles:[ProfileInput,ProfileInput]}

// Read this exact query on the existing qualified installed backend when making
// the input manifest. It binds installed function bodies separately from TS/git
// applicability. It is not a substitute for the producer's SQL replay/checksum,
// catalog, genuine original/input-epoch, GEN or mandatory global qualification.
export const backendIdentitySql=`SELECT jsonb_build_object(
 'engineSchemaVersion',public.canonical_current_ediel_engine_schema_version(),
 'migrationVersion',(SELECT max(version) FROM supabase_migrations.schema_migrations),
 'functionDefinitionsSha256',(SELECT encode(sha256(convert_to(string_agg(n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')'||pg_get_functiondef(p.oid),E'\\n' ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),'UTF8')),'hex')
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prokind='f' AND
 (n.nspname LIKE 'gridex_%' OR n.nspname='public' AND(p.proname LIKE 'ediel_%' OR p.proname LIKE 'gridex_%' OR p.proname='canonical_current_ediel_engine_schema_version'))))`
const hash=(raw:string)=>createHash('sha256').update(raw,'utf8').digest('hex')
function requireInput(condition:unknown,reason:string):asserts condition{if(!condition)throw Error(`z09fg_composition_input:${reason}`)}
const record=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value)
function inputs(subtype:'F'|'G'){
 const path=process.env.GRIDEX_Z09FG_COMPOSITION_INPUTS
 requireInput(path,'producer_manifest_required')
 const parsed:unknown=JSON.parse(readFileSync(path,'utf8'))
 requireInput(record(parsed),'JSON_object_required')
 const data=parsed as CompositionInputs
 requireInput(data.schema==='ediel_z09fg_composition_inputs_v1'&&data.apiUrl==='http://127.0.0.1:54321','exact_schema_loopback_required')
 requireInput(Array.isArray(data.profiles)&&data.profiles.every(p=>record(p)&&record(p.requestActor)&&record(p.reviewActor)&&record(p.declaration)&&record(p.event)&&record(p.expected)),'profile_actor_artifact_scope_objects_required')
 requireInput(Array.isArray(data.profiles)&&data.profiles.length===2&&data.profiles.filter(p=>p.subtype==='F').length===1&&data.profiles.filter(p=>p.subtype==='G').length===1,'one_F_and_one_G_required')
 requireInput(data.profiles[0].eventId!==data.profiles[1].eventId&&data.profiles[0].expected.meteringPointId!==data.profiles[1].expected.meteringPointId,'distinct_fresh_events_and_points_required')
 const p=data.profiles.find(profile=>profile.subtype===subtype)!
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
 for(const[key,value]of Object.entries({companyId:p.companyId,eventId:p.eventId,contractId:p.contractId,supplyPeriodId:p.supplyPeriodId,baselineSourceMessageId:p.baselineSourceMessageId,preferredRouteId:p.preferredRouteId,requestActorId:p.requestActor.id,reviewActorId:p.reviewActor.id,declarationArtifactId:p.declaration.artifactId,declarationSourceId:p.declaration.sourceId,eventArtifactId:p.event.artifactId,eventSourceId:p.event.sourceId,customerId:p.expected.customerId,siteId:p.expected.siteId,meteringPointId:p.expected.meteringPointId}))requireInput(typeof value==='string'&&uuid.test(value),`${key}_UUID_required`)
 for(const[key,value]of Object.entries(p.expected))requireInput(typeof value==='string'&&value.length>0,`expected_${key}_required`)
 requireInput(p.requestActor.id!==p.reviewActor.id,'independent_review_actor_required')
 requireInput(p.event.sourceId===p.eventId,'event_artifact_target_required')
 requireInput(p.expected.identityAgency==='9'&&/^\d{18}$/.test(p.expected.pointId),'physical_point_agency_required')
 requireInput(prodatMarketMinuteToUtc(p.expected.baselineMarketMinute)&&prodatMarketMinuteToUtc(p.expected.effectiveMarketMinute)&&p.expected.baselineMarketMinute<p.expected.effectiveMarketMinute,'ordered_exact_market_minutes_required')
 requireInput(p.expected.confirmedMethod===(subtype==='F'?'Z04':'Z02'),'F_Z04_G_independent_Z02_required')
 for(const a of [p.requestActor,p.reviewActor])requireInput(typeof a.email==='string'&&a.email.endsWith('@example.invalid')&&typeof a.password==='string'&&a.password.length>0,'disposable_GoTrue_credentials_required')
 for(const a of [p.declaration,p.event])for(const key of ['sourceHash','agreementHash','claimsHash'] as const)requireInput(/^[0-9a-f]{64}$/.test(a[key]),`artifact_${key}_required`)
 requireInput(data.backend&&data.backend.engineSchemaVersion&&data.backend.migrationVersion&&/^[0-9a-f]{64}$/.test(data.backend.functionDefinitionsSha256),'installed_backend_pin_required')
 return{data,p}
}
async function login(actor:Actor,companyId:string){
 const client=createClient('http://127.0.0.1:54321',process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false}})
 const signed=await client.auth.signInWithPassword({email:actor.email,password:actor.password})
 requireInput(!signed.error&&signed.data.user?.id===actor.id,'actual_GoTrue_actor_required')
 const current=await client.auth.getUser()
 requireInput(!current.error&&current.data.user?.id===actor.id,'current_authenticated_actor_required')
 const context=await client.rpc('canonical_authenticated_tenant_context',{p_selected_company_id:companyId})
 requireInput(!context.error&&context.data?.authorized===true&&context.data.selected_company_id===companyId,'current_authenticated_tenant_context_required')
 return client
}
type ArtifactRead={status:string;artifactId:string;kind:string;contractId:string;environment:string;sourceId:string;sourceHash:string;agreementHash:string;claimsHash:string;nativeScope:Record<string,unknown>;claims:Record<string,unknown>;capturedAt:string;missing:string[]}
async function admitted(p:ProfileInput,client:Awaited<ReturnType<typeof login>>,pin:ArtifactPin,kind:'contract_requested_method'|'metering_method_event'){
 const result=await client.rpc('ediel_read_contract_original_source_v1',{p_company_id:p.companyId,p_actor_user_id:p.requestActor.id,p_artifact_id:pin.artifactId})
 if(result.error)throw Error(`z09fg_composition_input:authenticated_${kind}_read:${result.error.code}`)
 const a=result.data as ArtifactRead
 requireInput(a?.status==='authorized',`current_${kind}:${a?.missing?.join(',')??'authorized_read_required'}`)
 expect(a).toMatchObject({...pin,kind,contractId:p.contractId,environment:'test',missing:[]})
 expect(a.nativeScope).toMatchObject({companyId:p.companyId,contractId:p.contractId,environment:'test',customerId:p.expected.customerId,siteId:p.expected.siteId,meteringPointId:p.expected.meteringPointId,pointId:p.expected.pointId,identityAgency:p.expected.identityAgency,legalSenderId:p.expected.legalSenderId,legalReceiverId:p.expected.legalReceiverId,gridArea:p.expected.gridArea})
 const clock=sql<string>('SELECT to_jsonb(clock_timestamp())')
 requireInput(Number.isFinite(Date.parse(a.capturedAt))&&Date.parse(a.capturedAt)<=Date.parse(clock),'actual_artifact_admission_clock_required')
 return a
}
// PURE DECLARED SMTP CALLBACK. Finite qualification extracts this exact helper
// and imports no native body. Declared SMTP fields confer no source authority.
export function declaredCompositionSmtp(options:unknown,declared:{from:string;to:string}){
 requireInput(record(options),'declared_SMTP_options_required')
 const disposable=z.string().email().endsWith('@example.invalid')
 requireInput(disposable.safeParse(declared.from).success&&disposable.safeParse(declared.to).success,'declared_disposable_SMTP_scope_required')
 const envelope=options.envelope
 requireInput(record(envelope)&&envelope.from===declared.from&&Array.isArray(envelope.to)&&envelope.to.length===1&&envelope.to[0]===declared.to,'actual_declared_SMTP_envelope_required')
 requireInput(Buffer.isBuffer(options.raw)&&options.raw.length>0,'actual_SMTP_raw_Buffer_required')
 return{accepted:[envelope.to[0]],rejected:[],messageId:'synthetic-Z09FG-'+randomUUID(),response:'250 explicitly synthetic accepted'}
}
// END PURE DECLARED SMTP CALLBACK.
beforeEach(()=>{
 for(const[k,v]of Object.entries({EDIEL_SHARED_MAILBOX_ADDRESS:'synthetic@example.invalid',EDIEL_APP_DKIM_ENABLED:'false',EMAIL_PROVIDER:'resend',EDIEL_EMAIL_PROVIDER:'strato',EDIEL_SMTP_HOST:'smtp.example.invalid',EDIEL_SMTP_PORT:'465',EDIEL_SMTP_SECURE:'true',EDIEL_SMTP_FROM:'synthetic@example.invalid',EDIEL_SMTP_REPLY_TO:'synthetic@example.invalid',EDIEL_SMTP_USER:'synthetic@example.invalid',EDIEL_SMTP_PASS:'synthetic-only'}))vi.stubEnv(k,v)
 delivery.recipient=null;delivery.smtp.mockReset();delivery.smtp.mockImplementation(async(options:unknown)=>{
  requireInput(typeof delivery.recipient==='string','fresh_own_declared_SMTP_recipient_required')
  return declaredCompositionSmtp(options,{from:'synthetic@example.invalid',to:delivery.recipient})
 })
})
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks()})

function business(p:ProfileInput){return sql(`SELECT jsonb_build_object(
 'customer',(SELECT to_jsonb(r) FROM public.customers r WHERE company_id=${literal(p.companyId)} AND id=${literal(p.expected.customerId)}),
 'site',(SELECT to_jsonb(r) FROM public.customer_sites r WHERE company_id=${literal(p.companyId)} AND id=${literal(p.expected.siteId)}),
 'point',(SELECT to_jsonb(r) FROM public.metering_points r WHERE company_id=${literal(p.companyId)} AND id=${literal(p.expected.meteringPointId)}),
 'supply',(SELECT to_jsonb(r) FROM public.customer_supply_periods r WHERE company_id=${literal(p.companyId)} AND id=${literal(p.supplyPeriodId)}),
 'contract',(SELECT to_jsonb(r) FROM public.customer_contracts r WHERE company_id=${literal(p.companyId)} AND id=${literal(p.contractId)}),
 'switches',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.supplier_switch_requests r WHERE company_id=${literal(p.companyId)} AND metering_point_id=${literal(p.expected.meteringPointId)}))`)}
function origin(p:ProfileInput){return sql<{origins:Record<string,unknown>[];desired:Record<string,unknown>[];request:Record<string,unknown>|null}>(`SELECT jsonb_build_object(
 'origins',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM gridex_metering_method_changes.origins r WHERE company_id=${literal(p.companyId)} AND event_id=${literal(p.eventId)}),
 'desired',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM gridex_metering_method_changes.desired_change_receipts r WHERE company_id=${literal(p.companyId)} AND event_id=${literal(p.eventId)}),
 'request',(SELECT to_jsonb(r) FROM public.outbound_requests r JOIN gridex_metering_method_changes.origins o ON o.outbound_request_id=r.id AND o.company_id=r.company_id WHERE o.company_id=${literal(p.companyId)} AND o.event_id=${literal(p.eventId)}))`)}
function ackCounts(p:ProfileInput,source:string){return sql(`SELECT jsonb_build_object(
 'correlations',(SELECT count(*) FROM gridex_ack_authority.source_correlations WHERE company_id=${literal(p.companyId)} AND source_message_id=${literal(source)}),
 'receipts',(SELECT count(*) FROM gridex_ack_authority.applied_receipts r JOIN gridex_ack_authority.source_correlations c USING(ack_message_id) WHERE c.company_id=${literal(p.companyId)} AND c.source_message_id=${literal(source)}))`)}
function effects(p:ProfileInput,source:string){return sql<{objects:{source_message_id:string;company_id:string;environment:string;payload_hash:string;canonical_assessment_id:string;object_assessment_id:string;source_received_at:string;first_line_index:number;effect:{effectiveAt:string}}[];batches:Record<string,unknown>[]}>(`SELECT jsonb_build_object(
 'objects',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY first_line_index),'[]') FROM gridex_received_sources.structural_object_apply_receipts r WHERE company_id=${literal(p.companyId)} AND source_message_id=${literal(source)}),
 'batches',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY requested_scope_key),'[]') FROM gridex_received_sources.structural_apply_batches r WHERE company_id=${literal(p.companyId)} AND source_message_id=${literal(source)}))`)}
function preservedOriginal(message:EdielMessageRow){return{ id:message.id,company_id:message.company_id,environment:message.environment,direction:message.direction,message_family:message.message_family,message_code:message.message_code,raw_payload:message.raw_payload,intent_id:message.intent_id,outbound_request_id:message.outbound_request_id,source_operation_id:message.source_operation_id,transaction_reference:message.transaction_reference,interchange_reference:message.interchange_reference,message_sent_at:message.message_sent_at,contrl_status:message.contrl_status,aperak_status:message.aperak_status }}
function structureFacts(result:QualifiedCustomerStructure){
 requireInput(result.status==='selected',`dated_structure:${result.status==='unavailable'?result.reason:'selected_required'}`)
 return{objectId:result.objectId,identityAgency:result.identityAgency,legalSupplier:result.legalSupplier,legalNetwork:result.legalNetwork,fields:result.fields,selection:result.selection}
}
async function selected(p:ProfileInput,minute:string){return readQualifiedCustomerStructure({companyId:p.companyId,customerId:p.expected.customerId,siteId:p.expected.siteId,meteringPointId:p.expected.meteringPointId,actorUserId:p.reviewActor.id,environment:'test',periodStart:minute,periodEnd:minute})}

export function assertReceivedAfterSend(sentAt:string|null|undefined,receivedAt:string|null|undefined){
 requireInput(typeof sentAt==='string'&&typeof receivedAt==='string'&&Number.isFinite(Date.parse(sentAt))&&Number.isFinite(Date.parse(receivedAt))&&Date.parse(receivedAt)>Date.parse(sentAt),'physical_received_clock_after_own_dispatch_required')
}
export function externalAck(original:EdielMessageRow,family:'CONTRL'|'APERAK',defect?:'unknown'){
 const e=EdifactEnvelopeCodec.decode(original.raw_payload!)
 let segments=family==='CONTRL'?renderContrl2Ediel2({source:{rawPayload:original.raw_payload},outcome:'positive'}).segments:renderAperakEdiel({source:{id:original.id,messageFamily:'PRODAT',messageCode:'Z09',rawPayload:original.raw_payload},refs:{},externalReference:randomUUID(),transactionReference:randomUUID(),outcome:'positive'}).segments
 if(defect==='unknown')segments=segments.map(s=>s.startsWith('UCI+')?s.replace(/^(UCI\+)[^+]*/,'$1UNKNOWN'):s.startsWith('RFF+ACW:')?'RFF+ACW:UNKNOWN':s)
 return EdifactEnvelopeCodec.encode({sender:e.receiver!,receiver:e.sender!,senderQualifier:e.receiverQualifier,receiverQualifier:e.senderQualifier,senderSubAddress:e.receiverSubAddress,receiverSubAddress:e.senderSubAddress,applicationReference:e.applicationReference,acknowledgementRequest:false,environment:'test',interchangeReference:randomUUID().replaceAll('-','').slice(0,14),messages:[{messageReference:randomUUID().replaceAll('-','').slice(0,14),messageTypeToken:family==='CONTRL'?'CONTRL:2:2:UN:EDIEL2':'APERAK:D:96A:UN:E2SE6A',businessSegments:segments}]})
}
export function independentStructureWire(scope:Z06fNativeWireScope,subtype:'F'|'G',minute:string,confirmedMethod:'Z04'|'Z02'){
 requireInput(prodatMarketMinuteToUtc(minute),'exact_Z06_market_minute_required')
 const source=EdifactEnvelopeCodec.decode(z06fNativeStructureWire(scope,subtype,randomUUID().replaceAll('-','').slice(0,30)))
 let methodCount=0,dateCount=0
 const body=source.segments.filter(s=>!['UNB','UNH','UNT','UNZ'].includes(s.tag)).map((s,index,segments)=>{
  if(s.tag==='DTM'&&segmentComposite(s,1,source.una)[0]==='157'){dateCount++;return`DTM+157:${minute}:203`}
  if(s.tag==='DTM'&&segmentComposite(s,1,source.una)[0]==='137')return`DTM+137:${prodatNowDate203()}:203`
  const previous=segments[index-1]
  if(s.tag==='CAV'&&previous?.tag==='CCI'&&segmentComposite(previous,2,source.una)[0]==='Z04'){methodCount++;return`CAV+${confirmedMethod}`}
  return s.raw
 })
 requireInput(dateCount===1&&methodCount===1,'own_Z06_date_method_fields_required')
 return EdifactEnvelopeCodec.encode({sender:scope.receiver,receiver:scope.sender,senderQualifier:source.senderQualifier,receiverQualifier:source.receiverQualifier,applicationReference:'23-DDQ-PRODAT',acknowledgementRequest:true,environment:'test',timeZone:'Etc/GMT-1',interchangeReference:randomUUID().replaceAll('-','').slice(0,14),messages:[{messageReference:randomUUID().replaceAll('-','').slice(0,14),messageTypeToken:source.segments.find(s=>s.tag==='UNH')!.elements[2],businessSegments:body}]})
}
async function intake(p:ProfileInput,original:EdielMessageRow,raw:string){
 // Raw custody is born prospectively under the actual service_role INSERT
 // owner, before real parsing/canonical source admission. No custody backfill.
 const mail=await seedOriginalMailboxNative(<T>(statement:string)=>sql<T>(`BEGIN; SET LOCAL ROLE service_role; ${statement} COMMIT;`),literal,{companyId:p.companyId,environment:'test',raw,smtpFrom:'synthetic@example.invalid'})
 const outboundMatch=await matchOutboundRequestForInbound({companyId:p.companyId,parsed:mail.parsed,inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId})
 const id=await createInboundEdielMessage({companyId:p.companyId,actorUserId:p.reviewActor.id,environment:'test',inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId,parsed:mail.parsed,outboundMatch})
 requireInput(id,'actual_physical_intake_required')
 const message=await getEdielMessageById(id);requireInput(message,'admitted_message_read_required')
 expect(message).toMatchObject({company_id:p.companyId,environment:'test',direction:'inbound',raw_payload:raw,inbound_email_message_id:mail.inboundEmailMessageId,mailbox_message_id:mail.inboundEmailMessageId})
 expect(mail.sourcePayloadHash).toBe(hash(message.raw_payload!))
 assertReceivedAfterSend(original.message_sent_at,message.message_received_at)
 return message
}

it.each(['F','G'] as const)('native Z09%s own desired receipt/dispatch/physical ACKs precede independent dated Z06 first application',async subtype=>{
 const{data,p}=inputs(subtype)
 expect(sql<BackendIdentity>(backendIdentitySql)).toEqual(data.backend)
 const requestClient=await login(p.requestActor,p.companyId);await login(p.reviewActor,p.companyId)
 const declaration=await admitted(p,requestClient,p.declaration,'contract_requested_method')
 const event=await admitted(p,requestClient,p.event,'metering_method_event')
 expect(declaration.claims).toMatchObject({requestedMethod:subtype==='F'?'Z04':'Z03'})
 expect(event.claims).toMatchObject({requestedMethodDeclarationId:p.declaration.sourceId,subtype,supplyPeriodId:p.supplyPeriodId})
 expect(prodatDate203(event.claims.effectiveAt as string)).toBe(p.expected.effectiveMarketMinute)
 const read=await readMeteringMethodChangeSource({companyId:p.companyId,eventId:p.eventId,actorUserId:p.requestActor.id})
 requireInput(read.status==='authorized',`method_source:${read.status==='held'?read.missing.join(','):'authorized_required'}`)
 const basis:MeteringMethodChangeBasis=read
 expect(basis).toMatchObject({companyId:p.companyId,environment:'test',eventId:p.eventId,contractId:p.contractId,supplyPeriodId:p.supplyPeriodId,supplySourceMessageId:p.baselineSourceMessageId,...Object.fromEntries(Object.entries(p.expected).filter(([key])=>['customerId','siteId','meteringPointId','pointId','identityAgency','legalSenderId','legalReceiverId','gridArea','brpEdielId'].includes(key))),subtype,reason:subtype==='F'?'E64':'E32',method:subtype==='F'?'Z04':'Z03'})
 expect(prodatDate203(basis.effectiveAt)).toBe(p.expected.effectiveMarketMinute)
 const supply=await supabaseService.rpc('ediel_read_source_supply_at_v1',{p_company_id:p.companyId,p_actor_user_id:p.reviewActor.id,p_period_id:p.supplyPeriodId,p_at:prodatMarketMinuteToUtc(p.expected.effectiveMarketMinute)!})
 if(supply.error)throw supply.error
 expect(supply.data).toMatchObject({qualified:true,companyId:p.companyId,periodId:p.supplyPeriodId,customerId:p.expected.customerId,siteId:p.expected.siteId,meteringPointId:p.expected.meteringPointId,initialSourceMessageId:p.baselineSourceMessageId})
 expect(sql(`SELECT to_jsonb(start_date) FROM public.customer_supply_periods WHERE company_id=${literal(p.companyId)} AND id=${literal(p.supplyPeriodId)}`)).toBe(p.expected.requestedStartDate)
 const baseline=await getEdielMessageById(p.baselineSourceMessageId)
 requireInput(baseline,'baseline_original_required')
 expect(baseline).toMatchObject({company_id:p.companyId,environment:'test',direction:'inbound',message_family:'PRODAT',message_code:'Z04',metering_point_id:p.expected.meteringPointId,customer_id:p.expected.customerId,site_id:p.expected.siteId})
 const oldRaw=baseline.raw_payload;requireInput(oldRaw,'baseline_raw_required')
 const beforeBusiness=business(p),oldSelection=structureFacts(await selected(p,p.expected.baselineMarketMinute)),earlySelection=structureFacts(await selected(p,p.expected.effectiveMarketMinute)),oldEffects=effects(p,baseline.id)
 expect(oldSelection).toMatchObject({objectId:p.expected.pointId,identityAgency:p.expected.identityAgency,legalSupplier:basis.legalSenderId,legalNetwork:basis.legalReceiverId,fields:{measurementMethod:p.expected.baselineMethod},selection:{coverage:{baselineSourceMessageId:baseline.id,supplyPeriodId:p.supplyPeriodId}}})
 expect(oldSelection.selection.states.some(state=>state.sourceMessageId===baseline.id)).toBe(true)
 expect(earlySelection.fields.measurementMethod).toBe(p.expected.baselineMethod)
 expect(origin(p)).toEqual({origins:[],desired:[],request:null})
 const queued=await prepareAndQueueMeteringMethodChangeZ09({companyId:p.companyId,eventId:p.eventId,actorUserId:p.requestActor.id,preferredRouteId:p.preferredRouteId})
 requireInput(queued.status==='queued',`fresh_origin:${queued.status==='held'?queued.missing.join(','):'already_originated_input'}`)
 const prepared=queued.message
 expect(prepared).toMatchObject({company_id:p.companyId,environment:'test',direction:'outbound',message_family:'PRODAT',message_code:'Z09',application_reference:'23-DDQ-PRODAT',source_operation_id:p.eventId})
 const wire=tokenizeEdifact(prepared.raw_payload!)
 const field=(tag:string,qualifier:string)=>wire.segments.filter(s=>s.tag===tag&&segmentComposite(s,1,wire.una)[0]===qualifier)
 expect(field('DTM','157').map(s=>segmentComposite(s,1,wire.una).slice(1))).toEqual([[p.expected.effectiveMarketMinute,'203']])
 expect(wire.segments.filter(s=>s.tag==='CAV').map(s=>segmentComposite(s,1,wire.una)[0])).toEqual(expect.arrayContaining([basis.reason,basis.method]))
 expect(field('NAD','FR').map(s=>segmentComposite(s,2,wire.una)[0])).toEqual([basis.legalSenderId])
 expect(field('NAD','DO').map(s=>segmentComposite(s,2,wire.una)[0])).toEqual([basis.legalReceiverId])
 expect(field('RFF','LI').map(s=>segmentComposite(s,1,wire.una)[1])).toEqual([prepared.transaction_reference])
 const queuedOrigin=origin(p)
 expect(queuedOrigin.origins).toHaveLength(1);expect(queuedOrigin.desired).toHaveLength(1)
 expect(queuedOrigin.desired[0]).toMatchObject({event_id:p.eventId,company_id:p.companyId,environment:'test',message_id:prepared.id,payload_hash:hash(prepared.raw_payload!),basis})
 expect(queuedOrigin.origins[0]).toMatchObject({event_id:p.eventId,message_id:prepared.id,intent_id:prepared.intent_id,outbound_request_id:prepared.outbound_request_id,payload_hash:hash(prepared.raw_payload!)})
 expect(business(p)).toEqual(beforeBusiness)
 expect(structureFacts(await selected(p,p.expected.effectiveMarketMinute))).toEqual(earlySelection)
 requireInput(typeof prepared.receiver_email==='string'&&z.string().email().endsWith('@example.invalid').safeParse(prepared.receiver_email).success,'fresh_own_disposable_SMTP_recipient_required')
 delivery.recipient=prepared.receiver_email
 const sent=await sendEdielMessageViaSmtp(prepared,{actorUserId:p.requestActor.id})
 expect(sent.accepted.length).toBeGreaterThan(0);expect(delivery.smtp).toHaveBeenCalledTimes(1)
 const original=await getEdielMessageById(prepared.id);requireInput(original?.message_sent_at,'durable_actual_dispatch_required')
 expect(original.raw_payload).toBe(prepared.raw_payload);expect(Date.parse(original.message_sent_at)).toBeLessThanOrEqual(Date.parse(sql<string>('SELECT to_jsonb(clock_timestamp())')))
 const dispatch=sql<{attempts:{classification:string;entered_at:string;observed_at:string;binding:Record<string,unknown>}[]}>(`SELECT jsonb_build_object('attempts',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]') FROM gridex_ediel_transport.attempts a WHERE a.company_id=${literal(p.companyId)} AND a.environment='test' AND a.message_id=${literal(original.id)}))`)
 expect(dispatch.attempts).toHaveLength(1);expect(dispatch.attempts[0]).toMatchObject({classification:'accepted'})
 requireInput(dispatch.attempts[0].entered_at&&dispatch.attempts[0].observed_at,'durable_provider_entry_and_result_required')
 requireInput(Date.parse(dispatch.attempts[0].entered_at)<=Date.parse(dispatch.attempts[0].observed_at),'ordered_provider_entry_and_result_required')
 // Unknown own counterparty ACW/UCI is a fresh physical negative control.
 // Actual canonical guards must refuse correlation before any source ACK effect.
 for(const family of ['CONTRL','APERAK'] as const){
  const beforeCounts=ackCounts(p,original.id),beforeOrigin=origin(p),beforeSource=preservedOriginal((await getEdielMessageById(original.id))!)
  const message=await intake(p,original,externalAck(original,family,'unknown'))
  const decision=await resolveCanonicalRuntimeDecisionWithRegistry(message)
  expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision.issues)).toEqual(['accepted','manual_review','manual_review'])
  expect(decision.issues.map(issue=>issue.code)).toContain('CANONICAL_ACK_SOURCE_EVIDENCE_UNAVAILABLE')
  expect(await recordReceivedSourceValidation({original:message,validated:message,resolvedCompanyId:p.companyId,decision})).toMatchObject({status:'recorded'})
  expect(await processInboundAckMessage({actorUserId:p.reviewActor.id,message})).toMatchObject({sourceMessage:null,sourceAccepted:false,finalAckReached:false})
  expect(await readCommittedInboundAck({actorUserId:p.reviewActor.id,message})).toBeNull()
  expect(ackCounts(p,original.id)).toEqual(beforeCounts);expect(origin(p)).toEqual(beforeOrigin)
  expect(preservedOriginal((await getEdielMessageById(original.id))!)).toEqual(beforeSource)
  expect(business(p)).toEqual(beforeBusiness);expect(structureFacts(await selected(p,p.expected.effectiveMarketMinute))).toEqual(earlySelection)
 }
 const acks:EdielMessageRow[]=[]
 for(const family of ['CONTRL','APERAK'] as const){
  const message=await intake(p,original,externalAck(original,family)),decision=await resolveCanonicalRuntimeDecisionWithRegistry(message)
  expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision.issues)).toEqual(['accepted','accepted','accepted'])
  expect(await recordReceivedSourceValidation({original:message,validated:message,resolvedCompanyId:p.companyId,decision})).toMatchObject({status:'recorded'})
  expect(await processInboundAckMessage({actorUserId:p.reviewActor.id,message})).toMatchObject({outcome:'positive',sourceMessage:{id:original.id},sourceAccepted:family==='APERAK',finalAckReached:family==='APERAK'})
  expect(await readCommittedInboundAck({actorUserId:p.reviewActor.id,message})).toMatchObject({kind:'exact_receipt',sourceMessageId:original.id,result:{outcome:'positive',sourceAccepted:family==='APERAK'}})
  expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ack_authority.source_correlations WHERE company_id=${literal(p.companyId)} AND ack_message_id=${literal(message.id)} AND source_message_id=${literal(original.id)} AND ack_payload_hash=${literal(hash(message.raw_payload!))}`)).toBe(1)
  const updated=(await getEdielMessageById(original.id))!
  expect(updated.contrl_status).toBe('received');if(family==='APERAK')expect(updated.aperak_status).toBe('received');else expect(updated.aperak_status).toBe(original.aperak_status)
  expect(business(p)).toEqual(beforeBusiness);expect(structureFacts(await selected(p,p.expected.effectiveMarketMinute))).toEqual(earlySelection)
  acks.push(message)
 }
 expect(ackCounts(p,original.id)).toEqual({correlations:2,receipts:2})
 const acceptedOrigin=origin(p),acceptedOriginal=preservedOriginal((await getEdielMessageById(original.id))!)
 expect(acceptedOrigin.request).toMatchObject({id:original.outbound_request_id,status:'acknowledged'})
 for(const message of acks){expect(await processInboundAckMessage({actorUserId:p.reviewActor.id,message})).toMatchObject({outcome:'positive',sourceMessage:{id:original.id}});expect(ackCounts(p,original.id)).toEqual({correlations:2,receipts:2})}
 expect(origin(p)).toEqual(acceptedOrigin);expect(preservedOriginal((await getEdielMessageById(original.id))!)).toEqual(acceptedOriginal)
 const ownLi='Z06-'+randomUUID().replaceAll('-','').slice(0,24)
 const raw=independentStructureWire({external:basis.pointId,sender:basis.legalSenderId,receiver:basis.legalReceiverId,brpEdielId:basis.brpEdielId,caseReference:ownLi,gridAreaCode:basis.gridArea,requestedStartDate:p.expected.requestedStartDate},subtype,p.expected.effectiveMarketMinute,p.expected.confirmedMethod)
 const z06=await intake(p,original,raw)
 assertReceivedAfterSend(acks[1].message_received_at,z06.message_received_at)
 expect(z06).toMatchObject({message_family:'PRODAT',message_code:'Z06',related_message_id:null});expect(z06.id).not.toBe(original.id)
 const sourceWire=tokenizeEdifact(raw),lin=sourceWire.segments.filter(s=>s.tag==='LIN')
 expect(lin).toHaveLength(1)
 expect(sourceWire.segments.filter(s=>s.tag==='RFF'&&segmentComposite(s,1,sourceWire.una)[0]==='LI').map(s=>segmentComposite(s,1,sourceWire.una)[1])).toEqual([ownLi])
 expect(ownLi).not.toBe(original.transaction_reference)
 expect(effects(p,z06.id)).toEqual({objects:[],batches:[]})
 await processInboundEdielMessage({actorUserId:p.reviewActor.id,edielMessageId:z06.id})
 const actual=(await getEdielMessageById(z06.id))!,created=await createOrUpdateInboundProdatCase({actorUserId:p.reviewActor.id,message:actual}),pending=await getEdielInboundCaseForMessage(p.companyId,z06.id)
 requireInput(pending,'actual_Z06_case_required');expect(created?.id).toBe(pending.id)
 expect(pending).toMatchObject({company_id:p.companyId,ediel_message_id:z06.id,message_code:'Z06',status:'pending_review'})
 expect(await reviewReceivedStructuralSource({companyId:p.companyId,environment:'test',sourceMessageId:z06.id,reviewerUserId:p.reviewActor.id,confirmedOriginal:true,replacesSourceMessageId:null})).toMatchObject({status:'recorded',sourceDisposition:'accepted'})
 expect(effects(p,z06.id)).toEqual({objects:[],batches:[]})
 // Review makes a structural candidate available, but cannot establish the
 // actual first effect: the dated reader refuses its missing apply receipt.
 expect(await selected(p,p.expected.effectiveMarketMinute)).toEqual({status:'unavailable',reason:'dated_structure_applied_source_missing'})
 expect(business(p)).toEqual(beforeBusiness);expect(origin(p)).toEqual(acceptedOrigin)
 expect(await approveEdielInboundCase({companyId:p.companyId,actorUserId:p.reviewActor.id,caseId:pending.id,structuralObjectLineIndices:[lin[0].index]})).toMatchObject({company_id:p.companyId,ediel_message_id:z06.id,status:'applied'})
 const applied=effects(p,z06.id)
 expect(applied.objects).toHaveLength(1);expect(applied.batches).toHaveLength(1)
 expect(applied.objects[0]).toMatchObject({source_message_id:z06.id,company_id:p.companyId,environment:'test',payload_hash:hash(raw),first_line_index:lin[0].index,source_received_at:z06.message_received_at,actor_user_id:p.reviewActor.id,object_scope:{objectId:basis.pointId,identityAgency:basis.identityAgency}})
 expect(applied.objects[0].canonical_assessment_id).toBeTruthy();expect(applied.objects[0].object_assessment_id).toBeTruthy()
 expect(prodatDate203(applied.objects[0].effect.effectiveAt)).toBe(p.expected.effectiveMarketMinute)
 const later=structureFacts(await selected(p,p.expected.effectiveMarketMinute))
 expect(later).toMatchObject({objectId:basis.pointId,identityAgency:basis.identityAgency,legalSupplier:basis.legalSenderId,legalNetwork:basis.legalReceiverId,fields:{measurementMethod:p.expected.confirmedMethod},selection:{coverage:{baselineSourceMessageId:baseline.id,supplyPeriodId:p.supplyPeriodId}}})
 expect(later.selection.states.some(state=>state.sourceMessageId===z06.id&&state.payloadHash===hash(raw))).toBe(true)
 expect(structureFacts(await selected(p,p.expected.baselineMarketMinute))).toEqual(oldSelection)
 expect((await getEdielMessageById(baseline.id))!.raw_payload).toBe(oldRaw);expect(effects(p,baseline.id)).toEqual(oldEffects)
 expect((await getEdielMessageById(z06.id))!.raw_payload).toBe(raw)
 expect(origin(p)).toEqual(acceptedOrigin);expect(preservedOriginal((await getEdielMessageById(original.id))!)).toEqual(acceptedOriginal)
 const final=await readReceivedProdatFinalResponsePlan({companyId:p.companyId,sourceMessageId:z06.id,rawPayload:raw})
 expect(final).toMatchObject({totalObjectCount:1,plans:[{outcome:'positive',objectLineIndices:[lin[0].index],acknowledgedReferences:[ownLi],effectKind:'structural'}]})
 const stableBusiness=business(p)
 expect(await approveEdielInboundCase({companyId:p.companyId,actorUserId:p.reviewActor.id,caseId:pending.id,structuralObjectLineIndices:[lin[0].index]})).toMatchObject({status:'applied'})
 expect(effects(p,z06.id)).toEqual(applied);expect(structureFacts(await selected(p,p.expected.effectiveMarketMinute))).toEqual(later)
 expect(structureFacts(await selected(p,p.expected.baselineMarketMinute))).toEqual(oldSelection)
 expect(origin(p)).toEqual(acceptedOrigin);expect(business(p)).toEqual(stableBusiness);expect(delivery.smtp).toHaveBeenCalledTimes(1)
},120000)

// Finite controls exercise the actual new wire helper and actual tokenizer /
// envelope codec. They establish no database/source/permission/ACK authority.
it('finite composition wire retains independent G Z02 confirmation, exact date, national306 and rejects impossible receipt order',()=>{
 const scope={external:'735123456789012345',sender:'54321',receiver:'12345',brpEdielId:'11111',caseReference:'INDEPENDENT-Z06',gridAreaCode:'NET-1',requestedStartDate:'2026-11-01'}
 for(const[subtype,method]of [['F','Z04'],['G','Z02']] as const){
  const raw=independentStructureWire(scope,subtype,'202611131315',method),wire=tokenizeEdifact(raw),envelope=EdifactEnvelopeCodec.decode(raw)
  expect(validateEdifactEnvelope(raw).syntaxOk).toBe(true);expect(envelope).toMatchObject({sender:'12345',receiver:'54321',applicationReference:'23-DDQ-PRODAT'})
  expect(wire.segments.filter(s=>s.tag==='DTM'&&segmentComposite(s,1,wire.una)[0]==='157').map(s=>segmentComposite(s,1,wire.una))).toEqual([['157','202611131315','203']])
  for(const[qualifier,value]of [['Z04',method],['Z07','Z12'],['Z13',subtype==='F'?'E64':'E32']] as const){
   const positions=wire.segments.filter(s=>s.tag==='CCI'&&segmentComposite(s,2,wire.una)[0]===qualifier)
   expect(positions).toHaveLength(1)
   expect(segmentComposite(wire.segments[positions[0].index+1],1,wire.una)[0]).toBe(value)
  }
  expect(wire.segments.filter(s=>s.tag==='RFF'&&segmentComposite(s,1,wire.una)[0]==='LI').map(s=>segmentComposite(s,1,wire.una)[1])).toEqual(['INDEPENDENT-Z06'])
 }
 expect(()=>independentStructureWire(scope,'G','202602301315','Z02')).toThrow('exact_Z06_market_minute_required')
 assertReceivedAfterSend('2026-10-13T10:00:00Z','2026-10-13T10:00:01Z')
 for(const received of ['2026-10-13T10:00:00Z','2026-10-13T09:59:59Z','invalid'])expect(()=>assertReceivedAfterSend('2026-10-13T10:00:00Z',received)).toThrow('physical_received_clock_after_own_dispatch_required')
})

it('finite composition physical ACK rendering binds the supplied original and an unknown reference cannot qualify it',()=>{
 // Modeled bytes only, with an explicit source candidate. This pure check does
 // not provide the sent/received source seals or atomic native ACK receipts.
 const scope={external:'735123456789012345',sender:'12345',receiver:'54321',brpEdielId:'11111',caseReference:'OWN-Z09-LI',gridAreaCode:'NET-1',requestedStartDate:'2026-11-01'}
 const raw=independentStructureWire(scope,'F','202611131315','Z04').replace('BGM+Z06+','BGM+Z09+')
 const original:EdielMessageRow={...structuralOwnerSource('Z06'),id:randomUUID(),direction:'outbound',environment:'test',message_code:'Z09',raw_payload:raw,message_sent_at:'2026-10-13T10:00:00Z'}
 for(const family of ['CONTRL','APERAK'] as const){
  const ack={id:randomUUID(),company_id:original.company_id,environment:'test',direction:'inbound',message_family:family,raw_payload:externalAck(original,family)}
  expect(validateEdifactEnvelope(ack.raw_payload).syntaxOk).toBe(true)
  const qualified=qualifyInboundAckSourceCandidates({ackMessage:ack,candidates:[original],expectedCompanyId:original.company_id})
  expect(qualified).toMatchObject({status:'unique',sourceMessage:{id:original.id},correlation:{classification:{outcome:'positive'}}})
  const unknown={...ack,raw_payload:externalAck(original,family,'unknown')}
  expect(validateEdifactEnvelope(unknown.raw_payload).syntaxOk).toBe(true)
  expect(qualifyInboundAckSourceCandidates({ackMessage:unknown,candidates:[original],expectedCompanyId:original.company_id})).toMatchObject({status:'unresolved',sourceMessage:null,reason:'ack_source_unresolved'})
 }
})
