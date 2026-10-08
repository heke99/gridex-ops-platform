// P26.A r3 p20: an own supplied259 declares future UTILTS readings, not receipt
// of UTILTS or independent inventory. This H-only component regression runs
// against immutable95 source0ce62698. Named RPC/stored-row ports below model IO;
// they do not prove SQL custody, approved bilateral ground or whole H effects.
import {createHash} from 'node:crypto'
import {beforeEach,expect,it,vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {readSourceQualifiedProdatBilateralCapability,sourceQualifiedProdatBilateralCapability} from '@/lib/ediel/core/prodatBilateralSourceCapability'
import {sourceProdatRegisterReadingDeclarations} from '@/lib/ediel/core/prodatSourceRegisterReadingDeclarations'
import {resolveCanonicalMessagePolicy} from '@/lib/ediel/core/messagePolicy'
import {parseCanonicalMessageRow} from '@/lib/ediel/core/canonicalMessage'
import {validateCanonicalPolicyFields} from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import {guideOrderedFixtureRaw} from './helpers/prodatGuideOrderedFixture'
import {characteristic,line,qty,type Parts} from './fixtures/prodat-register'

const port=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),select:vi.fn(),eq:vi.fn(),single:vi.fn(),stored:null as unknown,receipt:null as unknown}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:port}))
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const points=['735123456789012344','735123456789012351']
const digest=(raw:string)=>createHash('sha256').update(raw).digest('hex')
type Declaration='valid'|'absent'|'malformed'|'duplicate'|'misplaced'|'header'
type Options={declaration?:Declaration;measurement?:{field:'214'|'218';kind:'absent'|'malformed'};value?:string;second?:Declaration;poisonFalse?:boolean;code?:'Z04'|'Z05';subtype?:'H'|'LK'}

function fixture(options:Options={}){
 const declaration=options.declaration??'valid',code=options.code??'Z04',subtype=options.subtype??'H'
 const measurement=(field:'214'|'218'):Parts[]=>options.measurement?.field===field
  ? options.measurement.kind==='absent'?[]:characteristic(field==='214'?'Z02':'Z05',field==='214'?'1':'6',0)
  :characteristic(field==='214'?'Z02':'Z05',field==='214'?'1':'6',3)
 const tariff=()=>characteristic('Z16',options.value??'111',3)
 const objectBody=(point:string,index:number,kind:Declaration):Parts[]=>[
  line(String(index+1),point,undefined,'9'),['DTM',[code==='Z04'?'92':'93','202610150000','203']],['DTM',['354','15','806']],qty('1000'),
  ...characteristic('Z13',subtype==='H'?'Z25':'Z23'),...characteristic('Z04','Z03'),...characteristic('Z07','E22'),
  ...characteristic('Z12','D',3),...characteristic('Z15','D'),...characteristic('Z14','L917',3),
  ...measurement('214'),...measurement('218'),
  ...(kind==='valid'||kind==='duplicate'?tariff():kind==='malformed'?characteristic('Z16','111',0):[]),
  ...(kind==='duplicate'?tariff():[]),
  ['RFF',['MG',`METER-${point}`]],['RFF',['Z05','TES']],['RFF',['LI',`OWN-${index+1}`]],
  ['NAD','UD',['199001011234','SE2','260'],'','Synthetic Customer','Street','City','','12345','SE'],
  ['NAD','IT',[point,'','9'],'','','Street','City','','12345','SE'],['NAD','Z02',['99876','160','SVK']],
 ]
 const body:Parts[]=[['NAD','FR',['54321','160','SVK']],['NAD','DO',['12345','160','SVK']],
  ...(declaration==='header'?tariff():[]),...objectBody(points[0],0,declaration),
  ...(options.second===undefined?[]:objectBody(points[1],1,options.second))]
 let raw=guideOrderedFixtureRaw(body,code).replace('+S+R+','+54321:14+12345:14+').replace("+23-DDQ-PRODAT'","+23-DDQ-PRODAT++1++1'")
 // Move after construction so the ordered builder cannot repair this negative.
 if(declaration==='misplaced')raw=raw.replace("NAD+UD+","CCI++Z16'CAV+:::111'NAD+UD+")
 const payloadHash=digest(raw),received='2026-10-01T12:01:00.000001Z'
 const context={version:1,contextOrigin:'database_insert',sourceMessageId:id(1),companyId:id(2),environment:'test',messageCode:code,payloadHash,sourceReceivedAt:received,capturedAt:'2026-10-01T12:01:00.000002Z'}
 const row={id:id(1),company_id:id(2),environment:'test',direction:'inbound',message_standard:'edifact',message_family:'PRODAT',message_code:code,message_version:'E2SE6A',application_reference:'23-DDQ-PRODAT',raw_payload:raw,
  message_created_at:'2026-09-17T11:00:00Z',message_received_at:received,created_at:'2026-10-01T12:01:00.000003Z',execution_context_snapshot:{receivedProdatContext:context},
  parsed_payload:options.poisonFalse?{meterReadingsSentInUtilts:false,prodatDependentFacts:{meterReadingsSentInUtilts:false,byCell:{'Z04:214':false,'Z04:218':false,'Z04:259':false}}}:{},
  validation_report:options.poisonFalse?{prodatDependentFacts:{meterReadingsSentInUtilts:false}}:{}} as EdielMessageRow
 const receipt={version:1,owner:'immutable-bilateral-prodat-profile-v1',companyId:row.company_id,environment:row.environment,sourceMessageId:row.id,sourcePayloadHash:payloadHash,messageCode:code,subtype,
  objects:points.slice(0,options.second===undefined?1:2).map((objectId,index)=>({objectId,identityAgency:'9',firstLineIndex:index,lineItemReference:`OWN-${index+1}`,profileVersionId:id(index+3),
   process:subtype==='LK'?'closure_request_lk':code==='Z04'?'normal_start_h':'own_end_h',sourceHash:'a'.repeat(64),sourceGrammarHash:'b'.repeat(64)}))}
 return{row,receipt}
}

