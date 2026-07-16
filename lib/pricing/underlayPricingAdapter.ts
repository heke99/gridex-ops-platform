import { supabaseService } from '@/lib/supabase/service'
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
  locked: boolean
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
      locked: false,
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
      locked: false,
    }
  }
}


function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export async function loadLockedUnderlayPricingWithCore(input: {
  companyId: string
  billingUnderlayId: string
}): Promise<UnderlayCorePricingResult | null> {
  const { data: run, error: runError } = await supabaseService
    .from('pricing_runs')
    .select('*')
    .eq('company_id', input.companyId)
    .eq('billing_underlay_id', input.billingUnderlayId)
    .eq('status', 'locked')
    .order('locked_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (runError && runError.code !== 'PGRST116') throw runError
  if (!run) return null

  const { data: lines, error: lineError } = await supabaseService
    .from('pricing_preview_lines')
    .select('*')
    .eq('company_id', input.companyId)
    .eq('pricing_run_id', run.id)
    .order('sort_order', { ascending: true })
  if (lineError) throw lineError

  const warnings = Array.isArray(run.warnings) ? run.warnings.map(String) : []
  const errors = Array.isArray(run.errors) ? run.errors.map(String) : []
  return {
    engine: 'pricing_core_v1',
    status: 'success',
    pricingRunId: String(run.id),
    underlayId: input.billingUnderlayId,
    subtotalSekExVat: numberValue(run.total_ex_vat) ?? 0,
    vatSek: numberValue(run.vat_amount) ?? 0,
    totalSekIncVat: numberValue(run.total_inc_vat) ?? 0,
    lines: ((lines ?? []) as Record<string, unknown>[]).map((line, index) => ({
      componentRuleId: `pricing_core:${input.billingUnderlayId}:${String(line.id ?? index)}`,
      componentCode: String(line.line_type ?? 'unknown'),
      componentLabel: String(line.description ?? 'Prisrad'),
      componentType: String(line.line_type ?? 'unknown'),
      calculationUnit: String(line.unit ?? 'st'),
      valueAmount: numberValue(line.unit_price_ex_vat),
      quantity: numberValue(line.quantity),
      amountSekExVat: numberValue(line.amount_ex_vat) ?? 0,
      currency: 'SEK',
      appliesTo: 'contract',
      vatRate: numberValue(line.vat_rate) ?? 0,
      vatAmount: numberValue(line.vat_amount) ?? 0,
      amountIncVat: numberValue(line.amount_inc_vat) ?? 0,
      sortOrder: numberValue(line.sort_order) ?? index * 10,
      metadata: line.metadata && typeof line.metadata === 'object' && !Array.isArray(line.metadata)
        ? line.metadata as Record<string, unknown>
        : {},
    })),
    warnings,
    errors,
    locked: true,
  }
}
