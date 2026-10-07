import {describe,expect,it} from 'vitest'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {validateFieldMatrixPayload} from '@/lib/ediel/rulebook/fieldMatrix'
import {canonicalProdat26AFieldRules} from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import {omitSupplyEndField} from '../scripts/helpers/ediel-supply-end-field-omissions'
import {guideOrderedFixtureRaw} from './helpers/prodatGuideOrderedFixture'
import {line,characteristic,type Parts} from './fixtures/prodat-register'
import {head} from './fixtures/prodat-identity'
import {evaluateProdatInvoicee} from '@/lib/ediel/rulebook/prodatInvoiceePolicy'
import {evaluateProdatEndUserAddress} from '@/lib/ediel/rulebook/prodatEndUserAddressPolicy'
import type {ProdatDependentConditionFacts} from '@/lib/ediel/prodat/prodatDependentConditionEngine'
import {buildProfiledProdatSegments} from '@/lib/ediel/prodat/builders/profileRenderer'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {validateCanonicalPolicyFields} from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import type {ProdatInvoiceeObject,InvoiceeAddress} from '@/lib/ediel/prodat/prodatInvoicee'

// Literal P26.A r3 H05 requirements and independently authored physical data.
// The helper and production descriptor cannot supply the expected set.
const required=['311','312','202','203','313','205','206','207','208','314','209','211','223','260','226','227','228','231','232','316','233','234','262']
const body:Parts[]=[...head(),line('1','735123456789012345',undefined,'9'),['DTM',['93','202610161330','203']],...characteristic('Z13','Z25'),['RFF',['Z05','NET']],['RFF',['LI','OWN-END']],['NAD','UD',['199001011234','SE2','260'],'','Synthetic','Street','Town','','12345','SE'],['NAD','IT',['735123456789012345','','9'],'','','Site Street','Site Town','','12345','SE'],['NAD','Z02',['99876','160','SVK']]]
const wire=()=>guideOrderedFixtureRaw(body,'Z05')
function issues(raw:string){
 const t=tokenizeEdifact(raw)
 // This is a pure typed field consumer, not H bilateral/legal admission.
 return validateFieldMatrixPayload({family:'PRODAT',code:'Z05',direction:'inbound',mode:'parse',rawSegments:t.segments.map(x=>x.raw),una:t.una,
  applicationReference:segmentComposite(t.segments.find(x=>x.tag==='UNB'),7,t.una)[0],expectedApplicationReference:'23-DDQ-PRODAT'},
 canonicalProdat26AFieldRules('Z05').filter(x=>required.includes(x.fieldNumber??'')))
}

describe('independent H05 physical omission oracle and actual typed diagnostics',()=>{
 it('qualifies the unchanged valid H wire at the real field-policy consumer',()=>{
  expect(issues(wire())).toEqual([])
 })
 for(const field of required)it('actual consumer identifies omitted '+field+' using the independent physical path',()=>{
  const original=wire(),omitted=omitSupplyEndField(original,field)
  expect(omitted).not.toBe(original)
  expect(issues(original)).toEqual([])
  const own=issues(omitted).filter(x=>x.prodatDiagnostic?.kind==='field'&&x.prodatDiagnostic.fieldNumber===field)
  expect(own,JSON.stringify(issues(omitted))).not.toHaveLength(0)
  expect(own.every(x=>x.blocking!==false&&x.severity==='error')).toBe(true)
  const t=tokenizeEdifact(omitted),first=t.segments.findIndex(x=>x.tag==='UNH'),last=t.segments.findIndex(x=>x.tag==='UNT')
  expect(segmentComposite(t.segments[last],1,t.una)[0]).toBe(String(last-first+1))
 })
 it.each([['231',8,'12345'],['232',6,'Town'],['233',2,'735123456789012345::9'],['234',5,'Site Street']] as const)('preserves the other UD/IT components while omitting %s', (field,position,old)=>{
  const source=tokenizeEdifact(wire()),changed=tokenizeEdifact(omitSupplyEndField(wire(),field)),party=['231','232'].includes(field)?'UD':'IT'
  const a=source.segments.find(x=>x.tag==='NAD'&&segmentComposite(x,1,source.una)[0]===party)!.raw.split('+')
  const b=changed.segments.find(x=>x.tag==='NAD'&&segmentComposite(x,1,changed.una)[0]===party)!.raw.split('+')
  expect(a[position]).toBe(old)
  expect(b[position]).toBe(field==='233'?'::9':'')
  expect(b.filter((_,index)=>index!==position)).toEqual(a.filter((_,index)=>index!==position))
 })
 it('209 omission retains the actual C212 identity agency and all other physical objects',()=>{
  const t=tokenizeEdifact(omitSupplyEndField(wire(),'209'))
  expect(segmentComposite(t.segments.find(x=>x.tag==='LIN'),3,t.una)).toEqual(['','','','9'])
  expect(t.segments.find(x=>x.tag==='NAD'&&segmentComposite(x,1,t.una)[0]==='IT')!.raw).toContain('735123456789012345::9')
 })
 for(const field of ['207','208'])it('actual party consumer also refuses missing '+field+' country independently of its retained legal identity',()=>{
  const original=wire(),omitted=omitSupplyEndField(original,field+'country')
  expect(issues(original)).toEqual([])
  expect(issues(omitted).some(x=>x.prodatDiagnostic?.kind==='field'&&x.prodatDiagnostic.fieldNumber===field)).toBe(true)
  const t=tokenizeEdifact(omitted),party=t.segments.find(x=>x.tag==='NAD'&&segmentComposite(x,1,t.una)[0]===(field==='207'?'FR':'DO'))!
  expect(segmentComposite(party,2,t.una)[0]).toBeTruthy();expect(segmentComposite(party,9,t.una)[0]??'').toBe('')
 })
 it.each(['UD','IT'])('missing actual %s parent reaches the corresponding actual numeric field owner',parent=>{
  const typed=issues(omitSupplyEndField(wire(),parent)).filter(x=>x.prodatDiagnostic?.kind==='field').map(x=>x.prodatDiagnostic?.kind==='field'?x.prodatDiagnostic.fieldNumber:null)
  expect(typed).toContain(parent==='UD'?'227':'233')
 })
 it('refuses an absent independent target instead of returning an unchanged valid wire',()=>{
  expect(()=>omitSupplyEndField(wire(),'NOT-A-FIELD')).toThrow('native_omission_field_absent_NOT-A-FIELD')
 })
})

