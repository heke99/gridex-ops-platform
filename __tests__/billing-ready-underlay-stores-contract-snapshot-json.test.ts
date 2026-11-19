// simulation: T6/004
// reality-defects: F8-B1
// T6/004: every ready billing underlay was refused by public.gridex_store_billing_underlay with
// billing_underlay_supply_contract_price_basis_required, because the store binds a ready underlay's pricing_snapshot to
// the contract price snapshot's snapshot_json by jsonb equality, while the engine sent its enriched pricing payload
// (snapshotPayload: snapshot_json plus contract_price_snapshot_id, pricing_model, base_price_components and
// price_components). This test drives the real engine, captures the exact store commands it builds, and evaluates
// them against the real store function body taken from supabase/schema.sql in PGlite. T6 starts with no qualified supply
// authority. TERM02.03 provides finite qualification and row storage ports so the real SQL can bind and read exact zero.
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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
  chain.single = chain.maybeSingle
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => result().then(resolve, reject)
  return chain
}

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: (table: string) => builder(table),
    rpc: async (fn: string, args: Row) => {
      rpcCalls.push({ fn, args })
      if (fn === 'gridex_read_billing_underlay_source_basis_v1') {
        const { rows } = await queryAsServiceRole<{ basis: Row[] }>(
          'select public.gridex_read_billing_underlay_source_basis_v1($1, $2::uuid[]) basis',
          [args.p_company_id, args.p_underlay_ids],
        )
        return { data: rows[0].basis, error: null }
      }
      if (fn === 'gridex_persist_pricing_run') return { data: 'pricing-run-0', error: null }
      const commands = (args.p_commands as unknown[]) ?? []
      return { data: commands.map((_, i) => `underlay-${i}`), error: null }
    },
  },
}))
vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }))
vi.mock('@/lib/billing/invoiceReadiness', () => ({ assertBillingPeriodOpen: async () => undefined, getBillingPeriodLock: async () => null }))
vi.mock('@/lib/billing/sourceBasis', () => ({
  loadQualifiedBillingValues: async (_c: string, ids: string[]) => new Map(ids.map(id => [id, (tables.normalized_metering_values ?? []).find(r => r.id === id)])),
}))
vi.mock('@/lib/billing/billingGate', () => ({ evaluateBillingGate: () => ({ eligible: true, reasons: [] }) }))
vi.mock('@/lib/billing/consumptionEstimate', () => ({
  companyEstimatesMissingConsumption: async () => false, estimateMissingConsumption: async () => null, missingWindows: () => [],
}))
vi.mock('@/lib/billing/historyRequest', () => ({ ensureHistoricalMeteringRequest: async () => 'requested' }))

