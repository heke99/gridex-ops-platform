export type TenantConfirmationEmailStatus =
  | 'not_expected'
  | 'pending'
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'failed'

export type TenantCheckoutPageState =
  | 'success'
  | 'success_action_required'
  | 'action_required'
  | 'processing'

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function entries(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.map(record).filter((item): item is JsonRecord => Boolean(item))
    : []
}

function hasEvent(value: unknown, eventType: string) {
  return entries(value).find((item) => text(item.event_type) === eventType) ?? null
}

export function confirmationEmailStatus(input: {
  expected: boolean
  communication?: unknown
  automationStatus?: string | null
}): TenantConfirmationEmailStatus {
  if (!input.expected) return 'not_expected'

  const communication = record(input.communication) ?? {}
  const failed = hasEvent(communication.failed, 'contract.confirmation_sent')
  if (failed) return 'failed'

  const sent = hasEvent(communication.sent, 'contract.confirmation_sent')
  const sentStatus = text(sent?.status)
  if (sentStatus === 'delivered') return 'delivered'
  if (sent) return 'sent'

  const queued = hasEvent(communication.queued, 'contract.confirmation_sent')
  if (queued) return 'queued'

  const triggered = hasEvent(communication.triggered, 'contract.confirmation_sent')
  const triggeredStatus = text(triggered?.status)
  if (triggeredStatus === 'delivered') return 'delivered'
  if (triggeredStatus === 'sent') return 'sent'
  if (triggeredStatus === 'failed' || triggeredStatus === 'bounced' || triggeredStatus === 'complained') {
    return 'failed'
  }
  if (triggeredStatus === 'queued' || triggeredStatus === 'processing') return 'queued'

  if (['failed', 'needs_review', 'blocked', 'delivery_uncertain', 'dead_letter'].includes(input.automationStatus ?? '')) {
    return 'failed'
  }

  // The canonical website flow commits the signed agreement before the durable
  // continuation worker creates its first communication row. During that short
  // window an expected confirmation is pending, never "not sent".
  return 'pending'
}

export function buildTenantCheckoutResult(input: {
  applicationNumber?: unknown
  applicationStatus?: unknown
  contractNumber?: unknown
  contractStatus?: unknown
  signedAt?: unknown
  withdrawalDeadlineAt?: unknown
  signatureSnapshotSha256?: unknown
  canSendAgreementConfirmation?: unknown
  communication?: unknown
  automationStatus?: unknown
  missingFields?: unknown
  missingCustomerAction?: unknown
  nextStep?: unknown
}) {
  const applicationNumber = text(input.applicationNumber)
  const applicationStatus = text(input.applicationStatus)
  const contractNumber = text(input.contractNumber)
  const contractStatus = text(input.contractStatus)
  const signedAt = text(input.signedAt)
  const withdrawalDeadlineAt = text(input.withdrawalDeadlineAt)
  const signatureSnapshotSha256 = text(input.signatureSnapshotSha256)
  const nextStep = text(input.nextStep)
  const missingFields = Array.isArray(input.missingFields)
    ? input.missingFields.filter((item): item is string => typeof item === 'string')
    : []

  const explicitCustomerAction = input.missingCustomerAction === true
  const customerActionRequired =
    explicitCustomerAction ||
    missingFields.length > 0 ||
    [
      'complete_power_of_attorney',
      'provide_customer_information',
      'provide_facility_information',
      'review_customer_application_continuation',
    ].includes(nextStep ?? '')

  const agreementSigned =
    ['signed', 'active'].includes(contractStatus ?? '') && Boolean(signedAt)
  const expectedConfirmation = input.canSendAgreementConfirmation === true
  const emailStatus = confirmationEmailStatus({
    expected: expectedConfirmation,
    communication: input.communication,
    automationStatus: text(input.automationStatus),
  })

  const pageState: TenantCheckoutPageState = agreementSigned
    ? customerActionRequired
      ? 'success_action_required'
      : 'success'
    : customerActionRequired
      ? 'action_required'
      : 'processing'

  return {
    outcome: agreementSigned
      ? 'agreement_signed'
      : customerActionRequired
        ? 'customer_action_required'
        : 'application_received',
    thank_you_ready: agreementSigned,
    page_state: pageState,
    customer_action_required: customerActionRequired,
    application: {
      application_number: applicationNumber,
      status: applicationStatus,
    },
    agreement: {
      status: contractStatus,
      contract_number: contractNumber,
      signed_at: signedAt,
      withdrawal_deadline_at: withdrawalDeadlineAt,
      signature_snapshot_sha256: signatureSnapshotSha256,
    },
    confirmation_email: {
      expected: expectedConfirmation,
      status: emailStatus,
    },
    status_path: applicationNumber
      ? `/api/v1/website/customer-applications/${encodeURIComponent(applicationNumber)}`
      : null,
  }
}
