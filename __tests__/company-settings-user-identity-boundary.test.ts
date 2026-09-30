import { beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  company: 'company-a', membership: true, lookupFailure: false, grantFailure: false,
  authUpdates: [] as unknown[], profileWrites: [] as unknown[], grants: [] as Record<string, unknown>[],
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/admin/guards', () => ({
  requireCompanyScopedActionAccess: async (company: string) => {
    if (company !== fixture.company) throw new Error('Forbidden')
    return { userId: 'actor-a', companyId: company, isPlatformAdmin: false }
  },
}))
vi.mock('@/lib/auth/companyUserAccess', () => ({
  grantCompanyUserAccess: async (input: Record<string, unknown>) => {
    fixture.grants.push(input)
    if (fixture.grantFailure) throw new Error('synthetic private database error')
  },
}))
vi.mock('@/lib/tenant/governance', () => ({ getCompanyById: vi.fn() }))
vi.mock('@/lib/tenant/companyProductionStatus', () => ({ getCompanyProductionStatus: vi.fn() }))
vi.mock('@/lib/tenant/companyLegalProfile', () => ({ updateCompanyAndRebuildLegalProfile: vi.fn() }))
vi.mock('@/lib/errors/safeActionErrors', () => ({ toSafeCompanyProfileError: () => 'Åtgärden kunde inte behandlas. Referens: SYNTHETIC.' }))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    auth: { admin: {
      getUserById: async () => ({ data: { user: fixture.lookupFailure ? null : { id: 'user-shared', email: 'shared@example.invalid', user_metadata: { full_name: 'Shared identity', phone: '+46700000000' } } }, error: fixture.lookupFailure ? new Error('synthetic auth lookup failure') : null }),
      updateUserById: async (...input: unknown[]) => { fixture.authUpdates.push(input); return { error: null } },
    } },
    from: (table: string) => {
      const query = {
        select: () => query, eq: () => query,
        maybeSingle: async () => ({ data: fixture.membership ? { id: 'membership-a', company_id: fixture.company, user_id: 'user-shared' } : null, error: null }),
        upsert: async (input: unknown) => { fixture.profileWrites.push({ table, input }); return { error: null } },
      }
      return query
    },
  },
}))

import { updateCompanyResponsibleUserAction } from '@/app/admin/company-settings/actions'

function form(email = 'shared@example.invalid') {
  const data = new FormData()
  for (const [name, value] of Object.entries({ company_id: 'company-a', user_id: 'user-shared', email, full_name: 'Tenant chosen name', phone: '+46711111111', role_key: 'customer_service_agent' })) data.set(name, value)
  return data
}
const initial = { ok: false, message: '' }

describe('company settings cannot mutate a shared login identity', () => {
  beforeEach(() => { fixture.company = 'company-a'; fixture.membership = true; fixture.lookupFailure = false; fixture.grantFailure = false; fixture.authUpdates = []; fixture.profileWrites = []; fixture.grants = [] })
  it('rejects a tenant-selected replacement login email before any mutation or role grant', async () => {
    const result = await updateCompanyResponsibleUserAction(initial, form('replacement@example.invalid'))
    expect(result.ok).toBe(false)
    expect(fixture.authUpdates).toEqual([])
    expect(fixture.profileWrites).toEqual([])
    expect(fixture.grants).toEqual([])
  })
  it('changes only canonical tenant access, preserving global Auth and profile data', async () => {
    const result = await updateCompanyResponsibleUserAction(initial, form())
    expect(result.ok).toBe(true)
    expect(fixture.authUpdates).toEqual([])
    expect(fixture.profileWrites).toEqual([])
    expect(fixture.grants).toMatchObject([{ companyId: 'company-a', userId: 'user-shared', email: 'shared@example.invalid', fullName: 'Shared identity', roleKey: 'customer_service_agent', actorUserId: 'actor-a' }])
  })
  it('has no global identity side effects when the authoritative access command denies', async () => {
    fixture.grantFailure = true
    const result = await updateCompanyResponsibleUserAction(initial, form())
    expect(result).toEqual({ ok: false, message: 'Åtgärden kunde inte behandlas. Referens: SYNTHETIC.' })
    expect(fixture.authUpdates).toEqual([])
    expect(fixture.profileWrites).toEqual([])
  })
  it.each(['foreign-company', 'missing-membership', 'missing-auth'] as const)('denies %s without Auth/profile/access writes', async (boundary) => {
    if (boundary === 'foreign-company') fixture.company = 'company-b'
    if (boundary === 'missing-membership') fixture.membership = false
    if (boundary === 'missing-auth') fixture.lookupFailure = true
    expect((await updateCompanyResponsibleUserAction(initial, form())).ok).toBe(false)
    expect(fixture.authUpdates).toEqual([])
    expect(fixture.profileWrites).toEqual([])
    expect(fixture.grants).toEqual([])
  })
})
