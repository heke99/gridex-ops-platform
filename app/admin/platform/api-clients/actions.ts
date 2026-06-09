'use server'

import { revalidatePath } from 'next/cache'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import {
  generateIntegrationApiToken,
  normalizeIntegrationApiScopes,
  parseMultiValueText,
} from '@/lib/integrations/apiClientSecrets'

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

    const scopes = normalizeIntegrationApiScopes(formData.getAll('scopes'))
    if (scopes.length === 0) return { ok: false, message: 'Välj minst ett scope.' }

    const allowedOrigins = parseMultiValueText(formData.get('allowedOrigins'))
    const allowedIps = parseMultiValueText(formData.get('allowedIps'))
    const intendedUse = text(formData, 'intendedUse') || 'gridex_customer_portal'
    const frontendApp = text(formData, 'frontendApp') || 'Gridex hemsida'
    const notes = text(formData, 'notes')
    const rateLimit = intValue(formData, 'rateLimitPerMinute', 120)
    const expiresAt = nullableDate(formData, 'expiresAt')

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
          allowed_ips: allowedIps,
          rate_limit_per_minute: rateLimit,
          expires_at: expiresAt,
          created_by: context.userId,
          metadata: {
            frontend_app: frontendApp,
            intended_use: intendedUse,
            allowed_origins: allowedOrigins,
            notes,
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
        metadata: { scopes, allowedOrigins, frontendApp, intendedUse },
      })

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
