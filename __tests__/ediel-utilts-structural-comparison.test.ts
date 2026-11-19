// masterplan: U-02, U-08, SC-049
import {describe,it,expect} from 'vitest'
import {compareUtiltsStructure} from '@/lib/ediel/utilts/structuralComparison'
import {comparisonInput,structureVersion,utiltsStructureWire,STRUCTURE_POINT} from './helpers/structuralComparisonFixtures'
import {projectCorrectionContextBlocker} from '@/lib/ediel/sources/correctionContextImpact'
import {recountEdifactUnt} from './helpers/recountEdifactUnt'
const check=(options:Parameters<typeof utiltsStructureWire>[0]={},versions=[structureVersion()])=>compareUtiltsStructure(comparisonInput(utiltsStructureWire(options),versions))
const energyReferences=(options:Parameters<typeof utiltsStructureWire>[0],...references:string[])=>recountEdifactUnt(
 utiltsStructureWire({highResolution:true,noReadings:true,...options}).replace("QTY+136:10'",`${references.join("'\n")}'\nQTY+136:10'`),
)
describe('original UTILTS against independently selected structure (pure)',()=>{
  it('holds a matching correction at the saved cutoff without national mismatch codes',()=>{
    const blocker=projectCorrectionContextBlocker({rawC:null,sourceId:'synthetic-correction',observedAt:'2026-10-10T00:00:00Z',
      oldStop:{kind:'known',utc:'2026-10-30T00:00:00Z'},proposedStop:{kind:'known',utc:'2026-10-15T00:00:00Z'},
      scope:{companyId:'company-a',environment:'test',customerId:null,objectId:STRUCTURE_POINT,identityAgency:'9',
        legalSender:'12345',legalReceiver:'54321',supplyPeriodId:null}})
    const input=comparisonInput()
    expect(compareUtiltsStructure({...input,companyId:'company-a',environment:'test',correctionContextBlockers:[blocker]}))
      .toMatchObject({status:'unavailable',reason:'structural_correction_context_hold',codes:[]})
    expect(compareUtiltsStructure({...input,cutoffAt:'2026-10-09T00:00:00Z',companyId:'company-a',environment:'test',
      correctionContextBlockers:[blocker]})).toMatchObject({status:'matched',codes:[]})
  })
  it('counts two registers, not four reads or the energy sequence',()=>expect(check()).toMatchObject({status:'matched',codes:[],transactionId:'TX'}))
  it.each([['201'],['202'],['201','202','901'],['201','203'],['201 ','202'],['201','202 ']].map(ids=>[ids]))('detects missing/extra/wrong register inventory %j',ids=>expect(check({ids})).toMatchObject({status:'mismatch',codes:['E62']}))
  it.each(['WRONG','old',' OLD','OLD '])('does not normalize the wrong meter %s',meter=>expect(check({meter})).toMatchObject({status:'mismatch',codes:['E61']}))
  it('does not borrow the first register meter for another register',()=>expect(check({meters:['OLD',null]})).toMatchObject({status:'unavailable',codes:[]}))
  it('checks each explicitly sent register meter',()=>expect(check({meters:['OLD','WRONG']})).toMatchObject({status:'mismatch',codes:['E61']}))
  it('emits both genuine comparison errors without inventing an APERAK',()=>expect(check({ids:['901'],meter:'WRONG'})).toMatchObject({status:'mismatch',codes:['E61','E62']}))
  it('does not substitute incoming IDs for missing source inventory',()=>expect(check({},[])).toMatchObject({status:'unavailable',codes:[]}))
  it.each(['readComplete','unresolvedSources'] as const)('keeps %s uncertainty internal',field=>{const input=comparisonInput();input[field]=field==='unresolvedSources';expect(compareUtiltsStructure(input)).toMatchObject({status:'unavailable',codes:[]})})
  it('requires a witnessed accepted version',()=>{const version=structureVersion();version.disposition='unavailable';expect(check({},[version])).toMatchObject({status:'unavailable',codes:[]})})
  it('requires known expected register identifiers',()=>{const version=structureVersion();version.wire.registers[1].registerId=null;expect(check({},[version])).toMatchObject({status:'unavailable',codes:[]})})
  it('requires known expected meter identifier',()=>{const version=structureVersion();version.wire.meterNumber=null;expect(check({},[version])).toMatchObject({status:'unavailable',codes:[]})})
  it.each(['sender','receiver','point'] as const)('does not cross the %s scope',field=>expect(check({[field]:'99999'})).toMatchObject({status:'unavailable',codes:[]}))
  it('does not borrow agency9 structure for89',()=>expect(compareUtiltsStructure(comparisonInput(utiltsStructureWire().replace(`${STRUCTURE_POINT}::9`,`${STRUCTURE_POINT}::89`)))).toMatchObject({status:'unavailable',codes:[]}))
  it('keeps closing interval readings on the OLD meter at the exchange boundary',()=>expect(check({period:'202610010000202610150000'},[structureVersion(),structureVersion(2,'NEW')])).toMatchObject({status:'matched',selected:[{meterNumber:'OLD'}]}))
  it('uses the NEW meter after the exchange',()=>expect(check({period:'202610150000202611010000',meter:'NEW'},[structureVersion(),structureVersion(2,'NEW')])).toMatchObject({status:'matched',selected:[{meterNumber:'NEW'}]}))
  it('rejects old meter in the new interval',()=>expect(check({period:'202610150000202611010000'},[structureVersion(),structureVersion(2,'NEW')])).toMatchObject({status:'mismatch',codes:['E61']}))
  it('does not turn an unresolved inside-transaction exchange into E61/E62',()=>expect(check({},[structureVersion(),structureVersion(2,'NEW')])).toMatchObject({status:'unavailable',codes:[]}))
  it('selects E30 last stand on the old side without looking at the sent meter',()=>expect(check({code:'E30',period:'',reason:'E24'},[structureVersion(),structureVersion(2,'NEW')])).toMatchObject({status:'matched',selected:[{meterNumber:'OLD'}]}))
  it.each(['E20','E77'])('selects E30 %s ending stand on the closing side',reason=>expect(check({code:'E30',period:'',reason},[structureVersion(),structureVersion(2,'NEW')])).toMatchObject({status:'matched',selected:[{meterNumber:'OLD'}]}))
  it('selects E30 first stand on the new side without looking at the sent meter',()=>expect(check({code:'E30',period:'',reason:'E25',meter:'NEW'},[structureVersion(),structureVersion(2,'NEW')])).toMatchObject({status:'matched',selected:[{meterNumber:'NEW'}]}))
  it('selects E30 E67 first stand on the current side',()=>expect(check({code:'E30',period:'',reason:'E67',meter:'NEW'},[structureVersion(),structureVersion(2,'NEW')])).toMatchObject({status:'matched',selected:[{meterNumber:'NEW'}]}))
  it('does not guess an ambiguous point side from the incoming identifier',()=>expect(check({code:'E30',period:'',reason:'E64'},[structureVersion(),structureVersion(2,'NEW')])).toMatchObject({status:'unavailable',codes:[]}))
  it('permits quarter energy without register readings',()=>expect(check({noReadings:true,highResolution:true},[])).toMatchObject({status:'not_applicable',codes:[]}))
  it('permits prior hourly energy without register readings',()=>expect(compareUtiltsStructure(comparisonInput(
    utiltsStructureWire({noReadings:true,highResolution:true}).replace('DTM+354:15:806','DTM+354:60:806'),[]
  ))).toMatchObject({status:'not_applicable',codes:[]}))
  it.each([
    ['202610142345202610150000','201','OLD'],
    ['202610150000202610150015','301','NEW'],
  ])('matches the explicit energy register for period %s against the correct meter side', (period,register,meter)=>{
    const versions=[structureVersion(1,'OLD',['201']),structureVersion(2,'NEW',['301'])]
    const raw=energyReferences({period},`RFF+AES:${register}`)
    expect(compareUtiltsStructure(comparisonInput(raw,versions))).toMatchObject({status:'matched',codes:[],selected:[{meterNumber:meter}]})
  })
  it('retains E62 for the old explicit energy register after exchange and for an incomplete declared inventory',()=>{
    const period='202610150000202610150015'
    const versions=[structureVersion(1,'OLD',['201']),structureVersion(2,'NEW',['301','302'])]
    for(const register of ['201','301']){
      expect(compareUtiltsStructure(comparisonInput(energyReferences({period},`RFF+AES:${register}`),versions)))
        .toMatchObject({status:'mismatch',codes:['E62']})
    }
  })
  it('holds an explicit energy register with missing structure or invalid physical placement',()=>{
    const raw=energyReferences({},'RFF+AES:201')
    expect(compareUtiltsStructure(comparisonInput(raw,[]))).toMatchObject({status:'unavailable',codes:[]})
    const misplaced=recountEdifactUnt(utiltsStructureWire({noReadings:true,highResolution:true,after:['RFF+AES:201']}))
    expect(compareUtiltsStructure(comparisonInput(misplaced,[structureVersion(1,'OLD',['201'])])))
      .toMatchObject({status:'unavailable',codes:[]})
  })
  it('retains a genuine E61 alongside a matching explicit E66 energy register',()=>{
    const raw=energyReferences({},'RFF+AES:201','RFF+MG:WRONG')
    expect(compareUtiltsStructure(comparisonInput(raw,[structureVersion(1,'OLD',['201'])])))
      .toMatchObject({status:'mismatch',codes:['E61']})
  })
  it('does not fill a missing register reading with an energy reference in a mixed transaction',()=>{
    const raw=energyReferences({noReadings:false,ids:['201']},'RFF+AES:202')
    expect(compareUtiltsStructure(comparisonInput(raw))).toMatchObject({status:'mismatch',codes:['E62']})
  })
  it('does not silently accept absent monthly registers',()=>expect(check({noReadings:true})).toMatchObject({status:'mismatch',codes:['E62']}))
  it.each(['E31','S01','S02','S03','S04','E72','E73','ERR'])('does not apply E61/E62 to %s',code=>expect(check({code})).toMatchObject({status:'not_applicable',codes:[]}))
  it('does not use RFF+LI P or wrong case as a national comparison check',()=>{
    for(const value of ['P','WRONG',''])expect(check({before:[`RFF+LI:${value}`]})).toMatchObject({status:'matched',codes:[]})
  })
  it('retains EDIFACT escaped register identity',()=>{const version=structureVersion(1,'OLD',['A+B','202']);expect(check({ids:['A+B','202']},[version])).toMatchObject({status:'matched'})})
  it('retains EDIFACT escaped meter identity',()=>{const version=structureVersion(1,'A:B+?');expect(check({meter:'A:B+?'},[version])).toMatchObject({status:'matched'})})
  it('does not take a meter reference from the transaction header',()=>expect(check({meters:[null,null],before:['RFF+MG:OLD']})).toMatchObject({status:'unavailable',codes:[]}))
  it('does not take a meter reference following a quantity as SG8 evidence',()=>expect(check({meters:[null,null],after:['RFF+MG:OLD']})).toMatchObject({status:'unavailable',codes:[]}))
  it('does not silently fix malformed composite identifiers',()=>expect(compareUtiltsStructure(comparisonInput(utiltsStructureWire().replace('RFF+AES:201','RFF+AES:201:EXTRA')))).toMatchObject({status:'unavailable',codes:[]}))
  it('keeps observation times outside the selected period internal',()=>expect(check({readingEnd:'202611150000'})).toMatchObject({status:'unavailable',codes:[]}))
  it('does not infer dates from receipt when period/reading date is invalid',()=>expect(check({period:'202602300000202611010000'})).toMatchObject({status:'unavailable',codes:[]}))
})
