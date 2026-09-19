import { copyProdatEndUserAddressObjects } from '@/lib/ediel/prodat/prodatEndUserAddress'
import {describe,it,expect} from 'vitest'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {validateCanonicalPolicyFields} from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import {createProdatRegisterEvidence,readProdatRegisterEvidence} from '@/lib/ediel/prodat/prodatRegisterEvidence'
import {buildProfiledProdatSegments} from '@/lib/ediel/prodat/builders/profileRenderer'
import {buildProdatMessage} from '@/lib/ediel/prodat/buildProdat'
import {assertRulebookAllowsSend} from '@/lib/ediel/rulebook/sendGuards'
import {assertEdielSendLock} from '@/lib/ediel/transport/sendLock'
import {preflightEdielMessageRow} from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import {validateEdielMessageRowWithRulebook} from '@/lib/ediel/rulebook/validator'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {parseProdatMessage} from '@/lib/ediel/prodat/parser'
import {alphabets,raw,type Parts} from './fixtures/prodat-register'

const codes=['Z01','Z02','Z03','Z04','Z05','Z06','Z08','Z09']
// Independent synthetic source selection. Never read output to manufacture facts.
export const selection=(id='A',availability='available',addressLines=['Street:+?'],agency='89')=>({meteringPointId:id,identityAgency:agency,
 endUser:{id:'USER',qualifier:'',agency:'89'},availability,addressLines:availability==='available'?addressLines:[],
 source:{kind:'caller_selection',companyId:'tenant',reference:'synthetic-request-1'}})
const body=(code:string,address:string[]|string=['Street:+?'],id='A',reason='E34'):Parts[]=>[
 ['LIN','1','',[id,'','','89']],...(['Z06','Z09'].includes(code)?[['CCI','','Z13'],['CAV',reason]] as Parts[]:[]),
 ['NAD','UD',['USER','','89'],'','Synthetic',address,'Town','','12345','SE']]
