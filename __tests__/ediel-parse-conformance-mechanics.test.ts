// reality-defects: J4 parse conformance — EDIFACT mechanics (UNA, release character, ÅÄÖ/UNOC, empty and trailing elements, segment counts)
//
// Every expectation below is written from the syntax rules (ISO 9735 / Ediel T24-A-6, masterplan ENV-01/ENV-02/ENV-03,
// docs/ediel/masterplan-v2/registers/rules.json), never from the parser's own output. Synthetic data only.
import { describe, expect, it } from 'vitest'
import { parseCanonicalEdifactAst } from '@/lib/ediel/core/canonicalEdifactAst'
import { parseEdifact } from '@/lib/ediel/core/edifactParser'
import { segmentComposite, segmentElementCount, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { countEdifactMessageSegments } from '@/lib/ediel/core/segmentCounter'
import { escapeEdifactData, parseUna } from '@/lib/ediel/core/una'
import { parseEdifactPayload } from '@/lib/inbound-mail/edielEmailParser'
import { splitMimeParts } from '@/lib/inbound-mail/edielMailboxPoller.part-1'
import { decodeTextBytes } from '@/lib/inbound-mail/mimeCharset'

/** A UNA-built interchange: segments are given with the default separators and re-written into the target UNA. */
function interchange(una: { component: string; element: string; decimal: string; release: string; terminator: string }, segments: string[]) {
  const head = `UNA${una.component}${una.element}${una.decimal}${una.release} ${una.terminator}`
  return head + segments.join(una.terminator) + una.terminator
}

describe('J4 mechanics — UNA service string advice', () => {
  const CASES = [
    { name: 'default', una: { component: ':', element: '+', decimal: '.', release: '?', terminator: "'" } },
    { name: 'semicolon/star/bang', una: { component: ';', element: '*', decimal: ',', release: '#', terminator: '!' } },
    { name: 'pipe/tilde/apostrophe-free', una: { component: '|', element: '~', decimal: '.', release: '\\', terminator: '^' } },
  ]
  for (const { name, una } of CASES) {
    it(`${name}: every separator and the release character come from UNA, not from defaults`, () => {
      const c = una.component, e = una.element, r = una.release
      // A free text that contains every OTHER interchange's service characters literally and this
      // interchange's own service characters escaped with its own release character.
      const literal = `Ångström ${c} ${e} ${una.terminator} ${r} + : ' ?`
      const escaped = escapeEdifactData(literal, { ...parseUna(null), componentDataElementSeparator: c, dataElementSeparator: e,
        releaseCharacter: r, segmentTerminator: una.terminator, decimalMark: una.decimal, repetitionSeparator: ' ', raw: '' })
      const raw = interchange(una, [
        `UNB${e}UNOC${c}3${e}16700${c}14${e}7359990000002${c}14${e}261022${c}1200${e}REF1${e}${e}23-DDQ-PRODAT`,
        `UNH${e}M1${e}APERAK${c}D${c}96A${c}UN${c}E2SE6A`,
        `BGM${e}${e}${e}34`,
        `FTX${e}AAO${e}${e}105${c}${c}260${e}${escaped}`,
        `UNT${e}4${e}M1`,
        `UNZ${e}1${e}REF1`,
      ])
      const wire = tokenizeEdifact(raw)
      expect(wire.una).toMatchObject({ componentDataElementSeparator: c, dataElementSeparator: e, decimalMark: una.decimal, releaseCharacter: r, segmentTerminator: una.terminator })
      expect(wire.segments.map(s => s.tag)).toEqual(['UNB', 'UNH', 'BGM', 'FTX', 'UNT', 'UNZ'])
      const ftx = wire.segments[3]
      expect(segmentComposite(ftx, 1, wire.una)).toEqual(['AAO'])
      expect(segmentComposite(ftx, 2, wire.una)).toEqual([''])
      expect(segmentComposite(ftx, 3, wire.una)).toEqual(['105', '', '260'])
      expect(segmentComposite(ftx, 4, wire.una)).toEqual([literal])
      expect(segmentComposite(wire.segments[0], 2, wire.una)).toEqual(['16700', '14'])
      // UNT counts UNH..UNT inclusive.
      expect(countEdifactMessageSegments(raw)).toMatchObject({ declaredUntCount: 4, actualUntCount: 4, ok: true, messageReference: 'M1' })
      // The mail-surface parser keeps the decoded text and the coded C107 reference apart.
      const parsed = parseEdifactPayload(raw)
      expect(parsed).toMatchObject({ messageFamily: 'APERAK', senderEdielId: '16700', receiverEdielId: '7359990000002', interchangeReference: 'REF1',
        applicationReference: '23-DDQ-PRODAT', messageFunctionCode: '34' })
      expect(parsed.freeText).toEqual([literal])
      expect(parsed.freeTextEntries).toEqual([{ qualifier: 'AAO', code: '105', text: literal }])
    })
  }
})

describe('J4 mechanics — release character', () => {
  const TABLE: Array<{ wire: string; decoded: string; why: string }> = [
    { wire: 'O??Brien', decoded: 'O?Brien', why: 'escaped release character' },
    { wire: "O?'Brien", decoded: "O'Brien", why: 'escaped segment terminator' },
    { wire: 'A?+B', decoded: 'A+B', why: 'escaped data element separator' },
    { wire: 'A?:B', decoded: 'A:B', why: 'escaped component separator' },
    { wire: 'Varför??', decoded: 'Varför?', why: 'escaped release at the end of a component' },
    { wire: '??', decoded: '?', why: 'only an escaped release' },
    { wire: '?+0100', decoded: '+0100', why: 'DTM+735 UTC offset sign' },
  ]
  for (const row of TABLE) {
    it(`${row.why}: ${row.wire} -> ${row.decoded}`, () => {
      const raw = `UNA:+.? 'UNB+UNOC:3+1:14+2:14+261022:1200+R'UNH+1+APERAK:D:96A:UN:E2SE6A'FTX+AAO+++${row.wire}:second'RFF+LI:${row.wire}'UNT+4+1'UNZ+1+R'`
      const wire = tokenizeEdifact(raw)
      const ftx = wire.segments.find(s => s.tag === 'FTX')!
      expect(segmentComposite(ftx, 4, wire.una)).toEqual([row.decoded, 'second'])
      const rff = wire.segments.find(s => s.tag === 'RFF')!
      expect(segmentComposite(rff, 1, wire.una)).toEqual(['LI', row.decoded])
      // The mail parser decodes exactly once (J4-D1: it used to decode twice and threw or dropped characters).
      const parsed = parseEdifactPayload(raw)
      expect(parsed.freeText).toEqual([`${row.decoded} second`])
      expect(parsed.references.LI).toEqual([row.decoded])
    })
  }

  it('a release character never counts as a separator: element counts and trailing empty elements are exact', () => {
    const raw = "UNA:+.? 'UNB+UNOC:3+1:14+2:14+261022:1200+R'UNH+1+PRODAT:D:97A:UN:E2SE6A'NAD+UD+1?+2:SE2:260++Åsa?:s:Ö?'berg+Gata 1::Lgh 3+Ort++12345+SE'NAD+Z02+99876:160:SVK+++++++'UNT+4+1'UNZ+1+R'"
    const wire = tokenizeEdifact(raw)
    const [ud, z02] = wire.segments.filter(s => s.tag === 'NAD')
    expect(segmentElementCount(ud, wire.una)).toBe(9)
    expect(segmentComposite(ud, 2, wire.una)).toEqual(['1+2', 'SE2', '260'])
    expect(segmentComposite(ud, 3, wire.una)).toEqual([''])
    expect(segmentComposite(ud, 4, wire.una)).toEqual(['Åsa:s', "Ö'berg"])
    expect(segmentComposite(ud, 5, wire.una)).toEqual(['Gata 1', '', 'Lgh 3'])
    expect(segmentComposite(ud, 6, wire.una)).toEqual(['Ort'])
    expect(segmentComposite(ud, 7, wire.una)).toEqual([''])
    expect(segmentComposite(ud, 8, wire.una)).toEqual(['12345'])
    expect(segmentComposite(ud, 9, wire.una)).toEqual(['SE'])
    // Seven trailing empty data elements are still eight separators after the qualifier.
    expect(segmentElementCount(z02, wire.una)).toBe(9)
    expect(segmentComposite(z02, 9, wire.una)).toEqual([''])
  })

  it('an escaped segment terminator inside text is not a segment boundary (UNT count stays exact)', () => {
    const raw = "UNA:+.? 'UNB+UNOC:3+1:14+2:14+261022:1200+R'UNH+1+APERAK:D:96A:UN:E2SE6A'BGM+++27'FTX+AAO+++Kundens adress?'s gata'ERC+40::260'UNT+5+1'UNZ+1+R'"
    expect(tokenizeEdifact(raw).segments.map(s => s.tag)).toEqual(['UNB', 'UNH', 'BGM', 'FTX', 'ERC', 'UNT', 'UNZ'])
    expect(countEdifactMessageSegments(raw)).toMatchObject({ declaredUntCount: 5, actualUntCount: 5, ok: true })
    expect(countEdifactMessageSegments(raw.replace('UNT+5+1', 'UNT+6+1'))).toMatchObject({ declaredUntCount: 6, actualUntCount: 5, ok: false })
  })

  it('a dangling release character at the end of the interchange is rejected, never silently dropped', () => {
    expect(() => tokenizeEdifact("UNB+UNOC:3+1:14+2:14+261022:1200+R'FTX+AAO+++text?")).toThrow('edifact_dangling_release_character')
  })
})

describe('J4 mechanics — BGM code with a custom UNA (J4-D9, fixed)', () => {
  it('parseEdifact reads BGM/C002/1001 with the interchange component separator', () => {
    const raw = "UNA;*.# !UNB*UNOC;3*16700;14*40000;14*261022;0600*R1**23-DDQ-E66-T!UNH*1*UTILTS;D;02B;UN;E5SE5A!BGM*E66;;260*M1*9*AB!UNT*3*1!UNZ*1*R1!"
    const parsed = parseEdifact(raw)
    expect(parsed.messageFamily).toBe('UTILTS')
    expect(parsed.businessCode).toBe('E66')
    expect(parseCanonicalEdifactAst(raw).messages[0]).toMatchObject({ family: 'UTILTS', messageCode: 'E66', documentReference: 'M1' })
  })
})

describe('J4 mechanics — Swedish characters through the real MIME decoder', () => {
  const NAME = 'Åsa Öberg-Ärlig'
  const STREET = 'Ängsvägen 1, Övre Älvsjö'
  const edifact = (syntax: string, una = "UNA:+.? '", element = '+') => [una,
    `UNB${element}${syntax}:3${element}16700:14${element}40000:14${element}261022:1200${element}R1${element}${element}23-DDQ-PRODAT'`,
    `UNH${element}1${element}PRODAT:D:97A:UN:E2SE6A'`, `BGM${element}Z06${element}D1${element}9${element}AB'`,
    `NAD${element}UD${element}199001011234:SE2:260${element}${element}${NAME}${element}${STREET}${element}Göteborg${element}${element}41101${element}SE'`,
    `UNT${element}4${element}1'`, `UNZ${element}1${element}R1'`].join('')
  const mail = (body: Buffer, contentType: string, transfer: 'base64' | 'quoted-printable') => {
    const encoded = transfer === 'base64' ? body.toString('base64').replace(/.{76}/g, '$&\r\n')
      : [...body].map(b => (b >= 0x21 && b <= 0x7e && b !== 0x3d) ? String.fromCharCode(b) : `=${b.toString(16).toUpperCase().padStart(2, '0')}`).join('')
    return Buffer.from(`From: dso@example.invalid\r\nTo: platform@example.invalid\r\nSubject: J4\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="b1"\r\n\r\n--b1\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nEdiel\r\n--b1\r\nContent-Type: ${contentType}\r\nContent-Transfer-Encoding: ${transfer}\r\nContent-Disposition: attachment; filename="z06.edi"\r\n\r\n${encoded}\r\n--b1--\r\n`, 'latin1')
  }
  const TABLE = [
    { name: 'UNOC ISO-8859-1 bytes, no MIME charset, base64', syntax: 'UNOC', encoding: 'latin1' as const, contentType: 'application/EDIFACT', transfer: 'base64' as const },
    { name: 'UNOC ISO-8859-1 bytes, MIME charset utf-8 (mislabelled), base64: UNB wins', syntax: 'UNOC', encoding: 'latin1' as const, contentType: 'application/EDIFACT; charset=utf-8', transfer: 'base64' as const },
    { name: 'UNOC ISO-8859-1 bytes, quoted-printable', syntax: 'UNOC', encoding: 'latin1' as const, contentType: 'application/EDIFACT', transfer: 'quoted-printable' as const },
    { name: 'UNOB ISO-8859-1 bytes, base64', syntax: 'UNOB', encoding: 'latin1' as const, contentType: 'application/EDIFACT', transfer: 'base64' as const },
    { name: 'UNOW UTF-8 bytes, MIME charset iso-8859-1 (mislabelled): UNB wins', syntax: 'UNOW', encoding: 'utf8' as const, contentType: 'application/EDIFACT; charset=iso-8859-1', transfer: 'base64' as const },
  ]
  for (const row of TABLE) {
    it(row.name, () => {
      const text = edifact(row.syntax)
      const parsed = splitMimeParts(mail(Buffer.from(text, row.encoding), row.contentType, row.transfer))
      expect(parsed.rawEdifactPayload).toBe(text)
      const payload = parseEdifactPayload(parsed.rawEdifactPayload!)
      expect(payload.messageTypeVersion.syntaxIdentifier).toBe(row.syntax)
      const wire = tokenizeEdifact(parsed.rawEdifactPayload!)
      const nad = wire.segments.find(s => s.tag === 'NAD')!
      expect(segmentComposite(nad, 4, wire.una)).toEqual([NAME])
      expect(segmentComposite(nad, 5, wire.una)).toEqual([STREET])
      expect(segmentComposite(nad, 6, wire.una)).toEqual(['Göteborg'])
    })
  }

  it('UNOC bytes decode losslessly to the same text without any MIME charset', () => {
    const text = edifact('UNOC')
    expect(decodeTextBytes(Buffer.from(text, 'latin1'))).toBe(text)
  })
})
