import { supabaseService } from "@/lib/supabase/service";

export type EdielSystemTestSuite =
  | "AGT"
  | "TGT"
  | "PRODAT"
  | "UTILTS"
  | "NBS"
  | "AI_LIST"
  | "OTHER";

export type EdielSystemTestSettings = {
  id: string | null;
  companyId: string | null;
  environment: "test";
  testSuite: EdielSystemTestSuite;
  testPortalCounterpartyId: string | null;
  testPortalEdielId: string | null;
  testPortalName: string | null;
  testPortalEmail: string | null;
  testBrpCounterpartyId: string | null;
  testBrpEdielId: string | null;
  testBrpName: string | null;
  defaultReceiverSubaddress: string | null;
  defaultSenderSubaddress: string | null;
  routeProfileId: string | null;
  transportProfileId: string | null;
  setupPackage?: string | null;
  actorRole?: string | null;
  messageFamily?: string | null;
  applicationReference?: string | null;
  environmentType?: string | null;
  certificateEnvironment?: string | null;
  transportEnvironment?: string | null;
  smtpProvider?: string | null;
  metadata?: Record<string, unknown> | null;
  isActive: boolean;
};

export type SaveEdielSystemTestSettingsInput = {
  companyId: string;
  actorUserId: string;
  testSuite: EdielSystemTestSuite;
  testPortalEdielId: string;
  testPortalName?: string | null;
  testPortalEmail?: string | null;
  testBrpEdielId?: string | null;
  testBrpName?: string | null;
  defaultReceiverSubaddress?: string | null;
  defaultSenderSubaddress?: string | null;
  routeProfileId?: string | null;
  transportProfileId?: string | null;
  setupPackage?: string | null;
  actorRole?: string | null;
  messageFamily?: string | null;
  applicationReference?: string | null;
  environmentType?: string | null;
  certificateEnvironment?: string | null;
  transportEnvironment?: string | null;
  smtpProvider?: string | null;
  metadata?: Record<string, unknown> | null;
  isActive?: boolean;
};

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function upper(value: unknown): string | null {
  const normalized = clean(value)?.toUpperCase() ?? null;
  return normalized && normalized.length > 0 ? normalized : null;
}

function metadata(row: Record<string, unknown>): Record<string, unknown> {
  const value = row.metadata;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isMissingRelationError(error: unknown): boolean {
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  return code === "42P01" || code === "42703" || code === "PGRST204";
}

async function findCounterparty(
  id?: string | null,
): Promise<Record<string, unknown> | null> {
  if (!id) return null;
  const { data, error } = await supabaseService
    .from("ediel_counterparties")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (isMissingRelationError(error)) return null;
    throw error;
  }
  return (data as Record<string, unknown> | null) ?? null;
}

async function upsertTestCounterparty(params: {
  companyId: string;
  actorUserId: string;
  role: "test_portal" | "brp";
  name: string;
  edielId: string;
  email?: string | null;
}): Promise<string> {
  const edielId = upper(params.edielId);
  if (!edielId) throw new Error("Ediel-ID saknas för systemtestmotpart.");

  const existing = await supabaseService
    .from("ediel_counterparties")
    .select("id")
    .eq("company_id", params.companyId)
    .eq("environment", "test")
    .eq("counterparty_role", params.role)
    .eq("counterparty_ediel_id", edielId)
    .order("id", { ascending: true })
    .limit(2);

  if (existing.error) {
    if (!isMissingRelationError(existing.error)) throw existing.error;
  }
  const existingRows = (existing.data ?? []) as Array<{ id?: string | null }>;
  if (existingRows.length > 1) throw new Error("Flera aktiva systemtestmotparter matchar samma tenantidentitet.");
  const existingId = clean(existingRows[0]?.id);

  const payload = {
    company_id: params.companyId,
    environment: "test",
    counterparty_name:
      clean(params.name) ??
      (params.role === "test_portal" ? "Edielportalen systemtest" : "Test-BRP"),
    name:
      clean(params.name) ??
      (params.role === "test_portal" ? "Edielportalen systemtest" : "Test-BRP"),
    counterparty_ediel_id: edielId,
    ediel_id: edielId,
    counterparty_role: params.role,
    role: params.role,
    email: clean(params.email),
    email_address: clean(params.email),
    lifecycle_status: "active",
    is_active: true,
    metadata: {
      managedBy: "ediel_system_test_settings",
      systemTest: true,
      role: params.role,
    },
    updated_by: params.actorUserId,
    updated_at: new Date().toISOString(),
  };

  if (existingId) {
    const { error } = await supabaseService
      .from("ediel_counterparties")
      .update(payload)
      .eq("id", existingId);
    if (error) throw error;
    return existingId;
  }

  const { data, error } = await supabaseService
    .from("ediel_counterparties")
    .insert({ ...payload, created_by: params.actorUserId })
    .select("id")
    .maybeSingle();
  if (error) throw error;
  const id = clean((data as { id?: string } | null)?.id);
  if (!id) throw new Error("Kunde inte spara systemtestmotpart.");
  return id;
}

