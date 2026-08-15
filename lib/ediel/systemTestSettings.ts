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
  setupPackage: string | null;
  actorRole: string | null;
  messageFamily: string | null;
  applicationReference: string | null;
  environmentType: string | null;
  certificateEnvironment: string | null;
  transportEnvironment: string | null;
  smtpProvider: string | null;
  metadata: Record<string, unknown> | null;
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

export type EdielSystemTestSettingsSelector = {
  companyId?: string | null;
  testSuite?: EdielSystemTestSuite | string | null;
  actorRole?: string | null;
  messageFamily?: string | null;
  setupPackage?: string | null;
  environmentType?: string | null;
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

function normalizeActorRole(value: unknown): "supplier" | "esco" | null {
  const role = String(value ?? "").trim().toLowerCase();
  if (role === "supplier" || role === "electricity_supplier") return "supplier";
  if (role === "esco" || role === "energy_service_company") return "esco";
  return null;
}

function databaseActorRole(value: unknown): "supplier" | "energy_service_company" | null {
  const role = normalizeActorRole(value);
  if (role === "supplier") return "supplier";
  if (role === "esco") return "energy_service_company";
  return null;
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

  if (existing.error && !isMissingRelationError(existing.error)) {
    throw existing.error;
  }

  const existingRows = (existing.data ?? []) as Array<{ id?: string | null }>;
  if (existingRows.length > 1) {
    throw new Error(
      "Flera aktiva systemtestmotparter matchar samma tenantidentitet.",
    );
  }
  const existingId = clean(existingRows[0]?.id);

  const payload = {
    company_id: params.companyId,
    environment: "test",
    counterparty_name:
      clean(params.name) ??
      (params.role === "test_portal"
        ? "Edielportalen systemtest"
        : "Test-BRP"),
    name:
      clean(params.name) ??
      (params.role === "test_portal"
        ? "Edielportalen systemtest"
        : "Test-BRP"),
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

function settingsFromRow(
  row: Record<string, unknown>,
  params: {
    companyId: string;
    suite: string;
    portal: Record<string, unknown> | null;
    brp: Record<string, unknown> | null;
  },
): EdielSystemTestSettings {
  const rowMetadata = metadata(row);
  return {
    id: clean(row.id),
    companyId: params.companyId,
    environment: "test",
    testSuite: params.suite as EdielSystemTestSuite,
    testPortalCounterpartyId: clean(row.test_portal_counterparty_id),
    testPortalEdielId: upper(
      params.portal?.ediel_id ?? params.portal?.counterparty_ediel_id,
    ),
    testPortalName: clean(
      params.portal?.name ?? params.portal?.counterparty_name,
    ),
    testPortalEmail: clean(
      params.portal?.email_address ?? params.portal?.email,
    ),
    testBrpCounterpartyId: clean(row.test_brp_counterparty_id),
    testBrpEdielId: upper(params.brp?.ediel_id ?? params.brp?.counterparty_ediel_id),
    testBrpName: clean(params.brp?.name ?? params.brp?.counterparty_name),
    defaultReceiverSubaddress: upper(row.default_receiver_subaddress),
    defaultSenderSubaddress: upper(row.default_sender_subaddress),
    routeProfileId: clean(row.route_profile_id),
    transportProfileId: clean(row.transport_profile_id),
    setupPackage: clean(row.setup_package) ?? clean(rowMetadata.setupPackage),
    actorRole:
      normalizeActorRole(row.actor_role ?? rowMetadata.actorRole) ??
      clean(row.actor_role ?? rowMetadata.actorRole),
    messageFamily: upper(row.message_family ?? rowMetadata.messageFamily),
    applicationReference: upper(
      row.application_reference ?? rowMetadata.applicationReference,
    ),
    environmentType:
      clean(row.environment_type) ?? clean(rowMetadata.environmentType),
    certificateEnvironment:
      clean(row.certificate_environment) ??
      clean(rowMetadata.certificateEnvironment),
    transportEnvironment:
      clean(row.transport_environment) ?? clean(rowMetadata.transportEnvironment),
    smtpProvider: clean(row.smtp_provider) ?? clean(rowMetadata.smtpProvider),
    metadata: rowMetadata,
    isActive: row.is_active !== false,
  };
}

export async function getEdielSystemTestSettings(
  params: EdielSystemTestSettingsSelector,
): Promise<EdielSystemTestSettings | null> {
  const companyId = clean(params.companyId);
  if (!companyId) return null;
  const suite = upper(params.testSuite) ?? "AGT";
  const actorRole = normalizeActorRole(params.actorRole);
  const messageFamily = upper(params.messageFamily);
  const setupPackage = clean(params.setupPackage);
  const environmentType = clean(params.environmentType);

  let query = supabaseService
    .from("ediel_system_test_settings")
    .select("*")
    .eq("company_id", companyId)
    .eq("environment", "test")
    .eq("test_suite", suite)
    .eq("is_active", true);

  if (actorRole) query = query.eq("actor_role", actorRole);
  if (messageFamily) query = query.eq("message_family", messageFamily);
  if (setupPackage) query = query.eq("setup_package", setupPackage);
  if (environmentType) query = query.eq("environment_type", environmentType);

  const { data, error } = await query
    .order("updated_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(3);

  if (error) {
    if (isMissingRelationError(error)) return null;
    throw error;
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  if (rows.length > 1) {
    throw new Error(
      "Flera aktiva systemtestinställningar matchar samma tenant och runtimekontext. Ange roll, meddelandefamilj och testpaket explicit.",
    );
  }
  const row = rows[0] ?? null;
  if (!row) return null;

  const [portal, brp] = await Promise.all([
    findCounterparty(clean(row.test_portal_counterparty_id)),
    findCounterparty(clean(row.test_brp_counterparty_id)),
  ]);

  return settingsFromRow(row, { companyId, suite, portal, brp });
}

async function captureCurrentSnapshot(params: {
  companyId: string;
  actorUserId: string;
  reason: string;
}): Promise<string> {
  const { data, error } = await supabaseService.rpc(
    "canonical_capture_ediel_configuration_snapshot",
    {
      p_company_id: params.companyId,
      p_actor_user_id: params.actorUserId,
      p_reason: params.reason,
    },
  );
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  const snapshotId = clean(
    row && typeof row === "object"
      ? (row as Record<string, unknown>).id
      : null,
  );
  if (!snapshotId) {
    throw new Error("Kunde inte fånga aktuell Ediel-konfigurationssnapshot.");
  }
  return snapshotId;
}

async function activateCanonicalTestConfiguration(params: {
  companyId: string;
  actorUserId: string;
  logicalSuite: string;
  actorRole: "supplier" | "esco";
  messageFamily: string;
  setupPackage: string;
  environmentType: string;
  configurationSnapshotId: string;
}) {
  const dbRole = databaseActorRole(params.actorRole);
  if (!dbRole) throw new Error("Ogiltig Ediel-roll för aktiv testkonfiguration.");

  const deactivate = await supabaseService
    .from("ediel_active_test_configurations")
    .update({ status: "inactive", updated_at: new Date().toISOString() })
    .eq("company_id", params.companyId)
    .eq("environment", "test")
    .eq("environment_type", params.environmentType)
    .eq("test_suite", params.messageFamily)
    .eq("actor_role", dbRole)
    .eq("message_family", params.messageFamily)
    .eq("setup_package", params.setupPackage)
    .eq("status", "active");
  if (deactivate.error && !isMissingRelationError(deactivate.error)) {
    throw deactivate.error;
  }

  const { error } = await supabaseService
    .from("ediel_active_test_configurations")
    .insert({
      company_id: params.companyId,
      environment: "test",
      environment_type: params.environmentType,
      test_suite: params.messageFamily,
      actor_role: dbRole,
      message_family: params.messageFamily,
      setup_package: params.setupPackage,
      configuration_snapshot_id: params.configurationSnapshotId,
      status: "active",
      created_by: params.actorUserId,
    });
  if (error) throw error;
}

export async function saveEdielSystemTestSettings(
  input: SaveEdielSystemTestSettingsInput,
): Promise<EdielSystemTestSettings> {
  const companyId = clean(input.companyId);
  const portalEdielId = upper(input.testPortalEdielId);
  if (!companyId) {
    throw new Error("company_id saknas för systemtestinställning.");
  }
  if (!portalEdielId) {
    throw new Error("Systemtestportalens Ediel-ID måste fyllas i.");
  }

  const suite = upper(input.testSuite) ?? "AGT";

  // Compatibility bridge for the legacy supplier-only AGT screen. This is
  // semantic, never tenant-specific: no company id or Gridex Ediel id is baked in.
  const legacySupplierAgt =
    suite === "AGT" &&
    !clean(input.actorRole) &&
    !clean(input.messageFamily) &&
    !clean(input.setupPackage) &&
    !clean(input.environmentType);

  const actorRole =
    normalizeActorRole(input.actorRole) ??
    (legacySupplierAgt ? "supplier" : null);
  const messageFamily =
    upper(input.messageFamily) ?? (legacySupplierAgt ? "PRODAT" : null);
  const setupPackage =
    clean(input.setupPackage) ??
    (legacySupplierAgt ? "agt_ddq_prodat_l" : null);
  const environmentType =
    clean(input.environmentType) ?? (legacySupplierAgt ? "agt_test" : null);

  if (!actorRole || !messageFamily || !setupPackage || !environmentType) {
    throw new Error(
      "Systemtestprofil kräver explicit aktörsroll, meddelandefamilj, setup package och environment type. AGT/TGT ensam är inte en säker runtimeidentitet.",
    );
  }

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

  const deactivate = await supabaseService
    .from("ediel_system_test_settings")
    .update({
      is_active: false,
      updated_by: input.actorUserId,
      updated_at: new Date().toISOString(),
    })
    .eq("company_id", companyId)
    .eq("environment", "test")
    .eq("test_suite", suite)
    .eq("actor_role", actorRole)
    .eq("message_family", messageFamily)
    .eq("setup_package", setupPackage)
    .eq("environment_type", environmentType)
    .eq("is_active", true);
  if (deactivate.error) throw deactivate.error;

  const rowMetadata = {
    ...(input.metadata ?? {}),
    canonicalRuntimeIdentity: {
      logicalSuite: suite,
      actorRole,
      messageFamily,
      setupPackage,
      environmentType,
    },
    setupPackage,
    actorRole,
    messageFamily,
    applicationReference: upper(input.applicationReference),
    environmentType,
    certificateEnvironment: clean(input.certificateEnvironment),
    transportEnvironment: clean(input.transportEnvironment),
    smtpProvider: clean(input.smtpProvider),
  };

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
    setup_package: setupPackage,
    actor_role: actorRole,
    message_family: messageFamily,
    application_reference: upper(input.applicationReference),
    environment_type: environmentType,
    certificate_environment: clean(input.certificateEnvironment),
    transport_environment: clean(input.transportEnvironment),
    smtp_provider: clean(input.smtpProvider),
    metadata: rowMetadata,
    is_active: input.isActive !== false,
    created_by: input.actorUserId,
    updated_by: input.actorUserId,
  };

  const { error } = await supabaseService
    .from("ediel_system_test_settings")
    .insert(payload);
  if (error) throw error;

  const configurationSnapshotId = await captureCurrentSnapshot({
    companyId,
    actorUserId: input.actorUserId,
    reason: `system_test_profile:${suite}:${actorRole}:${messageFamily}:${setupPackage}`,
  });

  await activateCanonicalTestConfiguration({
    companyId,
    actorUserId: input.actorUserId,
    logicalSuite: suite,
    actorRole,
    messageFamily,
    setupPackage,
    environmentType,
    configurationSnapshotId,
  });

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
        actorRole,
        messageFamily,
        setupPackage,
        environmentType,
        testPortalCounterpartyId: portalCounterpartyId,
        testBrpCounterpartyId: brpCounterpartyId,
        routeProfileId: clean(input.routeProfileId),
        transportProfileId: clean(input.transportProfileId),
        applicationReference: upper(input.applicationReference),
        configurationSnapshotId,
      },
      metadata: {
        source: "ediel_system_test_settings",
        multitenantRuntimeIdentity: true,
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
    actorRole,
    messageFamily,
    setupPackage,
    environmentType,
  });
  if (!saved) {
    throw new Error(
      "Systemtestinställningen sparades men kunde inte läsas tillbaka.",
    );
  }
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
    .eq("is_active", true);

  const role = normalizeActorRole(actorRole);
  if (role === "supplier") {
    query = query.or(
      "role.eq.supplier,role.eq.electricity_supplier,actor_role.eq.supplier,actor_role.eq.electricity_supplier",
    );
  } else if (role === "esco") {
    query = query.or(
      "role.eq.esco,role.eq.energy_service_company,actor_role.eq.esco,actor_role.eq.energy_service_company",
    );
  }

  const { data, error } = await query
    .order("updated_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(2);

  if (error) {
    if (isMissingRelationError(error)) return null;
    throw error;
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  if (rows.length > 1) {
    throw new Error(
      "Flera aktiva Ediel-aktörsprofiler matchar samma tenant och aktörsroll.",
    );
  }
  return rows[0] ?? null;
}

export async function getEdielSystemTestRuntimeContext(params: {
  companyId?: string | null;
  testSuite?: EdielSystemTestSuite | string | null;
  actorRole?: string | null;
  messageFamily?: string | null;
  setupPackage?: string | null;
  environmentType?: string | null;
}): Promise<EdielSystemTestRuntimeContext | null> {
  const companyId = clean(params.companyId);
  if (!companyId) return null;

  const suite = (upper(params.testSuite) ?? "TGT") as EdielSystemTestSuite;
  const [settings, actor] = await Promise.all([
    getEdielSystemTestSettings({
      companyId,
      testSuite: suite,
      actorRole: params.actorRole,
      messageFamily: params.messageFamily,
      setupPackage: params.setupPackage,
      environmentType: params.environmentType,
    }),
    getActiveTestActorSetting(companyId, params.actorRole),
  ]);

  const actorEdielId = upper(actor?.actor_ediel_id ?? actor?.ediel_id);
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
  messageFamily?: string | null;
  setupPackage?: string | null;
  environmentType?: string | null;
}): Promise<EdielSystemTestRuntimeContext> {
  const context = await getEdielSystemTestRuntimeContext(params);
  if (!context) {
    throw new Error(
      "Systemtest kräver en aktiv, tenant- och rollscopad testprofil med explicit testpaket, Ediel-aktör och systemtestportal. Konfigurera profilen under Ediel & Go-live innan testet körs.",
    );
  }
  return context;
}
