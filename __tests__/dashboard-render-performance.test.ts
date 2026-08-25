import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(__dirname, '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

describe('dashboard render performance invariants', () => {
  it('keeps verified auth server-side while deduplicating it per render request', () => {
    const authHelper = read('lib/auth/currentUser.ts')
    const layout = read('app/dashboard/layout.tsx')
    const page = read('app/dashboard/page.tsx')

    expect(authHelper).toContain("import { cache } from 'react'")
    expect(authHelper).toContain('createSupabaseServerClient')
    expect(authHelper).toContain('.auth.getUser()')
    expect(authHelper).toContain('cache(async () =>')

    expect(layout).toContain("getVerifiedAuthUser")
    expect(layout).toContain('await getVerifiedAuthUser()')
    expect(page).toContain("getVerifiedAuthUser")
    expect(page).toContain('await getVerifiedAuthUser()')
  })

  it('starts independent platform-role and company-scope reads together', () => {
    const page = read('app/dashboard/page.tsx')

    expect(page).toMatch(
      /const \[isPlatformAdmin, companyScope\] = await Promise\.all\(\[\s*userHasPlatformRole\(user\.id\),\s*getOperationalCompanyScope\(user\.id\),\s*\]\)/,
    )
  })
})
