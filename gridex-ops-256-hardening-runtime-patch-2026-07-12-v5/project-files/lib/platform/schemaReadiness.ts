import { supabaseService } from '@/lib/supabase/service'

export const REQUIRED_PLATFORM_SCHEMA_VERSION = '20260712100000-gridex-end-to-end-integrity-hardening'

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

export async function assertPlatformSchemaReady(): Promise<void> {
  const { data, error } = await supabaseService
    .from('platform_schema_state')
    .select('current_version,is_ready,blocking_issues,verified_at')
    .eq('id', true)
    .maybeSingle()

  if (error) {
    if (missingSchema(error)) {
      throw new PlatformSchemaNotReadyError(
        'Databasen saknar Gridex integritetsmigration. Kör samtliga migrationer innan trafik eller automation aktiveras.',
      )
    }
    throw error
  }

  const row = data as {
    current_version?: string | null
    is_ready?: boolean | null
    blocking_issues?: unknown
    verified_at?: string | null
  } | null

  if (!row || row.is_ready !== true || row.current_version !== REQUIRED_PLATFORM_SCHEMA_VERSION) {
    throw new PlatformSchemaNotReadyError('Databasschemat är inte verifierat för aktuell Gridex-version.', {
      expected_version: REQUIRED_PLATFORM_SCHEMA_VERSION,
      actual_version: row?.current_version ?? null,
      is_ready: row?.is_ready ?? false,
      blocking_issues: row?.blocking_issues ?? [],
      verified_at: row?.verified_at ?? null,
    })
  }
}
