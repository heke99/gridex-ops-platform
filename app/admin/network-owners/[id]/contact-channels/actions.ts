"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePlatformAdminActionAccess } from "@/lib/admin/guards";
import { supabaseService } from "@/lib/supabase/service";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CHANNEL_TYPES = new Set([
  "facility_information_request",
  "supplier_switch_manual",
  "power_of_attorney",
  "ai_list",
  "escalation",
]);

// Pragmatic e-mail format validation (server-side). The DB has no format check,
// and an invalid recipient must never be selected for sending.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function value(formData: FormData, key: string): string | null {
  const raw = formData.get(key);
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function requireUuid(raw: string | null, field: string): string {
  if (!raw || !UUID_RE.test(raw)) throw new Error(`${field} saknas eller är ogiltig.`);
  return raw;
}

function redirectWith(gridOwnerId: string, status: "success" | "error", message: string): never {
  const params = new URLSearchParams({ status, message });
  redirect(`/admin/network-owners/${gridOwnerId}/contact-channels?${params.toString()}`);
}

type SaveChannelInput = {
  gridOwnerId: string;
  companyId: string | null;
  channelType: string;
  email: string | null;
  phone: string | null;
  label: string | null;
  isEnabled: boolean;
  isVerified: boolean;
  userId: string;
};

// Safe create-or-update for one (grid_owner_id, channel_type, scope) row.
// Uniqueness is enforced by PARTIAL unique indexes (WHERE company_id IS NULL /
// IS NOT NULL) which PostgREST cannot target via ON CONFLICT. We therefore do an
// explicit select -> update / insert and NEVER an unsafe upsert. Existing rows
// for a channel are updated in place (one row per channel_type per scope).
async function saveContactChannel(input: SaveChannelInput): Promise<void> {
  const row = {
    grid_owner_id: input.gridOwnerId,
    company_id: input.companyId,
    channel_type: input.channelType,
    email: input.email,
    phone: input.phone,
    label: input.label,
    is_enabled: input.isEnabled,
    is_verified: input.isVerified,
    source: input.companyId ? "tenant_override" : "platform_default",
    updated_by: input.userId,
    updated_at: new Date().toISOString(),
  };

  let existingQuery = supabaseService
    .from("grid_owner_contact_channels")
    .select("id")
    .eq("grid_owner_id", input.gridOwnerId)
    .eq("channel_type", input.channelType);
  existingQuery = input.companyId
    ? existingQuery.eq("company_id", input.companyId)
    : existingQuery.is("company_id", null);
  const existing = await existingQuery.maybeSingle();
  if (existing.error) throw existing.error;

  if (existing.data?.id) {
    const { error } = await supabaseService
      .from("grid_owner_contact_channels")
      .update(row)
      .eq("id", existing.data.id);
    if (error) throw error;
  } else {
    const { error } = await supabaseService
      .from("grid_owner_contact_channels")
      .insert({ ...row, created_by: input.userId });
    if (error) throw error;
  }
}

// Creates or updates a grid-owner contact channel. company_id null = platform
// default (visible to all tenants); company_id set = tenant override.
export async function upsertGridOwnerContactChannelAction(formData: FormData): Promise<void> {
  const { userId } = await requirePlatformAdminActionAccess();
  const gridOwnerId = requireUuid(value(formData, "grid_owner_id"), "Nätägare");

  try {
    const channelType = value(formData, "channel_type") ?? "";
    if (!CHANNEL_TYPES.has(channelType)) throw new Error("Ogiltig kanaltyp.");
    const email = value(formData, "email");
    const phone = value(formData, "phone");
    if (!email && !phone) throw new Error("Ange minst e-post eller telefon.");
    // Validate e-mail format before it can be enabled/selected for sending.
    if (email && !EMAIL_RE.test(email)) throw new Error("Ogiltig e-postadress.");

    const isEnabled = value(formData, "is_enabled") === "on" || value(formData, "is_enabled") === "true";
    // A channel cannot be enabled without a valid e-mail address (manual sends
    // require an e-mail recipient).
    if (isEnabled && !email) throw new Error("Ange en giltig e-postadress innan kontaktvägen aktiveras.");

    const companyIdRaw = value(formData, "company_id");
    const companyId = companyIdRaw && UUID_RE.test(companyIdRaw) ? companyIdRaw : null;

    await saveContactChannel({
      gridOwnerId,
      companyId,
      channelType,
      email,
      phone,
      label: value(formData, "label"),
      isEnabled,
      isVerified: value(formData, "is_verified") === "on" || value(formData, "is_verified") === "true",
      userId,
    });
  } catch (error) {
    redirectWith(gridOwnerId, "error", error instanceof Error ? error.message : "Kunde inte spara kontaktväg.");
  }

  revalidatePath(`/admin/network-owners/${gridOwnerId}/contact-channels`);
  redirectWith(gridOwnerId, "success", "Kontaktväg sparad.");
}

