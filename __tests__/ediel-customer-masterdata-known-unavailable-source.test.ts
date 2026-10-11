// masterplan: AT-Z02L-SUPPLIER, AT-Z02LK-SUPPLIER
// Finite declared RPC ports, real checked consumers and synthetic own wire.
// This does not prove native archive/signature/current SQL, provider entry,
// received Z02 effects, H acceptance, market activation or either whole ID.
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
const rpc=vi.hoisted(()=>vi.fn())
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc}}))
import {
 prepareCustomerMasterdataSource,bindCustomerMasterdataValidationContext,
 isQualifiedCustomerMasterdataProjection,isQualifiedCustomerMasterdataValidationContext,
 loadCustomerMasterdataValidationContext,prepareRecoveryCustomerMasterdataContext,
 prepareSwitchCancellationCustomerMasterdataContext,
 type SourceQualifiedCustomerMasterdataProjection,type CustomerMasterdataValidationContext,
} from '@/lib/ediel/production/customerMasterdataSource'
import {
 createCustomerMasterdataAddressFacts,bindCustomerMasterdataRenderingSource,
 assertCustomerMasterdataAddressOwnership,customerMasterdataRenderingIssue,customerMasterdataSendIssue,
} from '@/lib/ediel/prodat/customerMasterdataAuthority'
import {resolveSwedishProdatEndUserExport} from '@/lib/ediel/prodat/customerIdentity'
import {prodatCustomerNadSegment} from '@/lib/ediel/prodat/render/segments'
import {copyProdatEndUserAddressObjects} from '@/lib/ediel/prodat/prodatEndUserAddress'
import {createProdatRegisterEvidence,readProdatRegisterEvidence} from '@/lib/ediel/prodat/prodatRegisterEvidence'
import {rememberCustomerMasterdataDraft,bindCustomerMasterdataDraftContext} from '@/lib/ediel/prodat/customerMasterdataDraft'
import {loadCustomerMasterdataOriginalRead,readCustomerMasterdataOriginalProjection,
 type CustomerMasterdataOriginalRead} from '@/lib/ediel/production/customerMasterdataOriginalRead'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {validateEdifactSyntax} from '@/lib/ediel/core/syntaxValidator'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'
import type {CreateEdielMessageInput,EdielMessageRow} from '@/lib/ediel/types'
import {ownerId,ownerSource,OWNER} from './helpers/sourceOwnerFixtures'

const companyId=OWNER.company,customerId=OWNER.customer,actor=ownerId(50),intent=ownerId(71),route=ownerId(72)
const asOf='2026-10-01T00:00:00Z',input={companyId,customerId,actorUserId:actor,environment:'test' as const,asOf}
const known=()=>({status:'authorized',companyId,customerId,environment:'test',asOf,
 sourceKind:'signed_contract_masterdata',sourceReference:'SYNTHETIC_SIGNED_SOURCE_PORT',sourceDigest:'a'.repeat(64),sourceContextId:ownerId(73),
 customerIdentity:{id:'5561111111',qualifier:'SE1',agency:'260'},
 endUserMasterdata:{nameParts:[' Synthetic + Name ','Second:Part'],streetParts:[''],postalCode:'12345',city:' City ',country:'SE',streetAvailability:'known_unavailable'}})
const prepareArgs={p_company_id:companyId,p_customer_id:customerId,p_actor_user_id:actor,p_as_of:asOf,p_environment:'test'}
type Port={name:string;args:Record<string,unknown>;data:unknown;error:unknown;beforeReturn?:()=>void}
const queue:Port[]=[]
function port(name:string,args:Record<string,unknown>,data:unknown,error:unknown=null,beforeReturn?:()=>void){queue.push({name,args,data,error,beforeReturn})}
async function prepare(data:unknown=known()){
 port('ediel_prepare_customer_masterdata_v1',prepareArgs,data)
 return prepareCustomerMasterdataSource(input)
}
beforeEach(()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date(asOf));queue.length=0;rpc.mockReset()
 rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  const next=queue.shift();if(!next)throw Error('UNDECLARED_CUSTOMER_MASTERDATA_RPC')
  expect(name).toBe(next.name);expect(args).toEqual(next.args);next.beforeReturn?.()
  return {data:next.data,error:next.error}
 })
})
afterEach(()=>{expect(queue).toEqual([]);vi.useRealTimers()})

