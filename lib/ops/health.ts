import { supabaseService } from '@/lib/supabase/service'
import { isSchemaError } from '@/lib/http/apiError'

export type OpsHealthRow = {
  check_key: string
  status: 'ok' | 'warning' | 'blocking'
  issue_count: number
  details?: Record<string, unknown>
}

function asRows(value: unknown): OpsHealthRow[] {
  return Array.isArray(value)
    ? value
        .filter((row): row is Record<string, unknown> => Boolean(row && typeof row === 'object' && !Array.isArray(row)))
        .map((row) => ({
          check_key: String(row.check_key ?? 'unknown'),
          status: row.status === 'blocking' || row.status === 'warning' ? row.status : 'ok',
          issue_count: Number(row.issue_count ?? 0) || 0,
          details: row.details && typeof row.details === 'object' && !Array.isArray(row.details) ? row.details as Record<string, unknown> : undefined,
        }))
    : []
}

export async function getOpsHealth(): Promise<{ rows: OpsHealthRow[]; schemaReady: boolean }> {
  const { data, error } = await supabaseService.rpc('gridex_ops_health_checks_v2')
  if (error) {
    if (isSchemaError(error)) {
      return {
        schemaReady: false,
        rows: [{ check_key: 'ops_health_schema', status: 'blocking', issue_count: 1, details: { code: error.code ?? null } }],
      }
    }
    throw error
  }
  return { schemaReady: true, rows: asRows(data) }
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
