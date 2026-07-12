import { makeCustomerOperationBlocker, type CustomerOperationBlocker } from "@/lib/customer-operations/blockers";
import { supabaseService } from "@/lib/supabase/service";

export type CustomerInfoEnvironment = "test" | "production";

type JsonRecord = Record<string, unknown>;

type ActorSettingRow = {
  id: string;
  company_id: string | null;
  environment: string | null;
  actor_role?: string | null;
  role?: string | null;
  market_roles?: unknown;
  is_active?: boolean | null;
  production_send_lock_enabled?: boolean | null;
  first_production_send_approved?: boolean | null;
};

type RouteProfileRow = {
  id: string;
  company_id: string | null;
  environment: string | null;
  message_family?: string | null;
  message_code?: string | null;
  is_enabled?: boolean | null;
  is_active?: boolean | null;
  is_production_route?: boolean | null;
  receiver_source?: string | null;
  dynamic_receiver_strategy?: string | null;
  actor_setting_id?: string | null;
  production_mode?: string | null;
  metadata?: JsonRecord | null;
};

export type CustomerInfoEnvironmentResolution =
  | {
      status: "resolved";
      environment: CustomerInfoEnvironment;
      actorSettingId: string | null;
      routeProfileId: string | null;
      productionSendLockStatus: "locked" | "approved" | "not_applicable";
      evidence: JsonRecord;
      blocker: null;
    }
  | {
      status: "blocked";
      environment: null;
      actorSettingId: string | null;
      routeProfileId: string | null;
      productionSendLockStatus: "locked" | "approved" | "not_applicable";
      evidence: JsonRecord;
      blocker: CustomerOperationBlocker & JsonRecord;
    };

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function lower(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function upper(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function metadata(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function roleMatchesSupplier(row: ActorSettingRow): boolean {
  const roles = new Set<string>();
  const add = (value: unknown) => {
    const role = lower(value);
    if (role) roles.add(role);
  };
  add(row.role);
  add(row.actor_role);
  if (Array.isArray(row.market_roles)) row.market_roles.forEach(add);
  return roles.size === 0 || roles.has("supplier") || roles.has("electricity_supplier");
}

function routeMatchesCustomerGridOwner(row: RouteProfileRow): boolean {
  const source = lower(row.receiver_source);
  const strategy = lower(row.dynamic_receiver_strategy);
  const meta = metadata(row.metadata);
  const metaOwner = lower(meta.receiverResolutionOwner ?? meta.receiver_resolution_owner);
  return (
    row.is_production_route === true ||
    source === "selected_metering_point_grid_owner" ||
    strategy.includes("selected_metering_point_grid_owner") ||
    metaOwner === "system"
  );
}

function productionLockStatus(
  setting: ActorSettingRow | null,
  environment: string | null,
): "locked" | "approved" | "not_applicable" {
  if (lower(environment) !== "production" || !setting) return "not_applicable";
  return setting.production_send_lock_enabled === true && setting.first_production_send_approved !== true
    ? "locked"
    : "approved";
}

async function activeSupplierSettings(companyId: string): Promise<ActorSettingRow[]> {
  const { data, error } = await supabaseService
    .from("ediel_actor_settings")
    .select("id,company_id,environment,actor_role,role,market_roles,is_active,production_send_lock_enabled,first_production_send_approved")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .limit(50);
  if (error) throw error;
  return ((data ?? []) as ActorSettingRow[]).filter((row) => row.company_id && roleMatchesSupplier(row));
}

async function customerGridOwnerRouteProfiles(params: {
  companyId: string;
  messageFamily: string;
  messageCode?: string | null;
}): Promise<RouteProfileRow[]> {
  const { data, error } = await supabaseService
    .from("ediel_route_profiles")
    .select("id,company_id,environment,message_family,message_code,is_enabled,is_active,is_production_route,receiver_source,dynamic_receiver_strategy,actor_setting_id,production_mode,metadata")
    .eq("company_id", params.companyId)
    .eq("is_enabled", true)
    .limit(100);
  if (error) throw error;
  const family = upper(params.messageFamily);
  const code = clean(params.messageCode);
  return ((data ?? []) as RouteProfileRow[]).filter((row) => {
    const rowFamily = upper(row.message_family);
    const rowCode = clean(row.message_code);
    const familyOk = !rowFamily || rowFamily === family;
    const codeOk = !code || !rowCode || rowCode === code;
    return familyOk && codeOk && routeMatchesCustomerGridOwner(row);
  });
}

function blocker(
  code: string,
  overrides: Partial<CustomerOperationBlocker> & JsonRecord = {},
): CustomerOperationBlocker & JsonRecord {
  return { ...makeCustomerOperationBlocker(code, overrides), ...overrides };
}

export async function resolveCustomerInfoOperationEnvironment(params: {
  companyId: string;
  explicitEnvironment?: string | null;
  messageFamily?: string | null;
  messageCode?: string | null;
}): Promise<CustomerInfoEnvironmentResolution> {
  const explicit = lower(params.explicitEnvironment);
  if (explicit && explicit !== "test" && explicit !== "production") {
    const details = blocker("environment_mismatch", {
      blocker_reason: "Angiven Ediel-miljö är inte giltig för uppgiftsbegäran.",
      next_required_action: "Välj test eller produktion innan EDIFACT förbereds.",
      route_resolution_status: "environment_invalid",
    });
    return { status: "blocked", environment: null, actorSettingId: null, routeProfileId: null, productionSendLockStatus: "not_applicable", evidence: { explicitEnvironment: params.explicitEnvironment }, blocker: details };
  }

  const messageFamily = upper(params.messageFamily ?? "PRODAT") || "PRODAT";
  const messageCode = clean(params.messageCode ?? "Z01");
  const [settings, profiles] = await Promise.all([
    activeSupplierSettings(params.companyId),
    customerGridOwnerRouteProfiles({ companyId: params.companyId, messageFamily, messageCode }),
  ]);

  const environments = ["production", "test"] as const;
  const candidates = environments.map((environment) => {
    const envSettings = settings.filter((row) => lower(row.environment) === environment);
    const envProfiles = profiles.filter((row) => lower(row.environment) === environment);
    const linkedPairs = envProfiles.flatMap((profile) => {
      if (profile.actor_setting_id) {
        const setting = envSettings.find((candidate) => candidate.id === profile.actor_setting_id);
        return setting ? [{ profile, setting }] : [];
      }
      return envSettings.length === 1 ? [{ profile, setting: envSettings[0] }] : [];
    });
    const uniquePairs = linkedPairs.filter((pair, index, all) =>
      all.findIndex((candidate) => candidate.profile.id === pair.profile.id && candidate.setting.id === pair.setting.id) === index,
    );
    return {
      environment,
      settings: envSettings,
      profiles: envProfiles,
      setting: uniquePairs.length === 1 ? uniquePairs[0].setting : null,
      profile: uniquePairs.length === 1 ? uniquePairs[0].profile : null,
      ambiguous: uniquePairs.length > 1,
    };
  }).filter((candidate) => candidate.settings.length > 0 && candidate.profiles.length > 0 && !candidate.ambiguous && candidate.setting && candidate.profile);

  const narrowed = explicit
    ? candidates.filter((candidate) => candidate.environment === explicit)
    : candidates;

  if (explicit && narrowed.length === 0) {
    const hasAnySetting = settings.some((setting) => lower(setting.environment) === explicit);
    const details = blocker(hasAnySetting ? "operational_route_missing" : "sender_settings_missing", {
      blocker_reason: hasAnySetting
        ? "Aktiv avsändarinställning finns men route profile saknas för vald miljö."
        : "Avsändarinställning saknas för vald miljö och kunduppgiftsflöde.",
      next_required_action: hasAnySetting
        ? "Skapa eller aktivera production PRODAT route profile för kunduppgifter."
        : "Lägg in en aktiv Ediel-aktör för bolag, miljö och PRODAT.",
      route_resolution_status: hasAnySetting ? "route_profile_missing" : "sender_settings_missing",
    });
    return { status: "blocked", environment: null, actorSettingId: null, routeProfileId: null, productionSendLockStatus: "not_applicable", evidence: { explicitEnvironment: explicit, settings: settings.length, profiles: profiles.length }, blocker: details };
  }

  const resolved = narrowed.length === 1
    ? narrowed[0]
    : (!explicit ? narrowed.find((candidate) => candidate.environment === "production" && candidate.profiles.every((profile) => profile.is_production_route === true || routeMatchesCustomerGridOwner(profile))) : null);

  if (resolved) {
    return {
      status: "resolved",
      environment: resolved.environment,
      actorSettingId: resolved.setting?.id ?? null,
      routeProfileId: resolved.profile?.id ?? null,
      productionSendLockStatus: productionLockStatus(resolved.setting ?? null, resolved.environment),
      evidence: {
        messageFamily,
        messageCode,
        explicitEnvironment: explicit || null,
        candidateEnvironments: candidates.map((candidate) => candidate.environment),
        routeProfileId: resolved.profile?.id ?? null,
        actorSettingId: resolved.setting?.id ?? null,
        productionMode: resolved.profile?.production_mode ?? null,
      },
      blocker: null,
    };
  }

  // Distinguish a true environment ambiguity (both lanes viable, no explicit
  // choice, production cannot be confidently preferred) from "could not resolve
  // at all". We never silently fall back to test for production or vice versa.
  const ambiguous = !explicit && narrowed.length > 1;
  const unresolvedCode = settings.length === 0
    ? "sender_settings_missing"
    : ambiguous
      ? "environment_ambiguous"
      : "environment_not_resolved";
  const details = blocker(unresolvedCode, {
    blocker_reason: settings.length === 0
      ? "Avsändarinställning saknas för bolagets kunduppgiftsflöde."
      : ambiguous
        ? "Både test- och produktionsbanor är möjliga för kunduppgiftsflödet – systemet får aldrig gissa miljö."
        : "Ediel-miljö kunde inte bestämmas säkert för kunduppgiftsflödet.",
    next_required_action: settings.length === 0
      ? "Lägg in en aktiv Ediel-aktör för rätt bolag, roll och miljö."
      : ambiguous
        ? "Välj test eller produktion explicit, eller koppla en entydig production PRODAT route profile för kunduppgifter."
        : "Välj miljö explicit eller koppla en entydig production PRODAT route profile för kunduppgifter.",
    route_resolution_status: unresolvedCode,
  });
  return {
    status: "blocked",
    environment: null,
    actorSettingId: null,
    routeProfileId: null,
    productionSendLockStatus: "not_applicable",
    evidence: {
      messageFamily,
      messageCode,
      explicitEnvironment: explicit || null,
      activeSupplierSettings: settings.length,
      customerGridOwnerRouteProfiles: profiles.length,
      candidateEnvironments: candidates.map((candidate) => candidate.environment),
    },
    blocker: details,
  };
}
