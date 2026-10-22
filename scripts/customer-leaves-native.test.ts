// reality-defects: (reality scenario H "the customer leaves", FINDINGS H1, H2, H5)
// The monthly billing engine (lib/billing/underlayEngine.ts generateBillingUnderlaysForMonth, the function the
// monthly billing cron runs) around a received end of supply, against the real disposable replay database.
// Each test has its own synthetic tenant. The supply period rows are written exactly as the platform's Z05
// consumer writes them (gridex_received_sources.apply_supply_before_legal_context_v1, plan 'end':
// end_date = permission_date_v1(DTM+93), market_end_at = permission_time_v1(DTM+93), status ending|ended;
// the reality scenario H drives the same state through real inbound messages). Synthetic data only.
//
// `it.fails` = defect CONFIRMED and still open; it turns red when fixed (then make it `it`).
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { generateBillingUnderlaysForMonth } from '@/lib/billing/underlayEngine'
import { literal, nativeSql as sql } from './helpers/ediel-normal-switch-native-fixture'

const run = Date.now().toString(36)
let serial = 0
/** A GS1-valid synthetic GSRN of this run. */
function gsrn() {
  const body = `73599977${String(Date.now() % 1e6).padStart(6, '0')}${String((serial += 1) % 1000).padStart(3, '0')}`
  const sum = [...body].reduce((total, digit, i) => total + Number(digit) * (i % 2 === 0 ? 3 : 1), 0)
  return `${body}${(10 - (sum % 10)) % 10}`
}
/** The instant the Z05 consumer stores for DTM+93 (fixed normal time, +01:00). */
const marketMinute = (wire: string) => sql<string>(`SELECT to_jsonb(gridex_received_sources.permission_time_v1(${literal(wire)}))`)
const marketDate = (wire: string) => sql<string>(`SELECT to_jsonb(gridex_received_sources.permission_date_v1(${literal(wire)}))`)

function tenant(label: string) {
  const company = randomUUID()
  // No billing estimate: a missing value must stay a blocker, never become a Z13 history request in this test.
  sql(`INSERT INTO public.companies(id,name,status,metadata) VALUES(${literal(company)},${literal(`E2E H ${label} ${run}`)},'active','{"billing":{"estimate_missing_consumption":false}}');`)
  return company
}
function customer(company: string, name: string) {
  const id = randomUUID()
  sql(`INSERT INTO public.customers(id,company_id,first_name,last_name,email,customer_type,is_test_data,source)
    VALUES(${literal(id)},${literal(company)},'E2E',${literal(name)},${literal(`e2e-h-${name.toLowerCase()}-${run}@example.invalid`)},'private',true,'e2e_native');`)
  return id
}
function point(company: string, customerId: string, facility = gsrn()) {
  const id = randomUUID()
  sql(`INSERT INTO public.metering_points(id,company_id,customer_id,metering_point_id,meter_point_id,status,is_test_data)
    VALUES(${literal(id)},${literal(company)},${literal(customerId)},${literal(facility)},${literal(facility)},'active',true);`)
  return { id, facility }
}
function period(company: string, customerId: string, pointId: string, fields: Record<string, string | null>) {
  const id = randomUUID(), keys = Object.keys(fields)
  sql(`INSERT INTO public.customer_supply_periods(id,company_id,customer_id,metering_point_id,source,${keys.join(',')})
    VALUES(${literal(id)},${literal(company)},${literal(customerId)},${literal(pointId)},'ediel_qualified_source',${keys.map(k => literal(fields[k])).join(',')});`)
  return id
}
/** What a Z05 for a switch away with DTM+93:<wire> leaves on the period. */
const z05End = (wire: string, status: 'ending' | 'ended') => ({ end_date: marketDate(wire), market_end_at: marketMinute(wire), status })
const runMonth = (companyId: string, billingMonth: string) => generateBillingUnderlaysForMonth({ companyId, billingMonth })

