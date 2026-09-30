import { readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'
import { eventV2SafeGet } from '../helpers/event-v2-safe-request.mjs'

const activeContractVersion = JSON.parse(readFileSync(new URL('../../docs/openapi/website-integration-v1.json', import.meta.url), 'utf8')).info.version

const enabled = process.env.CI === 'true' && process.env.GRIDEX_EVENT_V2_LOCAL_E2E === '1'
  && process.env.NEXT_PUBLIC_SUPABASE_URL === 'http://127.0.0.1:54321'
  && !process.env.GRIDEX_E2E_BROWSER_BASE_URL && Boolean(process.env.GRIDEX_EVENT_V2_FIXTURE_PATH)
test.skip(!enabled, 'Requires the disposable local event-v2 database and signed Auth fixture.')
test.describe.configure({ mode: 'serial', retries: 0 })
// Request traces could retain synthetic credentials; the proof uses safe markers.
test.use({ trace: 'off', video: 'off', screenshot: 'off' })
const fixture = enabled ? JSON.parse(readFileSync(process.env.GRIDEX_EVENT_V2_FIXTURE_PATH, 'utf8')) : null
const path = '/api/v1/customer/events'
const headers = customer => ({ authorization: `Bearer ${customer.key}`, 'x-gridex-customer-assertion': customer.assertion })
const projection = row => ({ event_type: row.event_type, event_version: row.event_version, occurred_at: row.occurred_at, source: row.source })
const pageShape = page => ({ ...page, next_cursor: page.next_cursor === null ? null : 'opaque-cursor' })

test('actual HTTP/native events preserve versions, sources, customer isolation, ties, limits and cursor replay', async ({ request }) => {
  test.setTimeout(90_000)
  const [a1, a2, b1] = fixture.customers
  const all = []
  let cursor = null, firstCursor = null, pages = 0, replays = 0
  do {
    const url = `${path}?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    const response = await eventV2SafeGet(request, url, { headers: headers(a1) })
    expect(response.status()).toBe(200)
    const body = await response.json()
    expect(body.contract_schema_version).toBe(activeContractVersion)
    expect(body.page).toMatchObject({ limit: 2, offset: 0, returned: body.data.length })
    expect(body.data.length).toBeLessThanOrEqual(2)
    for (const row of body.data) {
      expect(Object.keys(row).sort()).toEqual(['event_reference', 'event_type', 'event_version', 'occurred_at', 'source'])
      expect(row.event_reference).toMatch(/^event_[A-Za-z0-9_-]{32}$/)
    }
    const replayResponse = await eventV2SafeGet(request, url, { headers: headers(a1) })
    expect(replayResponse.status()).toBe(200)
    const replay = await replayResponse.json()
    expect(replay.data).toEqual(body.data)
    expect(pageShape(replay.page)).toEqual(pageShape(body.page))
    all.push(...body.data)
    cursor = body.page.next_cursor
    if (pages === 0) firstCursor = cursor
    expect(body.page.has_more).toBe(cursor !== null)
    if (cursor) expect(cursor).toEqual(expect.any(String))
    pages++
    replays++
    expect(pages).toBeLessThanOrEqual(4)
  } while (cursor)
  expect(pages).toBe(4)
  expect(replays).toBe(4)
  expect(all.map(projection)).toEqual(a1.expected)
  expect(all.map(row => row.event_version)).toEqual([1, 1, 1, 7, 3, 2, 4, 4])
  expect(new Set(all.map(row => row.event_reference)).size).toBe(8)
  expect(all[1].occurred_at).toBe(all[2].occurred_at)
  expect(all[2].occurred_at).toBe(all[3].occurred_at)
  expect(all[3].occurred_at).toBe(all[4].occurred_at)
  expect(all[1].occurred_at).toContain('.123456')

  for (const customer of [a2, b1]) {
    const response = await eventV2SafeGet(request, `${path}?limit=1`, { headers: headers(customer) })
    expect(response.status()).toBe(200)
    const body = await response.json()
    expect(body.data.map(projection)).toEqual(customer.expected.slice(0, 1))
    expect(body.page).toMatchObject({ returned: 1, has_more: true })
    const next = await eventV2SafeGet(request, `${path}?limit=1&cursor=${encodeURIComponent(body.page.next_cursor)}`, { headers: headers(customer) })
    expect(next.status()).toBe(200)
    const last = await next.json()
    expect(last.data.map(projection)).toEqual(customer.expected.slice(1))
    expect(last.page).toMatchObject({ returned: 1, has_more: false, next_cursor: null })
    expect(all.map(row => row.event_reference)).not.toContain(body.data[0].event_reference)
    const foreignCursor = await eventV2SafeGet(request, `${path}?cursor=${encodeURIComponent(firstCursor)}`, { headers: headers(customer) })
    expect(foreignCursor.status()).toBe(400)
    expect((await foreignCursor.json()).error.code).toBe('invalid_cursor')
  }
  for (const [query, limit] of [['', 50], ['?limit=0', 50], ['?limit=1', 1], ['?limit=1000', 100]]) {
    const response = await eventV2SafeGet(request, `${path}${query}`, { headers: headers(a1) })
    expect(response.status()).toBe(200)
    const body = await response.json()
    expect(body.page.limit).toBe(limit)
    expect(body.data.map(projection)).toEqual(a1.expected.slice(0, limit))
  }
  const missingKey = await eventV2SafeGet(request, path)
  expect(missingKey.status()).toBe(401)
  for (const deniedHeaders of [
    { authorization: `Bearer ${a1.key}` },
    { ...headers(a1), 'x-gridex-customer-assertion': fixture.wrongActionAssertion },
    { ...headers(a1), 'x-gridex-customer-assertion': fixture.wrongCustomerAssertion },
    { ...headers(a1), 'x-gridex-customer-assertion': b1.assertion },
    { ...headers(a1), 'x-gridex-customer-number': `EV2-A2-${a2.customerId.slice(0, 8)}` },
    { authorization: `Bearer ${fixture.noScopeKey}`, 'x-gridex-customer-assertion': fixture.noScopeAssertion },
  ]) {
    const denied = await eventV2SafeGet(request, path, { headers: deniedHeaders })
    expect(denied.status()).toBe(403)
    expect((await denied.json()).data).toBeUndefined()
  }
  const malformed = await eventV2SafeGet(request, `${path}?cursor=malformed`, { headers: headers(a1) })
  expect(malformed.status()).toBe(400)
  expect((await malformed.json()).error.code).toBe('invalid_cursor')
  expect(JSON.stringify(all)).not.toMatch(/must not project|payload|metadata|source_table|source_rank|customer_id|company_id/)
  console.log('EVENT_V2_HTTP_NATIVE_PASS rows=8 pages=4 replay_checks=4 customers=3 sources=2 microsecond_ties=true shared_ids=true guards=true limits=true')
})
