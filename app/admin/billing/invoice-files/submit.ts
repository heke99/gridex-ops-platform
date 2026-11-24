import 'server-only'

import { revalidatePath } from 'next/cache'
import { unstable_rethrow } from 'next/navigation'
import { requireAdminActionAccess, requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { createInvoiceFile, readFrozenInvoiceFileIntent } from '@/lib/billing/invoiceFileExport'
import { readSignedInvoiceFileIntent, signInvoiceFileMonthLockNotice } from '@/lib/billing/invoiceFileIntentToken'
import { isInvoiceFileRecoveryId, recoverInvoiceFileReceipt } from '@/lib/billing/invoiceFileReplayRecovery'
import { InvoiceProviderConfigError } from '@/lib/billing/providers/registry'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { resolveAdminSelectedCompanyReadScope } from '@/lib/tenant/adminScope'
import { parseBillingMonth } from '@/lib/time/stockholm'

function scopeMismatch() {
  return new InvoiceProviderConfigError('invoice_file_intent_scope_mismatch', 'Begäran hör till en annan session eller fakturaperiod.')
}

function fileReceiptTarget(
  scope: { companyId: string; actorUserId: string; billingMonth: string },
  result: { fileId: string; monthReconciliation?: string },
) {
  const query = new URLSearchParams({ month: scope.billingMonth, file: result.fileId })
  if (result.monthReconciliation === 'failed') {
    query.set('file_month_lock_notice', signInvoiceFileMonthLockNotice({ ...scope, fileId: result.fileId }))
  }
  return `/admin/billing?${query}`
}

async function resolveExportRequest(
  token: FormDataEntryValue,
  recoveryId: FormDataEntryValue | null,
  scope: { companyId: string; actorUserId: string; billingMonth: string },
) {
  let intent
  try {
    intent = readSignedInvoiceFileIntent(token)
  } catch (error) {
    if (!(error instanceof InvoiceProviderConfigError) || error.code !== 'invoice_file_intent_invalid' ||
        !isInvoiceFileRecoveryId(recoveryId)) throw error
    const saved = await recoverInvoiceFileReceipt({ ...scope, intentId: recoveryId })
    if (!saved) throw error
    return { result: saved, replayed: true }
  }
  if (intent.companyId !== scope.companyId || intent.actorUserId !== scope.actorUserId ||
      intent.billingMonth !== scope.billingMonth || (recoveryId !== null && recoveryId !== intent.intentId)) {
    throw scopeMismatch()
  }
  const input = { ...scope, exportIntentId: intent.intentId, exportIntentScope: intent.scope }
  const exact = await readFrozenInvoiceFileIntent(input)
  if (exact) return { result: exact, replayed: true }
  const actor = await requireAdminActionAccess(['billing_underlay.export'])
  const selected = await resolveAdminSelectedCompanyReadScope(actor, { allowMissing: true })
  if (actor.userId !== scope.actorUserId || selected.companyId !== scope.companyId) throw scopeMismatch()
  const result = await createInvoiceFile(input)
  return { result, replayed: 'replayed' in result && result.replayed }
}

export async function submitInvoiceFile(formData: FormData): Promise<string> {
  const token = formData.get('export_intent_v2')
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Du måste vara inloggad.')
  const billingMonth = parseBillingMonth(String(formData.get('billing_month') ?? '')).value

  let target: string
  let replayed = false
  try {
    const admin = await requireAdminPageKeyAccess('billing.workspace')
    if (!admin.permissions.includes('billing_underlay.export')) throw new Error('Forbidden')
    if (token === null) {
      throw new InvoiceProviderConfigError('invoice_file_intent_invalid', 'Bekräfta aktuellt fakturaunderlag innan en fil skapas.')
    }
    const { companyId } = await resolveAdminSelectedCompanyReadScope(admin, { allowMissing: true })
    if (!companyId || admin.userId !== user.id) throw scopeMismatch()
    const scope = { companyId, billingMonth, actorUserId: user.id }
    const result = await resolveExportRequest(token, formData.get('export_receipt_v2'), scope)
    target = fileReceiptTarget(scope, result.result)
    replayed = result.replayed
  } catch (error) {
    unstable_rethrow(error)
    if (!(error instanceof InvoiceProviderConfigError)) throw error
    target = `/admin/billing?month=${billingMonth}&file_error=${encodeURIComponent(error.code)}`
  }
  if (!replayed) revalidatePath('/admin/billing')
  return target
}
