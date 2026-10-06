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

import {createBilateralCustomerSourceFixture,captureBilateralCustomerNativeSource,customerChangeMinute} from './helpers/ediel-bilateral-customer-native-fixture'
import {bilateralCustomerNativeWire} from './helpers/ediel-bilateral-customer-native-wire'
import {nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {archiveBilateralCustomerSource,reviewBilateralCustomerSourceArtifact} from '@/lib/ediel/production/bilateralCustomerSource'
import {loadCustomerLifeEventValidationContext} from '@/lib/ediel/production/lifeEventSource'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {recordReceivedSourceValidation} from '@/lib/ediel/core/receivedSourceValidationLedger'
import {buildReceivedSourceValidationEvidence} from '@/lib/ediel/core/receivedSourceValidationEvidence'
import {supabaseService} from '@/lib/supabase/service'
import {createReceivedSourceOwnerSession} from '@/lib/ediel/sources/receivedSourceOwnerSession'
import {applyInboundCustomerLifeEvent} from '@/lib/ediel/flows/inboundCustomerLifeEvent'
import {createCanonicalOutboundMessage} from '@/lib/ediel/core/kernel'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {resolveCanonicalRulePack} from '@/lib/ediel/rulebook/canonicalRulePackRegistry'
import {validateRulebookMessageWithRegistry} from '@/lib/ediel/rulebook/validator'

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
  let diagnostic:unknown=null
  if(receipt.status!=='recorded'){
    const evidence=buildReceivedSourceValidationEvidence({original:f.message,validated:f.message,resolvedCompanyId:f.companyId,decision})
    if(!evidence)diagnostic={boundary:'evidence_build',evidence:null}
    else{
      // Diagnose the SAME complete public owner. Never append a facetless v1
      // assessment, replace the original failure or authorize an effect here.
      const rpc=supabaseService.rpc.bind(supabaseService) as unknown as (name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>
      const actualRpc=await rpc('gridex_record_prodat_source_validation_v6',{
        p_company_id:evidence.companyId,p_environment:evidence.environment,p_source_message_id:evidence.sourceMessageId,
        p_source_payload_hash:evidence.sourcePayloadHash,p_facts_text:evidence.factsText,
        p_source_function_facts_text:evidence.prodatSourceFunctionValidation?JSON.stringify(evidence.prodatSourceFunctionValidation):null,
        p_object_facts_text:evidence.prodatObjectValidation?JSON.stringify(evidence.prodatObjectValidation):null,
        p_application_facts_text:evidence.prodatApplicationValidation?JSON.stringify(evidence.prodatApplicationValidation):null,
        p_ignored_fields_text:evidence.prodatIgnoredFields?JSON.stringify(evidence.prodatIgnoredFields):null,
        p_response_facts_text:evidence.prodatResponseValidation?JSON.stringify(evidence.prodatResponseValidation):null,
      })
      let predicates:unknown
      try{
        // Read the SAME native predicates and committed original/context.
        // No new context, assessment, authority or effect is created here.
        predicates=sql(`WITH input AS(SELECT ${literal(JSON.parse(evidence.factsText))}::jsonb facts,${literal(evidence.prodatSourceFunctionValidation??null)}::jsonb facet)
          SELECT jsonb_build_object(
            'sourceFunctionValid',gridex_received_sources.validate_prodat_source_function_v1(m.company_id,m.id,m.raw_payload,i.facts,i.facet),
            'scopeQualifications',(SELECT jsonb_agg(jsonb_build_object('scope',o-'functionalDecision'-'reasonCodes','qualified',gridex_customer_life_events.inbound_context_object_is_qualified_v1(m.company_id,m.id,r.id,o-'functionalDecision'-'reasonCodes'))) FROM jsonb_array_elements(i.facet->'objects')o),
            'registerScopes',i.facts#>'{registerValidation,objects}',
            'context',jsonb_build_object('present',r.id IS NOT NULL,'environmentMatches',r.environment IS NOT DISTINCT FROM m.environment,'payloadMatches',r.payload_hash IS NOT DISTINCT FROM i.facet->>'sourcePayloadHash','contextHashMatches',r.context_facts_hash IS NOT DISTINCT FROM i.facet->>'sourceContextFactsHash','storedHashValid',r.context_facts_hash IS NOT DISTINCT FROM encode(sha256(convert_to(r.context_facts::text,'UTF8')),'hex'),'rawMatches',r.context_facts->>'rawPayload' IS NOT DISTINCT FROM m.raw_payload,'status',r.context_facts->>'status','committedBeforeDiagnostic',r.xmin::text::numeric<>mod(pg_current_xact_id()::text::numeric,4294967296),'legalContext',r.context_facts->'legalContext','planObjects',(SELECT jsonb_agg(p->'object') FROM jsonb_array_elements(r.context_facts->'plans')p)),
            'wire',gridex_customer_life_events.wire_partition_v1(m.raw_payload))
          FROM input i JOIN public.ediel_messages m ON m.id=${literal(evidence.sourceMessageId)} AND m.company_id=${literal(evidence.companyId)}
          LEFT JOIN gridex_customer_life_events.inbound_context_receipts r ON r.id=(i.facet->>'sourceContextReceiptId')::uuid AND r.company_id=m.company_id AND r.source_message_id=m.id`)
      }catch(error){predicates={diagnosticReadError:error instanceof Error?error.message:String(error)}}
      diagnostic={actualRpc,applicationFacetPresent:evidence.prodatApplicationValidation!==null&&evidence.prodatApplicationValidation!==undefined,
        applicationBytes:Buffer.byteLength(JSON.stringify(evidence.prodatApplicationValidation??null),'utf8'),
        functionBytes:Buffer.byteLength(JSON.stringify(evidence.prodatSourceFunctionValidation??null),'utf8'),predicates}
    }
  }
  expect(receipt.status,JSON.stringify({boundary:'actual_complete_v6',diagnostic})).toBe('recorded')
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

const noEffects={transitions:0,versions:0,partitions:0,tasks:0,primary:0,confirmedFacets:0,deathEvents:0}
async function negativeFixture(){
  for(const[k,v]of Object.entries({EDIEL_SHARED_MAILBOX_ADDRESS:'synthetic@example.invalid',EDIEL_APP_DKIM_ENABLED:'false',EMAIL_PROVIDER:'resend',EDIEL_SMTP_FROM:'synthetic@example.invalid',EDIEL_SMTP_USER:'synthetic@example.invalid',EDIEL_SMTP_PASS:'synthetic-only',EDIEL_EMAIL_PROVIDER:'strato'}))vi.stubEnv(k,v)
  return createBilateralCustomerSourceFixture(email=>delivery.smtp.mockResolvedValue({accepted:[email],rejected:[],messageId:randomUUID(),response:'250 synthetic accepted'}))
}
function originalAndLedger(f:Fixture){
  return sql(`SELECT jsonb_build_object('message',(SELECT to_jsonb(m) FROM public.ediel_messages m WHERE id=${literal(f.sourceMessageId)} AND company_id=${literal(f.companyId)}),
    'source',(SELECT to_jsonb(s) FROM gridex_received_sources.sources s WHERE source_message_id=${literal(f.sourceMessageId)} AND company_id=${literal(f.companyId)}),
    'assessments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM gridex_received_sources.validation_assessments a WHERE source_message_id=${literal(f.sourceMessageId)} AND company_id=${literal(f.companyId)}))`)
}
function authorityCounts(f:Fixture){
  return sql(`SELECT jsonb_build_object('classifications',(SELECT count(*) FROM gridex_customer_life_events.inbound_classifications WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(f.sourceMessageId)}),
    'grounds',(SELECT count(*) FROM gridex_customer_life_events.inbound_grounds WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(f.sourceMessageId)}),
    'origins',(SELECT count(*) FROM gridex_bilateral_customer_sources.origins WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(f.sourceMessageId)}))`)
}
it('same-tenant signed authority for original A cannot classify or apply original B, with actual correct-A review control',async()=>{
  const f=await negativeFixture(),before=snapshot(f)
  // Reuse the existing finite native-original seam. This is deliberately not
  // a claim of prospective mailbox/intake qualification for either original.
  const b={...f,...await captureBilateralCustomerNativeSource(f,{repeatRegister:true,invoicee:true,name:'SYNTHETIC SECOND CUSTOMER ORIGINAL'})}
  expect(b.sourceMessageId).not.toBe(f.sourceMessageId)
  expect(b.wire).not.toBe(f.wire)
  const submission=f.submission('SYNTHETIC same-tenant wrong-original authority',f.pdf('same actual issuer receipt'))
  const signed=JSON.parse(Buffer.from(submission.issuerReceipt!.payloadBase64,'base64').toString('utf8')) as {claims:{sourceMessageId:string}}
  expect(signed.claims.sourceMessageId).toBe(f.sourceMessageId)
  const archive=await archiveBilateralCustomerSource({...submission,sourceMessageId:b.sourceMessageId,companyId:f.companyId,actorUserId:f.uploader.id})
  const missing=['authentic_current_bilateral_dso_receipt_and_representation']
  expect(archive.missing).toEqual(missing)
  expect(await reviewBilateralCustomerSourceArtifact({...archive,companyId:f.companyId,actorUserId:f.reviewer.id,decision:'approve',reason:'Synthetic separate wrong-original review',clause:f.clause})).toMatchObject({status:'held',missing})
  expect(authorityCounts(b)).toEqual({classifications:0,grounds:0,origins:0})
  const held=await applyInboundCustomerLifeEvent({message:b.message,actorUserId:f.reviewer.id})
  expect(held).toMatchObject({applied:false,reason:'customer_life_event_source_held'})
  expect(held.heldObjects).toEqual(expect.arrayContaining([expect.objectContaining({missing:expect.arrayContaining(['independent_original_customer_event_classification'])})]))
  expect(counts(b)).toEqual(noEffects)
  expect(snapshot(f)).toEqual(before)
  const correct=await archiveBilateralCustomerSource({...submission,companyId:f.companyId,actorUserId:f.uploader.id})
  expect(correct.missing).toEqual([])
  expect(await reviewBilateralCustomerSourceArtifact({...correct,companyId:f.companyId,actorUserId:f.reviewer.id,decision:'approve',reason:'Synthetic separate correct-original control',clause:f.clause})).toMatchObject({status:'authorized',sourceMessageId:f.sourceMessageId})
  expect(authorityCounts(f)).toEqual({classifications:1,grounds:1,origins:1})
  expect(authorityCounts(b)).toEqual({classifications:0,grounds:0,origins:0})
  expect(counts(f)).toEqual(noEffects);expect(counts(b)).toEqual(noEffects)
  expect(snapshot(f)).toEqual(before)
},120000)
it.each([
  ['raw','immutable_ediel_payload_cannot_change'],
  ['direction','immutable_ediel_received_context_cannot_change'],
  ['receipt_time','immutable_ediel_receipt_time_cannot_change'],
] as const)('actual REST %s mutation cannot change the sealed E original, ledger or business effects',async(field,guard)=>{
  const f=await negativeFixture(),before=snapshot(f),sealed=originalAndLedger(f)
  const patch=field==='raw'?{raw_payload:f.wire+'SYNTHETIC MUTATION'}:field==='direction'?{direction:'outbound'}:{message_received_at:new Date(Date.parse(f.message.message_received_at!)+60000).toISOString()}
  const result=await supabaseService.from('ediel_messages').update(patch).eq('company_id',f.companyId).eq('id',f.sourceMessageId)
  expect(result.error).toMatchObject({code:'23514',message:guard})
  expect(originalAndLedger(f)).toEqual(sealed)
  expect(authorityCounts(f)).toEqual({classifications:0,grounds:0,origins:0})
  expect(counts(f)).toEqual(noEffects)
  expect(snapshot(f)).toEqual(before)
},120000)
it('modern catalog rejects outbound Z06E semantics; the actual kernel separately refuses unqualified source with no original or witness',async()=>{
  const f=await negativeFixture(),before=snapshot(f)
  const outboundState=()=>sql(`SELECT jsonb_build_object('messages',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)}),'outbox',(SELECT count(*) FROM public.ediel_outbox WHERE company_id=${literal(f.companyId)}),'witnesses',(SELECT count(*) FROM gridex_ediel_outbound_owner.witnesses WHERE company_id=${literal(f.companyId)}))`)
  const prior=outboundState(),providerCalls=delivery.smtp.mock.calls.length
  // Obtain genuine business facts from the independent review of THIS
  // original. The pure catalog policy below is not outbound source authority.
  const archive=await archiveBilateralCustomerSource({...f.submission('SYNTHETIC direction catalog control',f.pdf('direction control')),companyId:f.companyId,actorUserId:f.uploader.id})
  expect(archive.missing).toEqual([])
  expect(await reviewBilateralCustomerSourceArtifact({...archive,companyId:f.companyId,actorUserId:f.reviewer.id,decision:'approve',reason:'Synthetic separate direction control',clause:f.clause})).toMatchObject({status:'authorized'})
  const context=await loadCustomerLifeEventValidationContext(f.message,f.reviewer.id)
  expect(context).toMatchObject({direction:'inbound',code:'Z06',businessContext:'other_masterdata',bilateralCapabilityVerified:true})
  const businessDate=new Date(f.message.message_received_at!).toISOString().slice(0,10)
  const policy=resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:'Z06',subtypeOrReasonCode:'E',direction:'outbound',referenceDate:businessDate,applicationReference:'23-DDQ-PRODAT',businessContext:context!.businessContext,bilateralCapabilityVerified:context!.bilateralCapabilityVerified,mode:'catalog_evidence'})
  await expect(resolveCanonicalRulePack({family:'PRODAT',messageCode:'Z06',transactionSubtype:'E',applicationReference:'23-DDQ-PRODAT',direction:'outbound',businessDate,canonicalPolicy:policy})).rejects.toThrow('canonical_source_direction_not_allowed:Z06:outbound:inbound')
  const raw=bilateralCustomerNativeWire({sender:f.sender,receiver:f.receiver,point:f.external,customerIdentity:f.customerIdentity.id,reference:'LI'+randomUUID().replaceAll('-','').toUpperCase(),marketMinute:customerChangeMinute(f.requestedStartDate),repeatRegister:true,invoicee:true})
  // The real unqualified draft stops at the modern source boundary before
  // registry lookup. Assert that boundary and its actual first diagnostic;
  // do not relabel this refusal as proof of reaching the direction guard.
  const dateEventRow={company_id:f.companyId,environment:'test' as const,direction:'outbound' as const,message_code:'Z06',sender_ediel_id:f.sender,receiver_ediel_id:f.receiver,sender_sub_address:null,receiver_sub_address:null,application_reference:'23-DDQ-PRODAT',transport_type:'smtp' as const,receiver_email:null,communication_route_id:null,route_profile_id:null,mailbox:null}
  const validation=await validateRulebookMessageWithRegistry({family:'PRODAT',code:'Z06',rawPayload:raw,applicationReference:'23-DDQ-PRODAT',mode:'send',direction:'outbound',environment:'test',companyId:f.companyId,dateEventRow})
  expect(validation.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'PRODAT_DEATH_STATUS_SOURCE_UNQUALIFIED'})]))
  const first=validation.issues.find(issue=>issue.severity==='error'||issue.blocking)
  expect(first).toBeDefined()
  await expect(createCanonicalOutboundMessage({actorUserId:f.actorUserId,requestType:'customer_masterdata',baseInput:{actorUserId:f.actorUserId,companyId:f.companyId,environment:'test',direction:'outbound',messageStandard:'edifact',messageFamily:'PRODAT',messageCode:'Z06',applicationReference:'23-DDQ-PRODAT',senderEdielId:f.sender,receiverEdielId:f.receiver,sourceOperationId:randomUUID(),rawPayload:raw}})).rejects.toThrow(`${first!.code} - ${first!.description}`)
  expect(outboundState()).toEqual(prior)
  expect(delivery.smtp).toHaveBeenCalledTimes(providerCalls)
  expect(counts(f)).toEqual(noEffects)
  expect(snapshot(f)).toEqual(before)
},120000)
