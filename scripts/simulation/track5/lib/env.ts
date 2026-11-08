import fs from 'node:fs'
import path from 'node:path'

export const SIM_HOME = process.env.SIM_HOME ?? '/root/sim-home/track5'

let cached: Record<string, string> | null = null

/** Läser SIM_HOME/app.env (KEY=value, kommentarer med #). Hemligheter loggas aldrig. */
export function readAppEnv(): Record<string, string> {
  if (cached) return cached
  const file = path.join(SIM_HOME, 'app.env')
  if (!fs.existsSync(file)) throw new Error(`app.env saknas i ${SIM_HOME}; kör up.sh först`)
  const out: Record<string, string> = {}
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim())
    if (m) out[m[1]] = m[2]
  }
  cached = out
  return out
}

export function requireEnv(key: string): string {
  const value = readAppEnv()[key]
  if (!value) throw new Error(`app.env saknar ${key}`)
  return value
}

export const sim = {
  get apiUrl() { return requireEnv('NEXT_PUBLIC_SUPABASE_URL') },
  get anonKey() { return requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY') },
  get serviceKey() { return requireEnv('SUPABASE_SERVICE_ROLE_KEY') },
  get dbUrl() { return requireEnv('SIM_DB_URL') },
  get appUrl() { return requireEnv('SIM_APP_URL') },
  get counterpartUrl() { return requireEnv('SIM_COUNTERPART_URL') },
  get mailHttpUrl() { return requireEnv('SIM_MAIL_HTTP_URL') },
  get cronSecret() { return requireEnv('CRON_SECRET') },
}
