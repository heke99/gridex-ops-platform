import { createHash } from 'node:crypto'
import { inspect } from 'node:util'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
type Write = { table: string; operation: string; row: Row; predicates: Row }
const f = vi.hoisted(() => ({
  rpc: vi.fn(), after: vi.fn(), rows: [] as Row[], writes: [] as Write[], reads: [] as Write[],
  stage: 'claim' as 'claim' | 'subject' | 'upsert' | 'success' | 'replay',
  fault: null as Row | null, failUpdate: false, deny: null as string | null, paused: false,
}))
vi.mock('server-only', () => ({}))
vi.mock('next/server', async original => ({ ...await original<typeof import('next/server')>(), after: f.after }))
vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  rpc: f.rpc,
  from(table: string) {
    let operation = 'read', row: Row = {}
    const predicates: Row = {}
    const result = () => {
      const receipt = { table, operation, row: structuredClone(row), predicates: { ...predicates } }
      if (operation === 'read') f.reads.push(receipt)
      else f.writes.push(receipt)
      if (table === 'integration_api_clients') {
        expect(operation).toBe('update'); expect(predicates.id).toBe('00000000-0000-4000-8000-000000000084')
        return { data: null, error: null }
      }
      if (table === 'integration_api_requests') {
        expect(operation).toBe('insert'); f.rows.push(structuredClone(row)); return { data: null, error: null }
      }
      if (table === 'customer_portal_write_idempotency') {
        if (operation === 'insert') {
          if (f.stage === 'claim') return { data: null, error: f.fault }
          if (f.stage === 'replay') return { data: null, error: { code: '23505' } }
          return { data: { id: '00000000-0000-4000-8000-000000000087' }, error: null }
        }
        if (operation === 'read') {
          const initial = f.writes.find(write => write.table === table && write.operation === 'insert')!
          return { data: { id: '00000000-0000-4000-8000-000000000087', status: 'completed', request_hash: initial.row.request_hash,
            response_status: 200, response_body: { data: { status: 'linked', access_granted: true, portal_role: 'owner' } } }, error: null }
        }
        return { data: { id: '00000000-0000-4000-8000-000000000087' }, error: f.failUpdate && row.status === 'failed' ? f.fault : null }
      }
      expect(predicates.company_id ?? row.company_id).toBe('00000000-0000-4000-8000-000000000083')
      if (table === 'customer_portal_identities') {
        if (operation === 'upsert') return f.stage === 'upsert' ? { data: null, error: f.fault }
          : { data: { id: '00000000-0000-4000-8000-000000000088', status: 'rejected', customer_id: null }, error: null }
        expect(predicates).toMatchObject({ provider: 'gridex_website', external_customer_id: 'SYNTHETIC-EXT', auth_user_id: '00000000-0000-4000-8000-000000000086' })
        return f.stage === 'subject' ? { data: null, error: f.fault }
          : { data: f.stage === 'replay' ? { status: 'active', customer_id: '00000000-0000-4000-8000-000000000089' } : null, error: null }
      }
      expect(table).toBe('customer_portal_accounts'); expect(operation).toBe('read')
      expect(predicates.or).toBe('portal_user_id.eq.00000000-0000-4000-8000-000000000086,user_id.eq.00000000-0000-4000-8000-000000000086')
      return { data: f.stage === 'replay' ? [{ id: '00000000-0000-4000-8000-000000000090', company_id: '00000000-0000-4000-8000-000000000083',
        customer_id: '00000000-0000-4000-8000-000000000089', user_id: '00000000-0000-4000-8000-000000000086',
        portal_user_id: '00000000-0000-4000-8000-000000000086', status: 'active', is_active: true, role: 'owner' }] : [], error: null }
    }
    const q = {
      insert: (value: Row) => { operation = 'insert'; row = value; return q },
      update: (value: Row) => { operation = 'update'; row = value; return q },
      upsert: (value: Row) => { operation = 'upsert'; row = value; return q },
      select: () => q, eq: (field: string, value: unknown) => { predicates[field] = value; return q },
      is: (field: string, value: unknown) => { predicates[field] = value; return q },
      or: (value: string) => { predicates.or = value; return q }, limit: () => q,
      maybeSingle: async () => result(), single: async () => result(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    }
    return q
  },
} }))

import { POST } from '@/app/api/v1/customer-portal/sync/route'

const companyId = '00000000-0000-4000-8000-000000000083', clientId = '00000000-0000-4000-8000-000000000084'
const subject = '00000000-0000-4000-8000-000000000086', recordId = '00000000-0000-4000-8000-000000000087'
const canaries = ['portal-sync-canary@example.invalid', '+46 70 123 45 67', 'Portal Sync Canary Fullname',
  'Portal Sync Canary Street 41', 'capway_api_key_canary_sync_123456', 'sb_secret_canary_sync_123456']
