import { isIP } from 'node:net'

function stripAddressDecorations(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('[')) return trimmed.slice(1, trimmed.indexOf(']'))
  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(trimmed)) return trimmed.slice(0, trimmed.lastIndexOf(':'))
  const zone = trimmed.indexOf('%')
  return zone >= 0 ? trimmed.slice(0, zone) : trimmed
}

export function normalizeIpAddress(value: string | null | undefined): string | null {
  if (!value) return null
  const normalized = stripAddressDecorations(value)
  if (normalized.toLowerCase().startsWith('::ffff:')) {
    const mapped = normalized.slice('::ffff:'.length)
    return isIP(mapped) === 4 ? mapped : null
  }
  return isIP(normalized) ? normalized.toLowerCase() : null
}

function ipv4ToBigInt(ip: string): bigint {
  return ip.split('.').reduce((value, part) => (value << BigInt(8)) + BigInt(Number(part)), BigInt(0))
}

function ipv6ToBigInt(ip: string): bigint {
  const [leftRaw, rightRaw = ''] = ip.split('::')
  const parseSide = (side: string): number[] => {
    if (!side) return []
    const parts = side.split(':')
    const out: number[] = []
    for (const part of parts) {
      if (part.includes('.')) {
        const mapped = ipv4ToBigInt(part)
        out.push(Number((mapped >> BigInt(16)) & BigInt(0xffff)), Number(mapped & BigInt(0xffff)))
      } else {
        out.push(parseInt(part || '0', 16))
      }
    }
    return out
  }
  const left = parseSide(leftRaw)
  const right = parseSide(rightRaw)
  const missing = 8 - left.length - right.length
  const groups = ip.includes('::') ? [...left, ...Array(Math.max(0, missing)).fill(0), ...right] : left
  if (groups.length !== 8) throw new Error('invalid_ipv6')
  return groups.reduce((value, group) => (value << BigInt(16)) + BigInt(group), BigInt(0))
}

function ipValue(ip: string): { version: 4 | 6; value: bigint; bits: number } | null {
  const normalized = normalizeIpAddress(ip)
  if (!normalized) return null
  const version = isIP(normalized)
  if (version === 4) return { version: 4, value: ipv4ToBigInt(normalized), bits: 32 }
  if (version === 6) return { version: 6, value: ipv6ToBigInt(normalized), bits: 128 }
  return null
}

export function ipMatchesRule(ip: string, rule: string): boolean {
  const candidate = ipValue(ip)
  if (!candidate) return false
  const [networkText, prefixText] = rule.trim().split('/')
  const network = ipValue(networkText)
  if (!network || network.version !== candidate.version) return false
  if (prefixText === undefined) return network.value === candidate.value
  if (!/^\d+$/.test(prefixText)) return false
  const prefix = Number(prefixText)
  if (prefix < 0 || prefix > candidate.bits) return false
  if (prefix === 0) return true
  const shift = BigInt(candidate.bits - prefix)
  return (candidate.value >> shift) === (network.value >> shift)
}

export function ipAllowedByRules(ip: string | null, rules: string[]): boolean {
  if (rules.length === 0) return true
  return Boolean(ip && rules.some((rule) => ipMatchesRule(ip, rule)))
}

type ProxyTrustEnv = {
  INTEGRATION_API_TRUST_PROXY_HEADERS?: string;
  VERCEL?: string;
};

export function trustIntegrationProxyHeaders(
  env: ProxyTrustEnv = process.env,
): boolean {
  const configured = env.INTEGRATION_API_TRUST_PROXY_HEADERS?.trim().toLowerCase()
  if (configured === 'true' || configured === '1') return true
  if (configured === 'false' || configured === '0') return false
  // Vercel overwrites forwarding headers at its trusted edge. Other runtimes
  // must opt in explicitly, otherwise configured IP allowlists fail closed.
  return env.VERCEL === '1'
}

export function trustedClientIp(
  headers: Pick<Headers, 'get'>,
  env: ProxyTrustEnv = process.env,
): string | null {
  if (!trustIntegrationProxyHeaders(env)) return null
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return normalizeIpAddress(forwarded ?? headers.get('x-real-ip'))
}

