import { supabaseService } from '@/lib/supabase/service'

/**
 * Minimum compatible database migration for the running application.
 * Newer migrations are accepted; the API must not be disabled merely because
 * the database is ahead of the application build.
 */
export const REQUIRED_PLATFORM_SCHEMA_VERSION = '20260713150000-api-performance-tenant-hardening'
const READINESS_CACHE_TTL_MS = 30_000

type ReadinessRow = {
  current_version?: string | null
  is_ready?: boolean | null
  blocking_issues?: unknown
  verified_at?: string | null
}

type CachedReadiness = { checkedAt: number; row: ReadinessRow }
let cachedReadiness: CachedReadiness | null = null

export class PlatformSchemaNotReadyError extends Error {
  readonly code = 'platform_schema_not_ready'
  readonly status = 503
  readonly details: unknown

  constructor(message: string, details?: unknown) {
    super(message)
    this.name = 'PlatformSchemaNotReadyError'
    this.details = details
  }
}

function missingSchema(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? '')
  const message = String((error as { message?: unknown } | null)?.message ?? '')
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist/i.test(message)
}

function migrationOrdinal(version: string | null | undefined): bigint | null {
  const match = /^(\d{14})/.exec(String(version ?? '').trim())
  if (!match) return null
  try {
    return BigInt(match[1])
  } catch {
    return null
  }
}

export function isCompatiblePlatformSchema(actualVersion: string | null | undefined): boolean {
  const required = migrationOrdinal(REQUIRED_PLATFORM_SCHEMA_VERSION)
  const actual = migrationOrdinal(actualVersion)
  return required !== null && actual !== null && actual >= required
}

async function loadReadinessRow(): Promise<ReadinessRow> {
  const now = Date.now()
  if (cachedReadiness && now - cachedReadiness.checkedAt < READINESS_CACHE_TTL_MS) {
    return cachedReadiness.row
  }

  const { data, error } = await supabaseService
    .from('platform_schema_state')
    .select('current_version,is_ready,blocking_issues,verified_at')
    .eq('id', true)
    .maybeSingle()

  if (error) {
    cachedReadiness = null
    if (missingSchema(error)) {
      throw new PlatformSchemaNotReadyError(
        'Databasen saknar Gridex integritetsmigration. Kör samtliga migrationer innan trafik eller automation aktiveras.',
      )
    }
    throw error
  }

  const row = (data ?? {}) as ReadinessRow
  cachedReadiness = { checkedAt: now, row }
  return row
}

export function invalidatePlatformSchemaReadinessCache(): void {
  cachedReadiness = null
}

export async function assertPlatformSchemaReady(): Promise<void> {
  const row = await loadReadinessRow()
  if (row.is_ready !== true || !isCompatiblePlatformSchema(row.current_version)) {
    throw new PlatformSchemaNotReadyError('Databasschemat är inte verifierat för aktuell Gridex-version.', {
      minimum_version: REQUIRED_PLATFORM_SCHEMA_VERSION,
      actual_version: row.current_version ?? null,
      is_ready: row.is_ready ?? false,
      blocking_issues: row.blocking_issues ?? [],
      verified_at: row.verified_at ?? null,
    })
  }
}
