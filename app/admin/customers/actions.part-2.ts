// Extracted from actions.ts; keep public imports on the facade module.


import { createSupabaseServerClient } from "@/lib/supabase/server"

import { supabaseService } from "@/lib/supabase/service"




import { normalizeGridOwnerIdToOps } from "@/lib/grid-owners/platformGridOwnerResolver"
import { matchCustomerIdentity, type CustomerMatchSignal } from "@/lib/customers/matchingService"

import type { IntakeActionState, IntakeField, IntakeFieldErrors, IntakeFormValues } from "./actionState"
import { getContractOfferById } from "@/lib/customer-contracts/db"

import { saveCustomerAuthorizationDocument } from "@/lib/operations/db"


import { processManualCustomerIntake, processPdfCustomerIntake } from "@/lib/customer-operations/customerIntakeOrchestrator"
import { canonicalIdempotencyKey, onboardCustomerGraph, signedAuthorizationScopes } from "@/lib/customers/canonicalOnboarding"
import { createTenantContext } from "@/lib/tenant/context"
import type { CreateCustomerGraphParams, IntakeDocumentUploadResult } from './actions.part-1'
import { IntakeValidationError, buildBillingAddressSnapshot, buildCustomerDocumentPath, checksumFile, createValidationErrorFromFieldErrors, insertAuditLog, normalizeCountryCode, normalizeOptionalString, validateCreateCustomerParams } from './actions.part-1'
import { buildAdminIntakeIdempotencyKey } from './actions.part-3'