const uuid = (n: number) => `20000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const C = uuid(1), CU = uuid(2), MP = uuid(3), SP = uuid(4), CT = uuid(5), SNAP = uuid(6), PV = uuid(7), NMV = uuid(8), SITE = uuid(9), PP = uuid(10)
// Contract price snapshot as persisted at signing: snapshot_json carries none of the keys the engine's pricing payload adds.
const snapshotJson = {
  snapshot_schema: 'gridex_contract_pricing_v7_signed_receipt', pricing_model: 'spot', price_area: 'SE3',
  energy_direction: 'consumption', markup_ore_per_kwh: 4.9, interval_resolution: 'monthly', vat_rate: 25,
}
const baseComponents = [{ source_type: 'spot', weight_percent: 100 }]
const priceComponents = [
  { component_type: 'markup_ore_per_kwh', name: 'Spotpåslag', calculation_type: 'ore_per_kwh', amount: 4.9, unit: 'ore_per_kwh', vat_applicable: true },
  { component_type: 'fixed_monthly_fee', name: 'Månadsavgift', calculation_type: 'fixed_monthly', amount: 49, unit: 'sek_month', vat_applicable: true },
]
const engineAddedKeys = ['contract_price_snapshot_id', 'pricing_model', 'base_price_components', 'price_components']
const meteringValue = {
  id: NMV, company_id: C, customer_id: CU, metering_point_id: MP, supply_period_id: SP, site_id: SITE, customer_site_id: SITE,
  period_start: '2026-08-31T22:00:00.000Z', period_end: '2026-09-30T22:00:00.000Z', quantity_kwh: '612.5', unit: 'kWh', direction: 'consumption',
  revision_status: 'current', billing_status: 'billable', billing_gate_status: 'eligible', billing_gate_snapshot: { status: 'eligible' },
  price_area: 'SE3', metadata: {},
}

function seedEngine(meteringValues: Row[]) {
  rpcCalls.length = 0
  tables.normalized_metering_values = meteringValues
  tables.customer_supply_periods = [{
    id: SP, company_id: C, customer_id: CU, metering_point_id: MP, contract_id: CT, site_id: SITE, customer_site_id: SITE,
    status: 'active', start_date: '2026-09-01', end_date: null,
  }]
  tables.customer_contracts = [{ id: CT, company_id: C, customer_id: CU, metering_point_id: MP, status: 'active', starts_at: '2026-09-01', energy_direction: 'consumption', price_plan_id: PP }]
  tables.contract_price_snapshots = [{
    id: SNAP, company_id: C, contract_id: CT, price_plan_version_id: PV, valid_from: '2026-09-01', valid_to: null, pricing_model: 'spot',
    snapshot_schema_version: 'gridex_contract_pricing_v7_signed_receipt', snapshot_json: snapshotJson,
    base_price_components_snapshot: baseComponents, price_components_snapshot: priceComponents,
  }]
  tables.billing_underlays = []
  tables.billing_underlay_items = []
}

async function engineCommands(meteringValues: Row[] = [meteringValue]) {
  seedEngine(meteringValues)
  const { generateBillingUnderlaysForMonth } = await import('@/lib/billing/underlayEngine')
  await generateBillingUnderlaysForMonth({ companyId: C, billingMonth: '2026-09' })
  const store = rpcCalls.find(c => c.fn === 'gridex_store_billing_underlay_batch')
  return (store?.args.p_commands ?? []) as Array<{ underlay: Row; items: Row[] }>
}

const schema = readFileSync('supabase/schema.sql', 'utf8')
function schemaFunction(name: string, delimiter: string) {
  const start = schema.indexOf(`CREATE FUNCTION ${name}(`)
  const end = schema.indexOf(`\n${delimiter}`, start)
  if (start < 0 || end < 0) throw new Error(`Missing function definition for ${name}`)
  return schema.slice(start, end + delimiter.length + 1)
}
let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role service_role; create schema extensions; create schema gridex_billing_source; create schema gridex_received_sources;
    create schema gridex_utilts_binding;
    grant usage on schema public, gridex_billing_source, gridex_received_sources to service_role;
    create table public.billing_underlays(id uuid primary key, company_id uuid, customer_id uuid, metering_point_id uuid, underlay_year int, underlay_month int,
      billing_period_start date, billing_period_end date, energy_direction text, supply_period_id uuid, total_kwh numeric, payload jsonb, settlement_type text);
    create table public.normalized_metering_values(id uuid primary key, company_id uuid, customer_id uuid, metering_point_id uuid, supply_period_id uuid,
      period_start timestamptz, period_end timestamptz, quantity_kwh numeric, direction text, billing_gate_status text, billing_status text, revision_number int);
    create table public.customer_supply_periods(id uuid primary key, company_id uuid, customer_id uuid, metering_point_id uuid, contract_id uuid, status text, start_date date, end_date date);
    create table public.customer_contracts(id uuid primary key, company_id uuid, customer_id uuid, metering_point_id uuid, status text, starts_at date, ends_at date);
    create table public.contract_price_snapshots(id uuid primary key, company_id uuid, contract_id uuid, price_plan_version_id uuid, snapshot_json jsonb, valid_from date, valid_to date);
    create table public.price_plan_versions(id uuid primary key, company_id uuid, status text, locked_at timestamptz, content_sha256 text);
    create table gridex_billing_source.underlay_bindings(underlay_id uuid primary key, company_id uuid, source_basis jsonb, source_basis_hash text, exact_total_kwh numeric, actor_user_id uuid);
    create table gridex_billing_source.correction_journal(underlay_id uuid);
    create table gridex_received_sources.fixture_qualified_supply(company_id uuid, period_id uuid);
    create function public.ediel_require_invoice_source_copies_available_v1(uuid, uuid) returns void language sql as $$select$$;
    create function gridex_billing_source.lock_values_v1(uuid, uuid[], uuid) returns void language sql as $$select$$;
    create function gridex_received_sources.billing_supply_basis_v1(uuid, uuid, timestamptz, timestamptz) returns jsonb language sql as $$
      select jsonb_build_object('qualified',true) from gridex_received_sources.fixture_qualified_supply where company_id=$1 and period_id=$2$$;
    create function gridex_billing_source.basis_v1(uuid, uuid) returns jsonb language sql as $$
      select jsonb_build_object('qualified',true,'quality',null,'qualityEstablished',true) from public.normalized_metering_values where company_id=$1 and id=$2$$;
    create function extensions.digest(bytea, text) returns bytea language sql as $$select sha256($1) where $2='sha256'$$;
    create function gridex_billing_source.gridex_store_billing_underlay_before_source_v2(uuid,jsonb,jsonb,uuid) returns uuid language sql as $$
      insert into public.billing_underlays(id,company_id,customer_id,metering_point_id,underlay_year,underlay_month,billing_period_start,billing_period_end,energy_direction,supply_period_id,total_kwh,payload)
      values('${uuid(11)}',$1,($2->>'customer_id')::uuid,($2->>'metering_point_id')::uuid,($2->>'underlay_year')::int,($2->>'underlay_month')::int,
        (($2->>'billing_period_start')::timestamptz at time zone 'Europe/Stockholm')::date,(($2->>'billing_period_end')::timestamptz at time zone 'Europe/Stockholm')::date,
        $2->>'energy_direction',($2->>'supply_period_id')::uuid,($2->>'total_kwh')::numeric,$2->'payload') returning id$$;
  `)
  await db.exec(schemaFunction('public.gridex_normalize_billing_energy_flow', 'end $$;'))
  await db.exec('create trigger normalize_underlay before insert on public.billing_underlays for each row execute function public.gridex_normalize_billing_energy_flow()')
  await db.exec(schemaFunction('public.gridex_store_billing_underlay', 'END $_$;'))
  await db.exec(schemaFunction('gridex_billing_source.require_underlay_v1', 'END $$;'))
  await db.exec(schemaFunction('gridex_utilts_binding.canonical_decimal_v2', 'END $_$;'))
  await db.exec(schemaFunction('public.gridex_read_billing_underlay_source_basis_v1', 'END $$;'))
  await db.query('insert into public.customer_supply_periods values($1,$2,$3,$4,$5,$6,$7,null)', [SP, C, CU, MP, CT, 'active', '2026-09-01'])
  await db.query('insert into public.customer_contracts values($1,$2,$3,$4,$5,$6,null)', [CT, C, CU, MP, 'active', '2026-09-01'])
  await db.query('insert into public.contract_price_snapshots values($1,$2,$3,$4,$5,$6,null)', [SNAP, C, CT, PV, JSON.stringify(snapshotJson), '2026-09-01'])
  await db.query('insert into public.price_plan_versions values($1,$2,$3,now(),$4)', [PV, C, 'active', 'a'.repeat(64)])
})

