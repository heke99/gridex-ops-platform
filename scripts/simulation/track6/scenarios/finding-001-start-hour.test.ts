// sim: FINDING 20261029-3f1a8ab1/claude-track6/001
// Kandidatfynd 001 (spår 6): den första sommartidstimmen på leveransstartdagen avbryter hela UTILTS-inläsningen.
// Reproduktion, ingen produktändring. Två egna syntetiska bolag (nativa seeden), samma leveransstart 2026-09-30 (Z03/Z04 DTM+92:202609300000:203):
//  (a) ETT E66 för 2026-09-30 med 24 timvärden (exakt DELIVERY01-fixturens form; första timmen = 2026-09-29T22:00Z, före market_start_at 23:00Z).
//  (b) Kontroll: samma E66-form för 2026-10-01 (helt efter leveransstarten).
// Förväntat beteende enligt produktens egna regler (inte antaget av harnessen):
//  - lib/billing/billingGate.ts:286-296: ett värde som leveransperioden inte täcker får skälet `supply_period_does_not_cover_value`
//    ("Leveransperioden täcker inte hela mätvärdesintervallet") och är då inte eligible (status pending_match/blocked, rad 409-416).
//  - lib/billing/meterValueBillingMatcher.ts:174-191: ett ej eligible värde persisteras med sin gate-status och får ett öppet
//    ediel_unresolved_items-ärende; inläsningen fortsätter (lib/ediel/utilts/consumptionSinks.ts:27-48 loopar över alla observationer).
//  - public.gridex_set_metering_billing_gate (DB) kräver för eligible att gridex_received_sources.billing_supply_basis_v1 är qualified,
//    vilket via billing_supply_before_normal_switch_v1 kräver market_start_at <= värdets period_start.
// Defekthypotesen: TS-grinden täcker med start_date i Stockholms lokaltid (billingGate.ts:70-90, 99-111; matcher.ts:117-125) = 22:00Z,
// DB-grinden med market_start_at (PRODAT fast UTC+1, lib/ediel/prodat/render/dates.ts:1) = 23:00Z. Timmen 22:00Z-23:00Z bedöms
// eligible i TS, DB:n vägrar med 23514 och matcher.ts:73 kastar -> consumptionSinks avbryter efter första värdet.
// Kopierad kod: activateSwitchSupply/ingestHourlyE66 ur ../lib/chain/customerChain.ts (1f084e54e; inte exporterade där), parametriserade på dag/månad.
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it, vi, type TestContext } from 'vitest'
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
import { evaluateBillingGate } from '@/lib/billing/billingGate'
import { loadQualifiedBillingValues } from '@/lib/billing/sourceBasis'
import { supabaseService } from '@/lib/supabase/service'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { GridOwnerDataRequestRow } from '@/lib/cis/types'
import { Evidence } from '../lib/evidence'
import { buildHourlyDayWire } from '../lib/chain/hourlyWire'
import { SUBSTITUTIONS, substitute, substitutionObservation } from '../lib/chain/substitutions'
import { dbRead, lit, TIMINGS, timed } from '../lib/chain/runtime'
import { HOURS_PER_DAY, localToUtcMs, stockholmOffsetMinutes, syntheticMonth, type SyntheticMonth } from '../lib/chain/synthetic'

function must(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }

type Ground = Awaited<ReturnType<typeof seedNormalSwitchNativeFixture>>
type CaseKey = 'a' | 'b'

const START_DATE = '2026-09-30'
/** PRODAT DTM+92 202609300000 (format 203, fast UTC+1) = 2026-09-29T23:00:00Z. */
const EXPECTED_MARKET_START = '2026-09-29T23:00:00.000Z'
/** Första timvärdet i case (a): 2026-09-30 00:00 CEST. */
const FIRST_HOUR_A = '2026-09-29T22:00:00.000Z'
const SALT = 1001

