import { describe, expect, it } from 'vitest'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { validateEdifactEnvelope } from '@/lib/ediel/core/edifactValidation'
import { EDIFACT_MESSAGE_REFERENCE_CONSTRAINTS } from '@/lib/ediel/core/edifactReferenceConstraints'
import { validateRulebookMessage } from '@/lib/ediel/rulebook/validator'
import { escapeEdifactValue } from '@/lib/ediel/core/edifactSerializer'

const profiles = EDIFACT_MESSAGE_REFERENCE_CONSTRAINTS.profiles.map(profile => profile.technicalProfile.join(':'))
const valid = 'OWN:A+B?C12345'
function encode(profile: string, reference = valid, alternate = false) {
  return EdifactEnvelopeCodec.encode({ sender: 'NETWORK', receiver: 'SUPPLIER', interchangeReference: 'ORIGINAL',
    environment: 'test', applicationReference: 'PRODAT', acknowledgementRequest: false,
    ...(alternate ? { una: { componentDataElementSeparator: '*', dataElementSeparator: ';', releaseCharacter: '!', segmentTerminator: '~' } } : {}),
    messages: [{ messageReference: reference, messageTypeToken: profile, businessSegments: ['BGM+++27'] }] })
}
function overlong(profile: string) {
  const raw = encode(profile, '12345678901234')
  return raw.replaceAll('12345678901234', '123456789012345')
}

describe('ENV-03 source-qualified UNH/UNT0062 decoded an14', () => {
  it.each(profiles)('holds a 15-character actual builder reference for %s', profile => {
    expect(() => encode(profile, '123456789012345')).toThrow('edifact_message_reference_length_invalid')
    expect(validateEdifactEnvelope(overlong(profile)).issues.filter(issue => issue.code === 'message_reference_length_invalid')).toHaveLength(2)
  })
  it.each(profiles)('accepts 14 decoded characters including escaped separators for %s', profile => {
    expect(valid.length).toBe(14)
    for (const alternate of [false, true]) expect(validateEdifactEnvelope(encode(profile, valid, alternate)).syntaxOk).toBe(true)
  })
  it('checks each physical message and its own UNT through the shared framing authority', () => {
    const raw = EdifactEnvelopeCodec.encode({ sender: 'NETWORK', receiver: 'SUPPLIER', interchangeReference: 'ORIGINAL',
      environment: 'test', acknowledgementRequest: false, messages: profiles.slice(0, 2).map((profile, index) => ({
        messageReference: String(index + 1), messageTypeToken: profile, businessSegments: ['BGM+++27'],
      })) })
    const altered = raw.replace('UNH+2+', 'UNH+123456789012345+').replace('UNT+3+2', 'UNT+3+123456789012345')
    expect(validateEdifactEnvelope(altered).issues.filter(issue => issue.code === 'message_reference_length_invalid')).toHaveLength(2)
  })
  it('checks an overlong UNT independently of mismatch and preserves both diagnostics', () => {
    const raw = encode(profiles[0], '1').replace('UNT+3+1', 'UNT+3+123456789012345')
    expect(validateEdifactEnvelope(raw).issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['message_reference_length_invalid', 'unt_unh_reference_mismatch']))
  })
  it('does not trim reference data or hide a long component behind scalar rejection', () => {
    const raw = encode(profiles[0], '12345678901234')
    expect(validateEdifactEnvelope(raw.replace('UNT+3+12345678901234', 'UNT+3+12345678901234 ')).issues.some(issue => issue.code === 'message_reference_length_invalid')).toBe(true)
    const malformed = raw.replace('UNH+12345678901234+', 'UNH+1:123456789012345+')
    expect(validateEdifactEnvelope(malformed).issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['envelope_reference_missing', 'message_reference_length_invalid']))
  })
  it('reaches actual raw manual/API validation without a source-registry lookup', () => {
    const result = validateRulebookMessage({ rawPayload: overlong('APERAK:D:96A:UN:E2SE6A'), family: 'APERAK', code: 'APERAK',
      direction: 'inbound', environment: 'test', companyId: '10000000-0000-4000-8000-000000000001', admissionAt: '2026-10-01T12:00:00Z', mode: 'parse' })
    expect(result.ok).toBe(false)
    expect(result.issues.some(issue => issue.code === 'message_reference_length_invalid' && issue.blocking)).toBe(true)
  })
  it('does not infer a CONTRL or unknown-profile length from another family', () => {
    expect(validateEdifactEnvelope(encode('CONTRL:2:2:UN:EDIEL2', '123456789012345')).issues.some(issue => issue.code === 'message_reference_length_invalid')).toBe(false)
  })
  it('counts decoded data rather than release characters in both reference positions', () => {
    const raw = encode(profiles[2], valid)
    expect(raw).toContain('UNH+' + escapeEdifactValue(valid) + '+')
    expect(validateEdifactEnvelope(raw).syntaxOk).toBe(true)
  })
})
