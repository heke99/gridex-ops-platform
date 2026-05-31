"use server";

import { revalidatePath } from "next/cache";
import { createHash } from "node:crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  requireAdminActionAccess,
  requireCompanyScopedActionAccess,
} from "@/lib/admin/guards";
import { supabaseService } from "@/lib/supabase/service";
import { requireOperationalCompanyId } from "@/lib/tenant/scope";
import { requireCompanyOperationalForWrites } from "@/lib/tenant/governance";
import { runBatch2BAutomation } from "@/lib/operations/batch2bAutomation";
import { parseCustomerImportFormData } from "@/lib/customers/importParser";
import type {
  CustomerImportActionState,
  CustomerImportPreviewRow,
  CustomerImportPreviewRowStatus,
  IntakeActionState,
  IntakeField,
  IntakeFieldErrors,
  IntakeFormValues,
} from "./actionState";
import {
  addCustomerContractEvent,
  createCustomerContract,
  getContractOfferById,
} from "@/lib/customer-contracts/db";
import type {
  ContractType,
  GreenFeeMode,
} from "@/lib/customer-contracts/types";
import {
  createSupplierSwitchRequest,
  findCustomerSiteById,
  listMeteringPointsForSite,
  listPowersOfAttorneyByCustomerId,
  saveCustomerAuthorizationDocument,
  savePowerOfAttorney,
  syncCustomerOperationsForSite,
} from "@/lib/operations/db";
import type { SupplierSwitchRequestType } from "@/lib/operations/types";
import {
  isValidEmailAddress,
  isValidFacilityId,
  isValidMeterPointId,
  isValidSwedishOrganizationNumber,
  isValidSwedishPersonalNumber,
  isValidSwedishPhoneNumber,
  isValidSwedishPostalCode,
} from "@/lib/validation/customerFields";
import { emitDomainEvent } from "@/lib/events/domainEvents";
import { enqueueWebhookDeliveriesForEvent } from "@/lib/integrations/webhooks";

type CustomerType = "private" | "business" | "association";
type SiteType = "consumption" | "production" | "mixed";
type PriceAreaCode = "SE1" | "SE2" | "SE3" | "SE4";
type DuplicateResolution =
  | "create_new_pending_review"
  | "create_separate_confirmed"
  | "add_site_to_existing"
  | "add_contract_to_existing"
  | "update_existing";

type BillingLevel = "customer" | "contract" | "site" | "metering_point";
type IntakeCreateMode = "create" | "create_blocked";
type PostCreateAction = "open_customer" | "request_data" | "create_new";
type PostCreateRequestTarget = "grid_owner" | "current_supplier" | "both";

type ContractStatus =
  | "draft"
  | "pending_signature"
  | "signed"
  | "active"
  | "terminated"
  | "cancelled"
  | "expired";

type CreateCustomerGraphParams = {
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
  postCreateAction: PostCreateAction;
  postCreateRequestTarget: PostCreateRequestTarget;
};

type CreationContext = {
  customerId: string | null;
  contactId: string | null;
  addressId: string | null;
  siteId: string | null;
  meteringPointId: string | null;
  contractId: string | null;
  switchRequestId: string | null;
  powerOfAttorneyId: string | null;
  documentIds: string[];
};

class IntakeValidationError extends Error {
  fieldErrors: IntakeFieldErrors;

  constructor(message: string, fieldErrors: IntakeFieldErrors) {
    super(message);
    this.name = "IntakeValidationError";
    this.fieldErrors = fieldErrors;
  }
}

const INTAKE_VALUE_FIELDS: IntakeField[] = [
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

function getFormValues(formData: FormData): IntakeFormValues {
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

function isSwedishIdentityNumber(value: string | null | undefined): boolean {
  return isValidSwedishPersonalNumber(value);
}

function isSwedishOrgNumber(value: string | null | undefined): boolean {
  return isValidSwedishOrganizationNumber(value);
}

function isSwedishPhone(value: string | null | undefined): boolean {
  return isValidSwedishPhoneNumber(value);
}

function isSwedishPostalCode(value: string | null | undefined): boolean {
  return isValidSwedishPostalCode(value);
}

function getString(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function getNullableString(formData: FormData, key: string): string | null {
  const value = getString(formData, key);
  return value || null;
}

function parseNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseIntOrNull(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseContractType(value: string): ContractType {
  switch (value) {
    case "fixed":
    case "variable_monthly":
    case "variable_hourly":
    case "portfolio":
      return value;
    default:
      return "variable_hourly";
  }
}

function parseGreenFeeMode(value: string): GreenFeeMode {
  switch (value) {
    case "sek_month":
    case "ore_per_kwh":
      return value;
    default:
      return "none";
  }
}

function parseOptionalFeeLines(value: string): Array<Record<string, unknown>> {
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

function normalizeIntakeCreateMode(
  value: string | null | undefined,
): IntakeCreateMode {
  return value === "create_blocked" ? "create_blocked" : "create";
}

function normalizePostCreateAction(
  value: string | null | undefined,
): PostCreateAction {
  if (value === "request_data") return "request_data";
  if (value === "create_new") return "create_new";
  return "open_customer";
}

function normalizePostCreateRequestTarget(
  value: string | null | undefined,
): PostCreateRequestTarget {
  if (value === "grid_owner") return "grid_owner";
  if (value === "current_supplier") return "current_supplier";
  return "both";
}

function getFileValue(formData: FormData, key: string): File | null {
  const value = formData.get(key);
  if (!(value instanceof File) || value.size <= 0) return null;
  return value;
}

function sanitizeFileName(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "") || "document"
  );
}

function buildCustomerDocumentPath(params: {
  customerId: string;
  siteId: string | null;
  documentType: "power_of_attorney" | "complete_agreement";
  fileName: string;
}): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const scope = params.siteId ? `site-${params.siteId}` : "customer";
  return `${params.customerId}/${scope}/${params.documentType}/${stamp}_${sanitizeFileName(params.fileName)}`;
}

async function checksumFile(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  return createHash("sha256").update(buffer).digest("hex");
}

function normalizeDuplicateResolution(
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

function normalizeBillingLevel(value: string | null | undefined): BillingLevel {
  switch (value) {
    case "contract":
    case "site":
    case "metering_point":
      return value;
    default:
      return "customer";
  }
}

function formDataFlag(formData: FormData, key: string): boolean {
  const value = formData.get(key);
  return value === "on" || value === "true" || value === "1";
}

function normalizeCustomerType(value: string | null | undefined): CustomerType {
  if (value === "business") return "business";
  if (value === "association") return "association";
  return "private";
}

function normalizeIntakeFlowType(
  value: string | null | undefined,
): SupplierSwitchRequestType | null {
  if (value === "move_in") return "move_in";
  if (value === "move_out_takeover") return "move_out_takeover";
  if (value === "switch") return "switch";
  return null;
}

function normalizeOptionalString(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeCountryCode(value: string | null | undefined): string {
  const normalized = value?.trim();
  if (!normalized) return "SE";

  const lower = normalized.toLowerCase();
  if (lower === "sweden" || lower === "sverige") return "SE";

  return normalized.toUpperCase();
}


function normalizeInlineCreateChoice(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalString(value);
  if (!normalized || normalized === "__new__" || normalized === "__unknown__") return null;
  return normalized;
}

function normalizeComparable(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalString(value);
  return normalized ? normalized.toLowerCase().replace(/\s+/g, " ") : null;
}

async function resolveOrCreateGridOwnerForIntake(params: {
  formData: FormData;
  companyId: string;
  actorUserId: string;
  selectedGridOwnerId: string | null;
}): Promise<{ gridOwnerId: string | null; warnings: string[] }> {
  const selectedGridOwnerId = normalizeInlineCreateChoice(params.selectedGridOwnerId);
  const newName = normalizeOptionalString(getString(params.formData, "newGridOwnerName"));
  const newOrgNumber = normalizeOptionalString(getString(params.formData, "newGridOwnerOrgNumber"));
  const newEdielId = normalizeOptionalString(getString(params.formData, "newGridOwnerEdielId"));
  const newEmail = normalizeOptionalString(getString(params.formData, "newGridOwnerEmail"));
  const newPhone = normalizeOptionalString(getString(params.formData, "newGridOwnerPhone"));

  if (selectedGridOwnerId || !newName) {
    return { gridOwnerId: selectedGridOwnerId, warnings: [] };
  }

  const { data: rows, error } = await supabaseService
    .from("grid_owners")
    .select("id,name,org_number,ediel_id")
    .or(`company_id.is.null,company_id.eq.${params.companyId}`)
    .limit(500);

  if (error) throw error;

  const nameKey = normalizeComparable(newName);
  const orgKey = normalizeComparable(newOrgNumber);
  const edielKey = normalizeComparable(newEdielId);
  const matches = ((rows ?? []) as Array<Record<string, unknown>>).filter((row) => {
    const rowName = normalizeComparable(String(row.name ?? ""));
    const rowOrg = normalizeComparable(String(row.org_number ?? ""));
    const rowEdiel = normalizeComparable(String(row.ediel_id ?? ""));
    return Boolean(
      (edielKey && rowEdiel === edielKey) ||
        (orgKey && rowOrg === orgKey) ||
        (nameKey && rowName === nameKey),
    );
  });

  if (matches[0]?.id) {
    return {
      gridOwnerId: String(matches[0].id),
      warnings: [`Möjlig dubblett på nätägare hittades. Befintlig nätägare används: ${String(matches[0].name ?? matches[0].id)}.`],
    };
  }

  const { data: created, error: insertError } = await supabaseService
    .from("grid_owners")
    .insert({
      company_id: params.companyId,
      name: newName,
      owner_code: newEdielId ?? newOrgNumber ?? newName.slice(0, 24),
      ediel_id: newEdielId,
      org_number: newOrgNumber,
      email: newEmail,
      phone: newPhone,
      country: "SE",
      notes: "Skapad direkt från kundintag. Kontrollera route och nätägaravtal innan Ediel-utskick.",
      is_active: true,
      created_by: params.actorUserId,
      updated_by: params.actorUserId,
    })
    .select("id")
    .single();

  if (insertError) throw insertError;
  return { gridOwnerId: String(created.id), warnings: [`Ny nätägare skapades från kundintag: ${newName}.`] };
}

async function resolveOrCreateCurrentSupplierForIntake(params: {
  formData: FormData;
  companyId: string;
  actorUserId: string;
  selectedSupplierId: string | null;
  currentSupplierName: string | null;
  currentSupplierOrgNumber: string | null;
  unknown: boolean;
}): Promise<{ supplierId: string | null; name: string | null; orgNumber: string | null; warnings: string[] }> {
  if (params.unknown) {
    return {
      supplierId: null,
      name: "Okänd nuvarande leverantör",
      orgNumber: null,
      warnings: ["Nuvarande leverantör markerades som okänd. Kommersiella uppgifter behöver kontrolleras innan säkert byte."],
    };
  }

  const selectedSupplierId = normalizeInlineCreateChoice(params.selectedSupplierId);
  if (selectedSupplierId) {
    const { data, error } = await supabaseService
      .from("electricity_suppliers")
      .select("id,name,org_number")
      .eq("id", selectedSupplierId)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      return {
        supplierId: String(data.id),
        name: String(data.name ?? params.currentSupplierName ?? ""),
        orgNumber: typeof data.org_number === "string" ? data.org_number : params.currentSupplierOrgNumber,
        warnings: [],
      };
    }
  }

  const newName = normalizeOptionalString(getString(params.formData, "newCurrentSupplierName")) ?? params.currentSupplierName;
  const newOrgNumber = normalizeOptionalString(getString(params.formData, "newCurrentSupplierOrgNumber")) ?? params.currentSupplierOrgNumber;
  const newEdielId = normalizeOptionalString(getString(params.formData, "newCurrentSupplierEdielId"));
  const switchingEmail = normalizeOptionalString(getString(params.formData, "newCurrentSupplierSwitchingEmail"));
  const contractEmail = normalizeOptionalString(getString(params.formData, "newCurrentSupplierContractEmail"));
  const customerServiceEmail = normalizeOptionalString(getString(params.formData, "newCurrentSupplierCustomerServiceEmail"));
  const newPhone = normalizeOptionalString(getString(params.formData, "newCurrentSupplierPhone"));

  if (!newName) {
    return { supplierId: null, name: params.currentSupplierName, orgNumber: params.currentSupplierOrgNumber, warnings: [] };
  }

  const { data: rows, error } = await supabaseService
    .from("electricity_suppliers")
    .select("id,name,org_number,ediel_id")
    .or(`company_id.is.null,company_id.eq.${params.companyId}`)
    .limit(500);
  if (error) throw error;

  const nameKey = normalizeComparable(newName);
  const orgKey = normalizeComparable(newOrgNumber);
  const edielKey = normalizeComparable(newEdielId);
  const matches = ((rows ?? []) as Array<Record<string, unknown>>).filter((row) => {
    const rowName = normalizeComparable(String(row.name ?? ""));
    const rowOrg = normalizeComparable(String(row.org_number ?? ""));
    const rowEdiel = normalizeComparable(String(row.ediel_id ?? ""));
    return Boolean(
      (edielKey && rowEdiel === edielKey) ||
        (orgKey && rowOrg === orgKey) ||
        (nameKey && rowName === nameKey),
    );
  });

  if (matches[0]?.id) {
    return {
      supplierId: String(matches[0].id),
      name: String(matches[0].name ?? newName),
      orgNumber: typeof matches[0].org_number === "string" ? String(matches[0].org_number) : newOrgNumber,
      warnings: [`Möjlig dubblett på leverantör hittades. Befintlig leverantör används: ${String(matches[0].name ?? matches[0].id)}.`],
    };
  }

  const email = switchingEmail ?? contractEmail ?? customerServiceEmail;
  const { data: created, error: insertError } = await supabaseService
    .from("electricity_suppliers")
    .insert({
      company_id: params.companyId,
      name: newName,
      org_number: newOrgNumber,
      ediel_id: newEdielId,
      email,
      switching_email: switchingEmail,
      contract_email: contractEmail,
      customer_service_email: customerServiceEmail,
      phone: newPhone,
      notes: "Skapad direkt från kundintag. Mail till nuvarande leverantör får endast användas för informationshämtning, inte för att starta byte.",
      is_active: true,
      created_by: params.actorUserId,
      updated_by: params.actorUserId,
    })
    .select("id")
    .single();
  if (insertError) throw insertError;

  return { supplierId: String(created.id), name: newName, orgNumber: newOrgNumber, warnings: [`Ny nuvarande leverantör skapades från kundintag: ${newName}.`] };
}

function isIsoDate(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isEmail(value: string | null | undefined): boolean {
  return isValidEmailAddress(value);
}

function validateCreateCustomerParams(
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
    ["greenFeeValue", greenFeeValue, "Grön el-avgift"],
  ] as Array<[IntakeField, number | null, string]>) {
    if (value !== null && value < 0) {
      errors[field] = `${label} kan inte vara negativ.`;
    }
  }

  return errors;
}

function createValidationErrorFromFieldErrors(
  fieldErrors: IntakeFieldErrors,
): IntakeValidationError {
  const message =
    Object.values(fieldErrors).find((value): value is string =>
      Boolean(value),
    ) ?? "Valideringen misslyckades.";

  return new IntakeValidationError(message, fieldErrors);
}

function buildCreateCustomerParams(
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
    postCreateAction: normalizePostCreateAction(
      getNullableString(formData, "postCreateActionOverride") ??
        getNullableString(formData, "postCreateAction"),
    ),
    postCreateRequestTarget: normalizePostCreateRequestTarget(
      getNullableString(formData, "postCreateRequestTarget"),
    ),
  };
}

async function getActorUserId(): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Unauthorized");
  return user.id;
}

