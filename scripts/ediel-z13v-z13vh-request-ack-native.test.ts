// masterplan: AT-Z13V-ESCO, AT-Z13VH-ESCO
// Request/ACK and prospective public Z14-to-grant proof. Whole-card approval
// additionally needs the declared business-role/direction/R-D refusals.
// Only disposable identities, legal issuer inputs, counterpart bytes and
// external SMTP are synthetic. All archive/review/send/intake/ACK owners run.
import {createHash,randomUUID} from 'node:crypto'
import {spawn} from 'node:child_process'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {seedNativeEscoFixture as seed,prepareNativeEscoPermissionFixture as prepare,
 reviewNativeEscoAssignmentEvidence,
 resetNativeEscoFixture,nativeEscoSql as sql,nativeEscoLiteral as lit,
 nativeEscoExternal,NATIVE_ESCO_DB} from './fixtures/ediel-service-evidence-native'
import {seedOriginalMailboxNative} from './helpers/originalMailboxNative'
import {omitZ14Field} from './helpers/ediel-z14v-current-native-fixture'
import {readEdielServiceAdministration} from '@/lib/ediel/services/administration'
import {createEdielMessageIntent,getEdielMessageIntentById} from '@/lib/ediel/intent/intentEngine'
import {createInboundEdielMessage} from '@/lib/inbound-mail/inboundStatusUpdater'
import {matchOutboundRequestForInbound} from '@/lib/inbound-mail/inboundMatcher'
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {readCommittedInboundAck} from '@/lib/ediel/ack/committedInboundAck'
import {readPhysicalAckSourceCorrelation} from '@/lib/ediel/ack/sourceCorrelation'
import {getEdielMessageById} from '@/lib/ediel/db'
import {renderContrl2Ediel2} from '@/lib/ediel/contrlEngine'
import {renderAperakEdiel} from '@/lib/ediel/aperakEngine'
import {renderProdat} from '@/lib/ediel/prodatEngine'
import {readReceivedProdatFinalResponsePlan} from '@/lib/ediel/core/receivedProdatFinalResponsePlan'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {validateCanonicalAckGuide} from '@/lib/ediel/rulebook/ackGuidePolicy'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {recordReceivedSourceValidation} from '@/lib/ediel/core/receivedSourceValidationLedger'
import {edielSmtpConfig} from '@/lib/ediel/mailReadiness'
import {supabaseService} from '@/lib/supabase/service'
import type {EdielMessageRow} from '@/lib/ediel/types'

type Fixture=Awaited<ReturnType<typeof seed>>
type Pending=Awaited<ReturnType<typeof prepare>>
const hash=(raw:string)=>createHash('sha256').update(raw).digest('hex')
beforeEach(resetNativeEscoFixture)
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks()})

async function request(mode:'V'|'VH',objectReply=false){
 const seeded=await seed(mode)
 configureProspectiveAckRoute(seeded)
 const objectAckProfile=objectReply?configureProspectiveAckRoute(seeded,'APERAK'):null
 let f=seeded
 const sentinel=sql(`SELECT to_jsonb(a) FROM public.ediel_service_assignments a WHERE id=${lit(seeded.assignment)}`)
 if(mode==='VH'){
  // Prospective public input, before approval/archival/request. The shared
  // fixture's future-end assignment stays held and byte-for-byte unchanged.
  const day=sql<string>(`SELECT to_jsonb(((clock_timestamp() AT TIME ZONE 'Europe/Stockholm')::date-1)::text)`)
  const fields={...seeded.fields,data_end:day+'T00:00:00Z'}
  const created=await seeded.command({action:'create_assignment',commandId:randomUUID(),fields})
  expect(created).toMatchObject({status:'held'})
  const assignment=String(created.assignmentId)
  expect(assignment).not.toBe(seeded.assignment)
  f={...seeded,fields,assignment,current:()=>sql(`SELECT jsonb_build_object('version',version,'basis',scope_basis_version,
   'scope',gridex_service_administration.scope_v1(a),
   'hash',encode(sha256(convert_to(gridex_service_administration.scope_v1(a)::text,'UTF8')),'hex'))
   FROM public.ediel_service_assignments a WHERE company_id=${lit(seeded.ids.company)} AND id=${lit(assignment)}`)}
 }
 const p=await prepare(f)
 const wire=EdifactEnvelopeCodec.decode(p.z13.raw_payload!)
 expect(p.z13).toMatchObject({company_id:f.ids.company,direction:'outbound',environment:'test',message_code:'Z13',status:'sent',application_reference:'23-DGI-PRODAT'})
 expect([wire.sender,wire.receiver]).toEqual([f.sender,f.receiver])
 expect(wire.segments.find(s=>s.tag==='BGM')?.elements[1]).toBe('Z13')
 expect(wire.segments.filter(s=>s.tag==='LIN')).toHaveLength(1)
 expect(wire.segments.find(s=>s.tag==='LIN')?.elements[1]).toBe('1')
 expect(wire.segments.find(s=>s.tag==='LIN')?.raw).toBe('LIN+1')
 // Qualify fields 261/217 from the actual reviewed contract, private frozen
 // origin and sealed SENT bytes. This READ does not create source authority.
 expect(p.z13.intent_id).toBeTruthy()
 const sources=sql<{origin:Record<string,unknown>;evidence:Record<string,unknown>;current:boolean}[]>(`SELECT coalesce(
  jsonb_agg(jsonb_build_object('origin',to_jsonb(o),'evidence',to_jsonb(e),'current',gridex_ediel_services.review_current_v1(e)) ORDER BY o.intent_id),'[]')
  FROM gridex_service_permission.origins o JOIN public.ediel_service_evidence e ON e.id=(o.basis->>'evidenceId')::uuid
   AND e.company_id=o.company_id AND e.assignment_id=o.assignment_id AND e.kind='end_user_contract'
  WHERE o.company_id=${lit(f.ids.company)} AND o.assignment_id=${lit(f.assignment)} AND o.permission_id=${lit(p.permissionId)}
   AND o.intent_id=${lit(p.z13.intent_id)} AND o.message_id=${lit(p.z13.id)} AND o.message_code='Z13' AND o.actor_user_id=${lit(f.ids.actor)}`)
 expect(sources).toHaveLength(1)
 const {origin,evidence,current}=sources[0],basis=origin.basis as Record<string,unknown>
 expect(current).toBe(true)
 expect(f.ids.reviewer).not.toBe(f.ids.actor)
 expect(evidence).toMatchObject({id:basis.evidenceId,company_id:f.ids.company,assignment_id:f.assignment,kind:'end_user_contract',
  status:'verified',approved_by:f.ids.reviewer,approved_assignment_version:basis.scopeBasisVersion,
  source_sha256:p.hash,source_version:'synthetic-v1',permission_agreement_reference:'SYN-'+f.ids.customer.slice(0,20),permission_requested_method:'Z04'})
 expect(basis).toEqual(p.z13.parsed_payload?.sourcePermissionBasis)
 expect(basis).toMatchObject({status:'authorized',companyId:f.ids.company,assignmentId:f.assignment,customerId:f.ids.customer,
  permissionId:p.permissionId,code:'Z13',environment:'test',scopeBasisVersion:f.current().basis,evidenceSha256:p.hash,
  evidenceVersion:evidence.source_version,agreementReference:evidence.permission_agreement_reference,requestedMethod:evidence.permission_requested_method})
 const linePosition=wire.segments.findIndex(s=>s.tag==='LIN')
 const agreements=wire.segments.filter(s=>s.tag==='RFF'&&segmentComposite(s,1,wire.una)[0]==='ANJ')
 expect(agreements).toHaveLength(1)
 expect(wire.segments.indexOf(agreements[0])).toBeGreaterThan(linePosition)
 expect(segmentComposite(agreements[0],1,wire.una)).toEqual(['ANJ',evidence.permission_agreement_reference])
 const methods=wire.segments.filter(s=>s.tag==='CCI'&&segmentComposite(s,2,wire.una)[0]==='Z04')
 expect(methods).toHaveLength(1)
 const methodPosition=wire.segments.indexOf(methods[0])
 expect(methodPosition).toBeGreaterThan(linePosition)
 expect(methods[0].raw).toBe('CCI++Z04')
 expect(wire.segments[methodPosition+1]?.raw).toBe('CAV+'+evidence.permission_requested_method)
 expect(wire.segments.some(s=>s.tag==='DTM'&&segmentComposite(s,1,wire.una)[0]==='329')).toBe(false)
 expect(wire.segments.filter(s=>s.tag==='NAD'&&segmentComposite(s,1,wire.una)[0]==='UD')
  .map(s=>segmentComposite(s,2,wire.una)[0])).toEqual(['199001011234'])
 expect(wire.segments.find(s=>s.tag==='CCI'&&s.raw==='CCI++Z13')).toBeTruthy()
 expect(wire.segments.some(s=>s.raw===(mode==='V'?'CAV+S17':'CAV+S18'))).toBe(true)
 expect(sql(`SELECT to_jsonb(immutable_payload_hash) FROM public.ediel_messages WHERE id=${lit(p.z13.id)}`)).toBe(hash(p.z13.raw_payload!))
 expect(p.z13.message_sent_at).toBeTruthy()
 expect(nativeEscoExternal.send).toHaveBeenCalledTimes(1)
 const checkSentinel=()=>{
  if(mode==='VH')expect(sql(`SELECT to_jsonb(a) FROM public.ediel_service_assignments a WHERE id=${lit(seeded.assignment)}`)).toEqual(sentinel)
 }
 checkSentinel()
 return{f,p,checkSentinel,objectAckProfile}
}

