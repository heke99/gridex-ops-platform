// Internal module extracted from customerApplications.ts to keep handwritten production files bounded.
//lib/website/customerApplications.ts
import { createHash } from "node:crypto";
import type { IntegrationApiClient } from "@/lib/integrations/apiAuth";
import { supabaseService } from "@/lib/supabase/service";
import { triggerEmailEvent } from "@/lib/email/emailEvents";
import { legalAcceptanceTypeForModule, type PublicContractOffer } from "@/lib/website/publicContracts";
import { buildAgreementPdfAttachment } from "@/lib/customer-contracts/agreementPdf";
import { archiveSignedCustomerContractPdf } from "@/lib/customer-contracts/documents";
import { fixedPriceOreForArea } from "@/lib/pricing/fixedAreaPricing";
import { buildCustomerLegalAcceptanceEvidence, contractLegalMailEvidenceReady, emailDispatchStatus, emailTriggerSucceeded } from "./customerApplicationLegal";
import type { WebsiteLegalAcceptanceVersion } from "./customerApplicationLegal";
import type { ApplicationInput } from "./customerApplicationSchemas";
import { WEBSITE_APPLICATION_CONTRACT_CHANNEL, WEBSITE_APPLICATION_SIGNED_CONTRACT_STATUS, WEBSITE_PORTAL_PROVIDER, WebsiteApplicationError, clean, cleanUuid, digits, errorMessage, isObject, missingSchema, normalizedEmail, schemaErrorDetail, stage } from "./customerApplicationShared";
import type { CustomerRow, RequestAuditMetadata } from "./customerApplicationShared";

export function fullName(customer: ApplicationInput["customer"]): string | null {
  const combined = [clean(customer.first_name), clean(customer.last_name)]
    .filter(Boolean)
    .join(" ");
  return (
    clean(customer.full_name) ??
    (combined || null) ??
    clean(customer.company_name)
  );
}

export function eventVariables(input: {
  companyName: string;
  customer: CustomerRow;
  rawCustomer?: ApplicationInput["customer"] | null;
  customerNumber: string;
  siteId?: string | null;
  facilityId?: string | null;
  meteringPointId?: string | null;
  contractName?: string | null;
  contractNumber?: string | null;
  contractType?: string | null;
  signedAt?: string | null;
  withdrawalDeadline?: string | null;
  offerReference?: string | null;
  priceSummary?: string | null;
  legalVersionsSummary?: string | null;
  startDate?: string | null;
  supportEmail?: string | null;
  portalUrl?: string | null;
}) {
  const rawFirstName = clean(input.rawCustomer?.first_name);
  const rawLastName = clean(input.rawCustomer?.last_name);
  const rawFullName = input.rawCustomer ? fullName(input.rawCustomer) : null;
  const customerName =
    input.customer.full_name ??
    input.customer.company_name ??
    rawFullName ??
    input.customer.email ??
    input.customerNumber;

  return {
    customer_name: customerName,
    first_name: rawFirstName ?? customerName,
    last_name: rawLastName ?? "",
    customer_email:
      input.customer.email ?? clean(input.rawCustomer?.email) ?? "",
    customer_phone: clean(input.rawCustomer?.phone) ?? "",
    customer_number: input.customerNumber,
    company_name: input.companyName,
    contract_name: input.contractName ?? "Elavtal",
    contract_number: input.contractNumber ?? "",
    contract_type: input.contractType ?? "",
    signed_at: input.signedAt ?? "",
    offer_reference: input.offerReference ?? "",
    price_summary: input.priceSummary ?? "",
    legal_versions_summary: input.legalVersionsSummary ?? "",
    agreement_pdf_note:
      "En PDF med den frysta avtals- och bevisinformationen bifogas detta mejl.",
    start_date: input.startDate ?? "",
    facility_id: input.facilityId ?? "",
    metering_point_id: input.meteringPointId ?? "",
    support_email: input.supportEmail ?? "",
    cancellation_deadline: input.withdrawalDeadline?.slice(0, 10) ?? "",
    portal_url: input.portalUrl ?? "",
  };
}

