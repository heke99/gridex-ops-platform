import { NextRequest } from 'next/server'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/v1/customer/sync/route'
import { publicReference } from '@/lib/integrations/publicReferences'
import { buildCustomerLegalDocuments } from '@/lib/legal/customerDocumentPackage'

type Row = Record<string, unknown>
const ports = vi.hoisted(() => ({
  authorize: vi.fn(),
  log: vi.fn(),
  fetch: vi.fn(),
  event: vi.fn(),
  operations: [] as Array<{ method: string; table: string; body: unknown }>,
  customer: {} as Row,
  activeBundle: null as string | null,
  contracts: null as Row[] | null,
  bundles: [] as Row[],
  additionalDocuments: [] as Row[],
  maxReadRows: 1_000,
  directApplicationId: null as string | null,
  applications: [] as Row[],
  legacyTextVersionId: null as string | null,
  persistLegalAcceptances: null as ((body: unknown) => Promise<Response>) | null,
}))

vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabaseService: createClient('https://gridex-supabase.test', 'synthetic-fixture-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: ports.fetch },
    }),
  }
})
vi.mock('@/lib/customer-portal/externalApi', async (original) => ({
  ...await original<typeof import('@/lib/customer-portal/externalApi')>(),
  requireCustomerPortalApiContextForIdentifiers: ports.authorize,
}))
vi.mock('@/lib/integrations/apiAuth', async (original) => ({
  ...await original<typeof import('@/lib/integrations/apiAuth')>(),
  logIntegrationApiRequest: ports.log,
}))
vi.mock('@/lib/events/domainEvents', () => ({ emitDomainEvent: ports.event }))

const companyId = '00000000-0000-4000-8000-000000000001'
const customerId = '00000000-0000-4000-8000-000000000002'
const contractId = '00000000-0000-4000-8000-000000000003'
const bundleId = '00000000-0000-4000-8000-000000000004'
const documentId = '00000000-0000-4000-8000-000000000005'
const ledgerId = '00000000-0000-4000-8000-000000000006'
const applicationId = '00000000-0000-4000-8000-000000000007'
const otherApplicationId = '00000000-0000-4000-8000-000000000009'
const otherContractId = '00000000-0000-4000-8000-000000000010'
const otherCompanyId = '00000000-0000-4000-8000-000000000011'
const otherCustomerId = '00000000-0000-4000-8000-000000000012'
const otherBundleId = '00000000-0000-4000-8000-000000000013'
const otherDocumentId = '00000000-0000-4000-8000-000000000014'
const client = { id: 'fixture-client', company_id: companyId }
const identity = {
  company_id: companyId,
  customer_id: customerId,
  customer_number: 'fixture-number',
  external_customer_id: 'fixture-subject',
}
const acceptedAt = '2026-11-19T12:00:00Z'
const document = {
  id: documentId, module_key: 'general_terms', title: 'Testvillkor', version: 'v1',
  content_sha256: 'a'.repeat(64), legal_bundle_version_id: bundleId, published_at: acceptedAt,
}
const acceptance = {
  document_reference: publicReference('legal_document', companyId, documentId),
  document_code: document.module_key,
  document_version: document.version,
  document_hash: document.content_sha256,
  accepted: true,
  accepted_at: acceptedAt,
}
const grouped = buildCustomerLegalDocuments({ companyId, legalBundleVersionId: bundleId, modules: [document] })[0]!
const boundApplication = { id: applicationId, company_id: companyId, customer_id: customerId, contract_id: contractId }
const unrelatedApplication = { ...boundApplication, id: otherApplicationId, contract_id: otherContractId }
const publicBundle = { id: bundleId, company_id: companyId, status: 'published', locked_at: acceptedAt }

function contract(overrides: Row = {}) {
  return {
    id: contractId, company_id: companyId, customer_id: customerId, status: 'active',
    metering_point_id: 'fixture-point', website_application_id: ports.directApplicationId,
    legal_bundle_version_id: ports.activeBundle, created_at: '2026-11-01T12:00:00Z', ...overrides,
  }
}

