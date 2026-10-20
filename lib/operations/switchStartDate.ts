// Earliest valid supplier-switch / move-in start date calculation.
//
// Swedish electricity market rules in practice:
//   * A normal supplier switch (Z03L) needs the canonical market lead time
//     before it can take effect.
//   * If the customer's current contract has a binding period / notice period
//     (uppsägningstid / bindningstid), the switch cannot take effect before the
//     contract can legally end.
//   * A move-in (Z03LK) is anchored to the move-in date itself and must not
//     inherit the Z03L 14-day floor.
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
  /** current_supplier_notice_period — a duration with an explicit unit. */
  noticePeriod?: string | number | null;
  /** current_supplier_contract_end_date (ISO date). */
  contractEndDate?: string | null;
  /** Independently validated earliest supplier start (ISO date). Ignored for move-in flows. */
  earliestSupplierStartDate?: string | null;
  /** customer_sites.move_in_date (ISO date). */
  moveInDate?: string | null;
  /** Canonical Z03L minimum lead in calendar days. Ignored for move-in flows. */
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
  // Reject impossible calendar dates before Date can silently roll them forward.
  // Accept full ISO and date-only, as before.
  const calendar = trimmed.match(/^(\d{4}-\d{2}-\d{2})(?:$|T)/);
  if (!calendar) return null;
  const day = new Date(`${calendar[1]}T00:00:00Z`);
  if (Number.isNaN(day.getTime()) || isoDate(day) !== calendar[1]) return null;
  const parsed = new Date(trimmed.length <= 10 ? `${trimmed}T00:00:00Z` : trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function marketToday(value: string | Date | null | undefined): Date | null {
  const date = toDate(value);
  if (!date) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return date;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  return toDate(`${part("year")}-${part("month")}-${part("day")}`);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date.getTime());
  const day = next.getUTCDate();
  // Setting the month while still on the 31st can overflow into the next month.
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const lastDay = new Date(next.getTime());
  lastDay.setUTCMonth(lastDay.getUTCMonth() + 1, 0);
  next.setUTCDate(Math.min(day, lastDay.getUTCDate()));
  return next;
}

// Only simple, explicit durations can produce an automatic notice floor.
// Conditional, fractional, unitless and implausibly large values need review.
function noticeFloorFromPeriod(
  period: string | number | null | undefined,
  from: Date,
): Date | null {
  if (period === null || period === undefined) return null;
  if (typeof period === "number") return null;
  const text = String(period).trim().toLowerCase();
  const match = text.match(/^(\d+|en|ett|två|tva|tre)\s*(dag(?:ar)?|days?|d|veck(?:a|or)|weeks?|v|mån(?:ad(?:er)?)?|manad(?:er)?|months?|mon|år|ar|years?)$/u);
  if (!match) return null;
  const words: Record<string, number> = { en: 1, ett: 1, två: 2, tva: 2, tre: 3 };
  const amount = words[match[1]] ?? Number(match[1]);
  if (!Number.isSafeInteger(amount) || amount < 0) return null;
  const unit = match[2];
  // Cap the accepted simple notice at roughly ten years; larger inputs must
  // never overflow Date or silently move a customer far into the future.
  if (/^(?:dag|day|d)/.test(unit)) return amount <= 3660 ? addDays(from, amount) : null;
  if (/^(?:veck|week|v)/.test(unit)) return amount <= 520 ? addDays(from, amount * 7) : null;
  if (/^(?:mån|manad|month|mon)/.test(unit)) return amount <= 120 ? addMonths(from, amount) : null;
  if (/^(?:år|ar|year)/.test(unit)) return amount <= 10 ? addMonths(from, amount * 12) : null;
  return null;
}

export function calculateEarliestSwitchStartDate(
  input: SwitchStartDateInput,
): SwitchStartDateResult {
  const today = marketToday(input.today ?? new Date()) ?? marketToday(new Date())!;
  const marketLeadDays = Number.isFinite(input.marketLeadDays as number)
    ? Math.max(0, Number(input.marketLeadDays))
    : 14;

  const floors: Array<{ source: string; date: Date }> = [];
  const isMove =
    input.requestType === "move_in" || input.requestType === "move_out_takeover";

  // Z03L has a canonical lead-time floor. Z03LK does not: the handbook allows
  // the move-in notification through the move-in day, so a generic 14-day
  // supplier-switch floor would be wrong. For move flows, today is only a
  // safety floor preventing creation of a new request in the past.
  floors.push({
    source: isMove ? "today" : "market_lead_time",
    date: isMove ? today : addDays(today, marketLeadDays),
  });

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
    const supplierStart = toDate(input.earliestSupplierStartDate);
    if (supplierStart) {
      floors.push({ source: "supplier_confirmed_start", date: supplierStart });
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
      ? "Inget begärt datum – använder tidigaste giltiga datum baserat på inflyttning/dagens datum."
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
