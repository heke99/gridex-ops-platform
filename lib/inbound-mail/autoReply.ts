// Auto-reply / bulk classification for manual inbound mail (RFC 3834).
// An out-of-office reply to "[GX-FIR-…]" quotes the case reference but is not
// an answer from the grid owner; it must never be applied to a request.

const AUTO_REPLY_HEADER_NAMES = [
  'auto-submitted',
  'precedence',
  'x-autoreply',
  'x-autorespond',
  'content-type',
] as const

// Extracts the auto-reply relevant root headers from a raw header block.
export function extractAutoReplyHeaders(headerText: string): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const line of headerText.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const index = line.indexOf(':')
    if (index <= 0) continue
    const name = line.slice(0, index).trim().toLowerCase()
    if ((AUTO_REPLY_HEADER_NAMES as readonly string[]).includes(name) && !(name in headers)) {
      headers[name] = line.slice(index + 1).trim()
    }
  }
  return headers
}

// Normalizes provider-supplied headers (object or [{name,value}] list).
export function normalizeAutoReplyHeaders(value: unknown): Record<string, string> {
  const headers: Record<string, string> = {}
  const add = (name: unknown, raw: unknown) => {
    if (typeof name !== 'string' || (typeof raw !== 'string' && typeof raw !== 'number')) return
    const key = name.trim().toLowerCase()
    if ((AUTO_REPLY_HEADER_NAMES as readonly string[]).includes(key) && !(key in headers)) headers[key] = String(raw).trim()
  }
  if (Array.isArray(value)) {
    for (const entry of value) if (entry && typeof entry === 'object') add((entry as { name?: unknown }).name, (entry as { value?: unknown }).value)
  } else if (value && typeof value === 'object') {
    for (const [name, raw] of Object.entries(value as Record<string, unknown>)) add(name, Array.isArray(raw) ? raw[0] : raw)
  }
  return headers
}

export function autoReplyReason(headers: Record<string, string> | null | undefined): string | null {
  if (!headers) return null
  const autoSubmitted = headers['auto-submitted']?.toLowerCase()
  if (autoSubmitted && !/^no\b/.test(autoSubmitted)) return 'auto_submitted'
  if (/^(auto_reply|bulk|junk|list)\b/i.test(headers.precedence ?? '')) return 'precedence'
  if (headers['x-autoreply'] && !/^(no|false|0)$/i.test(headers['x-autoreply'])) return 'x_autoreply'
  if (headers['x-autorespond']) return 'x_autorespond'
  if (/^multipart\/report\b/i.test(headers['content-type'] ?? '')) return 'multipart_report'
  return null
}
