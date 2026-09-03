import { supabaseService } from '@/lib/supabase/service'
import type { EdielDirection } from '@/lib/ediel/types'
import {
  resolveCanonicalEdielPolicy,
  type CanonicalEdielPolicy,
} from '@/lib/ediel/rulebook/canonicalEdielPolicy'

export type CanonicalRulePackResolution = {
  rulePackId: string
  messageProfileId: string
  market: 'electricity'
  family: string
  guideVersion: string
  guideRevision: string
  unhAssociationCode: string
  validFrom: string
  validTo: string | null
  sourceDocument: string
  sourceHash: string
  fieldMatrixVersion: string | null
  profileKey: string
  businessProcess: string
  phase: string | null
  profile: Record<string, unknown>
  parserReady: boolean
  builderReady: boolean
  validatorReady: boolean
  ackReady: boolean
  stateMachineReady: boolean
}

type DbRow = {
  rule_pack_id?: unknown
  message_profile_id?: unknown
  market?: unknown
  family?: unknown
  guide_version?: unknown
  guide_revision?: unknown
  unh_association_code?: unknown
  valid_from?: unknown
  valid_to?: unknown
  source_document?: unknown
  source_hash?: unknown
  field_matrix_version?: unknown
  profile_key?: unknown
  business_process?: unknown
  phase?: unknown
  profile?: unknown
  parser_ready?: unknown
  builder_ready?: unknown
  validator_ready?: unknown
  ack_ready?: unknown
  state_machine_ready?: unknown
}

type SourceCanonicalResolution = {
  policy: CanonicalEdielPolicy
  family: 'PRODAT' | 'UTILTS'
  associationAssignedCode: string
  profileKey: string
  businessProcess: string
  phase: string | null
  profile: Record<string, unknown>
}

function requiredText(row: DbRow, key: keyof DbRow): string {
  const value = row[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`canonical_rule_pack_result_missing:${String(key)}`)
  }
  return value.trim()
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function booleanValue(row: DbRow, key: keyof DbRow): boolean {
  if (typeof row[key] !== 'boolean') {
    throw new Error(`canonical_rule_pack_result_missing:${String(key)}`)
  }
  return row[key] as boolean
}

function normalizeDbEvidence(value: unknown): CanonicalRulePackResolution {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('canonical_rule_pack_result_invalid')
  }
  const row = value as DbRow
  const profile = row.profile
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new Error('canonical_rule_pack_profile_evidence_invalid')
  }
  const market = requiredText(row, 'market')
  if (market !== 'electricity') throw new Error(`canonical_rule_pack_market_invalid:${market}`)
  return {
    rulePackId: requiredText(row, 'rule_pack_id'),
    messageProfileId: requiredText(row, 'message_profile_id'),
    market: 'electricity',
    family: requiredText(row, 'family'),
    guideVersion: requiredText(row, 'guide_version'),
    guideRevision: requiredText(row, 'guide_revision'),
    unhAssociationCode: requiredText(row, 'unh_association_code'),
    validFrom: requiredText(row, 'valid_from'),
    validTo: nullableText(row.valid_to),
    sourceDocument: requiredText(row, 'source_document'),
    sourceHash: requiredText(row, 'source_hash'),
    fieldMatrixVersion: nullableText(row.field_matrix_version),
    profileKey: requiredText(row, 'profile_key'),
    businessProcess: requiredText(row, 'business_process'),
    phase: nullableText(row.phase),
    profile: profile as Record<string, unknown>,
    parserReady: booleanValue(row, 'parser_ready'),
    builderReady: booleanValue(row, 'builder_ready'),
    validatorReady: booleanValue(row, 'validator_ready'),
    ackReady: booleanValue(row, 'ack_ready'),
    stateMachineReady: booleanValue(row, 'state_machine_ready'),
  }
}

function normalizeIdentifier(value: string | null | undefined): string {
  return String(value ?? '').replace(/[^A-Z0-9]/gi, '').toUpperCase()
}

function requiredProfileText(profile: Record<string, unknown>, key: string): string {
  const value = profile[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`canonical_rule_pack_evidence_profile_field_missing:${key}`)
  }
  return value.trim()
}

function assertPolicyDirection(policy: CanonicalEdielPolicy, direction: EdielDirection): void {
  const canonicalDirection = policy.semantics.direction
  if (canonicalDirection !== 'both' && canonicalDirection !== direction) {
    throw new Error(`canonical_source_direction_not_allowed:${policy.code}:${direction}:${canonicalDirection}`)
  }
}

