//lib/ediel/routeMaterializer.ts
import { requireElRegistryRouteSource } from "@/lib/actor-registry/registryMarketSource";
import { supabaseService } from "@/lib/supabase/service";
import { evaluateRouteProfileProductionReadiness } from "@/lib/ediel/routeProfileProductionReadiness";
import { makeCustomerOperationBlocker } from "@/lib/customer-operations/blockers";
import { getCompanyGridOwnerRouteReadiness } from "@/lib/ediel/companyRouteReadiness";
import {
  resolveSenderSettings,
  senderSettingProductionLockStatus,
  type SenderSettingRow,
} from "@/lib/ediel/senderSettingsResolver";
import { projectCanonicalAckMode } from "@/lib/ediel/ack/routeAckModeProjection";
import { validateRouteDeclaredApplicationReference } from "@/lib/ediel/core/applicationReferenceResolver";
import { validateApplicationReferencePolicy } from "@/lib/ediel/intent/applicationReferencePolicy";
import { canonicalAiListProfile, canonicalProdatProfiles } from "@/lib/ediel/rulebook/canonicalEdielFacade";
import {
  routeScopeForProcess,
  targetSystemForEnvironment,
} from "@/lib/ediel/routeMatrix";
import {
  ensureGridOwnerTechnicalAckRoutes,
  type TechnicalAckMaterializationResult,
} from "@/lib/ediel/technicalAckRouteMaterializer";

type JsonRecord = Record<string, unknown>;

function pgErrorCode(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && code.trim() ? code.trim() : null;
}

function pgErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  const candidate = error as { message?: unknown; details?: unknown; hint?: unknown } | null;
  return [candidate?.message, candidate?.details, candidate?.hint]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ") || String(error ?? "unknown_error");
}

function isSchemaError(error: unknown): boolean {
  const code = pgErrorCode(error) ?? "";
  return (
    ["42P01", "42703", "PGRST204", "PGRST205"].includes(code) ||
    /schema cache|does not exist|column .* does not exist|could not find the table/i.test(pgErrorMessage(error))
  );
}

function isUniqueViolation(error: unknown): boolean {
  return pgErrorCode(error) === "23505";
}

// Maps a thrown upsert error to the structured per-step reason code so the
// caller never surfaces a raw exception into a Server Component render.
function stepFailureReason(
  error: unknown,
  insertFailed: string,
  updateFailed: string,
  isUpdate: boolean,
): string {
  if (isSchemaError(error)) return "schema_mismatch";
  if (isUniqueViolation(error)) return "duplicate_route_conflict";
  return isUpdate ? updateFailed : insertFailed;
}

export type PlatformActorRouteRow = {
  id: string;
  actor_id: string;
  message_family: string;
  application_reference: string | null;
  environment: "test" | "production";
  subaddress: string | null;
  communication_type: string | null;
  communication_address: string | null;
  party_id: string | null;
  interchange_party_id: string | null;
  is_verified: boolean;
  auto_send_allowed?: boolean | null;
  status: string;
  metadata: JsonRecord | null;
};

export type GridOwnerMaterializationRow = {
  id: string;
  company_id: string | null;
  name: string | null;
  ediel_id: string | null;
  platform_market_actor_id: string | null;
};

export type ActorSettingRow = SenderSettingRow;

