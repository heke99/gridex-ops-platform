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

export async function attemptContractConfirmationDelivery(
  receipt: OnlineSignatureReceipt,
  deliver: Deliver,
): Promise<{ state: ContractConfirmationState; error: string | null }> {
  const current = await supabaseService
    .from(TABLE)
    .select("id,state,attempts")
    .eq("company_id", receipt.company_id)
    .eq("signature_request_id", receipt.request_id)
    .maybeSingle();
  if (current.error) throw current.error;
  if (current.data?.state === "queued") return { state: "queued", error: null };

  try {
    const result = await deliver(receipt);
    const now = new Date().toISOString();
    const marked = await supabaseService
      .from(TABLE)
      .upsert(
        {
          company_id: receipt.company_id,
          customer_contract_id: receipt.contract_id,
          signature_request_id: receipt.request_id,
          state: "queued",
          queued_at: now,
          last_error: null,
          document_sha256: result.documentSha256,
          attempts: Number(current.data?.attempts ?? 0) + 1,
          updated_at: now,
        },
        { onConflict: "signature_request_id" },
      );
    if (marked.error) throw marked.error;
    return { state: "queued", error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const attempts = Number(current.data?.attempts ?? 0) + 1;
    const state: ContractConfirmationState = attempts >= CONFIRMATION_MAX_ATTEMPTS ? "failed" : "pending";
    const now = Date.now();
    await supabaseService
      .from(TABLE)
      .upsert(
        {
          company_id: receipt.company_id,
          customer_contract_id: receipt.contract_id,
          signature_request_id: receipt.request_id,
          state,
          attempts,
          last_error: message.slice(0, 500),
          next_attempt_at: new Date(now + confirmationRetryDelayMs(attempts)).toISOString(),
          updated_at: new Date(now).toISOString(),
        },
        { onConflict: "signature_request_id" },
      )
      .then(() => undefined, () => undefined);
    return { state, error: message };
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
    .select("company_id,signature_request_id")
    .eq("state", "pending")
    .lte("next_attempt_at", new Date().toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    companyId: String(row.company_id),
    signatureRequestId: String(row.signature_request_id),
  }));
}
