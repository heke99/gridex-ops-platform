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

vi.mock('server-only', () => ({}))
vi.mock('@/lib/admin/apiGuards', () => ({
  requireAdminApiAccess: async () => ({ guard: { userId: '20000000-0000-4000-8000-00000000000c' } }),
  requireAdminOperationalCompany: async () => '20000000-0000-4000-8000-000000000001',
}))

type Row = Record<string, unknown>
const tables: Record<string, Row[]> = {}
const rpcCalls: Array<{ fn: string; args: Row }> = []
const storeErrors: Row[] = []
const effectivePriceTimelines = new Map<string, { data: unknown; error: Row | null }>()
let projectAutomationStores = false
let invalidAutomationProjection: 'missing' | 'different' | null = null
const effectiveTimelineRpc = 'gridex_read_effective_contract_price_timeline_v1'

function builder(table: string) {
  if (table === 'billing_automation_runs') {
    const insert = {
      insert: (row: Row) => {
        expect(row).toMatchObject({ company_id: C, status: 'running', export_requested: false, export_confirmed: false })
        return insert
      },
      select: () => insert,
      single: async () => ({ data: { id: uuid(73) }, error: null }),
    }
    return insert
  }
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
      if (fn === effectiveTimelineRpc) {
        return Promise.resolve(effectivePriceTimelines.get(String(args.p_contract_id)) ?? { data: { kind: 'legacy' }, error: null })
      }
      const error = fn === 'gridex_store_billing_underlay_batch' ? storeErrors.shift() : undefined
      if (error) return Promise.resolve({ data: null, error })
      if (fn === 'gridex_finish_monthly_billing_run_v1') {
        return Promise.resolve({ data: args.p_run_id, error: null })
      }
      if (fn === 'gridex_prepare_test_price_series_by_underlays_v1') {
        return Promise.resolve({ data: { invoiceId: uuid(74), existing: false }, error: null })
      }
      const commands = (args.p_commands as Array<{ underlay: Row }>) ?? []
      const ids = commands.map((_, i) => `underlay-${i}`)
      if (fn === 'gridex_store_billing_underlay_batch' && projectAutomationStores) {
        commands.forEach(({ underlay }, index) => {
          const timeline = ((underlay.payload as Row).contract_price_timeline ?? {}) as Row
          let digest = typeof timeline.basisSha256 === 'string' ? timeline.basisSha256 : null
          if (index === 1 && invalidAutomationProjection === 'missing') digest = null
          if (index === 1 && invalidAutomationProjection === 'different') digest = 'e'.repeat(64)
          tables.billing_underlays.push({ ...underlay, id: ids[index], company_id: C, price_timeline_basis_sha256: digest })
        })
      }
      return Promise.resolve({ data: ids, error: null })
    },
  },
}))
vi.mock('@/lib/automation/locks', () => ({
  withAutomationLock: async (options: { lockKey: string; run: (lock: { lockKey: string; lockToken: string }) => Promise<unknown> }) =>
    options.run({ lockKey: options.lockKey, lockToken: uuid(75) }),
}))
vi.mock('@/lib/tenant/governance', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/tenant/governance')>(),
  requireCompanyOperationalForWrites: async (companyId: string) => { expect(companyId).toBe(C) },
}))
vi.mock('@/lib/metering/monthlyAutopilot', () => ({
  runMeteringMarketDataAutopilot: async () => ({ review: 0, stopped: 0, requested: 0 }),
}))
vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }))
vi.mock('@/lib/billing/invoiceReadiness', () => ({
  assertBillingPeriodOpen: async () => undefined,
  getBillingPeriodLock: async () => null,
  captureTestPriceSeriesBillingConfiguration: async ({ companyId, underlayIds }: { companyId: string; underlayIds: string[] }) => {
    expect(companyId).toBe(C)
    expect(underlayIds).toEqual(['underlay-0', 'underlay-1'])
    return true
  },
}))
vi.mock('@/lib/billing/sourceBasis', () => ({
  loadQualifiedBillingValues: async (_c: string, ids: string[]) => new Map(ids.map(id => [id, (tables.normalized_metering_values ?? []).find(r => r.id === id)])),
}))
vi.mock('@/lib/billing/billingGate', () => ({ evaluateBillingGate: () => ({ eligible: true, reasons: [] }) }))
const estimatesMissingConsumption = vi.hoisted(() => vi.fn(async () => false))
const requestHistoricalMetering = vi.hoisted(() => vi.fn(async (): Promise<'draft_for_operator' | 'work_in_progress'> => 'draft_for_operator'))
vi.mock('@/lib/billing/consumptionEstimate', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/billing/consumptionEstimate')>(),
  companyEstimatesMissingConsumption: estimatesMissingConsumption, estimateMissingConsumption: async () => null,
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
  storeErrors.length = 0
  projectAutomationStores = false
  invalidAutomationProjection = null
  effectivePriceTimelines.clear()
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
const priceTimelineFunctions = [
  'has_unapplied_test_price_addendum_v1',
  'require_no_unapplied_test_price_addendum_v1',
  'require_contract_price_timeline_v1',
].map(name => {
  const ddl = schema.match(new RegExp(`^CREATE FUNCTION gridex_billing_source\\.${name}\\([\\s\\S]*?^ *\\$\\$;`, 'm'))?.[0]
  if (!ddl) throw new Error(`${name} not found in schema.sql`)
  return ddl
})
let db: PGlite

beforeAll(async () => {
  expect(storeStart).toBeGreaterThan(0)
  db = new PGlite()
  await db.exec(`
    create role service_role; create schema extensions; create schema gridex_billing_source; create schema gridex_received_sources;
    create schema gridex_bilateral_prodat; create schema gridex_regulated_supply;
    grant usage on schema public, gridex_billing_source, gridex_received_sources to service_role;
    create table public.billing_underlays(id uuid primary key, company_id uuid, customer_id uuid, metering_point_id uuid, underlay_year int, underlay_month int,
      billing_period_start date, billing_period_end date, energy_direction text);
    create table public.normalized_metering_values(id uuid primary key, company_id uuid);
    create table public.customer_supply_periods(id uuid primary key, company_id uuid, customer_id uuid, metering_point_id uuid, contract_id uuid, status text, start_date date, end_date date);
    create table public.customer_contracts(id uuid primary key, company_id uuid, customer_id uuid, metering_point_id uuid, status text, starts_at date, ends_at date, termination_reason text);
    create table public.contract_price_snapshots(id uuid primary key, company_id uuid, contract_id uuid, price_plan_version_id uuid, snapshot_json jsonb, valid_from date, valid_to date, source text);
    create table gridex_billing_source.test_price_addendum_reviews(company_id uuid, contract_id uuid, effective_at timestamptz);
    create table public.price_plan_versions(id uuid primary key, company_id uuid, status text, locked_at timestamptz, content_sha256 text);
    create table gridex_billing_source.underlay_bindings(underlay_id uuid primary key, company_id uuid, source_basis jsonb, source_basis_hash text, exact_total_kwh numeric, actor_user_id uuid);
    create function public.ediel_require_invoice_source_copies_available_v1(uuid, uuid) returns void language sql as $$select$$;
    create function gridex_billing_source.lock_values_v1(uuid, uuid[], uuid) returns void language sql as $$select$$;
    create function gridex_bilateral_prodat.lock_supply_v1() returns void language sql as $$select$$;
    create function gridex_regulated_supply.lock_graph_v1() returns void language sql as $$select$$;
    -- These cases seed active supply only. Market qualification is outside this fixture.
    create function gridex_billing_source.ordinary_ended_supply_v1(public.customer_supply_periods, public.customer_contracts, timestamptz, timestamptz)
      returns boolean language sql as $$select false$$;
    create function gridex_received_sources.planned_move_out_supply_window_v1(public.customer_supply_periods, public.customer_contracts, timestamptz, timestamptz)
      returns boolean language sql as $$select false$$;
    create function gridex_received_sources.billing_supply_basis_v1(uuid, uuid, timestamptz, timestamptz) returns jsonb language sql as $$select null::jsonb$$;
  `)
  for (const ddl of priceTimelineFunctions) await db.exec(ddl)
  await db.exec(storeFunction)
  await db.query('insert into public.customer_supply_periods values($1,$2,$3,$4,$5,$6,$7,null)', [SP, C, CU, MP, CT, 'active', '2026-09-01'])
  await db.query('insert into public.customer_contracts(id,company_id,customer_id,metering_point_id,status,starts_at) values($1,$2,$3,$4,$5,$6)', [CT, C, CU, MP, 'active', '2026-09-01'])
  await db.query(
    `insert into public.contract_price_snapshots(id,company_id,contract_id,price_plan_version_id,snapshot_json,valid_from,source)
      values($1,$2,$3,$4,$5,$6,$7)`,
    [SNAP, C, CT, PV, JSON.stringify(snapshotJson), '2026-09-01', 'signature_prepare'],
  )
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
  tables.normalized_metering_values = [{
    ...meteringValue, source_message_id: sourceId, billing_source_basis: sourceBasis,
    raw_payload: { retainedOriginal: 'synthetic source record' },
  }]
  const { generateBillingUnderlaysForMonth } = await import('@/lib/billing/underlayEngine')
  await generateBillingUnderlaysForMonth({ companyId: C, billingMonth: '2026-09' })
  const store = rpcCalls.find(c => c.fn === 'gridex_store_billing_underlay_batch')
  const items = (store?.args.p_commands as Array<{ items: Row[] }>)[0].items
  expect(items).toHaveLength(1)
  expect(items[0].metadata).toMatchObject({ source_message_id: sourceId, source_basis: sourceBasis })
  expect(items[0].metadata).not.toHaveProperty('raw_payload')
})

it.each([
  [false, 'draft_for_operator'], [true, 'draft_for_operator'],
  [false, 'work_in_progress'], [true, 'work_in_progress'],
] as const)('returns and stores pending history review when partially covered=%s and local status=%s', async (partial, historyStatus) => {
  seedEngine(partial)
  if (partial) tables.normalized_metering_values = [{ ...meteringValue, period_end: '2026-09-01T22:00:00.000Z' }]
  estimatesMissingConsumption.mockResolvedValueOnce(true)
  requestHistoricalMetering.mockClear().mockResolvedValueOnce(historyStatus)
  const { POST } = await import('@/app/api/internal/billing/generate-underlay/route')
  const response = await POST(new Request('http://127.0.0.1/api/internal/billing/generate-underlay', {
    method: 'POST', body: JSON.stringify({ billing_month: '2026-09' }),
  }))
  expect(response.status).toBe(200)
  const result = (await response.json()).data as { results: Array<{ warnings: string[]; status: string }> }
  const warnings = result.results.flatMap(row => row.warnings)
  const store = rpcCalls.find(c => c.fn === 'gridex_store_billing_underlay_batch')
  const commands = store?.args.p_commands as Array<{ underlay: { readiness_status: string; readiness_issues: Array<{ message: string }> } }>
  expect(requestHistoricalMetering).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    meteringPointId: MP, customerId: CU, actorUserId: uuid(12),
    estimationWindows: [{
      start: Date.parse(partial ? '2026-09-01T22:00:00.000Z' : meteringValue.period_start),
      end: Date.parse(meteringValue.period_end),
    }],
  }))
  expect(result.results).toHaveLength(1)
  expect(result.results[0].status).toBe('needs_review')
  const expectedWarning = historyStatus === 'work_in_progress'
    ? /^history_request_pending: En annan körning förbereder historikärendet\.$/
    : /^history_request_pending: Historik saknas/
  expect(warnings).toContainEqual(expect.stringMatching(expectedWarning))
  expect(warnings).not.toContainEqual(expect.stringMatching(/^history_requested:/))
  expect(commands[0].underlay.readiness_status).toBe('blocked')
  expect(commands[0].underlay.readiness_issues).toContainEqual(expect.objectContaining({ message: expect.stringMatching(expectedWarning) }))
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

