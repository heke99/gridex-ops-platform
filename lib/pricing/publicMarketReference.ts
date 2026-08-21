type JsonRecord = Record<string, unknown>

const SWEDISH_STANDARD_VAT_FACTOR = 1.25

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function finite(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function roundPublicPrice(value: number): number {
  return Math.round(value * 1_000_000_000) / 1_000_000_000
}

function recoverExVatPrice(
  gross: number | null,
  includesVat: boolean | undefined,
): number | null {
  if (gross === null) return null
  if (includesVat === false) return gross
  if (includesVat !== true) return null
  return roundPublicPrice(gross / SWEDISH_STANDARD_VAT_FACTOR)
}

function cleanObject<T extends JsonRecord>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, child]) => child !== undefined),
  ) as T
}

/**
 * Projects the internal market reference onto the public website API contract.
 * Internal persistence identifiers must never be exposed to tenant websites.
 */
export function projectPublicMarketReference(value: unknown): JsonRecord | null {
  const row = record(value)
  if (!row) return null

  const includesVat =
    typeof row.includes_vat === 'boolean' ? row.includes_vat : undefined
  const grossSek = finite(row.price_sek_per_kwh)
  const grossOre = finite(row.price_ore_per_kwh)
  const explicitExVatSek = finite(row.price_ex_vat_sek_per_kwh)
  const explicitExVatOre = finite(row.price_ex_vat_ore_per_kwh)
  const exVatSek = explicitExVatSek
    ?? recoverExVatPrice(grossSek, includesVat)
    ?? (explicitExVatOre === null
      ? null
      : roundPublicPrice(explicitExVatOre / 100))
  const exVatOre = explicitExVatOre
    ?? recoverExVatPrice(grossOre, includesVat)
    ?? (exVatSek === null ? null : roundPublicPrice(exVatSek * 100))

  const projected = cleanObject({
    provider: text(row.provider) ?? undefined,
    source: text(row.source) ?? undefined,
    price_area: text(row.price_area) ?? undefined,
    reference_type: text(row.reference_type) ?? undefined,
    reference_period: text(row.reference_period) ?? undefined,
    price_sek_per_kwh: grossSek ?? undefined,
    price_ore_per_kwh: grossOre ?? undefined,
    price_ex_vat_sek_per_kwh: exVatSek ?? undefined,
    price_ex_vat_ore_per_kwh: exVatOre ?? undefined,
    requested_days: finite(row.requested_days) ?? undefined,
    included_days: finite(row.included_days) ?? undefined,
    period_start: text(row.period_start) ?? undefined,
    period_end: text(row.period_end) ?? undefined,
    as_of: text(row.as_of) ?? undefined,
    source_as_of: text(row.source_as_of) ?? undefined,
    generated_at: text(row.generated_at) ?? undefined,
    stale_after: text(row.stale_after) ?? undefined,
    effective_stale_at: text(row.effective_stale_at) ?? undefined,
    source_currency: text(row.source_currency) ?? undefined,
    source_checksum: text(row.source_checksum) ?? undefined,
    source_resolution: text(row.source_resolution) ?? undefined,
    unit: text(row.unit) ?? undefined,
    includes_vat: includesVat,
    includes_supplier_fees:
      typeof row.includes_supplier_fees === 'boolean'
        ? row.includes_supplier_fees
        : undefined,
    includes_grid_fees:
      typeof row.includes_grid_fees === 'boolean'
        ? row.includes_grid_fees
        : undefined,
    is_indicative:
      typeof row.is_indicative === 'boolean' ? row.is_indicative : undefined,
    is_stale: typeof row.is_stale === 'boolean' ? row.is_stale : undefined,
    fallback_used:
      typeof row.fallback_used === 'boolean' ? row.fallback_used : undefined,
    fallback_reason: text(row.fallback_reason) ?? undefined,
    freshness: text(row.freshness) ?? undefined,
  })

  return Object.keys(projected).length > 0 ? projected : null
}
