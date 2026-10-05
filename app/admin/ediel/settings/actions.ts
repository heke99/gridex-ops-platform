"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdminActionAccess } from "@/lib/admin/guards";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { requireOperationalCompanyId } from "@/lib/tenant/scope";
import { requireCompanyOperationalForWrites } from "@/lib/tenant/governance";
import { formatErrorMessage } from "@/lib/errors";
import { getEdielInstructionSpec } from "@/lib/ediel/specRegistry";

function stringValue(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function intValue(formData: FormData, key: string): number | null {
  const raw = stringValue(formData, key);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function boolValue(formData: FormData, key: string): boolean {
  const value = formData.get(key);
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "on";
}

function uppercaseOrNull(value: string | null): string | null {
  return value ? value.toUpperCase() : null;
}

function normalizeMessageStandard(
  value: string | null,
): "edifact" | "xml" | "ai_list" {
  return value === "xml" || value === "ai_list" ? value : "edifact";
}

function normalizeDirection(
  value: string | null,
): "inbound" | "outbound" | "both" {
  return value === "inbound" || value === "outbound" ? value : "both";
}

async function getActorContext() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Unauthorized");
  }

  const companyId = await requireOperationalCompanyId(user.id);
  await requireCompanyOperationalForWrites(companyId);

  return {
    supabase,
    userId: user.id,
    companyId,
  };
}

async function getAuthenticatedEdielActionContext() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Unauthorized");
  }

  return {
    supabase,
    userId: user.id,
  };
}

function revalidateEdielPaths() {
  revalidatePath("/admin/ediel");
  revalidatePath("/admin/ediel/settings");
  revalidatePath("/admin/ediel/routes");
  revalidatePath("/admin/ediel/control-tower");
  revalidatePath("/admin/ediel/ai-list");
}

export async function saveEdielActorSettingsAction(formData: FormData) {
  await requirePlatformAdminActionAccess();

  const { userId, companyId } = await getActorContext();

  const id = stringValue(formData, "id");
  const environment =
    (stringValue(formData, "environment") as "test" | "production" | null) ??
    "test";
  const isActive = boolValue(formData, "is_active");

  const actorEdielId =
    uppercaseOrNull(stringValue(formData, "actor_ediel_id")) ?? "";
  const actorName = stringValue(formData, "actor_name") ?? "";
  const actorRole = stringValue(formData, "actor_role") ?? "";
  const senderSubAddress = uppercaseOrNull(
    stringValue(formData, "sender_sub_address"),
  );

  const payload = {
    company_id: companyId,
    actor_name: actorName,
    legal_name: actorName,
    actor_ediel_id: actorEdielId,
    ediel_id: actorEdielId,
    actor_role: actorRole,
    role: actorRole,
    market_roles: actorRole ? [actorRole] : [],
    environment,
    is_active: isActive,
    sender_name: stringValue(formData, "sender_name"),
    sender_sub_address: senderSubAddress,
    sender_subaddress: senderSubAddress,
    sender_subaddress_prodat: senderSubAddress,
    sender_subaddress_utilts: senderSubAddress,
    organization_number: stringValue(formData, "organization_number"),
    production_status:
      environment === "production"
        ? stringValue(formData, "production_status")
        : null,
    test_status:
      environment === "test" ? stringValue(formData, "test_status") : null,
    default_transport_channel: stringValue(
      formData,
      "default_transport_channel",
    ),
    default_application_reference: uppercaseOrNull(
      stringValue(formData, "default_application_reference"),
    ),
    default_timezone: intValue(formData, "default_timezone") ?? 1,
    default_charset:
      uppercaseOrNull(stringValue(formData, "default_charset")) ?? "UNOC",
    default_test_flag: intValue(formData, "default_test_flag") === 0 ? 0 : 1,
    smtp_from_email: stringValue(formData, "smtp_from_email"),
    smtp_reply_to_email: stringValue(formData, "smtp_reply_to_email"),
    mailbox: stringValue(formData, "mailbox"),
    notes: stringValue(formData, "notes"),
    updated_by: userId,
  };

  if (!payload.actor_name || !payload.actor_ediel_id || !payload.actor_role) {
    throw new Error(
      "actor_name, actor_ediel_id och actor_role måste fyllas i.",
    );
  }

  if (
    environment === "production" &&
    ["91100", "91109"].includes(payload.actor_ediel_id)
  ) {
    throw new Error(
      "91100 och 91109 är test-/systemtest-ID och får inte sparas som production Ediel-ID för ett bolag.",
    );
  }

  const command = {
    company_id: companyId,
    company_name: actorName,
    organization_number: payload.organization_number,
    actor_role: actorRole,
    [`${environment}_profile_id`]: id,
    [`${environment}_actor_name`]: actorName,
    [`${environment}_sender_name`]: payload.sender_name,
    [`${environment}_ediel_id`]: actorEdielId,
    [`${environment}_sender_sub_address`]: senderSubAddress,
    [`${environment}_sender_subaddress_prodat`]: senderSubAddress,
    [`${environment}_sender_subaddress_utilts`]: senderSubAddress,
    [`${environment}_application_reference`]: payload.default_application_reference,
    [`${environment}_mailbox`]: payload.mailbox,
    [`${environment}_is_active`]: isActive,
    [`${environment}_organization_number`]: payload.organization_number,
    [`${environment}_production_status`]: payload.production_status,
    [`${environment}_test_status`]: payload.test_status,
    [`${environment}_default_transport_channel`]: payload.default_transport_channel,
    [`${environment}_default_timezone`]: payload.default_timezone,
    [`${environment}_default_charset`]: payload.default_charset,
    [`${environment}_default_test_flag`]: payload.default_test_flag,
    [`${environment}_smtp_reply_to_email`]: payload.smtp_reply_to_email,
    [`${environment}_notes`]: payload.notes,
    smtp_from_email: payload.smtp_from_email,
    actor_user_id: userId,
    idempotency_key: `ediel-settings-profile:${companyId}:${environment}:${crypto.randomUUID()}`,
  };
  const { error } = await supabaseService.rpc("canonical_save_ediel_actor_profile", {
    p_command: command,
  });
  if (error) throw error;

  revalidateEdielPaths();
}

