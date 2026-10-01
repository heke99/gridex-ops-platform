import { test, expect } from '@playwright/test'
import { localProofEnabled, localProofFixture, localProofSql, proofQuote, proofGet, proofPost, proofActionHeaders, revokeReadProof, refreshProofAssertions } from '../helpers/customer-api-proof.mjs'
const enabled = localProofEnabled('GRIDEX_SUPPORT_HTTP_LOCAL_E2E', 'GRIDEX_SUPPORT_HTTP_FIXTURE_PATH')
test.skip(!enabled, 'Requires disposable migrated support commands and signed Auth fixtures.')
test.describe.configure({ mode: 'serial', retries: 0 })
test.use({ trace: 'off', video: 'off', screenshot: 'off' })
const f = enabled ? localProofFixture('GRIDEX_SUPPORT_HTTP_FIXTURE_PATH') : null
const path = '/api/v1/customer/cases'
const post = async (request, c, route, data, key) => proofPost(request, route,
  { headers: { ...await proofActionHeaders(f, c, 'POST', route), 'idempotency-key': key }, data })
const get = async (request, c, route, query = '') => proofGet(request, `${route}${query}`, { headers: await proofActionHeaders(f, c, 'GET', route) })
function opsCommand(c, actor, caseId, operation, revision, key, body, channel = 'ops') {
  return { companyId: c.companyId, customerId: c.customerId, mode: 'ops', channel, actorUserId: actor.userId,
    sessionId: actor.sessionId, clientId: null, subject: null, operation, caseId, caseReference: null,
    expectedRevision: revision, idempotencyKey: key, payload: { body } }
}
test('actual support HTTP creates, retries, continues with OPS and exposes only customer messages across isolated customers', async ({ request }) => {
  test.setTimeout(120_000)
  await refreshProofAssertions(f, path)
  const [a1, a2, b1] = f.customers, references = []
  for (const c of f.customers) {
    const created = await post(request, c, path, { title: `Synthetic case ${c.tag}`, body: `Customer initial ${c.tag}` }, `http-support-create-${c.tag}`)
    expect(created.status()).toBe(201)
    const body = await created.json()
    expect(Object.keys(body.data).sort()).toEqual(['case_reference', 'revision', 'status', 'replayed'].sort())
    expect(body.data).toMatchObject({ revision: 1, status: 'open', replayed: false })
    expect(body.data.case_reference).toMatch(/^case_[A-Za-z0-9_-]{32}$/)
    references.push(body.data.case_reference)
    const list = await get(request, c, path)
    expect(list.status()).toBe(200)
    const rows = (await list.json()).data
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ case_reference: body.data.case_reference, title: `Synthetic case ${c.tag}`, revision: 1 })
    expect(Object.keys(rows[0]).sort()).toEqual(['case_reference', 'title', 'status', 'revision', 'created_at', 'updated_at'].sort())
  }
  const repeated = await Promise.all([post(request, a1, path, { title: 'Synthetic case A1', body: 'Customer initial A1' }, 'http-support-create-A1'),
    post(request, a1, path, { title: 'Synthetic case A1', body: 'Customer initial A1' }, 'http-support-create-A1')])
  for (const response of repeated) {
    expect(response.status()).toBe(201)
    expect((await response.json()).data).toMatchObject({ case_reference: references[0], revision: 1, replayed: true })
  }
  const conflict = await post(request, a1, path, { title: 'Synthetic case A1', body: 'Changed payload' }, 'http-support-create-A1')
  expect(conflict.status()).toBe(409)
  expect((await conflict.json()).error.code).toBe('support_idempotency_conflict')
  const second = await post(request, a1, path, { title: 'Synthetic second A1', body: 'Customer second case A1' }, 'http-support-second-A1')
  expect(second.status()).toBe(201)
  const list = await get(request, a1, path, '?limit=1')
  expect(list.status()).toBe(200)
  const firstPage = await list.json()
  expect(firstPage.page).toMatchObject({ returned: 1, has_more: true })
  const nextPageResponse = await get(request, a1, path, `?limit=1&cursor=${encodeURIComponent(firstPage.page.next_cursor)}`)
  expect(nextPageResponse.status()).toBe(200)
  const nextPage = await nextPageResponse.json()
  expect(nextPage.data).toHaveLength(1)
  expect(nextPage.page.has_more).toBe(false)
  expect(nextPage.data[0].case_reference).toBe(references[0])
  const cursorReplay = await get(request, a1, path, `?limit=1&cursor=${encodeURIComponent(firstPage.page.next_cursor)}`)
  expect(cursorReplay.status()).toBe(200)
  expect((await cursorReplay.json()).data).toEqual(nextPage.data)
  for (const c of [a2, b1]) {
    const foreignCursor = await get(request, c, path, `?cursor=${encodeURIComponent(firstPage.page.next_cursor)}`)
    expect(foreignCursor.status()).toBe(400)
    expect((await foreignCursor.json()).error.code).toBe('invalid_cursor')
    const foreign = await get(request, c, `${path}/${references[0]}/messages`)
    expect(foreign.status()).toBe(404)
    expect((await foreign.json()).error.code).toBe('resource_not_found')
  }
  const messagesPath = `${path}/${references[0]}/messages`
  const ownMessage = await post(request, a1, messagesPath, { body: 'Customer continuation A1', expected_revision: 1 }, 'http-support-message-A1')
  expect(ownMessage.status()).toBe(201)
  expect((await ownMessage.json()).data).toMatchObject({ revision: 2, status: 'open', replayed: false })
  const messageReplay = await post(request, a1, messagesPath, { body: 'Customer continuation A1', expected_revision: 1 }, 'http-support-message-A1')
  expect(messageReplay.status()).toBe(201)
  expect((await messageReplay.json()).data.replayed).toBe(true)
  const stale = await post(request, a1, messagesPath, { body: 'Stale message', expected_revision: 1 }, 'http-support-stale-A1')
  expect(stale.status()).toBe(409)
  expect((await stale.json()).error.code).toBe('support_revision_conflict')
  const caseId = localProofSql(`SELECT to_jsonb(id) FROM public.customer_support_threads WHERE company_id=${proofQuote(a1.companyId)}
    AND customer_id=${proofQuote(a1.customerId)} AND public_reference=${proofQuote(references[0])};`)
  for (const [operation, revision, text] of [['internal_note', 2, 'INTERNAL SECRET SUPPORT NOTE'], ['customer_message', 3, 'Staff answer on same case']]) {
    const result = localProofSql(`SET ROLE service_role; SELECT public.gridex_support_case_command_v1(${proofQuote(JSON.stringify(
      opsCommand(a1, f.staff, caseId, operation, revision, `http-support-ops-${operation}`, text, operation === 'internal_note' ? 'phone' : 'ops')))}::jsonb);`)
    expect(result).toMatchObject({ caseId, revision: revision + 1, replayed: false })
  }
  const readerDenied = localProofSql(`BEGIN; CREATE TEMP TABLE support_http_reader_result(denied boolean);
    SET LOCAL ROLE service_role; DO $proof$ BEGIN BEGIN
      PERFORM public.gridex_support_case_command_v1(${proofQuote(JSON.stringify(opsCommand(a1, f.reader, caseId, 'internal_note', 4, 'http-support-reader-denied', 'Denied reader text')))}::jsonb);
      RAISE EXCEPTION 'expected_readonly_denial'; EXCEPTION WHEN insufficient_privilege THEN
      IF SQLERRM<>'support_actor_forbidden' THEN RAISE; END IF; END; END $proof$;
    RESET ROLE; SELECT to_jsonb(true); ROLLBACK;`)
  expect(readerDenied).toBe(true)
  const messages = [], cursors = []
  let cursor = null
  do {
    const response = await get(request, a1, messagesPath, `?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
    expect(response.status()).toBe(200)
    const body = await response.json()
    for (const row of body.data) expect(Object.keys(row).sort()).toEqual(['message_reference', 'body', 'author_kind', 'author_reference', 'channel', 'revision', 'created_at'].sort())
    messages.push(...body.data)
    cursor = body.page.next_cursor
    if (cursor) cursors.push(cursor)
    expect(messages.length).toBeLessThanOrEqual(3)
  } while (cursor)
  expect(messages.map(row => row.body)).toEqual(['Staff answer on same case', 'Customer continuation A1', 'Customer initial A1'])
  expect(messages[0]).toMatchObject({ author_kind: 'staff', channel: 'ops', revision: 4 })
  expect(messages[0].author_reference).toMatch(/^support_staff_[A-Za-z0-9_-]{32}$/)
  expect(messages.slice(1).map(row => row.author_reference)).toEqual([null, null])
  expect(JSON.stringify(messages)).not.toMatch(/INTERNAL SECRET|actor_user_id|api_client_id|customer_id|company_id|metadata/)
  const reread = await get(request, a1, path)
  expect(reread.status()).toBe(200)
  expect((await reread.json()).data.find(row => row.case_reference === references[0]).revision).toBe(4)
  const messageCursorInList = await get(request, a1, path, `?cursor=${encodeURIComponent(cursors[0])}`)
  expect(messageCursorInList.status()).toBe(400)
  console.log('SUPPORT_HTTP_NATIVE_PASS customers=3 cases=4 api_create=true same_case_ops=true public_reply=true internal_phone_note_unverified=true internal_notes_private=true readonly_denied=true cursor_replay=true conflicts=true')
})

async function browserLogin(page, actor, next) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`)
  await page.getByLabel('E-post').fill(actor.email)
  await page.getByLabel('Lösenord').fill(actor.password)
  await page.getByRole('button', { name: 'Logga in', exact: true }).click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'))
}
function formWithButton(page, label) {
  return page.locator('form').filter({ has: page.getByRole('button', { name: label, exact: true }) })
}

