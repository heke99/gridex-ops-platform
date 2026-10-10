// Disposable D input producer. Its positive consumption precondition declares
// a new active installation and one untimed cumulative import register.
// Original actor/mail/reception READs qualify the prospective source input.
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { expect } from 'vitest'
import { ownerSource } from '../../__tests__/helpers/sourceOwnerFixtures'
import { prodatRegisterGroups } from '@/lib/ediel/prodat/prodatRegisterGroups'
import { prodatRegisterReadingState } from '@/lib/ediel/prodat/prodatRegisterReadings'
import { prodatCharacteristicValues } from '@/lib/ediel/prodat/prodatCharacteristicFields'
import { guideOrderedFixtureRaw } from '../../__tests__/helpers/prodatGuideOrderedFixture'
import { characteristic, line, qty, type Parts } from '../../__tests__/fixtures/prodat-register'
import { seedNormalSwitchNativeFixture, futureNativeSupplyDate, nativeSql as sql, literal, nativeActorRoleSql, normalSwitchNetworkRegistry } from './ediel-normal-switch-native-fixture'
import { seedOriginalMailboxNative, recordOriginalMailboxNativeReception } from './originalMailboxNative'
import { supabaseService } from '@/lib/supabase/service'
import { assertEdielSmtpReadiness } from '@/lib/ediel/mailReadiness'
import { resolveCanonicalRuntimeDecisionWithRegistry } from '@/lib/ediel/core/runtimeDecision'
import { recordReceivedSourceValidation } from '@/lib/ediel/core/receivedSourceValidationLedger'
import { captureFreshEdielSourceRulePackEvidence } from '@/lib/ediel/core/sourceRulePackEvidence'
import { createReceivedSourceOwnerSession } from '@/lib/ediel/sources/receivedSourceOwnerSession'
import { applyInboundBusinessStateMachine } from '@/lib/ediel/flows/inboundBusinessStateMachine'
import { signInvoiceTestContractCanonically } from '@/lib/ediel/testing/invoiceTestContractLifecycle'
import { buildAgreementPdfAttachment, type AgreementPdfLegalVersion } from '@/lib/customer-contracts/agreementPdf'
import { archiveSignedCustomerContractPdf } from '@/lib/customer-contracts/documents'
import { readRegulatedSupplyGroundScope, archiveRegulatedSupplyGround, reviewRegulatedSupplyGround, type RegulatedSupplySelector, type RegulatedSupplySubmission } from '@/lib/ediel/production/regulatedSupplyGroundIntake'
import type { EdielMessageRow } from '@/lib/ediel/types'

import { onboardCustomerGraph } from '@/lib/customers/canonicalOnboarding'
import { createTenantContext } from '@/lib/tenant/context'
import { assertEdielTenantActor } from '@/lib/ediel/services/authorization'
import { savePowerOfAttorney } from '@/lib/operations/db'
import { ensureAuthorizationDocumentFromPowerOfAttorney } from '@/lib/legal/authorizationChain'
import { powerOfAttorneyCoverageFromScopes } from '@/lib/operations/powerOfAttorneyWorkflow'
import { prepareAndQueueEdielZ03 } from '@/lib/ediel/flows/prodatSwitch'
import { sendEdielMessageViaSmtp } from '@/lib/ediel/transport'
import { getEdielMessageById } from '@/lib/ediel/db'
import { tokenizeEdifact, segmentComposite } from '@/lib/ediel/core/edifactTokenizer'
import { readNetworkRegistrySourceArtifact } from '@/lib/ediel/production/networkRegistrySource'

type Provider = (email: string) => void

function freshGsrn() {
  const digits = `73512${(Number.parseInt(randomUUID().replaceAll('-', '').slice(0, 12), 16) % 1000000000000).toString().padStart(12, '0')}`
  const sum = [...digits].reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0)
  return `${digits}${(10 - sum % 10) % 10}`
}

