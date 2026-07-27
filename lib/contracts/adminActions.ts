"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";

import {
  archiveContractProduct,
  deleteContractProduct,
} from "@/lib/contracts/adminMutations";
import type {
  ContractAdminView,
  ContractDeletePreview,
} from "@/lib/contracts/adminDto";
import { parseContractAdminView } from "@/lib/contracts/adminDto";
import { previewContractDelete } from "@/lib/contracts/adminRepository";
import { contractLifecycleError } from "@/lib/contracts/lifecycleErrors";
import { requireContractPermissionAction } from "@/lib/contracts/permissions";
import { assertUserCanOperateCompany } from "@/lib/tenant/scope";

export type ContractDeletePreviewActionState = {
  status: "idle" | "ready" | "error";
  requestId: string | null;
  companyId: string | null;
  offerId: string | null;
  surface: "contracts" | "company";
  view: ContractAdminView;
  page: number;
  preview: ContractDeletePreview | null;
  error: string | null;
};

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function positivePage(value: string): number {
  const page = Number(value || "1");
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function surface(formData: FormData): "contracts" | "company" {
  return text(formData, "return_surface") === "company"
    ? "company"
    : "contracts";
}

function revalidateContractSurfaces(companyId: string, offerId: string): void {
  revalidatePath("/admin/contracts");
  revalidatePath(`/admin/contracts/${offerId}`);
  revalidatePath("/admin/companies");
  revalidatePath(`/admin/companies/${companyId}`);
  revalidatePath("/api/v1/website/public-contracts");
  revalidatePath("/api/v1/website/public-contracts/diagnostics");
  revalidatePath("/api/v1/public/contracts");

  for (const tag of [
    `tenant-contracts:${companyId}`,
    `public-contracts:${companyId}`,
    `quote-contracts:${companyId}`,
    `website-contracts:${companyId}`,
    `contract:${offerId}`,
  ]) {
    revalidateTag(tag, "max");
  }
}

function redirectAfterMutation(input: {
  companyId: string;
  offerId: string;
  surface: "contracts" | "company";
  view: ContractAdminView;
  page: number;
  result: "deleted" | "archived";
}): never {
  const successMessage =
    input.result === "deleted"
      ? "Avtalet raderades permanent och togs bort från alla standardvyer."
      : "Avtalet arkiverades och doldes från standardvyerna.";
  const search = new URLSearchParams({
    contract_view: input.view,
    contract_page: String(input.page),
    [input.result]: "1",
    success: successMessage,
  });
  if (input.surface === "company") {
    redirect(
      `/admin/companies/${input.companyId}?${search.toString()}#tenant-internal-contracts`,
    );
  }

  const contractSearch = new URLSearchParams({
    company_id: input.companyId,
    view: input.view,
    page: String(input.page),
    [input.result]: "1",
    success: successMessage,
  });
  redirect(`/admin/contracts?${contractSearch.toString()}`);
}

function redirectAfterFailure(input: {
  companyId: string;
  surface: "contracts" | "company";
  view: ContractAdminView;
  page: number;
  error: string;
}): never {
  if (input.surface === "company") {
    const search = new URLSearchParams({
      contract_view: input.view,
      contract_page: String(input.page),
      error: input.error,
    });
    redirect(
      `/admin/companies/${input.companyId}?${search.toString()}#tenant-internal-contracts`,
    );
  }
  const search = new URLSearchParams({
    company_id: input.companyId,
    view: input.view,
    page: String(input.page),
    error: input.error,
  });
  redirect(`/admin/contracts?${search.toString()}`);
}

export async function previewContractDeleteAction(
  _previousState: ContractDeletePreviewActionState,
  formData: FormData,
): Promise<ContractDeletePreviewActionState> {
  const companyIdInput = text(formData, "company_id");
  const offerId = text(formData, "offer_id");
  const returnSurface = surface(formData);
  const view = parseContractAdminView(text(formData, "contract_view"));
  const page = positivePage(text(formData, "contract_page"));
  const requestId = randomUUID();

  try {
    if (!companyIdInput || !offerId) {
      throw new Error("Bolag eller avtal saknas.");
    }
    const actor = await requireContractPermissionAction(
      "contracts.delete_unused",
    );
    const companyId = await assertUserCanOperateCompany(
      actor.userId,
      companyIdInput,
    );
    const preview = await previewContractDelete({
      companyId,
      offerId,
      actorUserId: actor.userId,
      requestId,
      correlationId: requestId,
    });
    return {
      status: "ready",
      requestId,
      companyId,
      offerId,
      surface: returnSurface,
      view,
      page,
      preview,
      error: null,
    };
  } catch (error) {
    return {
      status: "error",
      requestId,
      companyId: companyIdInput || null,
      offerId: offerId || null,
      surface: returnSurface,
      view,
      page,
      preview: null,
      error:
        error instanceof Error && error.message.trim()
          ? error.message
          : "Raderingskontrollen kunde inte köras.",
    };
  }
}

export async function deleteContractPermanentlyAction(
  formData: FormData,
): Promise<never> {
  const companyIdInput = text(formData, "company_id");
  const offerId = text(formData, "offer_id");
  const returnSurface = surface(formData);
  const view = parseContractAdminView(text(formData, "contract_view"));
  const page = positivePage(text(formData, "contract_page"));
  if (!companyIdInput || !offerId) {
    throw new Error("Bolag eller avtal saknas.");
  }

  const actor = await requireContractPermissionAction("contracts.delete_unused");
  const companyId = await assertUserCanOperateCompany(
    actor.userId,
    companyIdInput,
  );
  const result = await deleteContractProduct({
    companyId,
    offerId,
    actorUserId: actor.userId,
    expectedPreviewToken: text(formData, "expected_preview_token") || null,
  });
  if (!result?.ok || result.mode !== "deleted") {
    const failure = contractLifecycleError(
      result,
      "Avtalet kunde inte raderas permanent.",
    );
    redirectAfterFailure({
      companyId,
      surface: returnSurface,
      view,
      page,
      error: failure.message,
    });
  }

  revalidateContractSurfaces(companyId, offerId);
  redirectAfterMutation({
    companyId,
    offerId,
    surface: returnSurface,
    view,
    page,
    result: "deleted",
  });
}

export async function archiveContractAction(formData: FormData): Promise<never> {
  const companyIdInput = text(formData, "company_id");
  const offerId = text(formData, "offer_id");
  const returnSurface = surface(formData);
  const view = parseContractAdminView(text(formData, "contract_view"));
  const page = positivePage(text(formData, "contract_page"));
  if (!companyIdInput || !offerId) {
    throw new Error("Bolag eller avtal saknas.");
  }

  const actor = await requireContractPermissionAction("contracts.archive");
  const companyId = await assertUserCanOperateCompany(
    actor.userId,
    companyIdInput,
  );
  const result = await archiveContractProduct({
    companyId,
    offerId,
    actorUserId: actor.userId,
  });
  if (!result?.ok || result.mode !== "archived") {
    const failure = contractLifecycleError(result, "Avtalet kunde inte arkiveras.");
    redirectAfterFailure({
      companyId,
      surface: returnSurface,
      view,
      page,
      error: failure.message,
    });
  }

  revalidateContractSurfaces(companyId, offerId);
  redirectAfterMutation({
    companyId,
    offerId,
    surface: returnSurface,
    view,
    page,
    result: "archived",
  });
}
