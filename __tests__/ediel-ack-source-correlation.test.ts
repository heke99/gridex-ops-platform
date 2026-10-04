// masterplan: ACK-06, AT-ACK-06
import {describe, expect, it} from 'vitest'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {qualifyInboundAckSourceCandidates, readInboundAckSourceCorrelation, type AckCorrelationMessage} from '@/lib/ediel/ack/sourceCorrelation'

function wire(family: string, segments: string[], reverse = false, alternate = false) {
  return EdifactEnvelopeCodec.encode({sender:reverse ? 'B' : 'A',receiver:reverse ? 'A' : 'B',senderSubAddress:reverse ? 'R' : 'S',receiverSubAddress:reverse ? 'S' : 'R',
    environment:'test',applicationReference:family.startsWith('PRODAT') ? '23-DDQ-PRODAT' : '23-DDQ-E66-T', acknowledgementRequest:false,
    interchangeReference:reverse ? 'ACK-I' : 'SOURCE-I',messages:[{messageReference:'1',messageTypeToken:family,businessSegments:segments}],
    ...(alternate ? {una:{componentDataElementSeparator:':',dataElementSeparator:';',decimalMark:'.',releaseCharacter:'!',segmentTerminator:'~'}} : {})})
}
const source = (raw = wire('UTILTS:D:02B:UN:E5SE5A', ['BGM+E66::260+SOURCE-D+9+AB','NAD+MS+A:SVK:260','NAD+MR+B:SVK:260','IDE+24+Own?+A?:Q','IDE+24+SECOND'])): AckCorrelationMessage => ({id:'source',company_id:'tenant-a',environment:'test',direction:'outbound',message_family:'UTILTS',raw_payload:raw,message_sent_at:'2026-09-30T12:00:00Z'})
const ack = (segments = ['BGM+312+ACK-D+9','DOC+E66:SVK:260+SOURCE-D','NAD+MS+B:SVK:260','NAD+MR+A:SVK:260','ERC+100::260','FTX+AAO+++OK','RFF+DM+ACK-T','RFF+ACW:Own?+A?:Q'], alternate = false): AckCorrelationMessage => ({id:'ack',company_id:'tenant-a',environment:'test',direction:'inbound',message_family:'APERAK',raw_payload:wire('APERAK:D:04A:UN:E5SE5A',segments,true,alternate)})

