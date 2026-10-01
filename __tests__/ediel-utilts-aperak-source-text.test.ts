import {describe,expect,it} from 'vitest'
import {utiltsApplicationErrorText} from '@/lib/ediel/utilts/aperakSourceText'
import {runUtiltsRuntimeForMessage} from '@/lib/ediel/utiltsEngine'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {renderAperakEdiel} from '@/lib/ediel/aperakEngine'
import {energyHandoffMessage} from './helpers/utiltsObservationHandoff'
import {recountEdifactUnt} from './helpers/recountEdifactUnt'
import type {UtiltsValidationIssue} from '@/lib/ediel/utiltsEngine.part-1'

const invalid:UtiltsValidationIssue={severity:'error',kind:'application',code:'UTILTS_DECIMAL_FIELD_INVALID',title:'Diagnostic',description:'Never an ACK source',aperakErcCode:'42',aperakFieldCode:'516',aperakText:'INCORRECT DATA',referenceNumber:'GRIDEX2607E66001',lineItemReference:'GRIDEX2607E66001'}
describe('U A905 original failed-content text',()=>{
  it('uses the actual failed header component, not its valid document code or description',()=>{
    const source=energyHandoffMessage();source.raw_payload=source.raw_payload!.replace('BGM+E66::260','BGM+E66::BAD')
    const runtime=runUtiltsRuntimeForMessage(source)
    expect(runtime.ackPlan.utiltsHeaderRejection?.applicationErrors).toEqual([{ercCode:'42',fieldCode:'202',text:'INCORRECT DATA BAD',referenceQualifier:null,referenceNumber:null,lineItemReference:null}])
  })
  it('binds each malformed own observation instead of a clean or bad sibling value',()=>{
    const source=energyHandoffMessage(),lines=source.raw_payload!.split('\n'),start=lines.findIndex(line=>line.startsWith('IDE+')),end=lines.findIndex(line=>line.startsWith('UNT+'))
    source.raw_payload=recountEdifactUnt([...lines.slice(0,end),...lines.slice(start,end).map(line=>line.replaceAll('GRIDEX2607E66001','SECOND').replace('QTY+136:500',"QTY+136:BAD'\nSEQ++2'\nQTY+136:WRONG")),...lines.slice(end)].join('\n'))
    const runtime=runUtiltsRuntimeForMessage(source),errors=runtime.ackPlan.aperakApplicationErrors.filter(error=>error.fieldCode==='516')
    expect(errors.map(error=>[error.referenceNumber,error.text])).toEqual([['SECOND','INCORRECT DATA BAD'],['SECOND','INCORRECT DATA WRONG']])
    expect(utiltsApplicationErrorText({raw:source.raw_payload,issue:{...invalid,referenceNumber:'SECOND',lineItemReference:'SECOND'}})).toBeNull()
    const firstQuantity=tokenizeEdifact(source.raw_payload).segments.find(segment=>segment.tag==='QTY')!
    expect(utiltsApplicationErrorText({raw:source.raw_payload,issue:{...invalid,referenceNumber:'SECOND',lineItemReference:'SECOND',aperakInvalidOccurrence:{segmentIndex:firstQuantity.index,elementIndex:1,componentIndex:1}}})).toBeNull()
  })
  it('decodes releases losslessly and never substitutes missing content with a diagnostic',()=>{
    const source=energyHandoffMessage();source.raw_payload=source.raw_payload!.replace('QTY+136:500','QTY+136:BAD?+VALUE?:RAW??')
    expect(utiltsApplicationErrorText({raw:source.raw_payload,issue:invalid})).toBe('INCORRECT DATA BAD+VALUE:RAW?')
    expect(utiltsApplicationErrorText({raw:source.raw_payload.replace('BAD?+VALUE?:RAW??',''),issue:invalid})).toBeNull()
    expect(utiltsApplicationErrorText({raw:source.raw_payload,issue:{...invalid,referenceNumber:'OTHER',lineItemReference:'OTHER'}})).toBeNull()
  })
  it('reports the own forbidden QTY unit, without blaming a valid inherited unit',()=>{
    const source=energyHandoffMessage();source.raw_payload=source.raw_payload!.replace('QTY+136:500','QTY+136:500:MWH')
    const runtime=runUtiltsRuntimeForMessage(source)
    expect(runtime.ackPlan.aperakApplicationErrors).toContainEqual({ercCode:'42',fieldCode:'QTY/C186/6411',text:'INCORRECT DATA MWH',referenceQualifier:'ACW',referenceNumber:'GRIDEX2607E66001',lineItemReference:'GRIDEX2607E66001'})
    expect(runtime.ackPlan.aperakApplicationErrors.some(error=>error.fieldCode==='264')).toBe(false)
  })
  it('preserves allowed long logical original text and holds bare/oversize text before rendering',()=>{
    const source=energyHandoffMessage(),text='INCORRECT DATA '+ 'A'.repeat(180),params={source:{id:source.id,messageFamily:'UTILTS',messageCode:'E66',rawPayload:source.raw_payload},refs:{documentReference:'GRIDEX2607E66MSG001'},externalReference:'AP',transactionReference:'DM',outcome:'negative' as const}
    expect(renderAperakEdiel({...params,applicationErrors:[{ercCode:'42',fieldCode:'516',text,referenceNumber:'GRIDEX2607E66001'}]}).segments).toContain('FTX+AAO++516::260+'+text)
    for(const forbidden of ['INCORRECT DATA','INCORRECT DATA '+ 'A'.repeat(512)]) expect(()=>renderAperakEdiel({...params,applicationErrors:[{ercCode:'42',fieldCode:'516',text:forbidden,referenceNumber:'GRIDEX2607E66001'}]})).toThrow('utilts_aperak_source_text_unavailable')
  })
})
