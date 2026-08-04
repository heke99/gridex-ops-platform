import { createHash } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import { generateIntegrationApiToken } from '@/lib/integrations/apiClientSecrets'
import { API_CLIENT_PROFILES } from '@/lib/integrations/apiClientProfiles'
import {
  listPublicContractOffers,
  publicContractResponse,
} from '@/lib/website/publicContracts'
import { mapContractPublicationToPublicDto } from '@/lib/external-contracts/publicationDto'
import { WEBSITE_INTEGRATION_CONTRACT_VERSION } from '@/lib/integrations/websiteIntegrationContract'
import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'
import { reconcileTenantWebsiteCapabilities, type TenantWebsiteReadinessBlocker } from '@/lib/integrations/tenantWebsiteReadiness'

export type TenantWebsiteEnvironment = 'development' | 'staging' | 'production'

export type TenantWebsiteProvisioningInput = {
  companyId: string
  actorUserId: string
  idempotencyKey: string
  allowedOrigins: string[]
  environment?: TenantWebsiteEnvironment
  clientName?: string
  rateLimitPerMinute?: number
  customerPortalUrl: string
  webhook?: {
    endpointUrl: string
    eventTypes: string[]
    signingSecretRef?: string | null
  } | null
}

export type TenantWebsiteProvisioningResult = {
  companyId: string
  apiClientId: string
  tenantReference: string
  environment: TenantWebsiteEnvironment
  state: 'completed' | 'blocked'
  launchReady: boolean
  reusedExistingClient: boolean
  credential: {
    token: string
    keyPrefix: string
  } | null
  contractSchemaVersion: string
  visibleContractCount: number
  portalUrl: string
  webhookSubscriptionId: string | null
  readinessBlockers: TenantWebsiteReadinessBlocker[]
  readinessWarnings: TenantWebsiteReadinessBlocker[]
  receiptId: string
}

type ProvisioningRpcRow = {
  api_client_id: string
  client_created: boolean
  tenant_reference: string
  receipt_id: string
  installation_state: string
}

export class TenantWebsiteProvisioningError extends Error {
  readonly code: string
  readonly receiptId: string | null

  constructor(code: string, message: string, receiptId: string | null = null) {
    super(message)
    this.name = 'TenantWebsiteProvisioningError'
    this.code = code
    this.receiptId = receiptId
  }
}

function normalizeOrigin(value: string): string {
  const input = value.trim()
  if (!input) throw new TenantWebsiteProvisioningError('ORIGIN_REQUIRED', 'Allowed origin is empty.')
  let parsed: URL
  try {
    parsed = new URL(input)
  } catch {
    throw new TenantWebsiteProvisioningError('ORIGIN_INVALID', `Invalid origin: ${input}`)
  }
  if (parsed.protocol !== 'https:') {
    throw new TenantWebsiteProvisioningError(
      'ORIGIN_HTTPS_REQUIRED',
      `Allowed origin must use HTTPS: ${input}`,
    )
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname && parsed.pathname !== '/')
  ) {
    throw new TenantWebsiteProvisioningError(
      'ORIGIN_MUST_NOT_CONTAIN_PATH',
      `Allowed origin must contain only scheme, host and optional port: ${input}`,
    )
  }
  return parsed.origin.toLowerCase()
}

export function normalizeTenantWebsiteOrigins(values: string[]): string[] {
  const normalized = values.map(normalizeOrigin)
  return Array.from(new Set(normalized)).sort()
}

function normalizePortalUrl(value: string): string {
  const input = value.trim()
  if (!input) {
    throw new TenantWebsiteProvisioningError(
      'CUSTOMER_PORTAL_URL_REQUIRED',
      'Tenantens HTTPS-adress till Mina sidor krävs.',
    )
  }
  let parsed: URL
  try {
    parsed = new URL(input)
  } catch {
    throw new TenantWebsiteProvisioningError(
      'CUSTOMER_PORTAL_URL_INVALID',
      'Tenantens Mina sidor-adress är ogiltig.',
    )
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) {
    throw new TenantWebsiteProvisioningError(
      'CUSTOMER_PORTAL_URL_HTTPS_REQUIRED',
      'Tenantens Mina sidor-adress måste vara en ren HTTPS-adress.',
    )
  }
  return parsed.toString()
}

