import type { CustomerContractRow } from "@/lib/customer-contracts/types";
import type { CustomerSiteRow, MeteringPointRow } from "@/lib/masterdata/types";
import type { CustomerInfoRequestRow } from "@/lib/onboarding/infoRequests";
import { hasMeteringPointIdentity } from "@/lib/customers/meteringIdentity";
import {
  derivePowerOfAttorneyLifecycleStatus,
  hasExternallySendablePoa,
  type PowerOfAttorneyLifecycleStatus,
} from "@/lib/customers/poaReadiness";
import type {
  CustomerAuthorizationDocumentRow,
  PowerOfAttorneyRow,
} from "@/lib/operations/types";

type AnyRow = Record<string, unknown>;
type AuthorizationDocumentLike = Pick<
  CustomerAuthorizationDocumentRow,
  "document_type" | "status" | "power_of_attorney_id"
> &
  AnyRow;

type SnapshotInput = {
  sites: CustomerSiteRow[];
  meteringPoints: MeteringPointRow[];
  powersOfAttorney?: PowerOfAttorneyRow[];
  documents?: AuthorizationDocumentLike[];
  customerDocuments?: AnyRow[];
  infoRequests?: CustomerInfoRequestRow[];
  contracts?: CustomerContractRow[];
  legalAcceptances?: AnyRow[];
  legalTextVersions?: AnyRow[];
  workQueueItems?: AnyRow[];
  events?: AnyRow[];
  actionResults?: AnyRow[];
};

export type CustomerCardStatus =
  | "ready"
  | "missing"
  | "needs_review"
  | "waiting"
  | "blocked";

export type CustomerCardSnapshot = {
  primarySite: CustomerSiteRow | null;
  primaryMeteringPoint: MeteringPointRow | null;
  hasAuthorization: boolean;
  hasExternallySendablePoa: boolean;
  hasLegalAcceptance: boolean;
  hasFacilityId: boolean;
  hasMeteringPoint: boolean;
  hasGridOwner: boolean;
  hasGridArea: boolean;
  hasContract: boolean;
  hasPricePlan: boolean;
  hasOpenInfoRequest: boolean;
  legalMissingLabels: string[];
  missingLabels: string[];
  switchBlockerLabels: string[];
  nextStepLabel: string;
  nextStepDescription: string;
  recommendedAction:
    | "request_data"
    | "request_switch"
    | "follow_up"
    | "review_grid_owner";
  authorizationStatus: CustomerCardStatus;
  /** Canonical derived POA lifecycle (missing/awaiting_signature/signed/valid/revoked/expired/replaced). */
  poaLifecycleStatus: PowerOfAttorneyLifecycleStatus;
  legalStatus: CustomerCardStatus;
  facilityStatus: CustomerCardStatus;
  gridOwnerStatus: CustomerCardStatus;
  gridAreaStatus: CustomerCardStatus;
  meteringPointStatus: CustomerCardStatus;
  contractStatus: CustomerCardStatus;
  latestEventLabel: string | null;
  latestActionResultLabel: string | null;
};

export type CustomerReadinessItem = {
  label: string;
  ok: boolean;
  detail: string;
};

function asRecord(value: unknown): AnyRow {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as AnyRow)
    : {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function lower(value: unknown): string {
  return str(value).toLowerCase();
}

function truthy(value: unknown): boolean {
  return typeof value === "string" ? value.trim().length > 0 : Boolean(value);
}

function jsonValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const obj = asRecord(value);
  return Object.keys(obj).length > 0 ? Object.values(obj) : [];
}

export function isSignedPowerOfAttorney(
  row: PowerOfAttorneyRow | AnyRow,
): boolean {
  const raw = row as AnyRow;
  return (
    ["signed", "accepted", "active", "completed"].includes(lower(raw.status)) &&
    Boolean(
      truthy(raw.document_path) ||
      truthy(raw.signed_at) ||
      truthy(raw.accepted_at) ||
      truthy(raw.reference) ||
      truthy(raw.fullmakt_snapshot) ||
      Object.keys(asRecord(raw.fullmakt_snapshot)).length > 0,
    )
  );
}

