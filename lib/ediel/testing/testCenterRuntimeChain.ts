import { prepareInvoiceDraftsForReview } from '@/lib/billing/invoiceReviewPrepare'
import { getEdielMessageById } from '@/lib/ediel/db'
import { processInboundUtiltsMessageByCanonicalPolicy } from '@/lib/ediel/flows/utiltsInboundPolicyProcessor'
import type { EdielMessageRow } from '@/lib/ediel/types'

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

export function assertTestCenterRuntimeMessage(input: {
  message: Pick<
    EdielMessageRow,
    'id' | 'company_id' | 'customer_id' | 'message_family' | 'direction' | 'environment'
  >
  companyId: string
  customerId: string
}): void {
  if (input.message.environment !== 'test') {
    throw new Error('Test Center runtime får endast behandla Ediel-meddelanden i testmiljö.')
  }
  if (input.message.direction !== 'inbound') {
    throw new Error('Test Center runtime kräver ett inkommande Ediel-meddelande.')
  }
  if (input.message.message_family !== 'UTILTS') {
    throw new Error('Test Center runtime accepterar endast UTILTS för mätvärde-till-faktura-kedjan.')
  }
  if (input.message.company_id !== input.companyId) {
    throw new Error('Test Center runtime stoppades: Ediel-meddelandet tillhör inte valt bolag.')
  }
  if (!input.message.customer_id || input.message.customer_id !== input.customerId) {
    throw new Error('Test Center runtime stoppades: Ediel-meddelandet måste vara explicit kopplat till vald testkund före mätvärdesingest.')
  }
}

export function normalizeTestCenterBillingMonth(value: string): string {
  const billingMonth = value.trim()
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(billingMonth)) {
    throw new Error('Test Center fakturamånad måste anges som YYYY-MM.')
  }
  return billingMonth
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