function strictPortalUrl(value: unknown): string | null {
  const text = clean(value);
  if (!text) return null;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export async function companyEmailContext(
  companyId: string,
  customerContractId?: string | null,
): Promise<{
  name: string;
  legalName: string;
  organizationNumber: string | null;
  postalAddress: string | null;
  phone: string | null;
  website: string | null;
  logoUrl: string | null;
  senderName: string;
  senderEmail: string | null;
  replyTo: string | null;
  supportEmail: string | null;
  adminEmail: string | null;
  portalUrl: string | null;
  legalFooter: string | null;
  snapshot: Record<string, unknown>;
  snapshotSha256: string;
}> {
  const primaryCompanyResult = await supabaseService
    .from("companies")
    .select("name,support_email,primary_contact_email,phone,website,branding,customer_portal_url")
    .eq("id", companyId)
    .maybeSingle();
  const companyResult =
    primaryCompanyResult.error && missingSchema(primaryCompanyResult.error)
      ? await supabaseService
          .from("companies")
          .select("name,support_email,primary_contact_email,phone,website,branding")
          .eq("id", companyId)
          .maybeSingle()
      : primaryCompanyResult;
  if (companyResult.error) throw companyResult.error;
  const data = companyResult.data as (Record<string, unknown> & { branding?: unknown }) | null;

  const [settingsResult, profileResult, contractSnapshotResult] =
    await Promise.all([
      supabaseService
        .from("company_email_settings")
        .select("sender_name,sender_email,support_email,reply_to_email")
        .eq("company_id", companyId)
        .maybeSingle(),
      supabaseService
        .from("tenant_legal_profiles")
        .select(
          "legal_name,organization_number,postal_address,customer_service_email,phone,website",
        )
        .eq("company_id", companyId)
        .maybeSingle(),
      customerContractId
        ? supabaseService
            .from("customer_contracts")
            .select(
              "tenant_communication_snapshot,tenant_communication_snapshot_sha256,tenant_legal_party_snapshot",
            )
            .eq("id", customerContractId)
            .eq("company_id", companyId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

  if (settingsResult.error && !missingSchema(settingsResult.error))
    throw settingsResult.error;
  if (profileResult.error && !missingSchema(profileResult.error))
    throw profileResult.error;
  if (
    contractSnapshotResult.error &&
    !missingSchema(contractSnapshotResult.error)
  )
    throw contractSnapshotResult.error;

  const settings: Record<string, unknown> = isObject(settingsResult.data)
    ? settingsResult.data
    : {};
  const profile: Record<string, unknown> = isObject(profileResult.data)
    ? profileResult.data
    : {};
  const contractSnapshot: Record<string, unknown> = isObject(
    contractSnapshotResult.data,
  )
    ? contractSnapshotResult.data
    : {};
  const lockedCommunication: Record<string, unknown> = isObject(
    contractSnapshot.tenant_communication_snapshot,
  )
    ? contractSnapshot.tenant_communication_snapshot
    : {};
  const lockedLegalParty: Record<string, unknown> = isObject(
    contractSnapshot.tenant_legal_party_snapshot,
  )
    ? contractSnapshot.tenant_legal_party_snapshot
    : {};
  const branding: Record<string, unknown> = isObject(data?.branding)
    ? data.branding
    : {};
  const profileAddress: Record<string, unknown> = isObject(
    profile.postal_address,
  )
    ? profile.postal_address
    : {};
  const lockedAddress: Record<string, unknown> = isObject(
    lockedLegalParty.postal_address,
  )
    ? lockedLegalParty.postal_address
    : {};

  const legalName =
    clean(lockedLegalParty.legal_name) ??
    clean(lockedCommunication.legal_name) ??
    clean(profile.legal_name) ??
    clean(data?.name) ??
    "din elhandlare";
  const brandName =
    clean(lockedCommunication.brand_name) ??
    clean(branding.brand_name) ??
    clean(branding.display_name) ??
    clean(data?.name) ??
    legalName;
  const supportEmail =
    clean(lockedCommunication.support_email) ??
    clean(settings.support_email) ??
    clean(settings.reply_to_email) ??
    clean(profile.customer_service_email) ??
    clean(branding.support_email) ??
    clean(data?.support_email) ??
    clean(data?.primary_contact_email);
  const postalAddress =
    clean(lockedAddress.formatted) ??
    clean(lockedAddress.text) ??
    clean(lockedAddress.address) ??
    clean(profileAddress.formatted) ??
    clean(profileAddress.text) ??
    clean(profileAddress.address);
  const senderName =
    clean(lockedCommunication.sender_name) ??
    clean(settings.sender_name) ??
    brandName;
  const senderEmail =
    clean(lockedCommunication.sender_email) ?? clean(settings.sender_email);
  const replyTo =
    clean(lockedCommunication.reply_to) ??
    clean(settings.reply_to_email) ??
    supportEmail;
  const snapshot = {
    schema: "gridex_tenant_communication_v1",
    company_id: companyId,
    legal_name: legalName,
    brand_name: brandName,
    organization_number:
      clean(lockedLegalParty.organization_number) ??
      clean(profile.organization_number),
    postal_address: postalAddress,
    phone:
      clean(lockedLegalParty.phone) ??
      clean(lockedCommunication.phone) ??
      clean(profile.phone) ??
      clean(data?.phone),
    website:
      clean(lockedLegalParty.website) ??
      clean(lockedCommunication.website) ??
      clean(profile.website) ??
      clean(data?.website),
    sender_name: senderName,
    sender_email: senderEmail,
    reply_to: replyTo,
    support_email: supportEmail,
    logo_url: clean(lockedCommunication.logo_url) ?? clean(branding.logo_url),
    legal_footer:
      clean(lockedCommunication.legal_footer) ?? clean(branding.legal_footer),
    customer_contract_id: customerContractId ?? null,
  };
  const storedHash = clean(
    contractSnapshot.tenant_communication_snapshot_sha256,
  );

  return {
    name: brandName,
    legalName,
    organizationNumber: clean(snapshot.organization_number),
    postalAddress,
    phone: clean(snapshot.phone),
    website: clean(snapshot.website),
    logoUrl: clean(snapshot.logo_url),
    senderName,
    senderEmail,
    replyTo,
    supportEmail,
    adminEmail:
      clean(data?.primary_contact_email) ??
      clean(data?.support_email) ??
      supportEmail,
    portalUrl:
      strictPortalUrl(data?.customer_portal_url) ??
      strictPortalUrl(branding.customer_portal_url),
    legalFooter: clean(snapshot.legal_footer),
    snapshot,
    snapshotSha256:
      storedHash ??
      createHash("sha256")
        .update(JSON.stringify(snapshot), "utf8")
        .digest("hex"),
  };
}

type WebsiteEmailDispatchResult = {
  eventKey: string;
  ok: boolean;
  dispatch_status: "sent" | "queued" | "skipped" | "failed";
  result: unknown;
};

export function communicationStatusSnapshot(input: {
  events: string[];
  results: WebsiteEmailDispatchResult[];
}) {
  const items = input.results.map((item) => ({
    event_type: item.eventKey,
    status: item.dispatch_status,
  }));
  return {
    pending: items.some((item) => item.status === "queued"),
    source_of_truth: "communication_logs",
    triggered: items,
    queued: items.filter((item) => item.status === "queued"),
    sent: items.filter((item) => item.status === "sent"),
    failed: items.filter((item) => item.status === "failed"),
  };
}

export async function dispatchInitialWebsiteApplicationEmails(input: {
  companyId: string;
  applicationId: string;
  customer: CustomerRow;
  rawCustomer: ApplicationInput["customer"];
  customerNumber: string;
  externalCustomerId: string;
  siteId?: string | null;
  facilityId?: string | null;
  meteringPointId?: string | null;
  contract: WebsiteContractCreateResult | null;
  publicOffer: PublicContractOffer | null;
  offerReference: string | null;
  legalVersions: WebsiteLegalAcceptanceVersion[];
  legalAcceptanceIds: Record<string, string>;
  startDate?: string | null;
}): Promise<{ events: string[]; results: WebsiteEmailDispatchResult[] }> {
  const email =
    normalizedEmail(input.rawCustomer.email) ??
    normalizedEmail(input.customer.email);
  if (!email) return { events: [], results: [] };

  const company = await companyEmailContext(
    input.companyId,
    input.contract?.id,
  );
  const priceParts = [
    input.publicOffer?.monthly_fee_sek !== null &&
    input.publicOffer?.monthly_fee_sek !== undefined
      ? `${input.publicOffer.monthly_fee_sek} kr/mån`
      : null,
    input.publicOffer?.invoice_fee_sek !== null &&
    input.publicOffer?.invoice_fee_sek !== undefined
      ? `${input.publicOffer.invoice_fee_sek} kr/faktura`
      : null,
    input.publicOffer?.spot_markup_ore_per_kwh !== null &&
    input.publicOffer?.spot_markup_ore_per_kwh !== undefined
      ? `${input.publicOffer.spot_markup_ore_per_kwh} öre/kWh spotpåslag`
      : null,
    input.publicOffer?.variable_fee_ore_per_kwh !== null &&
    input.publicOffer?.variable_fee_ore_per_kwh !== undefined
      ? `${input.publicOffer.variable_fee_ore_per_kwh} öre/kWh rörlig avgift`
      : null,
    input.publicOffer?.fixed_price_ore_per_kwh !== null &&
    input.publicOffer?.fixed_price_ore_per_kwh !== undefined
      ? `${input.publicOffer.fixed_price_ore_per_kwh} öre/kWh fast pris`
      : null,
  ].filter((value): value is string => Boolean(value));
  const legalVersionsSummary = input.legalVersions
    .map((version) => `${version.title} v${version.version}`)
    .join(", ");
  const variables = eventVariables({
    companyName: company.name,
    customer: input.customer,
    rawCustomer: input.rawCustomer,
    customerNumber: input.customerNumber,
    siteId: input.siteId,
    facilityId: input.facilityId,
    meteringPointId: input.meteringPointId,
    contractName: input.contract?.contract_name,
    contractNumber: input.contract?.contract_number,
    contractType: input.publicOffer?.contract_type,
    signedAt: input.contract?.signed_at,
    withdrawalDeadline: input.contract?.withdrawal_deadline_at,
    offerReference: input.offerReference,
    priceSummary: priceParts.join(", "),
    legalVersionsSummary,
    startDate: input.startDate ?? input.contract?.starts_at,
    supportEmail: company.supportEmail,
    portalUrl: company.portalUrl,
  });

  const agreementAttachment =
    input.contract?.contract_number &&
    input.contract.signed_at &&
    input.publicOffer &&
    input.offerReference
      ? buildAgreementPdfAttachment({
          companyName: company.legalName,
          brandName: company.name,
          organizationNumber: company.organizationNumber,
          companyAddress: company.postalAddress,
          companySupportEmail: company.supportEmail,
          companyPhone: company.phone,
          companyWebsite: company.website,
          legalFooter: company.legalFooter,
          customerName:
            fullName(input.rawCustomer) ??
            input.customer.full_name ??
            input.customer.company_name ??
            email,
          customerEmail: email,
          customerNumber: input.customerNumber,
          contractNumber: input.contract.contract_number,
          contractName:
            input.contract.contract_name ?? input.publicOffer.public_name,
          contractDescription: input.publicOffer.public_description,
          contractType: input.publicOffer.contract_type,
          signedAt: input.contract.signed_at,
          startsAt: input.contract.starts_at,
          withdrawalDeadline: input.contract.withdrawal_deadline_at ?? null,
          offerReference: input.offerReference,
          contractPublicationVersionId:
            input.publicOffer.contract_publication_version_id ?? null,
          pricePlanVersionId: input.publicOffer.price_plan_version_id,
          legalBundleVersionId:
            input.publicOffer.legal_bundle_version_id ?? null,
          tenantSnapshotSha256: company.snapshotSha256,
          evidenceId: `contract:${input.contract.id}`,
          monthlyFeeSek: input.publicOffer.monthly_fee_sek,
          invoiceFeeSek: input.publicOffer.invoice_fee_sek,
          spotMarkupOrePerKwh: input.publicOffer.spot_markup_ore_per_kwh,
          fixedPriceOrePerKwh: input.publicOffer.fixed_price_ore_per_kwh,
          variableFeeOrePerKwh: input.publicOffer.variable_fee_ore_per_kwh,
          bindingMonths: input.publicOffer.binding_months ?? null,
          noticeMonths: input.publicOffer.notice_months ?? null,
          legalVersions: input.legalVersions.map((version) => ({
            id: version.id,
            type: version.type,
            title: version.title,
            version: version.version,
            body: version.body,
          })),
          signatureSnapshotSha256:
            input.contract.signature_snapshot_sha256 ?? null,
        })
      : null;

  if (agreementAttachment && input.contract?.id) {
    const pdfBuffer = Buffer.from(agreementAttachment.content, "base64");
    const documentSha256 = createHash("sha256").update(pdfBuffer).digest("hex");
    const generationSnapshot = {
      offer_reference: input.offerReference,
      contract_number: input.contract.contract_number,
      signed_at: input.contract.signed_at,
      signature_snapshot_sha256:
        input.contract.signature_snapshot_sha256 ?? null,
      legal_version_ids: input.legalVersions.map((version) => version.id),
      contract_publication_version_id:
        input.publicOffer?.contract_publication_version_id ?? null,
      price_plan_version_id: input.publicOffer?.price_plan_version_id ?? null,
      legal_bundle_version_id:
        input.publicOffer?.legal_bundle_version_id ?? null,
      tenant_communication_snapshot: company.snapshot,
      tenant_communication_snapshot_sha256: company.snapshotSha256,
    };
    await archiveSignedCustomerContractPdf({
      companyId: input.companyId,
      customerContractId: input.contract.id,
      pdfBuffer,
      mimeType: agreementAttachment.contentType ?? undefined,
      documentSha256,
      generationSnapshot,
    });
    const { error: contractDocumentError } = await supabaseService
      .from("customer_contracts")
      .update({
        document_sha256: documentSha256,
        locked_at: input.contract.signed_at ?? new Date().toISOString(),
      })
      .eq("id", input.contract.id)
      .eq("company_id", input.companyId);
    if (contractDocumentError) throw contractDocumentError;
  }

  const legalMailReady = Boolean(
    input.contract?.status === WEBSITE_APPLICATION_SIGNED_CONTRACT_STATUS &&
    input.contract.signed_at &&
    agreementAttachment &&
    contractLegalMailEvidenceReady({
      acceptanceIds: input.legalAcceptanceIds,
      legalVersions: input.legalVersions,
    }),
  );
  const events = [
    "contract.application_received",
    ...(legalMailReady
      ? ["contract.confirmation_sent", "contract.cooling_off_sent"]
      : []),
  ];

  // Preserve the legal communication order. The next message is not queued
  // until the previous event has produced its canonical communication row.
  const results: WebsiteEmailDispatchResult[] = [];
  for (const eventKey of events) {
      const result = await triggerEmailEvent({
        companyId: input.companyId,
        customerId: input.customer.id,
        siteId: input.siteId ?? null,
        meteringPointId: input.meteringPointId ?? null,
        eventKey,
        to: email,
        adminTo: company.adminEmail,
        variables,
        attachments:
          eventKey === "contract.confirmation_sent" && agreementAttachment
            ? [agreementAttachment]
            : [],
        idempotencyKey: `website_application:${input.applicationId}:${eventKey}`,
        metadata: {
          application_id: input.applicationId,
          contract_id: input.contract?.id ?? null,
          contract_number: input.contract?.contract_number ?? null,
          signed_at: input.contract?.signed_at ?? null,
          offer_reference: input.offerReference,
          public_contract_offer_id: input.publicOffer?.id ?? null,
          signature_snapshot_sha256:
            input.contract?.signature_snapshot_sha256 ?? null,
          tenant_communication_snapshot_sha256: company.snapshotSha256,
          contract_publication_version_id:
            input.publicOffer?.contract_publication_version_id ?? null,
          price_plan_version_id:
            input.publicOffer?.price_plan_version_id ?? null,
          legal_bundle_version_id:
            input.publicOffer?.legal_bundle_version_id ?? null,
          external_customer_id: input.externalCustomerId,
          customer_number: input.customerNumber,
          source: "website_customer_applications",
        },
      }).catch((error) => [
        { ok: false, eventKey, error: errorMessage(error) },
      ]);

      results.push({
        eventKey,
        ok: emailTriggerSucceeded(result),
        dispatch_status: emailDispatchStatus(result),
        result,
      });
  }

  return { events, results };
}

export async function loadExistingIdentity(
  companyId: string,
  externalCustomerId: string,
  customerInput: ApplicationInput["customer"],
) {
  const { data, error } = await supabaseService
    .from("customer_portal_identities")
    .select("id,customer_id,external_customer_id,status")
    .eq("company_id", companyId)
    .eq("provider", WEBSITE_PORTAL_PROVIDER)
    .eq("external_customer_id", externalCustomerId)
    .in("status", ["active", "pending_review"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  const identity = data as {
    id: string;
    customer_id: string | null;
    status: string;
  } | null;
  if (!identity?.customer_id) return identity;

  const customerResult = await supabaseService
    .from("customers")
    .select("id,customer_type,personal_number,org_number,email")
    .eq("company_id", companyId)
    .eq("id", identity.customer_id)
    .maybeSingle();
  if (customerResult.error) throw customerResult.error;
  const customer = customerResult.data as
    | {
        id: string;
        customer_type?: string | null;
        personal_number?: string | null;
        org_number?: string | null;
        email?: string | null;
      }
    | null;
  if (!customer) {
    throw new WebsiteApplicationError({
      message: "Portalidentiteten pekar på en kund som inte finns i aktuell tenant.",
      status: 409,
      code: "portal_identity_customer_invalid",
      stage: "customer_lookup",
    });
  }

  const requestedLegalId =
    customerInput.customer_type === "business"
      ? digits(customerInput.org_number)
      : digits(customerInput.personal_number);
  const storedLegalId =
    customerInput.customer_type === "business"
      ? digits(customer.org_number)
      : digits(customer.personal_number);
  const requestedEmail = normalizedEmail(customerInput.email);
  const storedEmail = normalizedEmail(customer.email);
  const conflicts = [
    ...(customer.customer_type &&
    customer.customer_type !== customerInput.customer_type
      ? ["customer_type"]
      : []),
    ...(!requestedLegalId || !storedLegalId || requestedLegalId !== storedLegalId
      ? [
          customerInput.customer_type === "business"
            ? "org_number"
            : "personal_number",
        ]
      : []),
    ...(requestedEmail && storedEmail && requestedEmail !== storedEmail
      ? ["email"]
      : []),
  ];
  if (identity.status !== "active" || conflicts.length > 0) {
    throw new WebsiteApplicationError({
      message:
        "Portalidentiteten motsvarar inte ansökans verifierbara kundidentitet.",
      status: 409,
      code: "portal_identity_mismatch",
      stage: "customer_lookup",
      details: {
        conflicting_identifiers: conflicts,
        requires_manual_review: true,
      },
    });
  }
  return identity;
}

export async function upsertPortalIdentity(input: {
  client: IntegrationApiClient;
  customerId: string;
  externalCustomerId: string;
  externalAccountId?: string | null;
  authUserId?: string | null;
  customerPortalUserId?: string | null;
  customerNumber?: string | null;
  email?: string | null;
  applicationId?: string | null;
}) {
  const now = new Date().toISOString();
  const payload = {
    company_id: input.client.company_id,
    customer_id: input.customerId,
    api_client_id: input.client.id,
    provider: WEBSITE_PORTAL_PROVIDER,
    external_customer_id: input.externalCustomerId,
    external_account_id:
      input.externalAccountId ??
      input.customerPortalUserId ??
      input.authUserId ??
      null,
    customer_number: input.customerNumber ?? null,
    auth_user_id: input.authUserId ?? input.customerPortalUserId ?? null,
    customer_portal_user_id:
      input.customerPortalUserId ?? input.authUserId ?? null,
    last_resolved_at: now,
    email: input.email ?? null,
    status: "active",
    match_strength:
      input.applicationId && (input.authUserId || input.customerPortalUserId)
        ? "strong"
        : "medium",
    match_method:
      input.applicationId && (input.authUserId || input.customerPortalUserId)
        ? "verified_portal_and_legal_identity"
        : "website_application_legal_identity",
    linked_at: now,
    metadata: {
      source: "website_customer_applications",
      api_client_id: input.client.id,
      application_id: input.applicationId ?? null,
      customer_portal_user_id:
        input.customerPortalUserId ?? input.authUserId ?? null,
    },
    updated_at: now,
  };

  const { data, error } = await supabaseService
    .from("customer_portal_identities")
    .upsert(payload, { onConflict: "company_id,provider,external_customer_id" })
    .select("id")
    .single();

  if (error) throw error;
  return data as { id: string };
}

export type WebsiteContractCreateResult = {
  id: string;
  contract_name: string | null;
  starts_at: string | null;
  status: string;
  signed_at?: string | null;
  withdrawal_deadline_at?: string | null;
  public_contract_offer_id?: string | null;
  offer_reference?: string | null;
  energy_direction?: "consumption" | "production";
  signature_snapshot_sha256?: string | null;
  contract_number: string | null;
  price_plan_id: string | null;
  price_plan_version_id: string | null;
  contract_price_snapshot_id?: string | null;
};

export function selectedOfferFields(
  offer: PublicContractOffer,
  contract: ApplicationInput["contract"],
  priceArea?: string | null,
) {
  const selectedAreaFixedPrice = fixedPriceOreForArea(
    offer.pricing_snapshot,
    priceArea,
    offer.fixed_price_ore_per_kwh,
    offer.price_areas ?? [],
  );
  return {
    // Client-supplied fallbacks are UUID-gated: these values are written to
    // uuid columns (customer_contracts / contract_price_snapshots /
    // website_customer_applications). Version *names* like "2026-06-12-v1"
    // previously caused `invalid input syntax for type uuid` 500s mid-flow.
    pricePlanId: offer.price_plan_id ?? cleanUuid(contract?.price_plan_id),
    pricePlanVersionId:
      offer.price_plan_version_id ??
      cleanUuid(contract?.price_plan_version_id),
    publicContractOfferId: offer.id,
    internalContractOfferId: null,
    campaignVersionId: offer.campaign_version_id ?? null,
    contractName:
      offer.public_name ?? clean(contract?.contract_name) ?? "Elavtal",
    contractType:
      offer.contract_type ??
      clean(contract?.contract_type) ??
      "variable_monthly",
    energyDirection: offer.energy_direction ?? null,
    monthlyFeeSek: offer.monthly_fee_sek ?? contract?.monthly_fee_sek ?? null,
    invoiceFeeSek: offer.invoice_fee_sek ?? contract?.invoice_fee_sek ?? null,
    markupOrePerKwh:
      offer.markup_ore_per_kwh ?? contract?.markup_ore_per_kwh ?? null,
    spotMarkupOrePerKwh:
      offer.spot_markup_ore_per_kwh ??
      contract?.spot_markup_ore_per_kwh ??
      contract?.markup_ore_per_kwh ??
      null,
    variableFeeOrePerKwh:
      offer.variable_fee_ore_per_kwh ??
      contract?.variable_fee_ore_per_kwh ??
      null,
    fixedPriceOrePerKwh:
      selectedAreaFixedPrice ??
      offer.fixed_price_ore_per_kwh ??
      contract?.fixed_price_ore_per_kwh ??
      null,
    greenFeeMode:
      offer.green_fee_mode ?? clean(contract?.green_fee_mode) ?? "none",
    greenFeeValue: offer.green_fee_value ?? contract?.green_fee_value ?? null,
    termsVersion:
      offer.terms_version ?? clean(contract?.terms_version) ?? null,
    productCode: offer.product_code ?? clean(contract?.product_code) ?? null,
    billingModel: offer.billing_model ?? null,
  };
}

export function websiteLegalVersionsSnapshot(
  versions: WebsiteLegalAcceptanceVersion[],
) {
  return versions.map((version) => ({
    id: version.id,
    type: version.type,
    legal_bundle_version_document_id: version.id,
    module_key: version.module_key ?? version.type,
    version: version.version,
    title: version.title,
    published_at: version.published_at,
    document_sha256:
      version.content_sha256 ??
      createHash("sha256").update(version.body ?? "", "utf8").digest("hex"),
    legal_bundle_version_id: version.legal_bundle_version_id ?? null,
  }));
}

function websiteSignatureSnapshot(input: {
  companyId: string;
  customerId: string;
  contractId: string;
  applicationId: string;
  publicOffer: PublicContractOffer;
  offerReference: string;
  acceptedAt: string;
  legalVersions: WebsiteLegalAcceptanceVersion[];
  contractPriceSnapshotId?: string | null;
  requestAudit?: RequestAuditMetadata;
}) {
  return {
    schema: "gridex_website_contract_signature_v2",
    company_id: input.companyId,
    customer_id: input.customerId,
    contract_id: input.contractId,
    application_id: input.applicationId,
    public_contract_offer_id: input.publicOffer.id,
    offer_reference: input.offerReference,
    contract_publication_version_id:
      input.publicOffer.contract_publication_version_id ?? null,
    contract_product_id: input.publicOffer.contract_product_id ?? null,
    contract_product_version_id:
      input.publicOffer.contract_product_version_id ?? null,
    energy_direction: input.publicOffer.energy_direction,
    legal_bundle_version_id: input.publicOffer.legal_bundle_version_id ?? null,
    price_plan_id: input.publicOffer.price_plan_id,
    price_plan_version_id: input.publicOffer.price_plan_version_id,
    price_book_id: input.publicOffer.price_book_id ?? null,
    contract_price_snapshot_id: input.contractPriceSnapshotId ?? null,
    accepted_at: input.acceptedAt,
    agreement_channel: WEBSITE_APPLICATION_CONTRACT_CHANNEL,
    legal_versions: websiteLegalVersionsSnapshot(input.legalVersions),
    request_evidence: {
      request_id: input.requestAudit?.requestId ?? null,
      trace_id: input.requestAudit?.traceId ?? null,
      ip_hash: input.requestAudit?.ipHash ?? null,
      user_agent: input.requestAudit?.userAgent ?? null,
    },
  };
}

export async function finalizeWebsiteContractSignature(input: {
  companyId: string;
  customerId: string;
  contract: WebsiteContractCreateResult;
  applicationId: string;
  publicOffer: PublicContractOffer;
  offerReference: string;
  acceptedAt: string;
  legalVersions: WebsiteLegalAcceptanceVersion[];
  consents?: Record<string, unknown>;
  rawPayload: unknown;
  requestAudit?: RequestAuditMetadata;
}): Promise<{
  contract: WebsiteContractCreateResult;
  acceptanceIds: Record<string, string>;
}> {
  const { error: retryError } = await supabaseService.rpc(
    "gridex_retry_website_contract_signature",
    {
      p_company_id: input.companyId,
      p_contract_id: input.contract.id,
      p_application_id: input.applicationId,
    },
  );
  if (retryError) {
    throw new WebsiteApplicationError({
      message:
        "Avtalets signeringsläge kunde inte förberedas för ett verifierat signeringsförsök.",
      status: 500,
      code: "contract_signature_retry_prepare_failed",
      field: "contract",
      stage: "legal_acceptance",
      hint:
        "Kontrollera den aktiva gridex_retry_website_contract_signature-definitionen och kundavtalets status.",
      details: schemaErrorDetail(retryError),
    });
  }
  const snapshot = websiteSignatureSnapshot({
    companyId: input.companyId,
    customerId: input.customerId,
    contractId: input.contract.id,
    applicationId: input.applicationId,
    publicOffer: input.publicOffer,
    offerReference: input.offerReference,
    acceptedAt: input.acceptedAt,
    legalVersions: input.legalVersions,
    contractPriceSnapshotId: input.contract.contract_price_snapshot_id ?? null,
    requestAudit: input.requestAudit,
  });
  const snapshotHash = createHash("sha256")
    .update(JSON.stringify(snapshot), "utf8")
    .digest("hex");
  const { data, error } = await supabaseService.rpc(
    "gridex_finalize_website_contract_signature",
    {
      p_company_id: input.companyId,
      p_contract_id: input.contract.id,
      p_application_id: input.applicationId,
      p_public_contract_offer_id: input.publicOffer.id,
      p_offer_reference: input.offerReference,
      p_accepted_at: input.acceptedAt,
      p_legal_versions: websiteLegalVersionsSnapshot(input.legalVersions),
      p_signature_snapshot: snapshot,
      p_acceptance_evidence: buildCustomerLegalAcceptanceEvidence({
        companyId: input.companyId,
        customerId: input.customerId,
        contractId: input.contract.id,
        applicationId: input.applicationId,
        publicOffer: input.publicOffer,
        legalVersions: input.legalVersions,
        consents: input.consents,
        rawPayload: input.rawPayload,
        requestAudit: input.requestAudit,
        acceptedAt: input.acceptedAt,
      }),
      p_signature_snapshot_sha256: snapshotHash,
      p_signed_ip_hash: input.requestAudit?.ipHash ?? null,
      p_signed_user_agent: input.requestAudit?.userAgent ?? null,
    },
  );

  if (error) {
    throw new WebsiteApplicationError({
      message:
        "Avtalet kunde inte slutmarkeras som signerat eftersom den juridiska beviskedjan inte kunde verifieras atomiskt.",
      status: 500,
      code: "contract_signature_finalize_failed",
      field: "contract",
      stage: "legal_acceptance",
      hint: "Kör senaste migration för gridex_finalize_website_contract_signature och kontrollera att alla juridiska accepter för den exakta publiceringsversionen finns.",
      details: schemaErrorDetail(error),
    });
  }

  const result = isObject(data) ? data : {};
  const exactAcceptanceIds = isObject(result.acceptance_ids)
    ? Object.fromEntries(
        Object.entries(result.acceptance_ids)
          .filter((entry): entry is [string, string] =>
            typeof entry[1] === "string",
          ),
      )
    : {};
  const acceptanceIds = { ...exactAcceptanceIds };
  for (const legalVersion of input.legalVersions) {
    const id = exactAcceptanceIds[legalVersion.id];
    if (!id) continue;
    const legacyType = legalAcceptanceTypeForModule(
      legalVersion.module_key ?? legalVersion.type,
    );
    if (!acceptanceIds[legacyType]) acceptanceIds[legacyType] = id;
  }
  return {
    contract: {
    ...input.contract,
    status: WEBSITE_APPLICATION_SIGNED_CONTRACT_STATUS,
    signed_at: clean(result.signed_at) ?? input.acceptedAt,
    withdrawal_deadline_at: clean(result.withdrawal_deadline_at),
    public_contract_offer_id: input.publicOffer.id,
    offer_reference: input.offerReference,
    signature_snapshot_sha256:
      clean(result.signature_snapshot_sha256) ?? snapshotHash,
    },
    acceptanceIds,
  };
}