const raw = canaries.join(' | ')
const payload = { external_customer_id: 'SYNTHETIC-EXT', customer_portal_user_id: subject, auth_user_id: subject }
const idempotencyWrites = () => f.writes.filter(write => write.table === 'customer_portal_write_idempotency')
const identityWrites = () => f.writes.filter(write => write.table === 'customer_portal_identities')
function request(options: { token?: boolean; headers?: Row; body?: unknown; rawBody?: string } = {}) {
  return new NextRequest('http://localhost/api/v1/customer-portal/sync', { method: 'POST', headers: {
    ...(options.token === false ? {} : { Authorization: 'Bearer synthetic-current-sync-token' }), 'Content-Type': 'application/json',
    'Idempotency-Key': 'synthetic-sync-key-20261001', 'X-Gridex-Customer-Portal-User-ID': subject, 'X-Gridex-Auth-User-ID': subject,
    ...options.headers,
  } as Record<string, string>, body: options.rawBody ?? JSON.stringify(options.body ?? payload) })
}
const absent = (value: unknown) => { for (const canary of canaries) expect(inspect(value, { depth: 12 })).not.toContain(canary) }
let errorLog: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks(); f.rows = []; f.writes = []; f.reads = []; f.stage = 'claim'; f.failUpdate = false; f.deny = null; f.paused = false
  f.fault = { code: '42P01', name: raw, message: raw, details: raw, hint: raw }
  f.after.mockImplementation(() => { throw new Error('outside_request_scope') })
  f.rpc.mockImplementation(async (name: string, args: Row) => {
    expect(name).toBe('authenticate_integration_request_v1')
    expect(args).toMatchObject({ p_required_all: ['customer_sync.write'], p_required_any: [], p_route: '/api/v1/customer-portal/sync' })
    return { data: [{ auth_outcome: f.deny ? 'denied' : 'allowed', error_code: f.deny, tenant_status: f.paused ? 'paused' : 'active',
      client_id: clientId, company_id: companyId, client_name: 'Synthetic', client_status: 'active', key_prefix: 'synthetic', secret_hash: 'synthetic',
      scopes: ['customer_sync.write'], allowed_ips: [], allowed_origins: [], metadata: {}, rate_limit_per_minute: 60, expires_at: null,
      request_count: 1, route_limit: 60, reset_at: new Date(Date.now() + 60000).toISOString() }], error: null }
  })
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => errorLog.mockRestore())

