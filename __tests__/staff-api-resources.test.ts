import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = vi.hoisted(() => ({ calls: [] as Array<{ name: string; args: Record<string, unknown> }>, data: { rows: [] } as unknown, error: null as unknown }))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: { rpc: async (name: string, args: Record<string, unknown>) => {
    state.calls.push({ name, args }); return { data: state.data, error: state.error }
  } },
  createSupabaseServiceRequestClient: () => ({ rpc: async (name: string, args: Record<string, unknown>) => {
    state.calls.push({ name, args }); return { data: state.data, error: state.error }
  } }),
}))

const context = {
  companyId: '00000001-0000-4000-8000-000000000001', userId: '00000001-0000-4000-8000-000000000002',
  client: { id: '00000001-0000-4000-8000-000000000003' }, sessionId: '00000001-0000-4000-8000-000000000004',
  nativeSessionId: '00000001-0000-4000-8000-000000000005', sessionRevision: 7,
  isPlatformAdmin: false, permissions: ['customers.read', 'cases.read', 'cases.write'], roles: ['support'],
  requestId: 'request-test', correlationId: 'correlation-test',
}
beforeEach(() => { state.calls = []; state.data = { rows: [] }; state.error = null })

async function resources() {
  const imported = await import('@/lib/staff-api/resources/common').catch(() => null)
  expect(imported, 'staff resource validation and cursor boundary must exist').not.toBeNull()
  return imported!
}

describe('staff resource boundary', () => {
  it('rejects duplicate, unknown, invalid and unbounded query values', async () => {
    const m = await resources()
    for (const query of ['limit=101', 'limit=0', 'limit=wat', 'q=x', 'company_id=other', 'limit=2&limit=3']) {
      expect(() => m.resourceQuery(new URLSearchParams(query), 'customers')).toThrow()
    }
    expect(m.resourceQuery(new URLSearchParams('q=Anna&status=active&limit=3'), 'customers')).toMatchObject({ limit: 3, filters: { q: 'Anna', status: 'active' } })
    expect(() => m.timestamp('2026-02-30T12:00:00Z', 'expected_updated_at')).toThrow()
  })

  it('cursor cannot be reused by another actor, client, tenant, resource or filter', async () => {
    const m = await resources()
    const cursor = m.encodeStaffCursor(context, 'cases', '', { status: 'open' }, { id: '00000001-0000-4000-8000-000000000006', created_at: '2026-10-03T12:00:00.000Z' })
    expect(m.decodeStaffCursor(cursor, context, 'cases', '', { status: 'open' })).toEqual({ id: '00000001-0000-4000-8000-000000000006', created_at: '2026-10-03T12:00:00.000Z' })
    for (const altered of [{ ...context, companyId: 'other' }, { ...context, userId: 'other' }, { ...context, client: { id: 'other' } }]) {
      expect(() => m.decodeStaffCursor(cursor, altered, 'cases', '', { status: 'open' })).toThrow()
    }
    expect(() => m.decodeStaffCursor(cursor, context, 'customers', '', { status: 'open' })).toThrow()
    expect(() => m.decodeStaffCursor(cursor, context, 'cases', '', { status: 'closed' })).toThrow()
    expect(() => m.decodeStaffCursor(`${cursor}x`, context, 'cases', '', { status: 'open' })).toThrow()
  })

  it('forces tenant/context and fetches limit+1 without emitting native identifiers', async () => {
    const m = await import('@/lib/staff-api/resources/customers').catch(() => null)
    expect(m).not.toBeNull()
    state.data = { rows: [
      { id: '00000001-0000-4000-8000-000000000011', customer_number: 'A1', full_name: 'Anna', created_at: '2026-10-03T12:00:00Z', personal_number: 'sensitive', metadata: { private: true } },
      { id: '00000001-0000-4000-8000-000000000012', customer_number: 'A2', full_name: 'Bo', created_at: '2026-10-03T11:00:00Z' },
    ] }
    const page = await m!.listStaffCustomers(context as never, new URLSearchParams('limit=1'))
    expect(page.page).toMatchObject({ limit: 1, returned: 1, has_more: true })
    expect(page.data).toHaveLength(1)
    expect(page.data[0]).toMatchObject({ customer_number: 'A1', display_name: 'Anna' })
    expect(page.data[0]).not.toHaveProperty('id')
    expect(page.data[0]).not.toHaveProperty('personal_number')
    expect(page.data[0]).not.toHaveProperty('metadata')
    expect(state.calls[0]).toMatchObject({ name: 'staff_api_read_resources', args: { p_company_id: context.companyId, p_limit: 2, p_operation: 'customers' } })
  })

  it('rejects client-selected actor/tenant/visibility metadata before a write', async () => {
    const m = await import('@/lib/staff-api/resources/cases').catch(() => null)
    expect(m).not.toBeNull()
    const request = new NextRequest('https://ops.invalid/api/v1/staff/support/cases', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'staff-test-1' }, body: JSON.stringify({ title: 'Question', customer_reference: 'customer_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', actor_user_id: context.userId, metadata: { support_case: false } }) })
    await expect(m!.writeStaffCase(context as never, request, 'create', '')).rejects.toThrow()
    expect(state.calls).toHaveLength(0)
  })

  it('binds exact normalized command body to actor/client/session revision and same key', async () => {
    const m = await import('@/lib/staff-api/resources/cases').catch(() => null)
    expect(m).not.toBeNull()
    state.data = { data: { case_reference: 'support_case_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', status: 'open' }, replayed: false }
    const request = new NextRequest('https://ops.invalid/api/v1/staff/support/cases/ref/replies', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'staff-test-2' }, body: JSON.stringify({ message: 'Hej kunden', kind: 'message' }) })
    await m!.writeStaffCase(context as never, request, 'reply', 'support_case_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
    expect(state.calls[0]).toMatchObject({ name: 'staff_api_support_command', args: {
      p_company_id: context.companyId, p_client_id: context.client.id, p_user_id: context.userId,
      p_session_id: context.sessionId, p_revision: 7, p_native_session_id: context.nativeSessionId,
      p_idempotency_key: 'staff-test-2', p_operation: 'reply', p_payload: { message: 'Hej kunden', kind: 'message' },
    } })
  })

  it('does not retry or pretend success after a denied database command', async () => {
    const m = await import('@/lib/staff-api/resources/cases').catch(() => null)
    expect(m).not.toBeNull()
    state.error = { code: '42501', message: 'staff_api_command_actor_denied' }
    const request = new NextRequest('https://ops.invalid/api/v1/staff/support/cases/ref/internal-notes', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'staff-test-3' }, body: JSON.stringify({ message: 'intern' }) })
    await expect(m!.writeStaffCase(context as never, request, 'note', 'support_case_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).rejects.toMatchObject({ status: 403 })
    expect(state.calls).toHaveLength(1)
  })
})
