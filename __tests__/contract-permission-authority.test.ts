import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GuardResult } from '@/lib/admin/guards'

const fixture = vi.hoisted(() => ({
  context: {} as GuardResult,
  assertCompany: vi.fn(async (_actor: string, company: string) => company),
  preview: vi.fn(async () => ({ ok: true, can_delete: true, blockers: [] })),
  archive: vi.fn(async () => ({ ok: true, mode: 'archived' })),
  remove: vi.fn(async () => ({ ok: true, mode: 'deleted' })),
  redirect: vi.fn((path: string): never => { throw new Error(`NEXT_REDIRECT:${path}`) }),
}))
vi.mock('@/lib/admin/guards', () => ({ requireAdminActionAccess: async () => fixture.context }))
vi.mock('@/lib/tenant/scope', () => ({ assertUserCanOperateCompany: fixture.assertCompany }))
vi.mock('@/lib/contracts/adminRepository', () => ({ previewContractDelete: fixture.preview }))
vi.mock('@/lib/contracts/adminMutations', () => ({ archiveContractProduct: fixture.archive, deleteContractProduct: fixture.remove }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: fixture.redirect }))

import { isContractSuperAdmin, requireContractPermissionAction } from '@/lib/contracts/permissions'
import { archiveContractAction, previewContractDeleteAction } from '@/lib/contracts/adminActions'

function context(changes: Partial<GuardResult> = {}): GuardResult {
  return { userId: 'synthetic-actor-a', email: 'actor@example.invalid', permissions: [], roles: ['platform_admin'],
    isAdmin: true, isPlatformAdmin: false, companyId: 'synthetic-company-a', ...changes }
}
function form() {
  const data = new FormData()
  data.set('company_id', 'synthetic-company-a')
  data.set('offer_id', 'synthetic-offer-a')
  return data
}
const initialPreview = { status: 'idle' as const, requestId: null, companyId: null, offerId: null,
  surface: 'contracts' as const, view: 'active' as const, page: 1, preview: null, error: null }

describe('contract administration uses authoritative platform scope', () => {
  beforeEach(() => { vi.clearAllMocks(); fixture.context = context() })

  it.each(['platform_admin', 'super_admin'])('rejects company-scoped %s role names when canonical flag is false', async (role) => {
    fixture.context = context({ roles: [role] })
    expect(isContractSuperAdmin(fixture.context)).toBe(false)
    await expect(requireContractPermissionAction('contracts.archive')).rejects.toThrow('contracts.archive')
  })

  it('preserves genuine global authority even if role-name payload contains no platform name', async () => {
    fixture.context = context({ isPlatformAdmin: true, roles: [], companyId: null })
    expect(isContractSuperAdmin(fixture.context)).toBe(true)
    await expect(requireContractPermissionAction('contracts.archive')).resolves.toBe(fixture.context)
  })

  it('fails closed when the canonical authority flag is missing at runtime', async () => {
    fixture.context = context()
    delete (fixture.context as Partial<GuardResult>).isPlatformAdmin
    expect(isContractSuperAdmin(fixture.context)).toBe(false)
    await expect(requireContractPermissionAction('contracts.archive')).rejects.toThrow('contracts.archive')
  })

  it.each(['pricing_manager', 'contract_manager'])('retains permitted delegated %s access', async (role) => {
    fixture.context = context({ roles: [role], permissions: ['contracts.archive'] })
    await expect(requireContractPermissionAction('contracts.archive')).resolves.toBe(fixture.context)
  })

  it.each([
    { roles: ['contract_manager'], permissions: ['contracts.pause'] },
    { roles: ['operations_agent'], permissions: ['contracts.archive'] },
  ])('denies a missing permission or nondelegatable role', async (changes) => {
    fixture.context = context(changes)
    await expect(requireContractPermissionAction('contracts.archive')).rejects.toThrow('contracts.archive')
  })

  it('the real archive server action denies before resource resolution or mutation dispatch', async () => {
    await expect(archiveContractAction(form())).rejects.toThrow('contracts.archive')
    expect(fixture.assertCompany).not.toHaveBeenCalled()
    expect(fixture.archive).not.toHaveBeenCalled()
    expect(fixture.remove).not.toHaveBeenCalled()
    expect(fixture.redirect).not.toHaveBeenCalled()
  })

  it('the real preview server action returns denial before privileged repository dispatch', async () => {
    const result = await previewContractDeleteAction(initialPreview, form())
    expect(result.status).toBe('error')
    expect(result.error).toContain('contracts.delete_unused')
    expect(result.preview).toBeNull()
    expect(fixture.assertCompany).not.toHaveBeenCalled()
    expect(fixture.preview).not.toHaveBeenCalled()
  })

  it('genuine global admin reaches the real archive dispatch with the actual actor and selected resource', async () => {
    fixture.context = context({ isPlatformAdmin: true, roles: [], companyId: null })
    await expect(archiveContractAction(form())).rejects.toThrow('NEXT_REDIRECT:/admin/contracts?')
    expect(fixture.assertCompany).toHaveBeenCalledWith('synthetic-actor-a', 'synthetic-company-a')
    expect(fixture.archive).toHaveBeenCalledWith({ companyId: 'synthetic-company-a', offerId: 'synthetic-offer-a', actorUserId: 'synthetic-actor-a' })
  })
})
