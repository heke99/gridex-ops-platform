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

const LEASE_MS = 10 * 60_000;

/**
 * Takes a time-bound lease on a pending row so the signing request and the
 * retry worker never deliver concurrently. Returns null when the row is
 * queued, failed or leased by someone else.
 */
async function claimDelivery(receipt: OnlineSignatureReceipt): Promise<{ attempts: number } | null> {
  const now = new Date();
  const claimed = await supabaseService
    .from(TABLE)
    .update({ next_attempt_at: new Date(now.getTime() + LEASE_MS).toISOString(), updated_at: now.toISOString() })
    .eq("company_id", receipt.company_id)
    .eq("signature_request_id", receipt.request_id)
    .eq("state", "pending")
    .lte("next_attempt_at", now.toISOString())
    .select("attempts")
    .maybeSingle();
  if (claimed.error) throw claimed.error;
  return claimed.data ? { attempts: Number(claimed.data.attempts ?? 0) } : null;
}

export async function attemptContractConfirmationDelivery(
  receipt: OnlineSignatureReceipt,
  deliver: Deliver,
): Promise<{ state: ContractConfirmationState; error: string | null }> {
  let claim = await claimDelivery(receipt);
  if (!claim) {
    const current = await loadContractConfirmationState({
      companyId: receipt.company_id,
      signatureRequestId: receipt.request_id,
    });
    if (current !== null) return { state: current, error: null };
    // Signed before the continuation existed: create it, then claim.
    const created = await supabaseService.from(TABLE).upsert(
      {
        company_id: receipt.company_id,
        customer_contract_id: receipt.contract_id,
        signature_request_id: receipt.request_id,
      },
      { onConflict: "company_id,signature_request_id", ignoreDuplicates: true },
    );
    if (created.error) throw created.error;
    claim = await claimDelivery(receipt);
    if (!claim) return { state: "pending", error: null };
  }

  let documentSha256: string;
  try {
    documentSha256 = (await deliver(receipt)).documentSha256;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordContractConfirmationFailure(receipt, claim.attempts, message);
    return { state: claim.attempts + 1 >= CONFIRMATION_MAX_ATTEMPTS ? "failed" : "pending", error: message };
  }

  // Delivery succeeded. A failure to record it keeps the lease; the next run
  // re-delivers with the same idempotency keys, so no duplicate mail.
  const now = new Date().toISOString();
  const marked = await supabaseService
    .from(TABLE)
    .update({
      state: "queued",
      queued_at: now,
      last_error: null,
      document_sha256: documentSha256,
      attempts: claim.attempts + 1,
      updated_at: now,
    })
    .eq("company_id", receipt.company_id)
    .eq("signature_request_id", receipt.request_id)
    .eq("state", "pending");
  if (marked.error) {
    return { state: "pending", error: `confirmation_queued_but_state_not_recorded: ${String(marked.error.message ?? marked.error)}` };
  }
  return { state: "queued", error: null };
}

/** Records a failed attempt with backoff; after the maximum the row is failed. */
export async function recordContractConfirmationFailure(
  receipt: Pick<OnlineSignatureReceipt, "company_id" | "request_id">,
  previousAttempts: number,
  message: string,
): Promise<void> {
  const attempts = previousAttempts + 1;
  const now = Date.now();
  await supabaseService
    .from(TABLE)
    .update({
      state: attempts >= CONFIRMATION_MAX_ATTEMPTS ? "failed" : "pending",
      attempts,
      last_error: message.slice(0, 500),
      next_attempt_at: new Date(now + confirmationRetryDelayMs(attempts)).toISOString(),
      updated_at: new Date(now).toISOString(),
    })
    .eq("company_id", receipt.company_id)
    .eq("signature_request_id", receipt.request_id)
    .eq("state", "pending")
    .then(() => undefined, () => undefined);
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
