import { segmentComposite, segmentElementCount, segmentUntrimmedRaw, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { validateEdifactEnvelope } from '@/lib/ediel/core/edifactValidation'
import { stockholmBusinessDate } from '@/lib/ediel/core/executionContext'
import { prodatRegisterGroups } from '@/lib/ediel/prodat/prodatRegisterGroups'
import { resolveCanonicalRulePack, type OriginalRulePackWitness } from '@/lib/ediel/rulebook/canonicalRulePackRegistry'
import { parseSourceReceiptInstant } from '@/lib/ediel/utilts/receivedSourceInventory'

export type PermissionReportingBirthProfile = {
  canonical_rule_pack_id: string
  rule_profile_key: string
  rule_profile_version_id: string
  rule_profile_version: string
  rule_pack_checksum: string
  rule_pack_snapshot: OriginalRulePackWitness & {
    profileKey: string; profileVersionId: string; version: string; checksum: string
  }
}

/** Prospective catalog witness only. No customer/reporting knowledge, accepted
 * assessment or business effect is established by selecting a physical reason.
 * Missing unrelated R/D fields remain the real validator's responsibility.
 * A mixed report has no single selected witness here; that is not a national
 * declaration that mixed reports are invalid.
 */
export async function resolvePermissionReportingBirthProfile(input: {
  rawPayload: string | null | undefined; receivedAt: string
}): Promise<PermissionReportingBirthProfile | null> {
  if (!validateEdifactEnvelope(input.rawPayload).syntaxOk) return null
  const { segments, una } = tokenizeEdifact(input.rawPayload)
  const unhs = segments.filter(t => t.tag === 'UNH'), bgms = segments.filter(t => t.tag === 'BGM')
  const unb = segments.find(t => t.tag === 'UNB')
  if (unhs.length !== 1 || bgms.length !== 1) return null
  const association = segmentComposite(unhs[0], 2, una)
  const code = segmentComposite(bgms[0], 1, una), application = segmentComposite(unb, 7, una)
  if (association.length !== 5 || association.slice(0, 4).join(':') !== 'PRODAT:D:97A:UN'
    || !association[4] || code.length !== 1 || code[0] !== 'Z14'
    || application.length !== 1 || application[0] !== '23-DGI-PRODAT') return null
  const grouping = prodatRegisterGroups(segments, una, 'Z14')
  if (!grouping.groups.length || grouping.problems.length || segments.indexOf(bgms[0]) > segments.indexOf(grouping.groups[0].segments[0])) return null

  // Count supplied selectors before normalization: header, late, malformed,
  // empty or duplicate pairs must not disappear into a scalar projection.
  const qualifiers = segments.filter(t => t.tag === 'CCI'
    && segmentComposite(t, 2, una)[0]?.trim().toUpperCase() === 'Z13')
  if (qualifiers.length !== grouping.groups.length) return null
  let reason: string | undefined
  for (const group of grouping.groups) {
    if (!group.validRegisterChain) return null
    const own = group.segments
    const supplied = own.filter(t => qualifiers.includes(t))
    if (supplied.length !== 1) return null
    const cci = supplied[0], index = own.indexOf(cci), cav = own[index + 1]
    const parent = own.findIndex(t => t.tag === 'RFF' || t.tag === 'NAD')
    const separator = una.dataElementSeparator
    if (parent >= 0 && index >= parent || segmentUntrimmedRaw(cci) !== `CCI${separator}${separator}Z13`
      || !cav || cav.tag !== 'CAV') return null
    const value = segmentComposite(cav, 1, una)
    if (value.length !== 1 || !['S17', 'S18', 'Z96'].includes(value[0])
      || segmentUntrimmedRaw(cav) !== `CAV${separator}${value[0]}`) return null
    const references = own.filter(t => t.tag === 'RFF' && segmentComposite(t, 1, una)[0] === 'LI')
    const li = segmentComposite(references[0], 1, una)
    if (references.length !== 1 || li.length !== 2 || !li[1] || li[1] !== li[1].trim()
      || segmentElementCount(references[0], una) !== 1) return null
    if (reason !== undefined && reason !== value[0]) return null
    reason = value[0]
  }
  if (reason === undefined) return null
  if (parseSourceReceiptInstant(input.receivedAt) === null) throw new Error('permission_reporting_birth_receipt_clock_invalid')
  const evidence = await resolveCanonicalRulePack({ family: 'PRODAT', messageCode: 'Z14', transactionSubtype: reason,
    applicationReference: application[0], direction: 'inbound', businessDate: stockholmBusinessDate(new Date(input.receivedAt)) })
  if (association[4] !== evidence.unhAssociationCode) throw new Error('permission_reporting_birth_association_mismatch')
  if (!evidence.databaseProfileKey) throw new Error('permission_reporting_birth_database_profile_key_missing')
  return {
    canonical_rule_pack_id: evidence.rulePackId, rule_profile_key: evidence.databaseProfileKey,
    rule_profile_version_id: evidence.messageProfileId, rule_profile_version: evidence.originalVersion,
    rule_pack_checksum: evidence.sourceHash,
    rule_pack_snapshot: { ...evidence.originalSnapshot, profileKey: evidence.databaseProfileKey,
      profileVersionId: evidence.messageProfileId, version: evidence.originalVersion, checksum: evidence.sourceHash },
  }
}
