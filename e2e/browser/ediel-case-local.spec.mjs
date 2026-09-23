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

async function adminContent(page) {
  const content = page.locator('main.admin-saas-content')
  await expect(content).toHaveCount(1)
  return content
}

async function caseDetails(page) {
  const region = page.getByRole('region', { name: 'Ärendedetaljer', exact: true })
  await expect(region).toHaveCount(1)
  return region
}

test('real writer case follows the actual Control Tower link; older exact ID bypasses 200 newer rows', async ({ page }) => {
  await login(page, fixture.writerEmail)
  await page.goto('/admin/controltower')
  const tower = await adminContent(page)
  const row = tower.getByRole('link', { name: new RegExp(fixture.recent.title) })
  await expect(row).toHaveAttribute('href', detail(fixture.recent.id))
  await row.click()
  await expect(page).toHaveURL(new RegExp(`caseId=${fixture.recent.id}$`))
  const recentDetails = await caseDetails(page)
  await expect(recentDetails.getByRole('heading', { name: fixture.recent.title })).toBeVisible()
  await expect(recentDetails).toContainText('masterdata_update_review')
  await expect(recentDetails).toContainText(fixture.recent.description)
  await expect(recentDetails).toContainText(fixture.recent.next_action)
  await expect(recentDetails.getByRole('link', { name: 'Visa kund' })).toHaveAttribute('href', `/admin/customers/${fixture.customerA}`)
  await expect(page.getByRole('link', { name: /Källmeddelande/ })).toHaveCount(0)
  await page.goto(detail(fixture.old.id))
  const oldDetails = await caseDetails(page)
  await expect(oldDetails.getByRole('heading', { name: fixture.old.title })).toBeVisible()
  await expect(oldDetails).toContainText(fixture.old.next_action)
  await page.goto('/admin/customer-cases')
  const support = await adminContent(page)
  await expect(support.getByRole('heading', { name: 'Supportkö' })).toBeVisible()
  await expect(support).toContainText('Synthetic support')
  await expect(support).not.toContainText(fixture.recent.title)
  const foreignResponse = await page.goto(detail(fixture.foreign.id))
  // Next emits 200 after streaming starts, or 404 before it starts. Both must
  // render the actual not-found boundary, never a successful case/login/error.
  expect([200, 404]).toContain(foreignResponse.status())
  await expect(page).toHaveURL(new RegExp(`/admin/ediel/operational-cases\\?caseId=${fixture.foreign.id}$`))
  await expect(page.getByRole('heading', { level: 1, name: '404', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'This page could not be found.', exact: true })).toBeVisible()
  await expect(page.locator('meta[name="robots"][content="noindex"]')).not.toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Ärendedetaljer', exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Ärendestatus')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Spara status', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Visa kund', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Källmeddelande/ })).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText(fixture.foreign.description)
  await expect(page.locator('body')).not.toContainText(fixture.foreign.title)
  await expect(page.locator('body')).not.toContainText(fixture.foreign.next_action)
  await expect(page.locator('body')).not.toContainText(fixture.customerB)
  await expect(page.locator('body')).not.toContainText(fixture.foreign.sourceMessageId)
})

test('tenant writer changes only case status; read-only and no-case-read actors cannot triage', async ({ browser }) => {
  const summaryOnly = await browser.newPage()
  await login(summaryOnly, fixture.noCaseReadEmail)
  await summaryOnly.goto('/admin/controltower')
  const summary = await adminContent(summaryOnly)
  await expect(summary).toContainText(fixture.recent.title)
  await expect(summaryOnly.getByRole('link', { name: new RegExp(fixture.recent.title) })).toHaveCount(0)
  await summaryOnly.goto(detail(fixture.old.id))
  await expect(summaryOnly).toHaveURL(/\/admin(?:\?|$)/)
  await summaryOnly.close()

  const writer = await browser.newPage()
  await login(writer, fixture.writerEmail)
  await writer.goto(detail(fixture.recent.id))
  const writerDetails = await caseDetails(writer)
  await writerDetails.getByLabel('Ärendestatus').selectOption('resolved')
  await writerDetails.getByRole('button', { name: 'Spara status' }).click()
  await expect(writerDetails).toContainText('Löst')
  await expect(writerDetails).toContainText('Ediel-ärendestatus uppdaterad till resolved')
  await writer.close()

  const reader = await browser.newPage()
  await login(reader, fixture.readOnlyEmail)
  await reader.goto(detail(fixture.old.id))
  const readerDetails = await caseDetails(reader)
  await expect(readerDetails.getByRole('heading', { name: fixture.old.title })).toBeVisible()
  await expect(reader.getByLabel('Ärendestatus')).toHaveCount(0)
  await reader.close()
})
