import { describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  filters: [] as Array<{ table: string; field: string; value: string }>,
  statuses: [] as string[][],
}))
const reference = `invoice_${'a'.repeat(32)}`

vi.mock('server-only', () => ({}))
vi.mock('@/lib/customer-portal/customerResolver', () => ({
  resolvePortalCustomer: vi.fn(), isMissingPortalSchemaError: () => false,
}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: (table: string) => {
      const values = new Map<string, string>()
      const query = {
        insert: () => Promise.resolve({ error: null }),
        select: () => query,
        eq: (field: string, value: string) => {
          values.set(field, value)
          fixture.filters.push({ table, field, value })
          return query
        },
        in: (_field: string, statuses: string[]) => {
          fixture.statuses.push(statuses)
          return query
        },
        maybeSingle: async () => ({
          data: values.get('company_id') === 'synthetic-organization-a' &&
            values.get('customer_id') === 'synthetic-customer-a' &&
            values.get('invoice_reference') === reference
            ? { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', invoice_reference: reference }
            : null,
          error: null,
        }),
      }
      return query
    },
  },
}))

import { getPortalInvoiceByReference, portalContextFromResolved } from '@/lib/customer-portal/apiData'

describe('actual invoice detail query boundary', () => {
  it('selects one canonical public reference only inside the resolved customer and organization', async () => {
    const context = (companyId: string, customerId: string) => portalContextFromResolved({ companyId, customerId })
    const own = await getPortalInvoiceByReference(context('synthetic-organization-a', 'synthetic-customer-a'), reference)
    expect(own?.invoice_reference).toBe(reference)
    expect(await getPortalInvoiceByReference(context('synthetic-organization-a', 'synthetic-customer-b'), reference)).toBeNull()
    expect(await getPortalInvoiceByReference(context('synthetic-organization-b', 'synthetic-customer-a'), reference)).toBeNull()
    expect(fixture.filters.filter((row) => row.table === 'customer_invoices')).toEqual([
      { table: 'customer_invoices', field: 'company_id', value: 'synthetic-organization-a' },
      { table: 'customer_invoices', field: 'customer_id', value: 'synthetic-customer-a' },
      { table: 'customer_invoices', field: 'invoice_reference', value: reference },
      { table: 'customer_invoices', field: 'company_id', value: 'synthetic-organization-a' },
      { table: 'customer_invoices', field: 'customer_id', value: 'synthetic-customer-b' },
      { table: 'customer_invoices', field: 'invoice_reference', value: reference },
      { table: 'customer_invoices', field: 'company_id', value: 'synthetic-organization-b' },
      { table: 'customer_invoices', field: 'customer_id', value: 'synthetic-customer-a' },
      { table: 'customer_invoices', field: 'invoice_reference', value: reference },
    ])
    expect(fixture.statuses).toEqual(Array.from({ length: 3 }, () => [
      'issued', 'sent', 'paid', 'overdue', 'cancelled', 'credited',
    ]))
  })
})