beforeEach(()=>{
 for(const mock of [port.rpc,port.from,port.select,port.eq,port.single])mock.mockReset()
 port.stored=null;port.receipt=null
 port.rpc.mockImplementation(async(name:string,args:unknown)=>{
  if(name!=='ediel_read_prodat_bilateral_source_capability_v1')throw Error('unexpected_h_source_rpc:'+name)
  expect(args).toEqual({p_company_id:id(2),p_source_message_id:id(1)})
  return{data:port.receipt,error:null}
 })
 port.from.mockImplementation((table:string)=>{
  if(table!=='ediel_messages')throw Error('unexpected_h_source_table:'+table)
  const query={select:port.select,eq:port.eq,single:port.single}
  port.select.mockImplementation((columns:string)=>{
   expect(columns).toBe('id,company_id,environment,direction,message_standard,message_family,message_code,message_version,application_reference,raw_payload,message_created_at,message_received_at,created_at,execution_context_snapshot')
   return query
  })
  port.eq.mockImplementation((field:string,value:unknown)=>{
   if(!['id','company_id'].includes(field))throw Error('unexpected_h_source_filter:'+field)
   expect(value).toBe(field==='id'?id(1):id(2));return query
  })
  port.single.mockImplementation(async()=>({data:port.stored,error:null}))
  return query
 })
})

function install(f:ReturnType<typeof fixture>){port.stored=structuredClone(f.row);port.receipt=structuredClone(f.receipt)}
async function qualified(options:Options={}){
 const f=fixture(options);install(f)
 const capability=await readSourceQualifiedProdatBilateralCapability(f.row)
 expect(capability).not.toBeNull()
 expect(capability).toMatchObject({owner:'immutable-bilateral-prodat-profile-v1',subtype:options.subtype??'H',objects:f.receipt.objects})
 expect(sourceQualifiedProdatBilateralCapability(f.row,capability)).toBe(capability)
 expect(port.rpc).toHaveBeenCalledOnce();expect(port.from).toHaveBeenCalledWith('ediel_messages');expect(port.single).toHaveBeenCalledOnce()
 expect(port.eq.mock.calls).toEqual([['id',f.row.id],['company_id',f.row.company_id]])
 const canonical=parseCanonicalMessageRow(f.row),policy=resolveCanonicalMessagePolicy(f.row,canonical,{prodatSourceCapability:capability})!
 expect(policy).not.toBeNull();expect(policy.guide).toMatchObject({guideRevision:'26-A',fieldMatrixStatus:'certified'})
 expect(policy).toMatchObject({direction:'inbound',code:options.code??'Z04',subtype:options.subtype??'H',associationAssignedCode:'E2SE6A',applicationReference:'23-DDQ-PRODAT'})
 return{...f,capability,canonical,policy}
}
const own=(value:true|null,point=points[0])=>({meteringPointId:point,identityAgency:'9',meterReadingsSentInUtilts:value})

