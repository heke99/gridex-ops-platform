// reality-defects: (reality scenario H "the customer leaves", FINDINGS H2/H3: monthly re-gating)
// A value gated while its supply period was 'ending' (supply_period_missing) is evaluated again by the
// monthly billing run (lib/billing/supplyEndRegate.ts) with the real gate and the real database writer. The
// synthetic value has no qualified Ediel source, so the gate still refuses it, but for that reason only: the
// supply period is now found and the supply-end hold is gone. Values of other points, other tenants and
// already eligible values are not touched. Synthetic data only, disposable replay.
import { randomUUID } from 'node:crypto'
import { expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { regateSupplyEndValues } from '@/lib/billing/supplyEndRegate'
import { literal, nativeSql as sql } from './helpers/ediel-normal-switch-native-fixture'

const run = Date.now().toString(36)
function tenant() {
  const company = randomUUID(), customer = randomUUID(), point = randomUUID(), facility = `7359997${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 9)}`
  sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(company)},${literal(`E2E H regate ${run}`)},'active');
   INSERT INTO public.customers(id,company_id,first_name,last_name,email,customer_type,is_test_data,source) VALUES(${literal(customer)},${literal(company)},'E2E','Regate',${literal(`e2e-h-regate-${company.slice(0, 8)}@example.invalid`)},'private',true,'e2e_native');
   INSERT INTO public.metering_points(id,company_id,customer_id,metering_point_id,meter_point_id,status,is_test_data) VALUES(${literal(point)},${literal(company)},${literal(customer)},${literal(facility)},${literal(facility)},'active',true);`)
  return { company, customer, point }
}
function heldValue(t: { company: string; customer: string; point: string }, localStart: string, gate: { status: string; reasons: string[] }) {
  const raw = randomUUID(), value = randomUUID()
  sql(`WITH s AS (SELECT (${literal(localStart)}::timestamp AT TIME ZONE 'Europe/Stockholm') ts)
   INSERT INTO public.metering_values(id,company_id,customer_id,metering_point_id,period_start,period_end,value_kwh,quantity,reading_type,source_system,source_transaction_id,is_current,revision_status,direction)
    SELECT ${literal(raw)},${literal(t.company)},${literal(t.customer)},${literal(t.point)},ts,ts+interval '15 minutes',0.25,0.25,'consumption','e2e_native',${literal(raw)},true,'current','consumption' FROM s;
   WITH s AS (SELECT (${literal(localStart)}::timestamp AT TIME ZONE 'Europe/Stockholm') ts)
   INSERT INTO public.normalized_metering_values(id,company_id,customer_id,metering_point_id,source_metering_value_id,period_start,period_end,quantity_kwh,source_type,source_transaction_reference,resolution,revision_status,direction,status,billing_status,billing_gate_status,billing_gate_reasons)
    SELECT ${literal(value)},${literal(t.company)},${literal(t.customer)},${literal(t.point)},${literal(raw)},ts,ts+interval '15 minutes',0.25,'e2e_native',${literal(raw)},'PT15M','current','consumption','e2e',
     ${literal(gate.status === 'eligible' ? 'billable' : gate.status)},${literal(gate.status)},${literal(JSON.stringify(gate.reasons.map(code => ({ code, message: code }))))}::jsonb FROM s;`)
  return value
}
const reasonsOf = (id: string) => sql<{ status: string; reasons: string[] }>(`SELECT jsonb_build_object('status',billing_gate_status,'reasons',(SELECT coalesce(jsonb_agg(r->>'code' ORDER BY r->>'code'),'[]') FROM jsonb_array_elements(coalesce(billing_gate_reasons,'[]')) r)) FROM public.normalized_metering_values WHERE id=${literal(id)}`)

it('H2/H3: a value held for a supply end is gated again in its month; nothing else is touched', async () => {
  const t = tenant(), other = tenant()
  sql(`INSERT INTO public.customer_supply_periods(company_id,customer_id,metering_point_id,start_date,end_date,market_start_at,market_end_at,status,source)
   VALUES(${literal(t.company)},${literal(t.customer)},${literal(t.point)},'2026-09-01','2026-11-01',gridex_received_sources.permission_time_v1('202609010000'),gridex_received_sources.permission_time_v1('202611010000'),'ending','ediel_qualified_source'),
    (${literal(other.company)},${literal(other.customer)},${literal(other.point)},'2026-09-01',NULL,gridex_received_sources.permission_time_v1('202609010000'),NULL,'active','ediel_qualified_source');`)
  const held = heldValue(t, '2026-10-20 12:00', { status: 'pending_match', reasons: ['supply_period_missing'] })
  const otherReason = heldValue(t, '2026-10-20 12:15', { status: 'blocked', reasons: ['quality_not_final'] })
  const otherMonth = heldValue(t, '2026-09-20 12:00', { status: 'pending_match', reasons: ['supply_period_missing'] })
  const otherTenant = heldValue(other, '2026-10-20 12:00', { status: 'pending_match', reasons: ['supply_period_missing'] })
  const before = { otherReason: reasonsOf(otherReason), otherMonth: reasonsOf(otherMonth), otherTenant: reasonsOf(otherTenant) }

  const result = await regateSupplyEndValues({ companyId: t.company, billingMonth: '2026-10' })
  expect(result, JSON.stringify(result)).toMatchObject({ candidates: 1, evaluated: 1, failed: 0 })
  const after = reasonsOf(held)
  // The 'ending' period now carries the value; only the missing qualified source keeps it from billing.
  expect(after.reasons, JSON.stringify(after)).not.toContain('supply_period_missing')
  expect(after.reasons).not.toContain('supply_period_not_active')
  expect(after.reasons).toContain('source_basis_unqualified')
  expect(sql<string | null>(`SELECT to_jsonb(supply_period_id) FROM public.normalized_metering_values WHERE id=${literal(held)}`)).toBeTruthy()
  expect({ otherReason: reasonsOf(otherReason), otherMonth: reasonsOf(otherMonth), otherTenant: reasonsOf(otherTenant) }).toEqual(before)
  // Another tenant's month is never read through this tenant's run.
  expect(await regateSupplyEndValues({ companyId: other.company, billingMonth: '2026-10' })).toMatchObject({ candidates: 0, evaluated: 0 })
})
