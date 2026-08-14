import { supabaseService } from '@/lib/supabase/service'
import { classifyDependencyError, DependencyError } from '@/lib/runtime/dependencyErrors'

export async function withDependencyCircuit<T>(dependencyKey: string, operation: () => Promise<T>): Promise<T> {
  const before = await supabaseService.rpc('gridex_dependency_circuit_before_request_v1', {
    p_dependency_key: dependencyKey,
    p_probe_lease_seconds: 30,
  })
  if (before.error) throw before.error
  const gate = (Array.isArray(before.data) ? before.data[0] : before.data) as { allowed?: boolean } | null
  if (!gate?.allowed) throw new DependencyError('dependency_unavailable', 'Dependency circuit är tillfälligt öppen.')
  try {
    const result = await operation()
    try {
      await supabaseService.rpc('gridex_dependency_circuit_record_v1', {
        p_dependency_key: dependencyKey, p_outcome: 'success', p_error_code: null,
        p_failure_threshold: 5, p_open_seconds: 60,
      })
    } catch {
      // A completed dependency call must still return to the caller. Circuit
      // success telemetry is best-effort and must never fail-closed over it.
    }
    return result
  } catch (error) {
    const classified = classifyDependencyError(error)
    try {
      await supabaseService.rpc('gridex_dependency_circuit_record_v1', {
        p_dependency_key: dependencyKey, p_outcome: 'failure',
        p_error_code: classified?.code ?? (error instanceof Error ? error.name : 'unknown'),
        p_failure_threshold: 5, p_open_seconds: 60,
      })
    } catch {
      // The original dependency error remains authoritative. Circuit telemetry
      // must never replace it or cause a durable queue item to be lost.
    }
    throw classified ?? error
  }
}
