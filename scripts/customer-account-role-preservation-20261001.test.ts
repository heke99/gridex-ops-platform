import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

type Row = Record<string, unknown>
const memory = vi.hoisted(() => ({
  rows: {} as Record<string, Row[]>,
  calls: [] as Array<{ table: string; mode: string; payload?: Row }>,
  rpcCalls: [] as Array<{ name: string; args: Row }>,
  revalidated: [] as string[],
  insertCollision: null as null | 'active' | 'disabled' | 'missing',
  company: '81000000-0000-4000-8000-000000000001',
  customer: '82000000-0000-4000-8000-000000000001',
  user: '83000000-0000-4000-8000-000000000001',
  site: '84000000-0000-4000-8000-000000000001',
  client: '85000000-0000-4000-8000-000000000001',
}))

// The positive outer Auth/SQL adapters are memory-only. Actual application
// authentication, readiness, matching, idempotency, tenantDb, projection and
// both exported entrypoints run unchanged. No network/credentials/JWT exercise.
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: memory.user, email: 'account@example.invalid' } }, error: null }) },
}) }))
vi.mock('next/cache', () => ({ revalidatePath: (path: string) => memory.revalidated.push(path) }))
vi.mock('@/lib/supabase/service', () => {
  function from(table: string) {
    const filters: Array<(row: Row) => boolean> = []
    let mode = 'select'
    let payload: Row | null = null
    let conflict = ''
    let max = Infinity
    let executed: { data: Row[] | null; error: Row | null } | null = null
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query },
      is: (key: string, value: unknown) => { filters.push(row => (row[key] ?? null) === value); return query },
      in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return query },
      ilike: (key: string, value: string) => { filters.push(row => String(row[key]).toLowerCase() === value.toLowerCase()); return query },
      or: (value: string) => {
        const alternatives = value.split(',').map(part => { const [key, op, ...rest] = part.split('.'); return { key, op, value: rest.join('.') } })
        filters.push(row => alternatives.some(part => part.op === 'eq' && String(row[part.key]) === part.value)); return query
      },
      limit: (value: number) => { max = value; return query },
      order: () => query,
      insert: (value: Row) => { mode = 'insert'; payload = value; return query },
      update: (value: Row) => { mode = 'update'; payload = value; return query },
      upsert: (value: Row, options?: { onConflict?: string }) => { mode = 'upsert'; payload = value; conflict = options?.onConflict ?? ''; return query },
      maybeSingle: async () => { const result = execute(); return { data: result.data?.[0] ?? null, error: result.error } },
      single: async () => { const result = execute(); return { data: result.data?.[0] ?? null, error: result.error } },
      then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve(execute()).then(resolve, reject),
    }
    function execute() {
      if (executed) return executed
      const rows = memory.rows[table] ?? (memory.rows[table] = [])
      memory.calls.push({ table, mode, ...(payload ? { payload: structuredClone(payload) } : {}) })
      let selected = rows.filter(row => filters.every(filter => filter(row)))
      if (payload) {
        if (table === 'customer_portal_write_idempotency' && mode === 'insert' && rows.some(row => row.idempotency_key === payload!.idempotency_key)) {
          return executed = { data: null, error: { code: '23505', message: 'synthetic_existing_idempotency_row' } }
        }
        if (table === 'customer_portal_accounts' && mode === 'insert' && memory.insertCollision) {
          if (memory.insertCollision !== 'missing') {
            const saved: Row = { id: '87000000-0000-4000-8000-000000000002', company_id: memory.company,
              customer_id: memory.customer, user_id: memory.user, role: 'viewer', status: 'active', is_active: true,
              verified_at: '2025-02-01T00:00:00Z', verified_identity_snapshot: { competitor: true } }
            if (memory.insertCollision === 'disabled') { saved.status = 'disabled'; saved.is_active = false }
            rows.push(saved)
          }
          return executed = { data: null, error: { code: '23505', message: 'synthetic_current_insert_conflict' } }
        }
        const existing = mode === 'upsert' ? rows.find(row => conflict.split(',').every(key => row[key] === payload![key])) : null
        if (table === 'customer_portal_accounts' && existing && (existing.status === 'disabled' || existing.is_active !== true)) {
          return executed = { data: null, error: { code: '23514', message: 'customer_portal_account_revoked' } }
        }
        if (mode === 'update') selected.forEach(row => Object.assign(row, structuredClone(payload)))
        else if (existing) { Object.assign(existing, structuredClone(payload)); selected = [existing] }
        else {
          const row = { id: `86000000-0000-4000-8000-${String(rows.length + 1).padStart(12, '0')}`, ...structuredClone(payload) }
          rows.push(row); selected = [row]
        }
      }
      return executed = { data: selected.slice(0, max), error: null }
    }
    return query
  }
  return { supabaseService: { from, rpc: async (name: string, args: Row) => {
    memory.rpcCalls.push({ name, args })
    if (name !== 'authenticate_integration_request_v1') throw new Error('unexpected_positive_memory_rpc')
    return { error: null, data: [{ auth_outcome: 'allowed', client_id: memory.client, company_id: memory.company,
      client_name: 'Synthetic account role preservation', client_status: 'active', scopes: ['customer_sync.write'],
      key_prefix: 'SYNTHETIC_AC', secret_hash: 'a'.repeat(64), tenant_status: 'active', rate_limit_per_minute: 100,
      route_limit: 100, request_count: 1, reset_at: '2099-01-01T00:00:00Z' }] }
  } } }
})