// External configuration input only, supplied before archive/send/ACK birth.
// The shared E66 profile remains unchanged; the protected route selector,
// source authority, real draft persistence and outbox insertion still run.
function configureProspectiveAckRoute(f:Fixture,family:'CONTRL'|'APERAK'='CONTRL'){
 const profile=randomUUID(),smtp=edielSmtpConfig()
 const images=(exclude?:string)=>sql(`SELECT jsonb_build_object(
  'routes',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.communication_routes r WHERE company_id IN (${lit(f.ids.company)},${lit(f.ids.beneficiary)})),
  'profiles',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]') FROM public.ediel_route_profiles p WHERE company_id IN (${lit(f.ids.company)},${lit(f.ids.beneficiary)})${exclude?` AND id<>${lit(exclude)}`:''}))`)
 const before=images()
 sql(`INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,
  message_standard,payload_format,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,is_active,
  mailbox,smtp_host,smtp_port,smtp_to,receiver_email,message_family,business_code,
  sender_subaddress,sender_sub_address,receiver_subaddress,receiver_sub_address,transport_profile_id)
  SELECT ${lit(profile)},company_id,communication_route_id,${lit('Synthetic '+family+' only')},environment,
  message_standard,payload_format,sender_ediel_id,receiver_ediel_id,${lit(f.app)},is_enabled,is_active,
  mailbox,smtp_host,smtp_port,smtp_to,receiver_email,${lit(family)},${lit(family)},
  sender_subaddress,sender_sub_address,receiver_subaddress,receiver_sub_address,transport_profile_id
  FROM public.ediel_route_profiles WHERE id=${lit(f.ids.ackProfile)} AND company_id=${lit(f.ids.company)}`)
 expect(images(profile)).toEqual(before)
 // These are actual configured candidates, not a fabricated route capability.
 // The native selector must independently qualify this same unique input.
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.communication_routes r
  JOIN public.ediel_route_profiles p ON p.communication_route_id=r.id AND p.company_id=r.company_id
  LEFT JOIN public.ediel_transport_profiles tp ON tp.id=p.transport_profile_id AND tp.company_id=p.company_id AND tp.environment='test'
  WHERE r.company_id=${lit(f.ids.company)} AND r.is_active AND r.route_scope='ediel_ack'
  AND r.environment_type::text IN ('tgt_test','agt_test','bilateral_test')
  AND p.environment='test' AND p.is_enabled AND p.is_active AND p.message_standard='edifact' AND p.payload_format='edifact'
  AND (p.message_family IS NULL OR p.message_family=${lit(family)}) AND (p.business_code IS NULL OR p.business_code=${lit(family)})
  AND p.sender_ediel_id=${lit(f.sender)} AND p.receiver_ediel_id=${lit(f.receiver)}
  AND coalesce(p.sender_subaddress,p.sender_sub_address,'')='' AND coalesce(p.receiver_subaddress,p.receiver_sub_address,'')=''
  AND (p.sender_subaddress IS NULL OR p.sender_sub_address IS NULL OR p.sender_subaddress=p.sender_sub_address)
  AND (p.receiver_subaddress IS NULL OR p.receiver_sub_address IS NULL OR p.receiver_subaddress=p.receiver_sub_address)
  AND p.application_reference=${lit(f.app)} AND p.mailbox=${lit(smtp.from)}
  AND r.target_email~'^[^[:space:]@<>]+@[^[:space:]@<>]+\\.[^[:space:]@<>]+$'
  AND ((p.transport_profile_id IS NULL AND p.smtp_host=${lit(smtp.host)} AND p.smtp_port=${lit(smtp.port)})
   OR(tp.id IS NOT NULL AND tp.is_active AND tp.transport_channel='smtp' AND tp.direction IN ('outbound','both')
    AND tp.sender_email=${lit(smtp.from)} AND tp.host=${lit(smtp.host)} AND tp.port=${lit(smtp.port)}
    AND (p.smtp_host IS NULL OR p.smtp_host=${lit(smtp.host)}) AND (p.smtp_port IS NULL OR p.smtp_port=${lit(smtp.port)})))`)).toBe(1)
 return profile
}

// Full row images, not count-only absence assertions. Journal/status deltas
// live in ACK state; legal scope, foreign tenant, data and supply must not move.
function business(f:Fixture,p:Pending){
 const companies=`(${lit(f.ids.company)},${lit(f.ids.beneficiary)})`
 const tables=['companies','customers','customer_sites','metering_points','ediel_service_assignments',
  'ediel_service_evidence','ediel_assignment_permission_links','ediel_data_access_grants',
  'customer_supply_periods','supplier_switch_requests','meter_reading_series','meter_reading_values',
  'metering_permission_sites','ediel_service_history','communication_routes','ediel_route_profiles']
 const rows=tables.map(table=>`'${table}',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.${table} r WHERE ${table==='companies'?'id':'company_id'} IN ${companies})`)
 return sql<Record<string,unknown>>(`SELECT jsonb_build_object(${rows.join(',')},
  'permissions',(SELECT coalesce(jsonb_agg(CASE WHEN r.id=${lit(p.permissionId)} THEN to_jsonb(r)-ARRAY['status','updated_at','updated_by'] ELSE to_jsonb(r) END ORDER BY r.id),'[]') FROM public.metering_permissions r WHERE company_id IN ${companies}),
  'permissionEffects',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]') FROM gridex_received_sources.permission_effect_receipts r WHERE company_id IN ${companies}),
  'permissionTransitions',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]') FROM gridex_received_sources.permission_effect_transitions_v1 r WHERE company_id IN ${companies}),
  'origins',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.intent_id),'[]') FROM gridex_service_permission.origins r WHERE company_id IN ${companies}),
  'transportAttempts',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM gridex_ediel_transport.attempts r WHERE company_id IN ${companies}),
  'sealedOriginal',(SELECT jsonb_build_object('id',id,'company',company_id,'environment',environment,'direction',direction,
   'family',message_family,'code',message_code,'standard',message_standard,'raw',raw_payload,'hash',immutable_payload_hash,
   'rendered',immutable_rendered_at,'sent',message_sent_at,'sender',sender_ediel_id,'receiver',receiver_ediel_id,
   'application',application_reference,'interchange',interchange_reference,'transaction',transaction_reference,
   'route',communication_route_id,'routeProfile',route_profile_id,'intent',intent_id,'request',outbound_request_id,
   'operation',source_operation_id,'customer',customer_id,'site',site_id,'point',metering_point_id,
   'executionContext',execution_context_snapshot) FROM public.ediel_messages WHERE id=${lit(p.z13.id)}),
  'exports',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM gridex_ediel_exports.jobs r WHERE beneficiary_company_id=${lit(f.ids.beneficiary)}),
  'foreignMessages',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.ediel_messages r WHERE company_id=${lit(f.ids.beneficiary)}))`)
}
function ackState(f:Fixture,p:Pending){
 return sql(`SELECT jsonb_build_object(
  'correlations',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.ack_message_id),'[]') FROM gridex_ack_authority.source_correlations r WHERE source_message_id=${lit(p.z13.id)}),
  'receipts',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.ack_message_id),'[]') FROM gridex_ack_authority.applied_receipts r JOIN gridex_ack_authority.source_correlations c USING(ack_message_id) WHERE c.source_message_id=${lit(p.z13.id)}),
  'original',(SELECT to_jsonb(r) FROM public.ediel_messages r WHERE id=${lit(p.z13.id)}),
  'requests',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.outbound_requests r WHERE company_id=${lit(f.ids.company)}),
  'effects',${lit(f.effects())}::jsonb)`)
}
async function permission(f:Fixture,p:Pending){
 const result=await supabaseService.from('metering_permissions').select('*').eq('company_id',f.ids.company).eq('id',p.permissionId).single()
 if(result.error)throw result.error
 expect(result.data).toMatchObject({source_z13_message_id:p.z13.id,source_z14_message_id:null,inbound_z14_message_id:null,approved_start_date:null,approved_end_date:null})
 return result.data
}

async function withPermissionShare<T>(action:(signal:AbortSignal)=>Promise<T>):Promise<T>{
 if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321'
  ||NATIVE_ESCO_DB!=='postgresql://postgres:postgres@127.0.0.1:54322/postgres')throw Error('synthetic_local_native_only')
 const holder=spawn('psql',[NATIVE_ESCO_DB,'-XAtq','-v','ON_ERROR_STOP=1'],{stdio:'pipe'})
 const abort=new AbortController()
 let closed=false,expired=false,output=''
 const completion=new Promise<number|null>(resolve=>holder.once('close',code=>{closed=true;resolve(code)}))
 let refuse:(error:Error)=>void=()=>{}
 const ready=new Promise<void>((resolve,reject)=>{
  refuse=reject
  holder.once('error',()=>reject(Error('native_permission_holder_start_failed')))
  holder.once('exit',()=>reject(Error('native_permission_holder_exit_before_ready')))
  holder.stdout.on('data',chunk=>{
   output+=String(chunk)
   if(output.includes('NATIVE_PERMISSION_SHARE_READY\n'))resolve()
  })
 })
 // Consume diagnostics privately; never forward a child connection string.
 holder.stderr.on('data',()=>{})
 holder.stdin.on('error',()=>{})
 const timeout=setTimeout(()=>{
  expired=true;abort.abort();holder.kill('SIGTERM');refuse(Error('native_permission_holder_timeout'))
 },15000)
 try{
  holder.stdin.write("BEGIN; SET LOCAL idle_in_transaction_session_timeout='15s'; LOCK TABLE public.metering_permissions IN SHARE MODE; SELECT 'NATIVE_PERMISSION_SHARE_READY';\n")
  await ready
  return await action(abort.signal)
 }finally{
  if(!closed&&!holder.stdin.destroyed)holder.stdin.end('ROLLBACK;\n')
  const exit=await completion
  clearTimeout(timeout)
  if(expired||exit!==0)throw Error('native_permission_holder_cleanup_failed')
 }
}

async function proveWaitingLockRollback(f:Fixture,p:Pending,message:EdielMessageRow){
 // Real-owner preparation for an isolated public-RPC atomicity control.
 // Intake itself did not mint a canonical assessment. Use the same actual
 // resolver/ledger owners as the processor, with no invented facts or status.
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(message,{actorUserId:f.ids.actor})
 expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision]).toEqual(['accepted','accepted','accepted'])
 const recorded=await recordReceivedSourceValidation({original:message,validated:message,resolvedCompanyId:f.ids.company,decision})
 expect(recorded.status).toBe('recorded')
 if(recorded.status!=='recorded')throw Error('native_actual_canonical_owner_required')
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.validation_assessments v
  WHERE id=${lit(recorded.assessmentId)} AND source_message_id=${lit(message.id)} AND company_id=${lit(f.ids.company)}
  AND environment='test' AND source_payload_hash=${lit(hash(message.raw_payload!))}
  AND facts_text::jsonb->>'syntaxDecision'='accepted' AND facts_text::jsonb->>'applicationDecision'='accepted'
  AND facts_text::jsonb->>'functionalDecision'='accepted'
  AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id)`)).toBe(1)
 const full=()=>sql(`SELECT jsonb_build_object(
  'received',(SELECT to_jsonb(m) FROM public.ediel_messages m WHERE id=${lit(message.id)}),
  'outcomes',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]') FROM gridex_ack_authority.scope_outcomes r WHERE source_message_id=${lit(p.z13.id)}),
  'chains',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]') FROM public.ediel_ack_chains r WHERE source_message_id=${lit(p.z13.id)}),
  'physical',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.ack_message_id),'[]') FROM gridex_ack_authority.prodat_physical_receipts r WHERE source_message_id=${lit(p.z13.id)}))`)
 const before=business(f,p),pending=await permission(f,p),acks=ackState(f,p),queues=fullOutbox(f),physical=full()
 await withPermissionShare(async signal=>{
  const result=await supabaseService.rpc('gridex_apply_inbound_ack_source_v1',{
   p_company_id:f.ids.company,p_environment:'test',p_ack_message_id:message.id,p_source_message_id:p.z13.id,p_actor_user_id:f.ids.actor,
  }).abortSignal(signal)
  expect(result.error?.code).toBe('55P03')
  expect(result.data).toBeNull()
  expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ack_authority.source_correlations WHERE ack_message_id=${lit(message.id)}`)).toBe(0)
  expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ack_authority.applied_receipts WHERE ack_message_id=${lit(message.id)}`)).toBe(0)
  expect(ackState(f,p)).toEqual(acks);expect(await permission(f,p)).toEqual(pending)
  expect(business(f,p)).toEqual(before);expect(fullOutbox(f)).toEqual(queues);expect(full()).toEqual(physical)
 })
 // Holder is closed before the unchanged full public processor runs below.
 expect(ackState(f,p)).toEqual(acks);expect(await permission(f,p)).toEqual(pending)
 expect(business(f,p)).toEqual(before);expect(fullOutbox(f)).toEqual(queues);expect(full()).toEqual(physical)
}
async function noAccess(f:Fixture,p:Pending){
 const read=await readEdielServiceAdministration({companyId:f.ids.company,actorUserId:f.ids.actor,assignmentId:f.assignment})
 expect(read).toMatchObject({companyId:f.ids.company,marketActivationGranted:false,grants:[]})
 expect(read.assignments).toHaveLength(1)
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.permission_effect_receipts WHERE company_id=${lit(f.ids.company)}`)).toBe(0)
 await permission(f,p)
}

function counterpart(p:Pending,family:'CONTRL'|'APERAK',defect?:'unknown'|'wrongLI'|'negative'){
 const e=EdifactEnvelopeCodec.decode(p.z13.raw_payload!)
 let segments=family==='CONTRL'
  ?renderContrl2Ediel2({source:{rawPayload:p.z13.raw_payload},outcome:'positive'}).segments
  :renderAperakEdiel({source:{id:p.z13.id,messageFamily:'PRODAT',messageCode:'Z13',rawPayload:p.z13.raw_payload},refs:{},
   externalReference:randomUUID(),transactionReference:randomUUID(),outcome:'positive'}).segments
 // Declared counterpart bytes, before mailbox birth. Do not fabricate a
 // qualified local negative-diagnostic capability for the production renderer.
 if(defect==='negative'){
  // A synthetic external rejection of the actual object field 223. This does not
  // claim that our locally valid Z13 is invalid or mint a local diagnostic.
  const reasonIndex=e.segments.findIndex(s=>s.raw==='CCI++Z13')
  expect(reasonIndex).toBeGreaterThanOrEqual(0)
  const receivedReason=segmentComposite(e.segments[reasonIndex+1],1,e.una)[0]
  expect(['S17','S18']).toContain(receivedReason)
  expect(e.segments[reasonIndex+1].tag).toBe('CAV')
  // BGM34 means processed object outcome. BGM27/header202 would reject the
  // whole message and cannot assert this object's final refusal contract.
  segments=segments.map(s=>s==='ERC+100::260'?'ERC+42::260'
   :s==='FTX+AAO+++OK'?`FTX+AAO++223::260+Felaktigt Transaktionstyp (undertyp) ${receivedReason}`:s)
 }
 if(defect==='unknown')segments=segments.map(s=>s.startsWith('UCI+')?s.replace(/^(UCI\+)[^+]*/,'$1UNKNOWN'):s.startsWith('RFF+ACW:')?'RFF+ACW:UNKNOWN':s)
 if(defect==='wrongLI')segments=segments.map(s=>s.startsWith('RFF+LI:')?'RFF+LI:UNKNOWN':s)
 const raw=EdifactEnvelopeCodec.encode({sender:e.receiver!,receiver:e.sender!,senderQualifier:e.receiverQualifier,receiverQualifier:e.senderQualifier,
  senderSubAddress:e.receiverSubAddress,receiverSubAddress:e.senderSubAddress,applicationReference:e.applicationReference,
  acknowledgementRequest:false,environment:'test',interchangeReference:randomUUID().replaceAll('-','').slice(0,14),
  messages:[{messageReference:randomUUID().replaceAll('-','').slice(0,14),messageTypeToken:family==='CONTRL'?'CONTRL:2:2:UN:EDIEL2':'APERAK:D:96A:UN:E2SE6A',businessSegments:segments}]})
 if(defect==='negative'){
  const wire=tokenizeEdifact(raw),date=segmentComposite(wire.segments.find(s=>s.tag==='DTM'&&s.raw.startsWith('DTM+137:')),1,wire.una)[1]
  expect(date).toMatch(/^\d{12}$/)
  const policy=resolveCanonicalEdielPolicy({family:'APERAK',messageCode:'APERAK',direction:'inbound',
   associationAssignedCode:segmentComposite(wire.segments.find(s=>s.tag==='UNH'),2,wire.una)[4],
   applicationReference:e.applicationReference,referenceDate:`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`,mode:'parse'})
  expect(validateCanonicalAckGuide({policy,rawPayload:raw,rawSegments:wire.segments.map(s=>s.raw),una:wire.una,sourceRawPayload:p.z13.raw_payload})).toEqual([])
  const physical=readPhysicalAckSourceCorrelation({...p.z13,direction:'inbound',message_family:'APERAK',raw_payload:raw},p.z13)
  expect(physical.classification.outcome).toBe('negative')
  expect(physical.scope).toBe('object')
  expect(physical.acknowledgedReferences).toEqual([p.li])
 }
 return raw
}
async function retained(f:Fixture,raw:string){
 const mail=await seedOriginalMailboxNative(sql,lit,{companyId:f.ids.company,environment:'test',raw,smtpFrom:'esco-native@example.invalid'})
 const outboundMatch=await matchOutboundRequestForInbound({companyId:f.ids.company,parsed:mail.parsed,
  inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId})
 return{companyId:f.ids.company,actorUserId:f.ids.actor,environment:'test',parsed:mail.parsed,
  inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId,outboundMatch}
}
function fullOutbox(f:Fixture){
 return sql<Record<string,unknown>[]>(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.ediel_outbox r WHERE company_id IN (${lit(f.ids.company)},${lit(f.ids.beneficiary)})`)
}
async function intake(f:Fixture,p:Pending,raw:string){
 const queuedBefore=fullOutbox(f)
 const input=await retained(f,raw),id=await createInboundEdielMessage(input)
 expect(fullOutbox(f)).toEqual(queuedBefore)
 expect(id).toBeTruthy();if(!id)throw new Error('native_esco_physical_intake_required')
 const message=(await getEdielMessageById(id))!
 expect(message).toMatchObject({company_id:f.ids.company,direction:'inbound',environment:'test',raw_payload:raw,
  inbound_email_message_id:input.inboundEmailMessageId,mailbox_message_id:input.inboundEmailMessageId,immutable_payload_hash:hash(raw)})
 expect(Date.parse(message.message_received_at!)).toBeGreaterThan(Date.parse(p.z13.message_sent_at!))
 return message
}
async function consume(f:Fixture,message:EdielMessageRow){
 const before=fullOutbox(f)
 const committed=await readCommittedInboundAck({actorUserId:f.ids.actor,message})
 try{await processInboundEdielMessage({actorUserId:f.ids.actor,edielMessageId:message.id})}
 catch(error){observeAckFailure(f,message);throw error}
 const after=fullOutbox(f)
 // APERAK receives its own syntax CONTRL through the real public processor.
 // Preserve every old/foreign queue row; admit only that one source-bound
 // technical response. A replay and CONTRL itself create no queue entry.
 for(const row of before)expect(after.find(candidate=>candidate.id===row.id)).toEqual(row)
 const added=after.filter(row=>!before.some(previous=>previous.id===row.id))
 if(message.message_family==='APERAK'&&!committed){
  if(added.length!==1)observeAckFailure(f,message)
  expect(added).toHaveLength(1)
  const queued=added[0]
  expect(queued).toMatchObject({company_id:f.ids.company,environment:'test',source_message_id:message.id,
   message_family:'CONTRL',ack_outcome:'positive',status:'queued',attempts:0})
  const response=(await getEdielMessageById(String(queued.ediel_message_id)))!
  expect(response).toMatchObject({company_id:f.ids.company,environment:'test',direction:'outbound',
   message_family:'CONTRL',related_message_id:message.id})
  const physical=readPhysicalAckSourceCorrelation(response,message)
  expect(physical).toMatchObject({scope:'interchange',classification:{outcome:'positive'}})
  expect(physical.acknowledgedReferences).toEqual([EdifactEnvelopeCodec.decode(message.raw_payload!).interchangeReference])
  expect(sql(`SELECT to_jsonb(immutable_payload_hash) FROM public.ediel_messages WHERE id=${lit(response.id)}`)).toBe(hash(response.raw_payload!))
 }else expect(added).toEqual([])
 const stored=(await getEdielMessageById(message.id))!
 expect(stored.raw_payload).toBe(message.raw_payload)
 return readCommittedInboundAck({actorUserId:f.ids.actor,message:stored})
}

