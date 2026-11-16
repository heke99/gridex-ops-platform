import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getBaseAppUrl } from '@/lib/auth/urls'
import { readCompanySelectionAccess } from '@/lib/tenant/companySelectionAccess'
import { ADMIN_SELECTED_COMPANY_COOKIE } from '@/lib/admin/navigationPreferences'

export const dynamic = 'force-dynamic'
const INTENT_COOKIE = 'gridex_company_selection_intent'
const PATH = '/dashboard/company-selection'
const TTL = 120
const HEADERS = { 'Cache-Control': 'no-store, private, max-age=0', 'Referrer-Policy': 'no-referrer' }
type Intent = { userId: string; companyId: string; nonce: string; phase: 'clear-root' | 'select'; expires: number }
function secret() {
  const value = process.env.COMPANY_SELECTION_INTENT_SECRET
  if (!value || Buffer.byteLength(value) < 32) throw new Error('Company selection not configured')
  return value
}
function seal(intent: Intent, key: string) {
  const body = Buffer.from(JSON.stringify(intent)).toString('base64url')
  return `${body}.${createHmac('sha256', key).update(`company-selection:v1:${body}`).digest('base64url')}`
}
function unseal(value: string, key: string): Intent {
  if (value.length > 2048) throw new Error('Invalid intent')
  const [body, signature, extra] = value.split('.')
  if (!body || !signature || extra) throw new Error('Invalid intent')
  const expected = createHmac('sha256', key).update(`company-selection:v1:${body}`).digest()
  const supplied = Buffer.from(signature, 'base64url')
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new Error('Invalid intent')
  const intent = JSON.parse(Buffer.from(body, 'base64url').toString()) as Intent
  if (typeof intent.userId !== 'string' || typeof intent.companyId !== 'string' ||
      !/^[a-f0-9]{64}$/.test(intent.nonce) || !['clear-root', 'select'].includes(intent.phase) ||
      !Number.isSafeInteger(intent.expires) || intent.expires <= Date.now() || intent.expires > Date.now() + TTL * 1000) throw new Error('Invalid intent')
  return intent
}
function options() { return { httpOnly: true, sameSite: 'strict' as const, secure: new URL(getBaseAppUrl()).protocol === 'https:', path: PATH, maxAge: TTL } }
function failure(status = 403) { return NextResponse.json({ error: 'Bolagsvalet kunde inte slutföras. Försök igen.' }, { status, headers: HEADERS }) }
function transition(intent: Intent, key: string) {
  // Next normalizes loopback hosts; deployment configuration owns the public origin.
  const url = new URL(PATH, getBaseAppUrl())
  url.searchParams.set('phase', intent.phase)
  url.searchParams.set('nonce', intent.nonce)
  const response = NextResponse.redirect(url, { status: 303, headers: HEADERS })
  response.cookies.set(INTENT_COOKIE, seal(intent, key), options())
  return response
}
export async function POST(request: NextRequest) {
  // A top-level cross-site form or direct GET cannot mint a preference intent.
  let origin: string
  try { origin = new URL(getBaseAppUrl()).origin } catch { return failure(503) }
  if (request.headers.get('origin') !== origin || request.headers.get('sec-fetch-site') === 'cross-site') return failure()
  let key: string
  try { key = secret() } catch { return failure(503) }
  try {
    const form = await request.formData()
    const companyId = form.get('company_id')
    if (typeof companyId !== 'string' || !/^[a-f0-9-]{36}$/i.test(companyId)) return failure(400)
    const access = await readCompanySelectionAccess(companyId)
    const intent: Intent = { userId: access.userId, companyId, nonce: randomBytes(32).toString('hex'), phase: 'clear-root', expires: Date.now() + TTL * 1000 }
    const response = transition(intent, key)
    response.cookies.set(ADMIN_SELECTED_COMPANY_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: new URL(getBaseAppUrl()).protocol === 'https:', path: '/admin', maxAge: 0, expires: new Date(0) })
    return response
  } catch { return failure() }
}
export async function GET(request: NextRequest) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return failure()
  try {
    const key = secret()
    const intent = unseal(request.cookies.get(INTENT_COOKIE)?.value ?? '', key)
    if (request.nextUrl.searchParams.get('nonce') !== intent.nonce || request.nextUrl.searchParams.get('phase') !== intent.phase) return failure()
    const access = await readCompanySelectionAccess(intent.companyId)
    if (access.userId !== intent.userId) return failure()
    if (intent.phase === 'clear-root') {
      const response = transition({ ...intent, phase: 'select', nonce: randomBytes(32).toString('hex') }, key)
      response.cookies.set(ADMIN_SELECTED_COMPANY_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: new URL(getBaseAppUrl()).protocol === 'https:', path: '/', maxAge: 0, expires: new Date(0) })
      return response
    }
    // The signed phase binds prior cleanup; this route cannot observe /admin cookies.
    if (request.cookies.has(ADMIN_SELECTED_COMPANY_COOKIE)) return failure(409)
    const response = NextResponse.redirect(new URL('/dashboard', getBaseAppUrl()), { status: 303, headers: HEADERS })
    response.cookies.set(ADMIN_SELECTED_COMPANY_COOKIE, intent.companyId, { httpOnly: true, sameSite: 'lax', secure: new URL(getBaseAppUrl()).protocol === 'https:', path: '/', maxAge: 60 * 60 * 24 * 180 })
    response.cookies.set(INTENT_COOKIE, '', { ...options(), maxAge: 0, expires: new Date(0) })
    return response
  } catch { return failure() }
}
