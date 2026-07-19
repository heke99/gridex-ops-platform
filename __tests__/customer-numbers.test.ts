import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  rpcResult: { data: 'DX-100001' as string | null, error: null as { code?: string; message?: string } | null },
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  conditionalUpdateRow: { customer_number: 'DX-100001' } as Record<string, unknown> | null,
  currentRow: { customer_number: null } as Record<string, unknown> | null,
}))

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args })
      return state.rpcResult
    },
    from(table: string) {
      if (table !== 'customers') throw new Error(`unexpected table ${table}`)
      let isConditionalUpdate = false
      const builder: Record<string, unknown> = {}
      const chain = () => builder
      for (const method of ['select', 'eq', 'order', 'limit']) builder[method] = chain
      builder.update = () => {
        isConditionalUpdate = false
        return builder
      }
      builder.is = () => {
        isConditionalUpdate = true
        return builder
      }
      builder.maybeSingle = () =>
        Promise.resolve({
          data: isConditionalUpdate ? state.conditionalUpdateRow : state.currentRow,
          error: null,
        })
      return builder
    },
  },
}))

import {
  ensureCustomerNumber,
  ensureCustomerNumberIfSupported,
  reserveCustomerNumber,
} from '@/lib/customer-numbers/customerNumbers'

beforeEach(() => {
  state.rpcResult = { data: 'DX-100001', error: null }
  state.rpcCalls = []
  state.conditionalUpdateRow = { customer_number: 'DX-100001' }
  state.currentRow = { customer_number: null }
})

describe('reserveCustomerNumber', () => {
  it('reserves atomically through the canonical RPC', async () => {
    const number = await reserveCustomerNumber('company-1')
    expect(number).toBe('DX-100001')
    expect(state.rpcCalls).toEqual([
      { name: 'gridex_next_customer_number', args: { p_company_id: 'company-1' } },
    ])
  })

  it('throws a migration hint when the generator is missing', async () => {
    state.rpcResult = { data: null, error: { code: '42883', message: 'function does not exist' } }
    await expect(reserveCustomerNumber('company-1')).rejects.toThrow(/Kundnummer-funktionen saknas/)
  })
})

describe('ensureCustomerNumber', () => {
  it('returns the existing number without reserving a new one', async () => {
    const number = await ensureCustomerNumber({
      companyId: 'company-1',
      customerId: 'customer-1',
      existingCustomerNumber: ' DX-000042 ',
    })
    expect(number).toBe('DX-000042')
    expect(state.rpcCalls).toHaveLength(0)
  })

  it('assigns the reserved number when the row had none', async () => {
    const number = await ensureCustomerNumber({ companyId: 'company-1', customerId: 'customer-1' })
    expect(number).toBe('DX-100001')
  })

  it('returns the persisted number when a concurrent writer or the DB trigger won the race', async () => {
    // Conditional update matches nothing (number no longer null)...
    state.conditionalUpdateRow = null
    // ...and the row already carries the number assigned by the other writer.
    state.currentRow = { customer_number: 'DX-100777' }

    const number = await ensureCustomerNumber({ companyId: 'company-1', customerId: 'customer-1' })

    // The unused reservation must never be reported as the customer's number.
    expect(number).toBe('DX-100777')
  })
})

describe('ensureCustomerNumberIfSupported', () => {
  it('returns null instead of failing intake when the generator is missing', async () => {
    state.rpcResult = { data: null, error: { code: 'PGRST202', message: 'schema cache' } }
    const number = await ensureCustomerNumberIfSupported({
      companyId: 'company-1',
      customerId: 'customer-1',
    })
    expect(number).toBeNull()
  })

  it('propagates real errors', async () => {
    state.rpcResult = { data: null, error: { code: '57014', message: 'statement timeout' } }
    await expect(
      ensureCustomerNumberIfSupported({ companyId: 'company-1', customerId: 'customer-1' }),
    ).rejects.toMatchObject({ code: '57014' })
  })

  it('assigns through the canonical generator on migrated databases', async () => {
    const number = await ensureCustomerNumberIfSupported({
      companyId: 'company-1',
      customerId: 'customer-1',
    })
    expect(number).toBe('DX-100001')
    expect(state.rpcCalls[0]?.name).toBe('gridex_next_customer_number')
  })
})