afterAll(async () => { await db?.close() })

beforeEach(async () => {
  rpcCalls.length = 0
  await db.exec(`truncate gridex_received_sources.fixture_qualified_supply,
    public.normalized_metering_values, gridex_billing_source.underlay_bindings, public.billing_underlays`)
})

async function queryAsServiceRole<T>(query: string, args: unknown[]) {
  await db.exec('set role service_role')
  try {
    return await db.query<T>(query, args)
  } finally {
    await db.exec('reset role')
  }
}

function storeAsServiceRole(underlay: Row, items: Row[]) {
  return queryAsServiceRole<{ id: string }>('select public.gridex_store_billing_underlay($1, $2, $3, null) id', [C, JSON.stringify(underlay), JSON.stringify(items)])
}

describe('T6/004 a ready underlay stores the contract price snapshot JSON the store binds to', () => {
  it('keeps the enriched pricing payload on the non-ready missing-values underlay (unchanged path)', async () => {
    const commands = await engineCommands([])
    expect(commands).toHaveLength(1)
    const blocked = commands[0].underlay
    expect(blocked).toMatchObject({ readiness_status: 'blocked', billing_block_reason: 'missing_meter_values', source_meter_value_count: 0, missing_values_count: 1 })
    const payload = blocked.pricing_snapshot as Row
    expect(payload).toMatchObject(snapshotJson)
    for (const key of engineAddedKeys) expect(payload).toHaveProperty(key)
    expect(payload.contract_price_snapshot_id).toBe(SNAP)
    expect(payload.base_price_components).toEqual(baseComponents)
    expect(payload.price_components).toEqual(priceComponents)
    expect(payload).not.toEqual(snapshotJson)
  })

  it('stores a ready underlay whose pricing_snapshot is exactly the contract snapshot_json, and the real store accepts its price basis', async () => {
    const commands = await engineCommands()
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
  })

  it('refuses a ready underlay that carries the enriched pricing payload the engine produced before the fix', async () => {
    const enriched = (await engineCommands([]))[0].underlay.pricing_snapshot as Row
    const ready = (await engineCommands()).find(c => c.underlay.readiness_status === 'ready')
    expect(ready).toBeDefined()
    await expect(storeAsServiceRole({ ...ready!.underlay, pricing_snapshot: enriched }, ready!.items))
      .rejects.toThrow(/billing_underlay_supply_contract_price_basis_required/)
    const rows = await db.query<{ n: number }>('select count(*)::int n from public.billing_underlays')
    expect(rows.rows[0].n).toBe(0)
  })
})

