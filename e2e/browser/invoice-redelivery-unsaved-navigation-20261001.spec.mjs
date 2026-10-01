import { readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { test, expect } from '@playwright/test'

const requested = process.env.GRIDEX_REDELIVERY_NAVIGATION_LOCAL_E2E === '1'
const enabled = requested && process.env.CI === 'true' && process.env.NEXT_PUBLIC_SUPABASE_URL === 'http://127.0.0.1:54321'
  && !process.env.GRIDEX_E2E_BROWSER_BASE_URL && Boolean(process.env.GRIDEX_REDELIVERY_NAVIGATION_FIXTURE_PATH && process.env.GRIDEX_REDELIVERY_NAVIGATION_PASSWORD)
if (requested && !enabled) throw new Error('redelivery_navigation_browser_disposable_local_required')
const fixturePath = enabled ? resolve(process.env.GRIDEX_REDELIVERY_NAVIGATION_FIXTURE_PATH) : null
if (enabled && (!process.env.RUNNER_TEMP || !fixturePath.startsWith(resolve(process.env.RUNNER_TEMP) + sep))) {
  throw new Error('redelivery_navigation_browser_fixture_must_stay_in_runner_temp')
}
const f = enabled ? JSON.parse(readFileSync(fixturePath, 'utf8')) : null
test.skip(!enabled, 'Requires a fresh independent disposable local GoTrue/invoice fixture.')
test.describe.configure({ mode: 'serial', retries: 0 })
test.setTimeout(120_000)
const invoiceUrl = () => `/admin/billing/invoices/${f.context.invoiceExportItemId}`
const decisionUrl = () => `${invoiceUrl()}/redelivery`
const form = page => page.locator('form').filter({ has: page.locator('textarea[name="reason"]') })
async function login(page, email) {
  await page.route('**/*', async route => {
    const host = new URL(route.request().url()).hostname
    if (host !== '127.0.0.1' && host !== 'localhost') return route.abort()
    await route.continue()
  })
  await page.goto('/login')
  await page.getByLabel('E-post').fill(email)
  await page.getByLabel('Lösenord').fill(process.env.GRIDEX_REDELIVERY_NAVIGATION_PASSWORD)
  await page.getByRole('button', { name: 'Logga in' }).click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'))
  await page.goto(decisionUrl())
}
async function leave(page, accept) {
  const dialog = page.waitForEvent('dialog')
  const click = page.getByRole('link', { name: '← Till fakturan', exact: true }).click()
  const confirmation = await dialog
  expect(confirmation.type()).toBe('confirm')
  expect(confirmation.message()).toContain('osparade ändringar')
  if (accept) await confirmation.accept()
  else await confirmation.dismiss()
  await click
}

test('actual Next form guards drafts, preserves failed and pending drafts, then clears dirty only after a persisted separate decision', async ({ page }) => {
  await login(page, f.writer.email)
  await expect(form(page).getByRole('button', { name: 'Skapa leveransbeslut', exact: true })).toBeEnabled()
  let actionRequests = 0
  page.on('request', request => { if (request.method() === 'POST' && request.headers()['next-action'] && new URL(request.url()).pathname === decisionUrl()) actionRequests++ })
  await form(page).locator('select[name="accountId"]').selectOption(f.context.accountId)
  await form(page).locator('textarea[name="reason"]').fill('Unsaved synthetic reason remains after cancellation')
  await leave(page, false)
  await expect(page).toHaveURL(new RegExp(`${decisionUrl()}$`))
  await expect(form(page).locator('textarea[name="reason"]')).toHaveValue('Unsaved synthetic reason remains after cancellation')
  await expect(form(page).locator('select[name="accountId"]')).toHaveValue(f.context.accountId)
  expect(actionRequests).toBe(0)
  await form(page).screenshot({ path: 'e2e-artifacts/invoice-redelivery-unsaved-cancelled.png' })
  await leave(page, true)
  await expect(page).toHaveURL(new RegExp(`${invoiceUrl()}$`))
  expect(actionRequests).toBe(0)
  await page.goto(decisionUrl())
  await expect(form(page).locator('textarea[name="reason"]')).toHaveValue('')
  await expect(form(page).locator('select[name="accountId"]')).toHaveValue('')

  // Whitespace passes HTML required; the actual server schema rejects its
  // trimmed reason. No forged authorization or altered financial fields.
  await form(page).locator('select[name="accountId"]').selectOption(f.context.accountId)
  await form(page).locator('textarea[name="reason"]').fill('   ')
  await form(page).getByRole('button', { name: 'Skapa leveransbeslut', exact: true }).click()
  await expect(form(page).getByRole('alert')).toContainText('Kontrollera fakturans uppgifter')
  await expect(form(page).locator('select[name="accountId"]')).toHaveValue(f.context.accountId)
  await expect(form(page).locator('textarea[name="reason"]')).toHaveValue('   ')
  await leave(page, false)
  await expect(page).toHaveURL(new RegExp(`${decisionUrl()}$`))
  expect(actionRequests).toBe(1)
  await form(page).screenshot({ path: 'e2e-artifacts/invoice-redelivery-unsaved-error.png' })

  await form(page).locator('textarea[name="reason"]').fill(f.expectedReason)
  let release = () => undefined, intercepted = false
  const gate = new Promise(done => { release = done })
  const intercept = async route => {
    if (route.request().method() === 'POST' && route.request().headers()['next-action']) { intercepted = true; await gate }
    await route.continue()
  }
  await page.route(`**${decisionUrl()}`, intercept)
  const submit = form(page).getByRole('button', { name: 'Skapa leveransbeslut', exact: true }).click()
  try {
    await expect.poll(() => intercepted).toBe(true)
    await expect(form(page).locator('fieldset')).toBeDisabled()
    await expect(form(page).getByRole('button', { name: 'Registrerar beslut…', exact: true })).toBeDisabled()
    await leave(page, false)
    await expect(form(page).locator('textarea[name="reason"]')).toHaveValue(f.expectedReason)
    await expect(form(page).locator('select[name="accountId"]')).toHaveValue(f.context.accountId)
    await form(page).screenshot({ path: 'e2e-artifacts/invoice-redelivery-unsaved-pending.png' })
  } finally { release(); await submit; await page.unroute(`**${decisionUrl()}`, intercept) }
  await expect(form(page).getByRole('status')).toContainText('Beslutet om omleverans är sparat')
  await expect(form(page).getByRole('status')).toContainText('leveransen är ännu inte möjlig')
  await expect(form(page).getByRole('button', { name: 'Leveransbeslut skapat', exact: true })).toBeDisabled()
  await expect(form(page)).not.toHaveAttribute('data-dirty-form', 'true')
  expect(actionRequests).toBe(2)
  await form(page).screenshot({ path: 'e2e-artifacts/invoice-redelivery-unsaved-persisted.png' })
  let unexpectedDialogs = 0
  page.on('dialog', async dialog => { unexpectedDialogs++; await dialog.dismiss() })
  await page.getByRole('link', { name: '← Till fakturan', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`${invoiceUrl()}$`))
  expect(unexpectedDialogs).toBe(0)
})

test('actual current read-only actor sees the form disabled and cannot create a dirty navigation trap', async ({ page }) => {
  await login(page, f.reader.email)
  await expect(form(page).locator('fieldset')).toBeDisabled()
  await expect(form(page).getByRole('button', { name: 'Skapa leveransbeslut', exact: true })).toBeDisabled()
  await expect(form(page)).not.toHaveAttribute('data-dirty-form', 'true')
  let dialogs = 0
  page.on('dialog', async dialog => { dialogs++; await dialog.dismiss() })
  await page.getByRole('link', { name: '← Till fakturan', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`${invoiceUrl()}$`))
  expect(dialogs).toBe(0)
})
