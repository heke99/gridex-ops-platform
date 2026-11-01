// simulation: MAIN03.01, MAIN03.02, MAIN03.03, MAIN03.04, MAIN03.05
//
// MAIN03 — full February 2027 (Europe/Stockholm) for one synthetic customer:
// 28 daily synthetic UTILTS files, 2688 quarter-hour intervals, three plain reads
// before saving, saving through the normal API entry, exact kWh and money oracle,
// and an unknown-outcome retry that must not create a duplicate.
//
// Browser: none (no Playwright). Executes against the track 1 stack through
// vitest; HTTP goes to the running app (TRACK1_APP_URL) with a real password
// session, reads of the stored result use read-only psql.
//
// EXECUTION ORDER NOTE: MAIN03.05 (the aborted first save attempt) runs BEFORE
// MAIN03.04 on purpose. An unknown outcome only exists for the FIRST save; after
// a known success a retry would merely prove replay. MAIN03.04 verifies the end
// state (kWh, items, prices) and saves by itself if MAIN03.05 did not.
//
// Run: scripts/simulation/track1/run.sh scripts/simulation/track1/scenarios/main03.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
// The base's native UTILTS/PRODAT processors send mail through nodemailer; nothing may leave this process.
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: vi.fn() }) } }))
vi.mock('server-only', () => ({}))
import { supabaseService } from '@/lib/supabase/service'
import { loadQualifiedBillingValues } from '@/lib/billing/sourceBasis'
import { buildMain03Fixture, DEFAULT_MAIN03_PARAMS, type Main03Fixture } from '../fixtures/main03Fixture'
import { SUBSTITUTIONS, resetSubstitutions } from '../fixtures/substitutions'
import { dbRead, http, lit, sha256Json, sleep, TIMINGS, timed, writeArtifact } from '../fixtures/runtime'
import { centsText, parseMilliKwh, QUARTERS_PER_DAY } from '../fixtures/synthetic'
import { awaitMain03RetryPermit, beginMain03CohortFromEnv, captureMain03Candidate } from '../fixtures/main03Cohort'

let fx: Main03Fixture
const results: Record<string, unknown> = {}
const BILLING_MONTH = DEFAULT_MAIN03_PARAMS.billingMonth
const completed: string[] = []
let cohortContext: Awaited<ReturnType<typeof beginMain03CohortFromEnv>>

beforeAll(async () => {
  // Current hosted smoke does not authorize fixture/business writes.
  cohortContext = await beginMain03CohortFromEnv(supabaseService, DEFAULT_MAIN03_PARAMS)
  resetSubstitutions()
  fx = await buildMain03Fixture(cohortContext.fixtureParams)
  writeArtifact('fixture.json', {
    note: 'ids only; no secrets or session material',
    params: fx.params, salt: fx.salt, companyId: fx.companyId, actorUserId: fx.actorUserId, customerId: fx.customerId, siteId: fx.siteId,
    pointId: fx.pointId, contractId: fx.contractId, supplyPeriodId: fx.supplyPeriodId, gridOwnerId: fx.gridOwnerId, dataRequestId: fx.dataRequestId,
    externalPointId: fx.externalPointId, ownEdielId: fx.ownEdielId, issuerEdielId: fx.issuerEdielId,
    oracle: { intervalCount: fx.oracle.intervalCount, totalKwh: fx.oracle.totalKwhText, lines: fx.oracle.lines, vatCents: fx.oracle.vatCents, totalExVatCents: fx.oracle.totalExVatCents, totalIncVatCents: fx.oracle.totalIncVatCents, perDay: fx.oracle.perDay },
    days: fx.days.map(day => ({ day: day.day, sourceId: day.sourceId, transactionRef: day.transactionRef, bgmReference: day.bgmReference, rawSha256: day.rawSha256, meteringValues: day.meteringValueIds.length, normalized: day.normalizedIds.length, persistMs: day.persistMs, ingestMs: day.ingestMs })),
  })
}, 3 * 3_600_000) // UTILTS ingest ≈1.46 s per value (finding 007): 2688 values ≈ 65 min, plus margin

