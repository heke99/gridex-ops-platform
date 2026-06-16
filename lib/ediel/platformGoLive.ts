import { supabaseService } from "@/lib/supabase/service";
import {
  REQUIRED_LEGAL_TEXT_TYPES,
  type LegalTextType,
  type TenantWebsiteReadiness,
} from "@/lib/opsMaster/readiness";

export type GoLiveSetupStatus = "ready" | "manual_review_required" | "blocked";

export type GoLiveSetupSummary = {
  companyId: string;
  companyName: string | null;
  orgNumber: string | null;
  status: GoLiveSetupStatus;
  score: number;
  edielId: string | null;
  brpEdielId: string | null;
  senderSubAddress: string | null;
  receiverSubAddressPolicy:
    | "not_required_by_default"
    | "route_specific"
    | "missing_when_required";
  sharedMailboxMode:
    | "shared_platform_mailbox"
    | "company_specific_mailbox"
    | "missing";
  routeResolutionMode: "automatic" | "manual_review_required";
  hasActorSetting: boolean;
  hasBrp: boolean;
  hasProdatRoute: boolean;
  hasUtiltsRoute: boolean;
  hasSharedMailbox: boolean;
  hasSenderIdentity: boolean;
  hasPublishedContracts: boolean;
  legal: Record<LegalTextType, boolean>;
  blockers: string[];
  warnings: string[];
  nextActions: string[];
  routeSimulation: GoLiveRouteSimulation;
};

export type GoLiveRouteSimulation = {
  messageFamily: "PRODAT" | "UTILTS" | "CONTRL" | "APERAK" | "UTILTS_ERR";
  processType: string;
  senderEdielId: string | null;
  senderSubAddress: string | null;
  receiverSource: string;
  receiverEdielId: string | null;
  receiverSubAddress: string | null;
  applicationReference: string | null;
  encryptionRequired: boolean;
  transportMode:
    | "shared_platform_mailbox"
    | "company_specific_mailbox"
    | "missing";
  blockers: string[];
  warnings: string[];
};

type DbRow = Record<string, unknown>;

function isSchemaCompatibilityError(error: unknown): boolean {
  const record =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  const code = String(record.code ?? "");
  const message = String(record.message ?? record.details ?? "");
  return (
    ["42P01", "42703", "PGRST200", "PGRST201", "PGRST204", "PGRST205"].includes(
      code,
    ) ||
    /schema cache|does not exist|column .* does not exist|relationship/i.test(
      message,
    )
  );
}

function str(row: DbRow | null | undefined, ...keys: string[]): string | null {
  if (!row) return null;
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim().length > 0)
      return value.trim();
  }
  return null;
}

function boolish(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function jsonObj(value: unknown): DbRow {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as DbRow)
    : {};
}

function jsonStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
    : [];
}

function normalizeUpper(value: string | null): string | null {
  return value ? value.trim().toUpperCase() : null;
}

function first<T>(rows: T[]): T | null {
  return rows.length > 0 ? (rows[0] ?? null) : null;
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values.filter((value): value is string =>
        Boolean(value && value.trim().length > 0),
      ),
    ),
  );
}

async function safeRows<T extends DbRow>(
  label: string,
  loader: () => Promise<{ data: unknown[] | null; error: unknown }>,
): Promise<T[]> {
  const { data, error } = await loader();
  if (error) {
    if (isSchemaCompatibilityError(error)) return [];
    console.warn(`[go-live-readiness] ${label} kunde inte läsas`, error);
    return [];
  }
  return (Array.isArray(data) ? data : []) as T[];
}

async function safeMaybeSingle<T extends DbRow>(
  label: string,
  loader: () => Promise<{ data: unknown | null; error: unknown }>,
): Promise<T | null> {
  const { data, error } = await loader();
  if (error) {
    if (isSchemaCompatibilityError(error)) return null;
    console.warn(`[go-live-readiness] ${label} kunde inte läsas`, error);
    return null;
  }
  return (data ?? null) as T | null;
}