test('interactive portal and OPS continue one case after a lost committed response, preserving privacy and read-only rights after reload', async ({ browser }, testInfo) => {
  test.setTimeout(180_000)
  const ui = f.ui
  const ownerContext = await browser.newContext({ baseURL: 'http://127.0.0.1:3000', viewport: { width: 1280, height: 900 } }), staffContext = await browser.newContext({ baseURL: 'http://127.0.0.1:3000', viewport: { width: 1280, height: 900 } }), viewerContext = await browser.newContext({ baseURL: 'http://127.0.0.1:3000', viewport: { width: 1280, height: 900 } }), readerContext = await browser.newContext({ baseURL: 'http://127.0.0.1:3000', viewport: { width: 1280, height: 900 } })
  try {
    const portal = await ownerContext.newPage()
    await browserLogin(portal, ui.owner, '/portal/arenden')
    await expect(portal.getByRole('heading', { name: 'Mina ärenden', exact: true })).toBeVisible()
    const create = formWithButton(portal, 'Skicka ärende')
    await create.getByLabel('Rubrik', { exact: true }).fill('Synthetic interactive same case')
    await create.getByLabel('Meddelande', { exact: true }).fill('Draft to cancel')
    await create.getByRole('button', { name: 'Avbryt', exact: true }).click()
    await expect(create.getByLabel('Rubrik', { exact: true })).toHaveValue('')
    await expect(create.getByLabel('Meddelande', { exact: true })).toHaveValue('')
    await create.getByLabel('Rubrik', { exact: true }).fill('Synthetic interactive same case')
    await create.getByLabel('Meddelande', { exact: true }).fill('Portal browser initial message')
    const requestKey = await create.locator('input[name="idempotency_key"]').inputValue()
    let lostCommittedResponse = false
    await portal.route('**/portal/arenden**', async route => {
      if (!lostCommittedResponse && route.request().method() === 'POST' && route.request().headers()['next-action']) {
        lostCommittedResponse = true
        try {
          const response = await route.fetch()
          if (!response.ok()) throw new Error('support_ui_commit_response_failed')
        } catch { throw new Error('support_ui_commit_probe_failed') }
        await route.abort('failed')
      } else await route.continue()
    })
    await create.getByRole('button', { name: 'Skicka ärende', exact: true }).click()
    await expect(create.getByRole('alert')).toContainText('Svaret kunde inte bekräftas')
    expect(lostCommittedResponse).toBe(true)
    await expect(create.getByLabel('Meddelande', { exact: true })).toHaveValue('Portal browser initial message')
    await expect(create.locator('input[name="idempotency_key"]')).toHaveValue(requestKey)
    const committed = localProofSql(`SELECT jsonb_build_object('count',count(*),'id',min(id::text)) FROM public.customer_cases
      WHERE company_id=${proofQuote(ui.companyId)} AND customer_id=${proofQuote(ui.customerId)} AND title='Synthetic interactive same case';`)
    expect(committed.count).toBe(1)
    await create.getByRole('button', { name: 'Skicka ärende', exact: true }).click()
    await expect(create.getByRole('status')).toContainText('Ditt ärende är sparat. Revision 1')
    await portal.unroute('**/portal/arenden**')
    await portal.reload()
    const card = portal.locator('article').filter({ has: portal.getByRole('heading', { name: 'Synthetic interactive same case', exact: true }) })
    await card.getByRole('link', { name: 'Läs och fortsätt ärendet', exact: true }).click()
    await expect(portal.getByText('Portal browser initial message', { exact: true })).toBeVisible()
    const reference = new URL(portal.url()).searchParams.get('case_reference')
    expect(reference).toMatch(/^case_[A-Za-z0-9_-]{32}$/)

    const ops = await staffContext.newPage(), opsPath = `/admin/customer-cases?customer=${ui.customerId}&case=${committed.id}`
    await browserLogin(ops, f.staff, opsPath)
    const row = ops.locator(`article[data-case-id="${committed.id}"]`)
    await expect(row).toContainText('Portal browser initial message')
    const staffMessage = formWithButton(ops, 'Spara meddelande')
    await staffMessage.getByLabel('Synlighet', { exact: true }).selectOption('internal')
    await staffMessage.getByLabel('Text', { exact: true }).fill('SYNTHETIC PRIVATE BROWSER NOTE')
    await staffMessage.getByRole('button', { name: 'Spara meddelande', exact: true }).click()
    await expect(staffMessage.getByRole('status')).toContainText('Revision 2')
    await ops.reload()
    await expect(row).toContainText('SYNTHETIC PRIVATE BROWSER NOTE')
    const reply = formWithButton(ops, 'Spara meddelande')
    await reply.getByLabel('Synlighet', { exact: true }).selectOption('customer')
    await reply.getByLabel('Text', { exact: true }).fill('Browser staff answer to same case')
    await reply.getByRole('button', { name: 'Spara meddelande', exact: true }).click()
    await expect(reply.getByRole('status')).toContainText('Revision 3')
    await ops.reload()
    await expect(row).toContainText('Browser staff answer to same case')
    await ops.screenshot({ path: testInfo.outputPath('support-interactive-ops.png'), fullPage: true })

    await portal.reload()
    await expect(portal.getByText('Browser staff answer to same case', { exact: true })).toBeVisible()
    await expect(portal.getByText('SYNTHETIC PRIVATE BROWSER NOTE', { exact: true })).toHaveCount(0)
    const customerReply = formWithButton(portal, 'Skicka meddelande')
    await customerReply.getByLabel('Fortsätt samma ärende', { exact: true }).fill('Browser customer continuation')
    await customerReply.getByRole('button', { name: 'Skicka meddelande', exact: true }).click()
    await expect(customerReply.getByRole('status')).toContainText('Ditt meddelande är sparat. Revision 4')
    await portal.reload()
    await expect(portal.getByText('Browser customer continuation', { exact: true })).toBeVisible()
    await expect(portal.getByText('Browser staff answer to same case', { exact: true })).toBeVisible()
    await expect(portal.getByText('SYNTHETIC PRIVATE BROWSER NOTE', { exact: true })).toHaveCount(0)
    await portal.screenshot({ path: testInfo.outputPath('support-interactive-portal.png'), fullPage: true })
    await ops.reload()
    await expect(row).toContainText('Browser customer continuation')
    await expect(row).toContainText('Supportrevision 4')

    const viewer = await viewerContext.newPage()
    await browserLogin(viewer, ui.viewer, `/portal/arenden?customer=${ui.customerId}&case_reference=${reference}`)
    await expect(viewer.getByText('Browser customer continuation', { exact: true })).toBeVisible()
    await expect(viewer.getByRole('button', { name: 'Skicka meddelande', exact: true })).toHaveCount(0)
    await expect(viewer.getByRole('button', { name: 'Skicka ärende', exact: true })).toHaveCount(0)
    await expect(viewer.getByText('SYNTHETIC PRIVATE BROWSER NOTE', { exact: true })).toHaveCount(0)
    const foreign = await viewer.goto(`/portal/arenden?customer=${f.customers[2].customerId}`)
    expect(foreign.status()).toBe(404)
    await expect(viewer.getByText('Customer initial B1', { exact: true })).toHaveCount(0)

    const reader = await readerContext.newPage()
    await browserLogin(reader, f.reader, opsPath)
    await expect(reader.locator(`article[data-case-id="${committed.id}"]`)).toContainText('Browser customer continuation')
    await expect(reader.getByRole('button', { name: 'Spara meddelande', exact: true })).toHaveCount(0)
    await expect(reader.getByRole('button', { name: 'Spara status', exact: true })).toHaveCount(0)
    await expect(reader.getByRole('button', { name: 'Skapa supportärende', exact: true })).toHaveCount(0)
    expect(localProofSql(`SELECT jsonb_build_object('cases',count(*),'revision',max(support_revision)) FROM public.customer_cases
      WHERE company_id=${proofQuote(ui.companyId)} AND customer_id=${proofQuote(ui.customerId)};`)).toEqual({ cases: 1, revision: 4 })
    console.log('SUPPORT_INTERACTIVE_BROWSER_PASS portal_create=true lost_after_commit_retry=true same_case_ops=true internal_public_separation=true portal_reply=true reload_persistence=true portal_viewer_readonly=true ops_readonly=true foreign_customer_404=true')
  } finally {
    await Promise.all([ownerContext.close(), staffContext.close(), viewerContext.close(), readerContext.close()])
  }
})

