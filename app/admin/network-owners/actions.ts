"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePlatformAdminActionAccess } from "@/lib/admin/guards";
import { saveGridOwner } from "@/lib/masterdata/db";
import {
  gridOwnerInputSchema,
  parseCheckbox,
} from "@/lib/masterdata/validators";

function formValue(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  if (typeof value !== "string") return null;
  return value;
}

export async function saveGridOwnerAction(formData: FormData): Promise<void> {
  await requirePlatformAdminActionAccess();

  const supabase = await createSupabaseServerClient();

  const parsed = gridOwnerInputSchema.parse({
    id: formValue(formData, "id") || undefined,
    name: formValue(formData, "name") ?? "",
    owner_code: formValue(formData, "owner_code") ?? "",
    ediel_id: formValue(formData, "ediel_id") || undefined,
    org_number: formValue(formData, "org_number") || undefined,
    environment: formValue(formData, "environment") || "production",
    lifecycle_status: formValue(formData, "lifecycle_status") || "active",
    default_prodat_subaddress:
      formValue(formData, "default_prodat_subaddress") || undefined,
    default_utilts_subaddress:
      formValue(formData, "default_utilts_subaddress") || undefined,
    transport_channel: formValue(formData, "transport_channel") || undefined,
    communication_email:
      formValue(formData, "communication_email") || undefined,
    contact_name: formValue(formData, "contact_name") || undefined,
    email: formValue(formData, "email") || undefined,
    phone: formValue(formData, "phone") || undefined,
    address_line_1: formValue(formData, "address_line_1") || undefined,
    address_line_2: formValue(formData, "address_line_2") || undefined,
    postal_code: formValue(formData, "postal_code") || undefined,
    city: formValue(formData, "city") || undefined,
    country: formValue(formData, "country") || "SE",
    notes: formValue(formData, "notes") || undefined,
    is_active: parseCheckbox(formData.get("is_active")),
  });

  await saveGridOwner(supabase, parsed);

  revalidatePath("/admin/network-owners");
}
