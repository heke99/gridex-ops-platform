// Track 1 fixture builder: one synthetic tenant with one customer, one site and
// one metering point, an active supply period and a signed hourly-spot contract,
// 28 daily synthetic UTILTS E66 files from a synthetic grid owner, hourly local
// spot prices for the whole month, and the independent oracle for it all.
//
// Reusable by MAIN04 / SITE01 through `buildMain03Fixture(params)`. The builder
// accepts the full parameter set the campaign asked for, but the base's native
// seed (scripts/helpers/ediel-normal-switch-native-fixture.ts) hard-codes one
// site, price area SE3, 4 ore markup, 49 SEK monthly fee and contract start
// 2026-10-15; any other value throws `FixtureParamUnsupported` instead of being
// silently ignored (see `assertSupported`). Extending it means writing a second
// native seed, which is out of scope for this first fixture.
//
// ORIGIN of copied/adapted code (base 1c0c088cb4ed66d0dd8b3e34c9606019342a1a56):
//  - scripts/helpers/ediel-requested-change-native-fixture.ts and
//    scripts/ediel-z04l-z04lk-future-start-native.test.ts `receive`/`confirm`
//    (normal supplier switch: sent Z03, Z04 L public birth, processInboundEdielMessage)
//  - scripts/ediel-utilts-consumption-native.test.ts  `seed`/`insertSource`/`prepare`
//    (UTILTS source birth, final runtime, contract preparation, bound persistence)
//  - __tests__/ediel-sc-050-053-utilts-scenarios.test.ts  `day` (a winter 96-quarter
//    E66-T day wire)
// Everything else is new in this harness.
import { createHash, randomUUID } from 'node:crypto'
import { vi } from 'vitest'
import nodemailer from 'nodemailer'
import { seedNormalSwitchNativeFixture, nativeSql as sql, literal } from '@/scripts/helpers/ediel-normal-switch-native-fixture'
import { buildCancellationProspectiveZ04 } from '@/scripts/helpers/ediel-cancellation-prospective-source-2ea'
import { seedOriginalMailboxNative } from '@/scripts/helpers/originalMailboxNative'
import { registerUtiltsIssuer, seedUtiltsIssuerHistoryGround, recordUtiltsFinalRuntime, recordUtiltsTechnicalReception, setUtiltsReceiverRole } from '@/scripts/helpers/utiltsConsumptionParties'
import { buildDayWire } from './wire'
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
import { substitute } from './substitutions'
import { dbRead, http, lit, signIn, timed, type Session } from './runtime'
import { chooseSafeSalt, QUARTERS_PER_DAY, spotDayPayload, syntheticMonth, type Oracle, type OraclePricing } from './synthetic'

export class FixtureParamUnsupported extends Error {
  constructor(param: string, detail: string) { super(`fixture_param_unsupported:${param}:${detail}`) }
}

export type Main03Params = {
  billingMonth: string
  /** Number of sites/metering points. Only 1 is supported by the native seed. */
  sites: number
  priceArea: 'SE1' | 'SE2' | 'SE3' | 'SE4'
  /** Grid owner label (synthetic). The native seed creates one synthetic grid owner; informational. */
  gridOwner: 'synthetic'
  /** Contract/supply start as a Stockholm civil date. */
  contractStartDate: string
  pricing: OraclePricing
  /** Delivery period. Only an open-ended active period is supported. */
  delivery: { kind: 'active' } | { kind: 'ended'; endDate: string }
  /** First salt tried when searching for float-unambiguous oracle data. */
  saltStart: number
}

export const DEFAULT_MAIN03_PARAMS: Main03Params = {
  billingMonth: '2027-02', sites: 1, priceArea: 'SE3', gridOwner: 'synthetic', contractStartDate: '2026-10-15',
  pricing: { spotWeightPercent: 100, markupOrePerKwh: 4, monthlyFeeSek: 49, vatPercent: 25 },
  delivery: { kind: 'active' }, saltStart: 1,
}

