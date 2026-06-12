import { createHash } from "crypto";
import { supabaseService } from "@/lib/supabase/service";
import { createCustomerContract, getContractOfferById } from "@/lib/customer-contracts/db";

type ExternalContractInput = {
  companySlug: string;
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
  contractOfferId: string | null;
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
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function hashKey(input: ExternalContractInput): string {
  const parts = [
    input.companySlug,
    input.email,
    input.personalNumber,
    input.orgNumber,
    input.facilityId,
    input.meterPointId,
    input.requestedStartDate,
  ]
    .map((value) => value ?? "")
    .join("|");

  return createHash("sha256").update(parts).digest("hex");
}

function validate(input: ExternalContractInput): string[] {
  const issues: string[] = [];
  if (!input.companySlug) issues.push("Bolag saknas.");
  if (!isEmail(input.email))
    issues.push("E-post krävs och måste ha korrekt format.");
  if (input.customerType === "private") {
    if (!input.firstName) issues.push("Förnamn krävs.");
    if (!input.lastName) issues.push("Efternamn krävs.");
  } else if (!input.companyName || !input.orgNumber) {
    issues.push("Företagskund kräver bolagsnamn och organisationsnummer.");
  }
  if (!input.facilityId && !input.meterPointId)
    issues.push(
      "Anläggnings-ID eller mätpunkts-ID krävs för att starta flödet säkert.",
    );
  if (!isIsoDate(input.moveInDate))
    issues.push("Inflyttsdatum måste anges som YYYY-MM-DD.");
  if (!isIsoDate(input.requestedStartDate))
    issues.push("Önskat startdatum måste anges som YYYY-MM-DD.");
  return issues;
}

export function parseExternalContractFormData(
  formData: FormData,
): ExternalContractInput {
  const customerType =
    clean(formData.get("customer_type")) === "business"
      ? "business"
      : "private";
  return {
    companySlug: clean(formData.get("company_slug")) ?? "",
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
    contractOfferId: clean(formData.get("contract_offer_id")),
    requestedStartDate: clean(formData.get("requested_start_date")),
  };
}

export async function createExternalContractIntake(
  input: ExternalContractInput,
): Promise<ExternalContractResult> {
  const { data: company, error: companyError } = await supabaseService
    .from("companies")
    .select("id, name, status")
    .eq("slug", input.companySlug)
    .maybeSingle();

  if (companyError) throw companyError;
  if (!company?.id)
    throw new Error(
      "Bolaget hittades inte. Kontrollera länken till avtalsformuläret.",
    );
  if (!["active", "onboarding"].includes(String(company.status ?? "active"))) {
    throw new Error("Bolaget tar inte emot nya avtal just nu.");
  }

  const issues = validate(input);
  const companyId = String(company.id);
  const idempotencyKey = hashKey(input);

  const { data: existing } = await supabaseService
    .from("external_contract_intakes")
    .select("id, status, created_customer_id, created_case_id")
    .eq("company_id", companyId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existing?.id) {
    return {
      intakeId: String(existing.id),
      status: String(existing.status ?? "duplicate"),
      customerId:
        (existing as { created_customer_id?: string | null })
          .created_customer_id ?? null,
      caseId:
        (existing as { created_case_id?: string | null }).created_case_id ??
        null,
    };
  }

  const displayName =
    input.customerType === "business"
      ? input.companyName
      : [input.firstName, input.lastName].filter(Boolean).join(" ").trim();

  const { data: intake, error: intakeError } = await supabaseService
    .from("external_contract_intakes")
    .insert({
      company_id: companyId,
      status: issues.length > 0 ? "needs_review" : "received",
      idempotency_key: idempotencyKey,
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
      contract_offer_id: input.contractOfferId,
      requested_start_date: input.requestedStartDate,
      payload: input,
      issues,
    })
    .select("id")
    .single();

  if (intakeError) throw intakeError;
  const intakeId = String(intake.id);

  let customerId: string | null = null;
  let siteId: string | null = null;
  let meteringPointId: string | null = null;
  let contractId: string | null = null;
  let caseId: string | null = null;
  let infoRequestId: string | null = null;

  try {
    const { data: customer, error: customerError } = await supabaseService
      .from("customers")
      .insert({
        company_id: companyId,
        customer_type: input.customerType,
        status: issues.length > 0 ? "draft" : "pending_signature",
        first_name: input.firstName,
        last_name: input.lastName,
        full_name: displayName || null,
        company_name: input.companyName,
        email: input.email,
        phone: input.phone,
        personal_number: input.personalNumber,
        org_number: input.orgNumber,
      })
      .select("id")
      .single();

    if (customerError) throw customerError;
    customerId = String(customer.id);

    const shouldCreateSite = Boolean(
      input.facilityId || input.street || input.meterPointId,
    );
    if (shouldCreateSite) {
      const { data: site, error: siteError } = await supabaseService
        .from("customer_sites")
        .insert({
          company_id: companyId,
          customer_id: customerId,
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
          created_by: null,
          updated_by: null,
        })
        .select("id")
        .single();

      if (siteError) throw siteError;
      siteId = String(site.id);
    }

    if (siteId && input.meterPointId) {
      const { data: point, error: pointError } = await supabaseService
        .from("metering_points")
        .insert({
          company_id: companyId,
          customer_id: customerId,
          site_id: siteId,
          meter_point_id: input.meterPointId,
          site_facility_id: input.facilityId,
          status: "draft",
          measurement_type: "consumption",
          reading_frequency: "hourly",
          price_area_code: input.priceAreaCode,
          is_settlement_relevant: true,
          created_by: null,
          updated_by: null,
        })
        .select("id")
        .single();

      if (pointError) throw pointError;
      meteringPointId = String(point.id);
    }

    const offer = input.contractOfferId ? await getContractOfferById(input.contractOfferId, companyId) : null;

    const contract = await createCustomerContract({
      companyId,
      customerId,
      siteId,
      contractOfferId: offer?.id ?? null,
      sourceType: offer ? "catalog" : "manual_override",
      status: "pending_signature",
      contractName: offer?.name ?? "Kundspecifikt avtal via extern ingång",
      contractType: offer?.contract_type ?? "variable_hourly",
      campaignName: offer?.campaign_name ?? null,
      campaignCode: offer?.campaign_code ?? null,
      campaignVersion: offer?.campaign_version ?? "v1",
      priceVersion: offer?.price_version ?? "v1",
      termsVersion: offer?.terms_version ?? "v1",
      discountValue: offer?.discount_value ?? null,
      discountUnit: offer?.discount_unit ?? null,
      startFeeSek: offer?.start_fee_sek ?? null,
      adminFeeSek: offer?.admin_fee_sek ?? null,
      breakFeeSek: offer?.break_fee_sek ?? null,
      vatRate: offer?.vat_rate ?? null,
      fixedPriceOrePerKwh: offer?.fixed_price_ore_per_kwh ?? null,
      spotMarkupOrePerKwh: offer?.spot_markup_ore_per_kwh ?? null,
      variableFeeOrePerKwh: offer?.variable_fee_ore_per_kwh ?? null,
      monthlyFeeSek: offer?.monthly_fee_sek ?? null,
      greenFeeMode: offer?.green_fee_mode ?? "none",
      greenFeeValue: offer?.green_fee_value ?? null,
      bindingMonths: offer?.default_binding_months ?? null,
      noticeMonths: offer?.default_notice_months ?? null,
      optionalFeeLines: (offer?.optional_fee_lines as Array<Record<string, unknown>> | null) ?? [],
      priceSnapshot: offer ? { offerId: offer.id, priceVersion: offer.price_version ?? "v1", monthlyFeeSek: offer.monthly_fee_sek ?? null, spotMarkupOrePerKwh: offer.spot_markup_ore_per_kwh ?? null } : null,
      campaignSnapshot: offer ? { offerId: offer.id, campaignName: offer.campaign_name ?? null, campaignCode: offer.campaign_code ?? null, campaignVersion: offer.campaign_version ?? "v1" } : null,
      startsAt: input.requestedStartDate,
      actorUserId: null,
    });
    contractId = contract.id;

    const { data: infoRequest } = await supabaseService
      .from("customer_info_requests")
      .insert({
        company_id: companyId,
        customer_id: customerId,
        site_id: siteId,
        metering_point_id: meteringPointId,
        request_type: "external_contract_onboarding",
        target_party_type: "customer",
        status: issues.length > 0 ? "manual_review_required" : "draft",
        requested_data_categories: [
          "identity",
          "site",
          "metering_point",
          "authorization",
        ],
        verified_payload: {},
        notes:
          "Skapad från extern avtalsingång. Granska innan Ediel/outbound skickas.",
        automation_origin: "external_contract_intake",
        automation_key: `external-contract-intake:${intakeId}`,
      })
      .select("id")
      .maybeSingle();
    infoRequestId = (infoRequest as { id?: string } | null)?.id ?? null;

    const { data: operationTask } = await supabaseService
      .from("customer_operation_tasks")
      .insert({
        company_id: companyId,
        customer_id: customerId,
        site_id: siteId,
        metering_point_id: meteringPointId,
        task_type: "external_contract_intake_review",
        status: "open",
        priority: issues.length > 0 ? "high" : "normal",
        title: "Ansökan från hemsida mottagen",
        description:
          issues.length > 0
            ? `Ansökan behöver kompletteras: ${issues.join(" ")}`
            : "Ansökan är mottagen från hemsida/API och ska granskas innan operativt flöde fortsätter.",
        metadata: {
          contractId,
          reasonCategory: "external_contract_intake",
          nextAction:
            "Granska kund, anläggning, mätpunkt, avtal och fullmakt. Starta därefter onboarding/Ediel-flöde.",
          source: "external_contract_intake",
          blockerSourceTable: "external_contract_intakes",
          blockerSourceId: intakeId,
          linkedExternalIntakeId: intakeId,
          issues,
          intakeId,
        },
      })
      .select("id")
      .maybeSingle();
    caseId = (operationTask as { id?: string } | null)?.id ?? null;

    await supabaseService
      .from("external_contract_intakes")
      .update({
        status: issues.length > 0 ? "needs_review" : "created",
        created_customer_id: customerId,
        created_site_id: siteId,
        created_metering_point_id: meteringPointId,
        created_contract_id: contractId,
        created_case_id: caseId,
        created_info_request_id: infoRequestId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", intakeId);
  } catch (error) {
    await supabaseService
      .from("external_contract_intakes")
      .update({
        status: "failed",
        issues: [
          ...issues,
          error instanceof Error
            ? error.message
            : "Okänt fel vid skapande av kundkedja.",
        ],
        created_customer_id: customerId,
        created_site_id: siteId,
        created_metering_point_id: meteringPointId,
        created_contract_id: contractId,
        created_case_id: caseId,
        created_info_request_id: infoRequestId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", intakeId);
    throw error;
  }

  return {
    intakeId,
    status: issues.length > 0 ? "needs_review" : "created",
    customerId,
    caseId,
  };
}
