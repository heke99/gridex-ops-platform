// FINDINGS F27 (slug part): a tenant without a public slug passed the website
// launch gate although every legal document URL (/legal/<slug>/...) was null.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const company = vi.hoisted(() => ({ row: {} as Record<string, unknown> }))
vi.mock('@/lib/supabase/service', () => {
  const rows: Record<string, () => unknown> = {
    companies: () => company.row,
    tenant_website_readiness_v: () => ({ company_id: company.row?.id, has_api_client: true, has_allowed_origin: true, has_public_contracts: true, has_terms: true,
      has_privacy_policy: true, has_withdrawal: true, has_power_of_attorney_text: true, has_price_terms: true, has_verified_sender: true, has_mail_templates: true }),
  }
  const query = (table: string) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: rows[table]?.() ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown) => resolve({ count: 1, error: null }),
    }
    return chain
  }
  return { supabaseService: { from: query } }
})
vi.mock('@/lib/website/customerApplicationAutomationReadiness', () => ({
  evaluateCustomerApplicationAutomationReadiness: async () => ({ checks: { verified_customer_email_sender: true, required_email_templates_active: true, required_email_rules_active: true,
    automation_user_configured: true, automation_user_verified: true, cron_secret_configured: true, manual_operations_mailbox_ready: true, runtime_contract_ready: true }, ready: true, blockers: [], warnings: [] }),
}))
vi.mock('@/lib/tenant/operationPolicy', () => ({
  getTenantOperationDecision: async () => ({ allowed: true, reason_code: 'allowed', company_status: 'active', capability_status: 'active', production_status: 'active', state_version: 1 }),
}))

import { loadTenantWebsiteFlowReadiness } from '@/lib/integrations/tenantWebsiteReadiness'
import { CUSTOMER_PORTAL_REQUIRED_SCOPES, TENANT_WEBSITE_RECOMMENDED_SCOPES, WEBSITE_CHECKOUT_REQUIRED_SCOPES } from '@/lib/integrations/websiteIntegrationContract'

const COMPANY = '00000000-0000-4000-8000-000000000001'
const client = { id: '00000000-0000-4000-8000-000000000002', status: 'active', allowed_origins: ['https://elhandel.example.invalid'],
  scopes: [...new Set([...WEBSITE_CHECKOUT_REQUIRED_SCOPES, ...CUSTOMER_PORTAL_REQUIRED_SCOPES, ...TENANT_WEBSITE_RECOMMENDED_SCOPES])] } as never
const tenant = (slugs: { slug?: string | null; company_slug?: string | null }) => ({ id: COMPANY, status: 'active', external_tenant_reference: 'e2e-tenant',
  customer_portal_url: 'https://elhandel.example.invalid/mina-sidor', website: 'https://elhandel.example.invalid', branding: {}, metadata: {}, ...slugs })
const readiness = () => loadTenantWebsiteFlowReadiness({ companyId: COMPANY, client })
const slugBlocker = (blockers: Array<{ code: string }>) => blockers.find(b => b.code === 'legal_public_slug_missing')

describe('website launch gate: public legal slug', () => {
  beforeEach(() => { company.row = {} })

  it('a tenant with a slug is launch ready', async () => {
    company.row = tenant({ slug: 'e2e-elhandel', company_slug: null })
    const result = await readiness()
    expect(result.blockers).toEqual([])
    expect(result.checks.public_legal_slug_present).toBe(true)
    expect(result.complete_tenant_website_ready).toBe(true)
  })

  it('company_slug counts when slug is null, as in the legal bundle', async () => {
    company.row = tenant({ slug: null, company_slug: 'e2e-elhandel' })
    expect(slugBlocker((await readiness()).blockers)).toBeUndefined()
  })

  it.each([
    ['both missing', { slug: null, company_slug: null }],
    ['empty slug shadows company_slug (slug ?? company_slug)', { slug: '', company_slug: 'e2e-elhandel' }],
    ['whitespace only', { slug: '   ', company_slug: null }],
  ])('blocks launch when the slug is unusable: %s', async (_case, slugs) => {
    company.row = tenant(slugs)
    const result = await readiness()
    expect(slugBlocker(result.blockers)).toMatchObject({ component: 'legal' })
    expect(result.blockers.map(b => b.code)).toEqual(['legal_public_slug_missing'])
    expect(result.complete_tenant_website_ready).toBe(false)
    expect(result.website_checkout_ready).toBe(false)
  })

  it('a missing tenant reports only tenant_not_found, not a slug blocker', async () => {
    company.row = null as never
    const result = await readiness()
    expect(result.blockers.map(b => b.code)).toContain('tenant_not_found')
    expect(slugBlocker(result.blockers)).toBeUndefined()
  })
})