function stampOriginal(wire: string, sender: string, receiver: string, document: string) {
  return wire.replace('+S+R+', `+${sender}:14+${receiver}:14+`)
    .replace("+23-DDQ-PRODAT'", "+23-DDQ-PRODAT++1++1'")
    .replace('+I++23-DDQ-PRODAT', `+${document}++23-DDQ-PRODAT`).replace("UNZ+1+I'", `UNZ+1+${document}'`)
    .replace('UNH+M+', `UNH+${document}+`).replace(/UNT\+(\d+)\+M'/, `UNT+$1+${document}'`)
    .replace('BGM+Z04+D+', `BGM+Z04+${document}+`)
}

/** All public source/validation/application owners run. Complete physical
 * input precedes original birth and the actor's fresh source READ.
 * No private context, validation, source witness or period is inserted. */
export async function createConsumptionPrecondition(provider: Provider) {
  return acceptConsumptionPrecondition(await seedNormalSwitchNativeFixture({ requestedStartDate: futureNativeSupplyDate(), external: freshGsrn(), provider }))
}

async function acceptConsumptionPrecondition(f: Awaited<ReturnType<typeof seedNormalSwitchNativeFixture>>) {
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
    ${literal(raw)},${literal(retained.parsed_payload)}::jsonb,${literal(receivedAt)}::timestamptz,'23-DDQ-PRODAT',${literal(f.receiver)},${literal(f.sender)},${literal(mail.parsed.interchangeReference)},${literal(mail.inboundEmailMessageId)},${literal(mail.inboundEmailMessageId)},
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
  const result = await applyInboundBusinessStateMachine({ message: original, actorUserId: f.actorUserId, matchedSwitchRequestId: f.switchId,
    onSourceSwitchCommitted: session!.onSwitchCommitted })
  expect(result.outcome, JSON.stringify(result)).toBe('supplier_switch_accepted')
  expect(await session!.finish()).toMatchObject({ sourceDisposition: 'accepted' })
  const periods = sql<{ id: string; contract: string; source: string; process: string; status: string }[]>(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'contract',customer_contract_id,'source',source_message_id,'process',source_process,'status',status)),'[]') FROM public.customer_supply_periods WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(sourceId)}`)
  expect(periods).toEqual([{ id: expect.any(String), contract: f.contractId, source: sourceId, process: 'supplier_switch_confirmation', status: 'confirmed_by_grid_owner' }])
  return { ...f, consumptionSourceId: sourceId, periodId: periods[0].id }
}


/** A second real customer in the existing company. No protected signature,
 * accepted source, context, witness, receipt or period is cloned or seeded. */
