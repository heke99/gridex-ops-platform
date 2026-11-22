import { supabaseService } from '@/lib/supabase/service'
import { errorCode, isSchemaError } from '@/lib/http/apiError'

export type OpsHealthRow = {
  check_key: string
  status: 'ok' | 'warning' | 'blocking'
  issue_count: number
  details?: Record<string, unknown>
}

type OpsHealthVersion = 'v5' | 'v4' | 'v3'
type OpsHealthSnapshot = {
  rows: OpsHealthRow[]
  schemaReady: boolean
  checkVersion: OpsHealthVersion | null
}

// These checks are emitted by every complete RPC version. v2 emits
// workflow:missing_atomic_commit_marker only when its provisioning relation exists.
const coreChecks = [
  'queue:customer_operation_active_idempotency_duplicate',
  'queue:customer_operation_stale',
  'queue:email_delivery_uncertain',
  'queue:webhook_stale_processing',
  'queue:ediel_delivery_uncertain',
  'address_conflict:duplicate_open',
  'customer_site:unresolved_grid_context',
  'route:receiver_or_mailbox_missing',
  'route:required_receiver_subaddress_missing',
  'route:receiver_certificate_invalid_or_missing',
  'spot_current_day_missing',
  'spot_previous_day_missing',
  'spot_reference_window_incomplete',
  'spot_preview_stale',
  'spot_policy_fallback_conflict',
  'spot_cron_slower_than_freshness_policy',
]
const legacyMasterdataChecks = [
  'masterdata:grid_area_ops_owner_mapping_missing',
  'masterdata:grid_owner_prodat_readiness_missing',
]
const versionChecks: Record<OpsHealthVersion, string[]> = {
  v3: legacyMasterdataChecks,
  v4: [
    ...legacyMasterdataChecks,
    'route:candidate_receiver_or_mailbox_missing',
    'route:candidate_receiver_certificate_invalid_or_missing',
  ],
  v5: [
    'masterdata:grid_owner_prodat_action_required',
    'masterdata:grid_owner_prodat_out_of_scope_inventory',
    'masterdata:grid_area_ops_owner_mapping_review',
    'route:dynamic_receiver_candidate_templates',
    'route:dynamic_receiver_candidate_template_invalid',
    'route:static_candidate_receiver_or_mailbox_missing',
    'route:non_live_certificate_candidate_inventory',
    'route:static_candidate_receiver_certificate_invalid_or_missing',
  ],
}
const executionSchemaCodes = new Set(['42P01', '42702', '42703', '42883', 'PGRST202'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function blockingSnapshot(checkVersion: OpsHealthVersion | null, checkKey: string, details: Record<string, unknown>, rows: OpsHealthRow[] = []): OpsHealthSnapshot {
  return {
    schemaReady: false,
    checkVersion,
    rows: [...rows, { check_key: checkKey, status: 'blocking', issue_count: 1, details }],
  }
}

function validatedSnapshot(data: unknown, version: OpsHealthVersion): OpsHealthSnapshot {
  const rows: OpsHealthRow[] = []
  if (!Array.isArray(data)) {
    return blockingSnapshot(version, 'ops_health_invalid_result', { reason: 'expected_check_rows' })
  }
  for (const row of data) {
    if (!isRecord(row) || typeof row.check_key !== 'string' || row.check_key.trim() === ''
      || (row.status !== 'ok' && row.status !== 'warning' && row.status !== 'blocking')
      || typeof row.issue_count !== 'number' || !Number.isSafeInteger(row.issue_count) || row.issue_count < 0
      || (row.details != null && !isRecord(row.details))) {
      return blockingSnapshot(version, 'ops_health_invalid_result', { reason: 'invalid_check_row' })
    }
    rows.push({ check_key: row.check_key, status: row.status, issue_count: row.issue_count, details: row.details ?? undefined })
  }
  const checkKeys = new Set(rows.map(row => row.check_key))
  const missing = [...coreChecks, ...versionChecks[version]].filter(key => !checkKeys.has(key))
  if (missing.length > 0) {
    return blockingSnapshot(version, 'ops_health_invalid_result', { reason: 'missing_core_checks', missing }, rows)
  }
  return { rows, schemaReady: true, checkVersion: version }
}

function readHealthResult(result: { data: unknown; error: unknown }, version: OpsHealthVersion): OpsHealthSnapshot | null {
  if (!result.error) return validatedSnapshot(result.data, version)

  const code = errorCode(result.error)
  const message = isRecord(result.error) ? result.error.message : undefined
  const name = `public.gridex_ops_health_checks_${version}`
  const missingVersion = (code === 'PGRST202' && message === `Could not find the function ${name} without parameters in the schema cache`)
    || (code === '42883' && message === `function ${name}() does not exist`)
  if (missingVersion) return null

  if (code && executionSchemaCodes.has(code)) {
    return blockingSnapshot(version, 'ops_health_schema', { code })
  }
  throw result.error
}

export async function getOpsHealth(): Promise<OpsHealthSnapshot> {
  // Only an absent RPC permits diagnostics from an older version during rollout.
  const v5 = readHealthResult(await supabaseService.rpc('gridex_ops_health_checks_v5'), 'v5')
  if (v5) return v5

  const v4 = readHealthResult(await supabaseService.rpc('gridex_ops_health_checks_v4'), 'v4')
  if (v4) return v4

  const v3 = readHealthResult(await supabaseService.rpc('gridex_ops_health_checks_v3'), 'v3')
  return v3 ?? blockingSnapshot(null, 'ops_health_schema', { reason: 'no_supported_check_version' })
}

export type GeodataHealthStatus =
  | 'ready'
  | 'partial_geometry_coverage'
  | 'geometry_import_required'
  | 'missing_geometry_table'
  | 'schema_missing'

export type GeodataHealth = {
  status: GeodataHealthStatus
  gridAreasTotal: number
  gridAreaGeometriesTotal: number
  gridAreasWithoutGeometry: number
  policy: string
}

// Surfaces gridex_energy_geodata_health_v so system health can distinguish
// geometry missing vs partial coverage vs ready. Postal/address fallback is
// suggestion-only until polygon geometry coverage exists.
export async function getGeodataHealth(): Promise<GeodataHealth> {
  const fallbackPolicy =
    'Postnummer/adressfallback får endast vara förslag tills polygongeometrier är importerade och verifierade.'
  const { data, error } = await supabaseService
    .from('gridex_energy_geodata_health_v')
    .select('grid_areas_total,grid_area_geometries_total,grid_areas_without_geometry,status,policy')
    .maybeSingle()
  if (error) {
    if (isSchemaError(error)) {
      return {
        status: 'schema_missing',
        gridAreasTotal: 0,
        gridAreaGeometriesTotal: 0,
        gridAreasWithoutGeometry: 0,
        policy: fallbackPolicy,
      }
    }
    throw error
  }
  const row = (data ?? {}) as Record<string, unknown>
  const rawStatus = String(row.status ?? 'schema_missing')
  const status: GeodataHealthStatus =
    rawStatus === 'ready' ||
    rawStatus === 'partial_geometry_coverage' ||
    rawStatus === 'geometry_import_required' ||
    rawStatus === 'missing_geometry_table'
      ? (rawStatus as GeodataHealthStatus)
      : 'schema_missing'
  return {
    status,
    gridAreasTotal: Number(row.grid_areas_total ?? 0) || 0,
    gridAreaGeometriesTotal: Number(row.grid_area_geometries_total ?? 0) || 0,
    gridAreasWithoutGeometry: Number(row.grid_areas_without_geometry ?? 0) || 0,
    policy: typeof row.policy === 'string' && row.policy ? row.policy : fallbackPolicy,
  }
}
