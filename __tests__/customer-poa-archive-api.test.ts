// Synthetic transport proof: real renderer/archive, JWS verifier, reader and mounted routes.
// Declared Supabase/identity/auth ports do not establish live RLS or market/provider qualification.
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createFakeDb, type FakeDb } from './helpers/poaMailFakeDb'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({ db: null as unknown as FakeDb, binding: 'portal_account', customer: '', company: '', subject: 'synthetic-subject',
  scopes: ['customer_power_of_attorney.read', 'customer_documents.read'], downloads: [] as string[], retained: true,
  onDownload: null as (() => void) | null, oversized: false, audits: [] as Row[], realResolver: false }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ get supabaseService() { return { ...io.db.client, storage: { from: (bucket: string) => ({
  ...io.db.client.storage.from(bucket), download: async (path: string) => {
    io.downloads.push(`${bucket}/${path}`)
    const bytes = io.db.storageFiles.get(`${bucket}/${path}`)
    io.onDownload?.()
    return { data: bytes ? new Blob([new Uint8Array(io.oversized ? Buffer.alloc(16 * 1024 * 1024) : bytes)]) : null, error: null }
  },
}) } } } }))
// Exercise the real tenant query wrappers over the declared Supabase port,
// including archive updates and their company/customer/source predicates.
vi.mock('@/lib/integrations/apiAuth', () => ({
  currentIntegrationApiResponseContext: () => ({ rateLimit: { limit: 60, remaining: 59 } }),
  requireIntegrationApiAccess: async (request: NextRequest, requirement: { allOf: string[] }) => {
    const client = { id: 'synthetic-client', company_id: io.company, metadata: {} }
    if (!request.headers.has('authorization')) return { ok: false, status: 401, error: 'Unauthorized', errorCode: 'unauthorized' }
    if (!requirement.allOf.every(scope => io.scopes.includes(scope))) return { ok: false, status: 403, client, error: 'Forbidden', errorCode: 'scope_missing' }
    return { ok: true, client }
  },
  logIntegrationApiRequest: async (input: Row) => { io.audits.push(input) },
}))
vi.mock('@/lib/customer-portal/customerResolver', () => ({
  resolvePortalCustomer: async (input: unknown) => {
    if (io.realResolver) {
      const actual = await vi.importActual<typeof import('@/lib/customer-portal/customerResolver')>('@/lib/customer-portal/customerResolver')
      return actual.resolvePortalCustomer(input as Parameters<typeof actual.resolvePortalCustomer>[0])
    }
    return { ok: true, binding: io.binding, customer: { company_id: io.company, customer_id: io.customer, customer_portal_user_id: io.subject, auth_user_id: null } }
  },
  portalIdentifiersFromRequest: () => ({}),
}))
vi.mock('@/lib/ediel/retention/customerRecordClasses', () => ({
  requirePortalRetentionAccess: async () => { if (!io.retained) throw new Error('synthetic-retirement-refusal') },
}))
import { ensurePoaPdfArchive } from '@/lib/customers/poaDocuments'
import { resetCustomerIdentityProviderCache } from '@/lib/customer-portal/customerAssertion'
import { poaMailEvidenceFingerprint } from '@/lib/email/poaMailEvidence'
import { GET as list } from '@/app/api/v1/customer/powers-of-attorney/evidence/route'
import { GET as detail } from '@/app/api/v1/customer/powers-of-attorney/evidence/[verificationReference]/route'

