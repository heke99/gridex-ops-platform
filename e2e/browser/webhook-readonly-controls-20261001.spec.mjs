import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { test, expect } from '@playwright/test'

const requested = process.env.GRIDEX_WEBHOOK_UI_LOCAL_E2E === '1'
const enabled = requested && process.env.CI === 'true' && process.env.NEXT_PUBLIC_SUPABASE_URL === 'http://127.0.0.1:54321'
  && !process.env.GRIDEX_E2E_BROWSER_BASE_URL && Boolean(process.env.GRIDEX_WEBHOOK_UI_FIXTURE_PATH && process.env.GRIDEX_WEBHOOK_UI_PASSWORD)
if (requested && !enabled) throw new Error('webhook_ui_browser_disposable_local_required')
// The existing default Playwright config launches real `next dev`. Its genuine
// RSC error message is an actor-specific witness here; production masks errors
// and needs a different witness, so this is not a production-message claim.
const fixturePath = enabled ? resolve(process.env.GRIDEX_WEBHOOK_UI_FIXTURE_PATH) : null
if (enabled && (!process.env.RUNNER_TEMP || !fixturePath.startsWith(resolve(process.env.RUNNER_TEMP) + sep))) {
  throw new Error('webhook_ui_browser_fixture_must_stay_in_runner_temp')
}
const f = enabled ? JSON.parse(readFileSync(fixturePath, 'utf8')) : null
test.skip(!enabled, 'Requires the independent disposable GoTrue/database webhook fixture.')
test.describe.configure({ mode: 'serial', retries: 0 })
test.setTimeout(120_000)
const routePath = '/admin/webhooks/deliveries'
function phase(name) {
  execFileSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'scripts/webhook-readonly-controls-20261001-native.config.ts'], {
    env: { ...process.env, GRIDEX_WEBHOOK_UI_FIXTURE_PHASE: name }, timeout: 120_000, stdio: 'pipe',
  })
}
const deliveryRow = page => page.locator('tr').filter({ has: page.locator(`input[name="delivery_id"][value="${f.resources[0].deliveryId}"]`) })
const ignoreForm = page => deliveryRow(page).locator('form').filter({ has: page.locator('input[name="note"]') })
async function login(page, email, companyId) {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') return route.abort()
    await route.continue()
  })
  await page.goto('/login')
  await page.getByLabel('E-post').fill(email)
  await page.getByLabel('Lösenord').fill(process.env.GRIDEX_WEBHOOK_UI_PASSWORD)
  await page.getByRole('button', { name: 'Logga in', exact: true }).click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'))
  await page.context().addCookies([{ name: 'gridex_admin_selected_company_id', value: companyId, url: 'http://127.0.0.1:3000', sameSite: 'Lax' }])
  await page.goto(routePath)
}
async function disabledControls(page) {
  await expect(page.getByRole('button', { name: 'Skicka testevent', exact: true })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Skicka testevent', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Resend', exact: true })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Resend', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Ignorera', exact: true })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Ignorera', exact: true })).toBeDisabled()
  await expect(page.getByRole('status').filter({ hasText: 'Läsläge' })).toHaveCount(3)
}
function assertBoundAction(response, text, denial) {
  expect(response.headers()['content-type']).toMatch(/text\/x-component/)
  expect(text).not.toMatch(/Failed to find Server Action|Unknown Server Action|server action.{0,40}not found|Cannot find module|Module not found|CompileError|BuildError/i)
  expect(text).toMatch(denial)
  expect(response.headers()['x-action-redirect'] ?? '').not.toContain('success=')
}

test('actual current reader and paused writer see exactly the real disabled controls without foreign rows or action posts', async ({ browser }, testInfo) => {
  for (const [actor, resource] of [[f.reader, f.resources[0]], [f.pausedWriter, f.resources[2]]]) {
    const context = await browser.newContext(), page = await context.newPage()
    let actionPosts = 0
    page.on('request', request => { if (request.method() === 'POST' && request.headers()['next-action'] && new URL(request.url()).pathname === routePath) actionPosts++ })
    try {
      await login(page, actor.email, resource.companyId)
      await disabledControls(page)
      await expect(page.locator(`input[name="company_id"][value="${resource.companyId}"]`)).toHaveCount(3)
      for (const foreign of f.resources.filter(row => row.companyId !== resource.companyId)) {
        await expect(page.locator(`input[name="company_id"][value="${foreign.companyId}"]`)).toHaveCount(0)
      }
      await page.getByRole('link', { name: 'Failed', exact: true }).click()
      await expect(page).toHaveURL(/\/admin\/webhooks\/deliveries\?status=failed$/)
      await disabledControls(page)
      expect(actionPosts).toBe(0)
      await page.screenshot({ path: testInfo.outputPath(actor === f.reader ? 'webhook-readonly-controls-reader.png' : 'webhook-readonly-controls-paused.png'), fullPage: true })
    } finally { await context.close() }
  }
})

