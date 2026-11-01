// simulation: SITE01.01, SITE01.02, SITE01.03, SITE01.04, SITE01.05
//
// SITE01 — ONE synthetic customer with TWO separate sites (own metering point, grid owner/area, price area, contract) in one company.
//   site A: SE3, area TES, contract start 2026-09-01, 4 ore/kWh + 49 SEK/month, active the whole of September 2026.
//   site B: SE4, area TEB, contract start 2026-09-16 (mid month), 9 ore/kWh + 79 SEK/month, delivery ENDS 2026-09-25;
//           UTILTS files are delivered to 2026-09-30 so the days after the end can be proven NOT billed.
// Billing month is 2026-09, not February 2027: a normal supply start only activates (and so becomes billable) once it is due, and the stack's
// clock is real; see SITE01_BILLING_MONTH in fixtures/site01Synthetic.ts. Pricing/rounding/proration rules and their file:line citations are
// documented there; every expected number below comes from the oracle built from the fixture's own inputs.
//
// Browser: none. HTTP against the running app for generate-underlay, pricing and prepare; approve and invoice-file creation call the library
// functions the server actions call (SUBSTITUTE, below). Stored results are read with read-only psql.
//
// SITE01.05 is split on purpose so the verdicts are independent: 05 (prepare, observed invoice model), 05a (consolidated invoice, expected
// to FAIL with FEATURE_GAP when the model is one invoice per site) and 05b (one invoice FILE with both invoices and per-row site facts).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: vi.fn() }) } }))
vi.mock('server-only', () => ({}))
import { approveAndSendReadyInvoicesForMonth } from '@/lib/billing/invoiceApprovedDispatch'
import { createInvoiceFile } from '@/lib/billing/invoiceFileExport'
import { buildSite01Fixture, type Site01Fixture, type SiteRuntime } from '../fixtures/site01Fixture'
import { SITE_A, SITE_B, SITE01_BILLING_MONTH, type SiteKey } from '../fixtures/site01Synthetic'
import { SUBSTITUTIONS, resetSubstitutions, substitute } from '../fixtures/substitutions'
import { dbRead, http, lit, TIMINGS, timed, writeArtifact } from '../fixtures/runtime'
import { cents, enableFileInvoiceProvider } from '../fixtures/main04Support'
import { centsText, hourlySpotE5, parseMilliKwh, syntheticMonth } from '../fixtures/synthetic'

let fx: Site01Fixture
const results: Record<string, unknown> = {}
const KEYS: SiteKey[] = ['A', 'B']
const company = () => lit(fx.companyId)
const month = () => syntheticMonth(SITE01_BILLING_MONTH)

beforeAll(async () => {
  resetSubstitutions()
  fx = await buildSite01Fixture()
  writeArtifact('site01-fixture.json', {
    note: 'ids only; no secrets or session material', companyId: fx.companyId, customerId: fx.customerId, actorUserId: fx.actorUserId, ownEdielId: fx.ownEdielId, spotLocks: fx.spotLocks, supplyEnd: fx.supplyEnd,
    sites: Object.fromEntries(KEYS.map(key => { const s = fx.sites[key]; return [key, { spec: s.spec, siteId: s.siteId, pointId: s.pointId, contractId: s.contractId, gridOwnerId: s.gridOwnerId, gridOwnerEdielId: s.gridOwnerEdielId, external: s.external, supplyPeriodId: s.supplyPeriodId,
      oracle: { salt: s.oracle.consumptionSalt, intervals: s.oracle.intervals.length, totalKwh: s.oracle.totalKwhText, lines: s.oracle.lines, vatCents: s.oracle.vatCents, totalExVatCents: s.oracle.totalExVatCents, totalIncVatCents: s.oracle.totalIncVatCents } }] })),
    days: fx.days.map(day => ({ site: day.site, day: day.day, sourceId: day.sourceId, transactionRef: day.transactionRef, rawSha256: day.rawSha256, values: day.meteringValueIds.length, ms: day.ms })),
  })
}, 5_400_000)

afterAll(() => {
  writeArtifact('site01-substitutions.json', SUBSTITUTIONS)
  writeArtifact('site01-timings.json', TIMINGS)
  writeArtifact('site01-results.json', results)
})

// ------------------------------------------------------------------ readers

type UnderlayRow = { id: string; status: string; readiness: string; direction: string; customer: string; point: string; site: string | null; contract: string; supply: string; snapshot: string | null
  priceArea: string | null; gridOwner: string | null; totalKwh: string; sourceCount: number; missing: number; start: string; end: string }

