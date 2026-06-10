"use server";

import { revalidatePath } from "next/cache";
import { requireAdminActionAccess } from "@/lib/admin/guards";
import { MASTERDATA_PERMISSIONS } from "@/lib/admin/masterdataPermissions";
import { endAgreement } from "@/lib/operations/businessActions/endAgreement";
import { registerCancellation } from "@/lib/operations/businessActions/registerCancellation";
import { requestHistoricalMeteringAccess } from "@/lib/operations/businessActions/requestHistoricalMeteringAccess";
import { requestMeteringAccess } from "@/lib/operations/businessActions/requestMeteringAccess";
import { sendCustomerConfirmation } from "@/lib/operations/businessActions/sendCustomerConfirmation";
import { terminateMeteringAccess } from "@/lib/operations/businessActions/terminateMeteringAccess";

function formValue(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requiredFormValue(formData: FormData, key: string, label: string): string {
  const value = formValue(formData, key);
  if (!value) throw new Error(`${label} saknas.`);
  return value;
}

function commonBusinessActionInput(formData: FormData, actorUserId: string) {
  return {
    actorUserId,
    customerId: requiredFormValue(formData, "customer_id", "Kund"),
    switchRequestId: requiredFormValue(formData, "switch_request_id", "Affärsärende"),
    siteId: formValue(formData, "site_id"),
    meteringPointId: formValue(formData, "metering_point_id"),
    idempotencyKey: formValue(formData, "idempotency_key"),
  };
}

function revalidateCustomerBusinessPaths(customerId: string) {
  revalidatePath(`/admin/customers/${customerId}`);
  revalidatePath("/admin/work-queue");
  revalidatePath("/admin/operations");
  revalidatePath("/admin/outbound");
  revalidatePath("/admin/ediel");
}

export async function registerCancellationBusinessAction(
  formData: FormData,
): Promise<void> {
  const guard = await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE]);
  const input = commonBusinessActionInput(formData, guard.userId);

  await registerCancellation({
    ...input,
    reason: formValue(formData, "reason"),
  });

  revalidateCustomerBusinessPaths(input.customerId);
}

export async function endAgreementBusinessAction(
  formData: FormData,
): Promise<void> {
  const guard = await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE]);
  const input = commonBusinessActionInput(formData, guard.userId);

  await endAgreement(input);

  revalidateCustomerBusinessPaths(input.customerId);
}

export async function requestMeteringAccessBusinessAction(
  formData: FormData,
): Promise<void> {
  const guard = await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE]);
  const input = commonBusinessActionInput(formData, guard.userId);

  await requestMeteringAccess(input);

  revalidateCustomerBusinessPaths(input.customerId);
}

export async function requestHistoricalMeteringAccessBusinessAction(
  formData: FormData,
): Promise<void> {
  const guard = await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE]);
  const input = commonBusinessActionInput(formData, guard.userId);

  await requestHistoricalMeteringAccess({
    ...input,
    startDate: requiredFormValue(formData, "requested_period_start", "Startdatum"),
    endDate: requiredFormValue(formData, "requested_period_end", "Slutdatum"),
  });

  revalidateCustomerBusinessPaths(input.customerId);
}

export async function terminateMeteringAccessBusinessAction(
  formData: FormData,
): Promise<void> {
  const guard = await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE]);
  const input = commonBusinessActionInput(formData, guard.userId);

  await terminateMeteringAccess(input);

  revalidateCustomerBusinessPaths(input.customerId);
}

export async function sendCustomerConfirmationBusinessAction(
  formData: FormData,
): Promise<void> {
  const guard = await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE]);
  const customerId = formValue(formData, "customer_id");
  const event = formValue(formData, "event") ?? "switch.started";

  if (!customerId) throw new Error("Kund saknas.");

  await sendCustomerConfirmation({
    actorUserId: guard.userId,
    customerId,
    event,
    templateId: formValue(formData, "template_id"),
    idempotencyKey: formValue(formData, "idempotency_key"),
  });

  revalidateCustomerBusinessPaths(customerId);
}
