// Extracted from actions.ts; keep public imports on the facade module.
import { revalidatePath } from "next/cache"
import { createHash } from "node:crypto"

import { isPlatformAdminContext, type GuardResult } from "@/lib/admin/guards"
import { hasPermissionRequirement } from "@/lib/admin/accessModel"
import { MASTERDATA_PERMISSIONS } from "@/lib/admin/masterdataPermissions"

// Mirrors the manual signing-link action's contracts.write requirement.
function canWriteContracts(guard: GuardResult): boolean {
  return isPlatformAdminContext(guard) || hasPermissionRequirement(guard.permissions, { allOf: ["contracts.write"] })
}
import { supabaseService } from "@/lib/supabase/service"
import { requireAdminCustomerIntakeContext } from "@/lib/customers/adminIntakeScope"
import { parseCustomerImportFormData } from "@/lib/customers/importParser"



import { completeCustomerApplicationIntake, failCustomerApplicationIntake, getOrCreateCustomerApplicationIntake } from "@/lib/intakes/customerApplicationIntakes"
import type { CustomerImportPreviewRowStatus, IntakeActionState } from "./actionState"








import type { ContractStatus, CreateCustomerGraphParams, PriceAreaCode, SiteType } from './actions.part-1'
import { buildCreateCustomerParams, getFormValues, getString, insertAuditLog, normalizeBillingLevel, normalizeCustomerType, normalizeDuplicateResolution, normalizeIntakeFlowType, parseContractType, parseGreenFeeMode, parseIntOrNull, parseNumber, parseOptionalFeeLines, resolveOrCreateCurrentSupplierForIntake, resolveOrCreateGridOwnerForIntake } from './actions.part-1'
import type { CustomerGraphResult } from './actions.part-2'
import { CustomerGraphCommittedReviewError, ADMIN_INTAKE_IN_PROGRESS_STALE_MS, ADMIN_INTAKE_ROUTE, createCustomerGraph, databaseObjectMissing, mapUnknownErrorToIntakeState } from './actions.part-2'
import { rowValue } from './actions.part-4'

export function buildAdminIntakeIdempotencyKey(
  params: CreateCustomerGraphParams,
): string {
  // Deterministic key over the business-relevant intake fields so an
  // accidental double submission of the same form never creates a second
  // customer/site/contract graph, while a deliberately different intake
  // (e.g. second site for the same customer) gets its own key.
  const identity = [
    params.customerType,
    params.personalNumber ?? "",
    params.orgNumber ?? "",
    params.email ?? "",
    params.phone ?? "",
    params.firstName ?? "",
    params.lastName ?? "",
    params.companyName ?? "",
    params.facilityId ?? "",
    params.meterPointId ?? "",
    params.street ?? "",
    params.postalCode ?? "",
    params.city ?? "",
    params.siteName ?? "",
    params.contractOfferId ?? "",
    params.contractStartDate ?? "",
    String(params.monthlyFeeSek ?? ""),
    String(params.invoiceFeeSek ?? ""),
    String(params.startFeeSek ?? ""),
    String(params.adminFeeSek ?? ""),
    String(params.breakFeeSek ?? ""),
    params.expectedStartDate ?? "",
    params.duplicateResolution ?? "",
    params.existingCustomerId ?? "",
    // Pricing/contract terms: a corrected special price must not be treated
    // as a replay of the earlier submission.
    params.contractTypeOverride ?? "",
    params.contractStatus ?? "",
    params.contractSigningMethod ?? "",
    params.contractSignedDate ?? "",
    String(params.fixedPriceOrePerKwh ?? ""),
    String(params.spotMarkupOrePerKwh ?? ""),
    String(params.variableFeeOrePerKwh ?? ""),
    params.greenFeeMode ?? "",
    String(params.greenFeeValue ?? ""),
    params.overrideReason ?? "",
    String(params.bindingMonths ?? ""),
    String(params.noticeMonths ?? ""),
    JSON.stringify(params.optionalFeeLines ?? []),
  ].join("|");
  const digest = createHash("sha256").update(identity).digest("hex");
  return `customer_create:${params.companyId}:${digest}`;
}

