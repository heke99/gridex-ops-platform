// reality-defects: (FINDINGS F51, owner decisions 2026-10-22)
// The customer signs the identity and registered address that are sent to the grid owner:
// website signing binds the section into a v3 signature snapshot (v2 unchanged without it),
// token-signed receipts render the snapshot's section into the archived PDF, and the
// declaration is derived before every Z03 from the verified signed bytes. Finite transports.
import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  rows: {} as Record<string, Row[]>, rpc: vi.fn(), blob: null as Buffer | null, uploads: [] as Array<{ path: string; bytes: Buffer }>,
  mail: [] as Row[], methodCalls: [] as Row[],
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/ediel/retention/customerRecordClasses', () => ({ requireContractRecordsAvailable: vi.fn().mockResolvedValue(undefined), requireCustomerRecordAvailable: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/email/sendCompanyEmail', () => ({ sendCompanyEmail: async (input: Row) => { io.mail.push(input); return { ok: true } } }))
vi.mock('@/lib/ediel/production/contractRequestedMethodSource', () => ({ deriveContractRequestedMethodFromSignedAgreement: async (input: Row) => { io.methodCalls.push(input); return false } }))
vi.mock('@/lib/website/customerApplicationCommunication', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/website/customerApplicationCommunication')>()),
  companyEmailContext: async () => ({ legalName: 'Synthetic supplier AB', name: 'Synthetic supplier', organizationNumber: '5560000000', postalAddress: null, supportEmail: 'support@example.invalid', snapshotSha256: 'a'.repeat(64) }),
}))
vi.mock('@/lib/supabase/service', () => {
  class Query {
    filters: Record<string, unknown> = {}; mode = 'select'; payload: Row = {}
    constructor(readonly table: string) {}
    returns() { return this }
    select() { return this }
    limit() { return this }
    eq(key: string, value: unknown) { this.filters[key] = value; return this }
    is(key: string, value: unknown) { this.filters[key] = value; return this }
    not(key: string, _op: string, value: unknown) { this.filters[`not:${key}`] = value; return this }
    insert(value: Row) { this.mode = 'insert'; this.payload = value; return this }
    update(value: Row) { this.mode = 'update'; this.payload = value; return this }
    async run(single = false) {
      if (!(this.table in io.rows)) throw new Error(`Undeclared transport table: ${this.table}`)
      if (this.mode === 'insert') { io.rows[this.table].push({ ...this.payload }); return { data: this.payload, error: null } }
      const rows = io.rows[this.table].filter(row => Object.entries(this.filters).every(([key, value]) => key.startsWith('not:') ? (row[key.slice(4)] ?? null) !== value : (row[key] ?? null) === value))
      if (this.mode === 'update') for (const row of rows) Object.assign(row, this.payload)
      return { data: single ? rows[0] ?? null : rows, error: null }
    }
    single() { return this.run(true) }
    maybeSingle() { return this.run(true) }
    then(resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) { return this.run().then(resolve, reject) }
  }
  return { supabaseService: {
    rpc: io.rpc,
    from: (table: string) => new Query(table),
    storage: { from: () => ({
      upload: async (path: string, bytes: Buffer) => { io.uploads.push({ path, bytes }); return { error: null } },
      download: async () => io.blob ? { data: new Blob([Uint8Array.from(io.blob)]), error: null } : { data: null, error: new Error('not_found') },
    }) },
  } }
})
import { finalizeWebsiteContractSignature, type WebsiteContractCreateResult } from '@/lib/website/customerApplicationCommunication'
import { deliverSignedContractReceipt, type OnlineSignatureReceipt } from '@/lib/customer-contracts/onlineSigning'
import { deriveContractCustomerMasterdata, deriveCustomerMasterdataBeforeSwitch } from '@/lib/operations/switchCustomerMasterdataPreparation'
import { deriveRequestedMethodBeforeSwitch } from '@/lib/operations/switchRequestedMethodPreparation'
import type { PublicContractOffer } from '@/lib/website/publicContracts'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const COMPANY = id(1), CUSTOMER = id(2), CONTRACT = id(3), APPLICATION = id(4)
const section = {
  schema: 'gridex_contract_customer_masterdata_v1', customerId: CUSTOMER, registeredAddressId: id(5), source: 'website_declaration', declaredAt: '2026-10-22T09:00:00.000Z',
  customerIdentity: { id: '199001011234', qualifier: 'SE2', agency: '260' },
  endUserMasterdata: { nameParts: ['Anna Andersson'], streetParts: ['Storgatan 1'], postalCode: '441 30', city: 'Alingsås', country: 'SE' },
}
// The v2 snapshot keys as signed before F51 (customerApplicationCommunication websiteSignatureSnapshot).
const V2_KEYS = ['schema', 'company_id', 'customer_id', 'contract_id', 'application_id', 'public_contract_offer_id', 'offer_reference', 'contract_publication_version_id',
  'contract_product_id', 'contract_product_version_id', 'energy_direction', 'legal_bundle_version_id', 'price_plan_id', 'price_plan_version_id', 'price_book_id',
  'contract_price_snapshot_id', 'accepted_at', 'agreement_channel', 'legal_versions', 'request_evidence']

