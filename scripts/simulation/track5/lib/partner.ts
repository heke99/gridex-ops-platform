import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { psql } from './db'
import { sim } from './env'
import { lit } from './t5-world'

// Partnernyckel i integration_api_clients (fixtursetup, backendersättning för plattformsadminens nyckelutfärdande).
// Format och hash som lib/integrations/apiClientSecrets.ts @ 1c0c088c: token `gdxp_<7 hex>.<base64url>`,
// key_prefix = token.slice(0,12), secret_hash = sha256-hex(token). Token loggas aldrig.

export type PartnerClient = { id: string; companyId: string; token: string; scopes: string[] }

export function createPartnerClient(companyId: string, scopes: string[], opts: {
  status?: string; expiresAt?: string | null; metadata?: Record<string, unknown>; name?: string
} = {}): PartnerClient {
  const keyPrefix = `gdxp_${randomBytes(8).toString('hex').slice(0, 7)}`
  const token = `${keyPrefix}.${randomBytes(32).toString('base64url')}`
  const id = randomUUID()
  const secretHash = createHash('sha256').update(token).digest('hex')
  const scopeArr = `ARRAY[${scopes.map(lit).join(',')}]::text[]`
  psql(`INSERT INTO public.integration_api_clients(id,company_id,name,status,key_prefix,secret_hash,scopes,expires_at,metadata,rate_limit_per_minute)
    VALUES('${id}','${companyId}',${lit(opts.name ?? `Sim t5 partner ${id.slice(0, 8)}`)},${lit(opts.status ?? 'active')},${lit(keyPrefix)},${lit(secretHash)},
    ${scopeArr},${opts.expiresAt ? lit(opts.expiresAt) : 'NULL'},${lit(JSON.stringify(opts.metadata ?? { synthetic: true }))}::jsonb,600);`)
  return { id, companyId, token, scopes }
}

export type PartnerResponse = { status: number; text: string; json: unknown; headers: Headers }

export async function partner(client: PartnerClient | null, method: string, path: string, body?: unknown, opts: {
  idempotencyKey?: string | null; headers?: Record<string, string>
} = {}): Promise<PartnerResponse> {
  const headers: Record<string, string> = { accept: 'application/json', ...(opts.headers ?? {}) }
  if (client) headers.authorization = `Bearer ${client.token}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  const key = opts.idempotencyKey === undefined ? (method === 'GET' ? null : randomUUID()) : opts.idempotencyKey
  if (key) headers['idempotency-key'] = key
  const res = await fetch(new URL(`/api/partner/v1/${path.replace(/^\//, '')}`, sim.appUrl), {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual',
  })
  const text = await res.text()
  let json: unknown = null
  try { json = JSON.parse(text) } catch { json = null }
  return { status: res.status, text, json, headers: res.headers }
}

/** Kort, säker sammanfattning av ett svar för assert-meddelanden (inga tokens finns i svaren). */
export const brief = (r: PartnerResponse) => `HTTP ${r.status}: ${r.text.slice(0, 400)}`
