"use server";

import { revalidatePath } from "next/cache";
import { requireAdminActionAccess } from "@/lib/admin/guards";
import { assertCompanyAccessForGuard } from "@/lib/tenant/entityGuards";
import { supabaseService } from "@/lib/supabase/service";
import { retryFailedSupplierSwitch, type RetryResult } from "@/lib/customer-operations/supplierSwitchRetry";

/**
 * "Försök igen" on a failed supplier switch (owner decision 32, FINDINGS I-B2d). Requires switching.write in the
 * switch's own company; the retry itself re-checks everything and only queues the existing automation.
 */
export async function retryFailedSupplierSwitchAction(formData: FormData): Promise<RetryResult> {
  const guard = await requireAdminActionAccess({ allOf: ["switching.write"] });
  const switchRequestId = String(formData.get("supplier_switch_request_id") ?? "").trim();
  const customerId = String(formData.get("customer_id") ?? "").trim();
  if (!switchRequestId || !customerId) throw new Error("supplier_switch_retry_input_required");

  const { data, error } = await supabaseService
    .from("supplier_switch_requests")
    .select("id,company_id,customer_id")
    .eq("id", switchRequestId)
    .eq("customer_id", customerId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.company_id) throw new Error("supplier_switch_not_found");
  const companyId = await assertCompanyAccessForGuard(String(data.company_id), guard);

  const result = await retryFailedSupplierSwitch({ companyId, switchRequestId, actorUserId: guard.userId });
  revalidatePath(`/admin/customers/${customerId}`);
  return result;
}
