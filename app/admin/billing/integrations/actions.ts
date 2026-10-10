'use server'

import { revalidatePath } from 'next/cache'
import { redirect, unstable_rethrow } from 'next/navigation'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { logAdminActionAndUsage } from '@/lib/audit/actionLogger'
import { retryReviewableInvoiceProviderEvents } from '@/lib/billing/providerEventProcessor'
import { resolveCapwayConnectionConfig } from '@/lib/integrations/billing/capway/auth'
import { CapwayApticClient } from '@/lib/integrations/billing/capway/client'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseService } from '@/lib/supabase/service'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import {
  InvoiceProviderConfigError,
  loadTenantInvoiceProviderSelection,
  saveNordfinClientId,
  selectTenantInvoiceProvider,
  setTenantInvoiceDispatchEnabled,
} from '@/lib/billing/providers/registry'

function safeProviderError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/client_secret=[^&\s]+/gi, 'client_secret=[redacted]')
    .replace(/authorization:\s*bearer\s+[^\s]+/gi, 'Authorization: Bearer [redacted]')
    .slice(0, 1000)
}

async function requireScopedBillingCompany() {
  const context = await requireAdminActionAccess({
    anyOf: ['billing_underlay.export', 'pricing.write'],
  })
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')
  const scope = await getOperationalCompanyScope(user.id)
  const companyId = scope?.companyId
  if (!companyId) {
    throw new Error('Välj ett elhandelsbolag innan fakturaintegrationen testas.')
  }
  return { context, user, scope, companyId }
}

async function selectedEnvironment(companyId: string): Promise<'test' | 'production'> {
  const selection = await loadTenantInvoiceProviderSelection(companyId)
  return selection?.billing_provider_environment === 'production' ? 'production' : 'test'
}

function providerSettingsRedirect(status: string): never {
  revalidatePath('/admin/billing/integrations')
  redirect(`/admin/billing/integrations?provider=${encodeURIComponent(status)}`)
}

export async function selectInvoiceProviderAction(formData: FormData): Promise<void> {
  const { context, companyId } = await requireScopedBillingCompany()
  const provider = String(formData.get('provider') ?? '')
  const environment = String(formData.get('environment') ?? '') === 'production' ? 'production' : 'test'
  try {
    await selectTenantInvoiceProvider({ companyId, provider, environment, actorUserId: context.userId })
  } catch (error) {
    unstable_rethrow(error)
    if (error instanceof InvoiceProviderConfigError) providerSettingsRedirect(error.code)
    throw error
  }
  providerSettingsRedirect('selected')
}

export async function setInvoiceDispatchEnabledAction(formData: FormData): Promise<void> {
  const { context, companyId } = await requireScopedBillingCompany()
  const enabled = String(formData.get('enabled') ?? '') === 'true'
  try {
    await setTenantInvoiceDispatchEnabled({ companyId, enabled, actorUserId: context.userId })
  } catch (error) {
    unstable_rethrow(error)
    if (error instanceof InvoiceProviderConfigError) providerSettingsRedirect(error.code)
    throw error
  }
  providerSettingsRedirect(enabled ? 'enabled' : 'disabled')
}

export async function saveNordfinClientIdAction(formData: FormData): Promise<void> {
  const { context, companyId } = await requireScopedBillingCompany()
  const environment = await selectedEnvironment(companyId)
  try {
    await saveNordfinClientId({ companyId, environment, clientId: String(formData.get('client_id') ?? ''), actorUserId: context.userId })
  } catch (error) {
    unstable_rethrow(error)
    if (error instanceof InvoiceProviderConfigError) providerSettingsRedirect(error.code)
    throw error
  }
  providerSettingsRedirect('nordfin_client_id_saved')
}

