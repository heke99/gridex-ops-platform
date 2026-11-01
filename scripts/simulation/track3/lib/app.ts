// Anrop mot appens riktiga HTTP-ingångar (cron-routes). Bearer-hemligheterna kommer från env-filen.
const env = (name: string) => { const v = process.env[name]; if (!v) throw new Error(`env ${name} saknas`); return v }
export const appUrl = () => process.env.T3_APP_URL ?? `http://127.0.0.1:${env('T3_APP_PORT')}`
export type HttpResult = { status: number; ok: boolean; body: unknown; text: string; ms: number }

async function call(path: string, secret: string, init: RequestInit = {}): Promise<HttpResult> {
  const t0 = Date.now()
  const r = await fetch(`${appUrl()}${path}`, { ...init, headers: { authorization: `Bearer ${secret}`, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(170_000) })
  const text = await r.text()
  let body: unknown = null
  try { body = JSON.parse(text) } catch { /* ej JSON */ }
  return { status: r.status, ok: r.ok, body, text, ms: Date.now() - t0 }
}

/** app/api/internal/inbound-mail/cron/route.ts */
export const triggerInbound = (environment: 'test' | 'production' = (process.env.T3_MODE as 'test' | 'production') ?? 'test', mailboxId?: string) =>
  call(`/api/internal/inbound-mail/cron?environment=${environment}${mailboxId ? `&mailboxId=${encodeURIComponent(mailboxId)}` : ''}`, env('EDIEL_INBOUND_CRON_SECRET'), { method: 'POST' })

/** app/api/ediel/outbox/process/route.ts */
export const triggerOutbox = (environment: 'test' | 'production' = (process.env.T3_MODE as 'test' | 'production') ?? 'test', limit = 25) =>
  call(`/api/ediel/outbox/process?environment=${environment}&limit=${limit}`, env('EDIEL_CRON_SECRET'), { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })
