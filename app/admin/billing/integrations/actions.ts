'use server'

import { revalidatePath } from 'next/cache'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { logAdminActionAndUsage } from '@/lib/audit/actionLogger'
import { retryReviewableInvoiceProviderEvents } from '@/lib/billing/providerEventProcessor'
import { resolveCapwayConnectionConfig } from '@/lib/integrations/billing/capway/auth'
import { CapwayApticClient } from '@/lib/integrations/billing/capway/client'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseService } from '@/lib/supabase/service'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'

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
  if (!scope?.companyId) {
    throw new Error('Välj ett elhandelsbolag innan fakturaintegrationen testas.')
  }
  return { context, user, scope }
}

export async function testCapwayConnectionAction(): Promise<void> {
  const { context, scope } = await requireScopedBillingCompany()
  const companyId = scope.companyId
  const testedAt = new Date().toISOString()

  try {
    const config = await resolveCapwayConnectionConfig({
      companyId,
      environment: 'test',
      allowIncompleteStatus: true,
    })
    const client = new CapwayApticClient(config)
    const ping = await client.ping()

    const { data: existing, error: loadError } = await supabaseService
      .from('billing_provider_connections')
      .select('id,readiness_issues')
      .eq('company_id', companyId)
      .eq('provider', 'capway_aptic')
      .eq('environment', 'test')
      .maybeSingle()
    if (loadError) throw loadError
    if (!existing) throw new Error('Capway/Aptic testkoppling saknas för valt bolag.')

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
          environment: 'test',
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
        environment: 'test',
        endpoint: '/v1/Invoices/Ping',
        authMode: config.authMode,
        billingActivationAllowed: false,
      },
      source: 'billing_integrations',
    }).catch(() => undefined)
  } catch (error) {
    const message = safeProviderError(error)
    const { data: existing } = await supabaseService
      .from('billing_provider_connections')
      .select('id,readiness_issues')
      .eq('company_id', companyId)
      .eq('provider', 'capway_aptic')
      .eq('environment', 'test')
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
            environment: 'test',
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
      newValues: { environment: 'test', error: message },
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
  const { context, scope } = await requireScopedBillingCompany()
  const companyId = scope.companyId

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
