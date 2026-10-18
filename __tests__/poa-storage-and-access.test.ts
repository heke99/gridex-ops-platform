import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { createFakeDb, type FakeDb } from './helpers/poaMailFakeDb'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({ db: null as unknown as FakeDb,
  guard: { companyId: '', isPlatformAdmin: false, userId: 'user-1', permissions: ['poa.read'], roles: [], email: null, isAdmin: true }, denied: false,
  writable: true,
}))
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))
vi.mock('@/lib/admin/guards', () => ({ requireAdminActionAccess: async () => io.guard }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => io.db.client }))
vi.mock('@/lib/tenant/scope', () => ({ assertUserCanOperateCompany: async (_userId: string, companyId: string) => {
  if (!io.writable) throw new Error(`Bolaget ${companyId} är pausat`)
  return companyId
} }))
vi.mock('@/lib/supabase/service', () => ({ get supabaseService() { return io.db.client } }))
vi.mock('@/lib/admin/apiGuards', () => ({
  requireAdminApiAccess: async () => io.denied ? { response: NextResponse.json({ error: 'Denied' }, { status: 403 }) } : { guard: io.guard },
  jsonError: (error: string, status: number) => NextResponse.json({ error }, { status }),
}))
vi.mock('@/lib/tenant/entityGuards', () => ({ assertCompanyAccessForGuard: async (companyId: string, guard: typeof io.guard) => {
  if (!guard.isPlatformAdmin && companyId !== guard.companyId) throw new Error('Denied')
} }))
vi.mock('@/lib/customers/customerOperationEvents', () => ({ emitCustomerOperationEvent: async () => undefined }))
vi.mock('@/lib/http/apiError', () => ({ internalApiError: ({ code, status = 500 }: { code: string; status?: number }) => NextResponse.json({ error: code }, { status }) }))
vi.mock('@/lib/tenant/adminScope', () => ({ tenantReadCompanyId: (isPlatformAdmin: boolean, companyId: string | null) => {
  if (isPlatformAdmin) return null
  if (!companyId) throw new Error('Bolagskoppling saknas')
  return companyId
} }))

import { ensurePoaPdfArchive, savePoaPdfArchive } from '@/lib/customers/poaDocuments'
import { poaMailEvidenceFingerprint } from '@/lib/email/poaMailEvidence'
import { derivePowerOfAttorneyLifecycleStatus, hasExternallySendablePoa } from '@/lib/customers/poaReadiness'
import { completePoaCaptureEvidence } from '@/lib/customers/poaEvidenceCompletion'
import { readPoaRegister } from '@/lib/customers/poaRegister'
import { resolveManualReplyReview } from '@/lib/inbound-mail/manualReplyReview'
import { GET } from '@/app/api/admin/powers-of-attorney/[powerOfAttorneyId]/document/route'
import { resolvePoaReplyAction } from '@/app/admin/powers-of-attorney/actions'

const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222'
const PA = '33333333-3333-4333-8333-333333333333', PB = '44444444-4444-4444-8444-444444444444'
const acceptedAt = '2026-10-01T10:00:00Z'
const scope = { companyId: A, customerId: 'customer-a', powerOfAttorneyId: PA }
function seed() {
  return createFakeDb({
    companies: [{ id: A, name: 'Tenant A', org_number: '559999-9984' }, { id: B, name: 'Tenant B', org_number: '559999-9976' }],
    customers: [{ id: 'customer-a', company_id: A, customer_number: 'K-A', full_name: 'Synthetic Alpha' }, { id: 'customer-b', company_id: B, customer_number: 'K-B', full_name: 'Synthetic Beta' }],
    customer_sites: [], grid_owner_information_requests: [],
    powers_of_attorney: [
      { id: PA, company_id: A, customer_id: 'customer-a', status: 'signed', source: 'website_api', reference: 'POA-A', method: 'website_acceptance',
        accepted_at: acceptedAt, signer_name: 'Synthetic Alpha', signer_identity_number: 'synthetic-a',
        fullmakt_snapshot: { legal_text: { body: 'Accepted terms for Tenant A', title: 'Fullmakt', version: 'v1' }, scopes: ['facility_information_lookup'] },
        evidence_payload: { verification_reference: 'verification-a', source: 'website_api' }, metadata: {} },
      { id: PB, company_id: B, customer_id: 'customer-b', status: 'signed', reference: 'POA-B', accepted_at: acceptedAt,
        fullmakt_snapshot: { legal_text: { body: 'Accepted terms for Tenant B' } }, evidence_payload: { verification_reference: 'verification-b' }, metadata: {} },
    ],
  })
}
beforeEach(() => { io.db = seed(); io.guard.companyId = A; io.guard.isPlatformAdmin = false; io.denied = false; io.writable = true })

