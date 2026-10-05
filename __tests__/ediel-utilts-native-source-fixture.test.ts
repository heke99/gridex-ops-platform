import { expect, it } from 'vitest'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { energyHandoffMessage } from './helpers/utiltsObservationHandoff'
import { utiltsNativeSourceFixture } from './helpers/utiltsNativeSourceFixture'

const sourceA = '00000000-0000-4000-8000-000000000001'
const sourceB = '00000000-0000-4000-8000-000000000002'
it('new source rows get distinct consistent wire/row interchange references without changing transaction content', () => {
  const raw = energyHandoffMessage().raw_payload!
  const a = utiltsNativeSourceFixture(raw, sourceA), b = utiltsNativeSourceFixture(raw, sourceB)
  expect(a.parsed.interchangeReference).not.toBe(b.parsed.interchangeReference)
  for (const source of [a, b]) {
    const runtime = runUtiltsRuntimeForMessage({ ...energyHandoffMessage(), id: source.id, raw_payload: source.raw })
    expect(runtime.validation.ok, JSON.stringify(runtime.validation.issues)).toBe(true)
    const tokens = tokenizeEdifact(source.raw).segments
    expect(tokens.find(s => s.tag === 'UNB')?.elements[5]).toBe(source.parsed.interchangeReference)
    expect(tokens.find(s => s.tag === 'UNZ')?.elements[2]).toBe(source.parsed.interchangeReference)
    expect(tokens.filter(s => !['UNB', 'UNZ'].includes(s.tag))).toEqual(tokenizeEdifact(raw).segments.filter(s => !['UNB', 'UNZ'].includes(s.tag)))
  }
})
it('same source identity retains byte-identical wire and only explicit mutations change retry bytes', () => {
  const raw = energyHandoffMessage().raw_payload!
  const a = utiltsNativeSourceFixture(raw, sourceA)
  expect(utiltsNativeSourceFixture(raw, sourceA)).toEqual(a)
  const changed = utiltsNativeSourceFixture(raw.replace('QTY+136:500', 'QTY+136:999'), sourceA)
  expect(changed.parsed.interchangeReference).toBe(a.parsed.interchangeReference)
  expect(changed.raw).toBe(a.raw.replace('QTY+136:500', 'QTY+136:999'))
})