async function createAdditionalSameCompanyConsumption(base: Awaited<ReturnType<typeof createConsumptionPrecondition>>, provider: Provider) {
 const {companyId,actorUserId,sender,receiver,gridId,routeId,routeProfileId,brpEdielId,requestedStartDate}=base
 const retainedGraph=()=>sql(`SELECT jsonb_build_object(
  'customer',(SELECT to_jsonb(c) FROM public.customers c WHERE id=${literal(base.customerId)}),
  'site',(SELECT to_jsonb(s) FROM public.customer_sites s WHERE id=${literal(base.siteId)}),
  'point',(SELECT to_jsonb(p) FROM public.metering_points p WHERE id=${literal(base.pointId)}),
  'contract',(SELECT to_jsonb(c) FROM public.customer_contracts c WHERE id=${literal(base.contractId)}),
  'switch',(SELECT to_jsonb(s) FROM public.supplier_switch_requests s WHERE id=${literal(base.switchId)}),
  'period',(SELECT to_jsonb(p) FROM public.customer_supply_periods p WHERE id=${literal(base.periodId)}),
  'original',(SELECT to_jsonb(m) FROM public.ediel_messages m WHERE id=${literal(base.originalZ03.id)}),
  'confirmation',(SELECT to_jsonb(m) FROM public.ediel_messages m WHERE id=${literal(base.consumptionSourceId)}))`)
 const before=retainedGraph()
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
 expect(customerId).not.toBe(base.customerId);expect(siteId).not.toBe(base.siteId);expect(pointId).not.toBe(base.pointId);expect(contractId).not.toBe(base.contractId);expect(external).not.toBe(base.external)
 await signInvoiceTestContractCanonically({companyId,customerId,contractId,actorUserId})
 const organizationNumber=sql<string>(`SELECT to_jsonb(organization_number) FROM public.companies WHERE id=${literal(companyId)}`)
 const signed=sql<Record<string,unknown>>(`SELECT to_jsonb(c) FROM public.customer_contracts c WHERE id=${literal(contractId)}`)
 const legalVersions=sql<{type:string;title:string;version:string;id:string;body:string}[]>(`SELECT jsonb_agg(jsonb_build_object('type',module_key,'title',title,'version',coalesce(template_version,left(content_sha256,12)),'id',id,'body',rendered_body)) FROM public.legal_bundle_version_documents WHERE legal_bundle_version_id=${literal(signed.legal_bundle_version_id)}`)
 const attachment=buildAgreementPdfAttachment({companyName:'Synthetic Archive AB',organizationNumber,customerName,customerEmail:`synthetic-${switchId}@example.invalid`,customerNumber:customerId,contractNumber:String(signed.contract_number??contractId),contractName:'Synthetic native hourly',contractType:'variable_hourly',signedAt:String(signed.signed_at),startsAt:requestedStartDate,offerReference:String(signed.offer_reference),contractPublicationVersionId:String(signed.contract_publication_version_id),pricePlanVersionId:String(signed.price_plan_version_id),legalBundleVersionId:String(signed.legal_bundle_version_id),signatureSnapshotSha256:String(signed.signature_snapshot_sha256),legalVersions,monthlyFeeSek:49,spotMarkupOrePerKwh:4})
 const pdfBuffer=Buffer.from(attachment.content,'base64'),documentSha256=createHash('sha256').update(pdfBuffer).digest('hex')
 await archiveSignedCustomerContractPdf({companyId,customerContractId:contractId,pdfBuffer,documentSha256,generationSnapshot:{schema:'gridex_signed_contract_document_v1',contract_id:contractId,signature_snapshot_sha256:signed.signature_snapshot_sha256,synthetic:true}})
 const bound=await supabaseService.from('customer_contracts').update({document_sha256:documentSha256}).eq('id',contractId).eq('company_id',companyId).is('document_sha256',null);expect(bound.error).toBeNull()
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
 const poaReference=`POA${switchId.replace(/-/g,'').slice(0,12).toUpperCase()}`
 const poa=await savePowerOfAttorney(supabaseService,{customer_id:customerId,site_id:siteId,companyId,reference:poaReference,scope:'supplier_switch',status:'draft',signed_at:null,valid_from:'2026-01-01',valid_to:'2099-01-01',method:'manual_pdf',signer_name:customerName,signer_identity_number:customerIdentity,accepted_at:null,accepted_source:'synthetic_native_fixture',signedScopes:['supplier_switch','grid_owner_data','metering_data'],scopeSummary:{scopes:['supplier_switch','grid_owner_data','metering_data']}})
 const poaLink=await supabaseService.from('powers_of_attorney').update({contract_id:contractId,customer_contract_id:contractId}).eq('id',poa.id).eq('company_id',companyId);expect(poaLink.error).toBeNull()
 await savePowerOfAttorney(supabaseService,{id:poa.id,customer_id:customerId,site_id:siteId,companyId,reference:poaReference,scope:'supplier_switch',status:'signed',signed_at:new Date().toISOString(),valid_from:'2026-01-01',valid_to:'2099-01-01',method:'manual_pdf',signer_name:customerName,signer_identity_number:customerIdentity,accepted_at:new Date().toISOString(),accepted_source:'synthetic_native_fixture',signedScopes:['supplier_switch','grid_owner_data','metering_data'],scopeSummary:{scopes:['supplier_switch','grid_owner_data','metering_data']}})
 const poaScopes=['supplier_switch','grid_owner_data','metering_data']
 const authorization=await ensureAuthorizationDocumentFromPowerOfAttorney({companyId,customerId,powerOfAttorneyId:poa.id,siteId,meteringPointId:pointId,contractId,coverage:powerOfAttorneyCoverageFromScopes(poaScopes),signedScopes:poaScopes})
 const authorizationDocumentId=authorization.authorizationDocumentId;expect(authorizationDocumentId).toBeTruthy()
 expect(sql(`SELECT to_jsonb(switch_ready) FROM public.customer_contract_lifecycle_readiness_v WHERE customer_contract_id=${literal(contractId)}`)).toBe(true)
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
 provider('recipient@example.invalid');await sendEdielMessageViaSmtp(queued,{actorUserId,smtpMimeMode:'nodemailer-attachment'})
 const originalZ03=await getEdielMessageById(queued.id);expect(originalZ03).not.toBeNull()
 const tokenized=tokenizeEdifact(originalZ03!.raw_payload!),li=tokenized.segments.find(t=>t.tag==='RFF'&&segmentComposite(t,1,tokenized.una)[0]==='LI'),caseReference=li?segmentComposite(li,1,tokenized.una)[1]:null;expect(caseReference).toBeTruthy()
 expect(sql(`SELECT to_jsonb(gridex_received_sources.sent_source_is_current_v1(m)) FROM public.ediel_messages m WHERE id=${literal(queued.id)}`)).toBe(true)
 const result=await acceptConsumptionPrecondition({...stage,caseReference:caseReference!,originalZ03:originalZ03!})
 expect(retainedGraph()).toEqual(before)
 expect(result.companyId).toBe(base.companyId);expect(result.periodId).not.toBe(base.periodId)
 expect(result.consumptionSourceId).not.toBe(base.consumptionSourceId);expect(result.originalZ03.id).not.toBe(base.originalZ03.id);expect(result.caseReference).not.toBe(base.caseReference)
 return result
}