describe('monthly billing around a received end of supply (scenario H)', () => {
  it('H1: the month after a switch away gets no underlay for the customer who left', async () => {
    const company = tenant('switch-away'), a = customer(company, 'Bytt')
    const mp = point(company, a)
    period(company, a, mp.id, { start_date: '2026-09-01', market_start_at: marketMinute('202609010000'), ...z05End('202611010000', 'ended') })
    // The Z05 consumer wrote the first day of the new supplier as end_date.
    expect(marketDate('202611010000')).toBe('2026-11-01')
    const november = await runMonth(company, '2026-11')
    // Before the fix: one 1-day segment (2026-11-01) for the departed customer → a blocked underlay, an estimate
    // or a Z13 history request to the grid owner for a facility we no longer supply.
    expect(november.results, JSON.stringify(november.results)).toEqual([])
    const october = await runMonth(company, '2026-10')
    expect(october.results, 'October is still the customer\'s final month').toHaveLength(1)
  })

  it('H1: a move-in on the same metering point is not blocked as an overlap of the previous occupant', async () => {
    // State as scripts/customer-metering-access-native.test.ts models a move-in (the tenant's point moves to the
    // new occupant). No product path can reach it today (H5 below); the billing rule must still be right.
    const company = tenant('move-in'), a = customer(company, 'Avflyttad'), b = customer(company, 'Inflyttad')
    const mp = point(company, a)
    period(company, a, mp.id, { start_date: '2026-09-01', market_start_at: marketMinute('202609010000'), ...z05End('202611010000', 'ended') })
    sql(`UPDATE public.metering_points SET customer_id=${literal(b)} WHERE id=${literal(mp.id)};`)
    period(company, b, mp.id, { start_date: '2026-11-01', market_start_at: marketMinute('202611010000'), status: 'active' })
    const november = await runMonth(company, '2026-11')
    const warnings = november.results.flatMap(result => result.warnings)
    expect(warnings.filter(w => /Överlappande leveransperioder/.test(w)), JSON.stringify(november.results)).toEqual([])
    expect(november.results).toHaveLength(1)
  })

  it.fails('H2: a September re-run after the Z05 arrived still covers the customer (today: the "ending" period is invisible)', async () => {
    const company = tenant('ending'), a = customer(company, 'Avslutas')
    const mp = point(company, a)
    period(company, a, mp.id, { start_date: '2026-08-01', market_start_at: marketMinute('202608010000'), ...z05End('202611010000', 'ending') })
    const september = await runMonth(company, '2026-09')
    expect(september.results, 'one segment for the fully supplied September').toHaveLength(1)
  })

  it('H2 control: the same customer without a received end is covered in September', async () => {
    const company = tenant('ending-control'), a = customer(company, 'Kvar')
    const mp = point(company, a)
    period(company, a, mp.id, { start_date: '2026-08-01', market_start_at: marketMinute('202608010000'), status: 'active' })
    expect((await runMonth(company, '2026-09')).results).toHaveLength(1)
  })

  it('H5: the same tenant can never hold the new occupant on the previous occupant\'s GSRN', () => {
    const company = tenant('same-tenant-move'), a = customer(company, 'Tidigare'), b = customer(company, 'Ny')
    const mp = point(company, a)
    period(company, a, mp.id, { start_date: '2026-09-01', market_start_at: marketMinute('202609010000'), ...z05End('202611010000', 'ended') })
    // A second row for the new occupant violates the tenant/GSRN unique indexes ...
    expect(() => point(company, b, mp.facility)).toThrow(/duplicate key value violates unique constraint/)
    // ... and canonical onboarding refuses to reuse the row of another customer (gridex_onboard_customer_graph_core).
    expect(sql<boolean>(`SELECT to_jsonb(position('metering_point_owned_by_another_customer' in prosrc)>0) FROM pg_proc WHERE proname='gridex_onboard_customer_graph_core'`)).toBe(true)
  })
})
