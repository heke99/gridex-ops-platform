import { describe, expect, it } from 'vitest'
import { buildProfiledProdatSegments } from '@/lib/ediel/prodat/builders/profileRenderer'
import { renderProdat } from '@/lib/ediel/prodat/engine'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import { validateEdielMessageRowWithRulebook } from '@/lib/ediel/rulebook/validator'
import { preflightEdielMessageRow } from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import { createProdatRegisterEvidence } from '@/lib/ediel/prodat/prodatRegisterEvidence'
import { assertRulebookAllowsSend } from '@/lib/ediel/rulebook/sendGuards'
import { assertEdielSendLock } from '@/lib/ediel/transport/sendLock'
import type { ProdatEngineProductionContext } from '@/lib/ediel/prodat/types'
import type { ProdatDependentConditionFacts } from '@/lib/ediel/prodat/prodatDependentConditionEngine'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { line, qty, characteristic, raw, input, alphabets } from './fixtures/prodat-register'

const context: ProdatEngineProductionContext = {
 code:'Z04',bgmReference:'DOC',transactionReference:'CASE',senderEdielId:'12345',receiverEdielId:'54321',
 meterPointId:'A:local',meterPointIdAgency:'89',customerId:'USER',customerName:'Synthetic',customerIdAgency:'89',gridAreaId:'TES',
 startDate:'202610010000',observationLength:'15',observationLengthFormat:'806',reasonForTransaction:'Z22',
 registers:[{annualConsumption:'10'},{annualConsumption:'20'}],
 dependentConditionFacts:{market:'electricity',registerObjects:[{meteringPointId:'A:local',identityAgency:'89',expectedRegisterCount:2,meterReadingsSentInUtilts:false}]},
}
function rendered() { return buildProfiledProdatSegments({context,variant:'L',mode:'test',generatedAt:new Date('2026-09-17T12:00:00Z')}) }
function message(payload:string,metadata?:unknown):EdielMessageRow {
 return {message_family:'PRODAT',message_code:'Z04',message_version:'26A',direction:'outbound',environment:'test',message_standard:'edifact',
 application_reference:'23-DDQ-PRODAT',company_id:'tenant-A',raw_payload:payload,mime_type:'application/EDIFACT',parsed_payload:metadata} as EdielMessageRow
}
function renderedMessage() {
 const r=rendered()
 return message("UNH+M+PRODAT:D:97A:UN:E2SE6A'"+r.segments.join("'")+"'UNT+1+M'",{prodatEngine:r.diagnostics})
}
const localIssue=(i:{code:string;fieldPath?:string|null})=> /REGISTER/.test(i.code) || i.code==='PRODAT_DEPENDENT_CONDITION_UNDETERMINED' && ['LIN/C829/1082','CCI++Z02/CAV','CCI++Z05/CAV','CCI++Z16/CAV'].includes(i.fieldPath??'')
const reason=()=>characteristic('Z13','Z22')
const scoped=(body:ReturnType<typeof line>[],facts:ProdatDependentConditionFacts,scope:'all'|'dependent_only'='all')=> {
 const p=resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:'Z04',subtypeOrReasonCode:'L',direction:'outbound',referenceDate:'2026-09-17',mode:'catalog_evidence',prodatDependentFacts:facts})
 const policy={...p,fieldRules:p.fieldRules.filter(f=> 'fieldNumber' in f && ['314','209','258','213','214','218','259'].includes(String(f.fieldNumber)))}
 const wire=input(raw(body))
 return validateCanonicalPolicyFields({policy,rawSegments:wire.rawSegments,una:wire.una,scope})
}

