import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertCompanyAccessForGuard,
  loadCustomerTenantContext,
} from '@/lib/tenant/entityGuards'

const io = vi.hoisted(() => ({
  rowCompanyId: 'B' as string | null,
  operationalCompanyId: 'B',
  operationalResolutions: [] as string[],
  from: vi.fn(),
}))

vi.mock('@/lib/admin/guards', () => ({
  isPlatformAdminContext: (guard: { isPlatformAdmin?: boolean }) =>
    guard.isPlatformAdmin === true,
}))

vi.mock('@/lib/tenant/scope', () => ({
  requireOperationalCompanyId: async (userId: string) => {
    io.operationalResolutions.push(userId)
    return io.operationalCompanyId
  },
}))

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: { from: io.from },
}))

type GuardInput = {
  userId: string
  roles: string[]
  permissions: string[]
  isPlatformAdmin: boolean
  companyId: string | null
}

function guard(
  companyId: string | null,
  isPlatformAdmin = false,
): GuardInput {
  return {
    userId: 'actor',
    roles: isPlatformAdmin ? ['platform_admin'] : ['custom_role'],
    permissions: ['masterdata.write'],
    isPlatformAdmin,
    companyId,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  io.rowCompanyId = 'B'
  io.operationalCompanyId = 'B'
  io.operationalResolutions = []
  io.from.mockImplementation((table: string) => {
    expect(table).toBe('customers')
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({
        data: {
          id: 'customer-B',
          company_id: io.rowCompanyId,
          status: 'active',
        },
        error: null,
      }),
    }
    return chain
  })
})

describe('tenant entity guards retain canonical permission company authority', () => {
  it.each([
    { selected: 'A', target: 'B' },
    { selected: 'B', target: 'A' },
  ])('rejects canonical $selected access to target $target even when the operational default is the target', async ({ selected, target }) => {
    io.operationalCompanyId = target
    await expect(assertCompanyAccessForGuard(target, guard(selected))).rejects.toThrow(
      /behörighet/,
    )
    expect(io.operationalResolutions).toEqual([])
  })

  it('binds the no-cookie canonical company instead of resolving an unsorted operational default', async () => {
    io.operationalCompanyId = 'B'
    await expect(assertCompanyAccessForGuard('B', guard('A'))).rejects.toThrow(
      /behörighet/,
    )
    expect(io.operationalResolutions).toEqual([])
  })

  it.each([
    { label: 'missing canonical company', selected: null, target: 'A' },
    { label: 'blank canonical company', selected: '   ', target: 'A' },
    { label: 'missing row company', selected: 'A', target: null },
    { label: 'blank row company', selected: 'A', target: '   ' },
  ])('rejects $label', async ({ selected, target }) => {
    await expect(assertCompanyAccessForGuard(target, guard(selected))).rejects.toThrow()
    expect(io.operationalResolutions).toEqual([])
  })

  it('permits the same nonempty canonical and row company', async () => {
    await expect(assertCompanyAccessForGuard(' A ', guard('A'))).resolves.toBe('A')
    expect(io.operationalResolutions).toEqual([])
  })

  it('preserves authoritative platform cross-company access', async () => {
    await expect(assertCompanyAccessForGuard('B', guard(null, true))).resolves.toBe('B')
    expect(io.operationalResolutions).toEqual([])
  })

  it('loads a customer but denies it before returning a foreign-company context', async () => {
    io.rowCompanyId = 'B'
    await expect(loadCustomerTenantContext('customer-B', guard('A'))).rejects.toThrow(
      /behörighet/,
    )
    expect(io.from).toHaveBeenCalledOnce()
    expect(io.operationalResolutions).toEqual([])
  })

  it('rejects a loaded customer with missing ownership', async () => {
    io.rowCompanyId = null
    await expect(loadCustomerTenantContext('customer-B', guard('A'))).rejects.toThrow(
      /saknar bolagskoppling/,
    )
  })

  it('returns normalized same-company ownership', async () => {
    io.rowCompanyId = 'A'
    await expect(loadCustomerTenantContext('customer-A', guard('A'))).resolves.toEqual({
      customer: { id: 'customer-B', company_id: 'A', status: 'active' },
      companyId: 'A',
    })
  })
})
