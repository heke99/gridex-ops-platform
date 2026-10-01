'use server'

import { unstable_rethrow } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { assertUserCanOperateCompany } from '@/lib/tenant/scope'
import { currentSupportSession } from '@/lib/customer-operations/supportSession'
import { invoiceRedeliveryDecisionInputSchema, recordInvoiceRedeliveryDecision, InvoiceRedeliveryDecisionError,
  type InvoiceRedeliveryDecisionInput } from '@/lib/billing/invoiceRedeliveryDecision'

/** Internal OPS command surface; no external API endpoint or provider adapter. */
export async function recordInvoiceRedeliveryDecisionAction(input: InvoiceRedeliveryDecisionInput) {
  const parsed = invoiceRedeliveryDecisionInputSchema.safeParse(input)
  if (!parsed.success) return { status: 'error' as const, code: 'invalid_redelivery_command', message: 'Kontrollera fakturans uppgifter och aktuella revisioner.' }
  try {
    const guard = await requireAdminActionAccess(['billing_underlay.export'])
    if (!guard.isPlatformAdmin && guard.companyId !== parsed.data.companyId) {
      return { status: 'error' as const, code: 'tenant_context_changed', message: 'Tenantkontexten har ändrats. Läs in fakturan igen.' }
    }
    await assertUserCanOperateCompany(guard.userId, parsed.data.companyId)
    const actor = await currentSupportSession('ops', guard.userId)
    const result = await recordInvoiceRedeliveryDecision({ ...parsed.data, actor: { ...actor, kind: 'ops' } })
    let refreshMessage = ''
    try {
      revalidatePath(`/admin/billing/invoices/${result.invoiceExportItemId}`)
      revalidatePath(`/admin/customers/${parsed.data.customerId}`)
    } catch (error) {
      unstable_rethrow(error)
      refreshMessage = ' Ladda om sidan för aktuella uppgifter.'
    }
    return { ...result, decisionStatus: result.status, status: 'success' as const,
      message: `Beslutet om omleverans är sparat. Själva leveransen är ännu inte möjlig via fakturapartnern.${refreshMessage}` }
  } catch (error) {
    unstable_rethrow(error)
    const code = error instanceof InvoiceRedeliveryDecisionError ? error.code : 'redelivery_actor_or_service_unavailable'
    const message = error instanceof InvoiceRedeliveryDecisionError && error.status === 409
      ? 'Profilrevisionen, originalfakturan eller beslutets underlag har ändrats. Läs in aktuella uppgifter innan ett nytt beslut.'
      : error instanceof InvoiceRedeliveryDecisionError && error.status === 422
        ? 'Omleveransbeslutet kräver en giltig aktuell faktureringsadress för e-post.'
        : 'Beslutet kunde inte registreras. Aktuell behörighet, aktiv ägarrelation och verifierad mottagaradress krävs.'
    return { status: 'error' as const, code, message }
  }
}

export async function recordInvoiceRedeliveryDecisionFormAction(
  _previous: Awaited<ReturnType<typeof recordInvoiceRedeliveryDecisionAction>> | null, formData: FormData,
) {
  const allowed = ['companyId', 'customerId', 'invoiceId', 'accountId', 'expectedRevision', 'expectedOverrideRevision', 'idempotencyKey', 'reason']
  if ([...formData.keys()].some(key => !allowed.includes(key) && !key.startsWith('$ACTION_'))) {
    return { status: 'error' as const, code: 'invalid_redelivery_command', message: 'Formuläret innehåller ogiltiga uppgifter. Läs in fakturan igen.' }
  }
  const text = (key: string) => typeof formData.get(key) === 'string' ? String(formData.get(key)).trim() : ''
  const revision = (key: string) => /^[0-9]+$/.test(text(key)) ? Number(text(key)) : Number.NaN
  return recordInvoiceRedeliveryDecisionAction({
    companyId: text('companyId'), customerId: text('customerId'), invoiceId: text('invoiceId'), accountId: text('accountId'),
    expectedRevision: revision('expectedRevision'), expectedOverrideRevision: revision('expectedOverrideRevision'),
    idempotencyKey: text('idempotencyKey'), reason: text('reason'),
  })
}