const offer = { id: id(10), contract_publication_version_id: id(11), contract_product_id: id(12), contract_product_version_id: id(13), energy_direction: 'consumption',
  legal_bundle_version_id: id(14), price_plan_id: id(15), price_plan_version_id: id(16), price_book_id: null } as unknown as PublicContractOffer
const websiteContract = { id: CONTRACT, contract_name: 'Rörligt', starts_at: '2026-11-01', status: 'pending_signature', contract_number: 'AVT-1', price_plan_id: id(15), price_plan_version_id: id(16), contract_price_snapshot_id: id(17) } as WebsiteContractCreateResult
const finalizeInput = { companyId: COMPANY, customerId: CUSTOMER, contract: websiteContract, applicationId: APPLICATION, publicOffer: offer, offerReference: 'offer-ref', acceptedAt: '2026-10-22T10:00:00.000Z', legalVersions: [], rawPayload: {} }

function rpcWith(sectionResult: { data: unknown; error: unknown }) {
  io.rpc.mockImplementation(async (name: string, args: Row) => {
    if (name === 'gridex_retry_website_contract_signature') return { data: null, error: null }
    if (name === 'gridex_contract_customer_masterdata_section_v1') return sectionResult
    if (name === 'gridex_finalize_website_contract_signature') return { data: { signed_at: args.p_accepted_at, signature_snapshot_sha256: args.p_signature_snapshot_sha256, acceptance_ids: {} }, error: null }
    throw new Error(`Undeclared RPC transport: ${name}`)
  })
}
const signedSnapshot = () => io.rpc.mock.calls.find(call => call[0] === 'gridex_finalize_website_contract_signature')?.[1] as Row | undefined

beforeEach(() => {
  io.rpc.mockReset(); io.rows = {}; io.blob = null; io.uploads = []; io.mail = []; io.methodCalls = []
})

