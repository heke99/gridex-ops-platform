import { beforeEach, describe, expect, it, vi } from 'vitest'
import { verifySupplyDeadlineRuntimeRepair } from '../scripts/supply-deadline-runtime-repair-regression.mjs'
import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'
import {
  CUSTOMER_PORTAL_REQUIRED_SCOPES, TENANT_WEBSITE_RECOMMENDED_SCOPES, WEBSITE_CHECKOUT_REQUIRED_SCOPES,
} from '@/lib/integrations/websiteIntegrationContract'

const port = vi.hoisted(() => ({
  runtime: true as boolean | undefined,
  ready: true,
  companies: [] as Array<[string, unknown]>,
}))

// The real readiness evaluator consumes declared database/Auth operation ports.
// No production resources or market process is used by this fixture.
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from(table: string) {
    const query = {
      select() { return query },
      eq(key: string, value: unknown) { port.companies.push([key, value]); return query },
      async maybeSingle() {
        if (table === 'companies') return { data: { id: 'tenant-a', status: 'active', external_tenant_reference: 'org-a', customer_portal_url: 'https://portal.example.test', metadata: {} }, error: null }
        if (table === 'tenant_website_readiness_v') return { data: Object.fromEntries(['has_public_contracts', 'has_terms', 'has_privacy_policy', 'has_withdrawal', 'has_power_of_attorney_text', 'has_price_terms', 'has_verified_sender', 'has_mail_templates'].map(key => [key, true])), error: null }
        throw Error(`Unexpected table ${table}`)
      },
      then(done: (value: unknown) => unknown) { return Promise.resolve({ count: 1, error: null }).then(done) },
    }
    return query
  },
} }))
vi.mock('@/lib/website/customerApplicationAutomationReadiness', () => ({
  evaluateCustomerApplicationAutomationReadiness: async () => ({
    ready: port.ready, blockers: port.ready ? [] : ['Declared unavailable automation prerequisite'], warnings: [],
    checks: { automation_user_configured: true, automation_user_verified: true, cron_secret_configured: true,
      runtime_contract_ready: port.runtime, verified_customer_email_sender: true, required_email_templates_active: true,
      required_email_rules_active: true, manual_operations_mailbox_ready: true },
  }),
}))
vi.mock('@/lib/tenant/operationPolicy', () => ({
  getTenantOperationDecision: async () => ({ allowed: true, reason_code: 'allowed', company_status: 'active', capability_status: 'enabled', production_status: 'active', state_version: 1 }),
}))

import { loadTenantWebsiteFlowReadiness } from '@/lib/integrations/tenantWebsiteReadiness'

const client = {
  id: 'client-a', company_id: 'tenant-a', status: 'active', allowed_origins: ['https://www.example.test'],
  scopes: [...new Set([...WEBSITE_CHECKOUT_REQUIRED_SCOPES, ...CUSTOMER_PORTAL_REQUIRED_SCOPES, ...TENANT_WEBSITE_RECOMMENDED_SCOPES])],
} as unknown as IntegrationApiClient
const run = () => loadTenantWebsiteFlowReadiness({ companyId: 'tenant-a', client })

describe('checkout honors qualified automation runtime readiness', () => {
  beforeEach(() => { port.runtime = true; port.ready = true; port.companies = [] })

  it('keeps a fully qualified checkout and customer portal available', async () => {
    const result = await run()
    expect(result.website_checkout_ready).toBe(true)
    expect(result.customer_portal_ready).toBe(true)
    expect(result.ready).toBe(true)
    expect(port.companies).toContainEqual(['company_id', 'tenant-a'])
  })

  it('refuses checkout when the runtime contract reports missing database prerequisites', async () => {
    port.runtime = false
    const result = await run()
    expect(result.website_checkout_ready).toBe(false)
    expect(result.complete_tenant_website_ready).toBe(false)
    expect(result.blockers).toContainEqual(expect.objectContaining({ code: 'automation_runtime_not_ready', component: 'database' }))
    expect(result.customer_portal_ready).toBe(true)
  })

  it('fails closed when an older runtime response omits its qualification flag', async () => {
    port.runtime = undefined
    expect((await run()).website_checkout_ready).toBe(false)
  })

  it('honors the complete automation decision even when individual legacy checks pass', async () => {
    port.ready = false
    const result = await run()
    expect(result.website_checkout_ready).toBe(false)
    expect(result.ready).toBe(false)
    expect(result.blockers).toContainEqual(expect.objectContaining({ code: 'automation_not_ready', component: 'automation' }))
  })

  it('executes the forward repair against PostgreSQL semantics and its security/rollback regressions', async () => {
    expect(await verifySupplyDeadlineRuntimeRepair()).toMatchObject({ status: 'PASS_MECHANICAL_SQL', checks: 63, production_writes: 0 })
  }, 60_000)
})
