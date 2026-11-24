"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdminActionAccess } from "@/lib/admin/guards";
import { assertCompanyAccessForGuard } from "@/lib/tenant/entityGuards";
import { getSupplierSwitchRequestById } from "@/lib/operations/db";
import {
  continueSwitchEdielAutomation,
  ensureInitialSwitchEdielAutomation,
} from "@/lib/operations/edielAutomation";

function formValue(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === "string" ? value : null;
}

export async function prepareInitialSwitchEdielFromCustomerAction(
  formData: FormData,
): Promise<void> {
  const guard = await requireAdminActionAccess(["switching.write"]);

  const actor = { id: guard.userId };
  const supabase = await createSupabaseServerClient();

  const switchRequestId =
    formValue(formData, "switch_request_id") ??
    formValue(formData, "request_id") ??
    "";

  if (!switchRequestId) {
    throw new Error("switch_request_id saknas");
  }

  const switchRequest = await getSupplierSwitchRequestById(
    supabase,
    switchRequestId,
  );
  if (!switchRequest) {
    throw new Error("Switch request hittades inte");
  }
  await assertCompanyAccessForGuard(switchRequest.company_id, guard);

  const automation = await ensureInitialSwitchEdielAutomation({
    actorUserId: actor.id,
    switchRequestId: switchRequest.id,
    communicationRouteId: formValue(formData, "communication_route_id"),
  });

  if (automation.blocked) {
    throw new Error(
      automation.blockers[0]?.message ??
        "Z03 kan inte skickas ännu: sändfönster eller readiness blockerar utskicket.",
    );
  }

  revalidatePath(`/admin/customers/${switchRequest.customer_id}`);
  revalidatePath("/admin/ediel");
  revalidatePath("/admin/outbound");
  revalidatePath("/admin/operations");
  revalidatePath("/admin/operations/switches");
}

export async function continueSwitchEdielAutomationFromCustomerAction(
  formData: FormData,
): Promise<void> {
  const guard = await requireAdminActionAccess(["switching.write"]);

  const actor = { id: guard.userId };
  const supabase = await createSupabaseServerClient();

  const switchRequestId =
    formValue(formData, "switch_request_id") ??
    formValue(formData, "request_id") ??
    "";
  const step = (formValue(formData, "message_type") ??
    formValue(formData, "step") ??
    "") as "Z03" | "Z05" | "Z09" | "";

  if (!switchRequestId) {
    throw new Error("switch_request_id saknas");
  }

  if (step !== "Z03" && step !== "Z05" && step !== "Z09") {
    throw new Error("message_type/step måste vara Z03, Z05 eller Z09");
  }

  const switchRequest = await getSupplierSwitchRequestById(
    supabase,
    switchRequestId,
  );
  if (!switchRequest) {
    throw new Error("Switch request hittades inte");
  }
  await assertCompanyAccessForGuard(switchRequest.company_id, guard);

  if (step === "Z03") {
    const automation = await ensureInitialSwitchEdielAutomation({
      actorUserId: actor.id,
      switchRequestId: switchRequest.id,
      communicationRouteId: formValue(formData, "communication_route_id"),
    });
    if (automation.blocked) {
      throw new Error(
        automation.blockers[0]?.message ??
          "Z03 kan inte skickas ännu: sändfönster eller readiness blockerar utskicket.",
      );
    }
  } else {
    await continueSwitchEdielAutomation({
      actorUserId: actor.id,
      switchRequestId: switchRequest.id,
      step,
      communicationRouteId: formValue(formData, "communication_route_id"),
    });
  }

  revalidatePath(`/admin/customers/${switchRequest.customer_id}`);
  revalidatePath("/admin/ediel");
  revalidatePath("/admin/outbound");
  revalidatePath("/admin/operations");
  revalidatePath("/admin/operations/switches");
}