describe('actual portal sync producer and closed diagnostic sink', () => {
  it.each(['42P01', '42703', 'PGRST204'])('retains genuine technical %s after current authorization and failed actual idempotency insert', async code => {
    f.fault!.code = code
    const response = await POST(request()), body = await response.json()
    expect(response.status).toBe(500); expect(body.error).toMatchObject({ message: 'Kundlänkning kunde inte behandlas.', code: 'portal_sync_failed' })
    expect(f.rows[0]).toMatchObject({ company_id: companyId, api_client_id: clientId, status_code: 500, error_code: 'portal_sync_failed', metadata: { database_code: code } })
    expect(idempotencyWrites()).toHaveLength(1)
    const sorted = Object.fromEntries(Object.entries(payload).sort(([left], [right]) => left.localeCompare(right)))
    expect(idempotencyWrites()[0].row).toMatchObject({ company_id: companyId, api_client_id: clientId, customer_id: null,
      route: '/api/v1/customer-portal/sync', idempotency_key: 'synthetic-sync-key-20261001',
      request_hash: createHash('sha256').update(JSON.stringify(sorted)).digest('hex'), status: 'processing' })
    expect(f.reads).toEqual([]); expect(identityWrites()).toEqual([])
    absent(f.rows); absent(body); expect(f.rows[0].metadata).not.toHaveProperty('portal_sync_error')
  })

  it.each([false, true])('retains the primary technical fault after a claimed subject read fails; failure persistence also faults=%s', async failUpdate => {
    f.stage = 'subject'; f.failUpdate = failUpdate
    const response = await POST(request()), body = await response.json()
    expect(response.status).toBe(500); expect(body.error.code).toBe('portal_sync_failed')
    expect(f.rows[0].metadata).toMatchObject({ database_code: '42P01' })
    expect(idempotencyWrites()).toHaveLength(2)
    expect(idempotencyWrites()[1]).toMatchObject({ operation: 'update', row: { status: 'failed', error_code: 'portal_sync_failed' }, predicates: { id: recordId, company_id: companyId } })
    expect(f.reads).toHaveLength(2); expect(identityWrites()).toEqual([]); absent(f.rows); absent(body)
  })

  it('keeps the existing controlled database revocation classification and failed own idempotency receipt', async () => {
    f.stage = 'upsert'; f.fault = { code: '23514', message: 'customer_portal_identity_revoked' }
    const response = await POST(request()), body = await response.json()
    expect(response.status).toBe(409); expect(body.error.code).toBe('portal_identity_revoked')
    expect(idempotencyWrites()[1]).toMatchObject({ row: { status: 'failed', error_code: 'portal_identity_revoked' }, predicates: { company_id: companyId, id: recordId } })
    expect(f.rows[0]).toMatchObject({ status_code: 409, error_code: 'portal_identity_revoked' })
    expect((f.rows[0].metadata as Row).database_code).not.toBe('23514')
  })

  it('preserves completed linked replay, subject revalidation and zero identity/completion rewrites', async () => {
    f.stage = 'replay'
    const response = await POST(request()), body = await response.json()
    expect(response.status).toBe(200); expect(body.data).toEqual({ status: 'linked', access_granted: true, portal_role: 'owner' })
    expect(response.headers.get('Idempotency-Replayed')).toBe('true')
    expect(idempotencyWrites()).toHaveLength(1); expect(identityWrites()).toEqual([]); expect(f.reads).toHaveLength(4); expect(f.rows).toEqual([])
    expect(f.reads[3]).toMatchObject({ table: 'customer_portal_accounts', operation: 'read', predicates: {
      company_id: companyId, customer_id: '00000000-0000-4000-8000-000000000089',
      or: `portal_user_id.eq.${subject},user_id.eq.${subject}`,
    } })
  })

  it('preserves the genuine rejected result and matched completed idempotency row after insufficient identity factors', async () => {
    f.stage = 'success'
    const response = await POST(request()), body = await response.json()
    expect(response.status).toBe(200); expect(body.data).toEqual({ outcome: 'rejected', status: 'rejected', access_granted: false, reason: 'insufficient_identity_factors' })
    expect(response.headers.get('Idempotency-Replayed')).toBe('false')
    expect(identityWrites()[0].row).toMatchObject({ company_id: companyId, external_customer_id: 'SYNTHETIC-EXT', auth_user_id: subject, status: 'rejected', customer_id: null })
    expect(idempotencyWrites()[1]).toMatchObject({ row: { status: 'completed', response_status: 200, response_body: { data: body.data } }, predicates: { company_id: companyId, id: recordId, status: 'processing' } })
  })

  it.each([{ name: 'free customer/credential canaries', code: raw }, { name: 'provider label', code: 'PROVIDER_CUSTOMER_PHONE' },
    { name: 'embedded SQLSTATE', code: 'evil_42P01_suffix' }])('does not turn $name into a technical diagnostic', async ({ code }) => {
    f.fault!.code = code
    const response = await POST(request()), body = await response.json()
    expect(response.status).toBe(500); expect(body.error.code).toBe('portal_sync_failed')
    expect((f.rows[0].metadata as Row).database_code ?? null).toBeNull(); absent(f.rows); absent(body)
  })

  it.each(['api_scope_missing', 'tenant_paused', 'api_client_revoked'])('denies current %s before idempotency/identity reads and writes', async code => {
    f.deny = code; f.paused = code === 'tenant_paused'
    const response = await POST(request())
    expect(response.status).toBe(code === 'tenant_paused' ? 423 : 403); expect(idempotencyWrites()).toEqual([]); expect(identityWrites()).toEqual([]); expect(f.reads).toEqual([])
    expect(f.rpc).toHaveBeenCalledOnce(); expect(f.rows.every(row => !(row.metadata as Row).database_code)).toBe(true)
  })

  it('rejects missing credentials before Auth RPC or persistence', async () => {
    const response = await POST(request({ token: false }))
    expect(response.status).toBe(401); expect(f.rpc).not.toHaveBeenCalled(); expect(f.writes).toEqual([]); expect(f.reads).toEqual([])
  })

  it.each([{ headers: { 'X-Gridex-Auth-User-ID': '00000000-0000-4000-8000-000000000099' }, code: 'portal_identity_mismatch' },
    { body: { ...payload, auth_user_id: '00000000-0000-4000-8000-000000000099' }, code: 'portal_sync_validation_error' }])('preserves strict identity parity $code before any idempotency/business access', async options => {
    const response = await POST(request(options)), body = await response.json()
    expect(response.status).toBe(422); expect(body.error.code).toBe(options.code); expect(idempotencyWrites()).toEqual([]); expect(identityWrites()).toEqual([]); expect(f.reads).toEqual([])
  })

  it('preserves controlled malformed JSON status/code before idempotency writes', async () => {
    const response = await POST(request({ rawBody: '{' })), body = await response.json()
    expect(response.status).toBe(400); expect(body.error.code).toBe('invalid_json'); expect(idempotencyWrites()).toEqual([]); expect(f.reads).toEqual([])
  })
})
