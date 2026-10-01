import { createRequire } from 'node:module'
import { test, expect } from '@playwright/test'
const fixture = createRequire(import.meta.url)('../../scripts/support-attachment-next-denial-20261001.fixture.ts')
const { API, attachmentSnapshot, financeSnapshot, identitySnapshot, lateExpiryHook, localStatus, publicSnapshot,
  quote, readFixture, saveFixture, service, sha, sql, verifiedBrowserSession } = fixture

const enabled = process.env.GRIDEX_SUPPORT_NEXT_BROWSER === '1'
test.skip(!enabled, 'Requires its independent disposable GoTrue/Storage/native seed and isolated Next configuration.')
const f = enabled ? readFixture() : null
test.describe.configure({ mode: 'serial', retries: 0 })
test.use({ trace: 'off', screenshot: 'off', video: 'off' })
test.setTimeout(240_000)
const checks = [], sessions = []
const path = attachment => `/api/internal/customer-support/attachments/${attachment.id}/download`
async function login(browser, actor) {
  const context = await browser.newContext(), page = await context.newPage()
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort()
  })
  try {
    await page.goto('/login?next=%2F')
    await expect(page.getByRole('button', { name: 'Logga in', exact: true })).toBeVisible()
    await page.getByLabel('E-post', { exact: true }).fill(actor.email)
    await page.getByLabel('Lösenord', { exact: true }).fill(f.password)
    await page.getByRole('button', { name: 'Logga in', exact: true }).click()
    await page.waitForURL(url => url.pathname === '/')
  } catch { await context.close(); throw new Error('attachment_journey_actual_next_login_failed') }
  await context.addCookies([{ name: 'gridex_admin_selected_company_id', value: actor.company, url: 'http://127.0.0.1:3000', sameSite: 'Lax' }])
  const verified = await verifiedBrowserSession(await context.cookies(), actor)
  expect(f.baselineSessions.includes(verified.sessionId)).toBe(false)
  sessions.push({ userId: actor.id, sessionId: verified.sessionId })
  let downloads = 0
  page.on('download', () => { downloads++ })
  return { context, page, verified, noDownloads: () => expect(downloads).toBe(0) }
}
async function http(page, attachment, method, customerId = f.customer, nonceId = null, extraHeaders = {}) {
  return page.evaluate(async ({ url, method, customerId, nonceId, extraHeaders }) => {
    const response = await fetch(method === 'POST' ? url : `${url}?customerId=${customerId}`, {
      method, credentials: 'same-origin', headers: { ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
        ...(nonceId ? { 'x-gridex-support-read-nonce': nonceId } : {}), ...extraHeaders },
      ...(method === 'POST' ? { body: JSON.stringify({ customerId }) } : {}),
    })
    return { status: response.status, headers: Object.fromEntries(response.headers), text: await response.text() }
  }, { url: path(attachment), method, customerId, nonceId, extraHeaders })
}
function safe(response, status) {
  expect(response.status).toBe(status)
  expect(response.headers['content-type']).toMatch(/^application\/json/)
  expect(response.headers['cache-control']).toContain('no-store')
  expect(response.headers['x-content-type-options']).toBe('nosniff')
  expect(response.headers['x-frame-options']).toBe('DENY')
  expect(response.headers['content-security-policy']).toContain("default-src 'none'")
  expect(response.headers['content-disposition']).toBeUndefined()
  expect(response.headers.location).toBeUndefined()
  for (const attachment of [f.signed, f.defaultAttachment, f.quietAttachment]) {
    expect(response.text.includes(attachment.bytes)).toBe(false)
    expect(response.text.includes(attachment.objectKey)).toBe(false)
  }
  const body = JSON.parse(response.text)
  expect(Object.hasOwn(body, 'bytes') || Object.hasOwn(body, 'url') || Object.hasOwn(body, 'downloadUrl')).toBe(false)
  expect(body.releaseAllowed === true).toBe(false)
  return body
}
async function transport(request, route, secret, body) {
  try {
    const response = await request.post('/api/internal/customer-support/scanner/' + route, {
      headers: { authorization: 'Bearer ' + secret, 'content-type': 'application/json' }, data: body,
    })
    return { status: response.status(), headers: response.headers(), text: await response.text() }
  } catch { throw new Error('attachment_journey_actual_next_transport_failed') }
}
async function prepare(page, attachment = f.signed) {
  const before = Math.floor(Date.now() / 1000), response = await http(page, attachment, 'POST'), body = safe(response, 201)
  expect(body.releaseAllowed).toBe(false)
  expect(body.nonceId).toMatch(/^[0-9a-f-]{36}$/)
  expect(body.expiresAt).toBeGreaterThan(before)
  expect(body.expiresAt).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 60)
  return body.nonceId
}
function nonceSnapshot(nonce) { return sql(`select to_jsonb(t) from private.support_attachment_read_nonces t where nonce_id=${quote(nonce)};`) }