describe('private fullmakt PDF storage', () => {
  it('archives once and keeps previous original bytes when evidence is safely completed', async () => {
    const first = await ensurePoaPdfArchive(scope)
    await completePoaCaptureEvidence(scope, { signerName: 'Synthetic Alpha', signerIdentity: 'synthetic-a', method: 'website_acceptance', acceptedAt, signerIp: '192.0.2.10' })
    const completed = await ensurePoaPdfArchive(scope)
    expect(completed.path).not.toBe(first.path)
    expect(completed.pdf.toString('latin1')).toContain('192.0.2.10')
    expect(io.db.storageFiles.get(`customer-documents/${first.path}`)).toEqual(first.pdf)
    expect(await ensurePoaPdfArchive(scope)).toEqual(completed)
    expect(io.db.storageUploads).toHaveLength(2)
    expect((io.db.tables.powers_of_attorney[0].metadata as Row).document_archive).toMatchObject({ previous_paths: [first.path] })
  })
  it('cannot archive a customer/POA belonging to another tenant', async () => {
    await expect(ensurePoaPdfArchive({ ...scope, powerOfAttorneyId: PB })).rejects.toThrow('hittades inte')
    expect(io.db.storageUploads).toHaveLength(0)
  })
  it('rejects PDF bytes rendered before the evidence changed', async () => {
    const archived = await ensurePoaPdfArchive(scope)
    const fingerprint = poaMailEvidenceFingerprint(io.db.tables.powers_of_attorney[0])
    await completePoaCaptureEvidence(scope, { signerName: 'Synthetic Alpha', signerIdentity: 'synthetic-a', method: 'website_acceptance', acceptedAt, signerIp: '192.0.2.10' })
    await expect(savePoaPdfArchive(scope, archived.pdf, fingerprint)).rejects.toThrow('ändrades under PDF')
  })
  it('archives legacy partner originals only for a verified same-tenant partner POA', async () => {
    const generated = await ensurePoaPdfArchive(scope)
    const poa = io.db.tables.powers_of_attorney[0], path = `partner-api/${A}/synthetic-file.pdf`
    Object.assign(poa, { source: 'partner_api', document_path: path, metadata: {} })
    io.db.storageFiles.set(`customer-documents/${path}`, generated.pdf)
    expect((await ensurePoaPdfArchive(scope)).pdf).toEqual(generated.pdf)
    Object.assign(poa, { document_path: `partner-api/${B}/synthetic-file.pdf`, metadata: {} })
    await expect(ensurePoaPdfArchive(scope)).rejects.toThrow('lagringsväg')
    Object.assign(poa, { source: 'website_api', document_path: path, metadata: {} })
    await expect(ensurePoaPdfArchive(scope)).rejects.toThrow('lagringsväg')
  })
  it('copies an uploaded original into the immutable archive without changing its bytes', async () => {
    const generated = await ensurePoaPdfArchive(scope)
    const uploaded = `companies/${A}/customers/customer-a/customer/power_of_attorney/upload.pdf`
    io.db.storageFiles.set(`customer-documents/${uploaded}`, generated.pdf)
    io.db.tables.powers_of_attorney[0].document_path = uploaded
    io.db.tables.powers_of_attorney[0].metadata = {}
    const archived = await ensurePoaPdfArchive(scope)
    expect(archived.path).not.toBe(uploaded)
    expect(archived.pdf).toEqual(generated.pdf)
    io.db.storageFiles.delete(`customer-documents/${uploaded}`)
    expect((await ensurePoaPdfArchive(scope)).pdf).toEqual(generated.pdf)
    expect((io.db.tables.powers_of_attorney[0].metadata as Row).document_archive).toMatchObject({ original_upload: true, source_path: uploaded })
  })
  it('archiving an unproven legacy upload does not supply missing customer consent', async () => {
    const original = await ensurePoaPdfArchive(scope)
    const poa = io.db.tables.powers_of_attorney[0], path = 'customer-a/legacy-original.pdf'
    Object.assign(poa, { source: 'admin', accepted_at: null, signed_at: null, fullmakt_snapshot: {}, evidence_payload: {}, metadata: {}, document_path: path })
    io.db.storageFiles.set(`customer-documents/${path}`, original.pdf)
    await ensurePoaPdfArchive(scope)
    expect((poa.evidence_payload as Row).verification_reference).toBeTruthy()
    expect(derivePowerOfAttorneyLifecycleStatus(poa)).toBe('awaiting_signature')
    expect(hasExternallySendablePoa(poa)).toBe(false)
  })
  it('recovers only the exact accepted portal legal document and verifies its hash', async () => {
    const body = 'Original accepted portal authorization', hash = createHash('sha256').update(body).digest('hex')
    io.db.tables.powers_of_attorney[0].fullmakt_snapshot = { legal_bundle_version_id: 'bundle-a', legal_bundle_version_document_id: 'doc-a', document_hash: hash, scopes: ['supplier_switch'] }
    io.db.tables.legal_bundle_versions = [{ id: 'bundle-a', company_id: A }]
    io.db.tables.legal_bundle_version_documents = [{ id: 'doc-a', legal_bundle_version_id: 'bundle-a', content_sha256: hash, rendered_body: body, title: 'Fullmakt', template_version: 'v1' }]
    expect((await ensurePoaPdfArchive(scope)).pdf.toString('latin1')).toContain(body)
    io.db.tables.powers_of_attorney[0].document_path = null
    io.db.tables.legal_bundle_version_documents[0].rendered_body = 'Changed after acceptance'
    await expect(ensurePoaPdfArchive(scope)).rejects.toThrow('kontrollsumma')
  })
  it('does not attach an IP from another consent timestamp or change the signer', async () => {
    await completePoaCaptureEvidence(scope, { signerName: 'Synthetic Alpha', signerIdentity: 'synthetic-a', method: 'website_acceptance', acceptedAt: '2026-10-02T10:00:00Z', signerIp: '192.0.2.11' })
    expect((io.db.tables.powers_of_attorney[0].evidence_payload as Row).ip_address).toBeUndefined()
    await expect(completePoaCaptureEvidence(scope, { signerName: 'Someone Else', signerIdentity: 'synthetic-a', method: 'website_acceptance', acceptedAt, signerIp: '192.0.2.11' })).rejects.toThrow('annan undertecknare')
  })
})

