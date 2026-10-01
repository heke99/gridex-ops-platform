import { readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { test, expect } from '@playwright/test'

const requested = process.env.GRIDEX_BILLING_RECIPIENT_LOCAL_E2E === '1'
const enabled = requested && process.env.CI === 'true'
  && process.env.NEXT_PUBLIC_SUPABASE_URL === 'http://127.0.0.1:54321'
  && !process.env.GRIDEX_E2E_BROWSER_BASE_URL
  && Boolean(process.env.GRIDEX_BILLING_RECIPIENT_FIXTURE_PATH && process.env.GRIDEX_BILLING_RECIPIENT_PASSWORD)
if (requested && !enabled) throw new Error('billing_recipient_browser_disposable_local_required')
const path = enabled ? resolve(process.env.GRIDEX_BILLING_RECIPIENT_FIXTURE_PATH) : null
if (enabled && (!process.env.RUNNER_TEMP || !path.startsWith(resolve(process.env.RUNNER_TEMP) + sep))) {
  throw new Error('billing_recipient_browser_fixture_must_stay_in_runner_temp')
}
const f = enabled ? JSON.parse(readFileSync(path, 'utf8')) : null
test.skip(!enabled, 'Requires the independent disposable local Auth/database billing fixture.')
test.describe.configure({ mode: 'serial', retries: 0 })
test.setTimeout(120_000)

const cardUrl = () => `/admin/customers/${f.context.customerId}?tab=billing-metering`
const card = page => page.locator('section').filter({ has: page.getByRole('heading', { name: 'Faktureringsstandard', exact: true }) }).last()
const defaults = page => card(page).locator('form').filter({ hasNot: page.locator('select[name="email__mode"]') })
const contract = (page, explicit) => card(page).locator('article').filter({ hasText: explicit ? 'Synthetic explicit billing contract' : 'Synthetic inherited billing contract' })
async function login(page, email) {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') return route.abort()
    await route.continue()
  })
  await page.goto('/login')
  await page.getByLabel('E-post').fill(email)
  await page.getByLabel('Lösenord').fill(process.env.GRIDEX_BILLING_RECIPIENT_PASSWORD)
  await page.getByRole('button', { name: 'Logga in' }).click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'))
  await page.goto(cardUrl())
}
async function overrideForm(page, explicit) {
  const article = contract(page, explicit)
  await expect(article).toHaveCount(1)
  if (!await article.locator('details').evaluate(element => element.open)) {
    await article.getByText('Ändra avtalsundantag', { exact: true }).click()
  }
  return article.locator('form')
}

