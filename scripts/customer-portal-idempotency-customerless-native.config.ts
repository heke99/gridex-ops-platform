import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import sourceOwner from './ediel-source-owner-native.config'

// Donor a5fccdc4 supplied the focused include/serial source-owner inheritance.
// Admission now precedes collection and every inherited permission fixture.
const ROOT = resolve(__dirname, '..')
const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const hex = (x: unknown, n: number) => typeof x === 'string' && new RegExp(`^[a-f0-9]{${n}}$`).test(x)
function privateFile(path: string | undefined, temp: string): Buffer {
  if (!path || !isAbsolute(path) || resolve(path) !== path || realpathSync(path) !== path ||
      !path.startsWith(temp + '/') || !relative(ROOT, path).startsWith('..')) throw Error('customerless_private_file_required')
  const st = lstatSync(path)
  if (!st.isFile() || st.isSymbolicLink() || st.uid !== process.getuid?.() || (st.mode & 0o077) !== 0 || st.size > 1_048_576) {
    throw Error('customerless_private_file_identity')
  }
  return readFileSync(path)
}

export function qualifyCustomerlessNative(): { phase: 'baseline' | 'upgrade' | 'clean'; baseline: string; target: string } {
  const temp = process.env.RUNNER_TEMP
  if (!temp || !isAbsolute(temp) || resolve(temp) !== temp || realpathSync(temp) !== temp ||
      Object.keys(process.env).some(k => k.startsWith('GIT_')) ||
      ['GH_TOKEN', 'GITHUB_TOKEN', 'CRON_SECRET'].some(k => process.env[k])) throw Error('customerless_native_environment')
  const bytes = privateFile(process.env.GRIDEX_CUSTOMERLESS_ASSIGNMENT, temp)
  const a = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>
  const statusBytes = privateFile(process.env.GRIDEX_NATIVE_STATUS, temp)
  const status = JSON.parse(statusBytes.toString('utf8')) as Record<string, string>
  if (a.schema !== 'customerless-native-assignment-v1' || !['baseline', 'upgrade', 'clean'].includes(String(a.phase)) ||
      !hex(a.targetHead, 40) || !hex(a.targetTree, 40) || !hex(a.baselineHead, 40) ||
      !hex(a.inputSha256, 64) || !hex(a.pairReceipt, 40) || !hex(a.workflowBlob, 40) ||
      !/^[1-9][0-9]*$/.test(String(a.runId)) || a.runId !== process.env.GRIDEX_CUSTOMERLESS_RUN_ID ||
      !Number.isFinite(Date.parse(String(a.expiresAt))) || Date.parse(String(a.expiresAt)) <= Date.now() ||
      Date.parse(String(a.expiresAt)) > Date.now() + 90 * 60_000 ||
      a.attempt !== 1 || a.statusSha256 !== createHash('sha256').update(statusBytes).digest('hex') ||
      a.sourceRoot !== ROOT || a.dbUrl !== DB || status.API_URL !== 'http://127.0.0.1:54321' ||
      !status.ANON_KEY || !status.SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_URL !== status.API_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY !== status.ANON_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY !== status.SERVICE_ROLE_KEY) throw Error('customerless_native_assignment')
  const git = (...args: string[]) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', timeout: 10_000 }).trim()
  if (git('rev-parse', 'HEAD') !== a.targetHead || git('rev-parse', 'HEAD^{tree}') !== a.targetTree ||
      git('status', '--porcelain', '--untracked-files=all')) throw Error('customerless_native_source')
  const actual = JSON.parse(execFileSync('psql', [DB, '-XAtq', '-v', 'ON_ERROR_STOP=1', '-c',
    "SELECT json_build_object('systemIdentifier',(pg_control_system()).system_identifier::text,'postmasterStartedAt',pg_postmaster_start_time()::text,'database',current_database(),'user',current_user,'recovery',pg_is_in_recovery(),'version',current_setting('server_version_num')::int);"],
  { encoding: 'utf8', timeout: 10_000 })) as Record<string, unknown>
  if (!/^[0-9]+$/.test(String(a.systemIdentifier)) || actual.systemIdentifier !== a.systemIdentifier ||
      actual.postmasterStartedAt !== a.postmasterStartedAt || actual.database !== 'postgres' || actual.user !== 'postgres' ||
      actual.recovery !== false || Number(actual.version) < 170000 || Number(actual.version) >= 180000) {
    throw Error('customerless_native_database_identity')
  }
  const secretPath = typeof a.privateSecretsPath === 'string' ? a.privateSecretsPath : undefined
  const secretBytes = privateFile(secretPath, temp)
  if (secretBytes.length !== 0 || secretPath === process.env.GRIDEX_NATIVE_STATUS || secretPath === process.env.GRIDEX_CUSTOMERLESS_ASSIGNMENT || secretPath === a.retainedPath) {
    throw Error('customerless_native_private_outputs')
  }
  process.env.GRIDEX_CUSTOMERLESS_SECRET_VALUES = secretPath
  if (a.phase === 'baseline') {
    const output = a.retainedPath
    if (typeof output !== 'string' || !isAbsolute(output) || resolve(output) !== output || !output.startsWith(temp + '/') || realpathSync(dirname(output)) !== dirname(output)) {
      throw Error('customerless_native_retained_output')
    }
    try { lstatSync(output); throw Error('customerless_native_retained_output_exists') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    process.env.GRIDEX_CUSTOMERLESS_RETAINED = output
  }
  if (a.phase === 'upgrade') {
    const retained = privateFile(typeof a.retainedPath === 'string' ? a.retainedPath : undefined, temp)
    if (!hex(a.retainedSha256, 64) || createHash('sha256').update(retained).digest('hex') !== a.retainedSha256) {
      throw Error('customerless_native_retained_identity')
    }
    process.env.GRIDEX_CUSTOMERLESS_RETAINED = a.retainedPath as string
    process.env.GRIDEX_CUSTOMERLESS_RETAINED_SHA256 = a.retainedSha256 as string
  }
  return { phase: a.phase as 'baseline' | 'upgrade' | 'clean', baseline: a.baselineHead as string, target: a.targetHead as string }
}

const qualified = qualifyCustomerlessNative()
process.env.GRIDEX_CUSTOMERLESS_NATIVE_PHASE = qualified.phase
export default defineConfig({ ...sourceOwner, test: { ...sourceOwner.test,
  include: ['scripts/customer-portal-idempotency-customerless-native.test.ts'],
  fileParallelism: false, testTimeout: 120_000, hookTimeout: 120_000,
} })
