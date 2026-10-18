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
import {validateFieldMatrixPayload} from '@/lib/ediel/rulebook/fieldMatrix'
import {canonicalProdat26AFieldRules} from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import {evaluateProdatTransactionReason} from '@/lib/ediel/prodat/prodatTransactionReason'
import {buildContrlDraft,buildAperakDraft} from '@/lib/ediel/ack'
import {readCommittedInboundAck} from '@/lib/ediel/ack/committedInboundAck'
import {readPhysicalAckSourceCorrelation} from '@/lib/ediel/ack/sourceCorrelation'
import {validateEdifactEnvelope} from '@/lib/ediel/core/edifactValidation'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {serializeUna} from '@/lib/ediel/core/una'
import {GET as runCustomerOperationsCron} from '@/app/api/internal/customer-operations/cron/route'
import type {EdielMessageRow} from '@/lib/ediel/types'

type Subtype='L'|'LK'
type Row=Record<string,unknown>
type Fixture=NormalSwitchStageNativeFixture&{subtype:Subtype;originalZ03:EdielMessageRow;caseReference:string;
  startAt:string;originalSeal:unknown;confirmation?:EdielMessageRow;periodId?:string;confirmed?:Row}
const password=randomUUID()+randomUUID(),cronSecret=randomUUID()+randomUUID()
const fixtures:Fixture[]=[],valid={} as Record<Subtype,Fixture>,cancelled={} as Record<Subtype,Fixture>,expires={} as Record<Subtype,Fixture>,pending={} as Record<Subtype,Fixture>,invoiceePositive={} as Record<Subtype,Fixture>
let decoy:Fixture,ordinaryDay:string
const evidence:FutureStartNativeReceipt={schema:'ediel_z04_future_start_native_v1',accelerated_execution:true,
  actual_elapsed_14_days:false,authentic_external_market_history:false,whole_approval:false,
  source:{head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),tree:execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim()},
  originals:[],phases:[],cases:[]}
