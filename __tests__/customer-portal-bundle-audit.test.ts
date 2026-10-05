import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()

function read(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

describe('customer portal bundle audit policy', () => {
  it('suppresses per-section access inserts for the bundle route', () => {
    const source = read('lib/customer-portal/apiData.ts')

    expect(source).toContain("return route !== '/api/v1/customer/portal-bundle'")
    expect(source).toContain('if (!shouldLogPortalAccess(input.route)) return')
  })

  it('keeps one request-level audit record for the bundle response', () => {
    const route = read('app/api/v1/customer/portal-bundle/route.ts')

    expect(route).toContain('await logCustomerPortalSuccess({')
    expect(route).toContain("const route = '/api/v1/customer/portal-bundle'")
  })
})