/** Synthetic wire constructed before immutable birth. The unchanged real NAD
 * serializer and envelope own escaping/empty components/counts. The retained
 * sourceOwner fixture supplies the other physical fields; no sealed Z01 copy. */
function ownWire(selected:ReturnType<typeof known>|SourceQualifiedCustomerMasterdataProjection,variant:'L'|'LK'|'H'='L'){
 const exported=resolveSwedishProdatEndUserExport({customer:{company_name:'FOREIGN FALLBACK',street:'BORROWED STREET'},
  customerMasterdata:selected as unknown as SourceQualifiedCustomerMasterdataProjection})
 const nad=prodatCustomerNadSegment({customerId:exported.identity.id,customerIdCodeListQualifier:exported.identity.qualifier,
  customerName:exported.identity.name,nameLines:exported.nameLines,addressLines:exported.addressLines,
  city:exported.city,postalCode:exported.postalCode,country:exported.country})
 const basis=ownerSource({readingDeclarations:true,sourceCodes:{installationStatus:'Z12',settlementMethod:'Z32'}})
 const wire=tokenizeEdifact(basis.raw_payload!)
 const body=wire.segments.filter(s=>!['UNB','UNH','UNT','UNZ'].includes(s.tag)).map(s=>{
  if(s.tag==='BGM')return `BGM+${variant==='H'?'Z03':'Z01'}+SYNTHETIC-OWN+9`
  if(s.tag==='NAD'&&segmentComposite(s,1,wire.una)[0]==='UD')return nad
  return s.raw.replace('CAV+Z22',`CAV+${variant==='H'?'Z25':variant==='LK'?'Z23':'Z22'}`)
 })
 if(variant==='H')body.splice(body.findIndex(s=>s.startsWith('NAD+IT+')),0,'NAD+IV+5561234567:SE1:260++Synthetic Invoice+Invoice Street+Invoice Town++54321+SE')
 return EdifactEnvelopeCodec.encode({sender:'12345',receiver:'54321',senderQualifier:'14',receiverQualifier:'14',interchangeReference:'SYNTHETIC-I',
  applicationReference:'23-DDQ-PRODAT',acknowledgementRequest:true,environment:'test',createdAt:new Date(asOf),timeZone:'Europe/Stockholm',
  messages:[{messageReference:'M',messageTypeToken:'PRODAT:D:97A:UN:E2SE6A',businessSegments:body}]})
}
function context(projection:SourceQualifiedCustomerMasterdataProjection,rawPayload:string,intentId=intent,routeId=route){
 return bindCustomerMasterdataValidationContext({kind:'customer_masterdata',companyId,customerId,environment:'test',rawPayload,intentId,routeId,projection})
}
function sourceRow(rawPayload:string,code='Z01'):EdielMessageRow {
 return {...ownerSource({readingDeclarations:true,sourceCodes:{installationStatus:'Z12',settlementMethod:'Z32'}}),
  id:ownerId(74),direction:'outbound',message_code:code,company_id:companyId,customer_id:customerId,created_by:actor,
  intent_id:intent,communication_route_id:route,raw_payload:rawPayload,
  immutable_payload_hash:evidenceHash(rawPayload),immutable_rendered_at:asOf} as EdielMessageRow
}
function readPort(source:EdielMessageRow,data=known(),error:unknown=null,beforeReturn?:()=>void){
 port('ediel_read_prodat_customer_masterdata_original_v1',{p_company_id:companyId,p_message_id:source.id,p_actor_user_id:actor},
  {...data,version:1,owner:'immutable-prodat-customer-masterdata-original-read-v1',actorUserId:actor,originalActorUserId:source.created_by,
   messageBinding:{id:source.id,environment:'test',intentId:source.intent_id,routeId:source.communication_route_id,payloadHash:evidenceHash(source.raw_payload!)}},error,beforeReturn)
}