const digest=(raw:string)=>createHash('sha256').update(raw).digest('hex')
function persist(){
  const root=process.env.GRIDEX_Z04_FUTURE_EVIDENCE
  if(!root||!root.startsWith(process.cwd()+'/'))throw Error('z04future_owned_evidence_directory_required')
  writeFileSync(join(root,'product-future-start-receipt.json'),JSON.stringify(evidence,null,2)+'\n')
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
  'public.customer_application_workflow_events','public.customer_operation_jobs','public.domain_events','public.invoices',
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
  'invoices',(SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY id),'[]') FROM public.invoices i WHERE company_id=${literal(f.companyId)}));`)}
// Actual cron also runs legitimate operational workers. Preserve full snapshots
// as evidence, but replay must retain market facts and activation ID sets; it need
// not freeze the status of an already-created notification job forever.
function marketFacts(s:Row){return {switch:s.switch&&{id:(s.switch as Row).id,status:(s.switch as Row).status,
  inbound:(s.switch as Row).inbound_z04_message_id,outbound:(s.switch as Row).outbound_z03_message_id},
  graph:s.graph,periods:s.periods,confirmations:s.confirmations,activations:s.activations,billing_basis:s.billing_basis,
  activationEvents:(s.events as Row[]).filter(x=>String(x.idempotency_key).startsWith('ediel-normal-activation:')),
  activationJobs:(s.jobs as Row[]).filter(x=>String(x.idempotency_key).startsWith('lifecycle_notification:ediel-normal-activation:')).map(x=>({id:x.id,idempotency_key:x.idempotency_key,payload:x.payload,request_snapshot:x.request_snapshot})),
  invoiceIds:(s.invoices as Row[]).map(x=>x.id)}}
function requireMarketFactsUnchanged(before:Row,after:Row){assert.deepEqual(marketFacts(after),marketFacts(before))}
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
async function receive(f:Fixture,raw:string,expectedSubtype?:Subtype|'C'){
  // Real local public transport privilege at original mail birth. The custody
  // trigger deliberately refuses postgres-only writes without this role.
  const transportSql=<T,>(statement:string)=>sql<T>(`BEGIN; SET LOCAL ROLE service_role; ${statement}; COMMIT;`)
  const mail=await seedOriginalMailboxNative(transportSql,literal,{companyId:f.companyId,environment:'test',raw,smtpFrom:assertEdielSmtpReadiness().from})
  expect(sql<number>(`SELECT to_jsonb(count(*)) FROM gridex_unattributed_intake.raw_births WHERE inbound_email_message_id=${literal(mail.inboundEmailMessageId)};`)).toBe(1)
  expect(sql<number>(`SELECT to_jsonb(count(*)) FROM gridex_unattributed_intake.parse_births WHERE inbound_email_message_id=${literal(mail.inboundEmailMessageId)};`)).toBe(1)
  const outboundMatch=await matchOutboundRequestForInbound({companyId:f.companyId,parsed:mail.parsed,inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId})
  const meteringPointMatch=await matchMeteringPointForInbound({companyId:f.companyId,parsed:mail.parsed})
  const id=await createInboundEdielMessage({companyId:f.companyId,actorUserId:f.actorUserId,environment:'test',inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId,parsed:mail.parsed,outboundMatch,meteringPointMatch})
  if(!id)return {mail,message:null}
  const message=(await getEdielMessageById(id))!
  expect(message.raw_payload).toBe(raw);expect(message.company_id).toBe(f.companyId)
  if(expectedSubtype)expect(message.rule_profile_key).toBe(`PRODAT:Z04:${expectedSubtype}:26.A:r3`)
  const rows=sql<Row[]>(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') FROM gridex_ediel_inbound_receptions.receptions r WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(id)};`)
  expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({classification:'first_reception',canonical_payload_hash:digest(raw),received_payload_hash:digest(raw)})
  return {mail,message}
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
  expect((await getEdielMessageById(f.originalZ03.id))?.aperak_status).toBe('pending')
  const {message}=await receive(f,raw,f.subtype);expect(message).not.toBeNull()
  f.confirmation=message!;await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:message!.id})
  const own=periods(f);expect(own).toHaveLength(1)
  expect(own[0]).toMatchObject({company_id:f.companyId,customer_id:f.customerId,metering_point_id:f.pointId,source_switch_request_id:f.switchId,
    source_message_id:message!.id,status:'confirmed_by_grid_owner',start_date:f.requestedStartDate})
  expect(Date.parse(String(own[0].market_start_at))).toBe(Date.parse(f.startAt));f.periodId=String(own[0].id)
  const before=activationSnapshot(f);expect(before.activations).toEqual([]);expect(before.billing_basis).toBeNull()
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
const selectedDependent=['214','218','229','250','251','252','253','317','318']
function omit(raw:string,field:string){
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
type HeldCause={field:string}|{dimension:'customerIdentity'|'point'|'start'|'reason';reasons:string[]}|{cancelled:true}
async function held(f:Fixture,raw:string,label:string,cause:HeldCause){
  const before=business(f),seals=fixtures.map(originalSeal),decoyBefore=business(decoy)
  const {message,mail}=await receive(f,raw)
  const physical=tokenizeEdifact(mail.parsed.rawPayload)
  const physicalIssues=[...validateFieldMatrixPayload({family:'PRODAT',code:'Z04',direction:'inbound',
    applicationReference:EdifactEnvelopeCodec.decode(raw).applicationReference,rawSegments:physical.segments.map(s=>s.raw),una:physical.una,mode:'parse'},canonicalProdat26AFieldRules('Z04')),
    ...evaluateProdatTransactionReason({code:'Z04',rawSegments:physical.segments.map(s=>s.raw),una:physical.una}).issues]
  const decision=message?await resolveCanonicalRuntimeDecisionWithRegistry(message,{actorUserId:f.actorUserId}):null
  const diagnostics=[...physicalIssues,...(decision?.issues??[])]
  if('field'in cause)expect(diagnostics,label+': own field diagnostic').toContainEqual(expect.objectContaining({
    prodatDiagnostic:expect.objectContaining({fieldNumber:cause.field})}))
  else {
    expect(message,label+': actual source required').not.toBeNull()
    expect(decision,label+': no unrelated field refusal').toMatchObject({syntaxDecision:'accepted',applicationDecision:'accepted',functionalDecision:'accepted'})
    const pair=sql<{original:Row;received:Row}>(`SELECT jsonb_build_object('original',gridex_received_sources.normal_switch_wire_v1(${literal(f.originalZ03.raw_payload)}),'received',gridex_received_sources.normal_switch_wire_v1(${literal(raw)}));`)
    const original=(pair.original.objects as Row[])[0],received=(pair.received.objects as Row[])[0]
    expect(received.li).toBe(original.li)
    if('dimension'in cause)expect(received[cause.dimension],label+': frozen own correlation mismatch').not.toEqual(original[cause.dimension])
    else expect(periods(f)).toEqual([expect.objectContaining({id:f.periodId,status:'cancelled'})])
  }
  let partitions:Row[]=[]
  if(message){
    await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:message.id})
    partitions=sql<Row[]>(`SELECT coalesce(jsonb_agg(to_jsonb(p)),'[]') FROM gridex_received_sources.supply_object_partitions p WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(message.id)};`)
    for(const partition of partitions)expect((partition.result as Row).partition).toEqual([expect.objectContaining({disposition:'held'})])
    if(!('field'in cause)){
      const reasons='dimension'in cause?cause.reasons:['normal_z04_locked_original_scope_required']
      expect(reasons.some(reason=>JSON.stringify(partitions).includes(reason)),label+': actual own refusal receipt').toBe(true)
    }
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.normal_switch_confirmations WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(message.id)};`),label).toBe(0)
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND related_message_id=${literal(message.id)} AND message_family='APERAK' AND ack_outcome='positive';`),label).toBe(0)
  }
  expect(business(f),label).toEqual(before);expect(fixtures.map(originalSeal),label).toEqual(seals);expect(business(decoy)).toEqual(decoyBefore)
  const retained=sql<{raw:string}>(`SELECT jsonb_build_object('raw',raw_edifact_payload) FROM public.inbound_email_messages WHERE id=${literal(mail.inboundEmailMessageId)} AND company_id=${literal(f.companyId)};`)
  expect(retained.raw).toBe(raw)
  return {label,cause,diagnostics,partitions,sourceId:message?.id??null,mailId:mail.inboundEmailMessageId,rawHash:digest(raw),no_market_effects:true}
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
  const response=await runCustomerOperationsCron(new NextRequest('http://127.0.0.1/api/internal/customer-operations/cron?limit=100',{headers:{authorization:'Bearer '+cronSecret}}))
  const result=await response.json() as {ok:boolean;result?:Row}
  expect(response.status,JSON.stringify(result)).toBe(200);expect(result.ok).toBe(true)
  assert(result.result,'actual_cron_result_required');requireCronResultChannels(result.result,expectedDenials)
  const after=readActualMarketClocks();requireBoundary(Number(after.postgres_new_transaction.clock_ms),f.startAt,relation)
  expect(after.postgres_new_transaction.system_identifier).toBe(before.postgres_new_transaction.system_identifier)
  expect(after.postgres_new_transaction.postmaster_started_at).toBe(before.postgres_new_transaction.postmaster_started_at)
  return {actorUserId:f.actorUserId,companyId:f.companyId,candidates,expectedDenials,before,after,response:result}
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
  await cron(f,'at-or-after');await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.confirmation!.id})
  requireMarketFactsUnchanged(replayBefore,activationSnapshot(f));requireMarketFactsUnchanged(decoyBefore,activationSnapshot(decoy))
  for(const own of fixtures)expect(originalSeal(own)).toEqual(own.originalSeal)
  passed(name,{subtype,originalId:f.originalZ03.id,sourceId:f.confirmation!.id,periodId:f.periodId,atStart:at,replay:activationSnapshot(f),run,
    controlRuns,cancelled:activationSnapshot(cancelled[subtype]),expired_role:activationSnapshot(expires[subtype])})
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
  })
  it('Z04-T0-PROSPECTIVE-L-LK-ORIGINALS',async()=>{
    await confirm(decoy)
    const decoyBefore=business(decoy)
    for(const f of [...Object.values(valid),...Object.values(cancelled),...Object.values(expires)])await confirm(f)
    for(const f of Object.values(invoiceePositive))await confirm(f,withInvoicee(wire(f)))
    expect(business(decoy)).toEqual(decoyBefore)
    passed('Z04-T0-PROSPECTIVE-L-LK-ORIGINALS',{ordinaryDay,clock:readActualMarketClocks(),periods:fixtures.filter(f=>f.confirmation).map(f=>({subtype:f.subtype,original:f.originalZ03.id,source:f.confirmation!.id,period:f.periodId,start:f.startAt,state:activationSnapshot(f)}))})
  })
  it('Z04-T0-CORRELATION-R-D-REFUSALS',async()=>{
    const results=[]
    for(const subtype of ['LK','L'] as const){
      const f=pending[subtype],base=wire(f)
      // Same LI alone is intentionally shared with the real unconfirmed own
      // original. Every negative differs physically before source birth.
      const variants:Record<string,string>={customer:base.replace(f.customerIdentity.id,'198001011234'),
        point:base.replaceAll(f.external,valid.L.external),start:base.replaceAll(f.requestedStartDate.replaceAll('-','')+'0000',plusDays(f.requestedStartDate,1).replaceAll('-','')+'0000'),
        agency:base.replace(':::9',':::ZZ'),reason:base.replace('CAV+'+(subtype==='L'?'Z22':'Z23'),'CAV+'+(subtype==='L'?'Z23':'Z22')),
        wrongRole:base.replace('23-DDQ-PRODAT','23-DGI-PRODAT'),
        sender:base.replace(`NAD+FR+${f.receiver}`,`NAD+FR+${decoy.receiver}`),
        receiver:base.replace(`NAD+DO+${f.sender}`,`NAD+DO+${decoy.sender}`)}
      const causes:Record<string,HeldCause>={customer:{dimension:'customerIdentity',reasons:['normal_z04_exact_sent_original_required']},
        point:{dimension:'point',reasons:['normal_z04_exact_sent_original_required','normal_z04_owned_signed_contract_scope_required']},
        start:{dimension:'start',reasons:['normal_z04_exact_sent_original_required']},reason:{dimension:'reason',reasons:['normal_z04_exact_sent_original_required']},
        agency:{field:'209'},wrongRole:{field:'311'},sender:{field:'207'},receiver:{field:'208'}}
      for(const [label,raw]of Object.entries(variants))results.push(await held(f,raw,subtype+':same-LI-'+label,causes[label]))
      // The public inbound entrypoint is also exercised with the genuine own
      // outbound original. The accepted Z04 direction is separately protected
      // by its actual immutable-context trigger below.
      const directionBefore=business(f)
      await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.originalZ03.id})
      expect(business(f)).toEqual(directionBefore)
      expect(originalSeal(f)).toEqual(f.originalSeal)
      results.push({label:subtype+':outbound-original-at-inbound-entrypoint',sourceId:f.originalZ03.id,no_market_effects:true})
      for(const field of required)results.push(await held(f,omit(envelope(f,base,subtype==='L'?'Z22':'Z23'),field),subtype+':missing-R-'+field,{field}))
      const invoicee=withInvoicee(base)
      for(const field of selectedDependent)results.push(await held(f,omit(envelope(f,invoicee,subtype==='L'?'Z22':'Z23'),field),subtype+':missing-selected-D-'+field,{field}))
      // Healthy real own original remains confirmable AFTER all omissions: the
      // negatives did not pass only because a pre-existing period conflicted.
      await confirm(f,withInvoicee(wire(f)))
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
    passed('Z04-T0-CORRELATION-R-D-REFUSALS',{required_fields:required,selected_dependent_fields:selectedDependent,results})
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
