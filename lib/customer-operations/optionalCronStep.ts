const UNDEPLOYED_SCHEMA_CODES = new Set(['PGRST202', 'PGRST205', '42883', '42P01', '3F000'])

/** True only when the database lacks the object (function/table/schema) the
 * step needs, i.e. its migration is not deployed yet. Real failures rethrow. */
export function isUndeployedSchemaError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && UNDEPLOYED_SCHEMA_CODES.has(code)
}

/** Runs one independent cron step. A step whose database objects are not
 * deployed is skipped and reported, so it cannot stop unrelated steps such as
 * POA expiry or supplier-switch activation. Any other error still fails. */
export async function runOptionalStep<T extends object>(
  name: string,
  step: () => Promise<T>,
  skipped: T,
): Promise<T & { skippedReason?: 'schema_not_deployed' }> {
  try {
    return await step()
  } catch (error) {
    if (!isUndeployedSchemaError(error)) throw error
    console.warn('[customer-operations-cron] step skipped: schema not deployed', {
      step: name,
      code: (error as { code?: string }).code,
      message: (error as { message?: string }).message,
    })
    return { ...skipped, skippedReason: 'schema_not_deployed' as const }
  }
}
