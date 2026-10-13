// Conditional arrival-order SOURCE preparation, native A/B NOT_RUN, +0 credit.
// Existing sole producer supplies a temporary GRIDEX_Z04C_ARRIVAL_INPUTS JSON
// matching ArrivalInputs below, after qualifying its adopted code/installed SQL
// and actual source/backend/input epoch. JSON contains selectors/pins and declared
// external physical input only: no executable adapter or accepted authority.
// A's stored C must already have actual prospective public-mail/parser/source
// custody. Its later ready switch must have current genuine signed sources for
// actual prepare/send. B's exact own Z03 must ALREADY be actually sealed/SENT,
// with no own period/Z04L, plus a nonempty same-tenant unrelated sibling.
// Current GoTrue/tenant/source/native reads establish authority; missing inputs
// FAIL precisely. No all-in-one protected seed, private C1 grid setup, status,
// original/declaration/issuer/grant/history write, future LI forecast or clock
// override. A proves NONmatching later origination, never stronger exact-future
// matching. Root retains current native/GEN/CI/original/normal-merge custody.
import {createHash,randomUUID} from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'
import {z} from 'zod'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {validateEdifactEnvelope} from '@/lib/ediel/core/edifactValidation'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {prodatCharacteristicValues} from '@/lib/ediel/prodat/prodatCharacteristicFields'
import {buildCancellationProspectiveZ04,type CancellationProspectiveContext} from './helpers/ediel-cancellation-prospective-source-2ea'
import type {EdielMessageRow} from '@/lib/ediel/types'

// PURE ARRIVAL HELPERS: the finite controller extracts these exact declarations
// and pure imports only. It never loads the native imports/callbacks below.
const uuid=z.string().uuid(),sha=z.string().regex(/^[0-9a-f]{64}$/)
const actor=z.object({id:uuid,email:z.string().email().endsWith('@example.invalid'),password:z.string().min(1)}).strict()
const originalPin=z.object({sourceId:uuid,switchId:uuid,payloadHash:sha}).strict()
const guard=z.discriminatedUnion('stage',[
 z.object({stage:z.literal('native_original'),code:z.literal('z04c_exact_original_unavailable')}).strict(),
 z.object({stage:z.literal('canonical_field'),code:z.string().regex(/^PRODAT_[A-Z0-9_]+$/),fieldNumber:z.string().regex(/^\d{3}$/)}).strict(),
])
export const arrivalInputSchema=z.object({
 schema:z.literal('ediel_z04c_arrival_inputs_v1'),apiUrl:z.literal('http://127.0.0.1:54321'),
 sourceBaseHead:z.literal('d798eb36f35cd4f437d44c8d234b4dbb81adc7a6'),sourceBaseTree:z.literal('e3b6c11677a2b871a128504f1616def7d22dba1e'),
 executedSourceHead:z.string().regex(/^[a-f0-9]{40}$/),executedSourceTree:z.string().regex(/^[a-f0-9]{40}$/),inputEpoch:z.string().datetime({offset:true}),
 backend:z.object({engineSchemaVersion:z.string().min(1),migrationVersion:z.string().min(1),functionDefinitionsSha256:sha}).strict(),
 A:z.object({companyId:uuid,actor,storedC:z.object({sourceId:uuid,payloadHash:sha,mailId:uuid,parseId:uuid,receivedAt:z.string().datetime({offset:true}),contextSha256:sha}).strict(),laterSwitchId:uuid,laterRouteId:uuid,expectedGuard:guard}).strict(),
 B:z.object({companyId:uuid,actor,original:originalPin,sibling:originalPin,
  physical:z.object({installationStatus:z.literal('Z12'),settlementMethod:z.literal('Z31'),register:z.literal('101')}).strict(),
 }).strict(),
}).strict().superRefine((value,context)=>{
 if(value.B.original.sourceId===value.B.sibling.sourceId||value.B.original.switchId===value.B.sibling.switchId)context.addIssue({code:'custom',message:'nonempty_distinct_sibling_required'})
 if(value.A.storedC.sourceId===value.B.original.sourceId)context.addIssue({code:'custom',message:'distinct_arrival_sources_required'})
})
export type ArrivalInputs=z.infer<typeof arrivalInputSchema>
type Guard=z.infer<typeof guard>
type Row=Record<string,unknown>
export function requireArrival(value:unknown,reason:string):asserts value{if(!value)throw Error(`z04c_arrival:${reason}`)}
export const arrivalHash=(value:string)=>createHash('sha256').update(value,'utf8').digest('hex')
export function assertArrivalOrder(earlier:string|null|undefined,later:string|null|undefined){
 requireArrival(typeof earlier==='string'&&typeof later==='string'&&Number.isFinite(Date.parse(earlier))&&Number.isFinite(Date.parse(later))&&Date.parse(earlier)<Date.parse(later),'actual_strict_source_receive_order_required')
}
export function assertUnchangedArrival(before:unknown,after:unknown,scope:string){requireArrival(isDeepStrictEqual(before,after),`immutable_${scope}_changed`)}
/** The actual adapter sends envelope/raw, never a top-level recipient. These
 * declared external SMTP inputs convey no original/source/backend authority. */