describe('ACK-06 / TEN-13 physical original qualification',()=>{
  it('permits the source-required APERAK for an actual UTILTS ERR without creating an ERR loop',()=>{
    const original=source();original.raw_payload=original.raw_payload!.replace('BGM+E66::260','BGM+ERR::260');original.message_family='UTILTS_ERR'
    const message=ack();message.raw_payload=message.raw_payload!.replace('DOC+E66:SVK:260','DOC+ERR:SVK:260')
    expect(qualifyInboundAckSourceCandidates({ackMessage:message,candidates:[original]}).status).toBe('unique')
    message.message_family='UTILTS_ERR';message.raw_payload=wire('UTILTS:D:02B:UN:E5SE5A',['BGM+ERR::260+ACK-D+9+AB','NAD+MS+B:SVK:260','NAD+MR+A:SVK:260','IDE+24+ERR-T','STS+E01::260+41+E51::260','RFF+TN:Own?+A?:Q','RFF+ERR:SOURCE-D'],true)
    expect(qualifyInboundAckSourceCandidates({ackMessage:message,candidates:[original]}).status).toBe('unresolved')
  })
  it.each([false,true])('binds exact released own IDE and reversed physical identities for alternateUNA=%s',alternate=>{
    const result=qualifyInboundAckSourceCandidates({ackMessage:ack(undefined,alternate),candidates:[source()]})
    expect(result).toMatchObject({status:'unique',sourceMessage:{id:'source'},correlation:{scope:'transaction',acknowledgedReferences:['Own+A:Q'],classification:{outcome:'positive'}}})
  })
  it('refuses duplicate wire identities across tenant rows even with supplied company',()=>{
    expect(qualifyInboundAckSourceCandidates({ackMessage:ack(),candidates:[source(),{...source(),id:'other',company_id:'tenant-b'}],expectedCompanyId:'tenant-a'})).toMatchObject({status:'ambiguous',sourceMessage:null})
  })
  it.each([
    ['UNB sender', (raw:string)=>raw.replace('+B:ZZ:R+A:ZZ:S+', '+FORGED:ZZ:R+A:ZZ:S+')],
    ['UNB qualifier', (raw:string)=>raw.replace('+B:ZZ:R+', '+B:9:R+')],
    ['UNB subaddress', (raw:string)=>raw.replace('+B:ZZ:R+', '+B:ZZ:OTHER+')],
    ['application', (raw:string)=>raw.replace('23-DDQ-E66-T','23-DGI-E66-T')],
    ['legal sender', (raw:string)=>raw.replace('NAD+MS+B:', 'NAD+MS+C:')],
    ['document', (raw:string)=>raw.replace('DOC+E66:SVK:260+SOURCE-D','DOC+E66:SVK:260+OTHER')],
    ['own reference', (raw:string)=>raw.replace('RFF+ACW:Own?+A?:Q','RFF+ACW:ABSENT')],
  ])('does not authorize a reference-only hit with wrong %s',(_name, mutate)=>{
    const m=ack();m.raw_payload=mutate(m.raw_payload!)
    expect(qualifyInboundAckSourceCandidates({ackMessage:m,candidates:[source()]}).status).toBe('unresolved')
  })
  it('requires authentic sent provenance and physical environment',()=>{
    expect(qualifyInboundAckSourceCandidates({ackMessage:ack(),candidates:[{...source(),message_sent_at:null}]}).status).toBe('unresolved')
    expect(qualifyInboundAckSourceCandidates({ackMessage:{...ack(),environment:'production'},candidates:[source()]}).status).toBe('invalid')
  })
  it('refuses invalid wire outcome instead of inventing positive from row metadata',()=>{
    const m=ack();m.raw_payload=m.raw_payload!.replace('BGM+312','BGM+999')
    expect(qualifyInboundAckSourceCandidates({ackMessage:m,candidates:[source()]}).status).toBe('invalid')
  })
  it('binds PRODAT FR/DO and transaction LI, never a LIN line number',()=>{
    const original=source(wire('PRODAT:D:96A:UN:E2SE6A',['BGM+Z03+SOURCE-D+9','NAD+FR+A:160:SVK','NAD+DO+B:160:SVK','LIN+1','RFF+LI:TX-SOURCE']));original.message_family='PRODAT'
    const m=ack();m.raw_payload=wire('PRODAT:D:96A:UN:E2SE6A',['BGM+34+ACK-D+34','RFF+ACW:SOURCE-D','NAD+FR+B:160:SVK','NAD+DO+A:160:SVK','ERC+100::260','RFF+LI:TX-SOURCE'],true).replace('PRODAT:D:96A','APERAK:D:96A')
    expect(qualifyInboundAckSourceCandidates({ackMessage:m,candidates:[original]})).toMatchObject({status:'unique',correlation:{scope:'object',acknowledgedReferences:['TX-SOURCE']}})
    m.raw_payload=m.raw_payload.replace('LI:TX-SOURCE','LI:1')
    expect(qualifyInboundAckSourceCandidates({ackMessage:m,candidates:[original]}).status).toBe('unresolved')
  })
  it('allows CONTRL for APERAK and binds original UCI parties, rejects a CONTRL loop',()=>{
    const original=source(wire('APERAK:D:04A:UN:E5SE5A',['BGM+312+SOURCE-D+9']));original.message_family='APERAK'
    const m=ack();m.message_family='CONTRL';m.raw_payload=wire('CONTRL:2:2:UN',['UCI+SOURCE-I+A:ZZ:S+B:ZZ:R+1'],true)
    expect(qualifyInboundAckSourceCandidates({ackMessage:m,candidates:[original]}).status).toBe('unique')
    m.raw_payload=m.raw_payload.replace('UCI+SOURCE-I+A:ZZ:S+B:ZZ:R+1','UCI+SOURCE-I+OTHER:ZZ:S+B:ZZ:R+1')
    expect(qualifyInboundAckSourceCandidates({ackMessage:m,candidates:[original]}).status).toBe('unresolved')
    m.raw_payload=wire('CONTRL:2:2:UN',['UCI+SOURCE-I+A:ZZ:S+B:ZZ:R+1'],true)
    original.raw_payload=wire('CONTRL:2:2:UN',['UCI+OTHER+B:ZZ:R+A:ZZ:S+1'])
    expect(qualifyInboundAckSourceCandidates({ackMessage:m,candidates:[original]}).status).toBe('unresolved')
  })
  it('extracts only physical original lookup values, not own DM or own interchange',()=>{
    expect(readInboundAckSourceCorrelation(ack()).lookupReferences).toEqual([{type:'BGM_REF',value:'SOURCE-D'},{type:'IDE',value:'Own+A:Q'}])
  })
  it('qualifies source-prescribed first14 UCI and refuses same-prefix originals before company restriction',()=>{
    const reference='12345678901234LONG-A',original=source();original.raw_payload=original.raw_payload!.replaceAll('SOURCE-I',reference)
    const message=ack();message.message_family='CONTRL';message.raw_payload=wire('CONTRL:2:2:UN',['UCI+12345678901234+A:ZZ:S+B:ZZ:R+1'],true)
    expect(qualifyInboundAckSourceCandidates({ackMessage:message,candidates:[original]}).status).toBe('unique')
    const sibling={...original,id:'collision',company_id:'tenant-b',raw_payload:original.raw_payload!.replaceAll(reference,'12345678901234LONG-B')}
    expect(qualifyInboundAckSourceCandidates({ackMessage:message,candidates:[original,sibling],expectedCompanyId:'tenant-a'}).status).toBe('ambiguous')
    message.raw_payload=message.raw_payload!.replace('UCI+12345678901234','UCI+1234567890123X')
    expect(qualifyInboundAckSourceCandidates({ackMessage:message,candidates:[original]}).status).toBe('unresolved')
  })
})