export function isAvailablePowerOfAttorneyDocument(
  row: AuthorizationDocumentLike | AnyRow,
): boolean {
  const raw = row as AnyRow;
  if (lower(raw.document_type) !== "power_of_attorney") return false;
  return [
    "available",
    "active",
    "uploaded",
    "signed",
    "suggested",
    "completed",
  ].includes(lower(raw.status));
}

export function hasValidPowerOfAttorney(
  powersOfAttorney: Array<PowerOfAttorneyRow | AnyRow> = [],
  documents: Array<AuthorizationDocumentLike | AnyRow> = [],
): boolean {
  return (
    powersOfAttorney.some(isSignedPowerOfAttorney) ||
    documents.some(isAvailablePowerOfAttorneyDocument)
  );
}

function normalizeLegalType(value: unknown): string {
  const normalized = lower(value).replaceAll("-", "_").replaceAll(" ", "_");
  if (
    ["terms", "general_terms", "allmanna_villkor", "allmänna_villkor"].includes(
      normalized,
    )
  )
    return "terms";
  if (
    ["privacy", "privacy_policy", "integritet", "integritetspolicy"].includes(
      normalized,
    )
  )
    return "privacy_policy";
  if (
    [
      "withdrawal",
      "withdrawal_info",
      "cancellation_right",
      "angerratt",
      "ångerrätt",
    ].includes(normalized)
  )
    return "withdrawal";
  if (["power_of_attorney", "poa", "fullmakt"].includes(normalized))
    return "power_of_attorney";
  if (
    [
      "price_terms",
      "price_snapshot",
      "pricing",
      "prisvillkor",
      "prisbild",
    ].includes(normalized)
  )
    return "price_terms";
  return normalized;
}

function acceptedLegalTypes(
  acceptances: AnyRow[],
  legalTextVersions: AnyRow[],
): Set<string> {
  const typeByVersionId = new Map<string, string>();
  for (const version of legalTextVersions) {
    if (truthy(version.id))
      typeByVersionId.set(
        String(version.id),
        normalizeLegalType(
          version.type ?? version.legal_type ?? version.document_type,
        ),
      );
  }

  const types = new Set<string>();
  for (const row of acceptances) {
    const direct = normalizeLegalType(
      row.acceptance_type ?? row.type ?? row.legal_type,
    );
    if (direct) types.add(direct);
    const byVersion = typeByVersionId.get(
      String(row.legal_text_version_id ?? ""),
    );
    if (byVersion) types.add(byVersion);

    for (const value of [
      ...jsonValues(row.snapshot),
      ...jsonValues(row.metadata),
    ]) {
      const mapped = normalizeLegalType(value);
      if (mapped) types.add(mapped);
    }
  }
  return types;
}

function legalStatus(input: {
  acceptances: AnyRow[];
  legalTextVersions: AnyRow[];
  hasAuthorization: boolean;
  hasContract: boolean;
}): { ok: boolean; missing: string[] } {
  const types = acceptedLegalTypes(input.acceptances, input.legalTextVersions);
  const enoughRows = input.acceptances.length >= 4;
  const hasTerms = enoughRows || types.has("terms");
  const hasPrivacy = enoughRows || types.has("privacy_policy");
  const hasWithdrawal = enoughRows || types.has("withdrawal");
  const hasPoa =
    enoughRows || types.has("power_of_attorney") || input.hasAuthorization;
  const hasPrice =
    enoughRows ||
    types.has("price_terms") ||
    types.has("price_snapshot") ||
    input.hasContract;
  const missing = [
    hasTerms ? null : "Allmänna villkor",
    hasPrivacy ? null : "Integritetspolicy",
    hasWithdrawal ? null : "Ångerrättsinformation",
    hasPoa ? null : "Fullmaktstext",
    hasPrice ? null : "Prisvillkor/prisbild",
  ].filter((item): item is string => Boolean(item));
  return { ok: missing.length === 0, missing };
}