const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333', D = '44444444-4444-4444-8444-444444444444'
const P = '55555555-5555-4555-8555-555555555555'
const reference = 'poa_verification_synthetic-document-proof-12345678'
const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
function token(subject = io.subject, overrides: Row = {}) {
  const now = Math.floor(Date.now() / 1000)
  const head = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify({ iss: 'https://synthetic.invalid', aud: 'synthetic-ops', sub: subject, iat: now, exp: now + 120, jti: randomUUID(), ...overrides })).toString('base64url')
  const content = `${head}.${body}`
  return `${content}.${sign('sha256', Buffer.from(content), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`
}
function request(path = '', assertion: string | null = token(), authorization = true) {
  return new NextRequest(`https://synthetic.invalid/api/v1/customer/powers-of-attorney/evidence${path}`, { headers: {
    ...(authorization ? { authorization: 'Bearer synthetic-key' } : {}),
    ...(assertion ? { 'x-gridex-customer-assertion': assertion } : {}),
  } })
}
function read(path = '', assertion: string | null = token()) {
  return detail(request(`/${reference}${path}`, assertion), { params: Promise.resolve({ verificationReference: reference }) })
}
function poa() { return io.db.tables.powers_of_attorney[0] }
function archive() { return (poa().metadata as Row).document_archive as Row }
function pdfKey() { return `customer-documents/${poa().document_path}` }
async function errorCode(response: Response) { return (await response.json()).error.code }
const { validateSchema } = createRequire(import.meta.url)('../scripts/lib/openapi-schema-validator.cjs') as {
  validateSchema: (document: unknown, value: unknown, schema: unknown) => string[]
}
function proposedContract() {
  const document = JSON.parse(readFileSync(new URL('../docs/openapi/customer-portal-v1.json', import.meta.url), 'utf8'))
  const text = readFileSync(new URL('../docs/customer-poa-archive-api-supplement.md', import.meta.url), 'utf8').split('<!-- BEGIN POA ARCHIVE OPENAPI PATCH -->')[1]
  const patch = JSON.parse(/```json\n([\s\S]+?)\n```/.exec(text)![1])
  return { ...document, paths: { ...document.paths, ...patch.paths }, components: { ...document.components,
    schemas: { ...document.components.schemas, ...patch.components.schemas } } }
}

beforeEach(async () => {
  Object.assign(io, { company: A, customer: C, binding: 'portal_account', subject: 'synthetic-subject', retained: true,
    scopes: ['customer_power_of_attorney.read', 'customer_documents.read'], downloads: [], oversized: false, onDownload: null, audits: [], realResolver: false })
  resetCustomerIdentityProviderCache()
  io.db = createFakeDb({ companies: [{ id: A, name: 'Synthetic Tenant' }], customers: [{ id: C, company_id: A, full_name: 'Synthetic Signer', status: 'active' }],
    powers_of_attorney: [{ id: P, company_id: A, customer_id: C, status: 'signed', source: 'website_api', method: 'website_acceptance',
      accepted_at: '2026-10-18T10:00:00Z', signed_at: '2026-10-18T10:00:00Z', signer_name: 'Synthetic Signer', signer_identity_number: 'synthetic-only',
      evidence_payload: { verification_reference: reference, ip_address: '192.0.2.10', ip_address_source: 'signer_reported' },
      fullmakt_snapshot: { legal_text: { body: 'Synthetic accepted authorization terms', title: 'Fullmakt', version: 'v1' }, scopes: ['facility_information_lookup'] }, metadata: {} }],
    tenant_customer_identity_providers: [{ id: 'synthetic-provider', company_id: A, purpose: 'customer', is_active: true, kind: 'tenant_key',
      issuer: 'https://synthetic.invalid', audience: 'synthetic-ops', public_jwk: keys.publicKey.export({ format: 'jwk' }), subject_claim: 'sub', enforcement: 'enforce' }],
    tenant_customer_assertion_replays: [],
  })
  io.db.unique.tenant_customer_assertion_replays = ['jti']
  await ensurePoaPdfArchive({ companyId: A, customerId: C, powerOfAttorneyId: P })
  io.db.writes.length = 0; io.db.storageUploads.length = 0; io.downloads.length = 0
})

