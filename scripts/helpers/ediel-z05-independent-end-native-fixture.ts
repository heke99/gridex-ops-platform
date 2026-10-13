// Independent ordinary L target in a populated existing H sibling company.
// Synthetic tenant/legal declarations are explicit; canonical commercial,
// signature, archive, source and supply owners create every admitted fact.
// Importing this module creates no rows and registers no tests.
import {createHash,createHmac,randomUUID} from 'node:crypto'
import {expect,type Mock} from 'vitest'
import {nativeSql as sql,literal,normalSwitchNetworkRegistry,type NormalSwitchStageNativeFixture} from './ediel-normal-switch-native-fixture'
import type {NationalEndSibling,PreparedNationalEndTarget} from './ediel-national-end-native-fixture'
import {ownerSource} from '../../__tests__/helpers/sourceOwnerFixtures'
import {supabaseService} from '@/lib/supabase/service'
import {onboardCustomerGraph} from '@/lib/customers/canonicalOnboarding'
import {createTenantContext} from '@/lib/tenant/context'
import {assertEdielTenantActor} from '@/lib/ediel/services/authorization'
import {signInvoiceTestContractCanonically} from '@/lib/ediel/testing/invoiceTestContractLifecycle'
import {buildAgreementPdfAttachment} from '@/lib/customer-contracts/agreementPdf'
import {archiveSignedCustomerContractPdf} from '@/lib/customer-contracts/documents'
import {savePowerOfAttorney} from '@/lib/operations/db'
import {ensureAuthorizationDocumentFromPowerOfAttorney} from '@/lib/legal/authorizationChain'
import {powerOfAttorneyCoverageFromScopes} from '@/lib/operations/powerOfAttorneyWorkflow'
import {prepareAndQueueEdielZ03} from '@/lib/ediel/flows/prodatSwitch'
import {sendEdielMessageViaSmtp} from '@/lib/ediel/transport'
import {getEdielMessageById} from '@/lib/ediel/db'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {readNetworkRegistrySourceArtifact} from '@/lib/ediel/production/networkRegistrySource'
import {seedOriginalMailboxNative,recordOriginalMailboxNativeReception} from './originalMailboxNative'
import {assertEdielSmtpReadiness} from '@/lib/ediel/mailReadiness'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {recordReceivedSourceValidation} from '@/lib/ediel/core/receivedSourceValidationLedger'
import {captureFreshEdielSourceRulePackEvidence} from '@/lib/ediel/core/sourceRulePackEvidence'
import {createReceivedSourceOwnerSession} from '@/lib/ediel/sources/receivedSourceOwnerSession'
import {applyInboundBusinessStateMachine} from '@/lib/ediel/flows/inboundBusinessStateMachine'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {prodatRegisterReadingState} from '@/lib/ediel/prodat/prodatRegisterReadings'
import {prodatCharacteristicValues} from '@/lib/ediel/prodat/prodatCharacteristicFields'
import type {EdielMessageRow} from '@/lib/ediel/types'

function freshGsrn(){
 const digits=`73512${(Number.parseInt(randomUUID().replaceAll('-','').slice(0,12),16)%1000000000000).toString().padStart(12,'0')}`
 const sum=[...digits].reduce((total,digit,index)=>total+Number(digit)*(index%2===0?3:1),0)
 return `${digits}${(10-sum%10)%10}`
}

/** Close A's actual pre-B message set. Preserve complete graph, legal/profile,
 * source/admission, original/mail, mandate/capability, provider and watch rows.
 * New B rows cannot enter this set or hide a mutation before the end baseline.
 * No credential/session or issuer signing key is read. */
