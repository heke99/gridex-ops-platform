import { describe, expect, it } from 'vitest'
import { buildTenantCheckoutResult, confirmationEmailStatus } from '@/lib/website/publicCheckoutResult'

describe('tenant website checkout result', () => {
  it('marks a signed agreement as safe for the tenant thank-you page while mail is pending', () => {
    expect(buildTenantCheckoutResult({
      applicationNumber: 'APP-1001',
      applicationStatus: 'accepted',
      contractNumber: 'C-1001',
      contractStatus: 'signed',
      signedAt: '2026-08-19T10:00:00.000Z',
      withdrawalDeadlineAt: '2026-09-02T10:00:00.000Z',
      signatureSnapshotSha256: 'a'.repeat(64),
      canSendAgreementConfirmation: true,
      communication: { pending: true, triggered: [], queued: [], sent: [], failed: [] },
    })).toEqual({
      outcome: 'agreement_signed',
      thank_you_ready: true,
      page_state: 'success',
      customer_action_required: false,
      application: { application_number: 'APP-1001', status: 'accepted' },
      agreement: {
        status: 'signed',
        contract_number: 'C-1001',
        signed_at: '2026-08-19T10:00:00.000Z',
        withdrawal_deadline_at: '2026-09-02T10:00:00.000Z',
        signature_snapshot_sha256: 'a'.repeat(64),
      },
      confirmation_email: { expected: true, status: 'pending' },
      status_path: '/api/v1/website/customer-applications/APP-1001',
    })
  })

  it('keeps customer action separate from whether the agreement is already signed', () => {
    const result = buildTenantCheckoutResult({
      applicationNumber: 'APP-1002',
      applicationStatus: 'needs_customer_information',
      contractStatus: 'signed',
      signedAt: '2026-08-19T10:00:00.000Z',
      canSendAgreementConfirmation: true,
      missingFields: ['facility_id'],
    })

    expect(result.thank_you_ready).toBe(true)
    expect(result.page_state).toBe('success_action_required')
    expect(result.customer_action_required).toBe(true)
  })

  it('uses canonical communication state for confirmation delivery', () => {
    expect(confirmationEmailStatus({
      expected: true,
      communication: {
        sent: [{ event_type: 'contract.confirmation_sent', status: 'delivered' }],
      },
    })).toBe('delivered')

    expect(confirmationEmailStatus({
      expected: true,
      communication: {
        failed: [{ event_type: 'contract.confirmation_sent', status: 'failed' }],
      },
    })).toBe('failed')
  })
})
