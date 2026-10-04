import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { run, find, detail, list, contact, identity, write } = vi.hoisted(() => ({ run: vi.fn(), find: vi.fn(), detail: vi.fn(), list: vi.fn(), contact: vi.fn(), identity: vi.fn(), write: vi.fn() }))
vi.mock('@/lib/staff-api/http', () => ({
  withStaffApi: (...args: unknown[]) => run(...args),
  staffApiJson: (body: unknown, init?: number | ResponseInit) => Response.json(body, typeof init === 'number' ? { status: init } : init),
}))
vi.mock('@/lib/staff-api/customers', async (original) => ({ ...await original<typeof import('@/lib/staff-api/customers')>(), findStaffCustomer: (...args: unknown[]) => find(...args) }))
vi.mock('@/lib/customers/getCustomerForCompany', () => ({ STAFF_CUSTOMER_CHILD_LIMIT: 100, getCustomerForCompany: (...args: unknown[]) => detail(...args) }))
vi.mock('@/lib/customers/getCustomers', () => ({ listCustomersPageForCompany: (...args: unknown[]) => list(...args) }))
vi.mock('@/lib/customer-service/contactChangeTransaction', () => ({
  applyCustomerContactChange: (...args: unknown[]) => contact(...args),
  ContactChangeTransactionError: class extends Error { constructor(readonly code: string, message: string) { super(message) } },
}))
vi.mock('@/lib/customer-service/identityChange', () => ({
  requestCustomerIdentityChange: (...args: unknown[]) => identity(...args),
  maskIdentityNumber: (n: string | null) => n ? `••••${n.replace(/\D/g, '').slice(-4)}` : null,
  IdentityChangeError: class extends Error { constructor(readonly code: string, message: string, readonly status: number) { super(message) } },
}))
vi.mock('@/lib/api/strictRequest', async (original) => ({ ...await original<typeof import('@/lib/api/strictRequest')>(), executeIdempotentPortalWrite: (...args: unknown[]) => write(...args) }))

const A = '00000000-0000-4000-8000-0000000000a1'
const ID = '00000000-0000-4000-8000-0000000000c1'
const actor = '00000000-0000-4000-8000-0000000000f1'
const ctx = { companyId: A, actorUserId: actor, apiClientId: 'client', permissions: [], client: { id: 'client', company_id: A }, startedAt: 0 }
const reference = 'customer_12345678901234567890123456789012'
const params = { params: Promise.resolve({ ref: reference }) }
const request = (body?: Record<string, unknown>) => new NextRequest('https://example.test/api/v1/staff/customers', body ? { method: 'PATCH', headers: { 'content-type': 'application/json', 'idempotency-key': 'staff-contact-1' }, body: JSON.stringify(body) } : {})

beforeEach(() => {
  vi.clearAllMocks()
  run.mockImplementation(async (_r, _o, handler) => handler(ctx))
  find.mockResolvedValue({ id: ID, customer_type: 'private', full_name: 'Test Customer' })
  detail.mockResolvedValue({ customer: { id: ID, personal_number: '19121212-1212' }, contacts: [], addresses: [], sites: [] })
  list.mockResolvedValue({ rows: [{ id: ID, personal_number: '19121212-1212' }], page: 1, pageSize: 25, total: 1, totalPages: 1 })
  contact.mockResolvedValue({ changed: true, customerUpdatedAt: '2026-10-04T11:00:00Z' })
  identity.mockResolvedValue({ status: 'pending_customer_approval', requestId: 'request-id', recipientMasked: 't•••@example.test', expiresAt: '2026-10-07T11:00:00Z', contractCount: 1, takeoverRequired: false })
  write.mockImplementation(async (input) => ({ ...await input.execute(), replayed: false }))
})

