import { supabaseService } from "@/lib/supabase/service";
import { createMeteringPermissionDraft, queueMeteringPermissionForZ13 } from "@/lib/onboarding/infoRequests";
import { createCustomerDataTask } from "@/lib/customers/dataTasks";

/** Permission statuses that mean a history request is already under way. */
const OPEN_PERMISSION_STATUSES = [
  "draft",
  "missing_authorization",
  "z13_ready",
  "z13_sent",
  "waiting_for_customer_approval",
  "partially_approved",
  "approved",
  "active",
];
/** Statuses after which the grid owner or the customer has answered the request; never re-sent automatically. */
const ANSWERED_PERMISSION_STATUSES = [
  "rejected_active",
  "rejected_passive_timeout",
  "z14_received",
  "blocked",
];

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * No history and no intake annual consumption: ask the grid owner for the
 * customer's metering history (PRODAT Z13VH, up to yesterday, last 12 months;
 * the canonical deadline policy enforces the 3-year bound). Idempotent per
 * metering point; requires a power of attorney covering metering data, which
 * queueMeteringPermissionForZ13 checks. Without an actor (system run) the
 * permission is left as a draft with a task for the operator to send it.
 */
export async function ensureHistoricalMeteringRequest(input: {
  companyId: string;
  customerId: string;
  siteId: string | null;
  meteringPointId: string;
  actorUserId: string | null;
}): Promise<"requested" | "already_requested" | "draft_for_operator" | "answered_needs_operator"> {
  const existing = await supabaseService
    .from("metering_permissions")
    .select("id")
    .eq("company_id", input.companyId)
    .eq("metering_point_id", input.meteringPointId)
    .in("status", OPEN_PERMISSION_STATUSES)
    .limit(1);
  if (existing.error) throw existing.error;
  if ((existing.data ?? []).length > 0) return "already_requested";

  // The grid owner (or the customer) already answered the last request: a rejection, a passive timeout,
  // a received Z14 or a blocked request. The monthly billing run reaches this every 6 hours; asking again
  // automatically sent the same Z13 to the grid owner four times a day (reality scenario J2, J2-10).
  // An operator decides instead: one open task per metering point.
  const answered = await supabaseService
    .from("metering_permissions")
    .select("id,status")
    .eq("company_id", input.companyId)
    .eq("metering_point_id", input.meteringPointId)
    .in("status", ANSWERED_PERMISSION_STATUSES)
    .limit(1);
  if (answered.error) throw answered.error;
  const last = (answered.data ?? [])[0] as { status?: string | null } | undefined;
  if (last) {
    await createCustomerDataTask({
      companyId: input.companyId,
      customerId: input.customerId,
      customerSiteId: input.siteId,
      meteringPointId: input.meteringPointId,
      taskType: "contact_grid_owner",
      priority: "high",
      description:
        `Mätvärden och förbrukningshistorik saknas och den senaste historikbegäran (Z13) är besvarad (${last.status ?? "okänd status"}). Ingen ny begäran skickas automatiskt; kontakta nätägaren eller kunden.`,
      actorUserId: null,
    });
    return "answered_needs_operator";
  }

  const point = await supabaseService
    .from("metering_points")
    .select("grid_owner_id")
    .eq("company_id", input.companyId)
    .eq("id", input.meteringPointId)
    .maybeSingle();
  if (point.error) throw point.error;

  const yesterday = Date.now() - 24 * 3_600_000;
  const permission = await createMeteringPermissionDraft({
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    customerId: input.customerId,
    siteId: input.siteId,
    meteringPointId: input.meteringPointId,
    gridOwnerId: (point.data as { grid_owner_id?: string | null } | null)?.grid_owner_id ?? null,
    requestedStartDate: isoDate(yesterday - 365 * 24 * 3_600_000),
    requestedEndDate: isoDate(yesterday),
    caseReference: `HIST-${input.meteringPointId.slice(0, 8).toUpperCase()}`,
  });

  if (input.actorUserId) {
    await queueMeteringPermissionForZ13({
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      permissionId: permission.id,
    });
    return "requested";
  }

  await createCustomerDataTask({
    companyId: input.companyId,
    customerId: input.customerId,
    customerSiteId: input.siteId,
    meteringPointId: input.meteringPointId,
    taskType: "contact_grid_owner",
    priority: "high",
    description:
      "Mätvärden och förbrukningshistorik saknas, så fakturan kan inte uppskattas. Skicka historikbegäran (Z13) till nätägaren från mätvärdestillståndet.",
    actorUserId: null,
  });
  return "draft_for_operator";
}