function priceConflict(details: string | null) {
  return { code: 'PT409', message: 'billing_price_timeline_changed', details }
}

it('holds a repeatedly conflicting contract and submits the unrelated customer through the ordinary batch', async () => {
  seedEngine(true)
  const customer = uuid(21), point = uuid(22), period = uuid(23), contract = uuid(24)
  tables.customer_supply_periods.push({
    ...tables.customer_supply_periods[0], id: period, customer_id: customer, metering_point_id: point, contract_id: contract,
  })
  tables.customer_contracts.push({ ...tables.customer_contracts[0], id: contract, customer_id: customer, metering_point_id: point })
  tables.contract_price_snapshots.push({ ...tables.contract_price_snapshots[0], id: uuid(25), contract_id: contract })
  tables.normalized_metering_values.push({
    ...meteringValue, id: uuid(26), customer_id: customer, metering_point_id: point, supply_period_id: period,
  })
  const error = priceConflict(JSON.stringify({ companyId: C, contractId: CT }))
  storeErrors.push(error, error)

  const { generateBillingUnderlaysForMonth } = await import('@/lib/billing/underlayEngine')
  const result = await generateBillingUnderlaysForMonth({ companyId: C, billingMonth: '2026-09' })
  expect(result).toMatchObject({ readyForPricing: 1, needsReview: 1 })
  expect(result.results).toContainEqual(expect.objectContaining({
    underlayId: null, status: 'needs_review', sourceRows: 1,
    warnings: expect.arrayContaining([expect.stringMatching(/^billing_price_timeline_changed:/)]),
  }))
  const contracts = rpcCalls.filter(call => call.fn === 'gridex_store_billing_underlay_batch').map(call =>
    (call.args.p_commands as Array<{ underlay: Row }>).map(command => command.underlay.contract_id),
  )
  expect(contracts).toEqual([[CT, contract], [CT, contract], [contract]])
})