describe('TERM02.03 zero consumption readiness', () => {
  const zeroConsumption = { ...meteringValue, quantity_kwh: '0' }

  it('sends a complete zero consumption period for storage and persists the contracted monthly fee through pricing', async () => {
    const commands = await engineCommands([zeroConsumption])
    expect(commands).toHaveLength(1)
    const { underlay, items } = commands[0]
    expect(underlay).toMatchObject({
      readiness_status: 'ready', billing_block_reason: null, energy_direction: 'consumption', total_kwh: '0',
      source_meter_value_count: 1, missing_values_count: 0,
    })
    expect(items).toMatchObject([{
      source_normalized_metering_value_id: NMV, quantity_kwh: '0', status: 'ready_for_pricing',
    }])
    await db.query('insert into gridex_received_sources.fixture_qualified_supply values($1,$2)', [C, SP])
    await db.query('insert into public.normalized_metering_values values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1)', [
      NMV, C, CU, MP, SP, zeroConsumption.period_start, zeroConsumption.period_end, zeroConsumption.quantity_kwh,
      zeroConsumption.direction, zeroConsumption.billing_gate_status, zeroConsumption.billing_status,
    ])
    const { rows } = await storeAsServiceRole(underlay, items)
    const underlayId = rows[0].id
    const authority = await queryAsServiceRole<{ basis: Row[] }>(
      'select public.gridex_read_billing_underlay_source_basis_v1($1, $2::uuid[]) basis', [C, [underlayId]],
    )
    expect(authority.rows[0].basis).toStrictEqual([{
      id: underlayId, qualified: true, correctionRequired: false, totalKwh: '0', sourceBasisHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }])

    // The pricing entry point reads the stored underlay ID and its real SQL authority through the Supabase port.
    tables.billing_underlays = [{ ...underlay, id: underlayId, company_id: C }]
    const { calculatePricingPreviewForUnderlay } = await import('@/lib/pricing/engine')
    const pricing = await calculatePricingPreviewForUnderlay({ companyId: C, billingUnderlayId: underlayId, persist: true })
    expect(pricing).toMatchObject({
      status: 'success', totalExVat: 49, vatAmount: 12.25, totalIncVat: 61.25, errors: [], pricingRunId: 'pricing-run-0',
    })
    const pricingWrites = rpcCalls.filter(call => call.fn === 'gridex_persist_pricing_run')
    expect(pricingWrites).toHaveLength(1)
    expect(pricingWrites[0].args).toMatchObject({
      p_company_id: C,
      p_billing_underlay_id: underlayId,
      p_result: {
        status: 'success', total_ex_vat: 49, vat_amount: 12.25, total_inc_vat: 61.25, errors: [],
        lines: expect.arrayContaining([
          expect.objectContaining({ line_type: 'fixed_monthly_fee', quantity: 1, amount_ex_vat: 49, amount_inc_vat: 61.25 }),
          expect.objectContaining({ line_type: 'markup_ore_per_kwh', quantity: 0, amount_ex_vat: 0 }),
        ]),
      },
    })
    expect(pricing.lines.filter(line => line.amountExVat !== 0)).toHaveLength(1)
  })

  it('keeps a zero reading with incomplete coverage blocked', async () => {
    const commands = await engineCommands([{ ...zeroConsumption, period_end: '2026-09-30T21:45:00.000Z' }])
    expect(commands).toHaveLength(1)
    expect(commands[0].underlay).toMatchObject({
      readiness_status: 'blocked', total_kwh: '0', source_meter_value_count: 1, missing_values_count: 1,
      billing_block_reason: expect.stringContaining('Mätvärdeslucka'),
    })
  })

  it.each(['production', 'consumption_correction'])('keeps a complete zero %s period blocked', async direction => {
    const commands = await engineCommands([{ ...zeroConsumption, direction }])
    expect(commands).toHaveLength(1)
    expect(commands[0].underlay).toMatchObject({
      readiness_status: 'blocked', energy_direction: direction, total_kwh: '0', missing_values_count: 0,
      billing_block_reason: expect.stringContaining('Total energimängd är ogiltig eller noll.'),
    })
  })
})
