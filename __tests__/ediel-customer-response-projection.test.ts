import { describe, expect, it } from 'vitest'
import { buildCustomerCardWorkflow } from '@/lib/customer-operations/customerCardWorkflow'
import { buildCustomerCardSnapshot } from '@/lib/customers/customerCardSnapshot'
import type { EdielDispatchStateResult } from '@/lib/ediel/intent/dispatchState'
import type { CustomerInfoRequestRow } from '@/lib/onboarding/infoRequests'
const snapshot = buildCustomerCardSnapshot({ sites: [], meteringPoints: [], infoRequests: [], contracts: [] })
function workflow(infoStatus: string, receipts?: { technical: string | null; application: string | null }) {
  return buildCustomerCardWorkflow({ customerId: 'customer', snapshot, sites: [], meteringPoints: [], contracts: [], switchRequests: [], powersOfAttorney: [], isPlatformAdmin: false,
    infoRequests: [{ id: 'request', status: infoStatus, ediel_message_id: 'source', verified_payload: {} } as CustomerInfoRequestRow],
    dispatchState: { state: 'sent', waitingForCounterparty: true, edielMessageId: 'source', blockingReasons: [], tenantLabel: 'Skickad', technical: {}, acknowledgements: receipts } as EdielDispatchStateResult,
  }).workflowSteps
}
describe('customer timeline preserves independent receipts and business response', () => {
  it('never fabricates either ACK from an actual business response', () => {
    const steps = workflow('z02_received')
    expect(steps.find(step => step.id === 'business_response_status')?.status).toBe('done')
    expect(steps.find(step => step.id === 'ack_status')?.status).toBe('waiting')
    expect(steps.find(step => step.id === 'application_ack_status')?.status).toBe('waiting')
  })
  it('a technical receipt cannot prove an application receipt or business response', () => {
    const steps = workflow('waiting_for_z02', { technical: 'received', application: 'pending' })
    expect(steps.find(step => step.id === 'ack_status')?.status).toBe('done')
    expect(steps.find(step => step.id === 'application_ack_status')?.status).toBe('waiting')
    expect(steps.find(step => step.id === 'business_response_status')?.status).toBe('waiting')
  })
  it('keeps an actual negative receipt visible even after a business response', () => {
    const steps = workflow('z02_received', { technical: 'received', application: 'failed' })
    expect(steps.find(step => step.id === 'application_ack_status')?.status).toBe('blocked')
    expect(steps.find(step => step.id === 'business_response_status')?.status).toBe('done')
  })
})
