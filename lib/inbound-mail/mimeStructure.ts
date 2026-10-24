// Bounded structural traversal shared by DSN classification and disposition.
// Body prose and returned EDIFACT never become MIME headers.
export type MimeEntity = {
  index: number
  parent: number | null
  headers: ReadonlyMap<string, readonly string[]>
  mediaType: string
  contentType: string
  body: string
}

export function mimeFields(block: string): Map<string, string[]> {
  const fields = new Map<string, string[]>()
  for (const line of block.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const match = /^([!-9;-~]+):[ \t]*(.*)$/.exec(line)
    if (!match) continue
    const name = match[1].toLowerCase()
    fields.set(name, [...(fields.get(name) ?? []), match[2].trim()])
  }
  return fields
}

export function mimeParameter(contentType: string, name: string): string | null {
  const match = contentType.match(new RegExp(`;\\s*${name}\\s*=\\s*(?:"([^"\\r\\n]*)"|([^;\\s]+))`, 'i'))
  if (match) return match[1] ?? match[2]
  const extended = contentType.match(new RegExp(`;\\s*${name}\\*\\s*=\\s*(?:"([^"\\r\\n]*)"|([^;\\s]+))`, 'i'))
  const encoded = /^(?:utf-8|us-ascii)'[^']*'(.*)$/i.exec(extended?.[1] ?? extended?.[2] ?? '')
  if (!encoded) return null
  try { return decodeURIComponent(encoded[1]) } catch { return null }
}

