// masterplan: P-14, AT-P-14
import {beforeEach,expect,it,vi} from 'vitest'
import {createHash} from 'node:crypto'
import {raw,line,characteristic,alphabets} from './fixtures/prodat-register'
import {head} from './fixtures/prodat-identity'
import {createFakeSupabase,type Row} from './helpers/supabaseMock'
import {validateEdifactEnvelope,validateUnsmGrammar} from '@/lib/ediel/core/edifactValidation'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {validateCanonicalPolicyFields} from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
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
it('renders a separate C original with exact old LI/customer/point/start, preserving the original pointer',async()=>{
 const f=fixture();await qualify(f);const {draft}=await buildSwitchCancellationDraft(f)
 expect(draft.rawPayload).toContain('BGM+Z03+')
 expect(draft.rawPayload).toContain('CAV+Z24')
 expect(draft.rawPayload).toContain('RFF+LI:ORIGINAL?:EXACT?+LI')
 expect(draft.rawPayload).toContain('NAD+UD+5566778899:SE1:260')
 expect(draft.rawPayload).toContain('LIN+1++735123456789012345:::9')
 expect(draft.rawPayload).toContain('DTM+92:202701010000:203')
 expect(draft.originalMessageId).toBe(f.basis.originalMessageId)
 expect(draft.sourceOperationId).toBe(f.intent.operationId)
 expect(draft.switchRequestId).toBe(f.basis.switchRequestId)
 expect(draft.status).toBe('draft')
})
it('holds a foreign legal or tenant route before producing cancellation bytes',async()=>{
 const f=fixture()
 for(const routeContext of [{...f.routeContext,companyId:id(99)},{...f.routeContext,receiverEdielId:'OTHER'},{...f.routeContext,actor:{...f.routeContext.actor,legalActorEdielId:'OTHER'}},{...f.routeContext,actor:{...f.routeContext.actor,marketRoles:[]}}])await expect(buildSwitchCancellationDraft({...f,routeContext})).rejects.toThrow('canonical_legal_route_mismatch')
})
it('holds detached cancellation identity and retains fixed UTC+1 source start in summer',async()=>{
 const f=fixture()
 await expect(buildSwitchCancellationDraft({...f,intent:{...f.intent,transactionReference:'OTHER'}})).rejects.toThrow('canonical_version_reference_required')
 f.basis.startAt='2027-07-01T00:00:00+01:00'
 await qualify(f,originalWire(f).replace('202701010000','202707010000'))
 expect((await buildSwitchCancellationDraft(f)).draft.rawPayload).toContain('DTM+92:202707010000:203')
})

it.each([['L','Z03'],['LK','Z04']] as const)('preserves the qualified original217 in physical %s cancellation bytes',async(subtype,method)=>{
 const f=fixture();f.basis.originalSubtype=subtype;f.basis.requestedMethod=method
 await qualify(f)
 const {draft}=await buildSwitchCancellationDraft(f)
 expect(draft.rawPayload).toContain("CCI++Z04'CAV+"+method+"'")
 expect(draft.rawPayload?.match(/CCI\+\+Z04'/g)).toHaveLength(1)
 expect(draft.originalMessageId).toBe(f.basis.originalMessageId)
 expect(f.basis.requestedMethod).toBe(method)
})

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
 reads=[]
 originals=[{id:f.basis.originalMessageId,company_id:f.basis.companyId,environment:f.basis.environment,
  direction:'outbound',message_standard:'edifact',message_family:'PRODAT',message_code:'Z03',
  immutable_rendered_at:'2026-10-06T12:00:00Z',immutable_payload_hash:f.basis.originalHash,raw_payload:wire}]
 switches=[{id:f.basis.switchRequestId,company_id:f.basis.companyId,customer_id:f.basis.customerId,site_id:f.basis.siteId,customer_site_id:f.basis.siteId,metering_point_id:f.basis.meteringPointId,contract_id:id(70),customer_contract_id:id(70)}]
 billing=[{id:id(70),company_id:f.basis.companyId,customer_id:f.basis.customerId,invoice_recipient:null,billing_street:null,billing_city:null,billing_postal_code:null,billing_country:null,billing_address_same_as_site:true}]
 io.rpc.mockResolvedValue({data:f.basis,error:null})
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
beforeEach(()=>vi.clearAllMocks())
it.each(['L','LK'] as const)('projects genuine original %s ANJ and UD through the actual builder and full canonical policy',async subtype=>{
 const f=fixture();f.basis.originalSubtype=subtype
 const wire=declareOriginal(f)
 expect(validateEdifactEnvelope(wire).ok).toBe(true)
 expect(validateUnsmGrammar(wire)).toMatchObject({qualification:'qualified',syntaxOk:true})
 const basis=await readSwitchCancellationSource({companyId:f.basis.companyId,switchRequestId:f.basis.switchRequestId,actorUserId:f.actorUserId})
 expect(basis.status).toBe('authorized');if(basis.status!=='authorized')throw Error('fixture_held')
 const {draft}=await buildSwitchCancellationDraft({...f,basis})
 const t=tokenizeEdifact(draft.rawPayload)
 const policy=resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:'Z03',subtypeOrReasonCode:'C',direction:'outbound',referenceDate:'2026-10-08',applicationReference:'23-DDQ-PRODAT',mode:'parse',prodatDependentFacts:(draft.parsedPayload as {prodatEngine:{registerEvidence:{facts:object}}}).prodatEngine.registerEvidence.facts})
 expect(validateCanonicalPolicyFields({policy,rawPayload:draft.rawPayload,rawSegments:t.segments.map(s=>s.raw),una:t.una}).filter(i=>i.blocking)).toEqual([])
 expect(draft.rawPayload).toContain('RFF+ANJ:ORIGINAL?:AGREEMENT?+EXACT')
 expect(draft.rawPayload).toContain('Original Street+Original City++12345+SE')
})

