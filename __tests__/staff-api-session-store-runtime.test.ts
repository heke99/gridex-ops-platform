import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ revision: 2, insertError: null as null | { code: string }, rpc: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  rpc: (...args: unknown[]) => { state.rpc(...args); return Promise.resolve({ data: state.revision, error: null }) },
  from: () => ({ insert: () => Promise.resolve({ error: state.insertError }) }),
} }))

import { completeSessionOperation, insertStaffSession, type StaffSessionRow } from '@/lib/staff-api/sessionStore'

const row: StaffSessionRow = {
  id: '11111111-1111-4111-8111-111111111111', user_id: '22222222-2222-4222-8222-222222222222',
  company_id: '33333333-3333-4333-8333-333333333333', api_client_id: '44444444-4444-4444-8444-444444444444',
  native_session_id: '55555555-5555-4555-8555-555555555555', encrypted_payload: 'old-encrypted-payload',
  refresh_hash: 'a'.repeat(64), previous_refresh_hash: null, revision: 1, stage: 'authenticated', native_aal: 'aal1',
  status: 'active', expires_at: '2026-10-04T00:00:00Z', lease_id: '66666666-6666-4666-8666-666666666666', lease_expires_at: '2026-10-03T23:59:00Z',
}
const payload = { accessToken: 'native-access-secret', refreshToken: 'native-refresh-secret', stage: 'authenticated' as const, recovery: false, factors: [] }
const complete = () => completeSessionOperation(row, row.lease_id!, payload, row.native_session_id, 'aal1', { staff_refresh_token: 'opaque-refresh' }, { advance: true, refreshToken: 'opaque-refresh' })

beforeEach(() => {
  process.env.GRIDEX_STAFF_SIGNING_KEY = Buffer.alloc(32, 1).toString('base64')
  process.env.GRIDEX_STAFF_VAULT_KEY = Buffer.alloc(32, 2).toString('base64')
  state.revision = 2; state.insertError = null; state.rpc.mockClear()
})

describe('staff session service policy-revocation bridge', () => {
  it('rejects the committed blocked-session sentinel before the caller can emit an Auth receipt', async () => {
    state.revision = 0
    await expect(complete()).rejects.toMatchObject({ status: 403, code: 'staff_permission_denied', retryable: false })
    expect(state.rpc).toHaveBeenCalledOnce()
    expect(state.rpc.mock.calls[0][0]).toBe('staff_api_complete_session_operation')
  })
  it('retains a positive completed revision and encrypts native credentials at the RPC boundary', async () => {
    await expect(complete()).resolves.toBe(2)
    expect(JSON.stringify(state.rpc.mock.calls)).not.toContain('native-access-secret')
    expect(JSON.stringify(state.rpc.mock.calls)).not.toContain('native-refresh-secret')
  })
  it('maps an atomic bootstrap policy denial to a permanent canonical authorization error', async () => {
    state.insertError = { code: '42501' }
    await expect(insertStaffSession(row)).rejects.toMatchObject({ status: 403, code: 'staff_permission_denied', retryable: false })
  })
})
