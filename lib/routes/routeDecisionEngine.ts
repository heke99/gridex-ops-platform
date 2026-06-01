import { supabaseService } from "@/lib/supabase/service";
import { isEdielPortalParty } from "@/lib/ediel/core/productionGuards";
import { resolveDynamicReceiver } from "@/lib/routes/dynamicReceiverResolver";
import { resolveGridOwnerAgreementReference } from "@/lib/routes/agreementReferenceResolver";
import {
  buildAckPolicy,
  defaultMessageForProcess,
  expectedApplicationReference,
  requiresGridOwnerAgreement,
  routeScopeForBusinessProcess,
  supplierSwitchSubtype,
} from "@/lib/routes/routeReadiness";
import type {
  RouteDecisionInput,
  RouteDecisionIssue,
  RouteDecisionOutput,
  RouteDecisionTraceEntry,
  RouteScope,
} from "@/lib/routes/routeDecisionTypes";

type RouteRow = {
  id: string;
  company_id: string | null;
  route_name: string;
  is_active: boolean;
  route_scope: string;
  route_type: string;
  grid_owner_id: string | null;
  target_system: string | null;
  target_email: string | null;
};

type RouteProfileRow = {
  id: string;
  company_id: string | null;
  communication_route_id: string | null;
  is_enabled: boolean;
  sender_ediel_id: string | null;
  sender_sub_address: string | null;
  receiver_ediel_id: string | null;
  receiver_sub_address: string | null;
  receiver_name: string | null;
  receiver_email?: string | null;
  application_reference: string | null;
  default_message_version: string | null;
  ack_mode: string | null;
  mailbox: string | null;
  environment: string | null;
};

