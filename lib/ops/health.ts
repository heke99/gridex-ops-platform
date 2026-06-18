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
  const { data, error } = await supabaseService.rpc('gridex_ops_health_checks')
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