afterAll(async () => {
  // Written even when a step failed, so the substitutions of a partial run stay visible.
  writeArtifact('substitutions.json', SUBSTITUTIONS)
  writeArtifact('timings.json', TIMINGS)
  writeArtifact('results.json', results)
  // This is only an unqualified candidate. Actual reports/process exit do not
  // exist until after this hook; a separately admitted post-run CLI seals it.
  if (completed.length === 5) await captureMain03Candidate(cohortContext, fx, completed, results)
})

// ------------------------------------------------------------------ DB readers

const company = () => lit(fx.companyId)

/** [startMs, "canonical kWh"] pairs, ordered, for a table scoped by company (+ extra predicate). */
function intervalRows(table: string, quantityColumn: string, predicate: string): Array<[number, string]> {
  return dbRead<Array<[number, string]>>(`SELECT coalesce(jsonb_agg(jsonb_build_array((extract(epoch from period_start)*1000)::bigint, trim_scale(${quantityColumn})::text) ORDER BY period_start, id),'[]'::jsonb)
    FROM ${table} WHERE company_id=${company()} AND ${predicate}`)
}

function oracleIntervalPairs(): string[] { return fx.oracle.intervals.map(interval => `${interval.startMs}:${interval.milliKwh}`) }
const pairKey = ([start, quantity]: [number, string]) => `${start}:${parseMilliKwh(quantity)}`

function graph() {
  return dbRead<{ underlays: number; underlayIds: string[]; items: number; events: number; bindings: number; periodLocks: number; pricingRuns: number }>(`SELECT jsonb_build_object(
    'underlays',(SELECT count(*) FROM public.billing_underlays WHERE company_id=${company()} AND underlay_year=2027 AND underlay_month=2),
    'underlayIds',coalesce((SELECT jsonb_agg(id ORDER BY id) FROM public.billing_underlays WHERE company_id=${company()} AND underlay_year=2027 AND underlay_month=2),'[]'::jsonb),
    'items',(SELECT count(*) FROM public.billing_underlay_items i WHERE i.company_id=${company()} AND i.billing_underlay_id IN (SELECT id FROM public.billing_underlays WHERE company_id=${company()} AND underlay_year=2027 AND underlay_month=2)),
    'events',(SELECT count(*) FROM public.billing_underlay_events e WHERE e.company_id=${company()}),
    'bindings',(SELECT count(*) FROM gridex_billing_source.underlay_bindings WHERE company_id=${company()}),
    'periodLocks',(SELECT count(*) FROM public.billing_period_locks WHERE company_id=${company()}),
    'pricingRuns',(SELECT count(*) FROM public.pricing_runs WHERE company_id=${company()}))`)
}

/** Row counts and content digest of every table the read-only steps must not touch. */
function mutationFingerprint() {
  const tables: Array<[string, string]> = [
    ['normalized_metering_values', 'company_id'], ['metering_values', 'company_id'], ['billing_underlays', 'company_id'], ['billing_underlay_items', 'company_id'],
    ['billing_underlay_events', 'company_id'], ['ediel_messages', 'company_id'], ['customer_supply_periods', 'company_id'], ['customer_contracts', 'company_id'],
    ['contract_price_snapshots', 'company_id'], ['pricing_runs', 'company_id'], ['billing_period_locks', 'company_id'], ['ediel_unresolved_items', 'company_id'],
  ]
  const parts = tables.map(([table, column]) => `'${table}',(SELECT jsonb_build_object('rows',count(*),'digest',coalesce(md5(string_agg(to_jsonb(x)::text,'|' ORDER BY to_jsonb(x)::text)),'')) FROM public.${table} x WHERE x.${column}=${company()})`)
  return dbRead<Record<string, { rows: number; digest: string }>>(`SELECT jsonb_build_object(${parts.join(',')})`)
}

