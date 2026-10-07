import { parseCanonicalEdielPayload } from '@/lib/ediel/core/canonicalMessage'
import { tokenizeEdifact, segmentComposite } from '@/lib/ediel/core/edifactTokenizer'
import { stockholmBusinessDate } from '@/lib/ediel/core/executionContext'
import { prodatCharacteristicValues } from '@/lib/ediel/prodat/prodatCharacteristicFields'
import { prodatRegisterGroups, prodatRegisterRuleScopes } from '@/lib/ediel/prodat/prodatRegisterGroups'
import { evaluateProdatTransactionReason } from '@/lib/ediel/prodat/prodatTransactionReason'
import { resolveCanonicalRulePack } from '@/lib/ediel/rulebook/canonicalRulePackRegistry'

/** Prospective Z02 catalog binding only. Original custody, admission, legal
 * ground, validation and effects remain with the authoritative consumers.
 * Every physical object supplies its own homogeneous Z22 or Z23 reason.
 */
export async function resolveInformationReplyBirthProfile(input: { rawPayload: string | null | undefined; receivedAt: string }) {
  const canonical = parseCanonicalEdielPayload({ rawPayload: input.rawPayload, direction: 'inbound', standardHint: 'edifact' })
  if (canonical.family !== 'PRODAT' || canonical.messageCode !== 'Z02' || !canonical.applicationReference) return null
  const { segments, una } = tokenizeEdifact(input.rawPayload)
  // Unlike Z04, Z02 has no repeated-register permission. The existing field258
  // grouping authority rejects explicit C829 and repeated own object identity.
  if (prodatRegisterGroups(segments, una, 'Z02').problems.some(problem => problem.fieldNumber === '258')) return null
  const scopes = prodatRegisterRuleScopes('223', segments, una, 'Z02') ?? []
  // Count all physical qualifiers, including empty or missing CAV values and
  // header/later occurrences excluded from normative own-object scopes.
  const qualifiers = segments.filter(token => token.tag === 'CCI'
    && (segmentComposite(token, 2, una)[0] ?? '').trim().toUpperCase() === 'Z13')
  if (qualifiers.length !== scopes.length) return null
  const reasons = prodatCharacteristicValues('223', segments, una)
  const reason = reasons[0]
  if (reason !== 'Z22' && reason !== 'Z23') return null
  if (reasons.length !== scopes.length || reasons.some(value => value !== reason)) return null
  if (!scopes.length || !scopes.every(scope => scope.some(token => token.tag === 'LIN')
    && prodatCharacteristicValues('223', scope, una).length === 1
    && prodatCharacteristicValues('223', scope, una)[0] === reason)) return null
  if (evaluateProdatTransactionReason({ rawSegments: canonical.rawSegments, una, code: 'Z02' }).issues.length) return null
  const received = new Date(input.receivedAt)
  if (!Number.isFinite(received.getTime())) throw new Error('information_reply_birth_receipt_clock_invalid')
  const evidence = await resolveCanonicalRulePack({ family: 'PRODAT', messageCode: 'Z02', transactionSubtype: reason,
    applicationReference: canonical.applicationReference, direction: 'inbound', businessDate: stockholmBusinessDate(received) })
  if (canonical.version !== evidence.unhAssociationCode) throw new Error('information_reply_birth_association_mismatch')
  if (!evidence.databaseProfileKey) throw new Error('information_reply_birth_database_profile_key_missing')
  return {
    canonical_rule_pack_id: evidence.rulePackId, rule_profile_key: evidence.databaseProfileKey,
    rule_profile_version_id: evidence.messageProfileId, rule_profile_version: evidence.originalVersion,
    rule_pack_checksum: evidence.sourceHash,
    rule_pack_snapshot: { ...evidence.originalSnapshot, profileKey: evidence.databaseProfileKey,
      profileVersionId: evidence.messageProfileId, version: evidence.originalVersion, checksum: evidence.sourceHash },
  }
}