export async function getEdielSystemTestSettings(params: {
  companyId?: string | null;
  testSuite?: EdielSystemTestSuite | string | null;
}): Promise<EdielSystemTestSettings | null> {
  const companyId = clean(params.companyId);
  if (!companyId) return null;
  const suite = upper(params.testSuite) ?? "AGT";

  const { data, error } = await supabaseService
    .from("ediel_system_test_settings")
    .select("*")
    .eq("company_id", companyId)
    .eq("environment", "test")
    .eq("test_suite", suite)
    .eq("is_active", true)
    .order("id", { ascending: true })
    .limit(2);

  if (error) {
    if (isMissingRelationError(error)) return null;
    throw error;
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  if (rows.length > 1) throw new Error("Flera aktiva systemtestinställningar finns för samma tenant och suite.");
  const row = rows[0] ?? null;
  if (!row) return null;

  const [portal, brp] = await Promise.all([
    findCounterparty(clean(row.test_portal_counterparty_id)),
    findCounterparty(clean(row.test_brp_counterparty_id)),
  ]);

  return {
    id: clean(row.id),
    companyId,
    environment: "test",
    testSuite: (suite as EdielSystemTestSuite) ?? "AGT",
    testPortalCounterpartyId: clean(row.test_portal_counterparty_id),
    testPortalEdielId: upper(portal?.ediel_id ?? portal?.counterparty_ediel_id),
    testPortalName: clean(portal?.name ?? portal?.counterparty_name),
    testPortalEmail: clean(portal?.email_address ?? portal?.email),
    testBrpCounterpartyId: clean(row.test_brp_counterparty_id),
    testBrpEdielId: upper(brp?.ediel_id ?? brp?.counterparty_ediel_id),
    testBrpName: clean(brp?.name ?? brp?.counterparty_name),
    defaultReceiverSubaddress: upper(row.default_receiver_subaddress),
    defaultSenderSubaddress: upper(row.default_sender_subaddress),
    routeProfileId: clean(row.route_profile_id),
    transportProfileId: clean(row.transport_profile_id),
    setupPackage: clean(row.setup_package) ?? clean(metadata(row).setupPackage),
    actorRole: clean(row.actor_role) ?? clean(metadata(row).actorRole),
    messageFamily: upper(row.message_family ?? metadata(row).messageFamily),
    applicationReference: upper(row.application_reference ?? metadata(row).applicationReference),
    environmentType: clean(row.environment_type) ?? clean(metadata(row).environmentType),
    certificateEnvironment: clean(row.certificate_environment) ?? clean(metadata(row).certificateEnvironment),
    transportEnvironment: clean(row.transport_environment) ?? clean(metadata(row).transportEnvironment),
    smtpProvider: clean(row.smtp_provider) ?? clean(metadata(row).smtpProvider),
    metadata: metadata(row),
    isActive: row.is_active !== false,
  };
}

export async function saveEdielSystemTestSettings(
  input: SaveEdielSystemTestSettingsInput,
): Promise<EdielSystemTestSettings> {
  const companyId = clean(input.companyId);
  const portalEdielId = upper(input.testPortalEdielId);
  if (!companyId)
    throw new Error("company_id saknas för systemtestinställning.");
  if (!portalEdielId)
    throw new Error("Systemtestportalens Ediel-ID måste fyllas i.");

  const portalCounterpartyId = await upsertTestCounterparty({
    companyId,
    actorUserId: input.actorUserId,
    role: "test_portal",
    edielId: portalEdielId,
    name: input.testPortalName ?? "Edielportalen systemtest",
    email: input.testPortalEmail,
  });

  const brpEdielId = upper(input.testBrpEdielId);
  const brpCounterpartyId = brpEdielId
    ? await upsertTestCounterparty({
        companyId,
        actorUserId: input.actorUserId,
        role: "brp",
        edielId: brpEdielId,
        name: input.testBrpName ?? "Test-BRP",
      })
    : null;

  const suite = upper(input.testSuite) ?? "AGT";

  await supabaseService
    .from("ediel_system_test_settings")
    .update({
      is_active: false,
      updated_by: input.actorUserId,
      updated_at: new Date().toISOString(),
    })
    .eq("company_id", companyId)
    .eq("environment", "test")
    .eq("test_suite", suite)
    .eq("is_active", true);

  const payload = {
    company_id: companyId,
    environment: "test",
    test_suite: suite,
    test_portal_counterparty_id: portalCounterpartyId,
    test_brp_counterparty_id: brpCounterpartyId,
    default_receiver_subaddress: upper(input.defaultReceiverSubaddress),
    default_sender_subaddress: upper(input.defaultSenderSubaddress),
    route_profile_id: clean(input.routeProfileId),
    transport_profile_id: clean(input.transportProfileId),
    setup_package: clean(input.setupPackage),
    actor_role: clean(input.actorRole),
    message_family: upper(input.messageFamily),
    application_reference: upper(input.applicationReference),
    environment_type: clean(input.environmentType),
    certificate_environment: clean(input.certificateEnvironment),
    transport_environment: clean(input.transportEnvironment),
    smtp_provider: clean(input.smtpProvider),
    metadata: {
      ...(input.metadata ?? {}),
      setupPackage: clean(input.setupPackage),
      actorRole: clean(input.actorRole),
      messageFamily: upper(input.messageFamily),
      applicationReference: upper(input.applicationReference),
      environmentType: clean(input.environmentType),
      certificateEnvironment: clean(input.certificateEnvironment),
      transportEnvironment: clean(input.transportEnvironment),
      smtpProvider: clean(input.smtpProvider),
    },
    is_active: input.isActive !== false,
    created_by: input.actorUserId,
    updated_by: input.actorUserId,
  };

  const { error } = await supabaseService
    .from("ediel_system_test_settings")
    .insert(payload);
  if (error) throw error;

  await supabaseService
    .from("audit_logs")
    .insert({
      company_id: companyId,
      actor_user_id: input.actorUserId,
      action: "ediel.system_test_settings.updated",
      entity_type: "ediel_system_test_settings",
      entity_id: companyId,
      new_values: {
        testSuite: suite,
        testPortalCounterpartyId: portalCounterpartyId,
        testBrpCounterpartyId: brpCounterpartyId,
        defaultReceiverSubaddress: upper(input.defaultReceiverSubaddress),
        defaultSenderSubaddress: upper(input.defaultSenderSubaddress),
        routeProfileId: clean(input.routeProfileId),
        transportProfileId: clean(input.transportProfileId),
        setupPackage: clean(input.setupPackage),
        actorRole: clean(input.actorRole),
        messageFamily: upper(input.messageFamily),
        applicationReference: upper(input.applicationReference),
        environmentType: clean(input.environmentType),
        certificateEnvironment: clean(input.certificateEnvironment),
        transportEnvironment: clean(input.transportEnvironment),
        smtpProvider: clean(input.smtpProvider),
      },
      metadata: {
        source: "ediel_system_test_settings",
      },
    })
    .then((result: { error?: { code?: string } | null }) => {
      const auditError = result.error ?? null;
      if (
        auditError &&
        auditError.code !== "42P01" &&
        auditError.code !== "42703"
      ) {
        console.warn(
          "Audit log kunde inte sparas för systemtestinställning",
          auditError,
        );
      }
    });

  const saved = await getEdielSystemTestSettings({
    companyId,
    testSuite: suite,
  });
  if (!saved)
    throw new Error(
      "Systemtestinställningen sparades men kunde inte läsas tillbaka.",
    );
  return saved;
}
export type EdielSystemTestRuntimeContext = {
  companyId: string;
  testSuite: EdielSystemTestSuite;
  actorSettingId: string | null;
  actorEdielId: string;
  actorName: string | null;
  senderSubaddress: string | null;
  testPortalEdielId: string;
  testPortalName: string | null;
  testPortalEmail: string | null;
  defaultReceiverSubaddress: string | null;
  testBrpEdielId: string | null;
  testBrpName: string | null;
  settings: EdielSystemTestSettings | null;
};

async function getActiveTestActorSetting(
  companyId: string,
  actorRole?: string | null,
): Promise<Record<string, unknown> | null> {
  let query = supabaseService
    .from("ediel_actor_settings")
    .select("*")
    .eq("company_id", companyId)
    .eq("environment", "test")
    .eq("is_active", true)

  const role = clean(actorRole);
  if (role) {
    const dbActorRole = role === "esco" ? "energy_service_company" : role;
    query = query.or(`role.eq.${role},actor_role.eq.${dbActorRole}`);
  }

  const { data, error } = await query
    .order("id", { ascending: true })
    .limit(2);

  if (error) {
    if (isMissingRelationError(error)) return null;
    throw error;
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  if (rows.length > 1) throw new Error("Flera aktiva Ediel-aktörsprofiler matchar systemtestkontexten.");
  return rows[0] ?? null;
}

export async function getEdielSystemTestRuntimeContext(params: {
  companyId?: string | null;
  testSuite?: EdielSystemTestSuite | string | null;
  actorRole?: string | null;
}): Promise<EdielSystemTestRuntimeContext | null> {
  const companyId = clean(params.companyId);
  if (!companyId) return null;

  const suite = (upper(params.testSuite) ?? "TGT") as EdielSystemTestSuite;
  const [settings, actor] = await Promise.all([
    getEdielSystemTestSettings({ companyId, testSuite: suite }),
    getActiveTestActorSetting(companyId, params.actorRole),
  ]);

  const actorEdielId = upper(actor?.ediel_id ?? actor?.actor_ediel_id);
  const portalEdielId = upper(settings?.testPortalEdielId);

  if (!actorEdielId || !portalEdielId) return null;

  return {
    companyId,
    testSuite: suite,
    actorSettingId: clean(actor?.id),
    actorEdielId,
    actorName: clean(
      actor?.legal_name ?? actor?.actor_name ?? actor?.sender_name,
    ),
    senderSubaddress: upper(
      settings?.defaultSenderSubaddress ??
        actor?.sender_subaddress_prodat ??
        actor?.sender_subaddress ??
        actor?.sender_sub_address,
    ),
    testPortalEdielId: portalEdielId,
    testPortalName: settings?.testPortalName ?? "Edielportalen systemtest",
    testPortalEmail: settings?.testPortalEmail ?? null,
    defaultReceiverSubaddress: upper(settings?.defaultReceiverSubaddress),
    testBrpEdielId: upper(settings?.testBrpEdielId),
    testBrpName: settings?.testBrpName ?? null,
    settings,
  };
}

export async function requireEdielSystemTestRuntimeContext(params: {
  companyId?: string | null;
  testSuite?: EdielSystemTestSuite | string | null;
  actorRole?: string | null;
}): Promise<EdielSystemTestRuntimeContext> {
  const context = await getEdielSystemTestRuntimeContext(params);
  if (!context) {
    throw new Error(
      "Systemtest/TGT kräver aktiv test-aktör och DB-konfigurerad systemtestportal. Gå till Company → Ediel & Go-live → Testmiljö och spara bolagets Ediel-ID, testportal och eventuell test-BRP först.",
    );
  }
  return context;
}