import { POST } from '@/app/api/v1/customer-portal/sync/route'
import { claimPortalCustomerAction } from '@/lib/customer-portal/claim'
import { invalidatePlatformSchemaReadinessCache, REQUIRED_PLATFORM_SCHEMA_VERSION } from '@/lib/platform/schemaReadiness'

function account(role: string): Row {
  return { id: '87000000-0000-4000-8000-000000000001', company_id: memory.company, customer_id: memory.customer,
    user_id: memory.user, portal_user_id: memory.user, status: 'active', is_active: true, role,
    activated_at: '2025-01-01T00:00:00Z', verified_at: '2025-01-02T00:00:00Z',
    match_method: 'approved_existing_relationship', verified_identity_snapshot: { original: true }, metadata: { retained: true } }
}
beforeEach(() => {
  memory.calls = []; memory.rpcCalls = []; memory.revalidated = []
  memory.insertCollision = null
  memory.rows = {
    platform_runtime_readiness: [{ id: true, is_ready: true, schema_version: REQUIRED_PLATFORM_SCHEMA_VERSION,
      schema_fingerprint: 'a'.repeat(64), blocking_issues: [] }],
    companies: [{ id: memory.company, slug: 'synthetic-account-role' }],
    customers: [{ id: memory.customer, company_id: memory.company, customer_number: 'SYN-ROLE-1',
      customer_type: 'private', email: 'account@example.invalid', personal_number: '199001011234',
      first_name: 'Synthetic', last_name: 'Customer', full_name: 'Synthetic Customer' }],
    customer_sites: [{ id: memory.site, company_id: memory.company, customer_id: memory.customer, facility_id: '735999000000001' }],
    customer_portal_identities: [{ id: '88000000-0000-4000-8000-000000000001', company_id: memory.company,
      customer_id: memory.customer, external_customer_id: 'SYN-EXT-ROLE', provider: 'gridex_website',
      auth_user_id: memory.user, customer_portal_user_id: memory.user, status: 'active' }],
    customer_portal_accounts: [account('viewer')],
  }
  invalidatePlatformSchemaReadinessCache()
})

