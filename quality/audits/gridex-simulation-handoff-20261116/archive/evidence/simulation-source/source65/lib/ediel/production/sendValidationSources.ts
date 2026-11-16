import type {EdielMessageRow} from '@/lib/ediel/types'
import {validateEdifactSyntax} from '@/lib/ediel/core/syntaxValidator'
import {wireFormatIdentityIssue} from '@/lib/ediel/core/messageWireFormat'
import {loadCustomerLifeEventValidationContext} from './lifeEventSource'
import {loadCustomerMasterdataValidationContext} from './customerMasterdataSource'
import {readPersistedOutboundAckRulePackEvidence} from '@/lib/ediel/core/ackSourceRulePackEvidence'
import {readPersistedProdatCommonHeaderNegativeAckBasis} from '@/lib/ediel/ack/prodatCommonHeaderRejectionAuthority'

/** Fresh send consumers use the same immutable source read ports. Call only
 * after the private accepted-transport replay branch; this adapter selects no
 * rule/profile and never grants authority from execution-snapshot hints. */
export async function readFreshEdielSendValidationSources(message:EdielMessageRow,actorUserId:string){
 const formatIssue=wireFormatIdentityIssue({rawPayload:message.raw_payload,messageStandard:message.message_standard,mimeType:message.mime_type})
 if(formatIssue)throw new Error(`${formatIssue.code}: ${formatIssue.description}`)
 if(message.message_standard==='edifact'){
  const syntax=validateEdifactSyntax({...message,status:'received',syntax_check_status:'not_checked',validation_report:{},failure_reason:null})
  if(!syntax.ok)throw new Error(`ediel_send_syntax_rejected:${syntax.issues.filter(i=>i.severity==='error').map(i=>i.code).join(',')}`)
 }
 const deathStatusContext=await loadCustomerLifeEventValidationContext(message,actorUserId)
 const customerMasterdataContext=await loadCustomerMasterdataValidationContext(message,actorUserId)
 const snapshot=message.execution_context_snapshot
 const commonHeaderHint=message.message_family==='APERAK'&&snapshot&&typeof snapshot==='object'&&!Array.isArray(snapshot)
  ? Reflect.get(snapshot,'prodatCommonHeaderNegativeWitnessId') : null
 if(commonHeaderHint){
  if(!message.company_id||!message.raw_payload)throw new Error('ediel_common_header_negative_witness_required')
  const {evidence:prodatCommonHeaderRejectionEvidence}=await readPersistedProdatCommonHeaderNegativeAckBasis({companyId:message.company_id,
   environment:message.environment,ackMessageId:message.id,expectedRawPayload:message.raw_payload})
  return {deathStatusContext,customerMasterdataContext,prodatCommonHeaderRejectionEvidence,ackSourceQualification:undefined}
 }
 const ackSourceQualification=['APERAK','UTILTS_ERR'].includes(message.message_family)
  ? await readPersistedOutboundAckRulePackEvidence(message) : undefined
 return {deathStatusContext,customerMasterdataContext,ackSourceQualification,prodatCommonHeaderRejectionEvidence:undefined}
}
