import { describe, expect, it } from 'vitest'
import { resolveAuthoritativeEdielGuide } from '@/lib/ediel/rulebook/guideRegistry'
import { getUtiltsFieldRules } from '@/lib/ediel/rulebook/utiltsFieldMatrix'
import { UTILTS_TSP_SOURCE, UTILTS_TIME_SERIES_PRODUCTS } from '@/lib/ediel/rulebook/utiltsTimeSeriesProductCatalogue'
import { resolveUtiltsFieldConditions } from '@/lib/ediel/utilts/fieldMatrixConditions'

const tuples = { energy: 'Z04:PC:SVK:260+U46:PT:SVK:260+Z02:OT:SVK:260+Z58:LOD:SVK:260+Z05:BAP:SVK:260', price: 'Z58:PC:SVK:260+Z51:PT:SVK:260+Z88:OT:SVK:260+Z55:LOD:SVK:260+Z01:BAP:SVK:260', amount: 'Z61:PC:SVK:260+Z90:PT:SVK:260+Z64:OT:SVK:260+Z58:LOD:SVK:260+Z05:BAP:SVK:260' }
const tx = (tuple: string, body = '') => `IDE+24+SAME'PIA+1+${tuple}'${body}`
function run(body: string, code = 'S01', alternateUna = false) {
  const standard = `UNH+1+UTILTS:D:02B:UN:E5SE5A'BGM+${code}:SVK:260+D+9'${body}UNT+1+1'`
  const rawPayload = alternateUna ? 'UNA*;.? !'+standard.replaceAll(':','*').replaceAll('+',';').replaceAll("'",'!') : standard
  return resolveUtiltsFieldConditions({ policy: { family: 'UTILTS', code, referenceDate: '2026-10-23', guide: resolveAuthoritativeEdielGuide({family:'UTILTS',referenceDate:'2026-10-23',associationAssignedCode:'E5SE5A'}),fieldRules:getUtiltsFieldRules(code) }, rawPayload })
}
const has = (result: ReturnType<typeof run>, fieldNo: string, kind: string) => result.issues.filter(i => i.fieldNo === fieldNo && i.kind === kind)

