// Track 1 harness runtime helpers: environment, read-only database access,
// run artifacts, step timing, authenticated HTTP against the app under test.
// Nothing here writes to the database. Secrets are never put in artifacts.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createServerClient } from '@supabase/ssr'

export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`track1_env_missing:${name}`)
  return value
}

export function appUrl(): string { return requireEnv('TRACK1_APP_URL').replace(/\/$/, '') }

/** Cookie the app uses to select the company for admin API calls (lib/admin/navigationPreferences.ts:4). */
export const ADMIN_SELECTED_COMPANY_COOKIE = 'gridex_admin_selected_company_id'

// -------------------------------------------------------------- read-only SQL

/**
 * Read-only SQL for receipts and counts. The session is forced read-only, so
 * a mistaken write fails instead of changing the stack. The statement must
 * return exactly one jsonb/scalar value; the result is JSON-parsed.
 */
export function dbRead<T = unknown>(statement: string, maxBuffer = 256 * 1024 * 1024): T {
  const out = execFileSync('psql', [requireEnv('TRACK1_DB_URL'), '-XAtq', '-v', 'ON_ERROR_STOP=1'], {
    input: statement, encoding: 'utf8', timeout: 120_000, maxBuffer,
    env: { ...process.env, PGOPTIONS: '-c default_transaction_read_only=on' },
  }).trim()
  if (out === 't' || out === 'f') return (out === 't') as T
  return (out ? JSON.parse(out) : undefined) as T
}

export const lit = (value: unknown): string => value === null || value === undefined ? 'NULL' : `'${String(typeof value === 'object' ? JSON.stringify(value) : value).replaceAll("'", "''")}'`

// ------------------------------------------------------------------- artifacts

export function runDir(): string {
  const dir = requireEnv('TRACK1_RUN_DIR')
  mkdirSync(dir, { recursive: true })
  return dir
}

const artifactNames = new Set<string>()
/** Write a JSON artifact under TRACK1_RUN_DIR. Callers must not pass secrets/JWTs. */
export function writeArtifact(name: string, data: unknown): string {
  const file = path.join(runDir(), name)
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n')
  artifactNames.add(name)
  return file
}

export function sha256Json(value: unknown): string { return createHash('sha256').update(stableStringify(value)).digest('hex') }