it('a real opaque H capability declares own physical259 TRUE through the actual producer and policy',async()=>{
 const f=await qualified()
 expect(sourceProdatRegisterReadingDeclarations({message:f.row,qualification:f.capability,policy:f.policy})).toEqual([own(true)])
 expect(f.policy.prodatDependentFacts?.registerObjects).toEqual([own(true)])
 expect(f.policy.prodatDependentConditions.filter(c=>['214','218','259'].includes(c.fieldNumber)).map(c=>c.status)).toEqual(['required','required','required'])
 expect(f.policy.prodatDependentFacts?.registerObjects?.[0]?.expectedRegisterCount).toBeUndefined()
})

it('the declaration producer has no synthetic111-only selector; non111 does not certify a national code list',async()=>{
 const f=await qualified({value:'112'})
 // This tests declaration selection only, not code-list or business acceptance.
 expect(sourceProdatRegisterReadingDeclarations({message:f.row,qualification:f.capability,policy:f.policy})).toEqual([own(true)])
})

it.each([{field:'214',kind:'absent'},{field:'214',kind:'malformed'},{field:'218',kind:'absent'},{field:'218',kind:'malformed'}] as const)('own259 remains TRUE with $kind field $field; the real validator diagnoses that field',async measurement=>{
 const f=await qualified({measurement})
 expect(f.policy.prodatDependentFacts?.registerObjects).toEqual([own(true)])
 const issues=validateCanonicalPolicyFields({policy:f.policy,rawPayload:f.row.raw_payload,rawSegments:f.canonical.rawSegments,una:f.canonical.una,scope:'dependent_only'})
 expect(issues).toContainEqual(expect.objectContaining({blocking:true,prodatDiagnostic:expect.objectContaining({kind:'field',fieldNumber:measurement.field})}))
 expect(issues.some(issue=>issue.code==='PRODAT_DEPENDENT_CONDITION_UNDETERMINED')).toBe(false)
})

it.each(['absent','malformed','duplicate','misplaced','header'] as const)('%s259 yields own UNKNOWN instead of borrowing caller FALSE',async declaration=>{
 const f=await qualified({declaration,poisonFalse:true})
 expect(sourceProdatRegisterReadingDeclarations({message:f.row,qualification:f.capability,policy:f.policy})).toEqual([own(null)])
 expect(f.policy.prodatDependentFacts?.registerObjects).toEqual([own(null)])
 expect(f.policy.prodatDependentConditions.filter(c=>['214','218','259'].includes(c.fieldNumber)).every(c=>c.status==='undetermined')).toBe(true)
})

it('one physical object cannot supply the sibling object missing259',async()=>{
 const f=await qualified({second:'absent',poisonFalse:true})
 expect(sourceProdatRegisterReadingDeclarations({message:f.row,qualification:f.capability,policy:f.policy})).toEqual([own(true),own(null,points[1])])
 expect(f.policy.prodatDependentFacts?.registerObjects).toEqual([own(true),own(null,points[1])])
})

it('physical own259 overrides parsed/report FALSE without minting independent inventory',async()=>{
 const f=await qualified({poisonFalse:true})
 expect(f.policy.prodatDependentFacts?.registerObjects).toEqual([own(true)])
 expect(f.policy.prodatDependentFacts?.registerObjects?.[0]?.expectedRegisterCount).toBeUndefined()
})

it('an H-shaped regulated-owner receipt is not the bilateral H declaration tuple',async()=>{
 const f=fixture();f.receipt.owner='immutable-regulated-supply-ground-v1';install(f)
 const capability=await readSourceQualifiedProdatBilateralCapability(f.row)
 expect(capability).not.toBeNull()
 const canonical=parseCanonicalMessageRow(f.row),policy=resolveCanonicalMessagePolicy(f.row,canonical,{prodatSourceCapability:capability})!
 expect(sourceProdatRegisterReadingDeclarations({message:f.row,qualification:capability,policy})).toBeNull()
})

