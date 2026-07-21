import { supabaseService } from "@/lib/supabase/service";
import type {
  ContractOfferRow,
  ContractType,
  CustomerContractEventRow,
  CustomerContractEventType,
  CustomerContractRow,
  GreenFeeMode,
  CustomerContractTerminationReason,
} from "./types";
import { deriveContractEndsAt } from "./lifecycle";

export type LatestCustomerContractSummary = {
  contract_name: string;
  status: CustomerContractRow["status"];
  contract_type: CustomerContractRow["contract_type"];
  monthly_fee_sek: number | null;
  starts_at: string | null;
  ends_at: string | null;
  auto_renew_enabled: boolean;
  auto_renew_term_months: number | null;
  termination_notice_date: string | null;
  termination_reason: CustomerContractTerminationReason | null;
} | null;

export type LatestContractBucketFilter =
  "all" | "none" | "pending_signature" | "signed" | "active" | "closed";

export type LatestContractBucketCounts = {
  all: number;
  none: number;
  pending_signature: number;
  signed: number;
  active: number;
  closed: number;
};

type CanonicalContractBinding = {
  contract_offer_id: string;
  contract_product_id: string;
  contract_product_version_id: string;
  contract_publication_version_id: string;
  price_plan_id: string;
  price_plan_version_id: string;
  price_book_id: string | null;
  legal_bundle_version_id: string;
  offer_reference: string;
  commercial_snapshot: Record<string, unknown>;
  legal_snapshot: Record<string, unknown>;
};

type ManualBindingInput = {
  companyId: string;
  siteId?: string | null;
  meteringPointId?: string | null;
  contractName: string;
  contractType: ContractType;
  campaignName?: string | null;
  campaignCode?: string | null;
  campaignVersion?: string | null;
  termsVersion?: string | null;
  fixedPriceOrePerKwh?: number | null;
  spotMarkupOrePerKwh?: number | null;
  variableFeeOrePerKwh?: number | null;
  monthlyFeeSek?: number | null;
  startFeeSek?: number | null;
  adminFeeSek?: number | null;
  breakFeeSek?: number | null;
  vatRate?: number | null;
  discountValue?: number | null;
  discountUnit?: string | null;
  greenFeeMode?: GreenFeeMode | null;
  greenFeeValue?: number | null;
  bindingMonths?: number | null;
  noticeMonths?: number | null;
  optionalFeeLines?: Array<Record<string, unknown>> | null;
  startsAt?: string | null;
  endsAt?: string | null;
  autoRenewEnabled?: boolean | null;
  priceSnapshot?: Record<string, unknown> | null;
  actorUserId?: string | null;
};

function pricingModelForContractType(contractType: ContractType): string {
  if (contractType === "fixed") return "fixed";
  if (contractType === "portfolio") return "portfolio";
  if (contractType === "mixed") return "mixed";
  return "spot";
}

function pushPriceComponent(
  target: Array<Record<string, unknown>>,
  input: {
    code: string;
    name: string;
    amount?: number | null;
    unit: string;
    calculationType: string;
    priority: number;
  },
) {
  if (input.amount === null || input.amount === undefined) return;
  target.push({
    component_code: input.code,
    component_type: "fee",
    name: input.name,
    amount: input.amount,
    unit: input.unit,
    calculation_type: input.calculationType,
    vat_applicable: true,
    invoice_line_visible: true,
    periodization_mode:
      input.unit === "sek_month" ? "monthly" : "none",
    priority: input.priority,
  });
}

async function resolveContractPriceAreas(input: ManualBindingInput): Promise<string[]> {
  const snapshotAreas = input.priceSnapshot?.price_areas;
  if (Array.isArray(snapshotAreas)) {
    const normalized = snapshotAreas
      .map((value) => String(value).trim().toUpperCase())
      .filter((value) => ["SE1", "SE2", "SE3", "SE4"].includes(value));
    if (normalized.length > 0) return [...new Set(normalized)];
  }

  if (input.meteringPointId) {
    const { data, error } = await supabaseService
      .from("metering_points")
      .select("price_area_code")
      .eq("id", input.meteringPointId)
      .eq("company_id", input.companyId)
      .maybeSingle();
    if (error) throw error;
    const area = data?.price_area_code?.trim().toUpperCase();
    if (area && ["SE1", "SE2", "SE3", "SE4"].includes(area)) return [area];
  }

  if (input.siteId) {
    const { data, error } = await supabaseService
      .from("customer_sites")
      .select("price_area_code")
      .eq("id", input.siteId)
      .eq("company_id", input.companyId)
      .maybeSingle();
    if (error) throw error;
    const area = data?.price_area_code?.trim().toUpperCase();
    if (area && ["SE1", "SE2", "SE3", "SE4"].includes(area)) return [area];
  }

  throw new Error(
    "Prisområde saknas. Koppla avtalet till en anläggning eller mätpunkt med SE1–SE4 innan avtalet skickas för signering.",
  );
}

