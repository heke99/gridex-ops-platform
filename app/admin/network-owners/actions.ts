"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePlatformAdminActionAccess } from "@/lib/admin/guards";
import { saveGridOwner } from "@/lib/masterdata/db";
import {
  confirmGridOwnerEmptySubaddress,
  runGridOwnerReadinessCompletion,
  runGridOwnerVerificationBackfill,
} from "@/lib/grid-owners/verification";
import { refreshActorCertificateStatuses } from "@/lib/ediel/operations/actorAutoReadiness";
import { importActorRegistryXml } from "@/lib/actor-registry/importActorRegistry";
import { refreshCertificatesForGridOwner } from "@/lib/ediel/certificates/actorCertificateRefresh";
import {
  gridOwnerInputSchema,
  parseCheckbox,
} from "@/lib/masterdata/validators";

function formValue(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  if (typeof value !== "string") return null;
  return value;
}

function requireUuid(value: FormDataEntryValue | null, fieldName: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${fieldName} saknas eller är ogiltig.`);
  }
  return value;
}

function requireMessageFamily(value: FormDataEntryValue | null): "PRODAT" | "UTILTS" {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (normalized !== "PRODAT" && normalized !== "UTILTS") {
    throw new Error("Meddelandetyp måste vara PRODAT eller UTILTS.");
  }
  return normalized;
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
  await runGridOwnerReadinessCompletion("network_owners_save_action");

  revalidatePath("/admin/network-owners");
}

export async function backfillGridOwnerVerificationAction(): Promise<void> {
  await requirePlatformAdminActionAccess();
  await runGridOwnerVerificationBackfill("network_owners_admin_action");
  await runGridOwnerReadinessCompletion("network_owners_admin_action");
  revalidatePath("/admin/network-owners");
}

export async function completeGridOwnerReadinessAction(): Promise<void> {
  await requirePlatformAdminActionAccess();
  await runGridOwnerReadinessCompletion("network_owners_complete_readiness_action");
  revalidatePath("/admin/network-owners");
}

export async function refreshGridOwnerCertificatesAction(): Promise<void> {
  await requirePlatformAdminActionAccess();
  await refreshActorCertificateStatuses("manual_actor_check");
  await runGridOwnerReadinessCompletion("network_owners_certificate_refresh_action");
  revalidatePath("/admin/network-owners");
}


export async function importActorRegistryXmlAction(formData: FormData): Promise<void> {
  const actor = await requirePlatformAdminActionAccess();
  const file = formData.get("actor_registry_xml");
  const forceReprocess = parseCheckbox(formData.get("force_reprocess"));

  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Ladda upp en XML-fil med aktörsregister.");
  }

  const name = file.name || "actor-registry.xml";
  if (!name.toLowerCase().endsWith(".xml")) {
    throw new Error("Filen måste vara en XML-fil.");
  }

  const xml = Buffer.from(await file.arrayBuffer()).toString("utf8");
  await importActorRegistryXml({
    xml,
    sourceFilename: name,
    uploadedBy: actor.userId,
    forceReprocess,
  });

  await runGridOwnerReadinessCompletion("network_owners_actor_registry_import");
  revalidatePath("/admin/network-owners");
  revalidatePath("/admin/ediel/actors");
}

export async function searchGridOwnerCertificateNowAction(formData: FormData): Promise<void> {
  const actor = await requirePlatformAdminActionAccess();
  const gridOwnerId = requireUuid(formData.get("grid_owner_id"), "Nätägare");

  await refreshCertificatesForGridOwner({
    gridOwnerId,
    triggeredBy: "manual",
    requestedBy: actor.userId,
  });
  await runGridOwnerReadinessCompletion("network_owners_manual_certificate_search");

  revalidatePath("/admin/network-owners");
  revalidatePath("/admin/ediel/auto-readiness");
  revalidatePath("/admin/ediel/certificates");
}

export async function confirmEmptyGridOwnerSubaddressAction(formData: FormData): Promise<void> {
  const actor = await requirePlatformAdminActionAccess();
  const gridOwnerId = requireUuid(formData.get("grid_owner_id"), "Nätägare");
  const messageFamily = requireMessageFamily(formData.get("message_family"));
  const note = formValue(formData, "note") || null;

  await confirmGridOwnerEmptySubaddress({
    gridOwnerId,
    messageFamily,
    actorUserId: actor.userId,
    note,
  });

  revalidatePath("/admin/network-owners");
}

export async function acknowledgeGridOwnerReviewsAction(formData: FormData): Promise<void> {
  const actor = await requirePlatformAdminActionAccess();
  const gridOwnerId = requireUuid(formData.get("grid_owner_id"), "Nätägare");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("grid_owner_verification_reviews")
    .update({
      status: "acknowledged",
      metadata: {
        acknowledged_by: actor.userId,
        acknowledged_at: new Date().toISOString(),
        note: "Granskad i nätägarvyn. Blockerande readiness kvarstår tills data kompletteras.",
      },
    })
    .eq("grid_owner_id", gridOwnerId)
    .eq("status", "open");

  if (error) throw error;
  revalidatePath("/admin/network-owners");
}
