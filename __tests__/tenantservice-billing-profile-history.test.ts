import { describe, expect, it, vi } from 'vitest'

const calls: Array<[string, unknown]> = []
const builder = {
  eq: (col: string, val: unknown) => { calls.push(['eq', [col, val]]); return builder },
  order: (col: string, opts: unknown) => { calls.push(['order', [col, opts]]); return builder },
  limit: async (n: number) => { calls.push(['limit', n]); return { data: [{ revision: 2, changed_fields: ['invoice_email'] }], error: null } },
}
const tenantSelect = vi.fn<(...args: unknown[]) => typeof builder>(() => builder)
vi.mock('@/lib/supabase/tenantQuery', () => ({ tenantSelect: (...a: unknown[]) => tenantSelect(...a) }))

import { billingFieldLabel, listBillingProfileRevisions } from '@/lib/customer-service/billingProfileRevisions'

describe('billing profile revision history', () => {
  it('reads only the given company and customer, newest first', async () => {
    const rows = await listBillingProfileRevisions('company-a', 'customer-1')
    expect(tenantSelect.mock.calls[0][0]).toBe('company-a')
    expect(tenantSelect.mock.calls[0][1]).toBe('customer_billing_profile_revisions')
    expect(calls).toContainEqual(['eq', ['customer_id', 'customer-1']])
    expect(calls).toContainEqual(['order', ['revision', { ascending: false }]])
    expect(rows[0].revision).toBe(2)
  })
  it('labels fields in Swedish and passes unknown through', () => {
    expect(billingFieldLabel('invoice_email')).toBe('Faktura-e-post')
    expect(billingFieldLabel('x')).toBe('x')
  })
})
