// masterplan: ACK-03, AT-ACK-03, ACK-10, AT-ACK-10
import {describe,expect,it,vi} from 'vitest'
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:vi.fn()}}))
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry',()=>({resolveCanonicalRulePack:vi.fn()}))
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {resolveCanonicalMessagePolicy} from '@/lib/ediel/core/messagePolicy'
import {validateCanonicalAckGuide} from '@/lib/ediel/rulebook/ackGuidePolicy'
import {buildAperakDraft} from '@/lib/ediel/ack'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {raw as prodatRaw,line} from './fixtures/prodat-register'
import {head,source} from './fixtures/prodat-identity'
const company='10000000-0000-4000-8000-000000000001',ackId='20000000-0000-4000-8000-000000000001',sourceId='30000000-0000-4000-8000-000000000001'
function wire(family:'CONTRL'|'APERAK'|'PRODAT'|'UTILTS',businessSegments:string[],source=false,prodat=false){return EdifactEnvelopeCodec.encode({sender:source?'TRANSPORT_S':'TRANSPORT_R',receiver:source?'TRANSPORT_R':'TRANSPORT_S',interchangeReference:source?'SOURCEI':'ACKI',environment:'test',acknowledgementRequest:family!=='CONTRL',applicationReference:prodat?'23-DDQ-PRODAT':'23-DDQ-E66-T',messages:[{messageReference:source?'SOURCEM':'ACKM',messageTypeToken:family==='CONTRL'?'CONTRL:2:2:UN:EDIEL2':family==='APERAK'?`APERAK:D:${prodat?'96A':'04A'}:UN:${prodat?'E2SE6A':'E5SE5A'}`:family==='PRODAT'?'PRODAT:D:97A:UN:E2SE6A':'UTILTS:D:02B:UN:E5SE5A',businessSegments}]})}
const uSource=()=>wire('UTILTS',['BGM+E66+SOURCEDOC+9','DTM+137:202609301200:203','DTM+735:?+0100:406','MKS+23+E02::260','NAD+MS+LEGAL_S:SVK:260','NAD+MR+LEGAL_R:SVK:260','NAD+DDQ',...['T1','T2'].flatMap(reference=>[`IDE+24+${reference}`,'LOC+172+POINT::9','LIN+++8716867000030:::9','DTM+324:202609010000202609010015:719','STS+7++E88::260','MEA+AAZ++KWH','SEQ++1','QTY+136:1','DTM+597:202609010000:203'])],true)
const pSource=()=>wire('PRODAT',['BGM+Z03+SOURCEDOC+9','DTM+137:202609301200:203','NAD+FR+LEGAL_S:160:SVK+++++++SE','NAD+DO+LEGAL_R:160:SVK+++++++SE','LIN+1++POINT1:SVK:260','CCI++Z13','CAV+Z22','RFF+LI:LI1','LIN+2++POINT2:SVK:260','CCI++Z13','CAV+Z22','RFF+LI:LI2'],true,true)
const date=['DTM+137:202609301200:203','DTM+735:?+0100:406']
const uAck=(status='312',code='100',text='OK')=>wire('APERAK',[`BGM+${status}+ACKDOC+9`,...date,'DOC+E66::260+SOURCEDOC','NAD+MS+LEGAL_R:SVK:260','NAD+MR+LEGAL_S:SVK:260','NAD+DDQ',`ERC+${code}::260`,code==='100'?`FTX+AAO+++${text}`:`FTX+AAO++209::260+${text}`,'RFF+DM:ACKT','RFF+ACW:T1'])
const pAck=(second=true)=>wire('APERAK',['BGM+++34',date[0],'RFF+ACW:SOURCEDOC','NAD+FR+LEGAL_R:160:SVK+++++++SE','NAD+DO+LEGAL_S:160:SVK+++++++SE','ERC+100::260','FTX+AAO+++OK','RFF+Z07:POINT1','RFF+LI:LI1',...(second?['ERC+42::260','FTX+AAO++260::260+Felaktigt Nätområdesid BAD','RFF+Z07:POINT2','RFF+LI:LI2']:[])],false,true)
const row=(raw:string,family:'CONTRL'|'APERAK'|'PRODAT'='APERAK',direction:'inbound'|'outbound'='inbound')=>({id:direction==='inbound'?ackId:sourceId,company_id:company,environment:'test',direction,message_standard:'edifact',message_family:family,message_code:family,raw_payload:raw,message_received_at:'2026-09-30T12:00:00Z',created_at:'2026-09-30T12:00:00Z',message_sent_at:direction==='outbound'?'2026-09-30T11:00:00Z':null,immutable_rendered_at:direction==='outbound'?'2026-09-30T10:00:00Z':null,parsed_payload:{}}) as unknown as EdielMessageRow
function guide(raw:string,source?:string){const m=row(raw,raw.includes('CONTRL')?'CONTRL':'APERAK'),policy=resolveCanonicalMessagePolicy(m)!;const tokens=tokenizeEdifact(raw);return validateCanonicalAckGuide({policy,rawSegments:tokens.segments.map(t=>t.raw),una:tokens.una,sourceRawPayload:source})}
const codes=(raw:string,src:string)=>guide(raw,src).map(issue=>issue.code)

