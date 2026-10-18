// masterplan: AT-Z03C-SUPPLIER
// Z03C origination required-field sweep through the actual outbound cancellation
// builder (lib/ediel/intent/renderers/switchCancellation.ts) and the whole
// canonical policy validator. Every Z03 "R" field of the frozen 26.A matrix and
// each "D" field whose condition the builder's own facts meet is omitted
// individually from the built bytes and must produce its own diagnostic.
// Finite protected RPC/row ports as in ediel-switch-cancellation-source.test.ts;
// no native, physical ACK or whole-contract claim.
import {beforeEach,describe,expect,it,vi} from 'vitest'
import {createHash} from 'node:crypto'
import {raw,line,characteristic,alphabets} from './fixtures/prodat-register'
import {head} from './fixtures/prodat-identity'
import {createFakeSupabase,type Row} from './helpers/supabaseMock'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {validateCanonicalPolicyFields} from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {readProdatParty} from '@/lib/ediel/prodat/prodatPartyFields'
import {readSwitchCancellationSource} from '@/lib/ediel/production/switchCancellationSource'
const io=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:io}))
vi.mock('@/lib/ediel/core/versionRegistry',()=>({resolveCanonicalOutboundVersion:vi.fn(async()=> '26.A')}))
import {buildSwitchCancellationDraft} from '@/lib/ediel/intent/renderers/switchCancellation'
import type {SwitchCancellationBasis} from '@/lib/ediel/production/switchCancellationSource'
import type {EdielMessageIntent} from '@/lib/ediel/intent/types'
import type {resolveCanonicalOutboundContext} from '@/lib/ediel/core/kernel'
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
function fixture(){
 const basis:SwitchCancellationBasis={status:'authorized',companyId:id(1),environment:'test',switchRequestId:id(2),originalMessageId:id(3),originalHash:'a'.repeat(64),operationId:id(4),intentId:id(10),outboundRequestId:id(21),messageId:null,customerId:id(5),siteId:id(22),meteringPointId:id(6),legalActorId:id(7),legalSenderId:'12345',legalReceiverId:'54321',pointId:'735123456789012345',identityAgency:'9',gridArea:'TES',li:'ORIGINAL:EXACT+LI',startAt:'2027-01-01T00:00:00+01:00',originalSubtype:'L',deadline:'2026-12-28',customerIdentity:'5566778899',customerQualifier:'SE1',customerName:'SYNTHETIC CUSTOMER',sourceObject:{},requestedMethod:'Z03'}
 const intent:EdielMessageIntent={id:id(10),companyId:id(1),environment:'test',market:'electricity',messageFamily:'PRODAT',messageCode:'Z03',businessProcess:'supplier_switch',direction:'outbound',senderEdielId:'99111',receiverEdielId:'54321',applicationReference:'23-DDQ-PRODAT',routeProfileId:id(11),communicationRouteId:id(12),customerId:id(5),meteringPointId:basis.pointId,operationId:id(4),interchangeReference:'SYNTHETIC-BRP-UNB',messageReference:'1',transactionReference:basis.li,idempotencyKey:'SYNTHETIC-BRP-EVENT',payload:{actorRole:'supplier',transactionSubtype:'C'},validationStatus:'validated',renderStatus:'not_rendered',outboxStatus:'not_queued'}
 const route={companyId:id(1),environment:'test',actor:{tenantIdentity:{legalActorId:id(7)},legalActorEdielId:'12345',marketRoles:['electricity_supplier']},senderEdielId:'99111',receiverEdielId:'54321',senderSubAddress:null,receiverSubAddress:null,receiverMessageSubAddress:null,applicationReference:'23-DDQ-PRODAT',route:{id:id(12)},routeRuntime:{route_profile_id:id(11)},mailbox:null,receiverEmail:'dso@example.invalid'} as Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>
 return{basis,intent,routeContext:route,actorUserId:id(20),outboundRequestId:id(21)}
}
// Finite protected RPC/row ports; actual helper, builder, grammar and full policy.
// No live SQL/native permission or whole cancellation acceptance is asserted.
let originals:Row[]
let billing:Row[]
let switches:Row[]
let reads:ReturnType<typeof createFakeSupabase>[]
function originalWire(f:ReturnType<typeof fixture>,agreement='ORIGINAL:AGREEMENT+EXACT',alphabet:readonly string[]=alphabets[0]){
 return raw([...head(),line('1',f.basis.pointId,undefined,f.basis.identityAgency),
  ['DTM',['92','202701010000','203']],...characteristic('Z13',f.basis.originalSubtype==='L'?'Z22':'Z23'),
  ...characteristic('Z04',f.basis.requestedMethod),['RFF',['LI',f.basis.li]],['RFF',['Z05',f.basis.gridArea]],
  ['RFF',['ANJ',agreement]],['NAD','UD',[f.basis.customerIdentity,f.basis.customerQualifier,'260'],'',f.basis.customerName,'Original Street','Original City','','12345','SE'],['NAD','Z02',['11111','160','SVK']]], 'Z03',alphabet)
}
function declareOriginal(f:ReturnType<typeof fixture>,wire=originalWire(f)){
 f.basis.originalHash=createHash('sha256').update(wire).digest('hex')
 // Declared protected-source DTO from this exact original at declaration time.
 // The independent native source is mocked; later mutable row edits cannot
 // replace its original wire, dated source or payload hash.
 const sourceWire=tokenizeEdifact(wire),sourceUser=readProdatParty('UD',sourceWire.segments,sourceWire.una)
 const originalMasterdata={nameParts:[...sourceUser.nameLines],streetParts:sourceUser.addressLines[0]==='.'?['',...sourceUser.addressLines.slice(1)]:[...sourceUser.addressLines],
  postalCode:sourceUser.postalCode,city:sourceUser.city,country:sourceUser.country}

 reads=[]
 originals=[{id:f.basis.originalMessageId,company_id:f.basis.companyId,environment:f.basis.environment,
  direction:'outbound',message_standard:'edifact',message_family:'PRODAT',message_code:'Z03',customer_id:f.basis.customerId,intent_id:id(80),communication_route_id:id(81),created_by:f.actorUserId,
  immutable_rendered_at:'2026-10-06T12:00:00Z',immutable_payload_hash:f.basis.originalHash,raw_payload:wire}]
 switches=[{id:f.basis.switchRequestId,company_id:f.basis.companyId,customer_id:f.basis.customerId,site_id:f.basis.siteId,customer_site_id:f.basis.siteId,metering_point_id:f.basis.meteringPointId,contract_id:id(70),customer_contract_id:id(70)}]
 billing=[{id:id(70),company_id:f.basis.companyId,customer_id:f.basis.customerId,invoice_recipient:null,billing_street:null,billing_city:null,billing_postal_code:null,billing_country:null,billing_address_same_as_site:true}]
 io.rpc.mockImplementation(async(name:string)=>{
  if(name==='ediel_switch_cancellation_source_v1')return{data:f.basis,error:null}
  if(name==='ediel_switch_cancellation_customer_masterdata_basis_v1')return{data:{status:'authorized',companyId:f.basis.companyId,customerId:f.basis.customerId,environment:f.basis.environment,asOf:'2026-10-06T12:00:00Z',sourceKind:'registered_customer_address',sourceReference:'synthetic-original-registered-address',sourceDigest:'b'.repeat(64),sourceContextId:id(71),customerIdentity:{id:f.basis.customerIdentity,qualifier:f.basis.customerQualifier,agency:'260'},endUserMasterdata:originalMasterdata,cancellationSourceBinding:{switchRequestId:f.basis.switchRequestId,actorUserId:f.actorUserId,originalMessageId:f.basis.originalMessageId,originalHash:f.basis.originalHash,environment:f.basis.environment,originalPreparerId:originals[0].created_by},messageBinding:{id:f.basis.originalMessageId,environment:f.basis.environment,intentId:id(80),routeId:id(81),payloadHash:f.basis.originalHash}},error:null}
  throw Error('undeclared_rpc:'+name)
 })
 io.from.mockImplementation((table:string)=>{
  if(!['ediel_messages','supplier_switch_requests','customer_contracts'].includes(table))throw Error('undeclared_table:'+table)
  const db=createFakeSupabase({tables:{ediel_messages:originals,supplier_switch_requests:switches,customer_contracts:billing}})
  reads.push(db)
  const q=db.client.from(table)
  return Object.assign(q,{returns:()=>q})
 })
 return wire
}
async function qualify(f:ReturnType<typeof fixture>,wire=originalWire(f)){
 declareOriginal(f,wire)
 const basis=await readSwitchCancellationSource({companyId:f.basis.companyId,switchRequestId:f.basis.switchRequestId,actorUserId:f.actorUserId})
 if(basis.status!=='authorized')throw Error('fixture_held:'+JSON.stringify(basis));f.basis=basis
}