it.each([
  priceConflict(null),
  priceConflict('{'),
  priceConflict(JSON.stringify({ companyId: uuid(90), contractId: CT })),
  priceConflict(JSON.stringify({ companyId: C, contractId: uuid(90) })),
  { code: '23514', message: 'billing_price_timeline_changed', details: JSON.stringify({ companyId: C, contractId: CT }) },
])('propagates a repeat error without a qualified timeline contract', async error => {
  seedEngine(true)
  storeErrors.push(priceConflict(null), error)

  const { generateBillingUnderlaysForMonth } = await import('@/lib/billing/underlayEngine')
  await expect(generateBillingUnderlaysForMonth({ companyId: C, billingMonth: '2026-09' })).rejects.toBe(error)
  expect(rpcCalls.filter(call => call.fn === 'gridex_store_billing_underlay_batch')).toHaveLength(2)
})


describe('signed addendum effective price periods in ordinary underlay generation', () => {
  const laterPriceId = uuid(31)
  const laterVersionId = uuid(32)
  const cutover = '2026-09-14T22:00:00.000Z'
  const basisSha256 = 'd'.repeat(64)
  const originalPricing = { ...snapshotJson, pricing_model: 'fixed', fixed_price_ore_per_kwh: 42 }
  const laterPricing = { ...originalPricing, fixed_price_ore_per_kwh: 78 }

  function seedSignedAddendum() {
    seedEngine(true)
    tables.customer_contracts[0] = {
      ...tables.customer_contracts[0], status: 'signed', signed_at: '2026-08-25T12:00:00Z',
      contract_price_snapshot_id: SNAP, price_plan_version_id: PV,
      signature_snapshot: { schema: 'gridex_online_contract_signature_v1' },
    }
    const original = {
      ...tables.contract_price_snapshots[0], customer_id: CU, pricing_model: 'fixed',
      source: 'signature_prepare', snapshot_json: originalPricing, snapshot_hash: 'a'.repeat(64),
      base_price_components_snapshot: [], price_components_snapshot: [],
    }
    const later = {
      ...original, id: laterPriceId, source: 'staff_manually_verified_signed_addendum_v1',
      price_plan_version_id: laterVersionId, valid_from: '2026-09-15', snapshot_json: laterPricing, snapshot_hash: 'b'.repeat(64),
    }
    tables.contract_price_snapshots = [original, later]
    tables.normalized_metering_values = [
      { ...meteringValue, period_end: cutover, quantity_kwh: '336' },
      { ...meteringValue, id: uuid(33), period_start: cutover, quantity_kwh: '384' },
    ]
    return { original, later }
  }

  function seedEffectiveTimeline() {
    const { original, later } = seedSignedAddendum()
    const segments = [
      { snapshot: original, effectiveFrom: meteringValue.period_start, effectiveUntil: cutover },
      { snapshot: later, effectiveFrom: cutover, effectiveUntil: meteringValue.period_end },
    ]
    effectivePriceTimelines.set(CT, { data: { kind: 'ready', basisSha256, segments }, error: null })
    return { original, later }
  }

  it('plans both effective periods while sending the original saved pricing JSON', async () => {
    const { original } = seedEffectiveTimeline()

    const { generateBillingUnderlaysForMonth } = await import('@/lib/billing/underlayEngine')
    const result = await generateBillingUnderlaysForMonth({ companyId: C, billingMonth: '2026-09' })
    expect(result).toMatchObject({ readyForPricing: 2, needsReview: 0 })
    const request = rpcCalls.find(({ fn }) => fn === effectiveTimelineRpc)
    expect(request?.args).toEqual({
      p_company_id: C, p_customer_id: CU, p_contract_id: CT,
      p_start: meteringValue.period_start, p_end: meteringValue.period_end,
    })
    const store = rpcCalls.find(({ fn }) => fn === 'gridex_store_billing_underlay_batch')
    const commands = store?.args.p_commands as Array<{ underlay: Row; items: Row[] }>
    expect(commands).toHaveLength(2)
    expect(commands[0].underlay).toMatchObject({
      contract_price_snapshot_id: SNAP,
      billing_period_start: meteringValue.period_start, billing_period_end: cutover,
      total_kwh: '336', billing_block_reason: 'price_timeline_invoice_review_required',
      payload: { contract_price_timeline: { snapshotIds: [SNAP, laterPriceId], basisSha256 } },
    })
    expect(commands[1].underlay).toMatchObject({
      contract_price_snapshot_id: laterPriceId,
      billing_period_start: cutover, billing_period_end: meteringValue.period_end,
      total_kwh: '384', billing_block_reason: 'price_timeline_invoice_review_required',
      payload: { contract_price_timeline: { snapshotIds: [SNAP, laterPriceId], basisSha256 } },
    })
    expect(commands[0].underlay.pricing_snapshot).toStrictEqual(originalPricing)
    expect(commands[1].underlay.pricing_snapshot).toStrictEqual(laterPricing)
    expect(original).toMatchObject({ valid_to: null, snapshot_hash: 'a'.repeat(64) })
  })

  const zeroInvoiceFee = {
    component_code: 'invoice_fee', component_type: 'invoice_fee', name: 'Fakturaavgift',
    calculation_type: 'per_invoice', unit: 'sek_invoice', amount: 0, status: 'active',
    metadata: { lifecycle: 'per_invoice', visibility: { website_card: false, invoice: true } },
  }

  function putFee(snapshot: Row, components: Row[]) {
    snapshot.price_components_snapshot = structuredClone(components)
    snapshot.snapshot_json = { ...(snapshot.snapshot_json as Row), price_components_snapshot: structuredClone(components) }
  }

  it('retains the canonical numerical zero invoice fee without creating an extra item in either protected period', async () => {
    const { original, later } = seedEffectiveTimeline()
    putFee(original, [zeroInvoiceFee])
    putFee(later, [zeroInvoiceFee])
    const frozen = structuredClone([original, later])

    const { generateBillingUnderlaysForMonth } = await import('@/lib/billing/underlayEngine')
    const result = await generateBillingUnderlaysForMonth({ companyId: C, billingMonth: '2026-09' })
    expect(result).toMatchObject({ readyForPricing: 2, needsReview: 0 })
    const store = rpcCalls.find(({ fn }) => fn === 'gridex_store_billing_underlay_batch')
    const commands = store?.args.p_commands as Array<{ underlay: Row; items: Row[] }>
    expect(commands).toHaveLength(2)
    expect(commands.map(command => command.underlay.contract_price_snapshot_id)).toEqual([SNAP, laterPriceId])
    expect(commands.map(command => command.underlay.total_kwh)).toEqual(['336', '384'])
    expect(commands.map(command => command.underlay.pricing_snapshot)).toStrictEqual(frozen.map(snapshot => snapshot.snapshot_json))
    expect(commands.map(command => command.items.map(item => item.source_normalized_metering_value_id))).toEqual([[NMV], [uuid(33)]])
    expect([original, later]).toStrictEqual(frozen)
  })

  it.each([
    ['nonzero', [{ ...zeroInvoiceFee, amount: 0.01 }]],
    ['numeric string', [{ ...zeroInvoiceFee, amount: '0' }]],
    ['duplicate', [zeroInvoiceFee, zeroInvoiceFee]],
    ['different fee', [{ ...zeroInvoiceFee, component_code: 'other_fee' }]],
    ['inactive', [{ ...zeroInvoiceFee, status: 'inactive' }]],
    ['different lifecycle', [{ ...zeroInvoiceFee, metadata: { lifecycle: 'monthly' } }]],
  ])('keeps a %s component under the review guard despite a protected timeline', async (_label, fees) => {
    const { original, later } = seedEffectiveTimeline()
    putFee(original, [zeroInvoiceFee])
    putFee(later, fees)

    const { generateBillingUnderlaysForMonth } = await import('@/lib/billing/underlayEngine')
    const result = await generateBillingUnderlaysForMonth({ companyId: C, billingMonth: '2026-09' })
    expect(result).toMatchObject({ readyForPricing: 0, needsReview: 1 })
    expect(result.results[0].warnings).toContainEqual(expect.stringMatching(/^billing_price_version_period_charges_require_review:/))
    expect(rpcCalls.some(({ fn }) => fn === 'gridex_store_billing_underlay_batch')).toBe(false)
  })

  it('keeps the canonical zero invoice fee under the review guard in a legacy split', async () => {
    const { original, later } = seedSignedAddendum()
    const previous = { ...original, valid_to: '2026-09-14' }
    const next = { ...later, source: 'issue_signed_terms' }
    putFee(previous, [zeroInvoiceFee])
    putFee(next, [zeroInvoiceFee])
    tables.contract_price_snapshots = [previous, next]

    const { generateBillingUnderlaysForMonth } = await import('@/lib/billing/underlayEngine')
    const result = await generateBillingUnderlaysForMonth({ companyId: C, billingMonth: '2026-09' })
    expect(result).toMatchObject({ readyForPricing: 0, needsReview: 1 })
    expect(result.results[0].warnings).toContainEqual(expect.stringMatching(/^billing_price_version_period_charges_require_review:/))
    expect(rpcCalls.some(({ fn }) => fn === 'gridex_store_billing_underlay_batch')).toBe(false)
  })

  function seedSignedFixedBaseOnly() {
    const { original, later } = seedEffectiveTimeline()
    const snapshot = original as Row
    const bases = [{ source_type: 'fixed', label: 'Fast pris', weight_percent: 100, fixed_price_sek_per_kwh: 2, price_area: 'SE3' }]
    const { fixed_price_ore_per_kwh: _absent, ...frozen } = originalPricing
    snapshot.snapshot_quality = 'canonical'
    snapshot.snapshot_json = { ...frozen, base_price_components_snapshot: structuredClone(bases) }
    snapshot.base_price_components_snapshot = bases
    putFee(snapshot, [zeroInvoiceFee])
    putFee(later, [zeroInvoiceFee])
    return { snapshot, bases }
  }

  it('accepts the actual signer’s canonical fixed base rate without a duplicate scalar', async () => {
    const { snapshot } = seedSignedFixedBaseOnly()
    const frozen = structuredClone(snapshot)

    const { generateBillingUnderlaysForMonth } = await import('@/lib/billing/underlayEngine')
    const result = await generateBillingUnderlaysForMonth({ companyId: C, billingMonth: '2026-09' })
    expect(result).toMatchObject({ readyForPricing: 2, needsReview: 0 })
    const store = rpcCalls.find(({ fn }) => fn === 'gridex_store_billing_underlay_batch')
    const commands = store?.args.p_commands as Array<{ underlay: Row; items: Row[] }>
    expect(commands).toHaveLength(2)
    expect(commands[0].underlay).toMatchObject({ contract_price_snapshot_id: SNAP, total_kwh: '336' })
    expect(commands[0].underlay.pricing_snapshot).toStrictEqual(frozen.snapshot_json)
    expect(frozen.snapshot_json).not.toHaveProperty('fixed_price_ore_per_kwh')
    expect(snapshot).toStrictEqual(frozen)
  })

  it.each([
    ['mismatched price area', (snapshot: Row, bases: Row[]) => { bases[0].price_area = 'SE4' }],
    ['non-unit weight', (snapshot: Row, bases: Row[]) => { bases[0].weight_percent = 50 }],
    ['non-numeric rate', (snapshot: Row, bases: Row[]) => { bases[0].fixed_price_sek_per_kwh = '2' }],
    ['unknown mirror', (snapshot: Row, bases: Row[]) => { delete bases[0].fixed_price_sek_per_kwh }],
    ['duplicated base', (snapshot: Row, bases: Row[]) => { bases.push(bases[0]) }],
    ['unqualified provenance', (snapshot: Row) => { snapshot.snapshot_quality = 'legacy' }],
    ['contradictory scalar', (snapshot: Row) => { (snapshot.snapshot_json as Row).fixed_price_ore_per_kwh = 201 }],
    ['invalid scalar', (snapshot: Row) => { (snapshot.snapshot_json as Row).fixed_price_ore_per_kwh = 'unknown' }],
  ] as const)('keeps %s under review in the canonical fixed-base branch', async (_label, mutate) => {
    const { snapshot, bases } = seedSignedFixedBaseOnly()
    mutate(snapshot, bases)

    const { generateBillingUnderlaysForMonth } = await import('@/lib/billing/underlayEngine')
    const result = await generateBillingUnderlaysForMonth({ companyId: C, billingMonth: '2026-09' })
    expect(result).toMatchObject({ readyForPricing: 0, needsReview: 1 })
    expect(result.results[0].warnings).toContainEqual(expect.stringMatching(/^billing_price_version_period_charges_require_review:/))
    expect(rpcCalls.some(({ fn }) => fn === 'gridex_store_billing_underlay_batch')).toBe(false)
  })

  it('recognizes the same decimal rate in SEK/kWh and öre/kWh', async () => {
    const { snapshot, bases } = seedSignedFixedBaseOnly()
    bases[0].fixed_price_sek_per_kwh = 0.783
    snapshot.snapshot_json = { ...(snapshot.snapshot_json as Row), base_price_components_snapshot: structuredClone(bases), fixed_price_ore_per_kwh: 78.3 }

    const { generateBillingUnderlaysForMonth } = await import('@/lib/billing/underlayEngine')
    expect(await generateBillingUnderlaysForMonth({ companyId: C, billingMonth: '2026-09' }))
      .toMatchObject({ readyForPricing: 2, needsReview: 0 })
  })

  it('keeps the originally signed price when the raw later row has no effective authority', async () => {
    const { original } = seedSignedAddendum()
    const segments = [{ snapshot: original, effectiveFrom: meteringValue.period_start, effectiveUntil: meteringValue.period_end }]
    effectivePriceTimelines.set(CT, { data: { kind: 'ready', basisSha256, segments }, error: null })

    const { generateBillingUnderlaysForMonth } = await import('@/lib/billing/underlayEngine')
    const result = await generateBillingUnderlaysForMonth({ companyId: C, billingMonth: '2026-09' })
    expect(result).toMatchObject({ readyForPricing: 1, needsReview: 0 })
    const store = rpcCalls.find(({ fn }) => fn === 'gridex_store_billing_underlay_batch')
    expect(store?.args.p_commands).toMatchObject([{ underlay: {
      contract_price_snapshot_id: SNAP, billing_period_start: meteringValue.period_start,
      billing_period_end: meteringValue.period_end, total_kwh: '720', pricing_snapshot: originalPricing,
    } }])
  })

  it('holds a raw addendum row appearing after the affirmative legacy read', async () => {
    const { original, later } = seedSignedAddendum()
    tables.contract_price_snapshots = [{ ...original, valid_to: '2026-09-14' }, later]

    const { generateBillingUnderlaysForMonth } = await import('@/lib/billing/underlayEngine')
    const result = await generateBillingUnderlaysForMonth({ companyId: C, billingMonth: '2026-09' })
    expect(result).toMatchObject({ readyForPricing: 0, needsReview: 1 })
    expect(result.results[0].warnings).toContainEqual(expect.stringMatching(/^billing_price_timeline_authority_required:/))
    expect(rpcCalls.some(({ fn }) => fn === 'gridex_store_billing_underlay_batch')).toBe(false)
  })

  it('holds a source observation crossing the effective price boundary', async () => {
    seedEffectiveTimeline()
    tables.normalized_metering_values = [meteringValue]

    const { generateBillingUnderlaysForMonth } = await import('@/lib/billing/underlayEngine')
    const result = await generateBillingUnderlaysForMonth({ companyId: C, billingMonth: '2026-09' })
    expect(result).toMatchObject({ readyForPricing: 0, needsReview: 1 })
    expect(result.results[0].warnings).toContainEqual(expect.stringMatching(/^billing_price_version_source_period_incomplete:/))
    expect(rpcCalls.some(({ fn }) => fn === 'gridex_store_billing_underlay_batch')).toBe(false)
  })

  it.each([
    null,
    [],
    { kind: 'legacy', segments: [] },
    { kind: 'held', reason: 'signed_price_addendum_unapplied' },
    { kind: 'ready', basisSha256, segments: [] },
    { kind: 'ready', basisSha256: 'bad-digest', segments: [{}] },
  ])('holds a protected or malformed timeline response without using raw prices (%j)', async data => {
    seedSignedAddendum()
    effectivePriceTimelines.set(CT, { data, error: null })

    const { generateBillingUnderlaysForMonth } = await import('@/lib/billing/underlayEngine')
    const result = await generateBillingUnderlaysForMonth({ companyId: C, billingMonth: '2026-09' })
    expect(result).toMatchObject({ readyForPricing: 0, needsReview: 1 })
    expect(result.results[0].warnings).toContainEqual(expect.stringMatching(/^billing_price_timeline_authority_required:/))
    expect(rpcCalls.some(({ fn }) => fn === 'gridex_store_billing_underlay_batch')).toBe(false)
  })

  it.each([
    ['scope', { company_id: uuid(97) }, cutover],
    ['customer', { customer_id: uuid(98) }, cutover],
    ['contract', { contract_id: uuid(99) }, cutover],
    ['duplicate price', { id: SNAP }, cutover],
    ['missing minute', {}, '2026-09-14T22:01:00.000Z'],
  ])('holds a malformed native member with wrong %s', async (_problem, changes, effectiveFrom) => {
    const { original, later } = seedSignedAddendum()
    const segments = [
      { snapshot: original, effectiveFrom: meteringValue.period_start, effectiveUntil: cutover },
      { snapshot: { ...later, ...changes }, effectiveFrom, effectiveUntil: meteringValue.period_end },
    ]
    effectivePriceTimelines.set(CT, { data: { kind: 'ready', basisSha256, segments }, error: null })

    const { generateBillingUnderlaysForMonth } = await import('@/lib/billing/underlayEngine')
    const result = await generateBillingUnderlaysForMonth({ companyId: C, billingMonth: '2026-09' })
    expect(result).toMatchObject({ readyForPricing: 0, needsReview: 1 })
    expect(result.results[0].warnings).toContainEqual(expect.stringMatching(/^billing_price_timeline_authority_required:/))
    expect(rpcCalls.some(({ fn }) => fn === 'gridex_store_billing_underlay_batch')).toBe(false)
  })

  it('keeps the established legacy timeline proof fields for an unaffected contract', async () => {
    const commands = await engineCommands(true)
    expect(commands).toHaveLength(1)
    expect(commands[0].underlay.payload).toMatchObject({
      contract_price_timeline: { from: meteringValue.period_start, until: meteringValue.period_end, snapshotIds: [SNAP] },
    })
    const payload = commands[0].underlay.payload as Row
    expect(payload.contract_price_timeline).not.toHaveProperty('basisSha256')
  })

  async function runAutomation() {
    projectAutomationStores = true
    const { runMonthlyBillingAutomationForCompany } = await import('@/lib/billing/monthlyAutomation')
    return runMonthlyBillingAutomationForCompany({
      companyId: C, actorUserId: uuid(76), billingMonth: '2026-09',
      companyConfig: {
        id: C, is_active: true, status: 'active', billing_automation_enabled: true, invoice_export_enabled: true,
        billing_provider_environment: 'test', invoice_export_target_system: 'file_export',
      },
    })
  }

  it('offers the complete fresh protected cohort to native prepare from the ordinary monthly automation', async () => {
    seedEffectiveTimeline()

    // The selected tenant remains part of the database projection even with
    // a foreign synthetic row sharing the other cohort identifiers.
    tables.billing_underlays.push({
      id: uuid(78), company_id: uuid(79), customer_id: CU, contract_id: CT, site_id: SITE, metering_point_id: MP,
      underlay_year: 2026, underlay_month: 9, energy_direction: 'consumption', settlement_type: 'invoice',
      status: 'validated', readiness_status: 'ready', billing_block_reason: 'price_timeline_invoice_review_required',
    })
    const result = await runAutomation()
    expect(result).toMatchObject({
      status: 'completed', prepared: 1, blocked: 0, failed: 0,
      underlayResult: { readyForPricing: 2, priceTimelineReviewContractIds: [CT] },
    })
    expect(rpcCalls.filter(({ fn }) => fn === 'gridex_prepare_test_price_series_by_underlays_v1')).toEqual([{
      fn: 'gridex_prepare_test_price_series_by_underlays_v1',
      args: { p_company_id: C, p_actor_user_id: uuid(76), p_billing_month: '2026-09', p_underlay_ids: ['underlay-0', 'underlay-1'] },
    }])
    expect(rpcCalls).toContainEqual(expect.objectContaining({ fn: 'gridex_finish_monthly_billing_run_v1',
      args: expect.objectContaining({ p_status: 'completed', p_total_prepared: 1 }) }))
    expect(rpcCalls.some(({ fn }) => /approve|finish_consolidated|dispatch/.test(fn))).toBe(false)
  })

  it.each(['missing', 'different', 'stale', 'stale at another site'] as const)('keeps the entire cohort held if one member is %s', async (scenario) => {
    seedEffectiveTimeline()
    if (scenario === 'stale' || scenario === 'stale at another site') {
      tables.billing_underlays.push({
        id: uuid(77), company_id: C, customer_id: CU, contract_id: CT,
        site_id: scenario === 'stale' ? SITE : uuid(80), metering_point_id: MP,
        underlay_year: 2026, underlay_month: 9, energy_direction: 'consumption', settlement_type: 'invoice',
        status: 'validated', readiness_status: 'ready', billing_block_reason: 'price_timeline_invoice_review_required',
        price_timeline_basis_sha256: basisSha256,
      })
    } else invalidAutomationProjection = scenario

    const result = await runAutomation()
    expect(result).toMatchObject({ status: 'completed_with_blockers', prepared: 0, failed: 0 })
    expect(rpcCalls.some(({ fn }) => fn === 'gridex_prepare_test_price_series_by_underlays_v1')).toBe(false)
  })

  it('propagates a failed native authority lookup without a raw timeline fallback', async () => {
    seedSignedAddendum()
    const error = { code: '42501', message: 'pricing_scope_denied' }
    effectivePriceTimelines.set(CT, { data: null, error })

    const { generateBillingUnderlaysForMonth } = await import('@/lib/billing/underlayEngine')
    await expect(generateBillingUnderlaysForMonth({ companyId: C, billingMonth: '2026-09' })).rejects.toBe(error)
    expect(rpcCalls.some(({ fn }) => fn === 'gridex_store_billing_underlay_batch')).toBe(false)
  })
})