it.each(['signed_contract_masterdata','confirmed_customer_history'] as const)('prepares only protected %s canonical absence and retains its complete frozen source',async sourceKind=>{
 const data={...known(),sourceKind},projection=await prepare(data)
 expect(projection).toBe(data);expect(isQualifiedCustomerMasterdataProjection(projection)).toBe(true)
 expect(projection.endUserMasterdata).toEqual(data.endUserMasterdata)
 for(const v of [projection,projection.customerIdentity,projection.endUserMasterdata,projection.endUserMasterdata.nameParts,projection.endUserMasterdata.streetParts])expect(Object.isFrozen(v)).toBe(true)
 const facts=createCustomerMasterdataAddressFacts({projection,meteringPointId:OWNER.external,identityAgency:'9'})
 expect(facts[0]).toMatchObject({availability:'unavailable',addressLines:[''],endUser:projection.customerIdentity,source:{companyId,customerId,sourceContextId:ownerId(73)}})
 expect(copyProdatEndUserAddressObjects(facts)).toEqual(facts)
 expect(isQualifiedCustomerMasterdataProjection(structuredClone(projection))).toBe(false)
 expect(()=>createCustomerMasterdataAddressFacts({projection:structuredClone(projection),meteringPointId:OWNER.external,identityAgency:'9'})).toThrow('source_unqualified')
})
it.each(['L','LK'] as const)('renders actual %s UD canonical absence without borrowing installation data and binds real evidence/send consumers',async variant=>{
 const projection=await prepare(),rawPayload=ownWire(projection,variant),t=tokenizeEdifact(rawPayload)
 const ud=t.segments.find(s=>s.tag==='NAD'&&segmentComposite(s,1,t.una)[0]==='UD')!
 const installation=t.segments.find(s=>s.tag==='NAD'&&segmentComposite(s,1,t.una)[0]==='IT')!
 expect(segmentComposite(ud,2,t.una)).toEqual(['5561111111','SE1','260'])
 expect(segmentComposite(ud,4,t.una)).toEqual([' Synthetic + Name ','Second:Part'])
 expect(segmentComposite(ud,5,t.una)).toEqual(['']);expect(segmentComposite(installation,5,t.una)).toEqual(['Street'])
 expect(segmentComposite(ud,6,t.una)).toEqual([' City ']);expect(segmentComposite(ud,8,t.una)).toEqual(['12345']);expect(segmentComposite(ud,9,t.una)).toEqual(['SE'])
 expect(rawPayload).not.toContain('known_unavailable');expect(rawPayload).not.toContain('BORROWED STREET')
 expect(EdifactEnvelopeCodec.decode(rawPayload)).toMatchObject({applicationReference:'23-DDQ-PRODAT',acknowledgementRequest:'1',environment:'test',messageCount:1})
 const rendering=bindCustomerMasterdataRenderingSource({projection,companyId,environment:'test',rawPayload}),validation=context(projection,rawPayload)
 expect(rendering).toMatchObject({authorizesPersistence:false,authorizesTransport:false})
 expect(customerMasterdataRenderingIssue({rawPayload,companyId,environment:'test',family:'PRODAT',code:'Z01',source:rendering})).toBeNull()
 const row=sourceRow(rawPayload);expect(customerMasterdataSendIssue(row,validation)).toBeNull()
 expect(customerMasterdataSendIssue(row,rendering as unknown as CustomerMasterdataValidationContext)?.blocking).toBe(true)
 const objects=createCustomerMasterdataAddressFacts({projection,meteringPointId:OWNER.external,identityAgency:'9'})
 const evidence=createProdatRegisterEvidence({code:'Z01',rawSegments:t.segments.map(s=>s.raw),una:t.una,facts:{endUserAddressObjects:objects}})
 expect(readProdatRegisterEvidence({code:'Z01',rawSegments:t.segments.map(s=>s.raw),una:t.una,companyId,customerMasterdataContext:validation,parsedPayload:{prodatEngine:{registerEvidence:evidence}}})?.endUserAddressObjects).toEqual(objects)
 expect(()=>assertCustomerMasterdataAddressOwnership({...objects[0],availability:'unknown'},validation)).toThrow('source_mismatch')
 expect(()=>assertCustomerMasterdataAddressOwnership({...objects[0],availability:'available'},validation)).toThrow('source_mismatch')
 const borrowedUd=prodatCustomerNadSegment({customerId:'5561111111',customerIdCodeListQualifier:'SE1',customerName:'Synthetic',nameLines:known().endUserMasterdata.nameParts,addressLines:['BORROWED STREET'],city:' City ',postalCode:'12345',country:'SE'})
 const borrowed=rawPayload.replace(ud.raw,borrowedUd),borrowedTokens=tokenizeEdifact(borrowed)
 expect(segmentComposite(borrowedTokens.segments.find(s=>s.tag==='NAD'&&segmentComposite(s,1,borrowedTokens.una)[0]==='UD'),5,borrowedTokens.una)).toEqual(['BORROWED STREET'])
 const changed=context(projection,borrowed);expect(customerMasterdataSendIssue({...row,raw_payload:borrowed},changed)?.blocking).toBe(true)
 for(const field of ['company_id','customer_id','environment','intent_id','communication_route_id'] as const)expect(customerMasterdataSendIssue({...row,[field]:'foreign'},validation)?.blocking).toBe(true)
 expect(()=>readProdatRegisterEvidence({code:'Z01',rawSegments:t.segments.map(s=>s.raw),una:t.una,companyId,customerMasterdataContext:{...validation},parsedPayload:{prodatEngine:{registerEvidence:evidence}}})).toThrow('source_unqualified')
})

