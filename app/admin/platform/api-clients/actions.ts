'use server'

import { revalidatePath } from 'next/cache'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import {
  generateIntegrationApiToken,
  normalizeIntegrationApiScopes,
  parseMultiValueText,
} from '@/lib/integrations/apiClientSecrets'
import { recommendedPermissionGroups, scopesForPermissionGroups } from '@/lib/integrations/apiClientScopes'

export type CreateApiClientState = {
  ok: boolean
  message: string
  token?: string
  keyPrefix?: string
  clientId?: string
}

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim()
}

function intValue(formData: FormData, key: string, fallback: number): number {
  const parsed = Number.parseInt(String(formData.get(key) ?? ''), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, 1), 5000)
}

function nullableDate(formData: FormData, key: string): string | null {
  const value = text(formData, key)
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}


function normalizedWebhookRef(value: string): string | null {
  const cleaned = value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_').replace(/_+/g, '_')
  return cleaned || null
}

function validWebhookUrl(value: string): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    const message = record.message ?? record.error_description ?? record.error
    if (typeof message === 'string') return message
  }
  return 'Åtgärden kunde inte utföras.'
}

async function auditApiClient(input: {
  action: string
  actorUserId: string
  companyId: string | null
  clientId: string
  metadata?: Record<string, unknown>
}) {
  await supabaseService
    .from('audit_logs')
    .insert({
      company_id: input.companyId,
      actor_user_id: input.actorUserId,
      entity_type: 'integration_api_client',
      entity_id: input.clientId,
      action: input.action,
      old_values: null,
      new_values: null,
      metadata: input.metadata ?? {},
    })
    .then(() => null)
}

