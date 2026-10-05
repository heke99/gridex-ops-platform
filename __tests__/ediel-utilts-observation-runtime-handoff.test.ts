import { describe, expect, it } from 'vitest'
import { buildInboundUtiltsMessageInput, parseInboundUtilts } from '@/lib/ediel/utilts'
import { normalizeUtiltsRuntimePayload, parseUtiltsRuntimeFacts, runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { normalizeParsedUtiltsPayload, parseUtilts } from '@/lib/ediel/utilts/parseUtilts'
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import type { CanonicalUtiltsTransaction } from '@/lib/ediel/utilts/canonicalObservationScope'
import { observationHandoffMessage } from './helpers/utiltsObservationHandoff'

type Alphabet = readonly [string, string, string, string]
type Segment = readonly (string | readonly string[])[]
const alphabets: readonly Alphabet[] = [[':', '+', '?', "'"], ['^', '|', '!', '%'], ['*', ';', '~', '$']]
function encode(parts: Segment, a: Alphabet): string {
  const escape = (s: string) => [...s].map(c => a.includes(c) ? a[2] + c : c).join('')
  return parts.map(p => typeof p === 'string' ? escape(p) : p.map(escape).join(a[0])).join(a[1]) + a[3]
}
function frame(body: readonly Segment[], a: Alphabet, family = 'UTILTS'): string {
  const parts: Segment[] = [['UNH', 'M', [family, 'D', '02B', 'UN', 'E5SE5A']], ['BGM', 'E66', 'DOC', '9'], ...body]
  return [...parts, ['UNT', String(parts.length + 1), 'M']].map(p => encode(p, a)).join('')
}
function advice(a: Alphabet): string { return `UNA${a[0]}${a[1]}.${a[2]} ${a[3]}` }
function observed(value: unknown): CanonicalUtiltsTransaction[] {
  const result = (value as { utiltsObservedTransactions?: CanonicalUtiltsTransaction[] }).utiltsObservedTransactions
  expect(result, 'actual wire observation handoff must be present').toBeInstanceOf(Array)
  return result!
}

for (const a of alphabets) describe(`actual observation handoff ${a.join('')}`, () => {
  it('forwards exact physical observations through the public parser and inbound draft', () => {
    const id = " m:+'?x^|!x%*;~x$ "
    const raw = advice(a) + frame([
      ['RFF', ['MG', 'HEADER']], ['IDE', '24', id], ['RFF', ['MG', 'TRANSACTION']],
      ['SEQ', '', ['01', 'extra']], ['RFF', ['MG', id]], ['RFF', ['AES', '001', 'surplus']],
      ['QTY', ['220', ' 001.20 ']], ['RFF', ['MG', 'LATE']],
      ['SEQ', '', '02'], ['RFF', ['AES', '001']], ['QTY', ['220', '2']],
      ['IDE', '24', id], ['SEQ', '', '01'], ['QTY', ['136', '0.8']],
    ], a)
    const parsed = parseInboundUtilts(raw)
    const tx = observed(parsed)
    expect(observed(parsed.parsedPayload)).toBe(tx)
    expect(tx.map(t => [t.messageIndex, t.transactionIndex, t.transactionId])).toEqual([[0, 0, id], [0, 1, id]])
    expect(tx[0].observations.map(o => o.observationId)).toEqual(['01', '02'])
    expect(tx[0].observations[0].sequenceComponents).toEqual(['01', 'extra'])
    expect(tx[0].observations[0].references.map(r => [r.qualifier, r.value, r.directReferenceSlot])).toEqual([
      ['MG', id, true], ['AES', '001', true], ['MG', 'LATE', false],
    ])
    expect(tx[0].observations[0].references[1].components).toEqual(['AES', '001', 'surplus'])
    expect(tx[0].observations[0].quantities[0].components).toEqual(['220', ' 001.20 '])
    expect(tx[0].observations[1].references.map(r => r.qualifier)).toEqual(['AES'])
    expect(tx[1].observations[0].quantities[0].components).toEqual(['136', '0.8'])
    expect(parsed.rawSegments).toEqual(tokenizeEdifact(raw).segments.map(s => s.raw))
    const draft = buildInboundUtiltsMessageInput({ code: 'E66', rawPayload: raw })
    expect(observed(draft.parsedPayload)).toEqual(tx)
    expect(draft.rawPayload).toBe(raw)
    expect(draft.status).toBe('received')
    expect(draft.syntaxCheckStatus).toBe('pending')
  })

  it('keeps message ownership, orphan and trailer boundaries without trusting family labels', () => {
    const body: Segment[] = [['SEQ', '', 'ORPHAN'], ['IDE', '24', 'DUP'], ['SEQ', '', '1'], ['QTY', ['136', '1']]]
    const raw = advice(a) + frame(body, a, 'APERAK') + frame(body, a) + encode(['IDE', '24', 'TRAILER'], a)
      + encode(['SEQ', '', 'TRAILER'], a) + frame(body, a)
    const tx = observed(parseInboundUtilts(raw))
    expect(tx.map(t => [t.messageIndex, t.transactionId, t.observations.map(o => o.observationId)])).toEqual([[1, 'DUP', ['1']], [2, 'DUP', ['1']]])
    expect(tx[0].segmentIndex).toBeLessThan(tx[1].segmentIndex)
    expect(observed(parseInboundUtilts(advice(a) + frame(body, a, 'APERAK')))).toEqual([])
    expect(observed(parseInboundUtilts(advice(a) + body.map(p => encode(p, a)).join('')))).toEqual([])
  })

  it('retains blank and malformed physical IDE and SEQ identities without synthetic references', () => {
    const raw = advice(a) + frame([
      ['IDE', '', ['', 'EXTRA']], ['SEQ', '', ''], ['RFF', ['AES', '']],
      ['IDE', 'BAD', ' '], ['SEQ', '', ' '], ['QTY', ['220', ' ']],
    ], a)
    const tx = observed(parseInboundUtilts(raw))
    expect(tx.map(t => [t.identityQualifier, t.transactionId, t.identityComponents])).toEqual([[null, null, ['', 'EXTRA']], ['BAD', ' ', [' ']]])
    expect(tx.map(t => t.observations[0].observationId)).toEqual([null, ' '])
    expect(tx[0].observations[0].references[0].value).toBeNull()
    expect(tx[1].observations[0].quantities[0].value).toBe(' ')
  })

  it('preserves the existing public tokenizer rejection for a dangling release character', () => {
    const malformed = advice(a) + frame([['IDE', '24', 'X']], a) + a[2]
    expect(() => parseInboundUtilts(malformed)).toThrow('edifact_dangling_release_character')
    expect(() => buildInboundUtiltsMessageInput({ code: 'E66', rawPayload: malformed })).toThrow('edifact_dangling_release_character')
  })
})

describe('real runtime observation handoff is not decision authority', () => {
  for (const date of ['2026-09-30', '2026-10-01']) for (const environment of ['test', 'production'] as const) {
    it(`retains exact observations and existing policy behavior on ${date} / ${environment}`, () => {
      const source = observationHandoffMessage(date, 'tenant-a', environment)
      const forged = { ...source, parsed_payload: {
        utiltsObservedTransactions: [{ transactionId: 'FORGED', complete: true }],
        normalizedMeteringPayload: { utiltsObservedTransactions: [{ transactionId: 'WRONG-TENANT' }] },
        utiltsRuntimeFacts: { utiltsObservedTransactions: [{ transactionId: 'CACHED' }] },
      } }
      const before = JSON.stringify(forged)
      const result = runUtiltsRuntimeForMessage(forged)
      const tx = observed(result.facts)
      expect(tx.map(t => t.transactionId)).toEqual(['GRIDEX2607E66001'])
      expect(tx[0].observations.map(o => [o.observationId, o.quantities.map(q => q.components)])).toEqual([
        ['1', [['220', '10000']]], ['2', [['220', '11000']]], ['3', [['136', '500']]],
      ])
      expect(tx[0].observations[1].references.map(r => [r.qualifier, r.value])).toEqual([['AES', '101']])
      expect(observed(result.normalizedPayload)).toBe(tx)
      expect(observed(result.facts.parsedPayload)).toBe(tx)
      expect(result.validation.issues.some(i => i.code === 'UTILTS_E66_METER_READING_ENERGY_MISMATCH')).toBe(date === '2026-09-30')
      expect(result.validation.issues.some(i => ['E61', 'E62'].includes(i.utiltsErrCode ?? ''))).toBe(false)
      const clean = runUtiltsRuntimeForMessage(source)
      expect(result.validation).toEqual(clean.validation)
      expect(result.ackPlan).toEqual(clean.ackPlan)
      expect(result.transactionDispositions).toEqual(clean.transactionDispositions)
      expect(result.normalizedPayload.transactions).toEqual(clean.normalizedPayload.transactions)
      expect(result.normalizedPayload.quantities).toEqual([{ qualifier: '136', value: 500, raw: 'QTY+136:500' }])
      expect(JSON.stringify(forged)).toBe(before)
      const reparsed = parseUtilts(source.raw_payload!)
      expect(observed(reparsed)).toEqual(tx)
      expect(observed(normalizeParsedUtiltsPayload(reparsed))).toEqual(tx)
      const facts = parseUtiltsRuntimeFacts(source.raw_payload!)
      expect(observed(normalizeUtiltsRuntimePayload(facts))).toBe(observed(facts))
      expect(observed(JSON.parse(JSON.stringify(result.normalizedPayload)))).toEqual(tx)
    })
  }

  it('cannot revive prior observed data when raw input is absent', () => {
    const source = { ...observationHandoffMessage(), raw_payload: '', parsed_payload: { utiltsObservedTransactions: [{ transactionId: 'CACHED' }] } }
    const result = runUtiltsRuntimeForMessage(source, { referenceDate: '2026-09-30' })
    expect(observed(result.facts)).toEqual([])
    expect(observed(result.normalizedPayload)).toEqual([])
    expect(result.validation.ok).toBe(false)
  })

  it('does not share mutable observations between messages or tenants', () => {
    const first = runUtiltsRuntimeForMessage(observationHandoffMessage('2026-09-30', 'tenant-a'))
    const tx = observed(first.facts)
    tx[0].observations[0].references[0].value = 'MUTATED'
    const second = runUtiltsRuntimeForMessage(observationHandoffMessage('2026-09-30', 'tenant-b'))
    expect(observed(second.facts)[0].observations[0].references[0].value).toBe('101')
    expect(observed(second.facts)).not.toBe(tx)
  })
})
