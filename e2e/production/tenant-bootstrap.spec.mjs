import { test, expect } from '@playwright/test'
import {
  fingerprint,
  productionRunId,
  requireEnv,
  writeEvidence,
} from './helpers/evidence.mjs'
import {
  isValidSwedishOrganizationNumber,
  syntheticSwedishOrganizationNumber,
} from './helpers/swedish-organization-number.mjs'

const prodBaseUrl = requireEnv('GRIDEX_E2E_PROD_BASE_URL').replace(/\/$/, '')
const superadminEmail = requireEnv('GRIDEX_E2E_SUPERADMIN_EMAIL').trim().toLowerCase()
const superadminPassword = requireEnv('GRIDEX_E2E_SUPERADMIN_PASSWORD')
const tenantAdminEmail = requireEnv('GRIDEX_E2E_TENANT_ADMIN_EMAIL').trim().toLowerCase()
const runId = productionRunId()

function suffixFromRunId() {
  return runId.replace(/[^a-z0-9]/gi, '').slice(-10).toLowerCase().padStart(10, '0')
}

async function loginAsSuperadmin(page) {
  await page.goto(`${prodBaseUrl}/login`)
  await page.getByLabel('E-post').fill(superadminEmail)
  await page.getByLabel('Lösenord').fill(superadminPassword)
  await page.getByRole('button', { name: 'Logga in' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 })
}

test('superadmin provisions a fresh synthetic tenant and real admin invitation intent', async ({ page }) => {
  const startedAt = new Date().toISOString()
  const suffix = suffixFromRunId()
  const tenantName = `GRIDEX E2E Certification ${suffix}`
  const slug = `gridex-e2e-cert-${suffix}`
  const prefix = `E2${suffix.slice(-6)}`.toUpperCase()
  const organizationNumber = syntheticSwedishOrganizationNumber(runId)
  const checks = []
  let companyId = null

  try {
    expect(isValidSwedishOrganizationNumber(organizationNumber)).toBe(true)
    checks.push({ name: 'synthetic_org_number_valid', status: 'passed' })

    await loginAsSuperadmin(page)
    checks.push({ name: 'superadmin_login', status: 'passed' })

    await page.goto(`${prodBaseUrl}/admin/companies`)
    await expect(page.getByRole('heading', { name: 'Skapa nytt elhandelsbolag' })).toBeVisible()

    await page.getByLabel('Bolagsnamn').fill(tenantName)
    await page.getByLabel('Organisationsnummer').fill(organizationNumber)
    await page.getByLabel('Kortnamn').fill(slug)
    await page.getByLabel('Kundnummerprefix').fill(prefix)
    await page.getByLabel('Kontaktperson').fill('Gridex E2E Certification')
    await page.getByLabel('Kontakt e-post').fill(tenantAdminEmail)
    await page.locator('input[name="website"]').fill('https://gridex.se')
    await page.locator('input[name="admin_name"]').fill('Gridex E2E Tenant Admin')
    await page.locator('input[name="admin_email"]').fill(tenantAdminEmail)

    await page.getByRole('button', { name: 'Skapa bolag' }).click()
    await expect(page).toHaveURL(/\/admin\/companies\?success=/, { timeout: 45_000 })
    await expect(page.locator('body')).toContainText('Elhandelsbolaget skapades via canonical provisioning.')
    await expect(page.locator('body')).toContainText('Bolagsansvarig får åtkomst först efter verifierad Auth-inbjudan.')
    checks.push({ name: 'canonical_tenant_provisioning', status: 'passed' })

    const companyCard = page.locator('article').filter({ hasText: tenantName }).first()
    await expect(companyCard).toBeVisible()
    await expect(companyCard).toContainText(slug)
    await expect(companyCard).toContainText(`Kundnummerprefix ${prefix}`)

    const idText = await companyCard.locator('p').filter({ hasText: /^ID:/ }).first().textContent()
    companyId = idText?.match(/ID:\s*([0-9a-f-]{36})/i)?.[1] ?? null
    expect(companyId, 'Fresh tenant card must expose a canonical UUID').toMatch(/^[0-9a-f-]{36}$/i)
    checks.push({ name: 'tenant_identity_rendered', status: 'passed' })

    const usersLink = companyCard.getByRole('link', { name: 'Användare' })
    await expect(usersLink).toHaveAttribute('href', `/admin/companies/${companyId}/users`)
    checks.push({ name: 'tenant_user_scope_link', status: 'passed' })

    writeEvidence('gridex-production-tenant-bootstrap.json', {
      run_id: runId,
      mode: 'tenant-bootstrap',
      status: 'waiting_external',
      waiting_for: 'tenant_admin_invitation_email_verification',
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      synthetic_tenant: {
        company_id: companyId,
        name: tenantName,
        slug,
        customer_number_prefix: prefix,
        organization_number_fingerprint: fingerprint(organizationNumber),
        tenant_admin_email_fingerprint: fingerprint(tenantAdminEmail),
      },
      checks,
      pii_written_to_artifact: false,
    })
  } catch (error) {
    writeEvidence('gridex-production-tenant-bootstrap.json', {
      run_id: runId,
      mode: 'tenant-bootstrap',
      status: 'failed',
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      synthetic_tenant: companyId
        ? {
            company_id: companyId,
            organization_number_fingerprint: fingerprint(organizationNumber),
          }
        : null,
      error: error instanceof Error ? error.message : String(error),
      checks,
      pii_written_to_artifact: false,
    })
    throw error
  }
})