// Failure observations disclose only fixed decision states and known counts.
// They never seed authority, repair a source or replace the original failure.
function observeAckFailure(f:Fixture,message:EdielMessageRow){
 try{
  const state=(name:string)=>`CASE WHEN v.facts_text::jsonb->>${lit(name)} IN ('accepted','rejected','not_applicable','manual_review') THEN v.facts_text::jsonb->>${lit(name)} ELSE 'unrecognized' END`
  const observed=sql(`SELECT jsonb_build_object(
   'family',${lit(message.message_family)},
   'canonical',(SELECT coalesce(jsonb_agg(jsonb_build_object('syntax',${state('syntaxDecision')},
    'application',${state('applicationDecision')},'functional',${state('functionalDecision')})),'[]')
    FROM gridex_received_sources.validation_assessments v WHERE v.source_message_id=${lit(message.id)}
    AND v.company_id=${lit(f.ids.company)} AND v.environment='test'
    AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id)),
   'technicalBlocked',(SELECT count(*) FROM public.ediel_message_events e WHERE e.ediel_message_id=${lit(message.id)}
    AND e.company_id=${lit(f.ids.company)} AND e.event_payload->>'blockedBy'='canonical_inbound_ack_guard'),
   'technicalRouteZero',(SELECT count(*) FROM public.ediel_message_events e WHERE e.ediel_message_id=${lit(message.id)}
    AND e.company_id=${lit(f.ids.company)} AND e.message LIKE '%ediel_technical_ack_route_count:0%'))`)
  console.info('NATIVE_ACK_OBSERVATION '+JSON.stringify(observed))
 }catch{console.info('NATIVE_ACK_OBSERVATION '+JSON.stringify({diagnosticAvailable:false}))}
}

// Declared prospective grid-owner counterpart bytes. This does not choose a
// database profile, mint a canonical assessment or apply a permission.
function positiveZ14(f:Fixture,p:Pending){
 const rendered=renderProdat({code:'Z14',variant:f.mode,mode:'test',
  actor:{senderEdielId:f.receiver,receiverEdielId:f.sender},route:{applicationReference:f.app},
  version:{selectedVersion:'E2SE6A',messageTypeToken:'PRODAT:D:97A:UN:E2SE6A'},
  context:{code:'Z14',bgmReference:randomUUID().replaceAll('-','').slice(0,20),transactionReference:p.li,
   senderEdielId:f.receiver,receiverEdielId:f.sender,legalSenderId:f.receiver,legalReceiverId:f.sender,
   customerName:'Synthetic Customer',customerId:'199001011234',customerIdCodeListQualifier:'SE2',customerIdAgency:'260',customerCountry:'SE',
   meterPointId:f.point,gridAreaId:'TES',reasonForTransaction:f.mode==='V'?'S17':'S18',permissionStatus:'A74',permissionPurpose:'B72',
   permissionId:'SYNTHETIC-PERMISSION-'+p.permissionId.slice(0,8),permissionTimestamp:new Date().toISOString(),
   reportStartDate:f.fields.data_start,reportEndDate:f.fields.data_end,reportingFrequency:'D',energyProductId:f.product,
   observationLength:'60',observationLengthFormat:'806',meteringMethod:'Z04',installationDirection:'E19',
   siteAddress:'Synthetic Street 1',siteCity:'Teststad',sitePostalCode:'12345',siteCountry:'SE',siteIdAgency:'9'}})
 // Request-dependent facts stay with the received reporting owner. This
 // renderer cannot qualify them; the public processor must accept them.
 expect(rendered.issues.filter(x=>x.severity==='error'&&!/_UNDETERMINED$/.test(x.code)),JSON.stringify(rendered.issues)).toEqual([])
 return EdifactEnvelopeCodec.encode({sender:f.receiver,receiver:f.sender,applicationReference:f.app,
  interchangeReference:randomUUID().replaceAll('-','').slice(0,14),environment:'test',acknowledgementRequest:true,
  messages:[{messageReference:'1',messageTypeToken:'PRODAT:D:97A:UN:E2SE6A',businessSegments:rendered.segments}]})
}

