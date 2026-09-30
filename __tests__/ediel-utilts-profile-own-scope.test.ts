import { describe, expect, it } from 'vitest'
import { parseUtiltsRuntimeFacts, runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { validateCanonicalUtiltsProfile } from '@/lib/ediel/utilts/profiles'
import { energyHandoffMessage } from './helpers/utiltsObservationHandoff'
import { recountEdifactUnt } from './helpers/recountEdifactUnt'

function pairedFacts(remove: string) {
  const source = energyHandoffMessage()
  const lines = source.raw_payload!.split('\n')
  const begin = lines.findIndex(line => line.startsWith('IDE+'))
  const end = lines.findIndex(line => line.startsWith('UNT+'))
  const own = lines.slice(begin, end).filter(line => !line.startsWith(remove))
    .map(line => line.replaceAll('GRIDEX2607E66001', 'SECOND'))
  return parseUtiltsRuntimeFacts(recountEdifactUnt([...lines.slice(0,end), ...own, ...lines.slice(end)].join('\n')))
}

describe('U-02 physical transaction profile scope', () => {
  it.each([
    ['LOC+239', 'UTILTS_PROFILE_GRID_AREA_MISSING'],
    ['DTM+324', 'UTILTS_PROFILE_PERIOD_MISSING'],
    ['DTM+354', 'UTILTS_PROFILE_RESOLUTION_MISSING'],
    ['MEA+', 'UTILTS_PROFILE_UNIT_MISSING'],
    ['QTY+', 'UTILTS_PROFILE_QUANTITY_MISSING'],
  ])('never borrows %s from its accepted sibling', (remove, code) => {
    const facts = pairedFacts(remove)
    const issues = validateCanonicalUtiltsProfile(facts)
    expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({code, referenceNumber:'SECOND'})]))
    expect(issues.some(issue => issue.referenceNumber === 'GRIDEX2607E66001')).toBe(false)
  })
  it('does not manufacture an IDE from global summary facts', () => {
    const facts = pairedFacts('not-present')
    facts.transactions = []
    expect(validateCanonicalUtiltsProfile(facts)).toEqual(expect.arrayContaining([
      expect.objectContaining({code:'UTILTS_TRANSACTION_REQUIRED'}),
    ]))
  })
  it('keeps a missing own period at the guide gate in the real runtime', () => {
    const source = energyHandoffMessage()
    const facts = pairedFacts('DTM+324')
    const result = runUtiltsRuntimeForMessage({...source, raw_payload:recountEdifactUnt(facts.rawSegments.map(segment => segment + "'").join('\n'))})
    expect(result.transactionDispositions).toEqual(expect.arrayContaining([
      expect.objectContaining({transactionId:'SECOND', disposition:'guide_rejected', responseType:'negative_aperak'}),
    ]))
    expect(result.validation.issues.some(issue => issue.kind === 'functional' && issue.referenceNumber === 'SECOND')).toBe(false)
  })
})