function retainNationalSibling(f:NationalEndSibling){
 const messageIds=sql<string[]>(`SELECT jsonb_agg(id ORDER BY id) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)}`)
 expect(messageIds).toContain(f.original.id);expect(messageIds).toContain(f.sourceId)
 const ids=messageIds.map(literal).join(','),company=`company_id=${literal(f.companyId)}`
 const tables:[string,string][]=[
  ['public.customers',`id=${literal(f.customerId)}`],
  ['public.customer_sites',`id=${literal(f.siteId)}`],
  ['public.metering_points',`id=${literal(f.pointId)}`],
  ['public.customer_contracts',`id=${literal(f.contractId)}`],
  ['public.customer_contract_events',`customer_contract_id=${literal(f.contractId)}`],
  ['public.domain_events',`aggregate_id=${literal(f.contractId)}`],
  ['public.customer_operation_tasks',`customer_id=${literal(f.customerId)}`],
  ['public.customer_cases',`customer_id=${literal(f.customerId)}`],
  ['public.supplier_switch_requests',`id=${literal(f.switchId)}`],
  ['public.customer_supply_periods',`id=${literal(f.periodId)}`],
  ['public.ediel_messages',`id IN(${ids})`],
  ['public.ediel_message_events',`ediel_message_id IN(${ids})`],
  ['public.ediel_message_payloads',`ediel_message_id IN(${ids})`],
  ['public.ediel_outbox',`ediel_message_id IN(${ids})`],
  ['public.ediel_business_expectations',`source_message_id IN(${ids})`],
  ['public.inbound_email_messages',`id IN(SELECT inbound_email_message_id FROM public.ediel_messages WHERE id IN(${ids}))`],
  ['public.inbound_ediel_parse_results',`inbound_email_message_id IN(SELECT inbound_email_message_id FROM public.ediel_messages WHERE id IN(${ids}))`],
  ['gridex_received_sources.sources',`source_message_id IN(${ids})`],
  ['gridex_received_sources.validation_assessments',`source_message_id IN(${ids})`],
  ['gridex_received_sources.object_assessments',`source_message_id IN(${ids})`],
  ['gridex_received_sources.normal_switch_confirmations',`source_message_id IN(${ids})`],
  ['gridex_received_sources.supply_source_transitions',`source_message_id IN(${ids})`],
  ['gridex_ediel_inbound_context.receipts',`source_message_id IN(${ids})`],
  ['gridex_ediel_inbound_receptions.receptions',`source_message_id IN(${ids})`],
  ['gridex_supply_rescission.artifacts',company],
  ['gridex_supply_rescission.reviews',company],
  ['gridex_supply_rescission.mandates',company],
  ['gridex_supply_rescission.outbound_operations',company],
  ['gridex_supply_rescission.outbound_receipts',company],
  ['gridex_supply_rescission.end_receipts',company],
  ['gridex_bilateral_prodat.artifacts',company],
  ['gridex_bilateral_prodat.origins',company],
  ['gridex_bilateral_prodat.reviews',company],
  ['gridex_bilateral_prodat.profile_versions',company],
  ['gridex_bilateral_prodat.outbound_operations',company],
  ['gridex_bilateral_prodat.outbound_receipts',company],
  ['gridex_bilateral_prodat.source_capability_receipts',company],
  ['gridex_bilateral_prodat.supply_effect_receipts',company],
  ['gridex_ediel_transport.attempts',`message_id IN(${ids})`],
  ['gridex_ediel_transport.reservations',`message_id IN(${ids})`],
  ['gridex_outbound_dispatch.originals',`message_id IN(${ids})`],
  ['gridex_outbound_dispatch.attempts',`message_id IN(${ids})`],
  ['gridex_outbound_dispatch.reservations',`message_id IN(${ids})`],
  ['gridex_outbound_dispatch.events',`message_id IN(${ids})`],
  ['gridex_outbound_dispatch.witnesses',`event_id IN(SELECT id FROM gridex_outbound_dispatch.events WHERE message_id IN(${ids}))`],
  ['gridex_ediel_outbound_owner.consumptions',`source_message_id IN(${ids})`],
  ['gridex_ediel_outbound_owner.witnesses',`id IN(SELECT witness_id FROM gridex_ediel_outbound_owner.consumptions WHERE source_message_id IN(${ids}))`],
  ['public.communication_routes',`id=${literal(f.routeId)}`],
  ['public.ediel_route_profiles',`id=${literal(f.routeProfileId)}`],
 ]
 const read=()=>sql<Record<string,Record<string,unknown>[]>>(`SELECT jsonb_build_object(${tables.map(([table,where])=>`${literal(table)},(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),'[]') FROM ${table} x WHERE ${where})`).join(',')})`)
 const before=read()
 expect(before['public.ediel_messages'].find(m=>m.id===f.original.id)).toMatchObject({company_id:f.companyId,environment:'test',direction:'outbound',message_code:'Z08',status:'sent',raw_payload:f.original.raw_payload,source_operation_id:f.mandateId,immutable_payload_hash:expect.stringMatching(/^[a-f0-9]{64}$/),message_sent_at:expect.any(String)})
 expect(before['gridex_supply_rescission.outbound_operations']).toEqual([expect.objectContaining({message_id:f.original.id,company_id:f.companyId,environment:'test',mandate_id:f.mandateId,capability:expect.objectContaining({objects:[expect.objectContaining({objectId:f.external,identityAgency:'9'})]})})])
 const mandate=before['gridex_supply_rescission.mandates'].find(m=>m.id===f.mandateId)!
 expect(mandate).toMatchObject({company_id:f.companyId,environment:'test',scope:{periodId:f.periodId,externalPoint:f.external}})
 expect(before['public.customer_supply_periods']).toEqual([expect.objectContaining({id:f.periodId,company_id:f.companyId,customer_id:f.customerId,metering_point_id:f.pointId,source_message_id:f.sourceId,source_end_message_id:null,market_end_at:null,market_state_version:Number((mandate.scope as Record<string,unknown>).stateVersion)})])
 expect(before['public.ediel_business_expectations'].filter(w=>w.source_message_id===f.original.id&&w.expected_code==='Z05')).toEqual([expect.objectContaining({expected_subtype:'L',status:'pending',fulfilled_by_message_id:null,due_at:null})])
 return()=>expect(read()).toEqual(before)
}

