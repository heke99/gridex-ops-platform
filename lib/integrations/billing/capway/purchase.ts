import { CapwayApticClient, createCapwayApticClient } from '@/lib/integrations/billing/capway/client'
import type { CapwayConnectionConfig, CapwayEnvironment, CapwayPurchaseRequest } from '@/lib/integrations/billing/capway/types'

export function buildPurchasePayload(input: {
  financingMode: string
  purchaseFeePercentage?: number | null
  purchaseFeeAmount?: number | null
  depositAmount?: number | null
  recourseDays?: number | null
  note?: string | null
}): CapwayPurchaseRequest {
  return {
    approved: true,
    purchaseFeePercentage: input.purchaseFeePercentage ?? null,
    purchaseFeeAmount: input.purchaseFeeAmount ?? null,
    purchaseFeeCurrency: input.purchaseFeeAmount ? 'SEK' : null,
    recourseDays: input.financingMode === 'factoring_with_recourse' ? input.recourseDays ?? 30 : null,
    depositAmount: input.depositAmount ?? null,
    note: input.note ?? null,
  }
}

export async function requestCapwayInvoicePurchase(input: {
  companyId: string
  environment?: CapwayEnvironment
  invoiceGuid: string
  financingMode: 'factoring_without_recourse' | 'factoring_with_recourse'
  purchaseFeePercentage?: number | null
  purchaseFeeAmount?: number | null
  depositAmount?: number | null
  recourseDays?: number | null
  note?: string | null
  /** Supplied only by a server owner whose durable claim bound this exact context. */
  resolvedConfiguration?: CapwayConnectionConfig
}) {
  const configuration = input.resolvedConfiguration
  if (configuration && (configuration.companyId !== input.companyId || configuration.environment !== (input.environment ?? 'test')
    || configuration.provider !== 'capway_aptic')) throw new Error('purchase_configuration_binding_invalid')
  const client = configuration ? new CapwayApticClient(configuration)
    : await createCapwayApticClient({ companyId: input.companyId, environment: input.environment ?? 'test' })
  const payload = buildPurchasePayload(input)
  return client.postPurchase(input.invoiceGuid, payload)
}
