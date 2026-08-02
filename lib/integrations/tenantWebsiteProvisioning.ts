import { createHash } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import { generateIntegrationApiToken } from '@/lib/integrations/apiClientSecrets'
import { API_CLIENT_PROFILES } from '@/lib/integrations/apiClientProfiles'
import { loadExternalTenantContext } from '@/lib/integrations/tenantContext'
import {
  listPublicContractOffers,
  publicContractResponse,
} from '@/lib/website/publicContracts'
import { mapContractPublicationToPublicDto } from '@/lib/external-contracts/publicationDto'
import { WEBSITE_INTEGRATION_CONTRACT_VERSION } from '@/lib/integrations/websiteIntegrationContract'
import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'

export type TenantWebsiteEnvironment = 'development' | 'staging' | 'production'

export type TenantWebsiteProvisioningInput = {
  companyId: string
  actorUserId: string
  idempotencyKey: string
  allowedOrigins: string[]
  environment?: TenantWebsiteEnvironment
  clientName?: string
  rateLimitPerMinute?: number
}

export type TenantWebsiteProvisioningResult = {
  companyId: string
  apiClientId: string
  tenantReference: string
  environment: TenantWebsiteEnvironment
  state: 'completed'
  reusedExistingClient: boolean
  credential: {
    token: string
    keyPrefix: string
  } | null
  contractSchemaVersion: string
  visibleContractCount: number
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

  try {
    const client = await loadClient(row.api_client_id)
    const tenant = await loadExternalTenantContext(client)
    if (tenant.tenant_reference !== row.tenant_reference) {
      throw new TenantWebsiteProvisioningError(
        'TENANT_REFERENCE_MISMATCH',
        'Integration context returned a different tenant reference.',
        row.receipt_id,
      )
    }
    if (tenant.contract_version !== WEBSITE_INTEGRATION_CONTRACT_VERSION) {
      throw new TenantWebsiteProvisioningError(
        'CONTRACT_SCHEMA_VERSION_MISMATCH',
        'Integration context returned a different contract schema version.',
        row.receipt_id,
      )
    }

    await updateReceipt(row.receipt_id, {
      state: 'preflight_passed',
      tenant_reference: tenant.tenant_reference,
      contract_schema_version: tenant.contract_version,
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
    const receiptHash = canonicalReceiptHash({
      company_id: input.companyId,
      api_client_id: row.api_client_id,
      tenant_reference: tenant.tenant_reference,
      environment,
      contract_schema_version: tenant.contract_version,
      allowed_origins: origins,
      scopes: [...profile.defaultScopes].sort(),
      visible_contract_count: contracts.length,
      state: 'completed',
    })

    await updateReceipt(row.receipt_id, {
      state: 'completed',
      completed_at: new Date().toISOString(),
      receipt_sha256: receiptHash,
      readiness_blockers: [],
      failure_code: null,
      failure_message: null,
    })
    const { error: clientReadyError } = await supabaseService
      .from('integration_api_clients')
      .update({
        launch_ready: true,
        launch_blockers: [],
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.api_client_id)
    if (clientReadyError) throw clientReadyError

    return {
      companyId: input.companyId,
      apiClientId: row.api_client_id,
      tenantReference: tenant.tenant_reference,
      environment,
      state: 'completed',
      reusedExistingClient: !row.client_created,
      credential: row.client_created
        ? { token: generated.token, keyPrefix: generated.keyPrefix }
        : null,
      contractSchemaVersion: tenant.contract_version,
      visibleContractCount: contracts.length,
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
    await supabaseService
      .from('integration_api_clients')
      .update({
        launch_ready: false,
        launch_blockers: [{ code }],
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.api_client_id)
      .then(() => undefined)
    throw cause
  }
}
