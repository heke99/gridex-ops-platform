// SOURCE supplement only, IDs EMPTY. Genuine execution NOT_RUN; no whole-card credit.
// Seven refusal controls belong to this selected producer supplement. They are
// not new whole-Z13 gates or a requirement to rerun an already qualified pair.
// The original creator, issuer, permission and accepted transport are never seeded.
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {isDeepStrictEqual} from 'node:util'
import {expect,it,vi} from 'vitest'
import {z} from 'zod'
vi.mock('server-only',()=>({}))
import {EdielExecutionFailure} from '@/lib/ediel/core/failureDisposition'
import {assertEdielTenantActor} from '@/lib/ediel/services/authorization'
import {getEdielMessageById} from '@/lib/ediel/db'
import {readAcceptedEdielTransportProjection} from '@/lib/ediel/transport/acceptedProjection'
import {readServicePermissionOrigin} from '@/lib/ediel/services/permissionOrigin'
import {assertCapturedServiceRequestTiming} from '@/lib/ediel/services/requestTiming'
import type {ServicePermissionOriginBasis} from '@/lib/ediel/services/permissionOrigin'
import {resolveSwedishProdatCustomerIdentity} from '@/lib/ediel/prodat/customerIdentity'
import {buildInboundCanonicalIdentity,findInboundDuplicateByCanonicalIdentity} from '@/lib/ediel/core/dedupe'
import {parseEdifactPayload} from '@/lib/inbound-mail/edielEmailParser'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {matchOutboundRequestForInbound} from '@/lib/inbound-mail/inboundMatcher'
import {verifyInboundAckTransportCorrelation,failClosedOutboundMatchForAck} from '@/lib/inbound-mail/inboundAckTransportGuard'
import {createInboundEdielMessage} from '@/lib/inbound-mail/inboundStatusUpdater'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {recordReceivedSourceValidation} from '@/lib/ediel/core/receivedSourceValidationLedger'
import {processInboundAckMessage} from '@/lib/ediel/flows/inboundAckProcessing'
import {readCommittedInboundAck} from '@/lib/ediel/ack/committedInboundAck'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {seedOriginalMailboxNative} from './helpers/originalMailboxNative'
import {nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'

const digest=(raw:string)=>createHash('sha256').update(raw,'utf8').digest('hex')
const uuid=z.string().uuid(),sha=z.string().regex(/^[a-f0-9]{64}$/)
const source=z.object({companyId:uuid,actorUserId:uuid,customerId:uuid,assignmentId:uuid,
 permissionId:uuid,originalMessageId:uuid,originalHash:sha,transportAttemptId:uuid,
 intentId:uuid,scopeBasisVersion:z.number().int().positive(),assignmentVersion:z.number().int().nonnegative(),
 mode:z.enum(['V','VH']),environment:z.literal('test'),watchIds:z.array(uuid)}).strict()
const response=z.object({family:z.enum(['CONTRL','APERAK']),raw:z.string().min(1),hash:sha,
 companyId:uuid,actorUserId:uuid,smtpFrom:z.string().email()}).strict()
// These are locators/expected identities and physical counterparty inputs only.
// No row-shaped basis, accepted decision, issuer, timing proof or grant is accepted.
const cohort=z.object({source,positive:z.tuple([response,response]),refusals:z.array(z.object({
 defect:z.enum(['wrong_uci','wrong_acw','wrong_li','wrong_party','wrong_tenant','wrong_actor','wrong_environment']),
 response,
}).strict()).length(7)}).strict()
const packet=z.object({version:z.literal(1),sourceHead:z.string().regex(/^[a-f0-9]{40}$/),
 sourceTree:z.string().regex(/^[a-f0-9]{40}$/),
 ownerQualifiedBackendEpoch:z.string().min(1),cohorts:z.tuple([cohort,cohort])}).strict()
type Selection=z.infer<typeof source>
type Response=z.infer<typeof response>
type Cohort=z.infer<typeof cohort>

type OrdinaryBinding={basis:ServicePermissionOriginBasis;intentId:string;actorUserId:string;
 messageId:string;rawHash:string;requestDay:string;watchIds:string[];transportAttemptId:string}
type Effects={
 // Complete owner readsets, including coexisting rights; never global zero assumptions.
 permissions:unknown;siteRights:unknown;objectRights:unknown;grants:unknown;
 supply:unknown;permissionEffects:unknown;businessResponseWatches:unknown;
 pending:{permissionId:string;marketStateVersion:number;status:string;hasPositiveZ14:boolean;
 approvedStartAt:string|null;approvedEndAt:string|null;hasGrantedObjectRights:boolean}
}
type Oracle={
 ordinaryBinding:(selection:Selection)=>Promise<OrdinaryBinding>;
 effects:(selection:Selection,incomingIds?:string[])=>Promise<Effects>;
}

// Read-only native oracles on the later qualified owner backend. These rows
// assert persisted bindings; they never replace runtime or committed SQL guards.
function ordinaryOracle():Oracle {
 return {
  async ordinaryBinding(s){
   const rows=sql<OrdinaryBinding[]>(`SELECT coalesce(jsonb_agg(jsonb_build_object(
    'basis',o.basis,'intentId',o.intent_id,'actorUserId',o.actor_user_id,
    'messageId',o.message_id,'rawHash',encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'),
    'requestDay',t.request_day,'watchIds',(SELECT coalesce(jsonb_agg(b.expectation_id ORDER BY b.expectation_id),'[]')
      FROM gridex_business_expectations.bindings b WHERE b.company_id=m.company_id AND b.environment=m.environment
       AND b.source_message_id=m.id AND b.source_payload_hash=${literal(s.originalHash)}
       AND b.transport_attempt_id=${literal(s.transportAttemptId)}),
    'transportAttemptId',${literal(s.transportAttemptId)})), '[]')
    FROM gridex_service_permission.origins o JOIN public.ediel_messages m ON m.id=o.message_id
    JOIN gridex_service_permission.request_timing_receipts t ON t.company_id=o.company_id
     AND t.assignment_id=o.assignment_id AND t.permission_id=o.permission_id
     AND t.scope_basis_version=${literal(s.scopeBasisVersion)}
    JOIN gridex_service_administration.permission_request_owners w ON w.company_id=o.company_id
     AND w.permission_id=o.permission_id AND w.assignment_id=o.assignment_id AND w.scope_basis_version=t.scope_basis_version
    WHERE o.company_id=${literal(s.companyId)} AND o.message_id=${literal(s.originalMessageId)}
     AND o.intent_id=${literal(s.intentId)} AND o.assignment_id=${literal(s.assignmentId)}
     AND o.permission_id=${literal(s.permissionId)} AND m.customer_id=${literal(s.customerId)}
     AND m.environment='test' AND o.message_code='Z13'
     AND t.request_day::text=o.basis#>>'{requestTiming,requestDay}'
     AND t.scope=w.scope AND (o.basis->>'scopeBasisVersion')::bigint=t.scope_basis_version
     AND m.company_id=o.company_id AND t.proof=o.basis->'requestTiming'`)
   if(rows.length!==1)throw new Error('Z13_G1_INPUTHOLD: exact ordinary origin/timing/owner binding absent or ambiguous')
   const current=await readServicePermissionOrigin({providerCompanyId:s.companyId,assignmentId:s.assignmentId,
    actorUserId:s.actorUserId,expectedVersion:s.assignmentVersion,permissionId:s.permissionId,code:'Z13'})
   if(current.status!=='authorized')throw new Error('Z13_G1_INPUTHOLD: current permission origin held: '+current.missing.join(','))
   // The prepare reader is not immutable-source authority. This supplement
   // selects only a still-current pending origin; version transitions can make
   // historical valid originals ineligible without invalidating their ACKs.
   if(!isDeepStrictEqual(current,rows[0].basis))throw new Error('Z13_G1_INPUTHOLD: current prepare basis differs from immutable sent origin; owner must select applicable pending source, not repair authority')
   return rows[0]
  },
  async effects(s,incomingIds=[]){
   const c=literal(s.companyId),p=literal(s.permissionId),customer=literal(s.customerId),assignment=literal(s.assignmentId)
   // Scope all coexisting permissions/supply for the selected customer and all
   // grants/links for the selected assignment. Unrelated company customers are
   // not frozen. Incoming IDs are actual canonical birth outputs, never guesses.
   const messages=[s.originalMessageId,...incomingIds].map(literal).join(',')
   const result=sql<Effects>(`SELECT jsonb_build_object(
    'permissions',(SELECT coalesce(jsonb_agg(CASE WHEN x.id=${p} THEN to_jsonb(x)-ARRAY['status','updated_at','updated_by'] ELSE to_jsonb(x)-ARRAY['updated_at','updated_by'] END ORDER BY x.id),'[]') FROM public.metering_permissions x WHERE x.company_id=${c} AND x.customer_id=${customer}),
    'siteRights',(SELECT coalesce(jsonb_agg(to_jsonb(x)-ARRAY['created_at','updated_at'] ORDER BY x.id),'[]') FROM public.metering_permission_sites x WHERE x.company_id=${c} AND x.customer_id=${customer}),
    'objectRights',(SELECT coalesce(jsonb_agg(to_jsonb(x)-'created_at' ORDER BY x.id),'[]') FROM public.ediel_assignment_permission_links x WHERE x.company_id=${c} AND x.assignment_id=${assignment}),
    'grants',(SELECT coalesce(jsonb_agg(to_jsonb(x)-ARRAY['created_at','updated_at'] ORDER BY x.id),'[]') FROM public.ediel_data_access_grants x WHERE x.company_id=${c} AND x.assignment_id=${assignment}),
    'supply',(SELECT coalesce(jsonb_agg(to_jsonb(x)-ARRAY['created_at','updated_at'] ORDER BY x.id),'[]') FROM public.customer_supply_periods x WHERE x.company_id=${c} AND x.customer_id=${customer}),
    'permissionEffects',jsonb_build_object(
     'receipts',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]') FROM gridex_received_sources.permission_effect_receipts x WHERE x.company_id=${c} AND x.permission_id IN (SELECT id FROM public.metering_permissions WHERE company_id=${c} AND customer_id=${customer})),
     'transitions',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.source_message_id,x.permission_id),'[]') FROM gridex_received_sources.permission_transitions x WHERE x.company_id=${c} AND x.permission_id IN (SELECT id FROM public.metering_permissions WHERE company_id=${c} AND customer_id=${customer})),
     'supplyReceipts',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]') FROM gridex_received_sources.supply_object_effect_receipts x WHERE x.company_id=${c} AND x.environment='test' AND x.source_message_id IN (${messages})),
     'supplyPartitions',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.source_message_id),'[]') FROM gridex_received_sources.supply_object_partitions x WHERE x.company_id=${c} AND x.environment='test' AND x.source_message_id IN (${messages}))),
    'businessResponseWatches',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'companyId',x.company_id,'environment',x.environment,'sourceId',x.source_message_id,'expectedFamily',x.expected_family,'expectedCode',x.expected_code,'expectedSubtype',x.expected_subtype,'caseReference',x.expected_case_reference,'status',x.status,'fulfilledBy',x.fulfilled_by_message_id,'binding',to_jsonb(b)-'created_at') ORDER BY x.id),'[]') FROM public.ediel_business_expectations x JOIN gridex_business_expectations.bindings b ON b.expectation_id=x.id WHERE x.company_id=${c} AND x.environment='test' AND x.source_message_id=${literal(s.originalMessageId)} AND x.expected_family='PRODAT' AND x.expected_code IN ('Z14','Z14N')),
    'pending',(SELECT jsonb_build_object('permissionId',x.id,'marketStateVersion',x.market_state_version,'status',x.status,
     'hasPositiveZ14',coalesce(x.inbound_z14_message_id,x.source_z14_message_id) IS NOT NULL,
     'approvedStartAt',x.approved_start_at,'approvedEndAt',x.approved_end_at,
     'hasGrantedObjectRights',EXISTS(SELECT FROM public.metering_permission_sites y WHERE y.metering_permission_id=x.id AND y.status IN ('approved','active')))
     FROM public.metering_permissions x WHERE x.company_id=${c} AND x.id=${p} AND x.customer_id=${customer}))`)
   if(!result.pending)throw new Error('Z13_G1_INPUTHOLD: actual selected permission baseline absent')
   return result

  },
 }
}
function selectors(){
 const raw=process.env.EDIEL_Z13_G1_SELECTORS
 if(!raw)throw new Error('Z13_G1_INPUTHOLD: genuine owner-selected pending V/VH originals and physical reply/refusal inputs absent')
 const parsed=packet.parse(JSON.parse(raw))
 // Compare the execution checkout to the owner's reviewed source locators. No
 // backend registry is invented: backend epoch is external owner qualification
 // context, not a Boolean authority. Existing native config checks local install.
 const git=(ref:string)=>execFileSync('git',['--no-replace-objects','rev-parse',ref],{encoding:'utf8'}).trim()
 expect(git('HEAD')).toBe(parsed.sourceHead);expect(git('HEAD^{tree}')).toBe(parsed.sourceTree)
 const targets=['scripts/ediel-z13-request-ack-native-358d1615.test.ts','scripts/ediel-z13-request-ack-native-358d1615.config.ts']
 execFileSync('git',['--no-replace-objects','ls-files','--error-unmatch',...targets],{stdio:'pipe'})
 execFileSync('git',['--no-replace-objects','diff','--quiet','HEAD','--',...targets],{stdio:'pipe'})
 expect(parsed.cohorts.map(c=>c.source.mode)).toEqual(['V','VH'])
 expect(new Set(parsed.cohorts.map(c=>c.source.originalMessageId)).size).toBe(2)
 const hashes=new Set<string>(),interchanges=new Set<string>(),messages=new Set<string>(),identities=new Set<string>()
 for(const c of parsed.cohorts){
  expect(c.positive.map(r=>r.family)).toEqual(['CONTRL','APERAK'])
  expect(new Set(c.refusals.map(r=>r.defect))).toEqual(new Set(['wrong_uci','wrong_acw','wrong_li','wrong_party','wrong_tenant','wrong_actor','wrong_environment']))
  expect(new Set(c.source.watchIds).size).toBe(c.source.watchIds.length)
  for(const r of [...c.positive,...c.refusals.map(r=>r.response)]){
   expect(digest(r.raw)).toBe(r.hash)
   const wire=EdifactEnvelopeCodec.decode(r.raw),unh=wire.segments.filter(x=>x.tag==='UNH')
   expect(unh).toHaveLength(1)
   const messageReference=segmentComposite(unh[0],1,wire.una)[0]
   if(!wire.interchangeReference||!messageReference)throw new Error('Z13_G1_INPUTHOLD: physical incoming UNB/UNH identity absent')
   const identity=JSON.stringify(canonicalIdentity(r))
   for(const [seen,key] of [[hashes,r.hash],[interchanges,wire.interchangeReference],[messages,messageReference],[identities,identity]] as const){
    if(seen.has(key))throw new Error('Z13_G1_INPUTHOLD: physical control input duplicates another V/VH incoming identity or raw hash')
    seen.add(key)
   }
  }
 }
 return parsed
}
function canonicalIdentity(r:Response){
 const parsed=parseEdifactPayload(r.raw)
 return buildInboundCanonicalIdentity({companyId:r.companyId,environment:'test',senderEdielId:parsed.senderEdielId,
  receiverEdielId:parsed.receiverEdielId,applicationReference:parsed.applicationReference,
  interchangeReference:parsed.interchangeReference,transactionReference:parsed.transactionReference,externalReference:parsed.bgmReference})
}
async function requireFreshInputs(selected:z.infer<typeof packet>){
 // The exact existing production duplicate reader checks retained canonical
 // originals BEFORE any mailbox fixture writes. Replay later uses stored IDs.
 for(const c of selected.cohorts)for(const r of [...c.positive,...c.refusals.map(x=>x.response)]){
  if(await findInboundDuplicateByCanonicalIdentity(canonicalIdentity(r)))throw new Error('Z13_G1_INPUTHOLD: physical selected incoming already occupies canonical identity; fresh cohort or separate stored-ID replay required')
 }
}
async function original(s:Selection,oracle:Oracle){
 const m=await getEdielMessageById(s.originalMessageId)
 if(!m?.raw_payload||!m.message_sent_at)throw new Error('Z13_G1_INPUTHOLD: retained saved/sent original bytes and real send time required')
 expect(m).toMatchObject({id:s.originalMessageId,company_id:s.companyId,environment:'test',customer_id:s.customerId,
 direction:'outbound',message_family:'PRODAT',message_code:'Z13',intent_id:s.intentId})
 expect(digest(m.raw_payload)).toBe(s.originalHash)
 const b=await oracle.ordinaryBinding(s)
 expect(b).toMatchObject({messageId:m.id,rawHash:s.originalHash,intentId:s.intentId,transportAttemptId:s.transportAttemptId})
 expect(b.basis).toMatchObject({status:'authorized',code:'Z13',companyId:s.companyId,environment:'test',
 assignmentId:s.assignmentId,permissionId:s.permissionId,customerId:s.customerId,mode:s.mode,
 scopeBasisVersion:s.scopeBasisVersion,assignmentVersion:s.assignmentVersion,permissionStateVersion:0})
 assertCapturedServiceRequestTiming(b.basis)
 expect(b.requestDay).toBe(b.basis.requestTiming?.requestDay)
 if(!Array.isArray(b.watchIds))throw new Error('Z13_G1_INPUTHOLD: ordinary watch binding read incomplete')
 expect([...b.watchIds].sort()).toEqual([...s.watchIds].sort())
 const transport=await readAcceptedEdielTransportProjection({companyId:s.companyId,environment:'test',actorUserId:s.actorUserId,messageId:m.id})
 if(!transport)throw new Error('Z13_G1_INPUTHOLD: existing immutable accepted transport projection absent')
 expect(transport).toMatchObject({attemptId:s.transportAttemptId,originalHash:s.originalHash,authorizesProviderEntry:false,deliveryProven:false})
 if(transport.businessExpectationPlan===null)expect(b.watchIds).toEqual([])
 else if(!b.watchIds.length)throw new Error('Z13_G1_INPUTHOLD: retained business expectation plan lacks its actual binding')
 const wire=EdifactEnvelopeCodec.decode(m.raw_payload)
 expect(wire.applicationReference).toBe('23-DGI-PRODAT')
 const composites=(tag:string)=>wire.segments.filter(x=>x.tag===tag).map(x=>segmentComposite(x,1,wire.una))
 expect(composites('BGM').some(x=>x[0]==='Z13')).toBe(true)
 expect(composites('LIN')).toEqual([['1']])
 expect(wire.segments.some(x=>x.tag==='CAV'&&segmentComposite(x,1,wire.una)[0]===(s.mode==='V'?'S17':'S18'))).toBe(true)
 const li=composites('RFF').filter(x=>x[0]==='LI')
 expect(li).toHaveLength(1);expect(li[0][1]).toBeTruthy();expect(li[0][1]).toBe(m.transaction_reference)
 const customer=resolveSwedishProdatCustomerIdentity(b.basis.customer)
 expect(customer.id).toBeTruthy()
 const ud=wire.segments.filter(x=>x.tag==='NAD'&&segmentComposite(x,1,wire.una)[0]==='UD')
 expect(ud).toHaveLength(1)
 expect(segmentComposite(ud[0],2,wire.una)).toEqual([customer.id,customer.qualifier,'260'])
 expect(b.basis.objects.every(o=>o.point===null)).toBe(true)
 return m
}
function invariant(e:Effects){
 // Waiting is an allowed protocol projection; market version/dates and all
 // rights, grants, supply, activation history and business watches are immutable.
 return {permissions:e.permissions,siteRights:e.siteRights,objectRights:e.objectRights,grants:e.grants,
 supply:e.supply,permissionEffects:e.permissionEffects,businessResponseWatches:e.businessResponseWatches,
 pending:{...e.pending,status:undefined}}
}
function pending(e:Effects,s:Selection){
 expect(e.pending).toMatchObject({permissionId:s.permissionId,marketStateVersion:0,hasPositiveZ14:false,
 approvedStartAt:null,approvedEndAt:null,hasGrantedObjectRights:false})
 expect(['z13_ready','z13_sent']).toContain(e.pending.status)
}
function receipts(s:Selection){
 return sql<unknown>(`SELECT jsonb_build_object('correlations',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY ack_message_id),'[]') FROM gridex_ack_authority.source_correlations c WHERE company_id=${literal(s.companyId)} AND source_message_id=${literal(s.originalMessageId)}),'receipts',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY ack_message_id),'[]') FROM gridex_ack_authority.applied_receipts r JOIN gridex_ack_authority.source_correlations c USING(ack_message_id) WHERE c.company_id=${literal(s.companyId)} AND c.source_message_id=${literal(s.originalMessageId)}))`)
}
function actorDenial(error:unknown):error is EdielExecutionFailure {
 return error instanceof EdielExecutionFailure&&error.disposition.kind==='security_quarantine'&&
  ['EDIEL_TENANT_ACTOR_FORBIDDEN','EDIEL_TENANT_PERMISSION_FORBIDDEN'].includes(error.disposition.code)
}
async function requireDeniedActor(r:Response){
 let denial:EdielExecutionFailure|undefined
 try {await assertEdielTenantActor({companyId:r.companyId,actorUserId:r.actorUserId,permission:'communication.write'})}
 catch(error){if(!actorDenial(error))throw error;denial=error}
 if(!denial)throw new Error('Z13_G1_INPUTHOLD: adverse actor actually authorized; distinct actor ID is not refusal evidence')
 return denial.disposition.code
}
async function intake(r:Response,m:EdielMessageRow,refusal=false){
 const mail=await seedOriginalMailboxNative(sql,literal,{companyId:r.companyId,environment:'test',raw:r.raw,smtpFrom:r.smtpFrom})
 const match=await matchOutboundRequestForInbound({companyId:r.companyId,parsed:mail.parsed,inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId})
 const guard=await verifyInboundAckTransportCorrelation({companyId:r.companyId,environment:'test',parsed:mail.parsed,outboundMatch:match})
 const outboundMatch=failClosedOutboundMatchForAck({outboundMatch:match,guard})
 let id:string|null
 try {id=await createInboundEdielMessage({companyId:r.companyId,actorUserId:r.actorUserId,environment:'test',
 inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId,parsed:mail.parsed,outboundMatch})}
 catch(error){
  if(!refusal||!actorDenial(error))throw error
  return {kind:'actor_denied' as const,denialCode:error.disposition.code,guard}
 }
 if(!id&&refusal&&!guard.ok)return {kind:'transport_refused' as const,guard}
 if(!id)throw new Error('Z13_G1_INPUTHOLD: actual canonical ACK birth refused')
 const incoming=await getEdielMessageById(id)
 if(!incoming?.raw_payload||!incoming.message_received_at)throw new Error('Z13_G1_INPUTHOLD: actual persisted incoming original missing')
 expect(incoming).toMatchObject({company_id:r.companyId,environment:'test',direction:'inbound',message_family:r.family,
 inbound_email_message_id:mail.inboundEmailMessageId,mailbox_message_id:mail.inboundEmailMessageId,raw_payload:r.raw})
 expect(digest(incoming.raw_payload)).toBe(r.hash)
 expect(Date.parse(incoming.message_received_at)).toBeGreaterThan(Date.parse(m.message_sent_at!))
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(incoming)
 expect(await recordReceivedSourceValidation({original:incoming,validated:incoming,resolvedCompanyId:r.companyId,decision})).toMatchObject({status:'recorded'})
 return {kind:'admitted' as const,incoming,decision,guard}
}
function physical(s:Selection,r:Response,m:EdielMessageRow,defect?:Cohort['refusals'][number]['defect']){
 if(defect==='wrong_uci')expect(r.family).toBe('CONTRL')
 if(defect==='wrong_acw'||defect==='wrong_li')expect(r.family).toBe('APERAK')
 const own=EdifactEnvelopeCodec.decode(m.raw_payload!),reply=EdifactEnvelopeCodec.decode(r.raw)
 const ref=(wire:typeof own,tag:string,qualifier:string)=>wire.segments.filter(x=>x.tag===tag)
  .map(x=>segmentComposite(x,1,wire.una)).find(x=>x[0]===qualifier)?.[1]
 const mirrored=reply.sender===own.receiver&&reply.receiver===own.sender&&
  reply.senderQualifier===own.receiverQualifier&&reply.receiverQualifier===own.senderQualifier&&
  reply.senderSubAddress===own.receiverSubAddress&&reply.receiverSubAddress===own.senderSubAddress
 if(defect==='wrong_party')expect(mirrored).toBe(false)
 else expect(mirrored).toBe(true)
 expect(reply.environment).toBe(defect==='wrong_environment'?'production':'test')
 if(defect==='wrong_tenant')expect(r.companyId).not.toBe(s.companyId)
 else expect(r.companyId).toBe(s.companyId)
 if(defect==='wrong_actor')expect(r.actorUserId).not.toBe(s.actorUserId)
 else expect(r.actorUserId).toBe(s.actorUserId)
 if(r.family==='CONTRL'){
  const uci=reply.segments.filter(x=>x.tag==='UCI')
  expect(uci).toHaveLength(1)
  const reference=segmentComposite(uci[0],1,reply.una)[0]
  if(defect==='wrong_uci')expect(reference).not.toBe(own.interchangeReference?.slice(0,14))
  else expect(reference).toBe(own.interchangeReference?.slice(0,14))
 }else{
  const document=own.segments.find(x=>x.tag==='BGM')
  expect(document).toBeTruthy()
  const acw=ref(reply,'RFF','ACW'),li=ref(reply,'RFF','LI')
  if(defect==='wrong_acw')expect(acw).not.toBe(segmentComposite(document!,2,own.una)[0])
  else expect(acw).toBe(segmentComposite(document!,2,own.una)[0])
  if(defect==='wrong_li')expect(li).not.toBe(ref(own,'RFF','LI'))
  else expect(li).toBe(ref(own,'RFF','LI'))
 }
}
async function unchanged(s:Selection,m:EdielMessageRow,oracle:Oracle,before:Effects,incomingIds:string[]=[]){
 expect(invariant(await oracle.effects(s,incomingIds))).toEqual(invariant(before))
 const current=await getEdielMessageById(m.id)
 expect(current).toMatchObject({id:m.id,company_id:s.companyId,customer_id:s.customerId,raw_payload:m.raw_payload,
 intent_id:m.intent_id,message_sent_at:m.message_sent_at})
 expect(digest(current!.raw_payload!)).toBe(s.originalHash)
}
async function witness(c:Cohort,oracle:Oracle){
 const s=c.source,m=await original(s,oracle),before=await oracle.effects(s)
 const observedIds:string[]=[]
 pending(before,s)
 expect(receipts(s)).toEqual({correlations:[],receipts:[]})
 // Refusals precede the positive pair so no accepted source masks a refusal.
 for(const control of c.refusals){
  physical(s,control.response,m,control.defect)
  const stable=receipts(s)
  const actorReason=control.defect==='wrong_actor'?await requireDeniedActor(control.response):null
  const admitted=await intake(control.response,m,true)
  if(actorReason){expect(admitted.kind).toBe('actor_denied');if(admitted.kind==='actor_denied')expect(admitted.denialCode).toBe(actorReason)}
  if(admitted.kind==='admitted'){
   observedIds.push(admitted.incoming.id)
   const result=await processInboundAckMessage({actorUserId:control.response.actorUserId,message:admitted.incoming})
   expect(result).toMatchObject({sourceAccepted:false,finalAckReached:false})
   const receipt=await readCommittedInboundAck({actorUserId:control.response.actorUserId,message:admitted.incoming})
   // Existing negative/legacy diagnostics may be legitimate. A positive
   // committed receipt for any selected or accidentally matched source is not.
   if(receipt?.kind==='exact_receipt'){
    expect(receipt.result.outcome).not.toBe('positive');expect(receipt.result.sourceAccepted).toBe(false)
   }else if(receipt?.kind==='legacy_diagnostic')expect(receipt.outcome).not.toBe('positive')
  }else if(admitted.kind==='transport_refused'){
   expect(admitted.guard.ok).toBe(false);expect(admitted.guard.reason).toBeTruthy()
  }else if(!actorReason){
   // Wrong tenant can also have a genuinely denied membership. Other controls
   // need an admitted actor so they actually probe their declared physical defect.
   expect(control.defect).toBe('wrong_tenant')
  }
  expect(receipts(s)).toEqual(stable);await unchanged(s,m,oracle,before,observedIds)
  expect((await oracle.effects(s,observedIds)).pending.status).toBe(before.pending.status)
 }

 const acks:EdielMessageRow[]=[]
 for(const [index,r] of c.positive.entries()){
  physical(s,r,m)
  const admitted=await intake(r,m)
  if(admitted.kind!=='admitted')throw new Error('Z13_G1_INPUTHOLD: positive canonical birth not admitted')
  const {incoming,decision,guard}=admitted
  observedIds.push(incoming.id)
  expect(guard).toMatchObject({ok:true,outboundMessageId:m.id})
  expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision]).toEqual(['accepted','accepted','accepted'])
  const result=await processInboundAckMessage({actorUserId:s.actorUserId,message:incoming})
  expect(result).toMatchObject({outcome:'positive',sourceMessage:{id:m.id},sourceAccepted:index===1,finalAckReached:index===1})
  const committed=await readCommittedInboundAck({actorUserId:s.actorUserId,message:incoming})
  expect(committed).toMatchObject({kind:'exact_receipt',sourceMessageId:m.id,result:{outcome:'positive',sourceAccepted:index===1,
   finalAckReached:index===1,sourceMessage:{id:m.id,company_id:s.companyId,environment:'test',customer_id:s.customerId,raw_payload:m.raw_payload}}})
  expect(sql<number>(`SELECT to_jsonb(count(*)) FROM gridex_ack_authority.source_correlations WHERE ack_message_id=${literal(incoming.id)} AND source_message_id=${literal(m.id)} AND ack_payload_hash=${literal(r.hash)} AND source_payload_hash=${literal(s.originalHash)} AND company_id=${literal(s.companyId)} AND environment='test' AND actor_user_id=${literal(s.actorUserId)}`)).toBe(1)
  await unchanged(s,m,oracle,before,observedIds)
  expect((await oracle.effects(s,observedIds)).pending.status).toBe(index===0?before.pending.status:'waiting_for_customer_approval')
  acks.push(incoming)
 }
 expect(sql<number>(`SELECT to_jsonb(count(*)) FROM gridex_ack_authority.applied_receipts r JOIN gridex_ack_authority.source_correlations c USING(ack_message_id) WHERE c.company_id=${literal(s.companyId)} AND c.source_message_id=${literal(m.id)}`)).toBe(2)
 expect((await oracle.effects(s,observedIds)).pending.status).toBe('waiting_for_customer_approval')
 const stable=receipts(s),accepted=await getEdielMessageById(m.id)
 for(const incoming of acks){
  expect(await processInboundAckMessage({actorUserId:s.actorUserId,message:incoming})).toMatchObject({outcome:'positive',sourceMessage:{id:m.id}})
  expect(await readCommittedInboundAck({actorUserId:s.actorUserId,message:incoming})).toMatchObject({kind:'exact_receipt',sourceMessageId:m.id})
  expect(receipts(s)).toEqual(stable);await unchanged(s,m,oracle,before,observedIds)
  expect((await oracle.effects(s,observedIds)).pending.status).toBe('waiting_for_customer_approval')
 }
 expect(await getEdielMessageById(m.id)).toMatchObject({status:accepted!.status,contrl_status:accepted!.contrl_status,aperak_status:accepted!.aperak_status,raw_payload:accepted!.raw_payload})
}
it('existing customer-bound identityless Z13 V/VH receive their own physical request ACK pair without early rights or supply, with refusal and stored-ID replay',async()=>{
 const selected=selectors(),oracle=ordinaryOracle()
 await requireFreshInputs(selected)
 for(const c of selected.cohorts)await witness(c,oracle)
},120000)
