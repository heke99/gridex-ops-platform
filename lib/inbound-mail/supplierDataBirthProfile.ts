import type { CanonicalRulePackResolution, OriginalRulePackWitness } from '@/lib/ediel/rulebook/canonicalRulePackRegistry'
import { resolveCanonicalRulePack } from '@/lib/ediel/rulebook/canonicalRulePackRegistry'
import { parseCanonicalEdielPayload } from '@/lib/ediel/core/canonicalMessage'
import { tokenizeEdifact, segmentComposite } from '@/lib/ediel/core/edifactTokenizer'
import { stockholmBusinessDate } from '@/lib/ediel/core/executionContext'
import { prodatCharacteristicValues } from '@/lib/ediel/prodat/prodatCharacteristicFields'
import { prodatRegisterGroups } from '@/lib/ediel/prodat/prodatRegisterGroups'
import { prodatRegisterFieldState } from '@/lib/ediel/prodat/prodatRegisterFields'
import { evaluateProdatTransactionReason } from '@/lib/ediel/prodat/prodatTransactionReason'

export type SupplierDataBirthProfileInput = Readonly<{
  rawPayload: string | null | undefined
  receivedAt: string
}>

export type SupplierDataBirthProfile = Readonly<{
  canonical_rule_pack_id: CanonicalRulePackResolution['rulePackId']
  rule_profile_key: string
  rule_profile_version_id: CanonicalRulePackResolution['messageProfileId']
  rule_profile_version: CanonicalRulePackResolution['originalVersion']
  rule_pack_checksum: CanonicalRulePackResolution['sourceHash']
  rule_pack_snapshot: OriginalRulePackWitness & Readonly<{
    profileKey: string
    profileVersionId: string
    version: string
    checksum: string
  }>
}>

/** Prospective catalog binding for one physical supplier-data reply. This
 * selects no original, legal admission, validation authority or business effect.
 * Each distinct Z02 object supplies its own homogeneous Z22/Z23 reason; Z02
 * has no repeated-register inheritance. The caller retains the actual mail clock.
 */
export async function resolveSupplierDataBirthProfile(input: SupplierDataBirthProfileInput): Promise<SupplierDataBirthProfile | null> {
  const canonical = parseCanonicalEdielPayload({ rawPayload: input.rawPayload, direction: 'inbound', standardHint: 'edifact' })
  if (canonical.family !== 'PRODAT' || canonical.messageCode !== 'Z02'
    || canonical.applicationReference !== '23-DDQ-PRODAT') return null
  const { segments, una } = tokenizeEdifact(input.rawPayload)
  if (['UNB', 'UNH', 'BGM', 'UNT', 'UNZ'].some(tag => segments.filter(token => token.tag === tag).length !== 1)) return null
  const unh = segments.find(token => token.tag === 'UNH')!
  if (segmentComposite(unh, 2, una)[0] !== 'PRODAT') return null
  const { groups, problems } = prodatRegisterGroups(segments, una, 'Z02')
  if (!groups.length || problems.length || groups.some(group => {
    const identity = prodatRegisterFieldState('209', group.segments, una)
    return !group.validRegisterChain || !identity?.present || identity.malformed
  })) return null
  // Count all physical reason qualifiers, including ones outside their own LIN.
  // Empty, misplaced or later qualifiers cannot borrow another object's value.
  const qualifiers = segments.filter(token => token.tag === 'CCI'
    && segmentComposite(token, 2, una)[0]?.trim().toUpperCase() === 'Z13')
  const reasons = prodatCharacteristicValues('223', segments, una)
  const reason = reasons[0]
  if (reason !== 'Z22' && reason !== 'Z23') return null
  if (qualifiers.length !== groups.length || reasons.length !== groups.length
    || reasons.some(value => value !== reason)
    || groups.some(group => {
      const own = prodatCharacteristicValues('223', group.segments, una)
      return own.length !== 1 || own[0] !== reason
    })) return null
  if (evaluateProdatTransactionReason({ rawSegments: canonical.rawSegments, una, code: 'Z02' }).issues.length) return null
  const received = new Date(input.receivedAt)
  if (!Number.isFinite(received.getTime())) throw new Error('supplier_data_birth_receipt_clock_invalid')
  if (canonical.version === null) return null
  const evidence = await resolveCanonicalRulePack({ family: 'PRODAT', messageCode: 'Z02', transactionSubtype: reason,
    applicationReference: canonical.applicationReference, direction: 'inbound', businessDate: stockholmBusinessDate(received) })
  if (canonical.version !== evidence.unhAssociationCode) throw new Error('supplier_data_birth_association_mismatch')
  if (!evidence.databaseProfileKey) throw new Error('supplier_data_birth_database_profile_key_missing')
  return {
    canonical_rule_pack_id: evidence.rulePackId, rule_profile_key: evidence.databaseProfileKey,
    rule_profile_version_id: evidence.messageProfileId, rule_profile_version: evidence.originalVersion,
    rule_pack_checksum: evidence.sourceHash,
    rule_pack_snapshot: { ...evidence.originalSnapshot, profileKey: evidence.databaseProfileKey,
      profileVersionId: evidence.messageProfileId, version: evidence.originalVersion, checksum: evidence.sourceHash },
  }
}
