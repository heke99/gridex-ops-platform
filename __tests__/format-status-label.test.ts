import { describe, expect, it } from 'vitest'
import { formatStatusLabel } from '@/lib/ui/format'

describe('formatStatusLabel', () => {
  it('maps DB statuses shown in admin to Swedish labels', () => {
    expect(formatStatusLabel('blocked_tenant_state')).toBe('Stoppad (bolaget ej aktivt)')
    expect(formatStatusLabel('delivery_uncertain')).toBe('Leverans osäker')
    expect(formatStatusLabel('waiting_for_z02')).toBe('Väntar på svar (Z02)')
  })
  it('never shows a raw snake_case code', () => {
    expect(formatStatusLabel('needs_more_info')).toBe('Needs more info')
  })
  it('handles empty values', () => {
    expect(formatStatusLabel(null)).toBe('—')
    expect(formatStatusLabel('')).toBe('—')
  })
})
