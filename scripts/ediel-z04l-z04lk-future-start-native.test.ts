// SOURCE acceptance proposal for AT-Z04L-SUPPLIER, AT-Z04LK-SUPPLIER and SC-037.
// Untagged until qualified execution and the complete literal-effect review.
// Synthetic tenants/mail/registry issuer competence and external SMTP only.
// Public producer/intake/parser/source/ACK/RBAC/cron/PG/Auth/clocks remain real.
// Accelerated real clocks are NOT elapsed fourteen days or external market history.
import {createHash,randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {beforeAll,describe,expect,it,vi} from 'vitest'
import {NextRequest} from 'next/server'
const smtp=vi.hoisted(()=>vi.fn())
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:smtp})}}))
import {seedNormalSwitchNativeFixture,nativeSql as sql,literal,type NormalSwitchStageNativeFixture} from './helpers/ediel-normal-switch-native-fixture'
import {seedOriginalMailboxNative} from './helpers/originalMailboxNative'
import {buildCancellationProspectiveZ04} from './helpers/ediel-cancellation-prospective-source-2ea'
import {omitSupplyEndField} from './helpers/ediel-supply-end-field-omissions'
import {advanceProspectiveMarketPhase,readActualMarketClocks,requireBoundary,marketStartInstant,
  authenticateCurrentPhaseActor,type PhaseActor,type FutureStartNativeReceipt} from './helpers/ediel-prospective-market-clock-native'
import {supabaseService} from '@/lib/supabase/service'
import {prepareAndQueueEdielZ03} from '@/lib/ediel/flows/prodatSwitch'
import {prepareAndQueueSwitchCancellation} from '@/lib/ediel/flows/prodatSwitchCancellation'
import {sendEdielMessageViaSmtp} from '@/lib/ediel/transport'
import {getEdielMessageById} from '@/lib/ediel/db'
import {assertEdielSmtpReadiness} from '@/lib/ediel/mailReadiness'
import {createInboundEdielMessage} from '@/lib/inbound-mail/inboundStatusUpdater'
import {matchOutboundRequestForInbound,matchMeteringPointForInbound} from '@/lib/inbound-mail/inboundMatcher'
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import * as receivedSourceValidationLedger from '@/lib/ediel/core/receivedSourceValidationLedger'
import {buildReceivedSourceValidationEvidence} from '@/lib/ediel/core/receivedSourceValidationEvidence'
import {receivedOriginalRulePackWitness} from '@/lib/ediel/rulebook/canonicalRulePackRegistry'
import {validateFieldMatrixPayload} from '@/lib/ediel/rulebook/fieldMatrix'
import {canonicalProdat26AFieldRules} from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import {evaluateProdatTransactionReason} from '@/lib/ediel/prodat/prodatTransactionReason'
import {buildContrlDraft,buildAperakDraft} from '@/lib/ediel/ack'
import {readCommittedInboundAck} from '@/lib/ediel/ack/committedInboundAck'
import {readPhysicalAckSourceCorrelation} from '@/lib/ediel/ack/sourceCorrelation'
import {validateEdifactEnvelope,validateUnsmGrammar} from '@/lib/ediel/core/edifactValidation'
import {validateEdifactSyntax} from '@/lib/ediel/core/syntaxValidator'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {serializeUna} from '@/lib/ediel/core/una'
import {GET as runCustomerOperationsCron} from '@/app/api/internal/customer-operations/cron/route'
import type {EdielMessageRow} from '@/lib/ediel/types'

type Subtype='L'|'LK'
type Row=Record<string,unknown>
type Fixture=NormalSwitchStageNativeFixture&{subtype:Subtype;originalZ03:EdielMessageRow;caseReference:string;
  startAt:string;originalSeal:unknown;confirmation?:EdielMessageRow;periodId?:string;confirmed?:Row;invoiceBaseline?:Row}
const password=randomUUID()+randomUUID(),cronSecret=randomUUID()+randomUUID()
const fixtures:Fixture[]=[],valid={} as Record<Subtype,Fixture>,cancelled={} as Record<Subtype,Fixture>,expires={} as Record<Subtype,Fixture>,pending={} as Record<Subtype,Fixture>,invoiceePositive={} as Record<Subtype,Fixture>
const heldAttempts:Row[]=[]
let decoy:Fixture,ordinaryDay:string
const evidence:FutureStartNativeReceipt={schema:'ediel_z04_future_start_native_v1',accelerated_execution:true,
  actual_elapsed_14_days:false,authentic_external_market_history:false,whole_approval:false,
  source:{head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),tree:execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim()},
  originals:[],phases:[],cases:[]}
