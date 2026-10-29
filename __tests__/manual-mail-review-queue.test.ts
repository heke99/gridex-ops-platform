import { describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { getManualMailReviewQueue, normalizeManualMailReviewFilters, manualMailReviewReasons } from '@/lib/inbound-mail/manualMailReviewQueue'
import { normalizeManualCommercialTerms } from '@/lib/inbound-mail/manualCommercialTerms'

describe('manual mail review queue', () => {
  it('queries all review states before database pagination, including matched and partially applied multi-site replies', async () => {
    const calls: Array<[string, ...unknown[]]> = []
    const result = { data: [{ id: 'old-row', extracted_payload: {} }], count: 101, error: null }
    const q: Record<string, unknown> = {}
    for (const method of ['select','or','eq','gte','lt','order','range']) q[method] = vi.fn((...args) => { calls.push([method,...args]); return q })
    q.then = (resolve: (value: unknown) => unknown) => Promise.resolve(resolve(result))
    const db = { from: vi.fn(() => q) }
    const rows = await getManualMailReviewQueue(db as never, { page: '3', tenant: '11111111-1111-4111-8111-111111111111', from: '2026-01-01', to: '2026-01-31' }, new Date('2026-10-19T00:00:00Z'))
    expect(rows.rows[0].id).toBe('old-row')
    expect(rows.total).toBe(101)
    expect(calls.find(([name]) => name === 'range')).toEqual(['range',50,74])
    const filter = String(calls.find(([name]) => name === 'or')?.[1])
    expect(filter).toContain('resolution_status.in.(unmatched,ambiguous)')
    expect(filter).toContain('needs_review')
    expect(filter).toContain('multi_site->>reviewCount.gt.0')
    expect(filter).toContain('failed')
    expect(filter).toContain('extracted_payload->manual_automation->continuation->>status.eq.failed')
    expect(filter).toContain('gridex_manual_mail_has_pending_partial_v1.eq.true')
    expect(filter).toContain('extracted_payload->manual_automation->continuation->>reviewRequired.eq.true')
    expect(filter).toContain('ai_read_only->>status.eq.processing,extracted_payload->ai_read_only->>started_at.lt.2026-10-18T23:45:00.000Z')
    expect(filter).toContain('documentReading->>status.eq.processing,extracted_payload->manual_automation->documentReading->>started_at.lt.2026-10-18T23:45:00.000Z')
    expect(calls.find(([name]) => name === 'select')?.[1]).not.toContain('attachments')
    expect(calls).toContainEqual(['eq','company_id','11111111-1111-4111-8111-111111111111'])
    expect(calls).toContainEqual(['lt','received_at','2026-01-31T23:00:00.000Z'])
  })
  it('rejects injected or invalid filters instead of widening a requested search', () => {
    expect(() => normalizeManualMailReviewFilters({ tenant: 'bad\nvalue' })).toThrow()
    expect(() => normalizeManualMailReviewFilters({ from: '2026-02-30' })).toThrow()
    expect(() => normalizeManualMailReviewFilters({ from: '2026-10-20', to: '2026-10-01' })).toThrow()
  })
  it('includes applied mail with per-site reviews', () => {
    expect(manualMailReviewReasons({ resolution_status: 'matched', processing_state: 'applied', extracted_payload: { manual_automation: { multi_site: { reviewCount: 2 } } } })).toContain('2 anläggningar behöver granskas')
  })
})

it.each([
  ['2026-03-29', '2026-03-28T23:00:00.000Z', '2026-03-29T22:00:00.000Z'],
  ['2026-10-25', '2026-10-24T22:00:00.000Z', '2026-10-25T23:00:00.000Z'],
])('uses the complete Swedish day during daylight saving transition %s', async (day, start, end) => {
  const calls: unknown[][] = []
  const q: Record<string, unknown> = {}
  for (const method of ['select','or','eq','gte','lt','order','range']) q[method] = (...args: unknown[]) => { calls.push([method,...args]); return q }
  q.then = (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: [], error: null, count: 0 }))
  await getManualMailReviewQueue({ from: () => q } as never, { from: day, to: day })
  expect(calls).toContainEqual(['gte','received_at',start]); expect(calls).toContainEqual(['lt','received_at',end])
})

