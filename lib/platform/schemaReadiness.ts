import { supabaseService } from '@/lib/supabase/service'

/**
 * Runtime traffic is gated by the live database capabilities required by the
 * deployed API. Migration-ledger history is audited separately and never
 * creates a time-based production outage.
 */
export const REQUIRED_PLATFORM_SCHEMA_VERSION =
  '20260803093300-gridex-runtime-readiness-v3'
export const PLATFORM_RUNTIME_CAPABILITY_VIEW =
  'gridex_runtime_schema_capabilities_v3'
export const PLATFORM_RUNTIME_FINGERPRINT_POLICY =
  'capability_evidence_sha256' as const

const READINESS_CACHE_TTL_MS = 30_000
const SHA256_PATTERN = /^[a-f0-9]{64}$/

export type PlatformSchemaReadinessEvidence = {
  is_ready?: boolean | null
  blocking_issues?: unknown
  schema_fingerprint?: string | null
  capabilities?: unknown
  evaluated_at?: string | null
}

type ReadinessRow = PlatformSchemaReadinessEvidence

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

/**
 * Runtime traffic is governed by the explicit capability result from the
 * versioned database view. The fingerprint is retained as tamper-evident
 * deployment evidence, but is deliberately not compared with one hard-coded
 * whole-schema hash: compatible additive columns must not cause a production
 * outage when every required relation, column, function, RLS policy and ACL is
 * still present.
 */
function hasNoBlockingIssues(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0
}

export function evaluatePlatformSchemaReadiness(
  row: PlatformSchemaReadinessEvidence,
): {
  ready: boolean
  schemaFingerprintVerified: boolean
  blockingIssuesVerified: boolean
} {
  const schemaFingerprintVerified = isVerifiedSchemaFingerprint(
    row.schema_fingerprint,
  )
  const blockingIssuesVerified = hasNoBlockingIssues(row.blocking_issues)

  return {
    ready:
      row.is_ready === true &&
      schemaFingerprintVerified &&
      blockingIssuesVerified,
    schemaFingerprintVerified,
    blockingIssuesVerified,
  }
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
  const evaluation = evaluatePlatformSchemaReadiness(row)

  if (!evaluation.ready) {
    throw new PlatformSchemaNotReadyError(
      'Databasschemat saknar en eller flera verifierade Gridex runtime-capabilities.',
      {
        minimum_version: REQUIRED_PLATFORM_SCHEMA_VERSION,
        required_view: PLATFORM_RUNTIME_CAPABILITY_VIEW,
        fingerprint_policy: PLATFORM_RUNTIME_FINGERPRINT_POLICY,
        is_ready: row.is_ready ?? false,
        schema_fingerprint_verified:
          evaluation.schemaFingerprintVerified,
        schema_fingerprint: row.schema_fingerprint ?? null,
        blocking_issues: row.blocking_issues ?? [],
        capabilities: row.capabilities ?? {},
        evaluated_at: row.evaluated_at ?? null,
      },
    )
  }
}
