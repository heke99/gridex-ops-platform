// FINDINGS F51: the public /teckna-avtal intake stores its form address as a facility address, never as the
// customer's registered address (folkbokföringsadress) that the Ediel masterdata rule uses for Z01.
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/service', () => ({ supabaseService: {} }))

import { externalIntakeAddress } from '@/lib/external-contracts/intake'

describe('external contract intake address (F51)', () => {
  it('stores the form address as a facility address with its intake as source', () => {
    expect(externalIntakeAddress({ street: 'Storgatan 2', postalCode: '441 30', city: 'Alingsås' }, 'intake-1')).toEqual({
      type: 'facility', street_1: 'Storgatan 2', postal_code: '441 30', city: 'Alingsås', country: 'SE', is_active: true,
      metadata: { source: 'external_contract_intake', externalContractIntakeId: 'intake-1' },
    })
  })

  it('never produces a registered address', () => {
    for (const input of [{ street: 'Storgatan 2', postalCode: null, city: null }, { street: null, postalCode: '44130', city: null }, { street: null, postalCode: null, city: 'Alingsås' }]) {
      expect(externalIntakeAddress(input, 'intake-1')?.type).toBe('facility')
    }
  })

  it('writes no address when the form has none', () => {
    expect(externalIntakeAddress({ street: null, postalCode: null, city: null }, 'intake-1')).toBeNull()
  })
})
