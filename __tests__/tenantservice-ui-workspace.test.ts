import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getAdminNavigationGroups } from '@/lib/admin/navigation'

describe('tenant workspace UI (P5)', () => {
  it('tenant navigation leads with Översikt, Kunder, Ärenden, Fakturering and keeps Inställningar', () => {
    const groups = getAdminNavigationGroups({
      // Platform admin in company view passes every permission check, so the full tenant
      // structure is visible.
      permissions: [],
      roles: [],
      isPlatformAdmin: true,
      isCompanyLiveEnabled: true,
      mode: 'company_view',
    } as never)
    const titles = groups.map((group) => group.title)
    expect(titles.slice(0, 4)).toEqual(['Översikt', 'Kunder', 'Ärenden', 'Fakturering'])
    expect(titles).toContain('Inställningar')
    const cases = groups.find((group) => group.key === 'cases')
    expect(cases?.items.map((item) => item.href)).toContain('/admin/customer-cases')
  })

  it('composer keeps reply, internal note and phone log as clearly separate modes and blocks double submit', () => {
    const composer = readFileSync('components/admin/support/SupportCaseComposer.tsx', 'utf8')
    expect(composer).toContain("'Svara kunden'")
    expect(composer).toContain("'Intern anteckning'")
    expect(composer).toContain("'Registrera samtal'")
    expect(composer).toContain('Sammanfattningen skickas inte automatiskt')
    expect(composer).toContain('useFormStatus')
    expect(composer).toContain('disabled={pending}')
    expect(composer).toContain('name="expected_company_id"')
    expect(composer).toContain('focus-visible:outline')
  })

  it('case detail page is tenant-scoped, labels visibility and only offers writes with cases.write', () => {
    const page = readFileSync('app/admin/customer-cases/[caseId]/page.tsx', 'utf8')
    expect(page).toContain('getCustomerCaseById(caseId, scope.companyId)')
    expect(page).toContain("if (!scope.companyId) notFound()")
    expect(page).toContain("'Synlig för kunden'")
    expect(page).toContain("'Endast internt'")
    expect(page).toContain("anyOf: ['cases.write']")
  })

  it('customer card loads updated_at so the optimistic version check is active', () => {
    const loader = readFileSync('app/admin/customers/[id]/page.part-1.tsx', 'utf8')
    expect(loader).toMatch(/apartment_number, created_at, updated_at,/)
  })

  it('support case creation form carries a per-render idempotency key and tenant guard', () => {
    const list = readFileSync('app/admin/customer-cases/page.tsx', 'utf8')
    expect(list).toContain('name="idempotency_key" value={randomUUID()}')
    expect(list).toContain('name="expected_company_id"')
  })
})
