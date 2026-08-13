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
  fieldNumber?: unknown
  field_number?: unknown
  scope?: unknown
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
  profile_key?: string | null
  rule_profile_version_id?: string | null
  profile_version?: string | null
  rule_pack_checksum?: string | null
}

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

type FieldMetadata = {
  fieldKey: string
  segmentPath: string | null
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

export function normalizeRegistryRequirement(value: unknown): EdielRulebookRequirement {
  const normalized = normalize(value)
  if (normalized === 'R' || normalized === 'M' || normalized === 'MANDATORY' || normalized === 'REQUIRED') return 'required'
  if (normalized === 'D' || normalized === 'DEPENDENT' || normalized === 'CONDITIONAL') return 'dependent'
  if (normalized === 'X' || normalized === '-' || normalized === 'N' || normalized === 'NOT_USED' || normalized === 'NOT USED' || normalized === 'FORBIDDEN') return 'forbidden'
  return 'optional'
}

function payloadObject(value: unknown): RegistryRulePayload {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RegistryRulePayload : {}
}

const PRODAT_FIELD_METADATA: Record<string, FieldMetadata> = {
  '311': { fieldKey: 'application_reference', segmentPath: 'UNB/S005/0026' },
  '312': { fieldKey: 'association_assigned_code', segmentPath: 'UNH/S009/0057' },
  '202': { fieldKey: 'message_code', segmentPath: 'BGM/C002/1001' },
  '203': { fieldKey: 'message_id', segmentPath: 'UNH/0062' },
  '204': { fieldKey: 'message_function', segmentPath: 'BGM/1225' },
  '313': { fieldKey: 'request_for_acknowledgement', segmentPath: 'BGM/4343' },
  '205': { fieldKey: 'document_date', segmentPath: 'DTM+137' },
  '206': { fieldKey: 'timezone', segmentPath: 'DTM+ZZZ' },
  '301': { fieldKey: 'free_text_header', segmentPath: 'FTX' },
  '207': { fieldKey: 'sender_ediel_id', segmentPath: 'UNB/S002' },
  '315': { fieldKey: 'sender_organisation_no', segmentPath: 'NAD+FR' },
  '208': { fieldKey: 'receiver_ediel_id', segmentPath: 'UNB/S003' },
  '314': { fieldKey: 'sequence_number', segmentPath: 'LIN' },
  '209': { fieldKey: 'line_item', segmentPath: 'LIN' },
  '258': { fieldKey: 'sub_line_number', segmentPath: 'LIN' },
  '210': { fieldKey: 'contract_start_date', segmentPath: 'DTM+92' },
  '211': { fieldKey: 'contract_stop_date', segmentPath: 'DTM+93' },
  '302': { fieldKey: 'report_start_date', segmentPath: 'DTM+163' },
  '321': { fieldKey: 'report_end_date', segmentPath: 'DTM+164' },
  '216': { fieldKey: 'validity_start_date', segmentPath: 'DTM+157' },
  '212': { fieldKey: 'first_meter_reading_date', segmentPath: 'DTM+9' },
  '249': { fieldKey: 'date_of_birth', segmentPath: 'DTM+329' },
  '508': { fieldKey: 'observation_length', segmentPath: 'CCI++Z03/CAV' },
  '326': { fieldKey: 'permission_creation_timestamp', segmentPath: 'DTM+171' },
  '327': { fieldKey: 'processing_end_timestamp', segmentPath: 'DTM+273' },
  '303': { fieldKey: 'free_text_item_level', segmentPath: 'FTX' },
  '213': { fieldKey: 'estimated_annual_volume', segmentPath: 'QTY+31' },
  '214': { fieldKey: 'constant', segmentPath: 'QTY+40' },
  '215': { fieldKey: 'old_constant', segmentPath: 'QTY+40' },
  '217': { fieldKey: 'measure_method', segmentPath: 'CCI++Z04/CAV' },
  '218': { fieldKey: 'number_of_digits', segmentPath: 'QTY+218' },
  '219': { fieldKey: 'old_number_of_digits', segmentPath: 'QTY+219' },
  '306': { fieldKey: 'installation_status', segmentPath: 'CCI++Z05/CAV' },
  '307': { fieldKey: 'tariff_code', segmentPath: 'CCI++Z06/CAV' },
  '220': { fieldKey: 'priority', segmentPath: 'CCI++Z07/CAV' },
  '222': { fieldKey: 'reporting_frequency', segmentPath: 'CCI++Z12/CAV' },
  '223': { fieldKey: 'reason_for_transaction', segmentPath: 'CCI++Z13/CAV' },
  '259': { fieldKey: 'meter_time_frame', segmentPath: 'CCI++Z15/CAV' },
  '254': { fieldKey: 'balance_settlement_method', segmentPath: 'CCI++Z16/CAV' },
  '242': { fieldKey: 'product_code', segmentPath: 'CCI++Z17/CAV' },
  '506': { fieldKey: 'energy_product', segmentPath: 'CCI++Z14/CAV' },
  '310': { fieldKey: 'party_connected_to_grid_status', segmentPath: 'CCI++Z18/CAV' },
  '513': { fieldKey: 'installation_direction', segmentPath: 'CCI++Z22/CAV' },
  '322': { fieldKey: 'permission_status', segmentPath: 'CCI++Z23/CAV' },
  '323': { fieldKey: 'permission_purpose', segmentPath: 'CCI++Z24/CAV' },
  '324': { fieldKey: 'permission_end_reason', segmentPath: 'CCI++Z25/CAV' },
  '224': { fieldKey: 'meter_number', segmentPath: 'RFF+MG' },
  '225': { fieldKey: 'old_meter_number', segmentPath: 'RFF+MG' },
  '308': { fieldKey: 'supplier_contract_no', segmentPath: 'RFF+CT' },
  '260': { fieldKey: 'net_area', segmentPath: 'RFF+Z05' },
  '320': { fieldKey: 'calorific_value_area', segmentPath: 'RFF+Z10' },
  '240': { fieldKey: 'serial_id', segmentPath: 'RFF+SI' },
  '319': { fieldKey: 'reference_to_metering_point', segmentPath: 'RFF+Z07' },
  '261': { fieldKey: 'agreement_reference', segmentPath: 'RFF+ANJ' },
  '226': { fieldKey: 'line_reference', segmentPath: 'RFF+LI' },
  '325': { fieldKey: 'permission_id', segmentPath: 'RFF+ZPI' },
  END_USER_GROUP: { fieldKey: 'end_user_group', segmentPath: 'NAD+UD' },
  '227': { fieldKey: 'end_user_id', segmentPath: 'NAD+UD' },
  '228': { fieldKey: 'end_user_name', segmentPath: 'NAD+UD' },
  '229': { fieldKey: 'end_user_address', segmentPath: 'NAD+UD' },
  '231': { fieldKey: 'end_user_postcode', segmentPath: 'NAD+UD' },
  '232': { fieldKey: 'end_user_city', segmentPath: 'NAD+UD' },
  '316': { fieldKey: 'end_user_country', segmentPath: 'NAD+UD' },
  INSTALLATION_GROUP: { fieldKey: 'installation_group', segmentPath: 'NAD+IT' },
  '233': { fieldKey: 'installation_id', segmentPath: 'NAD+IT' },
  '234': { fieldKey: 'installation_address', segmentPath: 'NAD+IT' },
  '235': { fieldKey: 'installation_postcode', segmentPath: 'NAD+IT' },
  '236': { fieldKey: 'installation_city', segmentPath: 'NAD+IT' },
  '237': { fieldKey: 'installation_country', segmentPath: 'NAD+IT' },
  INVOICEE_GROUP: { fieldKey: 'invoicee_group', segmentPath: 'NAD+IV' },
  '250': { fieldKey: 'invoicee_id', segmentPath: 'NAD+IV' },
  '251': { fieldKey: 'invoicee_name', segmentPath: 'NAD+IV' },
  '252': { fieldKey: 'invoicee_address', segmentPath: 'NAD+IV' },
  '253': { fieldKey: 'invoicee_postcode', segmentPath: 'NAD+IV' },
  '317': { fieldKey: 'invoicee_city', segmentPath: 'NAD+IV' },
  '318': { fieldKey: 'invoicee_country', segmentPath: 'NAD+IV' },
  '262': { fieldKey: 'balance_responsible', segmentPath: 'NAD+Z02' },
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
  const requirement = normalizeRegistryRequirement(row.requirement)
  const metadata = PRODAT_FIELD_METADATA[normalize(row.field_code)]
  const fieldKey = metadata?.fieldKey ?? optionalString(row.field_key) ?? optionalString(row.field_code) ?? optionalString(row.segment_path) ?? 'unknown_field'
  const label = optionalString(row.field_label) ?? optionalString(row.field_name) ?? optionalString(row.field_code) ?? fieldKey

  return {
    family: normalize(row.message_family) || normalize(scope.family),
    code: normalize(row.message_code) || normalize(scope.code),
    fieldNumber: optionalString(payload.fieldNumber ?? payload.field_number) ?? optionalString(row.field_code) ?? undefined,
    scope: ['header', 'transaction', 'observation'].includes(normalizeLower(payload.scope))
      ? normalizeLower(payload.scope) as RulebookFieldRule['scope']
      : undefined,
    fieldKey,
    label,
    segmentPath: optionalString(row.segment_path) ?? metadata?.segmentPath ?? optionalString(row.field_code),
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
    const allowTestFallback = process.env.NODE_ENV === 'test' && process.env.EDIEL_ALLOW_STATIC_RULES_IN_TESTS === '1'
    if (allowTestFallback) return { rules: [], source: 'static', rulePack: null }
    throw new Error(`ediel_rule_pack_resolution_failed:${String(error.message ?? error)}`)
  }

  const rows = ((data ?? []) as RegistryFieldRuleRow[]).filter((row) => rowMatchesScope(row, scope))
  if (rows.length === 0) {
    const allowTestFallback = process.env.NODE_ENV === 'test' && process.env.EDIEL_ALLOW_STATIC_RULES_IN_TESTS === '1'
    if (allowTestFallback) return { rules: [], source: 'static', rulePack: null }
    throw new Error(`ediel_active_rule_pack_missing:${normalize(scope.family)}:${normalize(scope.code)}`)
  }

  const first = rows[0]
  const profileKey = optionalString(first.profile_key)
  const profileVersionId = optionalString(first.rule_profile_version_id)
  const version = optionalString(first.profile_version ?? first.version ?? first.version_code)
  const checksum = optionalString(first.rule_pack_checksum)
  if (!profileKey || !profileVersionId || !version || !checksum) {
    throw new Error(`ediel_rule_pack_snapshot_incomplete:${normalize(scope.family)}:${normalize(scope.code)}`)
  }

  const fieldRows = rows.filter((row) => normalize(row.field_key) !== '__PROFILE__')
  const rules = sortRuleRows(fieldRows, scope).map((row) => ruleFromRow(row, scope))
  return {
    rules,
    source: 'registry',
    rulePack: { profileKey, profileVersionId, version, checksum },
  }
}