async function createProductionContract(f: Awaited<ReturnType<typeof createConsumptionPrecondition>>) {
  // The normal fixture has already removed its temporary platform admin.
  // Clean native replay lacks some hosted reference catalog keys. This local
  // catalog insert grants nothing; the existing company actor is qualified below.
  const permissions = ['contracts.create', 'contracts.publish', 'pricing.publish', 'pricing.write']
  const permissionKeys = permissions.map(literal).join(',')
  sql(`INSERT INTO public.permissions(key,name,description,category,is_active)
    SELECT key,key,'Synthetic D public production operations reference','native_fixture',true
    FROM unnest(ARRAY[${permissionKeys}]::text[]) key
    ON CONFLICT(key) DO NOTHING`)
  expect(sql(`SELECT to_jsonb(EXISTS(SELECT FROM public.company_memberships
    WHERE company_id=${literal(f.companyId)} AND user_id=${literal(f.actorUserId)} AND status='active' AND is_active)
    AND EXISTS(SELECT FROM public.user_roles WHERE company_id=${literal(f.companyId)}
    AND user_id=${literal(f.actorUserId)} AND status='active' AND is_active))`)).toBe(true)
  expect(sql(`SELECT jsonb_agg(key ORDER BY key) FROM public.permissions
    WHERE key IN(${permissionKeys}) AND is_active`)).toEqual(permissions)
  sql(`INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key,effect,status,is_active)
    SELECT ${literal(f.actorUserId)},${literal(f.companyId)},id,key,'allow','active',true FROM public.permissions
    WHERE key IN(${permissionKeys}) AND is_active`)
  for (const permission of permissions) {
    const checked = await supabaseService.rpc('gridex_actor_has_company_permission', {
      p_actor_user_id: f.actorUserId, p_company_id: f.companyId, p_permission: permission,
    })
    expect(checked.error).toBeNull()
    expect(checked.data).toBe(true)
  }
  const productionPointId = randomUUID(), productionSiteId = randomUUID(), productionContractId = randomUUID(), productionExternal = freshGsrn()
  const marker = { test_center: { kind: 'invoice_test_customer' } }
  const site = await supabaseService.from('customer_sites').insert({ id: productionSiteId, company_id: f.companyId, customer_id: f.customerId,
    site_name: 'Synthetic separate production site', facility_id: productionExternal, grid_owner_id: f.gridId, grid_area_code: f.gridAreaCode,
    price_area_code: 'SE3', status: 'active', is_test_data: true, metadata: marker })
  expect(site.error).toBeNull()
  const point = await supabaseService.from('metering_points').insert({ id: productionPointId, company_id: f.companyId, customer_id: f.customerId,
    site_id: productionSiteId, customer_site_id: productionSiteId, meter_point_id: productionExternal, metering_point_id: productionExternal,
    ediel_metering_point_id: productionExternal, grid_owner_id: f.gridId, grid_owner_ediel_id: f.receiver, grid_area_code: f.gridAreaCode,
    price_area_code: 'SE3', status: 'active', reading_frequency: 'hourly', measurement_type: 'production', product_direction: 'production',
    is_settlement_relevant: true, is_test_data: true, metadata: marker })
  expect(point.error).toBeNull()
  const pricing = { schema: 'gridex_contract_pricing_v5', pricing_model: 'spot', energy_direction: 'production', interval_resolution: 'hourly', vat_rate: 0.25,
    price_areas: ['SE3'], production: { enabled: true, settlement_mode: 'credit_invoice', compensation_ore_per_kwh: 1 },
    base_components: [{ source_type: 'spot', label: 'Spotpris', weight_percent: 100, price_area: 'SE3' }],
    price_components: [{ component_code: 'spot_markup', component_type: 'markup', name: 'Påslag', calculation_type: 'per_kwh', amount: 1, unit: 'ore_per_kwh', website_card_visible: true }] }
  // Offer availability is today; the customer's supply start remains future.
  // Use public draft creation and readiness-gated publication, not the legacy
  // one-off producer whose draft save cannot yield a locked publication.
  const availableFrom = sql<string>('SELECT to_jsonb(current_date::text)')
  const created = await supabaseService.rpc('gridex_upsert_internal_contract_offer_v2', {
    p_company_id: f.companyId, p_offer_id: null, p_actor_user_id: f.actorUserId,
    p_payload: { name: 'Synthetic separate production receipt contract', lifecycle_status: 'draft', contract_type: 'variable_hourly',
      customer_type: 'both', pricing_model: 'spot', energy_direction: 'production', terms_version: 'canonical',
      spot_markup_ore_per_kwh: 1, monthly_fee_sek: 0, invoice_fee_sek: 0, default_binding_months: 0, default_notice_months: 1,
      power_of_attorney_required: true, valid_from: availableFrom }, p_pricing_snapshot: pricing,
  })
  expect(created.error).toBeNull()
  expect(created.data, JSON.stringify(created.data)).toMatchObject({ ok: true, offer: { id: expect.any(String) } })
  const offerId = String((created.data as { offer: { id: string } }).offer.id)
  expect(offerId).toMatch(/^[0-9a-f-]{36}$/)
  expect(sql(`SELECT jsonb_build_object('direction',p.energy_direction,'productionLegal',
    'production_terms'=ANY(p.required_legal_modules)) FROM public.contract_offers o
    JOIN public.contract_product_versions p ON p.id=o.contract_product_version_id AND p.contract_product_id=o.contract_product_id
    WHERE o.id=${literal(offerId)} AND o.company_id=${literal(f.companyId)}`)).toEqual({ direction: 'production', productionLegal: true })
  const legalVersionId = sql<string>(`SELECT to_jsonb(public.gridex_materialize_legal_bundle_version(
    ${literal(f.companyId)},(SELECT contract_product_version_id FROM public.contract_offers
      WHERE id=${literal(offerId)} AND company_id=${literal(f.companyId)}),NULL,${literal(f.actorUserId)}))`)
  expect(legalVersionId).toMatch(/^[0-9a-f-]{36}$/)
  sql(`UPDATE public.contract_offers SET legal_bundle_version_id=${literal(legalVersionId)}
    WHERE id=${literal(offerId)} AND company_id=${literal(f.companyId)} AND lifecycle_status='draft'`)
  const published = await supabaseService.rpc('gridex_publish_internal_contract_version', {
    p_company_id: f.companyId, p_offer_id: offerId, p_actor_user_id: f.actorUserId,
  })
  expect(published.error).toBeNull()
  expect(published.data, JSON.stringify(published.data)).toMatchObject({ ok: true, mode: 'published' })
  // Ordinary selectable production price input. Only public publication owners
  // create immutable option snapshots and locked product/legal/publication rows.
  sql(`WITH template AS (
    INSERT INTO public.contract_price_options(company_id,contract_product_version_id,price_plan_version_id,
      option_reference,option_code,customer_name,contract_type,binding_months,notice_months,auto_renew_enabled,
      status,customer_type,is_default,selection_required,created_by)
    SELECT company_id,contract_product_version_id,price_plan_version_id,'production-default','production-default',
      'Synthetic production price','variable_hourly',0,1,false,'active','both',true,false,${literal(f.actorUserId)}
    FROM public.contract_offers WHERE id=${literal(offerId)} AND company_id=${literal(f.companyId)}
    RETURNING id,company_id,price_plan_version_id
  ) INSERT INTO public.contract_price_option_area_prices(company_id,contract_price_option_id,price_plan_version_id,
    price_row_reference,price_area,amount,unit,created_by)
    SELECT company_id,id,price_plan_version_id,'production-se3','SE3',1,'ore_per_kwh',${literal(f.actorUserId)} FROM template`)
  const channel = await supabaseService.rpc('gridex_publish_contract_channel', {
    p_company_id: f.companyId, p_offer_id: offerId, p_channel: 'internal', p_actor_user_id: f.actorUserId,
  })
  expect(channel.error).toBeNull()
  expect(channel.data, JSON.stringify(channel.data)).toMatchObject({ ok: true, channel: 'internal', contract_publication_version_id: expect.any(String) })
  const publicationVersionId = String((channel.data as { contract_publication_version_id: string }).contract_publication_version_id)
  expect(publicationVersionId).toMatch(/^[0-9a-f-]{36}$/)
  const bound = sql<Record<string, unknown>>(`SELECT jsonb_build_object('contract_offer_id',o.id,
    'contract_product_id',p.contract_product_id,'contract_product_version_id',v.contract_product_version_id,
    'contract_publication_version_id',v.id,'price_plan_id',v.price_plan_id,'price_plan_version_id',v.price_plan_version_id,
    'price_book_id',v.price_book_id,'legal_bundle_version_id',v.legal_bundle_version_id,'offer_reference',v.offer_reference,
    'commercial_snapshot',p.commercial_snapshot,'legal_snapshot',l.rendered_snapshot)
    FROM public.contract_offers o JOIN public.contract_product_versions p
      ON p.id=o.contract_product_version_id AND p.contract_product_id=o.contract_product_id
    JOIN public.contract_publication_versions v ON v.contract_product_version_id=p.id
      AND v.price_plan_version_id=o.price_plan_version_id AND v.legal_bundle_version_id=o.legal_bundle_version_id
    JOIN public.legal_bundle_versions l ON l.id=v.legal_bundle_version_id AND l.company_id=o.company_id
    JOIN public.contract_publications publication ON publication.id=v.contract_publication_id
    JOIN public.tenant_contract_assignments assignment ON assignment.id=publication.assignment_id
      AND assignment.company_id=o.company_id AND assignment.contract_product_version_id=p.id
    WHERE o.id=${literal(offerId)} AND o.company_id=${literal(f.companyId)} AND v.id=${literal(publicationVersionId)}
      AND o.lifecycle_status='published' AND o.is_active AND p.energy_direction='production' AND v.energy_direction='production'
      AND p.status='approved' AND p.locked_at IS NOT NULL AND v.status='published' AND v.locked_at IS NOT NULL
      AND l.status='published' AND l.locked_at IS NOT NULL AND cardinality(l.unresolved_variables)=0
      AND publication.channel='internal' AND publication.status='published' AND assignment.status='active' AND assignment.internal_sales_allowed`)
  expect(bound).toMatchObject({ contract_publication_version_id: expect.any(String), contract_product_version_id: expect.any(String), legal_bundle_version_id: expect.any(String) })
  // Only public canonical binding outputs are copied to this new draft. No
  // signature, approval, archive or protected original is manufactured.
  const contract = await supabaseService.from('customer_contracts').insert({ id: productionContractId, company_id: f.companyId, customer_id: f.customerId,
    site_id: productionSiteId, customer_site_id: productionSiteId, metering_point_id: productionPointId, status: 'draft', contract_version: 'v1',
    energy_direction: 'production', contract_type: 'variable_hourly', source_type: 'manual_override', contract_name: 'Synthetic separate production receipt contract',
    starts_at: f.requestedStartDate, requested_start_date: f.requestedStartDate, metadata: marker, created_by: f.actorUserId,
    contract_offer_id: bound.contract_offer_id, contract_product_id: bound.contract_product_id, contract_product_version_id: bound.contract_product_version_id,
    contract_publication_version_id: bound.contract_publication_version_id, price_plan_id: bound.price_plan_id, price_plan_version_id: bound.price_plan_version_id,
    price_book_id: bound.price_book_id, legal_bundle_version_id: bound.legal_bundle_version_id, offer_reference: bound.offer_reference,
    commercial_snapshot: bound.commercial_snapshot, legal_snapshot: bound.legal_snapshot })
  expect(contract.error).toBeNull()
  await signInvoiceTestContractCanonically({ companyId: f.companyId, customerId: f.customerId, contractId: productionContractId, actorUserId: f.actorUserId })
  const signed = sql<Record<string, unknown>>(`SELECT to_jsonb(c) FROM public.customer_contracts c WHERE id=${literal(productionContractId)} AND company_id=${literal(f.companyId)}`)
  expect(signed).toMatchObject({ status: 'signed', energy_direction: 'production', metering_point_id: productionPointId,
    commercial_snapshot: { production: { enabled: true, settlement_mode: 'credit_invoice', compensation_ore_per_kwh: 1 } } })
  const legalVersions = sql<AgreementPdfLegalVersion[]>(`SELECT jsonb_agg(jsonb_build_object('type',module_key,'title',title,'version',coalesce(template_version,left(content_sha256,12)),'id',id,'body',rendered_body)) FROM public.legal_bundle_version_documents WHERE legal_bundle_version_id=${literal(signed.legal_bundle_version_id)}`)
  // The published production body applies to activated production and inmatad
  // el generally. No fixture capacity threshold or micro-eligibility is added.
  expect(legalVersions.find(version => version.type === 'production_terms')?.body).toContain('köp av inmatad el')
  const attachment = buildAgreementPdfAttachment({ companyName: 'Synthetic Archive AB', customerName: 'Synthetic Own Customer', customerEmail: `synthetic-${f.customerId}@example.invalid`,
    customerNumber: f.customerId, contractNumber: String(signed.contract_number ?? productionContractId), contractName: 'Synthetic separate production receipt contract',
    contractType: 'variable_hourly', signedAt: String(signed.signed_at), startsAt: f.requestedStartDate, offerReference: String(signed.offer_reference),
    contractPublicationVersionId: String(signed.contract_publication_version_id), pricePlanVersionId: String(signed.price_plan_version_id),
    legalBundleVersionId: String(signed.legal_bundle_version_id), signatureSnapshotSha256: String(signed.signature_snapshot_sha256), legalVersions })
  const pdfBuffer = Buffer.from(attachment.content, 'base64'), documentSha256 = createHash('sha256').update(pdfBuffer).digest('hex')
  await archiveSignedCustomerContractPdf({ companyId: f.companyId, customerContractId: productionContractId, pdfBuffer, documentSha256,
    generationSnapshot: { schema: 'gridex_signed_contract_document_v1', contract_id: productionContractId, signature_snapshot_sha256: signed.signature_snapshot_sha256, synthetic: true } })
  const document = await supabaseService.from('customer_contracts').update({ document_sha256: documentSha256 }).eq('id', productionContractId).eq('company_id', f.companyId).is('document_sha256', null)
  expect(document.error).toBeNull()
  return { productionPointId, productionSiteId, productionContractId, productionExternal }
}