test('actual pending form locks and the existing action rejects a grant revoked after the writable page was rendered', async ({ page }, testInfo) => {
  await login(page, f.writer.email, f.resources[0].companyId)
  await expect(ignoreForm(page).getByRole('button', { name: 'Ignorera', exact: true })).toBeEnabled()
  let release = () => undefined, intercepted = false, posts = 0, revoked = false
  const gate = new Promise(done => { release = done })
  const intercept = async route => {
    const request = route.request()
    if (request.method() === 'POST' && request.headers()['next-action']) { intercepted = true; posts++; await gate }
    await route.continue()
  }
  await page.route(`**${routePath}`, intercept)
  const response = page.waitForResponse(result => result.request().method() === 'POST' && Boolean(result.request().headers()['next-action']) && new URL(result.url()).pathname === routePath)
  const click = ignoreForm(page).getByRole('button', { name: 'Ignorera', exact: true }).click()
  try {
    await expect.poll(() => intercepted).toBe(true)
    await expect(ignoreForm(page).getByRole('button', { name: 'Markerar…', exact: true })).toBeDisabled()
    await expect(ignoreForm(page).getByRole('button', { name: 'Markerar…', exact: true })).toHaveAttribute('aria-busy', 'true')
    expect(posts).toBe(1)
    await ignoreForm(page).screenshot({ path: testInfo.outputPath('webhook-readonly-controls-current-denial-pending.png') })
    phase('revoke-writer'); revoked = true
    release(); await click
    const denied = await response
    assertBoundAction(denied, await denied.text(), /Forbidden/)
    // The native phase validates real current permissions and the complete
    // pre-browser owned/original graph, so denial cannot pass on an early
    // unknown action/module error or on a hidden successful mutation.
    phase('restore-writer'); revoked = false
    await page.goto(routePath)
    await expect(ignoreForm(page).getByRole('button', { name: 'Ignorera', exact: true })).toBeEnabled()
    await testInfo.attach('sanitized-webhook-current-denial', { body: JSON.stringify({ posts, currentPermissionDenied: true, graphCheckedByNativePhase: true }), contentType: 'application/json' })
  } finally {
    release(); await click.catch(() => undefined)
    await page.unroute(`**${routePath}`, intercept)
    if (revoked) phase('restore-writer')
  }
})

test('actual authorized ignore persists once after pending lock; fresh reader replay uses the same generated binding and is denied', async ({ browser }, testInfo) => {
  const context = await browser.newContext(), page = await context.newPage()
  let release = () => undefined, captured = null, posts = 0
  try {
    await login(page, f.writer.email, f.resources[0].companyId)
    await expect(page.getByRole('button', { name: 'Skicka testevent', exact: true })).toBeEnabled()
    await expect(deliveryRow(page).getByRole('button', { name: 'Resend', exact: true })).toBeEnabled()
    const gate = new Promise(done => { release = done })
    const intercept = async route => {
      const request = route.request(), headers = request.headers()
      if (request.method() === 'POST' && headers['next-action']) {
        posts++
        const url = new URL(request.url())
        captured = { path: url.pathname + url.search, action: headers['next-action'], contentType: headers['content-type'], body: request.postData() }
        await gate
      }
      await route.continue()
    }
    await page.route(`**${routePath}`, intercept)
    const click = ignoreForm(page).getByRole('button', { name: 'Ignorera', exact: true }).click()
    try {
      await expect.poll(() => captured !== null).toBe(true)
      await expect(ignoreForm(page).getByRole('button', { name: 'Markerar…', exact: true })).toBeDisabled()
      await expect(ignoreForm(page).getByRole('button', { name: 'Markerar…', exact: true })).toHaveAttribute('aria-busy', 'true')
      expect(posts).toBe(1)
      await ignoreForm(page).screenshot({ path: testInfo.outputPath('webhook-readonly-controls-pending.png') })
    } finally { release(); await click; await page.unroute(`**${routePath}`, intercept) }
    await expect(page).toHaveURL(/\/admin\/webhooks\/deliveries\?success=/)
    await page.goto(routePath)
    await expect(deliveryRow(page)).toContainText('skipped')
    expect(posts).toBe(1)
    await page.screenshot({ path: testInfo.outputPath('webhook-readonly-controls-persisted.png'), fullPage: true })
    expect(captured.path).toBe(routePath); expect(captured.action).toBeTruthy(); expect(captured.body).toBeTruthy()
    const readerContext = await browser.newContext(), reader = await readerContext.newPage()
    try {
      await login(reader, f.reader.email, f.resources[0].companyId)
      await disabledControls(reader)
      const response = await reader.request.post(captured.path, { headers: { 'next-action': captured.action, 'content-type': captured.contentType,
        origin: 'http://127.0.0.1:3000' }, data: captured.body })
      assertBoundAction(response, await response.text(), /Forbidden/)
    } finally { await readerContext.close() }
    await testInfo.attach('sanitized-webhook-ignore-runtime', { body: JSON.stringify({ authorizedPosts: posts, pendingLocked: true, sameGeneratedBindingReaderDenied: true, independentNativePostcheckRequired: true }), contentType: 'application/json' })
  } finally { release(); await context.close() }
})
