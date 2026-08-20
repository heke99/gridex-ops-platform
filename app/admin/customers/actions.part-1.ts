// Extracted from actions.ts; keep public imports on the facade module.

import { createHash } from "node:crypto"
import { createSupabaseServerClient } from "@/lib/supabase/server"

import { supabaseService } from "@/lib/supabase/service"



import { normalizeCustomerIdentityType } from "@/lib/customers/normalizeCustomerType"



import type { IntakeField, IntakeFieldErrors, IntakeFormValues } from "./actionState"

import type { ContractType, GreenFeeMode } from "@/lib/customer-contracts/types"

import type { SupplierSwitchRequestType } from "@/lib/operations/types"
import { isValidEmailAddress, isValidFacilityId, isValidMeterPointId, isValidSwedishOrganizationNumber, isValidSwedishPersonalNumber, isValidSwedishPhoneNumber, isValidSwedishPostalCode } from "@/lib/validation/customerFields"




export type CustomerType = "private" | "business" | "association";

export type SiteType = "consumption" | "production" | "mixed";

export type PriceAreaCode = "SE1" | "SE2" | "SE3" | "SE4";

export type DuplicateResolution =
  | "create_new_pending_review"
  | "create_separate_confirmed"
  | "add_site_to_existing"
  | "add_contract_to_existing"
  | "update_existing";

export type BillingLevel = "customer" | "contract" | "site" | "metering_point";

export type IntakeCreateMode = "create" | "create_blocked";

export type PostCreateAction = "open_customer" | "request_data" | "create_new";

export type PostCreateRequestTarget = "grid_owner" | "current_supplier" | "both";

export type ContractStatus =
  | "draft"
  | "pending_signature"
  | "signed"
  | "active"
  | "terminated"
  | "cancelled"
  | "expired";

export type CreateCustomerGraphParams = {
  actorUserId: string;
  companyId: string;
  customerType: CustomerType;
  intakeFlowType: SupplierSwitchRequestType | null;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  contactTitle: string | null;
  email: string | null;
  phone: string | null;
  personalNumber: string | null;
  orgNumber: string | null;
  apartmentNumber: string | null;
  siteName: string | null;
  facilityId: string | null;
  meterPointId: string | null;
  siteType: SiteType;
  gridOwnerId: string | null;
  priceAreaCode: PriceAreaCode | null;
  gridAreaCode: string | null;
  moveInDate: string | null;
  annualConsumptionKwh: number | null;
  currentSupplierId: string | null;
  currentSupplierName: string | null;
  currentSupplierOrgNumber: string | null;
  currentSupplierUnknown: boolean;
  customerConfirmationStatus: string | null;
  authorizationStatus: string | null;
  authorizationValidFrom: string | null;
  authorizationValidTo: string | null;
  expectedStartDate: string | null;
  confirmedStartDate: string | null;
  actualStartDate: string | null;
  startDateSource: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  careOf: string | null;
  country: string | null;
  movedFromStreet: string | null;
  movedFromPostalCode: string | null;
  movedFromCity: string | null;
  movedFromSupplierName: string | null;
  contractOfferId: string | null;
  contractStartDate: string | null;
  contractStatus: ContractStatus | null;
  overrideReason: string | null;
  contractTypeOverride: ContractType | null;
  fixedPriceOrePerKwh: number | null;
  spotMarkupOrePerKwh: number | null;
  variableFeeOrePerKwh: number | null;
  monthlyFeeSek: number | null;
  invoiceFeeSek: number | null;
  startFeeSek: number | null;
  adminFeeSek: number | null;
  breakFeeSek: number | null;
  greenFeeMode: GreenFeeMode | null;
  greenFeeValue: number | null;
  bindingMonths: number | null;
  noticeMonths: number | null;
  optionalFeeLines: Array<Record<string, unknown>>;
  duplicateResolution: DuplicateResolution;
  existingCustomerId: string | null;
  duplicateOverrideReason: string | null;
  invoiceRecipient: string | null;
  invoiceEmail: string | null;
  invoiceReference: string | null;
  billingStreet: string | null;
  billingPostalCode: string | null;
  billingCity: string | null;
  billingCountry: string | null;
  billingAddressSameAsSite: boolean;
  billingLevel: BillingLevel;
  consolidatedInvoice: boolean;
  intakeCreateMode: IntakeCreateMode;
  signedAgreementFile: File | null;
  signedPowerOfAttorneyFile: File | null;
  gridInvoiceFile: File | null;
  postCreateAction: PostCreateAction;
  postCreateRequestTarget: PostCreateRequestTarget;
};

