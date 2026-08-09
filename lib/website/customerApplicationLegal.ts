// Internal module extracted from customerApplications.ts to keep handwritten production files bounded.
//lib/website/customerApplications.ts
import { createHash } from "node:crypto";
import { z } from "zod";
import { supabaseService } from "@/lib/supabase/service";
import { publicReference } from "@/lib/integrations/publicReferences";
import { legalAcceptanceTypeForModule, type LegacyLegalAcceptanceType, type PublicContractOffer } from "@/lib/website/publicContracts";
import { powerOfAttorneyCoverageFromScopes } from "@/lib/operations/powerOfAttorneyWorkflow";
import { buildCustomerLegalDocuments, isCustomerLegalDocumentKind, type CustomerLegalDocument, type CustomerLegalModuleVersion } from "@/lib/legal/customerDocumentPackage";
import { LegalAcceptanceSchema, structuredPoaIsExternallySendable } from "./customerApplicationSchemas";
import type { NormalizedStructuredPoa } from "./customerApplicationSchemas";
import { WebsiteApplicationError, clean, isObject, isUuid, missingSchema, schemaErrorDetail, stage } from "./customerApplicationShared";
import type { RequestAuditMetadata } from "./customerApplicationShared";

export type WebsiteLegalAcceptanceVersion = {
  id: string;
  type: string;
  module_key?: string;
  version: string;
  title: string;
  body: string | null;
  published_at: string | null;
  status?: string | null;
  content_sha256?: string | null;
  legal_bundle_version_id?: string | null;
};

const WEBSITE_LEGAL_ACCEPTANCE_DEFINITIONS: Array<{
  legalType: string;
  acceptanceType: string;
  field: string;
  aliases: string[];
  label: string;
}> = [
  {
    legalType: "terms",
    acceptanceType: "terms",
    field: "consents.terms",
    aliases: ["terms", "terms_accepted", "accept_terms", "accepted_terms"],
    label: "allmänna villkor",
  },
  {
    legalType: "privacy_policy",
    acceptanceType: "privacy_policy",
    field: "consents.privacy_policy",
    aliases: [
      "privacy_policy",
      "privacy_policy_accepted",
      "privacy_accepted",
      "gdpr_accepted",
    ],
    label: "integritetspolicy",
  },
  {
    legalType: "withdrawal",
    acceptanceType: "withdrawal_info",
    field: "consents.withdrawal",
    aliases: [
      "withdrawal",
      "withdrawal_info",
      "withdrawal_accepted",
      "cooling_off_accepted",
    ],
    label: "ångerrättsinformation",
  },
  {
    legalType: "power_of_attorney",
    acceptanceType: "power_of_attorney",
    field: "consents.power_of_attorney",
    aliases: [
      "power_of_attorney",
      "poa_accepted",
      "power_of_attorney_accepted",
    ],
    label: "fullmakt",
  },
  {
    legalType: "price_terms",
    acceptanceType: "price_snapshot",
    field: "consents.price_terms",
    aliases: [
      "price_terms",
      "price_snapshot",
      "price_terms_accepted",
      "price_snapshot_accepted",
    ],
    label: "prisvillkor/prisbild",
  },
];

export function consentAccepted(
  consents: Record<string, unknown> | undefined,
  aliases: string[],
): boolean {
  if (!consents) return false;
  return aliases.some((alias) => {
    const value = consents[alias];
    return (
      value === true ||
      value === "true" ||
      value === 1 ||
      value === "1" ||
      value === "yes" ||
      value === "accepted"
    );
  });
}

function hasStoredAcceptance(
  acceptanceIds: Record<string, string>,
  legalType: string,
) {
  return (
    typeof acceptanceIds[legalType] === "string" &&
    acceptanceIds[legalType].trim().length > 0
  );
}

function requiredWebsiteLegalAcceptances(offer: PublicContractOffer) {
  const versions = offer.legal_versions ?? [];
  const requiredTypes = new Set(
    versions.map((version) => legalAcceptanceTypeForModule(version.type)),
  );
  return WEBSITE_LEGAL_ACCEPTANCE_DEFINITIONS.filter((definition) =>
    requiredTypes.has(definition.legalType as LegacyLegalAcceptanceType),
  );
}

export function contractLegalMailEvidenceReady(input: {
  acceptanceIds: Record<string, string>;
  legalVersions: WebsiteLegalAcceptanceVersion[];
}) {
  const requiredTypes = new Set(
    input.legalVersions.map((version) => version.id),
  );
  return (
    requiredTypes.size > 0 &&
    Array.from(requiredTypes).every((documentId) =>
      hasStoredAcceptance(input.acceptanceIds, documentId),
    )
  );
}

function resultList(value: unknown): Array<Record<string, unknown>> {
  const items = Array.isArray(value) ? value : [value];
  return items.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item),
  );
}

export function emailTriggerSucceeded(value: unknown): boolean {
  const items = resultList(value);
  return items.length > 0 && items.every((item) => item.ok !== false);
}

// Truthful per-event dispatch status derived from the actual
// communication_logs rows created by the trigger (the source of truth) —
// never from the mere absence of an exception. 'queued' means a log +
// outbox row exists; 'sent' only when the provider already confirmed it.
export function emailDispatchStatus(
  value: unknown,
): "sent" | "queued" | "skipped" | "failed" {
  const items = resultList(value);
  const statuses = items.map((item) => {
    const log = (item as { log?: { status?: unknown } }).log;
    return typeof log?.status === "string" ? log.status : null;
  });
  if (statuses.some((status) => status === "sent" || status === "delivered"))
    return "sent";
  if (statuses.some((status) => status === "queued")) return "queued";
  if (items.some((item) => item.skipped === true)) return "skipped";
  return "failed";
}

