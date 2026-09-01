import { stockholmLocalToUtc } from "@/lib/time/stockholm";

export type BillingGateStatus =
  "eligible" | "pending_match" | "blocked" | "conflict";

export type BillingGateReasonCode =
  | "tenant_missing"
  | "metering_point_missing"
  | "period_invalid"
  | "source_metering_value_missing"
  | "source_message_missing"
  | "source_message_tenant_mismatch"
  | "source_message_not_validated"
  | "source_message_family_not_metering"
  | "revision_not_current"
  | "replacement_link_inconsistent"
  | "correction_lineage_missing"
  | "supply_period_missing"
  | "supply_period_conflict"
  | "supply_period_not_active"
  | "supply_period_tenant_mismatch"
  | "supply_period_meter_mismatch"
  | "supply_period_does_not_cover_value"
  | "customer_missing"
  | "contract_missing"
  | "contract_conflict"
  | "contract_not_active"
  | "contract_tenant_mismatch"
  | "contract_customer_mismatch"
  | "contract_meter_mismatch"
  | "contract_does_not_cover_value"
  | "estimated_value_blocked"
  | "unsupported_direction"
  | "unsupported_unit"
  | "quantity_invalid";

export type BillingGateReason = {
  code: BillingGateReasonCode;
  message: string;
};

export type BillingGateDecision = {
  eligible: boolean;
  status: BillingGateStatus;
  reasons: BillingGateReason[];
  snapshot: Record<string, unknown>;
};

type RecordLike = Record<string, unknown> | null | undefined;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function instant(value: unknown, endOfDate = false): number | null {
  const raw = text(value);
  if (!raw) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!endOfDate) return stockholmLocalToUtc({ year, month, day }).getTime();
    const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
    return (
      stockholmLocalToUtc({
        year: nextDay.getUTCFullYear(),
        month: nextDay.getUTCMonth() + 1,
        day: nextDay.getUTCDate(),
      }).getTime() - 1
    );
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function contractCivilDate(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const datePart = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? datePart : raw;
}

function covers(
  startValue: unknown,
  endValue: unknown,
  periodStart: number,
  periodEnd: number,
): boolean {
  const start = instant(startValue);
  const end = instant(endValue, true);
  return (
    (start === null || start <= periodStart) &&
    (end === null || end >= periodEnd)
  );
}

function reason(
  code: BillingGateReasonCode,
  message: string,
): BillingGateReason {
  return { code, message };
}

const ESTIMATED_QUALITY = new Set([
  "estimated",
  "estimate",
  "preliminary",
  "preliminar",
  "preliminär",
  "e",
  "p",
]);
const ACTIVE_SUPPLY_STATES = new Set(["active", "confirmed_by_grid_owner"]);
const ACTIVE_CONTRACT_STATES = new Set(["signed", "active"]);
const ACCEPTED_SOURCE_MESSAGE_STATES = new Set([
  "parsed",
  "validated",
  "acknowledged",
]);

