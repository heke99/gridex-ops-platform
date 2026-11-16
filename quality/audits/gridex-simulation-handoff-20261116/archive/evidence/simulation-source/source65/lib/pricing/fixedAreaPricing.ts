export const SWEDISH_PRICE_AREAS = ["SE1", "SE2", "SE3", "SE4"] as const;

export type SwedishPriceArea = (typeof SWEDISH_PRICE_AREAS)[number];

export type FixedAreaPrice = {
  price_area: SwedishPriceArea;
  energy_price_ore_per_kwh: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function isSwedishPriceArea(value: unknown): value is SwedishPriceArea {
  return SWEDISH_PRICE_AREAS.includes(String(value ?? "").toUpperCase() as SwedishPriceArea);
}

function baseComponentRows(
  snapshot: Record<string, unknown> | null | undefined,
  depth = 0,
): unknown[] {
  if (!snapshot || depth > 2) return [];
  if (Array.isArray(snapshot.base_components)) return snapshot.base_components;
  if (Array.isArray(snapshot.base_price_components_snapshot)) {
    return snapshot.base_price_components_snapshot;
  }
  if (Array.isArray(snapshot.base_price_components)) return snapshot.base_price_components;

  for (const nestedKey of ["pricing_snapshot", "commercial_snapshot", "snapshot_json"] as const) {
    const nested: unknown = snapshot[nestedKey];
    if (!isRecord(nested) || nested === snapshot) continue;
    const rows = baseComponentRows(nested, depth + 1);
    if (rows.length > 0) return rows;
  }
  return [];
}

/**
 * Reads canonical fixed prices from the immutable base component snapshot.
 * The snapshot stores SEK/kWh while the public/API contract uses öre/kWh.
 */
export function fixedAreaPricesFromSnapshot(
  snapshot: Record<string, unknown> | null | undefined,
  fallbackFixedPriceOrePerKwh?: number | null,
  fallbackPriceAreas: string[] = [],
): FixedAreaPrice[] {
  const byArea = new Map<SwedishPriceArea, number>();

  for (const candidate of baseComponentRows(snapshot)) {
    if (!isRecord(candidate)) continue;
    const sourceType = String(candidate.source_type ?? candidate.sourceType ?? "").toLowerCase();
    if (sourceType !== "fixed") continue;
    const areaCandidate = candidate.price_area ?? candidate.priceArea;
    if (!isSwedishPriceArea(areaCandidate)) continue;
    const sekPerKwh = numberOrNull(
      candidate.fixed_price_sek_per_kwh ?? candidate.fixedPriceSekPerKwh,
    );
    if (sekPerKwh === null || sekPerKwh < 0) continue;
    byArea.set(String(areaCandidate).toUpperCase() as SwedishPriceArea, Math.round(sekPerKwh * 100 * 1_000_000) / 1_000_000);
  }

  if (byArea.size === 0 && fallbackFixedPriceOrePerKwh !== null && fallbackFixedPriceOrePerKwh !== undefined) {
    for (const area of fallbackPriceAreas) {
      if (isSwedishPriceArea(area)) byArea.set(area.toUpperCase() as SwedishPriceArea, fallbackFixedPriceOrePerKwh);
    }
  }

  return SWEDISH_PRICE_AREAS
    .filter((area) => byArea.has(area))
    .map((area) => ({
      price_area: area,
      energy_price_ore_per_kwh: byArea.get(area) as number,
    }));
}

export function fixedPriceOreForArea(
  snapshot: Record<string, unknown> | null | undefined,
  priceArea: string | null | undefined,
  fallbackFixedPriceOrePerKwh?: number | null,
  fallbackPriceAreas: string[] = [],
): number | null {
  if (!isSwedishPriceArea(priceArea)) return null;
  return fixedAreaPricesFromSnapshot(
    snapshot,
    fallbackFixedPriceOrePerKwh,
    fallbackPriceAreas,
  ).find((row) => row.price_area === priceArea.toUpperCase())?.energy_price_ore_per_kwh ?? null;
}

export function commonFixedPriceOrePerKwh(
  snapshot: Record<string, unknown> | null | undefined,
  fallbackFixedPriceOrePerKwh?: number | null,
  fallbackPriceAreas: string[] = [],
): number | null {
  const values = fixedAreaPricesFromSnapshot(
    snapshot,
    fallbackFixedPriceOrePerKwh,
    fallbackPriceAreas,
  ).map((row) => row.energy_price_ore_per_kwh);
  if (values.length === 0) return fallbackFixedPriceOrePerKwh ?? null;
  const first = values[0];
  return values.every((value) => Math.abs(value - first) < 0.000001) ? first : null;
}


export function selectBaseComponentsForPriceArea(
  snapshot: Record<string, unknown> | null | undefined,
  priceArea: string | null | undefined,
): Record<string, unknown>[] {
  const rows = baseComponentRows(snapshot).filter(isRecord);
  if (rows.length === 0) return [];
  const hasAreaRows = rows.some((row) =>
    isSwedishPriceArea(row.price_area ?? row.priceArea),
  );
  if (!hasAreaRows) return rows;
  if (!isSwedishPriceArea(priceArea)) return [];
  const normalized = priceArea.toUpperCase();
  return rows.filter((row) => {
    const rowArea = row.price_area ?? row.priceArea;
    // Legacy/global components without an area still apply to every area.
    if (rowArea === null || rowArea === undefined || String(rowArea).trim() === "") {
      return true;
    }
    return isSwedishPriceArea(rowArea) && String(rowArea).toUpperCase() === normalized;
  });
}

export function fixedAreaPricesAsAdminText(
  snapshot: Record<string, unknown> | null | undefined,
  fallbackFixedPriceOrePerKwh?: number | null,
  fallbackPriceAreas: string[] = [],
): string {
  return fixedAreaPricesFromSnapshot(
    snapshot,
    fallbackFixedPriceOrePerKwh,
    fallbackPriceAreas,
  )
    .map((row) => `${row.price_area} | ${String(row.energy_price_ore_per_kwh).replace(".", ",")}`)
    .join("\n");
}
