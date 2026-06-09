import { randomBytes, createHash } from 'node:crypto'
import { ALLOWED_INTEGRATION_API_SCOPE_VALUES } from '@/lib/integrations/apiClientScopes'

export function normalizeIntegrationApiScopes(values: unknown[]): string[] {
  const scopes = values
    .flatMap((value) => String(value ?? '').split(/[\s,]+/))
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && ALLOWED_INTEGRATION_API_SCOPE_VALUES.has(value))

  return Array.from(new Set(scopes))
}

export function hashIntegrationApiSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

function randomBase64Url(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function generateIntegrationApiToken(): { token: string; keyPrefix: string; secretHash: string } {
  // apiAuth uses token.slice(0, 12) for lookup. Keep the prefix exactly 12 chars.
  const keyPrefix = `gdxp_${randomBytes(8).toString('hex').slice(0, 7)}`
  const token = `${keyPrefix}.${randomBase64Url(32)}`
  return {
    token,
    keyPrefix,
    secretHash: hashIntegrationApiSecret(token),
  }
}

export function parseMultiValueText(value: unknown): string[] {
  return String(value ?? '')
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}
