import {createHash} from 'node:crypto'
import {readExistingAckBeforeDraft} from '@/lib/ediel/core/ackDraftSource'
import {readPersistedEdielTechnicalContrlBasis,technicalSyntaxAckQualification} from './technicalSyntaxAuthority'
import {prepareSourceAckDraft,isProtectedProdatDocumentReferenceHold} from './prepareSourceAckDraft'
import {readInboundReceptionRequest,type InboundReception} from '@/lib/ediel/inbound/receptions'
import {requireEdielInboundLegalContext} from '@/lib/ediel/tenant/sourceLegalContext'
import {inboundLegalReceiverEdielId,resolveInboundTenantFromIdentifiers} from '@/lib/ediel/tenant/resolveInboundTenant'
import {parseCanonicalEdielPayload} from '@/lib/ediel/core/canonicalMessage'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {validateEdifactSyntax} from '@/lib/ediel/core/syntaxValidator'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {prodatDocumentState} from '@/lib/ediel/prodat/prodatDocumentFields'
import {isQualifiedProdatApplicationError} from '@/lib/ediel/prodat/prodatDiagnosticProjection'
import type {EdielMessageRow} from '@/lib/ediel/types'

/** A retained physical correlation hold permits only a read-only return. It
 * grants no fresh reply, validation-owner seed, tenant patch or business effect. */
export async function readRetainedProdatDocumentHold(input:{
 actorUserId:string;sourceMessage:EdielMessageRow;syntax:ReturnType<typeof validateEdifactSyntax>
}):Promise<boolean>{
 const source=input.sourceMessage,companyId=source.company_id,raw=source.raw_payload
 if(source.direction!=='inbound'||source.message_standard!=='edifact'||source.message_family!=='PRODAT'
  ||source.message_code!=='Z04'||!companyId||!raw||!source.inbound_email_message_id
  ||input.syntax.grammarQualification!=='qualified'||!input.syntax.ok)return false
 const wire=tokenizeEdifact(raw),unh=wire.segments.filter(row=>row.tag==='UNH')
 const document=prodatDocumentState('203',wire.segments,wire.una)
 if(unh.length!==1||segmentComposite(unh[0],2,wire.una)[0]!=='PRODAT'
  ||wire.segments.filter(row=>row.tag==='BGM').length!==1||document.present||document.malformed)return false
 const hash=createHash('sha256').update(raw,'utf8').digest('hex')
 // The old syntax reply must already exist before this invocation. A reply
 // created during first processing cannot select this branch.
 const contrl=await readExistingAckBeforeDraft({actorUserId:input.actorUserId,sourceMessage:source,
  ackFamily:'CONTRL',outcome:'positive',ackScope:'interchange'})
 if(!contrl)return false
 if(!contrl.raw_payload)throw new Error('ediel_retained_document_hold_technical_basis_required')
 const retained=await readPersistedEdielTechnicalContrlBasis({companyId,environment:source.environment,
  ackMessageId:contrl.id,expectedRawPayload:contrl.raw_payload,actorUserId:input.actorUserId,phase:'prepare'})
 const syntax=technicalSyntaxAckQualification({evidence:retained.evidence,companyId,
  environment:source.environment,sourceMessageId:source.id})
 if(!syntax||syntax.syntaxDecision!=='accepted'||syntax.sourceHash!==hash)
  throw new Error('ediel_retained_document_hold_technical_basis_required')
 const reception=await readInboundReceptionRequest({companyId,messageId:source.id,
  inboundEmailMessageId:source.inbound_email_message_id,actorUserId:input.actorUserId})
 // These extra values are emitted by the existing protected SQL READ from its
 // private first assessment; recordInboundReception never supplies them.
 const first=reception as (InboundReception&{firstOutcomeAvailable?:unknown;firstValidationAssessmentId?:unknown})|null
 if(!first||first.classification!=='first_reception'||first.status!=='observed'
  ||first.firstOutcomeAvailable!==true||typeof first.firstValidationAssessmentId!=='string'
  ||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(first.firstValidationAssessmentId))return false
 if(first.canonicalPayloadHash!==hash||first.receivedPayloadHash!==hash
  ||Date.parse(first.receivedAt)!==Date.parse(source.message_received_at??''))
  throw new Error('ediel_retained_document_hold_source_changed')
 const legal=await requireEdielInboundLegalContext(companyId,source.id)
 if(legal.direction!=='inbound'||legal.environment!==source.environment
  ||Date.parse(legal.sourceReceivedAt??'')!==Date.parse(source.message_received_at??''))
  throw new Error('ediel_retained_document_hold_legal_basis_required')
 const canonical=parseCanonicalEdielPayload({rawPayload:raw,direction:source.direction,standardHint:source.message_standard})
 const tenant=await resolveInboundTenantFromIdentifiers({existingCompanyId:companyId,mailbox:source.mailbox,
  communicationRouteId:source.communication_route_id,environment:source.environment,
  senderEdielId:canonical.sender,senderSubaddress:canonical.senderSubAddress,
  receiverEdielId:canonical.receiver,receiverSubaddress:canonical.receiverSubAddress,
  marketActorEdielId:inboundLegalReceiverEdielId(raw,canonical.receiver),
  applicationReference:canonical.applicationReference,messageFamily:canonical.messageFamilyForStorage,messageCode:canonical.messageCode})
 if(tenant.status!=='resolved'||tenant.companyId!==companyId)
  throw new Error('ediel_retained_document_hold_current_tenant_required')
 // Retained whole/object originals and their current actor/source refusals
 // keep priority over any fresh guide/field qualification.
 let freshGuard:Error|undefined
 try{
  const prepared=await prepareSourceAckDraft({actorUserId:input.actorUserId,sourceMessage:source,
   ackFamily:'APERAK',outcome:'negative',onDocumentReferenceHold:hold=>{freshGuard=hold;}})
  if(prepared.kind==='existing')return false
  throw new Error('ediel_retained_document_hold_unexpected_draft')
 }catch(error){
  // The exact error must be born in this source/actor invocation after both
  // protected replay reads. Even a borrowed prior branded error is refused.
  if(error!==freshGuard||!isProtectedProdatDocumentReferenceHold(error))throw error
 }
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(source,{actorUserId:input.actorUserId})
 if(decision.syntaxDecision!=='accepted'||decision.applicationDecision!=='rejected'
  ||!decision.issues.some(issue=>issue.prodatDiagnostic?.kind==='field'
   &&issue.prodatDiagnostic.fieldNumber==='203'&&issue.prodatDiagnostic.errorKind==='missing'))return false
 const plans=decision.responsePlan.filter(plan=>plan.family==='APERAK'&&plan.outcome==='negative')
 return plans.length===1&&Boolean(plans[0].applicationErrors?.some(error=>
  error.fieldCode==='203'&&error.ercCode==='41'&&isQualifiedProdatApplicationError(error)
  &&error.prodatFieldDiagnostic?.kind==='field'&&error.prodatFieldDiagnostic.fieldNumber==='203'
  &&error.prodatFieldDiagnostic.errorKind==='missing'&&error.prodatOccurrence?.scope==='header'))
}
