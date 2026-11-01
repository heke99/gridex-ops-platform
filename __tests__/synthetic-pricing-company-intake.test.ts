// Actual registered callbacks and unchanged outbound guard; only Auth/DB IO is finite.
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import * as crypto from 'node:crypto'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const actor = uuid(1), company = uuid(2), key = uuid(3), birth = uuid(4)
const declaration = 'SYNTHETIC_PRICING_COMPANY_NO_PRODUCTION_BILLING_OR_FINANCIAL_OUTPUT'
const command = { name: 'Synthetic Å 😀', slug: 'synthetic-test', declaration }
const hash = (name: string, slug: string, decl: string) => crypto.createHash('sha256').update('gridex-synthetic-pricing-company-command-v1\n' + [name, slug, decl].map(v => Buffer.byteLength(v) + ':' + v).join('')).digest('hex')
type Exports = Record<string, (...args: unknown[]) => unknown>
function evaluate(path: string, imports: Record<string, unknown>): Exports {
  const exports: Exports = {}
  runInNewContext(ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, require: (name: string) => { if (!(name in imports)) throw Error('undeclared IO: ' + name); return imports[name] }, Buffer, Request, Response, Headers, URL, TextDecoder, ReadableStream, Blob, console: { error() {} } })
  return exports
}
function intake(options: { platform?: boolean; auth?: number; code?: string; uncertain?: boolean; wrong?: string; replay?: boolean; name?: string } = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [], requirements: unknown[] = []
  const product = evaluate('lib/pricing/syntheticPricingCompanies.ts', {
    'node:crypto': crypto,
    '@/lib/admin/apiGuards': { requireAdminApiAccess: async (requirement: unknown) => { requirements.push(requirement); return options.auth ? { response: Response.json({ error: 'denied' }, { status: options.auth }) } : { guard: { userId: actor, isPlatformAdmin: options.platform ?? true } } } },
    '@/lib/supabase/service': { supabaseService: { rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args }); if (options.uncertain) throw Error('PRIVATE_SENTINEL')
      if (options.code) return { data: null, error: { code: options.code, message: 'PRIVATE_SENTINEL' } }
      const nameValue = options.name ?? command.name
      const data: Record<string, unknown> = { company_id: company, birth_id: birth, request_key: key, actor_user_id: actor, initial_name: nameValue, initial_slug: command.slug, declaration,
        command_sha256: hash(nameValue, command.slug, declaration), company_created_at: '2026-11-01T20:00:00.000Z', recorded_at: '2026-11-01T20:00:00.001Z',
        production_billing_prohibited: true, external_financial_delivery_prohibited: true, consumer_enabled: false, replayed: options.replay ?? false }
      if (options.wrong === 'hash') data.command_sha256 = 'a'.repeat(64)
      if (options.wrong === 'actor') data.actor_user_id = uuid(99)
      if (options.wrong === 'key') data.request_key = uuid(99)
      if (options.wrong === 'declaration') data.declaration = 'OTHER'
      if (options.wrong === 'protection') data.external_financial_delivery_prohibited = false
      if (options.wrong === 'consumer') data.consumer_enabled = true
      if (options.wrong === 'name') data.initial_name = 'Invalid\ud800'
      if (options.wrong === 'company') data.company_id = null
      if (options.wrong === 'reversed-time') data.recorded_at = '2026-11-01T19:59:59.999Z'
      if (options.wrong === 'time') data.recorded_at = '2026-11-01T24:00:00.000Z'
      if (options.wrong === 'extra') data.secret = 'PRIVATE_SENTINEL'
      return { data, error: null }
    } } },
  })
  const routes = evaluate('app/api/internal/pricing/synthetic-test-companies/route.ts', { '@/lib/pricing/syntheticPricingCompanies': product })
  const post = (body: unknown = command, requestKey = key) => routes.POST(new Request('http://local/api/internal/pricing/synthetic-test-companies', { method: 'POST', headers: { 'Idempotency-Key': requestKey }, body: typeof body === 'string' || body instanceof Uint8Array ? body as BodyInit : JSON.stringify(body) })) as Promise<Response>
  const get = (query = 'requestKey=' + key) => routes.GET(new Request('http://local/api/internal/pricing/synthetic-test-companies?' + query)) as Promise<Response>
  return { routes, calls, requirements, post, get }
}
function downloads(kind: 'export' | 'invoice', options: { frozen?: boolean; absent?: boolean; lookupError?: boolean; guardError?: boolean; foreign?: boolean; platform?: boolean; missingCompany?: boolean } = {}) {
  const events: string[] = [], observed: Array<{ table: string; field: string; value: unknown }> = []
  const persistedCompany = options.foreign ? uuid(99) : company
  const service = { from: (table: string) => {
    events.push('lookup:' + table)
    const chain = { select: () => chain, eq: (field: string, value: unknown) => { observed.push({ table, field, value }); return chain }, maybeSingle: async () => {
      if (table === 'companies') { events.push('guard'); if (options.guardError) return { data: null, error: Error('PRIVATE_SENTINEL') }; return { data: { outbound_frozen: false, outbound_frozen_channels: options.frozen ? ['invoice_export'] : [], status: 'active', is_active: true }, error: null } }
      return { data: options.absent ? null : { id: uuid(5), company_id: options.missingCompany ? null : persistedCompany }, error: options.lookupError ? Error('PRIVATE_SENTINEL') : null }
    } }; return chain
  } }
  const outbound = evaluate('lib/platform/outboundFreeze.ts', { '@/lib/supabase/service': { supabaseService: service } })
  const NextResponse = Response
  const route = evaluate(kind === 'export' ? 'app/admin/billing/export-center/[id]/download/route.ts' : 'app/admin/billing/invoice-files/[id]/route.ts', {
    'next/server': { NextResponse }, '@/lib/supabase/service': { supabaseService: service }, '@/lib/platform/outboundFreeze': outbound,
    '@/lib/admin/guards': { requireAdminPageKeyAccess: async () => ({ permissions: ['billing_underlay.export'], platform: options.platform }), isPlatformAdminContext: () => options.platform ?? false },
    '@/lib/tenant/adminScope': { resolveAdminSelectedCompanyReadScope: async () => ({ companyId: company }) },
    '@/lib/billing/exportCenter': { BillingExportNotFoundError: class extends Error {}, getBillingExportRunWithItems: async () => { events.push('load'); if (options.lookupError) throw Error('PRIVATE_SENTINEL'); return { run: { id: uuid(5), company_id: options.missingCompany ? null : persistedCompany }, items: [] } }, buildBillingExportFile: () => { events.push('build'); return { body: 'FILE_BYTES', contentType: 'text/csv', fileName: 'test.csv' } } },
    '@/lib/billing/invoiceFileExport': { loadInvoiceFile: async () => { events.push('load'); return { id: uuid(5), provider: 'file_export' } }, parseInvoiceFileFormat: () => 'csv', renderInvoiceFile: () => { events.push('render'); return { body: 'FILE_BYTES', contentType: 'text/csv', fileName: 'test.csv' } } },
  })
  const request = { nextUrl: new URL('http://local/download') }
  return { events, observed, get: () => route.GET(request, { params: Promise.resolve({ id: uuid(5) }) }) as Promise<Response> }
}
describe('protected synthetic pricing company actual intake and downloads', () => {
  it('creates only through narrow birth command with current platform guard and exact Unicode hash', async () => {
    const c = intake(), response = await c.post(); expect(response.status).toBe(201)
    expect(c.requirements).toEqual([[]]); expect(c.calls).toEqual([{ name: 'gridex_create_synthetic_pricing_company_v1', args: { p_actor_user_id: actor, p_request_key: key, p_name: command.name, p_slug: command.slug, p_declaration: declaration } }])
    const body = await response.json(); expect(body.data.command_sha256).toBe(hash(command.name, command.slug, declaration)); expect(body.data.consumer_enabled).toBe(false)
    expect(response.headers.get('cache-control')).toBe('private, no-store'); expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })
  it('reconciles own request key with only the read RPC', async () => { const c = intake(), r = await c.get(); expect(r.status).toBe(200); expect(c.calls).toEqual([{ name: 'gridex_read_synthetic_pricing_company_v1', args: { p_actor_user_id: actor, p_request_key: key } }]) })
  it('returns exact replay without another adapter command', async () => { const c = intake({ replay: true }); expect((await c.post()).status).toBe(200); expect(c.calls).toHaveLength(1) })
  it.each([401, 403, 503])('preserves current auth refusal %s privately before RPC', async auth => { const c = intake({ auth }), r = await c.post(); expect(r.status).toBe(auth); expect(c.calls).toEqual([]); expect(r.headers.get('cache-control')).toBe('private, no-store') })
  it('rejects ordinary pricing permission without platform authority', async () => { const c = intake({ platform: false }); expect((await c.post()).status).toBe(403); expect(c.calls).toEqual([]) })
  it.each(['name', 'slug', 'declaration'])('rejects array coercion for %s', async field => { const c = intake(); expect((await c.post({ ...command, [field]: [command[field as keyof typeof command]] })).status).toBe(400); expect(c.calls).toEqual([]) })
  it.each(['', ' a', 'a ', 'a\u0085b', 'a\u0000b', '\ud800', '😀'.repeat(201)])('rejects invalid scalar name %j', async name => { const c = intake(); expect((await c.post({ ...command, name })).status).toBe(400); expect(c.calls).toEqual([]) })
  it.each(['Upper', '-leading', 'trailing-', 'a_b', 'a'.repeat(64)])('rejects invalid slug %s', async slug => { const c = intake(); expect((await c.post({ ...command, slug })).status).toBe(400); expect(c.calls).toEqual([]) })
  it.each(['hash', 'actor', 'key', 'declaration', 'protection', 'consumer', 'time', 'extra', 'name', 'company'])('refuses forged receipt %s without diagnostics', async wrong => { const c = intake({ wrong }), r = await c.post(); expect(r.status).toBe(502); expect(await r.text()).not.toContain('PRIVATE_SENTINEL') })
  it('accepts exactly200 Unicode scalar values without normalization', async () => {
    const name = '😀'.repeat(199) + 'é', c = intake({ name }), r = await c.post({ ...command, name })
    expect(r.status).toBe(201); expect((await r.json()).data.initial_name).toBe(name)
    expect(c.calls[0].args.p_name).toBe(name)
  })
  it('rejects a forged read receipt independently of POST input', async () => {
    const c = intake({ wrong: 'hash' }); expect((await c.get()).status).toBe(502); expect(c.calls).toHaveLength(1)
  })
  it('rejects replay marker on read receipt', async () => { const c = intake({ replay: true }); expect((await c.get()).status).toBe(502) })
  it('keeps unknown and foreign-actor keys uniformly404 after current authorization', async () => {
    const c = intake({ code: 'P0002' }), first = await c.get(), second = await c.get('requestKey=' + uuid(999))
    expect(first.status).toBe(404); expect(second.status).toBe(404); expect(await first.text()).toBe(await second.text())
  })
  it('refuses birth receipt recorded before canonical company creation', async () => { const c = intake({ wrong: 'reversed-time' }); expect((await c.post()).status).toBe(502); expect(c.calls).toHaveLength(1) })
  it('rejects noncanonical, BOM, bad UTF8 and duplicate keys before RPC', async () => {
    for (const body of [' ' + JSON.stringify(command), JSON.stringify(command).replace('"name":', '"name":"other","name":'), Buffer.concat([Buffer.from([239,187,191]),Buffer.from(JSON.stringify(command))]), Buffer.from([255])]) {
      const c = intake(); expect((await c.post(body)).status).toBe(400); expect(c.calls).toEqual([])
    }
  })
  it('rejects company adoption, invitation and metadata fields', async () => { const c = intake(); expect((await c.post({ ...command, companyId: company, invitation: actor })).status).toBe(400); expect(c.calls).toEqual([]) })
  it.each(['', 'requestKey=bad', `requestKey=${key}&requestKey=${key}`, `requestKey=${key}&companyId=${company}`])('rejects malformed reconciliation selector %s', async query => { const c = intake(); expect((await c.get(query)).status).toBe(400); expect(c.calls).toEqual([]) })
  it.each([['42501',403],['22023',400],['23505',409],['P0002',404]])('maps fixed SQL code %s privately', async (code,status) => { const c = intake({ code: String(code) }), r = await c.get(); expect(r.status).toBe(status); expect(await r.text()).not.toContain('PRIVATE_SENTINEL') })
  it('does not retry uncertain creation', async () => { const c = intake({ uncertain: true }); expect((await c.post()).status).toBe(503); expect(c.calls).toHaveLength(1); expect(c.calls[0].name).toBe('gridex_create_synthetic_pricing_company_v1') })
  it('caps actual bytes at8KiB despite false Content-Length and cancels body', async () => {
    const c = intake(); let cancelled = false
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(8193)) }, cancel() { cancelled = true } })
    const r = await c.routes.POST(new Request('http://local', { method: 'POST', headers: { 'Idempotency-Key': key, 'Content-Length': '1' }, body: stream, duplex: 'half' } as RequestInit)) as Response
    expect(r.status).toBe(413); expect(cancelled).toBe(true); expect(c.calls).toEqual([])
  })
  it.each(['export','invoice'] as const)('%s refuses actual frozen persisted company before build/render', async kind => {
    const c = downloads(kind, { frozen: true, platform: kind === 'export' }), r = await c.get()
    expect(r.status).toBe(423); expect(c.events).not.toContain('build'); expect(c.events).not.toContain('render'); expect(await r.text()).not.toContain('FILE_BYTES')
    expect(c.observed).toContainEqual({ table: 'companies', field: 'id', value: company })
  })
  it.each(['export','invoice'] as const)('%s refuses lookup and outbound-check errors before rendering', async kind => {
    for (const options of [{ lookupError: true }, { guardError: true }, { missingCompany: true }]) { const c = downloads(kind, options), r = await c.get(); expect(r.status).toBeGreaterThanOrEqual(400); expect(c.events).not.toContain('build'); expect(c.events).not.toContain('render'); expect(await r.text()).not.toContain('PRIVATE_SENTINEL') }
  })
  it.each(['export','invoice'] as const)('%s preserves authorized existing unfrozen downloads', async kind => { const c = downloads(kind), r = await c.get(); expect(r.status).toBe(200); expect(await r.text()).toBe('FILE_BYTES'); expect(r.headers.get('cache-control')).toBe('private, no-store'); expect(r.headers.get('x-content-type-options')).toBe('nosniff'); expect(c.events.indexOf('guard')).toBeLessThan(c.events.indexOf(kind === 'export' ? 'build' : 'render')) })
  it('guards actual foreign run owner for platform download instead of selected company', async () => { const c = downloads('export', { foreign: true, platform: true, frozen: true }), r = await c.get(); expect(r.status).toBe(423); expect(c.observed).toContainEqual({ table: 'companies', field: 'id', value: uuid(99) }); expect(c.events).not.toContain('build') })
  it('rejects foreign persisted invoice metadata before load/render', async () => { const c = downloads('invoice', { foreign: true }), r = await c.get(); expect(r.status).toBe(404); expect(c.events).not.toContain('load'); expect(c.events).not.toContain('render') })
})
