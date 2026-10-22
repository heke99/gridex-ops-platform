// FINDINGS F51: staff enter or correct the customer's registered address (folkbokföringsadress) on the customer
// card. The save is permission-checked, limited to the staff member's own company, goes through the shared
// writer (provenance staff_entry, the staff member) and keeps the previous address as history, so the Ediel
// rule always finds exactly one current registered address.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const state = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  forbidden: false,
  user: { id: 'actor-a' } as { id: string } | null,
  company: 'company-a',
  seq: 0,
}))

function fakeFrom(table: string) {
  let op: 'select' | 'insert' | 'update' = 'select'
  let patch: Row = {}
  let rows: Row[] = []
  const filters: Array<(row: Row) => boolean> = []
  const rowsOf = () => (state.tables[table] ??= [])
  const run = () => {
    if (op === 'insert') {
      const inserted = rows.map(row => ({ id: `${table}-${++state.seq}`, ...row }))
      rowsOf().push(...inserted)
      return inserted
    }
    const hit = rowsOf().filter(row => filters.every(filter => filter(row)))
    if (op === 'update') hit.forEach(row => Object.assign(row, patch))
    return hit
  }
  const query: Record<string, unknown> = {
    select: () => query,
    insert: (value: Row | Row[]) => { op = 'insert'; rows = Array.isArray(value) ? value : [value]; return query },
    update: (value: Row) => { op = 'update'; patch = value; return query },
    eq: (column: string, value: unknown) => { filters.push(row => row[column] === value); return query },
    in: (column: string, values: unknown[]) => { filters.push(row => values.includes(row[column])); return query },
    single: async () => ({ data: run()[0] ?? null, error: null }),
    maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve({ data: run(), error: null }).then(resolve, reject),
  }
  return query
}

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => fakeFrom(table) } }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } })) }))
vi.mock('@/lib/admin/guards', () => ({
  requireAdminActionAccess: vi.fn(async () => { if (state.forbidden) throw new Error('Forbidden'); return { permissions: ['customers.write'] } }),
  requireCompanyScopedActionAccess: vi.fn(), isPlatformAdminContext: () => false,
}))
vi.mock('@/lib/tenant/scope', () => ({ requireOperationalCompanyId: vi.fn(async () => state.company) }))
vi.mock('@/lib/tenant/governance', () => ({ requireCompanyOperationalForWrites: vi.fn(async () => undefined) }))

import { requireAdminActionAccess } from '@/lib/admin/guards'
import { saveCustomerRegisteredAddressAction } from '@/app/admin/customers/[id]/registered-address-actions'

const idle = { status: 'idle' as const, message: null, fieldErrors: {} }
const save = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return saveCustomerRegisteredAddressAction(idle, data)
}
const address = { customer_id: 'customer-a', street: 'Storgatan 5', postal_code: '441 31', city: 'Alingsås' }
const registered = (customerId = 'customer-a') => (state.tables.customer_addresses ?? []).filter(row => row.type === 'registered' && row.customer_id === customerId)
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
/** The rule's selection: active, moved in, not moved out today. */
const current = (customerId = 'customer-a') => registered(customerId).filter(row => row.is_active === true
  && (!row.moved_in_at || String(row.moved_in_at) <= today) && (!row.moved_out_at || today < String(row.moved_out_at)))

beforeEach(() => {
  state.forbidden = false; state.user = { id: 'actor-a' }; state.company = 'company-a'; state.seq = 0
  state.tables = {
    customers: [{ id: 'customer-a', company_id: 'company-a' }, { id: 'customer-b', company_id: 'company-b' }],
    customer_addresses: [
      // A facility and an invoice address on the same customer must never be taken as the registered address.
      { id: 'facility-1', company_id: 'company-a', customer_id: 'customer-a', type: 'facility', street_1: 'Kungsgatan 12', postal_code: '441 30', city: 'Alingsås', is_active: true, moved_out_at: null },
      { id: 'billing-1', company_id: 'company-a', customer_id: 'customer-a', type: 'billing', street_1: 'Fakturavägen 1', postal_code: '111 22', city: 'Stockholm', is_active: true, moved_out_at: null },
    ],
    audit_logs: [],
  }
})

