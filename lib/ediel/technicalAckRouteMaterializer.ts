//lib/ediel/technicalAckRouteMaterializer.ts
//
// FINDINGS F92: the technical reply routes (CONTRL/APERAK) a supplier needs to
// answer the files a grid owner sends it. The canonical ACK gateway selects the
// reply route with gridex_ediel_technical_ack.select_configured_reply_route_v2:
// exactly one active communication_routes row with route_scope 'ediel_ack' in the
// source's lane whose ediel_route_profiles row mirrors the original UNB reversed
// (sender = our Ediel ID and the sub-address the file was addressed to, receiver =
// the grid owner's Ediel ID and sub-address), carries exactly the original's
// application reference (UNB 0026) and names the shared Ediel SMTP account. A NULL
// message_family/business_code on the profile answers both CONTRL and APERAK.
//
// Registry-materialized routes are the only production route model (FINDINGS F41),
// so these pairs are materialized next to the grid owner's PRODAT/UTILTS route:
// one route + one profile per application reference the grid owner sends a
// supplier in that family, derived through the canonical facade (never typed in):
//  - PRODAT: every canonical grid_owner → supplier PRODAT profile (Z02, Z04, Z05,
//    Z06, Z10) resolves to 23-DDQ-PRODAT (prodatRulebook/prodatApplicationReference).
//  - UTILTS: the codes the canonical business semantics let a grid owner send a
//    supplier (S02, S03, E31, E66; utiltsMarketSemantics), with the supplier's
//    field-311 role code DDQ (Balance supplier, NAD+DDQ / utiltsSubordinateRole),
//    kept only where the exact UTILTS 25-A-3 registry (utiltsApplicationReference)
//    lists the value: 23-DDQ-E31-S/T, 23-DDQ-E66-S/T, 23-DDQ-S02-S, 23-DDQ-S03-S.
//    ERR has no static reference; it echoes its original's reference.
//
// The selector holds on duplicates, so a pair is never created when one already
// answers the same inbound identity; our own pair is updated in place. Missing
// shared SMTP configuration skips the ACK routes with a reason and never fails the
// business route materialization. No gate is changed; every row carries the tenant.
import { supabaseService } from "@/lib/supabase/service";
import { assertEdielSmtpReadiness } from "@/lib/ediel/mailReadiness";
import {
  canonicalBusinessSemanticsCatalog,
  canonicalProdatProfiles,
  canonicalVerifiedUtiltsApplicationReference,
} from "@/lib/ediel/rulebook/canonicalEdielFacade";
import { targetSystemForEnvironment } from "@/lib/ediel/routeMatrix";
import type { SenderSettingRow } from "@/lib/ediel/senderSettingsResolver";

type JsonRecord = Record<string, unknown>;

export const TECHNICAL_ACK_REPLY_FAMILIES = ["CONTRL", "APERAK"] as const;

/** The supplier's role code in a UTILTS field-311 application reference (23-<role>-<code>-<S|T>). */
const SUPPLIER_UTILTS_ROLE_CODE = "DDQ";

export type TechnicalAckRegistryRoute = {
  id: string;
  actor_id: string;
  environment: "test" | "production" | string;
  subaddress: string | null;
  communication_address: string | null;
  interchange_party_id: string | null;
};

export type TechnicalAckGridOwner = { id: string; name: string | null };

export type TechnicalAckRouteAction = "created" | "updated" | "kept_existing";