function readUnderlays(): Record<SiteKey, UnderlayRow | undefined> {
  const rows = dbRead<UnderlayRow[]>(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status,'readiness',readiness_status,'direction',energy_direction,'customer',customer_id,'point',metering_point_id,
    'site',coalesce(customer_site_id,site_id),'contract',contract_id,'supply',supply_period_id,'snapshot',contract_price_snapshot_id,'priceArea',price_area,'gridOwner',grid_owner_id,
    'totalKwh',trim_scale(total_kwh)::text,'sourceCount',source_meter_value_count,'missing',missing_values_count,'start',billing_period_start,'end',billing_period_end)),'[]'::jsonb)
    FROM public.billing_underlays WHERE company_id=${company()} AND underlay_year=2026 AND underlay_month=9`)
  const byPoint = new Map(rows.map(row => [row.point, row]))
  return { A: byPoint.get(fx.sites.A.pointId), B: byPoint.get(fx.sites.B.pointId) }
}

function itemPairs(underlayId: string): Array<[number, string]> {
  return dbRead<Array<[number, string]>>(`SELECT coalesce(jsonb_agg(jsonb_build_array((extract(epoch from period_start)*1000)::bigint, trim_scale(quantity_kwh)::text) ORDER BY period_start, id),'[]'::jsonb)
    FROM public.billing_underlay_items WHERE company_id=${company()} AND billing_underlay_id=${lit(underlayId)}`)
}
const pairKey = ([start, quantity]: [number, string]) => `${start}:${parseMilliKwh(quantity)}`
const oraclePairs = (site: SiteRuntime) => site.oracle.intervals.map(interval => `${interval.startMs}:${interval.milliKwh}`)

type Saved = { status: number; body: Record<string, unknown> | null }
let saved: Saved | null = null
async function ensureSaved(): Promise<Saved> {
  if (saved) return saved
  const response = await timed('api: generate-underlay (normal)', () => http(fx.session, 'POST', '/api/internal/billing/generate-underlay', { json: { billing_month: SITE01_BILLING_MONTH } }))
  saved = { status: response.status, body: response.body as Record<string, unknown> | null }
  return saved
}

type PricingLine = { lineType: string; unit: string; amountExVat: number; vatAmount: number; quantity: number | null; metadata?: Record<string, unknown> }
const priced: Partial<Record<SiteKey, { runId: string | null; lines: Array<{ type: string; unit: string; source: unknown; amountCents: number; quantity: number | null }>; totals: { ex: number; vat: number; inc: number } }>> = {}

async function priceUnderlay(key: SiteKey, underlayId: string) {
  if (priced[key]) return priced[key]!
  const response = await timed(`api: pricing/preview ${key}`, () => http(fx.session, 'POST', '/api/internal/pricing/preview', { json: { billing_underlay_id: underlayId, persist: true } }))
  expect(response.status, JSON.stringify(response.body)?.slice(0, 800)).toBe(200)
  const data = ((response.body as { data?: Record<string, unknown> } | null)?.data ?? {}) as { status?: string; totalExVat?: number; vatAmount?: number; totalIncVat?: number; pricingRunId?: string | null; errors?: string[]; warnings?: string[]; lines?: PricingLine[] }
  expect(data.status, JSON.stringify({ errors: data.errors, warnings: data.warnings })).toBe('success')
  priced[key] = {
    runId: data.pricingRunId ?? null,
    lines: (data.lines ?? []).map(line => ({ type: line.lineType, unit: line.unit, source: line.metadata?.source_type ?? null, amountCents: cents(line.amountExVat), quantity: line.quantity })),
    totals: { ex: cents(data.totalExVat), vat: cents(data.vatAmount), inc: cents(data.totalIncVat) },
  }
  return priced[key]!
}

describe('SITE01 one customer, two sites', () => {
  it('SITE01.01 Två aktiva sites, samma kund och månad, ger två separata underlag utan sammanblandning', async () => {
    const save = await ensureSaved()
    expect(save.status, JSON.stringify(save.body)?.slice(0, 600)).toBe(200)
    const data = ((save.body as { data?: Record<string, unknown> } | null)?.data ?? {}) as Record<string, unknown>
    const expectedRows = fx.sites.A.oracle.intervals.length + fx.sites.B.oracle.intervals.length
    results['SITE01.01.response'] = { sourceRows: data.sourceRows, underlays: data.underlays, readyForPricing: data.readyForPricing, needsReview: data.needsReview }
    expect(data.sourceRows).toBe(expectedRows)
    expect(data.underlays).toBe(2)
    expect(data.readyForPricing).toBe(2)
    expect(data.needsReview).toBe(0)

    const underlays = readUnderlays()
    results['SITE01.01.underlays'] = underlays
    const a = underlays.A!, b = underlays.B!
    expect(a, 'underlay for site A').toBeDefined()
    expect(b, 'underlay for site B').toBeDefined()
    expect(a.id).not.toBe(b.id)
    for (const key of KEYS) {
      const site = fx.sites[key], row = underlays[key]!
      expect(row, `site ${key}`).toMatchObject({ status: 'validated', readiness: 'ready', direction: 'consumption', customer: fx.customerId, point: site.pointId, site: site.siteId, contract: site.contractId, supply: site.supplyPeriodId, missing: 0 })
    }
    expect(a.contract).not.toBe(b.contract)
    expect(a.supply).not.toBe(b.supply)
    expect(a.point).not.toBe(b.point)
    // Per-underlay items belong to exactly that underlay's metering point and are never shared.
    const mix = dbRead<{ perUnderlay: Array<{ id: string; items: number; points: number; foreignPoint: number }>; shared: number; total: number }>(`SELECT jsonb_build_object(
      'perUnderlay',(SELECT jsonb_agg(jsonb_build_object('id',u.id,'items',(SELECT count(*) FROM public.billing_underlay_items i WHERE i.billing_underlay_id=u.id),
        'points',(SELECT count(DISTINCT i.metering_point_id) FROM public.billing_underlay_items i WHERE i.billing_underlay_id=u.id),
        'foreignPoint',(SELECT count(*) FROM public.billing_underlay_items i JOIN public.normalized_metering_values n ON n.id=i.source_normalized_metering_value_id
          WHERE i.billing_underlay_id=u.id AND (n.metering_point_id IS DISTINCT FROM u.metering_point_id OR i.metering_point_id IS DISTINCT FROM u.metering_point_id)))
        ORDER BY u.metering_point_id) FROM public.billing_underlays u WHERE u.company_id=${company()} AND u.underlay_year=2026 AND u.underlay_month=9),
      'shared',(SELECT count(*) FROM (SELECT source_normalized_metering_value_id FROM public.billing_underlay_items WHERE company_id=${company()} GROUP BY 1 HAVING count(*)>1) x),
      'total',(SELECT count(*) FROM public.billing_underlay_items WHERE company_id=${company()}))`)
    results['SITE01.01.mix'] = mix
    expect(mix.total).toBe(expectedRows)
    expect(mix.shared).toBe(0)
    for (const entry of mix.perUnderlay) { expect(entry.points).toBe(1); expect(entry.foreignPoint).toBe(0) }
    expect(Object.fromEntries(mix.perUnderlay.map(entry => [entry.id, entry.items]))).toEqual({ [a.id]: fx.sites.A.oracle.intervals.length, [b.id]: fx.sites.B.oracle.intervals.length })
    // Each underlay holds exactly its own oracle intervals and kWh.
    for (const key of KEYS) {
      const site = fx.sites[key], row = underlays[key]!
      expect(parseMilliKwh(row.totalKwh), `site ${key} total kWh`).toBe(site.oracle.totalMilliKwh)
      expect(itemPairs(row.id).map(pairKey), `site ${key} item intervals`).toEqual(oraclePairs(site))
    }
  }, 900_000)

  it('SITE01.02 Olika avtalsstart och prisvillkor: varje underlag använder sitt eget avtals snapshot, bara intervall från sin start, belopp enligt oraklet', async () => {
    await ensureSaved()
    const underlays = readUnderlays()
    const contracts = dbRead<Record<string, { startsAt: string | null; requestedStart: string | null; status: string; planVersion: string | null; snapshots: Array<{ id: string; planVersion: string | null; validFrom: string | null }> }>>(`SELECT jsonb_object_agg(c.id,jsonb_build_object(
      'startsAt',c.starts_at,'requestedStart',c.requested_start_date,'status',c.status,'planVersion',c.price_plan_version_id,
      'snapshots',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'planVersion',s.price_plan_version_id,'validFrom',s.valid_from)) FROM public.contract_price_snapshots s WHERE s.company_id=c.company_id AND s.contract_id=c.id),'[]'::jsonb)))
      FROM public.customer_contracts c WHERE c.company_id=${company()}`)
    results['SITE01.02.contracts'] = contracts
    const cA = contracts[fx.sites.A.contractId], cB = contracts[fx.sites.B.contractId]
    expect(String(cA.startsAt).slice(0, 10)).toBe(SITE_A.startDate)
    expect(String(cB.startsAt).slice(0, 10)).toBe(SITE_B.startDate)
    expect(cA.planVersion).not.toBe(cB.planVersion)
    for (const key of KEYS) {
      const site = fx.sites[key], row = underlays[key]!, contract = contracts[site.contractId]
      // The underlay carries the snapshot of ITS OWN contract; the other site's snapshot is never used.
      expect(contract.snapshots.map(snapshot => snapshot.id), `site ${key} snapshot belongs to its contract`).toContain(row.snapshot)
      const otherContract = contracts[fx.sites[key === 'A' ? 'B' : 'A'].contractId]
      expect(otherContract.snapshots.map(snapshot => snapshot.id)).not.toContain(row.snapshot)
      const pairs = itemPairs(row.id)
      expect(pairs[0] && Number(pairs[0][0]), `site ${key} first interval`).toBe(site.oracle.billableStartMs)
      expect(pairs.every(([start]) => start >= site.oracle.billableStartMs), `site ${key}: no interval before its own start`).toBe(true)
    }
    expect(underlays.A!.snapshot).not.toBe(underlays.B!.snapshot)
    expect(itemPairs(underlays.B!.id).length, 'B has only the days from its mid-month start').toBe(fx.sites.B.oracle.intervals.length)
    // Money per site against the oracle (markup and fee differ per contract; the fee is NOT prorated for the partial month B, see site01Synthetic.ts).
    for (const key of KEYS) {
      const site = fx.sites[key], o = site.oracle
      const run = await priceUnderlay(key, underlays[key]!.id)
      results[`SITE01.02.pricing.${key}`] = { run, oracle: { spot: centsText(o.lines.spotCents), markup: centsText(o.lines.markupCents), fee: centsText(o.lines.monthlyFeeCents), ex: centsText(o.totalExVatCents), vat: centsText(o.vatCents.total), inc: centsText(o.totalIncVatCents) } }
      const spot = run.lines.filter(line => line.source === 'spot')
      const markup = run.lines.filter(line => line.source !== 'spot' && line.type !== 'base_price' && line.unit === 'kWh')
      const fee = run.lines.filter(line => line.source !== 'spot' && line.unit === 'månad')
      expect(spot.map(line => line.amountCents), `site ${key} spot line`).toEqual([o.lines.spotCents])
      expect(markup.map(line => line.amountCents), `site ${key} markup line`).toEqual([o.lines.markupCents])
      expect(fee.map(line => line.amountCents), `site ${key} monthly fee line (full fee, no proration)`).toEqual([o.lines.monthlyFeeCents])
      expect(run.lines, `site ${key}: no other lines than spot, markup, monthly fee`).toHaveLength(3)
      expect(run.totals, `site ${key} totals`).toEqual({ ex: o.totalExVatCents, vat: o.vatCents.total, inc: o.totalIncVatCents })
    }
    expect(priced.A!.totals.inc).not.toBe(priced.B!.totals.inc)
  }, 900_000)

  it('SITE01.03 En avslutad och en aktiv site: den avslutade har bara intervall till slutdatum, ingenting efter slut', async () => {
    await ensureSaved()
    const underlays = readUnderlays()
    const a = underlays.A!, b = underlays.B!
    const aPairs = itemPairs(a.id), bPairs = itemPairs(b.id)
    const m = month()
    const lastEnd = (pairs: Array<[number, string]>) => pairs.length ? pairs[pairs.length - 1][0] + 15 * 60_000 : null
    const bSite = fx.sites.B
    const normalizedB = dbRead<{ total: number; billable: number; blocked: number; afterEnd: number; afterEndBillable: number; itemsAfterEnd: number; firstBlockedReasons: unknown }>(`SELECT jsonb_build_object(
      'total',count(*),'billable',count(*) FILTER (WHERE billing_status='billable' AND billing_gate_status='eligible'),
      'blocked',count(*) FILTER (WHERE NOT(billing_status='billable' AND billing_gate_status='eligible')),
      'afterEnd',count(*) FILTER (WHERE period_start>=to_timestamp(${bSite.oracle.billableEndMs}/1000.0)),
      'afterEndBillable',count(*) FILTER (WHERE period_start>=to_timestamp(${bSite.oracle.billableEndMs}/1000.0) AND billing_status='billable' AND billing_gate_status='eligible'),
      'itemsAfterEnd',(SELECT count(*) FROM public.billing_underlay_items i WHERE i.billing_underlay_id=${lit(b.id)} AND i.period_start>=to_timestamp(${bSite.oracle.billableEndMs}/1000.0)),
      'firstBlockedReasons',(SELECT billing_gate_reasons FROM public.normalized_metering_values x WHERE x.company_id=${company()} AND x.metering_point_id=${lit(bSite.pointId)} AND x.period_start>=to_timestamp(${bSite.oracle.billableEndMs}/1000.0) ORDER BY x.period_start LIMIT 1))
      FROM public.normalized_metering_values WHERE company_id=${company()} AND metering_point_id=${lit(bSite.pointId)}`)
    const period = dbRead<{ end_date: string | null; status: string; source_end_message_id: string | null; market_end_at: string | null }>(`SELECT jsonb_build_object('end_date',end_date,'status',status,'source_end_message_id',source_end_message_id,'market_end_at',market_end_at) FROM public.customer_supply_periods WHERE id=${lit(bSite.supplyPeriodId)}`)
    results['SITE01.03'] = { normalizedB, period, bFirst: bPairs[0]?.[0], bLastEnd: lastEnd(bPairs), underlayBStart: b.start, underlayBEnd: b.end, aLastEnd: lastEnd(aPairs) }
    expect(period.end_date).toBe(SITE_B.endDate)
    expect(period.source_end_message_id).toBe(fx.supplyEnd.sourceId)
    expect(Date.parse(String(period.market_end_at))).toBe(bSite.oracle.billableEndMs)
    // Readings WERE delivered after the end (15 delivered days, 10 of them inside the delivery) ...
    expect(normalizedB.total).toBe(15 * 96)
    expect(normalizedB.afterEnd).toBe(5 * 96)
    // ... but none of them is billable, and none is in the underlay.
    expect(normalizedB.afterEndBillable).toBe(0)
    expect(normalizedB.itemsAfterEnd).toBe(0)
    expect(normalizedB.billable).toBe(bSite.oracle.intervals.length)
    expect(bPairs).toHaveLength(bSite.oracle.intervals.length)
    expect(lastEnd(bPairs), 'B last billed interval ends exactly at the end of the end date').toBe(bSite.oracle.billableEndMs)
    expect(Number(bPairs[0][0])).toBe(bSite.oracle.billableStartMs)
    expect(b.start).toBe('2026-09-16')
    expect(parseMilliKwh(b.totalKwh)).toBe(bSite.oracle.totalMilliKwh)
    // The active site is billed to the end of the month.
    expect(lastEnd(aPairs)).toBe(m.endMs)
    expect(aPairs).toHaveLength(fx.sites.A.oracle.intervals.length)
    expect(parseMilliKwh(a.totalKwh)).toBe(fx.sites.A.oracle.totalMilliKwh)
  }, 900_000)

  it('SITE01.04 Prisområden och nätägare hålls åtskilda: spotpris från rätt område, nätägare/nätområde rätt på underlag och poster', async () => {
    await ensureSaved()
    const underlays = readUnderlays()
    // Fixture sanity: the two areas really carry different prices, so a mix-up cannot pass by coincidence.
    const differing = fx.sites.B.oracle.intervals.filter(interval => hourlySpotE5(interval.day, Math.floor(interval.quarter / 4), SITE_A.priceSalt) !== interval.spotE5).length
    expect(differing).toBeGreaterThan(0)
    for (const key of KEYS) {
      const site = fx.sites[key], row = underlays[key]!
      await priceUnderlay(key, row.id)
      const shape = dbRead<{ priceAreas: string[]; gridAreas: string[]; points: string[]; mp: { grid_owner_id: string; grid_area_code: string; price_area_code: string }; siteRow: { grid_owner_id: string; grid_area_code: string; price_area_code: string } }>(`SELECT jsonb_build_object(
        'priceAreas',(SELECT jsonb_agg(DISTINCT price_area) FROM public.billing_underlay_items WHERE billing_underlay_id=${lit(row.id)}),
        'gridAreas',(SELECT jsonb_agg(DISTINCT grid_area) FROM public.billing_underlay_items WHERE billing_underlay_id=${lit(row.id)}),
        'points',(SELECT jsonb_agg(DISTINCT metering_point_id) FROM public.billing_underlay_items WHERE billing_underlay_id=${lit(row.id)}),
        'mp',(SELECT jsonb_build_object('grid_owner_id',grid_owner_id,'grid_area_code',grid_area_code,'price_area_code',price_area_code) FROM public.metering_points WHERE id=${lit(site.pointId)}),
        'siteRow',(SELECT jsonb_build_object('grid_owner_id',grid_owner_id,'grid_area_code',grid_area_code,'price_area_code',price_area_code) FROM public.customer_sites WHERE id=${lit(site.siteId)}))`)
      results[`SITE01.04.${key}`] = { underlayPriceArea: row.priceArea, underlayGridOwner: row.gridOwner, shape }
      expect(row.priceArea).toBe(site.spec.priceArea)
      expect(shape.priceAreas).toEqual([site.spec.priceArea])
      expect(shape.gridAreas, `site ${key} items carry its own grid area`).toEqual([site.spec.gridAreaCode])
      expect(shape.points).toEqual([site.pointId])
      expect(shape.mp).toEqual({ grid_owner_id: site.gridOwnerId, grid_area_code: site.spec.gridAreaCode, price_area_code: site.spec.priceArea })
      expect(shape.siteRow).toEqual({ grid_owner_id: site.gridOwnerId, grid_area_code: site.spec.gridAreaCode, price_area_code: site.spec.priceArea })
      // billing_underlays.grid_owner_id: strict when the engine fills it, reported when it does not.
      if (row.gridOwner !== null) expect(row.gridOwner).toBe(site.gridOwnerId)
      else console.warn(`SITE01.04: billing_underlays.grid_owner_id is null for site ${key}; the grid owner is only reachable through the metering point`)
      // Spot price evidence per interval is the oracle's price for THIS site's price area.
      const evidence = dbRead<Array<[number, number, string]>>(`SELECT coalesce(jsonb_agg(jsonb_build_array((extract(epoch from metering_interval_start)*1000)::bigint, round(price_sek_per_kwh*100000)::bigint, price_area) ORDER BY metering_interval_start),'[]'::jsonb)
        FROM public.pricing_interval_evidence WHERE company_id=${company()} AND billing_underlay_id=${lit(row.id)}
          AND pricing_run_id=(SELECT id FROM public.pricing_runs WHERE company_id=${company()} AND billing_underlay_id=${lit(row.id)} ORDER BY created_at DESC LIMIT 1)`)
      expect(evidence.map(([start, e5, area]) => `${start}:${e5}:${area}`), `site ${key} evidence prices`).toEqual(site.oracle.intervals.map(interval => `${interval.startMs}:${interval.spotE5}:${site.spec.priceArea}`))
    }
    expect(underlays.A!.gridOwner === null || underlays.A!.gridOwner !== underlays.B!.gridOwner).toBe(true)
  }, 900_000)

  // ---------------------------------------------------------------- SITE01.05

  type Draft = { invoices: Array<{ id: string; underlay: string; item: string; status: string; area: string | null; sha: string | null; ex: string; vat: string; inc: string; kwh: string; customer: string | null; number: string | null }>
    items: Array<{ id: string; underlay: string; status: string; fileId: string | null; runId: string }>; runs: number }
  const readDraft = (): Draft => dbRead<Draft>(`SELECT jsonb_build_object(
    'invoices',coalesce((SELECT jsonb_agg(jsonb_build_object('id',i.id,'underlay',i.billing_underlay_id,'item',i.invoice_export_item_id,'status',i.status,'area',i.price_area_code,'sha',i.calculation_snapshot_sha256,
      'ex',i.amount_ex_vat::text,'vat',i.vat_amount::text,'inc',i.amount_inc_vat::text,'kwh',trim_scale(coalesce(i.consumption_kwh,i.total_kwh))::text,'customer',i.customer_id,'number',i.invoice_number) ORDER BY i.price_area_code)
      FROM public.customer_invoices i WHERE i.company_id=${company()} AND i.billing_underlay_id IN (SELECT id FROM public.billing_underlays WHERE company_id=${company()} AND underlay_year=2026 AND underlay_month=9)),'[]'::jsonb),
    'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',x.id,'underlay',x.billing_underlay_id,'status',x.status,'fileId',x.export_file_id,'runId',x.export_run_id))
      FROM public.invoice_export_items x WHERE x.company_id=${company()} AND x.status<>'cancelled'),'[]'::jsonb),
    'runs',(SELECT count(*) FROM public.invoice_export_runs WHERE company_id=${company()} AND billing_month=${lit(SITE01_BILLING_MONTH)}))`)

  let prepared = false
  it('SITE01.05 Prepare (POST /api/internal/invoice-exports/create): faktisk fakturamodell för två sites', async () => {
    await ensureSaved()
    await enableFileInvoiceProvider(fx.companyId)
    const response = await timed('SITE01.05 invoice-exports/create (normal API)', () => http(fx.session, 'POST', '/api/internal/invoice-exports/create', { json: { billing_month: SITE01_BILLING_MONTH } }))
    expect(response.status, JSON.stringify(response.body)?.slice(0, 800)).toBe(200)
    const body = response.body as { data?: Record<string, unknown>; mode?: string } | null
    prepared = true
    const draft = readDraft()
    const model = draft.invoices.length === 1 ? 'one_consolidated_invoice' : draft.invoices.length === 2 ? 'one_invoice_per_site' : `unexpected_${draft.invoices.length}`
    results['SITE01.05.prepare'] = { response: body?.data, model, invoices: draft.invoices.length, items: draft.items.length, runs: draft.runs, invoiceUnderlays: draft.invoices.map(invoice => invoice.underlay) }
    expect(body?.mode).toBe('prepare_only')
    expect(body?.data).toMatchObject({ billingMonth: SITE01_BILLING_MONTH, underlays: 2, candidates: 2, failed: 0, alreadyPrepared: 0 })
    expect(body?.data?.errors).toEqual([])
    // Observed model, per underlay: every underlay has exactly one invoice draft bound to it and its own pricing run.
    const underlays = readUnderlays()
    for (const key of KEYS) expect(draft.invoices.filter(invoice => invoice.underlay === underlays[key]!.id), `drafts bound to underlay ${key}`).toHaveLength(1)
    for (const invoice of draft.invoices) expect(invoice.customer).toBe(fx.customerId)
  }, 900_000)

  it('SITE01.05a Samlingsfaktura: EN faktura med båda sites (orakelfilens consolidation.passRequires)', () => {
    expect(prepared, 'SITE01.05 prepare must have run').toBe(true)
    const draft = readDraft()
    const underlays = readUnderlays()
    const bothInOne = draft.invoices.filter(invoice => invoice.underlay === underlays.A!.id || invoice.underlay === underlays.B!.id)
    // lib/billing/invoiceReviewPrepare.ts createDraft builds exactly one customer_invoices row per underlay (p_invoices: [canonicalInvoice], :346-355);
    // a consolidated_invoice flag only changes consolidated_invoice_group_key metadata on the legacy item (:288-289). Two invoices in one
    // file (SITE01.05b) are NOT a consolidated invoice.
    expect(draft.invoices.length, draft.invoices.length === 2
      ? 'FEATURE_GAP: no consolidated invoice. The app creates one invoice per site/underlay (2 invoices for 1 customer), not one invoice covering both sites; two invoices in one file is not a consolidated invoice.'
      : `unexpected number of invoices (${draft.invoices.length})`).toBe(1)
    expect(bothInOne).toHaveLength(1)
  })

  it('SITE01.05b Fakturafil: båda fakturorna i samma fil med rätt site-adress, nätområde och nätägare per rad', async () => {
    expect(prepared, 'SITE01.05 prepare must have run').toBe(true)
    // SUBSTITUTE: approveAndSendReadyInvoicesAction and createInvoiceFileAction (app/admin/billing/**/actions.ts) are Next server actions that need a browser form
    // post; the library functions they call are invoked directly with the same arguments — verifierar inte åtgärdernas auth-kontroll
    // (requireAdminActionAccess), formulären eller redirect/revalidate.
    substitute({ id: 'approve-and-file-direct', step: 'SITE01.05b approve + invoice file', substitute: 'approveAndSendReadyInvoicesForMonth (file_export = approve-only) and createInvoiceFile called directly',
      notVerified: 'server action auth/permission checks, form posts, redirects' })
    const approved = await timed('SITE01.05b approve', () => approveAndSendReadyInvoicesForMonth({ companyId: fx.companyId, billingMonth: SITE01_BILLING_MONTH, actorUserId: fx.actorUserId }))
    results['SITE01.05b.approve'] = approved
    expect(approved).toMatchObject({ approved: 2, sent: 0, failed: 0, errors: [], approveOnly: true })
    const file = await timed('SITE01.05b createInvoiceFile', () => createInvoiceFile({ companyId: fx.companyId, billingMonth: SITE01_BILLING_MONTH, actorUserId: fx.actorUserId }))
    results['SITE01.05b.file'] = file
    expect(file.rowCount).toBe(2)

    type FileRow = { invoice_export_item_id: string; invoice_number: string; customer_number: string | null; customer_name: string; identity_number: string | null; price_area: string | null; kwh: number
      amount_ex_vat: number; vat_amount: number; amount_inc_vat: number; period_start: string | null; period_end: string | null; lines: unknown[]
      electricity?: { facility_count: number; facilities: Array<{ facility_id: string | null; metering_point_id: string | null; site_street: string | null; site_postal_code: string | null; site_city: string | null; price_area: string | null
        grid_area: string | null; grid_owner: string | null; period_start: string | null; period_end: string | null; consumption_kwh: number }>; contract: { start_date: string | null } | null } }
    const files = dbRead<Array<{ id: string; row_count: number; total_inc_vat: string; environment: string; provider: string; billing_month: string; rows: FileRow[] }>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'row_count',row_count,'total_inc_vat',total_inc_vat::text,'environment',environment,'provider',provider,'billing_month',billing_month,'rows',rows)),'[]'::jsonb)
      FROM public.invoice_export_files WHERE company_id=${company()}`)
    expect(files, 'exactly one invoice file for the company').toHaveLength(1)
    const stored = files[0]
    expect(stored.id).toBe(file.fileId)
    expect(stored).toMatchObject({ row_count: 2, billing_month: SITE01_BILLING_MONTH, provider: 'file_export', environment: 'test' })
    expect(stored.rows).toHaveLength(2)
    const items = readDraft().items
    expect(items.every(item => item.fileId === stored.id && item.status === 'sent'), 'both export items are in the file and marked sent').toBe(true)

    const underlays = readUnderlays()
    const draft = readDraft()
    const rowsByArea = new Map(stored.rows.map(row => [row.price_area, row]))
    expect([...rowsByArea.keys()].sort()).toEqual(['SE3', 'SE4'])
    const fileFacts: Record<string, unknown> = {}
    for (const key of KEYS) {
      const site = fx.sites[key], o = site.oracle
      const row = rowsByArea.get(site.spec.priceArea)!
      const invoice = draft.invoices.find(candidate => candidate.underlay === underlays[key]!.id)!
      fileFacts[key] = { row: { invoice_number: row.invoice_number, price_area: row.price_area, kwh: row.kwh, period_start: row.period_start, period_end: row.period_end }, facility: row.electricity?.facilities?.[0], contract: row.electricity?.contract }
      expect(row.invoice_export_item_id, `site ${key} row is its own invoice`).toBe(invoice.item)
      expect({ ex: cents(row.amount_ex_vat), vat: cents(row.vat_amount), inc: cents(row.amount_inc_vat) }, `site ${key} amounts`).toEqual({ ex: o.totalExVatCents, vat: o.vatCents.total, inc: o.totalIncVatCents })
      expect(Math.round(row.kwh * 1000), `site ${key} kWh`).toBe(o.totalMilliKwh)
      expect(row.lines, `site ${key} invoice lines`).toHaveLength(3)
      // Site facts per row: facility, metering point, address, price area, grid area, grid owner.
      expect(row.electricity?.facility_count).toBe(1)
      const facility = row.electricity!.facilities[0]
      expect(facility).toMatchObject({ facility_id: site.external, metering_point_id: site.external, site_street: site.spec.address.street, site_postal_code: site.spec.address.postalCode, site_city: site.spec.address.city,
        price_area: site.spec.priceArea, grid_area: site.spec.gridAreaCode, grid_owner: site.spec.gridOwnerName })
      expect(Math.round(facility.consumption_kwh * 1000)).toBe(o.totalMilliKwh)
      expect(String(row.period_start).slice(0, 10), `site ${key} invoice period start`).toBe(key === 'A' ? '2026-09-01' : '2026-09-16')
      expect(row.electricity?.contract?.start_date, `site ${key} contract start`).toBe(site.spec.startDate)
    }
    // The end of site B is visible on its invoice row: the period ends on/at the end date (exclusive-end conventions both accepted), not at month end.
    const bEnd = String(rowsByArea.get('SE4')!.period_end).slice(0, 10)
    expect(['2026-09-25', '2026-09-26']).toContain(bEnd)
    expect(String(rowsByArea.get('SE3')!.period_end).slice(0, 10) >= '2026-09-30').toBe(true)
    // One customer, two different invoices in the same file.
    const [first, second] = stored.rows
    expect(first.customer_number).toBe(second.customer_number)
    expect(first.identity_number).toBe(second.identity_number)
    expect(first.invoice_number).not.toBe(second.invoice_number)
    expect(cents(stored.total_inc_vat)).toBe(fx.sites.A.oracle.totalIncVatCents + fx.sites.B.oracle.totalIncVatCents)
    results['SITE01.05b.facts'] = fileFacts
  }, 900_000)
})
