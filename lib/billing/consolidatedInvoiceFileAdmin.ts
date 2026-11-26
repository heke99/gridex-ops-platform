import 'server-only'

import { requireAdminActionAccess, requireAdminPageKeyAccess, requireCompanyScopedActionAccess } from '@/lib/admin/guards'
import { UUID_PATTERN } from '@/lib/ediel/matching/postgrestFilter'
import { supabaseService } from '@/lib/supabase/service'
import { resolveAdminSelectedCompanyReadScope } from '@/lib/tenant/adminScope'

const fileHash = /^[0-9a-f]{64}$/

export async function createConsolidatedInvoiceNeutralFileForAdmin(invoiceId: unknown, reviewHash: unknown) {
  const actor = await requireAdminActionAccess(['billing_underlay.export'])
  const scope = await resolveAdminSelectedCompanyReadScope(actor, { allowMissing: true })
  if (!scope.companyId) throw new Error('Välj ett bolag innan samlingsfakturan öppnas.')
  if (typeof invoiceId !== 'string' || !UUID_PATTERN.test(invoiceId)
    || typeof reviewHash !== 'string' || !fileHash.test(reviewHash)) {
    throw new Error('Läs om den utfärdade samlingsfakturan innan du skapar filen.')
  }
  const checkedActor = await requireCompanyScopedActionAccess(scope.companyId, ['billing_underlay.export'])
  if (checkedActor.userId !== actor.userId || !UUID_PATTERN.test(checkedActor.userId) || !UUID_PATTERN.test(scope.companyId)
    || (!checkedActor.isPlatformAdmin && checkedActor.companyId !== scope.companyId)) {
    throw new Error('Du saknar aktiv ändringsbehörighet för valt bolag.')
  }
  const { data, error } = await supabaseService.rpc('gridex_create_consolidated_invoice_neutral_file_v1', {
    p_company_id: scope.companyId, p_invoice_id: invoiceId, p_actor_user_id: checkedActor.userId, p_review_hash: reviewHash,
  })
  if (error) throw new Error('Samlingsfakturans utfärdade underlag kunde inte bekräftas. Läs om fakturan före export.')
  if (data?.invoiceId !== invoiceId || typeof data.fileId !== 'string' || !UUID_PATTERN.test(data.fileId)
    || typeof data.sha256 !== 'string' || !fileHash.test(data.sha256)) {
    throw new Error('Fakturafilens kvitto kunde inte bekräftas. Öppna samma samlingsfaktura igen.')
  }
  return data.fileId
}

type ArchivedFileRead =
  | { kind: 'ready'; bodyBase64: string; sha256: string }
  | { kind: 'denied' | 'company_required' | 'missing' | 'tombstoned' | 'unavailable' | 'invalid' }

export async function readConsolidatedInvoiceNeutralFileForAdmin(id: string): Promise<ArchivedFileRead> {
  const actor = await requireAdminPageKeyAccess('billing.workspace')
  if (!actor.permissions.includes('billing_underlay.export') || !UUID_PATTERN.test(actor.userId)) return { kind: 'denied' }
  const scope = await resolveAdminSelectedCompanyReadScope(actor, { allowMissing: true })
  if (!scope.companyId || !UUID_PATTERN.test(scope.companyId)) return { kind: 'company_required' }
  if (!UUID_PATTERN.test(id)) return { kind: 'missing' }

  const { data, error } = await supabaseService.rpc('gridex_read_consolidated_invoice_neutral_file_v1', {
    p_company_id: scope.companyId, p_file_id: id, p_actor_user_id: actor.userId,
  })
  if (error?.code === '42501') return { kind: 'denied' }
  if (error?.code === '23514' && error.message === 'finance_copy_retention_tombstoned') return { kind: 'tombstoned' }
  if (error) return { kind: 'unavailable' }
  if (data === null) return { kind: 'missing' }
  if (data?.fileId !== id || typeof data.bodyBase64 !== 'string' || typeof data.sha256 !== 'string') return { kind: 'invalid' }
  return { kind: 'ready', bodyBase64: data.bodyBase64, sha256: data.sha256 }
}
