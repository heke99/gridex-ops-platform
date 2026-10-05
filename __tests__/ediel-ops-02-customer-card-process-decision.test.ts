// masterplan: OPS-02, AT-OPS-02
import { describe, expect, it } from 'vitest'
import { buildCustomerCardWorkflow } from '@/lib/customer-operations/customerCardWorkflow'
import { buildCustomerCardSnapshot } from '@/lib/customers/customerCardSnapshot'
import { deriveEdielProcessNextAction, type EdielProcessNextAction } from '@/lib/ediel/operations/processNextAction'
import type { EdielBusinessExpectation } from '@/lib/ediel/businessExpectations'
import type { CustomerInfoRequestRow } from '@/lib/onboarding/infoRequests'

const now = '2026-10-01T12:20:00Z'
const message: Parameters<typeof deriveEdielProcessNextAction>[0]['message'] = { id: 'source', company_id: 'own', environment: 'test', direction: 'outbound', message_family: 'PRODAT', message_code: 'Z01',
  requires_contrl: true, contrl_status: 'pending', contrl_due_at: '2026-10-01T12:30:00Z', requires_aperak: false, aperak_status: 'not_required', status: 'sent' }
const watch = (extra: Partial<EdielBusinessExpectation> = {}): EdielBusinessExpectation => ({ id: 'watch', source_message_id: 'source', expected_code: 'Z02', status: 'pending', due_at: '2026-10-01T12:30:00Z',
  metadata: { anchorType: 'actual_accepted_smtp_observed_at', anchorAt: '2026-10-01T12:00:00Z', timerKind: 'internal_sender_watch', remoteReceiptKnown: false, automaticResendAllowed: false }, ...extra })
const decide = (w = watch(), m = message, at = now) => deriveEdielProcessNextAction({ companyId: 'own', message: m, expectation: w, evaluatedAt: at, access: { canRead: true, canReview: true, canPrepare: true } })
const snapshot = buildCustomerCardSnapshot({ sites: [], meteringPoints: [], infoRequests: [], contracts: [] })
const card = (status: string, decisions?: ReadonlyMap<string, EdielProcessNextAction> | null) => buildCustomerCardWorkflow({ customerId: 'customer', snapshot, sites: [], meteringPoints: [], contracts: [], switchRequests: [], powersOfAttorney: [], isPlatformAdmin: false,
  infoRequests: [{ id: 'request', status, ediel_message_id: 'source', verified_payload: {} } as CustomerInfoRequestRow], processDecisions: decisions })
const step = (w: ReturnType<typeof card>, id: string) => w.workflowSteps.find(s => s.id === id)
const map = (d: EdielProcessNextAction) => new Map([[d.sourceMessageId, d]])

describe('OPS-02: the customer card shows the next action from the process decision', () => {
  it('condition/on_pass: shows reason, time basis, responsibility, what it waits for and the allowed actions', () => {
    const w = card('waiting_for_contrl', map(decide()))
    expect(w.processDecision).toMatchObject({ cause: 'business_response_pending', responsibility: 'counterparty', waitingFor: ['Z02_or_negative_APERAK', 'CONTRL'],
      blockers: [], allowedActions: ['read_source'], businessDueAt: '2026-10-01T12:30:00.000Z', technicalDueAt: '2026-10-01T12:30:00.000Z' })
    expect(step(w, 'waiting_response')).toMatchObject({ status: 'waiting', explanation: decide().summary, timestamp: '2026-10-01T12:30:00.000Z' })
    expect(w.primaryAction).toBe('wait_for_grid_owner')
  })
  it('on_pass: an overdue watch becomes a tenant-operator review with blockers and review_case allowed', () => {
    const d = decide(watch(), message, '2026-10-01T12:40:00Z')
    const w = card('waiting_for_contrl', map(d))
    expect(w.processDecision).toMatchObject({ cause: 'business_watch_overdue', responsibility: 'tenant_operator', allowedActions: ['read_source', 'review_case'] })
    expect(step(w, 'waiting_response')?.status).toBe('blocked')
    expect(step(w, 'waiting_response')?.blockerReason).toContain('business_sender_watch_overdue')
    expect(w.primaryAction).toBe('review_blocker')
    expect(w.adminMessage).toBe(d.summary)
  })
  it('on_pass: a qualified business response ends waiting even while the static status still says waiting_for_contrl', () => {
    const w = card('waiting_for_contrl', map(decide(watch({ status: 'fulfilled' }))))
    expect(step(w, 'waiting_response')?.status).toBe('done')
    expect(step(w, 'business_response_status')?.status).toBe('done')
    expect(w.primaryAction).toBe('create_supplier_switch')
  })
  it('on_pass: a rejected business response is a blocker, not waiting', () => {
    const w = card('waiting_for_z02', map(decide(watch({ status: 'rejected' }))))
    expect(step(w, 'waiting_response')?.status).toBe('blocked')
    expect(step(w, 'data_request')?.status).toBe('blocked')
    expect(w.primaryAction).toBe('review_blocker')
  })
  it('prohibited: a static waiting_for_contrl field alone never drives waiting when decisions are read', () => {
    const w = card('waiting_for_contrl', new Map())
    expect(w.processDecision).toBeNull()
    expect(w.processDecisionMissing).toBe(true)
    for (const id of ['waiting_response', 'data_request', 'customer_info_request', 'grid_owner_response']) expect(step(w, id)?.status, id).not.toBe('waiting')
    expect(w.primaryAction).not.toBe('wait_for_grid_owner')
  })
  it('prohibited: a decision for another source message is never borrowed', () => {
    const other = { ...decide(), sourceMessageId: 'other-source' } as EdielProcessNextAction
    const w = card('waiting_for_contrl', new Map([['other-source', other]]))
    expect(w.processDecision).toBeNull()
    expect(step(w, 'waiting_response')?.status).not.toBe('waiting')
  })
})

