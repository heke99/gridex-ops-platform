/* eslint-disable @typescript-eslint/no-explicit-any -- loose test doubles for Supabase/PostgREST ports */
// ops-api-review: F27 (permanent regression from evidence/confirmation-signature.probe.ts)
import fs from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  archive: vi.fn(), send: vi.fn(), rpc: vi.fn(),
  deliveries: new Map<string, Record<string, unknown>>(),
  requests: new Map<string, Record<string, unknown>>(),
  contracts: new Map<string, Record<string, unknown>>(),
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
      const store = table === 'customer_contract_confirmation_deliveries' ? h.deliveries : table === 'customer_contract_signature_requests' ? h.requests : table === 'customer_contracts' ? h.contracts : null
      if (!store) throw new Error(`Unexpected table: ${table}`)
      const matches = (row: Record<string, unknown>) =>
        Object.entries(eq).every(([k, v]) => row[k] === v) && (!lte || String(row[lte[0]] ?? '') <= lte[1])
      const rows = () => [...store.values()].filter(matches)
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
        select: () => q, order: () => q, limit: () => q,
        eq: (k: string, v: unknown) => { eq[k] = v; return q },
        is: (k: string, v: unknown) => { eq[k] = v; return q },
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

import { finalizeOnlineContractSignature, processPendingContractConfirmations, type OnlineSignatureReceipt } from '@/lib/customer-contracts/onlineSigning'
import {attemptContractConfirmationDelivery,recordContractConfirmationFailure} from '@/lib/customer-contracts/confirmationDelivery'

const receipt: OnlineSignatureReceipt = { used_at: '2026-10-07T09:00:00Z', customer_number: 'SYNTHETIC-1', starts_at: null, ends_at: null, price_area: null, request_id: 'request-1', company_id: 'tenant-a', customer_id: 'customer-1', contract_id: 'contract-1', contract_number: 'C-1', contract_name: 'Variable', contract_type: 'spot', status: 'signed', signed_at: '2026-10-07T09:00:00Z', expires_at: '2026-10-08T09:00:00Z', channel: 'internal', customer_name: 'Synthetic', customer_email: 'test@example.invalid', company_name: 'Tenant A', offer_reference: 'offer-1', pricing_snapshot: {}, pricing_snapshot_sha256: 'a'.repeat(64), legal_versions: [{ id: 'legal-1', module_key: 'terms', title: 'Terms', version: '1' }], legal_bundle_version_id: 'bundle-1', contract_publication_version_id: 'pub-1', price_plan_version_id: 'price-1', signature_snapshot_sha256: 'b'.repeat(64) }

// Explicit declared RPC port; SQL/role/CAS behavior is also executed against
// PGlite in poa-confirmation-runtime-fence.test.ts and the existing native CI.
function advancePort(args:Record<string,unknown>){
 const key=String(args.p_request_id)
 if(!h.deliveries.has(key))h.deliveries.set(key,{company_id:args.p_company_id,customer_contract_id:args.p_contract_id,signature_request_id:key,state:'pending',attempts:0,next_attempt_at:'1970-01-01T00:00:00.000Z'})
 const row=h.deliveries.get(key)!
 if(row.company_id!==args.p_company_id||row.customer_contract_id!==args.p_contract_id)return {data:null,error:new Error('confirmation_binding_invalid')}
 const attempts=Number(row.attempts)
 if(args.p_action==='claim'){
  if(row.state!=='pending'||attempts>=8||Date.parse(String(row.next_attempt_at))>Date.now())return {data:{claimed:false,state:row.state,attempts},error:null}
  const lease=new Date(Date.now()+600_000).toISOString().replace('Z','123Z')
  row.next_attempt_at=lease
  return {data:{claimed:true,state:'pending',attempts,lease_until:lease},error:null}
 }
 if(row.state!=='pending'||!args.p_expected_lease_until||row.next_attempt_at!==args.p_expected_lease_until)return {data:{advanced:false,state:row.state,attempts},error:null}
 row.attempts=attempts+1
 if(args.p_action==='queued')Object.assign(row,{state:'queued',document_sha256:args.p_document_sha256,last_error:null})
 else Object.assign(row,{state:attempts+1>=8?'failed':'pending',last_error:args.p_error,next_attempt_at:new Date(Date.now()+300_000).toISOString()})
 return {data:{advanced:true,state:row.state,attempts:row.attempts},error:null}
}

