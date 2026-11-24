// simulation: T6/004
// reality-defects: F8-B1
// T6/004: every ready billing underlay was refused by public.gridex_store_billing_underlay with
// billing_underlay_supply_contract_price_basis_required, because the store binds a ready underlay's pricing_snapshot to
// the contract price snapshot's snapshot_json by jsonb equality, while the engine sent its enriched pricing payload
// (snapshotPayload: snapshot_json plus contract_price_snapshot_id, pricing_model, base_price_components and
// price_components). This test drives the real engine, captures the exact store commands it builds, and evaluates
// them against the real store and price timeline functions taken from supabase/schema.sql in PGlite. The
// source locks are finite ports and the qualified-supply authority is ported as absent so a
// command that passes the price gate stops at the next gate (billing_underlay_qualified_supply_source_required) and
// nothing is written. No native replay, RLS or full source-basis certification is claimed here.
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/admin/apiGuards', () => ({
  requireAdminApiAccess: async () => ({ guard: { userId: '20000000-0000-4000-8000-00000000000c' } }),
  requireAdminOperationalCompany: async () => '20000000-0000-4000-8000-000000000001',
}))

type Row = Record<string, unknown>
const tables: Record<string, Row[]> = {}
const rpcCalls: Array<{ fn: string; args: Row }> = []

function builder(table: string) {
  // Equality filters are honoured so the unsigned-revision lookup (eq source) sees no revision rows.
  const eqs: Array<[string, unknown]> = []
  const rows = () => (tables[table] ?? []).filter(row => eqs.every(([column, value]) => row[column] === value))
  const result = () => Promise.resolve({ data: rows(), error: null })
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'in', 'not', 'lt', 'lte', 'gt', 'gte', 'or', 'order', 'limit', 'is', 'neq'])
    chain[method] = () => chain
  chain.eq = (column: string, value: unknown) => { eqs.push([column, value]); return chain }
  chain.range = result
  chain.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null })
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => result().then(resolve, reject)
  return chain
}

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: (table: string) => builder(table),
    rpc: (fn: string, args: Row) => {
      rpcCalls.push({ fn, args })
      const commands = (args.p_commands as unknown[]) ?? []
      return Promise.resolve({ data: commands.map((_, i) => `underlay-${i}`), error: null })
    },
  },
}))
vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }))
vi.mock('@/lib/billing/invoiceReadiness', () => ({ assertBillingPeriodOpen: async () => undefined, getBillingPeriodLock: async () => null }))
vi.mock('@/lib/billing/sourceBasis', () => ({
  loadQualifiedBillingValues: async (_c: string, ids: string[]) => new Map(ids.map(id => [id, (tables.normalized_metering_values ?? []).find(r => r.id === id)])),
}))
vi.mock('@/lib/billing/billingGate', () => ({ evaluateBillingGate: () => ({ eligible: true, reasons: [] }) }))
const estimatesMissingConsumption = vi.hoisted(() => vi.fn(async () => false))
const requestHistoricalMetering = vi.hoisted(() => vi.fn(async () => 'draft_for_operator' as const))
vi.mock('@/lib/billing/consumptionEstimate', () => ({
  companyEstimatesMissingConsumption: estimatesMissingConsumption, estimateMissingConsumption: async () => null, missingWindows: () => [],
}))
vi.mock('@/lib/billing/historyRequest', () => ({ ensureHistoricalMeteringRequest: requestHistoricalMetering }))

