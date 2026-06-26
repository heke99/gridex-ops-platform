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

    const row = {
      grid_owner_id: gridOwnerId,
      company_id: companyId,
      channel_type: channelType,
      email,
      phone,
      label: value(formData, "label"),
      is_enabled: isEnabled,
      is_verified: value(formData, "is_verified") === "on" || value(formData, "is_verified") === "true",
      source: companyId ? "tenant_override" : "platform_default",
      updated_by: userId,
      updated_at: new Date().toISOString(),
    };

    // IMPORTANT: do NOT use a PostgREST on-conflict insert here. The uniqueness is
    // enforced by PARTIAL unique indexes (WHERE company_id IS NULL / IS NOT NULL),
    // which PostgREST cannot target via ON CONFLICT (no inferable constraint) and
    // which raises a runtime "no unique or exclusion constraint matching the ON
    // CONFLICT specification" error. Use an explicit select -> update / insert.
    let existingQuery = supabaseService
      .from("grid_owner_contact_channels")
      .select("id")
      .eq("grid_owner_id", gridOwnerId)
      .eq("channel_type", channelType);
    existingQuery = companyId
      ? existingQuery.eq("company_id", companyId)
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
        .insert({ ...row, created_by: userId });
      if (error) throw error;
    }
  } catch (error) {
    redirectWith(gridOwnerId, "error", error instanceof Error ? error.message : "Kunde inte spara kontaktväg.");
  }

  revalidatePath(`/admin/network-owners/${gridOwnerId}/contact-channels`);
  redirectWith(gridOwnerId, "success", "Kontaktväg sparad.");
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
