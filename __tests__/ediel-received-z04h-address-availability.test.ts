// Finite private-port probe. All database tables/RPCs are declared mocked READ
// results. Real syntax, actor, legal/reception decoders, immutable source/draft
// qualifiers, protected customer adapter, policy selection/binding and typed
// diagnostic projection execute. No native provenance or effects are asserted.
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {ownerSource,ownerRulePack,ownerId} from '@/__tests__/helpers/sourceOwnerFixtures'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {validateEdifactSyntax} from '@/lib/ediel/core/syntaxValidator'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {readSourceQualifiedProdatBilateralCapability} from '@/lib/ediel/core/prodatBilateralSourceCapability'
import {resolveCanonicalMessagePolicy} from '@/lib/ediel/core/messagePolicy'
import {validateCanonicalPolicyFields} from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import {projectProdatDiagnostics} from '@/lib/ediel/prodat/prodatDiagnosticProjection'
import {loadReceivedZ04HAddressContext,bindReceivedZ04HAddressPolicy,validateReceivedZ04HAddressPresence,type ReceivedZ04HAddressContext} from '@/lib/ediel/core/receivedZ04HAddressAvailability'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {loadCustomerMasterdataOriginalRead,readCustomerMasterdataOriginalProjection,type CustomerMasterdataOriginalRead,loadAcceptedProdatHOriginalRead,readAcceptedProdatHOriginalProjection,type AcceptedProdatHOriginalRead} from '@/lib/ediel/production/customerMasterdataOriginalRead'
import {isQualifiedCustomerMasterdataProjection,isQualifiedCustomerMasterdataValidationContext,bindCustomerMasterdataValidationContext,loadCustomerMasterdataValidationContext} from '@/lib/ediel/production/customerMasterdataSource'
type Row=Record<string,unknown>
const io=vi.hoisted(()=>({rows:{} as Record<string,Row[]>,rpc:[] as {name:string;args:Row}[],queries:[] as {table:string;filters:{key:string;value:unknown}[]}[],
 sourceCapability:null as Row|null,originalCapability:null as Row|null,legal:null as Row|null,reception:null as Row|null,accepted:null as Row|null,customer:null as Row|null,
 permission:true,errorRpc:'' as string,errorValue:null as unknown,actorHook:null as (()=>void)|null,originalHook:null as (()=>void)|null,customerHook:null as (()=>void)|null,acceptedHook:null as (()=>void)|null}))