it('searches canonical tenant names and customer numbers without assigning unmatched mail', async () => {
  const calls: unknown[][] = []
  const results: Record<string, unknown> = { companies: { data: [{ id: 'tenant-a' }], error: null }, customers: { data: [{ id: 'customer-a' }], error: null }, manual_inbound_messages: { data: [], error: null, count: 0 } }
  const db = { from: (table: string) => {
    const q: Record<string, unknown> = {}
    for (const method of ['select','or','eq','gte','lt','order','range','in','limit','ilike']) q[method] = (...args: unknown[]) => { calls.push([table,method,...args]); return q }
    q.then = (resolve: (value: unknown) => unknown) => Promise.resolve(resolve(results[table]))
    return q
  } }
  await getManualMailReviewQueue(db as never, { tenant: 'Gridex', customer: 'K00100043' })
  expect(calls).toContainEqual(['companies','ilike','name','%Gridex%'])
  expect(calls).toContainEqual(['customers','in','company_id',['tenant-a']])
  expect(calls).toContainEqual(['manual_inbound_messages','in','customer_id',['customer-a']])
  expect(calls).toContainEqual(['manual_inbound_messages','in','company_id',['tenant-a']])
})

it('names a failed continuation even when all facility facts were applied', () => {
  expect(manualMailReviewReasons({ resolution_status: 'matched', processing_state: 'applied', extracted_payload: {
    manual_automation: { multi_site: { version: 1, appliedCount: 2, reviewCount: 0 }, continuation: {
      status: 'failed', sourceHash: 'a'.repeat(64), inboundId: 'inbound-a', failedAt: '2026-10-19T00:00:00Z', reason: 'continuation_failed',
    } },
  } })).toContain('Fortsatt handläggning kunde inte slutföras')
})
it('clears the failed-continuation reason after a completed retry', () => {
  expect(manualMailReviewReasons({ resolution_status: 'matched', processing_state: 'applied', extracted_payload: {
    manual_automation: { continuation: { status: 'completed' } },
  } })).not.toContain('Fortsatt handläggning kunde inte slutföras')
})

it.each(['1250 kr', '1250,50 SEK'])('explains a genuine normalized positive fee %s for both parent and child', fee => {
  const normalized = normalizeManualCommercialTerms({ authoredText: `Tidigaste start: 2027-04-01\nBrytavgift: ${fee}`,
    extracted: { earliest_supplier_start_date: '2027-04-01', termination_fee: fee }, receivedAt: '2027-01-31T12:00:00Z' })
  expect(normalized.ok).toBe(true)
  const application = { applied: true, complete: false, missingFields: [], terms: normalized.terms, responseStatus: 'termination_fee' }
  for (const fields of [{ application }, { site_applications: { child: { application } } }]) {
    expect(manualMailReviewReasons({ resolution_status: 'matched', processing_state: 'applied', extracted_payload: {
      manual_automation: fields,
    } })).toContain('Brytavgift behöver granskas')
  }
})
it.each(['0 kr', '0,00 SEK', 'Ingen'])('does not explain %s as a positive fee', fee => {
  expect(manualMailReviewReasons({ resolution_status: 'matched', processing_state: 'applied', extracted_payload: {
    manual_automation: { application: { applied: true, complete: false, missingFields: ['earliest_supplier_start_date'],
      responseStatus: 'waiting_response', terms: { terminationFee: fee } } },
  } })).not.toContain('Brytavgift behöver granskas')
})
it('shows legitimate completed business review separately from a technical failure', () => {
  const reasons = manualMailReviewReasons({ resolution_status: 'matched', processing_state: 'applied', extracted_payload: {
    manual_automation: { continuation: { status: 'completed', reviewRequired: true, reviewReasons: ['supplier_information_requires_review'] } },
  } })
  expect(reasons).toContain('Fortsatt handläggning kräver manuell granskning')
  expect(reasons).not.toContain('Fortsatt handläggning kunde inte slutföras')
})

it('serializes the pending predicate and tenant scope in the same SDK request as exact count and pagination', async () => {
  const requests: Array<{ url: URL; headers: Headers }> = []
  const db = createClient('https://fixture.invalid', 'synthetic-public-anon-key', { auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      requests.push({ url: new URL(String(input)), headers: new Headers(init?.headers) })
      return new Response(JSON.stringify([{ id: 'last-review-row' }]), { status: 206, headers: { 'Content-Type': 'application/json', 'Content-Range': '25-25/26' } })
    } } })
  const result = await getManualMailReviewQueue(db as never, { page: '2', tenant: '11111111-1111-4111-8111-111111111111' })
  expect(requests).toHaveLength(1)
  const { url, headers } = requests[0]
  expect(url.pathname).toBe('/rest/v1/manual_inbound_messages')
  expect(url.searchParams.get('or')).toContain('gridex_manual_mail_has_pending_partial_v1.eq.true')
  expect(url.searchParams.get('or')).toContain('resolution_status.in.(unmatched,ambiguous)')
  expect(url.searchParams.get('company_id')).toBe('eq.11111111-1111-4111-8111-111111111111')
  expect(url.searchParams.get('offset')).toBe('25'); expect(url.searchParams.get('limit')).toBe('25')
  expect(headers.get('prefer')).toContain('count=exact')
  expect(result).toMatchObject({ total: 26, page: 2, hasMore: false, rows: [{ id: 'last-review-row' }] })
})
