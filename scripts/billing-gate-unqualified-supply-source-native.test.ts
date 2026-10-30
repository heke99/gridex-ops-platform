// sim: 20261029-3f1a8ab1/claude-track6/001
// The database billing gate (gridex_set_metering_billing_gate) additionally requires a qualified Ediel market basis
// for the matched supply period over the value's interval. In summer the first civil hour of a supply start day
// (22:00Z-23:00Z) lies before the received market start (00:00 fixed normal time = 23:00Z): the TS gate judges it
// eligible, the database refuses with 23514 billing_gate_qualified_supply_source_required. Before the fix that one
// refusal aborted the whole UTILTS ingest (1 of 24 hourly values stored). Now the database stays the authority: that
// value is stored blocked with supply_source_unqualified and one open item, and the remaining values are gated.
// The start-instant matching itself is unchanged here (finding 001 part (b) is on hold).
import { createHash, randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import nodemailer from 'nodemailer'
import { seedNormalSwitchNativeFixture, nativeSql as sql, literal } from '@/scripts/helpers/ediel-normal-switch-native-fixture'
import { buildCancellationProspectiveZ04 } from '@/scripts/helpers/ediel-cancellation-prospective-source-2ea'
import { seedOriginalMailboxNative } from '@/scripts/helpers/originalMailboxNative'
import { registerUtiltsIssuer, seedUtiltsIssuerHistoryGround, recordUtiltsFinalRuntime, recordUtiltsTechnicalReception, setUtiltsReceiverRole } from '@/scripts/helpers/utiltsConsumptionParties'
import { energyHandoffMessage } from '@/__tests__/helpers/utiltsObservationHandoff'
import { utiltsNativeSourceFixture, utiltsRecountUnt, utiltsTestEnvironmentWire } from '@/__tests__/helpers/utiltsNativeSourceFixture'
import { assertEdielSmtpReadiness } from '@/lib/ediel/mailReadiness'
import { processInboundEdielMessage } from '@/lib/ediel/flows/inboundProcessing'
import { advanceSupplyMarketDeadlines } from '@/lib/ediel/flows/supplyMarketTransition'
import { createInboundEdielMessage } from '@/lib/inbound-mail/inboundStatusUpdater'
import { matchOutboundRequestForInbound, matchMeteringPointForInbound } from '@/lib/inbound-mail/inboundMatcher'
import { getEdielMessageById } from '@/lib/ediel/db'
import { resolveCanonicalRuntimeDecisionWithRegistry } from '@/lib/ediel/core/runtimeDecision'
import { resolveCanonicalMessagePolicy } from '@/lib/ediel/core/messagePolicy'
import { prepareUtiltsConsumptionContracts } from '@/lib/ediel/utilts/consumptionPreparation'
import { buildUtiltsTransactionPersistencePayload, persistUtiltsTransactionResults, type UtiltsBoundPersistenceInput, type UtiltsTransactionPersistenceResult } from '@/lib/ediel/utilts/transactionPersistence'
import { ingestBoundUtiltsMetering } from '@/lib/ediel/utilts/consumptionSinks'
import { updateMeterValueBillingReadiness } from '@/lib/billing/meterValueBillingMatcher'
import { supabaseService } from '@/lib/supabase/service'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { GridOwnerDataRequestRow, MeteringValueRow } from '@/lib/cis/types'

function must(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }
type Ground = Awaited<ReturnType<typeof seedNormalSwitchNativeFixture>>

const HOURS = 24
const SMTP_ENV: Record<string, string> = {
  EDIEL_SHARED_MAILBOX_ADDRESS: 'synthetic@example.invalid', EDIEL_APP_DKIM_ENABLED: 'false', EMAIL_PROVIDER: 'resend', EDIEL_EMAIL_PROVIDER: 'strato',
  EDIEL_SMTP_FROM: 'synthetic@example.invalid', EDIEL_SMTP_USER: 'synthetic@example.invalid', EDIEL_SMTP_PASS: 'synthetic-only',
}

// ---- Stockholm calendar geometry (Intl only, no app code) ----
function stockholmOffsetMinutes(utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Stockholm', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(utcMs))
  const get = (type: string) => Number(parts.find(part => part.type === type)!.value)
  return Math.round((Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - Math.floor(utcMs / 1000) * 1000) / 60000)
}
const pad2 = (value: number) => String(value).padStart(2, '0')
/** Local `YYYYMMDDHHmm` for a local day and minute of day (1440 = next day 00:00). */
function localStamp(year: number, month: number, day: number, minuteOfDay: number): string {
  const date = new Date(Date.UTC(year, month - 1, day, 0, minuteOfDay))
  return `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}`
}
function offsetAtLocalNoon(year: number, month: number, day: number): number {
  const naive = Date.UTC(year, month - 1, day, 12)
  return stockholmOffsetMinutes(naive - stockholmOffsetMinutes(naive) * 60000)
}
/** Canonical UTILTS decimal (no trailing zeros) for one synthetic hourly quantity, 0.2-0.43 kWh. */
const hourQuantity = (hour: number) => String((200 + hour * 10) / 1000)
const edifactOffset = (minutes: number) => `${minutes < 0 ? '-' : '+'}${pad2(Math.floor(Math.abs(minutes) / 60))}${pad2(Math.abs(minutes) % 60)}`

/** One synthetic UTILTS E66 with 24 hourly values (DTM+354:1:805) for one local day, issued by the fixture's grid owner. */
function hourlyDayWire(f: Ground, year: number, month: number, day: number) {
  const offset = offsetAtLocalNoon(year, month, day)
  const base = energyHandoffMessage('2026-10-01', f.companyId)
  const lines = base.raw_payload!.split('\n')
  const at = lines.findIndex(entry => entry.startsWith('SEQ+'))
  const startStamp = localStamp(year, month, day, 0), endStamp = localStamp(year, month, day, 24 * 60)
  const txRef = `H${createHash('sha256').update(`${f.companyId}:${f.external}:${year}-${month}-${day}`).digest('hex').slice(0, 15).toUpperCase()}`
  const sourceId = randomUUID()
  const nextDay = endStamp.slice(0, 8)
  const plannedMs = Date.UTC(Number(nextDay.slice(0, 4)), Number(nextDay.slice(4, 6)) - 1, Number(nextDay.slice(6, 8)), 6, 0) - offset * 60000
  const documentLocal = new Date(Math.min(plannedMs, Date.now() - 120000) + offset * 60000)
  const documentStamp = `${documentLocal.getUTCFullYear()}${pad2(documentLocal.getUTCMonth() + 1)}${pad2(documentLocal.getUTCDate())}${pad2(documentLocal.getUTCHours())}${pad2(documentLocal.getUTCMinutes())}`
  const head = lines.slice(0, at).map(entry => entry
    .replace("DTM+735:?+0200:406'", `DTM+735:?${edifactOffset(offset)}:406'`)
    .replace(/DTM\+137:\d{12}:203/, `DTM+137:${documentStamp}:203`)
    .replace('202607010000202607010015:719', `${startStamp}${endStamp}:719`)
    .replace('DTM+597:202607010020:203', `DTM+597:${endStamp}:203`)
    .replace("DTM+354:15:806'", "DTM+354:1:805'")
    .replace('IDE+24+GRIDEX2607E66001', `IDE+24+${txRef}`)
    .replace('735999260731000007', f.external)
    .replace(/^(UNB\+UNOC:3\+[^+]*\+[^+]*\+)260831:1811/, `$1${documentStamp.slice(2, 8)}:${documentStamp.slice(8, 12)}`)
    .replace(/(BGM\+[^+']*\+)[^+']+/, `$1M${sourceId.replaceAll('-', '').slice(0, 20)}`)
    .replaceAll('+91100:ZZ+', `+${f.receiver}:ZZ+`).replaceAll('NAD+MS+91100:', `NAD+MS+${f.receiver}:`)
    .replaceAll('+21660:ZZ+', `+${f.sender}:ZZ+`).replaceAll('NAD+MR+21660:', `NAD+MR+${f.sender}:`))
  const observations: string[] = []
  for (let hour = 0; hour < HOURS; hour++) observations.push(`SEQ++${hour + 1}'`, `QTY+136:${hourQuantity(hour)}'`, `DTM+597:${localStamp(year, month, day, hour * 60)}:203'`, "STS+7++21::260'")
  const fixture = utiltsNativeSourceFixture(utiltsRecountUnt(utiltsTestEnvironmentWire([...head, ...observations, "UNT+0+1'", lines[lines.length - 1]].join('\n'))), sourceId)
  const receivedMs = Date.UTC(Number(nextDay.slice(0, 4)), Number(nextDay.slice(4, 6)) - 1, Number(nextDay.slice(6, 8)), 6, 30) - offset * 60000
  return { sourceId, raw: fixture.raw, parsed: fixture.parsed, receivedAt: new Date(Math.min(receivedMs, Date.now() - 60000)).toISOString() }
}

// ---- Supply: real Z03 (fixture) + synthetic grid-owner Z04 L + real activation ----
async function activatedSupply(startDate: string): Promise<{ f: Ground; periodId: string }> {
  for (const [name, value] of Object.entries(SMTP_ENV)) vi.stubEnv(name, value)
  const f = await seedNormalSwitchNativeFixture({ requestedStartDate: startDate, provider: email => {
    vi.spyOn(nodemailer, 'createTransport').mockImplementation((() => ({ sendMail: async () => ({ accepted: [email], rejected: [], messageId: `<synthetic-${randomUUID()}@example.invalid>`, response: '250 synthetic' }) })) as unknown as typeof nodemailer.createTransport)
  } })
  const smtp = assertEdielSmtpReadiness()
  const mail = await seedOriginalMailboxNative(sql, literal, { companyId: f.companyId, environment: 'test', raw: buildCancellationProspectiveZ04(f), receivedAt: new Date().toISOString(), smtpFrom: smtp.from })
  const ackRoute = randomUUID(), ackProfile = randomUUID()
  sql(`INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,grid_owner_id,environment_type,is_active,target_email)
    VALUES(${literal(ackRoute)},${literal(f.companyId)},'Synthetic switch ACK route','ediel_ack',${literal(f.gridId)},'bilateral_test',true,'recipient@example.invalid');
    INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,payload_format,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,is_active,transport_security_mode,mailbox,smtp_host,smtp_port,smtp_to,receiver_email)
    VALUES(${literal(ackProfile)},${literal(f.companyId)},${literal(ackRoute)},'Synthetic switch ACK profile','test','edifact','edifact',${literal(f.sender)},${literal(f.receiver)},'23-DDQ-PRODAT',true,true,'unencrypted',${literal(smtp.from)},${literal(smtp.host)},${smtp.port},'recipient@example.invalid','recipient@example.invalid');`)
  const outboundMatch = await matchOutboundRequestForInbound({ companyId: f.companyId, parsed: mail.parsed, inboundEmailMessageId: mail.inboundEmailMessageId, parseResultId: mail.parseResultId })
  const meteringPointMatch = await matchMeteringPointForInbound({ companyId: f.companyId, parsed: mail.parsed })
  const sourceId = await createInboundEdielMessage({ companyId: f.companyId, actorUserId: f.actorUserId, environment: 'test', inboundEmailMessageId: mail.inboundEmailMessageId, parseResultId: mail.parseResultId, parsed: mail.parsed, outboundMatch, meteringPointMatch })
  must(sourceId, `z04_public_birth_refused:${JSON.stringify({ outboundMatch, meteringPointMatch })}`)
  const message = await getEdielMessageById(sourceId)
  must(message && message.company_id === f.companyId && message.message_code === 'Z04', 'z04_source_unexpected')
  const decision = await resolveCanonicalRuntimeDecisionWithRegistry(message, { actorUserId: f.actorUserId })
  must([decision.syntaxDecision, decision.applicationDecision, decision.functionalDecision].every(value => value === 'accepted'), `z04_not_accepted:${JSON.stringify(decision.issues)}`)
  await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: sourceId })
  const periods = await supabaseService.from('customer_supply_periods').select('id,status,start_date,contract_id').eq('company_id', f.companyId)
  must(!periods.error && periods.data?.length === 1, `supply_period_count:${periods.error?.message ?? periods.data?.length}`)
  const period = periods.data[0] as { id: string; status: string; start_date: string; contract_id: string }
  must(period.status === 'confirmed_by_grid_owner' && period.start_date === startDate && period.contract_id === f.contractId, `supply_period_state:${JSON.stringify(period)}`)
  await advanceSupplyMarketDeadlines({ actorUserId: f.actorUserId, companyId: f.companyId, limit: 10 })
  must(sql<number>(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.normal_supply_activations WHERE company_id=${literal(f.companyId)} AND period_id=${literal(period.id)}`) === 1, 'supply_not_activated')
  return { f, periodId: period.id }
}

type Received = { source: EdielMessageRow; outcomes: UtiltsTransactionPersistenceResult[]; readIn: number }
/** The UTILTS processor's steps up to the metering sink: reception, final runtime, bound contracts, transaction persistence. */
async function receiveHourlyE66(f: Ground, year: number, month: number, day: number): Promise<Received> {
  const dataRequestId = randomUUID()
  sql(`INSERT INTO public.grid_owner_data_requests(id,company_id,customer_id,site_id,metering_point_id,grid_owner_id,request_scope) VALUES(${[dataRequestId, f.companyId, f.customerId, f.siteId, f.pointId, f.gridId].map(literal).join(',')},'billing_underlay')`)
  const dataRequest = { id: dataRequestId, company_id: f.companyId, customer_id: f.customerId, site_id: f.siteId, metering_point_id: f.pointId, grid_owner_id: f.gridId, request_scope: 'billing_underlay', response_payload: {} } as GridOwnerDataRequestRow
  registerUtiltsIssuer(sql, literal, f.receiver, f.actorUserId)
  setUtiltsReceiverRole(sql, literal, f.companyId, f.actorUserId, 'E66')
  const wire = hourlyDayWire(f, year, month, day)
  sql(`INSERT INTO public.ediel_messages(id,company_id,customer_id,site_id,metering_point_id,grid_owner_id,grid_owner_data_request_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,message_received_at,execution_context_snapshot,application_reference,sender_ediel_id,receiver_ediel_id,interchange_reference,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
     SELECT ${literal(wire.sourceId)},${[f.companyId, f.customerId, f.siteId, f.pointId, f.gridId, dataRequestId].map(literal).join(',')},'test','inbound','edifact','UTILTS','E66','received',${literal(wire.raw)},'{}',${literal(wire.receivedAt)},'{}',${literal(wire.parsed.applicationReference)},${literal(f.receiver)},${literal(f.sender)},${literal(wire.parsed.interchangeReference)},pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile
     FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id WHERE profile.message_code='E66' AND profile.direction IN ('inbound','both') AND profile.is_enabled ORDER BY profile.profile_key LIMIT 1;`)
  seedUtiltsIssuerHistoryGround(sql, literal, wire.sourceId, f.actorUserId)
  const read = await supabaseService.from('ediel_messages').select('*').eq('id', wire.sourceId).single()
  must(!read.error && read.data, `utilts_source_unreadable:${read.error?.message}`)
  const source = read.data as unknown as EdielMessageRow
  await recordUtiltsTechnicalReception(source, f.actorUserId)
  const runtime = await recordUtiltsFinalRuntime(source)
  must(runtime.validation.ok, `utilts_runtime_not_ok:${JSON.stringify(runtime.validation.issues).slice(0, 800)}`)
  const matches = runtime.facts.transactions.map(t => ({ transactionReference: t.transactionId, meteringPointId: f.pointId, customerId: f.customerId, siteId: f.siteId, gridOwnerId: f.gridId, externalMeteringPointId: t.meterPointId, externalGridAreaId: t.gridAreaId, matchStatus: 'matched' as const }))
  const contracts = await prepareUtiltsConsumptionContracts({ message: source, runtime, policy: resolveCanonicalMessagePolicy(source)!, matches, dataRequest, fallback: { customerId: f.customerId, siteId: f.siteId, meteringPointId: f.pointId, gridOwnerId: f.gridId }, allowConsumption: true })
  const persistInput: UtiltsBoundPersistenceInput & { actorUserId: string } = { actorUserId: f.actorUserId, companyId: f.companyId, environment: source.environment, sourceMessageId: source.id, messageCode: source.message_code!, rawPayload: source.raw_payload!, contracts,
    transactions: buildUtiltsTransactionPersistencePayload({ messageCode: source.message_code, transactions: runtime.facts.transactions, rawSegments: runtime.facts.rawSegments, dispositions: runtime.transactionDispositions, matches }) }
  const outcomes = await persistUtiltsTransactionResults(persistInput)
  must(outcomes.length > 0, 'utilts_no_outcomes')
  const readIn = contracts.reduce((sum, contract) => sum + contract.observations.length, 0)
  return { source, outcomes, readIn }
}

async function ingest(f: Ground, received: Received): Promise<{ error: string | null; returned: number | null }> {
  try {
    const stored = await ingestBoundUtiltsMetering({ actorUserId: f.actorUserId, message: received.source, boundOutcomes: received.outcomes })
    return { error: null, returned: stored.length }
  } catch (error) {
    return { error: String((error as { message?: unknown })?.message ?? error), returned: null }
  }
}

type ValueState = { id: string; source_metering_value_id: string; period_start: string; billing_status: string | null; billing_gate_status: string | null; supply_period_id: string | null; reasons: string[] }
function values(companyId: string): ValueState[] {
  return sql<ValueState[]>(`SELECT coalesce(json_agg(json_build_object('id',id,'source_metering_value_id',source_metering_value_id,'period_start',to_char(period_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'billing_status',billing_status,'billing_gate_status',billing_gate_status,'supply_period_id',supply_period_id,
    'reasons',(SELECT coalesce(json_agg(r->>'code' ORDER BY r->>'code'),'[]') FROM jsonb_array_elements(coalesce(billing_gate_reasons,'[]'::jsonb)) r)) ORDER BY period_start,id),'[]')
    FROM public.normalized_metering_values WHERE company_id=${literal(companyId)} AND revision_status='current'`)
}
function openItems(companyId: string): Array<{ id: string; issue_type: string; ids: Record<string, unknown> }> {
  return sql(`SELECT coalesce(json_agg(json_build_object('id',id,'issue_type',issue_type,'ids',extracted_identifiers) ORDER BY id),'[]') FROM public.ediel_unresolved_items
    WHERE company_id=${literal(companyId)} AND status='open' AND issue_type IN ('billing_period_missing','billing_period_conflict','billing_gate_blocked')`)
}
function tenantSnapshot(companyId: string) {
  return sql<unknown>(`SELECT jsonb_build_object(
    'values',(SELECT coalesce(jsonb_agg(to_jsonb(v) - 'updated_at' ORDER BY v.id),'[]') FROM public.normalized_metering_values v WHERE v.company_id=${literal(companyId)}),
    'raw',(SELECT coalesce(jsonb_agg(to_jsonb(m) - 'updated_at' ORDER BY m.id),'[]') FROM public.metering_values m WHERE m.company_id=${literal(companyId)}),
    'periods',(SELECT coalesce(jsonb_agg(to_jsonb(p) - 'updated_at' ORDER BY p.id),'[]') FROM public.customer_supply_periods p WHERE p.company_id=${literal(companyId)}),
    'items',(SELECT coalesce(jsonb_agg(to_jsonb(i) - 'updated_at' ORDER BY i.id),'[]') FROM public.ediel_unresolved_items i WHERE i.company_id=${literal(companyId)}))`)
}
const tally = (rows: ValueState[]) => rows.reduce<Record<string, number>>((acc, row) => ({ ...acc, [`${row.billing_status}/${row.billing_gate_status}`]: (acc[`${row.billing_status}/${row.billing_gate_status}`] ?? 0) + 1 }), {})

const WINTER_START = '2026-10-28'
const S: { winter?: { f: Ground; periodId: string; received: Received; result: Awaited<ReturnType<typeof ingest>> }; winterSnapshot?: unknown; summer?: { f: Ground; periodId: string; received: Received }; summerFirst?: ValueState[]; summerItems?: ReturnType<typeof openItems> } = {}

/** Tenant B / winter control: supply from WINTER_START (CET, after the 2026-10-25 DST change, inside the E66 rule-pack basis), E66 for that day. Created once. */
async function winterTenant(): Promise<NonNullable<typeof S.winter>> {
  if (S.winter) return S.winter
  const { f, periodId } = await activatedSupply(WINTER_START)
  const received = await receiveHourlyE66(f, 2026, 10, 28)
  const result = await ingest(f, received)
  S.winter = { f, periodId, received, result }
  S.winterSnapshot = tenantSnapshot(f.companyId)
  return S.winter
}

describe('billing gate: a database refusal for an unqualified supply source blocks one value, not the UTILTS ingest (sim 001a)', () => {
  it(`(b) winter start ${WINTER_START} (CET, market start = local midnight): E66 for the start day, all 24 values billable, no open item`, async () => {
    const winter = await winterTenant()
    const { f, periodId, received } = winter
    expect(sql<string>(`SELECT to_json(to_char(market_start_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')) FROM public.customer_supply_periods WHERE id=${literal(periodId)}`)).toBe('2026-10-27T23:00:00Z')
    expect(received.readIn).toBe(HOURS)
    expect(winter.result).toEqual({ error: null, returned: HOURS })
    const rows = values(f.companyId)
    expect(rows).toHaveLength(HOURS)
    expect(tally(rows)).toEqual({ 'billable/eligible': HOURS })
    expect(rows.every(row => row.supply_period_id === periodId)).toBe(true)
    expect(openItems(f.companyId)).toEqual([])
  })

  it('(a) summer start 2026-09-30: E66 for the start day, ingest completes, 24 read = 24 persisted, 1 blocked supply_source_unqualified, 23 billable, one open item', async () => {
    const { f, periodId } = await activatedSupply('2026-09-30')
    expect(sql<string>(`SELECT to_json(to_char(market_start_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')) FROM public.customer_supply_periods WHERE id=${literal(periodId)}`)).toBe('2026-09-29T23:00:00Z')
    const received = await receiveHourlyE66(f, 2026, 9, 30)
    S.summer = { f, periodId, received }
    expect(received.readIn).toBe(HOURS)
    const result = await ingest(f, received)
    expect(result).toEqual({ error: null, returned: HOURS })
    const rows = values(f.companyId)
    // No value is lost: every observation read in is persisted as a current normalized value.
    expect(rows).toHaveLength(received.readIn)
    expect(tally(rows)).toEqual({ 'blocked/blocked': 1, 'billable/eligible': HOURS - 1 })
    const blocked = rows.filter(row => row.billing_status === 'blocked')
    expect(blocked.map(row => row.period_start)).toEqual(['2026-09-29T22:00:00Z'])
    expect(blocked[0].reasons).toContain('supply_source_unqualified')
    expect(rows.every(row => row.supply_period_id === periodId)).toBe(true)
    const items = openItems(f.companyId)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ issue_type: 'billing_gate_blocked', ids: { meteringPointId: f.pointId, supplyPeriodIds: [periodId], reasonCodes: ['supply_source_unqualified'] } })
    S.summerFirst = rows
    S.summerItems = items
  })

  it('(d) rerun of the same E66 is idempotent: same states, no duplicate values, no duplicate open item', async () => {
    must(S.summer && S.summerFirst && S.summerItems, 'summer_case_missing')
    const { f, received } = S.summer
    const result = await ingest(f, received)
    expect(result).toEqual({ error: null, returned: HOURS })
    const rows = values(f.companyId)
    expect(rows).toEqual(S.summerFirst)
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.metering_values WHERE company_id=${literal(f.companyId)}`)).toBe(HOURS)
    expect(openItems(f.companyId)).toEqual(S.summerItems)
  })

  it('(c) tenant isolation: the other tenant is unchanged by these ingests and its values cannot be read or gated in this tenant', async () => {
    must(S.summer, 'tenant_a_summer_supply_missing: case (a) did not create tenant A')
    // Tenant B is (b)'s tenant when (b) created it; otherwise (c) creates its own B (needs no B billing outcome).
    const createdHere = !S.winter
    const b = (await winterTenant()).f
    const a = S.summer.f
    must(S.winterSnapshot, 'tenant_b_snapshot_missing')
    expect(values(b.companyId).length, 'tenant B has stored values').toBeGreaterThan(0)
    // Unchanged by A's ingest and rerun (B created before them) or by the denied attempts below.
    if (!createdHere) expect(tenantSnapshot(b.companyId)).toEqual(S.winterSnapshot)
    const bRaw = await supabaseService.from('metering_values').select('*').eq('company_id', b.companyId).limit(1).single()
    must(!bRaw.error && bRaw.data, `tenant_b_value_unreadable:${bRaw.error?.message}`)
    const bValue = bRaw.data as unknown as MeteringValueRow
    // Tenant A's readiness evaluation of B's value: B's normalized revision is not visible under A.
    await expect(updateMeterValueBillingReadiness({ meterValue: { ...bValue, company_id: a.companyId }, sourceMessageId: S.summer.received.source.id }))
      .rejects.toThrow('normalized_metering_current_revision_missing')
    // Tenant A's gate write against B's value ids is refused by the database.
    const bNormalized = values(b.companyId).find(row => row.source_metering_value_id === bValue.id)
    must(bNormalized, 'tenant_b_normalized_missing')
    const refused = await supabaseService.rpc('gridex_set_metering_billing_gate', { p_company_id: a.companyId, p_metering_value_id: bValue.id, p_normalized_value_id: bNormalized.id,
      p_gate: { supply_period_id: S.summer.periodId, billing_status: 'blocked', billing_gate_status: 'blocked', billing_gate_reasons: [], billing_gate_snapshot: {}, billing_gate_evaluated_at: new Date().toISOString() } })
    expect(refused.error).not.toBeNull()
    expect(tenantSnapshot(b.companyId)).toEqual(S.winterSnapshot)
    expect(values(a.companyId).every(row => row.supply_period_id === S.summer!.periodId)).toBe(true)
  })
  // (e) Any other database refusal still aborts: asserted at unit level in
  // __tests__/billing-gate-unqualified-supply-source.test.ts ('still fails on any other database refusal');
  // there is no clean native way to make the database raise a different refusal for an otherwise valid value.
})