describe('ACK-03 UTILTS APERAK D04A/E5SE5A structure',()=>{
 it('admits 312 positive and 313 negative with DOC to the original type/BGM, own DM and ACW to the original IDE',()=>{
  expect(codes(uAck('312','100','OK'),uSource())).toEqual([])
  expect(codes(uAck('313','42','INCORRECT DATA BAD'),uSource())).toEqual([])
 })
 it('keeps positive and negative transactions in separate APERAKs',()=>{
  expect(codes(uAck('313','100'),uSource())).toContain('ACK_UTILTS_DOCUMENT_TRANSACTION_OUTCOME_CONFLICT')
  expect(codes(uAck('312','42','INCORRECT DATA BAD'),uSource())).toContain('ACK_UTILTS_DOCUMENT_TRANSACTION_OUTCOME_CONFLICT')
  const mixed=uAck('313','42','INCORRECT DATA BAD').replace('RFF+ACW:T1',"RFF+ACW:T1'ERC+100::260'FTX+AAO+++OK'RFF+DM:ACKT2'RFF+ACW:T2")
  expect(codes(mixed,uSource())).toContain('ACK_UTILTS_DOCUMENT_TRANSACTION_OUTCOME_CONFLICT')
 })
 it('rejects a missing or foreign DOC, an ACW to a non-existing original IDE, PRODAT BGM 34 and the PRODAT profile',()=>{
  expect(codes(uAck().replace("DOC+E66::260+SOURCEDOC'",''),uSource())).toContain('ACK_UTILTS_ORIGINAL_DOCUMENT_MISMATCH')
  expect(codes(uAck().replace('DOC+E66::260+SOURCEDOC','DOC+E66::260+OTHER'),uSource())).toContain('ACK_UTILTS_ORIGINAL_DOCUMENT_MISMATCH')
  expect(codes(uAck().replace('RFF+ACW:T1','RFF+ACW:NOPE'),uSource())).toContain('ACK_UTILTS_ORIGINAL_TRANSACTION_MISMATCH')
  expect(codes(uAck().replace('BGM+312+ACKDOC+9','BGM+++34'),uSource())).toContain('ACK_UTILTS_BGM_STATUS_INVALID')
  expect(codes(uAck().replace('APERAK:D:04A:UN:E5SE5A','APERAK:D:96A:UN:E2SE6A'),uSource()).length).toBeGreaterThan(0)
 })
})

describe('ACK-10 PRODAT APERAK BGM carries 27/34 only in 1225',()=>{
 it('admits BGM+++34 and rejects 1001/1004 content or a 27/34 placed in 1001',()=>{
  expect(codes(pAck(false),pSource())).toEqual([])
  expect(codes(pAck(false).replace('BGM+++34','BGM+APERAK+ACKD+34'),pSource())).toContain('ACK_PRODAT_UNUSED_DOCUMENT_ELEMENT')
  expect(codes(pAck(false).replace('BGM+++34','BGM+34'),pSource())).toContain('ACK_PRODAT_MESSAGE_FUNCTION_INVALID')
  expect(codes(pAck(false).replace('BGM+++34','BGM+312+A+9'),pSource())).toContain('ACK_PRODAT_MESSAGE_FUNCTION_INVALID')
 })
 it('the builder emits BGM+++34 with ACW to the original BGM and no own BGM id',()=>{
  const original=prodatRaw([...head(),line('1','735123456789012345',undefined,'9'),['RFF',['LI','OWN-A']]],'Z06')
  const draft=buildAperakDraft({sourceMessage:{...source(original,'Z06'),company_id:company} as unknown as EdielMessageRow,outcome:'positive'})
  const wire=EdifactEnvelopeCodec.decode(draft.rawPayload)
  expect(wire.segments.filter(s=>s.tag==='BGM').map(s=>s.raw)).toEqual(['BGM+++34'])
  expect(wire.segments.filter(s=>s.tag==='RFF'&&s.raw.startsWith('RFF+ACW:')).map(s=>s.raw)).toEqual(['RFF+ACW:D'])
 })
})