async function listCompanies(companyId?: string | null): Promise<DbRow[]> {
  const detailed = await safeRows<DbRow>("companies", async () => {
    let query = supabaseService
      .from("companies")
      .select(
        "id,name,org_number,organization_number,ediel_id,production_ediel_id,production_sender_sub_address,production_mailbox,production_application_reference,ediel_production_enabled,production_readiness_status,ediel_route_resolution_mode,ediel_shared_transport_mode",
      )
      .order("name", { ascending: true });
    if (companyId) query = query.eq("id", companyId);
    return query;
  });

  if (detailed.length > 0) return detailed;

  return safeRows<DbRow>("companies fallback", async () => {
    let query = supabaseService
      .from("companies")
      .select("id,name")
      .order("name", { ascending: true });
    if (companyId) query = query.eq("id", companyId);
    return query;
  });
}

async function getTenantWebsiteReadinessSafe(
  companyId: string,
): Promise<TenantWebsiteReadiness | null> {
  return safeMaybeSingle<TenantWebsiteReadiness & DbRow>(
    "tenant_website_readiness_v",
    async () =>
      supabaseService
        .from("tenant_website_readiness_v")
        .select("*")
        .eq("company_id", companyId)
        .maybeSingle(),
  );
}

function routeMatchesFamily(route: DbRow, family: string): boolean {
  const routeFamily = normalizeUpper(str(route, "message_family"));
  const applicationReference = normalizeUpper(
    str(route, "application_reference"),
  );
  const routeScope = normalizeUpper(str(route, "route_scope"));
  const metadataFamily = normalizeUpper(str(route, "metadata_message_family"));
  if (routeFamily === family || metadataFamily === family) return true;
  if (family === "PRODAT" && applicationReference === "PRODAT") return true;
  if (family === "UTILTS" && applicationReference === "UTILTS") return true;
  if (family === "PRODAT" && routeScope?.includes("SUPPLIER_SWITCH"))
    return true;
  return false;
}

function buildLegalMap(
  legalRows: DbRow[],
  websiteReadiness: TenantWebsiteReadiness | null,
): Record<LegalTextType, boolean> {
  const published = new Set(
    legalRows
      .filter((row) => str(row, "status") === "published")
      .map((row) => str(row, "type"))
      .filter((value): value is string => Boolean(value)),
  );

  return {
    terms: published.has("terms") || Boolean(websiteReadiness?.has_terms),
    privacy_policy:
      published.has("privacy_policy") ||
      Boolean(websiteReadiness?.has_privacy_policy),
    withdrawal:
      published.has("withdrawal") || Boolean(websiteReadiness?.has_withdrawal),
    power_of_attorney:
      published.has("power_of_attorney") ||
      Boolean(websiteReadiness?.has_power_of_attorney_text),
    price_terms:
      published.has("price_terms") ||
      Boolean(websiteReadiness?.has_price_terms),
  };
}

