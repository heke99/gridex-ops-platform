"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePlatformAdminActionAccess } from "@/lib/admin/guards";
import { logAdminActionAndUsage } from "@/lib/audit/actionLogger";
import { supabaseService } from "@/lib/supabase/service";
import { normalizeContractPricing } from "@/lib/pricing/contractPricingVersioning";
import { toSafeContractError } from "@/lib/errors/safeActionErrors";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function numberValue(
  formData: FormData,
  key: string,
  fallback: number | null = null,
): number | null {
  if (!formData.has(key)) return fallback;
  const raw = text(formData, key).replace(",", ".");
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${key} måste vara ett giltigt tal.`);
  }
  return parsed;
}

function intValue(
  formData: FormData,
  key: string,
  fallback: number | null = null,
): number | null {
  if (!formData.has(key)) return fallback;
  const raw = text(formData, key);
  if (!raw) return null;
  if (!/^-?\d+$/.test(raw)) {
    throw new Error(`${key} måste vara ett giltigt heltal.`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${key} måste vara ett säkert heltal.`);
  }
  return parsed;
}

function dateValue(formData: FormData, key: string): string | null {
  const value = text(formData, key);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function boolValue(formData: FormData, key: string): boolean {
  return formData.get(key) === "on" || formData.get(key) === "true";
}

function cleanCode(value: string): string | null {
  const cleaned = value
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 80);
  return cleaned || null;
}

function dbCode(error: unknown): string {
  return (error as { code?: string } | null)?.code ?? "";
}

function dbMessage(error: unknown): string {
  return (error as { message?: string } | null)?.message ?? "";
}

function isDuplicatePublicOfferCodeError(error: unknown): boolean {
  return (
    dbCode(error) === "23505" &&
    /public_contract_offers_company_offer_code_uidx|offer_code/i.test(
      dbMessage(error),
    )
  );
}

function basePublicOfferCode(input: {
  requested?: string | null;
  publicName: string;
  contractType: string;
}): string {
  return (
    cleanCode(input.requested ?? "") ??
    cleanCode(input.publicName) ??
    cleanCode(
      `${input.contractType}-${new Date().toISOString().slice(0, 10)}`,
    ) ??
    `AVTAL-${Date.now().toString(36).toUpperCase()}`
  );
}

async function generateUniquePublicOfferCode(input: {
  companyId: string;
  requested?: string | null;
  publicName: string;
  contractType: string;
  ignoreId?: string | null;
}): Promise<string> {
  const base = basePublicOfferCode(input).slice(0, 70);
  for (let index = 0; index < 50; index += 1) {
    const suffix = index === 0 ? "" : `-${index + 1}`;
    const candidate = `${base.slice(0, Math.max(1, 80 - suffix.length))}${suffix}`;
    const query = supabaseService
      .from("public_contract_offers")
      .select("id")
      .eq("company_id", input.companyId)
      .eq("offer_code", candidate)
      .limit(1);

    const { data, error } = await (input.ignoreId
      ? query.neq("id", input.ignoreId)
      : query);
    if (error) {
      throw error;
    }
    if (!data || data.length === 0) return candidate;
  }

  const tail = Date.now().toString(36).toUpperCase();
  return `${base.slice(0, Math.max(1, 80 - tail.length - 1))}-${tail}`;
}

function redirectBack(
  companyId: string | null,
  params: { success?: string; error?: string },
): never {
  const search = new URLSearchParams();
  if (params.success) search.set("success", params.success);
  if (params.error) search.set("error", params.error);
  const target = companyId
    ? `/admin/companies/${companyId}?${search.toString()}#tenant-avtal`
    : `/admin/companies?${search.toString()}`;
  redirect(target);
}

const PUBLICATION_BLOCKER_LABELS: Record<string, string> = {
  tenant_legal_profile_missing: "Bolagets juridikprofil saknas",
  tenant_legal_profile_incomplete: "Bolagets juridikprofil är ofullständig",
  tenant_legal_profile_review_required:
    "Juridikprofilen har ändrats och måste granskas igen",
  contract_version_not_approved: "Avtalsversionen kunde inte låsas",
  price_plan_not_active: "Prisplanen är inte aktiv",
  price_plan_version_not_locked: "Prisversionen är inte låst",
  price_book_not_locked: "Prislistan är inte låst",
  legal_bundle_not_locked: "Juridikpaketet är inte låst",
  unresolved_legal_variables: "Juridikdokument innehåller olösta variabler",
  invalid_validity_period: "Giltighetsperioden är felaktig",
  website_contracts_read_scope_missing:
    "API-klienten saknar website_contracts.read",
  website_applications_write_scope_missing:
    "API-klienten saknar website_applications.write",
};

