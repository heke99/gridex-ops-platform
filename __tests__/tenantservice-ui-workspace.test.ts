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

describe('customer card for tenant staff (P5b)', () => {
  it('groups tenant tabs into five primary sections', async () => {
    const { tenantWorkspaceGroups, activeTenantGroup } = await import('@/app/admin/customers/[id]/workspaceGroups')
    const groups = tenantWorkspaceGroups(() => true)
    expect(groups.map((group) => group.label)).toEqual(['Översikt', 'Uppgifter', 'Avtal & anläggningar', 'Fakturor', 'Ärenden & historik'])
    expect(activeTenantGroup(groups, 'notes').label).toBe('Ärenden & historik')
    const withoutContracts = tenantWorkspaceGroups((tab) => tab !== 'contracts')
    expect(withoutContracts.find((group) => group.id === 'agreements')?.tabs).toEqual(['sites'])
  })

  it('header has one primary and at most two secondary actions, permission-gated and hidden when archived', () => {
    const page = readFileSync('app/admin/customers/[id]/page.part-4.tsx', 'utf8')
    expect(page).toContain('sticky top-0')
    expect(page).toContain('>\n                Registrera kontakt')
    expect(page).toContain('Ändra uppgifter')
    expect(page).toContain('Fler åtgärder')
    expect(page).toContain('anyOf: ["cases.write"]')
    expect(page).toContain('anyOf: ["masterdata.write"]')
    expect(page).toContain('customer.status !== "archived" ?')
  })

  it('"Registrera kontakt" preselects the customer and phone channel on the case form', () => {
    const list = readFileSync('app/admin/customer-cases/page.tsx', 'utf8')
    expect(list).toContain('customers.some((customer) => customer.id === query.customer)')
    expect(list).toContain("query.channel === 'phone'")
  })
})
