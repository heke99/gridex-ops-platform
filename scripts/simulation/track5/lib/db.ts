import { execFileSync } from 'node:child_process'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { sim } from './env'

function assertLocal(url: string) {
  if (!/^postgres(ql)?:\/\/[^@]+@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
    throw new Error('sim_db_local_only')
  }
}

/** Kör SQL med psql mot stackens DB (superuser, lokal). Returnerar stdout (-At). */
export function psql(sql: string, opts: { timeoutMs?: number } = {}): string {
  assertLocal(sim.dbUrl)
  return execFileSync('psql', [sim.dbUrl, '-XAtq', '-v', 'ON_ERROR_STOP=1'], {
    input: sql, encoding: 'utf8', timeout: opts.timeoutMs ?? 60_000, maxBuffer: 16_000_000,
    env: { ...process.env, PGCONNECT_TIMEOUT: '10' },
  }).trim()
}

/** SELECT -> objekt-rader (via json_agg). */
export function psqlRows<T = Record<string, unknown>>(select: string): T[] {
  const out = psql(`select coalesce(json_agg(t), '[]'::json) from (${select.replace(/;\s*$/, '')}) t;`)
  return JSON.parse(out) as T[]
}

let service: SupabaseClient | null = null
/** service_role-klient mot lokala stackens API (för auth.admin och backendläsning). */
export function serviceClient(): SupabaseClient {
  service ??= createClient(sim.apiUrl, sim.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return service
}
