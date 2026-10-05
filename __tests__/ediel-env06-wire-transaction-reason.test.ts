// masterplan: ENV-06, AT-ENV-06
import {describe,expect,it} from 'vitest'
import {resolveCanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {decideProdatAperak} from '@/lib/ediel/decisionEngine'
import {renderAperakEdiel} from '@/lib/ediel/aperakEngine'
import {buildProfiledProdatSegments} from '@/lib/ediel/prodat/builders/profileRenderer'
import {renderProdatDocumentHeader} from '@/lib/ediel/prodat/prodatDocumentFields'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {validateCanonicalPolicyFields} from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import {validateRulebookMessage} from '@/lib/ediel/rulebook/validator'
import {projectProdatDiagnostics,isQualifiedProdatApplicationError} from '@/lib/ediel/prodat/prodatDiagnosticProjection'
import {alphabets,raw,line,characteristic,type Parts} from './fixtures/prodat-register'
import {head,source} from './fixtures/prodat-identity'

// Original P26.A r3 pp14,42,64–65,89,91,93,122. Literal wire/function
// expectations do not come from the renderer or subtype registry under test.
const point='735123456789012345'
function object(reason:string|null='Z22',sequence='1',id=point,li='CASE'):Parts[]{return [
 line(sequence,id,undefined,'9'),['DTM',['92','202610010000','203']],
 ...(reason===null?[]:characteristic('Z13',reason)),...characteristic('Z04','Z01'),
 ['RFF',['LI',li]],['RFF',['Z05','NET']],['RFF',['ANJ','AGREEMENT']],
 ['NAD','UD',['001','','89'],'','Synthetic','Street','City','','12345','SE'],
 ['NAD','Z02',['54321','160','SVK'],'','','','','','','SE'],
]}
const payload=(reason:string|null='Z22',code='Z03',alphabet:readonly string[]=alphabets[0])=>raw([...head(),...object(reason)],code,alphabet)
const validation=(wire:string)=>validateRulebookMessage({family:'PRODAT',direction:'inbound',rawPayload:wire,mode:'parse',businessDate:'2026-09-17',admissionAt:'2026-09-17T12:00:00Z'})
const policy=(code='Z04')=>resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:code,subtypeOrReasonCode:'L',direction:'inbound',referenceDate:'2026-09-17',associationAssignedCode:'E2SE6A',applicationReference:'23-DDQ-PRODAT',mode:'parse'})
function field223(wire:string,code='Z04'){
 const tokens=tokenizeEdifact(wire)
 return validateCanonicalPolicyFields({policy:policy(code),rawPayload:wire,rawSegments:tokens.segments.map(s=>s.raw),una:tokens.una})
  .filter(i=>i.prodatDiagnostic?.kind==='field'&&i.prodatDiagnostic.fieldNumber==='223')
}

