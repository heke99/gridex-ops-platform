import { describe, expect, it } from 'vitest'
import { certificateMessageScopeBlocker } from '@/lib/ediel/certificateScope'
import { evaluateProductionTransportSecurity } from '@/lib/ediel/config'
import { resolveRouteTransportSecurityMode } from '@/lib/ediel/partyRegistry'

describe('Ediel route transport security resolution', () => {
  it('prefers an explicit verified transport-security policy', () => {
    expect(resolveRouteTransportSecurityMode({ transportSecurityMode: 'required_encrypted', encryptionMode: 'none' })).toBe('required_encrypted')
  })

  it('uses persisted S/MIME encryption as the safe legacy/materialized fallback', () => {
    expect(resolveRouteTransportSecurityMode({ transportSecurityMode: null, encryptionMode: 'smime' })).toBe('encrypted')
  })

  it('uses explicit unencrypted encryption state as the legacy/materialized fallback', () => {
    expect(resolveRouteTransportSecurityMode({ transportSecurityMode: null, encryptionMode: 'none' })).toBe('unencrypted')
  })

  it('does not treat a transport protocol such as smtp_imap as a security policy', () => {
    expect(resolveRouteTransportSecurityMode({ transportSecurityMode: null, encryptionMode: null })).toBe('needs_verification')
  })

  it('fails closed for an unknown explicit security policy instead of falling through to encryption', () => {
    expect(resolveRouteTransportSecurityMode({ transportSecurityMode: 'smtp_imap', encryptionMode: 'smime' })).toBe('needs_verification')
  })

  it('accepts Mariam-style materialized production PRODAT S/MIME runtime', () => {
    const result = evaluateProductionTransportSecurity({
      runtime: {
        environment: 'production',
        message_standard: 'edifact',
        message_family: 'PRODAT',
        transport_security_mode: null,
        encryption_mode: 'smime',
        certificate_id: '469468a2-ce02-4f7f-8c28-db04ad22e300',
        allow_unencrypted_production: false,
        allow_unencrypted_production_expires_at: null,
        allow_unencrypted_production_reason: null,
      },
      messageFamily: 'PRODAT',
    })
    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
  })
})

describe('Ediel recipient certificate message scope', () => {
  it('accepts the production registry shape where PRODAT is duplicated into message_type', () => {
    expect(certificateMessageScopeBlocker(
      { message_family: 'PRODAT', message_type: 'PRODAT' },
      { message_family: 'PRODAT', message_code: 'Z01' },
    )).toBeNull()
  })

  it('accepts a family-only legacy materialization when message_family is missing', () => {
    expect(certificateMessageScopeBlocker(
      { message_family: null, message_type: 'PRODAT' },
      { message_family: 'PRODAT', message_code: 'Z01' },
    )).toBeNull()
  })

  it('accepts a genuinely code-scoped certificate when the code matches', () => {
    expect(certificateMessageScopeBlocker(
      { message_family: 'PRODAT', message_type: 'Z01' },
      { message_family: 'PRODAT', message_code: 'Z01' },
    )).toBeNull()
  })

  it('fails closed when a genuinely code-scoped certificate targets another PRODAT code', () => {
    expect(certificateMessageScopeBlocker(
      { message_family: 'PRODAT', message_type: 'Z03' },
      { message_family: 'PRODAT', message_code: 'Z01' },
    )).toBe('receiver_certificate_message_code_mismatch')
  })

  it('fails closed when the certificate family targets another message family', () => {
    expect(certificateMessageScopeBlocker(
      { message_family: 'UTILTS', message_type: 'UTILTS' },
      { message_family: 'PRODAT', message_code: 'Z01' },
    )).toBe('receiver_certificate_message_family_mismatch')
  })
})
