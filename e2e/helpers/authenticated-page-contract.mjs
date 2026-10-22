import assert from 'node:assert/strict'

const headings = {
  '/dashboard': /Gridex Platform Operations|Välkommen till/,
  '/admin/operations': 'Operations',
  '/admin/customers': 'Kundregister',
  '/admin/company-settings': 'Bolagsinställningar',
}

// Check the navigation that actually completed, including redirected requests.
// Navigation and scope assertions use fixed codes without private page data.
export async function assertAuthenticatedDestination(page, response, { baseUrl, route }) {
  const expected = new URL(route, baseUrl)
  const actual = new URL(page.url())
  assert.ok(response, 'authenticated_navigation_response_missing')
  const status = response.status()
  assert.ok(Number.isInteger(status) && status >= 200 && status < 300, 'authenticated_navigation_not_2xx')
  assert.ok(actual.origin === expected.origin, 'authenticated_navigation_origin_mismatch')
  assert.ok(actual.pathname === expected.pathname, 'authenticated_navigation_path_mismatch')
  if (expected.hash) assert.ok(actual.hash === expected.hash, 'authenticated_navigation_fragment_mismatch')
  const heading = headings[expected.pathname]
  assert.ok(heading, 'unknown_authenticated_page_contract')
  await page.getByRole('heading', { level: 1, name: heading, exact: true }).waitFor({ state: 'visible' })

  if (expected.pathname === '/dashboard') {
    await page.getByRole('heading', { level: 2, name: /^(?:Plattformens kontrollcenter|Öppna bolagets arbetsyta)$/, exact: true }).waitFor({ state: 'visible' })
  } else if (expected.pathname === '/admin/operations') {
    await page.getByText('Öppna arbetsuppgifter', { exact: true }).waitFor({ state: 'visible' })
  } else if (expected.pathname === '/admin/customers') {
    await page.getByRole('searchbox', { name: 'Sök kund', exact: true }).waitFor({ state: 'visible' })
    await page.getByRole('table', { name: 'Kunder med anläggningar, senaste avtal och ärendestatus', exact: true }).waitFor({ state: 'visible' })
  } else {
    const team = page.locator('#company-team')
    await team.waitFor({ state: 'visible' })
    await team.getByRole('heading', { level: 2, name: 'Bolagets användare och roller', exact: true }).waitFor({ state: 'visible' })
  }
  const body = await page.locator('body').innerText()
  assert.ok(!/Internal Server Error|Application error|Unhandled Runtime Error/.test(body), 'authenticated_framework_error')
}

export async function assertAuthenticatedPage(page, options) {
  const response = await page.goto(new URL(options.route, options.baseUrl).href)
  await assertAuthenticatedDestination(page, response, options)
}

export async function assertTenantCompanyTeam(page, { baseUrl, email }) {
  // Navigate once: a second hash-only navigation can legitimately return null.
  await assertAuthenticatedPage(page, { baseUrl, route: '/admin/company-settings#company-team' })
  const companyInput = page.locator('#company-profile input[name="company_id"]')
  await companyInput.waitFor({ state: 'attached' })
  const companyId = await companyInput.inputValue()
  assert.ok(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(companyId), 'tenant_company_scope_missing')

  const team = page.locator('#company-team')
  const companyIds = await team.locator('input[name="company_id"]').evaluateAll(inputs => inputs.map(input => input.value))
  assert.ok(companyIds.length > 0 && companyIds.every(id => id === companyId), 'tenant_team_company_scope_mismatch')
  const rows = team.locator('details[id^="company-user-"]')
  let ownMember = null
  for (let index = 0; index < await rows.count(); index += 1) {
    const row = rows.nth(index)
    const rowEmail = await row.locator('input[name="email"]').inputValue()
    if (rowEmail.trim().toLowerCase() === email.trim().toLowerCase()) {
      ownMember = row
      break
    }
  }
  assert.ok(ownMember, 'tenant_team_identity_missing')
  assert.ok((await ownMember.locator('input[name="user_id"]').inputValue()).trim(), 'tenant_team_user_id_missing')
  if (await ownMember.getAttribute('open') === null) await ownMember.locator('summary').first().click()
  await ownMember.getByLabel('Systemroll', { exact: true }).waitFor({ state: 'visible' })
  return companyId
}
