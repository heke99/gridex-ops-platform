import { supabaseService } from "@/lib/supabase/service";

export const REQUIRED_LEGAL_TEXT_TYPES = [
  "terms",
  "privacy_policy",
  "withdrawal",
  "power_of_attorney",
  "price_terms",
] as const;
export type LegalTextType = (typeof REQUIRED_LEGAL_TEXT_TYPES)[number];

export type LegalTextVersion = {
  id: string;
  company_id: string;
  type: LegalTextType | string;
  version: string;
  title: string;
  body?: string | null;
  status: "draft" | "published" | "archived" | string;
  published_at: string | null;
  created_at: string;
  updated_at: string | null;
  metadata?: Record<string, unknown> | null;
};

export type CustomerLegalAcceptance = {
  id: string;
  company_id: string;
  customer_id: string;
  contract_id: string | null;
  contract_application_id: string | null;
  acceptance_type: string;
  legal_text_version_id: string | null;
  accepted_at: string;
  accepted_ip?: string | null;
  accepted_user_agent?: string | null;
  source: string;
  snapshot: Record<string, unknown>;
  metadata: Record<string, unknown>;
  reason?: string | null;
};

export type CustomerDocument = {
  id: string;
  company_id: string | null;
  customer_id: string | null;
  contract_id?: string | null;
  document_type: string | null;
  document_version?: string | null;
  title: string | null;
  file_name: string | null;
  storage_key?: string | null;
  file_path?: string | null;
  source?: string | null;
  status?: string | null;
  created_at: string | null;
  metadata?: Record<string, unknown> | null;
};

export type CustomerOpsTimelineEvent = {
  company_id: string | null;
  customer_id: string | null;
  created_at: string | null;
  event_type: string | null;
  title: string | null;
  source: string | null;
  source_id: string | null;
  metadata: Record<string, unknown> | null;
};

export type TenantWebsiteReadiness = {
  company_id: string;
  company_name: string | null;
  has_api_client: boolean;
  has_allowed_origin: boolean;
  has_public_contracts: boolean;
  has_terms: boolean;
  has_privacy_policy: boolean;
  has_withdrawal: boolean;
  has_power_of_attorney_text: boolean;
  has_price_terms: boolean;
  has_verified_sender: boolean;
  has_mail_templates: boolean;
  missing_items: string[];
  evaluated_at: string | null;
};

export type CustomerOpsBlocker = {
  code: string;
  label: string;
  action: string;
  tab:
    | "legal-readiness"
    | "authorization-documents"
    | "data-requests"
    | "contracts"
    | "sites"
    | "metering-points"
    | "switch-operations"
    | "communication"
    | "overview";
};

export type CustomerOpsReadiness = {
  canStartSupplierSwitch: boolean;
  canRequestFacilityData: boolean;
  canSendMail: boolean;
  hasTerms: boolean;
  hasPrivacy: boolean;
  hasWithdrawal: boolean;
  hasPriceSnapshot: boolean;
  hasPowerOfAttorneyAcceptance: boolean;
  hasActivePowerOfAttorney: boolean;
  hasContractSnapshot: boolean;
  hasFacility: boolean;
  hasMeteringPoint: boolean;
  hasGridOwner: boolean;
  hasGridArea: boolean;
  hasEdielRoute: boolean;
  hasCommunicationLogs: boolean;
  blockers: CustomerOpsBlocker[];
  nextAction: {
    label: string;
    hrefTab: CustomerOpsBlocker["tab"];
    description: string;
  };
};

