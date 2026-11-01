import Cookies from 'nodemailer/lib/fetch/cookies'
import { createServerClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr'
import { sim } from './env'
import { callServerAction } from './server-action'
import type { AppSession } from './session'

type StoredCookie = Cookies.Cookie

function appUrl(target: string): URL {
  const base = new URL(sim.appUrl)
  const url = new URL(target, base)
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password ||
    url.origin !== base.origin || url.username || url.password) {
    throw new Error('HARNESS_COOKIE_UNSUPPORTED_ORIGIN')
  }
  return url
}

/** Supported same-origin HTTP cookie subset, not a browser/SameSite implementation.
 * Nodemailer's path/Secure matching is reused. Its parser, empty-value/session
 * expiry and flag-sensitive identity are unsuitable for these Auth assertions.
 * Cookie/token values are never written to receipts or error messages.
 */
class AppCookieJar extends Cookies {
  compare(a: StoredCookie, b: StoredCookie): boolean {
    const domain = (value?: string) => value?.replace(/^\./, '').toLowerCase()
    return a.name === b.name && domain(a.domain) === domain(b.domain) && a.path === b.path
  }

  isExpired(cookie: StoredCookie): boolean {
    return cookie.expires !== undefined && cookie.expires.getTime() <= Date.now()
  }

  receive(raw: string, url: URL): string {
    const [pair, ...attributes] = raw.split(';')
    const equal = pair.indexOf('=')
    const name = pair.slice(0, equal).trim()
    const value = pair.slice(equal + 1).trim()
    if (equal < 1 || !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name) ||
      !/^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*$/.test(value)) {
      throw new Error('HARNESS_COOKIE_UNSUPPORTED_LAYOUT')
    }
    let domain = url.hostname
    let cookiePath = this.getPath(url.pathname)
    let expires: Date | undefined
    let maxAge: number | undefined
    let secure = false
    let httponly = false
    for (const attribute of attributes) {
      const split = attribute.indexOf('=')
      const key = (split < 0 ? attribute : attribute.slice(0, split)).trim().toLowerCase()
      const content = split < 0 ? '' : attribute.slice(split + 1).trim()
      if (key === 'domain') {
        const canonical = content.replace(/^\./, '').toLowerCase()
        // Exact configured host only: no parent/third-party domain or PSL model.
        if (canonical !== url.hostname.toLowerCase()) throw new Error('HARNESS_COOKIE_UNSUPPORTED_DOMAIN')
        domain = content.startsWith('.') ? `.${canonical}` : canonical
      } else if (key === 'path') {
        cookiePath = content.startsWith('/') ? content : this.getPath(url.pathname)
      } else if (key === 'max-age') {
        if (/^-?\d+$/.test(content)) {
          if (!Number.isSafeInteger(Number(content))) throw new Error('HARNESS_COOKIE_UNSUPPORTED_EXPIRY')
          maxAge = Number(content)
        }
      } else if (key === 'expires') {
        const stamp = Date.parse(content)
        if (Number.isFinite(stamp)) expires = new Date(stamp)
      } else if (key === 'secure') secure = true
      else if (key === 'httponly') httponly = true
      else if (key === 'partitioned') throw new Error('HARNESS_COOKIE_UNSUPPORTED_PARTITION')
    }
    if (maxAge !== undefined) {
      const stamp = maxAge <= 0 ? 0 : Date.now() + maxAge * 1000
      if (!Number.isFinite(new Date(stamp).getTime())) throw new Error('HARNESS_COOKIE_UNSUPPORTED_EXPIRY')
      expires = new Date(stamp)
    }
    // Prune expired identities before replacement, retaining creation order for
    // live replacements. Session cookies have no invented 30-minute expiry.
    super.list(url.href)
    this.add({ name, value, domain, path: cookiePath, expires, secure, httponly })
    return name
  }

  matching(url: URL): StoredCookie[] {
    return super.list(url.href).map((cookie, order) => ({ cookie, order }))
      .sort((a, b) => (b.cookie.path?.length ?? 0) - (a.cookie.path?.length ?? 0) || a.order - b.order)
      .map(entry => entry.cookie)
  }

  header(url: URL): string {
    return this.matching(url).map(cookie => `${cookie.name}=${cookie.value ?? ''}`).join('; ')
  }
}

