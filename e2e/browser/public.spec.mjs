import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

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

async function expectHealthyResponse(response, label) {
  expect(response, `${label} did not return a navigation response`).not.toBeNull()
  expect(response.status(), `${label} returned an unexpected HTTP status`).toBeLessThan(500)
}

test('landing page reaches the real login flow', async ({ page }) => {
  const response = await page.goto('/')
  await expectHealthyResponse(response, 'landing page')

  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'Drift, kunder och Ediel i ett sammanhållet system.',
    })
  ).toBeVisible()

  const apiDocs = page.getByRole('link', { name: 'API-dokumentation' })
  await expect(apiDocs).toHaveAttribute('href', '/developers/customer-portal-api')

  await page.getByRole('link', { name: 'Logga in' }).click()
  await expect(page).toHaveURL(/\/login(?:\?.*)?$/)
  await expect(page.getByRole('heading', { level: 2, name: 'Logga in till Gridex CIS' })).toBeVisible()
})

test('login page exposes accessible credential controls and recovery path', async ({ page }) => {
  const response = await page.goto('/login')
  await expectHealthyResponse(response, 'login page')

  const email = page.getByLabel('E-post')
  const password = page.getByLabel('Lösenord')
  const submit = page.getByRole('button', { name: 'Logga in' })

  await expect(email).toHaveAttribute('type', 'email')
  await expect(email).toHaveAttribute('required', '')
  await expect(password).toHaveAttribute('type', 'password')
  await expect(password).toHaveAttribute('required', '')
  await expect(submit).toBeEnabled()
  await expect(page.getByRole('link', { name: 'Glömt lösenord?' })).toHaveAttribute(
    'href',
    '/login/forgot-password'
  )
})

for (const [label, route] of [
  ['landing', '/'],
  ['login', '/login'],
]) {
  test(`${label} has no serious or critical automated WCAG violations`, async ({ page }, testInfo) => {
    const response = await page.goto(route)
    await expectHealthyResponse(response, `${label} accessibility target`)
    await attachAccessibilityEvidence(page, testInfo, label)
  })
}
