import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { assertAuthenticatedPage } from '../helpers/authenticated-page-contract.mjs'

const baseUrl = String(process.env.GRIDEX_E2E_BROWSER_BASE_URL || '').trim()
const email = String(process.env.GRIDEX_E2E_BROWSER_EMAIL || '').trim()
const password = String(process.env.GRIDEX_E2E_BROWSER_PASSWORD || '')

async function attachAccessibilityEvidence(page, testInfo, label) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze()

  await testInfo.attach(`${label}-axe.json`, {
    body: Buffer.from(JSON.stringify(results, null, 2)),
    contentType: 'application/json',
  })

  const blocking = results.violations.filter((violation) =>
    violation.impact === 'critical' || violation.impact === 'serious'
  )
  expect(blocking, `${label} has serious/critical automated accessibility violations`).toEqual([])
}

async function expectApplicationPage(page, route) {
  await assertAuthenticatedPage(page, { baseUrl, route })
}

test('staging user logs in and traverses dashboard, operations and customers', async ({ page }, testInfo) => {
  test.skip(
    !baseUrl || !email || !password,
    'Authenticated browser E2E requires GRIDEX_E2E_BROWSER_BASE_URL, GRIDEX_E2E_BROWSER_EMAIL and GRIDEX_E2E_BROWSER_PASSWORD.'
  )

  const browserFailures = []
  page.on('pageerror', () => browserFailures.push('pageerror'))
  page.on('console', (message) => { if (message.type() === 'error') browserFailures.push('console_error') })
  page.on('requestfailed', () => browserFailures.push('request_failed'))

  await page.goto('/login')
  await page.getByLabel('E-post').fill(email)
  await page.getByLabel('Lösenord').fill(password)
  await page.getByRole('button', { name: 'Logga in' }).click()

  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 })
  await expectApplicationPage(page, '/dashboard')

  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    /Gridex Platform Operations|Välkommen till/
  )
  await attachAccessibilityEvidence(page, testInfo, 'authenticated-dashboard')

  await expectApplicationPage(page, '/admin/operations')

  await expectApplicationPage(page, '/admin/customers')

  expect(browserFailures, 'Browser errors or failed requests occurred during authenticated traversal').toEqual([])
})
