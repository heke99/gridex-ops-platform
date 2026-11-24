"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCustomerPortalContext } from "@/lib/customer-portal/db";
import {
  PORTAL_COMPLETION_CUSTOMER_MISSING_MESSAGE,
  PORTAL_COMPLETION_EMPTY_MESSAGE,
  PORTAL_COMPLETION_FAILED_MESSAGE,
} from "@/lib/customer-portal/completionFlash";
import { supabaseService } from "@/lib/supabase/service";
import { isUuid } from "@/lib/validation/uuid";

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

const COMPLETION_TYPES = ["missing_information", "metering_point_update", "contact_update"];

type PortalCompletionRpc = {
  rpc(name: "gridex_submit_portal_completion_v1", input: {
    p_company_id: string; p_customer_id: string; p_user_id: string; p_session_id: string;
    p_attempt_id: string; p_site_id: string | null; p_type: string; p_payload: Record<string, string>;
  }): Promise<{ data: { caseId?: string } | null; error: unknown }>;
};

export async function submitPortalCompletionAction(formData: FormData) {
  const client = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await client.auth.getUser();
  if (!user || userError) redirect("/login");

  const attempt = text(formData, "intent_id");

  const { data: token, error: claimsError } = await client.auth.getClaims();
  const sessionId = token?.claims.session_id;
  const context = await getCustomerPortalContext();
  const companyId = text(formData, "expected_company_id");
  const customerId = text(formData, "customer_id");
  const siteId = text(formData, "site_id");
  function blocked(message: string): never {
    const query = new URLSearchParams({ status: "blocked", message });
    if (companyId === context.companyId && context.customerIds.includes(customerId)) query.set("customer", customerId);
    if (isUuid(attempt)) query.set("attempt", attempt);
    redirect(`/portal/komplettera?${query}`);
  }

  if (!context.companyId || companyId !== context.companyId || !context.customerIds.includes(customerId)) {
    blocked(PORTAL_COMPLETION_CUSTOMER_MISSING_MESSAGE);
  }
  if (!isUuid(attempt) || (siteId && !isUuid(siteId)) || claimsError || token?.claims.sub !== user.id
    || typeof sessionId !== "string" || !isUuid(sessionId)) {
    blocked(PORTAL_COMPLETION_FAILED_MESSAGE);
  }

  const completionType = text(formData, "completion_type") || "missing_information";
  if (!COMPLETION_TYPES.includes(completionType)) blocked(PORTAL_COMPLETION_FAILED_MESSAGE);
  const payload = {
    message: text(formData, "message"),
    facilityId: text(formData, "facility_id"),
    meterPointId: text(formData, "meter_point_id"),
    phone: text(formData, "phone"),
    email: text(formData, "email"),
  };
  if (!Object.values(payload).some(Boolean)) blocked(PORTAL_COMPLETION_EMPTY_MESSAGE);

  let caseId: string | undefined;
  try {
    const { data, error } = await (supabaseService as unknown as PortalCompletionRpc)
      .rpc("gridex_submit_portal_completion_v1", {
        p_company_id: companyId, p_customer_id: customerId, p_user_id: user.id, p_session_id: sessionId,
        p_attempt_id: attempt, p_site_id: siteId || null, p_type: completionType, p_payload: payload,
      });
    if (!error) caseId = data?.caseId;
  } catch (error) {
    unstable_rethrow(error);
  }
  if (!caseId || !isUuid(caseId)) blocked(PORTAL_COMPLETION_FAILED_MESSAGE);
  redirect(`/portal/arenden/${caseId}`);
}
