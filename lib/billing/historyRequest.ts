import { supabaseService } from "@/lib/supabase/service";
import { createMeteringPermissionDraft, resolveCustomerInfoRequestAnchors } from "@/lib/onboarding/infoRequests";
import { createCustomerDataTask } from "@/lib/customers/dataTasks";
import { AutomationAlreadyRunningError, withAutomationLock } from "@/lib/automation/locks";
import { requireCompanyOperationalForWrites } from "@/lib/tenant/governance";
import { addCalendarDays, previousStockholmCalendarDate } from "@/lib/time/stockholm";

/** Billing can record a local need. The market owner requires an explicit,
 * current Z13/VH assignment. The invoice provider's environment is unrelated. */
export async function ensureHistoricalMeteringRequest(input: {
  companyId: string;
  customerId: string;
  siteId: string | null;
  meteringPointId: string;
  actorUserId: string | null;
}): Promise<"draft_for_operator"> {
  await requireCompanyOperationalForWrites(input.companyId);
  const requestedEndDate = previousStockholmCalendarDate();
  const requestedStartDate = addCalendarDays(requestedEndDate, -365);
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

        // A retry can repair a task missing after the draft was saved.
        await createCustomerDataTask({
          companyId: input.companyId,
          customerId: input.customerId,
          customerSiteId: siteId,
          meteringPointId: input.meteringPointId,
          taskType: "contact_grid_owner",
          requirePersisted: true,
          priority: "high",
          description: "Mätvärdeshistorik saknas. Verifiera historikens period, driftmiljö och aktuellt VH-uppdrag för mätpunkten före sändning.",
          actorUserId: input.actorUserId,
        });
      },
    });
  } catch (error) {
    if (!(error instanceof AutomationAlreadyRunningError)) throw error;
  }

  return "draft_for_operator";
}
