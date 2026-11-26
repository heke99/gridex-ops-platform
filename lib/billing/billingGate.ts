import { stockholmLocalToUtc, strictIsoDate } from "@/lib/time/stockholm";
import { isCanonicalUtiltsDecimal } from '@/lib/ediel/utilts/exactDecimal';
import type { BillingSourceBasis } from './sourceBasis';

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
  | "source_basis_unqualified"
  | "quality_not_established"
  | "quality_not_final"
  | "revision_not_current"
  | "replacement_link_inconsistent"
  | "correction_lineage_missing"
  | "supply_period_missing"
  | "supply_period_conflict"
  | "supply_period_not_active"
  | "supply_period_tenant_mismatch"
  | "supply_period_meter_mismatch"
  | "supply_period_does_not_cover_value"
  | "supply_source_unqualified"
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

function instant(value: unknown, endOfDate = false): bigint | null {
  const raw = text(value);
  if (!raw) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    // Civil end dates include that day. The interval may end at the next midnight.
    const date = new Date(Date.UTC(year, month - 1, day + (endOfDate ? 1 : 0)));
    const milliseconds = stockholmLocalToUtc({
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
    }).getTime();
    return Number.isFinite(milliseconds) ? BigInt(milliseconds) * BigInt(1000) : null;
  }

  const milliseconds = Date.parse(raw);
  if (!Number.isFinite(milliseconds)) return null;
  // Date.parse already includes the first three fractional digits.
  const fraction = /:\d{2}\.(\d+)(?:Z|[+-]\d{2}:?\d{2})?$/i.exec(raw)?.[1] ?? "";
  const subMillisecond = fraction.slice(3, 6).padEnd(3, "0");
  return BigInt(milliseconds) * BigInt(1000) + BigInt(subMillisecond);
}

function contractCivilDate(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const datePart = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? datePart : raw;
}

function exactInstant(value: unknown): bigint | null {
  const raw = text(value);
  return raw && /T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)
    ? instant(raw)
    : null;
}

function plannedEndedContract(supply: Record<string, unknown>, contract: Record<string, unknown>): boolean {
  return supply.status === 'ended' && contract.status === 'terminated'
    && contract.termination_reason === 'supply_end'
    && Boolean(text(supply.source_end_message_id))
    && Boolean(text(contract.id)) && supply.contract_id === contract.id
    && Boolean(text(supply.end_date)) && (supply.actual_end_date ?? supply.end_date) === supply.end_date
    && exactInstant(supply.market_end_at) !== null;
}

function persistedEndedSupplyBasis(
  value: Record<string, unknown>, supply: Record<string, unknown>, contract: Record<string, unknown>,
): boolean {
  const gate = value.billing_gate_snapshot as RecordLike;
  const basis = gate?.supply_source_basis as RecordLike;
  return gate?.status === 'eligible' && gate.contract_id === contract.id
    && gate.normalized_metering_value_id === value.id && gate.source_message_id === value.source_message_id
    && basis?.qualified === true && basis.activated === true
    && basis.companyId === supply.company_id && basis.customerId === supply.customer_id
    && basis.meteringPointId === supply.metering_point_id && basis.periodId === supply.id
    && basis.currentSourceMessageId === supply.source_end_message_id
    && String(basis.marketStateVersion) === String(supply.market_state_version)
    && typeof supply.market_state_version === 'number' && Number.isSafeInteger(supply.market_state_version)
    && exactInstant(basis.marketEndAt) === exactInstant(supply.market_end_at);
}

type AdministrativeMoveOut = {
  effectiveDate: string;
  cutoffAt: bigint;
  recordedAt: string;
  marketStartAt: bigint;
  marketEndAt: bigint | null;
};

