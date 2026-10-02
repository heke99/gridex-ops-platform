import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadCustomerTenantContext: vi.fn(),
  assertUserCanOperateCompany: vi.fn(),
  ingestMeteringValue: vi.fn(),
  ingestBillingUnderlay: vi.fn(),
  queries: [] as Array<{ table: string; filters: Array<[string, unknown]> }>,
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/admin/guards', () => ({
  requireAdminActionAccess: vi.fn(async () => ({ userId: 'actor-1', roles: [], permissions: [], isPlatformAdmin: false })),
}))
vi.mock('@/lib/tenant/entityGuards', () => ({ loadCustomerTenantContext: mocks.loadCustomerTenantContext }))
vi.mock('@/lib/tenant/scope', () => ({ assertUserCanOperateCompany: mocks.assertUserCanOperateCompany }))
vi.mock('@/lib/cis/db', () => ({
  ingestMeteringValue: mocks.ingestMeteringValue,
  ingestBillingUnderlay: mocks.ingestBillingUnderlay,
}))
vi.mock('@/lib/supabase/service', () => {
  const builder = (table: string) => {
    const entry = { table, filters: [] as Array<[string, unknown]> }
    mocks.queries.push(entry)
    const rows =
      table === 'metering_points'
        ? [{ id: 'mp-1', site_id: 'site-1', meter_point_id: '735999000000000001', grid_owner_id: null }]
        : table === 'customer_sites'
          ? [{ id: 'site-1', facility_id: null, site_name: 'S', grid_owner_id: null }]
          : []
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        entry.filters.push([column, value])
        return chain
      },
      insert: async () => ({ error: null }),
      then: (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null }),
    }
    return chain
  }
  return { supabaseService: { from: builder } }
})

import { importGridOwnerFileAction } from '@/app/admin/customers/[id]/grid-owner-import-actions'

function importForm(customerId: string) {
  const form = new FormData()
  form.set('customer_id', customerId)
  form.set('import_mode', 'meter_values')
  form.set('file', new File(['meter_point_id;value_kwh\n735999000000000001;12.5\n'], 'values.csv'))
  return form
}

describe('tenant isolation for customer-bound server actions', () => {
  beforeEach(() => {
    mocks.queries.length = 0
    vi.clearAllMocks()
  })

  it('rejects a grid-owner file import for another tenant customer before any write', async () => {
    mocks.loadCustomerTenantContext.mockRejectedValueOnce(new Error('Du saknar behörighet för valt bolag.'))

    await expect(importGridOwnerFileAction(importForm('foreign-customer'))).rejects.toThrow('behörighet')
    expect(mocks.ingestMeteringValue).not.toHaveBeenCalled()
    expect(mocks.queries.filter((query) => query.table !== 'audit_logs')).toHaveLength(0)
  })

  it('rejects an import into a paused company', async () => {
    mocks.loadCustomerTenantContext.mockResolvedValueOnce({ companyId: 'company-a', customer: { id: 'c', company_id: 'company-a', status: 'active' } })
    mocks.assertUserCanOperateCompany.mockRejectedValueOnce(new Error('Bolaget är pausat'))

    await expect(importGridOwnerFileAction(importForm('c'))).rejects.toThrow('pausat')
    expect(mocks.ingestMeteringValue).not.toHaveBeenCalled()
  })

  it('scopes site and metering-point lookups to the customer company and maps meter values', async () => {
    mocks.loadCustomerTenantContext.mockResolvedValueOnce({ companyId: 'company-a', customer: { id: 'c', company_id: 'company-a', status: 'active' } })
    mocks.assertUserCanOperateCompany.mockResolvedValueOnce('company-a')

    await importGridOwnerFileAction(importForm('c'))

    for (const table of ['customer_sites', 'metering_points']) {
      const query = mocks.queries.find((entry) => entry.table === table)
      expect(query?.filters).toContainEqual(['company_id', 'company-a'])
      expect(query?.filters).toContainEqual(['customer_id', 'c'])
    }
    expect(mocks.ingestMeteringValue).toHaveBeenCalledWith(expect.objectContaining({ meteringPointId: 'mp-1', valueKwh: 12.5 }))
  })

  it('checks record ownership before cross-entity CIS writes', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'app/admin/cis/actions.ts'), 'utf8')
    const body = (name: string) => {
      const start = source.indexOf(`export async function ${name}(`)
      const end = source.indexOf('\nexport async function ', start + 1)
      return source.slice(start, end === -1 ? undefined : end)
    }

    const queue = body('queueOutboundRequestAction')
    expect(queue.indexOf("table: 'customers'")).toBeGreaterThan(-1)
    expect(queue.indexOf('assertEntityCompanyAccess')).toBeLessThan(queue.indexOf('createOutboundRequest('))

    for (const name of ['updateGridOwnerDataRequestStatusAction', 'prepareGridOwnerDataRequestEdielAction']) {
      const fn = body(name)
      expect(fn).toContain("table: 'grid_owner_data_requests'")
      const write = name.startsWith('update') ? 'updateGridOwnerDataRequestStatus(' : 'ensureAndPrepareUtiltsFromDataRequest('
      expect(fn.indexOf('assertEntityCompanyAccess')).toBeLessThan(fn.indexOf(write))
    }
  })

  it('requires an operational company for every customer-card mutation', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'app/admin/customers/[id]/actions.part-4.ts'), 'utf8')
    const start = source.indexOf('export async function requireCustomerMutationContext(')
    const fn = source.slice(start, source.indexOf('\n}\n', start))
    expect(fn).toContain('loadCustomerTenantContext(customerId, guard)')
    expect(fn).toContain('assertUserCanOperateCompany(guard.userId, context.companyId)')
  })
})
