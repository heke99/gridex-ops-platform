import { readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { test, expect } from '@playwright/test'

const requested = process.env.GRIDEX_REDELIVERY_HISTORY_LOCAL_E2E === '1'
const enabled = requested && process.env.CI === 'true'
  && process.env.NEXT_PUBLIC_SUPABASE_URL === 'http://127.0.0.1:54321'
  && !process.env.GRIDEX_E2E_BROWSER_BASE_URL
  && Boolean(process.env.GRIDEX_REDELIVERY_NAVIGATION_FIXTURE_PATH && process.env.GRIDEX_REDELIVERY_NAVIGATION_PASSWORD)
if (requested && !enabled) throw new Error('redelivery_history_disposable_local_required')
const fixturePath = enabled ? resolve(process.env.GRIDEX_REDELIVERY_NAVIGATION_FIXTURE_PATH) : null
if (enabled && (!process.env.RUNNER_TEMP || !fixturePath.startsWith(resolve(process.env.RUNNER_TEMP) + sep))) {
  throw new Error('redelivery_history_fixture_must_stay_in_runner_temp')
}
const f = enabled ? JSON.parse(readFileSync(fixturePath, 'utf8')) : null
if (enabled && f.decisionCount !== 0) throw new Error('redelivery_history_requires_fresh_fixture_before_the_saved_decision_journey')
test.skip(!enabled, 'Requires the existing fresh disposable local U12 GoTrue/invoice fixture, before the saved-decision journey.')
test.describe.configure({ mode: 'serial', retries: 0 })
test.use({ trace: 'off', video: 'off' })
test.setTimeout(120_000)
const invoiceUrl = () => `/admin/billing/invoices/${f.context.invoiceExportItemId}`
const decisionUrl = () => `${invoiceUrl()}/redelivery`
const form = page => page.locator('form').filter({ has: page.locator('textarea[name="reason"]') })
async function openFromInvoice(page) {
  await page.route('**/*', async route => {
    const host = new URL(route.request().url()).hostname
    if (host !== '127.0.0.1' && host !== 'localhost') return route.abort()
    await route.continue()
  })
  await page.goto('/login')
  await page.getByLabel('E-post').fill(f.writer.email)
  await page.getByLabel('Lösenord').fill(process.env.GRIDEX_REDELIVERY_NAVIGATION_PASSWORD)
  await page.getByRole('button', { name: 'Logga in' }).click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'))
  await page.goto(invoiceUrl())
  await page.getByRole('link', { name: 'Separat beslut om omleverans', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`${decisionUrl()}$`))
  await expect(form(page).getByRole('button', { name: 'Skapa leveransbeslut', exact: true })).toBeEnabled()
  let actionPosts = 0
  page.on('request', request => {
    if (request.method() === 'POST' && request.headers()['next-action']) actionPosts++
  })
  return () => actionPosts
}
async function backWithConfirmation(page, accept) {
  // This intentionally requires a genuine traversal confirmation. Its absence
  // records uncovered navigation; it does not assert that cached draft data was lost.
  const dialogPromise = page.waitForEvent('dialog', { timeout: 8_000 })
  const traversal = page.goBack()
  const dialog = await dialogPromise
  expect(dialog.type()).toBe('confirm')
  expect(dialog.message()).toContain('osparade ändringar')
  if (accept) await dialog.accept()
  else await dialog.dismiss()
  await traversal
}

test('untouched actual Next Back and Forward traverse the invoice entries without a manufactured prompt or action', async ({ page }) => {
  const actionPosts = await openFromInvoice(page)
  let dialogs = 0
  page.on('dialog', async dialog => { dialogs++; await dialog.dismiss() })
  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`${invoiceUrl()}$`))
  await page.goForward()
  await expect(page).toHaveURL(new RegExp(`${decisionUrl()}$`))
  await expect(form(page).locator('textarea[name="reason"]')).toHaveValue('')
  await expect(form(page).locator('select[name="accountId"]')).toHaveValue('')
  expect(dialogs).toBe(0); expect(actionPosts()).toBe(0)
})

test('a genuine dirty Back traversal can be cancelled while retaining the current entry and both draft fields', async ({ page }) => {
  const actionPosts = await openFromInvoice(page)
  await form(page).locator('textarea[name="reason"]').fill('Synthetic unsaved history draft')
  await form(page).locator('select[name="accountId"]').selectOption(f.context.accountId)
  await backWithConfirmation(page, false)
  await expect(page).toHaveURL(new RegExp(`${decisionUrl()}$`))
  await expect(form(page).locator('textarea[name="reason"]')).toHaveValue('Synthetic unsaved history draft')
  await expect(form(page).locator('select[name="accountId"]')).toHaveValue(f.context.accountId)
  expect(actionPosts()).toBe(0)
  await form(page).screenshot({ path: 'e2e-artifacts/invoice-redelivery-history-cancelled.png' })
})

test('an explicitly confirmed Back discard allows the invoice entry then returns Forward to a clean draft without a save', async ({ page }) => {
  const actionPosts = await openFromInvoice(page)
  await form(page).locator('textarea[name="reason"]').fill('Synthetic history discard only after confirmation')
  await form(page).locator('select[name="accountId"]').selectOption(f.context.accountId)
  await backWithConfirmation(page, true)
  await expect(page).toHaveURL(new RegExp(`${invoiceUrl()}$`))
  await page.goForward()
  await expect(page).toHaveURL(new RegExp(`${decisionUrl()}$`))
  await expect(form(page).locator('textarea[name="reason"]')).toHaveValue('')
  await expect(form(page).locator('select[name="accountId"]')).toHaveValue('')
  expect(actionPosts()).toBe(0)
  await form(page).screenshot({ path: 'e2e-artifacts/invoice-redelivery-history-confirmed-discard.png' })
})