function buildRouteSimulation(input: {
  company: DbRow;
  actor: DbRow | null;
  brp: DbRow | null;
  productionRoutes: DbRow[];
  mailboxes: DbRow[];
}): GoLiveRouteSimulation {
  const prodatRoute =
    input.productionRoutes.find((route) =>
      routeMatchesFamily(route, "PRODAT"),
    ) ?? first(input.productionRoutes);
  const senderEdielId =
    normalizeUpper(str(input.actor, "ediel_id", "actor_ediel_id")) ??
    normalizeUpper(str(input.company, "production_ediel_id", "ediel_id"));
  const senderSubAddress =
    normalizeUpper(
      str(input.actor, "sender_subaddress", "sender_sub_address"),
    ) ?? normalizeUpper(str(input.company, "production_sender_sub_address"));
  const receiverSource =
    str(prodatRoute, "receiver_source") ?? "selected_metering_point_grid_owner";
  const receiverEdielId = normalizeUpper(str(prodatRoute, "receiver_ediel_id"));
  const receiverSubAddress = normalizeUpper(
    str(
      prodatRoute,
      "receiver_subaddress",
      "receiver_sub_address",
      "receiver_message_subaddress",
    ),
  );
  const applicationReference =
    normalizeUpper(str(prodatRoute, "application_reference")) ??
    normalizeUpper(str(input.company, "production_application_reference")) ??
    "PRODAT";
  const sharedMailbox =
    input.mailboxes.find((mailbox) => !str(mailbox, "company_id")) ??
    first(input.mailboxes);
  const transportMode = sharedMailbox
    ? !str(sharedMailbox, "company_id")
      ? "shared_platform_mailbox"
      : "company_specific_mailbox"
    : "missing";
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!senderEdielId) blockers.push("Tenantens Ediel-ID saknas.");
  if (!prodatRoute)
    blockers.push("PRODAT är inte aktiverat för produktion ännu.");
  if (!input.brp)
    warnings.push(
      "BRP/balansansvarig saknas eller är inte vald för production.",
    );
  if (!sharedMailbox) blockers.push("Gridex shared production mailbox saknas.");
  if (receiverSource === "fixed_counterparty" && !receiverEdielId)
    blockers.push("Fast motpart saknar receiver Ediel-ID.");
  if (receiverSource !== "fixed_counterparty" && receiverEdielId)
    warnings.push(
      "Produktionsprofilen har fast receiver trots dynamiskt nätägarflöde. Använd fast receiver endast i avancerat specialfall/test.",
    );
  if (!applicationReference) blockers.push("Application Reference saknas.");

  return {
    messageFamily: "PRODAT",
    processType: "supplier_switch_or_facility_data",
    senderEdielId,
    senderSubAddress,
    receiverSource,
    receiverEdielId,
    receiverSubAddress,
    applicationReference,
    encryptionRequired: true,
    transportMode,
    blockers,
    warnings,
  };
}

