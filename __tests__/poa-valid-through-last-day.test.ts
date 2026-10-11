// poa-mail-review follow-up: a date-only valid_to includes the whole Swedish day
import { expect, it } from 'vitest'
import { derivePowerOfAttorneyLifecycleStatus } from '@/lib/customers/poaReadiness'

const poa = { status: 'signed', accepted_at: '2026-01-01T10:00:00Z', signed_at: '2026-01-01T10:00:00Z', signer_name: 'Synthetic', method: 'bankid', valid_to: '2026-10-09' }

it.each([
  ['2026-10-09T00:30:00+02:00', 'valid'],
  ['2026-10-09T23:59:00+02:00', 'valid'],
  ['2026-10-10T00:00:00+02:00', 'expired'],
  ['2026-10-10T09:00:00+02:00', 'expired'],
])('at %s the POA is %s', (now, expected) => {
  const status = derivePowerOfAttorneyLifecycleStatus(poa as never, { now: new Date(now) })
  expect(status === 'valid' || status === 'expired' ? status : `other:${status}`).toBe(expected)
})

it('winter dates use +01:00', () => {
  const winter = { ...poa, valid_to: '2026-12-31' }
  expect(derivePowerOfAttorneyLifecycleStatus(winter as never, { now: new Date('2026-12-31T23:30:00+01:00') })).toBe('valid')
  expect(derivePowerOfAttorneyLifecycleStatus(winter as never, { now: new Date('2027-01-01T00:00:00+01:00') })).toBe('expired')
})
