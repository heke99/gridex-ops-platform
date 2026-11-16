export const SWEDISH_STANDARD_VAT_RATE = 0.25;
export const SWEDISH_STANDARD_VAT_PERCENT = 25;

/** Future consumption authoring accepts the canonical rate or its percentage. */
export function standardConsumptionVatPercent(value: unknown): number {
  if (value === null || value === undefined ||
    (typeof value === "string" && value.trim() === "")) {
    return SWEDISH_STANDARD_VAT_PERCENT;
  }
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number(value.trim().replace(",", "."))
      : Number.NaN;
  if (!Number.isFinite(parsed) ||
    (parsed !== SWEDISH_STANDARD_VAT_RATE && parsed !== SWEDISH_STANDARD_VAT_PERCENT)) {
    throw new Error("Moms för nya konsumtionspriser måste vara 25 procent.");
  }
  return SWEDISH_STANDARD_VAT_PERCENT;
}
