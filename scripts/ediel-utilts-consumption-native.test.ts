import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { beforeEach, expect, it, vi } from 'vitest'
import { energyHandoffMessage } from '../__tests__/helpers/utiltsObservationHandoff'
import { utiltsNativeSourceFixture } from '../__tests__/helpers/utiltsNativeSourceFixture'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { resolveCanonicalMessagePolicy } from '@/lib/ediel/core/messagePolicy'
import { prepareUtiltsConsumptionContracts } from '@/lib/ediel/utilts/consumptionPreparation'
import { buildUtiltsTransactionPersistencePayload, persistUtiltsTransactionResults, type UtiltsBoundPersistenceInput } from '@/lib/ediel/utilts/transactionPersistence'
import { ingestBoundUtiltsMetering, createBoundUtiltsBilling } from '@/lib/ediel/utilts/consumptionSinks'
import { createInboundEdielMessage } from '@/lib/inbound-mail/inboundStatusUpdater'
import { parseInboundEmailContent } from '@/lib/inbound-mail/edielEmailParser'
import { supabaseService } from '@/lib/supabase/service'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { GridOwnerDataRequestRow } from '@/lib/cis/types'
import { processInboundUtiltsMessage } from '@/lib/ediel/flows/utiltsDataRequest.part-2'

// Real parser, canonical policy, preparation, service HTTP RPC, SQL, stored
// contract validation and both sink adapters. Only final external writes are
// observed, allowing the crash boundary between persistence and consumption.
const effects = vi.hoisted(() => ({ meter: vi.fn(), bill: vi.fn(), ack: vi.fn(), complete: vi.fn(), outbound: vi.fn(), status: vi.fn(), readRaw: null as string | null }))
vi.mock('@/lib/metering/normalizeMeteringValues', () => ({ normalizeAndStoreMeteringValue: effects.meter }))
vi.mock('@/lib/billing/meterValueBillingMatcher', () => ({ updateMeterValueBillingReadiness: vi.fn() }))
vi.mock('@/lib/cis/db', async original => ({ ...await original<Record<string, unknown>>(), ingestBillingUnderlay: effects.bill,
  syncGridOwnerDataRequestReceivedFromEdiel: effects.complete, findOpenOutboundBySource: effects.outbound }))
