"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  getCustomerPortalContext,
  submitPortalCompletion,
} from "@/lib/customer-portal/db";
import {
  PORTAL_COMPLETION_CUSTOMER_MISSING_MESSAGE,
  PORTAL_COMPLETION_EMPTY_MESSAGE,
  PORTAL_COMPLETION_FAILED_MESSAGE,
} from "@/lib/customer-portal/completionFlash";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function submitPortalCompletionAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const context = await getCustomerPortalContext();
  const customerId = text(formData, "customer_id") || context.customerIds[0];
  const completionType =
    text(formData, "completion_type") || "missing_information";
  const message = text(formData, "message");
  const facilityId = text(formData, "facility_id");
  const meterPointId = text(formData, "meter_point_id");
  const phone = text(formData, "phone");
  const email = text(formData, "email");

  if (!customerId) {
    redirect(
      `/portal/komplettera?status=blocked&message=${encodeURIComponent(PORTAL_COMPLETION_CUSTOMER_MISSING_MESSAGE)}`,
    );
  }
  if (!message && !facilityId && !meterPointId && !phone && !email) {
    redirect(
      `/portal/komplettera?status=blocked&message=${encodeURIComponent(PORTAL_COMPLETION_EMPTY_MESSAGE)}`,
    );
  }

  try {
    await submitPortalCompletion({
      context,
      customerId,
      completionType,
      userId: user.id,
      payload: {
        message,
        facilityId,
        meterPointId,
        phone,
        email,
        submittedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    unstable_rethrow(error);
    console.error("[portal-completion] submit_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    redirect(
      `/portal/komplettera?status=blocked&message=${encodeURIComponent(PORTAL_COMPLETION_FAILED_MESSAGE)}`,
    );
  }

  redirect("/portal/komplettera?status=success");
}
