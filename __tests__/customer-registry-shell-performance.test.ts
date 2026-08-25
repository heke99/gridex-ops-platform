import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(__dirname, '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

describe('customer registry shell performance invariants', () => {
  it('starts search params and tenant scope reads together after the canonical guard', () => {
    const page = read('app/admin/customers/page.part-2.tsx')

    expect(page).toMatch(
      /const \[resolvedSearchParams, companyScope, tenantScope\] = await Promise\.all\(\[\s*searchParams,\s*getOperationalCompanyScope\(context\.userId\),\s*resolveAdminTenantReadScope\(context\),\s*\]\)/,
    )
  })

  it('reuses guard identity for the customer registry header', () => {
    const page = read('app/admin/customers/page.part-2.tsx')

    expect(page).toContain("requireAdminPageKeyAccess('customers.list')")
    expect(page).toContain('userEmail={context.email}')
    expect(page).not.toContain('createSupabaseServerClient')
    expect(page).not.toContain('.auth.getUser()')
  })

  it('keeps tenant-scoped operational reads intact', () => {
    const page = read('app/admin/customers/page.part-2.tsx')

    expect(page).toContain(".from('customer_sites')")
    expect(page).toContain(".from('supplier_switch_requests')")
    expect(page).toContain(".from('outbound_requests')")
    expect(page.match(/query = query\.eq\('company_id', scopedCompanyId\)/g)?.length).toBe(3)
    expect(page).toContain('safeLatestContractsByCustomerIds(customerIds, scopedCompanyId)')
  })
})
