"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { logAdminActionAndUsage } from "@/lib/audit/actionLogger";
import { requireContractPermissionAction } from "@/lib/contracts/permissions";
import { contractLifecycleError, type ContractLifecycleRpcResult } from "@/lib/contracts/lifecycleErrors";
import { archiveContractProduct, deleteContractProduct } from "@/lib/contracts/adminMutations";
import { toSafeContractErrorPersisted } from "@/lib/errors/safeActionErrors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { assertUserCanOperateCompany } from "@/lib/tenant/scope";
import { requireCompanyOperationalForWrites } from "@/lib/tenant/governance";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function redirectBack(
  companyId: string | null,
  params: { success?: string; error?: string },
): never {
  const search = new URLSearchParams();
  if (params.success) search.set("success", params.success);
  if (params.error) search.set("error", params.error);
  redirect(
    `/admin/companies/${companyId ?? ""}${search.size ? `?${search.toString()}` : ""}#tenant-avtal`,
  );
}

async function errorMessage(
  error: unknown,
  companyId?: string | null,
  offerId?: string | null,
): Promise<string> {
  let userId: string | null = null;
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch {
    // Error persistence must never mask the original action error.
  }
  return toSafeContractErrorPersisted(error, {
    action: "tenant_canonical_contract_channel",
    companyId,
    userId,
    metadata: { offerId: offerId ?? null },
  });
}

type LifecycleResult = ContractLifecycleRpcResult & {
  already_unpublished?: boolean;
  delete_preview?: unknown;
};

function assertLifecycleResult(result: LifecycleResult | null, fallback: string): LifecycleResult {
  if (result?.ok) return result;
  throw contractLifecycleError(result, fallback);
}

function revalidateContractSurfaces(companyId: string): void {
  revalidatePath(`/admin/companies/${companyId}`);
  revalidatePath("/admin/contracts");
  revalidatePath("/admin/customers/intake");
  revalidatePath("/api/v1/website/public-contracts");
  revalidatePath("/api/v1/website/public-contracts/diagnostics");
  revalidatePath("/api/v1/public/contracts");
  for (const tag of [
    `tenant-contracts:${companyId}`,
    `public-contracts:${companyId}`,
    `quote-contracts:${companyId}`,
    `website-contracts:${companyId}`,
  ]) {
    revalidateTag(tag, "max");
  }
}

