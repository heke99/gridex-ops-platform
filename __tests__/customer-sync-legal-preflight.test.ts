import { NextRequest } from 'next/server'
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
      return Response.json([{
        id: contractId, metering_point_id: 'fixture-point', website_application_id: 'fixture-application',
        legal_bundle_version_id: ports.activeBundle,
      }])
    }
    if (table === 'legal_bundle_version_documents') {
      expect(searchParams.get('legal_bundle_version_id')).toBe(`eq.${bundleId}`)
      return Response.json([{ ...document, template_version: document.version, created_at: acceptedAt }])
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
})