const invalidShapes:[string,Record<string,unknown>][]=[
 ['untagged absence',{streetAvailability:undefined}],['unknown tag',{streetAvailability:'unknown'}],['available tag',{streetAvailability:'available'}],
 ['null tag',{streetAvailability:null}],['boolean tag',{streetAvailability:true}],['omitted street',{streetParts:undefined}],['no slots',{streetParts:[]}],
 ['dot',{streetParts:['.']}],['space',{streetParts:[' ']}],['two empty slots',{streetParts:['','']}],['real street',{streetParts:['Street']}],
 ['extra key',{externalAuthority:true}],['empty name',{nameParts:['']}],['three names',{nameParts:['A','B','C']}],['name control',{nameParts:['A\n']}],
 ['empty postal',{postalCode:''}],['overlong postal',{postalCode:'1234567890'}],['empty city',{city:''}],['city control',{city:'C\n'}],['lowercase country',{country:'se'}],
]
it.each(invalidShapes)('refuses %s at both actual preparation and original-read ports',async(label,patch)=>{
 const data=known();Object.assign(data.endUserMasterdata,patch)
 if(label==='untagged absence')delete (data.endUserMasterdata as Record<string,unknown>).streetAvailability
 if(label==='omitted street')delete (data.endUserMasterdata as Record<string,unknown>).streetParts
 await expect(prepare(data)).rejects.toThrow('customer_masterdata_source_result_invalid');expect(isQualifiedCustomerMasterdataProjection(data)).toBe(false)
 const original=sourceRow(ownWire(known(),'H'),'Z03');readPort(original,data)
 await expect(loadCustomerMasterdataOriginalRead(original,actor)).rejects.toThrow('customer_masterdata_original_read_result_invalid')
})
it('cannot select a registered row as authority for the signed discriminator',async()=>{
 const data={...known(),sourceKind:'registered_customer_address'}
 await expect(prepare(data)).rejects.toThrow('customer_masterdata_source_result_invalid')
 const original=sourceRow(ownWire(known(),'H'),'Z03');readPort(original,data)
 await expect(loadCustomerMasterdataOriginalRead(original,actor)).rejects.toThrow('customer_masterdata_original_read_result_invalid')
})
it.each([{streetParts:['Street']},{streetParts:['','Own + street:2 ','']},{streetParts:[' . ']},{streetParts:[' ','Literal']}])('preserves old untagged present source component acceptance %j',async({streetParts})=>{
 const data=known();delete (data.endUserMasterdata as Record<string,unknown>).streetAvailability;data.endUserMasterdata.streetParts=streetParts
 // Extra legacy RPC keys were previously accepted by these TS callers. This
 // fixture does not assert that SQL admits such a signed declaration.
 Object.assign(data.endUserMasterdata,{legacyPortMetadata:true});data.sourceKind='registered_customer_address'
 const projection=await prepare(data);expect(projection.endUserMasterdata).toEqual(data.endUserMasterdata)
 expect(createCustomerMasterdataAddressFacts({projection,meteringPointId:OWNER.external,identityAgency:'9'})[0]).toMatchObject({availability:'available',addressLines:streetParts})
 const original=sourceRow(ownWire(data,'H'),'Z03');readPort(original,data)
 const token=await loadCustomerMasterdataOriginalRead(original,actor)
 const observed=readCustomerMasterdataOriginalProjection(token,original,actor)
 expect(observed?.endUserMasterdata.streetParts).toEqual(streetParts);expect(observed?.endUserMasterdata).not.toHaveProperty('streetAvailability')
})