function scope(f:ReturnType<typeof fixture>){return {companyId:f.basis.companyId,switchRequestId:f.basis.switchRequestId,actorUserId:f.actorUserId}}
function fullIssues(draft:Awaited<ReturnType<typeof buildSwitchCancellationDraft>>['draft']){
 const t=tokenizeEdifact(draft.rawPayload)
 const facts=(draft.parsedPayload as {prodatEngine:{registerEvidence:{facts:object}}}).prodatEngine.registerEvidence.facts
 const policy=resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:'Z03',subtypeOrReasonCode:'C',direction:'outbound',referenceDate:'2026-10-08',applicationReference:'23-DDQ-PRODAT',mode:'parse',prodatDependentFacts:facts})
 return validateCanonicalPolicyFields({policy,rawPayload:draft.rawPayload,rawSegments:t.segments.map(s=>s.raw),una:t.una}).filter(i=>i.blocking)
}
function recount(wire:string){const t=tokenizeEdifact(wire),start=t.segments.findIndex(s=>s.tag==='UNH'),end=t.segments.findIndex(s=>s.tag==='UNT');return wire.replace(/UNT\+\d+\+M/,`UNT+${end-start+1}+M`)}
it.each([
 {id:id(99)},{company_id:id(99)},{environment:'production'},{direction:'inbound'},{message_standard:'xml'},
 {message_family:'UTILTS'},{message_code:'Z04'},{immutable_rendered_at:null},{immutable_payload_hash:'b'.repeat(64)},
 {raw_payload:null},{raw_payload:'PURGED OR CHANGED'},
])('holds missing/foreign/changed protected original %j',async patch=>{
 const f=fixture();declareOriginal(f);Object.assign(originals[0],patch)
 expect(await readSwitchCancellationSource(scope(f))).toMatchObject({status:'held'})
})
it.each([
 ['missing original', (w:string)=>w.replace("RFF+ANJ:ORIGINAL?:AGREEMENT?+EXACT'",'')],
 ['duplicate valid', (w:string)=>w.replace("RFF+ANJ:ORIGINAL?:AGREEMENT?+EXACT'","RFF+ANJ:ORIGINAL?:AGREEMENT?+EXACT'RFF+ANJ:OTHER'")],
 ['duplicate empty then valid', (w:string)=>w.replace('RFF+ANJ:','RFF+ANJ:\'RFF+ANJ:')],
 ['1156 contamination', (w:string)=>w.replace("?+EXACT'","?+EXACT:9'")],
 ['4000 contamination', (w:string)=>w.replace("?+EXACT'","?+EXACT::OTHER'")],
 ['other point', (w:string)=>w.replace('735123456789012345','735123456789012399')],
 ['other agency', (w:string)=>w.replace(':::9',':::89')],
 ['other LI', (w:string)=>w.replace('ORIGINAL?:EXACT?+LI','OTHER-LI')],
 ['other legal supplier', (w:string)=>w.replace('NAD+FR+12345','NAD+FR+11111')],
 ['other method', (w:string)=>w.replace('CAV+Z03','CAV+Z04')],
 ['other subtype', (w:string)=>w.replace('CAV+Z22','CAV+Z24')],
 ['unknown address', (w:string)=>w.replace('Original Street','')],
 ['unknown city', (w:string)=>w.replace('Original City','')],
 ['unknown postcode', (w:string)=>w.replace('12345+SE','+SE')],
 ['lossy address trim', (w:string)=>w.replace('Original Street',' Original Street ')],
 ['other namespace', (w:string)=>w.replace('E2SE6A','E3SE6A')],
 ['truncated envelope', (w:string)=>w.slice(0,-1)],
 ['unavailable directory', (w:string)=>w.replace('D:97A','D:96A')],
 ['party-scoped ANJ', (w:string)=>w.replace("RFF+ANJ:ORIGINAL?:AGREEMENT?+EXACT'",'').replace('NAD+Z02+',"RFF+ANJ:PARTY'NAD+Z02+")],
] as const)('refuses %s rather than use caller or cached fallback',async(_name,change)=>{
 const f=fixture();declareOriginal(f,recount(change(originalWire(f))))
 expect(await readSwitchCancellationSource(scope(f))).toMatchObject({status:'held'})
})
it.each(alphabets)('preserves exact released nontrim1154 with UNA %j',async(...alphabet)=>{
 const f=fixture(),agreement="  A:+?'  ";await qualify(f,originalWire(f,agreement,alphabet))
 const {draft}=await buildSwitchCancellationDraft(f),t=tokenizeEdifact(draft.rawPayload)
 const refs=t.segments.filter(s=>s.tag==='RFF'&&segmentComposite(s,1,t.una)[0]==='ANJ')
 expect(refs).toHaveLength(1)
 // Token raw has legacy trimming; reconstruct this known cancellation postimage
 // from the complete physical bytes to observe the actual trailing1154 spaces.
 expect(draft.rawPayload).toContain("RFF+ANJ:  A?:?+???'  '")
 expect(fullIssues(draft)).toEqual([])
})
it('refuses cloned, caller-created, nested-mutated or wrong-actor projection while genuine projection is reusable',async()=>{
 const f=fixture();await qualify(f)
 await expect(buildSwitchCancellationDraft({...f,basis:{...f.basis}})).rejects.toThrow('projection_unqualified')
 await expect(buildSwitchCancellationDraft({...f,actorUserId:id(99)})).rejects.toThrow('projection_unqualified')
 f.basis.sourceObject.injected=true
 await expect(buildSwitchCancellationDraft(f)).rejects.toThrow('projection_unqualified')
 delete f.basis.sourceObject.injected
 expect(fullIssues((await buildSwitchCancellationDraft(f)).draft)).toEqual([])
 expect(fullIssues((await buildSwitchCancellationDraft(f)).draft)).toEqual([])
})
it.each([{company_id:id(99)},{customer_id:id(99)},{metering_point_id:id(99)},{site_id:id(99)},
 {contract_id:id(99)},{contract_id:null,customer_contract_id:null}])('refuses inconsistent actual switch billing scope %j',async patch=>{
 const f=fixture();declareOriginal(f);Object.assign(switches[0],patch)
 expect(await readSwitchCancellationSource(scope(f))).toMatchObject({status:'held'})
})
it.each([{company_id:id(99)},{customer_id:id(99)},{id:id(99)}])('rejects foreign/missing actual contract billing %j',async patch=>{
 const f=fixture();declareOriginal(f);Object.assign(billing[0],patch)
 await expect(readSwitchCancellationSource(scope(f))).rejects.toThrow('contract_invoicee_scope_mismatch')
})
it('renders independently actual different contract billing and validates the entire canonical policy',async()=>{
 const f=fixture();declareOriginal(f)
 Object.assign(billing[0],{billing_address_same_as_site:false,billing_street:'Billing Street',billing_city:'Billing City',billing_postal_code:'99999',billing_country:'SE',invoice_recipient:'Actual invoicee'})
 const basis=await readSwitchCancellationSource(scope(f));if(basis.status!=='authorized')throw Error('fixture_held');f.basis=basis
 const {draft}=await buildSwitchCancellationDraft(f)
 expect(draft.rawPayload).toContain('NAD+IV+5566778899:SE1:260++Actual invoicee+Billing Street+Billing City++99999+SE')
 expect(fullIssues(draft)).toEqual([])
})
it('propagates protected source and billing read errors without success or generic fallback',async()=>{
 const f=fixture();declareOriginal(f);const error={code:'42501',message:'actor_quarantine'}
 io.rpc.mockResolvedValueOnce({data:null,error})
 await expect(readSwitchCancellationSource(scope(f))).rejects.toEqual(error)
 const from=io.from.getMockImplementation()!
 io.from.mockImplementation((table:string)=>{if(table==='customer_contracts')throw error;return from(table)})
 await expect(readSwitchCancellationSource(scope(f))).rejects.toEqual(error)
})

