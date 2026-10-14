import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  companyId: 'guard-A' as string | null,
  platform: false,
  facilityJoinError: false,
  queries: [] as Array<{ table: string; filters: Array<[string, unknown]>; select: string }>,
  workQueue: vi.fn(), facilityQueue: vi.fn(), timeline: vi.fn(),
  suppliers: vi.fn(), offers: vi.fn(), goLive: vi.fn(),
}))
vi.mock('@/lib/admin/guards', () => ({
  requireAdminPageAccess: async () => ({ userId: 'operator', email: 'operator@example.invalid', roles: [], permissions: [], companyId: io.companyId, isPlatformAdmin: io.platform }),
  requireAdminPageKeyAccess: async () => ({ userId: 'operator', email: 'operator@example.invalid', roles: [], permissions: [], companyId: io.companyId, isPlatformAdmin: io.platform }),
  isPlatformAdminContext: () => io.platform,
}))
vi.mock('@/lib/tenant/scope', () => ({
  getOperationalCompanyScope: async () => ({ companyId: 'legacy-B', companyName: 'Legacybolag B', message: null }),
  isMissingRelationError: () => false,
}))
vi.mock('@/components/admin/AdminHeader', () => ({ default: ({ workspaceName }: { workspaceName?: string | null }) => React.createElement('header', null, workspaceName) }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement('a', { href }, children) }))
vi.mock('@/components/admin/customers/CustomerIntakeForm', () => ({ default: () => null }))
vi.mock('@/components/admin/customers/CustomerBulkImportPanel', () => ({ default: () => null }))
vi.mock('@/components/admin/customers/CustomerIntakeWorkspace', () => ({ default: () => null }))
vi.mock('@/components/admin/customers/CustomerActionsMenu', () => ({ default: () => null }))
vi.mock('@/lib/masterdata/db', () => ({ listGridOwners: async () => [], listPriceAreas: async () => [], listElectricitySuppliers: io.suppliers }))
vi.mock('@/lib/customer-contracts/db', () => ({ listContractOffers: io.offers }))
vi.mock('@/lib/ediel/platformGoLive', () => ({ getCompanyGoLiveSetupSummary: io.goLive }))
vi.mock('@/lib/performance/companySummaries', () => ({ listCompanyWorkQueue: io.workQueue }))
vi.mock('@/lib/facility/workQueue', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/facility/workQueue')>()), listFacilityWorkQueue: io.facilityQueue }))
vi.mock('@/lib/customers/customerOperationTimeline', () => ({ listCustomerOperationTimeline: io.timeline }))
vi.mock('@/lib/ediel/operations/processNextAction', () => ({ readEdielProcessNextActions: async () => new Map() }))
vi.mock('@/app/admin/facility-requests/actions', () => ({ completeFacilityLookupAction: async () => {}, markFacilityLookupSentManuallyAction: async () => {} }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { email: 'operator@example.invalid' } } }) },
  from(table: string) {
    const entry = { table, filters: [] as Array<[string, unknown]>, select: '' }
    io.queries.push(entry)
    const query = {
      select(value: string) { entry.select = value; return query },
      eq(column: string, value: unknown) { entry.filters.push([column, value]); return query },
      in: () => query, or: () => query, not: () => query, order: () => query, limit: () => query,
      then(resolve: (value: unknown) => unknown) {
        const error = io.facilityJoinError && entry.select.includes('customer:customers!') ? { code: 'PGRST200', message: 'join_missing' } : null
        return Promise.resolve({ data: [], error }).then(resolve)
      },
    }
    return query
  },
}) }))

import WorkQueuePage from '@/app/admin/work-queue/page'
import FacilityRequestsPage from '@/app/admin/facility-requests/page'
import EventsPage from '@/app/admin/events/page'
import IntakePage from '@/app/admin/customers/intake/page'

