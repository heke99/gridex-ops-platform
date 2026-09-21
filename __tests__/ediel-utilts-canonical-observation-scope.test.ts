import { describe, expect, it } from 'vitest'
import { canonicalMessageFacts, parseCanonicalEdifactAst } from '@/lib/ediel/core/canonicalEdifactAst'

// Independent structural wire fixtures. These are not full national-profile,
// expected-master-data, persistence or market-certification fixtures.
type Alphabet = readonly [string, string, string, string]
type Element = string | readonly string[]
type Parts = readonly Element[]
const alphabets: readonly Alphabet[] = [[':', '+', '?', "'"], ['^', '|', '!', '%'], ['*', ';', '~', '$']]
function encode(parts: Parts, a: Alphabet): string {
  const escape = (value: string) => [...value].map(char => a.includes(char) ? a[2] + char : char).join('')
  return parts.map(part => typeof part === 'string' ? escape(part) : part.map(escape).join(a[0])).join(a[1])
}
function frame(body: readonly Parts[], a: Alphabet, ref = 'M', family = 'UTILTS'): string {
  const parts: Parts[] = [['UNH', ref, [family, 'D', family === 'PRODAT' ? '97A' : '02B', 'UN', family === 'PRODAT' ? 'E2SE6A' : 'E5SE5A']], ['BGM', family === 'PRODAT' ? 'Z04' : 'E66', 'DOC', '9'], ...body]
  return [...parts, ['UNT', String(parts.length + 1), ref]].map(part => encode(part, a) + a[3]).join('')
}
function wire(body: readonly Parts[], a = alphabets[0], family = 'UTILTS'): string {
  return `UNA${a[0]}${a[1]}.${a[2]} ${a[3]}` + encode(['UNB', ['UNOC', '3'], ['11111', 'ZZ'], ['22222', 'ZZ'], ['260921', '1000'], 'I', '', '23-DDQ-E66-S'], a) + a[3] + frame(body, a, 'M', family) + encode(['UNZ', '1', 'I'], a) + a[3]
}
// Intentionally independent of a new production export: on the old public
// parser this assertion fails behaviorally because the hierarchy is absent.
type Reference = { raw: string; segmentIndex: number; qualifier: string | null; value: string | null; components: string[]; directReferenceSlot: boolean }
type Quantity = { raw: string; segmentIndex: number; qualifier: string | null; value: string | null; components: string[] }
type Observation = { messageIndex: number; transactionIndex: number; observationIndex: number; segmentIndex: number; observationId: string | null; sequenceComponents: string[]; segments: { raw: string; tag: string; index: number }[]; references: Reference[]; quantities: Quantity[] }
type Transaction = { messageIndex: number; transactionIndex: number; segmentIndex: number; transactionId: string | null; identityQualifier: string | null; identityComponents: string[]; segments: { raw: string; tag: string; index: number }[]; observations: Observation[] }
function transactions(raw: string, messageIndex = 0): Transaction[] {
  const message = parseCanonicalEdifactAst(raw).messages[messageIndex] as unknown as { utiltsTransactions?: Transaction[] }
  expect(message.utiltsTransactions, 'actual public AST must retain physical IDE/SEQ ownership').toBeDefined()
  return message.utiltsTransactions!
}

