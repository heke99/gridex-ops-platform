// Extracted from productionReadiness.ts; keep public imports on the facade module.
import { supabaseService } from "@/lib/supabase/service"
import { getEdielCertificationEvidenceReadiness } from '@/lib/ediel/certificationEvidence'


import { ACTOR_TEST_CASES } from "@/lib/ediel/actorTesting"
import { evaluateCanonicalActorTestReadiness, type CanonicalGoLiveReadinessSnapshot } from '@/lib/ediel/productionReadinessTestAuthority'
import { evaluateCertificateStatus } from "@/lib/ediel/security/certificateStatus"
import { getLatestSystemClockHealth } from "@/lib/ediel/operations/runtimeHealth"


import type { ActorSettingRow, BrpSettingRow, MailboxRow, ProductionReadinessIssue, ProductionReadinessResult, RouteProfileRow, SendLockRow } from './productionReadiness.part-1'
import { addIssue, bool, deriveProductionReadinessStatus, getCompany, getLatestGoLiveEvents, getLatestMessage, isActiveCompanyStatus, isDynamicReceiverRoute, isEnabled, isFixedReceiverRoute, isKnownTestEdielId, pickPrimary, routeMatchesMessageFamily, safeCount, safeSelect, text, upper } from './productionReadiness.part-1'

