import { describe, expect, it } from 'vitest'
import { resolveRouteTransportSecurityMode } from '@/lib/ediel/sendContextConsistency'

describe('Ediel route transport security resolution', () => {
  it('prefers an explicit verified transport-security policy', () => {
    expect(resolveRouteTransportSecurityMode({
      transportSecurityMode: 'required_encrypted',
      encryptionMode: 'none',
    })).toBe('required_encrypted')
  })

  it('uses persisted S/MIME encryption as the safe legacy/materialized fallback', () => {
    expect(resolveRouteTransportSecurityMode({
      transportSecurityMode: null,
      encryptionMode: 'smime',
    })).toBe('encrypted')
  })

  it('uses explicit unencrypted encryption state as the legacy/materialized fallback', () => {
    expect(resolveRouteTransportSecurityMode({
      transportSecurityMode: null,
      encryptionMode: 'none',
    })).toBe('unencrypted')
  })

  it('does not treat a transport protocol such as smtp_imap as a security policy', () => {
    expect(resolveRouteTransportSecurityMode({
      transportSecurityMode: null,
      encryptionMode: null,
    })).toBe('needs_verification')
  })

  it('fails closed for an unknown explicit security policy instead of falling through to encryption', () => {
    expect(resolveRouteTransportSecurityMode({
      transportSecurityMode: 'smtp_imap',
      encryptionMode: 'smime',
    })).toBe('needs_verification')
  })
})
