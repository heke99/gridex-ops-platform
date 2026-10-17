import { describe, expect, it } from 'vitest'
import { isOperationActionRequired, operationActionStatusLabel, operationChannelLabel, operationTypeLabel } from '@/lib/operations/actionableStatus'
import { energyResolutionStatusLabel } from '@/lib/customers/statusLabels'

describe('operation action state', () => {
  it.each(['future_backend_state', 'waiting_response', 'completed'])('keeps the explicit action-required decision authoritative for %s', status => {
    expect(isOperationActionRequired({ status, actionRequired: true })).toBe(true)
  })

  it.each(['needs_review', 'blocked_missing_poa', 'future_backend_state'])('honors an explicit no-action decision for %s', status => {
    expect(isOperationActionRequired({ status, actionRequired: false })).toBe(false)
  })

  it.each(['queued', 'waiting_response', 'process_waiting', 'completed', 'cancelled'])('does not turn known automatic or finished %s work into a manual task', status => {
    expect(isOperationActionRequired({ status })).toBe(false)
  })

  it.each(['future_backend_state', null, ''])('holds an unclassified %s state for visible review', status => {
    expect(isOperationActionRequired({ status })).toBe(true)
    expect(operationActionStatusLabel(status)).toMatch(/åtgärd|granskning/)
  })

  it.each(['__proto__', 'constructor', 'toString'])('uses ordinary unknown labels for the unclassified code %s', status => {
    expect(operationActionStatusLabel(status)).toBe('Kräver åtgärd')
    expect(operationTypeLabel(status)).toBe('Åtgärd')
    expect(operationChannelLabel(status)).toBe('Behöver granskning')
    expect(energyResolutionStatusLabel(status)).toBe('Behöver granskning')
  })
})