describe('customer card — registered address', () => {
  it('stores a new registered address with staff provenance; facility and invoice addresses are untouched', async () => {
    const result = await save(address)
    expect(result).toMatchObject({ status: 'success' })
    expect(current()).toHaveLength(1)
    expect(current()[0]).toMatchObject({
      company_id: 'company-a', street_1: 'Storgatan 5', postal_code: '441 31', city: 'Alingsås', country: 'SE', created_by: 'actor-a',
      metadata: { registered_address_source: 'staff_entry', declared_by: 'actor-a', source_reference: 'customer_card:customer-a' },
    })
    expect(state.tables.customer_addresses.find(row => row.id === 'facility-1')).toMatchObject({ type: 'facility', street_1: 'Kungsgatan 12' })
    expect(state.tables.customer_addresses.find(row => row.id === 'billing-1')).toMatchObject({ type: 'billing', street_1: 'Fakturavägen 1' })
    expect(state.tables.audit_logs).toEqual([expect.objectContaining({ company_id: 'company-a', action: 'customer_registered_address_created', actor_user_id: 'actor-a' })])
  })

  it('a correction replaces the address and keeps the previous one as history, so exactly one is current', async () => {
    state.tables.customer_addresses.push({ id: 'legacy-1', company_id: 'company-a', customer_id: 'customer-a', type: 'registered', street_1: 'Gamla vägen 1', street_2: null, postal_code: '441 30', city: 'Alingsås', country: 'SE', is_active: true, moved_in_at: null, moved_out_at: null })
    const result = await save({ ...address, street2: 'c/o Andersson' })
    expect(result.status).toBe('success')
    expect(result.message).toContain('historiken')
    expect(registered()).toHaveLength(2)
    expect(registered().find(row => row.id === 'legacy-1')).toMatchObject({ street_1: 'Gamla vägen 1', moved_out_at: today, updated_by: 'actor-a' })
    expect(current()).toEqual([expect.objectContaining({ street_1: 'Storgatan 5', street_2: 'c/o Andersson', moved_in_at: today })])
  })

  it('saving the same address again changes nothing', async () => {
    await save(address)
    const result = await save({ ...address, postal_code: '44131' })
    expect(result).toMatchObject({ status: 'success', message: 'Adressen är redan registrerad.' })
    expect(registered()).toHaveLength(1)
    expect(state.tables.audit_logs).toHaveLength(1)
  })

  it('returns field errors and writes nothing for an invalid address', async () => {
    const result = await save({ ...address, street: '', postal_code: '4413' })
    expect(result.status).toBe('error')
    expect(result.fieldErrors.street).toBeDefined()
    expect(result.fieldErrors.postalCode).toContain('fem siffror')
    expect(registered()).toHaveLength(0)
  })

  it('refuses a customer of another company', async () => {
    const result = await save({ ...address, customer_id: 'customer-b' })
    expect(result).toMatchObject({ status: 'error', message: 'Kunden finns inte i ditt bolag.' })
    expect(registered('customer-b')).toHaveLength(0)
    // Another tenant's staff member cannot write this customer either.
    state.company = 'company-b'
    expect((await save(address)).message).toBe('Kunden finns inte i ditt bolag.')
    expect(registered()).toHaveLength(0)
  })

  it('refuses without the customers.write permission or without a signed-in user', async () => {
    state.forbidden = true
    expect(await save(address)).toMatchObject({ status: 'error', message: 'Du saknar behörighet för den här åtgärden.' })
    expect(vi.mocked(requireAdminActionAccess)).toHaveBeenLastCalledWith({ allOf: ['customers.write'] })
    state.forbidden = false; state.user = null
    expect((await save(address)).status).toBe('error')
    expect(registered()).toHaveLength(0)
  })
})