export function evaluateBillingGate(input: {
  normalizedValue: RecordLike;
  supplyPeriod?: RecordLike;
  supplyPeriodCandidateCount?: number;
  contract?: RecordLike;
  contractCandidateCount?: number;
  sourceMessage?: RecordLike;
  allowEstimatedValues?: boolean;
  evaluatedAt?: string;
}): BillingGateDecision {
  const value = input.normalizedValue ?? {};
  const supply = input.supplyPeriod ?? {};
  const contract = input.contract ?? {};
  const source = input.sourceMessage ?? {};
  const reasons: BillingGateReason[] = [];

  const companyId = text(value.company_id);
  const meteringPointId = text(value.metering_point_id);
  const periodStart = instant(value.period_start);
  const periodEnd = instant(value.period_end);
  const supplyCount =
    input.supplyPeriodCandidateCount ?? (text(supply.id) ? 1 : 0);
  const contractCount =
    input.contractCandidateCount ?? (text(contract.id) ? 1 : 0);

  if (!companyId)
    reasons.push(reason("tenant_missing", "Mätvärdet saknar tenant."));
  if (!meteringPointId)
    reasons.push(
      reason("metering_point_missing", "Mätvärdet saknar mätpunkt."),
    );
  if (periodStart === null || periodEnd === null || periodEnd <= periodStart) {
    reasons.push(reason("period_invalid", "Mätvärdets period är ogiltig."));
  }

  if (!text(value.source_metering_value_id)) {
    reasons.push(
      reason(
        "source_metering_value_missing",
        "Normaliserat värde saknar källrad i metering_values.",
      ),
    );
  }
  if (!text(value.source_message_id)) {
    reasons.push(
      reason(
        "source_message_missing",
        "Normaliserat värde saknar Ediel-källmeddelande.",
      ),
    );
  } else if (text(source.company_id) && text(source.company_id) !== companyId) {
    reasons.push(
      reason(
        "source_message_tenant_mismatch",
        "Källmeddelandet tillhör en annan tenant.",
      ),
    );
  }
  if (text(value.source_message_id)) {
    const sourceFamily = text(source.message_family)?.toUpperCase();
    const sourceStatus = text(source.status)?.toLowerCase();
    if (sourceFamily && sourceFamily !== "UTILTS") {
      reasons.push(
        reason(
          "source_message_family_not_metering",
          "Källmeddelandet är inte UTILTS.",
        ),
      );
    }
    if (sourceStatus && !ACCEPTED_SOURCE_MESSAGE_STATES.has(sourceStatus)) {
      reasons.push(
        reason(
          "source_message_not_validated",
          "Källmeddelandet är inte färdigvaliderat.",
        ),
      );
    }
  }

  if ((text(value.revision_status) ?? "current").toLowerCase() !== "current") {
    reasons.push(
      reason("revision_not_current", "Endast aktuell revision får faktureras."),
    );
  }
  if (text(value.replaced_by_value_id)) {
    reasons.push(
      reason(
        "replacement_link_inconsistent",
        "Aktuell revision pekar på en ersättande revision.",
      ),
    );
  }
  const revisionNumber = number(value.revision_number) ?? 1;
  if (revisionNumber > 1 && !text(value.previous_value_id)) {
    reasons.push(
      reason(
        "correction_lineage_missing",
        "Korrigerad revision saknar länk till föregående värde.",
      ),
    );
  }

  if (supplyCount === 0)
    reasons.push(
      reason(
        "supply_period_missing",
        "Ingen leveransperiod täcker hela mätvärdet.",
      ),
    );
  if (supplyCount > 1)
    reasons.push(
      reason(
        "supply_period_conflict",
        "Flera leveransperioder täcker samma mätvärde.",
      ),
    );
  if (supplyCount === 1) {
    if (!ACTIVE_SUPPLY_STATES.has((text(supply.status) ?? "").toLowerCase())) {
      reasons.push(
        reason(
          "supply_period_not_active",
          "Leveransperioden är inte affärsmässigt aktiv.",
        ),
      );
    }
    if (text(supply.company_id) !== companyId)
      reasons.push(
        reason(
          "supply_period_tenant_mismatch",
          "Leveransperioden tillhör en annan tenant.",
        ),
      );
    if (text(supply.metering_point_id) !== meteringPointId)
      reasons.push(
        reason(
          "supply_period_meter_mismatch",
          "Leveransperioden avser en annan mätpunkt.",
        ),
      );
    if (
      periodStart !== null &&
      periodEnd !== null &&
      !covers(supply.start_date, supply.end_date, periodStart, periodEnd)
    ) {
      reasons.push(
        reason(
          "supply_period_does_not_cover_value",
          "Leveransperioden täcker inte hela mätvärdesintervallet.",
        ),
      );
    }
  }

  const customerId = text(supply.customer_id) ?? text(value.customer_id);
  if (!customerId)
    reasons.push(reason("customer_missing", "Kundkoppling saknas."));
  if (contractCount === 0)
    reasons.push(
      reason("contract_missing", "Aktivt eller signerat avtal saknas."),
    );
  if (contractCount > 1)
    reasons.push(
      reason(
        "contract_conflict",
        "Flera avtal matchar samma faktureringsperiod.",
      ),
    );
  if (contractCount === 1) {
    if (
      !ACTIVE_CONTRACT_STATES.has((text(contract.status) ?? "").toLowerCase())
    ) {
      reasons.push(
        reason("contract_not_active", "Avtalet är inte signerat eller aktivt."),
      );
    }
    if (text(contract.company_id) !== companyId)
      reasons.push(
        reason("contract_tenant_mismatch", "Avtalet tillhör en annan tenant."),
      );
    if (text(contract.customer_id) !== customerId)
      reasons.push(
        reason("contract_customer_mismatch", "Avtalet tillhör en annan kund."),
      );
    if (text(contract.metering_point_id) !== meteringPointId)
      reasons.push(
        reason("contract_meter_mismatch", "Avtalet avser en annan mätpunkt."),
      );
    if (
      periodStart !== null &&
      periodEnd !== null &&
      !covers(
        contractCivilDate(contract.starts_at ?? contract.start_date),
        contractCivilDate(contract.ends_at ?? contract.end_date),
        periodStart,
        periodEnd,
      )
    ) {
      reasons.push(
        reason(
          "contract_does_not_cover_value",
          "Avtalets giltighet täcker inte hela mätvärdesintervallet.",
        ),
      );
    }
  }

  const quality = (
    text(value.quality_status ?? value.quality_code) ?? ""
  ).toLowerCase();
  if (!input.allowEstimatedValues && ESTIMATED_QUALITY.has(quality)) {
    reasons.push(
      reason(
        "estimated_value_blocked",
        "Preliminära eller estimerade värden är inte godkända för slutfakturering.",
      ),
    );
  }
  const direction = (text(value.direction) ?? "consumption").toLowerCase();
  if (
    ![
      "consumption",
      "net_consumption",
      "consumption_correction",
      "negative_consumption",
      "production",
      "net_production",
      "export",
      "surplus",
    ].includes(direction)
  )
    reasons.push(
      reason(
        "unsupported_direction",
        "Mätvärdets energiriktning stöds inte av faktureringsmotorn.",
      ),
    );
  if (!["Wh", "kWh", "MWh"].includes(text(value.unit) ?? "kWh"))
    reasons.push(
      reason(
        "unsupported_unit",
        "Mätenheten stöds inte av faktureringsmotorn.",
      ),
    );
  if (number(value.quantity_kwh ?? value.value_kwh) === null)
    reasons.push(
      reason("quantity_invalid", "Mätvärdets kvantitet är ogiltig."),
    );

  const conflict = reasons.some((entry) =>
    ["supply_period_conflict", "contract_conflict"].includes(entry.code),
  );
  const pending = reasons.some((entry) =>
    [
      "tenant_missing",
      "metering_point_missing",
      "supply_period_missing",
      "customer_missing",
    ].includes(entry.code),
  );
  const status: BillingGateStatus =
    reasons.length === 0
      ? "eligible"
      : conflict
        ? "conflict"
        : pending
          ? "pending_match"
          : "blocked";
  const evaluatedAt = input.evaluatedAt ?? new Date().toISOString();

  return {
    eligible: status === "eligible",
    status,
    reasons,
    snapshot: {
      evaluated_at: evaluatedAt,
      gate_version: "2026-07-canonical-v1",
      status,
      normalized_metering_value_id: text(value.id),
      source_metering_value_id: text(value.source_metering_value_id),
      source_message_id: text(value.source_message_id),
      supply_period_id: text(supply.id),
      contract_id: text(contract.id),
      company_id: companyId,
      metering_point_id: meteringPointId,
      period_start: text(value.period_start),
      period_end: text(value.period_end),
      revision_number: revisionNumber,
      quality_status: quality || null,
      reason_codes: reasons.map((entry) => entry.code),
    },
  };
}