async function insertAuditLog(params: {
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

async function createPrimaryContact(params: {
  customerId: string;
  customerType: CustomerType;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  companyId: string;
}) {
  const personName =
    `${params.firstName ?? ""} ${params.lastName ?? ""}`.trim() || null;

  const name =
    params.customerType === "private"
      ? personName
      : personName || (params.companyName ?? "").trim() || null;

  if (!name && !params.email && !params.phone) {
    return null;
  }

  const { data, error } = await supabaseService
    .from("customer_contacts")
    .insert({
      company_id: params.companyId,
      customer_id: params.customerId,
      type: "primary",
      name,
      email: params.email ?? null,
      phone: params.phone ?? null,
      title: params.title ?? null,
      is_primary: true,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

async function createFacilityAddress(params: {
  customerId: string;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  careOf: string | null;
  moveInDate: string | null;
  country: string | null;
  companyId: string;
}) {
  if (!params.street && !params.postalCode && !params.city) {
    return null;
  }

  const { data, error } = await supabaseService
    .from("customer_addresses")
    .insert({
      company_id: params.companyId,
      customer_id: params.customerId,
      type: "facility",
      street_1: params.street ?? "",
      street_2: params.careOf ?? null,
      postal_code: params.postalCode ?? null,
      city: params.city ?? null,
      country: normalizeCountryCode(params.country),
      municipality: null,
      moved_in_at: params.moveInDate ?? null,
      moved_out_at: null,
      is_active: true,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

function buildBillingAddressSnapshot(params: CreateCustomerGraphParams) {
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

async function createBillingAddressFromIntake(params: {
  companyId: string;
  customerId: string;
  billing: ReturnType<typeof buildBillingAddressSnapshot>;
}) {
  const hasAddress = Boolean(
    params.billing.street ||
    params.billing.postalCode ||
    params.billing.city ||
    params.billing.recipient ||
    params.billing.email ||
    params.billing.reference,
  );

  if (!hasAddress) return null;

  const { data, error } = await supabaseService
    .from("customer_addresses")
    .insert({
      company_id: params.companyId,
      customer_id: params.customerId,
      type: "billing",
      recipient_name: params.billing.recipient,
      invoice_email: params.billing.email,
      invoice_reference: params.billing.reference,
      street_1: params.billing.street ?? "",
      postal_code: params.billing.postalCode,
      city: params.billing.city,
      country: params.billing.country,
      is_active: true,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "42703") return null;
    throw error;
  }

  return data;
}

async function updateCustomerBillingSettings(params: {
  companyId: string;
  customerId: string;
  billing: ReturnType<typeof buildBillingAddressSnapshot>;
}) {
  try {
    const { error } = await supabaseService
      .from("customers")
      .update({
        invoice_recipient: params.billing.recipient,
        invoice_email: params.billing.email,
        invoice_reference: params.billing.reference,
        billing_street: params.billing.street,
        billing_postal_code: params.billing.postalCode,
        billing_city: params.billing.city,
        billing_country: params.billing.country,
        billing_address_same_as_site: params.billing.sameAsSite,
        billing_level: params.billing.billingLevel,
        consolidated_invoice: params.billing.consolidatedInvoice,
      })
      .eq("company_id", params.companyId)
      .eq("id", params.customerId);

    if (error && !databaseObjectMissing(error) && error.code !== "42703")
      throw error;
  } catch (error) {
    if (!databaseObjectMissing(error)) {
      console.warn("Customer billing settings could not be updated", error);
    }
  }
}

async function logDuplicateResolutionEvent(params: {
  companyId: string;
  actorUserId: string;
  customerId: string;
  existingCustomerId?: string | null;
  duplicateMatches: IntakeDuplicateMatch[];
  resolution: DuplicateResolution;
  reason?: string | null;
}) {
  if (
    params.duplicateMatches.length === 0 &&
    params.resolution === "create_new_pending_review"
  )
    return;

  try {
    await supabaseService.from("customer_duplicate_resolution_events").insert({
      company_id: params.companyId,
      customer_id: params.customerId,
      existing_customer_id: params.existingCustomerId ?? null,
      resolution: params.resolution,
      reason: params.reason ?? null,
      match_payload: params.duplicateMatches,
      created_by: params.actorUserId,
    });
  } catch (error) {
    if (!databaseObjectMissing(error)) {
      console.warn("Duplicate resolution event could not be logged", error);
    }
  }

  await insertAuditLog({
    actorUserId: params.actorUserId,
    companyId: params.companyId,
    entityType: "customer_duplicate_resolution",
    entityId: params.customerId,
    action: "customer_duplicate_resolution_recorded",
    newValues: {
      resolution: params.resolution,
      existingCustomerId: params.existingCustomerId ?? null,
      duplicateMatches: params.duplicateMatches,
    },
    metadata: {
      reason: params.reason ?? null,
    },
  }).catch((error) =>
    console.warn("Duplicate resolution audit could not be logged", error),
  );
}

async function createDuplicateReviewCase(params: {
  companyId: string;
  actorUserId: string;
  customerId: string;
  siteId: string | null;
  meteringPointId: string | null;
  duplicateMatches: IntakeDuplicateMatch[];
}) {
  if (params.duplicateMatches.length === 0) return;

  const critical = params.duplicateMatches.some(
    (match) => match.severity === "critical",
  );
  const description = duplicateWarningsFromMatches(
    params.duplicateMatches,
  ).join("\n");

  try {
    await supabaseService.from("customer_cases").insert({
      company_id: params.companyId,
      customer_id: params.customerId,
      site_id: params.siteId,
      metering_point_id: params.meteringPointId,
      case_type: "technical_blocker",
      status: "action_required",
      priority: critical ? "high" : "normal",
      title: critical
        ? "Kritisk dubblettkontroll krävs"
        : "Möjlig dubblett behöver granskas",
      description,
      reason_category: "possible_duplicate",
      billing_blocked: critical,
      billing_manual_review: true,
      source: "customer_intake_duplicate_check",
      next_action:
        "Granska matchningen och välj om kunden ska kopplas till befintlig kund, behållas separat eller kompletteras med ny anläggning/avtal.",
      metadata: { duplicateMatches: params.duplicateMatches },
      created_by: params.actorUserId,
      updated_by: params.actorUserId,
    });
  } catch (error) {
    if (!databaseObjectMissing(error)) {
      console.warn("Duplicate review case could not be created", error);
    }
  }
}

async function syncContractLifecycleEvents(params: {
  companyId: string;
  customerId: string;
  contractId: string;
  contractStatus: ContractStatus | null;
  contractStartDate: string | null;
  actorUserId: string;
}) {
  const happenedAt = params.contractStartDate ?? null;

  if (params.contractStatus === "pending_signature") {
    await addCustomerContractEvent({
      companyId: params.companyId,
      customerContractId: params.contractId,
      customerId: params.customerId,
      eventType: "signature_requested",
      happenedAt,
      note: "Avtal satt till väntar signering i intake-flödet",
      actorUserId: params.actorUserId,
    });
    return;
  }

  if (params.contractStatus === "signed") {
    await addCustomerContractEvent({
      companyId: params.companyId,
      customerContractId: params.contractId,
      customerId: params.customerId,
      eventType: "signed",
      happenedAt,
      note: "Avtal markerat som signerat i intake-flödet",
      actorUserId: params.actorUserId,
    });
    return;
  }

  if (params.contractStatus === "active") {
    await addCustomerContractEvent({
      companyId: params.companyId,
      customerContractId: params.contractId,
      customerId: params.customerId,
      eventType: "signed",
      happenedAt,
      note: "Avtal markerat som signerat i intake-flödet",
      actorUserId: params.actorUserId,
    });

    await addCustomerContractEvent({
      companyId: params.companyId,
      customerContractId: params.contractId,
      customerId: params.customerId,
      eventType: "activated",
      happenedAt,
      note: "Avtal markerat som aktivt i intake-flödet",
      actorUserId: params.actorUserId,
    });
    return;
  }

  if (params.contractStatus === "terminated") {
    await addCustomerContractEvent({
      companyId: params.companyId,
      customerContractId: params.contractId,
      customerId: params.customerId,
      eventType: "terminated",
      happenedAt,
      note: "Avtal markerat som avslutat i intake-flödet",
      actorUserId: params.actorUserId,
    });
    return;
  }

  if (params.contractStatus === "cancelled") {
    await addCustomerContractEvent({
      companyId: params.companyId,
      customerContractId: params.contractId,
      customerId: params.customerId,
      eventType: "cancelled",
      happenedAt,
      note: "Avtal markerat som avbrutet i intake-flödet",
      actorUserId: params.actorUserId,
    });
  }
}

async function maybeCreatePowerOfAttorneyFromIntake(params: {
  companyId: string;
  actorUserId: string;
  customerId: string;
  siteId: string | null;
  status: string | null;
  validFrom: string | null;
  validTo: string | null;
}) {
  const normalizedStatus =
    params.status === "signed" ||
    params.status === "sent" ||
    params.status === "expired" ||
    params.status === "revoked"
      ? params.status
      : params.status === "missing"
        ? null
        : "draft";

  if (!normalizedStatus) return null;

  try {
    const { data, error } = await supabaseService
      .from("powers_of_attorney")
      .insert({
        company_id: params.companyId,
        customer_id: params.customerId,
        site_id: params.siteId,
        scope: "supplier_switch",
        status: normalizedStatus,
        signed_at:
          normalizedStatus === "signed" ? new Date().toISOString() : null,
        valid_from: params.validFrom,
        valid_to: params.validTo,
        document_path: null,
        reference: `INTAKE-${params.customerId.slice(0, 8)}`,
        notes:
          "Skapad från kundintag. Dokument kan kompletteras på kundkortet.",
        created_by: params.actorUserId,
        updated_by: params.actorUserId,
      })
      .select("id")
      .maybeSingle();

    if (error) {
      if (!databaseObjectMissing(error) && error.code !== "42703") {
        console.warn(
          "Power of attorney from intake could not be created",
          error,
        );
      }
      return null;
    }

    return data?.id ?? null;
  } catch (error) {
    if (!databaseObjectMissing(error)) {
      console.warn("Power of attorney from intake could not be created", error);
    }
    return null;
  }
}

type IntakeDocumentUploadResult = {
  uploadedDocumentIds: string[];
  powerOfAttorneyId: string | null;
  uploadedLabels: string[];
};

async function uploadCustomerIntakeDocuments(params: {
  companyId: string;
  actorUserId: string;
  customerId: string;
  siteId: string | null;
  meteringPointId: string | null;
  contractId: string | null;
  signedAgreementFile: File | null;
  signedPowerOfAttorneyFile: File | null;
  authorizationValidFrom: string | null;
  authorizationValidTo: string | null;
}): Promise<IntakeDocumentUploadResult> {
  const result: IntakeDocumentUploadResult = {
    uploadedDocumentIds: [],
    powerOfAttorneyId: null,
    uploadedLabels: [],
  };

  if (!params.signedAgreementFile && !params.signedPowerOfAttorneyFile) {
    return result;
  }

  const supabase = await createSupabaseServerClient();
  const bucket = "customer-documents";

  async function uploadFile(
    file: File,
    documentType: "power_of_attorney" | "complete_agreement",
  ) {
    const filePath = buildCustomerDocumentPath({
      customerId: params.customerId,
      siteId: params.siteId,
      documentType,
      fileName: file.name || "document.pdf",
    });

    const uploadResult = await supabaseService.storage
      .from(bucket)
      .upload(filePath, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });

    if (uploadResult.error) throw uploadResult.error;

    return {
      filePath,
      checksum: await checksumFile(file),
    };
  }

  if (params.signedPowerOfAttorneyFile) {
    const uploaded = await uploadFile(
      params.signedPowerOfAttorneyFile,
      "power_of_attorney",
    );

    const poa = await savePowerOfAttorney(supabase, {
      companyId: params.companyId,
      customer_id: params.customerId,
      site_id: params.siteId,
      scope: "supplier_switch",
      status: "signed",
      signed_at: new Date().toISOString(),
      valid_from: params.authorizationValidFrom,
      valid_to: params.authorizationValidTo,
      document_path: uploaded.filePath,
      reference: `INTAKE-POA-${params.customerId.slice(0, 8)}`,
      notes:
        "Signerad fullmakt uppladdad direkt i kundintaget. Fullmakten kan användas för uppgiftsbegäran när övrig data är komplett.",
    });

    result.powerOfAttorneyId = poa.id;

    const document = await saveCustomerAuthorizationDocument(supabase, {
      companyId: params.companyId,
      customer_id: params.customerId,
      site_id: params.siteId,
      metering_point_id: params.meteringPointId,
      customer_contract_id: params.contractId,
      power_of_attorney_id: poa.id,
      document_type: "power_of_attorney",
      status: "active",
      title: "Signerad fullmakt från kundintag",
      file_name: params.signedPowerOfAttorneyFile.name || null,
      mime_type: params.signedPowerOfAttorneyFile.type || null,
      file_size_bytes: params.signedPowerOfAttorneyFile.size || null,
      storage_bucket: bucket,
      file_path: uploaded.filePath,
      file_checksum: uploaded.checksum,
      reference: poa.reference,
      notes: "Uppladdad vid kundskapande.",
      metadata: {
        source: "customer_intake",
        documentRole: "signed_power_of_attorney",
      },
    });

    result.uploadedDocumentIds.push(document.id);
    result.uploadedLabels.push("signerad fullmakt");

    await insertAuditLog({
      actorUserId: params.actorUserId,
      companyId: params.companyId,
      entityType: "customer_authorization_document",
      entityId: document.id,
      action: "customer_intake_document_uploaded",
      newValues: document as unknown as Record<string, unknown>,
      metadata: {
        customerId: params.customerId,
        siteId: params.siteId,
        meteringPointId: params.meteringPointId,
        contractId: params.contractId,
        linkedPowerOfAttorneyId: poa.id,
        documentType: "power_of_attorney",
      },
    });
  }

  if (params.signedAgreementFile) {
    const uploaded = await uploadFile(
      params.signedAgreementFile,
      "complete_agreement",
    );

    const document = await saveCustomerAuthorizationDocument(supabase, {
      companyId: params.companyId,
      customer_id: params.customerId,
      site_id: params.siteId,
      metering_point_id: params.meteringPointId,
      customer_contract_id: params.contractId,
      document_type: "complete_agreement",
      status: "active",
      title: "Signerat avtal från kundintag",
      file_name: params.signedAgreementFile.name || null,
      mime_type: params.signedAgreementFile.type || null,
      file_size_bytes: params.signedAgreementFile.size || null,
      storage_bucket: bucket,
      file_path: uploaded.filePath,
      file_checksum: uploaded.checksum,
      reference: params.contractId
        ? `CONTRACT-${params.contractId.slice(0, 8)}`
        : null,
      notes: "Uppladdat vid kundskapande.",
      metadata: {
        source: "customer_intake",
        documentRole: "signed_agreement",
      },
    });

    result.uploadedDocumentIds.push(document.id);
    result.uploadedLabels.push("signerat avtal");

    await insertAuditLog({
      actorUserId: params.actorUserId,
      companyId: params.companyId,
      entityType: "customer_authorization_document",
      entityId: document.id,
      action: "customer_intake_document_uploaded",
      newValues: document as unknown as Record<string, unknown>,
      metadata: {
        customerId: params.customerId,
        siteId: params.siteId,
        meteringPointId: params.meteringPointId,
        contractId: params.contractId,
        documentType: "complete_agreement",
      },
    });
  }

  return result;
}

async function maybeCreateSwitchRequestFromIntake(params: {
  customerId: string;
  siteId: string | null;
  intakeFlowType: SupplierSwitchRequestType | null;
}) {
  if (!params.customerId || !params.siteId || !params.intakeFlowType) {
    return null;
  }

  const supabase = await createSupabaseServerClient();

  const readiness = await syncCustomerOperationsForSite(supabase, {
    customerId: params.customerId,
    siteId: params.siteId,
  });

  const site = await findCustomerSiteById(supabase, params.siteId);
  if (!site) {
    return null;
  }

  const [meteringPoints, powersOfAttorney] = await Promise.all([
    listMeteringPointsForSite(supabase, params.siteId),
    listPowersOfAttorneyByCustomerId(supabase, params.customerId),
  ]);

  const candidateMeteringPoint =
    meteringPoints.find(
      (point) => point.id === readiness.candidateMeteringPointId,
    ) ??
    meteringPoints[0] ??
    null;

  const hasRelevantPoa = powersOfAttorney.some(
    (poa) =>
      poa.scope === "supplier_switch" &&
      poa.status === "signed" &&
      (poa.site_id === params.siteId || poa.site_id === null),
  );

  if (!candidateMeteringPoint) {
    return {
      created: false,
      reason: "Mätpunkt saknas",
      readiness,
    };
  }

  if (!hasRelevantPoa) {
    return {
      created: false,
      reason: "Fullmakt saknas",
      readiness,
    };
  }

  const request = await createSupplierSwitchRequest(supabase, {
    readiness,
    site,
    meteringPoint: candidateMeteringPoint,
    requestType: params.intakeFlowType,
    requestedStartDate: site.move_in_date ?? null,
  });

  return {
    created: true,
    requestId: request.id,
    requestType: request.request_type,
    readiness,
  };
}

async function cleanupCreatedGraph(context: CreationContext) {
  try {
    if (context.switchRequestId) {
      await supabaseService
        .from("supplier_switch_events")
        .delete()
        .eq("switch_request_id", context.switchRequestId);

      await supabaseService
        .from("supplier_switch_requests")
        .delete()
        .eq("id", context.switchRequestId);
    }

    if (context.documentIds.length > 0) {
      await supabaseService
        .from("customer_authorization_documents")
        .delete()
        .in("id", context.documentIds);
    }

    if (context.powerOfAttorneyId) {
      await supabaseService
        .from("powers_of_attorney")
        .delete()
        .eq("id", context.powerOfAttorneyId);
    }

    if (context.contractId) {
      await supabaseService
        .from("customer_contract_events")
        .delete()
        .eq("customer_contract_id", context.contractId);

      await supabaseService
        .from("customer_contracts")
        .delete()
        .eq("id", context.contractId);
    }

    if (context.meteringPointId) {
      await supabaseService
        .from("metering_points")
        .delete()
        .eq("id", context.meteringPointId);
    }

    if (context.siteId) {
      await supabaseService
        .from("customer_operation_tasks")
        .delete()
        .eq("site_id", context.siteId);

      await supabaseService
        .from("customer_sites")
        .delete()
        .eq("id", context.siteId);
    }

    if (context.addressId) {
      await supabaseService
        .from("customer_addresses")
        .delete()
        .eq("id", context.addressId);
    }

    if (context.contactId) {
      await supabaseService
        .from("customer_contacts")
        .delete()
        .eq("id", context.contactId);
    }

    if (context.customerId) {
      await supabaseService
        .from("customer_blockers")
        .delete()
        .eq("customer_id", context.customerId);

      await supabaseService
        .from("audit_logs")
        .delete()
        .eq("entity_type", "customer")
        .eq("entity_id", context.customerId);

      await supabaseService
        .from("customers")
        .delete()
        .eq("id", context.customerId);
    }
  } catch (cleanupError) {
    console.error("Customer intake rollback failed", cleanupError);
  }
}

function databaseObjectMissing(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null;
  return Boolean(
    maybe &&
    (maybe.code === "42P01" ||
      maybe.code === "42703" ||
      maybe.code === "PGRST205" ||
      /does not exist|schema cache|relation .* does not exist/i.test(
        maybe.message ?? "",
      )),
  );
}

type IntakeDuplicateSeverity = "info" | "warning" | "critical";

type IntakeDuplicateMatch = {
  field: IntakeField | "customer" | "site" | "meteringPoint";
  severity: IntakeDuplicateSeverity;
  customerId: string | null;
  siteId?: string | null;
  meteringPointId?: string | null;
  matchType: string;
  message: string;
};

async function findMatchingCustomersByColumn(params: {
  companyId: string;
  column: string;
  value: string | null;
  severity: IntakeDuplicateSeverity;
  field: IntakeDuplicateMatch["field"];
  label: string;
  fuzzy?: boolean;
}): Promise<IntakeDuplicateMatch[]> {
  const normalized = normalizeOptionalString(params.value);
  if (!normalized) return [];

  try {
    let query = supabaseService
      .from("customers")
      .select("id, customer_number, full_name, company_name, email, phone")
      .eq("company_id", params.companyId)
      .limit(5);

    query = params.fuzzy
      ? query.ilike(params.column, `%${normalized}%`)
      : params.column === "email"
        ? query.ilike(params.column, normalized)
        : query.eq(params.column, normalized);

    const { data, error } = await query;
    if (error) {
      if (databaseObjectMissing(error) || error.code === "42703") return [];
      throw error;
    }

    return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      field: params.field,
      severity: params.severity,
      customerId: typeof row.id === "string" ? row.id : null,
      matchType: params.column,
      message: `${params.label} matchar kund ${String(row.customer_number ?? row.full_name ?? row.company_name ?? row.email ?? row.id)} i detta bolag.`,
    }));
  } catch (error) {
    if (databaseObjectMissing(error)) return [];
    throw error;
  }
}

async function findMatchingSites(params: {
  companyId: string;
  facilityId: string | null;
}): Promise<IntakeDuplicateMatch[]> {
  const facilityId = normalizeOptionalString(params.facilityId);
  if (!facilityId) return [];

  try {
    const { data, error } = await supabaseService
      .from("customer_sites")
      .select("id, customer_id, facility_id, site_name")
      .eq("company_id", params.companyId)
      .eq("facility_id", facilityId)
      .limit(5);

    if (error) {
      if (databaseObjectMissing(error) || error.code === "42703") return [];
      throw error;
    }

    return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      field: "facilityId",
      severity: "critical",
      customerId: typeof row.customer_id === "string" ? row.customer_id : null,
      siteId: typeof row.id === "string" ? row.id : null,
      matchType: "facility_id",
      message: `Anläggnings-id ${facilityId} finns redan i detta bolag och kräver manuell kontroll innan dubbel koppling används.`,
    }));
  } catch (error) {
    if (databaseObjectMissing(error)) return [];
    throw error;
  }
}

async function findMatchingMeteringPoints(params: {
  companyId: string;
  meterPointId: string | null;
}): Promise<IntakeDuplicateMatch[]> {
  const meterPointId = normalizeOptionalString(params.meterPointId);
  if (!meterPointId) return [];

  try {
    const { data, error } = await supabaseService
      .from("metering_points")
      .select("id, site_id, meter_point_id")
      .eq("company_id", params.companyId)
      .eq("meter_point_id", meterPointId)
      .limit(5);

    if (error) {
      if (databaseObjectMissing(error) || error.code === "42703") return [];
      throw error;
    }

    const siteIds = ((data ?? []) as Array<Record<string, unknown>>)
      .map((row) => (typeof row.site_id === "string" ? row.site_id : null))
      .filter((value): value is string => Boolean(value));
    const customerBySiteId = new Map<string, string | null>();

    if (siteIds.length > 0) {
      const { data: sites } = await supabaseService
        .from("customer_sites")
        .select("id, customer_id")
        .eq("company_id", params.companyId)
        .in("id", siteIds);
      for (const site of (sites ?? []) as Array<Record<string, unknown>>) {
        if (typeof site.id === "string") {
          customerBySiteId.set(
            site.id,
            typeof site.customer_id === "string" ? site.customer_id : null,
          );
        }
      }
    }

    return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      field: "meterPointId",
      severity: "critical",
      customerId:
        typeof row.site_id === "string"
          ? (customerBySiteId.get(row.site_id) ?? null)
          : null,
      siteId: typeof row.site_id === "string" ? row.site_id : null,
      meteringPointId: typeof row.id === "string" ? row.id : null,
      matchType: "meter_point_id",
      message: `Mätpunkts-id ${meterPointId} finns redan i detta bolag och kräver manuell kontroll innan dubbel koppling används.`,
    }));
  } catch (error) {
    if (databaseObjectMissing(error)) return [];
    throw error;
  }
}

