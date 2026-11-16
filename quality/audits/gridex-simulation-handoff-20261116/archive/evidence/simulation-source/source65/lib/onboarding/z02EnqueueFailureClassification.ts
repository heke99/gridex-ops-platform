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

// Separate SDK evidence. Existing schema1 SQL/public classification is unchanged.
export const z02EnqueueSdkCodes = [
  '23502', '23503', '23505', '23514', '42501', '42P01', '42703', 'P0001', '22P02', '42883',
  '21000', '22023', 'XX000', 'P0002', 'P0003', '40001', '40P01',
  'PGRST116', 'PGRST200', 'PGRST201', 'PGRST202', 'PGRST203', 'PGRST204', 'PGRST205',
] as const
export type Z02EnqueueSdkEvidence = {
  schemaVersion: 1
  sdkCode: typeof z02EnqueueSdkCodes[number] | 'unlisted' | 'unavailable'
}
export function classifyZ02EnqueueFailureSdkEvidence(error: unknown): Z02EnqueueSdkEvidence {
  const unavailable: Z02EnqueueSdkEvidence = { schemaVersion: 1, sdkCode: 'unavailable' }
  try {
    if (typeof nodeUtil.types?.isProxy !== 'function') return unavailable
    if (error === null || typeof error !== 'object' || nodeUtil.types.isProxy(error) || Array.isArray(error)) return unavailable
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code')
    if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'string') return unavailable
    const sdkCode = (z02EnqueueSdkCodes as readonly string[]).includes(descriptor.value)
      ? descriptor.value as typeof z02EnqueueSdkCodes[number] : 'unlisted'
    return { schemaVersion: 1, sdkCode }
  } catch {
    return unavailable
  }
}

// Fixed sibling diagnostics only. Never recode historical schema1 SDK evidence.
export const z02EnqueueSdkSupplementCodes = [
  'empty_sdk_code', '57014', '55P03', 'PGRST000', 'PGRST001', 'PGRST002', '22001',
  'retained_sdk_code', 'other_unlisted', 'unavailable',
] as const
export type Z02EnqueueSdkSupplementEvidence = {
  schemaVersion: 1
  sdkCode: typeof z02EnqueueSdkSupplementCodes[number]
}
export function classifyZ02EnqueueFailureSdkSupplementEvidence(error: unknown): Z02EnqueueSdkSupplementEvidence {
  const unavailable: Z02EnqueueSdkSupplementEvidence = { schemaVersion: 1, sdkCode: 'unavailable' }
  try {
    if (typeof nodeUtil.types?.isProxy !== 'function') return unavailable
    if (error === null || typeof error !== 'object' || nodeUtil.types.isProxy(error) || Array.isArray(error)) return unavailable
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code')
    if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'string') return unavailable
    switch (descriptor.value) {
      case '': return { schemaVersion: 1, sdkCode: 'empty_sdk_code' }
      case '57014': case '55P03': case 'PGRST000': case 'PGRST001': case 'PGRST002': case '22001':
        return { schemaVersion: 1, sdkCode: descriptor.value }
      default: return { schemaVersion: 1, sdkCode: (z02EnqueueSdkCodes as readonly string[]).includes(descriptor.value)
        ? 'retained_sdk_code' : 'other_unlisted' }
    }
  } catch {
    return unavailable
  }
}

export const z02EnqueueDiagnosticPorts = [
  'original_snapshot_select', 'job_insert', 'duplicate_job_select', 'snapshot_upsert',
] as const
export type Z02EnqueueDiagnosticPort = typeof z02EnqueueDiagnosticPorts[number]
export type Z02EnqueueDiagnosticPortObserver = (port: Z02EnqueueDiagnosticPort, error: unknown) => void
// The fresh input object is the invocation key. No request/error property or
// import/capability is added; concurrent input identities remain separate.
const z02EnqueueDiagnosticScopes = new WeakMap<object, { observer: Z02EnqueueDiagnosticPortObserver | undefined }>()
export async function withZ02EnqueueDiagnosticPortWitness<T>(input: object,
  operation: () => Promise<T>, observer: Z02EnqueueDiagnosticPortObserver): Promise<T> {
  // Reused identities cannot attest which invocation failed. Suppress both
  // observers, including callbacks already passed to lower port consumers.
  const previous = z02EnqueueDiagnosticScopes.get(input)
  if (previous) { previous.observer = undefined; return operation() }
  const scope = { observer: observer as Z02EnqueueDiagnosticPortObserver | undefined }
  z02EnqueueDiagnosticScopes.set(input, scope)
  try { return await operation() } finally {
    if (z02EnqueueDiagnosticScopes.get(input) === scope) z02EnqueueDiagnosticScopes.delete(input)
  }
}
export function z02EnqueueDiagnosticPortObserver(input: object): Z02EnqueueDiagnosticPortObserver | undefined {
  const scope = z02EnqueueDiagnosticScopes.get(input)
  if (!scope?.observer) return undefined
  return (port, error) => { scope.observer?.(port, error) }
}
export function z02EnqueueDiagnosticPortEvidence(port: unknown): {
  schemaVersion: 1; operationPort: Z02EnqueueDiagnosticPort | 'unavailable'
} {
  return { schemaVersion: 1, operationPort: typeof port === 'string'
    && (z02EnqueueDiagnosticPorts as readonly string[]).includes(port) ? port as Z02EnqueueDiagnosticPort : 'unavailable' }
}
