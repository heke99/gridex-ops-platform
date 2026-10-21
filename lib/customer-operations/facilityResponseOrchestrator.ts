import { completeFacilityLookup, FacilityLookupPostCommitError, type CompleteFacilityLookupInput } from '@/lib/facility/facilityLookupWorkflow'
import { evaluateCustomerIntake } from '@/lib/customer-operations/customerIntakeOrchestrator'
import { evaluateAndRunNextCustomerStep } from '@/lib/customer-operations/customerProcessNextStepEngine'
import { emitCustomerProcessEvent } from '@/lib/customer-operations/customerProcessEvents'
import { transitionCorrelatedCustomerApplicationWorkflow } from '@/lib/website/customerApplicationWorkflowBridge'
import { ensureManualSupplierInformationForSite } from '@/lib/customer-operations/ensureManualSupplierInformation'

type JsonRecord = Record<string, unknown>


export type FacilityResponseOrchestratorResult = Awaited<ReturnType<typeof completeFacilityLookup>> & {
  intakeDecision: Awaited<ReturnType<typeof evaluateCustomerIntake>> | null
  supplierSwitchResult: Awaited<ReturnType<typeof evaluateAndRunNextCustomerStep>> | null
}

/**
 * Single business entrypoint for facility lookup responses.
 *
 * It keeps manual and inbound Z02 handling on the same path:
 * 1. complete the facility lookup request,
 * 2. write facility/metering data to the customer site,
 * 3. refresh the customer intake source-of-truth,
 * 4. start supplier-switch automation when the customer is ready.
 *
 * Z01/customer-masterdata repair remains available in its own flow; facility
 * lookup responses should not create a second Z01 before supplier switch.
 */
