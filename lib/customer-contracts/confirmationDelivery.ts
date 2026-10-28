import "server-only";
import { supabaseService } from "@/lib/supabase/service";
import type { OnlineSignatureReceipt } from "./onlineSigning";

// Durable signed-contract confirmation continuation (OPS API review F27).
// Rows are created by the signing transaction; this module only advances them.

export type ContractConfirmationState = "pending" | "queued" | "failed";

export const CONFIRMATION_MAX_ATTEMPTS = 8;
const TABLE = "customer_contract_confirmation_deliveries";

type Deliver = (receipt: OnlineSignatureReceipt) => Promise<{ documentSha256: string }>;

/** Backoff for the next retry: 5, 10, 20 … minutes, capped at 6 hours. */
export function confirmationRetryDelayMs(attempts: number): number {
  return Math.min(5 * 60_000 * 2 ** Math.max(0, attempts - 1), 6 * 60 * 60_000);
}

type ConfirmationRef = Pick<OnlineSignatureReceipt, "company_id" | "contract_id" | "request_id">;
type AdvanceResult = {
  state: ContractConfirmationState;
  attempts: number;
  claimed: boolean;
  advanced: boolean;
  leaseUntil: string | null;
};

/** All writes use the versioned DB protocol. Never fall back to legacy writes:
 * old runtime workers are denied by the V2 receipt's database version fence. */
async function advanceDelivery(
  receipt: ConfirmationRef,
  action: "claim" | "queued" | "failed",
  leaseUntil: string | null = null,
  documentSha256: string | null = null,
  message: string | null = null,
): Promise<AdvanceResult> {
  const { data, error } = await supabaseService.rpc("gridex_advance_contract_confirmation_v2", {
    p_company_id: receipt.company_id,
    p_contract_id: receipt.contract_id,
    p_request_id: receipt.request_id,
    p_action: action,
    p_expected_lease_until: leaseUntil,
    p_document_sha256: documentSha256,
    p_error: message,
  });
  if (error) throw error;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("confirmation_protocol_invalid");
  const row = data as Record<string, unknown>;
  const state = row.state;
  if ((state !== "pending" && state !== "queued" && state !== "failed")
    || typeof row.attempts !== "number" || !Number.isInteger(row.attempts) || row.attempts < 0
    || (action === "claim" ? typeof row.claimed !== "boolean" : typeof row.advanced !== "boolean")
    || (row.claimed === true && (typeof row.lease_until !== "string" || !row.lease_until))) {
    throw new Error("confirmation_protocol_invalid");
  }
  return { state, attempts: row.attempts, claimed: row.claimed === true, advanced: row.advanced === true,
    // Do not round PostgreSQL microseconds through a JavaScript Date.
    leaseUntil: typeof row.lease_until === "string" ? row.lease_until : null };
}

export async function attemptContractConfirmationDelivery(
  receipt: OnlineSignatureReceipt,
  deliver: Deliver,
): Promise<{ state: ContractConfirmationState; error: string | null }> {
  const claim = await advanceDelivery(receipt, "claim");
  if (!claim.claimed) return { state: claim.state, error: null };
  let documentSha256: string;
  try {
    documentSha256 = (await deliver(receipt)).documentSha256;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      const marked = await advanceDelivery(receipt, "failed", claim.leaseUntil, null, message);
      return { state: marked.state, error: marked.advanced ? message : `confirmation_lease_lost: ${message}` };
    } catch {
      return { state: "pending", error: `confirmation_failure_not_recorded: ${message}` };
    }
  }
  // Unknown provider outcomes retain the same existing idempotency key. A
  // stale worker cannot complete or reschedule a newer worker's lease.
  try {
    const marked = await advanceDelivery(receipt, "queued", claim.leaseUntil, documentSha256);
    return { state: marked.state, error: marked.advanced ? null : "confirmation_lease_lost" };
  } catch (error) {
    return { state: "pending", error: `confirmation_queued_but_state_not_recorded: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Preclaim worker failures may record only after acquiring their own lease.
 * Caller-supplied attempt counts never override the authoritative locked row. */
export async function recordContractConfirmationFailure(
  receipt: Pick<OnlineSignatureReceipt, "company_id" | "request_id">,
  _previousAttempts: number,
  message: string,
): Promise<void> {
  try {
    const { data, error } = await supabaseService.from(TABLE).select("customer_contract_id")
      .eq("company_id", receipt.company_id).eq("signature_request_id", receipt.request_id).maybeSingle();
    if (error || !data?.customer_contract_id) return;
    const ref = { ...receipt, contract_id: String(data.customer_contract_id) };
    const claim = await advanceDelivery(ref, "claim");
    if (claim.claimed) await advanceDelivery(ref, "failed", claim.leaseUntil, null, message);
  } catch {
    // Isolate this row without a direct write, unowned retry or provider call.
  }
}

export async function loadContractConfirmationState(input: {
  companyId: string;
  signatureRequestId: string;
}): Promise<ContractConfirmationState | null> {
  const { data, error } = await supabaseService
    .from(TABLE)
    .select("state")
    .eq("company_id", input.companyId)
    .eq("signature_request_id", input.signatureRequestId)
    .maybeSingle();
  if (error) throw error;
  const state = data?.state;
  return state === "pending" || state === "queued" || state === "failed" ? state : null;
}

export async function listDueContractConfirmations(limit: number) {
  const { data, error } = await supabaseService
    .from(TABLE)
    .select("company_id,signature_request_id,attempts")
    .eq("state", "pending")
    .lte("next_attempt_at", new Date().toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    companyId: String(row.company_id),
    signatureRequestId: String(row.signature_request_id),
    attempts: Number(row.attempts ?? 0),
  }));
}
