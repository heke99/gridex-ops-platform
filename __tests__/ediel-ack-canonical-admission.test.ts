import {beforeEach,describe,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({rpc:vi.fn(),rulePack:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry',()=>({resolveCanonicalRulePack:io.rulePack}))
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {validateEdifactSyntax} from '@/lib/ediel/core/syntaxValidator'
import {parseCanonicalMessageRow} from '@/lib/ediel/core/canonicalMessage'
import {resolveCanonicalMessagePolicy} from '@/lib/ediel/core/messagePolicy'
import {resolveCanonicalRuntimeDecision,resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {validateEdielMessageRowWithRulebook,validateRulebookMessageWithRegistry} from '@/lib/ediel/rulebook/validator'
import {validateCanonicalAckGuide} from '@/lib/ediel/rulebook/ackGuidePolicy'
import type {EdielMessageRow} from '@/lib/ediel/types'
const company='10000000-0000-4000-8000-000000000001',ackId='20000000-0000-4000-8000-000000000001',sourceId='30000000-0000-4000-8000-000000000001'
function wire(family:'CONTRL'|'APERAK'|'PRODAT'|'UTILTS',businessSegments:string[],source=false,prodat=false){return EdifactEnvelopeCodec.encode({sender:source?'TRANSPORT_S':'TRANSPORT_R',receiver:source?'TRANSPORT_R':'TRANSPORT_S',interchangeReference:source?'SOURCEI':'ACKI',environment:'test',acknowledgementRequest:family!=='CONTRL',applicationReference:prodat?'23-DDQ-PRODAT':'23-DDQ-E66-T',messages:[{messageReference:source?'SOURCEM':'ACKM',messageTypeToken:family==='CONTRL'?'CONTRL:2:2:UN:EDIEL2':family==='APERAK'?`APERAK:D:${prodat?'96A':'04A'}:UN:${prodat?'E2SE6A':'E5SE5A'}`:family==='PRODAT'?'PRODAT:D:97A:UN:E2SE6A':'UTILTS:D:02B:UN:E5SE5A',businessSegments}]})}
const uSource=()=>wire('UTILTS',['BGM+E66+SOURCEDOC+9','NAD+MS+LEGAL_S:SVK:260','NAD+MR+LEGAL_R:SVK:260','IDE+24+T1','IDE+24+T2'],true)
const pSource=()=>wire('PRODAT',['BGM+Z03+SOURCEDOC+9','NAD+FR+LEGAL_S:160:SVK+++++++SE','NAD+DO+LEGAL_R:160:SVK+++++++SE','LIN+1++POINT1:SVK:260','RFF+LI:LI1','CCI++Z13','CAV+Z22','LIN+2++POINT2:SVK:260','RFF+LI:LI2','CCI++Z13','CAV+Z22'],true,true)
const date=['DTM+137:202609301200:203','DTM+735:?+0100:406']
const uAck=(status='312',code='100',text='OK')=>wire('APERAK',[`BGM+${status}+ACKDOC+9`,...date,'DOC+E66::260+SOURCEDOC','NAD+MS+LEGAL_R:SVK:260','NAD+MR+LEGAL_S:SVK:260',`ERC+${code}::260`,code==='100'?`FTX+AAO+++${text}`:`FTX+AAO++209::260+${text}`,'RFF+DM:ACKT','RFF+ACW:T1'])
const pAck=(second=true)=>wire('APERAK',['BGM+APERAK+ACKDOC+34',date[0],'RFF+ACW:SOURCEDOC','NAD+FR+LEGAL_R:160:SVK+++++++SE','NAD+DO+LEGAL_S:160:SVK+++++++SE','ERC+100::260','FTX+AAO+++OK','RFF+Z07:POINT1','RFF+LI:LI1',...(second?['ERC+42::260','FTX+AAO++260::260+Felaktigt Nätområdesid BAD','RFF+Z07:POINT2','RFF+LI:LI2']:[])],false,true)
const row=(raw:string,family:'CONTRL'|'APERAK'|'PRODAT'='APERAK',direction:'inbound'|'outbound'='inbound')=>({id:direction==='inbound'?ackId:sourceId,company_id:company,environment:'test',direction,message_standard:'edifact',message_family:family,message_code:family,raw_payload:raw,message_received_at:'2026-09-30T12:00:00Z',created_at:'2026-09-30T12:00:00Z',message_sent_at:direction==='outbound'?'2026-09-30T11:00:00Z':null,immutable_rendered_at:direction==='outbound'?'2026-09-30T10:00:00Z':null,parsed_payload:{}}) as unknown as EdielMessageRow
const pack=()=>({rulePackId:'40000000-0000-4000-8000-000000000001',messageProfileId:'50000000-0000-4000-8000-000000000001',profileKey:'synthetic-original-profile',version:'original-version-at-send',sourceHash:'a'.repeat(64),snapshot:{version:'original-version-at-send'}})
const qualified=(raw=uSource())=>({version:1,sourceMessage:row(raw,'PRODAT','outbound'),sourceRulePackEvidence:pack()})
function guide(raw:string,source?:string){const m=row(raw,raw.includes('CONTRL')?'CONTRL':'APERAK'),policy=resolveCanonicalMessagePolicy(m)!;const tokens=tokenizeEdifact(raw);return validateCanonicalAckGuide({policy,rawSegments:tokens.segments.map(t=>t.raw),una:tokens.una,sourceRawPayload:source})}
beforeEach(()=>{io.rpc.mockReset();io.rulePack.mockReset();io.rpc.mockResolvedValue({data:qualified(),error:null})})
describe('actual source-bound ACK canonical admission, synthetic immutable port evidence',()=>{
 it('does not turn negative national results into rejection of a well-formed ACK',()=>{
  expect(guide(uAck('313','41','MANDATORY FIELD MISSING'),uSource())).toEqual([])
  expect(guide(pAck(),pSource())).toEqual([])
 })
 it.each([uAck('312','42','INCORRECT DATA BAD'),uAck('313','100'),uAck('312','100','NOT OK'),uAck().replace('RFF+DM:ACKT','RFF+DM:'),uAck().replace('NAD+MR+LEGAL_S','NAD+MR+')])('rejects malformed national ACK before original lookup',async raw=>{
  const m=row(raw),decision=await resolveCanonicalRuntimeDecisionWithRegistry(m)
  expect(decision.applicationDecision).toBe('rejected');expect(io.rpc).not.toHaveBeenCalled()
  expect(decision.responsePlan.some(response=>response.family==='APERAK')).toBe(false)
 })
 it('never mistakes technical transport actors for required juridical ACK actors',()=>{
  expect(guide(uAck().replace('NAD+MR+LEGAL_S','NAD+MR+TRANSPORT_S'),uSource()).some(issue=>issue.code==='ACK_APERAK_ORIGINAL_LEGAL_PARTY_MISMATCH')).toBe(true)
  expect(guide(uAck().replace('TRANSPORT_S:ZZ','TRANSPORT_S:ZZ:PRODAT')).some(issue=>issue.code==='ACK_UTILTS_PRODAT_SUBADDRESS_FORBIDDEN')).toBe(true)
 })
 it('admits a guide-correct APERAK only with exact immutable actual-original evidence',async()=>{
  const m=row(uAck());expect(resolveCanonicalRuntimeDecision(m)).toMatchObject({applicationDecision:'accepted',functionalDecision:'manual_review'})
  const decision=await resolveCanonicalRuntimeDecisionWithRegistry(m)
  expect(decision).toMatchObject({applicationDecision:'accepted',functionalDecision:'accepted',validationReport:{rulePackEvidence:{rulePackId:pack().rulePackId,sourceHash:pack().sourceHash}}})
  expect(io.rulePack).not.toHaveBeenCalled();expect(io.rpc).toHaveBeenCalledWith('gridex_read_inbound_ack_source_v1',{p_company_id:company,p_environment:'test',p_ack_message_id:ackId})
 })
 it('holds unavailable historical evidence without reading today\'s pack or inventing APERAK',async()=>{
  io.rpc.mockResolvedValue({data:{...qualified(),sourceRulePackEvidence:null},error:null})
  const decision=await resolveCanonicalRuntimeDecisionWithRegistry(row(uAck()))
  expect(decision.applicationDecision).toBe('manual_review');expect(decision.responsePlan.some(response=>response.family==='APERAK')).toBe(false);expect(io.rulePack).not.toHaveBeenCalled()
 })
 it('checks own P objects independently and requires every processed original object',()=>{
  expect(guide(pAck(false),pSource()).some(issue=>issue.code==='ACK_PRODAT_OBJECT_OUTCOME_MISSING')).toBe(true)
  expect(guide(pAck().replace('RFF+Z07:POINT2','RFF+Z07:POINT1'),pSource()).some(issue=>issue.code==='ACK_PRODAT_OWN_OBJECT_REFERENCE_MISMATCH')).toBe(true)
 })
 it('rejects foreign physical original transaction despite parsed source pointers',async()=>{
  const m=row(uAck().replace('RFF+ACW:T1','RFF+ACW:FOREIGN'));m.related_message_id=sourceId
  const decision=await resolveCanonicalRuntimeDecisionWithRegistry(m)
  expect(decision.applicationDecision).toBe('rejected')
 })
 it('uses the same guide constraints in raw send and registry parse consumers',async()=>{
  const m=row(uAck('312','42','INCORRECT DATA BAD'))
  expect(validateEdielMessageRowWithRulebook({...m,direction:'outbound'},'send').issues.some(issue=>issue.code==='ACK_UTILTS_DOCUMENT_TRANSACTION_OUTCOME_CONFLICT')).toBe(true)
  const good=row(uAck()),validation=await validateRulebookMessageWithRegistry({family:'APERAK',code:'APERAK',direction:'inbound',rawPayload:good.raw_payload,mode:'parse',messageRow:good})
  expect(validation).toMatchObject({ok:true,fieldRuleSource:'registry',rulePackSnapshot:{profileKey:pack().profileKey,checksum:pack().sourceHash}})
 })
 it('keeps a local registry incident internal without adding a national ACK finding',async()=>{
  io.rulePack.mockRejectedValue(new Error('local_registry_network_incident'))
  const m=row(pSource(),'PRODAT');m.message_code='Z03'
  const base=resolveCanonicalRuntimeDecision(m),decision=await resolveCanonicalRuntimeDecisionWithRegistry(m)
  expect(decision.applicationDecision).toBe('manual_review');expect(decision.functionalDecision).toBe('manual_review')
  expect(decision.responsePlan).toEqual(base.responsePlan.filter(response=>response.family==='CONTRL'))
  expect(decision.responsePlan.some(response=>response.family==='APERAK'||response.family==='UTILTS_ERR')).toBe(false)
  expect(decision.validationReport.failureDisposition).toMatchObject({kind:'internal_failure'})
 })
 it('preserves alternate service characters in real canonical ACK policy and exact UCI source identity',async()=>{
  const original=uSource(),raw=wire('CONTRL',['UCI+SOURCEI+TRANSPORT_S:ZZ+TRANSPORT_R:ZZ+1'])
  const alternative='UNA:*.! ~'+raw.slice(9).replace(/\+/g,'*').replace(/\?/g,'!').replace(/'/g,'~')
  const m=row(alternative,'CONTRL');expect(parseCanonicalMessageRow(m)).toMatchObject({family:'CONTRL',sender:'TRANSPORT_R',version:'EDIEL2'})
  expect(validateEdifactSyntax(m).ok).toBe(true);expect(guide(alternative,original)).toEqual([])
  const decision=await resolveCanonicalRuntimeDecisionWithRegistry(m);expect(decision.applicationDecision).toBe('accepted');expect(decision.functionalDecision).toBe('accepted');expect(decision.responsePlan).toEqual([])
 })
})
