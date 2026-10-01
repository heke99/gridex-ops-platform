import {describe,expect,it} from 'vitest'
import {renderAperakEdiel} from '@/lib/ediel/aperakEngine'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {escapeEdifactValue} from '@/lib/ediel/core/edifactSerializer'
import {runUtiltsRuntimeForMessage} from '@/lib/ediel/utiltsEngine'
import {energyHandoffMessage} from './helpers/utiltsObservationHandoff'
import {recountEdifactUnt} from './helpers/recountEdifactUnt'
import {buildAperakDraft} from '@/lib/ediel/ack'
import {edielDraftWire} from './helpers/edielDraftWire'
import {validateCanonicalAckGuide} from '@/lib/ediel/rulebook/ackGuidePolicy'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'

const document=' OWN:A+B?C'
function source(reference=document,customUna=false){
 const message=energyHandoffMessage()
 message.raw_payload=message.raw_payload!.replace('GRIDEX2607E66MSG001',escapeEdifactValue(reference))
 if(customUna){
  const wire=tokenizeEdifact(message.raw_payload),unh=wire.segments.find(t=>t.tag==='UNH')!
  message.raw_payload=EdifactEnvelopeCodec.encode({sender:'91100',receiver:'21660',interchangeReference:'260831181101',applicationReference:'23-DDQ-E66-T',environment:'test',acknowledgementRequest:true,
   una:{componentDataElementSeparator:'*',dataElementSeparator:';',decimalMark:'.',releaseCharacter:'!',repetitionSeparator:' ',segmentTerminator:'~'},messages:[{messageReference:'1',messageTypeToken:'UTILTS:D:02B:UN:E5SE5A',businessSegments:wire.segments.slice(unh.index+1,wire.segments.findIndex(t=>t.tag==='UNT')).map(t=>t.raw)}]})
 }
 return message
}
function render(message=source(),negative=false){
 const runtime=negative?runUtiltsRuntimeForMessage(message):null
 return renderAperakEdiel({source:{id:message.id,messageFamily:'UTILTS',messageCode:'CACHED-WRONG',rawPayload:message.raw_payload,messageReceivedAt:message.message_received_at,externalReference:'CACHED-ROW'},
  refs:{documentReference:'CACHED-DOC',messageReference:'CACHED-UNH',interchangeReference:'CACHED-UNB'},externalReference:'OWN-ACK',transactionReference:'OWN-DM',outcome:negative?'negative':'positive',
  utiltsHeaderRejected:runtime?.ackPlan.utiltsHeaderRejection!==null&&runtime?.ackPlan.utiltsHeaderRejection!==undefined,applicationErrors:runtime?.ackPlan.utiltsHeaderRejection?.applicationErrors})
}
function doc(result:ReturnType<typeof render>){
 const wire=tokenizeEdifact(result.segments.map(t=>t+"'").join('')),docs=wire.segments.filter(t=>t.tag==='DOC')
 return docs.map(t=>({code:segmentComposite(t,1,wire.una),reference:segmentComposite(t,2,wire.una)}))
}
describe('ACK-03 A503/A504 exact present physical original',()=>{
 it.each([false,true])('copies the decoded own BGM through release/UNA=%s, ignoring cached references and code',customUna=>{
  const result=render(source(document,customUna))
  expect(doc(result)).toEqual([{code:['E66','SVK','260'],reference:[document]}])
  expect(result.diagnostics.previousMessageReference).toBe(document)
  expect(result.segments).toContain('DOC+E66:SVK:260+'+escapeEdifactValue(document))
 })
 it.each([false,true])('preserves DOC in the actual ACK adapter/envelope and shared source guide with alternate UNA=%s',customUna=>{
  const message=source(document,customUna)
  message.message_code='CACHED-WRONG';message.external_reference='CACHED-ROW'
  message.parsed_payload={documentReference:'CACHED-DOC',messageReference:'CACHED-UNH'}
  const draft=buildAperakDraft({sourceMessage:message,outcome:'positive'}),wire=tokenizeEdifact(edielDraftWire(draft)),originalDoc=wire.segments.find(t=>t.tag==='DOC')!
  expect(segmentComposite(originalDoc,1,wire.una)).toEqual(['E66','SVK','260'])
  expect(segmentComposite(originalDoc,2,wire.una)).toEqual([document])
  const policy=resolveCanonicalEdielPolicy({family:'APERAK',messageCode:'APERAK',direction:'outbound',referenceDate:'2026-10-01',associationAssignedCode:'E5SE5A',applicationReference:message.application_reference,mode:'send'})
  expect(validateCanonicalAckGuide({policy,rawSegments:wire.segments.map(t=>t.raw),una:wire.una,sourceRawPayload:message.raw_payload}).filter(issue=>issue.code==='ACK_UTILTS_ORIGINAL_DOCUMENT_MISMATCH')).toEqual([])
 })
 it('copies a long observed original into its own negative header response without truncation',()=>{
  const reference='OWN?:+'.repeat(10),message=source(reference)
  message.raw_payload=message.raw_payload!.replace('BGM+E66::260','BGM+E66::999')
  const result=render(message,true)
  expect(doc(result)).toEqual([{code:['E66','SVK','260'],reference:[reference]}])
  expect(result.segments.some(t=>t.startsWith('RFF+ACW:'))).toBe(false)
 })
 it('keeps absent original 203 absent in the national negative instead of copying UNH/row/generated identity',()=>{
  const result=render(source(''),true)
  expect(doc(result)).toEqual([{code:['E66','SVK','260'],reference:['']}])
  expect(result.diagnostics.previousMessageReference).toBe('')
 })
 it('rejects ambiguous physical original BGM before any cached-reference fallback',()=>{
  const message=source();message.raw_payload=recountEdifactUnt(message.raw_payload!.replace("BGM+E66::260+", "BGM+E66::260+OTHER+9+AB'\nBGM+E66::260+"))
  expect(()=>render(message)).toThrow('aperak_utilts_document_identity_ambiguous')
 })
 it('holds a positive render with no observed original 203',()=>{
  expect(()=>render(source(''))).toThrow('aperak_utilts_document_reference_required')
 })
})
