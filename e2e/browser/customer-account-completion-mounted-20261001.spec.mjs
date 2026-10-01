import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { createServerClient } from '@supabase/ssr'
import { test, expect } from '@playwright/test'

const requested = process.env.GRIDEX_ACCOUNT_MOUNTED_LOCAL_E2E === '1'
const enabled = requested && process.env.CI === 'true' && process.env.NEXT_PUBLIC_SUPABASE_URL === 'http://127.0.0.1:54321'
  && !process.env.GRIDEX_E2E_BROWSER_BASE_URL && Boolean(process.env.GRIDEX_ACCOUNT_MOUNTED_PASSWORD
    && process.env.GRIDEX_ACCOUNT_MOUNTED_FIXTURE_PATH && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
if (requested && !enabled) throw new Error('account_mounted_browser_disposable_local_required')
if (enabled && ['RESEND_API_KEY', 'SENDGRID_API_KEY', 'MAILGUN_API_KEY', 'EDIEL_SMTP_PASS', 'EDIEL_SMTP_PASSWORD', 'SMTP_PASSWORD']
  .some(key => Boolean(process.env[key]?.trim()))) throw new Error('account_mounted_provider_credentials_forbidden')
function privatePath(value) {
  try {
    if (!process.env.RUNNER_TEMP || !value) throw new Error()
    const runner = realpathSync(process.env.RUNNER_TEMP), path = realpathSync(resolve(value))
    if (!path.startsWith(runner + sep) || (statSync(path).mode & 0o077) !== 0) throw new Error()
    return path
  } catch { throw new Error('account_mounted_private_fixture_required') }
}
const path = enabled ? privatePath(process.env.GRIDEX_ACCOUNT_MOUNTED_FIXTURE_PATH) : null
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
function read() {
  try {
    const f = JSON.parse(readFileSync(path, 'utf8'))
    if (f.version !== 1 || ![f.company, f.customer, f.site, f.customerActor?.id, f.platformActor?.id].every(uuid) ||
      typeof f.slug !== 'string' || !/^mounted-account-[a-f0-9-]{36}$/.test(f.slug) ||
      f.fullName !== 'Synthetic Mounted Account' || !/^\d{12}$/.test(f.personalNumber) || !/^\d{15}$/.test(f.facility)) {
      throw new Error()
    }
    return f
  } catch { throw new Error('account_mounted_private_fixture_invalid') }
}
const f = enabled ? read() : null
test.skip(!enabled, 'Requires the separate owned disposable GoTrue/Next account fixture.')
test.describe.configure({ mode: 'serial', retries: 0 })
test.use({ trace: 'off', video: 'off', screenshot: 'off', serviceWorkers: 'block' })
test.setTimeout(240_000)
const stages = ['customer_login', 'customer_cookie_witness', 'claim_form', 'created_views', 'customer_logout',
  'new_login', 'new_cookie_witness', 'replay_views', 'platform_card', 'phase_capture-created', 'phase_capture-replayed']
async function privateStage(stage, run) {
  if (!stages.includes(stage)) throw new Error('account_mounted_private_stage_invalid')
  try { return await run() }
  catch { throw new Error('account_mounted_private_stage_failed:' + stage) }
}
function allowedLocalUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && ['3000', '54321'].includes(url.port) && !url.username && !url.password
  } catch { return false }
}
const originalFetch = globalThis.fetch
function localFetch(input, init) {
  const url = input instanceof Request ? input.url : String(input)
  if (!allowedLocalUrl(url)) throw new Error('account_mounted_nonlocal_transport_forbidden')
  return originalFetch(input, { ...init, redirect: 'error' })
}
async function installLocalBrowserBoundary(context) {
  await context.route('**/*', async route => {
    if (!allowedLocalUrl(route.request().url())) return route.abort()
    return route.continue()
  })
}
function phase(value) {
  if (!['capture-created', 'capture-replayed'].includes(value)) throw new Error('account_mounted_phase_invalid')
  // Child output stays private even when Vitest includes a stack/transport detail.
  // Never replace a nonzero child status with a success marker.
  const log = path + '.' + value + '.private.log'
  try {
    const output = execFileSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config',
      'scripts/customer-account-completion-mounted-20261001-native.config.ts'], {
      env: { ...process.env, GRIDEX_ACCOUNT_MOUNTED_PHASE: value }, timeout: 90_000, stdio: 'pipe',
    })
    writeFileSync(log, output, { mode: 0o600 })
  } catch (error) {
    try { writeFileSync(log, Buffer.concat([Buffer.from(error.stdout ?? ''), Buffer.from(error.stderr ?? '')]), { mode: 0o600 }) }
    catch { throw new Error('account_mounted_private_phase_log_failed') }
    throw new Error('account_mounted_private_phase_failed:' + value)
  }
}
async function verifiedBrowserSession(context, owned) {
  // This is the actual cookie jar issued by the mounted login. It is read only
  // in memory, not reconstructed from a token, copied into a fixture or logged.
  const jar = new Map((await context.cookies('http://127.0.0.1:3000')).map(cookie => [cookie.name, cookie.value]))
  const client = createServerClient('http://127.0.0.1:54321', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { fetch: localFetch },
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: updates => { for (const { name, value } of updates) jar.set(name, value) } },
  })
  const user = await client.auth.getUser(), claims = await client.auth.getClaims()
  const session = claims.data?.claims.session_id
  if (user.error || claims.error || user.data.user?.id !== owned.id || user.data.user.email !== owned.email ||
      claims.data?.claims.sub !== owned.id || !uuid(session)) throw new Error('account_mounted_current_cookie_identity_unavailable')
  return session
}
function saveSession(kind, session) {
  const current = read()
  if (!uuid(session) || !['created', 'replayed'].includes(kind) || current.sessionWitnesses[kind] ||
      (kind === 'replayed' && (!current.storedGraphHash || current.sessionWitnesses.created === session))) {
    throw new Error('account_mounted_session_witness_invalid')
  }
  // SID is an evidence/provenance witness only. The product Action derives its
  // independent current session from its own real cookie client and locked SQL.
  current.sessionWitnesses[kind] = session
  writeFileSync(path, JSON.stringify(current), { mode: 0o600 })
}
const claimPath = () => '/portal/koppla-kund?bolag=' + encodeURIComponent(f.slug)
const form = page => page.locator('form').filter({ has: page.locator('input[name="personal_number"]') })
async function login(page, actor, next) {
  await page.goto('/login?next=' + encodeURIComponent(next))
  await page.getByLabel('E-post', { exact: true }).fill(actor.email)
  await page.getByLabel('Lösenord', { exact: true }).fill(process.env.GRIDEX_ACCOUNT_MOUNTED_PASSWORD)
  await page.getByRole('button', { name: 'Logga in', exact: true }).click()
  await expect(page).toHaveURL('http://127.0.0.1:3000' + next)
}
async function submitClaim(page) {
  await expect(page.getByRole('heading', { name: 'Säker koppling till Mina sidor', exact: true })).toBeVisible()
  const current = form(page)
  await expect(current).toHaveCount(1)
  await expect(current.locator('input[name="company_slug"]')).toHaveValue(f.slug)
  await expect(current.locator('input[name="email"]')).toHaveValue(f.customerActor.email)
  await current.locator('input[name="personal_number"]').fill(f.personalNumber)
  await current.locator('input[name="full_name"]').fill(f.fullName)
  await current.locator('input[name="installation_id"]').fill(f.facility)
  // Hold only this genuine ordinary Action request before forwarding it, to
  // observe the mounted React pending state. No response, commit or clock is
  // fabricated. Always release the original request even if observation fails.
  let intercepted = false, release = () => undefined
  const gate = new Promise(done => { release = done })
  const actionPath = url => url.pathname === '/portal/koppla-kund'
  const intercept = async route => {
    if (route.request().method() === 'POST') { intercepted = true; await gate }
    await route.continue()
  }
  await page.route(actionPath, intercept)
  const submit = current.getByRole('button', { name: 'Koppla konto', exact: true }).click()
  try {
    await expect.poll(() => intercepted).toBe(true)
    await expect(current.getByRole('button', { name: 'Verifierar...', exact: true })).toBeDisabled()
  } finally { release(); await submit; await page.unroute(actionPath, intercept) }
  await expect(page).toHaveURL('http://127.0.0.1:3000/portal?kopplad=1')
}
async function portalViews(page) {
  // Fresh GET qualifies actual persisted portal context/cache reads, not a
  // useActionState flag or locally invented successful response.
  await page.goto('/portal?kopplad=1')
  await expect(page.getByText('Kundkontot är kopplat. Dina fakturor, anläggningar och förbrukning visas nu här.', { exact: true })).toBeVisible()
  await expect(page.getByText(f.customerNumber, { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Välkommen, ' + f.fullName, exact: true })).toBeVisible()
  await page.goto('/portal/anlaggningar')
  await expect(page.getByRole('heading', { name: 'Mina anläggningar', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Synthetic mounted facility', exact: true })).toBeVisible()
  await expect(page.getByText(f.facility, { exact: true })).toBeVisible()
}
async function platformCard(context, needsLogin) {
  const page = await context.newPage()
  const route = '/admin/customers/' + f.customer + '?tab=portal-access'
  if (needsLogin) await login(page, f.platformActor, route)
  else await page.goto(route)
  await verifiedBrowserSession(context, f.platformActor)
  await context.addCookies([{ name: 'gridex_admin_selected_company_id', value: f.company,
    url: 'http://127.0.0.1:3000', httpOnly: true, sameSite: 'Lax' }])
  await page.goto(route)
  await expect(page.getByRole('heading', { name: 'Kundportalåtkomst', exact: true })).toBeVisible()
  // Bind the articles via their nearest card, not an ancestor containing both
  // account and claim lists. Both lists must contain the saved native email.
  const accountCard = page.getByRole('heading', { name: 'Kopplade portal-konton', exact: true }).locator('..').locator('..')
  const claimCard = page.getByRole('heading', { name: 'Senaste verifieringsförsök', exact: true }).locator('..').locator('..')
  await expect(accountCard.locator('article')).toHaveCount(1)
  await expect(accountCard).toContainText(f.customerActor.email)
  await expect(accountCard).toContainText('Roll: owner')
  await expect(accountCard).toContainText('Input namn: ' + f.fullName)
  await expect(accountCard).toContainText('Anläggning/mätpunkt: ' + f.facility)
  await expect(accountCard).toContainText('Personnummer sista 4: ' + f.personalNumber.slice(-4))
  await expect(claimCard.locator('article')).toHaveCount(1)
  await expect(claimCard).toContainText(f.customerActor.email)
  await expect(claimCard).toContainText('approved')
  for (const label of ['E-post match', 'Namn match', 'Personnummer match', 'Anläggning match']) await expect(claimCard).toContainText(label + ': Ja')
  await page.close()
}
test('actual mounted cookie/form completion persists through portal, separate OPS evidence and a new current login', async ({ browser }) => {
  const contexts = []
  try {
    const first = await browser.newContext({ baseURL: 'http://127.0.0.1:3000', serviceWorkers: 'block' }); contexts.push(first)
    await installLocalBrowserBoundary(first); const page = await first.newPage()
    await privateStage('customer_login', () => login(page, f.customerActor, claimPath()))
    await privateStage('customer_cookie_witness', async () => saveSession('created', await verifiedBrowserSession(first, f.customerActor)))
    await privateStage('claim_form', () => submitClaim(page))
    await privateStage('phase_capture-created', () => phase('capture-created'))
    await privateStage('created_views', () => portalViews(page))
    const ops = await browser.newContext({ baseURL: 'http://127.0.0.1:3000', serviceWorkers: 'block' }); contexts.push(ops)
    await installLocalBrowserBoundary(ops)
    await privateStage('platform_card', () => platformCard(ops, true))
    await privateStage('customer_logout', async () => {
      await page.getByRole('button', { name: 'Logga ut', exact: true }).click()
      await expect(page).toHaveURL('http://127.0.0.1:3000/login')
    })
    await first.close()
    const second = await browser.newContext({ baseURL: 'http://127.0.0.1:3000', serviceWorkers: 'block' }); contexts.push(second)
    await installLocalBrowserBoundary(second); const repeat = await second.newPage()
    await privateStage('new_login', () => login(repeat, f.customerActor, claimPath()))
    await privateStage('new_cookie_witness', async () => saveSession('replayed', await verifiedBrowserSession(second, f.customerActor)))
    await privateStage('claim_form', () => submitClaim(repeat))
    await privateStage('phase_capture-replayed', () => phase('capture-replayed'))
    await privateStage('replay_views', () => portalViews(repeat))
    // This reuses the reader's actual existing login via a fresh page GET,
    // rather than treating a new admin login as the customer replay authority.
    await privateStage('platform_card', () => platformCard(ops, false))
    console.log('ACCOUNT_MOUNTED_BROWSER_PASS mounted_form=true fresh_portal=true separate_saved_card=true new_login_repeat=true')
  } finally {
    for (const context of contexts) await context.close()
  }
})