async function currentPermission(f:Fixture,p:Pending){
 const result=await supabaseService.from('metering_permissions').select('*').eq('company_id',f.ids.company).eq('id',p.permissionId).single()
 if(result.error)throw result.error
 return result.data
}

// Allow only the explicitly asserted own source transition and one exact
// grant. Every prior/foreign row and every other business table stays whole.
const z14PermissionMutations=['status','source_z14_message_id','inbound_z14_message_id','permission_id','permission_reference',
 'approved_start_date','approved_end_date','approved_start_at','approved_end_at','product_code','report_frequency',
 'last_blocker','metadata','market_state_version','updated_at','updated_by']
const unchangedPermission=(row:Record<string,unknown>)=>Object.fromEntries(Object.entries(row).filter(([key])=>!z14PermissionMutations.includes(key)))
function continuationInvariant(image:Record<string,unknown>,f:Fixture,p:Pending,sourceId:string,grantId?:string,siteId?:string){
 const result={...image}
 const select=(key:string,changed:(row:Record<string,unknown>)=>boolean)=>{
  result[key]=(image[key] as Record<string,unknown>[]).filter(row=>!changed(row))
 }
 const own=(row:Record<string,unknown>)=>row.company_id===f.ids.company
 result.permissions=(image.permissions as Record<string,unknown>[]).map(row=>own(row)&&row.id===p.permissionId?unchangedPermission(row):row)
 select('metering_permission_sites',row=>siteId!==undefined&&own(row)&&row.id===siteId&&row.metering_permission_id===p.permissionId&&row.facility_id===f.point)
 for(const key of ['permissionEffects','permissionTransitions'])select(key,row=>own(row)&&row.permission_id===p.permissionId&&row.source_message_id===sourceId)
 if(grantId){
  select('ediel_data_access_grants',row=>own(row)&&row.id===grantId&&row.assignment_id===f.assignment)
  select('ediel_service_history',row=>own(row)&&row.entity_table==='ediel_data_access_grants'&&row.entity_id===grantId)
 }
 return result
}

async function committedZ14Replies(f:Fixture,p:Pending,source:EdielMessageRow,previous:Record<string,unknown>[],profile:string){
 const after=fullOutbox(f)
 for(const row of previous)expect(after.find(candidate=>candidate.id===row.id)).toEqual(row)
 const added=after.filter(row=>!previous.some(old=>old.id===row.id))
 expect(added).toHaveLength(2)
 expect(added.map(row=>row.message_family).sort()).toEqual(['APERAK','CONTRL'])
 const wire=tokenizeEdifact(source.raw_payload!),line=wire.segments.find(s=>s.tag==='LIN')!
 for(const queue of added){
  expect(queue).toMatchObject({company_id:f.ids.company,environment:'test',source_message_id:source.id,
   ack_outcome:'positive',status:'queued',attempts:0})
  const ack=(await getEdielMessageById(String(queue.ediel_message_id)))!
  expect(ack).toMatchObject({company_id:f.ids.company,environment:'test',direction:'outbound',related_message_id:source.id,
   message_family:queue.message_family,ack_outcome:'positive'})
  const envelope=EdifactEnvelopeCodec.decode(ack.raw_payload!),physical=readPhysicalAckSourceCorrelation(ack,source)
  expect([envelope.sender,envelope.receiver]).toEqual([f.sender,f.receiver])
  expect(physical.classification.outcome).toBe('positive')
  if(ack.message_family==='CONTRL'){
   expect(physical.scope).toBe('interchange')
   expect(physical.acknowledgedReferences).toEqual([EdifactEnvelopeCodec.decode(source.raw_payload!).interchangeReference])
  }else{
   expect(ack.route_profile_id).toBe(profile)
   expect(physical.prodatObjectOutcomes).toEqual([{objectId:f.point,identityAgency:'9',firstLineIndex:line.index,lineItemReference:p.li,outcome:'positive'}])
   expect(envelope.segments.filter(s=>s.tag==='ERC').map(s=>segmentComposite(s,1,envelope.una)[0])).toEqual(['100'])
  }
  expect(sql(`SELECT to_jsonb(immutable_payload_hash) FROM public.ediel_messages WHERE id=${lit(ack.id)}`)).toBe(hash(ack.raw_payload!))
 }
 const plan=await readReceivedProdatFinalResponsePlan({companyId:f.ids.company,sourceMessageId:source.id,rawPayload:source.raw_payload!})
 expect(plan?.plans).toHaveLength(1)
 expect(plan!.plans[0]).toMatchObject({effectKind:'metering_permission',outcome:'positive',objectLineIndices:[line.index]})
 expect(sql(`SELECT jsonb_build_object('source',source_message_id,'company',company_id,'hash',payload_hash,'canonical',canonical_assessment_id,'permission',permission_id,'original',qualified_original_message_id)
  FROM gridex_received_sources.permission_effect_receipts WHERE id=${lit(plan!.plans[0].effectReceiptId)}`)).toEqual({source:source.id,company:f.ids.company,
   hash:hash(source.raw_payload!),canonical:plan!.plans[0].canonicalAssessmentId,permission:p.permissionId,original:p.z13.id})
 return after
}

