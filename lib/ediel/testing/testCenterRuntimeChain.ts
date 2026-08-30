import { prepareInvoiceDraftsForReview } from '@/lib/billing/invoiceReviewPrepare'
import { getEdielMessageById } from '@/lib/ediel/db'
import { processInboundUtiltsMessageByCanonicalPolicy } from '@/lib/ediel/flows/utiltsInboundPolicyProcessor'
import {
  assertTestCenterRuntimeMessage,
  normalizeTestCenterBillingMonth,
} from '@/lib/ediel/testing/testCenterRuntimePolicy'

export type TestCenterRuntimeInput = {
  actorUserId: string
  companyId: string
  customerId: string
  edielMessageId: string
  billingMonth: string
}

export type TestCenterRuntimeResult = {
  edielMessageId: string
  customerId: string
  meteringValueIds: string[]
  billingUnderlayId: string | null
  invoicePreparation: Awaited<ReturnType<typeof prepareInvoiceDraftsForReview>> | null
  externalSideEffectsAllowed: false
  environment: 'test'
}

function required(value: string, name: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`Test Center saknar ${name}.`)
  return normalized
}

/**
 * Runs the real canonical UTILTS -> metering -> billing preparation chain, but
 * only for already test-scoped and explicitly customer-linked inbound messages.
 * No dispatch/export method is called here. Invoice preparation is always
 * forced to environment=test and remains pending review.
 */
export async function runTestCenterMeteringToInvoiceChain(
  input: TestCenterRuntimeInput,
): Promise<TestCenterRuntimeResult> {
  const actorUserId = required(input.actorUserId, 'actorUserId')
  const companyId = required(input.companyId, 'companyId')
  const customerId = required(input.customerId, 'customerId')
  const edielMessageId = required(input.edielMessageId, 'edielMessageId')
  const billingMonth = normalizeTestCenterBillingMonth(input.billingMonth)

  const before = await getEdielMessageById(edielMessageId)
  if (!before) throw new Error('Test Center hittade inte valt Ediel-meddelande.')
  assertTestCenterRuntimeMessage({ message: before, companyId, customerId })

  const processed = await processInboundUtiltsMessageByCanonicalPolicy({
    actorUserId,
    edielMessageId,
  })

  const after = await getEdielMessageById(edielMessageId)
  if (!after) throw new Error('Test Center kunde inte återläsa behandlat Ediel-meddelande.')
  assertTestCenterRuntimeMessage({ message: after, companyId, customerId })

  const meteringValueIds = processed.ingestedMeterValueIds ?? []
  const billingUnderlayId = processed.billingUnderlayId ?? null

  const invoicePreparation = billingUnderlayId
    ? await prepareInvoiceDraftsForReview({
        companyId,
        billingMonth,
        environment: 'test',
        actorUserId,
      })
    : null

  return {
    edielMessageId,
    customerId,
    meteringValueIds,
    billingUnderlayId,
    invoicePreparation,
    externalSideEffectsAllowed: false,
    environment: 'test',
  }
}
