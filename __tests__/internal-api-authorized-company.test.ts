import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ effects: [] as string[] }))
const company = '11111111-1111-4111-8111-111111111111'
const foreign = '22222222-2222-4222-8222-222222222222'
vi.mock('@/lib/tenant/scope', () => ({
  assertUserCanOperateCompany: vi.fn(async (_actor: string, target: string) => target),
  requireOperationalCompanyId: vi.fn(async () => foreign),
}))
vi.mock('@/lib/admin/apiGuards', async original => ({
  ...await original<typeof import('@/lib/admin/apiGuards')>(),
  requireAdminApiAccess: vi.fn(async () => ({ guard: { userId: 'actor', companyId: company, roles: ['finance'], permissions: ['billing.write', 'pricing.write'], isAdmin: true, isPlatformAdmin: false, email: null } })),
}))
vi.mock('@/lib/billing/underlayEngine', () => ({ generateBillingUnderlaysForMonth: async ({ companyId }: { companyId: string }) => { state.effects.push(companyId); return {} } }))
vi.mock('@/lib/billing/invoiceReadiness', () => ({
  getBillingPeriodLock: async ({ companyId }: { companyId: string }) => { state.effects.push(companyId); return null },
  lockBillingPeriod: async ({ companyId }: { companyId: string }) => { state.effects.push(companyId); return {} },
  unlockBillingPeriod: vi.fn(),
}))
vi.mock('@/lib/pricing/engine', () => ({
  calculatePricingPreviewForUnderlay: async ({ companyId }: { companyId: string }) => { state.effects.push(companyId); return { status: 'success' } },
  calculatePricingPreviewForBillingMonth: vi.fn(),
  lockPricingPreview: async ({ companyId }: { companyId: string }) => { state.effects.push(companyId) },
}))
import { POST as generate } from '@/app/api/internal/billing/generate-underlay/route'
import { GET as readLock, POST as writeLock } from '@/app/api/internal/billing/period-locks/route'
import { POST as preview } from '@/app/api/internal/pricing/preview/route'
import { POST as reprice } from '@/app/api/internal/pricing/reprice/route'
import { POST as lockPreview } from '@/app/api/internal/pricing/lock-preview/route'
import { assertCompanyAccessForGuard } from '@/lib/tenant/entityGuards'
import { requireOperationalCompanyId } from '@/lib/tenant/scope'
beforeEach(() => { state.effects = []; vi.clearAllMocks() })
describe('Internal operations use the company whose permissions were checked', () => {
  it.each([generate, writeLock, preview, reprice, lockPreview])('keeps writes in the guard company despite another default membership order', async handler => {
    const response = await handler(new Request('https://example.invalid/internal', { method: 'POST', body: JSON.stringify({ billing_month: '2026-10', billing_underlay_id: 'underlay', pricing_run_id: 'run' }) }))
    expect(response.status).toBe(200); expect(state.effects).toEqual([company]); expect(requireOperationalCompanyId).not.toHaveBeenCalled()
  })
  it('keeps reads in the guard company', async () => {
    expect((await readLock(new Request('https://example.invalid/internal?billing_month=2026-10'))).status).toBe(200)
    expect(state.effects).toEqual([company]); expect(requireOperationalCompanyId).not.toHaveBeenCalled()
  })
  it('rejects a foreign document company even if a second membership resolver would select it', async () => {
    await expect(assertCompanyAccessForGuard(foreign, { userId: 'actor', companyId: company, roles: ['finance'], permissions: ['billing.read'], isPlatformAdmin: false })).rejects.toThrow('behörighet')
    expect(requireOperationalCompanyId).not.toHaveBeenCalled()
  })
})