export function declaredArrivalSmtp(options:unknown,declared:{from:string;to:string}){
 requireArrival(options&&typeof options==='object','declared_SMTP_options_required')
 const sent=options as Row,envelope=sent.envelope as Row|undefined
 const disposable=z.string().email().endsWith('@example.invalid')
 requireArrival(disposable.safeParse(declared.from).success&&disposable.safeParse(declared.to).success,'declared_disposable_SMTP_scope_required')
 requireArrival(envelope&&envelope.from===declared.from&&Array.isArray(envelope.to)&&envelope.to.length===1&&envelope.to[0]===declared.to,'actual_declared_SMTP_envelope_required')
 requireArrival(Buffer.isBuffer(sent.raw)&&sent.raw.length>0,'actual_SMTP_raw_Buffer_required')
 return{accepted:[envelope.to[0]],rejected:[],messageId:'synthetic-arrival-'+randomUUID(),response:'250 explicitly synthetic accepted'}
}
export function assertArrivalCustodyReplay(before:Record<string,unknown>&{receptions:Row[]},after:Record<string,unknown>&{receptions:Row[]},actorId:string){
 const old=before.receptions,next=after.receptions,first=old.filter(row=>row.classification==='first_reception')
 requireArrival(first.length===1&&next.filter(row=>row.classification==='first_reception').length===1&&new Set(next.map(row=>row.id)).size===next.length,'replay_exact_first_reception_required')
 const without=(value:Record<string,unknown>)=>Object.fromEntries(Object.entries(value).filter(([key])=>key!=='receptions'))
 assertUnchangedArrival(without(before),without(after),'source_mail_parse_context')
 for(const row of old){const preserved=next.filter(candidate=>candidate.id===row.id);requireArrival(preserved.length===1&&isDeepStrictEqual(row,preserved[0]),'replay_preexisting_reception_changed')}
 for(const row of next.filter(candidate=>!old.some(previous=>previous.id===candidate.id))){
  requireArrival(uuid.safeParse(row.id).success&&row.classification==='protocol_duplicate'&&row.actor_user_id===actorId,'replay_only_current_actor_protocol_duplicate_allowed')
  for(const key of ['company_id','source_message_id','environment','inbound_email_message_id','parse_result_id','canonical_payload_hash','received_payload_hash','received_at','scope','transport_source_snapshot'])requireArrival(isDeepStrictEqual(row[key],first[0][key]),`replay_duplicate_${key}_mismatch`)
  requireArrival(typeof row.recorded_at==='string'&&Date.parse(row.recorded_at)>=Date.parse(String(first[0].recorded_at)),'replay_duplicate_recorded_clock_required')
 }
}
export function assertOwnArrivalCancellation(before:Row,after:Row,sourceId:string,receivedAt:string){
 // Exact D798 cancel_start UPDATE004331:338–339 explicitly sets these four
 // columns. Relevant current switch triggers add no broader writable fields.
 const allowed=new Set(['status','inbound_z04_message_id','completed_at','updated_at'])
 const retained=(row:Row)=>Object.fromEntries(Object.entries(row).filter(([key])=>!allowed.has(key)))
 assertUnchangedArrival(retained(before),retained(after),'own_switch_unrelated_fields')
 requireArrival(after.status==='cancelled_before_start'&&after.inbound_z04_message_id===sourceId&&typeof after.completed_at==='string'&&typeof after.updated_at==='string'&&Date.parse(after.completed_at)>=Date.parse(receivedAt)&&after.updated_at===after.completed_at,'own_switch_exact_native_cancel_update_required')
}
export function arrivalWireScope(raw:string,code:'Z03'|'Z04',reason:'Z22'|'Z24'){
 requireArrival(validateEdifactEnvelope(raw).ok,'physical_envelope_required')
 const wire=tokenizeEdifact(raw),envelope=EdifactEnvelopeCodec.decode(raw),groups=prodatRegisterGroups(wire.segments,wire.una,code)
 requireArrival(groups.groups.length===1&&groups.problems.length===0,'own_single_register_scope_required')
 const own=groups.groups[0],by=(tag:string,qualifier:string)=>own.segments.filter(s=>s.tag===tag&&segmentComposite(s,1,wire.una)[0]===qualifier)
 const one=(tag:string,qualifier:string,element:number,component=0)=>{const values=by(tag,qualifier);requireArrival(values.length===1,`physical_${tag}_${qualifier}_required`);const value=segmentComposite(values[0],element,wire.una)[component];requireArrival(value,`physical_${tag}_${qualifier}_value_required`);return value}
 const bgm=wire.segments.filter(s=>s.tag==='BGM');requireArrival(bgm.length===1&&segmentComposite(bgm[0],1,wire.una)[0]===code,'physical_business_code_required')
 requireArrival(envelope.applicationReference==='23-DDQ-PRODAT'&&envelope.environment==='test','physical_DDQ_test_required')
 const characteristic=prodatCharacteristicValues('223',own.segments,wire.una)
 requireArrival(characteristic.length===1&&characteristic[0]===reason,'physical_own_reason_required')
 const legal=(qualifier:string)=>{const rows=wire.segments.filter(s=>s.tag==='NAD'&&segmentComposite(s,1,wire.una)[0]===qualifier);requireArrival(rows.length===1&&rows[0].index<own.segments[0].index,`physical_header_${qualifier}_required`);return segmentComposite(rows[0],2,wire.una)[0]}
 const sender=legal('FR'),receiver=legal('DO'),identity=by('NAD','UD')
 requireArrival(identity.length===1,'physical_end_user_required')
 const customer=segmentComposite(identity[0],2,wire.una)
 requireArrival(customer.length===3&&customer[1]==='SE2'&&customer[2]==='260','declared_SE2_customer_identity_required')
 requireArrival(envelope.sender===sender&&envelope.receiver===receiver&&own.identityAgency==='9'&&/^\d{18}$/.test(own.itemId??''),'physical_legal_transport_point_agency_required')
 return{point:own.itemId!,agency:own.identityAgency!,li:one('RFF','LI',1,1),start:one('DTM','92',1,1),customer:customer[0],sender,receiver,grid:one('RFF','Z05',1,1),brp:one('NAD','Z02',2),lineIndex:own.segments[0].index,interchange:envelope.interchangeReference!,document:segmentComposite(bgm[0],2,wire.una)[0]}
}
export function prospectiveArrivalC(context:CancellationProspectiveContext){
 const input=buildCancellationProspectiveZ04(context),wire=tokenizeEdifact(input),groups=prodatRegisterGroups(wire.segments,wire.una,'Z04')
 requireArrival(groups.groups.length===1&&groups.problems.length===0,'prospective_C_single_own_scope_required')
 const own=groups.groups[0],positions=own.segments.filter(s=>s.tag==='CCI'&&segmentComposite(s,2,wire.una)[0]==='Z13')
 requireArrival(positions.length===1,'prospective_C_own_223_required')
 const reason=wire.segments[positions[0].index+1]
 requireArrival(reason?.tag==='CAV'&&segmentComposite(reason,1,wire.una).length===1&&segmentComposite(reason,1,wire.una)[0]==='Z22','prospective_C_own_Z22_required')
 const e=EdifactEnvelopeCodec.decode(input),body=wire.segments.filter(s=>!['UNB','UNH','UNT','UNZ'].includes(s.tag)).map(s=>s.index===reason.index?'CAV+Z24':s.raw)
 const raw=EdifactEnvelopeCodec.encode({sender:e.sender!,receiver:e.receiver!,senderQualifier:e.senderQualifier,receiverQualifier:e.receiverQualifier,applicationReference:e.applicationReference,environment:'test',acknowledgementRequest:true,interchangeReference:randomUUID().replaceAll('-','').slice(0,14),messages:[{messageReference:randomUUID().replaceAll('-','').slice(0,14),messageTypeToken:wire.segments.find(s=>s.tag==='UNH')!.elements[2],businessSegments:body}]})
 const physical=arrivalWireScope(raw,'Z04','Z24')
 requireArrival(physical.point===context.external&&physical.li===context.caseReference,'prospective_C_actual_scope_preserved')
 return raw
}
export type GuardObservation={assessmentId:string;sourceId:string;payloadHash:string;factsHash:string;factsText:string;canonical:{syntaxDecision:string;applicationDecision:string;functionalDecision:string;reasonCodes:string[];rulePackEvidence:unknown};nativePartition:{disposition:string;reason?:string}[]|null;diagnostics:{code:string;fieldNumber:string|null}[]}
/** Data discriminator only. Native callers supply actual observed invocation /
 * immutable assessment/event bookends. A modeled record supplies no authority. */