function normalizeWebhookUrl(value: string): string {
  const input = value.trim()
  let parsed: URL
  try {
    parsed = new URL(input)
  } catch {
    throw new TenantWebsiteProvisioningError('WEBHOOK_URL_INVALID', 'Webhook-adressen är ogiltig.')
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) {
    throw new TenantWebsiteProvisioningError('WEBHOOK_URL_HTTPS_REQUIRED', 'Webhook-adressen måste använda HTTPS.')
  }
  return parsed.toString()
}

async function storeTenantPortalUrl(input: {
  companyId: string
  portalUrl: string
  actorUserId: string
}) {
  const now = new Date().toISOString()
  const { data: company, error: loadError } = await supabaseService
    .from('companies')
    .select('branding')
    .eq('id', input.companyId)
    .maybeSingle()
  if (loadError) throw loadError
  const branding = company?.branding && typeof company.branding === 'object' && !Array.isArray(company.branding)
    ? company.branding as Record<string, unknown>
    : {}
  const primary = await supabaseService
    .from('companies')
    .update({
      customer_portal_url: input.portalUrl,
      branding: { ...branding, customer_portal_url: input.portalUrl },
      updated_by: input.actorUserId,
      updated_at: now,
    })
    .eq('id', input.companyId)
  if (!primary.error) return
  if (['42703', 'PGRST204'].includes(primary.error.code ?? '')) {
    throw new TenantWebsiteProvisioningError(
      'TENANT_WEBSITE_SCHEMA_NOT_READY',
      'Databasen saknar companies.customer_portal_url. Kör den senaste migrationen innan tenantintegrationen provisioneras.',
    )
  }
  throw primary.error
}

async function ensureTenantWebhook(input: {
  companyId: string
  apiClientId: string
  actorUserId: string
  clientName: string
  webhook: TenantWebsiteProvisioningInput['webhook']
  receiptId: string
}): Promise<string | null> {
  if (!input.webhook) return null
  const endpointUrl = normalizeWebhookUrl(input.webhook.endpointUrl)
  const eventTypes = Array.from(new Set(input.webhook.eventTypes.map((value) => value.trim()).filter(Boolean))).sort()
  if (eventTypes.length === 0) {
    throw new TenantWebsiteProvisioningError('WEBHOOK_EVENT_TYPES_REQUIRED', 'Minst en webhook-eventtyp krävs.', input.receiptId)
  }
  const { data: existing, error: existingError } = await supabaseService
    .from('webhook_subscriptions')
    .select('id')
    .eq('company_id', input.companyId)
    .eq('api_client_id', input.apiClientId)
    .eq('endpoint_url', endpointUrl)
    .neq('status', 'revoked')
    .maybeSingle()
  if (existingError) throw existingError
  if (existing?.id) {
    const { error } = await supabaseService
      .from('webhook_subscriptions')
      .update({
        event_types: eventTypes,
        status: 'active',
        signing_secret_ref: input.webhook.signingSecretRef?.trim() || null,
        updated_by: input.actorUserId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .eq('company_id', input.companyId)
    if (error) throw error
    return String(existing.id)
  }
  const { data, error } = await supabaseService
    .from('webhook_subscriptions')
    .insert({
      company_id: input.companyId,
      api_client_id: input.apiClientId,
      name: `${input.clientName} · webhook`,
      endpoint_url: endpointUrl,
      event_types: eventTypes,
      status: 'active',
      signing_secret_ref: input.webhook.signingSecretRef?.trim() || null,
      description: `Webhook skapad tillsammans med tenantens canonical webbprovisionering.`,
      created_by: input.actorUserId,
      updated_by: input.actorUserId,
      metadata: {
        created_from: 'canonical_tenant_website_provisioning',
        provisioning_receipt_id: input.receiptId,
        api_client_id: input.apiClientId,
      },
    })
    .select('id')
    .single()
  if (error) throw error
  return String(data.id)
}

function canonicalReceiptHash(input: Record<string, unknown>): string {
  const canonical = JSON.stringify(
    Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b))),
  )
  return createHash('sha256').update(canonical).digest('hex')
}

async function updateReceipt(
  receiptId: string,
  values: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabaseService
    .from('tenant_website_installation_receipts')
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq('id', receiptId)
  if (error) throw error
}

