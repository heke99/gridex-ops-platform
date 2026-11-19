import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AdminUserDetailPage from '@/app/admin/users/[id]/page'

const reads = vi.hoisted(() => ({
  guard: vi.fn(),
  user: vi.fn(),
  roles: vi.fn(),
  permissions: vi.fn(),
  permissionsAcrossCompanies: vi.fn(),
}))

vi.mock('@/lib/admin/guards', () => ({ requirePlatformAdminAccess: reads.guard }))
vi.mock('@/lib/rbac/getAdminUserById', () => ({ getAdminUserById: reads.user }))
vi.mock('@/lib/rbac/getAllRoles', () => ({ getAllRoles: reads.roles }))
vi.mock('@/lib/rbac/getAllPermissions', () => ({ getAllPermissions: reads.permissions }))
vi.mock('@/lib/rbac/getUserPermissions', () => ({ getUserPermissions: reads.permissionsAcrossCompanies }))
vi.mock('@/app/admin/users/[id]/actions', () => ({
  assignUserRoleAction: vi.fn(),
  removeUserRoleAction: vi.fn(),
  addUserPermissionOverrideAction: vi.fn(),
  removeUserPermissionOverrideAction: vi.fn(),
}))

const subjectId = '00000000-0000-4000-8000-000000000001'
const selectedCompanyId = '00000000-0000-4000-8000-000000000002'
const globalRole = { id: 'role-id', key: 'platform_admin', name: 'Platform admin' }
const permission = { id: 'permission-id', key: 'customers.write', name: 'Write customers' }

async function renderPage() {
  const page = await AdminUserDetailPage({ params: Promise.resolve({ id: subjectId }) })
  return renderToStaticMarkup(page)
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('React', React)
  reads.guard.mockResolvedValue({ companyId: selectedCompanyId, permissions: ['roles.manage', 'permissions.manage'] })
  reads.user.mockResolvedValue({
    authUser: { id: subjectId, email: 'subject@example.test' },
    roles: [{ id: 'role-assignment-id', roles: globalRole }],
    overrides: [{ id: 'override-id', effect: 'deny', reason: 'Syntetiskt underlag', permissions: permission }],
  })
  reads.roles.mockResolvedValue([globalRole])
  reads.permissions.mockResolvedValue([permission])
  // The old reader combines, for example, company A write rights with company B read rights.
  reads.permissionsAcrossCompanies.mockResolvedValue(['contracts.write', 'metering.read', 'customers.read'])
})

afterEach(() => vi.unstubAllGlobals())

describe('admin user detail permission display', () => {
  it('renders no cross-company effective count and skips the legacy aggregate reader', async () => {
    const html = await renderPage()

    expect(reads.user).toHaveBeenCalledExactlyOnceWith(subjectId)
    expect(html).not.toContain('Effektiva permissions just nu')
    expect(reads.permissionsAcrossCompanies).not.toHaveBeenCalled()
    expect(html).toContain('Servern bedömer behörigheten för det valda bolaget.')
  })

  it('labels the actual global assignments and preserves global deny and role controls', async () => {
    const html = await renderPage()

    expect(html).toContain('Aktiva globala roller')
    expect(html).toContain('Globala behörighetsundantag')
    expect(html).toContain('platform_admin')
    expect(html).toContain('customers.write')
    expect(html).toContain('Syntetiskt underlag')
    expect(html).toContain('Neka i alla bolag (deny)')
    expect(html).toContain('Lägg till global deny')
    expect(html).toContain('Lägg till roll')
    expect(html).toContain('Ta bort roll')
    expect(html).toContain('Ta bort override')
  })

  it('keeps mutation controls hidden with read-only presentation permissions', async () => {
    reads.guard.mockResolvedValue({ companyId: null, permissions: [] })

    const html = await renderPage()

    expect(html).toContain('platform_admin')
    expect(html).toContain('Syntetiskt underlag')
    expect(html).toContain('roles.manage')
    expect(html).toContain('permissions.manage')
    expect(html).not.toContain('Lägg till roll')
    expect(html).not.toContain('Ta bort roll')
    expect(html).not.toContain('Lägg till global deny')
    expect(html).not.toContain('Ta bort override')
  })

  it('performs no target or catalog reads when the platform guard stops the page', async () => {
    const blocked = new Error('Platform guard did not admit request')
    reads.guard.mockRejectedValue(blocked)

    await expect(renderPage()).rejects.toBe(blocked)

    expect(reads.user).not.toHaveBeenCalled()
    expect(reads.roles).not.toHaveBeenCalled()
    expect(reads.permissions).not.toHaveBeenCalled()
    expect(reads.permissionsAcrossCompanies).not.toHaveBeenCalled()
  })
})
