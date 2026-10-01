import {describe, expect, it} from 'vitest'
import {validateAckPreflight} from '@/lib/ediel/core/ackPreflight'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {energyHandoffMessage} from './helpers/utiltsObservationHandoff'

function response(family: 'CONTRL' | 'APERAK' | 'UTILTS_ERR', segments:string[], alternate:boolean, outcome='negative') {
  return {...energyHandoffMessage(),id:'ack',direction:'outbound',message_family:family,related_message_id:energyHandoffMessage().id,
    parsed_payload:{ackOutcome:outcome},raw_payload:EdifactEnvelopeCodec.encode({sender:'21660',receiver:'91100',environment:'test',applicationReference:'23-DDQ-E66-T',acknowledgementRequest:false,
      interchangeReference:'ACK-I',messages:[{messageReference:'OWN-REF',messageTypeToken:family==='CONTRL' ? 'CONTRL:2:2:UN' : family==='APERAK' ? 'APERAK:D:04A:UN:E5SE5A' : 'UTILTS:D:02B:UN:E5SE5A',businessSegments:segments}],
      ...(alternate ? {una:{dataElementSeparator:';',componentDataElementSeparator:':',decimalMark:'.',releaseCharacter:'!',segmentTerminator:'~'}} : {})})} as EdielMessageRow
}

describe('ENV-02 physical ACK preflight consumers',()=>{
  it.each([false,true])('reads actual UCI action under alternateUNA=%s',alternate=>{
    const source=energyHandoffMessage(), ack=response('CONTRL',['UCI+260831181101+91100:ZZ+21660:ZZ+1'],alternate,'positive')
    expect(validateAckPreflight({ackMessage:ack,sourceMessage:source}).ok).toBe(true)
    const wrong=response('CONTRL',['UCI+260831181101+91100:ZZ+21660:ZZ+4'],alternate,'positive')
    expect(validateAckPreflight({ackMessage:wrong,sourceMessage:source}).issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'contrl_uci_action_code_mismatch'})]))
  })
  it.each([false,true])('checks physical APERAK/ERC/FTX fields with alternativeUNA=%s',alternate=>{
    const source=energyHandoffMessage(), ack=response('APERAK',['BGM+313+ACK+9','DOC+E66:SVK:260+SOURCE','ERC+42::260','FTX+AAO++508::260+INCORRECT DATA','RFF+ACW:OWN'],alternate)
    expect(validateAckPreflight({ackMessage:ack,sourceMessage:source}).ok).toBe(true)
  })
  it('does not interpret released segment-looking text as an ERC acceptance or an extra envelope',()=>{
    const ack=response('APERAK',['BGM+313+ACK+9','ERC+42::260',"FTX+AAO++508::260+TEXT?'ERC?+100",'RFF+ACW:OWN'],true)
    expect(validateAckPreflight({ackMessage:ack,sourceMessage:energyHandoffMessage()}).issues.some(issue=>issue.code==='negative_aperak_contains_100')).toBe(false)
  })
  it.each([false,true])('validates source-qualified ERR status and singleton counts with alternativeUNA=%s',alternate=>{
    const source={...energyHandoffMessage(),message_code:'S03'}, ack=response('UTILTS_ERR',['BGM+ERR:SVK:260+ACK+9+AB','IDE+24+ACK-T','NAD+DDK+BRP:SVK:260','NAD+DDQ+SUP:SVK:260','PIA+5+PRODUCT','STS+E01::260+41+E49::260'],alternate)
    expect(validateAckPreflight({ackMessage:ack,sourceMessage:source}).ok).toBe(true)
    const quantity=response('UTILTS_ERR',['BGM+ERR:SVK:260+ACK+9+AB','IDE+24+ACK-T','NAD+DDK+BRP:SVK:260','NAD+DDQ+SUP:SVK:260','PIA+5+PRODUCT','STS+E01::260+41+E49::260','QTY+136:1'],alternate)
    expect(validateAckPreflight({ackMessage:quantity,sourceMessage:source}).issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'utilts_s03_err_forbidden_quantity_detail'})]))
  })
  it('does not borrow ERR status components from another STS',()=>{
    const ack=response('UTILTS_ERR',['BGM+ERR:SVK:260+ACK+9+AB','STS+E01::260+40+E49::260','STS+7+41+E88::260'],true)
    expect(validateAckPreflight({ackMessage:ack,sourceMessage:energyHandoffMessage()}).issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'utilts_err_missing_sts_e01'})]))
  })
  it('returns a typed blocking result for a dangling release rather than throwing',()=>{
    const ack=response('CONTRL',['UCI+SOURCE+A:ZZ+B:ZZ+1'],true);ack.raw_payload+='!'
    expect(validateAckPreflight({ackMessage:ack,sourceMessage:energyHandoffMessage()})).toMatchObject({ok:false,issues:[{code:'ack_wire_parse_invalid'}]})
  })
})