describe('website signature snapshot (F51)', () => {
  it('binds the customer masterdata section into a v3 snapshot whose hash covers it', async () => {
    rpcWith({ data: section, error: null })
    await finalizeWebsiteContractSignature(finalizeInput)
    expect(io.rpc).toHaveBeenCalledWith('gridex_contract_customer_masterdata_section_v1', { p_company_id: COMPANY, p_customer_id: CUSTOMER })
    const args = signedSnapshot()!, snapshot = args.p_signature_snapshot as Row
    expect(snapshot.schema).toBe('gridex_website_contract_signature_v3')
    expect(snapshot.customer_masterdata).toEqual(section)
    expect(Object.keys(snapshot)).toEqual([...V2_KEYS, 'customer_masterdata'])
    expect(args.p_signature_snapshot_sha256).toBe(createHash('sha256').update(JSON.stringify(snapshot), 'utf8').digest('hex'))
  })

  it('keeps the v2 snapshot exactly when the customer has no qualified registered address', async () => {
    rpcWith({ data: null, error: null })
    await finalizeWebsiteContractSignature(finalizeInput)
    const snapshot = signedSnapshot()!.p_signature_snapshot as Row
    expect(snapshot.schema).toBe('gridex_website_contract_signature_v2')
    expect(Object.keys(snapshot)).toEqual(V2_KEYS)
  })

  it.each([
    ['an unreadable section', { data: null, error: { code: 'PGRST202', message: 'missing function' } }],
    ['a section of another customer', { data: { ...section, customerId: id(99) }, error: null }],
    ['a malformed section', { data: { ...section, customerIdentity: { id: '199001011234', qualifier: 'SE9', agency: '260' } }, error: null }],
  ])('does not sign with %s', async (_label, result) => {
    rpcWith(result)
    await expect(finalizeWebsiteContractSignature(finalizeInput)).rejects.toMatchObject({ code: 'contract_customer_masterdata_section_failed' })
    expect(signedSnapshot()).toBeUndefined()
  })
})

describe('token-signed receipt PDF (F51)', () => {
  const receipt: OnlineSignatureReceipt = { request_id: id(20), company_id: COMPANY, customer_id: CUSTOMER, contract_id: CONTRACT, contract_number: 'AVT-1', contract_name: 'Rörligt', contract_type: 'variable_monthly',
    status: 'signed', signed_at: '2026-10-22T10:00:00Z', used_at: '2026-10-22T10:00:00Z', expires_at: '2026-10-25T10:00:00Z', channel: 'internal', customer_name: 'Anna Andersson', customer_email: 'anna@example.invalid',
    customer_number: 'K-1', company_name: 'Synthetic supplier', offer_reference: 'offer-ref', starts_at: '2026-11-01', ends_at: null, price_area: 'SE3', pricing_snapshot: { monthly_fee_sek: 49 },
    pricing_snapshot_sha256: 'b'.repeat(64), legal_versions: [{ id: id(21), module_key: 'terms', title: 'Villkor', version: '1' }], legal_bundle_version_id: id(14),
    contract_publication_version_id: id(11), price_plan_version_id: id(16), signature_snapshot_sha256: 'c'.repeat(64) }
  const contractRow = (signature: Row) => ({ id: CONTRACT, company_id: COMPANY, withdrawal_deadline_at: null, document_sha256: null, tenant_communication_snapshot_sha256: 'a'.repeat(64), signature_snapshot: signature })

  it('archives a PDF carrying the signed identity and registered address lines', async () => {
    io.rows = { customer_contracts: [contractRow({ schema: 'gridex_online_contract_signature_v2', recipient_email: 'anna@example.invalid', customer_masterdata: section })], customer_contract_documents: [] }
    const result = await deliverSignedContractReceipt(receipt)
    expect(io.uploads).toHaveLength(1)
    const pdf = io.uploads[0].bytes.toString('latin1')
    expect(pdf).toContain('Td\n(Personnummer: 199001011234) Tj\n')
    expect(pdf).toContain('Td\n(Folkbokf\\366ringsadress: Storgatan 1) Tj\n')
    expect(pdf).toContain('Td\n(Postnummer och ort: 441 30 Alings\\345s) Tj\n')
    expect(result.documentSha256).toBe(createHash('sha256').update(io.uploads[0].bytes).digest('hex'))
  })

  it('archives the unchanged PDF for a snapshot without the section', async () => {
    io.rows = { customer_contracts: [contractRow({ schema: 'gridex_online_contract_signature_v1', recipient_email: 'anna@example.invalid' })], customer_contract_documents: [] }
    await deliverSignedContractReceipt(receipt)
    const pdf = io.uploads[0].bytes.toString('latin1')
    expect(pdf).not.toContain('KUNDUPPGIFTER')
    expect(pdf).not.toContain('199001011234')
  })
})

