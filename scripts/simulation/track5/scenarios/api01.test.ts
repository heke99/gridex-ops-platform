// executionScope: ISOLATED_NATIVE
// masterplan-sim: API01.01-.05
// Spår 5, API01: partner-API:t (app/api/partner/v1/[[...path]]) via HTTP med riktiga nycklar och Idempotency-Key.
// Orakel: definitionsbeskrivningen per ID (original sha 96518c18…) tillämpad på spårets egna bolag A/B. DB-readback
// med psql. Nyckel-, bolags- och erbjudandefixtur är backendersättning (se lib/partner.ts, lib/api01-offer.ts).
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { psql, psqlRows, serviceClient } from '../lib'
import { publishApiOffer, type ApiOffer } from '../lib/api01-offer'
import { brief, createPartnerClient, partner, type PartnerClient, type PartnerResponse } from '../lib/partner'
import { loginViaUi } from '../lib/auth01-jar'
import { http, receipt, sha256 } from '../lib/receipts'
import { callServerAction } from '../lib/server-action'
import { createAuthUser, createCompany, createCustomer, deleteAuthUser, grantAdmin, type T5User } from '../lib/t5-world'

const rec = (id: string, step: string, r: PartnerResponse, extra: Record<string, unknown> = {}) =>
  receipt(id, step, { ...http(r.status, r.text), requestId: r.headers.get('x-request-id'), entityId: (r.json as { entity_id?: unknown } | null)?.entity_id ?? null, errorCode: (r.json as { error?: { code?: unknown } } | null)?.error?.code ?? null, ...extra })

const WRITE_SCOPES = ['partner_customers.write', 'partner_sites.write', 'partner_power_of_attorney.write', 'partner_contracts.write',
  'customer_profile.read', 'customer_sites.read', 'customer_power_of_attorney.read']

