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
      const filters: Record<string, unknown> = {}
      let upsert: Record<string, unknown> | null = null
      const rows = () => {
        if (table === 'customer_contract_confirmation_deliveries') {
          return [...h.deliveries.values()].filter((row) => Object.entries(filters).every(([k, v]) => k === 'lte' || row[k] === v))
        }
        if (table === 'customer_contract_signature_requests') {
          return [...h.requests.values()].filter((row) => Object.entries(filters).every(([k, v]) => row[k] === v))
        }
        return [{ document_sha256: null }]
      }
      const q: any = {
        select: () => q, update: () => q, is: () => q, order: () => q, limit: () => q,
        eq: (k: string, v: unknown) => { filters[k === 'id' ? 'id' : k] = v; return q },
        lte: () => q,
        upsert: (row: Record<string, unknown>) => { upsert = row; return q },
        single: async () => ({ data: rows()[0] ?? null, error: null }),
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (resolve: any, reject?: any) => {
          if (upsert) {
            const key = String(upsert.signature_request_id)
            h.deliveries.set(key, { ...(h.deliveries.get(key) ?? {}), ...upsert })
            return Promise.resolve({ data: null, error: null }).then(resolve, reject)
          }
          return Promise.resolve({ data: rows(), error: null }).then(resolve, reject)
        },
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
      h.deliveries.set('request-1', { company_id: 'tenant-a', customer_contract_id: 'contract-1', signature_request_id: 'request-1', state: 'pending', attempts: 0 })
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
    h.deliveries.set('request-1', { company_id: 'tenant-a', customer_contract_id: 'contract-1', signature_request_id: 'request-1', state: 'pending', attempts: 7 })
    const run = await processPendingContractConfirmations(10)
    expect(run.results[0]).toMatchObject({ state: 'failed' })
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