async function prepareManualCanonicalBinding(
  input: ManualBindingInput,
): Promise<CanonicalContractBinding> {
  const priceAreas = await resolveContractPriceAreas(input);
  const priceComponents: Array<Record<string, unknown>> = [];
  pushPriceComponent(priceComponents, {
    code: "monthly_fee",
    name: "Månadsavgift",
    amount: input.monthlyFeeSek,
    unit: "sek_month",
    calculationType: "fixed_monthly",
    priority: 20,
  });
  pushPriceComponent(priceComponents, {
    code: "spot_markup",
    name: "Spotpåslag",
    amount: input.spotMarkupOrePerKwh,
    unit: "ore_per_kwh",
    calculationType: "consumption_based",
    priority: 30,
  });
  pushPriceComponent(priceComponents, {
    code: "variable_fee",
    name: "Rörlig avgift",
    amount: input.variableFeeOrePerKwh,
    unit: "ore_per_kwh",
    calculationType: "consumption_based",
    priority: 40,
  });
  pushPriceComponent(priceComponents, {
    code: "green_fee",
    name: "Miljöavgift",
    amount: input.greenFeeValue,
    unit: input.greenFeeMode === "sek_month" ? "sek_month" : "ore_per_kwh",
    calculationType:
      input.greenFeeMode === "sek_month" ? "fixed_monthly" : "consumption_based",
    priority: 50,
  });
  pushPriceComponent(priceComponents, {
    code: "start_fee",
    name: "Startavgift",
    amount: input.startFeeSek,
    unit: "sek_once",
    calculationType: "fixed_once",
    priority: 60,
  });
  pushPriceComponent(priceComponents, {
    code: "admin_fee",
    name: "Administrationsavgift",
    amount: input.adminFeeSek,
    unit: "sek_invoice",
    calculationType: "fixed_invoice",
    priority: 70,
  });
  pushPriceComponent(priceComponents, {
    code: "break_fee",
    name: "Brytavgift",
    amount: input.breakFeeSek,
    unit: "sek_event",
    calculationType: "fixed_event",
    priority: 80,
  });

  for (const [index, line] of (input.optionalFeeLines ?? []).entries()) {
    const amount = Number(line.amount ?? line.value);
    const unit = String(line.unit ?? "sek_month");
    if (!Number.isFinite(amount)) continue;
    priceComponents.push({
      ...line,
      component_code: String(line.component_code ?? `optional_fee_${index + 1}`),
      component_type: String(line.component_type ?? "fee"),
      name: String(line.name ?? line.label ?? `Tillägg ${index + 1}`),
      amount,
      unit,
      calculation_type: String(
        line.calculation_type ??
          (unit === "ore_per_kwh" ? "consumption_based" : "fixed_monthly"),
      ),
      vat_applicable: line.vat_applicable ?? true,
      invoice_line_visible: line.invoice_line_visible ?? true,
      priority: Number(line.priority ?? 100 + index),
    });
  }

  const baseComponents =
    input.fixedPriceOrePerKwh === null || input.fixedPriceOrePerKwh === undefined
      ? []
      : priceAreas.map((priceArea) => ({
          source_type: "manual",
          label: `Fastpris ${priceArea}`,
          weight_percent: 100,
          fixed_price_sek_per_kwh: input.fixedPriceOrePerKwh! / 100,
          price_area: priceArea,
          metadata: { source: "manual_customer_contract" },
        }));

  const pricingSnapshot = {
    ...(input.priceSnapshot ?? {}),
    schema: "gridex_manual_contract_pricing_v1",
    pricing_model: pricingModelForContractType(input.contractType),
    contract_type: input.contractType,
    price_areas: priceAreas,
    vat_rate: input.vatRate ?? 25,
    fixed_price_ore_per_kwh: input.fixedPriceOrePerKwh ?? null,
    spot_markup_ore_per_kwh: input.spotMarkupOrePerKwh ?? null,
    variable_fee_ore_per_kwh: input.variableFeeOrePerKwh ?? null,
    monthly_fee_sek: input.monthlyFeeSek ?? null,
    discount_value: input.discountValue ?? null,
    discount_unit: input.discountUnit ?? null,
    green_fee_mode: input.greenFeeMode ?? "none",
    green_fee_value: input.greenFeeValue ?? null,
    base_components: baseComponents,
    price_components: priceComponents,
  };

  const { data, error } = await supabaseService.rpc(
    "gridex_prepare_manual_contract_binding",
    {
      p_company_id: input.companyId,
      p_payload: {
        name: input.contractName,
        contract_type: input.contractType,
        customer_type: "both",
        pricing_model: pricingModelForContractType(input.contractType),
        campaign_name: input.campaignName ?? null,
        campaign_code: input.campaignCode ?? null,
        campaign_version: input.campaignVersion ?? null,
        terms_version: input.termsVersion ?? "canonical",
        fixed_price_ore_per_kwh: input.fixedPriceOrePerKwh ?? null,
        spot_markup_ore_per_kwh: input.spotMarkupOrePerKwh ?? null,
        variable_fee_ore_per_kwh: input.variableFeeOrePerKwh ?? null,
        monthly_fee_sek: input.monthlyFeeSek ?? null,
        green_fee_mode: input.greenFeeMode ?? "none",
        green_fee_value: input.greenFeeValue ?? null,
        default_binding_months: input.bindingMonths ?? null,
        default_notice_months: input.noticeMonths ?? null,
        optional_fee_lines: input.optionalFeeLines ?? [],
        automatic_renewal: input.autoRenewEnabled ?? false,
        valid_from: input.startsAt ?? null,
        valid_to: input.endsAt ?? null,
      },
      p_pricing_snapshot: pricingSnapshot,
      p_actor_user_id: input.actorUserId ?? null,
    },
  );
  if (error) throw error;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("canonical_manual_contract_binding_missing");
  }
  return data as CanonicalContractBinding;
}