function summaryFromReadinessViewRow(row: DbRow): GoLiveSetupSummary {
  const decision = jsonObj(row.prodat_route_decision);
  const blockers = unique([
    ...jsonStringArray(decision.blockers),
    !boolish(row.has_actor_setting)
      ? "Bolaget saknar production Ediel-ID i aktiv actor setting."
      : null,
    !boolish(row.has_prodat_route)
      ? "PRODAT är inte aktiverat för produktion ännu."
      : null,
    !boolish(row.has_shared_mailbox)
      ? "Gridex shared production mailbox saknas eller är inte aktiv."
      : null,

    !boolish(row.has_terms) ? "Publicerad juridisk text saknas: terms." : null,
    !boolish(row.has_privacy_policy)
      ? "Publicerad juridisk text saknas: privacy_policy."
      : null,
    !boolish(row.has_withdrawal)
      ? "Publicerad juridisk text saknas: withdrawal."
      : null,
    !boolish(row.has_power_of_attorney_text)
      ? "Publicerad juridisk text saknas: power_of_attorney."
      : null,
    !boolish(row.has_price_terms)
      ? "Publicerad juridisk text saknas: price_terms."
      : null,
  ]);
  const warnings = unique([
    ...jsonStringArray(decision.warnings),
    !boolish(row.has_brp) ? "BRP/balansansvarig saknas för production." : null,
    !boolish(row.has_utilts_route)
      ? "UTILTS är inte aktiverat för produktion ännu."
      : null,
    !boolish(row.has_sender_identity)
      ? "Verifierad avsändaridentitet för kundmail saknas."
      : null,
    !boolish(row.has_published_contracts)
      ? "Hemsida/API saknar publicerat avtal. Påverkar bara hemsidan och Mina sidor; Ediel production och intern kundhantering kan fortsätta."
      : null,
  ]);
  const score = Math.max(
    0,
    Math.min(100, 100 - blockers.length * 12 - warnings.length * 5),
  );
  const status: GoLiveSetupStatus =
    blockers.length > 0
      ? "blocked"
      : warnings.length > 0
        ? "manual_review_required"
        : "ready";
  const transportMode = String(
    decision.transportMode ?? "missing",
  ) as GoLiveRouteSimulation["transportMode"];
  return {
    companyId: String(row.company_id),
    companyName: str(row, "company_name"),
    orgNumber: null,
    status,
    score,
    edielId: normalizeUpper(str(row, "ediel_id")),
    brpEdielId: str(row, "brp_ediel_id"),
    senderSubAddress: normalizeUpper(
      String(decision.senderSubaddress ?? "").trim() || null,
    ),
    receiverSubAddressPolicy: decision.receiverSubaddress
      ? "route_specific"
      : "not_required_by_default",
    sharedMailboxMode: [
      "shared_platform_mailbox",
      "company_specific_mailbox",
      "missing",
    ].includes(transportMode)
      ? transportMode
      : "missing",
    routeResolutionMode:
      decision.manualReceiverAllowed === true && !decision.receiverEdielId
        ? "manual_review_required"
        : "automatic",
    hasActorSetting: boolish(row.has_actor_setting),
    hasBrp: boolish(row.has_brp),
    hasProdatRoute: boolish(row.has_prodat_route),
    hasUtiltsRoute: boolish(row.has_utilts_route),
    hasSharedMailbox: boolish(row.has_shared_mailbox),
    hasSenderIdentity: boolish(row.has_sender_identity),
    hasPublishedContracts: boolish(row.has_published_contracts),
    legal: {
      terms: boolish(row.has_terms),
      privacy_policy: boolish(row.has_privacy_policy),
      withdrawal: boolish(row.has_withdrawal),
      power_of_attorney: boolish(row.has_power_of_attorney_text),
      price_terms: boolish(row.has_price_terms),
    },
    blockers,
    warnings,
    nextActions:
      blockers.length > 0
        ? blockers.slice(0, 5)
        : warnings.length > 0
          ? warnings.slice(0, 5)
          : [
              "Tenantens grundkonfiguration är redo. Kör route-simulering och dry run innan första live-send.",
            ],
    routeSimulation: {
      messageFamily: "PRODAT",
      processType: String(
        decision.processType ?? "supplier_switch_or_facility_data",
      ),
      senderEdielId: normalizeUpper(
        String(decision.senderEdielId ?? "").trim() || null,
      ),
      senderSubAddress: normalizeUpper(
        String(decision.senderSubaddress ?? "").trim() || null,
      ),
      receiverSource: String(
        decision.receiverSource ?? "selected_metering_point_grid_owner",
      ),
      receiverEdielId: normalizeUpper(
        String(decision.receiverEdielId ?? "").trim() || null,
      ),
      receiverSubAddress: normalizeUpper(
        String(decision.receiverSubaddress ?? "").trim() || null,
      ),
      applicationReference: normalizeUpper(
        String(decision.applicationReference ?? "").trim() || null,
      ),
      encryptionRequired: decision.encryptionRequired === true,
      transportMode: [
        "shared_platform_mailbox",
        "company_specific_mailbox",
        "missing",
      ].includes(transportMode)
        ? transportMode
        : "missing",
      blockers: jsonStringArray(decision.blockers),
      warnings: jsonStringArray(decision.warnings),
    },
  };
}