function assertSupported(params: Main03Params): void {
  if (params.sites !== 1) throw new FixtureParamUnsupported('sites', 'native seed creates exactly one site/metering point')
  if (params.priceArea !== 'SE3') throw new FixtureParamUnsupported('priceArea', 'native seed fixes price area SE3')
  if (params.contractStartDate !== '2026-10-15') throw new FixtureParamUnsupported('contractStartDate', 'native switch seed and fixture oracle are only verified for 2026-10-15')
  if (params.pricing.markupOrePerKwh !== 4 || params.pricing.monthlyFeeSek !== 49 || params.pricing.vatPercent !== 25 || params.pricing.spotWeightPercent !== 100) {
    throw new FixtureParamUnsupported('pricing', 'native seed fixes spot 100 %, 4 ore/kWh, 49 SEK/month, VAT 25 %')
  }
  if (params.delivery.kind !== 'active') throw new FixtureParamUnsupported('delivery', 'only an open-ended active delivery period is seeded')
}

export type DayRecord = {
  day: number
  sourceId: string
  transactionRef: string
  bgmReference: string
  rawSha256: string
  meteringValueIds: string[]
  normalizedIds: string[]
  persistMs: number
  ingestMs: number
}

export type Main03Fixture = {
  params: Main03Params
  salt: number
  oracle: Oracle
  companyId: string
  actorUserId: string
  customerId: string
  siteId: string
  pointId: string
  contractId: string
  gridOwnerId: string
  supplyPeriodId: string
  /** GSRN of the metering point on the wire. */
  externalPointId: string
  /** Own supplier EDIEL id (UTILTS receiver) and the synthetic grid owner EDIEL id (issuer). */
  ownEdielId: string
  issuerEdielId: string
  dataRequestId: string
  session: Session
  days: DayRecord[]
  spotMonthlyLock: Record<string, unknown>
}

function must(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }

// ------------------------------------------------- normal supplier switch

type Ground = Awaited<ReturnType<typeof seedNormalSwitchNativeFixture>>

const SYNTHETIC_SMTP_ENV: Record<string, string> = {
  EDIEL_SHARED_MAILBOX_ADDRESS: 'synthetic@example.invalid', EDIEL_APP_DKIM_ENABLED: 'false', EMAIL_PROVIDER: 'resend', EDIEL_EMAIL_PROVIDER: 'strato',
  EDIEL_SMTP_FROM: 'synthetic@example.invalid', EDIEL_SMTP_USER: 'synthetic@example.invalid', EDIEL_SMTP_PASS: 'synthetic-only',
}

/**
 * SMTP provider port for the outbound Z03 original, the same port the base's
 * native tests inject (`provider` of seedNormalSwitchNativeFixture). The
 * scenario mocks nodemailer with a bare `vi.fn()` whose undefined result is no
 * provider acceptance, so the transport is replaced by one that accepts.
 */
function syntheticSmtpProvider(email: string): void {
  vi.spyOn(nodemailer, 'createTransport').mockImplementation((() => ({
    sendMail: async () => ({ accepted: [email], rejected: [], messageId: `<synthetic-${randomUUID()}@example.invalid>`, response: '250 synthetic accepted (track 1 fixture)' }),
  })) as unknown as typeof nodemailer.createTransport)
}

/**
 * Normal supplier switch for the seeded signed contract, as in the base's own
 * native tests: the seed (seedNormalSwitchNativeFixture) creates the
 * supplier_switch_requests row for the signed contract, renders, archives,
 * queues and sends the Z03 through prepareAndQueueEdielZ03 +
 * sendEdielMessageViaSmtp. Here the grid owner's Z04 (subtype L) answering that
 * Z03's LI case reference is born through the public inbound creator and then
 * processed by processInboundEdielMessage. The database owner
 * gridex_received_sources.normal_switch_confirm_v1 inserts the supply period
 * with contract_id = the switch request's contract.
 *
 * ORIGIN (base 1c0c088c): scripts/helpers/ediel-requested-change-native-fixture.ts
 * `createRequestedChangeSupplyFixture` (wire + public birth) and
 * scripts/ediel-z04l-z04lk-future-start-native.test.ts `receive`/`confirm`
 * (public birth followed by processInboundEdielMessage, one period with
 * source_switch_request_id). The earlier PRODAT Z04 subtype A (assigned supply,
 * scripts/ediel-at-z04a-assigned-supply-native.test.ts) is the process for a
 * customer WITHOUT a contract; its owner inserts no contract_id by design.
 */
