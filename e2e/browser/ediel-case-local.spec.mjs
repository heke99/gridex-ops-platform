import { readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'

const enabled = process.env.GRIDEX_EDIEL_CASE_LOCAL_E2E === '1'
  && process.env.NEXT_PUBLIC_SUPABASE_URL === 'http://127.0.0.1:54321'
  && !process.env.GRIDEX_E2E_BROWSER_BASE_URL
  && Boolean(process.env.GRIDEX_EDIEL_CASE_FIXTURE_PATH && process.env.GRIDEX_EDIEL_CASE_TEST_PASSWORD)
test.skip(!enabled, 'Requires the disposable local Supabase replay and writer-created fixture.')

const fixture = enabled ? JSON.parse(readFileSync(process.env.GRIDEX_EDIEL_CASE_FIXTURE_PATH, 'utf8')) : null
const detail = (id) => `/admin/ediel/operational-cases?caseId=${encodeURIComponent(id)}`

async function login(page, email) {
  await page.goto('/login')
  await page.getByLabel('E-post').fill(email)
  await page.getByLabel('Lösenord').fill(process.env.GRIDEX_EDIEL_CASE_TEST_PASSWORD)
  await page.getByRole('button', { name: 'Logga in' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))
}

test('real writer case follows the actual Control Tower link; older exact ID bypasses 200 newer rows', async ({ page }) => {
  await login(page, fixture.writerEmail)
  await page.goto('/admin/controltower')
  const row = page.getByRole('link', { name: new RegExp(fixture.recent.title) })
  await expect(row).toHaveAttribute('href', detail(fixture.recent.id))
  await row.click()
  await expect(page).toHaveURL(new RegExp(`caseId=${fixture.recent.id}$`))
  await expect(page.getByRole('heading', { name: fixture.recent.title })).toBeVisible()
  await expect(page.locator('main')).toContainText('masterdata_update_review')
  await expect(page.locator('main')).toContainText(fixture.recent.description)
  await expect(page.locator('main')).toContainText(fixture.recent.next_action)
  await expect(page.getByRole('link', { name: 'Visa kund' })).toHaveAttribute('href', `/admin/customers/${fixture.customerA}`)
  await expect(page.getByRole('link', { name: /Källmeddelande/ })).toHaveCount(0)
  await page.goto(detail(fixture.old.id))
  await expect(page.getByRole('heading', { name: fixture.old.title })).toBeVisible()
  await expect(page.locator('main')).toContainText(fixture.old.next_action)
  await page.goto('/admin/customer-cases')
  await expect(page.getByRole('heading', { name: 'Supportkö' })).toBeVisible()
  await expect(page.locator('main')).toContainText('Synthetic support')
  await expect(page.locator('main')).not.toContainText(fixture.recent.title)
  const foreignResponse = await page.goto(detail(fixture.foreign.id))
  expect(foreignResponse.status()).toBe(404)
  await expect(page.locator('body')).not.toContainText(fixture.foreign.description)
})

test('tenant writer changes only case status; read-only and no-case-read actors cannot triage', async ({ browser }) => {
  const summaryOnly = await browser.newPage()
  await login(summaryOnly, fixture.noCaseReadEmail)
  await summaryOnly.goto('/admin/controltower')
  await expect(summaryOnly.locator('main')).toContainText(fixture.recent.title)
  await expect(summaryOnly.getByRole('link', { name: new RegExp(fixture.recent.title) })).toHaveCount(0)
  await summaryOnly.goto(detail(fixture.old.id))
  await expect(summaryOnly).toHaveURL(/\/admin(?:\?|$)/)
  await summaryOnly.close()

  const writer = await browser.newPage()
  await login(writer, fixture.writerEmail)
  await writer.goto(detail(fixture.recent.id))
  await writer.getByLabel('Ärendestatus').selectOption('resolved')
  await writer.getByRole('button', { name: 'Spara status' }).click()
  await expect(writer.locator('main')).toContainText('Löst')
  await expect(writer.locator('main')).toContainText('Ediel-ärendestatus uppdaterad till resolved')
  await writer.close()

  const reader = await browser.newPage()
  await login(reader, fixture.readOnlyEmail)
  await reader.goto(detail(fixture.old.id))
  await expect(reader.getByRole('heading', { name: fixture.old.title })).toBeVisible()
  await expect(reader.getByLabel('Ärendestatus')).toHaveCount(0)
  await reader.close()
})
