import {randomUUID} from 'node:crypto'
import {afterEach,expect,it,vi} from 'vitest'

vi.mock('server-only',()=>({}))
const delivery=vi.hoisted(()=>({smtp:vi.fn()}))
// External delivery/notifications and the reused helper's issuer key,
// representation and bilateral agreement are declared synthetic boundaries.
// Classification, context, canonical decision, effect and receipts are native.
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:delivery.smtp})}}))
vi.mock('@/lib/customer-notifications/notificationOrchestrator',()=>({enqueueCustomerLifecycleNotification:async()=>null}))
vi.mock('@/lib/website/customerApplicationWorkflowBridge',()=>({transitionCorrelatedCustomerApplicationWorkflow:async()=>null}))

import {createBilateralCustomerSourceFixture} from './helpers/ediel-bilateral-customer-native-fixture'
import {nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {archiveBilateralCustomerSource,reviewBilateralCustomerSourceArtifact} from '@/lib/ediel/production/bilateralCustomerSource'
import {loadCustomerLifeEventValidationContext} from '@/lib/ediel/production/lifeEventSource'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {recordReceivedSourceValidation} from '@/lib/ediel/core/receivedSourceValidationLedger'
import {createReceivedSourceOwnerSession} from '@/lib/ediel/sources/receivedSourceOwnerSession'
import {applyInboundCustomerLifeEvent} from '@/lib/ediel/flows/inboundCustomerLifeEvent'

type Fixture=Awaited<ReturnType<typeof createBilateralCustomerSourceFixture>>
type Snapshot={customer:Record<string,unknown>;supply:unknown;point:unknown;site:unknown}
function snapshot(f:Fixture):Snapshot{
  return sql(`SELECT jsonb_build_object(
    'customer',(SELECT to_jsonb(c) FROM public.customers c WHERE id=${literal(f.customerId)}),
    'supply',(SELECT to_jsonb(p) FROM public.customer_supply_periods p WHERE id=${literal(f.period)}),
    'point',(SELECT to_jsonb(p) FROM public.metering_points p WHERE id=${literal(f.pointId)}),
    'site',(SELECT to_jsonb(s) FROM public.customer_sites s WHERE id=${literal(f.siteId)}))`)
}
function counts(f:Fixture){
  const c=literal(f.companyId),m=literal(f.sourceMessageId)
  return sql<Record<string,number>>(`SELECT jsonb_build_object(
    'transitions',(SELECT count(*) FROM gridex_customer_life_events.transitions WHERE company_id=${c} AND source_message_id=${m}),
    'versions',(SELECT count(*) FROM gridex_customer_life_events.customer_versions WHERE company_id=${c} AND source_message_id=${m}),
    'partitions',(SELECT count(*) FROM gridex_customer_life_events.partition_receipts WHERE company_id=${c} AND source_message_id=${m}),
    'tasks',(SELECT count(*) FROM gridex_customer_life_events.tasks WHERE company_id=${c} AND source_message_id=${m}),
    'primary',(SELECT count(*) FROM gridex_received_sources.customer_primary_response_receipts WHERE company_id=${c} AND source_message_id=${m}),
    'confirmedFacets',(SELECT count(*) FROM gridex_requested_changes.confirmed_customer_versions WHERE company_id=${c} AND source_message_id=${m}),
    'deathEvents',(SELECT count(*) FROM gridex_customer_life_events.events WHERE company_id=${c} AND classification='death'))`)
}

afterEach(()=>{vi.unstubAllEnvs();delivery.smtp.mockReset()})
it.each(['bankruptcy','customer_change'] as const)('native %s classification commits a future customer version and its own primary receipt without current customer or supply mutation',async kind=>{
  for(const[k,v]of Object.entries({EDIEL_SHARED_MAILBOX_ADDRESS:'synthetic@example.invalid',EDIEL_APP_DKIM_ENABLED:'false',EMAIL_PROVIDER:'resend',EDIEL_SMTP_FROM:'synthetic@example.invalid',EDIEL_SMTP_USER:'synthetic@example.invalid',EDIEL_SMTP_PASS:'synthetic-only',EDIEL_EMAIL_PROVIDER:'strato'}))vi.stubEnv(k,v)
  const f=await createBilateralCustomerSourceFixture(email=>delivery.smtp.mockResolvedValue({accepted:[email],rejected:[],messageId:randomUUID(),response:'250 synthetic accepted'}))
  const before=snapshot(f)
  expect(counts(f)).toEqual({transitions:0,versions:0,partitions:0,tasks:0,primary:0,confirmedFacets:0,deathEvents:0})
  const artifact=await archiveBilateralCustomerSource({...f.submission(`SYNTHETIC own ${kind} original`,f.pdf(kind),true,kind),companyId:f.companyId,actorUserId:f.uploader.id})
  expect(artifact.missing).toEqual([])
  expect(await reviewBilateralCustomerSourceArtifact({...artifact,companyId:f.companyId,actorUserId:f.reviewer.id,decision:'approve',reason:'Synthetic independent original and classification review',clause:f.clause})).toMatchObject({status:'authorized'})
  const classification=kind==='bankruptcy'?'bankruptcy':'other_masterdata'
  expect(sql(`SELECT jsonb_build_object('classification',classification,'allowsDeath','310'=ANY(allowed_customer_fields)) FROM gridex_customer_life_events.inbound_classifications WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(f.sourceMessageId)}`)).toEqual({classification,allowsDeath:false})

  // Separate awaited calls retain actual committed context/canonical/effect
  // fences. The fixture's earlier pre-classification session is not reused.
  const deathStatusContext=await loadCustomerLifeEventValidationContext(f.message,f.reviewer.id)
  expect(deathStatusContext).toBeDefined()
  const decision=await resolveCanonicalRuntimeDecisionWithRegistry(f.message,{deathStatusContext})
  expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision.issues)).toEqual(['accepted','accepted','accepted'])
  expect(decision.prodatSourceFunctionValidation?.objects.map(o=>o.functionalDecision)).toEqual(['accepted'])
  const receipt=await recordReceivedSourceValidation({original:f.message,validated:f.message,resolvedCompanyId:f.companyId,decision})
  expect(receipt.status).toBe('recorded')
  if(receipt.status!=='recorded')throw new Error('actual_fresh_canonical_receipt_required')
  const session=createReceivedSourceOwnerSession(receipt)
  expect(session).not.toBeNull()
  if(!session)throw new Error('actual_fresh_customer_owner_session_required')
  // Authorization is rechecked after genuine context admission and before the
  // first effect. Expiry restores the fixture's original legitimate grant.
  sql(`INSERT INTO public.user_permission_overrides(company_id,user_id,permission_key,effect,is_active,valid_from,valid_to)VALUES(${literal(f.companyId)},${literal(f.reviewer.id)},'communication.write','deny',true,now()-interval '1 day',now()+interval '1 day')`)
  await expect(applyInboundCustomerLifeEvent({message:f.message,actorUserId:f.reviewer.id})).rejects.toMatchObject({message:'customer_life_event_actor_forbidden'})
  expect(counts(f)).toEqual({transitions:0,versions:0,partitions:0,tasks:0,primary:0,confirmedFacets:0,deathEvents:0})
  expect(snapshot(f)).toEqual(before)
  sql(`UPDATE public.user_permission_overrides SET valid_to=now()-interval '1 second' WHERE company_id=${literal(f.companyId)} AND user_id=${literal(f.reviewer.id)} AND permission_key='communication.write' AND effect='deny'`)
  expect(await applyInboundCustomerLifeEvent({message:f.message,actorUserId:f.reviewer.id,onCustomerLifeEventCommitted:session.onCustomerLifeEventCommitted})).toMatchObject({applied:true,idempotent:false,sourceMessageId:f.sourceMessageId})
  const owner=await session.finish()
  expect(owner).toMatchObject({status:'recorded',sourceDisposition:'accepted'})
  if(owner.status!=='recorded')throw new Error('actual_primary_customer_owner_required')

  expect(counts(f)).toEqual({transitions:1,versions:1,partitions:1,tasks:1,primary:1,confirmedFacets:0,deathEvents:0})
  expect(snapshot(f)).toEqual(before)
  const effectiveMs=Date.parse(`${f.requestedStartDate}T00:00:00+01:00`)+2*86400000
  const version=sql<{previous:Record<string,unknown>;resulting:Record<string,unknown>;future:boolean;effectiveMs:number;version:number}>(`SELECT jsonb_build_object('previous',previous_customer,'resulting',resulting_customer,'future',effective_at>clock_timestamp(),'effectiveMs',extract(epoch FROM effective_at)*1000,'version',version) FROM gridex_customer_life_events.customer_versions WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(f.sourceMessageId)} AND customer_id=${literal(f.customerId)}`)
  expect(version.future).toBe(true)
  expect(version.effectiveMs).toBe(effectiveMs)
  expect(version.version).toBe(1)
  expect(version.previous).toEqual(before.customer)
  expect(version.resulting).toMatchObject({name:'SYNTHETIC DATED CUSTOMER',metadata:{edielCustomerLifeEvent:{classification,sourceMessageId:f.sourceMessageId},edielEndUserMasterdata:{name:['SYNTHETIC DATED CUSTOMER']}}})
  const projected=version.resulting.metadata as {edielEndUserMasterdata:Record<string,unknown>}
  expect(projected.edielEndUserMasterdata).not.toHaveProperty('deathStatus')
  expect(projected.edielEndUserMasterdata).not.toHaveProperty('invoicee')
  for(const[key,value]of Object.entries(before.customer).filter(([key])=>key.startsWith('billing_')))expect(version.resulting[key]).toEqual(value)
  expect(sql(`SELECT jsonb_build_object('canonical',p.canonical_assessment_id,'object',p.object_assessment_id,'customer',p.customer_id,'version',p.customer_version,'effectiveMs',extract(epoch FROM p.effective_at)*1000,'witnesses',(SELECT count(*) FROM gridex_received_sources.object_availability_witnesses w WHERE w.assessment_id=p.object_assessment_id)) FROM gridex_received_sources.customer_primary_response_receipts p WHERE p.company_id=${literal(f.companyId)} AND p.source_message_id=${literal(f.sourceMessageId)}`)).toEqual({canonical:receipt.assessmentId,object:owner.assessmentId,customer:f.customerId,version:1,effectiveMs,witnesses:1})
  expect(sql(`SELECT jsonb_build_object('transitionCanonical',t.canonical_assessment_id,'partitionCanonical',p.canonical_assessment_id) FROM gridex_customer_life_events.transitions t JOIN gridex_customer_life_events.partition_receipts p USING(source_message_id,company_id) WHERE t.company_id=${literal(f.companyId)} AND t.source_message_id=${literal(f.sourceMessageId)}`)).toEqual({transitionCanonical:receipt.assessmentId,partitionCanonical:receipt.assessmentId})
  expect(sql(`SELECT jsonb_build_object('customer',t.customer_id,'responsible',t.responsible_user_id,'rule',t.rule_id,'sourceKind',t.source_kind,'assigned',o.assigned_to,'due',o.due_at) FROM gridex_customer_life_events.tasks t JOIN public.customer_operation_tasks o ON o.id=t.operation_task_id WHERE t.company_id=${literal(f.companyId)} AND t.source_message_id=${literal(f.sourceMessageId)}`)).toEqual({customer:f.customerId,responsible:f.reviewer.id,rule:'TM-Z06-E',sourceKind:'confirmed_customer_change',assigned:f.reviewer.id,due:null})

  const committed=counts(f)
  expect(await applyInboundCustomerLifeEvent({message:f.message,actorUserId:f.reviewer.id})).toMatchObject({applied:true,idempotent:true,sourceMessageId:f.sourceMessageId})
  expect(counts(f)).toEqual(committed)
  const foreign=randomUUID()
  sql(`INSERT INTO public.companies(id,name,status)VALUES(${literal(foreign)},'Disposable foreign customer effect tenant','active')`)
  await expect(applyInboundCustomerLifeEvent({message:{...f.message,company_id:foreign},actorUserId:f.reviewer.id})).rejects.toMatchObject({message:'customer_life_event_source_required'})
  sql(`INSERT INTO public.user_permission_overrides(company_id,user_id,permission_key,effect,is_active,valid_from,valid_to)VALUES(${literal(f.companyId)},${literal(f.reviewer.id)},'communication.write','deny',true,now()-interval '1 day',now()+interval '1 day')`)
  await expect(applyInboundCustomerLifeEvent({message:f.message,actorUserId:f.reviewer.id})).rejects.toMatchObject({message:'customer_life_event_actor_forbidden'})
  expect(counts(f)).toEqual(committed)
  expect(snapshot(f)).toEqual(before)
},120000)
