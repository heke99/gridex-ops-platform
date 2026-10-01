import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { inspect } from 'node:util'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { technicalErrorDiagnostic } from '@/lib/logging/technicalError'

const native = readFileSync(resolve('scripts/manual-email-fair-claim-20261001-native.test.ts'), 'utf8')
const start = native.indexOf('function sql<'), end = native.indexOf('\ntype Claim =', start)
if (start < 0 || end <= start || native.indexOf('function sql<', start + 1) !== -1) throw new Error('unique_actual_sql_wrapper_required')
const emitted = ts.transpileModule(native.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
const diagnosticPath = resolve('scripts/helpers/manual-email-native-sql-diagnostic-20261001.ts')
let diagnostic: unknown
if (existsSync(diagnosticPath) && native.includes("from './helpers/manual-email-native-sql-diagnostic-20261001'")) {
  const exports: Record<string, unknown> = {}
  const helper = ts.transpileModule(readFileSync(diagnosticPath, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  new Function('require', 'exports', helper)((name: string) => {
    if (name !== '@/lib/logging/technicalError') throw new Error('unexpected_diagnostic_dependency')
    return { technicalErrorDiagnostic }
  }, exports)
  diagnostic = exports.manualEmailNativeSqlFailure
}
type Result = { status: number | null; stdout: string; stderr: string; error?: Error }
function actualWrapper(result: Result | (() => never)) {
  const calls: unknown[][] = [], logs: unknown[][] = []
  const sql = new Function('spawnSync', 'writeFileSync', 'join', 'directory', 'db', 'manualEmailNativeSqlFailure',
    'let sqlNumber=0;\n' + emitted + ';return sql;')(
    (...args: unknown[]) => { calls.push(args); return typeof result === 'function' ? result() : result },
    (...args: unknown[]) => { logs.push(args) },
    (...args: string[]) => args.join('/'), '/private', 'synthetic-local-db', diagnostic,
  ) as (command: string, stage?: unknown) => unknown
  return { sql, calls, logs }
}
const canary = 'SYN_PRIVATE mail@example.invalid token=SYN_OPAQUE SQL BODY SYN_FINANCE'
function failure(call: () => unknown): Error & { code?: string } {
  try { call() } catch (error) { return error as Error & { code?: string } }
  throw new Error('expected_failed_sql_wrapper')
}
const cases = [
  ['syntax SQLSTATE', 'ERROR: 42601\nDETAIL: ' + canary, '42601'],
  ['preserved late fault', 'psql:/private/fixture.sql:9: ERROR: P0001\nCONTEXT: ' + canary, 'P0001'],
  ['arbitrary primary text', 'ERROR: KARIN', 'unknown'],
  ['duplicate primaries', 'ERROR: 42601\nFATAL: 08006', 'unknown'],
  ['forged detail text', 'DETAIL: ERROR: 42601\n' + canary, 'unknown'],
  ['primary with private trailing text', 'ERROR: 42601 ' + canary, 'unknown'],
  ['success SQLSTATE rejected as failure', 'ERROR: 00000', 'unknown'],
  ['oversized private output', 'ERROR: 42601\n' + 'x'.repeat(65_536), 'unknown'],
] as const

describe('actual native SQL wrapper with controlled process and private file boundaries', () => {
  for (const [label, stderr, code] of cases) {
    it(label, () => {
      const f = actualWrapper({ status: 1, stdout: canary, stderr })
      const error = failure(() => f.sql(canary, 'other_rows_snapshot'))
      expect(error.message).toBe(`manual_email_native_sql_failed_private_context_${code} stage=other_rows_snapshot`)
      expect(error.code).toBe(code)
      expect(inspect(error, { showHidden: true })).not.toContain(canary)
      expect(Object.getOwnPropertyNames(error)).toEqual(['stack', 'message', 'code'])
      expect(f.logs).toEqual([['/private/1.log', canary + stderr, { mode: 0o600 }]])
    })
  }
  it('successful JSON retains exact psql gates, timeout and private logging', () => {
    const f = actualWrapper({ status: 0, stdout: '{"saved":true}', stderr: '' })
    expect(f.sql(canary)).toEqual({ saved: true })
    expect(f.calls).toEqual([['psql', ['synthetic-local-db', '-XAtq', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate'],
      { input: canary, encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024 }]])
    expect(f.logs).toEqual([['/private/1.log', '{"saved":true}', { mode: 0o600 }]])
  })
  it('malformed successful output cannot expose a JSON parser private excerpt', () => {
    const f = actualWrapper({ status: 0, stdout: canary, stderr: '' })
    const error = failure(() => f.sql(canary))
    expect(error.message).toBe('manual_email_native_sql_failed_private_context_unknown stage=native_sql')
    expect(inspect(error, { showHidden: true })).not.toContain(canary)
  })
  it('spawn exceptions and arbitrary stages project only closed failure fields', () => {
    const f = actualWrapper(() => { throw new Error(canary) })
    const error = failure(() => f.sql(canary, canary))
    expect(error.message).toBe('manual_email_native_sql_failed_private_context_unknown stage=UNKNOWN')
    expect(error.code).toBe('unknown')
    expect(inspect(error, { showHidden: true })).not.toContain(canary)
    expect(f.logs).toEqual([])
  })
})