// preserveBytes keeps every decoded body as a byte-preserving latin1 "binary"
// string so callers can decode it with the part's own charset.
function decodedBody(body: string, encoding: string, preserveBytes = false): string {
  if (preserveBytes) {
    if (encoding === 'base64') return Buffer.from(body.replace(/\s/g, ''), 'base64').toString('latin1')
    if (encoding === 'quoted-printable') {
      return body.replace(/[ \t]+(?=\r?\n)/g, '').replace(/=\r?\n/g, '').replace(/=([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    }
    return body
  }
  if (encoding === 'base64') return Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8')
  if (encoding === 'quoted-printable') {
    const bytes = body.replace(/=\r?\n/g, '').replace(/=([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    return Buffer.from(bytes, 'latin1').toString('utf8')
  }
  return body
}

// Repeated regex groups can exhaust V8's stack on ordinary multi-MiB files.
// Validate alphabet, quartet length and terminal padding with one linear pass.
function validBase64(body: string): boolean {
  const compact = body.replace(/\s/g, '')
  if (compact.length % 4 !== 0) return false
  let padding = 0
  for (let i = 0; i < compact.length; i++) {
    const code = compact.charCodeAt(i)
    if (code === 61) {
      if (++padding > 2) return false
    } else if (padding || !(code >= 65 && code <= 90 || code >= 97 && code <= 122 || code >= 48 && code <= 57 || code === 43 || code === 47)) return false
  }
  return true
}

// With preserveBytes the input must be a latin1 "binary" string of the raw
// message bytes; entity bodies stay byte-preserving and entities are listed in
// document order.
export function inspectMimeStructure(raw: string, options: { preserveBytes?: boolean } = {}): { entities: MimeEntity[]; issues: string[]; deliveryStatus: boolean; exceededLimits: boolean } {
  const entities: MimeEntity[] = []
  const issues = new Set<string>()
  const pending = [{ raw, parent: null as number | null, depth: 0 }]
  let deliveryStatus = false
  let exceededLimits = false
  while (pending.length) {
    const next = pending.pop()!
    if (next.depth > 16 || entities.length >= 256 || next.raw.length > 25 * 1024 * 1024) {
      exceededLimits = true; issues.add('mime_structure_limit'); continue
    }
    // A MIME part may have an empty header section: one leading CRLF (or LF).
    const emptyHeaderLength = next.raw.startsWith('\r\n') ? 2 : next.raw.startsWith('\n') ? 1 : 0
    const separator = emptyHeaderLength ? 0 : next.raw.search(/\r?\n\r?\n/)
    if (separator < 0) continue
    if (separator > 65536) { exceededLimits = true; issues.add('mime_header_limit'); continue }
    const headers = mimeFields(next.raw.slice(0, separator))
    const contentTypes = headers.get('content-type') ?? ['text/plain']
    for (const contentType of contentTypes) {
      const mediaType = contentType.split(';')[0].trim().toLowerCase()
      if (['message/delivery-status', 'message/global-delivery-status'].includes(mediaType) ||
          mediaType === 'multipart/report' && /^(global-)?delivery-status$/i.test(mimeParameter(contentType, 'report-type') ?? '')) deliveryStatus = true
    }
    if (contentTypes.length !== 1) { issues.add('mime_content_type_ambiguous'); continue }
    const contentType = contentTypes[0]
    const mediaType = contentType.split(';')[0].trim().toLowerCase()
    const encodings = headers.get('content-transfer-encoding') ?? ['7bit']
    if (encodings.length !== 1) { issues.add('mime_transfer_encoding_ambiguous'); continue }
    const encoding = encodings[0].toLowerCase()
    const encodedBody = emptyHeaderLength ? next.raw.slice(emptyHeaderLength) : next.raw.slice(separator).replace(/^\r?\n\r?\n/, '')
    if (encoding === 'base64' && !validBase64(encodedBody)) issues.add('mime_transfer_encoding_invalid')
    if (!['7bit','8bit','binary','base64','quoted-printable'].includes(encoding)) issues.add('mime_transfer_encoding_unsupported')
    const body = decodedBody(encodedBody, encoding, options.preserveBytes)
    const index = entities.length
    entities.push({ index, parent: next.parent, headers, mediaType, contentType, body })
    if (mediaType === 'message/rfc822' || mediaType === 'message/global') {
      pending.push({ raw: body, parent: index, depth: next.depth + 1 }); continue
    }
    if (!mediaType.startsWith('multipart/')) continue
    const boundary = mimeParameter(contentType, 'boundary')
    if (!boundary || boundary.length > 70) { issues.add('mime_boundary_invalid'); continue }
    let closed = false
    const children: { raw: string; parent: number; depth: number }[] = []
    const enqueue = (rawPart: string) => {
      if (pending.length + children.length + entities.length >= 256) { exceededLimits = true; issues.add('mime_structure_limit'); return }
      children.push({ raw: rawPart, parent: index, depth: next.depth + 1 })
    }
    if (options.preserveBytes) {
      const open = `--${boundary}`, close = `${open}--`
      let partStart: number | null = null
      let lineStart = 0
      while (lineStart < body.length) {
        const newline = body.indexOf('\n', lineStart)
        const lineEnd = newline < 0 ? body.length : newline
        if (body.startsWith(open, lineStart)) {
          const marker = body.slice(lineStart, lineEnd).replace(/\r$/, '').replace(/[ \t]+$/, '')
          if (marker === open || marker === close) {
            if (partStart !== null) {
              // The CRLF immediately before a delimiter belongs to that
              // delimiter, not the payload. Preserve every earlier byte.
              let partEnd = lineStart
              if (partEnd && body[partEnd - 1] === '\n') {
                partEnd--
                if (partEnd && body[partEnd - 1] === '\r') partEnd--
              }
              enqueue(body.slice(partStart, partEnd))
            }
            partStart = marker === close ? null : newline < 0 ? body.length : newline + 1
            if (marker === close) { closed = true; break }
          }
        }
        if (newline < 0) break
        lineStart = newline + 1
      }
      if (partStart !== null && partStart < body.length) enqueue(body.slice(partStart))
    } else {
      // Keep the legacy decoded-text traversal's line normalization/order.
      let part: string[] | null = null
      for (const line of body.split(/\r?\n/)) {
        const marker = line.replace(/[ \t]+$/, '')
        if (marker === `--${boundary}` || marker === `--${boundary}--`) {
          if (part) enqueue(part.join('\r\n'))
          part = marker === `--${boundary}--` ? null : []
          if (marker === `--${boundary}--`) { closed = true; break }
        } else if (part) part.push(line)
      }
      if (part?.length) enqueue(part.join('\r\n'))
    }
    // The traversal stack pops last-in first: push children reversed to visit
    // them in document order when the caller asked for it.
    pending.push(...(options.preserveBytes ? children.reverse() : children))
    if (!closed) issues.add('mime_boundary_unclosed')
  }
  return { entities, issues: [...issues], deliveryStatus, exceededLimits }
}
