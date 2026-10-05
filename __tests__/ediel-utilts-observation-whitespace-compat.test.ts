import { describe, expect, it } from 'vitest'
import * as tokenizer from '@/lib/ediel/core/edifactTokenizer'
import type { EdifactTokenizedSegment } from '@/lib/ediel/core/edifactTokenizer'
import { parseCanonicalEdifactAst } from '@/lib/ediel/core/canonicalEdifactAst'

type Alphabet = readonly [string, string, string, string]
type Parts = readonly (string | readonly string[])[]
const alphabets: readonly Alphabet[] = [[':', '+', '?', "'"], ['^', '|', '!', '%'], ['*', ';', '~', '$']]
function encode(parts: Parts, a: Alphabet): string {
  const escape = (value: string) => [...value].map(char => a.includes(char) ? a[2] + char : char).join('')
  return parts.map(part => typeof part === 'string' ? escape(part) : part.map(escape).join(a[0])).join(a[1])
}
function advice(a: Alphabet): string { return `UNA${a[0]}${a[1]}.${a[2]} ${a[3]}` }
function frame(body: readonly Parts[], a: Alphabet): string {
  const parts: Parts[] = [['UNH', 'M', ['UTILTS', 'D', '02B', 'UN', 'E5SE5A']], ['BGM', 'E66', 'DOC', '9'], ...body]
  return advice(a) + [...parts, ['UNT', String(parts.length + 1), 'M']].map(part => encode(part, a) + a[3]).join('')
}
// Access through the old module namespace so the test-first failure is the
// missing guarded evidence contract, not an import or TypeScript setup error.
function retainedRaw(): (segment: EdifactTokenizedSegment) => string {
  const read = (tokenizer as unknown as { segmentUntrimmedRaw?: (segment: EdifactTokenizedSegment) => string }).segmentUntrimmedRaw
  expect(read, 'guarded pre-trim evidence accessor must exist').toBeTypeOf('function')
  return read!
}

