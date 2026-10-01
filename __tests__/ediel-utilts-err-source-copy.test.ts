import {describe,expect,it} from 'vitest'
import {buildUtiltsErrDraft} from '@/lib/ediel/ack'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {segmentComposite,segmentUntrimmedRaw,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {UTILTS_ERR_SOURCE_COPY_FIELDS,utiltsDefaultAlphabetSegment,utiltsErrOriginalCopySegments,utiltsErrSourceCopyViolations} from '@/lib/ediel/utilts/errSourceCopy'
import {utiltsErrGatewayFixture} from './helpers/utiltsErrGatewayFixture'
import {recountEdifactUnt} from './helpers/recountEdifactUnt'

// Physical source-copy fixtures only: these bytes establish neither a valid
// ordinary S01 profile nor a legal market relation or source-backed SEND grant.
function source(alternate=false) {
 const message=utiltsErrGatewayFixture({company:'00000000-0000-4000-8000-000000000001',transactions:[{reference:'OWN',outcome:'processability_rejected'},{reference:'SIBLING',outcome:'accepted'}]})
 message.id='00000000-0000-4000-8000-000000000002'
 const fields=['LOC+175+735999260731000007::9','LOC+239+AAA:SVK:260','LOC+232+BBB:SVK:260','LOC+233+CCC:SVK:260','NAD+DDK+12345:SVK:260','NAD+DDQ+54321:SVK:260','NAD+BY+33333:SVK:260','NAD+SE+44444:SVK:260','NAD+EZ+10000:SVK:260','PIA+1+SOURCE?:PRODUCT:Z04:260','DTM+324:202607010000202607010030:719','STS+7++E23::260']
 const lines=message.raw_payload!.split('\n'),start=lines.findIndex(line=>line.startsWith('IDE+24+OWN')),firstSeq=lines.findIndex((line,index)=>index>start&&line.startsWith('SEQ+'))
 message.raw_payload=recountEdifactUnt([...lines.slice(0,start+1),...fields.map(line=>line+"'"),...lines.slice(firstSeq)].join('\n'))
 if(alternate) {
  const wire=EdifactEnvelopeCodec.decode(message.raw_payload)
  message.raw_payload=EdifactEnvelopeCodec.encode({sender:wire.sender!,receiver:wire.receiver!,interchangeReference:'CUSTOM',environment:'test',applicationReference:wire.applicationReference,acknowledgementRequest:true,una:{componentDataElementSeparator:'*',dataElementSeparator:';',releaseCharacter:'!',segmentTerminator:'~'},messages:[{messageReference:'1',messageTypeToken:'UTILTS:D:02B:UN:E5SE5A',businessSegments:wire.segments.filter(segment=>!['UNB','UNH','UNT','UNZ'].includes(segment.tag)).map(segment=>segmentUntrimmedRaw(segment))}]})
 }
 return message
}
describe('frozen ERR original field copies stay in the same physical transaction',()=>{
 it.each([false,true])('copies all own-present pp66–67 fields with actual source alphabet=%s',alternate=>{
  const message=source(alternate),expected=utiltsErrOriginalCopySegments(message.raw_payload!,'OWN'),draft=buildUtiltsErrDraft({sourceMessage:message,messageText:'E51',relatedTransactionReference:'OWN'})
  const wire=tokenizeEdifact(draft.rawPayload),copy=wire.segments.slice(wire.segments.findIndex(segment=>segment.tag==='IDE')).filter(segment=>UTILTS_ERR_SOURCE_COPY_FIELDS.some(field=>field.tag===segment.tag&&segmentComposite(segment,1,wire.una)[0]===field.qualifier))
  expect(copy.map(segment=>utiltsDefaultAlphabetSegment(segment,wire.una))).toEqual(expected)
  expect(utiltsErrSourceCopyViolations(message.raw_payload!,draft.rawPayload)).toEqual([])
  expect(draft.rawPayload).not.toMatch(/SEQ\+|QTY\+|DTM\+597:|DTM\+354:/)
  expect(copy.filter(segment=>segment.tag==='LOC').map(segment=>segmentComposite(segment,1,wire.una)[0])).toEqual(['175','239','232','233'])
  expect(copy.filter(segment=>segment.tag==='NAD').map(segment=>segmentComposite(segment,1,wire.una)[0])).toEqual(['DDK','DDQ','BY','SE','EZ'])
 })
 it('holds omissions, modified fields and sibling substitution in the same shared preflight authority',()=>{
  const message=source(),draft=buildUtiltsErrDraft({sourceMessage:message,messageText:'E51',relatedTransactionReference:'OWN'})
  expect(utiltsErrSourceCopyViolations(message.raw_payload!,draft.rawPayload.replace("LOC+232+BBB:SVK:260'",''))).toEqual(['260b'])
  expect(utiltsErrSourceCopyViolations(message.raw_payload!,draft.rawPayload.replace('NAD+BY+33333','NAD+BY+99999'))).toEqual(['524'])
  expect(utiltsErrSourceCopyViolations(message.raw_payload!,draft.rawPayload.replace('RFF+TN:OWN','RFF+TN:SIBLING')).length).toBeGreaterThan(0)
 })
 it('never borrows nested observation fields, another IDE or no-source fields',()=>{
  const message=source(),wire=tokenizeEdifact(message.raw_payload),sequence=wire.segments.find(segment=>segment.tag==='SEQ')!
  const nested=message.raw_payload!.replace(sequence.raw+"'",sequence.raw+"'LOC+172+BORROWED::9'")
  expect(utiltsErrOriginalCopySegments(nested,'OWN')).not.toContain('LOC+172+BORROWED::9')
  expect(utiltsErrOriginalCopySegments(nested,'SIBLING')).not.toContain('NAD+BY+33333:SVK:260')
  expect(()=>utiltsErrOriginalCopySegments(message.raw_payload!,'ABSENT')).toThrow(/reference_ambiguous/)
 })
})
