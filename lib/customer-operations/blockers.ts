export type CustomerOperationBlockerCode =
  | "grid_area_not_verified"
  | "operational_route_missing"
  | "platform_route_exists_but_not_materialized"
  | "production_send_locked"
  | "certificate_missing"
  | "missing_power_of_attorney"
  | "invalid_customer_site_snapshot"
  | "facility_or_metering_point_missing"
  | "facility_identifier_required_for_prodat_z01"
  | "blocked_missing_grid_owner_contact"
  | "environment_mismatch"
  | "environment_missing"
  | "ambiguous_sender_settings"
  | "sender_settings_missing"
  | "sender_ediel_id_missing"
  | "route_profile_missing"
  | "route_profile_disabled"
  | "production_route_profile_not_ready"
  | "environment_not_resolved"
  | "environment_ambiguous"
  | "stale_response_requires_review"
  | "technical_error"
  | "temporary_provider_error"
  | "send_uncertain";

export type CustomerOperationIssueType =
  | "data"
  | "route"
  | "certificate"
  | "production_approval"
  | "legal"
  | "technical";

export type CustomerOperationErrorClass =
  | "business_blocker"
  | "configuration_blocker"
  | "technical_error"
  | "temporary_provider_error"
  | "send_uncertain";

export type CustomerOperationBlocker = {
  reason_code: CustomerOperationBlockerCode | string;
  blocker_code: CustomerOperationBlockerCode | string;
  blocker_reason: string;
  next_required_action: string;
  issue_type: CustomerOperationIssueType;
  error_class: CustomerOperationErrorClass;
};

const BLOCKERS: Record<
  CustomerOperationBlockerCode,
  Omit<CustomerOperationBlocker, "reason_code" | "blocker_code">
