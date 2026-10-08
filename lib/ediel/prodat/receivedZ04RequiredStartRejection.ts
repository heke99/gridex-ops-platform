import {isDeepStrictEqual} from 'node:util'
import {supabaseService} from '@/lib/supabase/service'
import type {EdielMessageRow} from '@/lib/ediel/types'
import type {CanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
import {EdielExecutionFailure} from '@/lib/ediel/core/failureDisposition'
import {assertEdielTenantActor} from '@/lib/ediel/services/authorization'
import {requireEdielInboundLegalContext} from '@/lib/ediel/tenant/sourceLegalContext'
import {resolveCanonicalRulePack,receivedOriginalRulePackWitness} from '@/lib/ediel/rulebook/canonicalRulePackRegistry'
import {evidenceHash,isEvidenceRecord,isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {parseSourceReceiptInstant} from '@/lib/ediel/utilts/receivedSourceInventory'
import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {bindReceivedRegisterValidation} from '@/lib/ediel/core/receivedRegisterValidationBinding'
import {prodatRegisterGroups} from './prodatRegisterGroups'
import {prodatEndUserWireSubtype} from '@/lib/ediel/rulebook/prodatEndUserPolicy'
import {prodatDateState} from './prodatDateFields'
import {consumeReceivedZ04RequiredStartStructure,observeReceivedZ04RequiredStart} from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import {projectProdatDiagnostics} from './prodatDiagnosticProjection'
import {isQualifiedProdatApplicationError} from './prodatDiagnosticProjection'

declare const rejectionBrand:unique symbol
/** Not an operational policy or business/source capability. */
export type ReceivedZ04RequiredStartRejection=Readonly<{[rejectionBrand]:true}>
type Witness=NonNullable<ReturnType<typeof receivedOriginalRulePackWitness>>
const contextKeys=['version','contextOrigin','sourceMessageId','companyId','environment','messageCode','payloadHash','sourceReceivedAt','capturedAt']
const reads=new WeakMap<ReceivedZ04RequiredStartRejection,{identity:string;actor:string;readAt:number;witness:Witness}>()
const owners=new WeakMap<object,{identity:string;decisionHash:string;actor:string}>()
function bornIdentity(value:unknown):string|null {
 if(!isEvidenceRecord(value)||value.direction!=='inbound'||value.message_standard!=='edifact'||value.message_family!=='PRODAT'
  ||value.message_code!=='Z04'||!isEvidenceUuid(value.id)||!isEvidenceUuid(value.company_id)||!['test','production'].includes(String(value.environment))
  ||typeof value.raw_payload!=='string'||Buffer.byteLength(value.raw_payload,'utf8')>262144||!isEvidenceRecord(value.execution_context_snapshot))return null
 const context=value.execution_context_snapshot.receivedProdatContext,received=parseSourceReceiptInstant(value.message_received_at)
 const created=parseSourceReceiptInstant(value.created_at),document=value.message_created_at===null?null:parseSourceReceiptInstant(value.message_created_at)
 if(!isEvidenceRecord(context)||Object.keys(context).length!==contextKeys.length||!contextKeys.every(key=>Object.hasOwn(context,key))
  ||context.version!==1||context.contextOrigin!=='database_insert'||context.sourceMessageId!==value.id||context.companyId!==value.company_id
  ||context.environment!==value.environment||context.messageCode!==value.message_code||context.payloadHash!==evidenceHash(value.raw_payload)
  ||received===null||created===null||parseSourceReceiptInstant(context.sourceReceivedAt)!==received||parseSourceReceiptInstant(context.capturedAt)===null
  ||value.message_created_at!==null&&document===null)return null
 return evidenceHash(JSON.stringify([value.id,value.company_id,value.environment,value.direction,value.message_standard,value.message_family,
  value.message_code,value.message_version,value.application_reference,value.raw_payload,received.toString(),created.toString(),document?.toString()??null,
  parseSourceReceiptInstant(context.capturedAt)!.toString(),value.canonical_rule_pack_id,value.rule_profile_key,value.rule_profile_version_id,
  value.rule_profile_version,value.rule_pack_checksum,value.rule_pack_snapshot]))
}
function bornWitness(source:EdielMessageRow):Witness|null {
 const snapshot=source.rule_pack_snapshot
 if(!isEvidenceRecord(snapshot)||snapshot.profileKey!==source.rule_profile_key||snapshot.profileVersionId!==source.rule_profile_version_id
  ||snapshot.version!==source.rule_profile_version||snapshot.checksum!==source.rule_pack_checksum)return null
 return receivedOriginalRulePackWitness({profileKey:source.rule_profile_key,messageProfileId:source.rule_profile_version_id,
  rulePackId:source.canonical_rule_pack_id,sourceHash:source.rule_pack_checksum,version:source.rule_profile_version,
  snapshot:{rulePack:snapshot.rulePack,messageProfile:snapshot.messageProfile,guideSources:snapshot.guideSources}})
}
/** Fresh authenticated READs bind the actual born original. The catalogue is
 * only a named grammar/guide comparison; no missing event time is substituted. */
export async function assertReceivedZ04RequiredStartActor(source:EdielMessageRow,actor:string):Promise<boolean> {
 if(!isEvidenceUuid(actor)||!isEvidenceUuid(source.company_id))return false
 // Only this actual current actor-check stage may classify a direct SQL denial.
 try{await assertEdielTenantActor({companyId:source.company_id,actorUserId:actor,permission:'communication.read'});return true}
 catch(error){
  if(error instanceof EdielExecutionFailure&&error.disposition.kind==='security_quarantine')throw error
  if(error&&typeof error==='object'&&Object.getOwnPropertyDescriptor(error,'code')?.value==='42501'){
   const refusal=new EdielExecutionFailure({kind:'security_quarantine',code:'EDIEL_TENANT_ACTOR_FORBIDDEN'},'ediel_tenant_actor_forbidden')
   Object.defineProperty(refusal,'cause',{value:error,enumerable:false});throw refusal
  }
  return false
 }
}
export async function loadReceivedZ04RequiredStartRejection(source:EdielMessageRow,actor:string):Promise<ReceivedZ04RequiredStartRejection|null> {
 const started=Date.now()
 const sourceId=source.id,companyId=source.company_id,environment=source.environment
 const actorSource:EdielMessageRow={...source,company_id:companyId}
 // Freeze the READ principal before the actor await. An unavailable birth
 // identity must still leave the actual actor denial/quarantine first.
 let identity:string|null=null
 try{identity=bornIdentity(source)}catch{/* Refuse the unavailable birth after the actor check. */}
 if(!await assertReceivedZ04RequiredStartActor(actorSource,actor))return null
 try{
  if(!identity||!isEvidenceUuid(companyId))return null
  const stored=await supabaseService.from('ediel_messages').select('*').eq('id',sourceId).eq('company_id',companyId).single()
  if(stored.error||bornIdentity(stored.data)!==identity)return null
  const original=stored.data as EdielMessageRow,witness=bornWitness(original)
  if(!witness)return null
  const wire=tokenizeEdifact(original.raw_payload!),unb=wire.segments.filter(row=>row.tag==='UNB'),unh=wire.segments.filter(row=>row.tag==='UNH')
  const groups=prodatRegisterGroups(wire.segments,wire.una,'Z04').groups,first=groups.filter(group=>group.registerPosition===1)
  if(!first.length||groups.some(group=>group.messageIndex!==0||!group.validRegisterChain)
   ||first.some(group=>prodatEndUserWireSubtype('Z04',group.segments,wire.una)!=='A')
   ||!first.some(group=>!prodatDateState('210',group.segments,wire.una).present))return null
  const legal=await requireEdielInboundLegalContext(companyId,sourceId)
  const basis=legal as unknown as Record<string,unknown>,projection=basis.canonicalProjection
  const receivers=wire.segments.filter(row=>row.tag==='NAD'&&segmentComposite(row,1,wire.una)[0]==='DO')
  const received=parseSourceReceiptInstant(original.message_received_at)
  if(Date.now()-started>2000||Date.now()<started||unb.length!==1||unh.length!==1||receivers.length!==1
   ||legal.basisKind!=='observed_source_persistence'||legal.direction!=='inbound'||legal.environment!==environment
   ||basis.family!=='PRODAT'||basis.code!=='Z04'||basis.subtype!=='A'||!isEvidenceUuid(legal.legalActorId)||!isEvidenceUuid(legal.transportActorId)
   ||legal.actorRole!=='electricity_supplier'||legal.legalEdielId!==segmentComposite(receivers[0],2,wire.una)[0]
   ||legal.transportEdielId!==segmentComposite(unb[0],3,wire.una)[0]
   ||legal.applicationReference!==segmentComposite(unb[0],7,wire.una)[0]
   ||environment!==(segmentComposite(unb[0],11,wire.una)[0]==='1'?'test':'production')
   ||typeof basis.sourceEdition!=='string'||!/^[a-f0-9]{64}$/.test(basis.sourceEdition)
   ||received===null||parseSourceReceiptInstant(legal.sourceReceivedAt)!==received||parseSourceReceiptInstant(legal.observedAt)===null
   ||!isEvidenceRecord(projection)||projection.family!=='PRODAT'||projection.code!=='Z04'||projection.subtype!=='A'
   ||projection.transactionReasonCode!=='Z26'||!['inbound','both'].includes(String(projection.direction))
   ||!Array.isArray(projection.receiverRoles)||!projection.receiverRoles.some(role=>['supplier','electricity_supplier'].includes(role))
   ||!Array.isArray(projection.applicationReferences)||!projection.applicationReferences.includes(legal.applicationReference))return null
  // Birth date selects only catalogue evidence, never a business start/ground.
  const evidence=await resolveCanonicalRulePack({family:'PRODAT',messageCode:'Z04',transactionSubtype:'A',direction:'inbound',
   applicationReference:legal.applicationReference,businessDate:new Date(Number(received/BigInt(1000))).toISOString().slice(0,10),
   requireBuilder:false,requireStateMachine:false})
  const named=receivedOriginalRulePackWitness({profileKey:evidence.profileKey,databaseProfileKey:evidence.databaseProfileKey,
   messageProfileId:evidence.messageProfileId,rulePackId:evidence.rulePackId,sourceHash:evidence.sourceHash,
   version:evidence.originalVersion,snapshot:evidence.originalSnapshot})
  if(!named||!isDeepStrictEqual(named,witness)||segmentComposite(unh[0],2,wire.una)[4]!==evidence.unhAssociationCode
   ||Date.now()-started>2000||Date.now()<started)return null
  const token=Object.freeze({}) as ReceivedZ04RequiredStartRejection
  reads.set(token,{identity,actor,readAt:started,witness});return token
 }catch(error){
  if(error instanceof EdielExecutionFailure&&error.disposition.kind==='security_quarantine')throw error
  return null
 }
}
export function readReceivedZ04RequiredStartWitness(token:ReceivedZ04RequiredStartRejection,source:EdielMessageRow,actor:string):Witness|null {
 const read=reads.get(token)
 return read&&read.actor===actor&&read.identity===bornIdentity(source)&&Date.now()>=read.readAt&&Date.now()-read.readAt<=2000
  ?structuredClone(read.witness):null
}
/** Redeem once into only a rejected decision whose genuine register owner and
 * typed errors remain bound to the exact physical source. Copies grant nothing. */
export function ownReceivedZ04RequiredStartRejection(decision:CanonicalRuntimeDecision,source:EdielMessageRow,actor:string,
 token:ReceivedZ04RequiredStartRejection):boolean {
 const read=reads.get(token);reads.delete(token)
 const plans=decision.responsePlan.filter(plan=>plan.family==='APERAK')
 if(!read||read.actor!==actor||read.identity!==bornIdentity(source)||Date.now()-read.readAt>2000||Date.now()<read.readAt
  ||decision.policy!==null||decision.syntaxDecision!=='accepted'||decision.applicationDecision!=='rejected'||decision.functionalDecision!=='not_applicable'
  ||!bindReceivedRegisterValidation(decision.prodatRegisterValidation,source.raw_payload!)||plans.length!==1||plans[0].outcome!=='negative'
  ||!plans[0].applicationErrors?.length||!plans[0].applicationErrors.every(error=>isQualifiedProdatApplicationError(error)
   &&error.fieldCode==='210'&&error.ercCode==='41'&&error.prodatFieldDiagnostic?.kind==='field'&&error.prodatFieldDiagnostic.errorKind==='missing')
  ||!isDeepStrictEqual(receivedOriginalRulePackWitness(decision.validationReport.rulePackEvidence),read.witness))return false
 const wire=tokenizeEdifact(source.raw_payload!)
 if(!isDeepStrictEqual(plans[0].applicationErrors,projectProdatDiagnostics(observeReceivedZ04RequiredStart({rawSegments:wire.segments.map(row=>row.raw),una:wire.una})).applicationErrors)
  ||!consumeReceivedZ04RequiredStartStructure(decision.prodatRegisterValidation,source.raw_payload!))return false
 owners.set(decision,{identity:read.identity,actor,decisionHash:evidenceHash(JSON.stringify(decision))});return true
}
/** Observation only; mutable/copy/status JSON never qualifies this route. */
export function hasReceivedZ04RequiredStartRejection(decision:object,source:unknown,actor?:string):boolean {
 const owner=owners.get(decision)
 return Boolean(owner&&(actor===undefined||owner.actor===actor)&&owner.identity===bornIdentity(source)&&owner.decisionHash===evidenceHash(JSON.stringify(decision)))
}
