import {isDeepStrictEqual} from 'node:util'
import {supabaseService} from '@/lib/supabase/service'
import type {EdielMessageRow} from '@/lib/ediel/types'
import type {CanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
import {EdielExecutionFailure} from '@/lib/ediel/core/failureDisposition'
import {assertReceivedZ04RequiredStartActor} from '@/lib/ediel/prodat/receivedZ04RequiredStartRejection'
import {validateEdifactSyntax} from '@/lib/ediel/core/syntaxValidator'
import {requireEdielInboundLegalContext} from '@/lib/ediel/tenant/sourceLegalContext'
import {receivedOriginalRulePackWitness} from '@/lib/ediel/rulebook/canonicalRulePackRegistry'
import {evidenceHash,isEvidenceRecord,isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {parseSourceReceiptInstant} from '@/lib/ediel/utilts/receivedSourceInventory'
import {segmentComposite,segmentElementCount,segmentUntrimmedRaw,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {bindReceivedRegisterValidation} from '@/lib/ediel/core/receivedRegisterValidationBinding'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {prodatRegisterFieldState} from '@/lib/ediel/prodat/prodatRegisterFields'
import {canonicalProdat26AFieldRules} from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import {validateFieldMatrixPayload} from '@/lib/ediel/rulebook/fieldMatrix'
import type {EdielRulebookIssue} from '@/lib/ediel/rulebook/rulebook'
import {DEFAULT_UNA,type EdifactServiceStringAdvice} from '@/lib/ediel/core/una'
import {consumeReceivedZ04RequiredStartStructure} from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import {projectProdatDiagnostics} from '@/lib/ediel/prodat/prodatDiagnosticProjection'
import {isQualifiedProdatApplicationError} from '@/lib/ediel/prodat/prodatDiagnosticProjection'

declare const rejectionBrand:unique symbol
/** Not an operational policy or business/source capability. */
export type ReceivedZ04HStructuralFieldRejection=Readonly<{[rejectionBrand]:true}>
type Witness=NonNullable<ReturnType<typeof receivedOriginalRulePackWitness>>
const contextKeys=['version','contextOrigin','sourceMessageId','companyId','environment','messageCode','payloadHash','sourceReceivedAt','capturedAt']
const reads=new WeakMap<ReceivedZ04HStructuralFieldRejection,{identity:string;actor:string;readAt:number;witness:Witness}>()
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
export async function loadReceivedZ04HStructuralFieldRejection(source:EdielMessageRow,actor:string):Promise<ReceivedZ04HStructuralFieldRejection|null> {
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
  const groups=prodatRegisterGroups(wire.segments,wire.una,'Z04').groups
  if(!validateEdifactSyntax({...original,status:'received',syntax_check_status:'not_checked',validation_report:{},failure_reason:null}).ok
   ||groups.length!==1||groups[0].messageIndex!==0
   ||!observeReceivedZ04HStructuralFields({rawSegments:wire.segments.map(row=>row.raw),una:wire.una}).length)return null
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
  const {resolveRejectedZ04HRequiredFieldBirthProfile}=await import('@/lib/inbound-mail/rejectedZ04HRequiredFieldBirthProfile')
  const selected=await resolveRejectedZ04HRequiredFieldBirthProfile({rawPayload:original.raw_payload,receivedAt:original.message_received_at!})
  if(!selected||!isDeepStrictEqual(selected,{canonical_rule_pack_id:original.canonical_rule_pack_id,
   rule_profile_key:original.rule_profile_key,rule_profile_version_id:original.rule_profile_version_id,
   rule_profile_version:original.rule_profile_version,rule_pack_checksum:original.rule_pack_checksum,rule_pack_snapshot:original.rule_pack_snapshot})
   ||Date.now()-started>2000||Date.now()<started)return null
  const token=Object.freeze({}) as ReceivedZ04HStructuralFieldRejection
  reads.set(token,{identity,actor,readAt:started,witness});return token
 }catch(error){
  if(error instanceof EdielExecutionFailure&&error.disposition.kind==='security_quarantine')throw error
  return null
 }
}
export function readReceivedZ04HStructuralFieldWitness(token:ReceivedZ04HStructuralFieldRejection,source:EdielMessageRow,actor:string):Witness|null {
 const read=reads.get(token)
 return read&&read.actor===actor&&read.identity===bornIdentity(source)&&Date.now()>=read.readAt&&Date.now()-read.readAt<=2000
  ?structuredClone(read.witness):null
}
/** Redeem once into only a rejected structural decision whose genuine register owner and
 * typed errors remain bound to the exact physical source. Copies grant nothing. */
export function ownReceivedZ04HStructuralFieldRejection(decision:CanonicalRuntimeDecision,source:EdielMessageRow,actor:string,
 token:ReceivedZ04HStructuralFieldRejection):boolean {
 const read=reads.get(token);reads.delete(token)
 const plans=decision.responsePlan.filter(plan=>plan.family==='APERAK')
 if(!read||read.actor!==actor||read.identity!==bornIdentity(source)||Date.now()-read.readAt>2000||Date.now()<read.readAt
  ||decision.policy!==null||decision.syntaxDecision!=='accepted'||decision.applicationDecision!=='rejected'||decision.functionalDecision!=='not_applicable'
  ||!bindReceivedRegisterValidation(decision.prodatRegisterValidation,source.raw_payload!)||plans.length!==1||plans[0].outcome!=='negative'
  ||!plans[0].applicationErrors?.length||!plans[0].applicationErrors.every(error=>isQualifiedProdatApplicationError(error)
   &&error.prodatFieldDiagnostic?.kind==='field'&&(error.fieldCode==='314'&&error.ercCode==='41'&&error.prodatFieldDiagnostic.errorKind==='missing'
    ||error.fieldCode==='209'&&error.ercCode==='42'&&error.prodatFieldDiagnostic.errorKind==='invalid'))
  ||!isDeepStrictEqual(receivedOriginalRulePackWitness(decision.validationReport.rulePackEvidence),read.witness))return false
 const wire=tokenizeEdifact(source.raw_payload!)
 if(!isDeepStrictEqual(plans[0].applicationErrors,projectProdatDiagnostics(observeReceivedZ04HStructuralFields({rawSegments:wire.segments.map(row=>row.raw),una:wire.una})).applicationErrors)
  ||!consumeReceivedZ04RequiredStartStructure(decision.prodatRegisterValidation,source.raw_payload!))return false
 owners.set(decision,{identity:read.identity,actor,decisionHash:evidenceHash(JSON.stringify(decision))});return true
}
/** Observation only; mutable/copy/status JSON never qualifies this route. */
export function hasReceivedZ04HStructuralFieldRejection(decision:object,source:unknown,actor?:string):boolean {
 const owner=owners.get(decision)
 return Boolean(owner&&(actor===undefined||owner.actor===actor)&&owner.identity===bornIdentity(source)&&owner.decisionHash===evidenceHash(JSON.stringify(decision)))
}

/** Exact physical structural defects only. Other malformed sources cannot
 * claim an H selector or a privately owned negative response. */
export function observeReceivedZ04HStructuralFields(input:{rawSegments:readonly string[];una?:EdifactServiceStringAdvice}):EdielRulebookIssue[] {
 const una=input.una??DEFAULT_UNA,{groups,tokens,problems}=prodatRegisterGroups(input.rawSegments,una,'Z04')
 const bgm=tokens.filter(row=>row.tag==='BGM'),unh=tokens.filter(row=>row.tag==='UNH'),unb=tokens.filter(row=>row.tag==='UNB')
 if(groups.length!==1||bgm.length!==1||unh.length!==1||unb.length!==1
  ||segmentComposite(bgm[0],1,una).join(':')!=='Z04'||segmentComposite(unh[0],2,una).join(':')!=='PRODAT:D:97A:UN:E2SE6A'
  ||segmentComposite(unb[0],7,una).join(':')!=='23-DDQ-PRODAT')return []
 const group=groups[0],lin=group.segments[0],item=segmentComposite(lin,3,una),number=segmentComposite(lin,1,una)
 const identity=prodatRegisterFieldState('209',group.segments,una),sequence=prodatRegisterFieldState('314',group.segments,una)
 if(group.messageIndex!==0||bgm[0].index>=lin.index||segmentElementCount(lin,una)!==3||item.length!==4
  ||item[1]!==''||item[2]!==''||!['9','89'].includes(item[3])||number.length!==1)return []
 const missing314=number[0]===''&&sequence?.present===false&&!sequence.malformed
  &&identity?.present===true&&!identity.malformed&&item[0]===identity.value
  &&problems.length===1&&problems[0].fieldNumber==='314'&&problems[0].lineIndex===group.lineIndex
  &&problems[0].reason==='global_sequence_must_increment_from_one'
 const invalid209=number[0]==='1'&&sequence?.value==='1'&&!sequence.malformed&&item[0]===''
  &&identity?.value===null&&identity.malformed&&group.validRegisterChain&&problems.length===0
 if(!missing314&&!invalid209)return []
 const qualifiers=tokens.filter(row=>row.tag==='CCI'&&(segmentComposite(row,2,una)[0]??'').trim().toUpperCase()==='Z13')
 if(qualifiers.length!==1)return []
 const cci=qualifiers[0],index=group.segments.indexOf(cci),cav=group.segments[index+1],parent=group.segments.findIndex(row=>row.tag==='RFF'||row.tag==='NAD')
 if(index<0||parent>=0&&index>=parent||segmentUntrimmedRaw(cci)!==`CCI${una.dataElementSeparator}${una.dataElementSeparator}Z13`
  ||!cav||cav.tag!=='CAV'||group.segments[index+2]?.tag==='CAV')return []
 const reason=segmentComposite(cav,1,una)
 if(segmentElementCount(cav,una)!==1||reason.length>5||reason[0]!=='Z25'||reason.slice(1).some(v=>v!=='')
  ||segmentUntrimmedRaw(cav)!==`CAV${una.dataElementSeparator}Z25${una.componentDataElementSeparator.repeat(reason.length-1)}`)return []
 const field=missing314?'314':'209',rules=canonicalProdat26AFieldRules('Z04').filter(rule=>rule.fieldNumber===field)
 if(rules.length!==1||rules[0].requirement!=='required')return []
 return validateFieldMatrixPayload({family:'PRODAT',code:'Z04',direction:'inbound',mode:'parse',rawSegments:input.rawSegments,una},rules)
  .filter(issue=>issue.prodatDiagnostic?.kind==='field'&&issue.prodatDiagnostic.fieldNumber===field
   &&issue.prodatDiagnostic.errorKind===(missing314?'missing':'invalid'))
}