async function continueToPublishedGrant(f:Fixture,p:Pending,profile:string,checkSentinel:()=>void){
 const before=business(f,p),waiting=await permission(f,p),queues=fullOutbox(f),original=(await getEdielMessageById(p.z13.id))!
 const sqlPermission=()=>sql<Record<string,unknown>>(`SELECT to_jsonb(mp) FROM public.metering_permissions mp WHERE company_id=${lit(f.ids.company)} AND id=${lit(p.permissionId)}`)
 const sqlSites=()=>sql<Record<string,unknown>[]>(`SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.metering_permission_sites s WHERE company_id=${lit(f.ids.company)} AND metering_permission_id=${lit(p.permissionId)}`)
 const previousPermission=sqlPermission(),previousSites=sqlSites()
 expect(previousSites).toEqual([])
 expect(waiting.status).toBe('waiting_for_customer_approval')
 await noAccess(f,p)
 const source=await intake(f,p,positiveZ14(f,p))
 expect(source).toMatchObject({message_family:'PRODAT',message_code:'Z14'})
 expect(business(f,p)).toEqual(before)
 // The first source/domain invocation is the real public processor. Public
 // birth must choose V/VH itself; a missing selector is genuine RED here.
 await processInboundEdielMessage({actorUserId:f.ids.actor,edielMessageId:source.id})
 const active=await currentPermission(f,p),mode=f.mode==='V'?'S17':'S18',after=business(f,p)
 expect(active).toMatchObject({status:'active',source_z13_message_id:p.z13.id,source_z14_message_id:source.id,inbound_z14_message_id:source.id,
  outbound_z13_message_id:p.z13.id,customer_id:f.ids.customer,rff_li_reference:p.li,
  permission_id:'SYNTHETIC-PERMISSION-'+p.permissionId.slice(0,8),permission_reference:'SYNTHETIC-PERMISSION-'+p.permissionId.slice(0,8),
  approved_start_date:f.fields.data_start.slice(0,10),approved_end_date:f.fields.data_end?.slice(0,10)??null,
  product_code:f.product,report_frequency:'D',last_blocker:null,updated_by:f.ids.actor})
 expect(unchangedPermission(active)).toEqual(unchangedPermission(waiting))
 expect(Date.parse(active.approved_start_at!)).toBe(Date.parse(f.fields.data_start))
 if(f.fields.data_end)expect(Date.parse(active.approved_end_at!)).toBe(Date.parse(f.fields.data_end))
 else expect(active.approved_end_at).toBeNull()
 expect(Number.isFinite(Date.parse(active.updated_at!))).toBe(true)
 expect(Date.parse(active.updated_at!)).toBeGreaterThanOrEqual(Date.parse(waiting.updated_at!))
 expect(Number(active.market_state_version)).toBe(Number(waiting.market_state_version??0)+1)
 const actualWire=sql<{objects:Record<string,unknown>[]}>(`SELECT gridex_received_sources.permission_partition_wire_v1(${lit(source.raw_payload!)})`)
 expect(actualWire.objects).toHaveLength(1)
 expect(actualWire.objects[0]).toMatchObject({point:f.point,product:f.product,status:'A74',li:p.li,reason:mode,identityAgency:'9'})
 expect(active.metadata).toEqual({...waiting.metadata as Record<string,unknown>,marketPermission:{mode,legalActor:f.sender,
  dsoActor:f.receiver,sourceZ14:source.id,objects:actualWire.objects}})
 const sites=sqlSites(),siteId=String(sites[0]?.id)
 expect(sites).toHaveLength(1)
 expect(siteId).toMatch(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/)
 expect(sites[0]).toMatchObject({company_id:f.ids.company,metering_permission_id:p.permissionId,customer_id:f.ids.customer,
  facility_id:f.point,grid_area_code:'TES',status:'approved',start_date:f.fields.data_start.slice(0,10),end_date:f.fields.data_end?.slice(0,10)??null})
 expect(sites[0].metadata).toEqual({source:'inbound_prodat_z14',edielMessageId:source.id,mode,product:f.product,
  permissionId:'SYNTHETIC-PERMISSION-'+p.permissionId.slice(0,8)})
 expect(Date.parse(String(sites[0].start_at))).toBe(Date.parse(f.fields.data_start))
 if(f.fields.data_end)expect(Date.parse(String(sites[0].end_at))).toBe(Date.parse(f.fields.data_end))
 else expect(sites[0].end_at).toBeNull()
 const receipts=sql<Record<string,unknown>[]>(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM gridex_received_sources.permission_effect_receipts r WHERE source_message_id=${lit(source.id)}`)
 expect(receipts).toHaveLength(1)
 const receipt=receipts[0]
 expect(receipt).toMatchObject({source_message_id:source.id,company_id:f.ids.company,permission_id:p.permissionId,
  payload_hash:hash(source.raw_payload!),actor_user_id:f.ids.actor,qualified_original_message_id:p.z13.id,qualified_expected_message_code:'Z14'})
 expect(receipt.previous_state).toEqual(previousPermission);expect(receipt.resulting_state).toEqual(sqlPermission())
 expect(receipt.previous_sites).toEqual(previousSites);expect(receipt.resulting_sites).toEqual(sites)
 const application=sql<{objects:Record<string,unknown>[];assessmentId:string}>(`SELECT gridex_received_sources.require_prodat_application_objects_v1(${lit(f.ids.company)},${lit(source.id)})`)
 expect(application.objects).toHaveLength(1)
 const {applicationDecision,reasonCodes,...scope}=application.objects[0]
 expect(applicationDecision).toBe('accepted');expect(reasonCodes).toEqual([])
 expect(scope).toMatchObject({objectId:f.point,identityAgency:'9',messageIndex:0,messageReference:'1'})
 expect(receipt.object_scopes).toEqual([scope]);expect(receipt.canonical_assessment_id).toBe(application.assessmentId)
 const transitions=sql<Record<string,unknown>[]>(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.source_message_id),'[]') FROM gridex_received_sources.permission_effect_transitions_v1 t WHERE source_message_id=${lit(source.id)}`)
 const transitionKeys=['source_message_id','company_id','permission_id','payload_hash','previous_state','previous_sites','resulting_state','applied_at','actor_user_id','resulting_sites','qualified_original_message_id','qualified_expected_message_code']
 expect(transitions).toEqual([Object.fromEntries(transitionKeys.map(key=>[key,receipt[key]]))])
 expect(continuationInvariant(after,f,p,source.id,undefined,siteId)).toEqual(continuationInvariant(before,f,p,source.id,undefined,siteId))
 const stableQueues=await committedZ14Replies(f,p,source,queues,profile)
 expect(await readEdielServiceAdministration({companyId:f.ids.company,actorUserId:f.ids.actor,assignmentId:f.assignment})).toMatchObject({grants:[]})
 const link=sql<string>(`SELECT to_jsonb(id) FROM public.ediel_assignment_permission_links WHERE company_id=${lit(f.ids.company)} AND assignment_id=${lit(f.assignment)} AND permission_id=${lit(p.permissionId)}`)
 const fields={permission_link_id:link,object_ids:[f.point],product_ids:[f.product],fields:f.fields.field_sets,
  data_start:f.fields.data_start,data_end:f.fields.data_end,valid_from:f.fields.valid_from,valid_to:f.fields.valid_to}
 const create=(scope=fields)=>f.command({action:'create_grant',commandId:randomUUID(),assignmentId:f.assignment,expectedVersion:f.current().version,fields:scope})
 // A public command cannot expand the actual assignment's object scope.
 await expect(create({...fields,object_ids:[f.point,'735999260731999999']})).rejects.toMatchObject({message:'ediel_grant_scope_exceeds_assignment'})
 expect(business(f,p)).toEqual(after);expect(fullOutbox(f)).toEqual(stableQueues)
 const grant=await create()
 expect(grant).toMatchObject({status:'held',assignmentId:f.assignment,accessGranted:false})
 const grantId=String(grant.grantId),grantRow=()=>sql<Record<string,unknown>>(`SELECT to_jsonb(g) FROM public.ediel_data_access_grants g WHERE company_id=${lit(f.ids.company)} AND id=${lit(grantId)}`)
 const held=grantRow()
 expect(held).toMatchObject({company_id:f.ids.company,beneficiary_company_id:f.ids.beneficiary,assignment_id:f.assignment,status:'held',
  permission_link_id:link,object_ids:[f.point],product_ids:[f.product],fields:f.fields.field_sets,purpose:f.fields.purpose})
 for(const key of ['data_start','data_end','valid_from','valid_to'] as const){
  if(fields[key]===null)expect(held[key]).toBeNull()
  else expect(Date.parse(String(held[key]))).toBe(Date.parse(fields[key]!))
 }
 expect(await readEdielServiceAdministration({companyId:f.ids.company,actorUserId:f.ids.actor,assignmentId:f.assignment})).toMatchObject({grants:[held]})
 const publishCommand={action:'publish_grant',commandId:randomUUID(),assignmentId:f.assignment,expectedVersion:f.current().version,
  grantId,expectedGrantVersion:Number(held.version)}
 const published=await f.command(publishCommand)
 expect(published).toMatchObject({status:'active',grantId,accessGranted:true})
 const live=grantRow(),{status,version,updated_at,...liveScope}=live
 void status;void version;void updated_at
 const {status:heldStatus,version:heldVersion,updated_at:heldTime,...heldScope}=held
 void heldStatus;void heldVersion;void heldTime
 expect(liveScope).toEqual(heldScope);expect(live.status).toBe('active');expect(Number(live.version)).toBe(Number(held.version)+1)
 const final=business(f,p)
 const grantHistory=sql<Record<string,unknown>[]>(`SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.id),'[]') FROM public.ediel_service_history h
  WHERE company_id=${lit(f.ids.company)} AND entity_table='ediel_data_access_grants' AND entity_id=${lit(grantId)}`)
 expect(grantHistory).toHaveLength(2)
 expect(grantHistory[0]).toMatchObject({company_id:f.ids.company,entity_table:'ediel_data_access_grants',entity_id:grantId,before_record:null})
 expect(grantHistory[0].after_record).toEqual(held)
 expect(grantHistory[1]).toMatchObject({company_id:f.ids.company,entity_table:'ediel_data_access_grants',entity_id:grantId})
 expect(grantHistory[1].before_record).toEqual(held);expect(grantHistory[1].after_record).toEqual(live)
 expect(continuationInvariant(final,f,p,source.id,grantId,siteId)).toEqual(continuationInvariant(before,f,p,source.id,grantId,siteId))
 expect(fullOutbox(f)).toEqual(stableQueues)
 await processInboundEdielMessage({actorUserId:f.ids.actor,edielMessageId:source.id})
 expect(await f.command(publishCommand)).toEqual(published)
 expect(business(f,p)).toEqual(final);expect(fullOutbox(f)).toEqual(stableQueues)
 expect(await currentPermission(f,p)).toEqual(active)
 expect((await getEdielMessageById(source.id))?.raw_payload).toBe(source.raw_payload)
 expect((await getEdielMessageById(p.z13.id))?.raw_payload).toBe(original.raw_payload)
 expect(sql(`SELECT to_jsonb(immutable_payload_hash) FROM public.ediel_messages WHERE id=${lit(source.id)}`)).toBe(hash(source.raw_payload!))
 expect(await readEdielServiceAdministration({companyId:f.ids.company,actorUserId:f.ids.actor,assignmentId:f.assignment})).toMatchObject({grants:[live]})
 checkSentinel()
}

type FullRow=Record<string,unknown>
const refusalOwnerTables={creationReceipts:'gridex_ediel_ack_replay.creation_receipts',
 witnesses:'gridex_ediel_outbound_owner.witnesses',consumptions:'gridex_ediel_outbound_owner.consumptions',
 namespace:'gridex_ediel_wire_namespace.coverage',businessReferences:'public.ediel_business_references',
 events:'public.ediel_message_events',assessments:'gridex_received_sources.validation_assessments',
 originals:'gridex_received_sources.sources',positiveScope:'gridex_ediel_ack_replay.positive_service_scope_receipts',
 reservations:'public.ediel_ack_transaction_results'} as const
