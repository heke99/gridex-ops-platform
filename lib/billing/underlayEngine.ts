import { supabaseService } from "@/lib/supabase/service";
import { isPriceArea } from "@/lib/pricing/types";
import { assertBillingPeriodOpen } from "@/lib/billing/invoiceReadiness";
import { assertPlatformSchemaReady } from "@/lib/platform/schemaReadiness";
import {
  stockholmLocalToUtc,
  stockholmMonthBounds,
} from "@/lib/time/stockholm";
import { evaluateBillingGate } from "@/lib/billing/billingGate";

type JsonRecord = Record<string, unknown>;

type UnderlayResult = {
  underlayId: string | null;
  status: "ready_for_pricing" | "needs_review";
  sourceTable: "normalized_metering_values";
  sourceRows: number;
  warnings: string[];
};

const PAGE_SIZE = 1_000;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function object(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function normalizedPriceArea(value: unknown): string | null {
  const candidate = text(value)?.toUpperCase() ?? null;
  return candidate && isPriceArea(candidate) ? candidate : null;
}

export function resolveBillingUnderlayPriceArea(input: {
  snapshot: JsonRecord;
  contract?: JsonRecord | null;
  rows?: JsonRecord[];
}): { priceArea: string | null; conflicts: string[] } {
  const snapshotArea = normalizedPriceArea(input.snapshot.price_area);
  const contractArea = normalizedPriceArea(input.contract?.price_area_used);
  const meteringAreas = new Set(
    (input.rows ?? [])
      .map((row) => normalizedPriceArea(row.price_area ?? row.price_area_code ?? row.bidding_zone_code))
      .filter((area): area is string => Boolean(area)),
  );
  const priceArea = snapshotArea ?? contractArea ?? (meteringAreas.size === 1 ? [...meteringAreas][0] : null);
  const conflicts: string[] = [];
  if (snapshotArea && contractArea && snapshotArea !== contractArea) {
    conflicts.push(`contract:${contractArea}`);
  }
  if (priceArea) {
    for (const area of meteringAreas) {
      if (area !== priceArea) conflicts.push(`metering_value:${area}`);
    }
  }
  if (meteringAreas.size > 1) conflicts.push("metering_values_multiple_price_areas");
  return { priceArea, conflicts: [...new Set(conflicts)] };
}

function strictNumberOrNull(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value.replace(",", "."))
        : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function strictNumber(value: unknown, field: string): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value.replace(",", "."))
        : Number.NaN;
  if (!Number.isFinite(parsed))
    throw new Error(`${field} är inte ett giltigt tal.`);
  return parsed;
}

function quantityKwh(row: JsonRecord): number {
  const quantity = strictNumber(row.quantity_kwh, "quantity_kwh");
  const unit = text(row.unit) ?? "kWh";
  if (unit === "kWh") return quantity;
  if (unit === "Wh") return quantity / 1_000;
  if (unit === "MWh") return quantity * 1_000;
  throw new Error(`Mätenheten ${unit} stöds inte för fakturering.`);
}

type EnergyDirection = "consumption" | "production" | "consumption_correction";

function normalizeEnergyDirection(row: JsonRecord): EnergyDirection {
  const explicit = text(row.direction)?.toLowerCase() ?? null;
  if (
    explicit &&
    ["production", "net_production", "export", "surplus"].includes(explicit)
  ) {
    return "production";
  }
  if (
    explicit &&
    ["consumption_correction", "negative_consumption", "correction"].includes(
      explicit,
    )
  ) {
    return "consumption_correction";
  }
  if (quantityKwh(row) < 0) return "consumption_correction";
  return "consumption";
}

function normalizedBillingRow(row: JsonRecord): JsonRecord {
  const energyDirection = normalizeEnergyDirection(row);
  const explicitDirection = text(row.direction)?.toLowerCase() ?? null;
  return {
    ...row,
    direction: energyDirection,
    quantity_kwh: Math.abs(quantityKwh(row)),
    unit: "kWh",
    energy_direction_inference:
      energyDirection === "consumption_correction" &&
      ![
        "consumption_correction",
        "negative_consumption",
        "correction",
      ].includes(explicitDirection ?? "")
        ? "negative_quantity"
        : "explicit",
  };
}