import {PRODAT_26A_FIELD_MATRIX,PRODAT_26A_MESSAGE_CODES} from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import {decideProdatLifecycle} from '@/lib/ediel/stateMachines/prodatLifecycle'
beforeEach(()=>vi.clearAllMocks())
type Built=Awaited<ReturnType<typeof buildSwitchCancellationDraft>>['draft']
const factsOf=(draft:Built)=>(draft.parsedPayload as {prodatEngine:{registerEvidence:{facts:object}}}).prodatEngine.registerEvidence.facts
function recountAny(wire:string){const t=tokenizeEdifact(wire),s=t.segments.findIndex(x=>x.tag==='UNH'),e=t.segments.findIndex(x=>x.tag==='UNT');return wire.replace(/UNT\+\d+\+/,`UNT+${e-s+1}+`)}
function blocking(raw:string,facts:object){
 const wire=recountAny(raw),t=tokenizeEdifact(wire)
 const policy=resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:'Z03',subtypeOrReasonCode:'C',direction:'outbound',referenceDate:'2026-10-08',applicationReference:'23-DDQ-PRODAT',mode:'parse',prodatDependentFacts:facts as never})
 return validateCanonicalPolicyFields({policy,rawPayload:wire,rawSegments:t.segments.map(s=>s.raw),una:t.una}).filter(i=>i.blocking)
}
function mutators(w:string){
 const at=(pre:string)=>{const a=w.split("'"),i=a.findIndex(x=>x.startsWith(pre));expect(i,pre).toBeGreaterThan(0);return [a,i] as const}
 const drop=(pre:string,n=1)=>{const [a,i]=at(pre);a.splice(i,n);return a.join("'")}
 const blank=(pre:string,el:number,c?:number)=>{const [a,i]=at(pre),e=a[i].split('+');expect(e[el],pre+'#'+el).toBeTruthy()
  if(c===undefined)e[el]='';else{const q=e[el].split(':');expect(q[c]).toBeTruthy();q[c]='';e[el]=q.join(':')}a[i]=e.join('+');return a.join("'")}
 return {drop,blank}
}
const z03=PRODAT_26A_MESSAGE_CODES.indexOf('Z03')
const required=PRODAT_26A_FIELD_MATRIX.filter(r=>r.requirements[z03]==='R').map(r=>r.fieldNumber)
const dependent=PRODAT_26A_FIELD_MATRIX.filter(r=>r.requirements[z03]==='D').map(r=>r.fieldNumber)
async function built(separateInvoicee=false){
 const f=fixture();declareOriginal(f)
 if(separateInvoicee)Object.assign(billing[0],{invoice_recipient:'Synthetic Invoicee',billing_street:'Invoice Street',billing_postal_code:'54321',billing_city:'Invoice City',billing_country:'SE',billing_address_same_as_site:false})
 const basis=await readSwitchCancellationSource({companyId:f.basis.companyId,switchRequestId:f.basis.switchRequestId,actorUserId:f.actorUserId})
 if(basis.status!=='authorized')throw Error('fixture_held:'+JSON.stringify(basis))
 const {draft}=await buildSwitchCancellationDraft({...f,basis})
 return {draft,raw:draft.rawPayload!,facts:factsOf(draft)}
}
const omissions:Record<string,(m:ReturnType<typeof mutators>,w:string)=>string>={
 '311':(_,w)=>w.replace('++23-DDQ-PRODAT','++'),'312':(_,w)=>w.replace('UN:E2SE6A','UN:'),'202':(_,w)=>w.replace('BGM+Z03+','BGM++'),
 '203':m=>m.blank('BGM+',2),'313':m=>m.blank('BGM+',4),'205':m=>m.drop('DTM+137'),'206':m=>m.drop('DTM+ZZZ'),'207':m=>m.drop('NAD+FR'),'208':m=>m.drop('NAD+DO'),
 '314':m=>m.blank('LIN+',1),'209':m=>m.blank('LIN+',3,0),'210':m=>m.drop('DTM+92'),'217':m=>m.drop('CCI++Z04',2),'223':m=>m.drop('CCI++Z13',2),
 '260':m=>m.drop('RFF+Z05'),'261':m=>m.drop('RFF+ANJ'),'226':m=>m.drop('RFF+LI'),'227':m=>m.blank('NAD+UD',2),'228':m=>m.blank('NAD+UD',4),
 '231':m=>m.blank('NAD+UD',8),'232':m=>m.blank('NAD+UD',6),'316':m=>m.blank('NAD+UD',9),'262':m=>m.blank('NAD+Z02',2),
}
it('builds a complete Z03C (DDQ/BGM Z03/223 Z24) with no blocking issue before omissions',async()=>{
 const {raw,facts}=await built()
 expect(raw).toContain('+23-DDQ-PRODAT');expect(raw).toContain('BGM+Z03+');expect(raw).toContain("CCI++Z13'CAV+Z24'")
 expect(blocking(raw,facts)).toEqual([])
 expect(required.filter(field=>/^\d+$/.test(field)&&!(field in omissions))).toEqual([])
 expect(required).toContain('END_USER_GROUP')
})
it.each(required.filter(field=>/^\d+$/.test(field)))('holds individually omitted required Z03C field %s with its own diagnostic',async field=>{
 const {raw,facts}=await built(),mutated=omissions[field](mutators(raw),raw)
 expect(mutated).not.toBe(raw)
 expect(blocking(mutated,facts)).toContainEqual(expect.objectContaining({prodatDiagnostic:expect.objectContaining({fieldNumber:field})}))
})
it('holds a missing NAD+UD group and each of its required children',async()=>{
 const {raw,facts}=await built(),issues=blocking(mutators(raw).drop('NAD+UD'),facts)
 expect(issues).toContainEqual(expect.objectContaining({code:'FIELD_MATRIX_REQUIRED_FIELD_MISSING',fieldPath:'NAD+UD'}))
 for(const field of ['227','228','231','232','316'])expect(issues).toContainEqual(expect.objectContaining({prodatDiagnostic:expect.objectContaining({fieldNumber:field,errorKind:'missing'})}))
})
describe('Z03C dependent fields with their condition met by the builder facts',()=>{
 it('the asserted D set is the frozen Z03 column',()=>{for(const field of ['229','233','234','INVOICEE_GROUP','250','251','252','253','317','318'])expect(dependent).toContain(field)})
 it('229: an available registered end-user address cannot be omitted',async()=>{
  const {raw,facts}=await built()
  expect(blocking(mutators(raw).blank('NAD+UD',5),facts)).toContainEqual(expect.objectContaining({code:'PRODAT_END_USER_ADDRESS_VALUE_MISMATCH'}))
 })
 it.each([['233',"NAD+IT+::9+++Street+Town++12345+SE'"],['234',"NAD+IT+735123456789012345::9++++Town++12345+SE'"]] as const)('%s: a present optional installation parent requires its own child',async(field,parent)=>{
  const {raw,facts}=await built()
  expect(blocking(raw.replace('NAD+Z02',parent+'NAD+Z02'),facts)).toContainEqual(expect.objectContaining({prodatDiagnostic:expect.objectContaining({fieldNumber:field})}))
 })
 it('renders the separate contract invoicee group when its condition is met',async()=>{
  const {raw,facts}=await built(true)
  expect(raw).toMatch(/NAD\+IV\+/);expect(blocking(raw,facts)).toEqual([])
 })
 it.each([['250',2],['251',4],['252',5],['317',6],['253',8],['318',9]] as const)('%s: an omitted child of the required separate invoicee is held',async(field,element)=>{
  const {raw,facts}=await built(true)
  const issues=blocking(mutators(raw).blank('NAD+IV',element),facts)
  expect(issues.length,JSON.stringify(issues)).toBeGreaterThan(0)
  // 252 (address lines) is compared against the source invoicee as a whole value.
  expect(issues).toContainEqual(field==='252'?expect.objectContaining({code:'PRODAT_INVOICEE_VALUE_MISMATCH',fieldPath:'NAD+IV'})
   :expect.objectContaining({prodatDiagnostic:expect.objectContaining({fieldNumber:field})}))
 })
 it('INVOICEE_GROUP: the required separate invoicee group cannot be dropped',async()=>{
  const {raw,facts}=await built(true)
  expect(blocking(mutators(raw).drop('NAD+IV'),facts).length).toBeGreaterThan(0)
 })
})
describe('Z03C wrong-direction origination',()=>{
 it('the builder refuses a non-Z03 intent (grid-owner direction Z04) before bytes',async()=>{
  const f=fixture();await qualify(f)
  await expect(buildSwitchCancellationDraft({...f,intent:{...f.intent,messageCode:'Z04'}})).rejects.toThrow('switch_cancellation_canonical_version_reference_required')
 })
 it('a Z03C received inbound is a direction review, never a cancellation lifecycle',async()=>{
  const {raw}=await built()
  expect(decideProdatLifecycle({message_code:'Z03',direction:'inbound',raw_payload:raw,application_reference:'23-DDQ-PRODAT',message_version:'E2SE6A',
   message_received_at:'2026-10-08T10:00:00Z',parsed_payload:{subtype:'C'}} as never)).toMatchObject({process:'unexpected_direction',outcome:'unexpected_direction_review',createSupplyPeriod:false,endSupplyPeriod:false})
 })
})
