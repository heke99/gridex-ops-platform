import { describe, expect, it } from 'vitest'
import { formatStatusLabel } from '@/lib/ui/format'

describe('formatStatusLabel', () => {
  it('maps DB statuses shown in admin to Swedish labels', () => {
    expect(formatStatusLabel('blocked_tenant_state')).toBe('Stoppad (bolaget ej aktivt)')
    expect(formatStatusLabel('delivery_uncertain')).toBe('Leverans osäker')
    expect(formatStatusLabel('waiting_for_z02')).toBe('Väntar på nätägarens svar')
  })
  it('never shows a raw snake_case code', () => {
    expect(formatStatusLabel('needs_more_info')).toBe('Needs more info')
  })
  it('handles empty values', () => {
    expect(formatStatusLabel(null)).toBe('—')
    expect(formatStatusLabel('')).toBe('—')
  })
})


it.each([
  ['submitted', 'Inskickad'], ['accepted', 'Accepterad'],
  ['awaiting_contrl', 'Inväntar leveransbekräftelse'], ['waiting_for_contrl', 'Inväntar leveransbekräftelse'],
  ['awaiting_aperak', 'Inväntar mottagarens bekräftelse'], ['waiting_for_aperak', 'Inväntar mottagarens bekräftelse'],
  ['z02_received', 'Nätägarens svar mottaget'],
])('uses a business label for %s without changing the saved status', (status, label) => {
  expect(formatStatusLabel(status)).toBe(label)
})