describe('register evidence is carried from server rendering to the actual row send gates',()=>{
 it('profile diagnostics preserve an independent copy of per-object facts',()=>{
  const diagnostics=rendered().diagnostics as unknown as {registerEvidence:{facts:ProdatDependentConditionFacts}}
  expect(diagnostics.registerEvidence?.facts.registerObjects).toEqual(context.dependentConditionFacts?.registerObjects)
  expect(diagnostics.registerEvidence?.facts.registerObjects).not.toBe(context.dependentConditionFacts?.registerObjects)
 })
 it('the canonical engine also preserves per-object evidence in its diagnostics',()=>{
  const result=renderProdat({code:'Z04',mode:'test',variant:'L',context,actor:{senderEdielId:'12345',receiverEdielId:'54321'},route:{applicationReference:'23-DDQ-PRODAT'},version:{selectedVersion:'E2SE6A',messageTypeToken:'PRODAT:D:97A:UN:E2SE6A'},generatedAt:new Date('2026-09-17T12:00:00Z')})
  expect((result.diagnostics as unknown as {registerEvidence:{facts:ProdatDependentConditionFacts}}).registerEvidence?.facts.registerObjects).toEqual(context.dependentConditionFacts?.registerObjects)
 })
 it('row rulebook re-evaluates register decisions from the preserved facts rather than a global status',()=>{
  const result=validateEdielMessageRowWithRulebook(renderedMessage(),'send')
  expect(result.issues.filter(localIssue)).toEqual([])
 })
 for(const environment of ['test','production'] as const) {
  it(`${environment}: a metadata-free unknown register condition is not a warning`,()=>{
   const m={...message(raw([line('1','A'),...reason(),qty('10')])),environment}
   const result=validateEdielMessageRowWithRulebook(m,'send')
   expect(result.blocking).toBe(true)
   expect(result.issues.filter(i=>i.code==='PRODAT_DEPENDENT_CONDITION_UNDETERMINED' && localIssue(i)).every(i=>i.severity==='error' && i.blocking)).toBe(true)
  })
 }
 it('even the explicit invalid-test-send escape cannot suppress register uncertainty',()=>{
  const m=message(raw([line('1','A'),...reason(),qty('10')]),{rulebookAllowInvalidSend:true})
  expect(()=>assertRulebookAllowsSend(m)).toThrow(/register|Register|REGISTER/)
 })
 it('row preflight blocks unknown register decisions in test mode before transport',()=>{
  const m=message(raw([line('1','A'),...reason(),qty('10')]))
  expect(preflightEdielMessageRow(m,'send').issues.some(i=>i.code.startsWith('PRODAT_REGISTER_') && i.severity==='error')).toBe(true)
  expect(()=>assertEdielSendLock(m)).toThrow(/register|Register|REGISTER/)
 })
 it('syntax-only inbound row parsing does not invent absent business facts',()=>{
  const result=preflightEdielMessageRow({...message(raw([line('1','A'),...reason(),qty('10')])),direction:'inbound'},'parse')
  expect(result.issues.some(i=>i.code.includes('UNDETERMINED'))).toBe(false)
 })
 it('changing a rendered object or its body invalidates previously attached register evidence',()=>{
  const m=renderedMessage(); m.raw_payload=m.raw_payload!.replace('QTY+31:20','QTY+31:21')
  expect(validateEdielMessageRowWithRulebook(m,'send').issues.some(i=>i.code==='PRODAT_REGISTER_EVIDENCE_INVALID')).toBe(true)
  expect(preflightEdielMessageRow(m,'send').issues.some(i=>i.code==='PRODAT_REGISTER_EVIDENCE_INVALID')).toBe(true)
 })
 it('malformed persisted facts fail closed instead of turning strings into booleans',()=>{
  const m=renderedMessage()
  const metadata=m.parsed_payload as unknown as {prodatEngine:{registerEvidence:{facts:{registerObjects:Record<string,unknown>[]}}}}
  // On the baseline this object has no evidence at all; the missing property is
  // itself the expected red test, not a production incident.
  expect(metadata.prodatEngine.registerEvidence).toBeDefined()
  metadata.prodatEngine.registerEvidence.facts.registerObjects[0].meterReadingsSentInUtilts='false'
  expect(validateEdielMessageRowWithRulebook(m,'send').issues.some(i=>i.code==='PRODAT_REGISTER_EVIDENCE_INVALID')).toBe(true)
 })
})

