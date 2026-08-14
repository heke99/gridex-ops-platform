import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const form = readFileSync('app/admin/platform/api-clients/CreateApiClientForm.tsx', 'utf8')
const page = readFileSync('app/admin/platform/api-clients/page.tsx', 'utf8')

describe('tenant go-live operator UX', () => {
  it('uses one primary go-live action and keeps technical settings secondary', () => {
    expect(form).toContain('Sätt bolaget live')
    expect(form).toContain('Avancerat · normalt behöver du inte ändra detta')
    expect(form).toContain('id="tenant-go-live"')
    expect(form).toContain('name="allowedOrigins"')
    expect(form).toContain('required')
  })

  it('shows blockers as actionable remediation instead of raw dead ends', () => {
    expect(form).toContain('Det här blockerar live')
    expect(form).toContain('remediationForMessage')
    expect(form).toContain('Gå till avtal')
    expect(form).toContain('Gå till juridik')
    expect(form).toContain('Gå till anläggningsflöde')
    expect(form).toContain('Åtgärda blockerarna och kör sedan samma')
  })

  it('loads canonical launch readiness on existing tenant clients', () => {
    expect(page).toContain('profile_key,launch_ready,launch_blockers')
    expect(page).toContain("client.profile_key === 'tenant_website'")
    expect(page).toContain("client.status === 'active' && client.launch_ready === true")
    expect(page).toContain('Status & blockerare')
  })

  it('routes blocked tenant clients back to canonical go-live instead of generic activation', () => {
    expect(page).toContain('Sätt live / revalidera')
    expect(page).toContain('Skapa ny live-klient')
    expect(page).toContain('goLiveHref(client.company_id)')
    expect(page).toContain('Du ska inte behöva aktivera klienter, readiness eller capabilities med separata knappar.')
  })

  it('prefills the selected tenant but clears tenant-specific values when switching companies', () => {
    expect(page).toContain(".select('id,name,status,customer_portal_url')")
    expect(page).toContain('defaultCustomerPortalUrl={defaultCustomerPortalUrl}')
    expect(page).toContain('defaultAllowedOrigins={defaultAllowedOrigins}')
    expect(form).toContain('function changeCompany(nextCompanyId: string)')
    expect(form).toContain("setCustomerPortalUrl('')")
    expect(form).toContain("setAllowedOrigins('')")
    expect(form).toContain("Never carry one tenant's canonical URL/origins into another tenant by accident")
  })

  it('keeps destructive credential operations behind secondary security controls', () => {
    expect(page).toContain('Säkerhetsåtgärder')
    expect(page).toContain('Återkalla nyckel')
    expect(page).toContain('Radera gammal nyckel')
  })
})
