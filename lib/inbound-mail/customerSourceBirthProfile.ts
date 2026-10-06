import {parseCanonicalEdielPayload} from '@/lib/ediel/core/canonicalMessage'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {stockholmBusinessDate} from '@/lib/ediel/core/executionContext'
import {prodatCharacteristicValues} from '@/lib/ediel/prodat/prodatCharacteristicFields'
import {prodatRegisterRuleScopes} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {evaluateProdatTransactionReason} from '@/lib/ediel/prodat/prodatTransactionReason'
import {resolveCanonicalRulePack} from '@/lib/ediel/rulebook/canonicalRulePackRegistry'

/** Prospective catalog evidence only, before native original custody. No
 * customer classification, bilateral admission or accepted assessment is
 * supplied here; those remain the authoritative consumers' responsibility.
 */
export async function resolveCustomerSourceBirthProfile(input:{rawPayload:string|null|undefined;receivedAt:string}){
 const canonical=parseCanonicalEdielPayload({rawPayload:input.rawPayload,direction:'inbound',standardHint:'edifact'})
 if(canonical.family!=='PRODAT'||canonical.messageCode!=='Z06'||!canonical.applicationReference)return null
 const {segments,una}=tokenizeEdifact(input.rawPayload)
 const scopes=prodatRegisterRuleScopes('223',segments,una,'Z06')??[]
 const reasons=prodatCharacteristicValues('223',segments,una)
 if(!scopes.length||reasons.length!==scopes.length||reasons.some(reason=>reason!=='E34'))return null
 if(!scopes.every(scope=>scope.some(token=>token.tag==='LIN')&&prodatCharacteristicValues('223',scope,una).length===1&&prodatCharacteristicValues('223',scope,una)[0]==='E34'))return null
 if(evaluateProdatTransactionReason({rawSegments:canonical.rawSegments,una,code:'Z06'}).issues.length)return null
 const received=new Date(input.receivedAt)
 if(!Number.isFinite(received.getTime()))throw new Error('customer_source_birth_receipt_clock_invalid')
 const evidence=await resolveCanonicalRulePack({family:'PRODAT',messageCode:'Z06',transactionSubtype:'E34',applicationReference:canonical.applicationReference,direction:'inbound',businessDate:stockholmBusinessDate(received)})
 if(canonical.version!==evidence.unhAssociationCode)throw new Error('customer_source_birth_association_mismatch')
 if(!evidence.databaseProfileKey)throw new Error('customer_source_birth_database_profile_key_missing')
 return {
  canonical_rule_pack_id:evidence.rulePackId,rule_profile_key:evidence.databaseProfileKey,
  rule_profile_version_id:evidence.messageProfileId,rule_profile_version:evidence.originalVersion,
  rule_pack_checksum:evidence.sourceHash,
  rule_pack_snapshot:{...evidence.originalSnapshot,profileKey:evidence.databaseProfileKey,profileVersionId:evidence.messageProfileId,version:evidence.originalVersion,checksum:evidence.sourceHash},
 }
}