async function activateNormalSwitchSupply(f: Ground): Promise<{ supplyPeriodId: string; sourceId: string; ms: number }> {
  const started = Date.now()
  const smtp = assertEdielSmtpReadiness()
  // SUBSTITUTE: the grid owner's PRODAT Z04 (L) is a synthetic wire (app helper buildCancellationProspectiveZ04) placed in the
  // mailbox tables by seedOriginalMailboxNative instead of an IMAP fetch — verifierar inte nätägarens riktiga Z04, IMAP/S-MIME eller brevlådans hämtning.
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
  must(sourceId, `fixture_z04_public_birth_refused:${JSON.stringify({ outboundMatch, meteringPointMatch })}`)
  const message = await getEdielMessageById(sourceId)
  must(message && message.company_id === f.companyId && message.message_code === 'Z04' && message.rule_profile_key === 'PRODAT:Z04:L:26.A:r3',
    `fixture_z04_source_unexpected:${JSON.stringify(message && { company: message.company_id, code: message.message_code, profile: message.rule_profile_key })}`)
  const decision = await resolveCanonicalRuntimeDecisionWithRegistry(message, { actorUserId: f.actorUserId })
  must([decision.syntaxDecision, decision.applicationDecision, decision.functionalDecision].every(value => value === 'accepted'),
    `fixture_z04_not_accepted:${JSON.stringify(decision.issues)}`)
  await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: sourceId })
  const periods = await supabaseService.from('customer_supply_periods').select('id,status,contract_id,customer_contract_id,metering_point_id,customer_id,start_date,end_date,market_start_at,source_process,source_message_id,source_switch_request_id').eq('company_id', f.companyId)
  must(!periods.error, `fixture_supply_read_failed:${periods.error?.message}`)
  const rows = periods.data ?? []
  must(rows.length === 1, `fixture_supply_period_count:${rows.length}`)
  const period = rows[0] as Record<string, unknown>
  must(period.metering_point_id === f.pointId && period.customer_id === f.customerId, 'fixture_supply_period_wrong_owner')
  must(period.source_message_id === sourceId && period.source_switch_request_id === f.switchId && period.source_process === 'supplier_switch_confirmation',
    `fixture_supply_period_not_from_switch:${JSON.stringify(period)}`)
  must(period.status === 'confirmed_by_grid_owner' && period.start_date === f.requestedStartDate, `fixture_supply_period_state:${JSON.stringify(period)}`)
  // gridex_store_billing_underlay requires supply_period.contract_id = contract.id.
  must(period.contract_id === f.contractId, `fixture_supply_period_contract_unset:${String(period.contract_id)}`)

  // A confirmed normal start is billable only after its due activation: the billing gate
  // (gridex_set_metering_billing_gate -> gridex_received_sources.billing_supply_basis_v1) requires
  // `activated`, i.e. a gridex_received_sources.normal_supply_activations row written by
  // activate_customer_supply_v1. Normally the customer-operations cron
  // (app/api/internal/customer-operations/cron/route.ts step supplyMarketDeadlines) runs
  // advanceSupplyMarketDeadlines -> ediel_advance_supply_deadlines_v1 for the automation actor.
  // SUBSTITUTE: the scheduled cron route (secret, GRIDEX_AUTOMATION_USER_ID, all other cron steps) is replaced by a direct call of its
  // supplyMarketDeadlines step, scoped to this tenant — verifierar inte schemaläggningen, cron-autentiseringen eller cronens övriga steg.
  const swept = await advanceSupplyMarketDeadlines({ actorUserId: f.actorUserId, companyId: f.companyId, limit: 10 })
  const activated = sql<number>(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.normal_supply_activations WHERE company_id=${literal(f.companyId)} AND period_id=${literal(period.id)}`)
  if (activated !== 1) {
    // Diagnostic only: the sweep swallows the owner's refusal. Ask the same owner for its reason.
    const refusal = await supabaseService.rpc('activate_customer_supply_v1', { p_company_id: f.companyId, p_supplier_switch_request_id: f.switchId, p_source_message_id: sourceId, p_actor_user_id: f.actorUserId })
    throw new Error(`fixture_supply_not_activated:${JSON.stringify({ swept, activated, refusal: refusal.error?.message ?? null })}`)
  }
  return { supplyPeriodId: String(period.id), sourceId, ms: Date.now() - started }
}

// ------------------------------------------------------------------- spot

/**
 * Real importer (lib/pricing/spot/spotPriceImporter.ts importSpotPricesForMonth)
 * with the provider HTTP call replaced by an in-process fetch serving
 * elprisetjustnu-format hourly rows. Everything after the HTTP boundary is the
 * app's own import, coverage validation, daily and monthly verification.
 */
async function importSyntheticSpot(params: Main03Params, salt: number): Promise<{ status: string; errors: string[] }> {
  const month = syntheticMonth(params.billingMonth)
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const match = /\/(\d{4})\/(\d{2})-(\d{2})_(SE[1-4])\.json$/.exec(url.pathname)
    if (!url.hostname.endsWith('elprisetjustnu.se') || !match || match[4] !== params.priceArea || Number(match[1]) !== month.year || Number(match[2]) !== month.month) {
      return new Response('[]', { status: 404 })
    }
    return new Response(JSON.stringify(spotDayPayload(month, Number(match[3]), salt)), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  const result = await importSpotPricesForMonth({ billingMonth: params.billingMonth, priceAreas: [params.priceArea], fetchImpl, triggerSource: 'manual', createdBy: null })
  return { status: result.status, errors: result.errors }
}

/** Read-only: is (month, area) already locked, and does every stored hourly price equal this fixture's? */
function lockedSpotMonthMatches(params: Main03Params, salt: number): { locked: boolean; matches: boolean; detail: string } {
  const status = dbRead<string | undefined>(`SELECT to_json(status) FROM public.spot_price_monthly_summaries
    WHERE source='elprisetjustnu' AND price_area=${lit(params.priceArea)} AND billing_month=${lit(params.billingMonth)}`)
  if (status !== 'locked') return { locked: false, matches: false, detail: String(status ?? 'absent') }
  const month = syntheticMonth(params.billingMonth)
  const expected = new Map<number, string>()
  for (let day = 1; day <= month.days; day += 1) {
    for (const row of spotDayPayload(month, day, salt)) expected.set(Date.parse(String(row.time_start)), Number(row.SEK_per_kWh).toFixed(5))
  }
  const stored = dbRead<Array<{ t: string; p: string }>>(`SELECT coalesce(json_agg(json_build_object('t',time_start,'p',round(sek_per_kwh,5)::text) ORDER BY time_start),'[]') FROM public.spot_price_intervals
    WHERE source='elprisetjustnu' AND price_area=${lit(params.priceArea)} AND time_start>=${lit(new Date(month.startMs).toISOString())} AND time_start<${lit(new Date(month.endMs).toISOString())}`)
  const mismatches = stored.filter(row => expected.get(Date.parse(row.t)) !== Number(row.p).toFixed(5))
  const matches = stored.length === expected.size && mismatches.length === 0
  return { locked: true, matches, detail: `stored=${stored.length} expected=${expected.size} mismatches=${mismatches.length}` }
}

// ----------------------------------------------------------------- UTILTS days

function sha256(text: string): string { return createHash('sha256').update(text, 'utf8').digest('hex') }

async function ingestUtiltsDay(input: {
  f: Ground
  month: ReturnType<typeof syntheticMonth>
  salt: number
  day: number
  dataRequest: GridOwnerDataRequestRow
}): Promise<DayRecord> {
  const { f, month, salt, day, dataRequest } = input
  const wire = buildDayWire({ month, day, salt, companyId: f.companyId, external: f.external, sender: f.sender, receiver: f.receiver })
  const { raw, parsed, txRef, bgmRef, receivedAt } = wire
  const fixtureId = wire.sourceId
  // SUBSTITUTE: inbound mail transport (IMAP fetch, S/MIME, mailbox custody) replaced by a direct ediel_messages
  // insert for the canonical UTILTS E66 profile — verifierar inte mottagning via brevlåda, avkodning eller dubblettskydd i transporten.
  sql(`INSERT INTO public.ediel_messages(id,company_id,customer_id,site_id,metering_point_id,grid_owner_id,grid_owner_data_request_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,message_received_at,execution_context_snapshot,application_reference,sender_ediel_id,receiver_ediel_id,interchange_reference,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
     SELECT ${literal(fixtureId)},${literal(f.companyId)},${[f.customerId, f.siteId, f.pointId, f.gridId, dataRequest.id].map(literal).join(',')},'test','inbound','edifact','UTILTS','E66','received',${literal(raw)},'{}',${literal(receivedAt)},'{}',${literal(parsed.applicationReference)},${literal(f.receiver)},${literal(f.sender)},${literal(parsed.interchangeReference)},pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile
     FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id WHERE profile.message_code='E66' AND profile.direction IN ('inbound','both') AND profile.is_enabled ORDER BY profile.profile_key LIMIT 1;`)
  seedUtiltsIssuerHistoryGround(sql, literal, fixtureId, f.actorUserId)
  const read = await supabaseService.from('ediel_messages').select('*').eq('id', fixtureId).single()
  must(!read.error && read.data, `fixture_utilts_source_unreadable:${day}:${read.error?.message}`)
  const source = read.data as unknown as EdielMessageRow
  await recordUtiltsTechnicalReception(source, f.actorUserId)

  const persistStarted = Date.now()
  const policy = resolveCanonicalMessagePolicy(source)!
  const runtime = await recordUtiltsFinalRuntime(source)
  must(runtime.validation.ok, `fixture_utilts_runtime_not_ok:${day}:${JSON.stringify(runtime.validation.issues).slice(0, 800)}`)
  const matches = runtime.facts.transactions.map(t => ({ transactionReference: t.transactionId, meteringPointId: f.pointId, customerId: f.customerId, siteId: f.siteId, gridOwnerId: f.gridId, externalMeteringPointId: t.meterPointId, externalGridAreaId: t.gridAreaId, matchStatus: 'matched' as const }))
  const contracts = await prepareUtiltsConsumptionContracts({ message: source, runtime, policy, matches, dataRequest, fallback: { customerId: f.customerId, siteId: f.siteId, meteringPointId: f.pointId, gridOwnerId: f.gridId }, allowConsumption: true })
  const persistInput: UtiltsBoundPersistenceInput & { actorUserId: string } = { actorUserId: f.actorUserId, companyId: f.companyId, environment: source.environment, sourceMessageId: source.id, messageCode: source.message_code!, rawPayload: source.raw_payload!, contracts,
    transactions: buildUtiltsTransactionPersistencePayload({ messageCode: source.message_code, transactions: runtime.facts.transactions, rawSegments: runtime.facts.rawSegments, dispositions: runtime.transactionDispositions, matches }) }
  const outcomes = await persistUtiltsTransactionResults(persistInput)
  const persistMs = Date.now() - persistStarted

  const ingestStarted = Date.now()
  // SUBSTITUTE: the complete UTILTS processor (processInboundUtiltsMessage: ACK/APERAK creation and queueing, request
  // completion, billing-underlay creation from the data request) replaced by its persist + metering-sink steps — verifierar inte
  // kvittensflödet, ACK-utkorgen eller att UTILTS-flödet självt skapar underlag.
  const stored = await ingestBoundUtiltsMetering({ actorUserId: f.actorUserId, message: source, boundOutcomes: outcomes })
  const ingestMs = Date.now() - ingestStarted
  must(stored.length === QUARTERS_PER_DAY, `fixture_utilts_day_stored_${stored.length}_expected_${QUARTERS_PER_DAY}:${day}`)
  const normalized = await supabaseService.from('normalized_metering_values').select('id').eq('company_id', f.companyId).eq('source_message_id', source.id)
  must(!normalized.error, `fixture_normalized_read_failed:${normalized.error?.message}`)
  return {
    day, sourceId: source.id, transactionRef: txRef, bgmReference: bgmRef, rawSha256: sha256(raw),
    meteringValueIds: stored.map(row => row.id), normalizedIds: (normalized.data ?? []).map(row => String((row as { id: string }).id)), persistMs, ingestMs,
  }
}

// ------------------------------------------------------------------- builder

export async function buildMain03Fixture(overrides: Partial<Main03Params> = {}): Promise<Main03Fixture> {
  const params: Main03Params = { ...DEFAULT_MAIN03_PARAMS, ...overrides, pricing: { ...DEFAULT_MAIN03_PARAMS.pricing, ...overrides.pricing } }
  assertSupported(params)
  const month = syntheticMonth(params.billingMonth)
  const { salt, oracle } = chooseSafeSalt(params.billingMonth, params.saltStart, params.pricing)

  // SUBSTITUTE: customer creation through the admin intake (createCustomerAction) is blocked by finding claude-track2/004,
  // and contract creation from an offer (createContractFromOfferAction) by claude-track2/005; tenant, offer, publication,
  // customer, site, metering point, signed contract and legal documents come from the base's native seed — verifierar inte
  // adminintaget, avtalsskapandet från offert eller kundportalens flöden.
  substitute({ id: 'tenant-customer-contract-seed', step: 'fixture: tenant/customer/site/metering point/contract',
    substitute: 'scripts/helpers/ediel-normal-switch-native-fixture.ts (psql inserts + real offer/publication/signature RPCs)',
    notVerified: 'admin customer intake (claude-track2/004), contract from offer (claude-track2/005), customer-facing signing UI' })
  // SUBSTITUTE: the SMTP provider of the outbound Z03 original is an in-process nodemailer transport that accepts — verifierar inte
  // leverantörens SMTP, TLS eller att Z03 faktiskt når nätägaren.
  substitute({ id: 'z03-smtp-provider', step: 'fixture: normal supplier switch (Z03 send)',
    substitute: 'vi.spyOn(nodemailer.createTransport) returning an accepting sendMail, injected through the seed provider port; the real prepareAndQueueEdielZ03 + sendEdielMessageViaSmtp render, archive and record the send',
    notVerified: 'real SMTP provider, TLS, network delivery of the Z03 to the grid owner' })
  for (const [key, value] of Object.entries(SYNTHETIC_SMTP_ENV)) vi.stubEnv(key, value)
  const ground = await timed('fixture: tenant + contract + supplier switch (Z03 sent)',
    () => seedNormalSwitchNativeFixture({ requestedStartDate: params.contractStartDate, provider: syntheticSmtpProvider }))

  // SUBSTITUTE: the grid owner's confirming PRODAT Z04 (L) is a synthetic wire placed in the mailbox tables (seedOriginalMailboxNative),
  // then the public inbound creator and the real processInboundEdielMessage run — verifierar inte nätägarens riktiga Z04, IMAP/S-MIME eller utgående ACK-leverans.
  substitute({ id: 'supply-activation', step: 'fixture: supply period (normal supplier switch)',
    substitute: 'synthetic PRODAT Z04 subtype L answering the sent Z03 LI case reference (app helper buildCancellationProspectiveZ04), mailbox rows via seedOriginalMailboxNative, then real matchOutboundRequestForInbound/createInboundEdielMessage/processInboundEdielMessage',
    notVerified: 'real grid-owner Z04, IMAP fetch, S/MIME, outbound APERAK/CONTRL delivery (nodemailer is mocked), contract activation on the start day (cron)' })
  substitute({ id: 'switch-ack-route', step: 'fixture: supply period (normal supplier switch)',
    substitute: 'ediel_ack communication_routes/ediel_route_profiles rows inserted by psql (as the base native Z04 tests do)',
    notVerified: 'route administration UI/API' })
  substitute({ id: 'supply-activation-cron', step: 'fixture: supply period (due normal start activation)',
    substitute: 'advanceSupplyMarketDeadlines({ actorUserId, companyId }) called in-process (the supplyMarketDeadlines step of /api/internal/customer-operations/cron), scoped to the fixture tenant',
    notVerified: 'cron scheduling and secret authentication, GRIDEX_AUTOMATION_USER_ID configuration, the other cron steps, the global (unscoped) sweep' })
  const supply = await timed('fixture: normal switch supply activation', () => activateNormalSwitchSupply(ground))

  // SUBSTITUTE: permissions and a password are granted by SQL / the auth admin API — verifierar inte rolladministration eller användarinbjudan.
  substitute({ id: 'actor-permissions-password', step: 'fixture: operator session',
    substitute: 'role_permissions rows on the actor\'s existing seed role via psql, password via auth admin API, then a real password login producing the app session cookies',
    notVerified: 'role/permission administration UI, invitation and password-reset flows' })
  const password = `T1-${randomUUID()}`
  const email = `${ground.actorUserId}@example.invalid`
  // Allow grants come only from roles: canonical_authenticated_tenant_context builds
  // `permissions` from user_roles → role_permissions; user_permissions rows only DENY
  // (supabase/migrations/20261014004020_admin_api_current_context_projection.sql).
  // Compare claude/sim-20261029-track4 @ e986a964, scripts/simulation/track4/fixtures/seed.mjs (FX02).
  // One active role per (company,user) (user_roles_company_user_single_active_uidx), so the
  // three billing permissions are added to the actor's existing seed role.
  sql(`INSERT INTO public.role_permissions(role_id,role_key,permission_id,permission_key,effect)
    SELECT r.id,r.key,p.id,p.key,'allow' FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id
      JOIN public.permissions p ON p.key IN('billing_underlay.read','billing_underlay.export','pricing.write')
    WHERE ur.user_id=${literal(ground.actorUserId)} AND ur.company_id=${literal(ground.companyId)} AND ur.status='active' AND ur.is_active
      AND NOT EXISTS(SELECT 1 FROM public.role_permissions x WHERE x.role_id=r.id AND x.permission_id=p.id);`)
  const updated = await supabaseService.auth.admin.updateUserById(ground.actorUserId, { password })
  must(!updated.error, `fixture_password_failed:${updated.error?.message}`)
  const session = await timed('fixture: sign in', () => signIn({ email, password, userId: ground.actorUserId, companyId: ground.companyId }))

  // Spot prices for the whole month through the app's own importer, then the explicit settlement lock over HTTP.
  // SUBSTITUTE: the provider HTTP endpoint (elprisetjustnu.se) replaced by an in-process fetch with synthetic hourly rows — verifierar inte leverantörens API, nätverk eller TLS.
  substitute({ id: 'spot-provider', step: 'fixture: spot prices', substitute: 'in-process fetchImpl serving synthetic elprisetjustnu-format hourly rows into the real importSpotPricesForMonth',
    notVerified: 'the external provider API, its quarter-hour format and network/TLS handling' })
  // Spot prices are global per price area. A later scenario file in the same stack finds the
  // month already locked (the importer then refuses with locked_market_price_immutable), so a
  // locked month is reused only if every stored hourly price equals this fixture's own value.
  const spotReuse = lockedSpotMonthMatches(params, salt)
  let lockBody: Record<string, unknown> = { status: 'locked', reusedLockedMonth: true, check: spotReuse.detail }
  if (spotReuse.locked) {
    must(spotReuse.matches, `fixture_spot_locked_month_differs:${spotReuse.detail}`)
    substitute({ id: 'spot-locked-month-reuse', step: 'fixture: spot prices',
      substitute: 'month already imported and locked by an earlier fixture run in this stack; all 672 stored hourly rows compared equal to this fixture before reuse',
      notVerified: 'import and lock-month for this file (verified in the run that first locked the month)' })
  } else {
    const imported = await timed('fixture: spot import', () => importSyntheticSpot(params, salt))
    must(imported.errors.length === 0, `fixture_spot_import_errors:${imported.errors.slice(0, 3).join(' | ')}`)
    const locked = await timed('fixture: spot lock-month (HTTP)', () => http(session, 'POST', '/api/internal/spot/lock-month', { json: { billing_month: params.billingMonth, price_area: params.priceArea, reason: 'track1 fixture settlement lock' } }))
    must(locked.status === 200, `fixture_spot_lock_status_${locked.status}:${JSON.stringify(locked.body)?.slice(0, 400)}`)
    lockBody = ((locked.body as { data?: Record<string, unknown> } | null)?.data ?? {}) as Record<string, unknown>
    must(lockBody.status === 'locked', 'fixture_spot_lock_not_locked')
  }

  // UTILTS parties and the synthetic data request, then 28 daily files.
  // SUBSTITUTE: grid-owner issuer registry, transport mandate and history ground are inserted by psql as the base's native tests do — verifierar inte nätägarregistret eller mandatet.
  substitute({ id: 'utilts-issuer-registry', step: 'fixture: UTILTS issuer', substitute: 'registerUtiltsIssuer / seedUtiltsIssuerHistoryGround (psql inserts of a synthetic approved issuer namespace, mandate and absence ground)',
    notVerified: 'real issuer registry onboarding, legal decision and transport mandate' })
  registerUtiltsIssuer(sql, literal, ground.receiver, ground.actorUserId)
  setUtiltsReceiverRole(sql, literal, ground.companyId, ground.actorUserId, 'E66')
  // SUBSTITUTE: grid_owner_data_requests row inserted by psql — verifierar inte hur en historikbegäran normalt skapas och skickas.
  substitute({ id: 'data-request-row', step: 'fixture: grid owner data request', substitute: 'grid_owner_data_requests row (scope billing_underlay) inserted by psql',
    notVerified: 'creation/sending of the history request to the grid owner' })
  const dataRequestId = randomUUID()
  sql(`INSERT INTO public.grid_owner_data_requests(id,company_id,customer_id,site_id,metering_point_id,grid_owner_id,request_scope) VALUES(${literal(dataRequestId)},${literal(ground.companyId)},${literal(ground.customerId)},${literal(ground.siteId)},${literal(ground.pointId)},${literal(ground.gridId)},'billing_underlay')`)
  const dataRequest = { id: dataRequestId, company_id: ground.companyId, customer_id: ground.customerId, site_id: ground.siteId, metering_point_id: ground.pointId, grid_owner_id: ground.gridId, request_scope: 'billing_underlay', response_payload: {} } as GridOwnerDataRequestRow

  substitute({ id: 'utilts-transport', step: 'fixture: 28 daily UTILTS files', substitute: 'direct ediel_messages insert for the canonical E66 profile (psql) with the physical test indicator, then real reception/runtime/persistence functions',
    notVerified: 'IMAP/mailbox fetch, S/MIME, transport custody, duplicate screening on reception' })
  substitute({ id: 'utilts-processor', step: 'fixture: 28 daily UTILTS files', substitute: 'persistUtiltsTransactionResults + ingestBoundUtiltsMetering called step by step (processInboundUtiltsMessage not run)',
    notVerified: 'ACK/APERAK/CONTRL creation and queueing, data request completion, billing-underlay creation by the UTILTS flow, final message status' })
  const days: DayRecord[] = []
  for (let day = 1; day <= month.days; day++) {
    days.push(await timed(`fixture: UTILTS day ${day}`, () => ingestUtiltsDay({ f: ground, month, salt, day, dataRequest })))
  }

  return {
    params, salt, oracle, companyId: ground.companyId, actorUserId: ground.actorUserId, customerId: ground.customerId, siteId: ground.siteId, pointId: ground.pointId,
    contractId: ground.contractId, gridOwnerId: ground.gridId, supplyPeriodId: supply.supplyPeriodId, externalPointId: ground.external, ownEdielId: ground.sender, issuerEdielId: ground.receiver,
    dataRequestId, session, days, spotMonthlyLock: lockBody,
  }
}