test('actual billing card persists revisions and field sources, preserves stale draft, locks pending controls and rejects current denied actors', async ({ browser }) => {
  const writerContext = await browser.newContext(), staleContext = await browser.newContext()
  const writer = await writerContext.newPage(), stale = await staleContext.newPage()
  let captured = null, release = () => undefined
  try {
    await login(writer, f.writerEmail); await login(stale, f.writerEmail)
    await expect(defaults(writer).locator('input[name="expected_revision"]')).toHaveValue('1')
    await expect(defaults(stale).locator('input[name="expected_revision"]')).toHaveValue('1')
    await defaults(stale).locator('input[name="email"]').fill('ui-stale-draft@example.invalid')
    await defaults(writer).locator('input[name="recipient"]').fill('UI First Saved Recipient')
    await defaults(writer).locator('input[name="email"]').fill('ui-winner@example.invalid')
    await defaults(writer).locator('input[name="country"]').fill('NO')
    let attempts = 0
    const gate = new Promise(done => { release = done })
    const intercept = async route => {
      const request = route.request(), headers = request.headers()
      if (headers['next-action'] && request.method() === 'POST') {
        attempts += 1
        const url = new URL(request.url())
        captured = { path: url.pathname + url.search, action: headers['next-action'], contentType: headers['content-type'], body: request.postData() }
        await gate
      }
      await route.continue()
    }
    await writer.route('**/admin/customers/**', intercept)
    const click = defaults(writer).getByRole('button', { name: 'Spara faktureringsstandard', exact: true }).click()
    await expect.poll(() => captured !== null).toBe(true)
    await expect(defaults(writer)).toHaveAttribute('aria-busy', 'true')
    await expect(defaults(writer).locator('fieldset')).toBeDisabled()
    await expect(defaults(writer).locator('input[name="email"]')).toBeDisabled()
    await expect(defaults(writer).getByRole('button', { name: 'Sparar…', exact: true })).toBeDisabled()
    expect(attempts).toBe(1)
    await defaults(writer).screenshot({ path: 'e2e-artifacts/billing-recipient-revision-pending.png' })
    release(); await click
    await writer.unroute('**/admin/customers/**', intercept)
    await expect(defaults(writer).locator('input[name="expected_revision"]')).toHaveValue('2')
    await writer.reload()
    await expect(defaults(writer).locator('input[name="email"]')).toHaveValue('ui-winner@example.invalid')
    await expect(contract(writer, false)).toContainText('ui-winner@example.invalid')
    await expect(contract(writer, true)).toContainText('agency-original@example.invalid')

    await defaults(stale).getByRole('button', { name: 'Spara faktureringsstandard', exact: true }).click()
    await expect(defaults(stale).getByRole('alert')).toContainText('Ditt utkast är kvar')
    await expect(defaults(stale).locator('input[name="email"]')).toHaveValue('ui-stale-draft@example.invalid')
    await expect(defaults(stale).locator('input[name="expected_revision"]')).toHaveValue('1')
    await expect(defaults(stale).getByRole('button', { name: 'Spara faktureringsstandard', exact: true })).toBeDisabled()
    await defaults(stale).screenshot({ path: 'e2e-artifacts/billing-recipient-revision-conflict.png' })
    await defaults(stale).getByRole('button', { name: 'Läs in sparade uppgifter' }).click()
    await expect(defaults(stale).locator('input[name="email"]')).toHaveValue('ui-stale-draft@example.invalid')
    await defaults(stale).getByRole('button', { name: 'Avbryt', exact: true }).click()
    await stale.reload()
    await expect(defaults(stale).locator('input[name="expected_revision"]')).toHaveValue('2')
    await expect(defaults(stale).locator('input[name="email"]')).toHaveValue('ui-winner@example.invalid')

    let form = await overrideForm(writer, true)
    await form.locator('select[name="email__mode"]').selectOption('override')
    await form.locator('input[name="email"]').fill('ui-agency@example.invalid')
    await form.getByRole('button', { name: 'Spara avtalsundantag', exact: true }).click()
    await expect(contract(writer, true)).toContainText('undantagsrevision 1')
    await writer.reload()
    await expect(contract(writer, true)).toContainText('ui-agency@example.invalid')
    await defaults(writer).locator('input[name="recipient"]').fill('UI Later Saved Recipient')
    await defaults(writer).locator('input[name="email"]').fill('ui-default-later@example.invalid')
    await defaults(writer).getByRole('button', { name: 'Spara faktureringsstandard', exact: true }).click()
    await expect(defaults(writer).locator('input[name="expected_revision"]')).toHaveValue('3')
    await writer.reload()
    await expect(defaults(writer).locator('input[name="email"]')).toHaveValue('ui-default-later@example.invalid')
    await expect(contract(writer, false)).toContainText('ui-default-later@example.invalid')
    await expect(contract(writer, true)).toContainText('ui-agency@example.invalid')
    form = await overrideForm(writer, false)
    await form.locator('select[name="email__mode"]').selectOption('clear')
    await form.getByRole('button', { name: 'Spara avtalsundantag', exact: true }).click()
    await expect(contract(writer, false)).toContainText('Faktura-e-post: Saknas')
    await expect(contract(writer, false)).toContainText('undantagsrevision 1')
    form = await overrideForm(writer, false)
    await expect(form.locator('select[name="email__mode"]')).toHaveValue('clear')
    await form.locator('select[name="email__mode"]').selectOption('inherit')
    await form.getByRole('button', { name: 'Spara avtalsundantag', exact: true }).click()
    await expect(contract(writer, false)).toContainText('undantagsrevision 2')
    await writer.reload()
    await expect(contract(writer, false)).toContainText('ui-default-later@example.invalid')
    await expect(contract(writer, false)).toContainText('Ärver kundens standard')
    await expect(card(writer)).toContainText('Profilrevision: 3')
    await card(writer).screenshot({ path: 'e2e-artifacts/billing-recipient-revision-saved.png' })

    // Reuse the actual generated server-action binding and completed request.
    // Current authority is still required for a replay by either denied actor.
    expect(captured.action).toBeTruthy(); expect(captured.body).toBeTruthy()
    expect(captured.path).toBe(cardUrl())
    for (const [email, denial] of [[f.readerEmail, /"message"\s*:\s*"Forbidden"/], [f.foreignWriterEmail, /"code"\s*:\s*"tenant_context_changed"/]]) {
      const deniedContext = await browser.newContext(), denied = await deniedContext.newPage()
      try {
        await login(denied, email)
        await expect(defaults(denied)).toHaveCount(0)
        const response = await denied.evaluate(async ({ path, action, contentType, body }) => {
          const result = await fetch(path, { method: 'POST', credentials: 'same-origin',
            headers: { 'next-action': action, 'content-type': contentType }, body })
          return { status: result.status, contentType: result.headers.get('content-type'), text: await result.text() }
        }, captured)
        expect(response.contentType).toMatch(/text\/x-component/)
        expect(response.text).not.toMatch(/Failed to find Server Action|Unknown Server Action|server action.{0,40}not found|Cannot find module|Module not found|CompileError|BuildError/i)
        expect(response.text).toMatch(denial)
        expect(response.text).not.toContain('"status":"success"')
      } finally { await deniedContext.close() }
    }
    console.log('BILLING_RECIPIENT_REAL_BROWSER_PASS currentRevision=3 savedDefaultAndOverride=true explicitClearThenInherit=true pendingLocked=true staleDraftPreserved=true currentDeniedReplay=true nativePostcheckRequired=true')
  } finally {
    release()
    await writerContext.close(); await staleContext.close()
  }
})
