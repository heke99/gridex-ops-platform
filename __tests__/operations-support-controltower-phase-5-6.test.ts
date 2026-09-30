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
    expect(source).toContain('executeSupportCommand')
    expect(source).toContain("new SupportCommandError('support_actor_forbidden', 403)")
    const sql = read('supabase/migrations/20260930160000_support_case_atomic_commands.sql')
    expect(sql).toContain("command_type='customer.support.command.v1'")
    expect(sql).toContain('support_idempotency_conflict')
    expect(sql).toContain("insert into public.customer_cases(")
    expect(sql).toContain('insert into public.canonical_command_results')
    expect(source).not.toContain("from('support_cases')")
    expect(source).not.toContain("from('tenant_support_cases')")
  })

  it('binds optional site and metering-point references to the exact tenant/customer graph', () => {
    const source = read('supabase/migrations/20260930160000_support_case_atomic_commands.sql')
    expect(source).toContain('s.id=v_site and s.company_id=v_company and s.customer_id=v_customer for share')
    expect(source).toContain('m.id=v_point and m.company_id=v_company and m.customer_id=v_customer')
    expect(source).toContain('m.customer_site_id=v_site')
    expect(source.indexOf('s.id=v_site')).toBeLessThan(source.indexOf('insert into public.customer_cases('))
    expect(source).toContain("raise exception 'support_resource_unavailable'")
  })

  it('denies machine support events before effects and routes customer commands through separate verified authority', () => {
    for (const path of ['app/api/v1/events/route.ts', 'app/api/v1/website/customer-events/route.ts']) {
      const source = read(path)
      expect(source).toContain('isSupportEvent')
      expect(source).toContain('support_event_delegation_required')
      expect(source.indexOf('if (isSupportEvent(')).toBeLessThan(source.indexOf('await recordWebsiteCustomerEvent('))
      expect(source).not.toContain('await createSupportCaseFromCustomerEvent(')
      expect(source).not.toContain('support_out_of_scope')
    }
    const route = read('app/api/v1/customer/cases/route.ts')
    expect(route).toContain("requireCustomerPortalApiContext(request, ['customer_cases.write'])")
    expect(route).toContain('executeSupportCommand')
  })

  it('activates the existing admin support surface instead of the legacy out-of-scope blocker', () => {
    const actions = read('app/admin/customer-cases/actions.ts')
    const page = read('app/admin/customer-cases/page.tsx')
    expect(actions).toContain("requireAdminActionAccess(['cases.write'])")
    expect(actions).toContain('createTenantSupportCase')
    expect(actions).toContain("operation: 'status'")
    expect(actions).toContain("currentSupportSession('ops', admin.userId)")
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
    expect(source).toContain('Kundärenden (alla källor)')
    expect(source).toContain('Öppna Ediel-ärenden')
  })
})