for (const a of alphabets) describe(`canonical UTILTS observations ${a.join('')}`, () => {
  it('keeps own IDE, SEQ, RFF224/527 and QTY220/136 without flattening observations', () => {
    const raw = wire([
      ['IDE', '24', 'T-A'], ['LOC', '172', 'A'], ['SEQ', '', '1'],
      ['RFF', ['MG', 'M-A']], ['RFF', ['AES', '101']], ['QTY', ['220', '010']],
      ['SEQ', '', '2'], ['RFF', ['AES', '101']], ['QTY', ['220', '020']],
      ['IDE', '24', 'T-B'], ['SEQ', '', '1'], ['RFF', ['SE', '7312345671234567']],
      ['RFF', ['AES', '901']], ['QTY', ['136', '12.5']],
    ], a)
    const groups = transactions(raw)
    expect(groups.map(t => [t.messageIndex, t.transactionIndex, t.transactionId, t.identityQualifier])).toEqual([[0, 0, 'T-A', '24'], [0, 1, 'T-B', '24']])
    expect(groups.map(t => t.observations.map(o => o.observationId))).toEqual([['1', '2'], ['1']])
    expect(groups[0].observations[0].references.map(r => [r.qualifier, r.value, r.directReferenceSlot])).toEqual([['MG', 'M-A', true], ['AES', '101', true]])
    expect(groups[0].observations[0].quantities[0]).toMatchObject({ qualifier: '220', value: '010', components: ['220', '010'] })
    expect(groups[1].observations[0].quantities[0]).toMatchObject({ qualifier: '136', value: '12.5' })
    expect(groups[1].observations[0]).toMatchObject({ messageIndex: 0, transactionIndex: 1, observationIndex: 0 })
  })

  it('retains omitted meter224 on later standing instead of borrowing or declaring it invalid', () => {
    const groups = transactions(wire([
      ['IDE', '24', 'T'], ['SEQ', '', '1'], ['RFF', ['MG', 'M-FIRST']], ['RFF', ['AES', '901']], ['QTY', ['220', '10']],
      ['SEQ', '', '2'], ['RFF', ['AES', '901']], ['QTY', ['220', '20']],
      ['SEQ', '', '3'], ['QTY', ['136', '10']],
    ], a))
    expect(groups[0].observations.map(o => o.references.map(r => r.qualifier))).toEqual([['MG', 'AES'], ['AES'], []])
    expect(groups[0].observations).toHaveLength(3)
    expect(groups[0]).not.toHaveProperty('expectedRegisterCount')
    expect(groups[0]).not.toHaveProperty('disposition')
  })

  it('keeps duplicate transaction, observation and register IDs as separate physical occurrences', () => {
    const groups = transactions(wire([
      ['IDE', '24', 'SAME'], ['SEQ', '', 'SAME'], ['RFF', ['AES', '101']],
      ['SEQ', '', 'SAME'], ['RFF', ['AES', '101']],
      ['IDE', '24', 'SAME'], ['SEQ', '', 'SAME'], ['RFF', ['AES', '101']],
    ], a))
    expect(groups.map(t => t.transactionIndex)).toEqual([0, 1])
    expect(groups[0].observations.map(o => o.observationIndex)).toEqual([0, 1])
    const indexes = groups.flatMap(t => t.observations.map(o => o.segmentIndex))
    expect(indexes).toEqual([4, 6, 9])
    expect(new Set(indexes).size).toBe(3)
  })

  it('decodes service characters once and keeps exact case, spaces and leading zeros', () => {
    const id = " m:+'?^|!%*;~$ "
    const groups = transactions(wire([
      ['IDE', '24', id], ['SEQ', '', id], ['RFF', ['MG', id]], ['RFF', ['AES', '001']], ['QTY', ['220', '0002']],
    ], a))
    expect(groups[0].transactionId).toBe(id)
    expect(groups[0].observations[0].observationId).toBe(id)
    expect(groups[0].observations[0].references[0].value).toBe(id)
    expect(groups[0].observations[0].references[0].components).toEqual(['MG', id])
    expect(groups[0].observations[0].references[0].raw).toBe(encode(['RFF', ['MG', id]], a))
    expect(groups[0].observations[0].references[1].value).toBe('001')
    expect(groups[0].observations[0].quantities[0].value).toBe('0002')
  })

  it('preserves missing and surplus identity components rather than synthesizing or joining IDs', () => {
    const groups = transactions(wire([
      ['IDE', '24', ''], ['SEQ', '', ''], ['RFF', ['AES', '']],
      ['IDE', '99', ['T', 'EXTRA']], ['SEQ', '', ['O', 'EXTRA']], ['RFF', ['MG', 'M', 'SURPLUS']], ['QTY', ['220', '1', 'KWH', 'SURPLUS']],
    ], a))
    expect(groups[0]).toMatchObject({ transactionId: null, identityComponents: [''] })
    expect(groups[0].observations[0]).toMatchObject({ observationId: null, sequenceComponents: [''] })
    expect(groups[0].observations[0].references[0]).toMatchObject({ value: null, components: ['AES', ''] })
    expect(groups[1]).toMatchObject({ transactionId: 'T', identityQualifier: '99', identityComponents: ['T', 'EXTRA'] })
    expect(groups[1].observations[0]).toMatchObject({ observationId: 'O', sequenceComponents: ['O', 'EXTRA'] })
    expect(groups[1].observations[0].references[0]).toMatchObject({ value: 'M', components: ['MG', 'M', 'SURPLUS'] })
    expect(groups[1].observations[0].quantities[0].components).toEqual(['220', '1', 'KWH', 'SURPLUS'])
  })

  it('retains late RFF as evidence but does not label it as the direct SG8 reference slot', () => {
    const groups = transactions(wire([
      ['IDE', '24', 'T'], ['SEQ', '', 'O'], ['DTM', ['324', '2026010120260201', '718']],
      ['RFF', ['MG', 'EARLY']], ['QTY', ['220', '1']], ['DTM', ['597', '202601010000', '203']],
      ['RFF', ['AES', 'LATE']], ['RFF', ['MG', 'LATER']],
    ], a))
    expect(groups[0].observations[0].references.map(r => [r.value, r.directReferenceSlot])).toEqual([['EARLY', true], ['LATE', false], ['LATER', false]])
    expect(groups[0].observations[0].segments.some(s => s.raw === encode(['RFF', ['AES', 'LATE']], a))).toBe(true)
  })

  it('never donates header or transaction RFF to an observation and keeps unknown qualifiers visible', () => {
    const groups = transactions(wire([
      ['RFF', ['MG', 'HEADER']], ['IDE', '24', 'T'], ['RFF', ['AES', 'TRANSACTION']],
      ['SEQ', '', 'O'], ['RFF', ['ZZZ', 'UNKNOWN']], ['RFF', ['mg', 'LOWERCASE']],
    ], a))
    expect(groups[0].observations[0].references.map(r => [r.qualifier, r.value])).toEqual([['ZZZ', 'UNKNOWN'], ['mg', 'LOWERCASE']])
    expect(groups[0].segments.some(s => s.raw === encode(['RFF', ['AES', 'TRANSACTION']], a))).toBe(true)
  })

  it('does not attach orphan SEQ to a later IDE and preserves original raw tokens', () => {
    const raw = wire([['SEQ', '', 'ORPHAN'], ['RFF', ['MG', 'ORPHAN']], ['IDE', '24', 'T'], ['SEQ', '', 'OWN']], a)
    const ast = parseCanonicalEdifactAst(raw)
    const groups = transactions(raw)
    expect(groups[0].observations.map(o => o.observationId)).toEqual(['OWN'])
    expect(groups[0].observations[0].references).toEqual([])
    expect(ast.segments.filter(s => s.tag === 'SEQ').map(s => s.raw)).toEqual([encode(['SEQ', '', 'ORPHAN'], a), encode(['SEQ', '', 'OWN'], a)])
  })

  it('separates all messages, even with duplicate IDE/SEQ and different leading families', () => {
    const body: Parts[] = [['IDE', '24', 'SAME'], ['SEQ', '', 'SAME'], ['RFF', ['AES', '101']]]
    const raw = frame(body, a, 'P', 'PRODAT') + frame(body, a, 'A') + frame([['IDE', '24', 'SAME'], ['SEQ', '', 'SAME']], a, 'B')
    expect(transactions(raw, 1)[0]).toMatchObject({ messageIndex: 1, transactionId: 'SAME' })
    expect(transactions(raw, 2)[0]).toMatchObject({ messageIndex: 2, transactionId: 'SAME' })
    expect(transactions(raw, 2)[0].observations[0].references).toEqual([])
  })

  it('does not group trailing pseudo-transactions after UNT or revive an observation across IDE', () => {
    const body: Parts[] = [['IDE', '24', 'T1'], ['SEQ', '', '1'], ['RFF', ['MG', 'M1']], ['IDE', '99', 'T2'], ['RFF', ['AES', 'NOT-OBS']]]
    const raw = `UNA${a[0]}${a[1]}.${a[2]} ${a[3]}` + frame(body, a) + [['IDE', '24', 'AFTER'], ['SEQ', '', 'AFTER'], ['RFF', ['MG', 'AFTER']]].map(p => encode(p, a) + a[3]).join('')
    const groups = transactions(raw)
    expect(groups.map(t => t.transactionId)).toEqual(['T1', 'T2'])
    expect(groups[1].observations).toEqual([])
    expect(groups[0].observations[0].references.map(r => r.value)).toEqual(['M1'])
  })

  it('keeps quantity-bearing text from creating false IDE, SEQ or reference nodes', () => {
    const groups = transactions(wire([
      ['IDE', '24', 'T'], ['SEQ', '', '1'], ['FTX', 'AAI', '', '', `IDE${a[1]}24${a[1]}DONOR${a[3]}SEQ${a[1]}${a[1]}99`], ['QTY', ['220', '1']],
    ], a))
    expect(groups).toHaveLength(1)
    expect(groups[0].observations).toHaveLength(1)
    expect(groups[0].observations[0].references).toEqual([])
    expect(groups[0].observations[0].quantities.map(q => q.value)).toEqual(['1'])
  })

  it('retains the existing public facts and non-UTILTS output contract', () => {
    const raw = wire([['IDE', '24', 'T'], ['SEQ', '', '1'], ['QTY', ['136', '1']]], a, 'APERAK')
    expect(parseCanonicalEdifactAst(raw).messages[0]).not.toHaveProperty('utiltsTransactions')
    expect(canonicalMessageFacts(raw)).toMatchObject({ family: 'APERAK', messageCode: 'E66', applicationReference: '23-DDQ-E66-S' })
  })

  it('preserves the actual tokenizer failure on malformed release data', () => {
    expect(() => parseCanonicalEdifactAst(wire([['IDE', '24', 'T']], a) + a[2])).toThrow('edifact_dangling_release_character')
  })
})

it('keeps one thousand observations separate without treating them as register inventory', () => {
  const body: Parts[] = [['IDE', '24', 'T']]
  for (let i = 1; i <= 1000; i++) body.push(['SEQ', '', String(i)], ['QTY', ['136', '1']])
  const groups = transactions(wire(body))
  expect(groups).toHaveLength(1)
  expect(groups[0].observations).toHaveLength(1000)
  expect(groups[0].observations[999]).toMatchObject({ observationIndex: 999, observationId: '1000', references: [] })
  expect(groups[0]).not.toHaveProperty('expectedRegisterCount')
})
