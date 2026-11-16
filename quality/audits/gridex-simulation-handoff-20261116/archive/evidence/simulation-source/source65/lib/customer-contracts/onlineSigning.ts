import { tenantSelect, tenantUpdate } from '@/lib/supabase/tenantQuery';
import { tenantDb } from '@/lib/supabase/tenantDb';
import "server-only";
import { requireContractRecordsAvailable } from '@/lib/ediel/retention/customerRecordClasses';

import { attemptContractConfirmationDelivery, listDueContractConfirmations, recordContractConfirmationFailure } from "./confirmationDelivery";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { getBaseAppUrl } from "@/lib/auth/urls";
import { buildAgreementPdfAttachment } from "@/lib/customer-contracts/agreementPdf";
import { archiveSignedCustomerContractPdf, downloadAndVerifyCustomerContractDocument, CUSTOMER_CONTRACT_DOCUMENT_BUCKET, type CustomerContractDocumentRow } from "@/lib/customer-contracts/documents";
import { sendCompanyEmail } from "@/lib/email/sendCompanyEmail";
import { sendContractSignatureEmailNow } from "@/lib/email/emailOutbox";
import { getSupabaseServiceEnv } from "@/lib/env/supabaseServer";
import { supabaseService } from "@/lib/supabase/service";
import { stockholmDateForInstant } from "@/lib/time/stockholm";
import { frozenPriceLines, frozenPriceSummary, pricingFacts } from "./frozenPriceDisplay";
import { companyEmailContext } from "@/lib/website/customerApplicationCommunication";
import { ensurePoaPdfArchive } from '@/lib/customers/poaDocuments';
import { poaMailEvidenceFingerprint, poaMailEvidenceIssues } from '@/lib/email/poaMailEvidence';

const SIGNATURE_TEMPLATE_KEY = "contract.signature_requested";
const SIGNATURE_EVENT_KEY = "contract.signature_requested";
const SIGNATURE_TOKEN_PATTERN = /^[0-9a-f]{64}$/;
export const ONLINE_POA_TERMS_VERSION = 'ops_online_poa_v1';
export const ONLINE_POA_SCOPES = ['supplier_switch', 'facility_information_lookup'];

export type OnlineSignatureChannel =
  | "internal"
  | "website"
  | "partner_api"
  | "customer_portal";

export type OnlineSignatureReceipt = {
  request_id: string;
  company_id: string;
  customer_id: string;
  contract_id: string;
  contract_number: string | null;
  contract_name: string;
  contract_type: string;
  status: string;
  signed_at: string | null;
  used_at: string | null;
  expires_at: string;
  channel: OnlineSignatureChannel;
  customer_name: string;
  customer_email: string | null;
  customer_number: string | null;
  company_name: string;
  offer_reference: string;
  starts_at: string | null;
  ends_at: string | null;
  price_area: string | null;
  pricing_snapshot: Record<string, unknown>;
  pricing_snapshot_sha256: string;
  legal_versions: Array<Record<string, unknown>>;
  legal_bundle_version_id: string;
  contract_publication_version_id: string;
  price_plan_version_id: string;
  signature_snapshot_sha256: string | null;
  withdrawal_deadline_at?: string | null;
  already_signed?: boolean;
};

