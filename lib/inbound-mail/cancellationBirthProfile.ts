import { parseCanonicalEdielPayload } from '@/lib/ediel/core/canonicalMessage'
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { stockholmBusinessDate } from '@/lib/ediel/core/executionContext'
import { prodatCharacteristicValues } from '@/lib/ediel/prodat/prodatCharacteristicFields'
import { prodatRegisterFieldState } from '@/lib/ediel/prodat/prodatRegisterFields'
import { prodatRegisterGroups, prodatRegisterRuleScopes } from '@/lib/ediel/prodat/prodatRegisterGroups'
import { evaluateProdatTransactionReason } from '@/lib/ediel/prodat/prodatTransactionReason'
import { resolveCanonicalRulePack } from '@/lib/ediel/rulebook/canonicalRulePackRegistry'

/** Physical catalog evidence at public source birth only. Cancellation/original
 * custody, admission and business effects remain with their existing owners. */
export async function resolveCancellationBirthProfile(input: {
  rawPayload: string | null | undefined; receivedAt: string; messageCode: string
}) {
  const canonical = parseCanonicalEdielPayload({ rawPayload: input.rawPayload, direction: 'inbound', standardHint: 'edifact' })
  if (!['Z04', 'Z05'].includes(input.messageCode) || canonical.messageCode !== input.messageCode ||
    canonical.family !== 'PRODAT' || canonical.applicationReference !== '23-DDQ-PRODAT' || canonical.version !== 'E2SE6A') return null
  const { segments, una } = tokenizeEdifact(input.rawPayload)
  const positions = ['UNB', 'UNH', 'BGM', 'UNT', 'UNZ'].map(tag => {
    const own = segments.filter(token => token.tag === tag)
    return own.length === 1 ? segments.indexOf(own[0]) : -1
  })
  if (positions.some((position, index) => position < 0 || index > 0 && position <= positions[index - 1])) return null
  const messageType = segmentComposite(segments[positions[1]], 2, una)
  if (messageType.length !== 5 || messageType.some((part, index) => part !== ['PRODAT', 'D', '97A', 'UN', 'E2SE6A'][index])) return null
  if (segments.some((token, index) => token.tag === 'LIN' && (index <= positions[2] || index >= positions[3]))) return null
  const grouped = prodatRegisterGroups(segments, una, input.messageCode)
  if (!grouped.groups.length || grouped.problems.length || !grouped.groups.every(group => {
    const identity = prodatRegisterFieldState('209', group.segments, una)
    return identity?.present && !identity.malformed
  })) return null
  const scopes = prodatRegisterRuleScopes('223', segments, una, input.messageCode) ?? []
  const qualifiers = segments.filter(token => token.tag === 'CCI' && (segmentComposite(token, 2, una)[0] ?? '').trim().toUpperCase() === 'Z13')
  const reasons = prodatCharacteristicValues('223', segments, una)
  if (qualifiers.length !== scopes.length || reasons.length !== scopes.length || reasons.some(reason => reason !== 'Z24')) return null
  if (!scopes.every(scope => {
    const own = prodatCharacteristicValues('223', scope, una)
    return own.length === 1 && own[0] === 'Z24'
  })) return null
  if (evaluateProdatTransactionReason({ rawSegments: canonical.rawSegments, una, code: input.messageCode }).issues.length) return null
  const received = new Date(input.receivedAt)
  if (!Number.isFinite(received.getTime())) throw new Error('cancellation_birth_receipt_clock_invalid')
  const evidence = await resolveCanonicalRulePack({ family: 'PRODAT', messageCode: input.messageCode, transactionSubtype: 'Z24',
    applicationReference: canonical.applicationReference, direction: 'inbound', businessDate: stockholmBusinessDate(received) })
  if (canonical.version !== evidence.unhAssociationCode) throw new Error('cancellation_birth_association_mismatch')
  if (!evidence.databaseProfileKey) throw new Error('cancellation_birth_database_profile_key_missing')
  return {
    canonical_rule_pack_id: evidence.rulePackId, rule_profile_key: evidence.databaseProfileKey,
    rule_profile_version_id: evidence.messageProfileId, rule_profile_version: evidence.originalVersion,
    rule_pack_checksum: evidence.sourceHash,
    rule_pack_snapshot: { ...evidence.originalSnapshot, profileKey: evidence.databaseProfileKey,
      profileVersionId: evidence.messageProfileId, version: evidence.originalVersion, checksum: evidence.sourceHash },
  }
}
