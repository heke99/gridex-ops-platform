// Extracted from productionReadiness.ts; keep public imports on the facade module.
import { supabaseService } from "@/lib/supabase/service"


import type { EdielMessageRow } from "@/lib/ediel/types"



import { EdifactEnvelopeCodec } from "@/lib/ediel/core/edifactEnvelopeCodec"
import { requireTenantOperationAllowed } from '@/lib/tenant/operationPolicy'
import type { ProductionDryRunResult } from './productionReadiness.part-1'
import { evaluateProductionSendGuardSnapshot, safeCount, upper } from './productionReadiness.part-1'
import { getCompanyProductionReadiness } from './productionReadiness.part-2'

export async function runProductionDryRun(
  companyId: string,
  actorUserId: string,
): Promise<ProductionDryRunResult> {
  const readiness = await getCompanyProductionReadiness(companyId, {
    checkedBy: actorUserId,
    persist: true,
  });
  const allowed = readiness.blockingIssues.length === 0;
  const result: ProductionDryRunResult = {
    success: allowed,
    status: allowed
      ? readiness.warnings.length > 0
        ? "warning"
        : "allowed"
      : "blocked",
    blockingIssues: readiness.blockingIssues,
    warnings: readiness.warnings,
    previewMetadata: {
      dryRunOnly: true,
      companyId,
      environment: "production",
      edielId: readiness.summary.edielId,
      senderSubAddress: readiness.summary.senderSubAddress,
      receiverSubAddress: readiness.summary.receiverSubAddress,
      productionRouteProfileId:
        readiness.summary.activeProductionRouteProfileId,
      productionProdatRouteProfileId:
        readiness.summary.activeProductionProdatRouteProfileId,
      productionUtiltsRouteProfileId:
        readiness.summary.activeProductionUtiltsRouteProfileId,
      productionMailboxId: readiness.summary.productionMailboxId,
      receiverResolution: "dynamic_grid_owner_from_selected_customer_context",
      wouldResolveReceiverFrom:
        "kundprocess -> anläggning/mätpunkt -> verifierad nätägare -> Ediel route/certifikat",
      wouldSend: false,
      wouldBeBlocked: !allowed,
    },
    edifactPreview:
      readiness.summary.edielId &&
      readiness.summary.activeProductionRouteProfileId
        ? EdifactEnvelopeCodec.encode({
            sender: readiness.summary.edielId,
            receiver: "DYNAMIC_GRID_OWNER",
            senderSubAddress: readiness.summary.senderSubAddress,
            receiverSubAddress: readiness.summary.receiverSubAddress,
            interchangeReference: "DRYRUN",
            applicationReference: "DDQ",
            environment: "production",
            messages: [{
              messageReference: "DRYRUN-1",
              messageTypeToken: "PRODAT:D:97A:UN:E2SE6A",
              businessSegments: ["BGM+Z01+DRYRUN+9"],
            }],
          })
        : null,
  };

  const { data: readinessRow, error: readinessRowError } = await supabaseService
    .from('ediel_production_readiness_checks')
    .select('configuration_snapshot_id,configuration_hash')
    .eq('id', readiness.latestCheck.id)
    .eq('company_id', companyId)
    .single()
  if (readinessRowError) throw readinessRowError
  const { error: dryRunError } = await supabaseService.from("ediel_go_live_events").insert({
    company_id: companyId,
    event_type: "production_dry_run",
    from_status: readiness.summary.productionStatus,
    to_status: result.status,
    reason: result.success
      ? "Production dry run passerade utan blockerare."
      : "Production dry run blockerades.",
    actor_user_id: actorUserId,
    readiness_check_id: readiness.latestCheck.id,
    configuration_snapshot_id: (readinessRow as Record<string, unknown>).configuration_snapshot_id,
    configuration_hash: (readinessRow as Record<string, unknown>).configuration_hash,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    is_stale: false,
    stale_reason: null,
    metadata: result,
  });
  if (dryRunError) throw dryRunError

  return result;
}

export async function assertCompanyCanSendProductionEdiel(params: {
  companyId: string;
  actorUserId?: string | null;
  message: EdielMessageRow;
}): Promise<void> {
  if (params.message.environment !== "production") return;
  await requireTenantOperationAllowed(params.companyId, 'ediel.production.send')
  const readiness = await getCompanyProductionReadiness(params.companyId);
  let routeBelongsToCompany = !params.message.communication_route_id;
  if (params.message.communication_route_id) {
    const [profileMatches, routeMatches] = await Promise.all([
      safeCount("ediel_route_profiles", (query) =>
        query
          .eq("company_id", params.companyId)
          .eq("environment", "production")
          .eq(
            "communication_route_id",
            params.message.communication_route_id as string,
          ),
      ),
      safeCount("communication_routes", (query) =>
        query
          .eq("company_id", params.companyId)
          .eq("id", params.message.communication_route_id as string),
      ),
    ]);
    routeBelongsToCompany = profileMatches > 0 || routeMatches > 0;
  }
  const actorBelongsToCompany =
    readiness.summary.edielId !== null &&
    upper(readiness.summary.edielId) === upper(params.message.sender_ediel_id);
  const issues = evaluateProductionSendGuardSnapshot({
    environment: params.message.environment,
    productionEnabled: readiness.summary.productionEnabled,
    productionStatus: readiness.summary.productionStatus,
    liveApprovedAt: readiness.summary.liveApprovedAt,
    lockLocked: readiness.summary.productionLockLocked,
    readinessStatus: readiness.status,
    readinessCheckedAt: readiness.latestCheck.checkedAt,
    routeBelongsToCompany,
    actorBelongsToCompany,
    firstLiveSendApprovedAt: readiness.summary.firstLiveSendApprovedAt,
    priorProductionSentCount: readiness.summary.priorProductionSentCount,
  });

  if (issues.length > 0) {
    const { error: auditError } = await supabaseService.from("ediel_go_live_events").insert({
      company_id: params.companyId,
      event_type: "production_outbound_blocked",
      from_status: readiness.summary.productionStatus,
      to_status: "blocked",
      reason: issues.map((issue) => issue.message).join(" · "),
      actor_user_id: params.actorUserId ?? null,
      readiness_check_id: readiness.latestCheck.id,
      metadata: { edielMessageId: params.message.id, issues },
    });
    if (auditError) throw auditError

    throw new Error(
      `Production send är låst för detta bolag. ${issues.map((issue) => issue.message).join(" ")}`,
    );
  }
}
