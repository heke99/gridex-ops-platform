// ops-api-review: F27 (permanent regression from evidence/confirmation-signature.probe.ts)
import fs from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  archive: vi.fn(), send: vi.fn(), rpc: vi.fn(),
  deliveries: new Map<string, Record<string, unknown>>(),
  requests: new Map<string, Record<string, unknown>>(),
  signCount: 0,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/ediel/retention/customerRecordClasses', () => ({ requireContractRecordsAvailable: vi.fn() }))
vi.mock('@/lib/customer-contracts/documents', () => ({ archiveSignedCustomerContractPdf: h.archive }))
vi.mock('@/lib/customer-contracts/agreementPdf', () => ({ buildAgreementPdfAttachment: () => ({ content: Buffer.from('synthetic-pdf').toString('base64'), contentType: 'application/pdf', filename: 'agreement.pdf' }) }))
vi.mock('@/lib/email/sendCompanyEmail', () => ({ sendCompanyEmail: h.send }))
vi.mock('@/lib/website/customerApplicationCommunication', () => ({ companyEmailContext: vi.fn(async () => ({ name: 'Tenant A', legalName: 'Tenant A AB', snapshotSha256: 'c'.repeat(64), supportEmail: 'support@example.invalid' })) }))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    rpc: h.rpc,
    from: (table: string) => {
      const eq: Record<string, unknown> = {}
      let lte: [string, string] | null = null
      let patch: Record<string, unknown> | null = null
      let upsert: Record<string, unknown> | null = null
      let ignoreDuplicates = false
      const store = table === 'customer_contract_confirmation_deliveries' ? h.deliveries : table === 'customer_contract_signature_requests' ? h.requests : null
      const matches = (row: Record<string, unknown>) =>
        Object.entries(eq).every(([k, v]) => row[k] === v) && (!lte || String(row[lte[0]] ?? '') <= lte[1])
      const rows = () => store ? [...store.values()].filter(matches) : [{ document_sha256: null }]
      const run = () => {
        if (upsert) {
          const key = String(upsert.signature_request_id)
          if (!(ignoreDuplicates && h.deliveries.has(key))) {
            h.deliveries.set(key, { state: 'pending', attempts: 0, next_attempt_at: '1970-01-01T00:00:00.000Z', ...(h.deliveries.get(key) ?? {}), ...upsert })
          }
          return { data: null, error: null }
        }
        if (patch && store) {
          const hit = rows()
          hit.forEach((row) => Object.assign(row, patch))
          return { data: hit[0] ?? null, error: null }
        }
        return { data: rows(), error: null }
      }
      const q: any = {
        select: () => q, is: () => q, order: () => q, limit: () => q,
        eq: (k: string, v: unknown) => { eq[k] = v; return q },
        lte: (k: string, v: string) => { lte = [k, v]; return q },
        update: (row: Record<string, unknown>) => { patch = row; return q },
        upsert: (row: Record<string, unknown>, options?: { ignoreDuplicates?: boolean }) => { upsert = row; ignoreDuplicates = Boolean(options?.ignoreDuplicates); return q },
        single: async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: null } },
        maybeSingle: async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: null } },
        then: (resolve: any, reject?: any) => Promise.resolve(run()).then(resolve, reject),
      }
      return q
    },
  },
}))

import { finalizeOnlineContractSignature, processPendingContractConfirmations } from '@/lib/customer-contracts/onlineSigning'

const receipt = { request_id: 'request-1', company_id: 'tenant-a', customer_id: 'customer-1', contract_id: 'contract-1', contract_number: 'C-1', contract_name: 'Variable', contract_type: 'spot', status: 'signed', signed_at: '2026-10-07T09:00:00Z', expires_at: '2026-10-08T09:00:00Z', channel: 'internal', customer_name: 'Synthetic', customer_email: 'test@example.invalid', company_name: 'Tenant A', offer_reference: 'offer-1', pricing_snapshot: {}, pricing_snapshot_sha256: 'a'.repeat(64), legal_versions: [{ id: 'legal-1', module_key: 'terms', title: 'Terms', version: '1' }], legal_bundle_version_id: 'bundle-1', contract_publication_version_id: 'pub-1', price_plan_version_id: 'price-1', signature_snapshot_sha256: 'b'.repeat(64) }

