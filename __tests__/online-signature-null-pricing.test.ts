import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {} }))
import { frozenPriceSummary } from '@/lib/customer-contracts/onlineSigning'

describe('frozen signed-agreement prices', () => {
  it('keeps absent nullable prices absent in the customer-facing summary', () => {
    expect(frozenPriceSummary({ monthly_fee_sek: null, invoice_fee_sek: '', fixed_price_ore_per_kwh: null, spot_markup_ore_per_kwh: null })).toBe('Pris enligt den frysta prisversionen i avtalet.')
  })
  it('uses frozen price components when an optional scalar is null', () => {
    expect(frozenPriceSummary({ monthly_fee_sek: null, price_components_snapshot: [{ component_code: 'monthly_fee', component_type: 'fixed_monthly_fee', calculation_type: 'fixed_monthly', amount: 49, unit: 'sek_month', name: 'Månadsavgift' }] })).toBe('Månadsavgift: 49 kr/mån exkl. moms')
  })
  it('preserves an explicitly frozen zero fee', () => {
    expect(frozenPriceSummary({ monthly_fee_sek: 0, invoice_fee_sek: '0' })).toBe('0 kr/mån, 0 kr/faktura')
  })
})
