// SITE01 fixture: ONE synthetic tenant, ONE customer, TWO separate sites.
// Billing month 2026-09 (see SITE01_BILLING_MONTH in site01Synthetic.ts for why not February 2027).
//   site A: SE3, grid owner/area A (TES), contract start 2026-09-01, the native seed's offer (4 ore/kWh, 49 SEK/month),
//           delivery active the whole of September 2026.
//   site B: SE4, its own grid owner and area (TEB), its own offer (9 ore/kWh, 79 SEK/month), contract start 2026-09-16
//           (mid month) and a delivery that ENDS 2026-09-25. UTILTS files are delivered for B up to 2026-09-30 on purpose:
//           the days after the end must not be billed.
// One fixture covers SITE01.01-04 (and the data for 05); no second variant is needed. Documented deviation: the base
// seed fixes site A's price terms, so "X ore / F1" are 4 ore / 49 SEK.
//
// ORIGIN (base 1c0c088cb4ed66d0dd8b3e34c9606019342a1a56), adapted and parameterised for a second site in an existing company:
//  - scripts/helpers/ediel-normal-switch-native-fixture.ts `seedNormalSwitchNativeFixture` (per-site parts: grid owner, routes,
//    offer, legal bundle, publication, price option, site, metering point, contract, signature, PDF archive, network registry,
//    BRP ground/declaration, masterdata and method declarations, POA, switch request, Z03 send)
//  - scripts/helpers/ediel-z05-independent-end-native-fixture.ts (the "second target in an existing company" ordering)
//  - fixtures/main03Fixture.ts (activateNormalSwitchSupply, spot import, UTILTS day ingestion) -- copied here, not imported,
//    because those functions are not exported and main03Fixture.ts must stay untouched.
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { vi } from 'vitest'
import { guideOrderedFixtureRaw } from '@/__tests__/helpers/prodatGuideOrderedFixture'
import { head } from '@/__tests__/fixtures/prodat-identity'
import { line, characteristic, type Parts } from '@/__tests__/fixtures/prodat-register'
import nodemailer from 'nodemailer'
import { seedNormalSwitchNativeFixture, nativeSql as sql, literal } from '@/scripts/helpers/ediel-normal-switch-native-fixture'
import { buildCancellationProspectiveZ04 } from '@/scripts/helpers/ediel-cancellation-prospective-source-2ea'
import { seedOriginalMailboxNative } from '@/scripts/helpers/originalMailboxNative'
import { registerUtiltsIssuer, seedUtiltsIssuerHistoryGround, recordUtiltsFinalRuntime, recordUtiltsTechnicalReception, setUtiltsReceiverRole } from '@/scripts/helpers/utiltsConsumptionParties'
import { attachNetworkRegistrySourceFixture } from '@/scripts/helpers/ediel-network-registry-native-fixture'
import { createBilateralSourceOperator } from '@/scripts/helpers/ediel-bilateral-customer-native-fixture'
import { signInvoiceTestContractCanonically } from '@/lib/ediel/testing/invoiceTestContractLifecycle'
import { archiveSignedCustomerContractPdf } from '@/lib/customer-contracts/documents'
import { buildAgreementPdfAttachment } from '@/lib/customer-contracts/agreementPdf'
import { savePowerOfAttorney } from '@/lib/operations/db'
import { ensureAuthorizationDocumentFromPowerOfAttorney } from '@/lib/legal/authorizationChain'
import { powerOfAttorneyCoverageFromScopes } from '@/lib/operations/powerOfAttorneyWorkflow'
import { prepareAndQueueEdielZ03 } from '@/lib/ediel/flows/prodatSwitch'
import { sendEdielMessageViaSmtp } from '@/lib/ediel/transport'
import { archiveNetworkRegistrySource, reviewNetworkRegistrySource } from '@/lib/ediel/production/networkRegistrySource'
import { tokenizeEdifact, segmentComposite } from '@/lib/ediel/core/edifactTokenizer'
import { assertEdielSmtpReadiness } from '@/lib/ediel/mailReadiness'
import { processInboundEdielMessage } from '@/lib/ediel/flows/inboundProcessing'
import { advanceSupplyMarketDeadlines } from '@/lib/ediel/flows/supplyMarketTransition'
import { createInboundEdielMessage } from '@/lib/inbound-mail/inboundStatusUpdater'
import { matchOutboundRequestForInbound, matchMeteringPointForInbound } from '@/lib/inbound-mail/inboundMatcher'
import { getEdielMessageById } from '@/lib/ediel/db'
import { resolveCanonicalRuntimeDecisionWithRegistry } from '@/lib/ediel/core/runtimeDecision'
import { resolveCanonicalMessagePolicy } from '@/lib/ediel/core/messagePolicy'
import { prepareUtiltsConsumptionContracts } from '@/lib/ediel/utilts/consumptionPreparation'
import { buildUtiltsTransactionPersistencePayload, persistUtiltsTransactionResults, type UtiltsBoundPersistenceInput } from '@/lib/ediel/utilts/transactionPersistence'
import { ingestBoundUtiltsMetering } from '@/lib/ediel/utilts/consumptionSinks'
import { importSpotPricesForMonth } from '@/lib/pricing/spot/spotPriceImporter'
import { supabaseService } from '@/lib/supabase/service'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { GridOwnerDataRequestRow } from '@/lib/cis/types'
import { buildDayWire } from './wire'
import { substitute } from './substitutions'
import { dbRead, http, lit, signIn, timed, type Session } from './runtime'
import { QUARTERS_PER_DAY, spotDayPayload, syntheticMonth } from './synthetic'
import { SITE_A, SITE_B, SITE01_BILLING_MONTH, chooseSiteOracle, siteEndPlan, type SiteKey, type SiteOracle, type SiteSpec } from './site01Synthetic'

function must(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }

type Ground = Awaited<ReturnType<typeof seedNormalSwitchNativeFixture>>

const SYNTHETIC_SMTP_ENV: Record<string, string> = {
  EDIEL_SHARED_MAILBOX_ADDRESS: 'synthetic@example.invalid', EDIEL_APP_DKIM_ENABLED: 'false', EMAIL_PROVIDER: 'resend', EDIEL_EMAIL_PROVIDER: 'strato',
  EDIEL_SMTP_FROM: 'synthetic@example.invalid', EDIEL_SMTP_USER: 'synthetic@example.invalid', EDIEL_SMTP_PASS: 'synthetic-only',
}

/** Accepting SMTP transport for the outbound Z03 (same port the base's native tests inject). */
function syntheticSmtpProvider(email: string): void {
  vi.spyOn(nodemailer, 'createTransport').mockImplementation((() => ({
    sendMail: async () => ({ accepted: [email], rejected: [], messageId: `<synthetic-${randomUUID()}@example.invalid>`, response: '250 synthetic accepted (track 1 fixture)' }),
  })) as unknown as typeof nodemailer.createTransport)
}

function freshGsrn(): string {
  const first17 = `735123456789${String(Math.floor(Math.random() * 100000)).padStart(5, '0')}`
  const weighted = [...first17].reduce((sum, digit, index) => sum + Number(digit) * (index % 2 === 0 ? 3 : 1), 0)
  return `${first17}${(10 - weighted % 10) % 10}`
}

export type SiteRuntime = {
  key: SiteKey
  spec: SiteSpec
  oracle: SiteOracle
  siteId: string
  pointId: string
  contractId: string
  gridOwnerId: string
  external: string
  /** The synthetic grid owner's EDIEL id (UTILTS issuer / PRODAT sender). */
  gridOwnerEdielId: string
  supplyPeriodId: string
  dataRequestId: string
  switchId: string
}

export type DayRecord = { site: SiteKey; day: number; sourceId: string; transactionRef: string; rawSha256: string; meteringValueIds: string[]; ms: number }

export type Site01Fixture = {
  companyId: string
  actorUserId: string
  customerId: string
  ownEdielId: string
  session: Session
  sites: Record<SiteKey, SiteRuntime>
  days: DayRecord[]
  spotLocks: Record<string, Record<string, unknown>>
  supplyEnd: { sourceId: string; rawSha256: string; periodId: string; effectiveAtUtc: string; endWireMinute: string }
}


/** Existing normal L relationship, ordinary independent Z05L. No national H
 * cohort/mandate and no direct period/contract write is manufactured here. */
