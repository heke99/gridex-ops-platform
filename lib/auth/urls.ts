import { LOGIN_EMAIL_CONFIRMED_MESSAGE } from '@/lib/auth/loginError'

export function getBaseAppUrl(): string {
  const value =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    process.env.SITE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)

  if (!value) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Missing required production app URL environment variable.')
    }
    return 'http://localhost:3000'
  }

  return value.replace(/\/$/, '')
}

function isSafeRelativeNextPath(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed.startsWith('/')) return false
  if (trimmed.startsWith('//')) return false
  // Block backslash and NUL forms that some clients treat as authority separators.
  if (trimmed.includes('\\') || trimmed.includes('\0')) return false
  return true
}

export function getSafeNextPath(value: string | null | undefined, fallback = '/dashboard'): string {
  const raw = String(value ?? '').trim()
  if (!raw) return fallback

  try {
    const decoded = decodeURIComponent(raw)
    if (isSafeRelativeNextPath(decoded)) return decoded
  } catch {
    if (isSafeRelativeNextPath(raw)) return raw
  }

  // Auth email / callback flows may pass absolute same-origin next URLs.
  try {
    const url = new URL(raw)
    const appUrl = new URL(getBaseAppUrl())
    if (url.origin === appUrl.origin) {
      const candidate = `${url.pathname}${url.search}${url.hash}` || fallback
      if (isSafeRelativeNextPath(candidate)) return candidate
      try {
        const decodedCandidate = decodeURIComponent(candidate)
        return isSafeRelativeNextPath(decodedCandidate) ? decodedCandidate : fallback
      } catch {
        return fallback
      }
    }
  } catch {
    return fallback
  }

  return fallback
}

export function buildAuthCallbackUrl(nextPath: string): string {
  const url = new URL('/auth/callback', getBaseAppUrl())
  url.searchParams.set('next', nextPath)
  return url.toString()
}

export function buildAuthConfirmUrl(
  nextPath = `/login?message=${LOGIN_EMAIL_CONFIRMED_MESSAGE}`,
): string {
  const url = new URL('/auth/confirm', getBaseAppUrl())
  url.searchParams.set('next', nextPath)
  return url.toString()
}