const LEGAL_PROFILE_FIELD_LABELS: Record<string, string> = {
  legal_name: "juridiskt bolagsnamn",
  organization_number: "organisationsnummer",
  postal_address: "postadress",
  customer_service_email: "kundservice-e-post",
  phone: "telefonnummer",
  website: "webbplats",
  complaints_contact: "klagomålskontakt",
  data_protection_contact: "dataskyddskontakt",
  billing_information: "faktureringsuppgifter",
  dispute_resolution_information: "information om tvistlösning",
};

function publicationBlockerLabel(code: string): string {
  const normalized = code.trim();
  if (normalized.startsWith("missing_legal_profile_field:")) {
    const field = normalized.slice("missing_legal_profile_field:".length);
    return `Juridikprofilen saknar ${LEGAL_PROFILE_FIELD_LABELS[field] ?? field.replaceAll("_", " ")}`;
  }
  if (normalized.startsWith("missing_legal_module:"))
    return `Juridisk modul saknas: ${normalized.slice("missing_legal_module:".length)}`;
  if (normalized.startsWith("unresolved_placeholder:"))
    return `Olöst juridisk variabel: ${normalized.slice("unresolved_placeholder:".length)}`;
  if (normalized.startsWith("missing_document:"))
    return `Juridiskt källdokument saknas: ${normalized.slice("missing_document:".length)}`;
  if (normalized.startsWith("legal_source_bundle_invalid:"))
    return `Valt juridiskt paket är ogiltigt: ${normalized.slice("legal_source_bundle_invalid:".length).replaceAll("_", " ")}`;
  return (
    PUBLICATION_BLOCKER_LABELS[normalized] ?? normalized.replaceAll("_", " ")
  );
}

function errorMessage(error: unknown, companyId?: string | null): string {
  const message =
    error instanceof Error && error.message.trim()
      ? error.message
      : typeof error === "object" &&
          error &&
          "message" in error &&
          typeof (error as { message?: unknown }).message === "string"
        ? (error as { message: string }).message
        : "Åtgärden kunde inte genomföras.";
  if (message.startsWith("publication_not_ready:")) {
    const blockers = message
      .slice("publication_not_ready:".length)
      .split(",")
      .map(publicationBlockerLabel);
    const safe = toSafeContractError(error, {
      action: "tenant_contract_offer",
      companyId,
    });
    const reference = safe.match(/Referens: [A-Z0-9]+\.$/)?.[0] ?? "";
    return `Avtalet kan inte publiceras: ${blockers.join(", ")}. ${reference}`.trim();
  }
  return toSafeContractError(error, {
    action: "tenant_contract_offer",
    companyId,
  });
}

function contractType(value: string): string {
  if (
    [
      "spot",
      "variable_monthly",
      "variable_hourly",
      "variable_quarterly",
      "fixed",
      "portfolio",
      "mixed",
    ].includes(value)
  )
    return value;
  return "spot";
}

function customerType(value: string): "private" | "business" | "both" {
  if (value === "private" || value === "business") return value;
  return "both";
}

type PricingRpcResult = {
  price_plan_id: string;
  price_plan_version_id: string;
  price_book_id: string;
  version_number: number;
  version_label: string;
  content_sha256: string;
  reused: boolean;
};

async function assertSameTenantReference(
  table: string,
  id: string | null,
  companyId: string,
  label: string,
) {
  if (!id) return;
  const { data, error } = await supabaseService
    .from(table)
    .select("id,company_id")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error(`${label} hittades inte.`);
  if (data.company_id !== companyId)
    throw new Error(`${label} tillhör ett annat bolag och kan inte kopplas.`);
}