async function findIntakeDuplicateMatches(
  params: CreateCustomerGraphParams,
): Promise<IntakeDuplicateMatch[]> {
  const personOrOrgMatches = await Promise.all([
    findMatchingCustomersByColumn({
      companyId: params.companyId,
      column: "email",
      value: params.email,
      severity: "warning",
      field: "email",
      label: "E-post",
    }),
    findMatchingCustomersByColumn({
      companyId: params.companyId,
      column: "phone",
      value: params.phone,
      severity: "warning",
      field: "phone",
      label: "Telefonnummer",
    }),
    findMatchingCustomersByColumn({
      companyId: params.companyId,
      column: "personal_number",
      value: params.personalNumber,
      severity: "critical",
      field: "personalNumber",
      label: "Personnummer",
    }),
    findMatchingCustomersByColumn({
      companyId: params.companyId,
      column: "org_number",
      value: params.orgNumber,
      severity: "critical",
      field: "orgNumber",
      label: "Organisationsnummer",
    }),
  ]);

  const nameMatches = await (async () => {
    const displayName =
      params.customerType === "private"
        ? `${params.firstName ?? ""} ${params.lastName ?? ""}`.trim()
        : normalizeOptionalString(params.companyName);
    if (!displayName || displayName.length < 4)
      return [] as IntakeDuplicateMatch[];
    return findMatchingCustomersByColumn({
      companyId: params.companyId,
      column: params.customerType === "private" ? "full_name" : "company_name",
      value: displayName,
      severity: "info",
      field: "customer",
      label: "Namn",
      fuzzy: true,
    });
  })();

  const siteMatches = await findMatchingSites({
    companyId: params.companyId,
    facilityId: params.facilityId,
  });
  const pointMatches = await findMatchingMeteringPoints({
    companyId: params.companyId,
    meterPointId: params.meterPointId,
  });

  const matches = [
    ...personOrOrgMatches.flat(),
    ...nameMatches,
    ...siteMatches,
    ...pointMatches,
  ];

  const unique = new Map<string, IntakeDuplicateMatch>();
  for (const match of matches) {
    const key = `${match.matchType}:${match.customerId ?? "none"}:${match.siteId ?? "none"}:${match.meteringPointId ?? "none"}`;
    if (!unique.has(key)) unique.set(key, match);
  }

  return Array.from(unique.values());
}

async function findIntakeDuplicates(
  params: CreateCustomerGraphParams,
): Promise<IntakeFieldErrors> {
  const errors: IntakeFieldErrors = {};
  const matches = await findIntakeDuplicateMatches(params);

  for (const match of matches) {
    if (
      match.field === "email" ||
      match.field === "phone" ||
      match.field === "personalNumber" ||
      match.field === "orgNumber" ||
      match.field === "facilityId" ||
      match.field === "meterPointId"
    ) {
      errors[match.field] = match.message;
    }
  }

  return errors;
}

async function loadExistingCustomerForIntake(params: {
  companyId: string;
  customerId: string | null;
}) {
  const id = normalizeOptionalString(params.customerId);
  if (!id) return null;

  const { data, error } = await supabaseService
    .from("customers")
    .select("*")
    .eq("company_id", params.companyId)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data as Record<string, unknown> | null;
}

async function updateExistingCustomerFromIntake(params: {
  companyId: string;
  customerId: string;
  actorUserId: string;
  intake: CreateCustomerGraphParams;
}) {
  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    updated_by: params.actorUserId,
  };

  const email = normalizeOptionalString(params.intake.email);
  const phone = normalizeOptionalString(params.intake.phone);
  const firstName = normalizeOptionalString(params.intake.firstName);
  const lastName = normalizeOptionalString(params.intake.lastName);
  const companyName = normalizeOptionalString(params.intake.companyName);

  if (email) payload.email = email;
  if (phone) payload.phone = phone;
  if (firstName) payload.first_name = firstName;
  if (lastName) payload.last_name = lastName;
  if (companyName) payload.company_name = companyName;
  if (firstName || lastName || companyName) {
    payload.full_name =
      companyName ?? (`${firstName ?? ""} ${lastName ?? ""}`.trim() || null);
  }

  try {
    const { error } = await supabaseService
      .from("customers")
      .update(payload)
      .eq("company_id", params.companyId)
      .eq("id", params.customerId);

    if (error && !databaseObjectMissing(error) && error.code !== "42703")
      throw error;
  } catch (error) {
    if (!databaseObjectMissing(error))
      console.warn("Existing customer could not be updated from intake", error);
  }
}

function duplicateWarningsFromMatches(
  matches: IntakeDuplicateMatch[],
): string[] {
  return Array.from(new Set(matches.map((match) => match.message)));
}

function buildMissingDataList(
  params: CreateCustomerGraphParams,
  switchRequestResult: unknown,
): string[] {
  const missing: string[] = [];

  if (!normalizeOptionalString(params.facilityId))
    missing.push("anläggnings-id");
  if (!normalizeOptionalString(params.meterPointId))
    missing.push("mätpunkts-id");
  if (!normalizeOptionalString(params.gridOwnerId)) missing.push("nätägare");
  if (!normalizeOptionalString(params.gridAreaCode)) missing.push("nätområde");
  if (!normalizeOptionalString(params.priceAreaCode)) missing.push("elområde");
  if (!normalizeOptionalString(params.currentSupplierName))
    missing.push("nuvarande elleverantör");
  if (
    !normalizeOptionalString(params.customerConfirmationStatus) ||
    params.customerConfirmationStatus !== "confirmed"
  ) {
    missing.push("kundbekräftelse");
  }

  const hasAnyStartDate = Boolean(
    normalizeOptionalString(params.contractStartDate) ||
    normalizeOptionalString(params.expectedStartDate) ||
    normalizeOptionalString(params.confirmedStartDate) ||
    normalizeOptionalString(params.actualStartDate) ||
    normalizeOptionalString(params.moveInDate),
  );

  if (!hasAnyStartDate) missing.push("förväntat avtalsstartdatum");

  if (params.intakeFlowType && params.authorizationStatus !== "signed") {
    missing.push(
      params.authorizationStatus === "sent"
        ? "fullmakt ej signerad"
        : "fullmakt saknas",
    );
  }

  const maybeSwitch = switchRequestResult as {
    created?: boolean;
    reason?: string;
  } | null;
  if (
    params.intakeFlowType &&
    maybeSwitch &&
    !maybeSwitch.created &&
    maybeSwitch.reason
  ) {
    missing.push(maybeSwitch.reason.toLowerCase());
  }

  return Array.from(new Set(missing));
}

function buildAddressWarnings(params: CreateCustomerGraphParams): string[] {
  const warnings: string[] = [];
  const addressParts = [params.street, params.postalCode, params.city].map(
    (value) => normalizeOptionalString(value),
  );
  const filledAddressParts = addressParts.filter(Boolean).length;

  if (filledAddressParts > 0 && filledAddressParts < 3) {
    warnings.push(
      "Anläggningsadressen är ofullständig. Kontrollera gata, postnummer och ort innan switch eller fakturering startas.",
    );
  }

  const currentAddress = [params.street, params.postalCode, params.city]
    .map((value) => normalizeOptionalString(value)?.toLowerCase() ?? "")
    .join("|");
  const movedFromAddress = [
    params.movedFromStreet,
    params.movedFromPostalCode,
    params.movedFromCity,
  ]
    .map((value) => normalizeOptionalString(value)?.toLowerCase() ?? "")
    .join("|");

  if (
    params.intakeFlowType !== "switch" &&
    currentAddress.replace(/\|/g, "") &&
    currentAddress === movedFromAddress
  ) {
    warnings.push(
      "Flyttadress och ny anläggningsadress verkar vara samma. Kontrollera adressen innan flödet skickas vidare.",
    );
  }

  return warnings;
}