/** Minimal, strukturellt giltig PDF (header, katalog, sida, xref med riktiga offset, startxref, %%EOF). */
function minimalPdfBase64(label: string): string {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>`]
  const stream = `BT /F1 12 Tf 20 100 Td (${label}) Tj ET`
  objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1').toString('base64')
}

/** Syntetiskt personnummer med giltig Luhn-kontrollsiffra (19 + YYMMDD + 3 siffror + kontroll). */
function syntheticPersonnummer(seed: number): string {
  const base = `9001${String(10 + (seed % 18)).padStart(2, '0')}${String(900 + (seed % 99)).padStart(3, '0')}`
  let sum = 0
  for (let i = 0; i < base.length; i++) {
    let d = Number(base[i]) * (i % 2 === 0 ? 2 : 1)
    if (d > 9) d -= 9
    sum += d
  }
  return `19${base}${(10 - (sum % 10)) % 10}`
}

const customerBody = (seed: number, label: string) => ({
  first_name: 'Sim', last_name: label, soc_id: syntheticPersonnummer(seed), customer_type: 'PRIVATE',
  invoice_address: 'Testgatan 1', zip_code: '12345', city: 'Teststad', country: 'SE',
  email: `t5-${label.toLowerCase()}-${seed}@example.invalid`, cell_phone: '0701234567',
})
const siteBody = (n: number) => ({ address: `Simvägen ${n}`, zip_code: '12345', city: 'Teststad', country: 'SE', site_electricity_type: 'CONSUMPTION' })
const poaBody = (label: string) => ({ poa_type: 'WEB', transaction_type: 'SWITCH', file_base64: minimalPdfBase64(label), file_extension: 'pdf' })

const countRows = (table: string, companyId: string) => Number(psql(`select count(*) from public.${table} where company_id='${companyId}'`))
const companyCounts = (companyId: string) => ({
  customers: countRows('customers', companyId), sites: countRows('customer_sites', companyId),
  poas: countRows('powers_of_attorney', companyId), contracts: countRows('customer_contracts', companyId),
})
const entity = (r: { json: unknown }) => String((r.json as { entity_id?: unknown } | null)?.entity_id ?? '')

// API01.04 observes the real owned graph; finite contract tests exercise these
// same projections/callback through declared ports. This is not native proof.
const API04_RELATIONS = [
  'public.customers', 'public.customer_sites', 'public.customer_contracts', 'public.powers_of_attorney',
  'public.power_of_attorney_scopes', 'public.power_of_attorney_events', 'public.customer_billing_profile_revisions',
  'public.company_customer_number_sequences', 'public.domain_events', 'public.webhook_deliveries',
  'public.customer_site_resolution', 'public.canonical_energy_flow_events', 'public.canonical_energy_remediation_queue',
  'public.customer_operation_jobs', 'public.customer_operation_tasks', 'public.customer_operation_events',
  'gridex_correction_process.facts', 'gridex_correction_process.gaps', 'gridex_one_off_offer_binding.reservations',
] as const
 type Api04Row = Record<string, unknown>
 type Api04World = { graph: Record<string, string[]>; ledger: string[]; objects: Array<{ company: string; name: string; raw: string; hash: string; size: number }> }
 function api04Require(value: unknown, code: string): asserts value { if (!value) throw new Error(`api04_${code}`) }
 function api04Canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(api04Canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${api04Canonical(v)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
 }
 const api04Uuid = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v)
 function api04Object(value: unknown): Api04Row { api04Require(value && typeof value === 'object' && !Array.isArray(value), 'response_object'); return value as Api04Row }
 function api04Reference(value: unknown): string { api04Require(typeof value === 'string' && /^[a-z][a-z0-9]*_[A-Za-z0-9_-]+$/.test(value) && value.length < 200, 'public_reference'); return value }
 const api04Rows = (world: Api04World, lane: string): Api04Row[] => world.graph[lane].map(x => api04Object(JSON.parse(x)))
 function api04One(world: Api04World, lane: string, field: string, value: unknown): Api04Row {
  const rows = api04Rows(world, lane).filter(row => row[field] === value); api04Require(rows.length === 1, 'unique_lineage'); return rows[0]
 }
 async function api04Observe(companies: string[]): Promise<Api04World> {
  api04Require(companies.length === 2 && companies.every(api04Uuid) && companies[0] !== companies[1], 'owned_companies')
  const scope = companies.map(x => `'${x}'`).join(',')
  const statements = API04_RELATIONS.map(lane => {
    const filter = lane === 'gridex_correction_process.gaps'
      ? `JOIN gridex_correction_process.facts f ON f.id=t.fact_id WHERE f.company_id IN (${scope})`
      : `WHERE t.company_id IN (${scope})`
    // Row text preserves large numeric values exactly through psqlRows JSON.
    return `SELECT '${lane}' lane, coalesce(jsonb_agg(row_bytes ORDER BY row_bytes),'[]'::jsonb) rows FROM (SELECT to_jsonb(t)::text row_bytes FROM ${lane} t ${filter}) owned_rows`
  })
  const raw = psqlRows<{ lane: string; rows: unknown }>(`/* API04_FULL_GRAPH_V1 */ ${statements.join(' UNION ALL ')}`)
  api04Require(raw.length === API04_RELATIONS.length && new Set(raw.map(x => x.lane)).size === API04_RELATIONS.length, 'graph_complete')
  const graph: Record<string, string[]> = {}
  for (const lane of API04_RELATIONS) {
    const found = raw.find(x => x.lane === lane); api04Require(found && Array.isArray(found.rows) && found.rows.every(x => typeof x === 'string'), 'graph_lane')
    graph[lane] = [...found.rows].sort()
    api04Require(new Set(graph[lane]).size === graph[lane].length, 'duplicate_graph_row')
  }
  const facts = new Map(graph['gridex_correction_process.facts'].map(x => { const r = api04Object(JSON.parse(x)); return [r.id, r.company_id] }))
  for (const lane of API04_RELATIONS) for (const rawRow of graph[lane]) {
    const row = api04Object(JSON.parse(rawRow)), owner = lane === 'gridex_correction_process.gaps' ? facts.get(row.fact_id) : row.company_id
    api04Require(companies.includes(String(owner)), 'graph_foreign_scope')
  }
  const ledgerRows = psqlRows<{ raw: unknown }>(`/* API04_LEDGER_V1 */ SELECT to_jsonb(t)::text raw FROM public.customer_portal_write_idempotency t WHERE t.company_id IN (${scope}) ORDER BY to_jsonb(t)::text`)
  api04Require(ledgerRows.every(x => typeof x.raw === 'string'), 'ledger_rows')
  const ledger = ledgerRows.map(x => x.raw as string).sort()
  for (const rawRow of ledger) api04Require(companies.includes(String(api04Object(JSON.parse(rawRow)).company_id)), 'ledger_foreign_scope')
  const objects: Api04World['objects'] = [], bucket = serviceClient().storage.from('customer-documents')
  for (const company of companies) {
    const root = `partner-api/${company}`, pending = [root], seen = new Set<string>(); let bytes = 0
    while (pending.length) {
      api04Require(seen.size < 4096 && pending.length <= 64, 'storage_limit')
      const prefix = pending.shift()!; let ended = false
      for (let page = 0; page < 128; page++) {
        const response = await bucket.list(prefix, { limit: 32, offset: page * 32, sortBy: { column: 'name', order: 'asc' } })
        api04Require(!response.error && Array.isArray(response.data) && response.data.length <= 32, 'storage_list')
        for (const entry of response.data) {
          api04Require(typeof entry.name === 'string' && entry.name.length > 0 && !entry.name.includes('/') && !entry.name.includes('\\') && !['.', '..'].includes(entry.name), 'storage_name')
          const name = `${prefix}/${entry.name}`; api04Require(!seen.has(name) && name.startsWith(root + '/'), 'storage_duplicate'); seen.add(name)
          if (!entry.id && !entry.metadata) { pending.push(name); continue }
          api04Require(typeof entry.id === 'string' && entry.metadata && typeof entry.metadata.size === 'number', 'storage_identity')
          const downloaded = await bucket.download(name)
          api04Require(!downloaded.error && downloaded.data instanceof Blob, 'storage_download')
          const data = Buffer.from(await downloaded.data.arrayBuffer()); bytes += data.length
          api04Require(data.length === entry.metadata.size && bytes <= 64 * 1024 * 1024, 'storage_size')
          objects.push({ company, name, raw: api04Canonical(entry), hash: sha256(data), size: data.length })
        }
        if (response.data.length < 32) { ended = true; break }
      }
      api04Require(ended, 'storage_incomplete')
    }
  }
  objects.sort((a, b) => a.name.localeCompare(b.name))
  return { graph, ledger, objects }
 }
 function api04Same(before: Api04World, after: Api04World, phase: string) {
  api04Require(api04Canonical(before.graph) === api04Canonical(after.graph), `graph_changed_${phase}`)
  api04Require(api04Canonical(before.ledger) === api04Canonical(after.ledger), `ledger_changed_${phase}`)
  api04Require(api04Canonical(before.objects) === api04Canonical(after.objects), `storage_changed_${phase}`)
 }
 function api04Ledger(world: Api04World, input: { company: string; client: string; customer: unknown; operation: string; key: string; payload: unknown; response: PartnerResponse }) {
  const rows = world.ledger.map(x => api04Object(JSON.parse(x))).filter(r => r.company_id === input.company && r.api_client_id === input.client && r.customer_id === input.customer && r.route === input.operation && r.idempotency_key === input.key)
  api04Require(rows.length === 1, 'ledger_exact_once')
  const row = rows[0]
  api04Require(api04Uuid(row.id) && row.status === 'completed' && row.response_status === 201 && row.request_hash === sha256(api04Canonical(input.payload)) && api04Canonical(row.response_body) === api04Canonical(input.response.json), 'ledger_completed_response_hash')
 }
 function api04First(before: Api04World, after: Api04World, input: { company: string; foreign: string; kind: string; response: PartnerResponse; customerRef?: string; siteRef?: string; pdf?: string; offer: ApiOffer }) {
  const out = api04Object(input.response.json), ref = api04Reference(out.entity_id)
  const customerRef = input.kind === 'customer' ? ref : input.kind === 'contract' ? api04Reference(api04Object(out.customer).entity_id) : input.customerRef!
  const customer = api04One(after, 'public.customers', 'customer_reference', customerRef)
  api04Require(customer.company_id === input.company && api04Uuid(customer.id), 'customer_lineage')
  let site: Api04Row | undefined, poa: Api04Row | undefined
  if (input.kind !== 'customer') {
    const siteRef = input.kind === 'site' ? ref : input.kind === 'contract' ? api04Reference(api04Object(out.site).entity_id) : input.siteRef!
    site = api04One(after, 'public.customer_sites', 'facility_reference', siteRef)
    api04Require(site.company_id === input.company && site.customer_id === customer.id && api04Uuid(site.id), 'site_lineage')
  }
  if (input.kind === 'poa' || input.kind === 'contract') {
    const poaRef = input.kind === 'poa' ? ref : api04Reference(api04Object(out.power_of_attorney).entity_id)
    poa = api04One(after, 'public.powers_of_attorney', 'power_of_attorney_reference', poaRef)
    api04Require(poa.company_id === input.company && poa.customer_id === customer.id && poa.customer_site_id === site!.id && poa.site_id === site!.id && poa.status === 'signed', 'poa_lineage')
    const bytes = Buffer.from(input.pdf!, 'base64'), files = after.objects.filter(x => x.company === input.company && x.name === poa!.document_path)
    api04Require(files.length === 1 && files[0].hash === sha256(bytes) && files[0].size === bytes.length && poa.document_hash === sha256(bytes), 'pdf_physical_lineage')
  }
  if (input.kind === 'contract') {
    const row = api04One(after, 'public.customer_contracts', 'customer_contract_reference', ref)
    api04Require(row.company_id === input.company && row.customer_id === customer.id && row.site_id === site!.id && row.customer_site_id === site!.id && row.offer_reference === input.offer.offerReference && row.contract_publication_version_id === input.offer.publicationVersionId, 'contract_lineage')
  }
  const entities = ['public.customers', 'public.customer_sites', 'public.powers_of_attorney', 'public.customer_contracts']
  const expected = input.kind === 'contract' ? [1, 1, 1, 1] : entities.map((_, i) => Number(i === ['customer', 'site', 'poa', 'contract'].indexOf(input.kind)))
  for (const [index, lane] of entities.entries()) {
    api04Require(after.graph[lane].length - before.graph[lane].length === expected[index] && before.graph[lane].every(x => after.graph[lane].includes(x)), 'first_entity_delta')
  }
  api04Require(after.objects.length - before.objects.length === Number(Boolean(poa)) && before.objects.every(x => after.objects.some(y => api04Canonical(x) === api04Canonical(y))), 'first_storage_delta')
  // Every auxiliary delta must have a causal own entity, never a foreign row.
  const ids = new Set([customer.id, site?.id, poa?.id, ref, customerRef, input.siteRef].filter(Boolean))
  for (const lane of API04_RELATIONS) {
    if (entities.includes(lane)) continue
    const old = before.graph[lane], added = after.graph[lane].filter(x => !old.includes(x))
    for (const text of added) {
      const row = api04Object(JSON.parse(text))
      api04Require(row.company_id !== input.foreign, 'first_foreign_effect')
      if (lane === 'public.company_customer_number_sequences') { api04Require(input.kind === 'customer' || input.kind === 'contract', 'first_numbering_effect'); continue }
      api04Require(Object.values(row).some(v => ids.has(v)), 'first_unexplained_effect')
      if (row.id) ids.add(row.id)
    }
    // Existing history may not disappear during a fresh write. Sequence is mutable.
    if (lane !== 'public.company_customer_number_sequences') api04Require(old.every(x => after.graph[lane].includes(x)), 'first_history_changed')
  }
  return { ref, customer, site, poa }
 }

describe('API01 partner-API', () => {
  let A: string, B: string
  let actorA: T5User
  let keyA: PartnerClient, keyB: PartnerClient
  let offerA: ApiOffer | null = null
  let offerError: string | null = null
  let custA = '', siteA1 = '', siteA2 = ''
  // Kund skapad som fixtur (SQL) så att site/POA-oraklen prövas oberoende av fynd 001 (POST customer ger 500).
  let fixtureCustA = '', fixtureCustA2 = ''

  beforeAll(async () => {
    A = createCompany('Sim T5 API bolag A')
    B = createCompany('Sim T5 API bolag B')
    actorA = await createAuthUser('api-actor-a')
    grantAdmin(actorA.userId, A, ['contracts.create', 'contracts.create_version', 'contracts.publish', 'pricing.write', 'pricing.publish'])
    try { offerA = await publishApiOffer(A, actorA.userId) } catch (e) { offerError = (e as Error).message }
    keyA = createPartnerClient(A, WRITE_SCOPES, { metadata: offerA ? { synthetic: true, partner_default_offer_reference: offerA.offerReference } : { synthetic: true } })
    keyB = createPartnerClient(B, WRITE_SCOPES)
    fixtureCustA = psql(`select customer_reference from public.customers where id='${createCustomer(A, 'ApiFixtur')}'`)
    fixtureCustA2 = psql(`select customer_reference from public.customers where id='${createCustomer(A, 'ApiFixtur2')}'`)
  }, 180_000)
  afterAll(async () => { if (actorA) await deleteAuthUser(actorA.userId) })

  it('API01.01 giltig partner skapar kund via POST customer (2xx, bunden till nyckelns bolag)', async () => {
    const c = await partner(keyA, 'POST', 'customer', customerBody(1, 'Kund'))
    rec('API01.01', 'POST customer', c)
    expect(c.status, brief(c)).toBe(201)
    custA = entity(c)
    expect(psql(`select company_id from public.customers where customer_reference='${custA}'`)).toBe(A)
  })

  it('API01.01 giltig partner skapar site via POST customer/{id}/site, bunden till kund och bolag', async () => {
    const s = await partner(keyA, 'POST', `customer/${fixtureCustA}/site`, siteBody(1))
    rec('API01.01', 'POST site', s, { customerRef: fixtureCustA })
    expect(s.status, brief(s)).toBe(201)
    siteA1 = entity(s)
    const rows = psqlRows<{ company_id: string; customer_reference: string; site_company: string; site_customer_ok: boolean }>(
      `select c.company_id, c.customer_reference, s.company_id site_company, s.customer_id = c.id site_customer_ok
         from public.customers c join public.customer_sites s on s.customer_id = c.id
        where c.customer_reference = '${fixtureCustA}' and s.facility_reference = '${siteA1}'`)
    expect(rows).toEqual([{ company_id: A, customer_reference: fixtureCustA, site_company: A, site_customer_ok: true }])
  })

  it('API01.01 giltig partner skapar avtal via POST contract; kund, site, POA och avtal bundna till bolaget', async () => {
    expect(offerError, 'API-erbjudandefixturen').toBeNull()
    const before = companyCounts(A)
    const k = await partner(keyA, 'POST', 'contract', { customer: customerBody(2, 'Avtal'), site: siteBody(2), power_of_attorney: poaBody('avtal') })
    rec('API01.01', 'POST contract', k, { offerFixture: offerError ? 'failed' : 'published' })
    expect(k.status, brief(k)).toBe(201)
    const out = k.json as { entity_id: string; customer: { entity_id: string }; site: { entity_id: string }; power_of_attorney: { entity_id: string } | null }
    const contract = psqlRows<{ company_id: string; customer_company: string; site_company: string; site_of_customer: boolean }>(
      `select k.company_id, c.company_id customer_company, s.company_id site_company, s.customer_id = c.id site_of_customer
         from public.customer_contracts k join public.customers c on c.id = k.customer_id join public.customer_sites s on s.id = k.site_id
        where k.customer_contract_reference = '${out.entity_id}'`)
    expect(contract).toEqual([{ company_id: A, customer_company: A, site_company: A, site_of_customer: true }])
    expect(out.power_of_attorney?.entity_id, 'POA i avtalssvaret').toBeTruthy()
    const after = companyCounts(A)
    expect(after.contracts - before.contracts).toBe(1)
    expect(countRows('customer_contracts', B)).toBe(0)
  })

  it('API01.02 två sites hos samma kund får varsin POA bunden till rätt site och kund', async () => {
    // Självständigt steg: båda sites skapas här (inget beroende på API01.01).
    const s1 = await partner(keyA, 'POST', `customer/${fixtureCustA}/site`, siteBody(31))
    expect(s1.status, brief(s1)).toBe(201)
    const s2 = await partner(keyA, 'POST', `customer/${fixtureCustA}/site`, siteBody(32))
    expect(s2.status, brief(s2)).toBe(201)
    const site1 = entity(s1)
    siteA2 = entity(s2)
    rec('API01.02', 'POST site1', s1, { customerRef: fixtureCustA }); rec('API01.02', 'POST site2', s2, { customerRef: fixtureCustA })
    const p1 = await partner(keyA, 'POST', `customer/${fixtureCustA}/site/${site1}/powerofattorney`, poaBody('site1'))
    expect(p1.status, brief(p1)).toBe(201)
    const p2 = await partner(keyA, 'POST', `customer/${fixtureCustA}/site/${siteA2}/powerofattorney`, poaBody('site2'))
    expect(p2.status, brief(p2)).toBe(201)
    rec('API01.02', 'POST poa site1', p1, { site: site1 }); rec('API01.02', 'POST poa site2', p2, { site: siteA2 })
    // Readback: sitens egen kund (customer_sites.customer_id) och POA:ns kund/site, var för sig.
    const rows = psqlRows<{ ref: string; site_ref: string; site_customer_ref: string; poa_customer_ref: string; company_id: string; site_company: string; same_site: boolean }>(
      `select p.power_of_attorney_reference ref, s.facility_reference site_ref, sc.customer_reference site_customer_ref,
              pc.customer_reference poa_customer_ref, p.company_id, s.company_id site_company, p.site_id = p.customer_site_id same_site
         from public.powers_of_attorney p
         join public.customer_sites s on s.id = p.customer_site_id
         join public.customers sc on sc.id = s.customer_id
         join public.customers pc on pc.id = p.customer_id
        where p.power_of_attorney_reference in ('${entity(p1)}','${entity(p2)}') order by s.facility_reference = '${site1}' desc`)
    receipt('API01.02', 'db-readback', { rows, substitution: 'kund skapad som SQL-fixtur (fynd 001)' })
    expect(rows).toEqual([
      { ref: entity(p1), site_ref: site1, site_customer_ref: fixtureCustA, poa_customer_ref: fixtureCustA, company_id: A, site_company: A, same_site: true },
      { ref: entity(p2), site_ref: siteA2, site_customer_ref: fixtureCustA, poa_customer_ref: fixtureCustA, company_id: A, site_company: A, same_site: true },
    ])
    const g1 = await partner(keyA, 'GET', `customer/${fixtureCustA}/site/${site1}/powerofattorney`)
    const g2 = await partner(keyA, 'GET', `customer/${fixtureCustA}/site/${siteA2}/powerofattorney`)
    rec('API01.02', 'GET poa site1', g1); rec('API01.02', 'GET poa site2', g2)
    expect(g1.status, brief(g1)).toBe(200)
    expect(g2.status, brief(g2)).toBe(200)
    expect(entity(g1)).toBe(entity(p1))
    expect(entity(g2)).toBe(entity(p2))
    // Fel kombination kund/site från en annan kund nekas.
    const cross = await partner(keyA, 'POST', `customer/${fixtureCustA2}/site/${site1}/powerofattorney`, poaBody('kors'))
    rec('API01.02', 'POST poa cross-customer', cross)
    expect(cross.status, brief(cross)).toBe(404)
  })

  // API01.03 prövas mot det kvalificerade oraklet i scenarios/api01-poa.test.ts.

  it('API01.04 samma Idempotency-Key ger samma svar och inga nya rader; ändrad payload ger 409', async () => {
    api04Require(offerError === null && offerA && api04Uuid(offerA.offerId) && api04Uuid(offerA.publicationVersionId), 'offer_prerequisite')
    const offer = offerA
    const offered = psqlRows<{ company_id: string; id: string; offer_reference: string; channel: string; status: string }>(
      `/* API04_OFFER_V1 */ SELECT p.id, cp.company_id, p.offer_reference, p.channel, p.status FROM public.contract_publication_versions p JOIN public.contract_publications cp ON cp.id=p.contract_publication_id JOIN public.contract_offers o ON o.id='${offer.offerId}' AND o.company_id=cp.company_id AND o.contract_product_version_id=p.contract_product_version_id WHERE p.id='${offer.publicationVersionId}' AND cp.company_id='${A}'`)
    api04Require(offered.length === 1 && offered[0].company_id === A && offered[0].id === offer.publicationVersionId && offered[0].offer_reference === offer.offerReference && offered[0].channel === 'api' && offered[0].status === 'published', 'offer_lineage')
    const companies = [A, B], completed = new Set<string>()
    const exercise = async (input: { kind: string; resource: string; operation: string; body: Record<string, unknown>; changed: Record<string, unknown>; customerRef?: string; siteRef?: string; pdf?: string; payload?: unknown }) => {
      const key = randomUUID(), before = await api04Observe(companies)
      const first = await partner(keyA, 'POST', input.resource, input.body, { idempotencyKey: key })
      api04Require(first.status === 201, 'first_201')
      const after = await api04Observe(companies)
      const lineage = api04First(before, after, { ...input, company: A, foreign: B, response: first, offer })
      const ledger = { company: A, client: keyA.id, customer: ['customer', 'contract'].includes(input.kind) ? null : lineage.customer.id, operation: input.operation, key, payload: input.payload ?? input.body, response: first }
      api04Ledger(after, ledger)
      const newLedger = after.ledger.filter(x => !before.ledger.includes(x))
      api04Require(newLedger.length === 1 && before.ledger.every(x => after.ledger.includes(x)), 'first_ledger_delta')
      const replay = await partner(keyA, 'POST', input.resource, input.body, { idempotencyKey: key })
      // The persisted JSONB body may reorder keys, including nested objects.
      // Compare the complete parsed response, preserving keys, types and values.
      api04Require(replay.status === 201 && api04Canonical(replay.json) === api04Canonical(first.json), 'replay_status_body')
      const replayed = await api04Observe(companies); api04Ledger(replayed, ledger); api04Same(after, replayed, 'replay')
      const conflict = await partner(keyA, 'POST', input.resource, input.changed, { idempotencyKey: key })
      api04Require(conflict.status === 409 && api04Object(api04Object(conflict.json).error).code === 'idempotency_conflict', 'conflict_semantics')
      api04Same(after, await api04Observe(companies), 'conflict')
      const missing = await partner(keyA, 'POST', input.resource, input.body, { idempotencyKey: null })
      api04Require(missing.status === 400 && api04Object(api04Object(missing.json).error).code === 'idempotency_key_required', 'missing_key_semantics')
      api04Same(after, await api04Observe(companies), 'missing_key')
      completed.add(input.kind)
      rec('API01.04', `${input.kind} completed replay/conflict/missing-key`, first, { graphSha256: sha256(api04Canonical(after.graph)), ledgerSha256: sha256(api04Canonical(after.ledger)), physicalStorageSha256: sha256(api04Canonical(after.objects)), laneCount: API04_RELATIONS.length })
      return { ...lineage, key, after, body: input.body }
    }
    const customerInput = customerBody(41, 'ReplayCustomer')
    const own = await exercise({ kind: 'customer', resource: 'customer', operation: '/api/partner/v1/customer', body: customerInput, changed: { ...customerInput, last_name: 'ReplayChanged' } })
    const site1 = await exercise({ kind: 'site', resource: `customer/${own.ref}/site`, operation: '/api/partner/v1/customer/{customer_id}/site', customerRef: own.ref, body: siteBody(41), changed: { ...siteBody(41), address: 'Annan väg 41' } })
    const site2 = await exercise({ kind: 'site', resource: `customer/${own.ref}/site`, operation: '/api/partner/v1/customer/{customer_id}/site', customerRef: own.ref, body: siteBody(42), changed: { ...siteBody(42), address: 'Annan väg 42' } })
    const pdf = poaBody('api04-original')
    const signed = await exercise({ kind: 'poa', resource: `customer/${own.ref}/site/${site1.ref}/powerofattorney`, operation: '/api/partner/v1/customer/{customer_id}/site/{site_id}/powerofattorney', customerRef: own.ref, siteRef: site1.ref, body: pdf, changed: poaBody('api04-changed'), pdf: pdf.file_base64, payload: { ...pdf, file_base64: `sha256:${sha256(Buffer.from(pdf.file_base64, 'base64'))}` } })
    const cross = await partner(keyA, 'POST', `customer/${own.ref}/site/${site2.ref}/powerofattorney`, pdf, { idempotencyKey: signed.key })
    api04Require(cross.status === 409 && api04Object(api04Object(cross.json).error).code === 'idempotency_conflict', 'cross_site_semantics')
    api04Same(signed.after, await api04Observe(companies), 'cross_site')
    const nestedPdf = poaBody('api04-contract'), nested = { customer: customerBody(42, 'ReplayContract'), site: siteBody(43), power_of_attorney: nestedPdf }
    await exercise({ kind: 'contract', resource: 'contract', operation: '/api/partner/v1/contract', body: nested, changed: { ...nested, customer: { ...nested.customer, last_name: 'ChangedContract' } }, pdf: nestedPdf.file_base64, payload: { customer: nested.customer, site: nested.site, power_of_attorney: { poa_type: 'web', transaction_type: 'SWITCH', file_sha256: sha256(Buffer.from(nestedPdf.file_base64, 'base64')) } } })
    api04Require(['customer', 'site', 'poa', 'contract'].every(x => completed.has(x)), 'all_four_lanes')
    receipt('API01.04', 'complete', { exercised: [...completed].sort(), fullGraphLanes: API04_RELATIONS.length, physicalPdfReadback: true, runtimeQualification: 'requires separately admitted real source/backend/provider profile' })
  })

  it('API01.05 fel tenant eller för bred scope nekas utan rader eller läckt data', async () => {
    const beforeA = companyCounts(A), beforeB = companyCounts(B)
    // Begäran utöver nyckelns scope nekas.
    const readOnly = createPartnerClient(A, ['customer_profile.read'])
    const noScope = await partner(readOnly, 'POST', `customer/${fixtureCustA}/site`, siteBody(7))
    rec('API01.05', 'write beyond scope', noScope)
    expect(noScope.status, brief(noScope)).toBe(403)
    expect(noScope.text).toContain('api_scope_missing')
    // Fel tenant: tenantväljare i kroppen och främmande resurser.
    const tenant = await partner(keyA, 'POST', `customer/${fixtureCustA}/site`, { ...siteBody(8), company_id: B })
    rec('API01.05', 'tenant selector in body', tenant)
    expect(tenant.status, brief(tenant)).toBe(422)
    expect(tenant.text).toContain('tenant_selection_forbidden')
    const fixtureEmail = psql(`select email from public.customers where customer_reference='${fixtureCustA}'`)
    const foreignGet = await partner(keyB, 'GET', `customer/${fixtureCustA}`)
    rec('API01.05', 'foreign customer read', foreignGet)
    expect(foreignGet.status, brief(foreignGet)).toBe(404)
    expect(foreignGet.text).toContain('customer_not_found')
    expect(fixtureEmail).toMatch(/@example\.invalid$/)
    expect(foreignGet.text).not.toContain(fixtureEmail)
    const foreignSite = await partner(keyB, 'POST', `customer/${fixtureCustA}/site`, siteBody(9))
    rec('API01.05', 'foreign customer write', foreignSite)
    expect(foreignSite.status, brief(foreignSite)).toBe(404)
    expect(foreignSite.text).toContain('customer_not_found')
    // Ogiltiga nycklar.
    const revoked = createPartnerClient(A, WRITE_SCOPES, { status: 'revoked' })
    const r1 = await partner(revoked, 'POST', `customer/${fixtureCustA}/site`, siteBody(10))
    rec('API01.05', 'revoked key', r1)
    expect([401, 403], brief(r1)).toContain(r1.status)
    expect(r1.text).toMatch(/api_client_(inactive|revoked)|invalid_api_token/)
    const expired = createPartnerClient(A, WRITE_SCOPES, { expiresAt: '2020-01-01T00:00:00Z' })
    const r2 = await partner(expired, 'POST', `customer/${fixtureCustA}/site`, siteBody(11))
    rec('API01.05', 'expired key', r2)
    expect([401, 403], brief(r2)).toContain(r2.status)
    expect(r2.text).toMatch(/api_client_expired|api_client_inactive|invalid_api_token|expired/)
    const anon = await partner(null, 'POST', `customer/${fixtureCustA}/site`, siteBody(12))
    rec('API01.05', 'no key', anon)
    expect(anon.status, brief(anon)).toBe(401)
    expect(anon.text).toContain('missing_api_token')
    expect(companyCounts(A)).toEqual(beforeA)
    expect(companyCounts(B)).toEqual(beforeB)
  })

  it('API01.05 för bred scope vid utfärdande: plattformens behörighetsändring tar bort okända och jokerscopes', async () => {
    const platform = await createAuthUser('api-platform')
    try {
      psql(`INSERT INTO public.admin_users(user_id,role,is_active) VALUES('${platform.userId}','platform_admin',true);`)
      const target = createPartnerClient(A, ['customer_profile.read', 'partner_customers.write'])
      const s = await loginViaUi(platform.email, platform.password, '/admin/platform/api-clients')
      const form = new FormData()
      form.set('clientId', target.id)
      for (const scope of ['*', 'admin.everything', 'customer_profile.read']) form.append('scopes', scope)
      form.set('allowedOrigins', 'https://partner.example.com')
      const result = await callServerAction({ userId: '', cookieHeader: s.cookieHeader(), fetch: s.fetch }, {
        route: '/admin/platform/api-clients', filename: 'app/admin/platform/api-clients/actions.ts',
        exportedName: 'updateIntegrationApiClientPermissionsAction', args: [form] })
      const stored = psqlRows<{ scopes: string[]; status: string; launch_ready: boolean }>(
        `select scopes, status, launch_ready from public.integration_api_clients where id='${target.id}'`)[0]
      receipt('API01.05', 'platform permission update', { httpStatus: result.httpStatus, threw: result.threw, stored })
      expect(result.threw, result.excerpt).toBe(false)
      expect(stored.scopes).not.toContain('*')
      expect(stored.scopes).not.toContain('admin.everything')
      expect(stored.scopes).toContain('customer_profile.read')
      expect(stored.scopes, 'ändringen sparades (partner_customers.write togs bort)').not.toContain('partner_customers.write')
      // Ändrade behörigheter kräver ny go-live; nyckeln nekas tills dess.
      expect(stored.launch_ready).toBe(false)
      const after = await partner(target, 'GET', `customer/${fixtureCustA}`)
      rec('API01.05', 'key after permission change', after)
      expect([401, 403], brief(after)).toContain(after.status)
    } finally {
      await deleteAuthUser(platform.userId)
    }
  })
})
