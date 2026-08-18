import "server-only";

import { createHash, createHmac, randomBytes } from "node:crypto";
import { getBaseAppUrl } from "@/lib/auth/urls";
import { buildAgreementPdfAttachment } from "@/lib/customer-contracts/agreementPdf";
import { archiveSignedCustomerContractPdf } from "@/lib/customer-contracts/documents";
import { sendCompanyEmail } from "@/lib/email/sendCompanyEmail";
import { getSupabaseServiceEnv } from "@/lib/env/supabaseServer";
import { supabaseService } from "@/lib/supabase/service";
import { companyEmailContext } from "@/lib/website/customerApplicationCommunication";

const SIGNATURE_TEMPLATE_KEY = "contract.signature_requested";
const SIGNATURE_EVENT_KEY = "contract.signature_requested";
const SIGNATURE_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

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

function optionalNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function componentCode(value: Record<string, unknown>): string {
  const metadata = asObject(value.metadata);
  return String(
    value.component_code ??
      value.componentCode ??
      metadata.component_code ??
      metadata.componentCode ??
      "",
  )
    .trim()
    .toLowerCase();
}

function componentAmount(
  snapshot: Record<string, unknown>,
  codes: string[],
): number | null {
  const values = [
    snapshot.price_components_snapshot,
    snapshot.price_components,
    snapshot.components,
  ];
  for (const candidate of values) {
    if (!Array.isArray(candidate)) continue;
    for (const raw of candidate) {
      const row = asObject(raw);
      if (codes.includes(componentCode(row))) {
        const amount = optionalNumber(row.amount ?? row.value);
        if (amount !== null) return amount;
      }
    }
  }
  return null;
}

function snapshotNumber(
  snapshot: Record<string, unknown>,
  keys: string[],
  componentCodes: string[] = [],
): number | null {
  for (const key of keys) {
    const amount = optionalNumber(snapshot[key]);
    if (amount !== null) return amount;
  }
  return componentCodes.length > 0
    ? componentAmount(snapshot, componentCodes)
    : null;
}

function pricingFacts(snapshot: Record<string, unknown>) {
  return {
    monthlyFeeSek: snapshotNumber(
      snapshot,
      ["monthly_fee_sek", "monthlyFeeSek"],
      ["monthly_fee"],
    ),
    invoiceFeeSek: snapshotNumber(
      snapshot,
      ["invoice_fee_sek", "invoiceFeeSek"],
      ["invoice_fee", "invoice_administration_fee"],
    ),
    spotMarkupOrePerKwh: snapshotNumber(
      snapshot,
      ["spot_markup_ore_per_kwh", "spotMarkupOrePerKwh"],
      ["spot_markup"],
    ),
    fixedPriceOrePerKwh: snapshotNumber(
      snapshot,
      ["fixed_price_ore_per_kwh", "fixedPriceOrePerKwh"],
      ["fixed_price"],
    ),
    variableFeeOrePerKwh: snapshotNumber(
      snapshot,
      ["variable_fee_ore_per_kwh", "variableFeeOrePerKwh"],
      ["variable_fee"],
    ),
    bindingMonths: snapshotNumber(snapshot, ["binding_months", "bindingMonths"]),
    noticeMonths: snapshotNumber(snapshot, ["notice_months", "noticeMonths"]),
  };
}

function formatPrice(value: number | null, suffix: string): string | null {
  if (value === null) return null;
  return `${new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 4 }).format(value)} ${suffix}`;
}

export function frozenPriceSummary(snapshot: Record<string, unknown>): string {
  const price = pricingFacts(snapshot);
  return [
    formatPrice(price.monthlyFeeSek, "kr/mån"),
    formatPrice(price.invoiceFeeSek, "kr/faktura"),
    formatPrice(price.spotMarkupOrePerKwh, "öre/kWh spotpåslag"),
    formatPrice(price.variableFeeOrePerKwh, "öre/kWh rörlig avgift"),
    formatPrice(price.fixedPriceOrePerKwh, "öre/kWh fast pris"),
  ]
    .filter((value): value is string => Boolean(value))
    .join(", ") || "Pris enligt den frysta prisversionen i avtalet.";
}

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

function evidenceIpHash(ipAddress: string | null | undefined): string | null {
  const ip = ipAddress?.trim();
  if (!ip) return null;
  const secret =
    process.env.SIGNATURE_EVIDENCE_SECRET?.trim() ||
    getSupabaseServiceEnv().serviceRoleKey;
  return createHmac("sha256", secret).update(ip, "utf8").digest("hex");
}

