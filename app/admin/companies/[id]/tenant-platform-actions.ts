"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePlatformAdminActionAccess } from "@/lib/admin/guards";
import { logAdminActionAndUsage } from "@/lib/audit/actionLogger";
import { supabaseService } from "@/lib/supabase/service";
import { seedGridexDefaultLegalPackage } from "@/lib/tenant/legalDefaults";
import { normalizeContractPricing } from "@/lib/pricing/contractPricingVersioning";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function numberValue(
  formData: FormData,
  key: string,
  fallback: number | null = null,
): number | null {
  const raw = text(formData, key).replace(",", ".");
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function intValue(
  formData: FormData,
  key: string,
  fallback: number | null = null,
): number | null {
  const raw = text(formData, key);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
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
      if (isMissingSchemaError(error)) return candidate;
      throw error;
    }
    if (!data || data.length === 0) return candidate;
  }

  const tail = Date.now().toString(36).toUpperCase();
  return `${base.slice(0, Math.max(1, 80 - tail.length - 1))}-${tail}`;
}

async function countRows(
  table: string,
  filters: Record<string, string>,
): Promise<number> {
  let query = supabaseService
    .from(table)
    .select("id", { count: "exact", head: true });
  for (const [key, value] of Object.entries(filters))
    query = query.eq(key, value);
  const { count, error } = await query;
  if (error) {
    if (isMissingSchemaError(error)) return 0;
    throw error;
  }
  return count ?? 0;
}

const REQUIRED_PUBLIC_LEGAL_TYPES = [
  "terms",
  "privacy_policy",
  "withdrawal",
  "power_of_attorney",
  "price_terms",
] as const;

type CanonicalReferenceResult = {
  id: string | null;
  blockers: string[];
  created: boolean;
};

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
  throw new Error("Kunde inte navigera tillbaka efter åtgärden.");
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (
    typeof error === "object" &&
    error &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  )
    return (error as { message: string }).message;
  return "Åtgärden kunde inte genomföras.";
}

function isMissingSchemaError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? "";
  const message = (error as { message?: string } | null)?.message ?? "";
  return (
    ["42P01", "42703", "PGRST200", "PGRST201", "PGRST204", "PGRST205"].includes(
      code,
    ) ||
    /schema cache|does not exist|column .* does not exist|relationship/i.test(
      message,
    )
  );
}