function publicationIssues(input: {
  publicationStatus: string;
  websiteEnabled: boolean;
  publicPriceText: string | null;
  type: string;
  spotWeight: number;
  portfolioWeight: number;
  fixedWeight: number;
  validFrom: string | null;
  validTo: string | null;
}) {
  const issues: string[] = [];
  if (!input.publicPriceText) issues.push("Publik pristext saknas");
  if (["portfolio", "mixed"].includes(input.type)) {
    const sum = input.spotWeight + input.portfolioWeight + input.fixedWeight;
    if (Math.round(sum * 1000000) / 1000000 !== 100)
      issues.push("Fördelningen måste bli 100%");
  }
  if (input.validFrom && input.validTo && input.validTo < input.validFrom)
    issues.push("Giltighetsdatum är fel");
  if (input.publicationStatus === "published" && !input.websiteEnabled)
    issues.push(
      "Publicerat avtal måste vara markerat för hemsida om det ska visas publikt",
    );
  return issues;
}

export async function saveTenantPublicContractOfferAction(formData: FormData) {
  const companyId = text(formData, "company_id") || null;
  let success: string;
  try {
    success = (await saveTenantPublicContractOfferActionImpl(formData)).success;
  } catch (error) {
    redirectBack(companyId, { error: errorMessage(error, companyId) });
  }
  redirectBack(companyId, { success });
}

