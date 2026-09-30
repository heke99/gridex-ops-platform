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
