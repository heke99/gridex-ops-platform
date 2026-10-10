// ops-api-review: F40
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ users: vi.fn(async (..._args: unknown[]) => ({ items: [] })), cases: vi.fn(async (..._args: unknown[]) => ({ items: [], page: {} })), customers: vi.fn(async (..._args: unknown[]) => ({ rows: [], total: 0, page: 1, pageSize: 25, totalPages: 0 })) }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {} }))
vi.mock('@/lib/staff-api/http', () => ({ withStaffApi: async (_r: unknown, _o: unknown, fn: (ctx: unknown) => Promise<Response>) => fn({ companyId: 'synthetic-company', actorUserId: 'synthetic-actor', apiClientId: 'synthetic-client', permissions: [] }), staffApiJson: (body: unknown) => Response.json(body) }))
vi.mock('@/lib/tenant/staffCommands', () => ({ listStaff: m.users, inviteStaff: vi.fn(), disableStaff: vi.fn(), reactivateStaff: vi.fn(), changeStaffRole: vi.fn(), listStaffRoles: vi.fn() }))
vi.mock('@/lib/staff-api/cases', async original => ({ ...await original<object>(), listStaffCases: m.cases }))
vi.mock('@/lib/customers/getCustomers', () => ({ listCustomersPageForCompany: m.customers }))

import { getStaffCases } from '@/lib/staff-api/caseHandlers'
import { getStaffCustomers } from '@/lib/staff-api/customerHandlers'
import { getStaffUsers } from '@/lib/staff-api/userHandlers'

const STRICT = { 'x-gridex-query-parsing': 'strict' }
const req = (path: string, query: string, headers: Record<string, string> = {}) => new NextRequest(`https://example.invalid/api/v1/staff/${path}?${query}`, { headers })
type Port = { mock: { calls: unknown[][] } }
const arg = (port: Port, call: number, index: number) => port.mock.calls[call][index] as Record<string, unknown>
beforeEach(() => vi.clearAllMocks())

const endpoints: Array<[string, string, () => Port, (q: string) => Promise<Response>]> = [
  ['users', 'page', () => m.users, q => getStaffUsers(req('users', q, STRICT))],
  ['cases', 'limit', () => m.cases, q => getStaffCases(req('cases', q, STRICT))],
  ['customers', 'page', () => m.customers, q => getStaffCustomers(req('customers', q, STRICT))],
]
const invalid = ['1&FIELD=2', '0x10', '1e1', '+5', '%205', '5.0', '05', '']

describe('strict profile (opt-in): one decimal and duplicate rule for all Staff list endpoints', () => {
  it.each(endpoints.flatMap(([name, field, port, call]) => invalid.map(v => [name, field, v, port, call] as const)))('%s rejects %s=%s with 422 invalid_field before the business port', async (_n, field, value, port, call) => {
    await expect(call(`${field}=${value.replace('FIELD', field)}`)).rejects.toMatchObject({ status: 422, code: 'invalid_field', field })
    expect(port()).not.toHaveBeenCalled()
  })
  it.each(endpoints)('%s accepts a plain decimal %s', async (_n, field, port, call) => {
    await call(`${field}=7`)
    expect(port()).toHaveBeenCalledTimes(1)
  })
  it('rejects an unknown profile value', async () => {
    await expect(getStaffUsers(req('users', 'page=1', { 'x-gridex-query-parsing': 'loose' }))).rejects.toMatchObject({ status: 422, code: 'invalid_field' })
    expect(m.users).not.toHaveBeenCalled()
  })
})

describe('compatible default profile keeps previously accepted inputs for existing clients', () => {
  it('users: last duplicate wins and legacy numeric forms still parse', async () => {
    await getStaffUsers(req('users', 'page=1&page=2')); expect(arg(m.users, 0, 1).page).toBe(2)
    await getStaffUsers(req('users', 'page=0x10')); expect(arg(m.users, 1, 1).page).toBe(16)
  })
  it('cases: first duplicate wins and exponent form still parses', async () => {
    await getStaffCases(req('cases', 'limit=1&limit=2')); expect(arg(m.cases, 0, 0).limit).toBe(1)
    await getStaffCases(req('cases', 'limit=1e1')); expect(arg(m.cases, 1, 0).limit).toBe(10)
  })
  it('customers: already strict, unchanged', async () => {
    await expect(getStaffCustomers(req('customers', 'page=1&page=2'))).rejects.toMatchObject({ status: 422, code: 'invalid_field' })
    await expect(getStaffCustomers(req('customers', 'page=0x10'))).rejects.toMatchObject({ status: 422, code: 'invalid_field' })
    expect(m.customers).not.toHaveBeenCalled()
  })
  it('tenant selector fields are never accepted as query parameters', async () => {
    for (const q of ['company_id=x', 'tenant_id=x']) {
      await expect(getStaffCustomers(req('customers', q))).rejects.toMatchObject({ status: 422 })
      await expect(getStaffCases(req('cases', q))).rejects.toMatchObject({ status: 422 })
      await expect(getStaffUsers(req('users', q))).rejects.toMatchObject({ status: 422 })
    }
    expect(m.users).not.toHaveBeenCalled()
  })
})