function periodLockRead(): Promise<{ status: number; isLocked: unknown; lock: unknown }> {
  return http(fx.session, 'GET', `/api/internal/billing/period-locks?billing_month=${BILLING_MONTH}`).then(response => {
    const data = ((response.body as { data?: { isLocked?: unknown; lock?: unknown } } | null)?.data ?? {})
    return { status: response.status, isLocked: data.isLocked, lock: data.lock ?? null }
  })
}

type Saved = { status: number; ms: number; body: Record<string, unknown> | null; attempts: number }
let saved: Saved | null = null

async function ensureSaved(): Promise<Saved> {
  if (saved) return saved
  const response = await timed('api: generate-underlay (normal)', () => http(fx.session, 'POST', '/api/internal/billing/generate-underlay', { json: { billing_month: BILLING_MONTH } }))
  saved = { status: response.status, ms: response.ms, body: response.body as Record<string, unknown> | null, attempts: 1 }
  return saved
}

// -------------------------------------------------------------------- scenarios

describe('MAIN03 full month, one customer, 28 daily sources', () => {
  it('MAIN03.01 Februari 2027 har exakt 2688 sammanhängande kvartsintervall för en kund, en anläggning och en mätpunkt', () => {
    const shape = dbRead<Record<string, unknown>>(`SELECT jsonb_build_object(
      'rows',count(*),'distinctStarts',count(DISTINCT period_start),'distinctEnds',count(DISTINCT period_end),
      'quarterLong',count(*) FILTER (WHERE period_end-period_start=interval '15 minutes'),
      'minStartMs',(extract(epoch from min(period_start))*1000)::bigint,'maxEndMs',(extract(epoch from max(period_end))*1000)::bigint,
      'points',count(DISTINCT metering_point_id),'customers',count(DISTINCT customer_id),'supplyPeriods',count(DISTINCT supply_period_id),
      'kwhUnits',jsonb_agg(DISTINCT unit),'current',count(*) FILTER (WHERE revision_status='current'),
      'billable',count(*) FILTER (WHERE billing_status='billable' AND billing_gate_status='eligible'),
      'sources',count(DISTINCT source_message_id),'sumKwh',trim_scale(sum(quantity_kwh))::text)
      FROM public.normalized_metering_values WHERE company_id=${company()}`) as {
      rows: number; distinctStarts: number; distinctEnds: number; quarterLong: number; minStartMs: number; maxEndMs: number; points: number; customers: number
      supplyPeriods: number; kwhUnits: string[]; current: number; billable: number; sources: number; sumKwh: string
    }
    const entities = dbRead<{ customers: number; sites: number; points: number }>(`SELECT jsonb_build_object(
      'customers',(SELECT count(*) FROM public.customers WHERE company_id=${company()}),
      'sites',(SELECT count(*) FROM public.customer_sites WHERE company_id=${company()}),
      'points',(SELECT count(*) FROM public.metering_points WHERE company_id=${company()}))`)
    results['MAIN03.01'] = { shape, entities }
    expect(fx.oracle.intervalCount).toBe(28 * QUARTERS_PER_DAY)
    expect(shape.rows).toBe(2688)
    expect(shape.distinctStarts).toBe(2688)
    expect(shape.distinctEnds).toBe(2688)
    expect(shape.quarterLong).toBe(2688)
    expect(shape.minStartMs).toBe(fx.oracle.month.startMs) // 2027-02-01T00:00 +01:00
    expect(shape.maxEndMs).toBe(fx.oracle.month.endMs) // 2027-03-01T00:00 +01:00
    expect(shape.points).toBe(1)
    expect(shape.customers).toBe(1)
    expect(shape.supplyPeriods).toBe(1)
    expect(shape.kwhUnits).toEqual(['kWh'])
    expect(shape.current).toBe(2688)
    expect(shape.billable).toBe(2688)
    expect(shape.sources).toBe(28)
    expect(entities).toEqual({ customers: 1, sites: 1, points: 1 })
    // Contiguity and per-interval quantity against the oracle's independent list.
    const actual = intervalRows('public.normalized_metering_values', 'quantity_kwh', `revision_status='current'`).map(pairKey)
    expect(actual).toEqual(oracleIntervalPairs())
    expect(parseMilliKwh(shape.sumKwh)).toBe(fx.oracle.totalMilliKwh)
    completed.push('MAIN03.01')
  })

  it('MAIN03.02 Alla 28 dygnskällor är kopplade till exakt sina 96 intervall', () => {
    const sources = dbRead<Array<{ source: string; hash: string; qtyLines: number; n: number; minMs: number; maxMs: number; sum: string; txCount: number; tx: string | null; bgm: string | null; mv: number }>>(`SELECT coalesce(jsonb_agg(jsonb_build_object(
      'source',s.id,'hash',encode(sha256(convert_to(s.raw_payload,'UTF8')),'hex'),
      'qtyLines',(SELECT count(*) FROM regexp_matches(s.raw_payload,'QTY\\+136:','g')),
      'n',x.n,'minMs',x.min_ms,'maxMs',x.max_ms,'sum',x.sum_kwh,'txCount',x.tx_count,'tx',x.tx,
      'bgm',substring(s.raw_payload from 'BGM\\+E66::260\\+([^+]+)\\+'),
      'mv',(SELECT count(*) FROM public.metering_values m WHERE m.company_id=s.company_id AND m.source_ediel_message_id=s.id))
      ORDER BY x.min_ms),'[]'::jsonb)
      FROM public.ediel_messages s
      LEFT JOIN LATERAL (SELECT count(*) n,(extract(epoch from min(n.period_start))*1000)::bigint min_ms,(extract(epoch from max(n.period_end))*1000)::bigint max_ms,
        trim_scale(sum(n.quantity_kwh))::text sum_kwh,count(DISTINCT n.source_transaction_reference) tx_count,min(n.source_transaction_reference) tx
        FROM public.normalized_metering_values n WHERE n.company_id=s.company_id AND n.source_message_id=s.id) x ON true
      WHERE s.company_id=${company()} AND s.message_family='UTILTS' AND s.message_code='E66' AND s.direction='inbound'`)
    results['MAIN03.02'] = sources.map(source => ({ source: source.source, n: source.n, mv: source.mv, sum: source.sum }))
    expect(sources).toHaveLength(28)
    expect(new Set(sources.map(source => source.source)).size).toBe(28)
    expect(new Set(sources.map(source => source.hash)).size).toBe(28)
    expect(new Set(sources.map(source => source.tx)).size).toBe(28)
    expect(new Set(sources.map(source => source.bgm)).size).toBe(28)
    for (const day of fx.oracle.perDay) {
      const record = fx.days[day.day - 1]
      const source = sources.find(candidate => candidate.source === record.sourceId)
      expect(source, `day ${day.day} source row`).toBeDefined()
      const dayStart = fx.oracle.month.startMs + (day.day - 1) * 86_400_000
      expect(source!.hash, `day ${day.day} payload hash`).toBe(record.rawSha256)
      expect(source!.qtyLines, `day ${day.day} QTY+136 lines in the original`).toBe(96)
      expect(source!.n, `day ${day.day} normalized intervals`).toBe(96)
      expect(source!.mv, `day ${day.day} metering values`).toBe(96)
      expect(source!.minMs, `day ${day.day} first interval`).toBe(dayStart)
      expect(source!.maxMs, `day ${day.day} last interval end`).toBe(dayStart + 86_400_000)
      expect(source!.txCount, `day ${day.day} transaction references`).toBe(1)
      expect(source!.tx, `day ${day.day} transaction reference`).toBe(record.transactionRef)
      expect(parseMilliKwh(source!.sum), `day ${day.day} kWh`).toBe(day.milliKwh)
      expect(new Set(record.normalizedIds).size).toBe(96)
    }
    // No interval belongs to two sources: the union of the per-source ids is the whole month.
    const all = new Set(fx.days.flatMap(day => day.normalizedIds))
    expect(all.size).toBe(2688)
    completed.push('MAIN03.02')
  })

  it('MAIN03.03 Tre läsningar av källunderlaget före sparande ger identiskt resultat och inga mutationer', async () => {
    const ids = dbRead<string[]>(`SELECT jsonb_agg(id ORDER BY id) FROM public.normalized_metering_values WHERE company_id=${company()} AND revision_status='current'`)
    expect(ids).toHaveLength(2688)
    const before = mutationFingerprint()
    const hashes: string[] = []
    const qualified: number[] = []
    const read = async () => {
      const rows = await loadQualifiedBillingValues(fx.companyId, ids) // lib/billing/sourceBasis.ts -> rpc gridex_read_billing_source_values_v1
      const ordered = ids.map(id => rows.get(id)!)
      qualified.push(ordered.filter(row => (row.billing_source_basis as { qualified?: boolean }).qualified === true).length)
      return sha256Json(ordered)
    }
    for (let attempt = 0; attempt < 3; attempt++) hashes.push(await timed(`MAIN03.03 read ${attempt + 1}`, read))
    const after = mutationFingerprint()
    results['MAIN03.03'] = { hashes, qualified, fingerprintBefore: before, fingerprintAfter: after }
    expect(qualified).toEqual([2688, 2688, 2688])
    expect(hashes[1]).toBe(hashes[0])
    expect(hashes[2]).toBe(hashes[0])
    expect(after).toEqual(before)
    completed.push('MAIN03.03')
  }, 900_000)

  it('MAIN03.05 Okänt utfall: avbruten sparning läses i DB-graf och periodlås före nytt försök, utan dubblett', async () => {
    const beforeCall = graph()
    const lockBefore = await periodLockRead()
    expect(beforeCall.underlays, 'no underlay may exist before the first save attempt').toBe(0)
    expect(lockBefore.status).toBe(200)
    expect(lockBefore.isLocked).toBe(false)

    // First save attempt: the client gives up after 400 ms and never sees the response.
    const nativeOperationId = cohortContext.admission.operationId
    const attempt = await timed('MAIN03.05 aborted generate-underlay', () => http(fx.session, 'POST', '/api/internal/billing/generate-underlay', { json: { billing_month: BILLING_MONTH }, headers: { 'X-Request-ID': nativeOperationId }, abortAfterMs: 400 }))
    const provoked = attempt.aborted
    results['MAIN03.05'] = { provokedUnknownOutcome: provoked, abortedAfterMs: attempt.ms, firstAttemptStatus: attempt.status, beforeCall, lockBefore }
    expect(provoked, `HARNESS_PRECONDITION: MAIN03.05 requires an observed client abort before the first response; received status ${attempt.status} in ${attempt.ms} ms. A qualified unknown-outcome stimulus is required before this scenario can pass.`).toBe(true)

    // Read the actual graph and the period lock BEFORE any retry; then wait for the server side to settle.
    const justAfter = graph()
    const lockJustAfter = await periodLockRead()
    let settled = justAfter
    let stableRounds = 0, lastKey = JSON.stringify(justAfter)
    const deadline = Date.now() + 300_000
    while (Date.now() < deadline) {
      await sleep(3000)
      settled = graph()
      const key = JSON.stringify(settled)
      stableRounds = key === lastKey ? stableRounds + 1 : 0
      lastKey = key
      if (settled.underlays > 0 && stableRounds >= 3) break
      if (settled.underlays === 0 && stableRounds >= 20) break // the server gave up without effect: nothing to wait for
    }
    const lockSettled = await periodLockRead()

    // Polling establishes only an observed graph. The original handler must
    // have a genuine correlated native terminal and independent permit before
    // this still-live callback can issue its single retry.
    await awaitMain03RetryPermit(cohortContext, fx, { nativeOperationId, aborted: provoked,
      abortedAfterMs: attempt.ms, beforeCall, justAfter, settled, lockBefore, lockJustAfter, lockSettled })

    // Retry after having looked: must neither duplicate nor change the lock.
    const retry = await timed('MAIN03.05 retry generate-underlay', () => http(fx.session, 'POST', '/api/internal/billing/generate-underlay', { json: { billing_month: BILLING_MONTH } }))
    saved = { status: retry.status, ms: retry.ms, body: retry.body as Record<string, unknown> | null, attempts: 2 }
    const afterRetry = graph()
    const lockAfter = await periodLockRead()
    results['MAIN03.05'] = { provokedUnknownOutcome: provoked, abortedAfterMs: attempt.ms, beforeCall, justAfter, settled, afterRetry, lockBefore, lockJustAfter, lockSettled, lockAfter, retryStatus: retry.status }

    expect(retry.status).toBe(200)
    expect(afterRetry.underlays).toBe(1)
    expect(afterRetry.items).toBe(2688)
    expect(afterRetry.bindings).toBe(1)
    if (settled.underlays === 1) {
      expect(afterRetry.underlayIds).toEqual(settled.underlayIds)
      expect(afterRetry.events, 'a replay must not append events to an already stored graph').toBe(settled.events)
      expect(afterRetry.items).toBe(settled.items)
    }
    for (const lock of [lockJustAfter, lockSettled, lockAfter]) {
      expect(lock.status).toBe(200)
      expect(lock.isLocked).toBe(false)
    }
    expect(afterRetry.periodLocks).toBe(beforeCall.periodLocks)
    completed.push('MAIN03.05')
  }, 900_000)

  it('MAIN03.04 Sparat underlag: 2688 källintervall, kWh-total och prisbelopp exakt lika med oraklet', async () => {
    const save = await ensureSaved()
    expect(save.status, JSON.stringify(save.body)?.slice(0, 600)).toBe(200)
    const data = ((save.body as { data?: Record<string, unknown> } | null)?.data ?? {}) as Record<string, unknown>
    expect(data.sourceRows).toBe(2688)
    expect(data.underlays).toBe(1)
    expect(data.readyForPricing).toBe(1)
    expect(data.needsReview).toBe(0)

    const underlays = dbRead<Array<Record<string, unknown>>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status,'readiness',readiness_status,'direction',energy_direction,'settlement',settlement_type,
      'year',underlay_year,'month',underlay_month,'totalKwh',trim_scale(total_kwh)::text,'sourceCount',source_meter_value_count,'missing',missing_values_count,'priceArea',price_area,
      'customer',customer_id,'point',metering_point_id,'contract',contract_id,'supply',supply_period_id,'start',billing_period_start,'end',billing_period_end)),'[]'::jsonb)
      FROM public.billing_underlays WHERE company_id=${company()} AND underlay_year=2027 AND underlay_month=2`)
    expect(underlays).toHaveLength(1)
    const underlay = underlays[0]
    expect(underlay).toMatchObject({ status: 'validated', readiness: 'ready', direction: 'consumption', year: 2027, month: 2, sourceCount: 2688, missing: 0, priceArea: 'SE3',
      customer: fx.customerId, point: fx.pointId, contract: fx.contractId, supply: fx.supplyPeriodId })
    expect(parseMilliKwh(String(underlay.totalKwh))).toBe(fx.oracle.totalMilliKwh)
    const underlayId = String(underlay.id)

    const items = intervalRows('public.billing_underlay_items', 'quantity_kwh', `billing_underlay_id=${lit(underlayId)}`)
    expect(items).toHaveLength(2688)
    expect(items.map(pairKey)).toEqual(oracleIntervalPairs())
    const itemShape = dbRead<{ distinctSources: number; fromCurrentNormalized: number }>(`SELECT jsonb_build_object('distinctSources',count(DISTINCT i.source_normalized_metering_value_id),
      'fromCurrentNormalized',count(*) FILTER (WHERE EXISTS(SELECT FROM public.normalized_metering_values n WHERE n.id=i.source_normalized_metering_value_id AND n.company_id=i.company_id AND n.revision_status='current' AND n.period_start=i.period_start)))
      FROM public.billing_underlay_items i WHERE i.company_id=${company()} AND i.billing_underlay_id=${lit(underlayId)}`)
    expect(itemShape).toEqual({ distinctSources: 2688, fromCurrentNormalized: 2688 })

    const basis = await supabaseService.rpc('gridex_read_billing_underlay_source_basis_v1', { p_company_id: fx.companyId, p_underlay_ids: [underlayId] })
    expect(basis.error).toBeNull()
    expect((basis.data as Array<Record<string, unknown>>)[0]).toMatchObject({ id: underlayId, qualified: true, correctionRequired: false })
    expect(parseMilliKwh(String((basis.data as Array<Record<string, unknown>>)[0].totalKwh))).toBe(fx.oracle.totalMilliKwh)

    // Prices: normal entry /api/internal/pricing/preview (persist). Expectations come from the oracle only.
    const priced = await timed('api: pricing/preview', () => http(fx.session, 'POST', '/api/internal/pricing/preview', { json: { billing_underlay_id: underlayId, persist: true } }))
    expect(priced.status, JSON.stringify(priced.body)?.slice(0, 800)).toBe(200)
    const pricing = ((priced.body as { data?: Record<string, unknown> } | null)?.data ?? {}) as { status?: string; totalExVat?: number; vatAmount?: number; totalIncVat?: number; pricingRunId?: string | null; errors?: string[]; warnings?: string[]
      lines?: Array<{ lineType: string; description: string; unit: string; amountExVat: number; vatAmount: number; quantity: number | null; metadata?: Record<string, unknown> }> }
    const lines = pricing.lines ?? []
    const cents = (value: number | undefined) => Math.round((value ?? Number.NaN) * 100)
    const lineSummary = lines.map(line => ({ type: line.lineType, description: line.description, unit: line.unit, amountCents: cents(line.amountExVat), vatCents: cents(line.vatAmount), quantity: line.quantity, source: line.metadata?.source_type ?? null, component: line.metadata?.component_code ?? null }))
    results['MAIN03.04'] = { underlayId, pricingRunId: pricing.pricingRunId, lineSummary, apiTotals: { exVat: pricing.totalExVat, vat: pricing.vatAmount, incVat: pricing.totalIncVat }, warnings: pricing.warnings, errors: pricing.errors,
      oracle: { totalKwh: fx.oracle.totalKwhText, spot: centsText(fx.oracle.lines.spotCents), markup: centsText(fx.oracle.lines.markupCents), monthlyFee: centsText(fx.oracle.lines.monthlyFeeCents),
        totalExVat: centsText(fx.oracle.totalExVatCents), vat: centsText(fx.oracle.vatCents.total), totalIncVat: centsText(fx.oracle.totalIncVatCents) } }
    expect(pricing.status, JSON.stringify({ errors: pricing.errors, warnings: pricing.warnings })).toBe('success')
    const spotLines = lineSummary.filter(line => line.source === 'spot')
    // Classified by what the line is (per-kWh add-on vs fixed monthly charge), not by the app's component codes.
    const markupLines = lineSummary.filter(line => line.source !== 'spot' && line.type !== 'base_price' && line.unit === 'kWh')
    const feeLines = lineSummary.filter(line => line.source !== 'spot' && line.unit === 'månad')
    expect(spotLines.map(line => line.amountCents), 'spot energy line').toEqual([fx.oracle.lines.spotCents])
    expect(spotLines[0].quantity).toBeCloseTo(fx.oracle.totalMilliKwh / 1000, 6)
    expect(markupLines.map(line => line.amountCents), 'markup line').toEqual([fx.oracle.lines.markupCents])
    expect(feeLines.map(line => line.amountCents), 'monthly fee line').toEqual([fx.oracle.lines.monthlyFeeCents])
    expect(lineSummary, 'no other price lines than spot, markup and monthly fee').toHaveLength(3)
    expect(cents(pricing.totalExVat)).toBe(fx.oracle.totalExVatCents)
    expect(cents(pricing.vatAmount)).toBe(fx.oracle.vatCents.total)
    expect(cents(pricing.totalIncVat)).toBe(fx.oracle.totalIncVatCents)

    // The persisted run and the per-interval evidence agree with the oracle's independent price per interval.
    const run = dbRead<{ runs: number; status: string | null; exVat: string | null; incVat: string | null; evidence: number; evidenceKwh: string | null }>(`SELECT jsonb_build_object(
      'runs',(SELECT count(*) FROM public.pricing_runs WHERE company_id=${company()} AND billing_underlay_id=${lit(underlayId)}),
      'status',(SELECT status FROM public.pricing_runs WHERE company_id=${company()} AND billing_underlay_id=${lit(underlayId)} ORDER BY created_at DESC LIMIT 1),
      'exVat',(SELECT total_ex_vat::text FROM public.pricing_runs WHERE company_id=${company()} AND billing_underlay_id=${lit(underlayId)} ORDER BY created_at DESC LIMIT 1),
      'incVat',(SELECT total_inc_vat::text FROM public.pricing_runs WHERE company_id=${company()} AND billing_underlay_id=${lit(underlayId)} ORDER BY created_at DESC LIMIT 1),
      'evidence',(SELECT count(*) FROM public.pricing_interval_evidence WHERE company_id=${company()} AND billing_underlay_id=${lit(underlayId)}),
      'evidenceKwh',(SELECT trim_scale(sum(consumption_kwh))::text FROM public.pricing_interval_evidence WHERE company_id=${company()} AND billing_underlay_id=${lit(underlayId)}))`)
    expect(run.runs).toBeGreaterThanOrEqual(1)
    expect(cents(Number(run.exVat))).toBe(fx.oracle.totalExVatCents)
    expect(cents(Number(run.incVat))).toBe(fx.oracle.totalIncVatCents)
    expect(run.evidence).toBe(2688)
    expect(parseMilliKwh(String(run.evidenceKwh))).toBe(fx.oracle.totalMilliKwh)
    const evidence = dbRead<Array<[number, number]>>(`SELECT coalesce(jsonb_agg(jsonb_build_array((extract(epoch from metering_interval_start)*1000)::bigint, round(price_sek_per_kwh*100000)::bigint) ORDER BY metering_interval_start),'[]'::jsonb)
      FROM public.pricing_interval_evidence WHERE company_id=${company()} AND billing_underlay_id=${lit(underlayId)} AND pricing_run_id=(SELECT id FROM public.pricing_runs WHERE company_id=${company()} AND billing_underlay_id=${lit(underlayId)} ORDER BY created_at DESC LIMIT 1)`)
    expect(evidence.map(([start, e5]) => `${start}:${e5}`)).toEqual(fx.oracle.intervals.map(interval => `${interval.startMs}:${interval.spotE5}`))
    const underlayAfter = dbRead<{ incVat: string | null }>(`SELECT jsonb_build_object('incVat',calculated_total_sek_inc_vat::text) FROM public.billing_underlays WHERE id=${lit(underlayId)}`)
    expect(cents(Number(underlayAfter.incVat))).toBe(fx.oracle.totalIncVatCents)
    completed.push('MAIN03.04')
  }, 900_000)
})
