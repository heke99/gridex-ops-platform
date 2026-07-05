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
import {
  createCustomerContract,
  getContractOfferById,
} from "@/lib/customer-contracts/db";
import { isBusinessCustomerType } from "@/lib/customers/normalizeCustomerType";
import {
  matchCustomerIdentity,
  type CustomerMatchDecision,
} from "@/lib/customers/matchingService";

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

type ExistingCustomerRow = {
  id: string;
  status?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  company_name?: string | null;
  email?: string | null;
  phone?: string | null;
  personal_number?: string | null;
  org_number?: string | null;
  source?: string | null;
  metadata?: Record<string, unknown> | null;
};

type ExistingSiteRow = {
  id: string;
  customer_id?: string | null;
};

type ExistingMeteringPointRow = {
  id: string;
  customer_id?: string | null;
  site_id?: string | null;
};

const INTAKE_CUSTOMER_SELECT =
  "id,status,first_name,last_name,full_name,company_name,email,phone,personal_number,org_number,source,metadata";

async function findExistingCustomerForIntake(
  companyId: string,
  input: ExternalContractInput,
): Promise<{
  customer: ExistingCustomerRow | null;
  matchDecision: CustomerMatchDecision;
}> {
  const matchDecision = await matchCustomerIdentity({
    companyId,
    personalNumber: input.personalNumber,
    orgNumber: input.orgNumber,
    email: input.email,
    phone: input.phone,
    select: INTAKE_CUSTOMER_SELECT,
  });

  if (matchDecision.outcome === "matched") {
    return {
      customer: matchDecision.customer as ExistingCustomerRow,
      matchDecision,
    };
  }

  if (matchDecision.outcome === "ambiguous") {
    // Preserve legacy linking (newest candidate) but let the caller record the
    // ambiguity for review rather than silently merging.
    const candidate =
      matchDecision.candidates.find(
        (entry) => entry.matchedBy === matchDecision.matchedBy,
      )?.customer ??
      matchDecision.candidates[0]?.customer ??
      null;
    return {
      customer: (candidate as ExistingCustomerRow | null) ?? null,
      matchDecision,
    };
  }

  return { customer: null, matchDecision };
}

