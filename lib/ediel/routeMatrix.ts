/**
 * EDIEL Route Matrix — single source of truth for mapping business processes
 * (message family + message code) to DB-valid route scopes, ack modes, and
 * application references.
 *
 * All values here must match live DB constraints. DB constraints:
 *   communication_routes.route_scope:
 *     ('supplier_switch','customer_masterdata','meter_values','metering_values',
 *      'billing_underlay','metering_access')
 *   ediel_route_profiles.ack_mode:
 *     ('default','none','contrl_only','contrl_and_aperak')
 */

/** DB-valid values for communication_routes.route_scope */
export type CommunicationRouteScope =
  | "customer_masterdata"
  | "supplier_switch"
  | "metering_access"
  | "meter_values"
  | "metering_values"
  | "billing_underlay";

/** DB-valid values for ediel_route_profiles.ack_mode */
export type EdielAckMode = "default" | "none" | "contrl_only" | "contrl_and_aperak";

/** DB-valid values for communication_routes.route_type (EDIEL operational routes) */
export const EDIEL_PARTNER_ROUTE_TYPE = "ediel_partner" as const;

/** DB-valid target_system values for production vs test EDIEL routes */
export function targetSystemForEnvironment(environment: string): string {
  return environment === "production" ? "production_ediel" : "ediel";
}

// ---------------------------------------------------------------------------
// PRODAT supplier-switch message codes
// ---------------------------------------------------------------------------
const SUPPLIER_SWITCH_CODES = new Set([
  "Z03", "Z04", "Z05", "Z06", "Z09", "Z10",
]);

// PRODAT metering-access message codes (Z13 request, Z14 response, Z15 termination, Z18 terminate)
const METERING_ACCESS_CODES = new Set([
  "Z13", "Z14", "Z15", "Z18",
]);

// UTILTS billing-underlay sub-codes (no standard code list; determined by
// application_reference / business context, not message code alone)
const UTILTS_BILLING_UNDERLAY_REFS = new Set([
  "billing_underlay",
  "23-DDQ-UTILTS-UNDERLAG",
]);

// ---------------------------------------------------------------------------
// routeScopeForProcess
// ---------------------------------------------------------------------------

/**
 * Returns the DB-valid communication_routes.route_scope for a given
 * (messageFamily, messageCode) pair.
 *
 * Rules:
 *   PRODAT Z01              → customer_masterdata
 *   PRODAT Z03/04/05/06/09/10 → supplier_switch
 *   PRODAT Z13/14/15/18     → metering_access
 *   PRODAT (other/null)     → customer_masterdata  (safe default for PRODAT)
 *   UTILTS (billing ref)    → billing_underlay
 *   UTILTS (other)          → meter_values
 *   CONTRL / APERAK         → null (reuse source route; no own DB row)
 *   other                   → customer_masterdata  (safe fallback)
 */
export function routeScopeForProcess(params: {
  messageFamily: string;
  messageCode?: string | null;
  applicationReference?: string | null;
}): CommunicationRouteScope | null {
  const family = params.messageFamily.toUpperCase().trim();
  const code = (params.messageCode ?? "").toUpperCase().trim();
  const appRef = (params.applicationReference ?? "").toUpperCase().trim();

  if (family === "CONTRL" || family === "APERAK") {
    // ACK messages reuse the source message route context, not a separate DB row
    return null;
  }

  if (family === "PRODAT") {
    if (!code || code === "Z01" || code === "Z02") return "customer_masterdata";
    if (SUPPLIER_SWITCH_CODES.has(code)) return "supplier_switch";
    if (METERING_ACCESS_CODES.has(code)) return "metering_access";
    // Unknown PRODAT code → safe default
    return "customer_masterdata";
  }

  if (family === "UTILTS") {
    if (UTILTS_BILLING_UNDERLAY_REFS.has(appRef)) return "billing_underlay";
    return "meter_values";
  }

  return "customer_masterdata";
}

