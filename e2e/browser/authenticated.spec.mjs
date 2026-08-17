import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

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
  const response = await page.goto(route)
  expect(response, `${route} did not return a navigation response`).not.toBeNull()
  expect(response.status(), `${route} returned a server error`).toBeLessThan(500)
  await expect(page.locator('body')).not.toContainText('Internal Server Error')
  await expect(page.locator('body')).not.toContainText('Application error')
}

test('staging user logs in and traverses dashboard, operations and customers', async ({ page }, testInfo) => {
  test.skip(
    !baseUrl || !email || !password,
    'Authenticated browser E2E requires GRIDEX_E2E_BROWSER_BASE_URL, GRIDEX_E2E_BROWSER_EMAIL and GRIDEX_E2E_BROWSER_PASSWORD.'
  )

  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

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
  await expect(page.locator('main, [role="main"], body').first()).toBeVisible()

  await expectApplicationPage(page, '/admin/customers')
  await expect(page.locator('main, [role="main"], body').first()).toBeVisible()

  expect(pageErrors, 'Browser page errors were emitted during authenticated traversal').toEqual([])
})
