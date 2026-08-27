import { supabaseService } from '@/lib/supabase/service'
import type { EdielDirection, EdielEnvironment } from '@/lib/ediel/types'
import { fieldRulesForMessage, type RulebookFieldRule } from '@/lib/ediel/rulebook/fieldMatrix'
import type { EdielRulebookRequirement } from '@/lib/ediel/rulebook/rulebook'
import { canonicalProdat26AFieldRules } from '@/lib/ediel/prodat/prodat26AFieldMatrix'

export type RegistryFieldRuleScope = {
  family: string
  code: string
  roleCode?: string | null
  direction?: EdielDirection | 'both' | null
  environment?: EdielEnvironment | 'all' | null
  version?: string | null
  companyId?: string | null
}

export type RegistryRulePackSnapshot = {
  profileKey: string
  profileVersionId: string
  version: string
  checksum: string
}

export type RegistryFieldRuleResult = {
  rules: RulebookFieldRule[]
  source: 'registry' | 'static'
  rulePack: RegistryRulePackSnapshot | null
}

type RulePackEvidenceRow = Record<string, unknown> & {
  profile_key?: string | null
  rule_profile_version_id?: string | null
  profile_version?: string | null
  version?: string | null
  version_code?: string | null
  rule_pack_checksum?: string | null
}

function normalize(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

function normalizeLower(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export function normalizeRegistryRequirement(value: unknown): EdielRulebookRequirement {
  const normalized = normalize(value)
  if (normalized === 'R' || normalized === 'M' || normalized === 'MANDATORY' || normalized === 'REQUIRED') return 'required'
  if (normalized === 'D' || normalized === 'DEPENDENT' || normalized === 'CONDITIONAL') return 'dependent'
  if (normalized === 'X' || normalized === '-' || normalized === 'N' || normalized === 'NOT_USED' || normalized === 'NOT USED' || normalized === 'FORBIDDEN') return 'forbidden'
  return 'optional'
}

export function deriveEdielRoleCode(input: {
  family?: string | null
  code?: string | null
  processGroup?: string | null
  applicationReference?: string | null
  roleCode?: string | null
}): string | null {
  const explicit = normalize(input.roleCode)
  if (explicit === 'DDQ' || explicit === 'DGI') return explicit
  const reference = normalize(input.applicationReference)
  if (reference.includes('DGI')) return 'DGI'
  if (reference.includes('DDQ')) return 'DDQ'
  const processGroup = normalizeLower(input.processGroup)
  if (processGroup.includes('metering') || processGroup.includes('permission')) return 'DGI'
  if (normalize(input.family) === 'PRODAT') return 'DDQ'
  return null
}

function canonicalRules(scope: RegistryFieldRuleScope): RulebookFieldRule[] {
  const family = normalize(scope.family)
  const code = normalize(scope.code)
  if (family === 'PRODAT') return canonicalProdat26AFieldRules(code)
  return fieldRulesForMessage(family, code)
}

function snapshotFromEvidence(rows: RulePackEvidenceRow[]): RegistryRulePackSnapshot | null {
  const row = rows[0]
  if (!row) return null
  const profileKey = optionalString(row.profile_key)
  const profileVersionId = optionalString(row.rule_profile_version_id)
  const version = optionalString(row.profile_version ?? row.version ?? row.version_code)
  const checksum = optionalString(row.rule_pack_checksum)
  if (!profileKey || !profileVersionId || !version || !checksum) return null
  return { profileKey, profileVersionId, version, checksum }
}

/**
 * Resolve canonical field semantics from source-controlled code.
 *
 * Supabase rule-pack rows are deliberately evidence-only: they may prove which
 * version/checksum was activated and provide an audit snapshot, but they can no
 * longer redefine R/D/O/forbidden requirements at runtime. This prevents an OPS
 * or database edit from silently changing Swedish Ediel protocol semantics.
 */
export async function loadRegistryFieldRules(scope: RegistryFieldRuleScope): Promise<RegistryFieldRuleResult> {
  const rules = canonicalRules(scope)
  if (rules.length === 0) {
    throw new Error(`ediel_canonical_field_rules_missing:${normalize(scope.family)}:${normalize(scope.code)}`)
  }

  const { data, error } = await supabaseService.rpc('resolve_ediel_rule_pack_fields', {
    p_message_family: normalize(scope.family),
    p_message_code: normalize(scope.code),
    p_role_code: optionalString(scope.roleCode),
    p_direction: optionalString(scope.direction),
    p_environment: optionalString(scope.environment),
    p_requested_version: optionalString(scope.version),
    p_company_id: optionalString(scope.companyId),
  })

  if (error) {
    // Canonical semantics must remain deterministic even when the evidence store
    // is unavailable. Production send/readiness gates can independently require
    // a persisted activation snapshot where applicable.
    return { rules, source: 'static', rulePack: null }
  }

  return {
    rules,
    source: 'static',
    rulePack: snapshotFromEvidence((data ?? []) as RulePackEvidenceRow[]),
  }
}
