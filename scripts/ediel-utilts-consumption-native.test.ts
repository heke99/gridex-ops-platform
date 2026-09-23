import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { beforeEach, expect, it, vi } from 'vitest'
import { energyHandoffMessage } from '../__tests__/helpers/utiltsObservationHandoff'
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

// Real parser, canonical policy, preparation, service HTTP RPC, SQL, stored
// contract validation and both sink adapters. Only final external writes are
// observed, allowing the crash boundary between persistence and consumption.
const effects = vi.hoisted(() => ({ meter: vi.fn(), bill: vi.fn() }))
vi.mock('@/lib/metering/normalizeMeteringValues', () => ({ normalizeAndStoreMeteringValue: effects.meter }))
vi.mock('@/lib/billing/meterValueBillingMatcher', () => ({ updateMeterValueBillingReadiness: vi.fn() }))
vi.mock('@/lib/cis/db', async original => ({ ...await original<Record<string, unknown>>(), ingestBillingUnderlay: effects.bill }))
const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const lit = (value: unknown) => value === null ? 'NULL' : "'" + String(typeof value === 'object' ? JSON.stringify(value) : value).replaceAll("'", "''") + "'"
function sql<T = unknown>(input: string): T {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw Error('native_local_only')
  const result = execFileSync('psql', [DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'], { input, encoding: 'utf8', timeout: 10000, maxBuffer: 2000000 }).trim()
  return result ? JSON.parse(result) as T : undefined as T
}
async function seed() {
  const ids = { source: randomUUID(), company: randomUUID(), customer: randomUUID(), point: randomUUID(), site: randomUUID(), grid: randomUUID(), request: randomUUID() }
  const message = energyHandoffMessage('2026-10-01', ids.company)
  message.id = ids.source; message.raw_payload = message.raw_payload!.replace('?+0200:406', '?+0100:406').replaceAll('260831181101', ids.source.slice(0, 12).replaceAll('-', ''))
  sql(`INSERT INTO public.companies(id,name,status) VALUES(${lit(ids.company)},'E035 bound consumption synthetic','active');
   INSERT INTO public.customers(id,company_id,customer_number,name,customer_type) VALUES(${lit(ids.customer)},${lit(ids.company)},${lit(ids.customer)},'Synthetic','private');
   INSERT INTO public.grid_owners(id,company_id,name,ediel_id,environment,is_active,lifecycle_status) VALUES(${lit(ids.grid)},${lit(ids.company)},${lit(ids.grid)},'91100','test',true,'active');
   INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,site_type,status,country,facility_id,grid_owner_id) VALUES(${lit(ids.site)},${lit(ids.company)},${lit(ids.customer)},'Synthetic','consumption','active','SE','735999260731000007',${lit(ids.grid)});
   INSERT INTO public.metering_points(id,company_id,customer_id,site_id,customer_site_id,metering_point_id,meter_point_id,grid_owner_id) VALUES(${lit(ids.point)},${lit(ids.company)},${lit(ids.customer)},${lit(ids.site)},${lit(ids.site)},'735999260731000007','735999260731000007',${lit(ids.grid)});
   INSERT INTO public.grid_owner_data_requests(id,company_id,customer_id,site_id,metering_point_id,grid_owner_id,request_scope) VALUES(${lit(ids.request)},${lit(ids.company)},${lit(ids.customer)},${lit(ids.site)},${lit(ids.point)},${lit(ids.grid)},'billing_underlay');`)
  const insertSource = async (raw: string, code = 'E66', environment = 'test') => {
    const id = randomUUID(), parsed = parseInboundEmailContent({ attachmentText: raw })!
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
  effects.meter.mockResolvedValue({ status: 'stored', meteringValue: { id: 'observed-meter' } })
  effects.bill.mockResolvedValue({ id: 'observed-underlay' })
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
  await ingestBoundUtiltsMetering({ actorUserId: f.ids.customer, message: f.original, boundOutcomes: replay })
  await createBoundUtiltsBilling({ actorUserId: f.ids.customer, message: f.original, boundOutcomes: replay, existingBillingUnderlayId: null })
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
  await ingestBoundUtiltsMetering({ actorUserId: f.ids.customer, message: source, boundOutcomes: rows })
  await createBoundUtiltsBilling({ actorUserId: f.ids.customer, message: source, boundOutcomes: rows, existingBillingUnderlayId: null })
  if (code === 'E30') {
    expect(effects.meter).toHaveBeenCalledWith(expect.objectContaining({ quantityKwh: 500, periodStart: '2026-06-30T23:00:00.000Z' }))
    expect(effects.bill).toHaveBeenCalledWith(expect.objectContaining({ totalKwh: 500 }))
  } else {
    expect(rows[0].consumptionContract).toMatchObject({ observations: [], metering: { capability: 'skip' }, billing: { capability: 'skip' } })
    expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled()
  }
})
it('JSONB key order is immaterial and wrong source code/environment fail internally', async () => {
  const f = await seed(), input = await f.prepare(), first = await persistUtiltsTransactionResults(input)
  const reordered = { ...input, contracts: input.contracts.map(c => Object.fromEntries(Object.entries(c).reverse()) as typeof c) }
  expect((await persistUtiltsTransactionResults(reordered))[0].seriesId).toBe(first[0].seriesId)
  await expect(persistUtiltsTransactionResults({ ...input, messageCode: 'E30' })).rejects.toThrow('utilts_source_binding_conflict')
  await expect(persistUtiltsTransactionResults({ ...input, environment: 'production' })).rejects.toThrow('utilts_source_binding_conflict')
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