export async function getCompanyGoLiveSetupSummary(
  companyId: string,
): Promise<GoLiveSetupSummary | null> {
  const company = first(await listCompanies(companyId));
  if (!company) return null;

  const [
    actors,
    brps,
    routes,
    mailboxes,
    legalRows,
    websiteReadiness,
    senderSettings,
  ] = await Promise.all([
    safeRows<DbRow>("ediel_actor_settings", async () =>
      supabaseService
        .from("ediel_actor_settings")
        .select(
          "id,company_id,actor_name,actor_ediel_id,ediel_id,actor_role,role,environment,sender_sub_address,sender_subaddress,receiver_sub_address,receiver_subaddress,application_reference,default_application_reference,is_active,metadata,updated_at",
        )
        .eq("company_id", companyId)
        .eq("environment", "production")
        .order("updated_at", { ascending: false })
        .limit(10),
    ),
    safeRows<DbRow>("ediel_brp_settings", async () =>
      supabaseService
        .from("ediel_brp_settings")
        .select(
          "id,company_id,environment,brp_ediel_id,brp_name,is_default,valid_from,valid_to",
        )
        .eq("company_id", companyId)
        .eq("environment", "production")
        .order("is_default", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(10),
    ),
    safeRows<DbRow>("ediel_route_profiles", async () =>
      supabaseService
        .from("ediel_route_profiles")
        .select(
          "id,company_id,environment,route_name,message_family,application_reference,receiver_source,dynamic_receiver_strategy,sender_ediel_id,sender_sub_address,sender_subaddress,receiver_ediel_id,receiver_sub_address,receiver_subaddress,receiver_message_subaddress,is_enabled,is_active,is_production_route,encryption_mode,allow_unencrypted_production,certificate_required,receiver_certificate_id,certificate_id,security_policy_status,metadata,updated_at",
        )
        .eq("company_id", companyId)
        .eq("environment", "production")
        .order("updated_at", { ascending: false })
        .limit(50),
    ),
    safeRows<DbRow>("ediel_mailboxes", async () =>
      supabaseService
        .from("ediel_mailboxes")
        .select(
          "id,company_id,environment,mailbox_name,email_address,is_active,secret_reference,poll_interval_minutes,last_polled_at,locked_at,metadata",
        )
        .eq("environment", "production")
        .eq("is_active", true)
        .limit(20),
    ),
    safeRows<DbRow>("legal_text_versions", async () =>
      supabaseService
        .from("legal_text_versions")
        .select("id,company_id,type,status,published_at")
        .eq("company_id", companyId)
        .in("type", [...REQUIRED_LEGAL_TEXT_TYPES])
        .order("created_at", { ascending: false }),
    ),
    getTenantWebsiteReadinessSafe(companyId),
    safeRows<DbRow>("company_email_settings", async () =>
      supabaseService
        .from("company_email_settings")
        .select(
          "id,company_id,sender_email,verification_status,is_default,provider",
        )
        .eq("company_id", companyId)
        .limit(20),
    ),
  ]);

  const activeActors = actors.filter(
    (row) =>
      boolish(row.is_active) ||
      row.is_active === null ||
      row.is_active === undefined,
  );
  const actor = first(activeActors) ?? first(actors);
  const brp = brps.find((row) => boolish(row.is_default)) ?? first(brps);
  const activeRoutes = routes.filter(
    (row) => row.is_enabled !== false && row.is_active !== false,
  );
  const hasProdatRoute = activeRoutes.some((route) =>
    routeMatchesFamily(route, "PRODAT"),
  );
  const hasUtiltsRoute = activeRoutes.some((route) =>
    routeMatchesFamily(route, "UTILTS"),
  );
  const legal = buildLegalMap(legalRows, websiteReadiness);
  const routeSimulation = buildRouteSimulation({
    company,
    actor,
    brp,
    productionRoutes: activeRoutes,
    mailboxes,
  });
  const hasSharedMailbox = mailboxes.some(
    (mailbox) => !str(mailbox, "company_id") && boolish(mailbox.is_active),
  );
  const hasSenderIdentity =
    senderSettings.some((row) =>
      ["verified", "completed", "active"].includes(
        String(row.verification_status ?? "").toLowerCase(),
      ),
    ) || Boolean(websiteReadiness?.has_verified_sender);
  const hasPublishedContracts = Boolean(websiteReadiness?.has_public_contracts);
  const edielId = routeSimulation.senderEdielId;
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!actor || !edielId)
    blockers.push("Bolaget saknar production Ediel-ID i aktiv actor setting.");
  if (!brp) warnings.push("BRP/balansansvarig saknas för production.");
  if (!hasProdatRoute)
    blockers.push("PRODAT är inte aktiverat för produktion ännu.");
  if (!hasUtiltsRoute)
    warnings.push("UTILTS är inte aktiverat för produktion ännu.");
  if (!hasSharedMailbox)
    blockers.push(
      "Gridex shared production mailbox saknas eller är inte aktiv.",
    );
  if (!hasSenderIdentity)
    warnings.push("Verifierad avsändaridentitet för kundmail saknas.");
  if (!hasPublishedContracts)
    warnings.push(
      "Hemsida/API saknar publicerat avtal. Påverkar bara hemsidan och Mina sidor; Ediel production och intern kundhantering kan fortsätta.",
    );

  for (const type of REQUIRED_LEGAL_TEXT_TYPES) {
    if (!legal[type])
      blockers.push(`Publicerad juridisk text saknas: ${type}.`);
  }

  blockers.push(...routeSimulation.blockers);
  warnings.push(...routeSimulation.warnings);

  const cleanBlockers = unique(blockers);
  const cleanWarnings = unique(warnings);
  const scoreBase = 100;
  const score = Math.max(
    0,
    Math.min(
      100,
      scoreBase - cleanBlockers.length * 12 - cleanWarnings.length * 5,
    ),
  );
  const status: GoLiveSetupStatus =
    cleanBlockers.length > 0
      ? "blocked"
      : cleanWarnings.length > 0
        ? "manual_review_required"
        : "ready";

  return {
    companyId,
    companyName: str(company, "name"),
    orgNumber: str(company, "org_number", "organization_number"),
    status,
    score,
    edielId,
    brpEdielId: str(brp, "brp_ediel_id"),
    senderSubAddress: routeSimulation.senderSubAddress,
    receiverSubAddressPolicy: routeSimulation.receiverSubAddress
      ? "route_specific"
      : "not_required_by_default",
    sharedMailboxMode: routeSimulation.transportMode,
    routeResolutionMode:
      routeSimulation.receiverSource === "fixed_counterparty" &&
      !routeSimulation.receiverEdielId
        ? "manual_review_required"
        : "automatic",
    hasActorSetting: Boolean(actor && edielId),
    hasBrp: Boolean(brp),
    hasProdatRoute,
    hasUtiltsRoute,
    hasSharedMailbox,
    hasSenderIdentity,
    hasPublishedContracts,
    legal,
    blockers: cleanBlockers,
    warnings: cleanWarnings,
    nextActions:
      cleanBlockers.length > 0
        ? cleanBlockers.slice(0, 5)
        : cleanWarnings.length > 0
          ? cleanWarnings.slice(0, 5)
          : [
              "Tenantens grundkonfiguration är redo. Kör route-simulering och dry run innan första live-send.",
            ],
    routeSimulation,
  };
}

export async function listPlatformGoLiveSetupSummaries(): Promise<
  GoLiveSetupSummary[]
> {
  const viewRows = await safeRows<DbRow>(
    "platform_go_live_readiness_v",
    async () =>
      supabaseService
        .from("platform_go_live_readiness_v")
        .select("*")
        .order("company_name", { ascending: true })
        .limit(300),
  );
  if (viewRows.length > 0) return viewRows.map(summaryFromReadinessViewRow);

  const companies = await listCompanies();
  const limited = companies.slice(0, 80);
  return (
    await Promise.all(
      limited.map((company) =>
        getCompanyGoLiveSetupSummary(String(company.id)),
      ),
    )
  ).filter((summary): summary is GoLiveSetupSummary => Boolean(summary));
}
