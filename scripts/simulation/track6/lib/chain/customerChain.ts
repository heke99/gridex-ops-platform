// Ursprung (kopierad och anpassad):
//  - ba0650537527ac5635a2b995c46f1e758c1d0102 (origin/claude/sim-20261029-track1):scripts/simulation/track1/fixtures/site01Fixture.ts
//    (SYNTHETIC_SMTP_ENV, syntheticSmtpProvider, activateSwitchSupply = offert -> publicering -> avtal -> signering -> Z03 -> Z04 L -> aktivering)
//  - 3ea5cd2b6d37b910674e71993ac94e5720ed31a8 (origin/claude/sim-20261029-track1):scripts/simulation/track1/fixtures/main03Fixture.ts
//    (activateNormalSwitchSupply, operatörsbehörighet via role_permissions, importSyntheticSpot, lockedSpotMonthMatches, UTILTS-inmatning)
//  - 3ea5cd2b6d37b910674e71993ac94e5720ed31a8:scripts/simulation/track1/fixtures/main04Support.ts (enableFileInvoiceProvider -> se billingFlow.ts)
// Nytt: ETT bolag per kund (den inhemska seeden skapar sitt eget bolag med eget Ediel-ID), kundprofil C1-C4, TIMVÄRDEN (24) i stället för 96 kvartsvärden,
// valbar invoice_delivery_method före signering. Allt app-anrop går mot lokal stack; SMTP/IMAP ersätts enligt substitutions.ts.
import { randomUUID } from 'node:crypto'
import { vi } from 'vitest'
import nodemailer from 'nodemailer'
import { seedNormalSwitchNativeFixture, nativeSql as sql, literal } from '@/scripts/helpers/ediel-normal-switch-native-fixture'
import { buildCancellationProspectiveZ04 } from '@/scripts/helpers/ediel-cancellation-prospective-source-2ea'
import { seedOriginalMailboxNative } from '@/scripts/helpers/originalMailboxNative'
import { registerUtiltsIssuer, seedUtiltsIssuerHistoryGround, recordUtiltsFinalRuntime, recordUtiltsTechnicalReception, setUtiltsReceiverRole } from '@/scripts/helpers/utiltsConsumptionParties'
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
import { buildHourlyDayWire } from './hourlyWire'
import { substitute } from './substitutions'
import { dbRead, http, lit, sha256Hex, signIn, timed, type Session } from './runtime'
import { DELIVERY01_BILLING_MONTH, DELIVERY01_E66_DAYS, DELIVERY01_START_DATE, HOURS_PER_DAY, spotDayPayload, syntheticMonth } from './synthetic'

function must(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }

type Ground = Awaited<ReturnType<typeof seedNormalSwitchNativeFixture>>

export type Address = { street: string; postalCode: string; city: string }

export type CustomerSpec = {
  key: 'C1' | 'C2' | 'C3' | 'C4'
  label: string
  fullName: string
  /** General contact email (customers.email). Must never be used as invoice email. */
  contactEmail: string
  /** customers.invoice_email (billing profile). null = none. */
  invoiceEmail: string | null
  /** customers.billing_* (billing profile). null = none. */
  billing: Address | null
  /** Facility (site) address. */
  site: Address
  /** Intended contract invoice_delivery_method (written into the price snapshot BEFORE signing; effective value is read back). */
  deliveryMethod: 'email' | 'paper'
}

// All addresses and mailboxes are synthetic (*.invalid).
export const S1: Address = { street: 'Anläggningsvägen 1', postalCode: '111 11', city: 'Sitestad' }
export const B1: Address = { street: 'Faktureringsgatan 10', postalCode: '222 22', city: 'Fakturastad' }
export const B2: Address = { street: 'Nyfakturavägen 20', postalCode: '333 33', city: 'Nystad' }
export const NEW_C1_INVOICE_EMAIL = 'faktura-c1-ny@t6.sim.invalid'

export const CUSTOMER_SPECS: Record<CustomerSpec['key'], CustomerSpec> = {
  C1: { key: 'C1', label: 'email', fullName: 'C1 Epostkund', contactEmail: 'kontakt-c1@t6.sim.invalid', invoiceEmail: 'faktura-c1@t6.sim.invalid', billing: B1, site: S1, deliveryMethod: 'email' },
  C2: { key: 'C2', label: 'paper+email', fullName: 'C2 Pappersochepost', contactEmail: 'kontakt-c2@t6.sim.invalid', invoiceEmail: 'faktura-c2@t6.sim.invalid',
    billing: { street: 'Faktureringsgatan 20', postalCode: '444 44', city: 'Fakturastad' }, site: { street: 'Anläggningsvägen 2', postalCode: '112 22', city: 'Sitestad' }, deliveryMethod: 'paper' },
  C3: { key: 'C3', label: 'paper no email', fullName: 'C3 Pappersutanepost', contactEmail: 'kontakt-c3@t6.sim.invalid', invoiceEmail: null,
    billing: { street: 'Faktureringsgatan 30', postalCode: '555 55', city: 'Fakturastad' }, site: { street: 'Anläggningsvägen 3', postalCode: '113 33', city: 'Sitestad' }, deliveryMethod: 'paper' },
  C4: { key: 'C4', label: 'missing', fullName: 'C4 Saknarfaktura', contactEmail: 'kontakt-c4@t6.sim.invalid', invoiceEmail: null,
    billing: null, site: { street: 'Anläggningsvägen 4', postalCode: '114 44', city: 'Sitestad' }, deliveryMethod: 'email' },
}