describe('tenant and superadmin fullmakt register', () => {
  const client = () => io.db.client as unknown as Parameters<typeof readPoaRegister>[0]
  it('keeps a tenant in its canonical scope even when a different company filter is supplied', async () => {
    const result = await readPoaRegister(client(), io.guard, { company: B })
    expect(result.powers.map((row) => (row as Row).id)).toEqual([PA])
    expect(result.companies.map((row) => row.id)).toEqual([A])
  })
  it('lets superadmin search by tenant and customer', async () => {
    io.guard.isPlatformAdmin = true
    const result = await readPoaRegister(client(), io.guard, { company: B, customer: 'Beta' })
    expect(result.powers.map((row) => (row as Row).id)).toEqual([PB])
    expect(result.powers[0].customer?.customer_number).toBe('K-B')
  })
  it('fails closed for a tenant without a canonical company', async () => {
    io.guard.companyId = ''
    await expect(readPoaRegister(client(), io.guard, {})).rejects.toThrow('Bolagskoppling saknas')
  })
  it('finds business customers by company name', async () => {
    io.db.tables.customers[0].full_name = null
    io.db.tables.customers[0].company_name = 'Synthetic Business AB'
    const result = await readPoaRegister(client(), io.guard, { customer: 'Business' })
    expect(result.powers.map((row) => (row as Row).id)).toEqual([PA])
  })
  it('finds a partial verification number inside the authenticated tenant scope', async () => {
    const result = await readPoaRegister(client(), io.guard, { verification: 'FICATION-A' })
    expect(result.powers.map((row) => (row as Row).id)).toEqual([PA])
  })
})

