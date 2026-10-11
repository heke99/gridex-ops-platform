// Unapplied candidate: protected original/source READs only; no sender authority.
import {isDeepStrictEqual} from 'node:util'
import {supabaseService} from '@/lib/supabase/service'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {resolveCanonicalEdielPolicy,type CanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import type {EdielRulebookIssue} from '@/lib/ediel/rulebook/rulebook'
import {assertEdielTenantActor} from '@/lib/ediel/services/authorization'
import {requireEdielInboundLegalContext} from '@/lib/ediel/tenant/sourceLegalContext'
import {readInboundReceptionRequest} from '@/lib/ediel/inbound/receptions'
import {readSourceQualifiedBilateralProdatOutboundOriginal} from '@/lib/ediel/production/bilateralProdatOutboundDraft'
import {loadCustomerMasterdataOriginalRead,readCustomerMasterdataOriginalProjection,loadAcceptedProdatHOriginalRead,readAcceptedProdatHOriginalProjection} from '@/lib/ediel/production/customerMasterdataOriginalRead'
import {evidenceHash,isEvidenceRecord,isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {parseSourceReceiptInstant} from '@/lib/ediel/utilts/receivedSourceInventory'
import {sourceQualifiedProdatBilateralCapability,type SourceQualifiedProdatBilateralCapability} from '@/lib/ediel/core/prodatBilateralSourceCapability'
import {originalAckPartyIdentities} from '@/lib/ediel/core/originalAckPartyIdentities'
import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {prodatPartyState} from '@/lib/ediel/prodat/prodatPartyFields'
import {prodatEndUserWireSubtype} from '@/lib/ediel/rulebook/prodatEndUserPolicy'
import {prodatEndUserAddressWireLines} from '@/lib/ediel/prodat/prodatEndUserAddress'
import {prodatFieldDiagnostic} from '@/lib/ediel/prodat/prodatFieldDiagnostic'
import type {EdifactServiceStringAdvice} from '@/lib/ediel/core/una'
import {parseCanonicalMessageRow} from '@/lib/ediel/core/canonicalMessage'
import {validateEdifactSyntax} from '@/lib/ediel/core/syntaxValidator'
import {stockholmBusinessDate} from '@/lib/ediel/core/executionContext'
import {EdielExecutionFailure} from '@/lib/ediel/core/failureDisposition'

declare const addressContextBrand:unique symbol
export type ReceivedZ04HAddressContext=Readonly<{[addressContextBrand]:true}>
type KnownAddress=Readonly<{field:'229'|'252';role:'UD'|'IV';objectId:string;agency:'9'|'89';li:string;identity:readonly string[]}>
type State={sourceIdentity:string;actor:string;qualification:SourceQualifiedProdatBilateralCapability;source:EdielMessageRow;readAt:number;known:readonly KnownAddress[]}
const contexts=new WeakMap<ReceivedZ04HAddressContext,State>()
const policies=new WeakMap<CanonicalEdielPolicy,{state:State;policyHash:string}>()
const bornKeys=['version','contextOrigin','sourceMessageId','companyId','environment','messageCode','payloadHash','sourceReceivedAt','capturedAt']
function identity(source:EdielMessageRow):string|null {
 if(!isEvidenceUuid(source.id)||!isEvidenceUuid(source.company_id)||!isEvidenceUuid(source.inbound_email_message_id)
  ||!['test','production'].includes(source.environment)||source.direction!=='inbound'||source.message_standard!=='edifact'
  ||source.message_family!=='PRODAT'||source.message_code!=='Z04'||typeof source.raw_payload!=='string'
  ||Buffer.byteLength(source.raw_payload,'utf8')>262144||hash(source)!==evidenceHash(source.raw_payload)
  ||!isEvidenceRecord(source.execution_context_snapshot))return null
 const born=source.execution_context_snapshot.receivedProdatContext,received=parseSourceReceiptInstant(source.message_received_at)
 const created=parseSourceReceiptInstant(source.created_at),captured=isEvidenceRecord(born)?parseSourceReceiptInstant(born.capturedAt):null
 const document=source.message_created_at===null?null:parseSourceReceiptInstant(source.message_created_at)
 if(!isEvidenceRecord(born)||Object.keys(born).length!==bornKeys.length||!bornKeys.every(key=>Object.hasOwn(born,key))
  ||born.version!==1||born.contextOrigin!=='database_insert'||born.sourceMessageId!==source.id||born.companyId!==source.company_id
  ||born.environment!==source.environment||born.messageCode!=='Z04'||born.payloadHash!==evidenceHash(source.raw_payload)
  ||received===null||created===null||captured===null||parseSourceReceiptInstant(born.sourceReceivedAt)!==received
  ||source.message_created_at!==null&&document===null)return null
 return evidenceHash(JSON.stringify([source.id,source.company_id,source.environment,source.direction,source.message_standard,
  source.message_family,source.message_code,source.message_version,source.application_reference,source.inbound_email_message_id,
  source.raw_payload,hash(source),received.toString(),created.toString(),captured.toString(),document?.toString()??null,
  source.canonical_rule_pack_id,source.rule_profile_key,source.rule_profile_version_id,source.rule_profile_version,
  source.rule_pack_checksum,source.rule_pack_snapshot]))
}
function fresh(readAt:number):boolean{return Date.now()>=readAt&&Date.now()-readAt<=2000}
/** Classify only a direct denial from an actual installed READ/actor call.
 * Other service/source failures remain errors, never national protocol facts. */
async function protectedRead<T>(operation:()=>PromiseLike<T>):Promise<T>{
 try{return await operation()}
 catch(error){throwServiceReadError(error)}
}
function throwServiceReadError(error:unknown):never{
 if(error&&typeof error==='object'&&Object.getOwnPropertyDescriptor(error,'code')?.value==='42501'){
  const held=new EdielExecutionFailure({kind:'security_quarantine',code:'EDIEL_ADDRESS_SOURCE_READ_FORBIDDEN'},'ediel_address_source_read_forbidden')
  Object.defineProperty(held,'cause',{value:error,enumerable:false});throw held
 }
 throw error
}
function physicalSource(source:EdielMessageRow){
 // Cached mutable status/report never qualifies the actual physical syntax.
 if(!validateEdifactSyntax({...source,status:'received',syntax_check_status:'not_checked',validation_report:{},failure_reason:null}).ok)return null
 const wire=tokenizeEdifact(source.raw_payload!),unh=wire.segments.filter(row=>row.tag==='UNH'),unb=wire.segments.filter(row=>row.tag==='UNB')
 const bgm=wire.segments.filter(row=>row.tag==='BGM'),canonical=parseCanonicalMessageRow(source)
 if(unh.length!==1||unb.length!==1||bgm.length!==1||segmentComposite(unh[0],2,wire.una).join(':')!=='PRODAT:D:97A:UN:E2SE6A'
  ||segmentComposite(unb[0],7,wire.una).join(':')!=='23-DDQ-PRODAT'||segmentComposite(bgm[0],1,wire.una).join(':')!=='Z04'
  ||source.environment!==(segmentComposite(unb[0],11,wire.una)[0]==='1'?'test':'production')
  ||canonical.family!=='PRODAT'||canonical.messageCode!=='Z04'||canonical.subtype!=='Z25'
  ||canonical.version!=='E2SE6A'||canonical.applicationReference!=='23-DDQ-PRODAT')return null
 const grouped=prodatRegisterGroups(wire.segments,wire.una,'Z04'),first=grouped.groups.filter(group=>group.registerPosition===1)
 if(grouped.problems.length||!first.length||grouped.groups.some(group=>group.messageIndex!==0||!group.validRegisterChain)
  ||first.some(group=>!group.itemId||!['9','89'].includes(group.identityAgency??'')||prodatEndUserWireSubtype('Z04',group.segments,wire.una)!=='H'))return null
 return {wire,unb:unb[0],canonical}
}

/** Reuse installed first-persistence/legal/reception readers. A public row or
 * successful-looking runtime report does not authenticate mailbox reception. */
async function readBornSource(source:EdielMessageRow,actor:string,qualification:SourceQualifiedProdatBilateralCapability){
 // Capture every principal before the first await. No later query uses caller
 // fields that may have changed while the actor guard was running.
 const sourceId=source.id,companyId=source.company_id,environment=source.environment,before=identity(source)
 if(!isEvidenceUuid(actor)||!isEvidenceUuid(companyId))return null
 await protectedRead(()=>assertEdielTenantActor({companyId,actorUserId:actor,permission:'communication.read'}))
 if(!before)return null
 const result=await supabaseService.from('ediel_messages').select('*').eq('company_id',companyId).eq('environment',environment).eq('id',sourceId).single()
 if(result.error)throwServiceReadError(result.error)
 const stored=result.data as EdielMessageRow|null
 if(!stored||identity(stored)!==before||identity(source)!==before)return null
 const capability=sourceQualifiedProdatBilateralCapability(stored,qualification),physical=physicalSource(stored)
 if(!physical||!capability||capability.subtype!=='H'||capability.owner!=='immutable-bilateral-prodat-profile-v1'
  ||capability.objects.some(own=>own.process!=='normal_start_h'))return null
 const legal=await protectedRead(()=>requireEdielInboundLegalContext(companyId,sourceId)),basis=legal as unknown as Record<string,unknown>
 const projection=basis.canonicalProjection,receivers=physical.wire.segments.filter(row=>row.tag==='NAD'&&segmentComposite(row,1,physical.wire.una).join(':')==='DO')
 const received=parseSourceReceiptInstant(stored.message_received_at)
 if(legal.basisKind!=='observed_source_persistence'||legal.companyId!==companyId||legal.direction!=='inbound'||legal.environment!==environment
  ||basis.family!=='PRODAT'||basis.code!=='Z04'||basis.subtype!=='H'||legal.actorRole!=='electricity_supplier'
  ||!isEvidenceUuid(legal.legalActorId)||!isEvidenceUuid(legal.transportActorId)||receivers.length!==1
  ||legal.legalEdielId!==segmentComposite(receivers[0],2,physical.wire.una)[0]||legal.transportEdielId!==segmentComposite(physical.unb,3,physical.wire.una)[0]
  ||legal.applicationReference!==physical.canonical.applicationReference||received===null||parseSourceReceiptInstant(legal.sourceReceivedAt)!==received
  ||parseSourceReceiptInstant(legal.observedAt)===null||typeof basis.sourceEdition!=='string'||!/^[a-f0-9]{64}$/.test(basis.sourceEdition)
  ||!isEvidenceRecord(projection)||projection.family!=='PRODAT'||projection.code!=='Z04'||projection.subtype!=='H'
  ||projection.transactionReasonCode!=='Z25'||!['inbound','both'].includes(String(projection.direction))
  ||!Array.isArray(projection.receiverRoles)||!projection.receiverRoles.some(role=>['supplier','electricity_supplier'].includes(String(role)))
  ||!Array.isArray(projection.applicationReferences)||!projection.applicationReferences.includes(legal.applicationReference))return null
 const reception=await protectedRead(()=>readInboundReceptionRequest({companyId,messageId:sourceId,inboundEmailMessageId:stored.inbound_email_message_id!,actorUserId:actor}))
 // The protected READ marks rereading an existing reception as isReplay.
 // Physical duplicate/conflict custody is determined by its classification.
 if(!reception||reception.classification!=='first_reception'||reception.status!=='observed'
  ||!isEvidenceUuid(reception.receptionId)||!isEvidenceUuid(reception.parseResultId)||reception.businessEffectAuthorized!==false
  ||reception.responseRequestId!==null||reception.reason!==null||reception.canonicalPayloadHash!==evidenceHash(stored.raw_payload!)
  ||reception.receivedPayloadHash!==reception.canonicalPayloadHash||parseSourceReceiptInstant(reception.receivedAt)!==received)return null
 const [mail,parsed]=await Promise.all([
  supabaseService.from('inbound_email_messages').select('id,company_id,environment,received_at,raw_edifact_payload')
   .eq('id',stored.inbound_email_message_id!).eq('company_id',companyId).eq('environment',environment).maybeSingle(),
  supabaseService.from('inbound_ediel_parse_results').select('id,company_id,inbound_email_message_id,raw_payload,parse_status')
   .eq('id',reception.parseResultId).eq('company_id',companyId).maybeSingle(),
 ])
 if(mail.error)throwServiceReadError(mail.error)
 if(parsed.error)throwServiceReadError(parsed.error)
 if(!mail.data||mail.data.id!==stored.inbound_email_message_id||mail.data.company_id!==companyId||mail.data.environment!==environment
  ||mail.data.raw_edifact_payload!==stored.raw_payload||parseSourceReceiptInstant(mail.data.received_at)!==received||!parsed.data
  ||parsed.data.id!==reception.parseResultId||parsed.data.company_id!==companyId||parsed.data.inbound_email_message_id!==stored.inbound_email_message_id
  ||parsed.data.raw_payload!==stored.raw_payload||parsed.data.parse_status!=='parsed')return null
 // Freeze a detached source after actual reads. Keep no mutable caller row.
 return {source:structuredClone(stored),capability,before,received,companyId,environment,sourceId}
}
function hash(source:EdielMessageRow):unknown {return (source as unknown as Record<string,unknown>).immutable_payload_hash}
function sameParties(a:EdielMessageRow,b:EdielMessageRow):boolean {
 const outgoing=originalAckPartyIdentities({rawPayload:a.raw_payload,expectedFamily:'PRODAT'})
 const incoming=originalAckPartyIdentities({rawPayload:b.raw_payload,expectedFamily:'PRODAT'})
 const left=tokenizeEdifact(a.raw_payload!),right=tokenizeEdifact(b.raw_payload!)
 const au=left.segments.filter(row=>row.tag==='UNB'),bu=right.segments.filter(row=>row.tag==='UNB')
 return au.length===1&&bu.length===1&&outgoing.applicationReference===incoming.applicationReference
  &&isDeepStrictEqual(outgoing.legalSender,incoming.legalReceiver)&&isDeepStrictEqual(outgoing.legalReceiver,incoming.legalSender)
  &&isDeepStrictEqual(segmentComposite(au[0],2,left.una),segmentComposite(bu[0],3,right.una))
  &&isDeepStrictEqual(segmentComposite(au[0],3,left.una),segmentComposite(bu[0],2,right.una))
}

/** The LI query selects a candidate only. Current source/profile, original,
 * transport and masterdata readers establish the independent address premise. */
export async function loadReceivedZ04HAddressContext(inputSource:EdielMessageRow,actor:string,
 qualification:SourceQualifiedProdatBilateralCapability):Promise<ReceivedZ04HAddressContext|null> {
 const born=await readBornSource(inputSource,actor,qualification)
 if(!born)return null
 const {source,capability,before,received,companyId,environment,sourceId}=born
 const known:KnownAddress[]=[],originalReadClocks:number[]=[]
 for(const own of capability.objects){
  const switches=await supabaseService.from('supplier_switch_requests')
   .select('id,company_id,customer_id,metering_point_id,site_id,customer_site_id,contract_id,customer_contract_id,outbound_z03_message_id,rff_li_reference')
   .eq('company_id',companyId).eq('rff_li_reference',own.lineItemReference)
   .eq('prodat_variant','H').eq('prodat_reason','Z25').not('outbound_z03_message_id','is',null).limit(2)
  if(switches.error)throwServiceReadError(switches.error)
  // Missing/ambiguous discovery leaves only this object's knowledge unknown.
  // A record selected by LI is never itself an address or response authority.
  if(switches.data?.length!==1)continue
  const selected=switches.data[0]
  if(!isEvidenceUuid(selected.outbound_z03_message_id))continue
  const read=await supabaseService.from('ediel_messages').select('*').eq('company_id',companyId)
   .eq('environment',environment).eq('id',selected.outbound_z03_message_id).eq('direction','outbound')
   .eq('message_standard','edifact').eq('message_family','PRODAT').eq('message_code','Z03').maybeSingle()
  if(read.error)throwServiceReadError(read.error)
  const original=read.data as EdielMessageRow|null
  if(!original?.raw_payload||hash(original)!==evidenceHash(original.raw_payload)||original.switch_request_id!==selected.id
   ||original.customer_id!==selected.customer_id||original.metering_point_id!==selected.metering_point_id
   ||original.site_id!==(selected.site_id??selected.customer_site_id)||!sameParties(original,source))continue
  const q=await protectedRead(()=>readSourceQualifiedBilateralProdatOutboundOriginal(original,actor)),originalReadAt=Date.now()
  const matches=q?.objects.filter(row=>row.objectId===own.objectId&&row.identityAgency===own.identityAgency
   &&row.lineItemReference===own.lineItemReference&&row.profileVersionId===own.profileVersionId
   &&row.process===own.process&&row.sourceHash===own.sourceHash&&row.sourceGrammarHash===own.sourceGrammarHash
   &&row.customerId===selected.customer_id&&row.pointId===selected.metering_point_id
   &&row.siteId===(selected.site_id??selected.customer_site_id)&&row.contractId===(selected.contract_id??selected.customer_contract_id))
  if(!q||q.owner!=='immutable-bilateral-prodat-outbound-profile-v1'||q.messageCode!=='Z03'||matches?.length!==1
   ||(matches[0] as unknown as Record<string,unknown>).switchId!==selected.id)continue
  const acceptedRead=await protectedRead(()=>loadAcceptedProdatHOriginalRead(original,actor)),accepted=readAcceptedProdatHOriginalProjection(acceptedRead,original,actor)
  const acceptedAt=accepted?parseSourceReceiptInstant(accepted.observedAt):null
  if(!accepted||accepted.originalHash!==hash(original)||acceptedAt===null||acceptedAt>received)continue
  const wire=tokenizeEdifact(original.raw_payload),groups=prodatRegisterGroups(wire.segments,wire.una,'Z03')
  const first=groups.groups.filter(group=>group.messageIndex===0&&group.validRegisterChain&&group.registerPosition===1
   &&group.itemId===own.objectId&&group.identityAgency===own.identityAgency&&group.lineIndex===matches[0].firstLineIndex)
  if(groups.problems.length||first.length!==1)continue
  const group=first[0],uds=group.segments.filter(row=>row.tag==='NAD'&&segmentComposite(row,1,wire.una).join(':')==='UD')
  const context=await protectedRead(()=>loadCustomerMasterdataOriginalRead(original,actor)),projection=readCustomerMasterdataOriginalProjection(context,original,actor)
  if(projection&&projection.customerId===matches[0].customerId&&uds.length===1&&isDeepStrictEqual(segmentComposite(uds[0],2,wire.una),
   [projection.customerIdentity.id,projection.customerIdentity.qualifier,projection.customerIdentity.agency])
   &&isDeepStrictEqual(segmentComposite(uds[0],5,wire.una),prodatEndUserAddressWireLines(projection.endUserMasterdata.streetParts))
   &&projection.endUserMasterdata.streetParts.some(value=>value.trim()&&value!=='.'))known.push(Object.freeze({
    field:'229',role:'UD',objectId:own.objectId,agency:own.identityAgency,li:own.lineItemReference,identity:Object.freeze(segmentComposite(uds[0],2,wire.una))}))
  const ivs=group.segments.filter(row=>row.tag==='NAD'&&segmentComposite(row,1,wire.una).join(':')==='IV')
  const iv=prodatPartyState('252',group.segments,wire.una)
  if(ivs.length===1&&iv.present&&!iv.malformed&&!iv.tooLong&&segmentComposite(ivs[0],5,wire.una).some(value=>value.trim()&&value!=='.')){
   const id=prodatPartyState('250',group.segments,wire.una)
   if(id.present&&!id.malformed&&!id.tooLong)known.push(Object.freeze({field:'252',role:'IV',objectId:own.objectId,
    agency:own.identityAgency,li:own.lineItemReference,identity:Object.freeze(segmentComposite(ivs[0],2,wire.una))}))
  }
  originalReadClocks.push(originalReadAt)
 }
 await protectedRead(()=>assertEdielTenantActor({companyId,actorUserId:actor,permission:'communication.read'}))
 const final=await supabaseService.from('ediel_messages').select('*').eq('company_id',companyId).eq('environment',environment).eq('id',sourceId).single()
 if(final.error)throwServiceReadError(final.error)
 if(identity(inputSource)!==before||!final.data||identity(final.data as EdielMessageRow)!==before
  ||!sourceQualifiedProdatBilateralCapability(final.data as EdielMessageRow,capability))return null
 // Same two-second local READ lifetime as existing protected H rejection
 // ports; this is invocation freshness, never a market/protocol deadline.
 const readAt=originalReadClocks.length?Math.min(...originalReadClocks):Date.now()
 if(!fresh(readAt))return null
 const context=Object.freeze({}) as ReceivedZ04HAddressContext
 contexts.set(context,{sourceIdentity:before,actor,qualification:capability,source,readAt,known:Object.freeze(known)});return context
}

/** No public JSON/facts or copied token can attach knowledge to a policy. The
 * private port carries availability only; it grants no effect/ACK authority. */
export function bindReceivedZ04HAddressPolicy(policy:CanonicalEdielPolicy,source:EdielMessageRow,actor:string|undefined,
 context:ReceivedZ04HAddressContext|null|undefined):void {
 const state=context?contexts.get(context):undefined
 // Even a refused redemption exhausts this invocation's private token.
 if(context)contexts.delete(context)
 if(!state||!fresh(state.readAt)||state.actor!==actor||state.sourceIdentity!==identity(source)
  ||!sourceQualifiedProdatBilateralCapability(source,state.qualification)||policy.family!=='PRODAT'||policy.code!=='Z04'
  ||policy.direction!=='inbound'||policy.subtype!=='H'||policy.guide.guideRevision!=='26-A'
  ||policy.associationAssignedCode!=='E2SE6A'||policy.applicationReference!=='23-DDQ-PRODAT')return
 const physical=physicalSource(state.source)
 if(!physical)return
 const expected=resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:'Z04',subtypeOrReasonCode:physical.canonical.subtype,
  direction:'inbound',referenceDate:stockholmBusinessDate(new Date(state.source.message_received_at!)),
  associationAssignedCode:physical.canonical.version,applicationReference:physical.canonical.applicationReference,
  bilateralCapabilityVerified:true,mode:'parse'})
 const keys=['family','code','subtype','transactionReasonCode','direction','referenceDate','associationAssignedCode','applicationReference','guide','fieldRules'] as const
 if(keys.some(key=>!isDeepStrictEqual(policy[key],expected[key]))||expected.guide.fieldMatrixStatus!=='certified')return
 policies.set(policy,{state,policyHash:evidenceHash(JSON.stringify(policy))})
}

