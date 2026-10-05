import type { EdielProcessNextAction } from "@/lib/ediel/operations/processNextAction";

/** Static customer_info_requests statuses that only claim the request is out
 * and awaiting a response. Under OPS-02 they never decide "waiting" alone. */
export const STATIC_INFO_REQUEST_WAITING_STATUSES: readonly string[] = Object.freeze([
  "sent_to_grid_owner",
  "waiting_for_z02",
  "waiting_for_aperak",
  "waiting_for_contrl",
]);

export type InfoRequestQueueState = {
  // Queue status used for action-required filtering.
  status: string;
  title: string | null;
  description: string | null;
  priority: "normal" | "high" | null;
};

/**
 * OPS-02: derive a work-queue row's state for an info request from the native
 * process decision of its Ediel source message. Returns null when the static
 * status is not a "waiting" claim (existing status handling then applies).
 * With decisions read but none for the source, the row is held for review
 * instead of trusting the static status.
 */
export function infoRequestProcessQueueState(input: {
  status: string | null | undefined;
  edielMessageId: string | null | undefined;
  processDecisions: ReadonlyMap<string, EdielProcessNextAction>;
}): InfoRequestQueueState | null {
  const decision = input.edielMessageId ? input.processDecisions.get(input.edielMessageId) ?? null : null;
  const staticWaiting = STATIC_INFO_REQUEST_WAITING_STATUSES.includes(String(input.status ?? ""));
  if (!decision) {
    if (!staticWaiting) return null;
    return {
      status: "process_decision_missing",
      title: "Processbeslut saknas",
      description: "Det skickade meddelandet saknar processbeslut. Väntan visas inte utifrån en statisk status.",
      priority: "high",
    };
  }
  if (decision.cause === "business_response_received") {
    return { status: "process_response_received", title: "Svar mottaget", description: decision.summary, priority: decision.blockers.length ? "high" : "normal" };
  }
  const blocked =
    decision.blockers.length > 0 ||
    ["business_response_rejected", "technical_rejection", "source_context_held"].includes(decision.cause);
  if (blocked) {
    return { status: "action_required", title: "Granska processbeslut", description: decision.summary, priority: "high" };
  }
  return {
    status: "process_waiting",
    title: decision.responsibility === "counterparty" ? "Väntar på motpart" : "Väntar",
    description: decision.summary,
    priority: "normal",
  };
}