test('the original API case receives private files and explicit phone publications while billing changes use independent staff permission', async ({ browser, request }, testInfo) => {
  test.setTimeout(240_000)
  const [a1, a2, b1] = f.customers
  const original = localProofSql(`SELECT jsonb_build_object('count',count(*),'id',min(c.id::text),'reference',min(t.public_reference),'revision',max(c.support_revision))
    FROM public.customer_cases c JOIN public.customer_support_threads t ON t.id=c.id AND t.company_id=c.company_id AND t.customer_id=c.customer_id
    WHERE c.company_id=${proofQuote(a1.companyId)} AND c.customer_id=${proofQuote(a1.customerId)} AND c.title='Synthetic case A1' AND c.source='tenant_support_api';`)
  expect(original.count).toBe(1)
  expect(original.revision).toBe(4)
  const attachmentPath = `${path}/${original.reference}/attachments`, messagesPath = `${path}/${original.reference}/messages`
  const pdf = Buffer.from('%PDF-1.7\nSynthetic isolated support attachment\n%%EOF\n', 'utf8')
  const upload = async (c, revision, key, name = 'synthetic-support-api.pdf') => proofPost(request, attachmentPath, {
    headers: { ...await proofActionHeaders(f, c, 'POST', attachmentPath), 'idempotency-key': key },
    multipart: { expected_revision: String(revision), file: { name, mimeType: 'application/pdf', buffer: pdf } },
  })
  const firstUpload = await upload(a1, 4, 'support-journey-api-attachment')
  expect(firstUpload.status()).toBe(201)
  const firstAttachment = (await firstUpload.json()).data
  expect(firstAttachment).toMatchObject({ revision: 5, scan_status: 'quarantined', replayed: false })
  expect(Object.keys(firstAttachment).sort()).toEqual(['attachment_reference', 'revision', 'scan_status', 'replayed'].sort())
  const retry = await upload(a1, 4, 'support-journey-api-attachment')
  expect(retry.status()).toBe(201)
  expect((await retry.json()).data).toEqual({ ...firstAttachment, replayed: true })
  for (const c of [a2, b1]) {
    const foreignRead = await get(request, c, attachmentPath)
    expect(foreignRead.status()).toBe(404)
    expect((await foreignRead.json()).data).toBeUndefined()
    const foreignUpload = await upload(c, 5, `support-journey-foreign-${c.tag}`)
    expect(foreignUpload.status()).toBe(404)
    expect((await foreignUpload.json()).data).toBeUndefined()
  }
  const ownerContext = await browser.newContext({ baseURL: 'http://127.0.0.1:3000', viewport: { width: 1280, height: 900 } })
  const staffContext = await browser.newContext({ baseURL: 'http://127.0.0.1:3000', viewport: { width: 1280, height: 900 } })
  try {
    const portal = await ownerContext.newPage(), portalPath = `/portal/arenden?customer=${a1.customerId}&case_reference=${original.reference}`
    await browserLogin(portal, f.journey.owner, portalPath)
    await expect(portal.getByText('synthetic-support-api.pdf', { exact: true })).toBeVisible()
    await expect(portal.getByText('INTERNAL SECRET SUPPORT NOTE', { exact: true })).toHaveCount(0)
    const attachmentForm = formWithButton(portal, 'Lämna privat bilaga')
    await attachmentForm.locator('input[type="file"]').setInputFiles({ name: 'synthetic-support-portal.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic portal support attachment\n', 'utf8') })
    await attachmentForm.getByRole('button', { name: 'Lämna privat bilaga', exact: true }).click()
    await expect(attachmentForm.getByRole('status')).toContainText('privat karantän. Revision 6')
    await portal.reload()
    await expect(portal.getByText('synthetic-support-portal.txt', { exact: true })).toBeVisible()
    await expect(portal.getByText('synthetic-support-api.pdf', { exact: true })).toBeVisible()
    await expect(portal.locator('a[download], a[href*="customer-support-quarantine"], a[href*="/storage/v1/object/"]')).toHaveCount(0)
    const attachmentRead = await get(request, a1, attachmentPath)
    expect(attachmentRead.status()).toBe(200)
    const attachmentRows = (await attachmentRead.json()).data
    expect(attachmentRows).toHaveLength(2)
    for (const item of attachmentRows) {
      expect(item.scan_status).toBe('quarantined')
      expect(Object.keys(item).sort()).toEqual(['attachment_reference', 'file_name', 'media_type', 'byte_size', 'scan_status', 'created_at'].sort())
    }
    await portal.screenshot({ path: testInfo.outputPath('support-journey-private-attachments.png'), fullPage: true })

    const ops = await staffContext.newPage(), opsPath = `/admin/customer-cases?customer=${a1.customerId}&case=${original.id}`
    await browserLogin(ops, f.staff, opsPath)
    const row = ops.locator(`article[data-case-id="${original.id}"]`)
    await expect(row).toContainText('INTERNAL SECRET SUPPORT NOTE')
    await expect(row).toContainText('Kundidentiteten är inte verifierad')
    await expect(row).toContainText(f.staff.userId)
    await expect(row).toContainText('synthetic-support-api.pdf')
    await expect(row).toContainText('synthetic-support-portal.txt')
    const firstSummary = 'Staff phone summary: the caller is unverified; the case is temporarily closed to customer changes.'
    const publication = formWithButton(ops, 'Publicera till kunden')
    await publication.getByLabel('Kundsynlig rubrik', { exact: true }).fill('Synthetic original case phone summary')
    await publication.getByLabel('Kundsynlig sammanfattning', { exact: true }).fill(firstSummary)
    await publication.getByLabel('Sammanfattningens kanal', { exact: true }).selectOption('phone')
    await publication.getByLabel('Kundsynlig status', { exact: true }).selectOption('closed')
    await publication.getByRole('button', { name: 'Publicera till kunden', exact: true }).click()
    await expect(row).toContainText(`Version 1 · Synthetic original case phone summary`)
    await expect(row).toContainText('Supportrevision 7')
    await ops.reload()
    await expect(row).toContainText(firstSummary)
    await portal.reload()
    await expect(portal.getByText(firstSummary, { exact: true })).toBeVisible()
    await expect(portal.getByText(/Aktuell kundsynlig sammanfattning: Telefonsammanfattning · Författarreferens support_staff_/)).toBeVisible()
    await expect(portal.getByRole('button', { name: 'Lämna privat bilaga', exact: true })).toHaveCount(0)
    await expect(portal.getByRole('button', { name: 'Skicka meddelande', exact: true })).toHaveCount(0)
    const closedUpload = await upload(a1, 7, 'support-journey-closed-attachment', 'synthetic-closed-denied.pdf')
    expect(closedUpload.status()).toBe(409)
    expect((await closedUpload.json()).error.code).toBe('support_case_closed')
    const closedReply = await post(request, a1, messagesPath, { body: 'Denied closed reply', expected_revision: 7 }, 'support-journey-closed-message')
    expect(closedReply.status()).toBe(409)
    expect((await closedReply.json()).error.code).toBe('support_case_closed')
    // A completed intake may replay after closure, but only after live actor authorization.
    const closedReplay = await upload(a1, 4, 'support-journey-api-attachment')
    expect(closedReplay.status()).toBe(201)
    expect((await closedReplay.json()).data).toEqual({ ...firstAttachment, replayed: true })
    expect(localProofSql(`SELECT jsonb_build_object('status',status,'revision',support_revision,'attachments',(SELECT count(*) FROM public.customer_support_attachments a WHERE a.company_id=c.company_id AND a.customer_id=c.customer_id AND a.customer_case_id=c.id))
      FROM public.customer_cases c WHERE c.company_id=${proofQuote(a1.companyId)} AND c.customer_id=${proofQuote(a1.customerId)} AND c.id=${proofQuote(original.id)};`)).toEqual({ status: 'open', revision: 7, attachments: 2 })

    // This tests rejection of a caller's self-assertion, not a real phone identity issuer.
    const profilePath = '/api/v1/customer/profile-update'
    const selfAsserted = { profile: { invoice_email: 'unverified-caller@example.invalid' }, expected_billing_revision: f.journey.initialProfileRevision, verified: true }
    const noDelegation = await proofPost(request, profilePath, { headers: { authorization: `Bearer ${a1.key}`, 'idempotency-key': 'support-journey-unverified-caller' }, data: selfAsserted })
    expect(noDelegation.status()).toBe(403)
    expect((await noDelegation.json()).data).toBeUndefined()
    const unsupportedProof = await post(request, a1, profilePath, selfAsserted, 'support-journey-forged-caller-proof')
    expect(unsupportedProof.status()).toBe(422)
    expect((await unsupportedProof.json()).data).toBeUndefined()
    expect(localProofSql(`SELECT jsonb_build_object('revision',billing_profile_revision,'invoice_email',invoice_email) FROM public.customers
      WHERE company_id=${proofQuote(a1.companyId)} AND id=${proofQuote(a1.customerId)};`)).toEqual({ revision: f.journey.initialProfileRevision, invoice_email: 'journey-billing-before@example.invalid' })

    await ops.goto(`/admin/customers/${a1.customerId}?tab=billing-metering`)
    const billing = formWithButton(ops, 'Spara faktureringsstandard')
    await expect(billing.getByLabel('Standard för faktura-e-post', { exact: true })).toHaveValue('journey-billing-before@example.invalid')
    await expect(billing.locator('input[name="expected_revision"]')).toHaveValue(String(f.journey.initialProfileRevision))
    await billing.getByLabel('Standard för faktura-e-post', { exact: true }).fill('journey-billing@example.invalid')
    await billing.getByRole('button', { name: 'Spara faktureringsstandard', exact: true }).click()
    await expect.poll(() => localProofSql(`SELECT to_jsonb(billing_profile_revision) FROM public.customers WHERE company_id=${proofQuote(a1.companyId)} AND id=${proofQuote(a1.customerId)};`)).toBe(f.journey.initialProfileRevision + 1)
    await ops.reload()
    await expect(formWithButton(ops, 'Spara faktureringsstandard').getByLabel('Standard för faktura-e-post', { exact: true })).toHaveValue('journey-billing@example.invalid')
    await expect(ops.getByText(`Profilrevision: ${f.journey.initialProfileRevision + 1}. Kontaktmejl och inloggning ändras separat.`, { exact: true })).toBeVisible()
    await ops.screenshot({ path: testInfo.outputPath('support-journey-authorized-billing.png'), fullPage: true })

    await ops.goto(opsPath)
    const finalSummary = 'Staff phone summary: an independently authorized staff member saved the future billing email. Caller identity remains unverified.'
    const nextPublication = formWithButton(ops, 'Publicera ny kundsynlig version')
    await nextPublication.getByLabel('Kundsynlig rubrik', { exact: true }).fill('Synthetic original case updated phone summary')
    await nextPublication.getByLabel('Kundsynlig sammanfattning', { exact: true }).fill(finalSummary)
    await nextPublication.getByLabel('Sammanfattningens kanal', { exact: true }).selectOption('phone')
    await nextPublication.getByLabel('Kundsynlig status', { exact: true }).selectOption('open')
    await nextPublication.getByRole('button', { name: 'Publicera ny kundsynlig version', exact: true }).click()
    await expect(row).toContainText('Version 2 · Synthetic original case updated phone summary')
    await expect(row).toContainText('Supportrevision 8')
    await ops.reload()
    await expect(row).toContainText(finalSummary)
    await ops.screenshot({ path: testInfo.outputPath('support-journey-phone-ops.png'), fullPage: true })
    await portal.reload()
    expect(new URL(portal.url()).searchParams.get('case_reference')).toBe(original.reference)
    await expect(portal.getByText(finalSummary, { exact: true })).toBeVisible()
    await expect(portal.getByText(firstSummary, { exact: true })).toHaveCount(0)
    await expect(portal.getByText('INTERNAL SECRET SUPPORT NOTE', { exact: true })).toHaveCount(0)
    await expect(portal.getByRole('button', { name: 'Skicka meddelande', exact: true })).toBeVisible()
    await portal.setViewportSize({ width: 390, height: 844 })
    expect(await portal.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
    await portal.screenshot({ path: testInfo.outputPath('support-journey-phone-portal-mobile.png'), fullPage: true })
    const conversationResponse = await get(request, a1, messagesPath)
    expect(conversationResponse.status()).toBe(200)
    const conversation = (await conversationResponse.json()).data
    expect(conversation).toHaveLength(4)
    expect(conversation[0]).toMatchObject({ body: finalSummary, author_kind: 'staff', channel: 'phone', revision: 8 })
    expect(JSON.stringify(conversation)).not.toMatch(/INTERNAL SECRET|temporarily closed|actor_user_id|company_id|customer_id|metadata/)
    const list = await get(request, a1, path)
    expect(list.status()).toBe(200)
    expect((await list.json()).data.find(item => item.case_reference === original.reference)).toMatchObject({ revision: 8, status: 'open' })
    console.log('SUPPORT_JOURNEY_BROWSER_PASS same_api_case=true actual_api_portal_files=2 quarantine_only=true closed_publication_denies_intake=true completed_intake_replay=true phone_staff_publications=2 self_asserted_caller_rejected=true independently_authorized_billing_edit=true caller_identity_unverified=true issuer_unconfigured=true scanner_unconfigured=true')
  } finally {
    await Promise.all([ownerContext.close(), staffContext.close()])
  }
})