function plannedAdministrativeMoveOut(
  value: Record<string, unknown>, supply: Record<string, unknown>, contract: Record<string, unknown>,
  startAt: bigint | null, endAt: bigint | null,
): AdministrativeMoveOut | null {
  if (contract.status !== 'terminated' || contract.termination_reason !== 'move_out' ||
      (supply.status !== 'active' && supply.status !== 'confirmed_by_grid_owner') ||
      supply.source !== 'ediel_qualified_source' || supply.source_process !== 'supplier_switch_confirmation' ||
      !text(supply.source_message_id) || supply.source_end_message_id != null || supply.actual_end_date != null) return null;

  if (!text(contract.id) || supply.contract_id !== contract.id ||
      (supply.customer_contract_id != null && supply.customer_contract_id !== contract.id) ||
      !text(value.customer_id) || value.customer_id !== supply.customer_id ||
      value.direction !== 'consumption' || !isCanonicalUtiltsDecimal(value.quantity_kwh) || value.quantity_kwh.startsWith('-')) {
    return null;
  }

  const metadata = supply.metadata as RecordLike;
  const recordedAt = metadata?.planned_end_recorded_at;
  if (metadata?.planned_end_source !== 'customer_lifecycle_close' || metadata.planned_end_reason !== 'move_out' ||
      typeof recordedAt !== 'string' || exactInstant(recordedAt) === null) return null;

  let effectiveDate: string;
  try { effectiveDate = strictIsoDate(supply.end_date); }
  catch { return null; }
  const cutoffAt = instant(effectiveDate, true);
  const marketStartAt = exactInstant(supply.market_start_at);
  const marketEndAt = exactInstant(supply.market_end_at);
  if (cutoffAt === null || marketStartAt === null || startAt === null || endAt === null ||
      startAt < marketStartAt || startAt >= endAt || endAt > cutoffAt ||
      (supply.market_end_at != null && (marketEndAt === null || endAt > marketEndAt))) return null;

  return { effectiveDate, cutoffAt, recordedAt, marketStartAt, marketEndAt };
}

function persistedAdministrativeMoveOut(
  value: Record<string, unknown>, supply: Record<string, unknown>, contract: Record<string, unknown>,
  moveOut: AdministrativeMoveOut, startAt: bigint | null, endAt: bigint | null, revisionNumber: number,
): boolean {
  const gate = value.billing_gate_snapshot as RecordLike;
  const basis = gate?.supply_source_basis as RecordLike;
  // This field exists only in the native qualified-source projection. A
  // similarly named field in the normalized row's snapshot carries no proof.
  const proof = value.billing_administrative_close_basis as RecordLike;
  if (!gate || !basis || !proof) return false;

  const siteId = text(contract.site_id ?? contract.customer_site_id);
  return value.billing_status === 'billable' && value.billing_gate_status === 'eligible' &&
    gate.status === 'eligible' && value.supply_period_id === supply.id && gate.supply_period_id === supply.id &&
    gate.contract_id === contract.id && gate.company_id === supply.company_id && gate.metering_point_id === supply.metering_point_id &&
    gate.normalized_metering_value_id === value.id && gate.source_metering_value_id === value.source_metering_value_id &&
    gate.source_message_id === value.source_message_id && gate.revision_number === revisionNumber &&
    exactInstant(gate.period_start) === startAt && exactInstant(gate.period_end) === endAt &&
    basis.qualified === true && basis.activated === true && basis.periodId === supply.id &&
    basis.companyId === supply.company_id && basis.customerId === supply.customer_id &&
    basis.meteringPointId === supply.metering_point_id && siteId !== null && basis.siteId === siteId &&
    (contract.customer_site_id == null || contract.customer_site_id === siteId) &&
    basis.currentSourceMessageId === supply.source_message_id && basis.initialSourceMessageId === supply.source_message_id &&
    basis.sourceMessageId === supply.source_message_id &&
    typeof supply.market_state_version === 'number' && Number.isSafeInteger(supply.market_state_version) &&
    basis.marketStateVersion === supply.market_state_version &&
    exactInstant(basis.marketStartAt) === moveOut.marketStartAt &&
    (moveOut.marketEndAt === null ? basis.marketEndAt === null : exactInstant(basis.marketEndAt) === moveOut.marketEndAt) &&
    proof.contractId === contract.id && typeof proof.eventId === 'string' &&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(proof.eventId) &&
    proof.effectiveDate === moveOut.effectiveDate && exactInstant(proof.cutoffAt) === moveOut.cutoffAt &&
    proof.recordedAt === moveOut.recordedAt;
}

