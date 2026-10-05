// masterplan: ACK-02, AT-ACK-02
// BGM 27 (whole message rejected) with ERC 42 and the national field reference is
// proven in __tests__/ediel-prodat-common-header-rejection.test.ts (also tagged).
import {describe,expect,it,vi} from 'vitest'
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:vi.fn()}}))
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry',()=>({resolveCanonicalRulePack:vi.fn()}))
import {buildAperakDraft} from '@/lib/ediel/ack'
import {resolveProdatAckMessageFunction} from '@/lib/ediel/prodat/prodatAckMessageFunction'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {raw,line} from './fixtures/prodat-register'
import {head,source} from './fixtures/prodat-identity'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {resolveCanonicalMessagePolicy} from '@/lib/ediel/core/messagePolicy'
import {CANONICAL_ACK_GUIDE_CONSTRAINTS,validateCanonicalAckGuide} from '@/lib/ediel/rulebook/ackGuidePolicy'
const company='10000000-0000-4000-8000-000000000001',ackId='20000000-0000-4000-8000-000000000001',sourceId='30000000-0000-4000-8000-000000000001'
function wire(family:'CONTRL'|'APERAK'|'PRODAT'|'UTILTS',businessSegments:string[],source=false,prodat=false){return EdifactEnvelopeCodec.encode({sender:source?'TRANSPORT_S':'TRANSPORT_R',receiver:source?'TRANSPORT_R':'TRANSPORT_S',interchangeReference:source?'SOURCEI':'ACKI',environment:'test',acknowledgementRequest:family!=='CONTRL',applicationReference:prodat?'23-DDQ-PRODAT':'23-DDQ-E66-T',messages:[{messageReference:source?'SOURCEM':'ACKM',messageTypeToken:family==='CONTRL'?'CONTRL:2:2:UN:EDIEL2':family==='APERAK'?`APERAK:D:${prodat?'96A':'04A'}:UN:${prodat?'E2SE6A':'E5SE5A'}`:family==='PRODAT'?'PRODAT:D:97A:UN:E2SE6A':'UTILTS:D:02B:UN:E5SE5A',businessSegments}]})}
const pSource=()=>wire('PRODAT',['BGM+Z03+SOURCEDOC+9','DTM+137:202609301200:203','NAD+FR+LEGAL_S:160:SVK+++++++SE','NAD+DO+LEGAL_R:160:SVK+++++++SE','LIN+1++POINT1:SVK:260','CCI++Z13','CAV+Z22','RFF+LI:LI1','LIN+2++POINT2:SVK:260','CCI++Z13','CAV+Z22','RFF+LI:LI2'],true,true)
const date=['DTM+137:202609301200:203','DTM+735:?+0100:406']
const pAck=(second=true)=>wire('APERAK',['BGM+++34',date[0],'RFF+ACW:SOURCEDOC','NAD+FR+LEGAL_R:160:SVK+++++++SE','NAD+DO+LEGAL_S:160:SVK+++++++SE','ERC+100::260','FTX+AAO+++OK','RFF+Z07:POINT1','RFF+LI:LI1',...(second?['ERC+42::260','FTX+AAO++260::260+Felaktigt Nätområdesid BAD','RFF+Z07:POINT2','RFF+LI:LI2']:[])],false,true)
const row=(raw:string,family:'CONTRL'|'APERAK'|'PRODAT'='APERAK',direction:'inbound'|'outbound'='inbound')=>({id:direction==='inbound'?ackId:sourceId,company_id:company,environment:'test',direction,message_standard:'edifact',message_family:family,message_code:family,raw_payload:raw,message_received_at:'2026-09-30T12:00:00Z',created_at:'2026-09-30T12:00:00Z',message_sent_at:direction==='outbound'?'2026-09-30T11:00:00Z':null,immutable_rendered_at:direction==='outbound'?'2026-09-30T10:00:00Z':null,parsed_payload:{}}) as unknown as EdielMessageRow
function guide(raw:string,source?:string){const m=row(raw,raw.includes('CONTRL')?'CONTRL':'APERAK'),policy=resolveCanonicalMessagePolicy(m)!;const tokens=tokenizeEdifact(raw);return validateCanonicalAckGuide({policy,rawSegments:tokens.segments.map(t=>t.raw),una:tokens.una,sourceRawPayload:source})}