export class IntakeValidationError extends Error {
  fieldErrors: IntakeFieldErrors;

  constructor(message: string, fieldErrors: IntakeFieldErrors) {
    super(message);
    this.name = "IntakeValidationError";
    this.fieldErrors = fieldErrors;
  }
}

export const INTAKE_VALUE_FIELDS: IntakeField[] = [
  "customerType",
  "intakeFlowType",
  "firstName",
  "lastName",
  "companyName",
  "contactTitle",
  "email",
  "phone",
  "personalNumber",
  "orgNumber",
  "apartmentNumber",
  "siteName",
  "facilityId",
  "meterPointId",
  "siteType",
  "gridOwnerId",
  "newGridOwnerName",
  "newGridOwnerOrgNumber",
  "newGridOwnerEdielId",
  "newGridOwnerEmail",
  "newGridOwnerPhone",
  "priceAreaCode",
  "gridAreaCode",
  "moveInDate",
  "annualConsumptionKwh",
  "currentSupplierId",
  "currentSupplierName",
  "currentSupplierOrgNumber",
  "currentSupplierUnknown",
  "newCurrentSupplierName",
  "newCurrentSupplierOrgNumber",
  "newCurrentSupplierEdielId",
  "newCurrentSupplierSwitchingEmail",
  "newCurrentSupplierContractEmail",
  "newCurrentSupplierCustomerServiceEmail",
  "newCurrentSupplierPhone",
  "customerConfirmationStatus",
  "authorizationStatus",
  "authorizationValidFrom",
  "authorizationValidTo",
  "expectedStartDate",
  "confirmedStartDate",
  "actualStartDate",
  "startDateSource",
  "street",
  "postalCode",
  "city",
  "careOf",
  "country",
  "movedFromStreet",
  "movedFromPostalCode",
  "movedFromCity",
  "movedFromSupplierName",
  "contractOfferId",
  "contractStartDate",
  "contractStatus",
  "overrideReason",
  "contractTypeOverride",
  "fixedPriceOrePerKwh",
  "spotMarkupOrePerKwh",
  "variableFeeOrePerKwh",
  "monthlyFeeSek",
  "invoiceFeeSek",
  "startFeeSek",
  "adminFeeSek",
  "breakFeeSek",
  "greenFeeMode",
  "greenFeeValue",
  "bindingMonths",
  "noticeMonths",
  "optionalFeeLines",
  "duplicateResolution",
  "existingCustomerId",
  "duplicateOverrideReason",
  "invoiceRecipient",
  "invoiceEmail",
  "invoiceReference",
  "billingStreet",
  "billingPostalCode",
  "billingCity",
  "billingCountry",
  "billingAddressSameAsSite",
  "billingLevel",
  "consolidatedInvoice",
  "postCreateAction",
  "postCreateRequestTarget",
];

export function getFormValues(formData: FormData): IntakeFormValues {
  const values: IntakeFormValues = { country: "SE" };

  for (const field of INTAKE_VALUE_FIELDS) {
    const rawValue = formData.get(field);
    if (typeof rawValue === "string") {
      values[field] = rawValue;
    }
  }

  if (!values.country?.trim()) {
    values.country = "SE";
  }

  return values;
}

export function isSwedishIdentityNumber(value: string | null | undefined): boolean {
  return isValidSwedishPersonalNumber(value);
}

export function isSwedishOrgNumber(value: string | null | undefined): boolean {
  return isValidSwedishOrganizationNumber(value);
}

export function isSwedishPhone(value: string | null | undefined): boolean {
  return isValidSwedishPhoneNumber(value);
}

export function isSwedishPostalCode(value: string | null | undefined): boolean {
  return isValidSwedishPostalCode(value);
}