export async function createCustomerAction(
  _prevState: IntakeActionState,
  formData: FormData,
): Promise<IntakeActionState> {
  try {
    const { actor: guard, companyId } = await requireAdminCustomerIntakeContext();
    const actorUserId = guard.userId;
    let params = buildCreateCustomerParams(formData, actorUserId, companyId);
    const canRequestData = isPlatformAdminContext(guard)
      || hasPermissionRequirement(guard.permissions, { allOf: [MASTERDATA_PERMISSIONS.WRITE] });
    if (params.postCreateAction === "request_data" && !canRequestData) {
      throw new Error("Direkt uppgiftsbegäran kräver behörighet att ändra masterdata. Välj ett annat nästa steg.");
    }

    const idempotencyKey = buildAdminIntakeIdempotencyKey(params);
    const { intake, created: intakeCreated } = await getOrCreateCustomerApplicationIntake({
      companyId,
      apiClientId: null,
      route: ADMIN_INTAKE_ROUTE,
      method: "create",
      idempotencyKey,
      payload: { idempotencyKey },
    });

    if (intake && intake.status === "completed") {
      const storedResult =
        intake.result && typeof intake.result === "object"
          ? (intake.result as Record<string, unknown>)
          : {};
      if (storedResult.review_required === true) {
        return {status:'committed_review', message:'Kunden är redan registrerad. Dokument- eller signeringssteget behöver granskas på befintligt kundkort. Skapa inte kunden igen.',
          fieldErrors:{}, values:getFormValues(formData),
          createdCustomerId:typeof storedResult.customer_id === 'string' ? storedResult.customer_id : intake.customer_id ?? null,
          createdSiteId:typeof storedResult.created_site_id === 'string' ? storedResult.created_site_id : null,
          createdMeteringPointId:typeof storedResult.created_metering_point_id === 'string' ? storedResult.created_metering_point_id : null,
          createdContractId:typeof storedResult.created_contract_id === 'string' ? storedResult.created_contract_id : null,
          correlationId:typeof storedResult.correlation_id === 'string' ? storedResult.correlation_id : null}
      }
      const savedAction = storedResult.post_create_action;
      const savedTarget = storedResult.post_create_request_target;
      const postCreateAction = savedAction === "open_customer" || savedAction === "create_new"
        || (savedAction === "request_data" && canRequestData) ? savedAction : undefined;
      const postCreateRequestTarget = canRequestData
        && (savedTarget === "grid_owner" || savedTarget === "current_supplier" || savedTarget === "both")
        ? savedTarget
        : undefined;
      return {
        status: "success",
        message:
          "Den här kunden och avtalet är redan registrerade.",
        fieldErrors: {},
        values: { country: "SE", postCreateAction, postCreateRequestTarget },
        createdCustomerId:
          (typeof intake.customer_id === "string" ? intake.customer_id : null) ??
          (typeof storedResult.customer_id === "string"
            ? (storedResult.customer_id as string)
            : null),
        createdSiteId:
          typeof storedResult.created_site_id === "string"
            ? (storedResult.created_site_id as string)
            : null,
        createdMeteringPointId:
          typeof storedResult.created_metering_point_id === "string"
            ? (storedResult.created_metering_point_id as string)
            : null,
        createdGridOwnerId: canRequestData && typeof storedResult.created_grid_owner_id === "string"
          ? storedResult.created_grid_owner_id : null,
        createdPowerOfAttorneyId: canRequestData && typeof storedResult.created_power_of_attorney_id === "string"
          ? storedResult.created_power_of_attorney_id : null,
        createdCurrentSupplierName: canRequestData && typeof storedResult.created_current_supplier_name === "string"
          ? storedResult.created_current_supplier_name : null,
        postCreateAction,
        postCreateRequestTarget,
        duplicateWarnings: [],
        duplicateReviewRequired: false,
      };
    }

    if (
      !intakeCreated && intake &&
      intake.status !== "failed" &&
      intake.status !== "completed" &&
      Date.now() - new Date(intake.updated_at).getTime() <
        ADMIN_INTAKE_IN_PROGRESS_STALE_MS
    ) {
      return {
        status: "error",
        message:
          "En identisk intagning bearbetas redan. Vänta en stund och kontrollera kundlistan innan du försöker igen.",
        fieldErrors: {},
        values: getFormValues(formData),
        createdCustomerId: null,
      };
    }

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

    let customer: CustomerGraphResult;
    try {
      customer = await createCustomerGraph(params, {
        autoSendSigningLink: { actorCanWriteContracts: canWriteContracts(guard) },
        onCoreCommitted: async (receipt) => {
          if (!intake) throw new Error('intake_receipt_unavailable')
          const result = {review_required:true,customer_id:receipt.customer_id,created_site_id:receipt.site_id,
            created_metering_point_id:receipt.metering_point_id,created_contract_id:receipt.contract_id,
            correlation_id:receipt.correlation_id}
          // Strict, exact tenant-scoped receipt. The generic compatibility helper
          // can discard result columns or match zero rows, so it is not a fence.
          let marker = supabaseService.from('customer_application_intakes')
            .update({stage:'completed',status:'completed',customer_id:receipt.customer_id,result,updated_at:new Date().toISOString()})
            .eq('id',intake.id).eq('company_id',companyId)
            // Raw PostgreSQL timestamp is preserved; no JS millisecond rewrite.
            .eq('updated_at',intake.updated_at)
          marker = intake.status === null ? marker.is('status',null) : marker.eq('status',intake.status)
          const saved = await marker.select('id,company_id,status,customer_id,result').single()
          const row=saved.data
          const recorded=row?.result && typeof row.result === 'object' && !Array.isArray(row.result)
            ? row.result as Record<string,unknown> : null
          if(saved.error || !row || row.id!==intake.id || row.company_id!==companyId || row.status!=='completed'
            || row.customer_id!==receipt.customer_id || !recorded
            || Object.entries(result).some(([key,value])=>recorded[key]!==value)) {
            throw new Error('core_commit_review_receipt_unconfirmed')
          }
        },
      });
    } catch (graphError) {
      if (graphError instanceof CustomerGraphCommittedReviewError) {
        const receipt=graphError.receipt
        return {status:'committed_review',message:graphError.message,fieldErrors:{},values:getFormValues(formData),
          createdCustomerId:receipt.customer_id,createdSiteId:receipt.site_id,
          createdMeteringPointId:receipt.metering_point_id,createdContractId:receipt.contract_id,
          correlationId:receipt.correlation_id}
      }
      if (intake) {
        await failCustomerApplicationIntake({
          intakeId: intake.id,
          companyId,
          errorMessage:
            graphError instanceof Error
              ? graphError.message
              : String(graphError),
        }).catch(() => undefined);
      }
      throw graphError;
    }

    if (intake) {
      await completeCustomerApplicationIntake({
        intakeId: intake.id,
        companyId,
        customerId: typeof customer.id === "string" ? customer.id : null,
        result: {
          customer_id: customer.id ?? null,
          customer_number: customer.customer_number ?? null,
          created_site_id: customer.__createdSiteId ?? null,
          created_metering_point_id: customer.__createdMeteringPointId ?? null,
          created_grid_owner_id: customer.__createdGridOwnerId ?? null,
          created_power_of_attorney_id: customer.__createdPowerOfAttorneyId ?? null,
          created_current_supplier_name: customer.__createdCurrentSupplierName ?? null,
          post_create_action: params.postCreateAction,
          post_create_request_target: params.postCreateRequestTarget,
        },
      }).catch(() => undefined);
    }

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
    const signingSummary = customer.__signingLink?.message
      ? ` ${customer.__signingLink.message}`
      : "";

    return {
      status: "success",
      message:
        allWarnings.length > 0
          ? `${usedExistingCustomer ? "Befintlig kund uppdaterades" : "Kunden skapades"}. Kontrollera varningar: ${allWarnings.slice(0, 3).join(" ")}${documentSummary}${signingSummary}`
          : `${usedExistingCustomer ? "Befintlig kund uppdaterades" : `Kunden ${customer.customer_number ?? ""} skapades`}. Eventuella saknade uppgifter visas på kundkortet.${documentSummary}${signingSummary}`,
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

export async function resolveContractOfferIdForImport(params: {
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

export async function insertImportRow(params: {
  importBatchId: string | null | undefined;
  companyId: string;
  rowNumber: number;
  status: CustomerImportPreviewRowStatus | "failed" | "skipped";
  row: Record<string, string>;
  customerId?: string | null;
  errorMessage?: string | null;
  warnings?: string[];
  missingFields?: string[];
  uncertainFields?: string[];
  duplicateWarnings?: string[];
  confidence?: number;
}) {
  if (!params.importBatchId) return false;

  const { error } = await supabaseService.from("customer_import_rows").insert({
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
  return error === null;
}

export async function recordDocumentAiExtractionForImport(params: {
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

export type CustomerImportRowRecord = {
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

export async function resolveGridOwnerIdForImport(params: {
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

export async function buildCustomerParamsFromImportRow(params: {
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
    invoiceFeeSek: parseNumber(row.invoice_fee_sek || ""),
    startFeeSek: parseNumber(row.start_fee_sek || ""),
    adminFeeSek: parseNumber(row.admin_fee_sek || ""),
    breakFeeSek: parseNumber(row.break_fee_sek || ""),
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
    gridInvoiceFile: null,
    postCreateAction: "open_customer",
    postCreateRequestTarget: "both",
  };
}

export async function recalculateImportBatchCounters(
  importBatchId: string | null | undefined,
  companyId: string,
) {
  if (!importBatchId) return;

  const { data: rows, error } = await supabaseService
    .from("customer_import_rows")
    .select("status")
    .eq("import_batch_id", importBatchId)
    .eq("company_id", companyId);

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
    .eq("id", importBatchId)
    .eq("company_id", companyId);

  if (updateError && !databaseObjectMissing(updateError)) throw updateError;
}

export type CustomerImportRowForAction = CustomerImportRowRecord & {
  company_id: string;
};

async function loadImportRowForAction(
  rowId: string,
  companyId: string,
): Promise<CustomerImportRowForAction> {
  const { data, error } = await supabaseService
    .from("customer_import_rows")
    .select("*")
    .eq("id", rowId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Importraden hittades inte.");

  const row = data as CustomerImportRowRecord;
  if (row.company_id !== companyId) throw new Error("Importraden hittades inte.");

  return row as CustomerImportRowForAction;
}

const IMPORT_REVIEW_RECEIPT_COLUMNS = "id, company_id, status, customer_id, reviewed_at, reviewed_by";

type ImportReview = {
  companyId: string;
  actorUserId: string;
} & (
  | { status: "created"; customerId: string; resolution?: CreateCustomerGraphParams["duplicateResolution"]; errorMessage?: never }
  | { status: "rejected"; customerId: null; resolution?: never; errorMessage: string }
);

type ImportReviewReceipt = ImportReview & {
  rowId: string;
  reviewedAt: string;
};

function hasImportReviewColumns(row: CustomerImportRowForAction, requireResolution = false): boolean {
  // A full row includes nullable columns. Missing keys indicate that the
  // legacy database cannot record the required review.
  return Object.hasOwn(row, "reviewed_at") && Object.hasOwn(row, "reviewed_by") &&
    (!requireResolution || Object.hasOwn(row, "resolution"));
}

function matchesImportReviewReceipt(value: unknown, expected: ImportReviewReceipt): boolean {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return row.id === expected.rowId && row.company_id === expected.companyId &&
    row.status === expected.status && row.customer_id === expected.customerId &&
    row.reviewed_by === expected.actorUserId && row.error_message === (expected.errorMessage ?? null) &&
    (expected.resolution === undefined || row.resolution === expected.resolution) &&
    typeof row.reviewed_at === "string" && Date.parse(row.reviewed_at) === Date.parse(expected.reviewedAt);
}

async function persistImportReviewReceipt(row: CustomerImportRowForAction, review: ImportReview) {
  const expected = { ...review, rowId: row.id, reviewedAt: new Date().toISOString() };
  const columns = `${IMPORT_REVIEW_RECEIPT_COLUMNS}, ${review.resolution === undefined ? "" : "resolution, "}error_message`;

  const { data: receipt, error: updateError } = await supabaseService
    .from("customer_import_rows")
    .update({
      status: expected.status,
      customer_id: expected.customerId,
      reviewed_at: expected.reviewedAt,
      reviewed_by: expected.actorUserId,
      ...(expected.resolution === undefined ? {} : { resolution: expected.resolution }),
      error_message: expected.errorMessage ?? null,
    })
    .eq("id", expected.rowId)
    .eq("company_id", expected.companyId)
    .eq("status", row.status)
    .is("customer_id", null)
    .select(columns)
    .maybeSingle();

  if (!updateError && matchesImportReviewReceipt(receipt, expected)) return;

  // If the write response was lost, verify the exact committed row once.
  const { data: storedReceipt, error: readError } = await supabaseService
    .from("customer_import_rows")
    .select(columns)
    .eq("id", expected.rowId)
    .eq("company_id", expected.companyId)
    .maybeSingle();

  if (readError || !matchesImportReviewReceipt(storedReceipt, expected)) {
    const message = expected.status === "rejected"
      ? "Avvisningen kunde inte bekräftas. Kontrollera importraden innan du försöker igen."
      : "Kundändringen och granskningsraden kunde inte bekräftas tillsammans. Kontrollera kunden och importraden innan du försöker igen.";
    throw new Error(message, { cause: updateError ?? readError });
  }
}

export async function createCustomerFromImportRowAction(formData: FormData) {
  const rowId = getString(formData, "importRowId");
  if (!rowId) throw new Error("Import-rad saknas.");

  const { actor, companyId } = await requireAdminCustomerIntakeContext();
  const actorUserId = actor.userId;
  const importRow = await loadImportRowForAction(rowId, companyId);

  if (importRow.status === "rejected") {
    throw new Error("Importraden är avvisad och kan inte ändra kunduppgifter.");
  }

  if (importRow.customer_id || importRow.status === "created") {
    throw new Error("Importraden har redan skapat en kund.");
  }

  if (!hasImportReviewColumns(importRow)) {
    throw new Error("Den äldre importkön kan inte spara ett granskat kundskapande. Kundposten har inte ändrats.");
  }

  const normalizedPayload =
    importRow.normalized_payload ?? importRow.raw_payload ?? null;
  if (!normalizedPayload || typeof normalizedPayload !== "object") {
    throw new Error("Importraden saknar normaliserad payload.");
  }

  const params = await buildCustomerParamsFromImportRow({
    actorUserId,
    companyId,
    row: normalizedPayload,
  });
  const customer = await createCustomerGraph(params);

  try {
    await persistImportReviewReceipt(importRow, {
      companyId,
      status: "created",
      customerId: customer.id,
      actorUserId,
    });
    await insertAuditLog({
      actorUserId,
      companyId,
      entityType: "customer_import_row",
      entityId: importRow.id,
      action: "customer_import_row_created_customer",
      newValues: { customerId: customer.id, status: "created" },
      metadata: {
        importBatchId: importRow.import_batch_id,
        rowNumber: importRow.row_number,
      },
    });
    await recalculateImportBatchCounters(importRow.import_batch_id, companyId);
  } finally {
    revalidatePath("/admin/customers");
    revalidatePath("/admin/customers/imports");
    revalidatePath(`/admin/customers/${customer.id}`);
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

  const { actor, companyId } = await requireAdminCustomerIntakeContext();
  const actorUserId = actor.userId;
  const importRow = await loadImportRowForAction(rowId, companyId);

  if (importRow.status === "rejected") {
    throw new Error("Importraden är avvisad och kan inte ändra kunduppgifter.");
  }

  if (importRow.customer_id || importRow.status === "created") {
    throw new Error("Importraden är redan kopplad till en kund.");
  }

  if (!hasImportReviewColumns(importRow, true)) {
    throw new Error("Den äldre importkön kan inte spara en granskad koppling. Kundposten har inte ändrats.");
  }

  const normalizedPayload =
    importRow.normalized_payload ?? importRow.raw_payload ?? null;
  if (!normalizedPayload || typeof normalizedPayload !== "object") {
    throw new Error("Importraden saknar normaliserad payload.");
  }

  const params = await buildCustomerParamsFromImportRow({
    actorUserId,
    companyId,
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
  if (customer.id.toLowerCase() !== existingCustomerId.toLowerCase()) {
    throw new Error("Kundändringen avser en annan kund än den valda. Kontrollera kunden och importraden.");
  }

  try {
    await persistImportReviewReceipt(importRow, {
      companyId,
      status: "created",
      customerId: customer.id,
      actorUserId,
      resolution: params.duplicateResolution,
    });
    await insertAuditLog({
      actorUserId,
      companyId,
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

    await recalculateImportBatchCounters(importRow.import_batch_id, companyId);
  } finally {
    revalidatePath("/admin/customers");
    revalidatePath("/admin/customers/imports");
    revalidatePath(`/admin/customers/${customer.id}`);
  }
}

export async function rejectCustomerImportRowAction(formData: FormData) {
  const rowId = getString(formData, "importRowId");
  const reason =
    getString(formData, "reason") || "Avvisad vid manuell granskning.";
  if (!rowId) throw new Error("Import-rad saknas.");

  const { actor, companyId } = await requireAdminCustomerIntakeContext();
  const actorUserId = actor.userId;
  const importRow = await loadImportRowForAction(rowId, companyId);

  if (importRow.status === "created" || importRow.customer_id) {
    throw new Error("Raden är redan kopplad till en kund och kan inte avvisas.");
  }
  if (importRow.status === "rejected") {
    throw new Error("Importraden är redan avvisad.");
  }
  if (!hasImportReviewColumns(importRow)) {
    throw new Error("Den äldre importkön kan inte spara en granskad avvisning.");
  }

  try {
    await persistImportReviewReceipt(importRow, {
      companyId,
      actorUserId,
      status: "rejected",
      customerId: null,
      errorMessage: reason,
    });
    await insertAuditLog({
      actorUserId,
      companyId,
      entityType: "customer_import_row",
      entityId: importRow.id,
      action: "customer_import_row_rejected",
      newValues: { status: "rejected", reason },
      metadata: {
        importBatchId: importRow.import_batch_id,
        rowNumber: importRow.row_number,
      },
    });

    await recalculateImportBatchCounters(importRow.import_batch_id, companyId);
  } finally {
    revalidatePath("/admin/customers/imports");
  }
}
