import { technicalErrorDiagnostic } from '@/lib/logging/technicalError'

const stages = ['customer_sql', 'lifecycle_cleanup_fault', 'lifecycle_cleanup_decisions',
  'lifecycle_cleanup_cases', 'lifecycle_cleanup_contracts', 'lifecycle_cleanup_customers',
  'lifecycle_cleanup_companies'] as const
export type CustomerProofSqlStage = typeof stages[number]
const allowedStages = new Set<string>(stages)

/** Strict child-protocol projection. No message/details/context/SQL, filenames,
 * commands, stdout, credentials or arbitrary caller stage are returned. */
export function customerProofSqlFailure(error: unknown, stage: unknown): string {
  let sqlstate = 'UNKNOWN'
  try {
    const stderr = error && typeof error === 'object' ? (error as { stderr?: unknown }).stderr : null
    const text = typeof stderr === 'string' ? stderr : Buffer.isBuffer(stderr) ? stderr.toString('utf8') : ''
    if (Buffer.byteLength(text) <= 65_536) {
      const errors = text.split(/\r?\n/).filter(line => /^(?:psql:.*?:\d+: )?(?:ERROR|FATAL|PANIC):/.test(line))
      if (errors.length === 1) {
        const code = errors[0].match(/^(?:psql:.*?:\d+: )?(?:ERROR|FATAL|PANIC):\s+([0-9A-Z]{5})\s*$/)?.[1]
        // Recognized SQLSTATE classes plus the existing PTnnn SQL HTTP state;
        // free five-letter customer text is not a technical namespace.
        const diagnostic = technicalErrorDiagnostic({ code })
        if (code && code !== '00000' && ((diagnostic.message === 'database_error' && diagnostic.code?.length === 5) || /^PT\d{3}$/.test(code))) sqlstate = code
      }
    }
  } catch { /* An unknown or malformed process object yields no raw fallback. */ }
  const safeStage = typeof stage === 'string' && allowedStages.has(stage) ? stage : 'UNKNOWN'
  return `customer_api_proof_database_failed stage=${safeStage} sqlstate=${sqlstate}`
}
