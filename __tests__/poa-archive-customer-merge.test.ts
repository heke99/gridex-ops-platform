import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { createFakeDb, type FakeDb } from './helpers/poaMailFakeDb'
import { renderFullmaktPdf } from '@/lib/email/fullmaktPdf'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({ db: null as unknown as FakeDb }))
vi.mock('@/lib/supabase/service', () => ({ get supabaseService() { return io.db.client } }))
import { ensurePoaPdfArchive } from '@/lib/customers/poaDocuments'
import { poaMailEvidenceFingerprint } from '@/lib/email/poaMailEvidence'

const company = '11111111-1111-4111-8111-111111111111'
const otherCompany = '22222222-2222-4222-8222-222222222222'
const poaId = '33333333-3333-4333-8333-333333333333'
const actor = '44444444-4444-4444-8444-444444444444'
const oldScope = { companyId: company, customerId: 'customer-a', powerOfAttorneyId: poaId }
const newScope = { ...oldScope, customerId: 'customer-b' }
const mergedAt = '2026-10-18T10:00:00.000Z'

beforeEach(() => {
  io.db = createFakeDb({
    companies: [{ id: company, legal_name: 'Synthetic tenant', org_number: '559999-9984' }],
    customers: ['customer-a', 'customer-b', 'customer-c'].map((id) => ({ id, company_id: company, full_name: id, status: 'active', merged_into_customer_id: null })),
    powers_of_attorney: [{ id: poaId, company_id: company, customer_id: 'customer-a', status: 'signed', source: 'admin',
      signer_name: 'Synthetic signer', signer_identity_number: 'synthetic-identity', accepted_at: '2026-10-01T10:00:00Z', method: 'website_acceptance',
      signed_scope_snapshot: ['current_supplier_contract'], fullmakt_snapshot: { legal_text: { body: 'Exact originally accepted legal text.' } },
      evidence_payload: { verification_reference: 'synthetic-proof' }, metadata: {}, document_path: null, updated_at: null }],
    customer_sites: [], customer_merge_events: [],
  })
})

// Model the external canonical merge RPC's retained records, using the actual
// schema/fields written by 20261002230000_customer_merge_portal_lifecycle.sql.
function canonicalMerge(source: string, primary: string): void {
  const customer = io.db.tables.customers.find((row) => row.id === source)!
  Object.assign(customer, { status: 'inactive', merge_status: 'merged', merged_into_customer_id: primary, merged_at: mergedAt, merged_by: actor })
  for (const poa of io.db.tables.powers_of_attorney) if (poa.customer_id === source && poa.company_id === company) poa.customer_id = primary
  io.db.tables.customer_merge_events.push({ id: `merge-${source}-${primary}`, company_id: company, primary_customer_id: primary,
    merged_customer_id: source, reason: 'Verified duplicate customer', moved_counts: { powers_of_attorney: 1 },
    source_snapshot: { id: source }, created_by: actor, created_at: mergedAt })
}

