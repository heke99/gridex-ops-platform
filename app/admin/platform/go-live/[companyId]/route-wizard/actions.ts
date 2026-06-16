"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePlatformAdminActionAccess } from "@/lib/admin/guards";
import { supabaseService } from "@/lib/supabase/service";

type MessageFamily = "PRODAT" | "UTILTS";

const FAMILY_CONFIG: Record<
  MessageFamily,
  {
    routeName: string;
    routeScope: string;
    applicationReference: string;
    defaultMessageVersion: string;
    ackMode: string;
    encryptionMode: "smime" | "none";
    signingMode: "smime" | "none";
    allowUnencryptedProduction: boolean;
    receiverSource: string;
    notes: string;
  }
> = {
  PRODAT: {
    routeName: "PRODAT produktion",
    routeScope: "supplier_switch",
    applicationReference: "PRODAT",
    defaultMessageVersion: "26A",
    ackMode: "contrl_and_aperak",
    encryptionMode: "smime",
    signingMode: "smime",
    allowUnencryptedProduction: false,
    receiverSource: "selected_metering_point_grid_owner",
    notes:
      "PRODAT produktion: receiver löses från kundprocess och verifierad nätägare. Gridex shared mailbox är endast transportkanal.",
  },
  UTILTS: {
    routeName: "UTILTS produktion",
    routeScope: "metering_values",
    applicationReference: "UTILTS",
    defaultMessageVersion: "D97A",
    ackMode: "contrl_and_aperak",
    encryptionMode: "none",
    signingMode: "none",
    allowUnencryptedProduction: true,
    receiverSource: "selected_metering_point_grid_owner",
    notes:
      "UTILTS produktion: mätvärdesflöden och UTILTS_ERR hanteras per tenant, men mottagare löses från kund/anläggning och verifierad nätägare.",
  },
};

function text(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value.length > 0 ? value : null;
}

function normalizeSubAddress(value: string | null): string | null {
  const clean = value?.trim();
  return clean ? clean.toUpperCase() : null;
}

function selectedMessageFamilies(formData: FormData): MessageFamily[] {
  const values = formData
    .getAll("message_family")
    .map((value) => String(value).trim().toUpperCase())
    .filter(Boolean);
  const families = Array.from(
    new Set(
      values.filter((value): value is MessageFamily =>
        ["PRODAT", "UTILTS"].includes(value),
      ),
    ),
  );
  if (families.length === 0) {
    throw new Error("Välj minst PRODAT eller UTILTS för production route.");
  }
  return families;
}