function productionConfiguration(snapshot: JsonRecord): JsonRecord {
  return object(snapshot.production);
}

function addDays(date: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Ogiltigt kalenderdatum: ${date}`);
  const cursor = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days),
  );
  return cursor.toISOString().slice(0, 10);
}

function localDateBoundary(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Ogiltigt kalenderdatum: ${date}`);
  return stockholmLocalToUtc({
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  }).toISOString();
}

function readinessIssues(warnings: string[]) {
  return warnings.map((message) => ({
    code: "billing_underlay_blocker",
    message,
  }));
}

async function paginatedRows<T extends JsonRecord>(
  loader: (
    from: number,
    to: number,
  ) => Promise<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const response = await loader(from, from + PAGE_SIZE - 1);
    if (response.error) throw response.error;
    const page = response.data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function loadNormalizedValues(
  companyId: string,
  start: string,
  end: string,
): Promise<JsonRecord[]> {
  return paginatedRows<JsonRecord>(async (from, to) => {
    const response = await supabaseService
      .from("normalized_metering_values")
      .select("*")
      .eq("company_id", companyId)
      .eq("revision_status", "current")
      .eq("billing_status", "billable")
      .eq("billing_gate_status", "eligible")
      .not("supply_period_id", "is", null)
      .lt("period_start", end)
      .gt("period_end", start)
      .order("period_start", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);
    return {
      data: (response.data ?? []) as JsonRecord[],
      error: response.error,
    };
  });
}

async function loadSupplyPeriods(
  companyId: string,
  startDate: string,
  endDateInclusive: string,
): Promise<JsonRecord[]> {
  return paginatedRows<JsonRecord>(async (from, to) => {
    const response = await supabaseService
      .from("customer_supply_periods")
      .select("*")
      .eq("company_id", companyId)
      .in("status", ["active", "confirmed_by_grid_owner"])
      .lte("start_date", endDateInclusive)
      .or(`end_date.is.null,end_date.gte.${startDate}`)
      .order("start_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);
    return {
      data: (response.data ?? []) as JsonRecord[],
      error: response.error,
    };
  });
}

async function loadContract(
  companyId: string,
  contractId: string | null,
): Promise<JsonRecord | null> {
  if (!contractId) return null;
  const response = await supabaseService
    .from("customer_contracts")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", contractId)
    .in("status", ["active", "signed"])
    .maybeSingle();
  if (response.error) throw response.error;
  return (response.data as JsonRecord | null) ?? null;
}

async function loadSnapshot(
  companyId: string,
  contractId: string | null,
  segmentStart: string,
): Promise<JsonRecord | null> {
  if (!contractId) return null;
  const date = segmentStart.slice(0, 10);
  const response = await supabaseService
    .from("contract_price_snapshots")
    .select("*")
    .eq("company_id", companyId)
    .eq("contract_id", contractId)
    .lte("valid_from", date)
    .or(`valid_to.is.null,valid_to.gte.${date}`)
    .order("valid_from", { ascending: false })
    .limit(2);
  if (response.error) throw response.error;
  const rows = (response.data ?? []) as JsonRecord[];
  if (
    rows.length > 1 &&
    text(rows[0].valid_from) === text(rows[1].valid_from)
  ) {
    throw new Error(
      `Flera prissnapshots är giltiga samtidigt för avtal ${contractId}.`,
    );
  }
  return rows[0] ?? null;
}

function contractCoversSegment(
  contract: JsonRecord | null,
  segmentStart: string,
  segmentEnd: string,
): boolean {
  if (!contract) return false;
  const startsAt = text(contract.starts_at) ?? text(contract.start_date);
  const endsAt = text(contract.ends_at) ?? text(contract.end_date);
  if (startsAt && Date.parse(startsAt) > Date.parse(segmentStart)) return false;
  if (
    endsAt &&
    Date.parse(
      endsAt.length === 10 ? localDateBoundary(addDays(endsAt, 1)) : endsAt,
    ) < Date.parse(segmentEnd)
  )
    return false;
  return true;
}

function segmentBounds(
  period: JsonRecord,
  monthStart: string,
  monthEnd: string,
): { start: string; end: string } {
  const periodStart = localDateBoundary(String(period.start_date));
  const periodEnd = period.end_date
    ? localDateBoundary(addDays(String(period.end_date), 1))
    : monthEnd;
  return {
    start: new Date(
      Math.max(Date.parse(monthStart), Date.parse(periodStart)),
    ).toISOString(),
    end: new Date(
      Math.min(Date.parse(monthEnd), Date.parse(periodEnd)),
    ).toISOString(),
  };
}

function clipMeteringRowToSegment(
  row: JsonRecord,
  segmentStart: string,
  segmentEnd: string,
): JsonRecord | null {
  const originalStart = Date.parse(String(row.period_start));
  const originalEnd = Date.parse(String(row.period_end));
  const clipStart = Math.max(originalStart, Date.parse(segmentStart));
  const clipEnd = Math.min(originalEnd, Date.parse(segmentEnd));
  if (
    !Number.isFinite(originalStart) ||
    !Number.isFinite(originalEnd) ||
    originalEnd <= originalStart ||
    clipEnd <= clipStart
  )
    return null;
  const ratio = (clipEnd - clipStart) / (originalEnd - originalStart);
  return {
    ...row,
    period_start: new Date(clipStart).toISOString(),
    period_end: new Date(clipEnd).toISOString(),
    quantity_kwh: quantityKwh(row) * ratio,
    unit: "kWh",
    metadata: {
      ...object(row.metadata),
      original_period_start: row.period_start,
      original_period_end: row.period_end,
      overlap_ratio: ratio,
    },
  };
}

function validateIntervalCoverage(
  rows: JsonRecord[],
  segmentStart: string,
  segmentEnd: string,
): { missing: number; warnings: string[] } {
  const warnings: string[] = [];
  const sorted = [...rows].sort(
    (a, b) =>
      Date.parse(String(a.period_start)) - Date.parse(String(b.period_start)) ||
      String(a.id).localeCompare(String(b.id)),
  );
  const seen = new Set<string>();
  let cursor = Date.parse(segmentStart);
  let gapCount = 0;

  for (const row of sorted) {
    const start = Date.parse(String(row.period_start));
    const end = Date.parse(String(row.period_end));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      warnings.push("Ett mätintervall har ogiltig start eller sluttid.");
      continue;
    }
    const key = `${start}|${end}|${text(row.register_code) ?? ""}|${text(row.product_code) ?? ""}|${text(row.direction) ?? ""}`;
    if (seen.has(key))
      warnings.push(
        "Dubbla aktuella mätvärden finns för samma intervall och register.",
      );
    seen.add(key);
    if (start < cursor)
      warnings.push("Överlappande mätintervall finns i fakturasegmentet.");
    if (start > cursor) {
      gapCount += 1;
      warnings.push(
        `Mätvärdeslucka finns från ${new Date(cursor).toISOString()} till ${new Date(start).toISOString()}.`,
      );
    }
    cursor = Math.max(cursor, end);
  }
  if (cursor < Date.parse(segmentEnd)) {
    gapCount += 1;
    warnings.push(`Mätvärdeslucka finns fram till ${segmentEnd}.`);
  }
  if (rows.length === 0) warnings.push("Mätvärden saknas i fakturasegmentet.");
  return { missing: gapCount, warnings: [...new Set(warnings)] };
}

function snapshotPayload(snapshot: JsonRecord | null): JsonRecord {
  if (!snapshot) return {};
  const snapshotJson = object(snapshot.snapshot_json);
  const schemaVersion =
    text(snapshot.snapshot_schema_version) ??
    text(snapshotJson.snapshot_schema) ??
    text(snapshotJson.schema_version);
  if (schemaVersion === "gridex_contract_pricing_v6_selection") {
    const contractType = text(snapshotJson.contract_type);
    if (
      !text(snapshot.price_option_reference) &&
        !text(snapshotJson.price_option_reference) ||
      !text(snapshot.invoice_delivery_method) &&
        !text(snapshotJson.invoice_delivery_method) ||
      (contractType === "fixed" &&
        !text(snapshot.area_price_reference) &&
        !text(snapshotJson.area_price_reference)) ||
      !Array.isArray(snapshot.base_price_components_snapshot) ||
      !Array.isArray(snapshot.price_components_snapshot) ||
      !normalizedPriceArea(snapshotJson.price_area)
    ) {
      throw new Error(
        "Kundavtalets v6-prissnapshot saknar prisalternativ, områdesrad, faktureringssätt, låst prisområde eller exakta komponenter.",
      );
    }
  }
  return {
    ...snapshotJson,
    contract_price_snapshot_id: text(snapshot.id),
    pricing_model:
      text(snapshot.pricing_model) ??
      text(object(snapshot.snapshot_json).pricing_model),
    base_price_components: Array.isArray(
      snapshot.base_price_components_snapshot,
    )
      ? snapshot.base_price_components_snapshot
      : [],
    price_components: Array.isArray(snapshot.price_components_snapshot)
      ? snapshot.price_components_snapshot
      : [],
  };
}

export async function generateBillingUnderlaysForMonth(input: {
  companyId: string;
  billingMonth: string;
  createdBy?: string | null;
  customerId?: string | null;
  meteringPointId?: string | null;
}) {
  await assertPlatformSchemaReady();
  await assertBillingPeriodOpen({
    companyId: input.companyId,
    billingMonth: input.billingMonth,
  });
  const customerScope = input.customerId === undefined || input.customerId === null
    ? null
    : text(input.customerId);
  const meteringPointScope = input.meteringPointId === undefined || input.meteringPointId === null
    ? null
    : text(input.meteringPointId);
  if (input.customerId !== undefined && input.customerId !== null && !customerScope) {
    throw new Error("Billing-underlag fick ett tomt customerId-scope.");
  }
  if (input.meteringPointId !== undefined && input.meteringPointId !== null && !meteringPointScope) {
    throw new Error("Billing-underlag fick ett tomt meteringPointId-scope.");
  }

  const bounds = stockholmMonthBounds(input.billingMonth);
  const allValues = await loadNormalizedValues(
    input.companyId,
    bounds.start,
    bounds.end,
  );
  const allPeriods = await loadSupplyPeriods(
    input.companyId,
    bounds.start.slice(0, 10),
    addDays(bounds.endDateExclusive, -1),
  );
  const values = allValues.filter((row) =>
    (!customerScope || text(row.customer_id) === customerScope) &&
    (!meteringPointScope || text(row.metering_point_id) === meteringPointScope),
  );
  const periods = allPeriods.filter((row) =>
    (!customerScope || text(row.customer_id) === customerScope) &&
    (!meteringPointScope || text(row.metering_point_id) === meteringPointScope),
  );

  const periodsByMeter = new Map<string, JsonRecord[]>();
  for (const period of periods) {
    const meter = text(period.metering_point_id);
    if (!meter) continue;
    periodsByMeter.set(meter, [...(periodsByMeter.get(meter) ?? []), period]);
  }

  const valuesByMeter = new Map<string, JsonRecord[]>();
  for (const row of values) {
    const meter = text(row.metering_point_id);
    if (!meter) throw new Error("Normaliserat mätvärde saknar mätpunkts-ID.");
    valuesByMeter.set(meter, [...(valuesByMeter.get(meter) ?? []), row]);
  }

  const results: UnderlayResult[] = [];
  const pendingStores: Array<{
    underlay: JsonRecord;
    items: JsonRecord[];
    result: Omit<UnderlayResult, "underlayId">;
  }> = [];
  const coveredValueIds = new Set<string>();

  for (const [meteringPointId, meterPeriods] of periodsByMeter) {
    const overlappingPeriods = meterPeriods
      .map((period) => ({
        period,
        ...segmentBounds(period, bounds.start, bounds.end),
      }))
      .filter((entry) => Date.parse(entry.end) > Date.parse(entry.start))
      .sort(
        (a, b) =>
          Date.parse(a.start) - Date.parse(b.start) ||
          String(a.period.id).localeCompare(String(b.period.id)),
      );

    const hasSupplyConflict = overlappingPeriods.some(
      (entry, index) =>
        index > 0 &&
        Date.parse(entry.start) < Date.parse(overlappingPeriods[index - 1].end),
    );
    if (hasSupplyConflict) {
      results.push({
        underlayId: null,
        status: "needs_review",
        sourceTable: "normalized_metering_values",
        sourceRows: (valuesByMeter.get(meteringPointId) ?? []).length,
        warnings: [
          `Överlappande leveransperioder finns för mätpunkt ${meteringPointId}.`,
        ],
      });
      continue;
    }

    for (const entry of overlappingPeriods) {
      const period = entry.period;
      const customerId = text(period.customer_id);
      const contractId = text(period.contract_id);
      const contract = await loadContract(input.companyId, contractId);
      const snapshot = await loadSnapshot(
        input.companyId,
        contractId,
        entry.start,
      );
      const snapshotJson = snapshotPayload(snapshot);
      const contractAreaContext = resolveBillingUnderlayPriceArea({
        snapshot: snapshotJson,
        contract,
      });
      const production = productionConfiguration(snapshotJson);
      const contractDirection =
        text(contract?.energy_direction) ??
        text(snapshotJson.energy_direction) ??
        text(period.energy_direction) ??
        (production.enabled === true ? "production" : null);
      const canonicalContractDirection: "consumption" | "production" | null =
        contractDirection === "consumption" || contractDirection === "production"
          ? contractDirection
          : null;

      const clippedRows = (valuesByMeter.get(meteringPointId) ?? [])
        .map((row) => clipMeteringRowToSegment(row, entry.start, entry.end))
        .filter((row): row is JsonRecord => Boolean(row));
      if (clippedRows.length === 0) {
        if (!canonicalContractDirection) {
          results.push({
            underlayId: null,
            status: "needs_review",
            sourceTable: "normalized_metering_values",
            sourceRows: 0,
            warnings: [
              "energy_direction_missing: Kundavtalet saknar explicit consumption/production-riktning.",
              "missing_meter_values: Mätvärden saknas i fakturasegmentet.",
            ],
          });
          continue;
        }
        const issues = readinessIssues([
          "missing_meter_values: Mätvärden saknas i fakturasegmentet.",
        ]);
        pendingStores.push({
          underlay: {
            customer_id: customerId,
            site_id:
              text(period.customer_site_id) ?? text(period.site_id),
            customer_site_id:
              text(period.customer_site_id) ?? text(period.site_id),
            metering_point_id: meteringPointId,
            supply_period_id: text(period.id),
            contract_id: contractId,
            customer_contract_id: contractId,
            pricing_snapshot_id: text(snapshot?.id),
            contract_price_snapshot_id: text(snapshot?.id),
            price_plan_id: text(contract?.price_plan_id) ?? text(snapshot?.price_plan_id),
            price_plan_version_id: text(snapshot?.price_plan_version_id),
            price_book_id: text(snapshot?.price_book_id),
            price_area: contractAreaContext.priceArea,
            energy_direction: canonicalContractDirection,
            settlement_type:
              canonicalContractDirection === "production"
                ? (text(production.settlement_mode) === "self_billing"
                    ? "self_billing"
                    : "credit_invoice")
                : "invoice",
            underlay_month: bounds.month,
            underlay_year: bounds.year,
            billing_period_start: entry.start,
            billing_period_end: entry.end,
            status: "pending",
            readiness_status: "blocked",
            readiness_issues: issues,
            billing_block_reason: "missing_meter_values",
            total_kwh: 0,
            currency: "SEK",
            source_system: "normalized_metering_values",
            source_meter_value_count: 0,
            missing_values_count: 1,
            payload: {
              billing_month: input.billingMonth,
              source_row_ids: [],
              supply_period_id: text(period.id),
              generated_from: "normalized_metering_values",
              blocker_code: "missing_meter_values",
              energy_direction: canonicalContractDirection,
              settlement_type:
                canonicalContractDirection === "production"
                  ? (text(production.settlement_mode) === "self_billing"
                      ? "self_billing"
                      : "credit_invoice")
                  : "invoice",
              timezone: "Europe/Stockholm",
            },
            pricing_snapshot: snapshotJson,
            received_at: new Date().toISOString(),
            validated_at: null,
          },
          items: [],
          result: {
            status: "needs_review",
            sourceTable: "normalized_metering_values",
            sourceRows: 0,
            warnings: [
              "missing_meter_values: Mätvärden saknas i fakturasegmentet.",
            ],
          },
        });
        continue;
      }
      clippedRows.forEach((row) => coveredValueIds.add(String(row.id)));

      const rowsByDirection = new Map<EnergyDirection, JsonRecord[]>();
      for (const clippedRow of clippedRows) {
        const normalizedRow = normalizedBillingRow(clippedRow);
        const energyDirection = normalizeEnergyDirection(normalizedRow);
        rowsByDirection.set(energyDirection, [
          ...(rowsByDirection.get(energyDirection) ?? []),
          normalizedRow,
        ]);
      }

      for (const [energyDirection, segmentRows] of rowsByDirection) {
        const warnings: string[] = [];
        if (!customerId) warnings.push("Leveransperioden saknar kund.");
        if (!contract) {
          warnings.push(
            "Leveransperioden saknar ett aktivt eller signerat avtal.",
          );
        }
        if (contract && text(contract.customer_id) !== customerId) {
          warnings.push("Avtalet tillhör inte leveransperiodens kund.");
        }
        if (!contractCoversSegment(contract, entry.start, entry.end)) {
          warnings.push(
            "Avtalets giltighet täcker inte hela fakturasegmentet.",
          );
        }
        if (contract && !snapshot) {
          warnings.push(
            "Prissnapshot saknas för avtalet och fakturasegmentet.",
          );
        }

        if (energyDirection === "production") {
          const compensationOre = strictNumberOrNull(
            production.compensation_ore_per_kwh,
          );
          const compensationSek =
            strictNumberOrNull(production.compensation_sek_per_kwh) ??
            (compensationOre === null ? null : compensationOre / 100);
          if (production.enabled !== true) {
            warnings.push(
              "Avtalets låsta prissnapshot saknar aktiverad produktionsavräkning.",
            );
          }
          if (compensationSek === null || compensationSek <= 0) {
            warnings.push(
              "Avtalets låsta prissnapshot saknar giltig ersättning för producerad el.",
            );
          }
          if (
            !["credit_invoice", "self_billing"].includes(
              text(production.settlement_mode) ?? "credit_invoice",
            )
          ) {
            warnings.push(
              "Produktionsavräkningen har ett ogiltigt avräkningssätt.",
            );
          }
        }

        for (const row of segmentRows) {
          if (text(row.supply_period_id) !== text(period.id)) {
            warnings.push(
              `Mätvärde ${text(row.id) ?? "utan id"} har annan eller saknad leveransperiod än fakturasegmentet.`,
            );
          }
          const gate = evaluateBillingGate({
            normalizedValue: row,
            supplyPeriod: period,
            supplyPeriodCandidateCount: 1,
            contract,
            contractCandidateCount: contract ? 1 : 0,
            allowEstimatedValues: false,
          });
          if (!gate.eligible) {
            for (const gateReason of gate.reasons) {
              warnings.push(`${gateReason.code}: ${gateReason.message}`);
            }
          }
          if (text(object(row.billing_gate_snapshot).status) !== "eligible") {
            warnings.push(
              `Mätvärde ${text(row.id) ?? "utan id"} saknar en sparad eligible billing-gate-snapshot.`,
            );
          }
        }

        const registerSet = new Set(
          segmentRows.map(
            (row) =>
              `${text(row.register_code) ?? ""}|${text(row.product_code) ?? ""}`,
          ),
        );
        if (registerSet.size > 1) {
          warnings.push(
            "Flera register eller produktkoder förekommer i samma ekonomiska energiriktning.",
          );
        }

        const totalKwh = segmentRows.reduce(
          (sum, row) => sum + Math.abs(quantityKwh(row)),
          0,
        );
        if (!Number.isFinite(totalKwh) || totalKwh <= 0) {
          warnings.push("Total energimängd är ogiltig eller noll.");
        }

        const coverage = validateIntervalCoverage(
          segmentRows,
          entry.start,
          entry.end,
        );
        warnings.push(...coverage.warnings);

        const first = segmentRows[0];
        const siteId = text(first.site_id) ?? text(first.customer_site_id);
        const customerSiteId = text(first.customer_site_id) ?? siteId;
        const areaContext = resolveBillingUnderlayPriceArea({
          snapshot: snapshotJson,
          contract,
          rows: segmentRows,
        });
        const priceArea = areaContext.priceArea;
        if (!priceArea) {
          warnings.push("Låst prisområde saknas i avtalets prissnapshot.");
        }
        if (areaContext.conflicts.length > 0) {
          warnings.push(
            `Prisområdet i mätdata eller avtal motsäger den låsta prissnapshoten: ${areaContext.conflicts.join(", ")}.`,
          );
        }
        if (
          segmentRows.some(
            (row) =>
              text(row.customer_id) !== customerId ||
              text(row.metering_point_id) !== meteringPointId,
          )
        ) {
          warnings.push(
            "Mätvärdena har inkonsekvent kund- eller mätpunktskoppling.",
          );
        }

        const uniqueWarnings = [...new Set(warnings)];
        const ready = uniqueWarnings.length === 0;
        const now = new Date().toISOString();
        const pricePlanId =
          text(contract?.price_plan_id) ?? text(snapshot?.price_plan_id);
        const pricePlanVersionId = text(snapshot?.price_plan_version_id);
        const settlementType =
          energyDirection === "production"
            ? text(production.settlement_mode) === "self_billing"
              ? "self_billing"
              : "credit_invoice"
            : energyDirection === "consumption_correction"
              ? "credit_invoice"
              : "invoice";

        const items = segmentRows.map((row) => ({
          source_normalized_metering_value_id: text(row.id),
          customer_id: customerId,
          customer_site_id: customerSiteId,
          site_id: siteId,
          metering_point_id: meteringPointId,
          contract_id: contractId,
          price_plan_id: pricePlanId,
          price_plan_version_id: pricePlanVersionId,
          price_book_id: text(snapshot?.price_book_id),
          campaign_id: text(snapshot?.campaign_version_id),
          facility_id: text(row.facility_id),
          price_area: priceArea,
          grid_area: text(row.grid_area),
          source_table: "normalized_metering_values",
          source_transaction_reference: text(row.source_transaction_reference),
          source_line_reference: text(row.source_line_reference),
          period_start: row.period_start,
          period_end: row.period_end,
          quantity: Math.abs(quantityKwh(row)),
          quantity_kwh: Math.abs(quantityKwh(row)),
          energy_direction: energyDirection,
          settlement_type: settlementType,
          unit: "kWh",
          product_code: text(row.product_code),
          register_code: text(row.register_code),
          quality_code: text(row.quality_status),
          resolution: text(row.resolution),
          status: ready ? "ready_for_pricing" : "needs_review",
          warnings: readinessIssues(uniqueWarnings),
          metadata: {
            source_row_id: text(row.id),
            source_metering_value_id: text(row.source_metering_value_id),
            source_message_id: text(row.source_message_id),
            revision_number: row.revision_number ?? null,
            previous_value_id: text(row.previous_value_id),
            billing_gate_snapshot: object(row.billing_gate_snapshot),
            raw_payload: object(row.raw_payload),
            energy_direction: energyDirection,
            original_quantity_kwh: quantityKwh(row),
            source_price_area: normalizedPriceArea(row.price_area ?? row.price_area_code ?? row.bidding_zone_code),
          },
        }));

        const underlay = {
          customer_id: customerId,
          site_id: siteId,
          customer_site_id: customerSiteId,
          metering_point_id: meteringPointId,
          supply_period_id: text(period.id),
          contract_id: contractId,
          customer_contract_id: contractId,
          pricing_snapshot_id: text(snapshot?.id),
          price_plan_id: pricePlanId,
          price_plan_version_id: pricePlanVersionId,
          price_book_id: text(snapshot?.price_book_id),
          contract_price_snapshot_id: text(snapshot?.id),
          billing_block_reason: ready ? null : uniqueWarnings.join("; "),
          campaign_id: text(snapshot?.campaign_version_id),
          price_area: isPriceArea(priceArea) ? priceArea : null,
          energy_direction: energyDirection,
          settlement_type: settlementType,
          underlay_month: bounds.month,
          underlay_year: bounds.year,
          billing_period_start: entry.start,
          billing_period_end: entry.end,
          status: ready ? "validated" : "pending",
          readiness_status: ready ? "ready" : "blocked",
          readiness_issues: readinessIssues(uniqueWarnings),
          total_kwh: totalKwh,
          currency: "SEK",
          source_system: "normalized_metering_values",
          source_meter_value_count: segmentRows.length,
          missing_values_count: coverage.missing,
          payload: {
            billing_month: input.billingMonth,
            source_row_ids: segmentRows.map((row) => text(row.id)),
            supply_period_id: text(period.id),
            generated_from: "normalized_metering_values",
            energy_direction: energyDirection,
            settlement_type: settlementType,
            lineage: segmentRows.map((row) => ({
              normalized_metering_value_id: text(row.id),
              source_metering_value_id: text(row.source_metering_value_id),
              source_message_id: text(row.source_message_id),
              supply_period_id: text(row.supply_period_id),
              revision_number: row.revision_number ?? null,
              energy_direction: energyDirection,
            })),
            timezone: "Europe/Stockholm",
          },
          pricing_snapshot: snapshotJson,
          received_at: now,
          validated_at: ready ? now : null,
        };
        pendingStores.push({
          underlay,
          items,
          result: {
            status: ready ? "ready_for_pricing" : "needs_review",
            sourceTable: "normalized_metering_values",
            sourceRows: segmentRows.length,
            warnings: uniqueWarnings,
          },
        });
      }
    }
  }

  if (pendingStores.length > 0) {
    const { data, error } = await supabaseService.rpc(
      "gridex_store_billing_underlay_batch",
      {
        p_company_id: input.companyId,
        p_commands: pendingStores.map((entry) => ({
          underlay: entry.underlay,
          items: entry.items,
        })),
        p_actor_user_id: input.createdBy ?? null,
      },
    );
    if (error) throw error;
    const storedIds = Array.isArray(data) ? data.map(String) : [];
    if (storedIds.length !== pendingStores.length)
      throw new Error("billing_underlay_batch_result_count_mismatch");
    pendingStores.forEach((entry, index) => {
      results.push({ underlayId: storedIds[index] ?? null, ...entry.result });
    });
  }

  const orphaned = values.filter((row) => !coveredValueIds.has(String(row.id)));
  if (orphaned.length > 0) {
    results.push({
      underlayId: null,
      status: "needs_review",
      sourceTable: "normalized_metering_values",
      sourceRows: orphaned.length,
      warnings: [
        `${orphaned.length} faktureringsgodkända mätvärden saknar en entydig leveransperiod för ${input.billingMonth}.`,
      ],
    });
  }

  return {
    billingMonth: input.billingMonth,
    scope: {
      customerId: customerScope,
      meteringPointId: meteringPointScope,
    },
    sourceTable: "normalized_metering_values" as const,
    sourceRows: values.length,
    underlays: results.length,
    readyForPricing: results.filter((row) => row.status === "ready_for_pricing")
      .length,
    needsReview: results.filter((row) => row.status === "needs_review").length,
    results,
  };
}