export async function listContractOffers(
  options: {
    activeOnly?: boolean;
    companyId?: string | null;
    includeArchived?: boolean;
  } = {},
): Promise<ContractOfferRow[]> {
  let query = supabaseService
    .from("canonical_internal_contract_offers_v")
    .select("*")
    .order("is_active", { ascending: false })
    .order("updated_at", { ascending: false });

  if (options.companyId) {
    query = query.eq("company_id", options.companyId);
  }

  if (options.activeOnly) {
    query = query
      .eq("lifecycle_status", "published")
      .eq("currently_sellable", true);
  } else if (!options.includeArchived) {
    query = query.not("lifecycle_status", "in", "(archived,superseded)");
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []) as ContractOfferRow[];
}

export async function getContractOfferById(
  id: string,
  companyId?: string | null,
): Promise<ContractOfferRow | null> {
  let query = supabaseService.from("canonical_internal_contract_offers_v").select("*").eq("id", id);

  if (companyId) {
    query = query.eq("company_id", companyId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) throw error;
  return (data as ContractOfferRow | null) ?? null;
}

export async function listCustomerContractsByCustomerId(
  customerId: string,
  options: { companyId?: string | null; limit?: number } = {},
): Promise<CustomerContractRow[]> {
  let query = supabaseService
    .from("customer_contracts")
    .select("*")
    .eq("customer_id", customerId);

  if (options.companyId) {
    query = query.eq("company_id", options.companyId);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 100);

  if (error) throw error;
  return (data ?? []) as CustomerContractRow[];
}

export async function listLatestCustomerContractsByCustomerIds(
  customerIds: string[],
  options: { companyId?: string | null } = {},
): Promise<Map<string, LatestCustomerContractSummary>> {
  const result = new Map<string, LatestCustomerContractSummary>();

  if (customerIds.length === 0) {
    return result;
  }

  let query = supabaseService
    .from("customer_contracts")
    .select("*")
    .in("customer_id", customerIds);

  if (options.companyId) {
    query = query.eq("company_id", options.companyId);
  }

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) throw error;

  const rows = (data ?? []) as CustomerContractRow[];

  for (const row of rows) {
    if (!result.has(row.customer_id)) {
      result.set(row.customer_id, {
        contract_name: row.contract_name,
        status: row.status,
        contract_type: row.contract_type,
        monthly_fee_sek: row.monthly_fee_sek,
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        auto_renew_enabled: row.auto_renew_enabled,
        auto_renew_term_months: row.auto_renew_term_months,
        termination_notice_date: row.termination_notice_date,
        termination_reason: row.termination_reason,
      });
    }
  }

  return result;
}

export async function getLatestContractBucketCounts(
  options: {
    query?: string | null;
    customerStatus?: string | null;
  } = {},
): Promise<LatestContractBucketCounts> {
  const { data, error } = await supabaseService.rpc(
    "admin_customer_latest_contract_counts",
    {
      search_text: options.query?.trim() || null,
      customer_status: options.customerStatus?.trim() || null,
    },
  );

  if (error) throw error;

  const rows = (data ?? []) as Array<{
    bucket: string;
    total: number | string;
  }>;

  const counts: LatestContractBucketCounts = {
    all: 0,
    none: 0,
    pending_signature: 0,
    signed: 0,
    active: 0,
    closed: 0,
  };

  for (const row of rows) {
    const total = Number(row.total ?? 0);

    if (row.bucket === "none") counts.none += total;
    if (row.bucket === "pending_signature") counts.pending_signature += total;
    if (row.bucket === "signed") counts.signed += total;
    if (row.bucket === "active") counts.active += total;
    if (row.bucket === "closed") counts.closed += total;

    counts.all += total;
  }

  return counts;
}