> = {
  grid_area_not_verified: {
    blocker_reason:
      "Nätområde eller nätägare är inte verifierad för automatiskt Ediel-utskick.",
    next_required_action:
      "Verifiera nätområde och nätägare innan EDIFACT skickas.",
    issue_type: "data",
    error_class: "business_blocker",
  },
  operational_route_missing: {
    blocker_reason:
      "Operativ Ediel-route saknas för nätägaren och meddelandetypen.",
    next_required_action:
      "Skapa eller aktivera communication_route och Ediel route profile för nätägaren.",
    issue_type: "route",
    error_class: "configuration_blocker",
  },
  platform_route_exists_but_not_materialized: {
    blocker_reason:
      "Nätägaren är verifierad i aktörsregistret, men operativ route saknas.",
    next_required_action:
      "Synkronisera aktörsregistrets route till bolagets operativa route-konfiguration.",
    issue_type: "route",
    error_class: "configuration_blocker",
  },
  production_send_locked: {
    blocker_reason:
      "Produktionsutskick är låst tills första produktionssändningen är godkänd.",
    next_required_action:
      "Begär plattformsadministratörens godkännande av första produktionssändningen.",
    issue_type: "production_approval",
    error_class: "configuration_blocker",
  },
  certificate_missing: {
    blocker_reason:
      "Mottagarens giltiga certifikat saknas eller matchar inte route-konfigurationen.",
    next_required_action:
      "Lägg in och verifiera mottagarcertifikat för rätt Ediel-ID och miljö.",
    issue_type: "certificate",
    error_class: "configuration_blocker",
  },
  missing_power_of_attorney: {
    blocker_reason: "Signerad fullmakt saknas för uppgiftsbegäran.",
    next_required_action:
      "Ladda upp eller verifiera signerad fullmakt med rätt omfattning.",
    issue_type: "legal",
    error_class: "business_blocker",
  },
  invalid_customer_site_snapshot: {
    blocker_reason: "Kundens anläggningssnapshot är inte längre giltig.",
    next_required_action:
      "Uppdatera anläggningsadressen och starta om uppgiftsbegäran.",
    issue_type: "data",
    error_class: "business_blocker",
  },
  facility_or_metering_point_missing: {
    blocker_reason:
      "PRODAT Z01 kan inte förberedas eftersom anläggnings-id eller mätpunkt saknas.",
    next_required_action:
      "Begär anläggningsuppgifter från nätägaren eller komplettera anläggnings-id/mätpunkt innan Z01 kan förberedas.",
    issue_type: "data",
    error_class: "business_blocker",
  },
  facility_identifier_required_for_prodat_z01: {
    blocker_reason:
      "Anläggnings-ID saknas. Begär uppgiften från nätägaren med kundens fullmakt eller komplettera kunden innan Ediel kan skickas.",
    next_required_action:
      "Begär anläggnings-ID från nätägaren via e-post med kundens fullmakt, eller komplettera anläggnings-ID på kunden.",
    issue_type: "data",
    error_class: "business_blocker",
  },
  blocked_missing_grid_owner_contact: {
    blocker_reason:
      "Kontaktväg till nätägaren saknas. Lägg till e-postadress innan begäran kan skickas.",
    next_required_action:
      "Lägg till en verifierad e-postadress för nätägaren innan begäran skickas.",
    issue_type: "data",
    error_class: "business_blocker",
  },
  environment_mismatch: {
    blocker_reason:
      "Miljö stämmer inte mellan operation, aktörsinställning, route, certifikat eller transport.",
    next_required_action:
      "Korrigera miljö på route, aktörsinställning, certifikat och transport innan utskick.",
    issue_type: "route",
    error_class: "configuration_blocker",
  },
  environment_missing: {
    blocker_reason:
      "Ediel-miljö (test/produktion) saknas för operationen. Systemet får aldrig gissa miljö.",
    next_required_action:
      "Ange uttrycklig Ediel-miljö (test eller produktion) innan EDIFACT förbereds.",
    issue_type: "route",
    error_class: "configuration_blocker",
  },
  sender_ediel_id_missing: {
    blocker_reason:
      "Avsändarens Ediel-ID saknas för route profile och avsändarinställning.",
    next_required_action:
      "Fyll i bolagets Ediel-ID i ediel_actor_settings eller på route profile för rätt miljö.",
    issue_type: "route",
    error_class: "configuration_blocker",
  },
  route_profile_missing: {
    blocker_reason: "Vald route saknar Ediel route profile.",
    next_required_action:
      "Skapa en Ediel route profile kopplad till routen via communication_route_id.",
    issue_type: "route",
    error_class: "configuration_blocker",
  },
  route_profile_disabled: {
    blocker_reason: "Route profile finns men är avstängd (is_enabled=false).",
    next_required_action: "Aktivera Ediel route profile innan EDIFACT skickas.",
    issue_type: "route",
    error_class: "configuration_blocker",
  },
  production_route_profile_not_ready: {
    blocker_reason:
      "Route profile finns och är kopplad till routen men är inte produktionsklar.",
    next_required_action:
      "Granska och aktivera produktionsprofilen för PRODAT Z01 innan meddelandet kan förberedas eller skickas.",
    issue_type: "route",
    error_class: "configuration_blocker",
  },
  ambiguous_sender_settings: {
    blocker_reason:
      "Flera avsändarinställningar matchar samma bolag, miljö och meddelandeflöde.",
    next_required_action:
      "Inaktivera dubbletter eller välj en entydig avsändarinställning. Systemet gissar inte.",
    issue_type: "route",
    error_class: "configuration_blocker",
  },
  sender_settings_missing: {
    blocker_reason:
      "Avsändarinställning saknas för bolag, miljö och Ediel-flöde.",
    next_required_action:
      "Lägg in en entydig aktiv Ediel-aktör för rätt bolag, roll och miljö.",
    issue_type: "route",
    error_class: "configuration_blocker",
  },
  environment_not_resolved: {
    blocker_reason: "Ediel-miljö kunde inte bestämmas säkert.",
    next_required_action:
      "Välj eller koppla route/miljö explicit innan EDIFACT förbereds.",
    issue_type: "route",
    error_class: "configuration_blocker",
  },
  environment_ambiguous: {
    blocker_reason:
      "Både test- och produktionsbanor är möjliga – systemet får aldrig gissa miljö.",
    next_required_action:
      "Välj test eller produktion explicit, eller koppla en entydig route profile per miljö.",
    issue_type: "route",
    error_class: "configuration_blocker",
  },
  stale_response_requires_review: {
    blocker_reason:
      "Svaret matchar inte längre kundens ursprungliga anläggningssnapshot.",
    next_required_action:
      "Granska svaret manuellt innan anläggnings- eller mätpunktsdata uppdateras.",
    issue_type: "data",
    error_class: "business_blocker",
  },
  technical_error: {
    blocker_reason: "Ett tekniskt fel stoppade automationen.",
    next_required_action:
      "Granska tekniskt fel och försök igen när felet är åtgärdat.",
    issue_type: "technical",
    error_class: "technical_error",
  },
  temporary_provider_error: {
    blocker_reason: "Extern tjänst svarade tillfälligt inte.",
    next_required_action: "Försök igen när leverantören är tillgänglig.",
    issue_type: "technical",
    error_class: "temporary_provider_error",
  },
  send_uncertain: {
    blocker_reason: "Det är oklart om meddelandet skickades.",
    next_required_action:
      "Kontrollera transportloggar och invänta kvittens innan nytt utskick görs.",
    issue_type: "technical",
    error_class: "send_uncertain",
  },
};

export function normalizeBlockerCode(
  value: unknown,
): CustomerOperationBlockerCode | string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized in BLOCKERS) return normalized;
  return normalized;
}