const evaluate=(code:string,parts:Parts[],facts:any={},direction='outbound',alphabet:readonly string[]=alphabets[0])=>{
 const wire=tokenizeEdifact(raw(parts,code,alphabet))
 const policy=resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:code,direction,subtypeOrReasonCode:['Z06','Z09'].includes(code)?'E':code==='Z08'?'H':'L',referenceDate:'2026-09-19',applicationReference:'23-DDQ-PRODAT',mode:'catalog_evidence',prodatDependentFacts:facts} as never)
 return validateCanonicalPolicyFields({policy:{...policy,fieldRules:policy.fieldRules.filter((r:any)=>r.fieldNumber==='229')},rawSegments:wire.segments.map(s=>s.raw),una:wire.una})
}
for(const code of codes)describe(code,()=>{
 it('requires independent address selection despite root, byCell and populated output',()=>expect(evaluate(code,body(code),{endUserAddressAvailable:true,byCell:{[`${code}:229`]:true}}).some(i=>i.blocking)).toBe(true))
 it('requires available selected value',()=>expect(evaluate(code,body(code,''),{endUserAddressObjects:[selection()]}).some(i=>i.blocking)).toBe(true))
 it('forbids a value when source explicitly unavailable',()=>expect(evaluate(code,body(code),{endUserAddressObjects:[selection('A','unavailable')]}).some(i=>i.blocking)).toBe(true))
 it('permits known unavailable without removing UD',()=>expect(evaluate(code,body(code,''),{endUserAddressObjects:[selection('A','unavailable')]})).toEqual([]))
 it('matches the actual selected value, not just presence',()=>expect(evaluate(code,body(code,'Wrong'),{endUserAddressObjects:[selection()]}).some(i=>i.blocking)).toBe(true))
 it('does not demand local knowledge on inbound parse',()=>expect(evaluate(code,body(code),{},'inbound').filter(i=>i.code.includes('ADDRESS'))).toEqual([]))
 for(const alphabet of alphabets)it(`accepts exact own source under UNA ${alphabet.join('')}`,()=>expect(evaluate(code,body(code),{endUserAddressObjects:[selection()]},'outbound',alphabet)).toEqual([]))
})
describe('identity, parent and p118',()=>{
 for(const [name,facts] of [
  ['wrong object',[selection('B')]],['wrong agency',[selection('A','available',['Street:+?'],'9')]],
  ['duplicate',[selection(),selection()]],['extra',[selection(),selection('B')]],
  ['unknown',[selection('A','unknown')]],['wrong UD',[{...selection(),endUser:{id:'OTHER',qualifier:'',agency:'89'}}]],
  ['dot only',[selection('A','available',['.'])]],['too long',[selection('A','available',['X'.repeat(36)])]],
  ['fourth component',[selection('A','available',['a','','','b'])]],
 ] as const)it(`rejects ${name}`,()=>expect(evaluate('Z01',body('Z01'),{endUserAddressObjects:facts}).some(i=>i.blocking)).toBe(true))
 for(const reason of ['E64','E32'])it(`inactive Z06 ${reason} needs no address facts`,()=>expect(evaluate('Z06',body('Z06','', 'A',reason).slice(0,-1))).toEqual([]))
 it('missing own reason cannot become inactive through root subtype or unavailable facts',()=>expect(evaluate('Z06',body('Z06').filter(p=>p[0]!=='CCI'&&p[0]!=='CAV'),{endUserAddressObjects:[selection('A','unavailable')]}).some(i=>i.blocking)).toBe(true))
 it('requires dot for source absent street with known box/c-o',()=>{
  const facts={endUserAddressObjects:[selection('A','available',['','BOX','c/o Name'])]}
  expect(evaluate('Z01',body('Z01',['','BOX','c/o Name']),facts).some(i=>i.blocking)).toBe(true)
  expect(evaluate('Z01',body('Z01',['.','BOX','c/o Name']),facts)).toEqual([])
 })
 it('does not borrow another object address',()=>expect(evaluate('Z01',[...body('Z01'),...body('Z01','', 'B').map(p=>p[0]==='LIN'?['LIN','2',...p.slice(2)] as Parts:p)],{endUserAddressObjects:[selection(),selection('B')]}).some(i=>i.blocking)).toBe(true))
})
const context:any={code:'Z01',bgmReference:'D',transactionReference:'CASE',senderEdielId:'12345',receiverEdielId:'54321',meterPointId:'A',meterPointIdAgency:'89',customerId:'USER',customerIdAgency:'89',customerName:'Synthetic',customerAddressLines:['','BOX','c/o Name'],customerCity:'Town',customerPostalCode:'12345',customerCountry:'SE',reasonForTransaction:'E03',powerOfAttorneyReference:'POA',gridAreaId:'TES',startDate:'202610010000',dependentConditionFacts:{endUserAddressObjects:[selection('A','available',['','BOX','c/o Name'])]}}
const row=(r:any)=>({company_id:'tenant',direction:'outbound',environment:'test',message_family:'PRODAT',message_code:'Z01',message_version:'26A',application_reference:'23-DDQ-PRODAT',mime_type:'application/edifact',message_standard:'edifact',raw_payload:"UNH+M+PRODAT:D:97A:UN:E2SE6A'"+r.segments.join("'")+"'UNT+1+M'",parsed_payload:{prodatEngine:r.diagnostics,rulebookAllowInvalidSend:true}} as any)
describe('builders and persisted protected consumers',()=>{
 it('profile projects p118 without changing selected source and transports the fact',()=>{
  const r=buildProfiledProdatSegments({context,variant:'L',mode:'test'});expect(parseProdatMessage(r.segments.join("'")+"'").lineItems[0].endUserAddressLines).toEqual(['.','BOX','c/o Name'])
  expect((r.diagnostics as any).registerEvidence.facts.endUserAddressObjects[0].addressLines).toEqual(['','BOX','c/o Name'])
 })
 for(const clear of [null,[],undefined])it(`explicit snapshot clear does not inherit stale address ${String(clear)}`,()=>{
  const r=buildProfiledProdatSegments({context,variant:'L',mode:'test',portalSnapshot:{customerAddressLines:clear,customerAddress:null}})
  expect(r.issues.some(i=>i.code.includes('ADDRESS'))).toBe(true)
 })
 it('generic builder refuses unqualified address',()=>expect(()=>buildProdatMessage({companyId:'tenant',role:'supplier',businessCode:'Z01',transactionSubtype:'L',sender:{edielId:'12345'},receiver:{edielId:'54321'},meteringPoint:{id:'A',identityAgency:'89',gridArea:'TES'},customer:{id:'USER',idAgency:'89',name:'Synthetic',address:'Street'},dates:{contractStartDate:'202610010000'},references:{LI:'CASE',ANJ:'POA'},codedAttributes:{Z13:'E03'},environment:'test'})).toThrow(/address|adress|ADDRESS/))
 for(const snapshot of [true,false])it(`unknown address cannot bypass either guard with snapshot ${snapshot}`,()=>{
  const r=buildProfiledProdatSegments({context:{...context,dependentConditionFacts:undefined},variant:'L',mode:'test'});const m=row(r)
  if(!snapshot)delete m.parsed_payload.prodatEngine.dependentConditionStatuses
  expect(()=>assertRulebookAllowsSend(m)).toThrow(/ADDRESS|adress/)
  expect(()=>assertEdielSendLock(m)).toThrow(/ADDRESS|adress/)
 })
 it('cross-tenant evidence is rejected even with a matching body',()=>{
  const m=row(buildProfiledProdatSegments({context,variant:'L',mode:'test'}));m.company_id='other'
  expect(preflightEdielMessageRow(m,'send').blocking).toBe(true)
  expect(validateEdielMessageRowWithRulebook(m,'send').blocking).toBe(true)
 })
})

