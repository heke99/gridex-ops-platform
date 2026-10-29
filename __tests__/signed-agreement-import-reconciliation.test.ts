import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  deny: false, create: vi.fn(),
  save: vi.fn(), upload: vi.fn(), remove: vi.fn(),
  rows: {} as Record<string, { data: unknown; error: unknown }>,
  filters: [] as Array<[string, string, unknown]>,
}))
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({revalidatePath: vi.fn()}))
vi.mock('next/navigation', () => ({redirect: (url: string) => {throw new Error('REDIRECT:'+url)}}))
vi.mock('@/lib/admin/guards', () => ({requireAdminActionAccess: async () => {if(io.deny)throw new Error('denied');return {userId:'staff-a'}}}))
vi.mock('@/lib/tenant/entityGuards', () => ({loadCustomerTenantContext: async () => ({companyId:'company-a'})}))
vi.mock('@/lib/customer-contracts/autoSendSigningLink', () => ({autoSendSigningLinkAfterCreate: vi.fn()}))
vi.mock('@/lib/customer-contracts/db', () => ({createCustomerContract: io.create,getContractOfferById: async () => ({id:'offer-a',is_active:true,status:'active'}),addCustomerContractEvent:vi.fn(),getCustomerContractById:vi.fn(),updateCustomerContract:vi.fn()}))
vi.mock('@/lib/operations/db', () => ({ saveCustomerAuthorizationDocument: io.save }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { storage: { from: () => ({ upload: io.upload, remove: io.remove }) } } }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({
  auth: {getUser: async () => ({data:{user:{id:'staff-a'}}})},
  from: (table: string) => {
    const chain = { select: () => chain, eq: (key: string, value: unknown) => {
      io.filters.push([table, key, value]); return chain
    }, maybeSingle: async () => io.rows[table] ?? { data: null, error: null } }
    return chain
  },
}) }))

import { importSignedAgreementForContract } from '@/lib/customer-contracts/importSignedAgreement'

const file = new File(['%PDF-1.4\nunit fixture\n%%EOF'], 'signed.pdf', { type: 'application/pdf' })
const checksum = createHash('sha256').update(Buffer.from('%PDF-1.4\nunit fixture\n%%EOF')).digest('hex')
const input = { companyId: 'company-a', customerId: 'customer-a', contractId: 'contract-a', siteId: 'site-a', meteringPointId: 'point-a', file, declaredSignedDate: null }
const lost = new TypeError('connection lost after commit')

beforeEach(() => {
  io.deny=false; io.create.mockReset();
  io.save.mockReset(); io.upload.mockReset(); io.remove.mockReset()
  io.rows = {}; io.filters = []
  io.upload.mockResolvedValue({ error: null })
  io.remove.mockResolvedValue({ error: null })
})

function committed() {
  const doc = { id: 'authorization-a', company_id: 'company-a', customer_id: 'customer-a', customer_contract_id: 'contract-a', site_id: 'site-a', metering_point_id: 'point-a', document_type: 'complete_agreement', status: 'active', storage_bucket: 'customer-documents', file_checksum: checksum, mime_type: 'application/pdf', metadata: { source: 'customer_intake', documentRole: 'signed_agreement' } }
  const contract = { id: 'contract-a', company_id: 'company-a', customer_id: 'customer-a', status: 'signed', signed_at: '2026-10-29T12:00:00Z', document_sha256: checksum, signature_snapshot_sha256: 'a'.repeat(64), contract_price_snapshot_id: 'price-a', contract_product_version_id: 'product-v-a', contract_publication_version_id: 'publication-v-a', price_plan_version_id: 'plan-v-a', legal_bundle_version_id: 'legal-v-a', signature_snapshot: { schema: 'gridex_imported_signed_contract_v1', company_id: 'company-a', customer_id: 'customer-a', contract_id: 'contract-a', contract_product_version_id: 'product-v-a', contract_publication_version_id: 'publication-v-a', price_plan_version_id: 'plan-v-a', legal_bundle_version_id: 'legal-v-a', pricing_snapshot_sha256: 'c'.repeat(64), source_authorization_document_id: 'authorization-a', signed_contract_document_id: 'signed-document-a', signed_document_sha256: checksum, contract_price_snapshot_id: 'price-a', signing_method: 'imported_signed_document' } }
  const signed = { id: 'signed-document-a', company_id: 'company-a', customer_contract_id: 'contract-a', document_type: 'signed_contract_pdf', storage_bucket: 'customer-documents', document_sha256: checksum, verified_at: '2026-10-29T12:00:00Z' }
  io.save.mockImplementation(async (_client, payload) => {
    io.rows.customer_authorization_documents = { data: { ...doc, file_path: payload.file_path }, error: null }
    io.rows.customer_contracts = { data: contract, error: null }
    io.rows.contract_price_snapshots = { data: { id: 'price-a', company_id: 'company-a', customer_id: 'customer-a', contract_id: 'contract-a', price_plan_version_id: 'plan-v-a', snapshot_hash: 'c'.repeat(64), snapshot_quality: 'canonical' }, error: null }
    io.rows.customer_contract_documents = { data: { ...signed, storage_path: payload.file_path }, error: null }
    throw lost
  })
  return { doc, contract, signed }
}