beforeEach(() => {
  vi.clearAllMocks()
  h.deliveries.clear(); h.requests.clear(); h.contracts.clear(); h.signCount = 0
  h.contracts.set('contract-1', {
    id: 'contract-1', company_id: 'tenant-a', document_sha256: null,
    withdrawal_deadline_at: null, tenant_communication_snapshot_sha256: 'c'.repeat(64),
    signature_snapshot: { recipient_email: 'test@example.invalid', customer_identity_snapshot: { full_name: 'Synthetic' } },
  })
  h.requests.set('request-1', { id: 'request-1', company_id: 'tenant-a', token_hash: 'f'.repeat(64), used_at: '2026-10-07T09:00:00Z' })
  h.rpc.mockImplementation(async (name: string,args:Record<string,unknown>) => {
    if(name==='gridex_advance_contract_confirmation_v2')return advancePort(args)
    if (name === 'gridex_finalize_customer_contract_signature_v2') {
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
    expect(h.contracts.get('contract-1')?.document_sha256).toBeNull()
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
    const archives = h.archive.mock.calls.length
    h.deliveries.get('request-1')!.state = 'queued'
    await processPendingContractConfirmations(10)
    expect(h.send.mock.calls.length).toBe(sends)
    expect(h.archive.mock.calls.length).toBe(archives)
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
    h.rpc.mockImplementation(async (name: string, args: Record<string,unknown>) =>
      name==='gridex_advance_contract_confirmation_v2'?advancePort(args):args?.p_token_hash === 'e'.repeat(64) ? { data: { ...receipt, request_id: 'broken', customer_name: '' }, error: null } : { data: receipt, error: null })
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
  it('preserves the exact PostgreSQL microsecond lease through callback and completion',async()=>{
    const result=await attemptContractConfirmationDelivery(receipt,async()=>({documentSha256:'a'.repeat(64)}))
    expect(result).toEqual({state:'queued',error:null})
    const finish=h.rpc.mock.calls.find(([name,args])=>name==='gridex_advance_contract_confirmation_v2'&&args.p_action==='queued')
    expect(finish?.[1].p_expected_lease_until).toMatch(/\.\d{6}Z$/)
  })
  it('never invokes delivery or a legacy update after a protocol denial',async()=>{
    h.rpc.mockResolvedValueOnce({data:null,error:new Error('confirmation_v2_runtime_required')})
    const deliver=vi.fn()
    await expect(attemptContractConfirmationDelivery(receipt,deliver)).rejects.toThrow('confirmation_v2_runtime_required')
    expect(deliver).not.toHaveBeenCalled();expect(h.deliveries.size).toBe(0)
  })
  it('does not complete a newer lease or overwrite it in outer worker failure handling',async()=>{
    const result=await attemptContractConfirmationDelivery(receipt,async()=>{
      h.deliveries.get('request-1')!.next_attempt_at='2999-01-01T00:00:00.123456Z'
      return {documentSha256:'a'.repeat(64)}
    })
    expect(result).toEqual({state:'pending',error:'confirmation_lease_lost'})
    await recordContractConfirmationFailure(receipt,99,'unowned outer failure')
    expect(h.deliveries.get('request-1')).toMatchObject({state:'pending',attempts:0,next_attempt_at:'2999-01-01T00:00:00.123456Z'})
  })
})

describe('F27: continuation is created inside the signing transaction (native)', () => {
  it('marking a request used inserts exactly one pending delivery, rolled back with the signing', async () => {
    const db = new PGlite()
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table public.companies(id uuid primary key);
      create table public.platform_table_classification(table_name text primary key, kind text, rationale text, classified_by text);
      create table public.customer_contract_signature_requests(id uuid primary key, company_id uuid not null, customer_contract_id uuid not null, used_at timestamptz);
    `)
    await db.exec(fs.readFileSync('supabase/migrations/20261009100000_ops_api_contract_confirmation_delivery_continuation.sql', 'utf8'))
    await db.exec(fs.readFileSync('supabase/migrations/20261009220000_classify_contract_confirmation_deliveries.sql', 'utf8'))
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
