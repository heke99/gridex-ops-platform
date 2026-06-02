"use server";

import { revalidatePath } from "next/cache";
import { requireAdminActionAccess } from "@/lib/admin/guards";
import { MASTERDATA_PERMISSIONS } from "@/lib/admin/masterdataPermissions";
import { sendCustomerConfirmation } from "@/lib/operations/businessActions/sendCustomerConfirmation";

function formValue(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function sendCustomerConfirmationBusinessAction(
  formData: FormData,
): Promise<void> {
  const guard = await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE]);
  const customerId = formValue(formData, "customer_id");
  const event = formValue(formData, "event") ?? "supplier_switch_started";

  if (!customerId) throw new Error("Kund saknas.");

  await sendCustomerConfirmation({
    actorUserId: guard.userId,
    customerId,
    event,
    templateId: formValue(formData, "template_id"),
  });

  revalidatePath(`/admin/customers/${customerId}`);
  revalidatePath("/admin/work-queue");
}