describe('actual optional H08 installation renderer and physical child consumer',()=>{
 function render(selected:boolean){
  // Catalog evidence permits pure protocol rendering. It grants no agreement,
  // producer, reception, signature, legal or transport authority.
  const policy=resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:'Z08',direction:'outbound',subtypeOrReasonCode:'H',referenceDate:'2026-10-07',applicationReference:'23-DDQ-PRODAT',mode:'catalog_evidence'})
  const rendered=buildProfiledProdatSegments({policy,context:{code:'Z08',bgmReference:'SYNTHETIC',transactionReference:'SYNTHETIC-H',senderEdielId:'12345',receiverEdielId:'54321',meterPointId:'735123456789012345',meterPointIdAgency:'9',customerId:'199001011234',customerIdCodeListQualifier:'SE2',customerIdAgency:'260',customerName:'Synthetic',customerAddress:'Street',customerPostalCode:'12345',customerCity:'Town',customerCountry:'SE',reasonForTransaction:'Z25',contractEndDate:'2026-10-16T12:30:00Z',...(selected?{siteAddress:'Site Street'}:{})},generatedAt:new Date('2026-10-07T12:00:00Z')})
  return EdifactEnvelopeCodec.encode({sender:'12345',receiver:'54321',senderQualifier:'ZZ',receiverQualifier:'ZZ',interchangeReference:'SYNTHETIC',applicationReference:'23-DDQ-PRODAT',acknowledgementRequest:true,environment:'test',messages:[{messageReference:'SYNTHETIC',messageTypeToken:'PRODAT:D:97A:UN:E2SE6A',businessSegments:rendered.segments}]})
 }
 it('actual renderer omits the optional parent when no installation address was selected',()=>{
  const t=tokenizeEdifact(render(false));expect(t.segments.filter(x=>x.tag==='NAD'&&segmentComposite(x,1,t.una)[0]==='IT')).toEqual([])
 })
 for(const field of ['233','234'])it('actual selected IT parent activates physical '+field+' without pretending the national original selected it',()=>{
  const raw=render(true),t=tokenizeEdifact(raw)
  expect(t.segments.filter(x=>x.tag==='NAD'&&segmentComposite(x,1,t.una)[0]==='IT')).toHaveLength(1)
  const policy=resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:'Z08',direction:'outbound',subtypeOrReasonCode:'H',referenceDate:'2026-10-07',applicationReference:'23-DDQ-PRODAT',mode:'catalog_evidence'})
  const evaluate=(wire:string)=>{const token=tokenizeEdifact(wire);return validateCanonicalPolicyFields({policy:{...policy,fieldRules:policy.fieldRules.filter(x=>'fieldNumber' in x&&['233','234'].includes(x.fieldNumber??''))},rawPayload:wire,rawSegments:token.segments.map(x=>x.raw),una:token.una})}
  expect(evaluate(raw)).toEqual([])
  expect(evaluate(omitSupplyEndField(raw,field)).some(x=>x.prodatDiagnostic?.kind==='field'&&x.prodatDiagnostic.fieldNumber===field)).toBe(true)
 })
})