async function loadClient(clientId: string): Promise<IntegrationApiClient> {
  const { data, error } = await supabaseService
    .from('integration_api_clients')
    .select(
      'id,company_id,name,status,key_prefix,secret_hash,scopes,allowed_ips,allowed_origins,metadata,rate_limit_per_minute,expires_at',
    )
    .eq('id', clientId)
    .single()
  if (error) throw error
  return data as IntegrationApiClient
}

/**
 * Canonical, resumable provisioning entry point for one primary tenant website
 * client. The database RPC serializes company/client/receipt changes. External
 * preflight is intentionally resumable and never stores the plaintext token.
 */
export async function provisionTenantWebsiteIntegration(
  input: TenantWebsiteProvisioningInput,
): Promise<TenantWebsiteProvisioningResult> {
  const environment = input.environment ?? 'production'
  const origins = normalizeTenantWebsiteOrigins(input.allowedOrigins)
  const portalUrl = normalizePortalUrl(input.customerPortalUrl)
  if (origins.length === 0) {
    throw new TenantWebsiteProvisioningError(
      'ALLOWED_ORIGIN_REQUIRED',
      'At least one HTTPS origin is required for tenant_website.',
    )
  }
  const idempotencyKey = input.idempotencyKey.trim()
  if (!idempotencyKey) {
    throw new TenantWebsiteProvisioningError(
      'IDEMPOTENCY_KEY_REQUIRED',
      'A stable provisioning idempotency key is required.',
    )
  }

  // Fail before creating a credential when the canonical tenant portal schema
  // is missing. Persisting the URL first is harmless if the later RPC fails,
  // while creating a one-time token before this check could orphan the secret.
  await storeTenantPortalUrl({
    companyId: input.companyId,
    portalUrl,
    actorUserId: input.actorUserId,
  })

  const generated = generateIntegrationApiToken()
  const profile = API_CLIENT_PROFILES.tenant_website
  const { data, error } = await supabaseService.rpc(
    'gridex_provision_tenant_website_client_v1',
    {
      p_company_id: input.companyId,
      p_environment: environment,
      p_client_name: input.clientName?.trim() || 'Tenant website integration',
      p_key_prefix: generated.keyPrefix,
      p_secret_hash: generated.secretHash,
      p_scopes: profile.defaultScopes,
      p_allowed_origins: origins,
      p_rate_limit_per_minute: Math.min(
        Math.max(input.rateLimitPerMinute ?? 120, 1),
        5000,
      ),
      p_actor_user_id: input.actorUserId,
      p_idempotency_key: idempotencyKey,
    },
  )
  if (error) {
    throw new TenantWebsiteProvisioningError(
      String(error.code ?? 'TENANT_WEBSITE_PROVISIONING_FAILED'),
      error.message,
    )
  }
  const row = (Array.isArray(data) ? data[0] : data) as ProvisioningRpcRow | null
  if (!row?.api_client_id || !row.receipt_id || !row.tenant_reference) {
    throw new TenantWebsiteProvisioningError(
      'TENANT_WEBSITE_PROVISIONING_RESULT_INVALID',
      'Provisioning RPC returned an incomplete result.',
      row?.receipt_id ?? null,
    )
  }

  let credential = row.client_created
    ? { token: generated.token, keyPrefix: generated.keyPrefix }
    : null

  try {
    // A normal caught failure marks the receipt failed. Retrying that exact
    // receipt rotates the unrevealed one-time secret so the integration can be
    // recovered without deleting or duplicating the tenant API client.
    if (!row.client_created && row.installation_state === 'failed') {
      const rotateResult = await supabaseService
        .from('integration_api_clients')
        .update({
          key_prefix: generated.keyPrefix,
          secret_hash: generated.secretHash,
          launch_ready: false,
          launch_blockers: [{ code: 'provisioning_retry_in_progress' }],
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.api_client_id)
        .eq('company_id', input.companyId)
      if (rotateResult.error) throw rotateResult.error
      credential = { token: generated.token, keyPrefix: generated.keyPrefix }
    }

    const client = await loadClient(row.api_client_id)
    const webhookSubscriptionId = await ensureTenantWebhook({
      companyId: input.companyId,
      apiClientId: row.api_client_id,
      actorUserId: input.actorUserId,
      clientName: input.clientName?.trim() || 'Tenant website integration',
      webhook: input.webhook ?? null,
      receiptId: row.receipt_id,
    })
    if (client.company_id !== input.companyId) {
      throw new TenantWebsiteProvisioningError(
        'TENANT_CONTEXT_MISMATCH',
        'Den provisionerade API-klienten tillhör inte vald tenant.',
        row.receipt_id,
      )
    }
    const tenantReference = row.tenant_reference.trim()
    if (!tenantReference) {
      throw new TenantWebsiteProvisioningError(
        'TENANT_REFERENCE_MISSING',
        'Tenantens externa referens saknas efter provisionering.',
        row.receipt_id,
      )
    }

    await updateReceipt(row.receipt_id, {
      state: 'preflight_passed',
      tenant_reference: tenantReference,
      contract_schema_version: WEBSITE_INTEGRATION_CONTRACT_VERSION,
      readiness_blockers: [],
      failure_code: null,
      failure_message: null,
    })

    const offers = await listPublicContractOffers({ client })
    const contracts = offers.map((offer) =>
      mapContractPublicationToPublicDto({
        publication: publicContractResponse(offer),
        channel: 'website',
        companyId: input.companyId,
      }),
    )
    const readiness = await reconcileTenantWebsiteCapabilities({
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      client,
    })
    const launchReady = readiness.complete_tenant_website_ready
    const state: TenantWebsiteProvisioningResult['state'] = launchReady ? 'completed' : 'blocked'
    const receiptHash = canonicalReceiptHash({
      company_id: input.companyId,
      api_client_id: row.api_client_id,
      tenant_reference: tenantReference,
      environment,
      contract_schema_version: WEBSITE_INTEGRATION_CONTRACT_VERSION,
      allowed_origins: origins,
      scopes: [...profile.defaultScopes].sort(),
      visible_contract_count: contracts.length,
      portal_url: portalUrl,
      webhook_subscription_id: webhookSubscriptionId,
      readiness_blockers: readiness.blockers.map((blocker) => blocker.code).sort(),
      state,
    })

    await updateReceipt(row.receipt_id, {
      state,
      completed_at: launchReady ? new Date().toISOString() : null,
      receipt_sha256: receiptHash,
      readiness_blockers: readiness.blockers,
      failure_code: launchReady ? null : 'TENANT_WEBSITE_READINESS_BLOCKED',
      failure_message: launchReady
        ? null
        : readiness.blockers.map((blocker) => blocker.message).join(' ').slice(0, 500),
    })
    const { error: clientReadyError } = await supabaseService
      .from('integration_api_clients')
      .update({
        launch_ready: launchReady,
        launch_blockers: readiness.blockers,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.api_client_id)
    if (clientReadyError) throw clientReadyError

    return {
      companyId: input.companyId,
      apiClientId: row.api_client_id,
      tenantReference,
      environment,
      state,
      launchReady,
      reusedExistingClient: !row.client_created,
      credential,
      contractSchemaVersion: WEBSITE_INTEGRATION_CONTRACT_VERSION,
      visibleContractCount: contracts.length,
      portalUrl,
      webhookSubscriptionId,
      readinessBlockers: readiness.blockers,
      readinessWarnings: readiness.warnings,
      receiptId: row.receipt_id,
    }
  } catch (cause) {
    const code =
      cause instanceof TenantWebsiteProvisioningError
        ? cause.code
        : cause && typeof cause === 'object' && 'code' in cause
          ? String((cause as { code?: unknown }).code ?? 'TENANT_WEBSITE_PREFLIGHT_FAILED')
          : 'TENANT_WEBSITE_PREFLIGHT_FAILED'
    const message = cause instanceof Error ? cause.message : String(cause)
    await updateReceipt(row.receipt_id, {
      state: 'failed',
      failure_code: code,
      failure_message: message.slice(0, 500),
      readiness_blockers: [{ code }],
    }).catch(() => undefined)
    const clientFailureResult = await supabaseService
      .from('integration_api_clients')
      .update({
        launch_ready: false,
        launch_blockers: [{ code }],
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.api_client_id)
      .eq('company_id', input.companyId)
    if (clientFailureResult.error) {
      console.error('[tenant-website-provisioning] failed to persist client blocker', {
        clientId: row.api_client_id,
        companyId: input.companyId,
        originalCode: code,
        persistenceError: clientFailureResult.error,
      })
    }
    throw cause
  }
}
