import { calculatePricingPreviewForUnderlay } from '@/lib/pricing/engine'

/**
 * Adapter that lets billing/export flows consume the Pricing Core
 * (lib/pricing/engine.ts) through the payload shape that the legacy
 * lib/billing/pricingEngine.ts used. This keeps billing_export_run_items
 * payload snapshots, the partner adapter and export files stable while making
 * the Pricing Core the only calculation path.
 */

export type UnderlayCorePricingLine = {
  componentRuleId: string
  componentCode: string
  componentLabel: string
  componentType: string
  calculationUnit: string
  valueAmount: number | null
  quantity: number | null
  amountSekExVat: number
  currency: string
  appliesTo: string
  vatRate: number
  vatAmount: number
  amountIncVat: number
  sortOrder: number
  metadata: Record<string, unknown>
}

export type UnderlayCorePricingResult = {
  engine: 'pricing_core_v1'
  status: 'success' | 'failed' | 'needs_review'
  pricingRunId: string | null
  underlayId: string
  subtotalSekExVat: number
  vatSek: number
  totalSekIncVat: number
  lines: UnderlayCorePricingLine[]
  warnings: string[]
  errors: string[]
}

export async function calculateUnderlayPricingWithCore(input: {
  companyId: string
  billingUnderlayId: string
  /**
   * Persist a pricing_run + preview lines and update underlay readiness.
   * Export/billing flows should persist so preview and billing always share
   * the same stored calculation.
   */
  persist?: boolean
}): Promise<UnderlayCorePricingResult> {
  try {
    const result = await calculatePricingPreviewForUnderlay({
      companyId: input.companyId,
      billingUnderlayId: input.billingUnderlayId,
      persist: input.persist ?? true,
    })

    return {
      engine: 'pricing_core_v1',
      status: result.status,
      pricingRunId: result.pricingRunId ?? null,
      underlayId: input.billingUnderlayId,
      subtotalSekExVat: result.totalExVat,
      vatSek: result.vatAmount,
      totalSekIncVat: result.totalIncVat,
      lines: result.lines.map((line, index) => ({
        componentRuleId: `pricing_core:${input.billingUnderlayId}:${line.sortOrder ?? index}`,
        componentCode: line.lineType,
        componentLabel: line.description,
        componentType: line.lineType,
        calculationUnit: line.unit,
        valueAmount: line.unitPriceExVat,
        quantity: line.quantity,
        amountSekExVat: line.amountExVat,
        currency: 'SEK',
        appliesTo: 'contract',
        vatRate: line.vatRate,
        vatAmount: line.vatAmount,
        amountIncVat: line.amountIncVat,
        sortOrder: line.sortOrder,
        metadata: line.metadata ?? {},
      })),
      warnings: result.warnings,
      errors: result.errors,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Prisberäkning misslyckades.'
    return {
      engine: 'pricing_core_v1',
      status: 'failed',
      pricingRunId: null,
      underlayId: input.billingUnderlayId,
      subtotalSekExVat: 0,
      vatSek: 0,
      totalSekIncVat: 0,
      lines: [],
      warnings: [],
      errors: [message],
    }
  }
}
