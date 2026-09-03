export type Z02AtomicRecord = Record<string, unknown>

function record(value: unknown): Z02AtomicRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Z02AtomicRecord
    : {}
}

/**
 * Accept DB-owned Z02 masterdata only when every canonical gate left
 * explicit proof on the durable job result.
 */
export function canonicalAtomicZ02JobResult(result: Z02AtomicRecord | null): Z02AtomicRecord | null {
  const root = record(result)
  const core = record(root.z02_atomic_core)
  if (
    root.z02_correlation_status !== 'exact' ||
    root.z02_payload_validation_status !== 'valid' ||
    root.z02_snapshot_freshness_status !== 'valid' ||
    root.z02_atomic_core_applied !== true ||
    core.ok !== true
  ) return null
  return core
}