async function loadOfferBoundLegalVersions(input: {
  companyId: string;
  publicOffer: PublicContractOffer;
}): Promise<WebsiteLegalAcceptanceVersion[]> {
  const offerVersions = input.publicOffer.legal_versions ?? [];
  if (offerVersions.length === 0) {
    throw new WebsiteApplicationError({
      message: "Det valda erbjudandet saknar ett exakt juridikpaket.",
      status: 422,
      code: "offer_legal_versions_missing",
      field: "offer_reference",
      stage: "legal_acceptance",
      hint: "Publicera om erbjudandet med ett komplett canonical juridikpaket. Kundens accept får aldrig bindas till tenantens senaste texter i efterhand.",
    });
  }

  const expectedIds = offerVersions.map((item) => item.id);
  if (
    new Set(expectedIds).size !== offerVersions.length ||
    expectedIds.some((id) => !isUuid(id)) ||
    !input.publicOffer.legal_bundle_version_id
  ) {
    throw new WebsiteApplicationError({
      message:
        "Erbjudandets juridikpaket innehåller ogiltiga eller dubbla dokument-ID:n.",
      status: 422,
      code: "offer_legal_versions_invalid",
      field: "offer_reference",
      stage: "legal_acceptance",
      hint: "Publicera om erbjudandet så att varje accept binds till exakt legal_bundle_version_documents.id.",
    });
  }

  const bundleResult = await supabaseService
    .from("legal_bundle_versions")
    .select("id,company_id,status,published_at,locked_at")
    .eq("id", input.publicOffer.legal_bundle_version_id)
    .eq("company_id", input.companyId)
    .maybeSingle();
  if (
    bundleResult.error ||
    !bundleResult.data ||
    !bundleResult.data.locked_at
  ) {
    throw new WebsiteApplicationError({
      message:
        "OPS kunde inte verifiera det låsta juridikpaketet för erbjudandet.",
      status: bundleResult.error ? 500 : 422,
      code: "offer_legal_bundle_unavailable",
      field: "offer_reference",
      stage: "legal_acceptance",
      hint: "Kör senaste migration och publicera om erbjudandet.",
      details: bundleResult.error
        ? schemaErrorDetail(bundleResult.error)
        : undefined,
    });
  }
  const verifiedBundle = bundleResult.data;
  if (
    !["published", "replaced", "archived"].includes(
      String(verifiedBundle.status),
    )
  ) {
    throw new WebsiteApplicationError({
      message: "Erbjudandets juridikpaket är inte publicerat och låst.",
      status: 422,
      code: "offer_legal_bundle_not_published",
      field: "offer_reference",
      stage: "legal_acceptance",
    });
  }

  const documents = await supabaseService
    .from("legal_bundle_version_documents")
    .select(
      "id,legal_bundle_version_id,module_key,title,rendered_body,template_version,content_sha256,created_at,unresolved_variables",
    )
    .eq("legal_bundle_version_id", input.publicOffer.legal_bundle_version_id)
    .in("id", expectedIds)
    .order("sort_order", { ascending: true });

  if (documents.error) {
    throw new WebsiteApplicationError({
      message:
        "OPS kunde inte läsa de exakta juridikdokument som hör till erbjudandet.",
      status: 500,
      code: "offer_legal_versions_unavailable",
      field: "legal_bundle_version_documents",
      stage: "legal_acceptance",
      hint: "Kör senaste migration och kontrollera erbjudandets canonical legal bundle.",
      details: schemaErrorDetail(documents.error),
    });
  }

  const documentRows = (documents.data ?? []) as Array<
    Record<string, unknown>
  >;
  const loadedById = new Map<string, Record<string, unknown>>(
    documentRows.map((row) => [String(row.id), row]),
  );
  const ordered: Array<WebsiteLegalAcceptanceVersion | null> = offerVersions.map(
    (version) => {
      const row = loadedById.get(version.id);
      if (
        !row ||
        (Array.isArray(row.unresolved_variables) &&
          row.unresolved_variables.length > 0)
      ) {
        return null;
      }
      return {
        id: String(row.id),
        type: String(row.module_key),
        module_key: String(row.module_key),
        version:
          version.version ||
          String(row.template_version ?? row.created_at ?? row.id),
        title: String(row.title ?? version.title),
        body: String(row.rendered_body ?? ""),
        published_at:
          typeof verifiedBundle.published_at === "string"
            ? verifiedBundle.published_at
            : typeof row.created_at === "string"
              ? row.created_at
              : null,
        status: "published",
        content_sha256: String(
          row.content_sha256 ??
            createHash("sha256").update(String(row.rendered_body ?? ""), "utf8").digest("hex"),
        ),
        legal_bundle_version_id: String(row.legal_bundle_version_id),
      } satisfies WebsiteLegalAcceptanceVersion;
    },
  );

  if (ordered.some((row) => !row)) {
    throw new WebsiteApplicationError({
      message:
        "Erbjudandets låsta juridikdokument saknas, innehåller olösta variabler eller matchar inte publiceringsversionen.",
      status: 422,
      code: "offer_legal_version_mismatch",
      field: "offer_reference",
      stage: "legal_acceptance",
      hint: "Hämta ett nytt offer_reference från public-contracts. Ett gammalt erbjudande får inte accepteras mot andra juridikdokument.",
    });
  }

  return ordered.filter(
    (row): row is WebsiteLegalAcceptanceVersion => row !== null,
  );
}

function customerDocumentsForAcceptance(input: {
  companyId: string;
  legalBundleVersionId: string;
  legalVersions: WebsiteLegalAcceptanceVersion[];
}): CustomerLegalDocument[] {
  return buildCustomerLegalDocuments({
    companyId: input.companyId,
    legalBundleVersionId: input.legalBundleVersionId,
    modules: input.legalVersions.map(
      (version) =>
        ({
          id: version.id,
          module_key: version.module_key ?? version.type,
          version: version.version,
          title: version.title,
          published_at: version.published_at,
          content_sha256:
            version.content_sha256 ??
            createHash("sha256")
              .update(version.body ?? "", "utf8")
              .digest("hex"),
          legal_bundle_version_id:
            version.legal_bundle_version_id ?? input.legalBundleVersionId,
        }) satisfies CustomerLegalModuleVersion,
    ),
  });
}

function acceptanceMatchesCustomerDocument(
  acceptance: z.infer<typeof LegalAcceptanceSchema>,
  document: CustomerLegalDocument,
): boolean {
  return (
    acceptance.accepted === true &&
    acceptance.document_reference === document.document_reference &&
    acceptance.document_version === document.document_version &&
    acceptance.document_hash.toLowerCase() ===
      document.document_hash.toLowerCase()
  );
}

function acceptanceMatchesModuleDocument(input: {
  companyId: string;
  acceptance: z.infer<typeof LegalAcceptanceSchema>;
  version: WebsiteLegalAcceptanceVersion;
}): boolean {
  return (
    input.acceptance.accepted === true &&
    input.acceptance.document_reference ===
      publicReference("legal_document", input.companyId, input.version.id) &&
    input.acceptance.document_version === input.version.version &&
    input.acceptance.document_hash.toLowerCase() ===
      String(input.version.content_sha256 ?? "").toLowerCase()
  );
}

