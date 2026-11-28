import { supabaseService } from "@/lib/supabase/service";
import { createMeteringPermissionDraft, resolveCustomerInfoRequestAnchors } from "@/lib/onboarding/infoRequests";
import { createCustomerDataTask } from "@/lib/customers/dataTasks";
import { AutomationAlreadyRunningError, withAutomationLock } from "@/lib/automation/locks";
import { requireCompanyOperationalForWrites } from "@/lib/tenant/governance";
import { addCalendarDays, previousStockholmCalendarDate, stockholmDateForInstant } from "@/lib/time/stockholm";
import { canonicalDeadlineForAction } from "@/lib/ediel/rulebook/canonicalEdielFacade";
import { estimateHistoryReferenceWindows, type TimeWindow } from "./consumptionEstimate";

function selectEstimateReferencePeriod(windows: readonly TimeWindow[]) {
  const first = windows[0], last = windows.at(-1);
  if (!first || !last || windows.some(({ start, end }, index) =>
    !Number.isFinite(start) || !Number.isFinite(end) || end <= start ||
    (index > 0 && start < windows[index - 1].end))) return null;
  const { lastYear, recent } = estimateHistoryReferenceWindows(first.start, last.end);
  for (const candidate of [lastYear, recent]) {
    const start = new Date(candidate.start);
    const lastIncluded = new Date(candidate.end - 1);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(lastIncluded.getTime())) continue;
    const requestedStartDate = stockholmDateForInstant(start);
    const requestedEndDate = stockholmDateForInstant(lastIncluded);
    const deadline = canonicalDeadlineForAction({
      actionType: "request_historical_metering_access",
      historicalStartDate: requestedStartDate,
      historicalEndDate: requestedEndDate,
    });
    if (deadline.ok) return { requestedStartDate, requestedEndDate };
  }
  return null;
}

/** Billing can record a local need. The market owner requires an explicit,
 * current Z13/VH assignment. The invoice provider's environment is unrelated. */
export async function ensureHistoricalMeteringRequest(input: {
  companyId: string;
  customerId: string;
  siteId: string | null;
  meteringPointId: string;
  actorUserId: string | null;
  estimationWindows?: readonly TimeWindow[];
}): Promise<"draft_for_operator" | "work_in_progress"> {
  await requireCompanyOperationalForWrites(input.companyId);
  const legacyEnd = previousStockholmCalendarDate();
  const reference = input.estimationWindows
    ? selectEstimateReferencePeriod(input.estimationWindows)
    : { requestedStartDate: addCalendarDays(legacyEnd, -365), requestedEndDate: legacyEnd };
  if (!reference) throw new Error("billing_history_reference_period_unavailable");
  const { requestedStartDate, requestedEndDate } = reference;
  const caseReference = `HIST-${input.meteringPointId.slice(0, 8).toUpperCase()}`;

  const { siteId, gridOwnerId } = await resolveCustomerInfoRequestAnchors({
    companyId: input.companyId,
    customerId: input.customerId,
    siteId: input.siteId,
    meteringPointId: input.meteringPointId,
    requireOwnedMeteringSite: true,
  });
  const lockKey = `billing-history:${input.companyId}:${input.customerId}:${siteId ?? "none"}:${input.meteringPointId}`;

  try {
    await withAutomationLock({
      lockKey,
      companyId: input.companyId,
      ttlSeconds: 300,
      run: async () => {
        const scoped = supabaseService.from("metering_permissions").select("id")
          .eq("company_id", input.companyId)
          .eq("customer_id", input.customerId)
          .eq("metering_point_id", input.meteringPointId)
          .eq("case_reference", caseReference)
          .in("status", ["draft", "missing_authorization"])
          .is("permission_scope", null)
          .is("source_z13_message_id", null)
          .is("outbound_z13_message_id", null)
          .lte("requested_start_date", requestedStartDate)
          .gte("requested_end_date", requestedEndDate);
        const forSite = siteId === null ? scoped.is("site_id", null) : scoped.eq("site_id", siteId);
        const existing = await (gridOwnerId === null
          ? forSite.is("grid_owner_id", null)
          : forSite.eq("grid_owner_id", gridOwnerId)).limit(1);
        if (existing.error) throw existing.error;
        if (!existing.data?.length) {
          await createMeteringPermissionDraft({
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            customerId: input.customerId,
            siteId,
            meteringPointId: input.meteringPointId,
            gridOwnerId,
            requireOwnedMeteringSite: true,
            requestedStartDate,
            requestedEndDate,
            caseReference,
          });
        }

        // A retry can repair a missing task. Only the current review instructions
        // qualifies within the shared contact_grid_owner type.
        await createCustomerDataTask({
          companyId: input.companyId,
          customerId: input.customerId,
          customerSiteId: siteId,
          meteringPointId: input.meteringPointId,
          taskType: "contact_grid_owner",
          requirePersisted: true,
          matchDescription: true,
          priority: "high",
          description: "Mätvärdeshistorik saknas. Verifiera historikens period, driftmiljö och aktuellt VH-uppdrag för mätpunkten före sändning.",
          actorUserId: input.actorUserId,
        });
      },
    });
  } catch (error) {
    if (error instanceof AutomationAlreadyRunningError) return "work_in_progress";
    throw error;
  }

  return "draft_for_operator";
}
