import 'server-only'
import { InvoiceProviderConfigError } from '@/lib/billing/providers/registry'
import { supabaseService } from '@/lib/supabase/service'

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isInvoiceFileRecoveryId(value: unknown): value is string {
  return typeof value === 'string' && uuidV4.test(value)
}

export async function recoverInvoiceFileReceipt(input: {
  companyId: string
  actorUserId: string
  billingMonth: string
  intentId: string
}): Promise<{ fileId: string; rowsSha256: string } | null> {
  const { data, error } = await supabaseService.rpc('gridex_recover_invoice_file_receipt_v2', {
    p_company_id: input.companyId,
    p_actor_user_id: input.actorUserId,
    p_billing_month: input.billingMonth,
    p_intent_id: input.intentId,
  })
  if (error?.code === 'PGRST202' || (error === null && data === null)) return null
  const receipt = data as { fileId?: string; rowsSha256?: string } | null
  if (error || typeof receipt?.fileId !== 'string' || !uuid.test(receipt.fileId) ||
      typeof receipt.rowsSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.rowsSha256)) {
    throw new InvoiceProviderConfigError(
      'invoice_file_recovery_unavailable',
      'Det sparade exportkvittot kunde inte läsas. Försök igen.',
    )
  }
  return { fileId: receipt.fileId, rowsSha256: receipt.rowsSha256 }
}