beforeEach(() => {
  io.companyId = 'guard-A'
  io.platform = false
  io.facilityJoinError = false
  io.queries = []
  for (const mock of [io.workQueue, io.facilityQueue, io.timeline, io.suppliers, io.offers]) mock.mockReset().mockResolvedValue([])
  io.goLive.mockReset().mockResolvedValue(null)
  vi.stubGlobal('React', React)
})

const globalPages = [
  { name: 'work queue', page: WorkQueuePage, loader: io.workQueue },
  { name: 'facility requests', page: FacilityRequestsPage, loader: io.facilityQueue },
]

it.each(globalPages)('$name scopes the actual page and every native read to the permission guard company', async ({ page, loader }) => {
  const html = renderToStaticMarkup(await page())
  expect(loader).toHaveBeenCalledWith(expect.anything(), 'guard-A', expect.anything())
  expect(io.queries.length).toBeGreaterThan(0)
  expect(io.queries.every(q => q.filters.some(([key, value]) => key === 'company_id' && value === 'guard-A'))).toBe(true)
  expect(html).not.toContain('Legacybolag B')
})

it.each(globalPages)('$name fails closed when a tenant guard has no company despite a legacy fallback', async ({ page, loader }) => {
  io.companyId = null
  await expect(page()).rejects.toThrow('saknar ett aktivt bolag')
  expect(loader).not.toHaveBeenCalled()
  expect(io.queries).toEqual([])
})

it.each(globalPages)('$name preserves the authorized platform-wide read independently of selected company', async ({ page, loader }) => {
  io.platform = true
  await page()
  expect(loader).toHaveBeenCalledWith(expect.anything(), null, expect.anything())
  expect(io.queries.every(q => !q.filters.some(([key]) => key === 'company_id'))).toBe(true)
})

it('facility request join fallback retains the canonical company filter', async () => {
  io.facilityJoinError = true
  await FacilityRequestsPage()
  const requests = io.queries.filter(q => q.table === 'grid_owner_information_requests')
  expect(requests).toHaveLength(2)
  expect(requests.every(q => q.filters.some(([key, value]) => key === 'company_id' && value === 'guard-A'))).toBe(true)
})

const selectedPages = [
  { name: 'events', page: () => EventsPage({ searchParams: Promise.resolve({}) }), loader: io.timeline },
  { name: 'intake', page: () => IntakePage({ searchParams: Promise.resolve({}) }), loader: io.offers },
]

it.each(selectedPages)('$name uses the canonical company rather than a legacy owner membership', async ({ page, loader, name }) => {
  const html = renderToStaticMarkup(await page())
  if (name === 'events') expect(loader).toHaveBeenCalledWith(expect.anything(), 'guard-A', expect.anything())
  else {
    expect(loader).toHaveBeenCalledWith({ activeOnly: true, companyId: 'guard-A' })
    expect(io.suppliers).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ companyId: 'guard-A' }))
    expect(io.goLive).toHaveBeenCalledWith('guard-A')
  }
  expect(html).not.toContain('Legacybolag B')
})

it.each(selectedPages)('$name retains an explicitly selected platform company instead of reading across tenants', async ({ page, loader, name }) => {
  io.platform = true
  await page()
  if (name === 'events') expect(loader).toHaveBeenCalledWith(expect.anything(), 'guard-A', expect.anything())
  else expect(loader).toHaveBeenCalledWith({ activeOnly: true, companyId: 'guard-A' })
})

it.each(selectedPages)('$name requires a platform company selection and never borrows a legacy company', async ({ page, loader }) => {
  io.platform = true
  io.companyId = null
  const html = renderToStaticMarkup(await page())
  expect(html).toContain('Välj ett bolag')
  expect(loader).not.toHaveBeenCalled()
  expect(io.goLive).not.toHaveBeenCalled()
})

it('intake fails closed for a missing canonical tenant company before loading offers or setup', async () => {
  io.companyId = null
  await expect(IntakePage({ searchParams: Promise.resolve({}) })).rejects.toThrow('saknar ett aktivt bolag')
  expect(io.offers).not.toHaveBeenCalled()
  expect(io.goLive).not.toHaveBeenCalled()
})