function signingUrl(token: string): string {
  return `${getBaseAppUrl()}/sign/contract/${token}`;
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
  return parseReceipt(data);
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
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashOnlineSignatureToken(token);
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
  const url = signingUrl(token);
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

  const markSent = await supabaseService.rpc(
    "gridex_mark_customer_contract_signature_request_sent_v1",
    { p_request_id: request.request_id, p_company_id: input.companyId },
  );
  if (markSent.error) throw markSent.error;

  return { request, signingUrl: url, emailResult };
}

async function signedContractState(receipt: OnlineSignatureReceipt) {
  const { data, error } = await supabaseService
    .from("customer_contracts")
    .select("withdrawal_deadline_at,document_sha256,tenant_communication_snapshot_sha256")
    .eq("id", receipt.contract_id)
    .eq("company_id", receipt.company_id)
    .single();
  if (error) throw error;
  return data as {
    withdrawal_deadline_at: string | null;
    document_sha256: string | null;
    tenant_communication_snapshot_sha256: string | null;
  };
}

async function deliverSignedContractReceipt(receipt: OnlineSignatureReceipt) {
  if (!receipt.signed_at || !receipt.signature_snapshot_sha256) {
    throw new Error("signed_contract_receipt_evidence_missing");
  }
  const [company, contractState] = await Promise.all([
    companyEmailContext(receipt.company_id, receipt.contract_id),
    signedContractState(receipt),
  ]);
  const price = pricingFacts(receipt.pricing_snapshot);
  const legalVersions = legalVersionsForPdf(receipt);
  const customerEmail = requiredString(
    receipt.customer_email,
    "signed_contract_customer_email_missing",
  );
  const customerNumber =
    receipt.customer_number ?? receipt.customer_id;
  const contractNumber = receipt.contract_number ?? receipt.contract_id;
  const attachment = buildAgreementPdfAttachment({
    companyName: company.legalName,
    brandName: company.name,
    organizationNumber: company.organizationNumber,
    companyAddress: company.postalAddress,
    companySupportEmail: company.supportEmail,
    companyPhone: company.phone,
    companyWebsite: company.website,
    legalFooter: company.legalFooter,
    customerName: receipt.customer_name,
    customerEmail,
    customerNumber,
    contractNumber,
    contractName: receipt.contract_name,
    contractType: receipt.contract_type,
    signedAt: receipt.signed_at,
    startsAt: receipt.starts_at,
    withdrawalDeadline:
      receipt.withdrawal_deadline_at ?? contractState.withdrawal_deadline_at,
    offerReference: receipt.offer_reference,
    contractPublicationVersionId: receipt.contract_publication_version_id,
    pricePlanVersionId: receipt.price_plan_version_id,
    legalBundleVersionId: receipt.legal_bundle_version_id,
    tenantSnapshotSha256:
      contractState.tenant_communication_snapshot_sha256 ?? company.snapshotSha256,
    evidenceId: `signature-request:${receipt.request_id}`,
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
  const pdfBuffer = Buffer.from(attachment.content, "base64");
  const documentSha256 = createHash("sha256").update(pdfBuffer).digest("hex");
  await archiveSignedCustomerContractPdf({
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
      .is("document_sha256", null);
    if (bindDocument.error) throw bindDocument.error;
  }

  const variables = {
    customer_name: receipt.customer_name,
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
    cancellation_deadline:
      (receipt.withdrawal_deadline_at ?? contractState.withdrawal_deadline_at)?.slice(0, 10) ?? "",
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
    attachments: [attachment],
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

  const withdrawalDeadline =
    receipt.withdrawal_deadline_at ?? contractState.withdrawal_deadline_at;
  if (withdrawalDeadline) {
    const coolingOff = await sendCompanyEmail({
      companyId: receipt.company_id,
      customerId: receipt.customer_id,
      eventKey: "contract.cooling_off_sent",
      templateKey: "contract.cooling_off_sent",
      to: customerEmail,
      legalOrCritical: true,
      idempotencyKey: `online_signature:${receipt.request_id}:cooling_off`,
      variables: { ...variables, cancellation_deadline: withdrawalDeadline.slice(0, 10) },
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
}) {
  const { data, error } = await supabaseService.rpc(
    "gridex_finalize_customer_contract_signature_v1",
    {
      p_token_hash: hashOnlineSignatureToken(input.token),
      p_signed_ip_hash: evidenceIpHash(input.ipAddress),
      p_signed_user_agent: input.userAgent?.slice(0, 1000) ?? null,
    },
  );
  if (error) throw error;
  const receipt = parseReceipt(data);

  let deliveryError: string | null = null;
  try {
    await deliverSignedContractReceipt(receipt);
  } catch (error) {
    deliveryError = error instanceof Error ? error.message : String(error);
    console.error("[online signature] post-sign receipt delivery failed", {
      contractId: receipt.contract_id,
      requestId: receipt.request_id,
      error: deliveryError,
    });
  }

  return { receipt, deliveryError };
}
