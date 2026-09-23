import { normalizeAndStoreMeteringValue } from '@/lib/metering/normalizeMeteringValues'
import { updateMeterValueBillingReadiness } from '@/lib/billing/meterValueBillingMatcher'
import { ingestBillingUnderlay } from '@/lib/cis/db'
import { storedUtiltsConsumption, type UtiltsTransactionPersistenceResult } from './transactionPersistence'
import { consumptionConflict, consumptionEqual } from './consumptionContract'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { MeteringValueRow } from '@/lib/cis/types'

type BoundSinkInput = { actorUserId: string; message: EdielMessageRow; boundOutcomes?: readonly UtiltsTransactionPersistenceResult[] }
function contracts(input: BoundSinkInput) {
  const results = input.boundOutcomes ?? []
  if (new Set(results.map(row => row.transactionId)).size !== results.length) consumptionConflict('sink_duplicate_outcome')
  return results.flatMap(row => {
    if (row.persistenceStatus !== 'persisted' || row.disposition !== 'accepted' || row.responseType !== 'positive_aperak') return []
    const contract = storedUtiltsConsumption(row, input.message.id)
    if (!contract) consumptionConflict('sink_unbound_outcome')
    if (contract.companyId !== input.message.company_id || contract.environment !== input.message.environment || contract.messageCode !== input.message.message_code) consumptionConflict('sink_source_scope')
    return [contract]
  })
}
export async function ingestBoundUtiltsMetering(input: BoundSinkInput): Promise<MeteringValueRow[]> {
  const rows: MeteringValueRow[] = []
  for (const contract of contracts(input)) {
    const a = contract.metering
    if (a.capability !== 'write') continue
    for (const o of contract.observations) {
      const stored = await normalizeAndStoreMeteringValue({
        companyId: contract.companyId, customerId: a.customerId, siteId: a.siteId, customerSiteId: a.customerSiteId,
        meteringPointId: a.meteringPointId, gridOwnerId: a.gridOwnerId, sourceRequestId: a.sourceRequestId,
        periodStart: o.periodStart, periodEnd: o.periodEnd, readAt: o.readAt, resolution: o.resolution,
        quantityKwh: o.quantity, qualityStatus: o.quality, readingType: o.readingType, direction: o.direction, unit: o.unit,
        registerCode: o.registerCode, productCode: o.productCode, facilityId: o.externalPoint, gridArea: o.gridArea,
        sourceLineReference: o.sourceLineReference, sourceType: contract.sourceType, sourceMessageId: input.message.id,
        sourceTransactionReference: contract.transactionId, createdBy: input.actorUserId, immutableAttribution: true, boundObservationOrdinal: o.ordinal, boundContract: contract,
        rawPayload: { consumptionContract: contract, sourceOrdinal: o.sourceOrdinal, edielMessageId: input.message.id },
      })
      if (stored.status !== 'stored') consumptionConflict('metering_not_stored')
      await updateMeterValueBillingReadiness({ meterValue: stored.meteringValue, sourceMessageId: input.message.id })
      rows.push(stored.meteringValue)
    }
  }
  return rows
}
export async function createBoundUtiltsBilling(input: BoundSinkInput & { existingBillingUnderlayId: string | null }) {
  const accepted = contracts(input)
  const contributors = accepted.filter(contract => contract.billing.capability === 'write')
  // The mutable response ID is diagnostic only. The database resolves and
  // verifies the source-owned underlay on every pass, including completed replay.
  if (!contributors.length) return null
  const context = contributors[0].billing
  if (accepted.some(contract => !consumptionEqual(contract.billing, context))) consumptionConflict('billing_context_mismatch')
  const totalKwh = contributors.reduce((sum, c) => sum + c.billingContributionOrdinals.reduce((total, ordinal) => total + c.observations[ordinal].quantity, 0), 0)
  if (!Number.isFinite(totalKwh)) consumptionConflict('billing_total')
  return ingestBillingUnderlay({
    actorUserId: input.actorUserId, customerId: context.customerId!, siteId: context.siteId, meteringPointId: context.meteringPointId,
    gridOwnerId: context.gridOwnerId, sourceRequestId: context.sourceRequestId, underlayMonth: context.month, underlayYear: context.year,
    status: context.status, sourceSystem: context.sourceSystem, currency: context.currency, totalKwh,
    expectedCompanyId: contributors[0].companyId, immutableAttribution: true, boundSourceMessageId: input.message.id, boundContracts: contributors,
    payload: { edielMessageId: input.message.id, consumptionContracts: contributors },
  })
}