type IntakeStatus =
  | "draft"
  | "incomplete"
  | "needs_completion"
  | "pending_information"
  | "pending_power_of_attorney"
  | "pending_duplicate_review"
  | "blocked"
  | "ready_for_contract"
  | "ready_for_operations";

function determineIntakeStatus(params: {
  intakeCreateMode: IntakeCreateMode;
  hasCoreIdentity: boolean;
  hasContact: boolean;
  missingData: string[];
  contractId: string | null;
  duplicateReviewRequired: boolean;
}): IntakeStatus {
  if (params.intakeCreateMode === "create_blocked") return "blocked";
  if (params.duplicateReviewRequired) return "pending_duplicate_review";
  if (!params.hasCoreIdentity || !params.hasContact) return "incomplete";
  if (params.missingData.some((value) => value.includes("fullmakt"))) {
    return "pending_power_of_attorney";
  }
  if (params.missingData.length > 0) return "pending_information";
  if (!params.contractId) return "ready_for_contract";
  return "ready_for_operations";
}

function calculateIntakeQualityScore(
  params: CreateCustomerGraphParams,
  missingData: string[],
): number {
  let score = 100;

  const importantValues = [
    params.firstName || params.companyName,
    params.lastName || params.orgNumber,
    params.email || params.phone,
    params.facilityId,
    params.meterPointId,
    params.gridOwnerId,
    params.contractOfferId || params.contractTypeOverride,
    params.contractStartDate,
  ];

  score -=
    importantValues.filter(
      (value) => !normalizeOptionalString(value as string | null | undefined),
    ).length * 8;
  score -= missingData.length * 6;

  return Math.max(0, Math.min(100, score));
}

async function updateCustomerIntakeQuality(params: {
  customerId: string;
  missingData: string[];
  qualityScore: number;
  intakeStatus: IntakeStatus;
  addressWarnings?: string[];
}) {
  try {
    const payload: Record<string, unknown> = {
      intake_status: params.intakeStatus,
      intake_missing_fields: params.missingData,
      intake_quality_score: params.qualityScore,
      intake_warnings: params.addressWarnings ?? [],
    };

    if (params.intakeStatus === "blocked") {
      payload.status = "blocked";
    }

    const { error } = await supabaseService
      .from("customers")
      .update(payload)
      .eq("id", params.customerId);

    if (error && !databaseObjectMissing(error) && error.code !== "42703") {
      console.warn("Customer intake quality could not be updated", error);
    }
  } catch (error) {
    if (!databaseObjectMissing(error)) {
      console.warn("Customer intake quality could not be updated", error);
    }
  }
}

async function createIntakeFollowUps(params: {
  companyId: string;
  actorUserId: string;
  customerId: string;
  siteId: string | null;
  meteringPointId: string | null;
  contractId: string | null;
  gridOwnerId: string | null;
  currentSupplierName: string | null;
  missingData: string[];
  addressWarnings?: string[];
}) {
  const warnings = params.addressWarnings ?? [];
  if (params.missingData.length === 0 && warnings.length === 0) return;

  const blockerReason =
    params.missingData.length > 0
      ? `Kundintag kräver komplettering: ${params.missingData.join(", ")}.`
      : `Kundintag kräver adresskontroll: ${warnings.join(" ")}`;
  const requestedCategories = params.missingData.map((value) => ({
    key: value,
  }));

  try {
    const { error: requestError } = await supabaseService
      .from("customer_info_requests")
      .insert({
        company_id: params.companyId,
        customer_id: params.customerId,
        site_id: params.siteId,
        metering_point_id: params.meteringPointId,
        request_type: "customer_intake_completion",
        target_party_type: params.gridOwnerId
          ? "grid_owner"
          : "customer_or_supplier",
        target_party_name: params.currentSupplierName,
        grid_owner_id: params.gridOwnerId,
        current_supplier_name: params.currentSupplierName,
        status: "manual_review_required",
        requested_data_categories: requestedCategories,
        blocker_reason: blockerReason,
        notes:
          "Automatiskt skapad från kundintag när obligatoriska driftuppgifter saknades.",
        created_by: params.actorUserId,
        updated_by: params.actorUserId,
      });

    if (requestError && !databaseObjectMissing(requestError)) {
      console.warn(
        "Customer intake info request could not be created",
        requestError,
      );
    }
  } catch (error) {
    if (!databaseObjectMissing(error)) {
      console.warn("Customer intake info request could not be created", error);
    }
  }

  try {
    const { data: createdCase, error: caseError } = await supabaseService
      .from("customer_cases")
      .insert({
        company_id: params.companyId,
        customer_id: params.customerId,
        site_id: params.siteId,
        metering_point_id: params.meteringPointId,
        customer_contract_id: params.contractId,
        case_type: params.missingData.some((value) =>
          value.includes("fullmakt"),
        )
          ? "missing_authorization"
          : "technical_blocker",
        status: "action_required",
        priority: params.missingData.some(
          (value) => value.includes("fullmakt") || value.includes("mätpunkt"),
        )
          ? "high"
          : "normal",
        title: "Kundintag kräver komplettering",
        description: blockerReason,
        reason_category: "customer_intake_missing_data",
        billing_blocked: params.missingData.some(
          (value) => value.includes("mätpunkt") || value.includes("startdatum"),
        ),
        billing_manual_review: true,
        source: "customer_intake",
        next_action:
          "Komplettera saknade uppgifter innan leverantörsbyte eller fakturering går vidare.",
        metadata: {
          missingData: params.missingData,
          addressWarnings: warnings,
          createdFrom: "createCustomerAction",
        },
        created_by: params.actorUserId,
        updated_by: params.actorUserId,
      })
      .select("id")
      .maybeSingle();

    if (caseError) {
      if (!databaseObjectMissing(caseError)) {
        console.warn("Customer intake case could not be created", caseError);
      }
      return;
    }

    if (createdCase?.id) {
      const { error: eventError } = await supabaseService
        .from("customer_case_events")
        .insert({
          company_id: params.companyId,
          customer_case_id: createdCase.id,
          customer_id: params.customerId,
          event_type: "created_from_customer_intake",
          event_status: "warning",
          message: blockerReason,
          payload: { missingData: params.missingData },
          created_by: params.actorUserId,
        });

      if (eventError && !databaseObjectMissing(eventError)) {
        console.warn(
          "Customer intake case event could not be created",
          eventError,
        );
      }
    }
  } catch (error) {
    if (!databaseObjectMissing(error)) {
      console.warn("Customer intake case could not be created", error);
    }
  }
}

type CustomerBlockerDraft = {
  blockerType: string;
  severity: "info" | "warning" | "blocking" | "critical";
  status: "open" | "pending_review" | "resolved" | "dismissed";
  title: string;
  description: string;
  metadata: Record<string, unknown>;
  relatedField?: string | null;
};

function blockerTypeFromMissingLabel(label: string): string {
  const lower = label.toLowerCase();
  if (lower.includes("fullmakt")) return "missing_power_of_attorney";
  if (lower.includes("mätpunkt")) return "missing_metering_point_id";
  if (lower.includes("anläggnings")) return "missing_facility_id";
  if (lower.includes("nätägare")) return "missing_grid_owner";
  if (lower.includes("startdatum")) return "missing_start_date";
  if (lower.includes("avtal")) return "missing_contract";
  return "missing_required_data";
}

function blockerSeverityFromMissingLabel(
  label: string,
): CustomerBlockerDraft["severity"] {
  const lower = label.toLowerCase();
  if (lower.includes("fullmakt") || lower.includes("mätpunkt"))
    return "blocking";
  if (lower.includes("anläggnings") || lower.includes("nätägare"))
    return "warning";
  return "warning";
}

function buildCustomerBlockerDrafts(params: {
  missingData: string[];
  addressWarnings: string[];
  duplicateMatches: IntakeDuplicateMatch[];
  forceBlocked: boolean;
}): CustomerBlockerDraft[] {
  const drafts: CustomerBlockerDraft[] = [];

  for (const label of params.missingData) {
    const blockerType = blockerTypeFromMissingLabel(label);
    drafts.push({
      blockerType,
      severity: blockerSeverityFromMissingLabel(label),
      status: "open",
      title: `Saknas: ${label}`,
      description:
        "Kunden är sparad, men detta måste kompletteras innan berört utskick, leverantörsbyte eller fakturering går vidare.",
      relatedField: label,
      metadata: {
        source: "customer_intake",
        missingField: label,
        stopsCustomerCreation: false,
      },
    });
  }

  if (params.duplicateMatches.length > 0) {
    drafts.push({
      blockerType: "possible_duplicate",
      severity: params.duplicateMatches.some(
        (match) => match.severity === "critical",
      )
        ? "blocking"
        : "warning",
      status: "pending_review",
      title: "Möjlig dubblett",
      description:
        "Systemet hittade en möjlig dubblett. Kunden är skapad, men bör granskas innan merge, export eller känsliga driftsteg.",
      metadata: {
        source: "customer_intake_duplicate_check",
        duplicateMatches: params.duplicateMatches,
        stopsCustomerCreation: false,
      },
    });
  }

  for (const warning of params.addressWarnings.filter(
    (value) => !value.toLowerCase().includes("matchar kund"),
  )) {
    drafts.push({
      blockerType: "missing_required_data",
      severity: "warning",
      status: "open",
      title: "Adress eller intagsdata behöver kontrolleras",
      description: warning,
      metadata: {
        source: "customer_intake_address_warning",
        warning,
        stopsCustomerCreation: false,
      },
    });
  }

  if (params.forceBlocked) {
    drafts.push({
      blockerType: "manual_admin_block",
      severity: "blocking",
      status: "open",
      title: "Kunden markerades som blockerad vid intag",
      description:
        "Admin valde att skapa kunden men hålla den blockerad tills uppgifterna har granskats.",
      metadata: {
        source: "customer_intake",
        stopsCustomerCreation: false,
      },
    });
  }

  const keySet = new Set<string>();
  return drafts.filter((draft) => {
    const key = `${draft.blockerType}:${draft.title}:${draft.description}`;
    if (keySet.has(key)) return false;
    keySet.add(key);
    return true;
  });
}

async function createCustomerBlockers(params: {
  companyId: string;
  actorUserId: string;
  customerId: string;
  siteId: string | null;
  meteringPointId: string | null;
  contractId: string | null;
  missingData: string[];
  addressWarnings: string[];
  duplicateMatches: IntakeDuplicateMatch[];
  forceBlocked: boolean;
}) {
  const drafts = buildCustomerBlockerDrafts(params);
  if (drafts.length === 0) return [];

  try {
    const { data, error } = await supabaseService
      .from("customer_blockers")
      .insert(
        drafts.map((draft) => ({
          company_id: params.companyId,
          customer_id: params.customerId,
          customer_site_id: params.siteId,
          metering_point_id: params.meteringPointId,
          contract_id: params.contractId,
          blocker_type: draft.blockerType,
          severity: draft.severity,
          status: draft.status,
          title: draft.title,
          description: draft.description,
          metadata: draft.metadata,
          created_by: params.actorUserId,
        })),
      )
      .select("id, blocker_type, severity, status, title");

    if (error) {
      if (!databaseObjectMissing(error)) {
        console.warn("Customer blockers could not be created", error);
      }
      return [];
    }

    await insertAuditLog({
      actorUserId: params.actorUserId,
      companyId: params.companyId,
      entityType: "customer_blockers",
      entityId: params.customerId,
      action: "customer_intake_blockers_created",
      newValues: { blockers: data ?? [] },
      metadata: {
        missingData: params.missingData,
        duplicateCount: params.duplicateMatches.length,
        forceBlocked: params.forceBlocked,
      },
    }).catch((error) =>
      console.warn("Customer blocker audit could not be logged", error),
    );

    return data ?? [];
  } catch (error) {
    if (!databaseObjectMissing(error)) {
      console.warn("Customer blockers could not be created", error);
    }
    return [];
  }
}

function mapUnknownErrorToIntakeState(
  error: unknown,
  values: IntakeFormValues = {},
): IntakeActionState {
  if (error instanceof IntakeValidationError) {
    return {
      status: "error",
      message: error.message,
      fieldErrors: error.fieldErrors,
      values,
      createdCustomerId: null,
    };
  }

  const maybeDatabaseError = error as {
    code?: string;
    message?: string;
    details?: string;
  };

  if (maybeDatabaseError?.code === "23502") {
    if (
      maybeDatabaseError.details?.includes("customer_sites") &&
      maybeDatabaseError.message?.includes("country")
    ) {
      return {
        status: "error",
        message: "Land saknas för anläggningen.",
        fieldErrors: {
          country: "Land måste sparas som ISO-kod, till exempel SE.",
        },
        values,
        createdCustomerId: null,
      };
    }
  }

  return {
    status: "error",
    message:
      maybeDatabaseError?.message ||
      "Kunden kunde inte skapas. Kontrollera formatfel eller tekniskt fel och försök igen.",
    fieldErrors: {},
    values,
    createdCustomerId: null,
  };
}

type CustomerGraphRow = Record<string, unknown> & {
  id: string
  customer_number?: string | null
  customer_type?: string | null
  full_name?: string | null
  company_name?: string | null
  email?: string | null
  phone?: string | null
}

type CustomerGraphResult = CustomerGraphRow & {
  __duplicateWarnings: string[]
  __duplicateReviewRequired: boolean
  __createdNewCustomer: boolean
  __createdSiteId: string | null
  __createdMeteringPointId: string | null
  __createdGridOwnerId: string | null
  __createdPowerOfAttorneyId: string | null
  __createdCurrentSupplierName: string | null
}