export async function saveEdielMessageRuleAction(formData: FormData) {
  await requirePlatformAdminActionAccess();

  const { supabase, userId } = await getAuthenticatedEdielActionContext();

  const id = stringValue(formData, "id");
  const messageFamily =
    uppercaseOrNull(stringValue(formData, "message_family")) ?? "";
  const messageCode =
    uppercaseOrNull(stringValue(formData, "message_code")) ?? "";
  const versionCode = stringValue(formData, "version_code") ?? "";
  const validFrom = stringValue(formData, "valid_from");
  const validTo = stringValue(formData, "valid_to");

  if (!messageFamily || !messageCode || !versionCode) {
    throw new Error(
      "message_family, message_code och version_code måste fyllas i.",
    );
  }

  if (validFrom && validTo && validFrom > validTo) {
    throw new Error("valid_from kan inte vara senare än valid_to.");
  }

  const payload = {
    message_family: messageFamily,
    message_code: messageCode,
    message_standard: normalizeMessageStandard(
      stringValue(formData, "message_standard"),
    ),
    version_code: versionCode,
    direction: normalizeDirection(stringValue(formData, "direction")),
    requires_contrl: boolValue(formData, "requires_contrl"),
    requires_aperak: boolValue(formData, "requires_aperak"),
    supports_negative_response: boolValue(
      formData,
      "supports_negative_response",
    ),
    is_active: boolValue(formData, "is_active"),
    valid_from: validFrom,
    valid_to: validTo,
    notes: stringValue(formData, "notes"),
    updated_by: userId,
  };

  if (id) {
    const { error } = await supabase
      .from("ediel_message_rules")
      .update(payload)
      .eq("id", id);

    if (error) throw error;
  } else {
    const { error } = await supabase.from("ediel_message_rules").insert({
      ...payload,
      created_by: userId,
    });

    if (error) throw error;
  }

  revalidateEdielPaths();
}

type TemplateRuleInput = {
  message_family: string;
  message_code: string;
  message_standard: "edifact" | "xml" | "ai_list";
  version_code: string;
  direction: "inbound" | "outbound" | "both";
  requires_contrl: boolean;
  requires_aperak: boolean;
  supports_negative_response: boolean;
  valid_from: string | null;
  valid_to: string | null;
  is_active: boolean;
  notes: string | null;
};

export type EdielTemplateActionState = {
  ok: boolean;
  template: string | null;
  message: string;
  createdCount: number;
  skippedCount: number;
  createdRules: string[];
  skippedRules: string[];
  error?: string;
};

function ruleIdentity(
  rule: Pick<
    TemplateRuleInput,
    | "message_family"
    | "message_code"
    | "message_standard"
    | "version_code"
    | "direction"
  >,
): string {
  return `${rule.message_family} ${rule.message_code} · ${rule.version_code} · ${rule.direction} · ${rule.message_standard}`;
}

async function ensureRuleExists(params: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  userId: string;
  rule: TemplateRuleInput;
}): Promise<"created" | "skipped"> {
  const { supabase, userId, rule } = params;

  const { data, error } = await supabase
    .from("ediel_message_rules")
    .select("id")
    .eq("message_family", rule.message_family)
    .eq("message_code", rule.message_code)
    .eq("message_standard", rule.message_standard)
    .eq("version_code", rule.version_code)
    .eq("direction", rule.direction)
    .limit(1);

  if (error) throw error;

  if ((data ?? []).length > 0) {
    return "skipped";
  }

  const { error: insertError } = await supabase
    .from("ediel_message_rules")
    .insert({
      ...rule,
      created_by: userId,
      updated_by: userId,
    });

  if (insertError) throw insertError;
  return "created";
}