export async function testCapwayConnectionAction(): Promise<void> {
  const { context, companyId } = await requireScopedBillingCompany()
  const testedAt = new Date().toISOString()
  const environment = await selectedEnvironment(companyId)

  try {
    const config = await resolveCapwayConnectionConfig({
      companyId,
      environment,
      allowIncompleteStatus: true,
    })
    const client = new CapwayApticClient(config)
    const ping = await client.ping()

    const { data: existing, error: loadError } = await supabaseService
      .from('billing_provider_connections')
      .select('id,readiness_issues')
      .eq('company_id', companyId)
      .eq('provider', 'capway_aptic')
      .eq('environment', environment)
      .maybeSingle()
    if (loadError) throw loadError
    if (!existing) throw new Error('Capway-koppling saknas. Välj Capway som fakturaleverantör först.')

    const remainingIssues = Array.isArray(existing.readiness_issues)
      ? existing.readiness_issues.filter((item) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return true
          return String((item as Record<string, unknown>).code ?? '') !== 'connection_test_required'
        })
      : []

    const { error: updateError } = await supabaseService
      .from('billing_provider_connections')
      .update({
        status: 'ready',
        readiness_issues: remainingIssues,
        last_tested_at: testedAt,
        last_test_result: {
          ok: true,
          environment,
          auth_mode: config.authMode,
          endpoint: '/v1/Invoices/Ping',
          response: ping,
          tested_at: testedAt,
          billing_activation_allowed: false,
        },
        updated_by: context.userId,
        updated_at: testedAt,
      })
      .eq('id', existing.id)
      .eq('company_id', companyId)
    if (updateError) throw updateError

    await logAdminActionAndUsage({
      companyId,
      actorUserId: context.userId,
      entityType: 'billing_provider_connection',
      entityId: existing.id,
      action: 'capway_test_connection_succeeded',
      label: 'Capway/Aptic testanslutning verifierad',
      newValues: {
        environment,
        endpoint: '/v1/Invoices/Ping',
        authMode: config.authMode,
        billingActivationAllowed: false,
      },
      source: 'billing_integrations',
    }).catch(() => undefined)
  } catch (error) {
    unstable_rethrow(error)
    const message = safeProviderError(error)
    const { data: existing } = await supabaseService
      .from('billing_provider_connections')
      .select('id,readiness_issues')
      .eq('company_id', companyId)
      .eq('provider', 'capway_aptic')
      .eq('environment', environment)
      .maybeSingle()

    if (existing?.id) {
      const priorIssues = Array.isArray(existing.readiness_issues)
        ? existing.readiness_issues.filter((item) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) return true
            return String((item as Record<string, unknown>).code ?? '') !== 'connection_test_failed'
          })
        : []
      await supabaseService
        .from('billing_provider_connections')
        .update({
          status: 'incomplete',
          readiness_issues: [
            ...priorIssues,
            {
              code: 'connection_test_failed',
              message: 'OAuth/API-auth eller Aptic Ping kunde inte verifieras.',
            },
          ],
          last_tested_at: testedAt,
          last_test_result: {
            ok: false,
            environment,
            endpoint: '/v1/Invoices/Ping',
            error: message,
            tested_at: testedAt,
            billing_activation_allowed: false,
          },
          updated_by: context.userId,
          updated_at: testedAt,
        })
        .eq('id', existing.id)
        .eq('company_id', companyId)
    }

    await logAdminActionAndUsage({
      companyId,
      actorUserId: context.userId,
      entityType: 'billing_provider_connection',
      entityId: existing?.id ?? companyId,
      action: 'capway_test_connection_failed',
      label: 'Capway/Aptic testanslutning misslyckades',
      newValues: { environment, error: message },
      source: 'billing_integrations',
    }).catch(() => undefined)

    revalidatePath('/admin/billing/integrations')
    return
  }

  revalidatePath('/admin/billing/integrations')
}

// Operator action for the previously dead-ended needs_review provider events:
// re-runs matching/processing for events that may have become resolvable.
export async function reprocessInvoiceProviderEventsAction(): Promise<void> {
  const { context, companyId } = await requireScopedBillingCompany()

  const result = await retryReviewableInvoiceProviderEvents({
    companyId,
    limit: 100,
  })

  await logAdminActionAndUsage({
    companyId,
    actorUserId: context.userId,
    entityType: 'invoice_provider_events',
    entityId: companyId,
    action: 'invoice_provider_events_reprocessed',
    label: 'Providerhändelser ombearbetade',
    newValues: {
      processed: result.processed,
      stillNeedsReview: result.stillNeedsReview,
      failed: result.failed,
    },
    source: 'billing_integrations',
  }).catch(() => undefined)

  revalidatePath('/admin/billing/integrations')
}
