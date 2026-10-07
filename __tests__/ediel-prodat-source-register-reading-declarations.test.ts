// Frozen P26.A r3 p20: supplied own259 declares that UTILTS readings follow.
// The RPC and stored original are explicit unit boundaries, not native custody,
// legal approval, market acceptance, or whole AT-Z04A/AT-Z04D execution.
import {createHash} from 'node:crypto'
import {beforeEach,expect,it,vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {readSourceQualifiedProdatBilateralCapability,sourceQualifiedProdatBilateralCapability} from '@/lib/ediel/core/prodatBilateralSourceCapability'
import {resolveCanonicalMessagePolicy} from '@/lib/ediel/core/messagePolicy'
import {parseCanonicalMessageRow} from '@/lib/ediel/core/canonicalMessage'
import {validateCanonicalPolicyFields} from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import {guideOrderedFixtureRaw} from './helpers/prodatGuideOrderedFixture'
import {characteristic,line,qty,type Parts} from './fixtures/prodat-register'

const database=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),stored:null as unknown}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:database}))
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const points=['735123456789012344','735123456789012351']
type Declaration='valid'|'absent'|'duplicate'|'malformed'|'nonlocal'|'header'
type Options={subtype?:'A'|'D';declaration?:Declaration;omit?:'214'|'218';second?:Declaration;poisonFalse?:boolean}

function measurement(field:'214'|'218'|'259'){
 return characteristic(({214:'Z02',218:'Z05',259:'Z16'} as const)[field],({214:'1',218:'6',259:'111'} as const)[field],3)
}

function fixture(options:Options={}){
 const subtype=options.subtype??'A',declaration=options.declaration??'valid'
 const objectBody=(point:string,index:number,kind:Declaration):Parts[]=>{
  const readings=[...(options.omit==='214'?[]:measurement('214')),...(options.omit==='218'?[]:measurement('218')),
   ...(kind==='valid'||kind==='duplicate'?measurement('259'):kind==='malformed'?[['CCI','','Z16'],['CAV',['111']]] as Parts[]:[]),
   ...(kind==='duplicate'?measurement('259'):[])]
  return [line(String(index+1),point,undefined,'9'),['DTM',['92','202610150000','203']],['DTM',['354','15','806']],qty('1000'),
   ...characteristic('Z13',subtype==='A'?'Z26':'Z70'),...characteristic('Z04','Z04'),...characteristic('Z07','Z12'),
   ...characteristic('Z12','D',3),...characteristic('Z15','Z32'),...characteristic('Z14',subtype==='A'?'L639Q':'L641Q',3),
   ...readings,['RFF',['MG',`METER-${point}`]],['RFF',['Z05','TES']],['RFF',['LI',`OWN-${index+1}`]],
   ...(subtype==='D'?[['RFF',['Z07','735123456789012368']]] as Parts[]:[]),
   ...(kind==='nonlocal'?measurement('259'):[]),
   ['NAD','UD',['199001011234','SE2','260'],'','Synthetic Customer','Street','City','','12345','SE'],
   ['NAD','IT',[point,'','9'],'','','Street','City','','12345','SE'],['NAD','Z02',['99876','160','SVK']]]
 }
 const body:Parts[]=[['NAD','FR',['54321','160','SVK']],['NAD','DO',['12345','160','SVK']],
  ...(declaration==='header'?measurement('259'):[]),...objectBody(points[0],0,declaration),
  ...(options.second!==undefined?objectBody(points[1],1,options.second):[])]
 let raw=guideOrderedFixtureRaw(body,'Z04').replace('+S+R+','+54321:14+12345:14+').replace("+23-DDQ-PRODAT'","+23-DDQ-PRODAT++1++1'")
 // The guide-order builder intentionally repairs group order. Move this pair
 // afterwards so the negative's ORIGINAL bytes really put259 after SG16 RFF.
 if(declaration==='nonlocal')raw=raw.replace("CCI++Z16'CAV+:::111'",'').replace("NAD+UD+", "CCI++Z16'CAV+:::111'NAD+UD+")
 const payloadHash=createHash('sha256').update(raw).digest('hex')
 const context={version:1,contextOrigin:'database_insert',sourceMessageId:id(1),companyId:id(2),environment:'test',messageCode:'Z04',payloadHash,sourceReceivedAt:'2026-10-01T12:01:00Z',capturedAt:'2026-10-01T12:01:00Z'}
 const row={id:id(1),company_id:id(2),environment:'test',direction:'inbound',message_standard:'edifact',message_family:'PRODAT',message_code:'Z04',message_version:'E2SE6A',application_reference:'23-DDQ-PRODAT',raw_payload:raw,
  message_created_at:'2026-09-17T11:00:00Z',message_received_at:context.sourceReceivedAt,created_at:context.sourceReceivedAt,execution_context_snapshot:{receivedProdatContext:context},
  parsed_payload:options.poisonFalse?{meterReadingsSentInUtilts:false,prodatDependentFacts:{meterReadingsSentInUtilts:false,byCell:{'Z04:214':false,'Z04:218':false,'Z04:259':false}}}:{},
  validation_report:options.poisonFalse?{prodatDependentFacts:{meterReadingsSentInUtilts:false}}:{}} as EdielMessageRow
 const receipt={version:1,owner:'immutable-regulated-supply-ground-v1',companyId:row.company_id,environment:row.environment,sourceMessageId:row.id,sourcePayloadHash:payloadHash,messageCode:'Z04',subtype,
  objects:points.slice(0,options.second===undefined?1:2).map((objectId,index)=>({objectId,identityAgency:'9',firstLineIndex:index,lineItemReference:`OWN-${index+1}`,profileVersionId:id(index+3),process:subtype==='A'?'assigned_supply':'production_receipt_obligation',sourceHash:'a'.repeat(64),sourceGrammarHash:'b'.repeat(64)}))}
 return {row,receipt}
}

