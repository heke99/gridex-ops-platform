import {execFileSync} from 'node:child_process'
import {createHash,randomUUID} from 'node:crypto'
import {recordUtiltsTechnicalReception,registerUtiltsIssuer,seedUtiltsIssuerHistoryGround} from './helpers/utiltsConsumptionParties'
import {afterEach,beforeAll,expect,it,vi} from 'vitest'
import {closureFixture as originalClosureFixture} from '../__tests__/helpers/closureWireFixtures'
import {reviewReceivedClosureSource} from '@/lib/ediel/sources/reviewReceivedClosureSource'
import {captureCorrectionContext} from '@/lib/ediel/sources/correctionContextCapture'
import {structuralOwnerSource as originalStructuralOwnerSource} from '../__tests__/helpers/structuralOwnerFixtures'
import {reviewReceivedStructuralSource} from '@/lib/ediel/sources/reviewReceivedStructuralSource'
import {inspectStructuralReadset} from '@/lib/ediel/sources/structuralSourceReadset'
import {compareUtiltsStructure} from '@/lib/ediel/utilts/structuralComparison'
import {utiltsStructureWire as originalUtiltsStructureWire,STRUCTURE_POINT} from '../__tests__/helpers/structuralComparisonFixtures'
import {priorE30PointWire as originalPriorE30PointWire} from '../__tests__/helpers/priorUtiltsStructureFixtures'
import {priorE66MembershipWire as originalPriorE66MembershipWire} from '../__tests__/helpers/priorUtiltsStructureFixtures'
import {ownerSourceWithInstallationStatus as originalOwnerSource} from '../__tests__/helpers/sourceOwnerFixtures'
import {utiltsNativeSourceFixture as originalUtiltsNativeSourceFixture} from '../__tests__/helpers/utiltsNativeSourceFixture'
import {observationHandoffMessage as originalObservationHandoffMessage} from '../__tests__/helpers/utiltsObservationHandoff'
import type {EdielMessageRow} from '@/lib/ediel/types'

import {nativeCalendarShiftDays,shiftMarketDates,viaOriginalCalendar} from '../__tests__/helpers/nativeMarketCalendar'
// Fixtures were authored around a 2026-10-01 supply start. The suite runs in a calendar shifted by
// whole days so the start stays ahead of the freshly replayed ledger epoch (see nativeMarketCalendar).
const CALENDAR_SHIFT_DAYS=nativeCalendarShiftDays()
const S=(value:string)=>shiftMarketDates(value,CALENDAR_SHIFT_DAYS)
const closureFixture=viaOriginalCalendar(originalClosureFixture,CALENDAR_SHIFT_DAYS)
const structuralOwnerSource=viaOriginalCalendar(originalStructuralOwnerSource,CALENDAR_SHIFT_DAYS)
const priorE30PointWire=viaOriginalCalendar(originalPriorE30PointWire,CALENDAR_SHIFT_DAYS)
const priorE66MembershipWire=viaOriginalCalendar(originalPriorE66MembershipWire,CALENDAR_SHIFT_DAYS)
const ownerSource=viaOriginalCalendar(originalOwnerSource,CALENDAR_SHIFT_DAYS)
const utiltsNativeSourceFixture=viaOriginalCalendar(originalUtiltsNativeSourceFixture,CALENDAR_SHIFT_DAYS)
const observationHandoffMessage=viaOriginalCalendar(originalObservationHandoffMessage,CALENDAR_SHIFT_DAYS)
const utiltsStructureWire=viaOriginalCalendar(originalUtiltsStructureWire,CALENDAR_SHIFT_DAYS)

// No database/client, parser, canonical registry or ownership decision is
// mocked. Only unrelated notification/event sinks are withheld on this runner.
const utiltsEffects=vi.hoisted(()=>({ack:vi.fn(),meter:vi.fn(),provider:vi.fn(),interruptParsed:false}))
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:utiltsEffects.provider})}}))
vi.mock('@/lib/ediel/db',async original=>{
 const actual=await original<typeof import('@/lib/ediel/db')>()
 return {...actual,createEdielMessageEvent:async()=>null,updateEdielMessageStatus:async(input:Parameters<typeof actual.updateEdielMessageStatus>[0])=>{
  if(utiltsEffects.interruptParsed&&input.status==='parsed'){
   utiltsEffects.interruptParsed=false;throw Error('prior_native_after_persistence_before_ack')
  }
  return actual.updateEdielMessageStatus(input)
 }}
})
vi.mock('@/lib/ediel/core/kernel',async original=>({...await original<Record<string,unknown>>(),
 createCanonicalAckMessage:utiltsEffects.ack}))
vi.mock('@/lib/metering/normalizeMeteringValues',()=>({normalizeAndStoreMeteringValue:utiltsEffects.meter}))
vi.mock('@/lib/customer-notifications/notificationOrchestrator',()=>({enqueueCustomerLifecycleNotification:async()=>null}))
vi.mock('@/lib/website/customerApplicationWorkflowBridge',()=>({transitionCorrelatedCustomerApplicationWorkflow:async()=>null}))
import {supabaseService} from '@/lib/supabase/service'
import {resolveCanonicalRuntimeDecisionWithRegistry,readReceivedCanonicalProdatApplicationObjects} from '@/lib/ediel/core/runtimeDecision'
import {buildReceivedSourceValidationEvidence} from '@/lib/ediel/core/receivedSourceValidationEvidence'
import {recordReceivedSourceValidation} from '@/lib/ediel/core/receivedSourceValidationLedger'
import {captureFreshEdielSourceRulePackEvidence} from '@/lib/ediel/core/sourceRulePackEvidence'
import {createReceivedSourceOwnerSession} from '@/lib/ediel/sources/receivedSourceOwnerSession'
import {applyInboundBusinessStateMachine} from '@/lib/ediel/flows/inboundBusinessStateMachine'
import {resolveCanonicalMessagePolicy} from '@/lib/ediel/core/messagePolicy'
import {finalizeSupplierSwitchExecution} from '@/lib/operations/db'
import {seedNormalSwitchNativeFixture} from './helpers/ediel-normal-switch-native-fixture'
import {seedOriginalMailboxNative,recordOriginalMailboxNativeReception} from './helpers/originalMailboxNative'
import {assertEdielSmtpReadiness} from '@/lib/ediel/mailReadiness'
import {createInboundEdielMessage} from '@/lib/inbound-mail/inboundStatusUpdater'
import {matchOutboundRequestForInbound,matchMeteringPointForInbound} from '@/lib/inbound-mail/inboundMatcher'
import {tokenizeEdifact,segmentSourceSpan} from '@/lib/ediel/core/edifactTokenizer'

import {inspectReceivedSourceDecisionTimeline} from '@/lib/ediel/sources/receivedSourceDecisionTimeline'

const DB='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const literal=(v:unknown):string=>v===null?'NULL':"'"+String(typeof v==='object'?JSON.stringify(v):v).replaceAll("'","''")+"'"
function sql<T>(input:string,captureStderr=false):T {
  if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('local_only')
  const out=execFileSync('psql',[DB,'-XAtq','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',timeout:10000,maxBuffer:2_000_000,
    ...(captureStderr?{stdio:'pipe' as const}:{})}).trim()
  return out?JSON.parse(out) as T:undefined as T
}
let serial=0
function fixtureGsrn(sequence:number):string {
  const first17=`735123456789${String(sequence).padStart(5,'0')}`
  const weighted=[...first17].reduce((sum,digit,index)=>sum+Number(digit)*(index%2===0?3:1),0)
  return `${first17}${(10-weighted%10)%10}`
}
type NativeWireScope={external:string;sender:string;receiver:string;caseReference:string;gridArea:string;brpEdielId:string;
 customerIdentity:{id:string;qualifier:string;agency:string}}
/** The synthetic native rows use test_flag=1. Stamp physical UNB 0035 while
 * constructing their wire, before the actual insertion-scoped source seal. */
function nativeTestWire(wire:string):string {
 const {una,segments}=tokenizeEdifact(wire),headers=segments.filter(segment=>segment.tag==='UNB')
 expect(headers).toHaveLength(1)
 const header=headers[0],span=segmentSourceSpan(header)
 expect(span).not.toBeNull()
 const fields:string[]=[];let field='',released=false
 for(const char of header.raw){
  if(released){field+=char;released=false;continue}
  if(char===una.releaseCharacter){field+=char;released=true;continue}
  if(char===una.dataElementSeparator){fields.push(field);field='';continue}
  field+=char
 }
 fields.push(field)
 while(fields.length<12)fields.push('')
 // Preserve the existing technical acknowledgement request separately.
 fields[9]='1'
 fields[11]='1'
 const stamped=wire.slice(0,span!.startOffset)+fields.join(una.dataElementSeparator)+wire.slice(span!.endOffset)
 expect(tokenizeEdifact(stamped).segments.find(segment=>segment.tag==='UNB')?.elements[11]).toBe('1')
 expect(tokenizeEdifact(stamped).segments.find(segment=>segment.tag==='UNB')?.elements[9]).toBe('1')
 return stamped
}
/** Substitute declared placeholder addresses only, keeping physical reference
 * and customer namespaces tied to this fixture's actual rendered Z03. */
function scopedWire(scope:NativeWireScope,wire:string):string {
 return nativeTestWire(wire.replaceAll('735123456789012345',scope.external)
  .replaceAll('NAD+Z02+54321:160:SVK',`NAD+Z02+${scope.brpEdielId}:160:SVK`)
  .replaceAll('12345:14',`${scope.receiver}:14`).replaceAll('54321:14',`${scope.sender}:14`)
  .replaceAll('12345:ZZ',`${scope.receiver}:ZZ`).replaceAll('54321:ZZ',`${scope.sender}:ZZ`)
  .replaceAll('12345:160:SVK',`${scope.receiver}:160:SVK`).replaceAll('54321:160:SVK',`${scope.sender}:160:SVK`)
  .replaceAll('RFF+LI:CASE-1',`RFF+LI:${scope.caseReference}`)
  .replaceAll('RFF+Z05:NET-1',`RFF+Z05:${scope.gridArea}`)
  .replaceAll('RFF+Z05:NET\'',`RFF+Z05:${scope.gridArea}'`)
  .replaceAll('NAD+Z02+11111:160:SVK',`NAD+Z02+${scope.brpEdielId}:160:SVK`)
  .replaceAll('NAD+UD+CUSTOMER-1::89',`NAD+UD+${scope.customerIdentity.id}:${scope.customerIdentity.qualifier}:${scope.customerIdentity.agency}`))
}
/** Synthetic entities use the actual signed contract, original and accepted
 * provider owners. The supply INSERT still belongs to the native business RPC. */
