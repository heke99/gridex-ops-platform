import { supabaseService } from "@/lib/supabase/service";
import { makeCustomerOperationBlocker } from "@/lib/customer-operations/blockers";

type JsonRecord = Record<string, unknown>;

type PlatformActorRouteRow = {
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
  status: string;
  metadata: JsonRecord | null;
};

type GridOwnerMaterializationRow = {
  id: string;
  company_id: string | null;
  name: string | null;
  ediel_id: string | null;
  platform_market_actor_id: string | null;
};

type ActorSettingRow = {
  id: string;
  company_id: string;
  environment: string;
  ediel_id: string | null;
  actor_ediel_id: string | null;
  sender_subaddress: string | null;
  sender_subaddress_prodat?: string | null;
  sender_subaddress_utilts?: string | null;
  sender_sub_address: string | null;
  is_active: boolean | null;
  production_send_lock_enabled?: boolean | null;
  first_production_send_approved?: boolean | null;
};

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
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function upper(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function routeScopeForFamily(messageFamily: string): string {
  if (upper(messageFamily) === "PRODAT") return "customer_masterdata";
  if (upper(messageFamily) === "UTILTS") return "meter_values";
  return "customer_masterdata";
}

function defaultMessageCode(messageFamily: string): string | null {
  if (upper(messageFamily) === "PRODAT") return "Z01";
  return null;
}

function defaultApplicationReference(messageFamily: string): string {
  if (upper(messageFamily) === "PRODAT") return "23-DDQ-PRODAT";
  return upper(messageFamily) || "PRODAT";
}

async function getPlatformActorRoute(routeId: string): Promise<PlatformActorRouteRow | null> {
  const { data, error } = await supabaseService
    .from("platform_actor_routes")
    .select("*")
    .eq("id", routeId)
    .maybeSingle();
  if (error) throw error;
  return (data as PlatformActorRouteRow | null) ?? null;
}

async function getMappedGridOwners(actorId: string): Promise<GridOwnerMaterializationRow[]> {
  const { data, error } = await supabaseService
    .from("grid_owners")
    .select("id,company_id,name,ediel_id,platform_market_actor_id")
    .eq("platform_market_actor_id", actorId)
    .eq("is_active", true);
  if (error) throw error;
  return (data ?? []) as GridOwnerMaterializationRow[];
}

async function resolveSenderSettings(params: {
  companyId: string;
  environment: string;
  messageFamily: string;
}): Promise<{ setting: ActorSettingRow | null; ambiguous: boolean }> {
  const { data, error } = await supabaseService
    .from("ediel_actor_settings")
    .select("*")
    .eq("company_id", params.companyId)
    .eq("environment", params.environment)
    .eq("is_active", true)
    .limit(10);
  if (error) throw error;
  const rows = (data ?? []) as ActorSettingRow[];
  return {
    setting: rows.length === 1 ? rows[0] ?? null : null,
    ambiguous: rows.length > 1,
  };
}

async function upsertCommunicationRoute(params: {
  actorUserId: string | null;
  route: PlatformActorRouteRow;
  gridOwner: GridOwnerMaterializationRow;
  messageFamily: string;
  messageCode: string | null;
}): Promise<string> {
  const routeScope = routeScopeForFamily(params.messageFamily);
  const routeName = `${params.gridOwner.name ?? "Nätägare"} ${params.messageFamily} ${params.route.environment}`;
  const authConfig = {
    platform_actor_route_id: params.route.id,
    platform_market_actor_id: params.route.actor_id,
    materialized_from: "platform_actor_routes",
    message_family: params.messageFamily,
    message_code: params.messageCode,
    environment: params.route.environment,
  };
  const existing = await supabaseService
    .from("communication_routes")
    .select("*")
    .eq("company_id", params.gridOwner.company_id)
    .eq("grid_owner_id", params.gridOwner.id)
    .eq("route_scope", routeScope)
    .limit(20);
  if (existing.error) throw existing.error;
  const match = ((existing.data ?? []) as Array<JsonRecord>).find((row) => {
    const config = row.auth_config && typeof row.auth_config === "object" ? row.auth_config as JsonRecord : {};
    return config.platform_actor_route_id === params.route.id;
  });
  const payload = {
    company_id: params.gridOwner.company_id,
    route_name: routeName,
    is_active: true,
    route_scope: routeScope,
    route_type: "ediel_partner",
    grid_owner_id: params.gridOwner.id,
    target_system: params.route.communication_type ?? "smtp",
    endpoint: params.route.communication_address,
    target_email: params.route.communication_address,
    auth_config: authConfig,
    supported_payload_version: params.messageFamily,
    notes: "Materialiserad från verifierad aktörsregister-route.",
    updated_by: params.actorUserId,
    updated_at: new Date().toISOString(),
  };
  const query = match?.id
    ? supabaseService.from("communication_routes").update(payload).eq("id", match.id)
    : supabaseService.from("communication_routes").insert({ ...payload, created_by: params.actorUserId });
  const { data, error } = await query.select("id").single();
  if (error) throw error;
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
  const senderEdielId = text(params.senderSettings.ediel_id) ?? text(params.senderSettings.actor_ediel_id);
  const senderSubaddress =
    params.messageFamily === "PRODAT"
      ? text(params.senderSettings.sender_subaddress_prodat) ?? text(params.senderSettings.sender_subaddress) ?? text(params.senderSettings.sender_sub_address)
      : text(params.senderSettings.sender_subaddress_utilts) ?? text(params.senderSettings.sender_subaddress) ?? text(params.senderSettings.sender_sub_address);
  const receiverEdielId =
    text(params.route.party_id) ??
    text(params.route.interchange_party_id) ??
    text(params.gridOwner.ediel_id);
  const metadata = {
    platform_actor_route_id: params.route.id,
    platform_market_actor_id: params.route.actor_id,
    sender_settings_id: params.senderSettings.id,
    receiver_subaddress_required: Boolean(text(params.route.subaddress)),
    production_send_lock_status:
      params.route.environment === "production" &&
      params.senderSettings.production_send_lock_enabled === true &&
      params.senderSettings.first_production_send_approved !== true
        ? "locked"
        : "approved",
  };
  const existing = await supabaseService
    .from("ediel_route_profiles")
    .select("*")
    .eq("company_id", params.gridOwner.company_id)
    .eq("communication_route_id", params.communicationRouteId)
    .eq("environment", params.route.environment)
    .limit(10);
  if (existing.error) throw existing.error;
  const match = ((existing.data ?? []) as Array<JsonRecord>).find((row) => {
    const rowMetadata = row.metadata && typeof row.metadata === "object" ? row.metadata as JsonRecord : {};
    return rowMetadata.platform_actor_route_id === params.route.id;
  });
  const applicationReference = text(params.route.application_reference) ?? defaultApplicationReference(params.messageFamily);
  const payload = {
    company_id: params.gridOwner.company_id,
    communication_route_id: params.communicationRouteId,
    environment: params.route.environment,
    route_name: `${params.gridOwner.name ?? "Nätägare"} ${params.messageFamily}`,
    route_type: "email",
    sender_ediel_id: senderEdielId,
    sender_sub_address: senderSubaddress,
    sender_subaddress: senderSubaddress,
    receiver_ediel_id: receiverEdielId,
    receiver_sub_address: text(params.route.subaddress),
    receiver_subaddress: text(params.route.subaddress),
    receiver_email: params.route.communication_address,
    application_reference: applicationReference,
    message_family: params.messageFamily,
    message_code: params.messageCode,
    receiver_source: "fixed_counterparty",
    dynamic_receiver_strategy: "materialized_platform_actor_route",
    transport_mode: "shared_platform_mailbox",
    is_active: true,
    is_enabled: true,
    is_test_route: params.route.environment === "test",
    is_production_route: params.route.environment === "production",
    allow_unencrypted_production: false,
    certificate_required: params.messageFamily === "PRODAT",
    metadata,
    updated_at: new Date().toISOString(),
  };
  const query = match?.id
    ? supabaseService.from("ediel_route_profiles").update(payload).eq("id", match.id)
    : supabaseService.from("ediel_route_profiles").insert(payload);
  const { data, error } = await query.select("id").single();
  if (error) throw error;
  return String((data as { id: string }).id);
}

async function upsertCompanyMarketPartyRoute(params: {
  companyId: string;
  marketPartyId: string;
  messageFamily: string;
  routeProfileId: string;
  actorUserId: string | null;
  platformActorRouteId: string;
}): Promise<string> {
  const payload = {
    company_id: params.companyId,
    market_party_id: params.marketPartyId,
    message_family: params.messageFamily,
    route_profile_id: params.routeProfileId,
    active: true,
    metadata: {
      platform_actor_route_id: params.platformActorRouteId,
      materialized_from: "platform_actor_routes",
    },
    created_by: params.actorUserId,
    updated_at: new Date().toISOString(),
  };
  const existing = await supabaseService
    .from("company_market_party_routes")
    .select("id")
    .eq("company_id", params.companyId)
    .eq("market_party_id", params.marketPartyId)
    .eq("message_family", params.messageFamily)
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  if (existing.error) throw existing.error;
  const query = existing.data?.id
    ? supabaseService.from("company_market_party_routes").update(payload).eq("id", existing.data.id)
    : supabaseService.from("company_market_party_routes").insert(payload);
  const { data, error } = await query
    .select("id")
    .single();
  if (error) throw error;
  return String((data as { id: string }).id);
}

export async function materializePlatformActorRoute(params: {
  platformActorRouteId: string;
  actorUserId?: string | null;
}): Promise<RouteMaterializationResult[]> {
  const route = await getPlatformActorRoute(params.platformActorRouteId);
  if (!route) return [];
  const messageFamily = upper(route.message_family);
  const messageCode = text((route.metadata ?? {}).message_code) ?? defaultMessageCode(messageFamily);
  if (route.status !== "active" || route.is_verified !== true) {
    return [{
      platformActorRouteId: params.platformActorRouteId,
      companyId: null,
      gridOwnerId: null,
      status: "skipped",
      reasonCode: "platform_route_not_verified",
      nextRequiredAction: "Verifiera aktörsregistrets route innan operativ materialisering.",
      communicationRouteId: null,
      edielRouteProfileId: null,
      companyMarketPartyRouteId: null,
    }];
  }

  const gridOwners = await getMappedGridOwners(route.actor_id);
  const results: RouteMaterializationResult[] = [];
  for (const gridOwner of gridOwners) {
    if (!gridOwner.company_id) {
      results.push({
        platformActorRouteId: route.id,
        companyId: null,
        gridOwnerId: gridOwner.id,
        status: "skipped",
        reasonCode: "grid_owner_without_company",
        nextRequiredAction: "Koppla OPS-nätägaren till ett bolag innan operativ route skapas.",
        communicationRouteId: null,
        edielRouteProfileId: null,
        companyMarketPartyRouteId: null,
      });
      continue;
    }
    const sender = await resolveSenderSettings({
      companyId: gridOwner.company_id,
      environment: route.environment,
      messageFamily,
    });
    if (sender.ambiguous || !sender.setting) {
      const blocker = makeCustomerOperationBlocker(sender.ambiguous ? "ambiguous_sender_settings" : "operational_route_missing");
      results.push({
        platformActorRouteId: route.id,
        companyId: gridOwner.company_id,
        gridOwnerId: gridOwner.id,
        status: "blocked",
        reasonCode: blocker.reason_code,
        nextRequiredAction: blocker.next_required_action,
        communicationRouteId: null,
        edielRouteProfileId: null,
        companyMarketPartyRouteId: null,
      });
      continue;
    }
    const communicationRouteId = await upsertCommunicationRoute({
      actorUserId: params.actorUserId ?? null,
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
    const companyMarketPartyRouteId = await upsertCompanyMarketPartyRoute({
      companyId: gridOwner.company_id,
      marketPartyId: route.actor_id,
      messageFamily,
      routeProfileId: edielRouteProfileId,
      actorUserId: params.actorUserId ?? null,
      platformActorRouteId: route.id,
    });
    results.push({
      platformActorRouteId: route.id,
      companyId: gridOwner.company_id,
      gridOwnerId: gridOwner.id,
      status: "materialized",
      reasonCode: null,
      nextRequiredAction: null,
      communicationRouteId,
      edielRouteProfileId,
      companyMarketPartyRouteId,
    });
  }
  return results;
}