import { infoRequestProcessQueueState } from '@/lib/customer-operations/infoRequestProcessQueue'
describe('OPS-02: the work queue follows the process decision, not the static status', () => {
  it('a pending decision is shown as waiting on the counterparty with the decision summary', () => {
    expect(infoRequestProcessQueueState({ status: 'waiting_for_contrl', edielMessageId: 'source', processDecisions: map(decide()) }))
      .toEqual({ status: 'process_waiting', title: 'Väntar på motpart', description: decide().summary, priority: 'normal' })
  })
  it('an overdue or rejected decision requires action with high priority', () => {
    for (const d of [decide(watch(), message, '2026-10-01T12:40:00Z'), decide(watch({ status: 'rejected' }))])
      expect(infoRequestProcessQueueState({ status: 'waiting_for_z02', edielMessageId: 'source', processDecisions: map(d) })).toMatchObject({ status: 'action_required', priority: 'high', description: d.summary })
  })
  it('a received business response ends waiting although the static status still says waiting_for_contrl', () => {
    expect(infoRequestProcessQueueState({ status: 'waiting_for_contrl', edielMessageId: 'source', processDecisions: map(decide(watch({ status: 'fulfilled' }))) })?.status).toBe('process_response_received')
  })
  it('prohibited: a static waiting_for_contrl without a decision is held for review, never shown as waiting', () => {
    const state = infoRequestProcessQueueState({ status: 'waiting_for_contrl', edielMessageId: 'source', processDecisions: new Map() })
    expect(state).toMatchObject({ status: 'process_decision_missing', priority: 'high' })
    expect(state?.title).not.toMatch(/Väntar/)
    expect(infoRequestProcessQueueState({ status: 'waiting_for_contrl', edielMessageId: null, processDecisions: map(decide()) })?.status).toBe('process_decision_missing')
  })
  it('non-waiting statuses without a decision keep their existing handling', () => {
    expect(infoRequestProcessQueueState({ status: 'missing_authorization', edielMessageId: null, processDecisions: new Map() })).toBeNull()
    expect(infoRequestProcessQueueState({ status: 'draft', edielMessageId: 'source', processDecisions: new Map() })).toBeNull()
  })
})

import { simpleStatus } from '@/components/admin/customers/CustomerDataRequestsCard'
describe('OPS-02: the request table shows the recorded status without claiming what the process waits for', () => {
  it.each(['waiting_for_contrl', 'waiting_for_aperak', 'waiting_for_z02'])('%s is labelled as recorded, pointing to the process decision', status => {
    const badge = simpleStatus({ id: 'request', status, verified_payload: {} } as CustomerInfoRequestRow)
    expect(badge.label).toBe('Registrerad som skickad')
    expect(badge.description).toContain('processbeslutet')
    expect(`${badge.label} ${badge.description}`).not.toMatch(/väntar på svar/i)
  })
})