describe('fullmakt archive access after canonical customer merge', () => {
  it('copies the same POA original into the surviving customer namespace without changing any bytes', async () => {
    const original = await ensurePoaPdfArchive(oldScope)
    const fingerprint = poaMailEvidenceFingerprint(io.db.tables.powers_of_attorney[0])
    canonicalMerge('customer-a', 'customer-b')
    const migrated = await ensurePoaPdfArchive(newScope)
    expect(migrated.path).toContain(`/customers/customer-b/powers-of-attorney/${poaId}/`)
    expect(migrated.pdf).toEqual(original.pdf)
    expect(io.db.storageFiles.get(`customer-documents/${original.path}`)).toEqual(original.pdf)
    expect(io.db.storageFiles.get(`customer-documents/${migrated.path}`)).toEqual(original.pdf)
    const archive = (io.db.tables.powers_of_attorney[0].metadata as Row).document_archive as Row
    expect(archive.sha256).toBe(createHash('sha256').update(original.pdf).digest('hex'))
    expect(archive.evidence_sha256).toBe(fingerprint)
    expect(archive.previous_paths).toEqual([original.path])
    expect(archive.original_upload).not.toBe(true)
    expect(await ensurePoaPdfArchive(newScope)).toEqual(migrated)
    expect(io.db.storageUploads).toHaveLength(2)
  })

  it('follows an existing same-tenant canonical survivor chain', async () => {
    const original = await ensurePoaPdfArchive(oldScope)
    canonicalMerge('customer-a', 'customer-b'); canonicalMerge('customer-b', 'customer-c')
    const migrated = await ensurePoaPdfArchive({ ...newScope, customerId: 'customer-c' })
    expect(migrated.pdf).toEqual(original.pdf)
    expect(migrated.path).toContain('/customers/customer-c/')
    expect(io.db.storageFiles.get(`customer-documents/${original.path}`)).toEqual(original.pdf)
  })

  it('retains the uploaded original and its provenance when its archived copy follows the merge', async () => {
    const uploadPath = `companies/${company}/customers/customer-a/uploaded-original.pdf`
    const uploaded = renderFullmaktPdf({ legalText: 'The original uploaded and signed document.' })
    io.db.storageFiles.set(`customer-documents/${uploadPath}`, uploaded)
    io.db.tables.powers_of_attorney[0].document_path = uploadPath
    const original = await ensurePoaPdfArchive(oldScope)
    canonicalMerge('customer-a', 'customer-b')
    const migrated = await ensurePoaPdfArchive(newScope)
    const archive = (io.db.tables.powers_of_attorney[0].metadata as Row).document_archive as Row
    expect(migrated.pdf).toEqual(uploaded)
    expect(archive.original_upload).toBe(true)
    expect(archive.source_path).toBe(uploadPath)
    expect(archive.previous_paths).toEqual([uploadPath, original.path])
    expect(io.db.storageFiles.get(`customer-documents/${uploadPath}`)).toEqual(uploaded)
  })

  it('reuses an identical destination object left by a previous interrupted copy', async () => {
    const original = await ensurePoaPdfArchive(oldScope)
    canonicalMerge('customer-a', 'customer-b')
    const destination = original.path.replace('/customers/customer-a/', '/customers/customer-b/')
    io.db.storageFiles.set(`customer-documents/${destination}`, original.pdf)
    const migrated = await ensurePoaPdfArchive(newScope)
    expect(migrated.path).toBe(destination)
    expect(migrated.pdf).toEqual(original.pdf)
  })

  it('rejects an existing destination whose bytes differ without replacing either object', async () => {
    const original = await ensurePoaPdfArchive(oldScope)
    canonicalMerge('customer-a', 'customer-b')
    const destination = original.path.replace('/customers/customer-a/', '/customers/customer-b/')
    const different = renderFullmaktPdf({ legalText: 'A different existing destination document.' })
    io.db.storageFiles.set(`customer-documents/${destination}`, different)
    await expect(ensurePoaPdfArchive(newScope)).rejects.toThrow()
    expect(io.db.tables.powers_of_attorney[0].document_path).toBe(original.path)
    expect(io.db.storageFiles.get(`customer-documents/${original.path}`)).toEqual(original.pdf)
    expect(io.db.storageFiles.get(`customer-documents/${destination}`)).toEqual(different)
  })

  it.each([
    ['merge event missing', () => { io.db.tables.customer_merge_events = [] }],
    ['alias missing', () => { io.db.tables.customers[0].merged_into_customer_id = null }],
    ['different survivor', () => { io.db.tables.customers[0].merged_into_customer_id = 'customer-c' }],
    ['source belongs to another tenant', () => { io.db.tables.customers[0].company_id = otherCompany }],
    ['event belongs to another tenant', () => { io.db.tables.customer_merge_events[0].company_id = otherCompany }],
    ['no POA moved', () => { io.db.tables.customer_merge_events[0].moved_counts = { powers_of_attorney: 0 } }],
    ['wrong original customer snapshot', () => { io.db.tables.customer_merge_events[0].source_snapshot = { id: 'customer-c' } }],
    ['event actor differs from the canonical alias', () => { io.db.tables.customer_merge_events[0].created_by = 'another-actor' }],
    ['unverified merge state', () => { io.db.tables.customers[0].merge_status = null }],
    ['cycle instead of survivor', () => { io.db.tables.customers[0].merged_into_customer_id = 'customer-a' }],
  ])('does not authorize an old customer prefix when %s', async (_label, corrupt) => {
    await ensurePoaPdfArchive(oldScope)
    canonicalMerge('customer-a', 'customer-b'); corrupt()
    await expect(ensurePoaPdfArchive(newScope)).rejects.toThrow()
    expect(io.db.storageUploads).toHaveLength(1)
  })

  it('never broadens access to another POA id through an otherwise valid customer merge', async () => {
    const original = await ensurePoaPdfArchive(oldScope)
    canonicalMerge('customer-a', 'customer-b')
    const forged = original.path.replace(poaId, 'other-poa')
    io.db.tables.powers_of_attorney[0].document_path = forged
    const metadata = io.db.tables.powers_of_attorney[0].metadata as Row
    metadata.document_archive = { ...(metadata.document_archive as Row), path: forged }
    io.db.storageFiles.set(`customer-documents/${forged}`, original.pdf)
    await expect(ensurePoaPdfArchive(newScope)).rejects.toThrow()
    expect(io.db.storageUploads).toHaveLength(1)
  })

  it('requires the retained manifest hash to match the old original before copying', async () => {
    const original = await ensurePoaPdfArchive(oldScope)
    canonicalMerge('customer-a', 'customer-b')
    io.db.storageFiles.set(`customer-documents/${original.path}`, renderFullmaktPdf({ legalText: 'Different but structurally valid PDF.' }))
    await expect(ensurePoaPdfArchive(newScope)).rejects.toThrow()
    expect(io.db.storageUploads).toHaveLength(1)
  })

  it('does not use merge authority for an arbitrary original upload prefix', async () => {
    const original = await ensurePoaPdfArchive(oldScope)
    const uploaded = `companies/${company}/customers/customer-a/original-upload.pdf`
    io.db.storageFiles.set(`customer-documents/${uploaded}`, original.pdf)
    io.db.tables.powers_of_attorney[0].document_path = uploaded
    io.db.tables.powers_of_attorney[0].metadata = {}
    canonicalMerge('customer-a', 'customer-b')
    await expect(ensurePoaPdfArchive(newScope)).rejects.toThrow()
    expect(io.db.storageUploads).toHaveLength(1)
  })

  it('preserves a concurrent POA metadata change instead of overwriting it after the copy', async () => {
    const original = await ensurePoaPdfArchive(oldScope)
    canonicalMerge('customer-a', 'customer-b')
    const storageFrom = io.db.client.storage.from
    io.db.client.storage.from = (bucket) => {
      const storage = storageFrom(bucket)
      return { ...storage, upload: async (path, pdf, options) => {
        const uploaded = await storage.upload(path, pdf, options)
        Object.assign(io.db.tables.powers_of_attorney[0], { metadata: { concurrent_change: true }, updated_at: '2026-10-18T12:00:00Z' })
        return uploaded
      } }
    }
    await expect(ensurePoaPdfArchive(newScope)).rejects.toThrow()
    expect(io.db.tables.powers_of_attorney[0].document_path).toBe(original.path)
    expect(io.db.tables.powers_of_attorney[0].metadata).toEqual({ concurrent_change: true })
    expect(io.db.storageFiles.get(`customer-documents/${original.path}`)).toEqual(original.pdf)
  })
})
