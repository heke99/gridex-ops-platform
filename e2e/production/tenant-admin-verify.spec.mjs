import { test, expect } from '@playwright/test'
import { assertAuthenticatedDestination, assertTenantCompanyTeam } from '../helpers/authenticated-page-contract.mjs'
import {
  fingerprint,
  productionRunId,
  requireEnv,
  safeUrlOrigin,
  writeEvidence,
} from './helpers/evidence.mjs'

const prodBaseUrl = requireEnv('GRIDEX_E2E_PROD_BASE_URL').replace(/\/$/, '')
const tenantAdminEmail = requireEnv('GRIDEX_E2E_TENANT_ADMIN_EMAIL').trim().toLowerCase()
const tenantAdminPassword = requireEnv('GRIDEX_E2E_TENANT_ADMIN_PASSWORD')
const runId = productionRunId()

async function loginAsTenantAdmin(page) {
  await page.goto(`${prodBaseUrl}/login`)
  await page.getByLabel('E-post').fill(tenantAdminEmail)
  await page.getByLabel('Lösenord').fill(tenantAdminPassword)
  await page.getByRole('button', { name: 'Logga in' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 })
}

test('manually verified tenant admin can access own tenant but not platform-only administration', async ({ page }) => {
  const startedAt = new Date().toISOString()
  const checks = []
  let companyId = null

  try {
    await loginAsTenantAdmin(page)
    checks.push({ name: 'tenant_admin_login', status: 'passed' })

    companyId = await assertTenantCompanyTeam(page, { baseUrl: prodBaseUrl, email: tenantAdminEmail })
    checks.push({ name: 'own_tenant_scope_resolved', status: 'passed' })
    checks.push({ name: 'own_tenant_user_management', status: 'passed' })

    const ownUsersResponse = await page.goto(`${prodBaseUrl}/admin/companies/${companyId}/users`)
    await assertAuthenticatedDestination(page, ownUsersResponse, { baseUrl: prodBaseUrl, route: '/admin/company-settings' })
    checks.push({ name: 'platform_company_users_denied', status: 'passed' })

    const companiesResponse = await page.goto(`${prodBaseUrl}/admin/companies`)
    await assertAuthenticatedDestination(page, companiesResponse, { baseUrl: prodBaseUrl, route: '/admin/company-settings' })
    await expect(page.getByRole('heading', { name: 'Skapa nytt elhandelsbolag' })).toHaveCount(0)
    checks.push({ name: 'platform_company_admin_denied', status: 'passed' })

    const goLiveResponse = await page.goto(`${prodBaseUrl}/admin/platform/go-live`)
    await assertAuthenticatedDestination(page, goLiveResponse, { baseUrl: prodBaseUrl, route: '/admin/company-settings' })
    checks.push({ name: 'platform_go_live_denied', status: 'passed' })

    writeEvidence('gridex-production-tenant-admin-verify.json', {
      run_id: runId,
      mode: 'tenant-admin-verify',
      status: 'passed',
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      target: { ops_origin: safeUrlOrigin(prodBaseUrl) },
      tenant: { company_id: companyId },
      identity: { tenant_admin_email_fingerprint: fingerprint(tenantAdminEmail) },
      checks,
      mutation_attempted: false,
      pii_written_to_artifact: false,
    })
  } catch (error) {
    writeEvidence('gridex-production-tenant-admin-verify.json', {
      run_id: runId,
      mode: 'tenant-admin-verify',
      status: 'failed',
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      target: { ops_origin: safeUrlOrigin(prodBaseUrl) },
      tenant: companyId ? { company_id: companyId } : null,
      identity: { tenant_admin_email_fingerprint: fingerprint(tenantAdminEmail) },
      error: error instanceof Error ? error.message : String(error),
      checks,
      mutation_attempted: false,
      pii_written_to_artifact: false,
    })
    throw error
  }
})
