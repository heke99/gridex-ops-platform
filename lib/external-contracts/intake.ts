// Purpose separation (flow consolidation decision):
// The OPS-hosted public form (/teckna-avtal) is a MANUAL-REVIEW intake — it
// creates draft customers/contracts plus a review task, and every submission
// must pass an operator before any operational flow starts. Tenant websites
// integrate through the canonical website API
// (lib/website/customerApplications.ts), which owns published offers, legal
// acceptances, POA and price snapshots. This module must never grow into a
// second automated signup pipeline; if /teckna-avtal ever needs automated
// provisioning it has to call the canonical processor instead.
import { createHash } from "crypto";
import { supabaseService } from "@/lib/supabase/service";
import { logUsageEvent } from "@/lib/audit/actionLogger";
import { isBusinessCustomerType } from "@/lib/customers/normalizeCustomerType";
import { canonicalIdempotencyKey, onboardCustomerGraph } from "@/lib/customers/canonicalOnboarding";
import { createTenantContext } from "@/lib/tenant/context";
import {
  matchCustomerIdentity,
  type CustomerMatchDecision,
} from "@/lib/customers/matchingService";
import {
  EXTERNAL_CONTRACT_COMPANY_CLOSED_MESSAGE,
  EXTERNAL_CONTRACT_COMPANY_NOT_FOUND_MESSAGE,
  EXTERNAL_CONTRACT_OFFER_INCOMPLETE_MESSAGE,
  EXTERNAL_CONTRACT_OFFER_UNAVAILABLE_MESSAGE,
} from "@/lib/external-contracts/publicIntakeFlash";

type ExternalContractInput = {
  companySlug: string;
  offerReference: string;
  customerType: "private" | "business";
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  personalNumber: string | null;
  orgNumber: string | null;
  facilityId: string | null;
  meterPointId: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  moveInDate: string | null;
  priceAreaCode: string | null;
  requestedStartDate: string | null;
};

export type ExternalContractResult = {
  intakeId: string;
  status: string;
  customerId: string | null;
  caseId: string | null;
};

function clean(value: FormDataEntryValue | null): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function isEmail(value: string | null): boolean {
  if (!value) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isIsoDate(value: string | null): boolean {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value;
}

function validate(input: ExternalContractInput): string[] {
  const issues: string[] = [];
  if (!input.companySlug) issues.push("Bolag saknas.");
  if (!input.offerReference) issues.push("Publicerad offer_reference saknas.");
  if (!isEmail(input.email)) issues.push("E-post krävs och måste ha korrekt format.");
  if (input.customerType === "private") {
    if (!input.firstName) issues.push("Förnamn krävs.");
    if (!input.lastName) issues.push("Efternamn krävs.");
  } else if (!input.companyName || !input.orgNumber) {
    issues.push("Företagskund kräver bolagsnamn och organisationsnummer.");
  }
  if (!input.facilityId && !input.meterPointId) {
    issues.push("Anläggnings-ID eller mätpunkts-ID krävs för att starta flödet säkert.");
  }
  if (!isIsoDate(input.moveInDate)) issues.push("Inflyttsdatum måste anges som YYYY-MM-DD.");
  if (!isIsoDate(input.requestedStartDate)) issues.push("Önskat startdatum måste anges som YYYY-MM-DD.");
  return issues;
}

function hashKey(input: ExternalContractInput): string {
  const parts = [
    input.companySlug.toLowerCase(),
    input.offerReference.toLowerCase(),
    input.email?.toLowerCase(),
    input.personalNumber?.replace(/\D/g, ""),
    input.orgNumber?.replace(/\D/g, ""),
    input.facilityId?.replace(/\s+/g, "").toUpperCase(),
    input.meterPointId?.replace(/\s+/g, "").toUpperCase(),
    input.requestedStartDate,
  ]
    .map((value) => value ?? "")
    .join("|");

  return createHash("sha256").update(parts).digest("hex");
}

function shouldReplayExisting(status: string): boolean {
  // A retryable failure continues on the same intake row. Running, completed
  // and needs-review operations are replayed as their existing canonical state
  // so a duplicate request never starts a parallel customer graph.
  return status === "failed";
}

async function findExistingCustomerForIntake(input: {
  companyId: string;
  personalNumber: string | null;
  orgNumber: string | null;
  email: string | null;
  phone: string | null;
}): Promise<CustomerMatchDecision> {
  return matchCustomerIdentity({
    companyId: input.companyId,
    personalNumber: input.personalNumber,
    orgNumber: input.orgNumber,
    email: input.email,
    phone: input.phone,
  });
}

async function ensureCustomerForIntake(input: {
  companyId: string;
  personalNumber: string | null;
  orgNumber: string | null;
  email: string | null;
  phone: string | null;
}): Promise<CustomerMatchDecision> {
  // This preflight uses exactly the same tenant-scoped matcher as the website,
  // admin and EDIEL entry points. Only person/org number may link a customer;
  // email and phone remain review/audit candidates. The canonical onboarding
  // RPC still performs the atomic final identity/facility/metering-point check.
  return findExistingCustomerForIntake(input);
}

export function parseExternalContractFormData(
  formData: FormData,
): ExternalContractInput {
  const customerType = isBusinessCustomerType(
    clean(formData.get("customer_type")),
  )
    ? "business"
    : "private";
  return {
    companySlug: clean(formData.get("company_slug")) ?? "",
    offerReference: clean(formData.get("offer_reference")) ?? "",
    customerType,
    firstName: clean(formData.get("first_name")),
    lastName: clean(formData.get("last_name")),
    companyName: clean(formData.get("company_name")),
    email: clean(formData.get("email")),
    phone: clean(formData.get("phone")),
    personalNumber:
      customerType === "private"
        ? clean(formData.get("personal_number"))
        : null,
    orgNumber:
      customerType === "business" ? clean(formData.get("org_number")) : null,
    facilityId: clean(formData.get("facility_id")),
    meterPointId: clean(formData.get("meter_point_id")),
    street: clean(formData.get("street")),
    postalCode: clean(formData.get("postal_code")),
    city: clean(formData.get("city")),
    moveInDate: clean(formData.get("move_in_date")),
    priceAreaCode: clean(formData.get("price_area_code")),
    requestedStartDate: clean(formData.get("requested_start_date")),
  };
}

type CanonicalPublicOfferBinding = {
  source_contract_offer_id: string;
  contract_product_id: string;
  contract_product_version_id: string;
  contract_publication_version_id: string;
  legal_bundle_version_id: string;
  canonical_offer_reference: string;
  public_name: string;
  contract_type: string;
  energy_direction: string;
  canonical_pricing_snapshot: Record<string, unknown>;
  valid_from: string | null;
  valid_to: string | null;
};

async function resolveCanonicalPublicOffer(input: {
  companyId: string;
  offerReference: string;
}): Promise<CanonicalPublicOfferBinding> {
  const { data, error } = await supabaseService
    .from("canonical_public_contract_offers_v")
    .select(
      "source_contract_offer_id,contract_product_id,contract_product_version_id,contract_publication_version_id,legal_bundle_version_id,canonical_offer_reference,public_name,contract_type,energy_direction,canonical_pricing_snapshot,valid_from,valid_to,publication_status,is_public,website_enabled,website_cta_enabled",
    )
    .eq("company_id", input.companyId)
    .eq("canonical_offer_reference", input.offerReference)
    .maybeSingle();
  if (error) throw error;

  const row = data as Record<string, unknown> | null;
  const requiredIds = [
    "source_contract_offer_id",
    "contract_product_id",
    "contract_product_version_id",
    "contract_publication_version_id",
    "legal_bundle_version_id",
  ] as const;
  if (
    !row ||
    row.publication_status !== "published" ||
    row.is_public !== true ||
    row.website_enabled !== true ||
    row.website_cta_enabled !== true ||
    requiredIds.some(
      (field) => typeof row[field] !== "string" || !String(row[field]).trim(),
    )
  ) {
    throw new Error(EXTERNAL_CONTRACT_OFFER_INCOMPLETE_MESSAGE);
  }

  const today = new Date().toISOString().slice(0, 10);
  const validFrom =
    typeof row.valid_from === "string" ? row.valid_from : null;
  const validTo = typeof row.valid_to === "string" ? row.valid_to : null;
  if (
    (validFrom && validFrom > today) ||
    (validTo && validTo < today)
  ) {
    throw new Error(EXTERNAL_CONTRACT_OFFER_UNAVAILABLE_MESSAGE);
  }

  return row as unknown as CanonicalPublicOfferBinding;
}

export async function createExternalContractIntake(
  input: ExternalContractInput,
): Promise<ExternalContractResult> {
  const { data: company, error: companyError } = await supabaseService
    .from("companies")
    .select("id, name, status, production_status, live_approved_at")
    .eq("slug", input.companySlug)
    .maybeSingle();

  if (companyError) throw companyError;
  if (!company?.id) {
    throw new Error(EXTERNAL_CONTRACT_COMPANY_NOT_FOUND_MESSAGE);
  }
  if (
    String(company.status ?? "") !== "active" ||
    String(company.production_status ?? "") !== "live" ||
    !company.live_approved_at
  ) {
    throw new Error(EXTERNAL_CONTRACT_COMPANY_CLOSED_MESSAGE);
  }

  const companyId = String(company.id);
  const offer = await resolveCanonicalPublicOffer({
    companyId,
    offerReference: input.offerReference,
  });
  const issues = validate(input);
  const sourceKey = hashKey(input);
  const displayName = input.customerType === "business"
    ? input.companyName
    : [input.firstName, input.lastName].filter(Boolean).join(" ").trim();

  const { data: existing, error: existingError } = await supabaseService
    .from("external_contract_intakes")
    .select("id,status,created_customer_id,created_case_id")
    .eq("company_id", companyId)
    .eq("idempotency_key", sourceKey)
    .maybeSingle();
  if (existingError) throw existingError;

  if (
    existing?.id &&
    !shouldReplayExisting(String(existing.status ?? ""))
  ) {
    return {
      intakeId: String(existing.id),
      status: String(existing.status),
      customerId: existing.created_customer_id ? String(existing.created_customer_id) : null,
      caseId: existing.created_case_id ? String(existing.created_case_id) : null,
    };
  }

  let intakeId: string;
  if (existing?.id) {
    intakeId = String(existing.id);
    const { error } = await supabaseService
      .from("external_contract_intakes")
      .update({
        status: "processing",
        payload: input,
        issues,
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", companyId)
      .eq("id", intakeId);
    if (error) throw error;
  } else {
    const { data: intake, error } = await supabaseService
      .from("external_contract_intakes")
      .insert({
        company_id: companyId,
        status: "processing",
        idempotency_key: sourceKey,
        customer_type: input.customerType,
        first_name: input.firstName,
        last_name: input.lastName,
        company_name: input.companyName,
        email: input.email,
        phone: input.phone,
        personal_number: input.personalNumber,
        org_number: input.orgNumber,
        facility_id: input.facilityId,
        meter_point_id: input.meterPointId,
        street: input.street,
        postal_code: input.postalCode,
        city: input.city,
        move_in_date: input.moveInDate,
        price_area_code: input.priceAreaCode,
        contract_offer_id: offer.source_contract_offer_id,
        requested_start_date: input.requestedStartDate,
        payload: input,
        issues,
      })
      .select("id")
      .single();
    if (error) throw error;
    intakeId = String(intake.id);
  }

  try {
    const customerMatch = await ensureCustomerForIntake({
      companyId,
      personalNumber: input.personalNumber,
      orgNumber: input.orgNumber,
      email: input.email,
      phone: input.phone,
    });

    const tenantContext = createTenantContext({
      companyId,
      actorType: "system",
      actorId: "ops-public-contract-intake",
      sourceChannel: "public_website",
    });

    const result = await onboardCustomerGraph({
      company_id: companyId,
      channel: "external_contract",
      idempotency_key: canonicalIdempotencyKey({
        channel: "external_contract",
        companyId,
        sourceId: intakeId,
      }),
      matching_policy: customerMatch.customer ? "link_selected" : "link_unique",
      existing_customer_id: customerMatch.customer?.id ?? null,
      customer: {
        customer_type: input.customerType,
        status: "draft",
        first_name: input.firstName,
        last_name: input.lastName,
        full_name: displayName || input.email || "Extern ansökan",
        company_name: input.companyName,
        email: input.email,
        phone: input.phone,
        personal_number: input.personalNumber,
        org_number: input.orgNumber,
        source: "external_contract_intake",
        metadata: {
          externalContractIntakeId: intakeId,
          validationIssues: issues,
          customerMatch: customerMatch.auditMetadata,
        },
      },
      contact: input.email || input.phone
        ? {
            type: "primary",
            name: displayName || null,
            email: input.email,
            phone: input.phone,
            is_primary: true,
          }
        : null,
      address: input.street || input.postalCode || input.city
        ? {
            type: "registered",
            street_1: input.street,
            postal_code: input.postalCode,
            city: input.city,
            country: "SE",
            is_active: true,
          }
        : null,
      site: input.facilityId || input.street || input.postalCode || input.city
        ? {
            site_name: input.facilityId ?? displayName ?? "Extern avtalsingång",
            facility_id: input.facilityId,
            site_type: "consumption",
            status: "draft",
            price_area_code: input.priceAreaCode,
            move_in_date: input.moveInDate,
            street: input.street,
            postal_code: input.postalCode,
            city: input.city,
            country: "SE",
            metadata: { externalContractIntakeId: intakeId },
          }
        : null,
      metering_point: input.meterPointId
        ? {
            meter_point_id: input.meterPointId,
            metering_point_id: input.meterPointId,
            site_facility_id: input.facilityId,
            status: "draft",
            measurement_type: "consumption",
            reading_frequency: "hourly",
            price_area_code: input.priceAreaCode,
            is_settlement_relevant: true,
          }
        : null,
      // This is a review intake, not a signing operation. A customer contract
      // is created only by the canonical quote/application commit after an
      // operator has collected the missing quote and legal acceptances.
      contract: null,
      price_snapshot: null,
      application: {
        source_record_type: "external_contract_intake",
        source_record_id: intakeId,
        status: "pending_review",
        payload_snapshot: {
          ...input,
          canonical_offer: {
            offer_reference: offer.canonical_offer_reference,
            source_contract_offer_id: offer.source_contract_offer_id,
            contract_product_id: offer.contract_product_id,
            contract_product_version_id: offer.contract_product_version_id,
            contract_publication_version_id:
              offer.contract_publication_version_id,
            legal_bundle_version_id: offer.legal_bundle_version_id,
            contract_type: offer.contract_type,
            energy_direction: offer.energy_direction,
            valid_from: offer.valid_from,
            valid_to: offer.valid_to,
          },
        },
      },
      task: {
        task_type: "external_contract_intake_review",
        status: "open",
        priority: issues.length > 0 ? "high" : "normal",
        title: `Ansökan för ${offer.public_name} mottagen`,
        description: issues.length > 0
          ? `Ansökan behöver kompletteras: ${issues.join(" ")}`
          : "Granska kund, anläggning, mätpunkt och avtal innan operativt flöde fortsätter.",
        metadata: {
          externalContractIntakeId: intakeId,
          issues,
          offer_reference: offer.canonical_offer_reference,
          contract_product_version_id: offer.contract_product_version_id,
          contract_publication_version_id:
            offer.contract_publication_version_id,
          legal_bundle_version_id: offer.legal_bundle_version_id,
        },
      },
      info_request: {
        request_type: "external_contract_onboarding",
        target_party_type: "customer",
        status: issues.length > 0 ? "manual_review_required" : "draft",
        requested_data_categories: ["identity", "site", "metering_point", "authorization"],
        verified_payload: {},
        notes: "Skapad från extern avtalsingång. Granska innan Ediel/outbound skickas.",
        automation_origin: "external_contract_intake",
        automation_key: `external-contract-intake:${intakeId}`,
      },
    }, tenantContext);

    if (!result.ok) {
      const { data: reviewCase } = await supabaseService
        .from("customer_match_review_cases")
        .select("id")
        .eq("company_id", companyId)
        .eq("onboarding_operation_id", result.operation_id)
        .maybeSingle();
      const caseId = reviewCase?.id ? String(reviewCase.id) : null;
      const ambiguityIssue = "Flera möjliga kunder hittades. Ingen kund eller avtal länkades automatiskt.";
      const { error: updateError } = await supabaseService
        .from("external_contract_intakes")
        .update({
          status: "needs_review",
          issues: [...issues, ambiguityIssue],
          created_case_id: caseId,
          updated_at: new Date().toISOString(),
        })
        .eq("company_id", companyId)
        .eq("id", intakeId);
      if (updateError) throw updateError;
      await logUsageEvent({
        companyId,
        entityType: "external_contract_intake",
        entityId: intakeId,
        eventKey: "external_contract_intake.ambiguous_customer_match",
        actionLabel: "Tvetydig kundmatchning blockerad",
        source: "teckna_avtal",
        metadata: {
          correlation_id: result.correlation_id,
          candidate_customer_ids: result.candidate_customer_ids,
          case_id: caseId,
        },
      });
      return { intakeId, status: "needs_review", customerId: null, caseId };
    }

    const { error: updateError } = await supabaseService
      .from("external_contract_intakes")
      .update({
        status: "needs_review",
        created_customer_id: result.customer_id,
        created_site_id: result.site_id,
        created_metering_point_id: result.metering_point_id,
        created_contract_id: result.contract_id,
        created_case_id: result.task_id,
        created_info_request_id: result.info_request_id,
        issues,
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", companyId)
      .eq("id", intakeId);
    if (updateError) throw updateError;

    await logUsageEvent({
      companyId,
      entityType: "external_contract_intake",
      entityId: intakeId,
      eventKey: "external_contract_intake.needs_review",
      actionLabel: "Ansökan via teckna-avtal",
      source: "teckna_avtal",
      metadata: {
        customer_id: result.customer_id,
        customer_number: result.customer_number,
        contract_id: result.contract_id,
        case_id: result.task_id,
        correlation_id: result.correlation_id,
        issue_count: issues.length,
        offer_reference: offer.canonical_offer_reference,
        customer_match: customerMatch.auditMetadata,
      },
    });

    return {
      intakeId,
      status: "needs_review",
      customerId: result.customer_id,
      caseId: result.task_id,
    };
  } catch (error) {
    const { error: updateError } = await supabaseService
      .from("external_contract_intakes")
      .update({
        status: "failed",
        issues: [
          ...issues,
          error instanceof Error ? error.message : "Okänt fel vid kanoniskt kundintag.",
        ],
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", companyId)
      .eq("id", intakeId);
    if (updateError) {
      console.error("External intake failure could not be persisted", updateError);
    }
    throw error;
  }
}
