import { beforeEach, expect, it, vi } from 'vitest'
import type { GridOwnerDataRequestRow, MeteringValueRow } from '@/lib/cis/types'
const io = vi.hoisted(() => ({ calls: [] as Array<{ company: string; table: string }>, tables: {} as Record<string, Array<Record<string, unknown>>> }))
vi.mock('@/lib/supabase/tenantQuery', () => ({ tenantSelect: (company: string, table: string) => {
  io.calls.push({ company, table })
  return { in: async (_key: string, ids: string[]) => ({ data: (io.tables[table] ?? []).filter(row => row.company_id === company && ids.includes(String(row.id))), error: null }) }
} }))
import { loadMeteringBusinessData, meteringBusinessIdentity, filterMeteringBusinessRows } from '@/lib/admin/meteringBusinessData'
const value = { id: 'value', customer_id: 'customer', site_id: 'home', metering_point_id: 'meter', period_start: '2026-10-01', period_end: '2026-11-01', read_at: '2026-11-01' } as unknown as MeteringValueRow
beforeEach(() => {
  io.calls = []
  io.tables = {
    customers: [{ id: 'customer', company_id: 'A', full_name: 'Anna Berg', customer_number: 'K-100' }],
    customer_sites: [{ id: 'home', company_id: 'A', customer_id: 'customer', site_name: 'Sommarstugan', street: 'Strandvägen 2', facility_id: '735999111111111111' }, { id: 'foreign-home', company_id: 'B', customer_id: 'customer', site_name: 'FOREIGN-SITE' }],
    metering_points: [{ id: 'meter', company_id: 'A', site_id: 'home', meter_point_id: '735999222222222222' }],
  }
})
it('loads labels only in the selected company and resolves physical installation/meter identities', async () => {
  const data = await loadMeteringBusinessData('A', [], [value])
  const label = meteringBusinessIdentity(value,data)
  expect(label.customer).toBe('Anna Berg (K-100)')
  expect(label.site).toContain('Sommarstugan')
  expect(label.site).toContain('735999111111111111')
  expect(label.meter).toBe('735999222222222222')
  expect(io.calls).toHaveLength(3)
  expect(io.calls.every(call => call.company === 'A')).toBe(true)
})
it.each(['Anna','K-100','Sommarstugan','Strandvägen','735999111111111111','735999222222222222','2026-10'])('searches visible business information: %s', async query => {
  const data = await loadMeteringBusinessData('A',[],[value])
  expect(filterMeteringBusinessRows([value],data,query)).toEqual([value])
})
it('also searches request periods and retains old reference links', async () => {
  const request = { ...value, requested_period_start: '2026-10-01', requested_period_end: '2026-11-01' } as unknown as GridOwnerDataRequestRow
  const data = await loadMeteringBusinessData('A',[request],[])
  expect(filterMeteringBusinessRows([request],data,'2026-10')).toEqual([request])
  expect(filterMeteringBusinessRows([request],data,'value')).toEqual([request])
})
it('never assigns a foreign-company site or another customer installation to a reading', async () => {
  const foreign = { ...value, site_id: 'foreign-home' }
  const data = await loadMeteringBusinessData('A',[],[foreign])
  expect(meteringBusinessIdentity(foreign,data).site).toBe('Anläggningsuppgifter saknas')
  expect(filterMeteringBusinessRows([foreign],data,'FOREIGN-SITE')).toEqual([])
  expect(meteringBusinessIdentity(value,{ ...data, sites: [{ id: 'home', customer_id: 'other-customer', site_name: 'OTHER-CUSTOMER', facility_id: null, street: null }] }).site).toBe('Anläggningsuppgifter saknas')
})
it('refuses a missing company instead of reading labels globally', async () => {
  await expect(loadMeteringBusinessData('',[],[value])).rejects.toThrow('company_required')
  expect(io.calls).toEqual([])
})
