"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  getCustomerPortalContext,
  submitPortalCompletion,
} from "@/lib/customer-portal/db";

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

  if (!customerId)
    redirect("/portal/komplettera?status=blocked&message=Kundkoppling saknas");
  if (!message && !facilityId && !meterPointId && !phone && !email) {
    redirect(
      "/portal/komplettera?status=blocked&message=Fyll i minst en uppgift",
    );
  }

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

  redirect("/portal/komplettera?status=success");
}