function selectRows(rows: Row[], params: URLSearchParams) {
  const accepted = rows.filter(row => Object.entries(row).every(([field, value]) => params.getAll(field).every(filter => {
    if (filter === 'not.is.null') return value !== null
    if (filter.startsWith('gt.')) return String(value) > filter.slice(3)
    if (filter.startsWith('in.(')) return filter.slice(4, -1).split(',').includes(String(value))
    return filter === `eq.${value}`
  })))
  const [column, order] = (params.get('order') ?? '').split('.')
  if (column) accepted.sort((a, b) => String(a[column]).localeCompare(String(b[column])) * (order === 'desc' ? -1 : 1))
  return accepted.slice(0, Math.min(Number(params.get('limit') ?? accepted.length), ports.maxReadRows))
}

function request(input: Row = {}) {
  return new NextRequest('https://gridex.test/api/v1/customer/sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'fixture-sync-preflight-key' },
    body: JSON.stringify({ external_customer_id: identity.external_customer_id, profile: { first_name: 'Updated' }, ...input }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ports.customer = { first_name: 'Original', metadata: {} }
  ports.activeBundle = bundleId
  ports.contracts = null
  ports.bundles = [publicBundle]
  ports.additionalDocuments = []
  ports.maxReadRows = 1_000
  ports.directApplicationId = applicationId
  ports.applications = [boundApplication]
  ports.legacyTextVersionId = null
  ports.persistLegalAcceptances = null
  ports.operations = []
  ports.authorize.mockResolvedValue({ ok: true, startedAt: Date.now(), client, identity })
  ports.fetch.mockImplementation(async (url: string | URL, init?: RequestInit) => {
    const { pathname, searchParams } = new URL(url)
    const table = pathname.split('/').at(-1)!
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null
    ports.operations.push({ table, method, body })

    if (table === 'customer_portal_write_idempotency') {
      const wantsRepresentation = searchParams.has('select')
      return wantsRepresentation ? Response.json({ id: ledgerId }) : new Response(null, { status: 204 })
    }
    if (table === 'customer_contracts') {
      expect(searchParams.get('company_id')).toBe(`eq.${companyId}`)
      expect(searchParams.get('customer_id')).toBe(`eq.${customerId}`)
      return Response.json(selectRows(ports.contracts ?? [contract()], searchParams))
    }
    if (table === 'legal_bundle_versions') {
      expect(searchParams.get('company_id')).toBe(`eq.${companyId}`)
      return Response.json(selectRows(ports.bundles, searchParams))
    }
    if (table === 'website_customer_applications') {
      expect(searchParams.get('company_id')).toBe(`eq.${companyId}`)
      expect(searchParams.get('customer_id')).toBe(`eq.${customerId}`)
      const filters = ['company_id', 'customer_id', 'contract_id', 'id']
      const matches = ports.applications.filter((row) => filters.every((field) => {
        const filter = searchParams.get(field)
        return filter === null || filter === `eq.${row[field]}`
      }))
      return Response.json(matches.slice(0, Number(searchParams.get('limit') ?? matches.length)))
    }
    if (table === 'legal_bundle_version_documents') {
      expect(searchParams.get('legal_bundle_version_id')).toBeTruthy()
      return Response.json(selectRows([{
        ...document, template_version: document.version, created_at: acceptedAt,
        legacy_legal_text_version_id: ports.legacyTextVersionId, unresolved_variables: [],
      }, ...ports.additionalDocuments], searchParams))
    }
    if (table === 'customers') {
      expect(searchParams.get('company_id')).toBe(`eq.${companyId}`)
      expect(searchParams.get('id')).toBe(`eq.${customerId}`)
      if (method === 'PATCH') {
        Object.assign(ports.customer, body)
        return Response.json({ id: customerId })
      }
      return Response.json([ports.customer])
    }
    if (table === 'customer_legal_acceptances') {
      if (method === 'POST' && ports.persistLegalAcceptances) return ports.persistLegalAcceptances(body)
      return Response.json(method === 'POST' ? [{ id: 'test-acceptance' }] : [])
    }
    throw new Error(`Unexpected fixture operation ${method} ${pathname}`)
  })
})

afterEach(() => vi.restoreAllMocks())

function writes() {
  return ports.operations.filter(({ method, table }) => method !== 'GET' && table !== 'customer_portal_write_idempotency')
}

describe('mounted customer sync legal preflight (API-81)', () => {
  it.each([
    { name: 'missing bundle', activeBundle: null, acknowledgements: [acceptance], status: 409, code: 'LEGAL_BUNDLE_NOT_READY' },
    { name: 'mismatched evidence', activeBundle: bundleId, acknowledgements: [{ ...acceptance, document_hash: 'b'.repeat(64) }], status: 409, code: 'LEGAL_EVIDENCE_MISMATCH' },
    { name: 'mixed reference kinds', activeBundle: bundleId, acknowledgements: [acceptance, { ...acceptance,
      document_reference: grouped.document_reference, document_code: grouped.requirement_code,
      document_version: grouped.document_version, document_hash: grouped.document_hash,
    }], status: 500, code: 'customer_portal_internal_error' },
  ])('keeps the established $name response before any profile or document write', async ({ activeBundle, acknowledgements, status, code }) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    ports.activeBundle = activeBundle
    const response = await POST(request({ legal_acceptances: acknowledgements }))
    expect(response.status).toBe(status)
    expect(await response.json()).toMatchObject({ error: { code }, request_id: response.headers.get('x-request-id') })
    expect(ports.customer.first_name).toBe('Original')
    expect(writes()).toEqual([])
    expect(ports.event).not.toHaveBeenCalled()
    expect(ports.operations).toContainEqual(expect.objectContaining({
      method: 'PATCH', table: 'customer_portal_write_idempotency', body: expect.objectContaining({ status: 'failed' }),
    }))
  })

  it('updates a profile and writes its accepted document after successful preflight', async () => {
    const input = request({ legal_acceptances: [acceptance] })
    const response = await POST(input)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: { summary: { profile: { updated: true }, legal_acceptances: { created: 1 } } } })
    expect(ports.authorize).toHaveBeenCalledWith(input, expect.anything(), ['customer_sync.write'], {
      mode: 'link', allowIdentifierBoundWrite: true,
    })
    expect(ports.customer.first_name).toBe('Updated')
    expect(writes().map(({ table }) => table)).toEqual(['customers', 'customer_legal_acceptances'])
    expect(writes()[1].body).toMatchObject([{ company_id: companyId, customer_id: customerId, contract_id: contractId, legal_bundle_version_document_id: documentId }])
  })

  it('supports profile-only sync when no legal bundle is available', async () => {
    ports.activeBundle = null
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(ports.customer.first_name).toBe('Updated')
    expect(writes().map(({ table }) => table)).toEqual(['customers'])
    expect(ports.operations.some(({ table }) => table === 'legal_bundle_version_documents')).toBe(false)
  })

  it.each([
    { name: 'valid direct application', direct: applicationId, applications: [unrelatedApplication, boundApplication], expected: applicationId },
    { name: 'unique relation behind a newer unrelated application', direct: null, applications: [unrelatedApplication, boundApplication], expected: applicationId },
    { name: 'no application for this contract', direct: null, applications: [unrelatedApplication], expected: null },
    { name: 'invalid direct relation with another possible application', direct: otherApplicationId, applications: [unrelatedApplication, boundApplication], expected: null },
    { name: 'direct application belonging to another company', direct: applicationId, applications: [{ ...boundApplication, company_id: otherCompanyId }], expected: null },
    { name: 'direct application belonging to another customer', direct: applicationId, applications: [{ ...boundApplication, customer_id: otherCustomerId }], expected: null },
    { name: 'ambiguous applications for this contract', direct: null, applications: [boundApplication, { ...boundApplication, id: otherApplicationId }], expected: null },
  ])('uses the verified application identity for $name', async ({ direct, applications, expected }) => {
    ports.directApplicationId = direct
    ports.applications = applications
    const response = await POST(request({ legal_acceptances: [acceptance] }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: { summary: { legal_acceptances: { created: 1 } } } })
    const rows = writes().find(({ table }) => table === 'customer_legal_acceptances')?.body
    expect(rows).toMatchObject([{
      company_id: companyId, customer_id: customerId, contract_id: contractId,
      contract_application_id: expected, legal_bundle_version_document_id: documentId,
    }])
  })

  it.each(['published', 'replaced', 'archived'])('keeps acceptance on its %s legal bundle when a newer draft has no package', async (status) => {
    ports.contracts = [contract({ status: status === 'published' ? 'active' : 'terminated' }), contract({
      id: otherContractId, status: 'draft', legal_bundle_version_id: null, website_application_id: otherApplicationId,
      created_at: '2026-11-18T12:00:00Z',
    })]
    ports.bundles = [{ ...publicBundle, status }]
    ports.applications = [unrelatedApplication, boundApplication]
    const response = await POST(request({ legal_acceptances: [acceptance] }))
    expect(response.status).toBe(200)
    expect(writes().find(({ table }) => table === 'customer_legal_acceptances')?.body).toMatchObject([{
      contract_id: contractId, contract_application_id: applicationId,
      legal_bundle_version_document_id: documentId,
    }])
  })

  it('rejects a bundle shared by two customer agreements with a field-specific response before profile writes', async () => {
    ports.contracts = [contract(), contract({ id: otherContractId, website_application_id: otherApplicationId })]
    ports.applications = [boundApplication, unrelatedApplication]
    const response = await POST(request({ legal_acceptances: [acceptance] }))
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ error: { code: 'LEGAL_CONTRACT_AMBIGUOUS', field: 'legal_acceptances' } })
    expect(ports.customer.first_name).toBe('Original')
    expect(writes()).toEqual([])
    expect(ports.event).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'malformed', reference: 'short', code: 'VALIDATION_FAILED' },
    { name: 'unknown', reference: publicReference('legal_document', companyId, otherDocumentId), code: 'LEGAL_DOCUMENT_INVALID' },
  ])('preserves $name acceptance errors and prevents profile writes', async ({ reference, code }) => {
    const response = await POST(request({ legal_acceptances: [{ ...acceptance, document_reference: reference }] }))
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ error: { code } })
    expect(ports.customer.first_name).toBe('Original')
    expect(writes()).toEqual([])
  })

  it.each([
    { name: 'unpublished or wrong-company', bundles: [{ ...publicBundle, status: 'draft' }, { ...publicBundle, company_id: otherCompanyId }] },
    { name: 'unlocked', bundles: [{ ...publicBundle, locked_at: null }] },
  ])('rejects an $name package before customer mutations', async ({ bundles }) => {
    ports.bundles = bundles
    const response = await POST(request({ legal_acceptances: [acceptance] }))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code: 'LEGAL_BUNDLE_NOT_READY' } })
    expect(writes()).toEqual([])
  })

  it('preserves unknown-document handling when documents refer to different bundles', async () => {
    ports.contracts = [contract(), contract({ id: otherContractId, legal_bundle_version_id: otherBundleId })]
    ports.bundles = [publicBundle, { ...publicBundle, id: otherBundleId }]
    ports.additionalDocuments = [{ ...document, id: otherDocumentId, legal_bundle_version_id: otherBundleId, template_version: document.version }]
    const response = await POST(request({ legal_acceptances: [acceptance, {
      ...acceptance, document_reference: publicReference('legal_document', companyId, otherDocumentId),
    }] }))
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ error: { code: 'LEGAL_DOCUMENT_INVALID' } })
    expect(writes()).toEqual([])
  })

  it('fails closed before mutations if the contract inventory cannot be exhausted within the read budget', async () => {
    ports.contracts = Array.from({ length: 41 }, (_, i) => contract({
      id: `00000000-0000-4000-8000-${String(100 + i).padStart(12, '0')}`,
    }))
    ports.maxReadRows = 1
    const response = await POST(request({ legal_acceptances: [acceptance] }))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code: 'LEGAL_BUNDLE_NOT_READY' } })
    expect(writes()).toEqual([])
    expect(ports.operations.filter(({ table }) => table === 'customer_contracts')).toHaveLength(41)
  })

  it('accepts multiple grouped documents from the same verified package across short transport pages', async () => {
    const withdrawal = { ...document, id: otherDocumentId, module_key: 'withdrawal_right', content_sha256: 'b'.repeat(64) }
    ports.additionalDocuments = [{ ...withdrawal, template_version: withdrawal.version, created_at: acceptedAt, unresolved_variables: [] }]
    ports.contracts = [contract({ id: otherContractId, legal_bundle_version_id: otherBundleId, created_at: '2026-11-18T12:00:00Z' }), contract()]
    ports.bundles = [publicBundle, { ...publicBundle, id: otherBundleId }]
    ports.maxReadRows = 1
    const legal_acceptances = buildCustomerLegalDocuments({ companyId, legalBundleVersionId: bundleId, modules: [document, withdrawal] }).map(value => ({
      ...acceptance, document_reference: value.document_reference, document_code: value.requirement_code,
      document_version: value.document_version, document_hash: value.document_hash,
    }))
    const response = await POST(request({ legal_acceptances }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: { summary: { legal_acceptances: { created: 2 } } } })
    const records = writes().filter(({ table }) => table === 'customer_legal_acceptances').flatMap(({ body }) => body as Row[])
    expect(records).toMatchObject([
      { contract_id: contractId, contract_application_id: applicationId, legal_bundle_version_document_id: documentId },
      { contract_id: contractId, contract_application_id: applicationId, legal_bundle_version_document_id: otherDocumentId },
    ])
  })

  it('stores exact acceptance evidence for a migrated document and preserves historical acceptance', async () => {
    const { PGlite } = await import('@electric-sql/pglite')
    const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8')
    const table = schema.match(/^CREATE TABLE public\.customer_legal_acceptances \([\s\S]*?^\);$/m)?.[0]
    if (!table?.includes('customer_legal_acceptances_exact_document_check')) throw new Error('Canonical legal acceptance table missing')

    const legacyTextVersionId = '00000000-0000-4000-8000-000000000008'
    ports.legacyTextVersionId = legacyTextVersionId
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const db = new PGlite()
    try {
      await db.exec(table)
      await db.query(`
        insert into public.customer_legal_acceptances (company_id, customer_id, acceptance_type, legal_text_version_id)
        values ($1, $2, 'terms', $3)
      `, [companyId, customerId, legacyTextVersionId])

      const nativeErrors: { code?: string; constraint?: string }[] = []
      ports.persistLegalAcceptances = async body => {
        try {
          const result = await db.query(`
            insert into public.customer_legal_acceptances (
              company_id, customer_id, contract_id, contract_application_id, acceptance_type, source, accepted_at,
              legal_text_version_id, legal_bundle_version_document_id, legal_module_key,
              legal_document_version, legal_document_sha256, snapshot, metadata
            )
            select
              company_id, customer_id, contract_id, contract_application_id, acceptance_type, source, accepted_at,
              legal_text_version_id, legal_bundle_version_document_id, legal_module_key,
              legal_document_version, legal_document_sha256, snapshot, metadata
            from jsonb_populate_recordset(null::public.customer_legal_acceptances, $1::jsonb)
            returning id
          `, [JSON.stringify(body)])
          return Response.json(result.rows)
        } catch (error) {
          const issue = error as { code?: string; constraint?: string; message?: string }
          nativeErrors.push({ code: issue.code, constraint: issue.constraint })
          return Response.json({ code: issue.code, message: issue.message }, { status: 400 })
        }
      }

      const response = await POST(request({ legal_acceptances: [acceptance] }))
      expect(nativeErrors).toEqual([])
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ data: { summary: { legal_acceptances: { created: 1 } } } })
      const saved = await db.query(`
        select source, contract_id, legal_text_version_id, legal_bundle_version_document_id, legal_document_sha256, snapshot
        from public.customer_legal_acceptances order by legal_bundle_version_document_id nulls first
      `)
      expect(saved.rows).toMatchObject([
        { source: 'website', legal_text_version_id: legacyTextVersionId, legal_bundle_version_document_id: null },
        {
          source: 'customer_portal', contract_id: contractId, legal_text_version_id: null,
          legal_bundle_version_document_id: documentId, legal_document_sha256: document.content_sha256,
          snapshot: { source_module: { id: documentId }, accepted_document: { document_reference: acceptance.document_reference } },
        },
      ])
    } finally {
      await db.close()
    }
  }, 15_000)
})