describe('untrusted source record types',()=>{
 for(const [key,value] of [['identityAgency',89],['availability',{toString:()=> 'available'}]] as const)it(`does not coerce ${key}`,()=>{
  expect(()=>copyProdatEndUserAddressObjects([{...selection(),[key]:value}])).toThrow()
 })
 it('does not coerce customer qualifier',()=>expect(()=>copyProdatEndUserAddressObjects([{...selection(),endUser:{id:'USER',qualifier:1,agency:'260'}}])).toThrow())
 it('does not coerce source kind',()=>expect(()=>copyProdatEndUserAddressObjects([{...selection(),source:{kind:{toString:()=> 'caller_selection'},companyId:'tenant',reference:'synthetic'}}])).toThrow())
})

it('rendered address diagnostics describe selected source rather than legacy root hints',()=>{
 const available=buildProfiledProdatSegments({context,variant:'L',mode:'test'})
 expect(available.diagnostics.dependentConditionStatuses).toContainEqual(expect.objectContaining({fieldNumber:'229',status:'required',decisionPhase:'rendered_wire_address'}))
 const unavailable=buildProfiledProdatSegments({context:{...context,customerAddressLines:[],dependentConditionFacts:{endUserAddressAvailable:true,endUserAddressObjects:[selection('A','unavailable')]}},variant:'L',mode:'test'})
 expect(unavailable.diagnostics.dependentConditionStatuses).toContainEqual(expect.objectContaining({fieldNumber:'229',status:'not_required',decisionPhase:'rendered_wire_address'}))
})

for(const replacement of [null,'Replacement'])it(`scalar snapshot ${replacement} does not revive old address lines`,()=>{
 const chosen=replacement?[replacement]:[]
 const r=buildProfiledProdatSegments({context,variant:'L',mode:'test',portalSnapshot:{customerAddress:replacement,dependentConditionFacts:{endUserAddressObjects:[selection('A',replacement?'available':'unavailable',chosen)]}}})
 expect(parseProdatMessage(r.segments.join("'")+"'").lineItems[0].endUserAddressLines).toEqual(replacement?chosen:[''])
 expect(r.issues.filter(i=>i.code.includes('ADDRESS'))).toEqual([])
})

for(const snapshot of ['missing','stale'] as const)it(`production ${snapshot} snapshot catch path retains address protection`,()=>{
 const r=buildProfiledProdatSegments({context:{...context,dependentConditionFacts:undefined},variant:'L',mode:'test'}),m=row(r)
 m.environment='production'
 if(snapshot==='missing')delete m.parsed_payload.prodatEngine.dependentConditionStatuses
 else m.parsed_payload.prodatEngine.dependentConditionStatuses=[{id:'Z01:obsolete',fieldNumber:'obsolete',status:'required'}]
 const result=validateEdielMessageRowWithRulebook(m,'send')
 expect(result.issues).toContainEqual(expect.objectContaining({scope:'prodat_dependent',code:'PRODAT_DEPENDENT_CONDITION_UNDETERMINED',blocking:true}))
 expect(()=>assertRulebookAllowsSend(m)).toThrow(/adress/)
 expect(()=>assertEdielSendLock(m)).toThrow(/adress/)
})
it('generic builder persists independently selected source without replacing source empty street',()=>{
 const selected=selection('A','available',['','BOX',"c/o :+?'"])
 const built=buildProdatMessage({companyId:'tenant',role:'supplier',businessCode:'Z01',transactionSubtype:'L',sender:{edielId:'12345'},receiver:{edielId:'54321'},meteringPoint:{id:'A',identityAgency:'89',gridArea:'TES'},customer:{id:'USER',idAgency:'89',name:'Synthetic',addressLines:['','BOX',"c/o :+?'"]},dates:{contractStartDate:'202610010000'},references:{LI:'CASE',ANJ:'POA'},codedAttributes:{Z13:'E03'},environment:'test',dependentConditionFacts:{endUserAddressObjects:[selected]} as any})
 const wire=tokenizeEdifact(built.rawEdifact), parsedPayload={prodatEngine:{registerEvidence:built.registerEvidence}}
 expect(readProdatRegisterEvidence({code:'Z01',rawSegments:wire.segments.map(s=>s.raw),una:wire.una,companyId:'tenant',parsedPayload})?.endUserAddressObjects).toEqual([selected])
 expect(parseProdatMessage(built.rawEdifact).lineItems[0].endUserAddressLines).toEqual(['.','BOX',"c/o :+?'"])
 const changed=tokenizeEdifact(built.rawEdifact.replace('BOX','ALTERED'))
 expect(()=>readProdatRegisterEvidence({code:'Z01',rawSegments:changed.segments.map(s=>s.raw),una:changed.una,companyId:'tenant',parsedPayload})).toThrow()
})
