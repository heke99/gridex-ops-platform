import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// Actual registered scenario callbacks/projections, finite declared ports only.
// The VM registration technique follows the preserved T2 private counterexample;
// this new model does not execute SQL, a server, Storage or a business scenario.
const source = path.resolve(__dirname, '../scripts/simulation/track5/scenarios/api01.test.ts')
const localRequire = createRequire(source)
const sha = (x: string | Buffer) => createHash('sha256').update(x).digest('hex')
const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
type Row = Record<string, unknown>
const lanes = ['public.customers', 'public.customer_sites', 'public.customer_contracts', 'public.powers_of_attorney',
  'public.power_of_attorney_scopes', 'public.power_of_attorney_events', 'public.customer_billing_profile_revisions',
  'public.company_customer_number_sequences', 'public.domain_events', 'public.webhook_deliveries', 'public.customer_site_resolution',
  'public.canonical_energy_flow_events', 'public.canonical_energy_remediation_queue', 'public.customer_operation_jobs',
  'public.customer_operation_tasks', 'public.customer_operation_events', 'gridex_correction_process.facts',
  'gridex_correction_process.gaps', 'gridex_one_off_offer_binding.reservations']
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
// JSONB may return nested objects in a different key order from the first
// HTTP response. Preserve every key/value while exercising that real boundary.
const reordered = (value: unknown): unknown => Array.isArray(value) ? value.map(reordered)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reordered(v)])) : value
type Options = { mutateLane?: string; fault?: string }
function fixture(options: Options = {}) {
  let setup: (() => Promise<void>) | undefined, companyCounter = 0, next = 100, sqlCustomers = 0, injected = false
  const tests = new Map<string, () => Promise<void>>(), graph: Record<string, Row[]> = Object.fromEntries(lanes.map(x => [x, []]))
  const ledger: Row[] = [], receipts: Array<{ step: string; data: Row }> = [], requests: Array<{ resource: string; key: string | null }> = []
  const objects = new Map<string, { id: string; bytes: Buffer }>(), listCalls: Array<{ prefix: string; offset: number }> = [], downloads: string[] = []
  const A = uuid(1), B = uuid(2), client = uuid(30), offer = { offerId: uuid(90), offerReference: 'offer_controlled', publicationVersionId: uuid(91) }
  const id = () => uuid(++next)
  const response = (status: number, body: Row) => ({ status, json: body, text: JSON.stringify(body), headers: new Headers({ 'x-request-id': id() }) })
  const row = (lane: string, fields: Row) => { const value = { id: id(), company_id: A, ...fields }; graph[lane].push(value); return value }
  const customer = (reference: string) => {
    const matches = graph['public.customers'].filter(x => x.customer_reference === reference)
    if (matches.length !== 1) throw Error('UNDECLARED_CUSTOMER_REFERENCE')
    return matches[0]
  }
  function seedObservationRows() {
    for (const lane of lanes.slice(4)) {
      const fields: Row = { observed_fixture: 'unchanged', customer_id: graph['public.customers'][0].id }
      if (lane === 'gridex_correction_process.gaps') { delete fields.customer_id; fields.fact_id = graph['gridex_correction_process.facts'][0].id }
      row(lane, fields)
    }
    for (let i = 0; i < 33; i++) objects.set(`partner-api/${A}/existing-${String(i).padStart(2, '0')}.pdf`, { id: id(), bytes: Buffer.from('%PDF-controlled-existing') })
    objects.set(`partner-api/${A}/folder/existing.pdf`, { id: id(), bytes: Buffer.from('%PDF-controlled-folder') })
  }
  const ports: Record<string, unknown> = {
    vitest: { expect, describe: (_: string, fn: () => void) => fn(), beforeAll: (fn: () => Promise<void>) => { setup = fn }, afterAll: () => undefined, it: (name: string, fn: () => Promise<void>) => tests.set(name, fn) },
    '../lib': {
      SIM_HOME: '/CONTROLLED-NOT-USED',
      psql(sql: string) {
        const match = /^select customer_reference from public.customers where id='([^']+)'$/.exec(sql)
        if (!match) throw Error('UNDECLARED_SQL_EFFECT')
        const found = graph['public.customers'].find(x => x.id === match[1]); if (!found) throw Error('UNDECLARED_SQL_CUSTOMER')
        return found.customer_reference
      },
      psqlRows(sql: string) {
        if (sql.startsWith('/* API04_OFFER_V1 */')) {
          expect(sql).toContain('JOIN public.contract_publications cp'); expect(sql).toContain(`cp.company_id='${A}'`)
          return [{ company_id: A, id: offer.publicationVersionId, offer_reference: offer.offerReference, channel: 'api', status: options.fault === 'unpublished-offer' ? 'draft' : 'published' }]
        }
        if (sql.startsWith('/* API04_FULL_GRAPH_V1 */')) {
          for (const lane of lanes) expect(sql).toContain(`FROM ${lane} t`)
          expect(sql).toContain(`JOIN gridex_correction_process.facts f ON f.id=t.fact_id WHERE f.company_id IN ('${A}','${B}')`)
          expect(sql.match(/WHERE t.company_id IN/g)).toHaveLength(18)
          return lanes.filter(x => !(options.fault === 'omitted-lane' && x === lanes[18])).map(lane => ({ lane, rows: graph[lane].map(canonical).sort() }))
        }
        if (sql.startsWith('/* API04_LEDGER_V1 */')) {
          expect(sql).toContain(`t.company_id IN ('${A}','${B}')`); return ledger.map(x => ({ raw: canonical(x) }))
        }
        throw Error('UNDECLARED_SQL_QUERY')
      },
      serviceClient: () => ({ storage: { from(bucket: string) {
        expect(bucket).toBe('customer-documents')
        return {
          async list(prefix: string, query: { limit: number; offset: number; sortBy: { column: string; order: string } }) {
            expect(prefix === `partner-api/${A}` || prefix === `partner-api/${B}` || prefix.startsWith(`partner-api/${A}/folder`)).toBe(true)
            expect(query).toMatchObject({ limit: 32, sortBy: { column: 'name', order: 'asc' } }); listCalls.push({ prefix, offset: query.offset })
            const names = new Map<string, Row>()
            for (const [name, value] of objects) if (name.startsWith(prefix + '/')) {
              const relative = name.slice(prefix.length + 1), folder = relative.includes('/'), child = relative.split('/')[0]
              names.set(child, folder ? { name: child, id: null, metadata: null } : { name: child, id: value.id, created_at: '2026-01-01', updated_at: '2026-01-01', metadata: { size: value.bytes.length, mimetype: 'application/pdf' } })
            }
            const all = [...names.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)))
            const offset = options.fault === 'repeated-storage-page' && query.offset > 0 ? 0 : query.offset
            return { error: null, data: all.slice(offset, offset + query.limit) }
          },
          async download(name: string) {
            const value = objects.get(name); if (!value) throw Error('UNDECLARED_STORAGE_DOWNLOAD')
            downloads.push(name)
            return options.fault === 'storage-unavailable' ? { error: { message: 'controlled' }, data: null } : { error: null, data: new Blob([Uint8Array.from(value.bytes)]) }
          },
        }
      } } }),
    },
    '../lib/api01-offer': { publishApiOffer: async () => { if (options.fault === 'offer-failed') throw Error('CONTROLLED_OFFER_FAILURE'); return offer } },
    '../lib/partner': {
      brief: (r: { status: number }) => `controlled HTTP${r.status}`,
      createPartnerClient: (companyId: string) => ({ id: companyId === A ? client : uuid(31), companyId, token: 'generated-finite-fixture-only' }),
      async partner(_client: unknown, method: string, resource: string, body: Row, opts: { idempotencyKey: string | null }) {
        expect(method).toBe('POST'); expect(_client).toMatchObject({ id: client, companyId: A }); requests.push({ resource, key: opts.idempotencyKey })
        if (options.fault === 'transport-error') throw Error('CONTROLLED_TRANSPORT_FAILURE')
        if (opts.idempotencyKey === null) return response(options.fault === 'auth401' ? 401 : 400, { error: { code: options.fault === 'auth401' ? 'invalid_api_token' : 'idempotency_key_required' } })
        if (resource === 'customer' && options.fault === 'first500') return response(500, { error: { code: 'controlled_schema_not_ready' } })
        const kind = resource === 'customer' ? 'customer' : resource === 'contract' ? 'contract' : resource.endsWith('/powerofattorney') ? 'poa' : resource.endsWith('/site') ? 'site' : 'UNDECLARED'
        if (kind === 'UNDECLARED') throw Error('UNDECLARED_PARTNER_ROUTE')
        const parts = resource.split('/'), c = ['site', 'poa'].includes(kind) ? customer(parts[1]) : null
        const site = kind === 'poa' ? graph['public.customer_sites'].find(x => x.facility_reference === parts[3]) : null
        if (kind === 'poa' && !site) throw Error('UNDECLARED_SITE_REFERENCE')
        const pdf = kind === 'poa' ? body : kind === 'contract' ? body.power_of_attorney as Row : null
        const payload = kind === 'poa' ? { ...body, file_base64: 'sha256:' + sha(Buffer.from(String(body.file_base64), 'base64')) } : kind === 'contract' ? { customer: body.customer, site: body.site, power_of_attorney: { poa_type: 'web', transaction_type: 'SWITCH', file_sha256: sha(Buffer.from(String(pdf!.file_base64), 'base64')) } } : body
        const operation = kind === 'site' ? '/api/partner/v1/customer/{customer_id}/site' : kind === 'poa' ? '/api/partner/v1/customer/{customer_id}/site/{site_id}/powerofattorney' : '/api/partner/v1/' + kind
        const previous = ledger.find(x => x.idempotency_key === opts.idempotencyKey)
        if (previous) {
          if (previous.request_hash !== sha(canonical(payload)) || (kind === 'poa' && previous.site_id !== site!.id)) return response(409, { error: { code: options.fault === 'wrong409' ? 'UNRELATED_BUSINESS_CONFLICT' : 'idempotency_conflict' } })
          if (!injected) {
            if (options.mutateLane && graph[options.mutateLane].length) { graph[options.mutateLane][0].observed_fixture = 'same-count-mutation'; injected = true }
            else if (options.fault === 'hidden-event') { row('public.domain_events', { event_type: 'customer.updated', subject_customer_id: c?.id }); injected = true }
            else if (options.fault === 'orphan-pdf') { objects.set(`partner-api/${A}/orphan.pdf`, { id: id(), bytes: Buffer.from('%PDF-orphan') }); injected = true }
            else if (options.fault === 'replaced-pdf') { const v = objects.values().next().value!; v.bytes = Buffer.alloc(v.bytes.length, 88); injected = true }
          }
          const status = options.fault === 'replay200' ? 200 : 201, result = previous.response_body as Row
          return response(status, options.fault === 'body-drift' ? { ...result, unexpected: true }
            : options.fault === 'jsonb-key-order' ? reordered(result) as Row : result)
        }
        let ownCustomer = c, ownSite = site, poa: Row | null = null, contract: Row | null = null
        if (kind === 'customer' || kind === 'contract') ownCustomer = row('public.customers', { customer_reference: `customer_${next}`, company_id: options.fault === 'foreign-customer' ? B : A })
        if (kind === 'site' || kind === 'contract') ownSite = row('public.customer_sites', { facility_reference: `site_${next}`, customer_id: ownCustomer!.id })
        if (kind === 'poa' || kind === 'contract') {
          const name = `partner-api/${A}/${id()}.pdf`, bytes = Buffer.from(String(pdf!.file_base64), 'base64'); objects.set(name, { id: id(), bytes })
          poa = row('public.powers_of_attorney', { power_of_attorney_reference: `poa_${next}`, customer_id: ownCustomer!.id, site_id: ownSite!.id, customer_site_id: options.fault === 'wrong-poa-site' ? uuid(999) : ownSite!.id, status: 'signed', document_path: name, document_hash: options.fault === 'wrong-pdf-hash' ? 'bad-hash' : sha(bytes) })
        }
        if (kind === 'contract') contract = row('public.customer_contracts', { customer_contract_reference: `contract_${next}`, customer_id: ownCustomer!.id, site_id: ownSite!.id, customer_site_id: ownSite!.id, offer_reference: offer.offerReference, contract_publication_version_id: options.fault === 'wrong-offer-version' ? uuid(999) : offer.publicationVersionId })
        const result: Row = kind === 'contract' ? { entity_id: contract!.customer_contract_reference, customer: { entity_id: ownCustomer!.customer_reference }, site: { entity_id: ownSite!.facility_reference }, power_of_attorney: { entity_id: poa!.power_of_attorney_reference } } : { entity_id: kind === 'customer' ? ownCustomer!.customer_reference : kind === 'site' ? ownSite!.facility_reference : poa!.power_of_attorney_reference }
        if (options.fault === 'extra-customer') row('public.customers', { customer_reference: `customer_extra_${next}` })
        if (options.fault === 'extra-first-pdf') objects.set(`partner-api/${A}/extra-first.pdf`, { id: id(), bytes: Buffer.from('%PDF-extra') })
        const record: Row = { id: id(), company_id: A, api_client_id: client, customer_id: c?.id ?? null, route: operation, site_id: ownSite?.id ?? null, idempotency_key: opts.idempotencyKey, request_hash: sha(canonical(payload)), status: 'completed', response_status: 201, response_body: result }
        if (options.fault === 'wrong-ledger-hash') record.request_hash = '0'.repeat(64)
        if (options.fault === 'incomplete-ledger') record.status = 'processing'
        if (options.fault !== 'missing-ledger') ledger.push(record)
        if (options.fault === 'duplicate-ledger') ledger.push({ ...record, id: id() })
        return response(201, result)
      },
    },
    '../lib/auth01-jar': { loginViaUi: () => { throw Error('UNDECLARED_AUTH') } },
    '../lib/server-action': { callServerAction: () => { throw Error('UNDECLARED_SERVER_ACTION') } },
    '../lib/receipts': { sha256: sha, http: (status: number, text: string) => ({ status, bodySha256: sha(text) }), receipt: (_: string, step: string, data: Row) => receipts.push({ step, data }) },
    '../lib/t5-world': {
      createCompany: () => uuid(++companyCounter), createAuthUser: async () => ({ userId: uuid(3), email: 'fixture@example.invalid', password: 'runtime-fixture-not-credential' }), grantAdmin: () => undefined, deleteAuthUser: async () => undefined,
      createCustomer: () => { const c = row('public.customers', { customer_reference: `customer_fixture_${++sqlCustomers}` }); if (sqlCustomers === 2) seedObservationRows(); return c.id },
    },
  }
  const compiled = ts.transpileModule(fs.readFileSync(source, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  runInNewContext(compiled, { exports: {}, require: (name: string) => Object.hasOwn(ports, name) ? ports[name] : name.startsWith('node:') ? localRequire(name) : (() => { throw Error('UNDECLARED_IMPORT:' + name) })(), Buffer, Blob, Headers, FormData, URL, console }, { filename: source })
  return { async run() { expect(setup).toBeTypeOf('function'); await setup!(); const selected = [...tests].filter(([name]) => name.startsWith('API01.04 ')); expect(selected).toHaveLength(1); await selected[0][1]() }, receipts, requests, graph, ledger, objects, listCalls, downloads, injected: () => injected }
}

describe('API01.04 actual callback, finite source contract only', () => {
  it('accepts JSONB key reordering with unchanged nested response values', async () => {
    const f = fixture({ fault: 'jsonb-key-order' }); await f.run()
    expect(f.receipts.find(x => x.step === 'complete')?.data.exercised).toEqual(['contract', 'customer', 'poa', 'site'])
  })
  it('first proves all four real registered lanes, exact ledger/body/graph and paginated physical PDFs', async () => {
    const f = fixture(); await f.run()
    expect(f.requests.filter(x => x.key && ['customer', 'contract'].includes(x.resource))).toHaveLength(6)
    expect(f.receipts.find(x => x.step === 'complete')?.data.exercised).toEqual(['contract', 'customer', 'poa', 'site'])
    expect(f.ledger).toHaveLength(5)
    expect(f.listCalls.some(x => x.offset === 32)).toBe(true)
    expect(f.listCalls.some(x => x.prefix.endsWith('/folder'))).toBe(true)
    expect(f.downloads.some(x => x.endsWith('/folder/existing.pdf'))).toBe(true)
    expect(f.requests.some(x => x.resource.includes('customer_fixture_'))).toBe(false)
  })
  for (const [fault, assertion] of [
    ['offer-failed', 'offer_prerequisite'], ['unpublished-offer', 'offer_lineage'], ['first500', 'first_201'],
    ['foreign-customer', 'customer_lineage'], ['wrong-poa-site', 'poa_lineage'], ['wrong-offer-version', 'contract_lineage'],
    ['extra-customer', 'first_entity_delta'], ['extra-first-pdf', 'first_storage_delta'],
    ['missing-ledger', 'ledger_exact_once'], ['duplicate-ledger', 'ledger_exact_once'], ['wrong-ledger-hash', 'ledger_completed_response_hash'], ['incomplete-ledger', 'ledger_completed_response_hash'],
    ['body-drift', 'replay_status_body'], ['replay200', 'replay_status_body'], ['wrong409', 'conflict_semantics'], ['auth401', 'missing_key_semantics'],
    ['hidden-event', 'graph_changed_replay'], ['orphan-pdf', 'storage_changed_replay'], ['replaced-pdf', 'storage_changed_replay'],
    ['wrong-pdf-hash', 'pdf_physical_lineage'], ['omitted-lane', 'graph_complete'], ['repeated-storage-page', 'storage_duplicate'], ['storage-unavailable', 'storage_download'],
  ]) it(`rejects ${fault} at its intended actual assertion`, async () => {
    const f = fixture({ fault }); await expect(f.run()).rejects.toThrow(`api04_${assertion}`)
    expect(f.receipts.some(x => x.step === 'complete')).toBe(false)
  })
  for (const lane of lanes) it(`rejects same-count mutation in ${lane}`, async () => {
    const f = fixture({ mutateLane: lane }); await expect(f.run()).rejects.toThrow('api04_graph_changed_replay')
    expect(f.injected()).toBe(true); expect(f.receipts.some(x => x.step === 'complete')).toBe(false)
  })
  it('propagates transport failure after the actual first requested route, without a completion receipt', async () => {
    const f = fixture({ fault: 'transport-error' }); await expect(f.run()).rejects.toThrow('CONTROLLED_TRANSPORT_FAILURE')
    expect(f.requests).toHaveLength(1); expect(f.requests[0].resource).toBe('customer'); expect(f.receipts).toHaveLength(0)
  })
})
