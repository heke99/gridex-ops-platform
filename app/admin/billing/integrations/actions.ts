'use server'

import { revalidatePath } from 'next/cache'
import { unstable_rethrow } from 'next/navigation'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { logAdminActionAndUsage } from '@/lib/audit/actionLogger'
import { retryReviewableInvoiceProviderEvents } from '@/lib/billing/providerEventProcessor'
import { resolveCapwayConnectionConfig } from '@/lib/integrations/billing/capway/auth'
import { CapwayApticClient } from '@/lib/integrations/billing/capway/client'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseService } from '@/lib/supabase/service'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'

export type BillingIntegrationActionState = { ok: boolean; message: string }

function savedTest(data: unknown, id: string, ok: boolean, testedAt: string) {
  if (!data || typeof data!=='object') return false
  const row = data as Record<string, unknown>
  const result = row.last_test_result as Record<string, unknown> | null
  return row.id===id && row.status===(ok ? 'ready' : 'incomplete') && result?.ok===ok
    && result.environment==='test' && result.tested_at===testedAt && result.billing_activation_allowed===false
}

function refreshMessage() {
  try { revalidatePath('/admin/billing/integrations'); return '' }
  catch (error) { unstable_rethrow(error); return ' Ladda om sidan för aktuella uppgifter.' }
}

async function requireScopedBillingCompany() {
  const context = await requireAdminActionAccess({
    anyOf: ['billing_underlay.export', 'pricing.write'],
  })
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || user.id!==context.userId) throw new Error('Unauthorized')
  const scope = await getOperationalCompanyScope(user.id)
  const companyId = scope?.companyId
  if (!companyId) {
    throw new Error('Välj ett elhandelsbolag innan fakturaintegrationen testas.')
  }
  if (!context.isPlatformAdmin && context.companyId!==companyId) throw new Error('tenant_context_changed')
  return { context, user, scope, companyId }
}

