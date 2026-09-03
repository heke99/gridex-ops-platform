import { test, expect } from '@playwright/test'

const prodBaseUrl = String(process.env.GRIDEX_E2E_PROD_BASE_URL ?? '').replace(/\/$/, '')
const superadminEmail = String(process.env.GRIDEX_E2E_SUPERADMIN_EMAIL ?? '').trim().toLowerCase()
const superadminPassword = String(process.env.GRIDEX_E2E_SUPERADMIN_PASSWORD ?? '')
const companyId = 'b3ad1bf6-fa45-41a6-8054-2e0862e82aca'

function requireValue(name, value) {
  if (!value) throw new Error(`Missing required environment value: ${name}`)
  return value
}

test('canonical Gridex v14 readiness, dry-run and live activation', async ({ page }) => {
  requireValue('GRIDEX_E2E_PROD_BASE_URL', prodBaseUrl)
  requireValue('GRIDEX_E2E_SUPERADMIN_EMAIL', superadminEmail)
  requireValue('GRIDEX_E2E_SUPERADMIN_PASSWORD', superadminPassword)
  if (prodBaseUrl !== 'https://app.gridex.se') throw new Error(`Refusing non-production target: ${prodBaseUrl}`)

  await page.goto(`${prodBaseUrl}/login`)
  await page.getByLabel('E-post').fill(superadminEmail)
  await page.getByLabel('Lösenord').fill(superadminPassword)
  await page.getByRole('button', { name: 'Logga in' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 })

  const goLiveUrl = `${prodBaseUrl}/admin/platform/go-live/${companyId}`
  const response = await page.goto(goLiveUrl)
  expect(response).not.toBeNull()
  expect(response.status()).toBeLessThan(500)
  await expect(page.getByRole('heading', { name: /Gridex El AB .* Go-Live/i })).toBeVisible()
  await expect(page.locator('body')).toContainText('21660')

  const readinessButton = page.getByRole('button', { name: 'Kör kontroll' })
  await expect(readinessButton).toBeEnabled()
  await Promise.all([
    page.waitForURL((url) => url.pathname === `/admin/platform/go-live/${companyId}` && ['prepared', 'blocked'].includes(url.searchParams.get('status') ?? ''), { timeout: 60_000 }),
    readinessButton.click(),
  ])
  if (new URL(page.url()).searchParams.get('status') === 'blocked') throw new Error(`Readiness remained blocked: ${page.url()}`)

  const dryRunButton = page.getByRole('button', { name: 'Kör dry run' })
  await expect(dryRunButton).toBeEnabled()
  await Promise.all([
    page.waitForURL((url) => url.pathname === `/admin/platform/go-live/${companyId}` && ['prepared', 'blocked'].includes(url.searchParams.get('status') ?? ''), { timeout: 60_000 }),
    dryRunButton.click(),
  ])
  if (new URL(page.url()).searchParams.get('status') === 'blocked') throw new Error(`Production dry-run blocked: ${page.url()}`)

  const confirmation = page.getByPlaceholder('ACTIVATE PRODUCTION')
  await expect(confirmation).toBeVisible()
  await confirmation.fill('ACTIVATE PRODUCTION')
  const activateButton = page.getByRole('button', { name: 'Aktivera production' })
  await expect(activateButton).toBeEnabled()
  await Promise.all([
    page.waitForURL((url) => url.pathname === `/admin/platform/go-live/${companyId}` && ['live', 'blocked', 'error'].includes(url.searchParams.get('status') ?? ''), { timeout: 60_000 }),
    activateButton.click(),
  ])
  const liveStatus = new URL(page.url()).searchParams.get('status')
  if (liveStatus !== 'live') throw new Error(`Canonical production activation failed with status=${liveStatus}: ${page.url()}`)

  await expect(page.locator('body')).toContainText('Live i production')
  await expect(page.locator('body')).toContainText('Send lock upplåst')
})
