export function getBaseAppUrl(): string {
  const value =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    process.env.SITE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ??
    'http://localhost:3000'

  return value.replace(/\/$/, '')
}

export function getSafeNextPath(value: string | null | undefined, fallback = '/dashboard'): string {
  if (!value) return fallback

  try {
    const decoded = decodeURIComponent(value)
    if (decoded.startsWith('/') && !decoded.startsWith('//')) return decoded
  } catch {
    if (value.startsWith('/') && !value.startsWith('//')) return value
  }

  return fallback
}

export function buildAuthCallbackUrl(nextPath: string): string {
  const url = new URL('/auth/callback', getBaseAppUrl())
  url.searchParams.set('next', nextPath)
  return url.toString()
}

export function buildAuthConfirmUrl(nextPath = '/login?message=E-postadressen är bekräftad. Du kan logga in.'): string {
  const url = new URL('/auth/confirm', getBaseAppUrl())
  url.searchParams.set('next', nextPath)
  return url.toString()
}