export async function assertWebsiteLegalAcceptances(input: {
  companyId: string;
  consents?: Record<string, unknown>;
  legalBundleVersion?: string | null;
  legalAcceptances?: z.infer<typeof LegalAcceptanceSchema>[];
  publicOffer: PublicContractOffer;
}): Promise<WebsiteLegalAcceptanceVersion[]> {
  const legalVersions = await loadOfferBoundLegalVersions({
    companyId: input.companyId,
    publicOffer: input.publicOffer,
  });
  if (!input.legalAcceptances) {
    throw new WebsiteApplicationError({
      message:
        "Explicit dokumentbunden acceptans krävs för varje kunddokument i det publicerade juridikpaketet.",
      status: 422,
      code: "legal_acceptance_missing",
      field: "legal_acceptances",
      stage: "legal_acceptance",
      hint:
        "Hämta legal-bundle och skicka bundle_version samt en acceptansrad per returnerat kunddokument.",
    });
  }

  const bundleId = input.publicOffer.legal_bundle_version_id;
  if (
    !bundleId ||
    !input.legalBundleVersion ||
    input.legalBundleVersion !==
      publicReference("legal_bundle", input.companyId, bundleId)
  ) {
    throw new WebsiteApplicationError({
      message:
        "Juridikpaketet har ändrats. Hämta och visa det aktuella paketet innan kunden godkänner igen.",
      status: 409,
      code: "legal_bundle_version_mismatch",
      field: "legal_bundle_version",
      stage: "legal_acceptance",
      hint:
        "Hämta /api/v1/website/legal-bundle på nytt och skapa acceptanser från det returnerade paketet.",
    });
  }

  const seenCodes = new Set<string>();
  for (const acceptance of input.legalAcceptances) {
    if (seenCodes.has(acceptance.requirement_code)) {
      throw new WebsiteApplicationError({
        message: "Samma juridikkrav får inte skickas flera gånger.",
        status: 422,
        code: "legal_acceptance_duplicate",
        field: "legal_acceptances",
        stage: "legal_acceptance",
      });
    }
    seenCodes.add(acceptance.requirement_code);
  }

  const customerDocuments = customerDocumentsForAcceptance({
    companyId: input.companyId,
    legalBundleVersionId: bundleId,
    legalVersions,
  });
  const groupedCodes = new Set(
    customerDocuments.map((document) => document.requirement_code),
  );
  const moduleCodes = new Set(
    legalVersions.map((version) => version.module_key ?? version.type),
  );
  const groupedMode =
    input.legalAcceptances.length === customerDocuments.length &&
    input.legalAcceptances.every(
      (acceptance) =>
        isCustomerLegalDocumentKind(acceptance.requirement_code) &&
        groupedCodes.has(acceptance.requirement_code),
    ) &&
    customerDocuments.every((document) =>
      seenCodes.has(document.requirement_code),
    );
  const legacyModuleMode =
    input.legalAcceptances.length === legalVersions.length &&
    input.legalAcceptances.every((acceptance) =>
      moduleCodes.has(acceptance.requirement_code),
    ) &&
    legalVersions.every((version) =>
      seenCodes.has(version.module_key ?? version.type),
    );

  if (!groupedMode && !legacyModuleMode) {
    throw new WebsiteApplicationError({
      message:
        "Juridikacceptanserna måste motsvara antingen de tre kunddokumenten eller det äldre kompletta modulpaketet. Blandade format tillåts inte.",
      status: 409,
      code: "legal_acceptance_document_mismatch",
      field: "legal_acceptances",
      stage: "legal_acceptance",
      hint:
        "Hämta det aktuella juridikpaketet och skicka exakt en acceptans per post i requirements. Äldre klienter får fortsatt skicka en rad per module_version.",
      details: {
        expected_customer_documents: customerDocuments.map(
          (document) => document.requirement_code,
        ),
        expected_module_documents: legalVersions.map(
          (version) => version.module_key ?? version.type,
        ),
      },
    });
  }

  if (groupedMode) {
    const invalidDocuments = customerDocuments.filter((document) => {
      const acceptance = input.legalAcceptances?.find(
        (item) => item.requirement_code === document.requirement_code,
      );
      return !acceptance || !acceptanceMatchesCustomerDocument(acceptance, document);
    });
    if (invalidDocuments.length > 0) {
      throw new WebsiteApplicationError({
        message:
          "Minst ett kunddokument saknas eller matchar inte det aktuella dokumentets ID, version och hash.",
        status: 409,
        code: "legal_acceptance_document_mismatch",
        field: "legal_acceptances",
        stage: "legal_acceptance",
        hint:
          "Hämta /api/v1/website/legal-bundle på nytt och låt kunden godkänna samtliga returnerade requirements igen.",
        details: {
          requirements: invalidDocuments.map(
            (document) => document.requirement_code,
          ),
        },
      });
    }
    return legalVersions;
  }

  const invalidModules = legalVersions.filter((version) => {
    const requirementCode = version.module_key ?? version.type;
    const acceptance = input.legalAcceptances?.find(
      (item) => item.requirement_code === requirementCode,
    );
    return (
      !acceptance ||
      !acceptanceMatchesModuleDocument({
        companyId: input.companyId,
        acceptance,
        version,
      })
    );
  });
  if (invalidModules.length > 0) {
    throw new WebsiteApplicationError({
      message:
        "Minst ett äldre modulbundet juridikkrav saknas eller matchar inte dokumentets ID, version och hash.",
      status: 409,
      code: "legal_acceptance_document_mismatch",
      field: "legal_acceptances",
      stage: "legal_acceptance",
      hint:
        "Hämta det aktuella juridikpaketet. Nya klienter ska använda de samlade requirements som API:t returnerar.",
      details: {
        requirements: invalidModules.map(
          (version) => version.module_key ?? version.type,
        ),
      },
    });
  }

  return legalVersions;
}

type CustomerLegalAcceptanceEvidenceInput = {
  companyId: string;
  customerId: string;
  contractId: string | null;
  applicationId: string;
  publicOffer: PublicContractOffer | null;
  legalVersions: WebsiteLegalAcceptanceVersion[];
  consents?: Record<string, unknown>;
  rawPayload: unknown;
  requestAudit?: RequestAuditMetadata;
  acceptedAt: string;
};