/** A preflight may check a physical derivative against the selected premise.
 * Actual runtime still must load and bind that derivative's own immutable source. */
export function validateReceivedZ04HAddressPresence(input:{policy:CanonicalEdielPolicy;rawPayload?:string|null;rawSegments:readonly string[];
 una?:EdifactServiceStringAdvice}):EdielRulebookIssue[] {
 const selected=policies.get(input.policy),state=selected?.state
 if(!state||!selected||!fresh(state.readAt)||selected.policyHash!==evidenceHash(JSON.stringify(input.policy))||!input.rawPayload)return []
 const observation={...state.source,raw_payload:input.rawPayload}
 const physical=physicalSource(observation)
 if(!physical||!isDeepStrictEqual(physical.wire.segments.map(row=>row.raw),input.rawSegments)
  ||!isDeepStrictEqual(originalAckPartyIdentities({rawPayload:state.source.raw_payload}),originalAckPartyIdentities({rawPayload:input.rawPayload})))return []
 const una=input.una??physical.wire.una
 if(!isDeepStrictEqual(una,physical.wire.una))return []
 const grouped=prodatRegisterGroups(input.rawSegments,una,'Z04')
 if(grouped.problems.length)return []
 const issues:EdielRulebookIssue[]=[]
 for(const group of grouped.groups.filter(row=>row.messageIndex===0&&row.validRegisterChain&&row.registerPosition===1)){
  if(prodatEndUserWireSubtype('Z04',group.segments,una)!=='H')continue
  const li=group.segments.filter(row=>row.tag==='RFF'&&segmentComposite(row,1,una)[0]==='LI')
  if(li.length!==1)continue
  for(const fact of state.known.filter(row=>row.objectId===group.itemId&&row.agency===group.identityAgency
   &&row.li===segmentComposite(li[0],1,una)[1]
   &&input.policy.fieldRules.some(rule=>'fieldNumber' in rule&&rule.fieldNumber===row.field))){
   const party=group.segments.filter(row=>row.tag==='NAD'&&segmentComposite(row,1,una).join(':')===fact.role)
   if(party.length!==1||!isDeepStrictEqual(segmentComposite(party[0],2,una),fact.identity)
    ||prodatPartyState(fact.field,group.segments,una).present)continue
   const sourceRule=fact.field==='229'?'PRODAT26A:P22/79/117–118':'PRODAT26A:P82/119'
   issues.push({scope:'prodat_dependent',severity:'error',blocking:true,code:'PRODAT_DEPENDENT_FIELD_MISSING',
    title:'Obligatoriskt PRODAT-fält saknas',description:`Eget fält ${fact.field} saknas trots skyddat tillgängligt adressunderlag.`,
    fieldPath:`NAD+${fact.role}/C059/3042[1..3]`,prodatDiagnostic:prodatFieldDiagnostic(fact.field,'missing',
     {code:'Z04',rawSegments:input.rawSegments,una},group.segments.map(row=>row.raw),sourceRule,group.lineIndex,'object')})
  }
 }
 return issues
}