export function assertDecisiveArrivalGuard(observed:GuardObservation,expected:Guard,source:{id:string;hash:string}){
 requireArrival(observed.sourceId===source.id&&observed.payloadHash===source.hash&&uuid.safeParse(observed.assessmentId).success&&arrivalHash(observed.factsText)===observed.factsHash,'guard_exact_source_assessment_required')
 const full=JSON.parse(observed.factsText) as Row
 const facts={syntaxDecision:full.syntaxDecision,applicationDecision:full.applicationDecision,functionalDecision:full.functionalDecision,reasonCodes:full.reasonCodes,rulePackEvidence:full.rulePackEvidence} as GuardObservation['canonical']
 requireArrival(isDeepStrictEqual(facts,observed.canonical)&&facts.syntaxDecision==='accepted'&&facts.rulePackEvidence,'guard_actual_qualified_canonical_required')
 if(expected.stage==='native_original'){
  requireArrival(facts.applicationDecision==='accepted'&&facts.functionalDecision==='accepted'&&observed.nativePartition?.length===1&&observed.nativePartition[0].disposition==='held'&&observed.nativePartition[0].reason===expected.code,'guard_actual_native_original_partition_required')
  return{stage:expected.stage,code:expected.code,assessmentId:observed.assessmentId,nativeOriginalBranch:true}
 }
 requireArrival(observed.nativePartition===null&&['rejected','manual_review'].includes(facts.applicationDecision)&&facts.reasonCodes.includes(expected.code)&&observed.diagnostics.some(d=>d.code===expected.code&&d.fieldNumber===expected.fieldNumber),'guard_actual_own_field_diagnostic_required')
 return{stage:expected.stage,code:expected.code,fieldNumber:expected.fieldNumber,assessmentId:observed.assessmentId,nativeOriginalBranch:false}
}
export function assertCommittedArrivalCancellation(rows:{effects:Row[];partitions:Row[];transitions:Row[];normal:Row[]},own:{sourceId:string;hash:string;assessmentId:string;switchId:string;originalId:string;companyId:string;scope:ReturnType<typeof arrivalWireScope>}){
 requireArrival(rows.effects.length===1&&rows.partitions.length===1&&rows.transitions.length===1&&rows.normal.length===0,'committed_C_exact_receipt_cardinality_required')
 const effect=rows.effects[0],partition=rows.partitions[0],transition=rows.transitions[0]
 for(const row of [effect,partition,transition])requireArrival(row.source_message_id===own.sourceId&&row.company_id===own.companyId&&row.payload_hash===own.hash,'committed_C_same_source_hash_scope_required')
 requireArrival(effect.environment==='test'&&partition.environment==='test'&&effect.canonical_assessment_id===own.assessmentId&&partition.canonical_assessment_id===own.assessmentId&&effect.first_line_index===own.scope.lineIndex,'committed_C_assessment_LIN_required')
 requireArrival(typeof effect.effect_text==='string'&&arrivalHash(effect.effect_text)===effect.effect_hash&&typeof partition.partition_text==='string'&&arrivalHash(partition.partition_text)===partition.partition_hash,'committed_C_native_serialized_hash_required')
 const facts=JSON.parse(effect.effect_text) as Row,plan=facts.plan as Row,states=facts.resultingSwitches as Row[],wire=facts.wire as Row,result=partition.result as Row,scopes=JSON.parse(partition.partition_text) as Row[]
 requireArrival(facts.owner==='inbound-supply-object-v1'&&facts.sourceMessageId===own.sourceId&&facts.sourcePayloadHash===own.hash&&facts.companyId===own.companyId&&facts.environment==='test'&&facts.canonicalAssessmentId===own.assessmentId,'committed_C_effect_owner_required')
 requireArrival(plan&&Object.hasOwn(plan,'periodId')&&plan.periodId===null&&plan.kind==='cancel_start'&&plan.switchId===own.switchId,'committed_C_explicit_null_period_plan_required')
 requireArrival(wire.point===own.scope.point&&wire.identityAgency===own.scope.agency&&wire.li===own.scope.li&&wire.customerIdentity===own.scope.customer&&wire.start===own.scope.start&&wire.reason==='Z24','committed_C_physical_scope_required')
 requireArrival(Array.isArray(states)&&states.length===1&&states[0].id===own.switchId&&states[0].company_id===own.companyId&&states[0].status==='cancelled_before_start'&&states[0].outbound_z03_message_id===own.originalId&&states[0].inbound_z04_message_id===own.sourceId&&states[0].rff_li_reference===own.scope.li&&states[0].completed_at,'committed_C_own_resulting_switch_required')
 requireArrival(isDeepStrictEqual(facts.resultingStates,[])&&result.applied===true&&isDeepStrictEqual(result.periods,[])&&isDeepStrictEqual(result.commits,[])&&isDeepStrictEqual(result.switchIds,[own.switchId])&&isDeepStrictEqual(result.effectReceiptIds,[effect.id]),'committed_C_no_fabricated_period_result_required')
 requireArrival(scopes.length===1&&scopes[0].disposition==='applied'&&scopes[0].effectReceiptId===effect.id&&scopes[0].effectFactsHash===effect.effect_hash&&transition.source_code==='Z04'&&isDeepStrictEqual(transition.qualified_switch_ids,[own.switchId])&&isDeepStrictEqual(transition.resulting_states,[]),'committed_C_partition_transition_required')
 return facts
}
// END PURE ARRIVAL HELPERS. No native import below is part of finite loading.
import {readFileSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {createClient} from '@supabase/supabase-js'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
vi.mock('server-only',()=>({}))
const smtp=vi.hoisted(()=>({send:vi.fn(),recipient:null as string|null}))
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:smtp.send})}}))
import {nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {seedOriginalMailboxNative} from './helpers/originalMailboxNative'
import {getEdielMessageById} from '@/lib/ediel/db'
import {matchOutboundRequestForInbound,matchMeteringPointForInbound} from '@/lib/inbound-mail/inboundMatcher'
import {createInboundEdielMessage} from '@/lib/inbound-mail/inboundStatusUpdater'
import {parseEdifactPayload} from '@/lib/inbound-mail/edielEmailParser'
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import * as runtime from '@/lib/ediel/core/runtimeDecision'
import * as supply from '@/lib/ediel/flows/supplyMarketTransition'
import {prepareAndQueueEdielZ03} from '@/lib/ediel/flows/prodatSwitch'
import {sendEdielMessageViaSmtp} from '@/lib/ediel/transport'
import {readPhysicalAckSourceCorrelation} from '@/lib/ediel/ack/sourceCorrelation'
import {readReceivedProdatFinalResponsePlan} from '@/lib/ediel/core/receivedProdatFinalResponsePlan'

// Exact installed source-body identity read for the producer's manifest. It
// binds source applicability, not a new product/GEN/approval API criterion.
export const arrivalBackendIdentitySql=`SELECT jsonb_build_object('engineSchemaVersion',public.canonical_current_ediel_engine_schema_version(),'migrationVersion',(SELECT max(version) FROM supabase_migrations.schema_migrations),'functionDefinitionsSha256',(SELECT encode(sha256(convert_to(string_agg(n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')'||pg_get_functiondef(p.oid),E'\\n' ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),'UTF8')),'hex') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prokind='f' AND(n.nspname LIKE 'gridex_%' OR n.nspname='public' AND(p.proname LIKE 'ediel_%' OR p.proname LIKE 'gridex_%' OR p.proname='canonical_current_ediel_engine_schema_version'))))`
function input(){
 const path=process.env.GRIDEX_Z04C_ARRIVAL_INPUTS;requireArrival(path,'producer_qualified_manifest_required');const value=arrivalInputSchema.parse(JSON.parse(readFileSync(path,'utf8')))
 const executed=execFileSync('git',['rev-parse','HEAD','HEAD^{tree}'],{cwd:process.cwd(),encoding:'utf8',timeout:10000}).trim().split('\n')
 expect(executed).toEqual([value.executedSourceHead,value.executedSourceTree])
 expect(sql(arrivalBackendIdentitySql)).toEqual(value.backend);expect(sql('SELECT to_jsonb(opened_at) FROM gridex_received_sources.epoch WHERE singleton')).toBe(value.inputEpoch);return value
}
async function authenticated(companyId:string,user:ArrivalInputs['A']['actor']){
 const client=createClient('http://127.0.0.1:54321',process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false}})
 const signed=await client.auth.signInWithPassword({email:user.email,password:user.password});requireArrival(!signed.error&&signed.data.user?.id===user.id,'actual_GoTrue_actor_required')
 const current=await client.auth.getUser();requireArrival(!current.error&&current.data.user?.id===user.id,'current_GoTrue_actor_required')
 const tenant=await client.rpc('canonical_authenticated_tenant_context',{p_selected_company_id:companyId});requireArrival(!tenant.error&&tenant.data?.authorized===true&&tenant.data.selected_company_id===companyId,'current_authenticated_tenant_required')
 for(const permission of ['communication.read','communication.write','communication.send','metering.read','metering.write'])requireArrival(tenant.data.permissions?.includes(permission),`current_${permission}_required`)
 return client
}
beforeEach(()=>{
 for(const[key,value]of Object.entries({EDIEL_SHARED_MAILBOX_ADDRESS:'synthetic@example.invalid',EDIEL_APP_DKIM_ENABLED:'false',EMAIL_PROVIDER:'resend',EDIEL_EMAIL_PROVIDER:'strato',EDIEL_SMTP_HOST:'smtp.example.invalid',EDIEL_SMTP_PORT:'465',EDIEL_SMTP_SECURE:'true',EDIEL_SMTP_FROM:'synthetic@example.invalid',EDIEL_SMTP_REPLY_TO:'synthetic@example.invalid',EDIEL_SMTP_USER:'synthetic@example.invalid',EDIEL_SMTP_PASS:'synthetic-only'}))vi.stubEnv(key,value)
 smtp.recipient=null;smtp.send.mockReset();smtp.send.mockImplementation(async(options:unknown)=>{requireArrival(typeof smtp.recipient==='string','actual_own_declared_SMTP_recipient_required');return declaredArrivalSmtp(options,{from:'synthetic@example.invalid',to:smtp.recipient})})
})
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs()})
async function message(company:string,id:string){const result=await getEdielMessageById(id);requireArrival(result?.company_id===company&&result.environment==='test','actual_scoped_message_required');return result}
function switchRow(company:string,id:string){const row=sql<Row|null>(`SELECT to_jsonb(s) FROM public.supplier_switch_requests s WHERE company_id=${literal(company)} AND id=${literal(id)}`);requireArrival(row,'actual_switch_row_required');return row}
function business(company:string,exceptSwitch?:string){return sql(`SELECT jsonb_build_object(
 'customers',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.customers x WHERE company_id=${literal(company)}),
 'sites',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.customer_sites x WHERE company_id=${literal(company)}),
 'points',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.metering_points x WHERE company_id=${literal(company)}),
 'switches',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.supplier_switch_requests x WHERE company_id=${literal(company)} ${exceptSwitch?`AND id<>${literal(exceptSwitch)}`:''}),
 'periods',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.customer_supply_periods x WHERE company_id=${literal(company)}),
 'contracts',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.customer_contracts x WHERE company_id=${literal(company)}),
 'contractEvents',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.customer_contract_events x WHERE company_id=${literal(company)}),
 'permissions',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.metering_permissions x WHERE company_id=${literal(company)}),
 'permissionSites',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.metering_permission_sites x WHERE company_id=${literal(company)}),
 'invoices',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.customer_invoices x WHERE company_id=${literal(company)}),
 'underlays',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.billing_underlays x WHERE company_id=${literal(company)}),
 'items',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]') FROM public.billing_underlay_items x JOIN public.billing_underlays u ON u.id=x.billing_underlay_id AND u.company_id=x.company_id WHERE x.company_id=${literal(company)}),
 'normalConfirmations',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY period_id),'[]') FROM gridex_received_sources.normal_switch_confirmations x WHERE company_id=${literal(company)}),
 'normalActivations',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY period_id),'[]') FROM gridex_received_sources.normal_supply_activations x WHERE company_id=${literal(company)}))`)}
