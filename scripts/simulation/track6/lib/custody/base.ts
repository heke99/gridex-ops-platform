// CUSTODY01: gemensamma hjälpare (psql, hashar, miljö). Allt mot den lokala stacken; inga externa värdar.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { dbUrl, lit } from '../seed.mjs'

export { lit }
export const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex')
export const mode = (): 'test' | 'production' => ((process.env.T6_MODE as 'test' | 'production') ?? 'test')
export const actorId = (): string => { const v = process.env.EDIEL_AUTOMATION_ACTOR_USER_ID; if (!v) throw new Error('EDIEL_AUTOMATION_ACTOR_USER_ID saknas i env'); return v }
export const simHome = (): string => { const v = process.env.T6_SIM_HOME ?? process.env.SIM_HOME; if (!v) throw new Error('T6_SIM_HOME/SIM_HOME saknas'); return v }
export const appUrl = (): string => process.env.T6_APP_URL ?? `http://127.0.0.1:${process.env.T6_APP_PORT ?? '3106'}`
export const env = (name: string): string => { const v = process.env[name]; if (!v) throw new Error(`env ${name} saknas`); return v }
export const custodyDir = (...parts: string[]): string => { const d = join(simHome(), 'custody', ...parts); mkdirSync(d, { recursive: true }); return d }

/** psql via stdin (flera satser, BEGIN/COMMIT). Utdata tolkas som JSON/bool; tom -> undefined. Kastar vid SQL-fel. */
export function sqlIn<T = unknown>(input: string): T {
  const r = spawnSync('psql', [dbUrl(), '-XAtq', '-v', 'ON_ERROR_STOP=1'], {
    input, encoding: 'utf8', timeout: 120_000, maxBuffer: 64_000_000, env: { ...process.env, PGPASSWORD: 'postgres' },
  })
  if (r.status !== 0) throw new Error(`psql: ${(r.stderr || r.error?.message || '').slice(0, 800)}`)
  const out = r.stdout.trim()
  if (out === 't' || out === 'f') return (out === 't') as T
  try { return (out ? JSON.parse(out) : undefined) as T } catch { return out as unknown as T }
}

export type SqlAttempt = { ok: boolean; sqlstate: string | null; message: string | null; stdout: string }
/** Kör SQL och fångar fel (SQLSTATE + meddelande) i stället för att kasta. VERBOSITY=verbose ger SQLSTATE i ERROR-raden. */
export function sqlTry(input: string, url: string = dbUrl()): SqlAttempt {
  const r = spawnSync('psql', [url, '-XAtq', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], {
    input, encoding: 'utf8', timeout: 120_000, maxBuffer: 64_000_000, env: { ...process.env, PGPASSWORD: 'postgres' },
  })
  if (r.status === 0) return { ok: true, sqlstate: null, message: null, stdout: r.stdout.trim() }
  const m = /ERROR:\s+([0-9A-Z]{5}):\s+(.*)/.exec(r.stderr)
  return { ok: false, sqlstate: m?.[1] ?? null, message: m?.[2]?.trim() ?? (r.stderr || r.error?.message || '').slice(0, 500), stdout: r.stdout.trim() }
}

/** Radens fulla innehåll + originalkroppens sha256/bytes, beräknat i databasen (bytes ur raw_payload som UTF-8). */
export type MessageFingerprint = { rowSha256: string; bodySha256: string | null; bodyBytes: number | null }
export function messageFingerprint(id: string): MessageFingerprint | null {
  return sqlIn<MessageFingerprint | undefined>(`SELECT jsonb_build_object(
    'rowSha256', encode(sha256(convert_to(to_jsonb(m)::text,'UTF8')),'hex'),
    'bodySha256', encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'),
    'bodyBytes', octet_length(convert_to(m.raw_payload,'UTF8'))) FROM public.ediel_messages m WHERE m.id=${lit(id)}`) ?? null
}

export const uniq = <T>(xs: T[]): T[] => [...new Set(xs)]
export const runStamp = (): string => new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