/** Deterministic JSON (sorted keys) for hashing. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}

export type StepTiming = { step: string; ms: number }
export const TIMINGS: StepTiming[] = []
export async function timed<T>(step: string, action: () => Promise<T>): Promise<T> {
  const started = Date.now()
  try { return await action() } finally { TIMINGS.push({ step, ms: Date.now() - started }) }
}

// ------------------------------------------------------------- authenticated HTTP

export type SiteAuthDeadline = { deadlineUtcMs: number; minimumHeadroomSeconds: number; assignmentSha256: string; receiptSha256: string }
export type SiteAuthLifetime = {
  actorUserId: string; observedAtUtcMs: number; tokenExpiresAtUtcMs: number; sdkExpiresAtUtcMs: number; expiresAtUtcMs: number
  businessDeadlineUtcMs: number; minimumHeadroomSeconds: number; assignmentSha256: string; deadlineReceiptSha256: string
}
export type Session = { cookieHeader: string; userId: string; companyId: string; authLifetime?: SiteAuthLifetime }

/** The parent's private launch receipt, not a caller-provided numeric deadline. */
export function readSiteAuthDeadlineFromEnv(): SiteAuthDeadline {
  const fail = () => { throw new Error('site01_auth_deadline_binding') }
  const hash = (raw: Buffer | string) => createHash('sha256').update(raw).digest('hex')
  const read = (filename: string): { bytes: Buffer; value: Record<string, unknown> } => {
    try {
      const st = lstatSync(filename)
      if (!path.isAbsolute(filename) || realpathSync(filename) !== filename || !st.isFile() || st.isSymbolicLink()
        || (st.mode & 0o777) !== 0o600 || !process.getuid || st.uid !== process.getuid()) return fail()
      const bytes = readFileSync(filename)
      const value: unknown = JSON.parse(bytes.toString('utf8'))
      if (!value || typeof value !== 'object' || Array.isArray(value)) return fail()
      return { bytes, value: value as Record<string, unknown> }
    } catch { return fail() }
  }
  const assignmentFile = process.env.TRACK1_ASSIGNMENT_FILE
  const receiptFile = process.env.TRACK1_SITE_AUTH_DEADLINE_FILE
  const receiptSha = process.env.TRACK1_SITE_AUTH_DEADLINE_SHA256
  if (!assignmentFile || !receiptFile || !receiptSha || !/^[a-f0-9]{64}$/.test(receiptSha)) return fail()
  const assignment = read(assignmentFile), r = assignment.value
  if (r.schema !== 'track1-runtime-assignment-site-v1' || r.mode !== 'coordinator_prepared_site'
    || r.reportKind !== 'site_native_v2' || JSON.stringify(r.allowedActions) !== JSON.stringify(['up', 'site-run'])
    || typeof r.simHome !== 'string' || assignmentFile !== path.join(r.simHome, 'assignment.json')
    || typeof r.admissionFile !== 'string' || r.admissionFile !== path.join(r.simHome, 'admission.json')
    || receiptFile !== path.join(r.simHome, 'site-native', 'auth-deadline.json')) return fail()
  const admission = read(r.admissionFile), a = admission.value
  const receipt = read(receiptFile), d = receipt.value
  const launch = read(path.join(r.simHome, 'site-native', 'child-launch.intent.json')).value
  const c = a.siteContract as Record<string, unknown> | undefined
  const assignmentSha256 = hash(assignment.bytes)
  if (a.schema !== 'track1-hosted-site-admission-v1' || a.simHome !== r.simHome || a.reportKind !== 'site_native_v2' || !c
    || c.schema !== 'track1-site-native-contract-v1' || c.inputEpoch !== 'site-native-input-v2'
    || hash(admission.bytes) !== r.admissionSha256 || hash(receipt.bytes) !== receiptSha
    || d.schema !== 'track1-site-auth-deadline-v1' || d.assignmentSha256 !== assignmentSha256
    || d.siteContractSha256 !== r.siteContractSha256 || hash(stableStringify(c) + '\n') !== r.siteContractSha256
    || launch.assignmentSha256 !== assignmentSha256 || launch.authDeadlineSha256 !== receiptSha
    || d.admissionExpiresAtUtc !== a.expiresAtUtc || d.businessBudgetSeconds !== c.businessBudgetSeconds
    || d.minimumHeadroomSeconds !== c.minAuthHeadroomSeconds) return fail()
  const start = d.startedAtUtcMs, deadline = d.deadlineUtcMs, budget = d.businessBudgetSeconds, headroom = d.minimumHeadroomSeconds
  const expiry = typeof a.expiresAtUtc === 'string' ? Date.parse(a.expiresAtUtc) : NaN
  if (typeof start !== 'number' || !Number.isSafeInteger(start) || start <= 0
    || typeof deadline !== 'number' || !Number.isSafeInteger(deadline) || !Number.isSafeInteger(expiry)
    || typeof budget !== 'number' || !Number.isSafeInteger(budget) || budget < 60 || budget > 3600
    || typeof headroom !== 'number' || !Number.isSafeInteger(headroom) || headroom < 120 || headroom > 600
    || deadline !== Math.min(start + budget * 1000, expiry) || start > Date.now() || deadline <= Date.now()
    || typeof d.startedMonotonicNs !== 'string' || !/^[0-9]+$/.test(d.startedMonotonicNs)) return fail()
  const elapsedMs = Number((process.hrtime.bigint() - BigInt(d.startedMonotonicNs)) / BigInt(1_000_000))
  if (elapsedMs < 0 || elapsedMs >= budget * 1000 || Math.abs(Date.now() - start - elapsedMs) >= 5000) return fail()
  return { deadlineUtcMs: deadline, minimumHeadroomSeconds: headroom, assignmentSha256, receiptSha256: receiptSha }
}

