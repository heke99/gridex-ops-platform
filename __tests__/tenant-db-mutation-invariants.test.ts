import { beforeEach, describe, expect, it, vi } from 'vitest'

type OperationCall = {
  table: string
  method: 'select' | 'insert' | 'update' | 'delete' | 'upsert'
  values?: unknown
  options?: unknown
  filters: Array<[string, unknown]>
}

const state = vi.hoisted(() => ({
  fromCalls: [] as string[],
  operationCalls: [] as OperationCall[],
}))

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from(table: string) {
      state.fromCalls.push(table)

      const operation = (
        method: OperationCall['method'],
        values?: unknown,
        options?: unknown,
      ) => {
        const call: OperationCall = { table, method, values, options, filters: [] }
        state.operationCalls.push(call)
        const builder = {
          eq(column: string, value: unknown) {
            call.filters.push([column, value])
            return builder
          },
        }
        return builder
      }

      return {
        select: (columns?: string, options?: unknown) => operation('select', columns, options),
        insert: (values: unknown) => operation('insert', values),
        update: (values: unknown) => operation('update', values),
        delete: () => operation('delete'),
        upsert: (values: unknown, options?: unknown) => operation('upsert', values, options),
      }
    },
  },
}))

import { tenantDb } from '@/lib/supabase/tenantDb'

beforeEach(() => {
  state.fromCalls = []
  state.operationCalls = []
})

describe('tenantDb mutation invariants', () => {
  it.each([
    ['foreign', 'company-b'],
    ['null', null],
    ['undefined', undefined],
  ])('rejects an explicit %s update owner before client I/O', (_label, companyId) => {
    const table = tenantDb('company-a').from('records')

    expect(() => table.update({ company_id: companyId, status: 'ready' })).toThrow(
      /company_id/i,
    )
    expect(state.fromCalls).toEqual([])
    expect(state.operationCalls).toEqual([])
  })

  it('allows a same-company update while keeping ownership out of the patch', () => {
    const table = tenantDb('company-a').from('records')
    const patch = { company_id: 'company-a', status: 'ready' }

    table.update(patch)

    expect(state.operationCalls).toEqual([
      {
        table: 'records',
        method: 'update',
        values: { status: 'ready' },
        options: undefined,
        filters: [['company_id', 'company-a']],
      },
    ])
    expect(patch).toEqual({ company_id: 'company-a', status: 'ready' })
  })

  it('allows an ordinary update and applies the tenant filter', () => {
    tenantDb('company-a').from('records').update({ status: 'ready' })

    expect(state.operationCalls).toEqual([
      {
        table: 'records',
        method: 'update',
        values: { status: 'ready' },
        options: undefined,
        filters: [['company_id', 'company-a']],
      },
    ])
  })

  it('copies an update patch before giving it to the query builder', () => {
    const patch: Record<string, unknown> = { status: 'ready' }
    tenantDb('company-a').from('records').update(patch)

    patch.status = 'mutated-after-update'
    patch.company_id = 'company-b'

    expect(state.operationCalls[0]?.values).toEqual({ status: 'ready' })
  })

  it('stamps copied insert rows without mutating caller input', () => {
    const rows = [
      { id: 'one', company_id: 'company-b' },
      { id: 'two', status: 'ready' },
    ]

    tenantDb('company-a').from('records').insert(rows)

    expect(state.operationCalls[0]?.values).toEqual([
      { id: 'one', company_id: 'company-a' },
      { id: 'two', status: 'ready', company_id: 'company-a' },
    ])
    expect(rows).toEqual([
      { id: 'one', company_id: 'company-b' },
      { id: 'two', status: 'ready' },
    ])
  })

  it.each([
    ['default options', undefined],
    ['global id', { onConflict: 'id' }],
    ['global natural key', { onConflict: 'external_key' }],
    ['composite key', { onConflict: 'company_id,external_key' }],
  ])('rejects unsupported upsert with %s before client I/O', (_label, options) => {
    const table = tenantDb('company-a').from('records')

    expect(() => table.upsert({ id: 'record-1' }, options)).toThrow(/upsert/i)
    expect(state.fromCalls).toEqual([])
    expect(state.operationCalls).toEqual([])
  })
})