describe('physical IV activation and actual address condition consumers',()=>{
 const withIv=()=>guideOrderedFixtureRaw([...body,['NAD','IV',['BILL','','89'],'','Invoicee','Invoice Street','Invoice Town','','54321','SE']],'Z05')
 const invoice=(raw:string)=>{const t=tokenizeEdifact(raw);return evaluateProdatInvoicee({code:'Z05',direction:'inbound',rawSegments:t.segments.map(x=>x.raw),una:t.una})}
 it('actual incoming IV consumer accepts the independent complete physical parent',()=>expect(invoice(withIv()).issues).toEqual([]))
 for(const field of ['250','251','253','317','318'])it('incoming active IV requires its own physical '+field,()=>{
  const original=withIv();expect(invoice(original).issues).toEqual([])
  const issues=invoice(omitSupplyEndField(original,field)).issues
  expect(issues.some(x=>x.prodatDiagnostic?.kind==='field'&&x.prodatDiagnostic.fieldNumber===field),JSON.stringify(issues)).toBe(true)
 })
 it('incoming unknown 252 availability is not manufactured from an active IV',()=>expect(invoice(omitSupplyEndField(withIv(),'252')).issues).toEqual([]))
 it('incoming absent IV does not activate its children',()=>expect(invoice(wire()).issues).toEqual([]))
 for(const availability of ['available','unavailable','unknown'] as const)it('actual outbound 229 consumes the independently selected '+availability+' address condition',()=>{
  const selected={meteringPointId:'735123456789012345',identityAgency:'9',endUser:{id:'199001011234',qualifier:'SE2',agency:'260'},availability,addressLines:availability==='available'?['Street']:[],source:{kind:'caller_selection',companyId:'SYNTHETIC',reference:'SYNTHETIC protocol source, not runtime authority'}}
  const evaluate=(raw:string)=>{const t=tokenizeEdifact(raw);return evaluateProdatEndUserAddress({code:'Z08',rawSegments:t.segments.map(x=>x.raw),una:t.una,facts:{endUserAddressObjects:[selected]} as ProdatDependentConditionFacts})}
  const original=guideOrderedFixtureRaw(body,'Z08'),omitted=omitSupplyEndField(original,'229')
  if(availability==='available'){
   expect(evaluate(original)).toEqual({issues:[],status:'required'})
   expect(evaluate(omitted).issues.some(x=>x.code==='PRODAT_END_USER_ADDRESS_VALUE_MISMATCH')).toBe(true)
  }else if(availability==='unavailable'){
   expect(evaluate(omitted)).toEqual({issues:[],status:'not_required'})
   expect(evaluate(original).issues.some(x=>x.code==='PRODAT_END_USER_ADDRESS_FORBIDDEN')).toBe(true)
  }else for(const raw of [original,omitted])expect(evaluate(raw).issues.some(x=>x.code==='PRODAT_DEPENDENT_CONDITION_UNDETERMINED')).toBe(true)
 })
 for(const availability of ['available','unavailable','unknown'] as const)it('actual outbound 252 distinguishes independently selected '+availability+' source components',()=>{
  const address=(street:string|null,postalCode:string,city:string):InvoiceeAddress=>({lines:[street,'',''],postalCode,city,country:'SE',representation:{convention:'SYNTHETIC source address convention',reference:'SYNTHETIC independent protocol input',mode:1}})
  const fact:ProdatInvoiceeObject={meteringPointId:'735123456789012345',identityAgency:'9',endUser:{identity:{id:'199001011234',qualifier:'SE2',agency:'260'},address:address('Street','12345','Town')},invoicee:{identity:{id:'BILL',qualifier:'',agency:'89'},nameLines:['Invoicee'],availability,address:address(availability==='available'?'Invoice Street':null,'54321','Invoice Town')},event:{state:'none',reference:'SYNTHETIC no change'},source:{kind:'caller_selection',companyId:'SYNTHETIC',reference:'SYNTHETIC protocol source, not live authority'}}
  const original=guideOrderedFixtureRaw([...body,['NAD','IV',['BILL','','89'],'','Invoicee','Invoice Street','Invoice Town','','54321','SE']],'Z08')
  const evaluate=(raw:string)=>{const t=tokenizeEdifact(raw);return evaluateProdatInvoicee({code:'Z08',direction:'outbound',rawSegments:t.segments.map(x=>x.raw),una:t.una,facts:{invoiceeObjects:[fact]}})}
  if(availability==='available'){
   expect(evaluate(original).issues).toEqual([]);expect(evaluate(original).statuses.get('252')).toBe('required')
   expect(evaluate(omitSupplyEndField(original,'252')).issues.some(x=>x.code==='PRODAT_INVOICEE_VALUE_MISMATCH')).toBe(true)
  }else if(availability==='unavailable'){
   const result=evaluate(omitSupplyEndField(original,'252'));expect(result.issues).toEqual([]);expect(result.statuses.get('252')).toBe('not_required')
  }else for(const raw of [original,omitSupplyEndField(original,'252')]){
   const result=evaluate(raw);expect(result.statuses.get('252')).toBe('undetermined');expect(result.issues.some(x=>x.code==='PRODAT_DEPENDENT_CONDITION_UNDETERMINED')).toBe(true)
  }
 })
})
