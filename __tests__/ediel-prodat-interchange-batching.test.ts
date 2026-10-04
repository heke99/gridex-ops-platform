// masterplan: ENV-07, AT-ENV-07
import { describe, expect, it } from 'vitest'
import { EdifactEnvelopeCodec, type EdifactEnvelopeMessageInput } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { preflightEdielPayload } from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import { validateEdifactEnvelope } from '@/lib/ediel/core/edifactValidation'
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { prodatInterchangeBatchIssues } from '@/lib/ediel/prodat/prodatInterchangeBatch'

const message = (reference: string, code: string, extra: string[] = []): EdifactEnvelopeMessageInput => ({
  messageReference: reference, messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A',
  businessSegments: [`BGM+${code}+DOC-${reference}+9+AB`, 'DTM+137:202610011200:203', 'DTM+ZZZ:1:805',
    'NAD+FR+11111:160:SVK', 'NAD+DO+22222:160:SVK', 'LIN+1++735999999999999999:::9', ...extra],
})
const encode = (messages: EdifactEnvelopeMessageInput[], customUna = false) => EdifactEnvelopeCodec.encode({
  sender: '11111', receiver: '22222', interchangeReference: 'INTERCHANGE', applicationReference: '23-DDQ-PRODAT',
  acknowledgementRequest: true, environment: 'test', createdAt: new Date('2026-10-01T12:00:00Z'), messages,
  ...(customUna ? { una: { componentDataElementSeparator: '^', dataElementSeparator: ';', releaseCharacter: '!', segmentTerminator: '~' } } : {}),
})

/** Independently assembled wire bypasses the encoder so preflight must own its
 * own protection. These fixtures exercise internal consumers, never traffic. */
function physical(messages: EdifactEnvelopeMessageInput[]): string {
  return "UNA:+.? 'UNB+UNOC:3+11111:ZZ+22222:ZZ+261001:1400+INTERCHANGE++23-DDQ-PRODAT++1++++1'" +
    messages.map(m => [`UNH+${m.messageReference}+${m.messageTypeToken}`, ...m.businessSegments,
      `UNT+${m.businessSegments.length + 2}+${m.messageReference}`].join("'") + "'").join('') +
    `UNZ+${messages.length}+INTERCHANGE'`
}

