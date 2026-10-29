import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { COMPANY_USER_ROLE_OPTIONS } from '@/lib/tenant/companyUserRoles'

const fixture = vi.hoisted(() => ({
  guard: vi.fn(),
  getCompany: vi.fn(),
  actions: { invite: vi.fn(), remove: vi.fn(), role: vi.fn(), reactivate: vi.fn() },
  users: [
    { membershipId: 'membership-A', userId: 'user-A', fullName: 'Syntetiskt namn', email: 'alpha@example.invalid', invitedEmail: null, membershipRole: 'admin', roleKey: 'company_admin', status: 'active', authStatus: 'auth_ok' },
    { membershipId: 'membership-B', userId: 'user-B', fullName: 'Syntetiskt namn', email: 'beta@example.invalid', invitedEmail: null, membershipRole: 'viewer', roleKey: 'finance_readonly', status: 'active', authStatus: 'auth_ok' },
    { membershipId: 'membership-C', userId: 'user-C', fullName: '', email: null, invitedEmail: 'invite@example.invalid', membershipRole: 'viewer', roleKey: 'executive_readonly', status: 'invited', authStatus: 'missing_auth_user' },
    { membershipId: 'membership-D', userId: 'user-D', fullName: '', email: null, invitedEmail: null, membershipRole: 'viewer', roleKey: 'executive_readonly', status: 'active', authStatus: 'auth_ok' },
  ],
}))

vi.mock('@/lib/admin/guards', () => ({ requirePlatformAdminAccess: fixture.guard }))
vi.mock('@/lib/tenant/governance', () => ({
  getCompanyById: fixture.getCompany,
  listCompanyUsersForGovernance: async () => fixture.users,
  normalizeCompanyStatus: () => 'active',
  getCompanyStatusCopy: () => ({ label: 'Aktivt', tone: '' }),
}))
vi.mock('@/lib/auth/externalStaffEnrollmentAdmin', () => ({ externalStaffEnrollmentAdmin: { listClients: async () => [] } }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: () => null }))
vi.mock('@/components/admin/companies/ExternalStaffEnrollmentForm', () => ({ default: () => null }))
vi.mock('@/app/admin/companies/actions', () => ({
  inviteCompanyUserAction: fixture.actions.invite,
  removeUserFromCompanyAction: fixture.actions.remove,
  setCompanyUserRoleAction: fixture.actions.role,
  reactivateCompanyUserAction: fixture.actions.reactivate,
}))

import CompanyUsersPage from '@/app/admin/companies/[id]/users/page'
import CompanyUserInviteForm from '@/components/admin/companies/CompanyUserInviteForm'

function renderInvite(compact = false) {
  return renderToStaticMarkup(createElement(CompanyUserInviteForm, { companyId: 'synthetic-company', compact }))
}

async function renderUsers() {
  return renderToStaticMarkup(await CompanyUsersPage({ params: Promise.resolve({ id: 'synthetic-company' }) }))
}

beforeEach(() => {
  fixture.guard.mockReset().mockResolvedValue({ email: 'admin@example.invalid' })
  fixture.getCompany.mockReset().mockResolvedValue({ id: 'synthetic-company', name: 'Syntetiskt bolag', status: 'active' })
  Object.values(fixture.actions).forEach(action => action.mockClear())
})

describe('company invitation and user role control labels', () => {
  it.each([false, true])('names the shared invitation controls in compact=%s mode', (compact) => {
    const html = renderInvite(compact)
    expect(html).toContain('aria-label="E-post för inbjudan"')
    expect(html).toContain('aria-label="Namn för inbjudan"')
    expect(html).toContain('aria-label="Systemroll för inbjudan"')
    expect(html).toContain('name="company_id" value="synthetic-company"')
    expect(fixture.actions.invite).not.toHaveBeenCalled()
  })

  it('names both distinct roles and contact fields in the platform invitation form', async () => {
    const html = await renderUsers()
    expect(html).toContain('aria-label="E-post för inbjudan"')
    expect(html).toContain('aria-label="Namn för inbjudan"')
    expect(html).toContain('aria-label="Bolagsroll för inbjudan"')
    expect(html).toContain('aria-label="Systemroll för inbjudan"')
  })

  it('distinguishes per-user role controls even when two users share a display name', async () => {
    const html = await renderUsers()
    for (const email of ['alpha@example.invalid', 'beta@example.invalid']) {
      expect(html).toContain(`aria-label="Bolagsroll för ${email}"`)
      expect(html).toContain(`aria-label="Systemroll för ${email}"`)
    }
  })

  it('uses invited email or the stable user identifier when normal contact fields are absent', async () => {
    const html = await renderUsers()
    for (const identity of ['invite@example.invalid', 'user-D']) {
      expect(html).toContain(`aria-label="Bolagsroll för ${identity}"`)
      expect(html).toContain(`aria-label="Systemroll för ${identity}"`)
    }
  })

  it('retains the canonical shared role choices and the existing selected role', () => {
    const html = renderInvite()
    expect([...html.matchAll(/<option value="([^"]+)"/g)].map(match => match[1])).toEqual(COMPANY_USER_ROLE_OPTIONS.map(option => option.value))
    expect(html).toContain('<option value="company_admin" selected=""')
  })

  it('retains the platform guard and never invokes mutations while rendering user forms', async () => {
    await renderUsers()
    expect(fixture.guard).toHaveBeenCalledOnce()
    expect(fixture.getCompany).toHaveBeenCalledWith('synthetic-company')
    for (const action of Object.values(fixture.actions)) expect(action).not.toHaveBeenCalled()
    const refusal = new Error('Syntetiskt behörighetsavslag')
    fixture.guard.mockRejectedValueOnce(refusal)
    fixture.getCompany.mockClear()
    await expect(renderUsers()).rejects.toBe(refusal)
    expect(fixture.getCompany).not.toHaveBeenCalled()
  })
})
