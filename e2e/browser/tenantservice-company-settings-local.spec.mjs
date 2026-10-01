import { readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'

const enabled = process.env.GRIDEX_SETTINGS_LOCAL_E2E === '1'
  && process.env.NEXT_PUBLIC_SUPABASE_URL === 'http://127.0.0.1:54321'
  && !process.env.GRIDEX_E2E_BROWSER_BASE_URL
  && Boolean(process.env.GRIDEX_SETTINGS_FIXTURE_PATH && process.env.GRIDEX_SETTINGS_TEST_PASSWORD)
test.skip(!enabled, 'Requires the disposable local settings Auth/database fixture.')
test.describe.configure({ mode: 'serial', retries: 0 })
const fixture = enabled ? JSON.parse(readFileSync(process.env.GRIDEX_SETTINGS_FIXTURE_PATH, 'utf8')) : null
const evidence = new WeakMap()

async function login(page, email) {
  const record = { pageErrors: [], serverErrors: [], actionPosts: [] }
  evidence.set(page, record)
  page.on('pageerror', (error) => record.pageErrors.push(error.name))
  page.on('response', (response) => { if (response.status() >= 500) record.serverErrors.push({ path: new URL(response.url()).pathname, status: response.status() }) })
  page.on('request', (request) => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/admin/company-settings') record.actionPosts.push('/admin/company-settings') })
  await page.goto('/login')
  await page.getByLabel('E-post').fill(email)
  await page.getByLabel('Lösenord').fill(process.env.GRIDEX_SETTINGS_TEST_PASSWORD)
  await page.getByRole('button', { name: 'Logga in', exact: true }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))
  await page.goto('/admin/company-settings')
}
async function assertRuntime(page, testInfo) {
  const record = evidence.get(page)
  expect(record.pageErrors).toEqual([])
  expect(record.serverErrors).toEqual([])
  await testInfo.attach('sanitized-settings-browser-runtime', { body: JSON.stringify(record), contentType: 'application/json' })
}

test('settings validation preserves the draft, cancel restores fields, and one save persists only the selected test company', async ({ page }, testInfo) => {
  await login(page, fixture.writerEmail)
  const form = page.locator('#company-profile')
  await expect(form.locator('input[name="company_id"]')).toHaveValue(fixture.companyA)
  await expect(form.locator('select[name="operating_environment"]')).toBeDisabled()
  await form.locator('input[name="name"]').fill('Synthetic validation draft')
  await form.locator('input[name="org_number"]').fill('5560160681')
  await form.getByRole('button', { name: 'Spara bolagsuppgifter', exact: true }).dblclick()
  await expect(form.getByRole('alert')).toContainText('Organisationsnumret är ogiltigt')
  await expect(form.locator('input[name="name"]')).toHaveValue('Synthetic validation draft')
  await expect(form.locator('input[name="org_number"]')).toHaveValue('5560160681')
  expect(evidence.get(page).actionPosts).toHaveLength(1)
  await form.getByRole('button', { name: 'Avbryt ändringar', exact: true }).click()
  await expect(form.locator('input[name="name"]')).toHaveValue('Synthetic settings company A')
  await expect(form.locator('input[name="org_number"]')).toHaveValue('')
  await form.locator('input[name="name"]').fill('Synthetic settings persisted')
  await form.getByRole('button', { name: 'Spara bolagsuppgifter', exact: true }).click()
  await expect(form.getByRole('status').filter({ hasText: 'Bolagsinställningarna sparades' })).toBeVisible()
  expect(evidence.get(page).actionPosts).toHaveLength(2)
  await page.reload()
  await expect(page.locator('#company-profile input[name="name"]')).toHaveValue('Synthetic settings persisted')
  await page.screenshot({ path: testInfo.outputPath('tenantservice-company-settings-persisted.png'), fullPage: true })
  await assertRuntime(page, testInfo)
})

test('reader sees an explicit read-only state and keyboard-reachable test settings', async ({ page }, testInfo) => {
  await login(page, fixture.readerEmail)
  const form = page.locator('#company-profile')
  await expect(form.getByText('Läsläge – du saknar behörighet att ändra bolagsuppgifter och användare.')).toBeVisible()
  await expect(form.locator('input[name="name"]')).toBeDisabled()
  await expect(form.getByRole('button', { name: 'Spara bolagsuppgifter', exact: true })).toBeDisabled()
  await expect(page.getByText('Du saknar behörighet att bjuda in användare.')).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByText('Navigation och arbetsyta', { exact: true }).focus()
  await expect(page.getByText('Navigation och arbetsyta', { exact: true })).toBeFocused()
  expect(await page.evaluate(() => document.body.scrollWidth > innerWidth + 1)).toBe(false)
  await page.screenshot({ path: testInfo.outputPath('tenantservice-company-settings-readonly-mobile.png'), fullPage: true })
  await assertRuntime(page, testInfo)
})

test('forged user resource is denied visibly and dirty navigation can be cancelled without losing the draft', async ({ page }, testInfo) => {
  await login(page, fixture.writerEmail)
  const userForm = page.locator(`form:has(input[name="user_id"][value="${fixture.writerId}"])`)
  await expect(userForm).toHaveCount(1)
  await userForm.locator('input[name="user_id"]').evaluate((input, id) => { input.value = id }, fixture.foreignUserId)
  await userForm.getByRole('button', { name: 'Spara bolagsbehörighet', exact: true }).click()
  await expect(userForm.getByRole('alert')).toContainText(/inte kopplad|saknar behörighet|kunde inte/)
  const form = page.locator('#company-profile')
  await form.locator('input[name="name"]').fill('Synthetic cancelled navigation draft')
  page.once('dialog', (dialog) => dialog.dismiss())
  await page.getByRole('link', { name: /Översikt/, exact: false }).last().click()
  await expect(page).toHaveURL(/\/admin\/company-settings$/)
  await expect(form.locator('input[name="name"]')).toHaveValue('Synthetic cancelled navigation draft')
  await form.getByRole('button', { name: 'Avbryt ändringar', exact: true }).click()
  await expect(form.locator('input[name="name"]')).toHaveValue('Synthetic settings persisted')
  await page.screenshot({ path: testInfo.outputPath('tenantservice-company-settings-denied-resource.png'), fullPage: true })
  await assertRuntime(page, testInfo)
})


test('shared Auth identity stays read-only while one canonical role change affects only this company', async ({ page }, testInfo) => {
  await login(page, fixture.writerEmail)
  const form = page.locator(`form:has(input[name="user_id"][value="${fixture.sharedUserId}"])`)
  await expect(form.locator('input[name="email"]')).toHaveAttribute('readonly', '')
  await expect(form.locator('input[name="email"]')).toHaveValue(fixture.sharedEmail)
  await expect(form.locator('input[name="full_name"],input[name="phone"],select[name="membership_role"]')).toHaveCount(0)
  await form.locator('input[name="email"]').evaluate((input) => { input.value = 'forged-login@example.invalid' })
  await form.getByRole('button', { name: 'Spara bolagsbehörighet', exact: true }).click()
  await expect(form.getByRole('alert')).toContainText('verifierade kontoflöde')
  await form.locator('input[name="email"]').evaluate((input, email) => { input.value = email }, fixture.sharedEmail)
  await form.locator('select[name="role_key"]').selectOption('finance_readonly')
  await form.getByRole('button', { name: 'Spara bolagsbehörighet', exact: true }).click()
  await expect(form.getByRole('status').filter({ hasText: 'bolagsbehörighet uppdaterades' })).toBeVisible()
  await page.reload()
  await expect(page.locator(`form:has(input[name="user_id"][value="${fixture.sharedUserId}"]) select[name="role_key"]`)).toHaveValue('finance_readonly')
  await page.screenshot({ path: testInfo.outputPath('tenantservice-company-settings-shared-identity.png'), fullPage: true })
  await assertRuntime(page, testInfo)
})
