// Real parser/adapter/registered route callbacks; only current-auth and the
// three service RPC transport ports are finite. No database/native acceptance.
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import * as crypto from 'node:crypto'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const company = uuid(1), actor = uuid(2), source = uuid(3), captureEvent = uuid(4), reviewEvent = uuid(5)
const sha = (bytes: Uint8Array) => crypto.createHash('sha256').update(bytes).digest('hex')
function wire(month = '2027-03', resolution = 'PT15M') {
  const bounds: Record<string, [string, string]> = {
    '2027-03': ['2027-02-28T23:00:00.000Z', '2027-03-31T22:00:00.000Z'],
    '2027-10': ['2027-09-30T22:00:00.000Z', '2027-10-31T23:00:00.000Z'],
    '2024-02': ['2024-01-31T23:00:00.000Z', '2024-02-29T23:00:00.000Z'],
  }
  const [start, end] = bounds[month], step = resolution === 'PT15M' ? 900_000 : 3_600_000
  return { schema: 'gridex-synthetic-spot-source-v1', declaration: 'SYNTHETIC_TEST_DATA_NOT_MARKET_ORIGINAL', sourceVersion: 'v1',
    billingMonth: month, civilZone: 'Europe/Stockholm', priceArea: 'SE3', resolution, currency: 'SEK_PER_KWH',
    intervals: Array.from({ length: (Date.parse(end) - Date.parse(start)) / step }, (_, i) => ({
      start: new Date(Date.parse(start) + i * step).toISOString(), end: new Date(Date.parse(start) + (i + 1) * step).toISOString(),
      priceSekPerKwh: ['-0.50', '0', '0.75', '1.20'][i % 4],
    })) }
}
type Exports = Record<string, (...args: unknown[]) => unknown>
function evaluate(relative: string, imports: Record<string, unknown>): Exports {
  const exports: Exports = {}
  runInNewContext(ts.transpileModule(readFileSync(new URL('../' + relative, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, require: (name: string) => {
    if (!(name in imports)) throw Error('undeclared intake IO: ' + name)
    return imports[name]
  }, Buffer, TextDecoder, TextEncoder, Request, Response, Headers, URL, ReadableStream })
  return exports
}
function control(options: { auth?: number; platform?: boolean; scopeError?: boolean; rpcCode?: string; transport?: boolean; wrong?: string; replayReview?: boolean; archiveWhitespace?: boolean } = {}) {
  const original = Buffer.from((options.archiveWhitespace ? ' ' : '') + JSON.stringify(wire())), calls: Array<{ name: string; args: Record<string, unknown> }> = [], requirements: unknown[] = []
  const base = { source_id: source, original_sha256: sha(original), source_version: 'v1', billing_month: '2027-03', price_area: 'SE3', resolution: 'PT15M',
    period_start: '2027-02-28T23:00:00.000Z', period_end: '2027-03-31T22:00:00.000Z', interval_count: 2972, expected_interval_count: 2972,
    covered_minutes: 44580, original_byte_length: original.length, capture_event_id: captureEvent, latest_event_id: captureEvent,
    latest_event_sha256: 'a'.repeat(64), status: 'captured', consumer_enabled: false, replayed: false }
  const product = evaluate('lib/pricing/syntheticSpotSources.ts', {
    'node:crypto': crypto,
    '@/lib/admin/apiGuards': {
      requireAdminApiAccess: async (requirement: unknown) => { requirements.push(requirement); return options.auth
        ? { response: Response.json({ error: 'controlled denial' }, { status: options.auth }) }
        : { guard: { userId: actor, companyId: company, isPlatformAdmin: options.platform ?? false } } },
      requireAdminOperationalCompany: async () => { if (options.scopeError) throw Error('PRIVATE_SECRET_SENTINEL'); return company },
    },
    '@/lib/supabase/service': { supabaseService: { rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args })
      if (options.transport) throw Error('PRIVATE_SECRET_SENTINEL')
      if (options.rpcCode) return { data: null, error: { code: options.rpcCode, message: 'PRIVATE_SECRET_SENTINEL' } }
      let data: Record<string, unknown> = { ...base }
      if (name === 'gridex_read_synthetic_spot_source_v1' && args.p_include_original) data.original_base64 = original.toString('base64')
      if (name === 'gridex_review_synthetic_spot_source_v1') data = { ...data, event_id: reviewEvent, decision: args.p_decision,
        status: options.replayReview ? 'rejected' : args.p_decision === 'review_capture' ? 'reviewed_capture_only' : args.p_decision === 'hold' ? 'held' : 'rejected',
        latest_event_id: options.replayReview ? uuid(8) : reviewEvent, replayed: options.replayReview ?? false }
      if (options.wrong === 'original') data.original_base64 = Buffer.from('corrupt').toString('base64')
      if (options.wrong === 'hash') data.original_sha256 = 'f'.repeat(64)
      if (options.wrong === 'source') data.source_id = uuid(999)
      if (options.wrong === 'tuple') data.price_area = 'SE4'
      if (options.wrong === 'count') data.interval_count = 1
      if (options.wrong === 'consumer') data.consumer_enabled = true
      if (options.wrong === 'extra') data.private_key = 'PRIVATE_SECRET_SENTINEL'
      if (options.wrong === 'status-type') data.status = ['captured']
      if (options.wrong === 'area-type') data.price_area = ['SE3']
      if (options.wrong === 'resolution-type') data.resolution = ['PT15M']
      return { data, error: null }
    } } },
  })
  const routes = evaluate('app/api/internal/pricing/synthetic-spot-sources/route.ts', { '@/lib/pricing/syntheticSpotSources': product })
  const reviews = evaluate('app/api/internal/pricing/synthetic-spot-sources/[sourceId]/review/route.ts', { '@/lib/pricing/syntheticSpotSources': product })
  const post = (body: string | Uint8Array = original, key = uuid(6)) => routes.POST(new Request('http://local/api/internal/pricing/synthetic-spot-sources', { method: 'POST', headers: { 'Idempotency-Key': key }, body: body as BodyInit })) as Promise<Response>
  const get = (query = `id=${source}`) => routes.GET(new Request('http://local/api/internal/pricing/synthetic-spot-sources?' + query)) as Promise<Response>
  const command = { commandKey: uuid(7), expectedPreviousEventId: captureEvent, decision: 'review_capture', reason: 'Declared synthetic capture review only' }
  const review = (body: unknown = command, id = source) => reviews.POST(new Request(`http://local/api/internal/pricing/synthetic-spot-sources/${id}/review`, { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ sourceId: id }) }) as Promise<Response>
  return { product, routes, reviews, calls, requirements, original, base, command, post, get, review }
}