function siteAuthLifetime(data: { user?: { id?: string } | null; session: { access_token?: string; expires_at?: number; user?: { id?: string } } }, actor: string, deadline: SiteAuthDeadline): SiteAuthLifetime {
  const fail = () => { throw new Error('site01_auth_session_lifetime') }
  const nowMs = Date.now()
  if (!Number.isSafeInteger(deadline.deadlineUtcMs) || deadline.deadlineUtcMs <= nowMs
    || !Number.isSafeInteger(deadline.minimumHeadroomSeconds) || deadline.minimumHeadroomSeconds < 120 || deadline.minimumHeadroomSeconds > 600
    || !/^[a-f0-9]{64}$/.test(deadline.assignmentSha256) || !/^[a-f0-9]{64}$/.test(deadline.receiptSha256)) return fail()
  let payload: { sub?: unknown; exp?: unknown }
  try {
    const parts = data.session.access_token?.split('.')
    if (!parts || parts.length !== 3 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) return fail()
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as typeof payload
  } catch { return fail() }
  const tokenExp = payload?.exp, sdkExp = data.session.expires_at
  if (data.user?.id !== actor || data.session.user?.id !== actor || payload?.sub !== actor
    || typeof tokenExp !== 'number' || !Number.isSafeInteger(tokenExp) || tokenExp <= 0 || !Number.isSafeInteger(tokenExp * 1000)
    || typeof sdkExp !== 'number' || !Number.isSafeInteger(sdkExp) || sdkExp <= 0 || !Number.isSafeInteger(sdkExp * 1000)) return fail()
  // The installed SDK can synthesize expires_at from expires_in at receipt.
  // A later SDK timestamp can never extend the actual issued JWT's exp.
  const expiresAtUtcMs = Math.min(tokenExp, sdkExp) * 1000
  if (expiresAtUtcMs <= nowMs || expiresAtUtcMs < deadline.deadlineUtcMs + deadline.minimumHeadroomSeconds * 1000) return fail()
  return { actorUserId: actor, observedAtUtcMs: nowMs, tokenExpiresAtUtcMs: tokenExp * 1000, sdkExpiresAtUtcMs: sdkExp * 1000, expiresAtUtcMs,
    businessDeadlineUtcMs: deadline.deadlineUtcMs, minimumHeadroomSeconds: deadline.minimumHeadroomSeconds,
    assignmentSha256: deadline.assignmentSha256, deadlineReceiptSha256: deadline.receiptSha256 }
}

/**
 * Real password login against the stack's auth service, producing exactly the
 * cookies @supabase/ssr sets in a browser. The cookie jar is only held in
 * memory and is never written to an artifact.
 */
export async function signIn(input: { email: string; password: string; userId: string; companyId: string; siteAuthDeadline?: SiteAuthDeadline }): Promise<Session> {
  const jar = new Map<string, string>()
  const { data, error } = await (async () => {
    try {
      const client = createServerClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
        cookies: {
          getAll: () => [...jar].map(([name, value]) => ({ name, value })),
          setAll: list => { for (const { name, value } of list) { if (value) jar.set(name, value); else jar.delete(name) } },
        },
      })
      return await client.auth.signInWithPassword({ email: input.email, password: input.password })
    } catch (error) {
      if (input.siteAuthDeadline) throw new Error('site01_auth_sign_in_failed')
      throw error
    }
  })()
  if (error || !data.session) {
    if (input.siteAuthDeadline) throw new Error('site01_auth_sign_in_failed')
    throw new Error(`track1_sign_in_failed:${error?.message ?? 'no_session'}`)
  }
  if (data.user?.id !== input.userId) throw new Error('track1_sign_in_wrong_user')
  const authLifetime = input.siteAuthDeadline ? siteAuthLifetime(data, input.userId, input.siteAuthDeadline) : undefined
  jar.set(ADMIN_SELECTED_COMPANY_COOKIE, input.companyId)
  const cookieHeader = [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
  return { cookieHeader, userId: input.userId, companyId: input.companyId, ...(authLifetime ? { authLifetime } : {}) }
}

export type HttpResult = { status: number; ms: number; body: unknown; aborted: boolean; text?: string }

export async function http(session: Session | null, method: 'GET' | 'POST', route: string, init: {
  json?: unknown
  /** Abort the client request after this many ms (the server is not told to stop). */
  abortAfterMs?: number
  headers?: Record<string, string>
} = {}): Promise<HttpResult> {
  const controller = new AbortController()
  const timer = init.abortAfterMs ? setTimeout(() => controller.abort(), init.abortAfterMs) : null
  const started = Date.now()
  try {
    const response = await fetch(`${appUrl()}${route}`, {
      method, signal: controller.signal, redirect: 'manual',
      headers: { accept: 'application/json', ...(init.json !== undefined ? { 'content-type': 'application/json' } : {}), ...(session ? { cookie: session.cookieHeader } : {}), ...init.headers },
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
    })
    const text = await response.text()
    let body: unknown = null
    try { body = text ? JSON.parse(text) : null } catch { body = null }
    return { status: response.status, ms: Date.now() - started, body, aborted: false, text: body === null ? text.slice(0, 500) : undefined }
  } catch (error) {
    if (controller.signal.aborted) return { status: 0, ms: Date.now() - started, body: null, aborted: true }
    throw error
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