// Saves ONE e-mail to multiple purposes at once. Creates/updates one row per
// selected channel_type using the safe per-channel select -> update / insert.
// Platform defaults require platform admin (enforced); tenant overrides stay
// tenant-scoped via company_id.
export async function saveGridOwnerContactChannelsMultiAction(formData: FormData): Promise<void> {
  const { userId } = await requirePlatformAdminActionAccess();
  const gridOwnerId = requireUuid(value(formData, "grid_owner_id"), "Nätägare");

  try {
    const email = value(formData, "email");
    const phone = value(formData, "phone");
    if (!email && !phone) throw new Error("Ange minst e-post eller telefon.");
    if (email && !EMAIL_RE.test(email)) throw new Error("Ogiltig e-postadress.");

    const isEnabled = value(formData, "is_enabled") === "on" || value(formData, "is_enabled") === "true";
    if (isEnabled && !email) throw new Error("Ange en giltig e-postadress innan kontaktvägarna aktiveras.");

    // Accept either repeated "channel_types" entries or individual checkboxes.
    const selected = new Set(
      formData
        .getAll("channel_types")
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter((entry) => CHANNEL_TYPES.has(entry)),
    );
    for (const channelType of CHANNEL_TYPES) {
      if (value(formData, `channel_type_${channelType}`) === "on") selected.add(channelType);
    }
    if (selected.size === 0) throw new Error("Välj minst ett användningsområde för kontaktvägen.");

    const companyIdRaw = value(formData, "company_id");
    const companyId = companyIdRaw && UUID_RE.test(companyIdRaw) ? companyIdRaw : null;
    const label = value(formData, "label");
    const isVerified = value(formData, "is_verified") === "on" || value(formData, "is_verified") === "true";

    for (const channelType of selected) {
      await saveContactChannel({
        gridOwnerId,
        companyId,
        channelType,
        email,
        phone,
        label,
        isEnabled,
        isVerified,
        userId,
      });
    }
  } catch (error) {
    redirectWith(gridOwnerId, "error", error instanceof Error ? error.message : "Kunde inte spara kontaktvägar.");
  }

  revalidatePath(`/admin/network-owners/${gridOwnerId}/contact-channels`);
  redirectWith(gridOwnerId, "success", "Kontaktvägar sparade.");
}

// Enables/disables an existing channel.
export async function toggleGridOwnerContactChannelAction(formData: FormData): Promise<void> {
  const { userId } = await requirePlatformAdminActionAccess();
  const gridOwnerId = requireUuid(value(formData, "grid_owner_id"), "Nätägare");

  try {
    const channelId = requireUuid(value(formData, "channel_id"), "Kontaktväg");
    const enable = value(formData, "enable") === "true";
    const { error } = await supabaseService
      .from("grid_owner_contact_channels")
      .update({ is_enabled: enable, updated_by: userId, updated_at: new Date().toISOString() })
      .eq("id", channelId)
      .eq("grid_owner_id", gridOwnerId);
    if (error) throw error;
  } catch (error) {
    redirectWith(gridOwnerId, "error", error instanceof Error ? error.message : "Kunde inte uppdatera kontaktväg.");
  }

  revalidatePath(`/admin/network-owners/${gridOwnerId}/contact-channels`);
  redirectWith(gridOwnerId, "success", "Kontaktväg uppdaterad.");
}
