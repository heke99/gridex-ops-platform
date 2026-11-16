import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
type Call = { table: string; columns: string; eq: Array<[string, unknown]>; inside: Array<[string, readonly unknown[]]> }
const fixture = vi.hoisted(() => ({ customers: [] as Row[], contracts: [] as Row[], calls: [] as Call[], foreignContract: false, contractError: false }))

// External SDK boundary only: real list loader, tenantDb and tenantSelect execute.
vi.mock('@/lib/supabase/service', () => {
  class Query {
    call: Call
    first = 0
    last = Number.MAX_SAFE_INTEGER
    constructor(table: string) { this.call = { table, columns: '', eq: [], inside: [] }; fixture.calls.push(this.call) }
    select(columns: string) { this.call.columns = columns; return this }
    eq(column: string, value: unknown) { this.call.eq.push([column, value]); return this }
    in(column: string, values: readonly unknown[]) { this.call.inside.push([column, values]); return this }
    not() { return this }
    or() { return this }
    order() { return this }
    range(first: number, last: number) { this.first = first; this.last = last; return this }
    limit(n: number) { this.last = n - 1; return this }
    async result() {
      if (this.call.table === 'customers') {
        const schema = readFileSync('supabase/schema.sql', 'utf8').split('CREATE TABLE public.customers (')[1].split('\n);')[0]
        const columns = new Set([...schema.matchAll(/^    ([a-z_]+) /gm)].map(match => match[1]))
        const invalid = this.call.columns.split(',').find(column => !columns.has(column.trim()))
        if (invalid) return { data: null, count: null, error: { code: '42703', message: `customers.${invalid} does not exist` } }
      }
      if (this.call.table === 'customer_contracts' && fixture.contractError) return { data: null, count: null, error: { code: '42501' } }
      let rows = this.call.table === 'customers' ? fixture.customers : this.call.table === 'customer_contracts' ? fixture.contracts : []
      rows = rows.filter(row => this.call.eq.every(([key, value]) => row[key] === value) && this.call.inside.every(([key, values]) => values.includes(row[key])))
      if (this.call.table === 'customer_contracts' && fixture.foreignContract) rows = [...rows, { id: 'foreign', company_id: 'company-b', customer_id: 'customer-a', consolidated_invoice: true, billing_level: 'customer' }]
      return { data: rows.slice(this.first, this.last + 1), count: rows.length, error: null }
    }
    then<TResult1 = Awaited<ReturnType<Query['result']>>, TResult2 = never>(
      fulfilled?: ((value: Awaited<ReturnType<Query['result']>>) => TResult1 | PromiseLike<TResult1>) | null,
      rejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> { return this.result().then(fulfilled, rejected) }
  }
  return { supabaseService: {
    from: (table: string) => new Query(table),
    rpc: (name: string) => {
      const result = { data: name === 'gridex_staff_customer_search_v1' ? { customer_ids: ['customer-a'], total: 1 } : { all_count: 1, active: 1 }, error: null }
      return { single: async () => result, then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve) }
    },
  } }
})

import { listCustomersPage, listCustomersPageForCompany } from '@/lib/customers/getCustomers'

beforeEach(() => {
  fixture.calls = []; fixture.foreignContract = false; fixture.contractError = false
  fixture.customers = [{ id: 'customer-a', company_id: 'company-a', full_name: 'Fixture Customer', status: 'active', created_at: '2026-11-16T00:00:00Z' }]
  fixture.contracts = [{ id: 'contract-a', company_id: 'company-a', customer_id: 'customer-a', consolidated_invoice: true, billing_level: 'customer' }]
})

describe('customer list uses the schema-owned contract preferences', () => {
  it.each(['paged', 'filtered', 'staff'])('reads the %s list using valid customer columns and company-bound contracts', async path => {
    const result = path === 'staff' ? await listCustomersPageForCompany({ companyId: 'company-a' })
      : await listCustomersPage({ companyId: 'company-a', ...(path === 'filtered' ? { query: 'Fixture' } : {}) })
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({ id: 'customer-a', contract_count: 1, contract_billing_summary: { consolidatedInvoice: { state: 'uniform', values: [true] }, billingLevel: { values: ['customer'] } } })
    const reads = fixture.calls.filter(call => call.table === 'customer_contracts')
    expect(reads.length).toBeGreaterThan(0)
    for (const read of reads) {
      expect(read.eq).toContainEqual(['company_id', 'company-a'])
      expect(read.inside).toContainEqual(['customer_id', ['customer-a']])
    }
    if (path === 'staff') expect(result).not.toHaveProperty('counts')
  })
  it('rejects a foreign contract even if the SDK response violates the company predicate', async () => {
    fixture.foreignContract = true
    await expect(listCustomersPage({ companyId: 'company-a', query: 'Fixture' })).rejects.toThrow('ownership_mismatch')
  })
  it('keeps unreadable preferences unavailable and refuses a contract-dependent false-empty result', async () => {
    fixture.contractError = true
    const result = await listCustomersPage({ companyId: 'company-a', query: 'Fixture' })
    expect(result.rows[0]).toMatchObject({ contract_count: null, contract_billing_summary: { consolidatedInvoice: { state: 'unavailable' } } })
    await expect(listCustomersPage({ companyId: 'company-a', query: 'Fixture', flag: 'consolidated_invoice' })).rejects.toThrow('customer_list_contract_filter_complete_read_required')
  })
})