function policyProfileSnapshot(policy: CanonicalEdielPolicy): Record<string, unknown> {
  return {
    profileKey: policy.profileKey,
    messageCode: policy.code,
    transactionSubtype: policy.subtype,
    transactionReasonCode: policy.transactionReasonCode,
    processGroup: policy.processGroup,
    phase: policy.phase,
    applicationReference: policy.applicationReference,
    associationAssignedCode: policy.associationAssignedCode,
    guideRevision: policy.guide.guideRevision,
    effectiveFrom: policy.guide.effectiveFrom,
    effectiveTo: policy.guide.effectiveTo,
    direction: policy.direction,
    bilateralRequired: policy.bilateralRequired,
    businessEffect: policy.semantics.businessEffect,
    dataScope: policy.semantics.dataScope,
  }
}

function resolveSourceCanonical(params: {
  family: 'PRODAT' | 'UTILTS'
  messageCode: string
  transactionSubtype?: string | null
  direction: EdielDirection
  businessDate: string
}): SourceCanonicalResolution {
  // Catalog/evidence mode is non-operational. A first policy resolution obtains
  // the canonical application reference without inventing a local code mapping;
  // the second resolution uses the real direction and the same policy authority.
  const bootstrap = resolveCanonicalEdielPolicy({
    family: params.family,
    messageCode: params.messageCode,
    subtypeOrReasonCode: params.transactionSubtype,
    direction: 'outbound',
    referenceDate: params.businessDate,
    mode: 'catalog_evidence',
  })
  const policy = resolveCanonicalEdielPolicy({
    family: params.family,
    messageCode: params.messageCode,
    subtypeOrReasonCode: params.transactionSubtype,
    direction: params.direction,
    referenceDate: params.businessDate,
    applicationReference: bootstrap.applicationReference,
    mode: 'catalog_evidence',
  })
  assertPolicyDirection(policy, params.direction)

  if (policy.family !== 'PRODAT' && policy.family !== 'UTILTS') {
    throw new Error(`canonical_source_family_invalid:${policy.family}`)
  }
  if (!policy.profileKey) throw new Error(`canonical_source_profile_key_missing:${policy.family}:${policy.code}`)
  if (!policy.associationAssignedCode) throw new Error(`canonical_source_association_missing:${policy.family}:${policy.code}`)

  return {
    policy,
    family: policy.family,
    associationAssignedCode: policy.associationAssignedCode,
    profileKey: policy.profileKey,
    businessProcess: policy.processGroup ?? policy.semantics.businessProcess,
    phase: policy.phase,
    profile: policyProfileSnapshot(policy),
  }
}

function assertDbEvidenceMatchesSource(input: {
  evidence: CanonicalRulePackResolution
  source: SourceCanonicalResolution
  businessDate: string
}) {
  const { evidence, source, businessDate } = input
  if (normalizeIdentifier(evidence.family) !== source.family) {
    throw new Error(`canonical_rule_pack_evidence_family_mismatch:${evidence.family}:${source.family}`)
  }
  if (normalizeIdentifier(evidence.unhAssociationCode) !== normalizeIdentifier(source.associationAssignedCode)) {
    throw new Error(`canonical_rule_pack_evidence_association_mismatch:${evidence.unhAssociationCode}:${source.associationAssignedCode}`)
  }
  if (evidence.validFrom > businessDate || (evidence.validTo && evidence.validTo < businessDate)) {
    throw new Error(`canonical_rule_pack_evidence_date_mismatch:${businessDate}:${evidence.validFrom}:${evidence.validTo ?? 'open'}`)
  }

  // ediel_message_profiles.profile_key is a stable DB evidence identifier
  // (for example PRODAT:Z01:L:26.A:r3), not the semantic runtime profile key
  // (for example prodat_z01_customer_identity_request). Verify the row by the
  // normative identity fields it evidences instead of comparing those two
  // different identifier namespaces.
  const profileFamily = normalizeIdentifier(requiredProfileText(evidence.profile, 'family'))
  if (profileFamily !== source.family) {
    throw new Error(`canonical_rule_pack_evidence_profile_family_mismatch:${profileFamily}:${source.family}`)
  }
  const profileMessageCode = normalizeIdentifier(requiredProfileText(evidence.profile, 'messageCode'))
  const sourceMessageCode = normalizeIdentifier(source.policy.code)
  if (profileMessageCode !== sourceMessageCode) {
    throw new Error(`canonical_rule_pack_evidence_message_code_mismatch:${profileMessageCode}:${sourceMessageCode}`)
  }

  if (source.family === 'PRODAT') {
    const profileSubtype = normalizeIdentifier(requiredProfileText(evidence.profile, 'transactionSubtype'))
    const sourceSubtype = normalizeIdentifier(source.policy.subtype)
    if (profileSubtype !== sourceSubtype) {
      throw new Error(`canonical_rule_pack_evidence_subtype_mismatch:${profileSubtype}:${sourceSubtype || 'missing'}`)
    }

    const profileDirection = requiredProfileText(evidence.profile, 'canonicalDirection').toLowerCase()
    if (profileDirection !== source.policy.direction && profileDirection !== 'both') {
      throw new Error(`canonical_rule_pack_evidence_direction_mismatch:${profileDirection}:${source.policy.direction}`)
    }

    const sourceReason = normalizeIdentifier(source.policy.transactionReasonCode)
    if (sourceReason) {
      const profileReason = normalizeIdentifier(requiredProfileText(evidence.profile, 'reasonForTransaction'))
      if (profileReason !== sourceReason) {
        throw new Error(`canonical_rule_pack_evidence_reason_mismatch:${profileReason}:${sourceReason}`)
      }
    }
  }

  const dbGuideTokens = [evidence.guideVersion, evidence.guideRevision].map(normalizeIdentifier)
  const sourceGuideTokens = [source.policy.guide.guideRevision, source.associationAssignedCode].map(normalizeIdentifier)
  if (!dbGuideTokens.some((token) => sourceGuideTokens.includes(token))) {
    throw new Error(`canonical_rule_pack_evidence_guide_mismatch:${evidence.guideVersion}:${source.policy.guide.guideRevision}`)
  }
}