async function legalBundleHasRequiredTexts(
  companyId: string,
  legalBundleId: string,
): Promise<boolean> {
  const { data: bundle, error: bundleError } = await supabaseService
    .from("legal_bundles")
    .select("id,status")
    .eq("id", legalBundleId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (bundleError) {
    if (isMissingSchemaError(bundleError))
      throw new Error(
        "Databasschemat för juridiska paket är inte installerat.",
      );
    throw bundleError;
  }
  if (
    !bundle ||
    !["published", "active"].includes(String(bundle.status ?? "draft"))
  )
    return false;

  const { data: items, error: itemsError } = await supabaseService
    .from("legal_bundle_items")
    .select("legal_text_version_id,type")
    .eq("legal_bundle_id", legalBundleId);

  if (itemsError) {
    if (isMissingSchemaError(itemsError))
      throw new Error(
        "Databasschemat för juridikpaketets dokument är inte installerat.",
      );
    throw itemsError;
  }

  const ids = Array.from(
    new Set(
      ((items ?? []) as Array<{ legal_text_version_id?: string | null }>)
        .map((row) => row.legal_text_version_id)
        .filter(Boolean),
    ),
  ) as string[];
  if (ids.length === 0) return false;

  const { data: versions, error: versionsError } = await supabaseService
    .from("legal_text_versions")
    .select("id,type")
    .eq("company_id", companyId)
    .eq("status", "published")
    .in("id", ids);

  if (versionsError) {
    if (isMissingSchemaError(versionsError))
      throw new Error(
        "Databasschemat för juridiska textversioner är inte installerat.",
      );
    throw versionsError;
  }

  const present = new Set((versions ?? []).map((row) => row.type));
  return REQUIRED_PUBLIC_LEGAL_TYPES.every((type) => present.has(type));
}

async function getActiveLegalBundle(companyId: string): Promise<string | null> {
  const { data, error } = await supabaseService
    .from("legal_bundles")
    .select("id")
    .eq("company_id", companyId)
    .in("status", ["published", "active"])
    .order("updated_at", { ascending: false })
    .limit(10);

  if (error) {
    if (isMissingSchemaError(error)) return null;
    throw error;
  }

  for (const row of (data ?? []) as Array<{ id: string }>) {
    if (await legalBundleHasRequiredTexts(companyId, row.id)) return row.id;
  }
  return null;
}

async function ensurePublishedLegalBundle(
  companyId: string,
  publicName: string,
): Promise<CanonicalReferenceResult> {
  const existing = await getActiveLegalBundle(companyId);
  if (existing) return { id: existing, blockers: [], created: false };

  const { data: versions, error } = await supabaseService
    .from("legal_text_versions")
    .select("id,type,version,published_at,created_at")
    .eq("company_id", companyId)
    .eq("status", "published")
    .in("type", [...REQUIRED_PUBLIC_LEGAL_TYPES])
    .order("type", { ascending: true })
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) {
    if (isMissingSchemaError(error))
      return {
        id: null,
        blockers: [
          "Juridiska texter eller juridiska paket saknas i databasen.",
        ],
        created: false,
      };
    throw error;
  }

  const latestByType = new Map<string, { id: string; type: string }>();
  for (const row of versions ?? []) {
    if (!latestByType.has(row.type))
      latestByType.set(row.type, row as { id: string; type: string });
  }

  let missing = REQUIRED_PUBLIC_LEGAL_TYPES.filter(
    (type) => !latestByType.has(type),
  );
  if (missing.length > 0) {
    const seeded = await seedGridexDefaultLegalPackage(companyId, null);
    if (seeded.missingTypes.length > 0) {
      return {
        id: null,
        blockers: seeded.missingTypes.map(
          (type) => `Gridex standardjuridik saknar mall: ${type}`,
        ),
        created: false,
      };
    }

    const { data: seededVersions, error: seededError } = await supabaseService
      .from("legal_text_versions")
      .select("id,type,version,published_at,created_at")
      .eq("company_id", companyId)
      .eq("status", "published")
      .in("type", [...REQUIRED_PUBLIC_LEGAL_TYPES])
      .order("type", { ascending: true })
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (seededError) throw seededError;
    latestByType.clear();
    for (const row of seededVersions ?? []) {
      if (!latestByType.has(row.type))
        latestByType.set(row.type, row as { id: string; type: string });
    }
    missing = REQUIRED_PUBLIC_LEGAL_TYPES.filter(
      (type) => !latestByType.has(type),
    );
    if (missing.length > 0) {
      return {
        id: null,
        blockers: missing.map(
          (type) => `Publicerad juridisk text saknas: ${type}`,
        ),
        created: false,
      };
    }
  }

  const { data: bundle, error: bundleError } = await supabaseService
    .from("legal_bundles")
    .insert({
      company_id: companyId,
      name: `Standard juridik · ${publicName}`.slice(0, 180),
      status: "published",
    })
    .select("id")
    .single();

  if (bundleError) {
    if (isMissingSchemaError(bundleError))
      return {
        id: null,
        blockers: ["Tabellen för juridiska paket saknas."],
        created: false,
      };
    throw bundleError;
  }

  const items = REQUIRED_PUBLIC_LEGAL_TYPES.map((type, index) => ({
    legal_bundle_id: bundle.id,
    legal_text_version_id: latestByType.get(type)!.id,
    type,
    sort_order: (index + 1) * 10,
  }));
  const { error: itemsError } = await supabaseService
    .from("legal_bundle_items")
    .insert(items);
  if (itemsError) {
    await supabaseService
      .from("legal_bundles")
      .delete()
      .eq("id", bundle.id)
      .eq("company_id", companyId);
    throw itemsError;
  }

  return { id: bundle.id, blockers: [], created: true };
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
  pricePlanId: string | null;
  pricePlanVersionId: string | null;
  termsVersion: string | null;
  publicPriceText: string | null;
  type: string;
  spotWeight: number;
  portfolioWeight: number;
  fixedWeight: number;
  validFrom: string | null;
  validTo: string | null;
}) {
  const issues: string[] = [];
  if (!input.termsVersion) issues.push("Villkorsversion saknas");
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
    redirectBack(companyId, { error: errorMessage(error) });
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
      discountValue: text(formData, "discount_value"),
      discountUnit: text(formData, "discount_unit"),
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
      automaticRenewal: boolValue(formData, "automatic_renewal"),
      powerOfAttorneyRequired: boolValue(
        formData,
        "power_of_attorney_required",
      ),
      optionalFeeLines: text(formData, "optional_fee_lines"),
      productionEnabled: boolValue(formData, "production_enabled"),
      productionCompensationOrePerKwh: text(
        formData,
        "production_compensation_ore_per_kwh",
      ),
      productionVatRate: text(formData, "production_vat_rate"),
      productionSettlementMode: text(
        formData,
        "production_settlement_mode",
      ),
    });
    publicPriceText = normalized.publicPriceText;
    pricingModel = normalized.pricingModel;
    pricingSnapshot = {
      ...normalized.snapshot,
      pricing_model: normalized.pricingModel,
    } as unknown as Record<string, unknown>;
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
    pricePlanId,
    pricePlanVersionId,
    termsVersion,
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

  const previousLegalBundleId = previousString("legal_bundle_id");
  let legalBundleId = submittedLegalBundleId ?? previousLegalBundleId;
  if (
    submittedLegalBundleId &&
    !(await legalBundleHasRequiredTexts(companyId, submittedLegalBundleId))
  ) {
    throw new Error(
      "Valt juridiskt paket är inte publicerat eller saknar obligatoriska juridiska texter.",
    );
  }
  if (
    !submittedLegalBundleId &&
    previousLegalBundleId &&
    !(await legalBundleHasRequiredTexts(companyId, previousLegalBundleId))
  )
    legalBundleId = null;

  let readinessStatus: string | null = null;
  let readinessBlockers: string[] = [];
  const autoCreatedReferences: string[] = [];
  if (publicationStatus === "published") {
    if (!legalBundleId) {
      const legal = await ensurePublishedLegalBundle(companyId, publicName);
      legalBundleId = legal.id;
      readinessBlockers.push(...legal.blockers);
      if (legal.created) autoCreatedReferences.push("juridiskt paket");
    }
    if (!legalBundleId || readinessBlockers.length > 0) {
      throw new Error(
        `Avtalet kan inte publiceras: ${readinessBlockers.join(", ") || "juridiskt paket saknas"}.`,
      );
    }
    readinessStatus = "pending_canonical_validation";
  }

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
    portfolio_management_fee_ore_per_kwh: numberValue(
      formData,
      "portfolio_management_fee_ore_per_kwh",
      previousNumber("portfolio_management_fee_ore_per_kwh"),
    ),
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
    automatic_renewal:
      pricingMode === "preserve"
        ? previousBoolean("automatic_renewal", false)
        : boolValue(formData, "automatic_renewal"),
    power_of_attorney_required:
      pricingMode === "preserve"
        ? previousBoolean("power_of_attorney_required", true)
        : boolValue(formData, "power_of_attorney_required"),
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
    "gridex_upsert_public_contract_offer",
    {
      p_company_id: companyId,
      p_offer_id: id,
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
    offer?: Record<string, unknown>;
    pricing?: PricingRpcResult;
    offer_reference?: string | null;
    created_new_version?: boolean;
  };
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
  readinessStatus =
    publicationStatus === "published" ? "ready" : readinessStatus;
  readinessBlockers = [];

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
  return {
    success: `${id ? "Avtalet uppdaterades" : "Avtalet skapades"}.${publicationStatus === "published" ? " Publicerat och redo för hemsidan." : ""}${versionSuffix}${suffix}`,
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
    redirectBack(companyId, { error: errorMessage(error) });
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

  const snapshotCount = await countRows("contract_price_snapshots", {
    company_id: companyId,
    public_contract_offer_id: id,
  });
  const mustArchive = mode === "archive" || snapshotCount > 0;

  if (mustArchive) {
    const { data: archiveData, error: archiveError } =
      await supabaseService.rpc("gridex_archive_public_contract_offer", {
        p_company_id: companyId,
        p_offer_id: id,
        p_actor_user_id: actor.userId,
      });
    if (archiveError) throw archiveError;
    if (!archiveData || typeof archiveData !== "object")
      throw new Error("Arkiveringen returnerade inget avtal.");
    const archived = archiveData as Record<string, unknown>;

    await logAdminActionAndUsage({
      companyId,
      actorUserId: actor.userId,
      entityType: "public_contract_offer",
      entityId: id,
      action: "contract_plan.archived",
      label:
        snapshotCount > 0
          ? "Avtal arkiverat, historik bevarad"
          : "Avtal arkiverat",
      oldValues: offer,
      newValues: archived,
      source: "company_card_contracts_tab",
      billable: false,
      metadata: { mode, snapshotCount },
    });

    revalidatePath(`/admin/companies/${companyId}`);
    revalidatePath("/admin/contracts");
    return {
      success:
        snapshotCount > 0
          ? "Avtalet används i signerad historik och arkiverades istället för att raderas."
          : "Avtalet arkiverades och är dolt från hemsidan.",
    };
  }

  const { error: deleteError } = await supabaseService
    .from("public_contract_offers")
    .delete()
    .eq("id", id)
    .eq("company_id", companyId);
  if (deleteError) throw deleteError;

  await logAdminActionAndUsage({
    companyId,
    actorUserId: actor.userId,
    entityType: "public_contract_offer",
    entityId: id,
    action: "contract_plan.deleted_unused",
    label: "Oanvänt hemsideavtal raderat",
    oldValues: offer,
    newValues: null,
    source: "company_card_contracts_tab",
    billable: false,
    metadata: { mode, snapshotCount },
  });

  revalidatePath(`/admin/companies/${companyId}`);
  revalidatePath("/admin/contracts");
  return {
    success:
      "Oanvänt avtal raderades. Historiska/signerade avtal raderas aldrig automatiskt.",
  };
}
