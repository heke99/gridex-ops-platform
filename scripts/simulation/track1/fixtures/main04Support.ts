// MAIN04-specific helpers (new file; the MAIN03 fixture files are untouched).
import { createHash } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import { substitute } from './substitutions'

/**
 * The prepare route (app/api/internal/invoice-exports/create/route.ts:32) and the approve path
 * (lib/billing/invoiceApprovedDispatch.ts:428) refuse to run unless the tenant has selected an invoice provider
 * and environment (lib/billing/providers/registry.ts requireTenantInvoiceProvider). A file provider makes
 * approveAndSendReadyInvoicesForMonth approve-only (invoiceApprovedDispatch.ts:428,451): nothing is sent.
 */
export async function enableFileInvoiceProvider(companyId: string): Promise<void> {
  // SUBSTITUTE: provider selection written to companies by service role instead of the Fakturering -> Integrationer UI —
  // verifierar inte integrationsinställningarna, katalogen över leverantörer eller behörigheten att välja.
  substitute({ id: 'invoice-provider-selection', step: 'MAIN04 setup: tenant invoice provider',
    substitute: "companies.invoice_export_target_system='file_export', billing_provider_environment='test', invoice_export_enabled=true via service role",
    notVerified: 'the integrations UI, provider catalog selection and its permission check; file_export means approve-only, so no external send path (Capway) is exercised' })
  const { error } = await supabaseService.from('companies')
    .update({ invoice_export_target_system: 'file_export', billing_provider_environment: 'test', invoice_export_enabled: true })
    .eq('id', companyId)
  if (error) throw new Error(`main04_provider_selection_failed:${error.message}`)
}

/** Same canonical JSON as the app uses for its hashes (sorted keys), written independently here. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export const sha256Hex = (value: unknown): string => createHash('sha256').update(stableJson(value)).digest('hex')

/** The approval review hash as lib/billing/invoiceApprovedDispatch.ts:135-143 defines it, recomputed from the receipt. */
export function expectedReviewHash(receipt: { itemId: string; underlayId: string; pricingRunId: string; calculationSha: string; totalKwh: number; totalIncVat: number; priceArea: string }): string {
  return sha256Hex({
    invoice_export_item_id: receipt.itemId, billing_underlay_id: receipt.underlayId, pricing_run_id: receipt.pricingRunId,
    calculation_snapshot_sha256: receipt.calculationSha, total_kwh: receipt.totalKwh, total_inc_vat: receipt.totalIncVat, price_area: receipt.priceArea,
  })
}

export const cents = (value: unknown): number => Math.round(Number(value) * 100)