async function createCustomerGraph(params: CreateCustomerGraphParams): Promise<CustomerGraphResult> {
  const fieldErrors = validateCreateCustomerParams(params);
  if (Object.keys(fieldErrors).length > 0) {
    throw createValidationErrorFromFieldErrors(fieldErrors);
  }

  const duplicateMatches = await findIntakeDuplicateMatches(params);
  const duplicateWarnings = duplicateWarningsFromMatches(duplicateMatches);
  const duplicateReviewRequired =
    duplicateMatches.length > 0 &&
    params.duplicateResolution !== "create_separate_confirmed";

  const normalizedFirstName = normalizeOptionalString(params.firstName);
  const normalizedLastName = normalizeOptionalString(params.lastName);
  const normalizedCompanyName = normalizeOptionalString(params.companyName);
  const normalizedContactTitle = normalizeOptionalString(params.contactTitle);
  const normalizedEmail = normalizeOptionalString(params.email);
  const normalizedPhone = normalizeOptionalString(params.phone);
  const normalizedApartmentNumber = normalizeOptionalString(
    params.apartmentNumber,
  );
  const normalizedSiteName = normalizeOptionalString(params.siteName);
  const normalizedFacilityId = normalizeOptionalString(params.facilityId);
  const normalizedMeterPointId = normalizeOptionalString(params.meterPointId);
  const normalizedGridOwnerId = normalizeOptionalString(params.gridOwnerId);
  const normalizedGridAreaCode = normalizeOptionalString(params.gridAreaCode);
  const normalizedMoveInDate = normalizeOptionalString(params.moveInDate);
  const normalizedCurrentSupplierId = normalizeOptionalString(params.currentSupplierId);
  const normalizedCurrentSupplierName = params.currentSupplierUnknown
    ? "Okänd nuvarande leverantör"
    : normalizeOptionalString(
        params.currentSupplierName,
      );
  const normalizedCurrentSupplierOrgNumber = params.currentSupplierUnknown
    ? null
    : normalizeOptionalString(
        params.currentSupplierOrgNumber,
      );
  const normalizedCustomerConfirmationStatus = normalizeOptionalString(
    params.customerConfirmationStatus,
  );
  const normalizedAuthorizationStatus = normalizeOptionalString(
    params.authorizationStatus,
  );
  const normalizedAuthorizationValidFrom = normalizeOptionalString(
    params.authorizationValidFrom,
  );
  const normalizedAuthorizationValidTo = normalizeOptionalString(
    params.authorizationValidTo,
  );
  const normalizedExpectedStartDate = normalizeOptionalString(
    params.expectedStartDate,
  );
  const normalizedConfirmedStartDate = normalizeOptionalString(
    params.confirmedStartDate,
  );
  const normalizedActualStartDate = normalizeOptionalString(
    params.actualStartDate,
  );
  const normalizedStartDateSource = normalizeOptionalString(
    params.startDateSource,
  );
  const normalizedStreet = normalizeOptionalString(params.street);
  const normalizedPostalCode = normalizeOptionalString(params.postalCode);
  const normalizedCity = normalizeOptionalString(params.city);
  const normalizedCareOf = normalizeOptionalString(params.careOf);
  const normalizedCountry = normalizeCountryCode(params.country);
  const normalizedContractStartDate = normalizeOptionalString(
    params.contractStartDate,
  );
  const hasSignedAgreementUpload = Boolean(params.signedAgreementFile);
  const normalizedContractStatus =
    hasSignedAgreementUpload &&
    (!params.contractStatus ||
      params.contractStatus === "draft" ||
      params.contractStatus === "pending_signature")
      ? "signed"
      : (params.contractStatus ?? null);
  const normalizedOverrideReason = normalizeOptionalString(
    params.overrideReason,
  );
  const normalizedAnnualConsumptionKwh = params.annualConsumptionKwh ?? null;
  const normalizedBindingMonths = params.bindingMonths ?? null;
  const normalizedNoticeMonths = params.noticeMonths ?? null;
  const normalizedFixedPriceOrePerKwh = params.fixedPriceOrePerKwh ?? null;
  const normalizedSpotMarkupOrePerKwh = params.spotMarkupOrePerKwh ?? null;
  const normalizedVariableFeeOrePerKwh = params.variableFeeOrePerKwh ?? null;
  const normalizedMonthlyFeeSek = params.monthlyFeeSek ?? null;
  const normalizedGreenFeeMode = params.greenFeeMode ?? null;
  const normalizedGreenFeeValue = params.greenFeeValue ?? null;
  const normalizedOptionalFeeLines = params.optionalFeeLines ?? [];
  const billingSnapshot = buildBillingAddressSnapshot(params);
  const duplicateResolution = params.duplicateResolution;
  const shouldUseExistingCustomer = Boolean(
    params.existingCustomerId &&
    [
      "add_site_to_existing",
      "add_contract_to_existing",
      "update_existing",
    ].includes(duplicateResolution),
  );

  let normalizedPersonalNumber = normalizeOptionalString(params.personalNumber);
  let normalizedOrgNumber = normalizeOptionalString(params.orgNumber);
  let normalizedMovedFromStreet = normalizeOptionalString(
    params.movedFromStreet,
  );
  let normalizedMovedFromPostalCode = normalizeOptionalString(
    params.movedFromPostalCode,
  );
  let normalizedMovedFromCity = normalizeOptionalString(params.movedFromCity);
  let normalizedMovedFromSupplierName = normalizeOptionalString(
    params.movedFromSupplierName,
  );

  if (params.customerType === "private") {
    normalizedOrgNumber = null;
  } else {
    normalizedPersonalNumber = null;
  }

  if (
    params.intakeFlowType !== "move_in" &&
    params.intakeFlowType !== "move_out_takeover"
  ) {
    normalizedMovedFromStreet = null;
    normalizedMovedFromPostalCode = null;
    normalizedMovedFromCity = null;
    normalizedMovedFromSupplierName = null;
  }

  const displayName =
    params.customerType === "business" || params.customerType === "association"
      ? (normalizedCompanyName ?? "")
      : `${normalizedFirstName ?? ""} ${normalizedLastName ?? ""}`.trim();

  const creationContext: CreationContext = {
    customerId: null,
    contactId: null,
    addressId: null,
    siteId: null,
    meteringPointId: null,
    contractId: null,
    switchRequestId: null,
    powerOfAttorneyId: null,
    documentIds: [],
  };

  try {
    let customer = null as CustomerGraphRow | null;
    let createdNewCustomer = false;

    if (shouldUseExistingCustomer) {
      customer = (await loadExistingCustomerForIntake({
        companyId: params.companyId,
        customerId: params.existingCustomerId,
      })) as CustomerGraphRow | null;

      if (!customer?.id) {
        throw new IntakeValidationError(
          "Befintlig kund hittades inte i valt bolag.",
          {
            existingCustomerId:
              "Befintlig kund hittades inte eller tillhör ett annat bolag.",
          },
        );
      }

      if (duplicateResolution === "update_existing") {
        await updateExistingCustomerFromIntake({
          companyId: params.companyId,
          customerId: String(customer.id),
          actorUserId: params.actorUserId,
          intake: params,
        });
      }
    } else {
      const { data: createdCustomer, error: customerError } =
        await supabaseService
          .from("customers")
          .insert({
            company_id: params.companyId,
            customer_type: params.customerType,
            status:
              params.intakeCreateMode === "create_blocked"
                ? "blocked"
                : "draft",
            first_name: normalizedFirstName,
            last_name: normalizedLastName,
            full_name: displayName || null,
            company_name: normalizedCompanyName,
            email: normalizedEmail,
            phone: normalizedPhone,
            personal_number: normalizedPersonalNumber,
            org_number: normalizedOrgNumber,
            apartment_number: normalizedApartmentNumber,
            possible_duplicate: duplicateMatches.length > 0,
            duplicate_review_status:
              duplicateMatches.length > 0
                ? duplicateResolution === "create_separate_confirmed"
                  ? "created_separate"
                  : "pending_review"
                : "clear",
          })
          .select("*")
          .single();

      if (customerError) throw customerError;
      customer = createdCustomer as CustomerGraphRow;
      createdNewCustomer = true;
      creationContext.customerId = String(customer.id);

      const contact = await createPrimaryContact({
        customerId: String(customer.id),
        customerType: params.customerType,
        firstName: normalizedFirstName,
        lastName: normalizedLastName,
        companyName: normalizedCompanyName,
        title: normalizedContactTitle,
        email: normalizedEmail,
        phone: normalizedPhone,
        companyId: params.companyId,
      });
      creationContext.contactId = contact?.id ?? null;
    }

    if (!customer?.id) throw new Error("Kund kunde inte förberedas.");
    const customerId = String(customer.id);

    await updateCustomerBillingSettings({
      companyId: params.companyId,
      customerId,
      billing: billingSnapshot,
    });

    const address = await createFacilityAddress({
      customerId: customer.id,
      street: normalizedStreet,
      postalCode: normalizedPostalCode,
      city: normalizedCity,
      careOf: normalizedCareOf,
      moveInDate: normalizedMoveInDate,
      country: normalizedCountry,
      companyId: params.companyId,
    });
    creationContext.addressId = address?.id ?? null;

    const billingAddress = await createBillingAddressFromIntake({
      companyId: params.companyId,
      customerId,
      billing: billingSnapshot,
    });

    if (!creationContext.addressId) {
      creationContext.addressId = billingAddress?.id ?? null;
    }

    const shouldCreateSite = Boolean(
      normalizedSiteName ||
      normalizedFacilityId ||
      normalizedStreet ||
      normalizedGridOwnerId ||
      normalizedGridAreaCode ||
      params.priceAreaCode ||
      normalizedMoveInDate,
    );

    let siteId: string | null = null;

    if (shouldCreateSite) {
      const { data: site, error: siteError } = await supabaseService
        .from("customer_sites")
        .insert({
          company_id: params.companyId,
          customer_id: customer.id,
          site_name: normalizedSiteName || displayName || "Ny anläggning",
          facility_id: normalizedFacilityId,
          site_type: params.siteType ?? "consumption",
          status: "draft",
          grid_owner_id: normalizedGridOwnerId,
          price_area_code: params.priceAreaCode ?? null,
          grid_area_code: normalizedGridAreaCode,
          move_in_date: normalizedMoveInDate,
          annual_consumption_kwh: normalizedAnnualConsumptionKwh,
          current_supplier_id: normalizedCurrentSupplierId,
          current_supplier_name: normalizedCurrentSupplierName,
          current_supplier_org_number: normalizedCurrentSupplierOrgNumber,
          current_supplier_unknown: params.currentSupplierUnknown,
          street: normalizedStreet,
          postal_code: normalizedPostalCode,
          city: normalizedCity,
          country: normalizedCountry,
          care_of: normalizedCareOf,
          invoice_recipient: billingSnapshot.recipient,
          invoice_email: billingSnapshot.email,
          invoice_reference: billingSnapshot.reference,
          billing_street: billingSnapshot.street,
          billing_postal_code: billingSnapshot.postalCode,
          billing_city: billingSnapshot.city,
          billing_country: billingSnapshot.country,
          billing_address_same_as_site: billingSnapshot.sameAsSite,
          billing_level: billingSnapshot.billingLevel,
          consolidated_invoice: billingSnapshot.consolidatedInvoice,
          moved_from_street: normalizedMovedFromStreet,
          moved_from_postal_code: normalizedMovedFromPostalCode,
          moved_from_city: normalizedMovedFromCity,
          moved_from_supplier_name: normalizedMovedFromSupplierName,
          metadata: {
            currentSupplier: {
              id: normalizedCurrentSupplierId,
              name: normalizedCurrentSupplierName,
              orgNumber: normalizedCurrentSupplierOrgNumber,
              unknown: params.currentSupplierUnknown,
              source: "customer_intake",
            },
          },
          created_by: params.actorUserId,
          updated_by: params.actorUserId,
        })
        .select("*")
        .single();

      if (siteError) throw siteError;
      siteId = site.id;
      creationContext.siteId = site.id;
    }

    if (siteId && normalizedMeterPointId) {
      const { data: meteringPoint, error: meteringPointError } =
        await supabaseService
          .from("metering_points")
          .insert({
            company_id: params.companyId,
            customer_id: customer.id,
            site_id: siteId,
            meter_point_id: normalizedMeterPointId,
            site_facility_id: normalizedFacilityId,
            status: "draft",
            measurement_type: "consumption",
            reading_frequency: "hourly",
            grid_owner_id: normalizedGridOwnerId,
            price_area_code: params.priceAreaCode ?? null,
            grid_area_code: normalizedGridAreaCode,
            is_settlement_relevant: true,
            created_by: params.actorUserId,
            updated_by: params.actorUserId,
          })
          .select("id")
          .single();

      if (meteringPointError) throw meteringPointError;
      creationContext.meteringPointId = meteringPoint.id;
    }

    if (params.contractOfferId || params.contractTypeOverride) {
      const offer = params.contractOfferId
        ? await getContractOfferById(params.contractOfferId, params.companyId)
        : null;

      const contract = await createCustomerContract({
        companyId: params.companyId,
        customerId: customer.id,
        siteId,
        contractOfferId: offer?.id ?? null,
        sourceType:
          params.contractOfferId && !normalizedOverrideReason
            ? "catalog"
            : "manual_override",
        status: normalizedContractStatus ?? "pending_signature",
        contractName: offer?.name ?? "Kundspecifikt avtal",
        contractType:
          params.contractTypeOverride ??
          offer?.contract_type ??
          "variable_hourly",
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
        campaignSnapshot: offer
          ? {
              offerId: offer.id,
              campaignName: offer.campaign_name ?? null,
              campaignCode: offer.campaign_code ?? null,
              campaignVersion: offer.campaign_version ?? "v1",
              validFrom: offer.valid_from ?? null,
              validTo: offer.valid_to ?? null,
            }
          : null,
        priceSnapshot: offer
          ? {
              offerId: offer.id,
              priceVersion: offer.price_version ?? "v1",
              termsVersion: offer.terms_version ?? "v1",
              monthlyFeeSek: offer.monthly_fee_sek ?? null,
              spotMarkupOrePerKwh: offer.spot_markup_ore_per_kwh ?? null,
              variableFeeOrePerKwh: offer.variable_fee_ore_per_kwh ?? null,
              greenFeeMode: offer.green_fee_mode ?? "none",
              greenFeeValue: offer.green_fee_value ?? null,
              discountValue: offer.discount_value ?? null,
              discountUnit: offer.discount_unit ?? null,
              startFeeSek: offer.start_fee_sek ?? null,
              adminFeeSek: offer.admin_fee_sek ?? null,
              breakFeeSek: offer.break_fee_sek ?? null,
              vatRate: offer.vat_rate ?? null,
            }
          : null,
        fixedPriceOrePerKwh:
          normalizedFixedPriceOrePerKwh ??
          offer?.fixed_price_ore_per_kwh ??
          null,
        spotMarkupOrePerKwh:
          normalizedSpotMarkupOrePerKwh ??
          offer?.spot_markup_ore_per_kwh ??
          null,
        variableFeeOrePerKwh:
          normalizedVariableFeeOrePerKwh ??
          offer?.variable_fee_ore_per_kwh ??
          null,
        monthlyFeeSek:
          normalizedMonthlyFeeSek ?? offer?.monthly_fee_sek ?? null,
        greenFeeMode: normalizedGreenFeeMode ?? offer?.green_fee_mode ?? "none",
        greenFeeValue:
          normalizedGreenFeeValue ?? offer?.green_fee_value ?? null,
        bindingMonths:
          normalizedBindingMonths ?? offer?.default_binding_months ?? null,
        noticeMonths:
          normalizedNoticeMonths ?? offer?.default_notice_months ?? null,
        optionalFeeLines:
          normalizedOptionalFeeLines.length > 0
            ? normalizedOptionalFeeLines
            : ((offer?.optional_fee_lines as Array<
                Record<string, unknown>
              > | null) ?? []),
        startsAt:
          normalizedContractStartDate ??
          normalizedConfirmedStartDate ??
          normalizedExpectedStartDate,
        expectedStartAt: normalizedExpectedStartDate,
        confirmedStartAt: normalizedConfirmedStartDate,
        actualStartAt: normalizedActualStartDate,
        startDateSource: normalizedStartDateSource,
        invoiceRecipient: billingSnapshot.recipient,
        invoiceEmail: billingSnapshot.email,
        invoiceReference: billingSnapshot.reference,
        billingStreet: billingSnapshot.street,
        billingPostalCode: billingSnapshot.postalCode,
        billingCity: billingSnapshot.city,
        billingCountry: billingSnapshot.country,
        billingAddressSameAsSite: billingSnapshot.sameAsSite,
        billingLevel: billingSnapshot.billingLevel,
        consolidatedInvoice: billingSnapshot.consolidatedInvoice,
        signedAt:
          normalizedContractStatus === "signed" ||
          normalizedContractStatus === "active"
            ? normalizedContractStartDate ||
              normalizedConfirmedStartDate ||
              new Date().toISOString()
            : null,
        overrideReason: normalizedOverrideReason,
        actorUserId: params.actorUserId,
      });

      creationContext.contractId = contract.id;

      await addCustomerContractEvent({
        companyId: params.companyId,
        customerContractId: contract.id,
        customerId: customer.id,
        eventType: "created",
        note: params.contractOfferId
          ? `Skapad från avtalskatalog${normalizedOverrideReason ? ` med override: ${normalizedOverrideReason}` : ""}`
          : "Skapad som manuellt kundspecifikt avtal",
        metadata: {
          contractOfferId: params.contractOfferId ?? null,
          customerNumber: customer.customer_number ?? null,
        },
        actorUserId: params.actorUserId,
      });

      await syncContractLifecycleEvents({
        companyId: params.companyId,
        customerId: customer.id,
        contractId: contract.id,
        contractStatus: normalizedContractStatus,
        contractStartDate:
          normalizedContractStartDate ??
          normalizedConfirmedStartDate ??
          normalizedExpectedStartDate,
        actorUserId: params.actorUserId,
      });
    }

    const intakeDocumentUpload = await uploadCustomerIntakeDocuments({
      companyId: params.companyId,
      actorUserId: params.actorUserId,
      customerId: customer.id,
      siteId,
      meteringPointId: creationContext.meteringPointId,
      contractId: creationContext.contractId,
      signedAgreementFile: params.signedAgreementFile,
      signedPowerOfAttorneyFile: params.signedPowerOfAttorneyFile,
      authorizationValidFrom: normalizedAuthorizationValidFrom,
      authorizationValidTo: normalizedAuthorizationValidTo,
    });

    creationContext.documentIds = intakeDocumentUpload.uploadedDocumentIds;
    creationContext.powerOfAttorneyId = intakeDocumentUpload.powerOfAttorneyId;

    if (!creationContext.powerOfAttorneyId) {
      creationContext.powerOfAttorneyId =
        await maybeCreatePowerOfAttorneyFromIntake({
          companyId: params.companyId,
          actorUserId: params.actorUserId,
          customerId: customer.id,
          siteId,
          status: normalizedAuthorizationStatus,
          validFrom: normalizedAuthorizationValidFrom,
          validTo: normalizedAuthorizationValidTo,
        });
    }

    const switchRequestResult = await maybeCreateSwitchRequestFromIntake({
      customerId: customer.id,
      siteId,
      intakeFlowType: params.intakeFlowType,
    });

    creationContext.switchRequestId =
      switchRequestResult && switchRequestResult.created
        ? (switchRequestResult.requestId ?? null)
        : null;

    const effectiveAuthorizationStatus = creationContext.powerOfAttorneyId
      ? "signed"
      : normalizedAuthorizationStatus;
    const readinessParams: CreateCustomerGraphParams = {
      ...params,
      authorizationStatus: effectiveAuthorizationStatus,
      contractStatus: normalizedContractStatus,
    };
    const missingData = buildMissingDataList(
      readinessParams,
      switchRequestResult,
    );
    const addressWarnings = [
      ...buildAddressWarnings(params),
      ...duplicateWarnings,
    ];
    const intakeQualityScore = calculateIntakeQualityScore(
      readinessParams,
      missingData,
    );
    const hasCoreIdentity = Boolean(
      (params.customerType === "private" &&
        (normalizedFirstName ||
          normalizedLastName ||
          normalizedPersonalNumber)) ||
      (params.customerType !== "private" &&
        (normalizedCompanyName || normalizedOrgNumber)),
    );
    const hasContact = Boolean(normalizedEmail || normalizedPhone);
    const intakeStatus = determineIntakeStatus({
      intakeCreateMode: params.intakeCreateMode,
      hasCoreIdentity,
      hasContact,
      missingData,
      contractId: creationContext.contractId,
      duplicateReviewRequired,
    });

    await createIntakeFollowUps({
      companyId: params.companyId,
      actorUserId: params.actorUserId,
      customerId: customer.id,
      siteId,
      meteringPointId: creationContext.meteringPointId,
      contractId: creationContext.contractId,
      gridOwnerId: normalizedGridOwnerId,
      currentSupplierName: normalizedCurrentSupplierName,
      missingData,
      addressWarnings,
    });

    const customerBlockers = await createCustomerBlockers({
      companyId: params.companyId,
      actorUserId: params.actorUserId,
      customerId: customer.id,
      siteId,
      meteringPointId: creationContext.meteringPointId,
      contractId: creationContext.contractId,
      missingData,
      addressWarnings,
      duplicateMatches,
      forceBlocked: params.intakeCreateMode === "create_blocked",
    });

    await updateCustomerIntakeQuality({
      customerId: customer.id,
      missingData,
      qualityScore: intakeQualityScore,
      intakeStatus,
      addressWarnings,
    });

    if (duplicateMatches.length > 0) {
      await createDuplicateReviewCase({
        companyId: params.companyId,
        actorUserId: params.actorUserId,
        customerId: customer.id,
        siteId,
        meteringPointId: creationContext.meteringPointId,
        duplicateMatches,
      });

      await logDuplicateResolutionEvent({
        companyId: params.companyId,
        actorUserId: params.actorUserId,
        customerId: customer.id,
        existingCustomerId: params.existingCustomerId,
        duplicateMatches,
        resolution: duplicateResolution,
        reason: params.duplicateOverrideReason,
      });
    }

    const batch2BAutomationResult = await runBatch2BAutomation({
      companyId: params.companyId,
      actorUserId: params.actorUserId,
    }).catch((error) => ({
      error:
        error instanceof Error
          ? error.message
          : "Automationsmotorn kunde inte köras efter kundintag.",
    }));

    await insertAuditLog({
      actorUserId: params.actorUserId,
      entityType: "customer",
      entityId: customer.id,
      action: "customer_created",
      newValues: {
        customer_type: customer.customer_type,
        full_name: customer.full_name,
        company_name: customer.company_name,
        email: customer.email,
        phone: customer.phone,
        customer_number: customer.customer_number,
      },
      companyId: params.companyId,
      metadata: {
        intakeFlowType: params.intakeFlowType,
        siteId,
        switchRequest: switchRequestResult ?? null,
        missingData,
        addressWarnings,
        intakeStatus,
        intakeFollowUpsCreated:
          missingData.length > 0 || addressWarnings.length > 0,
        intakeQualityScore,
        duplicateWarnings,
        duplicateReviewRequired,
        uploadedDocuments: intakeDocumentUpload.uploadedLabels,
        customerBlockers,
        duplicateResolution,
        existingCustomerId: params.existingCustomerId,
        createdNewCustomer,
        billing: billingSnapshot,
        customerConfirmationStatus: normalizedCustomerConfirmationStatus,
        authorizationStatus: normalizedAuthorizationStatus,
        startDates: {
          desired: normalizedMoveInDate,
          expected: normalizedExpectedStartDate,
          confirmed: normalizedConfirmedStartDate,
          actual: normalizedActualStartDate,
          source: normalizedStartDateSource,
        },
        batch2BAutomation: batch2BAutomationResult,
        transactionReadyMode: "server_validated_rollback",
      },
    });

    const domainEvent = await emitDomainEvent({
      companyId: params.companyId,
      eventType: createdNewCustomer ? "customer.created" : "customer.updated_from_intake",
      aggregateType: "customer",
      aggregateId: customer.id,
      subjectCustomerId: customer.id,
      actorUserId: params.actorUserId,
      source: "customer_intake",
      idempotencyKey: `customer_intake:${params.companyId}:${customer.id}:${creationContext.siteId ?? "no_site"}:${creationContext.contractId ?? "no_contract"}`,
      payload: {
        intakeFlowType: params.intakeFlowType,
        intakeStatus,
        siteId,
        meteringPointId: creationContext.meteringPointId,
        contractId: creationContext.contractId,
        switchRequestId: creationContext.switchRequestId,
        powerOfAttorneyId: creationContext.powerOfAttorneyId,
        missingData,
        addressWarnings,
        duplicateReviewRequired,
      },
    }).catch(() => null);

    if (domainEvent) {
      await enqueueWebhookDeliveriesForEvent(domainEvent).catch(() => 0);
    }

    return {
      ...customer,
      __duplicateWarnings: duplicateWarnings,
      __duplicateReviewRequired: duplicateReviewRequired,
      __createdNewCustomer: createdNewCustomer,
      __uploadedDocumentLabels: intakeDocumentUpload.uploadedLabels,
      __createdSiteId: creationContext.siteId,
      __createdMeteringPointId: creationContext.meteringPointId,
      __createdGridOwnerId: normalizedGridOwnerId,
      __createdPowerOfAttorneyId: creationContext.powerOfAttorneyId,
      __createdCurrentSupplierName: normalizedCurrentSupplierName,
    };
  } catch (error) {
    await cleanupCreatedGraph(creationContext);
    throw error;
  }
}

