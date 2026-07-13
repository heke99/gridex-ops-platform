import { supabaseService } from '@/lib/supabase/service'
import type { EdielDirection } from '@/lib/ediel/types'

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

function normalizeRow(value: unknown): CanonicalRulePackResolution {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('canonical_rule_pack_result_invalid')
  }
  const row = value as DbRow
  const profile = row.profile
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new Error('canonical_rule_pack_profile_invalid')
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
  const subtype = params.family === 'PRODAT'
    ? String(params.transactionSubtype ?? '').trim().toUpperCase()
    : ''
  if (params.family === 'PRODAT' && !subtype) {
    throw new Error(`canonical_rule_pack_subtype_required:${params.messageCode}`)
  }

  const { data, error } = await supabaseService.rpc('resolve_canonical_ediel_rule_pack', {
    p_market: 'electricity',
    p_family: params.family,
    p_message_code: params.messageCode.trim().toUpperCase(),
    p_transaction_subtype: subtype,
    p_direction: params.direction,
    p_business_date: params.businessDate,
  })
  if (error) throw new Error(`canonical_rule_pack_resolution_failed:${error.message}`)
  const rows = Array.isArray(data) ? data : data ? [data] : []
  if (rows.length !== 1) {
    throw new Error(`canonical_rule_pack_resolution_count:${rows.length}:${params.family}:${params.messageCode}:${subtype}`)
  }
  const resolved = normalizeRow(rows[0])
  if (!resolved.parserReady || !resolved.validatorReady || !resolved.ackReady) {
    throw new Error(`canonical_rule_pack_runtime_incomplete:${resolved.profileKey}`)
  }
  if (params.requireBuilder !== false && params.direction === 'outbound' && !resolved.builderReady) {
    throw new Error(`canonical_rule_pack_builder_not_ready:${resolved.profileKey}`)
  }
  if (params.requireStateMachine !== false && !resolved.stateMachineReady) {
    throw new Error(`canonical_rule_pack_state_machine_not_ready:${resolved.profileKey}`)
  }
  return resolved
}

export function assertLegacyRuleSnapshotMatchesCanonical(params: {
  canonical: CanonicalRulePackResolution
  legacyVersion: string | null | undefined
  legacyProfileKey: string | null | undefined
}) {
  const normalize = (value: string | null | undefined) => String(value ?? '').replace(/[^A-Z0-9]/gi, '').toUpperCase()
  const expectedVersion = normalize(params.canonical.guideVersion)
  const actualVersion = normalize(params.legacyVersion)
  if (!actualVersion || (actualVersion !== expectedVersion && actualVersion !== normalize(params.canonical.unhAssociationCode))) {
    throw new Error(`legacy_rule_snapshot_version_mismatch:${actualVersion || 'missing'}:${expectedVersion}`)
  }
  if (!String(params.legacyProfileKey ?? '').trim()) {
    throw new Error('legacy_rule_snapshot_profile_key_missing')
  }
}
