// Extracted from actions.ts; keep public imports on the facade module.
import { revalidatePath } from "next/cache"


import { requireAdminActionAccess } from "@/lib/admin/guards"
import { supabaseService } from "@/lib/supabase/service"
import { requireOperationalCompanyId } from "@/lib/tenant/scope"
import { requireCompanyOperationalForWrites } from "@/lib/tenant/governance"
import { parseCustomerImportFormData } from "@/lib/customers/importParser"


import { matchCustomerIdentity } from "@/lib/customers/matchingService"
import { completeCustomerApplicationIntake, failCustomerApplicationIntake, getOrCreateCustomerApplicationIntake } from "@/lib/intakes/customerApplicationIntakes"
import type { CustomerImportActionState, CustomerImportPreviewRow, CustomerImportPreviewRowStatus } from "./actionState"








import { getActorUserId, getNullableString, insertAuditLog, isEmail, isSwedishIdentityNumber, isSwedishOrgNumber, isSwedishPhone, isSwedishPostalCode, normalizeCustomerType, validateCreateCustomerParams } from './actions.part-1'
import { createCustomerGraph, databaseObjectMissing, findIntakeDuplicates, mapUnknownErrorToIntakeState } from './actions.part-2'
import { buildAdminIntakeIdempotencyKey, buildCustomerParamsFromImportRow, insertImportRow, recordDocumentAiExtractionForImport, resolveContractOfferIdForImport } from './actions.part-3'

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

      // Per-row intake idempotency: re-running the same import (double
      // submission, retry after partial failure) must never create the same
      // customer twice. Same ledger as the single-intake form.
      const idempotencyKey = buildAdminIntakeIdempotencyKey(params);
      const { intake: rowIntake } = await getOrCreateCustomerApplicationIntake({
        companyId,
        apiClientId: null,
        route: "admin/customers/import",
        method: "create",
        idempotencyKey,
        payload: { idempotencyKey, importBatchId: importBatch?.id ?? null, rowNumber },
      });

      if (rowIntake && rowIntake.status === "completed") {
        const storedResult =
          rowIntake.result && typeof rowIntake.result === "object"
            ? (rowIntake.result as Record<string, unknown>)
            : {};
        const existingCustomerId =
          (typeof rowIntake.customer_id === "string" ? rowIntake.customer_id : null) ??
          (typeof storedResult.customer_id === "string" ? (storedResult.customer_id as string) : null);
        review += 1;
        await insertImportRow({
          importBatchId: importBatch?.id,
          companyId,
          rowNumber,
          status: "skipped",
          row,
          customerId: existingCustomerId,
          warnings: [...warnings, "Raden är redan importerad (idempotent återuppspelning)."],
          missingFields,
          uncertainFields,
          duplicateWarnings,
          confidence,
        });
        continue;
      }

      let customer: Awaited<ReturnType<typeof createCustomerGraph>>;
      try {
        customer = await createCustomerGraph(params);
      } catch (graphError) {
        if (rowIntake) {
          await failCustomerApplicationIntake({
            intakeId: rowIntake.id,
            companyId,
            errorMessage: graphError instanceof Error ? graphError.message : "Okänt fel",
          }).catch(() => undefined);
        }
        throw graphError;
      }
      created += 1;

      if (rowIntake) {
        await completeCustomerApplicationIntake({
          intakeId: rowIntake.id,
          companyId,
          customerId: customer.id,
          result: { customer_id: customer.id, import_batch_id: importBatch?.id ?? null, row_number: rowNumber },
        }).catch(() => undefined);
      }

      // Per-customer audit entry: the batch summary alone cannot answer who
      // created a specific customer from which import row.
      await insertAuditLog({
        actorUserId,
        companyId,
        entityType: "customer",
        entityId: customer.id,
        action: "customer_created_from_import",
        metadata: {
          importBatchId: importBatch?.id ?? null,
          rowNumber,
          source: "customer_bulk_import",
        },
      }).catch(() => undefined);

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

export function importPreviewLabel(row: Record<string, string>): string {
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

export function importUniqueKey(row: Record<string, string>): string {
  return (
    row.org_number ||
    row.personal_number ||
    row.email ||
    row.facility_id ||
    row.meter_point_id ||
    ""
  );
}

export function rowValue(row: Record<string, string>, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function importRowMissingFields(row: Record<string, string>): string[] {
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

export function importRowUncertainFields(row: Record<string, string>): string[] {
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

export function calculateImportConfidence(
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

export function classifyImportRow(params: {
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

export function importRowWarnings(row: Record<string, string>): string[] {
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

    // Preview dedupe uses the SAME canonical matcher as the intake flow
    // (matchCustomerIdentity), so a row classified ready_to_create here can
    // never be flagged as a duplicate by the create path.
    const previewRows = parsedImport.rows.slice(0, 50);
    const duplicateWarningsByIndex = new Map<number, string[]>();
    for (let index = 0; index < previewRows.length; index += 1) {
      const row = previewRows[index];
      try {
        const decision = await matchCustomerIdentity({
          companyId,
          personalNumber: row.personal_number ?? null,
          orgNumber: row.org_number ?? null,
          email: row.email ?? null,
          phone: row.phone ?? null,
          select: "id, customer_number, full_name, company_name, email",
        });
        if (decision.candidates.length > 0) {
          duplicateWarningsByIndex.set(index, [
            "Möjlig dubblett hittades i kundregistret.",
          ]);
        }
      } catch (matchError) {
        if (!databaseObjectMissing(matchError)) throw matchError;
      }
    }

    const rows: CustomerImportPreviewRow[] = previewRows
      .map((row, index) => {
        const uniqueKey = importUniqueKey(row);
        const duplicateWarnings = duplicateWarningsByIndex.get(index) ?? [];
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
