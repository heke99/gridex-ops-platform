// masterplan: ACK-06, AT-ACK-06
import {describe,expect,it} from 'vitest'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {qualifyInboundAckSourceCandidates,type AckCorrelationMessage} from '@/lib/ediel/ack/sourceCorrelation'

const wire=(token:string,segments:string[],reverse:boolean,application:string)=>EdifactEnvelopeCodec.encode({sender:reverse?'B':'A',receiver:reverse?'A':'B',
 environment:'test',applicationReference:application,acknowledgementRequest:false,interchangeReference:reverse?'ACK-I':'SOURCE-I',
 messages:[{messageReference:'1',messageTypeToken:token,businessSegments:segments}]})
const utiltsSource=():AckCorrelationMessage=>({id:'utilts',company_id:'tenant-a',environment:'test',direction:'outbound',message_family:'UTILTS',message_sent_at:'2026-09-30T12:00:00Z',
 raw_payload:wire('UTILTS:D:02B:UN:E5SE5A',['BGM+E66::260+SOURCE-D+9+AB','NAD+MS+A:SVK:260','NAD+MR+B:SVK:260','IDE+24+TX-1'],false,'23-DDQ-E66-T')})
// A PRODAT original that happens to share the document id and a LI equal to the UTILTS transaction id.
const prodatSource=():AckCorrelationMessage=>({id:'prodat',company_id:'tenant-b',environment:'test',direction:'outbound',message_family:'PRODAT',message_sent_at:'2026-09-30T12:00:00Z',
 raw_payload:wire('PRODAT:D:96A:UN:E2SE6A',['BGM+Z03+SOURCE-D+9','NAD+FR+A:160:SVK','NAD+DO+B:160:SVK','LIN+1','RFF+LI:TX-1'],false,'23-DDQ-E66-T')})
const utiltsAck=():AckCorrelationMessage=>({id:'ack',company_id:'tenant-a',environment:'test',direction:'inbound',message_family:'APERAK',
 raw_payload:wire('APERAK:D:04A:UN:E5SE5A',['BGM+312+ACK-D+9','DOC+E66:SVK:260+SOURCE-D','NAD+MS+B:SVK:260','NAD+MR+A:SVK:260','ERC+100::260','FTX+AAO+++OK','RFF+DM+ACK-T','RFF+ACW:TX-1'],true,'23-DDQ-E66-T')})

describe('ACK-06 the original family is part of the correlation key',()=>{
 it('a UTILTS APERAK binds only to the UTILTS original, never to another tenant\'s PRODAT with equal references',()=>{
  expect(qualifyInboundAckSourceCandidates({ackMessage:utiltsAck(),candidates:[utiltsSource(),prodatSource()]})).toMatchObject({status:'unique',sourceMessage:{id:'utilts'}})
  expect(qualifyInboundAckSourceCandidates({ackMessage:utiltsAck(),candidates:[prodatSource()]})).toMatchObject({status:'unresolved',sourceMessage:null})
 })
})
