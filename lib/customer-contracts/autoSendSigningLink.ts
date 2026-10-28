import "server-only";

import { sendOnlineContractSignatureRequest } from "@/lib/customer-contracts/onlineSigning";
import { supabaseService } from "@/lib/supabase/service";

/**
 * Automatically sends the online signing link after a contract has been
 * committed with status `pending_signature`. Mirrors the manual send action
 * on the contract signature page (same recipient, channel and send function),
 * but never throws: contract creation must not fail because the email could
 * not be queued.
 */

export const SIGNING_LINK_NO_EMAIL_MESSAGE =
  "Kunden saknar e-post – skicka signeringslänken manuellt.";
export const SIGNING_LINK_FAILED_MESSAGE =
  "Avtalet skapades men signeringslänken kunde inte skickas. Skicka den från avtalets signeringssida.";
export const SIGNING_LINK_NOT_PERMITTED_MESSAGE =
  "Avtalet skapades. Signeringslänken skickades inte automatiskt (behörighet contracts.write saknas) – skicka den från avtalets signeringssida.";

export const SIGNING_LINK_DRAFT_MESSAGE =
  "Avtalet sparades som utkast. Signeringslänk för engångsavtal kan inte skickas automatiskt ännu.";
export const SIGNING_LINK_SITE_REQUIRED_MESSAGE =
  'Avtalet behöver en verifierad koppling till kundens anläggning. Välj och spara anläggningen på kundkortets avtal innan signeringslänken skickas.';

/** No customer-wide/first-site fallback: a signing request uses the contract's
 * own unambiguous site, verified inside the exact tenant and customer. */
export async function contractHasValidSigningSite(input: { companyId: string; customerId: string; contractId: string }): Promise<boolean> {
  const contract = await supabaseService.from('customer_contracts').select('site_id,customer_site_id')
    .eq('id', input.contractId).eq('company_id', input.companyId).eq('customer_id', input.customerId).maybeSingle();
  if (contract.error) throw contract.error;
  if (!contract.data) return false;
  const canonical = contract.data.customer_site_id;
  const legacy = contract.data.site_id;
  if (canonical && legacy && canonical !== legacy) return false;
  const siteId = canonical ?? legacy;
  if (!siteId) return false;
  const site = await supabaseService.from('customer_sites').select('id')
    .eq('id', siteId).eq('company_id', input.companyId).eq('customer_id', input.customerId).maybeSingle();
  if (site.error) throw site.error;
  return Boolean(site.data);
}

export function signingLinkSentMessage(email: string) {
  return `Signeringslänk skickad till ${email}`;
}

export type AutoSendSigningLinkResult =
  | { status: "sent"; email: string; message: string }
  | { status: "queued" | "needs_review"; email: string; message: string }
  | {
      status: "skipped";
      reason: "not_pending" | "no_email" | "active_request_exists" | "not_permitted" | "contract_not_found";
      message: string | null;
    }
  | { status: "failed"; error: string; message: string };

export type AutoSendSigningLinkInput = {
  companyId: string;
  customerId: string;
  contractId: string;
  actorUserId: string;
  /** Mirrors the manual action's `contracts.write` requirement. */
  actorCanWriteContracts: boolean;
};