test('T36/P7 actual Next cookie, current tenant/session/nonce and physical Storage deny every unqualified download', async ({ browser }) => {
  const contexts = []
  try {
    const anonymous = await browser.newContext(), anonymousPage = await anonymous.newPage(); contexts.push(anonymous)
    await anonymousPage.goto('/login')
    safe(await http(anonymousPage, f.signed, 'GET', f.customer, '00000000-0000-4000-8000-000000000001'), 401)
    safe(await http(anonymousPage, f.signed, 'POST'), 401)
    checks.push('anonymous_current_cookie_denial')

    // This is an actual Next route request, not direct handler execution. Only
    // the locally generated signature/root is synthetic; qualification is absent.
    const callbackBody = { nonceId: f.signedNonce, token: f.signedToken }
    const priorReceiptCount = sql(`select count(*)::int from private.support_attachment_scan_receipts where company_id=${quote(f.company)};`)
    expect(priorReceiptCount).toBe(0)
    safe(await transport(anonymous.request, 'verdict', 'é'.repeat(32), callbackBody), 401)
    safe(await transport(anonymous.request, 'verdict', f.callbackSecret + 'x', callbackBody), 401)
    expect(sql(`select count(*)::int from private.support_attachment_scan_receipts where company_id=${quote(f.company)};`)).toBe(0)
    checks.push('authenticated_transport_multibyte_safe_denial')
    const accepted = safe(await transport(anonymous.request, 'verdict', f.callbackSecret, callbackBody), 202)
    expect(accepted).toEqual({ accepted: true, replayed: false, outcome: 'blocked_scanner_qualification', releaseAllowed: false })
    const replayed = safe(await transport(anonymous.request, 'verdict', f.callbackSecret, callbackBody), 202)
    expect(replayed).toMatchObject({ replayed: true, releaseAllowed: false })
    expect(sql(`select count(*)::int from private.support_attachment_scan_receipts where company_id=${quote(f.company)};`)).toBe(1)
    checks.push('synthetic_signed_callback_replay_one_private_receipt_no_release')
    const processed = safe(await transport(anonymous.request, 'process', f.processSecret, { companyId: f.company, limit: 1 }), 202)
    expect(processed).toMatchObject({ result: { claimed: 1, blocked: 1, evidenceRecorded: 0, errors: 0 }, releaseAllowed: false })
    expect(sql(`select to_jsonb(status) from private.support_attachment_scan_jobs where company_id=${quote(f.company)}
      and attachment_id=${quote(f.defaultAttachment.id)};`)).toBe('blocked_scanner_qualification')
    sql(`update private.support_attachment_scanner_roots set status='revoked' where company_id=${quote(f.company)};select to_jsonb(true);`)
    safe(await transport(anonymous.request, 'verdict', f.callbackSecret, callbackBody), 403)
    expect(sql(`select count(*)::int from private.support_attachment_scan_receipts where company_id=${quote(f.company)};`)).toBe(1)
    checks.push('default_adapter_absent_and_current_scanner_revocation')

    const writer = await login(browser, f.writer); contexts.push(writer.context)
    expect(writer.verified.permissions).toContain('cases.read')
    expect(writer.verified.permissions).toContain('cases.write')
    const nonce = await prepare(writer.page)
    const pendingCapability = nonceSnapshot(nonce)
    expect(pendingCapability.consumed_at).toBeNull()
    const second = await login(browser, f.writer); contexts.push(second.context)
    expect(second.verified.sessionId).not.toBe(writer.verified.sessionId)
    safe(await http(second.page, f.signed, 'GET', f.customer, nonce), 403)
    expect(nonceSnapshot(nonce)).toEqual(pendingCapability)
    const decision = safe(await http(writer.page, f.signed, 'GET', f.customer, nonce), 423)
    expect(decision).toEqual({ releaseAllowed: false, outcome: 'blocked_scanner_qualification', physicalHashVerified: true })
    safe(await http(writer.page, f.signed, 'GET', f.customer, nonce), 403)
    checks.push('actual_next_gotrue_session_physical_inspection_oneuse_no_bytes')

    safe(await http(writer.page, f.signed, 'POST', f.sibling), 404)
    const crossSite = await writer.context.request.post(path(f.signed), { headers: { origin: 'https://synthetic-foreign.example.invalid',
      'sec-fetch-site': 'cross-site' }, data: { customerId: f.customer } })
    safe({ status: crossSite.status(), headers: crossSite.headers(), text: await crossSite.text() }, 403)
    checks.push('exact_resource_session_and_crosssite_binding')

    const reader = await login(browser, f.reader); contexts.push(reader.context)
    expect(reader.verified.permissions).toContain('cases.read')
    expect(reader.verified.permissions).not.toContain('cases.write')
    const readerNonce = await prepare(reader.page)
    expect(safe(await http(reader.page, f.signed, 'GET', f.customer, readerNonce), 423)).toMatchObject({ releaseAllowed: false, physicalHashVerified: true })
    const denied = await login(browser, f.denied); contexts.push(denied.context)
    expect(denied.verified.permissions).not.toContain('cases.read')
    safe(await http(denied.page, f.signed, 'POST'), 403)
    checks.push('current_cases_read_only_and_missing_permission_denials')

    const foreign = await login(browser, f.foreign); contexts.push(foreign.context)
    safe(await http(foreign.page, f.signed, 'POST'), 403)
    await foreign.context.addCookies([{ name: 'gridex_admin_selected_company_id', value: f.company, url: 'http://127.0.0.1:3000', sameSite: 'Lax' }])
    safe(await http(foreign.page, f.signed, 'POST'), 403)
    checks.push('foreign_current_member_and_selected_company_forgery_denied')

    const lateNonce = await prepare(writer.page), priorNonce = nonceSnapshot(lateNonce)
    const priorSession = sql(`select to_jsonb(t) from auth.sessions t where id=${quote(writer.verified.sessionId)};`)
    const hook = lateExpiryHook(lateNonce, f.writer, writer.verified.sessionId)
    try {
      safe(await http(writer.page, f.signed, 'GET', f.customer, lateNonce), 403)
      expect(hook.reached()).toEqual({ called: true, calls: 1 })
      expect(nonceSnapshot(lateNonce)).toEqual(priorNonce)
      expect(sql(`select to_jsonb(t) from auth.sessions t where id=${quote(writer.verified.sessionId)};`)).toEqual(priorSession)
    } finally { hook.cleanup() }
    checks.push('actual_postphysical_final_clock_hook_rolls_nonce_session_back')

    const expiredNonce = await prepare(writer.page)
    const expiredBefore = nonceSnapshot(expiredNonce), expiresAt = expiredBefore.expires_at
    const memberNonce = await prepare(reader.page), memberBefore = nonceSnapshot(memberNonce)
    sql(`update public.company_memberships set is_active=false where company_id=${quote(f.company)} and user_id=${quote(f.reader.id)};select to_jsonb(true);`)
    safe(await http(reader.page, f.signed, 'GET', f.customer, memberNonce), 403)
    expect(nonceSnapshot(memberNonce)).toEqual(memberBefore)
    // Observe the actual immutable 60-second nonce clock. Do not rewrite its
    // issued/expiry fields or bypass the identity trigger to manufacture expiry.
    while (Date.now() < (expiresAt + 1) * 1000) await new Promise(done => setTimeout(done, Math.min(1000, (expiresAt + 1) * 1000 - Date.now())))
    safe(await http(writer.page, f.signed, 'GET', f.customer, expiredNonce), 403)
    expect(nonceSnapshot(expiredNonce)).toEqual(expiredBefore)
    checks.push('current_nonce_ttl_and_member_revocation_after_capture')

    const revokeNonce = await prepare(writer.page), revokeBefore = nonceSnapshot(revokeNonce)
    const loggedOut = await writer.verified.client.auth.signOut({ scope: 'local' })
    expect(loggedOut.error).toBeNull()
    expect(sql(`select to_jsonb(not exists(select 1 from auth.sessions where id=${quote(writer.verified.sessionId)}));`)).toBe(true)
    // Keep the actual captured browser cookie and capability; the server must
    // consult current GoTrue/session state rather than trusting that capture.
    const afterRevoke = await http(writer.page, f.signed, 'GET', f.customer, revokeNonce)
    expect([401, 403]).toContain(afterRevoke.status)
    safe(afterRevoke, afterRevoke.status)
    expect(nonceSnapshot(revokeNonce)).toEqual(revokeBefore)
    checks.push('actual_gotrue_logout_denies_captured_cookie_capability')

    const anon = service(), anonKey = localStatus().ANON_KEY
    for (const attachment of [f.signed, f.defaultAttachment, f.quietAttachment]) {
      const bytes = await anon.storage.from('customer-support-quarantine').download(attachment.objectKey)
      expect(bytes.error).toBeNull(); expect(sha(new Uint8Array(await bytes.data.arrayBuffer()))).toBe(attachment.sha256)
      const publicObject = await fetch(`${API}/storage/v1/object/customer-support-quarantine/${attachment.objectKey}`, { headers: { apikey: anonKey } })
      expect([400, 401, 403, 404]).toContain(publicObject.status)
      expect((await publicObject.text()).includes(attachment.bytes)).toBe(false)
      const authenticated = await second.verified.client.storage.from('customer-support-quarantine').download(attachment.objectKey)
      expect(authenticated.error).not.toBeNull()
    }
    expect(financeSnapshot()).toEqual(f.finance)
    expect(attachmentSnapshot(f.company)).toBe(f.attachments)
    expect(publicSnapshot(f.company)).toBe(f.publicOwn)
    expect(publicSnapshot(f.quietCompany)).toBe(f.quiet)
    expect(identitySnapshot()).toBe(f.identities)
    for (const session of [writer, second, reader, denied, foreign]) session.noDownloads()
    checks.push('actual_private_storage_full_financial_identity_and_quiet_baseline')
    expect(checks).toHaveLength(12)
    f.completed = { checks, sessions, revokedSession: writer.verified.sessionId, revokedMember: f.reader.id }
    saveFixture(f)
    console.log('SUPPORT_NEXT_DENIAL_REAL_BROWSER_PASS checks=12 actualNextLogin=true verifiedGoTrueSessions=5 physicalStorage=true lateHookObserved=true bytesReturned=0 releaseAllowed=false independentNativePostcheckRequired=true')
  } finally { await Promise.allSettled(contexts.map(context => context.close())) }
})
