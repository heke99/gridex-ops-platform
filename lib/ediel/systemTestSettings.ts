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
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing.error) {
    if (!isMissingRelationError(existing.error)) throw existing.error;
  }

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

  if (existing.data?.id) {
    const { error } = await supabaseService
      .from("ediel_counterparties")
      .update(payload)
      .eq("id", existing.data.id);
    if (error) throw error;
    return existing.data.id as string;
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
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isMissingRelationError(error)) return null;
    throw error;
  }

  const row = (data as Record<string, unknown> | null) ?? null;
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
    is_active: input.isActive !== false,
    created_by: input.actorUserId,
    updated_by: input.actorUserId,
  };

  const { error } = await supabaseService
    .from("ediel_system_test_settings")
    .insert(payload);
  if (error) throw error;

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