function effects(company:string,id:string){return sql<{transitions:Row[];partitions:Row[];effects:Row[];normal:Row[]}>(`SELECT jsonb_build_object(
 'transitions',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM gridex_received_sources.supply_source_transitions x WHERE company_id=${literal(company)} AND source_message_id=${literal(id)}),
 'partitions',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM gridex_received_sources.supply_object_partitions x WHERE company_id=${literal(company)} AND source_message_id=${literal(id)}),
 'effects',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM gridex_received_sources.supply_object_effect_receipts x WHERE company_id=${literal(company)} AND source_message_id=${literal(id)}),
 'normal',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM gridex_received_sources.normal_switch_confirmations x WHERE company_id=${literal(company)} AND source_message_id=${literal(id)}))`)}
function noEffect(company:string,id:string){expect(effects(company,id)).toEqual({transitions:[],partitions:[],effects:[],normal:[]})}
function noOwnPeriod(company:string,sw:Row){expect(sql(`SELECT to_jsonb(count(*)) FROM public.customer_supply_periods WHERE company_id=${literal(company)} AND(source_switch_request_id=${literal(sw.id)} OR metering_point_id=${literal(sw.metering_point_id)})`)).toBe(0)}
function custody(company:string,id:string){return sql<{source:Row;mail:Row;parse:Row;captured:Row;context:Row;receptions:Row[];rawBirth:Row;parseBirth:Row}>(`SELECT jsonb_build_object(
 'source',jsonb_build_object('id',m.id,'company_id',m.company_id,'environment',m.environment,'direction',m.direction,'raw_payload',m.raw_payload,'immutable_payload_hash',m.immutable_payload_hash,'message_received_at',m.message_received_at,'immutable_rendered_at',m.immutable_rendered_at,'execution_context_snapshot',m.execution_context_snapshot,'rule_profile_key',m.rule_profile_key,'canonical_rule_pack_id',m.canonical_rule_pack_id,'rule_pack_checksum',m.rule_pack_checksum,'rule_profile_version_id',m.rule_profile_version_id,'related_message_id',m.related_message_id,'outbound_request_id',m.outbound_request_id),
 'mail',(SELECT to_jsonb(x) FROM public.inbound_email_messages x WHERE id=m.inbound_email_message_id),
 'parse',(SELECT to_jsonb(x) FROM public.inbound_ediel_parse_results x WHERE id=(SELECT parse_result_id FROM gridex_ediel_inbound_receptions.receptions WHERE source_message_id=m.id AND classification='first_reception')),
 'captured',(SELECT to_jsonb(x) FROM gridex_received_sources.sources x WHERE source_message_id=m.id AND company_id=m.company_id),
 'context',(SELECT to_jsonb(x) FROM gridex_ediel_inbound_context.receipts x WHERE source_message_id=m.id AND company_id=m.company_id),
 'receptions',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM gridex_ediel_inbound_receptions.receptions x WHERE source_message_id=m.id AND company_id=m.company_id),
 'rawBirth',(SELECT to_jsonb(x) FROM gridex_unattributed_intake.raw_births x WHERE inbound_email_message_id=m.inbound_email_message_id),
 'parseBirth',(SELECT to_jsonb(x) FROM gridex_unattributed_intake.parse_births x WHERE parse_result_id=(SELECT parse_result_id FROM gridex_ediel_inbound_receptions.receptions WHERE source_message_id=m.id AND classification='first_reception'))) FROM public.ediel_messages m WHERE m.id=${literal(id)} AND m.company_id=${literal(company)}`)}