// ---------------------------------------------------------------------------
// ackModeForProcess
// ---------------------------------------------------------------------------

/**
 * Returns the DB-valid ediel_route_profiles.ack_mode for a business process.
 *
 * Swedish market EDIEL: every outbound PRODAT and UTILTS expects both a
 * CONTRL (syntax/structure acknowledgement) and an APERAK (business
 * acknowledgement). CONTRL and APERAK themselves do not expect ACKs.
 */
export function ackModeForProcess(params: {
  messageFamily: string;
  messageCode?: string | null;
}): EdielAckMode {
  const family = params.messageFamily.toUpperCase().trim();
  if (family === "CONTRL" || family === "APERAK") return "none";
  return "contrl_and_aperak";
}

// ---------------------------------------------------------------------------
// applicationReferenceForProcess
// ---------------------------------------------------------------------------

/**
 * Returns the canonical application reference (UNB/BGM qualifier) for a
 * business process. Falls back to the generic market reference.
 */
export function applicationReferenceForProcess(params: {
  routeScope?: CommunicationRouteScope | null;
  messageFamily?: string;
  messageCode?: string | null;
}): string {
  const scope = params.routeScope;
  const family = (params.messageFamily ?? "").toUpperCase();

  if (scope === "metering_access") return "23-DGI-PRODAT";
  if (scope === "supplier_switch") return "23-DDQ-PRODAT";
  if (scope === "customer_masterdata") return "23-DDQ-PRODAT";
  if (family === "UTILTS") return "23-DDQ-UTILTS";
  return "23-DDQ-PRODAT";
}

// ---------------------------------------------------------------------------
// shouldMaterializePerGridOwner
// ---------------------------------------------------------------------------

/**
 * Returns true for processes that require a separate communication route per
 * grid owner (i.e. the route must be materialized for each grid owner the
 * supplier operates against).
 */
export function shouldMaterializePerGridOwner(params: {
  messageFamily: string;
  messageCode?: string | null;
}): boolean {
  const family = params.messageFamily.toUpperCase().trim();
  // ACK messages reuse source context — not materialized per grid owner
  if (family === "CONTRL" || family === "APERAK") return false;
  // All operational EDIEL flows require grid-owner-scoped routes
  return true;
}

// ---------------------------------------------------------------------------
// isSupplierSwitchCode / isMeteringAccessCode / isCustomerMasterdataCode
// ---------------------------------------------------------------------------

export function isSupplierSwitchCode(messageCode: string | null | undefined): boolean {
  return SUPPLIER_SWITCH_CODES.has((messageCode ?? "").toUpperCase().trim());
}

export function isMeteringAccessCode(messageCode: string | null | undefined): boolean {
  return METERING_ACCESS_CODES.has((messageCode ?? "").toUpperCase().trim());
}

export function isCustomerMasterdataCode(messageCode: string | null | undefined): boolean {
  const code = (messageCode ?? "").toUpperCase().trim();
  return !code || code === "Z01" || code === "Z02";
}

// ---------------------------------------------------------------------------
// Convenience type-guard for DB-valid ack_mode
// ---------------------------------------------------------------------------
const VALID_ACK_MODES = new Set<string>(["default", "none", "contrl_only", "contrl_and_aperak"]);

export function isValidAckMode(value: unknown): value is EdielAckMode {
  return typeof value === "string" && VALID_ACK_MODES.has(value);
}

// ---------------------------------------------------------------------------
// Convenience type-guard for DB-valid communication_routes.route_scope
// ---------------------------------------------------------------------------
const VALID_ROUTE_SCOPES = new Set<string>([
  "customer_masterdata",
  "supplier_switch",
  "metering_access",
  "meter_values",
  "metering_values",
  "billing_underlay",
]);

export function isValidCommunicationRouteScope(value: unknown): value is CommunicationRouteScope {
  return typeof value === "string" && VALID_ROUTE_SCOPES.has(value);
}
