// Extracted from actions.ts; keep public imports on the facade module.

import { revalidatePath } from "next/cache"

import { requireAdminActionAccess } from "@/lib/admin/guards"













































import { approveEdielInboundCase, rejectEdielInboundCase } from "@/lib/ediel/inboundCases"
import { formString, revalidateEdiel } from './actions.part-1'
import { parseInboundCaseMode } from './actions.part-4'

export async function approveEdielInboundCaseAction(formData: FormData) {
  const context = await requireAdminActionAccess({
    allOf: ["communication.write", "masterdata.write"],
  });
  const caseId = formString(formData.get("caseId"));
  if (!caseId) throw new Error("caseId saknas");

  await approveEdielInboundCase({
    actorUserId: context.userId,
    caseId,
    mode: parseInboundCaseMode(formData.get("mode")),
    selectedCustomerId: formString(formData.get("selectedCustomerId")),
    selectedSiteId: formString(formData.get("selectedSiteId")),
    selectedMeteringPointId: formString(
      formData.get("selectedMeteringPointId"),
    ),
    note: formString(formData.get("note")),
  });

  revalidateEdiel();
  revalidatePath("/admin/customers");
}

export async function rejectEdielInboundCaseAction(formData: FormData) {
  const context = await requireAdminActionAccess({
    allOf: ["communication.write", "masterdata.write"],
  });
  const caseId = formString(formData.get("caseId"));
  if (!caseId) throw new Error("caseId saknas");

  await rejectEdielInboundCase({
    actorUserId: context.userId,
    caseId,
    note: formString(formData.get("note")),
  });

  revalidateEdiel();
}
