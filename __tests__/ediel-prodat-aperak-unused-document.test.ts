import {beforeEach,describe,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({rpc:vi.fn()}))
// This is only the external source-reading boundary. National validation,
// physical decoding and runtime admission below use their actual owners.
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {resolveCanonicalRuntimeDecision,resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {CANONICAL_ACK_GUIDE_CONSTRAINTS,validateCanonicalAckGuide} from '@/lib/ediel/rulebook/ackGuidePolicy'
import {validateRulebookMessage,validateRulebookMessageWithRegistry} from '@/lib/ediel/rulebook/validator'
import type {EdielMessageRow} from '@/lib/ediel/types'

const company='10000000-0000-4000-8000-000000000001'
const policy=resolveCanonicalEdielPolicy({family:'APERAK',messageCode:'APERAK',direction:'inbound',referenceDate:'2026-09-30',associationAssignedCode:'E2SE6A',applicationReference:'PRODAT',mode:'parse'})
function wire(bgm='BGM+++34',alternate=false) {
 return EdifactEnvelopeCodec.encode({sender:'GRID',receiver:'SUPPLIER',interchangeReference:'OWN-P-ACK',environment:'test',applicationReference:'PRODAT',acknowledgementRequest:false,...(alternate?{una:{componentDataElementSeparator:':',dataElementSeparator:';',releaseCharacter:'!',segmentTerminator:'~'}}:{}),messages:[{messageReference:'OWN-AP',messageTypeToken:'APERAK:D:96A:UN:E2SE6A',businessSegments:[bgm,'DTM+137:202609301200:203','NAD+FR+52100:160:SVK+++++++SE','NAD+DO+52101:160:SVK+++++++SE','RFF+ACW:ORIGINAL-P','ERC+41::260','FTX+AAO++209::260+Anläggnings-id saknas',...(bgm.endsWith('34')?['RFF+LI:ORIGINAL-LI','RFF+Z07:POINT']:[])]}]})
}
function guide(raw:string) {
 const decoded=tokenizeEdifact(raw)
 return validateCanonicalAckGuide({policy,rawSegments:decoded.segments.map(segment=>segment.raw),una:decoded.una})
}
const row=(raw:string)=>({id:'20000000-0000-4000-8000-000000000001',company_id:company,environment:'test',direction:'inbound',message_standard:'edifact',message_family:'APERAK',message_code:'APERAK',raw_payload:raw,message_received_at:'2026-09-30T12:00:00Z',created_at:'2026-09-30T12:00:00Z',parsed_payload:{}}) as unknown as EdielMessageRow
const input=(rawPayload:string)=>({family:'APERAK',code:'APERAK',direction:'inbound' as const,environment:'test' as const,companyId:company,rawPayload,mode:'parse' as const,admissionAt:'2026-09-30T12:00:00Z'})
beforeEach(()=>io.rpc.mockReset())

describe('frozen ACK-10: PRODAT APERAK BGM1001 and1004 are unused',()=>{
 it.each(['27','34'])('keeps the actual renderer shape BGM+++%s',functionCode=>{
  expect(guide(wire(`BGM+++${functionCode}`))).toEqual([])
 })
 it.each(['BGM+APERAK++34','BGM++OWN-DOCUMENT+34','BGM+APERAK+OWN-DOCUMENT+27','BGM+::260++34','BGM++:SECOND-COMPONENT+34','BGM++RELEASED?:DOCUMENT+34','BGM++ +34'])('rejects nonempty unused components in %s',bgm=>{
  expect(guide(wire(bgm)).filter(issue=>issue.code==='ACK_PRODAT_UNUSED_DOCUMENT_ELEMENT')).toHaveLength(1)
 })
 it('publishes the same component positions consumed by the actual guide',()=>{
  expect(CANONICAL_ACK_GUIDE_CONSTRAINTS.PRODAT.unusedDocumentElements).toEqual([1,2])
 })
 it('uses the shared UNA decoder for empty and released nonempty unused elements',()=>{
  expect(guide(wire('BGM+++34',true))).toEqual([])
  expect(guide(wire('BGM++RELEASED?:DOCUMENT+34',true)).some(issue=>issue.code==='ACK_PRODAT_UNUSED_DOCUMENT_ELEMENT')).toBe(true)
 })
 it('keeps both known own references under the full directory gate without replying to the bad APERAK',()=>{
  const decision=resolveCanonicalRuntimeDecision(row(wire('BGM++OWN-DOCUMENT+34')))
  expect(decision.syntaxDecision).toBe('rejected')
  expect(decision.issues.some(issue=>issue.code==='UNSM_MESSAGE_STRUCTURE_INVALID')).toBe(true)
  expect(decision.applicationDecision).toBe('not_applicable')
  expect(decision.responsePlan.some(response=>response.family==='APERAK'||response.family==='UTILTS_ERR')).toBe(false)
 })
 it('rejects through raw manual/API validation and registry admission before external original lookup',async()=>{
  const raw=wire('BGM+APERAK++34')
  for(const result of [validateRulebookMessage(input(raw)),await validateRulebookMessageWithRegistry(input(raw))]) {
   expect(result.ok).toBe(false)
   expect(result.issues.some(issue=>issue.code==='ACK_PRODAT_UNUSED_DOCUMENT_ELEMENT'&&issue.blocking)).toBe(true)
  }
  const decision=await resolveCanonicalRuntimeDecisionWithRegistry(row(raw))
  expect(decision.syntaxDecision).toBe('rejected')
  expect(decision.applicationDecision).toBe('not_applicable')
  expect(io.rpc).not.toHaveBeenCalled()
 })
})
