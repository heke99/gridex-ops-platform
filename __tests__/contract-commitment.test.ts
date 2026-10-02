import { describe, expect, it } from 'vitest'
import { addMonthsIso, contractCommitment } from '@/lib/customer-contracts/commitment'

const TODAY = '2026-10-02'
const base = { id: 'k1', status: 'active', contract_type: 'variable_monthly' }

describe('contract commitment', () => {
  it('adds calendar months and clamps month ends', () => {
    expect(addMonthsIso('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonthsIso('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonthsIso('2025-11-15', 14)).toBe('2027-01-15')
  })

  it('a variable contract without binding or notice needs no takeover', () => {
    expect(contractCommitment(base, TODAY)).toMatchObject({ binding: false, noticeMonths: null, requiresTakeover: false })
  })

  it('binding months from the start date bind until start + months', () => {
    expect(contractCommitment({ ...base, binding_months: 12, actual_start_at: '2026-03-01' }, TODAY))
      .toMatchObject({ binding: true, bindingEndsOn: '2027-03-01', requiresTakeover: true })
    expect(contractCommitment({ ...base, binding_months: 12, actual_start_at: '2025-03-01' }, TODAY))
      .toMatchObject({ binding: false, requiresTakeover: false })
    // Ends today: no longer binding.
    expect(contractCommitment({ ...base, binding_months: 12, actual_start_at: '2025-10-02' }, TODAY).binding).toBe(false)
  })

  it('a binding contract that has not started yet is binding', () => {
    expect(contractCommitment({ ...base, status: 'pending_signature', binding_months: 24 }, TODAY))
      .toMatchObject({ binding: true, requiresTakeover: true })
  })

  it('a fixed-term contract is binding until ends_at', () => {
    expect(contractCommitment({ ...base, contract_type: 'fixed', ends_at: '2027-06-30' }, TODAY))
      .toMatchObject({ binding: true, bindingEndsOn: '2027-06-30', requiresTakeover: true })
    expect(contractCommitment({ ...base, contract_type: 'variable_monthly', ends_at: '2027-06-30' }, TODAY).binding).toBe(false)
  })

  it('a notice period or a pending termination requires takeover', () => {
    expect(contractCommitment({ ...base, notice_months: 1 }, TODAY)).toMatchObject({ noticeMonths: 1, requiresTakeover: true })
    expect(contractCommitment({ ...base, termination_notice_date: '2026-09-15', ends_at: '2026-11-30' }, TODAY))
      .toMatchObject({ terminationPending: true, requiresTakeover: true })
  })

  it('ended, cancelled and draft contracts never require takeover', () => {
    for (const status of ['terminated', 'expired', 'cancelled', 'draft', 'signature_failed']) {
      expect(contractCommitment({ ...base, status, binding_months: 24, notice_months: 3, actual_start_at: '2026-09-01' }, TODAY).requiresTakeover).toBe(false)
    }
  })
})