const point='735123456789012345'
const original=raw([...head(),line('1',point,undefined,'9'),['RFF',['LI','OWN-A']]],'Z06')
const sourceMessage={...source(original,'Z06'),company_id:'company'} as unknown as EdielMessageRow
const positive=()=>EdifactEnvelopeCodec.decode(buildAperakDraft({sourceMessage,outcome:'positive'}).rawPayload)
const values=(wire:ReturnType<typeof positive>,tag:string,qualifier?:string)=>wire.segments.filter(s=>s.tag===tag&&(!qualifier||segmentComposite(s,1,wire.una)[0]===qualifier))

describe('ACK-02 PRODAT APERAK (D96A/E2SE6A) structure',()=>{
 it('uses APERAK D96A/E2SE6A with BGM 1225=34 for a processed message and no own 1001/1004 id',()=>{
  const wire=positive()
  expect(wire.segments.find(s=>s.tag==='UNH')!.raw).toContain('APERAK:D:96A:UN:E2SE6A')
  const bgm=wire.segments.find(s=>s.tag==='BGM')!
  expect(bgm.raw).toBe('BGM+++34')
  expect(resolveProdatAckMessageFunction({sourceWire:tokenizeEdifact(original),hasProdatWire:true,messageCode:'Z06',outcome:'positive'})).toBe('34')
 })
 it('references the original BGM document id with ACW and builds RFF+Z07/LI with ERC 100 for the object',()=>{
  const wire=positive()
  const originalBgm=segmentComposite(tokenizeEdifact(original).segments.find(s=>s.tag==='BGM')!,2,tokenizeEdifact(original).una)[0]
  expect(values(wire,'RFF','ACW').map(s=>segmentComposite(s,1,wire.una)[1])).toEqual([originalBgm])
  expect(values(wire,'ERC').map(s=>segmentComposite(s,1,wire.una)[0])).toEqual(['100'])
  expect(values(wire,'RFF','Z07').map(s=>segmentComposite(s,1,wire.una)[1])).toEqual([point])
  expect(values(wire,'RFF','LI').map(s=>segmentComposite(s,1,wire.una)[1])).toEqual(['OWN-A'])
 })
 it('never uses UTILTS APERAK BGM 312/313, DOC/DM or a transaction ACW for PRODAT',()=>{
  const wire=positive()
  expect(wire.segments.filter(s=>s.tag==='BGM').map(s=>s.raw).join()).not.toMatch(/312|313/)
  expect(wire.segments.some(s=>s.tag==='DOC')).toBe(false)
  expect(values(wire,'RFF','DM')).toEqual([])
  expect(values(wire,'RFF','ACW').map(s=>segmentComposite(s,1,wire.una)[1])).not.toContain('OWN-A')
 })
})

describe('ACK-02 PRODAT ERC 40/41/42 with the correct field or special error reference',()=>{
 const P=CANONICAL_ACK_GUIDE_CONSTRAINTS.PRODAT
 const objectError=(erc:string,ftx:string)=>pAck().replace('ERC+42::260',`ERC+${erc}::260`).replace('FTX+AAO++260::260+Felaktigt Nätområdesid BAD',ftx)
 const issues=(raw:string)=>guide(raw,pSource()).map(issue=>issue.code)
 const label=P.fieldLabels['260']
 const [appCode,appText]=Object.entries(P.applicationTexts)[0] as [string,string]
 it('admits 42 "Felaktigt <field> <value>", 41 "<field> saknas" and 40 with its prescribed application text',()=>{
  expect(issues(pAck())).toEqual([])
  expect(issues(objectError('41',`FTX+AAO++260::260+${label}${P.missingSuffix}`))).toEqual([])
  expect(issues(objectError('40',`FTX+AAO++${appCode}::260+${appText}`))).toEqual([])
 })
 it('rejects a wrong 41 text, an unknown field reference and a 40 without its prescribed application text',()=>{
  expect(issues(objectError('41','FTX+AAO++260::260+Något annat'))).toContain('ACK_PRODAT_MISSING_TEXT_INVALID')
  expect(issues(objectError('41','FTX+AAO++999::260+X saknas'))).toContain('ACK_PRODAT_FIELD_REFERENCE_UNKNOWN')
  expect(issues(objectError('40',`FTX+AAO++${appCode}::260+Annan text`))).toContain('ACK_PRODAT_APPLICATION_TEXT_INVALID')
 })
})
