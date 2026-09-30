import {describe,expect,it} from 'vitest'
import {utiltsObservationOrderGuideIssues} from '@/lib/ediel/utilts/observationOrderGuide'
import {utiltsPackagingGuideViolations} from '@/lib/ediel/utilts/packagingGuide'
import {runUtiltsRuntimeForMessage} from '@/lib/ediel/utiltsEngine'
import {energyHandoffMessage} from './helpers/utiltsObservationHandoff'

function observation(type:'energy'|'reading',time:string,value='10') {
  return `SEQ++1'QTY+${type === 'energy' ? '136' : '220'}:${value}'DTM+597:${time}:203'`
}
const tx = (body:string) => `UNH+1+UTILTS:D:02B:UN:E5SE5A'IDE+24+OWN'${body}UNT+1+1'`
describe('U18 physical observation blocks',()=>{
  it.each([['energy','reading'],['reading','energy']] as const)('allows %s then %s', (first,second)=>{
    expect(utiltsObservationOrderGuideIssues(tx(observation(first,'202607010000')+observation(first,'202607010015')+observation(second,'202607010000')+observation(second,'202607010015')))).toEqual([])
  })
  it('rejects a reading between two energy observations',()=>{
    expect(utiltsObservationOrderGuideIssues(tx(observation('energy','202607010000')+observation('reading','202607010000')+observation('energy','202607010015')))).toEqual(expect.arrayContaining([expect.objectContaining({code:'UTILTS_OBSERVATION_BLOCK_NOT_CONTIGUOUS',referenceNumber:'OWN'})]))
  })
  it('rejects own descending times but never compares sibling blocks or IDEs',()=>{
    expect(utiltsObservationOrderGuideIssues(tx(observation('energy','202607010015')+observation('energy','202607010000')))).toEqual(expect.arrayContaining([expect.objectContaining({code:'UTILTS_OBSERVATION_TIME_ORDER'})]))
    expect(utiltsObservationOrderGuideIssues(tx(observation('energy','202607010015')+`IDE+24+SECOND'`+observation('energy','202607010000')))).toEqual([])
  })
  it('rejects the same numeric reading and time even when its lexical precision differs',()=>{
    expect(utiltsObservationOrderGuideIssues(tx(observation('reading','202607010000','10.0')+observation('reading','202607010000','010.00')))).toEqual(expect.arrayContaining([expect.objectContaining({code:'UTILTS_METER_READING_DUPLICATED'})]))
  })
  it('keeps time order and duplicate readings in the actual own register scope',()=>{
    const reading=(register:string,time:string)=>`SEQ++1'RFF+AES:${register}'RFF+MG:METER'QTY+220:10'DTM+597:${time}:203'`
    expect(utiltsObservationOrderGuideIssues(tx(reading('A','202607010000')+reading('A','202608010000')+reading('B','202607010000')+reading('B','202608010000')))).toEqual([])
    expect(utiltsObservationOrderGuideIssues(tx(reading('A','202608010000')+reading('A','202607010000')))).toEqual(expect.arrayContaining([expect.objectContaining({code:'UTILTS_OBSERVATION_TIME_ORDER'})]))
  })
  it('compares equivalent supported timestamps and retains NULL as an absent reading',()=>{
    const repeated=observation('reading','202607010000')+observation('reading','202607010000').replace(':203',':204').replace('202607010000','20260701000000')
    expect(utiltsObservationOrderGuideIssues(tx(repeated))).toEqual(expect.arrayContaining([expect.objectContaining({code:'UTILTS_METER_READING_DUPLICATED'})]))
    expect(utiltsObservationOrderGuideIssues(tx(observation('reading','202607010000','NULL')+observation('reading','202607010000','NULL')))).toEqual([])
  })
  it('retains typed syntax rejection when no AST can be decoded',()=>{
    const message=energyHandoffMessage()
    message.raw_payload += '?'
    const result=runUtiltsRuntimeForMessage(message)
    expect(result.validation.classification).toBe('syntax_rejected')
    expect(result.facts.transactions).toEqual([])
    expect(result.ackPlan).toMatchObject({contrlOutcome:'negative',shouldSendAperak:false,shouldSendUtiltsErr:false})
  })
})
it('keeps U15 national one-message packaging distinct from syntax',()=>{
  expect(utiltsPackagingGuideViolations(tx('')+tx(''))).toEqual(expect.arrayContaining([expect.objectContaining({code:'UTILTS_PACKAGING_MESSAGE_COUNT'})]))
})
it('groups own transaction reasons without treating observation quality as a reason',()=>{
  const mixed=tx("STS+7++E23::260'SEQ++1'QTY+136:1'IDE+24+OTHER'STS+7++E88::260'SEQ++1'QTY+136:2'")
  expect(utiltsPackagingGuideViolations(mixed)).toEqual(expect.arrayContaining([expect.objectContaining({code:'UTILTS_PACKAGING_MIXED_REASONS',field:'223'})]))
  const quality=tx("STS+7++E88::260'SEQ++1'QTY+136:1'STS+7++21::260'IDE+24+OTHER'STS+7++E88::260'SEQ++1'QTY+136:2'")
  expect(utiltsPackagingGuideViolations(quality)).toEqual([])
})
it('holds quarter/month mixes from each own SG5 resolution',()=>{
  const mixed=tx("DTM+354:15:806'SEQ++1'QTY+136:1'IDE+24+OTHER'DTM+354:1:802'SEQ++1'QTY+136:2'")
  expect(utiltsPackagingGuideViolations(mixed)).toEqual(expect.arrayContaining([expect.objectContaining({code:'UTILTS_PACKAGING_MIXED_RESOLUTIONS',field:'508'})]))
  const local=tx("DTM+354:15:806'SEQ++1'QTY+136:1'DTM+354:1:802'IDE+24+OTHER'DTM+354:15:806'SEQ++1'QTY+136:2'")
  expect(utiltsPackagingGuideViolations(local)).toEqual([])
})
