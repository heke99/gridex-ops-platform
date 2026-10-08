import { parseCanonicalEdielPayload } from '@/lib/ediel/core/canonicalMessage'
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { stockholmBusinessDate } from '@/lib/ediel/core/executionContext'
import { prodatCharacteristicValues } from '@/lib/ediel/prodat/prodatCharacteristicFields'
import { prodatRegisterFieldState } from '@/lib/ediel/prodat/prodatRegisterFields'
import { prodatRegisterGroups, prodatRegisterRuleScopes } from '@/lib/ediel/prodat/prodatRegisterGroups'
import { evaluateProdatTransactionReason } from '@/lib/ediel/prodat/prodatTransactionReason'
import { resolveCanonicalRulePack } from '@/lib/ediel/rulebook/canonicalRulePackRegistry'
import { isProdatRejectedIdentityScope } from '@/lib/ediel/prodat/prodatRejectedIdentityScope'

/** Catalog evidence only: original custody, bilateral/legal admission and
 * business effects remain with the existing reception and SQL consumers.
 * Every physical object supplies its own reason; another object, header or
 * unsupported register cannot provide a default profile.
 */
export async function resolveSupplyEndBirthProfile(input: {
  rawPayload: string | null | undefined; receivedAt: string; purpose?: 'rejected_identity'
}) {
  const canonical = parseCanonicalEdielPayload({ rawPayload: input.rawPayload, direction: 'inbound', standardHint: 'edifact' })
  if (canonical.family !== 'PRODAT' || canonical.messageCode !== 'Z05' || canonical.applicationReference !== '23-DDQ-PRODAT') return null
  const { segments, una } = tokenizeEdifact(input.rawPayload)
  const grouped = prodatRegisterGroups(segments, una, 'Z05')
  if (!grouped.groups.length || grouped.problems.length) return null
  const scopes = prodatRegisterRuleScopes('223', segments, una, 'Z05') ?? []
  const qualifiers = segments.filter(token => token.tag === 'CCI' && (segmentComposite(token, 2, una)[0] ?? '').trim().toUpperCase() === 'Z13')
  if (qualifiers.length !== scopes.length) return null
  const reasons = prodatCharacteristicValues('223', segments, una)
  const reason = reasons[0]
  if (reason !== 'Z25' && reason !== 'Z22') return null
  if (reasons.length !== scopes.length || reasons.some(value => value !== reason)) return null
  // This separate catalog purpose retains a malformed H original for later
  // canonical rejection. It never supplies an identity or operational H cap.
  const rejectedIdentity = input.purpose === 'rejected_identity'
  if (rejectedIdentity && (reason !== 'Z25' || !grouped.groups.some(group => group.itemId === null))) return null
  if (!scopes.every(scope => {
    const identity = prodatRegisterFieldState('209', scope, una)
    const ownReasons = prodatCharacteristicValues('223', scope, una)
    const group = rejectedIdentity ? grouped.groups.find(own => own.segments[0].index === scope[0]?.index) : undefined
    const qualifiedIdentity = identity?.present && !identity.malformed || group && isProdatRejectedIdentityScope({
      code: 'Z05', group, rawSegments: segments.map(token => token.raw), una,
    })
    return qualifiedIdentity && ownReasons.length === 1 && ownReasons[0] === reason
  })) return null
  if (evaluateProdatTransactionReason({ rawSegments: canonical.rawSegments, una, code: 'Z05' }).issues.length) return null
  const received = new Date(input.receivedAt)
  if (!Number.isFinite(received.getTime())) throw new Error('supply_end_birth_receipt_clock_invalid')
  const evidence = await resolveCanonicalRulePack({ family: 'PRODAT', messageCode: 'Z05', transactionSubtype: reason,
    applicationReference: canonical.applicationReference, direction: 'inbound', businessDate: stockholmBusinessDate(received) })
  if (canonical.version !== evidence.unhAssociationCode) throw new Error('supply_end_birth_association_mismatch')
  if (!evidence.databaseProfileKey) throw new Error('supply_end_birth_database_profile_key_missing')
  return {
    canonical_rule_pack_id: evidence.rulePackId, rule_profile_key: evidence.databaseProfileKey,
    rule_profile_version_id: evidence.messageProfileId, rule_profile_version: evidence.originalVersion,
    rule_pack_checksum: evidence.sourceHash,
    rule_pack_snapshot: { ...evidence.originalSnapshot, profileKey: evidence.databaseProfileKey,
      profileVersionId: evidence.messageProfileId, version: evidence.originalVersion, checksum: evidence.sourceHash },
  }
}