describe('ENV-07 physical PRODAT function batching at actual encode and send preflight', () => {
  it('refuses mixed Z03/Z08 before the encoder returns any interchange bytes', () => {
    expect(() => encode([message('M1', 'Z03'), message('M2', 'Z08')])).toThrow('PRODAT_BATCH_FUNCTION_MIXED')
  })

  it('holds a bypassed mixed-function wire in actual send preflight without inventing syntax failure', () => {
    const raw = physical([message('M1', 'Z03'), message('M2', 'Z08')])
    expect(validateEdifactEnvelope(raw).syntaxOk).toBe(true)
    const result = preflightEdielPayload({ rawPayload: raw, messageStandard: 'edifact', mode: 'send' })
    expect(result.blocking).toBe(true)
    expect(result.issues.some(i => i.code === 'PRODAT_BATCH_FUNCTION_MIXED')).toBe(true)
  })

  it('encodes compatible same-function objects with exact individual counts and references', () => {
    const raw = encode([message('M1', 'Z03'), message('M2', 'Z03')])
    expect(validateEdifactEnvelope(raw).syntaxOk).toBe(true)
    expect(raw).toContain("UNH+M1+PRODAT:D:97A:UN:E2SE6A'")
    expect(raw).toContain("UNH+M2+PRODAT:D:97A:UN:E2SE6A'")
    expect(raw).toContain("UNZ+2+INTERCHANGE'")
  })

  it('keeps subtype outside the main-function comparison specified by P26.A page14', () => {
    expect(() => encode([message('M1', 'Z03', ['CCI++Z13', 'CAV+Z22']),
      message('M2', 'Z03', ['CCI++Z13', 'CAV+Z01'])])).not.toThrow()
  })

  it.each(['profile', 'legal actor', 'legal role', 'missing party', 'family'])('refuses incompatible %s independently of common BGM function', kind => {
    const first = message('M1', 'Z03'), second = message('M2', 'Z03')
    if (kind === 'profile') second.messageTypeToken = 'PRODAT:D:97A:UN:E2SE5A'
    if (kind === 'legal actor') second.businessSegments = second.businessSegments.map(s => s.replace('22222:160:SVK', '33333:160:SVK'))
    if (kind === 'legal role') second.businessSegments = second.businessSegments.map(s => s.replace('NAD+DO+', 'NAD+MS+'))
    if (kind === 'missing party') second.businessSegments = second.businessSegments.filter(s => !s.startsWith('NAD+DO+'))
    if (kind === 'family') second.messageTypeToken = 'APERAK:D:96A:UN:E2SE6A'
    expect(() => encode([first, second])).toThrow(/PRODAT_BATCH_/)
  })

  it('checks original custom UNA boundaries while released values cannot inject another BGM', () => {
    expect(() => encode([message('M1', 'Z03', ["FTX+AAO+++literal ?'BGM?+Z08"]),
      message('M2', 'Z03')], true)).not.toThrow()
    expect(() => encode([message('M1', 'Z03'), message('M2', 'Z08')], true)).toThrow('PRODAT_BATCH_FUNCTION_MIXED')
  })

  it('leaves generic non-PRODAT multi-message serialization available', () => {
    const generic = message('M1', 'Z03')
    generic.messageTypeToken = 'ORDERS:D:96A:UN'
    const other = { ...generic, messageReference: 'M2', businessSegments: ['BGM+220+ORDER2+9'] }
    expect(validateEdifactEnvelope(encode([generic, other])).syntaxOk).toBe(true)
  })

  it('keeps all compatible objects and physical header roles without promoting object-level parties', () => {
    const first = message('M1', 'Z03', ['NAD+UD+CUSTOMER-A::89', 'LIN+2++POINT-B:::89', 'NAD+UD+CUSTOMER-B::89'])
    const second = message('M2', 'Z03', ['NAD+UD+CUSTOMER-C::89'])
    // Header-party order has no bearing on the common actor/role identity.
    second.businessSegments.splice(3, 2, 'NAD+DO+22222:160:SVK', 'NAD+FR+11111:160:SVK')
    const input = structuredClone([first, second])
    const raw = encode(input)
    const tokens = tokenizeEdifact(raw)
    expect(prodatInterchangeBatchIssues(tokens)).toEqual([])
    expect(tokens.segments.filter(s => s.tag === 'BGM').map(s => segmentComposite(s, 1, tokens.una)[0])).toEqual(['Z03', 'Z03'])
    expect(tokens.segments.filter(s => s.tag === 'LIN').map(s => segmentComposite(s, 3, tokens.una)[0])).toEqual(['735999999999999999', 'POINT-B', '735999999999999999'])
    expect(input).toEqual([first, second])
  })

  it.each([
    ['changed sender', 'PRODAT_BATCH_PARTY_SCOPE_MIXED', 'NAD+FR+11111:160:SVK', 'NAD+FR+33333:160:SVK'],
    ['changed party agency', 'PRODAT_BATCH_PARTY_SCOPE_MIXED', 'NAD+DO+22222:160:SVK', 'NAD+DO+22222:160:OTHER'],
    ['reversed roles', 'PRODAT_BATCH_PARTY_SCOPE_MIXED', 'NAD+FR+11111:160:SVK', 'NAD+FR+22222:160:SVK'],
    ['missing main function', 'PRODAT_BATCH_FUNCTION_UNDETERMINED', 'BGM+Z03+DOC-M2+9+AB', 'BGM++DOC-M2+9+AB'],
    ['object BGM cannot repair header', 'PRODAT_BATCH_FUNCTION_UNDETERMINED', 'BGM+Z03+DOC-M2+9+AB', 'FTX+AAO+++NO-HEADER-BGM'],
  ])('holds %s at encoder and independent send preflight with its own physical cause', (_name, code, original, replacement) => {
    const second = message('M2', 'Z03', ['BGM+Z03+OBJECT-DOCUMENT+9+AB'])
    second.businessSegments = second.businessSegments.map(s => s === original ? replacement : s)
    const input = [message('M1', 'Z03'), second]
    const prior = structuredClone(input)
    expect(() => encode(input)).toThrow(code)
    const result = preflightEdielPayload({ rawPayload: physical(input), messageStandard: 'edifact', mode: 'send' })
    expect(result.blocking).toBe(true)
    expect(result.issues.filter(i => i.code.startsWith('PRODAT_BATCH_')).map(i => i.code)).toEqual([code])
    expect(input).toEqual(prior)
  })

  it('does not borrow a legal recipient from an object or sibling when the own header party is absent', () => {
    const second = message('M2', 'Z03', ['NAD+DO+22222:160:SVK'])
    second.businessSegments = second.businessSegments.filter((s, index) => index !== 4)
    expect(() => encode([message('M1', 'Z03'), second])).toThrow('PRODAT_BATCH_PARTY_SCOPE_UNDETERMINED')
    const result = preflightEdielPayload({ rawPayload: physical([message('M1', 'Z03'), second]), messageStandard: 'edifact', mode: 'send' })
    expect(result.issues.filter(i => i.code.startsWith('PRODAT_BATCH_')).map(i => i.code)).toEqual(['PRODAT_BATCH_PARTY_SCOPE_UNDETERMINED'])
  })
})