export async function createProductionReceiptNativeFixture(provider: Provider, options: { sameCompanyContrast?: boolean } = {}) {
  const f = await createConsumptionPrecondition(provider)
  const production = await createProductionContract(f)
  // Reuse the existing qualified contract-operation actor before the optional
  // second public onboarding; clean replay requires contracts.create there.
  const sameCompanyContrast = options.sameCompanyContrast ? await createAdditionalSameCompanyConsumption(f, provider) : null
  const reviewer = randomUUID(), agreement = randomUUID(), keyId = randomUUID(), representationId = randomUUID()
  const key = Buffer.from('SYNTHETIC D verifier boundary; no real legal authority')
  sql(`INSERT INTO auth.users(instance_id,confirmation_token,recovery_token,email_change_token_new,email_change,id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
    VALUES('00000000-0000-0000-0000-000000000000','','','','',${literal(reviewer)},'authenticated','authenticated',${literal(`${reviewer}@example.invalid`)},now(),'{}','{}',now(),now(),false,false);
    INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${literal(reviewer)},${literal(`${reviewer}@example.invalid`)},'Synthetic separate D reviewer','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
    INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key)
    VALUES(${literal(f.companyId)},${literal(reviewer)},'company_admin','active',now(),'{}','company_admin',true,now(),'company_admin');
    ${nativeActorRoleSql(f.companyId, reviewer)}
    INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key,effect,is_active,status)
    SELECT ${literal(reviewer)},${literal(f.companyId)},id,key,'allow',true,'active' FROM public.permissions WHERE key IN('communication.read','communication.write','contracts.read','metering.read','metering.write','ediel.regulated_supply.review');
    INSERT INTO public.tenant_bilateral_agreements(id,company_id,environment,counterparty_actor_id,capability_code,terms,is_enabled,valid_from,valid_to,source_reference)
    VALUES(${literal(agreement)},${literal(f.companyId)},'test',${literal(f.marketActorId)},'PRODAT:Z04:D','{"synthetic_fixture_only":true}',true,clock_timestamp()-interval '1 day','2100-01-01','SYNTHETIC D LEGAL ORIGINAL');`)
  const selector: RegulatedSupplySelector = { environment: 'test', kind: 'production_receipt_obligation', contractId: production.productionContractId,
    meteringPointId: production.productionPointId, identityAgency: '9', bilateralAgreementId: agreement,
    startAt: `${new Date(Date.parse(`${f.requestedStartDate}T00:00:00Z`) - 3600000).toISOString()}`, consumptionSupplyPeriodId: f.periodId }
  if (sameCompanyContrast) {
    for (const consumption of [f, sameCompanyContrast]) {
      const basis = sql(`SELECT gridex_received_sources.supply_period_source_basis_v1(${literal(f.companyId)},${literal(consumption.periodId)},${literal(selector.startAt)}::timestamptz,${literal(selector.startAt)}::timestamptz+interval '1 minute')`)
      expect(basis).toMatchObject({ qualified: true, companyId: f.companyId, periodId: consumption.periodId,
        customerId: consumption.customerId, meteringPointId: consumption.pointId, switchId: consumption.switchId,
        sourceMessageId: consumption.consumptionSourceId, originalMessageId: consumption.originalZ03.id, originalAcceptedAt: expect.any(String) })
    }
  }
  const owner = { companyId: f.companyId, actorUserId: f.actorUserId }, scoped = await readRegulatedSupplyGroundScope({ ...owner, ...selector })
  expect(scoped.status, JSON.stringify(scoped)).toBe('scoped')
  expect(scoped.scope).toMatchObject({ contractId: production.productionContractId, point: production.productionExternal, consumptionPoint: f.external,
    consumptionSupplyPeriodId: f.periodId, consumptionBasis: { qualified: true, customerId: f.customerId, meteringPointId: f.pointId,
      sourceMessageId: f.consumptionSourceId, originalMessageId: f.originalZ03.id, originalAcceptedAt: expect.any(String) } })
  // Sole private seed: explicitly declared external verifier configuration.
  // Archive, review, ground, origin, canonical and effect owners are never seeded.
  sql(`INSERT INTO gridex_regulated_supply.issuer_keys(id,company_id,environment,issuer_code,legal_issuer_reference,legal_authority_source_hash,receipt_signing_key,valid_from,valid_to)
    VALUES(${literal(keyId)},${literal(f.companyId)},'test','SYNTHETIC-D','DECLARED VERIFIER BOUNDARY; NOT LEGAL ACCEPTANCE',${literal('a'.repeat(64))},decode(${literal(key.toString('hex'))},'hex'),clock_timestamp()-interval '1 day','2100-01-01');
    INSERT INTO gridex_regulated_supply.issuer_representations(id,company_id,environment,issuer_key_id,legal_actor_id,dso_actor_id,grid_area_code,permitted_kind,bilateral_agreement_id,legal_representation_reference,legal_authority_source_hash,valid_from,valid_to)
    VALUES(${literal(representationId)},${literal(f.companyId)},'test',${literal(keyId)},${literal(f.actorUserId)},${literal(f.marketActorId)},${literal(f.gridAreaCode)},'production_receipt_obligation',${literal(agreement)},'SYNTHETIC D REPRESENTATION',${literal('b'.repeat(64))},clock_timestamp()-interval '1 day','2100-01-01');`)
  const bytes = Buffer.from('%PDF-1.7\nSYNTHETIC distinct production obligation; no real legal decision\n%%EOF')
  const sourceHash = createHash('sha256').update(bytes).digest('hex'), source = { bytesBase64: bytes.toString('base64'), mimeType: 'application/pdf' as const, reference: 'SYNTHETIC D LEGAL ORIGINAL', version: '1' }
  const payload = Buffer.from(JSON.stringify({ format: 'ediel_regulated_supply_ground_receipt_v1', issuerCode: 'SYNTHETIC-D', receiptId: randomUUID(),
    companyId: f.companyId, environment: 'test', scope: scoped.scope, sourceHash, sourceReference: source.reference, sourceVersion: source.version,
    legalDecisionReference: 'SYNTHETIC D DECLARED MECHANISM ONLY', issuedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: '2099-01-01T00:00:00Z' }))
  const submission: RegulatedSupplySubmission = { ...selector, source, issuerReceipt: { keyId, representationId, payloadBase64: payload.toString('base64'), signatureHex: createHmac('sha256', key).update(payload).digest('hex') } }
  const artifact = await archiveRegulatedSupplyGround({ ...owner, ...submission })
  expect(artifact.status).toBe('archived')
  const authorized = await reviewRegulatedSupplyGround({ companyId: f.companyId, actorUserId: reviewer, artifactId: String(artifact.artifactId),
    sourceHash: String(artifact.sourceHash), scopeHash: String(artifact.scopeHash), decision: 'approve', reason: 'Separate synthetic D native review' })
  expect(authorized.status, JSON.stringify(authorized)).toBe('authorized')
  const ackRoute = randomUUID(), ackProfile = randomUUID(), smtp = assertEdielSmtpReadiness()
  sql(`INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,grid_owner_id,environment_type,is_active,target_email)
    VALUES(${literal(ackRoute)},${literal(f.companyId)},'Synthetic D ACK route','ediel_ack',${literal(f.gridId)},'bilateral_test',true,'recipient@example.invalid');
    INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,payload_format,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,is_active,transport_security_mode,mailbox,smtp_host,smtp_port,smtp_to,receiver_email)
    VALUES(${literal(ackProfile)},${literal(f.companyId)},${literal(ackRoute)},'Synthetic D ACK profile','test','edifact','edifact',${literal(f.sender)},${literal(f.receiver)},'23-DDQ-PRODAT',true,true,'unencrypted',${literal(smtp.from)},${literal(smtp.host)},${smtp.port},'recipient@example.invalid','recipient@example.invalid');`)
  return { ...f, ...production, selector, scoped, authorized, reviewer, ackRoute, ackProfile, sameCompanyContrast }
}