it('refuses basis integrity mutation during the independent billing read',async()=>{
 const f=fixture();declareOriginal(f);const from=io.from.getMockImplementation()!
 io.from.mockImplementation((table:string)=>{if(table==='customer_contracts')f.basis.sourceObject.changedDuringRead=true;return from(table)})
 expect(await readSwitchCancellationSource(scope(f))).toMatchObject({status:'held'})
})

it('reads only the selected tenant original, switch and actual customer contract',async()=>{
 const f=fixture();await qualify(f)
 const calls=reads.flatMap(db=>db.calls)
 expect(calls.map(c=>c.table)).toEqual(['ediel_messages','supplier_switch_requests','customer_contracts'])
 for(const call of calls){
  expect(call.operation).toBe('select')
  expect(call.filters).toContainEqual({method:'eq',column:'company_id',value:f.basis.companyId})
  expect(call.filters).toContainEqual({method:'eq',column:'id',value:call.table==='ediel_messages'?f.basis.originalMessageId:call.table==='supplier_switch_requests'?f.basis.switchRequestId:id(70)})
 }
})
it.each([{companyId:id(99)},{switchRequestId:id(99)},{actorUserId:''}])('refuses detached source selector %j before the original read',async patch=>{
 const f=fixture();declareOriginal(f)
 expect(await readSwitchCancellationSource({...scope(f),...patch})).toMatchObject({status:'held'})
 expect(io.from).not.toHaveBeenCalled()
})
it('counts physical empty-plus-valid SG16 references despite full grammar qualification',async()=>{
 const f=fixture(),wire=recount(originalWire(f).replace('RFF+ANJ:',"RFF+ANJ:'RFF+ANJ:"))
 expect(validateUnsmGrammar(wire)).toMatchObject({qualification:'qualified',syntaxOk:true})
 declareOriginal(f,wire)
 expect(await readSwitchCancellationSource(scope(f))).toMatchObject({status:'held'})
})
it.each([35,36])('preserves35 and refuses36 decoded ANJ characters (%i)',async length=>{
 const f=fixture();declareOriginal(f,originalWire(f,'A'.repeat(length)))
 const basis=await readSwitchCancellationSource(scope(f))
 if(length===36){expect(basis.status).toBe('held');return}
 expect(basis.status).toBe('authorized');if(basis.status!=='authorized')throw Error('fixture_held')
 const {draft}=await buildSwitchCancellationDraft({...f,basis})
 expect(draft.rawPayload).toContain('RFF+ANJ:'+ 'A'.repeat(length))
 expect(fullIssues(draft)).toEqual([])
})