async function saveTenantPublicContractOfferActionImpl(
  formData: FormData,
): Promise<{ success: string }> {
  const actor = await requirePlatformAdminActionAccess();
  const companyId = text(formData, "company_id");
  const id = text(formData, "id") || null;
  const publicName = text(formData, "public_name");
  const type = contractType(text(formData, "contract_type"));
  const selectedCustomerType = customerType(text(formData, "customer_type"));
  const publicationStatus = text(formData, "publication_status") || "draft";
  const websiteEnabled = boolValue(formData, "website_enabled");
  const websiteCtaEnabled = boolValue(formData, "website_cta_enabled");
  const termsVersion = text(formData, "terms_version") || null;
  const pricingMode = text(formData, "pricing_mode") || "version";
  const submittedLegalBundleId = text(formData, "legal_bundle_id") || null;
  const validFrom = dateValue(formData, "valid_from");
  const validTo = dateValue(formData, "valid_to");

  if (!companyId) throw new Error("Bolag saknas.");
  if (!publicName) throw new Error("Avtalsnamn krävs.");
  if (
    ![
      "draft",
      "review",
      "published",
      "unpublished",
      "archived",
      "expired",
    ].includes(publicationStatus)
  )
    throw new Error("Ogiltig publiceringsstatus.");

  const { data: company, error: companyError } = await supabaseService
    .from("companies")
    .select("id,name")
    .eq("id", companyId)
    .maybeSingle();
  if (companyError) throw companyError;
  if (!company) throw new Error("Bolaget hittades inte.");

  let previous: Record<string, unknown> | null = null;
  if (id) {
    const { data, error } = await supabaseService
      .from("public_contract_offers")
      .select("*")
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Avtalet hittades inte för valt bolag.");
    previous = data as Record<string, unknown>;
  }

  const previousString = (key: string): string | null =>
    typeof previous?.[key] === "string" && String(previous[key]).trim()
      ? String(previous[key])
      : null;
  const previousNumber = (key: string): number | null =>
    typeof previous?.[key] === "number" && Number.isFinite(previous[key])
      ? Number(previous[key])
      : null;
  const previousBoolean = (key: string, fallback: boolean): boolean =>
    typeof previous?.[key] === "boolean" ? Boolean(previous[key]) : fallback;
  const automaticRenewal =
    pricingMode === "preserve"
      ? previousBoolean("automatic_renewal", false)
      : boolValue(formData, "automatic_renewal");
  const powerOfAttorneyRequired =
    pricingMode === "preserve"
      ? previousBoolean("power_of_attorney_required", true)
      : boolValue(formData, "power_of_attorney_required");

  let pricePlanId = previousString("price_plan_id");
  let pricePlanVersionId = previousString("price_plan_version_id");
  let priceBookId = previousString("price_book_id");
  let publicPriceText = previousString("public_price_text");
  let pricingSnapshot =
    previous?.metadata && typeof previous.metadata === "object"
      ? (((previous.metadata as Record<string, unknown>).pricing_snapshot as
          Record<string, unknown> | undefined) ?? null)
      : null;
  let priceVersionLabel: string | null = null;
  let priceVersionReused = true;
  let portfolioManagementFeeOrePerKwh = previousNumber(
    "portfolio_management_fee_ore_per_kwh",
  );
  let pricingModel =
    typeof pricingSnapshot?.pricing_model === "string"
      ? String(pricingSnapshot.pricing_model)
      : type === "fixed"
        ? "fixed"
        : type === "portfolio"
          ? "portfolio"
          : type === "mixed"
            ? "mixed"
            : "spot";

  const spotWeight =
    numberValue(
      formData,
      "spot_weight_percent",
      previousNumber("spot_weight_percent") ??
        (type === "mixed"
          ? 50
          : type === "portfolio" || type === "fixed"
            ? 0
            : 100),
    ) ?? 100;
  const portfolioWeight =
    numberValue(
      formData,
      "portfolio_weight_percent",
      previousNumber("portfolio_weight_percent") ??
        (type === "mixed" ? 50 : type === "portfolio" ? 100 : 0),
    ) ?? 0;
  const fixedWeight =
    numberValue(
      formData,
      "fixed_weight_percent",
      previousNumber("fixed_weight_percent") ?? (type === "fixed" ? 100 : 0),
    ) ?? 0;

  if (pricingMode !== "preserve") {
    const normalized = normalizeContractPricing({
      name: publicName,
      contractType: type as
        | "spot"
        | "variable_monthly"
        | "variable_hourly"
        | "variable_quarterly"
        | "fixed"
        | "portfolio"
        | "mixed",
      customerType: selectedCustomerType,
      monthlyFeeSek: text(formData, "monthly_fee_sek"),
      invoiceFeeSek: text(formData, "invoice_fee_sek"),
      markupOrePerKwh: text(formData, "markup_ore_per_kwh"),
      spotMarkupOrePerKwh: text(formData, "spot_markup_ore_per_kwh"),
      variableFeeOrePerKwh: text(formData, "variable_fee_ore_per_kwh"),
      fixedPriceOrePerKwh: text(formData, "fixed_price_ore_per_kwh"),
      fixedPricesByArea: text(formData, "fixed_prices_by_area"),
      greenFeeMode: text(formData, "green_fee_mode"),
      greenFeeValue: text(formData, "green_fee_value"),
      electricityCertificateOrePerKwh: text(
        formData,
        "electricity_certificate_ore_per_kwh",
      ),
      startFeeSek: text(formData, "start_fee_sek"),
      administrationFeeSek: text(formData, "administration_fee_sek"),
      breakFeeSek: text(formData, "break_fee_sek"),
      portfolioManagementFeeOrePerKwh: text(
        formData,
        "portfolio_management_fee_ore_per_kwh",
      ),
      portfolioManagementFeeAmount: text(
        formData,
        "portfolio_management_fee_amount",
      ),
      portfolioManagementFeeUnit: text(
        formData,
        "portfolio_management_fee_unit",
      ),
      portfolioManagementFeeCalculationBase: text(
        formData,
        "portfolio_management_fee_calculation_base",
      ),
      portfolioId: text(formData, "portfolio_id"),
      portfolioSettlementTiming: text(
        formData,
        "portfolio_settlement_timing",
      ),
      portfolioEstimateRule: text(formData, "portfolio_estimate_rule"),
      portfolioShowHistoricalFinal:
        text(formData, "portfolio_show_historical_final") === "on",
      portfolioShowIndication:
        text(formData, "portfolio_show_indication") === "on",
      discountValue: text(formData, "discount_value"),
      discountUnit: text(formData, "discount_unit"),
      discountCalculationBase: text(formData, "discount_calculation_base"),
      discountMonths: text(formData, "discount_months"),
      vatRate: text(formData, "vat_rate"),
      spotWeightPercent: spotWeight,
      portfolioWeightPercent: portfolioWeight,
      fixedWeightPercent: fixedWeight,
      spotIntervalResolution: text(formData, "spot_interval_resolution"),
      priceAreas: text(formData, "price_areas"),
      validFrom,
      validTo,
      bindingMonths: text(formData, "binding_months"),
      noticeMonths: text(formData, "notice_months"),
      automaticRenewal,
      powerOfAttorneyRequired,
      optionalFeeLines: text(formData, "optional_fee_lines"),
      productionEnabled: boolValue(formData, "production_enabled"),
      productionCompensationOrePerKwh: text(
        formData,
        "production_compensation_ore_per_kwh",
      ),
      productionVatRate: text(formData, "production_vat_rate"),
      productionSettlementMode: text(formData, "production_settlement_mode"),
      websiteCardVisibility: {
        fixed_price: boolValue(formData, "show_fixed_price_on_website"),
        spot_markup:
          boolValue(formData, "show_spot_markup_on_website") ||
          boolValue(formData, "show_spot_markup_on_website_legacy"),
        variable_fee: boolValue(formData, "show_variable_fee_on_website"),
        monthly_fee: boolValue(formData, "show_monthly_fee_on_website"),
        invoice_fee: boolValue(formData, "show_invoice_fee_on_website"),
        green_energy_fee: boolValue(formData, "show_green_fee_on_website"),
        electricity_certificate: boolValue(
          formData,
          "show_electricity_certificate_on_website",
        ),
        start_fee: boolValue(formData, "show_start_fee_on_website"),
        administration_fee: boolValue(formData, "show_admin_fee_on_website"),
        break_fee: boolValue(formData, "show_break_fee_on_website"),
        portfolio_price: boolValue(formData, "show_portfolio_price_on_website"),
        portfolio_management_fee: boolValue(
          formData,
          "show_portfolio_management_fee_on_website",
        ),
        campaign_discount: boolValue(formData, "show_discount_on_website"),
        optional_fees: boolValue(formData, "show_optional_fees_on_website"),
        production_compensation: boolValue(
          formData,
          "show_production_compensation_on_website",
        ),
      },
    });
    publicPriceText = normalized.publicPriceText;
    pricingModel = normalized.pricingModel;
    pricingSnapshot = {
      ...normalized.snapshot,
      pricing_model: normalized.pricingModel,
    } as unknown as Record<string, unknown>;
    const portfolioManagementComponent =
      normalized.snapshot.price_components.find(
        (component) => component.component_code === "portfolio_management_fee",
      );
    portfolioManagementFeeOrePerKwh =
      portfolioManagementComponent?.unit === "ore_per_kwh"
        ? portfolioManagementComponent.amount
        : null;
  }

  if (!pricingSnapshot || !publicPriceText) {
    throw new Error(
      "Avtalet saknar ett komplett prissnapshot. Öppna avtalet och spara prisuppgifterna igen.",
    );
  }
  await assertSameTenantReference(
    "legal_bundles",
    submittedLegalBundleId,
    companyId,
    "Juridiskt paket",
  );

  const issues = publicationIssues({
    publicationStatus,
    websiteEnabled,
    publicPriceText,
    type,
    spotWeight,
    portfolioWeight,
    fixedWeight,
    validFrom,
    validTo,
  });
  if (publicationStatus === "published" && issues.length > 0)
    throw new Error(`Avtalet kan inte publiceras: ${issues.join(", ")}.`);

  // The database command resolves, validates and, when needed, creates the
  // compatibility legal source bundle inside the same transaction as pricing,
  // legal materialization, contract versioning and publication. No publication
  // write is allowed before the RPC, so a failed publication cannot leave an
  // orphan legal bundle behind.
  const previousLegalBundleId = previousString("legal_bundle_id");
  let legalBundleId =
    submittedLegalBundleId ??
    (publicationStatus === "published" ? null : previousLegalBundleId);
  let readinessStatus: string | null =
    publicationStatus === "published" ? "pending_canonical_validation" : null;
  let readinessBlockers: string[] = [];
  const autoCreatedReferences: string[] = [];

  const isArchived = publicationStatus === "archived";
  const isPublic =
    publicationStatus === "published" && websiteEnabled && issues.length === 0;
  const payload = {
    company_id: companyId,
    public_name: publicName,
    public_description:
      text(formData, "public_description") ||
      previousString("public_description"),
    product_code:
      text(formData, "product_code") ||
      previousString("product_code") ||
      "electricity",
    contract_type: type,
    billing_model:
      text(formData, "billing_model") ||
      previousString("billing_model") ||
      type,
    pricing_model: pricingModel,
    customer_type: selectedCustomerType,
    price_plan_id: pricePlanId,
    price_plan_version_id: pricePlanVersionId,
    campaign_version_id:
      text(formData, "campaign_version_id") ||
      previousString("campaign_version_id"),
    legal_bundle_id: legalBundleId,
    price_book_id: priceBookId,
    monthly_fee_sek: numberValue(
      formData,
      "monthly_fee_sek",
      previousNumber("monthly_fee_sek"),
    ),
    invoice_fee_sek: numberValue(
      formData,
      "invoice_fee_sek",
      previousNumber("invoice_fee_sek"),
    ),
    markup_ore_per_kwh: numberValue(
      formData,
      "markup_ore_per_kwh",
      previousNumber("markup_ore_per_kwh"),
    ),
    spot_markup_ore_per_kwh: numberValue(
      formData,
      "spot_markup_ore_per_kwh",
      previousNumber("spot_markup_ore_per_kwh"),
    ),
    variable_fee_ore_per_kwh: numberValue(
      formData,
      "variable_fee_ore_per_kwh",
      previousNumber("variable_fee_ore_per_kwh"),
    ),
    fixed_price_ore_per_kwh: numberValue(
      formData,
      "fixed_price_ore_per_kwh",
      previousNumber("fixed_price_ore_per_kwh"),
    ),
    green_fee_mode:
      text(formData, "green_fee_mode") || previousString("green_fee_mode"),
    green_fee_value: numberValue(
      formData,
      "green_fee_value",
      previousNumber("green_fee_value"),
    ),
    electricity_certificate_ore_per_kwh: numberValue(
      formData,
      "electricity_certificate_ore_per_kwh",
      previousNumber("electricity_certificate_ore_per_kwh"),
    ),
    start_fee_sek: numberValue(
      formData,
      "start_fee_sek",
      previousNumber("start_fee_sek"),
    ),
    administration_fee_sek: numberValue(
      formData,
      "administration_fee_sek",
      previousNumber("administration_fee_sek"),
    ),
    break_fee_sek: numberValue(
      formData,
      "break_fee_sek",
      previousNumber("break_fee_sek"),
    ),
    portfolio_management_fee_ore_per_kwh: portfolioManagementFeeOrePerKwh,
    discount_value: numberValue(
      formData,
      "discount_value",
      previousNumber("discount_value"),
    ),
    discount_unit:
      text(formData, "discount_unit") || previousString("discount_unit"),
    discount_months: intValue(
      formData,
      "discount_months",
      previousNumber("discount_months"),
    ),
    vat_rate: numberValue(
      formData,
      "vat_rate",
      previousNumber("vat_rate") ?? 25,
    ),
    terms_version: termsVersion ?? previousString("terms_version"),
    terms_url: text(formData, "terms_url") || previousString("terms_url"),
    public_price_text: publicPriceText,
    binding_months: intValue(
      formData,
      "binding_months",
      previousNumber("binding_months"),
    ),
    notice_months: intValue(
      formData,
      "notice_months",
      previousNumber("notice_months"),
    ),
    automatic_renewal: automaticRenewal,
    power_of_attorney_required: powerOfAttorneyRequired,
    spot_weight_percent: spotWeight,
    portfolio_weight_percent: portfolioWeight,
    fixed_weight_percent: fixedWeight,
    price_area: text(formData, "price_area") || previousString("price_area"),
    price_areas:
      pricingSnapshot && Array.isArray(pricingSnapshot.price_areas)
        ? pricingSnapshot.price_areas
        : [],
    valid_from: validFrom ?? previousString("valid_from"),
    valid_to: validTo ?? previousString("valid_to"),
    publication_status: publicationStatus,
    website_enabled: websiteEnabled,
    website_cta_enabled: websiteCtaEnabled,
    is_public: isPublic,
    is_archived: isArchived,
    readiness_status: readinessStatus,
    readiness_blockers: readinessBlockers,
    sort_order:
      intValue(formData, "sort_order", previousNumber("sort_order") ?? 100) ??
      100,
    readiness_issues: issues,
    publication_notes:
      text(formData, "publication_notes") ||
      previousString("publication_notes"),
    published_at: isPublic
      ? (previousString("published_at") ?? new Date().toISOString())
      : null,
    archived_at: isArchived
      ? (previousString("archived_at") ?? new Date().toISOString())
      : null,
    updated_by: actor.userId,
    metadata: {
      ...(previous?.metadata && typeof previous.metadata === "object"
        ? (previous.metadata as Record<string, unknown>)
        : {}),
      ui_source: "company_card_contracts_tab",
      company_name: company.name,
      public_price_text: publicPriceText,
      terms_url: text(formData, "terms_url") || previousString("terms_url"),
      pricing_snapshot: pricingSnapshot,
      price_version_label: priceVersionLabel,
      price_version_reused: priceVersionReused,
      mix: {
        spot_weight_percent: spotWeight,
        portfolio_weight_percent: portfolioWeight,
        fixed_weight_percent: fixedWeight,
      },
    },
  };

  const offerCode = await generateUniquePublicOfferCode({
    companyId,
    requested: text(formData, "offer_code"),
    publicName,
    contractType: type,
    ignoreId: id,
  });
  const { data: commandData, error } = await supabaseService.rpc(
    "gridex_publish_contract_version",
    {
      p_company_id: companyId,
      p_draft_contract_id: id,
      p_offer_code: offerCode,
      p_payload: payload,
      p_pricing_snapshot: pricingSnapshot,
      p_actor_user_id: actor.userId,
    },
  );
  if (error) {
    if (isDuplicatePublicOfferCodeError(error))
      throw new Error(
        "Avtalskoden finns redan för bolaget. Ändra avtalskoden eller försök spara igen.",
      );
    throw error;
  }
  if (!commandData || typeof commandData !== "object")
    throw new Error("Avtalskommandot returnerade inget resultat.");
  const command = commandData as unknown as {
    ok?: boolean;
    error_code?: string;
    message?: string;
    blockers?: string[];
    offer?: Record<string, unknown>;
    pricing?: PricingRpcResult;
    offer_reference?: string | null;
    contract_publication_version_id?: string | null;
    created_new_version?: boolean;
    correlation_id?: string;
    legal_bundle_id?: string | null;
    legal_bundle_created?: boolean;
    readiness?: {
      status?: "ready" | "blocked" | "unknown";
      can_display?: boolean;
      can_accept_applications?: boolean;
      blockers?: string[];
      display_blockers?: string[];
      application_blockers?: string[];
      legal_profile_missing_fields?: string[];
      required_legal_modules?: string[];
      included_legal_modules?: string[];
    };
  };
  if (command.ok === false) {
    const blockers = (command.blockers ?? []).map(publicationBlockerLabel);
    throw new Error(
      blockers.length > 0
        ? `Avtalet kan inte publiceras: ${blockers.join(", ")}.`
        : command.message || "Avtalet kan inte publiceras ännu.",
    );
  }
  if (
    !command.offer?.id ||
    !command.pricing?.price_plan_id ||
    !command.pricing.price_plan_version_id ||
    !command.pricing.price_book_id
  ) {
    throw new Error(
      "Avtalskommandot returnerade ofullständiga versionsreferenser.",
    );
  }
  const saved = command.offer;
  pricePlanId = command.pricing.price_plan_id;
  pricePlanVersionId = command.pricing.price_plan_version_id;
  priceBookId = command.pricing.price_book_id;
  priceVersionLabel = command.pricing.version_label;
  priceVersionReused = command.pricing.reused;
  legalBundleId = command.legal_bundle_id ?? legalBundleId;
  if (command.legal_bundle_created)
    autoCreatedReferences.push("juridiskt paket");
  readinessStatus =
    publicationStatus === "published"
      ? (command.readiness?.status ?? "unknown")
      : readinessStatus;
  readinessBlockers = command.readiness?.blockers ?? [];

  const action =
    publicationStatus === "published"
      ? "contract_plan.published"
      : publicationStatus === "archived"
        ? "contract_plan.archived"
        : id
          ? "contract_plan.updated"
          : "contract_plan.created";
  await logAdminActionAndUsage({
    companyId,
    actorUserId: actor.userId,
    entityType: "public_contract_offer",
    entityId: String(saved.id),
    action,
    label: id ? "Avtal uppdaterat" : "Avtal skapat",
    oldValues: previous,
    newValues: saved,
    source: "company_card_contracts_tab",
    billable: false,
    metadata: {
      publicationStatus,
      websiteEnabled,
      issues,
      readinessStatus,
      readinessBlockers,
      pricePlanId,
      pricePlanVersionId,
      legalBundleId,
      priceBookId,
      priceVersionLabel,
      priceVersionReused,
      autoCreatedReferences,
      correlationId: command.correlation_id ?? null,
    },
  });

  revalidatePath(`/admin/companies/${companyId}`);
  revalidatePath("/admin/contracts");
  const suffix =
    autoCreatedReferences.length > 0
      ? ` Auto-skapade: ${autoCreatedReferences.join(", ")}.`
      : "";
  const versionSuffix = priceVersionLabel
    ? ` Prisversion ${priceVersionLabel}${priceVersionReused ? " återanvändes" : " skapades"}.`
    : "";
  const publicationSuffix =
    publicationStatus !== "published"
      ? ""
      : command.readiness?.can_display
        ? command.readiness?.can_accept_applications
          ? " Publicerat, synligt och öppet för kundteckning."
          : " Publicerat och synligt, men kundteckning är blockerad."
        : " Publicerat, men hemsidevisning är blockerad.";
  return {
    success: `${id ? "Avtalet uppdaterades" : "Avtalet skapades"}.${publicationSuffix}${versionSuffix}${suffix}`,
  };
}