const uuid = (n: number) => `20000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const C = uuid(1), CU = uuid(2), MP = uuid(3), SP = uuid(4), CT = uuid(5), SNAP = uuid(6), PV = uuid(7), NMV = uuid(8), SITE = uuid(9), PP = uuid(10)
// Contract price snapshot as persisted at signing: snapshot_json carries none of the keys the engine's pricing payload adds.
const snapshotJson = {
  snapshot_schema: 'gridex_contract_pricing_v7_signed_receipt', pricing_model: 'spot', price_area: 'SE3',
  energy_direction: 'consumption', markup_ore_per_kwh: 4.9, interval_resolution: 'monthly', vat_rate: 25,
}
const engineAddedKeys = ['contract_price_snapshot_id', 'pricing_model', 'base_price_components', 'price_components']
const meteringValue = {
  id: NMV, company_id: C, customer_id: CU, metering_point_id: MP, supply_period_id: SP, site_id: SITE, customer_site_id: SITE,
  period_start: '2026-08-31T22:00:00.000Z', period_end: '2026-09-30T22:00:00.000Z', quantity_kwh: '612.5', unit: 'kWh', direction: 'consumption',
  revision_status: 'current', billing_status: 'billable', billing_gate_status: 'eligible', billing_gate_snapshot: { status: 'eligible' },
  price_area: 'SE3', metadata: {},
}

function seedEngine(withValues: boolean) {
  rpcCalls.length = 0
  tables.normalized_metering_values = withValues ? [meteringValue] : []
  tables.customer_supply_periods = [{
    id: SP, company_id: C, customer_id: CU, metering_point_id: MP, contract_id: CT, site_id: SITE, customer_site_id: SITE,
    status: 'active', start_date: '2026-09-01', end_date: null,
  }]
  tables.customer_contracts = [{ id: CT, company_id: C, customer_id: CU, metering_point_id: MP, status: 'active', starts_at: '2026-09-01', energy_direction: 'consumption', price_plan_id: PP }]
  tables.contract_price_snapshots = [{
    id: SNAP, company_id: C, contract_id: CT, price_plan_version_id: PV, valid_from: '2026-09-01', valid_to: null, pricing_model: 'spot',
    snapshot_schema_version: 'gridex_contract_pricing_v7_signed_receipt', snapshot_json: snapshotJson,
    base_price_components_snapshot: [{ key: 'energy' }], price_components_snapshot: [{ key: 'markup' }],
  }]
  tables.billing_underlays = []
  tables.billing_underlay_items = []
}

async function engineCommands(withValues: boolean) {
  seedEngine(withValues)
  const { generateBillingUnderlaysForMonth } = await import('@/lib/billing/underlayEngine')
  await generateBillingUnderlaysForMonth({ companyId: C, billingMonth: '2026-09' })
  const store = rpcCalls.find(c => c.fn === 'gridex_store_billing_underlay_batch')
  return (store?.args.p_commands ?? []) as Array<{ underlay: Row; items: Row[] }>
}

const schema = readFileSync('supabase/schema.sql', 'utf8')
const storeStart = schema.indexOf('CREATE FUNCTION public.gridex_store_billing_underlay(p_company_id uuid')
const storeFunction = schema.slice(storeStart, schema.indexOf('END $_$;', storeStart) + 'END $_$;'.length)
const priceTimelineFunction = schema.match(/^CREATE FUNCTION gridex_billing_source\.require_contract_price_timeline_v1\([\s\S]*?^ *\$\$;/m)?.[0]
let db: PGlite

beforeAll(async () => {
  expect(storeStart).toBeGreaterThan(0)
  if (!priceTimelineFunction) throw new Error('require_contract_price_timeline_v1 not found in schema.sql')
  db = new PGlite()
  await db.exec(`
    create role service_role; create schema extensions; create schema gridex_billing_source; create schema gridex_received_sources;
    create schema gridex_bilateral_prodat; create schema gridex_regulated_supply;
    grant usage on schema public, gridex_billing_source, gridex_received_sources to service_role;
    create table public.billing_underlays(id uuid primary key, company_id uuid, customer_id uuid, metering_point_id uuid, underlay_year int, underlay_month int,
      billing_period_start date, billing_period_end date, energy_direction text);
    create table public.normalized_metering_values(id uuid primary key, company_id uuid);
    create table public.customer_supply_periods(id uuid primary key, company_id uuid, customer_id uuid, metering_point_id uuid, contract_id uuid, status text, start_date date, end_date date);
    create table public.customer_contracts(id uuid primary key, company_id uuid, customer_id uuid, metering_point_id uuid, status text, starts_at date, ends_at date);
    create table public.contract_price_snapshots(id uuid primary key, company_id uuid, contract_id uuid, price_plan_version_id uuid, snapshot_json jsonb, valid_from date, valid_to date);
    create table public.price_plan_versions(id uuid primary key, company_id uuid, status text, locked_at timestamptz, content_sha256 text);
    create table gridex_billing_source.underlay_bindings(underlay_id uuid primary key, company_id uuid, source_basis jsonb, source_basis_hash text, exact_total_kwh numeric, actor_user_id uuid);
    create function public.ediel_require_invoice_source_copies_available_v1(uuid, uuid) returns void language sql as $$select$$;
    create function gridex_billing_source.lock_values_v1(uuid, uuid[], uuid) returns void language sql as $$select$$;
    create function gridex_bilateral_prodat.lock_supply_v1() returns void language sql as $$select$$;
    create function gridex_regulated_supply.lock_graph_v1() returns void language sql as $$select$$;
    -- These cases seed active supply only. Market qualification is outside this fixture.
    create function gridex_billing_source.ordinary_ended_supply_v1(public.customer_supply_periods, public.customer_contracts, timestamptz, timestamptz)
      returns boolean language sql as $$select false$$;
    create function gridex_received_sources.billing_supply_basis_v1(uuid, uuid, timestamptz, timestamptz) returns jsonb language sql as $$select null::jsonb$$;
  `)
  await db.exec(priceTimelineFunction)
  await db.exec(storeFunction)
  await db.query('insert into public.customer_supply_periods values($1,$2,$3,$4,$5,$6,$7,null)', [SP, C, CU, MP, CT, 'active', '2026-09-01'])
  await db.query('insert into public.customer_contracts values($1,$2,$3,$4,$5,$6,null)', [CT, C, CU, MP, 'active', '2026-09-01'])
  await db.query('insert into public.contract_price_snapshots values($1,$2,$3,$4,$5,$6,null)', [SNAP, C, CT, PV, JSON.stringify(snapshotJson), '2026-09-01'])
  await db.query('insert into public.price_plan_versions values($1,$2,$3,now(),$4)', [PV, C, 'active', 'a'.repeat(64)])
})

afterAll(async () => { await db?.close() })

async function storeAsServiceRole(underlay: Row, items: Row[]) {
  await db.exec('set role service_role')
  try {
    return await db.query('select public.gridex_store_billing_underlay($1, $2, $3, null) id', [C, JSON.stringify(underlay), JSON.stringify(items)])
  } finally {
    await db.exec('reset role')
  }
}

describe('T6/004 a ready underlay stores the contract price snapshot JSON the store binds to', () => {
  beforeEach(() => { rpcCalls.length = 0 })

  it('keeps the enriched pricing payload on the non-ready missing-values underlay (unchanged path)', async () => {
    const commands = await engineCommands(false)
    expect(commands).toHaveLength(1)
    const blocked = commands[0].underlay
    expect(blocked.readiness_status).toBe('blocked')
    const payload = blocked.pricing_snapshot as Row
    expect(payload).toMatchObject(snapshotJson)
    for (const key of engineAddedKeys) expect(payload).toHaveProperty(key)
    expect(payload.contract_price_snapshot_id).toBe(SNAP)
    expect(payload.base_price_components).toEqual([{ key: 'energy' }])
    expect(payload.price_components).toEqual([{ key: 'markup' }])
    expect(payload).not.toEqual(snapshotJson)
  })

  it('stores a ready underlay whose pricing_snapshot is exactly the contract snapshot_json, and the real store accepts its price basis', async () => {
    const commands = await engineCommands(true)
    const ready = commands.filter(c => c.underlay.readiness_status === 'ready')
    expect(ready).toHaveLength(1)
    const { underlay, items } = ready[0]
    expect(underlay.pricing_snapshot).toStrictEqual(snapshotJson)
    for (const key of ['contract_price_snapshot_id', 'base_price_components', 'price_components'])
      expect(underlay.pricing_snapshot).not.toHaveProperty(key)
    const equal = await db.query<{ equal: boolean }>('select snapshot_json = $1::jsonb as equal from public.contract_price_snapshots where id = $2', [JSON.stringify(underlay.pricing_snapshot), SNAP])
    expect(equal.rows[0].equal).toBe(true)
    // Positive: the price-basis gate passes; the next gate (ported absent supply authority) refuses, so nothing is written.
    await expect(storeAsServiceRole(underlay, items)).rejects.toThrow(/billing_underlay_qualified_supply_source_required/)
    const rows = await db.query<{ n: number }>('select count(*)::int n from public.billing_underlays')
    expect(rows.rows[0].n).toBe(0)
  })

  it('refuses a ready underlay that carries the enriched pricing payload the engine produced before the fix', async () => {
    const enriched = (await engineCommands(false))[0].underlay.pricing_snapshot as Row
    const ready = (await engineCommands(true)).find(c => c.underlay.readiness_status === 'ready')
    expect(ready).toBeDefined()
    await expect(storeAsServiceRole({ ...ready!.underlay, pricing_snapshot: enriched }, ready!.items))
      .rejects.toThrow(/billing_underlay_supply_contract_price_basis_required/)
    const rows = await db.query<{ n: number }>('select count(*)::int n from public.billing_underlays')
    expect(rows.rows[0].n).toBe(0)
  })
})

it('keeps the qualified immutable source reference in a compact physical E66 item', async () => {
  const sourceId = uuid(11)
  const contractHash = 'a'.repeat(64)
  const sourcePayloadHash = 'b'.repeat(64)
  const sourceBasis = { qualified: true, version: 1, sourceMessageId: sourceId, observationOrdinal: 8, contractHash, sourcePayloadHash }
  seedEngine(true)
  tables.normalized_metering_values = [{ ...meteringValue, source_message_id: sourceId, billing_source_basis: sourceBasis }]
  const { generateBillingUnderlaysForMonth } = await import('@/lib/billing/underlayEngine')
  await generateBillingUnderlaysForMonth({ companyId: C, billingMonth: '2026-09' })
  const store = rpcCalls.find(c => c.fn === 'gridex_store_billing_underlay_batch')
  const items = (store?.args.p_commands as Array<{ items: Row[] }>)[0].items
  expect(items).toHaveLength(1)
  expect(items[0].metadata).toMatchObject({ source_message_id: sourceId, source_basis: sourceBasis })
  expect(items[0].metadata).not.toHaveProperty('raw_payload')
})

it.each([false, true])('returns and stores pending history review from the billing POST when partially covered=%s', async partial => {
  seedEngine(partial)
  if (partial) tables.normalized_metering_values = [{ ...meteringValue, period_end: '2026-09-01T22:00:00.000Z' }]
  estimatesMissingConsumption.mockResolvedValueOnce(true)
  requestHistoricalMetering.mockClear()
  const { POST } = await import('@/app/api/internal/billing/generate-underlay/route')
  const response = await POST(new Request('http://127.0.0.1/api/internal/billing/generate-underlay', {
    method: 'POST', body: JSON.stringify({ billing_month: '2026-09' }),
  }))
  expect(response.status).toBe(200)
  const result = (await response.json()).data as { results: Array<{ warnings: string[]; status: string }> }
  const warnings = result.results.flatMap(row => row.warnings)
  const store = rpcCalls.find(c => c.fn === 'gridex_store_billing_underlay_batch')
  const commands = store?.args.p_commands as Array<{ underlay: { readiness_status: string; readiness_issues: Array<{ message: string }> } }>
  expect(requestHistoricalMetering).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ meteringPointId: MP, customerId: CU, actorUserId: uuid(12) }))
  expect(result.results).toHaveLength(1)
  expect(result.results[0].status).toBe('needs_review')
  expect(warnings).toContainEqual(expect.stringMatching(/^history_request_pending:/))
  expect(warnings).not.toContainEqual(expect.stringMatching(/^history_requested:/))
  expect(commands[0].underlay.readiness_status).toBe('blocked')
  expect(commands[0].underlay.readiness_issues).toContainEqual(expect.objectContaining({ message: expect.stringMatching(/^history_request_pending:/) }))
})

it.each([
  ['active', null, '2026-09-10', 'ready', false],
  ['signed', null, '2026-09-10', 'ready', false],
  ['active', '2026-09-10', null, 'blocked', true],
  ['terminated', null, '2026-09-10', 'blocked', true],
] as const)('keeps an actual or fixed end as the billing cutoff for %s (fixed=%s, stored end=%s)', async (status, endsAt, endedAt, readiness, hasContractBlocker) => {
  seedEngine(true)
  tables.customer_contracts = tables.customer_contracts.map(contract => ({
    ...contract, status, ends_at: endsAt, ended_at: endedAt,
    termination_notice_date: endedAt ? '2026-08-10' : null,
  }))
  const { generateBillingUnderlaysForMonth } = await import('@/lib/billing/underlayEngine')
  const result = await generateBillingUnderlaysForMonth({ companyId: C, billingMonth: '2026-09' })
  expect(result.results).toHaveLength(1)
  const store = rpcCalls.find(c => c.fn === 'gridex_store_billing_underlay_batch')
  const commands = store?.args.p_commands as Array<{ underlay: { readiness_status: string } }>
  expect(commands[0].underlay.readiness_status).toBe(readiness)
  expect(result.results[0].warnings.some(warning => warning.includes('Avtalets giltighet täcker inte hela fakturasegmentet'))).toBe(hasContractBlocker)
})

it.each([
  ['2026-08-31', 'blocked'],
  ['2026-09-01', 'ready'],
] as const)('uses the last included Swedish day of an intraday ending segment for a fixed end of %s', async (endsAt, expectedReadiness) => {
  seedEngine(true)
  const start = '2026-08-31T22:15:00.000Z'
  const end = '2026-08-31T23:00:00.000Z'
  tables.customer_contracts = tables.customer_contracts.map(contract => ({ ...contract, starts_at: '2026-08-31', ends_at: endsAt }))
  tables.customer_supply_periods = tables.customer_supply_periods.map(period => ({
    ...period, status: 'ending', end_date: '2026-09-01', market_start_at: start, market_end_at: end,
    source_end_message_id: uuid(13),
  }))
  tables.normalized_metering_values = [{ ...meteringValue, period_start: start, period_end: end }]
  const { generateBillingUnderlaysForMonth } = await import('@/lib/billing/underlayEngine')
  const result = await generateBillingUnderlaysForMonth({ companyId: C, billingMonth: '2026-09' })
  const store = rpcCalls.find(c => c.fn === 'gridex_store_billing_underlay_batch')
  const commands = store?.args.p_commands as Array<{ underlay: { readiness_status: string } }>
  expect(commands).toHaveLength(1)
  expect(commands[0].underlay.readiness_status).toBe(expectedReadiness)
  expect(result.results[0].warnings.some(warning => warning.includes('Avtalets giltighet täcker inte hela fakturasegmentet'))).toBe(expectedReadiness === 'blocked')
})