export async function createCustomerAction(
  _prevState: IntakeActionState,
  formData: FormData,
): Promise<IntakeActionState> {
  try {
    await requireAdminActionAccess({ allOf: ["customers.write"] });
    const actorUserId = await getActorUserId();
    const companyId = await requireOperationalCompanyId(actorUserId);
    await requireCompanyOperationalForWrites(companyId);
    let params = buildCreateCustomerParams(formData, actorUserId, companyId);

    const gridOwnerResolution = await resolveOrCreateGridOwnerForIntake({
      formData,
      companyId,
      actorUserId,
      selectedGridOwnerId: params.gridOwnerId,
    });

    const supplierResolution = await resolveOrCreateCurrentSupplierForIntake({
      formData,
      companyId,
      actorUserId,
      selectedSupplierId: params.currentSupplierId,
      currentSupplierName: params.currentSupplierName,
      currentSupplierOrgNumber: params.currentSupplierOrgNumber,
      unknown: params.currentSupplierUnknown,
    });

    params = {
      ...params,
      gridOwnerId: gridOwnerResolution.gridOwnerId,
      currentSupplierId: supplierResolution.supplierId,
      currentSupplierName: supplierResolution.name,
      currentSupplierOrgNumber: supplierResolution.orgNumber,
    };

    const customer = await createCustomerGraph(params);

    revalidatePath("/admin/customers");
    revalidatePath("/admin/customers/intake");

    const duplicateWarnings = Array.isArray(customer.__duplicateWarnings)
      ? (customer.__duplicateWarnings as string[])
      : [];
    const masterdataWarnings = [
      ...gridOwnerResolution.warnings,
      ...supplierResolution.warnings,
    ];
    const allWarnings = [...duplicateWarnings, ...masterdataWarnings];
    const usedExistingCustomer = customer.__createdNewCustomer === false;
    const uploadedDocumentLabels = Array.isArray(
      customer.__uploadedDocumentLabels,
    )
      ? (customer.__uploadedDocumentLabels as string[])
      : [];
    const documentSummary =
      uploadedDocumentLabels.length > 0
        ? ` Dokument sparade: ${uploadedDocumentLabels.join(", ")}.`
        : "";

    return {
      status: "success",
      message:
        allWarnings.length > 0
          ? `${usedExistingCustomer ? "Befintlig kund uppdaterades" : "Kunden skapades"}. Kontrollera varningar: ${allWarnings.slice(0, 3).join(" ")}${documentSummary}`
          : `${usedExistingCustomer ? "Befintlig kund uppdaterades" : `Kunden ${customer.customer_number ?? ""} skapades`} och eventuella saknade uppgifter ligger som blockerare/varningar.${documentSummary}`,
      fieldErrors: {},
      values: {
        country: "SE",
        postCreateAction: params.postCreateAction,
        postCreateRequestTarget: params.postCreateRequestTarget,
      },
      createdCustomerId: customer.id,
      createdSiteId: customer.__createdSiteId ?? null,
      createdMeteringPointId: customer.__createdMeteringPointId ?? null,
      createdGridOwnerId: customer.__createdGridOwnerId ?? null,
      createdPowerOfAttorneyId: customer.__createdPowerOfAttorneyId ?? null,
      createdCurrentSupplierName: customer.__createdCurrentSupplierName ?? null,
      postCreateAction: params.postCreateAction,
      postCreateRequestTarget: params.postCreateRequestTarget,
      duplicateWarnings: allWarnings,
      duplicateReviewRequired: Boolean(customer.__duplicateReviewRequired || masterdataWarnings.length > 0),
    };
  } catch (error) {
    return mapUnknownErrorToIntakeState(error, getFormValues(formData));
  }
}

async function resolveContractOfferIdForImport(params: {
  companyId: string;
  row: Record<string, string>;
  fallbackContractOfferId: string | null;
  forceFallback: boolean;
}): Promise<string | null> {
  if (params.forceFallback && params.fallbackContractOfferId)
    return params.fallbackContractOfferId;
  if (params.row.contract_offer_id?.trim())
    return params.row.contract_offer_id.trim();
  if (params.fallbackContractOfferId) return params.fallbackContractOfferId;

  const lookup = rowValue(
    params.row,
    "contract_offer_name",
    "campaign_name",
    "campaign_code",
  );
  if (!lookup) return null;

  const { data, error } = await supabaseService
    .from("contract_offers")
    .select("id")
    .eq("company_id", params.companyId)
    .eq("is_active", true)
    .or(
      `name.ilike.${lookup},campaign_name.ilike.${lookup},slug.ilike.${lookup}`,
    )
    .limit(1)
    .maybeSingle();

  if (error) {
    if (databaseObjectMissing(error)) return null;
    throw error;
  }

  return data?.id ?? null;
}

async function insertImportRow(params: {
  importBatchId: string | null | undefined;
  companyId: string;
  rowNumber: number;
  status: CustomerImportPreviewRowStatus | "failed";
  row: Record<string, string>;
  customerId?: string | null;
  errorMessage?: string | null;
  warnings?: string[];
  missingFields?: string[];
  uncertainFields?: string[];
  duplicateWarnings?: string[];
  confidence?: number;
}) {
  if (!params.importBatchId) return;

  await supabaseService.from("customer_import_rows").insert({
    import_batch_id: params.importBatchId,
    company_id: params.companyId,
    row_number: params.rowNumber,
    status: params.status,
    normalized_payload: params.row,
    customer_id: params.customerId ?? null,
    error_message: params.errorMessage ?? null,
    warnings: params.warnings ?? [],
    issues: {
      missingFields: params.missingFields ?? [],
      uncertainFields: params.uncertainFields ?? [],
      duplicateWarnings: params.duplicateWarnings ?? [],
      confidence: params.confidence ?? null,
    },
    parser_confidence: params.confidence ?? null,
  });
}

async function recordDocumentAiExtractionForImport(params: {
  companyId: string;
  actorUserId: string;
  fileName: string | null;
  importBatchId?: string | null;
  parsedImport: Awaited<ReturnType<typeof parseCustomerImportFormData>>;
}) {
  if (params.parsedImport.sourceKind !== "pdf") return;
  if (!params.parsedImport.rawText && !params.parsedImport.documentAiPayload)
    return;

  const firstRow = params.parsedImport.rows[0] ?? {};
  const detectedSites = params.parsedImport.rows
    .map((row, index) => ({
      rowNumber: index + 2,
      facilityId: row.facility_id ?? null,
      meterPointId: row.meter_point_id ?? null,
      gridAreaCode: row.grid_area_code ?? null,
      gridOwnerName: row.grid_owner_name ?? null,
    }))
    .filter(
      (row) =>
        row.facilityId ||
        row.meterPointId ||
        row.gridAreaCode ||
        row.gridOwnerName,
    );

  const status =
    params.parsedImport.ocrStatus === "needs_ocr"
      ? "needs_ocr"
      : "needs_review";

  const { error } = await supabaseService
    .from("document_ai_extractions")
    .insert({
      company_id: params.companyId,
      customer_id: null,
      source_file_name: params.fileName,
      extraction_type: "customer_import_pdf",
      status,
      raw_text: params.parsedImport.rawText?.slice(0, 200000) ?? null,
      extracted_fields: {
        rows: params.parsedImport.rows.slice(0, 100),
        parser: params.parsedImport.documentAiPayload ?? {},
        importBatchId: params.importBatchId ?? null,
      },
      field_confidence: {
        parserVersion: params.parsedImport.parserVersion ?? null,
        ocrStatus: params.parsedImport.ocrStatus ?? null,
        warnings: params.parsedImport.warnings,
      },
      detected_sites: detectedSites,
      detected_invoice_address: {
        invoiceRecipient: firstRow.invoice_recipient ?? null,
        invoiceEmail: firstRow.invoice_email ?? null,
        billingStreet: firstRow.billing_street ?? null,
        billingPostalCode: firstRow.billing_postal_code ?? null,
        billingCity: firstRow.billing_city ?? null,
      },
      review_notes:
        params.parsedImport.ocrStatus === "needs_ocr"
          ? "PDF saknar maskinläsbar text och behöver OCR/AI-granskning innan import."
          : "PDF tolkad maskinellt. Granska rader och confidence innan kund skapas.",
      created_by: params.actorUserId,
    });

  if (error && !databaseObjectMissing(error)) throw error;
}

