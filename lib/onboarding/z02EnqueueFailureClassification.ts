import * as nodeUtil from 'node:util'

type SqlState = '23502' | '23503' | '23505' | '23514' | '42501' | '42P01' | '42703' | 'P0001' | '22P02' | '42883' | 'unknown'
type PublicLabel = 'active_request_snapshot_unavailable' | 'original_snapshot_schema_unavailable' | 'automation_job_schema_unavailable' | 'persisted_operation_snapshot_schema_unavailable' | 'unknown'

export type Z02EnqueueFailureClassification = {
  schemaVersion: 1
  sqlState: SqlState
  publicLabel: PublicLabel
}

function sqlState(value: unknown): SqlState {
  switch (value) {
    case '23502': case '23503': case '23505': case '23514': case '42501':
    case '42P01': case '42703': case 'P0001': case '22P02': case '42883':
      return value
    default: return 'unknown'
  }
}

function publicLabel(value: unknown): PublicLabel {
  switch (value) {
    case 'Det inkommande svaret saknar en aktiv requestsnapshot. Svaret måste granskas manuellt innan kunddata kan uppdateras.':
      return 'active_request_snapshot_unavailable'
    case 'Operationssnapshot saknas. Kör den senaste OPS-migrationen innan inkommande svar appliceras.':
      return 'original_snapshot_schema_unavailable'
    case 'Automationstabellen saknas. Kör migrationen för kundautomation först.':
      return 'automation_job_schema_unavailable'
    case 'Operationssnapshot saknas. Kör den senaste OPS-migrationen innan extern kommunikation startas.':
      return 'persisted_operation_snapshot_schema_unavailable'
    default: return 'unknown'
  }
}

// Diagnostic evidence only. Never coerce an error or inspect its prototype,
// cause, detail or other private fields. The existing catch owns legacy text.
export function classifyZ02EnqueueFailure(error: unknown): Z02EnqueueFailureClassification {
  const unknown: Z02EnqueueFailureClassification = { schemaVersion: 1, sqlState: 'unknown', publicLabel: 'unknown' }
  try {
    // Existing isolated source bridges intentionally omit types. Do not inspect
    // untrusted properties unless this trap-free Node capability is available.
    if (typeof nodeUtil.types?.isProxy !== 'function') return unknown
    if (error === null || typeof error !== 'object' || nodeUtil.types.isProxy(error)) return unknown
    if (Array.isArray(error)) return unknown
    const code = Object.getOwnPropertyDescriptor(error, 'code')
    const message = Object.getOwnPropertyDescriptor(error, 'message')
    return {
      schemaVersion: 1,
      sqlState: sqlState(code && 'value' in code ? code.value : undefined),
      publicLabel: publicLabel(message && 'value' in message ? message.value : undefined),
    }
  } catch {
    return unknown
  }
}