const digest=(raw:string)=>createHash('sha256').update(raw).digest('hex')
function persist(){
  const root=process.env.GRIDEX_Z04_FUTURE_EVIDENCE
  if(!root||!root.startsWith(process.cwd()+'/'))throw Error('z04future_owned_evidence_directory_required')
  writeFileSync(join(root,'product-future-start-receipt.json'),JSON.stringify({...evidence,held_attempts:heldAttempts},null,2)+'\n')
}
function passed(name:string,facts:Row={}){evidence.cases.push({name,status:'PASSED',...facts});persist()}
function configureSmtp(email='recipient@example.invalid'){
  for(const[k,v]of Object.entries({EDIEL_SHARED_MAILBOX_ADDRESS:'synthetic@example.invalid',EDIEL_APP_DKIM_ENABLED:'false',
    EMAIL_PROVIDER:'resend',EDIEL_SMTP_FROM:'synthetic@example.invalid',EDIEL_SMTP_USER:'synthetic@example.invalid',
    EDIEL_SMTP_PASS:'synthetic-only',EDIEL_EMAIL_PROVIDER:'strato',GRIDEX_MANUAL_OPS_ENVIRONMENT:'test',
    MANUAL_GRID_OWNER_SAFE_RECIPIENT:'recipient@example.invalid'}))vi.stubEnv(k,v)
  smtp.mockResolvedValue({accepted:[email],rejected:[],messageId:randomUUID(),response:'250 synthetic accepted'})
}
function plusDays(day:string,n:number){const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
function actor(f:Fixture):PhaseActor{return {userId:f.actorUserId,email:f.actorUserId+'@example.invalid',companyId:f.companyId,
  password,permissionKeys:['communication.read','communication.write','communication.send','metering.write']}}
function originalSeal(f:Fixture){return sql(`SELECT jsonb_build_object(
  'message',(SELECT jsonb_build_object('id',id,'company',company_id,'environment',environment,'direction',direction,
    'raw',raw_payload,'hash',immutable_payload_hash,'rendered_at',immutable_rendered_at,'sent_at',message_sent_at,
    'customer',customer_id,'site',site_id,'point',metering_point_id) FROM public.ediel_messages WHERE id=${literal(f.originalZ03.id)}),
  'origin',(SELECT to_jsonb(o) FROM gridex_received_sources.switch_originals o WHERE company_id=${literal(f.companyId)} AND message_id=${literal(f.originalZ03.id)}),
  'method',(SELECT to_jsonb(b) FROM gridex_received_sources.switch_contract_request_bindings b WHERE company_id=${literal(f.companyId)} AND message_id=${literal(f.originalZ03.id)}));`)}
const businessTables=['public.supplier_switch_requests','public.customers','public.customer_sites','public.metering_points','public.customer_contracts',
  'public.customer_supply_periods','public.metering_permissions','public.customer_cases','public.customer_application_workflows',
  'public.customer_application_workflow_events','public.customer_operation_jobs','public.domain_events','public.customer_invoices',
  'gridex_received_sources.normal_switch_confirmations','gridex_received_sources.normal_supply_activations',
  'gridex_received_sources.supply_source_transitions','gridex_received_sources.supply_object_effect_receipts'] as const
// Held source partitions are rejection receipts, not market writes. held()
// reads them separately and permits only the expected all-held disposition.
function business(f:Fixture){return sql<Row>('SELECT jsonb_build_object('+businessTables.map(table=>
  `${literal(table)},(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),'[]') FROM ${table} x WHERE company_id=${literal(f.companyId)})`).join(',')+');')}
function periods(f:Fixture){return sql<Row[]>(`SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM public.customer_supply_periods p WHERE company_id=${literal(f.companyId)};`)}
function activationSnapshot(f:Fixture){return sql<Row>(`SELECT jsonb_build_object(
  'switch',(SELECT to_jsonb(s) FROM public.supplier_switch_requests s WHERE id=${literal(f.switchId)} AND company_id=${literal(f.companyId)}),
  'periods',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM public.customer_supply_periods p WHERE company_id=${literal(f.companyId)}),
  'confirmations',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY period_id),'[]') FROM gridex_received_sources.normal_switch_confirmations c WHERE company_id=${literal(f.companyId)}),
  'activations',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY period_id),'[]') FROM gridex_received_sources.normal_supply_activations a WHERE company_id=${literal(f.companyId)}),
  'graph',jsonb_build_object(
    'contract',(SELECT jsonb_build_object('id',c.id,'company_id',c.company_id,'customer_id',c.customer_id,'site_id',c.site_id,
      'customer_site_id',c.customer_site_id,'metering_point_id',c.metering_point_id,'status',c.status,'lifecycle_stage',c.lifecycle_stage,
      'actual_start_date',c.actual_start_date,'confirmed_start_date',c.confirmed_start_date,'billing_eligible_at',c.billing_eligible_at,
      'billing_eligibility_source',c.billing_eligibility_source,'signed_version',c.signed_version,'contract_version',c.contract_version,
      'signed_at',c.signed_at,'protected_contract_hash',gridex_received_sources.production_contract_hash_v1(c),
      'activation_anchors',jsonb_build_object('supply_period_id',c.metadata->'supply_period_id',
        'supplier_switch_request_id',c.metadata->'supplier_switch_request_id','activation_source_message_id',c.metadata->'activation_source_message_id'))
      FROM public.customer_contracts c WHERE c.id=${literal(f.contractId)} AND c.company_id=${literal(f.companyId)}),
    'site',(SELECT jsonb_build_object('id',s.id,'company_id',s.company_id,'customer_id',s.customer_id,'status',s.status,
      'current_supplier_name',s.current_supplier_name,'current_supplier_org_number',s.current_supplier_org_number,
      'grid_owner_id',s.grid_owner_id,'price_area_code',s.price_area_code)
      FROM public.customer_sites s WHERE s.id=${literal(f.siteId)} AND s.company_id=${literal(f.companyId)}),
    'point',(SELECT jsonb_build_object('id',p.id,'company_id',p.company_id,'customer_id',p.customer_id,'site_id',p.site_id,
      'customer_site_id',p.customer_site_id,'status',p.status,'grid_owner_id',p.grid_owner_id,'price_area_code',p.price_area_code)
      FROM public.metering_points p WHERE p.id=${literal(f.pointId)} AND p.company_id=${literal(f.companyId)})),
  'billing_basis',${f.periodId?`gridex_received_sources.billing_supply_basis_v1(${literal(f.companyId)},${literal(f.periodId)},${literal(f.startAt)}::timestamptz,${literal(f.startAt)}::timestamptz+interval '1 minute')`:'NULL'},
  'events',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY id),'[]') FROM public.domain_events e WHERE company_id=${literal(f.companyId)}),
  'jobs',(SELECT coalesce(jsonb_agg(to_jsonb(j) ORDER BY id),'[]') FROM public.customer_operation_jobs j WHERE company_id=${literal(f.companyId)}),
  'invoices',(SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY id),'[]') FROM public.customer_invoices i WHERE company_id=${literal(f.companyId)}));`)}
// This chain qualifies eligibility without invoking invoice generation. Drafts
// and sibling-customer invoices remain visible in the tenant-wide full snapshot.
function requireNoInvoices(s:Row){assert.deepEqual(s.invoices,[],'no_invoice_creation_in_future_start_chain')}
// Actual cron also runs legitimate operational workers. Preserve full snapshots
// as evidence, but replay must retain market facts and activation ID sets; it need
// not freeze the status of an already-created notification job forever.
function marketFacts(s:Row){requireNoInvoices(s);return {switch:s.switch&&{id:(s.switch as Row).id,status:(s.switch as Row).status,
  inbound:(s.switch as Row).inbound_z04_message_id,outbound:(s.switch as Row).outbound_z03_message_id},
  graph:s.graph,periods:s.periods,confirmations:s.confirmations,activations:s.activations,billing_basis:s.billing_basis,
  activationEvents:(s.events as Row[]).filter(x=>String(x.idempotency_key).startsWith('ediel-normal-activation:')),
  activationJobs:(s.jobs as Row[]).filter(x=>String(x.idempotency_key).startsWith('lifecycle_notification:ediel-normal-activation:')).map(x=>({id:x.id,idempotency_key:x.idempotency_key,payload:x.payload,request_snapshot:x.request_snapshot})),
  invoiceIds:(s.invoices as Row[]).map(x=>x.id)}}
function requireMarketFactsUnchanged(before:Row,after:Row){assert.deepEqual(marketFacts(after),marketFacts(before))}
type OtherActorMarketSnapshot={actorUserId:string;companyId:string;switchId:string;subtype:Subtype;periodId:string|null;state:Row}
function requireOtherActorMarketFactsUnchanged(currentActorUserId:string,before:OtherActorMarketSnapshot[],after:OtherActorMarketSnapshot[]){
  const scope=({actorUserId,companyId,switchId,subtype,periodId}:OtherActorMarketSnapshot)=>({actorUserId,companyId,switchId,subtype,periodId})
  assert.equal(before.length,10,'all_ten_other_prospective_actors')
  assert.equal(new Set(before.map(x=>x.actorUserId)).size,before.length,'distinct_other_fixture_actors')
  assert.deepEqual(after.map(scope),before.map(scope),'same_other_fixture_scopes')
  return before.map((entry,index)=>{
    assert.notEqual(entry.actorUserId,currentActorUserId,'current_actor_has_own_activation_assertions')
    requireMarketFactsUnchanged(entry.state,after[index].state)
    return {...scope(entry),before:entry.state,after:after[index].state,market_facts_unchanged:true}
  })
}
function requireProspectiveContract(s:Row){
  const contract=(s.graph as Row).contract as Row
  assert(contract&&contract.status!=='active'&&contract.lifecycle_stage!=='active','prospective_contract_not_active')
  assert.equal(contract.actual_start_date,null);assert.equal(contract.billing_eligible_at,null)
}
// Only these actual child result channels are error evidence. Counters such
// as needsReview/blocked and domain payload keys named errors stay observations.
function requireCronResultChannels(result:Row,expectedDenials:Row[]){
  const names=['exactAddressResolution','legacyFacilityRequestReconciliation','customerApplicationReconciliation',
    'contractConfirmations','customerOperations','z01ResponseSla','inboundAckSla','permissionMarketDeadlines','supplyMarketDeadlines',
    'businessExpectations','facilityLookupDispatch','resumedIntents','poaExpiry','manualGridOwnerFollowUps',
    'supplierSwitchActivations','automationUserConfig']
  assert.deepEqual(Object.keys(result).sort(),[...names].sort(),'actual_cron_step_universe')
  const step=(name:string)=>{
    const value=result[name] as Row
    assert(value&&typeof value==='object'&&!Array.isArray(value),'actual_cron_step_result_required:'+name)
    assert.notEqual(value.failed,true,'actual_cron_step_exception:'+name)
    assert(!Object.hasOwn(value,'skippedReason'),'actual_cron_step_schema_skip:'+name)
    assert.notEqual(value.configurationBlocked,true,'actual_cron_actor_configuration:'+name)
    return value
  }
  for(const name of names)step(name)
  assert.deepEqual(step('automationUserConfig'),{ok:true,issue:null})
  assert.equal(step('exactAddressResolution').errors,0,'actual_exact_address_errors')
  assert.equal(step('legacyFacilityRequestReconciliation').schemaMissing,false,'actual_legacy_schema_available')
  assert.equal(step('customerApplicationReconciliation').schemaMissing,false,'actual_continuation_schema_available')
  assert.equal(step('customerOperations').failed,0,'actual_customer_worker_failed')
  for(const name of ['customerOperations','facilityLookupDispatch','resumedIntents','manualGridOwnerFollowUps'])
    assert.deepEqual(step(name).errors,[],'actual_child_errors:'+name)
  assert.equal(step('z01ResponseSla').available,true,'actual_z01_schema_available')
  assert.equal(step('z01ResponseSla').automatic_resends,0,'actual_z01_no_automatic_resend')
  assert.deepEqual(step('businessExpectations').blocked,[],'actual_expectation_read_expire_project_errors')
  const confirmations=step('contractConfirmations').results
  assert(Array.isArray(confirmations),'actual_contract_confirmation_results_required')
  assert.equal(step('contractConfirmations').processed,confirmations.length)
  for(const confirmation of confirmations){
    assert.equal((confirmation as Row).error,null,'actual_contract_confirmation_delivery_error')
    assert.notEqual((confirmation as Row).state,'error','actual_contract_confirmation_error_state')
  }
  const activations=step('supplierSwitchActivations'),failures=activations.failures
  assert(Array.isArray(failures),'actual_legacy_candidate_failures_required')
  assert.equal(activations.failed,expectedDenials.length,'actual_legacy_candidate_failed_count')
  const order=(a:Row,b:Row)=>String(a.requestId).localeCompare(String(b.requestId))
  assert.deepEqual([...failures].sort(order),[...expectedDenials].sort(order),'actual_legacy_candidate_scope_cause')
}
function sourceCustody(f:Fixture,m:EdielMessageRow){return sql(`SELECT jsonb_build_object(
  'source',(SELECT jsonb_build_object('id',id,'company',company_id,'environment',environment,'direction',direction,
    'raw',raw_payload,'hash',immutable_payload_hash,'received',message_received_at,'mail',inbound_email_message_id) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND id=${literal(m.id)}),
  'mail',(SELECT jsonb_build_object('id',id,'raw',raw_edifact_payload,'received',received_at) FROM public.inbound_email_messages WHERE id=${literal(m.inbound_email_message_id)}),
  'receptions',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM gridex_ediel_inbound_receptions.receptions r WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(m.id)}));`)}
async function prospective(name:string,subtype:Subtype,startDay:string,expireBeforeStart=false):Promise<Fixture>{
  const stage=await seedNormalSwitchNativeFixture({deferOriginal:true,requestedStartDate:startDay,provider:configureSmtp})
  if(subtype==='LK')sql(`UPDATE public.supplier_switch_requests SET prodat_variant='LK',prodat_reason='Z23',request_type='move_in' WHERE id=${literal(stage.switchId)} AND company_id=${literal(stage.companyId)};`)
  // Prospective real role validity, BEFORE original birth; no admitted fact is rewritten.
  if(expireBeforeStart)sql(`UPDATE public.tenant_actor_roles SET valid_to=${literal(marketStartInstant(startDay))}::timestamptz-interval '1 hour' WHERE company_id=${literal(stage.companyId)} AND actor_id=${literal(stage.actorUserId)} AND role_code='electricity_supplier';`)
  const queued=await prepareAndQueueEdielZ03({actorUserId:stage.actorUserId,switchRequestId:stage.switchId,communicationRouteId:stage.routeId,environment:'test'})
  await sendEdielMessageViaSmtp(queued,{actorUserId:stage.actorUserId,smtpMimeMode:'nodemailer-attachment'})
  const original=(await getEdielMessageById(queued.id))!
  expect(original).toMatchObject({id:queued.id,company_id:stage.companyId,direction:'outbound',message_code:'Z03',status:'sent',aperak_status:'pending'})
  const parsed=tokenizeEdifact(original.raw_payload!),li=parsed.segments.filter(s=>s.tag==='RFF'&&segmentComposite(s,1,parsed.una)[0]==='LI')
  expect(li).toHaveLength(1)
  const physical=sql<{start:string;reason:string}>(`SELECT gridex_received_sources.switch_origin_wire_v1(${literal(original.raw_payload)})#>'{objects,0}';`)
  expect(physical.start).toBe(startDay.replaceAll('-','')+'0000');expect(physical.reason).toBe(subtype==='L'?'Z22':'Z23')
  const startAt=marketStartInstant(startDay)
  expect(Date.parse(sql<string>(`SELECT to_jsonb(gridex_received_sources.permission_time_v1(${literal(physical.start)}));`))).toBe(Date.parse(startAt))
  const days=(Date.parse(startDay+'T12:00:00Z')-Date.parse(ordinaryDay+'T12:00:00Z'))/86400000
  expect(days).toBeGreaterThanOrEqual(subtype==='L'?14:0)
  const f:Fixture={...stage,subtype,originalZ03:original,caseReference:segmentComposite(li[0],1,parsed.una)[1],startAt,originalSeal:null}
  f.originalSeal=originalSeal(f);fixtures.push(f)
  expect((await supabaseService.auth.admin.updateUserById(f.actorUserId,{password,email_confirm:true})).error).toBeNull()
  const config=assertEdielSmtpReadiness(),route=randomUUID(),profile=randomUUID()
  sql(`INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,environment_type,is_active,target_email) VALUES(${literal(route)},${literal(f.companyId)},'Synthetic Z04 future ACK','ediel_ack','bilateral_test',true,'recipient@example.invalid');
    INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,payload_format,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,is_active,transport_security_mode,smtp_to,receiver_email,mailbox,smtp_host,smtp_port)
    VALUES(${literal(profile)},${literal(f.companyId)},${literal(route)},'Synthetic Z04 future ACK','test','edifact','edifact',${literal(f.sender)},${literal(f.receiver)},'23-DDQ-PRODAT',true,true,'unencrypted','recipient@example.invalid','recipient@example.invalid',${literal(config.from)},${literal(config.host)},${config.port});`)
  evidence.originals.push({name,subtype,companyId:f.companyId,originalId:original.id,originalHash:digest(original.raw_payload!),
    li:f.caseReference,startDay,marketStartAt:startAt,calendar_days_before_start:days,seal:f.originalSeal});persist()
  return f
}
function envelope(f:Fixture,wire:string,reason=f.subtype==='L'?'Z22':'Z23'){
  const p=tokenizeEdifact(wire),body=p.segments.filter(s=>!['UNA','UNB','UNH','UNT','UNZ'].includes(s.tag)).map((s,index,segments)=>{
    if(s.tag==='BGM')return `BGM+Z04+${randomUUID().replaceAll('-','').slice(0,20)}+9+AB`
    if(s.tag==='CAV'&&segmentComposite(s,1,p.una)[0]==='Z22')return 'CAV+'+reason
    // This is a NEW synthetic Z04 source, before mail/source birth. The donor
    // wire's permission-only506 sibling is not valid for Z04. Keep field242
    // explicitly; never rewrite any admitted original or source bytes.
    const previous=segments[index-1]
    if(s.tag==='CAV'&&previous?.tag==='CCI'&&segmentComposite(previous,2,p.una)[0]==='Z14')
      return 'CAV+'+segmentComposite(s,1,p.una).slice(0,4).join(p.una.componentDataElementSeparator)
    return s.raw
  })
  return EdifactEnvelopeCodec.encode({sender:f.receiver,receiver:f.sender,senderQualifier:'14',receiverQualifier:'14',
    applicationReference:'23-DDQ-PRODAT',acknowledgementRequest:true,environment:'test',
    interchangeReference:randomUUID().replaceAll('-','').slice(0,14),messages:[{messageReference:randomUUID().replaceAll('-','').slice(0,14),
      messageTypeToken:'PRODAT:D:97A:UN:E2SE6A',businessSegments:body}]})
}
function wire(f:Fixture,reason?:string){return envelope(f,buildCancellationProspectiveZ04(f),reason)}
type BirthObservation={id:string|null;thrown:unknown;threw:boolean;warnings:unknown[][]}
async function observePublicBirth(create:()=>Promise<string|null>):Promise<BirthObservation>{
  // Observe the real owner's diagnostic port; spyOn preserves console output.
  // The public creator is invoked ONCE, with no substituted return or retry.
  const warning=vi.spyOn(console,'warn'),observation:BirthObservation={id:null,thrown:null,threw:false,warnings:[]}
  try{observation.id=await create()}catch(error){observation.thrown=error;observation.threw=true}
  finally{observation.warnings=warning.mock.calls.map(args=>args.slice());warning.mockRestore()}
  return observation
}
function requireBirthRefusal(field:string|undefined,raw:string,observation:BirthObservation,premise:Row|null){
  assert.equal(observation.id,null,'refused_public_birth_has_no_source')
  assert.equal(typeof observation.threw,'boolean','actual_public_birth_exception_presence_required')
  assert(field,'unexpected_public_birth_refusal')
  const wire=tokenizeEdifact(raw),unh=wire.segments.find(s=>s.tag==='UNH')!,unb=wire.segments.find(s=>s.tag==='UNB')!,bgm=wire.segments.find(s=>s.tag==='BGM')!
  const app=segmentComposite(unb,7,wire.una)[0]??'',code=segmentComposite(bgm,1,wire.una)[0]??''
  if(observation.threw){
    const expected=field==='312'&&!segmentComposite(unh,2,wire.una)[4]?'normal_switch_birth_association_mismatch':
      field==='311'&&app==='23-DGI-PRODAT'?'canonical_ediel_application_reference_not_allowed:Z04:23-DGI-PRODAT':null
    if(!expected||!(observation.thrown instanceof Error)||observation.thrown.name!=='Error'||observation.thrown.message!==expected)
      throw observation.thrown
    assert.equal(observation.warnings.length,0,'no_unrelated_birth_warning')
    return {field,kind:'exact_public_birth_exception',name:observation.thrown.name,message:expected,public_invocations:1}
  }
  assert.equal(observation.warnings.length,1,'one_actual_public_birth_error_required')
  const [marker,error]=observation.warnings[0]
  assert.equal(marker,'[inbound-mail] Kunde inte skapa/uppdatera inbound ediel_message')
  assert(error&&typeof error==='object','actual_public_birth_database_error_required')
  assert(premise,'exact_current_birth_profile_premise_required')
  if(field==='202'){
    assert.equal(code,'');assert.equal(premise.code,'PRODAT_UNKNOWN');assert.equal(premise.count,0)
  }else{
    assert.equal(field,'311');assert.equal(app,'');assert.equal(code,'Z04');assert.equal(premise.code,'Z04')
    assert(Number(premise.count)>1,'missing_APP_has_healthy_distinct_normal_profiles')
    assert(Array.isArray(premise.profileKeys))
    for(const subtype of ['L','LK'])assert(premise.profileKeys.includes('PRODAT:Z04:'+subtype+':26.A:r3'))
  }
  const message=`canonical_inbound_rule_profile_resolution_failed:PRODAT:${String(premise.code)}:${String(premise.day)}:${String(premise.count)}`
  assert.equal((error as Row).code,'23514','unknown_SQLSTATE_is_not_a_field_refusal')
  assert.equal((error as Row).message,message,'exact_actual_source_profile_refusal_required')
  return {field,kind:'exact_public_birth_database_refusal',code:'23514',message,premise,public_invocations:1}
}
function mailCustody(mail:{inboundEmailMessageId:string;parseResultId:string}){return sql<Row>(`SELECT jsonb_build_object(
  'rawBirth',(SELECT to_jsonb(r) FROM gridex_unattributed_intake.raw_births r WHERE inbound_email_message_id=${literal(mail.inboundEmailMessageId)}),
  'parseBirth',(SELECT to_jsonb(p) FROM gridex_unattributed_intake.parse_births p WHERE parse_result_id=${literal(mail.parseResultId)}),
  'raw',(SELECT raw_edifact_payload FROM public.inbound_email_messages WHERE id=${literal(mail.inboundEmailMessageId)}),
  'parsedRaw',(SELECT raw_payload FROM public.inbound_ediel_parse_results WHERE id=${literal(mail.parseResultId)}));`)}
function absentBirthAuthority(mail:{inboundEmailMessageId:string}){return sql<Row>(`WITH own AS (
  SELECT id FROM public.ediel_messages WHERE
    inbound_email_message_id=${literal(mail.inboundEmailMessageId)} OR mailbox_message_id=${literal(mail.inboundEmailMessageId)})
  SELECT jsonb_build_object('sources',(SELECT coalesce(jsonb_agg(id),'[]') FROM own),
    'receptions',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM gridex_ediel_inbound_receptions.receptions r WHERE inbound_email_message_id=${literal(mail.inboundEmailMessageId)}),
    'technicalBirths',(SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') FROM gridex_unattributed_intake.technical_births t WHERE inbound_email_message_id=${literal(mail.inboundEmailMessageId)}),
    'receivedSources',(SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]') FROM gridex_received_sources.sources s JOIN own ON own.id=s.source_message_id),
    'contexts',(SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]') FROM gridex_ediel_inbound_context.receipts c JOIN own ON own.id=c.source_message_id));`)}
async function receive(f:Fixture,raw:string,expectedSubtype?:Subtype|'C',negativeField?:string){
  // Real local public transport privilege at original mail birth. The custody
  // trigger deliberately refuses postgres-only writes without this role.
  const transportSql=<T,>(statement:string)=>sql<T>(`BEGIN; SET LOCAL ROLE service_role; ${statement}; COMMIT;`)
  const mail=await seedOriginalMailboxNative(transportSql,literal,{companyId:f.companyId,environment:'test',raw,smtpFrom:assertEdielSmtpReadiness().from})
  expect(sql<number>(`SELECT to_jsonb(count(*)) FROM gridex_unattributed_intake.raw_births WHERE inbound_email_message_id=${literal(mail.inboundEmailMessageId)};`)).toBe(1)
  expect(sql<number>(`SELECT to_jsonb(count(*)) FROM gridex_unattributed_intake.parse_births WHERE inbound_email_message_id=${literal(mail.inboundEmailMessageId)};`)).toBe(1)
  const outboundMatch=await matchOutboundRequestForInbound({companyId:f.companyId,parsed:mail.parsed,inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId})
  const meteringPointMatch=await matchMeteringPointForInbound({companyId:f.companyId,parsed:mail.parsed})
  const transportCustody=mailCustody(mail)
  assert.equal(transportCustody.raw,raw);assert.equal(transportCustody.parsedRaw,raw)
  const code=negativeField==='202'?'PRODAT_UNKNOWN':'Z04'
  const profilePremise=negativeField==='202'||negativeField==='311'&&!EdifactEnvelopeCodec.decode(raw).applicationReference
    ?sql<Row>(`WITH receipt AS (SELECT received_at::date AS receipt_day FROM public.inbound_email_messages WHERE id=${literal(mail.inboundEmailMessageId)}),
      profiles AS (SELECT mp.profile_key FROM public.ediel_message_profiles mp JOIN public.ediel_rule_packs rp ON rp.id=mp.rule_pack_id CROSS JOIN receipt
        WHERE mp.is_enabled=true AND mp.profile->>'family'='PRODAT' AND mp.message_code=${literal(code)} AND mp.direction IN('inbound','both')
          AND rp.status IN('active','future') AND rp.valid_from<=receipt.receipt_day AND (rp.valid_to IS NULL OR rp.valid_to>=receipt.receipt_day))
      SELECT jsonb_build_object('code',${literal(code)},'day',(SELECT receipt_day FROM receipt),'count',(SELECT count(*) FROM profiles),
        'profileKeys',(SELECT coalesce(jsonb_agg(profile_key ORDER BY profile_key),'[]') FROM profiles));`):null
  const observation=await observePublicBirth(()=>createInboundEdielMessage({companyId:f.companyId,actorUserId:f.actorUserId,environment:'test',inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId,parsed:mail.parsed,outboundMatch,meteringPointMatch}))
  if(negativeField===undefined&&observation.threw)throw observation.thrown
  assert.deepEqual(mailCustody(mail),transportCustody,'public_birth_preserves_retained_transport_and_parse')
  if(!observation.id){
    const birthRefusal=requireBirthRefusal(negativeField,raw,observation,profilePremise),authority=absentBirthAuthority(mail)
    assert.deepEqual(authority,{sources:[],receptions:[],technicalBirths:[],receivedSources:[],contexts:[]})
    return {mail,message:null,birthRefusal,authority,transportCustody}
  }
  const id=observation.id
  const message=(await getEdielMessageById(id))!
  expect(message.raw_payload).toBe(raw);expect(message.company_id).toBe(f.companyId)
  if(expectedSubtype)expect(message.rule_profile_key).toBe(`PRODAT:Z04:${expectedSubtype}:26.A:r3`)
  const rows=sql<Row[]>(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') FROM gridex_ediel_inbound_receptions.receptions r WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(id)};`)
  expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({classification:'first_reception',canonical_payload_hash:digest(raw),received_payload_hash:digest(raw)})
  return {mail,message,transportCustody}
}
async function sendAcks(f:Fixture,m:EdielMessageRow){
  const result=await supabaseService.from('ediel_messages').select('*').eq('company_id',f.companyId).eq('related_message_id',m.id).eq('direction','outbound').order('message_family')
  expect(result.error).toBeNull();expect(result.data?.map(a=>[a.message_family,a.ack_outcome])).toEqual([['APERAK','positive'],['CONTRL','positive']])
  for(const a of result.data??[]){
    await sendEdielMessageViaSmtp(a as EdielMessageRow,{actorUserId:f.actorUserId,smtpMimeMode:'nodemailer-attachment'})
    const sent=(await getEdielMessageById(a.id))!;expect(sent.status).toBe('sent')
    expect(validateEdifactEnvelope(sent.raw_payload).ok).toBe(true)
    expect(readPhysicalAckSourceCorrelation(sent,m).classification.outcome).toBe('positive')
    expect(sent.related_message_id).toBe(m.id)
  }
}
async function latePhysicalAck(f:Fixture,family:'CONTRL'|'APERAK'){
  const params={actorUserId:f.actorUserId,sourceMessage:{...f.originalZ03,direction:'inbound' as const},outcome:'positive' as const}
  const raw=(family==='CONTRL'?buildContrlDraft(params):buildAperakDraft(params)).rawPayload!
  const {message}=await receive(f,raw);expect(message).not.toBeNull()
  await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:message!.id})
  expect(await readCommittedInboundAck({actorUserId:f.actorUserId,message:(await getEdielMessageById(message!.id))!}))
    .toMatchObject({kind:'exact_receipt',sourceMessageId:f.originalZ03.id})
}
async function confirm(f:Fixture,raw=wire(f)){
  f.invoiceBaseline=activationSnapshot(f);requireNoInvoices(f.invoiceBaseline)
  expect((await getEdielMessageById(f.originalZ03.id))?.aperak_status).toBe('pending')
  const {message}=await receive(f,raw,f.subtype);expect(message).not.toBeNull()
  f.confirmation=message!;await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:message!.id})
  const own=periods(f);expect(own).toHaveLength(1)
  expect(own[0]).toMatchObject({company_id:f.companyId,customer_id:f.customerId,metering_point_id:f.pointId,source_switch_request_id:f.switchId,
    source_message_id:message!.id,status:'confirmed_by_grid_owner',start_date:f.requestedStartDate})
  expect(Date.parse(String(own[0].market_start_at))).toBe(Date.parse(f.startAt));f.periodId=String(own[0].id)
  const before=activationSnapshot(f);requireNoInvoices(before);expect(before.activations).toEqual([]);expect(before.billing_basis).toBeNull()
  requireProspectiveContract(before)
  const immutable=sourceCustody(f,message!)
  await sendAcks(f,message!)
  for(const family of ['CONTRL','APERAK'] as const)await latePhysicalAck(f,family)
  expect(activationSnapshot(f)).toEqual(before);expect(originalSeal(f)).toEqual(f.originalSeal);expect(sourceCustody(f,message!)).toEqual(immutable)
  const effects=business(f)
  await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:message!.id})
  expect(business(f)).toEqual(effects)
  const duplicateBefore=activationSnapshot(f)
  await expect(receive(f,message!.raw_payload!)).rejects.toMatchObject({name:'InboundReceptionHeldError',reception:{
    sourceMessageId:message!.id,classification:'protocol_duplicate',status:'held',businessEffectAuthorized:false}})
  expect(business(f)).toEqual(effects);expect(activationSnapshot(f)).toEqual(duplicateBefore)
  const receptions=sql<Row[]>(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY classification),'[]') FROM gridex_ediel_inbound_receptions.receptions r WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(message!.id)};`)
  expect(receptions).toEqual([expect.objectContaining({classification:'first_reception',canonical_payload_hash:digest(message!.raw_payload!)}),
    expect.objectContaining({classification:'protocol_duplicate',canonical_payload_hash:digest(message!.raw_payload!),received_payload_hash:digest(message!.raw_payload!)})])
  f.confirmed=activationSnapshot(f)
}
// Independent P26.A-r3 physical omission oracle. Expected fields do not come
// from the runtime matrix. Electrical L/LK exclude gas240/320 and D-only319.
const required=['311','312','202','203','313','205','206','207','208','314','209','210','508','213','217','306','222','223','254','242','224','260','226','227','228','231','232','316','233','234','262']
// Own supplied259 selects reading214/218. Omitting259 removes that declaration
// and cannot be relabelled as proof of a separately known reading prerequisite.
const selectedDependent=['214','218','250','251','253','317','318']
// A supplied address does not establish the sender's knowledge after omission.
// These separate controls prove supplied-format refusal, not missing229/252.
const malformedSuppliedAddressFields=['229','252'] as const
function omit(raw:string,field:string){
  if(field==='209')return omitRequired209(raw)
  const special:Record<string,[string,string]>={'210':['DTM','92'],'508':['DTM','354'],'213':['QTY','31'],'224':['RFF','MG']}
  const chars:Record<string,string>={'217':'Z04','306':'Z07','222':'Z12','254':'Z15','242':'Z14','214':'Z02','218':'Z05','259':'Z16'}
  if(!special[field]&&!chars[field])return omitSupplyEndField(raw,field)
  const p=tokenizeEdifact(raw),out:string[]=[];let drop=false,removed=false
  for(const s of p.segments){
    if(chars[field]&&s.tag==='CCI')drop=segmentComposite(s,2,p.una)[0]===chars[field]
    if(chars[field]&&drop&&['CCI','CAV'].includes(s.tag)){removed=true;continue}
    if(special[field]&&s.tag===special[field][0]&&segmentComposite(s,1,p.una)[0]===special[field][1]){removed=true;continue}
    out.push(s.raw)
  }
  expect(removed,'missing physical omission premise '+field).toBe(true)
  const a=out.findIndex(x=>x.startsWith('UNH+')),b=out.findIndex(x=>x.startsWith('UNT+'));expect(b).toBeGreaterThan(a)
  const trailer=out[b].split('+');trailer[1]=String(b-a+1);out[b]=trailer.join('+')
  return serializeUna(p.una)+out.join(p.una.segmentTerminator)+p.una.segmentTerminator
}
function withInvoicee(raw:string){
  const d=EdifactEnvelopeCodec.decode(raw),a=d.segments.findIndex(s=>s.tag==='UNH'),b=d.segments.findIndex(s=>s.tag==='UNT')
  const body=d.segments.slice(a+1,b).map(s=>s.raw)
  expect(body.some(x=>x.startsWith('NAD+IV'))).toBe(false)
  body.push('NAD+IV+5566778899:SE1:260++Synthetic invoicee+Invoice street+Stockholm++11122+SE')
  return EdifactEnvelopeCodec.encode({sender:d.sender!,receiver:d.receiver!,senderQualifier:d.senderQualifier,receiverQualifier:d.receiverQualifier,
    applicationReference:d.applicationReference,environment:d.environment,acknowledgementRequest:true,interchangeReference:randomUUID().replaceAll('-','').slice(0,14),
    messages:[{messageReference:randomUUID().slice(0,14),messageTypeToken:d.segments[a].elements[2],businessSegments:body}]})
}
function malformSuppliedAddress(raw:string,field:'229'|'252'){
  const p=tokenizeEdifact(raw),role=field==='229'?'UD':'IV'
  const parties=p.segments.filter(s=>s.tag==='NAD'&&segmentComposite(s,1,p.una)[0]===role)
  assert.equal(parties.length,1,'one_own_supplied_address_party_required')
  const target=parties[0],address=segmentComposite(target,5,p.una)
  assert.equal(address.length,1,'single_supplied_address_component_required')
  assert(address[0]&&address[0].length<=35,'valid_supplied_address_before_format_mutation_required')
  const parts=target.raw.split(p.una.dataElementSeparator)
  parts[5]='A'.repeat(36)
  return serializeUna(p.una)+p.segments.map(s=>s===target?parts.join(p.una.dataElementSeparator):s.raw)
    .join(p.una.segmentTerminator)+p.una.segmentTerminator
}
type HeldCause={field:string;missing209HealthyRaw?:string;syntaxHealthyRaw?:string}|{dimension:'customerIdentity'|'point'|'start'|'reason';reasons:string[]}|{party:'sender'}|{party:'receiver';healthyRaw:string}|{cancelled:true}
// This explicit contrast has one earlier routing owner. Freeze the healthy
// physical source before changing only its own NAD+DO identifier; random
// interchange/message references and every other supplied field stay identical.
function requireReceiverPartyContrast(f:Fixture,raw:string,healthyRaw:string){
  const healthy=tokenizeEdifact(healthyRaw),received=tokenizeEdifact(raw)
  assert.deepEqual(received.una,healthy.una,'receiver_contrast_preserves_service_advice')
  const own=healthy.segments.filter(s=>s.tag==='NAD'&&segmentComposite(s,1,healthy.una)[0]==='DO')
  const held=received.segments.filter(s=>s.tag==='NAD'&&segmentComposite(s,1,received.una)[0]==='DO')
  assert.equal(own.length,1,'one_healthy_own_DO_required');assert.equal(held.length,1,'one_held_own_DO_required')
  const originalParty=segmentComposite(own[0],2,healthy.una),receivedParty=segmentComposite(held[0],2,received.una)
  assert.equal(originalParty[0],f.sender,'healthy_DO_is_own_original_supplier')
  assert(receivedParty[0]&&receivedParty[0]!==originalParty[0],'receiver_contrast_changes_own_DO_identifier')
  assert.deepEqual(receivedParty.slice(1),originalParty.slice(1),'receiver_contrast_preserves_DO_qualifiers')
  const parts=own[0].raw.split(healthy.una.dataElementSeparator)
  parts[2]=[receivedParty[0],...originalParty.slice(1)].join(healthy.una.componentDataElementSeparator)
  assert.deepEqual(received.segments.map(s=>s.raw),healthy.segments.map(s=>s===own[0]?parts.join(healthy.una.dataElementSeparator):s.raw),
    'receiver_contrast_changes_only_own_DO_identifier')
  return {healthyRawHash:digest(healthyRaw),heldRawHash:digest(raw),ownReceiver:originalParty[0],heldReceiver:receivedParty[0]}
}
function messageEvents(f:Fixture,id:string){return sql<Row[]>(`SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY id),'[]') FROM public.ediel_message_events e
  WHERE company_id=${literal(f.companyId)} AND (ediel_message_id=${literal(id)} OR message_id=${literal(id)});`)}
function requireOwnEvent(event:Row,f:Fixture,id:string){
  assert.equal(event.company_id,f.companyId);assert.equal(event.ediel_message_id,id);assert.equal(event.message_id,id)
  assert.equal(event.created_by,f.actorUserId);assert.deepEqual(event.event_payload,event.payload)
}
function physicalSingleScope(raw:string){
  const wire=tokenizeEdifact(raw),unh=wire.segments.filter(s=>s.tag==='UNH'),lines=wire.segments.filter(s=>s.tag==='LIN')
  assert.equal(unh.length,1);assert.equal(lines.length,1,'one_physical_fixture_register_required')
  const point=segmentComposite(lines[0],3,wire.una)
  assert.equal(segmentComposite(lines[0],2,wire.una).join(''),'','single_register_has_no_C829')
  return {messageIndex:0,messageReference:segmentComposite(unh[0],1,wire.una)[0],objectId:point[0],identityAgency:point[3],
    registers:[{lineIndex:0,segmentIndex:lines[0].index,lineNumber:segmentComposite(lines[0],1,wire.una)[0],registerIndex:null,registerPosition:1}]}
}
function requireHeldDomainAudit(f:Fixture,id:string,raw:string,reason:string,events:Row[],beforeIds:string[]){
  const own=events.filter(e=>!beforeIds.includes(String(e.id))&&e.event_type==='validated'&&e.payload&&typeof e.payload==='object'
    &&Object.hasOwn(e.payload,'sourceObjectPartition'))
  assert.equal(own.length,1,'one_new_actual_all_held_public_owner_audit_required')
  const event=own[0];requireOwnEvent(event,f,id);assert.equal(event.event_status,'warning')
  const payload=event.payload as Row
  assert.equal(payload.applied,false);assert.equal(payload.fullyApplied,false);assert.equal(payload.reviewRequired,true)
  assert.equal(payload.idempotent,false);assert.equal(payload.permissionResults,null)
  assert.deepEqual(payload.committedEffectReceiptIds,[])
  assert.deepEqual(payload.sourceObjectPartition,[{object:physicalSingleScope(raw),disposition:'held',reason}])
  assert(!events.some(e=>!beforeIds.includes(String(e.id))&&(e.payload as Row|undefined)?.supplySourceApply==='rolled_back'),'rollback_is_not_a_domain_refusal')
  return event
}
function hasFieldDiagnostic(issues:unknown,field:string){return Array.isArray(issues)&&issues.some(issue=>
  issue&&typeof issue==='object'&&issue.prodatDiagnostic?.kind==='field'&&issue.prodatDiagnostic.fieldNumber===field)}
function requireFieldOwnerAudit(f:Fixture,message:EdielMessageRow,raw:string,field:string,events:Row[],beforeIds:string[]){
  const fresh=events.filter(e=>!beforeIds.includes(String(e.id))),canonical=fresh.filter(e=>e.event_type==='validated'&&(e.payload as Row|undefined)?.batch==='2.5B')
  assert.equal(message.raw_payload,raw);assert.equal((message as EdielMessageRow&{immutable_payload_hash:string}).immutable_payload_hash,digest(raw))
  if(canonical.length){
    assert.equal(canonical.length,1);const event=canonical[0];requireOwnEvent(event,f,message.id)
    const report=message.validation_report as Row,runtime=report.canonicalRuntime as Row
    assert(runtime&&hasFieldDiagnostic(runtime.issues,field),'actual_persisted_canonical_field_diagnostic_required')
    assert(report.syntaxDecision==='rejected'||report.applicationDecision==='rejected'
      ||(report.prodatProcessingDisposition as Row|undefined)?.kind==='internal_review','actual_field_refusal_disposition_required')
    assert.equal(event.event_status,'warning');return {kind:'canonical_field_owner',field,event,report}
  }
  // Party/header routing is an earlier owner. Never accept this branch for
  // unrelated fields or replace the domain partition with a generic warning.
  assert(['207','208'].includes(field),'unexpected_early_field_processing_stop')
  const stopped=fresh.filter(e=>e.event_type==='manual_note'&&(e.payload as Row|undefined)?.ackDecision==='no_negative_contrl_for_routing_unresolved')
  assert.equal(stopped.length,1);requireOwnEvent(stopped[0],f,message.id);assert.equal(stopped[0].event_status,'warning')
  const status=(stopped[0].payload as Row).tenantResolutionStatus
  assert(['tenant_not_found','tenant_ambiguous'].includes(String(status)))
  const routed=fresh.filter(e=>e.event_type==='manual_note'&&(e.payload as Row|undefined)?.referenceFallbackAllowed===false&&(e.payload as Row).issueType===status)
  assert.equal(routed.length,1);requireOwnEvent(routed[0],f,message.id)
  const wire=tokenizeEdifact(raw),snapshot=(routed[0].payload as Row).snapshot as Row
  assert.equal(snapshot.messageReference,segmentComposite(wire.segments.find(s=>s.tag==='UNH')!,1,wire.una)[0])
  assert.equal(snapshot.bgmReference,segmentComposite(wire.segments.find(s=>s.tag==='BGM')!,2,wire.una)[0])
  return {kind:'exact_party_tenant_routing_owner',field,stopped:stopped[0],routing:routed[0]}
}
function positiveAperaks(f:Fixture){return sql<Row[]>(`SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY id),'[]') FROM public.ediel_messages m
  WHERE company_id=${literal(f.companyId)} AND message_family='APERAK' AND ack_outcome='positive';`)}
function pointOriginalCohort(f:Fixture,point:string){return sql<string[]>(`SELECT coalesce(jsonb_agg(DISTINCT s.outbound_z03_message_id ORDER BY s.outbound_z03_message_id),'[]')
  FROM public.supplier_switch_requests s JOIN public.metering_points p ON p.id=s.metering_point_id AND p.company_id=s.company_id
  WHERE s.company_id=${literal(f.companyId)} AND p.ediel_metering_point_id=${literal(point)} AND s.outbound_z03_message_id IS NOT NULL;`)}
type ValidationInput=Parameters<typeof receivedSourceValidationLedger.recordReceivedSourceValidation>[0]
type ValidationReceipt=Awaited<ReturnType<typeof receivedSourceValidationLedger.recordReceivedSourceValidation>>
type RpcObservation={args:Row;result:unknown;thrown:unknown;rejected:boolean;consumptions:number;abortSignals:unknown[]}
type ProcessingObservation={processInput:{actorUserId:string;edielMessageId:string};recorderCalls:number;
  input:ValidationInput|null;receipt:ValidationReceipt|null;recorderError:unknown;recorderThrew:boolean;rpc:RpcObservation[];error:unknown;threw:boolean}
function errorFacts(error:unknown):Row{
  if(error===undefined)return {type:'undefined'}
  if(error===null)return {type:'null',value:null}
  if(typeof error!=='object')return {type:typeof error,value:typeof error==='string'||typeof error==='boolean'
    ||typeof error==='number'&&Number.isFinite(error)?error:String(error)}
  const value=error as Row,result:Row={}
  for(const key of ['name','message','code','details','hint','stack'])if(typeof value[key]==='string')result[key]=value[key]
  return Object.keys(result).length?result:{type:typeof error}
}
// Observe only the owner's ONE consumption. A second await of a PostgREST
// builder would execute another request; no observer starts a request here.
function observeRpcThenable<T extends object>(target:T,observation:RpcObservation):T{
  const proxy=new Proxy(target,{get(object,key){
    const value=Reflect.get(object,key,object)
    if(typeof value!=='function')return value
    if(key==='then')return (fulfilled:unknown,rejected:unknown)=>{
      observation.consumptions++
      return Reflect.apply(value,object,[(result:unknown)=>{observation.result=result
        return typeof fulfilled==='function'?fulfilled(result):result},(error:unknown)=>{observation.thrown=error;observation.rejected=true
        if(typeof rejected==='function')return rejected(error);throw error}])
    }
    return (...args:unknown[])=>{
      if(key==='abortSignal')observation.abortSignals.push(args[0])
      const result=Reflect.apply(value,object,args)
      return result===object?proxy:result
    }
  }})
  return proxy
}
function validationSnapshot(f:Fixture,message:EdielMessageRow){
  const tables=['validation_assessments','prodat_ignored_field_facets','prodat_object_validation_facets',
    'prodat_response_facets','prodat_application_facets','prodat_source_function_facets']
  return sql<Row>('SELECT jsonb_build_object('+tables.map(table=>`${literal(table)},(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),'[]')
    FROM gridex_received_sources.${table} x WHERE company_id=${literal(f.companyId)} AND environment='test' AND source_message_id=${literal(message.id)})`).join(',')+');')
}
async function observeHeldProcessing(f:Fixture,message:EdielMessageRow,attempt:Row):Promise<ProcessingObservation>{
  const observation:ProcessingObservation={processInput:{actorUserId:f.actorUserId,edielMessageId:message.id},
    recorderCalls:0,input:null,receipt:null,recorderError:null,recorderThrew:false,rpc:[],error:null,threw:false}
  const recorder=vi.spyOn(receivedSourceValidationLedger,'recordReceivedSourceValidation'),originalRpc=supabaseService.rpc
  const rpc=vi.spyOn(supabaseService,'rpc').mockImplementation(function(this:typeof supabaseService,...args:Parameters<typeof originalRpc>){
    const builder=Reflect.apply(originalRpc,this,args) as ReturnType<typeof originalRpc>
    if(args[0]!=='gridex_record_prodat_source_validation_v6')return builder
    const entry:RpcObservation={args:args[1] as Row,result:null,thrown:null,rejected:false,consumptions:0,abortSignals:[]}
    observation.rpc.push(entry)
    return observeRpcThenable(builder,entry)
  })
  try{await processInboundEdielMessage(observation.processInput)}catch(error){observation.error=error;observation.threw=true}
  finally{
    try{
      observation.recorderCalls=recorder.mock.calls.length
      observation.input=recorder.mock.calls[0]?.[0]??null
      // The recorder is a REAL Promise, already consumed by its owner. Reading
      // this same Promise does not execute the lazy RPC builder a second time.
      if(recorder.mock.results[0]?.type==='return'){
        try{observation.receipt=await recorder.mock.results[0].value}catch(error){observation.recorderError=error;observation.recorderThrew=true}
      }
      const input=observation.input
      attempt.processing={processInput:observation.processInput,recorderCalls:observation.recorderCalls,
        original:input?{id:input.original.id,companyId:input.original.company_id,rawHash:digest(input.original.raw_payload??'')}:null,
        validated:input?{id:input.validated.id,companyId:input.validated.company_id,rawHash:digest(input.validated.raw_payload??'')}:null,
        decision:input?{syntax:input.decision.syntaxDecision,application:input.decision.applicationDecision,
          functional:input.decision.functionalDecision,register:input.decision.prodatRegisterValidation,
          issues:input.decision.issues,hash:digest(JSON.stringify(input.decision))}:null,
        receipt:observation.receipt,recorderThrew:observation.recorderThrew,recorderError:errorFacts(observation.recorderError),threw:observation.threw,error:errorFacts(observation.error),
        rpc:observation.rpc.map(call=>({args:call.args,consumptions:call.consumptions,abortSignalCount:call.abortSignals.length,
          result:call.result,rejected:call.rejected,thrown:errorFacts(call.thrown)}))}
      persist()
    }finally{rpc.mockRestore();recorder.mockRestore()}
  }
  return observation
}
function requireAgency209Refusal(f:Fixture,message:EdielMessageRow,raw:string,observation:ProcessingObservation,
  before:Row,after:Row,cause:HeldCause){
  assert('field'in cause&&cause.field==='209','only_physical_agency209_may_use_source_guard')
  assert.equal(observation.threw,true);assert(observation.error instanceof Error);assert.equal(observation.error.message,'prodat_canonical_source_validation_unconfirmed')
  assert.deepEqual(observation.processInput,{actorUserId:f.actorUserId,edielMessageId:message.id})
  assert.equal(observation.recorderCalls,1);assert.equal(observation.recorderThrew,false);assert.equal(observation.recorderError,null)
  const input=observation.input;assert(input,'actual_same_invocation_recorder_input_required')
  for(const source of [message,input.original,input.validated]){
    assert.equal(source.id,message.id);assert.equal(source.company_id,f.companyId);assert.equal(source.environment,'test')
    assert.equal(source.direction,'inbound');assert.equal(source.message_family,'PRODAT');assert.equal(source.message_code,'Z04')
    assert.equal(source.raw_payload,raw)
  }
  assert.equal((message as EdielMessageRow&{immutable_payload_hash:string}).immutable_payload_hash,digest(raw))
  assert.equal(input.resolvedCompanyId,f.companyId)
  const physical=physicalSingleScope(raw)
  assert.equal(physical.messageIndex,0);assert.equal(typeof physical.messageReference,'string');assert(physical.messageReference)
  assert.equal(physical.objectId,f.external);assert.equal(physical.identityAgency,'ZZ')
  const tokens=tokenizeEdifact(raw),li=tokens.segments.filter(s=>s.tag==='RFF'&&segmentComposite(s,1,tokens.una)[0]==='LI')
  assert.equal(li.length,1);assert.deepEqual(segmentComposite(li[0],1,tokens.una),['LI',f.caseReference])
  const envelope=EdifactEnvelopeCodec.decode(raw)
  assert.equal(envelope.applicationReference,'23-DDQ-PRODAT');assert.equal(envelope.sender,f.receiver);assert.equal(envelope.receiver,f.sender)
  for(const [role,expected]of [['FR',f.receiver],['DO',f.sender]]){
    const parties=tokens.segments.filter(s=>s.tag==='NAD'&&segmentComposite(s,1,tokens.una)[0]===role)
    assert.equal(parties.length,1);assert.equal(segmentComposite(parties[0],2,tokens.una)[0],expected)
  }
  const pair=sql<{original:Row;received:Row}>(`SELECT jsonb_build_object('original',gridex_received_sources.normal_switch_wire_v1(${literal(f.originalZ03.raw_payload)}),'received',gridex_received_sources.normal_switch_wire_v1(${literal(raw)}));`)
  const original=(pair.original.objects as Row[])[0],received=(pair.received.objects as Row[])[0]
  for(const key of ['point','li','customerIdentity','start','reason'])assert.deepEqual(received[key],original[key],'agency_only_preserves_original_'+key)
  assert.equal(original.point,f.external);assert.equal(original.li,f.caseReference)
  const decision=input.decision
  assert.equal(decision.syntaxDecision,'accepted');assert.equal(decision.applicationDecision,'rejected');assert.equal(decision.functionalDecision,'accepted')
  assert.equal(decision.policy?.subtype,f.subtype)
  const errors=decision.issues.filter(issue=>issue.severity==='error')
  assert(errors.length>0);assert(errors.every(issue=>issue.prodatDiagnostic?.kind==='field'&&issue.prodatDiagnostic.fieldNumber==='209'))
  const bound=buildReceivedSourceValidationEvidence(input);assert(bound,'actual_fresh_source_context_and_rule_witness_required')
  assert.equal(bound.sourceMessageId,message.id);assert.equal(bound.companyId,f.companyId);assert.equal(bound.environment,'test');assert.equal(bound.sourcePayloadHash,digest(raw))
  const facts=JSON.parse(bound.factsText) as Row,facet=facts.registerValidation as {objects:Row[]}
  assert.equal(facet.objects.length,1)
  const own=facet.objects[0],reasons=own.reasons as string[]
  assert.deepEqual({...own,reasons:[]},{...physical,disposition:'rejected',reasons:[]})
  assert(reasons.includes('FIELD_MATRIX_FIELD_FORMAT_INVALID'))
  assert(reasons.every(reason=>['FIELD_MATRIX_FIELD_FORMAT_INVALID','PRODAT_DEPENDENT_CONDITION_UNDETERMINED'].includes(reason)))
  assert.equal(observation.rpc.length,1)
  const call=observation.rpc[0];assert.equal(call.consumptions,1);assert.equal(call.abortSignals.length,1)
  assert(call.abortSignals[0] instanceof AbortSignal);assert.equal(call.rejected,false);assert.equal(call.thrown,null)
  assert.equal(call.args.p_company_id,f.companyId);assert.equal(call.args.p_environment,'test');assert.equal(call.args.p_source_message_id,message.id)
  assert.equal(call.args.p_source_payload_hash,digest(raw));assert.equal(call.args.p_facts_text,bound.factsText)
  assert.deepEqual(call.args,{p_company_id:bound.companyId,p_environment:bound.environment,p_source_message_id:bound.sourceMessageId,
    p_source_payload_hash:bound.sourcePayloadHash,p_facts_text:bound.factsText,
    p_source_function_facts_text:bound.prodatSourceFunctionValidation?JSON.stringify(bound.prodatSourceFunctionValidation):null,
    p_object_facts_text:bound.prodatObjectValidation?JSON.stringify(bound.prodatObjectValidation):null,
    p_application_facts_text:bound.prodatApplicationValidation?JSON.stringify(bound.prodatApplicationValidation):null,
    p_ignored_fields_text:bound.prodatIgnoredFields?JSON.stringify(bound.prodatIgnoredFields):null,
    p_response_facts_text:bound.prodatResponseValidation?JSON.stringify(bound.prodatResponseValidation):null})
  const result=call.result as {data:unknown;error:{code?:unknown;message?:unknown}|null}
  assert(result);assert.equal(result.data,null);assert(result.error)
  assert.equal(result.error.code,'23514');assert.equal(result.error.message,'received_register_unvalidated_scope')
  assert.deepEqual(observation.receipt,{status:'unconfirmed',sourceDisposition:'not_established'})
  assert.deepEqual(after,before,'source_guard_has_no_new_or_changed_assessment_or_facet')
  return {kind:'canonical_source_validation_agency209_guard',field:'209',sourceId:message.id,companyId:f.companyId,
    actorUserId:observation.processInput.actorUserId,rawHash:digest(raw),physical,facet,rpcError:result.error,
    receipt:observation.receipt,validationBefore:before,validationAfter:after}
}
// Whole missing209 has no register identity. Qualify only its exact source guard.
function omitRequired209(raw:string){
  const wire=tokenizeEdifact(raw),lines=wire.segments.filter(row=>row.tag==='LIN')
  assert.equal(lines.length,1,'missing209_has_one_original_LIN')
  const line=lines[0],parts=line.raw.split(wire.una.dataElementSeparator)
  assert.equal(parts.length,4,'missing209_has_no_C829')
  const identity=segmentComposite(line,3,wire.una)
  assert.equal(identity.length,4);assert(identity[0]);assert.equal(identity[3],'9')
  parts[3]='' // Omit the entire field209/C212, including the identity agency.
  return serializeUna(wire.una)+wire.segments.map(row=>row.index===line.index
    ?parts.join(wire.una.dataElementSeparator):row.raw).join(wire.una.segmentTerminator)+wire.una.segmentTerminator
}
function requireMissing209Premise(f:Fixture,raw:string,healthyRaw:string){
  assert.equal(typeof healthyRaw,'string');assert.equal(raw,omitRequired209(healthyRaw),'only_whole_C212_differs_from_healthy_prebirth_wire')
  const healthy=physicalSingleScope(healthyRaw),physical=physicalSingleScope(raw)
  assert.equal(healthy.objectId,f.external);assert.equal(healthy.identityAgency,'9')
  assert.equal(physical.objectId,'');assert.equal(physical.identityAgency,undefined)
  const wire=tokenizeEdifact(raw),lines=wire.segments.filter(row=>row.tag==='LIN')
  assert.equal(lines.length,1);assert.deepEqual(segmentComposite(lines[0],3,wire.una),[''])
  assert.equal(lines[0].raw,`LIN${wire.una.dataElementSeparator}1${wire.una.dataElementSeparator}${wire.una.dataElementSeparator}`)
  for(const tag of ['UNB','UNH','BGM'])assert.equal(wire.segments.filter(row=>row.tag===tag).length,1)
  const envelope=EdifactEnvelopeCodec.decode(raw)
  assert.equal(envelope.applicationReference,'23-DDQ-PRODAT');assert.equal(envelope.sender,f.receiver);assert.equal(envelope.receiver,f.sender)
  for(const [role,id]of [['FR',f.receiver],['DO',f.sender],['IT',f.external],['UD',f.customerIdentity.id]]){
    const parties=wire.segments.filter(row=>row.tag==='NAD'&&segmentComposite(row,1,wire.una)[0]===role)
    assert.equal(parties.length,1);assert.equal(segmentComposite(parties[0],2,wire.una)[0],id)
  }
  const li=wire.segments.filter(row=>row.tag==='RFF'&&segmentComposite(row,1,wire.una)[0]==='LI')
  assert.equal(li.length,1);assert.deepEqual(segmentComposite(li[0],1,wire.una),['LI',f.caseReference])
  const starts=wire.segments.filter(row=>row.tag==='DTM'&&segmentComposite(row,1,wire.una)[0]==='92')
  assert.equal(starts.length,1);assert.deepEqual(segmentComposite(starts[0],1,wire.una),['92',f.requestedStartDate.replaceAll('-','')+'0000','203'])
  for(const [qualifier,value]of [['Z13',f.subtype==='L'?'Z22':'Z23'],['Z16','101']]){
    const cci=wire.segments.filter(row=>row.tag==='CCI'&&segmentComposite(row,2,wire.una)[0]===qualifier)
    assert.equal(cci.length,1)
    const cav=wire.segments[cci[0].index+1];assert.equal(cav.tag,'CAV')
    assert.deepEqual(segmentComposite(cav,1,wire.una),qualifier==='Z13'?[value]:['','','',value])
  }
  return {physical:{...physical,objectId:null,identityAgency:null},healthyRawHash:digest(healthyRaw),rawHash:digest(raw)}
}
function requireMissing209Refusal(f:Fixture,message:EdielMessageRow,raw:string,observation:ProcessingObservation,
  before:Row,after:Row,cause:HeldCause){
  assert('field'in cause&&cause.field==='209'&&typeof cause.missing209HealthyRaw==='string','only_exact_whole_missing209_source_guard')
  const premise=requireMissing209Premise(f,raw,cause.missing209HealthyRaw)
  assert.equal(observation.threw,true);assert(observation.error instanceof Error)
  assert.equal(observation.error.message,'prodat_canonical_source_validation_unconfirmed')
  assert.deepEqual(observation.processInput,{actorUserId:f.actorUserId,edielMessageId:message.id})
  assert.equal(observation.recorderCalls,1);assert.equal(observation.recorderThrew,false);assert.equal(observation.recorderError,null)
  const input=observation.input;assert(input,'actual_same_invocation_missing209_recorder_input_required')
  for(const source of [message,input.original,input.validated]){
    assert.equal(source.id,message.id);assert.equal(source.company_id,f.companyId);assert.equal(source.environment,'test')
    assert.equal(source.direction,'inbound');assert.equal(source.message_standard,'edifact')
    assert.equal(source.message_family,'PRODAT');assert.equal(source.message_code,'Z04');assert.equal(source.raw_payload,raw)
  }
  assert.equal((message as EdielMessageRow&{immutable_payload_hash:string}).immutable_payload_hash,digest(raw))
  assert.equal(input.resolvedCompanyId,f.companyId)
  const decision=input.decision,policy=decision.policy;assert(policy)
  assert.equal(policy.family,'PRODAT');assert.equal(policy.code,'Z04');assert.equal(policy.subtype,f.subtype)
  assert.equal(policy.direction,'inbound');assert.equal(policy.applicationReference,'23-DDQ-PRODAT')
  assert.equal(policy.prodatDependentFacts?.meterReadingsSentInUtilts,undefined)
  assert.equal(policy.prodatDependentFacts?.registerObjects,undefined,'missing_point_has_no_borrowed_own_reading_authority')
  assert.equal(decision.syntaxDecision,'accepted');assert.equal(decision.applicationDecision,'rejected');assert.equal(decision.functionalDecision,'accepted')
  assert.equal(decision.prodatProcessingDisposition?.kind,'continue')
  assert.equal(decision.issues.length,4,'only_required209_and_three_honest_reading_unknowns')
  const errors=decision.issues.filter(issue=>issue.severity==='error')
  assert.equal(errors.length,1);assert.equal(errors[0].code,'FIELD_MATRIX_REQUIRED_FIELD_MISSING')
  const diagnostic=errors[0].prodatDiagnostic
  assert(diagnostic?.kind==='field');assert.equal(diagnostic.fieldNumber,'209');assert.equal(diagnostic.errorKind,'missing')
  assert.equal(diagnostic.occurrence.objectId,null);assert.equal(diagnostic.occurrence.identityAgency,null)
  assert.equal(diagnostic.occurrence.lineItemReference,f.caseReference);assert.equal(diagnostic.occurrence.lineIndex,0)
  const unknowns=decision.issues.filter(issue=>issue.code==='PRODAT_DEPENDENT_CONDITION_UNDETERMINED')
  assert.equal(unknowns.length,3)
  for(const unknown of unknowns){
    assert.equal(unknown.severity,'warning');assert.equal(unknown.originalSeverity,'error')
    assert.equal(unknown.prodatDiagnostic?.kind,'local_unknown')
    assert.equal(unknown.prodatDiagnostic?.sourceRule,'PRODAT26A:register-readings')
  }
  const bound=buildReceivedSourceValidationEvidence(input);assert(bound,'actual_locked_source_witness_and_all_binders_required')
  assert.equal(bound.sourceMessageId,message.id);assert.equal(bound.companyId,f.companyId);assert.equal(bound.environment,'test');assert.equal(bound.sourcePayloadHash,digest(raw))
  const facts=JSON.parse(bound.factsText) as Row,witness=receivedOriginalRulePackWitness(decision.validationReport.rulePackEvidence)
  assert(witness);assert.deepEqual(facts.rulePackEvidence,witness,'all_locked_registry_snapshot_bytes_preserved')
  assert.match(witness.sourceHash,/^[a-f0-9]{64}$/);assert.equal(witness.snapshot.rulePack.source_hash,witness.sourceHash)
  assert.deepEqual(facts.reasonCodes,['FIELD_MATRIX_REQUIRED_FIELD_MISSING','PRODAT_DEPENDENT_CONDITION_UNDETERMINED'])
  const register=decision.prodatRegisterValidation;assert(register)
  assert.deepEqual(facts.registerValidation,register)
  assert.deepEqual(register,{version:1,owner:'validateProdatRegisterPolicy',coverage:'canonical_register_only',
    objects:[{...premise.physical,disposition:'unavailable',reasons:['REGISTER_SCOPE_UNAVAILABLE']}]})
  assert.deepEqual(bound.prodatObjectValidation,{version:1,owner:'canonical-full-prodat-object-validation-v1',coverage:'full_canonical_guide_objects_only',
    sharedAccepted:false,reasonCodes:facts.reasonCodes,objects:[{objectId:null,identityAgency:null,messageReference:premise.physical.messageReference,
      firstLineIndex:0,lineItemReference:f.caseReference,disposition:'unavailable',
      reasons:['REGISTER_SCOPE_UNAVAILABLE','FIELD_MATRIX_REQUIRED_FIELD_MISSING','shared_source_not_qualified'],negativeFields:['209']}]})
  assert.deepEqual(bound.prodatApplicationValidation,{version:1,owner:'canonical-prodat-application-all-v1',coverage:'canonical_own_application_only',
    headerDecision:'held',objects:[{...premise.physical,applicationDecision:'held',
      reasonCodes:['REGISTER_SCOPE_UNAVAILABLE','FIELD_MATRIX_REQUIRED_FIELD_MISSING','PRODAT_DEPENDENT_CONDITION_UNDETERMINED']}],sourcePayloadHash:digest(raw)})
  const response=bound.prodatResponseValidation;assert(response)
  assert.equal(response.version,1);assert.equal(response.sourcePayloadHash,digest(raw))
  const index=premise.physical.registers[0].segmentIndex
  assert.deepEqual(response.objects,[{lineIndex:index,registerLineIndices:[index],id:null,li:f.caseReference,outcome:'negative'}])
  assert.equal(response.responses.length,1)
  const expectedError=decision.responsePlan.filter(plan=>plan.family==='APERAK').flatMap(plan=>plan.applicationErrors??[])
  assert.equal(expectedError.length,1);assert.equal(expectedError[0].fieldCode,'209');assert.equal(expectedError[0].ercCode,'41')
  assert.deepEqual(response.responses,[{scope:'object',lineIndex:index,ercCode:'41',fieldCode:'209',text:expectedError[0].text,id:null,li:f.caseReference}])
  assert.deepEqual(bound.prodatIgnoredFields,[]);assert.equal(bound.prodatSourceFunctionValidation,undefined)
  assert.equal(observation.rpc.length,1)
  const call=observation.rpc[0];assert.equal(call.consumptions,1);assert.equal(call.abortSignals.length,1)
  assert(call.abortSignals[0] instanceof AbortSignal);assert.equal(call.rejected,false);assert.equal(call.thrown,null)
  assert.deepEqual(call.args,{p_company_id:bound.companyId,p_environment:bound.environment,p_source_message_id:bound.sourceMessageId,
    p_source_payload_hash:bound.sourcePayloadHash,p_facts_text:bound.factsText,
    p_source_function_facts_text:null,p_object_facts_text:JSON.stringify(bound.prodatObjectValidation),
    p_application_facts_text:JSON.stringify(bound.prodatApplicationValidation),p_ignored_fields_text:'[]',p_response_facts_text:JSON.stringify(response)})
  const result=call.result as {data:unknown;error:{code?:unknown;message?:unknown}|null}
  assert(result);assert.equal(result.data,null);assert(result.error)
  // This exact full-object RAISE has no ERRCODE clause. It is distinct from
  // the earlier ZZ-agency 23514/received_register_unvalidated_scope guard.
  assert.equal(result.error.code,'P0001');assert.equal(result.error.message,'prodat_full_object_reason_changed')
  assert.deepEqual(observation.receipt,{status:'unconfirmed',sourceDisposition:'not_established'})
  const tables=['validation_assessments','prodat_ignored_field_facets','prodat_object_validation_facets',
    'prodat_response_facets','prodat_application_facets','prodat_source_function_facets']
  assert.deepEqual(Object.keys(before).sort(),[...tables].sort());assert.deepEqual(after,before,'whole_missing209_has_no_new_or_changed_assessment_or_facet')
  return {kind:'canonical_source_validation_missing209_guard',field:'209',sourceId:message.id,companyId:f.companyId,actorUserId:f.actorUserId,
    ...premise,decisionHash:digest(JSON.stringify(decision)),factsHash:digest(bound.factsText),
    ruleWitnessHash:digest(JSON.stringify(witness)),ruleWitnessSnapshotHash:digest(JSON.stringify(witness.snapshot)),ruleSourceHash:witness.sourceHash,
    objectFactsHash:digest(JSON.stringify(bound.prodatObjectValidation)),applicationFactsHash:digest(JSON.stringify(bound.prodatApplicationValidation)),
    responseFactsHash:digest(JSON.stringify(response)),ignoredFactsHash:digest('[]'),
    rpcError:result.error,receipt:observation.receipt,validationBefore:before,validationAfter:after}
}

// Closed physical controls whose selected full UNSM syntax precedes the
// national field owner. Missing identity and supplied address format stay distinct.
const selectedSyntaxControls={
  '207':{role:'FR',mutation:'missing_identity',path:'NAD/C082/3039[1]',code:'UNSM_MANDATORY_ELEMENT_MISSING',description:'PRODAT:D:97A:UN: obligatoriskt NAD/C082/3039[1] saknas.'},
  '227':{role:'UD',mutation:'missing_identity',path:'NAD/C082/3039[1]',code:'UNSM_MANDATORY_ELEMENT_MISSING',description:'PRODAT:D:97A:UN: obligatoriskt NAD/C082/3039[1] saknas.'},
  '233':{role:'IT',mutation:'missing_identity',path:'NAD/C082/3039[1]',code:'UNSM_MANDATORY_ELEMENT_MISSING',description:'PRODAT:D:97A:UN: obligatoriskt NAD/C082/3039[1] saknas.'},
  '262':{role:'Z02',mutation:'missing_identity',path:'NAD/C082/3039[1]',code:'UNSM_MANDATORY_ELEMENT_MISSING',description:'PRODAT:D:97A:UN: obligatoriskt NAD/C082/3039[1] saknas.'},
  '250':{role:'IV',mutation:'missing_identity',path:'NAD/C082/3039[1]',code:'UNSM_MANDATORY_ELEMENT_MISSING',description:'PRODAT:D:97A:UN: obligatoriskt NAD/C082/3039[1] saknas.'},
  '229':{role:'UD',mutation:'supplied_address_length',path:'NAD/C059/3042[1]',code:'UNSM_ELEMENT_LENGTH_INVALID',description:'PRODAT:D:97A:UN: NAD/C059/3042[1] följer inte representation an..35.'},
  '252':{role:'IV',mutation:'supplied_address_length',path:'NAD/C059/3042[1]',code:'UNSM_ELEMENT_LENGTH_INVALID',description:'PRODAT:D:97A:UN: NAD/C059/3042[1] följer inte representation an..35.'}
} as const
function requireSelectedSyntaxRefusal(f:Fixture,message:EdielMessageRow,raw:string,observation:ProcessingObservation,
  before:Row,after:Row,events:Row[],beforeIds:string[],cause:HeldCause){
  assert('field'in cause&&Object.hasOwn(selectedSyntaxControls,cause.field)&&typeof cause.syntaxHealthyRaw==='string','only_closed_physical_control_may_use_syntax_owner')
  const control=selectedSyntaxControls[cause.field as keyof typeof selectedSyntaxControls],healthyRaw=cause.syntaxHealthyRaw
  const expectedRaw=control.mutation==='missing_identity'?omit(healthyRaw,cause.field)
    :malformSuppliedAddress(healthyRaw,cause.field as '229'|'252')
  assert.equal(raw,expectedRaw,'only_exact_selected_mutation_differs_from_healthy_prebirth_wire')
  const healthy=tokenizeEdifact(healthyRaw),wire=tokenizeEdifact(raw)
  const own=(tokens:ReturnType<typeof tokenizeEdifact>)=>tokens.segments.filter(s=>s.tag==='NAD'&&segmentComposite(s,1,tokens.una)[0]===control.role)
  const healthyParty=own(healthy),heldParty=own(wire)
  assert.equal(healthyParty.length,1);assert.equal(heldParty.length,1)
  const originalIdentity=segmentComposite(healthyParty[0],2,healthy.una)
  assert(originalIdentity[0],'healthy_selected_party_has_identifier')
  if(control.mutation==='missing_identity')assert.deepEqual(segmentComposite(heldParty[0],2,wire.una),['',...originalIdentity.slice(1)])
  else{
    const address=segmentComposite(healthyParty[0],5,healthy.una)
    assert.equal(address.length,1);assert(address[0]&&address[0].length<=35)
    assert.deepEqual(segmentComposite(heldParty[0],5,wire.una),['A'.repeat(36)])
    assert.deepEqual(segmentComposite(heldParty[0],2,wire.una),originalIdentity)
  }
  if(cause.field==='207')assert.equal(originalIdentity[0],f.receiver)
  if(cause.field==='227')assert.equal(originalIdentity[0],f.customerIdentity.id)
  const healthyScope=physicalSingleScope(healthyRaw)
  assert.equal(healthyScope.objectId,f.external);assert.equal(healthyScope.identityAgency,'9')
  const healthyLi=healthy.segments.filter(s=>s.tag==='RFF'&&segmentComposite(s,1,healthy.una)[0]==='LI')
  assert.equal(healthyLi.length,1);assert.deepEqual(segmentComposite(healthyLi[0],1,healthy.una),['LI',f.caseReference])
  const healthyIssues=[...validateFieldMatrixPayload({family:'PRODAT',code:'Z04',direction:'inbound',applicationReference:EdifactEnvelopeCodec.decode(healthyRaw).applicationReference,
    rawSegments:healthy.segments.map(s=>s.raw),una:healthy.una,mode:'parse'},canonicalProdat26AFieldRules('Z04')),
    ...evaluateProdatTransactionReason({code:'Z04',rawSegments:healthy.segments.map(s=>s.raw),una:healthy.una}).issues]
  assert.deepEqual(healthyIssues,[],'healthy_selected_control_has_no_physical_field_refusal')
  const healthySyntax=validateEdifactSyntax({...message,raw_payload:healthyRaw,status:'received',syntax_check_status:'not_checked',validation_report:{},failure_reason:null})
  assert.equal(healthySyntax.ok,true);assert.equal(healthySyntax.grammarQualification,'qualified')
  if(observation.threw)throw observation.error
  assert.equal(observation.error,null)
  assert.deepEqual(observation.processInput,{actorUserId:f.actorUserId,edielMessageId:message.id})
  assert.equal(observation.recorderCalls,1);assert.equal(observation.recorderThrew,false);assert.equal(observation.recorderError,null)
  const input=observation.input;assert(input,'actual_same_invocation_selected_syntax_recorder_input_required')
  for(const source of [message,input.original,input.validated]){
    assert.equal(source.id,message.id);assert.equal(source.company_id,f.companyId);assert.equal(source.environment,'test')
    assert.equal(source.direction,'inbound');assert.equal(source.message_standard,'edifact');assert.equal(source.message_family,'PRODAT');assert.equal(source.message_code,'Z04')
    assert.equal(source.raw_payload,raw);assert.equal(source.rule_profile_key,`PRODAT:Z04:${f.subtype}:26.A:r3`)
  }
  assert.equal((message as EdielMessageRow&{immutable_payload_hash:string}).immutable_payload_hash,digest(raw))
  assert.equal(input.resolvedCompanyId,f.companyId)
  const expectedIssue={layer:'syntax',severity:'error',code:control.code,title:'Full versionsbunden UNSM-grammatik',
    description:control.description,source:'validateEdifactSyntax'}
  const decision=input.decision
  assert.equal(decision.syntaxDecision,'rejected');assert.equal(decision.applicationDecision,'not_applicable');assert.equal(decision.functionalDecision,'not_applicable')
  assert.equal(decision.policy,null);assert.deepEqual(decision.issues,[expectedIssue])
  const syntax=validateEdifactSyntax({...message,status:'received',syntax_check_status:'not_checked',validation_report:{},failure_reason:null})
  assert.equal(syntax.ok,false);assert.equal(syntax.grammarQualification,'qualified')
  assert.deepEqual(syntax.grammarSources,healthySyntax.grammarSources,'same_selected_full_UNSM_sources')
  const grammar=validateUnsmGrammar(raw)
  assert.equal(grammar.qualification,'qualified');assert.equal(grammar.syntaxOk,false)
  assert.deepEqual(grammar.issues,[{severity:'error',code:control.code,field:control.path,description:control.description,segmentIndex:heldParty[0].index}])
  const {layer:syntaxLayer,source:syntaxSource,...syntaxIssue}=expectedIssue
  assert.equal(syntaxLayer,'syntax');assert.equal(syntaxSource,'validateEdifactSyntax');assert.deepEqual(syntax.issues,[syntaxIssue])
  assert.deepEqual(decision.validationReport.syntax,syntax);assert.deepEqual(decision.validationReport.issues,decision.issues)
  assert.equal(decision.validationReport.syntaxDecision,'rejected');assert.equal(decision.validationReport.applicationDecision,'not_applicable');assert.equal(decision.validationReport.functionalDecision,'not_applicable')
  assert.equal(decision.validationReport.canonicalPolicy,null)
  const bound=buildReceivedSourceValidationEvidence(input);assert(bound,'actual_selected_syntax_source_context_binder_required')
  const reference=segmentComposite(wire.segments.find(s=>s.tag==='UNH')!,1,wire.una)[0]
  assert.deepEqual(JSON.parse(bound.factsText),{version:1,owner:'canonical-runtime-with-registry-v1',sourceDisposition:'not_established',
    objectDisposition:'not_checked',partyDisposition:'not_checked',coverage:'canonical_runtime_only',originalTenantMatch:'matched',
    syntaxDecision:'rejected',applicationDecision:'not_applicable',functionalDecision:'not_applicable',messageReference:reference,
    reasonCodes:[control.code],rulePackEvidence:null})
  assert.deepEqual(bound,{companyId:f.companyId,environment:'test',sourceMessageId:message.id,sourcePayloadHash:digest(raw),factsText:bound.factsText})
  assert.equal(observation.rpc.length,1)
  const call=observation.rpc[0];assert.equal(call.consumptions,1);assert.equal(call.abortSignals.length,1)
  assert(call.abortSignals[0] instanceof AbortSignal);assert.equal(call.rejected,false);assert.equal(call.thrown,null)
  assert.deepEqual(call.args,{p_company_id:f.companyId,p_environment:'test',p_source_message_id:message.id,p_source_payload_hash:digest(raw),
    p_facts_text:bound.factsText,p_source_function_facts_text:null,p_object_facts_text:null,p_application_facts_text:null,p_ignored_fields_text:null,p_response_facts_text:null})
  const receipt=observation.receipt;assert(receipt&&receipt.status==='recorded','selected_syntax_has_actual_recorded_syntax_assessment')
  assert.match(receipt.assessmentId,/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/)
  assert.deepEqual(receipt,{status:'recorded',sourceDisposition:'not_established',assessmentId:receipt.assessmentId,factsHash:digest(bound.factsText)})
  const result=call.result as {data:unknown;error:unknown};assert(result);assert.equal(result.error,null)
  assert.deepEqual(result.data,{version:6,companyId:f.companyId,environment:'test',sourceMessageId:message.id,sourcePayloadHash:digest(raw),
    assessmentId:receipt.assessmentId,factsHash:receipt.factsHash,sourceDisposition:'not_established',sourceFunctionFactsHash:null,objectFactsHash:null,
    applicationFactsHash:null,ignoredFieldsHash:null,responseFactsHash:null})
  const tables=['validation_assessments','prodat_ignored_field_facets','prodat_object_validation_facets','prodat_response_facets','prodat_application_facets','prodat_source_function_facets']
  assert.deepEqual(Object.keys(before).sort(),[...tables].sort());assert.deepEqual(Object.keys(after).sort(),[...tables].sort())
  for(const table of tables){assert.deepEqual(before[table],[]);if(table!=='validation_assessments')assert.deepEqual(after[table],[])}
  const assessments=after.validation_assessments as Row[];assert.equal(assessments.length,1)
  const assessment=assessments[0]
  assert.equal(assessment.id,receipt.assessmentId);assert.equal(assessment.source_message_id,message.id);assert.equal(assessment.company_id,f.companyId);assert.equal(assessment.environment,'test')
  assert.equal(assessment.source_payload_hash,digest(raw));assert.equal(assessment.previous_assessment_id,null);assert.equal(assessment.owner,'canonical-runtime-with-registry-v1')
  assert.equal(assessment.facts_text,bound.factsText);assert.equal(assessment.facts_hash,receipt.factsHash)
  const report=message.validation_report as Row
  assert.deepEqual(report.canonicalRuntime,decision.validationReport);assert.deepEqual(report.receivedSourceValidationEvidence,receipt)
  assert.equal(report.canonicalRuntimeVersion,'2.5B');assert.deepEqual(report.responsePlan,decision.responsePlan)
  assert.deepEqual(report.sourceRules,decision.sourceRules);assert.deepEqual(report.decisionTrace,decision.decisionTrace)
  assert.equal(report.syntaxDecision,'rejected');assert.equal(report.applicationDecision,'not_applicable');assert.equal(report.functionalDecision,'not_applicable')
  const fresh=events.filter(e=>!beforeIds.includes(String(e.id))&&e.event_type==='validated'&&(e.payload as Row|undefined)?.batch==='2.5B')
  assert.equal(fresh.length,1,'one_fresh_selected_syntax_syntax_owner_event_required')
  const event=fresh[0];requireOwnEvent(event,f,message.id);assert.equal(event.event_status,'warning')
  const payload=event.payload as Row
  for(const [key,value]of Object.entries({family:'PRODAT',messageCode:'Z04',syntaxDecision:'rejected',applicationDecision:'not_applicable',functionalDecision:'not_applicable',issueCount:1,
    processGroup:decision.canonical.processGroup,responsePlan:decision.responsePlan,sourceRules:decision.sourceRules,decisionTrace:decision.decisionTrace}))assert.deepEqual(payload[key],value)
  return {kind:'canonical_selected_syntax_owner',field:cause.field,sourceId:message.id,companyId:f.companyId,actorUserId:f.actorUserId,
    healthyRawHash:digest(healthyRaw),rawHash:digest(raw),issue:expectedIssue,receipt,event,report,validationBefore:before,validationAfter:after}
}

async function held(f:Fixture,raw:string,label:string,cause:HeldCause){
  const attempt:Row={label,cause,companyId:f.companyId,actorUserId:f.actorUserId,rawHash:digest(raw),stage:'before_business_snapshot',status:'STARTED'}
  heldAttempts.push(attempt);persist()
  try{
  const before=business(f),seals=fixtures.map(originalSeal),decoyBefore=business(decoy),aperakBefore=positiveAperaks(f)
  attempt.stage='public_birth';persist()
  const {message,mail,birthRefusal,transportCustody:mailBefore}=await receive(f,raw,undefined,'field'in cause?cause.field:undefined)
  const receiverContrast='party'in cause&&cause.party==='receiver'?requireReceiverPartyContrast(f,raw,cause.healthyRaw):null
  attempt.sourceId=message?.id??null;attempt.mailId=mail.inboundEmailMessageId
  attempt.stage=receiverContrast?'receiver_routing_preflight':'canonical_preflight';persist()
  const sourceBefore=message?sourceCustody(f,message):null
  const physical=tokenizeEdifact(mail.parsed.rawPayload)
  const physicalIssues=[...validateFieldMatrixPayload({family:'PRODAT',code:'Z04',direction:'inbound',
    applicationReference:EdifactEnvelopeCodec.decode(raw).applicationReference,rawSegments:physical.segments.map(s=>s.raw),una:physical.una,mode:'parse'},canonicalProdat26AFieldRules('Z04')),
    ...evaluateProdatTransactionReason({code:'Z04',rawSegments:physical.segments.map(s=>s.raw),una:physical.una}).issues]
  // Real processing resolves tenant routing before canonical source/legal READs.
  // Only the explicit DO contrast or an own physical207/208 diagnostic may
  // defer this extra preflight; the actual fresh owner below remains mandatory.
  const routingField='field'in cause&&['207','208'].includes(cause.field)&&hasFieldDiagnostic(physicalIssues,cause.field)
  const decision=message&&!receiverContrast&&!routingField?await resolveCanonicalRuntimeDecisionWithRegistry(message,{actorUserId:f.actorUserId}):null
  const diagnostics=[...physicalIssues,...(decision?.issues??[])]
  if('field'in cause){
    if(message)expect(diagnostics,label+': own field diagnostic').toContainEqual(expect.objectContaining({
      prodatDiagnostic:expect.objectContaining({fieldNumber:cause.field})}))
    // receive() already qualified the exact public birth refusal and absence
    // of source authority; a source that was never born has no later owner.
    else assert(birthRefusal?.field===cause.field,'actual_public_birth_refusal_matches_requested_field')
  }else {
    expect(message,label+': actual source required').not.toBeNull()
    if(receiverContrast){
      expect(message,label+': actual receiver source profile').toMatchObject({direction:'inbound',message_family:'PRODAT',message_code:'Z04',rule_profile_key:`PRODAT:Z04:${f.subtype}:26.A:r3`})
      expect(validateEdifactSyntax({...message!,status:'received',syntax_check_status:'not_checked',validation_report:{},failure_reason:null}),label+': actual receiver source syntax')
        .toMatchObject({ok:true,grammarQualification:'qualified'})
      expect(physicalIssues,label+': no unrelated physical field refusal').toEqual([])
    }else expect(decision,label+': no unrelated field refusal').toMatchObject({syntaxDecision:'accepted',applicationDecision:'accepted',functionalDecision:'accepted'})
    const pair=sql<{original:Row;received:Row}>(`SELECT jsonb_build_object('original',gridex_received_sources.normal_switch_wire_v1(${literal(f.originalZ03.raw_payload)}),'received',gridex_received_sources.normal_switch_wire_v1(${literal(raw)}));`)
    const original=(pair.original.objects as Row[])[0],received=(pair.received.objects as Row[])[0]
    expect(received.li).toBe(original.li)
    if('party'in cause){
      const opposite=cause.party==='sender'?'receiver':'sender'
      expect(pair.received[cause.party],label+': own reversed party mismatch').not.toEqual(pair.original[opposite])
      expect(pair.received[opposite],label+': other reversed party unchanged').toBe(pair.original[cause.party])
      for(const key of ['point','li','customerIdentity','start','reason'])
        assert.deepEqual(received[key],original[key],'party_only_preserves_original_'+key)
    }else if('dimension'in cause)expect(received[cause.dimension],label+': frozen own correlation mismatch').not.toEqual(original[cause.dimension])
    else expect(periods(f)).toEqual([expect.objectContaining({id:f.periodId,status:'cancelled'})])
  }
  let partitions:Row[]=[],refusalReceipt:unknown=birthRefusal??null
  if(message){
    const eventBefore=messageEvents(f,message.id).map(e=>String(e.id))
    const validationBefore=validationSnapshot(f,message)
    attempt.stage='process_inbound';persist()
    const processing=await observeHeldProcessing(f,message,attempt)
    if(receiverContrast){
      if(processing.threw)throw processing.error
      assert.deepEqual(processing.processInput,{actorUserId:f.actorUserId,edielMessageId:message.id})
      assert.equal(processing.recorderCalls,0,'receiver_routing_precedes_canonical_recorder')
      assert.equal(processing.input,null);assert.equal(processing.receipt,null)
      assert.equal(processing.recorderThrew,false);assert.equal(processing.recorderError,null)
      assert.deepEqual(processing.rpc,[],'receiver_routing_has_no_source_validation_RPC')
      assert.deepEqual(validationSnapshot(f,message),validationBefore,'receiver_routing_preserves_validation_ledger')
    }
    let agencyRefusal:unknown=null,missing209Refusal:unknown=null
    if(processing.threw){
      try{
        if('field'in cause&&cause.field==='209'&&cause.missing209HealthyRaw!==undefined)
          missing209Refusal=requireMissing209Refusal(f,message,raw,processing,validationBefore,validationSnapshot(f,message),cause)
        else agencyRefusal=requireAgency209Refusal(f,message,raw,processing,validationBefore,validationSnapshot(f,message),cause)
      }
      catch(qualificationError){attempt.qualificationError=errorFacts(qualificationError);throw processing.error}
    }
    attempt.stage='post_processing_oracle';persist()
    partitions=sql<Row[]>(`SELECT coalesce(jsonb_agg(to_jsonb(p)),'[]') FROM gridex_received_sources.supply_object_partitions p WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(message.id)};`)
    expect(partitions,label+': all-held sources do not persist applied partitions').toEqual([])
    const events=messageEvents(f,message.id)
    if('party'in cause&&cause.party==='receiver'){
      refusalReceipt=requireFieldOwnerAudit(f,(await getEdielMessageById(message.id))!,raw,'208',events,eventBefore)
      assert.equal((refusalReceipt as {kind:string}).kind,'exact_party_tenant_routing_owner','receiver_party_mismatch_requires_exact_tenant_routing_owner')
    }else if(!('field'in cause)){
      const reasons='party'in cause?['normal_z04_exact_sent_original_required']:'dimension'in cause?cause.reasons:['normal_z04_locked_original_scope_required']
      assert.equal(reasons.length,1,'scenario_has_one_exact_first_refusal')
      refusalReceipt=requireHeldDomainAudit(f,message.id,raw,reasons[0],events,eventBefore)
    }else if(missing209Refusal)refusalReceipt=missing209Refusal
    else if(agencyRefusal)refusalReceipt=agencyRefusal
    else if(Object.hasOwn(selectedSyntaxControls,cause.field)&&cause.syntaxHealthyRaw!==undefined)
      refusalReceipt=requireSelectedSyntaxRefusal(f,(await getEdielMessageById(message.id))!,raw,processing,validationBefore,validationSnapshot(f,message),events,eventBefore,cause)
    else refusalReceipt=requireFieldOwnerAudit(f,(await getEdielMessageById(message.id))!,raw,cause.field,events,eventBefore)
    for(const table of ['gridex_received_sources.supply_source_transitions','gridex_received_sources.supply_object_effect_receipts'])
      assert.equal(sql<number>(`SELECT to_jsonb(count(*)) FROM ${table} WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(message.id)};`),0,'held_source_has_no_committed_effect:'+table)
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.normal_switch_confirmations WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(message.id)};`),label).toBe(0)
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND related_message_id=${literal(message.id)} AND message_family='APERAK' AND ack_outcome='positive';`),label).toBe(0)
  }
  assert(refusalReceipt,'actual_source_specific_public_refusal_required')
  attempt.stage='no_effects_and_custody';persist()
  if(message)expect(sourceCustody(f,message),label+': actual refused source custody').toEqual(sourceBefore)
  expect(positiveAperaks(f),label+': no new or changed positive business ACK').toEqual(aperakBefore)
  expect(business(f),label).toEqual(before);expect(fixtures.map(originalSeal),label).toEqual(seals);expect(business(decoy)).toEqual(decoyBefore)
  const retained=sql<{raw:string}>(`SELECT jsonb_build_object('raw',raw_edifact_payload) FROM public.inbound_email_messages WHERE id=${literal(mail.inboundEmailMessageId)} AND company_id=${literal(f.companyId)};`)
  expect(retained.raw).toBe(raw)
  expect(mailCustody(mail)).toEqual(mailBefore)
  attempt.status='COMPLETED';attempt.stage='complete'
  return {label,cause,receiverContrast,diagnostics,partitions,refusalReceipt,sourceCustody:sourceBefore,mailCustody:mailBefore,sourceId:message?.id??null,mailId:mail.inboundEmailMessageId,rawHash:digest(raw),no_market_effects:true}
  }catch(error){attempt.status='FAILED';attempt.error=errorFacts(error);throw error}
  finally{persist()}
}
async function phase(f:Fixture,relation:'strictly-before'|'at-or-after',name:string){
  const target=relation==='strictly-before'?new Date(Date.parse(f.startAt)-120000).toISOString():f.startAt
  evidence.phases.push(await advanceProspectiveMarketPhase({name,targetInstantUtc:target,actors:fixtures.map(actor),relation:{marketStartAt:f.startAt,expect:relation}}));persist()
}
async function cron(f:Fixture,relation:'strictly-before'|'at-or-after'){
  await authenticateCurrentPhaseActor(actor(f))
  vi.stubEnv('GRIDEX_AUTOMATION_USER_ID',f.actorUserId);vi.stubEnv('CUSTOMER_OPERATION_CRON_SECRET',cronSecret)
  const before=readActualMarketClocks();requireBoundary(Number(before.postgres_new_transaction.clock_ms),f.startAt,relation)
  // The real public cron has NO company selector. Its legacy sweep discovers
  // every accepted due Stockholm-date candidate, while the canonical owner
  // checks this actual principal. Preserve and attribute those refusals.
  const candidates=sql<Array<{id:string;company_id:string}>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'company_id',company_id) ORDER BY coalesce(confirmed_start_date,requested_start_date),created_at,id),'[]') FROM public.supplier_switch_requests WHERE status='accepted' AND inbound_z04_message_id IS NOT NULL AND coalesce(confirmed_start_date,requested_start_date)<=(clock_timestamp() AT TIME ZONE 'Europe/Stockholm')::date;`)
  const expectedDenials=candidates.flatMap(c=>{
    const own=fixtures.find(x=>x.switchId===c.id&&x.companyId===c.company_id)
    expect(own,'every disposable global candidate has prospective provenance').toBeDefined()
    const reason=own!.actorUserId!==f.actorUserId?'normal_supply_activation_actor_forbidden':
      Number(before.postgres_new_transaction.clock_ms)<Date.parse(own!.startAt)?'normal_supply_activation_not_due':
      Object.values(expires).includes(own!)?'normal_supply_activation_current_legal_actor_required':null
    return reason?[{requestId:c.id,companyId:c.company_id,code:'supplier_switch_activation_failed',message:reason}]:[]
  })
  // Every cron is global. Preserve all ten other prospective fixture graphs,
  // including already-active LK through L and still-future L through LK.
  const otherActors=()=>fixtures.filter(own=>own.actorUserId!==f.actorUserId).map(own=>({
    actorUserId:own.actorUserId,companyId:own.companyId,switchId:own.switchId,subtype:own.subtype,
    periodId:own.periodId??null,state:activationSnapshot(own)}))
  const otherActorBefore=otherActors()
  const response=await runCustomerOperationsCron(new NextRequest('http://127.0.0.1/api/internal/customer-operations/cron?limit=100',{headers:{authorization:'Bearer '+cronSecret}}))
  const result=await response.json() as {ok:boolean;result?:Row}
  expect(response.status,JSON.stringify(result)).toBe(200);expect(result.ok).toBe(true)
  assert(result.result,'actual_cron_result_required');requireCronResultChannels(result.result,expectedDenials)
  const after=readActualMarketClocks();requireBoundary(Number(after.postgres_new_transaction.clock_ms),f.startAt,relation)
  expect(after.postgres_new_transaction.system_identifier).toBe(before.postgres_new_transaction.system_identifier)
  expect(after.postgres_new_transaction.postmaster_started_at).toBe(before.postgres_new_transaction.postmaster_started_at)
  const otherActorComparisons=requireOtherActorMarketFactsUnchanged(f.actorUserId,otherActorBefore,otherActors())
  return {actorUserId:f.actorUserId,companyId:f.companyId,candidates,expectedDenials,before,after,response:result,otherActorComparisons}
}
async function beforeStart(subtype:Subtype){
  const f=valid[subtype],name=`Z04-${subtype}-FUTURE-BEFORE`;await phase(f,'strictly-before',name)
  const before=activationSnapshot(f),controls=[cancelled[subtype],expires[subtype],decoy]
  const controlBefore=controls.map(activationSnapshot)
  requireProspectiveContract(before)
  const run=await cron(f,'strictly-before')
  requireMarketFactsUnchanged(before,activationSnapshot(f));expect(periods(f)[0]).toMatchObject({id:f.periodId,status:'confirmed_by_grid_owner'})
  controls.forEach((control,index)=>requireMarketFactsUnchanged(controlBefore[index],activationSnapshot(control)))
  for(const own of fixtures)expect(originalSeal(own)).toEqual(own.originalSeal)
  passed(name,{subtype,originalId:f.originalZ03.id,sourceId:f.confirmation!.id,periodId:f.periodId,before,after:activationSnapshot(f),run,
    controls:controls.map((control,index)=>({companyId:control.companyId,before:controlBefore[index],after:activationSnapshot(control)}))})
}
async function atStart(subtype:Subtype){
  const f=valid[subtype],name=`Z04-${subtype}-START-AND-REPLAY`;await phase(f,'at-or-after',name)
  const decoyBefore=activationSnapshot(decoy),cancelBefore=activationSnapshot(cancelled[subtype]),expireBefore=activationSnapshot(expires[subtype])
  const run=await cron(f,'at-or-after'),at=activationSnapshot(f),[p]=periods(f)
  requireNoInvoices(at)
  expect(p).toMatchObject({id:f.periodId,status:'active',actual_start_date:f.requestedStartDate,source_message_id:f.confirmation!.id,source_switch_request_id:f.switchId})
  expect(at.activations).toEqual([expect.objectContaining({period_id:f.periodId,company_id:f.companyId,source_message_id:f.confirmation!.id,
    actor_user_id:f.actorUserId,resulting_period:expect.objectContaining({id:f.periodId,status:'active'})})])
  expect(at.switch).toMatchObject({id:f.switchId,status:'completed',outbound_z03_message_id:f.originalZ03.id,inbound_z04_message_id:f.confirmation!.id})
  expect(at.billing_basis).not.toBeNull()
  const contract=((at.graph as Row).contract as Row),confirmedContract=((f.confirmed!.graph as Row).contract as Row)
  expect(contract).toMatchObject({id:f.contractId,company_id:f.companyId,customer_id:f.customerId,metering_point_id:f.pointId,
    status:'active',lifecycle_stage:'active',actual_start_date:f.requestedStartDate,confirmed_start_date:f.requestedStartDate,
    billing_eligibility_source:'activate_customer_supply_v1',protected_contract_hash:confirmedContract.protected_contract_hash,
    activation_anchors:{supply_period_id:f.periodId,supplier_switch_request_id:f.switchId,activation_source_message_id:f.confirmation!.id}})
  const billedAt=Date.parse(String(contract.billing_eligible_at))
  expect(billedAt).toBeGreaterThanOrEqual(Number(run.before.postgres_new_transaction.clock_ms))
  expect(billedAt).toBeLessThanOrEqual(Number(run.after.postgres_new_transaction.clock_ms))
  const activationKey='ediel-normal-activation:'+f.periodId
  const events=(at.events as Row[]).filter(e=>e.idempotency_key===activationKey+':domain_event')
  expect(events).toEqual([expect.objectContaining({event_type:'supply.started',aggregate_id:f.periodId,company_id:f.companyId,payload:expect.objectContaining({supply_period_id:f.periodId,supplier_switch_request_id:f.switchId})})])
  expect((at.jobs as Row[]).filter(j=>j.idempotency_key==='lifecycle_notification:'+activationKey+':customer.welcome_active'))
    .toEqual([expect.objectContaining({company_id:f.companyId,job_type:'dispatch_lifecycle_notification',payload:expect.objectContaining({source_event_id:events[0].id,payload:expect.objectContaining({supply_period_id:f.periodId})}),request_snapshot:expect.objectContaining({supplier_switch_request_id:f.switchId,domain_event_id:events[0].id})})])
  expect(Number(run.before.postgres_new_transaction.clock_ms)-Date.parse(f.startAt)).toBeLessThan(120000)
  const controlRuns=[]
  for(const control of [cancelled[subtype],expires[subtype]])controlRuns.push(await cron(control,'at-or-after'))
  requireMarketFactsUnchanged(cancelBefore,activationSnapshot(cancelled[subtype]));requireMarketFactsUnchanged(expireBefore,activationSnapshot(expires[subtype]))
  expect((activationSnapshot(cancelled[subtype]).activations)).toEqual([]);expect((activationSnapshot(expires[subtype]).activations)).toEqual([])
  const replayBefore=activationSnapshot(f)
  const replayRun=await cron(f,'at-or-after');await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.confirmation!.id})
  requireMarketFactsUnchanged(replayBefore,activationSnapshot(f));requireMarketFactsUnchanged(decoyBefore,activationSnapshot(decoy))
  for(const own of fixtures)expect(originalSeal(own)).toEqual(own.originalSeal)
  passed(name,{subtype,originalId:f.originalZ03.id,sourceId:f.confirmation!.id,periodId:f.periodId,atStart:at,replay:activationSnapshot(f),run,
    controlRuns,replayRun,cancelled:activationSnapshot(cancelled[subtype]),expired_role:activationSnapshot(expires[subtype])})
}