async function ensureCustomerForIntake(
  companyId: string,
  input: ExternalContractInput,
  displayName: string | null,
  issues: string[],
): Promise<string> {
  const { customer: existing, matchDecision } =
    await findExistingCustomerForIntake(companyId, input);
  const now = new Date().toISOString();

  if (existing?.id) {
    const metadata =
      existing.metadata && typeof existing.metadata === "object"
        ? existing.metadata
        : {};
    const updatePayload = {
      customer_type: input.customerType,
      first_name: input.firstName ?? existing.first_name ?? null,
      last_name: input.lastName ?? existing.last_name ?? null,
      full_name: displayName || existing.full_name || null,
      company_name: input.companyName ?? existing.company_name ?? null,
      email: input.email ?? existing.email ?? null,
      phone: input.phone ?? existing.phone ?? null,
      personal_number: input.personalNumber ?? existing.personal_number ?? null,
      org_number: input.orgNumber ?? existing.org_number ?? null,
      source: existing.source ?? "external_contract_intake",
      intake_status:
        issues.length > 0 ? "needs_completion" : "ready_for_operations",
      intake_missing_fields: issues,
      intake_warnings: issues,
      ...(matchDecision.needsReview
        ? { possible_duplicate: true, duplicate_review_status: "pending" }
        : {}),
      metadata: {
        ...metadata,
        last_external_contract_intake_at: now,
        external_contract_intake_matched_existing_customer: true,
        customer_match: matchDecision.auditMetadata,
      },
      updated_at: now,
    };

    const { error } = await supabaseService
      .from("customers")
      .update(updatePayload)
      .eq("company_id", companyId)
      .eq("id", existing.id);
    if (error) {
      const code = (error as { code?: string } | null)?.code ?? "";
      if (!["42703", "PGRST204", "PGRST205"].includes(code)) throw error;
      const fallback = await supabaseService
        .from("customers")
        .update({
          first_name: input.firstName ?? existing.first_name ?? null,
          last_name: input.lastName ?? existing.last_name ?? null,
          full_name: displayName || existing.full_name || null,
          company_name: input.companyName ?? existing.company_name ?? null,
          email: input.email ?? existing.email ?? null,
          phone: input.phone ?? existing.phone ?? null,
          personal_number:
            input.personalNumber ?? existing.personal_number ?? null,
          org_number: input.orgNumber ?? existing.org_number ?? null,
          updated_at: now,
        })
        .eq("company_id", companyId)
        .eq("id", existing.id);
      if (fallback.error) throw fallback.error;
    }
    return String(existing.id);
  }

  const insertPayload = {
    company_id: companyId,
    customer_type: input.customerType,
    status: "draft",
    first_name: input.firstName,
    last_name: input.lastName,
    full_name: displayName || null,
    company_name: input.companyName,
    email: input.email,
    phone: input.phone,
    personal_number: input.personalNumber,
    org_number: input.orgNumber,
    source: "external_contract_intake",
    intake_status:
      issues.length > 0 ? "needs_completion" : "ready_for_operations",
    intake_missing_fields: issues,
    intake_warnings: issues,
    metadata: {
      source: "external_contract_intake",
      first_external_contract_intake_at: now,
    },
    created_by: null,
    updated_by: null,
  };

  const { data, error } = await supabaseService
    .from("customers")
    .insert(insertPayload)
    .select("id")
    .single();

  if (!error && data?.id) return String(data.id);

  const code = (error as { code?: string } | null)?.code ?? "";
  if (code === "23505") {
    const { customer: repaired } = await findExistingCustomerForIntake(
      companyId,
      input,
    );
    if (repaired?.id) return String(repaired.id);
  }
  if (["42703", "PGRST204", "PGRST205"].includes(code)) {
    const fallback = await supabaseService
      .from("customers")
      .insert({
        company_id: companyId,
        customer_type: input.customerType,
        status: "draft",
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
    if (fallback.error) throw fallback.error;
    return String(fallback.data.id);
  }

  throw error;
}

async function findExistingSiteForIntake(
  companyId: string,
  facilityId: string | null,
): Promise<ExistingSiteRow | null> {
  if (!facilityId) return null;
  const { data, error } = await supabaseService
    .from("customer_sites")
    .select("id,customer_id")
    .eq("company_id", companyId)
    .eq("facility_id", facilityId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    const code = (error as { code?: string } | null)?.code ?? "";
    if (["42703", "42P01", "PGRST204", "PGRST205"].includes(code)) return null;
    throw error;
  }
  return ((data ?? []) as ExistingSiteRow[])[0] ?? null;
}

async function findExistingMeteringPointForIntake(
  companyId: string,
  meterPointId: string | null,
): Promise<ExistingMeteringPointRow | null> {
  if (!meterPointId) return null;
  const { data, error } = await supabaseService
    .from("metering_points")
    .select("id,customer_id,site_id")
    .eq("company_id", companyId)
    .or(
      `meter_point_id.eq.${meterPointId},metering_point_id.eq.${meterPointId}`,
    )
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    const code = (error as { code?: string } | null)?.code ?? "";
    if (["42703", "42P01", "PGRST204", "PGRST205"].includes(code)) return null;
    throw error;
  }
  return ((data ?? []) as ExistingMeteringPointRow[])[0] ?? null;
}

async function findExistingExternalContract(input: {
  companyId: string;
  customerId: string;
  siteId: string | null;
  meteringPointId: string | null;
  requestedStartDate: string | null;
}): Promise<string | null> {
  let query = supabaseService
    .from("customer_contracts")
    .select(
      "id,site_id,customer_site_id,metering_point_id,starts_at,requested_start_date",
    )
    .eq("company_id", input.companyId)
    .eq("customer_id", input.customerId)
    .in("source_type", ["catalog", "manual_override"])
    .order("created_at", { ascending: false })
    .limit(20);

  const { data, error } = await query;
  if (error) {
    const code = (error as { code?: string } | null)?.code ?? "";
    if (["42703", "42P01", "PGRST204", "PGRST205"].includes(code)) return null;
    throw error;
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const match = rows.find((row) => {
    const rowSiteId = String(row.customer_site_id ?? row.site_id ?? "") || null;
    const rowMeteringPointId = String(row.metering_point_id ?? "") || null;
    const rowStart =
      String(row.requested_start_date ?? row.starts_at ?? "").slice(0, 10) ||
      null;
    const requestedStart = input.requestedStartDate?.slice(0, 10) ?? null;
    return (
      (!input.siteId || rowSiteId === input.siteId) &&
      (!input.meteringPointId ||
        rowMeteringPointId === input.meteringPointId) &&
      (!requestedStart || rowStart === requestedStart)
    );
  });
  return match?.id ? String(match.id) : null;
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
  const customerType = isBusinessCustomerType(
    clean(formData.get("customer_type")),
  )
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
    .select(
      "id, status, created_customer_id, created_site_id, created_metering_point_id, created_contract_id, created_case_id, created_info_request_id",
    )
    .eq("company_id", companyId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  const displayName =
    input.customerType === "business"
      ? input.companyName
      : [input.firstName, input.lastName].filter(Boolean).join(" ").trim();

  let intakeId: string;
  const existingStatus = String(existing?.status ?? "");
  const shouldReplayExisting = Boolean(
    existing?.id &&
      ["received", "processing", "needs_review", "partially_created", "failed"].includes(
        existingStatus,
      ),
  );

  if (existing?.id && !shouldReplayExisting) {
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

  if (existing?.id && shouldReplayExisting) {
    intakeId = String(existing.id);
    await supabaseService
      .from("external_contract_intakes")
      .update({
        status: "processing",
        payload: input,
        issues,
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", companyId)
      .eq("id", intakeId);
  } else {
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
    intakeId = String(intake.id);
  }

  let customerId: string | null = null;
  let siteId: string | null = null;
  let meteringPointId: string | null = null;
  let contractId: string | null = null;
  let caseId: string | null = null;
  let infoRequestId: string | null = null;

  // Idempotent replay: operational artifacts created by an earlier (partial)
  // run are reused instead of duplicated.
  if (existing?.id && shouldReplayExisting) {
    caseId =
      (existing as { created_case_id?: string | null }).created_case_id ?? null;
    infoRequestId =
      (existing as { created_info_request_id?: string | null })
        .created_info_request_id ?? null;
  }

  try {
    customerId = await ensureCustomerForIntake(
      companyId,
      input,
      displayName || null,
      issues,
    );

    const shouldCreateSite = Boolean(
      input.facilityId || input.street || input.meterPointId,
    );
    if (shouldCreateSite) {
      const existingSite = await findExistingSiteForIntake(
        companyId,
        input.facilityId,
      );
      if (
        existingSite?.id &&
        (!existingSite.customer_id || existingSite.customer_id === customerId)
      ) {
        siteId = String(existingSite.id);
        await supabaseService
          .from("customer_sites")
          .update({
            customer_id: customerId,
            price_area_code: input.priceAreaCode,
            move_in_date: input.moveInDate,
            street: input.street,
            postal_code: input.postalCode,
            city: input.city,
            updated_at: new Date().toISOString(),
          })
          .eq("company_id", companyId)
          .eq("id", siteId);
      } else if (existingSite?.id && existingSite.customer_id !== customerId) {
        issues.push(
          "Anläggnings-ID finns redan på en annan kund i samma tenant. Granska innan site kopplas.",
        );
      } else {
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
    }

    if (siteId && input.meterPointId) {
      const existingPoint = await findExistingMeteringPointForIntake(
        companyId,
        input.meterPointId,
      );
      if (
        existingPoint?.id &&
        (!existingPoint.customer_id || existingPoint.customer_id === customerId)
      ) {
        meteringPointId = String(existingPoint.id);
        await supabaseService
          .from("metering_points")
          .update({
            customer_id: customerId,
            site_id: siteId,
            customer_site_id: siteId,
            meter_point_id: input.meterPointId,
            metering_point_id: input.meterPointId,
            site_facility_id: input.facilityId,
            price_area_code: input.priceAreaCode,
            updated_at: new Date().toISOString(),
          })
          .eq("company_id", companyId)
          .eq("id", meteringPointId);
      } else if (
        existingPoint?.id &&
        existingPoint.customer_id !== customerId
      ) {
        issues.push(
          "Mätpunkts-ID finns redan på en annan kund i samma tenant. Granska innan mätpunkt kopplas.",
        );
      } else {
        const { data: point, error: pointError } = await supabaseService
          .from("metering_points")
          .insert({
            company_id: companyId,
            customer_id: customerId,
            site_id: siteId,
            customer_site_id: siteId,
            meter_point_id: input.meterPointId,
            metering_point_id: input.meterPointId,
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
    }

    const offer = input.contractOfferId
      ? await getContractOfferById(input.contractOfferId, companyId)
      : null;
    const existingContractId = await findExistingExternalContract({
      companyId,
      customerId,
      siteId,
      meteringPointId,
      requestedStartDate: input.requestedStartDate,
    });

    if (existingContractId) {
      contractId = existingContractId;
    } else {
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
        optionalFeeLines:
          (offer?.optional_fee_lines as Array<
            Record<string, unknown>
          > | null) ?? [],
        priceSnapshot: offer
          ? {
              offerId: offer.id,
              priceVersion: offer.price_version ?? "v1",
              monthlyFeeSek: offer.monthly_fee_sek ?? null,
              spotMarkupOrePerKwh: offer.spot_markup_ore_per_kwh ?? null,
            }
          : null,
        campaignSnapshot: offer
          ? {
              offerId: offer.id,
              campaignName: offer.campaign_name ?? null,
              campaignCode: offer.campaign_code ?? null,
              campaignVersion: offer.campaign_version ?? "v1",
            }
          : null,
        startsAt: input.requestedStartDate,
        actorUserId: null,
      });
      contractId = contract.id;
    }

    if (!infoRequestId) {
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
    }

    if (!caseId) {
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
    }

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

    // Auditability: the public form previously produced no audit/usage trail
    // at all. No actor (public submission) — the intake row is the entity.
    await logUsageEvent({
      companyId,
      entityType: "external_contract_intake",
      entityId: intakeId,
      eventKey:
        issues.length > 0
          ? "external_contract_intake.needs_review"
          : "external_contract_intake.created",
      actionLabel: "Ansökan via teckna-avtal",
      source: "teckna_avtal",
      metadata: {
        customer_id: customerId,
        contract_id: contractId,
        case_id: caseId,
        issue_count: issues.length,
      },
    });
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
