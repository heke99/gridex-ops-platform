// Earliest valid supplier-switch / move-in start date calculation.
//
// Swedish electricity market rules in practice:
//   * A normal supplier switch (leverantörsbyte) needs a market lead time
//     before it can take effect.
//   * If the customer's current contract has a binding period / notice period
//     (uppsägningstid / bindningstid), the switch cannot take effect before the
//     contract can legally end.
//   * A move-in (inflyttning) is anchored to the move-in date itself.
//
// This module is pure (no I/O) so it can be unit/regression tested. Callers
// pass the raw stored fields and "today"; the function never guesses silently —
// it returns the chosen date plus the floors that produced it.

export type SwitchStartDateRequestType =
  | "switch"
  | "move_in"
  | "move_out_takeover"
  | string;

export type SwitchStartDateInput = {
  requestType: SwitchStartDateRequestType;
  requestedStartDate?: string | null;
  /** current_supplier_notice_period — free text or a number of days. */
  noticePeriod?: string | number | null;
  /** current_supplier_contract_end_date (ISO date). */
  contractEndDate?: string | null;
  /** customer_sites.move_in_date (ISO date). */
  moveInDate?: string | null;
  /** Minimum market lead time in days for a switch (default 14). */
  marketLeadDays?: number;
  /** Reference "today" (ISO date). Defaults to now. */
  today?: string | Date | null;
};

export type SwitchStartDateResult = {
  /** The date the switch should use. Always a valid ISO date (YYYY-MM-DD). */
  effectiveStartDate: string;
  /** The earliest legally/market-valid date, independent of the requested one. */
  earliestValidStartDate: string;
  /** True when a requested date was provided and honored as-is. */
  requestedHonored: boolean;
  /** True when the requested date was earlier than the earliest valid date. */
  requestedTooEarly: boolean;
  /** Human-readable floors that produced the earliest valid date. */
  floors: Array<{ source: string; date: string }>;
  reason: string;
};

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  // Accept full ISO and date-only.
  const parsed = new Date(trimmed.length <= 10 ? `${trimmed}T00:00:00Z` : trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date.getTime());
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

// Parse a notice period expressed as text or number into an estimated number of
// days from `from`. Returns null when nothing parseable is found. We never throw.
function noticeFloorFromPeriod(
  period: string | number | null | undefined,
  from: Date,
): Date | null {
  if (period === null || period === undefined) return null;
  if (typeof period === "number" && Number.isFinite(period) && period > 0) {
    // A bare number has no legally reliable unit. Require explicit days/weeks/months.
    return null;
  }
  const text = String(period).trim().toLowerCase();
  if (!text) return null;
  const numberMatch = text.match(/(\d+(?:[.,]\d+)?)/);
  const amount = numberMatch ? Number(numberMatch[1].replace(",", ".")) : null;
  if (amount === null || !Number.isFinite(amount) || amount <= 0) return null;
  if (/(månad|manad|month|mån\b|mon\b)/.test(text)) return addMonths(from, Math.ceil(amount));
  if (/(vecka|week|v\b)/.test(text)) return addDays(from, Math.ceil(amount) * 7);
  if (/(år|year)/.test(text)) return addMonths(from, Math.ceil(amount) * 12);
  // Unitless free text is ambiguous and must be completed before dispatch.
  return null;
}

export function calculateEarliestSwitchStartDate(
  input: SwitchStartDateInput,
): SwitchStartDateResult {
  const today = toDate(input.today ?? new Date()) ?? new Date();
  const marketLeadDays = Number.isFinite(input.marketLeadDays as number)
    ? Math.max(0, Number(input.marketLeadDays))
    : 14;

  const floors: Array<{ source: string; date: Date }> = [];

  // Market lead time floor: a switch cannot take effect immediately.
  const marketFloor = addDays(today, marketLeadDays);
  floors.push({ source: "market_lead_time", date: marketFloor });

  const isMove =
    input.requestType === "move_in" || input.requestType === "move_out_takeover";
  const moveInDate = toDate(input.moveInDate);
  if (isMove && moveInDate) {
    // A move anchors the supply start to the move-in date.
    floors.push({ source: "move_in_date", date: moveInDate });
  }

  if (!isMove) {
    const contractEnd = toDate(input.contractEndDate);
    if (contractEnd) {
      // Cannot switch before the current contract can legally end.
      floors.push({ source: "current_contract_end_date", date: contractEnd });
    }
    const noticeFloor = noticeFloorFromPeriod(input.noticePeriod, today);
    if (noticeFloor) {
      floors.push({ source: "notice_period", date: noticeFloor });
    }
  }

  const earliest = floors.reduce((max, f) => (f.date > max ? f.date : max), floors[0].date);
  const earliestValidStartDate = isoDate(earliest);

  const requested = toDate(input.requestedStartDate);
  let effective = earliest;
  let requestedHonored = false;
  let requestedTooEarly = false;
  let reason: string;

  if (requested) {
    if (requested >= earliest) {
      effective = requested;
      requestedHonored = true;
      reason = "Begärt startdatum respekterades eftersom det är giltigt.";
    } else {
      // Never persist an invalid effective date. Keep the requested value in audit metadata,
      // but use the calculated legal/market floor as the effective date.
      effective = earliest;
      requestedHonored = false;
      requestedTooEarly = true;
      reason =
        "Begärt startdatum är tidigare än tidigaste giltiga datum. Effektivt datum flyttades till marknadens tidigaste giltiga datum.";
    }
  } else {
    effective = earliest;
    reason = isMove
      ? "Inget begärt datum – använder tidigaste giltiga datum baserat på inflyttning/marknadsledtid."
      : "Inget begärt datum – använder tidigaste giltiga datum baserat på uppsägningstid/marknadsledtid.";
  }

  return {
    effectiveStartDate: isoDate(effective),
    earliestValidStartDate,
    requestedHonored,
    requestedTooEarly,
    floors: floors.map((f) => ({ source: f.source, date: isoDate(f.date) })),
    reason,
  };
}
