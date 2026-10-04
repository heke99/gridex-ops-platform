import { describe, expect, it } from 'vitest'
import { applyPermissionEvent } from '@/lib/ediel/permissions/permissionEngine'
import { handleZ14PermissionResponse } from '@/lib/ediel/permissions/z14HandleResponse'

describe('ESCO business responses and acknowledgements are independent', () => {
  it.each(['z13_sent', 'contrl_positive', 'aperak_positive', 'awaiting_customer_approval_21d'] as const)(
    'accepts an actual Z14 before all ACKs in %s', (currentState) => {
      expect(applyPermissionEvent({ currentState, event: 'z14v_received' })).toBe('active_after_z14v_or_z14vh')
    },
  )
  it('accepts a positive APERAK before CONTRL without creating permission', () => {
    expect(applyPermissionEvent({ currentState: 'z13_sent', event: 'aperak_positive' })).toBe('aperak_positive')
  })
  it.each(['contrl_positive', 'aperak_positive', 'contrl_negative', 'aperak_negative'] as const)(
    'preserves an established market result on late %s', (event) => {
      expect(applyPermissionEvent({ currentState: 'active_after_z14v_or_z14vh', event })).toBe('active_after_z14v_or_z14vh')
      expect(applyPermissionEvent({ currentState: 'denied_timeout', event })).toBe('denied_timeout')
    },
  )
  it.each(['A13', 'A76'] as const)('records actual negative business reason %s before ACK', (reasonCode) => {
    expect(handleZ14PermissionResponse({ currentState: 'z13_sent', responseCode: 'N', reasonCode }))
      .toBe(reasonCode === 'A13' ? 'z14n_a13_withdrawn' : 'z14n_a76_timeout')
  })
  it.each([undefined, null, 'A74', 'UNKNOWN'])('never activates unknown negative reason %s', (reasonCode) => {
    expect(() => handleZ14PermissionResponse({ currentState: 'awaiting_customer_approval_21d', responseCode: 'N', reasonCode }))
      .toThrow('z14_negative_reason_unqualified')
  })
  it('is idempotent for the same established business event', () => {
    expect(applyPermissionEvent({ currentState: 'active_after_z14v_or_z14vh', event: 'z14v_received' })).toBe('active_after_z14v_or_z14vh')
  })
})
