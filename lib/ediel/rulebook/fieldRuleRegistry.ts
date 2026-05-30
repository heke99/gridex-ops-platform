import { supabaseService } from '@/lib/supabase/service'
import type { EdielDirection, EdielEnvironment } from '@/lib/ediel/types'
import type { RulebookFieldRule } from '@/lib/ediel/rulebook/fieldMatrix'
import type { EdielRulebookRequirement } from '@/lib/ediel/rulebook/rulebook'

type RegistryRulePayload = {
  allowedValues?: unknown
  allowed_values?: unknown
  dependency?: unknown
  requiredWhen?: unknown
  required_when?: unknown
  anySegmentPresent?: unknown
  allSegmentPresent?: unknown
}

type RegistryFieldRuleRow = Record<string, unknown> & {
  message_family?: string | null
  message_code?: string | null
  field_key?: string | null
  field_code?: string | null
  field_name?: string | null
  field_label?: string | null
  segment_path?: string | null
  requirement?: string | null
  condition?: string | null
  allowed_values?: string[] | null
  error_code_if_missing?: string | null
  error_code_if_invalid?: string | null
  error_code?: string | null
  severity?: string | null
  role_code?: string | null
  direction?: string | null
  environment?: string | null
  version?: string | null
  version_code?: string | null
  is_active?: boolean | null
  enabled?: boolean | null
  dependency_note?: string | null
  rule_payload?: RegistryRulePayload | null
}

export type RegistryFieldRuleScope = {
  family: string
  code: string
  roleCode?: string | null
  direction?: EdielDirection | 'both' | null
  environment?: EdielEnvironment | 'all' | null
  version?: string | null
}

export type RegistryFieldRuleResult = {
  rules: RulebookFieldRule[]
  source: 'registry' | 'static'
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

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => optionalString(item)).filter((item): item is string => Boolean(item))
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.split(/[|,;]/).map((item) => item.trim()).filter(Boolean)
  }
  return []
}

function normalizeRequirement(value: unknown): EdielRulebookRequirement {
  const normalized = normalize(value)
  if (normalized === 'R' || normalized === 'M' || normalized === 'MANDATORY' || normalized === 'REQUIRED') return 'required'
  if (normalized === 'D' || normalized === 'DEPENDENT' || normalized === 'CONDITIONAL') return 'dependent'
  if (normalized === '-' || normalized === 'N' || normalized === 'NOT_USED' || normalized === 'NOT USED' || normalized === 'FORBIDDEN') return 'forbidden'
  return 'optional'
}

function payloadObject(value: unknown): RegistryRulePayload {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RegistryRulePayload : {}
}

function dependencyFromPayload(payload: RegistryRulePayload): RulebookFieldRule['dependency'] {
  const nested = payloadObject(payload.dependency ?? payload.requiredWhen ?? payload.required_when)
  const anySegmentPresent = [
    ...stringArray(payload.anySegmentPresent),
    ...stringArray(nested.anySegmentPresent),
    ...stringArray((nested as { any_segment_present?: unknown }).any_segment_present),
  ]
  const allSegmentPresent = [
    ...stringArray(payload.allSegmentPresent),
    ...stringArray(nested.allSegmentPresent),
    ...stringArray((nested as { all_segment_present?: unknown }).all_segment_present),
  ]

  if (anySegmentPresent.length === 0 && allSegmentPresent.length === 0) return null
  return { anySegmentPresent, allSegmentPresent }
}

function matchesScopedValue(rowValue: unknown, requested: string | null | undefined, wildcardValues: string[]): boolean {
  const row = normalize(rowValue)
  if (!row) return true
  if (wildcardValues.includes(row)) return true
  if (!requested) return true
  return row === normalize(requested)
}

function matchesDirection(rowValue: unknown, requested: RegistryFieldRuleScope['direction']): boolean {
  return matchesScopedValue(rowValue, requested ?? null, ['BOTH', 'ALL'])
}

function matchesEnvironment(rowValue: unknown, requested: RegistryFieldRuleScope['environment']): boolean {
  return matchesScopedValue(rowValue, requested ?? null, ['ALL'])
}

