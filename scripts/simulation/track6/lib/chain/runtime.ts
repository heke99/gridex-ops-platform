// Ursprung: 3ea5cd2b6d37b910674e71993ac94e5720ed31a8 (origin/claude/sim-20261029-track1):scripts/simulation/track1/fixtures/runtime.ts
//   (requireEnv, dbRead, lit, signIn, http, timed) -- miljövariabler ändrade från TRACK1_* till T6_*, artefakter går via lib/evidence.ts.
// Ursprung: 766f49636b0269a56b5738abb43850344dde6135 (origin/claude/sim-20261029-track4):scripts/simulation/track4/fixtures/flows.mjs
//   (actionId/runAction: Next-serveråtgärd postad som ett no-JS-formulär med `$ACTION_ID_<id>`; id läses ur den renderade sidan).
// Runtime helpers for the DELIVERY01 chain: environment, read-only DB access, authenticated HTTP and server-action form posts
// against the app under test. Nothing here writes to the database. Secrets are never put in artifacts.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServerClient } from '@supabase/ssr'

export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`track6_env_missing:${name}`)
  return value
}

export function appUrl(): string { return (process.env.T6_APP_URL ?? `http://127.0.0.1:${process.env.T6_APP_PORT ?? '3106'}`).replace(/\/$/, '') }

/** Cookie the app uses to select the company for admin API calls (lib/admin/navigationPreferences.ts:4). */
export const ADMIN_SELECTED_COMPANY_COOKIE = 'gridex_admin_selected_company_id'

export const sha256Hex = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')

export const lit = (value: unknown): string => value === null || value === undefined ? 'NULL' : `'${String(typeof value === 'object' ? JSON.stringify(value) : value).replaceAll("'", "''")}'`

/**
 * Read-only SQL for receipts and counts. The session is forced read-only, so a mistaken write fails instead of changing the stack.
 * The statement must return exactly one jsonb/scalar value; the result is JSON-parsed.
 */
export function dbRead<T = unknown>(statement: string, maxBuffer = 64 * 1024 * 1024): T {
  const out = execFileSync('psql', [process.env.T6_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', '-XAtq', '-v', 'ON_ERROR_STOP=1'], {
    input: statement, encoding: 'utf8', timeout: 120_000, maxBuffer,
    env: { ...process.env, PGPASSWORD: 'postgres', PGOPTIONS: '-c default_transaction_read_only=on' },
  }).trim()
  if (out === 't' || out === 'f') return (out === 't') as T
  return (out ? JSON.parse(out) : undefined) as T
}

export type StepTiming = { step: string; ms: number }
export const TIMINGS: StepTiming[] = []
export async function timed<T>(step: string, action: () => Promise<T>): Promise<T> {
  const started = Date.now()
  try { return await action() } finally { TIMINGS.push({ step, ms: Date.now() - started }) }
}

// ------------------------------------------------------------- authenticated HTTP

export type Session = { cookieHeader: string; userId: string; companyId: string }

/** Real password login against the stack's auth service, producing exactly the cookies @supabase/ssr sets in a browser. In-memory jar only. */
export async function signIn(input: { email: string; password: string; userId: string; companyId: string }): Promise<Session> {
  const jar = new Map<string, string>()
  const client = createServerClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: list => { for (const { name, value } of list) { if (value) jar.set(name, value); else jar.delete(name) } },
    },
  })
  const { data, error } = await client.auth.signInWithPassword({ email: input.email, password: input.password })
  if (error || !data.session) throw new Error(`track6_sign_in_failed:${error?.message ?? 'no_session'}`)
  if (data.user?.id !== input.userId) throw new Error('track6_sign_in_wrong_user')
  jar.set(ADMIN_SELECTED_COMPANY_COOKIE, input.companyId)
  const cookieHeader = [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
  return { cookieHeader, userId: input.userId, companyId: input.companyId }
}

export type HttpResult = { status: number; ms: number; body: unknown; bytes: Buffer; text: string; location: string | null; contentType: string | null }

export async function http(session: Session | null, method: 'GET' | 'POST', route: string, init: {
  json?: unknown
  form?: FormData
  headers?: Record<string, string>
} = {}): Promise<HttpResult> {
  const started = Date.now()
  const response = await fetch(`${appUrl()}${route}`, {
    method, redirect: 'manual',
    headers: {
      ...(init.form ? { origin: appUrl() } : { accept: 'application/json' }),
      ...(init.json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(session ? { cookie: session.cookieHeader } : {}), ...init.headers,
    },
    body: init.form ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined),
  })
  const bytes = Buffer.from(await response.arrayBuffer())
  const text = bytes.toString('utf8')
  let body: unknown = null
  try { body = text ? JSON.parse(text) : null } catch { body = null }
  return { status: response.status, ms: Date.now() - started, body, bytes, text, location: response.headers.get('location'), contentType: response.headers.get('content-type') }
}

// ---------------------------------------------------- Next server actions as no-JS form posts

/**
 * The action id is read from the rendered page: the hidden `$ACTION_ID_<id>` input of the first <form> accepted by `match`.
 * Returns the id and the form's own hidden inputs (name -> value), which a browser would post too.
 */
export async function findActionForm(session: Session, page: string, match: (formHtml: string) => boolean): Promise<{ id: string; hidden: Record<string, string>; formHtml: string } | null> {
  const res = await http(session, 'GET', page, { headers: { accept: 'text/html' } })
  if (res.status !== 200) throw new Error(`track6_page_${res.status}:${page}`)
  for (const form of res.text.match(/<form[\s\S]*?<\/form>/g) ?? []) {
    if (!match(form)) continue
    const m = /name="\$ACTION_ID_([0-9a-f]+)"/.exec(form)
    if (!m) continue
    const hidden: Record<string, string> = {}
    for (const input of form.match(/<input[^>]*type="hidden"[^>]*>/g) ?? []) {
      const name = /name="([^"]+)"/.exec(input)?.[1]
      const value = /value="([^"]*)"/.exec(input)?.[1] ?? ''
      if (name && !name.startsWith('$ACTION_ID_')) hidden[name] = value
    }
    return { id: m[1], hidden, formHtml: form }
  }
  return null
}

export type ActionResult = { status: number; location: string | null; params: Record<string, string>; text: string }

/** Post a server action exactly like a no-JS browser form: multipart body with `$ACTION_ID_<id>` and the given fields. */
export async function postServerAction(session: Session, page: string, form: { id: string; hidden?: Record<string, string> }, fields: Record<string, string>): Promise<ActionResult> {
  const body = new FormData()
  body.set(`$ACTION_ID_${form.id}`, '')
  for (const [name, value] of Object.entries({ ...(form.hidden ?? {}), ...fields })) body.set(name, value)
  const res = await http(session, 'POST', page, { form: body, headers: { accept: 'text/html' } })
  const params = res.location ? Object.fromEntries(new URL(res.location, 'http://x').searchParams) : {}
  return { status: res.status, location: res.location, params, text: res.text.slice(0, 2000) }
}