export function buildCustomerLegalAcceptanceEvidence(
  input: CustomerLegalAcceptanceEvidenceInput,
) {
  if (input.legalVersions.length === 0) return [];
  const now = input.acceptedAt;
  const requirements = input.publicOffer
    ? requiredWebsiteLegalAcceptances(input.publicOffer)
    : [];
  const definitionsByType = new Map(
    requirements.map((definition) => [definition.legalType, definition]),
  );
  const rawPayload = isObject(input.rawPayload) ? input.rawPayload : {};
  const parsedAcceptances = z.array(LegalAcceptanceSchema).safeParse(
    rawPayload.legal_acceptances ?? rawPayload.legalAcceptances ?? [],
  );
  const groupedAcceptanceByModule = new Map<
    string,
    {
      requirement_code: string;
      document_reference: string;
      document_version: string;
      document_hash: string;
      accepted_at: string;
    }
  >();
  const bundleId = input.publicOffer?.legal_bundle_version_id ?? null;
  if (bundleId && parsedAcceptances.success) {
    const customerDocuments = customerDocumentsForAcceptance({
      companyId: input.companyId,
      legalBundleVersionId: bundleId,
      legalVersions: input.legalVersions,
    });
    for (const document of customerDocuments) {
      const acceptance = parsedAcceptances.data.find(
        (candidate) =>
          candidate.requirement_code === document.requirement_code &&
          acceptanceMatchesCustomerDocument(candidate, document),
      );
      if (!acceptance) continue;
      for (const moduleKey of document.module_keys) {
        groupedAcceptanceByModule.set(moduleKey, {
          requirement_code: acceptance.requirement_code,
          document_reference: acceptance.document_reference,
          document_version: acceptance.document_version,
          document_hash: acceptance.document_hash.toLowerCase(),
          accepted_at: acceptance.accepted_at,
        });
      }
    }
  }
  const rows = input.legalVersions
    .map((legal) => {
      const legalType = legalAcceptanceTypeForModule(
        legal.module_key ?? legal.type,
      );
      const definition = definitionsByType.get(legalType);
      if (!definition) return null;
      const moduleKey = legal.module_key ?? legal.type;
      const customerDocumentAcceptance =
        groupedAcceptanceByModule.get(moduleKey) ?? null;
      return {
        company_id: input.companyId,
        customer_id: input.customerId,
        contract_id: input.contractId,
        contract_application_id: input.applicationId,
        acceptance_type: definition.acceptanceType,
        legal_text_version_id: null,
        legal_bundle_version_document_id: legal.id,
        legal_module_key: moduleKey,
        legal_document_version: legal.version,
        legal_document_sha256:
          legal.content_sha256 ??
          createHash("sha256").update(legal.body ?? "", "utf8").digest("hex"),
        request_id: input.requestAudit?.requestId ?? null,
        trace_id: input.requestAudit?.traceId ?? null,
        accepted_at: now,
        accepted_ip: input.requestAudit?.ipAddress ?? null,
        accepted_ip_hash: input.requestAudit?.ipHash ?? null,
        accepted_user_agent: input.requestAudit?.userAgent ?? null,
        source: "website",
        snapshot: {
          legal_text: {
            id: legal.id,
            type: legal.type,
            module_key: legal.module_key ?? legal.type,
            version: legal.version,
            title: legal.title,
            body: legal.body,
            published_at: legal.published_at,
          },
          public_offer: input.publicOffer,
          customer_document_acceptance: customerDocumentAcceptance
            ? {
                ...customerDocumentAcceptance,
                covers_module_key: moduleKey,
              }
            : null,
          consent_key: definition.field,
          consents: input.consents ?? {},
        },
        metadata: {
          source: "website_customer_applications",
          application_id: input.applicationId,
          request_audit: input.requestAudit ?? {},
          raw_payload: input.rawPayload,
        },
      };
    })
    .filter(Boolean);

  return rows;
}

export async function persistCustomerLegalAcceptances(
  input: CustomerLegalAcceptanceEvidenceInput,
): Promise<Record<string, string>> {
  if (input.legalVersions.length === 0) return {};
  const rows = buildCustomerLegalAcceptanceEvidence(input);
  const requirements = input.publicOffer
    ? requiredWebsiteLegalAcceptances(input.publicOffer)
    : [];
  const { data, error } = await supabaseService
    .from("customer_legal_acceptances")
    .insert(rows)
    .select("id,acceptance_type,legal_bundle_version_document_id");
  if (error) {
    // Required legal evidence — a schema mismatch must fail clearly so we never
    // persist a "complete" customer without recorded legal acceptances.
    if (missingSchema(error)) {
      throw new WebsiteApplicationError({
        message:
          "Juridiska godkännanden kunde inte sparas eftersom databasens schema för customer_legal_acceptances inte matchar.",
        status: 500,
        code: "legal_bundle_missing",
        field: "customer_legal_acceptances",
        stage: "legal_acceptance",
        hint: "Kör senaste migration för customer_legal_acceptances och retrya ansökan.",
        details: schemaErrorDetail(error),
      });
    }
    throw error;
  }

  // Map acceptance_type -> id, keyed back to the canonical legal type so the
  // API response can expose legal_acceptances ids.
  const acceptanceTypeToLegalType = new Map(
    requirements.map((item) => [item.acceptanceType, item.legalType]),
  );
  const ids: Record<string, string> = {};
  for (const acceptanceRow of (data ?? []) as Array<{
    id: string;
    acceptance_type: string;
    legal_bundle_version_document_id: string;
  }>) {
    const legalType = acceptanceTypeToLegalType.get(
      acceptanceRow.acceptance_type,
    );
    if (acceptanceRow.legal_bundle_version_document_id && acceptanceRow.id) {
      ids[acceptanceRow.legal_bundle_version_document_id] = String(
        acceptanceRow.id,
      );
    }
    if (legalType && acceptanceRow.id && !ids[legalType]) {
      ids[legalType] = String(acceptanceRow.id);
    }
  }
  return ids;
}