describe('source qualified UTILTS conditional slice', () => {
  it('retains all current technical rows and their exact authority', () => {
    expect(UTILTS_TSP_SOURCE.sha256).toBe('53034f2fd3de416a84f755b454fc72378930126446909cee5eae968111db816b')
    expect(UTILTS_TIME_SERIES_PRODUCTS).toHaveLength(133)
    expect(new Set(UTILTS_TIME_SERIES_PRODUCTS.map(r=>[r.messageCode,...r.tuple].join('|'))).size).toBe(91)
    expect(UTILTS_TIME_SERIES_PRODUCTS.find(r=>r.row===21)).toMatchObject({productCode:'L359', identityFields:['260a'],valueField:'516',unitField:'264'})
    expect(Object.isFrozen(UTILTS_TIME_SERIES_PRODUCTS[0].tuple)).toBe(true)
  })
  it('derives energy identity and unit conditions without sibling IDE borrowing', () => {
    const r=run(tx(tuples.energy,"SEQ++1'QTY+136:1'")+tx(tuples.energy,"LOC+239+AREA'MEA+AAZ++KWH'SEQ++1'QTY+136:1'"))
    expect(has(r,'260a','missing')).toMatchObject([{transactionIndex:0}])
    expect(has(r,'264','missing')).toMatchObject([{transactionIndex:0}])
    expect(r.transactions[0].product).toMatchObject({kind:'qualified',rows:[{row:21}]})
    expect(r.complete).toBe(false)
  })
  it('requires price-only MEA without demanding QTY136', () => {
    const r=run(tx(tuples.price,"LOC+239+AREA'SEQ++1'PRI+CAL:12'CUX+2:SEK'"))
    expect(has(r,'264','missing')).toHaveLength(1)
    expect(has(r,'516','missing')).toHaveLength(0)
    expect(has(r,'269b','missing')).toHaveLength(0)
    expect(has(run(tx(tuples.price,"MEA+AAZ++KWH'SEQ++1'QTY+136:9'PRI+CAL:12'CUX+2:SEK'")),'516','forbidden')).toHaveLength(1)
  })
  it('forbids MEA in an amount-only transaction of a mixed product and requires mapped buyer/seller', () => {
    const r=run(tx(tuples.amount,"LOC+239+AREA'MEA+AAZ++KWH'SEQ++1'MOA+9:2:SEK'"))
    expect(has(r,'264','forbidden')).toHaveLength(1)
    expect(has(r,'524','missing')).toHaveLength(1)
    expect(has(r,'525','missing')).toHaveLength(1)
    expect(has(r,'516','missing')).toHaveLength(0)
  })
  it('retains mixed-product energy and amount alternatives rather than requiring both in every observation', () => {
    const r=run(tx(tuples.amount,"LOC+239+AREA'MEA+AAZ++KWH'SEQ++1'QTY+136:9'SEQ++2'MOA+9:12:SEK'"))
    expect(has(r,'264','forbidden')).toHaveLength(0)
    expect(has(r,'516','missing')).toHaveLength(0)
    expect(has(r,'522','missing')).toHaveLength(0)
    expect(r.transactions[0].product).toMatchObject({kind:'qualified',rows:[{row:14},{row:15}]})
    expect(r.unresolved).toContainEqual(expect.objectContaining({reason:'mixed_product_value_mode_unqualified'}))
  })
  it('keeps repeated price catalogue rows as legal value alternatives', () => {
    const tuple='Z58:PC:SVK:260+Z01:PT:SVK:260+Z88:OT:SVK:260+Z55:LOD:SVK:260+Z03:BAP:SVK:260'
    const r=run(tx(tuple,"LOC+239+AREA'MEA+AAZ++KWH'SEQ++1'PRI+CAL:12'CUX+2:SEK'"))
    expect(r.transactions[0].product).toMatchObject({kind:'qualified',rows:[{row:3},{row:4}]})
    expect(has(r,'269b','missing')).toHaveLength(0)
  })
  it('uses the actual UNA for every PIA category and own physical value', () => {
    const r=run(tx(tuples.energy,"LOC+239+AREA'MEA+AAZ++KWH'SEQ++1'QTY+136:1'"),'S01',true)
    expect(r.transactions[0].product.kind).toBe('qualified')
    expect(r.issues).toEqual([])
  })
  it('an escaped component separator remains product value data, not an extra PIA category', () => {
    const r=run(tx(tuples.energy.replace('Z02:OT','Z02?:EXTRA:OT')))
    expect(r.transactions[0].product.kind).toBe('unqualified')
    expect(has(r,'511','invalid')).toHaveLength(0)
  })
  it('rejects repeated PIA segments instead of merging their categories', () => {
    expect(run(tx(tuples.energy,"PIA+1+"+tuples.energy+"'")).transactions[0].product.kind).toBe('malformed')
  })
  it('does not infer lower quality from an absent STS on a non-NULL quantity', () => {
    const r=run(tx(tuples.energy,"LOC+239+AREA'MEA+AAZ++KWH'SEQ++1'QTY+136:1'"))
    expect(has(r,'520','missing')).toHaveLength(0)
  })
  it('requires E27 for a literal NULL E66 reading without coercing it to zero', () => {
    const r=run("IDE+24+OWN'SEQ++1'QTY+220:NULL'DTM+597:202610230000:203'CCI+++E22::260'CAV+E01::260'",'E66')
    expect(has(r,'309','invalid')).toHaveLength(1)
    expect(has(r,'530a','missing')).toHaveLength(0)
  })
  it('does not borrow currency from another PRI or MOA in the same SEQ', () => {
    expect(has(run(tx(tuples.price,"SEQ++1'PRI+CAL:2'PRI+CAL:3'CUX+2:SEK'")),'269b','missing')).toHaveLength(1)
    expect(has(run(tx(tuples.amount,"SEQ++1'MOA+9:2'MOA+9:3:SEK'")),'269a','missing')).toHaveLength(1)
  })
  it.each([['duplicate',tuples.energy+'+Z05:BAP:SVK:260'],['agency',tuples.energy.replace('PC:SVK:260','PC:WRONG:260')]])('distinguishes malformed PIA (%s) from catalogue qualification', (_name,tuple) => {
    const r=run(tx(tuple))
    expect(r.transactions[0].product.kind).toBe('malformed')
    expect(has(r,'511','invalid')).toHaveLength(1)
  })
  it('reports an absent required PIA as missing511 rather than invalid511', () => {
    const r=run("IDE+24+OWN'")
    expect(r.transactions[0].product.kind).toBe('absent')
    expect(has(r,'511','missing')).toHaveLength(1)
    expect(has(r,'511','invalid')).toHaveLength(0)
  })
  it.each([['511a',tuples.energy.replace('Z04:PC',':PC')],['511b',tuples.energy.replace('U46:PT',':PT')],['511e',tuples.energy.split('+').slice(0,4).join('+')]])('reports an empty or absent mandatory component %s as missing', (fieldNo,tuple) => {
    const r=run(tx(tuple))
    expect(r.transactions[0].product.kind).toBe('incomplete')
    expect(has(r,fieldNo,'missing')).toHaveLength(1)
    expect(r.issues.some(issue=>issue.kind==='invalid')).toBe(false)
  })
  it('does not qualify a reordered but otherwise legal five-category PIA', () => {
    const parts=tuples.energy.split('+')
    const r=run(tx([parts[1],parts[0],...parts.slice(2)].join('+')))
    expect(r.transactions[0].product.kind).toBe('malformed')
    expect(has(r,'511','invalid')).toHaveLength(1)
  })
  it('holds a well-shaped unknown product locally without invented national dependent findings', () => {
    const r=run(tx(tuples.energy.replace('Z02:OT','X50:OT')))
    expect(r.transactions[0].product.kind).toBe('unqualified')
    expect(r.holds).toContainEqual(expect.objectContaining({reason:'product_catalogue_unqualified'}))
    expect(r.issues).toEqual([])
  })
  it('does not require a forbidden E66 PIA or activate catalogue-only S08', () => {
    expect(run("IDE+24+OWN'SEQ++1'QTY+220:1'",'E66').transactions[0].product.kind).toBe('not_applicable')
    expect(run(tx(tuples.energy),'S08')).toMatchObject({sourceQualified:false,issues:[]})
  })
  it('forbids status only for the qualified L359 andelstal row, with the exact own STS occurrence', () => {
    const r=run(tx(tuples.energy,"LOC+239+AREA'MEA+AAZ++KWH'SEQ++1'QTY+136:1'STS+8+56'"))
    const quality=r.issues.filter(issue=>issue.semanticKey==='quantity_quality')
    expect(quality).toHaveLength(1)
    expect(quality[0]).toMatchObject({fieldNo:'520',kind:'forbidden',transactionIndex:0,observationIndex:0,catalogueRows:[21],occurrence:{segmentIndex:8,elementIndex:2,componentIndex:0}})
    expect(run(tx(tuples.energy,"LOC+239+AREA'MEA+AAZ++KWH'SEQ++1'QTY+136:1'" )).issues.filter(issue=>issue.semanticKey==='quantity_quality')).toEqual([])
  })
  it('does not infer an andelstal exclusion for an unknown product or another S01 energy product', () => {
    const other='Z61:PC:SVK:260+Z87:PT:SVK:260+Z04:OT:SVK:260+Z58:LOD:SVK:260+Z05:BAP:SVK:260'
    for(const tuple of [other,tuples.energy.replace('Z02:OT','X50:OT')]) {
      const r=run(tx(tuple,"SEQ++1'QTY+136:1'STS+8+56'"))
      expect(r.issues.filter(issue=>issue.semanticKey==='quantity_quality'&&issue.kind==='forbidden')).toEqual([])
    }
  })
  it('keeps observation quality X on its own quantity branch', () => {
    const r=run(tx('Z61:PC:SVK:260+Z87:PT:SVK:260+Z04:OT:SVK:260+Z58:LOD:SVK:260+Z05:BAP:SVK:260',"SEQ++1'QTY+136:1'STS+8+46'QTY+220:2'STS+8+46'"))
    expect(r.issues.filter(i=>i.semanticKey==='meter_reading_quality'&&i.kind==='forbidden')).toHaveLength(1)
    expect(r.issues.filter(i=>i.semanticKey==='quantity_quality'&&i.kind==='forbidden')).toHaveLength(0)
  })
  it('keeps E30/S07 reading date source conflict unresolved and E66 own date required', () => {
    for(const code of ['E30','S07']) {
      const r=run("IDE+24+OWN'SEQ++1'QTY+220:1'",code)
      expect(has(r,'530a','missing')).toHaveLength(0)
      expect(r.unresolved).toContainEqual(expect.objectContaining({fieldNo:'530a',reason:'source_conflict'}))
    }
    const r=run("IDE+24+OWN'SEQ++1'QTY+220:NULL'QTY+220:1'DTM+597:202610230000:203'CCI+++E22::260'CAV+E27::260'",'E66')
    expect(has(r,'530a','missing')).toHaveLength(1)
    expect(has(r,'309','missing')).toHaveLength(1)
  })
})
