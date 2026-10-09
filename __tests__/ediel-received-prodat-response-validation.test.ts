import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {renderAperakEdiel} from '@/lib/ediel/aperakEngine'
import {describe,it,expect,vi,beforeEach} from 'vitest'
const io=vi.hoisted(()=>({database:null as ReturnType<typeof prodatOwnSourceReadingFixtureDatabase>|null}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:(name:string,args:Record<string,unknown>)=>io.database!.rpc(name,args),from:(table:string)=>io.database!.from(table)}}))
import {buildReceivedProdatResponseValidation,bindReceivedProdatResponseValidation} from '@/lib/ediel/core/receivedProdatResponseValidation'
import {readReceivedCanonicalProdatResponseValidation,resolveCanonicalRuntimeDecisionWithRegistry,type CanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
import {projectProdatApplicationObjects} from '@/lib/ediel/prodat/prodatApplicationObjectValidation'
import {projectProdatRegisterValidation} from '@/lib/ediel/prodat/prodatRegisterValidationEvidence'
import {projectProdatDiagnostics} from '@/lib/ediel/prodat/prodatDiagnosticProjection'
import {prodatFieldDiagnostic} from '@/lib/ediel/prodat/prodatFieldDiagnostic'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {raw,line,input,characteristic,type Parts} from './fixtures/prodat-register'
import {head,source} from './fixtures/prodat-identity'
import {ownerSourceWithInstallationStatus as ownerSource,ownerId,OWNER} from './helpers/sourceOwnerFixtures'
import {createProdatOwnSourceReadingSdk,resetProdatOwnSourceReadingSdk,installProdatOwnSourceReadingFixture} from './helpers/prodatOwnSourceReadingFixture'
import {prodatOwnSourceReadingFixtureDatabase,finiteProdatRulePack} from './helpers/prodatOwnSourceReadingAdapter'
import {buildReceivedSourceValidationEvidence} from '@/lib/ediel/core/receivedSourceValidationEvidence'

const reads=createProdatOwnSourceReadingSdk()
beforeEach(()=>{resetProdatOwnSourceReadingSdk(reads);io.database=prodatOwnSourceReadingFixtureDatabase(reads,()=>[finiteProdatRulePack('Z04','L','Z22'),finiteProdatRulePack('Z10','M','E58')])})

function fixture(body:Parts[],code='Z04'){
 const message=source(raw([...head(),...body],code),code),wire=tokenizeEdifact(message.raw_payload!)
 const decision={syntaxDecision:'accepted',applicationDecision:'accepted',functionalDecision:'accepted',policy:{family:'PRODAT'},
  responsePlan:[{family:'APERAK',outcome:'positive',reason:'Explicit synthetic planned response'}],validationReport:{rulePackEvidence:{syntheticPureProjection:true}},
  prodatRegisterValidation:projectProdatRegisterValidation({code,rawSegments:wire.segments.map(segment=>segment.raw),una:wire.una,registerIssues:[],fieldIssues:[],completeRuleSelection:true,handledFields:new Set(['213'])})} as unknown as CanonicalRuntimeDecision
 decision.prodatApplicationValidation=projectProdatApplicationObjects({register:decision.prodatRegisterValidation!,issues:[],completeInvocation:true})
 return {message,decision,wire}
}
const object=(seq:string,id:string,li:string):Parts[]=>[line(seq,id,undefined,'9'),['RFF',['LI',li]]]
describe('same-plan P response projection, without source approval',()=>{
 it('projects the central renderer own positive groups separately for each physical object',()=>{
  const {message,decision}=fixture([...object('1','A','FIRST'),...object('2','B','SECOND')])
  const facet=buildReceivedProdatResponseValidation(message,decision)!
  expect(facet.objects.map(object=>object.outcome)).toEqual(['positive','positive'])
  expect(facet.responses.map(response=>[response.ercCode,response.id,response.li])).toEqual([['100','A','FIRST'],['100','B','SECOND']])
  expect(bindReceivedProdatResponseValidation(facet,message.raw_payload!)).toEqual(facet)
  expect(readReceivedCanonicalProdatResponseValidation(decision,message),'Pure shape cannot mint the runtime owner').toBeNull()
  expect(readReceivedCanonicalProdatResponseValidation(structuredClone(decision),message)).toBeNull()
 })
 it('retains one own object for a genuine register chain using the actual register grouper',()=>{
  const {message,decision}=fixture([line('1','A','1','9'),['RFF',['LI','FIRST']],line('2','A','2','9')])
  const facet=buildReceivedProdatResponseValidation(message,decision)!
  expect(facet.objects).toHaveLength(1);expect(facet.objects[0].registerLineIndices).toHaveLength(2)
  expect(facet.responses).toHaveLength(1);expect(facet.responses[0]).toMatchObject({ercCode:'100',id:'A',li:'FIRST'})
  expect(bindReceivedProdatResponseValidation(facet,message.raw_payload!)).toEqual(facet)
 })
 it('keeps an unplanned sibling held when the real plan rejects one own object',()=>{
  const {message,decision,wire}=fixture([...object('1','A','FIRST'),...object('2','B','SECOND')])
  const scoped=wire.segments.slice(wire.segments.findIndex(segment=>segment.tag==='LIN'))
  const diagnostic=prodatFieldDiagnostic('213','missing',input(message.raw_payload!,'Z04'),scoped.map(segment=>segment.raw),'P-own',0)
  const errors=projectProdatDiagnostics([{severity:'error',blocking:true,code:'OWN_MISSING',title:'Own missing',description:'Synthetic own failure',prodatDiagnostic:diagnostic}]).applicationErrors
  decision.applicationDecision='rejected';decision.responsePlan=[{family:'APERAK',outcome:'negative',reason:'Own validator plan',applicationErrors:errors}]
  // BGM34 must answer every physical object: the real renderer refuses a
  // sendable plan that leaves a sibling unanswered.
  expect(()=>renderAperakEdiel({source:{id:message.id,messageFamily:'PRODAT',messageCode:message.message_code,rawPayload:message.raw_payload,
   messageReceivedAt:message.message_received_at},refs:{},externalReference:'OWNER',transactionReference:'OWNER',outcome:'negative',applicationErrors:errors}))
   .toThrow('APERAK_PRODAT_OBJECT_OUTCOME_MISSING')
  // The prospective facet projects only the own negative; the sibling stays
  // held and no sibling success exists (its ERC 100 needs a committed effect).
  const facet=buildReceivedProdatResponseValidation(message,decision)
  expect(facet?.objects.map(object=>object.outcome)).toEqual(['negative','held'])
  expect(facet?.responses.some(response=>response.ercCode==='100')).toBe(false)
 })
 it('keeps objects held when no APERAK was actually planned',()=>{
  const {message,decision}=fixture(object('1','A','FIRST'));decision.responsePlan=[]
  expect(buildReceivedProdatResponseValidation(message,decision)).toMatchObject({responses:[],objects:[{outcome:'held'}]})
 })
 it('binds the full physical escaped reference without normalization',()=>{
  const {message,decision}=fixture(object('1','A:+?',"L:+?"))
  const facet=buildReceivedProdatResponseValidation(message,decision)!
  expect(facet.responses[0]).toMatchObject({id:'A:+?',li:'L:+?'})
  expect(bindReceivedProdatResponseValidation(facet,message.raw_payload!+' ')).toBeNull()
 })
 it('rejects a copied group, sibling field tuple or malformed serialization',()=>{
  const {message,decision}=fixture([...object('1','A','FIRST'),...object('2','B','SECOND')]),facet=buildReceivedProdatResponseValidation(message,decision)!
  for(const change of [()=>({...facet,sourcePayloadHash:'f'.repeat(64)}),()=>({...facet,objects:[facet.objects[0],facet.objects[0]]}),
   ()=>({...facet,responses:[{...facet.responses[0],li:'SECOND'}]}),()=>({...facet,responses:[{...facet.responses[0],text:'unsafe\ntext'}]})]){
   expect(bindReceivedProdatResponseValidation(change(),message.raw_payload!)).toBeNull()
  }
 })
 it('does not accept generic negative error hints in place of the actual qualified source error',()=>{
  const {message,decision}=fixture(object('1','A','FIRST'));decision.responsePlan=[{family:'APERAK',outcome:'negative',reason:'invented',applicationErrors:[{ercCode:'41',fieldCode:'213',text:'Uppskattad årsenergi saknas'}]}]
  expect(buildReceivedProdatResponseValidation(message,decision)).toBeNull()
 })
 it('does not mutate the original source or its planned decision',()=>{
  const {message,decision,wire}=fixture(object('1','A','FIRST')),before=structuredClone({message,decision})
  buildReceivedProdatResponseValidation(message,decision)
  expect({message,decision}).toEqual(before);expect(segmentComposite(wire.segments.find(segment=>segment.tag==='BGM'),1,wire.una)[0]).toBe('Z04')
 })
})

// The registry is the explicitly synthetic IO boundary here. National syntax,
// guidance, canonical responsePlan and actual own renderer run together.
describe('actual canonical invocation owns the prospective response facet',()=>{
 it('records only the original same-invocation plan and rejects cloned/mutated authority',async()=>{
  const message=ownerSource('Z12',{readingDeclarations:true,sourceCodes:{installationStatus:'Z12',settlementMethod:'Z32'}})
  installProdatOwnSourceReadingFixture(reads,message,'L',{actorUserId:ownerId(50),receivedAt:message.message_received_at!,mailId:message.inbound_email_message_id!,parseId:ownerId(61),receptionId:ownerId(62),legalActorId:OWNER.actor})
  const decision=await resolveCanonicalRuntimeDecisionWithRegistry(message,{actorUserId:ownerId(50)})
  expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision]).toEqual(['accepted','accepted','accepted'])
  const facet=readReceivedCanonicalProdatResponseValidation(decision,message)
  expect(facet?.responses).toEqual([expect.objectContaining({scope:'object',ercCode:'100',li:'CASE-1',id:'735123456789012345'})])
  const evidence=buildReceivedSourceValidationEvidence({original:message,validated:message,resolvedCompanyId:message.company_id,decision})
  expect(evidence?.prodatResponseValidation).toEqual(facet)
  const copy=structuredClone(decision)
  expect(readReceivedCanonicalProdatResponseValidation(copy,message)).toBeNull()
  expect(buildReceivedSourceValidationEvidence({original:message,validated:message,resolvedCompanyId:message.company_id,decision:copy})?.prodatResponseValidation).toBeUndefined()
  expect(readReceivedCanonicalProdatResponseValidation(decision,{...message,company_id:'00000000-0000-4000-8000-000000000999'})).toBeNull()
  decision.responsePlan=[]
  expect(readReceivedCanonicalProdatResponseValidation(decision,message)).toBeNull()
 })
})

