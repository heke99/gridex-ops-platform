import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('business action tenant graph hardening', () => {
  it('binds metering point and supplier-switch requests to the same tenant/customer graph', () => {
    const preflight = source('lib/operations/businessActions/actionPreflight.ts')

    expect(preflight).toContain(".from('metering_points')")
    expect(preflight).toContain(".eq('company_id', companyId)")
    expect(preflight).toContain(".eq('customer_id', input.customerId)")
    expect(preflight).toContain("meteringQuery.eq('site_id', site.id)")

    expect(preflight).toContain(".from('supplier_switch_requests')")
    expect(preflight).toContain(".eq('id', input.switchRequestId)")
    expect(preflight).toContain("code: 'switch_request_scope_mismatch'")
    expect(preflight).toContain("code: 'switch_request_site_mismatch'")
    expect(preflight).toContain("code: 'switch_request_metering_point_mismatch'")
  })

  it('does not dispatch a supplier switch when the scoped switch request is missing or mismatched', () => {
    const start = source('lib/operations/businessActions/startSupplierSwitch.ts')

    expect(start).toContain(".eq('company_id', preflight.companyId)")
    expect(start).toContain(".eq('customer_id', input.customerId)")
    expect(start).toContain("if (!switchRow)")
    expect(start).toContain("if (preflight.siteId && row.site_id && row.site_id !== preflight.siteId)")
    expect(start).toContain("if (preflight.meteringPointId && row.metering_point_id && row.metering_point_id !== preflight.meteringPointId)")

    const switchLookup = start.indexOf(".from('supplier_switch_requests')")
    const dispatch = start.indexOf('prepareAndQueueEdielZ03({')
    expect(switchLookup).toBeGreaterThanOrEqual(0)
    expect(dispatch).toBeGreaterThan(switchLookup)
  })

  it('uses canonical outbound source linkage instead of a nonexistent supplier-switch column', () => {
    const resolver = source('lib/routes/dynamicReceiverResolver.ts')

    expect(resolver).not.toContain('supplier_switch_request_id')
    expect(resolver).toContain('source_type,source_id')
    expect(resolver).toContain('row?.source_type === "supplier_switch_request"')
    expect(resolver).toContain('row?.source_type === "grid_owner_data_request"')
  })

  it('fails closed when the server-verified auth lookup returns an error or no user', () => {
    const auth = source('lib/auth/currentUser.ts')
    expect(auth).toContain('error,')
    expect(auth).toContain('if (error || !user) return null')

    const dashboard = source('app/dashboard/layout.tsx')
    expect(dashboard).toContain("import { redirect } from 'next/navigation'")
    expect(dashboard).toContain("if (!user) redirect('/login')")
  })
})
