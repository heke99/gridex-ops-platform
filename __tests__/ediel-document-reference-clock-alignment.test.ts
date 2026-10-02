import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {} }))

describe('alignObservationToAttempt', () => {
  const recordedAt = '2026-10-02T09:07:56.527022+00:00'

  it('lifts app-clock times that fall before the database attempt time', async () => {
    const { alignObservationToAttempt } = await import('@/lib/ediel/sources/documentReferenceCapture')
    const observation = { status: 'verified_at_observation', sha256: 'a'.repeat(64), byteCount: 9, startedAt: '2026-10-02T09:07:56.520Z', completedAt: '2026-10-02T09:07:56.525Z' }
    expect(alignObservationToAttempt(observation, recordedAt)).toEqual({ ...observation, startedAt: recordedAt, completedAt: recordedAt })
  })

  it('keeps later times, null times and the rest of the observation unchanged', async () => {
    const { alignObservationToAttempt } = await import('@/lib/ediel/sources/documentReferenceCapture')
    const later = { status: 'unavailable', reason: 'timeout', byteCount: 0, startedAt: '2026-10-02T09:07:56.600Z', completedAt: '2026-10-02T09:08:06.600Z' }
    expect(alignObservationToAttempt(later, recordedAt)).toEqual(later)
    const mixed = { ...later, startedAt: '2026-10-02T09:07:56.500Z' }
    expect(alignObservationToAttempt(mixed, recordedAt)).toEqual({ ...later, startedAt: recordedAt })
    const none = { status: 'unavailable', startedAt: null, completedAt: null, byteCount: 0 }
    expect(alignObservationToAttempt(none, recordedAt)).toEqual(none)
    expect(alignObservationToAttempt(later, 'not-a-time')).toEqual(later)
  })
})