it('the actual loader refuses an H receipt for the wrong immutable process',async()=>{
 const f=fixture();f.receipt.objects[0].process='assigned_supply';install(f)
 await expect(readSourceQualifiedProdatBilateralCapability(f.row)).rejects.toThrow('prodat_bilateral_own_physical_scope_required')
 expect(port.from).not.toHaveBeenCalled()
})

it.each([{code:'Z05',subtype:'H'},{code:'Z05',subtype:'LK'}] as const)('the $code/$subtype source capability does not authorize a Z04/H reading declaration',async options=>{
 const f=await qualified(options)
 expect(sourceProdatRegisterReadingDeclarations({message:f.row,qualification:f.capability,policy:f.policy})).toBeNull()
})

it('a copied opaque H capability cannot redeclare own259',async()=>{
 const f=await qualified(),copied={...f.capability!}
 expect(sourceQualifiedProdatBilateralCapability(f.row,copied)).toBeNull()
 expect(sourceProdatRegisterReadingDeclarations({message:f.row,qualification:copied,policy:f.policy})).toBeNull()
})

it('changed original bytes cannot redeem the original H capability',async()=>{
 const f=await qualified(),row={...f.row,raw_payload:f.row.raw_payload!.replace(':::111',':::112')}
 expect(sourceQualifiedProdatBilateralCapability(row,f.capability)).toBeNull()
 expect(sourceProdatRegisterReadingDeclarations({message:row,qualification:f.capability,policy:f.policy})).toBeNull()
})

it('one microsecond of caller receipt-clock mutation cannot redeem H capability',async()=>{
 const f=await qualified(),row={...f.row,message_received_at:'2026-10-01T12:01:00.000002Z'}
 expect(sourceQualifiedProdatBilateralCapability(row,f.capability)).toBeNull()
 expect(sourceProdatRegisterReadingDeclarations({message:row,qualification:f.capability,policy:f.policy})).toBeNull()
})

it('the real loader refuses a stored protected birth context different from the supplied row',async()=>{
 const f=fixture();install(f)
 const stored=structuredClone(f.row),snapshot=stored.execution_context_snapshot as {receivedProdatContext:Record<string,unknown>}
 snapshot.receivedProdatContext.capturedAt='2026-10-01T12:01:00.000003Z';port.stored=stored
 await expect(readSourceQualifiedProdatBilateralCapability(f.row)).rejects.toThrow('prodat_bilateral_original_metadata_unqualified')
})

it.each([{name:'association',before:'E2SE6A',after:'E2SE5A'},{name:'application',before:'23-DDQ-PRODAT',after:'27-DDQ-PRODAT'}])('a copied current policy cannot replace the physical source $name',async change=>{
 const f=await qualified(),raw=f.row.raw_payload!.replace(change.before,change.after),payloadHash=digest(raw)
 const row=structuredClone(f.row),snapshot=row.execution_context_snapshot as {receivedProdatContext:Record<string,unknown>}
 row.raw_payload=raw;snapshot.receivedProdatContext.payloadHash=payloadHash
 // Named IO explicitly models this altered stored source; it does NOT assert
 // that genuine SQL grammar/legal/profile owners would admit the altered wire.
 port.stored=structuredClone(row);port.receipt={...f.receipt,sourcePayloadHash:payloadHash}
 const capability=await readSourceQualifiedProdatBilateralCapability(row)
 expect(capability).not.toBeNull()
 expect(()=>sourceProdatRegisterReadingDeclarations({message:row,qualification:capability,policy:structuredClone(f.policy)})).toThrow('prodat_source_readings_wire_guide_unqualified')
})

it('the actual H producer rejects a non-birth admission clock after capability redemption',async()=>{
 const f=await qualified()
 expect(()=>sourceProdatRegisterReadingDeclarations({message:f.row,qualification:f.capability,policy:f.policy,admissionAt:'2026-10-01T12:01:00.000002Z'})).toThrow('prodat_source_readings_admission_clock_mismatch')
})