function covers(
  startValue: unknown,
  endValue: unknown,
  periodStart: bigint,
  periodEnd: bigint,
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
const ACTIVE_SUPPLY_STATES = new Set(["active", "confirmed_by_grid_owner", "ending", "ended"]);
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
  /** The matcher always sends this provisional status through the native billing-gate RPC. */
  qualifyTerminatedSupplyOnWrite?: boolean;
}): BillingGateDecision {
  const value = input.normalizedValue ?? {};
  const supply = input.supplyPeriod ?? {};
  const contract = input.contract ?? {};
  const source = input.sourceMessage ?? {};
  const basis = value.billing_source_basis as BillingSourceBasis | undefined;
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
  } else if (!text(source.id) || text(source.id) !== text(value.source_message_id)) {
    reasons.push(reason('source_message_missing', 'Ediel-källmeddelandet kunde inte kvalificeras.'));
  } else if (text(source.company_id) !== companyId) {
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
    if (sourceFamily !== "UTILTS") {
      reasons.push(
        reason(
          "source_message_family_not_metering",
          "Källmeddelandet är inte UTILTS.",
        ),
      );
    }
    if (!basis?.qualified && (!sourceStatus || !ACCEPTED_SOURCE_MESSAGE_STATES.has(sourceStatus))) {
      reasons.push(
        reason(
          "source_message_not_validated",
          "Källmeddelandet är inte färdigvaliderat.",
        ),
      );
    }
  }
  if (!basis || basis.version !== 1 || !basis.qualified || basis.normalizedValueId !== text(value.id) || basis.sourceMessageId !== text(value.source_message_id) || basis.quantityType !== '136' || basis.quantityKwh !== value.quantity_kwh || basis.productCode !== (text(value.product_code) ?? null)) {
    reasons.push(reason('source_basis_unqualified', 'Kvantitet, produkt, period och version saknar gemensamt kvalificerat Ediel-underlag.'));
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
    const supplyStatus = (text(supply.status) ?? "").toLowerCase();
    const isEnding = supplyStatus === "ending";
    const hasEndStatus = isEnding || supplyStatus === "ended";
    const marketStart = isEnding ? exactInstant(supply.market_start_at) : null;
    const marketEnd = hasEndStatus ? exactInstant(supply.market_end_at) : null;
    // A scheduled end limits coverage before the period changes to ended.
    if (
      !ACTIVE_SUPPLY_STATES.has(supplyStatus) ||
      (hasEndStatus && (!text(supply.end_date) || marketEnd === null)) ||
      (isEnding && (marketStart === null || marketEnd === null || marketStart >= marketEnd || !text(supply.source_end_message_id)))
    ) {
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
      (!covers(supply.start_date, supply.end_date, periodStart, periodEnd) ||
        (marketStart !== null && periodStart < marketStart) ||
        (marketEnd !== null && periodEnd > marketEnd))
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
    const provisional = input.qualifyTerminatedSupplyOnWrite === true;
    const endedContract = supplyCount === 1 && plannedEndedContract(supply, contract)
      && (provisional || persistedEndedSupplyBasis(value, supply, contract));
    const moveOut = supplyCount === 1 ? plannedAdministrativeMoveOut(value, supply, contract, periodStart, periodEnd) : null;
    // The write branch proposes eligibility to the native owner. Only its stored
    // proof authorizes a later read through the ordinary underlay generator.
    const movedOutContract = moveOut !== null && (provisional ||
      persistedAdministrativeMoveOut(value, supply, contract, moveOut, periodStart, periodEnd, revisionNumber));
    if (!endedContract && !movedOutContract &&
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
  if (!basis?.qualityEstablished) reasons.push(reason('quality_not_established', 'Mätvärdets kvalitet har inte fastställts från egen källobservation.'));
  else if (basis.quality !== null) reasons.push(reason('quality_not_final', 'Källobservationen är inte avläst/exakt och kräver ett särskilt beslut före slutfakturering.'));
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
  if (!isCanonicalUtiltsDecimal(value.quantity_kwh))
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
      gate_version: "2026-09-qualified-source-v2",
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
      source_basis: basis ?? null,
      reason_codes: reasons.map((entry) => entry.code),
    },
  };
}