for (const a of alphabets) describe(`observational whitespace compatibility ${a.join('')}`, () => {
  it('preserves terminal whitespace in the actual IDE, SEQ, RFF and QTY projection', () => {
    const id = " m:+'?^|!%*;~$ "
    const raw = frame([['IDE', '24', id], ['SEQ', '', id], ['RFF', ['MG', id]], ['QTY', ['220', ' 001.20 ']]], a)
    const ast = parseCanonicalEdifactAst(raw)
    const transaction = ast.messages[0].utiltsTransactions![0]
    const observation = transaction.observations[0]
    expect(transaction.transactionId).toBe(id)
    expect(observation.observationId).toBe(id)
    expect(observation.references[0].value).toBe(id)
    expect(observation.quantities[0].value).toBe(' 001.20 ')
    expect(observation.references[0].raw).toBe(encode(['RFF', ['MG', id]], a))
    expect(observation.quantities[0].raw).toBe(encode(['QTY', ['220', ' 001.20 ']], a))
    for (const segment of [...transaction.segments, ...observation.segments]) {
      expect(segment).toBe(ast.segments[segment.index])
      expect(segment.raw).toBe(segment.raw.trim())
    }
    expect(raw).toBe(frame([['IDE', '24', id], ['SEQ', '', id], ['RFF', ['MG', id]], ['QTY', ['220', ' 001.20 ']]], a))
  })

  it('keeps the legacy token shape, raw, elements and default composite output unchanged', () => {
    const source = encode(['RFF', ['MG', ' A ']], a)
    const parsed = tokenizer.tokenizeEdifact(advice(a) + source + a[3])
    const token = parsed.segments[0]
    const expected = { index: 0, tag: 'RFF', raw: source.trim(), elements: ['RFF', `MG${a[0]} A`] }
    expect(token).toEqual(expected)
    expect(Object.keys(token)).toEqual(['index', 'tag', 'raw', 'elements'])
    expect(Object.getOwnPropertySymbols(token)).toEqual([])
    expect(JSON.stringify(token)).toBe(JSON.stringify(expected))
    expect(tokenizer.segmentComposite(token, 1, parsed.una)).toEqual(['MG', ' A'])
    expect(retainedRaw()(token)).toBe(source)
    expect(tokenizer.segmentComposite(token, 1, parsed.una)).toEqual(['MG', ' A'])
  })

  it('keys distinct retained whitespace to physical tokens, never equal trimmed strings', () => {
    const first = encode(['RFF', ['AES', '001 ']], a)
    const second = encode(['RFF', ['AES', '001  ']], a)
    const parsed = tokenizer.tokenizeEdifact(advice(a) + first + a[3] + second + a[3])
    expect(parsed.segments[0].raw).toBe(parsed.segments[1].raw)
    const read = retainedRaw()
    expect(read(parsed.segments[0])).toBe(first)
    expect(read(parsed.segments[1])).toBe(second)
    const separate = tokenizer.tokenizeEdifact(advice(a) + first.trim() + a[3]).segments[0]
    expect(read(separate)).toBe(first.trim())
  })

  it('falls back to current raw for a token with no trimmed characters', () => {
    const source = encode(['RFF', ['AES', '001']], a)
    const token = tokenizer.tokenizeEdifact(advice(a) + source + a[3]).segments[0]
    const read = retainedRaw()
    expect(read(token)).toBe(source)
    token.raw = encode(['RFF', ['AES', 'CHANGED']], a)
    expect(read(token)).toBe(token.raw)
  })

  it('does not resurrect retained evidence after the original token raw changes', () => {
    const token = tokenizer.tokenizeEdifact(advice(a) + encode(['RFF', ['MG', 'ORIGINAL ']], a) + a[3]).segments[0]
    const read = retainedRaw()
    expect(read(token)).toBe(encode(['RFF', ['MG', 'ORIGINAL ']], a))
    token.raw = encode(['RFF', ['MG', 'CURRENT']], a)
    expect(read(token)).toBe(token.raw)
    expect(read(token)).not.toContain('ORIGINAL')
  })

  it('does not transfer private evidence to clones or hand-made tokens', () => {
    const token = tokenizer.tokenizeEdifact(advice(a) + encode(['RFF', ['MG', 'ORIGINAL ']], a) + a[3]).segments[0]
    const read = retainedRaw()
    expect(read(token)).toBe(encode(['RFF', ['MG', 'ORIGINAL ']], a))
    const clone = { ...token }
    expect(read(clone)).toBe(clone.raw)
    const handmade: EdifactTokenizedSegment = { index: token.index, tag: token.tag, raw: encode(['RFF', ['MG', 'HANDMADE ']], a), elements: token.elements }
    expect(read(handmade)).toBe(handmade.raw)
    expect(Object.keys(token)).toEqual(['index', 'tag', 'raw', 'elements'])
  })

  it('retains text only after the existing CR/LF normalization, not original MIME bytes', () => {
    const source = encode(['RFF', ['MG', ' A ']], a)
    const parsed = tokenizer.tokenizeEdifact(advice(a) + '\r\n' + source + '\r\n' + a[3])
    expect(retainedRaw()(parsed.segments[0])).toBe(source)
    expect(parsed.segments[0].raw).toBe(source.trim())
    expect(tokenizer.segmentComposite(parsed.segments[0], 1, parsed.una)).toEqual(['MG', ' A'])
  })

  it('keeps whitespace-only observation values distinct from physically empty values', () => {
    const ast = parseCanonicalEdifactAst(frame([
      ['IDE', '24', ' '], ['SEQ', '', ' '], ['RFF', ['MG', ' ']], ['QTY', ['220', ' ']],
      ['IDE', '24', ''], ['SEQ', '', ''], ['RFF', ['MG', '']], ['QTY', ['220', '']],
    ], a))
    const transactions = ast.messages[0].utiltsTransactions!
    expect(transactions.map(item => item.transactionId)).toEqual([' ', null])
    expect(transactions.map(item => item.observations[0].observationId)).toEqual([' ', null])
    expect(transactions.map(item => item.observations[0].references[0].value)).toEqual([' ', null])
    expect(transactions.map(item => item.observations[0].quantities[0].value)).toEqual([' ', null])
  })
})