describe('synthetic spot original parser and actual route callbacks', () => {
  it.each(['priceArea', 'resolution'])('rejects array coercion in original %s', field => {
    const c = control(), original = { ...wire(), [field]: [field === 'priceArea' ? 'SE3' : 'PT15M'] }
    expect(() => c.product.parseSyntheticSpotOriginal(Buffer.from(JSON.stringify(original)))).toThrow()
  })
  it.each(['status-type', 'area-type', 'resolution-type'])('rejects coerced receipt type %s on metadata read', async wrong => {
    const c = control({ wrong }); expect((await c.get()).status).toBe(502)
  })
  it('rejects array-valued review decision before any RPC', async () => {
    const c = control(), response = await c.review({ ...c.command, decision: ['review_capture'] })
    expect(response.status).toBe(400); expect(c.calls).toEqual([])
  })
  it('reconciles unknown capture outcome by own request key using only read RPC', async () => {
    const c = control(), response = await c.get(`requestKey=${uuid(6)}`)
    expect(response.status).toBe(200)
    expect(c.calls).toEqual([{ name: 'gridex_read_synthetic_spot_source_v1', args: { p_company_id: company, p_actor_user_id: actor, p_source_id: null, p_include_original: false, p_request_key: uuid(6) } }])
    expect((await response.json()).data.original_sha256).toBe(sha(c.original))
  })
  it.each([`id=${source}&requestKey=${uuid(6)}`, `requestKey=${uuid(6)}&requestKey=${uuid(7)}`, '', 'requestKey=bad'])('rejects ambiguous/malformed selector %s before RPC', async query => {
    const c = control(); expect((await c.get(query)).status).toBe(400); expect(c.calls).toEqual([])
  })
  it('keeps foreign-owner and unknown request-key responses uniformly private', async () => {
    const c = control({ rpcCode: 'P0002' }), first = await c.get(`requestKey=${uuid(6)}`), second = await c.get(`requestKey=${uuid(999)}`)
    expect(first.status).toBe(404); expect(second.status).toBe(404); expect(await first.text()).toBe(await second.text())
    expect(first.headers.get('cache-control')).toBe('private, no-store')
  })
  it.each([['2027-03', 'PT15M', 2972], ['2027-10', 'PT15M', 2980], ['2024-02', 'PT60M', 696]])('preserves all physical %s/%s intervals', (month, resolution, count) => {
    const c = control(), parsed = c.product.parseSyntheticSpotOriginal(Buffer.from(JSON.stringify(wire(String(month), String(resolution))))) as Record<string, unknown>
    expect(parsed.intervalCount).toBe(count)
  })
  it.each(['-0', '-0.000000', '100000.000001', '1e-3', '01', 'NaN', '0.1234567'])('rejects invalid decimal %s', price => {
    const c = control(), w = wire(); w.intervals[0].priceSekPerKwh = price
    expect(() => c.product.parseSyntheticSpotOriginal(Buffer.from(JSON.stringify(w)))).toThrow()
  })
  it.each(['gap', 'overlap', 'duplicate', 'missing', 'utc24', 'extra', 'zone', 'version', 'provider'])('rejects malformed original %s', kind => {
    const c = control(), w = wire()
    if (kind === 'gap') w.intervals.splice(1, 1)
    if (kind === 'overlap') w.intervals[1].start = w.intervals[0].start
    if (kind === 'duplicate') w.intervals[1] = w.intervals[0]
    if (kind === 'missing') w.intervals.pop()
    if (kind === 'utc24') w.intervals[0].start = '2027-02-28T24:00:00.000Z'
    if (kind === 'extra') Object.assign(w.intervals[0], { normalizedPrice: 1 })
    if (kind === 'zone') w.civilZone = 'UTC'
    if (kind === 'version') w.sourceVersion = 'é-real-provider'
    if (kind === 'provider') Object.assign(w, { provider: 'elprisetjustnu', companyId: uuid(999) })
    expect(() => c.product.parseSyntheticSpotOriginal(Buffer.from(JSON.stringify(w)))).toThrow()
  })
  it('rejects noncanonical, duplicate-key, BOM and invalid UTF8 originals', () => {
    const c = control(), text = c.original.toString()
    for (const body of [Buffer.from(' ' + text), Buffer.from(text.replace('"sourceVersion":"v1"', '"sourceVersion":"v1","sourceVersion":"v1"')), Buffer.concat([Buffer.from([239, 187, 191]), c.original]), Buffer.from([255])]) expect(() => c.product.parseSyntheticSpotOriginal(body)).toThrow()
  })
  it('captures exact original bytes with derived scope and no financial consumption', async () => {
    const c = control(), response = await c.post()
    expect(response.status).toBe(201)
    expect(c.requirements).toEqual([['pricing.write']])
    expect(c.calls).toHaveLength(1)
    expect(c.calls[0]).toEqual({ name: 'gridex_capture_synthetic_spot_source_v1', args: { p_company_id: company, p_actor_user_id: actor, p_request_key: uuid(6), p_original_base64: c.original.toString('base64') } })
    expect((await response.json()).data.consumer_enabled).toBe(false)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })
  it.each([401, 403])('does no RPC work when actual guard returns %s', async auth => {
    const c = control({ auth }); expect((await c.post()).status).toBe(auth); expect(c.calls).toEqual([])
  })
  it('rejects platform identity and operational-company uncertainty before RPC', async () => {
    for (const options of [{ platform: true }, { scopeError: true }]) { const c = control(options); const response = await c.post(); expect(response.status).toBe(403); expect(c.calls).toEqual([]); expect(await response.text()).not.toContain('PRIVATE_SECRET_SENTINEL') }
  })
  it.each(['hash', 'tuple', 'count', 'consumer', 'extra'])('refuses unqualified capture receipt %s without leaking details', async wrong => {
    const c = control({ wrong }), response = await c.post(); expect(response.status).toBe(502); expect(await response.text()).not.toContain('PRIVATE_SECRET_SENTINEL'); expect(c.calls).toHaveLength(1)
  })
  it('uses read OR write and downloads exact original bytes with private attachment headers', async () => {
    const c = control(), response = await c.get(`id=${source}&download=original`)
    expect(response.status).toBe(200); expect(Buffer.from(await response.arrayBuffer())).toEqual(c.original)
    expect(c.requirements).toEqual([{ anyOf: ['pricing.read', 'pricing.write'] }])
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(response.headers.get('content-disposition')).toBe(`attachment; filename="synthetic-spot-${source}.json"`)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })
  it('downloads reconciled original by key without mutation or normalizing SQL-admitted whitespace', async () => {
    const c = control({ archiveWhitespace: true }), response = await c.get(`requestKey=${uuid(6)}&download=original`)
    expect(response.status).toBe(200); expect(Buffer.from(await response.arrayBuffer())).toEqual(c.original)
    expect(c.calls).toEqual([{ name: 'gridex_read_synthetic_spot_source_v1', args: { p_company_id: company, p_actor_user_id: actor, p_source_id: null, p_include_original: true, p_request_key: uuid(6) } }])
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('content-disposition')).toContain(source)
  })
  it('rejects archived bytes that do not match the returned immutable hash and length', async () => {
    const c = control({ wrong: 'original' }), response = await c.get(`id=${source}&download=original`)
    expect(response.status).toBe(502); expect(c.calls).toHaveLength(1)
  })
  it('rejects malformed capture key without any mutation', async () => {
    const c = control(); expect((await c.post(c.original, 'bad')).status).toBe(400); expect(c.calls).toEqual([])
  })
  it('accepts exactly 500 Unicode reason characters without imposing a trim policy', async () => {
    const c = control(), reason = '😀'.repeat(499) + ' '
    expect((await c.review({ ...c.command, reason })).status).toBe(200)
    expect(c.calls[1].args.p_reason).toBe(reason)
  })
  it.each(['', '😀'.repeat(501), '\u0000', '\ud800'])('rejects invalid reason length or PostgreSQL text before RPC', async reason => {
    const c = control(); expect((await c.review({ ...c.command, reason })).status).toBe(400); expect(c.calls).toEqual([])
  })
  it('rejects client actor or extra review fields before RPC', async () => {
    const c = control(); expect((await c.review({ ...c.command, actorUserId: uuid(99) })).status).toBe(400); expect(c.calls).toEqual([])
  })
  it('does not leak foreign/unknown source existence or RPC diagnostics', async () => {
    const c = control({ rpcCode: 'P0002' }), first = await c.get(), second = await c.get(`id=${uuid(999)}`)
    expect(first.status).toBe(404); expect(second.status).toBe(404); expect(await first.text()).toBe(await second.text())
  })
  it('rejects returned foreign ID rather than trusting a nonempty receipt', async () => {
    const c = control({ wrong: 'source' }); expect((await c.get()).status).toBe(502)
  })
  it('awaits route params and reviews through only the read/review command ports', async () => {
    const c = control(), response = await c.review()
    expect(response.status).toBe(200); expect(c.calls.map(v => v.name)).toEqual(['gridex_read_synthetic_spot_source_v1', 'gridex_review_synthetic_spot_source_v1'])
    expect(c.calls[1].args).toEqual({ p_company_id: company, p_actor_user_id: actor, p_source_id: source, p_request_key: uuid(7), p_expected_previous_event_id: captureEvent, p_decision: 'review_capture', p_reason: c.command.reason })
  })
  it('accepts exact older review replay while retaining current later ledger head', async () => {
    const c = control({ replayReview: true }), response = await c.review(), body = await response.json()
    expect(response.status).toBe(200); expect(body.data.event_id).toBe(reviewEvent); expect(body.data.latest_event_id).toBe(uuid(8)); expect(body.data.status).toBe('rejected'); expect(body.data.consumer_enabled).toBe(false)
  })
  it.each([['42501', 403], ['23505', 409], ['22023', 400]])('maps fixed SQL refusal %s without exposing messages', async (rpcCode, status) => {
    const c = control({ rpcCode: String(rpcCode) }), response = await c.post(); expect(response.status).toBe(status); expect(await response.text()).not.toContain('PRIVATE_SECRET_SENTINEL')
  })
  it('never retries an uncertain mutation', async () => {
    const c = control({ transport: true }), response = await c.post(); expect(response.status).toBe(503); expect(c.calls).toHaveLength(1); expect(await response.text()).not.toContain('PRIVATE_SECRET_SENTINEL')
  })
  it('caps actual streamed bytes and cancels overflow despite a false Content-Length', async () => {
    const c = control(); let cancelled = false
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(1_048_577)) }, cancel() { cancelled = true } })
    const request = new Request('http://local/api/internal/pricing/synthetic-spot-sources', { method: 'POST', headers: { 'Idempotency-Key': uuid(6), 'Content-Length': '1' }, body: stream, duplex: 'half' } as RequestInit)
    const response = await c.routes.POST(request) as Response
    expect(response.status).toBe(413); expect(cancelled).toBe(true); expect(c.calls).toEqual([])
  })
})