export async function getCompanyProductionReadiness(
  companyId: string,
  options: {
    checkedBy?: string | null;
    persist?: boolean;
  } = {},
): Promise<ProductionReadinessResult> {
  const company = await getCompany(companyId);
  if (!company) {
    const issue: ProductionReadinessIssue = {
      code: "company_not_found",
      label: "Bolag saknas",
      message: "Bolaget hittades inte.",
      severity: "blocking",
      area: "company",
    };
    return {
      companyId,
      status: "blocked",
      score: 0,
      blockingIssues: [issue],
      warnings: [],
      passedChecks: [],
      missingItems: [issue.label],
      nextActions: [
        "Kontrollera tenant-id och öppna bolaget via bolagskortet.",
      ],
      summary: {
        companyName: null,
        orgNumber: null,
        tenantId: companyId,
        environment: null,
        productionEnabled: false,
        productionLockLocked: true,
        productionStatus: null,
        liveApprovedAt: null,
        edielId: null,
        senderSubAddress: null,
        receiverSubAddress: null,
        actorRole: null,
        brpEdielId: null,
        contactEmail: null,
        operationsContactEmail: null,
        activeTestRouteProfileId: null,
        activeProductionRouteProfileId: null,
        activeProductionProdatRouteProfileId: null,
        activeProductionUtiltsRouteProfileId: null,
        hasProductionProdatRoute: false,
        hasProductionUtiltsRoute: false,
        productionMailboxId: null,
        latestInbound: null,
        latestOutbound: null,
        priorProductionSentCount: 0,
        latestPollAt: null,
        latestPollStatus: null,
        unresolvedItems: 0,
        failedMessages: 0,
        negativeAperaks: 0,
        firstLiveSendApprovedAt: null,
      },
      configurationSnapshot: { id: '', hash: '' },
      latestCheck: { id: null, checkedAt: null, checkedBy: null },
      latestDryRun: { id: null, status: null, createdAt: null, metadata: null },
      auditEvents: [],
    };
  }

  const { data: snapshotData, error: snapshotError } = await supabaseService.rpc(
    'canonical_capture_ediel_configuration_snapshot',
    { p_company_id: companyId, p_actor_user_id: options.checkedBy ?? null, p_reason: 'production_readiness_evaluated' }
  )
  if (snapshotError) throw snapshotError
  const configurationSnapshot = snapshotData as unknown as { id?: string; configuration_hash?: string } | null
  if (!configurationSnapshot?.id || !configurationSnapshot.configuration_hash) {
    throw new Error('canonical_configuration_snapshot_missing')
  }

  const [
    actors,
    routes,
    mailboxes,
    brps,
    locks,
    latestChecks,
    dryRuns,
    auditEvents,
  ] = await Promise.all([
    safeSelect<ActorSettingRow>("ediel_actor_settings", (query) =>
      query
        .select("*")
        .eq("company_id", companyId)
        .order("updated_at", { ascending: false }),
    ),
    safeSelect<RouteProfileRow>("ediel_route_profiles", (query) =>
      query
        .select("*")
        .eq("company_id", companyId)
        .order("updated_at", { ascending: false }),
    ),
    safeSelect<MailboxRow>("ediel_mailboxes", (query) =>
      query
        .select("*")
        .eq("environment", "production")
        .order("updated_at", { ascending: false })
        .limit(200),
    ),
    safeSelect<BrpSettingRow>("ediel_brp_settings", (query) =>
      query
        .select("*")
        .eq("company_id", companyId)
        .eq("environment", "production")
        .order("is_default", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(20),
    ),
    safeSelect<SendLockRow>("ediel_send_locks", (query) =>
      query
        .select("*")
        .eq("company_id", companyId)
        .eq("environment", "production")
        .order("updated_at", { ascending: false })
        .limit(1),
    ),
    safeSelect<Record<string, unknown>>(
      "ediel_production_readiness_checks",
      (query) =>
        query
          .select("id,status,checked_at,checked_by,configuration_snapshot_id,configuration_hash,is_stale")
          .eq("company_id", companyId)
          .eq("configuration_snapshot_id", configurationSnapshot.id)
          .eq("is_stale", false)
          .order("checked_at", { ascending: false })
          .limit(1),
    ),
    safeSelect<Record<string, unknown>>("ediel_go_live_events", (query) =>
      query
        .select("id,event_type,to_status,metadata,created_at,expires_at,configuration_snapshot_id,configuration_hash,is_stale")
        .eq("company_id", companyId)
        .eq("event_type", "production_dry_run")
        .eq("configuration_snapshot_id", configurationSnapshot.id)
        .eq("is_stale", false)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1),
    ),
    getLatestGoLiveEvents(companyId),
  ]);

  const testActor = pickPrimary(
    actors.filter(
      (row) => row.environment === "test" && row.is_active !== false,
    ),
  );
  const productionActor = pickPrimary(
    actors.filter(
      (row) => row.environment === "production" && row.is_active !== false,
    ),
    text(company.ediel_primary_actor_setting_id),
  );
  const testRoute = pickPrimary(
    routes.filter((row) => row.environment === "test" && isEnabled(row)),
    text(company.ediel_primary_test_route_profile_id),
  );
  const activeProductionRoutes = routes.filter(
    (row) => row.environment === "production" && isEnabled(row),
  );
  const productionProdatRoute = pickPrimary(
    activeProductionRoutes.filter((row) =>
      routeMatchesMessageFamily(row, "PRODAT"),
    ),
    text(company.ediel_primary_production_route_profile_id),
  );
  const productionUtiltsRoute = pickPrimary(
    activeProductionRoutes.filter((row) =>
      routeMatchesMessageFamily(row, "UTILTS"),
    ),
  );
  const productionRoute =
    productionProdatRoute ??
    pickPrimary(
      activeProductionRoutes,
      text(company.ediel_primary_production_route_profile_id),
    );
  const productionBrp =
    brps.find(
      (row) =>
        isEnabled(row) && text(row.brp_ediel_id) && row.is_default !== false,
    ) ??
    brps.find((row) => isEnabled(row) && text(row.brp_ediel_id)) ??
    null;
  const productionMailbox =
    mailboxes.find((mailbox) => {
      const ownsMailbox =
        !mailbox.company_id || mailbox.company_id === companyId;
      if (
        !ownsMailbox ||
        mailbox.environment !== "production" ||
        mailbox.is_active === false
      )
        return false;
      if (
        productionRoute?.mailbox_id &&
        mailbox.id === productionRoute.mailbox_id
      )
        return true;
      const mailboxText = upper(mailbox.email_address ?? mailbox.mailbox_name);
      return Boolean(
        mailboxText &&
        [company.production_mailbox, productionRoute?.mailbox]
          .map(upper)
          .includes(mailboxText),
      );
    }) ??
    mailboxes.find(
      (mailbox) =>
        !mailbox.company_id &&
        mailbox.environment === "production" &&
        mailbox.is_active !== false,
    ) ??
    null;
  const sendLock = locks[0] ?? null;
  const certificateId =
    text(productionRoute?.certificate_id) ??
    text(productionMailbox?.certificate_id);
  const certificateRows = certificateId
    ? await safeSelect<Record<string, unknown>>("ediel_certificates", (query) =>
        query.select("*").eq("id", certificateId).limit(1),
      )
    : [];
  const certificateStatus = certificateRows[0]
    ? evaluateCertificateStatus(certificateRows[0])
    : null;
  const latestClockHealth = (await getLatestSystemClockHealth({
    companyId,
    environmentType: "production",
  })) as Record<string, unknown> | null;

  const [
    latestInbound,
    latestOutbound,
    unresolvedItems,
    failedMessages,
    negativeAperaks,
    priorProductionSentCount,
  ] = await Promise.all([
    getLatestMessage(companyId, "inbound"),
    getLatestMessage(companyId, "outbound"),
    safeCount("ediel_unresolved_items", (query) =>
      query
        .eq("company_id", companyId)
        .eq("environment", "production")
        .in("resolution_status", [
          "open",
          "unresolved",
          "pending",
          "needs_review",
        ]),
    ),
    safeCount("ediel_messages", (query) =>
      query
        .eq("company_id", companyId)
        .eq("environment", "production")
        .eq("direction", "outbound")
        .eq("status", "failed"),
    ),
    safeCount("ediel_messages", (query) =>
      query
        .eq("company_id", companyId)
        .eq("environment", "production")
        .eq("message_family", "APERAK")
        .eq("ack_outcome", "negative"),
    ),
    safeCount("ediel_messages", (query) =>
      query
        .eq("company_id", companyId)
        .eq("environment", "production")
        .eq("direction", "outbound")
        .eq("status", "sent"),
    ),
  ]);

  const passed: ProductionReadinessIssue[] = [];
  const warnings: ProductionReadinessIssue[] = [];
  const blocking: ProductionReadinessIssue[] = [];
  const pass = (
    area: ProductionReadinessIssue["area"],
    code: string,
    label: string,
    message: string,
  ) => addIssue(passed, "passed", area, code, label, message);
  const warn = (
    area: ProductionReadinessIssue["area"],
    code: string,
    label: string,
    message: string,
  ) => addIssue(warnings, "warning", area, code, label, message);
  const block = (
    area: ProductionReadinessIssue["area"],
    code: string,
    label: string,
    message: string,
  ) => addIssue(blocking, "blocking", area, code, label, message);

  const companyProductionStatus =
    text(company.ediel_production_status) ?? text(company.production_status);
  const productionEnabled =
    bool(company.ediel_production_enabled) || bool(company.live_ediel_enabled);
  const productionLockLocked = sendLock
    ? sendLock.locked !== false
    : !productionEnabled;
  const actorEdielId =
    text(productionActor?.ediel_id) ?? text(productionActor?.actor_ediel_id);
  const legacyCompanyEdielId =
    text(company.production_ediel_id) ?? text(company.ediel_id);
  const companyEdielId = actorEdielId;
  const actorRole =
    text(productionActor?.actor_role) ?? text(productionActor?.role);
  const senderSubAddress =
    text(productionRoute?.sender_sub_address) ??
    text(productionRoute?.sender_subaddress) ??
    text(productionActor?.sender_sub_address) ??
    text(productionActor?.sender_subaddress);
  const receiverSubAddress =
    text(productionRoute?.receiver_sub_address) ??
    text(productionRoute?.receiver_subaddress) ??
    text(productionActor?.receiver_sub_address) ??
    text(productionActor?.receiver_subaddress);
  const contactEmail =
    text(productionActor?.contact_email) ??
    text(company.technical_contact_email) ??
    text(company.primary_contact_email);
  const operationsContactEmail =
    text(productionActor?.operations_contact_email) ??
    text((company.operations_contact as Record<string, unknown> | null)?.email);
  const brpEdielId = text(productionBrp?.brp_ediel_id);

  if (text(company.id))
    pass(
      "company",
      "company_exists",
      "Bolag finns",
      "Bolaget kan läsas med tenant-id.",
    );
  else
    block(
      "company",
      "company_id_missing",
      "Company ID saknas",
      "Bolaget saknar giltigt tenant-id.",
    );
  if (isActiveCompanyStatus(text(company.status)))
    pass(
      "company",
      "company_active",
      "Bolaget är aktivt",
      "Bolaget är inte pausat, suspenderat eller arkiverat.",
    );
  else
    block(
      "company",
      "company_not_active",
      "Bolaget är pausat/blockerat",
      `Bolagsstatus är ${text(company.status) ?? "okänd"}.`,
    );
  if (actorEdielId)
    pass(
      "actor",
      "production_ediel_id",
      "Production Ediel-ID finns",
      `Production Ediel-ID hämtas från actor settings: ${actorEdielId}.`,
    );
  else
    block(
      "actor",
      "production_ediel_id_missing",
      "Production Ediel-ID saknas",
      "Lägg in bolagets production Ediel-ID i ediel_actor_settings. Systemet får inte använda hårdkodad eller global fallback.",
    );
  if (productionActor)
    pass(
      "actor",
      "production_actor_exists",
      "Production actor settings finns",
      "Aktiv production actor settings-rad finns för bolaget.",
    );
  else
    block(
      "actor",
      "production_actor_missing",
      "Production actor settings saknas",
      "Skapa eller synka en aktiv actor settings-rad med environment=production.",
    );

  if (productionRoute && productionRoute.tls_required !== false)
    pass(
      "route",
      "production_tls_required",
      "TLS krävs på production route",
      "Production route är markerad med TLS-krav.",
    );
  else
    block(
      "route",
      "production_tls_not_required",
      "TLS-krav saknas",
      "Production transport måste kräva TLS.",
    );

  const prodatEncryptionMode = text(productionProdatRoute?.encryption_mode) ?? text(productionRoute?.encryption_mode);
  const prodatHasDynamicReceiver =
    text(productionProdatRoute?.receiver_source) !== "fixed_counterparty" &&
    !text(productionProdatRoute?.receiver_ediel_id);
  const prodatReceiverCertificateId =
    text(productionProdatRoute?.receiver_certificate_id) ??
    text((productionProdatRoute as Record<string, unknown> | null)?.certificate_id);

  if (!productionProdatRoute) {
    block(
      "safety",
      "production_smime_no_prodat_route",
      "PRODAT-route saknas",
      "S/MIME kan inte kontrolleras innan en PRODAT production route finns.",
    );
  } else if (prodatEncryptionMode === "smime") {
    pass(
      "safety",
      "production_smime_default",
      "S/MIME är aktiverat för PRODAT",
      "PRODAT använder S/MIME över shared eller bolagsspecifik transport. Mailboxen är transportkanal, inte tenant-identitet.",
    );
  } else {
    block(
      "safety",
      "production_smime_missing",
      "S/MIME saknas för PRODAT",
      "PRODAT production route måste ha encryption_mode=smime. Shared mailbox ersätter inte mottagarkryptering.",
    );
  }

  if (!productionProdatRoute) {
    // Route blocker ovan räcker.
  } else if (prodatHasDynamicReceiver) {
    pass(
      "safety",
      "production_recipient_certificate_resolved_at_send",
      "Mottagarcertifikat löses vid sändning",
      "Dynamisk production-route använder kundens verifierade nätägare och mottagarens certifikat vid faktisk PRODAT-send. Tenant behöver inget eget mailbox-certifikat för shared transport.",
    );
  } else if (prodatReceiverCertificateId || certificateStatus?.isUsableForSmime) {
    pass(
      "safety",
      "production_certificate_active",
      "Mottagarcertifikat är kopplat",
      certificateStatus?.message ??
        "Production PRODAT-route har kopplat mottagarcertifikat för fast motpart.",
    );
  } else {
    block(
      "safety",
      "production_recipient_certificate_missing",
      "Mottagarcertifikat saknas",
      "Fast PRODAT-motpart kräver kopplat mottagarcertifikat. För normal production ska route istället använda dynamisk mottagare från nätägare.",
    );
  }

  if (!latestClockHealth)
    warn(
      "safety",
      "time_sync_unknown",
      "Klocksynk okänd",
      "Kör system clock health check innan kritiska production-sändningar.",
    );
  else if (latestClockHealth.status === "critical")
    block(
      "safety",
      "time_sync_critical",
      "Klocksynk kritisk",
      "Runtime/server time drift är kritisk och production-sändning ska stoppas.",
    );
  else
    pass(
      "safety",
      "time_sync_checked",
      "Klocksynk kontrollerad",
      `Senaste klockstatus: ${String(latestClockHealth.status ?? "okänd")}.`,
    );
  if (
    actorEdielId &&
    legacyCompanyEdielId &&
    actorEdielId === legacyCompanyEdielId
  )
    pass(
      "actor",
      "actor_ediel_matches_company",
      "Actor Ediel-ID matchar legacy-bolagsfält",
      "Actor settings använder samma Ediel-ID som bolagets äldre Ediel-fält.",
    );
  else if (
    actorEdielId &&
    legacyCompanyEdielId &&
    actorEdielId !== legacyCompanyEdielId
  )
    warn(
      "actor",
      "actor_ediel_legacy_mismatch",
      "Legacy Ediel-ID avviker",
      `Actor settings ${actorEdielId} är source-of-truth. Äldre bolagsfält visar ${legacyCompanyEdielId} och bör synkas eller fasas ut.`,
    );
  if (actorEdielId && isKnownTestEdielId(actorEdielId))
    block(
      "actor",
      "production_actor_known_test_id",
      "Production actor använder test-ID",
      "Production actor settings får inte använda 91100 eller 91109 som bolagets Ediel-ID.",
    );
  if (actorRole)
    pass(
      "actor",
      "actor_role_configured",
      "Actor role är konfigurerad",
      `Actor role är ${actorRole}.`,
    );
  else
    block(
      "actor",
      "actor_role_missing",
      "Actor role saknas",
      "Ange aktörsroll/marknadsroll för bolaget.",
    );
  if (senderSubAddress || receiverSubAddress)
    pass(
      "actor",
      "subaddress_known",
      "Subaddress är känd",
      "Sender/receiver subaddress är ifylld där route/actor kräver den.",
    );
  else
    warn(
      "actor",
      "subaddress_missing",
      "Subaddress saknas",
      "Ingen sender/receiver subaddress är konfigurerad. Verifiera om aktören behöver subaddress.",
    );
  if (brpEdielId)
    pass(
      "actor",
      "brp_configured",
      "BRP Ediel-ID finns",
      `BRP Ediel-ID är ${brpEdielId}.`,
    );
  else
    block(
      "actor",
      "brp_missing",
      "BRP Ediel-ID saknas",
      "BRP/balance responsible party måste vara konfigurerad innan production.",
    );
  if (productionBrp)
    pass(
      "actor",
      "brp_active",
      "Production-BRP är aktiv",
      "BRP hämtas från ediel_brp_settings för production.",
    );
  else
    block(
      "actor",
      "brp_not_active",
      "Production-BRP saknas",
      "BRP måste finnas i ediel_brp_settings för production. Legacy-fält och actor settings används inte som production-BRP.",
    );
  if (String(company.esett_status ?? "").toLowerCase() === "ready")
    pass("actor", "esett_ready", "eSett är klar", "eSett-status är ready.");
  else
    block(
      "actor",
      "esett_not_ready",
      "eSett är inte klar",
      "eSett-status måste vara ready.",
    );
  if (contactEmail)
    pass(
      "company",
      "contact_email",
      "Kontakt finns",
      `Kontakt: ${contactEmail}.`,
    );
  else
    block(
      "company",
      "contact_email_missing",
      "Kontakt saknas",
      "Lägg in teknisk kontakt eller primär kontakt.",
    );
  if (operationsContactEmail)
    pass(
      "company",
      "operations_contact",
      "Driftkontakt finns",
      `Driftkontakt: ${operationsContactEmail}.`,
    );
  else
    warn(
      "company",
      "operations_contact_missing",
      "Driftkontakt saknas",
      "Lägg gärna in separat driftkontakt för incidenter.",
    );
  if (testActor)
    pass(
      "environment",
      "test_actor_exists",
      "Testmiljö finns",
      "Aktiv test actor settings finns.",
    );
  else
    block(
      "environment",
      "test_actor_missing",
      "Test actor settings saknas",
      "Testmiljö måste finnas och vara separerad från production.",
    );
  if (productionActor)
    pass(
      "environment",
      "production_actor_exists",
      "Productionmiljö finns",
      "Aktiv production actor settings finns.",
    );
  else
    block(
      "environment",
      "production_actor_missing",
      "Production actor settings saknas",
      "Lägg in bolagets Ediel-ID som aktiv production actor. Test/legacy-fält används inte som fallback.",
    );
  if (testRoute)
    pass(
      "route",
      "test_route_exists",
      "Test route finns",
      "Aktiv test route profile finns.",
    );
  else
    block(
      "route",
      "test_route_missing",
      "Test route saknas",
      "Skapa aktiv route profile med environment=test.",
    );
  if (productionProdatRoute)
    pass(
      "route",
      "production_prodat_route_exists",
      "PRODAT production route finns",
      "Marknadsprocesser har aktiv production route.",
    );
  else
    block(
      "route",
      "production_prodat_route_missing",
      "PRODAT production route saknas",
      "Skapa aktiv PRODAT production route innan go-live.",
    );
  if (productionUtiltsRoute)
    pass(
      "route",
      "production_utilts_route_exists",
      "UTILTS production route finns",
      "Mätvärdesflöden har aktiv production route.",
    );
  else
    warn(
      "route",
      "production_utilts_route_missing",
      "UTILTS production route saknas",
      "Bolaget kan inte hantera production-mätvärdesflöden förrän UTILTS route är skapad.",
    );
  if (productionRoute) {
    const routeSender = text(productionRoute.sender_ediel_id);
    const routeReceiver = text(productionRoute.receiver_ediel_id);
    const receiverSource = text(productionRoute.receiver_source);
    const dynamicStrategy = text(productionRoute.dynamic_receiver_strategy);
    const dynamicReceiver = isDynamicReceiverRoute(productionRoute);
    const fixedReceiver = isFixedReceiverRoute(productionRoute);

    if (!routeSender) {
      pass(
        "route",
        "production_route_sender_from_actor_settings",
        "Production sender hämtas från actor settings",
        "Route saknar fast sender, vilket är tillåtet när sender löses från ediel_actor_settings.",
      );
    } else if (actorEdielId && upper(routeSender) === upper(actorEdielId)) {
      pass(
        "route",
        "production_route_sender_valid",
        "Production route sender är korrekt",
        "Sender Ediel-ID matchar bolagets actor settings.",
      );
    } else {
      block(
        "route",
        "production_route_sender_invalid",
        "Production route sender är fel",
        "Production route får inte använda hårdkodad/global sender. Sender ska komma från bolagets ediel_actor_settings.",
      );
    }

    if (routeSender && isKnownTestEdielId(routeSender)) {
      block(
        "route",
        "production_route_sender_known_test_id",
        "Production route använder test-sender",
        "Production route får inte använda 91100 eller 91109 som sender.",
      );
    }

    if (routeReceiver && isKnownTestEdielId(routeReceiver)) {
      block(
        "route",
        "production_route_receiver_known_test_id",
        "Production route använder test-mottagare",
        "Production route får inte använda 91100 eller 91109 som mottagare.",
      );
    } else if (dynamicReceiver && receiverSource && dynamicStrategy) {
      pass(
        "route",
        "production_route_dynamic_receiver_valid",
        "Dynamisk production-mottagare är konfigurerad",
        `Receiver löses vid runtime via ${receiverSource} / ${dynamicStrategy}. Fast receiver Ediel-ID behöver inte vara ifyllt.`,
      );
    } else if (dynamicReceiver && (!receiverSource || !dynamicStrategy)) {
      block(
        "route",
        "production_route_dynamic_receiver_incomplete",
        "Dynamisk mottagare är ofullständig",
        "Production route som kräver dynamisk mottagare måste ha receiver_source och dynamic_receiver_strategy.",
      );
    } else if (fixedReceiver && routeReceiver) {
      pass(
        "route",
        "production_route_receiver_valid",
        "Fast production-mottagare är konfigurerad",
        "Receiver Ediel-ID är ifylld och är inte en känd testmotpart.",
      );
    } else {
      block(
        "route",
        "production_route_receiver_invalid",
        "Production route receiver saknas/fel",
        "Production route måste antingen ha dynamisk receiver_source/dynamic_receiver_strategy eller en giltig fast production-motpart.",
      );
    }
  }
  if (
    productionRoute &&
    text(
      productionRoute.transport_profile_id ??
        productionRoute.transport_type ??
        productionRoute.route_type ??
        productionRoute.mailbox ??
        productionRoute.mailbox_id,
    )
  )
    pass(
      "route",
      "production_transport_configured",
      "Transport är konfigurerad",
      "Production route har transportprofil, transport channel eller mailbox-koppling.",
    );
  else if (productionRoute)
    block(
      "route",
      "production_transport_missing",
      "Transport saknas",
      "Production route saknar transport profile, transport channel eller mailbox.",
    );
  if (
    testRoute &&
    productionRoute &&
    testRoute.id !== productionRoute.id &&
    testRoute.communication_route_id !== productionRoute.communication_route_id
  )
    pass(
      "environment",
      "routes_separated",
      "Test och production är separerade",
      "Route-profilerna återanvänder inte samma route-id.",
    );
  else if (testRoute && productionRoute)
    block(
      "environment",
      "routes_not_separated",
      "Test och production delar route",
      "Test route får inte återanvändas för production.",
    );
  if (productionMailbox)
    pass(
      "mailbox",
      "production_mailbox_exists",
      "Production mailbox finns",
      "Production mailbox/transport finns för environment=production.",
    );
  else
    block(
      "mailbox",
      "production_mailbox_missing",
      "Production mailbox saknas",
      "Konfigurera production mailbox eller shared platform mailbox med environment=production.",
    );
  if (productionMailbox && productionMailbox.environment === "production")
    pass(
      "mailbox",
      "production_mailbox_environment",
      "Mailbox är production",
      "Mailboxen är kopplad till environment=production.",
    );
  else if (productionMailbox)
    block(
      "mailbox",
      "production_mailbox_environment_wrong",
      "Mailbox har fel miljö",
      "Production får inte använda test-mailbox.",
    );
  if (productionMailbox && text(productionMailbox.secret_reference))
    pass(
      "mailbox",
      "mailbox_secret_reference",
      "Mailbox secret reference finns",
      "Mailbox använder secret_reference.",
    );
  else if (productionMailbox)
    block(
      "mailbox",
      "mailbox_secret_reference_missing",
      "Mailbox secret reference saknas",
      "SMTP/IMAP-hemligheter ska refereras via secret_reference och inte plaintext i DB.",
    );
  if (
    productionMailbox &&
    !String(productionMailbox.username ?? "")
      .toLowerCase()
      .includes("password=")
  )
    pass(
      "mailbox",
      "mailbox_no_plaintext_secret",
      "Ingen tydlig plaintext-hemlighet",
      "Mailbox-konfigurationen ser inte ut att innehålla plaintext-lösenord.",
    );
  if (
    productionMailbox?.last_successful_poll_at ||
    productionMailbox?.last_poll_at ||
    productionMailbox?.last_polled_at
  )
    pass(
      "mailbox",
      "mailbox_poll_known",
      "Mailbox poll-status är känd",
      "Senaste poll-status finns.",
    );
  else if (productionMailbox)
    warn(
      "mailbox",
      "mailbox_poll_unknown",
      "Mailbox poll-status saknas",
      "Ingen latest poll finns ännu. Kör/validera polling innan go-live.",
    );
  if (productionMailbox?.locked_at)
    warn(
      "mailbox",
      "mailbox_locked",
      "Mailbox lock finns",
      "Mailboxen har ett aktivt/stale lock som bör kontrolleras.",
    );

  const requiredTests = ACTOR_TEST_CASES.filter((testCase) => testCase.required);
  const expectedProdatTests = requiredTests.filter((testCase) => testCase.messageFamily === "PRODAT").length;
  const expectedUtiltsTests = requiredTests.filter((testCase) => testCase.messageFamily === "UTILTS").length;
  const { data: canonicalGoLiveReadinessData, error: canonicalGoLiveReadinessError } =
    await supabaseService.rpc('gridex_company_go_live_readiness', {
      p_company_id: companyId,
    });
  if (canonicalGoLiveReadinessError) {
    block(
      "tests",
      "canonical_required_tests_unavailable",
      "Canonical testreadiness kan inte verifieras",
      `Kunde inte läsa canonical go-live readiness: ${canonicalGoLiveReadinessError.message}.`,
    );
  } else {
    const canonicalActorTests = evaluateCanonicalActorTestReadiness(
      canonicalGoLiveReadinessData as CanonicalGoLiveReadinessSnapshot | null,
      expectedProdatTests,
      expectedUtiltsTests,
    );
    if (canonicalActorTests.ready)
      pass(
        "tests",
        "required_tests_approved",
        "Aktörstester är godkända",
        `Canonical runtime verifierar PRODAT ${canonicalActorTests.prodatPassed}/${canonicalActorTests.prodatTotal} och UTILTS ${canonicalActorTests.utiltsPassed}/${canonicalActorTests.utiltsTotal}.`,
      );
    else
      block(
        "tests",
        "required_tests_missing",
        "Aktörstester saknas",
        canonicalActorTests.reason ?? "Canonical testreadiness är inte komplett.",
      );
  }

  try {
    const evidence = await getEdielCertificationEvidenceReadiness(companyId)
    if (evidence.ready) {
      pass(
        "tests",
        "external_certification_and_pilot_approved",
        "Extern verifiering och pilot är godkända",
        "TGT, AGT, shadow production, begränsad pilot, live tenant-integritet och restore/replay är godkända för aktuell canonical engine-version.",
      )
    } else {
      block(
        "tests",
        "external_certification_and_pilot_missing",
        "Extern verifiering eller pilot saknas",
        `Saknar godkänd evidens för aktuell engine-version: ${evidence.missing.join(", ")}.`,
      )
    }
  } catch (error) {
    block(
      "tests",
      "external_certification_evidence_unavailable",
      "Extern verifiering kan inte bekräftas",
      error instanceof Error ? error.message : "Kunde inte läsa certification evidence.",
    )
  }

  if (unresolvedItems === 0)
    pass(
      "operations",
      "no_unresolved_items",
      "Inga unresolved production items",
      "Inga öppna unresolved production items finns för bolaget.",
    );
  else
    block(
      "operations",
      "unresolved_items",
      "Unresolved production items finns",
      `${unresolvedItems} unresolved production items måste hanteras.`,
    );
  if (failedMessages === 0)
    pass(
      "operations",
      "no_failed_messages",
      "Inga failed production sends",
      "Inga failed outbound production messages finns.",
    );
  else
    block(
      "operations",
      "failed_messages",
      "Failed production sends finns",
      `${failedMessages} failed outbound production messages blockerar go-live.`,
    );
  if (negativeAperaks === 0)
    pass(
      "operations",
      "no_negative_aperaks",
      "Inga negativa APERAK",
      "Inga negativa APERAK i production finns.",
    );
  else
    warn(
      "operations",
      "negative_aperaks",
      "Negativa APERAK finns",
      `${negativeAperaks} negativa APERAK i production bör granskas.`,
    );
  if (!productionLockLocked)
    pass(
      "safety",
      "production_lock_unlocked",
      "Production send lock är upplåst",
      "Production send lock är upplåst.",
    );
  else
    warn(
      "safety",
      "production_lock_active",
      "Production send lock är aktiv",
      "Production send är låst tills activation/resume låser upp.",
    );
  if (
    text(company.ediel_first_live_send_approved_at) ||
    priorProductionSentCount > 0
  )
    pass(
      "safety",
      "first_live_send_ready",
      "Första live-send är godkänd",
      "Första production send är godkänd eller redan genomförd.",
    );
  else
    warn(
      "safety",
      "first_live_send_pending",
      "Första live-send väntar",
      "Första production outbound kräver superadmin-godkännande.",
    );

  const status = deriveProductionReadinessStatus({
    blockingIssues: blocking,
    warnings,
    companyStatus: text(company.status),
    productionStatus: companyProductionStatus,
    productionEnabled,
    liveApprovedAt:
      text(company.live_approved_at) ??
      text(company.ediel_production_enabled_at),
  });
  const score = Math.round(
    (passed.length /
      Math.max(1, passed.length + blocking.length + warnings.length)) *
      100,
  );
  const missingItems = blocking.map((issue) => issue.label);
  const nextActions =
    blocking.length > 0
      ? blocking.slice(0, 5).map((issue) => issue.message)
      : warnings.length > 0
        ? warnings.slice(0, 5).map((issue) => issue.message)
        : ["Kör production dry run och aktivera production med bekräftelse."];
  const latestCheck = latestChecks[0];
  const latestDryRun = dryRuns[0];
  const result: ProductionReadinessResult = {
    companyId,
    status,
    score,
    blockingIssues: blocking,
    warnings,
    passedChecks: passed,
    missingItems,
    nextActions,
    summary: {
      companyName: text(company.name),
      orgNumber: text(company.org_number),
      tenantId: companyId,
      environment: text(company.operating_environment),
      productionEnabled,
      productionLockLocked,
      productionStatus: companyProductionStatus,
      liveApprovedAt:
        text(company.live_approved_at) ??
        text(company.ediel_production_enabled_at),
      edielId: companyEdielId,
      senderSubAddress,
      receiverSubAddress,
      actorRole,
      brpEdielId,
      contactEmail,
      operationsContactEmail,
      activeTestRouteProfileId: testRoute?.id ?? null,
      activeProductionRouteProfileId: productionRoute?.id ?? null,
      activeProductionProdatRouteProfileId: productionProdatRoute?.id ?? null,
      activeProductionUtiltsRouteProfileId: productionUtiltsRoute?.id ?? null,
      hasProductionProdatRoute: Boolean(productionProdatRoute),
      hasProductionUtiltsRoute: Boolean(productionUtiltsRoute),
      productionMailboxId: productionMailbox?.id ?? null,
      latestInbound,
      latestOutbound,
      priorProductionSentCount,
      latestPollAt:
        text(productionMailbox?.last_successful_poll_at) ??
        text(productionMailbox?.last_poll_at) ??
        text(productionMailbox?.last_polled_at),
      latestPollStatus:
        text(productionMailbox?.last_poll_status) ??
        (productionMailbox?.last_error ? "error" : null),
      unresolvedItems,
      failedMessages,
      negativeAperaks,
      firstLiveSendApprovedAt: text(company.ediel_first_live_send_approved_at),
    },
    configurationSnapshot: {
      id: configurationSnapshot.id,
      hash: configurationSnapshot.configuration_hash,
    },
    latestCheck: {
      id: text(latestCheck?.id),
      checkedAt: text(latestCheck?.checked_at),
      checkedBy: text(latestCheck?.checked_by),
    },
    latestDryRun: {
      id: text(latestDryRun?.id),
      status: text(latestDryRun?.to_status),
      createdAt: text(latestDryRun?.created_at),
      metadata:
        latestDryRun?.metadata && typeof latestDryRun.metadata === "object"
          ? (latestDryRun.metadata as Record<string, unknown>)
          : null,
    },
    auditEvents,
  };

  if (options.persist) {
    const { data, error } = await supabaseService
      .from("ediel_production_readiness_checks")
      .insert({
        company_id: companyId,
        status: result.status,
        score: result.score,
        blocking_issues: result.blockingIssues,
        warnings: result.warnings,
        passed_checks: result.passedChecks,
        missing_items: result.missingItems,
        next_actions: result.nextActions,
        readiness_snapshot: result,
        configuration_snapshot_id: configurationSnapshot.id,
        configuration_hash: configurationSnapshot.configuration_hash,
        target_state: 'ediel_production_live',
        is_stale: false,
        stale_reason: null,
        checked_by: options.checkedBy ?? null,
      })
      .select("id,checked_at,checked_by")
      .maybeSingle();

    if (error) throw error
    if (data) {
      result.latestCheck = {
        id: text((data as Record<string, unknown>).id),
        checkedAt: text((data as Record<string, unknown>).checked_at),
        checkedBy: text((data as Record<string, unknown>).checked_by),
      };
    }
  }

  return result;
}
