import { lookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'

const MAX_WEBHOOK_RESPONSE_BYTES = 64 * 1024

type PublicAddress = { address: string; family: 4 | 6 }

export class PublicWebhookTargetError extends Error {
  constructor(message = 'Webhook target must be a publicly routable HTTPS endpoint.') {
    super(message)
    this.name = 'PublicWebhookTargetError'
  }
}

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '')
}

function ipv4Bytes(address: string): number[] | null {
  if (isIP(address) !== 4) return null
  const bytes = address.split('.').map(Number)
  return bytes.length === 4 && bytes.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)
    ? bytes
    : null
}

export function isDisallowedWebhookAddress(address: string): boolean {
  const normalized = normalizeHost(address.trim().split('%')[0])
  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1]
  if (mappedIpv4) return isDisallowedWebhookAddress(mappedIpv4)

  const v4 = ipv4Bytes(normalized)
  if (v4) {
    const [a, b, c] = v4
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    )
  }

  if (isIP(normalized) === 6) {
    // Fail closed to the IANA global-unicast allocation (2000::/3). This blocks
    // loopback, link-local, ULA, multicast, NAT64 and other special-use prefixes.
    const firstHextet = Number.parseInt(normalized.split(':', 1)[0], 16)
    if (!Number.isFinite(firstHextet) || firstHextet < 0x2000 || firstHextet > 0x3fff) {
      return true
    }
    return (
      /^2001:db8(?::|$)/.test(normalized) || // documentation
      /^2002(?::|$)/.test(normalized) || // 6to4 embeds an IPv4 target
      /^3fff:(?:0|[0-9a-f]{1,3})(?::|$)/.test(normalized) // documentation allocation
    )
  }

  return true
}

export function parsePublicWebhookUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new PublicWebhookTargetError()
  }

  const hostname = normalizeHost(url.hostname)
  if (
    url.protocol !== 'https:' ||
    !hostname ||
    url.username ||
    url.password ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new PublicWebhookTargetError()
  }

  if (isIP(hostname) && isDisallowedWebhookAddress(hostname)) {
    throw new PublicWebhookTargetError()
  }

  return url
}

async function resolvePublicAddresses(url: URL): Promise<PublicAddress[]> {
  const hostname = normalizeHost(url.hostname)
  const family = isIP(hostname)
  if (family) {
    if (isDisallowedWebhookAddress(hostname)) throw new PublicWebhookTargetError()
    return [{ address: hostname, family: family as 4 | 6 }]
  }

  let addresses: PublicAddress[]
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true }) as PublicAddress[]
  } catch {
    throw new PublicWebhookTargetError('Webhook target hostname could not be resolved.')
  }

  if (!addresses.length || addresses.some((item) => isDisallowedWebhookAddress(item.address))) {
    throw new PublicWebhookTargetError()
  }
  return addresses
}

export async function assertPublicWebhookTarget(raw: string): Promise<URL> {
  const url = parsePublicWebhookUrl(raw)
  await resolvePublicAddresses(url)
  return url
}

export async function postPublicWebhook(input: {
  url: string
  headers: Headers
  body: string
  signal: AbortSignal
}): Promise<{ status: number; ok: boolean; body: string }> {
  const url = parsePublicWebhookUrl(input.url)
  const addresses = await resolvePublicAddresses(url)
  const pinned = addresses[0]

  return await new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        method: 'POST',
        headers: Object.fromEntries(input.headers.entries()),
        signal: input.signal,
        lookup: (_hostname, _options, callback) => {
          callback(null, pinned.address, pinned.family)
        },
      },
      (response) => {
        const chunks: Buffer[] = []
        let size = 0
        response.on('data', (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          size += buffer.length
          if (size > MAX_WEBHOOK_RESPONSE_BYTES) {
            response.destroy(new Error('webhook_response_too_large'))
            return
          }
          chunks.push(buffer)
        })
        response.on('end', () => {
          const status = response.statusCode ?? 0
          resolve({
            status,
            ok: status >= 200 && status < 300,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        })
        response.on('error', reject)
      },
    )
    req.on('error', reject)
    req.end(input.body)
  })
}
