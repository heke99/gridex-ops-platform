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

    const companyIdRaw = value(formData, "company_id");
    const companyId = companyIdRaw && UUID_RE.test(companyIdRaw) ? companyIdRaw : null;

    const row = {
      grid_owner_id: gridOwnerId,
      company_id: companyId,
      channel_type: channelType,
      email,
      phone,
      label: value(formData, "label"),
      is_enabled: value(formData, "is_enabled") === "on" || value(formData, "is_enabled") === "true",
      is_verified: value(formData, "is_verified") === "on" || value(formData, "is_verified") === "true",
      source: companyId ? "tenant_override" : "platform_default",
      updated_by: userId,
      updated_at: new Date().toISOString(),
    };

    const onConflict = companyId ? "company_id,grid_owner_id,channel_type" : "grid_owner_id,channel_type";
    const { error } = await supabaseService
      .from("grid_owner_contact_channels")
      .upsert({ ...row, created_by: userId }, { onConflict });
    if (error) throw error;
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