/** Månadsgeometri för E66-dagen. 2026-10 innehåller DST-skiftet (25 okt) och avvisas av syntheticMonth; dag 1 ligger i CEST, så offset +120 är korrekt för den dagen. */
function monthFor(key: CaseKey): SyntheticMonth {
  if (key === 'a') return syntheticMonth('2026-09')
  const startMs = localToUtcMs(2026, 10, 1)
  return { billingMonth: '2026-10', year: 2026, month: 10, days: 31, offsetMinutes: stockholmOffsetMinutes(startMs), startMs, endMs: localToUtcMs(2026, 11, 1) }
}
const DAY: Record<CaseKey, number> = { a: 30, b: 1 }

const evidence = new Evidence()
const S = {
  ground: {} as Partial<Record<CaseKey, Ground>>,
  periodId: {} as Partial<Record<CaseKey, string>>,
  ingest: {} as Partial<Record<CaseKey, { threw: boolean; error: string | null; code: string | null; returned: number | null; sourceId: string }>>,
}

const SYNTHETIC_SMTP_ENV: Record<string, string> = {
  EDIEL_SHARED_MAILBOX_ADDRESS: 'synthetic@example.invalid', EDIEL_APP_DKIM_ENABLED: 'false', EMAIL_PROVIDER: 'resend', EDIEL_EMAIL_PROVIDER: 'strato',
  EDIEL_SMTP_FROM: 'synthetic@example.invalid', EDIEL_SMTP_USER: 'synthetic@example.invalid', EDIEL_SMTP_PASS: 'synthetic-only',
}

function syntheticSmtpProvider(email: string): void {
  vi.spyOn(nodemailer, 'createTransport').mockImplementation((() => ({
    sendMail: async () => ({ accepted: [email], rejected: [], messageId: `<synthetic-${randomUUID()}@example.invalid>`, response: '250 synthetic accepted (track 6 finding 001)' }),
  })) as unknown as typeof nodemailer.createTransport)
}

function registerSubstitutions(): void {
  substitute({ id: 'tenant-customer-contract-seed', step: 'FINDING-001 setup: tenant/customer/site/metering point/contract',
    substitute: 'scripts/helpers/ediel-normal-switch-native-fixture.ts (psql inserts + real offer/publication/signature RPCs)', notVerified: 'admin customer intake, contract from offer, signing UI' })
  substitute({ id: 'z03-smtp-provider', step: 'FINDING-001 setup: Z03 send', substitute: 'vi.spyOn(nodemailer.createTransport) accepting sendMail', notVerified: 'real SMTP delivery' })
  substitute({ id: 'supply-activation', step: 'FINDING-001 setup: Z04 L', substitute: 'synthetic PRODAT Z04 L (buildCancellationProspectiveZ04, echoes the sent Z03 start DTM+92) via seedOriginalMailboxNative, then real match/create/process',
    notVerified: 'real grid-owner Z04, IMAP, S/MIME' })
  substitute({ id: 'switch-ack-route', step: 'FINDING-001 setup: Z04 L', substitute: 'ediel_ack route/profile rows by psql', notVerified: 'route administration' })
  substitute({ id: 'supply-activation-cron', step: 'FINDING-001 setup: activation', substitute: 'advanceSupplyMarketDeadlines in-process, tenant-scoped', notVerified: 'cron scheduling/auth' })
  substitute({ id: 'utilts-issuer-registry', step: 'FINDING-001 setup: UTILTS issuer', substitute: 'registerUtiltsIssuer / seedUtiltsIssuerHistoryGround (psql)', notVerified: 'issuer registry onboarding' })
  substitute({ id: 'data-request-row', step: 'FINDING-001 setup: data request', substitute: 'grid_owner_data_requests row by psql', notVerified: 'history request creation/sending' })
  substitute({ id: 'utilts-transport', step: 'FINDING-001: hourly E66', substitute: 'direct ediel_messages insert for the canonical E66 profile (psql)', notVerified: 'mailbox reception, transport custody' })
  substitute({ id: 'utilts-processor', step: 'FINDING-001: hourly E66', substitute: 'persistUtiltsTransactionResults + ingestBoundUtiltsMetering step by step (same sink the processor calls)',
    notVerified: 'ACK/APERAK creation, request completion, underlay creation' })
}