export async function createIntegrationApiClientAction(
  _previousState: CreateApiClientState,
  formData: FormData
): Promise<CreateApiClientState> {
  try {
    const context = await requirePlatformAdminActionAccess()
    const companyId = text(formData, 'companyId')
    const name = text(formData, 'name')
    if (!companyId) return { ok: false, message: 'Välj tenant/bolag.' }
    if (!name) return { ok: false, message: 'Ange namn på API-klienten.' }

    const permissionGroups = formData.getAll('permissionGroups').length > 0
      ? formData.getAll('permissionGroups').map((value) => String(value))
      : recommendedPermissionGroups()
    const groupedScopes = scopesForPermissionGroups(permissionGroups)
    const directScopes = normalizeIntegrationApiScopes(formData.getAll('scopes'))
    const scopes = Array.from(new Set([...groupedScopes, ...directScopes]))
    if (scopes.length === 0) return { ok: false, message: 'Välj minst en behörighetsgrupp.' }

    const allowedOrigins = parseMultiValueText(formData.get('allowedOrigins'))
    const allowedIps = parseMultiValueText(formData.get('allowedIps'))
    const intendedUse = text(formData, 'intendedUse') || 'gridex_customer_portal'
    const frontendApp = text(formData, 'frontendApp') || 'Gridex hemsida'
    const notes = text(formData, 'notes')
    const rateLimit = intValue(formData, 'rateLimitPerMinute', 120)
    const expiresAt = nullableDate(formData, 'expiresAt')
    const webhookUrlInput = text(formData, 'webhookUrl')
    const webhookUrl = validWebhookUrl(webhookUrlInput)
    const webhookEventTypes = parseMultiValueText(formData.get('webhookEventTypes'))
    const webhookSigningSecretRef = normalizedWebhookRef(text(formData, 'webhookSigningSecretRef'))

    if (webhookUrlInput && !webhookUrl) {
      return { ok: false, message: 'Webhook URL måste börja med https://.' }
    }

    const { data: company, error: companyError } = await supabaseService
      .from('companies')
      .select('id,name,status')
      .eq('id', companyId)
      .maybeSingle()

    if (companyError) throw companyError
    if (!company) return { ok: false, message: 'Bolaget hittades inte.' }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const tokenData = generateIntegrationApiToken()
      const { data, error } = await supabaseService
        .from('integration_api_clients')
        .insert({
          company_id: companyId,
          name,
          status: 'active',
          key_prefix: tokenData.keyPrefix,
          secret_hash: tokenData.secretHash,
          scopes,
          permission_groups: permissionGroups,
          purpose_label: frontendApp,
          allowed_origins: allowedOrigins,
          allowed_ips: allowedIps,
          rate_limit_per_minute: rateLimit,
          expires_at: expiresAt,
          created_by: context.userId,
          metadata: {
            frontend_app: frontendApp,
            intended_use: intendedUse,
            allowed_origins: allowedOrigins,
            notes,
            permission_groups: permissionGroups,
            token_display: 'shown_once_on_create',
            created_from: 'superadmin_api_client_ui',
            recommended_header: 'Authorization: Bearer <token>',
          },
        })
        .select('id')
        .single()

      if (error) {
        if (error.code === '23505') continue
        throw error
      }

      await auditApiClient({
        action: 'api_client.created',
        actorUserId: context.userId,
        companyId,
        clientId: data.id,
        metadata: { scopes, permissionGroups, allowedOrigins, frontendApp, intendedUse },
      })

      if (webhookUrl) {
        const { error: webhookError } = await supabaseService
          .from('webhook_subscriptions')
          .insert({
            company_id: companyId,
            api_client_id: data.id,
            name: `${name} · webhook`,
            endpoint_url: webhookUrl,
            event_types: webhookEventTypes.length > 0 ? webhookEventTypes : ['customer.created', 'contract.application_received', 'invoice.sent'],
            status: 'active',
            signing_secret_ref: webhookSigningSecretRef,
            description: `Webhook skapad tillsammans med API-klienten ${name}.`,
            created_by: context.userId,
            updated_by: context.userId,
            metadata: {
              created_from: 'superadmin_api_client_ui',
              api_client_id: data.id,
              signing_secret_ref: webhookSigningSecretRef,
            },
          })

        if (webhookError) throw webhookError
        await auditApiClient({
          action: 'api_client.webhook_created',
          actorUserId: context.userId,
          companyId,
          clientId: data.id,
          metadata: { webhookUrl, webhookEventTypes, webhookSigningSecretRef },
        })
      }

      revalidatePath('/admin/platform/api-clients')
      return {
        ok: true,
        message: 'API-klient skapad. Kopiera token nu; den visas bara en gång.',
        token: tokenData.token,
        keyPrefix: tokenData.keyPrefix,
        clientId: data.id,
      }
    }

    return { ok: false, message: 'Kunde inte skapa unik API-token. Försök igen.' }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

export async function setIntegrationApiClientStatusAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const clientId = text(formData, 'clientId')
  const status = text(formData, 'status')
  const reason = text(formData, 'reason') || null

  if (!clientId) throw new Error('API-klient saknas.')
  if (!['active', 'paused', 'revoked'].includes(status)) throw new Error('Ogiltig status.')

  const { data: current, error: currentError } = await supabaseService
    .from('integration_api_clients')
    .select('id,company_id,status')
    .eq('id', clientId)
    .maybeSingle()

  if (currentError) throw currentError
  if (!current) throw new Error('API-klienten hittades inte.')

  const payload: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  }

  if (status === 'revoked') {
    payload.revoked_by = context.userId
    payload.revoked_at = new Date().toISOString()
    payload.revoke_reason = reason
  }

  if (status === 'active') {
    payload.revoked_by = null
    payload.revoked_at = null
    payload.revoke_reason = null
  }

  const { error } = await supabaseService
    .from('integration_api_clients')
    .update(payload)
    .eq('id', clientId)

  if (error) throw error

  await auditApiClient({
    action: `api_client.${status}`,
    actorUserId: context.userId,
    companyId: current.company_id,
    clientId,
    metadata: { previous_status: current.status, reason },
  })

  revalidatePath('/admin/platform/api-clients')
}


export async function updateIntegrationApiClientPermissionsAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const clientId = text(formData, 'clientId')
  if (!clientId) throw new Error('API-klient saknas.')

  const permissionGroups = formData.getAll('permissionGroups').map((value) => String(value))
  const groupedScopes = scopesForPermissionGroups(permissionGroups)
  const directScopes = normalizeIntegrationApiScopes(formData.getAll('scopes'))
  const scopes = Array.from(new Set([...groupedScopes, ...directScopes]))
  const allowedOrigins = parseMultiValueText(formData.get('allowedOrigins'))

  if (scopes.length === 0) throw new Error('Välj minst en behörighetsgrupp.')

  const { data: current, error: currentError } = await supabaseService
    .from('integration_api_clients')
    .select('id,company_id,scopes,permission_groups,allowed_origins,metadata')
    .eq('id', clientId)
    .maybeSingle()

  if (currentError) throw currentError
  if (!current) throw new Error('API-klienten hittades inte.')

  const metadata = current.metadata && typeof current.metadata === 'object' && !Array.isArray(current.metadata)
    ? current.metadata as Record<string, unknown>
    : {}

  const { error } = await supabaseService
    .from('integration_api_clients')
    .update({
      scopes,
      permission_groups: permissionGroups,
      allowed_origins: allowedOrigins,
      metadata: { ...metadata, permission_groups: permissionGroups, allowed_origins: allowedOrigins, updated_from: 'superadmin_api_permission_ui' },
      updated_at: new Date().toISOString(),
    })
    .eq('id', clientId)

  if (error) throw error

  await auditApiClient({
    action: 'api_client.permissions_updated',
    actorUserId: context.userId,
    companyId: current.company_id,
    clientId,
    metadata: { previous_scopes: current.scopes, previous_permission_groups: current.permission_groups, scopes, permissionGroups, allowedOrigins },
  })

  revalidatePath('/admin/platform/api-clients')
  revalidatePath(`/admin/companies/${current.company_id}`)
}

export async function rotateIntegrationApiClientTokenAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const clientId = text(formData, 'clientId')
  if (!clientId) throw new Error('API-klient saknas.')

  const { data: current, error: currentError } = await supabaseService
    .from('integration_api_clients')
    .select('id,company_id,name,status,key_prefix')
    .eq('id', clientId)
    .maybeSingle()

  if (currentError) throw currentError
  if (!current) throw new Error('API-klienten hittades inte.')
  if (current.status !== 'active' && current.status !== 'paused') throw new Error('Endast aktiva eller pausade API-klienter kan roteras.')

  const tokenData = generateIntegrationApiToken()
  const { error } = await supabaseService
    .from('integration_api_clients')
    .update({
      key_prefix: tokenData.keyPrefix,
      secret_hash: tokenData.secretHash,
      updated_at: new Date().toISOString(),
      metadata: { rotated_from_prefix: current.key_prefix, token_display: 'shown_once_on_rotate' },
    })
    .eq('id', clientId)

  if (error) throw error

  await auditApiClient({
    action: 'api_client.key_rotated',
    actorUserId: context.userId,
    companyId: current.company_id,
    clientId,
    metadata: { previous_key_prefix: current.key_prefix, new_key_prefix: tokenData.keyPrefix },
  })

  revalidatePath('/admin/platform/api-clients')
  revalidatePath(`/admin/companies/${current.company_id}`)
}

export async function deleteIntegrationApiClientAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const clientId = text(formData, 'clientId')

  if (!clientId) throw new Error('API-klient saknas.')

  const { data: current, error: currentError } = await supabaseService
    .from('integration_api_clients')
    .select('id,company_id,name,status,key_prefix,scopes,allowed_origins,allowed_ips,rate_limit_per_minute,last_used_at,expires_at,created_at,metadata')
    .eq('id', clientId)
    .maybeSingle()

  if (currentError) throw currentError
  if (!current) throw new Error('API-klienten hittades inte.')
  if (current.status === 'active') {
    throw new Error('Aktiva API-nycklar måste återkallas innan de kan raderas.')
  }

  await auditApiClient({
    action: 'api_client.deleted',
    actorUserId: context.userId,
    companyId: current.company_id,
    clientId,
    metadata: {
      deleted_client: {
        name: current.name,
        status: current.status,
        key_prefix: current.key_prefix,
        scopes: current.scopes,
        allowed_origins: current.allowed_origins,
        allowed_ips: current.allowed_ips,
        rate_limit_per_minute: current.rate_limit_per_minute,
        last_used_at: current.last_used_at,
        expires_at: current.expires_at,
        created_at: current.created_at,
        metadata: current.metadata,
      },
      deletion_mode: 'superadmin_old_api_key_cleanup',
    },
  })

  const { error } = await supabaseService
    .from('integration_api_clients')
    .delete()
    .eq('id', clientId)

  if (error) throw error

  revalidatePath('/admin/platform/api-clients')
}