const company=ownerId(2),actor=ownerId(50),sourceId=ownerId(1),originalId=ownerId(80),customerId=ownerId(3),pointId=ownerId(4),siteId=ownerId(5),switchId=ownerId(7),contractId=ownerId(70)
const ownPoint='735123456789012345',siblingPoint='735999999999999999',ownLI='CASE-1',receivedAt='2026-09-20T00:00:00.123456Z'
const response=(data:unknown,error:unknown=null)=>Promise.resolve({data:structuredClone(data),error})
function rpc(name:string,args:Row){
 io.rpc.push({name,args:structuredClone(args)})
 if(name===io.errorRpc)return response(null,io.errorValue)
 if(name==='gridex_actor_has_company_permission'){
  const allowed=io.permission&&args.p_company_id===company&&args.p_actor_user_id===actor&&args.p_permission==='communication.read'
  const hook=io.actorHook;io.actorHook=null;hook?.();return response(allowed)
 }
 const common={p_company_id:company}
 if(name==='ediel_read_prodat_bilateral_source_capability_v1'){
  expect(args).toEqual({...common,p_source_message_id:io.sourceCapability?.sourceMessageId});return response(io.sourceCapability)
 }
 if(name==='ediel_read_bilateral_prodat_outbound_original_v1'){
  expect(args).toEqual({...common,p_actor_user_id:actor,p_message_id:originalId})
  const hook=io.originalHook;io.originalHook=null;hook?.();return response(io.originalCapability)
 }
 if(name==='ediel_require_inbound_legal_context_v1'){
  expect(args).toEqual({...common,p_message_id:io.reception?.sourceMessageId});return response(io.legal)
 }
 if(name==='ediel_inbound_reception_request_v1'){
  expect(args).toEqual({...common,p_message_id:io.reception?.sourceMessageId,p_actor_user_id:actor,p_inbound_email_message_id:io.reception?.inboundEmailMessageId});return response(io.reception)
 }
 if(name==='ediel_read_prodat_h_accepted_original_v1'){
  expect(args).toEqual({...common,p_actor_user_id:actor,p_message_id:originalId})
  const hook=io.acceptedHook;io.acceptedHook=null;hook?.();return response(io.accepted)
 }
 if(name==='gridex_ediel_accepted_transport_projection_v1')return response(null,{code:'42501',message:'DECLARED_READ_ACTOR_HAS_NO_SEND_PERMISSION'})
 if(name==='ediel_read_prodat_customer_masterdata_original_v1'){
  expect(args).toEqual({...common,p_message_id:originalId,p_actor_user_id:actor})
  const hook=io.customerHook;io.customerHook=null;hook?.();return response(io.customer)
 }
 if(name==='ediel_customer_masterdata_message_basis_v1')return response(null,{code:'42501',message:'DECLARED_READ_ACTOR_HAS_NO_SEND_PERMISSION'})
 throw Error('UNDECLARED_ADDRESS_READ_RPC:'+name)
}
function table(name:string){
 if(!Object.hasOwn(io.rows,name))throw Error('UNDECLARED_ADDRESS_READ_TABLE:'+name)
 const filters:{key:string;value:unknown}[]=[],predicates:((row:Row)=>boolean)[]=[]
 let columns='*',limit=Infinity
 const read=(single=false)=>{
  io.queries.push({table:name,filters:structuredClone(filters)})
  const data=io.rows[name].filter(row=>predicates.every(test=>test(row))).slice(0,limit)
   .map(row=>columns==='*'?structuredClone(row):Object.fromEntries(columns.split(',').map(key=>[key,row[key]])))
  return {data:single?data[0]??null:data,error:single&&data.length>1?new Error('DECLARED_MULTIPLE_ROWS'):null}
 }
 const q={select:(value='*')=>{columns=value;return q},eq:(key:string,value:unknown)=>{filters.push({key,value});predicates.push(row=>row[key]===value);return q},
  not:(key:string,op:string,value:unknown)=>{if(op!=='is')throw Error('UNDECLARED_ADDRESS_NOT');predicates.push(row=>row[key]!==value);return q},
  limit:(value:number)=>{limit=value;return q},single:async()=>read(true),maybeSingle:async()=>read(true),
  insert:()=>{throw Error('UNEXPECTED_ADDRESS_WRITE')},update:()=>{throw Error('UNEXPECTED_ADDRESS_WRITE')},delete:()=>{throw Error('UNEXPECTED_ADDRESS_WRITE')},
  then:(resolve:(value:ReturnType<typeof read>)=>unknown)=>Promise.resolve(read()).then(resolve)}
 return q
}
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:(name:string,args:Row)=>rpc(name,args),from:(name:string)=>table(name)}}))
function wire(parts:string[]){
 const start=parts.findIndex(row=>row.startsWith('UNH+')),end=parts.findIndex(row=>row.startsWith('UNT+'))
 parts[end]=`UNT+${end-start+1}+M`
 return "UNA:+.? '"+parts.join("'")+"'"
}
function omitted(raw:string,role:'UD'|'IV',point?:string){
 let object=''
 return wire(tokenizeEdifact(raw).segments.map(segment=>{
  if(segment.tag==='LIN')object=segmentComposite(segment,3,tokenizeEdifact(raw).una)[0]
  if(segment.tag!=='NAD'||segmentComposite(segment,1,tokenizeEdifact(raw).una)[0]!==role||point&&object!==point)return segment.raw
  const parts=segment.raw.split('+');parts[5]='';return parts.join('+')
 }))
}
function setFixture(sibling=false){
 const basis=ownerSource({readingDeclarations:true,sourceCodes:{installationStatus:'Z12',settlementMethod:'Z32'}})
 const parts=tokenizeEdifact(basis.raw_payload!).segments.map(segment=>segment.raw.replace('CAV+Z22','CAV+Z25').replace('CUSTOMER-1::89','5561111111:SE1:260'))
 const it=parts.findIndex(row=>row.startsWith('NAD+IT+'))
 parts.splice(it,0,'NAD+IV+5561234567:SE1:260++Synthetic Invoice+Invoice Street+Invoice Town++54321+SE')
 const originalParts=parts.slice()
 const objects=[{objectId:ownPoint,identityAgency:'9',firstLineIndex:0,lineItemReference:ownLI,profileVersionId:ownerId(90),process:'normal_start_h',sourceHash:'c'.repeat(64),sourceGrammarHash:'d'.repeat(64)}]
 if(sibling){
  const begin=parts.findIndex(row=>row.startsWith('LIN+')),end=parts.findIndex(row=>row.startsWith('UNT+'))
  const own=parts.slice(begin,end).map(row=>row.replace('LIN+1++'+ownPoint,'LIN+2++'+siblingPoint).replace('RFF+LI:CASE-1','RFF+LI:SIBLING-LI')
   .replace('5561111111:SE1:260','5562222222:SE1:260').replace('5561234567:SE1:260','5569999999:SE1:260'))
  parts.splice(end,0,...own);objects.push({...objects[0],objectId:siblingPoint,firstLineIndex:1,lineItemReference:'SIBLING-LI'})
 }
 const raw=wire(parts),profile=ownerRulePack(),profileKey='PRODAT:Z04:H:26.A:r3'
 const source={...basis,id:sourceId,raw_payload:raw,message_version:'E2SE6A',message_created_at:'2026-09-17T10:00:00Z',message_received_at:receivedAt,created_at:receivedAt,
  status:'received',syntax_check_status:'not_checked',validation_report:{},parsed_payload:{},inbound_email_message_id:ownerId(60),
  canonical_rule_pack_id:profile.rule_pack_id,rule_profile_key:profileKey,rule_profile_version_id:profile.message_profile_id,rule_profile_version:'26.A:r3',rule_pack_checksum:profile.source_hash,
  rule_pack_snapshot:{...profile.original_snapshot,profileKey,profileVersionId:profile.message_profile_id,version:'26.A:r3',checksum:profile.source_hash},
  immutable_payload_hash:evidenceHash(raw),execution_context_snapshot:{receivedProdatContext:{version:1,contextOrigin:'database_insert',sourceMessageId:sourceId,companyId:company,environment:'test',messageCode:'Z04',payloadHash:evidenceHash(raw),sourceReceivedAt:receivedAt,capturedAt:receivedAt}}} as EdielMessageRow
 // Explicit reverse of actual physical legal and transport endpoint identities.
 // Explicit primary original predates addition of the independent sibling.
 // No original or available-address declaration exists for sibling's own LI.
 const originalRaw=wire(originalParts.map(row=>row.replace('BGM+Z04+','BGM+Z03+').replace('+12345:14+54321:14+','+54321:14+12345:14+')
  .replace('NAD+FR+12345:160:SVK','NAD+FR+54321:160:SVK').replace('NAD+DO+54321:160:SVK','NAD+DO+12345:160:SVK')))
 const original={...source,id:originalId,raw_payload:originalRaw,direction:'outbound',message_code:'Z03',created_by:ownerId(91),
  customer_id:customerId,metering_point_id:pointId,site_id:siteId,switch_request_id:switchId,intent_id:ownerId(71),communication_route_id:ownerId(72),immutable_payload_hash:evidenceHash(originalRaw),immutable_rendered_at:'2026-09-19T00:00:00Z'} as EdielMessageRow
 io.rows={company_memberships:[{company_id:company,user_id:actor,status:'active',is_active:true,accepted_at:'2026-01-01T00:00:00Z'}],user_profiles:[{id:actor,user_status:'active'}],
  ediel_messages:[structuredClone(source) as unknown as Row,structuredClone(original) as unknown as Row],supplier_switch_requests:[{id:switchId,company_id:company,customer_id:customerId,metering_point_id:pointId,site_id:siteId,customer_site_id:null,contract_id:contractId,customer_contract_id:null,outbound_z03_message_id:originalId,rff_li_reference:ownLI,prodat_variant:'H',prodat_reason:'Z25'}],
  inbound_email_messages:[{id:ownerId(60),company_id:company,environment:'test',received_at:receivedAt,raw_edifact_payload:raw}],inbound_ediel_parse_results:[{id:ownerId(61),company_id:company,inbound_email_message_id:ownerId(60),raw_payload:raw,parse_status:'parsed'}]}
 io.sourceCapability={version:1,owner:'immutable-bilateral-prodat-profile-v1',companyId:company,environment:'test',sourceMessageId:sourceId,sourcePayloadHash:evidenceHash(raw),messageCode:'Z04',subtype:'H',objects}
 io.originalCapability={version:1,owner:'immutable-bilateral-prodat-outbound-profile-v1',companyId:company,environment:'test',actorUserId:actor,originalActorUserId:ownerId(91),payloadHash:evidenceHash(originalRaw),messageCode:'Z03',objects:[{...objects[0],rulePackId:ownerId(12),messageProfileId:ownerId(13),pointId,customerId,siteId,contractId,contractHash:'e'.repeat(64),eventAt:'2026-10-01T00:00:00Z',switchId}]}
 io.legal={basisKind:'observed_source_persistence',companyId:company,environment:'test',direction:'inbound',legalActorId:ownerId(9),legalEdielId:'54321',actorRole:'electricity_supplier',transportActorId:ownerId(9),transportEdielId:'54321',applicationReference:'23-DDQ-PRODAT',observedAt:receivedAt,sourceReceivedAt:receivedAt,family:'PRODAT',code:'Z04',subtype:'H',sourceEdition:'f'.repeat(64),canonicalProjection:{family:'PRODAT',code:'Z04',subtype:'H',transactionReasonCode:'Z25',direction:'inbound',receiverRoles:['supplier'],applicationReferences:['23-DDQ-PRODAT']}}
 io.reception={companyId:company,sourceMessageId:sourceId,inboundEmailMessageId:ownerId(60),parseResultId:ownerId(61),receptionId:ownerId(62),classification:'first_reception',isReplay:false,receivedAt,canonicalPayloadHash:evidenceHash(raw),receivedPayloadHash:evidenceHash(raw),responseRequestId:null,status:'observed',reason:null,businessEffectAuthorized:false}
 io.accepted={version:1,owner:'immutable-prodat-h-accepted-original-read-v1',actorUserId:actor,originalActorUserId:ownerId(91),messageBinding:{id:originalId,environment:'test',intentId:ownerId(71),routeId:ownerId(72),payloadHash:evidenceHash(originalRaw)},status:'accepted_projection',companyId:company,environment:'test',messageId:originalId,originalHash:evidenceHash(originalRaw),observedAt:'2026-09-20T00:00:00.123455Z',authorizesProviderEntry:false,deliveryProven:false}
 io.customer={version:1,owner:'immutable-prodat-customer-masterdata-original-read-v1',actorUserId:actor,originalActorUserId:ownerId(91),status:'authorized',companyId:company,customerId,environment:'test',asOf:'2026-09-19T00:00:00Z',sourceKind:'registered_customer_address',sourceReference:'DECLARED_UNIT_ORIGINAL_CUSTOMER_BASIS',sourceDigest:'b'.repeat(64),sourceContextId:ownerId(73),customerIdentity:{id:'5561111111',qualifier:'SE1',agency:'260'},endUserMasterdata:{nameParts:['Synthetic'],streetParts:['Street'],city:'City',postalCode:'12345',country:'SE'},messageBinding:{id:originalId,environment:'test',intentId:ownerId(71),routeId:ownerId(72),payloadHash:evidenceHash(originalRaw)}}
 io.rpc=[];io.queries=[];io.permission=true;io.errorRpc='';io.errorValue=null;io.actorHook=null;io.originalHook=null;io.customerHook=null;io.acceptedHook=null
 return {source,original}
}
let f:ReturnType<typeof setFixture>
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-09-30T13:00:00Z'));f=setFixture()})
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks()})
async function qualified(source=f.source){const q=await readSourceQualifiedProdatBilateralCapability(source);expect(q).not.toBeNull();return q!}
async function mint(source=f.source){return loadReceivedZ04HAddressContext(source,actor,await qualified(source))}
function policy(q:Awaited<ReturnType<typeof qualified>>,context?:ReceivedZ04HAddressContext|null,source=f.source){
 const selected=resolveCanonicalMessagePolicy(source,undefined,{prodatSourceCapability:q,receivedZ04HAddressContext:context,receivedZ04HAddressActorUserId:actor})
 expect(selected).not.toBeNull();expect(Object.isFrozen(selected)).toBe(true);return selected!
}
function observe(selected:ReturnType<typeof policy>,raw:string){const t=tokenizeEdifact(raw);return validateReceivedZ04HAddressPresence({policy:selected,rawPayload:raw,rawSegments:t.segments.map(row=>row.raw),una:t.una})}
const fields=(issues:ReturnType<typeof observe>)=>issues.flatMap(row=>row.prodatDiagnostic?.kind==='field'?[row.prodatDiagnostic.fieldNumber]:[])
function originalStreetFixture(streetParts:string[],wireStreet:string){
 const raw=wire(tokenizeEdifact(f.original.raw_payload!).segments.map(segment=>{
  if(segment.tag!=='NAD'||segmentComposite(segment,1,tokenizeEdifact(f.original.raw_payload!).una)[0]!=='UD')return segment.raw
  const parts=segment.raw.split('+');parts[5]=wireStreet;return parts.join('+')
 }))
 f.original.raw_payload=raw
 const hash=evidenceHash(raw)
 ;(f.original as unknown as Row).immutable_payload_hash=hash
 io.rows.ediel_messages[1]=structuredClone(f.original) as unknown as Row
 io.originalCapability!.payloadHash=hash
 io.accepted!.originalHash=hash
 ;(io.accepted!.messageBinding as Row).payloadHash=hash
 ;(io.customer!.messageBinding as Row).payloadHash=hash
 ;(io.customer!.endUserMasterdata as Row).streetParts=streetParts
}
it.each([
 ['second',['','Own extra'],'.:Own extra'],
 ['third',['','','Own extra'],'.::Own extra'],
] as const)('private229 with empty first and known %s slot retains ERC41 after wire formatting',async(_slot,streetParts,wireStreet)=>{
 originalStreetFixture([...streetParts],wireStreet)
 const read=await loadCustomerMasterdataOriginalRead(f.original,actor)
 expect(readCustomerMasterdataOriginalProjection(read,f.original,actor)?.endUserMasterdata.streetParts).toEqual(streetParts)
 const q=await qualified(),token=await loadReceivedZ04HAddressContext(f.source,actor,q)
 expect(token).not.toBeNull()
 const selected=policy(q,token),missing=omitted(f.source.raw_payload!,'UD'),t=tokenizeEdifact(missing)
 const issues=validateCanonicalPolicyFields({policy:selected,rawPayload:missing,rawSegments:t.segments.map(row=>row.raw),una:t.una})
 expect(projectProdatDiagnostics(issues).applicationErrors.filter(error=>error.fieldCode==='229')).toMatchObject([
  {fieldCode:'229',ercCode:'41',referenceNumber:ownPoint,lineItemReference:ownLI,
   prodatOccurrence:{scope:'object',lineIndex:0,objectId:ownPoint,identityAgency:'9',lineItemReference:ownLI}},
 ])
 expect((io.customer!.endUserMasterdata as Row).streetParts).toEqual(streetParts)
})
it('a dot-only original street cannot create private229 availability',async()=>{
 originalStreetFixture(['.',''],'.:')
 const q=await qualified()
 await expect(loadReceivedZ04HAddressContext(f.source,actor,q)).rejects.toThrow('customer_masterdata_original_read_result_invalid')
 expect(observe(policy(q),omitted(f.source.raw_payload!,'UD'))).toEqual([])
})
it.each([['UD','229'],['IV','252']] as const)('actual private source/own original issues scoped %s%s ERC41 on a derivative only after binding',async(role,field)=>{
 expect(validateEdifactSyntax({...f.source,status:'received',syntax_check_status:'not_checked',validation_report:{},failure_reason:null}).ok).toBe(true)
 const q=await qualified(),token=await loadReceivedZ04HAddressContext(f.source,actor,q);expect(token).not.toBeNull()
 const selected=policy(q,token),missing=omitted(f.source.raw_payload!,role)
 expect(observe(selected,f.source.raw_payload!)).toEqual([]);expect(fields(observe(selected,missing))).toEqual([field])
 const t=tokenizeEdifact(missing),actual=validateCanonicalPolicyFields({policy:selected,rawPayload:missing,rawSegments:t.segments.map(row=>row.raw),una:t.una})
 expect(actual.some(row=>row.prodatDiagnostic?.kind==='field'&&row.prodatDiagnostic.fieldNumber===field&&row.prodatDiagnostic.errorKind==='missing')).toBe(true)
 expect(projectProdatDiagnostics(observe(selected,missing)).applicationErrors).toMatchObject([{fieldCode:field,ercCode:'41',referenceNumber:ownPoint,lineItemReference:ownLI,
  prodatOccurrence:{scope:'object',lineIndex:0,objectId:ownPoint,identityAgency:'9',lineItemReference:ownLI}}])
})
it.each([['UD','229'],['IV','252']] as const)('distinct actual malformed born %s%s source requires its own fresh private READ',async(role,field)=>{
 const oldQ=await qualified(),oldToken=await loadReceivedZ04HAddressContext(f.source,actor,oldQ);expect(oldToken).not.toBeNull()
 const raw=omitted(f.source.raw_payload!,role),id=ownerId(101),mailId=ownerId(102),parseId=ownerId(103),receptionId=ownerId(104)
 const born=(f.source.execution_context_snapshot as Row).receivedProdatContext as Row
 const actual={...f.source,id,inbound_email_message_id:mailId,raw_payload:raw,immutable_payload_hash:evidenceHash(raw),
  execution_context_snapshot:{receivedProdatContext:{...born,sourceMessageId:id,payloadHash:evidenceHash(raw)}}} as EdielMessageRow
 io.rows.ediel_messages[0]=structuredClone(actual) as unknown as Row
 io.rows.inbound_email_messages=[{id:mailId,company_id:company,environment:'test',received_at:receivedAt,raw_edifact_payload:raw}]
 io.rows.inbound_ediel_parse_results=[{id:parseId,company_id:company,inbound_email_message_id:mailId,raw_payload:raw,parse_status:'parsed'}]
 io.sourceCapability={...io.sourceCapability,sourceMessageId:id,sourcePayloadHash:evidenceHash(raw)}
 io.reception={...io.reception,sourceMessageId:id,inboundEmailMessageId:mailId,parseResultId:parseId,receptionId,canonicalPayloadHash:evidenceHash(raw),receivedPayloadHash:evidenceHash(raw)}
 const q=await qualified(actual),selected=policy(q,undefined,actual)
 bindReceivedZ04HAddressPolicy(selected,actual,actor,oldToken)
 expect(observe(selected,raw)).toEqual([])
 const fresh=await loadReceivedZ04HAddressContext(actual,actor,q);expect(fresh).not.toBeNull()
 bindReceivedZ04HAddressPolicy(selected,actual,actor,fresh)
 expect(fields(observe(selected,raw))).toEqual([field])
})
it.each(['copy','reconstructed','expired','wrong actor','changed source','wrong profile','repeated'] as const)('token %s cannot bind an observational address requirement',async adverse=>{
 const q=await qualified(),token=await loadReceivedZ04HAddressContext(f.source,actor,q);expect(token).not.toBeNull()
 let candidate=token!,source=f.source,who=actor
 if(adverse==='copy')candidate=structuredClone(token!)
 if(adverse==='reconstructed')candidate=JSON.parse(JSON.stringify(token!))
 if(adverse==='expired')vi.setSystemTime(new Date(Date.now()+2001))
 if(adverse==='wrong actor')who=ownerId(999)
 if(adverse==='changed source')source={...source,raw_payload:source.raw_payload!+' '}
 if(adverse==='wrong profile')source={...source,rule_profile_version_id:ownerId(999)}
 if(adverse==='repeated'){const first=policy(q,token);expect(fields(observe(first,omitted(source.raw_payload!,'UD')))).toEqual(['229'])}
 const selected=policy(q);bindReceivedZ04HAddressPolicy(selected,source,who,candidate)
 expect(observe(selected,omitted(f.source.raw_payload!,'UD'))).toEqual([])
 if(['wrong actor','changed source','wrong profile'].includes(adverse)){bindReceivedZ04HAddressPolicy(selected,f.source,actor,token);expect(observe(selected,omitted(f.source.raw_payload!,'UD'))).toEqual([])}
})
it('copied policy and later expired observation retain no private availability',async()=>{
 const q=await qualified(),token=await loadReceivedZ04HAddressContext(f.source,actor,q),selected=policy(q,token),raw=omitted(f.source.raw_payload!,'IV')
 expect(fields(observe(selected,raw))).toEqual(['252']);expect(observe({...selected},raw)).toEqual([])
 vi.setSystemTime(new Date(Date.now()+2001));expect(observe(selected,raw)).toEqual([])
})
it.each(['point','agency','LI','customer','legal','transport'] as const)('foreign derivative %s cannot use selected own availability',async adverse=>{
 const q=await qualified(),token=await loadReceivedZ04HAddressContext(f.source,actor,q),selected=policy(q,token)
 let raw=omitted(f.source.raw_payload!,'UD')
 if(adverse==='point')raw=raw.replace(ownPoint,siblingPoint)
 if(adverse==='agency')raw=raw.replace(ownPoint+':::9',ownPoint+':::89')
 if(adverse==='LI')raw=raw.replace('RFF+LI:CASE-1','RFF+LI:FOREIGN-LI')
 if(adverse==='customer')raw=raw.replace('5561111111:SE1:260','5562222222:SE1:260')
 if(adverse==='legal')raw=raw.replace('NAD+FR+12345:160:SVK','NAD+FR+99999:160:SVK')
 if(adverse==='transport')raw=raw.replace('UNOC:3+12345:14','UNOC:3+99999:14')
 expect(observe(selected,raw)).toEqual([])
})
it.each(['future microsecond','foreign point','foreign agency','foreign LI','foreign customer','foreign profile','ambiguous','unavailable accepted','foreign original environment'] as const)('original %s never selects a required-address error',async adverse=>{
 if(adverse==='future microsecond')io.accepted!.observedAt='2026-09-20T00:00:00.123457Z'
 const own=(io.originalCapability!.objects as Row[])[0]
 if(adverse==='foreign point')own.objectId=siblingPoint
 if(adverse==='foreign agency')own.identityAgency='89'
 if(adverse==='foreign LI')own.lineItemReference='FOREIGN-LI'
 if(adverse==='foreign customer')own.customerId=ownerId(999)
 if(adverse==='foreign profile')own.profileVersionId=ownerId(999)
 if(adverse==='ambiguous')io.rows.supplier_switch_requests.push({...io.rows.supplier_switch_requests[0],id:ownerId(999)})
 if(adverse==='unavailable accepted')io.accepted=null
 if(adverse==='foreign original environment')io.rows.ediel_messages[1].environment='production'
 const q=await qualified()
 const token=await loadReceivedZ04HAddressContext(f.source,actor,q).catch(error=>error)
 // Malformed protected receipt is an adapter failure, never a guessed ERC41.
 if(token instanceof Error){expect(token.message).toBe('bilateral_prodat_outbound_own_scope_required');return}
 const selected=policy(q,token);expect(observe(selected,omitted(f.source.raw_payload!,'UD'))).toEqual([]);expect(observe(selected,omitted(f.source.raw_payload!,'IV'))).toEqual([])
})
it('accepted observation equal to receipt at PostgreSQL precision is eligible',async()=>{
 io.accepted!.observedAt='2026-09-20T00:00:00.123456+00:00'
 const q=await qualified(),token=await loadReceivedZ04HAddressContext(f.source,actor,q);expect(token).not.toBeNull()
 expect(fields(observe(policy(q,token),omitted(f.source.raw_payload!,'UD')))).toEqual(['229'])
})
it.each(['UNT','UNZ'] as const)('synthetic accepted syntax cache with wrong actual %s refuses before any original discovery',async bad=>{
 const changed=f.source.raw_payload!.replace(bad==='UNT'?/UNT+\+[0-9]+\+M/:/UNZ\+1\+I/,bad==='UNT'?'UNT+999+M':'UNZ+2+I')
 const source:EdielMessageRow&{immutable_payload_hash:string}={...f.source,raw_payload:changed,immutable_payload_hash:evidenceHash(changed),syntax_check_status:'passed',status:'validated',validation_report:{utiltsRuntime:{validation:{syntaxOk:true,classification:'accepted'}}},execution_context_snapshot:{receivedProdatContext:{...((f.source.execution_context_snapshot as Row).receivedProdatContext as Row),payloadHash:evidenceHash(changed)}}}
 io.rows.ediel_messages[0]=structuredClone(source) as unknown as Row;io.sourceCapability!.sourcePayloadHash=evidenceHash(changed)
 const q=await qualified(source);io.queries=[]
 expect(await loadReceivedZ04HAddressContext(source,actor,q)).toBeNull();expect(io.queries.some(row=>row.table==='supplier_switch_requests')).toBe(false)
})
it.each(['company_id','id','raw_payload'] as const)('actor-await source %s mutation cannot redirect any lookup',async key=>{
 const q=await qualified(),old=structuredClone(f.source);io.queries=[]
 io.actorHook=()=>{(f.source as unknown as Row)[key]=key==='raw_payload'?f.source.raw_payload!+' ':ownerId(999)}
 expect(await loadReceivedZ04HAddressContext(f.source,actor,q)).toBeNull()
 expect(io.queries.filter(row=>row.table==='ediel_messages').every(row=>row.filters.some(filter=>filter.key==='company_id'&&filter.value===old.company_id)&&row.filters.some(filter=>filter.key==='id'&&filter.value===old.id))).toBe(true)
 expect(io.queries.some(row=>row.table==='supplier_switch_requests')).toBe(false)
})
it('source mutation during awaited original read refuses final issuance using stable company/env/id',async()=>{
 const q=await qualified();io.originalHook=()=>{f.source.company_id=ownerId(999)}
 expect(await loadReceivedZ04HAddressContext(f.source,actor,q)).toBeNull()
 expect(io.queries.filter(row=>row.table==='supplier_switch_requests').every(row=>row.filters.some(filter=>filter.key==='company_id'&&filter.value===company))).toBe(true)
})
it('a public availability flag/JSON token cannot bind private scoped requirements',async()=>{
 f.source.parsed_payload={endUserAddressAvailable:true,invoiceeAddressDiffersFromEndUser:true,bilateralCapabilityVerified:true}
 const q=await qualified(),selected=policy(q)
 bindReceivedZ04HAddressPolicy(selected,f.source,actor,{known:[{field:'229',objectId:ownPoint}]} as unknown as ReceivedZ04HAddressContext)
 expect(observe(selected,omitted(f.source.raw_payload!,'UD'))).toEqual([]);expect(observe(selected,omitted(f.source.raw_payload!,'IV'))).toEqual([])
})
it.each(['copied source capability','missing mail','foreign parser raw','foreign legal receiver','missing birth','wrong immutable hash'] as const)('source %s cannot issue a private availability context',async adverse=>{
 const q=await qualified();let candidate=q
 if(adverse==='copied source capability')candidate=structuredClone(q)
 if(adverse==='missing mail')io.rows.inbound_email_messages=[]
 if(adverse==='foreign parser raw')io.rows.inbound_ediel_parse_results[0].raw_payload='DECLARED_FOREIGN_PARSER_BYTES'
 if(adverse==='foreign legal receiver')io.legal!.legalEdielId='99999'
 if(adverse==='missing birth')delete ((f.source.execution_context_snapshot as Row).receivedProdatContext as Row).version
 if(adverse==='wrong immutable hash')(f.source as unknown as Row).immutable_payload_hash='0'.repeat(64)
 io.queries=[];expect(await loadReceivedZ04HAddressContext(f.source,actor,candidate)).toBeNull()
 expect(io.queries.some(row=>row.table==='supplier_switch_requests')).toBe(false)
})
it('actual actor denial cannot be hidden by unavailable source birth',async()=>{
 const q=await qualified();delete ((f.source.execution_context_snapshot as Row).receivedProdatContext as Row).version;io.permission=false
 await expect(loadReceivedZ04HAddressContext(f.source,actor,q)).rejects.toMatchObject({disposition:{kind:'security_quarantine'}})
 expect(io.queries.some(row=>row.table==='supplier_switch_requests')).toBe(false)
})
it('own known address does not activate unmatched physical sibling or customer',async()=>{
 f=setFixture(true);expect(validateEdifactSyntax({...f.source,status:'received',syntax_check_status:'not_checked',validation_report:{},failure_reason:null}).ok).toBe(true)
 const q=await qualified(),token=await loadReceivedZ04HAddressContext(f.source,actor,q);expect(token).not.toBeNull()
 const selected=policy(q,token),both=omitted(f.source.raw_payload!,'UD')
 expect(projectProdatDiagnostics(observe(selected,both)).applicationErrors).toMatchObject([{fieldCode:'229',ercCode:'41',referenceNumber:ownPoint,lineItemReference:ownLI,
  prodatOccurrence:{scope:'object',lineIndex:0,objectId:ownPoint,identityAgency:'9',lineItemReference:ownLI}}])
 expect(observe(selected,omitted(f.source.raw_payload!,'UD',siblingPoint))).toEqual([])
})
it.each(['ordinary','denied'] as const)('actual original READ %s error retains local/security failure',async adverse=>{
 const q=await qualified();io.errorRpc='ediel_read_bilateral_prodat_outbound_original_v1'
 io.errorValue=adverse==='ordinary'?new Error('DECLARED_ORIGINAL_READ_FAILED'):{code:'42501',message:'DECLARED_ACTUAL_READ_DENIED'}
 const error=await loadReceivedZ04HAddressContext(f.source,actor,q).catch(error=>error)
 if(adverse==='ordinary')expect(error).toBe(io.errorValue)
 else expect(error).toMatchObject({disposition:{kind:'security_quarantine',code:'EDIEL_ADDRESS_SOURCE_READ_FORBIDDEN'}})
})
it('registry integration propagates an ordinary original availability READ failure outside capability fallback',async()=>{
 io.errorRpc='ediel_read_bilateral_prodat_outbound_original_v1';io.errorValue=new Error('DECLARED_ORIGINAL_READ_FAILED')
 await expect(resolveCanonicalRuntimeDecisionWithRegistry(f.source,{actorUserId:actor})).rejects.toBe(io.errorValue)
})
it('the current original READ uses the narrow actor-bound RPC and never enters the sender context owner',async()=>{
 const token=await loadCustomerMasterdataOriginalRead(f.original,actor);expect(token).toBeDefined()
 expect(io.rpc).toEqual([{name:'ediel_read_prodat_customer_masterdata_original_v1',args:{p_company_id:company,p_message_id:originalId,p_actor_user_id:actor}}])
 const projection=readCustomerMasterdataOriginalProjection(token,f.original,actor);expect(projection).toMatchObject({customerId,endUserMasterdata:{streetParts:['Street']}})
 expect(Object.isFrozen(projection)).toBe(true);expect(Object.isFrozen(projection!.endUserMasterdata.streetParts)).toBe(true)
 expect(isQualifiedCustomerMasterdataProjection(projection)).toBe(false);expect(isQualifiedCustomerMasterdataProjection(structuredClone(projection))).toBe(false)
 expect(isQualifiedCustomerMasterdataValidationContext(token)).toBe(false)
 expect(()=>bindCustomerMasterdataValidationContext({kind:'customer_masterdata',companyId:company,customerId,environment:'test',rawPayload:f.original.raw_payload!,intentId:ownerId(71),routeId:ownerId(72),projection:projection as never})).toThrow('customer_masterdata_validation_context_unqualified')
 expect(readCustomerMasterdataOriginalProjection(token,f.original,actor)).toBeUndefined()
})
it('a READ actor without SEND can observe UD229 while the existing sender loader still refuses it',async()=>{
 await expect(loadCustomerMasterdataValidationContext(f.original,actor)).rejects.toMatchObject({code:'42501'})
 io.rpc=[]
 const q=await qualified(),token=await loadReceivedZ04HAddressContext(f.source,actor,q)
 expect(fields(observe(policy(q,token),omitted(f.source.raw_payload!,'UD')))).toEqual(['229'])
 expect(io.rpc.some(row=>row.name==='ediel_read_prodat_customer_masterdata_original_v1')).toBe(true)
 expect(io.rpc.some(row=>row.name==='gridex_ediel_accepted_transport_projection_v1'||row.name==='ediel_customer_masterdata_message_basis_v1'||row.name.startsWith('ediel_prepare_customer_masterdata'))).toBe(false)
})
it.each(['copy','JSON','expired','wrong actor','source id','source raw','source profile','original actor','repeat'] as const)('private customer original READ token %s cannot disclose its projection',async adverse=>{
 const token=await loadCustomerMasterdataOriginalRead(f.original,actor);expect(token).toBeDefined()
 let candidate=token,source=f.original,reader=actor
 if(adverse==='copy')candidate={...token} as CustomerMasterdataOriginalRead
 if(adverse==='JSON')candidate=JSON.parse(JSON.stringify(token))
 if(adverse==='expired')vi.setSystemTime(new Date(Date.now()+2001))
 if(adverse==='wrong actor')reader=ownerId(999)
 if(adverse==='source id')source={...source,id:ownerId(999)}
 if(adverse==='source raw')source={...source,raw_payload:source.raw_payload!+' '}
 if(adverse==='source profile')source={...source,rule_profile_version_id:ownerId(999)}
 if(adverse==='original actor')source={...source,created_by:ownerId(999)}
 if(adverse==='repeat')expect(readCustomerMasterdataOriginalProjection(token,source,reader)).toBeDefined()
 expect(readCustomerMasterdataOriginalProjection(candidate,source,reader)).toBeUndefined()
 if(['wrong actor','source id','source raw','source profile','original actor'].includes(adverse))expect(readCustomerMasterdataOriginalProjection(token,f.original,actor)).toBeUndefined()
})
it.each(['version','owner','reader','original actor','company','customer','binding id','binding environment','binding intent','binding route','binding hash','identity','street','postal'] as const)('customer original READ rejects a malformed actual RPC %s without creating sender authority',async adverse=>{
 const value=io.customer!,binding=value.messageBinding as Row
 if(adverse==='version')value.version=2
 if(adverse==='owner')value.owner='DECLARED_PUBLIC_CUSTOMER_FACTS'
 if(adverse==='reader')value.actorUserId=ownerId(999)
 if(adverse==='original actor')value.originalActorUserId=ownerId(999)
 if(adverse==='company')value.companyId=ownerId(999)
 if(adverse==='customer')value.customerId=ownerId(999)
 if(adverse==='binding id')binding.id=ownerId(999)
 if(adverse==='binding environment')binding.environment='production'
 if(adverse==='binding intent')binding.intentId=ownerId(999)
 if(adverse==='binding route')binding.routeId=ownerId(999)
 if(adverse==='binding hash')binding.payloadHash='0'.repeat(64)
 if(adverse==='identity')(value.customerIdentity as Row).agency='89'
 if(adverse==='street')(value.endUserMasterdata as Row).streetParts=['.','']
 if(adverse==='postal')(value.endUserMasterdata as Row).postalCode='1234567890'
 await expect(loadCustomerMasterdataOriginalRead(f.original,actor)).rejects.toThrow('customer_masterdata_original_read_result_invalid')
 expect(isQualifiedCustomerMasterdataProjection(value)).toBe(false)
})
it.each(['id','company_id','raw_payload','rule_profile_version_id','created_by'] as const)('customer original %s mutation during its actual READ cannot redirect or issue',async key=>{
 const original=structuredClone(f.original)
 io.customerHook=()=>{(f.original as unknown as Row)[key]=key==='raw_payload'?f.original.raw_payload!+' ':ownerId(999)}
 expect(await loadCustomerMasterdataOriginalRead(f.original,actor)).toBeUndefined()
 expect(io.rpc).toEqual([{name:'ediel_read_prodat_customer_masterdata_original_v1',args:{p_company_id:original.company_id,p_message_id:original.id,p_actor_user_id:actor}}])
})
it('slow customer original READ expires and a missing original remains unknown',async()=>{
 io.customerHook=()=>{vi.setSystemTime(new Date(Date.now()+2001))}
 expect(await loadCustomerMasterdataOriginalRead(f.original,actor)).toBeUndefined()
 vi.setSystemTime(new Date('2026-09-30T13:00:00Z'));io.customer=null
 const q=await qualified(),token=await loadReceivedZ04HAddressContext(f.source,actor,q),selected=policy(q,token)
 expect(observe(selected,omitted(f.source.raw_payload!,'UD'))).toEqual([])
 expect(fields(observe(selected,omitted(f.source.raw_payload!,'IV')))).toEqual(['252'])
})
it.each(['UNT','UNZ','immutable hash','rendered receipt','public flags'] as const)('customer original %s cannot select the native READ from public source data',async adverse=>{
 const original={...f.original} as EdielMessageRow&Row
 if(adverse==='UNT'||adverse==='UNZ'){
  original.raw_payload=original.raw_payload!.replace(adverse==='UNT'?/UNT+\+[0-9]+\+M/:/UNZ\+1\+I/,adverse==='UNT'?'UNT+999+M':'UNZ+2+I')
  original.immutable_payload_hash=evidenceHash(original.raw_payload);original.syntax_check_status='passed';original.validation_report={utiltsRuntime:{validation:{syntaxOk:true,classification:'accepted'}}}
 }
 if(adverse==='immutable hash')original.immutable_payload_hash='0'.repeat(64)
 if(adverse==='rendered receipt')original.immutable_rendered_at=null
 if(adverse==='public flags'){original.immutable_payload_hash=null;original.parsed_payload={customerMasterdataAuthorized:true,endUserAddressAvailable:true}}
 expect(await loadCustomerMasterdataOriginalRead(original,actor)).toBeUndefined();expect(io.rpc).toEqual([])
})
it.each(['ordinary','denied'] as const)('actual customer original READ %s failure retains local/security disposition through incoming integration',async adverse=>{
 io.errorRpc='ediel_read_prodat_customer_masterdata_original_v1';io.errorValue=adverse==='ordinary'?new Error('DECLARED_CUSTOMER_ORIGINAL_READ_FAILED'):{code:'42501',message:'DECLARED_CUSTOMER_READ_DENIED'}
 const error=await resolveCanonicalRuntimeDecisionWithRegistry(f.source,{actorUserId:actor}).catch(error=>error)
 if(adverse==='ordinary')expect(error).toBe(io.errorValue)
 else expect(error).toMatchObject({disposition:{kind:'security_quarantine',code:'EDIEL_ADDRESS_SOURCE_READ_FORBIDDEN'}})
})
it('accepted H original READ uses its separate current-reader RPC and grants no customer or sender context',async()=>{
 const token=await loadAcceptedProdatHOriginalRead(f.original,actor);expect(token).toBeDefined()
 expect(io.rpc).toEqual([{name:'ediel_read_prodat_h_accepted_original_v1',args:{p_company_id:company,p_message_id:originalId,p_actor_user_id:actor}}])
 expect(readCustomerMasterdataOriginalProjection(token as unknown as CustomerMasterdataOriginalRead,f.original,actor)).toBeUndefined()
 const projection=readAcceptedProdatHOriginalProjection(token,f.original,actor)
 expect(projection).toEqual({status:'accepted_projection',companyId:company,environment:'test',messageId:originalId,originalHash:evidenceHash(f.original.raw_payload!),observedAt:'2026-09-20T00:00:00.123455Z',authorizesProviderEntry:false})
 expect(Object.isFrozen(projection)).toBe(true);expect(isQualifiedCustomerMasterdataProjection(projection)).toBe(false)
 expect(isQualifiedCustomerMasterdataValidationContext(token)).toBe(false)
 expect(readAcceptedProdatHOriginalProjection(token,f.original,actor)).toBeUndefined()
})
it.each(['copy','JSON','expired','wrong actor','source id','source raw','source profile','original actor','repeat'] as const)('accepted original READ token %s cannot disclose transport knowledge',async adverse=>{
 const token=await loadAcceptedProdatHOriginalRead(f.original,actor);expect(token).toBeDefined()
 let candidate=token,source=f.original,reader=actor
 if(adverse==='copy')candidate={...token} as AcceptedProdatHOriginalRead
 if(adverse==='JSON')candidate=JSON.parse(JSON.stringify(token))
 if(adverse==='expired')vi.setSystemTime(new Date(Date.now()+2001))
 if(adverse==='wrong actor')reader=ownerId(999)
 if(adverse==='source id')source={...source,id:ownerId(999)}
 if(adverse==='source raw')source={...source,raw_payload:source.raw_payload!+' '}
 if(adverse==='source profile')source={...source,rule_profile_version_id:ownerId(999)}
 if(adverse==='original actor')source={...source,created_by:ownerId(999)}
 if(adverse==='repeat')expect(readAcceptedProdatHOriginalProjection(token,source,reader)).toBeDefined()
 expect(readAcceptedProdatHOriginalProjection(candidate,source,reader)).toBeUndefined()
 if(['wrong actor','source id','source raw','source profile','original actor'].includes(adverse))expect(readAcceptedProdatHOriginalProjection(token,f.original,actor)).toBeUndefined()
})
it.each(['version','owner','reader','original actor','status','company','environment','message','hash','observedAt','provider authority','binding id','binding environment','binding intent','binding route','binding hash'] as const)('accepted H original READ rejects malformed actual RPC %s before customer discovery',async adverse=>{
 const value=io.accepted!,binding=value.messageBinding as Row
 if(adverse==='version')value.version=2
 if(adverse==='owner')value.owner='DECLARED_PUBLIC_TRANSPORT_RECEIPT'
 if(adverse==='reader')value.actorUserId=ownerId(999)
 if(adverse==='original actor')value.originalActorUserId=ownerId(999)
 if(adverse==='status')value.status='delivery_claimed'
 if(adverse==='company')value.companyId=ownerId(999)
 if(adverse==='environment')value.environment='production'
 if(adverse==='message')value.messageId=ownerId(999)
 if(adverse==='hash')value.originalHash='0'.repeat(64)
 if(adverse==='observedAt')value.observedAt='not-a-clock'
 if(adverse==='provider authority')value.authorizesProviderEntry=true
 if(adverse==='binding id')binding.id=ownerId(999)
 if(adverse==='binding environment')binding.environment='production'
 if(adverse==='binding intent')binding.intentId=ownerId(999)
 if(adverse==='binding route')binding.routeId=ownerId(999)
 if(adverse==='binding hash')binding.payloadHash='0'.repeat(64)
 const q=await qualified()
 await expect(loadReceivedZ04HAddressContext(f.source,actor,q)).rejects.toThrow('prodat_h_accepted_original_read_result_invalid')
 expect(io.rpc.some(row=>row.name==='ediel_read_prodat_customer_masterdata_original_v1')).toBe(false)
})
it.each(['id','company_id','raw_payload','rule_profile_version_id','created_by'] as const)('accepted original %s mutation while READ awaits cannot redirect or issue',async key=>{
 const original=structuredClone(f.original)
 io.acceptedHook=()=>{(f.original as unknown as Row)[key]=key==='raw_payload'?f.original.raw_payload!+' ':ownerId(999)}
 expect(await loadAcceptedProdatHOriginalRead(f.original,actor)).toBeUndefined()
 expect(io.rpc).toEqual([{name:'ediel_read_prodat_h_accepted_original_v1',args:{p_company_id:original.company_id,p_message_id:original.id,p_actor_user_id:actor}}])
})
it('slow accepted original READ expires without disclosing a customer basis',async()=>{
 const q=await qualified();io.acceptedHook=()=>{vi.setSystemTime(new Date(Date.now()+2001))}
 const token=await loadReceivedZ04HAddressContext(f.source,actor,q)
 expect(observe(policy(q,token),omitted(f.source.raw_payload!,'UD'))).toEqual([])
 expect(io.rpc.some(row=>row.name==='ediel_read_prodat_customer_masterdata_original_v1')).toBe(false)
})
it.each(['ordinary','denied'] as const)('actual accepted H original READ %s failure propagates through the incoming consumer',async adverse=>{
 io.errorRpc='ediel_read_prodat_h_accepted_original_v1';io.errorValue=adverse==='ordinary'?new Error('DECLARED_ACCEPTED_ORIGINAL_READ_FAILED'):{code:'42501',message:'DECLARED_ACCEPTED_ORIGINAL_READ_DENIED'}
 const error=await resolveCanonicalRuntimeDecisionWithRegistry(f.source,{actorUserId:actor}).catch(error=>error)
 if(adverse==='ordinary')expect(error).toBe(io.errorValue)
 else expect(error).toMatchObject({disposition:{kind:'security_quarantine',code:'EDIEL_ADDRESS_SOURCE_READ_FORBIDDEN'}})
})