export type TechnicalAckMaterializationResult = {
  status: "materialized" | "skipped" | "held";
  reasonCode: string | null;
  technicalMessage: string | null;
  applicationReferences: string[];
  routes: Array<{
    applicationReference: string;
    action: TechnicalAckRouteAction;
    communicationRouteId: string;
    edielRouteProfileId: string;
  }>;
  held: Array<{ applicationReference: string; reasonCode: string }>;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function upper(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

// Same address form the selector requires of communication_routes.target_email.
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** Application references (UNB 0026) of the files a grid owner sends a supplier in `messageFamily`. */
export function inboundTechnicalAckApplicationReferences(messageFamily: string): string[] {
  const family = upper(messageFamily);
  if (family === "PRODAT") {
    return [...new Set(canonicalProdatProfiles()
      .filter((profile) => profile.direction === "portal_to_actor" && profile.senderRole === "grid_owner" && profile.receiverRole === "supplier")
      .map((profile) => profile.applicationReference))];
  }
  if (family === "UTILTS") {
    const references = new Set<string>();
    for (const semantics of canonicalBusinessSemanticsCatalog()) {
      if (semantics.family !== "UTILTS" || !semantics.senderRoles.includes("grid_owner") || !semantics.receiverRoles.includes("supplier")) continue;
      // Field 311 is 23-<receiver role>-<code>-<S|T>; a value counts only when the exact
      // UTILTS 25-A-3 registry lists it for that code (the resolver refuses anything else).
      for (const resolution of ["S", "T"]) {
        const candidate = `23-${SUPPLIER_UTILTS_ROLE_CODE}-${semantics.code}-${resolution}`;
        try {
          if (canonicalVerifiedUtiltsApplicationReference({ messageCode: semantics.code, applicationReference: candidate }) === candidate) references.add(candidate);
        } catch {
          // Not a registered field-311 value for this code.
        }
      }
    }
    return [...references].sort();
  }
  return [];
}

/** The ediel_environment_type a lane's ACK route needs for the selector (production, or a test type). */
export function technicalAckEnvironmentType(environment: string): "production" | "bilateral_test" | null {
  if (environment === "production") return "production";
  if (environment === "test") return "bilateral_test";
  return null;
}

function laneAccepts(environmentType: unknown, environment: string): boolean {
  const value = String(environmentType ?? "");
  return environment === "production" ? value === "production" : ["tgt_test", "agt_test", "bilateral_test"].includes(value);
}

type AckRouteRow = { id: string; is_active: boolean | null; environment_type: string | null; target_email: string | null; auth_config: JsonRecord | null };
type AckProfileRow = {
  id: string; communication_route_id: string; environment: string; is_active: boolean | null; is_enabled: boolean | null;
  message_standard: string | null; payload_format: string | null; message_family: string | null; business_code: string | null;
  sender_ediel_id: string | null; receiver_ediel_id: string | null; sender_subaddress: string | null; sender_sub_address: string | null;
  receiver_subaddress: string | null; receiver_sub_address: string | null; application_reference: string | null;
  mailbox: string | null; smtp_host: string | null; smtp_port: number | null; transport_profile_id: string | null; metadata: JsonRecord | null;
};
type AckPair = { route: AckRouteRow; profile: AckProfileRow };

const skipped = (reasonCode: string, applicationReferences: string[], technicalMessage: string | null = null): TechnicalAckMaterializationResult =>
  ({ status: "skipped", reasonCode, technicalMessage, applicationReferences, routes: [], held: [] });

/**
 * Ensures the technical reply pairs for one grid owner, family and lane of a tenant.
 * Called after the grid owner's PRODAT/UTILTS route is materialized; never throws.
 */
export async function ensureGridOwnerTechnicalAckRoutes(params: {
  actorUserId: string | null;
  companyId: string;
  route: TechnicalAckRegistryRoute;
  gridOwner: TechnicalAckGridOwner;
  senderSettings: SenderSettingRow;
  /** Our sub-address for this family: the one the grid owner addresses its files to (UNB 0010 sub-address). */
  ownSubaddress: string | null;
  messageFamily: string;
}): Promise<TechnicalAckMaterializationResult> {
  const family = upper(params.messageFamily);
  const references = inboundTechnicalAckApplicationReferences(family);
  if (references.length === 0) return skipped("technical_ack_family_not_applicable", references);
  try {
    const lane = params.route.environment;
    const environmentType = technicalAckEnvironmentType(lane);
    if (!environmentType) return skipped("technical_ack_environment_unsupported", references);
    if (params.senderSettings.company_id !== params.companyId) return skipped("technical_ack_sender_tenant_mismatch", references);
    let smtp: { from: string; host: string; port: number };
    try {
      smtp = assertEdielSmtpReadiness();
    } catch (error) {
      return skipped("ediel_smtp_not_configured", references, error instanceof Error ? error.message : String(error));
    }
    if (!EMAIL.test(smtp.from) || !text(smtp.host) || !Number.isInteger(smtp.port) || smtp.port < 1 || smtp.port > 65535) {
      return skipped("ediel_smtp_not_configured", references, "ediel_technical_ack_smtp_account_unqualified");
    }
    const senderEdielId = text(params.senderSettings.ediel_id) ?? text(params.senderSettings.actor_ediel_id);
    if (!senderEdielId) return skipped("technical_ack_sender_ediel_id_missing", references);
    const receiverEdielId = text(params.route.interchange_party_id);
    if (!receiverEdielId) return skipped("technical_ack_receiver_ediel_id_missing", references);
    const targetEmail = text(params.route.communication_address);
    if (!targetEmail || !EMAIL.test(targetEmail)) return skipped("technical_ack_grid_owner_address_invalid", references);
    const ownSub = text(params.ownSubaddress);
    const receiverSub = text(params.route.subaddress);

    const routesRead = await supabaseService
      .from("communication_routes")
      .select("id,is_active,environment_type,target_email,auth_config")
      .eq("company_id", params.companyId)
      .eq("route_scope", "ediel_ack")
      .limit(1000);
    if (routesRead.error) throw routesRead.error;
    const routes = new Map(((routesRead.data ?? []) as AckRouteRow[]).map((row) => [row.id, row]));
    const pairs: AckPair[] = [];
    if (routes.size > 0) {
      const profilesRead = await supabaseService
        .from("ediel_route_profiles")
        .select("id,communication_route_id,environment,is_active,is_enabled,message_standard,payload_format,message_family,business_code,sender_ediel_id,receiver_ediel_id,sender_subaddress,sender_sub_address,receiver_subaddress,receiver_sub_address,application_reference,mailbox,smtp_host,smtp_port,transport_profile_id,metadata")
        .eq("company_id", params.companyId)
        .eq("environment", lane)
        .in("communication_route_id", [...routes.keys()])
        .limit(2000);
      if (profilesRead.error) throw profilesRead.error;
      for (const profile of (profilesRead.data ?? []) as AckProfileRow[]) {
        const route = routes.get(profile.communication_route_id);
        if (route) pairs.push({ route, profile });
      }
    }

    const own = (pair: AckPair) => {
      const config = record(pair.route.auth_config), meta = record(pair.profile.metadata);
      return config.materialized_from === "platform_actor_routes" && meta.materialized_from === "platform_actor_routes"
        && config.technical_ack_grid_owner_id === params.gridOwner.id && meta.technical_ack_grid_owner_id === params.gridOwner.id;
    };
    // The selector's inbound identity: who answers whom, at which sub-addresses, for which reference.
    const sameIdentity = (pair: AckPair, reference: string) => {
      const p = pair.profile;
      return p.sender_ediel_id === senderEdielId && p.receiver_ediel_id === receiverEdielId && p.application_reference === reference
        && (text(p.sender_subaddress) ?? text(p.sender_sub_address)) === ownSub
        && (text(p.receiver_subaddress) ?? text(p.receiver_sub_address)) === receiverSub;
    };
    // A pair (ours or configured by hand) the selector would also count for this reply.
    const answers = (pair: AckPair) => {
      const p = pair.profile;
      const replyScope = (value: string | null) => value === null || (TECHNICAL_ACK_REPLY_FAMILIES as readonly string[]).includes(value);
      return pair.route.is_active === true && laneAccepts(pair.route.environment_type, lane) && p.is_active === true && p.is_enabled === true
        && p.message_standard === "edifact" && p.payload_format === "edifact" && replyScope(p.message_family) && replyScope(p.business_code)
        && p.mailbox === smtp.from && EMAIL.test(String(pair.route.target_email ?? ""))
        && (p.transport_profile_id !== null || (p.smtp_host === smtp.host && p.smtp_port === smtp.port));
    };

    const result: TechnicalAckMaterializationResult = { status: "materialized", reasonCode: null, technicalMessage: null,
      applicationReferences: references, routes: [], held: [] };
    for (const reference of references) {
      const identical = pairs.filter((pair) => sameIdentity(pair, reference) && (own(pair) || answers(pair)));
      const ours = identical.filter(own);
      const foreign = identical.filter((pair) => !own(pair));
      if (ours.length + foreign.length > 1) {
        result.held.push({ applicationReference: reference, reasonCode: "technical_ack_route_ambiguous" });
        continue;
      }
      if (foreign.length === 1) {
        result.routes.push({ applicationReference: reference, action: "kept_existing",
          communicationRouteId: foreign[0].route.id, edielRouteProfileId: foreign[0].profile.id });
        continue;
      }
      // Our pair for this grid owner, reference and lane whose values changed (re-imported registry
      // route, changed sub-address) is updated in place rather than left behind next to a new one.
      const stale = ours[0] ?? pairs.find((pair) => own(pair) && pair.profile.application_reference === reference
        && record(pair.route.auth_config).technical_ack_platform_actor_route_id === params.route.id);
      // A route of ours left without its profile by an interrupted earlier run is completed, not duplicated.
      const orphanRouteId = stale ? null : [...routes.values()].find((route) => {
        const config = record(route.auth_config);
        return config.materialized_from === "platform_actor_routes" && config.technical_ack_grid_owner_id === params.gridOwner.id
          && config.technical_ack_application_reference === reference && config.environment === lane
          && !pairs.some((pair) => pair.route.id === route.id);
      })?.id ?? null;
      const existingRouteId = stale?.route.id ?? orphanRouteId;
      const name = `${params.gridOwner.name ?? "Nätägare"} ${family} teknisk kvittens ${reference} ${lane}`;
      const tag = {
        materialized_from: "platform_actor_routes",
        technical_ack_for_family: family,
        technical_ack_grid_owner_id: params.gridOwner.id,
        technical_ack_platform_actor_route_id: params.route.id,
        technical_ack_application_reference: reference,
        platform_market_actor_id: params.route.actor_id,
        reply_families: [...TECHNICAL_ACK_REPLY_FAMILIES],
      };
      const now = new Date().toISOString();
      const routePayload = {
        company_id: params.companyId,
        route_name: name,
        is_active: true,
        route_scope: "ediel_ack",
        route_type: "ediel_partner",
        route_group: "grid_owner",
        grid_owner_id: params.gridOwner.id,
        target_system: targetSystemForEnvironment(lane),
        endpoint: targetEmail,
        target_email: targetEmail,
        auth_config: { ...tag, environment: lane },
        supported_message_families: [...TECHNICAL_ACK_REPLY_FAMILIES],
        supported_message_codes: [],
        environment_type: environmentType,
        market_party_role: "grid_owner",
        counterparty_ediel_id: receiverEdielId,
        notes: "Teknisk kvittensroute (CONTRL/APERAK) materialiserad från verifierad aktörsregister-route.",
        updated_by: params.actorUserId,
        updated_at: now,
      };
      const routeWrite = existingRouteId
        ? supabaseService.from("communication_routes").update(routePayload).eq("id", existingRouteId).eq("company_id", params.companyId)
        : supabaseService.from("communication_routes").insert({ ...routePayload, created_by: params.actorUserId });
      const routeSaved = await routeWrite.select("id").single();
      if (routeSaved.error) throw routeSaved.error;
      const communicationRouteId = String((routeSaved.data as { id: string }).id);
      const profilePayload = {
        company_id: params.companyId,
        communication_route_id: communicationRouteId,
        environment: lane,
        route_name: name,
        route_type: "email",
        payload_format: "edifact",
        message_standard: "edifact",
        message_family: null,
        message_code: null,
        business_code: null,
        default_test_flag: lane === "production" ? 0 : 1,
        default_timezone: 1,
        sender_ediel_id: senderEdielId,
        own_ediel_id: senderEdielId,
        sender_sub_address: ownSub,
        sender_subaddress: ownSub,
        own_subaddress: ownSub,
        receiver_ediel_id: receiverEdielId,
        counterparty_ediel_id: receiverEdielId,
        receiver_sub_address: receiverSub,
        receiver_subaddress: receiverSub,
        receiver_message_subaddress: receiverSub,
        counterparty_subaddress: receiverSub,
        receiver_name: params.gridOwner.name,
        application_reference: reference,
        mailbox: smtp.from,
        smtp_host: smtp.host,
        smtp_port: smtp.port,
        transport_profile_id: null,
        transport_type: "smtp",
        // Production replies are S/MIME for every family, like all production Ediel transport
        // (production_smime_required; FINDINGS F100); readiness binds the receiver certificate.
        encryption_mode: params.route.environment === "production" || family === "PRODAT" ? "smime" : "none",
        is_active: true,
        is_enabled: true,
        metadata: { ...record(stale?.profile.metadata), ...tag, sender_settings_id: params.senderSettings.id },
        updated_at: now,
        updated_by: params.actorUserId,
      };
      const profileWrite = stale
        ? supabaseService.from("ediel_route_profiles").update(profilePayload).eq("id", stale.profile.id).eq("company_id", params.companyId)
        : supabaseService.from("ediel_route_profiles").insert({ ...profilePayload, created_by: params.actorUserId });
      const profileSaved = await profileWrite.select("id").single();
      if (profileSaved.error) throw profileSaved.error;
      result.routes.push({ applicationReference: reference, action: stale ? "updated" : "created", communicationRouteId,
        edielRouteProfileId: String((profileSaved.data as { id: string }).id) });
    }
    if (result.held.length > 0) {
      result.status = "held";
      result.reasonCode = result.held[0].reasonCode;
    }
    return result;
  } catch (error) {
    const candidate = error as { message?: unknown } | null;
    return { status: "held", reasonCode: "technical_ack_route_write_failed",
      technicalMessage: typeof candidate?.message === "string" ? candidate.message : String(error),
      applicationReferences: references, routes: [], held: [] };
  }
}