export async function testCapwayConnectionAction(): Promise<BillingIntegrationActionState> {
  let scoped: Awaited<ReturnType<typeof requireScopedBillingCompany>>
  try { scoped = await requireScopedBillingCompany() }
  catch (error) { unstable_rethrow(error); return { ok: false, message: 'Anslutningstestet kräver aktuell behörighet och valt bolag. Läs in sidan igen.' } }
  const { context, companyId } = scoped
  const testedAt = new Date().toISOString()
  let providerAttempted = false
  let providerSucceeded = false

  try {
    const { data: existing, error: loadError } = await supabaseService
      .from('billing_provider_connections').select('id,readiness_issues')
      .eq('company_id', companyId).eq('provider', 'capway_aptic').eq('environment', 'test').maybeSingle()
    if (loadError) throw loadError
    if (!existing) return { ok: false, message: 'Testkopplingen saknas för valt bolag. Ingen anslutning testades.' }
    providerAttempted = true
    const config = await resolveCapwayConnectionConfig({
      companyId,
      environment: 'test',
      allowIncompleteStatus: true,
    })
    const client = new CapwayApticClient(config)
    const ping = await client.ping()
    providerSucceeded = true

    const remainingIssues = Array.isArray(existing.readiness_issues)
      ? existing.readiness_issues.filter((item) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return true
          return String((item as Record<string, unknown>).code ?? '') !== 'connection_test_required'
        })
      : []

    const { data: saved, error: updateError } = await supabaseService
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
      .eq('provider', 'capway_aptic').eq('environment', 'test')
      .select('id,status,last_test_result').single()
    if (updateError || !savedTest(saved,existing.id,true,testedAt)) throw updateError ?? new Error('connection_result_not_confirmed')

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
    return { ok: true, message: 'Testanslutningen är verifierad och resultatet sparat. Fakturaexporten har inte aktiverats.' + refreshMessage() }
  } catch (error) {
    unstable_rethrow(error)
    if (!providerAttempted) return { ok: false, message: 'Testkopplingen kunde inte läsas. Inget anslutningstest bekräftades.' }
    if (providerSucceeded) return { ok: false, message: 'Anslutningstestets resultat kunde inte sparas. Läs in kopplingen igen.' }
    const message = 'OAuth/API-auth eller Aptic Ping kunde inte verifieras.'
    let failedConnectionId = companyId
    try {
      const { data: existing, error: loadError } = await supabaseService
        .from('billing_provider_connections')
        .select('id,readiness_issues')
        .eq('company_id', companyId)
        .eq('provider', 'capway_aptic')
        .eq('environment', 'test')
        .maybeSingle()
      if (loadError || !existing?.id) return { ok: false, message: 'Anslutningstestets resultat kunde inte sparas. Läs in kopplingen igen.' }
      failedConnectionId = existing.id
      {
        const priorIssues = Array.isArray(existing.readiness_issues)
          ? existing.readiness_issues.filter((item) => {
              if (!item || typeof item !== 'object' || Array.isArray(item)) return true
              return String((item as Record<string, unknown>).code ?? '') !== 'connection_test_failed'
            })
          : []
        const { data: saved, error: saveError } = await supabaseService
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
          .eq('provider', 'capway_aptic').eq('environment', 'test')
          .select('id,status,last_test_result').single()
        if (saveError || !savedTest(saved,existing.id,false,testedAt)) return { ok: false, message: 'Anslutningstestets resultat kunde inte sparas. Läs in kopplingen igen.' }
      }
    } catch (saveError) {
      unstable_rethrow(saveError)
      return { ok: false, message: 'Anslutningstestets resultat kunde inte sparas. Läs in kopplingen igen.' }
    }

    await logAdminActionAndUsage({
      companyId,
      actorUserId: context.userId,
      entityType: 'billing_provider_connection',
      entityId: failedConnectionId,
      action: 'capway_test_connection_failed',
      label: 'Capway/Aptic testanslutning misslyckades',
      newValues: { environment: 'test', error: message },
      source: 'billing_integrations',
    }).catch(() => undefined)

    return { ok: false, message: 'Testanslutningen kunde inte verifieras. Felresultatet är sparat för valt bolag.' + refreshMessage() }
  }
}

// Operator action for the previously dead-ended needs_review provider events:
// re-runs matching/processing for events that may have become resolvable.
export async function reprocessInvoiceProviderEventsAction(): Promise<BillingIntegrationActionState> {
  try {
    const { context, companyId } = await requireScopedBillingCompany()

    const result = await retryReviewableInvoiceProviderEvents({ companyId, limit: 100 })
    if (![result.processed,result.stillNeedsReview,result.failed].every(count=>Number.isSafeInteger(count) && count>=0)) {
      return { ok: false, message: 'Ombearbetningens resultat kunde inte bekräftas. Läs in händelserna igen.' }
    }

    await logAdminActionAndUsage({
      companyId,
      actorUserId: context.userId,
      entityType: 'invoice_provider_events',
      entityId: companyId,
      action: 'invoice_provider_events_reprocessed',
      label: 'Providerhändelser ombearbetade',
      newValues: { processed: result.processed, stillNeedsReview: result.stillNeedsReview, failed: result.failed },
      source: 'billing_integrations',
    }).catch(() => undefined)

    return { ok: result.failed===0, message: `Ombearbetning klar: ${result.processed} behandlade, ${result.stillNeedsReview} kvar för granskning och ${result.failed} misslyckade.` + refreshMessage() }
  } catch (error) {
    unstable_rethrow(error)
    return { ok: false, message: 'Ombearbetningen kunde inte bekräftas. Kontrollera aktuell behörighet och valt bolag och läs in händelserna igen.' }
  }
}

export async function testCapwayConnectionFormAction(_previous: BillingIntegrationActionState, _data: FormData) {
  void _previous; void _data
  return testCapwayConnectionAction()
}

export async function reprocessInvoiceProviderEventsFormAction(_previous: BillingIntegrationActionState, _data: FormData) {
  void _previous; void _data
  return reprocessInvoiceProviderEventsAction()
}