describe('ENV06 physical function and transaction reason',()=>{
 it.each(['L','Z03L','Z22'])('renders internal %s as BGM Z03 and CAV Z22',variant=>{
  const result=buildProfiledProdatSegments({context:{code:'Z03',bgmReference:'DOC',transactionReference:'CASE',senderEdielId:'12345',receiverEdielId:'54321',meterPointId:point,customerId:'001',customerIdAgency:'89',customerName:'Synthetic',startDate:'2026-10-01',reasonForTransaction:'Z22'},variant,generatedAt:new Date('2026-09-17T12:00:00Z')})
  expect(result.segments[0]).toBe('BGM+Z03+DOC+9+AB')
  expect(result.segments).toEqual(expect.arrayContaining(['CCI++Z13','CAV+Z22']))
  expect(result.segments.some(s=>s.startsWith('BGM+Z03L'))).toBe(false)
 })
 it('refuses a suffixed BGM at the actual document renderer',()=>{
  expect(()=>renderProdatDocumentHeader({code:'Z03L',documentId:'DOC'})).toThrow('prodat_document_code_invalid')
 })
 for(const alphabet of alphabets){
  it(`accepts actual Z03/Z22 as Z03L using ${alphabet.join('')}`,()=>{
   const wire=payload('Z22','Z03',alphabet),decision=resolveCanonicalRuntimeDecision(source(wire,'Z03'))
   expect(decision).toMatchObject({syntaxDecision:'accepted',applicationDecision:'accepted',policy:{code:'Z03',subtype:'L',transactionReasonCode:'Z22'}})
   expect(decision.issues).toEqual([])
   expect(validation(wire).ok).toBe(true)
   expect(decision.responsePlan).toEqual(expect.arrayContaining([expect.objectContaining({family:'CONTRL',outcome:'positive'}),expect.objectContaining({family:'APERAK',outcome:'positive'})]))
   expect(decideProdatAperak({message:source(wire,'Z03'),testKind:'production'})).toMatchObject({kind:'ack',outcome:'positive',applicationErrors:[]})
  })
  for(const reason of ['L','E58','ZZZ'])it(`rejects physical Z03/${reason} as national42/223 using ${alphabet.join('')}`,()=>{
   const wire=payload(reason,'Z03',alphabet),message=source(wire,'Z03'),decision=resolveCanonicalRuntimeDecision(message)
   expect(decision.syntaxDecision).toBe('accepted')
   expect(decision.applicationDecision).toBe('rejected')
   expect(decision.responsePlan.find(p=>p.family==='CONTRL')).toMatchObject({outcome:'positive'})
   const errors=decision.responsePlan.find(p=>p.family==='APERAK')?.applicationErrors
   expect(errors).toEqual([expect.objectContaining({ercCode:'42',fieldCode:'223',referenceQualifier:'Z07',referenceNumber:point,lineItemReference:'CASE',text:`Felaktigt Transaktionstyp (undertyp) ${reason}`,prodatOccurrence:expect.objectContaining({scope:'object',messageReference:'M',lineIndex:0,objectId:point,lineItemReference:'CASE'})})])
   expect(errors?.every(isQualifiedProdatApplicationError)).toBe(true)
   const validated=validation(wire)
   expect(validated.ok).toBe(false)
   expect(projectProdatDiagnostics(validated.issues).applicationErrors).toEqual(expect.arrayContaining([expect.objectContaining({ercCode:'42',fieldCode:'223'})]))
   const publicDecision=decideProdatAperak({message,testKind:'production'})
   expect(publicDecision).toMatchObject({kind:'ack',outcome:'negative',applicationErrors:[expect.objectContaining({ercCode:'42',fieldCode:'223',referenceNumber:point,lineItemReference:'CASE'})]})
   const rendered=renderAperakEdiel({source:{id:message.id,messageFamily:'PRODAT',messageCode:'Z03',rawPayload:wire,messageReceivedAt:message.message_received_at},refs:{},externalReference:'ACK',transactionReference:'ACK',outcome:'negative',applicationErrors:errors})
   expect(rendered.segments).toEqual(expect.arrayContaining(['BGM+++34','ERC+42::260',`FTX+AAO++223::260+Felaktigt Transaktionstyp (undertyp) ${reason}`,`RFF+Z07:${point}`,'RFF+LI:CASE']))
  })
  for(const [code,reason] of [['Z03L','Z22'],['Z03','Z03L']])it(`rejects directory length ${code}/${reason} before application using ${alphabet.join('')}`,()=>{
   const decision=resolveCanonicalRuntimeDecision(source(payload(reason,code,alphabet),'Z03'))
   expect(decision).toMatchObject({syntaxDecision:'rejected',applicationDecision:'not_applicable',policy:null})
   expect(decision.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'UNSM_ELEMENT_LENGTH_INVALID'})]))
   expect(decision.responsePlan).toEqual([expect.objectContaining({family:'CONTRL',outcome:'negative'})])
  })
 }
 it('rejects absent national223 after accepted directory syntax with its own missing-field identity',()=>{
  const decision=resolveCanonicalRuntimeDecision(source(payload(null),'Z03'))
  expect(decision.syntaxDecision).toBe('accepted')
  expect(decision.applicationDecision).toBe('rejected')
  expect(decision.responsePlan.find(p=>p.family==='APERAK')?.applicationErrors).toEqual([expect.objectContaining({ercCode:'41',fieldCode:'223',referenceNumber:point,lineItemReference:'CASE'})])
 })
 it('does not assign a national error to the directory-rejected empty mandatory CAV',()=>{
  const decision=resolveCanonicalRuntimeDecision(source(payload(''),'Z03'))
  expect(decision).toMatchObject({syntaxDecision:'rejected',applicationDecision:'not_applicable'})
  expect(decision.responsePlan).toEqual([expect.objectContaining({family:'CONTRL',outcome:'negative'})])
 })
})

describe('ENV06 source field223 never borrows another own scope',()=>{
 it('rejects the second object independently of a valid root subtype',()=>{
  const wire=raw([...head(),...object('Z22'),...object('L','2','735123456789012346','CASE-B')],'Z03')
  const errors=projectProdatDiagnostics(field223(wire,'Z03')).applicationErrors
  expect(errors).toEqual([expect.objectContaining({ercCode:'42',fieldCode:'223',referenceNumber:'735123456789012346',lineItemReference:'CASE-B',prodatOccurrence:expect.objectContaining({lineIndex:1})})])
 })
 it('does not borrow header or sibling Z22 for an absent first-object reason',()=>{
  const wire=raw([...head(),...characteristic('Z13','Z22'),...object(null),...object('Z22','2','735123456789012346','CASE-B')],'Z03')
  const errors=projectProdatDiagnostics(field223(wire,'Z03')).applicationErrors
  expect(errors).toEqual([expect.objectContaining({ercCode:'41',fieldCode:'223',referenceNumber:point,lineItemReference:'CASE'})])
 })
 for(const first of ['Z22',null])it(`later register cannot replace first ${first??'missing'} reason`,()=>{
  const firstBody=object(first);firstBody[0]=line('1',point,'1','9')
  const second=[line('2',point,'2','9'),...characteristic('Z13','Z22')]
  const errors=projectProdatDiagnostics(field223(raw([...head(),...firstBody,...second],'Z04'))).applicationErrors
  expect(errors).toEqual(first===null?[expect.objectContaining({ercCode:'41',fieldCode:'223',referenceNumber:point,lineItemReference:'CASE'})]:[])
 })
 it('requires one physical own pair, not a convenient first valid reason',()=>{
  const body=object('Z22');body.splice(4,0,...characteristic('Z13','L'))
  const errors=projectProdatDiagnostics(field223(raw([...head(),...body],'Z03'),'Z03')).applicationErrors
  expect(errors).toEqual([expect.objectContaining({ercCode:'42',fieldCode:'223',referenceNumber:point,lineItemReference:'CASE'})])
 })
 it('holds ambiguous own references without inventing a field223 wire rejection',()=>{
  const body=object('L');body.splice(6,0,['RFF',['LI','OTHER']])
  const wire=raw([...head(),...body],'Z03'),decision=resolveCanonicalRuntimeDecision(source(wire,'Z03'))
  expect(decision.syntaxDecision).toBe('accepted')
  expect(decision.prodatProcessingDisposition?.kind).toBe('internal_review')
  expect(decision.responsePlan.flatMap(p=>p.applicationErrors??[]).some(e=>e.fieldCode==='223')).toBe(false)
 })
})
