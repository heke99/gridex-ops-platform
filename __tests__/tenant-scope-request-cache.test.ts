import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()

function read(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

describe('tenant scope request cache', () => {
  it('deduplicates the platform-admin role RPC within a server request', () => {
    const source = read('lib/tenant/scope.ts')

    expect(source).toContain('const isPlatformAdminUser = cache(async function isPlatformAdminUser')
    expect(source).toContain("supabaseService.rpc('gridex_get_user_roles', { p_user_id: userId })")
  })

  it('keeps operational company scope request-cached as before', () => {
    const source = read('lib/tenant/scope.ts')

    expect(source).toContain('export const listOperationalCompaniesForUser = cache(')
    expect(source).toContain('export const getOperationalCompanyScope = cache(')
  })
})
