/** Parse an If-None-Match wildcard or a comma-separated list of entity tags. */
export function parseIfNoneMatch(header: string | null): '*' | string[] {
  if (!header) return []
  const trimmed = header.trim()
  if (trimmed === '*') return '*'
  const tags: string[] = []
  // List recipients ignore empty elements while keeping commas inside a quoted tag.
  const pattern = /\s*(?:(W\/)?("[\x21\x23-\x7e\x80-\xff]*")\s*)?(?:,|$)/gy
  let match: RegExpExecArray | null
  while (pattern.lastIndex < trimmed.length && (match = pattern.exec(trimmed))) {
    if (match[2] !== undefined) tags.push(`${match[1] ?? ''}${match[2]}`)
  }
  return tags
}

function opaqueTag(tag: string): string {
  return tag.startsWith('W/') ? tag.slice(2) : tag
}

/** GET/HEAD validators use weak comparison (RFC 9110 §13.1.2).
 * For protected resources, call only after authorization and selecting the representation. */
export function ifNoneMatchMatches(request: Pick<Request, 'headers'>, etag: string): boolean {
  const parsed = parseIfNoneMatch(request.headers.get('if-none-match'))
  if (parsed === '*') return true
  const current = opaqueTag(etag)
  return parsed.some((tag) => opaqueTag(tag) === current)
}