export async function deleteTenantPublicContractOfferAction(
  formData: FormData,
) {
  const companyId = text(formData, "company_id") || null;
  let success: string;
  try {
    success = (await deleteTenantPublicContractOfferActionImpl(formData))
      .success;
  } catch (error) {
    redirectBack(companyId, { error: errorMessage(error, companyId) });
  }
  redirectBack(companyId, { success });
}

async function deleteTenantPublicContractOfferActionImpl(
  formData: FormData,
): Promise<{ success: string }> {
  const actor = await requirePlatformAdminActionAccess();
  const companyId = text(formData, "company_id");
  const id = text(formData, "id");
  const mode = text(formData, "delete_mode") || "safe_delete";

  if (!companyId || !id) throw new Error("Bolag eller avtal saknas.");

  const { data: offer, error } = await supabaseService
    .from("public_contract_offers")
    .select("*")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw error;
  if (!offer) throw new Error("Avtalet hittades inte för valt bolag.");

  const { data: removalData, error: removalError } = await supabaseService.rpc(
    "gridex_remove_contract_offer",
    {
      p_company_id: companyId,
      p_offer_id: id,
      p_mode: mode,
      p_actor_user_id: actor.userId,
    },
  );
  if (removalError) throw removalError;
  if (!removalData || typeof removalData !== "object")
    throw new Error("Avtalskommandot returnerade inget resultat.");
  const removal = removalData as {
    ok?: boolean;
    mode?: "archived" | "deleted";
    snapshot_count?: number;
    offer?: Record<string, unknown>;
  };
  if (removal.ok === false || !removal.mode)
    throw new Error("Avtalet kunde inte tas bort eller arkiveras.");
  const snapshotCount = Number(removal.snapshot_count ?? 0);

  await logAdminActionAndUsage({
    companyId,
    actorUserId: actor.userId,
    entityType: "public_contract_offer",
    entityId: id,
    action:
      removal.mode === "archived"
        ? "contract_plan.archived"
        : "contract_plan.deleted_unused",
    label:
      removal.mode === "archived"
        ? snapshotCount > 0
          ? "Avtal arkiverat, historik bevarad"
          : "Avtal arkiverat"
        : "Oanvänt hemsideavtal raderat",
    oldValues: offer,
    newValues: removal.mode === "archived" ? (removal.offer ?? null) : null,
    source: "company_card_contracts_tab",
    billable: false,
    metadata: {
      mode,
      snapshotCount,
      canonicalCommand: "gridex_remove_contract_offer",
    },
  });

  revalidatePath(`/admin/companies/${companyId}`);
  revalidatePath("/admin/contracts");
  return {
    success:
      removal.mode === "archived"
        ? snapshotCount > 0
          ? "Avtalet används i signerad historik och arkiverades istället för att raderas."
          : "Avtalet arkiverades och är dolt från hemsidan."
        : "Oanvänt avtal raderades. Historiska/signerade avtal raderas aldrig automatiskt.",
  };
}
