import { createServerClient } from '@supabase/ssr'
import { sim } from './env'

/** Samma cookienamn som appen använder för vald företagskontext (lib/admin/navigationPreferences.ts). */
export const ADMIN_SELECTED_COMPANY_COOKIE = 'gridex_admin_selected_company_id'

export type AppSession = {
  userId: string
  /** Rå Cookie-header (innehåller sessionstokens; logga aldrig). */
  cookieHeader: string
  /** fetch mot appen med sessionen; följer inte redirects (status/Location blir synliga). */
  fetch: (pathAndQuery: string, init?: RequestInit) => Promise<Response>
}

/**
 * Riktig inloggning mot lokala GoTrue med @supabase/ssr (samma bibliotek och cookieformat
 * som appens proxy.ts/lib/supabase/server.ts), så att appen ser en vanlig sb-*-auth-token-session.
 * Auth/JWT-tid är real tid; ingen klockmanipulation.
 */
export async function loginSession(email: string, password: string, opts: { companyId?: string } = {}): Promise<AppSession> {
  const jar = new Map<string, string>()
  const supabase = createServerClient(sim.apiUrl, sim.anonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => { for (const c of cookies) { if (c.value) jar.set(c.name, c.value); else jar.delete(c.name) } },
    },
  })
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error || !data.user) throw new Error(`inloggning misslyckades: ${error?.message ?? 'ingen användare'}`)
  if (jar.size === 0) throw new Error('inloggning gav inga sessionscookies')
  const cookies = [...jar].map(([n, v]) => `${n}=${v}`)
  if (opts.companyId) cookies.push(`${ADMIN_SELECTED_COMPANY_COOKIE}=${opts.companyId}`)
  const cookieHeader = cookies.join('; ')
  return {
    userId: data.user.id,
    cookieHeader,
    fetch: (p, init = {}) => fetch(new URL(p, sim.appUrl), {
      redirect: 'manual',
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), cookie: cookieHeader },
    }),
  }
}