async function seed(delegated=false, structural=false) {
  const caseNo=++serial,sourceId=randomUUID(),reviewer=randomUUID(),transport=randomUUID()
  // The source clock may be mature for activation probes. Structural coverage
  // keeps its declared October boundary; neither lane edits accepted receipts.
  const requestedStartDate=structural?S('2026-10-01'):S('2026-09-24')
  vi.stubEnv('EDIEL_SHARED_MAILBOX_ADDRESS','synthetic@example.invalid')
  vi.stubEnv('EDIEL_APP_DKIM_ENABLED','false');vi.stubEnv('EMAIL_PROVIDER','resend')
  vi.stubEnv('EDIEL_SMTP_FROM','synthetic@example.invalid');vi.stubEnv('EDIEL_SMTP_USER','synthetic@example.invalid')
  vi.stubEnv('EDIEL_SMTP_PASS','synthetic-only');vi.stubEnv('EDIEL_EMAIL_PROVIDER','strato')
  const providerCalls=utiltsEffects.provider.mock.calls.length
  const native=await seedNormalSwitchNativeFixture({requestedStartDate,external:fixtureGsrn(caseNo),provider:email=>{
    utiltsEffects.provider.mockResolvedValue({accepted:[email],rejected:[],messageId:`native-original-${sourceId}`,response:'250 synthetic accepted'})
  }})
  expect(utiltsEffects.provider).toHaveBeenCalledTimes(providerCalls+1)
  const ids={source:sourceId as string,company:native.companyId,customer:native.customerId,point:native.pointId,site:native.siteId,
    grid:native.gridId,switch:native.switchId,actor:native.actorUserId,transport,outbound:native.originalZ03.id,reviewer,
    route:native.routeId,routeProfile:native.routeProfileId,contract:native.contractId}
  const p=(key:keyof typeof ids)=>literal(ids[key])
  const scope={external:native.external,sender:native.sender,receiver:native.receiver,caseReference:native.caseReference,
    customerIdentity:native.customerIdentity,requestedStartDate,gridArea:native.gridAreaCode,brpEdielId:native.brpEdielId}
  // Declare this positive fixture's own reading fields before source birth.
  // The runtime still requires its actual mailbox/parse/reception owner.
  const input=structural?structuralOwnerSource():ownerSource('Z12',{readingDeclarations:true,
    sourceCodes:{installationStatus:'Z12',settlementMethod:'Z32'}})
  let wire=scopedWire(scope,String(input.raw_payload))
  if(!structural)wire=wire.replaceAll(`DTM+92:${S('2026-10-01').replaceAll('-','')}0000:203`,`DTM+92:${requestedStartDate.replaceAll('-','')}0000:203`)
  const transportEdiel=sql<string>(`SELECT to_jsonb(min(n)::text) FROM generate_series(90000,99999) n
    WHERE NOT EXISTS(SELECT FROM public.platform_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value=n::text)`)
  if(delegated)wire=wire.replace(`+${native.sender}:14+`,`+${transportEdiel}:14+`)
  sql(`INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
    VALUES(${p('reviewer')},'authenticated','authenticated',${literal(`e035-native-reviewer-${reviewer}@example.invalid`)},now(),'{}','{}',now(),now(),false,false);
    INSERT INTO public.user_profiles(id,email,full_name,user_status,created_at,updated_at)
    VALUES(${p('reviewer')},${literal(`e035-native-reviewer-${reviewer}@example.invalid`)},'Synthetic E035 scoped reviewer','active',now(),now())
    ON CONFLICT(id) DO UPDATE SET user_status='active';
    INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key)
    VALUES(${p('company')},${p('reviewer')},'member','active',now(),'{}','member',true,now(),'member');
    INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key)
    SELECT ${p('reviewer')},${p('company')},permission.id,permission.key FROM public.permissions permission
    WHERE permission.key IN('communication.read','communication.write','communication.send','metering.read','metering.write','ediel_testing.write');
    ${delegated?`INSERT INTO public.platform_market_actors(id,name) VALUES(${p('transport')},'Synthetic native transport ${caseNo}');
      INSERT INTO public.platform_actor_identifiers(actor_id,identifier_type,identifier_value,is_verified,valid_from,valid_to)
      VALUES(${p('transport')},'EdielId',${literal(transportEdiel)},true,'${S('2026-01-01')}','${S('2099-01-01')}');
      INSERT INTO public.tenant_counterparty_relations(company_id,environment,counterparty_actor_id,relation_type,is_enabled,valid_from)
      VALUES(${p('company')},'test',${p('transport')},'ediel_transport_agent',true,clock_timestamp()-interval '1 second');`:''}`)
  // Use the actual retained mail and parser before the public source creator.
  // Its immutable birth and first reception are never backfilled by this suite.
  const receivedAt=new Date().toISOString()
  const mail=await seedOriginalMailboxNative(<T>(statement:string)=>sql<T>(statement,true),literal,{companyId:ids.company,environment:'test',raw:wire,
    receivedAt,smtpFrom:assertEdielSmtpReadiness().from})
  const outboundMatch=await matchOutboundRequestForInbound({companyId:ids.company,parsed:mail.parsed,
    inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId})
  const meteringPointMatch=await matchMeteringPointForInbound({companyId:ids.company,parsed:mail.parsed})
  const source=await createInboundEdielMessage({companyId:ids.company,actorUserId:ids.actor,environment:'test',
    inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId,
    parsed:mail.parsed,outboundMatch,meteringPointMatch})
  expect(source,'public_creator_must_return_actual_source').toMatch(/^[a-f0-9-]{36}$/)
  ids.source=source!
  const {data,error}=await supabaseService.from('ediel_messages').select('*').eq('id',ids.source).single()
  expect(error).toBeNull();expect(data).not.toBeNull()
  expect(data).toMatchObject({id:ids.source,company_id:ids.company,environment:'test',direction:'inbound',
    message_family:'PRODAT',message_code:'Z04',raw_payload:wire,inbound_email_message_id:mail.inboundEmailMessageId,
    mailbox_message_id:mail.inboundEmailMessageId,rule_profile_key:'PRODAT:Z04:L:26.A:r3',
    customer_id:ids.customer,site_id:ids.site})
  const receptions=sql<Record<string,unknown>[]>(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]')
    FROM gridex_ediel_inbound_receptions.receptions r WHERE company_id=${p('company')} AND source_message_id=${p('source')};`,true)
  const payloadHash=createHash('sha256').update(wire).digest('hex')
  expect(receptions).toHaveLength(1)
  expect(receptions[0]).toMatchObject({source_message_id:ids.source,company_id:ids.company,environment:'test',
    inbound_email_message_id:mail.inboundEmailMessageId,parse_result_id:mail.parseResultId,actor_user_id:ids.actor,
    classification:'first_reception',canonical_payload_hash:payloadHash,received_payload_hash:payloadHash})
  const retainedMail=sql<{received_at:string;raw_edifact_payload:string}>(`SELECT to_jsonb(m)
    FROM public.inbound_email_messages m WHERE company_id=${p('company')} AND id=${literal(mail.inboundEmailMessageId)};`,true)
  expect(retainedMail.raw_edifact_payload).toBe(wire)
  expect(Date.parse(retainedMail.received_at)).toBe(Date.parse(receivedAt))
  expect(Date.parse(data!.message_received_at!)).toBe(Date.parse(retainedMail.received_at))
  expect(Date.parse(String(receptions[0].received_at))).toBe(Date.parse(retainedMail.received_at))
  for(const permission of ['ediel_testing.write','metering.read','communication.read']){
    const authorized=await supabaseService.rpc('gridex_actor_has_company_permission',{
      p_actor_user_id:ids.reviewer,p_company_id:ids.company,p_permission:permission,
    })
    expect(authorized.error).toBeNull();expect(authorized.data).toBe(true)
  }
  return {ids,original:data as unknown as EdielMessageRow,...scope}
}
async function prepare(f:Awaited<ReturnType<typeof seed>>) {
  const decision=await resolveCanonicalRuntimeDecisionWithRegistry(f.original,{actorUserId:f.ids.actor})
  expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision.issues)).toEqual(['accepted','accepted','accepted'])
  const ownApplication=readReceivedCanonicalProdatApplicationObjects(decision,f.original)
  expect(ownApplication,'complete_own_application_must_qualify_before_real_supply_apply').toMatchObject({
    headerDecision:'accepted',objects:[{applicationDecision:'accepted',reasonCodes:[]}]})
  const canonical=await recordReceivedSourceValidation({original:f.original,validated:f.original,resolvedCompanyId:f.ids.company,decision})
  expect(canonical, JSON.stringify({rulePackEvidence:decision.validationReport.rulePackEvidence,sourceReceivedAt:f.original.message_received_at,context:f.original.execution_context_snapshot})).toMatchObject({status:'recorded'})
  // Production order (lib/ediel/flows/inboundProcessing.ts): an accepted
  // PRODAT source's own rule-pack receipt is captured right after its record.
  await captureFreshEdielSourceRulePackEvidence(f.ids.company,f.original.id)
  const session=createReceivedSourceOwnerSession(canonical)
  expect(session).not.toBeNull()
  return {canonical,session:session!}
}
// Observe only literal qualification reasons from the actual Z04/L apply;
// unknown values remain counted without printing source IDs or free-form text.
const sourceOwnerSupplyReasons = [
  'supply_execution_actor_unqualified',
  'supply_frozen_legal_context_required',
  'supply_complete_own_application_and_function_required',
  'supply_complete_physical_partition_required',
  'own_application_not_accepted',
  'ambiguous_physical_supply_scope',
  'own_supply_wire_or_legal_scope_unavailable',
  'own_supply_business_unqualified',
  'no_qualified_supply_objects',
  'normal_z04_source_required',
  'normal_z04_execution_actor_required',
  'normal_z04_frozen_legal_context_required',
  'normal_z04_canonical_leaf_ambiguous',
  'normal_z04_canonical_source_not_accepted',
  'normal_z04_whole_physical_scope_required',
  'supply_original_cohort_changed',
  'normal_z04_register_owner_scope_required',
  'normal_z04_exact_sent_original_required',
  'normal_z04_locked_original_scope_required',
  'normal_z04_owned_signed_contract_scope_required',
  'normal_z04_conflicting_supply_period',
 ] as const
function sourceOwnerSupplyDiagnostic(results: import('@/lib/ediel/flows/supplyMarketTransition').SupplyMarketResult[]) {
 const refused=results.filter(result=>!result.applied)
 const held=results.flatMap(result=>result.partition?.flatMap(entry=>entry.disposition==='held'?[entry.reason]:[])??[])
 const known=(reason:string|null)=>sourceOwnerSupplyReasons.some(marker=>marker===reason)
 return {
  observedApplyCount:results.length,
  appliedCount:results.filter(result=>result.applied).length,
  primaryReasonCounts:Object.fromEntries(sourceOwnerSupplyReasons.map(marker=>[marker,refused.filter(result=>result.reason===marker).length])),
  unknownPrimaryReasonCount:refused.filter(result=>!known(result.reason)).length,
  heldReasonCounts:Object.fromEntries(sourceOwnerSupplyReasons.map(marker=>[marker,held.filter(reason=>reason===marker).length])),
  unknownHeldReasonCount:held.filter(reason=>!known(reason)).length,
 }
}
async function complete(f:Awaited<ReturnType<typeof seed>>,given?:Awaited<ReturnType<typeof prepare>>) {
  const prepared=given ?? await prepare(f)
  const supplyModule=await import('@/lib/ediel/flows/supplyMarketTransition')
  // A default spy delegates to the existing real implementation; inspect its
  // already-returned promise rather than executing another apply or replay.
  const observedApply=vi.spyOn(supplyModule,'applySupplyMarketSource')
  let result:Awaited<ReturnType<typeof applyInboundBusinessStateMachine>>
  let sourceQualification:ReturnType<typeof sourceOwnerSupplyDiagnostic>
  try{
   result=await applyInboundBusinessStateMachine({message:f.original,actorUserId:f.ids.actor,matchedSwitchRequestId:f.ids.switch,onSourceSwitchCommitted:prepared.session.onSwitchCommitted})
   const pending=observedApply.mock.results.flatMap((returned,index)=>{
    const call=observedApply.mock.calls[index]?.[0]
    return returned.type==='return'&&call?.message.company_id===f.ids.company&&call.message.id===f.ids.source&&call.actorUserId===f.ids.actor?[returned.value]:[]
   })
   sourceQualification=sourceOwnerSupplyDiagnostic(await Promise.all(pending))
  }finally{observedApply.mockRestore()}
  expect(result.outcome, JSON.stringify({...result,sourceQualification})).toBe('supplier_switch_accepted')
  return prepared.session.finish()
}
function stored(source:string) {
  return sql<{facts:Record<string,unknown>;readsets:{observedAt:string}[];assessmentId:string;canonicalId:string;sourceHash:string;factsText:string;factsHash:string;createdXid:string;witnessXid:string|null}[]>(`
   SELECT coalesce(jsonb_agg(jsonb_build_object('facts',a.facts_text::jsonb,'factsText',a.facts_text,'factsHash',a.facts_hash,'readsets',a.owner_readsets,'assessmentId',a.id,'canonicalId',a.canonical_assessment_id,'sourceHash',a.source_payload_hash,'createdXid',a.created_xid::text,'witnessXid',w.xmin::text) ORDER BY a.assessed_at),'[]') FROM gridex_received_sources.object_assessments a LEFT JOIN gridex_received_sources.object_availability_witnesses w ON w.assessment_id=a.id WHERE a.source_message_id=${literal(source)};`)
}
beforeAll(async()=>{
  // Confirm the local Data API has observed the replay's final schema.
  sql("NOTIFY pgrst, 'reload schema';")
  for(let i=0;i<20;i++) {
    const {error}=await supabaseService.rpc('gridex_witness_source_objects_v1',{p_company_id:'00000000-0000-4000-8000-000000000000',p_environment:'test',p_assessment_id:'00000000-0000-4000-8000-000000000000',p_facts_hash:'0'.repeat(64)})
    if(error?.code!=='PGRST202')return
    await new Promise(resolve=>setTimeout(resolve,250))
  }
  throw Error('native_schema_cache_not_ready')
})
afterEach(()=>{utiltsEffects.interruptParsed=false;vi.restoreAllMocks();vi.unstubAllEnvs();utiltsEffects.provider.mockReset()})

it('the actual saved normal Z03 requests both ACKs and persists their pending deadline under a scoped actor',async()=>{
  const startedAt=Date.now(),f=await seed(),finishedAt=Date.now()
  const {data:original,error}=await supabaseService.from('ediel_messages').select('*')
    .eq('id',f.ids.outbound).eq('company_id',f.ids.company).eq('environment','test').single()
  expect(error).toBeNull();expect(original).not.toBeNull()
  expect(original).toMatchObject({direction:'outbound',message_family:'PRODAT',message_code:'Z03',
    requires_contrl:true,requires_aperak:true,contrl_status:'pending',aperak_status:'pending',status:'sent'})
  // Check the rendered envelope and persisted policy independently of the
  // builder/defaults used to originate it. The configured deadline is 30 minutes.
  const unb=tokenizeEdifact(original!.raw_payload!).segments.filter(segment=>segment.tag==='UNB')
  expect(unb).toHaveLength(1);expect(unb[0].elements[9]).toBe('1')
  const deadline=Date.parse(original!.ack_due_at!)
  expect(Number.isFinite(deadline)).toBe(true)
  expect(deadline).toBeGreaterThanOrEqual(startedAt+30*60*1000)
  expect(deadline).toBeLessThanOrEqual(finishedAt+30*60*1000)
  expect(sql(`SELECT jsonb_build_object('admin',EXISTS(SELECT FROM public.admin_users WHERE user_id=${literal(f.ids.actor)}),
    'member',EXISTS(SELECT FROM public.company_memberships WHERE user_id=${literal(f.ids.actor)}
      AND company_id=${literal(f.ids.company)} AND status='active' AND is_active AND accepted_at IS NOT NULL),
    'providerAccepted',EXISTS(SELECT FROM gridex_ediel_transport.attempts WHERE message_id=${literal(f.ids.outbound)}
      AND company_id=${literal(f.ids.company)} AND environment='test' AND classification='accepted'
      AND entered_at IS NOT NULL AND observed_at IS NOT NULL),
    'current',gridex_received_sources.sent_source_is_current_v1(m))
    FROM public.ediel_messages m WHERE id=${literal(f.ids.outbound)} AND company_id=${literal(f.ids.company)}`))
    .toEqual({admin:false,member:true,providerAccepted:true,current:true})
})

it('the semantic runtime key cannot impersonate the actual activation-row key in SQL',async()=>{
  const f=await seed(),decision=await resolveCanonicalRuntimeDecisionWithRegistry(f.original)
  const evidence=decision.validationReport.rulePackEvidence as Record<string,unknown>
  expect(evidence.databaseProfileKey).toBe('PRODAT:Z04:L:26.A:r3')
  expect(evidence.profileKey).not.toBe(evidence.databaseProfileKey)
  const wrongNamespace=structuredClone(decision)
  delete (wrongNamespace.validationReport.rulePackEvidence as Record<string,unknown>).databaseProfileKey
  // The TypeScript adapter already refuses to build such evidence.
  expect(buildReceivedSourceValidationEvidence({original:f.original,validated:f.original,resolvedCompanyId:f.ids.company,decision:wrongNamespace})).toBeNull()
  // SQL must refuse it independently: genuine evidence carries the activation
  // row key; substitute the semantic runtime key in the appended facts.
  const genuine=buildReceivedSourceValidationEvidence({original:f.original,validated:f.original,resolvedCompanyId:f.ids.company,decision})
  expect(genuine).not.toBeNull()
  const facts=JSON.parse(genuine!.factsText) as {rulePackEvidence:Record<string,unknown>}
  expect(facts.rulePackEvidence.profileKey).toBe('PRODAT:Z04:L:26.A:r3')
  facts.rulePackEvidence.profileKey=evidence.profileKey
  const wrong={sourcePayloadHash:genuine!.sourcePayloadHash,factsText:JSON.stringify(facts)}
  const {error}=await supabaseService.rpc('gridex_record_source_validation_v1',{p_company_id:f.ids.company,p_environment:'test',p_source_message_id:f.ids.source,p_source_payload_hash:wrong.sourcePayloadHash,p_facts_text:wrong.factsText})
  expect(error?.code).toBe('23514');expect(error?.message).toBe('received_validation_rule_evidence_unavailable')
  await prepare(f)
})

it.each([false,true])('real HTTP/database owners commit and persist source approval, delegated=%s',async delegated=>{
  const f=await seed(delegated), receipt=await complete(f)
  expect(receipt).toMatchObject({status:'recorded',sourceDisposition:'accepted'})
  const records=stored(f.ids.source);expect(records).toHaveLength(1)
  expect(records[0].facts).toMatchObject({objects:[{disposition:'accepted',party:{receiver:{evidence:{completeness:'exact_count'}},disposition:'accepted'},business:{businessDisposition:'committed'}}]})
  expect(records[0].readsets).toHaveLength(1);expect(records[0].readsets[0].observedAt).toMatch(/\+00:00$/)
  expect(records[0].witnessXid).not.toBeNull();expect(records[0].witnessXid).not.toBe(records[0].createdXid)
  expect(sql(`SELECT jsonb_build_object('switch',sw.status,'supply',sp.status) FROM public.supplier_switch_requests sw JOIN public.customer_supply_periods sp ON sp.source_message_id=sw.inbound_z04_message_id WHERE sw.id=${literal(f.ids.switch)}`)).toEqual({switch:'accepted',supply:'confirmed_by_grid_owner'})
})
it('actual activation writes a switch event bound to the source request tenant',async()=>{
  const f=await seed(true)
  expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'})
  // The mature date belongs to the original rendered Z03 and immutable native
  // confirmation. Mutable date edits cannot manufacture activation authority.
  const result=await finalizeSupplierSwitchExecution(supabaseService,{
    requestId:f.ids.switch,actorUserId:f.ids.actor,executionSource:'manual_admin',
  })
  expect(result.request.status).toBe('completed')
  const event=sql<{id:string;company:string;request:string}>(`SELECT jsonb_build_object(
    'id',id,'company',company_id,'request',switch_request_id)
    FROM public.supplier_switch_events WHERE switch_request_id=${literal(f.ids.switch)}
    AND event_type='execution_completed' ORDER BY created_at DESC LIMIT 1`)
  expect(event).toMatchObject({company:f.ids.company,request:f.ids.switch})
  expect(sql(`SELECT jsonb_build_object('company',company_id,'request',new_fact->>'switch_request_id')
    FROM gridex_correction_process.facts WHERE table_name='supplier_switch_events'
    AND row_id=${literal(event.id)} AND operation='INSERT'`))
    .toEqual({company:f.ids.company,request:f.ids.switch})
})
it('without a successful business callback, native rows cannot grant approval',async()=>{
  const f=await seed(), {session}=await prepare(f)
  expect(await session.finish()).toMatchObject({status:'recorded',sourceDisposition:'not_established'})
  expect(stored(f.ids.source)[0].facts).toMatchObject({objects:[{disposition:'unavailable',business:null,party:null}]})
})
it('a real owner-row change between HTTP reads and append is rejected by SQL',async()=>{
  const f=await seed(),prepared=await prepare(f), originalRpc=supabaseService.rpc.bind(supabaseService)
  vi.spyOn(supabaseService,'rpc').mockImplementation((name,args,options)=>{
    if(name==='gridex_record_source_object_decisions_v1') sql(`UPDATE public.tenant_actor_roles SET role_code='grid_owner' WHERE company_id=${literal(f.ids.company)}`)
    return originalRpc(name,args,options)
  })
  expect(await complete(f,prepared)).toMatchObject({status:'unconfirmed',sourceDisposition:'not_established'})
  expect(stored(f.ids.source)).toEqual([])
})
it('a real second-effect failure rolls back the normal switch transaction and grants no source approval',async()=>{
  const f=await seed(),{session}=await prepare(f)
  sql(`ALTER TABLE public.customer_supply_periods ADD CONSTRAINT e035_native_supply_failure CHECK(company_id<>${literal(f.ids.company)}::uuid)`)
  try {
    await expect(applyInboundBusinessStateMachine({message:f.original,actorUserId:f.ids.actor,matchedSwitchRequestId:f.ids.switch,onSourceSwitchCommitted:session.onSwitchCommitted})).rejects.toBeDefined()
  } finally {sql('ALTER TABLE public.customer_supply_periods DROP CONSTRAINT e035_native_supply_failure')}
  expect(await session.finish()).toMatchObject({sourceDisposition:'not_established'})
  expect(stored(f.ids.source)[0].facts).toMatchObject({objects:[{disposition:'unavailable'}]})
  expect(sql(`SELECT to_jsonb(status) FROM public.supplier_switch_requests WHERE id=${literal(f.ids.switch)}`)).toBe('prepared')
  expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=${literal(f.ids.source)}`)).toBe(0)
})
it('native ACL/scope checks reject a different tenant using otherwise genuine assessment data',async()=>{
  const f=await seed();expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'});const a=stored(f.ids.source)[0]
  const {error}=await supabaseService.rpc('gridex_record_source_object_decisions_v1',{p_company_id:'00000000-0000-4000-8000-000000000999',p_environment:'test',p_source_message_id:f.ids.source,p_source_payload_hash:a.sourceHash,p_canonical_assessment_id:a.canonicalId,p_facts_text:a.factsText})
  expect(error?.code).toBe('23514');expect(stored(f.ids.source)).toHaveLength(1)
})
it('the actual runtime proof serializes in UTC regardless of caller timezone; the former behavior is reproduced',async()=>{
  const f=await seed(true);expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'});const a=stored(f.ids.source)[0]
  const probe=(zone:string,old=false)=>sql<string>(`BEGIN;
    ${old?`ALTER FUNCTION gridex_received_sources.owner_rows_match(text,jsonb,uuid,text,uuid) RESET timezone;
      ALTER FUNCTION gridex_received_sources.object_owner_proof_consistent(jsonb,jsonb,timestamptz) RESET timezone;
      ALTER FUNCTION gridex_received_sources.append_object_assessment(uuid,text,uuid,text,uuid,text) RESET timezone;`:''}
    SET LOCAL timezone=${literal(zone)};
    SET LOCAL ROLE service_role;
    SELECT public.gridex_record_source_object_decisions_v1(${literal(f.ids.company)},'test',${literal(f.ids.source)},${literal(a.sourceHash)},${literal(a.canonicalId)},${literal(a.factsText)})->>'assessmentId' AS assessment_id \\gset
    RESET ROLE;
    SELECT to_jsonb(owner_readsets#>>'{0,observedAt}') FROM gridex_received_sources.object_assessments WHERE id=:'assessment_id'::uuid;
    ROLLBACK;`)
  expect(probe('Europe/Stockholm',true)).not.toMatch(/\+00:00$/)
  for(const zone of ['UTC','Europe/Stockholm','America/New_York'])expect(probe(zone)).toMatch(/\+00:00$/)
  expect(stored(f.ids.source)).toHaveLength(1)
})

async function nativeTimeline(companyId:string,cutoffAt:string) {
  const scope={companyId,environment:'test' as const,cutoffAt}
  const {data,error}=await supabaseService.rpc('gridex_source_object_snapshot_v1',{p_company_id:companyId,p_environment:'test',p_cutoff:cutoffAt})
  expect(error).toBeNull()
  const result=inspectReceivedSourceDecisionTimeline(scope,data)
  expect(result,JSON.stringify(result)).toMatchObject({status:'inspected',authorityStatus:'not_established',selection:'not_performed',marketSupersession:'not_performed'})
  return result
}
it('actual immutable HTTP readsets preserve historical approval across a real unavailable correction',async()=>{
  const f=await seed(true);expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'})
  const cutoff=sql<string>('SELECT to_jsonb(clock_timestamp());')
  const initial=await nativeTimeline(f.ids.company,cutoff)
  expect(initial.sources).toHaveLength(1)
  expect(initial.sources[0].asOf).toMatchObject({recordedDisposition:'accepted',objects:[{disposition:'accepted'}]})
  const priorId=initial.sources[0].asOf!.assessmentId
  const beforeWitness=sql<string>(`SELECT to_jsonb(assessed_at) FROM gridex_received_sources.object_assessments WHERE id=${literal(priorId)};`)
  const earlier=await nativeTimeline(f.ids.company,beforeWitness)
  expect(earlier.sources[0]).toMatchObject({asOf:null,visibility:'incomplete'})
  // A new fresh canonical owner session with NO business callback cannot reuse
  // the already accepted rows. The real append and witness record unavailable.
  const {session}=await prepare(f);expect(await session.finish()).toMatchObject({status:'recorded',sourceDisposition:'not_established'})
  const corrected=await nativeTimeline(f.ids.company,sql<string>('SELECT to_jsonb(clock_timestamp());'))
  expect(corrected.sources[0].asOf).toMatchObject({previousAssessmentId:priorId,recordedDisposition:'unavailable'})
  expect(corrected.sources[0].revisions).toHaveLength(2)
  const repeatedHistorical=await nativeTimeline(f.ids.company,cutoff)
  expect(repeatedHistorical.sources[0].asOf).toEqual(initial.sources[0].asOf)
  expect(repeatedHistorical.sources[0].revisions[1].availability).toBe('after_cutoff')
})
it('actual unwitnessed successor prevents an accepted predecessor being revived',async()=>{
  const f=await seed();expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'})
  const a=stored(f.ids.source)[0]
  const {data,error}=await supabaseService.rpc('gridex_record_source_object_decisions_v1',{p_company_id:f.ids.company,p_environment:'test',p_source_message_id:f.ids.source,p_source_payload_hash:a.sourceHash,p_canonical_assessment_id:a.canonicalId,p_facts_text:a.factsText})
  expect(error).toBeNull()
  const persisted=stored(f.ids.source);expect(persisted).toHaveLength(2)
  const successor=persisted.find(row=>row.assessmentId!==a.assessmentId)
  expect(successor).toBeDefined();expect(successor!.witnessXid).toBeNull()
  // The append RPC returns an integrity receipt, NOT runtime approval or a
  // visibility witness. Assert its exact SQL contract, including no such fields.
  expect(data).toEqual({version:1,assessmentId:successor!.assessmentId,companyId:f.ids.company,environment:'test',sourceMessageId:f.ids.source,sourcePayloadHash:a.sourceHash,canonicalAssessmentId:a.canonicalId,factsHash:a.factsHash})
  // SQL committed, but no separate visibility witness exists for this version.
  const result=await nativeTimeline(f.ids.company,sql<string>('SELECT to_jsonb(clock_timestamp());'))
  expect(result.sources[0]).toMatchObject({asOf:null,visibility:'incomplete'})
  expect(result.sources[0].revisions).toHaveLength(2)
  expect(result.sources[0].revisions[0].availability).toBe('witnessed_by_cutoff')
  expect(result.sources[0].revisions[1].availability).toBe('not_witnessed_by_cutoff')
})