beforeEach(()=>{
 database.rpc.mockReset();database.from.mockReset();database.stored=null
 database.from.mockImplementation(()=>{
  const query={select:vi.fn(),eq:vi.fn(),single:vi.fn(),maybeSingle:vi.fn()}
  query.select.mockReturnValue(query);query.eq.mockReturnValue(query)
  query.single.mockImplementation(async()=>({data:database.stored,error:null}))
  query.maybeSingle.mockImplementation(async()=>({data:database.stored,error:null}))
  return query
 })
})

async function qualifiedPolicy(options:Options={}){
 const f=fixture(options);database.stored=structuredClone(f.row)
 database.rpc.mockResolvedValueOnce({data:f.receipt,error:null})
 const capability=await readSourceQualifiedProdatBilateralCapability(f.row)
 expect(capability).not.toBeNull()
 const canonical=parseCanonicalMessageRow(f.row)
 const policy=resolveCanonicalMessagePolicy(f.row,canonical,{prodatSourceCapability:capability})!
 expect(policy).not.toBeNull()
 return {...f,capability,canonical,policy}
}

it.each(['A','D'] as const)('actual policy consumes own physical259 for %s and resolves current214/218/259 conditions',async subtype=>{
 const {policy}=await qualifiedPolicy({subtype})
 expect(policy.guide.guideRevision).toBe('26-A')
 expect(policy.associationAssignedCode).toBe('E2SE6A')
 expect(policy.applicationReference).toBe('23-DDQ-PRODAT')
 expect(policy.prodatDependentFacts?.registerObjects).toEqual([{meteringPointId:points[0],identityAgency:'9',meterReadingsSentInUtilts:true}])
 const conditions=policy.prodatDependentConditions.filter(c=>['214','218','259'].includes(c.fieldNumber))
 expect(conditions).toHaveLength(3)
 expect(conditions.every(c=>c.status==='required')).toBe(true)
})

