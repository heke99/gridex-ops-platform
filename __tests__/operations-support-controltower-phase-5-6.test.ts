import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('Operations Autopilot phase 5 — tenant support', () => {
  it('reuses canonical customer_cases with tenant scope and durable idempotency', () => {
    const source = read('lib/customer-cases/support.ts')
    expect(source).toContain("from('customer_cases')")
    expect(source).toContain(".eq('company_id', input.companyId)")
    expect(source).toContain(".eq('customer_id', input.customerId)")
    expect(source).toContain('support_idempotency_key')
    expect(source).toContain('createCustomerCase({')
    expect(source).not.toContain("from('support_cases')")
    expect(source).not.toContain("from('tenant_support_cases')")
  })

  it('binds optional site and metering-point references to the exact tenant/customer graph', () => {
    const source = read('lib/customer-cases/support.ts')
    expect(source).toContain('assertSupportGraph')
    expect(source).toContain(".from('customer_sites')")
    expect(source).toContain(".from('metering_points')")
    expect(source).toContain("support_site_not_found_in_customer_graph")
    expect(source).toContain("support_metering_point_not_found_in_customer_graph")
    expect(source).toContain("query = query.eq('customer_site_id', input.siteId)")
  })

  it('routes already-published customer event APIs into canonical support instead of exposing a parallel endpoint', () => {
    for (const path of ['app/api/v1/events/route.ts', 'app/api/v1/website/customer-events/route.ts']) {
      const source = read(path)
      expect(source).toContain('isSupportEvent')
      expect(source).toContain('createSupportCaseFromCustomerEvent')
      expect(source).not.toContain('support_out_of_scope')
    }
  })

  it('activates the existing admin support surface instead of the legacy out-of-scope blocker', () => {
    const actions = read('app/admin/customer-cases/actions.ts')
    const page = read('app/admin/customer-cases/page.tsx')
    expect(actions).toContain("requireAdminActionAccess(['cases.write'])")
    expect(actions).toContain('createTenantSupportCase')
    expect(actions).toContain('updateCustomerCaseStatus')
    expect(actions).not.toContain('supportOutOfScope')
    expect(page).toContain('Tenant-isolerade supportärenden')
    expect(page).not.toContain("redirect('/admin/operations/tasks')")
  })
})

describe('Operations Autopilot phase 6 — exception-only Control Tower', () => {
  it('hides normal active switch flow and projects only actionable statuses', () => {
    const source = read('app/admin/controltower/page.tsx')
    expect(source).toContain('exceptionTaskStatuses')
    expect(source).toContain('exceptionCaseStatuses')
    expect(source).toContain("safeCount('customer_cases'")
    expect(source).toContain('Öppna avvikelsesignaler')
    expect(source).toContain('Normal drift, godkända flöden och aktiva switchar utan problem räknas inte här.')
    expect(source).not.toContain('Aktiva switchar')
    expect(source).not.toContain('switchOpen')
  })

  it('filters recent tasks to exception statuses and integrates the canonical support inbox', () => {
    const source = read('app/admin/controltower/page.tsx')
    expect(source).toMatch(/safeRows<RecentCaseRow>\('customer_operation_tasks'[\s\S]*exceptionTaskStatuses/)
    expect(source).toMatch(/safeRows<CustomerCaseRow>\('customer_cases'[\s\S]*exceptionCaseStatuses/)
    expect(source).toContain('href="/admin/customer-cases"')
    expect(source).toContain('Kund/supportärenden')
  })
})