export async function uploadCustomerIntakeDocuments(params: {
  companyId: string;
  actorUserId: string;
  customerId: string;
  siteId: string | null;
  meteringPointId: string | null;
  contractId: string | null;
  existingPowerOfAttorneyId: string | null;
  existingAuthorizationDocumentId: string | null;
  signedScopes: string[];
  signedAgreementFile: File | null;
  signedPowerOfAttorneyFile: File | null;
  gridInvoiceFile: File | null;
  authorizationValidFrom: string | null;
  authorizationValidTo: string | null;
}): Promise<IntakeDocumentUploadResult> {
  const result: IntakeDocumentUploadResult = {
    uploadedDocumentIds: [],
    powerOfAttorneyId: null,
    uploadedLabels: [],
  };

  if (!params.signedAgreementFile && !params.signedPowerOfAttorneyFile && !params.gridInvoiceFile) {
    return result;
  }

  const supabase = await createSupabaseServerClient();
  const bucket = "customer-documents";

  async function uploadFile(
    file: File,
    documentType: "power_of_attorney" | "complete_agreement" | "grid_invoice_suggested",
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
    if (
      !params.existingPowerOfAttorneyId ||
      !params.existingAuthorizationDocumentId ||
      params.signedScopes.length === 0
    ) {
      throw new Error("Den kanoniska kundtransaktionen saknar signerad fullmaktskedja.");
    }

    const uploaded = await uploadFile(
      params.signedPowerOfAttorneyFile,
      "power_of_attorney",
    );

    const { error: poaUpdateError } = await supabaseService
      .from("powers_of_attorney")
      .update({
        document_path: uploaded.filePath,
        document_hash: uploaded.checksum,
        signed_scope_snapshot: params.signedScopes,
        scope_summary: {
          scopes: params.signedScopes,
          source: "canonical_admin_intake",
        },
        updated_by: params.actorUserId,
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", params.companyId)
      .eq("customer_id", params.customerId)
      .eq("id", params.existingPowerOfAttorneyId);
    if (poaUpdateError) throw poaUpdateError;

    const { data: updatedDocument, error: documentUpdateError } = await supabaseService
      .from("customer_authorization_documents")
      .update({
        site_id: params.siteId,
        metering_point_id: params.meteringPointId,
        customer_contract_id: params.contractId,
        power_of_attorney_id: params.existingPowerOfAttorneyId,
        status: "active",
        file_name: params.signedPowerOfAttorneyFile.name || null,
        mime_type: params.signedPowerOfAttorneyFile.type || null,
        file_size_bytes: params.signedPowerOfAttorneyFile.size || null,
        storage_bucket: bucket,
        file_path: uploaded.filePath,
        file_checksum: uploaded.checksum,
        notes: "Uppladdad efter kanonisk kundtransaktion.",
        metadata: {
          source: "canonical_admin_intake",
          documentRole: "signed_power_of_attorney",
          signedScopes: params.signedScopes,
          uploadStatus: "completed",
        },
        updated_by: params.actorUserId,
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", params.companyId)
      .eq("customer_id", params.customerId)
      .eq("id", params.existingAuthorizationDocumentId)
      .select("*")
      .single();
    if (documentUpdateError) throw documentUpdateError;

    result.powerOfAttorneyId = params.existingPowerOfAttorneyId;
    result.uploadedDocumentIds.push(params.existingAuthorizationDocumentId);
    result.uploadedLabels.push("signerad fullmakt");

    await insertAuditLog({
      actorUserId: params.actorUserId,
      companyId: params.companyId,
      entityType: "customer_authorization_document",
      entityId: params.existingAuthorizationDocumentId,
      action: "customer_intake_document_upload_completed",
      newValues: updatedDocument as unknown as Record<string, unknown>,
      metadata: {
        customerId: params.customerId,
        siteId: params.siteId,
        meteringPointId: params.meteringPointId,
        contractId: params.contractId,
        linkedPowerOfAttorneyId: params.existingPowerOfAttorneyId,
        signedScopes: params.signedScopes,
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

  if (params.gridInvoiceFile) {
    const uploaded = await uploadFile(
      params.gridInvoiceFile,
      "grid_invoice_suggested",
    );

    const document = await saveCustomerAuthorizationDocument(supabase, {
      companyId: params.companyId,
      customer_id: params.customerId,
      site_id: params.siteId,
      metering_point_id: params.meteringPointId,
      customer_contract_id: params.contractId,
      document_type: "grid_invoice_suggested",
      status: "suggested",
      title: "Elnätsfaktura från kundintag",
      file_name: params.gridInvoiceFile.name || null,
      mime_type: params.gridInvoiceFile.type || null,
      file_size_bytes: params.gridInvoiceFile.size || null,
      storage_bucket: bucket,
      file_path: uploaded.filePath,
      file_checksum: uploaded.checksum,
      reference: params.siteId ? `SITE-${params.siteId.slice(0, 8)}` : null,
      notes: "Uppladdad som föreslagen anläggningsdata. Uppgifterna får inte behandlas som verifierad sanning innan Ediel/nätägare/adminbekräftelse.",
      metadata: {
        source: "customer_intake",
        documentRole: "grid_invoice_suggested",
        verificationLevel: "suggested",
      },
    });

    result.uploadedDocumentIds.push(document.id);
    result.uploadedLabels.push("elnätsfaktura som suggested data");

    await supabaseService.from("facility_data_quality_issues").insert({
      company_id: params.companyId,
      customer_id: params.customerId,
      customer_site_id: params.siteId,
      metering_point_id: params.meteringPointId,
      issue_type: "grid_invoice_uploaded_suggested_data",
      severity: "info",
      status: "open",
      source: "customer_intake",
      source_actor_id: params.actorUserId,
      source_error_text: "Elnätsfaktura är uppladdad och ska granskas. Den kan föreslå anläggnings-ID, områdes-ID, nätägare och adress men verifierar inte leverantörsbyte.",
      recommended_action: "Granska fakturan, fyll i saknade uppgifter och kör ny readiness-check innan leverantörsbyte.",
      metadata: {
        documentId: document.id,
        fileName: params.gridInvoiceFile.name || null,
        verificationLevel: "suggested",
      },
    }).then((result) => { if (result.error && !databaseObjectMissing(result.error)) throw result.error; });

    await insertAuditLog({
      actorUserId: params.actorUserId,
      companyId: params.companyId,
      entityType: "customer_authorization_document",
      entityId: document.id,
      action: "customer_intake_grid_invoice_uploaded_as_suggested_data",
      newValues: document as unknown as Record<string, unknown>,
      metadata: {
        customerId: params.customerId,
        siteId: params.siteId,
        meteringPointId: params.meteringPointId,
        documentType: "grid_invoice_suggested",
        verificationLevel: "suggested",
      },
    });
  }

  return result;
}

export function databaseObjectMissing(error: unknown): boolean {
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

export type IntakeDuplicateSeverity = "info" | "warning" | "critical";

export type IntakeDuplicateMatch = {
  field: IntakeField | "customer" | "site" | "meteringPoint";
  severity: IntakeDuplicateSeverity;
  customerId: string | null;
  siteId?: string | null;
  meteringPointId?: string | null;
  matchType: string;
  message: string;
};

export async function findMatchingCustomersByColumn(params: {
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

export async function findMatchingSites(params: {
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

export async function findMatchingMeteringPoints(params: {
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

export const INTAKE_IDENTITY_MATCH_PRESENTATION: Record<
  CustomerMatchSignal,
  {
    field: IntakeDuplicateMatch["field"];
    severity: IntakeDuplicateSeverity;
    label: string;
    matchType: string;
  }
> = {
  personal_number: {
    field: "personalNumber",
    severity: "critical",
    label: "Personnummer",
    matchType: "personal_number",
  },
  org_number: {
    field: "orgNumber",
    severity: "critical",
    label: "Organisationsnummer",
    matchType: "org_number",
  },
  email: {
    field: "email",
    severity: "warning",
    label: "E-post",
    matchType: "email",
  },
  phone: {
    field: "phone",
    severity: "warning",
    label: "Telefonnummer",
    matchType: "phone",
  },
};

export async function findIntakeIdentityDuplicateMatches(
  params: CreateCustomerGraphParams,
): Promise<IntakeDuplicateMatch[]> {
  try {
    const decision = await matchCustomerIdentity({
      companyId: params.companyId,
      personalNumber: params.personalNumber,
      orgNumber: params.orgNumber,
      email: params.email,
      phone: params.phone,
      select: "id, customer_number, full_name, company_name, email, phone",
    });

    return decision.candidates.map((candidate) => {
      const presentation = INTAKE_IDENTITY_MATCH_PRESENTATION[candidate.matchedBy];
      const row = candidate.customer;
      return {
        field: presentation.field,
        severity: presentation.severity,
        customerId: typeof row.id === "string" ? row.id : null,
        matchType: presentation.matchType,
        message: `${presentation.label} matchar kund ${String(row.customer_number ?? row.full_name ?? row.company_name ?? row.email ?? row.id)} i detta bolag.`,
      } satisfies IntakeDuplicateMatch;
    });
  } catch (error) {
    if (databaseObjectMissing(error)) return [];
    throw error;
  }
}

export async function findIntakeDuplicateMatches(
  params: CreateCustomerGraphParams,
): Promise<IntakeDuplicateMatch[]> {
  const personOrOrgMatches = await findIntakeIdentityDuplicateMatches(params);

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

export async function findIntakeDuplicates(
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

export function duplicateWarningsFromMatches(
  matches: IntakeDuplicateMatch[],
): string[] {
  return Array.from(new Set(matches.map((match) => match.message)));
}

export function mapUnknownErrorToIntakeState(
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

export type CustomerGraphRow = Record<string, unknown> & {
  id: string
  customer_number?: string | null
  customer_type?: string | null
  full_name?: string | null
  company_name?: string | null
  email?: string | null
  phone?: string | null
}

export type CustomerGraphResult = CustomerGraphRow & {
  __duplicateWarnings: string[]
  __duplicateReviewRequired: boolean
  __createdNewCustomer: boolean
  __reusedExistingSite: boolean
  __createdSiteId: string | null
  __createdMeteringPointId: string | null
  __createdGridOwnerId: string | null
  __createdPowerOfAttorneyId: string | null
  __createdCurrentSupplierName: string | null
  __uploadedDocumentLabels?: string[]
}

export async function createCustomerGraph(params: CreateCustomerGraphParams): Promise<CustomerGraphResult> {
  const fieldErrors = validateCreateCustomerParams(params);
  if (Object.keys(fieldErrors).length > 0) {
    throw createValidationErrorFromFieldErrors(fieldErrors);
  }

  const duplicateMatches = await findIntakeDuplicateMatches(params);
  const duplicateWarnings = duplicateWarningsFromMatches(duplicateMatches);
  const normalizedFirstName = normalizeOptionalString(params.firstName);
  const normalizedLastName = normalizeOptionalString(params.lastName);
  const normalizedCompanyName = normalizeOptionalString(params.companyName);
  const normalizedEmail = normalizeOptionalString(params.email);
  const normalizedPhone = normalizeOptionalString(params.phone);
  const normalizedPersonalNumber = params.customerType === "private"
    ? normalizeOptionalString(params.personalNumber)
    : null;
  const normalizedOrgNumber = params.customerType === "private"
    ? null
    : normalizeOptionalString(params.orgNumber);
  const normalizedFacilityId = normalizeOptionalString(params.facilityId);
  const normalizedMeterPointId = normalizeOptionalString(params.meterPointId);
  const normalizedCountry = normalizeCountryCode(params.country);
  const normalizedStreet = normalizeOptionalString(params.street);
  const normalizedPostalCode = normalizeOptionalString(params.postalCode);
  const normalizedCity = normalizeOptionalString(params.city);
  const normalizedCareOf = normalizeOptionalString(params.careOf);
  const displayName = params.customerType === "private"
    ? `${normalizedFirstName ?? ""} ${normalizedLastName ?? ""}`.trim()
    : (normalizedCompanyName ?? "");

  const gridOwnerNormalization = await normalizeGridOwnerIdToOps({
    gridOwnerId: normalizeOptionalString(params.gridOwnerId),
    companyId: params.companyId,
  });
  const normalizedGridOwnerId = gridOwnerNormalization.opsGridOwnerId;
  const billingSnapshot = buildBillingAddressSnapshot(params);
  const offer = params.contractOfferId
    ? await getContractOfferById(params.contractOfferId, params.companyId)
    : null;
  const hasContract = Boolean(params.contractOfferId || params.contractTypeOverride);
  const hasSignedAgreement = Boolean(params.signedAgreementFile);
  const contractStatus = hasSignedAgreement && (!params.contractStatus || ["draft", "pending_signature"].includes(params.contractStatus))
    ? "signed"
    : (params.contractStatus ?? "pending_signature");
  const contractType = params.contractTypeOverride ?? offer?.contract_type ?? "variable_hourly";
  const signedScopes = params.signedPowerOfAttorneyFile
    ? signedAuthorizationScopes({
        gridOwnerData: params.postCreateRequestTarget !== "current_supplier",
        currentSupplierContract: params.postCreateRequestTarget !== "grid_owner",
        meteringData: params.postCreateRequestTarget !== "current_supplier",
      })
    : [];

  const matchingPolicy = params.existingCustomerId
    ? "link_selected"
    : params.duplicateResolution === "create_separate_confirmed" ||
        params.duplicateResolution === "create_new_pending_review"
      ? "create_separate"
      : "link_unique";

  const idempotencyKey = canonicalIdempotencyKey({
    channel: "admin",
    companyId: params.companyId,
    sourceId: buildAdminIntakeIdempotencyKey(params),
  });

  const tenantContext = createTenantContext({
    companyId: params.companyId,
    actorType: "user",
    actorId: params.actorUserId,
    permissions: ["customers.write"],
    sourceChannel: "admin",
  });

  const result = await onboardCustomerGraph({
    company_id: params.companyId,
    actor_user_id: params.actorUserId,
    channel: "admin",
    idempotency_key: idempotencyKey,
    matching_policy: matchingPolicy,
    existing_customer_id: params.existingCustomerId,
    update_existing: params.duplicateResolution === "update_existing",
    customer: {
      customer_type: params.customerType,
      status: params.intakeCreateMode === "create_blocked" ? "pending_review" : "active",
      first_name: normalizedFirstName,
      last_name: normalizedLastName,
      full_name: displayName || normalizedEmail || "Ny kund",
      company_name: normalizedCompanyName,
      personal_number: normalizedPersonalNumber,
      org_number: normalizedOrgNumber,
      email: normalizedEmail,
      phone: normalizedPhone,
      apartment_number: normalizeOptionalString(params.apartmentNumber),
      source: "admin_customer_intake",
      metadata: {
        duplicateResolution: params.duplicateResolution,
        duplicateOverrideReason: normalizeOptionalString(params.duplicateOverrideReason),
        duplicateWarnings,
      },
      created_by: params.actorUserId,
      updated_by: params.actorUserId,
    },
    contact: normalizedEmail || normalizedPhone
      ? {
          type: "primary",
          name: displayName || null,
          email: normalizedEmail,
          phone: normalizedPhone,
          title: normalizeOptionalString(params.contactTitle),
          is_primary: true,
          created_by: params.actorUserId,
          updated_by: params.actorUserId,
        }
      : null,
    address: normalizedStreet || normalizedPostalCode || normalizedCity
      ? {
          type: "registered",
          street_1: normalizedStreet,
          street_2: normalizedCareOf,
          postal_code: normalizedPostalCode,
          city: normalizedCity,
          country: normalizedCountry,
          is_active: true,
          created_by: params.actorUserId,
          updated_by: params.actorUserId,
        }
      : null,
    site: normalizedFacilityId || normalizedStreet || params.existingCustomerId
      ? {
          site_name: normalizeOptionalString(params.siteName) || displayName || "Ny anläggning",
          facility_id: normalizedFacilityId,
          site_type: params.siteType ?? "consumption",
          status: "draft",
          grid_owner_id: normalizedGridOwnerId,
          price_area_code: params.priceAreaCode,
          grid_area_code: normalizeOptionalString(params.gridAreaCode),
          move_in_date: normalizeOptionalString(params.moveInDate),
          annual_consumption_kwh: params.annualConsumptionKwh,
          current_supplier_id: normalizeOptionalString(params.currentSupplierId),
          current_supplier_name: params.currentSupplierUnknown
            ? "Okänd nuvarande leverantör"
            : normalizeOptionalString(params.currentSupplierName),
          current_supplier_org_number: params.currentSupplierUnknown
            ? null
            : normalizeOptionalString(params.currentSupplierOrgNumber),
          current_supplier_unknown: params.currentSupplierUnknown,
          street: normalizedStreet,
          care_of: normalizedCareOf,
          postal_code: normalizedPostalCode,
          city: normalizedCity,
          country: normalizedCountry,
          moved_from_street: normalizeOptionalString(params.movedFromStreet),
          moved_from_postal_code: normalizeOptionalString(params.movedFromPostalCode),
          moved_from_city: normalizeOptionalString(params.movedFromCity),
          moved_from_supplier_name: normalizeOptionalString(params.movedFromSupplierName),
          metadata: {
            billing: billingSnapshot,
            addressSource: "admin_customer_intake",
          },
          created_by: params.actorUserId,
          updated_by: params.actorUserId,
        }
      : null,
    metering_point: normalizedMeterPointId
      ? {
          meter_point_id: normalizedMeterPointId,
          metering_point_id: normalizedMeterPointId,
          site_facility_id: normalizedFacilityId,
          status: "draft",
          measurement_type: params.siteType === "production" ? "production" : "consumption",
          reading_frequency: "hourly",
          grid_owner_id: normalizedGridOwnerId,
          price_area_code: params.priceAreaCode,
          grid_area_code: normalizeOptionalString(params.gridAreaCode),
          start_date: normalizeOptionalString(params.moveInDate),
          is_settlement_relevant: true,
          created_by: params.actorUserId,
          updated_by: params.actorUserId,
        }
      : null,
    contract: hasContract
      ? {
          contract_offer_id: offer?.id ?? null,
          source_type: params.contractOfferId && !params.overrideReason ? "catalog" : "manual_override",
          status: contractStatus,
          contract_name: offer?.name ?? "Kundspecifikt avtal",
          contract_type: contractType,
          campaign_name: offer?.campaign_name ?? null,
          campaign_code: offer?.campaign_code ?? null,
          campaign_version: offer?.campaign_version ?? "v1",
          price_version: offer?.price_version ?? "v1",
          terms_version: offer?.terms_version ?? "v1",
          fixed_price_ore_per_kwh: params.fixedPriceOrePerKwh ?? offer?.fixed_price_ore_per_kwh ?? null,
          spot_markup_ore_per_kwh: params.spotMarkupOrePerKwh ?? offer?.spot_markup_ore_per_kwh ?? null,
          variable_fee_ore_per_kwh: params.variableFeeOrePerKwh ?? offer?.variable_fee_ore_per_kwh ?? null,
          monthly_fee_sek: params.monthlyFeeSek ?? offer?.monthly_fee_sek ?? null,
          invoice_fee_sek: params.invoiceFeeSek ?? offer?.invoice_fee_sek ?? null,
          start_fee_sek: params.startFeeSek ?? offer?.start_fee_sek ?? null,
          admin_fee_sek: params.adminFeeSek ?? offer?.admin_fee_sek ?? null,
          break_fee_sek: params.breakFeeSek ?? offer?.break_fee_sek ?? null,
          discount_value: offer?.discount_value ?? null,
          discount_unit: offer?.discount_unit ?? null,
          vat_rate: offer?.vat_rate ?? 25,
          green_fee_mode: params.greenFeeMode ?? offer?.green_fee_mode ?? "none",
          green_fee_value: params.greenFeeValue ?? offer?.green_fee_value ?? null,
          binding_months: params.bindingMonths ?? offer?.default_binding_months ?? null,
          notice_months: params.noticeMonths ?? offer?.default_notice_months ?? null,
          optional_fee_lines: params.optionalFeeLines.length > 0 ? params.optionalFeeLines : (offer?.optional_fee_lines ?? []),
          starts_at: normalizeOptionalString(params.contractStartDate) ?? normalizeOptionalString(params.confirmedStartDate) ?? normalizeOptionalString(params.expectedStartDate),
          expected_start_at: normalizeOptionalString(params.expectedStartDate),
          confirmed_start_at: normalizeOptionalString(params.confirmedStartDate),
          actual_start_at: normalizeOptionalString(params.actualStartDate),
          start_date_source: normalizeOptionalString(params.startDateSource),
          signed_at: ["signed", "active"].includes(contractStatus) ? new Date().toISOString() : null,
          override_reason: normalizeOptionalString(params.overrideReason),
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
          created_by: params.actorUserId,
          updated_by: params.actorUserId,
        }
      : null,
    price_snapshot: hasContract
      ? {
          pricing_model: contractType,
          snapshot_json: {
            offerId: offer?.id ?? null,
            priceVersion: offer?.price_version ?? "v1",
            termsVersion: offer?.terms_version ?? "v1",
            fixedPriceOrePerKwh: params.fixedPriceOrePerKwh ?? offer?.fixed_price_ore_per_kwh ?? null,
            spotMarkupOrePerKwh: params.spotMarkupOrePerKwh ?? offer?.spot_markup_ore_per_kwh ?? null,
            variableFeeOrePerKwh: params.variableFeeOrePerKwh ?? offer?.variable_fee_ore_per_kwh ?? null,
            monthlyFeeSek: params.monthlyFeeSek ?? offer?.monthly_fee_sek ?? null,
            invoiceFeeSek: params.invoiceFeeSek ?? offer?.invoice_fee_sek ?? null,
            startFeeSek: params.startFeeSek ?? offer?.start_fee_sek ?? null,
            adminFeeSek: params.adminFeeSek ?? offer?.admin_fee_sek ?? null,
            breakFeeSek: params.breakFeeSek ?? offer?.break_fee_sek ?? null,
            discountValue: offer?.discount_value ?? null,
            discountUnit: offer?.discount_unit ?? null,
            greenFeeMode: params.greenFeeMode ?? offer?.green_fee_mode ?? "none",
            greenFeeValue: params.greenFeeValue ?? offer?.green_fee_value ?? null,
            vatRate: offer?.vat_rate ?? 25,
            optionalFeeLines: params.optionalFeeLines.length > 0 ? params.optionalFeeLines : (offer?.optional_fee_lines ?? []),
          },
          valid_from: normalizeOptionalString(params.contractStartDate),
        }
      : null,
    legal: hasSignedAgreement || signedScopes.length > 0
      ? {
          terms_version: offer?.terms_version ?? "v1",
          accepted_at: new Date().toISOString(),
          signed_scopes: signedScopes,
          acceptance_snapshot: {
            signedAgreementUploaded: hasSignedAgreement,
            signedPowerOfAttorneyUploaded: Boolean(params.signedPowerOfAttorneyFile),
            source: "admin_customer_intake",
          },
        }
      : null,
    power_of_attorney: signedScopes.length > 0
      ? {
          scope: "supplier_switch",
          status: "signed",
          signed_at: new Date().toISOString(),
          valid_from: normalizeOptionalString(params.authorizationValidFrom),
          valid_to: normalizeOptionalString(params.authorizationValidTo),
          reference: `INTAKE-POA-${idempotencyKey.slice(-12)}`,
          notes: "Signerad fullmakt registrerad genom kanoniskt kundintag.",
          signed_scopes: signedScopes,
          created_by: params.actorUserId,
          updated_by: params.actorUserId,
        }
      : null,
    authorization_document: signedScopes.length > 0
      ? {
          document_type: "power_of_attorney",
          status: "active",
          title: "Signerad fullmakt från kundintag",
          file_name: params.signedPowerOfAttorneyFile?.name ?? null,
          mime_type: params.signedPowerOfAttorneyFile?.type ?? null,
          file_size_bytes: params.signedPowerOfAttorneyFile?.size ?? null,
          storage_bucket: "customer-documents",
          file_path: `pending-upload/${idempotencyKey}`,
          metadata: { source: "admin_customer_intake", signedScopes, uploadStatus: "pending" },
          created_by: params.actorUserId,
          updated_by: params.actorUserId,
        }
      : null,
    application: {
      source_record_type: "admin_customer_intake",
      source_record_id: idempotencyKey,
      status: params.duplicateResolution === "create_new_pending_review" ? "pending_review" : "committed",
      payload_snapshot: {
        intakeFlowType: params.intakeFlowType,
        postCreateAction: params.postCreateAction,
        postCreateRequestTarget: params.postCreateRequestTarget,
      },
    },
    task: duplicateWarnings.length > 0 || params.intakeCreateMode === "create_blocked"
      ? {
          task_type: duplicateWarnings.length > 0 ? "duplicate_review" : "customer_data_review",
          status: "open",
          priority: duplicateWarnings.length > 0 ? "high" : "normal",
          title: duplicateWarnings.length > 0 ? "Granska möjlig dubblett" : "Komplettera kundintag",
          description: duplicateWarnings.join("; ") || "Kundintaget skapades blockerat och behöver granskas.",
          created_by: params.actorUserId,
          updated_by: params.actorUserId,
        }
      : null,
    info_request: params.postCreateAction === "request_data"
      ? {
          request_type: params.postCreateRequestTarget === "current_supplier" ? "current_supplier_contract" : "z01_customer_masterdata",
          target_party_type: params.postCreateRequestTarget === "current_supplier" ? "current_supplier" : "grid_owner",
          grid_owner_id: normalizedGridOwnerId,
          current_supplier_name: params.currentSupplierUnknown ? "Okänd nuvarande leverantör" : normalizeOptionalString(params.currentSupplierName),
          status: signedScopes.length > 0 ? "ready_to_send" : "missing_authorization",
          requested_data_categories: params.postCreateRequestTarget === "both"
            ? ["grid_owner_data", "metering_data", "current_supplier_contract"]
            : signedScopes,
          created_by: params.actorUserId,
          updated_by: params.actorUserId,
        }
      : null,
  }, tenantContext);

  if (!result.ok) {
    throw new IntakeValidationError(
      `Kundmatchningen är tvetydig och kräver manuell granskning. Referens: ${result.correlation_id}.`,
      { existingCustomerId: "Flera möjliga kunder hittades. Välj kund uttryckligen eller skapa separat efter granskning." },
    );
  }

  const documentUpload = await uploadCustomerIntakeDocuments({
    companyId: params.companyId,
    actorUserId: params.actorUserId,
    customerId: result.customer_id,
    siteId: result.site_id,
    meteringPointId: result.metering_point_id,
    contractId: result.contract_id,
    existingPowerOfAttorneyId: result.power_of_attorney_id,
    existingAuthorizationDocumentId: result.authorization_document_id,
    signedScopes,
    signedAgreementFile: params.signedAgreementFile,
    signedPowerOfAttorneyFile: params.signedPowerOfAttorneyFile,
    gridInvoiceFile: params.gridInvoiceFile,
    authorizationValidFrom: params.authorizationValidFrom,
    authorizationValidTo: params.authorizationValidTo,
  });

  const runSharedIntake = documentUpload.uploadedLabels.length > 0
    ? processPdfCustomerIntake
    : processManualCustomerIntake;
  await runSharedIntake({
    companyId: params.companyId,
    customerId: result.customer_id,
    siteId: result.site_id,
    actorUserId: params.actorUserId,
  });

  const { data: customer, error: customerError } = await supabaseService
    .from("customers")
    .select("*")
    .eq("company_id", params.companyId)
    .eq("id", result.customer_id)
    .single();
  if (customerError || !customer) {
    throw customerError ?? new Error(`Kundposten kunde inte verifieras efter commit. Referens: ${result.correlation_id}.`);
  }
  if (!String(customer.customer_number ?? "").trim()) {
    throw new Error(`Kundnummer saknas efter commit. Referens: ${result.correlation_id}.`);
  }

  return {
    ...(customer as CustomerGraphRow),
    __duplicateWarnings: duplicateWarnings,
    __duplicateReviewRequired: params.duplicateResolution === "create_new_pending_review",
    __createdNewCustomer: result.created_new_customer,
    __reusedExistingSite: !result.created_new_customer && Boolean(result.site_id),
    __uploadedDocumentLabels: documentUpload.uploadedLabels,
    __createdSiteId: result.site_id,
    __createdMeteringPointId: result.metering_point_id,
    __createdGridOwnerId: normalizedGridOwnerId,
    __createdPowerOfAttorneyId: result.power_of_attorney_id,
    __createdCurrentSupplierName: params.currentSupplierUnknown
      ? "Okänd nuvarande leverantör"
      : normalizeOptionalString(params.currentSupplierName),
  };
}

export const ADMIN_INTAKE_ROUTE = "admin/customers/intake";

export const ADMIN_INTAKE_IN_PROGRESS_STALE_MS = 10 * 60 * 1000;