describe('actual import function with finite storage/persistence/read ports', () => {
  it('keeps the original PDF when the write outcome cannot be established', async () => {
    io.save.mockRejectedValueOnce(lost)
    await expect(importSignedAgreementForContract(input)).rejects.toBe(lost)
    expect(io.upload).toHaveBeenCalledOnce()
    expect(io.save).toHaveBeenCalledOnce()
    expect(io.remove).not.toHaveBeenCalled()
  })

  it('recovers only the exactly bound committed signature after a lost response', async () => {
    committed()
    await expect(importSignedAgreementForContract(input)).resolves.toEqual({ documentId: 'authorization-a' })
    expect(io.remove).not.toHaveBeenCalled()
    expect(io.save).toHaveBeenCalledOnce()
    expect(io.filters).toContainEqual(['customer_contracts', 'company_id', 'company-a'])
    expect(io.filters).toContainEqual(['customer_contracts', 'customer_id', 'customer-a'])
    expect(io.filters).toContainEqual(['customer_authorization_documents', 'customer_contract_id', 'contract-a'])
  })

  it.each(['wrong-tenant', 'wrong-customer', 'wrong-hash', 'wrong-document', 'missing-verified-pdf', 'read-error', 'unknown-schema', 'signature-scope', 'changed-version', 'changed-ledger-hash'])('preserves PDF and refuses false success on %s', async (fault) => {
    committed()
    const save = io.save.getMockImplementation()!
    io.save.mockReset().mockImplementationOnce(async (...args) => {
      try { await save(...args) } catch { /* deliberately lose the original response */ }
      const c = io.rows.customer_contracts.data as Record<string, unknown>
      if (fault === 'wrong-tenant') c.company_id = 'company-b'
      if (fault === 'wrong-customer') c.customer_id = 'customer-b'
      if (fault === 'wrong-hash') c.document_sha256 = 'b'.repeat(64)
      if (fault === 'wrong-document') (c.signature_snapshot as Record<string, unknown>).source_authorization_document_id = 'other-document'
      if (fault === 'missing-verified-pdf') io.rows.customer_contract_documents = { data: null, error: null }
      if (fault === 'unknown-schema') (c.signature_snapshot as Record<string, unknown>).schema = 'future-unknown'
      if (fault === 'signature-scope') (c.signature_snapshot as Record<string, unknown>).customer_id = 'other-customer'
      if (fault === 'changed-version') c.price_plan_version_id = 'other-plan-version'
      if (fault === 'changed-ledger-hash') (io.rows.contract_price_snapshots.data as Record<string, unknown>).snapshot_hash = 'd'.repeat(64)
      if (fault === 'read-error') io.rows.customer_authorization_documents = { data: null, error: new Error('read unavailable') }
      throw lost
    })
    await expect(importSignedAgreementForContract(input)).rejects.toBe(lost)
    expect(io.remove).not.toHaveBeenCalled()
    expect(io.save).toHaveBeenCalledOnce()
  })

  it('does not attempt the import after a failed storage upload', async () => {
    io.upload.mockResolvedValueOnce({ error: lost })
    await expect(importSignedAgreementForContract(input)).rejects.toBe(lost)
    expect(io.save).not.toHaveBeenCalled()
    expect(io.remove).not.toHaveBeenCalled()
  })

  it('retains the ordinary successful import and exact tenant/contract attribution', async () => {
    io.save.mockResolvedValueOnce({ id: 'authorization-a' })
    await expect(importSignedAgreementForContract(input)).resolves.toEqual({ documentId: 'authorization-a' })
    expect(io.save.mock.calls[0][1]).toMatchObject({ companyId: 'company-a', customer_id: 'customer-a', customer_contract_id: 'contract-a', site_id: 'site-a', metering_point_id: 'point-a', storage_bucket: 'customer-documents', file_checksum: checksum })
    expect(io.remove).not.toHaveBeenCalled()
  })
})

// Expected PDF selection errors must return feedback before any contract write.
describe('contract creation signed-PDF validation feedback', () => {
  it.each(['createContractAction','createContractFromOfferAction'] as const)('returns a field error from %s without creating or uploading', async (name) => {
    const actions = await import('@/components/admin/customers/contracts/actions')
    const form = new FormData()
    form.set('customer_id','customer-a');form.set('contract_name','Synthetic contract');form.set('contract_offer_id','offer-a');form.set('signing_method','uploaded_signed')
    await expect(actions[name](form)).resolves.toMatchObject({status:'invalid',field:'signed_agreement_file'})
    expect(io.create).not.toHaveBeenCalled();expect(io.upload).not.toHaveBeenCalled();expect(io.save).not.toHaveBeenCalled()
  })
  it('preserves staff authorization before validation feedback', async () => {
    io.deny=true
    const {createContractAction}=await import('@/components/admin/customers/contracts/actions')
    await expect(createContractAction(new FormData())).rejects.toThrow('denied')
    expect(io.create).not.toHaveBeenCalled()
  })
})