function syncRequest() {
  return new NextRequest('https://synthetic.invalid/api/v1/customer-portal/sync', { method: 'POST', headers: {
    authorization: 'Bearer SYNTHETIC_ACCOUNT_ROLE_MEMORY_KEY', 'content-type': 'application/json',
    'idempotency-key': 'synthetic-role-proof-0001', 'x-gridex-customer-portal-user-id': memory.user, 'x-gridex-auth-user-id': memory.user,
  }, body: JSON.stringify({ external_customer_id: 'SYN-EXT-ROLE', customer_portal_user_id: memory.user,
    auth_user_id: memory.user, email: 'account@example.invalid', customer_number: 'SYN-ROLE-1' }) })
}
function claimForm() {
  const form = new FormData()
  for (const [key, value] of Object.entries({ email: 'account@example.invalid', personal_number: '199001011234',
    full_name: 'Synthetic Customer', installation_id: '735999000000001', company_slug: 'synthetic-account-role' })) form.set(key, value)
  return form
}
async function runClaim() {
  await expect(claimPortalCustomerAction({ ok: false, message: '' }, claimForm())).rejects.toMatchObject({
    digest: expect.stringContaining('NEXT_REDIRECT'),
  })
}

it.each(['billing', 'viewer'])('actual legacy sync projects saved %s instead of inventing owner while preserving account bytes', async role => {
  memory.rows.customer_portal_accounts = [account(role)]
  const before = structuredClone(memory.rows.customer_portal_accounts)
  const response = await POST(syncRequest())
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(memory.rpcCalls[0]).toMatchObject({ name: 'authenticate_integration_request_v1', args: { p_required_all: ['customer_sync.write'] } })
  expect(memory.rows.customer_portal_accounts).toEqual(before)
  expect(body.data.status).toBe('linked')
  expect(body.data.portal_role).toBe(role)
})

it.each(['billing', 'viewer'])('actual self-claim retains saved %s role and verification evidence after exact positive matching', async role => {
  memory.rows.customer_portal_accounts = [account(role)]
  const before = structuredClone(memory.rows.customer_portal_accounts)
  await runClaim()
  expect(memory.rows.customer_portal_accounts).toEqual(before)
})

it('ordinary owner sync control preserves saved owner without any account write', async () => {
  memory.rows.customer_portal_accounts = [account('owner')]
  const before = structuredClone(memory.rows.customer_portal_accounts)
  const response = await POST(syncRequest())
  expect(response.status).toBe(200)
  expect((await response.json()).data.portal_role).toBe('owner')
  expect(memory.rows.customer_portal_accounts).toEqual(before)
  expect(memory.calls.filter(call => call.table === 'customer_portal_accounts' && call.mode !== 'select')).toEqual([])
})

it('actual self-claim new-link control retains existing owner creation semantics', async () => {
  memory.rows.customer_portal_accounts = []
  await runClaim()
  expect(memory.rows.customer_portal_accounts).toMatchObject([{ company_id: memory.company, customer_id: memory.customer,
    user_id: memory.user, role: 'owner', is_active: true, match_method: 'self_claim_strict_identity' }])
  expect(memory.rows.customer_portal_claims).toMatchObject([{ status: 'approved', customer_id: memory.customer }])
})

it('legacy sync without a saved account reports identity linkage without invented role or account access', async () => {
  memory.rows.customer_portal_accounts = []
  const response = await POST(syncRequest())
  expect(response.status).toBe(200)
  expect((await response.json()).data).toMatchObject({ status: 'linked', access_granted: false })
  const stored = memory.rows.customer_portal_write_idempotency[0].response_body as { data: Row }
  expect(stored.data).not.toHaveProperty('portal_role')
  expect(memory.rows.customer_portal_accounts).toEqual([])
})

it('repeated self-claim retains existing owner verification bytes and creates no new approval event', async () => {
  memory.rows.customer_portal_accounts = [account('owner')]
  const before = structuredClone(memory.rows.customer_portal_accounts)
  await runClaim()
  expect(memory.rows.customer_portal_accounts).toEqual(before)
  expect(memory.rows.customer_portal_claims ?? []).toEqual([])
  expect(memory.rows.customer_portal_events ?? []).toEqual([])
})