type CustomerImportRowRecord = {
  id: string;
  import_batch_id: string | null;
  company_id: string | null;
  row_number: number | null;
  status: CustomerImportPreviewRowStatus | "pending" | "skipped" | "failed";
  normalized_payload?: Record<string, string> | null;
  raw_payload?: Record<string, string> | null;
  customer_id?: string | null;
  error_message?: string | null;
};

async function resolveGridOwnerIdForImport(params: {
  companyId: string;
  row: Record<string, string>;
}): Promise<string | null> {
  const direct = rowValue(params.row, "grid_owner_id");
  if (direct) return direct;

  const name = rowValue(params.row, "grid_owner_name", "grid_owner");
  if (!name) return null;

  try {
    const query = supabaseService
      .from("grid_owners")
      .select("id")
      .ilike("name", `%${name}%`)
      .limit(1);

    const { data, error } = await query.maybeSingle();
    if (error) {
      if (databaseObjectMissing(error)) return null;
      throw error;
    }

    return data?.id ?? null;
  } catch (error) {
    if (databaseObjectMissing(error)) return null;
    throw error;
  }
}

async function buildCustomerParamsFromImportRow(params: {
  actorUserId: string;
  companyId: string;
  row: Record<string, string>;
  fallbackContractOfferId?: string | null;
  forceFallbackContract?: boolean;
}): Promise<CreateCustomerGraphParams> {
  const row: Record<string, string> = {
    ...params.row,
    country: params.row.country || "SE",
  };

  row.contract_offer_id =
    (await resolveContractOfferIdForImport({
      companyId: params.companyId,
      row,
      fallbackContractOfferId: params.fallbackContractOfferId ?? null,
      forceFallback: Boolean(params.forceFallbackContract),
    })) ?? "";

  row.grid_owner_id =
    (await resolveGridOwnerIdForImport({
      companyId: params.companyId,
      row,
    })) ?? "";

  return {
    actorUserId: params.actorUserId,
    companyId: params.companyId,
    customerType: normalizeCustomerType(row.customer_type || "private"),
    intakeFlowType: normalizeIntakeFlowType(row.intake_flow_type || null),
    firstName: row.first_name || null,
    lastName: row.last_name || null,
    companyName: row.company_name || null,
    contactTitle: row.contact_title || null,
    email: row.email || null,
    phone: row.phone || null,
    personalNumber: row.personal_number || null,
    orgNumber: row.org_number || null,
    apartmentNumber: row.apartment_number || null,
    siteName: row.site_name || null,
    facilityId: row.facility_id || null,
    meterPointId: row.meter_point_id || null,
    siteType: (row.site_type as SiteType) || "consumption",
    gridOwnerId: row.grid_owner_id || null,
    priceAreaCode: (row.price_area_code as PriceAreaCode | undefined) ?? null,
    gridAreaCode: row.grid_area_code || row.grid_area_id || null,
    moveInDate: row.move_in_date || row.start_date || null,
    annualConsumptionKwh: parseNumber(row.annual_consumption_kwh || ""),
    currentSupplierId: row.current_supplier_id || null,
    currentSupplierUnknown: row.current_supplier_unknown === "true" || row.current_supplier_unknown === "1",
    currentSupplierName: row.current_supplier_name || null,
    currentSupplierOrgNumber: row.current_supplier_org_number || null,
    customerConfirmationStatus:
      row.customer_confirmation_status || row.customer_confirmation || null,
    authorizationStatus:
      row.authorization_status || row.power_of_attorney_status || null,
    authorizationValidFrom: row.authorization_valid_from || null,
    authorizationValidTo: row.authorization_valid_to || null,
    expectedStartDate:
      row.expected_start_date || row.contract_expected_start_date || null,
    confirmedStartDate: row.confirmed_start_date || null,
    actualStartDate: row.actual_start_date || null,
    startDateSource: row.start_date_source || null,
    street: row.street || null,
    postalCode: row.postal_code || null,
    city: row.city || null,
    careOf: row.care_of || null,
    country: row.country || null,
    movedFromStreet: row.moved_from_street || null,
    movedFromPostalCode: row.moved_from_postal_code || null,
    movedFromCity: row.moved_from_city || null,
    movedFromSupplierName: row.moved_from_supplier_name || null,
    contractOfferId: row.contract_offer_id || null,
    contractStartDate:
      row.contract_start_date || row.expected_start_date || null,
    contractStatus:
      (row.contract_status as ContractStatus | undefined) ??
      "pending_signature",
    overrideReason: row.override_reason || null,
    contractTypeOverride: row.contract_type_override
      ? parseContractType(row.contract_type_override)
      : null,
    fixedPriceOrePerKwh: parseNumber(row.fixed_price_ore_per_kwh || ""),
    spotMarkupOrePerKwh: parseNumber(row.spot_markup_ore_per_kwh || ""),
    variableFeeOrePerKwh: parseNumber(row.variable_fee_ore_per_kwh || ""),
    monthlyFeeSek: parseNumber(row.monthly_fee_sek || ""),
    greenFeeMode: row.green_fee_mode
      ? parseGreenFeeMode(row.green_fee_mode)
      : null,
    greenFeeValue: parseNumber(row.green_fee_value || ""),
    bindingMonths: parseIntOrNull(row.binding_months || ""),
    noticeMonths: parseIntOrNull(row.notice_months || ""),
    optionalFeeLines: parseOptionalFeeLines(row.optional_fee_lines || ""),
    duplicateResolution: normalizeDuplicateResolution(
      row.duplicate_resolution || null,
    ),
    existingCustomerId: row.existing_customer_id || null,
    duplicateOverrideReason: row.duplicate_override_reason || null,
    invoiceRecipient: row.invoice_recipient || row.billing_recipient || null,
    invoiceEmail: row.invoice_email || row.billing_email || row.email || null,
    invoiceReference: row.invoice_reference || row.billing_reference || null,
    billingStreet:
      row.billing_street || row.invoice_street || row.street || null,
    billingPostalCode:
      row.billing_postal_code ||
      row.invoice_postal_code ||
      row.postal_code ||
      null,
    billingCity: row.billing_city || row.invoice_city || row.city || null,
    billingCountry:
      row.billing_country || row.invoice_country || row.country || "SE",
    billingAddressSameAsSite:
      row.billing_address_same_as_site === "true" ||
      row.billing_address_same_as_site === "1" ||
      row.billing_address_same_as_site === "yes",
    billingLevel: normalizeBillingLevel(row.billing_level || null),
    consolidatedInvoice:
      row.consolidated_invoice === "true" ||
      row.consolidated_invoice === "1" ||
      row.consolidated_invoice === "yes",
    intakeCreateMode: "create",
    signedAgreementFile: null,
    signedPowerOfAttorneyFile: null,
    postCreateAction: "open_customer",
    postCreateRequestTarget: "both",
  };
}

async function recalculateImportBatchCounters(
  importBatchId: string | null | undefined,
) {
  if (!importBatchId) return;

  const { data: rows, error } = await supabaseService
    .from("customer_import_rows")
    .select("status")
    .eq("import_batch_id", importBatchId);

  if (error) {
    if (!databaseObjectMissing(error)) throw error;
    return;
  }

  const allRows = (rows ?? []) as Array<{ status: string | null }>;
  const createdRows = allRows.filter((row) => row.status === "created").length;
  const failedRows = allRows.filter((row) =>
    ["failed", "rejected"].includes(row.status ?? ""),
  ).length;
  const reviewRows = allRows.filter((row) =>
    [
      "requires_review",
      "missing_fields",
      "duplicate_warning",
      "ready_to_create",
      "pending",
    ].includes(row.status ?? ""),
  ).length;
  const totalRows = allRows.length;
  const status =
    reviewRows > 0
      ? "partially_imported"
      : failedRows > 0 && createdRows === 0
        ? "failed"
        : "completed";

  const { error: updateError } = await supabaseService
    .from("customer_import_batches")
    .update({
      status,
      total_rows: totalRows,
      rows_total: totalRows,
      created_rows: createdRows,
      rows_created: createdRows,
      failed_rows: failedRows + reviewRows,
      rows_failed: failedRows + reviewRows,
      imported_at: createdRows > 0 ? new Date().toISOString() : null,
      metadata: {
        recalculatedAt: new Date().toISOString(),
        reviewRows,
        failedRows,
      },
    })
    .eq("id", importBatchId);

  if (updateError && !databaseObjectMissing(updateError)) throw updateError;
}

type CustomerImportRowForAction = CustomerImportRowRecord & {
  company_id: string;
};

async function loadImportRowForAction(
  rowId: string,
): Promise<CustomerImportRowForAction> {
  const { data, error } = await supabaseService
    .from("customer_import_rows")
    .select("*")
    .eq("id", rowId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Importraden hittades inte.");

  const row = data as CustomerImportRowRecord;
  if (!row.company_id)
    throw new Error(
      "Importraden saknar bolagskoppling och kan inte behandlas säkert.",
    );

  return row as CustomerImportRowForAction;
}

export async function createCustomerFromImportRowAction(formData: FormData) {
  const rowId = getString(formData, "importRowId");
  if (!rowId) throw new Error("Import-rad saknas.");

  const importRow = await loadImportRowForAction(rowId);
  await requireCompanyScopedActionAccess(importRow.company_id, {
    anyOf: ["customers.write"],
  });
  const actorUserId = await getActorUserId();
  await requireCompanyOperationalForWrites(importRow.company_id);

  if (importRow.customer_id || importRow.status === "created") {
    throw new Error("Importraden har redan skapat en kund.");
  }

  const normalizedPayload =
    importRow.normalized_payload ?? importRow.raw_payload ?? null;
  if (!normalizedPayload || typeof normalizedPayload !== "object") {
    throw new Error("Importraden saknar normaliserad payload.");
  }

  try {
    const params = await buildCustomerParamsFromImportRow({
      actorUserId,
      companyId: importRow.company_id,
      row: normalizedPayload,
    });
    const customer = await createCustomerGraph(params);

    const { error: updateError } = await supabaseService
      .from("customer_import_rows")
      .update({
        status: "created",
        customer_id: customer.id,
        error_message: null,
        reviewed_at: new Date().toISOString(),
        reviewed_by: actorUserId,
      })
      .eq("id", importRow.id);

    if (updateError) throw updateError;

    await insertAuditLog({
      actorUserId,
      companyId: importRow.company_id,
      entityType: "customer_import_row",
      entityId: importRow.id,
      action: "customer_import_row_created_customer",
      newValues: { customerId: customer.id, status: "created" },
      metadata: {
        importBatchId: importRow.import_batch_id,
        rowNumber: importRow.row_number,
      },
    });

    await recalculateImportBatchCounters(importRow.import_batch_id);

    revalidatePath("/admin/customers");
    revalidatePath("/admin/customers/imports");
    revalidatePath(`/admin/customers/${customer.id}`);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Kunden kunde inte skapas från importraden.";
    await supabaseService
      .from("customer_import_rows")
      .update({
        status: "failed",
        error_message: message,
        reviewed_at: new Date().toISOString(),
        reviewed_by: actorUserId,
      })
      .eq("id", importRow.id);
    await recalculateImportBatchCounters(importRow.import_batch_id);
    revalidatePath("/admin/customers/imports");
    throw error;
  }
}

export async function linkCustomerImportRowToExistingCustomerAction(
  formData: FormData,
) {
  const rowId = getString(formData, "importRowId");
  const existingCustomerId = getString(formData, "existingCustomerId");
  const resolution = normalizeDuplicateResolution(
    getString(formData, "duplicateResolution") || "add_site_to_existing",
  );

  if (!rowId) throw new Error("Import-rad saknas.");
  if (!existingCustomerId)
    throw new Error("Välj befintlig kund innan raden kopplas.");

  const importRow = await loadImportRowForAction(rowId);
  await requireCompanyScopedActionAccess(importRow.company_id, {
    anyOf: ["customers.write"],
  });
  const actorUserId = await getActorUserId();
  await requireCompanyOperationalForWrites(importRow.company_id);

  if (importRow.customer_id || importRow.status === "created") {
    throw new Error("Importraden är redan kopplad till en kund.");
  }

  const normalizedPayload =
    importRow.normalized_payload ?? importRow.raw_payload ?? null;
  if (!normalizedPayload || typeof normalizedPayload !== "object") {
    throw new Error("Importraden saknar normaliserad payload.");
  }

  const params = await buildCustomerParamsFromImportRow({
    actorUserId,
    companyId: importRow.company_id,
    row: {
      ...(normalizedPayload as Record<string, string>),
      existing_customer_id: existingCustomerId,
      duplicate_resolution: resolution,
    },
  });

  params.existingCustomerId = existingCustomerId;
  params.duplicateResolution =
    resolution === "create_new_pending_review" ||
    resolution === "create_separate_confirmed"
      ? "add_site_to_existing"
      : resolution;

  const customer = await createCustomerGraph(params);

  const { error: updateError } = await supabaseService
    .from("customer_import_rows")
    .update({
      status: "created",
      customer_id: customer.id,
      error_message: null,
      reviewed_at: new Date().toISOString(),
      reviewed_by: actorUserId,
      resolution: params.duplicateResolution,
    })
    .eq("id", importRow.id);

  if (updateError && updateError.code !== "42703") throw updateError;

  await insertAuditLog({
    actorUserId,
    companyId: importRow.company_id,
    entityType: "customer_import_row",
    entityId: importRow.id,
    action: "customer_import_row_linked_existing_customer",
    newValues: {
      customerId: customer.id,
      existingCustomerId,
      resolution: params.duplicateResolution,
    },
    metadata: {
      importBatchId: importRow.import_batch_id,
      rowNumber: importRow.row_number,
    },
  });

  await recalculateImportBatchCounters(importRow.import_batch_id);
  revalidatePath("/admin/customers");
  revalidatePath("/admin/customers/imports");
  revalidatePath(`/admin/customers/${customer.id}`);
}

export async function rejectCustomerImportRowAction(formData: FormData) {
  const rowId = getString(formData, "importRowId");
  const reason =
    getString(formData, "reason") || "Avvisad vid manuell granskning.";
  if (!rowId) throw new Error("Import-rad saknas.");

  const importRow = await loadImportRowForAction(rowId);
  await requireCompanyScopedActionAccess(importRow.company_id, {
    anyOf: ["customers.write"],
  });
  const actorUserId = await getActorUserId();

  if (importRow.status === "created") {
    throw new Error("Raden har redan skapat en kund och kan inte avvisas.");
  }

  const { error } = await supabaseService
    .from("customer_import_rows")
    .update({
      status: "rejected",
      error_message: reason,
      reviewed_at: new Date().toISOString(),
      reviewed_by: actorUserId,
    })
    .eq("id", importRow.id);

  if (error) throw error;

  await insertAuditLog({
    actorUserId,
    companyId: importRow.company_id,
    entityType: "customer_import_row",
    entityId: importRow.id,
    action: "customer_import_row_rejected",
    newValues: { status: "rejected", reason },
    metadata: {
      importBatchId: importRow.import_batch_id,
      rowNumber: importRow.row_number,
    },
  });

  await recalculateImportBatchCounters(importRow.import_batch_id);
  revalidatePath("/admin/customers/imports");
}

export async function bulkCreateCustomersAction(formData: FormData) {
  await requireAdminActionAccess({ allOf: ["customers.write"] });
  const actorUserId = await getActorUserId();
  const companyId = await requireOperationalCompanyId(actorUserId);
  await requireCompanyOperationalForWrites(companyId);

  const parsedImport = await parseCustomerImportFormData(formData);
  const rows = parsedImport.rows;
  if (rows.length === 0) {
    throw new Error(
      parsedImport.warnings[0] ?? "Importunderlaget innehöll inga kundrader.",
    );
  }

  const fallbackContractOfferId = getNullableString(
    formData,
    "fallbackContractOfferId",
  );
  const forceFallbackContract =
    formData.get("applyFallbackContractToAll") === "on";
  const file = formData.get("bulkFile");
  const fileName =
    file && typeof file === "object" && "name" in file
      ? String((file as File).name)
      : null;
  const importBatchResult = await supabaseService
    .from("customer_import_batches")
    .insert({
      company_id: companyId,
      source_kind: parsedImport.sourceKind,
      source_type: parsedImport.sourceKind,
      file_name: fileName,
      status: "previewed",
      total_rows: rows.length,
      rows_total: rows.length,
      created_rows: 0,
      rows_created: 0,
      failed_rows: 0,
      rows_failed: 0,
      warnings: parsedImport.warnings,
      issues: parsedImport.warnings.map((warning) => ({ warning })),
      metadata: {
        fallbackContractOfferId,
        forceFallbackContract,
      },
      created_by: actorUserId,
    })
    .select("id")
    .maybeSingle();

  if (
    importBatchResult.error &&
    !databaseObjectMissing(importBatchResult.error)
  ) {
    throw importBatchResult.error;
  }

  const importBatch = importBatchResult.data;

  await recordDocumentAiExtractionForImport({
    companyId,
    actorUserId,
    fileName,
    importBatchId: importBatch?.id ?? null,
    parsedImport,
  });

  let created = 0;
  let review = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const [index, originalRow] of rows.entries()) {
    const rowNumber = index + 2;
    const row: Record<string, string> = {
      ...originalRow,
      country: originalRow.country || "SE",
    };

    try {
      row.contract_offer_id =
        (await resolveContractOfferIdForImport({
          companyId,
          row,
          fallbackContractOfferId,
          forceFallback: forceFallbackContract,
        })) ?? "";

      const params = await buildCustomerParamsFromImportRow({
        actorUserId,
        companyId,
        row,
        fallbackContractOfferId,
        forceFallbackContract,
      });

      const validationErrors = validateCreateCustomerParams(params);
      const duplicateErrors = await findIntakeDuplicates(params);
      const missingFields = importRowMissingFields(row);
      const uncertainFields = importRowUncertainFields(row);
      const duplicateWarnings = Object.values(duplicateErrors).filter(
        (value): value is string => Boolean(value),
      );
      const warnings = [...importRowWarnings(row), ...duplicateWarnings];
      const confidence = calculateImportConfidence(
        row,
        missingFields,
        uncertainFields,
        duplicateWarnings,
      );
      const status =
        Object.keys(validationErrors).length > 0
          ? "missing_fields"
          : classifyImportRow({
              missingFields,
              uncertainFields,
              duplicateWarnings,
              confidence,
            });

      if (status !== "ready_to_create") {
        review += 1;
        await insertImportRow({
          importBatchId: importBatch?.id,
          companyId,
          rowNumber,
          status,
          row,
          warnings,
          missingFields: [
            ...missingFields,
            ...Object.values(validationErrors).filter(
              (value): value is string => Boolean(value),
            ),
          ],
          uncertainFields,
          duplicateWarnings,
          confidence,
        });
        continue;
      }

      const customer = await createCustomerGraph(params);
      created += 1;

      await insertImportRow({
        importBatchId: importBatch?.id,
        companyId,
        rowNumber,
        status: "created",
        row,
        customerId: customer.id,
        warnings,
        missingFields,
        uncertainFields,
        duplicateWarnings,
        confidence,
      });
    } catch (error) {
      failed += 1;
      const intakeError = mapUnknownErrorToIntakeState(error);
      const message = `Rad ${rowNumber}: ${intakeError.message ?? "Okänt fel"}`;
      errors.push(message);

      await insertImportRow({
        importBatchId: importBatch?.id,
        companyId,
        rowNumber,
        status: "failed",
        row,
        errorMessage: intakeError.message ?? "Okänt fel",
        warnings: [],
        missingFields: [],
        uncertainFields: [],
        duplicateWarnings: [],
        confidence: 0,
      });
    }
  }

  if (importBatch?.id) {
    const finalStatus =
      failed > 0 || review > 0 ? "partially_imported" : "completed";
    await supabaseService
      .from("customer_import_batches")
      .update({
        status: finalStatus,
        created_rows: created,
        rows_created: created,
        failed_rows: failed + review,
        rows_failed: failed + review,
        imported_at: new Date().toISOString(),
        metadata: {
          fallbackContractOfferId,
          forceFallbackContract,
          reviewRows: review,
          failedRows: failed,
        },
      })
      .eq("id", importBatch.id);
  }

  await insertAuditLog({
    actorUserId,
    entityType: "customer_bulk_import",
    entityId: importBatch?.id ?? actorUserId,
    action: "customer_bulk_import_completed",
    newValues: {
      created,
      review,
      failed,
    },
    companyId,
    metadata: {
      totalRows: rows.length,
      sourceKind: parsedImport.sourceKind,
      warnings: parsedImport.warnings,
      firstError: errors[0] ?? null,
    },
  });

  revalidatePath("/admin/customers");
  revalidatePath("/admin/customers/intake");
  revalidatePath("/admin/customers/imports");

  return {
    totalRows: rows.length,
    createdRows: created,
    reviewRows: review,
    failedRows: failed,
    warnings: parsedImport.warnings,
    firstError: errors[0] ?? null,
  };
}

