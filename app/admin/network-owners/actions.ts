"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePlatformAdminActionAccess } from "@/lib/admin/guards";
import { saveGridOwner } from "@/lib/masterdata/db";
import {
  confirmGridOwnerEmptySubaddress,
  runGridOwnerReadinessCompletion,
  runGridOwnerVerificationBackfill,
} from "@/lib/grid-owners/verification";
import { importActorRegistryXml } from "@/lib/actor-registry/importActorRegistry";
import { refreshCertificatesForGridOwner, refreshScheduledActorCertificates } from "@/lib/ediel/certificates/actorCertificateRefresh";
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

function actionErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return "Åtgärden kunde inte slutföras. Kontrollera audit/logg eller försök igen.";
}

function networkOwnersUrl(params: {
  status?: "success" | "error" | "info";
  message?: string;
  edit?: string | null;
} = {}): string {
  const search = new URLSearchParams();
  if (params.edit) search.set("edit", params.edit);
  if (params.status) search.set("status", params.status);
  if (params.message) search.set("message", params.message.slice(0, 900));
  const query = search.toString();
  return query ? `/admin/network-owners?${query}` : "/admin/network-owners";
}

function redirectToNetworkOwners(params: {
  status?: "success" | "error" | "info";
  message?: string;
  edit?: string | null;
} = {}): never {
  redirect(networkOwnersUrl(params));
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

  let redirectParams: Parameters<typeof redirectToNetworkOwners>[0];

  try {
    const result = await refreshScheduledActorCertificates({ limit: 200 });
    await runGridOwnerReadinessCompletion("network_owners_certificate_refresh_action");
    revalidatePath("/admin/network-owners");
    revalidatePath("/admin/ediel/auto-readiness");
    revalidatePath("/admin/ediel/certificates");

    redirectParams = {
      status: "success",
      message: `Certifikatsökning klar. Bearbetade ${result.processed} aktörer, hittade ${result.found} certifikat, infogade ${result.inserted}, uppdaterade ${result.updated}.`,
    };
  } catch (error) {
    console.error("network_owners_certificate_refresh_action_failed", error);
    redirectParams = {
      status: "error",
      message: `Certifikatsökningen kunde inte slutföras: ${actionErrorMessage(error)}`,
    };
  }

  redirectToNetworkOwners(redirectParams);
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
  let redirectParams: Parameters<typeof redirectToNetworkOwners>[0];

  try {
    const result = await refreshCertificatesForGridOwner({
      gridOwnerId,
      triggeredBy: "manual",
      requestedBy: actor.userId,
    });
    await runGridOwnerReadinessCompletion("network_owners_manual_certificate_search");

    revalidatePath("/admin/network-owners");
    revalidatePath("/admin/ediel/auto-readiness");
    revalidatePath("/admin/ediel/certificates");

    redirectParams = result.skipped
      ? {
          edit: gridOwnerId,
          status: "info",
          message: `Certifikatsökningen hoppades över: ${result.reason ?? "nätägaren saknar säker söknyckel"}.`,
        }
      : {
          edit: gridOwnerId,
          status: result.valid > 0 || result.inserted > 0 || result.updated > 0 ? "success" : "info",
          message: `Certifikatsökning klar för vald nätägare. Hittade ${result.found}, infogade ${result.inserted}, uppdaterade ${result.updated}, giltiga ${result.valid}, utgångna ${result.expired}.`,
        };
  } catch (error) {
    console.error("network_owner_manual_certificate_search_failed", { gridOwnerId, error });
    redirectParams = {
      edit: gridOwnerId,
      status: "error",
      message: `Certifikatsökningen för vald nätägare misslyckades: ${actionErrorMessage(error)}`,
    };
  }

  redirectToNetworkOwners(redirectParams);
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