it('self-claim cannot create a second owner beside a saved same-subject portal-only viewer relationship', async () => {
  memory.rows.customer_portal_accounts = [{ ...account('viewer'), user_id: null }]
  const before = structuredClone(memory.rows.customer_portal_accounts)
  await expect(claimPortalCustomerAction({ ok: false, message: '' }, claimForm())).rejects.toMatchObject({
    code: 'portal_account_ambiguous', status: 409,
  })
  expect(memory.rows.customer_portal_accounts).toEqual(before)
  expect(memory.rows.customer_portal_claims ?? []).toEqual([])
  expect(memory.rows.customer_portal_events ?? []).toEqual([])
  expect(memory.revalidated).toEqual([])
})

it('self-claim current-row readback after an INSERT 23505 retains a competing saved viewer without verification writes', async () => {
  memory.rows.customer_portal_accounts = []; memory.insertCollision = 'active'
  await runClaim()
  expect(memory.rows.customer_portal_accounts).toMatchObject([{ role: 'viewer', verified_at: '2025-02-01T00:00:00Z',
    verified_identity_snapshot: { competitor: true } }])
  expect(memory.rows.customer_portal_claims ?? []).toEqual([])
  expect(memory.rows.customer_portal_events ?? []).toEqual([])
})

it.each(['disabled', 'missing'] as const)('self-claim cannot accept %s current relation after INSERT 23505', async collision => {
  memory.rows.customer_portal_accounts = []; memory.insertCollision = collision
  await expect(claimPortalCustomerAction({ ok: false, message: '' }, claimForm())).rejects.toMatchObject({
    code: collision === 'disabled' ? 'portal_identity_revoked' : 'portal_account_ambiguous',
  })
  expect(memory.rows.customer_portal_claims ?? []).toEqual([])
  expect(memory.rows.customer_portal_events ?? []).toEqual([])
  expect(memory.revalidated).toEqual([])
})

it('legacy completed owner snapshot cannot misstate a current saved viewer on replay, and stored receipt is retained', async () => {
  memory.rows.customer_portal_accounts = [account('owner')]
  const first = await POST(syncRequest())
  expect(first.status).toBe(200)
  const receipt = structuredClone(memory.rows.customer_portal_write_idempotency)
  memory.rows.customer_portal_accounts[0].role = 'viewer'
  const replay = await POST(syncRequest())
  expect(replay.status).toBe(409)
  expect(memory.rows.customer_portal_write_idempotency).toEqual(receipt)
})

it('legacy completed saved viewer business result replays exactly with current request correlation and no persisted rewrites', async () => {
  const first = await POST(syncRequest())
  expect(first.status).toBe(200)
  const firstBody = await first.json()
  expect(firstBody.data.portal_role).toBe('viewer')
  const before = structuredClone({ accounts: memory.rows.customer_portal_accounts,
    identities: memory.rows.customer_portal_identities, receipts: memory.rows.customer_portal_write_idempotency })
  const checkpoint = memory.calls.length
  const replay = await POST(syncRequest())
  expect(replay.status).toBe(200)
  expect(replay.headers.get('Idempotency-Replayed')).toBe('true')
  const replayBody = await replay.json()
  expect(replayBody.data).toEqual(firstBody.data)
  expect(replayBody.api_version).toBe(firstBody.api_version)
  expect(replayBody.request_id).toEqual(expect.any(String))
  expect(replayBody.request_id).not.toBe(firstBody.request_id)
  expect({ accounts: memory.rows.customer_portal_accounts, identities: memory.rows.customer_portal_identities,
    receipts: memory.rows.customer_portal_write_idempotency }).toEqual(before)
  expect(memory.calls.slice(checkpoint).filter(call => ['customer_portal_accounts', 'customer_portal_identities'].includes(call.table) &&
    call.mode !== 'select')).toEqual([])
  expect(memory.calls.slice(checkpoint).filter(call => call.table === 'customer_portal_write_idempotency' &&
    !['select', 'insert'].includes(call.mode))).toEqual([])
})
