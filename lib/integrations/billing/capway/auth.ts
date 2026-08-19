import { supabaseService } from '@/lib/supabase/service'
import type {
  CapwayAuthMode,
  CapwayConnectionConfig,
  CapwayEnvironment,
  CapwayTokenResponse,
} from '@/lib/integrations/billing/capway/types'

// Default OAuth2 env names:
// CAPWAY_APTIC_TEST_TOKEN_URL, CAPWAY_APTIC_TEST_BASE_URL,
// CAPWAY_APTIC_TEST_CLIENT_ID, CAPWAY_APTIC_TEST_CLIENT_SECRET.
// Production equivalents use CAPWAY_APTIC_PROD_*.
// API-key connections use CAPWAY_APTIC_<ENV>_API_KEY and must explicitly
// configure settings.api_key_header; we do not guess provider header names.

type CachedToken = {
  accessToken: string
  expiresAt: number
}

const tokenCache = new Map<string, CachedToken>()

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function envSecret(name: string | null | undefined): string | null {
  if (!name) return null
  return process.env[name] ?? null
}

function defaultEnvPrefix(environment: CapwayEnvironment): string {
  return environment === 'production' ? 'CAPWAY_APTIC_PROD' : 'CAPWAY_APTIC_TEST'
}

function missingRelation(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null
  return Boolean(
    maybe &&
      (maybe.code === '42P01' ||
        maybe.code === 'PGRST205' ||
        /does not exist|schema cache/i.test(maybe.message ?? '')),
  )
}

function normalizeAuthMode(value: unknown): CapwayAuthMode {
  return stringValue(value)?.toLowerCase() === 'apikey' ? 'apikey' : 'oauth2'
}

export async function resolveCapwayConnectionConfig(input: {
  companyId: string
  environment?: CapwayEnvironment
  allowIncompleteStatus?: boolean
}): Promise<CapwayConnectionConfig> {
  const environment = input.environment ?? 'test'
  let settings: Record<string, unknown> = {}
  let secretReference: Record<string, unknown> = {}
  let connectionStatus: string | null = null

  let query = supabaseService
    .from('billing_provider_connections')
    .select('*')
    .eq('company_id', input.companyId)
    .eq('provider', 'capway_aptic')
    .eq('environment', environment)
    .order('updated_at', { ascending: false })
    .limit(1)

  if (!input.allowIncompleteStatus) {
    query = query.in('status', ['ready', 'active'])
  }

  const { data, error } = await query.maybeSingle()

  if (error && !missingRelation(error)) throw error
  if (data) {
    const row = data as Record<string, unknown>
    connectionStatus = stringValue(row.status)
    settings = isObject(row.settings) ? row.settings : {}
    secretReference = isObject(row.secret_reference) ? row.secret_reference : {}
  }

  if (
    data &&
    !input.allowIncompleteStatus &&
    connectionStatus &&
    !['ready', 'active'].includes(connectionStatus)
  ) {
    throw new Error(`Capway/Aptic-kopplingen är ${connectionStatus} och får inte användas för export.`)
  }

  const prefix = defaultEnvPrefix(environment)
  const authMode = normalizeAuthMode(settings.auth_mode)
  const baseUrl =
    stringValue(settings.base_url) ??
    envSecret(stringValue(secretReference.base_url_env)) ??
    process.env[`${prefix}_BASE_URL`]

  const tokenUrl =
    stringValue(settings.token_url) ??
    envSecret(stringValue(secretReference.token_url_env)) ??
    process.env[`${prefix}_TOKEN_URL`] ??
    null
  const clientId =
    envSecret(stringValue(secretReference.client_id_env)) ??
    process.env[`${prefix}_CLIENT_ID`] ??
    null
  const clientSecret =
    envSecret(stringValue(secretReference.client_secret_env)) ??
    process.env[`${prefix}_CLIENT_SECRET`] ??
    null
  const apiKey =
    envSecret(stringValue(secretReference.api_key_env)) ??
    process.env[`${prefix}_API_KEY`] ??
    null
  const apiKeyHeader = stringValue(settings.api_key_header)

  const missing = [!baseUrl ? 'base_url' : null]
  if (authMode === 'oauth2') {
    missing.push(
      !tokenUrl ? 'token_url' : null,
      !clientId ? 'client_id' : null,
      !clientSecret ? 'client_secret' : null,
    )
  } else {
    missing.push(!apiKey ? 'api_key' : null, !apiKeyHeader ? 'api_key_header' : null)
  }
  const missingFields = missing.filter((value): value is string => Boolean(value))

  if (missingFields.length > 0) {
    throw new Error(
      `Capway/Aptic är inte färdigkonfigurerad (${missingFields.join(', ')} saknas).`,
    )
  }

  return {
    companyId: input.companyId,
    environment,
    provider: 'capway_aptic',
    baseUrl: baseUrl!.replace(/\/+$/, ''),
    authMode,
    tokenUrl,
    clientId,
    clientSecret,
    apiKey,
    apiKeyHeader,
    defaultService: stringValue(settings.default_service) ?? 'Invoicing',
    defaultPaymentCode: stringValue(settings.default_payment_code),
    defaultPrintCode: stringValue(settings.default_print_code),
    defaultFormCode: stringValue(settings.default_form_code),
    defaultPaymentProductCode:
      stringValue(settings.default_payment_product_code) ?? 'INVOICE',
    defaultPreferredChannel:
      stringValue(settings.default_preferred_channel) ?? 'Email',
    defaultFinancingMode:
      (stringValue(settings.default_financing_mode) as CapwayConnectionConfig['defaultFinancingMode']) ??
      'invoice_service',
    rawSettings: settings,
  }
}

export async function getCapwayAccessToken(
  config: CapwayConnectionConfig,
): Promise<string> {
  if (config.authMode !== 'oauth2') {
    throw new Error('Capway OAuth-token begärdes för en API-key-konfiguration.')
  }
  if (!config.tokenUrl || !config.clientId || !config.clientSecret) {
    throw new Error(
      'Capway/Aptic är inte färdigkonfigurerad (OAuth token_url/client_id/client_secret saknas).',
    )
  }

  const cacheKey = `${config.companyId}:${config.environment}`
  const cached = tokenCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.accessToken

  const body = new URLSearchParams()
  body.set('grant_type', String(config.rawSettings?.grant_type ?? 'client_credentials'))
  body.set('client_id', config.clientId)
  body.set('client_secret', config.clientSecret)
  const scope = stringValue(config.rawSettings?.scope)
  if (scope) body.set('scope', scope)
  const audience = stringValue(config.rawSettings?.audience)
  if (audience) body.set('audience', audience)

  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(new Error('Capway token timeout')),
    15_000,
  )
  let response: Response
  try {
    response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
      cache: 'no-store',
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }

  const payload = (await response.json().catch(() => ({}))) as Partial<CapwayTokenResponse> & {
    error?: string
    error_description?: string
  }
  if (!response.ok || !payload.access_token) {
    throw new Error(
      `Capway token kunde inte hämtas (${response.status}): ${payload.error_description ?? payload.error ?? 'okänt fel'}`,
    )
  }

  const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : 3300
  tokenCache.set(cacheKey, {
    accessToken: payload.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  })
  return payload.access_token
}

export function clearCapwayTokenCache(companyId?: string) {
  if (!companyId) return tokenCache.clear()
  for (const key of tokenCache.keys()) {
    if (key.startsWith(`${companyId}:`)) tokenCache.delete(key)
  }
}