describe('declaration derivation before Z03 (F51)', () => {
  const pdf = Buffer.from('%PDF-1.4 signed agreement'), hash = createHash('sha256').update(pdf).digest('hex')
  const scope = { companyId: COMPANY, contractId: CONTRACT, actorUserId: id(30), environment: 'test' as const }
  const archived = () => ({ customer_contracts: [{ id: CONTRACT, company_id: COMPANY, document_sha256: hash }],
    customer_contract_documents: [{ company_id: COMPANY, customer_contract_id: CONTRACT, document_type: 'signed_contract_pdf', document_sha256: hash, verified_at: '2026-10-22T10:00:00Z', storage_bucket: 'customer-contract-documents', storage_path: 'c/1.pdf' }] })

  it('passes the verified archived signed bytes to the native owner', async () => {
    io.rows = archived(); io.blob = pdf
    io.rpc.mockResolvedValue({ data: { status: 'derived', declarationId: id(40) }, error: null })
    await expect(deriveContractCustomerMasterdata(scope)).resolves.toEqual({ status: 'derived', declarationId: id(40) })
    expect(io.rpc).toHaveBeenCalledWith('ediel_derive_contract_customer_masterdata_v1', { p_company_id: COMPANY, p_contract_id: CONTRACT, p_actor_user_id: id(30), p_environment: 'test', p_agreement_original: `\\x${pdf.toString('hex')}` })
  })

  it('stays held without calling the owner when the archived bytes do not match the signed hash', async () => {
    io.rows = archived(); io.blob = Buffer.from('%PDF-1.4 other bytes')
    await expect(deriveContractCustomerMasterdata(scope)).resolves.toEqual({ status: 'held', missing: ['archived_verified_signed_agreement_original'] })
    expect(io.rpc).not.toHaveBeenCalled()
  })

  it('returns the owner\'s held reason and rejects an unexpected result', async () => {
    io.rows = archived(); io.blob = pdf
    io.rpc.mockResolvedValueOnce({ data: { status: 'held', missing: ['staff_entry_registered_customer_address'] }, error: null })
    await expect(deriveContractCustomerMasterdata(scope)).resolves.toEqual({ status: 'held', missing: ['staff_entry_registered_customer_address'] })
    io.rpc.mockResolvedValueOnce({ data: { status: 'authorized' }, error: null })
    await expect(deriveContractCustomerMasterdata(scope)).rejects.toThrow('contract_customer_masterdata_result_invalid')
  })

  it('runs for both lanes from the requested-method preparation that both switch paths call, and never blocks', async () => {
    io.rows = { ...archived(), supplier_switch_requests: [{ id: id(50), company_id: COMPANY, customer_contract_id: CONTRACT, contract_id: CONTRACT }] }; io.blob = pdf
    io.rpc.mockResolvedValueOnce({ data: { status: 'derived', declarationId: id(40) }, error: null }).mockRejectedValueOnce(new Error('transport down'))
    await expect(deriveRequestedMethodBeforeSwitch({ companyId: COMPANY, actorUserId: id(30), switchRequestId: id(50) })).resolves.toBeUndefined()
    expect(io.methodCalls.map(call => call.environment)).toEqual(['production', 'test'])
    expect(io.rpc.mock.calls.map(call => [call[0], (call[1] as Row).p_environment])).toEqual([
      ['ediel_derive_contract_customer_masterdata_v1', 'production'], ['ediel_derive_contract_customer_masterdata_v1', 'test']])
  })

  it('does nothing for an unknown switch request', async () => {
    io.rows = { supplier_switch_requests: [] }
    await expect(deriveCustomerMasterdataBeforeSwitch({ companyId: COMPANY, actorUserId: id(30), switchRequestId: id(51) })).resolves.toBeUndefined()
    expect(io.rpc).not.toHaveBeenCalled()
  })
})
