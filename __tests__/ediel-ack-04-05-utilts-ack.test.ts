// masterplan: ACK-04, AT-ACK-04, ACK-05, AT-ACK-05
// UTILTS ERR reference/field rules are also proven in the tagged
// __tests__/ediel-utilts-err-canonical-guide.test.ts.
import {describe,expect,it,vi} from 'vitest'
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:vi.fn()}}))
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry',()=>({resolveCanonicalRulePack:vi.fn()}))
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {resolveCanonicalMessagePolicy} from '@/lib/ediel/core/messagePolicy'
import {validateCanonicalAckGuide} from '@/lib/ediel/rulebook/ackGuidePolicy'
import {buildAperakDraft,buildUtiltsErrDraft} from '@/lib/ediel/ack'
import type {EdielMessageRow} from '@/lib/ediel/types'
const company='10000000-0000-4000-8000-000000000001',ackId='20000000-0000-4000-8000-000000000001',sourceId='30000000-0000-4000-8000-000000000001'
function wire(family:'CONTRL'|'APERAK'|'PRODAT'|'UTILTS',businessSegments:string[],source=false,prodat=false){return EdifactEnvelopeCodec.encode({sender:source?'TRANSPORT_S':'TRANSPORT_R',receiver:source?'TRANSPORT_R':'TRANSPORT_S',interchangeReference:source?'SOURCEI':'ACKI',environment:'test',acknowledgementRequest:family!=='CONTRL',applicationReference:prodat?'23-DDQ-PRODAT':'23-DDQ-E66-T',messages:[{messageReference:source?'SOURCEM':'ACKM',messageTypeToken:family==='CONTRL'?'CONTRL:2:2:UN:EDIEL2':family==='APERAK'?`APERAK:D:${prodat?'96A':'04A'}:UN:${prodat?'E2SE6A':'E5SE5A'}`:family==='PRODAT'?'PRODAT:D:97A:UN:E2SE6A':'UTILTS:D:02B:UN:E5SE5A',businessSegments}]})}
const uSource=()=>wire('UTILTS',['BGM+E66+SOURCEDOC+9','DTM+137:202609301200:203','DTM+735:?+0100:406','MKS+23+E02::260','NAD+MS+LEGAL_S:SVK:260','NAD+MR+LEGAL_R:SVK:260','NAD+DDQ',...['T1','T2'].flatMap(reference=>[`IDE+24+${reference}`,'LOC+172+POINT::9','LIN+++8716867000030:::9','DTM+324:202609010000202609010015:719','STS+7++E88::260','MEA+AAZ++KWH','SEQ++1','QTY+136:1','DTM+597:202609010000:203'])],true)
const date=['DTM+137:202609301200:203','DTM+735:?+0100:406']
const uAck=(status='312',code='100',text='OK')=>wire('APERAK',[`BGM+${status}+ACKDOC+9`,...date,'DOC+E66::260+SOURCEDOC','NAD+MS+LEGAL_R:SVK:260','NAD+MR+LEGAL_S:SVK:260','NAD+DDQ',`ERC+${code}::260`,code==='100'?`FTX+AAO+++${text}`:`FTX+AAO++209::260+${text}`,'RFF+DM:ACKT','RFF+ACW:T1'])
const row=(raw:string,family:'CONTRL'|'APERAK'|'PRODAT'='APERAK',direction:'inbound'|'outbound'='inbound')=>({id:direction==='inbound'?ackId:sourceId,company_id:company,environment:'test',direction,message_standard:'edifact',message_family:family,message_code:family,raw_payload:raw,message_received_at:'2026-09-30T12:00:00Z',created_at:'2026-09-30T12:00:00Z',message_sent_at:direction==='outbound'?'2026-09-30T11:00:00Z':null,immutable_rendered_at:direction==='outbound'?'2026-09-30T10:00:00Z':null,parsed_payload:{}}) as unknown as EdielMessageRow
function guide(raw:string,source?:string){const m=row(raw,raw.includes('CONTRL')?'CONTRL':'APERAK'),policy=resolveCanonicalMessagePolicy(m)!;const tokens=tokenizeEdifact(raw);return validateCanonicalAckGuide({policy,rawSegments:tokens.segments.map(t=>t.raw),una:tokens.una,sourceRawPayload:source})}
const ok=(raw:string)=>expect(guide(raw,uSource())).toEqual([])
const rejected=(raw:string)=>expect(guide(raw,uSource()).length).toBeGreaterThan(0)

describe('ACK-04 UTILTS APERAK error texts and exact field reference',()=>{
 it('ERC 100 carries OK; 41 MANDATORY FIELD MISSING; 42 INCORRECT DATA <value>, each with its field reference',()=>{
  ok(uAck('312','100','OK'))
  ok(uAck('313','41','MANDATORY FIELD MISSING'))
  ok(uAck('313','42','INCORRECT DATA BAD'))
 })
 it('rejects a wrong text for the code, an unsupported ERC and a missing or overlong field reference',()=>{
  rejected(uAck('312','100','NOT OK'))
  rejected(uAck('313','41','INCORRECT DATA BAD'))
  rejected(uAck('313','42','MANDATORY FIELD MISSING'))
  rejected(uAck('313','40','MANDATORY FIELD MISSING'))
  rejected(uAck('313','42','INCORRECT DATA BAD').replace('FTX+AAO++209::260+','FTX+AAO+++'))
  rejected(uAck('313','42','INCORRECT DATA BAD').replace('209::260','209012345678901234::260'))
 })
})

const encode=(token:string,segments:string[])=>EdifactEnvelopeCodec.encode({sender:'S',receiver:'R',interchangeReference:'I',environment:'test',acknowledgementRequest:true,
 applicationReference:'23-DDQ-E66-T',messages:[{messageReference:'M',messageTypeToken:token,businessSegments:segments}]})
const inbound=(raw:string,family:string,code:string)=>({id:sourceId,company_id:company,direction:'inbound',message_standard:'edifact',message_family:family,message_code:code,
 raw_payload:raw,environment:'test',test_flag:1}) as unknown as EdielMessageRow
describe('ACK-05 UTILTS ERR is never answered with ERR, and APERAK never with APERAK',()=>{
 const err=encode('UTILTS:D:02B:UN:E5SE5A',['BGM+ERR::260+E1+9+AB','NAD+MS+A:SVK:260','NAD+MR+B:SVK:260','IDE+24+X','STS+E01::260+41+E51::260','RFF+TN:T1','RFF+E66:D'])
 const aperak=encode('APERAK:D:04A:UN:E5SE5A',['BGM+312+A+9','ERC+100::260','RFF+ACW:T1'])
 it('a received UTILTS ERR may only get CONTRL/APERAK, never a new ERR',()=>{
  expect(()=>buildUtiltsErrDraft({sourceMessage:inbound(err,'UTILTS_ERR','ERR'),relatedTransactionReference:'X'})).toThrow(/UTILTS-ERR får endast besvaras med CONTRL och APERAK/)
 })
 it('a received APERAK gets neither APERAK nor ERR',()=>{
  expect(()=>buildAperakDraft({sourceMessage:inbound(aperak,'APERAK','APERAK')})).toThrow(/aldrig med APERAK/)
  expect(()=>buildUtiltsErrDraft({sourceMessage:inbound(aperak,'APERAK','APERAK')})).toThrow(/aldrig med APERAK/)
 })
})
