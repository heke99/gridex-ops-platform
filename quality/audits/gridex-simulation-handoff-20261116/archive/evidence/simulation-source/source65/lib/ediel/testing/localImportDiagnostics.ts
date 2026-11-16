import { createHash } from 'node:crypto'

export type LocalImportDiagnosticStage =
  | 'ACTION_GUARD' | 'READ_INPUT_FIELDS' | 'READ_FILE' | 'HASH_FILE'
  | 'RECEIVE_REPLAY' | 'ASSERT_ATTESTED_BASIS' | 'CANONICAL_RAW_IMPORT'
  | 'RESULT_FORMAT' | 'SDK_RPC'

const stages = new Set<LocalImportDiagnosticStage>([
  'ACTION_GUARD', 'READ_INPUT_FIELDS', 'READ_FILE', 'HASH_FILE',
  'RECEIVE_REPLAY', 'ASSERT_ATTESTED_BASIS', 'CANONICAL_RAW_IMPORT', 'RESULT_FORMAT', 'SDK_RPC',
])
const operations = new Set([
  'gridex_issue_local_simulation_run_v1', 'gridex_receive_local_simulation_source_v1',
  'gridex_prepare_local_simulation_contract_v1', 'gridex_attest_local_simulation_contract_v1',
  'gridex_assert_local_simulation_admission_v1', 'gridex_assert_local_simulation_basis_v1',
  'gridex_execute_local_simulation_command_v1', 'gridex_revoke_local_simulation_run_v1',
])
const events = new Set(['enter', 'complete', 'error', 'rpc_start', 'rpc_result'])
const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
let sequence = 0

/** No raw messages, stack, values, args, headers, body, IDs or credentials. */
export function localImportErrorShape(error: unknown): Record<string, unknown> {
  const object = error !== null && typeof error === 'object' ? error : null
  const fields: Record<string, unknown> = {}
  for (const key of ['message', 'error_description', 'error', 'code', 'details', 'hint', 'status', 'statusText']) {
    const descriptor = object ? Object.getOwnPropertyDescriptor(object, key) : undefined
    if (!descriptor) { fields[key] = { present: false }; continue }
    if (!('value' in descriptor)) { fields[key] = { present: true, accessorNotInvoked: true }; continue }
    const value: unknown = descriptor.value
    fields[key] = typeof value === 'string'
      ? { present: true, type: 'string', length: value.length, sha256: digest(value) }
      : { present: true, type: value === null ? 'null' : typeof value }
    if (key === 'code' && typeof value === 'string' && /^(?:[A-Z0-9]{5}|PGRST[0-9]{3})$/.test(value)) {
      fields.code = { present: true, type: 'string', length: value.length, sha256: digest(value), sqlstateOrPgrstCode: value }
    }
  }
  return { type: error === null ? 'null' : typeof error, errorInstance: error instanceof Error,
    primitiveString: typeof error === 'string' ? { length: error.length, sha256: digest(error) } : null, fields }
}

/** Private Node stderr only; never forward console payloads into the browser. */
export function recordLocalImportDiagnostic(input: {
  stage: LocalImportDiagnosticStage
  event: 'enter' | 'complete' | 'error' | 'rpc_start' | 'rpc_result'
  operation?: string
  status?: unknown
  statusText?: unknown
  error?: unknown
}): void {
  try {
    if (!stages.has(input.stage) || !events.has(input.event) || (input.operation !== undefined && !operations.has(input.operation))) return
    process.stderr.write(JSON.stringify({
      kind: 'LOCAL_IMPORT_PRIVATE_DIAGNOSTIC_V1', sequence: ++sequence,
      observedAtUtc: new Date().toISOString(), pid: process.pid, stage: input.stage, event: input.event,
      operation: input.operation ?? null,
      status: typeof input.status === 'number' && Number.isInteger(input.status) && input.status >= 0 && input.status <= 599 ? input.status : null,
      statusText: typeof input.statusText === 'string' ? { length: input.statusText.length, sha256: digest(input.statusText) } : null,
      error: input.error == null ? null : localImportErrorShape(input.error),
      diagnosticOnlyNoAuthority: true,
    }) + '\n')
  } catch { /* A diagnostic failure must never change the original operation. */ }
}