it('refuses a second physical original object even when full directory grammar qualifies',async()=>{
 const f=fixture(),wire=recount(originalWire(f).replace('UNT+',"LIN+2++735123456789012399:::9'UNT+"))
 expect(validateUnsmGrammar(wire)).toMatchObject({qualification:'qualified',syntaxOk:true})
 declareOriginal(f,wire)
 expect(await readSwitchCancellationSource(scope(f))).toMatchObject({status:'held'})
})
it('refuses a second physical PRODAT message instead of inheriting its original reference',async()=>{
 const f=fixture(),wire=originalWire(f),t=tokenizeEdifact(wire),start=t.segments.findIndex(s=>s.tag==='UNH'),end=t.segments.findIndex(s=>s.tag==='UNT')
 const second=t.segments.slice(start,end+1).map(s=>s.raw).join("'").replace('UNH+M+','UNH+M2+').replace(/UNT\+(\d+)\+M$/, 'UNT+$1+M2')+"'"
 const batch=wire.replace('UNZ+1+I',second+'UNZ+2+I')
 expect(validateUnsmGrammar(batch)).toMatchObject({qualification:'qualified',syntaxOk:true})
 declareOriginal(f,batch)
 expect(await readSwitchCancellationSource(scope(f))).toMatchObject({status:'held'})
})
it('holds purged rows and a missing actual switch without adopting cached source or billing metadata',async()=>{
 const f=fixture();declareOriginal(f);originals=[]
 expect(await readSwitchCancellationSource(scope(f))).toMatchObject({status:'held'})
 declareOriginal(f);switches=[]
 expect(await readSwitchCancellationSource(scope(f))).toMatchObject({status:'held'})
})
