import {isDeepStrictEqual} from 'node:util'
import {supabaseService} from '@/lib/supabase/service'
import type {EdielMessageRow} from '@/lib/ediel/types'
import type {CanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
import {EdielExecutionFailure} from '@/lib/ediel/core/failureDisposition'
import {assertReceivedZ04RequiredStartActor} from './receivedZ04RequiredStartRejection'
import {validateEdifactSyntax} from '@/lib/ediel/core/syntaxValidator'
import {requireEdielInboundLegalContext} from '@/lib/ediel/tenant/sourceLegalContext'
import {receivedOriginalRulePackWitness} from '@/lib/ediel/rulebook/canonicalRulePackRegistry'
import {evidenceHash,isEvidenceRecord,isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {parseSourceReceiptInstant} from '@/lib/ediel/utilts/receivedSourceInventory'
import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {bindReceivedRegisterValidation} from '@/lib/ediel/core/receivedRegisterValidationBinding'
import {prodatRegisterGroups} from './prodatRegisterGroups'
import {prodatRegisterFieldState} from './prodatRegisterFields'
import {prodatRegisterReadingSubtype} from './prodatRegisterReadings'
import {canonicalProdat26AFieldRules} from './prodat26AFieldMatrix'
import {validateFieldMatrixPayload} from '@/lib/ediel/rulebook/fieldMatrix'
import type {EdielRulebookIssue} from '@/lib/ediel/rulebook/rulebook'
import {DEFAULT_UNA,type EdifactServiceStringAdvice} from '@/lib/ediel/core/una'
import {consumeReceivedZ04RequiredStartStructure} from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import {projectProdatDiagnostics} from './prodatDiagnosticProjection'
import {isQualifiedProdatApplicationError} from './prodatDiagnosticProjection'

declare const rejectionBrand:unique symbol
/** Not an operational policy or business/source capability. */
export type ReceivedZ04HRequiredFieldRejection=Readonly<{[rejectionBrand]:true}>
type Witness=NonNullable<ReturnType<typeof receivedOriginalRulePackWitness>>
const contextKeys=['version','contextOrigin','sourceMessageId','companyId','environment','messageCode','payloadHash','sourceReceivedAt','capturedAt']
const reads=new WeakMap<ReceivedZ04HRequiredFieldRejection,{identity:string;actor:string;readAt:number;witness:Witness}>()
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
export async function loadReceivedZ04HRequiredFieldRejection(source:EdielMessageRow,actor:string):Promise<ReceivedZ04HRequiredFieldRejection|null> {
 const started=Date.now()
 const companyId=source.company_id
 const actorSource:Pick<EdielMessageRow,'company_id'>={company_id:companyId}
 // Freeze only the READ principal before awaiting the actor. Unavailable birth
 // fields refuse after actual actor denial/quarantine; unused getters stay unread.
 let principal:{sourceId:EdielMessageRow['id'];environment:EdielMessageRow['environment'];identity:string|null}|null=null
 try{principal={sourceId:source.id,environment:source.environment,identity:bornIdentity(source)}}
 catch{/* Refuse the unavailable birth after the actor check. */}
 if(!await assertReceivedZ04RequiredStartActor(actorSource,actor))return null
 try{
  if(!principal?.identity||!isEvidenceUuid(companyId))return null
  const {sourceId,environment,identity}=principal
  const stored=await supabaseService.from('ediel_messages').select('*').eq('id',sourceId).eq('company_id',companyId).single()
  if(stored.error||bornIdentity(stored.data)!==identity)return null
  const original=stored.data as EdielMessageRow,witness=bornWitness(original)
  if(!witness)return null
  const wire=tokenizeEdifact(original.raw_payload!),unb=wire.segments.filter(row=>row.tag==='UNB'),unh=wire.segments.filter(row=>row.tag==='UNH')
  const groups=prodatRegisterGroups(wire.segments,wire.una,'Z04').groups,first=groups.filter(group=>group.registerPosition===1)
  if(!validateEdifactSyntax({...original,status:'received',syntax_check_status:'not_checked',validation_report:{},failure_reason:null}).ok
   ||!first.length||groups.some(group=>group.messageIndex!==0||!group.validRegisterChain)
   ||!observeReceivedZ04HRequiredFields({rawSegments:wire.segments.map(row=>row.raw),una:wire.una}).length)return null
  const legal=await requireEdielInboundLegalContext(companyId,sourceId)
  const basis=legal as unknown as Record<string,unknown>,projection=basis.canonicalProjection
  const receivers=wire.segments.filter(row=>row.tag==='NAD'&&segmentComposite(row,1,wire.una)[0]==='DO')
  const received=parseSourceReceiptInstant(original.message_received_at)
  if(Date.now()-started>2000||Date.now()<started||unb.length!==1||unh.length!==1||receivers.length!==1
   ||legal.basisKind!=='observed_source_persistence'||legal.direction!=='inbound'||legal.environment!==environment
   ||basis.family!=='PRODAT'||basis.code!=='Z04'||basis.subtype!=='H'||!isEvidenceUuid(legal.legalActorId)||!isEvidenceUuid(legal.transportActorId)
   ||legal.actorRole!=='electricity_supplier'||legal.legalEdielId!==segmentComposite(receivers[0],2,wire.una)[0]
   ||legal.transportEdielId!==segmentComposite(unb[0],3,wire.una)[0]
   ||legal.applicationReference!==segmentComposite(unb[0],7,wire.una)[0]
   ||environment!==(segmentComposite(unb[0],11,wire.una)[0]==='1'?'test':'production')
   ||typeof basis.sourceEdition!=='string'||!/^[a-f0-9]{64}$/.test(basis.sourceEdition)
   ||received===null||parseSourceReceiptInstant(legal.sourceReceivedAt)!==received||parseSourceReceiptInstant(legal.observedAt)===null
   ||!isEvidenceRecord(projection)||projection.family!=='PRODAT'||projection.code!=='Z04'||projection.subtype!=='H'
   ||projection.transactionReasonCode!=='Z25'||!['inbound','both'].includes(String(projection.direction))
   ||!Array.isArray(projection.receiverRoles)||!projection.receiverRoles.some(role=>['supplier','electricity_supplier'].includes(role))
   ||!Array.isArray(projection.applicationReferences)||!projection.applicationReferences.includes(legal.applicationReference))return null
  // Compare only the actual born H/Z25 grammar/guide witness. The existing
  // birth selector owns its Stockholm receipt-date lookup, not business ground.
  const {resolveBilateralSwitchBirthProfile}=await import('@/lib/inbound-mail/bilateralSwitchBirthProfile')
  const selected=await resolveBilateralSwitchBirthProfile({rawPayload:original.raw_payload,receivedAt:original.message_received_at!})
  if(!selected||!isDeepStrictEqual(selected,{canonical_rule_pack_id:original.canonical_rule_pack_id,
   rule_profile_key:original.rule_profile_key,rule_profile_version_id:original.rule_profile_version_id,
   rule_profile_version:original.rule_profile_version,rule_pack_checksum:original.rule_pack_checksum,rule_pack_snapshot:original.rule_pack_snapshot})
   ||Date.now()-started>2000||Date.now()<started)return null
  const token=Object.freeze({}) as ReceivedZ04HRequiredFieldRejection
  reads.set(token,{identity,actor,readAt:started,witness});return token
 }catch(error){
  if(error instanceof EdielExecutionFailure&&error.disposition.kind==='security_quarantine')throw error
  return null
 }
}
export function readReceivedZ04HRequiredFieldWitness(token:ReceivedZ04HRequiredFieldRejection,source:EdielMessageRow,actor:string):Witness|null {
 const read=reads.get(token)
 return read&&read.actor===actor&&read.identity===bornIdentity(source)&&Date.now()>=read.readAt&&Date.now()-read.readAt<=2000
  ?structuredClone(read.witness):null
}
/** Redeem once into only a rejected decision whose genuine register owner and
 * typed errors remain bound to the exact physical source. Copies grant nothing. */
export function ownReceivedZ04HRequiredFieldRejection(decision:CanonicalRuntimeDecision,source:EdielMessageRow,actor:string,
 token:ReceivedZ04HRequiredFieldRejection):boolean {
 const read=reads.get(token);reads.delete(token)
 const plans=decision.responsePlan.filter(plan=>plan.family==='APERAK')
 if(!read||read.actor!==actor||read.identity!==bornIdentity(source)||Date.now()-read.readAt>2000||Date.now()<read.readAt
  ||decision.policy!==null||decision.syntaxDecision!=='accepted'||decision.applicationDecision!=='rejected'||decision.functionalDecision!=='not_applicable'
  ||!bindReceivedRegisterValidation(decision.prodatRegisterValidation,source.raw_payload!)||plans.length!==1||plans[0].outcome!=='negative'
  ||!plans[0].applicationErrors?.length||!plans[0].applicationErrors.every(error=>isQualifiedProdatApplicationError(error)
   &&['210','260','226'].includes(error.fieldCode??'')&&error.ercCode==='41'&&error.prodatFieldDiagnostic?.kind==='field'&&error.prodatFieldDiagnostic.errorKind==='missing')
  ||!isDeepStrictEqual(receivedOriginalRulePackWitness(decision.validationReport.rulePackEvidence),read.witness))return false
 const wire=tokenizeEdifact(source.raw_payload!)
 if(!isDeepStrictEqual(plans[0].applicationErrors,projectProdatDiagnostics(observeReceivedZ04HRequiredFields({rawSegments:wire.segments.map(row=>row.raw),una:wire.una})).applicationErrors)
  ||!consumeReceivedZ04RequiredStartStructure(decision.prodatRegisterValidation,source.raw_payload!))return false
 owners.set(decision,{identity:read.identity,actor,decisionHash:evidenceHash(JSON.stringify(decision))});return true
}
/** Observation only; mutable/copy/status JSON never qualifies this route. */
export function hasReceivedZ04HRequiredFieldRejection(decision:object,source:unknown,actor?:string):boolean {
 const owner=owners.get(decision)
 return Boolean(owner&&(actor===undefined||owner.actor===actor)&&owner.identity===bornIdentity(source)&&owner.decisionHash===evidenceHash(JSON.stringify(decision)))
}

/** Exact physical required common fields only. This pure observation never
 * grants an operational H policy, source-function acceptance or response owner. */
export function observeReceivedZ04HRequiredFields(input:{rawSegments:readonly string[];una?:EdifactServiceStringAdvice}):EdielRulebookIssue[] {
 const una=input.una??DEFAULT_UNA,{groups,tokens,problems}=prodatRegisterGroups(input.rawSegments,una,'Z04')
 const first=groups.filter(group=>group.registerPosition===1)
 const bgm=tokens.filter(row=>row.tag==='BGM'),unh=tokens.filter(row=>row.tag==='UNH')
 if(problems.length||!first.length||groups.some(group=>group.messageIndex!==0||!group.validRegisterChain)
  ||first.some(group=>prodatRegisterReadingSubtype('Z04',group.segments,una)!=='H')
  ||first.some(group=>{const identity=prodatRegisterFieldState('209',group.segments,una);return !identity?.present||identity.malformed||!['9','89'].includes(group.identityAgency??'')})
  ||bgm.length!==1||unh.length!==1||segmentComposite(bgm[0],1,una).join(':')!=='Z04')return []
 const fields=['210','260','226'],rules=canonicalProdat26AFieldRules('Z04').filter(rule=>fields.includes(rule.fieldNumber??''))
 if(rules.length!==fields.length||rules.some(rule=>rule.requirement!=='required'))return []
 return validateFieldMatrixPayload({family:'PRODAT',code:'Z04',direction:'inbound',mode:'parse',rawSegments:input.rawSegments,una},rules)
  .filter(issue=>issue.prodatDiagnostic?.kind==='field'&&fields.includes(issue.prodatDiagnostic.fieldNumber)
   &&issue.prodatDiagnostic.errorKind==='missing')
}