export async function listCustomerIdsByLatestContractBucket(options: {
  query?: string | null;
  customerStatus?: string | null;
  bucket: LatestContractBucketFilter;
  page: number;
  pageSize: number;
  companyId?: string | null;
}): Promise<{
  customerIds: string[];
  total: number;
}> {
  const { data, error } = await supabaseService.rpc(
    "admin_customer_ids_by_latest_contract",
    {
      search_text: options.query?.trim() || null,
      customer_status: options.customerStatus?.trim() || null,
      contract_bucket: options.bucket,
      page_num: options.page,
      page_size: options.pageSize,
      company_id: options.companyId ?? null,
    },
  );

  if (error) throw error;

  const rows = (data ?? []) as Array<{
    customer_id: string;
    total_count: number | string;
  }>;

  return {
    customerIds: rows.map((row) => row.customer_id),
    total: rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0,
  };
}

export async function getCustomerContractById(
  id: string,
  options: { companyId?: string | null } = {},
): Promise<CustomerContractRow | null> {
  let query = supabaseService
    .from("customer_contracts")
    .select("*")
    .eq("id", id);

  // Fail-closed tenant scoping: callers that know the tenant must pass it so a
  // contract id from another company can never be read through this helper.
  if (options.companyId) query = query.eq("company_id", options.companyId);

  const { data, error } = await query.maybeSingle();

  if (error) throw error;
  return (data as CustomerContractRow | null) ?? null;
}