async function assertPlatformCompanyExists(companyId: string): Promise<void> {
  const { data, error } = await supabaseService
    .from("companies")
    .select("id")
    .eq("id", companyId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Bolaget hittades inte eller är inte åtkomligt.");
}

async function getProductionActorSetting(companyId: string): Promise<{
  edielId: string;
  senderSubAddress: string | null;
  actorSettingId: string;
}> {
  const { data, error } = await supabaseService
    .from("ediel_actor_settings")
    .select(
      "id,ediel_id,actor_ediel_id,sender_subaddress,sender_sub_address,is_active",
    )
    .eq("company_id", companyId)
    .eq("environment", "production")
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  const row = data as Record<string, unknown> | null;
  const edielId = String(row?.ediel_id ?? row?.actor_ediel_id ?? "")
    .trim()
    .toUpperCase();
  if (!row || !edielId) {
    throw new Error(
      "Bolaget saknar aktivt production Ediel-ID i ediel_actor_settings. Lägg in Ediel-ID i bolagskortet innan route skapas.",
    );
  }

  return {
    edielId,
    senderSubAddress: normalizeSubAddress(
      String(row.sender_subaddress ?? row.sender_sub_address ?? "").trim() ||
        null,
    ),
    actorSettingId: String(row.id),
  };
}

function defaultDynamicReceiverStrategy(receiverSource: string): string {
  if (receiverSource === "selected_customer_site_grid_owner")
    return "resolve_from_selected_customer_site_grid_owner";
  if (receiverSource === "selected_supplier_switch_grid_owner")
    return "resolve_from_supplier_switch_request";
  if (receiverSource === "selected_data_request_grid_owner")
    return "resolve_from_data_request_context";
  if (receiverSource === "original_inbound_sender")
    return "resolve_from_inbound_unb_sender";
  if (
    receiverSource === "fixed_counterparty" ||
    receiverSource === "manual_superadmin_only"
  )
    return "resolve_from_counterparty_id";
  return "resolve_from_selected_metering_point_grid_owner";
}

async function getSharedProductionMailbox(companyId: string): Promise<{
  targetEmail: string | null;
  mailboxLabel: string | null;
  mailboxId: string | null;
  mode: "shared_platform_mailbox" | "company_specific_mailbox" | "missing";
}> {
  const { data, error } = await supabaseService
    .from("ediel_mailboxes")
    .select("id,company_id,mailbox_name,email_address,environment,is_active")
    .eq("environment", "production")
    .eq("is_active", true)
    .limit(50);

  if (error) {
    console.warn(
      "Production mailbox could not be resolved for route wizard",
      error,
    );
    return {
      targetEmail: null,
      mailboxLabel: null,
      mailboxId: null,
      mode: "missing",
    };
  }

  const rows = Array.isArray(data)
    ? (data as Array<Record<string, unknown>>)
    : [];
  const shared = rows.find((row) => !row.company_id);
  const companyMailbox = rows.find((row) => row.company_id === companyId);
  const chosen = shared ?? companyMailbox ?? null;

  return {
    targetEmail:
      typeof chosen?.email_address === "string" && chosen.email_address.trim()
        ? chosen.email_address.trim()
        : null,
    mailboxLabel:
      typeof chosen?.mailbox_name === "string" && chosen.mailbox_name.trim()
        ? chosen.mailbox_name.trim()
        : null,
    mailboxId: typeof chosen?.id === "string" ? chosen.id : null,
    mode: shared
      ? "shared_platform_mailbox"
      : companyMailbox
        ? "company_specific_mailbox"
        : "missing",
  };
}

function routeMatchesFamily(
  row: Record<string, unknown>,
  family: MessageFamily,
): boolean {
  const messageFamily = String(row.message_family ?? "").toUpperCase();
  const applicationReference = String(
    row.application_reference ?? "",
  ).toUpperCase();
  const metadata =
    row.metadata && typeof row.metadata === "object"
      ? (row.metadata as Record<string, unknown>)
      : {};
  const metadataFamily = String(
    metadata.messageFamily ?? metadata.message_family ?? "",
  ).toUpperCase();
  return (
    messageFamily === family ||
    applicationReference === family ||
    metadataFamily === family
  );
}

async function deactivateExistingProductionFamily(
  companyId: string,
  family: MessageFamily,
  actorUserId: string,
) {
  const { data, error } = await supabaseService
    .from("ediel_route_profiles")
    .select(
      "id,communication_route_id,message_family,application_reference,metadata",
    )
    .eq("company_id", companyId)
    .eq("environment", "production");

  if (error) throw error;
  const rows = Array.isArray(data)
    ? (data as Array<Record<string, unknown>>)
    : [];
  const existing = rows.filter((row) => routeMatchesFamily(row, family));
  const profileIds = existing
    .map((row) => String(row.id ?? "").trim())
    .filter(Boolean);
  const routeIds = existing
    .map((row) => String(row.communication_route_id ?? "").trim())
    .filter(Boolean);

  if (profileIds.length > 0) {
    const { error: updateError } = await supabaseService
      .from("ediel_route_profiles")
      .update({
        is_enabled: false,
        is_active: false,
        production_mode: "superseded",
        updated_by: actorUserId,
        updated_at: new Date().toISOString(),
      })
      .in("id", profileIds);
    if (updateError) throw updateError;
  }

  if (routeIds.length > 0) {
    const { error: updateError } = await supabaseService
      .from("communication_routes")
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .in("id", routeIds);
    if (updateError) throw updateError;
  }
}

function validateProductionRoute(input: {
  family: MessageFamily;
  senderEdielId: string | null;
  receiverEdielId: string | null;
  targetEmail: string | null;
  applicationReference: string | null;
  receiverSource: string | null;
}) {
  const blockers: string[] = [];
  if (!input.senderEdielId) blockers.push("Produktions Ediel-id saknas.");
  const receiverSource =
    input.receiverSource ?? "selected_metering_point_grid_owner";
  const fixedReceiver =
    receiverSource === "fixed_counterparty" ||
    receiverSource === "manual_superadmin_only";
  if (fixedReceiver && !input.receiverEdielId)
    blockers.push(
      "Fast production route kräver mottagarens Ediel-id. Dynamiska nätägarrutter ska istället använda receiver_source = selected_metering_point_grid_owner.",
    );
  if (input.receiverEdielId === "91100")
    blockers.push(
      "91100 är Edielportal/testsystem och får inte användas i production route.",
    );
  if (input.receiverEdielId === "91109")
    blockers.push(
      "91109 är test-BRP/testmotpart och får inte användas i production route.",
    );
  if (!input.targetEmail)
    blockers.push(
      "Gridex shared production mailbox saknas. Lägg upp plattformens production-transport innan Ediel production routes skapas.",
    );
  if (
    ![
      "selected_metering_point_grid_owner",
      "selected_customer_site_grid_owner",
      "selected_supplier_switch_grid_owner",
      "selected_data_request_grid_owner",
      "original_inbound_sender",
      "fixed_counterparty",
      "manual_superadmin_only",
    ].includes(receiverSource)
  )
    blockers.push("Ogiltig receiver_source för production route.");
  if (
    String(input.applicationReference ?? "")
      .toUpperCase()
      .startsWith("23-DDQ")
  )
    blockers.push(
      "Application Reference 23-DDQ är test/portal-referens och får inte användas i production route.",
    );
  if (
    String(input.targetEmail ?? "")
      .toLowerCase()
      .endsWith("@ediel.se")
  )
    blockers.push(
      "Mottagaradressen ser ut som Edielportal/testmiljö. Ange riktig produktionsmailbox.",
    );
  if (input.family === "PRODAT" && input.applicationReference !== "PRODAT")
    blockers.push(
      "PRODAT production route måste använda Application Reference PRODAT.",
    );
  if (input.family === "UTILTS" && input.applicationReference !== "UTILTS")
    blockers.push(
      "UTILTS production route måste använda Application Reference UTILTS.",
    );
  return blockers;
}

export async function createProductionRouteFromWizardAction(
  formData: FormData,
) {
  const admin = await requirePlatformAdminActionAccess();
  const companyId = text(formData, "company_id");
  if (!companyId) throw new Error("Bolag saknas.");
  await assertPlatformCompanyExists(companyId);

  const selectedFamilies = selectedMessageFamilies(formData);
  const [actorSetting, sharedMailbox] = await Promise.all([
    getProductionActorSetting(companyId),
    getSharedProductionMailbox(companyId),
  ]);
  const frontendSenderEdielId =
    text(formData, "sender_ediel_id")?.toUpperCase() ?? null;
  if (frontendSenderEdielId && frontendSenderEdielId !== actorSetting.edielId) {
    throw new Error(
      "Sender Ediel-ID får inte override:as i route-wizard. Ändra bolagets Ediel-ID i bolagskortet först.",
    );
  }

  const senderEdielId = actorSetting.edielId;
  const senderSubAddress =
    normalizeSubAddress(text(formData, "sender_sub_address")) ??
    actorSetting.senderSubAddress;
  const targetEmail = sharedMailbox.targetEmail;
  const mailboxLabel = sharedMailbox.mailboxLabel ?? sharedMailbox.mode;
  const dynamicReceiverStrategy = defaultDynamicReceiverStrategy(
    "selected_metering_point_grid_owner",
  );
  const created: Array<{
    family: MessageFamily;
    routeId: string;
    profileId: string;
  }> = [];

  for (const family of selectedFamilies) {
    const config = FAMILY_CONFIG[family];
    const receiverSource = config.receiverSource;
    const receiverEdielId = null;
    const blockers = validateProductionRoute({
      family,
      senderEdielId,
      receiverEdielId,
      targetEmail,
      applicationReference: config.applicationReference,
      receiverSource,
    });
    const wizardPayload = {
      family,
      senderEdielId,
      actorSettingId: actorSetting.actorSettingId,
      receiverEdielId,
      receiverSource,
      dynamicReceiverStrategy,
      targetEmail,
      mailboxId: sharedMailbox.mailboxId,
      transportMode: sharedMailbox.mode,
      applicationReference: config.applicationReference,
      senderSubAddress,
      receiverSubAddress: null,
      receiverName: null,
      mailbox: mailboxLabel,
      encryptionMode: config.encryptionMode,
      signingMode: config.signingMode,
      smtpHost: null,
      smtpPort: null,
      defaultMessageVersion: config.defaultMessageVersion,
      ackMode: config.ackMode,
    };

    if (blockers.length > 0) {
      try {
        await supabaseService.from("production_route_wizard_runs").insert({
          company_id: companyId,
          status: "blocked",
          blocker_summary: blockers,
          payload: wizardPayload,
          created_by: admin.userId,
        });
      } catch {
        // Optional diagnostics should not hide the blocker from the caller.
      }
      redirect(
        `/admin/platform/go-live/${companyId}/route-wizard?status=blocked&message=${encodeURIComponent(blockers.join(" "))}`,
      );
    }

    await deactivateExistingProductionFamily(companyId, family, admin.userId);

    const { data: route, error: routeError } = await supabaseService
      .from("communication_routes")
      .insert({
        company_id: companyId,
        route_name: config.routeName,
        is_active: true,
        route_scope: config.routeScope,
        route_type: "ediel_partner",
        grid_owner_id: null,
        target_system: "production_ediel",
        endpoint: null,
        target_email: targetEmail,
        auth_config: {},
        supported_payload_version: config.defaultMessageVersion,
        notes: config.notes,
        created_by: admin.userId,
        updated_by: admin.userId,
      })
      .select("id")
      .single();
    if (routeError) throw routeError;
    const routeId = String((route as { id: string }).id);

    const { data: profile, error: profileError } = await supabaseService
      .from("ediel_route_profiles")
      .insert({
        company_id: companyId,
        communication_route_id: routeId,
        actor_setting_id: actorSetting.actorSettingId,
        is_enabled: true,
        sender_ediel_id: senderEdielId,
        sender_name: null,
        sender_sub_address: senderSubAddress,
        receiver_ediel_id: receiverEdielId,
        receiver_source: receiverSource,
        dynamic_receiver_strategy: dynamicReceiverStrategy,
        receiver_name: null,
        receiver_sub_address: null,
        application_reference: config.applicationReference,
        default_message_version: config.defaultMessageVersion,
        default_test_flag: 0,
        default_timezone: 1,
        environment: "production",
        environment_type: "production",
        is_production_route: true,
        production_mode: "shadow",
        message_family: family,
        message_standard: "edifact",
        ack_mode: config.ackMode,
        smtp_host: null,
        smtp_port: null,
        imap_host: null,
        imap_port: null,
        mailbox: mailboxLabel,
        encryption_mode: config.encryptionMode,
        transport_mode: sharedMailbox.mode,
        mailbox_id: sharedMailbox.mailboxId,
        signing_mode: config.signingMode,
        tls_required: true,
        allow_unencrypted_production: config.allowUnencryptedProduction,
        payload_format: "edifact",
        notes: config.notes,
        metadata: {
          receiverResolutionOwner: "system",
          manualReceiverAllowed: false,
          sharedTransportMode: sharedMailbox.mode,
          source: "platform_go_live_route_wizard",
          family,
        },
        created_by: admin.userId,
        updated_by: admin.userId,
      })
      .select("id")
      .single();
    if (profileError) throw profileError;

    created.push({
      family,
      routeId,
      profileId: String((profile as { id: string }).id),
    });
  }

  const primaryProfileId =
    created.find((item) => item.family === "PRODAT")?.profileId ??
    created[0]?.profileId ??
    null;

  const primaryFamily =
    created.find((item) => item.family === "PRODAT")?.family ??
    created[0]?.family ??
    "PRODAT";
  const { error: updateError } = await supabaseService
    .from("companies")
    .update({
      production_ediel_id: senderEdielId,
      production_sender_sub_address: senderSubAddress,
      production_mailbox: targetEmail,
      production_application_reference:
        FAMILY_CONFIG[primaryFamily].applicationReference,
      production_counterparty_ediel_id: null,
      ediel_primary_production_route_profile_id: primaryProfileId,
      live_blocked_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", companyId);
  if (updateError) throw updateError;

  await supabaseService.from("production_route_wizard_runs").insert({
    company_id: companyId,
    status: "created",
    communication_route_id: created[0]?.routeId ?? null,
    ediel_route_profile_id: primaryProfileId,
    blocker_summary: [],
    payload: {
      selectedFamilies,
      senderEdielId,
      senderSubAddress,
      created,
      mailboxId: sharedMailbox.mailboxId,
      targetEmail,
      transportMode: sharedMailbox.mode,
    },
    created_by: admin.userId,
  });

  revalidatePath(`/admin/platform/go-live/${companyId}`);
  revalidatePath(`/admin/platform/go-live/${companyId}/route-wizard`);
  revalidatePath(`/admin/platform/companies/${companyId}/testing`);
  revalidatePath(`/admin/companies/${companyId}`);
  redirect(
    `/admin/platform/go-live/${companyId}/route-wizard?status=created&message=${encodeURIComponent(
      `Production route skapad för ${created.map((item) => item.family).join(" + ")}. Kör readiness och dry run innan live aktiveras.`,
    )}`,
  );
}