/** Kopia av customerChain.ts activateSwitchSupply (1f084e54e) med samma kontroller. */
async function activateSwitchSupply(f: Ground): Promise<string> {
  const smtp = assertEdielSmtpReadiness()
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
  must(sourceId, `f001_z04_public_birth_refused:${JSON.stringify({ outboundMatch, meteringPointMatch })}`)
  const message = await getEdielMessageById(sourceId)
  must(message && message.company_id === f.companyId && message.message_code === 'Z04' && message.rule_profile_key === 'PRODAT:Z04:L:26.A:r3', 'f001_z04_source_unexpected')
  const decision = await resolveCanonicalRuntimeDecisionWithRegistry(message, { actorUserId: f.actorUserId })
  must([decision.syntaxDecision, decision.applicationDecision, decision.functionalDecision].every(value => value === 'accepted'), `f001_z04_not_accepted:${JSON.stringify(decision.issues)}`)
  await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: sourceId })
  const periods = await supabaseService.from('customer_supply_periods').select('id,status,contract_id,start_date,source_process,source_message_id,source_switch_request_id').eq('company_id', f.companyId)
  must(!periods.error && (periods.data ?? []).length === 1, `f001_supply_period_count:${periods.error?.message ?? (periods.data ?? []).length}`)
  const period = periods.data![0] as Record<string, unknown>
  must(period.source_message_id === sourceId && period.source_switch_request_id === f.switchId && period.status === 'confirmed_by_grid_owner' && period.start_date === START_DATE && period.contract_id === f.contractId,
    `f001_supply_period_state:${JSON.stringify(period)}`)
  const swept = await advanceSupplyMarketDeadlines({ actorUserId: f.actorUserId, companyId: f.companyId, limit: 10 })
  const activated = sql<number>(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.normal_supply_activations WHERE company_id=${literal(f.companyId)} AND period_id=${literal(period.id)}`)
  must(activated === 1, `f001_supply_not_activated:${JSON.stringify({ swept, activated })}`)
  return String(period.id)
}

/** Kopia av customerChain.ts ingestHourlyE66 (1f084e54e), parametriserad på månad/dag. Fångar felet i stället för att kasta, så att utfallet kan registreras. */
async function ingestHourlyE66(f: Ground, month: SyntheticMonth, day: number): Promise<NonNullable<typeof S.ingest.a>> {
  const dataRequestId = randomUUID()
  sql(`INSERT INTO public.grid_owner_data_requests(id,company_id,customer_id,site_id,metering_point_id,grid_owner_id,request_scope) VALUES(${literal(dataRequestId)},${literal(f.companyId)},${literal(f.customerId)},${literal(f.siteId)},${literal(f.pointId)},${literal(f.gridId)},'billing_underlay')`)
  const dataRequest = { id: dataRequestId, company_id: f.companyId, customer_id: f.customerId, site_id: f.siteId, metering_point_id: f.pointId, grid_owner_id: f.gridId, request_scope: 'billing_underlay', response_payload: {} } as GridOwnerDataRequestRow
  registerUtiltsIssuer(sql, literal, f.receiver, f.actorUserId)
  setUtiltsReceiverRole(sql, literal, f.companyId, f.actorUserId, 'E66')
  const wire = buildHourlyDayWire({ month, day, salt: SALT, companyId: f.companyId, external: f.external, sender: f.sender, receiver: f.receiver })
  const { raw, parsed, receivedAt } = wire
  const fixtureId = wire.sourceId
  sql(`INSERT INTO public.ediel_messages(id,company_id,customer_id,site_id,metering_point_id,grid_owner_id,grid_owner_data_request_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,message_received_at,execution_context_snapshot,application_reference,sender_ediel_id,receiver_ediel_id,interchange_reference,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
     SELECT ${literal(fixtureId)},${literal(f.companyId)},${[f.customerId, f.siteId, f.pointId, f.gridId, dataRequest.id].map(literal).join(',')},'test','inbound','edifact','UTILTS','E66','received',${literal(raw)},'{}',${literal(receivedAt)},'{}',${literal(parsed.applicationReference)},${literal(f.receiver)},${literal(f.sender)},${literal(parsed.interchangeReference)},pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile
     FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id WHERE profile.message_code='E66' AND profile.direction IN ('inbound','both') AND profile.is_enabled ORDER BY profile.profile_key LIMIT 1;`)
  seedUtiltsIssuerHistoryGround(sql, literal, fixtureId, f.actorUserId)
  const read = await supabaseService.from('ediel_messages').select('*').eq('id', fixtureId).single()
  must(!read.error && read.data, `f001_utilts_source_unreadable:${read.error?.message}`)
  const source = read.data as unknown as EdielMessageRow
  await recordUtiltsTechnicalReception(source, f.actorUserId)
  const policy = resolveCanonicalMessagePolicy(source)!
  const runtime = await recordUtiltsFinalRuntime(source)
  must(runtime.validation.ok, `f001_utilts_runtime_not_ok:${JSON.stringify(runtime.validation.issues).slice(0, 800)}`)
  const matches = runtime.facts.transactions.map(t => ({ transactionReference: t.transactionId, meteringPointId: f.pointId, customerId: f.customerId, siteId: f.siteId, gridOwnerId: f.gridId, externalMeteringPointId: t.meterPointId, externalGridAreaId: t.gridAreaId, matchStatus: 'matched' as const }))
  const contracts = await prepareUtiltsConsumptionContracts({ message: source, runtime, policy, matches, dataRequest, fallback: { customerId: f.customerId, siteId: f.siteId, meteringPointId: f.pointId, gridOwnerId: f.gridId }, allowConsumption: true })
  const persistInput: UtiltsBoundPersistenceInput & { actorUserId: string } = { actorUserId: f.actorUserId, companyId: f.companyId, environment: source.environment, sourceMessageId: source.id, messageCode: source.message_code!, rawPayload: source.raw_payload!, contracts,
    transactions: buildUtiltsTransactionPersistencePayload({ messageCode: source.message_code, transactions: runtime.facts.transactions, rawSegments: runtime.facts.rawSegments, dispositions: runtime.transactionDispositions, matches }) }
  const outcomes = await persistUtiltsTransactionResults(persistInput)
  must(outcomes.length > 0, 'f001_utilts_no_outcomes')
  // Själva mätobjektet för fyndet: samma sink som processInboundUtiltsMessage anropar.
  try {
    const stored = await ingestBoundUtiltsMetering({ actorUserId: f.actorUserId, message: source, boundOutcomes: outcomes })
    return { threw: false, error: null, code: null, returned: stored.length, sourceId: source.id }
  } catch (error) {
    const e = error as { message?: string; code?: string }
    return { threw: true, error: String(e?.message ?? error).slice(0, 500), code: typeof e?.code === 'string' ? e.code : null, returned: null, sourceId: source.id }
  }
}

type ValueRow = { id: string; period_start: string; period_end: string; billing_status: string | null; billing_gate_status: string | null; supply_period_id: string | null; reasons: unknown }

function valuesFor(companyId: string): ValueRow[] {
  return dbRead<ValueRow[]>(`SELECT coalesce(json_agg(json_build_object('id',id,'period_start',to_char(period_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'period_end',to_char(period_end AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'billing_status',billing_status,'billing_gate_status',billing_gate_status,
      'supply_period_id',supply_period_id,'reasons',billing_gate_reasons) ORDER BY period_start),'[]') FROM public.normalized_metering_values
    WHERE company_id=${lit(companyId)} AND revision_status='current'`)
}

function marketStartFor(periodId: string): string | null {
  return dbRead<string | null>(`SELECT to_json(to_char(market_start_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) FROM public.customer_supply_periods WHERE id=${lit(periodId)}`)
}

function unresolvedFor(companyId: string): Array<Record<string, unknown>> {
  return dbRead<Array<Record<string, unknown>>>(`SELECT coalesce(json_agg(json_build_object('issue_type',issue_type,'status',status,'ids',extracted_identifiers)),'[]') FROM public.ediel_unresolved_items
    WHERE company_id=${lit(companyId)} AND issue_type IN ('billing_period_missing','billing_period_conflict','billing_gate_blocked')`)
}

/** TS-grindens bedömning av ett lagrat värde, med samma indata som meterValueBillingMatcher.ts:117-160 (läsning + ren funktion, ingen skrivning). */
async function tsGateFor(companyId: string, periodId: string, valueId: string) {
  const value = (await loadQualifiedBillingValues(companyId, [valueId])).get(valueId)!
  const period = await supabaseService.from('customer_supply_periods').select('*').eq('id', periodId).eq('company_id', companyId).single()
  must(!period.error, `f001_period_read:${period.error?.message}`)
  const p = period.data as Record<string, unknown>
  const contracts = await supabaseService.from('customer_contracts').select('*').eq('id', String(p.contract_id)).eq('company_id', companyId).limit(2)
  must(!contracts.error, `f001_contract_read:${contracts.error?.message}`)
  const gate = evaluateBillingGate({ normalizedValue: value, supplyPeriod: p, supplyPeriodCandidateCount: 1, contract: contracts.data?.length === 1 ? contracts.data[0] : null,
    contractCandidateCount: contracts.data?.length ?? 0, sourceMessage: value.billing_source_message as Record<string, unknown> | null })
  return { status: gate.status, eligible: gate.eligible, reasons: gate.reasons.map(r => r.code) }
}

function needs(ctx: TestContext, key: CaseKey, what: 'ground' | 'ingest'): void {
  const ok = what === 'ground' ? !!S.periodId[key] : !!S.ingest[key]
  if (ok) return
  const reason = `skipped: förutsättning saknas (${key}:${what})`
  evidence.observe(`skip:${ctx.task.name}`, reason)
  ctx.skip(reason)
}

describe('Track6 FINDING-001: första sommartidstimmen på leveransstartdagen (UTILTS E66 timvärden)', () => {
  afterAll(() => {
    evidence.observe('ERSÄTTNINGSSTEG', SUBSTITUTIONS.map(substitutionObservation))
    evidence.observe('stegtider_ms', TIMINGS)
    evidence.observe('scope', { supplyStart: START_DATE, expectedMarketStartAt: EXPECTED_MARKET_START, caseA: '2026-09-30 (24 h, CEST)', caseB: '2026-10-01 (24 h, CEST)', environment: 'test' })
    evidence.finalize()
  })

  for (const key of ['a', 'b'] as const) {
    it(`FINDING-001 setup ${key}: eget bolag, avtal, Z03, Z04 L (start ${START_DATE}), aktivering (ERSÄTTNINGSSTEG: nativ seed, syntetisk Z04)`, async () => {
      registerSubstitutions()
      for (const [name, value] of Object.entries(SYNTHETIC_SMTP_ENV)) vi.stubEnv(name, value)
      const ground = await timed(`${key}: seed`, () => seedNormalSwitchNativeFixture({ requestedStartDate: START_DATE, provider: syntheticSmtpProvider }))
      S.ground[key] = ground
      const periodId = await timed(`${key}: Z04 L + activation`, () => activateSwitchSupply(ground))
      const marketStart = marketStartFor(periodId)
      evidence.observe(`${key}:supply`, { companyId: ground.companyId, periodId, marketStartAt: marketStart })
      // Förutsättning för fyndet: PRODAT-starten är 00:00 fast UTC+1.
      expect(marketStart).toBe(EXPECTED_MARKET_START)
      S.periodId[key] = periodId
    })
  }

  for (const key of ['a', 'b'] as const) {
    it(`FINDING-001 ${key}: E66 ${key === 'a' ? '2026-09-30' : '2026-10-01'} med 24 timvärden genom ingestBoundUtiltsMetering (utfallet registreras)`, async ctx => {
      needs(ctx, key, 'ground')
      const ground = S.ground[key]!
      const result = await timed(`${key}: E66 ingest`, () => ingestHourlyE66(ground, monthFor(key), DAY[key]))
      S.ingest[key] = result
      const rows = valuesFor(ground.companyId)
      const byGate: Record<string, number> = {}
      for (const row of rows) byGate[`${row.billing_status}/${row.billing_gate_status}`] = (byGate[`${row.billing_status}/${row.billing_gate_status}`] ?? 0) + 1
      evidence.observe(`${key}:ingest`, { ...result, normalizedRows: rows.length, byGate, first: rows[0] ?? null, unresolved: unresolvedFor(ground.companyId) })
      evidence.save(`finding-001/${key}-normalized.json`, rows)
    })
  }

  it('FINDING-001 a: TS-grindens bedömning av timmen 22:00Z (samma indata som matcher.ts:117-160) och DB-raden', async ctx => {
    needs(ctx, 'a', 'ingest')
    const ground = S.ground.a!
    const first = valuesFor(ground.companyId).find(row => row.period_start === FIRST_HOUR_A)
    evidence.observe('a:hour22Z_row', first ?? '(saknas)')
    must(first, 'f001_a_first_hour_row_missing')
    const ts = await tsGateFor(ground.companyId, S.periodId.a!, first.id)
    evidence.observe('a:hour22Z_ts_gate', ts)
    // Produktregel (billingGate.ts:286-296): ett värde före leveransstarten ska bära supply_period_does_not_cover_value och inte vara eligible.
    // Med start_date i lokaltid täcks timmen (22:00Z = 00:00 CEST), trots att market_start_at är 23:00Z. Faller detta = TS/DB-oenighet bekräftad.
    expect(ts.eligible).toBe(false)
    expect(ts.reasons).toContain('supply_period_does_not_cover_value')
  })

  it('FINDING-001 a: förväntat enligt produktreglerna -- inläsningen avbryts inte, 24 rader, 22:00Z-timmen ej billable, öppet ärende', async ctx => {
    needs(ctx, 'a', 'ingest')
    const ground = S.ground.a!
    const result = S.ingest.a!
    const rows = valuesFor(ground.companyId)
    const first = rows.find(row => row.period_start === FIRST_HOUR_A)
    // Faller här med billing_gate_qualified_supply_source_required och 1 rad = kandidatfynd 001 reproducerat.
    expect(result.error).toBeNull()
    expect(result.threw).toBe(false)
    expect(rows).toHaveLength(HOURS_PER_DAY)
    expect(first?.billing_gate_status).not.toBe('eligible')
    expect(['pending_match', 'blocked']).toContain(first?.billing_status)
    expect(rows.filter(row => row.period_start >= EXPECTED_MARKET_START).every(row => row.billing_gate_status === 'eligible' && row.billing_status === 'billable')).toBe(true)
    expect(unresolvedFor(ground.companyId).length).toBeGreaterThanOrEqual(1)
  })

  it('FINDING-001 b (kontroll): E66 helt efter leveransstarten -- 24 rader, alla eligible/billable, ingen DB-vägran', async ctx => {
    needs(ctx, 'b', 'ingest')
    const ground = S.ground.b!
    const result = S.ingest.b!
    const rows = valuesFor(ground.companyId)
    expect(result.error).toBeNull()
    expect(result.returned).toBe(HOURS_PER_DAY)
    expect(rows).toHaveLength(HOURS_PER_DAY)
    expect(rows[0]?.period_start).toBe('2026-09-30T22:00:00.000Z')
    expect(rows.every(row => row.billing_gate_status === 'eligible' && row.billing_status === 'billable')).toBe(true)
    expect(unresolvedFor(ground.companyId)).toHaveLength(0)
  })
})
