// Classify MIME structure before inspecting returned message contents. A DSN
// identifies a transport report, never an authenticated delivery outcome.
export function isDeliveryStatusNotification(raw: string | null | undefined): boolean {
  if (!raw) return false
  const pending = [raw]
  while (pending.length) {
    const entity = pending.pop()!
    const separator = entity.search(/\r?\n\r?\n/)
    if (separator < 0) continue
    const headers = entity.slice(0, separator).replace(/\r?\n[ \t]+/g, ' ')
    const contentTypes = [...headers.matchAll(/^content-type:[ \t]*(.*)$/gim)]
    for (const match of contentTypes) {
      const contentType = match[1].trim()
      const mediaType = contentType.split(';')[0].trim().toLowerCase()
      const parameter = (name: string) => {
        const value = contentType.match(new RegExp(`;\\s*${name}\\s*=\\s*(?:"([^"\\r\\n]*)"|([^;\\s]+))`, 'i'))
        return value?.[1] ?? value?.[2] ?? null
      }
      if (mediaType === 'message/delivery-status' || mediaType === 'message/global-delivery-status') return true
      if (mediaType === 'multipart/report' && /^(global-)?delivery-status$/i.test(parameter('report-type') ?? '')) return true
      const body = entity.slice(separator).replace(/^\r?\n\r?\n/, '')
      if (mediaType === 'message/rfc822' || mediaType === 'message/global') {
        const encoding = headers.match(/^content-transfer-encoding:[ \t]*(.*)$/im)?.[1].trim().toLowerCase()
        pending.push(encoding === 'base64' ? Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8') :
          encoding === 'quoted-printable' ? body.replace(/=\r?\n/g, '').replace(/=([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))) : body)
        continue
      }
      // Traverse actual MIME entities, never MIME-looking plain body text.
      const boundary = parameter('boundary')
      if (!mediaType.startsWith('multipart/') || !boundary) continue
      let part: string[] | null = null
      for (const line of body.split(/\r?\n/)) {
        const marker = line.replace(/[ \t]+$/, '')
        if (marker === `--${boundary}` || marker === `--${boundary}--`) {
          if (part) pending.push(part.join('\r\n'))
          part = marker === `--${boundary}--` ? null : []
          if (marker === `--${boundary}--`) break
        } else if (part) part.push(line)
      }
      if (part?.length) pending.push(part.join('\r\n'))
    }
  }
  return false
}
