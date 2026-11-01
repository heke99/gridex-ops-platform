// Track 1 harness runtime helpers: environment, read-only database access,
// run artifacts, step timing, authenticated HTTP against the app under test.
// Nothing here writes to the database. Secrets are never put in artifacts.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
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

export type Session = { cookieHeader: string; userId: string; companyId: string }

/**
 * Real password login against the stack's auth service, producing exactly the
 * cookies @supabase/ssr sets in a browser. The cookie jar is only held in
 * memory and is never written to an artifact.
 */
export async function signIn(input: { email: string; password: string; userId: string; companyId: string }): Promise<Session> {
  const jar = new Map<string, string>()
  const client = createServerClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: list => { for (const { name, value } of list) { if (value) jar.set(name, value); else jar.delete(name) } },
    },
  })
  const { data, error } = await client.auth.signInWithPassword({ email: input.email, password: input.password })
  if (error || !data.session) throw new Error(`track1_sign_in_failed:${error?.message ?? 'no_session'}`)
  if (data.user?.id !== input.userId) throw new Error('track1_sign_in_wrong_user')
  jar.set(ADMIN_SELECTED_COMPANY_COOKIE, input.companyId)
  const cookieHeader = [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
  return { cookieHeader, userId: input.userId, companyId: input.companyId }
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