function rowEnabled(row: RegistryFieldRuleRow): boolean {
  return row.is_active !== false && row.enabled !== false
}

function rowMatchesScope(row: RegistryFieldRuleRow, scope: RegistryFieldRuleScope): boolean {
  if (!rowEnabled(row)) return false
  if (normalize(row.message_family) !== normalize(scope.family)) return false
  const rowCode = normalize(row.message_code)
  if (rowCode && rowCode !== '*' && rowCode !== normalize(scope.code)) return false
  if (!matchesScopedValue(row.role_code, scope.roleCode ?? null, ['BOTH', 'ALL'])) return false
  if (!matchesDirection(row.direction, scope.direction ?? null)) return false
  if (!matchesEnvironment(row.environment, scope.environment ?? null)) return false
  if (!matchesScopedValue(row.version ?? row.version_code, scope.version ?? null, ['ALL'])) return false
  return true
}

function ruleFromRow(row: RegistryFieldRuleRow, scope: RegistryFieldRuleScope): RulebookFieldRule {
  const payload = payloadObject(row.rule_payload)
  const requirement = normalizeRequirement(row.requirement)
  const fieldKey = optionalString(row.field_key) ?? optionalString(row.field_code) ?? optionalString(row.segment_path) ?? 'unknown_field'
  const label = optionalString(row.field_label) ?? optionalString(row.field_name) ?? optionalString(row.field_code) ?? fieldKey

  return {
    family: normalize(row.message_family) || normalize(scope.family),
    code: normalize(row.message_code) || normalize(scope.code),
    fieldKey,
    label,
    segmentPath: optionalString(row.segment_path) ?? optionalString(row.field_code),
    requirement,
    condition: optionalString(row.condition) ?? optionalString(row.dependency_note),
    allowedValues: [
      ...stringArray(row.allowed_values),
      ...stringArray(payload.allowedValues),
      ...stringArray(payload.allowed_values),
    ],
    errorCodeIfMissing: optionalString(row.error_code_if_missing) ?? optionalString(row.error_code),
    errorCodeIfInvalid: optionalString(row.error_code_if_invalid) ?? optionalString(row.error_code),
    severity: normalizeLower(row.severity) === 'warning' ? 'warning' : 'error',
    dependency: dependencyFromPayload(payload),
    source: 'registry',
  }
}

function sortRuleRows(rows: RegistryFieldRuleRow[], scope: RegistryFieldRuleScope): RegistryFieldRuleRow[] {
  const code = normalize(scope.code)
  const role = normalize(scope.roleCode)
  const env = normalize(scope.environment)
  const version = normalize(scope.version)

  return [...rows].sort((a, b) => {
    const score = (row: RegistryFieldRuleRow) => [
      normalize(row.message_code) === code ? 0 : 1,
      role && normalize(row.role_code) === role ? 0 : 1,
      env && normalize(row.environment) === env ? 0 : 1,
      version && normalize(row.version ?? row.version_code) === version ? 0 : 1,
      String(row.field_key ?? row.field_code ?? row.segment_path ?? ''),
    ] as const
    const left = score(a)
    const right = score(b)
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] < right[index]) return -1
      if (left[index] > right[index]) return 1
    }
    return 0
  })
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

export async function loadRegistryFieldRules(scope: RegistryFieldRuleScope): Promise<RegistryFieldRuleResult> {
  const { data, error } = await supabaseService
    .from('ediel_field_rules')
    .select('*')
    .eq('message_family', normalize(scope.family))
    .in('message_code', [normalize(scope.code), '*'])

  if (error) {
    const message = String(error.message ?? '')
    if (message.includes('does not exist') || message.includes('schema cache')) {
      return { rules: [], source: 'static' }
    }
    throw error
  }

  const rows = ((data ?? []) as RegistryFieldRuleRow[]).filter((row) => rowMatchesScope(row, scope))
  const rules = sortRuleRows(rows, scope).map((row) => ruleFromRow(row, scope))
  return { rules, source: rules.length > 0 ? 'registry' : 'static' }
}
