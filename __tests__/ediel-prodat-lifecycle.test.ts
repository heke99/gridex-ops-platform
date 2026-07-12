import { describe, expect, it } from 'vitest'
import { decideProdatLifecycle } from '@/lib/ediel/stateMachines/prodatLifecycle'
import { validateProdatProfile } from '@/lib/ediel/prodat/profiles'

describe('PRODAT exact profiles and state machines', () => {
  it('does not create a supply period for Z04C', () => {
    const decision = decideProdatLifecycle({ message_code: 'Z04', parsed_payload: { subtype: 'C' }, raw_payload: "BGM+Z04'CCI++Z13'CAV+C'" } as never)
    expect(decision?.process).toBe('cancellation')
    expect(decision?.createSupplyPeriod).toBe(false)
    expect(decision?.state).toBe('cancelled_before_start')
  })

  it.each(['L', 'LK'] as const)('creates supply only for accepted Z04%s', (subtype) => {
    const decision = decideProdatLifecycle({ message_code: 'Z04', parsed_payload: { subtype }, raw_payload: null } as never)
    expect(decision?.createSupplyPeriod).toBe(true)
    expect(decision?.state).toBe('switch_accepted')
  })

  it('requires explicit Z08H end date and closure reason', () => {
    const result = validateProdatProfile({ code: 'Z08', subtype: 'H', version: '26A', context: { code: 'Z08', customerId: 'C', customerName: 'Customer', meterPointId: 'MP' } as never })
    expect(result.profile?.key).toBe('prodat_26a_z08_h')
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['prodat_z08_contractClosureReason_missing', 'prodat_end_date_missing']))
  })
})