it('forwards held/current-actor errors without issuing a prepared projection',async()=>{
 port('ediel_prepare_customer_masterdata_v1',prepareArgs,{status:'held',missing:['current_source']})
 await expect(prepareCustomerMasterdataSource(input)).rejects.toThrow('source_held:current_source')
 const denied={code:'42501',message:'SYNTHETIC_SOURCE_DENIED'};port('ediel_prepare_customer_masterdata_v1',prepareArgs,null,denied)
 await expect(prepareCustomerMasterdataSource(input)).rejects.toBe(denied)
 await expect(prepareCustomerMasterdataSource({...input,asOf:'not-a-date'})).rejects.toThrow('source_date_required')
 expect(rpc).toHaveBeenCalledTimes(2)
})
it.each(['companyId','customerId','environment','sourceDigest','customerIdentity'] as const)('retains actual prepare %s qualification before exposing absence',async key=>{
 const data:Record<string,unknown>=known();data[key]=key==='customerIdentity'?{id:'5561111111',qualifier:'SE1',agency:'89'}:key==='sourceDigest'?'not-a-digest':'foreign'
 await expect(prepare(data)).rejects.toThrow('customer_masterdata_source_result_invalid')
})
it('requires exact current-message binding and real draft identity before a sender context',async()=>{
 const projection=await prepare(),rawPayload=ownWire(known()),row=sourceRow(rawPayload)
 const binding={id:row.id,environment:'test',intentId:intent,routeId:route,payloadHash:evidenceHash(rawPayload)}
 const args={p_company_id:companyId,p_message_id:row.id,p_actor_user_id:actor}
 port('ediel_customer_masterdata_message_basis_v1',args,{...known(),messageBinding:binding})
 const current=await loadCustomerMasterdataValidationContext(row,actor);expect(isQualifiedCustomerMasterdataValidationContext(current)).toBe(true)
 port('ediel_customer_masterdata_message_basis_v1',args,{...known(),messageBinding:{...binding,payloadHash:'0'.repeat(64)}})
 await expect(loadCustomerMasterdataValidationContext(row,actor)).rejects.toThrow('message_basis_invalid')
 const draft:CreateEdielMessageInput={actorUserId:actor,companyId,customerId,direction:'outbound',environment:'test',messageStandard:'edifact',messageFamily:'PRODAT',messageCode:'Z01',rawPayload,intentId:intent,communicationRouteId:route}
 rememberCustomerMasterdataDraft(draft,projection)
 expect(isQualifiedCustomerMasterdataValidationContext(bindCustomerMasterdataDraftContext({draft,companyId,environment:'test',routeId:route}))).toBe(true)
 expect(bindCustomerMasterdataDraftContext({draft:{...draft},companyId,environment:'test',routeId:route})).toBeUndefined()
 draft.rawPayload+=' ';expect(()=>bindCustomerMasterdataDraftContext({draft,companyId,environment:'test',routeId:route})).toThrow('draft_binding_changed')
})
it('retains recovery operation/hash guards while issuing a fresh protected absent-source context',async()=>{
 const rawPayload=ownWire(known()),operationId=ownerId(80),args={p_company_id:companyId,p_operation_id:operationId,p_actor_user_id:actor,p_intent_id:intent,p_route_id:route}
 const recoveryBinding={operationId,actorUserId:actor,intentId:intent,routeId:route,environment:'test',originalMessageId:ownerId(81),sourceOriginMessageId:ownerId(82),payloadHash:evidenceHash(rawPayload)}
 const recovery={companyId,operationId,actorUserId:actor,intentId:intent,routeId:route,customerId,environment:'test' as const,rawPayload}
 port('ediel_prepare_customer_masterdata_recovery_v1',args,{...known(),recoveryBinding})
 const result=await prepareRecoveryCustomerMasterdataContext(recovery);expect(isQualifiedCustomerMasterdataValidationContext(result)).toBe(true)
 expect(result?.projection.endUserMasterdata.streetParts).toEqual([''])
 port('ediel_prepare_customer_masterdata_recovery_v1',args,{...known(),recoveryBinding:{...recoveryBinding,payloadHash:'0'.repeat(64)}})
 await expect(prepareRecoveryCustomerMasterdataContext(recovery)).rejects.toThrow('recovery_binding_invalid')
})
it('cancellation preserves the discriminator and source basis but requires fresh preparation',async()=>{
 const projection=await prepare(),rawPayload=ownWire(known(),'H'),sourceContext=context(projection,rawPayload)
 const operationId=ownerId(83),switchRequestId=ownerId(84),originalMessageId=ownerId(85),originalHash=evidenceHash(rawPayload)
 const cancellation={companyId,operationId,actorUserId:actor,intentId:intent,routeId:route,customerId,environment:'test' as const,switchRequestId,originalMessageId,originalHash,rawPayload,sourceContext}
 const args={p_company_id:companyId,p_operation_id:operationId,p_actor_user_id:actor,p_intent_id:intent,p_route_id:route,p_raw_payload:rawPayload}
 const cancellationBinding={operationId,switchRequestId,actorUserId:actor,intentId:intent,routeId:route,environment:'test',originalMessageId,originalHash,payloadHash:originalHash}
 const result={...known(),sourceContextId:ownerId(86),cancellationBinding}
 port('ediel_prepare_switch_cancellation_customer_masterdata_v1',args,result)
 const prepared=await prepareSwitchCancellationCustomerMasterdataContext(cancellation)
 expect(prepared.projection.endUserMasterdata).toEqual(projection.endUserMasterdata)
 expect(prepared.projection.sourceContextId).not.toBe(projection.sourceContextId)
 port('ediel_prepare_switch_cancellation_customer_masterdata_v1',args,{...result,sourceContextId:projection.sourceContextId})
 await expect(prepareSwitchCancellationCustomerMasterdataContext(cancellation)).rejects.toThrow('cancellation_binding_invalid')
 const changed=structuredClone(result);delete (changed.endUserMasterdata as Record<string,unknown>).streetAvailability
 port('ediel_prepare_switch_cancellation_customer_masterdata_v1',args,changed)
 await expect(prepareSwitchCancellationCustomerMasterdataContext(cancellation)).rejects.toThrow('source_result_invalid')
 await expect(prepareSwitchCancellationCustomerMasterdataContext({...cancellation,sourceContext:{...sourceContext}})).rejects.toThrow('cancellation_scope_required')
})