export function humanizeMissingField(value: unknown): string {
  const raw = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const normalized = raw
    .toLowerCase()
    .replaceAll("_", " ")
    .replaceAll("-", " ");
  if (normalized.includes("metering point") || normalized.includes("mätpunkt"))
    return "Mätpunkt/anläggnings-ID";
  if (normalized.includes("facility verified"))
    return "Verifierade anläggningsuppgifter";
  if (normalized.includes("facility") || normalized.includes("anlägg"))
    return "Anläggnings-ID";
  if (normalized.includes("grid owner") || normalized.includes("nätäg"))
    return "Verifierad nätägare";
  if (
    normalized.includes("power of attorney") ||
    normalized.includes("fullmakt")
  )
    return "Signerad fullmakt";
  if (
    normalized.includes("price plan") ||
    normalized.includes("price") ||
    normalized.includes("prisplan")
  )
    return "Kopplad prisplan/prisversion";
  if (normalized.includes("contract") || normalized.includes("avtal"))
    return "Avtal";
  if (normalized.includes("legal") || normalized.includes("villkor"))
    return "Juridiska godkännanden";
  if (
    normalized.includes("route") ||
    normalized.includes("prodat") ||
    normalized.includes("z01") ||
    normalized.includes("z03") ||
    normalized.includes("ediel")
  )
    return "Kontaktväg till nätägare";
  if (normalized.includes("manual review")) return "Kräver granskning";
  return raw.replace(/[{}"\[\]]/g, "").replaceAll("_", " ");
}

export function humanizeBlockerReason(value: unknown): string {
  if (!value) return "";
  if (Array.isArray(value))
    return value.map(humanizeBlockerReason).filter(Boolean).join(", ");
  if (typeof value === "object") {
    const raw = asRecord(value);
    return humanizeBlockerReason(
      raw.label ??
        raw.message ??
        raw.action ??
        raw.field ??
        JSON.stringify(raw),
    );
  }
  const raw = String(value);
  const normalized = raw.toLowerCase();
  if (normalized.includes("platform_route_exists_but_not_materialized"))
    return "Nätägaren är verifierad i aktörsregistret, men operativ route saknas.";
  if (normalized.includes("operational_route_missing"))
    return "Operativ route saknas för nätägaren.";
  if (normalized.includes("production_send_locked"))
    return "Produktionsutskick är låst tills första sändningen är godkänd av plattformsadministratör.";
  if (normalized.includes("certificate_missing"))
    return "Mottagarcertifikat saknas eller behöver verifieras.";
  if (normalized.includes("grid_area_not_verified"))
    return "Nätområde eller nätägare behöver verifieras innan begäran kan skickas.";
  if (normalized.includes("missing_power_of_attorney"))
    return "Signerad fullmakt behöver verifieras innan begäran kan skickas.";
  if (normalized.includes("environment_mismatch"))
    return "Miljö stämmer inte mellan route, aktörsinställning, certifikat eller transport.";
  if (normalized.includes("ambiguous_sender_settings"))
    return "Flera avsändarinställningar matchar. Systemet gissar inte.";
  if (
    normalized.includes("prodat") ||
    normalized.includes("z01") ||
    normalized.includes("z03") ||
    normalized.includes("route") ||
    normalized.includes("ediel")
  ) {
    if (normalized.includes("grid") || normalized.includes("nät"))
      return "Nätägare behöver verifieras innan begäran kan skickas.";
    if (normalized.includes("meter"))
      return "Mätpunkt eller anläggnings-ID behöver kompletteras innan begäran kan skickas.";
    return "Kontaktvägen till mottagaren behöver verifieras innan begäran kan skickas.";
  }
  if (normalized.includes("auth") || normalized.includes("fullmakt"))
    return "Signerad fullmakt behöver verifieras innan begäran kan skickas.";
  if (normalized.includes("{") || normalized.includes('"field"'))
    return humanizeMissingField(raw);
  return humanizeMissingField(raw);
}

function latestLabel(rows: AnyRow[]): string | null {
  const row = rows[0];
  if (!row) return null;
  return str(row.title) || str(row.event_type) || str(row.status) || null;
}

export function buildCustomerCardSnapshot(
  input: SnapshotInput,
): CustomerCardSnapshot {
  const documents = [
    ...(input.documents ?? []),
    ...(input.customerDocuments ?? []),
  ];
  const primarySite =
    input.sites.find((site) => site.status === "active") ??
    input.sites[0] ??
    null;
  const primaryMeteringPoint = primarySite
    ? (input.meteringPoints.find(
        (point) =>
          point.site_id === primarySite.id && point.status === "active",
      ) ??
      input.meteringPoints.find((point) => point.site_id === primarySite.id) ??
      null)
    : (input.meteringPoints[0] ?? null);

  const hasAuthorization = hasValidPowerOfAttorney(
    input.powersOfAttorney ?? [],
    documents,
  );
  // Distinct from legal acceptance: a POA is only externally sendable to a grid
  // owner when it carries customer identity, signer/evidence/method and a
  // snapshot or document. "Fullmakt klar" for external use must use this.
  const hasExternallySendable = (input.powersOfAttorney ?? []).some((poa) =>
    hasExternallySendablePoa(poa as AnyRow),
  );
  // Newest POA drives the derived lifecycle status (missing when none exists).
  const newestPoa = [...(input.powersOfAttorney ?? [])].sort((a, b) =>
    String((b as AnyRow).created_at ?? "").localeCompare(
      String((a as AnyRow).created_at ?? ""),
    ),
  )[0] as AnyRow | undefined;
  const poaLifecycleStatus = derivePowerOfAttorneyLifecycleStatus(
    newestPoa ?? null,
  );
  const hasFacilityId = truthy(primarySite?.facility_id);
  const hasMeteringPoint = hasMeteringPointIdentity(primaryMeteringPoint);
  const gridOwnerResolution = lower(
    asRecord(primarySite).resolution_status ??
      asRecord(primaryMeteringPoint).resolution_status,
  );
  const hasGridOwner =
    (truthy(primaryMeteringPoint?.grid_owner_id) || truthy(primarySite?.grid_owner_id)) &&
    ![
      "grid_owner_suggested",
      "postal_suggested",
      "needs_review",
      "manual_review_required",
    ].includes(gridOwnerResolution);
  const hasGridArea =
    truthy(primaryMeteringPoint?.grid_area_code) || truthy(primarySite?.grid_area_code);
  const hasResolvableSiteAddress = Boolean(
    primarySite?.street?.trim() &&
      /^\d{5}$/.test((primarySite.postal_code ?? "").replace(/\D/g, "")) &&
      primarySite?.city?.trim(),
  );
  const hasContract = (input.contracts ?? []).length > 0;
  const hasPricePlan = (input.contracts ?? []).some((contract) => {
    const raw = contract as unknown as AnyRow;
    return (
      truthy(raw.price_plan_id) ||
      truthy(raw.price_plan_version_id) ||
      truthy(raw.contract_price_snapshot_id) ||
      truthy(raw.contract_name)
    );
  });
  const hasOpenInfoRequest = (input.infoRequests ?? []).some(
    (request) =>
      !["completed", "cancelled", "rejected"].includes(
        String(request.status ?? "").toLowerCase(),
      ),
  );
  const legal = legalStatus({
    acceptances: input.legalAcceptances ?? [],
    legalTextVersions: input.legalTextVersions ?? [],
    hasAuthorization,
    hasContract,
  });

  const workQueueMissing = (input.workQueueItems ?? []).flatMap((row) =>
    Array.isArray(row.missing_fields)
      ? row.missing_fields.map(humanizeMissingField)
      : [],
  );
  const missingLabels = Array.from(
    new Set(
      [
        hasAuthorization ? null : "Signerad fullmakt",
        legal.ok ? null : "Juridiska godkännanden",
        hasFacilityId ? null : "Anläggnings-ID",
        hasMeteringPoint ? null : "Mätpunkt",
        hasGridOwner ? null : "Verifierad nätägare",
        hasGridArea ? null : "Nätområde",
        hasContract ? null : "Avtal",
        hasPricePlan
          ? null
          : hasContract
            ? "Kopplad prisplan/prisversion"
            : "Avtal",
        ...workQueueMissing,
      ].filter((value): value is string => Boolean(value)),
    ),
  ).filter((label) => !(hasAuthorization && label === "Signerad fullmakt"));

  const switchBlockerLabels = missingLabels.filter(
    (label) => !["Avtal", "Juridiska godkännanden"].includes(label),
  );
  const recommendedAction =
    switchBlockerLabels.length === 0
      ? "request_switch"
      : hasOpenInfoRequest
        ? "follow_up"
        : !hasGridOwner && !hasResolvableSiteAddress
          ? "review_grid_owner"
          : "request_data";
  const nextStepLabel =
    recommendedAction === "request_switch"
      ? "Begär leverantörsbyte"
      : recommendedAction === "follow_up"
        ? "Följ upp pågående uppgiftsbegäran"
        : recommendedAction === "review_grid_owner"
          ? "Verifiera nätägare/nätområde"
          : "Begär uppgifter";
  const nextStepDescription =
    recommendedAction === "request_switch"
      ? "Grunduppgifterna ser klara ut. Systemet gör en sista kontroll innan något skickas."
      : switchBlockerLabels.length > 0
        ? `Saknas: ${switchBlockerLabels.join(", ")}.`
        : "Systemet väntar på svar eller komplettering.";

  return {
    primarySite,
    primaryMeteringPoint,
    hasAuthorization,
    hasExternallySendablePoa: hasExternallySendable,
    hasLegalAcceptance: legal.ok,
    hasFacilityId,
    hasMeteringPoint,
    hasGridOwner,
    hasGridArea,
    hasContract,
    hasPricePlan,
    legalMissingLabels: legal.missing,
    missingLabels,
    switchBlockerLabels,
    nextStepLabel,
    nextStepDescription,
    recommendedAction,
    hasOpenInfoRequest,
    authorizationStatus: hasAuthorization ? "ready" : "missing",
    poaLifecycleStatus,
    legalStatus: legal.ok ? "ready" : "missing",
    facilityStatus: hasFacilityId ? "ready" : "missing",
    gridOwnerStatus: hasGridOwner ? "ready" : "needs_review",
    gridAreaStatus: hasGridArea ? "ready" : "needs_review",
    meteringPointStatus: hasMeteringPoint ? "ready" : "missing",
    contractStatus: hasContract
      ? hasPricePlan
        ? "ready"
        : "needs_review"
      : "missing",
    latestEventLabel: latestLabel(input.events ?? []),
    latestActionResultLabel: latestLabel(input.actionResults ?? []),
  };
}

export function buildCustomerReadinessItems(
  snapshot: CustomerCardSnapshot,
): CustomerReadinessItem[] {
  return [
    {
      label: "Juridik",
      ok: snapshot.hasLegalAcceptance,
      detail: snapshot.hasLegalAcceptance
        ? "Juridiska godkännanden finns"
        : `Saknas: ${snapshot.legalMissingLabels.join(", ")}`,
    },
    {
      label: "Avtal",
      ok: snapshot.hasContract,
      detail: snapshot.hasContract
        ? snapshot.hasPricePlan
          ? "Avtal/pris finns"
          : "Avtal finns men prisplan/prisversion behöver kontrolleras"
        : "Saknar kundavtal",
    },
    {
      label: "Fullmakt",
      ok: snapshot.hasAuthorization,
      detail: !snapshot.hasAuthorization
        ? "Fullmakt saknas"
        : snapshot.hasExternallySendablePoa
          ? "Fullmakt klar för nätägarkommunikation"
          : "Fullmakt finns (juridiskt), men saknar underlag för extern sändning",
    },
    {
      label: "Anläggning",
      ok: snapshot.hasFacilityId,
      detail: snapshot.hasFacilityId
        ? "Anläggnings-ID finns"
        : "Anläggnings-ID saknas",
    },
    {
      label: "Mätpunkt",
      ok: snapshot.hasMeteringPoint,
      detail: snapshot.hasMeteringPoint ? "Mätpunkt finns" : "Mätpunkt saknas",
    },
    {
      label: "Nätägare",
      ok: snapshot.hasGridOwner,
      detail: snapshot.hasGridOwner
        ? "Nätägare finns"
        : "Nätägare behöver verifieras",
    },
    {
      label: "Nätområde",
      ok: snapshot.hasGridArea,
      detail: snapshot.hasGridArea
        ? "Nätområde finns"
        : "Nätområde behöver verifieras",
    },
  ];
}