function assertCustody(stored:ReturnType<typeof custody>,m:EdielMessageRow){
 requireArrival(stored.source&&stored.mail&&stored.parse&&stored.captured&&stored.context&&stored.rawBirth&&stored.parseBirth,'actual_prospective_mail_parse_source_context_birth_required')
 expect(stored.receptions).toHaveLength(1)
 expect(stored.captured).toMatchObject({source_message_id:m.id,company_id:m.company_id,environment:'test',payload_hash:arrivalHash(m.raw_payload!),raw_payload:m.raw_payload})
 expect(stored.receptions[0]).toMatchObject({source_message_id:m.id,company_id:m.company_id,environment:'test',classification:'first_reception',canonical_payload_hash:arrivalHash(m.raw_payload!),received_payload_hash:arrivalHash(m.raw_payload!)})
 expect(stored.mail).toMatchObject({id:m.inbound_email_message_id,company_id:m.company_id,environment:'test',raw_edifact_payload:m.raw_payload})
 expect(stored.parse).toMatchObject({id:stored.receptions[0].parse_result_id,inbound_email_message_id:m.inbound_email_message_id,company_id:m.company_id,raw_payload:m.raw_payload,parse_status:'parsed'})
 for(const value of [m.message_received_at,stored.captured.source_received_at,stored.context.source_received_at,stored.receptions[0].received_at])expect(Date.parse(String(value))).toBe(Date.parse(String(stored.mail.received_at)))
}
function originalBookend(company:string,id:string){return sql<{source:Row;original:Row;acceptedBasis:Row;payloads:Row[];attempts:Row[];sealedAttempts:Row[];sealedEvents:Row[]}>(`SELECT jsonb_build_object('source',jsonb_build_object('id',m.id,'company',m.company_id,'environment',m.environment,'direction',m.direction,'family',m.message_family,'code',m.message_code,'raw',m.raw_payload,'hash',m.immutable_payload_hash,'rendered',m.immutable_rendered_at,'sent',m.message_sent_at,'intent',m.intent_id,'request',m.outbound_request_id,'context',m.execution_context_snapshot),
 'original',(SELECT to_jsonb(x) FROM gridex_received_sources.switch_originals x WHERE message_id=m.id AND company_id=m.company_id),
 'acceptedBasis',gridex_ediel_transport.accepted_source_basis_v1(m),
 'payloads',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.ediel_message_payloads x WHERE ediel_message_id=m.id),
 'attempts',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM gridex_ediel_transport.attempts x WHERE message_id=m.id AND company_id=m.company_id AND environment=m.environment),
 'sealedAttempts',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM gridex_outbound_dispatch.attempts x WHERE message_id=m.id AND company_id=m.company_id AND environment=m.environment),
 'sealedEvents',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM gridex_outbound_dispatch.events x WHERE message_id=m.id AND company_id=m.company_id AND environment=m.environment)) FROM public.ediel_messages m WHERE id=${literal(id)} AND company_id=${literal(company)}`)}
