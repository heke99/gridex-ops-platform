// FINDINGS F67: outbound e-mail, the grid-owner facility request and customer automation only became ready when a
// website API client was configured, so a supplier selling manually could never send the facility request with
// the power of attorney (manual outbox: capability_not_ready). Owner decision 2026-10-20: a go-live reconciliation
// applies the same checks without a website client.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const state = vi.hoisted(() => ({
  view: null as Row | null,
  checks: {} as Record<string, boolean>,
  upserts: [] as Row[][],
}))

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: (table: string) => {
      const self: Record<string, unknown> = {}
      Object.assign(self, {
        select: () => self, eq: () => self, in: () => self,
        maybeSingle: async () => ({ data: table === 'tenant_website_readiness_v' ? state.view : null, error: null }),
        upsert: async (rows: Row[]) => { state.upserts.push(rows); return { error: null } },
      })
      return self
    },
  },
}))
vi.mock('@/lib/website/customerApplicationAutomationReadiness', () => ({
  evaluateCustomerApplicationAutomationReadiness: vi.fn(async () => ({ ready: true, blockers: [], warnings: [], checks: state.checks })),
}))

import { reconcileTenantOperationalCapabilities } from '@/lib/integrations/tenantWebsiteReadiness'

const ready = {
  verified_customer_email_sender: true, required_email_templates_active: true, required_email_rules_active: true,
  automation_user_configured: true, automation_user_verified: true, cron_secret_configured: true, manual_operations_mailbox_ready: true,
}

beforeEach(() => {
  state.view = { company_id: 'company-a', has_verified_sender: true, has_mail_templates: true }
  state.checks = { ...ready }
  state.upserts = []
})

describe('go-live reconciliation of operational capabilities without a website client', () => {
  it('makes e-mail, facility request and automation ready for the tenant with the website checks', async () => {
    const result = await reconcileTenantOperationalCapabilities({ companyId: 'company-a', actorUserId: 'staff-1' })
    expect(result.map(({ code, ready: isReady }) => [code, isReady])).toEqual([
      ['email_outbound', true], ['customer_automation', true], ['facility_lookup', true], ['facility_lookup_enabled', true],
    ])
    expect(state.upserts[0]).toEqual(expect.arrayContaining([expect.objectContaining({
      company_id: 'company-a', capability_code: 'email_outbound', enabled: true, readiness_status: 'ready', last_verified_by: 'staff-1',
    })]))
    // Website-specific capabilities are never touched here.
    expect(state.upserts[0].map(row => row.capability_code)).not.toEqual(expect.arrayContaining(['api_sales']))
    expect(state.upserts[0].map(row => row.capability_code)).not.toEqual(expect.arrayContaining(['website_sales']))
  })

  it('blocks a capability whose check fails and names the failing check', async () => {
    state.checks = { ...ready, manual_operations_mailbox_ready: false }
    state.view = { company_id: 'company-a', has_verified_sender: false, has_mail_templates: true }
    const result = await reconcileTenantOperationalCapabilities({ companyId: 'company-a', actorUserId: 'staff-1' })
    expect(result.find(row => row.code === 'email_outbound')).toEqual({ code: 'email_outbound', ready: false, blockers: ['verified_sender_present'] })
    expect(result.find(row => row.code === 'facility_lookup')).toEqual({ code: 'facility_lookup', ready: false, blockers: ['facility_operations_mailbox_ready'] })
    expect(result.find(row => row.code === 'customer_automation')?.ready).toBe(true)
    expect(state.upserts[0]).toEqual(expect.arrayContaining([expect.objectContaining({ capability_code: 'facility_lookup', enabled: false, readiness_status: 'blocked' })]))
  })
})
