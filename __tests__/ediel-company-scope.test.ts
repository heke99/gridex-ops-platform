import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Ediel admin pages are platform-admin only, so `isPlatformAdmin ? null : companyId`
// always dropped the selected company and mixed every tenant into one list.
const LIST_PAGES = [
  'app/admin/ediel/messages/page.tsx',
  'app/admin/ediel/automation/page.tsx',
  'app/admin/ediel/outbox/page.tsx',
  'app/admin/ediel/unresolved/page.tsx',
  'app/admin/ediel/portal-feedback/page.tsx',
  'app/admin/ediel/ai-list/page.tsx',
  'app/admin/ediel/routes/legacy/page.tsx',
  'app/admin/ediel/settings/page.tsx',
]

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

describe('Ediel list pages follow the selected company', () => {
  it.each(LIST_PAGES)('%s never discards the selected company for platform admins', (file) => {
    const source = read(file)
    expect(source).not.toMatch(/isPlatformAdmin \? null : companyScope\.companyId/)
    expect(source).not.toMatch(/if \(!isPlatformAdmin\) \{\s*if \(companyScope\.companyId\)/)
  })

  it('limits system-test recipient certificates to the selected company and shared ones', () => {
    const source = read('app/admin/ediel/system-tests/page.tsx')
    expect(source).toContain('!certificate.company_id || certificate.company_id === selectedCompanyId')
  })

  it('shows company names, not ids, on certificates and test runs', () => {
    expect(read('app/admin/ediel/certificates/page.tsx')).not.toContain('{row.company_id ?? "Platform"}')
    expect(read('app/admin/ediel/test-center/page.tsx')).not.toContain("Bolag: {lock.company_id ?? '—'}")
  })
})
