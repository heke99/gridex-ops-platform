// masterplan: ENV-01, AT-ENV-01
import { describe, expect, it } from 'vitest'
import { encodeEdifactLatin1, encodeOutboundEdifactInterchange } from '@/lib/ediel/core/edifactEncoding'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'

const envelope = (ftx: string) => ({ sender: '90001', receiver: '90002', interchangeReference: 'I1', applicationReference: '23-DDQ-PRODAT', environment: 'test' as const, acknowledgementRequest: true,
  messages: [{ messageReference: 'M1', messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A', businessSegments: ['BGM+Z03+DOC1+9', 'LOC+172+735999000000000017', `FTX+AAO+++${ftx}`] }] })

describe('ENV-01: UNOC:3 repertoire and actual ISO 8859-1 bytes', () => {
  it('on_pass: Latin-1 letters become their exact single ISO 8859-1 byte and separators are released per UNA before joining', () => {
    const raw = EdifactEnvelopeCodec.encode(envelope("Åsa Öberg ?+ Co?: 50% ???'"))
    expect(raw).toContain("UNB+UNOC:3+")
    expect(raw).toContain("FTX+AAO+++Åsa Öberg ?+ Co?: 50% ???'")
    const bytes = encodeEdifactLatin1(raw)
    expect(bytes.length).toBe(raw.length)
    expect(bytes.includes(Buffer.from([0xc5]))).toBe(true) // Å as one Latin-1 byte
    expect(bytes.includes(Buffer.from([0xc3, 0x85]))).toBe(false) // never the UTF-8 pair
    expect(bytes.toString('latin1')).toBe(raw)
  })
  it('on_pass: segment-separating CRLF between terminated segments is the only tolerated control', () => {
    const raw = EdifactEnvelopeCodec.encode(envelope('Ok'))
    const crlf = raw.replace(/'/g, "'\r\n")
    expect(encodeOutboundEdifactInterchange(crlf).toString('latin1')).toBe(crlf)
  })
  it('on_failure: characters outside ISO 8859-1 are detected, never masked as UNOC or replaced', () => {
    expect(() => EdifactEnvelopeCodec.encode(envelope('Łukasz €'))).toThrow(/edifact_character_not_iso8859_1:\d+:U\+0141/)
    expect(() => encodeOutboundEdifactInterchange("FTX+AAO+++€'")).toThrow('edifact_character_not_iso8859_1:10:U+20AC')
  })
  it.each([['NUL', '\u0000'], ['BEL', '\u0007'], ['TAB', '\t'], ['ESC', '\u001b'], ['DEL', '\u007f'], ['C1 NEL', '\u0085'], ['C1 CSI', '\u009b']])(
    'on_failure: %s inside segment data is outside the UNOC repertoire and stops serialisation', (_, control) => {
      expect(() => EdifactEnvelopeCodec.encode(envelope(`Kalle${control}Anka`))).toThrow(/edifact_character_not_unoc:\d+:U\+00[0-9A-F]{2}/)
      expect(() => encodeOutboundEdifactInterchange(`FTX+AAO+++Kalle${control}Anka'`)).toThrow('edifact_character_not_unoc:15:U+00')
    })
  it('on_failure: CR or LF inside segment data (not after a terminator) is rejected', () => {
    // Documented builder conversion (sanitizeSegment): line breaks in builder segments are removed, never sent.
    expect(EdifactEnvelopeCodec.encode(envelope('Rad1\r\nRad2'))).toContain("FTX+AAO+++Rad1Rad2'")
    expect(() => encodeOutboundEdifactInterchange("FTX+AAO+++Rad1?'\r\nRad2'")).toThrow('edifact_character_not_unoc:16:U+000D')
    expect(() => encodeOutboundEdifactInterchange("FTX+AAO+++Rad1\nRad2'")).toThrow('edifact_character_not_unoc:14:U+000A')
  })
  it('prohibited: the error never echoes source content and customer identifiers are never truncated', () => {
    let message = ''
    try { encodeOutboundEdifactInterchange("NAD+DP+++Hemlig\u0001Kund'") } catch (error) { message = String((error as Error).message) }
    expect(message).toMatch(/^edifact_character_not_unoc:15:U\+0001$/)
    expect(message).not.toContain('Hemlig')
    const id = '735999000000000017'
    const raw = EdifactEnvelopeCodec.encode(envelope('Ok'))
    expect(encodeEdifactLatin1(raw).toString('latin1')).toContain(`LOC+172+${id}'`)
  })
})
