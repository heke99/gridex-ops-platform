import { expect, it } from 'vitest'
import { parseCanonicalEdifactAst } from '@/lib/ediel/core/canonicalEdifactAst'

// Reviewer5757115464: UNT alone does not prove the other interchange boundaries.
// Intentionally malformed structural fixtures, never national valid-message oracles.
for (const [component, element, release, terminator] of [[':', '+', '?', "'"], ['^', '|', '!', '%'], ['*', ';', '~', '$']]) {
  for (const boundary of ['UNB', 'UNZ']) {
    it(`does not assign post-${boundary} IDE/SEQ/RFF to the preceding message: ${element}`, () => {
      const raw = `UNA${component}${element}.${release} ${terminator}` + [
        `UNH${element}M${element}UTILTS${component}D${component}02B${component}UN${component}E5SE5A`,
        `BGM${element}E66${element}DOC${element}9`,
        `IDE${element}24${element}OWN`,
        `SEQ${element}${element}OWN-OBS`,
        `RFF${element}MG${component}OWN-METER`,
        `${boundary}${element}1${element}NEXT`,
        `IDE${element}24${element}AFTER`,
        `SEQ${element}${element}AFTER-OBS`,
        `RFF${element}MG${component}AFTER-METER`,
      ].join(terminator) + terminator
      const ast = parseCanonicalEdifactAst(raw)
      const message = ast.messages[0] as unknown as { utiltsTransactions?: Array<{
        transactionId: string | null
        segments: Array<{ index: number }>
        observations: Array<{ observationId: string | null; references: Array<{ value: string | null }> }>
      }> }
      expect(message.utiltsTransactions, 'public AST must retain bounded observed structure').toBeDefined()
      expect(message.utiltsTransactions!.map(t => t.transactionId)).toEqual(['OWN'])
      expect(message.utiltsTransactions![0].observations.map(o => o.observationId)).toEqual(['OWN-OBS'])
      expect(message.utiltsTransactions![0].observations[0].references.map(r => r.value)).toEqual(['OWN-METER'])
      expect(message.utiltsTransactions![0].segments.every(t => t.index < 5)).toBe(true)
      expect(ast.segments.some(t => t.raw.includes('AFTER-METER'))).toBe(true)
    })
  }
}