export type CustomerChain = {
  spec: CustomerSpec
  companyId: string
  actorUserId: string
  customerId: string
  siteId: string
  pointId: string
  contractId: string
  gridOwnerId: string
  external: string
  ownEdielId: string
  issuerEdielId: string
  supplyPeriodId: string
  session: Session
  /** Effective values read back from the stack after the fixture (not assumed). */
  effective: {
    contractBillingAddressSameAsSite: boolean | null
    snapshotInvoiceDeliveryMethod: string | null
    deliveryMethodHook: string
    customer: Record<string, unknown> | null
  }
  /** Gate precondition: supply period market_start_at and the first stored value's interval. */
  gate: { marketStartAt: string | null; startDate: string | null; firstIntervalStart: string | null; firstIntervalEnd: string | null; valueCount: number }
  e66: { values: number; persistMs: number; ingestMs: number; messages: Array<{ day: number; sourceId: string; transactionRef: string; values: number; rawSha256: string; receivedAt: string; receivedAtClamped: boolean; documentDate: string; documentDateClamped: boolean; runtime: { ok: boolean; classification: string | null; issues: Array<{ severity: string; kind: string | null; code: string }>; note: string }; persistMs: number; ingestMs: number; totalMs: number; meteringValueIds: string[] }> }
  timingsMs: Record<string, number>
}

const SYNTHETIC_SMTP_ENV: Record<string, string> = {
  EDIEL_SHARED_MAILBOX_ADDRESS: 'synthetic@example.invalid', EDIEL_APP_DKIM_ENABLED: 'false', EMAIL_PROVIDER: 'resend', EDIEL_EMAIL_PROVIDER: 'strato',
  EDIEL_SMTP_FROM: 'synthetic@example.invalid', EDIEL_SMTP_USER: 'synthetic@example.invalid', EDIEL_SMTP_PASS: 'synthetic-only',
}

/** Accepting SMTP transport for the outbound Z03 (same port the base's native tests inject). */
function syntheticSmtpProvider(email: string): void {
  vi.spyOn(nodemailer, 'createTransport').mockImplementation((() => ({
    sendMail: async () => ({ accepted: [email], rejected: [], messageId: `<synthetic-${randomUUID()}@example.invalid>`, response: '250 synthetic accepted (track 6 fixture)' }),
  })) as unknown as typeof nodemailer.createTransport)
}

// ---------------------------------------------- invoice_delivery_method before signing

type BeforeSign = (input: { companyId: string; customerId: string; contractId: string }) => Promise<void>
declare global { var __t6BeforeSign: BeforeSign | undefined }

/**
 * Called by the vi.mock wrapper of signInvoiceTestContractCanonically (declared in the scenario file): the native seed signs the contract
 * inside seedNormalSwitchNativeFixture, so the only place to choose the contract's invoice_delivery_method is just before that call.
 * SUBSTITUTE: price_snapshot.invoice_delivery_method written by psql on the DRAFT contract (the contract form
 * components/admin/customers/contracts/actions.ts:449,595 normally sets it) -- verifierar inte avtalsformuläret eller offertens leveranssätt.
 */
export function installDeliveryMethodHook(method: 'email' | 'paper', outcome: { note: string }): void {
  globalThis.__t6BeforeSign = async ({ companyId, contractId }) => {
    try {
      sql(`UPDATE public.customer_contracts SET price_snapshot = coalesce(price_snapshot,'{}'::jsonb) || jsonb_build_object('invoice_delivery_method',${literal(method)})
        WHERE id=${literal(contractId)} AND company_id=${literal(companyId)} AND status='draft'`)
      outcome.note = `price_snapshot.invoice_delivery_method=${method} written before signing`
    } catch (error) { outcome.note = `hook_failed:${error instanceof Error ? error.message.slice(0, 300) : String(error)}` }
  }
}
export function clearDeliveryMethodHook(): void { globalThis.__t6BeforeSign = undefined }

// ------------------------------------------------- Z04 L start + due activation