function canonicalTemplateRule(params: {
  family: string;
  code: string;
  standard: "edifact" | "xml" | "ai_list";
  validFrom: string | null;
  validTo: string | null;
  notes: string;
}): TemplateRuleInput {
  const spec = getEdielInstructionSpec({
    family: params.family,
    code: params.code,
    standard: params.standard,
  });
  if (!spec) {
    throw new Error(`canonical_ediel_instruction_spec_missing:${params.family}:${params.code}`);
  }

  return {
    message_family: params.family,
    message_code: params.code,
    message_standard: params.standard,
    version_code: spec.currentVersion,
    direction: spec.direction,
    requires_contrl: spec.requiresContrl,
    requires_aperak: spec.requiresAperak,
    supports_negative_response: spec.supportsNegativeResponse,
    valid_from: params.validFrom ?? spec.validFrom,
    valid_to: params.validTo,
    is_active: true,
    notes: params.notes,
  };
}

async function buildTemplateRules(params: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  template: string;
  validFrom: string | null;
  validTo: string | null;
}): Promise<TemplateRuleInput[]> {
  const { template, validFrom, validTo } = params;
  const templateRules: TemplateRuleInput[] = [];

  const add = (
    family: string,
    code: string,
    standard: "edifact" | "xml" | "ai_list",
    notes: string,
  ) => {
    templateRules.push(
      canonicalTemplateRule({ family, code, standard, validFrom, validTo, notes }),
    );
  };

  if (template === "ack_core") {
    add("CONTRL", "CONTRL", "edifact", "Auto-created from ACK core template");
    add("APERAK", "APERAK", "edifact", "Auto-created from ACK core template");
  }

  if (template === "meter_values_request") {
    for (const code of ["E66", "E73", "S02"] as const) {
      add("UTILTS", code, "edifact", "Auto-created from meter values request template");
    }
    add("CONTRL", "CONTRL", "edifact", "Auto-created from meter values request template");
    add("APERAK", "APERAK", "edifact", "Auto-created from meter values request template");
  }

  if (template === "supplier_switch") {
    for (const code of ["Z03", "Z05", "Z09"] as const) {
      add("PRODAT", code, "edifact", "Auto-created from supplier switch template");
    }
    add("CONTRL", "CONTRL", "edifact", "Auto-created from supplier switch template");
    add("APERAK", "APERAK", "edifact", "Auto-created from supplier switch template");
  }

  if (template === "ai_list_control") {
    add("AI_LIST", "AI", "ai_list", "Auto-created from AI list control template");
    add("AI_LIST", "BI", "ai_list", "Auto-created from AI list control template");
  }

  if (templateRules.length === 0) {
    throw new Error("Okänd mall.");
  }

  return templateRules;
}

export async function applyEdielRuleTemplateAction(
  _previousState: EdielTemplateActionState,
  formData: FormData,
): Promise<EdielTemplateActionState> {
  try {
    await requirePlatformAdminActionAccess();

    const { supabase, userId } = await getAuthenticatedEdielActionContext();
    const template = stringValue(formData, "template");

    if (!template) {
      throw new Error("Mall saknas.");
    }

    const validFrom = stringValue(formData, "valid_from");
    const validTo = stringValue(formData, "valid_to");

    if (validFrom && validTo && validFrom > validTo) {
      throw new Error("valid_from kan inte vara senare än valid_to.");
    }

    const templateRules = await buildTemplateRules({
      supabase,
      template,
      validFrom,
      validTo,
    });

    const createdRules: string[] = [];
    const skippedRules: string[] = [];

    for (const rule of templateRules) {
      const outcome = await ensureRuleExists({
        supabase,
        userId,
        rule,
      });

      if (outcome === "created") {
        createdRules.push(ruleIdentity(rule));
      } else {
        skippedRules.push(ruleIdentity(rule));
      }
    }

    revalidateEdielPaths();

    const createdCount = createdRules.length;
    const skippedCount = skippedRules.length;
    const message =
      createdCount > 0
        ? `${createdCount} regler skapades${skippedCount > 0 ? `, ${skippedCount} fanns redan` : ""}.`
        : `Inga nya regler skapades. ${skippedCount} fanns redan.`;

    return {
      ok: true,
      template,
      message,
      createdCount,
      skippedCount,
      createdRules,
      skippedRules,
    };
  } catch (error) {
    return {
      ok: false,
      template: stringValue(formData, "template"),
      message: "Kunde inte skapa mall.",
      createdCount: 0,
      skippedCount: 0,
      createdRules: [],
      skippedRules: [],
      error: formatErrorMessage(error, "Okänt fel"),
    };
  }
}
