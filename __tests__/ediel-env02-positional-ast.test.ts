// masterplan: ENV-02, AT-ENV-02
import { describe, expect, it } from 'vitest'
import { canonicalMessageFacts, parseCanonicalEdifactAst } from '@/lib/ediel/core/canonicalEdifactAst'
import { segmentComposite, segmentOriginalRaw, segmentSourceSpan, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { validateEdifactEnvelope } from '@/lib/ediel/core/edifactValidation'
import { validateFieldMatrixPayload } from '@/lib/ediel/rulebook/fieldMatrix'
import { canonicalProdat26AFieldRules } from '@/lib/ediel/prodat/prodat26AFieldMatrix'

// T24-A-6 §4.1: UNA selects structure; releasing a service character adds no
// logical data length. Source literals below keep all C889 positions, including
// omissions. This fixture is not national grammar/market acceptance evidence.
const alphabets = [
  { component: ':', element: '+', release: '?', terminator: "'" },
  { component: '*', element: ';', release: '!', terminator: '~' },
  { component: '^', element: '|', release: '!', terminator: '%' },
] as const
type Alphabet = typeof alphabets[number]
type Parts = readonly (string | readonly string[])[]
function wire(parts: Parts, alphabet: Alphabet): string {
  const escape = (value: string) => [...value].map(char =>
    [alphabet.component, alphabet.element, alphabet.release, alphabet.terminator].some(service => service === char)
      ? alphabet.release + char : char).join('')
  return parts.map(part => typeof part === 'string' ? escape(part) : part.map(escape).join(alphabet.component)).join(alphabet.element)
}
function payload(body: readonly Parts[], alphabet: Alphabet, family = 'UTILTS'): string {
  return `UNA${alphabet.component}${alphabet.element}.${alphabet.release} ${alphabet.terminator}` + [
    ['UNB', ['UNOC', '3'], 'SENDER', 'RECEIVER', ['261004', '1200'], 'I'],
    ['UNH', 'M', [family, 'D', family === 'PRODAT' ? '97A' : '96A', 'UN', family === 'PRODAT' ? 'E2SE6A' : 'E5SE5A']],
    ['BGM', family === 'PRODAT' ? 'Z04' : 'E66', 'DOC', '9'],
    ...body, ['UNT', String(body.length + 3), 'M'], ['UNZ', '1', 'I'],
  ].map(parts => wire(parts as Parts, alphabet)).join(alphabet.terminator) + alphabet.terminator
}

for (const alphabet of alphabets) describe(`ENV-02 ${alphabet.component}${alphabet.element}${alphabet.release}${alphabet.terminator}`, () => {
  it('retains omitted CAV positions and literal service characters through render and parse', () => {
    const raw = EdifactEnvelopeCodec.encode({ sender: 'SENDER', receiver: 'RECEIVER', interchangeReference: 'I', environment: 'test', acknowledgementRequest: false,
      una: { componentDataElementSeparator: alphabet.component, dataElementSeparator: alphabet.element, releaseCharacter: alphabet.release, segmentTerminator: alphabet.terminator },
      messages: [{ messageReference: 'M', messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A',
        businessSegments: ["CCI++Z14", "CAV+:::9:PRODUCT?+?:???'", "FTX+AAO+++A::B:"] }],
    })
    const ast = parseCanonicalEdifactAst(raw)
    expect(segmentComposite(ast.segments.find(token => token.tag === 'CAV'), 1, ast.una)).toEqual(['', '', '', '9', "PRODUCT+:?'"])
    expect(segmentComposite(ast.segments.find(token => token.tag === 'FTX'), 4, ast.una)).toEqual(['A', '', 'B', ''])
    expect(ast.segments.map(token => token.index)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(validateEdifactEnvelope(raw).syntaxOk).toBe(true)
  })

  it.each([
    { name: 'fourth and fifth populated', components: ['', '', '', '9', 'VALUE'] },
    { name: 'second populated', components: ['', 'VALID'] },
    { name: 'all omitted', components: ['', '', ''] },
  ])('does not promote a later CAV component to the missing first slot ($name)', ({ components }) => {
    const raw = payload([['LIN', '1', '', 'OBJECT'], ['CCI', '', 'Z13'], ['CAV', components]], alphabet)
    const ast = parseCanonicalEdifactAst(raw)
    const cav = ast.segments.find(token => token.tag === 'CAV')!
    expect(segmentComposite(cav, 1, ast.una)).toEqual(components)
    expect(ast.messages[0].lineGroups[0].cciCavCodes.Z13).toBeUndefined()
    expect(canonicalMessageFacts(raw).cciCavCodes.Z13).toBeUndefined()
  })

  it('decodes the actual first CAV value once and keeps later positions separate', () => {
    const value = `OWN${alphabet.component}${alphabet.element}${alphabet.release}${alphabet.terminator}`
    const raw = payload([['LIN', '1', '', 'OBJECT'], ['CCI', '', 'Z13'], ['CAV', [value, '', 'SECOND']]], alphabet)
    expect(canonicalMessageFacts(raw).cciCavCodes.Z13).toEqual([value])
  })

  it('preserves physical PRODAT objects/registers and original spans without relabelling later registers', () => {
    const body: Parts[] = [
      ['LIN', '1', '', ['A:local', '', '', '89'], ['1', '1']], ['QTY', ['31', '10', 'KWH']],
      ['LIN', '2', '', ['A:local', '', '', '89'], ['1', '2']], ['QTY', ['31', '20', 'KWH']],
      ['LIN', '3', '', ['B:local', '', '', '89']], ['QTY', ['31', '30', 'KWH']],
    ]
    const raw = payload(body, alphabet, 'PRODAT')
    const ast = parseCanonicalEdifactAst(raw)
    expect(ast.messages[0].lineGroups).toMatchObject([
      { lineNumber: '1', itemId: 'A:local', registerIndex: '1', registerCount: 2, registerPosition: 1, firstLineIndex: 0, validRegisterChain: true },
      { lineNumber: '2', itemId: 'A:local', registerIndex: '2', registerCount: 2, registerPosition: 2, firstLineIndex: 0, validRegisterChain: true },
      { lineNumber: '3', itemId: 'B:local', registerIndex: null, registerCount: 1, registerPosition: 1, firstLineIndex: 2, validRegisterChain: true },
    ])
    expect(ast.messages[0].lineGroups.map(group => group.segments.map(token => token.tag))).toEqual([['LIN', 'QTY'], ['LIN', 'QTY'], ['LIN', 'QTY']])
    for (const group of ast.messages[0].lineGroups) for (const token of group.segments) {
      expect(ast.segments[token.index]).toBe(token)
      const span = segmentSourceSpan(token)!
      expect(span.unit).toBe('utf16_code_unit')
      expect(raw.slice(span.startOffset, span.endOffset)).toBe(segmentOriginalRaw(token))
      expect(segmentOriginalRaw(token)).toBe(token.raw)
    }
  })

  it('keeps UTILTS transactions/observations physically scoped with their original tokens and spans', () => {
    const raw = payload([
      ['IDE', '24', 'T1'], ['SEQ', '', 'O1'], ['RFF', ['MG', 'METER1']], ['QTY', ['31', '10', 'KWH']],
      ['SEQ', '', 'O2'], ['QTY', ['31', '', 'KWH']], ['IDE', '24', 'T2'], ['SEQ', '', 'O3'], ['QTY', ['31', '30', 'KWH']],
    ], alphabet)
    const ast = parseCanonicalEdifactAst(raw)
    const transactions = ast.messages[0].utiltsTransactions!
    expect(transactions.map(transaction => [transaction.transactionId, transaction.observations.map(observation => observation.observationId)])).toEqual([['T1', ['O1', 'O2']], ['T2', ['O3']]])
    expect(transactions.flatMap(transaction => transaction.observations).map(observation => observation.quantities[0].value)).toEqual(['10', null, '30'])
    expect(transactions[0].observations[0].references[0].value).toBe('METER1')
    expect(transactions[0].observations[1].references).toEqual([])
    for (const transaction of transactions) for (const observation of transaction.observations) for (const token of observation.segments) {
      expect(ast.segments[token.index]).toBe(token)
      const span = segmentSourceSpan(token)!
      expect(raw.slice(span.startOffset, span.endOffset)).toBe(token.raw)
    }
  })

  it('uses actual PRODAT field slots instead of the legacy CAV first-nonempty fallback', () => {
    const raw = payload([['LIN', '1', '', ['A', '', '', '89']], ['CCI', '', 'Z14'], ['CAV', ['', '', '', '9', 'EL']]], alphabet, 'PRODAT')
    const parsed = tokenizeEdifact(raw)
    const product = canonicalProdat26AFieldRules('Z04').find(rule => rule.fieldNumber === '242')!
    expect(validateFieldMatrixPayload({ family: 'PRODAT', code: 'Z04', rawSegments: parsed.segments.map(token => token.raw), una: parsed.una, mode: 'parse' }, [product])).toEqual([])
    const withoutOwnValue = raw.replace(wire(['CAV', ['', '', '', '9', 'EL']], alphabet), wire(['CAV', ['', '', '', '', 'EL']], alphabet))
    const bad = tokenizeEdifact(withoutOwnValue)
    expect(validateFieldMatrixPayload({ family: 'PRODAT', code: 'Z04', rawSegments: bad.segments.map(token => token.raw), una: bad.una, mode: 'parse' }, [{ ...product, requirement: 'required' }]).some(issue => issue.blocking)).toBe(true)
  })

  it('counts the decoded an14 reference including literal release/service characters, never the escape prefixes', () => {
    const logical = `A${alphabet.component}${alphabet.element}${alphabet.release}${alphabet.terminator}123456789`
    expect(logical.length).toBe(14)
    const referenceWire = wire(['UNH', logical, ['PRODAT', 'D', '97A', 'UN', 'E2SE6A']], alphabet)
    const raw = `UNA${alphabet.component}${alphabet.element}.${alphabet.release} ${alphabet.terminator}` + [
      wire(['UNB', ['UNOC', '3'], 'S', 'R', ['261004', '1200'], 'I'], alphabet),
      referenceWire, wire(['BGM', 'Z04', 'DOC', '9'], alphabet), wire(['UNT', '3', logical], alphabet), wire(['UNZ', '1', 'I'], alphabet),
    ].join(alphabet.terminator) + alphabet.terminator
    expect(referenceWire.length).toBeGreaterThan(logical.length)
    expect(validateEdifactEnvelope(raw).syntaxOk).toBe(true)
    const longer = raw.replaceAll(wire([logical], alphabet), wire([logical + 'X'], alphabet))
    expect(validateEdifactEnvelope(longer).issues.filter(issue => issue.code === 'message_reference_length_invalid')).toHaveLength(2)
  })
})

it('rejects a dangling release instead of truncating the final value', () => {
  expect(() => parseCanonicalEdifactAst("FTX+AAO+++VALUE?")).toThrow('edifact_dangling_release_character')
})
