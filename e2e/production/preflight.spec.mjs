import { test, expect } from '@playwright/test'
import {
  fingerprint,
  productionRunId,
  requireEnv,
  safeUrlOrigin,
  writeEvidence,
} from './helpers/evidence.mjs'

const prodBaseUrl = requireEnv('GRIDEX_E2E_PROD_BASE_URL').replace(/\/$/, '')
const tenantWebsiteUrl = requireEnv('GRIDEX_E2E_TENANT_WEBSITE_URL').replace(/\/$/, '')
const superadminEmail = requireEnv('GRIDEX_E2E_SUPERADMIN_EMAIL').trim().toLowerCase()
const superadminPassword = requireEnv('GRIDEX_E2E_SUPERADMIN_PASSWORD')
const runId = productionRunId()

test('production certification preflight validates real surfaces and superadmin access', async ({ page }) => {
  const startedAt = new Date().toISOString()
  const checks = []

  try {
    const loginResponse = await page.goto(`${prodBaseUrl}/login`)
    expect(loginResponse).not.toBeNull()
    expect(loginResponse.status()).toBeLessThan(500)
    await expect(page.getByLabel('E-post')).toBeVisible()
    await expect(page.getByLabel('Lösenord')).toBeVisible()
    checks.push({ name: 'ops_login_surface', status: 'passed' })

    await page.getByLabel('E-post').fill(superadminEmail)
    await page.getByLabel('Lösenord').fill(superadminPassword)
    await page.getByRole('button', { name: 'Logga in' }).click()
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 })

    const companiesResponse = await page.goto(`${prodBaseUrl}/admin/companies`)
    expect(companiesResponse).not.toBeNull()
    expect(companiesResponse.status()).toBeLessThan(500)
    await expect(page.getByRole('heading', { name: 'Skapa nytt elhandelsbolag' })).toBeVisible()
    await expect(page.locator('body')).toContainText('Endast superadmin')
    checks.push({ name: 'superadmin_companies_access', status: 'passed' })

    const websiteResponse = await page.goto(`${tenantWebsiteUrl}/teckna-avtal`)
    expect(websiteResponse).not.toBeNull()
    expect(websiteResponse.status()).toBeLessThan(500)
    await expect(page.getByRole('heading', { name: /Teckna elavtal/i }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Hämta pris' })).toBeVisible()
    checks.push({ name: 'tenant_live_signup_surface', status: 'passed' })

    writeEvidence('gridex-production-preflight.json', {
      run_id: runId,
      mode: 'preflight',
      status: 'passed',
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      target: {
        ops_origin: safeUrlOrigin(prodBaseUrl),
        tenant_website_origin: safeUrlOrigin(tenantWebsiteUrl),
      },
      identities: {
        superadmin_email_fingerprint: fingerprint(superadminEmail),
      },
      checks,
      pii_written_to_artifact: false,
    })
  } catch (error) {
    writeEvidence('gridex-production-preflight.json', {
      run_id: runId,
      mode: 'preflight',
      status: 'failed',
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      checks,
      pii_written_to_artifact: false,
    })
    throw error
  }
})
