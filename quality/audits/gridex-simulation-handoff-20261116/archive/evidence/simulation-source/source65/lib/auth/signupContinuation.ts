/**
 * Validate signup email continuation before consuming its provider token.
 * Query wrappers are parsed one level at a time; business query bytes are never
 * whole-string decoded. This is a destination check, not identity authority.
 */
export function resolveSignupContinuation(
  rawValue: string,
  appBaseUrl: string,
  fallbackPath: string,
): string | null {
  let trusted: URL
  try { trusted = new URL(appBaseUrl) } catch { return null }
  if (!['https:', 'http:'].includes(trusted.protocol) || trusted.username || trusted.password) return null
  let value = rawValue.trim() || fallbackPath
  const seen = new Set<string>()
  const forbiddenQueryKeys = new Set(['access_token', 'refresh_token', 'token_hash', 'code', 'type'])

  for (let depth = 0; depth <= 2; depth += 1) {
    // Validate encoded controls/authority without using the decoded result as
    // the URL. URLSearchParams alone decodes each wrapper's next value.
    let probe: string
    try { probe = decodeURIComponent(value) } catch { return null }
    if (/[\u0000-\u001f\u007f\\]/.test(value) || /[\u0000-\u001f\u007f\\]/.test(probe)
      || value.startsWith('//') || probe.startsWith('//')) return null
    if (!value.startsWith('/') && !/^https?:\/\//i.test(value)) return null
    let url: URL
    try { url = new URL(value, trusted.origin) } catch { return null }
    if (url.origin !== trusted.origin || url.username || url.password || url.hash) return null
    if (seen.has(url.href)) return null
    seen.add(url.href)
    const wrapperPath = url.pathname.replace(/\/+$/, '')
    if (wrapperPath === '/auth/action' || wrapperPath === '/auth/callback') {
      if (url.pathname !== wrapperPath || depth === 2) return null
      const keys = [...url.searchParams.keys()]
      const next = url.searchParams.getAll('next')
      if (keys.length !== 1 || keys[0] !== 'next' || next.length !== 1 || !next[0].trim()) return null
      value = next[0]
      continue
    }
    if ([...url.searchParams.keys()].some((key) => forbiddenQueryKeys.has(key.toLowerCase()))) return null
    return `${url.pathname}${url.search}`
  }
  return null
}
