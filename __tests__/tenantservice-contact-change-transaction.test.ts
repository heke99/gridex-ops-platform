import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: (...args: unknown[]) => rpc(...args) } }))

const COMPANY = '00000000-0000-4000-8000-0000000000a1'
const CUSTOMER = '00000000-0000-4000-8000-0000000000c1'

beforeEach(() => rpc.mockReset())

describe('applyCustomerContactChange (P2b adapter)', () => {
  it('passes a server-derived staff actor and never a portal identity', async () => {
    rpc.mockResolvedValue({ data: { replayed: false, changed: true, domain_event_id: 'e1', customer_updated_at: '2026-10-01T10:00:00Z', changes: { phone: { from: null, to: '070' } } }, error: null })
    const { applyCustomerContactChange } = await import('@/lib/customer-service/contactChangeTransaction')
    const result = await applyCustomerContactChange({
      companyId: COMPANY, customerId: CUSTOMER, actor: { kind: 'staff', userId: 'u1' }, channel: 'ops',
      expectedUpdatedAt: '2026-10-01T09:00:00Z', customerPatch: { phone: '070' }, contactPatch: { phone: '070' },
    })
    expect(rpc).toHaveBeenCalledWith('gridex_customer_contact_change_v1', expect.objectContaining({
      p_company_id: COMPANY, p_customer_id: CUSTOMER, p_actor_kind: 'staff', p_actor_user_id: 'u1',
      p_api_client_id: null, p_portal_identity_id: null, p_expected_updated_at: '2026-10-01T09:00:00Z',
    }))
    expect(result).toMatchObject({ changed: true, domainEventId: 'e1', changes: { phone: { to: '070' } } })
  })

  it('passes both staff actor and API client for staff API writes', async () => {
    rpc.mockResolvedValue({ data: { replayed: false, changed: true }, error: null })
    const { applyCustomerContactChange } = await import('@/lib/customer-service/contactChangeTransaction')
    await applyCustomerContactChange({
      companyId: COMPANY, customerId: CUSTOMER,
      actor: { kind: 'staff', userId: 'u1', apiClientId: 'client-1' },
      channel: 'staff_api', expectedUpdatedAt: '2026-10-04T10:00:00Z', customerPatch: { phone: '0701234567' }, contactPatch: {},
    })
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_actor_kind: 'staff', p_actor_user_id: 'u1', p_api_client_id: 'client-1', p_channel: 'staff_api', p_portal_identity_id: null })
  })

  it('refuses the sequential deploy fallback for staff API when the transactional RPC is unavailable', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.gridex_customer_contact_change_v1' } })
    const { applyCustomerContactChange } = await import('@/lib/customer-service/contactChangeTransaction')
    await expect(applyCustomerContactChange({
      companyId: COMPANY, customerId: CUSTOMER, actor: { kind: 'staff', userId: 'u1', apiClientId: 'client-1' },
      channel: 'staff_api', expectedUpdatedAt: '2026-10-04T10:00:00Z', customerPatch: { phone: '0701234567' }, contactPatch: {},
    })).rejects.toMatchObject({ code: 'contact_change_unavailable', status: 503 })
  })

  it('passes the API client and portal identity for customer API writes, with no staff user', async () => {
    rpc.mockResolvedValue({ data: { replayed: false, changed: false }, error: null })
    const { applyCustomerContactChange } = await import('@/lib/customer-service/contactChangeTransaction')
    await applyCustomerContactChange({
      companyId: COMPANY, customerId: CUSTOMER, actor: { kind: 'customer_portal', apiClientId: 'client-1', portalIdentityId: 'pid-1' },
      channel: 'customer_api', expectedUpdatedAt: null, customerPatch: {}, contactPatch: {},
    })
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_actor_kind: 'customer_portal', p_actor_user_id: null, p_api_client_id: 'client-1', p_portal_identity_id: 'pid-1' })
  })

  it.each([
    [{ code: '40001', message: 'contact_change_version_conflict' }, 'version_conflict'],
    [{ code: 'P0002', message: 'customer_not_found_in_scope' }, 'not_found'],
    [{ code: '42501', message: 'contact_change_customer_archived' }, 'customer_archived'],
    [{ code: '42501', message: 'contact_change_actor_not_authorized' }, 'not_authorized'],
    [{ code: '22023', message: 'contact_change_field_not_allowed:identity_number' }, 'invalid_request'],
  ])('maps database error %o to %s', async (error, code) => {
    rpc.mockResolvedValue({ data: null, error })
    const { applyCustomerContactChange, ContactChangeTransactionError } = await import('@/lib/customer-service/contactChangeTransaction')
    const promise = applyCustomerContactChange({
      companyId: COMPANY, customerId: CUSTOMER, actor: { kind: 'staff', userId: 'u1' }, channel: 'ops',
      expectedUpdatedAt: null, customerPatch: { phone: '070' }, contactPatch: {},
    })
    await expect(promise).rejects.toBeInstanceOf(ContactChangeTransactionError)
    await expect(promise).rejects.toMatchObject({ code })
  })

  it('rethrows unknown database errors unchanged in kind', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '08006', message: 'connection failure' } })
    const { applyCustomerContactChange, ContactChangeTransactionError } = await import('@/lib/customer-service/contactChangeTransaction')
    const promise = applyCustomerContactChange({
      companyId: COMPANY, customerId: CUSTOMER, actor: { kind: 'staff', userId: 'u1' }, channel: 'ops',
      expectedUpdatedAt: null, customerPatch: {}, contactPatch: {},
    })
    await expect(promise).rejects.not.toBeInstanceOf(ContactChangeTransactionError)
    await expect(promise).rejects.toMatchObject({ code: '08006' })
  })
})