async function resolveCanonicalSourceOffer(input: {
  companyId: string;
  sourceOfferId?: string | null;
  publicOfferId?: string | null;
}): Promise<{
  id: string;
  name: string;
  lifecycle_status: string | null;
  contract_product_id: string | null;
  contract_product_version_id: string | null;
}> {
  if (input.sourceOfferId) {
    const { data, error } = await supabaseService
      .from("contract_offers")
      .select(
        "id,name,lifecycle_status,contract_product_id,contract_product_version_id",
      )
      .eq("company_id", input.companyId)
      .eq("id", input.sourceOfferId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Det canonical avtalet hittades inte för bolaget.");
    return data;
  }

  if (!input.publicOfferId) {
    throw new Error("Canonical avtalskälla saknas.");
  }

  const { data: publicOffer, error: publicError } = await supabaseService
    .from("public_contract_offers")
    .select("source_contract_offer_id")
    .eq("company_id", input.companyId)
    .eq("id", input.publicOfferId)
    .maybeSingle();
  if (publicError) throw publicError;
  if (!publicOffer?.source_contract_offer_id) {
    throw new Error(
      "Hemsideavtalet saknar canonical källa. Kör avtalsmigrationen och publicera sedan från Avtalssidan.",
    );
  }

  return resolveCanonicalSourceOffer({
    companyId: input.companyId,
    sourceOfferId: String(publicOffer.source_contract_offer_id),
  });
}

export async function saveTenantPublicContractOfferAction(formData: FormData) {
  const companyId = text(formData, "company_id") || null;
  let success: string;
  try {
    success = (await publishCanonicalWebsiteContractImpl(formData)).success;
  } catch (error) {
    redirectBack(companyId, {
      error: await errorMessage(error, companyId, text(formData, "offer_id")),
    });
  }
  redirectBack(companyId, { success });
}

async function publishCanonicalWebsiteContractImpl(
  formData: FormData,
): Promise<{ success: string }> {
  const companyIdInput = text(formData, "company_id");
  const sourceOfferId = text(formData, "source_contract_offer_id") || null;
  const publicOfferId = text(formData, "id") || null;
  if (!companyIdInput) throw new Error("Bolag saknas.");

  const actor = await requireContractPermissionAction("contracts.publish");
  await requireContractPermissionAction("pricing.publish");
  const companyId = await assertUserCanOperateCompany(
    actor.userId,
    companyIdInput,
  );
  await requireCompanyOperationalForWrites(companyId);

  const source = await resolveCanonicalSourceOffer({
    companyId,
    sourceOfferId,
    publicOfferId,
  });
  if (!(["published", "paused"] as const).includes(source.lifecycle_status as "published" | "paused")) {
    throw new Error(
      "Avtalsversionen måste först vara readiness-godkänd och publicerad eller pausad på Avtalssidan.",
    );
  }
  if (!source.contract_product_id || !source.contract_product_version_id) {
    throw new Error("Avtalsversionen saknar canonical produktkoppling.");
  }

  const { data, error } = await supabaseService.rpc(
    "gridex_publish_contract_channel",
    {
      p_company_id: companyId,
      p_offer_id: source.id,
      p_channel: "website",
      p_actor_user_id: actor.userId,
    },
  );
  if (error) throw error;
  const result = assertLifecycleResult(data as LifecycleResult | null, "Publiceringskommandot returnerade inget giltigt resultat.");
  if (result.changed === false) {
    revalidateContractSurfaces(companyId);
    return { success: `${source.name} var redan publicerad på hemsidan.` };
  }

  await logAdminActionAndUsage({
    companyId,
    actorUserId: actor.userId,
    entityType: "contract_offer",
    entityId: source.id,
    action: "contract.channel.website.published",
    label: "Canonical avtalsversion publicerad på hemsidan",
    oldValues: null,
    newValues: result,
    source: "company_card_contracts_tab",
    billable: false,
    metadata: {
      canonicalCommand: "gridex_publish_contract_channel",
      channel: "website",
      contractProductId: source.contract_product_id,
      contractProductVersionId: source.contract_product_version_id,
    },
  });

  revalidateContractSurfaces(companyId);
  return {
    success: `${source.name} publicerades på hemsidan från samma canonical avtalsversion.`,
  };
}

export async function unpublishTenantPublicContractOfferAction(
  formData: FormData,
) {
  const companyId = text(formData, "company_id") || null;
  let success: string;
  try {
    success = (await unpublishCanonicalWebsiteContractImpl(formData)).success;
  } catch (error) {
    redirectBack(companyId, {
      error: await errorMessage(error, companyId, text(formData, "offer_id")),
    });
  }
  redirectBack(companyId, { success });
}

async function unpublishCanonicalWebsiteContractImpl(
  formData: FormData,
): Promise<{ success: string }> {
  const companyIdInput = text(formData, "company_id");
  const publicOfferId = text(formData, "id") || null;
  const sourceOfferId = text(formData, "source_contract_offer_id") || null;
  if (!companyIdInput) throw new Error("Bolag saknas.");

  const actor = await requireContractPermissionAction("contracts.pause");
  const companyId = await assertUserCanOperateCompany(
    actor.userId,
    companyIdInput,
  );
  const source = await resolveCanonicalSourceOffer({
    companyId,
    sourceOfferId,
    publicOfferId,
  });

  const { data, error } = await supabaseService.rpc(
    "gridex_unpublish_contract_channel",
    {
      p_company_id: companyId,
      p_offer_id: source.id,
      p_channel: "website",
      p_actor_user_id: actor.userId,
    },
  );
  if (error) throw error;
  const result = assertLifecycleResult(data as LifecycleResult | null, "Avpubliceringskommandot returnerade inget giltigt resultat.");
  if (result.changed === false && !result.already_unpublished) {
    throw new Error("Avpubliceringen påverkade inga rader.");
  }

  await logAdminActionAndUsage({
    companyId,
    actorUserId: actor.userId,
    entityType: "contract_offer",
    entityId: source.id,
    action: "contract.channel.website.unpublished",
    label: "Hemsidekanal avpublicerad",
    oldValues: null,
    newValues: result,
    source: "company_card_contracts_tab",
    billable: false,
    metadata: {
      canonicalCommand: "gridex_unpublish_contract_channel",
      channel: "website",
    },
  });

  revalidateContractSurfaces(companyId);
  return {
    success: `${source.name} avpublicerades från hemsidan. Intern kanal och signerad historik behölls.`,
  };
}

export async function deleteTenantPublicContractOfferAction(
  formData: FormData,
) {
  const companyId = text(formData, "company_id") || null;
  let success: string;
  try {
    success = (await removeCanonicalContractImpl(formData)).success;
  } catch (error) {
    redirectBack(companyId, {
      error: await errorMessage(error, companyId, text(formData, "offer_id")),
    });
  }
  redirectBack(companyId, { success });
}

async function removeCanonicalContractImpl(
  formData: FormData,
): Promise<{ success: string }> {
  const companyIdInput = text(formData, "company_id");
  const publicOfferId = text(formData, "id") || null;
  const sourceOfferId = text(formData, "source_contract_offer_id") || null;
  const mode = text(formData, "delete_mode") || "safe_delete";
  if (!companyIdInput) throw new Error("Bolag saknas.");
  if (!['archive', 'safe_delete'].includes(mode)) {
    throw new Error("Ogiltigt raderingsläge.");
  }

  const requiredPermission =
    mode === "archive" ? "contracts.archive" : "contracts.delete_unused";
  const actor = await requireContractPermissionAction(requiredPermission);
  const companyId = await assertUserCanOperateCompany(
    actor.userId,
    companyIdInput,
  );
  const source = await resolveCanonicalSourceOffer({
    companyId,
    sourceOfferId,
    publicOfferId,
  });

  const result = assertLifecycleResult(
    mode === "archive"
      ? await archiveContractProduct({
          companyId,
          offerId: source.id,
          actorUserId: actor.userId,
        })
      : await deleteContractProduct({
          companyId,
          offerId: source.id,
          actorUserId: actor.userId,
          expectedPreviewToken:
            text(formData, "expected_preview_token") || null,
        }),
    "Avtalet kunde inte arkiveras eller raderas.",
  );
  if (!result.mode || result.mode === "blocked") {
    throw contractLifecycleError(result, "Avtalet kunde inte arkiveras eller raderas.");
  }

  await logAdminActionAndUsage({
    companyId,
    actorUserId: actor.userId,
    entityType: "contract_offer",
    entityId: source.id,
    action:
      result.mode === "deleted"
        ? "contract.unused_draft.deleted"
        : "contract.product.archived",
    label:
      result.mode === "deleted"
        ? "Oanvänt canonical avtalsutkast raderat"
        : "Canonical avtalsprodukt arkiverad",
    oldValues: source,
    newValues: result,
    source: "company_card_contracts_tab",
    billable: false,
    metadata: {
      requestedMode: mode,
      canonicalCommand: "gridex_remove_internal_contract_offer_v2",
      deletePreview: result.delete_preview ?? null,
    },
  });

  revalidateContractSurfaces(companyId);
  return {
    success:
      result.mode === "deleted"
        ? "Det oanvända avtalsutkastet och dess exklusiva canonical objekt raderades permanent."
        : "Avtalet hade historik eller låsta versioner och arkiverades därför med all kundhistorik bevarad.",
  };
}