export function productionReceiptWire(f: Awaited<ReturnType<typeof createProductionReceiptNativeFixture>>, reference: string,
  options: { omitConsumptionReference?: boolean; consumptionPoint?: string; omitConstant?: boolean; omitNumberOfDigits?: boolean; omitMeasurementMethod?: boolean; omitReadingDeclaration?: boolean } = {}) {
  const start = f.requestedStartDate.replaceAll('-', '') + '0000'
  const body: Parts[] = [
    ['NAD', 'FR', [f.receiver, '160', 'SVK'], '', '', '', '', '', '', 'SE'], ['NAD', 'DO', [f.sender, '160', 'SVK'], '', '', '', '', '', '', 'SE'],
    line('1', f.productionExternal, undefined, '9'), ['DTM', ['92', start, '203']], ['DTM', ['354', '15', '806']], qty('1000'),
    // Original P p69: quarter-hour solar production with daily settlement.
    // Solar identifies the product; no microproduction capacity is assumed.
    ...characteristic('Z13', 'Z70'),
    ...(options.omitMeasurementMethod ? [] : characteristic('Z04', 'Z04')), ...characteristic('Z07', 'Z12'), ...characteristic('Z12', 'D', 3),
    ...characteristic('Z15', 'Z32'), ['CCI', '', 'Z14'], ['CAV', ['', '', '', 'L641Q']],
    // Real source-local reading declaration, not a parsed dependency flag or
    // evidence that downstream UTILTS production readings have already arrived.
    ...(options.omitConstant ? [] : characteristic('Z02', '1', 3)),
    ...(options.omitNumberOfDigits ? [] : characteristic('Z05', '6', 3)),
    ...(options.omitReadingDeclaration ? [] : characteristic('Z16', '111', 3)),
    ['RFF', ['MG', `METER-${f.productionExternal}`]], ['RFF', ['Z05', f.gridAreaCode]], ['RFF', ['LI', reference]],
    ...(options.omitConsumptionReference ? [] : [['RFF', ['Z07', options.consumptionPoint ?? f.external]] as Parts]),
    ['NAD', 'UD', [f.customerIdentity.id, f.customerIdentity.qualifier, f.customerIdentity.agency], '', 'Synthetic Own Customer', 'Street', 'City', '', '12345', 'SE'],
    ['NAD', 'IT', [f.productionExternal, '', '9'], '', '', 'Street', 'Town', '', '12345', 'SE'], ['NAD', 'Z02', [f.brpEdielId, '160', 'SVK']],
  ]
  return stampOriginal(guideOrderedFixtureRaw(body, 'Z04'), f.receiver, f.sender, reference)
}
