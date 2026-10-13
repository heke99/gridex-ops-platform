// Real receipt delivery/PDF hashing/archive download logic; finite transports.
// No native signing, Storage operation or email provider request is executed.
import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const io = vi.hoisted(() => ({ rows: {} as Record<string, Record<string, unknown>[]>, blob: new Uint8Array(), writes: [] as string[], mail: [] as Record<string, unknown>[], downloads: [] as string[], bindRace: false }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/ediel/retention/customerRecordClasses', () => ({ requireContractRecordsAvailable: vi.fn().mockResolvedValue(undefined), requireCustomerRecordAvailable: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/website/customerApplicationCommunication', () => ({ companyEmailContext: async () => ({ legalName: 'Synthetic supplier', name: 'Synthetic supplier', organizationNumber: null, postalAddress: null, supportEmail: 'support@example.invalid', snapshotSha256: 'a'.repeat(64) }) }))
vi.mock('@/lib/email/sendCompanyEmail', () => ({ sendCompanyEmail: async (input: Record<string, unknown>) => { io.mail.push(input); return { ok: true } } }))
vi.mock('@/lib/supabase/service', () => {
  class Query {
    filters: Record<string, unknown> = {}; mode = 'select'; payload: Record<string, unknown> = {}
    constructor(readonly table: string) {}
    select() { return this }
    eq(key: string, value: unknown) { this.filters[key] = value; return this }
    is(key: string, value: unknown) { this.filters[key] = value; return this }
    not(key: string, _comparison: string, value: unknown) { this.filters[`not:${key}`] = value; return this }
    insert(value: Record<string, unknown>) { this.mode = 'insert'; this.payload = value; return this }
    update(value: Record<string, unknown>) { this.mode = 'update'; this.payload = value; return this }
    async run(single = false) {
      if (!(this.table in io.rows)) throw new Error(`Undeclared transport table: ${this.table}`)
      if (this.mode !== 'select') io.writes.push(this.table)
      if (this.mode === 'update' && this.table === 'customer_contracts' && io.bindRace) {
        io.rows.customer_contracts[0].document_sha256 = io.rows.customer_contract_documents[0].document_sha256
        io.bindRace = false
      }
      const rows = this.mode === 'insert' ? [this.payload] : io.rows[this.table].filter(row => Object.entries(this.filters).every(([key, value]) => key.startsWith('not:') ? (row[key.slice(4)] ?? null) !== value : (row[key] ?? null) === value))
      if (this.mode === 'update') for (const row of rows) Object.assign(row, this.payload)
      return { data: single ? rows[0] ?? null : rows, error: null }
    }
    single() { return this.run(true) }
    maybeSingle() { return this.run(true) }
    then(resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) { return this.run().then(resolve, reject) }
  }
  return { supabaseService: {
    from: (table: string) => new Query(table),
    storage: { from: (bucket: string) => ({
      upload: async () => { io.writes.push('storage-upload'); return { error: null } },
      download: async (path: string) => { io.downloads.push(`${bucket}/${path}`); return { data: new Blob([Uint8Array.from(io.blob)]), error: null } },
    }) },
  } }
})
import { deliverSignedContractReceipt, type OnlineSignatureReceipt } from '@/lib/customer-contracts/onlineSigning'
const COMPANY = 'synthetic-company', CONTRACT = 'synthetic-contract'
const originalPdf = Buffer.from('%PDF-1.4\nSynthetic original signed agreement\n%%EOF')
const HASH = createHash('sha256').update(originalPdf).digest('hex')
const receipt: OnlineSignatureReceipt = { request_id: 'synthetic-request', company_id: COMPANY, customer_id: 'synthetic-customer', contract_id: CONTRACT, contract_number: 'SYNTHETIC-CONTRACT', contract_name: 'Synthetic agreement', contract_type: 'variable_monthly', status: 'signed', signed_at: '2026-10-12T12:00:00Z', used_at: '2026-10-12T12:00:00Z', expires_at: '2026-10-15T12:00:00Z', channel: 'internal', customer_name: 'Changed contact name', customer_email: 'changed-contact@example.invalid', customer_number: 'SYNTHETIC-CUSTOMER', company_name: 'Synthetic supplier', offer_reference: 'synthetic-offer', starts_at: '2026-11-01', ends_at: null, price_area: 'SE3', pricing_snapshot: { monthly_fee_sek: 49 }, pricing_snapshot_sha256: 'b'.repeat(64), legal_versions: [{ id: 'synthetic-legal-version', module_key: 'terms', title: 'Synthetic terms', version: '1', body: 'Synthetic immutable terms' }], legal_bundle_version_id: 'synthetic-bundle', contract_publication_version_id: 'synthetic-publication', price_plan_version_id: 'synthetic-price-plan', signature_snapshot_sha256: 'c'.repeat(64) }
beforeEach(() => {
  io.mail = []; io.writes = []; io.downloads = []; io.blob = originalPdf; io.bindRace = false
  io.rows = {
    customer_contracts: [{ id: CONTRACT, company_id: COMPANY, withdrawal_deadline_at: null, document_sha256: HASH, tenant_communication_snapshot_sha256: 'a'.repeat(64), signature_snapshot: { recipient_email: 'original-signer@example.invalid', customer_identity_snapshot: { full_name: 'Original signer name' } } }],
    customer_contract_documents: [{ id: 'synthetic-document', company_id: COMPANY, customer_contract_id: CONTRACT, document_type: 'signed_contract_pdf', document_sha256: HASH, storage_bucket: 'customer-contract-documents', storage_path: `${COMPANY}/${CONTRACT}/signed-contract-${HASH}.pdf`, mime_type: 'application/pdf', archived_at: '2026-10-12T12:00:00Z', verified_at: '2026-10-12T12:00:00Z' }],
  }
})
describe('signed receipt confirmation recovery', () => {
  it('reuses the bound verified PDF and signed recipient despite later contact changes', async () => {
    await expect(deliverSignedContractReceipt(receipt)).resolves.toMatchObject({ documentSha256: HASH, confirmationQueued: true })
    expect(io.writes).toEqual([])
    expect(io.mail).toHaveLength(1)
    expect(io.mail[0].to).toBe('original-signer@example.invalid')
    expect((io.mail[0].variables as Record<string, unknown>).customer_name).toBe('Original signer name')
    const attachment = (io.mail[0].attachments as Array<{ content: string }>)[0]
    expect(Buffer.from(attachment.content, 'base64')).toEqual(originalPdf)
    expect(io.downloads).toEqual([`customer-contract-documents/${COMPANY}/${CONTRACT}/signed-contract-${HASH}.pdf`])
  })
  it('refuses corrupted archived bytes before queuing any confirmation', async () => {
    io.blob = Buffer.from('corrupted archive')
    await expect(deliverSignedContractReceipt(receipt)).rejects.toThrow('customer_contract_document_hash_mismatch')
    expect(io.mail).toEqual([])
    expect(io.writes).toEqual([])
  })
  it('displays the persisted deadline across the Stockholm DST boundary in both messages', async () => {
    io.rows.customer_contracts[0].withdrawal_deadline_at = '2026-03-29T22:30:00Z'
    await deliverSignedContractReceipt(receipt)
    expect(io.mail).toHaveLength(2)
    for (const mail of io.mail) expect((mail.variables as Record<string, unknown>).cancellation_deadline).toBe('2026-03-30')
    expect(io.writes).toEqual([])
    const attachment = (io.mail[0].attachments as Array<{ content: string }>)[0]
    expect(Buffer.from(attachment.content, 'base64')).toEqual(originalPdf)
  })
  it('refuses an archive row belonging to another company', async () => {
    io.rows.customer_contract_documents[0].company_id = 'foreign-company'
    await expect(deliverSignedContractReceipt(receipt)).rejects.toThrow('signed_contract_document_binding_missing')
    expect(io.mail).toEqual([])
    expect(io.downloads).toEqual([])
    expect(io.writes).toEqual([])
  })
  it('does not send candidate bytes when another worker wins the immutable binding', async () => {
    io.rows.customer_contracts[0].document_sha256 = null
    io.bindRace = true
    await expect(deliverSignedContractReceipt(receipt)).rejects.toThrow('signed_contract_document_binding_changed')
    expect(io.rows.customer_contracts[0].document_sha256).toBe(HASH)
    expect(io.mail).toEqual([])
  })
  it('sends the generated candidate only after its binding is returned by the compare-and-set', async () => {
    io.rows.customer_contracts[0].document_sha256 = null
    const result = await deliverSignedContractReceipt(receipt)
    expect(io.rows.customer_contracts[0].document_sha256).toBe(result.documentSha256)
    expect(io.mail).toHaveLength(1)
    const attachment = (io.mail[0].attachments as Array<{ content: string }>)[0]
    expect(createHash('sha256').update(Buffer.from(attachment.content, 'base64')).digest('hex')).toBe(result.documentSha256)
  })
})