/**
 * Canonical policy resolves all normative Ediel semantics first. Supabase is
 * queried only for an activated evidence row (stable IDs, checksum/readiness)
 * matching that policy decision. DB profile JSON can never redefine runtime
 * message function, subtype, direction, Application Reference, ACK or guide.
 */
export async function resolveCanonicalRulePack(params: {
  family: 'PRODAT' | 'UTILTS'
  messageCode: string
  transactionSubtype?: string | null
  direction: EdielDirection
  businessDate: string
  requireBuilder?: boolean
  requireStateMachine?: boolean
}): Promise<CanonicalRulePackResolution> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.businessDate)) {
    throw new Error('canonical_rule_pack_business_date_invalid')
  }

  const source = resolveSourceCanonical(params)
  const subtype = params.family === 'PRODAT'
    ? String(source.policy.subtype ?? '').trim().toUpperCase()
    : ''

  const { data, error } = await supabaseService.rpc('resolve_canonical_ediel_rule_pack', {
    p_market: 'electricity',
    p_family: source.family,
    p_message_code: source.policy.code,
    p_transaction_subtype: subtype,
    p_direction: params.direction,
    p_business_date: params.businessDate,
  })
  if (error) throw new Error(`canonical_rule_pack_evidence_resolution_failed:${error.message}`)
  const rows = Array.isArray(data) ? data : data ? [data] : []
  if (rows.length !== 1) {
    throw new Error(`canonical_rule_pack_evidence_count:${rows.length}:${params.family}:${params.messageCode}:${subtype}`)
  }

  const evidence = normalizeDbEvidence(rows[0])
  assertDbEvidenceMatchesSource({ evidence, source, businessDate: params.businessDate })

  if (!evidence.parserReady || !evidence.validatorReady || !evidence.ackReady) {
    throw new Error(`canonical_rule_pack_evidence_runtime_incomplete:${evidence.profileKey}`)
  }
  if (params.requireBuilder !== false && params.direction === 'outbound' && !evidence.builderReady) {
    throw new Error(`canonical_rule_pack_evidence_builder_not_ready:${evidence.profileKey}`)
  }
  if (params.requireStateMachine !== false && !evidence.stateMachineReady) {
    throw new Error(`canonical_rule_pack_evidence_state_machine_not_ready:${evidence.profileKey}`)
  }

  return {
    ...evidence,
    family: source.family,
    guideVersion: source.policy.guide.guideRevision,
    guideRevision: source.policy.guide.guideRevision,
    unhAssociationCode: source.associationAssignedCode,
    validFrom: source.policy.guide.effectiveFrom,
    validTo: source.policy.guide.effectiveTo,
    sourceDocument: source.policy.guide.documentName,
    profileKey: source.profileKey,
    businessProcess: source.businessProcess,
    phase: source.phase,
    profile: source.profile,
  }
}

export function assertLegacyRuleSnapshotMatchesCanonical(params: {
  canonical: CanonicalRulePackResolution
  legacyVersion: string | null | undefined
  legacyProfileKey: string | null | undefined
}) {
  const expectedVersion = normalizeIdentifier(params.canonical.guideVersion)
  const actualVersion = normalizeIdentifier(params.legacyVersion)
  const expectedAssociation = normalizeIdentifier(params.canonical.unhAssociationCode)
  if (!actualVersion || (actualVersion !== expectedVersion && actualVersion !== expectedAssociation)) {
    throw new Error(`legacy_rule_snapshot_version_mismatch:${actualVersion || 'missing'}:${expectedVersion}`)
  }
  if (!String(params.legacyProfileKey ?? '').trim()) {
    throw new Error('legacy_rule_snapshot_profile_key_missing')
  }
}
