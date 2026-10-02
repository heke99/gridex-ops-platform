import { describe, expect, it } from 'vitest'
import { formatAdminDate, formatAdminDateTime } from '@/lib/ui/format'

describe('admin display formatting', () => {
  it('formats in Stockholm time with Swedish locale', () => {
    expect(formatAdminDate('2026-10-01T23:30:00Z')).toBe('2026-10-02')
    expect(formatAdminDateTime('2026-10-02T12:05:00Z')).toBe('2026-10-02 14:05')
  })

  it('returns the empty marker for missing or invalid values', () => {
    expect(formatAdminDate(null)).toBe('—')
    expect(formatAdminDateTime('not-a-date', '')).toBe('')
  })
})
