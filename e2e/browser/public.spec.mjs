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

    const navigation = page.getByRole('navigation', { name: 'API documentation' })
    await expect(navigation).toBeVisible()
    if (width < 1024) {
      await navigation.getByText('Jump to section', { exact: true }).click()
      await navigation.getByRole('link', { name: 'Customer Portal', exact: true }).click()
      await expect(page).toHaveURL(/#customer-portal$/)
      await expect(page.getByRole('heading', { name: '5. Customer Portal API', exact: true })).toBeInViewport()
    }
    for (const block of await page.locator('pre').all()) {
      const layout = await block.evaluate(element => ({
        font: parseFloat(getComputedStyle(element).fontSize),
        top: element.getBoundingClientRect().top,
        buttonBottom: element.parentElement.querySelector('button').getBoundingClientRect().bottom,
      }))
      expect(layout.font).toBeGreaterThanOrEqual(16)
      expect(layout.buttonBottom, 'Copy toolbar must not overlap the code').toBeLessThanOrEqual(layout.top)
    }

    const regions = page.getByRole('region')
    await expect(regions).toHaveCount(11)
    const scrollTargets = page.locator('[role="region"], [role="group"][tabindex="0"]')
    let horizontallyScrolled = 0
    for (let index = 0; index < await scrollTargets.count(); index += 1) {
      const region = scrollTargets.nth(index)
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

    const endpointList = page.getByRole('region', { name: 'Customer Portal endpoints', exact: true })
    for (const identifier of await endpointList.locator('code').all()) {
      const textLayout = await identifier.evaluate(element => ({
        fontSize: parseFloat(getComputedStyle(element).fontSize),
        height: element.clientHeight,
        lineHeight: parseFloat(getComputedStyle(element).lineHeight),
      }))
      expect(textLayout.fontSize, 'Endpoint identifiers must remain readable').toBeGreaterThanOrEqual(16)
      expect(textLayout.height, 'Long paths and scopes must not become vertical letter columns').toBeLessThanOrEqual(textLayout.lineHeight + 1)
    }

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

for (const width of [1280, 375]) {
  test(`Staff API contains wide tables at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const response = await page.goto('/developers/staff-api')
    await expectHealthyResponse(response, 'Staff documentation')
    for (const label of ['Staff scopes and permissions', 'Staff API endpoints', 'Staff API errors']) {
      const region = page.getByRole('region', { name: label, exact: true })
      await expect(region).toHaveAttribute('tabindex', '0')
      await region.focus()
      if (await region.evaluate(element => element.scrollWidth > element.clientWidth + 1)) {
        await page.keyboard.press('ArrowRight')
        await expect.poll(() => region.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
      }
    }
    const layout = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }))
    expect(layout.document).toBeLessThanOrEqual(layout.viewport + 1)
    await attachAccessibilityEvidence(page, testInfo, `staff-docs-${width}`)
  })
}

test('Developer entry uses clear Swedish and keeps the guide reachable', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 })
  await page.goto('/developers')
  await expect(page.getByRole('heading', { level: 1, name: 'Guider för Gridex API' })).toBeVisible()
  const layout = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }))
  expect(layout.document).toBeLessThanOrEqual(layout.viewport + 1)
  await expect(page.locator('main')).not.toContainText(/tenant-hemsida|Supabase auth-user|External Auth Linking|\bOPS\b/)
  await page.getByRole('link', { name: /Koppla hemsida och Mina sidor/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Gridex API', exact: true })).toBeVisible()
})

test('Code examples copy the complete original text', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/developers/customer-portal-api')
  const code = page.getByRole('region', { name: 'Authentication example', exact: true })
  const value = await code.innerText()
  await code.locator('..').getByRole('button', { name: 'Copy code example' }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(value)
})
