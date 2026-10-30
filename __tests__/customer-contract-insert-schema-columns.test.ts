import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Finding 20261029-3f1a8ab1/claude-track2/005: createCustomerContract inserted
// current_supplier_* keys that do not exist on public.customer_contracts (PGRST204).
const captured = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>>, tables: [] as string[] }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from: (table: string) => {
    captured.tables.push(table)
    return {
      insert: (row: Record<string, unknown>) => {
        captured.rows.push(row)
        return { select: () => ({ single: async () => ({ data: { ...row }, error: null }) }) }
      },
    }
  },
} }))

import { createCustomerContract } from '@/lib/customer-contracts/db'

function schemaColumns(table: string): Set<string> {
  const sql = readFileSync(join(process.cwd(), 'supabase/schema.sql'), 'utf8')
  const start = sql.indexOf(`CREATE TABLE public.${table} (`)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = sql.indexOf('\n);', start)
  const cols = new Set<string>()
  for (const line of sql.slice(start, end).split('\n').slice(1)) {
    const match = /^\s{4}"?([a-z_][a-z0-9_]*)"?\s+\S/.exec(line)
    if (match && !['constraint', 'primary', 'unique', 'check', 'foreign'].includes(match[1])) cols.add(match[1])
  }
  return cols
}

const base = {
  customerId: '11111111-1111-4111-8111-111111111111',
  siteId: '22222222-2222-4222-8222-222222222222',
  companyId: '33333333-3333-4333-8333-333333333333',
  sourceType: 'manual_override' as const,
  contractName: 'Test',
  contractType: 'variable_monthly' as const,
  greenFeeMode: 'none' as const,
  bindingMonths: 12,
  noticeMonths: 3,
  startsAt: '2027-01-01',
  monthlyFeeSek: 39,
}
const supplierInput = {
  currentSupplierId: 'sup-1', currentSupplierName: 'Gammal El AB', currentSupplierOrgNumber: '556000-0000',
  currentSupplierContractStatus: 'active', currentSupplierContractEndDate: '2027-06-30',
  currentSupplierNoticePeriod: '3 months', currentSupplierTerminationFee: 0, currentSupplierResponseStatus: 'received',
}

describe('createCustomerContract insert matches canonical customer_contracts schema', () => {
  beforeEach(() => { captured.rows.length = 0; captured.tables.length = 0 })

  it('only sends keys that are columns of public.customer_contracts', async () => {
    await createCustomerContract({ ...base, ...supplierInput })
    const columns = schemaColumns('customer_contracts')
    expect(columns.has('id')).toBe(true)
    const unknown = Object.keys(captured.rows[0]).filter((key) => !columns.has(key))
    expect(unknown).toEqual([])
  })

  it('succeeds with currentSupplier* input and sends no current_supplier_* keys', async () => {
    const row = await createCustomerContract({ ...base, ...supplierInput })
    expect(captured.tables).toEqual(['customer_contracts'])
    expect(row).toBeTruthy()
    expect(Object.keys(captured.rows[0]).filter((key) => key.startsWith('current_supplier_'))).toEqual([])
  })

  it('preserves the other fields unchanged', async () => {
    await createCustomerContract({ ...base, ...supplierInput })
    expect(captured.rows[0]).toMatchObject({
      company_id: base.companyId, customer_id: base.customerId, site_id: base.siteId, customer_site_id: base.siteId,
      source_type: 'manual_override', status: 'draft', contract_name: 'Test', contract_type: 'variable_monthly',
      binding_months: 12, notice_months: 3, starts_at: '2027-01-01', monthly_fee_sek: 39,
      auto_renew_enabled: true, auto_renew_term_months: 12, billing_level: 'customer',
    })
    expect(captured.rows[0].ends_at).toBeDefined()
  })
})
