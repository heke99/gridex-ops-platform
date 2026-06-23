import { supabaseService } from "@/lib/supabase/service";

export type SenderSettingsEnvironment = "test" | "production" | string;

export type SenderSettingRow = {
  id: string;
  company_id: string;
  environment: string | null;
  ediel_id: string | null;
  actor_ediel_id: string | null;
  role?: string | null;
  actor_role?: string | null;
  market_role?: string | null;
  market_roles?: unknown;
  sender_subaddress?: string | null;
  sender_subaddress_prodat?: string | null;
  sender_subaddress_utilts?: string | null;
  sender_sub_address?: string | null;
  application_reference?: string | null;
  default_application_reference?: string | null;
  is_active?: boolean | null;
  production_send_lock_enabled?: boolean | null;
  first_production_send_approved?: boolean | null;
  mailbox_id?: string | null;
  transport_profile_id?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type SenderSettingsResolution =
  | {
      status: "resolved";
      setting: SenderSettingRow;
      blockerCode: null;
      matches: SenderSettingRow[];
    }
  | {
      status: "missing";
      setting: null;
      blockerCode: "sender_settings_missing";
      matches: SenderSettingRow[];
    }
  | {
      status: "ambiguous";
      setting: null;
      blockerCode: "ambiguous_sender_settings";
      matches: SenderSettingRow[];
    }
  | {
      status: "environment_mismatch";
      setting: null;
      blockerCode: "environment_mismatch";
      matches: SenderSettingRow[];
    }
  | {
      status: "environment_missing";
      setting: null;
      blockerCode: "environment_missing";
      matches: SenderSettingRow[];
    };

export type ResolveSenderSettingsInput = {
  companyId?: string | null;
  environment?: SenderSettingsEnvironment | null;
  actorRole?: string | null;
  marketRole?: string | null;
  messageFamily?: string | null;
  messageCode?: string | null;
  applicationReference?: string | null;
  senderEdielId?: string | null;
  senderSubaddress?: string | null;
  requireProduction?: boolean | null;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function lower(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function upper(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function meta(row: SenderSettingRow): Record<string, unknown> {
  const metadata = row.metadata;
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata
    : {};
}

function roles(row: SenderSettingRow): string[] {
  const out = new Set<string>();
  const add = (value: unknown) => {
    const role = lower(value);
    if (role) out.add(role);
  };
  add(row.role);
  add(row.actor_role);
  add(row.market_role);
  if (Array.isArray(row.market_roles)) row.market_roles.forEach(add);
  const m = meta(row);
  add(m.role);
  add(m.actor_role);
  add(m.market_role);
  if (Array.isArray(m.market_roles)) m.market_roles.forEach(add);
  return [...out];
}

function senderSubaddressFor(
  row: SenderSettingRow,
  family: string,
): string | null {
  if (upper(family) === "PRODAT") {
    return (
      text(row.sender_subaddress_prodat) ??
      text(row.sender_subaddress) ??
      text(row.sender_sub_address)
    );
  }
  if (upper(family) === "UTILTS") {
    return (
      text(row.sender_subaddress_utilts) ??
      text(row.sender_subaddress) ??
      text(row.sender_sub_address)
    );
  }
  return text(row.sender_subaddress) ?? text(row.sender_sub_address);
}

function familyAllowed(row: SenderSettingRow, family: string): boolean {
  const requested = upper(family);
  if (!requested) return true;
  const m = meta(row);
  const configured = [
    m.message_family,
    m.messageFamily,
    m.supported_message_family,
  ]
    .map(upper)
    .filter(Boolean);
  const configuredList = Array.isArray(m.message_families)
    ? m.message_families.map(upper)
    : [];
  return configured.length === 0 && configuredList.length === 0
    ? true
    : configured.includes(requested) || configuredList.includes(requested);
}

function codeAllowed(row: SenderSettingRow, code: string | null): boolean {
  if (!code) return true;
  const requested = upper(code);
  const m = meta(row);
  const configured = [m.message_code, m.messageCode, m.supported_message_code]
    .map(upper)
    .filter(Boolean);
  const configuredList = Array.isArray(m.message_codes)
    ? m.message_codes.map(upper)
    : [];
  return configured.length === 0 && configuredList.length === 0
    ? true
    : configured.includes(requested) || configuredList.includes(requested);
}

function roleAllowed(
  row: SenderSettingRow,
  input: ResolveSenderSettingsInput,
): boolean {
  const rowRoles = roles(row);
  const requested = [input.actorRole, input.marketRole]
    .map(lower)
    .filter(Boolean);
  const family = upper(input.messageFamily);
  const defaultSupplierRoles = ["supplier", "electricity_supplier"];

  if (requested.length > 0) {
    return (
      rowRoles.length === 0 || requested.some((role) => rowRoles.includes(role))
    );
  }

  if (family === "PRODAT") {
    return (
      rowRoles.length === 0 ||
      defaultSupplierRoles.some((role) => rowRoles.includes(role))
    );
  }

  return true;
}

function applicationReferenceAllowed(
  row: SenderSettingRow,
  value?: string | null,
): boolean {
  const requested = text(value);
  if (!requested) return true;
  const rowRefs = [
    row.application_reference,
    row.default_application_reference,
    meta(row).application_reference,
    meta(row).default_application_reference,
  ]
    .map(text)
    .filter(Boolean);
  return rowRefs.length === 0 || rowRefs.includes(requested);
}

function senderIdAllowed(
  row: SenderSettingRow,
  value?: string | null,
): boolean {
  const requested = text(value);
  if (!requested) return true;
  const rowIds = [
    row.ediel_id,
    row.actor_ediel_id,
    meta(row).sender_ediel_id,
    meta(row).own_ediel_id,
  ]
    .map(text)
    .filter(Boolean);
  return rowIds.includes(requested);
}

function senderSubaddressAllowed(
  row: SenderSettingRow,
  input: ResolveSenderSettingsInput,
): boolean {
  const requested = text(input.senderSubaddress);
  if (!requested) return true;
  return senderSubaddressFor(row, input.messageFamily ?? "") === requested;
}

function score(
  row: SenderSettingRow,
  input: ResolveSenderSettingsInput,
): number {
  let value = 0;
  const m = meta(row);
  if (
    text(input.applicationReference) &&
    applicationReferenceAllowed(row, input.applicationReference)
  )
    value += 8;
  if (text(input.senderEdielId) && senderIdAllowed(row, input.senderEdielId))
    value += 8;
  if (text(input.senderSubaddress) && senderSubaddressAllowed(row, input))
    value += 6;
  if (upper(m.message_family) === upper(input.messageFamily)) value += 5;
  if (upper(m.message_code) === upper(input.messageCode)) value += 5;
  if (roles(row).length > 0) value += 2;
  return value;
}

export async function resolveSenderSettings(
  input: ResolveSenderSettingsInput,
): Promise<SenderSettingsResolution> {
  if (!input.companyId)
    return {
      status: "missing",
      setting: null,
      blockerCode: "sender_settings_missing",
      matches: [],
    };
  // Fail closed: never silently default to "test". A production caller that
  // forgot to pass environment must not accidentally match test actor settings.
  const environment = lower(input.environment);
  if (environment !== "test" && environment !== "production") {
    return {
      status: "environment_missing",
      setting: null,
      blockerCode: "environment_missing",
      matches: [],
    };
  }

  const { data, error } = await supabaseService
    .from("ediel_actor_settings")
    .select("*")
    .eq("company_id", input.companyId)
    .eq("is_active", true)
    .limit(50);
  if (error) throw error;

  const rows = (data ?? []) as SenderSettingRow[];
  const envRows = rows.filter((row) => lower(row.environment) === environment);
  if (rows.length > 0 && envRows.length === 0) {
    return {
      status: "environment_mismatch",
      setting: null,
      blockerCode: "environment_mismatch",
      matches: rows,
    };
  }

  const matches = envRows.filter(
    (row) =>
      roleAllowed(row, input) &&
      familyAllowed(row, input.messageFamily ?? "") &&
      codeAllowed(row, text(input.messageCode)) &&
      applicationReferenceAllowed(row, input.applicationReference) &&
      senderIdAllowed(row, input.senderEdielId) &&
      senderSubaddressAllowed(row, input),
  );

  if (matches.length === 0)
    return {
      status: "missing",
      setting: null,
      blockerCode: "sender_settings_missing",
      matches: [],
    };
  const sorted = [...matches].sort((a, b) => score(b, input) - score(a, input));
  const bestScore = score(sorted[0], input);
  const best = sorted.filter((row) => score(row, input) === bestScore);
  if (best.length !== 1)
    return {
      status: "ambiguous",
      setting: null,
      blockerCode: "ambiguous_sender_settings",
      matches,
    };
  return { status: "resolved", setting: best[0], blockerCode: null, matches };
}

export function senderSettingProductionLockStatus(
  setting: SenderSettingRow | null,
  environment?: string | null,
): "locked" | "approved" | "not_applicable" {
  if (!setting || lower(environment) !== "production") return "not_applicable";
  return setting.production_send_lock_enabled === true &&
    setting.first_production_send_approved !== true
    ? "locked"
    : "approved";
}