type SignatureRequestRpcResult = {
  ok: boolean;
  request_id: string;
  company_id: string;
  customer_id: string;
  contract_id: string;
  contract_number: string | null;
  contract_name: string;
  status: string;
  recipient_email: string;
  expires_at: string;
  channel: OnlineSignatureChannel;
  offer_reference: string;
  contract_publication_version_id: string;
  price_plan_version_id: string;
  legal_bundle_version_id: string;
  contract_price_snapshot_id: string;
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requiredString(value: unknown, code: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(code);
  return normalized;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export { frozenPriceSummary } from "./frozenPriceDisplay";

function legalVersionsForPdf(receipt: OnlineSignatureReceipt) {
  return receipt.legal_versions.map((raw, index) => {
    const row = asObject(raw);
    return {
      id: requiredString(
        row.id ?? row.legal_bundle_version_document_id,
        `online_signature_legal_version_${index}_id_missing`,
      ),
      type: requiredString(
        row.module_key ?? row.type,
        `online_signature_legal_version_${index}_type_missing`,
      ),
      title: requiredString(
        row.title ?? row.module_key,
        `online_signature_legal_version_${index}_title_missing`,
      ),
      version:
        optionalString(row.version ?? row.legal_document_version) ??
        requiredString(
          row.document_sha256 ?? row.body_sha256,
          `online_signature_legal_version_${index}_version_missing`,
        ).slice(0, 12),
      body: optionalString(row.body ?? row.rendered_body),
    };
  });
}

function legalVersionsSummary(receipt: OnlineSignatureReceipt): string {
  return legalVersionsForPdf(receipt)
    .map((version) => `${version.title} v${version.version}`)
    .join(", ");
}

export function hashOnlineSignatureToken(token: string): string {
  const normalized = token.trim().toLowerCase();
  if (!SIGNATURE_TOKEN_PATTERN.test(normalized)) {
    throw new Error("online_signature_token_invalid");
  }
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

/** HMAC of the client IP for evidence (the raw IP is never stored). Shared by signing and approvals. */
export function evidenceIpHash(ipAddress: string | null | undefined): string | null {
  const ip = ipAddress?.trim();
  if (!ip) return null;
  const secret =
    process.env.SIGNATURE_EVIDENCE_SECRET?.trim() ||
    getSupabaseServiceEnv().serviceRoleKey;
  return createHmac("sha256", secret).update(ip, "utf8").digest("hex");
}

function signingUrl(token: string): string {
  return `${getBaseAppUrl('signing')}/sign/contract/${token}`;
}

/** Safe diagnostics: never log raw database details, tokens or client values. */
export function onlineSignatureFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : asObject(error).message;
  if (message === 'starts_at is required when status is signed, active, or terminated') return 'delivery_start_date_required';
  const known = ['signature_link_expired', 'signature_link_revoked', 'signature_exact_locked_chain_invalid'];
  return typeof message === 'string' && known.includes(message) ? message : 'signature_finalization_failed';
}

async function ensureSignatureRequestTemplate(companyId: string) {
  const existing = await supabaseService
    .from("company_email_templates")
    .select("id")
    .eq("company_id", companyId)
    .eq("template_key", SIGNATURE_TEMPLATE_KEY)
    .eq("language", "sv")
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return;

  const { error } = await supabaseService.from("company_email_templates").insert({
    company_id: companyId,
    template_key: SIGNATURE_TEMPLATE_KEY,
    name: "Online-signering av elavtal",
    subject: "Signera ditt avtal hos {{company_name}}",
    body_html:
      "<p>Hej {{customer_name}},</p><p>Ditt avtal {{contract_name}} är redo att signeras hos {{company_name}}.</p><p>Avtalsnummer: {{contract_number}}.</p><p><a href=\"{{portal_url}}\">Öppna avtalet och signera online</a></p><p>På sidan ser du den frysta pris- och villkorsversionen. För att signera behöver du bara trycka på knappen <strong>Signera avtal</strong>.</p><p>Har du frågor når du oss på {{support_email}}.</p>",
    body_text:
      "Hej {{customer_name}}, ditt avtal {{contract_name}} hos {{company_name}} är redo att signeras. Avtalsnummer: {{contract_number}}. Öppna {{portal_url}} och tryck Signera avtal. Frågor: {{support_email}}.",
    language: "sv",
    is_active: true,
    updated_at: new Date().toISOString(),
  });
  if (error && error.code !== "23505") throw error;
}

function parseSignatureRequestResult(data: unknown): SignatureRequestRpcResult {
  const row = asObject(data);
  return {
    ok: row.ok === true,
    request_id: requiredString(row.request_id, "signature_request_id_missing"),
    company_id: requiredString(row.company_id, "signature_company_id_missing"),
    customer_id: requiredString(row.customer_id, "signature_customer_id_missing"),
    contract_id: requiredString(row.contract_id, "signature_contract_id_missing"),
    contract_number: optionalString(row.contract_number),
    contract_name: requiredString(row.contract_name, "signature_contract_name_missing"),
    status: requiredString(row.status, "signature_contract_status_missing"),
    recipient_email: requiredString(row.recipient_email, "signature_recipient_missing"),
    expires_at: requiredString(row.expires_at, "signature_expiry_missing"),
    channel: requiredString(row.channel, "signature_channel_missing") as OnlineSignatureChannel,
    offer_reference: requiredString(row.offer_reference, "signature_offer_reference_missing"),
    contract_publication_version_id: requiredString(
      row.contract_publication_version_id,
      "signature_publication_version_missing",
    ),
    price_plan_version_id: requiredString(
      row.price_plan_version_id,
      "signature_price_version_missing",
    ),
    legal_bundle_version_id: requiredString(
      row.legal_bundle_version_id,
      "signature_legal_version_missing",
    ),
    contract_price_snapshot_id: requiredString(
      row.contract_price_snapshot_id,
      "signature_price_snapshot_missing",
    ),
  };
}

function parseReceipt(data: unknown): OnlineSignatureReceipt {
  const row = asObject(data);
  const legalVersions = Array.isArray(row.legal_versions)
    ? row.legal_versions.map((value) => asObject(value))
    : [];
  return {
    request_id: requiredString(row.request_id, "signature_receipt_request_id_missing"),
    company_id: requiredString(row.company_id, "signature_receipt_company_id_missing"),
    customer_id: requiredString(row.customer_id, "signature_receipt_customer_id_missing"),
    contract_id: requiredString(row.contract_id, "signature_receipt_contract_id_missing"),
    contract_number: optionalString(row.contract_number),
    contract_name: requiredString(row.contract_name, "signature_receipt_contract_name_missing"),
    contract_type: requiredString(row.contract_type, "signature_receipt_contract_type_missing"),
    status: requiredString(row.status, "signature_receipt_status_missing"),
    signed_at: optionalString(row.signed_at),
    used_at: optionalString(row.used_at),
    expires_at: requiredString(row.expires_at, "signature_receipt_expiry_missing"),
    channel: requiredString(row.channel, "signature_receipt_channel_missing") as OnlineSignatureChannel,
    customer_name: requiredString(row.customer_name, "signature_receipt_customer_name_missing"),
    customer_email: optionalString(row.customer_email),
    customer_number: optionalString(row.customer_number),
    company_name: requiredString(row.company_name, "signature_receipt_company_name_missing"),
    offer_reference: requiredString(row.offer_reference, "signature_receipt_offer_reference_missing"),
    starts_at: optionalString(row.starts_at),
    ends_at: optionalString(row.ends_at),
    price_area: optionalString(row.price_area),
    pricing_snapshot: asObject(row.pricing_snapshot),
    pricing_snapshot_sha256: requiredString(
      row.pricing_snapshot_sha256,
      "signature_receipt_pricing_hash_missing",
    ),
    legal_versions: legalVersions,
    legal_bundle_version_id: requiredString(
      row.legal_bundle_version_id,
      "signature_receipt_legal_bundle_missing",
    ),
    contract_publication_version_id: requiredString(
      row.contract_publication_version_id,
      "signature_receipt_publication_version_missing",
    ),
    price_plan_version_id: requiredString(
      row.price_plan_version_id,
      "signature_receipt_price_plan_version_missing",
    ),
    signature_snapshot_sha256: optionalString(row.signature_snapshot_sha256),
    withdrawal_deadline_at: optionalString(row.withdrawal_deadline_at),
    already_signed: row.already_signed === true,
  };
}

export async function loadOnlineSignatureReceipt(
  token: string,
): Promise<OnlineSignatureReceipt> {
  const { data, error } = await supabaseService.rpc(
    "gridex_get_customer_contract_signature_receipt_v1",
    { p_token_hash: hashOnlineSignatureToken(token) },
  );
  if (error) throw error;
  const receipt = parseReceipt(data);
  await requireContractRecordsAvailable({ companyId: receipt.company_id, contractId: receipt.contract_id });
  return receipt;
}

export async function sendOnlineContractSignatureRequest(input: {
  companyId: string;
  customerId: string;
  contractId: string;
  recipientEmail: string;
  actorUserId: string;
  channel?: OnlineSignatureChannel;
  expiresInHours?: number;
}) {
  await requireContractRecordsAvailable({ companyId: input.companyId, contractId: input.contractId });
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashOnlineSignatureToken(token);
  // Fail before replacing a live unused request if origin configuration is bad.
  const url = signingUrl(token);
  const expiresInHours = Math.min(Math.max(input.expiresInHours ?? 72, 1), 336);
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseService.rpc(
    "gridex_prepare_customer_contract_signature_request_v1",
    {
      p_company_id: input.companyId,
      p_customer_id: input.customerId,
      p_contract_id: input.contractId,
      p_token_hash: tokenHash,
      p_recipient_email: input.recipientEmail,
      p_expires_at: expiresAt,
      p_actor_user_id: input.actorUserId,
      p_channel: input.channel ?? "internal",
    },
  );
  if (error) throw error;
  const request = parseSignatureRequestResult(data);
  if (!request.ok) throw new Error("signature_request_prepare_failed");

  const [company, customerResult] = await Promise.all([
    companyEmailContext(input.companyId, input.contractId),
    supabaseService
      .from("customers")
      .select("full_name,company_name,first_name,last_name,email,customer_number")
      .eq("id", input.customerId)
      .eq("company_id", input.companyId)
      .single(),
  ]);
  if (customerResult.error) throw customerResult.error;
  await ensureSignatureRequestTemplate(input.companyId);

  const customer = customerResult.data;
  const customerName =
    customer.full_name ??
    customer.company_name ??
    [customer.first_name, customer.last_name].filter(Boolean).join(" ") ??
    request.recipient_email;
  const emailResult = await sendCompanyEmail({
    companyId: input.companyId,
    customerId: input.customerId,
    eventKey: SIGNATURE_EVENT_KEY,
    templateKey: SIGNATURE_TEMPLATE_KEY,
    to: request.recipient_email,
    createdBy: input.actorUserId,
    legalOrCritical: true,
    idempotencyKey: `contract_signature_request:${request.request_id}`,
    variables: {
      customer_name: customerName || request.recipient_email,
      customer_number: customer.customer_number ?? "",
      company_name: company.name,
      contract_name: request.contract_name,
      contract_number: request.contract_number ?? request.contract_id,
      portal_url: url,
      support_email: company.supportEmail ?? company.replyTo ?? request.recipient_email,
    },
    metadata: {
      contract_id: request.contract_id,
      customer_number: customer.customer_number ?? null,
      signature_request_id: request.request_id,
      signature_channel: request.channel,
      signature_expires_at: request.expires_at,
      contract_publication_version_id: request.contract_publication_version_id,
      price_plan_version_id: request.price_plan_version_id,
      legal_bundle_version_id: request.legal_bundle_version_id,
      contract_price_snapshot_id: request.contract_price_snapshot_id,
    },
  });
  if (!emailResult.ok) {
    throw new Error(
      "error" in emailResult && typeof emailResult.error === "string"
        ? emailResult.error
        : "signature_request_email_queue_failed",
    );
  }

  // This legacy RPC records request notification/queue acknowledgement, not a
  // transport receipt. communication_logs is authoritative for sent/delivered.
  const markSent = await supabaseService.rpc(
    "gridex_mark_customer_contract_signature_request_sent_v1",
    { p_request_id: request.request_id, p_company_id: input.companyId },
  );
  if (markSent.error) throw markSent.error;

  let deliveryStatus: string;
  try {
    const delivery = await sendContractSignatureEmailNow({
      companyId: input.companyId, customerId: input.customerId, contractId: input.contractId,
      signatureRequestId: request.request_id, communicationLogId: emailResult.log.id,
    });
    deliveryStatus = delivery.status;
  } catch {
    // The durable queue already exists. Do not create a second intent or claim
    // that a potentially accepted provider request failed; retain it for review.
    deliveryStatus = 'unknown';
  }

  return { request, signingUrl: url, emailResult, deliveryStatus };
}

async function signedContractState(receipt: OnlineSignatureReceipt) {
  const { data, error } = await tenantSelect(receipt.company_id, "customer_contracts", "withdrawal_deadline_at,document_sha256,tenant_communication_snapshot_sha256,signature_snapshot")
    .eq("id", receipt.contract_id)
    .eq("company_id", receipt.company_id)
    .single();
  if (error) throw error;
  return data as {
    withdrawal_deadline_at: string | null;
    document_sha256: string | null;
    tenant_communication_snapshot_sha256: string | null;
    signature_snapshot: Record<string, unknown>;
  };
}

type OnlinePoaReceipt = Pick<OnlineSignatureReceipt, 'company_id' | 'customer_id' | 'contract_id' | 'request_id' | 'signed_at' | 'signature_snapshot_sha256'>;

/** Recover only original, hash-bound signing evidence. A retry has no IP input
 * and cannot create a POA or manufacture missing historical consent. */
export async function archiveOnlineSignaturePoa(receipt: OnlinePoaReceipt, persistedSignature?: Record<string, unknown>) {
  await requireContractRecordsAvailable({ companyId: receipt.company_id, contractId: receipt.contract_id });
  // Receipt delivery has already loaded this exact contract's frozen signature.
  // Legacy and optional contract-only receipts need no new POA lookup/backfill.
  if (persistedSignature && !optionalString(asObject(persistedSignature.power_of_attorney_snapshot).power_of_attorney_id)) return null;
  const contract = await tenantSelect(receipt.company_id, 'customer_contracts', 'signature_snapshot,signature_snapshot_sha256,signed_at')
    .eq('company_id', receipt.company_id).eq('customer_id', receipt.customer_id).eq('id', receipt.contract_id).maybeSingle();
  if (contract.error) throw contract.error;
  const contractRow = contract.data as { signature_snapshot: unknown; signature_snapshot_sha256: string | null; signed_at: string | null } | null;
  if (!contractRow) throw new Error('poa_contract_scope_invalid');
  const signature = asObject(contractRow.signature_snapshot);
  const poaId = optionalString(asObject(signature.power_of_attorney_snapshot).power_of_attorney_id);
  if (!poaId) return null; // Optional contract-only or legacy signature; never backfill.
  if (signature.signature_request_id !== receipt.request_id
    || contractRow.signature_snapshot_sha256 !== receipt.signature_snapshot_sha256
    || !receipt.signed_at || Date.parse(String(contractRow.signed_at)) !== Date.parse(receipt.signed_at)) {
    throw new Error('poa_signature_original_binding_invalid');
  }
  const found = await tenantSelect(receipt.company_id, 'powers_of_attorney', '*')
    .eq('company_id', receipt.company_id).eq('customer_id', receipt.customer_id)
    .eq('customer_contract_id', receipt.contract_id).eq('id', poaId).eq('source', 'ops_online_signature').maybeSingle();
  if (found.error) throw found.error;
  const poa = found.data as Record<string, unknown> | null;
  const evidence = asObject(poa?.evidence_payload);
  if (!poa || poa.status !== 'signed' || poa.revoked_at
    || evidence.signature_request_id !== receipt.request_id
    || evidence.signature_snapshot_sha256 !== receipt.signature_snapshot_sha256
    || evidence.capture_source !== 'actual_signing_request'
    || !poa.signer_name || !poa.signer_identity_number
    || Date.parse(String(poa.accepted_at)) !== Date.parse(receipt.signed_at)
    || poaMailEvidenceIssues(poa).some(issue => issue.code !== 'poa_private_archive_pending')) {
    throw new Error('poa_capture_original_binding_invalid');
  }
  const archived = await ensurePoaPdfArchive({ companyId: receipt.company_id, customerId: receipt.customer_id, powerOfAttorneyId: poaId });
  const sha = createHash('sha256').update(archived.pdf).digest('hex');
  const completed = await supabaseService.rpc('gridex_complete_online_signature_poa_archive_v1', {
    p_company_id: receipt.company_id, p_customer_id: receipt.customer_id, p_contract_id: receipt.contract_id,
    p_request_id: receipt.request_id, p_poa_id: poaId, p_path: archived.path, p_sha256: sha,
    p_evidence_sha256: poaMailEvidenceFingerprint(poa), p_size_bytes: archived.pdf.byteLength,
  });
  if (completed.error) throw completed.error;
  if (asObject(completed.data).power_of_attorney_id !== poaId) throw new Error('poa_archive_completion_receipt_invalid');
  return { filename: `fullmakt-${optionalString(poa.reference) ?? poaId}.pdf`, content: archived.pdf.toString('base64'), contentType: 'application/pdf' };
}

export async function recoverPendingOnlineSignaturePoas(limit = 20) {
  // Platform cron intentionally discovers pending originals across tenants; every
  // subsequent read/write is bound to that original's company and customer.
  const pending = await supabaseService.from('powers_of_attorney').select('*').eq('source', 'ops_online_signature')
    .eq('metadata->>online_signature_archive_pending', 'true').order('updated_at', { ascending: true })
    .limit(Math.min(50, Math.max(1, limit)));
  if (pending.error) throw pending.error;
  const results: Array<{ powerOfAttorneyId: string; state: 'archived' | 'pending' }> = [];
  for (const value of pending.data ?? []) {
    const poa = value as Record<string, unknown>;
    const evidence = asObject(poa.evidence_payload);
    try {
      const attachment = await archiveOnlineSignaturePoa({ company_id: String(poa.company_id), customer_id: String(poa.customer_id),
        contract_id: String(poa.customer_contract_id), request_id: requiredString(evidence.signature_request_id, 'poa_request_missing'),
        signed_at: requiredString(poa.accepted_at, 'poa_original_time_missing'),
        signature_snapshot_sha256: requiredString(evidence.signature_snapshot_sha256, 'poa_original_hash_missing') });
      if (!attachment) throw new Error('poa_original_snapshot_missing');
      results.push({ powerOfAttorneyId: String(poa.id), state: 'archived' });
    } catch {
      // Preserve the immutable consent and original IP. The exact operation
      // remains visibly blocked. Rotate failed rows behind other pending rows.
      await tenantUpdate(String(poa.company_id), 'powers_of_attorney', {
        metadata: { ...asObject(poa.metadata), online_signature_archive_last_error: 'poa_archive_retry_pending' },
        updated_at: new Date().toISOString(),
      }).eq('company_id', String(poa.company_id)).eq('customer_id', String(poa.customer_id))
        .eq('id', String(poa.id)).eq('updated_at', String(poa.updated_at));
      await tenantUpdate(String(poa.company_id), 'customer_operation_jobs', {
        last_error: 'Fullmaktens privata PDF kunde inte verifieras. Automatiken är spärrad; granska originalunderlaget. Arkiveringen återförsöks med samma godkännande.',
        updated_at: new Date().toISOString(),
      }).eq('company_id', String(poa.company_id)).eq('customer_id', String(poa.customer_id))
        .eq('idempotency_key', `contract-signed:${poa.customer_contract_id}`).eq('job_type', 'start_supplier_switch')
        .eq('status', 'blocked').eq('review_reason_code', 'poa_archive_pending')
        .eq('payload->>online_poa_id', String(poa.id)).eq('payload->>signature_request_id', String(evidence.signature_request_id));
      results.push({ powerOfAttorneyId: String(poa.id), state: 'pending' });
    }
  }
  return { processed: results.length, results };
}

export async function loadOnlineSignaturePoaTerms(receipt: Pick<OnlineSignatureReceipt,
  'company_id' | 'customer_id' | 'contract_id' | 'contract_publication_version_id' | 'legal_versions'>) {
  const contract = await tenantSelect(receipt.company_id, 'customer_contracts', 'contract_product_version_id,customer_site_id,site_id')
    .eq('company_id', receipt.company_id).eq('customer_id', receipt.customer_id).eq('id', receipt.contract_id)
    .eq('contract_publication_version_id', receipt.contract_publication_version_id).maybeSingle();
  if (contract.error) throw contract.error;
  const contractRow = contract.data as { contract_product_version_id: string; customer_site_id: string | null; site_id: string | null } | null;
  if (!contractRow) throw new Error('poa_product_scope_invalid');
  // This global immutable version is reached only through the tenant-bound contract.
  const product = await tenantDb(receipt.company_id).unscoped().from('contract_product_versions').select('power_of_attorney_required')
    .eq('id', contractRow.contract_product_version_id).maybeSingle();
  if (product.error) throw product.error;
  if (!product.data) throw new Error('poa_product_version_missing');
  if (contractRow.customer_site_id && contractRow.site_id && contractRow.customer_site_id !== contractRow.site_id) {
    throw new Error('poa_site_scope_ambiguous');
  }
  const siteId = contractRow.customer_site_id ?? contractRow.site_id;
  const site = siteId ? await tenantSelect(receipt.company_id, 'customer_sites', 'street,postal_code,city,facility_id')
    .eq('company_id', receipt.company_id).eq('customer_id', receipt.customer_id).eq('id', siteId).maybeSingle() : null;
  if (site?.error) throw site.error;
  const siteRow = site?.data as { street: string | null; postal_code: string | null; city: string | null; facility_id: string | null } | null | undefined;
  return { required: product.data.power_of_attorney_required !== false,
    available: Boolean(siteRow) && receipt.legal_versions.some(row => row.module_key === 'power_of_attorney'),
    siteAddress: siteRow ? [siteRow.street, siteRow.postal_code, siteRow.city].filter(Boolean).join(', ') : '',
    facilityId: optionalString(siteRow?.facility_id) };
}

export async function deliverSignedContractReceipt(receipt: OnlineSignatureReceipt) {
  await requireContractRecordsAvailable({ companyId: receipt.company_id, contractId: receipt.contract_id });
  if (!receipt.signed_at || !receipt.signature_snapshot_sha256) {
    throw new Error("signed_contract_receipt_evidence_missing");
  }
  const [company, contractState] = await Promise.all([
    companyEmailContext(receipt.company_id, receipt.contract_id),
    signedContractState(receipt),
  ]);
  const poaAttachment = await archiveOnlineSignaturePoa(receipt, contractState.signature_snapshot);
  const price = pricingFacts(receipt.pricing_snapshot);
  const legalVersions = legalVersionsForPdf(receipt);
  const customerEmail = requiredString(
    asObject(contractState.signature_snapshot).recipient_email,
    "signed_contract_recipient_evidence_missing",
  );
  const customerName = optionalString(
    asObject(asObject(contractState.signature_snapshot).customer_identity_snapshot).full_name,
  ) ?? receipt.customer_name;
  const customerNumber =
    receipt.customer_number ?? receipt.customer_id;
  const contractNumber = receipt.contract_number ?? receipt.contract_id;
  const withdrawalDeadline = contractState.withdrawal_deadline_at ?? receipt.withdrawal_deadline_at;
  const cancellationDeadline = withdrawalDeadline ? stockholmDateForInstant(withdrawalDeadline) : "";
  const attachment = contractState.document_sha256 ? {
    filename: `avtalsbekraftelse-${contractNumber}.pdf`,
    content: "",
    contentType: "application/pdf",
  } : buildAgreementPdfAttachment({
    companyName: company.legalName,
    brandName: company.name,
    organizationNumber: company.organizationNumber,
    companyAddress: company.postalAddress,
    companySupportEmail: company.supportEmail,
    companyPhone: company.phone,
    companyWebsite: company.website,
    legalFooter: company.legalFooter,
    customerName,
    customerEmail,
    customerNumber,
    contractNumber,
    contractName: receipt.contract_name,
    contractType: receipt.contract_type,
    signedAt: receipt.signed_at,
    startsAt: receipt.starts_at,
    withdrawalDeadline,
    offerReference: receipt.offer_reference,
    contractPublicationVersionId: receipt.contract_publication_version_id,
    pricePlanVersionId: receipt.price_plan_version_id,
    legalBundleVersionId: receipt.legal_bundle_version_id,
    tenantSnapshotSha256:
      contractState.tenant_communication_snapshot_sha256 ?? company.snapshotSha256,
    evidenceId: `signature-request:${receipt.request_id}`,
    priceLines: frozenPriceLines(receipt.pricing_snapshot),
    monthlyFeeSek: price.monthlyFeeSek,
    invoiceFeeSek: price.invoiceFeeSek,
    spotMarkupOrePerKwh: price.spotMarkupOrePerKwh,
    fixedPriceOrePerKwh: price.fixedPriceOrePerKwh,
    variableFeeOrePerKwh: price.variableFeeOrePerKwh,
    bindingMonths: price.bindingMonths,
    noticeMonths: price.noticeMonths,
    legalVersions,
    signatureSnapshotSha256: receipt.signature_snapshot_sha256,
  });
  let pdfBuffer: Buffer;
  if (contractState.document_sha256) {
    const boundDocument = await supabaseService
      .from("customer_contract_documents")
      .select("*")
      .eq("company_id", receipt.company_id)
      .eq("customer_contract_id", receipt.contract_id)
      .eq("document_type", "signed_contract_pdf")
      .eq("document_sha256", contractState.document_sha256)
      .eq("storage_bucket", CUSTOMER_CONTRACT_DOCUMENT_BUCKET)
      .eq("mime_type", "application/pdf")
      .not("archived_at", "is", null)
      .not("verified_at", "is", null)
      .maybeSingle();
    if (boundDocument.error) throw boundDocument.error;
    if (!boundDocument.data) throw new Error("signed_contract_document_binding_missing");
    pdfBuffer = await downloadAndVerifyCustomerContractDocument(boundDocument.data as CustomerContractDocumentRow);
    attachment.content = pdfBuffer.toString("base64");
  } else {
    pdfBuffer = Buffer.from(attachment.content, "base64");
  }
  const documentSha256 = createHash("sha256").update(pdfBuffer).digest("hex");
  if (!contractState.document_sha256) await archiveSignedCustomerContractPdf({
    companyId: receipt.company_id,
    customerContractId: receipt.contract_id,
    pdfBuffer,
    mimeType: attachment.contentType,
    documentSha256,
    generatedAt: receipt.signed_at,
    generationSnapshot: {
      schema: "gridex_signed_contract_document_v1",
      signature_request_id: receipt.request_id,
      contract_id: receipt.contract_id,
      contract_number: contractNumber,
      signed_at: receipt.signed_at,
      offer_reference: receipt.offer_reference,
      contract_publication_version_id: receipt.contract_publication_version_id,
      price_plan_version_id: receipt.price_plan_version_id,
      legal_bundle_version_id: receipt.legal_bundle_version_id,
      pricing_snapshot_sha256: receipt.pricing_snapshot_sha256,
      signature_snapshot_sha256: receipt.signature_snapshot_sha256,
      tenant_communication_snapshot_sha256:
        contractState.tenant_communication_snapshot_sha256 ?? company.snapshotSha256,
      legal_document_ids: legalVersions.map((version) => version.id),
    },
  });

  if (
    contractState.document_sha256 &&
    contractState.document_sha256 !== documentSha256
  ) {
    throw new Error("signed_contract_document_hash_conflict");
  }
  if (!contractState.document_sha256) {
    const bindDocument = await supabaseService
      .from("customer_contracts")
      .update({ document_sha256: documentSha256 })
      .eq("id", receipt.contract_id)
      .eq("company_id", receipt.company_id)
      .is("document_sha256", null)
      .select("document_sha256")
      .maybeSingle();
    if (bindDocument.error) throw bindDocument.error;
    if (bindDocument.data?.document_sha256 !== documentSha256) {
      throw new Error("signed_contract_document_binding_changed");
    }
  }

  const variables = {
    customer_name: customerName,
    customer_email: customerEmail,
    customer_number: customerNumber,
    company_name: company.name,
    contract_name: receipt.contract_name,
    contract_number: contractNumber,
    contract_type: receipt.contract_type,
    signed_at: receipt.signed_at,
    offer_reference: receipt.offer_reference,
    price_summary: frozenPriceSummary(receipt.pricing_snapshot),
    legal_versions_summary: legalVersionsSummary(receipt),
    agreement_pdf_note:
      "En PDF med den frysta avtals-, pris-, juridik- och bevisinformationen bifogas detta mejl.",
    start_date: receipt.starts_at ?? "",
    support_email: company.supportEmail ?? company.replyTo ?? customerEmail,
    cancellation_deadline: cancellationDeadline,
    portal_url: company.portalUrl ?? getBaseAppUrl(),
  };

  const confirmation = await sendCompanyEmail({
    companyId: receipt.company_id,
    customerId: receipt.customer_id,
    eventKey: "contract.confirmation_sent",
    templateKey: "contract.confirmation_sent",
    to: customerEmail,
    legalOrCritical: true,
    idempotencyKey: `online_signature:${receipt.request_id}:confirmation`,
    variables,
    attachments: [attachment, ...(poaAttachment ? [poaAttachment] : [])],
    metadata: {
      contract_id: receipt.contract_id,
      customer_number: customerNumber,
      signature_request_id: receipt.request_id,
      pricing_snapshot_sha256: receipt.pricing_snapshot_sha256,
      signature_snapshot_sha256: receipt.signature_snapshot_sha256,
      document_sha256: documentSha256,
      contract_publication_version_id: receipt.contract_publication_version_id,
      price_plan_version_id: receipt.price_plan_version_id,
      legal_bundle_version_id: receipt.legal_bundle_version_id,
      source: "canonical_online_signature",
    },
  });
  if (!confirmation.ok) {
    throw new Error("signed_contract_confirmation_queue_failed");
  }

  if (withdrawalDeadline) {
    const coolingOff = await sendCompanyEmail({
      companyId: receipt.company_id,
      customerId: receipt.customer_id,
      eventKey: "contract.cooling_off_sent",
      templateKey: "contract.cooling_off_sent",
      to: customerEmail,
      legalOrCritical: true,
      idempotencyKey: `online_signature:${receipt.request_id}:cooling_off`,
      variables,
      metadata: {
        contract_id: receipt.contract_id,
        customer_number: customerNumber,
        signature_request_id: receipt.request_id,
        signature_snapshot_sha256: receipt.signature_snapshot_sha256,
        source: "canonical_online_signature",
      },
    });
    if (!coolingOff.ok) {
      throw new Error("signed_contract_cooling_off_queue_failed");
    }
  }

  return { documentSha256, confirmationQueued: true };
}

export async function finalizeOnlineContractSignature(input: {
  token: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  powerOfAttorneyAccepted?: boolean;
  powerOfAttorneyTermsVersion?: string | null;
}) {
  const { data, error } = await supabaseService.rpc(
    "gridex_finalize_customer_contract_signature_v2",
    {
      p_token_hash: hashOnlineSignatureToken(input.token),
      p_signed_ip_hash: evidenceIpHash(input.ipAddress),
      p_signed_user_agent: input.userAgent?.slice(0, 1000) ?? null,
      p_signer_ip: input.ipAddress ?? null,
      p_poa_accepted: input.powerOfAttorneyAccepted === true,
      p_poa_scopes: input.powerOfAttorneyAccepted === true ? ONLINE_POA_SCOPES : [],
      p_poa_terms_version: input.powerOfAttorneyTermsVersion ?? null,
    },
  );
  if (error) throw error;
  const receipt = parseReceipt(data);

  await requireContractRecordsAvailable({ companyId: receipt.company_id, contractId: receipt.contract_id });
  // The signing transaction already created a pending delivery continuation
  // (F27). Attempt it now; a failure stays pending for the retry worker and
  // never undoes or repeats the signature.
  const delivery = await attemptContractConfirmationDelivery(receipt, deliverSignedContractReceipt);
  if (delivery.error) {
    console.error("[online signature] post-sign receipt delivery failed", {
      contractId: receipt.contract_id,
      requestId: receipt.request_id,
      error: delivery.error,
    });
  }

  return { receipt, deliveryError: delivery.error, confirmationState: delivery.state };
}

/**
 * Retries pending signed-contract confirmations without signing again (F27).
 * Every row is isolated: a broken row records its own failure and never
 * stops the remaining rows or the rest of the cron.
 */
export async function processPendingContractConfirmations(limit = 20) {
  // Separate durable POA scan also recovers rows whose confirmation has already
  // exhausted its retries; no later request supplies replacement consent/IP.
  const poaRecovery = await recoverPendingOnlineSignaturePoas(limit).catch(() => {
    // An unavailable archive scan must not stop unrelated contract-only
    // confirmations. New POA receipts still enforce their archive gate below.
    console.error('[contract-signing] poa_archive_recovery_unavailable');
    return { processed: 0, results: [], error: 'poa_archive_recovery_unavailable' };
  });
  const due = await listDueContractConfirmations(limit);
  const results: Array<{ signatureRequestId: string; state: string; error: string | null }> = [];
  for (const item of due) {
    const ref = { company_id: item.companyId, request_id: item.signatureRequestId };
    try {
      const request = await supabaseService
        .from("customer_contract_signature_requests")
        .select("token_hash,used_at")
        .eq("id", item.signatureRequestId)
        .eq("company_id", item.companyId)
        .maybeSingle();
      if (request.error) throw request.error;
      if (!request.data?.used_at) throw new Error("signature_request_not_signed");
      const receiptResult = await supabaseService.rpc(
        "gridex_get_customer_contract_signature_receipt_v1",
        { p_token_hash: request.data.token_hash },
      );
      if (receiptResult.error) throw receiptResult.error;
      const receipt = parseReceipt(receiptResult.data);
      if (receipt.company_id !== item.companyId || receipt.request_id !== item.signatureRequestId) {
        throw new Error("signature_receipt_owner_mismatch");
      }
      const delivery = await attemptContractConfirmationDelivery(receipt, deliverSignedContractReceipt);
      results.push({ signatureRequestId: item.signatureRequestId, state: delivery.state, error: delivery.error });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordContractConfirmationFailure(ref, item.attempts, message);
      results.push({ signatureRequestId: item.signatureRequestId, state: "error", error: message });
    }
  }
  return { processed: results.length, results, poaRecovery };
}