async function qualifiedSent(company:string,pin:ArrivalInputs['B']['original']){
 const m=await message(company,pin.sourceId),sw=switchRow(company,pin.switchId)
 expect(m).toMatchObject({direction:'outbound',message_family:'PRODAT',message_code:'Z03',immutable_payload_hash:pin.payloadHash});expect(arrivalHash(m.raw_payload!)).toBe(pin.payloadHash)
 expect(sw).toMatchObject({outbound_z03_message_id:m.id,customer_id:m.customer_id,metering_point_id:m.metering_point_id})
 const physical=arrivalWireScope(m.raw_payload!,'Z03','Z22')
 expect(sw.rff_li_reference).toBe(physical.li);expect(sw.requested_start_date).toBe(`${physical.start.slice(0,4)}-${physical.start.slice(4,6)}-${physical.start.slice(6,8)}`)
 expect(sql(`SELECT to_jsonb(gridex_received_sources.sent_source_is_current_v1(m)) FROM public.ediel_messages m WHERE company_id=${literal(company)} AND id=${literal(m.id)}`)).toBe(true)
 const preserved=originalBookend(company,m.id)
 requireArrival(m.message_sent_at&&preserved.source.rendered,'actual_sealed_sent_original_required')
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.switch_originals WHERE company_id=${literal(company)} AND message_id=${literal(m.id)}`)).toBe(1)
 // The existing accepted-source READ checks actual provider entry/result and
 // exact original bytes in either supported journal; it never grants a send.
 expect(preserved.acceptedBasis).toMatchObject({status:'accepted_projection',companyId:company,environment:'test',messageId:m.id,originalHash:pin.payloadHash,authorizesProviderEntry:false,deliveryProven:false})
 requireArrival(uuid.safeParse(preserved.acceptedBasis.attemptId).success&&['generic_journal','sealed_z08'].includes(String(preserved.acceptedBasis.lane)),'actual_unique_accepted_transport_attempt_required')
 expect(Date.parse(String(preserved.acceptedBasis.observedAt))).toBe(Date.parse(m.message_sent_at!))
 return{m,sw,physical}
}
async function receive(company:string,user:string,raw:string){
 const mail=await seedOriginalMailboxNative(<T>(statement:string)=>sql<T>(`BEGIN; SET LOCAL ROLE service_role; ${statement} COMMIT;`),literal,{companyId:company,environment:'test',raw,smtpFrom:'synthetic@example.invalid'})
 const outboundMatch=await matchOutboundRequestForInbound({companyId:company,parsed:mail.parsed,inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId}),meteringPointMatch=await matchMeteringPointForInbound({companyId:company,parsed:mail.parsed,inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId})
 const id=await createInboundEdielMessage({companyId:company,actorUserId:user,environment:'test',inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId,parsed:mail.parsed,outboundMatch,meteringPointMatch})
 requireArrival(id,'actual_public_intake_required');const m=await message(company,id);expect(m.raw_payload).toBe(raw);assertCustody(custody(company,id),m);return m
}
async function observedProcess(company:string,user:string,m:EdielMessageRow){
 // Call-through observation only: implementations and opaque results remain
 // real. Neither spy overrides a return, mutates source or calls an apply port.
 const canonical=vi.spyOn(runtime,'resolveCanonicalRuntimeDecisionWithRegistry'),apply=vi.spyOn(supply,'applySupplyMarketSource')
 try{
  await processInboundEdielMessage({actorUserId:user,edielMessageId:m.id})
  const calls=canonical.mock.calls.flatMap((args,index)=>args[0].id===m.id&&args[0].raw_payload===m.raw_payload?[canonical.mock.results[index]]:[])
  requireArrival(calls.length&&calls.every(result=>result.type==='return'),'actual_own_canonical_invocation_required')
  const decision=await calls[calls.length-1].value as runtime.CanonicalRuntimeDecision
  const ownApply=apply.mock.calls.flatMap((args,index)=>args[0].message.id===m.id?[apply.mock.results[index]]:[])
  requireArrival(ownApply.length<=1&&ownApply.every(result=>result.type==='return'),'actual_single_native_supply_invocation_required')
  const result=ownApply.length?await ownApply[0].value as supply.SupplyMarketResult:null
  const stored=sql<{assessments:Row[];events:Row[]}>(`SELECT jsonb_build_object('assessments',(SELECT coalesce(jsonb_agg(to_jsonb(v)),'[]') FROM gridex_received_sources.validation_assessments v WHERE v.company_id=${literal(company)} AND v.source_message_id=${literal(m.id)} AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id)),'events',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.created_at,e.id),'[]') FROM public.ediel_message_events e WHERE e.company_id=${literal(company)} AND e.ediel_message_id=${literal(m.id)} AND e.event_type='validated' AND e.payload ? 'sourceObjectPartition'))`)
  expect(stored.assessments).toHaveLength(1);const assessment=stored.assessments[0]
  expect(assessment).toMatchObject({company_id:company,environment:'test',source_message_id:m.id,source_payload_hash:arrivalHash(m.raw_payload!)})
  requireArrival(typeof assessment.facts_text==='string'&&arrivalHash(assessment.facts_text)===assessment.facts_hash,'actual_canonical_facts_hash_required')
  const fullFacts=JSON.parse(assessment.facts_text) as Row
  expect(fullFacts).toMatchObject({owner:'canonical-runtime-with-registry-v1',syntaxDecision:decision.syntaxDecision,applicationDecision:decision.applicationDecision,functionalDecision:decision.functionalDecision})
  expect(fullFacts.reasonCodes).toEqual([...new Set(decision.issues.map(issue=>issue.code))])
  requireArrival(fullFacts.rulePackEvidence,'actual_rule_pack_witness_required')
  if(result){requireArrival(stored.events.length,'actual_native_partition_event_required');expect((stored.events.at(-1)!.payload as Row).sourceObjectPartition).toEqual(result.partition)}
  else requireArrival(!stored.events.length||((stored.events.at(-1)!.payload as Row).sourceObjectPartition??null)===null,'no_unobserved_native_partition_allowed')
  const guardObservation:GuardObservation={assessmentId:assessment.id as string,sourceId:m.id,payloadHash:arrivalHash(m.raw_payload!),factsHash:assessment.facts_hash as string,factsText:assessment.facts_text,canonical:{syntaxDecision:decision.syntaxDecision,applicationDecision:decision.applicationDecision,functionalDecision:decision.functionalDecision,reasonCodes:[...new Set(decision.issues.map(issue=>issue.code))],rulePackEvidence:fullFacts.rulePackEvidence},nativePartition:result?.partition?.map(p=>({disposition:p.disposition,...(p.disposition==='held'?{reason:p.reason}:{})}))??null,diagnostics:decision.issues.map(issue=>({code:issue.code,fieldNumber:issue.prodatDiagnostic?.kind==='field'?issue.prodatDiagnostic.fieldNumber:null}))}
  return{decision,result,assessment,guardObservation}
 }finally{canonical.mockRestore();apply.mockRestore()}
}
async function protocol(company:string,user:string,m:EdielMessageRow,positiveSupply:boolean,decision:runtime.CanonicalRuntimeDecision,send=false){
 const acks=sql<EdielMessageRow[]>(`SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY message_family,id),'[]') FROM public.ediel_messages a WHERE a.company_id=${literal(company)} AND a.related_message_id=${literal(m.id)} AND a.direction='outbound'`)
 expect(acks.filter(a=>a.message_family==='CONTRL')).toHaveLength(1)
 for(const ack of acks){
  expect(ack).toMatchObject({company_id:company,environment:'test',direction:'outbound',related_message_id:m.id});expect(validateEdifactEnvelope(ack.raw_payload!).ok).toBe(true)
  const correlation=readPhysicalAckSourceCorrelation(ack,m);expect(correlation.classification.outcome).toBe(ack.ack_outcome)
  expect(Date.parse(ack.created_at)).toBeGreaterThanOrEqual(Date.parse(m.message_received_at!))
  expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_outbox WHERE company_id=${literal(company)} AND ediel_message_id=${literal(ack.id)} AND source_message_id=${literal(m.id)} AND environment='test'`)).toBe(1)
  expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ediel_ack_replay.creation_receipts WHERE ack_message_id=${literal(ack.id)} AND source_message_id=${literal(m.id)} AND company_id=${literal(company)} AND environment='test' AND source_payload_hash=${literal(arrivalHash(m.raw_payload!))} AND ack_payload_hash=${literal(arrivalHash(ack.raw_payload!))}`)).toBe(1)
  if(send){requireArrival(ack.receiver_email?.endsWith('@example.invalid'),'actual_own_ACK_disposable_recipient_required');smtp.recipient=ack.receiver_email;await sendEdielMessageViaSmtp(ack,{actorUserId:user,smtpMimeMode:'nodemailer-attachment'});expect((await message(company,ack.id)).status).toBe('sent')}
 }
 if(positiveSupply){
  expect(acks.map(a=>[a.message_family,a.ack_outcome])).toEqual([['APERAK','positive'],['CONTRL','positive']])
  const own=arrivalWireScope(m.raw_payload!,'Z04','Z24'),final=await readReceivedProdatFinalResponsePlan({companyId:company,sourceMessageId:m.id,rawPayload:m.raw_payload!})
  expect(final).toMatchObject({totalObjectCount:1,plans:[{outcome:'positive',objectLineIndices:[own.lineIndex],acknowledgedReferences:[own.li],effectKind:'supply'}]})
  const committed=effects(company,m.id);expect(final!.plans[0].effectReceiptId).toBe(committed.effects[0].id);expect(final!.plans[0].effectFactsHash).toBe(committed.effects[0].effect_hash)
 }else{
  expect(acks.filter(a=>a.message_family==='APERAK'&&a.ack_outcome==='positive')).toEqual([])
  if(decision.responsePlan.some(plan=>plan.family==='APERAK'&&plan.outcome==='negative'))expect(acks.filter(a=>a.message_family==='APERAK'&&a.ack_outcome==='negative')).toHaveLength(1)
  expect(await readReceivedProdatFinalResponsePlan({companyId:company,sourceMessageId:m.id,rawPayload:m.raw_payload!})).toBeNull()
 }
 return sql(`SELECT jsonb_build_object('acks',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'family',message_family,'raw',raw_payload,'hash',immutable_payload_hash,'related',related_message_id,'outcome',ack_outcome,'sentAt',message_sent_at) ORDER BY id),'[]') FROM public.ediel_messages WHERE company_id=${literal(company)} AND related_message_id=${literal(m.id)} AND direction='outbound'),'outbox',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY id),'[]') FROM public.ediel_outbox o WHERE company_id=${literal(company)} AND source_message_id=${literal(m.id)}))`)
}

it('native A: same stored unmatched C processes, later real nonmatching original cannot grant its effect or rewrite custody',async()=>{
 const p=input().A;await authenticated(p.companyId,p.actor)
 const c=await message(p.companyId,p.storedC.sourceId),own=arrivalWireScope(c.raw_payload!,'Z04','Z24'),born=custody(p.companyId,c.id)
 expect(c).toMatchObject({direction:'inbound',message_family:'PRODAT',message_code:'Z04',inbound_email_message_id:p.storedC.mailId});expect(arrivalHash(c.raw_payload!)).toBe(p.storedC.payloadHash)
 expect(arrivalHash(JSON.stringify(c.execution_context_snapshot))).toBe(p.storedC.contextSha256);expect(Date.parse(c.message_received_at!)).toBe(Date.parse(p.storedC.receivedAt));assertCustody(born,c);expect(born.parse.id).toBe(p.storedC.parseId)
 const parsed=parseEdifactPayload(c.raw_payload!),matchInput={companyId:p.companyId,parsed,inboundEmailMessageId:p.storedC.mailId,parseResultId:p.storedC.parseId}
 expect(await matchOutboundRequestForInbound(matchInput)).toMatchObject({status:'missing',entityId:null,candidates:[]})
 const laterBefore=switchRow(p.companyId,p.laterSwitchId);expect(laterBefore.outbound_z03_message_id).toBeNull();expect(laterBefore.status).toBe('ready')
 const before=business(p.companyId);noEffect(p.companyId,c.id)
 const first=await observedProcess(p.companyId,p.actor.id,c)
 const firstGuard=assertDecisiveArrivalGuard(first.guardObservation,p.expectedGuard,{id:c.id,hash:p.storedC.payloadHash})
 expect(firstGuard.nativeOriginalBranch).toBe(p.expectedGuard.stage==='native_original');noEffect(p.companyId,c.id);assertUnchangedArrival(before,business(p.companyId),'A_before_original_business');assertUnchangedArrival(born,custody(p.companyId,c.id),'A_C_birth')
 await protocol(p.companyId,p.actor.id,c,false,first.decision)
 const queued=await prepareAndQueueEdielZ03({actorUserId:p.actor.id,switchRequestId:p.laterSwitchId,communicationRouteId:p.laterRouteId,environment:'test'})
 requireArrival(queued.receiver_email?.endsWith('@example.invalid'),'actual_own_Z03_disposable_recipient_required');smtp.recipient=queued.receiver_email
 await sendEdielMessageViaSmtp(queued,{actorUserId:p.actor.id,smtpMimeMode:'nodemailer-attachment'})
 const sent=await message(p.companyId,queued.id),actual=await qualifiedSent(p.companyId,{sourceId:sent.id,switchId:p.laterSwitchId,payloadHash:arrivalHash(sent.raw_payload!)})
 requireArrival(actual.physical.li!==own.li,'later_original_must_actually_NONmatch_stored_C_LI');assertArrivalOrder(c.message_received_at,sent.message_sent_at)
 const afterLegitimate=business(p.companyId),laterOriginal=originalBookend(p.companyId,sent.id)
 for(let replay=0;replay<2;replay++){
  expect(await matchOutboundRequestForInbound(matchInput)).toMatchObject({status:'missing',entityId:null,candidates:[]})
  const id=await createInboundEdielMessage({...matchInput,actorUserId:p.actor.id,environment:'test',outboundMatch:await matchOutboundRequestForInbound(matchInput),meteringPointMatch:await matchMeteringPointForInbound({companyId:p.companyId,parsed})})
  expect(id).toBe(c.id)
  const processed=await observedProcess(p.companyId,p.actor.id,await message(p.companyId,c.id))
  assertDecisiveArrivalGuard(processed.guardObservation,p.expectedGuard,{id:c.id,hash:p.storedC.payloadHash});noEffect(p.companyId,c.id)
  assertUnchangedArrival(afterLegitimate,business(p.companyId),'A_after_legitimate_origination_business');assertArrivalCustodyReplay(born,custody(p.companyId,c.id),p.actor.id);assertUnchangedArrival(laterOriginal,originalBookend(p.companyId,sent.id),'A_later_original')
  await protocol(p.companyId,p.actor.id,c,false,processed.decision)
 }
},180000)

it('native B: exact already SENT own Z03 derives C before any period; delayed own L cannot activate cancelled start or sibling',async()=>{
 const p=input().B;await authenticated(p.companyId,p.actor)
 const own=await qualifiedSent(p.companyId,p.original),sibling=await qualifiedSent(p.companyId,p.sibling)
 requireArrival(own.sw.metering_point_id!==sibling.sw.metering_point_id,'nonempty_unrelated_sibling_point_required')
 noOwnPeriod(p.companyId,own.sw);expect(own.sw.inbound_z04_message_id).toBeNull()
 const original=originalBookend(p.companyId,own.m.id),siblingBookend={switch:sibling.sw,original:originalBookend(p.companyId,sibling.m.id)},otherBusiness=business(p.companyId,p.original.switchId)
 const context:CancellationProspectiveContext={external:own.physical.point,sender:own.physical.sender,receiver:own.physical.receiver,brpEdielId:own.physical.brp,customerIdentity:{id:own.physical.customer},gridAreaCode:own.physical.grid,caseReference:own.physical.li,requestedStartDate:own.sw.requested_start_date as string}
 const c=await receive(p.companyId,p.actor.id,prospectiveArrivalC(context)),physical=arrivalWireScope(c.raw_payload!,'Z04','Z24'),cBirth=custody(p.companyId,c.id)
 assertArrivalOrder(own.m.message_sent_at,c.message_received_at);noEffect(p.companyId,c.id);noOwnPeriod(p.companyId,own.sw)
 const applied=await observedProcess(p.companyId,p.actor.id,c)
 expect(applied.result).toMatchObject({applied:true,fullyApplied:true,reviewRequired:false,periods:[],commits:[]})
 const receipt=effects(p.companyId,c.id);expect(receipt.effects).toHaveLength(1);expect(receipt.partitions).toHaveLength(1);expect(receipt.transitions).toHaveLength(1);expect(receipt.normal).toEqual([])
 assertCommittedArrivalCancellation(receipt,{sourceId:c.id,hash:arrivalHash(c.raw_payload!),assessmentId:applied.assessment.id as string,switchId:p.original.switchId,originalId:own.m.id,companyId:p.companyId,scope:physical})
 const effect=receipt.effects[0];expect(effect).toMatchObject({source_message_id:c.id,company_id:p.companyId,environment:'test',payload_hash:arrivalHash(c.raw_payload!),first_line_index:physical.lineIndex,canonical_assessment_id:applied.assessment.id})
 requireArrival(typeof effect.effect_text==='string'&&arrivalHash(effect.effect_text)===effect.effect_hash,'actual_committed_effect_hash_required')
 const facts=JSON.parse(effect.effect_text) as Row
 expect(facts).toMatchObject({owner:'inbound-supply-object-v1',sourceMessageId:c.id,sourcePayloadHash:arrivalHash(c.raw_payload!),companyId:p.companyId,environment:'test',canonicalAssessmentId:applied.assessment.id,object:{objectId:physical.point,identityAgency:physical.agency},plan:{kind:'cancel_start',switchId:p.original.switchId,periodId:null},resultingStates:[],resultingSwitches:[{id:p.original.switchId,status:'cancelled_before_start',outbound_z03_message_id:own.m.id}]})
 expect(receipt.partitions[0]).toMatchObject({source_message_id:c.id,payload_hash:arrivalHash(c.raw_payload!),canonical_assessment_id:applied.assessment.id,result:{applied:true,periods:[],commits:[],effectReceiptIds:[effect.id]}})
 expect(switchRow(p.companyId,p.original.switchId)).toMatchObject({status:'cancelled_before_start',outbound_z03_message_id:own.m.id,inbound_z04_message_id:c.id})
 const cancelled=switchRow(p.companyId,p.original.switchId)
 assertOwnArrivalCancellation(own.sw,cancelled,c.id,c.message_received_at!)
 expect(facts.previousSwitches).toEqual([own.sw]);expect(facts.resultingSwitches).toEqual([cancelled])
 noOwnPeriod(p.companyId,own.sw);assertUnchangedArrival(original,originalBookend(p.companyId,own.m.id),'B_own_original');assertUnchangedArrival(siblingBookend,{switch:switchRow(p.companyId,p.sibling.switchId),original:originalBookend(p.companyId,sibling.m.id)},'B_sibling');assertUnchangedArrival(otherBusiness,business(p.companyId,p.original.switchId),'B_other_business')
 const cProtocol=await protocol(p.companyId,p.actor.id,c,true,applied.decision,true)
 const l=await receive(p.companyId,p.actor.id,buildCancellationProspectiveZ04(context)),lBirth=custody(p.companyId,l.id)
 assertArrivalOrder(c.message_received_at,l.message_received_at);expect(l.id).not.toBe(c.id);expect(arrivalWireScope(l.raw_payload!,'Z04','Z22').li).toBe(physical.li)
 const held=await observedProcess(p.companyId,p.actor.id,l)
 requireArrival(held.result?.partition?.length===1&&held.result.partition[0].disposition==='held'&&held.result.partition[0].reason==='normal_z04_locked_original_scope_required','actual_delayed_L_cancelled_original_guard_required')
 expect(held.result.applied).toBe(false);noEffect(p.companyId,l.id);noOwnPeriod(p.companyId,own.sw)
 await protocol(p.companyId,p.actor.id,l,false,held.decision)
 for(const source of [c,l]){
  await observedProcess(p.companyId,p.actor.id,await message(p.companyId,source.id))
  assertUnchangedArrival(receipt,effects(p.companyId,c.id),'B_C_committed_receipts');noEffect(p.companyId,l.id);noOwnPeriod(p.companyId,own.sw)
  assertUnchangedArrival(cancelled,switchRow(p.companyId,p.original.switchId),'B_cancelled_switch');assertUnchangedArrival(original,originalBookend(p.companyId,own.m.id),'B_original');assertUnchangedArrival(cBirth,custody(p.companyId,c.id),'B_C_custody');assertUnchangedArrival(lBirth,custody(p.companyId,l.id),'B_L_custody');assertUnchangedArrival(otherBusiness,business(p.companyId,p.original.switchId),'B_other_business');assertUnchangedArrival(siblingBookend,{switch:switchRow(p.companyId,p.sibling.switchId),original:originalBookend(p.companyId,sibling.m.id)},'B_nonempty_sibling')
 }
 // Read-only replay of national protocol; do not resend a retained positive ACK.
 const replayProtocol=await protocol(p.companyId,p.actor.id,c,true,applied.decision)
 // Positive C remains lawful because it has the above committed effect. This
 // comparison uses exact persisted physical replies/outbox, not protocol JSON.
 assertUnchangedArrival(cProtocol,replayProtocol,'B_C_protocol')
},180000)
