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

for (const width of [1280, 375]) {
  test(`API documentation keyboard and scrolling at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const response = await page.goto('/developers/customer-portal-api')
    expect(response, 'API documentation must return a navigation response').not.toBeNull()
    expect(response.status(), 'API documentation must return HTTP 200').toBe(200)
    await expect(page.getByRole('heading', { level: 1, name: 'Gridex API', exact: true })).toBeVisible()

    const regions = page.getByRole('region')
    await expect(regions).toHaveCount(11)
    let horizontallyScrolled = 0
    for (let index = 0; index < await regions.count(); index += 1) {
      const region = regions.nth(index)
      await expect(region).toHaveAccessibleName(/\S/)
      await expect(region).toHaveAttribute('tabindex', '0')
      await region.focus()
      await page.keyboard.press('Shift+Tab')
      await page.keyboard.press('Tab')
      await expect(region).toBeFocused()
      if (await region.evaluate((element) => element.scrollWidth > element.clientWidth + 1)) {
        await region.evaluate((element) => { element.scrollLeft = 0 })
        await page.keyboard.press('ArrowRight')
        await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
        horizontallyScrolled += 1
      }
    }
    expect(horizontallyScrolled, 'At least one wide code/table region must exercise keyboard scrolling').toBeGreaterThan(0)
    const layout = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }))
    expect(layout.document, 'Horizontal scrolling must stay inside code/table regions').toBeLessThanOrEqual(layout.viewport + 1)
    await testInfo.attach(`api-docs-${width}-layout.json`, {
      body: Buffer.from(JSON.stringify({ ...layout, horizontallyScrolled })),
      contentType: 'application/json',
    })

    const scrollingAccessibility = await new AxeBuilder({ page })
      .withRules(['scrollable-region-focusable'])
      .analyze()
    await testInfo.attach(`api-docs-${width}-scrolling-axe.json`, {
      body: Buffer.from(JSON.stringify(scrollingAccessibility, null, 2)),
      contentType: 'application/json',
    })
    expect(scrollingAccessibility.violations, 'All scrollable documentation regions need keyboard access').toEqual([])
    await attachAccessibilityEvidence(page, testInfo, `api-docs-${width}`)
  })
}
