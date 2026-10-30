import { createServerClient } from '@supabase/ssr'
import { sim } from './env'
import { callServerAction } from './server-action'
import type { AppSession } from './session'

/**
 * Webbläsarlik session: riktig inloggning mot lokala GoTrue med @supabase/ssr (samma cookieformat som appen),
 * och en cookie-jar som uppdateras från appens Set-Cookie. Företagsbyte sker alltså genom appens egna svar,
 * inte genom att harnessen sätter cookien själv. Cookievärden innehåller tokens och loggas aldrig.
 */
export type JarSession = {
  userId: string
  jar: Map<string, string>
  /** Cookie-header som den ser ut just nu. */
  cookieHeader(): string
  /** fetch mot appen; följer inte redirects; tillämpar Set-Cookie (inklusive radering) på jaren. */
  fetch(pathAndQuery: string, init?: RequestInit): Promise<Response>
}

export function applySetCookies(jar: Map<string, string>, res: Response): string[] {
  const names: string[] = []
  for (const raw of res.headers.getSetCookie()) {
    const [pair, ...attrs] = raw.split(';')
    const eq = pair.indexOf('=')
    if (eq < 0) continue
    const name = pair.slice(0, eq).trim()
    const value = pair.slice(eq + 1).trim()
    const expired = attrs.some((a) => {
      const [k, v = ''] = a.trim().split('=')
      if (k.toLowerCase() === 'max-age') return Number(v) <= 0
      if (k.toLowerCase() === 'expires') return Date.parse(v) <= Date.now()
      return false
    })
    if (!value || expired) jar.delete(name)
    else jar.set(name, value)
    names.push(name)
  }
  return names
}

export async function loginJar(email: string, password: string): Promise<JarSession> {
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
  const cookieHeader = () => [...jar].map(([n, v]) => `${n}=${v}`).join('; ')
  return {
    userId: data.user.id,
    jar,
    cookieHeader,
    fetch: async (p, init = {}) => {
      const res = await fetch(new URL(p, sim.appUrl), {
        redirect: 'manual',
        ...init,
        headers: { ...(init.headers as Record<string, string> | undefined), cookie: cookieHeader() },
      })
      applySetCookies(jar, res)
      return res
    },
  }
}

/** Fryst kopia av en cookie-header (för att pröva en gammal session efter utloggning). */
export function rawFetch(cookieHeader: string, p: string, init: RequestInit = {}): Promise<Response> {
  return fetch(new URL(p, sim.appUrl), {
    redirect: 'manual',
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), cookie: cookieHeader },
  })
}

/**
 * Naturlig UI-inloggning: appens egen loginAction (app/login/actions.ts) POST:as mot /login som server action.
 * Sessionscookies kommer från appens Set-Cookie, inte från harnessen.
 */
export async function loginViaUi(email: string, password: string, next = '/admin'): Promise<JarSession & { redirect: string | null }> {
  const jar = new Map<string, string>()
  const cookieHeader = () => [...jar].map(([n, v]) => `${n}=${v}`).join('; ')
  const doFetch = async (p: string, init: RequestInit = {}) => {
    const res = await fetch(new URL(p, sim.appUrl), {
      redirect: 'manual',
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), cookie: cookieHeader() },
    })
    applySetCookies(jar, res)
    return res
  }
  const form = new FormData()
  form.set('email', email); form.set('password', password); form.set('next', next)
  const anon: AppSession = { userId: '', cookieHeader: '', fetch: doFetch }
  const result = await callServerAction(anon, { route: '/login', filename: 'app/login/actions.ts', exportedName: 'loginAction', args: [form] })
  const sb = [...jar.keys()].filter((k) => k.startsWith('sb-'))
  if (sb.length === 0) throw new Error(`UI-inloggning gav inga sb-cookies (HTTP ${result.httpStatus}, redirect ${result.redirect})`)
  return { userId: '', jar, cookieHeader, fetch: doFetch, redirect: result.redirect }
}