type ActorSettingRow = {
  id: string;
  company_id: string | null;
  environment: string | null;
  ediel_id: string | null;
  actor_ediel_id: string | null;
  sender_subaddress: string | null;
  sender_subaddress_prodat?: string | null;
  sender_subaddress_utilts?: string | null;
  sender_sub_address: string | null;
  is_active: boolean | null;
};

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function upper(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function isProduction(value: unknown): boolean {
  return (
    String(value ?? "")
      .trim()
      .toLowerCase() === "production"
  );
}

function isKnownTestEdielId(value: unknown): boolean {
  return isEdielPortalParty(text(value));
}

function addIssue(
  target: RouteDecisionIssue[],
  issue: Omit<RouteDecisionIssue, "severity"> & {
    severity?: "warning" | "blocking";
  },
) {
  target.push({ ...issue, severity: issue.severity ?? "blocking" });
}

function addTrace(
  target: RouteDecisionTraceEntry[],
  entry: RouteDecisionTraceEntry,
) {
  target.push(entry);
}

async function findRoute(params: {
  companyId?: string | null;
  routeScope: RouteScope;
  gridOwnerId?: string | null;
  preferredRouteId?: string | null;
}): Promise<{
  route: RouteRow | null;
  ambiguous: boolean;
  matches: RouteRow[];
}> {
  if (params.preferredRouteId) {
    let explicit = supabaseService
      .from("communication_routes")
      .select("*")
      .eq("id", params.preferredRouteId)
      .eq("is_active", true);

    if (params.companyId)
      explicit = explicit.or(
        `company_id.is.null,company_id.eq.${params.companyId}`,
      );

    const { data, error } = await explicit.limit(2);
    if (error) throw error;
    const rows = (data ?? []) as RouteRow[];
    if (rows.length === 1)
      return { route: rows[0], ambiguous: false, matches: rows };
  }

  let exact = supabaseService
    .from("communication_routes")
    .select("*")
    .eq("route_scope", params.routeScope)
    .eq("is_active", true);

  if (params.gridOwnerId) exact = exact.eq("grid_owner_id", params.gridOwnerId);
  else exact = exact.is("grid_owner_id", null);
  if (params.companyId)
    exact = exact.or(`company_id.is.null,company_id.eq.${params.companyId}`);

  const exactResult = await exact
    .order("company_id", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(3);
  if (exactResult.error) throw exactResult.error;
  const exactRows = (exactResult.data ?? []) as RouteRow[];
  if (exactRows.length === 1)
    return { route: exactRows[0], ambiguous: false, matches: exactRows };
  if (exactRows.length > 1)
    return { route: null, ambiguous: true, matches: exactRows };

  let fallback = supabaseService
    .from("communication_routes")
    .select("*")
    .eq("route_scope", params.routeScope)
    .eq("is_active", true)
    .is("grid_owner_id", null);

  if (params.companyId)
    fallback = fallback.or(
      `company_id.is.null,company_id.eq.${params.companyId}`,
    );

  const fallbackResult = await fallback
    .order("company_id", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(3);
  if (fallbackResult.error) throw fallbackResult.error;
  const fallbackRows = (fallbackResult.data ?? []) as RouteRow[];
  if (fallbackRows.length === 1)
    return { route: fallbackRows[0], ambiguous: false, matches: fallbackRows };
  return {
    route: null,
    ambiguous: fallbackRows.length > 1,
    matches: fallbackRows,
  };
}

async function findRouteProfile(
  routeId: string,
  companyId?: string | null,
): Promise<RouteProfileRow | null> {
  let query = supabaseService
    .from("ediel_route_profiles")
    .select("*")
    .eq("communication_route_id", routeId)
    .eq("is_enabled", true);

  if (companyId)
    query = query.or(`company_id.is.null,company_id.eq.${companyId}`);

  const { data, error } = await query
    .order("company_id", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as RouteProfileRow | null) ?? null;
}

async function findActiveActorSetting(params: {
  companyId?: string | null;
  environment?: string | null;
}): Promise<ActorSettingRow | null> {
  if (!params.companyId) return null;

  const { data, error } = await supabaseService
    .from("ediel_actor_settings")
    .select(
      "id,company_id,environment,ediel_id,actor_ediel_id,sender_subaddress,sender_subaddress_prodat,sender_subaddress_utilts,sender_sub_address,is_active",
    )
    .eq("company_id", params.companyId)
    .eq("environment", params.environment ?? "test")
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as ActorSettingRow | null) ?? null;
}

function productionGuardIssues(params: {
  environment?: string | null;
  route?: RouteRow | null;
  receiverEdielId?: string | null;
  targetEmail?: string | null;
}): RouteDecisionIssue[] {
  if (!isProduction(params.environment)) return [];

  const issues: RouteDecisionIssue[] = [];
  const targetSystem = String(params.route?.target_system ?? "").toLowerCase();
  const targetEmail = String(params.targetEmail ?? "").toLowerCase();
  const receiver = String(params.receiverEdielId ?? "").trim();

  if (isKnownTestEdielId(receiver)) {
    addIssue(issues, {
      code: "production_receiver_known_test_id",
      message:
        "Production får inte skicka till kända systemtest-/AGT-ID:n. Test-ID:n ska bara användas via DB-konfigurerade test-rutter i environment=test.",
      source: "production_guard",
      metadata: { receiverEdielId: receiver },
    });
  }

  if (targetEmail.endsWith("@ediel.se")) {
    addIssue(issues, {
      code: "production_test_email",
      message: "Production får inte använda testadress @ediel.se.",
      source: "production_guard",
    });
  }

  if (targetSystem.includes("tgt") || targetSystem.includes("ediel_portal")) {
    addIssue(issues, {
      code: "production_tgt_route",
      message: "Production får inte använda TGT/Edielportal-route.",
      source: "production_guard",
    });
  }

  return issues;
}

function compactPayload(
  decision: RouteDecisionOutput,
): Record<string, unknown> {
  return {
    decision_status: decision.decisionStatus,
    route_scope: decision.routeScope,
    communication_route_id: decision.communicationRouteId,
    ediel_route_profile_id: decision.edielRouteProfileId,
    grid_owner_access_agreement_id: decision.gridOwnerAccessAgreementId,
    business_process: decision.businessProcess,
    message_family: decision.messageFamily,
    message_code: decision.messageCode,
    message_intent: decision.messageIntent,
    application_reference: decision.applicationReference,
    message_version: decision.messageVersion,
    sender_ediel_id: decision.senderEdielId,
    sender_sub_address: decision.senderSubAddress,
    receiver_ediel_id: decision.receiverEdielId,
    receiver_sub_address: decision.receiverSubAddress,
    receiver_source: decision.receiverSource,
    dynamic_receiver_strategy: decision.dynamicReceiverStrategy,
    ack_policy: decision.ackPolicy,
    blocking_reasons: decision.blockingReasons,
    warnings: decision.warnings,
    required_admin_actions: decision.requiredAdminActions,
    decision_trace: decision.decisionTrace,
  };
}

export async function logRouteDecision(
  input: RouteDecisionInput,
  decision: RouteDecisionOutput,
): Promise<void> {
  const routeLogPayload = {
    company_id: input.companyId ?? null,
    customer_id: input.customerId ?? null,
    site_id: input.siteId ?? null,
    metering_point_id: input.meteringPointId ?? null,
    grid_owner_id: decision.resolvedGridOwnerId ?? input.gridOwnerId ?? null,
    current_supplier_id: input.currentSupplierId ?? null,
    business_process: input.businessProcess,
    requested_action: input.requestedAction ?? null,
    message_family: decision.messageFamily,
    message_code: decision.messageCode,
    environment: input.environment ?? "test",
    decision_status: decision.decisionStatus,
    route_scope: decision.routeScope,
    communication_route_id: decision.communicationRouteId,
    ediel_route_profile_id: decision.edielRouteProfileId,
    grid_owner_access_agreement_id: decision.gridOwnerAccessAgreementId,
    application_reference: decision.applicationReference,
    message_version: decision.messageVersion,
    sender_ediel_id: decision.senderEdielId,
    sender_sub_address: decision.senderSubAddress,
    receiver_ediel_id: decision.receiverEdielId,
    receiver_sub_address: decision.receiverSubAddress,
    receiver_source: decision.receiverSource,
    dynamic_receiver_strategy: decision.dynamicReceiverStrategy,
    ack_policy: decision.ackPolicy,
    blocking_reasons: decision.blockingReasons,
    warnings: decision.warnings,
    required_admin_actions: decision.requiredAdminActions,
    decision_trace: decision.decisionTrace,
    source_payload: input.payload ?? {},
    created_by: input.actorUserId ?? null,
  };

  const { data, error } = await supabaseService
    .from("route_decision_logs")
    .insert(routeLogPayload)
    .select("id")
    .maybeSingle();

  if (error) {
    console.warn("[routeDecisionEngine] Kunde inte logga route-beslut", error);
    return;
  }

  const routeDecisionLogId = (data as { id?: string } | null)?.id ?? null;
  const routingDecisionPayload = {
    route_decision_log_id: routeDecisionLogId,
    company_id: input.companyId ?? null,
    environment: input.environment ?? "test",
    message_family: decision.messageFamily,
    message_code: decision.messageCode,
    direction: "outbound",
    sender_ediel_id: decision.senderEdielId,
    sender_subaddress: decision.senderSubAddress,
    receiver_ediel_id: decision.receiverEdielId,
    receiver_subaddress: decision.receiverSubAddress,
    receiver_source: decision.receiverSource ?? "unresolved",
    dynamic_receiver_strategy: decision.dynamicReceiverStrategy,
    route_profile_id: decision.edielRouteProfileId,
    route_version: Number((decision.payload ?? {}).route_version ?? 1),
    transport_profile_id: (decision.payload ?? {}).transport_profile_id ?? null,
    metering_point_id: input.meteringPointId ?? null,
    grid_owner_id: decision.resolvedGridOwnerId ?? input.gridOwnerId ?? null,
    validation_status:
      decision.decisionStatus === "send"
        ? "passed"
        : decision.decisionStatus === "manual_review"
          ? "warning"
          : "blocked",
    validation_errors: decision.blockingReasons,
    validation_warnings: decision.warnings,
    decision_trace: decision.decisionTrace,
    is_dry_run: input.payload?.dryRun === true,
    created_by: input.actorUserId ?? null,
  };

  const { error: routingDecisionError } = await supabaseService
    .from("ediel_routing_decisions")
    .insert(routingDecisionPayload);
  if (routingDecisionError)
    console.warn(
      "[routeDecisionEngine] Kunde inte logga ediel_routing_decisions",
      routingDecisionError,
    );
}

export async function createRouteAdminTasks(
  input: RouteDecisionInput,
  decision: RouteDecisionOutput,
): Promise<void> {
  if (!input.companyId || decision.blockingReasons.length === 0) return;

  const tasks = decision.blockingReasons.map((reason) => ({
    company_id: input.companyId ?? null,
    customer_id: input.customerId ?? null,
    site_id: input.siteId ?? null,
    metering_point_id: input.meteringPointId ?? null,
    task_type: `route_${reason.code}`.slice(0, 80),
    status: "open",
    priority: reason.severity === "blocking" ? "high" : "normal",
    title: reason.message.slice(0, 140),
    description: reason.message,
    metadata: {
      source: "routeDecisionEngine",
      businessProcess: input.businessProcess,
      routeScope: decision.routeScope,
      messageFamily: decision.messageFamily,
      messageCode: decision.messageCode,
      decision: compactPayload(decision),
      reason,
    },
    created_by: input.actorUserId ?? null,
    updated_by: input.actorUserId ?? null,
  }));

  const { error } = await supabaseService
    .from("customer_operation_tasks")
    .insert(tasks);
  if (error)
    console.warn("[routeDecisionEngine] Kunde inte skapa admin tasks", error);
}

export async function decideCommunicationRoute(
  input: RouteDecisionInput,
): Promise<RouteDecisionOutput> {
  const trace: RouteDecisionTraceEntry[] = [];
  const blockingReasons: RouteDecisionIssue[] = [];
  const warnings: RouteDecisionIssue[] = [];
  const requiredAdminActions: string[] = [];
  const defaults = defaultMessageForProcess(input.businessProcess);
  const routeScope = routeScopeForBusinessProcess(input.businessProcess);
  const messageFamily = upper(input.messageFamily) || defaults.family;
  const messageCode = text(input.messageCode) ?? defaults.code;
  const environment = text(input.environment) ?? "test";

  addTrace(trace, {
    step: "classify_process",
    status: "success",
    message: `${input.businessProcess} klassades som ${routeScope}.`,
    metadata: { messageFamily, messageCode, environment },
  });

  const dynamicReceiver = await resolveDynamicReceiver({
    companyId: input.companyId ?? null,
    environment,
    businessProcess: input.businessProcess,
    messageFamily,
    messageCode,
    gridOwnerId: input.gridOwnerId ?? null,
    siteId: input.siteId ?? null,
    meteringPointId: input.meteringPointId ?? null,
    supplierSwitchRequestId: input.supplierSwitchRequestId ?? null,
    dataRequestId: input.dataRequestId ?? null,
    outboundRequestId: input.outboundRequestId ?? null,
    inboundMessageId: input.inboundMessageId ?? null,
  });

  blockingReasons.push(...dynamicReceiver.issues);
  warnings.push(...dynamicReceiver.warnings);
  dynamicReceiver.trace.forEach((entry) => addTrace(trace, entry));

  if (dynamicReceiver.status === "resolved") {
    addTrace(trace, {
      step: "dynamic_receiver_selected_grid_owner",
      status: "success",
      message: "Mottagande Ediel-ID valdes från manuellt vald nätägare.",
      metadata: {
        receiverSource: dynamicReceiver.receiverSource,
        dynamicReceiverStrategy: dynamicReceiver.dynamicReceiverStrategy,
        gridOwnerId: dynamicReceiver.gridOwnerId,
        receiverEdielId: dynamicReceiver.receiverEdielId,
      },
    });
  }

  if (
    dynamicReceiver.status === "missing" ||
    dynamicReceiver.status === "ambiguous" ||
    dynamicReceiver.status === "blocked"
  ) {
    requiredAdminActions.push(
      "Välj/komplettera nätägare på kundens anläggning, mätpunkt eller ärende innan Ediel skickas.",
    );
  }

  const selectedGridOwnerId =
    dynamicReceiver.gridOwnerId ?? input.gridOwnerId ?? null;

  if (!input.companyId) {
    addIssue(blockingReasons, {
      code: "missing_company_id",
      message:
        "company_id saknas. Systemet får inte skicka eller uppdatera kritisk data utan tenant.",
      source: "tenant_guard",
    });
    requiredAdminActions.push("Välj eller reparera bolagskoppling.");
  }

  if (
    ["supplier_switch", "metering_access", "customer_masterdata"].includes(
      input.businessProcess,
    ) &&
    !input.customerId
  ) {
    addIssue(blockingReasons, {
      code: "missing_customer_id",
      message: "customer_id saknas för processen.",
      source: "preflight",
    });
    requiredAdminActions.push("Koppla kunden innan utskick.");
  }

  if (
    [
      "supplier_switch",
      "metering_access",
      "meter_values",
      "customer_masterdata",
    ].includes(input.businessProcess) &&
    !selectedGridOwnerId
  ) {
    addIssue(blockingReasons, {
      code: "missing_grid_owner_id",
      message:
        "grid_owner_id saknas. Systemet kan inte välja mottagande nätägare.",
      source: "preflight",
    });
    requiredAdminActions.push("Koppla nätägare på anläggning/mätpunkt.");
  }

  if (
    input.businessProcess === "metering_access" &&
    routeScope !== "metering_access"
  ) {
    addIssue(blockingReasons, {
      code: "z13_wrong_route_scope",
      message: "Z13/Z14/Z15/Z18 får aldrig använda supplier_switch-route.",
      source: "route_scope_guard",
    });
  }

  const agreementDecision = await resolveGridOwnerAgreementReference({
    companyId: input.companyId ?? null,
    gridOwnerId: selectedGridOwnerId,
    routeScope,
    requireActiveAgreement: requiresGridOwnerAgreement(
      input.businessProcess,
      messageCode,
    ),
  });

  if (agreementDecision.status === "missing") {
    addIssue(blockingReasons, {
      code: "missing_grid_owner_agreement",
      message: agreementDecision.reasons[0] ?? "Aktivt nätägaravtal saknas.",
      source: "agreement_resolver",
    });
    requiredAdminActions.push("Lägg in aktivt nätägaravtal.");
  }

  if (agreementDecision.status === "ambiguous") {
    addIssue(blockingReasons, {
      code: "ambiguous_grid_owner_agreement",
      message:
        agreementDecision.reasons[0] ?? "Flera aktiva nätägaravtal matchar.",
      source: "agreement_resolver",
    });
    requiredAdminActions.push("Välj rätt nätägaravtal manuellt.");
  }

  if (agreementDecision.status === "resolved") {
    addTrace(trace, {
      step: "agreement_resolver",
      status: "success",
      message: agreementDecision.reasons[0] ?? "Aktivt nätägaravtal hittades.",
      metadata: { agreementId: agreementDecision.agreement?.id },
    });
  }

  if (
    input.businessProcess === "metering_access" &&
    !agreementDecision.agreementReference
  ) {
    addIssue(blockingReasons, {
      code: "missing_agreement_reference",
      message: "Z13 kräver agreement_reference/kundfullmaktsreferens.",
      source: "agreement_resolver",
    });
    requiredAdminActions.push("Lägg in avtalsreferens/fullmaktsreferens.");
  }

  const routeResult = await findRoute({
    companyId: input.companyId ?? null,
    routeScope,
    gridOwnerId: selectedGridOwnerId,
    preferredRouteId:
      agreementDecision.preferredRouteId ?? input.preferredRouteId ?? null,
  });

  if (routeResult.ambiguous) {
    addIssue(blockingReasons, {
      code: "ambiguous_route",
      message: `Flera aktiva routes matchar ${routeScope}. Systemet blockerar hellre än gissar.`,
      source: "route_resolver",
      metadata: { routeIds: routeResult.matches.map((row) => row.id) },
    });
    requiredAdminActions.push(
      "Välj route manuellt eller inaktivera dubbletter.",
    );
  }

  if (!routeResult.route) {
    addIssue(blockingReasons, {
      code: "missing_route",
      message: `Ingen aktiv communication_route hittades för ${routeScope}.`,
      source: "route_resolver",
    });
    requiredAdminActions.push("Skapa aktiv communication_route.");
  }

  const profile = routeResult.route
    ? await findRouteProfile(routeResult.route.id, input.companyId ?? null)
    : null;
  const actorSetting = await findActiveActorSetting({
    companyId: input.companyId ?? null,
    environment,
  });

  if (actorSetting) {
    addTrace(trace, {
      step: "actor_setting_resolver",
      status: "success",
      message: `Bolagets Ediel-ID hämtades från ediel_actor_settings för ${environment}.`,
      metadata: {
        actorSettingId: actorSetting.id,
        edielId: actorSetting.ediel_id ?? actorSetting.actor_ediel_id,
      },
    });
  }

  if (!actorSetting && isProduction(environment)) {
    addIssue(blockingReasons, {
      code: "missing_company_actor_setting",
      message:
        "Bolaget saknar aktiv production Ediel-aktör i ediel_actor_settings. Lägg in Ediel-ID i onboarding/go-live innan production-send.",
      source: "actor_setting_resolver",
    });
    requiredAdminActions.push(
      "Lägg in bolagets production Ediel-ID i Company → Ediel & Go-live.",
    );
  }

  if (routeResult.route) {
    addTrace(trace, {
      step: "route_resolver",
      status: "success",
      message: `Route ${routeResult.route.route_name} valdes för ${routeScope}.`,
      metadata: {
        routeId: routeResult.route.id,
        routeType: routeResult.route.route_type,
      },
    });
  }

  if (routeResult.route && !profile) {
    addIssue(blockingReasons, {
      code: "missing_route_profile",
      message: "Vald route saknar aktiv Ediel route profile.",
      source: "route_profile_resolver",
    });
    requiredAdminActions.push("Skapa eller aktivera Ediel route profile.");
  }

  const expectedAppRef = expectedApplicationReference(routeScope);
  const applicationReference =
    agreementDecision.applicationReference ??
    text(profile?.application_reference) ??
    expectedAppRef;

  const receiverEdielId =
    dynamicReceiver.receiverEdielId ??
    agreementDecision.receiverEdielId ??
    text(profile?.receiver_ediel_id) ??
    null;

  const receiverSubAddress =
    dynamicReceiver.receiverSubAddress ??
    agreementDecision.receiverSubAddress ??
    text(profile?.receiver_sub_address) ??
    null;

  const receiverSource =
    dynamicReceiver.receiverSource !== "not_required"
      ? dynamicReceiver.receiverSource
      : agreementDecision.receiverEdielId
        ? "grid_owner_agreement"
        : profile?.receiver_ediel_id
          ? "fixed_counterparty"
          : "unresolved";

  const dynamicReceiverStrategy =
    dynamicReceiver.dynamicReceiverStrategy ??
    (dynamicReceiver.receiverSource !== "not_required"
      ? dynamicReceiver.receiverSource
      : null);

  const resolvedGridOwnerId = selectedGridOwnerId;
  const resolvedCounterpartyId = dynamicReceiver.counterpartyId ?? null;

  if (isProduction(environment) && text(profile?.receiver_ediel_id) && dynamicReceiver.receiverSource === "not_required") {
    addIssue(warnings, {
      code: "production_fixed_receiver_route",
      message:
        "Production route använder fast mottagare. Kontrollera att processen verkligen kräver fixed_counterparty och inte vald nätägare/mätpunkt.",
      severity: "warning",
      source: "route_profile_resolver",
    });
  }

  const senderFromActorSetting =
    text(actorSetting?.ediel_id) ?? text(actorSetting?.actor_ediel_id);
  const senderFromLegacyProfile = text(profile?.sender_ediel_id);
  const senderEdielId = senderFromActorSetting ?? (!isProduction(environment) ? senderFromLegacyProfile : null);

  if (isProduction(environment) && senderFromLegacyProfile && !senderFromActorSetting) {
    addIssue(blockingReasons, {
      code: "production_sender_not_from_actor_settings",
      message:
        "Production sender Ediel-ID måste hämtas från ediel_actor_settings för bolaget. Route profile får inte vara fallback source-of-truth.",
      source: "actor_setting_resolver",
    });
    requiredAdminActions.push("Lägg in bolagets production Ediel-ID i Company → Ediel & Go-live.");
  }

  if (isProduction(environment) && senderEdielId && isKnownTestEdielId(senderEdielId)) {
    addIssue(blockingReasons, {
      code: "production_sender_known_test_id",
      message: "Production sender får inte vara ett känt systemtest-/AGT-ID.",
      source: "actor_setting_resolver",
      metadata: { senderEdielId },
    });
  }

  const senderSubAddress =
    messageFamily === "PRODAT"
      ? text(actorSetting?.sender_subaddress_prodat) ??
        text(actorSetting?.sender_subaddress) ??
        text(actorSetting?.sender_sub_address) ??
        text(profile?.sender_sub_address)
      : messageFamily === "UTILTS"
        ? text(actorSetting?.sender_subaddress_utilts) ??
          text(actorSetting?.sender_subaddress) ??
          text(actorSetting?.sender_sub_address) ??
          text(profile?.sender_sub_address)
        : text(actorSetting?.sender_subaddress) ??
          text(actorSetting?.sender_sub_address) ??
          text(profile?.sender_sub_address);
  const messageVersion =
    agreementDecision.preferredMessageVersion ??
    text(profile?.default_message_version);

  if (
    routeResult.route?.route_type === "email_manual" &&
    input.businessProcess === "supplier_switch"
  ) {
    addIssue(blockingReasons, {
      code: "supplier_switch_email_route_blocked",
      message:
        "Z03 får inte skickas via vanlig mail som huvudflöde. Skapa Ediel/PRODAT-route för supplier_switch.",
      source: "route_guard",
    });
  }

  if (
    ["PRODAT", "UTILTS", "APERAK", "CONTRL", "UTILTS_ERR"].includes(
      messageFamily,
    )
  ) {
    if (!senderEdielId) {
      addIssue(blockingReasons, {
        code: "missing_sender_ediel_id",
        message:
          "sender Ediel-id saknas. Lägg in bolagets Ediel-ID i ediel_actor_settings/onboarding eller komplettera route profile.",
        source: "route_profile_resolver",
      });
    }

    if (!receiverEdielId) {
      addIssue(blockingReasons, {
        code: "missing_receiver_ediel_id",
        message:
          "receiver Ediel-id saknas. Välj nätägare/motpart eller komplettera nätägarens Ediel-ID innan Ediel skickas.",
        source: "route_profile_resolver",
      });
    }
  }

  if (expectedAppRef && applicationReference !== expectedAppRef) {
    addIssue(warnings, {
      code: "unexpected_application_reference",
      message: `För ${routeScope} förväntas normalt ${expectedAppRef}, men route beslutade ${applicationReference ?? "—"}.`,
      severity: "warning",
      source: "application_reference_guard",
    });
  }

  const guardIssues = productionGuardIssues({
    environment,
    route: routeResult.route,
    receiverEdielId,
    targetEmail: routeResult.route?.target_email ?? null,
  });
  blockingReasons.push(...guardIssues);
  if (guardIssues.length > 0)
    requiredAdminActions.push(
      "Byt till riktig produktionsroute och mottagare.",
    );

  const subtype =
    input.businessProcess === "supplier_switch"
      ? supplierSwitchSubtype({
          cancellationRequested: Boolean(input.payload?.cancellation_requested),
          customerChange: Boolean(input.payload?.customer_change),
          moveIn: Boolean(input.payload?.move_in),
        })
      : null;

  if (subtype) {
    addTrace(trace, {
      step: "supplier_switch_subtype",
      status: "success",
      message: `Supplier switch subtype valdes: ${subtype}.`,
      metadata: { subtype },
    });
  }

  const decisionStatus =
    blockingReasons.length > 0
      ? "blocked"
      : warnings.length > 0
        ? "manual_review"
        : "send";

  const decision: RouteDecisionOutput = {
    decisionStatus,
    routeScope,
    communicationRouteId: routeResult.route?.id ?? null,
    edielRouteProfileId: profile?.id ?? null,
    gridOwnerAccessAgreementId: agreementDecision.agreement?.id ?? null,
    messageFamily,
    messageCode,
    messageIntent: defaults.intent,
    businessProcess: input.businessProcess,
    applicationReference,
    messageVersion,
    senderEdielId,
    senderSubAddress,
    receiverEdielId,
    receiverSubAddress,
    receiverSource,
    dynamicReceiverStrategy,
    resolvedGridOwnerId,
    resolvedCounterpartyId,
    ackPolicy: buildAckPolicy({ family: messageFamily, code: messageCode }),
    blockingReasons,
    warnings,
    requiredAdminActions: Array.from(new Set(requiredAdminActions)),
    decisionTrace: trace,
    payload: {
      ...(input.payload ?? {}),
      supplier_switch_subtype: subtype,
      agreement_reference: agreementDecision.agreementReference,
      receiver_source: receiverSource,
      dynamic_receiver_strategy: dynamicReceiverStrategy,
      resolved_grid_owner_id: resolvedGridOwnerId,
      selected_grid_owner_id: dynamicReceiver.gridOwnerId,
      selected_grid_owner_name: dynamicReceiver.receiverName,
      reference_requirements: agreementDecision.referenceRequirements,
    },
  };

  await logRouteDecision(input, decision);
  await createRouteAdminTasks(input, decision);

  return decision;
}

export function routeDecisionPayload(
  decision: RouteDecisionOutput,
): Record<string, unknown> {
  return compactPayload(decision);
}


// Public wrapper kept for the Ediel hardening architecture: callers should route
// through this backend decision engine before any EDIFACT builder receives sender/receiver data.
export async function resolveEdielRoute(
  input: RouteDecisionInput,
): Promise<RouteDecisionOutput> {
  return decideCommunicationRoute(input);
}
