// Disposable D input producer. Existing L readings=false remains an explicitly
// declared synthetic PRECONDITION, never authenticated receiver-reading proof.
// New D source intake has no added dependency flags or private ready receipts.
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { expect } from 'vitest'
import { ownerSource } from '../../__tests__/helpers/sourceOwnerFixtures'
import { guideOrderedFixtureRaw } from '../../__tests__/helpers/prodatGuideOrderedFixture'
import { characteristic, line, qty, type Parts } from '../../__tests__/fixtures/prodat-register'
import { seedNormalSwitchNativeFixture, futureNativeSupplyDate, nativeSql as sql, literal, nativeActorRoleSql } from './ediel-normal-switch-native-fixture'
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

/** All public source/validation/application owners run. Only the pre-existing
 * ownerSource parsed-payload control supplies its declared local readings fact.
 * No private context, validation, source witness or period is inserted. */
export async function createConsumptionPrecondition(provider: Provider) {
  const f = await seedNormalSwitchNativeFixture({ requestedStartDate: futureNativeSupplyDate(), external: freshGsrn(), provider })
  const retained = ownerSource(), sourceId = randomUUID(), document = `L${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`
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
  const original = data as EdielMessageRow, decision = await resolveCanonicalRuntimeDecisionWithRegistry(original)
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

async function createProductionContract(f: Awaited<ReturnType<typeof createConsumptionPrecondition>>) {
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
  const binding = await supabaseService.rpc('gridex_prepare_manual_contract_binding', { p_company_id: f.companyId, p_actor_user_id: f.actorUserId,
    p_payload: { name: 'Synthetic separate production receipt contract', contract_type: 'variable_hourly', customer_type: 'both', pricing_model: 'spot', energy_direction: 'production',
      terms_version: 'canonical', default_binding_months: 0, default_notice_months: 1, valid_from: f.requestedStartDate }, p_pricing_snapshot: pricing })
  expect(binding.error).toBeNull()
  const bound = binding.data as Record<string, unknown>
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

export async function createProductionReceiptNativeFixture(provider: Provider) {
  const f = await createConsumptionPrecondition(provider), production = await createProductionContract(f)
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
  return { ...f, ...production, selector, scoped, authorized, ackRoute, ackProfile }
}

export function productionReceiptWire(f: Awaited<ReturnType<typeof createProductionReceiptNativeFixture>>, reference: string,
  options: { omitConsumptionReference?: boolean; consumptionPoint?: string } = {}) {
  const start = f.requestedStartDate.replaceAll('-', '') + '0000'
  const body: Parts[] = [
    ['NAD', 'FR', [f.receiver, '160', 'SVK'], '', '', '', '', '', '', 'SE'], ['NAD', 'DO', [f.sender, '160', 'SVK'], '', '', '', '', '', '', 'SE'],
    line('1', f.productionExternal, undefined, '9'), ['DTM', ['92', start, '203']], ['DTM', ['354', '15', '806']], qty('1000'),
    // Original P p69: quarter-hour solar production with daily settlement.
    // Solar identifies the product; no microproduction capacity is assumed.
    ...characteristic('Z13', 'Z70'), ...characteristic('Z04', 'Z04'), ...characteristic('Z07', 'Z12'), ...characteristic('Z12', 'D', 3),
    ...characteristic('Z15', 'Z32'), ['CCI', '', 'Z14'], ['CAV', ['', '', '', 'L641Q']],
    ['RFF', ['MG', `METER-${f.productionExternal}`]], ['RFF', ['Z05', f.gridAreaCode]], ['RFF', ['LI', reference]],
    ...(options.omitConsumptionReference ? [] : [['RFF', ['Z07', options.consumptionPoint ?? f.external]] as Parts]),
    ['NAD', 'UD', [f.customerIdentity.id, f.customerIdentity.qualifier, f.customerIdentity.agency], '', 'Synthetic Own Customer', 'Street', 'City', '', '12345', 'SE'],
    ['NAD', 'IT', [f.productionExternal, '', '9'], '', '', 'Street', 'Town', '', '12345', 'SE'], ['NAD', 'Z02', [f.brpEdielId, '160', 'SVK']],
  ]
  return stampOriginal(guideOrderedFixtureRaw(body, 'Z04'), f.receiver, f.sender, reference)
}