describe('authenticated PDF download', () => {
  const get = (id: string) => GET(new NextRequest('https://ops.example/api/document?download=1'), { params: Promise.resolve({ powerOfAttorneyId: id }) })
  it('denies another tenant before accessing its private PDF', async () => {
    expect((await get(PB)).status).toBe(404)
    expect(io.db.storageUploads).toHaveLength(0)
  })
  it('allows superadmin to retrieve another tenant PDF with no public caching', async () => {
    io.guard.isPlatformAdmin = true
    const response = await get(PB)
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('Content-Type')).toBe('application/pdf')
    expect(await response.text()).toContain('Tenant B')
  })
  it('rejects a forged foreign document path even on an owned fullmakt row', async () => {
    io.db.tables.powers_of_attorney[0].document_path = `companies/${B}/customers/customer-b/stolen.pdf`
    expect((await get(PA)).status).toBe(422)
    expect(io.db.storageUploads).toHaveLength(0)
  })
  it('does not access documents when the session lacks permission', async () => {
    io.denied = true
    expect((await get(PA)).status).toBe(403)
    expect(io.db.writes).toHaveLength(0)
  })
})

describe('review completion without forcing a new fullmakt', () => {
  it('checks operational write access to the target tenant before a superadmin correction', async () => {
    io.guard.isPlatformAdmin = true; io.writable = false
    io.db.tables.grid_owner_information_requests = [{ id: 'req-b', company_id: B, poa_id: PB, status: 'needs_review', metadata: { counterparty_reply: { requires_review: true } } }]
    const form = new FormData(); form.set('request_id', 'req-b'); form.set('poa_id', PB); form.set('resolution_note', 'Corrected tenant identity.')
    await expect(resolvePoaReplyAction(form)).rejects.toThrow(`Bolaget ${B} är pausat`)
    expect(io.db.writes).toHaveLength(0)
  })
  it('records an authenticated correction for the same POA and preserves the original reply', async () => {
    io.db.tables.grid_owner_information_requests = [{ id: 'req-a', company_id: A, customer_id: 'customer-a', poa_id: PA, status: 'needs_review',
      metadata: { counterparty_reply: { requires_review: true, outcome: 'completion_requested', reason_codes: ['tenant_organization_number_missing'], inbound_id: 'inbound-a' } } }]
    await resolveManualReplyReview({ companyId: A, requestId: 'req-a', powerOfAttorneyId: PA, actorUserId: 'admin-a', note: 'Organisationsnummer och verifierad mottagare har rättats.' })
    expect(io.db.tables.grid_owner_information_requests[0]).toMatchObject({ status: 'ready_to_send_manual_email', poa_id: PA,
      metadata: { counterparty_reply: { requires_review: false, reviewed_by: 'admin-a', reason_codes: ['tenant_organization_number_missing'] } } })
  })
  it('cannot resolve a reply belonging to another tenant', async () => {
    io.db.tables.grid_owner_information_requests = [{ id: 'req-b', company_id: B, poa_id: PB, status: 'needs_review' }]
    await expect(resolveManualReplyReview({ companyId: A, requestId: 'req-b', powerOfAttorneyId: PB, actorUserId: 'admin-a', note: 'A sufficiently long note.' })).rejects.toThrow('hittades inte')
    expect(io.db.writes).toHaveLength(0)
  })
  it('refuses to clear a newer rejection received while the operator is reviewing', async () => {
    io.db.tables.grid_owner_information_requests = [{ id: 'req-a', company_id: A, customer_id: 'customer-a', poa_id: PA, status: 'needs_review', updated_at: '2026-10-01T10:00:00Z',
      metadata: { counterparty_reply: { requires_review: true, inbound_id: 'inbound-a' } } }]
    const from = io.db.client.from
    let calls = 0
    vi.spyOn(io.db.client, 'from').mockImplementation((table: string) => {
      if (table === 'grid_owner_information_requests' && ++calls === 2) {
        Object.assign(io.db.tables.grid_owner_information_requests[0], { updated_at: '2026-10-01T10:00:00Z', metadata: { counterparty_reply: { requires_review: true, inbound_id: 'inbound-b' } } })
      }
      return from(table)
    })
    await expect(resolveManualReplyReview({ companyId: A, requestId: 'req-a', powerOfAttorneyId: PA, actorUserId: 'admin-a', note: 'Corrected sender organization number.' })).rejects.toThrow('ändrades samtidigt')
    expect(io.db.tables.grid_owner_information_requests[0]).toMatchObject({ status: 'needs_review', metadata: { counterparty_reply: { requires_review: true, inbound_id: 'inbound-b' } } })
  })
})
