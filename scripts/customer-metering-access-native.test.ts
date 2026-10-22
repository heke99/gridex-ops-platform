// masterplan: none (FINDINGS F79, owner decision 2026-10-22)
// A customer channel returns only metering values inside the customer's own access windows: tenant,
// customer, metering point and an established supply period (Ediel-confirmed start/end), or a value bound
// to a grid-owner-approved metering permission. Real disposable replay, real SQL functions and the real
// Mina sidor readers; synthetic rows only.
import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { supabaseService } from '@/lib/supabase/service'
import { customerMeteringValues, customerNormalizedMeteringValues } from '@/lib/metering/customerMeteringAccess'
import { listPortalMeteringValues, listPortalMonthlyConsumption } from '@/lib/customer-portal/db'
import { literal, nativeSql as sql } from './helpers/ediel-normal-switch-native-fixture'

const company = randomUUID(), otherCompany = randomUUID()
const X = randomUUID(), Y = randomUUID(), Z = randomUUID()
// X lived at facility P1 until 10 September; Y moved in then (the tenant's metering point moves to Y, X's
// ended period stays). Y also has P2 (backdated confirmed start), P3 (two periods with a gap), P4 (cancelled
// period only) and P5 (no supply; history only via a metering permission).
const P1 = randomUUID(), P2 = randomUUID(), P3 = randomUUID(), P4 = randomUUID(), P5 = randomUUID(), PZ = randomUUID()
const approvedPermission = randomUUID(), unapprovedPermission = randomUUID()
const stockholm = (local: string) => sql<string>(`SELECT to_jsonb(to_char((${literal(local)}::timestamp AT TIME ZONE 'Europe/Stockholm') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))`)

type Value = { point: string; customer: string; start: string; key: string; permission?: string }
const values: Value[] = []
const quarter = (point: string, customer: string, local: string, key: string, permission?: string) => values.push({ point, customer, start: local, key, permission })