function importPreviewLabel(row: Record<string, string>): string {
  const name = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
  return (
    row.company_name ||
    name ||
    row.email ||
    row.org_number ||
    row.personal_number ||
    "Kundrad"
  );
}

function importUniqueKey(row: Record<string, string>): string {
  return (
    row.org_number ||
    row.personal_number ||
    row.email ||
    row.facility_id ||
    row.meter_point_id ||
    ""
  );
}

function normalizeLookupValue(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function rowValue(row: Record<string, string>, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function importRowMissingFields(row: Record<string, string>): string[] {
  const missing: string[] = [];
  const customerType = normalizeCustomerType(row.customer_type || "private");

  if (customerType === "private") {
    if (!rowValue(row, "first_name")) missing.push("förnamn");
    if (!rowValue(row, "last_name")) missing.push("efternamn");
    if (!rowValue(row, "personal_number")) missing.push("personnummer");
  } else {
    if (!rowValue(row, "company_name")) missing.push("företags-/föreningsnamn");
    if (!rowValue(row, "org_number")) missing.push("organisationsnummer");
  }

  if (!rowValue(row, "email") && !rowValue(row, "phone"))
    missing.push("e-post eller telefon");
  if (!rowValue(row, "facility_id")) missing.push("anläggnings-id");
  if (!rowValue(row, "meter_point_id")) missing.push("mätpunkts-id");
  if (!rowValue(row, "grid_owner_id", "grid_owner_name"))
    missing.push("nätägare");
  if (!rowValue(row, "grid_area_code", "grid_area_id"))
    missing.push("nätområde");
  if (
    !rowValue(row, "contract_offer_id", "contract_offer_name", "campaign_name")
  )
    missing.push("avtal/kampanj");
  if (
    !rowValue(
      row,
      "contract_start_date",
      "expected_start_date",
      "move_in_date",
      "start_date",
    )
  )
    missing.push("förväntat startdatum");
  if (!rowValue(row, "authorization_status", "power_of_attorney_status"))
    missing.push("fullmaktsstatus");

  return missing;
}

function importRowUncertainFields(row: Record<string, string>): string[] {
  const uncertain: string[] = [];

  if (row.personal_number && !isSwedishIdentityNumber(row.personal_number))
    uncertain.push("personnummer");
  if (row.org_number && !isSwedishOrgNumber(row.org_number))
    uncertain.push("organisationsnummer");
  if (row.email && !isEmail(row.email)) uncertain.push("e-post");
  if (row.phone && !isSwedishPhone(row.phone)) uncertain.push("telefon");
  if (row.postal_code && !isSwedishPostalCode(row.postal_code))
    uncertain.push("postnummer");
  if (
    row.price_area_code &&
    !["SE1", "SE2", "SE3", "SE4"].includes(row.price_area_code.toUpperCase())
  )
    uncertain.push("elområde");

  return uncertain;
}

function calculateImportConfidence(
  row: Record<string, string>,
  missingFields: string[],
  uncertainFields: string[],
  duplicateWarnings: string[],
): number {
  let score = 100;
  score -= missingFields.length * 10;
  score -= uncertainFields.length * 8;
  score -= duplicateWarnings.length * 20;

  if (row.source_kind === "pdf" || row.parser_source === "pdf") score -= 8;
  if (
    !rowValue(row, "contract_offer_id", "contract_offer_name", "campaign_name")
  )
    score -= 8;

  return Math.max(0, Math.min(100, score));
}

function classifyImportRow(params: {
  missingFields: string[];
  uncertainFields: string[];
  duplicateWarnings: string[];
  confidence: number;
}): CustomerImportPreviewRowStatus {
  if (params.duplicateWarnings.length > 0) return "duplicate_warning";
  if (params.missingFields.length > 0) return "missing_fields";
  if (params.uncertainFields.length > 0 || params.confidence < 85)
    return "requires_review";
  return "ready_to_create";
}

function importRowWarnings(row: Record<string, string>): string[] {
  const warnings: string[] = [];
  const customerType = normalizeCustomerType(row.customer_type || "private");
  if (customerType === "private" && (!row.first_name || !row.last_name)) {
    warnings.push("Privatkund bör ha för- och efternamn.");
  }
  if (customerType === "private" && !row.personal_number) {
    warnings.push("Privatkund saknar personnummer.");
  }
  if (customerType !== "private" && (!row.company_name || !row.org_number)) {
    warnings.push("Företagskund bör ha bolagsnamn och organisationsnummer.");
  }
  if (!row.email && !row.personal_number && !row.org_number) {
    warnings.push("Saknar tydlig unik kundnyckel för dubblettkontroll.");
  }
  if (row.personal_number && !isSwedishIdentityNumber(row.personal_number)) {
    warnings.push("Personnummer har ovanligt format.");
  }
  if (row.org_number && !isSwedishOrgNumber(row.org_number)) {
    warnings.push("Organisationsnummer har ovanligt format.");
  }
  if (row.phone && !isSwedishPhone(row.phone)) {
    warnings.push("Telefonnummer har ovanligt format.");
  }
  if (row.postal_code && !isSwedishPostalCode(row.postal_code)) {
    warnings.push("Postnummer har ovanligt format.");
  }
  if (!row.facility_id && !row.meter_point_id) {
    warnings.push("Anläggnings-id eller mätpunkts-id saknas.");
  }
  if (!row.grid_area_code && !row.grid_area_id) {
    warnings.push("Nätområde/områdes-id saknas.");
  }
  if (!row.authorization_status && !row.power_of_attorney_status) {
    warnings.push("Fullmaktsstatus saknas.");
  }
  if (!row.customer_confirmation_status && !row.customer_confirmation) {
    warnings.push("Kundbekräftelse saknas.");
  }
  return warnings;
}

export async function previewCustomerImportAction(
  _prevState: CustomerImportActionState,
  formData: FormData,
): Promise<CustomerImportActionState> {
  try {
    await requireAdminActionAccess({ allOf: ["customers.write"] });
    const actorUserId = await getActorUserId();
    const companyId = await requireOperationalCompanyId(actorUserId);
    const parsedImport = await parseCustomerImportFormData(formData);
    const previewFile = formData.get("bulkFile");
    const previewFileName =
      previewFile && typeof previewFile === "object" && "name" in previewFile
        ? String((previewFile as File).name)
        : null;

    await recordDocumentAiExtractionForImport({
      companyId,
      actorUserId,
      fileName: previewFileName,
      parsedImport,
    });

    const duplicateKeys = parsedImport.rows
      .map((row) => normalizeLookupValue(importUniqueKey(row)))
      .filter(Boolean)
      .slice(0, 200);

    const existingKeys = new Set<string>();
    if (duplicateKeys.length > 0) {
      const { data: existingCustomers } = await supabaseService
        .from("customers")
        .select("email,personal_number,org_number")
        .eq("company_id", companyId)
        .or(
          duplicateKeys
            .flatMap((key) => [
              `email.ilike.${key}`,
              `personal_number.eq.${key}`,
              `org_number.eq.${key}`,
            ])
            .join(","),
        );

      for (const customer of existingCustomers ?? []) {
        for (const value of [
          customer.email,
          customer.personal_number,
          customer.org_number,
        ]) {
          if (value) existingKeys.add(normalizeLookupValue(String(value)));
        }
      }
    }

    const rows: CustomerImportPreviewRow[] = parsedImport.rows
      .slice(0, 50)
      .map((row, index) => {
        const uniqueKey = importUniqueKey(row);
        const duplicateWarnings =
          uniqueKey && existingKeys.has(normalizeLookupValue(uniqueKey))
            ? ["Möjlig dubblett hittades i kundregistret."]
            : [];
        const missingFields = importRowMissingFields(row);
        const uncertainFields = importRowUncertainFields(row);
        const warnings = [...importRowWarnings(row), ...duplicateWarnings];
        const confidence = calculateImportConfidence(
          row,
          missingFields,
          uncertainFields,
          duplicateWarnings,
        );
        const status = classifyImportRow({
          missingFields,
          uncertainFields,
          duplicateWarnings,
          confidence,
        });

        return {
          rowNumber: index + 2,
          label: importPreviewLabel(row),
          uniqueKey,
          status,
          confidence,
          warnings,
          missingFields,
          uncertainFields,
          duplicateWarnings,
          payload: row,
        };
      });

    return {
      status: "success",
      message: `Förhandsgranskning klar: ${parsedImport.rows.length} rader hittades. Kontrollera varningar innan import.`,
      totalRows: parsedImport.rows.length,
      createdRows: 0,
      failedRows: 0,
      reviewRows: rows.filter((row) => row.status !== "ready_to_create").length,
      warnings: parsedImport.warnings,
      rows,
    };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "Importunderlaget kunde inte förhandsgranskas.",
      totalRows: 0,
      createdRows: 0,
      failedRows: 0,
      reviewRows: 0,
      warnings: [],
      rows: [],
    };
  }
}

export async function commitCustomerImportAction(
  _prevState: CustomerImportActionState,
  formData: FormData,
): Promise<CustomerImportActionState> {
  try {
    const result = await bulkCreateCustomersAction(formData);
    return {
      status: result.failedRows > 0 ? "error" : "success",
      message:
        result.reviewRows > 0 || result.failedRows > 0
          ? `Importen skapade ${result.createdRows} kunder. ${result.reviewRows} rader ligger i granskningskö och ${result.failedRows} rader misslyckades.`
          : `Importen slutfördes med ${result.createdRows} skapade kunder.`,
      totalRows: result.totalRows,
      createdRows: result.createdRows,
      failedRows: result.failedRows,
      reviewRows: result.reviewRows,
      warnings: result.warnings,
      rows: [],
    };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "Importen kunde inte slutföras.",
      totalRows: 0,
      createdRows: 0,
      failedRows: 0,
      reviewRows: 0,
      warnings: [],
      rows: [],
    };
  }
}
