import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  context: { userId: 'actor-a', email: 'synthetic@example.invalid', isPlatformAdmin: false, permissions: ['users.write'] },
  productionApproved: false,
  updateCompany: vi.fn(), updateUser: vi.fn(),
}))
vi.mock('@/lib/admin/guards', () => ({ requireAdminPageKeyAccess: async () => mocks.context }))
vi.mock('@/lib/tenant/scope', () => ({ getOperationalCompanyScope: async () => ({ companyId: 'company-a' }) }))
vi.mock('@/lib/tenant/governance', () => ({
  getCompanyById: async () => ({ id: 'company-a', name: 'Synthetic company', operating_environment: 'test', branding: {}, production_status: 'live', live_ediel_enabled: true, live_approved_at: '2026-09-30T00:00:00Z' }),
  listCompanyUsersForGovernance: async () => [{ membershipId: 'member-a', userId: 'user-a', email: 'stale-profile@example.invalid', authEmail: 'user-a@example.invalid', fullName: 'Synthetic user', membershipRole: 'support', roleKey: 'customer_service_agent' }],
}))
vi.mock('@/lib/tenant/companyProductionStatus', () => ({ getCompanyProductionStatus: async () => ({ productionApproved: mocks.productionApproved }) }))
vi.mock('@/lib/contracts/canonical', () => ({ getTenantLegalProfile: async () => null }))
vi.mock('@/lib/tenant/companyLegalProfile', () => ({ legalProfileMissingFieldDetail: vi.fn() }))
vi.mock('@/app/admin/company-settings/actions', () => ({ updateCompanySettingsAction: mocks.updateCompany, updateCompanyResponsibleUserAction: mocks.updateUser }))
vi.mock('@/components/admin/companies/CompanyUserInviteForm', () => ({ default: () => null }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: () => null }))
import { renderToStaticMarkup } from 'react-dom/server'
import CompanySettingsForm from '@/components/admin/companies/CompanySettingsForms'
import CompanySettingsPage from '@/app/admin/company-settings/page'

function nodes(value: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(value)) return value.flatMap(nodes)
  if (!isValidElement(value)) return []
  const node = value as ReactElement<Record<string, unknown>>
  return [node, ...nodes(node.props.children as ReactNode)]
}

describe('company settings keeps authoritative form outcomes and choices', () => {
  beforeEach(() => { mocks.context.permissions = ['users.write']; mocks.productionApproved = false; vi.clearAllMocks() })
  it('passes the returned validation failure to the profile form instead of discarding it', async () => {
    const failure = { ok: false, message: 'Bolagsnamn krävs.' }
    mocks.updateCompany.mockResolvedValueOnce(failure)
    const form = nodes(await CompanySettingsPage()).find((node) => node.props.id === 'company-profile')!
    const action = form.props.action as (previous: unknown, data: FormData) => Promise<unknown>
    expect(await action({ ok: false, message: '' }, new FormData())).toEqual(failure)
  })
  it('passes a denied user update back to its bound user form', async () => {
    const failure = { ok: false, message: 'Användaren är inte kopplad till bolaget.' }
    mocks.updateUser.mockResolvedValueOnce(failure)
    const tree = nodes(await CompanySettingsPage())
    const binding = tree.find((node) => node.props.name === 'user_id')!
    const form = tree.find((node) => node.props.action && nodes(node.props.children as ReactNode).includes(binding))!
    const action = form.props.action as (previous: unknown, data: FormData) => Promise<unknown>
    expect(await action({ ok: false, message: '' }, new FormData())).toEqual(failure)
  })
  it('uses actual server approval to disable production choices when legacy display flags disagree', async () => {
    mocks.productionApproved = false
    const selector = nodes(await CompanySettingsPage()).find((node) => node.type === 'select' && nodes(node.props.children as ReactNode).some((option) => option.props.value === 'production'))!
    expect(selector.props.disabled).toBe(true)
    expect(selector.props.name).toBe('operating_environment')
  })
  it('submits the chosen environment in the enabled control after server approval', async () => {
    mocks.productionApproved = true
    const tree = nodes(await CompanySettingsPage())
    const selector = tree.find((node) => node.type === 'select' && nodes(node.props.children as ReactNode).some((option) => option.props.value === 'production'))!
    expect(selector.props.disabled).toBe(false)
    expect(selector.props.name).toBe('operating_environment')
    expect(tree.filter((node) => node.type === 'input' && node.props.name === 'operating_environment')).toHaveLength(0)
    mocks.productionApproved = false
  })
  it('renders readable fields and an explicit denied state without enabling mutation or invitations', async () => {
    mocks.context.permissions = ['masterdata.read']
    const tree = nodes(await CompanySettingsPage())
    const forms = tree.filter((node) => node.props.action)
    expect(forms).toHaveLength(2)
    expect(forms.every((form) => form.props.disabled === true)).toBe(true)
    const markup = renderToStaticMarkup(createElement(CompanySettingsForm, { action: mocks.updateCompany, disabled: true }, createElement('input', { name: 'name', defaultValue: 'Synthetic company' })))
    expect(markup).toContain('<fieldset disabled=""')
    expect(markup).toContain('Läsläge')
  })
  it('shows shared identity details read-only and submits only the existing identity email for tenant role changes', async () => {
    const tree = nodes(await CompanySettingsPage())
    const binding = tree.find((node) => node.props.name === 'user_id')!
    const form = tree.find((node) => node.props.action && nodes(node.props.children as ReactNode).includes(binding))!
    const inputs = nodes(form.props.children as ReactNode).filter((node) => node.type === 'input')
    expect(inputs.filter((node) => ['full_name', 'phone'].includes(String(node.props.name)))).toHaveLength(0)
    const email = inputs.find((node) => node.props.name === 'email')!
    expect(email.props.readOnly).toBe(true)
    expect(inputs.filter((node) => node.props.readOnly === true)).toHaveLength(3)
  })
  it('posts verified Auth email when the global profile email is stale', async () => {
    const tree = nodes(await CompanySettingsPage())
    const binding = tree.find((node) => node.props.name === 'user_id')!
    const form = tree.find((node) => node.props.action && nodes(node.props.children as ReactNode).includes(binding))!
    const email = nodes(form.props.children as ReactNode).find((node) => node.type === 'input' && node.props.name === 'email')!
    expect(email.props.defaultValue).toBe('user-a@example.invalid')
    expect(email.props.readOnly).toBe(true)
  })
  it('does not offer a second editable membership choice ignored by the canonical role action', async () => {
    const tree = nodes(await CompanySettingsPage())
    expect(tree.filter((node) => node.type === 'select' && node.props.name === 'membership_role')).toHaveLength(0)
    expect(tree.filter((node) => node.type === 'select' && node.props.name === 'role_key')).toHaveLength(1)
  })
})
