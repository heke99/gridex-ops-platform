import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  guard: {
    userId: 'synthetic-admin', email: 'admin@example.invalid', companyId: 'company-A' as string | null,
    permissions: ['users.write'], roles: ['company_admin'], isPlatformAdmin: false, isAdmin: true,
  },
  profileAction: vi.fn(),
  userAction: vi.fn(),
  profileState: { ok: false, message: '' },
  userState: { ok: false, message: '' },
  pending: false,
  useActionState: vi.fn(),
}))

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useActionState: fixture.useActionState,
}))
vi.mock('@/lib/admin/guards', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/admin/guards')>(),
  requireAdminPageKeyAccess: async () => fixture.guard,
}))
vi.mock('@/lib/tenant/governance', () => ({
  getCompanyById: async () => ({ id: 'company-A', name: 'Syntetiskt bolag', branding: null }),
  listCompanyUsersForGovernance: async () => [{
    membershipId: 'membership-A', userId: 'user-A', fullName: 'Syntetisk användare',
    email: 'user@example.invalid', invitedEmail: null, membershipRole: 'admin', roleKey: 'company_admin',
  }],
}))
vi.mock('@/lib/contracts/canonical', () => ({ getTenantLegalProfile: async () => null }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: () => null }))
vi.mock('@/components/admin/companies/CompanyUserInviteForm', () => ({ default: () => 'SYNTHETIC_INVITE_CONTROL' }))
vi.mock('@/app/admin/company-settings/actions', () => ({
  updateCompanySettingsAction: fixture.profileAction,
  updateCompanyResponsibleUserAction: fixture.userAction,
}))

import CompanySettingsPage from '@/app/admin/company-settings/page'

async function renderPage() {
  return renderToStaticMarkup(await CompanySettingsPage())
}

beforeEach(() => {
  fixture.guard.permissions = ['users.write']
  fixture.guard.roles = ['company_admin']
  fixture.guard.companyId = 'company-A'
  fixture.guard.isPlatformAdmin = false
  fixture.profileState = { ok: false, message: '' }
  fixture.userState = { ok: false, message: '' }
  fixture.pending = false
  fixture.useActionState.mockReset().mockImplementation((action, initialState) => [
    action === fixture.profileAction ? fixture.profileState : action === fixture.userAction ? fixture.userState : initialState,
    vi.fn(),
    fixture.pending,
  ])
})

describe('company settings action feedback and permission UI', () => {
  it('mounts polite status regions before any action result arrives', async () => {
    const html = await renderPage()
    expect(html.match(/role="status"/g)).toHaveLength(2)
    expect(html.match(/aria-live="polite"/g)).toHaveLength(2)
  })

  it('renders both controlled action errors as accessible alerts and consumes the original actions', async () => {
    fixture.profileState = { ok: false, message: 'Kundnummerprefix kan inte ändras.' }
    fixture.userState = { ok: false, message: 'Den sista bolagsansvariga måste behållas.' }
    const html = await renderPage()
    expect(html).toContain(fixture.profileState.message)
    expect(html).toContain(fixture.userState.message)
    expect(html.match(/role="alert"/g)).toHaveLength(2)
    expect(fixture.useActionState).toHaveBeenCalledWith(fixture.profileAction, { ok: false, message: '' })
    expect(fixture.useActionState).toHaveBeenCalledWith(fixture.userAction, { ok: false, message: '' })
  })

  it('announces successful saves without presenting them as errors', async () => {
    fixture.profileState = { ok: true, message: 'Bolagsuppgifterna har sparats.' }
    fixture.userState = { ok: true, message: 'Användaren har uppdaterats.' }
    const html = await renderPage()
    expect(html).toContain(fixture.profileState.message)
    expect(html).toContain(fixture.userState.message)
    expect(html.match(/role="status"/g)).toHaveLength(2)
    expect(html).not.toContain('role="alert"')
  })

  it('keeps company and user data visible but removes write controls for users.read only', async () => {
    fixture.guard.permissions = ['users.read']
    // A company-scoped role name must not override the canonical platform flag.
    fixture.guard.roles = ['superadmin']
    const html = await renderPage()
    expect(html).toContain('Syntetiskt bolag')
    expect(html).toContain('user@example.invalid')
    expect(html).not.toContain('Spara bolagsuppgifter')
    expect(html).not.toContain('Uppdatera ansvarig')
    expect(html).not.toContain('SYNTHETIC_INVITE_CONTROL')
    expect(html.match(/<fieldset disabled=""/g)).toHaveLength(2)
    expect(html).toContain('läsbehörighet')
  })

  it('lets tenants.invite edit the profile without offering invitations or user role mutations', async () => {
    fixture.guard.permissions = ['tenants.invite']
    const html = await renderPage()
    expect(html).toContain('Spara bolagsuppgifter')
    expect(html).not.toContain('SYNTHETIC_INVITE_CONTROL')
    expect(html).not.toContain('Uppdatera ansvarig')
    expect(html.match(/<fieldset disabled=""/g)).toHaveLength(1)
  })

  it('lets users.write use both existing actions and keeps their tenant identifiers', async () => {
    const html = await renderPage()
    expect(html).toContain('Spara bolagsuppgifter')
    expect(html).toContain('Uppdatera ansvarig')
    expect(html).toContain('SYNTHETIC_INVITE_CONTROL')
    expect(html.match(/name="company_id" value="company-A"/g)).toHaveLength(2)
    expect(html).toContain('name="user_id" value="user-A"')
    expect(html).not.toContain('<fieldset disabled=""')
  })

  it('honors the authoritative platform-admin flag when tenant permissions are empty', async () => {
    fixture.guard.permissions = []
    fixture.guard.roles = []
    fixture.guard.isPlatformAdmin = true
    const html = await renderPage()
    expect(html).toContain('Spara bolagsuppgifter')
    expect(html).toContain('Uppdatera ansvarig')
    expect(html).toContain('SYNTHETIC_INVITE_CONTROL')
  })

  it('disables both forms and announces pending submissions', async () => {
    fixture.pending = true
    const html = await renderPage()
    expect(html.match(/aria-busy="true"/g)).toHaveLength(2)
    expect(html.match(/<fieldset disabled=""/g)).toHaveLength(2)
    expect(html.match(/Sparar ändringar/g)).toHaveLength(2)
  })

  it('does not mount any mutation form when the selected company is missing', async () => {
    fixture.guard.companyId = null
    const html = await renderPage()
    expect(html).toContain('Kontot saknar aktiv bolagskoppling')
    expect(html).not.toContain('Spara bolagsuppgifter')
    expect(html).not.toContain('Uppdatera ansvarig')
    expect(fixture.useActionState).not.toHaveBeenCalled()
  })
})