beforeAll(() => {
  let serial = 0
  const point = (id: string, customer: string, owner = company) => {
    const gsrn = `7359990000000${String(10000 + (serial += 1)).slice(1)}`
    return `INSERT INTO public.metering_points(id,company_id,customer_id,metering_point_id,meter_point_id,status,is_test_data) VALUES(${literal(id)},${literal(owner)},${literal(customer)},${literal(gsrn)},${literal(gsrn)},'active',true);`
  }
  const period = (point: string, customer: string, fields: Record<string, string | null>) => {
    const keys = Object.keys(fields)
    return `INSERT INTO public.customer_supply_periods(company_id,customer_id,metering_point_id,${keys.join(',')}) VALUES(${literal(company)},${literal(customer)},${literal(point)},${keys.map(k => fields[k] === null ? 'NULL' : literal(fields[k])).join(',')});`
  }
  sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(company)},'E2E F79 Elhandel','active'),(${literal(otherCompany)},'E2E F79 Annan','active');
   INSERT INTO public.customers(id,company_id,first_name,last_name,email,customer_type,is_test_data,source) VALUES
    (${literal(X)},${literal(company)},'E2E','Tidigare boende','e2e-f79-x@example.invalid','private',true,'e2e_native'),
    (${literal(Y)},${literal(company)},'E2E','Inflyttad','e2e-f79-y@example.invalid','private',true,'e2e_native'),
    (${literal(Z)},${literal(otherCompany)},'E2E','Annan tenant','e2e-f79-z@example.invalid','private',true,'e2e_native');
   ${point(P1, X)} ${point(P2, Y)} ${point(P3, Y)} ${point(P4, Y)} ${point(P5, Y)} ${point(PZ, Z, otherCompany)}
   ${period(P1, X, { start_date: '2026-08-01', end_date: '2026-09-10', status: 'ended', source: 'ediel_qualified_source',
     market_start_at: stockholm('2026-08-01 00:00'), market_end_at: stockholm('2026-09-10 00:00') })}
   UPDATE public.metering_points SET customer_id=${literal(Y)} WHERE id=${literal(P1)};
   ${period(P1, Y, { start_date: '2026-09-10', status: 'active', source: 'ediel_qualified_source', market_start_at: stockholm('2026-09-10 00:00') })}
   ${period(P2, Y, { start_date: '2026-09-01', status: 'confirmed_by_grid_owner', source: 'ediel_qualified_source', market_start_at: stockholm('2026-09-01 00:00') })}
   ${period(P3, Y, { start_date: '2026-09-01', end_date: '2026-09-05', status: 'ended', source: 'manual' })}
   ${period(P3, Y, { start_date: '2026-09-15', status: 'active', source: 'manual' })}
   ${period(P4, Y, { start_date: '2026-09-01', status: 'cancelled', source: 'manual' })}
   -- Neither row rests on a received grid-owner Z14: one claims 'active' with an id that names no message,
   -- the other is a manual 'approved'. A qualified Z14 transition is the only basis that may open history.
   INSERT INTO public.metering_permissions(id,company_id,customer_id,metering_point_id,status,approved_start_date,approved_end_date,inbound_z14_message_id,source_z14_message_id) VALUES
    (${literal(approvedPermission)},${literal(company)},${literal(Y)},${literal(P5)},'active','2026-06-01','2026-09-01',${literal(randomUUID())},NULL),
    (${literal(unapprovedPermission)},${literal(company)},${literal(Y)},${literal(P5)},'approved','2026-06-01','2026-09-01',NULL,NULL);
   UPDATE public.metering_permissions SET source_z14_message_id=inbound_z14_message_id WHERE id=${literal(approvedPermission)};`)

  quarter(P1, X, '2026-09-09 23:45', 'X last quarter before move-out')
  quarter(P1, Y, '2026-09-09 23:45', 'previous occupant quarter attributed to Y')
  quarter(P1, Y, '2026-09-10 00:00', 'Y first quarter')
  quarter(P2, Y, '2026-09-01 00:00', 'P2 backdated start')
  quarter(P2, Y, '2026-08-31 23:45', 'P2 before confirmed start')
  quarter(P3, Y, '2026-09-04 23:45', 'P3 last quarter of first period')
  quarter(P3, Y, '2026-09-05 00:00', 'P3 gap start')
  quarter(P3, Y, '2026-09-10 12:00', 'P3 in gap')
  quarter(P3, Y, '2026-09-15 00:00', 'P3 second period')
  quarter(P4, Y, '2026-09-02 00:00', 'P4 cancelled period')
  quarter(P5, Y, '2026-07-01 00:00', 'P5 history under unproven active permission', approvedPermission)
  quarter(P5, Y, '2026-07-01 00:15', 'P5 history under manual approval', unapprovedPermission)
  quarter(P5, Y, '2026-07-01 00:30', 'P5 history without permission')
  quarter(PZ, Z, '2026-09-10 00:00', 'other tenant')
  sql(values.map(v => {
    const start = stockholm(v.start)
    const owner = v.point === PZ ? otherCompany : company
    return `INSERT INTO public.normalized_metering_values(company_id,customer_id,metering_point_id,period_start,period_end,quantity_kwh,source_type,source_transaction_reference,resolution,revision_status,direction,status)
      VALUES(${literal(owner)},${literal(v.customer)},${literal(v.point)},${literal(start)},${literal(start)}::timestamptz+interval '15 minutes',1,'e2e_native',${literal(v.key)},'PT15M','current','consumption',${literal(v.key)});
     INSERT INTO public.metering_values(company_id,customer_id,metering_point_id,period_start,period_end,value_kwh,quantity,reading_type,source_system,source_transaction_id,is_current,revision_status,direction,permission_id,quality_code)
      VALUES(${literal(owner)},${literal(v.customer)},${literal(v.point)},${literal(start)},${literal(start)}::timestamptz+interval '15 minutes',1,1,'consumption','e2e_native',${literal(v.key)},true,'current','consumption',${v.permission ? literal(v.permission) : 'NULL'},${literal(v.key)});`
  }).join('\n'))
})

const visibleKeys = async (customers: string[], filters = {}) => {
  const { data, error } = await customerNormalizedMeteringValues({ companyId: company, customerIds: customers }, filters).select('status')
  if (error) throw error
  return (data ?? []).map(row => String(row.status)).sort()
}
const visibleRawKeys = async (customers: string[]) => {
  const { data, error } = await customerMeteringValues({ companyId: company, customerIds: customers }).select('quality_code')
  if (error) throw error
  return (data ?? []).map(row => String(row.quality_code)).sort()
}

describe('customer metering access windows (F79)', () => {
  it('move-in: the new customer never sees the previous occupant; the previous customer keeps its own history', async () => {
    expect(await visibleKeys([X])).toEqual(['X last quarter before move-out'])
    const y = await visibleKeys([Y])
    expect(y).toContain('Y first quarter')
    expect(y).not.toContain('previous occupant quarter attributed to Y')
    expect(y).not.toContain('X last quarter before move-out')
  })

  it('a correctly established backdated start opens exactly from the confirmed start', async () => {
    const y = await visibleKeys([Y])
    expect(y).toContain('P2 backdated start')
    expect(y).not.toContain('P2 before confirmed start')
  })

  it('each period is its own window: the gap stays closed, the end bound is exclusive', async () => {
    const y = await visibleKeys([Y])
    expect(y).toEqual(expect.arrayContaining(['P3 last quarter of first period', 'P3 second period']))
    expect(y).not.toContain('P3 gap start')
    expect(y).not.toContain('P3 in gap')
  })

  it('an unconfirmed or cancelled period opens nothing; other tenants are never returned', async () => {
    const y = await visibleKeys([Y])
    expect(y).not.toContain('P4 cancelled period')
    expect(y).not.toContain('other tenant')
  })

  it('history before our supply opens only on a received grid-owner Z14: unproven or manual approvals stay closed', async () => {
    const raw = await visibleRawKeys([Y])
    expect(raw).not.toContain('P5 history under unproven active permission')
    expect(raw).not.toContain('P5 history under manual approval')
    expect(raw).not.toContain('P5 history without permission')
    expect(await visibleKeys([Y])).not.toContain('P5 history under unproven active permission')
  })

  it('exactly the expected rows, in both series', async () => {
    const expected = ['P2 backdated start', 'P3 last quarter of first period', 'P3 second period', 'Y first quarter']
    expect(await visibleKeys([Y])).toEqual(expected)
    expect(await visibleRawKeys([Y])).toEqual(expected)
  })

  it('direct calls with changed scope, dates or ids cannot widen access', async () => {
    // A customer of another tenant inside the scope is refused outright.
    const foreign = await supabaseService.rpc('gridex_customer_normalized_metering_values_v1', { p_company_id: company, p_customer_ids: [Y, Z] })
    expect(foreign.error?.message).toContain('customer_metering_customer_scope_invalid')
    // Another tenant's own customer never sees our data; without a supply period of its own it sees nothing.
    const other = await supabaseService.rpc('gridex_customer_normalized_metering_values_v1', { p_company_id: otherCompany, p_customer_ids: [Z] })
    expect(other.error).toBeNull()
    expect(other.data).toEqual([])
    // A wider date range or another customer's site does not open a window.
    expect(await visibleKeys([Y], { periodStartFrom: '2020-01-01T00:00:00Z', periodStartBefore: '2030-01-01T00:00:00Z' })).not.toContain('previous occupant quarter attributed to Y')
    expect(await visibleKeys([Y], { periodStartFrom: stockholm('2026-09-09 23:45'), periodStartBefore: stockholm('2026-09-10 00:00') })).toEqual([])
    // The function is not executable by browser roles.
    expect(sql<boolean>(`SELECT to_jsonb(has_function_privilege('authenticated','public.gridex_customer_normalized_metering_values_v1(uuid,uuid[],uuid,text,timestamptz,timestamptz,timestamptz,timestamptz,uuid,integer)','EXECUTE'))`)).toBe(false)
    expect(sql<boolean>(`SELECT to_jsonb(has_function_privilege('anon','public.gridex_customer_metering_values_v1(uuid,uuid[],timestamptz,timestamptz,integer)','EXECUTE'))`)).toBe(false)
  })

  it('the filter runs before the limit: hidden rows never take a slot of the page', async () => {
    const { data } = await customerNormalizedMeteringValues({ companyId: company, customerIds: [Y] }, { limit: 2 }).select('status')
    expect((data ?? []).map(row => row.status)).toEqual(['P3 second period', 'Y first quarter'])
  })

  it('Mina sidor detail rows and month cards follow the same windows', async () => {
    const context = { companyId: company, customerIds: [Y] } as Parameters<typeof listPortalMeteringValues>[0]
    const rows = await listPortalMeteringValues(context, { limit: 50 })
    expect(rows).toHaveLength(4)
    expect(rows.every(row => row.customer_id === Y)).toBe(true)
    const months = await listPortalMonthlyConsumption(context, { now: new Date('2026-09-20T12:00:00Z'), months: 4 })
    const september = months.find(month => month.monthKey === '2026-09')
    // Four visible September quarters of 1 kWh; the hidden ones never reach the sum.
    expect(september?.totalKwh).toBe(4)
    expect(months.find(month => month.monthKey === '2026-07')).toBeUndefined()
  })
})
