const editableStatuses = ['draft', 'queued', 'submitted', 'failed']

export const manualSwitchStatusOptions = [
  { value: 'draft', label: 'Utkast' },
  { value: 'queued', label: 'Köad' },
  { value: 'submitted', label: 'Skickad' },
  { value: 'rejected', label: 'Avvisad' },
  { value: 'failed', label: 'Kräver åtgärd' },
]

export function canEditManualSwitchStatus(status: string | null): status is string {
  return status !== null && editableStatuses.includes(status)
}

export function isManualSwitchStatusSelection(status: string | null): status is string {
  return status !== null && manualSwitchStatusOptions.some(option => option.value === status)
}

export function canRetrySwitchOutboundStatus(status: string | null): status is 'failed' | 'cancelled' {
  return status === 'failed' || status === 'cancelled'
}
