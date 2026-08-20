// Extracted from actions.ts; keep public imports on the facade module.
import { revalidatePath } from "next/cache"
import { createHash } from "node:crypto"

import { requireAdminActionAccess, requireCompanyScopedActionAccess } from "@/lib/admin/guards"
import { supabaseService } from "@/lib/supabase/service"
import { requireOperationalCompanyId } from "@/lib/tenant/scope"
import { requireCompanyOperationalForWrites } from "@/lib/tenant/governance"
import { parseCustomerImportFormData } from "@/lib/customers/importParser"



import { completeCustomerApplicationIntake, failCustomerApplicationIntake, getOrCreateCustomerApplicationIntake } from "@/lib/intakes/customerApplicationIntakes"
import type { CustomerImportPreviewRowStatus, IntakeActionState } from "./actionState"








import type { ContractStatus, CreateCustomerGraphParams, PriceAreaCode, SiteType } from './actions.part-1'
import { buildCreateCustomerParams, getActorUserId, getFormValues, getString, insertAuditLog, normalizeBillingLevel, normalizeCustomerType, normalizeDuplicateResolution, normalizeIntakeFlowType, parseContractType, parseGreenFeeMode, parseIntOrNull, parseNumber, parseOptionalFeeLines, resolveOrCreateCurrentSupplierForIntake, resolveOrCreateGridOwnerForIntake } from './actions.part-1'
import type { CustomerGraphResult } from './actions.part-2'
import { ADMIN_INTAKE_IN_PROGRESS_STALE_MS, ADMIN_INTAKE_ROUTE, createCustomerGraph, databaseObjectMissing, mapUnknownErrorToIntakeState } from './actions.part-2'
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
  ].join("|");
  const digest = createHash("sha256").update(identity).digest("hex");
  return `customer_create:${params.companyId}:${digest}`;
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

    const idempotencyKey = buildAdminIntakeIdempotencyKey(params);
    const { intake } = await getOrCreateCustomerApplicationIntake({
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
      return {
        status: "success",
        message:
          "Denna intagning är redan registrerad (idempotent återuppspelning). Ingen ny kund skapades.",
        fieldErrors: {},
        values: { country: "SE" },
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
        duplicateWarnings: [],
        duplicateReviewRequired: false,
      };
    }

    if (
      intake &&
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
      customer = await createCustomerGraph(params);
    } catch (graphError) {
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
          created_power_of_attorney_id:
            customer.__createdPowerOfAttorneyId ?? null,
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

export type CustomerImportRowForAction = CustomerImportRowRecord & {
  company_id: string;
};

export async function loadImportRowForAction(
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