it.each(['214','218'] as const)('valid physical259 still declares TRUE when required%s is missing; unchanged validator identifies that field',async omit=>{
 const {row,canonical,policy}=await qualifiedPolicy({omit})
 expect(policy.prodatDependentFacts?.registerObjects?.[0]?.meterReadingsSentInUtilts).toBe(true)
 const issues=validateCanonicalPolicyFields({policy,rawPayload:row.raw_payload,rawSegments:canonical.rawSegments,una:canonical.una,scope:'dependent_only'})
 expect(issues).toContainEqual(expect.objectContaining({blocking:true,prodatDiagnostic:expect.objectContaining({kind:'field',fieldNumber:omit})}))
 expect(issues.some(i=>i.code==='PRODAT_DEPENDENT_CONDITION_UNDETERMINED')).toBe(false)
})

it.each(['absent','duplicate','malformed','nonlocal','header'] as const)('%s259 remains own unknown and cannot borrow caller FALSE',async declaration=>{
 const {policy}=await qualifiedPolicy({declaration,poisonFalse:true})
 expect(policy.prodatDependentFacts?.registerObjects).toEqual([{meteringPointId:points[0],identityAgency:'9',meterReadingsSentInUtilts:null}])
 const conditions=policy.prodatDependentConditions.filter(c=>['214','218','259'].includes(c.fieldNumber))
 expect(conditions).toHaveLength(3)
 expect(conditions.every(c=>c.status==='undetermined')).toBe(true)
})

it('physical source TRUE overrides parsed and report FALSE without creating independent inventory authority',async()=>{
 const {policy}=await qualifiedPolicy({poisonFalse:true})
 expect(policy.prodatDependentFacts?.registerObjects).toEqual([{meteringPointId:points[0],identityAgency:'9',meterReadingsSentInUtilts:true}])
 expect(policy.prodatDependentFacts?.registerObjects?.[0]?.expectedRegisterCount).toBeUndefined()
 expect(policy.prodatDependentConditions.filter(c=>['214','218','259'].includes(c.fieldNumber)).every(c=>c.status==='required')).toBe(true)
})

it('a second physical object without259 stays unknown despite sibling TRUE and a root FALSE',async()=>{
 const {policy}=await qualifiedPolicy({second:'absent',poisonFalse:true})
 expect(policy.prodatDependentFacts?.registerObjects).toEqual([
  {meteringPointId:points[0],identityAgency:'9',meterReadingsSentInUtilts:true},
  {meteringPointId:points[1],identityAgency:'9',meterReadingsSentInUtilts:null},
 ])
 expect(policy.prodatDependentConditions.filter(c=>['214','218','259'].includes(c.fieldNumber)).every(c=>c.status==='undetermined')).toBe(true)
})

it('copying the opaque capability cannot create physical reading authority',async()=>{
 const {row,capability}=await qualifiedPolicy()
 const copied={...capability!}
 expect(sourceQualifiedProdatBilateralCapability(row,copied)).toBeNull()
 expect(()=>resolveCanonicalMessagePolicy(row,undefined,{prodatSourceCapability:copied})).toThrow('prodat_bilateral_capability_required:Z04:A')
})

it('the public policy refuses an explicit admission clock sixty seconds after its authenticated receipt',async()=>{
 const {row,capability}=await qualifiedPolicy()
 expect(()=>resolveCanonicalMessagePolicy(row,undefined,{prodatSourceCapability:capability,admissionAt:'2026-10-01T12:02:00Z'}))
  .toThrow('prodat_source_readings_admission_clock_mismatch')
})

it('the public policy accepts an explicit UTC-equivalent admission clock',async()=>{
 const {row,capability}=await qualifiedPolicy()
 const policy=resolveCanonicalMessagePolicy(row,undefined,{prodatSourceCapability:capability,admissionAt:'2026-10-01T14:01:00+02:00'})!
 expect(policy.timeAnchors?.admissionAt).toBe('2026-10-01T12:01:00.000Z')
 expect(policy.prodatDependentFacts?.registerObjects).toEqual([{meteringPointId:points[0],identityAgency:'9',meterReadingsSentInUtilts:true}])
 const conditions=policy.prodatDependentConditions.filter(condition=>['214','218','259'].includes(condition.fieldNumber))
 expect(conditions).toHaveLength(3)
 expect(conditions.every(condition=>condition.status==='required')).toBe(true)
})
