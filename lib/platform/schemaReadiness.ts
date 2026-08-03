import { supabaseService } from '@/lib/supabase/service'

/**
 * Runtime traffic is gated by the live database capabilities required by the
 * deployed API. Migration-ledger history is audited separately and never
 * creates a time-based production outage.
 */
export const REQUIRED_PLATFORM_SCHEMA_VERSION =
  '20260803093300-gridex-runtime-schema-capabilities-v3'
export const PLATFORM_RUNTIME_CAPABILITY_VIEW =
  'gridex_runtime_schema_capabilities_v3'
export const EXPECTED_PLATFORM_SCHEMA_FINGERPRINT =
  'cd64e1d6153619440cd878531d26b83b631680801ad517c07f92f99617a40f6a'

const READINESS_CACHE_TTL_MS = 30_000
const SHA256_PATTERN = /^[a-f0-9]{64}$/

type ReadinessRow = {
  is_ready?: boolean | null
  blocking_issues?: unknown
  schema_fingerprint?: string | null
  capabilities?: unknown
  evaluated_at?: string | null
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
  return (
    ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code) ||
    /schema cache|does not exist|column .* does not exist/i.test(message)
  )
}

export function isVerifiedSchemaFingerprint(
  fingerprint: string | null | undefined,
): boolean {
  return SHA256_PATTERN.test(String(fingerprint ?? '').trim())
}

async function loadReadinessRow(): Promise<ReadinessRow> {
  const now = Date.now()
  if (
    cachedReadiness &&
    now - cachedReadiness.checkedAt < READINESS_CACHE_TTL_MS
  ) {
    return cachedReadiness.row
  }

  const { data, error } = await supabaseService
    .from(PLATFORM_RUNTIME_CAPABILITY_VIEW)
    .select(
      'is_ready,schema_fingerprint,blocking_issues,capabilities,evaluated_at',
    )
    .maybeSingle()

  if (error) {
    cachedReadiness = null
    if (missingSchema(error)) {
      throw new PlatformSchemaNotReadyError(
        'Databasen saknar Gridex runtime capability gate v3. Kör de framåtriktade readiness-migrationerna före applikationsdeploy.',
        {
          minimum_version: REQUIRED_PLATFORM_SCHEMA_VERSION,
          required_view: PLATFORM_RUNTIME_CAPABILITY_VIEW,
        },
      )
    }
    throw error
  }

  if (!data) {
    cachedReadiness = null
    throw new PlatformSchemaNotReadyError(
      'Databasens runtime capability gate returnerade ingen verifieringsrad.',
      {
        minimum_version: REQUIRED_PLATFORM_SCHEMA_VERSION,
        required_view: PLATFORM_RUNTIME_CAPABILITY_VIEW,
      },
    )
  }

  const row = data as ReadinessRow
  cachedReadiness = { checkedAt: now, row }
  return row
}

export function invalidatePlatformSchemaReadinessCache(): void {
  cachedReadiness = null
}

export async function assertPlatformSchemaReady(): Promise<void> {
  const row = await loadReadinessRow()
  const verifiedFingerprint = isVerifiedSchemaFingerprint(row.schema_fingerprint)
  const expectedFingerprint =
    String(row.schema_fingerprint ?? '').trim() === EXPECTED_PLATFORM_SCHEMA_FINGERPRINT

  if (row.is_ready !== true || !verifiedFingerprint || !expectedFingerprint) {
    throw new PlatformSchemaNotReadyError(
      'Databasschemat saknar en eller flera verifierade Gridex runtime-capabilities.',
      {
        minimum_version: REQUIRED_PLATFORM_SCHEMA_VERSION,
        required_view: PLATFORM_RUNTIME_CAPABILITY_VIEW,
        is_ready: row.is_ready ?? false,
        schema_fingerprint_verified: verifiedFingerprint,
        schema_fingerprint_matches_release: expectedFingerprint,
        expected_schema_fingerprint: EXPECTED_PLATFORM_SCHEMA_FINGERPRINT,
        schema_fingerprint: row.schema_fingerprint ?? null,
        blocking_issues: row.blocking_issues ?? [],
        capabilities: row.capabilities ?? {},
        evaluated_at: row.evaluated_at ?? null,
      },
    )
  }
}
