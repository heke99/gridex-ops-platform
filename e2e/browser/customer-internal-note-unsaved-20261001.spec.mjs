import { readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { test, expect } from '@playwright/test'

const requested = process.env.GRIDEX_NOTE_UNSAVED_LOCAL_E2E === '1'
const enabled = requested && process.env.CI === 'true' && process.env.NEXT_PUBLIC_SUPABASE_URL === 'http://127.0.0.1:54321'
  && !process.env.GRIDEX_E2E_BROWSER_BASE_URL && Boolean(process.env.GRIDEX_REDELIVERY_NAVIGATION_FIXTURE_PATH
    && process.env.GRIDEX_REDELIVERY_NAVIGATION_PASSWORD && process.env.GRIDEX_NOTE_UNSAVED_SNAPSHOT_PATH)
if (requested && !enabled) throw new Error('note_navigation_browser_disposable_local_required')
function privatePath(value) {
  const path = resolve(value)
  if (!process.env.RUNNER_TEMP || !path.startsWith(resolve(process.env.RUNNER_TEMP) + sep)) throw new Error('note_navigation_browser_runner_temp_required')
  return path
}
const f = enabled ? JSON.parse(readFileSync(privatePath(process.env.GRIDEX_REDELIVERY_NAVIGATION_FIXTURE_PATH), 'utf8')) : null
const snapshot = enabled ? JSON.parse(readFileSync(privatePath(process.env.GRIDEX_NOTE_UNSAVED_SNAPSHOT_PATH), 'utf8')) : null
test.skip(!enabled, 'Requires the existing fresh disposable local U12 fixture and independent note baseline.')
test.describe.configure({ mode: 'serial', retries: 0 })
test.use({ trace: 'off', video: 'off' })
test.setTimeout(120_000)
const customerUrl = () => `/admin/customers/${f.context.customerId}`
const notesUrl = () => `${customerUrl()}?tab=notes#notes`
const noteForm = page => page.locator('form').filter({ has: page.locator('textarea[name="body"]') })
const editor = page => noteForm(page).locator('textarea[name="body"]')
async function login(page, actor) {
  await page.route('**/*', async route => {
    const host = new URL(route.request().url()).hostname
    if (host !== '127.0.0.1' && host !== 'localhost') return route.abort()
    await route.continue()
  })
  await page.goto('/login')
  await page.getByLabel('E-post').fill(actor.email)
  await page.getByLabel('Lösenord').fill(process.env.GRIDEX_REDELIVERY_NAVIGATION_PASSWORD)
  await page.getByRole('button', { name: 'Logga in' }).click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'))
  await page.context().addCookies([{ name: 'gridex_admin_selected_company_id', value: f.context.companyId,
    url: 'http://127.0.0.1:3000', httpOnly: true, sameSite: 'Lax' }])
  await page.goto(notesUrl())
  await expect(page.getByRole('heading', { name: 'Intern anteckning', exact: true })).toBeVisible()
}
function countActions(page) {
  let count = 0
  page.on('request', request => {
    if (request.method() === 'POST' && request.headers()['next-action'] && new URL(request.url()).pathname === customerUrl()) count++
  })
  return () => count
}
async function leave(page, accept) {
  const dialog = page.waitForEvent('dialog')
  const click = page.getByRole('link', { name: 'Översikt', exact: true }).click()
  const confirmation = await dialog
  expect(confirmation.type()).toBe('confirm'); expect(confirmation.message()).toContain('osparade ändringar')
  if (accept) await confirmation.accept(); else await confirmation.dismiss()
  await click
}
test('actual notes form retains cancelled, failed and pending drafts and clears only the qualified stored-note receipt', async ({ page }) => {
  expect(snapshot.version).toBe(1); expect(snapshot.decisionCount).toBe(0)
  await login(page, f.writer)
  const actions = countActions(page)
  await expect(editor(page)).toBeEnabled()
  await expect(noteForm(page).getByRole('button', { name: 'Spara anteckning', exact: true })).toBeDisabled()
  await editor(page).fill('Synthetic cancelled internal draft')
  await leave(page, false)
  await expect(page).toHaveURL(new RegExp(`${customerUrl()}\\?tab=notes#notes$`))
  await expect(editor(page)).toHaveValue('Synthetic cancelled internal draft')
  expect(actions()).toBe(0)
  await noteForm(page).screenshot({ path: 'e2e-artifacts/customer-internal-note-cancelled.png' })
  await noteForm(page).getByRole('button', { name: 'Kasta utkast', exact: true }).click()
  await expect(editor(page)).toHaveValue('')
  await expect(noteForm(page).getByRole('button', { name: 'Spara anteckning', exact: true })).toBeDisabled()
  await editor(page).fill('Synthetic accepted-discard internal draft')
  await leave(page, true)
  await expect(page).toHaveURL(new RegExp(`${customerUrl()}\\?tab=overview#overview$`))
  expect(actions()).toBe(0)
  await page.goto(notesUrl())
  await expect(editor(page)).toHaveValue('')

  // This submits the actual ordinary form. The real creator rejects a trimmed
  // empty body before insert; it is not an altered-actor/forged HTTP exercise.
  await editor(page).fill('   ')
  await noteForm(page).getByRole('button', { name: 'Spara anteckning', exact: true }).click()
  await expect(noteForm(page).getByRole('alert')).toContainText('Anteckningens sparande kunde inte bekräftas')
  await expect(editor(page)).toHaveValue('   ')
  await leave(page, false)
  await expect(editor(page)).toHaveValue('   ')
  expect(actions()).toBe(1)
  await noteForm(page).screenshot({ path: 'e2e-artifacts/customer-internal-note-unconfirmed.png' })

  await editor(page).fill(snapshot.expectedBody)
  let intercepted = false, release = () => undefined
  const gate = new Promise(done => { release = done })
  const intercept = async route => {
    if (route.request().method() === 'POST' && route.request().headers()['next-action']) { intercepted = true; await gate }
    await route.continue()
  }
  const actionPath = url => url.pathname === customerUrl()
  await page.route(actionPath, intercept)
  const submit = noteForm(page).getByRole('button', { name: 'Spara anteckning', exact: true }).click()
  try {
    await expect.poll(() => intercepted).toBe(true)
    await expect(noteForm(page).locator('fieldset')).toBeDisabled()
    await expect(noteForm(page)).toHaveAttribute('aria-busy', 'true')
    await expect(noteForm(page).getByRole('button', { name: 'Kasta utkast', exact: true })).toBeDisabled()
    // Invoke the actual DOM submit method again during the held original POST;
    // the form's pending/inFlight path must prevent a second action dispatch.
    await noteForm(page).evaluate(form => form.requestSubmit())
    expect(actions()).toBe(2)
    await leave(page, false)
    await expect(editor(page)).toHaveValue(snapshot.expectedBody)
    await noteForm(page).screenshot({ path: 'e2e-artifacts/customer-internal-note-pending.png' })
  } finally { release(); await submit; await page.unroute(actionPath, intercept) }
  await expect(noteForm(page).getByRole('status')).toContainText('Anteckningen är sparad.')
  await expect(editor(page)).toHaveValue('')
  await expect(noteForm(page).getByRole('button', { name: 'Spara anteckning', exact: true })).toBeDisabled()
  expect(actions()).toBe(2)
  await noteForm(page).screenshot({ path: 'e2e-artifacts/customer-internal-note-persisted.png' })
  let dialogs = 0
  page.on('dialog', async dialog => { dialogs++; await dialog.dismiss() })
  await page.getByRole('link', { name: 'Översikt', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`${customerUrl()}\\?tab=overview#overview$`))
  expect(dialogs).toBe(0)
  // After proving the live guard cleared without reload, read the persisted
  // server history through a fresh GET, not a client-only success flag.
  await page.goto(notesUrl())
  await expect(page.locator('article').filter({ hasText: snapshot.expectedBody })).toHaveCount(1)
  await expect(page.locator('article').filter({ hasText: snapshot.expectedBody })).toContainText(`Skapad av: ${f.writer.userId}`)
})
test('actual current read-only page makes the note editor unavailable without creating a dirty draft or action POST', async ({ page }) => {
  await login(page, f.reader)
  const actions = countActions(page)
  // This is a prepared requirement assertion. It is not a claim that the
  // current source already passes mounted DOM/browser qualification.
  await expect(noteForm(page).locator('fieldset')).toBeDisabled()
  await expect(editor(page)).toBeDisabled()
  await expect(noteForm(page).getByRole('button', { name: 'Spara anteckning', exact: true })).toBeDisabled()
  await expect(noteForm(page).getByText('Osparad anteckning', { exact: true })).toHaveCount(0)
  let dialogs = 0
  page.on('dialog', async dialog => { dialogs++; await dialog.dismiss() })
  await page.getByRole('link', { name: 'Översikt', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`${customerUrl()}\\?tab=overview#overview$`))
  expect(actions()).toBe(0); expect(dialogs).toBe(0)
})