// Market-structure integration: real canonical registry, actual committed Z04
// owner, full original review, immutable snapshots and comparison. No authority
// or decision is mocked. Fixtures are isolated localhost synthetic entities.
async function reviewed(f:Awaited<ReturnType<typeof seed>>,source:string=f.ids.source,replaces:string|null=null){
 const result=await reviewReceivedStructuralSource({companyId:f.ids.company,environment:'test',sourceMessageId:source,
  reviewerUserId:f.ids.reviewer,confirmedOriginal:true,replacesSourceMessageId:replaces})
 expect(result,JSON.stringify(stored(source).map(row=>row.facts))).toMatchObject({status:'recorded',sourceDisposition:'accepted'})
 return result
}
async function structuralSnapshot(f:Awaited<ReturnType<typeof seed>>,cutoffAt=sql<string>('SELECT to_jsonb(clock_timestamp())')){
 const scope={companyId:f.ids.company,environment:'test' as const,cutoffAt}
 const {data,error}=await supabaseService.rpc('gridex_source_object_snapshot_v1',{p_company_id:f.ids.company,p_environment:'test',p_cutoff:cutoffAt})
 expect(error).toBeNull();const result=inspectStructuralReadset(scope,data)
 expect(result.timeline,JSON.stringify(result.timeline)).toMatchObject({status:'inspected',boundedReadComplete:true})
 return result
}
async function insertPriorUtilts(f:Awaited<ReturnType<typeof seed>>,raw:string,code:'E66'|'E30'|'S07'='E66'){
 const original=utiltsNativeSourceFixture(scopedWire(f,raw),randomUUID())
 const {id,parsed}=original
 // The grid-owner issuer named in NAD+MS holds an approved issuer/mandate version.
 const issuer=/NAD\+MS\+([0-9]+):/.exec(original.raw)?.[1]
 expect(issuer).toBeDefined();registerUtiltsIssuer(sql,literal,issuer!,f.ids.actor)
 sql(`INSERT INTO public.ediel_messages(id,company_id,customer_id,site_id,metering_point_id,grid_owner_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,message_received_at,execution_context_snapshot,application_reference,sender_ediel_id,receiver_ediel_id,interchange_reference,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
 SELECT ${literal(id)},${literal(f.ids.company)},${literal(f.ids.customer)},${literal(f.ids.site)},${literal(f.ids.point)},${literal(f.ids.grid)},'test','inbound','edifact','UTILTS',${literal(code)},'received',${literal(original.raw)},'{}',${literal(code==='E66'?S('2026-09-30T20:00:00Z'):S('2026-10-01T20:00:00Z'))},'{}',${literal(parsed.applicationReference)},${literal(f.receiver)},${literal(f.sender)},${literal(parsed.interchangeReference)},pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile
 FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id
 WHERE profile.message_code=${literal(code)} AND profile.direction IN ('inbound','both') AND profile.is_enabled ORDER BY profile.profile_key LIMIT 1;`)
 const {data,error}=await supabaseService.from('ediel_messages').select('*').eq('id',id).single()
 expect(error).toBeNull();expect(data).not.toBeNull()
 // Production reception records the interchange's technical syntax decision
 // before any business processing or reply read.
 await recordUtiltsTechnicalReception(data as unknown as EdielMessageRow,f.ids.actor)
 seedUtiltsIssuerHistoryGround(sql,literal,id,f.ids.actor)
 return data as unknown as EdielMessageRow
}
/** Active qualification binds its combined read to a genuine inbound message.
 * Persist each synthetic wire before invoking it; no outbound Z03 surrogate. */
