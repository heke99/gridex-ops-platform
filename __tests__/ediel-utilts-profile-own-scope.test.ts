import { describe, expect, it } from 'vitest'
import { parseUtiltsRuntimeFacts, runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { validateCanonicalUtiltsProfile } from '@/lib/ediel/utilts/profiles'
import { energyHandoffMessage } from './helpers/utiltsObservationHandoff'
import { EDIEL_MESSAGE_PROFILE_CATALOG } from '@/lib/ediel/profiles/messageProfileCatalog'
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
  it('retains mandatory planning area in the own source scope',()=>{
    const facts=pairedFacts('LOC+239');facts.messageCode='S02'
    expect(validateCanonicalUtiltsProfile(facts)).toEqual(expect.arrayContaining([expect.objectContaining({code:'UTILTS_PROFILE_GRID_AREA_MISSING',referenceNumber:'SECOND'})]))
  })
  it('does not promote conditional E66 area to a universal mandatory field',()=>{
    expect(validateCanonicalUtiltsProfile(pairedFacts('LOC+239')).some(issue=>issue.code==='UTILTS_PROFILE_GRID_AREA_MISSING')).toBe(false)
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


describe('U-01 conditional source fields across profile consumers', () => {
  function branch(code: 'S01' | 'S05', quantity: boolean) {
    const source = energyHandoffMessage()
    return parseUtiltsRuntimeFacts(recountEdifactUnt(source.raw_payload!
      .replace('BGM+E66::', `BGM+${code}::`)
      .replace("LOC+239+TES:SVK:260'", '')
      .replace("MEA+AAZ++KWH'", '')
      .replace("QTY+136:500'", quantity ? "QTY+136:500'" : "MOA+9:500:SEK'")))
  }
  it.each(['S01', 'S05'] as const)('%s amount-only owns its currency and does not manufacture energy/unit/area requirements', code => {
    const issues = validateCanonicalUtiltsProfile(branch(code, false))
    expect(issues.filter(issue => ['UTILTS_PROFILE_UNIT_MISSING', 'UTILTS_PROFILE_QUANTITY_MISSING', 'UTILTS_PROFILE_GRID_AREA_MISSING'].includes(issue.code))).toEqual([])
    const quantityIssues = validateCanonicalUtiltsProfile(branch(code, true))
    expect(quantityIssues).toEqual(expect.arrayContaining([expect.objectContaining({code: 'UTILTS_PROFILE_UNIT_MISSING'})]))
    const projected = EDIEL_MESSAGE_PROFILE_CATALOG.find(profile => profile.messageFamily === 'UTILTS' && profile.messageCode === code)!
    expect(projected.requiredFields).not.toContain('grid_area_code')
    expect(projected.requiredFields).not.toContain('meter_values')
    expect(projected.conditionalFields).toContain('meter_values')
  })
  it('does not impose E30 optional 260a and exposes it as allowed missing in the UI projection', () => {
    const facts = branch('S01', true); facts.messageCode = 'E30'
    expect(validateCanonicalUtiltsProfile(facts).some(issue => issue.code === 'UTILTS_PROFILE_GRID_AREA_MISSING')).toBe(false)
    expect(EDIEL_MESSAGE_PROFILE_CATALOG.find(profile => profile.messageFamily === 'UTILTS' && profile.messageCode === 'E30')?.allowedMissingFields).toContain('grid_area_code')
  })
  it('requires the source-defined own Exchange pair and excludes 260a in the actual guide gate', () => {
    const source = energyHandoffMessage()
    const exchange = source.raw_payload!.replace("CAV+E17::260'", "CAV+E20::260'")
    const absent = runUtiltsRuntimeForMessage({...source, raw_payload: recountEdifactUnt(exchange.replace("LOC+239+TES:SVK:260'", ''))}, {guideOnly: true})
    expect(absent.validation.issues).toEqual(expect.arrayContaining(['260b', '260c'].map(aperakFieldCode => expect.objectContaining({code: 'UTILTS_EXCHANGE_AREA_PAIR_REQUIRED', aperakFieldCode}))))
    const single = runUtiltsRuntimeForMessage({...source, raw_payload: recountEdifactUnt(exchange)}, {guideOnly: true})
    expect(single.validation.issues).toEqual(expect.arrayContaining([expect.objectContaining({code: 'UTILTS_EXCHANGE_SINGLE_AREA_NOT_USED', aperakFieldCode: '260a'})]))
    const paired = runUtiltsRuntimeForMessage({...source, raw_payload: recountEdifactUnt(exchange.replace("LOC+239+TES:SVK:260'", "LOC+232+AAA:SVK:260'\nLOC+233+BBB:SVK:260'"))}, {guideOnly: true})
    expect(paired.validation.issues.filter(issue => issue.code.startsWith('UTILTS_EXCHANGE_'))).toEqual([])
  })
})