it('reads canonical absence with the separate original READ brand, never a preparation or sender credential',async()=>{
 const original=sourceRow(ownWire(known(),'H'),'Z03')
 expect(validateEdifactSyntax({...original,status:'received',syntax_check_status:'not_checked',validation_report:{},failure_reason:null}).ok).toBe(true)
 readPort(original);const token=await loadCustomerMasterdataOriginalRead(original,actor);expect(token).toBeDefined()
 const observed=readCustomerMasterdataOriginalProjection(token,original,actor)!
 expect(observed.endUserMasterdata).toEqual(known().endUserMasterdata)
 expect(Object.isFrozen(observed.endUserMasterdata.streetParts)).toBe(true);expect(Object.isFrozen(observed.endUserMasterdata)).toBe(true)
 expect(isQualifiedCustomerMasterdataProjection(observed)).toBe(false);expect(isQualifiedCustomerMasterdataValidationContext(token)).toBe(false)
 expect(()=>context(observed as unknown as SourceQualifiedCustomerMasterdataProjection,original.raw_payload!)).toThrow('validation_context_unqualified')
 expect(()=>createCustomerMasterdataAddressFacts({projection:observed as unknown as SourceQualifiedCustomerMasterdataProjection,meteringPointId:OWNER.external,identityAgency:'9'})).toThrow('source_unqualified')
 expect(readCustomerMasterdataOriginalProjection(token,original,actor)).toBeUndefined()
})
it.each(['copy','wrong actor','profile','raw','expired'] as const)('preserves absent original READ %s refusal and one-use consumption',async adverse=>{
 const original=sourceRow(ownWire(known(),'H'),'Z03');readPort(original)
 const token=await loadCustomerMasterdataOriginalRead(original,actor);expect(token).toBeDefined()
 let candidate=token,source=original,reader=actor
 if(adverse==='copy')candidate={...token} as CustomerMasterdataOriginalRead
 if(adverse==='wrong actor')reader=ownerId(99)
 if(adverse==='profile')source={...original,rule_profile_version_id:ownerId(99)}
 if(adverse==='raw')source={...original,raw_payload:original.raw_payload!+' '}
 if(adverse==='expired')vi.setSystemTime(new Date(Date.now()+2001))
 expect(readCustomerMasterdataOriginalProjection(candidate,source,reader)).toBeUndefined()
 if(adverse!=='copy')expect(readCustomerMasterdataOriginalProjection(token,original,actor)).toBeUndefined()
 else expect(readCustomerMasterdataOriginalProjection(token,original,actor)).toBeDefined()
})
it('retains null/denied/slow/changed-original READ results without issuing authority',async()=>{
 const original=sourceRow(ownWire(known(),'H'),'Z03'),args={p_company_id:companyId,p_message_id:original.id,p_actor_user_id:actor}
 port('ediel_read_prodat_customer_masterdata_original_v1',args,null)
 expect(await loadCustomerMasterdataOriginalRead(original,actor)).toBeUndefined()
 const denied={code:'42501',message:'SYNTHETIC_READ_DENIED'};readPort(original,known(),denied)
 await expect(loadCustomerMasterdataOriginalRead(original,actor)).rejects.toBe(denied)
 readPort(original,known(),null,()=>vi.setSystemTime(new Date(Date.now()+2001)))
 expect(await loadCustomerMasterdataOriginalRead(original,actor)).toBeUndefined()
 readPort(original,known(),null,()=>{original.rule_profile_version_id=ownerId(99)})
 expect(await loadCustomerMasterdataOriginalRead(original,actor)).toBeUndefined()
})