describe('deploy-safety fallback while migration 20261001210000 is not applied', () => {
  it('runs the version-locked sequential path with fail-closed audit when the RPC is missing', async () => {
    vi.resetModules()
    const calls: Array<{ op: string; table: string; values?: unknown }> = []
    const chain = (op: string, table: string, values?: unknown, data: unknown = null) => {
      calls.push({ op, table, values })
      const q: Record<string, unknown> = {}
      for (const m of ['eq', 'order', 'limit', 'select']) q[m] = () => q
      q.maybeSingle = async () => ({ data, error: null })
      q.then = (resolve: (v: unknown) => void) => resolve({ data, error: null })
      return q
    }
    vi.doMock('@/lib/supabase/tenantQuery', () => ({
      tenantSelect: (_c: string, table: string) => chain('select', table, undefined,
        table === 'customers' ? { id: CUSTOMER, status: 'active', phone: '071', updated_at: 'v1' } : null),
      tenantUpdate: (_c: string, table: string, values: unknown) => chain('update', table, values, { id: CUSTOMER, updated_at: 'v2' }),
      tenantInsert: (_c: string, table: string, values: unknown) => chain('insert', table, values),
    }))
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.gridex_customer_contact_change_v1' } })
    const { applyCustomerContactChange } = await import('@/lib/customer-service/contactChangeTransaction')
    const result = await applyCustomerContactChange({
      companyId: COMPANY, customerId: CUSTOMER, actor: { kind: 'staff', userId: 'u1' }, channel: 'ops',
      expectedUpdatedAt: 'v1', customerPatch: { phone: '070' }, contactPatch: { phone: '070' },
    })
    expect(result).toMatchObject({ changed: true, customerUpdatedAt: 'v2', changes: { phone: { from: '071', to: '070' } } })
    expect(calls.map((c) => `${c.op}:${c.table}`)).toEqual([
      'select:customers', 'update:customers', 'select:customer_contacts', 'insert:customer_contacts', 'insert:audit_logs',
    ])
    vi.doUnmock('@/lib/supabase/tenantQuery')
  })
})