export async function completeFacilityLookupAndRunNextSteps(input: CompleteFacilityLookupInput): Promise<FacilityResponseOrchestratorResult> {
  const completion = await completeFacilityLookup({
    ...input,
    triggerNextStep: false,
  })

  let intakeDecision: Awaited<ReturnType<typeof evaluateCustomerIntake>> | null = null
  let supplierSwitchResult: Awaited<ReturnType<typeof evaluateAndRunNextCustomerStep>> | null = null

  if (completion.ok && (completion.meteringPointRecordId || input.automaticInbound)) {
    try {
      let actorUserId = input.actorUserId ?? null
      const continuation = input.automaticInbound ? await import('@/lib/inbound-mail/manualReplyApplication') : null
      const continuationScope = input.automaticInbound ? {
        companyId: input.companyId, customerId: completion.customerId, siteId: completion.customerSiteId,
        requestId: input.requestId, inboundId: input.automaticInbound.inboundId,
      } : null
      if (continuation && continuationScope) {
        const context = await continuation.readAppliedManualReplyContext(continuationScope)
        if (!context || context.sourceHash !== input.automaticInbound?.sourceHash) throw new Error('manual_reply_continuation_context_changed')
        actorUserId = context.actorUserId
        const supplier = await ensureManualSupplierInformationForSite({
          companyId: input.companyId, customerId: completion.customerId, siteId: completion.customerSiteId,
          actorUserId, operationId: completion.operationId, sourceRequestId: input.requestId,
        })
        if (supplier.status === 'waiting_response' || supplier.status === 'needs_review') {
          supplierSwitchResult = {
            decision: supplier.status === 'needs_review' ? 'manual_review' : 'blocked',
            actionTaken: supplier.status === 'needs_review' ? 'supplier_information_requires_review' : 'supplier_information_requested',
            blockers: [{ code: supplier.blockerCode ?? (supplier.status === 'needs_review' ? 'supplier_information_requires_review' : 'current_supplier_response_waiting'),
              message: supplier.status === 'needs_review' ? 'Elhandelsuppgifterna behöver granskas innan leverantörsbytet kan fortsätta.' : 'En separat förfrågan om elhandelsavtalet inväntar svar.',
              metadata: { supplier_information_request_id: supplier.requestId ?? null } }],
          }
        }
      }

      if (!supplierSwitchResult) {
        intakeDecision = await evaluateCustomerIntake({
          companyId: input.companyId,
          customerId: completion.customerId,
          siteId: completion.customerSiteId,
          actorUserId,
          apply: true,
          autoEnsureFacilityLookup: false,
        })

        if (completion.meteringPointRecordId && (intakeDecision.nextAction === 'start_supplier_switch' || intakeDecision.state === 'ready_for_supplier_switch')) {
          supplierSwitchResult = await evaluateAndRunNextCustomerStep({
            companyId: input.companyId,
            customerId: completion.customerId,
            siteId: completion.customerSiteId,
            operationId: completion.operationId,
            trigger: 'facility_data_received',
            actorUserId,
            source: input.source === 'ediel_inbound' ? 'ediel_inbound' : input.source === 'manual' ? 'manual' : 'system',
            skipZ01Finalization: true,
          })
        }
      }

      const reviewRequired = supplierSwitchResult?.decision === 'manual_review'
        || intakeDecision?.state === 'needs_admin_review' || intakeDecision?.nextAction === 'review_blocker'
      const reviewReasons = [...(supplierSwitchResult?.blockers ?? []), ...(intakeDecision?.blockers ?? [])].map(blocker => blocker.code)
      const workflowState = reviewRequired ? 'manual_review' : supplierSwitchResult?.decision === 'prepare_supplier_switch'
        ? 'switch_request_queued'
        : supplierSwitchResult?.decision === 'prepare_z01' || supplierSwitchResult?.decision === 'wait_for_ack'
          ? 'waiting_for_customer_data_response'
          : supplierSwitchResult?.decision === 'manual_review'
            ? 'manual_review'
            : supplierSwitchResult?.decision === 'blocked'
              ? 'switch_blocked'
              : 'facility_information_completed'
      await transitionCorrelatedCustomerApplicationWorkflow({
        companyId: input.companyId,
        customerId: completion.customerId,
        siteId: completion.customerSiteId,
        operationId: completion.operationId,
        state: workflowState,
        eventCode: `workflow.facility_response.${workflowState}`,
        reasonCode: supplierSwitchResult?.blockers?.[0]?.code ?? intakeDecision?.blockers?.[0]?.code ?? null,
        idempotencyKey: `workflow.facility_response:${input.requestId}:${workflowState}`,
        snapshotPatch: {
          next_action: supplierSwitchResult?.actionTaken ?? intakeDecision?.nextAction ?? 'facility_information_completed',
          facility_request_id: input.requestId,
          supplier_switch_request_id: supplierSwitchResult?.supplierSwitchRequestId ?? null,
        },
      })

      await emitCustomerProcessEvent({
        companyId: input.companyId,
        customerId: completion.customerId,
        customerSiteId: completion.customerSiteId,
        meteringPointId: completion.meteringPointRecordId ?? null,
        operationId: completion.operationId,
        eventType: 'facility_response.orchestrated',
        title: reviewRequired ? 'Anläggningssvar kräver fortsatt granskning' : supplierSwitchResult?.supplierSwitchRequestId ? 'Leverantörsbyte startat automatiskt' : 'Anläggningssvar behandlat',
        message: reviewRequired ? 'Anläggningsuppgifterna är mottagna. Ett hinder behöver granskas innan handläggningen kan fortsätta.' : supplierSwitchResult?.supplierSwitchRequestId
          ? 'Anläggningsuppgifter är mottagna och leverantörsbyte har startats automatiskt.'
          : 'Anläggningsuppgifter är mottagna och nästa steg har kontrollerats.',
        actorUserId,
        status: reviewRequired ? 'needs_review' : supplierSwitchResult?.supplierSwitchRequestId ? 'waiting_response' : 'completed',
        severity: reviewRequired ? 'warning' : 'info',
        actionRequired: reviewRequired,
        source: 'facility_response_orchestrator',
        payload: {
          request_id: input.requestId,
          intakeDecision: intakeDecision as unknown as JsonRecord | null,
          supplierSwitchResult: supplierSwitchResult as unknown as JsonRecord | null,
        },
        idempotencyKey: `facility_response.orchestrated:${input.requestId}:${supplierSwitchResult?.supplierSwitchRequestId ?? intakeDecision?.state ?? 'checked'}`,
      })
      if (continuation && continuationScope) {
        await continuation.markManualReplyContinuation({ ...continuationScope, supplierSwitchRequestId: supplierSwitchResult?.supplierSwitchRequestId ?? null,
          reviewRequired, reviewReasons })
      }
    } catch (cause) {
      throw new FacilityLookupPostCommitError(input.companyId, input.requestId, completion, cause)
    }
  }

  return { ...completion, intakeDecision, supplierSwitchResult }
}
