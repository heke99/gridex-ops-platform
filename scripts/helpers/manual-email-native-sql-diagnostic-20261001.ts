import { technicalErrorDiagnostic } from '@/lib/logging/technicalError'

export type ManualEmailNativeSqlStage = 'native_sql' | 'other_rows_snapshot'

/** Only a unique SQLSTATE-only psql primary and closed stage leave the private log. */
export function manualEmailNativeSqlFailure(stderr: unknown, stage: unknown): { code: string; message: string } {
  let code = 'unknown'
  try {
    const text = typeof stderr === 'string' ? stderr : Buffer.isBuffer(stderr) ? stderr.toString('utf8') : ''
    if (Buffer.byteLength(text) <= 65_536) {
      const lines = text.split(/\r?\n/).filter(line => /^(?:psql:.*?:\d+: )?(?:ERROR|FATAL|PANIC):/.test(line))
      if (lines.length === 1) {
        const candidate = lines[0].match(/^(?:psql:.*?:\d+: )?(?:ERROR|FATAL|PANIC):\s+([0-9A-Z]{5})\s*$/)?.[1]
        const safe = technicalErrorDiagnostic({ code: candidate })
        if (candidate && candidate !== '00000' && safe.message === 'database_error' && safe.code?.length === 5) code = candidate
      }
    }
  } catch { /* Malformed output has no private fallback. */ }
  const safeStage = stage === 'native_sql' || stage === 'other_rows_snapshot' ? stage : 'UNKNOWN'
  return { code, message: `manual_email_native_sql_failed_private_context_${code} stage=${safeStage}` }
}