export async function listCustomerContractEventsByCustomerId(
  customerId: string,
  options: { companyId?: string | null; limit?: number } = {},
): Promise<CustomerContractEventRow[]> {
  let query = supabaseService
    .from("customer_contract_events")
    .select("*")
    .eq("customer_id", customerId);

  if (options.companyId) {
    query = query.eq("company_id", options.companyId);
  }

  const { data, error } = await query
    .order("happened_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 100);

  if (error) throw error;
  return (data ?? []) as CustomerContractEventRow[];
}

export async function createCustomerContract(input: {
  customerId: string;
  siteId?: string | null;
  meteringPointId?: string | null;
  contractOfferId?: string | null;
  sourceType: "catalog" | "manual_override";
  status?: CustomerContractRow["status"];
  companyId?: string | null;
  contractName: string;
  contractType: ContractType;
  campaignName?: string | null;
  campaignCode?: string | null;
  campaignVersion?: string | null;
  priceVersion?: string | null;
  termsVersion?: string | null;
  discountValue?: number | null;
  discountUnit?: string | null;
  startFeeSek?: number | null;
  adminFeeSek?: number | null;
  breakFeeSek?: number | null;
  vatRate?: number | null;
  priceSnapshot?: Record<string, unknown> | null;
  campaignSnapshot?: Record<string, unknown> | null;
  billingReadyStatus?: string | null;
  billingBlockerReasons?: Array<Record<string, unknown>> | null;
  currentSupplierId?: string | null;
  currentSupplierName?: string | null;
  currentSupplierOrgNumber?: string | null;
  currentSupplierContractStatus?: string | null;
  currentSupplierContractEndDate?: string | null;
  currentSupplierNoticePeriod?: string | null;
  currentSupplierTerminationFee?: number | null;
  currentSupplierResponseStatus?: string | null;
  withdrawalRequestedAt?: string | null;
  rejectedReason?: string | null;
  fixedPriceOrePerKwh?: number | null;
  spotMarkupOrePerKwh?: number | null;
  variableFeeOrePerKwh?: number | null;
  monthlyFeeSek?: number | null;
  greenFeeMode: GreenFeeMode;
  greenFeeValue?: number | null;
  bindingMonths?: number | null;
  noticeMonths?: number | null;
  optionalFeeLines?: Array<Record<string, unknown>> | null;
  startsAt?: string | null;
  expectedStartAt?: string | null;
  confirmedStartAt?: string | null;
  actualStartAt?: string | null;
  startDateSource?: string | null;
  invoiceRecipient?: string | null;
  invoiceEmail?: string | null;
  invoiceReference?: string | null;
  billingStreet?: string | null;
  billingPostalCode?: string | null;
  billingCity?: string | null;
  billingCountry?: string | null;
  billingAddressSameAsSite?: boolean | null;
  billingLevel?: string | null;
  consolidatedInvoice?: boolean | null;
  endsAt?: string | null;
  signedAt?: string | null;
  terminationNoticeDate?: string | null;
  terminationReason?: CustomerContractTerminationReason | null;
  autoRenewEnabled?: boolean | null;
  autoRenewTermMonths?: number | null;
  overrideReason?: string | null;
  actorUserId?: string | null;
}): Promise<CustomerContractRow> {
  const status = input.status ?? "draft";
  if (status !== "draft" && !input.companyId) {
    throw new Error("Bolag krävs för att versionslåsa kundavtalet.");
  }
  const manualBinding =
    !input.contractOfferId && status !== "draft" && input.companyId
      ? await prepareManualCanonicalBinding({
          companyId: input.companyId,
          siteId: input.siteId,
          meteringPointId: input.meteringPointId,
          contractName: input.contractName,
          contractType: input.contractType,
          campaignName: input.campaignName,
          campaignCode: input.campaignCode,
          campaignVersion: input.campaignVersion,
          termsVersion: input.termsVersion,
          fixedPriceOrePerKwh: input.fixedPriceOrePerKwh,
          spotMarkupOrePerKwh: input.spotMarkupOrePerKwh,
          variableFeeOrePerKwh: input.variableFeeOrePerKwh,
          monthlyFeeSek: input.monthlyFeeSek,
          startFeeSek: input.startFeeSek,
          adminFeeSek: input.adminFeeSek,
          breakFeeSek: input.breakFeeSek,
          vatRate: input.vatRate,
          discountValue: input.discountValue,
          discountUnit: input.discountUnit,
          greenFeeMode: input.greenFeeMode,
          greenFeeValue: input.greenFeeValue,
          bindingMonths: input.bindingMonths,
          noticeMonths: input.noticeMonths,
          optionalFeeLines: input.optionalFeeLines,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          autoRenewEnabled: input.autoRenewEnabled,
          priceSnapshot: input.priceSnapshot,
          actorUserId: input.actorUserId,
        })
      : null;

  const { data, error } = await supabaseService
    .from("customer_contracts")
    .insert({
      company_id: input.companyId ?? null,
      customer_id: input.customerId,
      site_id: input.siteId ?? null,
      customer_site_id: input.siteId ?? null,
      metering_point_id: input.meteringPointId ?? null,
      contract_offer_id: manualBinding?.contract_offer_id ?? input.contractOfferId ?? null,
      contract_product_id: manualBinding?.contract_product_id ?? null,
      contract_product_version_id:
        manualBinding?.contract_product_version_id ?? null,
      contract_publication_version_id:
        manualBinding?.contract_publication_version_id ?? null,
      price_plan_id: manualBinding?.price_plan_id ?? null,
      price_plan_version_id: manualBinding?.price_plan_version_id ?? null,
      price_book_id: manualBinding?.price_book_id ?? null,
      legal_bundle_version_id:
        manualBinding?.legal_bundle_version_id ?? null,
      offer_reference: manualBinding?.offer_reference ?? null,
      commercial_snapshot: manualBinding?.commercial_snapshot ?? {},
      legal_snapshot: manualBinding?.legal_snapshot ?? {},
      source_type: input.sourceType,
      status,
      contract_name: input.contractName,
      contract_type: input.contractType,
      campaign_name: input.campaignName ?? null,
      campaign_code: input.campaignCode ?? null,
      campaign_version: input.campaignVersion ?? null,
      price_version: input.priceVersion ?? null,
      terms_version: input.termsVersion ?? null,
      contract_version:
        input.termsVersion ??
        input.priceVersion ??
        input.campaignVersion ??
        "v1",
      signed_version: input.signedAt
        ? (input.termsVersion ??
          input.priceVersion ??
          input.campaignVersion ??
          "v1")
        : null,
      terms_signed_version: input.signedAt
        ? (input.termsVersion ?? "v1")
        : null,
      version_snapshot: {
        campaignVersion: input.campaignVersion ?? null,
        priceVersion: input.priceVersion ?? null,
        termsVersion: input.termsVersion ?? null,
        signedAt: input.signedAt ?? null,
      },
      start_status: input.actualStartAt
        ? "active_from_date"
        : input.confirmedStartAt
          ? "confirmed_start_date"
          : input.expectedStartAt
            ? "preliminary_start_date"
            : input.startsAt
              ? "requested_start_date"
              : "start_date_missing",
      discount_value: input.discountValue ?? null,
      discount_unit: input.discountUnit ?? null,
      start_fee_sek: input.startFeeSek ?? null,
      admin_fee_sek: input.adminFeeSek ?? null,
      break_fee_sek: input.breakFeeSek ?? null,
      vat_rate: input.vatRate ?? null,
      price_snapshot: input.priceSnapshot ?? null,
      campaign_snapshot: input.campaignSnapshot ?? null,
      billing_ready_status: input.billingReadyStatus ?? null,
      billing_blocker_reasons: input.billingBlockerReasons ?? [],
      current_supplier_id: input.currentSupplierId ?? null,
      current_supplier_name: input.currentSupplierName ?? null,
      current_supplier_org_number: input.currentSupplierOrgNumber ?? null,
      current_supplier_contract_status:
        input.currentSupplierContractStatus ?? null,
      current_supplier_contract_end_date:
        input.currentSupplierContractEndDate ?? null,
      current_supplier_notice_period: input.currentSupplierNoticePeriod ?? null,
      current_supplier_termination_fee:
        input.currentSupplierTerminationFee ?? null,
      current_supplier_response_status:
        input.currentSupplierResponseStatus ?? null,
      withdrawal_requested_at: input.withdrawalRequestedAt ?? null,
      rejected_reason: input.rejectedReason ?? null,
      fixed_price_ore_per_kwh: input.fixedPriceOrePerKwh ?? null,
      spot_markup_ore_per_kwh: input.spotMarkupOrePerKwh ?? null,
      variable_fee_ore_per_kwh: input.variableFeeOrePerKwh ?? null,
      monthly_fee_sek: input.monthlyFeeSek ?? null,
      green_fee_mode: input.greenFeeMode,
      green_fee_value: input.greenFeeValue ?? null,
      binding_months: input.bindingMonths ?? null,
      notice_months: input.noticeMonths ?? null,
      optional_fee_lines: input.optionalFeeLines ?? [],
      starts_at: input.startsAt ?? null,
      expected_start_at: input.expectedStartAt ?? null,
      confirmed_start_at: input.confirmedStartAt ?? null,
      actual_start_at: input.actualStartAt ?? null,
      start_date_source: input.startDateSource ?? null,
      invoice_recipient: input.invoiceRecipient ?? null,
      invoice_email: input.invoiceEmail ?? null,
      invoice_reference: input.invoiceReference ?? null,
      billing_street: input.billingStreet ?? null,
      billing_postal_code: input.billingPostalCode ?? null,
      billing_city: input.billingCity ?? null,
      billing_country: input.billingCountry ?? null,
      billing_address_same_as_site: input.billingAddressSameAsSite ?? false,
      billing_level: input.billingLevel ?? "customer",
      consolidated_invoice: input.consolidatedInvoice ?? false,
      ends_at: deriveContractEndsAt({
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        bindingMonths: input.bindingMonths ?? null,
        noticeMonths: input.noticeMonths ?? null,
        terminationNoticeDate: input.terminationNoticeDate ?? null,
        terminationReason: input.terminationReason ?? null,
        autoRenewEnabled: input.autoRenewEnabled ?? null,
        autoRenewTermMonths: input.autoRenewTermMonths ?? null,
        status,
      }),
      signed_at: input.signedAt ?? null,
      termination_notice_date: input.terminationNoticeDate ?? null,
      termination_reason: input.terminationReason ?? null,
      auto_renew_enabled:
        input.autoRenewEnabled ?? (input.bindingMonths ?? 0) > 0,
      auto_renew_term_months:
        input.autoRenewTermMonths ?? input.bindingMonths ?? null,
      override_reason: input.overrideReason ?? null,
      created_by: input.actorUserId ?? null,
      updated_by: input.actorUserId ?? null,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as CustomerContractRow;
}

export async function updateCustomerContract(input: {
  id: string;
  customerId: string;
  siteId?: string | null;
  meteringPointId?: string | null;
  status: CustomerContractRow["status"];
  companyId?: string | null;
  contractName: string;
  contractType: ContractType;
  campaignName?: string | null;
  campaignCode?: string | null;
  campaignVersion?: string | null;
  priceVersion?: string | null;
  termsVersion?: string | null;
  discountValue?: number | null;
  discountUnit?: string | null;
  startFeeSek?: number | null;
  adminFeeSek?: number | null;
  breakFeeSek?: number | null;
  vatRate?: number | null;
  priceSnapshot?: Record<string, unknown> | null;
  campaignSnapshot?: Record<string, unknown> | null;
  billingReadyStatus?: string | null;
  billingBlockerReasons?: Array<Record<string, unknown>> | null;
  withdrawalRequestedAt?: string | null;
  rejectedReason?: string | null;
  fixedPriceOrePerKwh?: number | null;
  spotMarkupOrePerKwh?: number | null;
  variableFeeOrePerKwh?: number | null;
  monthlyFeeSek?: number | null;
  greenFeeMode?: GreenFeeMode | null;
  greenFeeValue?: number | null;
  bindingMonths?: number | null;
  noticeMonths?: number | null;
  startsAt?: string | null;
  expectedStartAt?: string | null;
  confirmedStartAt?: string | null;
  actualStartAt?: string | null;
  startDateSource?: string | null;
  endsAt?: string | null;
  signedAt?: string | null;
  terminationNoticeDate?: string | null;
  terminationReason?: CustomerContractTerminationReason | null;
  autoRenewEnabled?: boolean | null;
  autoRenewTermMonths?: number | null;
  overrideReason?: string | null;
  actorUserId?: string | null;
}): Promise<CustomerContractRow> {
  const { data: existing, error: existingError } = await supabaseService
    .from("customer_contracts")
    .select("contract_offer_id,contract_publication_version_id,source_type")
    .eq("id", input.id)
    .eq("customer_id", input.customerId)
    .eq("company_id", input.companyId ?? null)
    .maybeSingle();
  if (existingError) throw existingError;
  if (!existing) throw new Error("Kundavtalet hittades inte.");

  const manualBinding =
    input.status !== "draft" &&
    !existing.contract_offer_id &&
    !existing.contract_publication_version_id &&
    input.companyId
      ? await prepareManualCanonicalBinding({
          companyId: input.companyId,
          siteId: input.siteId,
          meteringPointId: input.meteringPointId,
          contractName: input.contractName,
          contractType: input.contractType,
          campaignName: input.campaignName,
          campaignCode: input.campaignCode,
          campaignVersion: input.campaignVersion,
          termsVersion: input.termsVersion,
          fixedPriceOrePerKwh: input.fixedPriceOrePerKwh,
          spotMarkupOrePerKwh: input.spotMarkupOrePerKwh,
          variableFeeOrePerKwh: input.variableFeeOrePerKwh,
          monthlyFeeSek: input.monthlyFeeSek,
          startFeeSek: input.startFeeSek,
          adminFeeSek: input.adminFeeSek,
          breakFeeSek: input.breakFeeSek,
          vatRate: input.vatRate,
          discountValue: input.discountValue,
          discountUnit: input.discountUnit,
          greenFeeMode: input.greenFeeMode,
          greenFeeValue: input.greenFeeValue,
          bindingMonths: input.bindingMonths,
          noticeMonths: input.noticeMonths,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          autoRenewEnabled: input.autoRenewEnabled,
          priceSnapshot: input.priceSnapshot,
          actorUserId: input.actorUserId,
        })
      : null;

  if (input.status !== "draft" && !input.companyId) {
    throw new Error("Bolag krävs för att versionslåsa kundavtalet.");
  }

  const { data, error } = await supabaseService
    .from("customer_contracts")
    .update({
      ...(manualBinding
        ? {
            contract_offer_id: manualBinding.contract_offer_id,
            contract_product_id: manualBinding.contract_product_id,
            contract_product_version_id:
              manualBinding.contract_product_version_id,
            contract_publication_version_id:
              manualBinding.contract_publication_version_id,
            price_plan_id: manualBinding.price_plan_id,
            price_plan_version_id: manualBinding.price_plan_version_id,
            price_book_id: manualBinding.price_book_id,
            legal_bundle_version_id: manualBinding.legal_bundle_version_id,
            offer_reference: manualBinding.offer_reference,
            commercial_snapshot: manualBinding.commercial_snapshot,
            legal_snapshot: manualBinding.legal_snapshot,
          }
        : {}),
      site_id: input.siteId ?? null,
      customer_site_id: input.siteId ?? null,
      metering_point_id: input.meteringPointId ?? null,
      status: input.status,
      contract_name: input.contractName,
      contract_type: input.contractType,
      campaign_name: input.campaignName ?? null,
      campaign_code: input.campaignCode ?? null,
      campaign_version: input.campaignVersion ?? null,
      price_version: input.priceVersion ?? null,
      terms_version: input.termsVersion ?? null,
      contract_version:
        input.termsVersion ??
        input.priceVersion ??
        input.campaignVersion ??
        "v1",
      signed_version: input.signedAt
        ? (input.termsVersion ??
          input.priceVersion ??
          input.campaignVersion ??
          "v1")
        : null,
      terms_signed_version: input.signedAt
        ? (input.termsVersion ?? "v1")
        : null,
      version_snapshot: {
        campaignVersion: input.campaignVersion ?? null,
        priceVersion: input.priceVersion ?? null,
        termsVersion: input.termsVersion ?? null,
        signedAt: input.signedAt ?? null,
      },
      start_status: input.actualStartAt
        ? "active_from_date"
        : input.confirmedStartAt
          ? "confirmed_start_date"
          : input.expectedStartAt
            ? "preliminary_start_date"
            : input.startsAt
              ? "requested_start_date"
              : "start_date_missing",
      discount_value: input.discountValue ?? null,
      discount_unit: input.discountUnit ?? null,
      start_fee_sek: input.startFeeSek ?? null,
      admin_fee_sek: input.adminFeeSek ?? null,
      break_fee_sek: input.breakFeeSek ?? null,
      vat_rate: input.vatRate ?? null,
      price_snapshot: input.priceSnapshot ?? null,
      campaign_snapshot: input.campaignSnapshot ?? null,
      billing_ready_status: input.billingReadyStatus ?? null,
      billing_blocker_reasons: input.billingBlockerReasons ?? [],
      withdrawal_requested_at: input.withdrawalRequestedAt ?? null,
      rejected_reason: input.rejectedReason ?? null,
      fixed_price_ore_per_kwh: input.fixedPriceOrePerKwh ?? null,
      spot_markup_ore_per_kwh: input.spotMarkupOrePerKwh ?? null,
      variable_fee_ore_per_kwh: input.variableFeeOrePerKwh ?? null,
      monthly_fee_sek: input.monthlyFeeSek ?? null,
      green_fee_mode: input.greenFeeMode ?? "none",
      green_fee_value: input.greenFeeValue ?? null,
      binding_months: input.bindingMonths ?? null,
      notice_months: input.noticeMonths ?? null,
      starts_at: input.startsAt ?? null,
      expected_start_at: input.expectedStartAt ?? null,
      confirmed_start_at: input.confirmedStartAt ?? null,
      actual_start_at: input.actualStartAt ?? null,
      start_date_source: input.startDateSource ?? null,
      ends_at: deriveContractEndsAt({
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        bindingMonths: input.bindingMonths ?? null,
        noticeMonths: input.noticeMonths ?? null,
        terminationNoticeDate: input.terminationNoticeDate ?? null,
        terminationReason: input.terminationReason ?? null,
        autoRenewEnabled: input.autoRenewEnabled ?? null,
        autoRenewTermMonths: input.autoRenewTermMonths ?? null,
        status: input.status ?? "draft",
      }),
      signed_at: input.signedAt ?? null,
      termination_notice_date: input.terminationNoticeDate ?? null,
      termination_reason: input.terminationReason ?? null,
      auto_renew_enabled:
        input.autoRenewEnabled ?? (input.bindingMonths ?? 0) > 0,
      auto_renew_term_months:
        input.autoRenewTermMonths ?? input.bindingMonths ?? null,
      override_reason: input.overrideReason ?? null,
      updated_by: input.actorUserId ?? null,
    })
    .eq("id", input.id)
    .eq("customer_id", input.customerId)
    .eq("company_id", input.companyId ?? null)
    .select("*")
    .single();

  if (error) throw error;
  return data as CustomerContractRow;
}

export async function addCustomerContractEvent(input: {
  companyId?: string | null;
  customerContractId: string;
  customerId: string;
  eventType: CustomerContractEventType;
  happenedAt?: string | null;
  note?: string | null;
  metadata?: Record<string, unknown> | null;
  actorUserId?: string | null;
}): Promise<CustomerContractEventRow> {
  const eventPayload = {
    company_id: input.companyId ?? null,
    customer_contract_id: input.customerContractId,
    customer_id: input.customerId,
    event_type: input.eventType,
    happened_at: input.happenedAt ?? new Date().toISOString(),
    note: input.note ?? null,
    metadata: input.metadata ?? null,
    actor_user_id: input.actorUserId ?? null,
  };

  const { data, error } = await supabaseService
    .from("customer_contract_events")
    .insert(eventPayload)
    .select("*")
    .single();

  if (error) throw error;

  // Contract status side effects always stay inside the event's tenant scope
  // when the caller knows the company.
  const scopedContractUpdate = (patch: Record<string, unknown>) => {
    let query = supabaseService
      .from("customer_contracts")
      .update(patch)
      .eq("id", input.customerContractId);
    if (input.companyId) query = query.eq("company_id", input.companyId);
    return query;
  };

  if (input.eventType === "signed" || input.eventType === "activated") {
    const patch =
      input.eventType === "activated"
        ? {
            status: "active",
            updated_by: input.actorUserId ?? null,
          }
        : {
            status: "signed",
            signed_at: eventPayload.happened_at,
            updated_by: input.actorUserId ?? null,
          };

    const { error: updateError } = await scopedContractUpdate(patch);

    if (updateError) throw updateError;
  }

  if (input.eventType === "terminated" || input.eventType === "cancelled") {
    const { error: updateError } = await scopedContractUpdate({
      status: input.eventType === "terminated" ? "terminated" : "cancelled",
      updated_by: input.actorUserId ?? null,
    });

    if (updateError) throw updateError;
  }

  if (input.eventType === "termination_notice_received") {
    let currentQuery = supabaseService
      .from("customer_contracts")
      .select(
        "starts_at, ends_at, binding_months, notice_months, status, auto_renew_enabled, auto_renew_term_months, termination_reason",
      )
      .eq("id", input.customerContractId);
    if (input.companyId)
      currentQuery = currentQuery.eq("company_id", input.companyId);

    const { data: current, error: currentError } =
      await currentQuery.maybeSingle();

    if (currentError) throw currentError;

    const { error: updateError } = await scopedContractUpdate({
      termination_notice_date: eventPayload.happened_at,
      ends_at: deriveContractEndsAt({
        startsAt: current?.starts_at ?? null,
        endsAt: current?.ends_at ?? null,
        bindingMonths: current?.binding_months ?? null,
        noticeMonths: current?.notice_months ?? null,
        terminationNoticeDate: eventPayload.happened_at,
        terminationReason: current?.termination_reason ?? null,
        autoRenewEnabled: current?.auto_renew_enabled ?? null,
        autoRenewTermMonths: current?.auto_renew_term_months ?? null,
        status: current?.status ?? null,
      }),
      updated_by: input.actorUserId ?? null,
    });

    if (updateError) throw updateError;
  }

  return data as CustomerContractEventRow;
}
