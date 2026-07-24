import { completeFacilityLookup, type CompleteFacilityLookupInput } from '@/lib/facility/facilityLookupWorkflow'
import { evaluateCustomerIntake } from '@/lib/customer-operations/customerIntakeOrchestrator'
import { evaluateAndRunNextCustomerStep } from '@/lib/customer-operations/customerProcessNextStepEngine'
import { emitCustomerProcessEvent } from '@/lib/customer-operations/customerProcessEvents'
import { transitionCorrelatedCustomerApplicationWorkflow } from '@/lib/website/customerApplicationWorkflowBridge'

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

  if (completion.ok && completion.meteringPointRecordId) {
    intakeDecision = await evaluateCustomerIntake({
      companyId: input.companyId,
      customerId: completion.customerId,
      siteId: completion.customerSiteId,
      actorUserId: input.actorUserId ?? null,
      apply: true,
      autoEnsureFacilityLookup: false,
    })

    if (intakeDecision.nextAction === 'start_supplier_switch' || intakeDecision.state === 'ready_for_supplier_switch') {
      supplierSwitchResult = await evaluateAndRunNextCustomerStep({
        companyId: input.companyId,
        customerId: completion.customerId,
        siteId: completion.customerSiteId,
        operationId: completion.operationId,
        trigger: 'facility_data_received',
        actorUserId: input.actorUserId ?? null,
        source: input.source === 'ediel_inbound' ? 'ediel_inbound' : input.source === 'manual' ? 'manual' : 'system',
        skipZ01Finalization: true,
      })
    }

    const workflowState = supplierSwitchResult?.decision === 'prepare_supplier_switch'
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
      reasonCode: supplierSwitchResult?.blockers[0]?.code ?? null,
      idempotencyKey: `workflow.facility_response:${input.requestId}:${workflowState}`,
      snapshotPatch: {
        next_action: supplierSwitchResult?.actionTaken ?? intakeDecision?.nextAction ?? 'facility_information_completed',
        facility_request_id: input.requestId,
        supplier_switch_request_id: supplierSwitchResult?.supplierSwitchRequestId ?? null,
      },
    }).catch((error) => {
      console.warn('[facility-response-orchestrator] workflow transition skipped', error)
    })

    await emitCustomerProcessEvent({
      companyId: input.companyId,
      customerId: completion.customerId,
      customerSiteId: completion.customerSiteId,
      meteringPointId: completion.meteringPointRecordId ?? null,
      operationId: completion.operationId,
      eventType: 'facility_response.orchestrated',
      title: supplierSwitchResult?.supplierSwitchRequestId ? 'Leverantörsbyte startat automatiskt' : 'Anläggningssvar behandlat',
      message: supplierSwitchResult?.supplierSwitchRequestId
        ? 'Anläggningsuppgifter är mottagna och leverantörsbyte har startats automatiskt.'
        : 'Anläggningsuppgifter är mottagna och nästa steg har kontrollerats.',
      actorUserId: input.actorUserId ?? null,
      status: supplierSwitchResult?.supplierSwitchRequestId ? 'waiting_response' : 'completed',
      severity: 'info',
      actionRequired: false,
      source: 'facility_response_orchestrator',
      payload: {
        request_id: input.requestId,
        intakeDecision: intakeDecision as unknown as JsonRecord | null,
        supplierSwitchResult: supplierSwitchResult as unknown as JsonRecord | null,
      },
      idempotencyKey: `facility_response.orchestrated:${input.requestId}:${supplierSwitchResult?.supplierSwitchRequestId ?? intakeDecision?.state ?? 'checked'}`,
    })
  }

  return { ...completion, intakeDecision, supplierSwitchResult }
}