export async function endExistingSiteSupply(a: Ground, b: Ground, supply: { supplyPeriodId: string; sourceId: string }, oracle: SiteOracle) {
  const plan = siteEndPlan(SITE_B, oracle)
  must(a.companyId === b.companyId && a.customerId === b.customerId && a.siteId !== b.siteId && a.pointId !== b.pointId, 'site01_end_two_site_scope_required')
  const preserveA = () => sql(`SELECT jsonb_build_object(
    'site',(SELECT to_jsonb(s) FROM public.customer_sites s WHERE id=${literal(a.siteId)} AND company_id=${literal(a.companyId)}),
    'point',(SELECT to_jsonb(p) FROM public.metering_points p WHERE id=${literal(a.pointId)} AND company_id=${literal(a.companyId)}),
    'contract',(SELECT to_jsonb(c) FROM public.customer_contracts c WHERE id=${literal(a.contractId)} AND company_id=${literal(a.companyId)}),
    'periods',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.customer_supply_periods p WHERE metering_point_id=${literal(a.pointId)} AND company_id=${literal(a.companyId)}))`)
  type EndState = { period: { id: string; customer_id: string; metering_point_id: string; source_message_id: string; contract_id: string | null; customer_contract_id: string | null; source_end_message_id: string | null; market_state_version: number; end_date: string | null; market_end_at: string | null; status: string }; contract: { status: string }; effects: number; followups: number; terminations: number; finalTasks: number; acknowledgements: Array<{ family: string; outcome: string }> }
  const readEnd = (sourceId: string | null): EndState => {
    const source = sourceId ? literal(sourceId) : 'NULL'
    return sql<EndState>(`SELECT jsonb_build_object(
      'period',(SELECT to_jsonb(p) FROM public.customer_supply_periods p WHERE id=${literal(supply.supplyPeriodId)} AND company_id=${literal(b.companyId)}),
      'contract',(SELECT to_jsonb(c) FROM public.customer_contracts c WHERE id=${literal(b.contractId)} AND company_id=${literal(b.companyId)}),
      'effects',(SELECT count(*) FROM gridex_received_sources.supply_object_effect_receipts WHERE source_message_id=${source} AND company_id=${literal(b.companyId)}),
      'followups',(SELECT count(*) FROM gridex_received_sources.supply_end_followups WHERE source_message_id=${source} AND company_id=${literal(b.companyId)}),
      'terminations',(SELECT count(*) FROM public.customer_contract_events WHERE customer_contract_id=${literal(b.contractId)} AND company_id=${literal(b.companyId)} AND event_type='terminated'),
      'finalTasks',(SELECT count(*) FROM public.customer_operation_tasks WHERE customer_id=${literal(b.customerId)} AND company_id=${literal(b.companyId)} AND metering_point_id=${literal(b.pointId)} AND task_type='final_invoice_pending'),
      'acknowledgements',(SELECT coalesce(jsonb_agg(jsonb_build_object('family',message_family,'outcome',ack_outcome) ORDER BY message_family),'[]'::jsonb) FROM public.ediel_messages WHERE related_message_id=${source} AND company_id=${literal(b.companyId)} AND direction='outbound' AND message_family IN('APERAK','CONTRL')))`)
  }
  const aBefore = JSON.stringify(preserveA()), before = readEnd(null)
  must(before.period && before.period.id === supply.supplyPeriodId && before.period.customer_id === b.customerId
    && before.period.metering_point_id === b.pointId && before.period.source_message_id === supply.sourceId
    && (before.period.customer_contract_id ?? before.period.contract_id) === b.contractId
    && before.period.source_end_message_id === null, 'site01_end_original_relationship_required')
  const parts: Parts[] = [
    ...head().map(part => part[0] === 'NAD' && part[1] === 'FR' ? ['NAD', 'FR', [b.receiver, '160', 'SVK'], '', '', '', '', '', '', 'SE'] as Parts
      : part[0] === 'NAD' && part[1] === 'DO' ? ['NAD', 'DO', [b.sender, '160', 'SVK'], '', '', '', '', '', '', 'SE'] as Parts : part),
    line('1', b.external, undefined, '9'), ['DTM', ['93', plan.endWireMinute, '203']],
    ...characteristic('Z13', 'Z22'), ['RFF', ['LI', `SITE-END-${randomUUID().replaceAll('-', '').slice(0, 16)}`]],
    ['RFF', ['Z05', b.gridAreaCode]],
    ['NAD', 'UD', [b.customerIdentity.id, b.customerIdentity.qualifier, b.customerIdentity.agency], '', 'Synthetic', 'Street', 'City', '', '12345', 'SE'],
    ['NAD', 'IT', [b.external, '', '9'], '', '', 'Street', 'Town', '', '12345', 'SE'],
    ['NAD', 'Z02', [b.brpEdielId, '160', 'SVK']],
  ]
  const wire = guideOrderedFixtureRaw(parts, 'Z05').replace('+S+R+', `+${b.receiver}:14+${b.sender}:14+`)
    .replace("++23-DDQ-PRODAT'", "++23-DDQ-PRODAT++1++1'")
    .replace(/\+I(\+\+23-DDQ-PRODAT\+\+1\+\+1')([\s\S]*UNZ\+1\+)I'/, (_, unb: string, mid: string) => {
      const id = `I${randomUUID().replaceAll('-', '').slice(0, 12)}`; return `+${id}${unb}${mid}${id}'`
    })
  substitute({ id: 'ordinary-supply-end-source', step: 'fixture: site B ordinary Z05L',
    substitute: 'synthetic grid-owner Z05L original placed in retained mailbox, public source birth and real inbound processing for the existing B relationship',
    notVerified: 'real grid-owner transport, IMAP fetch, S/MIME and outbound ACK transport; no national H or legal acceptance is claimed' })
  const smtp = assertEdielSmtpReadiness()
  const mail = await seedOriginalMailboxNative(sql, literal, { companyId: b.companyId, environment: 'test', raw: wire, receivedAt: new Date().toISOString(), smtpFrom: smtp.from })
  const outboundMatch = await matchOutboundRequestForInbound({ companyId: b.companyId, parsed: mail.parsed, inboundEmailMessageId: mail.inboundEmailMessageId, parseResultId: mail.parseResultId })
  const meteringPointMatch = await matchMeteringPointForInbound({ companyId: b.companyId, parsed: mail.parsed })
  const sourceId = await createInboundEdielMessage({ companyId: b.companyId, actorUserId: b.actorUserId, environment: 'test',
    inboundEmailMessageId: mail.inboundEmailMessageId, parseResultId: mail.parseResultId, parsed: mail.parsed, outboundMatch, meteringPointMatch })
  must(sourceId, 'site01_z05_public_birth_refused')
  const message = await getEdielMessageById(sourceId)
  must(message && message.company_id === b.companyId && message.message_code === 'Z05'
    && message.rule_profile_key === 'PRODAT:Z05:L:26.A:r3', 'site01_z05_source_unexpected')
  const decision = await resolveCanonicalRuntimeDecisionWithRegistry(message, { actorUserId: b.actorUserId })
  must([decision.syntaxDecision, decision.applicationDecision, decision.functionalDecision].every(value => value === 'accepted'),
    `site01_z05_not_accepted:${JSON.stringify(decision.issues)}`)
  await processInboundEdielMessage({ actorUserId: b.actorUserId, edielMessageId: sourceId })
  const after = readEnd(sourceId)
  must(after.period.status === 'ended' && after.period.source_end_message_id === sourceId && after.period.end_date === plan.endDate
    && Date.parse(String(after.period.market_end_at)) === Date.parse(plan.effectiveAtUtc)
    && Number(after.period.market_state_version) === Number(before.period.market_state_version) + 1
    && after.period.source_message_id === supply.sourceId && after.period.customer_id === b.customerId
    && after.period.metering_point_id === b.pointId
    && (after.period.customer_contract_id ?? after.period.contract_id) === b.contractId, 'site01_z05_end_effect_mismatch')
  must(after.effects === 1 && after.followups === 1 && after.contract.status === 'terminated'
    && after.terminations === before.terminations + 1 && after.finalTasks === before.finalTasks + 1, 'site01_z05_followup_mismatch')
  must(JSON.stringify(after.acknowledgements) === JSON.stringify([{ family: 'APERAK', outcome: 'positive' }, { family: 'CONTRL', outcome: 'positive' }]), 'site01_z05_ack_mismatch')
  must(JSON.stringify(preserveA()) === aBefore, 'site01_z05_changed_site_a')
  // Reprocess only this known terminal source. No retry is inferred after an
  // unknown client outcome; all previous effects have been read and qualified.
  await processInboundEdielMessage({ actorUserId: b.actorUserId, edielMessageId: sourceId })
  must(JSON.stringify(readEnd(sourceId)) === JSON.stringify(after), 'site01_z05_repeat_changed_business_graph')
  must(JSON.stringify(preserveA()) === aBefore, 'site01_z05_repeat_changed_site_a')
  return { sourceId, rawSha256: createHash('sha256').update(wire).digest('hex'), periodId: supply.supplyPeriodId,
    effectiveAtUtc: plan.effectiveAtUtc, endWireMinute: plan.endWireMinute }
}

// ---------------------------------------------------- second site, same company

type Stage = Ground & { siteSpec: SiteSpec }

/**
 * Seeds site B inside the company/customer that `seedNormalSwitchNativeFixture` created for site A, following the same owners
 * (offer, publication, signature, archive, registries, declarations, POA, switch request, sent Z03). Differences from the
 * seed: no company/customer/readiness rows, its own grid owner + market actor + routes, its own offer/price option for
 * the spec's price area, markup and fee, a site address, a distinct grid area.
 */
async function seedSecondSite(a: Ground, spec: SiteSpec): Promise<Stage> {
  const { companyId, actorUserId, customerId, sender, brpEdielId } = a
  const customerName = 'Synthetic Own Customer', customerIdentity = a.customerIdentity.id
  const siteId = randomUUID(), pointId = randomUUID(), contractId = randomUUID(), gridId = randomUUID(), switchId = randomUUID()
  const routeId = randomUUID(), routeProfileId = randomUUID(), marketActor = randomUUID()
  const external = freshGsrn(), requestedStartDate = spec.startDate
  const marker = { test_center: { kind: 'invoice_test_customer' } }

  // New grid owner (DSO) with its own EDIEL id, market actor, routes and readiness rows, as in the seed.
  const receiver = sql<string>(`BEGIN;SELECT pg_advisory_xact_lock(hashtextextended('native_outbound_dispatch_actor_identifier',0));WITH actor AS (INSERT INTO public.platform_market_actors(id,name,status,match_status,visible_to_tenants) VALUES(${literal(marketActor)},${literal(`Synthetic site01 grid ${marketActor}`)},'active','verified',true) RETURNING id),available AS (SELECT candidate::text value FROM generate_series(60000,89999) candidate WHERE NOT EXISTS(SELECT FROM public.platform_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value=candidate::text) ORDER BY candidate LIMIT 1),allocated AS (INSERT INTO public.platform_actor_identifiers(actor_id,identifier_type,identifier_value,is_verified) SELECT actor.id,'EdielId',available.value,true FROM actor CROSS JOIN available RETURNING identifier_value) SELECT to_jsonb(identifier_value) FROM allocated;COMMIT;`)
  sql(`INSERT INTO public.grid_owners(id,company_id,name,ediel_id,environment,is_active,lifecycle_status,owner_code) VALUES(${literal(gridId)},${literal(companyId)},${literal(spec.gridOwnerName)},${literal(receiver)},'test',true,'active',${literal(spec.gridAreaCode)});
 INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,grid_owner_id,environment_type,is_active,target_email) VALUES(${literal(routeId)},${literal(companyId)},'Synthetic site01 route B','supplier_switch',${literal(gridId)},'bilateral_test',true,'recipient@example.invalid');
 INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,transport_security_mode,smtp_to,receiver_email,message_family,business_code) VALUES(${literal(routeProfileId)},${literal(companyId)},${literal(routeId)},'Synthetic site01 profile B','test','edifact',${literal(sender)},${literal(receiver)},'23-DDQ-PRODAT',true,'unencrypted','recipient@example.invalid','recipient@example.invalid','PRODAT','Z03');
 INSERT INTO public.platform_actor_roles(actor_id,actor_role,is_active) VALUES(${literal(marketActor)},'grid_owner',true);
 INSERT INTO public.platform_actor_routes(actor_id,message_family,environment,status,is_verified,application_reference,communication_type,communication_address,metadata) VALUES(${literal(marketActor)},'PRODAT','production','active',true,'23-DDQ-PRODAT','email','recipient@example.invalid','{"subaddress_status":"not_required_confirmed"}');
 INSERT INTO public.platform_actor_certificates(actor_id,environment,purpose,status,fingerprint_sha256,ediel_id,valid_to,raw_certificate_pem) VALUES(${literal(marketActor)},'production','encryption','valid','synthetic',${literal(receiver)},'2099-01-01','synthetic-readiness-only');`)

  // Offer for this site: own price area, markup and monthly fee.
  const pricing = { schema: 'gridex_contract_pricing_v5', pricing_model: 'spot', energy_direction: 'consumption', interval_resolution: 'hourly', vat_rate: 0.25,
    price_areas: [spec.priceArea], base_components: [{ source_type: 'spot', label: 'Spotpris', weight_percent: 100, price_area: spec.priceArea }],
    price_components: [{ component_code: 'spot_markup', component_type: 'markup', name: 'Påslag', calculation_type: 'per_kwh', amount: spec.markupOrePerKwh, unit: 'ore_per_kwh', website_card_visible: true },
      { component_code: 'monthly_fee', component_type: 'fee', name: 'Månadsavgift', calculation_type: 'fixed_monthly', amount: spec.monthlyFeeSek, unit: 'sek_month', website_card_visible: true }] }
  const offer = { name: `Synthetic site01 ${spec.key} ${contractId}`, slug: `synthetic-site01-${spec.key.toLowerCase()}-${contractId}`,
    lifecycle_status: 'draft', contract_type: 'variable_hourly', customer_type: 'both', pricing_model: 'spot', energy_direction: 'consumption',
    terms_version: 'test-v1', spot_markup_ore_per_kwh: spec.markupOrePerKwh, monthly_fee_sek: spec.monthlyFeeSek, invoice_fee_sek: 19, default_binding_months: 0,
    default_notice_months: 1, automatic_renewal: true, automatic_renewal_term_months: 12, power_of_attorney_required: true, valid_from: '2026-09-24' }
  const created = await supabaseService.rpc('gridex_upsert_internal_contract_offer_v2', { p_company_id: companyId, p_offer_id: null, p_payload: offer, p_pricing_snapshot: pricing, p_actor_user_id: actorUserId })
  must(!created.error, `site01_offer_failed:${created.error?.message}`)
  const canonical = created.data as { ok?: boolean; offer?: { id?: string } } | null
  must(canonical?.ok === true && canonical.offer?.id, `site01_offer_not_ok:${JSON.stringify(canonical)}`)
  const offerId = canonical.offer.id
  const legalVersionId = sql<string>(`SELECT to_jsonb(public.gridex_materialize_legal_bundle_version(
  ${literal(companyId)},(SELECT contract_product_version_id FROM public.contract_offers WHERE id=${literal(offerId)}),
  NULL,${literal(actorUserId)}))`)
  must(/^[0-9a-f-]{36}$/.test(legalVersionId), 'site01_legal_bundle_missing')
  sql(`UPDATE public.contract_offers SET legal_bundle_version_id=${literal(legalVersionId)} WHERE id=${literal(offerId)};`)
  const published = await supabaseService.rpc('gridex_publish_internal_contract_version', { p_company_id: companyId, p_offer_id: offerId, p_actor_user_id: actorUserId })
  must(!published.error && (published.data as { ok?: boolean } | null)?.ok === true, `site01_publish_failed:${published.error?.message ?? JSON.stringify(published.data)}`)
  const optionRef = `site01-${spec.key.toLowerCase()}-${spec.priceArea.toLowerCase()}`
  sql(`WITH template AS (
  INSERT INTO public.contract_price_options(company_id,contract_product_version_id,
   price_plan_version_id,option_reference,option_code,customer_name,contract_type,
   binding_months,notice_months,auto_renew_enabled,renewal_term_months,status,
   customer_type,is_default,selection_required,created_by)
  SELECT ${literal(companyId)},contract_product_version_id,price_plan_version_id,
   ${literal(optionRef)},${literal(optionRef)},'Synthetic hourly price ${spec.key}','variable_hourly',
   0,1,true,12,'active','both',true,false,${literal(actorUserId)}
  FROM public.contract_offers WHERE id=${literal(offerId)}
  RETURNING id,company_id,price_plan_version_id
 ) INSERT INTO public.contract_price_option_area_prices(company_id,contract_price_option_id,
  price_plan_version_id,price_row_reference,price_area,amount,unit,created_by)
 SELECT company_id,id,price_plan_version_id,${literal(optionRef + '-area')},${literal(spec.priceArea)},${spec.markupOrePerKwh},'ore_per_kwh',
  ${literal(actorUserId)} FROM template;`)
  const channel = await supabaseService.rpc('gridex_publish_contract_channel', { p_company_id: companyId, p_offer_id: offerId, p_channel: 'internal', p_actor_user_id: actorUserId })
  must(!channel.error && (channel.data as { ok?: boolean } | null)?.ok === true, `site01_channel_failed:${channel.error?.message ?? JSON.stringify(channel.data)}`)
  const publicationVersionId = (channel.data as { contract_publication_version_id?: string }).contract_publication_version_id
  must(publicationVersionId, 'site01_publication_version_missing')

  // Site, metering point (own grid area/price area/owner) and draft contract for the EXISTING customer.
  sql(`INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,facility_id,grid_owner_id,grid_area_code,price_area_code,status,is_test_data,metadata,street,postal_code,city)
  VALUES(${literal(siteId)},${literal(companyId)},${literal(customerId)},${literal(`Site01 ${spec.key}`)},${literal(external)},${literal(gridId)},${literal(spec.gridAreaCode)},${literal(spec.priceArea)},'active',true,${literal(marker)}::jsonb,${literal(spec.address.street)},${literal(spec.address.postalCode)},${literal(spec.address.city)});
  INSERT INTO public.metering_points(id,company_id,customer_id,site_id,customer_site_id,meter_point_id,metering_point_id,ediel_metering_point_id,grid_owner_id,grid_owner_ediel_id,grid_area_code,price_area_code,status,reading_frequency,measurement_type,product_direction,is_settlement_relevant,is_test_data,metadata)
  VALUES(${literal(pointId)},${literal(companyId)},${literal(customerId)},${literal(siteId)},${literal(siteId)},${literal(external)},${literal(external)},${literal(external)},${literal(gridId)},${literal(receiver)},${literal(spec.gridAreaCode)},${literal(spec.priceArea)},'active','hourly','consumption','consumption',true,true,${literal(marker)}::jsonb);
  INSERT INTO public.customer_contracts(id,company_id,customer_id,site_id,metering_point_id,
   contract_offer_id,status,contract_version,requested_start_date,starts_at,metadata,created_by,contract_publication_version_id,
   contract_product_id,contract_product_version_id,price_plan_id,price_plan_version_id,
   price_book_id,legal_bundle_version_id,offer_reference,commercial_snapshot,legal_snapshot)
  SELECT ${literal(contractId)},${literal(companyId)},${literal(customerId)},${literal(siteId)},
   ${literal(pointId)},${literal(offerId)},'draft','v1',${literal(requestedStartDate)}::date,${literal(requestedStartDate)}::date,${literal(marker)}::jsonb,
   ${literal(actorUserId)},v.id,p.contract_product_id,v.contract_product_version_id,
   v.price_plan_id,v.price_plan_version_id,v.price_book_id,v.legal_bundle_version_id,
   v.offer_reference,p.commercial_snapshot,l.rendered_snapshot
  FROM public.contract_publication_versions v
  JOIN public.contract_product_versions p ON p.id=v.contract_product_version_id
  JOIN public.legal_bundle_versions l ON l.id=v.legal_bundle_version_id
  WHERE v.id=${literal(publicationVersionId)} AND v.status='published';`)
  const signed0 = await signInvoiceTestContractCanonically({ companyId, customerId, contractId, actorUserId })
  must(signed0.status === 'signed' && /^[a-f0-9]{64}$/.test(String(signed0.signature_snapshot_sha256)), `site01_sign_failed:${JSON.stringify(signed0)}`)
  const organizationNumber = sql<string>(`SELECT to_jsonb(organization_number) FROM public.companies WHERE id=${literal(companyId)}`)
  const signed = sql<Record<string, unknown>>(`SELECT to_jsonb(c) FROM public.customer_contracts c WHERE id=${literal(contractId)}`)
  const legalVersions = sql<{ type: string; title: string; version: string; id: string; body: string }[]>(`SELECT jsonb_agg(jsonb_build_object('type',module_key,'title',title,'version',coalesce(template_version,left(content_sha256,12)),'id',id,'body',rendered_body)) FROM public.legal_bundle_version_documents WHERE legal_bundle_version_id=${literal(signed.legal_bundle_version_id)}`)
  const attachment = buildAgreementPdfAttachment({ companyName: 'Synthetic Archive AB', organizationNumber, customerName, customerEmail: `synthetic-${customerId}@example.invalid`, customerNumber: customerId,
    contractNumber: String(signed.contract_number ?? contractId), contractName: 'Synthetic native hourly', contractType: 'variable_hourly', signedAt: String(signed.signed_at), startsAt: requestedStartDate,
    offerReference: String(signed.offer_reference), contractPublicationVersionId: String(signed.contract_publication_version_id), pricePlanVersionId: String(signed.price_plan_version_id),
    legalBundleVersionId: String(signed.legal_bundle_version_id), signatureSnapshotSha256: String(signed.signature_snapshot_sha256), legalVersions, monthlyFeeSek: spec.monthlyFeeSek, spotMarkupOrePerKwh: spec.markupOrePerKwh })
  const pdfBuffer = Buffer.from(attachment.content, 'base64'), documentSha256 = createHash('sha256').update(pdfBuffer).digest('hex')
  await archiveSignedCustomerContractPdf({ companyId, customerContractId: contractId, pdfBuffer, documentSha256, generationSnapshot: { schema: 'gridex_signed_contract_document_v1', contract_id: contractId, signature_snapshot_sha256: signed.signature_snapshot_sha256, synthetic: true } })
  const bound = await supabaseService.from('customer_contracts').update({ document_sha256: documentSha256 }).eq('id', contractId).eq('company_id', companyId).is('document_sha256', null)
  must(!bound.error, `site01_document_bind_failed:${bound.error?.message}`)

  // Qualified network registry for THIS grid owner, then the BRP registry ground for (grid owner, BRP, grid area).
  const registry = await attachNetworkRegistrySourceFixture({ companyId, actorUserId, receiver } as Parameters<typeof attachNetworkRegistrySourceFixture>[0])
  const networkArtifact = await archiveNetworkRegistrySource({ ...registry.submission('SYNTHETIC site01 network original', registry.pdf('site01 network')), companyId, actorUserId: registry.uploader.id })
  must((networkArtifact as { missing?: unknown[] }).missing?.length === 0, 'site01_network_registry_missing_claims')
  const networkReview = await reviewNetworkRegistrySource({ ...networkArtifact, companyId, actorUserId: registry.reviewer.id, decision: 'approve', reason: 'SYNTHETIC separate review of the site01 network original', clause: registry.clause })
  must(networkReview.status === 'authorized', `site01_network_review:${JSON.stringify(networkReview)}`)
  const brpActor = sql<string>(`SELECT to_jsonb(actor_id) FROM public.platform_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value=${literal(brpEdielId)} ORDER BY actor_id LIMIT 1`)
  must(brpActor, 'site01_brp_actor_missing')
  const registryGroundId = randomUUID(), brpRegistrySource = Buffer.from('SYNTHETIC BRP registry ground ' + registryGroundId)
  sql(`INSERT INTO gridex_brp_changes.registry_grounds(id,company_id,environment,dso_actor_id,brp_actor_id,dso_ediel_id,brp_ediel_id,grid_area_code,registry_version,source_reference,source_sha256,registry_snapshot,approved_by,approved_at,valid_from)
  SELECT ${literal(registryGroundId)},${literal(companyId)},'test',${literal(marketActor)},${literal(brpActor)},${literal(receiver)},${literal(brpEdielId)},p.grid_area_code,'SYNTHETIC-1',${literal('SYNTHETIC native BRP registry ' + registryGroundId)},${literal(createHash('sha256').update(brpRegistrySource).digest('hex'))},gridex_brp_changes.registry_snapshot_v1(${literal(marketActor)},${literal(brpActor)}),${literal(actorUserId)},clock_timestamp(),'2026-01-01T00:00:00Z'
  FROM public.metering_points p WHERE p.id=${literal(pointId)}`)
  const permissions = ['communication.read', 'communication.write', 'customers.read', 'customers.write', 'contracts.read', 'contracts.write']
  const brpUploader = await createBilateralSourceOperator(companyId, permissions)
  const brpReviewer = await createBilateralSourceOperator(companyId, [...permissions, 'ediel.source.review'])
  const brpSelector = { environment: 'test' as const, contractId, registryGroundId, identityAgency: '9' as const }
  const brpScope = await brpUploader.client.rpc('ediel_signed_brp_declaration_scope_v1', { p_company_id: companyId, p_actor_user_id: brpUploader.id, p_selector: { ...brpSelector, agreementHash: documentSha256 } })
  must(!brpScope.error && (brpScope.data as { status?: string } | null)?.status === 'scope_available', `site01_brp_scope:${brpScope.error?.message ?? JSON.stringify(brpScope.data)}`)
  const brpKey = randomUUID(), brpRepresentation = randomUUID(), brpSecret = Buffer.from('SYNTHETIC BRP declaration issuer key ' + brpKey)
  const brpLegal = 'SYNTHETIC BRP DECLARATION ISSUER ONLY', brpRepresentationLegal = 'SYNTHETIC BRP DECLARATION REPRESENTATION ONLY'
  sql(`INSERT INTO gridex_brp_declaration_intake.issuer_keys(id,company_id,environment,issuer_code,legal_source_reference,legal_source_sha256,signing_key,valid_from,valid_to) VALUES(${literal(brpKey)},${literal(companyId)},'test','SYNTHETIC',${literal(brpLegal)},${literal(createHash('sha256').update(brpLegal).digest('hex'))},decode(${literal(brpSecret.toString('hex'))},'hex'),'2020-01-01','2099-01-01');
 INSERT INTO gridex_brp_declaration_intake.issuer_representations(id,company_id,environment,issuer_key_id,legal_actor_id,purpose,legal_source_reference,legal_source_sha256,valid_from,valid_to) VALUES(${literal(brpRepresentation)},${literal(companyId)},'test',${literal(brpKey)},${literal((brpScope.data as { claims: { legalActorId: string } }).claims.legalActorId)},'signed_contract_brp_declaration',${literal(brpRepresentationLegal)},${literal(createHash('sha256').update(brpRepresentationLegal).digest('hex'))},'2020-01-01','2099-01-01')`)
  const brpSource = Buffer.from('SYNTHETIC signed BRP declaration source ' + contractId), brpSourceReference = 'SYNTHETIC-native-brp-' + contractId
  const brpClaimsHash = (brpScope.data as { claimsHash: string }).claimsHash, issuedAt = new Date(Date.now() - 60000).toISOString(), expiresAt = new Date(Date.now() + 86400000).toISOString()
  const brpPayload = Buffer.from(JSON.stringify({ format: 'ediel_signed_brp_declaration_receipt_v1', purpose: 'signed_contract_brp_declaration', companyId, environment: 'test', issuerCode: 'SYNTHETIC', receiptId: randomUUID(),
    issuerLegalReference: brpLegal, representationLegalReference: brpRepresentationLegal, claimsHash: brpClaimsHash, agreementHash: documentSha256, sourceHash: createHash('sha256').update(brpSource).digest('hex'),
    sourceReference: brpSourceReference, sourceVersion: '1', issuedAt, expiresAt }))
  const brpArchive = await brpUploader.client.rpc('ediel_archive_signed_brp_declaration_v1', { p_company_id: companyId, p_actor_user_id: brpUploader.id, p_submission: { ...brpSelector, agreementBase64: pdfBuffer.toString('base64'),
    sourceBase64: brpSource.toString('base64'), sourceReference: brpSourceReference, sourceVersion: '1', issuerReceipt: { keyId: brpKey, representationId: brpRepresentation, payloadBase64: brpPayload.toString('base64'), signatureHex: createHmac('sha256', brpSecret).update(brpPayload).digest('hex') } } })
  must(!brpArchive.error && (brpArchive.data as { status?: string } | null)?.status === 'archived', `site01_brp_archive:${brpArchive.error?.message ?? JSON.stringify(brpArchive.data)}`)
  const archivedBrp = brpArchive.data as { artifactId: string; agreementHash: string; sourceHash: string; claimsHash: string }
  const brpReview = await brpReviewer.client.rpc('ediel_review_signed_brp_declaration_v1', { p_company_id: companyId, p_actor_user_id: brpReviewer.id, p_artifact_id: archivedBrp.artifactId, p_review: { agreementHash: archivedBrp.agreementHash,
    sourceHash: archivedBrp.sourceHash, claimsHash: archivedBrp.claimsHash, decision: 'approve', reason: 'SYNTHETIC separate review of the signed BRP declaration', clause: { locator: 'page1 synthetic', quote: 'SYNTHETIC balance responsible party declaration' } } })
  must(!brpReview.error && (brpReview.data as { status?: string } | null)?.status === 'authorized', `site01_brp_review:${brpReview.error?.message ?? JSON.stringify(brpReview.data)}`)

  // Signed masterdata and requested-method declarations bound to this contract's bytes (declared synthetic facts).
  const declarationSource = Buffer.from('SYNTHETIC signed customer masterdata declaration ' + contractId)
  sql(`INSERT INTO gridex_customer_masterdata.signed_declarations(company_id,customer_id,environment,contract_id,contract_revision,contract_hash,agreement_original,agreement_sha256,valid_from,customer_identity,end_user_masterdata,source_reference,source_version,source_original,source_sha256,approved_by,approved_at)
  SELECT c.company_id,c.customer_id,'test',c.id,c.signed_version,gridex_received_sources.production_contract_hash_v1(c),decode(${literal(pdfBuffer.toString('hex'))},'hex'),${literal(documentSha256)},'2026-01-01T00:00:00Z',
  jsonb_build_object('id',${literal(customerIdentity)},'qualifier','SE2','agency','260'),
  jsonb_build_object('nameParts',jsonb_build_array(${literal(customerName)}),'streetParts',jsonb_build_array('Testgatan 1'),'postalCode','123 45','city','Teststad','country','SE'),
  ${literal('SYNTHETIC-native-masterdata-' + contractId)},'1',decode(${literal(declarationSource.toString('hex'))},'hex'),${literal(createHash('sha256').update(declarationSource).digest('hex'))},${literal(actorUserId)},clock_timestamp()
  FROM public.customer_contracts c WHERE c.id=${literal(contractId)} AND c.company_id=${literal(companyId)}`)
  const methodSource = Buffer.from('SYNTHETIC signed new-agreement requested method ' + contractId)
  sql(`INSERT INTO gridex_metering_method_changes.contract_request_declarations(company_id,environment,contract_id,contract_revision,protected_contract_hash,customer_id,site_id,metering_point_id,legal_actor_id,legal_sender_id,legal_receiver_id,point_id,identity_agency,grid_area_code,requested_method,agreement_original,agreement_sha256,source_reference,source_version,source_original,source_sha256,approved_by,approved_at)
  SELECT c.company_id,'test',c.id,c.signed_version,gridex_received_sources.production_contract_hash_v1(c),c.customer_id,coalesce(c.customer_site_id,c.site_id),c.metering_point_id,
  (gridex_ai_processing.header_company_basis_v1(c.company_id,'test',${literal(sender)},p.grid_owner_ediel_id)->>'legalActorId')::uuid,${literal(sender)},p.grid_owner_ediel_id,
  coalesce(nullif(p.ediel_metering_point_id,''),nullif(p.meter_point_id,'')),'9',p.grid_area_code,'Z04',decode(${literal(pdfBuffer.toString('hex'))},'hex'),${literal(documentSha256)},
  ${literal('SYNTHETIC-native-method-' + contractId)},'1',decode(${literal(methodSource.toString('hex'))},'hex'),${literal(createHash('sha256').update(methodSource).digest('hex'))},${literal(actorUserId)},clock_timestamp()
  FROM public.customer_contracts c JOIN public.metering_points p ON p.id=c.metering_point_id WHERE c.id=${literal(contractId)} AND c.company_id=${literal(companyId)}`)

  // Manual power of attorney for this site, then the switch request and the sent Z03.
  const poaReference = `POA${switchId.replace(/-/g, '').slice(0, 12).toUpperCase()}`
  const poaScopes = ['supplier_switch', 'grid_owner_data', 'metering_data']
  const poaBase = { customer_id: customerId, site_id: siteId, companyId, reference: poaReference, scope: 'supplier_switch', valid_from: '2026-01-01', valid_to: '2099-01-01', method: 'manual_pdf', signer_name: customerName,
    signer_identity_number: customerIdentity, accepted_source: 'synthetic_native_fixture', signedScopes: poaScopes, scopeSummary: { scopes: poaScopes } }
  const poa = await savePowerOfAttorney(supabaseService, { ...poaBase, status: 'draft', signed_at: null, accepted_at: null } as never)
  const poaLink = await supabaseService.from('powers_of_attorney').update({ contract_id: contractId, customer_contract_id: contractId }).eq('id', poa.id).eq('company_id', companyId)
  must(!poaLink.error, `site01_poa_link_failed:${poaLink.error?.message}`)
  await savePowerOfAttorney(supabaseService, { ...poaBase, id: poa.id, status: 'signed', signed_at: new Date().toISOString(), accepted_at: new Date().toISOString() } as never)
  const authorization = await ensureAuthorizationDocumentFromPowerOfAttorney({ companyId, customerId, powerOfAttorneyId: poa.id, siteId, meteringPointId: pointId, contractId, coverage: powerOfAttorneyCoverageFromScopes(poaScopes), signedScopes: poaScopes })
  const authorizationDocumentId = authorization.authorizationDocumentId
  must(authorizationDocumentId, 'site01_authorization_document_missing')
  must(sql(`SELECT to_jsonb(switch_ready) FROM public.customer_contract_lifecycle_readiness_v WHERE customer_contract_id=${literal(contractId)}`) === true, 'site01_switch_not_ready')
  const invoiceeAddress = { lines: ['Testgatan 1', '', ''], postalCode: '123 45', city: 'Teststad', country: 'SE', representation: { convention: 'original', reference: 'SYNTHETIC', mode: 1 } }
  const invoiceeSnapshot = { portalData: { powerOfAttorneyReference: poaReference, dependentConditionFacts: { invoiceeObjects: [{ meteringPointId: external, identityAgency: '9',
    endUser: { identity: { id: customerIdentity, qualifier: 'SE2', agency: '260' }, address: invoiceeAddress },
    invoicee: { identity: { id: customerIdentity, qualifier: 'SE2', agency: '260' }, nameLines: [customerName], address: invoiceeAddress, availability: 'available' },
    event: { state: 'none', reference: `fixture-invoicee:${switchId}` }, source: { kind: 'caller_selection', companyId, reference: `fixture-invoicee:${switchId}` } }] } } }
  sql(`INSERT INTO public.supplier_switch_requests(id,company_id,customer_id,site_id,customer_site_id,metering_point_id,grid_owner_id,contract_id,customer_contract_id,power_of_attorney_id,authorization_document_id,request_type,status,requested_start_date,prodat_variant,prodat_reason,lifecycle_blocked,validation_snapshot) VALUES(${literal(switchId)},${literal(companyId)},${literal(customerId)},${literal(siteId)},${literal(siteId)},${literal(pointId)},${literal(gridId)},${literal(contractId)},${literal(contractId)},${literal(poa.id)},${literal(authorizationDocumentId)},'switch','ready',${literal(requestedStartDate)},'L','Z22',false,${literal(JSON.stringify(invoiceeSnapshot))}::jsonb);`)
  const queued = await prepareAndQueueEdielZ03({ actorUserId, switchRequestId: switchId, communicationRouteId: routeId, environment: 'test' })
  syntheticSmtpProvider('recipient@example.invalid')
  await sendEdielMessageViaSmtp(queued, { actorUserId, smtpMimeMode: 'nodemailer-attachment' })
  const originalZ03 = await getEdielMessageById(queued.id)
  must(originalZ03, 'site01_z03_unreadable')
  const tokenized = tokenizeEdifact(originalZ03.raw_payload!)
  const li = tokenized.segments.find(t => t.tag === 'RFF' && segmentComposite(t, 1, tokenized.una)[0] === 'LI')
  const caseReference = li ? segmentComposite(li, 1, tokenized.una)[1] : null
  must(caseReference, 'site01_case_reference_missing')
  must(sql(`SELECT to_jsonb(gridex_received_sources.sent_source_is_current_v1(m)) FROM public.ediel_messages m WHERE id=${literal(queued.id)}`) === true, 'site01_z03_not_current_sent_source')
  return { companyId, actorUserId, customerId, siteId, pointId, contractId, switchId, external, sender, receiver, gridId, routeId, routeProfileId, marketActorId: marketActor,
    customerIdentity: a.customerIdentity, requestedStartDate, brpEdielId, gridAreaCode: spec.gridAreaCode, documentSha256, authorizationDocumentId, powerOfAttorneyId: poa.id,
    caseReference, originalZ03, siteSpec: spec } as unknown as Stage
}

// -------------------------------------------------- Z04 L start (copy of main03)

async function activateSwitchSupply(f: Ground | Stage): Promise<{ supplyPeriodId: string; sourceId: string }> {
  const smtp = assertEdielSmtpReadiness()
  // SUBSTITUTE: the grid owner's PRODAT Z04 (L) is a synthetic wire (app helper buildCancellationProspectiveZ04) placed in the mailbox tables by
  // seedOriginalMailboxNative instead of an IMAP fetch — verifierar inte nätägarens riktiga Z04, IMAP/S-MIME eller brevlådans hämtning.
  const wire = buildCancellationProspectiveZ04(f), receivedAt = new Date().toISOString()
  const mail = await seedOriginalMailboxNative(sql, literal, { companyId: f.companyId, environment: 'test', raw: wire, receivedAt, smtpFrom: smtp.from })
  const ackRoute = randomUUID(), ackProfile = randomUUID()
  sql(`INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,grid_owner_id,environment_type,is_active,target_email)
    VALUES(${literal(ackRoute)},${literal(f.companyId)},'Synthetic switch ACK route','ediel_ack',${literal(f.gridId)},'bilateral_test',true,'recipient@example.invalid');
    INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,payload_format,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,is_active,transport_security_mode,mailbox,smtp_host,smtp_port,smtp_to,receiver_email)
    VALUES(${literal(ackProfile)},${literal(f.companyId)},${literal(ackRoute)},'Synthetic switch ACK profile','test','edifact','edifact',${literal(f.sender)},${literal(f.receiver)},'23-DDQ-PRODAT',true,true,'unencrypted',${literal(smtp.from)},${literal(smtp.host)},${smtp.port},'recipient@example.invalid','recipient@example.invalid');`)
  const outboundMatch = await matchOutboundRequestForInbound({ companyId: f.companyId, parsed: mail.parsed, inboundEmailMessageId: mail.inboundEmailMessageId, parseResultId: mail.parseResultId })
  const meteringPointMatch = await matchMeteringPointForInbound({ companyId: f.companyId, parsed: mail.parsed })
  const sourceId = await createInboundEdielMessage({ companyId: f.companyId, actorUserId: f.actorUserId, environment: 'test', inboundEmailMessageId: mail.inboundEmailMessageId,
    parseResultId: mail.parseResultId, parsed: mail.parsed, outboundMatch, meteringPointMatch })
  must(sourceId, `site01_z04_public_birth_refused:${JSON.stringify({ outboundMatch, meteringPointMatch })}`)
  const message = await getEdielMessageById(sourceId)
  must(message && message.company_id === f.companyId && message.message_code === 'Z04' && message.rule_profile_key === 'PRODAT:Z04:L:26.A:r3',
    `site01_z04_source_unexpected:${JSON.stringify(message && { company: message.company_id, code: message.message_code, profile: message.rule_profile_key })}`)
  const decision = await resolveCanonicalRuntimeDecisionWithRegistry(message, { actorUserId: f.actorUserId })
  must([decision.syntaxDecision, decision.applicationDecision, decision.functionalDecision].every(value => value === 'accepted'), `site01_z04_not_accepted:${JSON.stringify(decision.issues)}`)
  await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: sourceId })
  const periods = await supabaseService.from('customer_supply_periods').select('id,status,contract_id,metering_point_id,customer_id,start_date,end_date,source_process,source_message_id,source_switch_request_id').eq('company_id', f.companyId).eq('metering_point_id', f.pointId)
  must(!periods.error, `site01_supply_read_failed:${periods.error?.message}`)
  const rows = periods.data ?? []
  must(rows.length === 1, `site01_supply_period_count:${rows.length}`)
  const period = rows[0] as Record<string, unknown>
  must(period.customer_id === f.customerId && period.source_message_id === sourceId && period.source_switch_request_id === f.switchId && period.source_process === 'supplier_switch_confirmation',
    `site01_supply_period_not_from_switch:${JSON.stringify(period)}`)
  must(period.status === 'confirmed_by_grid_owner' && period.start_date === f.requestedStartDate, `site01_supply_period_state:${JSON.stringify(period)}`)
  must(period.contract_id === f.contractId, `site01_supply_period_contract_unset:${String(period.contract_id)}`)
  // A confirmed normal start is billable only after its due activation (normal_supply_activations; see fixtures/main03Fixture.ts for the
  // citations). SUBSTITUTE: the customer-operations cron route is replaced by a direct call of its supplyMarketDeadlines step, scoped to this
  // tenant — verifierar inte schemaläggningen, cron-autentiseringen eller cronens övriga steg.
  const swept = await advanceSupplyMarketDeadlines({ actorUserId: f.actorUserId, companyId: f.companyId, limit: 10 })
  const activated = sql<number>(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.normal_supply_activations WHERE company_id=${literal(f.companyId)} AND period_id=${literal(String(period.id))}`)
  if (activated !== 1) {
    const refusal = await supabaseService.rpc('activate_customer_supply_v1', { p_company_id: f.companyId, p_supplier_switch_request_id: f.switchId, p_source_message_id: sourceId, p_actor_user_id: f.actorUserId })
    throw new Error(`site01_supply_not_activated:${JSON.stringify({ swept, activated, refusal: refusal.error?.message ?? null })}`)
  }
  return { supplyPeriodId: String(period.id), sourceId }
}

// ------------------------------------------------------------------- spot

/** Read-only: is (month, area) already locked, and does every stored hourly price equal this fixture's own value? */
function lockedSpotMonthMatches(area: 'SE3' | 'SE4', priceSalt: number): { locked: boolean; matches: boolean; detail: string } {
  const status = dbRead<string | undefined>(`SELECT to_json(status) FROM public.spot_price_monthly_summaries WHERE source='elprisetjustnu' AND price_area=${lit(area)} AND billing_month=${lit(SITE01_BILLING_MONTH)}`)
  if (status !== 'locked') return { locked: false, matches: false, detail: String(status ?? 'absent') }
  const month = syntheticMonth(SITE01_BILLING_MONTH)
  const expected = new Map<number, string>()
  for (let day = 1; day <= month.days; day += 1) for (const row of spotDayPayload(month, day, priceSalt)) expected.set(Date.parse(String(row.time_start)), Number(row.SEK_per_kWh).toFixed(5))
  const stored = dbRead<Array<{ t: string; p: string }>>(`SELECT coalesce(json_agg(json_build_object('t',time_start,'p',round(sek_per_kwh,5)::text) ORDER BY time_start),'[]') FROM public.spot_price_intervals
    WHERE source='elprisetjustnu' AND price_area=${lit(area)} AND time_start>=${lit(new Date(month.startMs).toISOString())} AND time_start<${lit(new Date(month.endMs).toISOString())}`)
  const mismatches = stored.filter(row => expected.get(Date.parse(row.t)) !== Number(row.p).toFixed(5))
  return { locked: true, matches: stored.length === expected.size && mismatches.length === 0, detail: `stored=${stored.length} expected=${expected.size} mismatches=${mismatches.length}` }
}

async function importSpotArea(area: 'SE3' | 'SE4', priceSalt: number): Promise<void> {
  const month = syntheticMonth(SITE01_BILLING_MONTH)
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const match = /\/(\d{4})\/(\d{2})-(\d{2})_(SE[1-4])\.json$/.exec(url.pathname)
    if (!url.hostname.endsWith('elprisetjustnu.se') || !match || match[4] !== area || Number(match[1]) !== month.year || Number(match[2]) !== month.month) return new Response('[]', { status: 404 })
    return new Response(JSON.stringify(spotDayPayload(month, Number(match[3]), priceSalt)), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  const result = await importSpotPricesForMonth({ billingMonth: SITE01_BILLING_MONTH, priceAreas: [area], fetchImpl, triggerSource: 'manual', createdBy: null })
  must(result.errors.length === 0, `site01_spot_import_errors:${area}:${result.errors.slice(0, 3).join(' | ')}`)
}

// ----------------------------------------------------------------- UTILTS days

async function ingestDay(input: { f: Ground | Stage; runtime: SiteRuntime; day: number; dataRequest: GridOwnerDataRequestRow; companyId: string }): Promise<DayRecord> {
  const { f, runtime, day, dataRequest } = input
  const started = Date.now()
  const month = syntheticMonth(SITE01_BILLING_MONTH)
  // companyId in the wire builder only feeds the transaction reference hash: a per-site key keeps IDE references unique across sites.
  const wire = buildDayWire({ month, day, salt: runtime.oracle.consumptionSalt, companyId: `${input.companyId}:${runtime.key}`, external: f.external, sender: f.sender, receiver: f.receiver })
  // The template carries the grid area TES in LOC+239; site B's file names its own grid area.
  const raw = runtime.spec.gridAreaCode === 'TES' ? wire.raw : wire.raw.replace('LOC+239+TES:SVK:260', `LOC+239+${runtime.spec.gridAreaCode}:SVK:260`)
  must(runtime.spec.gridAreaCode === 'TES' || raw !== wire.raw, 'site01_grid_area_not_replaced_in_wire')
  const { parsed, txRef } = wire
  // SUBSTITUTE: the files are for a month that already lies in the past, so the reception time is the real current time (the wire's own
  // day-after reception time would select an older UTILTS guide edition) — verifierar inte hur snabbt nätägaren levererar eller guide-urval per mottagningsdag.
  const receivedAt = new Date().toISOString()
  // SUBSTITUTE: inbound mail transport (IMAP fetch, S/MIME, mailbox custody) replaced by a direct ediel_messages insert for the canonical UTILTS E66
  // profile — verifierar inte mottagning via brevlåda, avkodning eller dubblettskydd i transporten.
  sql(`INSERT INTO public.ediel_messages(id,company_id,customer_id,site_id,metering_point_id,grid_owner_id,grid_owner_data_request_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,message_received_at,execution_context_snapshot,application_reference,sender_ediel_id,receiver_ediel_id,interchange_reference,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
     SELECT ${literal(wire.sourceId)},${literal(f.companyId)},${[f.customerId, f.siteId, f.pointId, f.gridId, dataRequest.id].map(literal).join(',')},'test','inbound','edifact','UTILTS','E66','received',${literal(raw)},'{}',${literal(receivedAt)},'{}',${literal(parsed.applicationReference)},${literal(f.receiver)},${literal(f.sender)},${literal(parsed.interchangeReference)},pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile
     FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id WHERE profile.message_code='E66' AND profile.direction IN ('inbound','both') AND profile.is_enabled ORDER BY profile.profile_key LIMIT 1;`)
  seedUtiltsIssuerHistoryGround(sql, literal, wire.sourceId, f.actorUserId)
  const read = await supabaseService.from('ediel_messages').select('*').eq('id', wire.sourceId).single()
  must(!read.error && read.data, `site01_utilts_source_unreadable:${runtime.key}:${day}:${read.error?.message}`)
  const source = read.data as unknown as EdielMessageRow
  await recordUtiltsTechnicalReception(source, f.actorUserId)
  const policy = resolveCanonicalMessagePolicy(source)!
  const rt = await recordUtiltsFinalRuntime(source)
  must(rt.validation.ok, `site01_utilts_runtime_not_ok:${runtime.key}:${day}:${JSON.stringify(rt.validation.issues).slice(0, 800)}`)
  const matches = rt.facts.transactions.map(t => ({ transactionReference: t.transactionId, meteringPointId: f.pointId, customerId: f.customerId, siteId: f.siteId, gridOwnerId: f.gridId, externalMeteringPointId: t.meterPointId, externalGridAreaId: t.gridAreaId, matchStatus: 'matched' as const }))
  const contracts = await prepareUtiltsConsumptionContracts({ message: source, runtime: rt, policy, matches, dataRequest, fallback: { customerId: f.customerId, siteId: f.siteId, meteringPointId: f.pointId, gridOwnerId: f.gridId }, allowConsumption: true })
  const persistInput: UtiltsBoundPersistenceInput & { actorUserId: string } = { actorUserId: f.actorUserId, companyId: f.companyId, environment: source.environment, sourceMessageId: source.id, messageCode: source.message_code!, rawPayload: source.raw_payload!, contracts,
    transactions: buildUtiltsTransactionPersistencePayload({ messageCode: source.message_code, transactions: rt.facts.transactions, rawSegments: rt.facts.rawSegments, dispositions: rt.transactionDispositions, matches }) }
  const outcomes = await persistUtiltsTransactionResults(persistInput)
  // SUBSTITUTE: the complete UTILTS processor (ACK/APERAK creation, request completion, underlay creation) replaced by persist + metering-sink steps —
  // verifierar inte kvittensflödet eller att UTILTS-flödet självt skapar underlag.
  const stored = await ingestBoundUtiltsMetering({ actorUserId: f.actorUserId, message: source, boundOutcomes: outcomes })
  must(stored.length === QUARTERS_PER_DAY, `site01_utilts_day_stored_${stored.length}:${runtime.key}:${day}`)
  return { site: runtime.key, day, sourceId: source.id, transactionRef: txRef, rawSha256: createHash('sha256').update(raw, 'utf8').digest('hex'), meteringValueIds: stored.map(row => row.id), ms: Date.now() - started }
}

// ------------------------------------------------------------------- builder

export async function buildSite01Fixture(): Promise<Site01Fixture> {
  const oracleA = chooseSiteOracle(SITE_A), oracleB = chooseSiteOracle(SITE_B)
  for (const [key, value] of Object.entries(SYNTHETIC_SMTP_ENV)) vi.stubEnv(key, value)

  substitute({ id: 'tenant-customer-contract-seed', step: 'fixture: tenant/customer/site A/contract A', substitute: 'scripts/helpers/ediel-normal-switch-native-fixture.ts (psql inserts + real offer/publication/signature RPCs)',
    notVerified: 'admin customer intake (claude-track2/004), contract from offer (claude-track2/005), customer-facing signing UI' })
  substitute({ id: 'second-site-seed', step: 'fixture: site B', substitute: 'seedSecondSite: a parameterised copy of the same native seed for a second site, grid owner, offer and contract in the SAME company and customer (psql inserts + real RPCs)',
    notVerified: 'adding a second site/contract to an existing customer through the admin UI or API; admin site creation' })
  substitute({ id: 'z03-smtp-provider', step: 'fixture: Z03 send', substitute: 'vi.spyOn(nodemailer.createTransport) with an accepting sendMail', notVerified: 'real SMTP provider, TLS, delivery of the Z03' })
  substitute({ id: 'supply-activation', step: 'fixture: Z04 L per site', substitute: 'synthetic PRODAT Z04 subtype L per site answering that site\'s sent Z03 (buildCancellationProspectiveZ04), mailbox rows via seedOriginalMailboxNative, real createInboundEdielMessage + processInboundEdielMessage',
    notVerified: 'real grid-owner Z04, IMAP fetch, S/MIME, outbound APERAK/CONTRL delivery, contract activation on the start day' })
  substitute({ id: 'switch-ack-route', step: 'fixture: Z04 L per site', substitute: 'ediel_ack communication_routes/ediel_route_profiles rows by psql per grid owner', notVerified: 'route administration' })

  const groundA = await timed('fixture: tenant + site A + switch (Z03 sent)', () => seedNormalSwitchNativeFixture({ requestedStartDate: SITE_A.startDate, provider: syntheticSmtpProvider }))
  const supplyA = await timed('fixture: site A Z04 L', () => activateSwitchSupply(groundA))
  const groundB = await timed('fixture: site B seed (same company/customer)', () => seedSecondSite(groundA, SITE_B))
  const supplyB = await timed('fixture: site B Z04 L', () => activateSwitchSupply(groundB))
  must(groundB.companyId === groundA.companyId && groundB.customerId === groundA.customerId && groundB.siteId !== groundA.siteId && groundB.pointId !== groundA.pointId && groundB.contractId !== groundA.contractId, 'site01_not_two_sites_of_one_customer')

  // SUBSTITUTE: site address and grid owner name written on the seeded site / metering point rows by service role — verifierar inte kundregistrets adress- och
  // nätägarunderhåll; the invoice file reads exactly these columns (lib/billing/invoiceFileExport.ts loadFacility).
  substitute({ id: 'site-master-data', step: 'fixture: site address + grid owner name', substitute: 'service-role UPDATE of customer_sites street/postal_code/city (site A) and metering_points.grid_owner_name (both)',
    notVerified: 'how addresses and grid owner names normally reach the site/metering point records' })
  const siteAUpdate = await supabaseService.from('customer_sites').update({ street: SITE_A.address.street, postal_code: SITE_A.address.postalCode, city: SITE_A.address.city }).eq('company_id', groundA.companyId).eq('id', groundA.siteId)
  must(!siteAUpdate.error, `site01_site_a_address_failed:${siteAUpdate.error?.message}`)
  for (const [spec, ground] of [[SITE_A, groundA], [SITE_B, groundB]] as const) {
    const update = await supabaseService.from('metering_points').update({ grid_owner_name: spec.gridOwnerName }).eq('company_id', ground.companyId).eq('id', ground.pointId)
    must(!update.error, `site01_grid_owner_name_failed:${spec.key}:${update.error?.message}`)
  }

  const supplyEnd = await timed('fixture: site B ordinary Z05L end', () => endExistingSiteSupply(groundA, groundB, supplyB, oracleB))

  // Operator session (permissions + password) and spot prices for both areas, settlement-locked over HTTP.
  substitute({ id: 'actor-permissions-password', step: 'fixture: operator session', substitute: 'role_permissions rows on the actor\'s existing seed role via psql, password via auth admin API, then a real password login producing the app session cookies',
    notVerified: 'role/permission administration UI, invitation and password-reset flows' })
  const password = `T1-${randomUUID()}`
  // Allow grants come only from roles (user_permissions rows only deny): add the three billing permissions to the actor's existing seed role.
  // Compare fixtures/main03Fixture.ts (same reasoning and citations).
  sql(`INSERT INTO public.role_permissions(role_id,role_key,permission_id,permission_key,effect)
    SELECT r.id,r.key,p.id,p.key,'allow' FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id
      JOIN public.permissions p ON p.key IN('billing_underlay.read','billing_underlay.export','pricing.write')
    WHERE ur.user_id=${literal(groundA.actorUserId)} AND ur.company_id=${literal(groundA.companyId)} AND ur.status='active' AND ur.is_active
      AND NOT EXISTS(SELECT 1 FROM public.role_permissions x WHERE x.role_id=r.id AND x.permission_id=p.id);`)
  const updated = await supabaseService.auth.admin.updateUserById(groundA.actorUserId, { password })
  must(!updated.error, `site01_password_failed:${updated.error?.message}`)
  const session = await timed('fixture: sign in', () => signIn({ email: `${groundA.actorUserId}@example.invalid`, password, userId: groundA.actorUserId, companyId: groundA.companyId }))
  substitute({ id: 'spot-provider', step: 'fixture: spot prices SE3 + SE4', substitute: 'in-process fetchImpl serving synthetic elprisetjustnu-format hourly rows into the real importSpotPricesForMonth, one salt per price area',
    notVerified: 'the external provider API and its network/TLS handling' })
  const spotLocks: Record<string, Record<string, unknown>> = {}
  for (const spec of [SITE_A, SITE_B]) {
    const reuse = lockedSpotMonthMatches(spec.priceArea, spec.priceSalt)
    if (reuse.locked) {
      // A later run in the same stack finds the month locked (the importer then refuses): reuse only after an exact price comparison.
      must(reuse.matches, `site01_spot_locked_month_differs:${spec.priceArea}:${reuse.detail}`)
      substitute({ id: `spot-locked-month-reuse-${spec.priceArea}`, step: 'fixture: spot prices', substitute: `${spec.priceArea} month already imported and locked by an earlier run in this stack; stored hourly rows compared equal to this fixture before reuse`,
        notVerified: 'import and lock-month for this area (verified in the run that first locked it)' })
      spotLocks[spec.priceArea] = { reused: true, detail: reuse.detail }
      continue
    }
    await timed(`fixture: spot import ${spec.priceArea}`, () => importSpotArea(spec.priceArea, spec.priceSalt))
    const locked = await timed(`fixture: spot lock-month ${spec.priceArea} (HTTP)`, () => http(session, 'POST', '/api/internal/spot/lock-month', { json: { billing_month: SITE01_BILLING_MONTH, price_area: spec.priceArea, reason: 'track1 site01 settlement lock' } }))
    must(locked.status === 200, `site01_spot_lock_${spec.priceArea}_${locked.status}:${JSON.stringify(locked.body)?.slice(0, 300)}`)
    const body = ((locked.body as { data?: Record<string, unknown> } | null)?.data ?? {}) as Record<string, unknown>
    must(body.status === 'locked', `site01_spot_${spec.priceArea}_not_locked`)
    spotLocks[spec.priceArea] = { id: body.id, source: body.source, status: body.status, average: body.average_sek_per_kwh ?? null }
  }

  // UTILTS: issuers and data requests per site, then daily files per site and delivered day.
  substitute({ id: 'utilts-issuer-registry', step: 'fixture: UTILTS issuers', substitute: 'registerUtiltsIssuer / seedUtiltsIssuerHistoryGround (psql inserts of synthetic approved issuer namespaces, mandates and absence grounds), one per grid owner',
    notVerified: 'real issuer registry onboarding and transport mandates' })
  substitute({ id: 'data-request-row', step: 'fixture: grid owner data requests', substitute: 'grid_owner_data_requests rows (scope billing_underlay) by psql, one per site', notVerified: 'creation/sending of the history request' })
  substitute({ id: 'utilts-transport', step: 'fixture: daily UTILTS files', substitute: 'direct ediel_messages insert for the canonical E66 profile (psql) with the physical test indicator, then real reception/runtime/persistence functions',
    notVerified: 'IMAP/mailbox fetch, S/MIME, transport custody' })
  substitute({ id: 'utilts-processor', step: 'fixture: daily UTILTS files', substitute: 'persistUtiltsTransactionResults + ingestBoundUtiltsMetering step by step (processInboundUtiltsMessage not run)',
    notVerified: 'ACK/APERAK/CONTRL creation, request completion, underlay creation by the UTILTS flow' })
  registerUtiltsIssuer(sql, literal, groundA.receiver, groundA.actorUserId)
  registerUtiltsIssuer(sql, literal, groundB.receiver, groundB.actorUserId)
  setUtiltsReceiverRole(sql, literal, groundA.companyId, groundA.actorUserId, 'E66')

  const sites = {} as Record<SiteKey, SiteRuntime>
  const days: DayRecord[] = []
  for (const [spec, oracle, ground, supply] of [[SITE_A, oracleA, groundA, supplyA], [SITE_B, oracleB, groundB, supplyB]] as const) {
    const dataRequestId = randomUUID()
    sql(`INSERT INTO public.grid_owner_data_requests(id,company_id,customer_id,site_id,metering_point_id,grid_owner_id,request_scope) VALUES(${literal(dataRequestId)},${literal(ground.companyId)},${literal(ground.customerId)},${literal(ground.siteId)},${literal(ground.pointId)},${literal(ground.gridId)},'billing_underlay')`)
    const dataRequest = { id: dataRequestId, company_id: ground.companyId, customer_id: ground.customerId, site_id: ground.siteId, metering_point_id: ground.pointId, grid_owner_id: ground.gridId, request_scope: 'billing_underlay', response_payload: {} } as GridOwnerDataRequestRow
    const runtime: SiteRuntime = { key: spec.key, spec, oracle, siteId: ground.siteId, pointId: ground.pointId, contractId: ground.contractId, gridOwnerId: ground.gridId, external: ground.external,
      gridOwnerEdielId: ground.receiver, supplyPeriodId: supply.supplyPeriodId, dataRequestId, switchId: ground.switchId }
    sites[spec.key] = runtime
    for (let day = spec.firstDay; day <= spec.deliveredLastDay; day++) {
      days.push(await timed(`fixture: UTILTS ${spec.key} day ${day}`, () => ingestDay({ f: ground, runtime, day, dataRequest, companyId: ground.companyId })))
    }
  }
  return { companyId: groundA.companyId, actorUserId: groundA.actorUserId, customerId: groundA.customerId, ownEdielId: groundA.sender, session, sites, days, spotLocks, supplyEnd }
}