vi.mock('@/lib/ediel/core/kernel', async original => ({ ...await original<Record<string, unknown>>(), createCanonicalAckMessage: effects.ack }))
vi.mock('@/lib/ediel/db', async original => {
  const actual = await original<typeof import('@/lib/ediel/db')>()
  return { ...actual, linkEdielMessage: vi.fn(), createEdielMessageEvent: vi.fn(), updateEdielMessageStatus: effects.status,
    getEdielMessageById: async (id: string) => {
      const row = await actual.getEdielMessageById(id)
      return row && effects.readRaw !== null ? { ...row, raw_payload: effects.readRaw } : row
    } }
})
const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const lit = (value: unknown) => value === null ? 'NULL' : "'" + String(typeof value === 'object' ? JSON.stringify(value) : value).replaceAll("'", "''") + "'"
function sql<T = unknown>(input: string): T {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw Error('native_local_only')
  const result = execFileSync('psql', [DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'], { input, encoding: 'utf8', timeout: 10000, maxBuffer: 2000000 }).trim()
  // Unwrapped PostgreSQL booleans use t/f in unaligned text output. JSONB
  // booleans already use true/false; keep every other result strict JSON.
  if (result === 't' || result === 'f') return (result === 't') as T
  return result ? JSON.parse(result) as T : undefined as T
}
async function seed() {
  const ids = { source: randomUUID(), company: randomUUID(), customer: randomUUID(), point: randomUUID(), site: randomUUID(), grid: randomUUID(), request: randomUUID(), actor: randomUUID() }
  const message = energyHandoffMessage('2026-10-01', ids.company)
  message.id = ids.source; message.raw_payload = message.raw_payload!.replace('?+0200:406', '?+0100:406').replaceAll('260831181101', ids.source.slice(0, 12).replaceAll('-', ''))
  sql(`INSERT INTO public.companies(id,name,status) VALUES(${lit(ids.company)},'E035 bound consumption synthetic','active');
   INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
   VALUES(${lit(ids.actor)},'authenticated','authenticated',${lit(`e035-retry-${ids.actor}@example.invalid`)},now(),'{}','{}',now(),now(),false,false);
   INSERT INTO public.user_profiles(id,email,full_name,user_status,created_at,updated_at)
   VALUES(${lit(ids.actor)},${lit(`e035-retry-${ids.actor}@example.invalid`)},'Synthetic E035 retry actor','active',now(),now()) ON CONFLICT(id) DO UPDATE SET user_status='active';
   INSERT INTO public.customers(id,company_id,customer_number,name,customer_type) VALUES(${lit(ids.customer)},${lit(ids.company)},${lit(ids.customer)},'Synthetic','private');
   INSERT INTO public.grid_owners(id,company_id,name,ediel_id,environment,is_active,lifecycle_status) VALUES(${lit(ids.grid)},${lit(ids.company)},${lit(ids.grid)},'91100','test',true,'active');
   INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,site_type,status,country,facility_id,grid_owner_id) VALUES(${lit(ids.site)},${lit(ids.company)},${lit(ids.customer)},'Synthetic','consumption','active','SE','735999260731000007',${lit(ids.grid)});
   INSERT INTO public.metering_points(id,company_id,customer_id,site_id,customer_site_id,metering_point_id,meter_point_id,grid_owner_id) VALUES(${lit(ids.point)},${lit(ids.company)},${lit(ids.customer)},${lit(ids.site)},${lit(ids.site)},'735999260731000007','735999260731000007',${lit(ids.grid)});
   INSERT INTO public.grid_owner_data_requests(id,company_id,customer_id,site_id,metering_point_id,grid_owner_id,request_scope) VALUES(${lit(ids.request)},${lit(ids.company)},${lit(ids.customer)},${lit(ids.site)},${lit(ids.point)},${lit(ids.grid)},'billing_underlay');`)
  const insertSource = async (raw: string, code = 'E66', environment = 'test') => {
    const fixture = utiltsNativeSourceFixture(raw, randomUUID())
    const { id, parsed } = fixture
    raw = fixture.raw
    sql(`INSERT INTO public.ediel_messages(id,company_id,customer_id,site_id,metering_point_id,grid_owner_id,grid_owner_data_request_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,message_received_at,execution_context_snapshot,application_reference,sender_ediel_id,receiver_ediel_id,interchange_reference,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
     SELECT ${lit(id)},${lit(ids.company)},${lit(ids.customer)},${lit(ids.site)},${lit(ids.point)},${lit(ids.grid)},${lit(ids.request)},${lit(environment)},'inbound','edifact','UTILTS',${lit(code)},'received',${lit(raw)},'{}','2026-10-01T20:00:00Z','{}',${lit(parsed.applicationReference)},'91100','21660',${lit(parsed.interchangeReference)},pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile
     FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id WHERE profile.message_code=${lit(code)} AND profile.direction IN ('inbound','both') AND profile.is_enabled ORDER BY profile.profile_key LIMIT 1;`)
    const { data, error } = await supabaseService.from('ediel_messages').select('*').eq('id', id).single()
    expect(error).toBeNull()
    return data as unknown as EdielMessageRow
  }
  const original = await insertSource(message.raw_payload!)
  const dataRequest = { id: ids.request, company_id: ids.company, customer_id: ids.customer, site_id: ids.site, metering_point_id: ids.point, grid_owner_id: ids.grid, request_scope: 'billing_underlay', response_payload: {} } as GridOwnerDataRequestRow
  const prepare = async (source = original, held = false, allowConsumption = true): Promise<UtiltsBoundPersistenceInput> => {
    const runtime = runUtiltsRuntimeForMessage(source), policy = resolveCanonicalMessagePolicy(source)!
    expect(runtime.validation.ok, JSON.stringify(runtime.validation.issues)).toBe(true)
    if (held) runtime.transactionDispositions = runtime.transactionDispositions.map(d => ({ ...d, disposition: 'internal_review', responseType: 'none', issueCodes: ['UTILTS_STRUCTURE_UNAVAILABLE'] }))
    const matches = runtime.facts.transactions.map(t => ({ transactionReference: t.transactionId, meteringPointId: ids.point, customerId: ids.customer, siteId: ids.site, gridOwnerId: ids.grid, externalMeteringPointId: t.meterPointId, externalGridAreaId: t.gridAreaId, matchStatus: 'matched' as const }))
    const contracts = await prepareUtiltsConsumptionContracts({ message: source, runtime, policy, matches, dataRequest: allowConsumption ? dataRequest : null,
      fallback: { customerId: ids.customer, siteId: ids.site, meteringPointId: ids.point, gridOwnerId: ids.grid }, allowConsumption })
    return { companyId: ids.company, environment: source.environment, sourceMessageId: source.id, messageCode: source.message_code!, rawPayload: source.raw_payload!, contracts,
      transactions: buildUtiltsTransactionPersistencePayload({ messageCode: source.message_code, transactions: runtime.facts.transactions, dispositions: runtime.transactionDispositions, matches }) }
  }
  return { ids, original, insertSource, prepare, dataRequest }
}
beforeEach(() => {
  vi.clearAllMocks()
  effects.readRaw = null
  effects.status.mockResolvedValue(null); effects.complete.mockResolvedValue(null); effects.outbound.mockResolvedValue(null)
  effects.ack.mockImplementation(async ({ sourceMessage }: { sourceMessage: EdielMessageRow }) => ({ id: sourceMessage.id }))
  effects.meter.mockResolvedValue({ status: 'stored', meteringValue: { id: 'observed-meter' } })
  effects.bill.mockResolvedValue({ id: 'observed-underlay' })
})
it.each(['quantity', 'timezone', 'resolution-format'])('full processor persisted interruption rejects actual runtime %s retry before ACK/completion or sinks', async kind => {
  const f = await seed()
  effects.status.mockRejectedValueOnce(new Error('synthetic_interruption_after_committed_persistence'))
  await expect(processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: f.original.id })).rejects.toThrow('synthetic_interruption_after_committed_persistence')
  const before = snapshot(f.original.id)
  expect(sql(`SELECT count(*) FROM gridex_utilts_binding.contracts WHERE source_message_id=${lit(f.original.id)}`)).toBe(1)
  expect(effects.ack).not.toHaveBeenCalled(); expect(effects.complete).not.toHaveBeenCalled()
  expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled()
  const original = f.original.raw_payload!
  const changed = kind === 'quantity' ? original.replace('QTY+136:500', 'QTY+136:999')
    : kind === 'timezone' ? original.replace('?+0100:406', '?+0200:406') : original.replace('15:806', '15:805')
  const runtime = runUtiltsRuntimeForMessage({ ...f.original, raw_payload: changed })
  expect(runtime.validation.ok).toBe(true)
  await expect(createInboundEdielMessage({ companyId: f.ids.company, environment: 'test', inboundEmailMessageId: '', parsed: parseInboundEmailContent({ attachmentText: changed })! })).rejects.toThrow('INBOUND_UTILTS_SOURCE_CONFLICT')
  // A read-to-persist race must also fail even if a stale upstream snapshot
  // bypassed the natural dedup call; the locked database bytes remain authority.
  effects.readRaw = changed
  await expect(processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: f.original.id })).rejects.toThrow('utilts_source_binding_conflict')
  expect(snapshot(f.original.id)).toEqual(before)
  expect(effects.ack).not.toHaveBeenCalled(); expect(effects.complete).not.toHaveBeenCalled(); expect(effects.outbound).not.toHaveBeenCalled()
  expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled()
  effects.readRaw = null
  const replay = await processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: f.original.id })
  expect(replay.ingestedMeterValueIds).toEqual(['observed-meter'])
  expect(effects.meter).toHaveBeenCalledWith(expect.objectContaining({ quantityKwh: 500, periodStart: '2026-06-30T23:00:00.000Z' }))
  expect(effects.bill).toHaveBeenCalledWith(expect.objectContaining({ totalKwh: 500, underlayMonth: 6 }))
  expect(effects.complete).toHaveBeenCalledTimes(1)
  expect(effects.ack.mock.calls.some(([call]) => call.ackFamily === 'APERAK')).toBe(true)
})
function snapshot(source: string) {
  return sql(`SELECT jsonb_build_object('acks',(SELECT jsonb_agg(to_jsonb(a)) FROM public.ediel_ack_transaction_results a WHERE source_message_id=${lit(source)}),
   'series',(SELECT jsonb_agg(to_jsonb(s)) FROM public.meter_reading_series s WHERE source_ediel_message_id=${lit(source)}),
   'contracts',(SELECT jsonb_agg(to_jsonb(c)) FROM gridex_utilts_binding.contracts c WHERE source_message_id=${lit(source)}))`)
}
it('real persisted interruption + natural changed-byte dedup cannot consume old success, identical retry consumes stored content', async () => {
  const f = await seed(), input = await f.prepare()
  const first = await persistUtiltsTransactionResults(input), before = snapshot(f.original.id)
  expect(first[0].consumptionContract?.observations[0].quantity).toBe(500)
  expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled()
  const changed = f.original.raw_payload!.replace('QTY+136:500', 'QTY+136:999')
  await expect(createInboundEdielMessage({ companyId: f.ids.company, environment: 'test', inboundEmailMessageId: '', parsed: parseInboundEmailContent({ attachmentText: changed })! })).rejects.toThrow('INBOUND_UTILTS_SOURCE_CONFLICT')
  await expect(persistUtiltsTransactionResults(await f.prepare({ ...f.original, raw_payload: changed }))).rejects.toThrow('utilts_source_binding_conflict')
  expect(snapshot(f.original.id)).toEqual(before)
  expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled()
  const replay = await persistUtiltsTransactionResults(input)
  expect(replay[0].seriesId).toBe(first[0].seriesId); expect(replay[0].idempotentReplay).toBe(true)
  replay[0].consumptionContract!.observations[0].quantity = 999
  await ingestBoundUtiltsMetering({ actorUserId: f.ids.actor, message: f.original, boundOutcomes: replay })
  await createBoundUtiltsBilling({ actorUserId: f.ids.actor, message: f.original, boundOutcomes: replay, existingBillingUnderlayId: null })
  expect(effects.meter).toHaveBeenCalledWith(expect.objectContaining({ quantityKwh: 500, periodStart: '2026-06-30T23:00:00.000Z' }))
  expect(effects.bill).toHaveBeenCalledWith(expect.objectContaining({ totalKwh: 500, underlayMonth: 6, underlayYear: 2026 }))
  expect(snapshot(f.original.id)).toEqual(before)
})
it.each(['quantity', 'timezone', 'resolutionFormat', 'customer', 'request', 'point', 'billing-period', 'unknown-version'])('native immutable comparison rejects %s without replacing ACK/series/contract', async kind => {
  const f = await seed(), input = await f.prepare()
  await persistUtiltsTransactionResults(input); const before = snapshot(f.original.id)
  const changed = structuredClone(input), c = changed.contracts[0]
  if (kind === 'quantity') c.observations[0].quantity = 999
  if (kind === 'timezone') { c.interpretation.offsetMinutes = 120; c.interpretation.timezoneRaw = '+0200'; c.observations[0].periodStart = '2026-06-30T22:00:00.000Z'; c.observations[0].periodEnd = c.observations[0].readAt = '2026-06-30T22:15:00.000Z' }
  if (kind === 'resolutionFormat') { c.interpretation.resolutionFormat = '805'; c.observations[0].resolution = 'PT15H' }
  if (kind === 'customer') c.metering.customerId = randomUUID()
  if (kind === 'request') c.billing.sourceRequestId = randomUUID()
  if (kind === 'point') c.metering.meteringPointId = randomUUID()
  if (kind === 'billing-period') { c.billing.periodEnd = '2026-07-01T00:00:00.000Z'; c.billing.month = 7 }
  if (kind === 'unknown-version') Object.assign(c, { version: 2 })
  await expect(persistUtiltsTransactionResults(changed)).rejects.toThrow(/utilts_(consumption|transaction_persistence)/)
  expect(snapshot(f.original.id)).toEqual(before)
  expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled()
})
it('bound held source releases only on identical bytes and membership', async () => {
  const f = await seed(), held = await f.prepare(f.original, true)
  const first = await persistUtiltsTransactionResults(held), again = await persistUtiltsTransactionResults(held)
  expect(first[0].persistenceStatus).toBe('not_applicable'); expect(again[0].sourceBinding).toEqual(first[0].sourceBinding)
  expect(await persistUtiltsTransactionResults(await f.prepare())).toMatchObject([{ persistenceStatus: 'persisted' }])
  const { error } = await supabaseService.from('ediel_messages').update({ raw_payload: f.original.raw_payload!.replace('500', '999') }).eq('id', f.original.id)
  expect(error?.code).toBe('P0U01')
  const status = await supabaseService.from('ediel_messages').update({ failure_reason: 'diagnostic-only' }).eq('id', f.original.id)
  expect(status.error).toBeNull()
})
it.each(['accepted', 'internal_review'])('unbound historical %s evidence cannot acquire a present-day seal', async disposition => {
  const f = await seed(), input = await f.prepare()
  sql(`INSERT INTO public.ediel_ack_transaction_results(company_id,environment,source_message_id,source_transaction_id,syntax_result,guide_validation_result,processability_result,disposition,planned_response_type,persistence_status)
   VALUES(${lit(f.ids.company)},'test',${lit(f.original.id)},'GRIDEX2607E66001','positive','positive','pending',${lit(disposition)},${lit(disposition === 'accepted' ? 'positive_aperak' : 'none')},'not_applicable');`)
  const before = snapshot(f.original.id)
  await expect(persistUtiltsTransactionResults(input)).rejects.toThrow('utilts_historical_binding_unavailable')
  expect(snapshot(f.original.id)).toEqual(before)
  expect(sql(`SELECT count(*) FROM gridex_utilts_binding.receipts WHERE source_message_id=${lit(f.original.id)}`)).toBe(0)
})
it('equal cross-source content reuses immutable series, a new correction preserves exact noncurrent replay', async () => {
  const f = await seed(), input = await f.prepare(), first = await persistUtiltsTransactionResults(input)
  const copy = await f.insertSource(f.original.raw_payload!.replaceAll(f.original.interchange_reference!, 'COPY'+f.original.interchange_reference!))
  const reused = await persistUtiltsTransactionResults(await f.prepare(copy))
  expect(reused[0].seriesId).toBe(first[0].seriesId)
  const correction = await f.insertSource(f.original.raw_payload!.replaceAll('GRIDEX2607E66001', 'CORRECTION').replaceAll(f.original.interchange_reference!, 'COR'+f.original.interchange_reference!).replace('QTY+136:500', 'QTY+136:501'))
  expect((await persistUtiltsTransactionResults(await f.prepare(correction)))[0].seriesId).not.toBe(first[0].seriesId)
  expect(sql(`SELECT is_current FROM public.meter_reading_series WHERE id=${lit(first[0].seriesId)}`)).toBe(false)
  expect((await persistUtiltsTransactionResults(input))[0].seriesId).toBe(first[0].seriesId)
})
it('cross-environment equal legacy identity cannot reuse test consumption authority', async () => {
  const f = await seed(), first = await persistUtiltsTransactionResults(await f.prepare())
  const production = await f.insertSource(f.original.raw_payload!.replaceAll(f.original.interchange_reference!, 'PROD'+f.original.interchange_reference!), 'E66', 'production')
  const next = await persistUtiltsTransactionResults(await f.prepare(production))
  expect(next[0].seriesId).not.toBe(first[0].seriesId)
  expect(next[0].consumptionContract?.environment).toBe('production')
})
it.each(['E30', 'S07'])('native %s control keeps the actual prepared consumption capability', async code => {
  const f = await seed(), application = code === 'E30' ? '23-MDR-E30-T' : '23-DDQ-S07-T'
  const raw = f.original.raw_payload!.replace('BGM+E66', `BGM+${code}`).replace('23-DDQ-E66-T', application).replaceAll(f.original.interchange_reference!, code+f.original.interchange_reference!)
  const source = await f.insertSource(raw, code), input = await f.prepare(source, false, code === 'E30')
  const rows = await persistUtiltsTransactionResults(input)
  await ingestBoundUtiltsMetering({ actorUserId: f.ids.actor, message: source, boundOutcomes: rows })
  await createBoundUtiltsBilling({ actorUserId: f.ids.actor, message: source, boundOutcomes: rows, existingBillingUnderlayId: null })
  if (code === 'E30') {
    expect(effects.meter).toHaveBeenCalledWith(expect.objectContaining({ quantityKwh: 500, periodStart: '2026-06-30T23:00:00.000Z' }))
    expect(effects.bill).toHaveBeenCalledWith(expect.objectContaining({ totalKwh: 500 }))
  } else {
    expect(rows[0].consumptionContract).toMatchObject({ observations: [], metering: { capability: 'skip' }, billing: { capability: 'skip' } })
    expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled()
  }
})
it.each([{ resolution: '1:805', end: '202607010200', second: '202607010100', boundary: '2026-07-01T00:00:00.000Z' },
  { resolution: '30:806', end: '202607010100', second: '202607010030', boundary: '2026-06-30T23:30:00.000Z' },
  { resolution: '1:802', end: '202609010000', second: '202608010000', boundary: '2026-07-31T23:00:00.000Z' }])('native accepted E30 $resolution creates two distinct stored intervals', async fixture => {
  const f = await seed()
  const lines = f.original.raw_payload!.replace('BGM+E66', 'BGM+E30').replace('23-DDQ-E66-T', '23-MDR-E30-T').replace('15:806', fixture.resolution)
    .replace('202607010000202607010015:719', `202607010000${fixture.end}:719`).split('\n')
  const at = lines.findIndex(line => line.startsWith('UNT+'))
  lines.splice(at, 0, "SEQ++2'", "QTY+136:7'", `DTM+597:${fixture.second}:203'`, "STS+7++21::260'")
  lines[at + 4] = `UNT+${at + 3}+1'`
  const source = await f.insertSource(lines.join('\n').replaceAll(f.original.interchange_reference!, 'E30'+f.original.interchange_reference!), 'E30'), input = await f.prepare(source)
  expect(input.contracts[0].observations.map(o => o.quantity)).toEqual([500, 7])
  expect(input.contracts[0].observations[0].periodEnd).toBe(fixture.boundary)
  expect(input.contracts[0].observations[1].periodStart).toBe(fixture.boundary)
  const outcomes = await persistUtiltsTransactionResults(input)
  await realSinks()
  const stored = await ingestBoundUtiltsMetering({ actorUserId: f.ids.actor, message: source, boundOutcomes: outcomes })
  expect(stored).toHaveLength(2); expect(new Set(stored.map(row => row.id)).size).toBe(2)
  expect(sql(`SELECT jsonb_agg(value_kwh ORDER BY period_start) FROM public.metering_values WHERE company_id=${lit(f.ids.company)}`)).toEqual([500, 7])
  expect((await createBoundUtiltsBilling({ actorUserId: f.ids.actor, message: source, boundOutcomes: outcomes, existingBillingUnderlayId: null }))?.total_kwh).toBe(507)
})
it('JSONB key order is immaterial and wrong source code/environment fail internally', async () => {
  const f = await seed(), input = await f.prepare(), first = await persistUtiltsTransactionResults(input)
  const reordered = { ...input, contracts: input.contracts.map(c => Object.fromEntries(Object.entries(c).reverse()) as typeof c) }
  expect((await persistUtiltsTransactionResults(reordered))[0].seriesId).toBe(first[0].seriesId)
  await expect(persistUtiltsTransactionResults({ ...input, messageCode: 'E30' })).rejects.toThrow('utilts_source_binding_conflict')
  await expect(persistUtiltsTransactionResults({ ...input, environment: 'production' })).rejects.toThrow('utilts_source_binding_conflict')
  await expect(persistUtiltsTransactionResults({ ...input, companyId: randomUUID() })).rejects.toThrow('utilts_source_binding_conflict')
})
it('distinguishable observation order is immutable, not a set comparison', async () => {
  const f = await seed()
  const lines = f.original.raw_payload!.replace('202607010000202607010015:719', '202607010000202607010030:719').split('\n')
  const at = lines.findIndex(line => line.startsWith('UNT+'))
  lines.splice(at, 0, "SEQ++2'", "QTY+136:7'", "DTM+597:202607010015:203'", "STS+7++21::260'")
  lines[at + 4] = `UNT+${at + 3}+1'`
  const source = await f.insertSource(lines.join('\n').replaceAll(f.original.interchange_reference!, 'ORDER'+f.original.interchange_reference!)), input = await f.prepare(source)
  expect(input.contracts[0].observations.map(o => o.quantity)).toEqual([500, 7])
  await persistUtiltsTransactionResults(input); const before = snapshot(source.id)
  const changed = structuredClone(input)
  changed.contracts[0].observations.reverse().forEach((o, i) => { o.ordinal = i })
  await expect(persistUtiltsTransactionResults(changed)).rejects.toThrow('utilts_consumption_raw_conflict')
  expect(snapshot(source.id)).toEqual(before)
})
it('equivalent valid hour/minute wire spellings cannot replace a bound source', async () => {
  const f = await seed()
  const raw = f.original.raw_payload!.replace('15:806', '1:805').replace('202607010000202607010015:719', '202607010000202607010100:719')
  const source = await f.insertSource(raw.replaceAll(f.original.interchange_reference!, 'HOUR'+f.original.interchange_reference!)), input = await f.prepare(source)
  await persistUtiltsTransactionResults(input); const before = snapshot(source.id)
  const changed = { ...source, raw_payload: source.raw_payload!.replace('1:805', '60:806') }, prepared = await f.prepare(changed)
  expect(prepared.contracts[0].observations[0].periodEnd).toBe(input.contracts[0].observations[0].periodEnd)
  await expect(persistUtiltsTransactionResults(prepared)).rejects.toThrow('utilts_source_binding_conflict')
  expect(snapshot(source.id)).toEqual(before)
})
it.each(['missing-field', 'extra-field', 'wrong-type', 'missing-member', 'duplicate-member', 'wrong-member', 'null-request-scope', 'numeric-request-scope', 'text-month', 'padded-customer'])('native rejects %s without minting source/ACK/series evidence', async kind => {
  const f = await seed(), input = await f.prepare()
  const payload = input.transactions.map((item, i) => ({ ...item, consumptionContract: structuredClone(input.contracts[i]) as unknown as Record<string, unknown> }))
  if (kind === 'missing-field') delete payload[0].consumptionContract.attributionVersion
  if (kind === 'extra-field') payload[0].consumptionContract.unapproved = true
  if (kind === 'wrong-type') payload[0].consumptionContract.observations = null
  if (kind === 'missing-member') payload.length = 0
  if (kind === 'duplicate-member') payload.push(structuredClone(payload[0]))
  if (kind === 'wrong-member') { payload[0].transactionId = 'UNSEEN'; payload[0].consumptionContract.transactionId = 'UNSEEN' }
  const billing = payload[0]?.consumptionContract.billing as Record<string, unknown> | undefined
  if (kind === 'null-request-scope') billing!.requestScope = null
  if (kind === 'numeric-request-scope') billing!.requestScope = 7
  if (kind === 'text-month') billing!.month = String(billing!.month)
  if (kind === 'padded-customer') billing!.customerId = ` ${billing!.customerId}`
  const result = sql<string>(`CREATE FUNCTION pg_temp.binding_input_probe() RETURNS text LANGUAGE plpgsql AS $$ BEGIN
    PERFORM public.gridex_persist_utilts_consumption_v1(${lit(input.companyId)},'test',${lit(input.sourceMessageId)},'E66',${lit(input.rawPayload)},${lit(payload)}::jsonb);
    RETURN 'UNSAFE_SUCCESS'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE||':'||SQLERRM; END $$;
    SELECT to_jsonb(pg_temp.binding_input_probe());`)
  expect(result).toMatch(/^P0U01:utilts_/)
  expect(snapshot(input.sourceMessageId)).toEqual({ acks: null, series: null, contracts: null })
  expect(sql(`SELECT count(*) FROM gridex_utilts_binding.receipts WHERE source_message_id=${lit(input.sourceMessageId)}`)).toBe(0)
})
async function realSinks() {
  const meter = await vi.importActual<typeof import('@/lib/metering/normalizeMeteringValues')>('@/lib/metering/normalizeMeteringValues')
  const billing = await vi.importActual<typeof import('@/lib/cis/db-data')>('@/lib/cis/db-data')
  effects.meter.mockImplementation(meter.normalizeAndStoreMeteringValue)
  effects.bill.mockImplementation(billing.ingestBillingUnderlay)
}
function consumedCount(company: string) {
  return sql(`SELECT jsonb_build_object('meter',(SELECT count(*) FROM public.metering_values WHERE company_id=${lit(company)}),'billing',(SELECT count(*) FROM public.billing_underlays WHERE company_id=${lit(company)}))`)
}
it('real downstream writers consume database-derived stored values and retry idempotently', async () => {
  const f = await seed(), input = await f.prepare(), rows = await persistUtiltsTransactionResults(input)
  await realSinks()
  const meter = await ingestBoundUtiltsMetering({ actorUserId: f.ids.actor, message: f.original, boundOutcomes: rows })
  const billing = await createBoundUtiltsBilling({ actorUserId: f.ids.actor, message: f.original, boundOutcomes: rows, existingBillingUnderlayId: null })
  expect(meter).toHaveLength(1); expect(billing?.total_kwh).toBe(500)
  expect(sql(`SELECT jsonb_build_object('value',value_kwh,'customer',customer_id,'site',site_id,'point',metering_point_id,'grid',grid_owner_id) FROM public.metering_values WHERE id=${lit(meter[0].id)}`)).toEqual({ value: 500, customer: f.ids.customer, site: f.ids.site, point: f.ids.point, grid: f.ids.grid })
  await ingestBoundUtiltsMetering({ actorUserId: f.ids.actor, message: f.original, boundOutcomes: rows })
  expect((await createBoundUtiltsBilling({ actorUserId: f.ids.actor, message: f.original, boundOutcomes: rows, existingBillingUnderlayId: null }))?.id).toBe(billing?.id)
  expect(consumedCount(f.ids.company)).toEqual({ meter: 1, billing: 1 })
})
it.each(['month', 'year', 'currency', 'contributors', 'missing-contributors'])('full processor rejects changed billing %s after insert before completion', async field => {
  const f = await seed()
  await realSinks()
  effects.complete.mockRejectedValueOnce(new Error('synthetic_interruption_after_underlay_insert'))
  await expect(processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: f.original.id })).rejects.toThrow('synthetic_interruption_after_underlay_insert')
  expect(consumedCount(f.ids.company)).toEqual({ meter: 1, billing: 1 })
  const mutation = field === 'month' ? 'underlay_month=7' : field === 'year' ? 'underlay_year=2027'
    : field === 'currency' ? "currency='EUR'" : field === 'contributors' ? "payload=jsonb_set(payload,'{consumptionContracts,0,observations,0,quantity}','999'::jsonb)"
      : "payload=payload-'consumptionContracts'"
  sql(`UPDATE public.billing_underlays SET ${mutation} WHERE company_id=${lit(f.ids.company)}`)
  const afterMutation = sql(`SELECT to_jsonb(b) FROM public.billing_underlays b WHERE company_id=${lit(f.ids.company)}`)
  effects.complete.mockClear()
  await expect(processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: f.original.id })).rejects.toThrow('utilts_consumption_existing_billing_conflict')
  expect(effects.complete).not.toHaveBeenCalled()
  expect(consumedCount(f.ids.company)).toEqual({ meter: 1, billing: 1 })
  expect(sql(`SELECT to_jsonb(b) FROM public.billing_underlays b WHERE company_id=${lit(f.ids.company)}`)).toEqual(afterMutation)
})
it('full processor identical retry after underlay insert preserves row identity and legitimate workflow/audit changes', async () => {
  const f = await seed()
  await realSinks()
  effects.complete.mockRejectedValueOnce(new Error('synthetic_interruption_after_underlay_insert'))
  await expect(processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: f.original.id })).rejects.toThrow('synthetic_interruption_after_underlay_insert')
  sql(`UPDATE public.billing_underlays SET status='validated',updated_by=NULL,readiness_status='ready',payload=payload||'{"workflowNote":"reviewed"}'::jsonb WHERE company_id=${lit(f.ids.company)}`)
  const row = sql<{ id: string; status: string; updated_by: null }>(`SELECT to_jsonb(b) FROM public.billing_underlays b WHERE company_id=${lit(f.ids.company)}`)
  effects.complete.mockClear()
  const replay = await processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: f.original.id })
  expect(replay.billingUnderlayId).toBe(row.id)
  expect(effects.complete).toHaveBeenCalledTimes(1)
  expect(consumedCount(f.ids.company)).toEqual({ meter: 1, billing: 1 })
  expect(sql(`SELECT to_jsonb(b) FROM public.billing_underlays b WHERE company_id=${lit(f.ids.company)}`)).toEqual(row)
})
it.each(['point-grid', 'point-site', 'point-customer-site', 'site-grid', 'request-grid'])('real downstream writers reject %s drift after persistence', async kind => {
  const f = await seed(), rows = await persistUtiltsTransactionResults(await f.prepare())
  if (kind === 'point-grid') sql(`UPDATE public.metering_points SET grid_owner_id=NULL WHERE id=${lit(f.ids.point)}`)
  if (kind === 'point-site') sql(`UPDATE public.metering_points SET site_id=NULL,customer_site_id=NULL WHERE id=${lit(f.ids.point)}`)
  if (kind === 'point-customer-site') {
    const site = randomUUID()
    sql(`INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,site_type,status,country,grid_owner_id) VALUES(${lit(site)},${lit(f.ids.company)},${lit(f.ids.customer)},'Other synthetic','consumption','active','SE',${lit(f.ids.grid)}); UPDATE public.metering_points SET customer_site_id=${lit(site)} WHERE id=${lit(f.ids.point)}`)
  }
  if (kind === 'site-grid') sql(`UPDATE public.customer_sites SET grid_owner_id=NULL WHERE id=${lit(f.ids.site)}`)
  if (kind === 'request-grid') sql(`UPDATE public.grid_owner_data_requests SET grid_owner_id=NULL WHERE id=${lit(f.ids.request)}`)
  await realSinks()
  const meter = await Promise.allSettled([ingestBoundUtiltsMetering({ actorUserId: f.ids.actor, message: f.original, boundOutcomes: rows })])
  expect(meter[0].status).toBe('rejected')
  await expect(createBoundUtiltsBilling({ actorUserId: f.ids.actor, message: f.original, boundOutcomes: rows, existingBillingUnderlayId: null })).rejects.toBeDefined()
  expect(consumedCount(f.ids.company)).toEqual({ meter: 0, billing: 0 })
})
const sinkRpc = (input: UtiltsBoundPersistenceInput, sink: 'metering' | 'billing') => {
  const rpc = supabaseService.rpc.bind(supabaseService) as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>
  return Promise.resolve(rpc(`gridex_consume_utilts_${sink}_v1`, { p_company_id: input.companyId, p_source_message_id: input.sourceMessageId, p_actor_id: null,
    ...(sink === 'metering' ? { p_transaction_id: 'GRIDEX2607E66001', p_observation_ordinal: 0, p_expected_contract: input.contracts[0] } : { p_expected_contracts: input.contracts }) }))
}
it.each(['metering', 'billing'] as const)('atomic %s writer refuses a mutated returned projection instead of reinterpreting it', async sink => {
  const f = await seed(), input = await f.prepare(); await persistUtiltsTransactionResults(input)
  const changed = structuredClone(input); changed.contracts[0].observations[0].quantity = 999
  const result = await sinkRpc(changed, sink)
  expect(result.error?.message).toContain('utilts_consumption_returned_contract_changed')
  expect(consumedCount(f.ids.company)).toEqual({ meter: 0, billing: 0 })
})
it.each(['metering', 'billing'] as const)('atomic %s writer waits for concurrent ownership edit then rejects changed tuple', async sink => {
  const f = await seed(), input = await f.prepare(); await persistUtiltsTransactionResults(input)
  const editor = spawn('psql', [DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'], { stdio: ['pipe', 'pipe', 'pipe'] })
  const ready = new Promise<void>((resolve, reject) => {
    editor.stdout.on('data', data => { if (String(data).includes('OWNERSHIP_LOCKED')) resolve() })
    editor.once('error', reject); editor.once('exit', code => { if (code !== 0) reject(new Error(`ownership_editor_exit:${code}`)) })
  })
  editor.stdin.write(`BEGIN; UPDATE public.metering_points SET grid_owner_id=NULL WHERE id=${lit(f.ids.point)}; SELECT 'OWNERSHIP_LOCKED';\n`)
  await ready
  let pending: ReturnType<typeof sinkRpc> | undefined
  try {
    pending = sinkRpc(input, sink)
    let waiting = false
    for (let attempt = 0; attempt < 40; attempt++) {
      waiting = sql<boolean>(`SELECT EXISTS(SELECT FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%gridex_consume_utilts_${sink}_v1%')`)
      if (waiting) break
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    expect(waiting).toBe(true)
    editor.stdin.end('COMMIT;\n')
    const result = await pending
    expect(result.error?.message).toContain('utilts_consumption_point_ownership_changed')
    expect(consumedCount(f.ids.company)).toEqual({ meter: 0, billing: 0 })
  } finally {
    if (!editor.stdin.writableEnded) editor.stdin.end('ROLLBACK;\n')
    await pending
  }
})
it.each(['direction', 'company_id', 'environment', 'message_code', 'sender_ediel_id'])('direct update cannot change sealed source %s', async field => {
  const f = await seed(), input = await f.prepare()
  await persistUtiltsTransactionResults(input)
  const changed = field === 'company_id' ? randomUUID() : field === 'direction' ? 'outbound' : field === 'environment' ? 'production' : field === 'message_code' ? 'E30' : '99999'
  const { error } = await supabaseService.from('ediel_messages').update({ [field]: changed }).eq('id', f.original.id)
  expect(error).not.toBeNull()
  const { data } = await supabaseService.from('ediel_messages').select('company_id,environment,direction,message_code,sender_ediel_id').eq('id', f.original.id).single()
  expect(data).toMatchObject({ company_id: f.ids.company, environment: 'test', direction: 'inbound', message_code: 'E66', sender_ediel_id: '91100' })
})
it('concurrent identical retries serialize to one contract/series and unchanged reserved ACK', async () => {
  const f = await seed(), input = await f.prepare()
  const attempts = await Promise.all(Array.from({ length: 4 }, () => persistUtiltsTransactionResults(input)))
  expect(new Set(attempts.map(rows => rows[0].seriesId)).size).toBe(1)
  expect(attempts.filter(rows => !rows[0].idempotentReplay)).toHaveLength(1)
  expect(sql(`SELECT jsonb_build_object('series',(SELECT count(*) FROM public.meter_reading_series WHERE source_ediel_message_id=${lit(f.original.id)}),'contracts',(SELECT count(*) FROM gridex_utilts_binding.contracts WHERE source_message_id=${lit(f.original.id)}),'acks',(SELECT count(*) FROM public.ediel_ack_transaction_results WHERE source_message_id=${lit(f.original.id)}))`)).toEqual({ series: 1, contracts: 1, acks: 1 })
})
it('dedupe conflict after an earlier sibling insert rolls the entire batch back, never to ERR', async () => {
  const f = await seed(), input = await f.prepare()
  await persistUtiltsTransactionResults(input)
  const original = f.original.raw_payload!, start = original.indexOf('IDE+24'), end = original.indexOf('UNT+')
  const added = original.slice(start, end).replaceAll('GRIDEX2607E66001', 'EARLIER-SIBLING').replace('QTY+136:500', 'QTY+136:1')
  const raw = (original.slice(0, start) + added + original.slice(start).replace('QTY+136:500', 'QTY+136:999')).replaceAll(f.original.interchange_reference!, 'BATCH'+f.original.interchange_reference!)
  const segments = raw.split('\n'), unt = segments.findIndex(line => line.startsWith('UNT+'))
  segments[unt] = `UNT+${unt - 1}+1'`
  const source = await f.insertSource(segments.join('\n')), incoming = await f.prepare(source)
  const before = snapshot(f.original.id)
  await expect(persistUtiltsTransactionResults(incoming)).rejects.toThrow('utilts_consumption_raw_conflict')
  expect(snapshot(f.original.id)).toEqual(before)
  expect(snapshot(source.id)).toEqual({ acks: null, series: null, contracts: null })
  expect(sql(`SELECT count(*) FROM gridex_utilts_binding.receipts WHERE source_message_id=${lit(source.id)}`)).toBe(0)
})
it('private storage and old unbound function are unavailable to service callers', async () => {
  const f = await seed(), input = await f.prepare()
  const { error } = await supabaseService.rpc('gridex_persist_utilts_transactions_v1', {
    p_company_id: input.companyId, p_environment: input.environment, p_source_message_id: input.sourceMessageId, p_message_code: input.messageCode, p_transactions: input.transactions,
  })
  expect(error).not.toBeNull()
  expect(sql(`SELECT has_function_privilege('service_role','gridex_utilts_binding.persist_series_v1(uuid,text,uuid,text,jsonb)','EXECUTE')`)).toBe(false)
  expect(sql(`SELECT has_function_privilege('authenticated','public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb)','EXECUTE')`)).toBe(false)
  expect(sql(`SELECT has_table_privilege('service_role','gridex_utilts_binding.contracts','INSERT')`)).toBe(false)
  for (const role of ['anon', 'authenticated']) {
    expect(sql(`SELECT has_function_privilege(${lit(role)},'public.gridex_consume_utilts_metering_v1(uuid,uuid,text,integer,uuid,jsonb)','EXECUTE')`)).toBe(false)
    expect(sql(`SELECT has_function_privilege(${lit(role)},'public.gridex_consume_utilts_billing_v1(uuid,uuid,uuid,jsonb)','EXECUTE')`)).toBe(false)
  }
})
it.each(['missing-contract', 'corrupt-contract-hash', 'corrupt-raw-hash'])('native %s evidence cannot authorize replay', async kind => {
  const f = await seed(), input = await f.prepare(), rows = await persistUtiltsTransactionResults(input), before = snapshot(f.original.id)
  const payload = input.transactions.map((item, i) => ({ ...item, consumptionContract: input.contracts[i] }))
  const mutation = kind === 'missing-contract' ? `DELETE FROM gridex_utilts_binding.contracts WHERE series_id=${lit(rows[0].seriesId)};`
    : kind === 'corrupt-contract-hash' ? `UPDATE gridex_utilts_binding.contracts SET contract_hash=repeat('0',64) WHERE series_id=${lit(rows[0].seriesId)};`
      : `UPDATE public.meter_reading_series SET immutable_hash=repeat('0',64) WHERE id=${lit(rows[0].seriesId)};`
  const result = sql<string>(`BEGIN;
   ALTER TABLE gridex_utilts_binding.contracts DISABLE TRIGGER USER;
   ALTER TABLE public.meter_reading_series DISABLE TRIGGER USER;
   ${mutation}
   CREATE FUNCTION pg_temp.binding_corruption_probe() RETURNS text LANGUAGE plpgsql AS $$ BEGIN
    PERFORM public.gridex_persist_utilts_consumption_v1(${lit(input.companyId)},'test',${lit(input.sourceMessageId)},'E66',${lit(input.rawPayload)},${lit(payload)}::jsonb);
    RETURN 'UNSAFE_SUCCESS';
   EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE||':'||SQLERRM; END $$;
   SELECT to_jsonb(pg_temp.binding_corruption_probe()); ROLLBACK;`)
  expect(result).toMatch(/^P0U01:utilts_/)
  expect(snapshot(f.original.id)).toEqual(before)
})

function sinkState(company: string) {
  return sql(`SELECT jsonb_build_object('meters',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.metering_values m WHERE company_id=${lit(company)}),
   'normalized',(SELECT jsonb_agg(to_jsonb(n) ORDER BY id) FROM public.normalized_metering_values n WHERE company_id=${lit(company)}),
   'links',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.metering_value_sources l WHERE company_id=${lit(company)}))`)
}
it.each(['customer', 'site', 'customer-site', 'grid', 'request', 'resolution', 'read-at', 'reading-type', 'normalized-quantity', 'normalized-facility', 'normalized-resolution', 'normalized-site'])('R1 full processor refuses colliding stored %s before lineage/completion', async field => {
  const f = await seed(), initial = await f.prepare()
  await persistUtiltsTransactionResults(initial)
  expect((await sinkRpc(initial, 'metering')).error).toBeNull()
  if (field === 'customer') {
    const other = randomUUID()
    sql(`INSERT INTO public.customers(id,company_id,customer_number,name,customer_type) VALUES(${lit(other)},${lit(f.ids.company)},${lit(other)},'Other synthetic','private'); UPDATE public.metering_values SET customer_id=${lit(other)} WHERE company_id=${lit(f.ids.company)}`)
  } else {
    const updates: Record<string, string> = { site: 'site_id=NULL', 'customer-site': 'customer_site_id=NULL', grid: 'grid_owner_id=NULL', request: 'source_request_id=NULL', resolution: "resolution='PT1H'", 'read-at': "read_at=read_at+interval '1 minute'", 'reading-type': "reading_type='estimated'", 'normalized-quantity': 'quantity_kwh=501', 'normalized-facility': "facility_id='other'", 'normalized-resolution': "resolution='PT1H'", 'normalized-site': 'site_id=NULL' }
    sql(`UPDATE public.${field.startsWith('normalized') ? 'normalized_metering_values' : 'metering_values'} SET ${updates[field]} WHERE company_id=${lit(f.ids.company)}`)
  }
  const source = await f.insertSource(f.original.raw_payload!.replaceAll(f.original.interchange_reference!, 'REUSE'+f.original.interchange_reference!))
  await persistUtiltsTransactionResults(await f.prepare(source))
  const before = sinkState(f.ids.company), persisted = snapshot(source.id)
  await realSinks()
  await expect(processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: source.id })).rejects.toThrow(/utilts_consumption_existing_(metering|normalized)_conflict/)
  expect(sinkState(f.ids.company)).toEqual(before)
  expect(snapshot(source.id)).toEqual(persisted)
  expect(effects.complete).not.toHaveBeenCalled(); expect(effects.ack).not.toHaveBeenCalled()
  expect(effects.status.mock.calls.some(([call]) => call.status === 'validated')).toBe(false)
})
it('R1 identical different-source reuse preserves content and adds separate lineage', async () => {
  const f = await seed(), a = await f.prepare()
  await persistUtiltsTransactionResults(a)
  const first = await sinkRpc(a, 'metering'); expect(first.error).toBeNull()
  const source = await f.insertSource(f.original.raw_payload!.replaceAll(f.original.interchange_reference!, 'EQUAL'+f.original.interchange_reference!)), b = await f.prepare(source)
  await persistUtiltsTransactionResults(b)
  const next = await sinkRpc(b, 'metering'); expect(next.error).toBeNull()
  expect((next.data as { id: string }).id).toBe((first.data as { id: string }).id)
  expect(sql(`SELECT count(*) FROM public.metering_value_sources WHERE company_id=${lit(f.ids.company)}`)).toBe(2)
  expect(consumedCount(f.ids.company)).toEqual({ meter: 1, billing: 0 })
})
it('R1 environment collision cannot add lineage or overwrite an existing result', async () => {
  const f = await seed(), a = await f.prepare()
  await persistUtiltsTransactionResults(a); expect((await sinkRpc(a, 'metering')).error).toBeNull()
  const source = await f.insertSource(f.original.raw_payload!.replaceAll(f.original.interchange_reference!, 'ENV'+f.original.interchange_reference!), 'E66', 'production'), b = await f.prepare(source)
  await persistUtiltsTransactionResults(b)
  const before = sinkState(f.ids.company), persisted = snapshot(source.id)
  expect((await sinkRpc(b, 'metering')).error?.message).toContain('existing_metering_environment_conflict')
  expect(sinkState(f.ids.company)).toEqual(before); expect(snapshot(source.id)).toEqual(persisted)
})
async function realCompletion() {
  const db = await vi.importActual<typeof import('@/lib/cis/db-data')>('@/lib/cis/db-data')
  effects.complete.mockImplementation(db.syncGridOwnerDataRequestReceivedFromEdiel)
  const ediel = await vi.importActual<typeof import('@/lib/ediel/db')>('@/lib/ediel/db')
  effects.status.mockImplementation(ediel.updateEdielMessageStatus)
}
function requestState(request: string) {
  return sql<{ status: string; response_payload: { billingUnderlayId: string } }>(`SELECT to_jsonb(r) FROM public.grid_owner_data_requests r WHERE id=${lit(request)}`)
}
it.each(['completed', 'after-real-completion-before-ack', 'foreign-response-id', 'stale-response-id'])('R2 %s reuses verified underlay and preserves request/message/return lineage', async boundary => {
  const f = await seed()
  await realSinks(); await realCompletion()
  if (boundary === 'after-real-completion-before-ack') effects.ack.mockRejectedValueOnce(new Error('after_real_completion'))
  const first = processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: f.original.id })
  if (boundary === 'after-real-completion-before-ack') await expect(first).rejects.toThrow('after_real_completion')
  else await first
  const id = requestState(f.ids.request).response_payload.billingUnderlayId
  expect(id).toMatch(/^[a-f0-9-]{36}$/)
  if (boundary === 'foreign-response-id') {
    const foreign = await seed(); await persistUtiltsTransactionResults(await foreign.prepare())
    const bill = await sinkRpc(await foreign.prepare(), 'billing'); expect(bill.error).toBeNull()
    sql(`UPDATE public.grid_owner_data_requests SET response_payload=jsonb_set(response_payload,'{billingUnderlayId}',to_jsonb(${lit((bill.data as { id: string }).id)}::text)) WHERE id=${lit(f.ids.request)}`)
  }
  if (boundary === 'stale-response-id') sql(`UPDATE public.grid_owner_data_requests SET response_payload=jsonb_set(response_payload,'{billingUnderlayId}',to_jsonb(${lit(randomUUID())}::text)) WHERE id=${lit(f.ids.request)}`)
  sql(`UPDATE public.billing_underlays SET status='validated',updated_by=NULL,readiness_status='ready',payload=payload||'{"workflowNote":"reviewed"}'::jsonb WHERE id=${lit(id)}`)
  const billBefore = sql(`SELECT to_jsonb(b) FROM public.billing_underlays b WHERE id=${lit(id)}`)
  effects.bill.mockClear()
  const replay = await processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: f.original.id })
  expect(effects.bill).toHaveBeenCalledTimes(1); expect(replay.billingUnderlayId).toBe(id)
  expect(requestState(f.ids.request).response_payload.billingUnderlayId).toBe(id)
  expect(sql(`SELECT to_jsonb(parsed_payload->>'billingUnderlayId') FROM public.ediel_messages WHERE id=${lit(f.original.id)}`)).toBe(id)
  expect(sql(`SELECT to_jsonb(b) FROM public.billing_underlays b WHERE id=${lit(id)}`)).toEqual(billBefore)
  expect(consumedCount(f.ids.company)).toEqual({ meter: 1, billing: 1 })
})
it.each(['month', 'year', 'currency', 'contributors', 'missing-contributors'])('R2 populated response cannot bypass changed existing billing %s', async field => {
  const f = await seed(); await realSinks(); await realCompletion()
  effects.ack.mockRejectedValueOnce(new Error('after_real_completion'))
  await expect(processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: f.original.id })).rejects.toThrow('after_real_completion')
  const before = requestState(f.ids.request), persisted = snapshot(f.original.id)
  expect(before.response_payload.billingUnderlayId).toBeTruthy()
  const mutation = field === 'month' ? 'underlay_month=7' : field === 'year' ? 'underlay_year=2027'
    : field === 'currency' ? "currency='EUR'" : field === 'contributors' ? "payload=jsonb_set(payload,'{consumptionContracts,0,observations,0,quantity}','999'::jsonb)" : "payload=payload-'consumptionContracts'"
  sql(`UPDATE public.billing_underlays SET ${mutation} WHERE company_id=${lit(f.ids.company)}`)
  const billingBefore = sql(`SELECT to_jsonb(b) FROM public.billing_underlays b WHERE company_id=${lit(f.ids.company)}`)
  effects.ack.mockClear(); effects.complete.mockClear(); effects.status.mockClear()
  await expect(processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: f.original.id })).rejects.toThrow('existing_billing_conflict')
  expect(effects.complete).not.toHaveBeenCalled(); expect(effects.ack).not.toHaveBeenCalled()
  expect(effects.status.mock.calls.some(([call]) => call.status === 'validated')).toBe(false)
  expect(requestState(f.ids.request)).toEqual(before); expect(snapshot(f.original.id)).toEqual(persisted)
  expect(sql(`SELECT to_jsonb(b) FROM public.billing_underlays b WHERE company_id=${lit(f.ids.company)}`)).toEqual(billingBefore)
})

