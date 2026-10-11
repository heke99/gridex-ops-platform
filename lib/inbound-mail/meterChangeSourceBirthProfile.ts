import { parseCanonicalEdielPayload } from '@/lib/ediel/core/canonicalMessage'
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { stockholmBusinessDate } from '@/lib/ediel/core/executionContext'
import { validateEdifactSyntax } from '@/lib/ediel/core/syntaxValidator'
import { prodatRegisterGroups } from '@/lib/ediel/prodat/prodatRegisterGroups'
import { prodatRegisterFieldState } from '@/lib/ediel/prodat/prodatRegisterFields'
import { prodatRegisterReadingSubtype } from '@/lib/ediel/prodat/prodatRegisterReadings'
import { resolveCanonicalRulePack } from '@/lib/ediel/rulebook/canonicalRulePackRegistry'
import { parseSourceReceiptInstant } from '@/lib/ediel/utilts/receivedSourceInventory'

/** Prospective original catalog binding only. No source READ token, legal
 * admission, validation decision or business authority is created here.
 * Each object's first register supplies its own physical M/E58 reason.
 */
export async function resolveMeterChangeSourceBirthProfile(input: Readonly<{
  rawPayload: string | null | undefined
  receivedAt: string
  applicationReference: string | null
  environment: string
}>) {
  const { rawPayload, receivedAt, applicationReference, environment } = input
  if (typeof rawPayload !== 'string' || Buffer.byteLength(rawPayload, 'utf8') > 262144) return null
  const canonical = parseCanonicalEdielPayload({ rawPayload, direction: 'inbound', standardHint: 'edifact' })
  if (canonical.family !== 'PRODAT' || canonical.messageCode !== 'Z10'
    || canonical.applicationReference !== '23-DDQ-PRODAT') return null
  const syntax = validateEdifactSyntax({ raw_payload: rawPayload, message_family: 'PRODAT', message_code: 'Z10',
    status: 'received', syntax_check_status: 'not_checked', validation_report: {}, failure_reason: null })
  if (!syntax.ok || syntax.grammarQualification !== 'qualified') return null
  const { segments, una } = tokenizeEdifact(rawPayload)
  if (['UNB', 'UNH', 'BGM', 'UNT', 'UNZ'].some(tag => segments.filter(token => token.tag === tag).length !== 1)) return null
  const unb = segments.find(token => token.tag === 'UNB')!
  const physicalApplication = segmentComposite(unb, 7, una)
  const testIndicator = segmentComposite(unb, 11, una)
  if (segmentComposite(segments.find(token => token.tag === 'BGM')!, 1, una)[0] !== 'Z10'
    || physicalApplication.length !== 1 || physicalApplication[0] !== '23-DDQ-PRODAT'
    || testIndicator.length !== 1 || !['', '1'].includes(testIndicator[0])) return null
  const identity = segmentComposite(segments.find(token => token.tag === 'UNH')!, 2, una)
  if (identity.slice(0, 5).join(':') !== 'PRODAT:D:97A:UN:E2SE6A'
    || identity.slice(5).some(value => value !== '')) return null
  const { groups, problems } = prodatRegisterGroups(segments, una, 'Z10')
  const first = groups.filter(group => group.firstLineIndex === group.lineIndex)
  if (!first.length || problems.length || groups.some(group => {
    const point = prodatRegisterFieldState('209', group.segments, una)
    return group.messageIndex !== 0 || !group.validRegisterChain || !point?.present || point.malformed
      || !['9', '89'].includes(group.identityAgency ?? '')
  })) return null
  // Include misplaced/malformed qualifiers in the count, so a header or later
  // repeated register cannot borrow its first register's source-exact reason.
  const reasons = segments.filter(token => token.tag === 'CCI'
    && segmentComposite(token, 2, una)[0]?.trim().toUpperCase() === 'Z13')
  if (reasons.length !== first.length
    || first.some(group => prodatRegisterReadingSubtype('Z10', group.segments, una) !== 'M')) return null
  // Bind the same physical application and test/production namespace that the
  // INSERT retains. A later reception refusal cannot undo a separate INSERT.
  if (applicationReference !== physicalApplication[0]
    || environment !== (testIndicator[0] === '1' ? 'test' : 'production')) {
    throw new Error('meter_change_birth_source_scope_mismatch')
  }
  if (parseSourceReceiptInstant(receivedAt) === null) throw new Error('meter_change_birth_receipt_clock_invalid')
  const evidence = await resolveCanonicalRulePack({ family: 'PRODAT', messageCode: 'Z10', transactionSubtype: 'E58',
    applicationReference: canonical.applicationReference, direction: 'inbound',
    businessDate: stockholmBusinessDate(new Date(receivedAt)) })
  if (identity[4] !== evidence.unhAssociationCode) throw new Error('meter_change_birth_association_mismatch')
  if (!evidence.databaseProfileKey) throw new Error('meter_change_birth_database_profile_key_missing')
  return {
    message_version: identity[4],
    // Date/ISO normalization would truncate the retained PostgreSQL microseconds.
    message_received_at: receivedAt,
    canonical_rule_pack_id: evidence.rulePackId, rule_profile_key: evidence.databaseProfileKey,
    rule_profile_version_id: evidence.messageProfileId, rule_profile_version: evidence.originalVersion,
    rule_pack_checksum: evidence.sourceHash,
    rule_pack_snapshot: { ...evidence.originalSnapshot, profileKey: evidence.databaseProfileKey,
      profileVersionId: evidence.messageProfileId, version: evidence.originalVersion, checksum: evidence.sourceHash },
  }
}