function missingSchema(error: unknown): boolean {
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

function asArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function str(row: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function boolish(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function jsonObj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function listCompanyLegalTextVersions(
  companyId: string,
): Promise<LegalTextVersion[]> {
  const { data, error } = await supabaseService
    .from("legal_text_versions")
    .select(
      "id,company_id,type,version,title,body,status,published_at,created_at,updated_at,metadata",
    )
    .eq("company_id", companyId)
    .order("type", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) {
    if (missingSchema(error)) return [];
    throw error;
  }

  return (data ?? []) as LegalTextVersion[];
}

export async function getTenantWebsiteReadiness(
  companyId: string,
): Promise<TenantWebsiteReadiness | null> {
  const { data, error } = await supabaseService
    .from("tenant_website_readiness_v")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();

  if (error) {
    if (missingSchema(error)) return null;
    throw error;
  }

  return data as TenantWebsiteReadiness | null;
}

export async function listCustomerLegalAcceptances(
  companyId: string,
  customerId: string,
): Promise<CustomerLegalAcceptance[]> {
  const { data, error } = await supabaseService
    .from("customer_legal_acceptances")
    .select(
      "id,company_id,customer_id,contract_id,contract_application_id,acceptance_type,legal_text_version_id,accepted_at,accepted_ip,accepted_user_agent,source,snapshot,metadata,reason",
    )
    .eq("company_id", companyId)
    .eq("customer_id", customerId)
    .order("accepted_at", { ascending: false });

  if (error) {
    if (missingSchema(error)) return [];
    throw error;
  }

  return ((data ?? []) as CustomerLegalAcceptance[]).map((row) => ({
    ...row,
    snapshot: jsonObj(row.snapshot),
    metadata: jsonObj(row.metadata),
  }));
}

export async function listCustomerDocuments(
  companyId: string,
  customerId: string,
): Promise<CustomerDocument[]> {
  const { data, error } = await supabaseService
    .from("customer_documents")
    .select(
      "id,company_id,customer_id,contract_id,document_type,document_version,title,file_name,storage_key,file_path,source,status,created_at,metadata",
    )
    .eq("company_id", companyId)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    if (missingSchema(error)) return [];
    throw error;
  }

  return ((data ?? []) as CustomerDocument[]).map((row) => ({
    ...row,
    metadata: jsonObj(row.metadata),
  }));
}

export async function listCustomerOpsTimeline(
  companyId: string,
  customerId: string,
): Promise<CustomerOpsTimelineEvent[]> {
  const { data, error } = await supabaseService
    .from("customer_ops_timeline_v")
    .select("*")
    .eq("company_id", companyId)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    if (missingSchema(error)) return [];
    throw error;
  }

  return ((data ?? []) as CustomerOpsTimelineEvent[]).map((row) => ({
    ...row,
    metadata: jsonObj(row.metadata),
  }));
}

function normalizeLegalType(value: unknown): string {
  const normalized =
    typeof value === "string"
      ? value.trim().toLowerCase().replaceAll("-", "_").replaceAll(" ", "_")
      : "";
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
      "withdrawal_right",
      "angerratt",
      "ångerrätt",
    ].includes(normalized)
  )
    return "withdrawal_info";
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
    return "price_snapshot";
  return normalized;
}

function hasAcceptance(rows: CustomerLegalAcceptance[], type: string): boolean {
  const wanted = normalizeLegalType(type);
  if (
    rows.length >= 4 &&
    [
      "terms",
      "privacy_policy",
      "withdrawal_info",
      "power_of_attorney",
    ].includes(wanted)
  )
    return true;
  return rows.some((row) => {
    const direct = normalizeLegalType(row.acceptance_type);
    if (direct === wanted) return true;
    const snapshot = jsonObj(row.snapshot);
    const metadata = jsonObj(row.metadata);
    return Object.values(snapshot)
      .concat(Object.values(metadata))
      .some((value) => normalizeLegalType(value) === wanted);
  });
}

function recordDateActive(row: Record<string, unknown>): boolean {
  const status = String(row.status ?? "").toLowerCase();
  const validStatus = ["signed", "accepted", "active", "completed"].includes(
    status,
  );
  if (!validStatus) return false;
  if (str(row, "revoked_at")) return false;
  const validUntil = str(row, "valid_until", "valid_to");
  if (!validUntil) return true;
  return new Date(validUntil).getTime() + 24 * 60 * 60 * 1000 > Date.now();
}