function persistUtiltsSubject(f:Awaited<ReturnType<typeof seed>>,message:EdielMessageRow){
 const id=randomUUID(),wire=scopedWire(f,message.raw_payload!)
 sql(`INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,
  status,raw_payload,parsed_payload,message_received_at,application_reference,sender_ediel_id,receiver_ediel_id,
  canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
 SELECT ${literal(id)},${literal(f.ids.company)},'test','inbound','edifact','UTILTS',${literal(message.message_code)},
  'received',${literal(wire)},'{}',clock_timestamp(),${literal(message.application_reference)},
  ${literal(f.receiver)},${literal(f.sender)},pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,
  pack.source_hash,profile.profile
 FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id
 WHERE profile.message_code=${literal(message.message_code)} AND profile.direction IN ('inbound','both')
  AND profile.is_enabled ORDER BY profile.profile_key LIMIT 1;`)
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE id=${literal(id)}
  AND company_id=${literal(f.ids.company)} AND direction='inbound' AND message_family='UTILTS'`)).toBe(1)
 return {...message,id,raw_payload:wire,sender_ediel_id:f.receiver,receiver_ediel_id:f.sender}
}
function priorNativeWire(f:Awaited<ReturnType<typeof seed>>,point:string){
 return nativeTestWire(observationHandoffMessage(S('2026-09-30'),f.ids.company).raw_payload!
  .replaceAll('735999260731000007',point).replaceAll('91100',f.receiver).replaceAll('21660',f.sender)
  // DTM+354:1:802 is a whole-month E66 resolution: keep a whole market month.
  .replaceAll(S('202607010000'),S('202610010000')).replaceAll(S('202608010000'),S('202611010000'))
  .replace('?+0200','?+0100').replaceAll('M-GRIDEX-2607-01','METER-1').replace('QTY+220:11000','QTY+220:10500'))
}
async function captureNativeCorrectionC(f:Awaited<ReturnType<typeof seed>>,point:string){
 const sourceMessageId=randomUUID(),wire=scopedWire(f,closureFixture({reason:'Z24'}).wire.replaceAll('735123456789012345',point))
 sql(`INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key)
  SELECT ${literal(f.ids.reviewer)},${literal(f.ids.company)},id,key FROM public.permissions WHERE key='communication.send'
  ON CONFLICT DO NOTHING;
  INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,
   raw_payload,parsed_payload,message_received_at,application_reference,sender_ediel_id,receiver_ediel_id,
   canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
  SELECT ${literal(sourceMessageId)},${literal(f.ids.company)},'test','inbound','edifact','PRODAT','Z05','received',
   ${literal(wire)},'{"subtype":"C"}',clock_timestamp(),'23-DDQ-PRODAT',${literal(f.receiver)},${literal(f.sender)},
   pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile
  FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id
  WHERE profile.profile_key='PRODAT:Z05:C:26.A:r3' AND profile.is_enabled;`)
 expect(await captureCorrectionContext({companyId:f.ids.company,environment:'test',sourceMessageId,
  actorUserId:f.ids.reviewer})).toMatchObject({status:'recorded',disposition:'unreviewed'})
 return sourceMessageId
}
async function insertStructuralChange(f:Awaited<ReturnType<typeof seed>>,code:'Z06'|'Z10',reason:string,document:string,replacement=false){
 const message=structuralOwnerSource(code,reason,document,replacement)
 const external=sql<string>(`SELECT to_jsonb(meter_point_id) FROM public.metering_points WHERE id=${literal(f.ids.point)}`)
 const body=scopedWire(f,message.raw_payload!.replaceAll('735123456789012345',external))
 if(code==='Z10'){
  // Each actual reception needs its own technical interchange. Preserve every
  // business segment, including the correction's document and BGM function.
  const reference=randomUUID().replaceAll('-','').slice(0,14),{una,segments}=tokenizeEdifact(body)
  const headers=segments.filter(segment=>segment.tag==='UNB'),trailers=segments.filter(segment=>segment.tag==='UNZ')
  expect(headers).toHaveLength(1);expect(trailers).toHaveLength(1)
  const replacements=[{segment:headers[0],element:5},{segment:trailers[0],element:2}].map(({segment,element})=>{
   const span=segmentSourceSpan(segment),fields=segment.raw.split(una.dataElementSeparator)
   expect(span).not.toBeNull();expect(fields[element]).toBe('I')
   fields[element]=reference
   return {span:span!,raw:fields.join(una.dataElementSeparator)}
  }).sort((a,b)=>b.span.startOffset-a.span.startOffset)
  let wire=body
  for(const replacement of replacements)wire=wire.slice(0,replacement.span.startOffset)+replacement.raw+wire.slice(replacement.span.endOffset)
  const receivedAt=new Date().toISOString()
  const mail=await seedOriginalMailboxNative(<T>(statement:string)=>sql<T>(statement,true),literal,{
   companyId:f.ids.company,environment:'test',raw:wire,receivedAt,smtpFrom:assertEdielSmtpReadiness().from})
  expect(mail.parsed.messageTypeVersion.associationAssignedCode).toBe('E2SE6A')
  expect(mail.parsed.applicationReference).toBe('23-DDQ-PRODAT');expect(mail.parsed.interchangeReference).toBe(reference)
  const id=sql<string>(`INSERT INTO public.ediel_messages(company_id,customer_id,site_id,metering_point_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,message_received_at,application_reference,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot,inbound_email_message_id,mailbox_message_id,message_version,sender_ediel_id,receiver_ediel_id,interchange_reference)
   SELECT ${literal(f.ids.company)},${literal(f.ids.customer)},${literal(f.ids.site)},${literal(f.ids.point)},'test','inbound','edifact','PRODAT','Z10','received',${literal(wire)},${literal(mail.parsed)}::jsonb,${literal(receivedAt)}::timestamptz,${literal(mail.parsed.applicationReference)},pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile,
    ${literal(mail.inboundEmailMessageId)},${literal(mail.inboundEmailMessageId)},${literal(mail.parsed.messageTypeVersion.associationAssignedCode)},${literal(mail.parsed.senderEdielId)},${literal(mail.parsed.receiverEdielId)},${literal(mail.parsed.interchangeReference)}
   FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id
   WHERE profile.profile_key='PRODAT:Z10:M:26.A:r3' AND profile.is_enabled RETURNING to_jsonb(id);`)
  expect(id).toMatch(/^[a-f0-9-]{36}$/)
  await recordOriginalMailboxNativeReception({companyId:f.ids.company,sourceMessageId:id,actorUserId:f.ids.reviewer,
   inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId,sourcePayloadHash:mail.sourcePayloadHash})
  const original=sql<Record<string,unknown>>(`SELECT to_jsonb(m) FROM public.ediel_messages m WHERE id=${literal(id)} AND company_id=${literal(f.ids.company)};`,true)
  expect(original).toMatchObject({company_id:f.ids.company,customer_id:f.ids.customer,site_id:f.ids.site,metering_point_id:f.ids.point,
   environment:'test',direction:'inbound',message_family:'PRODAT',message_code:'Z10',message_version:'E2SE6A',raw_payload:wire,
   inbound_email_message_id:mail.inboundEmailMessageId,mailbox_message_id:mail.inboundEmailMessageId,
   sender_ediel_id:mail.parsed.senderEdielId,receiver_ediel_id:mail.parsed.receiverEdielId,interchange_reference:reference,
   application_reference:'23-DDQ-PRODAT',rule_profile_key:'PRODAT:Z10:M:26.A:r3',immutable_payload_hash:mail.sourcePayloadHash})
  const receptions=sql<Record<string,unknown>[]>(`SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM gridex_ediel_inbound_receptions.receptions r
   WHERE company_id=${literal(f.ids.company)} AND source_message_id=${literal(id)};`,true)
  expect(receptions).toHaveLength(1)
  expect(receptions[0]).toMatchObject({company_id:f.ids.company,source_message_id:id,environment:'test',actor_user_id:f.ids.reviewer,
   inbound_email_message_id:mail.inboundEmailMessageId,parse_result_id:mail.parseResultId,classification:'first_reception',
   canonical_payload_hash:mail.sourcePayloadHash,received_payload_hash:mail.sourcePayloadHash})
  expect(sql(`SELECT to_jsonb(m.message_received_at=mail.received_at AND r.received_at=mail.received_at
   AND mail.received_at=${literal(receivedAt)}::timestamptz AND mail.raw_edifact_payload=m.raw_payload AND p.raw_payload=m.raw_payload AND p.parse_status='parsed')
   FROM public.ediel_messages m JOIN public.inbound_email_messages mail ON mail.id=m.inbound_email_message_id
   JOIN public.inbound_ediel_parse_results p ON p.id=${literal(mail.parseResultId)} AND p.inbound_email_message_id=mail.id AND p.company_id=m.company_id
   JOIN gridex_ediel_inbound_receptions.receptions r ON r.company_id=m.company_id AND r.source_message_id=m.id
   WHERE m.id=${literal(id)} AND m.company_id=${literal(f.ids.company)};`,true)).toBe(true)
  return id
 }
 const id=sql<string>(`INSERT INTO public.ediel_messages(company_id,customer_id,site_id,metering_point_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,message_received_at,application_reference,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
  SELECT ${literal(f.ids.company)},${literal(f.ids.customer)},${literal(f.ids.site)},${literal(f.ids.point)},'test','inbound','edifact','PRODAT',${literal(code)},'received',${literal(body)},${literal(message.parsed_payload)}::jsonb,clock_timestamp(),'23-DDQ-PRODAT',pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile
  FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id WHERE profile.profile_key=${literal(`PRODAT:${code}:${(message.parsed_payload as Record<string,unknown>).subtype}:26.A:r3`)} AND profile.is_enabled RETURNING to_jsonb(id);`)
 expect(id).toMatch(/^[a-f0-9-]{36}$/);return id
}
it('native full-original Z04 review proves post-ledger coverage without replaying the switch writes',async()=>{
 const f=await seed(false,true);expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'})
 const before=await structuralSnapshot(f);expect(before.versions[0].coverage).toBeNull()
 await reviewed(f)
 const result=await structuralSnapshot(f)
 expect(result.versions).toHaveLength(1);expect(result.versions[0]).toMatchObject({disposition:'accepted',coverage:{kind:'post_ledger_supply'}})
 expect(stored(f.ids.source)).toHaveLength(2)
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.customer_supply_periods WHERE source_message_id=${literal(f.ids.source)}`)).toBe(1)
 const wire=utiltsStructureWire({period:S('202610010000202610150000'),meter:'METER-1',ids:['101'],sender:f.receiver,receiver:f.sender}).replaceAll(STRUCTURE_POINT,result.versions[0].wire.object.objectId!)
 expect(compareUtiltsStructure({raw:wire,transactionIndex:0,cutoffAt:result.timeline.cutoffAt??'',ledgerStartedAt:result.timeline.ledgerStartedAt??'',
  readComplete:true,unresolvedSources:result.unresolvedSources,versions:result.versions})).toMatchObject({status:'matched',codes:[]})
})
it('real UTILTS qualification saves and consumes a witnessed C hold without persisting quantities',async()=>{
 const {resolveCanonicalEdielPolicy}=await import('@/lib/ediel/rulebook/canonicalEdielPolicy')
 const {runUtiltsRuntimeForMessage}=await import('@/lib/ediel/utiltsEngine')
 const {qualifyReceivedUtiltsStructure}=await import('@/lib/ediel/utilts/qualifyReceivedStructure')
 const {buildUtiltsTransactionPersistencePayload}=await import('@/lib/ediel/utilts/transactionPersistence')
 const f=await seed(false,true)
 expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'})
 const supplyId=sql<string>(`SELECT to_jsonb(id) FROM public.customer_supply_periods
  WHERE company_id=${literal(f.ids.company)} AND source_message_id=${literal(f.ids.source)}`)
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_correction_process.facts
  WHERE company_id=${literal(f.ids.company)} AND table_name='customer_supply_periods'
   AND row_id=${literal(supplyId)} AND operation='INSERT'
   AND new_fact->>'source_message_id'=${literal(f.ids.source)}`)).toBe(1)
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_correction_process.facts
  WHERE company_id=${literal(f.ids.company)} AND table_name='supplier_switch_requests'
   AND row_id=${literal(f.ids.switch)} AND operation='UPDATE'
   AND new_fact->>'status'='accepted'`)).toBeGreaterThan(0)
 await reviewed(f)
 const point=sql<string>(`SELECT to_jsonb(meter_point_id) FROM public.metering_points WHERE id=${literal(f.ids.point)}`)
 const utilts=observationHandoffMessage(S('2026-10-01'),f.ids.company)
 utilts.sender_ediel_id=f.receiver;utilts.receiver_ediel_id=f.sender
 utilts.raw_payload=utilts.raw_payload!.replaceAll('735999260731000007',point).replaceAll('91100',f.receiver)
  .replaceAll('21660',f.sender).replaceAll(S('202607010000'),S('202610010000'))
  .replaceAll(S('202608010000'),S('202610150000')).replace('?+0200','?+0100').replace('M-GRIDEX-2607-01','METER-1')
 const policy=resolveCanonicalEdielPolicy({family:'UTILTS',messageCode:'E66',direction:'inbound',referenceDate:S('2026-10-01'),
  applicationReference:utilts.application_reference,mode:'parse'})
 const qualify=async()=>{
  const message=persistUtiltsSubject(f,utilts),runtime=runUtiltsRuntimeForMessage(message,{canonicalPolicy:policy})
  expect(runtime.transactionDispositions).toMatchObject([{disposition:'accepted'}])
  return qualifyReceivedUtiltsStructure({message,runtime,canonicalPolicy:policy})
 }
 const before=await qualify()
 expect(before).toMatchObject({hasInternalReview:false,evidence:{comparisons:[{status:'matched'}]}})
 await captureNativeCorrectionC(f,point)
 const held=await qualify()
 expect(held).toMatchObject({hasInternalReview:true,hasNationalMismatch:false,
  evidence:{snapshotId:expect.any(String),readsetHash:expect.stringMatching(/^[a-f0-9]{64}$/),
   comparisons:[{status:'unavailable',reason:'structural_correction_context_hold',codes:[]}]},
  runtime:{transactionDispositions:[{disposition:'internal_review',responseType:'none'}],ackPlan:{shouldSendAperak:false}}})
 expect(buildUtiltsTransactionPersistencePayload({messageCode:'E66',transactions:held.runtime.facts.transactions,
  dispositions:held.runtime.transactionDispositions,matches:[]})[0].quantities).toEqual([])
 expect(sql(`SELECT to_jsonb(readset_hash=${literal(held.evidence.readsetHash)} AND subject_message_id IS NOT NULL)
  FROM gridex_correction_process.combined_snapshots WHERE id=${literal(held.evidence.snapshotId)}`)).toBe(true)
 expect(sql(`SELECT to_jsonb(readset_hash=${literal(before.evidence.readsetHash)})
  FROM gridex_correction_process.combined_snapshots WHERE id=${literal(before.evidence.snapshotId)}`)).toBe(true)
 // Exercise the actual inbound persistence and ACK boundary with the same
 // committed concern. A helper-only qualification cannot prove side effects.
 const {processInboundUtiltsMessage}=await import('@/lib/ediel/flows/utiltsDataRequest.part-2')
 const inbound=await insertPriorUtilts(f,priorNativeWire(f,point))
 utiltsEffects.ack.mockReset().mockImplementation(async({sourceMessage}:{sourceMessage:EdielMessageRow})=>({id:sourceMessage.id}))
 utiltsEffects.meter.mockReset().mockResolvedValue({status:'stored',meteringValue:{id:randomUUID()}})
 const actual=await processInboundUtiltsMessage({actorUserId:f.ids.reviewer,edielMessageId:inbound.id})
 expect(actual).toMatchObject({internalReviewRequired:true,ingestedMeterValueIds:[],billingUnderlayId:null})
 // A transport-level CONTRL is allowed; the blocked transaction must not
 // generate an application ACK or national functional rejection.
 expect(utiltsEffects.ack.mock.calls.map(([call])=>call.ackFamily)).toEqual(['CONTRL'])
 expect(actual.ackIds).toEqual([inbound.id])
 expect(utiltsEffects.meter).not.toHaveBeenCalled()
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.meter_reading_series
  WHERE source_ediel_message_id=${literal(inbound.id)}`)).toBe(0)
 expect(sql(`SELECT to_jsonb(jsonb_build_object('disposition',disposition,'plan',planned_response_type,
  'series',persisted_series_id)) FROM public.ediel_ack_transaction_results
  WHERE source_message_id=${literal(inbound.id)}`)).toMatchObject({disposition:'internal_review',plan:'none',series:null})
 const saved=sql<{snapshotId:string;readsetHash:string}>(`SELECT parsed_payload#>'{normalizedMeteringPayload,receivedStructureQualification}'
  FROM public.ediel_messages WHERE id=${literal(inbound.id)}`)
 expect(saved).toMatchObject({snapshotId:expect.any(String),readsetHash:expect.stringMatching(/^[a-f0-9]{64}$/)})
 expect(sql(`SELECT to_jsonb(readset_hash=${literal(saved.readsetHash)} AND subject_message_id=${literal(inbound.id)})
  FROM gridex_correction_process.combined_snapshots WHERE id=${literal(saved.snapshotId)}`)).toBe(true)
})
it.each(['E30','S07'] as const)('native witnessed C holds a previously matched %s through the active combined receipt',async code=>{
 const {resolveCanonicalEdielPolicy}=await import('@/lib/ediel/rulebook/canonicalEdielPolicy')
 const {runUtiltsRuntimeForMessage}=await import('@/lib/ediel/utiltsEngine')
 const {qualifyReceivedUtiltsStructure}=await import('@/lib/ediel/utilts/qualifyReceivedStructure')
 const {buildUtiltsTransactionPersistencePayload}=await import('@/lib/ediel/utilts/transactionPersistence')
 const f=await seed(false,true);expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'});await reviewed(f)
 const point=sql<string>(`SELECT to_jsonb(meter_point_id) FROM public.metering_points WHERE id=${literal(f.ids.point)}`)
 const utilts=observationHandoffMessage(S('2026-10-01'),f.ids.company)
 utilts.message_code=code;utilts.application_reference=code==='E30'?'23-MDR-E30-T':'23-DDQ-S07-T'
 utilts.sender_ediel_id=f.receiver;utilts.receiver_ediel_id=f.sender
 utilts.raw_payload=code==='E30'
  ?priorE30PointWire('E24','METER-1',point).replaceAll('91100',f.receiver).replaceAll('21660',f.sender)
  :priorNativeWire(f,point).replace('BGM+E66::260','BGM+S07:SVK:260').replaceAll('23-DDQ-E66-S','23-DDQ-S07-T')
 const policy=resolveCanonicalEdielPolicy({family:'UTILTS',messageCode:code,direction:'inbound',referenceDate:S('2026-10-01'),
  applicationReference:utilts.application_reference,mode:'parse'})
 const qualify=async()=>{
  const message=persistUtiltsSubject(f,utilts),runtime=runUtiltsRuntimeForMessage(message,{canonicalPolicy:policy})
  expect(runtime.transactionDispositions,JSON.stringify(runtime.validation.issues)).toMatchObject([{disposition:'accepted'}])
  return qualifyReceivedUtiltsStructure({message,runtime,canonicalPolicy:policy})
 }
 const before=await qualify()
 expect(before).toMatchObject({hasInternalReview:false,hasNationalMismatch:false,evidence:{comparisons:[{status:'matched',codes:[]}]}})
 await captureNativeCorrectionC(f,point)
 const held=await qualify()
 expect(held).toMatchObject({hasInternalReview:true,hasNationalMismatch:false,
  evidence:{snapshotId:expect.any(String),readsetHash:expect.stringMatching(/^[a-f0-9]{64}$/),
   comparisons:[{status:'unavailable',reason:'structural_correction_context_hold',codes:[]}]},
  runtime:{transactionDispositions:[{disposition:'internal_review',responseType:'none'}],ackPlan:{shouldSendAperak:false}}})
 expect(buildUtiltsTransactionPersistencePayload({messageCode:code,transactions:held.runtime.facts.transactions,
  dispositions:held.runtime.transactionDispositions,matches:[]})[0].quantities).toEqual([])
 expect(sql(`SELECT to_jsonb(readset_hash=${literal(held.evidence.readsetHash)} AND subject_message_id IS NOT NULL)
  FROM gridex_correction_process.combined_snapshots WHERE id=${literal(held.evidence.snapshotId)}`)).toBe(true)
 expect(sql(`SELECT to_jsonb(readset_hash=${literal(before.evidence.readsetHash)})
  FROM gridex_correction_process.combined_snapshots WHERE id=${literal(before.evidence.snapshotId)}`)).toBe(true)
 const {processInboundUtiltsMessage}=await import('@/lib/ediel/flows/utiltsDataRequest.part-2')
 // E30 (collected metering) is addressed to the grid-owner role in the
 // catalog edition; the receiving tenant also holds that role.
 if(code==='E30')sql(`INSERT INTO public.tenant_actor_roles(company_id,environment,actor_id,role_code,valid_from)
  SELECT company_id,environment,actor_id,'grid_owner',clock_timestamp()-interval '1 day' FROM public.tenant_actor_roles
  WHERE company_id=${literal(f.ids.company)} AND role_code='electricity_supplier' AND valid_to IS NULL`)
 const inbound=await insertPriorUtilts(f,utilts.raw_payload!,code)
 utiltsEffects.ack.mockReset().mockImplementation(async({sourceMessage}:{sourceMessage:EdielMessageRow})=>({id:sourceMessage.id}))
 utiltsEffects.meter.mockReset().mockResolvedValue({status:'stored',meteringValue:{id:randomUUID()}})
 const actual=await processInboundUtiltsMessage({actorUserId:f.ids.reviewer,edielMessageId:inbound.id})
 expect(actual).toMatchObject({internalReviewRequired:true,ingestedMeterValueIds:[],billingUnderlayId:null})
 expect(utiltsEffects.ack.mock.calls.map(([call])=>call.ackFamily)).toEqual(['CONTRL'])
 expect(utiltsEffects.meter).not.toHaveBeenCalled()
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.meter_reading_series
  WHERE source_ediel_message_id=${literal(inbound.id)}`)).toBe(0)
 expect(sql(`SELECT to_jsonb(jsonb_build_object('disposition',disposition,'plan',planned_response_type,
  'series',persisted_series_id)) FROM public.ediel_ack_transaction_results
  WHERE source_message_id=${literal(inbound.id)}`)).toMatchObject({disposition:'internal_review',plan:'none',series:null})
})
it.each([S('2026-09-30'),S('2026-10-01')])('native reviewed Z04 qualifies prior/current E61/E62 on policy date %s',async referenceDate=>{
 const {resolveCanonicalEdielPolicy}=await import('@/lib/ediel/rulebook/canonicalEdielPolicy')
 const {runUtiltsRuntimeForMessage}=await import('@/lib/ediel/utiltsEngine')
 const {qualifyReceivedUtiltsStructure}=await import('@/lib/ediel/utilts/qualifyReceivedStructure')
 const {buildUtiltsTransactionPersistencePayload}=await import('@/lib/ediel/utilts/transactionPersistence')
 const f=await seed(false,true)
 expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'})
 const original=observationHandoffMessage(referenceDate,f.ids.company)
 original.sender_ediel_id=f.receiver;original.receiver_ediel_id=f.sender
 const point=sql<string>(`SELECT to_jsonb(meter_point_id) FROM public.metering_points WHERE id=${literal(f.ids.point)}`)
 original.raw_payload=original.raw_payload!.replaceAll('735999260731000007',point).replaceAll('91100',f.receiver).replaceAll('21660',f.sender)
  .replaceAll(S('202607010000'),S('202610010000')).replaceAll(S('202608010000'),S('202610150000'))
  .replace('?+0200','?+0100').replaceAll('M-GRIDEX-2607-01','METER-1')
  .replace('QTY+220:11000','QTY+220:10500')
 const canonicalPolicy=resolveCanonicalEdielPolicy({family:'UTILTS',messageCode:'E66',direction:'inbound',referenceDate,
  applicationReference:original.application_reference,mode:'parse'})
 const qualify=async(raw:string)=>{
  const message=persistUtiltsSubject(f,{...original,raw_payload:raw})
  const runtime=runUtiltsRuntimeForMessage(message,{canonicalPolicy})
  expect(runtime.transactionDispositions,JSON.stringify(runtime.validation.issues)).toMatchObject([{disposition:'accepted'}])
  return qualifyReceivedUtiltsStructure({message,runtime,canonicalPolicy})
 }
 const pending=await qualify(original.raw_payload!)
 expect(pending).toMatchObject({hasInternalReview:true,hasNationalMismatch:false,
  runtime:{transactionDispositions:[{disposition:'internal_review',responseType:'none'}],ackPlan:{shouldSendAperak:false}}})
 expect(buildUtiltsTransactionPersistencePayload({messageCode:'E66',transactions:pending.runtime.facts.transactions,
  dispositions:pending.runtime.transactionDispositions,matches:[]})[0].quantities).toEqual([])
 await reviewed(f)
 const matched=await qualify(original.raw_payload!)
 expect(matched).toMatchObject({evidence:{comparisons:[{status:'matched',codes:[]}]},runtime:{transactionDispositions:[{disposition:'accepted'}]}})
 const meter=await qualify(original.raw_payload!.replaceAll('METER-1','WRONG-METER'))
 expect(meter).toMatchObject({hasNationalMismatch:true,hasInternalReview:false,evidence:{comparisons:[{status:'mismatch',codes:['E61']}]}})
 const register=await qualify(original.raw_payload!.replaceAll('RFF+AES:101','RFF+AES:901'))
 expect(register).toMatchObject({hasNationalMismatch:true,hasInternalReview:false,evidence:{comparisons:[{status:'mismatch',codes:['E62']}]}})
 for(const membership of ['missing','excess'] as const){
  expect(await qualify(priorE66MembershipWire(original.raw_payload!,membership))).toMatchObject({hasNationalMismatch:true,
   hasInternalReview:false,evidence:{comparisons:[{status:'mismatch',codes:['E62']}]}})
 }
 expect((await structuralSnapshot(f,pending.evidence.cutoffAt!)).versions[0].coverage).toBeNull()
 if(referenceDate===S('2026-09-30')){
  const savedCutoff=matched.evidence.cutoffAt!,approved=stored(f.ids.source).at(-1)!
  const unknownRoot=original.raw_payload!.replaceAll(point,'735999260731999998')
  expect(await qualify(unknownRoot)).toMatchObject({hasInternalReview:true,hasNationalMismatch:false,
   evidence:{comparisons:[{status:'unavailable',codes:[]}]}})
  const beforeLedger=original.raw_payload!.replaceAll(S('202610010000'),S('202609010000'))
   .replaceAll(S('202610150000'),S('202610010000'))
  expect(await qualify(beforeLedger)).toMatchObject({hasInternalReview:true,hasNationalMismatch:false,
   evidence:{comparisons:[{status:'unavailable',codes:[]}]}})
  // Compose against the latest approved assessment; its saved facts name the
  // preceding baseline and are correctly rejected if replayed as a successor.
  // Let the real append complete, then withhold only the separate witness.
  const originalRpc=supabaseService.rpc.bind(supabaseService)
  const witnessFailure=vi.spyOn(supabaseService,'rpc').mockImplementation((name,args,options)=>
   originalRpc(name,name==='gridex_witness_source_objects_v1'?{...args,p_facts_hash:'0'.repeat(64)}:args,options))
  try{
   expect(await reviewReceivedStructuralSource({companyId:f.ids.company,environment:'test',sourceMessageId:f.ids.source,
    reviewerUserId:f.ids.reviewer,confirmedOriginal:true,replacesSourceMessageId:null})).toMatchObject({status:'unconfirmed'})
  }finally{witnessFailure.mockRestore()}
  const revisions=stored(f.ids.source)
  expect(revisions).toHaveLength(3)
  expect(revisions.at(-1)!.witnessXid).toBeNull()
  expect(revisions.at(-1)!.facts).toMatchObject({objects:[{disposition:'accepted',business:{baselineCurrentAssessmentId:approved.assessmentId}}]})
  expect(await qualify(original.raw_payload!)).toMatchObject({hasInternalReview:true,hasNationalMismatch:false,
   runtime:{transactionDispositions:[{disposition:'internal_review',responseType:'none'}]}})
  expect((await structuralSnapshot(f,savedCutoff)).versions[0]).toMatchObject({disposition:'accepted'})
 }
})
it('native latest witnessed unavailable review holds prior policy despite an older accepted Z04',async()=>{
 const f=await seed(false,true);expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'});await reviewed(f)
 const accepted=await structuralSnapshot(f)
 const prepared=await prepare(f)
 expect(await prepared.session.finish()).toMatchObject({status:'recorded',sourceDisposition:'not_established'})
 const current=await structuralSnapshot(f)
 expect(current.versions.find(version=>version.sourceMessageId===f.ids.source)?.disposition).not.toBe('accepted')
 expect((await structuralSnapshot(f,accepted.timeline.cutoffAt!)).versions[0]).toMatchObject({disposition:'accepted'})
 const wire=utiltsStructureWire({period:S('202610010000202610150000'),meter:'WRONG',ids:['901'],sender:f.receiver,receiver:f.sender,point:accepted.versions[0].wire.object.objectId!})
 expect(compareUtiltsStructure({raw:wire,transactionIndex:0,cutoffAt:current.timeline.cutoffAt!,ledgerStartedAt:current.timeline.ledgerStartedAt!,
  readComplete:current.timeline.boundedReadComplete,unresolvedSources:current.unresolvedSources,versions:current.versions})).toMatchObject({status:'unavailable',codes:[]})
})
it.each(['missing','matched','E61','E62'] as const)('native prior %s traverses real processor persistence and ACK boundary',async outcome=>{
 const {processInboundUtiltsMessage}=await import('@/lib/ediel/flows/utiltsDataRequest.part-2')
 const f=await seed(false,true);expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'})
 const point=sql<string>(`SELECT to_jsonb(meter_point_id) FROM public.metering_points WHERE id=${literal(f.ids.point)}`)
 if(outcome!=='missing')await reviewed(f)
 let raw=priorNativeWire(f,point)
 if(outcome==='E61')raw=raw.replaceAll('METER-1','WRONG-METER')
 if(outcome==='E62')raw=raw.replaceAll('RFF+AES:101','RFF+AES:901')
 const source=await insertPriorUtilts(f,raw)
 const selectedPolicy=resolveCanonicalMessagePolicy(source)
 expect(selectedPolicy).toMatchObject({family:'UTILTS',code:'E66',referenceDate:S('2026-09-30')})
 const {runUtiltsRuntimeForMessage}=await import('@/lib/ediel/utiltsEngine')
 expect(runUtiltsRuntimeForMessage(source,{canonicalPolicy:selectedPolicy!}).transactionDispositions).toMatchObject([{disposition:'accepted'}])
 utiltsEffects.ack.mockReset().mockImplementation(async({sourceMessage}:{sourceMessage:EdielMessageRow})=>({id:sourceMessage.id}))
 utiltsEffects.meter.mockReset().mockResolvedValue({status:'stored',meteringValue:{id:randomUUID()}})
 const result=await processInboundUtiltsMessage({actorUserId:f.ids.reviewer,edielMessageId:source.id})
 const rows=sql<{disposition:string;plan:string;final:string|null;series:string|null;issues:string[]}[]>(`SELECT coalesce(jsonb_agg(jsonb_build_object('disposition',disposition,'plan',planned_response_type,'final',final_response_type,'series',persisted_series_id,'issues',issue_codes)),'[]') FROM public.ediel_ack_transaction_results WHERE source_message_id=${literal(source.id)}`)
 expect(rows).toHaveLength(1)
 if(outcome==='missing'){
  expect(result.internalReviewRequired).toBe(true)
  expect(rows[0]).toMatchObject({disposition:'internal_review',plan:'none',final:null,series:null})
  expect(result.ingestedMeterValueIds).toEqual([])
  expect(utiltsEffects.ack.mock.calls.every(([call])=>call.ackFamily==='CONTRL')).toBe(true)
  expect(utiltsEffects.meter).not.toHaveBeenCalled()
 }else if(outcome==='matched'){
  expect(rows[0],JSON.stringify({rows,result:{internal:result.internalReviewRequired,issues:(result as {validationIssues?:unknown}).validationIssues}})).toMatchObject({disposition:'accepted',plan:'positive_aperak'})
  expect(rows[0].series).not.toBeNull()
  expect(utiltsEffects.ack.mock.calls.some(([call])=>call.ackFamily==='APERAK')).toBe(true)
 }else{
  expect(rows[0]).toMatchObject({disposition:'processability_rejected',plan:'utilts_err',series:null})
  expect(rows[0].issues.join('|')).toContain(outcome)
  expect(utiltsEffects.ack.mock.calls.some(([call])=>call.ackFamily==='UTILTS_ERR')).toBe(true)
  expect(utiltsEffects.ack.mock.calls.some(([call])=>call.ackFamily==='APERAK')).toBe(false)
  expect(utiltsEffects.meter).not.toHaveBeenCalled()
 }
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.meter_reading_series WHERE source_ediel_message_id=${literal(source.id)}`)).toBe(outcome==='matched'?1:0)
 if(outcome==='missing'){
  await reviewed(f)
  utiltsEffects.ack.mockClear()
  await processInboundUtiltsMessage({actorUserId:f.ids.reviewer,edielMessageId:source.id})
  expect(sql(`SELECT jsonb_build_object('disposition',disposition,'plan',planned_response_type,'series',persisted_series_id) FROM public.ediel_ack_transaction_results WHERE source_message_id=${literal(source.id)}`)).toMatchObject({disposition:'accepted',plan:'positive_aperak',series:expect.any(String)})
  expect(utiltsEffects.ack.mock.calls.some(([call])=>call.ackFamily==='APERAK')).toBe(true)
 }
 if(outcome==='matched'){
  // Successful retry re-finalizes the same response and legitimately updates
  // only these two administrative timestamps on the ACK reservation row.
  const stable=()=>sql(`SELECT jsonb_build_object('acks',(SELECT jsonb_agg(to_jsonb(a)-'finalized_at'-'updated_at') FROM public.ediel_ack_transaction_results a WHERE source_message_id=${literal(source.id)}),
   'series',(SELECT jsonb_agg(to_jsonb(s)) FROM public.meter_reading_series s WHERE source_ediel_message_id=${literal(source.id)}),
   'contracts',(SELECT jsonb_agg(to_jsonb(c)) FROM gridex_utilts_binding.contracts c WHERE source_message_id=${literal(source.id)}))`)
  const stored=stable()
  await processInboundUtiltsMessage({actorUserId:f.ids.reviewer,edielMessageId:source.id})
  expect(stable()).toEqual(stored)
 }
})
it('unrelated process volume does not exhaust a linked UTILTS subject budget',async()=>{
 const {processInboundUtiltsMessage}=await import('@/lib/ediel/flows/utiltsDataRequest.part-2')
 const f=await seed(false,true);expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'});await reviewed(f)
 const otherCustomer=randomUUID()
 const point=sql<string>(`SELECT to_jsonb(meter_point_id) FROM public.metering_points WHERE id=${literal(f.ids.point)}`)
 sql(`INSERT INTO public.customers(id,company_id,customer_number,name,customer_type)
  VALUES(${literal(otherCustomer)},${literal(f.ids.company)},${literal(`E035-OTHER-${otherCustomer}`)},'Unrelated native customer','private');
  INSERT INTO public.customer_operation_tasks(company_id,customer_id,task_type,title,status)
  SELECT ${literal(f.ids.company)},${literal(otherCustomer)},'follow_up','Unrelated process volume','open'
  FROM generate_series(1,1001);`)
 // Events carry only a request ID. Their immutable request owner must be
 // resolved before the process budget, including at actual inbound execution.
 sql(`INSERT INTO public.supplier_switch_requests(company_id,customer_id,request_type,status)
  SELECT ${literal(f.ids.company)},${literal(otherCustomer)},'switch','draft'
  FROM generate_series(1,1001);`)
 sql(`INSERT INTO public.supplier_switch_events(company_id,switch_request_id,event_type)
  SELECT ${literal(f.ids.company)},id,'native_unrelated'
  FROM public.supplier_switch_requests WHERE company_id=${literal(f.ids.company)}
   AND customer_id=${literal(otherCustomer)};`)
 const otherPoint=randomUUID(),otherSwitch=randomUUID(),otherEvent=randomUUID()
 sql(`INSERT INTO public.metering_points(id,company_id,customer_id,site_id,customer_site_id,
   metering_point_id,meter_point_id,reading_frequency,measurement_type,is_settlement_relevant,grid_owner_id)
  VALUES(${literal(otherPoint)},${literal(f.ids.company)},${literal(f.ids.customer)},
   ${literal(f.ids.site)},${literal(f.ids.site)},'735999260731000009','735999260731000009',
   'hourly','consumption',true,${literal(f.ids.grid)});
  INSERT INTO public.supplier_switch_requests(id,company_id,customer_id,metering_point_id,request_type,status)
  VALUES(${literal(otherSwitch)},${literal(f.ids.company)},${literal(f.ids.customer)},
   ${literal(otherPoint)},'switch','draft');
  INSERT INTO public.supplier_switch_events(id,company_id,switch_request_id,event_type)
  VALUES(${literal(otherEvent)},${literal(f.ids.company)},${literal(otherSwitch)},'native_other_point');`)
 const relevantEvent=randomUUID()
 sql(`INSERT INTO public.supplier_switch_events(id,company_id,switch_request_id,event_type)
  VALUES(${literal(relevantEvent)},${literal(f.ids.company)},${literal(f.ids.switch)},'native_relevant');`)
 const movedCustomerSwitch=randomUUID(),movedPointSwitch=randomUUID()
 const movedCustomerEvent=randomUUID(),movedPointEvent=randomUUID()
 sql(`INSERT INTO public.supplier_switch_requests(id,company_id,customer_id,metering_point_id,request_type,status)
  VALUES(${literal(movedCustomerSwitch)},${literal(f.ids.company)},${literal(f.ids.customer)},
   ${literal(f.ids.point)},'switch','draft'),
   (${literal(movedPointSwitch)},${literal(f.ids.company)},${literal(f.ids.customer)},
   ${literal(f.ids.point)},'switch','draft');
  INSERT INTO public.supplier_switch_events(id,company_id,switch_request_id,event_type)
  VALUES(${literal(movedCustomerEvent)},${literal(f.ids.company)},${literal(movedCustomerSwitch)},'native_moved_customer'),
   (${literal(movedPointEvent)},${literal(f.ids.company)},${literal(movedPointSwitch)},'native_moved_point');`)
 const beforeMove=sql<string>('SELECT to_jsonb(clock_timestamp())')
 sql(`UPDATE public.supplier_switch_requests SET customer_id=${literal(otherCustomer)},metering_point_id=NULL
  WHERE id=${literal(movedCustomerSwitch)};
  UPDATE public.supplier_switch_requests SET metering_point_id=${literal(otherPoint)}
  WHERE id=${literal(movedPointSwitch)};
  UPDATE public.supplier_switch_events SET event_status='success'
  WHERE id IN (${literal(movedCustomerEvent)},${literal(movedPointEvent)});
  DELETE FROM public.supplier_switch_events
  WHERE id IN (${literal(movedCustomerEvent)},${literal(movedPointEvent)});`)
 const priorBody=sql<{factCount:number;reason:string;facts:{rowId:string;operation:string}[]}>(`SELECT
  gridex_correction_process.combined_process_body_v3(${literal(f.ids.company)},
   ${literal(beforeMove)},ARRAY[${literal(f.ids.customer)}]::uuid[],
   ARRAY[${literal(point)}]::text[])`)
 const priorEventScope=sql<boolean>(`SELECT to_jsonb(gridex_correction_process.switch_event_subject_v1(
  ${literal(f.ids.company)},old_fact,new_fact,captured_at,
  ARRAY[${literal(f.ids.customer)}]::uuid[],ARRAY[${literal(point)}]::text[]))
  FROM gridex_correction_process.facts WHERE table_name='supplier_switch_events'
   AND row_id=${literal(movedCustomerEvent)} AND operation='INSERT'`)
 const unrelatedEventScope=sql<boolean>(`SELECT to_jsonb(gridex_correction_process.switch_event_subject_v1(
  ${literal(f.ids.company)},old_fact,new_fact,captured_at,
  ARRAY[${literal(f.ids.customer)}]::uuid[],ARRAY[${literal(point)}]::text[]))
  FROM gridex_correction_process.facts WHERE table_name='supplier_switch_events'
   AND company_id=${literal(f.ids.company)} AND new_fact->>'event_type'='native_unrelated' LIMIT 1`)
 const unrelatedArchive=sql<{requestId:string;eventAt:string;requestFacts:{operation:string;customer:string|null;company:string|null;capturedAt:string}[]}>(`SELECT
  jsonb_build_object('requestId',e.new_fact->>'switch_request_id','eventAt',e.captured_at,
   'requestFacts',(SELECT coalesce(jsonb_agg(jsonb_build_object('operation',r.operation,
    'customer',coalesce(r.new_fact,r.old_fact)->>'customer_id',
    'company',r.company_id,'capturedAt',r.captured_at) ORDER BY r.id),'[]'::jsonb)
    FROM gridex_correction_process.facts r
    WHERE r.table_name='supplier_switch_requests'
     AND r.row_id=(e.new_fact->>'switch_request_id')::uuid))
  FROM gridex_correction_process.facts e WHERE e.table_name='supplier_switch_events'
   AND e.company_id=${literal(f.ids.company)} AND e.new_fact->>'event_type'='native_unrelated' LIMIT 1`)
 expect(priorEventScope).toBe(true)
 expect(unrelatedEventScope).toBe(false)
 expect(sql<boolean>(`SELECT to_jsonb(gridex_correction_process.switch_event_subject_v1(
  ${literal(f.ids.company)},NULL,'{"switch_request_id":"invalid"}'::jsonb,clock_timestamp(),
  ARRAY[${literal(f.ids.customer)}]::uuid[],ARRAY[${literal(point)}]::text[]))`)).toBe(true)
 expect(priorBody.facts.filter(fact=>fact.rowId===movedCustomerEvent).map(fact=>fact.operation),
  JSON.stringify({factCount:priorBody.factCount,reason:priorBody.reason,priorEventScope,
   unrelatedEventScope,unrelatedArchive}))
  .toEqual(['INSERT'])
 const afterBody=sql<{facts:{rowId:string;operation:string}[]}>(`SELECT
  gridex_correction_process.combined_process_body_v3(${literal(f.ids.company)},
   clock_timestamp(),ARRAY[${literal(f.ids.customer)}]::uuid[],
   ARRAY[${literal(point)}]::text[])`)
 for(const eventId of [movedCustomerEvent,movedPointEvent]){
  expect(afterBody.facts.filter(fact=>fact.rowId===eventId).map(fact=>fact.operation))
   .toEqual(['INSERT','UPDATE','DELETE'])
 }
 const unrelatedPoint='735999260731000008'
 const unrelatedWire=scopedWire(f,closureFixture({reason:'Z24'}).wire.replaceAll('735123456789012345',unrelatedPoint))
 // Direct synthetic rows establish volume only. The separate producer tests
 // exercise source and concern capture; this test calls the real UTILTS owner.
 sql(`WITH sources AS (
   INSERT INTO gridex_received_sources.sources(source_message_id,company_id,environment,origin,
    message_code,source_received_at,captured_at,raw_payload,payload_hash,received_context)
   SELECT gen_random_uuid(),${literal(f.ids.company)},'test','database_insert','Z05',
    clock_timestamp()-interval '1 minute',clock_timestamp()-interval '30 seconds',
    ${literal(unrelatedWire)},encode(sha256(convert_to(${literal(unrelatedWire)},'UTF8')),'hex'),'{}'::jsonb
   FROM generate_series(1,1001) RETURNING *
  ) INSERT INTO gridex_received_sources.correction_concerns(source_message_id,company_id,
   environment,source_payload_hash,actor_user_id,source_received_at,source_captured_at,facts,facts_hash)
  SELECT s.source_message_id,s.company_id,s.environment,s.payload_hash,${literal(f.ids.reviewer)},
   s.source_received_at,s.captured_at,body.facts,encode(sha256(convert_to(body.facts::text,'UTF8')),'hex')
  FROM sources s CROSS JOIN LATERAL (SELECT jsonb_build_object('scope',
   jsonb_build_object('objectId',${literal(unrelatedPoint)})) facts) body;`)
 const z06=scopedWire(f,structuralOwnerSource('Z06','E64','UNRELATED-Z06').raw_payload!.replaceAll('735123456789012345',unrelatedPoint))
 const z10=scopedWire(f,structuralOwnerSource('Z10','E58','UNRELATED-Z10').raw_payload!.replaceAll('735123456789012345',unrelatedPoint))
 sql(`INSERT INTO gridex_received_sources.sources(source_message_id,company_id,environment,origin,
   message_code,source_received_at,captured_at,raw_payload,payload_hash,received_context)
  SELECT gen_random_uuid(),${literal(f.ids.company)},'test','database_insert',
   CASE WHEN n<=501 THEN 'Z06' ELSE 'Z10' END,
   clock_timestamp()-interval '1 minute',clock_timestamp()-interval '30 seconds',
   CASE WHEN n<=501 THEN ${literal(z06)} ELSE ${literal(z10)} END,
   encode(sha256(convert_to(CASE WHEN n<=501 THEN ${literal(z06)} ELSE ${literal(z10)} END,'UTF8')),'hex'),
   '{}'::jsonb FROM generate_series(1,1001) n;`)
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.correction_concerns
  WHERE company_id=${literal(f.ids.company)}`)).toBe(1001)
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.sources
  WHERE company_id=${literal(f.ids.company)} AND message_code IN ('Z06','Z10')
   AND scope_point=${literal(unrelatedPoint)}`)).toBe(1001)
 const source=await insertPriorUtilts(f,priorNativeWire(f,point))
 utiltsEffects.ack.mockReset().mockImplementation(async({sourceMessage}:{sourceMessage:EdielMessageRow})=>({id:sourceMessage.id}))
 utiltsEffects.meter.mockReset().mockResolvedValue({status:'stored',meteringValue:{id:randomUUID()}})
 const result=await processInboundUtiltsMessage({actorUserId:f.ids.reviewer,edielMessageId:source.id})
 expect(result.ackIds.length).toBeGreaterThan(0)
 const direct=sql<{snapshotId:string;readsetText:string}>(`SET ROLE service_role;
  SELECT public.gridex_correction_combined_snapshot_v1(${literal(f.ids.company)},'test',
   ${literal(source.id)},clock_timestamp())`)
 const directBody=JSON.parse(direct.readsetText) as {source:{readsetText:string};correction:{count:number};process:{factCount:number}}
 expect((JSON.parse(directBody.source.readsetText) as {sourceCount:number}).sourceCount).toBeLessThan(1000)
 expect(directBody.correction.count).toBe(0)
 expect(directBody.process.factCount).toBeLessThan(1000)
 const receipt=sql<{snapshotId:string;readsetHash:string}>(`SELECT parsed_payload#>'{normalizedMeteringPayload,receivedStructureQualification}'
  FROM public.ediel_messages WHERE id=${literal(source.id)}`)
 expect(receipt).toMatchObject({snapshotId:expect.any(String),readsetHash:expect.stringMatching(/^[a-f0-9]{64}$/)})
 const body=sql<{process:{factCount:number;reason:string;facts:{table:string;rowId:string;operation:string}[]};
  source:{readsetText:string};correction:{count:number}}>(`SELECT readset_text::jsonb
  FROM gridex_correction_process.combined_snapshots WHERE id=${literal(receipt.snapshotId)}`)
 const sourceBody=JSON.parse(body.source.readsetText) as {sourceCount:number;complete:boolean}
 expect(sourceBody).toMatchObject({complete:true})
 expect(sourceBody.sourceCount).toBeLessThan(1000)
 expect(body.correction.count).toBe(0)
 expect(body.process.factCount).toBeLessThan(1000)
 expect(body.process.reason).toBe('before_epoch_unknown')
 expect(body.process.facts).toContainEqual(expect.objectContaining({table:'supplier_switch_events',rowId:relevantEvent}))
 expect(body.process.facts.filter(fact=>fact.table==='supplier_switch_events'&&fact.rowId===relevantEvent)).toHaveLength(1)
 for(const eventId of [movedCustomerEvent,movedPointEvent]){
  expect(body.process.facts.filter(fact=>fact.table==='supplier_switch_events'&&fact.rowId===eventId)
   .map(fact=>fact.operation)).toEqual(['INSERT','UPDATE','DELETE'])
 }
 expect(body.process.facts.some(fact=>fact.rowId===otherEvent)).toBe(false)
 const supplyId=sql<string>(`SELECT to_jsonb(id) FROM public.customer_supply_periods
  WHERE company_id=${literal(f.ids.company)} AND source_message_id=${literal(f.ids.source)}`)
 expect(body.process.facts).toContainEqual(expect.objectContaining({table:'customer_supply_periods',rowId:supplyId}))
 const unrelatedTaskIds=new Set(sql<string[]>(`SELECT to_jsonb(array_agg(id::text))
  FROM public.customer_operation_tasks WHERE customer_id=${literal(otherCustomer)}`))
 expect(unrelatedTaskIds.size).toBe(1001)
 expect(body.process.facts.some(fact=>fact.table==='customer_operation_tasks'&&unrelatedTaskIds.has(fact.rowId))).toBe(false)
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.meter_reading_series WHERE source_ediel_message_id=${literal(source.id)}`)).toBe(1)
})
it('duplicate, misplaced and incomplete envelopes remain unknown source wildcards',async()=>{
 const f=await seed(false,true);expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'})
 const point=sql<string>(`SELECT to_jsonb(meter_point_id) FROM public.metering_points WHERE id=${literal(f.ids.point)}`)
 const unrelatedPoint='735999260731000008',sourceIds=[randomUUID(),randomUUID(),randomUUID()]
 const valid=scopedWire(f,closureFixture({reason:'Z24'}).wire.replaceAll('735123456789012345',unrelatedPoint))
 expect(sql<string>(`SELECT to_jsonb(gridex_received_sources.source_wire_point_v1(${literal(valid)}))`)).toBe(unrelatedPoint)
 const header=valid.match(/UNH\+[^']+'/)?.[0]
 expect(header).toBeTruthy()
 const duplicate=valid.replace(header!,header!+header!).replace(/UNT\+(\d+)\+M'/,
  (_,count:string)=>`UNT+${Number(count)+1}+M'`)
 const bgm=valid.match(/BGM\+[^']+'/)?.[0]
 const line=valid.match(/LIN\+[^']+'/)?.[0]
 expect(bgm).toBeTruthy();expect(line).toBeTruthy()
 const misplaced=valid.replace(bgm!,'').replace(line!,line!+bgm!)
 const missingFamily=valid.replace(header!,'UNH+M\'')
 for(const [i,malformed] of [duplicate,misplaced,missingFamily].entries()){
  expect(malformed).not.toBe(valid)
  expect(sql(`SELECT jsonb_build_object('point',gridex_received_sources.source_wire_point_v1(${literal(malformed)}))`)).toEqual({point:null})
  sql(`INSERT INTO gridex_received_sources.sources(source_message_id,company_id,environment,origin,
   message_code,source_received_at,captured_at,raw_payload,payload_hash,received_context)
   VALUES(${literal(sourceIds[i])},${literal(f.ids.company)},'test','database_insert','Z05',
    clock_timestamp()-interval '1 minute',clock_timestamp()-interval '30 seconds',
    ${literal(malformed)},encode(sha256(convert_to(${literal(malformed)},'UTF8')),'hex'),'{}'::jsonb);`)
  expect(sql(`SELECT jsonb_build_object('point',scope_point) FROM gridex_received_sources.sources
   WHERE source_message_id=${literal(sourceIds[i])}`)).toEqual({point:null})
 }
 const subject=await insertPriorUtilts(f,priorNativeWire(f,point))
 const receipt=sql<{readsetText:string}>(`SET ROLE service_role;
  SELECT public.gridex_correction_combined_snapshot_v1(${literal(f.ids.company)},'test',
   ${literal(subject.id)},clock_timestamp())`)
 const body=JSON.parse(receipt.readsetText) as {source:{readsetText:string}}
 const selected=JSON.parse(body.source.readsetText) as {
  complete:boolean;sources:{sourceMessageId:string}[]}
 expect(selected.complete).toBe(true)
 for(const sourceId of sourceIds)expect(selected.sources).toContainEqual(expect.objectContaining({sourceMessageId:sourceId}))
})
it('unrelated document volume does not exhaust a linked UTILTS subject budget',async()=>{
 const {processInboundUtiltsMessage}=await import('@/lib/ediel/flows/utiltsDataRequest.part-2')
 const f=await seed(false,true);expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'});await reviewed(f)
 const otherCustomer=randomUUID(),contract=randomUUID(),document=randomUUID(),otherSource=randomUUID()
 const unrelatedPoint='735999260731000008'
 const wire=scopedWire(f,closureFixture({reason:'Z24'}).wire.replaceAll('735123456789012345',unrelatedPoint))
 const facts=JSON.stringify({scope:{objectId:unrelatedPoint}})
 sql(`INSERT INTO public.customers(id,company_id,customer_number,name,customer_type)
  VALUES(${literal(otherCustomer)},${literal(f.ids.company)},${literal(`E035-DOC-${otherCustomer}`)},'Unrelated document customer','private');
  INSERT INTO public.customer_contracts(id,company_id,customer_id,status)
  VALUES(${literal(contract)},${literal(f.ids.company)},${literal(otherCustomer)},'draft');
  INSERT INTO public.customer_contract_documents(id,company_id,customer_contract_id,document_type,document_sha256)
  VALUES(${literal(document)},${literal(f.ids.company)},${literal(contract)},'synthetic_unrelated','0'::text || repeat('0',63));
  INSERT INTO gridex_received_sources.sources(source_message_id,company_id,environment,origin,
   message_code,source_received_at,captured_at,raw_payload,payload_hash,received_context)
  VALUES(${literal(otherSource)},${literal(f.ids.company)},'test','database_insert','Z05',
   clock_timestamp()-interval '1 minute',clock_timestamp()-interval '30 seconds',
   ${literal(wire)},encode(sha256(convert_to(${literal(wire)},'UTF8')),'hex'),'{}'::jsonb);
  INSERT INTO gridex_received_sources.correction_concerns(source_message_id,company_id,
   environment,source_payload_hash,actor_user_id,source_received_at,source_captured_at,facts,facts_hash)
  SELECT source_message_id,company_id,environment,payload_hash,${literal(f.ids.reviewer)},
   source_received_at,captured_at,${literal(facts)}::jsonb,
   encode(sha256(convert_to(${literal(facts)}::jsonb::text,'UTF8')),'hex')
  FROM gridex_received_sources.sources WHERE source_message_id=${literal(otherSource)};
  INSERT INTO gridex_received_sources.document_reference_attempts(company_id,environment,
   source_message_id,document_id,actor_user_id,facts,facts_hash)
  SELECT ${literal(f.ids.company)},'test',${literal(otherSource)},${literal(document)},
   ${literal(f.ids.reviewer)},jsonb_build_object('syntheticVolume',n),
   encode(sha256(convert_to(jsonb_build_object('syntheticVolume',n)::text,'UTF8')),'hex')
  FROM generate_series(1,1001) n;`)
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.document_reference_attempts
  WHERE company_id=${literal(f.ids.company)}`)).toBe(1001)
 const point=sql<string>(`SELECT to_jsonb(meter_point_id) FROM public.metering_points WHERE id=${literal(f.ids.point)}`)
 const source=await insertPriorUtilts(f,priorNativeWire(f,point))
 utiltsEffects.ack.mockReset().mockImplementation(async({sourceMessage}:{sourceMessage:EdielMessageRow})=>({id:sourceMessage.id}))
 utiltsEffects.meter.mockReset().mockResolvedValue({status:'stored',meteringValue:{id:randomUUID()}})
 const result=await processInboundUtiltsMessage({actorUserId:f.ids.reviewer,edielMessageId:source.id})
 expect(result.ackIds.length).toBeGreaterThan(0)
 const receipt=sql<{snapshotId:string;readsetHash:string}>(`SELECT parsed_payload#>'{normalizedMeteringPayload,receivedStructureQualification}'
  FROM public.ediel_messages WHERE id=${literal(source.id)}`)
 expect(receipt).toMatchObject({snapshotId:expect.any(String),readsetHash:expect.stringMatching(/^[a-f0-9]{64}$/)})
 const body=sql<{document:{attemptCount:number;attempts:unknown[]};correction:{count:number}}>(`SELECT readset_text::jsonb
  FROM gridex_correction_process.combined_snapshots WHERE id=${literal(receipt.snapshotId)}`)
 expect(body.document).toMatchObject({attemptCount:0,attempts:[]})
 expect(body.correction.count).toBe(0)
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.meter_reading_series
  WHERE source_ediel_message_id=${literal(source.id)}`)).toBe(1)
})
it('relevant source overflow holds the actual inbound processor without business effects',async()=>{
 const {processInboundUtiltsMessage}=await import('@/lib/ediel/flows/utiltsDataRequest.part-2')
 const f=await seed(false,true);expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'});await reviewed(f)
 const point=sql<string>(`SELECT to_jsonb(meter_point_id) FROM public.metering_points WHERE id=${literal(f.ids.point)}`)
 const wire=scopedWire(f,closureFixture({reason:'Z24'}).wire.replaceAll('735123456789012345',point))
 sql(`INSERT INTO gridex_received_sources.sources(source_message_id,company_id,environment,origin,
  message_code,source_received_at,captured_at,raw_payload,payload_hash,received_context)
  SELECT gen_random_uuid(),${literal(f.ids.company)},'test','database_insert','Z05',
   clock_timestamp()-interval '1 minute',clock_timestamp()-interval '30 seconds',
   ${literal(wire)},encode(sha256(convert_to(${literal(wire)},'UTF8')),'hex'),'{}'::jsonb
  FROM generate_series(1,1001);`)
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.sources
  WHERE company_id=${literal(f.ids.company)} AND scope_point=${literal(point)}`)).toBeGreaterThan(1000)
 const inbound=await insertPriorUtilts(f,priorNativeWire(f,point))
 utiltsEffects.ack.mockReset().mockImplementation(async({sourceMessage}:{sourceMessage:EdielMessageRow})=>({id:sourceMessage.id}))
 utiltsEffects.meter.mockReset().mockResolvedValue({status:'stored',meteringValue:{id:randomUUID()}})
 const result=await processInboundUtiltsMessage({actorUserId:f.ids.reviewer,edielMessageId:inbound.id})
 expect(result).toMatchObject({internalReviewRequired:true,ingestedMeterValueIds:[],billingUnderlayId:null})
 expect(utiltsEffects.ack.mock.calls.map(([call])=>call.ackFamily)).toEqual(['CONTRL'])
 expect(utiltsEffects.meter).not.toHaveBeenCalled()
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.meter_reading_series
  WHERE source_ediel_message_id=${literal(inbound.id)}`)).toBe(0)
 const snapshot=sql<{source:{readsetText:string}}>(`SELECT readset_text::jsonb
  FROM gridex_correction_process.combined_snapshots WHERE subject_message_id=${literal(inbound.id)}
  ORDER BY id DESC LIMIT 1`)
 expect(JSON.parse(snapshot.source.readsetText)).toMatchObject({complete:false,sourceCount:1001})
})
it('a failed combined owner read holds actual UTILTS without a national error or meter effect',async()=>{
 const {processInboundUtiltsMessage}=await import('@/lib/ediel/flows/utiltsDataRequest.part-2')
 const f=await seed(false,true);expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'});await reviewed(f)
 const point=sql<string>(`SELECT to_jsonb(meter_point_id) FROM public.metering_points WHERE id=${literal(f.ids.point)}`)
 const inbound=await insertPriorUtilts(f,priorNativeWire(f,point))
 const originalRpc=supabaseService.rpc.bind(supabaseService)
 const failedRead=vi.spyOn(supabaseService,'rpc').mockImplementation((name,args,options)=>{
  if(name==='gridex_correction_combined_snapshot_v1')return {abortSignal:async()=>({data:null,error:{code:'42501',message:'synthetic_combined_owner_unavailable'}})} as unknown as ReturnType<typeof supabaseService.rpc>
  return originalRpc(name,args,options)
 })
 utiltsEffects.ack.mockReset().mockImplementation(async({sourceMessage}:{sourceMessage:EdielMessageRow})=>({id:sourceMessage.id}))
 utiltsEffects.meter.mockReset().mockResolvedValue({status:'stored',meteringValue:{id:randomUUID()}})
 try{
  const result=await processInboundUtiltsMessage({actorUserId:f.ids.reviewer,edielMessageId:inbound.id})
  expect(result).toMatchObject({internalReviewRequired:true,ingestedMeterValueIds:[],billingUnderlayId:null})
 }finally{failedRead.mockRestore()}
 expect(utiltsEffects.ack.mock.calls.map(([call])=>call.ackFamily)).toEqual(['CONTRL'])
 expect(utiltsEffects.meter).not.toHaveBeenCalled()
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.meter_reading_series
  WHERE source_ediel_message_id=${literal(inbound.id)}`)).toBe(0)
 expect(sql(`SELECT jsonb_build_object('disposition',disposition,'plan',planned_response_type,
  'series',persisted_series_id,'issues',issue_codes) FROM public.ediel_ack_transaction_results
  WHERE source_message_id=${literal(inbound.id)}`)).toMatchObject({disposition:'internal_review',plan:'none',series:null,issues:['UTILTS_STRUCTURE_UNAVAILABLE']})
 expect(sql(`SELECT parsed_payload#>'{normalizedMeteringPayload,receivedStructureQualification}'
  FROM public.ediel_messages WHERE id=${literal(inbound.id)}`)).toMatchObject({snapshotId:null,readsetHash:null,
   comparisons:[{status:'unavailable',codes:[]}]})
})
it('a historical inbound point still sees facts from its prior physical alias',async()=>{
 const f=await seed(false,true);expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'})
 const prior=sql<string>(`SELECT to_jsonb(meter_point_id) FROM public.metering_points WHERE id=${literal(f.ids.point)}`)
 const subject=await insertPriorUtilts(f,priorNativeWire(f,prior))
 const oldInsert=sql<number>(`SELECT to_jsonb(id) FROM gridex_correction_process.facts
  WHERE company_id=${literal(f.ids.company)} AND table_name='metering_points'
   AND row_id=${literal(f.ids.point)} AND operation='INSERT'`)
 const next='735999260731000009'
 sql(`UPDATE public.metering_points SET meter_point_id=${literal(next)},metering_point_id=${literal(next)}
  WHERE id=${literal(f.ids.point)} AND company_id=${literal(f.ids.company)}`)
 const cutoff=sql<string>('SELECT to_jsonb(clock_timestamp())')
 const receipt=sql<{readsetText:string}>(`SET ROLE service_role;
  SELECT public.gridex_correction_combined_snapshot_v1(${literal(f.ids.company)},'test',
   ${literal(subject.id)},${literal(cutoff)})`)
 const body=JSON.parse(receipt.readsetText) as {process:{facts:{id:number;rowId:string}[]};source:{readsetText:string}}
 expect(body.process.facts).toContainEqual(expect.objectContaining({id:oldInsert,rowId:f.ids.point}))
 expect((JSON.parse(body.source.readsetText) as {sourceCount:number}).sourceCount).toBeGreaterThan(0)
})
it.each([false,true])('native prior committed %s retry fails closed after newer unavailable review',async interrupted=>{
 const {processInboundUtiltsMessage}=await import('@/lib/ediel/flows/utiltsDataRequest.part-2')
 const f=await seed(false,true);expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'});await reviewed(f)
 const point=sql<string>(`SELECT to_jsonb(meter_point_id) FROM public.metering_points WHERE id=${literal(f.ids.point)}`)
 const source=await insertPriorUtilts(f,priorNativeWire(f,point))
 expect(resolveCanonicalMessagePolicy(source)).toMatchObject({family:'UTILTS',code:'E66',referenceDate:S('2026-09-30')})
 utiltsEffects.ack.mockReset().mockImplementation(async({sourceMessage}:{sourceMessage:EdielMessageRow})=>({id:sourceMessage.id}))
 utiltsEffects.meter.mockReset().mockResolvedValue({status:'stored',meteringValue:{id:randomUUID()}})
 utiltsEffects.interruptParsed=interrupted
 if(interrupted)await expect(processInboundUtiltsMessage({actorUserId:f.ids.reviewer,edielMessageId:source.id})).rejects.toThrow('prior_native_after_persistence_before_ack')
 else await processInboundUtiltsMessage({actorUserId:f.ids.reviewer,edielMessageId:source.id})
 const persisted=()=>sql(`SELECT jsonb_build_object('acks',(SELECT jsonb_agg(to_jsonb(a)) FROM public.ediel_ack_transaction_results a WHERE source_message_id=${literal(source.id)}),
  'series',(SELECT jsonb_agg(to_jsonb(s)) FROM public.meter_reading_series s WHERE source_ediel_message_id=${literal(source.id)}),
  'contracts',(SELECT jsonb_agg(to_jsonb(c)) FROM gridex_utilts_binding.contracts c WHERE source_message_id=${literal(source.id)}),
  'qualification',(SELECT parsed_payload#>'{normalizedMeteringPayload,receivedStructureQualification}' FROM public.ediel_messages WHERE id=${literal(source.id)}))`)
 const before=persisted()
 const saved=await structuralSnapshot(f)
 expect((before as {acks:{disposition:string;final_response_type:string|null}[]}).acks).toMatchObject([{disposition:'accepted',final_response_type:interrupted?null:'positive_aperak'}])
 expect(await (await prepare(f)).session.finish()).toMatchObject({sourceDisposition:'not_established'})
 expect((await structuralSnapshot(f,saved.timeline.cutoffAt!)).versions[0]).toMatchObject({disposition:'accepted'})
 utiltsEffects.ack.mockClear();utiltsEffects.meter.mockClear()
 await expect(processInboundUtiltsMessage({actorUserId:f.ids.reviewer,edielMessageId:source.id})).rejects.toThrow('utilts_committed_transaction_retry_conflict')
 expect(persisted()).toEqual(before)
 expect(utiltsEffects.ack).not.toHaveBeenCalled();expect(utiltsEffects.meter).not.toHaveBeenCalled()
})
it.each([['Z06','E64'],['Z06','E32'],['Z10','E58']] as const)('native full-original %s/%s approval is not partial safe-apply',async(code,reason)=>{
 const f=await seed(false,true);expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'});await reviewed(f)
 const id=await insertStructuralChange(f,code,reason,'CHANGE')
 const {data:received,error:readError}=await supabaseService.from('ediel_messages').select('*').eq('id',id).single()
 expect(readError).toBeNull();expect(received).not.toBeNull()
 const expectedIntent=code==='Z10'?'meter_change_review':'masterdata_update_review'
 const reviewCase=await applyInboundBusinessStateMachine({message:received as unknown as EdielMessageRow,actorUserId:f.ids.actor})
 expect(reviewCase).toMatchObject({outcome:code==='Z10'?'meter_change_received':'masterdata_update_received',reviewRequired:true,updated:['customer_cases']})
 expect(sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('company',company_id,'customer',customer_id,'site',site_id,'point',metering_point_id,
  'type',case_type,'reason',reason_category,'status',status,'title',title,'next',next_action,'source',source,'intent',metadata->>'review_intent')),'[]')
  FROM public.customer_cases WHERE company_id=${literal(f.ids.company)} AND metadata->>'source_ediel_message_id'=${literal(id)}`)).toEqual([{
   company:f.ids.company,customer:f.ids.customer,site:f.ids.site,point:f.ids.point,type:'other',reason:expectedIntent,status:'open',
   title:code==='Z10'?'Mätarbyte mottaget – granska säker uppdatering':'Masterdataändring mottagen – granska säker uppdatering',
   next:'Granska Ediel safe-apply-förslaget innan masterdata ändras.',source:'ediel_inbound_state_machine',intent:expectedIntent,
  }])
 const pending=await structuralSnapshot(f);expect(pending.versions.find(version=>version.sourceMessageId===id)?.disposition).toBe('unavailable')
 await reviewed(f,id)
 const result=await structuralSnapshot(f),version=result.versions.find(item=>item.sourceMessageId===id)
 expect(version).toMatchObject({disposition:'accepted',wire:{messageCode:code},coverage:{baselineSourceMessageId:f.ids.source}})
 if(code==='Z06'&&reason==='E64'){
  const entry=(stored(id).at(-1)!.facts as {objects:{business:Record<string,unknown>;party:Record<string,unknown>}[]}).objects[0]
  const forged={...entry.business,wire:{...(entry.business.wire as object),businessCase:'customer_only'}}
  expect(sql(`SELECT to_jsonb(gridex_received_sources.review_business_proof_consistent(${literal(entry.party)}::jsonb,${literal(forged)}::jsonb,${literal(id)}::uuid));`)).toBe(false)
 }
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.customer_supply_periods WHERE company_id=${literal(f.ids.company)}`)).toBe(1)
})
it('native witnessed Z10 transition selects prior E30 ending/current sides and holds an ambiguous side',async()=>{
 const {resolveCanonicalEdielPolicy}=await import('@/lib/ediel/rulebook/canonicalEdielPolicy')
 const {runUtiltsRuntimeForMessage}=await import('@/lib/ediel/utiltsEngine')
 const {qualifyReceivedUtiltsStructure}=await import('@/lib/ediel/utilts/qualifyReceivedStructure')
 const f=await seed(false,true);expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'});await reviewed(f)
 const id=await insertStructuralChange(f,'Z10','E58','POINT-CHANGE')
 const point=sql<string>(`SELECT to_jsonb(meter_point_id) FROM public.metering_points WHERE id=${literal(f.ids.point)}`)
 const policy=resolveCanonicalEdielPolicy({family:'UTILTS',messageCode:'E30',direction:'inbound',referenceDate:S('2026-09-30'),
  applicationReference:'23-MDR-E30-T',mode:'parse'})
 const qualify=async(reason:'E20'|'E77'|'E24'|'E25'|'E67'|'E64',meter:string)=>{
  const message=observationHandoffMessage(S('2026-09-30'),f.ids.company)
  message.message_code='E30';message.application_reference='23-MDR-E30-T'
  message.sender_ediel_id=f.receiver;message.receiver_ediel_id=f.sender
  message.raw_payload=priorE30PointWire(reason,meter,point).replaceAll('91100',f.receiver).replaceAll('21660',f.sender)
  const persisted=persistUtiltsSubject(f,message)
  const runtime=runUtiltsRuntimeForMessage(persisted,{canonicalPolicy:policy})
  expect(runtime.transactionDispositions,JSON.stringify(runtime.validation.issues)).toMatchObject([{disposition:'accepted'}])
  return qualifyReceivedUtiltsStructure({message:persisted,runtime,canonicalPolicy:policy})
 }
 expect(await qualify('E25','NEW')).toMatchObject({hasInternalReview:true,hasNationalMismatch:false,
  evidence:{comparisons:[{status:'unavailable',codes:[]}]}})
 await reviewed(f,id)
 const snapshot=await structuralSnapshot(f)
 expect(snapshot.versions.find(version=>version.sourceMessageId===id)).toMatchObject({disposition:'accepted',wire:{meterNumber:'NEW'}})
 for(const reason of ['E20','E77','E24'] as const){
  expect(await qualify(reason,'METER-1')).toMatchObject({hasInternalReview:false,hasNationalMismatch:false,
   evidence:{comparisons:[{status:'matched',selected:[{meterNumber:'METER-1'}]}]}})
 }
 for(const reason of ['E25','E67'] as const){
  expect(await qualify(reason,'NEW')).toMatchObject({hasInternalReview:false,hasNationalMismatch:false,
   evidence:{comparisons:[{status:'matched',selected:[{meterNumber:'NEW'}]}]}})
 }
 expect(await qualify('E64','NEW')).toMatchObject({hasInternalReview:true,hasNationalMismatch:false,
  evidence:{comparisons:[{status:'unavailable',codes:[]}]}})
})
it('native Z06/E34 remains unavailable without a qualified death or counterparty bilateral owner',async()=>{
 const f=await seed(false,true);expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'});await reviewed(f)
 const id=await insertStructuralChange(f,'Z06','E34','CUSTOMER')
 const receipt=await reviewReceivedStructuralSource({companyId:f.ids.company,environment:'test',sourceMessageId:id,
  reviewerUserId:f.ids.reviewer,confirmedOriginal:true,replacesSourceMessageId:null})
 expect(receipt).toMatchObject({status:'recorded',sourceDisposition:'not_established'})
 const result=await structuralSnapshot(f)
 expect(result.versions.find(version=>version.sourceMessageId===id)).toMatchObject({disposition:'unavailable'})
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.customer_supply_periods WHERE company_id=${literal(f.ids.company)}`)).toBe(1)
})
it('native BGM5 correction pins an approved predecessor; a later receipt alone is never replacement',async()=>{
 const f=await seed(false,true);expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'});await reviewed(f)
 const prior=await insertStructuralChange(f,'Z10','E58','ORIGINAL');await reviewed(f,prior)
 const correction=await insertStructuralChange(f,'Z10','E58','CORRECTION',true)
 expect(await reviewReceivedStructuralSource({companyId:f.ids.company,environment:'test',sourceMessageId:correction,reviewerUserId:f.ids.reviewer,confirmedOriginal:true,replacesSourceMessageId:null})).toMatchObject({sourceDisposition:'not_established'})
 await reviewed(f,correction,prior)
 const result=await structuralSnapshot(f)
 expect(result.versions.find(version=>version.sourceMessageId===correction)?.replaces).toMatchObject({sourceMessageId:prior,assessmentId:stored(prior)[0].assessmentId})
})
it('native user without company permission cannot create even a canonical-ledger assessment during review',async()=>{
 const f=await seed(false,true);expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'})
 // Review accepts either reviewer permission; remove both.
 sql(`DELETE FROM public.user_permissions WHERE user_id=${literal(f.ids.reviewer)} AND permission_key IN('ediel_testing.write','communication.write');`)
 for(const key of ['ediel_testing.write','communication.write']){
  const permission=await supabaseService.rpc('gridex_actor_has_company_permission',{
   p_actor_user_id:f.ids.reviewer,p_company_id:f.ids.company,p_permission:key,
  })
  expect(permission.error).toBeNull();expect(permission.data).toBe(false)
 }
 const before=sql(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.validation_assessments WHERE source_message_id=${literal(f.ids.source)}`)
 expect(await reviewReceivedStructuralSource({companyId:f.ids.company,environment:'test',sourceMessageId:f.ids.source,reviewerUserId:f.ids.reviewer,confirmedOriginal:true,replacesSourceMessageId:null})).toEqual({status:'unconfirmed',sourceDisposition:'not_established'})
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.validation_assessments WHERE source_message_id=${literal(f.ids.source)}`)).toBe(before)
})

// Closure acceptance uses a real prior reviewed coverage assessment, then the
// real legacy end owner. No hand-built accepted marker is an authority oracle.
async function insertClosure(f:Awaited<ReturnType<typeof seed>>,reason='Z22',minute=S('202610150000')){
 const external=sql<string>(`SELECT to_jsonb(meter_point_id) FROM public.metering_points WHERE id=${literal(f.ids.point)}`)
 const wire=scopedWire(f,closureFixture({reason,minute}).wire.replaceAll('735123456789012345',external))
 const payload={subtype:reason==='Z23'?'LK':'L',end_date:S('2026-10-15'),prodatDependentFacts:{market:'electricity',meterReadingsSentInUtilts:true}}
 const id=sql<string>(`INSERT INTO public.ediel_messages(company_id,customer_id,site_id,metering_point_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,message_received_at,application_reference,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
 SELECT ${literal(f.ids.company)},${literal(f.ids.customer)},${literal(f.ids.site)},${literal(f.ids.point)},'test','inbound','edifact','PRODAT','Z05','received',${literal(wire)},${literal(payload)}::jsonb,clock_timestamp(),'23-DDQ-PRODAT',pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile
 FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id WHERE profile.profile_key=${literal(`PRODAT:Z05:${payload.subtype}:26.A:r3`)} AND profile.is_enabled RETURNING to_jsonb(id);`)
 expect(id).toMatch(/^[a-f0-9-]{36}$/)
 // Production reception captures the source's own rule-pack receipt before
 // the business state machine (lib/ediel/flows/inboundProcessing.ts).
 const {data,error}=await supabaseService.from('ediel_messages').select('*').eq('id',id).single()
 expect(error).toBeNull()
 const message=data as unknown as EdielMessageRow,decision=await resolveCanonicalRuntimeDecisionWithRegistry(message)
 if(decision.syntaxDecision==='accepted'&&decision.policy){
  expect(await recordReceivedSourceValidation({original:message,validated:message,resolvedCompanyId:f.ids.company,decision})).toMatchObject({status:'recorded'})
  await captureFreshEdielSourceRulePackEvidence(f.ids.company,id)
 }
 return message
}
async function closureReview(f:Awaited<ReturnType<typeof seed>>,source:string){
 return reviewReceivedClosureSource({companyId:f.ids.company,environment:'test',sourceMessageId:source,reviewerUserId:f.ids.reviewer,confirmedOriginal:true})
}
type ClosureAppendArgs={p_company_id:string;p_environment:string;p_source_message_id:string;p_source_payload_hash:string;p_canonical_assessment_id:string;p_facts_text:string}
/** Local synthetic native diagnostics only. No original/owner mutation survives
 * the transaction and no guard is removed: false returns become labelled errors. */
function closureSqlDiagnostics(args:ClosureAppendArgs,removeMidnight=false){
 const facts=JSON.parse(args.p_facts_text),entry=facts.objects[0]
 const party=literal(entry.party),business=literal(entry.business),source=literal(args.p_source_message_id)
 return sql<Record<string,unknown>>(`BEGIN;
  CREATE FUNCTION pg_temp.closure_native_trace() RETURNS jsonb LANGUAGE plpgsql AS $trace$
  DECLARE result jsonb; error_code text; error_message text; error_detail text; error_context text;
  BEGIN
   PERFORM gridex_received_sources.append_object_assessment(${literal(args.p_company_id)},${literal(args.p_environment)},${source},${literal(args.p_source_payload_hash)},${literal(args.p_canonical_assessment_id)},${literal(args.p_facts_text)});
   RETURN jsonb_build_object('accepted',true);
  EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS error_code=RETURNED_SQLSTATE,error_message=MESSAGE_TEXT,error_detail=PG_EXCEPTION_DETAIL,error_context=PG_EXCEPTION_CONTEXT;
   RETURN jsonb_build_object('accepted',false,'code',error_code,'message',error_message,'detail',error_detail,'context',left(error_context,3500),
    'frames',(SELECT string_agg(line,E'\n') FROM regexp_split_to_table(error_context,E'\n') frame(line) WHERE line LIKE 'PL/pgSQL function%'));
  END $trace$;
  CREATE TEMP TABLE closure_native_diag(result jsonb);
  INSERT INTO closure_native_diag SELECT jsonb_build_object('append',pg_temp.closure_native_trace(),
   'wireMatches',gridex_received_sources.closure_wire_matches_v1(src.raw_payload,${business}::jsonb->'object',${business}::jsonb->'wire'),
   'partyProof',gridex_received_sources.review_party_proof_consistent(${party}::jsonb,${business}::jsonb,src.source_received_at),
   'closureProof',gridex_received_sources.review_closure_proof_consistent(${party}::jsonb,${business}::jsonb,src.source_message_id),
   'ownerRows',(SELECT jsonb_object_agg(proof_kind,gridex_received_sources.owner_rows_match(proof_kind,proof_rows,${literal(args.p_company_id)},${literal(args.p_environment)},proof_id)) FROM (VALUES
    ('profiles',${party}::jsonb#>'{receiver,evidence,records,profiles}',NULL::uuid),
    ('identifiers',${party}::jsonb#>'{receiver,evidence,records,identifiers}',NULL::uuid),
    ('roles',${party}::jsonb#>'{receiver,evidence,records,roles}',(${party}::jsonb#>>'{receiver,identity,legalActorId}')::uuid),
    ('relations',${party}::jsonb#>'{receiver,evidence,records,relations}',NULL::uuid),
    ('point',jsonb_build_array(${party}::jsonb#>'{facility,meteringPoint}'),(${business}::jsonb->>'meteringPointId')::uuid),
    ('site',jsonb_build_array(${party}::jsonb#>'{facility,site}'),(${business}::jsonb->>'siteId')::uuid),
    ('gridOwner',jsonb_build_array(${party}::jsonb#>'{facility,gridOwner}'),(${party}::jsonb#>>'{facility,gridOwner,id}')::uuid)
   ) proof(proof_kind,proof_rows,proof_id)),
   'snapshotSourceCount',(SELECT jsonb_array_length(snap.readset_text::jsonb->'sources') FROM gridex_received_sources.object_selection_snapshots snap WHERE snap.id=(${business}::jsonb#>>'{reviewSnapshot,snapshotId}')::uuid),
   'baselineEntries',(SELECT jsonb_agg(jsonb_build_object('id',a.id,'witness',w.observed_at,'latest',NOT EXISTS(SELECT FROM gridex_received_sources.object_assessments child WHERE child.previous_assessment_id=a.id),
     'owner',item#>>'{business,owner}','disposition',item->>'disposition','sameSupply',item#>>'{business,supplyPeriodId}'=${business}::jsonb->>'supplyPeriodId',
     'sameCover',item#>'{business,coverageWindow}'=${business}::jsonb->'coverageWindow','parties',item#>'{party,parties}'))
    FROM gridex_received_sources.object_assessments a LEFT JOIN gridex_received_sources.object_availability_witnesses w ON w.assessment_id=a.id
    CROSS JOIN LATERAL jsonb_array_elements(a.facts_text::jsonb->'objects') item
    WHERE a.source_message_id=(${business}::jsonb#>>'{coverageWindow,baselineSourceMessageId}')::uuid))
   FROM gridex_received_sources.sources src WHERE src.source_message_id=${source};
  DO $instrument$ DECLARE definition text; chunks text[]; rebuilt text; i integer; context text;
  BEGIN
   SELECT pg_get_functiondef('gridex_received_sources.review_closure_proof_consistent(jsonb,jsonb,uuid)'::regprocedure) INTO definition;
   ${removeMidnight?`definition:=replace(definition,'OR substring(wire#>>''{effectiveTo,marketMinute}'',9,4) IS DISTINCT FROM ''0000''','OR false');`:''}
   chunks:=string_to_array(definition,'RETURN false;');rebuilt:=chunks[1];
   FOR i IN 2..array_length(chunks,1) LOOP
    context:=right(chunks[i-1],220);
    IF strpos(chunks[i-1],'EXCEPTION WHEN')>0 THEN
     -- Preserve the original caught SQLSTATE/message/line, not a replacement
     -- guard label which would conceal the actual cast/calendar failure.
     rebuilt:=rebuilt||'RAISE;'||chunks[i];
    ELSE
     rebuilt:=rebuilt||format('RAISE EXCEPTION USING MESSAGE=%L, DETAIL=%L;', 'closure_native_guard_'||(i-1)::text,context)||chunks[i];
    END IF;
   END LOOP;
   IF array_length(chunks,1)<10 THEN RAISE EXCEPTION 'closure_native_trace_incomplete'; END IF;
   EXECUTE rebuilt;
  END $instrument$;
  UPDATE closure_native_diag SET result=result||jsonb_build_object('labelledAppend',pg_temp.closure_native_trace(),'midnightRemovedForTrace',${removeMidnight});
  SELECT result FROM closure_native_diag; ROLLBACK;`)
}
async function approvedClosureWithDiagnostics(f:Awaited<ReturnType<typeof seed>>,source:string){
 const attempts:ClosureAppendArgs[]=[],errors:{name:string;code:string;message:string}[]=[]
 const originalRpc=supabaseService.rpc.bind(supabaseService)
 const observe=vi.spyOn(supabaseService,'rpc').mockImplementation((name,args,options)=>{
  if(name==='gridex_record_source_object_decisions_v1')attempts.push(args as ClosureAppendArgs)
  const request=originalRpc(name,args,options),then=request.then.bind(request)
  request.then=((resolve,reject)=>then(response=>{
   if(response.error)errors.push({name,code:response.error.code,message:response.error.message})
   return response
  }).then(resolve,reject)) as typeof request.then
  return request
 })
 let result:Awaited<ReturnType<typeof closureReview>>
 try{result=await closureReview(f,source)}finally{observe.mockRestore()}
 const attempt=attempts.at(-1)
 const diagnostics=result.status==='recorded'&&result.sourceDisposition==='accepted'?null:
  {rpcErrors:errors,attemptedObjects:attempt?JSON.parse(attempt.p_facts_text).objects.map((item:Record<string,unknown>)=>({disposition:item.disposition,reason:item.reason,codes:item.reasonCodes??item.codes,business:item.business===null?null:'present',party:item.party===null?null:'present'})):[],sql:attempt?(()=>{try{return closureSqlDiagnostics(attempt)}catch(error){return {diagnosticsFailed:String(error instanceof Error?error.message:error).slice(0,600)}}})():null}
 expect(result,JSON.stringify(diagnostics)).toMatchObject({status:'recorded',sourceDisposition:'accepted'})
 return result
}
// Z23 is a requested bilateral LK closure: since 20261001085523 it can only
// end our own period as the answer to an actually sent Z08. Without one it is
// refused before any period mutation.
it('native Z23 closure without our sent Z08 is refused and the period keeps its end',async()=>{
 const f=await seed(false,true);expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'});await reviewed(f)
 const before=sql(`SELECT coalesce(jsonb_agg(end_date ORDER BY id),'[]') FROM public.customer_supply_periods WHERE company_id=${literal(f.ids.company)}`)
 const message=await insertClosure(f,'Z23')
 await expect(applyInboundBusinessStateMachine({message,actorUserId:f.ids.actor})).rejects.toMatchObject({message:expect.stringContaining('bilateral_closure_exact_sent_original_required')})
 expect(sql(`SELECT coalesce(jsonb_agg(end_date ORDER BY id),'[]') FROM public.customer_supply_periods WHERE company_id=${literal(f.ids.company)}`)).toEqual(before)
})
it.each(['Z22'])('native %s closure retains immutable Z04 coverage after the real legacy end mutation',async reason=>{
 const f=await seed(false,true);expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'});await reviewed(f)
 const baseline=stored(f.ids.source).at(-1)!,message=await insertClosure(f,reason)
 const ended=await applyInboundBusinessStateMachine({message,actorUserId:f.ids.actor})
 expect(ended.outcome).toBe('supply_terminated')
 expect(ended.updated).toContain('customer_cases')
 expect(sql(`SELECT to_jsonb(EXISTS(SELECT FROM gridex_correction_process.facts
  WHERE company_id=${literal(f.ids.company)} AND table_name='customer_supply_periods'
   AND operation='UPDATE' AND old_fact->>'end_date' IS DISTINCT FROM new_fact->>'end_date'
   AND new_fact->>'end_date'='${S('2026-10-15')}' AND old_fact->>'customer_id'=${literal(f.ids.customer)}
   AND old_fact->>'metering_point_id'=${literal(f.ids.point)}))`)).toBe(true)
 expect(sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('company',company_id,'customer',customer_id,'site',site_id,'point',metering_point_id,
  'type',case_type,'reason',reason_category,'status',status,'title',title,'next',next_action,'source',source,'intent',metadata->>'review_intent')),'[]')
  FROM public.customer_cases WHERE company_id=${literal(f.ids.company)} AND metadata->>'source_ediel_message_id'=${literal(message.id)}`)).toEqual([{
   company:f.ids.company,customer:f.ids.customer,site:f.ids.site,point:f.ids.point,type:'other',reason:'final_metering_and_billing',status:'open',
   title:'Leveransen upphör – slutför mätvärden och fakturering',next:'Kontrollera slutmätvärden och faktureringsberedskap vid angiven giltig sluttid.',
   source:'ediel_inbound_state_machine',intent:'final_metering_and_billing'}])
 // insertClosure already recorded and captured this source in production order.
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(message)
 expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision]).toEqual(['accepted','accepted','accepted'])
 const unreviewed=await structuralSnapshot(f)
 expect(unreviewed.closureBlockers).toHaveLength(1)
 const compare=(snapshot:Awaited<ReturnType<typeof structuralSnapshot>>,period:string,meter='METER-1',ids=['101'])=>compareUtiltsStructure({
  raw:utiltsStructureWire({period,meter,ids,sender:f.receiver,receiver:f.sender,point:snapshot.versions[0].wire.object.objectId!}),transactionIndex:0,
  cutoffAt:snapshot.timeline.cutoffAt!,ledgerStartedAt:snapshot.timeline.ledgerStartedAt!,readComplete:true,
  unresolvedSources:snapshot.unresolvedSources,versions:snapshot.versions,closures:snapshot.closures,closureBlockers:snapshot.closureBlockers})
 expect(compare(unreviewed,S('202610010000202610142359')),JSON.stringify(unreviewed.closureBlockers)).toMatchObject({status:'matched',codes:[]})
 expect(compare(unreviewed,S('202610010000202610150000'))).toMatchObject({status:'unavailable',codes:[]})
 const pending=await approvedClosureWithDiagnostics(f,message.id)
 expect(pending,JSON.stringify(stored(message.id))).toMatchObject({status:'recorded',sourceDisposition:'accepted'})
 const a=stored(message.id).at(-1)!
 expect(a.facts).toMatchObject({objects:[{disposition:'accepted',business:{owner:'reviewed-received-closure-v1',
  legacyEndDateProjection:S('2026-10-15'),wire:{effectiveTo:{marketMinute:S('202610150000'),utc:S('2026-10-14T23:00:00.000Z')}},
  baselineCoverageAssessment:{sourceMessageId:f.ids.source,assessmentId:baseline.assessmentId,factsHash:baseline.factsHash}}}]})
 expect(a.witnessXid).not.toBeNull();expect(a.createdXid).not.toBe(a.witnessXid)
 const snapshot=await structuralSnapshot(f)
 expect(snapshot.closures).toHaveLength(1);expect(snapshot.closureBlockers).toEqual([])
 expect(snapshot.versions).toHaveLength(1)
 expect(snapshot.versions[0].coverage?.validTo).toBeNull()
 expect(compare(snapshot,S('202610010000202610150000'))).toMatchObject({status:'matched',coverage:{validTo:S('2026-10-14T23:00:00.000Z')},closure:{sourceMessageId:message.id}})
 expect(compare(snapshot,S('202610010000202610150001'))).toMatchObject({status:'unavailable',codes:[]})
 expect(compare(snapshot,S('202610010000202610150000'),'WRONG')).toMatchObject({status:'mismatch',codes:['E61']})
 expect(compare(snapshot,S('202610010000202610150000'),'METER-1',['999'])).toMatchObject({status:'mismatch',codes:['E62']})
 const saved=await structuralSnapshot(f,unreviewed.timeline.cutoffAt!)
 expect(saved.closures).toEqual([]);expect(saved.closureBlockers).toHaveLength(1)
 expect(await approvedClosureWithDiagnostics(f,message.id)).toMatchObject({sourceDisposition:'accepted'})
 expect(stored(message.id)).toHaveLength(2)
 const last=stored(message.id).at(-1)!
 const unwitnessed=await supabaseService.rpc('gridex_record_source_object_decisions_v1',{p_company_id:f.ids.company,p_environment:'test',p_source_message_id:message.id,
  p_source_payload_hash:last.sourceHash,p_canonical_assessment_id:last.canonicalId,p_facts_text:last.factsText})
 expect(unwitnessed.error).toBeNull()
 const blocked=await structuralSnapshot(f)
 expect(blocked.closures).toEqual([]);expect(blocked.closureBlockers).toHaveLength(1)
 expect(compare(blocked,S('202610010000202610150000'))).toMatchObject({status:'unavailable',codes:[]})
 expect((await structuralSnapshot(f,snapshot.timeline.cutoffAt!)).closures).toHaveLength(1)
 if(reason==='Z22'){
   const {resolveCanonicalEdielPolicy}=await import('@/lib/ediel/rulebook/canonicalEdielPolicy')
  const {runUtiltsRuntimeForMessage}=await import('@/lib/ediel/utiltsEngine')
  const {qualifyReceivedUtiltsStructure}=await import('@/lib/ediel/utilts/qualifyReceivedStructure')
  const {buildUtiltsTransactionPersistencePayload}=await import('@/lib/ediel/utilts/transactionPersistence')
  const utilts=observationHandoffMessage(S('2026-10-16'),f.ids.company)
  utilts.sender_ediel_id=f.receiver;utilts.receiver_ediel_id=f.sender
  utilts.raw_payload=utilts.raw_payload!.replaceAll('735999260731000007',snapshot.versions[0].wire.object.objectId!)
   .replaceAll('91100',f.receiver).replaceAll('21660',f.sender).replaceAll(S('202607010000'),S('202610010000'))
   .replaceAll(S('202608010000'),S('202610150000')).replace('?+0200','?+0100').replace('M-GRIDEX-2607-01','METER-1')
  const canonicalPolicy=resolveCanonicalEdielPolicy({family:'UTILTS',messageCode:'E66',direction:'inbound',referenceDate:utilts.message_received_at!,applicationReference:utilts.application_reference,mode:'parse'})
  const persisted=persistUtiltsSubject(f,utilts)
  const runtime=runUtiltsRuntimeForMessage(persisted,{canonicalPolicy})
  expect(runtime.transactionDispositions,JSON.stringify(runtime.validation.issues)).toMatchObject([{disposition:'accepted'}])
  const qualified=await qualifyReceivedUtiltsStructure({message:persisted,runtime,canonicalPolicy})
  expect(qualified).toMatchObject({hasInternalReview:true,hasNationalMismatch:false,evidence:{comparisons:[{reason:'structural_closure_scoped_hold',codes:[]}]},
   runtime:{transactionDispositions:[{disposition:'internal_review',responseType:'none'}],ackPlan:{shouldSendAperak:false}}})
  expect(buildUtiltsTransactionPersistencePayload({messageCode:'E66',transactions:qualified.runtime.facts.transactions,dispositions:qualified.runtime.transactionDispositions,matches:[]})).toMatchObject([{quantities:[],responseType:'none'}])
 }
})
it('native closure cannot manufacture missing prior reviewed coverage from ended live rows',async()=>{
 const f=await seed(false,true);expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'})
 const message=await insertClosure(f)
 expect((await applyInboundBusinessStateMachine({message,actorUserId:f.ids.actor})).outcome).toBe('supply_terminated')
 expect(await closureReview(f,message.id)).toMatchObject({status:'recorded',sourceDisposition:'not_established'})
 expect(stored(message.id).at(-1)!.facts).toMatchObject({objects:[{disposition:'unavailable',business:null}]})
})

it('native append independently binds sealed raw values and midnight support; isolated mutations reproduce each gap',async()=>{
 const f=await seed(false,true);expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'});await reviewed(f)
 const message=await insertClosure(f)
 expect((await applyInboundBusinessStateMachine({message,actorUserId:f.ids.actor})).outcome).toBe('supply_terminated')
 expect(await approvedClosureWithDiagnostics(f,message.id)).toMatchObject({sourceDisposition:'accepted'})
 const a=stored(message.id).at(-1)!
 type Facts={objects:{object:Record<string,unknown>;business:import('@/lib/ediel/sources/reviewedClosureSource').ReviewedClosureBusiness}[]}
 const probe=(mutate:(facts:Facts)=>void,removeBinding=false,removeMidnight=false)=>{
  const facts=JSON.parse(a.factsText) as Facts;mutate(facts)
  // Transaction-local mutation of the real proof body. Append itself is used;
  // ROLLBACK restores definition, inserted assessment and every owner readset.
  return sql<boolean>(`BEGIN;
   ${removeBinding?`DO $mutation$ DECLARE definition text; needle text:='OR NOT gridex_received_sources.closure_wire_matches_v1(src.raw_payload,p_business->''object'',wire)'; BEGIN
    SELECT pg_get_functiondef('gridex_received_sources.review_closure_proof_consistent(jsonb,jsonb,uuid)'::regprocedure) INTO definition;
    IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'closure_native_binding_mutation_missing'; END IF;
    definition:=replace(definition,needle,'OR false');
    ${removeMidnight?`definition:=replace(definition, 'OR substring(wire#>>''{effectiveTo,marketMinute}'',9,4) IS DISTINCT FROM ''0000''', 'OR false');`:''}
    EXECUTE definition; END $mutation$;`:''}
   CREATE FUNCTION pg_temp.closure_append_probe() RETURNS boolean LANGUAGE plpgsql AS $probe$ BEGIN
    PERFORM gridex_received_sources.append_object_assessment(${literal(f.ids.company)},'test',${literal(message.id)},${literal(a.sourceHash)},${literal(a.canonicalId)},${literal(JSON.stringify(facts))});
    RETURN true; EXCEPTION WHEN check_violation THEN RETURN false; END $probe$;
   SELECT to_jsonb(pg_temp.closure_append_probe()); ROLLBACK;`)
 }
 const minute=(facts:Facts)=>{facts.objects[0].business.wire.effectiveTo.marketMinute=S('202610150001');facts.objects[0].business.wire.effectiveTo.utc=S('2026-10-14T23:01:00.000Z')}
 const li=(facts:Facts)=>{facts.objects[0].business.wire.caseReference='FORGED-LI'}
 // LI isolates source binding. The minute control removes BOTH binding and
 // midnight support guards; it does not claim to isolate binding alone.
 // Minute+UTC agree and the legacy calendar DATE remains unchanged.
 expect(probe(minute,true)).toBe(false) // Midnight guard independently holds.
 // BOTH guards removed: the reviewed coverage end (validTo) is still bound to
 // the exact closure instant, so the forged minute is held by that third guard.
 expect(probe(minute,true,true)).toBe(false)
 expect(probe(li,true)).toBe(true) // Binding-only isolated red control.
 expect(probe(minute)).toBe(false);expect(probe(li)).toBe(false)
 const mutations:((facts:Facts)=>void)[]=[
  facts=>{facts.objects[0].business.wire.documentReference='OTHER-DOC'},
  facts=>{facts.objects[0].business.wire.reason='Z23';facts.objects[0].business.wire.subtype='LK'},
  facts=>{Object.assign(facts.objects[0].business.wire,{functionCode:'5'})},
  facts=>{facts.objects[0].business.wire.object.objectId='735123456789999999'},
  facts=>{facts.objects[0].business.wire.object.identityAgency='89'},
  facts=>{facts.objects[0].business.wire.legalSender='99999'},
  facts=>{facts.objects[0].business.wire.legalReceiver='99999'},
  facts=>{facts.objects[0].business.wire.transportSender='99999'},
  facts=>{facts.objects[0].business.wire.transportReceiverQualifier='ZZ'},
  facts=>{facts.objects[0].business.wire.object.registers[0].segmentIndex++},
  facts=>{facts.objects[0].business.sourcePayloadHash='f'.repeat(64)},
  facts=>{facts.objects[0].business.sourceMessageId=f.ids.source},
  facts=>{facts.objects[0].business.supplyPeriodId=f.ids.switch},
  // Owner decision 2026-10-03: no separation of duties; another authorized
  // tenant user may review. An unauthorized reviewer is still refused.
  facts=>{facts.objects[0].business.reviewerUserId='00000000-0000-4000-8000-0000000000ff'},
  facts=>{facts.objects[0].business.baselineCoverageAssessment.factsHash='f'.repeat(64)},
  facts=>{facts.objects[0].business.coverageWindow.outboundSourceMessageId=message.id},
  facts=>{Object.assign(facts.objects[0].business.reviewSnapshot,{approved:true})},
  facts=>{const snapshot:Partial<typeof facts.objects[0]['business']['reviewSnapshot']>=facts.objects[0].business.reviewSnapshot;delete snapshot.readsetHash},
 ]
 for(const mutate of mutations)expect(probe(mutate)).toBe(false)
 expect(stored(message.id)).toHaveLength(1)
 expect(stored(message.id)[0].assessmentId).toBe(a.assessmentId)
 expect(stored(message.id)[0].witnessXid).toBe(a.witnessXid)
})
it('native closure append rechecks stale party, switch and outbound projection after the fresh reads',async()=>{
 const f=await seed(false,true);expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'});await reviewed(f)
 const message=await insertClosure(f)
 expect((await applyInboundBusinessStateMachine({message,actorUserId:f.ids.actor})).outcome).toBe('supply_terminated')
 const originalRpc=supabaseService.rpc.bind(supabaseService)
 const mutate=vi.spyOn(supabaseService,'rpc').mockImplementation((name,args,options)=>{
  if(name==='gridex_record_source_object_decisions_v1')sql(`UPDATE public.supplier_switch_requests SET rff_li_reference='CHANGED' WHERE id=${literal(f.ids.switch)}`)
  return originalRpc(name,args,options)
 })
 expect(await closureReview(f,message.id)).toMatchObject({status:'unconfirmed'})
 expect(stored(message.id)).toEqual([]);mutate.mockRestore()
 sql(`UPDATE public.supplier_switch_requests SET rff_li_reference=${literal(f.caseReference)} WHERE id=${literal(f.ids.switch)}`)
 const staleParty=vi.spyOn(supabaseService,'rpc').mockImplementation((name,args,options)=>{
  if(name==='gridex_record_source_object_decisions_v1')sql(`UPDATE public.tenant_actor_roles SET role_code='grid_owner' WHERE company_id=${literal(f.ids.company)}`)
  return originalRpc(name,args,options)
 })
 expect(await closureReview(f,message.id)).toMatchObject({status:'unconfirmed'})
 expect(stored(message.id)).toEqual([]);staleParty.mockRestore()
 sql(`UPDATE public.tenant_actor_roles SET role_code='electricity_supplier' WHERE company_id=${literal(f.ids.company)}`)
 vi.spyOn(supabaseService,'rpc').mockImplementation((name,args,options)=>{
  // Current sent-source authority requires the public dispatch projection in
  // addition to the immutable accepted journal. Neither can replace the other.
  if(name==='gridex_record_source_object_decisions_v1')sql(`UPDATE public.ediel_messages SET message_sent_at=NULL WHERE id=${literal(f.ids.outbound)}`)
  return originalRpc(name,args,options)
 })
 expect(await closureReview(f,message.id)).toMatchObject({status:'unconfirmed'})
 expect(stored(message.id)).toEqual([])
})
it('a genuine non-midnight original is held by producer and direct append, even with consistent fresh evidence',async()=>{
 const f=await seed(false,true);expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'});await reviewed(f)
 const message=await insertClosure(f,'Z22',S('202610151234'))
 expect((await applyInboundBusinessStateMachine({message,actorUserId:f.ids.actor})).outcome).toBe('supply_terminated')
 expect(await closureReview(f,message.id)).toMatchObject({status:'recorded',sourceDisposition:'not_established'})
 const before=stored(message.id)
 expect(before.at(-1)!.facts).toMatchObject({objects:[{disposition:'unavailable',business:null}]})
 // Deliberately compose an untrusted direct-append proposal from actual fresh
 // owner reads. It is NOT a producer approval or a synthetic positive oracle.
 const {takeReceivedSourceOwnerSeed}=await import('@/lib/ediel/core/receivedSourceValidationLedger')
 const {bindReceivedRegisterValidation}=await import('@/lib/ediel/core/receivedRegisterValidationBinding')
 const {readClosureSourceWire}=await import('@/lib/ediel/sources/closureSourceWire')
 const {resolveClosureCoverage}=await import('@/lib/ediel/sources/closureReviewCoverage')
 const {findStructuralReviewPoint}=await import('@/lib/ediel/sources/structuralReviewReads')
 const {resolveCanonicalTenantEdielIdentityWithEvidence}=await import('@/lib/ediel/tenant/tenantEdielIdentity')
 const {readSelectedFacilityEvidence}=await import('@/lib/ediel/sources/sourceOwnerReads')
 const {evidenceHash}=await import('@/lib/ediel/utilts/durableSourceDiscovery')
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(message)
 const receipt=await recordReceivedSourceValidation({original:message,validated:message,resolvedCompanyId:f.ids.company,decision})
 await captureFreshEdielSourceRulePackEvidence(f.ids.company,message.id)
 const ownerSeed=takeReceivedSourceOwnerSeed(receipt)!
 expect(ownerSeed).not.toBeNull()
 const canonical=JSON.parse(ownerSeed.evidence.factsText)
 const {disposition,reasons,...object}=bindReceivedRegisterValidation(canonical.registerValidation,message.raw_payload!)!.objects[0]
 expect(disposition).toBe('accepted');expect(reasons).toEqual([])
 const wire=readClosureSourceWire(message.raw_payload!,object)!,snapshot=await structuralSnapshot(f)
 const point=await findStructuralReviewPoint(f.ids.company,object.objectId!),assessedAt=new Date().toISOString()
 const receiver=await resolveCanonicalTenantEdielIdentityWithEvidence({companyId:f.ids.company,environment:'test',asOf:assessedAt,requireExactCounts:true})
 const facility=await readSelectedFacilityEvidence({companyId:f.ids.company,environment:'test',meteringPointId:f.ids.point,siteId:f.ids.site,objectId:object.objectId!,signal:AbortSignal.timeout(5000)})
 const {source,coverage,legacyEndDateProjection}=await resolveClosureCoverage(ownerSeed,wire,snapshot,point,f.ids.reviewer)
 const business={version:1,owner:'reviewed-received-closure-v1',coverage:'reviewed_post_ledger_closure',sourceDisposition:'not_established',businessDisposition:'reviewed',graphNamespace:'legacy_unqualified',
  sourceMessageId:message.id,sourcePayloadHash:ownerSeed.evidence.sourcePayloadHash,sourceReceivedAt:message.message_received_at,companyId:f.ids.company,environment:'test',object,assessedAt,wire,reviewerUserId:f.ids.reviewer,
  reviewStatement:'original_supply_closure',customerId:f.ids.customer,meteringPointId:f.ids.point,siteId:f.ids.site,switchRequestId:coverage.switchRequestId,supplyPeriodId:coverage.supplyPeriodId,coverageWindow:coverage,
  baselineCurrentAssessmentId:source.asOf!.assessmentId,baselineCoverageAssessment:{sourceMessageId:source.sourceMessageId,assessmentId:source.asOf!.assessmentId,factsHash:source.asOf!.factsHash,payloadHash:source.payloadHash},
  reviewSnapshot:{snapshotId:snapshot.timeline.snapshotId,readsetHash:snapshot.timeline.readsetHash,cutoffAt:snapshot.timeline.cutoffAt},legacyEndDateProjection}
 const party={version:1,owner:'received-source-party-binding-v1',ruleVersion:'1',source:{sourceMessageId:message.id,sourcePayloadHash:ownerSeed.evidence.sourcePayloadHash,companyId:f.ids.company,environment:'test',receivedAt:message.message_received_at},
  object,assessedAt,completedAt:new Date().toISOString(),historicalKnowledge:'not_established',authentication:'not_assessed',disposition:'accepted',reasons:[],receiver,facility,
  parties:{legalSender:wire.legalSender,legalReceiver:wire.legalReceiver,transportSender:wire.transportSender,transportReceiver:wire.transportReceiver}}
 const facts=JSON.stringify({version:1,owner:'received-source-object-decisions-v1',ruleVersion:'1',canonicalFactsHash:evidenceHash(ownerSeed.evidence.factsText),objects:[{object,disposition:'accepted',reasons:[],business,party}]})
 const probe=(removeMidnight:boolean)=>sql<boolean>(`BEGIN;
  ${removeMidnight?`DO $mutation$ DECLARE definition text; needle text:='OR substring(wire#>>''{effectiveTo,marketMinute}'',9,4) IS DISTINCT FROM ''0000'''; BEGIN
   SELECT pg_get_functiondef('gridex_received_sources.review_closure_proof_consistent(jsonb,jsonb,uuid)'::regprocedure) INTO definition;
   IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'closure_native_midnight_mutation_missing'; END IF;
   EXECUTE replace(definition,needle,'OR false'); END $mutation$;`:''}
  CREATE FUNCTION pg_temp.closure_original_probe() RETURNS boolean LANGUAGE plpgsql AS $probe$ BEGIN
   PERFORM gridex_received_sources.append_object_assessment(${literal(f.ids.company)},'test',${literal(message.id)},${literal(ownerSeed.evidence.sourcePayloadHash)},${literal(ownerSeed.assessmentId)},${literal(facts)});
   RETURN true; EXCEPTION WHEN check_violation THEN RETURN false; END $probe$;
  SELECT to_jsonb(pg_temp.closure_original_probe()); ROLLBACK;`)
 expect(probe(false)).toBe(false)
 expect(probe(true),JSON.stringify(closureSqlDiagnostics({p_company_id:f.ids.company,p_environment:'test',p_source_message_id:message.id,p_source_payload_hash:ownerSeed.evidence.sourcePayloadHash,p_canonical_assessment_id:ownerSeed.assessmentId,p_facts_text:facts},true))).toBe(true) // Only midnight guard removed; original binding remains.
 expect(stored(message.id)).toEqual(before)
})
it('an unwitnessed later Z04 review cannot fall back to the older accepted coverage for closure',async()=>{
 const f=await seed(false,true);expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'});await reviewed(f)
 const baseline=stored(f.ids.source).at(-1)!,originalRpc=supabaseService.rpc.bind(supabaseService)
 const stale=await supabaseService.rpc('gridex_record_source_object_decisions_v1',{p_company_id:f.ids.company,p_environment:'test',p_source_message_id:f.ids.source,
  p_source_payload_hash:baseline.sourceHash,p_canonical_assessment_id:baseline.canonicalId,p_facts_text:baseline.factsText})
 expect(stale.error).toMatchObject({code:'23514',message:'source_object_owner_snapshot_changed'})
 expect(stored(f.ids.source)).toHaveLength(2)
 // A fresh reviewed composition must name the currently latest baseline.
 // Replaying old review facts is correctly denied as stale by SQL. Withhold
 // only its separate witness via a real database hash-mismatch rejection.
 const witnessFailure=vi.spyOn(supabaseService,'rpc').mockImplementation((name,args,options)=>
  originalRpc(name,name==='gridex_witness_source_objects_v1'?{...args,p_facts_hash:'0'.repeat(64)}:args,options))
 expect(await reviewReceivedStructuralSource({companyId:f.ids.company,environment:'test',sourceMessageId:f.ids.source,
  reviewerUserId:f.ids.reviewer,confirmedOriginal:true,replacesSourceMessageId:null})).toMatchObject({status:'unconfirmed'})
 witnessFailure.mockRestore()
 const revisions=stored(f.ids.source)
 expect(revisions).toHaveLength(3)
 expect(revisions.at(-1)!.assessmentId).not.toBe(baseline.assessmentId)
 expect(revisions.at(-1)!.witnessXid).toBeNull()
 expect(revisions.at(-1)!.facts).toMatchObject({objects:[{disposition:'accepted',business:{baselineCurrentAssessmentId:baseline.assessmentId}}]})
 const message=await insertClosure(f)
 expect((await applyInboundBusinessStateMachine({message,actorUserId:f.ids.actor})).outcome).toBe('supply_terminated')
 expect(await closureReview(f,message.id)).toMatchObject({status:'recorded',sourceDisposition:'not_established'})
 expect(stored(message.id).at(-1)!.facts).toMatchObject({objects:[{disposition:'unavailable',business:null}]})
})
it('isolates nested JSON subtraction precedence without changing the published owner',()=>{
 const result=sql<{original:{code:string};parenthesized:boolean}>(`BEGIN;
  CREATE FUNCTION pg_temp.closure_json_subtraction_probe() RETURNS jsonb LANGUAGE plpgsql AS $probe$
  DECLARE payload jsonb:='{"reviewSnapshot":{"snapshotId":"x","readsetHash":"y","cutoffAt":"z"}}';
  BEGIN
   PERFORM payload->'reviewSnapshot'-ARRAY['snapshotId','readsetHash','cutoffAt'];
   RETURN jsonb_build_object('code','no_error');
  EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('code',SQLSTATE,'message',SQLERRM); END $probe$;
  SELECT jsonb_build_object('original',pg_temp.closure_json_subtraction_probe(),
   'parenthesized',('{"reviewSnapshot":{"snapshotId":"x","readsetHash":"y","cutoffAt":"z"}}'::jsonb->'reviewSnapshot')-ARRAY['snapshotId','readsetHash','cutoffAt']='{}'::jsonb);
  ROLLBACK;`)
 expect(result).toMatchObject({original:{code:'22P02'},parenthesized:true})
})

it('keeps a deleted switch event in its historical customer and point receipts at both cutoffs',async()=>{
 const f=await seed(),pointId=randomUUID(),requestId=randomUUID(),eventId=randomUUID()
 const point='735999260925000001'
 sql(`INSERT INTO public.metering_points(id,company_id,customer_id,site_id,customer_site_id,
   metering_point_id,meter_point_id,reading_frequency,measurement_type,is_settlement_relevant,grid_owner_id)
  VALUES(${literal(pointId)},${literal(f.ids.company)},${literal(f.ids.customer)},
   ${literal(f.ids.site)},${literal(f.ids.site)},${literal(point)},${literal(point)},
   'hourly','consumption',true,${literal(f.ids.grid)});
  INSERT INTO public.supplier_switch_requests(id,company_id,customer_id,metering_point_id,request_type,status)
  VALUES(${literal(requestId)},${literal(f.ids.company)},${literal(f.ids.customer)},
   ${literal(pointId)},'switch','draft');
  INSERT INTO public.supplier_switch_events(id,company_id,switch_request_id,event_type)
  VALUES(${literal(eventId)},${literal(f.ids.company)},${literal(requestId)},'native_historical_delete');`)
 const cutoff=sql<string>('SELECT to_jsonb(clock_timestamp())')
 sql(`DELETE FROM public.supplier_switch_events WHERE id=${literal(eventId)};
  DELETE FROM public.supplier_switch_requests WHERE id=${literal(requestId)};
  DELETE FROM public.metering_points WHERE id=${literal(pointId)};`)
 const read=(at:string)=>sql<{complete:boolean;historyCoverage:string;reason:string;
   facts:{rowId:string;operation:string}[]}>(`SELECT gridex_correction_process.combined_process_body_v3(
    ${literal(f.ids.company)},${literal(at)}::timestamptz,
    ARRAY[${literal(f.ids.customer)}]::uuid[],ARRAY[${literal(point)}]::text[])`)
 const old=read(cutoff),current=read(sql<string>('SELECT to_jsonb(clock_timestamp())'))
 expect(old).toMatchObject({complete:false,historyCoverage:'before_epoch_unknown',reason:'before_epoch_unknown'})
 expect(current).toMatchObject({complete:false,historyCoverage:'before_epoch_unknown',reason:'before_epoch_unknown'})
 expect(old.facts.filter(fact=>fact.rowId===eventId).map(fact=>fact.operation)).toEqual(['INSERT'])
 expect(current.facts.filter(fact=>fact.rowId===eventId).map(fact=>fact.operation)).toEqual(['INSERT','DELETE'])
 expect(current.facts.filter(fact=>fact.rowId===requestId).map(fact=>fact.operation)).toEqual(['INSERT','DELETE'])
 expect(current.facts.filter(fact=>fact.rowId===pointId).map(fact=>fact.operation)).toEqual(['INSERT','DELETE'])
})
it('keeps a cross-customer switch request and event with their actual point subject',async()=>{
 const f=await seed(),incomingCustomer=randomUUID(),requestId=randomUUID(),eventId=randomUUID()
 const point=sql<string>(`SELECT to_jsonb(meter_point_id) FROM public.metering_points WHERE id=${literal(f.ids.point)}`)
 sql(`INSERT INTO public.customers(id,company_id,customer_number,name,customer_type)
  VALUES(${literal(incomingCustomer)},${literal(f.ids.company)},${literal(`E035-INCOMING-${incomingCustomer}`)},
   'Synthetic incoming customer','private');
  INSERT INTO public.supplier_switch_requests(id,company_id,customer_id,metering_point_id,request_type,status)
  VALUES(${literal(requestId)},${literal(f.ids.company)},${literal(incomingCustomer)},
   ${literal(f.ids.point)},'switch','draft');
  INSERT INTO public.supplier_switch_events(id,company_id,switch_request_id,event_type)
  VALUES(${literal(eventId)},${literal(f.ids.company)},${literal(requestId)},'native_cross_customer_point');`)
 const cutoff=sql<string>('SELECT to_jsonb(clock_timestamp())')
 const read=(at:string)=>sql<{facts:{rowId:string;operation:string}[]}>(`SELECT gridex_correction_process.combined_process_body_v3(
  ${literal(f.ids.company)},${literal(at)}::timestamptz,ARRAY[${literal(f.ids.customer)}]::uuid[],
  ARRAY[${literal(point)}]::text[])`)
 const before=read(cutoff)
 sql(`DELETE FROM public.supplier_switch_events WHERE id=${literal(eventId)};
  DELETE FROM public.supplier_switch_requests WHERE id=${literal(requestId)};`)
 const after=read(sql<string>('SELECT to_jsonb(clock_timestamp())'))
 expect(before.facts.filter(fact=>fact.rowId===requestId).map(fact=>fact.operation)).toEqual(['INSERT'])
 expect(before.facts.filter(fact=>fact.rowId===eventId).map(fact=>fact.operation)).toEqual(['INSERT'])
 expect(after.facts.filter(fact=>fact.rowId===requestId).map(fact=>fact.operation)).toEqual(['INSERT','DELETE'])
 expect(after.facts.filter(fact=>fact.rowId===eventId).map(fact=>fact.operation)).toEqual(['INSERT','DELETE'])
})