async function activateSwitchSupply(f: Ground): Promise<{ supplyPeriodId: string; sourceId: string }> {
  const smtp = assertEdielSmtpReadiness()
  // SUBSTITUTE: the grid owner's PRODAT Z04 (L) is a synthetic wire (app helper buildCancellationProspectiveZ04) placed in the mailbox tables by
  // seedOriginalMailboxNative instead of an IMAP fetch — verifierar inte nätägarens riktiga Z04, IMAP/S-MIME eller brevlådans hämtning.
  const wire = buildCancellationProspectiveZ04(f), receivedAt = new Date().toISOString()
  const mail = await seedOriginalMailboxNative(sql, literal, { companyId: f.companyId, environment: 'test', raw: wire, receivedAt, smtpFrom: smtp.from })
  // SUBSTITUTE: ACK route/profile for the APERAK/CONTRL replies inserted by psql (as the base's native Z04 tests do) — verifierar inte routeadministrationen.
  const ackRoute = randomUUID(), ackProfile = randomUUID()
  sql(`INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,grid_owner_id,environment_type,is_active,target_email)
    VALUES(${literal(ackRoute)},${literal(f.companyId)},'Synthetic switch ACK route','ediel_ack',${literal(f.gridId)},'bilateral_test',true,'recipient@example.invalid');
    INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,payload_format,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,is_active,transport_security_mode,mailbox,smtp_host,smtp_port,smtp_to,receiver_email)
    VALUES(${literal(ackProfile)},${literal(f.companyId)},${literal(ackRoute)},'Synthetic switch ACK profile','test','edifact','edifact',${literal(f.sender)},${literal(f.receiver)},'23-DDQ-PRODAT',true,true,'unencrypted',${literal(smtp.from)},${literal(smtp.host)},${smtp.port},'recipient@example.invalid','recipient@example.invalid');`)
  const outboundMatch = await matchOutboundRequestForInbound({ companyId: f.companyId, parsed: mail.parsed, inboundEmailMessageId: mail.inboundEmailMessageId, parseResultId: mail.parseResultId })
  const meteringPointMatch = await matchMeteringPointForInbound({ companyId: f.companyId, parsed: mail.parsed })
  const sourceId = await createInboundEdielMessage({ companyId: f.companyId, actorUserId: f.actorUserId, environment: 'test', inboundEmailMessageId: mail.inboundEmailMessageId,
    parseResultId: mail.parseResultId, parsed: mail.parsed, outboundMatch, meteringPointMatch })
  must(sourceId, `delivery01_z04_public_birth_refused:${JSON.stringify({ outboundMatch, meteringPointMatch })}`)
  const message = await getEdielMessageById(sourceId)
  must(message && message.company_id === f.companyId && message.message_code === 'Z04' && message.rule_profile_key === 'PRODAT:Z04:L:26.A:r3',
    `delivery01_z04_source_unexpected:${JSON.stringify(message && { company: message.company_id, code: message.message_code, profile: message.rule_profile_key })}`)
  const decision = await resolveCanonicalRuntimeDecisionWithRegistry(message, { actorUserId: f.actorUserId })
  must([decision.syntaxDecision, decision.applicationDecision, decision.functionalDecision].every(value => value === 'accepted'), `delivery01_z04_not_accepted:${JSON.stringify(decision.issues)}`)
  await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: sourceId })
  const periods = await supabaseService.from('customer_supply_periods').select('id,status,contract_id,metering_point_id,customer_id,start_date,source_process,source_message_id,source_switch_request_id').eq('company_id', f.companyId)
  must(!periods.error, `delivery01_supply_read_failed:${periods.error?.message}`)
  const rows = periods.data ?? []
  must(rows.length === 1, `delivery01_supply_period_count:${rows.length}`)
  const period = rows[0] as Record<string, unknown>
  must(period.source_message_id === sourceId && period.source_switch_request_id === f.switchId && period.source_process === 'supplier_switch_confirmation', `delivery01_supply_period_not_from_switch:${JSON.stringify(period)}`)
  must(period.status === 'confirmed_by_grid_owner' && period.start_date === f.requestedStartDate, `delivery01_supply_period_state:${JSON.stringify(period)}`)
  must(period.contract_id === f.contractId, `delivery01_supply_period_contract_unset:${String(period.contract_id)}`)
  // A confirmed normal start is billable only after its due activation (see track1 FINDINGS 006).
  // SUBSTITUTE: the customer-operations cron route is replaced by a direct call of its supplyMarketDeadlines step, scoped to this tenant
  // — verifierar inte schemaläggningen, cron-autentiseringen eller cronens övriga steg.
  const swept = await advanceSupplyMarketDeadlines({ actorUserId: f.actorUserId, companyId: f.companyId, limit: 10 })
  const activated = sql<number>(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.normal_supply_activations WHERE company_id=${literal(f.companyId)} AND period_id=${literal(period.id)}`)
  if (activated !== 1) {
    const refusal = await supabaseService.rpc('activate_customer_supply_v1', { p_company_id: f.companyId, p_supplier_switch_request_id: f.switchId, p_source_message_id: sourceId, p_actor_user_id: f.actorUserId })
    throw new Error(`delivery01_supply_not_activated:${JSON.stringify({ swept, activated, refusal: refusal.error?.message ?? null })}`)
  }
  return { supplyPeriodId: String(period.id), sourceId }
}

// ----------------------------------------------------------- customer profile

/**
 * SUBSTITUTE: the customer's billing profile (customers.full_name/email/invoice_email/billing_*), the site address and the contract's
 * billing_address_same_as_site flag are written by psql. The seed itself creates customer/site/contract by psql (admin customer intake and
 * contract-from-offer are blocked by claude-track2/004/005), and no normal entry edits customers.billing_* after creation
 * (customer portal profile-update takes invoice_email only; partner API creates but does not update) — verifierar inte kundregistrets
 * redigeringsvyer, portalens/partnerAPI:ts skrivvägar eller kontraktsformuläret. The DB trigger customer_billing_profile_revisions still runs.
 * billing_address_same_as_site is not in the signed-contract immutable key list of gridex_ediel_retention.record_c40a67d5fa7766230451_guard_v1.
 */
function applyCustomerProfile(f: Ground, spec: CustomerSpec): void {
  sql(`UPDATE public.customers SET full_name=${literal(spec.fullName)}, email=${literal(spec.contactEmail)}, invoice_email=${literal(spec.invoiceEmail)},
      billing_street=${literal(spec.billing?.street ?? null)}, billing_postal_code=${literal(spec.billing?.postalCode ?? null)}, billing_city=${literal(spec.billing?.city ?? null)}, billing_country='SE'
    WHERE id=${literal(f.customerId)} AND company_id=${literal(f.companyId)};
    UPDATE public.customer_sites SET street=${literal(spec.site.street)}, postal_code=${literal(spec.site.postalCode)}, city=${literal(spec.site.city)}
    WHERE id=${literal(f.siteId)} AND company_id=${literal(f.companyId)};
    UPDATE public.customer_contracts SET billing_address_same_as_site=false WHERE id=${literal(f.contractId)} AND company_id=${literal(f.companyId)};`)
}

// -------------------------------------------------------------------- UTILTS

type E66Message = CustomerChain['e66']['messages'][number]

async function ingestHourlyE66(f: Ground, salt: number): Promise<CustomerChain['e66']> {
  // SUBSTITUTE: grid_owner_data_requests row inserted by psql — verifierar inte hur en historikbegäran normalt skapas och skickas.
  const dataRequestId = randomUUID()
  sql(`INSERT INTO public.grid_owner_data_requests(id,company_id,customer_id,site_id,metering_point_id,grid_owner_id,request_scope) VALUES(${literal(dataRequestId)},${literal(f.companyId)},${literal(f.customerId)},${literal(f.siteId)},${literal(f.pointId)},${literal(f.gridId)},'billing_underlay')`)
  const dataRequest = { id: dataRequestId, company_id: f.companyId, customer_id: f.customerId, site_id: f.siteId, metering_point_id: f.pointId, grid_owner_id: f.gridId, request_scope: 'billing_underlay', response_payload: {} } as GridOwnerDataRequestRow
  // SUBSTITUTE: grid-owner issuer registry, transport mandate and history ground inserted by psql as the base's native tests do — verifierar inte nätägarregistret eller mandatet.
  registerUtiltsIssuer(sql, literal, f.receiver, f.actorUserId)
  setUtiltsReceiverRole(sql, literal, f.companyId, f.actorUserId, 'E66')

  const messages: E66Message[] = []
  for (const day of DELIVERY01_E66_DAYS) messages.push(await ingestHourlyDay(f, salt, day, dataRequest))
  return {
    values: messages.reduce((n, m) => n + m.values, 0), 
    persistMs: messages.reduce((n, m) => n + m.persistMs, 0), ingestMs: messages.reduce((n, m) => n + m.ingestMs, 0), messages,
  }
}

async function ingestHourlyDay(f: Ground, salt: number, day: number, dataRequest: GridOwnerDataRequestRow): Promise<E66Message> {
  const month = syntheticMonth(DELIVERY01_BILLING_MONTH)
  const dayStarted = Date.now()
  const wire = buildHourlyDayWire({ month, day, salt, companyId: f.companyId, external: f.external, sender: f.sender, receiver: f.receiver })
  const { raw, parsed, txRef, receivedAt } = wire
  const fixtureId = wire.sourceId
  // SUBSTITUTE: inbound mail transport (IMAP fetch, S/MIME, mailbox custody) replaced by a direct ediel_messages insert for the canonical UTILTS E66 profile
  // — verifierar inte mottagning via brevlåda, avkodning eller dubblettskydd i transporten.
  sql(`INSERT INTO public.ediel_messages(id,company_id,customer_id,site_id,metering_point_id,grid_owner_id,grid_owner_data_request_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,message_received_at,execution_context_snapshot,application_reference,sender_ediel_id,receiver_ediel_id,interchange_reference,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
     SELECT ${literal(fixtureId)},${literal(f.companyId)},${[f.customerId, f.siteId, f.pointId, f.gridId, dataRequest.id].map(literal).join(',')},'test','inbound','edifact','UTILTS','E66','received',${literal(raw)},'{}',${literal(receivedAt)},'{}',${literal(parsed.applicationReference)},${literal(f.receiver)},${literal(f.sender)},${literal(parsed.interchangeReference)},pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile
     FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id WHERE profile.message_code='E66' AND profile.direction IN ('inbound','both') AND profile.is_enabled ORDER BY profile.profile_key LIMIT 1;`)
  seedUtiltsIssuerHistoryGround(sql, literal, fixtureId, f.actorUserId)
  const read = await supabaseService.from('ediel_messages').select('*').eq('id', fixtureId).single()
  must(!read.error && read.data, `delivery01_utilts_source_unreadable:${read.error?.message}`)
  const source = read.data as unknown as EdielMessageRow
  await recordUtiltsTechnicalReception(source, f.actorUserId)

  const persistStarted = Date.now()
  const policy = resolveCanonicalMessagePolicy(source)!
  const runtime = await recordUtiltsFinalRuntime(source)
  // The product decides acceptance by validation.ok (= classification 'accepted', utiltsEngine.part-1.ts:938/1347), where only error-severity issues
  // produce a *_rejected classification; warnings never do. Mirror that: fail on error-severity issues or a *_rejected classification. A non-accepted
  // 'internal_review' caused only by warnings (e.g. UTILTS_E66_ENERGY_ONLY_WITHOUT_METER_READING, UTILTS_STRUCTURE_UNAVAILABLE) is NOT a harness failure,
  // but the product's own flow (utiltsDataRequest.part-2.ts:571) would not auto-accept such a message: recorded in the report observations.
  const validation = runtime.validation as { ok: boolean; classification?: string; issues: Array<{ severity: string; code: string; kind?: string }> }
  const blocking = validation.issues.filter(issue => issue.severity === 'error')
  const rejected = typeof validation.classification === 'string' && validation.classification.endsWith('_rejected')
  must(blocking.length === 0 && !rejected, `delivery01_utilts_runtime_blocking:${JSON.stringify({ classification: validation.classification, errors: blocking }).slice(0, 1500)}`)
  const runtimeSummary = { ok: validation.ok, classification: validation.classification ?? null, issues: validation.issues.map(issue => ({ severity: issue.severity, kind: issue.kind ?? null, code: issue.code })),
    note: validation.ok ? 'accepted' : 'NOT accepted by the product (internal_review via warnings only); ingest continued by the fixture (persist + metering sink called directly)' }
  const matches = runtime.facts.transactions.map(t => ({ transactionReference: t.transactionId, meteringPointId: f.pointId, customerId: f.customerId, siteId: f.siteId, gridOwnerId: f.gridId, externalMeteringPointId: t.meterPointId, externalGridAreaId: t.gridAreaId, matchStatus: 'matched' as const }))
  const contracts = await prepareUtiltsConsumptionContracts({ message: source, runtime, policy, matches, dataRequest, fallback: { customerId: f.customerId, siteId: f.siteId, meteringPointId: f.pointId, gridOwnerId: f.gridId }, allowConsumption: true })
  const persistInput: UtiltsBoundPersistenceInput & { actorUserId: string } = { actorUserId: f.actorUserId, companyId: f.companyId, environment: source.environment, sourceMessageId: source.id, messageCode: source.message_code!, rawPayload: source.raw_payload!, contracts,
    transactions: buildUtiltsTransactionPersistencePayload({ messageCode: source.message_code, transactions: runtime.facts.transactions, rawSegments: runtime.facts.rawSegments, dispositions: runtime.transactionDispositions, matches }) }
  const outcomes = await persistUtiltsTransactionResults(persistInput)
  const persistMs = Date.now() - persistStarted

  const ingestStarted = Date.now()
  // SUBSTITUTE: the complete UTILTS processor (processInboundUtiltsMessage: ACK/APERAK creation, request completion, underlay creation) replaced by its
  // persist + metering-sink steps — verifierar inte kvittensflödet, ACK-utkorgen eller att UTILTS-flödet självt skapar underlag.
  const stored = await ingestBoundUtiltsMetering({ actorUserId: f.actorUserId, message: source, boundOutcomes: outcomes })
  const ingestMs = Date.now() - ingestStarted
  must(stored.length === HOURS_PER_DAY, `delivery01_utilts_stored_${stored.length}_expected_${HOURS_PER_DAY}`)
  return { day, sourceId: source.id, transactionRef: txRef, values: wire.values, rawSha256: sha256Hex(raw), receivedAt, receivedAtClamped: wire.receivedAtClamped, documentDate: wire.documentDate, documentDateClamped: wire.documentDateClamped, runtime: runtimeSummary, persistMs, ingestMs, totalMs: Date.now() - dayStarted, meteringValueIds: stored.map(row => row.id) }
}

// ------------------------------------------------------------ chain per customer

function registerSubstitutions(): void {
  substitute({ id: 'tenant-customer-contract-seed', step: 'DELIVERY01 setup: tenant/customer/site/metering point/contract',
    substitute: 'scripts/helpers/ediel-normal-switch-native-fixture.ts (psql inserts + real offer/publication/signature RPCs); ETT eget syntetiskt bolag per kund med eget Ediel-ID (T6SIM 16760 används inte av fixturen)',
    notVerified: 'admin customer intake (claude-track2/004), contract from offer (claude-track2/005), customer-facing signing UI, att fixturen kör i tenant T6SIM/Ediel 16760' })
  substitute({ id: 'z03-smtp-provider', step: 'DELIVERY01 setup: normal supplier switch (Z03 send)',
    substitute: 'vi.spyOn(nodemailer.createTransport) returning an accepting sendMail through the seed provider port',
    notVerified: 'real SMTP provider, TLS, network delivery of the Z03 to the grid owner (inte GreenMail-motparten)' })
  substitute({ id: 'supply-activation', step: 'DELIVERY01 setup: supply period (normal supplier switch)',
    substitute: 'synthetic PRODAT Z04 subtype L answering the sent Z03 (app helper buildCancellationProspectiveZ04) via seedOriginalMailboxNative, then real matchOutboundRequestForInbound/createInboundEdielMessage/processInboundEdielMessage',
    notVerified: 'real grid-owner Z04, IMAP fetch, S/MIME, outbound APERAK/CONTRL delivery' })
  substitute({ id: 'switch-ack-route', step: 'DELIVERY01 setup: supply period', substitute: 'ediel_ack communication_routes/ediel_route_profiles rows inserted by psql', notVerified: 'route administration UI/API' })
  substitute({ id: 'supply-activation-cron', step: 'DELIVERY01 setup: due normal start activation',
    substitute: 'advanceSupplyMarketDeadlines({ actorUserId, companyId }) called in-process (the supplyMarketDeadlines step of /api/internal/customer-operations/cron)',
    notVerified: 'cron scheduling and secret authentication, the other cron steps' })
  substitute({ id: 'actor-permissions-password', step: 'DELIVERY01 setup: operator session',
    substitute: "role_permissions rows on the actor's seed role via psql, password via auth admin API, then a real password login producing app session cookies",
    notVerified: 'role/permission administration UI, invitation and password-reset flows' })
  substitute({ id: 'utilts-issuer-registry', step: 'DELIVERY01 setup: UTILTS issuer', substitute: 'registerUtiltsIssuer / seedUtiltsIssuerHistoryGround (psql inserts)', notVerified: 'real issuer registry onboarding and transport mandate' })
  substitute({ id: 'data-request-row', step: 'DELIVERY01 setup: grid owner data request', substitute: 'grid_owner_data_requests row inserted by psql', notVerified: 'creation/sending of the history request to the grid owner' })
  substitute({ id: 'utilts-transport', step: 'DELIVERY01 setup: hourly UTILTS E66', substitute: 'direct ediel_messages insert for the canonical E66 profile (psql) with the physical test indicator, then real reception/runtime/persistence functions',
    notVerified: 'IMAP/mailbox fetch, S/MIME, transport custody, duplicate screening on reception' })
  substitute({ id: 'utilts-processor', step: 'DELIVERY01 setup: hourly UTILTS E66', substitute: 'persistUtiltsTransactionResults + ingestBoundUtiltsMetering called step by step (processInboundUtiltsMessage not run)',
    notVerified: 'ACK/APERAK/CONTRL creation and queueing, data request completion, billing-underlay creation by the UTILTS flow' })
  substitute({ id: 'customer-billing-profile-psql', step: 'DELIVERY01 setup: customer billing profile / site address / contract billing flag',
    substitute: 'customers.full_name/email/invoice_email/billing_*, customer_sites address and customer_contracts.billing_address_same_as_site written by psql',
    notVerified: 'customer edit views, portal/partner write paths and the contract form (no normal entry edits customers.billing_* after creation)' })
}

export async function buildCustomerChain(spec: CustomerSpec, salt: number): Promise<CustomerChain> {
  registerSubstitutions()
  const timingsMs: Record<string, number> = {}
  const t = async <T>(name: string, action: () => Promise<T>): Promise<T> => { const s = Date.now(); try { return await timed(`${spec.key}: ${name}`, action) } finally { timingsMs[name] = Date.now() - s } }
  for (const [key, value] of Object.entries(SYNTHETIC_SMTP_ENV)) vi.stubEnv(key, value)

  // Seed (own company), with the delivery method written just before signing; one retry without the hook if the hook itself broke the seed.
  const hook = { note: 'not_installed' }
  let ground: Ground
  installDeliveryMethodHook(spec.deliveryMethod, hook)
  try {
    ground = await t('seed tenant + contract + supplier switch (Z03 sent)', () => seedNormalSwitchNativeFixture({ requestedStartDate: DELIVERY01_START_DATE, provider: syntheticSmtpProvider }))
  } catch (error) {
    hook.note = `${hook.note}; seed_failed_with_hook:${error instanceof Error ? error.message.slice(0, 300) : String(error)}; retried_without_hook`
    clearDeliveryMethodHook()
    ground = await t('seed tenant + contract + supplier switch (retry without hook)', () => seedNormalSwitchNativeFixture({ requestedStartDate: DELIVERY01_START_DATE, provider: syntheticSmtpProvider }))
  } finally { clearDeliveryMethodHook() }

  const supply = await t('Z04 L + due activation', () => activateSwitchSupply(ground))
  await t('customer billing profile (psql)', async () => { applyCustomerProfile(ground, spec) })

  // Operator session. Allow grants come only from roles (track1 FINDINGS 005; track4 seed FX02): billing permissions on the actor's seed role.
  const password = `T6-${randomUUID()}`
  const email = `${ground.actorUserId}@example.invalid`
  sql(`INSERT INTO public.role_permissions(role_id,role_key,permission_id,permission_key,effect)
    SELECT r.id,r.key,p.id,p.key,'allow' FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id
      JOIN public.permissions p ON p.key IN('billing_underlay.read','billing_underlay.export','pricing.write')
    WHERE ur.user_id=${literal(ground.actorUserId)} AND ur.company_id=${literal(ground.companyId)} AND ur.status='active' AND ur.is_active
      AND NOT EXISTS(SELECT 1 FROM public.role_permissions x WHERE x.role_id=r.id AND x.permission_id=p.id);`)
  const updated = await supabaseService.auth.admin.updateUserById(ground.actorUserId, { password })
  must(!updated.error, `delivery01_password_failed:${updated.error?.message}`)
  const session = await t('sign in', () => signIn({ email, password, userId: ground.actorUserId, companyId: ground.companyId }))

  const e66 = await t('hourly E66 (4 messages x 24 values)', () => ingestHourlyE66(ground, salt))

  const effective = dbRead<CustomerChain['effective']['customer'] & { __c: boolean | null; __m: string | null }>(`SELECT jsonb_build_object(
      '__c',(SELECT billing_address_same_as_site FROM public.customer_contracts WHERE id=${lit(ground.contractId)}),
      '__m',(SELECT invoice_delivery_method FROM public.contract_price_snapshots WHERE id=(SELECT contract_price_snapshot_id FROM public.customer_contracts WHERE id=${lit(ground.contractId)})),
      'invoice_email',c.invoice_email,'email',c.email,'billing_street',c.billing_street,'billing_postal_code',c.billing_postal_code,'billing_city',c.billing_city,'billing_profile_revision',c.billing_profile_revision)
    FROM public.customers c WHERE c.id=${lit(ground.customerId)}`)
  const { __c, __m, ...customer } = (effective ?? {}) as Record<string, unknown>
  const gate = dbRead<CustomerChain['gate']>(`SELECT jsonb_build_object(
      'marketStartAt',(SELECT market_start_at FROM public.customer_supply_periods WHERE id=${lit(supply.supplyPeriodId)}),
      'startDate',(SELECT start_date FROM public.customer_supply_periods WHERE id=${lit(supply.supplyPeriodId)}),
      'firstIntervalStart',(SELECT min(period_start) FROM public.metering_values WHERE metering_point_id=${lit(ground.pointId)}),
      'firstIntervalEnd',(SELECT period_end FROM public.metering_values WHERE metering_point_id=${lit(ground.pointId)} ORDER BY period_start LIMIT 1),
      'valueCount',(SELECT count(*) FROM public.metering_values WHERE metering_point_id=${lit(ground.pointId)}))`)
  return {
    gate, spec, companyId: ground.companyId, actorUserId: ground.actorUserId, customerId: ground.customerId, siteId: ground.siteId, pointId: ground.pointId, contractId: ground.contractId,
    gridOwnerId: ground.gridId, external: ground.external, ownEdielId: ground.sender, issuerEdielId: ground.receiver, supplyPeriodId: supply.supplyPeriodId, session,
    effective: { contractBillingAddressSameAsSite: (__c as boolean | null) ?? null, snapshotInvoiceDeliveryMethod: (__m as string | null) ?? null, deliveryMethodHook: hook.note, customer },
    e66, timingsMs,
  }
}

// ------------------------------------------------------------------- spot

/**
 * Real importer (lib/pricing/spot/spotPriceImporter.ts importSpotPricesForMonth) with the provider HTTP call replaced by an in-process fetch serving
 * elprisetjustnu-format hourly rows. Everything after the HTTP boundary is the app's own import, coverage validation and verification.
 * SUBSTITUTE (spot-provider): the external provider endpoint — verifierar inte leverantörens API, nätverk eller TLS. Default is synthetic (REALITY_SPOT_SOURCE not used).
 */
export async function importSyntheticSpot(priceArea: 'SE3', salt: number): Promise<{ status: string; errors: string[] }> {
  substitute({ id: 'spot-provider', step: 'DELIVERY01 setup: spot prices', substitute: 'in-process fetchImpl serving synthetic elprisetjustnu-format hourly rows into the real importSpotPricesForMonth',
    notVerified: 'the external provider API and network/TLS handling' })
  const month = syntheticMonth(DELIVERY01_BILLING_MONTH)
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const match = /\/(\d{4})\/(\d{2})-(\d{2})_(SE[1-4])\.json$/.exec(url.pathname)
    if (!url.hostname.endsWith('elprisetjustnu.se') || !match || match[4] !== priceArea || Number(match[1]) !== month.year || Number(match[2]) !== month.month) return new Response('[]', { status: 404 })
    return new Response(JSON.stringify(spotDayPayload(month, Number(match[3]), salt)), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  const result = await importSpotPricesForMonth({ billingMonth: DELIVERY01_BILLING_MONTH, priceAreas: [priceArea], fetchImpl, triggerSource: 'manual', createdBy: null })
  return { status: result.status, errors: result.errors }
}

/** Read-only: is (month, area) already locked, and does every stored hourly price equal this fixture's? (track1 main03Fixture lockedSpotMonthMatches) */
export function lockedSpotMonthMatches(priceArea: 'SE3', salt: number): { locked: boolean; matches: boolean; detail: string } {
  const status = dbRead<string | undefined>(`SELECT to_json(status) FROM public.spot_price_monthly_summaries
    WHERE source='elprisetjustnu' AND price_area=${lit(priceArea)} AND billing_month=${lit(DELIVERY01_BILLING_MONTH)}`)
  if (status !== 'locked') return { locked: false, matches: false, detail: String(status ?? 'absent') }
  const month = syntheticMonth(DELIVERY01_BILLING_MONTH)
  const expected = new Map<number, string>()
  for (let day = 1; day <= month.days; day += 1) for (const row of spotDayPayload(month, day, salt)) expected.set(Date.parse(String(row.time_start)), Number(row.SEK_per_kWh).toFixed(5))
  const stored = dbRead<Array<{ t: string; p: string }>>(`SELECT coalesce(json_agg(json_build_object('t',time_start,'p',round(sek_per_kwh,5)::text) ORDER BY time_start),'[]') FROM public.spot_price_intervals
    WHERE source='elprisetjustnu' AND price_area=${lit(priceArea)} AND time_start>=${lit(new Date(month.startMs).toISOString())} AND time_start<${lit(new Date(month.endMs).toISOString())}`)
  const mismatches = stored.filter(row => expected.get(Date.parse(row.t)) !== Number(row.p).toFixed(5))
  return { locked: true, matches: stored.length === expected.size && mismatches.length === 0, detail: `stored=${stored.length} expected=${expected.size} mismatches=${mismatches.length}` }
}

export async function importAndLockSpot(session: Session, priceArea: 'SE3', salt: number): Promise<{ reused: boolean; detail: string; lock: unknown }> {
  const reuse = lockedSpotMonthMatches(priceArea, salt)
  if (reuse.locked) {
    must(reuse.matches, `delivery01_spot_locked_month_differs:${reuse.detail}`)
    substitute({ id: 'spot-locked-month-reuse', step: 'DELIVERY01 setup: spot prices', substitute: 'month already imported and locked earlier in this stack; all stored hourly rows compared equal before reuse',
      notVerified: 'import and lock-month for this file' })
    return { reused: true, detail: reuse.detail, lock: null }
  }
  const imported = await importSyntheticSpot(priceArea, salt)
  must(imported.errors.length === 0, `delivery01_spot_import_errors:${imported.errors.slice(0, 3).join(' | ')}`)
  const locked = await http(session, 'POST', '/api/internal/spot/lock-month', { json: { billing_month: DELIVERY01_BILLING_MONTH, price_area: priceArea, reason: 'track6 DELIVERY01 fixture settlement lock' } })
  must(locked.status === 200, `delivery01_spot_lock_status_${locked.status}:${JSON.stringify(locked.body)?.slice(0, 400)}`)
  return { reused: false, detail: `imported ${imported.status}`, lock: (locked.body as { data?: unknown } | null)?.data ?? null }
}