function refusalLedger(f:Fixture){
 const companies=`(${lit(f.ids.company)},${lit(f.ids.beneficiary)})`
 const entries=Object.entries(refusalOwnerTables)
 const own=entries.map(([key,table])=>`'${key}',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]')
  FROM ${table} r WHERE company_id IN ${companies} OR company_id IS NULL)`)
 const foreign=entries.map(([key,table])=>`'${key}',(SELECT jsonb_build_object('count',count(*),
  'sha256',encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb)::text,'UTF8')),'hex'))
  FROM ${table} r WHERE company_id NOT IN ${companies})`)
 return {own:sql<Record<keyof typeof refusalOwnerTables,FullRow[]>>(`SELECT jsonb_build_object(${own.join(',')})`),
  foreign:sql<FullRow>(`SELECT jsonb_build_object(${foreign.join(',')})`)}
}
// A multiset comparison preserves every field of every old row, even when
// relations use composite keys. Only independently qualified additions grow.
function retainedRows(before:FullRow[],after:FullRow[]){
 const remaining=[...after]
 for(const row of before){const position=remaining.findIndex(r=>JSON.stringify(r)===JSON.stringify(row))
  expect(position,'whole retained row removed or mutated').toBeGreaterThanOrEqual(0)
  if(position<0)throw Error('native_refusal_retained_row_changed')
  remaining.splice(position,1)
 }
 return remaining
}
function fieldOmission(raw:string,field:'321'|'322'|'323'){
 const original=tokenizeEdifact(raw),segments=original.segments
 expect(segments.filter(s=>s.tag==='LIN')).toHaveLength(1)
 const line=segments.findIndex(s=>s.tag==='LIN'),qualifier=field==='322'?'Z23':'Z24'
 const position=segments.findIndex((s,i)=>i>line&&(field==='321'
  ?s.tag==='DTM'&&segmentComposite(s,1,original.una)[0]==='91'
  :s.tag==='CCI'&&s.raw==='CCI++'+qualifier))
 expect(position).toBeGreaterThan(line)
 const length=field==='321'?1:2
 if(field==='321')expect(segmentComposite(segments[position],1,original.una)).toEqual(['91',expect.stringMatching(/^\d{12}$/),'203'])
 else expect(segments[position+1].raw).toBe('CAV+'+(field==='322'?'A74':'B72'))
 const result=omitZ14Field(raw,field),omitted=tokenizeEdifact(result)
 const expected=segments.filter((_,i)=>i<position||i>=position+length).map(s=>s.raw)
 const unh=expected.findIndex(s=>s.startsWith('UNH+')),unt=expected.findIndex(s=>s.startsWith('UNT+'))
 expected[unt]='UNT+'+(unt-unh+1)+'+'+segmentComposite(segments.find(s=>s.tag==='UNT')!,2,original.una)[0]
 expect(omitted.una).toEqual(original.una)
 expect(omitted.segments.map(s=>s.raw)).toEqual(expected)
 return result
}
function stableRefusalSource(row:FullRow){
 const projection={...row}
 for(const key of ['status','processing_status','parsed_payload','validation_report',
  'parsed_at','validated_at','updated_at','updated_by'])delete projection[key]
 return projection
}
async function missingReportingField(mode:'V'|'VH',field:'321'|'322'|'323'){
 const {f,p,checkSentinel}=await request(mode,true)
 for(const family of ['CONTRL','APERAK'] as const){
  const ack=await intake(f,p,counterpart(p,family))
  expect(await consume(f,ack)).toMatchObject({kind:'exact_receipt',sourceMessageId:p.z13.id,
   result:{outcome:'positive',sourceAccepted:family==='APERAK',finalAckReached:family==='APERAK'}})
 }
 expect((await permission(f,p)).status).toBe('waiting_for_customer_approval')
 const sealed=tokenizeEdifact(p.z13.raw_payload!),basis=p.z13.parsed_payload?.sourcePermissionBasis
 expect(basis).toMatchObject({reportingTerm:mode==='VH'?'bounded':'indefinite',customerClassification:'private',purposeCode:'B72'})
 if(field==='321')expect(sealed.segments.some(s=>s.tag==='DTM'&&segmentComposite(s,1,sealed.una)[0]==='91')).toBe(true)
 if(field==='323'){
  expect(sql(`SELECT to_jsonb(customer_type) FROM public.customers WHERE company_id=${lit(f.ids.company)} AND id=${lit(f.ids.customer)}`)).toBe('private')
  expect(sealed.segments.some((s,i)=>s.raw==='CCI++Z24'&&sealed.segments[i+1]?.raw==='CAV+B72')).toBe(true)
 }
 const wire=fieldOmission(positiveZ14(f,p),field),source=await intake(f,p,wire)
 const pending=sql<FullRow>(`SELECT to_jsonb(r) FROM public.metering_permissions r WHERE id=${lit(p.permissionId)} AND company_id=${lit(f.ids.company)}`)
 const before=producerState(f),ledger=refusalLedger(f),smtp=nativeEscoExternal.send.mock.calls.length
 const sourceBefore=(before.business.ediel_messages as FullRow[]).find(r=>r.id===source.id)!
 const code=field==='322'?'PRODAT_PERMISSION_322_MISSING':'PRODAT_RECEIVED_REPORTING_'+field+'_MISSING'
 // First source/domain invocation is the public processor, never a preflight
 // assessment that could create the authority this test is meant to prove.
 await processInboundEdielMessage({actorUserId:f.ids.actor,edielMessageId:source.id})
 const current=(await getEdielMessageById(source.id))!
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(current,{actorUserId:f.ids.actor})
 expect(decision.syntaxDecision).toBe('accepted');expect(decision.applicationDecision).toBe('rejected')
 expect(decision.issues).toEqual(expect.arrayContaining([expect.objectContaining({code,
  prodatDiagnostic:expect.objectContaining({kind:'field',fieldNumber:field,errorKind:'missing',
   occurrence:expect.objectContaining({scope:'object',objectId:f.point,identityAgency:'9',lineItemReference:p.li})})})]))
 const after=producerState(f),actual=refusalLedger(f)
 expect(actual.foreign).toEqual(ledger.foreign)
 const replies=retainedRows(before.business.ediel_messages as FullRow[],
  (after.business.ediel_messages as FullRow[]).map(r=>r.id===source.id?sourceBefore:r))
 expect(replies).toHaveLength(2)
 expect(replies.map(r=>r.message_family).sort()).toEqual(['APERAK','CONTRL'])
 const replyIds=replies.map(r=>String(r.id)),ackFor=(id:unknown)=>replies.find(r=>r.id===id)!
 for(const reply of replies){
  expect(reply).toMatchObject({company_id:f.ids.company,environment:'test',direction:'outbound',related_message_id:source.id,
   status:'draft',created_by:f.ids.actor,raw_payload:expect.any(String),immutable_payload_hash:hash(String(reply.raw_payload))})
  const physical=readPhysicalAckSourceCorrelation(reply as unknown as EdielMessageRow,current)
  expect(physical.classification.outcome).toBe(reply.message_family==='CONTRL'?'positive':'negative')
  const tokens=tokenizeEdifact(String(reply.raw_payload))
  if(reply.message_family==='CONTRL')expect(physical.acknowledgedReferences).toEqual([EdifactEnvelopeCodec.decode(wire).interchangeReference])
  else {
   expect(physical.acknowledgedReferences).toEqual([p.li])
   expect(tokens.segments.filter(s=>s.tag==='ERC').map(s=>segmentComposite(s,1,tokens.una)[0])).toEqual(['42'])
   expect(tokens.segments.some(s=>s.tag==='FTX'&&segmentComposite(s,3,tokens.una).join(':')===field+'::260')).toBe(true)
   expect(tokens.segments.filter(s=>s.tag==='RFF'&&segmentComposite(s,1,tokens.una)[0]==='Z07')
    .map(s=>segmentComposite(s,1,tokens.una))).toEqual([['Z07',f.point]])
   expect(physical.prodatObjectOutcomes).toEqual([expect.objectContaining({objectId:f.point,identityAgency:'9',lineItemReference:p.li,outcome:'negative'})])
  }
 }
 const queues=retainedRows(before.business.ediel_outbox as FullRow[],after.business.ediel_outbox as FullRow[])
 expect(queues).toHaveLength(2)
 for(const row of queues)expect(row).toMatchObject({company_id:f.ids.company,status:'queued',source_message_id:source.id,ediel_message_id:expect.stringMatching(new RegExp('^('+replyIds.join('|')+')$'))})
 const additions=Object.fromEntries(Object.keys(refusalOwnerTables).map(key=>[key,retainedRows(ledger.own[key as keyof typeof refusalOwnerTables],actual.own[key as keyof typeof refusalOwnerTables])])) as Record<keyof typeof refusalOwnerTables,FullRow[]>
 expect(additions.originals).toEqual([]);expect(additions.positiveScope).toEqual([]);expect(additions.reservations).toEqual([])
 expect(additions.creationReceipts).toHaveLength(2)
 for(const row of additions.creationReceipts){const ack=ackFor(row.ack_message_id);expect(ack).toBeTruthy()
  expect(row).toMatchObject({source_message_id:source.id,company_id:f.ids.company,environment:'test',actor_user_id:f.ids.actor,
   source_payload_hash:hash(wire),ack_payload_hash:hash(String(ack.raw_payload)),family:ack.message_family,
   outcome:ack.message_family==='CONTRL'?'positive':'negative',source_operation_id:ack.source_operation_id})
 }
 for(const key of ['namespace','witnesses','consumptions'] as const){expect(additions[key]).toHaveLength(2)
  for(const row of additions[key]){
   const ack=key==='witnesses'?replies.find(r=>hash(String(r.raw_payload))===row.payload_sha256):ackFor(row.source_message_id)
   expect(ack).toBeTruthy();expect(row).toMatchObject({company_id:f.ids.company,environment:'test',payload_sha256:hash(String(ack!.raw_payload))})
   if(key==='witnesses')expect(row).toMatchObject({actor_user_id:f.ids.actor,family:ack!.message_family,related_message_id:source.id})
   if(key==='consumptions')expect(additions.witnesses.some(w=>w.id===row.witness_id&&w.payload_sha256===row.payload_sha256)).toBe(true)
  }
 }
 // This request has no supply switch, grid-owner request or export business
 // object. Technical ACK creation must not invent reference ownership.
 expect(additions.businessReferences).toEqual([])
 const qualifyAssessments=(rows:FullRow[])=>{expect(rows.length).toBeGreaterThan(0)
  for(const row of rows){expect(row).toMatchObject({source_message_id:source.id,company_id:f.ids.company,environment:'test',source_payload_hash:hash(wire),owner:'canonical-runtime-with-registry-v1'})
   const facts=JSON.parse(String(row.facts_text));expect(row.facts_hash).toBe(hash(String(row.facts_text)))
   expect(facts).toMatchObject({syntaxDecision:'accepted',applicationDecision:'rejected',reasonCodes:expect.arrayContaining([code])})
  }
 }
 qualifyAssessments(additions.assessments)
 const qualifyEvents=(rows:FullRow[],newReplies:boolean)=>{
  for(const row of rows){expect(row).toMatchObject({company_id:f.ids.company,created_by:f.ids.actor,message_id:row.ediel_message_id})
   if(row.ediel_message_id===source.id){expect(row.event_type).toBe('validated');expect(row.event_payload).toEqual(row.payload)
    const payload=row.payload as FullRow
    if(row.message==='Status uppdaterad till validated.'){
     expect(row.event_status).toBe('success');expect(payload).toEqual({failureReason:null})
    }else if(row.message==='Canonical Ediel Runtime Engine kördes för inbound-meddelandet.'){
     expect(row.event_status).toBe('warning');expect(payload).toMatchObject({batch:'2.5B',family:'PRODAT',messageCode:'Z14',syntaxDecision:'accepted',applicationDecision:'rejected',issueCount:decision.issues.length})
     expect(payload.sourceRules).toEqual(decision.sourceRules);expect(payload.decisionTrace).toEqual(decision.decisionTrace)
    }else{
     expect(String(row.message)).toMatch(/^Backend automation pipeline prepared trace (?:and requires manual review before business ACK autosend\.|and marked message safe for backend-controlled ACK flow\.)$/)
     expect(['warning','success']).toContain(row.event_status)
     expect(payload).toMatchObject({runId:expect.any(String),steps:expect.any(Array),canAutoSendBusinessAck:expect.any(Boolean)})
     expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_processing_runs WHERE id=${lit(String(payload.runId))} AND company_id=${lit(f.ids.company)} AND source_message_id=${lit(source.id)}`)).toBe(1)
    }
   }else{expect(newReplies).toBe(true);const ack=ackFor(row.ediel_message_id);expect(ack).toBeTruthy()
    expect(row.event_status).toBe('info')
    if(row.event_type==='created'){
     const receipt=additions.creationReceipts.find(r=>r.ack_message_id===ack.id)!;expect(receipt.event_id).toBe(row.id)
     expect(row.payload).toEqual({status:ack.status,direction:'outbound',externalReference:ack.external_reference,communicationRouteId:ack.communication_route_id})
     expect(row.event_payload).toEqual({sourceMessageId:source.id,sourceOperationId:ack.source_operation_id,atomicOwner:true})
    }else{expect(row.event_type).toBe('queued');const queue=queues.find(q=>q.ediel_message_id===ack.id)!
     expect(row.message).toBe('Ediel outbox item prepared by backend automation.')
     expect(row.payload).toEqual({outboxItemId:queue.id,outboxStatus:'queued',lockKey:queue.lock_key,sourceMessageId:source.id})
     expect(row.event_payload).toEqual(row.payload)
    }
   }
  }
 }
 qualifyEvents(additions.events,true)
 const protectedState=(state:ReturnType<typeof producerState>)=>{
  const foreign={...state.foreign};delete foreign['public.ediel_message_events']
  const business={...state.business,ediel_messages:(state.business.ediel_messages as FullRow[]).filter(r=>!replyIds.includes(String(r.id)))
   .map(r=>r.id===source.id?stableRefusalSource(r):r),ediel_outbox:(state.business.ediel_outbox as FullRow[]).filter(r=>!replyIds.includes(String(r.ediel_message_id)))}
  return {foreign,business,commands:state.commands}
 }
 expect(protectedState(after)).toEqual(protectedState(before))
 expect(stableRefusalSource((after.business.ediel_messages as FullRow[]).find(r=>r.id===source.id)!)).toEqual(stableRefusalSource(sourceBefore))
 expect(current).toMatchObject({status:'validated',processing_status:'validated',updated_by:f.ids.actor,raw_payload:wire,
  parsed_payload:expect.objectContaining({canonical:decision.parsedPayload}),
  validation_report:expect.objectContaining({syntaxDecision:'accepted',applicationDecision:'rejected',
   functionalDecision:decision.functionalDecision,canonicalRuntime:decision.validationReport})})
 expect(Date.parse(current.validated_at!)).toBeGreaterThanOrEqual(Date.parse(source.created_at!))
 const deltas:Record<string,number>={messages:replies.length,outbox:queues.length,acks:replies.length,events:additions.events.length}
 for(const key of ['creationReceipts','witnesses','consumptions','namespace','businessReferences'] as const)deltas[key]=additions[key].length
 expect(after.effects).toEqual(Object.fromEntries(Object.entries(before.effects).map(([key,count])=>[key,count+(deltas[key]??0)])))
 const assertPending=()=>expect(sql(`SELECT to_jsonb(r) FROM public.metering_permissions r WHERE id=${lit(p.permissionId)} AND company_id=${lit(f.ids.company)}`)).toEqual(pending)
 assertPending();await noAccess(f,p);checkSentinel();expect(nativeEscoExternal.send).toHaveBeenCalledTimes(smtp)
 await processInboundEdielMessage({actorUserId:f.ids.actor,edielMessageId:source.id})
 const replay=producerState(f),replayLedger=refusalLedger(f)
 expect(protectedState(replay)).toEqual(protectedState(after));expect(replayLedger.foreign).toEqual(actual.foreign)
 expect(replay.business.ediel_outbox).toEqual(after.business.ediel_outbox)
 expect((replay.business.ediel_messages as FullRow[]).filter(r=>replyIds.includes(String(r.id)))).toEqual(replies)
 for(const key of Object.keys(refusalOwnerTables) as (keyof typeof refusalOwnerTables)[]){
  const added=retainedRows(actual.own[key],replayLedger.own[key])
  if(key==='events')qualifyEvents(added,false)
  else if(key==='assessments'){if(added.length)qualifyAssessments(added)}
  else expect(added).toEqual([])
 }
 expect(replay.effects).toEqual({...after.effects,events:after.effects.events+replayLedger.own.events.length-actual.own.events.length})
 assertPending();await noAccess(f,p);checkSentinel();expect(nativeEscoExternal.send).toHaveBeenCalledTimes(smtp)
}
for(const [mode,field] of [['V','322'],['VH','322'],['VH','321'],['V','323']] as const){
 it(`${mode}: missing own reporting field ${field} is rejected without permission, supply or beneficiary effects; public replay`,async()=>{
  await missingReportingField(mode,field)
 })
}

// Pre-producer snapshots use actual existing rows, with no invented permission
// or sent-source placeholder. Only the one failed public-command audit may grow.
function producerState(f:Fixture){
 const companies=`(${lit(f.ids.company)},${lit(f.ids.beneficiary)})`
 const publicTables=['companies','tenant_actor_roles','tenant_actor_identifiers','tenant_ediel_profiles','ediel_actor_settings',
  'tenant_counterparty_relations','company_memberships','user_permissions','company_capabilities',
  'customers','customer_sites','metering_points','grid_owners','ediel_service_assignments','ediel_service_evidence',
  'ediel_assignment_permission_links','ediel_data_access_grants','ediel_service_history','metering_permissions','metering_permission_sites',
  'customer_supply_periods','supplier_switch_requests','meter_reading_series','meter_reading_values',
  'communication_routes','ediel_route_profiles','outbound_requests','ediel_messages','ediel_message_intents','ediel_outbox']
 const foreignDigest=(table:string,predicate:string)=>`'${table}',(SELECT jsonb_build_object('count',count(*),
  'sha256',encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb)::text,'UTF8')),'hex'))
  FROM ${table} r WHERE ${predicate})`
 const foreign=publicTables.map(table=>foreignDigest('public.'+table,table==='companies'?`id NOT IN ${companies}`:`company_id NOT IN ${companies}`))
 const fields=publicTables.map(table=>`'${table}',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]')
  FROM public.${table} r WHERE ${table==='companies'?`id IN ${companies}`:`company_id IN ${companies} OR company_id IS NULL`})`)
 for(const table of ['gridex_service_administration.scope_versions','gridex_ediel_services.artifacts','gridex_ediel_services.issuer_representations',
  'gridex_ediel_services.reviews','gridex_service_permission.origins','gridex_ediel_transport.attempts',
  'gridex_received_sources.permission_effect_receipts','gridex_received_sources.permission_effect_transitions_v1']){
  fields.push(`'${table}',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]') FROM ${table} r WHERE company_id IN ${companies})`)
  foreign.push(foreignDigest(table,`company_id NOT IN ${companies} OR company_id IS NULL`))
 }
 fields.push(`'legalActors',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.platform_market_actors r WHERE id IN (${lit(f.ids.legal)},${lit(f.ids.dso)}))`,
  `'platformRoles',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]') FROM public.platform_actor_roles r WHERE actor_id IN (${lit(f.ids.legal)},${lit(f.ids.dso)}))`,
  `'actors',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.user_profiles r WHERE id IN (${lit(f.ids.actor)},${lit(f.ids.reviewer)}))`,
  `'issuerKeys',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM gridex_ediel_services.issuer_keys r WHERE id=${lit(f.ids.key)})`,
  `'issuerRevocations',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]') FROM gridex_ediel_services.issuer_revocations r)`,
  `'exports',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM gridex_ediel_exports.jobs r WHERE beneficiary_company_id=${lit(f.ids.beneficiary)})`)
 const legalActors=`(${lit(f.ids.legal)},${lit(f.ids.dso)})`,users=`(${lit(f.ids.actor)},${lit(f.ids.reviewer)})`
 foreign.push(foreignDigest('public.platform_market_actors',`id NOT IN ${legalActors}`),
  foreignDigest('public.platform_actor_roles',`actor_id NOT IN ${legalActors} OR actor_id IS NULL`),
  foreignDigest('public.user_profiles',`id NOT IN ${users}`),
  foreignDigest('gridex_ediel_services.issuer_keys',`id<>${lit(f.ids.key)}`),
  foreignDigest('gridex_service_administration.commands',`company_id NOT IN ${companies} OR company_id IS NULL`),
  foreignDigest('gridex_ediel_exports.jobs',`beneficiary_company_id<>${lit(f.ids.beneficiary)} OR beneficiary_company_id IS NULL`))
 // Neither producer writes message/permission events. Freeze both entire
 // event relations, including all tenants and NULL rows, without allowances.
 foreign.push(foreignDigest('public.ediel_message_events','true'),foreignDigest('public.ediel_permission_events','true'))
 // Own public NULL rows are already full images; private/command/export NULL
 // rows are in this disjoint complement. Every retained row field is hashed.
 return {
  foreign:sql<Record<string,unknown>>(`SELECT jsonb_build_object(${foreign.join(',')})`),
  business:sql<Record<string,unknown>>(`SELECT jsonb_build_object(${fields.join(',')})`),
  commands:sql<Record<string,unknown>[]>(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY command_id),'[]') FROM gridex_service_administration.commands r WHERE company_id IN ${companies}`),
  effects:f.effects(),
 }
}
function currentProducerReviews(f:Fixture,evidence:Awaited<ReturnType<typeof reviewNativeEscoAssignmentEvidence>>){
 const rows=sql<{evidence:Record<string,unknown>;current:boolean}[]>(`SELECT coalesce(jsonb_agg(jsonb_build_object('evidence',to_jsonb(e),
  'current',gridex_ediel_services.review_current_v1(e)) ORDER BY e.kind),'[]') FROM public.ediel_service_evidence e
  WHERE company_id=${lit(f.ids.company)} AND assignment_id=${lit(f.assignment)}`)
 expect(rows).toHaveLength(5)
 expect(rows.map(r=>r.evidence.kind).sort()).toEqual(['downstream_use','dso_contract','end_user_contract','privacy_roles','service_contract'])
 for(const row of rows){
  expect(row.current).toBe(true)
  expect(row.evidence).toMatchObject({company_id:f.ids.company,assignment_id:f.assignment,status:'verified',
   approved_by:f.ids.reviewer,approved_assignment_version:f.current().basis,source_sha256:evidence.hash,source_version:'synthetic-v1'})
 }
 return rows
}
async function refuseWrongProducerRole(mode:'V'|'VH'){
 const seeded=await seed(mode,{providerRole:'grid_owner'})
 const sentinel=sql(`SELECT to_jsonb(a) FROM public.ediel_service_assignments a WHERE id=${lit(seeded.assignment)}`)
 let f=seeded
 if(mode==='VH'){
  const day=sql<string>(`SELECT to_jsonb(((clock_timestamp() AT TIME ZONE 'Europe/Stockholm')::date-1)::text)`)
  const fields={...seeded.fields,data_end:day+'T00:00:00Z'}
  const created=await seeded.command({action:'create_assignment',commandId:randomUUID(),fields})
  expect(created).toMatchObject({status:'held'})
  const assignment=String(created.assignmentId)
  expect(assignment).not.toBe(seeded.assignment)
  f={...seeded,fields,assignment,current:()=>sql(`SELECT jsonb_build_object('version',version,'basis',scope_basis_version,
   'scope',gridex_service_administration.scope_v1(a),'hash',encode(sha256(convert_to(gridex_service_administration.scope_v1(a)::text,'UTF8')),'hex'))
   FROM public.ediel_service_assignments a WHERE company_id=${lit(seeded.ids.company)} AND id=${lit(assignment)}`)}
 }
 const reviewed=await reviewNativeEscoAssignmentEvidence(f),reviews=currentProducerReviews(f,reviewed)
 const before=producerState(f)
 expect(sql(`SELECT coalesce(jsonb_agg(to_jsonb(role_code) ORDER BY role_code),'[]') FROM public.tenant_actor_roles
  WHERE company_id=${lit(f.ids.company)} AND environment='test' AND actor_id=${lit(f.ids.legal)}`)).toEqual(['grid_owner'])
 expect(sql(`SELECT to_jsonb(actor_role) FROM public.ediel_actor_settings WHERE company_id=${lit(f.ids.company)} AND environment='test'`)).toBe('grid_owner')
 const command={action:'approve_assignment',commandId:randomUUID(),assignmentId:f.assignment,expectedVersion:f.current().version}
 const approved=await f.command(command)
 expect(approved).toEqual({status:'held',missing:['provider_legal_esco_role_missing']})
 const after=producerState(f)
 expect(after.business).toEqual(before.business);expect(after.effects).toEqual(before.effects)
 expect(after.foreign).toEqual(before.foreign)
 const added=after.commands.filter(r=>!before.commands.some(old=>old.command_id===r.command_id))
 expect(added).toHaveLength(1)
 const audit=added[0]
 expect(audit).toEqual({command_id:command.commandId,company_id:f.ids.company,actor_user_id:f.ids.actor,
  input:command,result:approved,recorded_at:audit.recorded_at})
 expect(typeof audit.recorded_at).toBe('string');expect(Number.isFinite(Date.parse(String(audit.recorded_at)))).toBe(true)
 expect(after.commands.filter(r=>r.command_id!==command.commandId)).toEqual(before.commands)
 expect(sql(`SELECT public.ediel_service_assignment_assessment_v1(${lit(f.ids.company)},${lit(f.assignment)})`))
  .toEqual({status:'held',missing:['assignment_not_active','provider_legal_esco_role_missing']})
 expect(await f.command({action:'request_access',assignmentId:f.assignment,expectedVersion:f.current().version,preferredRouteId:f.ids.route}))
  .toEqual({status:'held',missing:['current_authentic_service_assignment_evidence_required']})
 expect(producerState(f)).toEqual(after)
 expect(currentProducerReviews(f,reviewed)).toEqual(reviews)
 expect(nativeEscoExternal.send).not.toHaveBeenCalled()
 if(mode==='VH')expect(sql(`SELECT to_jsonb(a) FROM public.ediel_service_assignments a WHERE id=${lit(seeded.assignment)}`)).toEqual(sentinel)
}

// This is the real outbound-Z14 pre-render direction gate. Its ESCO actor
// also fails the separate sender-role check; it is no inbound reception proof.
async function refuseOutboundZ14Direction(mode:'V'|'VH'){
 const f=await seed(mode),before=producerState(f)
 const input:Parameters<typeof createEdielMessageIntent>[0]={companyId:f.ids.company,environment:'test',market:'electricity',
  messageFamily:'PRODAT',messageCode:'Z14',businessProcess:'metering_permission',direction:'outbound',
  senderEdielId:f.sender,receiverEdielId:f.receiver,applicationReference:f.app,
  routeProfileId:f.ids.routeProfile,communicationRouteId:f.ids.route,customerId:f.ids.customer,customerSiteId:f.ids.site,
  facilityId:f.point,meteringPointId:f.point,interchangeReference:randomUUID().replaceAll('-','').slice(0,14),
  messageReference:randomUUID().replaceAll('-','').slice(0,14),transactionReference:randomUUID().replaceAll('-','').slice(0,20),
  idempotencyKey:'native-z14-wrong-direction:'+randomUUID(),payload:{actorRole:'esco'},actorUserId:f.ids.actor,
  routeProfile:{actorRole:'esco',applicationReference:f.app}}
 const intent=await createEdielMessageIntent(input)
 expect(intent).toMatchObject({companyId:f.ids.company,environment:'test',messageFamily:'PRODAT',messageCode:'Z14',direction:'outbound',
  validationStatus:'blocked',renderStatus:'not_rendered',outboxStatus:'not_queued',edielMessageId:null,outboundRequestId:null})
 expect(intent.validationResult).toMatchObject({ok:false,status:'blocked',checks:{required_metadata:true,no_placeholder_identifiers:true,
  application_reference_policy:true,tenant_scope:true,message_code_supported:true,prodat_outbound_direction:false}})
 expect(intent.blockingReasons).toContainEqual({code:'prodat_direction_not_allowed',
  message:'PRODAT Z14 är inte ett outbound-meddelande för Gridex marknadsroll.',field:'messageCode',severity:'block',
  details:{supportStatus:'inbound_only',direction:'outbound'}})
 expect(await getEdielMessageIntentById(intent.id)).toEqual(intent)
 const after=producerState(f)
 const ownIntents=(state:ReturnType<typeof producerState>)=>{
  const rows=state.business.ediel_message_intents
  expect(Array.isArray(rows)).toBe(true)
  return rows as Record<string,unknown>[]
 }
 const old=ownIntents(before),current=ownIntents(after),added=current.filter(r=>!old.some(prior=>prior.id===r.id))
 expect(added).toHaveLength(1)
 const row=added[0]
 for(const field of ['created_at','updated_at']){
  expect(typeof row[field]).toBe('string')
  expect(Number.isFinite(Date.parse(row[field] as string))).toBe(true)
 }
 expect(row).toEqual({id:intent.id,company_id:f.ids.company,environment:'test',market:'electricity',message_family:'PRODAT',
  message_code:'Z14',business_process:'metering_permission',direction:'outbound',sender_ediel_id:f.sender,receiver_ediel_id:f.receiver,
  application_reference:f.app,route_profile_id:f.ids.routeProfile,communication_route_id:f.ids.route,customer_id:f.ids.customer,
  customer_site_id:f.ids.site,facility_id:f.point,metering_point_id:f.point,interchange_reference:input.interchangeReference,
  message_reference:input.messageReference,transaction_reference:input.transactionReference,idempotency_key:input.idempotencyKey,
  payload:input.payload,created_by:f.ids.actor,updated_by:f.ids.actor,validation_status:'blocked',render_status:'not_rendered',
  outbox_status:'not_queued',ediel_message_id:null,outbound_request_id:null,
  validation_result:intent.validationResult,blocking_reasons:intent.blockingReasons,
  sender_subaddress:null,receiver_subaddress:null,certificate_profile_id:null,
  grid_owner_information_request_id:null,supplier_switch_request_id:null,customer_info_request_id:null,operation_id:null,
  grid_area_code:null,requested_effective_date:null,send_not_before:null,send_window_opens_at:null,send_window_closes_at:null,
  expected_rule_version:null,expected_field_matrix_version:null,created_at:row.created_at,updated_at:row.updated_at})
 expect(current.filter(r=>r.id!==intent.id)).toEqual(old)
 expect(after.effects).toEqual({...before.effects,intents:before.effects.intents+1})
 expect({...after,effects:{...after.effects,intents:before.effects.intents},
  business:{...after.business,ediel_message_intents:current.filter(r=>r.id!==intent.id)}}).toEqual(before)
 expect(await createEdielMessageIntent(input)).toEqual(intent)
 expect(producerState(f)).toEqual(after)
 expect(nativeEscoExternal.send).not.toHaveBeenCalled()
}

for(const mode of ['V','VH'] as const){
 it(`${mode}: actual outbound Z14 direction gate retains one blocked intent with no wire or business effects; immutable reuse`,async()=>{
  await refuseOutboundZ14Direction(mode)
 })
 it(`${mode}: actual separately reviewed wrong legal producer role cannot approve or originate Z13; atomic rollback`,async()=>{
  await refuseWrongProducerRole(mode)
 })
 it(`${mode}: public Z14 after actual request ACKs grants only the separately published beneficiary scope; immutable replay`,async()=>{
  const{f,p,objectAckProfile,checkSentinel}=await request(mode,true)
  expect(objectAckProfile).toBeTruthy()
  for(const family of ['CONTRL','APERAK'] as const){
   const ack=await intake(f,p,counterpart(p,family))
   expect(await consume(f,ack)).toMatchObject({kind:'exact_receipt',sourceMessageId:p.z13.id,
    result:{outcome:'positive',sourceAccepted:family==='APERAK',finalAckReached:family==='APERAK'}})
  }
  await continueToPublishedGrant(f,p,objectAckProfile!,checkSentinel)
 },120000)

 it(`${mode}: actual Z13 receives CONTRL then object APERAK; waits for customer without access, immutable replay`,async()=>{
  const{f,p,checkSentinel}=await request(mode),before=business(f,p),pending=await permission(f,p),acks:EdielMessageRow[]=[]
  await noAccess(f,p)
  for(const family of ['CONTRL','APERAK'] as const){
   const message=await intake(f,p,counterpart(p,family))
   if(mode==='V'&&family==='APERAK')await proveWaitingLockRollback(f,p,message)
   expect(await consume(f,message)).toMatchObject({kind:'exact_receipt',sourceMessageId:p.z13.id,
    result:{outcome:'positive',sourceAccepted:family==='APERAK',finalAckReached:family==='APERAK'}})
   const original=(await getEdielMessageById(p.z13.id))!
   expect(original.contrl_status).toBe('received')
   if(family==='CONTRL'){
    expect(original.aperak_status).toBe(p.z13.aperak_status)
    expect(await permission(f,p)).toEqual(pending)
   }else{
    expect(original.aperak_status).toBe('received')
    // Genuine persisted state, not the pure TS enum or an invented RPC key.
    const current=await permission(f,p)
    expect(current.status).toBe('waiting_for_customer_approval')
    const immutable=(row:typeof current)=>{const{status,updated_at,updated_by,...rest}=row;void status;void updated_at;void updated_by;return rest}
    expect(immutable(current)).toEqual(immutable(pending))
   }
   expect(original.raw_payload).toBe(p.z13.raw_payload)
   expect(sql(`SELECT to_jsonb(immutable_payload_hash) FROM public.ediel_messages WHERE id=${lit(original.id)}`)).toBe(hash(p.z13.raw_payload!))
   expect(business(f,p)).toEqual(before);await noAccess(f,p);checkSentinel();acks.push(message)
  }
  const stable=ackState(f,p),waiting=await permission(f,p),sends=nativeEscoExternal.send.mock.calls.length
  for(const message of acks){expect(await consume(f,message)).toMatchObject({kind:'exact_receipt',sourceMessageId:p.z13.id});expect(ackState(f,p)).toEqual(stable)}
  expect(await permission(f,p)).toEqual(waiting)
  expect(nativeEscoExternal.send).toHaveBeenCalledTimes(sends)
  expect(business(f,p)).toEqual(before);checkSentinel()
 },120000)

 for(const[family,defect]of [['CONTRL','unknown'],['APERAK','wrongLI']] as const){
  it(`${mode}: ${family} ${defect} cannot admit another original or grant access`,async()=>{
   const{f,p,checkSentinel}=await request(mode),before=business(f,p),pending=await permission(f,p)
   const original=(await getEdielMessageById(p.z13.id))!,message=await intake(f,p,counterpart(p,family,defect))
   expect(await consume(f,message)).toBeNull()
   expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ack_authority.source_correlations WHERE ack_message_id=${lit(message.id)}`)).toBe(0)
   expect((await getEdielMessageById(p.z13.id))!).toEqual(original)
   expect(await permission(f,p)).toEqual(pending)
   expect(business(f,p)).toEqual(before);await noAccess(f,p);checkSentinel()
  },120000)
 }
 it(`${mode}: received negative object APERAK records refusal, not customer permission`,async()=>{
  const{f,p,checkSentinel}=await request(mode),before=business(f,p),pending=await permission(f,p)
  const contrl=await intake(f,p,counterpart(p,'CONTRL'))
  expect(await consume(f,contrl)).toMatchObject({kind:'exact_receipt',sourceMessageId:p.z13.id,
   result:{outcome:'positive',sourceAccepted:false,finalAckReached:false}})
  expect(await permission(f,p)).toEqual(pending)
  expect(business(f,p)).toEqual(before);await noAccess(f,p);checkSentinel()
  const message=await intake(f,p,counterpart(p,'APERAK','negative'))
  expect(await consume(f,message)).toMatchObject({kind:'exact_receipt',sourceMessageId:p.z13.id,
   result:{outcome:'negative',sourceAccepted:false,finalAckReached:true}})
  expect(await permission(f,p)).toEqual(pending)
  expect(business(f,p)).toEqual(before);await noAccess(f,p);checkSentinel()
 },120000)
 for(const defect of ['wrongTenant','wrongRole'] as const){
  it(`${mode}: ${defect} is refused at the public intake boundary with no ACK effect`,async()=>{
   const{f,p,checkSentinel}=await request(mode),input=await retained(f,counterpart(p,'APERAK'))
   const before=business(f,p),stable=ackState(f,p),pending=await permission(f,p)
   const queuedBefore=fullOutbox(f)
   await expect(createInboundEdielMessage({...input,...(defect==='wrongTenant'?{companyId:f.ids.beneficiary}:{actorUserId:f.ids.reviewer})}))
    .rejects.toMatchObject({name:'EdielExecutionFailure',disposition:{kind:'security_quarantine',
     code:defect==='wrongTenant'?'EDIEL_TENANT_ACTOR_FORBIDDEN':'EDIEL_TENANT_PERMISSION_FORBIDDEN'}})
   expect(ackState(f,p)).toEqual(stable);expect(await permission(f,p)).toEqual(pending)
   expect(fullOutbox(f)).toEqual(queuedBefore)
   expect(business(f,p)).toEqual(before);await noAccess(f,p);checkSentinel()
  },120000)
 }
 it(`${mode}: a received ACK cannot mutate its frozen physical original before processing`,async()=>{
  const{f,p,checkSentinel}=await request(mode),message=await intake(f,p,counterpart(p,'APERAK'))
  const before=business(f,p),stable=ackState(f,p),pending=await permission(f,p)
  const queuedBefore=fullOutbox(f)
  const changed=message.raw_payload!.replace('RFF+LI:'+p.li,'RFF+LI:UNKNOWN')
  expect(changed).not.toBe(message.raw_payload)
  const result=await supabaseService.from('ediel_messages').update({raw_payload:changed}).eq('id',message.id).select('id')
  expect(result.error).toMatchObject({code:'23514',message:'immutable_ediel_payload_cannot_change'})
  expect((await getEdielMessageById(message.id))!).toEqual(message)
  expect(ackState(f,p)).toEqual(stable);expect(await permission(f,p)).toEqual(pending)
  expect(fullOutbox(f)).toEqual(queuedBefore)
  expect(business(f,p)).toEqual(before);await noAccess(f,p);checkSentinel()
 },120000)
}
