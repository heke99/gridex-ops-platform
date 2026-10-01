import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { test, expect } from '@playwright/test'
import { agreementPrivateRequest } from './grid-owner-agreement-private-request-20261001.mjs'
const requested = process.env.GRIDEX_AGREEMENT_RUNTIME_LOCAL_E2E === '1'
const secretBytes = Buffer.byteLength(process.env.GRIDEX_AGREEMENT_CLEANUP_SECRET ?? '')
const enabled = requested && process.env.CI === 'true' && process.env.NEXT_PUBLIC_SUPABASE_URL === 'http://127.0.0.1:54321'
  && !process.env.GRIDEX_E2E_BROWSER_BASE_URL && secretBytes >= 32 && secretBytes <= 256
  && Boolean(process.env.GRIDEX_AGREEMENT_RUNTIME_PASSWORD && process.env.GRIDEX_AGREEMENT_RUNTIME_FIXTURE_PATH)
if (requested && !enabled) throw new Error('agreement_runtime_browser_disposable_only')
if (enabled && ['RESEND_API_KEY', 'SENDGRID_API_KEY', 'EDIEL_SMTP_PASS', 'EDIEL_SMTP_PASSWORD'].some(key => Boolean(process.env[key]?.trim()))) throw new Error('agreement_runtime_provider_credentials_forbidden')
const fixturePath = enabled ? resolve(process.env.GRIDEX_AGREEMENT_RUNTIME_FIXTURE_PATH) : null
if (enabled && (!process.env.RUNNER_TEMP || !fixturePath.startsWith(resolve(process.env.RUNNER_TEMP) + sep))) throw new Error('agreement_runtime_browser_private_fixture_required')
const f = enabled ? JSON.parse(readFileSync(fixturePath, 'utf8')) : null
const pdf = Buffer.from('%PDF-1.4\n% Synthetic owned agreement runtime fixture, never a customer document.\n%%EOF\n')
const sha = createHash('sha256').update(pdf).digest('hex'), routePath = '/admin/agreements/grid-owners'
test.skip(!enabled, 'Requires isolated real GoTrue/Storage/Next agreement fixture.')
test.describe.configure({ mode: 'serial', retries: 0 })
// Auth/Storage capabilities and signed URLs must not enter a Playwright trace.
test.use({ trace: 'off', video: 'off' })
// If a future immutable scheduling guard refuses fixture time changes, retain
// that guard and allow the actual 15m/2m/1h TTLs rather than fabricate outcomes.
test.setTimeout(90 * 60_000)
function phase(value) {
  const log = fixturePath + '.' + value + '.private.log'
  try {
    const output = execFileSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'scripts/grid-owner-agreement-runtime-20261001.native.config.ts'], {
      env: { ...process.env, GRIDEX_AGREEMENT_RUNTIME_PHASE: value }, timeout: 66 * 60_000, stdio: 'pipe',
    })
    writeFileSync(log, output, { mode: 0o600 })
  } catch (error) {
    writeFileSync(log, Buffer.concat([Buffer.from(error.stdout ?? ''), Buffer.from(error.stderr ?? '')]), { mode: 0o600 })
    throw new Error('agreement_runtime_private_phase_failed:' + value)
  }
}
async function cleanupHttp(request, expectedClaimed) {
  await agreementPrivateRequest(async () => {
    const response = await request.post('http://127.0.0.1:3000/api/internal/grid-owner-agreements/cleanup', {
      headers: { Authorization: 'Bearer ' + process.env.GRIDEX_AGREEMENT_CLEANUP_SECRET }, data: { companyId: f.company, limit: 1 }, maxRedirects: 0,
    })
    expect(response.status()).toBe(202)
    expect(await response.json()).toEqual({ result: { claimed: expectedClaimed, removed: expectedClaimed, retried: 0, stale: 0, errors: 0 } })
  })
}
const agreementPreconditionSnapshots = []
async function agreementCompanySelectionPrecondition(page, form, response, testInfo, phase) {
  if (!['before_action', 'after_selection_failure'].includes(phase) || agreementPreconditionSnapshots.length >= 2) {
    throw new Error('agreement_runtime_precondition_failed:diagnostic_phase')
  }
  const snapshot = { phase, status: null, expectedLoopbackRoute: false,
    headingCount: null, formCount: null, companySelectCount: null, fixtureOptionCount: null, observationStage: null }
  const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 100_000 ? value : null
  let captureStage = 'http_status'
  let captureFailed = false
  try {
    const status = response?.status()
    snapshot.status = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null
    captureStage = 'expected_route'
    const url = new URL(page.url())
    snapshot.expectedLoopbackRoute = url.origin === 'http://127.0.0.1:3000' && url.pathname === routePath && !url.search && !url.hash && !url.username && !url.password
    captureStage = 'heading'
    snapshot.headingCount = count(await page.getByRole('heading', { name: 'Nätägaravtal', exact: true }).count())
    captureStage = 'form'
    snapshot.formCount = count(await form.count())
    captureStage = 'company_select'
    const select = form.locator('select[name="company_id"]')
    snapshot.companySelectCount = count(await select.count())
    captureStage = 'fixture_option'
    snapshot.fixtureOptionCount = count(await select.locator('option').evaluateAll((options, company) => options.filter(option => option.value === company).length, f.company))
  } catch { snapshot.observationStage = captureStage; captureFailed = true }
  if (!snapshot.observationStage) snapshot.observationStage = snapshot.status !== 200 ? 'http_status' : !snapshot.expectedLoopbackRoute ? 'expected_route'
    : snapshot.headingCount !== 1 ? 'heading' : snapshot.formCount !== 1 ? 'form' : snapshot.companySelectCount !== 1 ? 'company_select'
      : snapshot.fixtureOptionCount !== 1 ? 'fixture_option' : null
  agreementPreconditionSnapshots.push(snapshot)
  const receipt = { stage: 'agreement_company_selection_precondition', snapshots: agreementPreconditionSnapshots }
  // Initial missing counts are observations, not a readiness gate. Preserve
  // the exact original selection auto-wait. A real failure gets a second snapshot.
  // Raw page/URL/body/Auth/errors never enter the root-whitelisted safe file.
  console.log('AGREEMENT_RUNTIME_BROWSER_PRECONDITION ' + JSON.stringify(receipt))
  let output
  try {
    output = testInfo.outputPath('sanitized-agreement-runtime-precondition.json')
    writeFileSync(output, JSON.stringify(receipt) + '\n', { mode: 0o600 })
  } catch { throw new Error('agreement_runtime_precondition_failed:receipt_write') }
  try { await testInfo.attach('sanitized-agreement-runtime-precondition', { path: output, contentType: 'application/json' }) }
  catch { throw new Error('agreement_runtime_precondition_failed:receipt_attach') }
  if (captureFailed) throw new Error('agreement_runtime_precondition_failed:capture_' + captureStage)
}
test('actual mounted upload, protected local bytes and archive remain saved while durable crash cleanup settles only unattached keys', async ({ page, context }, testInfo) => {
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !['3000', '54321'].includes(url.port)) return route.abort()
    return route.continue()
  })
  await page.goto('/login')
  await page.getByLabel('E-post').fill(f.actor.email)
  await page.getByLabel('Lösenord').fill(process.env.GRIDEX_AGREEMENT_RUNTIME_PASSWORD)
  await page.getByRole('button', { name: 'Logga in', exact: true }).click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'))
  await context.addCookies([{ name: 'gridex_admin_selected_company_id', value: f.company, url: 'http://127.0.0.1:3000', sameSite: 'Lax' }])
  const agreementPageResponse = await page.goto(routePath)
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Spara nätägaravtal', exact: true }) })
  await agreementCompanySelectionPrecondition(page, form, agreementPageResponse, testInfo, 'before_action')
  try {
    await form.locator('select[name="company_id"]').selectOption(f.company)
  } catch (selectionError) {
    await agreementCompanySelectionPrecondition(page, form, agreementPageResponse, testInfo, 'after_selection_failure')
    throw selectionError
  }
  await form.locator('select[name="grid_owner_id"]').selectOption(f.owner)
  await form.locator('input[name="agreement_reference"]').fill(f.tag)
  await form.locator('input[name="document_file"]').setInputFiles({ name: 'owned.pdf', mimeType: 'application/pdf', buffer: pdf })
  await form.getByRole('button', { name: 'Spara nätägaravtal', exact: true }).click()
  const row = page.locator('tr').filter({ hasText: f.tag })
  await expect(row).toHaveCount(1)
  await expect(row.getByRole('link', { name: 'Öppna dokument', exact: true })).toHaveCount(1)
  phase('capture-mounted')
  const href = await row.getByRole('link', { name: 'Öppna dokument', exact: true }).getAttribute('href')
  expect(href).toMatch(/^\/admin\/agreements\/grid-owners\/documents\?path=/)
  await agreementPrivateRequest(async () => {
    const protectedResponse = await context.request.get('http://127.0.0.1:3000' + href, { maxRedirects: 0 })
    expect(protectedResponse.status()).toBe(307)
    const signed = new URL(protectedResponse.headers().location)
    expect(signed.hostname).toBe('127.0.0.1'); expect(signed.port).toBe('54321')
    expect(signed.pathname).toMatch(/^\/storage\/v1\/object\/sign\/grid-owner-agreements\//)
    const bytes = await context.request.get(signed.href, { maxRedirects: 0 })
    expect(bytes.status()).toBe(200)
    expect(createHash('sha256').update(await bytes.body()).digest('hex')).toBe(sha)
  })
  await row.getByRole('button', { name: 'Arkivera', exact: true }).click()
  await expect(row).toContainText('archived')
  phase('prepare-orphans')
  await cleanupHttp(context.request, 0) // live crashed lease and fresh uncertain intent are preserved
  phase('expire-crash-lease')
  await cleanupHttp(context.request, 1)
  phase('verify-cleaned')
  phase('prepare-settlement') // a controlled late local upload + owned scheduling clock only
  await cleanupHttp(context.request, 1)
  phase('post-browser')
  await testInfo.attach('sanitized-agreement-runtime-receipt', { body: JSON.stringify({ mountedUpload: true, storedRevision1: true,
    protectedLocalDownloadSha256: sha, archivedRevision2: true, crashedLeasePreserved: true, durableCleanup: true,
    periodicSettlement: true, attachedAndUnselectedPreparedPreserved: true, explicitCompanyBatchLimit: 1,
    metadataEditForm: 'OPEN', nativePostchecks: true }), contentType: 'application/json' })
})