async function acceptOrdinaryStart(f: NormalSwitchStageNativeFixture & {caseReference:string;originalZ03:EdielMessageRow}, assertSiblingPreserved:()=>void) {
  const retained = ownerSource({ readingDeclarations: true, environment: 'test',
    sourceCodes: { installationStatus: 'Z12', settlementMethod: 'Z32' } }),
    sourceId = randomUUID(), document = `L${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`
  // Explicit NEW RKv1.7 cumulative active-import counter: one untimed tariff
  // covering all hours/days/months, constant1/digits6. The shared synthetic111
  // default remains unchanged and supplies no qualified register fact.
  expect(retained.raw_payload!.split("CCI++Z16'CAV+:::111'")).toHaveLength(2)
  const raw = retained.raw_payload!
    .replaceAll('735123456789012345', f.external)
    .replaceAll('12345:14', `${f.receiver}:14`).replaceAll('54321:14', `${f.sender}:14`)
    .replaceAll('12345:160:SVK', `${f.receiver}:160:SVK`).replaceAll('54321:160:SVK', `${f.sender}:160:SVK`)
    .replace('NAD+Z02+11111:160:SVK', `NAD+Z02+${f.brpEdielId}:160:SVK`)
    .replace('RFF+LI:CASE-1', `RFF+LI:${f.caseReference}`).replace('RFF+Z05:NET-1', `RFF+Z05:${f.gridAreaCode}`)
    .replace('NAD+UD+CUSTOMER-1::89', `NAD+UD+${f.customerIdentity.id}:${f.customerIdentity.qualifier}:${f.customerIdentity.agency}`)
    .replace('DTM+92:202610010000:203', `DTM+92:${f.requestedStartDate.replaceAll('-', '')}0000:203`)
    .replace("+23-DDQ-PRODAT'", "+23-DDQ-PRODAT++1++1'")
    .replace('+I++23-DDQ-PRODAT', `+${document}++23-DDQ-PRODAT`).replace("UNZ+1+I'", `UNZ+1+${document}'`)
    .replace('UNH+M+', `UNH+${document}+`).replace(/UNT\+(\d+)\+M'/, `UNT+$1+${document}'`).replace('BGM+Z04+D+', `BGM+Z04+${document}+`)
    .replace("CCI++Z16'CAV+:::111'", "CCI++Z16'CAV+:::101'")
  // Inspect the actual prospective returned wire before any immutable birth.
  const physical = tokenizeEdifact(raw), grouped = prodatRegisterGroups(physical.segments, physical.una, 'Z04')
  expect(grouped.problems).toEqual([]); expect(grouped.groups).toHaveLength(1)
  const own = grouped.groups[0]
  expect(own).toMatchObject({ itemId: f.external, identityAgency: '9', registerPosition: 1, validRegisterChain: true })
  for (const [field, value] of [['214', '1'], ['218', '6'], ['259', '101']] as const)
    expect(prodatRegisterReadingState(field, own.segments, physical.una)).toEqual({ present: true, value, malformed: false })
  for (const [field, value] of [['217', 'Z03'], ['223', 'Z22'], ['306', 'Z12'], ['254', 'Z32']] as const)
    expect(prodatCharacteristicValues(field, own.segments, physical.una)).toEqual([value])
  const customers = own.segments.filter(segment => segment.tag === 'NAD' && segmentComposite(segment, 1, physical.una)[0] === 'UD')
  expect(customers).toHaveLength(1)
  expect(segmentComposite(customers[0], 2, physical.una)).toEqual([f.customerIdentity.id, f.customerIdentity.qualifier, f.customerIdentity.agency])
  const cases = own.segments.filter(segment => segment.tag === 'RFF' && segmentComposite(segment, 1, physical.una)[0] === 'LI')
  expect(cases).toHaveLength(1); expect(segmentComposite(cases[0], 1, physical.una)).toEqual(['LI', f.caseReference])
  const receivedAt = new Date().toISOString()
  const mail = await seedOriginalMailboxNative(sql, literal, { companyId: f.companyId, environment: 'test', raw, receivedAt, smtpFrom: assertEdielSmtpReadiness().from })
  sql(`INSERT INTO public.ediel_messages(id,company_id,customer_id,site_id,metering_point_id,grid_owner_id,environment,direction,message_standard,message_family,message_code,status,
    raw_payload,parsed_payload,message_received_at,application_reference,sender_ediel_id,receiver_ediel_id,interchange_reference,inbound_email_message_id,mailbox_message_id,
    canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
    SELECT ${literal(sourceId)},${literal(f.companyId)},${literal(f.customerId)},${literal(f.siteId)},${literal(f.pointId)},${literal(f.gridId)},'test','inbound','edifact','PRODAT','Z04','received',
    ${literal(raw)},'{}'::jsonb,${literal(receivedAt)}::timestamptz,'23-DDQ-PRODAT',${literal(f.receiver)},${literal(f.sender)},${literal(mail.parsed.interchangeReference)},${literal(mail.inboundEmailMessageId)},${literal(mail.inboundEmailMessageId)},
    pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile
    FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id WHERE profile.profile_key='PRODAT:Z04:L:26.A:r3' AND profile.is_enabled;`)
  await recordOriginalMailboxNativeReception({ ...mail, companyId: f.companyId, sourceMessageId: sourceId, actorUserId: f.actorUserId })
  const { data, error } = await supabaseService.from('ediel_messages').select('*').eq('id', sourceId).single()
  expect(error).toBeNull()
  const original = data as EdielMessageRow, decision = await resolveCanonicalRuntimeDecisionWithRegistry(original, { actorUserId: f.actorUserId })
  expect([decision.syntaxDecision, decision.applicationDecision, decision.functionalDecision], JSON.stringify(decision.issues)).toEqual(['accepted', 'accepted', 'accepted'])
  const validation = await recordReceivedSourceValidation({ original, validated: original, resolvedCompanyId: f.companyId, decision })
  expect(validation).toMatchObject({ status: 'recorded' })
  await captureFreshEdielSourceRulePackEvidence(f.companyId, sourceId)
  const session = createReceivedSourceOwnerSession(validation)
  expect(session).not.toBeNull()
  assertSiblingPreserved()
  const result = await applyInboundBusinessStateMachine({ message: original, actorUserId: f.actorUserId, matchedSwitchRequestId: f.switchId,
    onSourceSwitchCommitted: session!.onSwitchCommitted })
  expect(result.outcome, JSON.stringify(result)).toBe('supplier_switch_accepted')
  expect(await session!.finish()).toMatchObject({ sourceDisposition: 'accepted' })
  const periods = sql<{ id: string; contract: string; source: string; process: string; status: string }[]>(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'contract',customer_contract_id,'source',source_message_id,'process',source_process,'status',status)),'[]') FROM public.customer_supply_periods WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(sourceId)}`)
  expect(periods).toEqual([{ id: expect.any(String), contract: f.contractId, source: sourceId, process: 'supplier_switch_confirmation', status: 'confirmed_by_grid_owner' }])
  assertSiblingPreserved()
  return { ...f, sourceId, source:original, wire:raw, periodId: periods[0].id }
}

/** New canonical customer/contract/point; shared tenant/network state stays read-only. */
export async function prepareIndependentNationalEndTarget(base: NationalEndSibling, provider: Mock): Promise<PreparedNationalEndTarget> {
 const {companyId,actorUserId,sender,receiver,gridId,routeId,routeProfileId,brpEdielId,requestedStartDate}=base
 const assertSiblingPreserved=retainNationalSibling(base)
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.admin_users WHERE user_id=${literal(actorUserId)}`)).toBe(0)
 await assertEdielTenantActor({companyId,actorUserId,permission:'customers.write'})
 const permissions=['customers.write','contracts.read','contracts.write','contracts.create','communication.read','communication.write','communication.send','metering.read','metering.write']
 for(const permission of permissions){
  const checked=await supabaseService.rpc('gridex_actor_has_company_permission',{p_actor_user_id:actorUserId,p_company_id:companyId,p_permission:permission})
  expect(checked.error).toBeNull();expect(checked.data).toBe(true)
 }
 const contractPermission=await supabaseService.rpc('gridex_contract_actor_has_permission',{p_actor_user_id:actorUserId,p_permission:'contracts.create'})
 expect(contractPermission.error).toBeNull();expect(contractPermission.data).toBe(true)
 const binding=sql<Record<string,unknown>>(`SELECT jsonb_build_object(
  'contract_offer_id',c.contract_offer_id,'contract_publication_version_id',v.id,
  'contract_product_id',p.contract_product_id,'contract_product_version_id',v.contract_product_version_id,
  'price_plan_id',v.price_plan_id,'price_plan_version_id',v.price_plan_version_id,
  'price_book_id',v.price_book_id,'legal_bundle_version_id',v.legal_bundle_version_id,
  'offer_reference',v.offer_reference,'commercial_snapshot',p.commercial_snapshot,'legal_snapshot',l.rendered_snapshot)
  FROM public.customer_contracts c JOIN public.contract_publication_versions v ON v.id=c.contract_publication_version_id
  JOIN public.contract_product_versions p ON p.id=v.contract_product_version_id
  JOIN public.legal_bundle_versions l ON l.id=v.legal_bundle_version_id AND l.company_id=c.company_id
  WHERE c.id=${literal(base.contractId)} AND c.company_id=${literal(companyId)} AND c.status IN('signed','active')
  AND v.status='published' AND v.locked_at IS NOT NULL AND v.energy_direction='consumption'
  AND p.status='approved' AND p.locked_at IS NOT NULL AND p.energy_direction='consumption'
  AND l.status='published' AND l.locked_at IS NOT NULL AND cardinality(l.unresolved_variables)=0`)
 expect(binding).toMatchObject({contract_publication_version_id:expect.any(String),contract_product_version_id:expect.any(String),legal_bundle_version_id:expect.any(String)})
 const external=freshGsrn(),switchId=randomUUID(),customerIdentity='199002011238',customerName='Synthetic Same Company Contrast'
 const marker={test_center:{kind:'invoice_test_customer'}}
 const context=createTenantContext({companyId,actorType:'user',actorId:actorUserId,sourceChannel:'admin',permissions})
 const created=await onboardCustomerGraph({company_id:companyId,actor_user_id:actorUserId,channel:'admin',idempotency_key:randomUUID(),matching_policy:'create_only',update_existing:false,
  customer:{first_name:'Synthetic',last_name:'Contrast',name:customerName,personal_number:customerIdentity,email:`synthetic-${switchId}@example.invalid`,source:'invoice_test_center',is_test_data:true,metadata:marker},
  site:{site_name:'Synthetic same company consumption',facility_id:external,grid_owner_id:gridId,grid_area_code:base.gridAreaCode,price_area_code:'SE3',status:'active',is_test_data:true,metadata:marker},
  metering_point:{meter_point_id:external,metering_point_id:external,ediel_metering_point_id:external,grid_owner_id:gridId,grid_owner_ediel_id:receiver,grid_area_code:base.gridAreaCode,price_area_code:'SE3',status:'active',reading_frequency:'hourly',measurement_type:'consumption',product_direction:'consumption',is_settlement_relevant:true,is_test_data:true,metadata:marker},
  contract:{...binding,status:'draft',contract_version:'v1',contract_type:'variable_hourly',energy_direction:'consumption',source_type:'manual_override',contract_name:'Synthetic same company consumption',starts_at:requestedStartDate,requested_start_date:requestedStartDate,metadata:marker,created_by:actorUserId}},context)
 expect(created).toMatchObject({ok:true,code:'customer_onboarding_committed',created_new_customer:true,operation_id:expect.any(String),application_id:expect.any(String),outbox_event_id:expect.any(String),customer_id:expect.any(String),site_id:expect.any(String),metering_point_id:expect.any(String),contract_id:expect.any(String)})
 if(!created.ok||!created.site_id||!created.metering_point_id||!created.contract_id)throw Error('same_company_canonical_graph_required')
 const customerId=created.customer_id,siteId=created.site_id,pointId=created.metering_point_id,contractId=created.contract_id
 assertSiblingPreserved()
 expect(customerId).not.toBe(base.customerId);expect(siteId).not.toBe(base.siteId);expect(pointId).not.toBe(base.pointId);expect(contractId).not.toBe(base.contractId);expect(external).not.toBe(base.external)
 await signInvoiceTestContractCanonically({companyId,customerId,contractId,actorUserId})
 const organizationNumber=sql<string>(`SELECT to_jsonb(organization_number) FROM public.companies WHERE id=${literal(companyId)}`)
 const signed=sql<Record<string,unknown>>(`SELECT to_jsonb(c) FROM public.customer_contracts c WHERE id=${literal(contractId)}`)
 const legalVersions=sql<{type:string;title:string;version:string;id:string;body:string}[]>(`SELECT jsonb_agg(jsonb_build_object('type',module_key,'title',title,'version',coalesce(template_version,left(content_sha256,12)),'id',id,'body',rendered_body)) FROM public.legal_bundle_version_documents WHERE legal_bundle_version_id=${literal(signed.legal_bundle_version_id)}`)
 const attachment=buildAgreementPdfAttachment({companyName:'Synthetic Archive AB',organizationNumber,customerName,customerEmail:`synthetic-${switchId}@example.invalid`,customerNumber:customerId,contractNumber:String(signed.contract_number??contractId),contractName:'Synthetic native hourly',contractType:'variable_hourly',signedAt:String(signed.signed_at),startsAt:requestedStartDate,offerReference:String(signed.offer_reference),contractPublicationVersionId:String(signed.contract_publication_version_id),pricePlanVersionId:String(signed.price_plan_version_id),legalBundleVersionId:String(signed.legal_bundle_version_id),signatureSnapshotSha256:String(signed.signature_snapshot_sha256),legalVersions,monthlyFeeSek:49,spotMarkupOrePerKwh:4})
 const pdfBuffer=Buffer.from(attachment.content,'base64'),documentSha256=createHash('sha256').update(pdfBuffer).digest('hex')
 await archiveSignedCustomerContractPdf({companyId,customerContractId:contractId,pdfBuffer,documentSha256,generationSnapshot:{schema:'gridex_signed_contract_document_v1',contract_id:contractId,signature_snapshot_sha256:signed.signature_snapshot_sha256,synthetic:true}})
 const bound=await supabaseService.from('customer_contracts').update({document_sha256:documentSha256}).eq('id',contractId).eq('company_id',companyId).is('document_sha256',null);expect(bound.error).toBeNull()
 assertSiblingPreserved()
 const registry=normalSwitchNetworkRegistry(companyId);expect(registry).toBeDefined()
 const currentRegistry=await readNetworkRegistrySourceArtifact({companyId,actorUserId:registry!.reviewerId,artifactId:registry!.artifact.artifactId})
 expect(currentRegistry).toMatchObject({status:'authorized',missing:[],networkActorId:base.marketActorId,networkEdielId:receiver,sourceHash:registry!.artifact.sourceHash,claimsHash:registry!.artifact.claimsHash})
 const grounds=sql<string[]>(`SELECT coalesce(jsonb_agg(id),'[]') FROM gridex_brp_changes.registry_grounds
  WHERE company_id=${literal(companyId)} AND environment='test' AND dso_ediel_id=${literal(receiver)}
  AND brp_ediel_id=${literal(brpEdielId)} AND grid_area_code=${literal(base.gridAreaCode)}`)
 expect(grounds).toHaveLength(1);const registryGroundId=grounds[0]
 const {createBilateralSourceOperator}=await import('./ediel-bilateral-customer-native-fixture')
 const brpUploader=await createBilateralSourceOperator(companyId,['communication.read','communication.write','customers.read','customers.write','contracts.read','contracts.write'])
 const brpReviewer=await createBilateralSourceOperator(companyId,['communication.read','communication.write','customers.read','customers.write','contracts.read','contracts.write','ediel.source.review'])
 const brpSelector={environment:'test' as const,contractId,registryGroundId,identityAgency:'9' as const}
 const brpScope=await brpUploader.client.rpc('ediel_signed_brp_declaration_scope_v1',{p_company_id:companyId,p_actor_user_id:brpUploader.id,p_selector:{...brpSelector,agreementHash:documentSha256}})
 expect(brpScope.error,JSON.stringify(brpScope.error)).toBeNull();expect(brpScope.data).toMatchObject({status:'scope_available'})
 const brpKey=randomUUID(),brpRepresentation=randomUUID(),brpSecret=Buffer.from('SYNTHETIC BRP declaration issuer key '+brpKey),brpLegal='SYNTHETIC BRP DECLARATION ISSUER ONLY',brpRepresentationLegal='SYNTHETIC BRP DECLARATION REPRESENTATION ONLY'
 sql(`INSERT INTO gridex_brp_declaration_intake.issuer_keys(id,company_id,environment,issuer_code,legal_source_reference,legal_source_sha256,signing_key,valid_from,valid_to) VALUES(${literal(brpKey)},${literal(companyId)},'test','SYNTHETIC',${literal(brpLegal)},${literal(createHash('sha256').update(brpLegal).digest('hex'))},decode(${literal(brpSecret.toString('hex'))},'hex'),'2020-01-01','2099-01-01');
 INSERT INTO gridex_brp_declaration_intake.issuer_representations(id,company_id,environment,issuer_key_id,legal_actor_id,purpose,legal_source_reference,legal_source_sha256,valid_from,valid_to) VALUES(${literal(brpRepresentation)},${literal(companyId)},'test',${literal(brpKey)},${literal((brpScope.data as {claims:{legalActorId:string}}).claims.legalActorId)},'signed_contract_brp_declaration',${literal(brpRepresentationLegal)},${literal(createHash('sha256').update(brpRepresentationLegal).digest('hex'))},'2020-01-01','2099-01-01')`)
 const brpSource=Buffer.from('SYNTHETIC signed BRP declaration source '+contractId),brpSourceReference='SYNTHETIC-native-brp-'+contractId
 const brpClaimsHash=(brpScope.data as {claimsHash:string}).claimsHash,issuedAt=new Date(Date.now()-60000).toISOString(),expiresAt=new Date(Date.now()+86400000).toISOString()
 const brpPayload=Buffer.from(JSON.stringify({format:'ediel_signed_brp_declaration_receipt_v1',purpose:'signed_contract_brp_declaration',companyId,environment:'test',issuerCode:'SYNTHETIC',receiptId:randomUUID(),issuerLegalReference:brpLegal,representationLegalReference:brpRepresentationLegal,claimsHash:brpClaimsHash,agreementHash:documentSha256,sourceHash:createHash('sha256').update(brpSource).digest('hex'),sourceReference:brpSourceReference,sourceVersion:'1',issuedAt,expiresAt}))
 const brpArchive=await brpUploader.client.rpc('ediel_archive_signed_brp_declaration_v1',{p_company_id:companyId,p_actor_user_id:brpUploader.id,p_submission:{...brpSelector,agreementBase64:pdfBuffer.toString('base64'),sourceBase64:brpSource.toString('base64'),sourceReference:brpSourceReference,sourceVersion:'1',issuerReceipt:{keyId:brpKey,representationId:brpRepresentation,payloadBase64:brpPayload.toString('base64'),signatureHex:createHmac('sha256',brpSecret).update(brpPayload).digest('hex')}}})
 expect(brpArchive.error,JSON.stringify(brpArchive.error)).toBeNull();expect(brpArchive.data).toMatchObject({status:'archived',issuerQualified:true})
 const archivedBrp=brpArchive.data as {artifactId:string;agreementHash:string;sourceHash:string;claimsHash:string}
 const brpReview=await brpReviewer.client.rpc('ediel_review_signed_brp_declaration_v1',{p_company_id:companyId,p_actor_user_id:brpReviewer.id,p_artifact_id:archivedBrp.artifactId,p_review:{agreementHash:archivedBrp.agreementHash,sourceHash:archivedBrp.sourceHash,claimsHash:archivedBrp.claimsHash,decision:'approve',reason:'SYNTHETIC separate review of the signed BRP declaration',clause:{locator:'page1 synthetic',quote:'SYNTHETIC balance responsible party declaration'}}})
 expect(brpReview.error,JSON.stringify(brpReview.error)).toBeNull();expect(brpReview.data).toMatchObject({status:'authorized'})
 assertSiblingPreserved()
 // End-user UD masterdata for a dated (future) switch day cannot come from
 // today's registered address. Bind a declared SYNTHETIC signed masterdata
 // declaration to this exact signed contract (same agreement bytes, revision
 // and production contract hash). It is a fixture fact, never real approval.
 const declarationSource=Buffer.from('SYNTHETIC signed customer masterdata declaration '+contractId)
 sql(`INSERT INTO gridex_customer_masterdata.signed_declarations(company_id,customer_id,environment,contract_id,contract_revision,contract_hash,agreement_original,agreement_sha256,valid_from,customer_identity,end_user_masterdata,source_reference,source_version,source_original,source_sha256,approved_by,approved_at)
  SELECT c.company_id,c.customer_id,'test',c.id,c.signed_version,gridex_received_sources.production_contract_hash_v1(c),decode(${literal(pdfBuffer.toString('hex'))},'hex'),${literal(documentSha256)},'2026-01-01T00:00:00Z',
  jsonb_build_object('id',${literal(customerIdentity)},'qualifier','SE2','agency','260'),
  jsonb_build_object('nameParts',jsonb_build_array(${literal(customerName)}),'streetParts',jsonb_build_array('Testgatan 1'),'postalCode','123 45','city','Teststad','country','SE'),
  ${literal('SYNTHETIC-native-masterdata-'+contractId)},'1',decode(${literal(declarationSource.toString('hex'))},'hex'),${literal(createHash('sha256').update(declarationSource).digest('hex'))},${literal(actorUserId)},clock_timestamp()
  FROM public.customer_contracts c WHERE c.id=${literal(contractId)} AND c.company_id=${literal(companyId)}`)
 // The new agreement's requested metering method is its own signed source.
 // Bind a declared SYNTHETIC method declaration to the same contract bytes and
 // the point/grid/legal header actually seeded above (hourly Z04).
 const methodSource=Buffer.from('SYNTHETIC signed new-agreement requested method '+contractId)
 sql(`INSERT INTO gridex_metering_method_changes.contract_request_declarations(company_id,environment,contract_id,contract_revision,protected_contract_hash,customer_id,site_id,metering_point_id,legal_actor_id,legal_sender_id,legal_receiver_id,point_id,identity_agency,grid_area_code,requested_method,agreement_original,agreement_sha256,source_reference,source_version,source_original,source_sha256,approved_by,approved_at)
  SELECT c.company_id,'test',c.id,c.signed_version,gridex_received_sources.production_contract_hash_v1(c),c.customer_id,coalesce(c.customer_site_id,c.site_id),c.metering_point_id,
  (gridex_ai_processing.header_company_basis_v1(c.company_id,'test',${literal(sender)},p.grid_owner_ediel_id)->>'legalActorId')::uuid,${literal(sender)},p.grid_owner_ediel_id,
  coalesce(nullif(p.ediel_metering_point_id,''),nullif(p.meter_point_id,'')),'9',p.grid_area_code,'Z04',decode(${literal(pdfBuffer.toString('hex'))},'hex'),${literal(documentSha256)},
  ${literal('SYNTHETIC-native-method-'+contractId)},'1',decode(${literal(methodSource.toString('hex'))},'hex'),${literal(createHash('sha256').update(methodSource).digest('hex'))},${literal(actorUserId)},clock_timestamp()
  FROM public.customer_contracts c JOIN public.metering_points p ON p.id=c.metering_point_id WHERE c.id=${literal(contractId)} AND c.company_id=${literal(companyId)}`)
 // Explicit test-only manual authorization is created by its existing public
 // admin writer and exact chain helper. It is a declared synthetic legal fact,
 // never a private owner receipt or claim of real customer authentication.
 assertSiblingPreserved()
 const poaReference=`POA${switchId.replace(/-/g,'').slice(0,12).toUpperCase()}`
 const poa=await savePowerOfAttorney(supabaseService,{customer_id:customerId,site_id:siteId,companyId,reference:poaReference,scope:'supplier_switch',status:'draft',signed_at:null,valid_from:'2026-01-01',valid_to:'2099-01-01',method:'manual_pdf',signer_name:customerName,signer_identity_number:customerIdentity,accepted_at:null,accepted_source:'synthetic_native_fixture',signedScopes:['supplier_switch','grid_owner_data','metering_data'],scopeSummary:{scopes:['supplier_switch','grid_owner_data','metering_data']}})
 const poaLink=await supabaseService.from('powers_of_attorney').update({contract_id:contractId,customer_contract_id:contractId}).eq('id',poa.id).eq('company_id',companyId);expect(poaLink.error).toBeNull()
 await savePowerOfAttorney(supabaseService,{id:poa.id,customer_id:customerId,site_id:siteId,companyId,reference:poaReference,scope:'supplier_switch',status:'signed',signed_at:new Date().toISOString(),valid_from:'2026-01-01',valid_to:'2099-01-01',method:'manual_pdf',signer_name:customerName,signer_identity_number:customerIdentity,accepted_at:new Date().toISOString(),accepted_source:'synthetic_native_fixture',signedScopes:['supplier_switch','grid_owner_data','metering_data'],scopeSummary:{scopes:['supplier_switch','grid_owner_data','metering_data']}})
 const poaScopes=['supplier_switch','grid_owner_data','metering_data']
 const authorization=await ensureAuthorizationDocumentFromPowerOfAttorney({companyId,customerId,powerOfAttorneyId:poa.id,siteId,meteringPointId:pointId,contractId,coverage:powerOfAttorneyCoverageFromScopes(poaScopes),signedScopes:poaScopes})
 const authorizationDocumentId=authorization.authorizationDocumentId;expect(authorizationDocumentId).toBeTruthy()
 expect(sql(`SELECT to_jsonb(switch_ready) FROM public.customer_contract_lifecycle_readiness_v WHERE customer_contract_id=${literal(contractId)}`)).toBe(true)
 assertSiblingPreserved()
 // P26.A: the invoicee is an independent caller selection, never inferred.
 // The synthetic selection names the end user at the same address.
 const invoiceeAddress={lines:['Testgatan 1','',''],postalCode:'123 45',city:'Teststad',country:'SE',representation:{convention:'original',reference:'SYNTHETIC',mode:1}}
 const invoiceeSnapshot={portalData:{powerOfAttorneyReference:poaReference,dependentConditionFacts:{invoiceeObjects:[{meteringPointId:external,identityAgency:'9',
  endUser:{identity:{id:customerIdentity,qualifier:'SE2',agency:'260'},address:invoiceeAddress},
  invoicee:{identity:{id:customerIdentity,qualifier:'SE2',agency:'260'},nameLines:[customerName],address:invoiceeAddress,availability:'available'},
  event:{state:'none',reference:`fixture-invoicee:${switchId}`},source:{kind:'caller_selection',companyId,reference:`fixture-invoicee:${switchId}`}}]}}}
 sql(`INSERT INTO public.supplier_switch_requests(id,company_id,customer_id,site_id,customer_site_id,metering_point_id,grid_owner_id,contract_id,customer_contract_id,power_of_attorney_id,authorization_document_id,request_type,status,requested_start_date,prodat_variant,prodat_reason,lifecycle_blocked,validation_snapshot) VALUES(${literal(switchId)},${literal(companyId)},${literal(customerId)},${literal(siteId)},${literal(siteId)},${literal(pointId)},${literal(gridId)},${literal(contractId)},${literal(contractId)},${literal(poa.id)},${literal(authorizationDocumentId)},'switch','ready',${literal(requestedStartDate)},${literal('L')},${literal('Z22')},false,${literal(JSON.stringify(invoiceeSnapshot))}::jsonb);`)
 const stage={companyId,actorUserId,customerId,siteId,pointId,contractId,switchId,external,sender,receiver,gridId,routeId,routeProfileId,marketActorId:base.marketActorId,customerIdentity:{id:customerIdentity,qualifier:'SE2' as const,agency:'260' as const},requestedStartDate,brpEdielId,gridAreaCode:base.gridAreaCode,documentSha256,authorizationDocumentId:authorizationDocumentId!,powerOfAttorneyId:poa.id}
 const queued=await prepareAndQueueEdielZ03({actorUserId,switchRequestId:switchId,communicationRouteId:routeId,environment:'test'})
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.switch_originals WHERE message_id=${literal(queued.id)}`)).toBe(1)
 provider.mockReset();provider.mockResolvedValue({accepted:['recipient@example.invalid'],rejected:[],messageId:'synthetic-independent-L-start-original',response:'250 synthetic accepted'})
 await sendEdielMessageViaSmtp(queued,{actorUserId,smtpMimeMode:'nodemailer-attachment'})
 assertSiblingPreserved()
 const originalZ03=await getEdielMessageById(queued.id);expect(originalZ03).not.toBeNull()
 const tokenized=tokenizeEdifact(originalZ03!.raw_payload!),li=tokenized.segments.find(t=>t.tag==='RFF'&&segmentComposite(t,1,tokenized.una)[0]==='LI'),caseReference=li?segmentComposite(li,1,tokenized.una)[1]:null;expect(caseReference).toBeTruthy()
 expect(sql(`SELECT to_jsonb(gridex_received_sources.sent_source_is_current_v1(m)) FROM public.ediel_messages m WHERE id=${literal(queued.id)}`)).toBe(true)
 const result=await acceptOrdinaryStart({...stage,caseReference:caseReference!,originalZ03:originalZ03!},assertSiblingPreserved)
 assertSiblingPreserved()
 expect(result.companyId).toBe(base.companyId);expect(result.periodId).not.toBe(base.periodId)
 expect(result.sourceId).not.toBe(base.sourceId);expect(result.originalZ03.id).not.toBe(base.original.id);expect(result.caseReference).not.toBe(base.li)
 expect(sql(`SELECT jsonb_build_object(
  'period',(SELECT jsonb_build_object('company',company_id,'customer',customer_id,'point',metering_point_id,'contract',customer_contract_id,'source',source_message_id,'status',status,'end',source_end_message_id) FROM public.customer_supply_periods WHERE id=${literal(result.periodId)}),
  'sourceHashValid',(SELECT payload_hash=encode(sha256(convert_to(${literal(result.wire)},'UTF8')),'hex') FROM gridex_received_sources.sources WHERE source_message_id=${literal(result.sourceId)} AND company_id=${literal(companyId)} AND environment='test'),
  'hOperations',(SELECT count(*) FROM gridex_supply_rescission.outbound_operations WHERE company_id=${literal(companyId)} AND environment='test' AND capability#>>'{objects,0,objectId}'=${literal(external)}),
  'hMandates',(SELECT count(*) FROM gridex_supply_rescission.mandates WHERE company_id=${literal(companyId)} AND environment='test' AND(scope->>'periodId'=${literal(result.periodId)} OR scope->>'externalPoint'=${literal(external)})))`)).toEqual({
  period:{company:companyId,customer:customerId,point:pointId,contract:contractId,source:result.sourceId,status:'confirmed_by_grid_owner',end:null},
  sourceHashValid:true,hOperations:0,hMandates:0,
 })
 assertSiblingPreserved()
 return {...result,assertSiblingPreserved}
}