export function makeCustomerOperationBlocker(
  code: CustomerOperationBlockerCode | string,
  overrides: Partial<
    Omit<CustomerOperationBlocker, "reason_code" | "blocker_code">
  > = {},
): CustomerOperationBlocker {
  const normalized = normalizeBlockerCode(code) ?? "technical_error";
  const defaults =
    normalized in BLOCKERS
      ? BLOCKERS[normalized as CustomerOperationBlockerCode]
      : BLOCKERS.technical_error;
  return {
    reason_code: normalized,
    blocker_code: normalized,
    ...defaults,
    ...overrides,
  };
}

export function routeIssueCodeToCustomerBlocker(
  code: unknown,
): CustomerOperationBlockerCode {
  const normalized = String(code ?? "")
    .trim()
    .toLowerCase();
  // Most specific route-profile states first so they are never collapsed into a
  // generic "operational_route_missing".
  if (normalized.includes("environment_missing")) return "environment_missing";
  if (normalized.includes("facility_or_metering_point_missing"))
    return "facility_or_metering_point_missing";
  if (
    normalized.includes("anläggnings-id") ||
    normalized.includes("mätpunkt") ||
    normalized.includes("facility_or_metering")
  )
    return "facility_or_metering_point_missing";
  if (normalized.includes("production_route_profile_not_ready"))
    return "production_route_profile_not_ready";
  if (normalized.includes("route_profile_disabled"))
    return "route_profile_disabled";
  if (
    normalized.includes("route_profile_missing") ||
    normalized.includes("missing_route_profile")
  ) {
    return "route_profile_missing";
  }
  if (
    normalized.includes("environment") ||
    normalized.includes("production_route_profile_not_production") ||
    normalized.includes("test_route_profile_not_test") ||
    normalized.includes("known_test_id")
  ) {
    return "environment_mismatch";
  }
  if (normalized.includes("ambiguous") && normalized.includes("sender")) {
    return "ambiguous_sender_settings";
  }
  if (
    normalized.includes("missing_sender_ediel_id") ||
    normalized.includes("sender_ediel_id_missing")
  ) {
    return "sender_ediel_id_missing";
  }
  if (
    normalized.includes("sender_settings_missing") ||
    normalized.includes("missing_company_actor_setting")
  ) {
    return "sender_settings_missing";
  }
  if (normalized.includes("environment_ambiguous"))
    return "environment_ambiguous";
  if (normalized.includes("environment_not_resolved"))
    return "environment_not_resolved";
  if (normalized.includes("certificate")) return "certificate_missing";
  if (normalized.includes("production_send_locked"))
    return "production_send_locked";
  if (
    normalized.includes("authorization") ||
    normalized.includes("power_of_attorney")
  ) {
    return "missing_power_of_attorney";
  }
  return "operational_route_missing";
}

export function customerBlockerStatusLabel(code: unknown): string {
  const normalized = normalizeBlockerCode(code);
  switch (normalized) {
    case "platform_route_exists_but_not_materialized":
    case "operational_route_missing":
    case "ambiguous_sender_settings":
    case "sender_settings_missing":
    case "sender_ediel_id_missing":
    case "route_profile_missing":
    case "route_profile_disabled":
    case "production_route_profile_not_ready":
    case "environment_missing":
    case "environment_mismatch":
      return "Uppgiftsbegäran blockerad av route-konfiguration";
    case "production_send_locked":
      return "Uppgiftsbegäran blockerad av produktionslås";
    case "facility_or_metering_point_missing":
    case "facility_identifier_required_for_prodat_z01":
      return "Anläggnings-ID saknas";
    case "blocked_missing_grid_owner_contact":
      return "Kontaktväg till nätägaren saknas";
    case "grid_area_not_verified":
      return "Uppgiftsbegäran kräver granskning";
    case "certificate_missing":
      return "Uppgiftsbegäran kräver granskning";
    case "missing_power_of_attorney":
      return "Uppgiftsbegäran kräver granskning";
    case "send_uncertain":
      return "Leveransstatus osäker";
    default:
      return "Uppgiftsbegäran kräver granskning";
  }
}

// Superadmin-only technical diagnostics. These are NEVER shown to tenants; the
// tenant only ever sees the Swedish operational `blocker_reason`/status label.
const SUPERADMIN_BLOCKER_DIAGNOSTICS: Partial<
  Record<CustomerOperationBlockerCode, string>
> = {
  facility_identifier_required_for_prodat_z01:
    "PRODAT Z01 blocked before render because Swedish PRODAT requirements require anläggnings-id/facility_id. Manual information request should be used.",
  blocked_missing_grid_owner_contact:
    "Manual e-mail blocked: no enabled grid_owner_contact_channels row (tenant override or platform default) for the required channel_type.",
};

export function customerBlockerSuperadminDiagnostic(
  code: unknown,
): string | null {
  const normalized = normalizeBlockerCode(code);
  if (!normalized) return null;
  return SUPERADMIN_BLOCKER_DIAGNOSTICS[
    normalized as CustomerOperationBlockerCode
  ] ?? null;
}