it.each(['energy', 'readings', 'E30-energy', 'E30-readings', 'S07-policy'] as const)('R3 real %s processor holds agency89 text collision with no consumable series or functional ACK', async shape => {
  const f = await seed()
  const { observationHandoffMessage } = await import('../__tests__/helpers/utiltsObservationHandoff')
  const { processInboundUtiltsMessageByCanonicalPolicy } = await import('@/lib/ediel/flows/utiltsInboundPolicyProcessor')
  const code = shape.startsWith('E30') ? 'E30' : shape === 'S07-policy' ? 'S07' : 'E66'
  let raw = shape.includes('readings') ? observationHandoffMessage('2026-10-01', f.ids.company).raw_payload! : f.original.raw_payload!
  raw = raw.replace('?+0200:406', '?+0100:406').replace('QTY+220:11000', 'QTY+220:10500')
    .replace('735999260731000007::9', '735999260731000007::89').replace('BGM+E66', `BGM+${code}`)
    .replace(/23-DDQ-E66-[ST]/g, code === 'E30' ? '23-MDR-E30-T' : `23-DDQ-${code}-T`)
  const source = await f.insertSource(raw, code)
  await realSinks()
  const result = await (shape === 'S07-policy' ? processInboundUtiltsMessageByCanonicalPolicy : processInboundUtiltsMessage)({ actorUserId: f.ids.actor, edielMessageId: source.id })
  expect(result.internalReviewRequired).toBe(true); expect(result.ingestedMeterValueIds).toEqual([])
  expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled(); expect(effects.complete).not.toHaveBeenCalled()
  expect(effects.ack.mock.calls.every(([call]) => call.ackFamily === 'CONTRL')).toBe(true)
  expect(sql(`SELECT jsonb_agg(jsonb_build_object('disposition',disposition,'plan',planned_response_type,'final',final_response_type,'series',persisted_series_id)) FROM public.ediel_ack_transaction_results WHERE source_message_id=${lit(source.id)}`)).toEqual([{ disposition: 'internal_review', plan: 'none', final: null, series: null }])
  expect(sql(`SELECT count(*) FROM public.meter_reading_series WHERE source_ediel_message_id=${lit(source.id)}`)).toBe(0)
  expect(consumedCount(f.ids.company)).toEqual({ meter: 0, billing: 0 })
})
it('R3 direct persistence HTTP cannot mint agency89 authority from forged plain-ID accepted contract', async () => {
  const f = await seed(), supported = await f.prepare()
  const source = await f.insertSource(f.original.raw_payload!.replace('735999260731000007::9', '735999260731000007::89'))
  const { error } = await supabaseService.rpc('gridex_persist_utilts_consumption_v1', {
    p_company_id: f.ids.company, p_environment: 'test', p_source_message_id: source.id, p_message_code: 'E66', p_raw_payload: source.raw_payload!,
    p_transactions: supported.transactions.map((t, i) => ({ ...t, consumptionContract: supported.contracts[i] })),
  })
  expect(error?.message).toContain('identity_unsupported')
  expect(snapshot(source.id)).toEqual({ acks: null, series: null, contracts: null })
  expect(sql(`SELECT count(*) FROM gridex_utilts_binding.receipts WHERE source_message_id=${lit(source.id)}`)).toBe(0)
})
it.each([false, true])('R4 real permission/no-request processor holds failed write, earlier sibling committed=%s', async sibling => {
  const f = await seed(), permission = randomUUID()
  let source = f.original
  if (sibling) {
    const lines = f.original.raw_payload!.replace('BGM+E66', 'BGM+E30').replace('23-DDQ-E66-T', '23-MDR-E30-T')
      .replace('202607010000202607010015:719', '202607010000202607010030:719').split('\n')
    const at = lines.findIndex(line => line.startsWith('UNT+'))
    lines.splice(at, 0, "SEQ++2'", "QTY+136:7'", "DTM+597:202607010015:203'", "STS+7++21::260'")
    lines[at + 4] = `UNT+${at + 3}+1'`
    source = await f.insertSource(lines.join('\n'), 'E30')
  }
  sql(`UPDATE public.ediel_messages SET grid_owner_data_request_id=NULL WHERE company_id=${lit(f.ids.company)};
   DELETE FROM public.grid_owner_data_requests WHERE id=${lit(f.ids.request)};
   INSERT INTO public.metering_permissions(id,company_id,customer_id,site_id,customer_site_id,metering_point_id,grid_owner_id,status)
   VALUES(${lit(permission)},${lit(f.ids.company)},${lit(f.ids.customer)},${lit(f.ids.site)},${lit(f.ids.site)},${lit(f.ids.point)},${lit(f.ids.grid)},'active');`)
  await realSinks()
  const actual = await vi.importActual<typeof import('@/lib/metering/normalizeMeteringValues')>('@/lib/metering/normalizeMeteringValues')
  let ordinal = 0
  effects.meter.mockImplementation(async input => {
    if (ordinal++ === (sibling ? 1 : 0)) {
      expect(sql(`SELECT count(*) FROM gridex_utilts_binding.contracts WHERE source_message_id=${lit(source.id)}`)).toBe(1)
      sql(`UPDATE public.metering_points SET site_id=NULL,customer_site_id=NULL WHERE id=${lit(f.ids.point)}`)
    }
    return actual.normalizeAndStoreMeteringValue(input)
  })
  await expect(processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: source.id })).rejects.toThrow('metering_not_stored')
  expect(effects.ack).not.toHaveBeenCalled(); expect(effects.complete).not.toHaveBeenCalled()
  expect(effects.status.mock.calls.some(([call]) => call.status === 'validated')).toBe(false)
  expect(consumedCount(f.ids.company)).toEqual({ meter: sibling ? 1 : 0, billing: 0 })
  expect(sql(`SELECT count(*) FROM public.ediel_ack_transaction_results WHERE source_message_id=${lit(source.id)} AND (finalized_at IS NOT NULL OR response_message_id IS NOT NULL)`)).toBe(0)
  const committed = sql<string[]>(`SELECT coalesce(jsonb_agg(id),'[]') FROM public.metering_values WHERE company_id=${lit(f.ids.company)}`)
  sql(`UPDATE public.metering_points SET site_id=${lit(f.ids.site)},customer_site_id=${lit(f.ids.site)} WHERE id=${lit(f.ids.point)}`)
  effects.meter.mockImplementation(actual.normalizeAndStoreMeteringValue)
  const replay = await processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: source.id })
  expect(replay.ingestedMeterValueIds).toHaveLength(sibling ? 2 : 1)
  expect(replay.ingestedMeterValueIds).toEqual(expect.arrayContaining(committed))
  expect(effects.status.mock.calls.some(([call]) => call.status === 'validated' && call.parsedPayload?.matchedMeteringPermissionId === permission)).toBe(true)
  expect(effects.ack.mock.calls.some(([call]) => call.ackFamily === 'APERAK')).toBe(true)
})
it('C1 restored case history is tenant-classified with real RLS and client access closed', () => {
  expect(sql(`SELECT jsonb_build_object('kind',kind,'nullMeaning',null_company_meaning) FROM public.platform_table_classification WHERE table_name='customer_case_events'`)).toEqual({ kind: 'tenant', nullMeaning: null })
  expect(sql(`SELECT relrowsecurity FROM pg_class WHERE oid='public.customer_case_events'::regclass`)).toBe(true)
  expect(sql(`SELECT attnotnull FROM pg_attribute WHERE attrelid='public.customer_case_events'::regclass AND attname='company_id'`)).toBe(true)
  for (const role of ['anon', 'authenticated']) {
    expect(sql(`SELECT has_table_privilege(${lit(role)},'public.customer_case_events','SELECT,INSERT,UPDATE,DELETE')`)).toBe(false)
  }
  expect(sql(`SELECT count(*) FROM pg_constraint WHERE conrelid='public.customer_case_events'::regclass AND conname IN ('customer_case_events_case_owner_fk','customer_case_events_customer_company_fk') AND convalidated`)).toBe(2)
})