describe('expected object inventory and dependent-only topology',()=>{
 const a={meteringPointId:'A',identityAgency:'89' as const,expectedRegisterCount:2,meterReadingsSentInUtilts:false}
 const b={meteringPointId:'B',identityAgency:'89' as const,expectedRegisterCount:1,meterReadingsSentInUtilts:true}
 const body=()=>[line('1','A','1'),...reason(),qty('10'),line('2','A','2'),qty('20')]
 it('an expected whole object absent from the wire is reported',()=>{
  expect(scoped(body(),{market:'electricity',registerObjects:[a,b]}).some(i=>i.code==='PRODAT_REGISTER_EXPECTED_OBJECT_MISSING')).toBe(true)
 })
 it('an explicit inventory with no matching wire objects is not accepted vacuously',()=>{
  expect(scoped([],{market:'electricity',registerObjects:[a]}).some(i=>i.code==='PRODAT_REGISTER_EXPECTED_OBJECT_MISSING')).toBe(true)
 })
 for(const count of [0,1,3,1.5,1000000]) it(`rejects invalid/mismatched independently expected register count ${count}`,()=>{
  expect(scoped(body(),{market:'electricity',registerObjects:[{...a,expectedRegisterCount:count}]}).some(i=>i.blocking)).toBe(true)
 })
 it('duplicate fact records never create an unambiguous authority',()=>expect(scoped(body(),{market:'electricity',registerObjects:[a,a]}).some(i=>i.blocking)).toBe(true))
 it('an explicit missing object record cannot inherit another object’s or global reading flag',()=>{
  const rows=[...body(),line('3','B'),...reason(),qty('30')]
  expect(scoped(rows,{market:'electricity',meterReadingsSentInUtilts:false,registerObjects:[a]}).some(i=>i.code==='PRODAT_REGISTER_EVIDENCE_UNDETERMINED')).toBe(true)
  expect(scoped(rows,{market:'electricity',registerObjects:[a,b]}).some(i=>i.blocking)).toBe(true)
  const own=[...rows,...characteristic('Z02','1',3),...characteristic('Z05','6',3),...characteristic('Z16','111',3)]
  expect(scoped(own,{market:'electricity',registerObjects:[a,b]})).toEqual([])
 })
 for(const alphabet of alphabets) it(`dependent_only still checks the actual register topology ${alphabet.join('')}`,()=>{
  const p=resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:'Z04',subtypeOrReasonCode:'L',direction:'outbound',referenceDate:'2026-09-17',mode:'catalog_evidence',prodatDependentFacts:{market:'electricity',meterReadingsSentInUtilts:false}})
  const wire=input(raw([line('1','A','1'),...reason(),qty('10'),line('2','A','1'),qty('20')],'Z04',alphabet))
  expect(validateCanonicalPolicyFields({policy:p,rawSegments:wire.rawSegments,una:wire.una,scope:'dependent_only'}).some(i=>i.code==='PRODAT_REGISTER_STRUCTURE_INVALID')).toBe(true)
 })
})


describe('the intentional-invalid-test flag cannot suppress register syntax',()=>{
 for(const [name,segments] of [
  ['invalid own constant',[line('1','A'),...reason(),qty('10'),...characteristic('Z02','bad')]],
  ['invalid annual syntax',[line('1','A'),...reason(),qty('-1')]],
 ] as const)it(name,()=>{
  const payload=raw([...segments]); const wire=input(payload)
  const evidence=createProdatRegisterEvidence({code:'Z04',rawSegments:wire.rawSegments,una:wire.una,facts:{market:'electricity',registerObjects:[{meteringPointId:'A',identityAgency:'9',expectedRegisterCount:1,meterReadingsSentInUtilts:false}]}})
  const m=message(payload,{rulebookAllowInvalidSend:true,prodatEngine:{registerEvidence:evidence}})
  expect(()=>assertRulebookAllowsSend(m)).toThrow(/register|Register|REGISTER/)
 })
})
