// masterplan: ENV-10, AT-ENV-10
import { describe, expect, it } from 'vitest'

import { validateEdifactSyntax } from '@/lib/ediel/core/syntaxValidator'
import { validateUnsmGrammar } from '@/lib/ediel/core/unsmGrammar'
import { parseCanonicalEdielPayload } from '@/lib/ediel/core/canonicalMessage'
import { prodatCharacteristicValue } from '@/lib/ediel/prodat/prodatCharacteristicFields'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { energyHandoffMessage } from './helpers/utiltsObservationHandoff'
import { recountEdifactUnt } from './helpers/recountEdifactUnt'

// Frozen P §2.6 and U annex pp.126–128 own C502/6313 versus C240/7037.
// Qualified full directories own the physical D97A/D02B representation bounds.
// These independent wire facits exercise existing consumers, not codec round trips.
// No claim of recovered frozen U PDF custody or generic AST bucket qualification.
function wire(body: string[], profile: string): string {
  return "UNA:+.? 'UNB+UNOC:3+11111:ZZ+22222:ZZ+261001:1200+I++23-DDQ-PRODAT++++1'"
    + [`UNH+M+${profile}`, ...body, `UNT+${body.length + 2}+M`, 'UNZ+1+I'].join("'") + "'"
}

const prodat = (cci: string) => wire([
  'BGM+Z03+DOC+9', 'DTM+137:202610011200:203', 'LIN+1++OBJ:::9', cci, 'CAV+:::L917',
], 'PRODAT:D:97A:UN:E2SE6A')
const utilts = (cci: string) => wire([
  'BGM+E66+DOC+9', 'DTM+137:202610011200:203', 'IDE+24+TX', cci, 'CAV+E17',
  'SEQ+Z01+1', 'QTY+136:1:KWH',
], 'UTILTS:D:02B:UN:E5SE5A')

// Deliberately mismatched metadata must not override the physical UNH grammar.
const row = (rawPayload: string) => ({
  raw_payload: rawPayload, message_standard: 'edifact', message_family: 'UTILTS',
  direction: 'inbound', environment: 'test', parsed_payload: {},
} as EdielMessageRow)

describe('ENV-10 full family/release CCI definitions at actual field consumers', () => {
  it('retains full PRODAT C240 and 4051 without moving the C502-owned product', () => {
    const cci = 'CCI++Z14+E12:ABC:260+1'
    const proof = validateUnsmGrammar(prodat(cci))
    expect(proof.qualification).toBe('qualified')
    expect(proof.sources[0].key).toBe('PRODAT:D:97A:UN')
    expect(proof.syntaxOk).toBe(true)
    expect(validateEdifactSyntax(row(prodat(cci))).ok).toBe(true)
    expect(prodatCharacteristicValue('242', [cci, 'CAV+:::L917'])).toBe('L917')
  })

  it('uses physical D97A an..3 versus D02B an..17 for CCI/C240/1131', () => {
    const older = validateUnsmGrammar(prodat('CCI++Z14+E12:ABCD:260'))
    const newer = validateUnsmGrammar(utilts('CCI+++E12:ABCD:260'))
    expect(older.qualification).toBe('qualified')
    expect(older.sources[0].key).toBe('PRODAT:D:97A:UN')
    expect(older.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'UNSM_ELEMENT_LENGTH_INVALID', field: 'CCI/C240/1131[2]' }),
    ]))
    expect(newer.qualification).toBe('qualified')
    expect(newer.sources[0].key).toBe('UTILTS:D:02B:UN')
    expect(newer.syntaxOk).toBe(true)
    expect(validateEdifactSyntax(row(prodat('CCI++Z14+E12:ABCD:260'))).ok).toBe(false)
    expect(validateEdifactSyntax(row(utilts('CCI+++E12:ABCD:260'))).ok).toBe(true)
    expect(validateUnsmGrammar(prodat('CCI++Z14+E12:ABC:260')).syntaxOk).toBe(true)
    expect(validateUnsmGrammar(utilts(`CCI+++E12:${'A'.repeat(17)}:260`)).syntaxOk).toBe(true)
    expect(validateUnsmGrammar(utilts(`CCI+++E12:${'A'.repeat(18)}:260`)).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'UNSM_ELEMENT_LENGTH_INVALID', field: 'CCI/C240/1131[2]' }),
    ]))
  })

  it('rejects full C240 component overflow and a fifth CCI element without shifting P data', () => {
    for (const [cci, code] of [
      ['CCI++Z14+E12:ABC:260:one:two:extra', 'UNSM_COMPONENT_CARDINALITY_INVALID'],
      ['CCI++Z14+E12:ABC:260+1+extra', 'UNSM_ELEMENT_CARDINALITY_INVALID'],
    ]) {
      const proof = validateUnsmGrammar(prodat(cci))
      expect(proof.syntaxOk).toBe(false)
      expect(proof.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code })]))
      expect(validateEdifactSyntax(row(prodat(cci))).ok).toBe(false)
      expect(prodatCharacteristicValue('242', [cci, 'CAV+:::L917'])).toBe('L917')
    }
  })

  it('cannot supply PRODAT242 by relocating Z14 from C502 into C240', () => {
    expect(prodatCharacteristicValue('242', ['CCI+++Z14', 'CAV+:::L917'])).toBeNull()
    expect(prodatCharacteristicValue('242', ['CCI++Z14', 'CAV+:::L917'])).toBe('L917')
  })

  it('keeps the actual UTILTS parser out of generic CCI subtype inference', () => {
    expect(parseCanonicalEdielPayload({ rawPayload: utilts('CCI++E02') })?.subtype).toBeNull()
    expect(parseCanonicalEdielPayload({ rawPayload: utilts('CCI+++E12') })?.subtype).toBeNull()
  })

  it('reads UTILTS Exchange from C240 and cannot promote E12 from C502', () => {
    const source = energyHandoffMessage()
    const exchange = source.raw_payload!.replace('CAV+E17::260', 'CAV+E20::260')
      .replace("LOC+239+TES:SVK:260'", '')
    const actual = runUtiltsRuntimeForMessage({ ...source, raw_payload: recountEdifactUnt(exchange) }, { guideOnly: true })
    expect(actual.validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'UTILTS_EXCHANGE_AREA_PAIR_REQUIRED' }),
    ]))
    const wrong = runUtiltsRuntimeForMessage({
      ...source, raw_payload: recountEdifactUnt(exchange.replace('CCI+++E12::260', 'CCI++E12::260')),
    }, { guideOnly: true })
    expect(wrong.validation.issues.filter(issue => issue.code.startsWith('UTILTS_EXCHANGE_'))).toEqual([])
  })
})