test('revoked customer link, client and scopes cannot read or replay completed support writes', async ({ request }) => {
  await refreshProofAssertions(f, path)
  const a1 = f.customers[0]
  const reference = localProofSql(`SELECT to_jsonb(t.public_reference) FROM public.customer_support_threads t JOIN public.customer_cases c ON c.id=t.id AND c.company_id=t.company_id AND c.customer_id=t.customer_id
    WHERE t.company_id=${proofQuote(a1.companyId)} AND t.customer_id=${proofQuote(a1.customerId)} AND c.title='Synthetic case A1';`)
  const counts = () => localProofSql(`SELECT jsonb_build_object('commands',(SELECT count(*) FROM public.canonical_command_results WHERE company_id IN (${f.companies.map(proofQuote).join(',')})),
    'audits',(SELECT count(*) FROM public.canonical_audit_events WHERE company_id IN (${f.companies.map(proofQuote).join(',')})),
    'attachments',(SELECT count(*) FROM public.customer_support_attachments WHERE company_id IN (${f.companies.map(proofQuote).join(',')})),
    'outbox',(SELECT count(*) FROM public.canonical_event_outbox WHERE company_id IN (${f.companies.map(proofQuote).join(',')})));`)
  const before = counts()
  await revokeReadProof(request, expect, path, f)
  const revokedReplay = await post(request, a1, path, { title: 'Synthetic case A1', body: 'Customer initial A1' }, 'http-support-create-A1')
  expect(revokedReplay.status()).toBe(403)
  expect((await revokedReplay.json()).data).toBeUndefined()
  const attachmentPath = `${path}/${reference}/attachments`
  const revokedAttachmentReplay = await proofPost(request, attachmentPath, {
    headers: { ...await proofActionHeaders(f, a1, 'POST', attachmentPath), 'idempotency-key': 'support-journey-api-attachment' },
    multipart: { expected_revision: '4', file: { name: 'synthetic-support-api.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\nSynthetic isolated support attachment\n%%EOF\n', 'utf8') } },
  })
  expect(revokedAttachmentReplay.status()).toBe(403)
  expect((await revokedAttachmentReplay.json()).data).toBeUndefined()
  expect(counts()).toEqual(before)
  console.log('SUPPORT_REVOKED_HTTP_PASS active_assertions=true revoked_link=true revoked_client=true revoked_scopes=true completed_create_replay_denied=true completed_attachment_replay_denied=true no_partial_effect=true')
})
