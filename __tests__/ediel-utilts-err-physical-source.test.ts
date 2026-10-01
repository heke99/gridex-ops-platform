import {edielDraftWire} from './helpers/edielDraftWire'
import {describe,expect,it} from 'vitest'
import {buildUtiltsErrDraft,getUtiltsAckTransactionTargets} from '@/lib/ediel/ack'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {escapeEdifactValue} from '@/lib/ediel/core/edifactSerializer'
import {segmentComposite,segmentUntrimmedRaw,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {utiltsErrGatewayFixture} from './helpers/utiltsErrGatewayFixture'
import type {EdielMessageRow} from '@/lib/ediel/types'

function source(references:string[],alternate=false):EdielMessageRow {
  const message=utiltsErrGatewayFixture({company:'00000000-0000-4000-8000-000000000002',transactions:references.map((_,index)=>({reference:`SOURCE-${index}`,outcome:'processability_rejected'}))})
  message.id='00000000-0000-4000-8000-000000000001'
  for(const [index,reference] of references.entries()) message.raw_payload=message.raw_payload!.replace(`IDE+24+SOURCE-${index}'`,`IDE+24+${escapeEdifactValue(reference)}'`)
  if(alternate) {
    const wire=EdifactEnvelopeCodec.decode(message.raw_payload!)
    message.raw_payload=EdifactEnvelopeCodec.encode({sender:wire.sender!,receiver:wire.receiver!,senderQualifier:wire.senderQualifier,receiverQualifier:wire.receiverQualifier,interchangeReference:'CUSTOM-UNA',environment:'test',applicationReference:'23-DDQ-E66-T',acknowledgementRequest:true,
      una:{componentDataElementSeparator:'*',dataElementSeparator:';',releaseCharacter:'!',segmentTerminator:'~'},messages:[{messageReference:'1',messageTypeToken:'UTILTS:D:02B:UN:E5SE5A',businessSegments:wire.segments.filter(segment=>!['UNB','UNH','UNT','UNZ'].includes(segment.tag)).map(segment=>segmentUntrimmedRaw(segment))}]})
  }
  return message
}
function references(raw:string,qualifier='TN') {
  const wire=tokenizeEdifact(raw)
  return wire.segments.filter(segment=>segment.tag==='RFF'&&segmentComposite(segment,1,wire.una)[0]===qualifier).map(segment=>segmentComposite({...segment,raw:segmentUntrimmedRaw(segment)},1,wire.una)[1])
}

describe('UTILTS ERR physical original selection and references',()=>{
  it.each([false,true])('uses exact IDE component zero and ignores nested TN with alternate UNA=%s',alternate=>{
    const ids=['ORIGINAL:A+1?2','ORIGINALA1?2']
    const message=source(ids,alternate)
    if(!alternate)message.raw_payload=message.raw_payload!.replace("IDE+24+ORIGINAL?:A?+1??2'","IDE+24+ORIGINAL?:A?+1??2:SECOND:RFF'RFF+TN:BORROWED'")
    expect(getUtiltsAckTransactionTargets(message).map(target=>target.reference)).toEqual(ids)
    for(const id of ids) {
      const draft=buildUtiltsErrDraft({sourceMessage:message,messageText:'E51',relatedTransactionReference:id})
      expect(references(edielDraftWire(draft))).toEqual([id])
      expect(tokenizeEdifact(edielDraftWire(draft)).una.dataElementSeparator).toBe('+')
    }
    expect(()=>buildUtiltsErrDraft({sourceMessage:message,messageText:'E51',relatedTransactionReference:'ORIGINALA12'})).toThrow(/saknas/)
  })
  it.each([35,70])('does not truncate a physical reference of length %s in a draft',length=>{
    const id='X'.repeat(length),message=source([id])
    const draft=buildUtiltsErrDraft({sourceMessage:message,messageText:'E51',relatedTransactionReference:id})
    expect(references(edielDraftWire(draft))).toEqual([id])
    const wire=tokenizeEdifact(edielDraftWire(draft)),ownIde=wire.segments.find(segment=>segment.tag==='IDE')!
    expect(segmentComposite(ownIde,2,wire.una)[0].length).toBeLessThanOrEqual(35)
    // This observational draft is not original guide acceptance or send proof.
  })
  it('preserves the actual source BGM reference instead of cached row metadata',()=>{
    const message=source(['OWN'])
    message.raw_payload=message.raw_payload!.replace('BGM+E66::260+GRIDEX2607E66','BGM+E66::260+SOURCE?:DOC?+')
    message.parsed_payload={documentReference:'CACHED-WRONG',businessReference:'CACHED-WRONG'}
    const sourceWire=tokenizeEdifact(message.raw_payload),original=segmentComposite(sourceWire.segments.find(segment=>segment.tag==='BGM'),2,sourceWire.una)[0]
    expect(original).toContain('SOURCE:DOC+')
    expect(references(edielDraftWire(buildUtiltsErrDraft({sourceMessage:message,messageText:'E51',relatedTransactionReference:'OWN'})),'E66')).toEqual([original])
  })
  it.each([false,true])('preserves trailing original TN data-space with alternate UNA=%s',alternate=>{
    const id='OWN+REF ',message=source([id],alternate)
    expect(getUtiltsAckTransactionTargets(message).map(target=>target.reference)).toEqual([id])
    expect(references(edielDraftWire(buildUtiltsErrDraft({sourceMessage:message,messageText:'E51',relatedTransactionReference:id})))).toEqual([id])
  })
  it('does not synthesize targets or choose an unqualified sibling',()=>{
    const message=source(['FIRST','SECOND'])
    expect(()=>buildUtiltsErrDraft({sourceMessage:message,messageText:'E51'})).toThrow('utilts_err_source_transaction_scope_required')
    message.raw_payload=message.raw_payload!.replace('IDE+24+SECOND','IDE+24+FIRST')
    expect(()=>getUtiltsAckTransactionTargets(message)).toThrow('utilts_err_source_transaction_reference_ambiguous')
    const absent={...source(['OWN']),raw_payload:"UNH+1+UTILTS:D:02B:UN:E5SE5A'BGM+E66::260+DOC+9+AB'UNT+3+1'"}
    expect(getUtiltsAckTransactionTargets(absent)).toEqual([])
    const noId={...absent,raw_payload:"UNH+1+UTILTS:D:02B:UN:E5SE5A'IDE+24+:BORROWED'RFF+TN:BORROWED'UNT+4+1'"}
    expect(()=>getUtiltsAckTransactionTargets(noId)).toThrow('utilts_err_source_transaction_reference_unavailable')
  })
})