describe('customer-authorized existing POA archive', () => {
  it.each(['x-gridex-customer-portal-user-id', 'x-gridex-auth-user-id'])('accepts and documents a single opaque %s through the real resolver', async header => {
    io.realResolver = true
    io.db.tables.customer_portal_accounts = [{ id: 'synthetic-linked-account', company_id: A, customer_id: C,
      external_account_id: io.subject, status: 'active', is_active: true }]
    const req = request()
    req.headers.set(header, io.subject)
    expect((await list(req)).status).toBe(200)
    const document = proposedContract()
    const operation = document.paths['/api/v1/customer/powers-of-attorney/evidence'].get
    for (const raw of operation.parameters) {
      const parameter = raw.$ref ? document.components.parameters[raw.$ref.split('/').at(-1)] : raw
      if (parameter.in !== 'header') continue
      const value = req.headers.get(parameter.name)
      if (parameter.required) expect(value, `required header ${parameter.name}`).not.toBeNull()
      if (value !== null) {
        expect(parameter.schema.format, 'opaque portal subjects are not restricted to UUID').not.toBe('uuid')
        expect(validateSchema(document, value, parameter.schema)).toEqual([])
      }
    }
  })
  it('validates mounted JSON responses against the proposed closed publication schemas', async () => {
    const document = proposedContract()
    const listing = await (await list(request())).json(), verification = await (await read()).json()
    expect(validateSchema(document, listing, { $ref: '#/components/schemas/CustomerPoaArchiveListEnvelope' })).toEqual([])
    expect(validateSchema(document, verification, { $ref: '#/components/schemas/CustomerPoaArchiveVerificationEnvelope' })).toEqual([])
    expect(validateSchema(document, { ...verification, data: { ...verification.data, storage_path: 'forbidden' } },
      { $ref: '#/components/schemas/CustomerPoaArchiveVerificationEnvelope' })).not.toEqual([])
    const denied = await list(request('', token(), false))
    expect(validateSchema(document, await denied.json(), { $ref: '#/components/schemas/ErrorEnvelope' })).toEqual([])
  })
  it('discovers stored evidence without downloading or regenerating a PDF', async () => {
    const response = await list(request())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data[0]).toMatchObject({ verification_reference: reference, archive_status: 'archived_unverified', consent_status: 'signed' })
    expect(body.data[0].download_url).toBe(`/api/v1/customer/powers-of-attorney/evidence/${reference}?format=pdf`)
    expect(JSON.stringify(body)).not.toContain('companies/')
    expect(JSON.stringify(body)).not.toContain(P)
    expect(io.downloads).toEqual([])
    expect(io.db.storageUploads).toEqual([])
    expect(io.db.writes.filter(row => row.table === 'powers_of_attorney')).toEqual([])
  })
  it('verifies actual original bytes and returns original reported signer evidence', async () => {
    const response = await read()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toMatchObject({ verification_reference: reference, archive_integrity: 'verified', sha256: archive().sha256,
      submitted_sha256_matches: null, accepted_at: '2026-10-18T10:00:00Z', signer_ip_address: '192.0.2.10',
      signer_ip_source: 'signer_reported', bankid_verified: false, pdf_signature_validation: 'not_performed' })
    expect(body.data.sha256).toBe(createHash('sha256').update(io.db.storageFiles.get(pdfKey())!).digest('hex'))
  })
  it('downloads matching bytes with private caching, safe filename, integrity and rate-limit headers', async () => {
    const bytes = io.db.storageFiles.get(pdfKey())!
    const response = await read('?format=pdf')
    expect(response.status).toBe(200)
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('x-gridex-document-sha256')).toBe(archive().sha256)
    expect(response.headers.get('x-gridex-verification-reference')).toBe(reference)
    expect(response.headers.get('content-disposition')).not.toContain(P)
    expect(response.headers.get('x-ratelimit-limit')).toBe('60')
  })
  it('streams a verified PDF larger than the function buffered-response limit in bounded chunks', async () => {
    const original = io.db.storageFiles.get(pdfKey())!
    const at = original.lastIndexOf('startxref')
    const bytes = Buffer.concat([original.subarray(0, at), Buffer.from('%' + 'x'.repeat(5 * 1024 * 1024) + '\n'), original.subarray(at)])
    const hash = createHash('sha256').update(bytes).digest('hex')
    const path = String(poa().document_path).replace(String(archive().sha256), hash)
    Object.assign(archive(), { sha256: hash, path }); poa().document_path = path
    io.db.storageFiles.set(`customer-documents/${path}`, bytes)
    const response = await read('?format=pdf')
    expect(response.status).toBe(200)
    const reader = response.body!.getReader(), digest = createHash('sha256')
    let total = 0, chunks = 0
    while (true) {
      const next = await reader.read()
      if (next.done) break
      expect(next.value.byteLength).toBeLessThanOrEqual(64 * 1024)
      digest.update(next.value); total += next.value.byteLength; chunks++
    }
    expect(total).toBe(bytes.length); expect(chunks).toBeGreaterThan(1)
    expect(digest.digest('hex')).toBe(hash)
    expect(response.headers.get('content-length')).toBeNull()
  })
  it('compares a caller-supplied checksum with the actual archived bytes', async () => {
    expect((await (await read('?sha256=' + '0'.repeat(64))).json()).data.submitted_sha256_matches).toBe(false)
    expect((await (await read('?sha256=' + String(archive().sha256))).json()).data.submitted_sha256_matches).toBe(true)
  })
  it.each(['tampered-bytes','evidence-change','archive-hash','path-owner','wrong-bucket','missing-object'])('fails closed for %s', async variant => {
    if (variant === 'tampered-bytes') io.db.storageFiles.set(pdfKey(), Buffer.from('corrupted original'))
    if (variant === 'evidence-change') poa().signer_name = 'changed after archive'
    if (variant === 'archive-hash') archive().sha256 = '0'.repeat(64)
    if (variant === 'path-owner') { archive().path = String(poa().document_path).replace(C, D); poa().document_path = archive().path }
    if (variant === 'wrong-bucket') archive().storage_bucket = 'foreign-bucket'
    if (variant === 'missing-object') io.db.storageFiles.delete(pdfKey())
    const response = await read('?format=pdf')
    expect(response.status).toBe(409)
    expect(await errorCode(response)).toBe('poa_archive_unavailable')
    expect(io.db.storageUploads).toEqual([])
    expect(io.db.writes.filter(row => row.table === 'powers_of_attorney')).toEqual([])
  })
  it.each(['tenant','customer'])('denies a foreign %s reference without storage access', async kind => {
    if (kind === 'tenant') { io.company = B; io.db.tables.tenant_customer_identity_providers[0].company_id = B }
    else io.customer = D
    const response = await read()
    expect(response.status).toBe(404)
    expect(io.downloads).toEqual([])
  })
  it('requires both existing scopes before document access', async () => {
    io.scopes = ['customer_power_of_attorney.read']
    expect((await read()).status).toBe(403)
    expect(io.downloads).toEqual([])
  })
  it('rejects an anonymous request and attributes authenticated denials to the API tenant', async () => {
    expect((await list(request('', token(), false))).status).toBe(401)
    expect(io.downloads).toEqual([])
    expect((await read('', token('foreign-subject'))).status).toBe(403)
    expect(io.audits.at(-1)).toMatchObject({ client: { company_id: A }, statusCode: 403 })
  })
  it('does not accept identifier-only binding', async () => {
    io.binding = 'identifier_match'
    expect((await read()).status).toBe(403)
    expect(io.downloads).toEqual([])
  })
  it.each(['missing','wrong-subject','expired','replay','report-mode-invalid','unconfigured'])('requires verified customer proof: %s', async kind => {
    let assertion: string | null = token()
    if (kind === 'missing') assertion = null
    if (kind === 'wrong-subject') assertion = token('foreign-subject')
    if (kind === 'expired') assertion = token(io.subject, { iat: 1, exp: 2 })
    if (kind === 'replay') expect((await read('', assertion)).status).toBe(200)
    if (kind === 'report-mode-invalid') { io.db.tables.tenant_customer_identity_providers[0].enforcement = 'report'; assertion = 'invalid' }
    if (kind === 'unconfigured') io.db.tables.tenant_customer_identity_providers.length = 0
    io.downloads.length = 0
    expect([403,503]).toContain((await read('', assertion)).status)
    expect(io.downloads).toEqual([])
  })
  it('returns a controlled missing-archive state and never creates missing consent on GET', async () => {
    poa().metadata = {}; poa().document_path = null
    expect((await (await list(request())).json()).data[0].archive_status).toBe('missing')
    expect((await read()).status).toBe(409)
    expect(io.db.storageUploads).toEqual([])
  })
  it('does not advertise a lookup URL for a noncanonical stored verification reference', async () => {
    ;(poa().evidence_payload as Row).verification_reference = ` ${reference} `
    const body = await (await list(request())).json()
    expect(body.data[0]).toMatchObject({ archive_status: 'unavailable', download_url: null })
    expect(io.downloads).toEqual([])
    expect(io.db.writes.filter(row => row.table === 'powers_of_attorney')).toEqual([])
  })
  it('rejects an ambiguous verification reference', async () => {
    io.db.tables.powers_of_attorney.push({ ...structuredClone(poa()), id: D })
    expect((await read()).status).toBe(409)
    expect(io.downloads).toEqual([])
  })
  it('detects changed evidence and retirement while bytes are being read', async () => {
    io.onDownload = () => { poa().signer_name = 'concurrent edit' }
    expect((await read()).status).toBe(409)
    poa().signer_name = 'Synthetic Signer'
    io.onDownload = () => { io.retained = false }
    expect((await read()).status).toBeGreaterThanOrEqual(400)
  })
  it('reports absent signer facts without substituting the API caller or inventing signature assurance', async () => {
    const evidence = poa().evidence_payload as Row
    evidence.ip_address_source = 'api_caller'
    poa().accepted_at = null; poa().signed_at = null
    archive().evidence_sha256 = poaMailEvidenceFingerprint(poa())
    const data = (await (await read()).json()).data
    expect(data).toMatchObject({ signer_ip_address: null, signer_ip_source: null, accepted_at: null, bankid_verified: false,
      capture_issues: ['poa_acceptance_time_missing', 'poa_signer_ip_missing'] })
  })
  it('verifies a valid assertion even when the provider is in report mode', async () => {
    io.db.tables.tenant_customer_identity_providers[0].enforcement = 'report'
    expect((await read()).status).toBe(200)
  })
  it('reads a moved POA original only through its exact canonical customer merge event', async () => {
    poa().customer_id = D
    Object.assign(io.db.tables.customers[0], { status: 'inactive', merge_status: 'merged', merged_into_customer_id: D,
      merged_by: 'synthetic-merge-actor', merged_at: '2026-10-18T12:00:00Z' })
    io.db.tables.customers.push({ id: D, company_id: A, status: 'active', merged_into_customer_id: null })
    io.db.tables.customer_merge_events = [{ company_id: A, primary_customer_id: D, merged_customer_id: C,
      moved_counts: { powers_of_attorney: 1 }, source_snapshot: { id: C }, created_by: 'synthetic-merge-actor', created_at: '2026-10-18T12:00:00Z' }]
    io.customer = D
    expect((await read('?format=pdf')).status).toBe(200)
    const event = structuredClone(io.db.tables.customer_merge_events[0])
    for (const invalid of ['zero-moved','missing-event','wrong-actor','duplicate-event','wrong-tenant','cycle']) {
      io.db.tables.customer_merge_events = [structuredClone(event)]
      io.db.tables.customers[1].merged_into_customer_id = null
      if (invalid === 'zero-moved') io.db.tables.customer_merge_events[0].moved_counts = { powers_of_attorney: 0 }
      if (invalid === 'missing-event') io.db.tables.customer_merge_events = []
      if (invalid === 'wrong-actor') io.db.tables.customer_merge_events[0].created_by = 'foreign-actor'
      if (invalid === 'duplicate-event') io.db.tables.customer_merge_events.push(structuredClone(event))
      if (invalid === 'wrong-tenant') io.db.tables.customer_merge_events[0].company_id = B
      if (invalid === 'cycle') io.db.tables.customers[1].merged_into_customer_id = C
      io.downloads.length = 0
      expect((await read('?format=pdf')).status, invalid).toBe(409)
      expect(io.downloads, invalid).toEqual([])
    }
  })
  it('rejects invalid PDF structure even if stored bytes and all archived hashes agree', async () => {
    const bytes = Buffer.from('not a PDF but stored consistently'), hash = createHash('sha256').update(bytes).digest('hex')
    const path = String(poa().document_path).replace(String(archive().sha256), hash)
    Object.assign(archive(), { sha256: hash, path }); poa().document_path = path
    io.db.storageFiles.set(`customer-documents/${path}`, bytes)
    expect((await read('?format=pdf')).status).toBe(409)
  })
  it('bounds PDF size and rejects unsupported formats or malformed hashes', async () => {
    io.oversized = true
    expect((await read('?format=pdf')).status).toBe(409)
    expect((await read('?format=html')).status).toBe(400)
    expect((await read('?sha256=bad')).status).toBe(400)
    expect((await read('?format=pdf&sha256=' + '0'.repeat(64))).status).toBe(400)
    expect((await list(request('?limit=1&limit=2'))).status).toBe(400)
    expect((await list(request('?cursor=' + 'a'.repeat(2049)))).status).toBe(400)
  })
  it('paginates with a tenant/customer-bound opaque cursor and enforces limits', async () => {
    io.db.tables.powers_of_attorney.push({ ...structuredClone(poa()), id: '66666666-6666-4666-8666-666666666666' })
    const first = await (await list(request('?limit=1'))).json()
    expect(first.data).toHaveLength(1); expect(first.page.has_more).toBe(true)
    const second = await (await list(request('?limit=1&cursor=' + encodeURIComponent(first.page.next_cursor)))).json()
    expect(second.data).toHaveLength(1); expect(second.page.has_more).toBe(false)
    io.customer = D
    expect((await list(request('?cursor=' + encodeURIComponent(first.page.next_cursor)))).status).toBe(400)
    expect((await list(request('?limit=1000'))).status).toBe(400)
  })
})
