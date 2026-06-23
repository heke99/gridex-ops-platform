//lib/ediel/routeMaterializer.ts
import { supabaseService } from "@/lib/supabase/service";
import { evaluateRouteProfileProductionReadiness } from "@/lib/ediel/routeProfileProductionReadiness";
import { makeCustomerOperationBlocker } from "@/lib/customer-operations/blockers";
import { getCompanyGridOwnerRouteReadiness } from "@/lib/ediel/companyRouteReadiness";
import {
  resolveSenderSettings,
  senderSettingProductionLockStatus,
  type SenderSettingRow,
} from "@/lib/ediel/senderSettingsResolver";
import {
  ackModeForProcess,
  applicationReferenceForProcess,
  routeScopeForProcess,
  targetSystemForEnvironment,
} from "@/lib/ediel/routeMatrix";

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
  return null;
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
  const routeName = `${params.gridOwner.name ?? "Nätägare"} ${params.messageFamily} ${params.route.environment}`;
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

async function upsertRouteProfile(params: {
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
  const senderSubaddress =
    params.messageFamily === "PRODAT"
      ? (text(params.senderSettings.sender_subaddress_prodat) ??
        text(params.senderSettings.sender_subaddress) ??
        text(params.senderSettings.sender_sub_address))
      : (text(params.senderSettings.sender_subaddress_utilts) ??
        text(params.senderSettings.sender_subaddress) ??
        text(params.senderSettings.sender_sub_address));
  const receiverEdielId =
    text(params.route.party_id) ??
    text(params.route.interchange_party_id) ??
    text(params.gridOwner.ediel_id);
  const routeScope = routeScopeForProcess({ messageFamily: params.messageFamily, messageCode: params.messageCode }) ?? "customer_masterdata";
  const applicationReference =
    text(params.route.application_reference) ??
    text(params.senderSettings.application_reference) ??
    text(params.senderSettings.default_application_reference) ??
    applicationReferenceForProcess({ routeScope, messageFamily: params.messageFamily, messageCode: params.messageCode });
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
    route_name: `${params.gridOwner.name ?? "Nätägare"} ${params.messageFamily}`,
    route_type: "email",
    payload_format: "edifact",
    message_standard: "edifact",
    ack_mode: ackModeForProcess({ messageFamily: params.messageFamily, messageCode: params.messageCode }),
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
    default_message_version: params.messageFamily === "PRODAT" ? "26A" : null,
    mailbox: null,
    encryption_mode: params.messageFamily === "PRODAT" ? "smime" : "none",
    transport_type: "smtp",
    ack_policy: ackModeForProcess({ messageFamily: params.messageFamily, messageCode: params.messageCode }),
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
  const messageFamily = upper(params.messageFamily ?? route?.message_family ?? "PRODAT");
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

  if (route.status !== "active" || route.is_verified !== true || route.auto_send_allowed === false) {
    return {
      platformActorRouteId: route.id,
      companyId: params.companyId,
      gridOwnerId: gridOwner.id,
      status: "blocked",
      reasonCode: "platform_route_not_verified",
      nextRequiredAction: "Verifiera aktörsregistrets route innan operativ materialisering.",
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
  };
}

export async function materializePlatformActorRoute(params: {
  platformActorRouteId: string;
  actorUserId?: string | null;
}): Promise<RouteMaterializationResult[]> {
  const route = await getPlatformActorRoute(params.platformActorRouteId);
  if (!route) return [];
  const messageFamily = upper(route.message_family);
  const messageCode =
    text(metadata(route.metadata).message_code) ??
    defaultMessageCode(messageFamily);
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

    for (const companyId of companies) {
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
      });
    }
  }
  return results;
}
