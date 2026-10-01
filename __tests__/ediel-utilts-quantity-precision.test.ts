import {describe,expect,it} from 'vitest'
import {utiltsDecimalGuideIssues,utiltsPrecisionFunctionalIssues} from '@/lib/ediel/utilts/quantityPrecision'
import {runUtiltsRuntimeForMessage} from '@/lib/ediel/utiltsEngine'
import {resolveCanonicalMessagePolicy} from '@/lib/ediel/core/messagePolicy'
import {validateCanonicalPolicyFields} from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {energyHandoffMessage} from './helpers/utiltsObservationHandoff'
import {recountEdifactUnt} from './helpers/recountEdifactUnt'

function raw(quantities:string,resolution='15:806',unit='KWH') {return `UNA:+.? 'UNH+1+UTILTS:D:02B:UN:E5SE5A'BGM+E66::260+D+9+AB'IDE+24+OWN'LIN+++8716867000030:::9'DTM+354:${resolution}'MEA+AAZ++${unit}'SEQ++1'${quantities}UNT+1+1'`}
describe('source decimal precision uses the original own quantity and stage',()=>{
  it.each([['1.123',0],['1.1234',1],['9007199254740993.001',0],['1.0000',1]])('checks literal quarter energy %s without binary or canonical trimming', (value,failures)=>{
    expect(utiltsPrecisionFunctionalIssues(raw(`QTY+136:${value}'`),new Set(['OWN']))).toHaveLength(failures)
  })
  it.each(['1:802','1:801'])('monthly/year energy and monthly reading are whole source quantities: %s',resolution=>{
    const issues=utiltsPrecisionFunctionalIssues(raw("QTY+136:1.1'QTY+220:1000.0'",resolution),new Set(['OWN']))
    expect(issues).toHaveLength(2);expect(issues.every(issue=>issue.kind==='functional' && issue.utiltsErrCode==='E51')).toBe(true)
  })
  it('does not invent instrument precision for quarter meter stands, nor validate an ineligible sibling',()=>{
    expect(utiltsPrecisionFunctionalIssues(raw("QTY+220:1000.12345'"),new Set(['OWN']))).toEqual([])
    expect(utiltsPrecisionFunctionalIssues(raw("QTY+136:1.1234'"),new Set(['OTHER']))).toEqual([])
  })
  it.each(['MWH','GWH'])('holds standard active-energy %s without authentic exception grounds',unit=>{
    expect(utiltsPrecisionFunctionalIssues(raw("QTY+136:1'",'15:806',unit),new Set(['OWN']))[0]).toMatchObject({kind:'functional',utiltsErrCode:'E73',referenceNumber:'OWN'})
  })
  it('keeps NULL separate from zero and rejects numeric exponent at guide stage',()=>{
    expect(utiltsDecimalGuideIssues(raw("QTY+136:NULL'"))).toEqual([])
    expect(utiltsPrecisionFunctionalIssues(raw("QTY+136:NULL'"),new Set(['OWN']))).toEqual([])
    expect(utiltsDecimalGuideIssues(raw("QTY+136:1e3'"))[0]).toMatchObject({kind:'application',aperakErcCode:'42',aperakFieldCode:'516'})
  })
  it('checks own monetary amount and price precision without inventing an energy branch',()=>{
    expect(utiltsDecimalGuideIssues(raw("MOA+9:1.23:SEK'PRI+CAL:1.123456'CUX+2:SEK'"))).toEqual([])
    expect(utiltsDecimalGuideIssues(raw("MOA+9:1.234:SEK'PRI+CAL:1.1234567'CUX+2:SEK'")).map(issue=>issue.aperakFieldCode)).toEqual(['522','523'])
  })
  it('honors an explicit alternate decimal mark',()=>{
    const input=raw("QTY+136:1.1234'").replace('UNA:+.? ', 'UNA:+,? ').replace('1.1234','1,1234')
    expect(utiltsDecimalGuideIssues(input)).toEqual([])
    expect(utiltsPrecisionFunctionalIssues(input,new Set(['OWN']))[0].utiltsErrCode).toBe('E51')
  })
  it('the actual runtime emits E51 after a complete valid guide and cannot issue positive APERAK',()=>{
    const message=energyHandoffMessage();message.raw_payload=recountEdifactUnt(message.raw_payload!.replace('QTY+136:500','QTY+136:500.0001'))
    const runtime=runUtiltsRuntimeForMessage(message)
    expect(!runtime.validation.issues.some(issue=>issue.severity==='error' && issue.kind==='application')).toBe(true)
    expect(runtime.validation.issues).toContainEqual(expect.objectContaining({kind:'functional',utiltsErrCode:'E51'}))
    expect(runtime.transactionDispositions[0]).toMatchObject({disposition:'processability_rejected',responseType:'utilts_err'})
    expect(runtime.ackPlan.utiltsErrCodes).toContain('E51')
    expect(runUtiltsRuntimeForMessage(message,{guideOnly:true}).validation.issues.some(issue=>issue.utiltsErrCode==='E51')).toBe(false)
  })
  it('national field failure suppresses precision and is also enforced by the shared rulebook consumer',()=>{
    const message=energyHandoffMessage();message.raw_payload=recountEdifactUnt(message.raw_payload!.replace('QTY+136:500','QTY+136:5e-4'))
    const runtime=runUtiltsRuntimeForMessage(message)
    expect(!runtime.validation.issues.some(issue=>issue.severity==='error' && issue.kind==='application')).toBe(false);expect(runtime.validation.issues.some(issue=>issue.utiltsErrCode==='E51')).toBe(false)
    const wire=tokenizeEdifact(message.raw_payload),policy=resolveCanonicalMessagePolicy(message)!
    expect(validateCanonicalPolicyFields({policy,rawSegments:wire.segments.map(segment=>segment.raw),una:wire.una})).toContainEqual(expect.objectContaining({code:'UTILTS_DECIMAL_FIELD_INVALID',fieldPath:'516'}))
  })
})