beforeEach(() => {
  vi.clearAllMocks()
  h.deliveries.clear(); h.requests.clear(); h.signCount = 0
  h.requests.set('request-1', { id: 'request-1', company_id: 'tenant-a', token_hash: 'f'.repeat(64), used_at: '2026-10-07T09:00:00Z' })
  h.rpc.mockImplementation(async (name: string) => {
    if (name === 'gridex_finalize_customer_contract_signature_v1') {
      h.signCount++
      // The signing transaction's trigger creates the pending continuation.
      h.deliveries.set('request-1', { company_id: 'tenant-a', customer_contract_id: 'contract-1', signature_request_id: 'request-1', state: 'pending', attempts: 0, next_attempt_at: '1970-01-01T00:00:00.000Z' })
    }
    return { data: receipt, error: null }
  })
  h.archive.mockResolvedValue(undefined)
  h.send.mockResolvedValue({ ok: true })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('F27: durable signed-contract confirmation continuation', () => {
  it('archive failure after signing leaves a pending continuation, not a false queued state', async () => {
    h.archive.mockRejectedValueOnce(new Error('synthetic_archive_unavailable'))
    const result = await finalizeOnlineContractSignature({ token: 'a'.repeat(64) })
    expect(result.receipt.status).toBe('signed')
    expect(result.confirmationState).toBe('pending')
    expect(h.send).not.toHaveBeenCalled()
    expect(h.deliveries.get('request-1')).toMatchObject({ state: 'pending', attempts: 1, last_error: 'synthetic_archive_unavailable' })
  })

  it('worker retry queues the confirmation without signing again, with a stable idempotency key', async () => {
    h.archive.mockRejectedValueOnce(new Error('synthetic_archive_unavailable'))
    await finalizeOnlineContractSignature({ token: 'a'.repeat(64) })
    h.deliveries.get('request-1')!.next_attempt_at = '1970-01-01T00:00:00.000Z'
    const run = await processPendingContractConfirmations(10)
    expect(run.results).toEqual([{ signatureRequestId: 'request-1', state: 'queued', error: null }])
    expect(h.signCount).toBe(1)
    expect(h.send).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'online_signature:request-1:confirmation' }))
    expect(h.deliveries.get('request-1')).toMatchObject({ state: 'queued' })
  })

  it('an already queued confirmation is not delivered twice', async () => {
    await finalizeOnlineContractSignature({ token: 'a'.repeat(64) })
    expect(h.deliveries.get('request-1')).toMatchObject({ state: 'queued' })
    const sends = h.send.mock.calls.length
    h.deliveries.get('request-1')!.state = 'queued'
    await processPendingContractConfirmations(10)
    expect(h.send.mock.calls.length).toBe(sends)
  })

  it('stops retrying after the maximum attempts and reports failed', async () => {
    h.archive.mockRejectedValue(new Error('synthetic_permanent_failure'))
    h.deliveries.set('request-1', { company_id: 'tenant-a', customer_contract_id: 'contract-1', signature_request_id: 'request-1', state: 'pending', attempts: 7, next_attempt_at: '1970-01-01T00:00:00.000Z' })
    const run = await processPendingContractConfirmations(10)
    expect(run.results[0]).toMatchObject({ state: 'failed' })
  })
})

describe('bug-hunt: worker isolation and leases', () => {
  it('a broken row records its own failure and does not stop the next row', async () => {
    h.deliveries.set('broken', { company_id: 'tenant-a', customer_contract_id: 'contract-x', signature_request_id: 'broken', state: 'pending', attempts: 0, next_attempt_at: '1970-01-01T00:00:00.000Z' })
    h.requests.set('broken', { id: 'broken', company_id: 'tenant-a', token_hash: 'e'.repeat(64), used_at: '2026-10-07T09:00:00Z' })
    h.deliveries.set('request-1', { company_id: 'tenant-a', customer_contract_id: 'contract-1', signature_request_id: 'request-1', state: 'pending', attempts: 0, next_attempt_at: '1970-01-01T00:00:00.000Z' })
    h.rpc.mockImplementation(async (_name: string, args: { p_token_hash?: string }) =>
      args?.p_token_hash === 'e'.repeat(64) ? { data: { ...receipt, request_id: 'broken', customer_name: '' }, error: null } : { data: receipt, error: null })
    const run = await processPendingContractConfirmations(10)
    expect(run.results.map((r) => r.state).sort()).toEqual(['error', 'queued'])
    expect(h.deliveries.get('broken')).toMatchObject({ state: 'pending', attempts: 1 })
    expect(h.deliveries.get('request-1')).toMatchObject({ state: 'queued' })
  })
  it('a leased row is not delivered concurrently by the worker', async () => {
    h.deliveries.set('request-1', { company_id: 'tenant-a', customer_contract_id: 'contract-1', signature_request_id: 'request-1', state: 'pending', attempts: 0, next_attempt_at: '2999-01-01T00:00:00.000Z' })
    await processPendingContractConfirmations(10)
    expect(h.archive).not.toHaveBeenCalled()
    expect(h.send).not.toHaveBeenCalled()
  })
})

describe('F27: continuation is created inside the signing transaction (native)', () => {
  it('marking a request used inserts exactly one pending delivery, rolled back with the signing', async () => {
    const db = new PGlite()
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table public.companies(id uuid primary key);
      create table public.customer_contract_signature_requests(id uuid primary key, company_id uuid not null, customer_contract_id uuid not null, used_at timestamptz);
    `)
    await db.exec(fs.readFileSync('supabase/migrations/20261009100000_ops_api_contract_confirmation_delivery_continuation.sql', 'utf8'))
    await db.exec(`
      insert into companies values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
      insert into customer_contract_signature_requests values
        ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','21111111-1111-4111-8111-111111111111',null),
        ('12222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222',null);
      update customer_contract_signature_requests set used_at = now() where id = '11111111-1111-4111-8111-111111111111';
      update customer_contract_signature_requests set used_at = now() where id = '11111111-1111-4111-8111-111111111111';
    `)
    await db.exec(`begin; update customer_contract_signature_requests set used_at = now() where id = '12222222-2222-4222-8222-222222222222'; rollback;`)
    const rows = await db.query<{ company_id: string; customer_contract_id: string; state: string }>('select company_id, customer_contract_id, state from customer_contract_confirmation_deliveries')
    expect(rows.rows).toEqual([{ company_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', customer_contract_id: '21111111-1111-4111-8111-111111111111', state: 'pending' }])
    await db.close()
  })
})
