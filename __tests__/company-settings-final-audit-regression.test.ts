import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ profile: null as null | Record<string, unknown> }))
vi.mock('@/lib/admin/guards', () => ({ requireAdminPageKeyAccess: async () => ({ permissions: ['users.read'], email: 'operator@example.test' }) }))
vi.mock('@/lib/tenant/adminScope', () => ({ resolveAdminSelectedCompanyReadScope: async () => ({ companyId: 'company-a', isPlatformAdmin: false }) }))
vi.mock('@/lib/tenant/governance', () => ({ getCompanyById: async () => ({ id: 'company-a', name: 'Syntetiskt bolag', branding: null }), listCompanyUsersForGovernance: async () => [] }))
vi.mock('@/lib/contracts/canonical', () => ({ getTenantLegalProfile: async () => io.profile }))
vi.mock('@/app/admin/company-settings/actions', () => ({ updateCompanySettingsAction: vi.fn(), updateCompanyResponsibleUserAction: vi.fn() }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: () => null }))
vi.mock('@/components/admin/companies/CompanyUserInviteForm', () => ({ default: () => null }))
vi.mock('@/components/admin/companies/CompanySettingsActionForm', () => ({ default: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children) }))
import Page from '@/app/admin/company-settings/page'
beforeEach(() => { vi.stubGlobal('React', React); io.profile = null })
const html = async () => renderToStaticMarkup(await Page())
it('shows a missing legal profile as unknown rather than complete or reviewed', async () => {
  const rendered = await html()
  expect(rendered).toContain('Juridikprofil saknas')
  expect(rendered).toContain('Underlag saknas')
  expect(rendered).not.toContain('Juridikprofilen är komplett')
  expect(rendered).not.toContain('Juridikprofilen är granskad och verifierad')
})
it.each([
  [{ missing_fields: ['email'], completeness_status: 'incomplete' }, 'Juridikprofilen behöver kompletteras'],
  [{ missing_fields: [], completeness_status: 'complete', review_required: true }, 'Juridikprofilen är komplett men väntar granskning'],
  [{ missing_fields: [], completeness_status: 'complete', review_required: false, reviewed_at: '2026-11-01T00:00:00Z' }, 'Juridikprofilen är granskad och verifierad'],
])('preserves existing profile states: %j', async (profile, label) => {
  io.profile = profile
  expect(await html()).toContain(label)
})
