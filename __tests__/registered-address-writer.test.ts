// FINDINGS F51: the customer's registered address is collected (website declaration or staff entry) and kept as
// exactly one current customer_addresses row of type 'registered', with provenance and history.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const db = vi.hoisted(() => ({ rows: [] as Row[], seq: 0 }))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: () => {
      const filters: Array<[string, unknown]> = []
      let ids: unknown[] | null = null
      let patch: Row | null = null
      const matches = (row: Row) => filters.every(([key, value]) => row[key] === value) && (!ids || ids.includes(row.id))
      const self: Record<string, unknown> = {
        select: () => self,
        eq: (key: string, value: unknown) => { filters.push([key, value]); return self },
        in: (_key: string, values: unknown[]) => { ids = values; return self },
        update: (value: Row) => { patch = value; return self },
        insert: (value: Row) => { const row = { id: `addr-${(db.seq += 1)}`, ...value }; db.rows.push(row); return { select: () => ({ single: async () => ({ data: row, error: null }) }) } },
        then: (resolve: (value: unknown) => unknown) => {
          if (patch) { for (const row of db.rows.filter(matches)) Object.assign(row, patch); return Promise.resolve({ error: null }).then(resolve) }
          return Promise.resolve({ data: db.rows.filter(matches), error: null }).then(resolve)
        },
      }
      return self
    },
  },
}))

import { recordRegisteredAddress, validateRegisteredAddress } from '@/lib/customers/registeredAddress'

const base = { companyId: 'company-a', customerId: 'customer-1', actorUserId: 'staff-1', now: new Date('2026-10-22T10:00:00Z') }
const home = { street: 'Kungsgatan 1', postalCode: '44130', city: 'Alingsås' }

beforeEach(() => { db.rows = []; db.seq = 0 })

describe('registered address writer (F51)', () => {
  it('stores the first registered address with provenance and the national postal shape', async () => {
    const result = await recordRegisteredAddress({ ...base, address: home, source: 'website_declaration', reference: 'application-1', declaredAt: '2026-10-22T09:59:00Z' })
    expect(result.status).toBe('created')
    expect(db.rows).toEqual([expect.objectContaining({ company_id: 'company-a', customer_id: 'customer-1', type: 'registered', street_1: 'Kungsgatan 1',
      postal_code: '441 30', city: 'Alingsås', country: 'SE', is_active: true, moved_in_at: null,
      metadata: expect.objectContaining({ registered_address_source: 'website_declaration', source_reference: 'application-1', declared_at: '2026-10-22T09:59:00Z', declared_by: 'staff-1' }) })])
  })

  it('leaves an identical current address untouched', async () => {
    await recordRegisteredAddress({ ...base, address: home, source: 'staff_entry' })
    await expect(recordRegisteredAddress({ ...base, address: { ...home, postalCode: '441 30' }, source: 'staff_entry' })).resolves.toMatchObject({ status: 'unchanged' })
    expect(db.rows).toHaveLength(1)
  })

  it('a changed address closes the current one today and opens the new one from today: exactly one is current', async () => {
    await recordRegisteredAddress({ ...base, address: home, source: 'website_declaration' })
    const result = await recordRegisteredAddress({ ...base, address: { street: 'Nygatan 3', postalCode: '441 30', city: 'Alingsås' }, source: 'staff_entry' })
    expect(result.status).toBe('replaced')
    expect(db.rows.map(row => [row.street_1, row.moved_in_at, row.moved_out_at])).toEqual([['Kungsgatan 1', null, '2026-10-22'], ['Nygatan 3', '2026-10-22', undefined]])
    const current = db.rows.filter(row => (!row.moved_in_at || String(row.moved_in_at) <= '2026-10-22') && (!row.moved_out_at || '2026-10-22' < String(row.moved_out_at)))
    expect(current.map(row => row.street_1)).toEqual(['Nygatan 3'])
  })

  it('never writes another tenant\'s or customer\'s address', async () => {
    db.rows.push({ id: 'foreign', company_id: 'company-b', customer_id: 'customer-1', type: 'registered', street_1: 'Annan 1', postal_code: '111 11', city: 'Stockholm', is_active: true })
    await recordRegisteredAddress({ ...base, address: home, source: 'staff_entry' })
    expect(db.rows.find(row => row.id === 'foreign')).not.toHaveProperty('moved_out_at')
  })

  it('rejects an address the Ediel masterdata shape cannot carry', async () => {
    expect(validateRegisteredAddress({ street: '', postalCode: '4413', city: '' })).toEqual({ street: expect.any(String), postalCode: expect.any(String), city: expect.any(String) })
    expect(validateRegisteredAddress({ street: 'x'.repeat(36), postalCode: '44130', city: 'Alingsås' })).toHaveProperty('street')
    expect(validateRegisteredAddress({ ...home, country: 'NO' })).toHaveProperty('country')
    await expect(recordRegisteredAddress({ ...base, address: { ...home, postalCode: 'abc' }, source: 'staff_entry' })).rejects.toThrow('registered_address_invalid:postalCode')
    expect(db.rows).toEqual([])
  })
})
