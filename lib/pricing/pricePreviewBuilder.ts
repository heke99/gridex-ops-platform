import type { PricingPreviewLine, PricingPreviewResult } from '@/lib/pricing/types'

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

export function finalizePricingPreview(input: {
  billingUnderlayId?: string | null
  lines: PricingPreviewLine[]
  warnings?: string[]
  errors?: string[]
  vatRate?: number
}): PricingPreviewResult {
  const vatRate = input.vatRate ?? 0.25
  const sorted = [...input.lines].sort((a, b) => a.sortOrder - b.sortOrder)
  const normalized = sorted.map((line) => {
    const vatAmount = line.vatRate === 0 && line.vatAmount === 0 ? roundMoney(line.amountExVat * vatRate) : line.vatAmount
    const effectiveVatRate = line.vatRate === 0 && line.vatAmount === 0 ? vatRate : line.vatRate
    return {
      ...line,
      vatRate: effectiveVatRate,
      vatAmount,
      amountIncVat: roundMoney(line.amountExVat + vatAmount),
    }
  })

  const totalExVat = roundMoney(normalized.reduce((sum, line) => sum + line.amountExVat, 0))
  const vatAmount = roundMoney(normalized.reduce((sum, line) => sum + line.vatAmount, 0))
  const errors = input.errors ?? []

  return {
    status: errors.length > 0 ? 'failed' : 'success',
    billingUnderlayId: input.billingUnderlayId ?? null,
    totalExVat,
    vatAmount,
    totalIncVat: roundMoney(totalExVat + vatAmount),
    lines: normalized,
    warnings: input.warnings ?? [],
    errors,
  }
}