function poaAllows(row: Record<string, unknown>, scope: string): boolean {
  const directScope = str(row, "scope");
  if (directScope === scope) return true;
  if (directScope === "all" || directScope === "supplier_switch")
    return [
      "supplier_switch",
      "facility_data_request",
      "metering_point_lookup",
      "ediel_communication",
    ].includes(scope);
  const summary = jsonObj(row.scope_summary);
  if (boolish(summary[scope])) return true;
  const metadata = jsonObj(row.metadata);
  const scopes = Array.isArray(metadata.scopes)
    ? metadata.scopes.map(String)
    : [];
  return scopes.includes(scope);
}

function hasSnapshot(row: Record<string, unknown>): boolean {
  return Boolean(
    str(row, "contract_price_snapshot_id", "price_plan_version_id") ||
    Object.keys(jsonObj(row.price_snapshot)).length > 0 ||
    Object.keys(jsonObj(row.version_snapshot)).length > 0 ||
    Object.keys(jsonObj(row.legal_acceptance_snapshot)).length > 0,
  );
}

export function evaluateCustomerOpsMasterReadiness(input: {
  customerId: string;
  customerStatus?: string | null;
  contracts?: Array<Record<string, unknown>>;
  powersOfAttorney?: Array<Record<string, unknown>>;
  sites?: Array<Record<string, unknown>>;
  meteringPoints?: Array<Record<string, unknown>>;
  legalAcceptances?: CustomerLegalAcceptance[];
  documents?: CustomerDocument[];
  communicationLogs?: Array<Record<string, unknown>>;
  hasReadyEdielRoute?: boolean;
}): CustomerOpsReadiness {
  const contracts = asArray(input.contracts);
  const powersOfAttorney = asArray(input.powersOfAttorney);
  const sites = asArray(input.sites);
  const meteringPoints = asArray(input.meteringPoints);
  const acceptances = asArray(input.legalAcceptances);
  const communicationLogs = asArray(input.communicationLogs);
  const documents = asArray(input.documents);

  const activePoaRows = powersOfAttorney.filter(recordDateActive);
  const hasPowerOfAttorneyDocument = documents.some(
    (row) =>
      String(row.document_type ?? "").toLowerCase() === "power_of_attorney" &&
      ["available", "active", "uploaded", "signed", "completed"].includes(
        String(row.status ?? "").toLowerCase(),
      ),
  );
  const hasTerms = hasAcceptance(acceptances, "terms");
  const hasPrivacy = hasAcceptance(acceptances, "privacy_policy");
  const hasWithdrawal = hasAcceptance(acceptances, "withdrawal_info");
  const hasPriceSnapshot =
    hasAcceptance(acceptances, "price_snapshot") || contracts.some(hasSnapshot);
  const hasPowerOfAttorneyAcceptance =
    hasAcceptance(acceptances, "power_of_attorney") ||
    activePoaRows.length > 0 ||
    hasPowerOfAttorneyDocument;
  const hasActivePowerOfAttorney =
    hasPowerOfAttorneyDocument ||
    activePoaRows.some((row) => poaAllows(row, "supplier_switch"));
  const hasFacilityPoa =
    hasPowerOfAttorneyDocument ||
    activePoaRows.some(
      (row) =>
        poaAllows(row, "facility_data_request") ||
        poaAllows(row, "metering_point_lookup"),
    );
  const hasContractSnapshot = contracts.some(hasSnapshot);
  const hasFacility = sites.length > 0;
  const hasMeteringPoint = meteringPoints.some((row) =>
    Boolean(
      str(
        row,
        "meter_point_id",
        "metering_point_id",
        "ediel_metering_point_id",
      ),
    ),
  );
  const hasGridOwner =
    sites.some((row) =>
      Boolean(str(row, "grid_owner_id", "grid_owner_code")),
    ) || meteringPoints.some((row) => Boolean(str(row, "grid_owner_id")));
  const hasGridArea =
    sites.some((row) => Boolean(str(row, "grid_area_code"))) ||
    meteringPoints.some((row) => Boolean(str(row, "grid_area_code")));
  const hasEdielRoute = Boolean(input.hasReadyEdielRoute);
  const hasCommunicationLogs = communicationLogs.length > 0;

  const blockers: CustomerOpsBlocker[] = [];
  const add = (
    code: string,
    label: string,
    action: string,
    tab: CustomerOpsBlocker["tab"],
  ) => blockers.push({ code, label, action, tab });

  if (!hasTerms)
    add(
      "terms_missing",
      "Villkor saknas",
      "Be kunden godkänna allmänna villkor eller registrera ett manuellt godkännande med orsak.",
      "legal-readiness",
    );
  if (!hasPrivacy)
    add(
      "privacy_missing",
      "Integritetspolicy saknas",
      "Spara kundens godkännande av integritetspolicyn innan flödet går vidare.",
      "legal-readiness",
    );
  if (!hasWithdrawal)
    add(
      "withdrawal_missing",
      "Ångerrättsinformation saknas",
      "Skicka eller visa ångerrättsinformation och spara snapshot.",
      "legal-readiness",
    );
  if (!hasPriceSnapshot)
    add(
      "price_snapshot_missing",
      "Prissnapshot saknas",
      "Spara exakt avtal/prisversion/pristext som kunden tecknade.",
      "contracts",
    );
  if (!hasPowerOfAttorneyAcceptance)
    add(
      "poa_acceptance_missing",
      "Fullmaktens godkännande saknas",
      "Be kunden godkänna fullmakten separat, inte bara som del av villkor.",
      "legal-readiness",
    );
  if (!hasActivePowerOfAttorney)
    add(
      "poa_missing",
      "Aktiv fullmakt saknas",
      "Lägg in eller begär fullmakt med rätt scope för leverantörsbyte.",
      "authorization-documents",
    );
  if (!hasContractSnapshot)
    add(
      "contract_snapshot_missing",
      "Avtalssnapshot saknas",
      "Spara avtalssnapshot innan leverantörsbyte eller fakturering används.",
      "contracts",
    );
  if (!hasFacility)
    add(
      "facility_missing",
      "Anläggning saknas",
      "Komplettera kundens anläggning eller begär uppgifter från nätägare.",
      "sites",
    );
  if (!hasMeteringPoint)
    add(
      "metering_point_missing",
      "Mätpunkts-ID saknas",
      "Begär anläggningsuppgifter från nätägare eller komplettera mätpunkt.",
      "metering-points",
    );
  if (!hasGridOwner)
    add(
      "grid_owner_missing",
      "Nätägare saknas",
      "Kör adress-/nätområdesmatchning eller verifiera nätägare från masterdata.",
      "sites",
    );
  if (!hasGridArea)
    add(
      "grid_area_missing",
      "Nätområde saknas",
      "Verifiera nätområdeskod via adress/polygon/masterdata innan Ediel skickas.",
      "sites",
    );
  if (!hasEdielRoute)
    add(
      "ediel_route_missing",
      "Kontaktväg saknas",
      "Verifiera nätägare och kontaktväg innan teknisk sändning kan göras.",
      "switch-operations",
    );

  const canRequestFacilityData =
    hasFacilityPoa && (hasGridOwner || hasGridArea);
  const canStartSupplierSwitch = blockers.length === 0;
  const canSendMail =
    hasContractSnapshot && hasTerms && hasPrivacy && hasWithdrawal;

  const first = blockers[0];
  const nextAction = first
    ? { label: first.action, hrefTab: first.tab, description: first.label }
    : {
        label: "Begär leverantörsbyte",
        hrefTab: "switch-operations" as const,
        description: "Alla juridiska och operativa grundkrav är uppfyllda.",
      };

  return {
    canStartSupplierSwitch,
    canRequestFacilityData,
    canSendMail,
    hasTerms,
    hasPrivacy,
    hasWithdrawal,
    hasPriceSnapshot,
    hasPowerOfAttorneyAcceptance,
    hasActivePowerOfAttorney,
    hasContractSnapshot,
    hasFacility,
    hasMeteringPoint,
    hasGridOwner,
    hasGridArea,
    hasEdielRoute,
    hasCommunicationLogs,
    blockers,
    nextAction,
  };
}