export type RouteMaterializationResult = {
  platformActorRouteId: string;
  companyId: string | null;
  gridOwnerId: string | null;
  status: "materialized" | "skipped" | "blocked";
  reasonCode: string | null;
  nextRequiredAction: string | null;
  communicationRouteId: string | null;
  edielRouteProfileId: string | null;
  companyMarketPartyRouteId: string | null;
  technicalMessage?: string | null;
  messageFamily?: string | null;
  messageCode?: string | null;
  environment?: string | null;
  /** FINDINGS F92: the grid owner's technical CONTRL/APERAK reply routes, ensured after a successful materialization. */
  technicalAck?: TechnicalAckMaterializationResult | null;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function upper(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function lower(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function metadata(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}


function defaultMessageCode(messageFamily: string): string | null {
  if (upper(messageFamily) === "PRODAT") return "Z01";
  if (upper(messageFamily) === "AI_LIST") return canonicalAiListProfile().supplierOutboundType;
  return null;
}

// One canonical PRODAT profile per route scope: the first message the supplier
// sends to the grid owner in each scope (Z01 customer_masterdata, Z03 supplier_switch).
function supplierToGridOwnerScopeProfiles() {
  const byScope = new Map<string, ReturnType<typeof canonicalProdatProfiles>[number]>();
  for (const profile of canonicalProdatProfiles()) {
    if (profile.direction !== "actor_to_portal" || profile.senderRole !== "supplier" || profile.receiverRole !== "grid_owner") continue;
    const scope = routeScopeForProcess({ messageFamily: "PRODAT", messageCode: profile.messageCode });
    if (scope && !byScope.has(scope)) byScope.set(scope, profile);
  }
  return [...byScope.values()];
}

/**
 * FINDINGS F85: a grid owner's registry PRODAT route carries every PRODAT scope
 * the supplier sends to that grid owner, one operational route per scope:
 * Z01 → customer_masterdata and Z03 → supplier_switch. The route engine selects
 * by scope alone, so Z08 travels on the Z01 route and Z09 on the Z03 route; a
 * second code per scope would make the scope's profile ambiguous. Z13/Z18 are
 * ESCO messages on 23-DGI-PRODAT and are not a supplier scope. Z01 stays
 * unconditional (F41); another scope is offered only when the route declares
 * no Application Reference or that scope's own.
 * Mirrors gridex_company_route_readiness_v (migration 20261022121000).
 */
export function registryRouteMessageCodes(
  route: Pick<PlatformActorRouteRow, "metadata" | "application_reference">,
  messageFamily: string,
): Array<string | null> {
  const declared = metadata(route.metadata).message_code;
  const fallback = defaultMessageCode(messageFamily);
  if (declared !== undefined && declared !== null) return [text(declared) ?? fallback];
  if (upper(messageFamily) !== "PRODAT") return [fallback];
  const declaredReference = upper(route.application_reference);
  return supplierToGridOwnerScopeProfiles()
    .filter((profile) => profile.messageCode === fallback || !declaredReference || declaredReference === profile.applicationReference)
    .map((profile) => profile.messageCode);
}

// The Z01 route keeps its established name; another PRODAT scope of the same
// registry route is named by its scope so the two routes are distinguishable.
function prodatScopeSuffix(messageFamily: string, routeScope: string | null): string {
  return upper(messageFamily) === "PRODAT" && routeScope && routeScope !== "customer_masterdata" ? ` ${routeScope}` : "";
}

function materializedFamily(sourceFamily: string): string {
  return upper(sourceFamily) === "AI" ? "AI_LIST" : upper(sourceFamily);
}

function roleMatches(row: ActorSettingRow, messageFamily: string): boolean {
  const role = lower(row.role ?? row.actor_role);
  const roles = Array.isArray(row.market_roles)
    ? row.market_roles.map(lower)
    : [];
  if (upper(messageFamily) === "PRODAT") {
    return (
      !role ||
      role === "supplier" ||
      role === "electricity_supplier" ||
      roles.includes("supplier") ||
      roles.includes("electricity_supplier")
    );
  }
  return true;
}

function routeAllowsBlankSubaddress(route: PlatformActorRouteRow): boolean {
  const meta = metadata(route.metadata);
  const status = lower(meta.subaddress_status);
  return (
    !text(route.subaddress) &&
    (status === "not_required_confirmed" ||
      meta.blank_subaddress_requires_review === false)
  );
}

export async function getPlatformActorRoute(
  routeId: string,
): Promise<PlatformActorRouteRow | null> {
  const { data, error } = await supabaseService
    .from("platform_actor_routes")
    .select("*")
    .eq("id", routeId)
    .maybeSingle();
  if (error) throw error;
  return (data as PlatformActorRouteRow | null) ?? null;
}

async function getMappedGridOwners(
  actorId: string,
): Promise<GridOwnerMaterializationRow[]> {
  const { data, error } = await supabaseService
    .from("grid_owners")
    .select("id,company_id,name,ediel_id,platform_market_actor_id")
    .eq("platform_market_actor_id", actorId)
    .eq("is_active", true);
  if (error) throw error;
  return (data ?? []) as GridOwnerMaterializationRow[];
}

async function candidateCompanyIds(params: {
  gridOwnerCompanyId?: string | null;
  environment: string;
  messageFamily: string;
}): Promise<string[]> {
  if (params.gridOwnerCompanyId) return [params.gridOwnerCompanyId];
  const { data, error } = await supabaseService
    .from("ediel_actor_settings")
    .select("company_id,role,actor_role,market_roles")
    .eq("environment", params.environment)
    .eq("is_active", true)
    .not("company_id", "is", null)
    .limit(500);
  if (error) throw error;
  const ids = new Set<string>();
  for (const row of (data ?? []) as ActorSettingRow[]) {
    if (row.company_id && roleMatches(row, params.messageFamily))
      ids.add(row.company_id);
  }
  return [...ids];
}

async function upsertCommunicationRoute(params: {
  actorUserId: string | null;
  companyId: string;
  route: PlatformActorRouteRow;
  gridOwner: GridOwnerMaterializationRow;
  messageFamily: string;
  messageCode: string | null;
}): Promise<string> {
  const routeScope = routeScopeForProcess({ messageFamily: params.messageFamily, messageCode: params.messageCode }) ?? "customer_masterdata";
  const routeName = `${params.gridOwner.name ?? "Nätägare"} ${params.messageFamily}${prodatScopeSuffix(params.messageFamily, routeScope)} ${params.route.environment}`;
  const authConfig = {
    platform_actor_route_id: params.route.id,
    platform_market_actor_id: params.route.actor_id,
    materialized_from: "platform_actor_routes",
    message_family: params.messageFamily,
    message_code: params.messageCode,
    environment: params.route.environment,
    receiver_subaddress_status:
      metadata(params.route.metadata).subaddress_status ?? null,
    blank_subaddress_requires_review:
      metadata(params.route.metadata).blank_subaddress_requires_review ?? null,
  };
  const existing = await supabaseService
    .from("communication_routes")
    .select("id,auth_config")
    .eq("company_id", params.companyId)
    .eq("grid_owner_id", params.gridOwner.id)
    .eq("route_scope", routeScope)
    .limit(20);
  if (existing.error) throw existing.error;
  const match = ((existing.data ?? []) as Array<JsonRecord>).find(
    (row) =>
      metadata(row.auth_config).platform_actor_route_id === params.route.id,
  );
  const payload = {
    company_id: params.companyId,
    route_name: routeName,
    is_active: true,
    route_scope: routeScope,
    // communication_routes_route_type_check allows only
    // partner_api | ediel_partner | file_export | email_manual.
    // EDIEL counterparty operational routes are 'ediel_partner'.
    route_type: "ediel_partner",
    route_group: "grid_owner",
    grid_owner_id: params.gridOwner.id,
    target_system: targetSystemForEnvironment(params.route.environment),
    endpoint: params.route.communication_address,
    target_email: params.route.communication_address,
    auth_config: authConfig,
    supported_payload_version: params.messageFamily,
    supported_message_families: [params.messageFamily],
    supported_message_codes: params.messageCode ? [params.messageCode] : [],
    environment_type: params.route.environment,
    market_party_role: "grid_owner",
    counterparty_ediel_id:
      text(params.route.party_id) ??
      text(params.route.interchange_party_id) ??
      text(params.gridOwner.ediel_id),
    notes: "Materialiserad från verifierad aktörsregister-route.",
    updated_by: params.actorUserId,
    updated_at: new Date().toISOString(),
  };
  const query = match?.id
    ? supabaseService
        .from("communication_routes")
        .update(payload)
        .eq("id", match.id)
    : supabaseService
        .from("communication_routes")
        .insert({ ...payload, created_by: params.actorUserId });
  const { data, error } = await query.select("id").single();
  if (error) throw Object.assign(error as object, { gridexIsUpdate: Boolean(match?.id) });
  return String((data as { id: string }).id);
}

// Our sub-address for a family: the sender sub-address of our files to the grid
// owner and the one the grid owner addresses its files to us with.
function ownSubaddressForFamily(senderSettings: ActorSettingRow, messageFamily: string): string | null {
  if (messageFamily === "AI_LIST") return text(senderSettings.sender_subaddress) ?? text(senderSettings.sender_sub_address);
  const familySubaddress = messageFamily === "PRODAT" ? senderSettings.sender_subaddress_prodat : senderSettings.sender_subaddress_utilts;
  return text(familySubaddress) ?? text(senderSettings.sender_subaddress) ?? text(senderSettings.sender_sub_address);
}

/**
 * FINDINGS F92: after the grid owner's PRODAT/UTILTS route is materialized, the
 * tenant also gets the technical reply routes for the files that grid owner sends
 * it. Never fails the business materialization; the outcome is reported.
 */
async function materializeTechnicalAckRoutes(params: {
  actorUserId: string | null;
  companyId: string;
  route: PlatformActorRouteRow;
  gridOwner: GridOwnerMaterializationRow;
  senderSettings: ActorSettingRow;
  messageFamily: string;
}): Promise<TechnicalAckMaterializationResult> {
  const result = await ensureGridOwnerTechnicalAckRoutes({
    actorUserId: params.actorUserId,
    companyId: params.companyId,
    route: params.route,
    gridOwner: params.gridOwner,
    senderSettings: params.senderSettings,
    ownSubaddress: ownSubaddressForFamily(params.senderSettings, params.messageFamily),
    messageFamily: params.messageFamily,
  });
  for (const route of result.routes) {
    if (route.action === "kept_existing") continue;
    await applySafeRouteProfileReadiness({ routeProfileId: route.edielRouteProfileId, actorUserId: params.actorUserId });
  }
  if (result.status !== "materialized" && result.reasonCode !== "technical_ack_family_not_applicable") {
    console.warn("[routeMaterializer] Technical ACK routes not materialized", {
      companyId: params.companyId,
      gridOwnerId: params.gridOwner.id,
      platformActorRouteId: params.route.id,
      reasonCode: result.reasonCode,
    });
  }
  return result;
}

export async function upsertRouteProfile(params: {
  actorUserId: string | null;
  route: PlatformActorRouteRow;
  communicationRouteId: string;
  gridOwner: GridOwnerMaterializationRow;
  senderSettings: ActorSettingRow;
  messageFamily: string;
  messageCode: string | null;
}): Promise<string> {
  const senderEdielId =
    text(params.senderSettings.ediel_id) ??
    text(params.senderSettings.actor_ediel_id);
  const senderSubaddress = ownSubaddressForFamily(params.senderSettings, params.messageFamily);
  const receiverEdielId = text(params.route.interchange_party_id);
  if (!receiverEdielId) throw new Error("ediel_registry_technical_receiver_required");
  const isAiList = params.messageFamily === "AI_LIST";
  // PRODAT's reference follows from the message code alone; a sender setting
  // holds a tenant-wide label and must not override it (FINDINGS F41). UTILTS
  // has no policy default, so the sender's declared reference still applies.
  const configuredApplicationReference = isAiList || params.messageFamily === "PRODAT" ? text(params.route.application_reference) :
    text(params.route.application_reference) ??
    text(params.senderSettings.application_reference) ??
    text(params.senderSettings.default_application_reference);
  const aiApplication = isAiList ? validateApplicationReferencePolicy({ messageFamily: "AI_LIST", applicationReference: configuredApplicationReference }) : null;
  if (aiApplication && !aiApplication.ok) throw new Error("ediel_registry_ai_list_application_forbidden");
  const applicationReferenceCheck = isAiList ? null : validateRouteDeclaredApplicationReference({
    messageFamily: params.messageFamily,
    businessCode: params.messageCode,
    routeProfile: configuredApplicationReference
      ? { applicationReference: configuredApplicationReference }
      : null,
  });
  if (applicationReferenceCheck && !applicationReferenceCheck.ok) {
    throw new Error(
      `ediel_application_reference_route_mismatch:${applicationReferenceCheck.routeDeclaredApplicationReference ?? 'missing'}:${applicationReferenceCheck.policyApplicationReference}`,
    );
  }
  const applicationReference = applicationReferenceCheck?.policyApplicationReference ?? null;
  const ackMode = projectCanonicalAckMode({
    messageFamily: params.messageFamily,
    messageCode: params.messageCode,
  });
  const prodatRouteScope = params.messageFamily === "PRODAT"
    ? routeScopeForProcess({ messageFamily: params.messageFamily, messageCode: params.messageCode })
    : null;
  const routeMetadata = metadata(params.route.metadata);
  const metadataPayload = {
    platform_actor_route_id: params.route.id,
    platform_market_actor_id: params.route.actor_id,
    sender_settings_id: params.senderSettings.id,
    receiver_subaddress_status:
      routeMetadata.subaddress_status ??
      (routeAllowsBlankSubaddress(params.route)
        ? "not_required_confirmed"
        : null),
    blank_subaddress_requires_review:
      routeMetadata.blank_subaddress_requires_review ??
      !routeAllowsBlankSubaddress(params.route),
    production_send_lock_status: senderSettingProductionLockStatus(
      params.senderSettings,
      params.route.environment,
    ),
  };
  const existing = await supabaseService
    .from("ediel_route_profiles")
    .select("id,metadata")
    .eq("company_id", params.senderSettings.company_id)
    .eq("communication_route_id", params.communicationRouteId)
    .eq("environment", params.route.environment)
    .limit(10);
  if (existing.error) throw existing.error;
  const match = ((existing.data ?? []) as Array<JsonRecord>).find(
    (row) => metadata(row.metadata).platform_actor_route_id === params.route.id,
  );
  const payload = {
    company_id: params.senderSettings.company_id,
    communication_route_id: params.communicationRouteId,
    environment: params.route.environment,
    route_name: `${params.gridOwner.name ?? "Nätägare"} ${params.messageFamily}${prodatScopeSuffix(params.messageFamily, prodatRouteScope)}`,
    route_type: "email",
    payload_format: isAiList ? "raw" : "edifact",
    message_standard: isAiList ? "ai_list" : "edifact",
    ack_mode: ackMode,
    default_test_flag: params.route.environment === "production" ? 0 : 1,
    default_timezone: 1,
    sender_ediel_id: senderEdielId,
    own_ediel_id: senderEdielId,
    sender_sub_address: senderSubaddress,
    sender_subaddress: senderSubaddress,
    own_subaddress: senderSubaddress,
    receiver_ediel_id: receiverEdielId,
    counterparty_ediel_id: receiverEdielId,
    receiver_sub_address: text(params.route.subaddress),
    receiver_subaddress: text(params.route.subaddress),
    counterparty_subaddress: text(params.route.subaddress),
    receiver_name: params.gridOwner.name,
    application_reference: applicationReference,
    message_family: params.messageFamily,
    message_code: params.messageCode,
    default_message_version: isAiList ? canonicalAiListProfile().technicalVersion : params.messageFamily === "PRODAT" ? "26A" : null,
    mailbox: null,
    encryption_mode: params.messageFamily === "PRODAT" ? "smime" : "none",
    transport_type: "smtp",
    ack_policy: ackMode,
    is_active: true,
    is_enabled: true,
    metadata: metadataPayload,
    updated_at: new Date().toISOString(),
    updated_by: params.actorUserId,
  };
  const query = match?.id
    ? supabaseService
        .from("ediel_route_profiles")
        .update(payload)
        .eq("id", match.id)
    : supabaseService
        .from("ediel_route_profiles")
        .insert({ ...payload, created_by: params.actorUserId });
  const { data, error } = await query.select("id").single();
  if (error) throw Object.assign(error as object, { gridexIsUpdate: Boolean(match?.id) });
  return String((data as { id: string }).id);
}


async function applySafeRouteProfileReadiness(params: {
  routeProfileId: string;
  actorUserId?: string | null;
}) {
  try {
    await evaluateRouteProfileProductionReadiness({
      routeProfileId: params.routeProfileId,
      actorUserId: params.actorUserId ?? null,
      applyFixes: true,
      approveProduction: false,
    });
  } catch (error) {
    console.warn("[routeMaterializer] Route profile production readiness sync skipped", {
      routeProfileId: params.routeProfileId,
      error: pgErrorMessage(error),
    });
  }
}

async function upsertCompanyMarketPartyRoute(params: {
  companyId: string;
  marketPartyId: string;
  messageFamily: string;
  messageCode: string | null;
  environment: string;
  routeProfileId: string;
  actorUserId: string | null;
  platformActorRouteId: string;
  communicationRouteId: string;
  senderSettings: ActorSettingRow;
  route: PlatformActorRouteRow;
}): Promise<string> {
  const payload = {
    company_id: params.companyId,
    market_party_id: params.marketPartyId,
    message_family: params.messageFamily,
    message_code: params.messageCode,
    environment: params.environment,
    platform_actor_route_id: params.platformActorRouteId,
    communication_route_id: params.communicationRouteId,
    route_profile_id: params.routeProfileId,
    active: true,
    metadata: {
      platform_actor_route_id: params.platformActorRouteId,
      materialized_from: "platform_actor_routes",
      environment: params.environment,
      message_code: params.messageCode,
      communication_route_id: params.communicationRouteId,
      ediel_route_profile_id: params.routeProfileId,
      sender_settings_id: params.senderSettings.id,
      receiver_ediel_id:
        text(params.route.party_id) ??
        text(params.route.interchange_party_id),
      receiver_subaddress: text(params.route.subaddress),
      target_email: text(params.route.communication_address),
      production_send_lock_enabled: params.senderSettings.production_send_lock_enabled ?? false,
      first_production_send_approved: params.senderSettings.first_production_send_approved ?? false,
    },
    created_by: params.actorUserId,
    updated_at: new Date().toISOString(),
  };
  const existing = await supabaseService
    .from("company_market_party_routes")
    .select("id,metadata")
    .eq("company_id", params.companyId)
    .eq("market_party_id", params.marketPartyId)
    .eq("message_family", params.messageFamily)
    .eq("active", true)
    .limit(25);
  if (existing.error) throw existing.error;
  const match = ((existing.data ?? []) as Array<JsonRecord>).find((row) => {
    const rowMeta = metadata(row.metadata);
    return rowMeta.platform_actor_route_id === params.platformActorRouteId &&
      rowMeta.environment === params.environment &&
      (rowMeta.message_code ?? null) === (params.messageCode ?? null);
  });
  const query = match?.id
    ? supabaseService
        .from("company_market_party_routes")
        .update(payload)
        .eq("id", match.id)
    : supabaseService.from("company_market_party_routes").insert(payload);
  const { data, error } = await query.select("id").single();
  if (error) throw Object.assign(error as object, { gridexIsUpdate: Boolean(match?.id) });
  return String((data as { id: string }).id);
}


async function getGridOwnerForCompanyMaterialization(gridOwnerId: string): Promise<GridOwnerMaterializationRow | null> {
  const { data, error } = await supabaseService
    .from("grid_owners")
    .select("id,company_id,name,ediel_id,platform_market_actor_id")
    .eq("id", gridOwnerId)
    .maybeSingle();
  if (error) throw error;
  return (data as GridOwnerMaterializationRow | null) ?? null;
}

export async function materializeCompanyGridOwnerRoute(params: {
  companyId: string;
  gridOwnerId: string;
  platformActorRouteId: string;
  messageFamily?: string | null;
  messageCode?: string | null;
  environment?: "test" | "production" | string | null;
  actorUserId?: string | null;
}): Promise<RouteMaterializationResult> {
  const route = await getPlatformActorRoute(params.platformActorRouteId);
  const messageFamily = materializedFamily(params.messageFamily ?? route?.message_family ?? "PRODAT");
  const messageCode = text(params.messageCode) ?? (route ? text(metadata(route.metadata).message_code) : null) ?? defaultMessageCode(messageFamily);
  const environment = (params.environment === "test" || params.environment === "production")
    ? params.environment
    : route?.environment;

  if (!route) {
    return {
      platformActorRouteId: params.platformActorRouteId,
      companyId: params.companyId,
      gridOwnerId: params.gridOwnerId,
      status: "blocked",
      reasonCode: "platform_route_missing",
      nextRequiredAction: "Verifierad global route saknas för nätägaren.",
      communicationRouteId: null,
      edielRouteProfileId: null,
      companyMarketPartyRouteId: null,
    };
  }

  // An unverified registry route is held before its current source is required.
  if (route.status !== "active" || route.is_verified !== true || route.auto_send_allowed === false) {
    return {
      platformActorRouteId: route.id,
      companyId: params.companyId,
      gridOwnerId: params.gridOwnerId,
      status: "blocked",
      reasonCode: "platform_route_not_verified",
      nextRequiredAction: "Verifiera aktörsregistrets route innan operativ materialisering.",
      communicationRouteId: null,
      edielRouteProfileId: null,
      companyMarketPartyRouteId: null,
    };
  }

  const source = await requireElRegistryRouteSource(route.id);
  if (source.actorId !== route.actor_id || source.wire.family !== (messageFamily === "AI_LIST" ? "AI" : messageFamily) || source.wire.environment !== route.environment
    || messageFamily === "AI_LIST" && source.wire.applicationReference !== null) throw new Error("ediel_registry_materialization_scope_mismatch");
  if (messageFamily === "AI_LIST" && messageCode !== canonicalAiListProfile().supplierOutboundType) throw new Error("ediel_registry_ai_list_message_code_required");
  if (messageFamily === "PRODAT" && !registryRouteMessageCodes(route, messageFamily).includes(messageCode)) {
    return {
      platformActorRouteId: route.id,
      companyId: params.companyId,
      gridOwnerId: params.gridOwnerId,
      status: "blocked",
      reasonCode: "platform_route_message_code_not_materializable",
      nextRequiredAction: "Välj ett meddelande som leverantören skickar till nätägaren på denna route.",
      communicationRouteId: null,
      edielRouteProfileId: null,
      companyMarketPartyRouteId: null,
      messageFamily,
      messageCode,
      environment: route.environment,
    };
  }

  const gridOwner = await getGridOwnerForCompanyMaterialization(params.gridOwnerId);
  if (!gridOwner) {
    return {
      platformActorRouteId: route.id,
      companyId: params.companyId,
      gridOwnerId: params.gridOwnerId,
      status: "blocked",
      reasonCode: "grid_owner_missing",
      nextRequiredAction: "Nätägaren saknas i masterdata.",
      communicationRouteId: null,
      edielRouteProfileId: null,
      companyMarketPartyRouteId: null,
    };
  }

  if (gridOwner.platform_market_actor_id !== route.actor_id) {
    return {
      platformActorRouteId: route.id,
      companyId: params.companyId,
      gridOwnerId: gridOwner.id,
      status: "blocked",
      reasonCode: "grid_owner_actor_mismatch",
      nextRequiredAction: "Koppla nätägaren till samma verifierade marknadsaktör som routen innan materialisering.",
      communicationRouteId: null,
      edielRouteProfileId: null,
      companyMarketPartyRouteId: null,
    };
  }

  if (environment && route.environment !== environment) {
    return {
      platformActorRouteId: route.id,
      companyId: params.companyId,
      gridOwnerId: gridOwner.id,
      status: "blocked",
      reasonCode: "platform_route_environment_mismatch",
      nextRequiredAction: "Välj en global route i samma miljö som kundflödet.",
      communicationRouteId: null,
      edielRouteProfileId: null,
      companyMarketPartyRouteId: null,
    };
  }

  const sender = await resolveSenderSettings({
    companyId: params.companyId,
    environment: route.environment,
    actorRole: "supplier",
    marketRole: "electricity_supplier",
    messageFamily,
    messageCode,
    applicationReference: text(route.application_reference),
  });

  if (sender.status !== "resolved") {
    const blocker = makeCustomerOperationBlocker(sender.blockerCode, {
      blocker_reason:
        sender.status === "ambiguous"
          ? "Flera aktiva avsändarinställningar matchar route-materialisering."
          : sender.status === "environment_mismatch"
            ? "Avsändarinställningar finns, men inte för route-materialiseringens miljö."
            : "Avsändarinställning saknas för route-materialisering.",
    });
    return {
      platformActorRouteId: route.id,
      companyId: params.companyId,
      gridOwnerId: gridOwner.id,
      status: "blocked",
      reasonCode: String(blocker.blocker_code ?? blocker.reason_code ?? sender.blockerCode),
      nextRequiredAction: blocker.next_required_action,
      communicationRouteId: null,
      edielRouteProfileId: null,
      companyMarketPartyRouteId: null,
    };
  }

  const failure = (reasonCode: string, nextRequiredAction: string, error: unknown): RouteMaterializationResult => ({
    platformActorRouteId: route.id,
    companyId: params.companyId,
    gridOwnerId: gridOwner.id,
    status: "blocked",
    reasonCode,
    nextRequiredAction,
    communicationRouteId: null,
    edielRouteProfileId: null,
    companyMarketPartyRouteId: null,
    technicalMessage: pgErrorMessage(error),
    messageFamily,
    messageCode,
    environment: route.environment,
  });

  let communicationRouteId: string;
  try {
    communicationRouteId = await upsertCommunicationRoute({
      actorUserId: params.actorUserId ?? null,
      companyId: params.companyId,
      route,
      gridOwner,
      messageFamily,
      messageCode,
    });
  } catch (error) {
    return failure(
      stepFailureReason(error, "communication_route_insert_failed", "communication_route_update_failed", Boolean((error as { gridexIsUpdate?: boolean }).gridexIsUpdate)),
      "Communication route kunde inte sparas. Kontrollera schema och dubbletter.",
      error,
    );
  }

  let edielRouteProfileId: string;
  try {
    edielRouteProfileId = await upsertRouteProfile({
      actorUserId: params.actorUserId ?? null,
      route,
      communicationRouteId,
      gridOwner,
      senderSettings: sender.setting,
      messageFamily,
      messageCode,
    });
  } catch (error) {
    return failure(
      stepFailureReason(error, "ediel_route_profile_insert_failed", "ediel_route_profile_update_failed", Boolean((error as { gridexIsUpdate?: boolean }).gridexIsUpdate)),
      "Ediel route profile kunde inte sparas. Kontrollera schema och dubbletter.",
      error,
    );
  }

  await applySafeRouteProfileReadiness({
    routeProfileId: edielRouteProfileId,
    actorUserId: params.actorUserId ?? null,
  });

  let companyMarketPartyRouteId: string;
  try {
    companyMarketPartyRouteId = await upsertCompanyMarketPartyRoute({
      companyId: params.companyId,
      marketPartyId: route.actor_id,
      messageFamily,
      messageCode,
      environment: route.environment,
      routeProfileId: edielRouteProfileId,
      actorUserId: params.actorUserId ?? null,
      platformActorRouteId: route.id,
      communicationRouteId,
      senderSettings: sender.setting,
      route,
    });
  } catch (error) {
    return failure(
      stepFailureReason(error, "company_market_party_route_insert_failed", "company_market_party_route_update_failed", Boolean((error as { gridexIsUpdate?: boolean }).gridexIsUpdate)),
      "Company market party route kunde inte sparas. Kontrollera schema och dubbletter.",
      error,
    );
  }

  // Postcheck: reload the readiness view and confirm the operational route is
  // actually ready for the exact tenant/environment/message scope before we
  // report success. This prevents false "materialized" results.
  let postcheckMessage: string | null = null;
  try {
    const readiness = await getCompanyGridOwnerRouteReadiness({
      companyId: params.companyId,
      gridOwnerId: gridOwner.id,
      messageFamily,
      messageCode,
      environment: route.environment,
    });
    const ok = Boolean(
      readiness &&
        readiness.operational_route_ready === true &&
        readiness.communication_route_id &&
        readiness.ediel_route_profile_id &&
        readiness.company_market_party_route_id &&
        String(readiness.platform_actor_route_id ?? route.id) === route.id &&
        String(readiness.environment ?? route.environment) === route.environment,
    );
    if (!ok) {
      return {
        platformActorRouteId: route.id,
        companyId: params.companyId,
        gridOwnerId: gridOwner.id,
        status: "blocked",
        reasonCode: "route_materialization_postcheck_failed",
        nextRequiredAction:
          "Operativa rader skrevs men readiness-vyn bekräftar inte operativ route. Kontrollera route-profil och constraints.",
        communicationRouteId,
        edielRouteProfileId,
        companyMarketPartyRouteId,
        technicalMessage: readiness ? "readiness_view_operational_route_not_ready" : "readiness_view_row_missing",
        messageFamily,
        messageCode,
        environment: route.environment,
      };
    }
  } catch (error) {
    // A postcheck read failure must not look like a successful materialization.
    postcheckMessage = pgErrorMessage(error);
    return {
      platformActorRouteId: route.id,
      companyId: params.companyId,
      gridOwnerId: gridOwner.id,
      status: "blocked",
      reasonCode: "route_materialization_postcheck_failed",
      nextRequiredAction: "Kunde inte läsa readiness-vyn efter materialisering. Försök igen.",
      communicationRouteId,
      edielRouteProfileId,
      companyMarketPartyRouteId,
      technicalMessage: postcheckMessage,
      messageFamily,
      messageCode,
      environment: route.environment,
    };
  }

  const technicalAck = await materializeTechnicalAckRoutes({
    actorUserId: params.actorUserId ?? null,
    companyId: params.companyId,
    route,
    gridOwner,
    senderSettings: sender.setting,
    messageFamily,
  });

  return {
    platformActorRouteId: route.id,
    companyId: params.companyId,
    gridOwnerId: gridOwner.id,
    status: "materialized",
    reasonCode: null,
    nextRequiredAction: null,
    communicationRouteId,
    edielRouteProfileId,
    companyMarketPartyRouteId,
    technicalMessage: null,
    messageFamily,
    messageCode,
    environment: route.environment,
    technicalAck,
  };
}

export async function materializePlatformActorRoute(params: {
  platformActorRouteId: string;
  actorUserId?: string | null;
}): Promise<RouteMaterializationResult[]> {
  const route = await getPlatformActorRoute(params.platformActorRouteId);
  if (!route) return [];
  const source = await requireElRegistryRouteSource(route.id);
  const messageFamily = materializedFamily(route.message_family);
  const messageCodes = registryRouteMessageCodes(route, messageFamily);
  if (source.actorId !== route.actor_id || source.wire.family !== (messageFamily === "AI_LIST" ? "AI" : messageFamily) || source.wire.environment !== route.environment
    || messageFamily === "AI_LIST" && source.wire.applicationReference !== null) throw new Error("ediel_registry_materialization_scope_mismatch");
  if (messageFamily === "AI_LIST" && messageCodes.some((messageCode) => messageCode !== canonicalAiListProfile().supplierOutboundType)) throw new Error("ediel_registry_ai_list_message_code_required");
  if (
    route.status !== "active" ||
    route.is_verified !== true ||
    route.auto_send_allowed === false
  ) {
    return [
      {
        platformActorRouteId: params.platformActorRouteId,
        companyId: null,
        gridOwnerId: null,
        status: "skipped",
        reasonCode: "platform_route_not_verified",
        nextRequiredAction:
          "Verifiera aktörsregistrets route innan operativ materialisering.",
        communicationRouteId: null,
        edielRouteProfileId: null,
        companyMarketPartyRouteId: null,
      },
    ];
  }

  const gridOwners = await getMappedGridOwners(route.actor_id);
  const results: RouteMaterializationResult[] = [];
  const technicalAckByTenant = new Map<string, TechnicalAckMaterializationResult>();
  for (const gridOwner of gridOwners) {
    const companies = await candidateCompanyIds({
      gridOwnerCompanyId: gridOwner.company_id,
      environment: route.environment,
      messageFamily,
    });
    if (companies.length === 0) {
      results.push({
        platformActorRouteId: route.id,
        companyId: null,
        gridOwnerId: gridOwner.id,
        status: "blocked",
        reasonCode: "sender_settings_missing",
        nextRequiredAction:
          "Lägg in aktiv Ediel-aktör för bolaget och miljön innan route materialiseras.",
        communicationRouteId: null,
        edielRouteProfileId: null,
        companyMarketPartyRouteId: null,
      });
      continue;
    }

    for (const companyId of companies) for (const messageCode of messageCodes) {
      const sender = await resolveSenderSettings({
        companyId,
        environment: route.environment,
        actorRole: "supplier",
        marketRole: "electricity_supplier",
        messageFamily,
        messageCode,
        applicationReference: text(route.application_reference),
      });
      if (sender.status !== "resolved") {
        const blocker = makeCustomerOperationBlocker(sender.blockerCode, {
          blocker_reason:
            sender.status === "ambiguous"
              ? "Flera aktiva avsändarinställningar matchar route-materialisering."
              : sender.status === "environment_mismatch"
                ? "Avsändarinställningar finns, men inte för route-materialiseringens miljö."
                : "Avsändarinställning saknas för route-materialisering.",
        });
        results.push({
          platformActorRouteId: route.id,
          companyId,
          gridOwnerId: gridOwner.id,
          status: "blocked",
          reasonCode: String(blocker.reason_code),
          nextRequiredAction: blocker.next_required_action,
          communicationRouteId: null,
          edielRouteProfileId: null,
          companyMarketPartyRouteId: null,
          messageFamily,
          messageCode,
          environment: route.environment,
        });
        continue;
      }
      const communicationRouteId = await upsertCommunicationRoute({
        actorUserId: params.actorUserId ?? null,
        companyId,
        route,
        gridOwner,
        messageFamily,
        messageCode,
      });
      const edielRouteProfileId = await upsertRouteProfile({
        actorUserId: params.actorUserId ?? null,
        route,
        communicationRouteId,
        gridOwner,
        senderSettings: sender.setting,
        messageFamily,
        messageCode,
      });
      await applySafeRouteProfileReadiness({
        routeProfileId: edielRouteProfileId,
        actorUserId: params.actorUserId ?? null,
      });

      const companyMarketPartyRouteId = await upsertCompanyMarketPartyRoute({
        companyId,
        marketPartyId: route.actor_id,
        messageFamily,
        messageCode,
        environment: route.environment,
        routeProfileId: edielRouteProfileId,
        actorUserId: params.actorUserId ?? null,
        platformActorRouteId: route.id,
        communicationRouteId,
        senderSettings: sender.setting,
        route,
      });
      // One registry route serves several PRODAT scopes; its reply routes are ensured once per tenant and grid owner.
      const ackKey = `${companyId}|${gridOwner.id}`;
      const technicalAck = technicalAckByTenant.get(ackKey) ?? await materializeTechnicalAckRoutes({
        actorUserId: params.actorUserId ?? null,
        companyId,
        route,
        gridOwner,
        senderSettings: sender.setting,
        messageFamily,
      });
      technicalAckByTenant.set(ackKey, technicalAck);
      results.push({
        platformActorRouteId: route.id,
        companyId,
        gridOwnerId: gridOwner.id,
        status: "materialized",
        reasonCode: null,
        nextRequiredAction: null,
        communicationRouteId,
        edielRouteProfileId,
        companyMarketPartyRouteId,
        messageFamily,
        messageCode,
        environment: route.environment,
        technicalAck,
      });
    }
  }
  return results;
}
