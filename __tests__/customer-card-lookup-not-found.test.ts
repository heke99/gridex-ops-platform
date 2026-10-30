// simulation: 20261029-3f1a8ab1/claude-track2/003, TERM01 (tenantkontroll)
import { describe, expect, it, vi } from 'vitest'
import { resolveCustomerCardLookup } from '@/app/admin/customers/[id]/customer-lookup-outcome'

const tenantA = { isPlatformAdmin: false, companyId: 'company-a' }
const platform = { isPlatformAdmin: true, companyId: null }
const row = (over: Partial<{ company_id: string | null; source: string | null }> = {}) => ({ company_id: 'company-a', source: null, ...over })

describe('customer card lookup outcome (finding 003)', () => {
  it('answers a customer of another company exactly like a missing id', () => {
    const foreign = resolveCustomerCardLookup(tenantA, row({ company_id: 'company-b' }))
    const missing = resolveCustomerCardLookup(tenantA, null)
    expect(foreign).toEqual({ kind: 'not_found' })
    expect(missing).toEqual(foreign)
  })

  it('answers a customer without company link as not found', () => {
    expect(resolveCustomerCardLookup(tenantA, row({ company_id: null }))).toEqual({ kind: 'not_found' })
    expect(resolveCustomerCardLookup(platform, row({ company_id: null }))).toEqual({ kind: 'not_found' })
  })

  it('keeps the explanatory states that do not reveal another tenant', () => {
    expect(resolveCustomerCardLookup({ isPlatformAdmin: false, companyId: null }, row())).toEqual({ kind: 'no_active_company' })
    expect(resolveCustomerCardLookup(tenantA, row({ source: 'ediel_portal_test' }))).toEqual({ kind: 'ediel_portal_test' })
  })

  it('does not hint at an Ediel control customer of another company', () => {
    expect(resolveCustomerCardLookup(tenantA, row({ company_id: 'company-b', source: 'ediel_portal_test' }))).toEqual({ kind: 'not_found' })
  })

  it('opens own and platform-visible customers', () => {
    expect(resolveCustomerCardLookup(tenantA, row())).toEqual({ kind: 'ok', companyId: 'company-a' })
    expect(resolveCustomerCardLookup(platform, row({ company_id: 'company-b' }))).toEqual({ kind: 'ok', companyId: 'company-b' })
  })
})

// The workspace layout runs before the page and used to throw different errors for a
// missing id ("Kunden hittades inte.") and another tenant's id ("Du saknar behörighet
// för valt bolag."). Both must now end in the same notFound().
const layoutIo = vi.hoisted(() => ({ row: null as null | { id: string; company_id: string | null; status: string | null }, contextCalls: 0, queries: 0, companyId: 'company-a' as string | null }))
vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND') } }))
vi.mock('@/components/admin/customers/CustomerActionsMenu', () => ({ default: () => null }))
vi.mock('@/lib/admin/guards', () => ({
  requireAdminPageAccess: async () => ({ userId: 'staff-a', roles: [], permissions: ['customers.read'], isPlatformAdmin: false, companyId: layoutIo.companyId }),
  isPlatformAdminContext: () => false,
}))
vi.mock('@/lib/tenant/entityGuards', () => ({
  guardIsPlatformAdmin: (g: { isPlatformAdmin: boolean }) => g.isPlatformAdmin,
  loadCustomerTenantContext: async () => { layoutIo.contextCalls += 1; return { companyId: 'company-a' } },
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: () => {
  const q = { select: () => q, eq: () => q, in: () => q, is: () => q, order: () => q, limit: async () => ({ data: [], error: null }), maybeSingle: async () => { layoutIo.queries += 1; return { data: layoutIo.row, error: null } } }
  return q
} } }))

describe('customer workspace layout answers 404 before any tenant-specific error (finding 003)', () => {
  const run = async (id: string) => {
    const { default: Layout } = await import('@/app/admin/customers/[id]/layout')
    try { await Layout({ children: null, params: Promise.resolve({ id }) }); return 'rendered' } catch (e) { return (e as Error).message }
  }

  it('gives the same notFound for a missing id and another tenant\'s customer', async () => {
    layoutIo.row = null; layoutIo.contextCalls = 0
    const missing = await run('00000000-0000-4000-8000-000000000003')
    layoutIo.row = { id: 'c-b', company_id: 'company-b', status: 'active' }
    const foreign = await run('00000000-0000-4000-8000-0000000000cb')
    expect(missing).toBe('NEXT_NOT_FOUND')
    expect(foreign).toBe(missing)
    expect(layoutIo.contextCalls, 'tenant guard with distinct error text is never reached').toBe(0)
  })

  it('answers a malformed id with the same notFound and never queries the database', async () => {
    layoutIo.row = null; layoutIo.contextCalls = 0; layoutIo.queries = 0
    expect(await run('not-a-uuid')).toBe('NEXT_NOT_FOUND')
    expect(layoutIo.queries).toBe(0)
  })

  it('treats a customer without company link as not found', async () => {
    layoutIo.row = { id: 'c-x', company_id: null, status: 'active' }
    expect(await run('00000000-0000-4000-8000-0000000000c0')).toBe('NEXT_NOT_FOUND')
  })

  it('still runs the full tenant guard for the actor\'s own customer', async () => {
    layoutIo.row = { id: 'c-a', company_id: 'company-a', status: 'active' }; layoutIo.contextCalls = 0
    expect(await run('00000000-0000-4000-8000-0000000000ca')).toBe('rendered')
    expect(layoutIo.contextCalls).toBe(1)
  })

  it('answers an actor without active company the same for every customer id', async () => {
    layoutIo.companyId = null; layoutIo.contextCalls = 0
    layoutIo.row = null
    const missing = await run('00000000-0000-4000-8000-000000000003')
    layoutIo.row = { id: 'c-b', company_id: 'company-b', status: 'active' }
    const foreign = await run('00000000-0000-4000-8000-0000000000cb')
    layoutIo.companyId = 'company-a'
    expect(missing).toBe('rendered')
    expect(foreign).toBe(missing)
    expect(layoutIo.contextCalls).toBe(0)
  })
})
