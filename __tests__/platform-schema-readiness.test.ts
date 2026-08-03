import { describe, expect, it } from 'vitest'
import {
  evaluatePlatformSchemaReadiness,
  isVerifiedSchemaFingerprint,
} from '@/lib/platform/schemaReadiness'

describe('platform schema readiness', () => {
  const fingerprintA = 'a'.repeat(64)
  const fingerprintB = 'b'.repeat(64)

  it('accepts any verified capability fingerprint when the versioned view is ready', () => {
    expect(
      evaluatePlatformSchemaReadiness({
        is_ready: true,
        schema_fingerprint: fingerprintA,
        blocking_issues: [],
      }),
    ).toEqual({
      ready: true,
      schemaFingerprintVerified: true,
      blockingIssuesVerified: true,
    })

    expect(
      evaluatePlatformSchemaReadiness({
        is_ready: true,
        schema_fingerprint: fingerprintB,
        blocking_issues: [],
      }),
    ).toEqual({
      ready: true,
      schemaFingerprintVerified: true,
      blockingIssuesVerified: true,
    })
  })

  it('fails closed when capability blockers exist or contradict is_ready', () => {
    expect(
      evaluatePlatformSchemaReadiness({
        is_ready: false,
        schema_fingerprint: fingerprintA,
        blocking_issues: ['RUNTIME_COLUMN_MISSING'],
      }).ready,
    ).toBe(false)

    expect(
      evaluatePlatformSchemaReadiness({
        is_ready: true,
        schema_fingerprint: fingerprintA,
        blocking_issues: ['INCONSISTENT_READINESS_ROW'],
      }),
    ).toEqual({
      ready: false,
      schemaFingerprintVerified: true,
      blockingIssuesVerified: false,
    })
  })

  it('fails closed when the fingerprint evidence is absent or malformed', () => {
    expect(isVerifiedSchemaFingerprint(null)).toBe(false)
    expect(isVerifiedSchemaFingerprint('not-a-sha256')).toBe(false)
    expect(
      evaluatePlatformSchemaReadiness({
        is_ready: true,
        schema_fingerprint: 'not-a-sha256',
        blocking_issues: [],
      }).ready,
    ).toBe(false)
  })
})