// The protocol plan is prospective; only an accepted own application/register
// can project ERC100. No fixture here grants business or runtime ownership.
describe('positive response cannot borrow held own application authority',()=>{
 const hold=(decision:CanonicalRuntimeDecision)=>{
  const register=decision.prodatRegisterValidation!.objects[0]
  register.disposition='unavailable';register.reasons=['RECEIVER_LOCAL_UNKNOWN']
  decision.prodatApplicationValidation=projectProdatApplicationObjects({register:decision.prodatRegisterValidation!,issues:[],completeInvocation:true})
 }
 it('keeps a held register scope held despite the unchanged positive protocol plan',()=>{
  const {message,decision}=fixture(object('1','A','FIRST'));hold(decision)
  const before=structuredClone({message,decision}),facet=buildReceivedProdatResponseValidation(message,decision)
  expect(facet).toMatchObject({objects:[{outcome:'held'}],responses:[]})
  expect({message,decision}).toEqual(before)
 })
 it('retains the accepted sibling while withholding the held sibling positive',()=>{
  const {message,decision}=fixture([...object('1','A','FIRST'),...object('2','B','SECOND')])
  decision.prodatRegisterValidation!.objects[1].disposition='unavailable'
  decision.prodatRegisterValidation!.objects[1].reasons=['RECEIVER_LOCAL_UNKNOWN']
  decision.prodatApplicationValidation=projectProdatApplicationObjects({register:decision.prodatRegisterValidation!,issues:[],completeInvocation:true})
  const facet=buildReceivedProdatResponseValidation(message,decision)!
  expect(facet.objects.map(row=>row.outcome)).toEqual(['positive','held'])
  expect(facet.responses).toEqual([expect.objectContaining({ercCode:'100',id:'A',li:'FIRST'})])
  expect(bindReceivedProdatResponseValidation(facet,message.raw_payload!)).toEqual(facet)
 })
 for(const condition of ['missing application','held header','held object','rejected object','application manual review','functional manual review','unexplained accepted object'] as const)
 it(`withholds a positive for ${condition}`,()=>{
  const {message,decision}=fixture(object('1','A','FIRST')),app=decision.prodatApplicationValidation!
  if(condition==='missing application')delete decision.prodatApplicationValidation
  if(condition==='held header'){app.headerDecision='held';app.objects[0].applicationDecision='held'}
  if(condition==='held object')app.objects[0].applicationDecision='held'
  if(condition==='rejected object')app.objects[0].applicationDecision='rejected'
  if(condition==='application manual review')decision.applicationDecision='manual_review'
  if(condition==='functional manual review')decision.functionalDecision='manual_review'
  if(condition==='unexplained accepted object')app.objects[0].reasonCodes=['UNQUALIFIED_OWNER']
  expect(buildReceivedProdatResponseValidation(message,decision)).toMatchObject({objects:[{outcome:'held'}],responses:[]})
 })
 for(const mismatch of ['wrong agency','missing register','duplicate application object'] as const)
 it(`fails closed for ${mismatch} without a positive response`,()=>{
  const {message,decision}=fixture(object('1','A','FIRST')),app=decision.prodatApplicationValidation!
  if(mismatch==='wrong agency')app.objects[0].identityAgency='89'
  if(mismatch==='missing register')app.objects[0].registers=[]
  if(mismatch==='duplicate application object')app.objects.push(structuredClone(app.objects[0]))
  const facet=buildReceivedProdatResponseValidation(message,decision)
  expect(facet?.responses.some(row=>row.ercCode==='100')??false).toBe(false)
  expect(facet?.objects.some(row=>row.outcome==='positive')??false).toBe(false)
 })
 it('projects the actual supplied two-register Z10 source as held without changing protocol acceptance',async()=>{
  const id='735123456789012345',body:Parts[]=[
   ['NAD','FR',['12345','160','SVK'],'','','','','','','SE'],
   ['NAD','DO',['54321','160','SVK'],'','','','','','','SE'],
   line('1',id,'1','9'),['DTM',['157','202610130000','203']],['DTM',['354','15','806']],
   ...characteristic('Z13','E58'),...characteristic('Z04','Z04'),...characteristic('Z12','D',3),
   ...characteristic('Z15','Z32'),...characteristic('Z14','L639Q',3),...characteristic('Z16','101',3),
   ...characteristic('Z02','1',3),...characteristic('Z05','6',3),
   ['RFF',['MG','NEW-METER']],['RFF',['Z02','OLD-METER']],['RFF',['Z05','11111']],['RFF',['LI','OWN-M']],
   ['NAD','Z02',['54321','160','SVK']],
   line('2',id,'2','9'),...characteristic('Z16','102',3),...characteristic('Z02','1',3),...characteristic('Z05','6',3),
  ]
  const wire=raw(body,'Z10').replace('+S+R+','+12345:14+54321:14+'),original=source(wire,'Z10')
  // Declared synthetic birth/registry IO, constructed before canonical
  // invocation. No receiver readings or accepted-business facts are supplied.
  const message={...original,company_id:ownerSource('Z12').company_id,execution_context_snapshot:{receivedProdatContext:{
   version:1,contextOrigin:'database_insert',sourceMessageId:original.id,companyId:ownerSource('Z12').company_id,
   environment:'test',messageCode:'Z10',payloadHash:evidenceHash(wire),sourceReceivedAt:original.message_received_at,capturedAt:original.message_received_at}}}
  const decision=await resolveCanonicalRuntimeDecisionWithRegistry(message)
  expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision]).toEqual(['accepted','accepted','accepted'])
  expect(decision.issues.filter(issue=>issue.prodatDiagnostic?.kind==='local_unknown')).toHaveLength(6)
  expect(decision.prodatRegisterValidation?.objects.map(row=>row.disposition)).toEqual(['unavailable'])
  expect(decision.prodatApplicationValidation?.headerDecision).toBe('held')
  expect(decision.responsePlan.find(plan=>plan.family==='APERAK')).toMatchObject({outcome:'positive'})
  const facet=readReceivedCanonicalProdatResponseValidation(decision,message)
  expect(facet).toMatchObject({objects:[{id,li:'OWN-M',outcome:'held',registerLineIndices:expect.any(Array)}],responses:[]})
  expect(facet?.objects[0].registerLineIndices).toHaveLength(2)
  const evidence=buildReceivedSourceValidationEvidence({original:message,validated:message,resolvedCompanyId:message.company_id,decision})
  expect(evidence?.prodatResponseValidation).toEqual(facet)
  expect(evidence?.prodatApplicationValidation?.headerDecision).toBe('held')
 })
 it('keeps actual accepted protocol decisions and local warnings separate from held own evidence',async()=>{
  const message=ownerSource('Z12')
  // Remove only the explicitly synthetic receiver-local fixture fact BEFORE
  // invocation. Actual complete canonical field and response owners run.
  message.parsed_payload={subtype:'L',start_date:'2026-10-01'}
  const decision=await resolveCanonicalRuntimeDecisionWithRegistry(message)
  expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision]).toEqual(['accepted','accepted','accepted'])
  expect(decision.issues.filter(issue=>issue.prodatDiagnostic?.kind==='local_unknown')).toHaveLength(3)
  expect(decision.prodatRegisterValidation?.objects.map(row=>row.disposition)).toEqual(['unavailable'])
  expect(decision.prodatApplicationValidation?.headerDecision).toBe('held')
  expect(decision.responsePlan.find(plan=>plan.family==='APERAK')).toMatchObject({outcome:'positive'})
  const facet=readReceivedCanonicalProdatResponseValidation(decision,message)
  expect(facet).toMatchObject({objects:[{outcome:'held'}],responses:[]})
  const evidence=buildReceivedSourceValidationEvidence({original:message,validated:message,resolvedCompanyId:message.company_id,decision})
  expect(evidence?.prodatResponseValidation).toEqual(facet)
  expect(evidence?.prodatApplicationValidation?.headerDecision).toBe('held')
 })
})
