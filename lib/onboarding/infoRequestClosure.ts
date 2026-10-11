// Manual close/cancel rules for customer_info_requests. Target statuses are
// limited to values allowed by customer_info_requests_status_check.

export const INFO_REQUEST_CLOSE_STATUSES = ["cancelled", "completed"] as const;
export type InfoRequestCloseStatus = (typeof INFO_REQUEST_CLOSE_STATUSES)[number];

export const INFO_REQUEST_TERMINAL_STATUSES = ["cancelled", "rejected", "completed"] as const;

// Requests waiting on an Ediel acknowledgement/response must not be closed
// manually; the inbound projection would otherwise reopen or conflict.
export const INFO_REQUEST_IN_FLIGHT_STATUSES = [
  "sent_to_grid_owner",
  "waiting_for_contrl",
  "waiting_for_aperak",
  "waiting_for_z02",
] as const;

export function isInfoRequestCloseStatus(value: string): value is InfoRequestCloseStatus {
  return (INFO_REQUEST_CLOSE_STATUSES as readonly string[]).includes(value);
}

export function canCloseInfoRequest(currentStatus: string | null | undefined): boolean {
  const status = currentStatus ?? "";
  return !(INFO_REQUEST_TERMINAL_STATUSES as readonly string[]).includes(status) &&
    !(INFO_REQUEST_IN_FLIGHT_STATUSES as readonly string[]).includes(status);
}

/** Returns a Swedish error message, or null when the closure is allowed. */
export function validateInfoRequestClosure(input: {
  currentStatus: string | null | undefined;
  targetStatus: string;
  reason: string | null | undefined;
}): string | null {
  if (!isInfoRequestCloseStatus(input.targetStatus)) {
    return "Ogiltig status. Välj Avbruten eller Slutförd.";
  }
  const reason = (input.reason ?? "").trim();
  if (reason.length < 3) {
    return "Ange en orsak (minst 3 tecken) innan ärendet stängs.";
  }
  if (reason.length > 1000) {
    return "Orsaken får vara högst 1000 tecken.";
  }
  const current = input.currentStatus ?? "";
  if ((INFO_REQUEST_TERMINAL_STATUSES as readonly string[]).includes(current)) {
    return "Ärendet är redan stängt.";
  }
  if ((INFO_REQUEST_IN_FLIGHT_STATUSES as readonly string[]).includes(current)) {
    return "Ärendet väntar på svar från nätägaren och kan inte stängas manuellt nu.";
  }
  return null;
}