describe.sequential('actual prospective normal supplier starts under one admitted clock epoch',()=>{
  beforeAll(async()=>{
    if(process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_ENVIRONMENT!=='github-hosted'||process.env.GRIDEX_Z04_FUTURE_CLOCK_CAPABILITY_ADMITTED!=='1')throw Error('z04future_admitted_disposable_hosted_clock_only')
    const state=JSON.parse(readFileSync(process.env.GRIDEX_Z04_FUTURE_CLOCK_CONTROL??'','utf8'))
    expect(state).toMatchObject({admitted:true,mode:'native'})
    configureSmtp();ordinaryDay=sql<string>(`SELECT to_jsonb((clock_timestamp()+interval '1 hour')::date);`)
    vi.stubEnv('GRIDEX_EDIEL_CASE_TEST_PASSWORD',password)
    decoy=await prospective('unrelated-decoy','L',plusDays(ordinaryDay,30))
    for(const subtype of ['LK','L'] as const){
      const day=plusDays(ordinaryDay,subtype==='L'?20:2)
      valid[subtype]=await prospective('valid-'+subtype,subtype,day)
      cancelled[subtype]=await prospective('cancelled-'+subtype,subtype,day)
      expires[subtype]=await prospective('expires-'+subtype,subtype,day,true)
      pending[subtype]=await prospective('omission-positive-control-'+subtype,subtype,plusDays(ordinaryDay,30))
      invoiceePositive[subtype]=await prospective('invoicee-positive-premise-'+subtype,subtype,plusDays(ordinaryDay,30))
    }
    for(const own of fixtures)requireNoInvoices(activationSnapshot(own))
  })
  it('Z04-T0-PROSPECTIVE-L-LK-ORIGINALS',async()=>{
    await confirm(decoy)
    const decoyBefore=business(decoy)
    for(const f of [...Object.values(valid),...Object.values(cancelled),...Object.values(expires)])await confirm(f)
    for(const f of Object.values(invoiceePositive))await confirm(f,withInvoicee(wire(f)))
    expect(business(decoy)).toEqual(decoyBefore)
    passed('Z04-T0-PROSPECTIVE-L-LK-ORIGINALS',{ordinaryDay,clock:readActualMarketClocks(),periods:fixtures.filter(f=>f.confirmation).map(f=>({subtype:f.subtype,original:f.originalZ03.id,source:f.confirmation!.id,period:f.periodId,start:f.startAt,invoice_before_business:f.invoiceBaseline,state:activationSnapshot(f)}))})
  })
  it('Z04-T0-CORRELATION-R-D-REFUSALS',async()=>{
    const results=[]
    for(const subtype of ['LK','L'] as const){
      const f=pending[subtype],base=wire(f)
      const pointContrast={ownPoint:f.external,foreignPoint:valid.L.external,ownOriginal:f.originalZ03.id,
        ownCohort:pointOriginalCohort(f,f.external),foreignCohort:pointOriginalCohort(f,valid.L.external)}
      expect(pointContrast.ownCohort).toEqual([f.originalZ03.id]);expect(pointContrast.foreignCohort).toEqual([])
      // Same LI alone is intentionally shared with the real unconfirmed own
      // original. Every negative differs physically before source birth.
      const variants:Record<string,string>={customer:wire(f).replace(f.customerIdentity.id,'198001011234'),
        point:wire(f).replaceAll(f.external,valid.L.external),start:wire(f).replaceAll(f.requestedStartDate.replaceAll('-','')+'0000',plusDays(f.requestedStartDate,1).replaceAll('-','')+'0000'),
        agency:wire(f).replace(':::9',':::ZZ'),reason:wire(f).replace('CAV+'+(subtype==='L'?'Z22':'Z23'),'CAV+'+(subtype==='L'?'Z23':'Z22')),
        wrongRole:wire(f).replace('23-DDQ-PRODAT','23-DGI-PRODAT'),
        sender:wire(f).replace(`NAD+FR+${f.receiver}`,`NAD+FR+${decoy.receiver}`),
        receiver:base.replace(`NAD+DO+${f.sender}`,`NAD+DO+${decoy.sender}`)}
      const causes:Record<string,HeldCause>={customer:{dimension:'customerIdentity',reasons:['normal_z04_exact_sent_original_required']},
        point:{dimension:'point',reasons:['supply_original_cohort_changed']},
        start:{dimension:'start',reasons:['normal_z04_exact_sent_original_required']},reason:{dimension:'reason',reasons:['normal_z04_exact_sent_original_required']},
        agency:{field:'209'},wrongRole:{field:'311'},sender:{party:'sender'},receiver:{party:'receiver',healthyRaw:base}}
      for(const [label,raw]of Object.entries(variants))results.push(await held(f,raw,subtype+':same-LI-'+label,causes[label]))
      // The public inbound entrypoint is also exercised with the genuine own
      // outbound original. The accepted Z04 direction is separately protected
      // by its actual immutable-context trigger below.
      const directionBefore=business(f)
      await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.originalZ03.id})
      expect(business(f)).toEqual(directionBefore)
      expect(originalSeal(f)).toEqual(f.originalSeal)
      results.push({label:subtype+':outbound-original-at-inbound-entrypoint',sourceId:f.originalZ03.id,no_market_effects:true})
      for(const field of required){
        const healthyRaw=envelope(f,base,subtype==='L'?'Z22':'Z23')
        results.push(await held(f,omit(healthyRaw,field),subtype+':missing-R-'+field,
          field==='209'?{field,missing209HealthyRaw:healthyRaw}:Object.hasOwn(selectedSyntaxControls,field)?{field,syntaxHealthyRaw:healthyRaw}:{field}))
      }
      const invoicee=withInvoicee(base)
      for(const field of selectedDependent){
        const healthyRaw=envelope(f,invoicee,subtype==='L'?'Z22':'Z23')
        results.push(await held(f,omit(healthyRaw,field),subtype+':missing-selected-D-'+field,
          Object.hasOwn(selectedSyntaxControls,field)?{field,syntaxHealthyRaw:healthyRaw}:{field}))
      }
      for(const field of malformedSuppliedAddressFields){
        const healthyRaw=envelope(f,invoicee,subtype==='L'?'Z22':'Z23')
        results.push(await held(f,malformSuppliedAddress(healthyRaw,field),subtype+':malformed-supplied-address-'+field,{field,syntaxHealthyRaw:healthyRaw}))
      }
      // Healthy real own original remains confirmable AFTER all omissions: the
      // negatives did not pass only because a pre-existing period conflicted.
      await confirm(f,withInvoicee(wire(f)))
      results.push({label:subtype+':healthy-own-source-after-refusals',pointContrast,healthySourceId:f.confirmation!.id,
        healthySameFixturePoint:periods(f)[0].metering_point_id,invoice_before_business:f.invoiceBaseline,state:activationSnapshot(f)})
    }
    const f=valid.L,before=business(f),seal=originalSeal(f)
    for(const {patch,code,message} of [{patch:{raw_payload:f.originalZ03.raw_payload+' '},code:'23514',message:'immutable_ediel_payload_cannot_change'},
      {patch:{direction:'inbound'},code:'P0001',message:'switch_original_bound_message_immutable'},
      {patch:{company_id:decoy.companyId},code:'P0001',message:'switch_original_bound_message_immutable'}]){
      const result=await supabaseService.from('ediel_messages').update(patch).eq('company_id',f.companyId).eq('id',f.originalZ03.id).select('id')
      expect(result.error).toMatchObject({code,message});expect(result.data).toBeNull();expect(originalSeal(f)).toEqual(seal);expect(business(f)).toEqual(before)
    }
    for(const own of Object.values(valid))for(const {patch,message} of [{patch:{direction:'outbound'},message:'immutable_ediel_received_context_cannot_change'},
      {patch:{raw_payload:own.confirmation!.raw_payload+' '},message:'immutable_ediel_payload_cannot_change'}]){
      const before=business(own),custody=sourceCustody(own,own.confirmation!)
      const result=await supabaseService.from('ediel_messages').update(patch).eq('company_id',own.companyId).eq('id',own.confirmation!.id).select('id')
      expect(result.error).toMatchObject({code:'23514',message});expect(result.data).toBeNull()
      expect(business(own)).toEqual(before);expect(sourceCustody(own,own.confirmation!)).toEqual(custody)
    }
    passed('Z04-T0-CORRELATION-R-D-REFUSALS',{required_fields:required,selected_dependent_fields:selectedDependent,malformed_supplied_address_fields:malformedSuppliedAddressFields,missing_address_availability:'NOT_CLAIMED',results})
  })
  it('Z04-T0-CAUSAL-CANCELLATION',async()=>{
    const results=[]
    for(const subtype of ['LK','L'] as const){
      const f=cancelled[subtype],id=f.periodId
      const prepared=await prepareAndQueueSwitchCancellation({companyId:f.companyId,switchRequestId:f.switchId,actorUserId:f.actorUserId,preferredRouteId:f.routeId,environment:'test'})
      expect(prepared.status).toBe('queued');if(!('message'in prepared))throw Error('z04future_causal_cancellation_required')
      await sendEdielMessageViaSmtp(prepared.message,{actorUserId:f.actorUserId,smtpMimeMode:'nodemailer-attachment'})
      expect(sql<string>(`SELECT to_jsonb(status) FROM public.supplier_switch_requests WHERE id=${literal(f.switchId)};`)).toBe('cancellation_requested')
      const {message}=await receive(f,wire(f,'Z24'),'C');expect(message).not.toBeNull()
      await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:message!.id})
      expect(periods(f)).toEqual([expect.objectContaining({id,status:'cancelled',source_message_id:f.confirmation!.id})])
      await sendAcks(f,message!);const before=activationSnapshot(f)
      await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:message!.id})
      await held(f,wire(f),subtype+':late-Z04-after-C',{cancelled:true})
      expect(activationSnapshot(f)).toEqual(before);results.push({subtype,periodId:id,cancellationId:message!.id,state:before})
    }
    passed('Z04-T0-CAUSAL-CANCELLATION',{results})
  })
  it('Z04-LK-FUTURE-BEFORE',()=>beforeStart('LK'))
  it('Z04-LK-START-AND-REPLAY',()=>atStart('LK'))
  it('Z04-L-FUTURE-BEFORE',()=>beforeStart('L'))
  it('Z04-L-START-AND-REPLAY',()=>atStart('L'))
})