// Loads a specific legal text version by id, scoped to the tenant. Used so the
// website API binds the POA to the active legal text it references rather than
// any text supplied by the frontend.
async function loadLegalTextVersionById(
  companyId: string,
  textVersionId: string | null,
): Promise<WebsiteLegalAcceptanceVersion | null> {
  if (!textVersionId) return null;
  if (!isUuid(textVersionId)) {
    throw new WebsiteApplicationError({
      message:
        "Angiven fullmaktsversion (textVersionId) måste vara ett immutable OPS-dokument-ID i UUID-format, inte ett versionsnamn.",
      status: 422,
      code: "power_of_attorney_version_invalid",
      field: "powerOfAttorney.textVersionId",
      stage: "power_of_attorney",
      hint: "Hämta legal.power_of_attorney_version_id från GET /api/v1/website/public-contracts och skicka det som powerOfAttorney.textVersionId.",
      details: {
        expected: "uuid",
        received_format: "version_label_or_invalid_uuid",
      },
    });
  }

  const exact = await supabaseService
    .from("legal_bundle_version_documents")
    .select(
      "id,legal_bundle_version_id,module_key,title,rendered_body,template_version,created_at,unresolved_variables",
    )
    .eq("id", textVersionId)
    .eq("module_key", "power_of_attorney")
    .maybeSingle();
  if (exact.error && !missingSchema(exact.error)) throw exact.error;
  if (exact.data) {
    const bundle = await supabaseService
      .from("legal_bundle_versions")
      .select("company_id,status,published_at,locked_at")
      .eq("id", exact.data.legal_bundle_version_id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (bundle.error && !missingSchema(bundle.error)) throw bundle.error;
    if (
      bundle.data?.locked_at &&
      ["published", "replaced", "archived"].includes(
        String(bundle.data.status),
      ) &&
      (!Array.isArray(exact.data.unresolved_variables) ||
        exact.data.unresolved_variables.length === 0)
    ) {
      return {
        id: String(exact.data.id),
        type: "power_of_attorney",
        version: String(
          exact.data.template_version ??
            bundle.data.published_at ??
            exact.data.created_at ??
            exact.data.id,
        ),
        title: String(exact.data.title),
        body: String(exact.data.rendered_body ?? ""),
        published_at:
          typeof bundle.data.published_at === "string"
            ? bundle.data.published_at
            : typeof exact.data.created_at === "string"
              ? exact.data.created_at
              : null,
        status: "published",
      };
    }
    return null;
  }

  // Historical fallback for contracts issued before canonical bundle documents
  // became the public evidence id. New publications never use this path.
  const legacy = await supabaseService
    .from("legal_text_versions")
    .select("id,type,version,title,body,published_at,status")
    .eq("company_id", companyId)
    .eq("id", textVersionId)
    .eq("type", "power_of_attorney")
    .eq("status", "published")
    .maybeSingle();
  if (legacy.error) {
    if (missingSchema(legacy.error)) {
      throw new WebsiteApplicationError({
        message:
          "Fullmaktsversionen kunde inte läsas eftersom canonical juridikmigrationen saknas.",
        status: 500,
        code: "legal_bundle_missing",
        field: "legal_bundle_version_documents",
        stage: "legal_acceptance",
        hint: "Kör senaste migration och retrya ansökan.",
        details: schemaErrorDetail(legacy.error),
      });
    }
    throw legacy.error;
  }
  return (legacy.data as WebsiteLegalAcceptanceVersion | null) ?? null;
}

export async function ensureWebsitePowerOfAttorney(input: {
  companyId: string;
  customerId: string;
  contractId: string | null;
  customerSiteId: string | null;
  meteringPointId: string | null;
  applicationId: string;
  publicOffer: PublicContractOffer | null;
  legalVersions: WebsiteLegalAcceptanceVersion[];
  consents?: Record<string, unknown>;
  requestAudit?: RequestAuditMetadata;
  rawPayload: unknown;
  structuredPoa?: NormalizedStructuredPoa | null;
}) {
  if (
    !consentAccepted(input.consents, [
      "power_of_attorney",
      "poa_accepted",
      "power_of_attorney_accepted",
    ])
  )
    return null;
  if (input.structuredPoa?.accepted !== true) return null;
  if (input.structuredPoa.scope.length === 0) {
    throw new WebsiteApplicationError({
      message: "Signerad fullmakt saknar exakt scope.",
      status: 422,
      code: "power_of_attorney_scope_missing",
      field: "powerOfAttorney.scope",
      stage: "power_of_attorney",
    });
  }
  // Never trust frontend legal text: prefer the explicitly referenced active
  // legal version (textVersionId), then the published power_of_attorney version.
  const requestedVersionId = input.structuredPoa?.textVersionId ?? null;
  const offerPowerOfAttorneyVersion = input.legalVersions.find(
    (row) => (row.module_key ?? row.type) === "power_of_attorney",
  );
  if (
    requestedVersionId &&
    offerPowerOfAttorneyVersion &&
    requestedVersionId !== offerPowerOfAttorneyVersion.id
  ) {
    throw new WebsiteApplicationError({
      message:
        "Angiven fullmaktsversion matchar inte fullmakten i det accepterade offer_reference.",
      status: 409,
      code: "power_of_attorney_offer_version_mismatch",
      field: "powerOfAttorney.textVersionId",
      stage: "power_of_attorney",
      hint:
        "Använd primary_document_id för requirement_code=power_of_attorney från samma legal-bundle som kunden har godkänt, eller utelämna textVersionId så binder OPS den aktuella versionen automatiskt.",
      details: {
        expected_document_id: offerPowerOfAttorneyVersion.id,
        received_document_id: requestedVersionId,
      },
    });
  }
  let referencedLegal: WebsiteLegalAcceptanceVersion | null = null;
  if (requestedVersionId) {
    // loadLegalTextVersionById throws on schema mismatch, so a null result here
    // means the supplied textVersionId does not belong to this tenant.
    referencedLegal = await loadLegalTextVersionById(
      input.companyId,
      requestedVersionId,
    );
    if (!referencedLegal) {
      throw new WebsiteApplicationError({
        message:
          "Angiven fullmaktsversion (textVersionId) tillhör inte detta bolag eller finns inte.",
        status: 422,
        code: "power_of_attorney_version_tenant_mismatch",
        field: "powerOfAttorney.textVersionId",
        stage: "power_of_attorney",
        hint: "Skicka en textVersionId som tillhör samma bolag som API-nyckeln, eller utelämna fältet så används den publicerade fullmaktsversionen.",
      });
    }
    if (referencedLegal.type !== "power_of_attorney") {
      throw new WebsiteApplicationError({
        message:
          "Angiven textVersionId refererar inte till en fullmaktsversion.",
        status: 422,
        code: "power_of_attorney_version_missing",
        field: "powerOfAttorney.textVersionId",
        stage: "power_of_attorney",
      });
    }
    if (referencedLegal.status && referencedLegal.status !== "published") {
      throw new WebsiteApplicationError({
        message: "Angiven fullmaktsversion är inte publicerad.",
        status: 422,
        code: "power_of_attorney_version_not_published",
        field: "powerOfAttorney.textVersionId",
        stage: "power_of_attorney",
        hint: "Publicera fullmaktsversionen i bolagskortet innan kunder kan acceptera den.",
      });
    }
  }
  const legal =
    referencedLegal ??
    input.legalVersions.find((row) => row.type === "power_of_attorney");
  if (!legal) {
    // POA consent was given (gated above) but no published power_of_attorney
    // legal version exists for this tenant. This must fail clearly.
    throw new WebsiteApplicationError({
      message:
        "Det finns ingen publicerad fullmaktsversion för bolaget, men kunden har accepterat fullmakt.",
      status: 422,
      code: "power_of_attorney_version_missing",
      field: "powerOfAttorney",
      stage: "power_of_attorney",
      hint: "Publicera en power_of_attorney-version i bolagskortet i OPS.",
    });
  }

  const now = new Date().toISOString();
  let existingQuery = supabaseService
    .from("powers_of_attorney")
    .select(
      "id,signer_name,signer_identity_number,method,valid_from,legal_text_version_id,signed_scope_snapshot,fullmakt_snapshot,evidence_payload,metadata",
    )
    .eq("company_id", input.companyId)
    .eq("customer_id", input.customerId)
    .eq("scope", "supplier_switch")
    .in("status", ["active", "accepted", "signed"]);

  existingQuery = input.contractId
    ? existingQuery.eq("contract_id", input.contractId)
    : existingQuery.is("contract_id", null);

  const existing = await existingQuery
    .order("created_at", { ascending: false })
    .limit(25);

  if (existing.error && !missingSchema(existing.error)) throw existing.error;
  const submittedScopes = [...input.structuredPoa.scope].sort();
  for (const existingRow of existing.data ?? []) {
    const existingEvidence = existingRow.evidence_payload as
      Record<string, unknown> | null | undefined;
    const existingMetadata = existingRow.metadata as
      Record<string, unknown> | null | undefined;
    const existingIsStructuredComplete =
      existingEvidence?.capture_type === "structured_complete" ||
      existingEvidence?.externally_sendable_at_capture === true ||
      existingMetadata?.poa_capture_type === "structured_complete" ||
      existingMetadata?.externally_sendable === true;
    const existingLooksSendable = Boolean(
      clean(existingRow.signer_name) &&
      clean(existingRow.signer_identity_number) &&
      clean(existingRow.method) &&
      existingIsStructuredComplete,
    );
    const existingSnapshot = isObject(existingRow.fullmakt_snapshot)
      ? existingRow.fullmakt_snapshot
      : {};
    const existingScopesRaw = Array.isArray(existingRow.signed_scope_snapshot)
      ? existingRow.signed_scope_snapshot
      : Array.isArray(existingEvidence?.scopes)
        ? existingEvidence.scopes
        : Array.isArray(existingSnapshot.scopes)
          ? existingSnapshot.scopes
          : [];
    const existingScopes = Array.from(
      new Set<string>(
        existingScopesRaw
          .map((scope: unknown) => String(scope).trim().toLowerCase())
          .filter((scope: string) => scope.length > 0),
      ),
    ).sort();
    const exactScopesMatch =
      existingScopes.length === submittedScopes.length &&
      existingScopes.every((scope, index) => scope === submittedScopes[index]);
    const existingLegalVersionId =
      clean(existingRow.legal_text_version_id) ??
      clean(existingEvidence?.legal_text_version_id) ??
      clean(existingSnapshot.legal_text_version_id);
    const exactLegalVersionMatches = existingLegalVersionId === legal.id;
    // A complete POA may only be reused when its immutable legal version and
    // exact signed scope snapshot match this accepted offer. Different scope or
    // text creates a new POA; OPS never widens an existing authorization.
    if (existingLooksSendable && exactScopesMatch && exactLegalVersionMatches) {
      const existingPowerOfAttorneyId = String(existingRow.id);
      await ensureWebsiteAuthorizationChainFromPowerOfAttorney({
        companyId: input.companyId,
        customerId: input.customerId,
        contractId: input.contractId,
        customerSiteId: input.customerSiteId,
        meteringPointId: input.meteringPointId,
        powerOfAttorneyId: existingPowerOfAttorneyId,
        applicationId: input.applicationId,
        reference: `POA-${input.applicationId}`,
        validFrom: clean(existingRow.valid_from) ?? now.slice(0, 10),
        scopes: input.structuredPoa.scope,
        legal,
        snapshot: {
          source: "website_customer_applications",
          application_id: input.applicationId,
          reused_power_of_attorney_id: existingPowerOfAttorneyId,
          legal_text: {
            id: legal.id,
            type: legal.type,
            version: legal.version,
            title: legal.title,
          },
        },
        evidencePayload: {
          reused: true,
          legal_text_version_id: legal.id,
          scopes: input.structuredPoa.scope,
          source: "website_api",
        },
      });
      return existingPowerOfAttorneyId;
    }
  }

  const poa =
    input.structuredPoa?.accepted === true ? input.structuredPoa : null;
  const externallySendableAtCapture = structuredPoaIsExternallySendable(poa);
  const scopes = poa?.scope ?? [];
  const acceptedAt = poa?.acceptedAt ?? now;
  const method = poa?.method ?? null;
  // Legacy consent-only creates an internal legal acceptance only. It must not
  // silently inherit signer name, identity number or method from the customer
  // record, because that would make a weak consent look externally sendable.
  const signerName = poa?.signerName ?? null;
  const signerIdentityNumber = poa?.signerIdentityNumber ?? null;

  const snapshot = {
    legal_text: {
      id: legal.id,
      type: legal.type,
      version: legal.version,
      title: legal.title,
      body: legal.body,
      published_at: legal.published_at,
    },
    public_offer: input.publicOffer,
    consents: input.consents ?? {},
    application_id: input.applicationId,
    accepted_at: acceptedAt,
    scopes,
  };

  const evidencePayload = {
    accepted: true,
    accepted_at: acceptedAt,
    method,
    scopes,
    signer_name: signerName,
    signer_identity_number: signerIdentityNumber,
    ip_address: poa?.ipAddress ?? input.requestAudit?.ipAddress ?? null,
    user_agent: poa?.userAgent ?? input.requestAudit?.userAgent ?? null,
    legal_text_version_id: legal.id,
    legal_text_version: legal.version,
    source: "website_api",
    externally_sendable_at_capture: externallySendableAtCapture,
    requires_completion: !externallySendableAtCapture,
    capture_type: externallySendableAtCapture
      ? "structured_complete"
      : "legacy_weak_consent",
  };

  const row = {
    company_id: input.companyId,
    customer_id: input.customerId,
    contract_id: input.contractId,
    site_id: input.customerSiteId,
    customer_site_id: input.customerSiteId,
    metering_point_id: input.meteringPointId,
    scope: "supplier_switch",
    status: externallySendableAtCapture ? "signed" : "draft",
    signed_at: externallySendableAtCapture ? now : null,
    accepted_at: acceptedAt,
    valid_from: acceptedAt.slice(0, 10),
    legal_text_version_id: legal.id,
    signed_scope_snapshot: scopes,
    fullmakt_snapshot: snapshot,
    signer_name: signerName,
    signer_identity_number: signerIdentityNumber,
    method,
    evidence_payload: evidencePayload,
    source: "website_api",
    accepted_ip: poa?.ipAddress ?? input.requestAudit?.ipAddress ?? null,
    accepted_ip_hash: input.requestAudit?.ipHash ?? null,
    accepted_user_agent:
      poa?.userAgent ?? input.requestAudit?.userAgent ?? null,
    accepted_source: "website",
    reference: `POA-${input.applicationId}`,
    scope_summary: {
      scopes,
      supplier_switch: scopes.includes("supplier_switch"),
      facility_information_lookup: scopes.includes(
        "facility_information_lookup",
      ),
      customer_site_id: input.customerSiteId,
      metering_point_id: input.meteringPointId,
      contract_id: input.contractId,
    },
    metadata: {
      source: "website_customer_applications",
      application_id: input.applicationId,
      raw_payload: input.rawPayload,
      poa_capture_type: externallySendableAtCapture
        ? "structured_complete"
        : "legacy_weak_consent",
      externally_sendable: externallySendableAtCapture,
      requires_completion: !externallySendableAtCapture,
    },
    updated_at: now,
  };

  const { data, error } = await supabaseService
    .from("powers_of_attorney")
    .insert(row)
    .select("id")
    .maybeSingle();

  if (error) {
    // Do NOT silently swallow schema mismatches here. A required power of
    // attorney that cannot be persisted must fail the whole application so we
    // never produce a "complete" customer without legal authorization.
    if (missingSchema(error)) {
      throw new WebsiteApplicationError({
        message:
          "Fullmakten kunde inte sparas eftersom databasens schema för powers_of_attorney inte matchar.",
        status: 500,
        code: "powers_of_attorney_schema_mismatch",
        field: "powers_of_attorney",
        stage: "power_of_attorney",
        hint: "Kör senaste migration för powers_of_attorney och retrya ansökan från admin.",
        details: schemaErrorDetail(error),
      });
    }
    throw error;
  }

  const powerOfAttorneyId = data?.id ? String(data.id) : null;
  if (powerOfAttorneyId) {
    if (externallySendableAtCapture) {
      const scopeResult = await supabaseService
        .from("power_of_attorney_scopes")
        .insert({
          company_id: input.companyId,
          power_of_attorney_id: powerOfAttorneyId,
          customer_id: input.customerId,
          site_id: input.customerSiteId,
          metering_point_id: input.meteringPointId,
          customer_contract_id: input.contractId,
          scope_type: "supplier_switch",
          status: "active",
          is_active: true,
          valid_from: acceptedAt.slice(0, 10),
          metadata: {
            source: "website_customer_applications",
            application_id: input.applicationId,
            signed_scopes: scopes,
          },
        });

      if (scopeResult.error && !missingSchema(scopeResult.error))
        throw scopeResult.error;
    }

    // Immutable POA document snapshot (JSON) linked back onto the POA row.
    const documentId = await createPowerOfAttorneyDocumentSnapshot({
      companyId: input.companyId,
      customerId: input.customerId,
      contractId: input.contractId,
      customerSiteId: input.customerSiteId,
      meteringPointId: input.meteringPointId,
      powerOfAttorneyId,
      reference: row.reference,
      snapshot,
      evidencePayload,
    });
    const authorizationDocumentId = externallySendableAtCapture
      ? await ensureWebsiteAuthorizationChainFromPowerOfAttorney({
          companyId: input.companyId,
          customerId: input.customerId,
          contractId: input.contractId,
          customerSiteId: input.customerSiteId,
          meteringPointId: input.meteringPointId,
          powerOfAttorneyId,
          applicationId: input.applicationId,
          reference: row.reference,
          validFrom: acceptedAt.slice(0, 10),
          scopes,
          legal,
          snapshot,
          evidencePayload,
          internalSnapshotDocumentId: documentId,
        })
      : null;

    if (authorizationDocumentId || documentId) {
      // The operational document_id must point at the authorization document chain
      // used by customer_info_requests/grid_owner_data_requests/outbound_requests.
      // The old customer_documents JSON snapshot is retained only as internal audit
      // metadata and must never be mailed to a grid owner as the POA attachment.
      await supabaseService
        .from("powers_of_attorney")
        .update({
          document_id: authorizationDocumentId ?? documentId,
          metadata: {
            ...row.metadata,
            authorization_document_id: authorizationDocumentId,
            internal_snapshot_document_id: documentId,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", powerOfAttorneyId)
        .then(
          () => undefined,
          () => undefined,
        );
    }

    // Audit trail: created + accepted (+ internal JSON snapshot created). The
    // JSON snapshot is NOT a generated PDF, so it is recorded as
    // `snapshot_created`. A real `pdf_generated` event is only emitted when an
    // actual PDF is rendered for external grid-owner communication.
    await supabaseService
      .from("power_of_attorney_events")
      .insert([
        {
          company_id: input.companyId,
          power_of_attorney_id: powerOfAttorneyId,
          event_type: "created",
          payload: {
            application_id: input.applicationId,
            source: "website_api",
          },
        },
        {
          company_id: input.companyId,
          power_of_attorney_id: powerOfAttorneyId,
          event_type: "accepted",
          payload: evidencePayload,
        },
        ...(documentId
          ? [
              {
                company_id: input.companyId,
                power_of_attorney_id: powerOfAttorneyId,
                event_type: "snapshot_created" as const,
                payload: {
                  document_id: documentId,
                  mime_type: "application/json",
                  internal_snapshot: true,
                },
              },
            ]
          : []),
      ])
      .then(
        () => undefined,
        () => undefined,
      );
  }

  return powerOfAttorneyId;
}

// Creates an immutable JSON document snapshot for a power of attorney and stores
// it in customer_documents (best-effort; tolerant of missing schema).
async function createPowerOfAttorneyDocumentSnapshot(input: {
  companyId: string;
  customerId: string;
  contractId: string | null;
  customerSiteId: string | null;
  meteringPointId: string | null;
  powerOfAttorneyId: string;
  reference: string;
  snapshot: Record<string, unknown>;
  evidencePayload: Record<string, unknown>;
}): Promise<string | null> {
  const documentRow = {
    company_id: input.companyId,
    customer_id: input.customerId,
    customer_site_id: input.customerSiteId,
    metering_point_id: input.meteringPointId,
    contract_id: input.contractId,
    power_of_attorney_id: input.powerOfAttorneyId,
    document_type: "power_of_attorney",
    title: `Signerad fullmakt ${input.reference}`,
    file_name: `fullmakt-${input.reference}.json`,
    mime_type: "application/json",
    status: "available",
    source: "website_customer_applications",
    source_system: "ops_powers_of_attorney",
    raw_payload: { snapshot: input.snapshot, evidence: input.evidencePayload },
    // Mark explicitly as the internal JSON snapshot. External grid-owner email
    // must attach a PDF (rendered or uploaded), never this JSON record.
    metadata: {
      document_kind: "json_snapshot",
      internal_snapshot: true,
      external_pdf: false,
    },
  };
  const { data, error } = await supabaseService
    .from("customer_documents")
    .insert(documentRow)
    .select("id")
    .maybeSingle();
  if (error) {
    if (missingSchema(error)) return null;
    // Document storage is non-fatal for the POA write path.
    return null;
  }
  return data?.id ? String(data.id) : null;
}

async function ensureWebsiteAuthorizationChainFromPowerOfAttorney(input: {
  companyId: string;
  customerId: string;
  contractId: string | null;
  customerSiteId: string | null;
  meteringPointId: string | null;
  powerOfAttorneyId: string;
  applicationId: string;
  reference: string;
  validFrom: string;
  scopes: string[];
  legal: WebsiteLegalAcceptanceVersion;
  snapshot: Record<string, unknown>;
  evidencePayload: Record<string, unknown>;
  internalSnapshotDocumentId?: string | null;
}): Promise<string | null> {
  const now = new Date().toISOString();
  const existing = await supabaseService
    .from("customer_authorization_documents")
    .select("id")
    .eq("company_id", input.companyId)
    .eq("customer_id", input.customerId)
    .eq("power_of_attorney_id", input.powerOfAttorneyId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing.error && !missingSchema(existing.error)) throw existing.error;

  let authorizationDocumentId = existing.data?.id
    ? String(existing.data.id)
    : null;
  if (!authorizationDocumentId) {
    const snapshotJson = JSON.stringify(
      {
        source: "website_customer_applications",
        application_id: input.applicationId,
        power_of_attorney_id: input.powerOfAttorneyId,
        reference: input.reference,
        snapshot: input.snapshot,
        evidence: input.evidencePayload,
        legal_text_version_id: input.legal.id,
        legal_text_version: input.legal.version,
        scopes: input.scopes,
      },
      null,
      2,
    );
    const filePath = `companies/${input.companyId}/customers/${input.customerId}/authorizations/${input.powerOfAttorneyId}.json`;
    const fileSizeBytes = new TextEncoder().encode(snapshotJson).byteLength;
    const uploadIdempotencyKey = `website-poa:${input.companyId}:${input.applicationId}:${input.powerOfAttorneyId}`;

    const uploadResult = await supabaseService.storage
      .from("customer-documents")
      .upload(filePath, snapshotJson, {
        contentType: "application/json",
        upsert: true,
      });

    if (uploadResult.error) {
      throw new WebsiteApplicationError({
        message: "Fullmaktens JSON-snapshot kunde inte sparas i storage.",
        status: 500,
        code: "power_of_attorney_snapshot_storage_failed",
        field: "customer_authorization_documents.file_path",
        stage: "power_of_attorney",
        details: schemaErrorDetail(uploadResult.error),
      });
    }

    const baseRow: Record<string, unknown> = {
      company_id: input.companyId,
      customer_id: input.customerId,
      site_id: input.customerSiteId,
      metering_point_id: input.meteringPointId,
      customer_contract_id: input.contractId,
      power_of_attorney_id: input.powerOfAttorneyId,
      document_type: "power_of_attorney",
      status: "uploaded",
      title: `Signerad fullmakt ${input.reference}`,
      file_name: `fullmakt-${input.reference}.json`,
      mime_type: "application/json",
      file_size_bytes: fileSizeBytes,
      storage_bucket: "customer-documents",
      file_path: filePath,
      reference: input.reference,
      notes: "Website POA snapshot bound to operational authorization chain.",
      uploaded_at: now,
      upload_idempotency_key: uploadIdempotencyKey,
      metadata: {
        source: "website_customer_applications",
        application_id: input.applicationId,
        legal_text_version_id: input.legal.id,
        legal_text_version: input.legal.version,
        scopes: input.scopes,
        snapshot: input.snapshot,
        evidence: input.evidencePayload,
        internal_snapshot_document_id: input.internalSnapshotDocumentId ?? null,
      },
    };

    let inserted = await supabaseService
      .from("customer_authorization_documents")
      .insert(baseRow)
      .select("id")
      .maybeSingle();

    if (inserted.error && missingSchema(inserted.error)) {
      const fallbackRow = { ...baseRow };
      delete fallbackRow.customer_contract_id;
      delete fallbackRow.metering_point_id;
      delete fallbackRow.file_size_bytes;
      delete fallbackRow.upload_idempotency_key;
      inserted = await supabaseService
        .from("customer_authorization_documents")
        .insert(fallbackRow)
        .select("id")
        .maybeSingle();
    }

    if (inserted.error) {
      if (missingSchema(inserted.error)) {
        throw new WebsiteApplicationError({
          message:
            "Fullmaktens authorization document kunde inte sparas eftersom customer_authorization_documents saknas eller har fel schema.",
          status: 500,
          code: "customer_authorization_document_schema_mismatch",
          field: "customer_authorization_documents",
          stage: "power_of_attorney",
          hint: "Kör senaste migration för customer_authorization_documents och authorization_scopes innan ansökan retryas.",
          details: schemaErrorDetail(inserted.error),
        });
      }
      throw inserted.error;
    }
    authorizationDocumentId = inserted.data?.id
      ? String(inserted.data.id)
      : null;
  }

  if (authorizationDocumentId) {
    const existingScope = await supabaseService
      .from("authorization_scopes")
      .select("id")
      .eq("company_id", input.companyId)
      .eq("customer_id", input.customerId)
      .eq("authorization_document_id", authorizationDocumentId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (existingScope.error && !missingSchema(existingScope.error))
      throw existingScope.error;

    if (!existingScope.data?.id) {
      const signedScopeSnapshot = Array.from(
        new Set(
          input.scopes
            .map((scope) => scope.trim().toLowerCase())
            .filter(Boolean),
        ),
      ).sort();
      if (signedScopeSnapshot.length === 0) {
        throw new WebsiteApplicationError({
          message: "Authorization scope kan inte skapas utan signerade scopes.",
          status: 422,
          code: "authorization_scope_snapshot_missing",
          field: "powerOfAttorney.scope",
          stage: "power_of_attorney",
        });
      }
      const coverage = powerOfAttorneyCoverageFromScopes(signedScopeSnapshot);
      const scopeInsert = await supabaseService
        .from("authorization_scopes")
        .insert({
          company_id: input.companyId,
          customer_id: input.customerId,
          authorization_document_id: authorizationDocumentId,
          scope_type: "supplier_switch_data",
          status: "active",
          covers_grid_owner_data: coverage.coversGridOwnerData,
          covers_current_supplier_contract:
            coverage.coversCurrentSupplierContract,
          covers_metering_data: coverage.coversMeteringData,
          signed_scope_snapshot: signedScopeSnapshot,
          valid_from: input.validFrom,
          evidence_note:
            "Signerad website-fullmakt verifierad och kopplad till uppgifts-/leverantörsbytesflödet.",
          metadata: {
            source: "website_customer_applications",
            application_id: input.applicationId,
            power_of_attorney_id: input.powerOfAttorneyId,
            authorization_document_id: authorizationDocumentId,
            scopes: input.scopes,
          },
        });
      if (scopeInsert.error) {
        if (missingSchema(scopeInsert.error)) {
          throw new WebsiteApplicationError({
            message:
              "Fullmaktens authorization scope kunde inte sparas eftersom authorization_scopes saknas eller har fel schema.",
            status: 500,
            code: "authorization_scope_schema_mismatch",
            field: "authorization_scopes",
            stage: "power_of_attorney",
            hint: "Kör senaste migration för authorization_scopes innan ansökan retryas.",
            details: schemaErrorDetail(scopeInsert.error),
          });
        }
        throw scopeInsert.error;
      }
    }
  }

  return authorizationDocumentId;
}