export type JarSession = {
  userId: string
  /** URL-scoped raw header; contains tokens, never log it. Default keeps existing admin action callers compatible. */
  cookieHeader(target?: string): string
  cookieNames(target?: string): string[]
  cookieValue(name: string, target?: string): string | null
  /** Deliberate negative-only stimulus, distinct from natural server cookie handling. */
  forgeCookieForNegativeTest(rawSetCookie: string): void
  /** Exact same-origin request, manual redirects, actual per-response Set-Cookie. */
  fetch(pathAndQuery: string, init?: RequestInit): Promise<Response>
}

export function applySetCookies(jar: AppCookieJar, response: Response, responseUrl: URL): string[] {
  return response.headers.getSetCookie().map(raw => jar.receive(raw, responseUrl))
}

function session(jar: AppCookieJar, userId = ''): JarSession {
  const cookieHeader = (target = '/admin') => jar.header(appUrl(target))
  return {
    userId,
    cookieHeader,
    cookieNames: (target = '/admin') => jar.matching(appUrl(target)).map(cookie => cookie.name!),
    cookieValue: (name, target = '/admin') => {
      const matches = jar.matching(appUrl(target)).filter(cookie => cookie.name === name)
      if (matches.length > 1) throw new Error('HARNESS_COOKIE_AMBIGUOUS_NAME')
      return parseCookieHeader(cookieHeader(target)).find(cookie => cookie.name === name)?.value ?? null
    },
    forgeCookieForNegativeTest: raw => { jar.receive(raw, appUrl('/')) },
    fetch: async (target, init = {}) => {
      const url = appUrl(target)
      const headers = new Headers(init.headers)
      if (headers.has('cookie')) throw new Error('HARNESS_NATURAL_COOKIE_OVERRIDE_REFUSED')
      headers.set('cookie', jar.header(url))
      const response = await fetch(url, { ...init, redirect: 'manual', headers })
      applySetCookies(jar, response, url)
      return response
    },
  }
}

/** Direct Auth SDK entry retained for existing callers; SDK cookie options are preserved. */
export async function loginJar(email: string, password: string): Promise<JarSession> {
  const jar = new AppCookieJar()
  const context = appUrl('/login')
  const supabase = createServerClient(sim.apiUrl, sim.anonKey, {
    cookies: {
      getAll: () => parseCookieHeader(jar.header(context)).map(cookie => ({ name: cookie.name, value: cookie.value ?? '' })),
      setAll: cookies => {
        for (const cookie of cookies) jar.receive(serializeCookieHeader(cookie.name, cookie.value, cookie.options), context)
      },
    },
  })
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error || !data.user) throw new Error('HARNESS_AUTH_LOGIN_FAILED')
  const result = session(jar, data.user.id)
  if (!result.cookieNames().some(name => name.startsWith('sb-'))) throw new Error('HARNESS_AUTH_COOKIES_MISSING')
  return result
}

/** Frozen raw-cookie negative stimulus for logout/expiry; no foreign-origin export. */
export function rawFetch(cookieHeader: string, target: string, init: RequestInit = {}): Promise<Response> {
  const url = appUrl(target)
  const headers = new Headers(init.headers)
  headers.set('cookie', cookieHeader)
  return fetch(url, { ...init, redirect: 'manual', headers })
}

/** Natural loginAction HTTP entry; all positive cookies come from app responses. */
export async function loginViaUi(email: string, password: string, next = '/admin'): Promise<JarSession & { redirect: string | null }> {
  const result = session(new AppCookieJar())
  const form = new FormData()
  form.set('email', email); form.set('password', password); form.set('next', next)
  const anon: AppSession = { userId: '', cookieHeader: '', fetch: result.fetch }
  const login = await callServerAction(anon, { route: '/login', filename: 'app/login/actions.ts', exportedName: 'loginAction', args: [form] })
  if (login.threw || login.httpStatus < 200 || login.httpStatus >= 400 || !result.cookieNames().some(name => name.startsWith('sb-'))) {
    throw new Error(`HARNESS_UI_LOGIN_FAILED_HTTP_${login.httpStatus}`)
  }
  return { ...result, redirect: login.redirect }
}