export function getString(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export function getNullableString(formData: FormData, key: string): string | null {
  const value = getString(formData, key);
  return value || null;
}

export function parseNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseIntOrNull(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseContractType(value: string): ContractType {
  switch (value) {
    case "fixed":
    case "variable_monthly":
    case "variable_hourly":
    case "variable_quarterly":
    case "portfolio":
      return value;
    default:
      return "variable_hourly";
  }
}

export function parseGreenFeeMode(value: string): GreenFeeMode {
  switch (value) {
    case "sek_month":
    case "ore_per_kwh":
      return value;
    default:
      return "none";
  }
}

export function parseOptionalFeeLines(value: string): Array<Record<string, unknown>> {
  const trimmed = value.trim();
  if (!trimmed) return [];

  return trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [label, amountRaw, unitRaw] = line
        .split("|")
        .map((part) => part.trim());
      const amount = amountRaw ? Number(amountRaw.replace(",", ".")) : null;

      return {
        label: label || "",
        amount: Number.isFinite(amount ?? NaN) ? amount : null,
        unit: unitRaw || "sek",
      };
    });
}

export function normalizeIntakeCreateMode(
  value: string | null | undefined,
): IntakeCreateMode {
  return value === "create_blocked" ? "create_blocked" : "create";
}

export function normalizePostCreateAction(
  value: string | null | undefined,
): PostCreateAction {
  if (value === "request_data") return "request_data";
  if (value === "create_new") return "create_new";
  return "open_customer";
}

export function normalizePostCreateRequestTarget(
  value: string | null | undefined,
): PostCreateRequestTarget {
  if (value === "grid_owner") return "grid_owner";
  if (value === "current_supplier") return "current_supplier";
  return "both";
}

export function getFileValue(formData: FormData, key: string): File | null {
  const value = formData.get(key);
  if (!(value instanceof File) || value.size <= 0) return null;
  return value;
}

export function sanitizeFileName(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "") || "document"
  );
}

export function buildCustomerDocumentPath(params: {
  customerId: string;
  siteId: string | null;
  documentType: "power_of_attorney" | "complete_agreement" | "grid_invoice_suggested";
  fileName: string;
}): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const scope = params.siteId ? `site-${params.siteId}` : "customer";
  return `${params.customerId}/${scope}/${params.documentType}/${stamp}_${sanitizeFileName(params.fileName)}`;
}

export async function checksumFile(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  return createHash("sha256").update(buffer).digest("hex");
}

export function normalizeDuplicateResolution(
  value: string | null | undefined,
): DuplicateResolution {
  switch (value) {
    case "create_separate_confirmed":
    case "add_site_to_existing":
    case "add_contract_to_existing":
    case "update_existing":
      return value;
    default:
      return "create_new_pending_review";
  }
}

export function normalizeBillingLevel(value: string | null | undefined): BillingLevel {
  switch (value) {
    case "contract":
    case "site":
    case "metering_point":
      return value;
    default:
      return "customer";
  }
}

export function formDataFlag(formData: FormData, key: string): boolean {
  const value = formData.get(key);
  return value === "on" || value === "true" || value === "1";
}

export function normalizeCustomerType(value: string | null | undefined): CustomerType {
  // Shared alias-aware normalization so CSV imports that send aliases such as
  // "company"/"organisation"/"consumer" map to the correct identity instead of
  // silently collapsing every non-"business" value to "private".
  return normalizeCustomerIdentityType(value);
}

export function normalizeIntakeFlowType(
  value: string | null | undefined,
): SupplierSwitchRequestType | null {
  if (value === "move_in") return "move_in";
  if (value === "move_out_takeover") return "move_out_takeover";
  if (value === "switch") return "switch";
  return null;
}

