// local/051: actual page orchestration and email section; IO mocked, not DB/browser acceptance.
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const ports = vi.hoisted(() => ({ sender: vi.fn(), settings: vi.fn(), guard: vi.fn() }))
vi.mock('@/lib/admin/guards', () => ({ requirePlatformAdminAccess: ports.guard }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from() {
  const q = { select: () => q, eq: () => q, in: () => q, gte: () => q, order: () => q, range: () => q,
    maybeSingle: async () => ({ data: null, error: null }), then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(resolve) }
  return q
} } }))
vi.mock('@/lib/tenant/governance', () => ({
  getCompanyById: async () => ({ id: 'synthetic-company', name: 'Synthetic company' }),
  getCompanyGovernanceSummary: async () => ({ id: 'synthetic-company', name: 'Synthetic company', status: 'onboarding', deleteBlockers: [] }),
  getCompanyStatusCopy: () => ({ description: 'Onboarding' }), normalizeCompanyStatus: () => 'onboarding',
}))
vi.mock('@/lib/analytics/customerPortfolio', () => ({ getPortfolioMonthForCompany: async () => ({}) }))
vi.mock('@/lib/ediel/actorTesting', () => ({ getActorTestingSummary: async () => null }))
vi.mock('@/lib/billing/providers/registry', () => ({ loadTenantInvoiceProviderSelection: async () => null }))
vi.mock('@/lib/ediel/companyActorConfiguration', () => ({ getCompanyActorConfiguration: async () => ({ actors: [], brpSettings: [], routes: [], mailboxes: [], certificates: [] }) }))
vi.mock('@/lib/email/companyEmailSettings', () => ({ getCompanyEmailSettings: ports.settings, getEffectiveSender: ports.sender }))
vi.mock('@/lib/email/dnsRecords', () => ({ getCompanyDnsRecords: async () => [] }))
vi.mock('@/lib/email/emailEvents', () => ({ getEmailEventRules: async () => [] }))
vi.mock('@/lib/email/emailTemplates', () => ({ getCompanyEmailTemplates: async () => [], DEFAULT_EMAIL_TEMPLATES: [], EMAIL_TEMPLATE_VARIABLES: [] }))
vi.mock('@/lib/email/communicationLogs', () => ({ getCompanyCommunicationLogs: async () => [] }))
vi.mock('@/lib/admin/websiteIntegrationOps', async original => ({ ...await original<typeof import('@/lib/admin/websiteIntegrationOps')>(), listWebhookSubscriptions: async () => [] }))
vi.mock('@/lib/opsMaster/readiness', () => ({ getTenantWebsiteReadiness: async () => null, listCompanyLegalTextVersions: async () => [] }))
vi.mock('@/lib/tenant/legalDefaults', () => ({ getTenantLegalDefaultStatus: async () => null }))
vi.mock('@/lib/contracts/canonical', () => ({ getCanonicalTenantContractReadiness: async () => null, getTenantLegalProfile: async () => null }))
vi.mock('@/app/admin/companies/[id]/TenantPlatformControls', () => ({ default: () => null }))
vi.mock('@/app/admin/companies/[id]/ediel-actions', () => ({ saveCompanyBrpAction: vi.fn(), saveCompanyEdielActorAction: vi.fn() }))
vi.mock('@/app/admin/companies/[id]/company-profile-actions', () => ({ reviewCompanyLegalProfileAction: vi.fn(), saveCompanyProfileAction: vi.fn() }))
vi.mock('@/app/admin/companies/[id]/email-actions', () => ({ checkCompanyDomainVerificationAction: vi.fn(), resetEmailTemplateAction: vi.fn(), saveCompanyEmailSettingsAction: vi.fn(), seedDefaultCompanyEmailAction: vi.fn(), sendCompanyTestEmailAction: vi.fn(), startCompanyDomainVerificationAction: vi.fn(), updateEmailEventRuleAction: vi.fn(), updateEmailTemplateAction: vi.fn() }))
vi.mock('@/app/admin/companies/[id]/legal-actions', () => ({ archiveLegalTextVersionAction: vi.fn(), createLegalTextVersionAction: vi.fn(), publishLegalTextVersionAction: vi.fn(), seedDefaultLegalPackageAction: vi.fn() }))
import Page from '@/app/admin/companies/[id]/page'
function findEmail(node: React.ReactNode): React.ReactElement | undefined {
  if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return
  if (typeof node.type === 'function' && node.type.name === 'CompanyEmailSection') return node
  for (const child of React.Children.toArray(node.props.children)) { const result = findEmail(child); if (result) return result }
}
const load = () => Page({ params: Promise.resolve({ id: 'synthetic-company' }) })
beforeEach(() => {
  vi.stubGlobal('React', React)
  ports.guard.mockReset().mockResolvedValue({ email: 'actor@example.invalid' })
  ports.settings.mockReset().mockResolvedValue({ sender_mode: 'fallback_platform_sender', fallback_allowed: false, is_active: true })
  ports.sender.mockReset().mockRejectedValue(new Error('Fallback-avsändare är avstängd för bolaget. Verifiera domänen innan utskick.'))
})
describe('company detail reads disabled sender configuration without dispatching', () => {
  it.each([
    { sender_mode: 'fallback_platform_sender', fallback_allowed: false, is_active: true },
    { sender_mode: 'disabled', is_active: true },
    { sender_mode: 'verified_domain', is_active: false },
  ])('renders non-ready configuration and keeps sender resolution blocked: %j', async settings => {
    ports.settings.mockResolvedValue(settings)
    const tree = await load()
    const email = findEmail(tree)
    expect(email).toBeDefined()
    const html = renderToStaticMarkup(email!)
    expect(html).toContain('Avsändaren är inte konfigurerad för utskick')
    expect(html).not.toContain('Testmail skickas via plattformens fallback')
    expect(html).not.toContain('Aktiv avsändare:')
    expect(html).toContain('Avsändarnamn')
    expect(ports.sender).not.toHaveBeenCalled()
  })
  it('preserves enabled verified sender display', async () => {
    ports.settings.mockResolvedValue({ sender_mode: 'verified_domain', is_active: true, verification_status: 'verified' })
    ports.sender.mockResolvedValue({ from: 'Synthetic <sender@example.invalid>', senderEmail: 'sender@example.invalid', mode: 'verified_domain', sendReady: true })
    const html = renderToStaticMarkup(findEmail(await load())!)
    expect(html).toContain('sender@example.invalid')
    expect(html).toContain('Aktiv avsändare:')
    expect(ports.sender).toHaveBeenCalledWith('synthetic-company')
  })
  it('does not hide unexpected sender resolution failure', async () => {
    ports.settings.mockResolvedValue(null)
    const failure = new Error('synthetic unexpected database failure')
    ports.sender.mockRejectedValue(failure)
    await expect(load()).rejects.toBe(failure)
  })
  it('does not hide email settings read failure', async () => {
    const failure = new Error('synthetic settings permission failure')
    ports.settings.mockRejectedValue(failure)
    await expect(load()).rejects.toBe(failure)
  })
  it('preserves platform authorization before reads', async () => {
    const failure = new Error('synthetic forbidden')
    ports.guard.mockRejectedValue(failure)
    await expect(load()).rejects.toBe(failure)
    expect(ports.settings).not.toHaveBeenCalled()
  })
})