export type AutoSendSigningLinkDeps = {
  loadContract: (input: {
    companyId: string;
    customerId: string;
    contractId: string;
  }) => Promise<{ status: string; signed_at: string | null } | null>;
  loadCustomerEmail: (input: { companyId: string; customerId: string }) => Promise<string | null>;
  hasActiveSignatureRequest: (input: { companyId: string; contractId: string }) => Promise<boolean>;
  hasValidSigningSite?: typeof contractHasValidSigningSite;
  send: typeof sendOnlineContractSignatureRequest;
  logError: (message: string, details: Record<string, unknown>) => void;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeSigningEmail(value: unknown): string | null {
  const email = String(value ?? "").trim().toLowerCase();
  return EMAIL_PATTERN.test(email) ? email : null;
}

const defaultDeps: AutoSendSigningLinkDeps = {
  hasValidSigningSite: contractHasValidSigningSite,
  async loadContract({ companyId, customerId, contractId }) {
    const { data, error } = await supabaseService
      .from("customer_contracts")
      .select("status,signed_at")
      .eq("id", contractId)
      .eq("company_id", companyId)
      .eq("customer_id", customerId)
      .maybeSingle();
    if (error) throw error;
    return data as { status: string; signed_at: string | null } | null;
  },
  async loadCustomerEmail({ companyId, customerId }) {
    const { data, error } = await supabaseService
      .from("customers")
      .select("email")
      .eq("id", customerId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (error) throw error;
    return (data?.email as string | null | undefined) ?? null;
  },
  async hasActiveSignatureRequest({ companyId, contractId }) {
    // The prepare RPC revokes every unused request before inserting a new
    // one, so sending again would replace a live link. Skip instead.
    const { data, error } = await supabaseService
      .from("customer_contract_signature_requests")
      .select("id")
      .eq("company_id", companyId)
      .eq("customer_contract_id", contractId)
      .is("used_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .limit(1);
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  },
  send: sendOnlineContractSignatureRequest,
  logError(message, details) {
    console.error(message, details);
  },
};

export async function autoSendSigningLinkAfterCreate(
  input: AutoSendSigningLinkInput,
  deps: Partial<AutoSendSigningLinkDeps> = {},
): Promise<AutoSendSigningLinkResult> {
  const d = { ...defaultDeps, ...deps };
  try {
    const contract = await d.loadContract(input);
    if (!contract) return { status: "skipped", reason: "contract_not_found", message: null };
    if (contract.status === "draft" && !contract.signed_at) {
      return { status: "skipped", reason: "not_pending", message: SIGNING_LINK_DRAFT_MESSAGE };
    }
    if (contract.status !== "pending_signature" || contract.signed_at) {
      return { status: "skipped", reason: "not_pending", message: null };
    }

    const email = normalizeSigningEmail(await d.loadCustomerEmail(input));
    if (!email) {
      return { status: "skipped", reason: "no_email", message: SIGNING_LINK_NO_EMAIL_MESSAGE };
    }
    if (!input.actorCanWriteContracts) {
      return { status: "skipped", reason: "not_permitted", message: SIGNING_LINK_NOT_PERMITTED_MESSAGE };
    }
    if (!await (d.hasValidSigningSite ?? contractHasValidSigningSite)(input)) {
      return { status: 'needs_review', email, message: SIGNING_LINK_SITE_REQUIRED_MESSAGE };
    }
    if (await d.hasActiveSignatureRequest(input)) {
      return { status: "skipped", reason: "active_request_exists", message: null };
    }

    const delivery = await d.send({
      companyId: input.companyId,
      customerId: input.customerId,
      contractId: input.contractId,
      recipientEmail: email,
      actorUserId: input.actorUserId,
      channel: "internal",
    });
    if (delivery.deliveryStatus === 'sent') {
      return { status: "sent", email, message: signingLinkSentMessage(email) };
    }
    if (delivery.deliveryStatus === 'queued' || delivery.deliveryStatus === 'processing') {
      return { status: 'queued', email, message: `Signeringslänken är köad för utskick till ${email}.` };
    }
    return { status: 'needs_review', email,
      message: 'Avtalet skapades. Signeringslänkens leverans behöver granskas; skapa inget nytt utskick innan det befintliga utfallet har kontrollerats.' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    d.logError("[contracts] automatic signing link send failed", {
      companyId: input.companyId,
      customerId: input.customerId,
      contractId: input.contractId,
      error: message,
    });
    return { status: "failed", error: message, message: SIGNING_LINK_FAILED_MESSAGE };
  }
}