export function normalizeOptionalString(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function normalizeCountryCode(value: string | null | undefined): string {
  const normalized = value?.trim();
  if (!normalized) return "SE";

  const lower = normalized.toLowerCase();
  if (lower === "sweden" || lower === "sverige") return "SE";

  return normalized.toUpperCase();
}

export function normalizeInlineCreateChoice(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalString(value);
  if (!normalized || normalized === "__new__" || normalized === "__unknown__") return null;
  return normalized;
}

export async function resolveOrCreateGridOwnerForIntake(params: {
  formData: FormData;
  companyId: string;
  actorUserId: string;
  selectedGridOwnerId: string | null;
}): Promise<{ gridOwnerId: string | null; warnings: string[] }> {
  const selectedGridOwnerId = normalizeInlineCreateChoice(params.selectedGridOwnerId);
  const blockedFreeText = [
    "newGridOwnerName",
    "newGridOwnerOrgNumber",
    "newGridOwnerEdielId",
    "newGridOwnerEmail",
    "newGridOwnerPhone",
  ]
    .map((field) => normalizeOptionalString(getString(params.formData, field)))
    .filter(Boolean);

  const warnings: string[] = [];
  if (blockedFreeText.length > 0 || params.selectedGridOwnerId === "__new__") {
    warnings.push(
      "Nätägare kan inte skapas från kundintaget. Välj verifierad nätägare från registret eller skicka ärendet till superadmin/importflödet.",
    );
  }

  if (!selectedGridOwnerId) {
    return { gridOwnerId: null, warnings };
  }

  const { data, error } = await supabaseService
    .from("grid_owners")
    .select("id,name,is_active,lifecycle_status,verified_for_customer_flow,actor_registry_status,ediel_id")
    .eq("id", selectedGridOwnerId)
    .maybeSingle();

  if (error) throw error;
  if (!data?.id) {
    return {
      gridOwnerId: null,
      warnings: [
        ...warnings,
        "Vald nätägare kunde inte hittas i verifierad masterdata. Kund sparas utan nätägare och leverantörsbyte blockeras.",
      ],
    };
  }

  const row = data as {
    id: string;
    name?: string | null;
    is_active?: boolean | null;
    lifecycle_status?: string | null;
    verified_for_customer_flow?: boolean | null;
    actor_registry_status?: string | null;
    ediel_id?: string | null;
  };
  const verified =
    row.is_active === true &&
    row.lifecycle_status !== "blocked" &&
    row.verified_for_customer_flow === true &&
    row.actor_registry_status === "verified" &&
    Boolean(row.ediel_id);

  if (!verified) {
    return {
      gridOwnerId: null,
      warnings: [
        ...warnings,
        `Nätägaren ${row.name ?? selectedGridOwnerId} är inte verifierad för kundflödet. Superadmin måste verifiera aktör, Ediel-ID och route innan den får användas.`,
      ],
    };
  }

  return { gridOwnerId: row.id, warnings };
}

export async function resolveOrCreateCurrentSupplierForIntake(params: {
  formData: FormData;
  companyId: string;
  actorUserId: string;
  selectedSupplierId: string | null;
  currentSupplierName: string | null;
  currentSupplierOrgNumber: string | null;
  unknown: boolean;
}): Promise<{ supplierId: string | null; name: string | null; orgNumber: string | null; warnings: string[] }> {
  if (params.unknown || params.selectedSupplierId === "__unknown__") {
    return {
      supplierId: null,
      name: "Okänd nuvarande leverantör",
      orgNumber: null,
      warnings: [
        "Nuvarande leverantör är okänd. Kund kan sparas, men byte och uppsägning får inte autoskickas innan uppgiften är verifierad.",
      ],
    };
  }

  const selectedSupplierId = normalizeInlineCreateChoice(params.selectedSupplierId);
  const blockedFreeText = [
    "newCurrentSupplierName",
    "newCurrentSupplierOrgNumber",
    "newCurrentSupplierEdielId",
    "newCurrentSupplierSwitchingEmail",
    "newCurrentSupplierContractEmail",
    "newCurrentSupplierCustomerServiceEmail",
    "newCurrentSupplierPhone",
  ]
    .map((field) => normalizeOptionalString(getString(params.formData, field)))
    .filter(Boolean);

  const warnings: string[] = [];
  if (blockedFreeText.length > 0 || params.selectedSupplierId === "__new__") {
    warnings.push(
      "Elleverantör kan inte skapas från kundintaget. Fritext sparas bara som kundens uppgift och superadmin måste verifiera aktören i registret.",
    );
  }

  if (!selectedSupplierId) {
    return {
      supplierId: null,
      name: params.currentSupplierName,
      orgNumber: params.currentSupplierOrgNumber,
      warnings: params.currentSupplierName
        ? [
            ...warnings,
            "Nuvarande leverantör är angiven som fritext och används inte som verifierad marknadsaktör.",
          ]
        : warnings,
    };
  }

  const { data, error } = await supabaseService
    .from("electricity_suppliers")
    .select("id,name,org_number,is_active,verified_for_customer_flow,actor_registry_status,ediel_id")
    .eq("id", selectedSupplierId)
    .maybeSingle();

  if (error) throw error;
  if (!data?.id) {
    return {
      supplierId: null,
      name: params.currentSupplierName,
      orgNumber: params.currentSupplierOrgNumber,
      warnings: [
        ...warnings,
        "Vald elleverantör kunde inte hittas i verifierad masterdata. Kund sparas utan verifierad nuvarande leverantör.",
      ],
    };
  }

  const row = data as {
    id: string;
    name?: string | null;
    org_number?: string | null;
    is_active?: boolean | null;
    verified_for_customer_flow?: boolean | null;
    actor_registry_status?: string | null;
    ediel_id?: string | null;
  };
  const verified =
    row.is_active === true &&
    row.verified_for_customer_flow === true &&
    row.actor_registry_status === "verified";

  if (!verified) {
    return {
      supplierId: null,
      name: row.name ?? params.currentSupplierName,
      orgNumber: row.org_number ?? params.currentSupplierOrgNumber,
      warnings: [
        ...warnings,
        `Elleverantören ${row.name ?? selectedSupplierId} är inte verifierad för kundflödet. Uppgiften sparas som kundinformation men används inte som Ediel-/marknadsidentitet.`,
      ],
    };
  }

  return {
    supplierId: row.id,
    name: row.name ?? params.currentSupplierName,
    orgNumber: row.org_number ?? params.currentSupplierOrgNumber,
    warnings,
  };
}

export function isIsoDate(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function isEmail(value: string | null | undefined): boolean {
  return isValidEmailAddress(value);
}

export function validateCreateCustomerParams(
  params: CreateCustomerGraphParams,
): IntakeFieldErrors {
  const errors: IntakeFieldErrors = {};

  const normalizedCountry = normalizeCountryCode(params.country);
  const normalizedBillingCountry = normalizeCountryCode(params.billingCountry);
  const annualConsumptionKwh = params.annualConsumptionKwh ?? null;
  const bindingMonths = params.bindingMonths ?? null;
  const noticeMonths = params.noticeMonths ?? null;
  const fixedPriceOrePerKwh = params.fixedPriceOrePerKwh ?? null;
  const spotMarkupOrePerKwh = params.spotMarkupOrePerKwh ?? null;
  const variableFeeOrePerKwh = params.variableFeeOrePerKwh ?? null;
  const monthlyFeeSek = params.monthlyFeeSek ?? null;
  const invoiceFeeSek = params.invoiceFeeSek ?? null;
  const startFeeSek = params.startFeeSek ?? null;
  const adminFeeSek = params.adminFeeSek ?? null;
  const breakFeeSek = params.breakFeeSek ?? null;
  const greenFeeValue = params.greenFeeValue ?? null;

  const hasAnyCustomerSignal = Boolean(
    normalizeOptionalString(params.firstName) ||
    normalizeOptionalString(params.lastName) ||
    normalizeOptionalString(params.companyName) ||
    normalizeOptionalString(params.email) ||
    normalizeOptionalString(params.phone) ||
    normalizeOptionalString(params.personalNumber) ||
    normalizeOptionalString(params.orgNumber),
  );

  if (!hasAnyCustomerSignal) {
    errors.firstName =
      "Ange minst namn, bolagsnamn, e-post, telefon, personnummer eller organisationsnummer.";
  }

  if (
    normalizeOptionalString(params.personalNumber) &&
    !isSwedishIdentityNumber(params.personalNumber)
  ) {
    errors.personalNumber =
      "Personnummer ska vara ett giltigt svenskt personnummer med kontrollsiffra.";
  }

  if (
    normalizeOptionalString(params.orgNumber) &&
    !isSwedishOrgNumber(params.orgNumber)
  ) {
    errors.orgNumber =
      "Organisationsnummer ska vara ett giltigt svenskt organisationsnummer med kontrollsiffra.";
  }

  if (
    normalizeOptionalString(params.facilityId) &&
    !isValidFacilityId(params.facilityId)
  ) {
    errors.facilityId =
      "Anläggnings-id får bara innehålla bokstäver, siffror och bindestreck.";
  }

  if (
    normalizeOptionalString(params.meterPointId) &&
    !isValidMeterPointId(params.meterPointId)
  ) {
    errors.meterPointId =
      "Mätpunkts-id får bara innehålla bokstäver, siffror och bindestreck.";
  }

  if (!isEmail(params.email)) {
    errors.email = "E-postadressen har ogiltigt format.";
  }

  if (!isEmail(params.invoiceEmail)) {
    errors.invoiceEmail = "Faktura-e-post har ogiltigt format.";
  }

  if (!isSwedishPhone(params.phone)) {
    errors.phone =
      "Telefonnummer ska vara ett svenskt nummer, till exempel 0701234567 eller +46701234567.";
  }

  if (!isSwedishPostalCode(params.postalCode)) {
    errors.postalCode = "Postnummer ska anges som 12345 eller 123 45.";
  }

  if (!isSwedishPostalCode(params.billingPostalCode)) {
    errors.billingPostalCode =
      "Fakturapostnummer ska anges som 12345 eller 123 45.";
  }

  for (const [field, value, label] of [
    ["moveInDate", params.moveInDate, "Önskat startdatum"],
    [
      "authorizationValidFrom",
      params.authorizationValidFrom,
      "Fullmakt giltig från",
    ],
    [
      "authorizationValidTo",
      params.authorizationValidTo,
      "Fullmakt giltig till",
    ],
    ["expectedStartDate", params.expectedStartDate, "Förväntat startdatum"],
    ["confirmedStartDate", params.confirmedStartDate, "Bekräftat startdatum"],
    ["actualStartDate", params.actualStartDate, "Faktiskt startdatum"],
    ["contractStartDate", params.contractStartDate, "Avtalsstart"],
  ] as Array<[IntakeField, string | null, string]>) {
    if (normalizeOptionalString(value) && !isIsoDate(value)) {
      errors[field] = `${label} måste anges som YYYY-MM-DD.`;
    }
  }

  if (normalizedCountry.length !== 2) {
    errors.country = "Land ska sparas som ISO-kod, till exempel SE.";
  }

  if (normalizedBillingCountry.length !== 2) {
    errors.billingCountry =
      "Fakturaland ska sparas som ISO-kod, till exempel SE.";
  }

  if (annualConsumptionKwh !== null && annualConsumptionKwh < 0) {
    errors.annualConsumptionKwh = "Årsförbrukning kan inte vara negativ.";
  }

  if (bindingMonths !== null && bindingMonths < 0) {
    errors.bindingMonths = "Bindningstid kan inte vara negativ.";
  }

  if (noticeMonths !== null && noticeMonths < 0) {
    errors.noticeMonths = "Uppsägningstid kan inte vara negativ.";
  }

  for (const [field, value, label] of [
    ["fixedPriceOrePerKwh", fixedPriceOrePerKwh, "Fast pris"],
    ["spotMarkupOrePerKwh", spotMarkupOrePerKwh, "Spotpåslag"],
    ["variableFeeOrePerKwh", variableFeeOrePerKwh, "Rörlig avgift"],
    ["monthlyFeeSek", monthlyFeeSek, "Månadsavgift"],
    ["invoiceFeeSek", invoiceFeeSek, "Fakturaavgift"],
    ["startFeeSek", startFeeSek, "Startavgift"],
    ["adminFeeSek", adminFeeSek, "Administrationsavgift"],
    ["breakFeeSek", breakFeeSek, "Brytavgift"],
    ["greenFeeValue", greenFeeValue, "Grön el-avgift"],
  ] as Array<[IntakeField, number | null, string]>) {
    if (value !== null && value < 0) {
      errors[field] = `${label} kan inte vara negativ.`;
    }
  }

  return errors;
}

export function createValidationErrorFromFieldErrors(
  fieldErrors: IntakeFieldErrors,
): IntakeValidationError {
  const message =
    Object.values(fieldErrors).find((value): value is string =>
      Boolean(value),
    ) ?? "Valideringen misslyckades.";

  return new IntakeValidationError(message, fieldErrors);
}

export function buildCreateCustomerParams(
  formData: FormData,
  actorUserId: string,
  companyId: string,
): CreateCustomerGraphParams {
  return {
    actorUserId,
    companyId,
    customerType: normalizeCustomerType(
      getString(formData, "customerType") || "private",
    ),
    intakeFlowType: normalizeIntakeFlowType(
      getNullableString(formData, "intakeFlowType"),
    ),
    firstName: getNullableString(formData, "firstName"),
    lastName: getNullableString(formData, "lastName"),
    companyName: getNullableString(formData, "companyName"),
    contactTitle: getNullableString(formData, "contactTitle"),
    email: getNullableString(formData, "email"),
    phone: getNullableString(formData, "phone"),
    personalNumber: getNullableString(formData, "personalNumber"),
    orgNumber: getNullableString(formData, "orgNumber"),
    apartmentNumber: getNullableString(formData, "apartmentNumber"),
    siteName: getNullableString(formData, "siteName"),
    facilityId: getNullableString(formData, "facilityId"),
    meterPointId: getNullableString(formData, "meterPointId"),
    siteType: (getString(formData, "siteType") || "consumption") as SiteType,
    gridOwnerId: getNullableString(formData, "gridOwnerId"),
    priceAreaCode: getNullableString(
      formData,
      "priceAreaCode",
    ) as PriceAreaCode | null,
    gridAreaCode: getNullableString(formData, "gridAreaCode"),
    moveInDate: getNullableString(formData, "moveInDate"),
    annualConsumptionKwh: parseNumber(
      getString(formData, "annualConsumptionKwh"),
    ),
    currentSupplierId: getNullableString(formData, "currentSupplierId"),
    currentSupplierName: getNullableString(formData, "currentSupplierName"),
    currentSupplierOrgNumber: getNullableString(
      formData,
      "currentSupplierOrgNumber",
    ),
    currentSupplierUnknown: formDataFlag(formData, "currentSupplierUnknown") || getString(formData, "currentSupplierId") === "__unknown__",
    customerConfirmationStatus: getNullableString(
      formData,
      "customerConfirmationStatus",
    ),
    authorizationStatus: getNullableString(formData, "authorizationStatus"),
    authorizationValidFrom: getNullableString(
      formData,
      "authorizationValidFrom",
    ),
    authorizationValidTo: getNullableString(formData, "authorizationValidTo"),
    expectedStartDate: getNullableString(formData, "expectedStartDate"),
    confirmedStartDate: getNullableString(formData, "confirmedStartDate"),
    actualStartDate: getNullableString(formData, "actualStartDate"),
    startDateSource: getNullableString(formData, "startDateSource"),
    street: getNullableString(formData, "street"),
    postalCode: getNullableString(formData, "postalCode"),
    city: getNullableString(formData, "city"),
    careOf: getNullableString(formData, "careOf"),
    country: getNullableString(formData, "country"),
    movedFromStreet: getNullableString(formData, "movedFromStreet"),
    movedFromPostalCode: getNullableString(formData, "movedFromPostalCode"),
    movedFromCity: getNullableString(formData, "movedFromCity"),
    movedFromSupplierName: getNullableString(formData, "movedFromSupplierName"),
    contractOfferId: getNullableString(formData, "contractOfferId"),
    contractStartDate: getNullableString(formData, "contractStartDate"),
    contractStatus: getNullableString(
      formData,
      "contractStatus",
    ) as ContractStatus | null,
    overrideReason: getNullableString(formData, "overrideReason"),
    contractTypeOverride: getString(formData, "contractTypeOverride")
      ? parseContractType(getString(formData, "contractTypeOverride"))
      : null,
    fixedPriceOrePerKwh: parseNumber(
      getString(formData, "fixedPriceOrePerKwh"),
    ),
    spotMarkupOrePerKwh: parseNumber(
      getString(formData, "spotMarkupOrePerKwh"),
    ),
    variableFeeOrePerKwh: parseNumber(
      getString(formData, "variableFeeOrePerKwh"),
    ),
    monthlyFeeSek: parseNumber(getString(formData, "monthlyFeeSek")),
    invoiceFeeSek: parseNumber(getString(formData, "invoiceFeeSek")),
    startFeeSek: parseNumber(getString(formData, "startFeeSek")),
    adminFeeSek: parseNumber(getString(formData, "adminFeeSek")),
    breakFeeSek: parseNumber(getString(formData, "breakFeeSek")),
    greenFeeMode: getString(formData, "greenFeeMode")
      ? parseGreenFeeMode(getString(formData, "greenFeeMode"))
      : null,
    greenFeeValue: parseNumber(getString(formData, "greenFeeValue")),
    bindingMonths: parseIntOrNull(getString(formData, "bindingMonths")),
    noticeMonths: parseIntOrNull(getString(formData, "noticeMonths")),
    optionalFeeLines: parseOptionalFeeLines(
      getString(formData, "optionalFeeLines"),
    ),
    duplicateResolution: normalizeDuplicateResolution(
      getNullableString(formData, "duplicateResolution"),
    ),
    existingCustomerId: getNullableString(formData, "existingCustomerId"),
    duplicateOverrideReason: getNullableString(
      formData,
      "duplicateOverrideReason",
    ),
    invoiceRecipient: getNullableString(formData, "invoiceRecipient"),
    invoiceEmail: getNullableString(formData, "invoiceEmail"),
    invoiceReference: getNullableString(formData, "invoiceReference"),
    billingStreet: getNullableString(formData, "billingStreet"),
    billingPostalCode: getNullableString(formData, "billingPostalCode"),
    billingCity: getNullableString(formData, "billingCity"),
    billingCountry: getNullableString(formData, "billingCountry"),
    billingAddressSameAsSite: formDataFlag(
      formData,
      "billingAddressSameAsSite",
    ),
    billingLevel: normalizeBillingLevel(
      getNullableString(formData, "billingLevel"),
    ),
    consolidatedInvoice: formDataFlag(formData, "consolidatedInvoice"),
    intakeCreateMode: normalizeIntakeCreateMode(
      getNullableString(formData, "intakeCreateMode"),
    ),
    signedAgreementFile: getFileValue(formData, "signedAgreementFile"),
    signedPowerOfAttorneyFile: getFileValue(
      formData,
      "signedPowerOfAttorneyFile",
    ),
    gridInvoiceFile: getFileValue(formData, "gridInvoiceFile"),
    postCreateAction: normalizePostCreateAction(
      getNullableString(formData, "postCreateActionOverride") ??
        getNullableString(formData, "postCreateAction"),
    ),
    postCreateRequestTarget: normalizePostCreateRequestTarget(
      getNullableString(formData, "postCreateRequestTarget"),
    ),
  };
}

export async function getActorUserId(): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Unauthorized");
  return user.id;
}

export async function insertAuditLog(params: {
  actorUserId: string;
  companyId?: string | null;
  entityType: string;
  entityId: string;
  action: string;
  newValues?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}) {
  const { data, error } = await supabaseService
    .from("audit_logs")
    .insert({
      actor_user_id: params.actorUserId,
      entity_type: params.entityType,
      entity_id: params.entityId,
      action: params.action,
      new_values: params.newValues ?? null,
      metadata: params.metadata ?? null,
      company_id: params.companyId ?? null,
    })
    .select("id")
    .single();

  if (error) throw error;
  return data;
}

export function buildBillingAddressSnapshot(params: CreateCustomerGraphParams) {
  const billingStreet = params.billingAddressSameAsSite
    ? normalizeOptionalString(params.street)
    : normalizeOptionalString(params.billingStreet);
  const billingPostalCode = params.billingAddressSameAsSite
    ? normalizeOptionalString(params.postalCode)
    : normalizeOptionalString(params.billingPostalCode);
  const billingCity = params.billingAddressSameAsSite
    ? normalizeOptionalString(params.city)
    : normalizeOptionalString(params.billingCity);
  const billingCountry = params.billingAddressSameAsSite
    ? normalizeCountryCode(params.country)
    : normalizeCountryCode(params.billingCountry);

  return {
    recipient: normalizeOptionalString(params.invoiceRecipient),
    email: normalizeOptionalString(params.invoiceEmail),
    reference: normalizeOptionalString(params.invoiceReference),
    street: billingStreet,
    postalCode: billingPostalCode,
    city: billingCity,
    country: billingCountry,
    sameAsSite: params.billingAddressSameAsSite,
    billingLevel: params.billingLevel,
    consolidatedInvoice: params.consolidatedInvoice,
  };
}

export type IntakeDocumentUploadResult = {
  uploadedDocumentIds: string[];
  powerOfAttorneyId: string | null;
  uploadedLabels: string[];
};