describe('mounted staff customer API', () => {
  it('requires scopes and actual OPS permissions for reads/contact/identity', async () => {
    const { GET: getList } = await import('@/app/api/v1/staff/customers/route')
    const { GET: getDetail } = await import('@/app/api/v1/staff/customers/[ref]/route')
    const { PATCH: patchContact } = await import('@/app/api/v1/staff/customers/[ref]/contact/route')
    const { POST: postIdentity } = await import('@/app/api/v1/staff/customers/[ref]/identity-change/route')
    await getList(request())
    expect(run.mock.calls[0][1]).toEqual({ scopes: ['staff_customers.read'], permission: 'customers.read' })
    await getDetail(request(), params)
    expect(run.mock.calls[1][1]).toEqual({ scopes: ['staff_customers.read'], permission: 'customers.read' })
    await patchContact(request({ expectedUpdatedAt: '2026-10-04T10:00:00Z', phone: '0701234567' }), params)
    expect(run.mock.calls[2][1]).toEqual({ scopes: ['staff_customers.write'], permission: 'masterdata.write' })
    await postIdentity(request({ field: 'personal_number', new_value: '811218-9876', reason: 'Correct number' }), params)
    expect(run.mock.calls[3][1]).toEqual({ scopes: ['staff_customers.write'], permission: 'customers.write' })
  })

  it('returns a masked closed response and company-binds detail reads', async () => {
    const { getStaffCustomer } = await import('@/lib/staff-api/customerHandlers')
    const response = await getStaffCustomer(request(), params)
    expect(detail).toHaveBeenCalledWith(A, ID)
    const body = await response.json()
    expect(body.data.customer.personal_number_masked).toBe('••••1212')
    expect(JSON.stringify(body)).not.toContain('19121212')
    expect(body.data.customer.id).toBeUndefined()
  })

  it('passes staff and API client attribution, expected version, additive fields and namespaced idempotency', async () => {
    const { patchStaffCustomerContact } = await import('@/lib/staff-api/customerHandlers')
    const response = await patchStaffCustomerContact(request({ expectedUpdatedAt: '2026-10-04T10:00:00Z', phone: '+46 70 123 45 67' }), params)
    expect(contact).toHaveBeenCalledWith(expect.objectContaining({
      companyId: A, customerId: ID, actor: { kind: 'staff', userId: actor, apiClientId: 'client' }, channel: 'staff_api',
      expectedUpdatedAt: '2026-10-04T10:00:00Z', customerPatch: { phone: '+46 70 123 45 67' }, contactPatch: { phone: '+46 70 123 45 67' },
    }))
    expect(write.mock.calls[0][0]).toMatchObject({ companyId: A, clientId: 'client', customerId: ID, payload: expect.objectContaining({ actor_user_id: actor }) })
    const idempotencyKey = contact.mock.calls[0][0].idempotencyKey
    expect(idempotencyKey).toContain(actor)
    expect(idempotencyKey).toContain(ID)
    expect(response.headers.get('idempotency-replayed')).toBe('false')
  })

  it('returns stored idempotent response without executing the contact command again', async () => {
    write.mockResolvedValue({ statusCode: 200, body: { data: { changed: true } }, replayed: true })
    const { patchStaffCustomerContact } = await import('@/lib/staff-api/customerHandlers')
    const response = await patchStaffCustomerContact(request({ expectedUpdatedAt: '2026-10-04T10:00:00Z', phone: '0701234567' }), params)
    expect(contact).not.toHaveBeenCalled()
    expect(response.headers.get('idempotency-replayed')).toBe('true')
  })

  it('never accepts caller actor/company/client identities or extra identity fields', async () => {
    const { patchStaffCustomerContact, postStaffCustomerIdentityChange } = await import('@/lib/staff-api/customerHandlers')
    await expect(patchStaffCustomerContact(request({ expectedUpdatedAt: '2026-10-04T10:00:00Z', phone: '0701234567', actor_user_id: 'attacker' }), params)).rejects.toMatchObject({ code: 'field_not_allowed' })
    await expect(postStaffCustomerIdentityChange(request({ field: 'personal_number', new_value: '811218-9876', reason: 'Correct number', company_id: 'other' }), params)).rejects.toMatchObject({ code: 'field_not_allowed' })
    expect(write).not.toHaveBeenCalled()
  })

  it('uses existing approval flow with server actor and client attribution and masks returned request ID', async () => {
    const { postStaffCustomerIdentityChange } = await import('@/lib/staff-api/customerHandlers')
    const response = await postStaffCustomerIdentityChange(request({ field: 'personal_number', new_value: '811218-9876', reason: 'Correct number' }), params)
    expect(identity).toHaveBeenCalledWith({ companyId: A, customerId: ID, field: 'personal_number', newValue: '811218-9876', reason: 'Correct number', actorUserId: actor, channel: 'staff_api', apiClientId: 'client' })
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.data.status).toBe('pending_customer_approval')
    expect(body.data.request_reference).toMatch(/^identity_change_/)
    expect(JSON.stringify(body)).not.toContain('request-id')
  })

  it('rejects foreign customers before any idempotency claim or mutation', async () => {
    const { ApiInputError } = await import('@/lib/api/strictRequest')
    find.mockRejectedValue(new ApiInputError('Kunden hittades inte.', 'customer_not_found', 404))
    const { patchStaffCustomerContact } = await import('@/lib/staff-api/customerHandlers')
    await expect(patchStaffCustomerContact(request({ expectedUpdatedAt: '2026-10-04T10:00:00Z', phone: '0701234567' }), params)).rejects.toMatchObject({ code: 'customer_not_found', status: 404 })
    expect(write).not.toHaveBeenCalled()
    expect(contact).not.toHaveBeenCalled()
  })

  it('maps the transactional stale-version refusal to a conflict without retrying a write', async () => {
    const { ContactChangeTransactionError } = await import('@/lib/customer-service/contactChangeTransaction')
    contact.mockRejectedValue(new ContactChangeTransactionError('version_conflict', 'Changed concurrently'))
    const { patchStaffCustomerContact } = await import('@/lib/staff-api/customerHandlers')
    await expect(patchStaffCustomerContact(request({ expectedUpdatedAt: '2026-10-04T10:00:00Z', phone: '0701234567' }), params)).rejects.toMatchObject({ code: 'version_conflict', status: 409 })
    expect(contact).toHaveBeenCalledTimes(1)
  })

  it('bounds pagination and refuses unknown filters', async () => {
    const { getStaffCustomers } = await import('@/lib/staff-api/customerHandlers')
    await expect(getStaffCustomers(new NextRequest('https://example.test/api/v1/staff/customers?page_size=101'))).rejects.toMatchObject({ code: 'invalid_field' })
    await expect(getStaffCustomers(new NextRequest('https://example.test/api/v1/staff/customers?company_id=other'))).rejects.toMatchObject({ code: 'field_not_allowed' })
    expect(list).not.toHaveBeenCalled()
  })
})
