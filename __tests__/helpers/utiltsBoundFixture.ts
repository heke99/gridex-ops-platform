import { createHash } from 'node:crypto'
import { validateUtiltsPersistenceResults, type UtiltsBoundPersistenceInput, type UtiltsTransactionPersistenceResult, type UtiltsTransactionPersistenceItem } from '@/lib/ediel/utilts/transactionPersistence'
import type { UtiltsConsumptionContractV1 } from '@/lib/ediel/utilts/consumptionContract'

export function boundFixtureContract(transactionId = 'T1', quantity = 123): UtiltsConsumptionContractV1 {
  const attribution = { capability: 'write' as const, reason: null, customerId: 'customer-a', siteId: 'site-a', customerSiteId: 'site-a', meteringPointId: 'point-a', gridOwnerId: 'owner-a', sourceRequestId: 'request-a' }
  return { version: 1, projectionVersion: 'utilts-consumption-v1', attributionVersion: 'tenant-match-v1', companyId: 'tenant-a', environment: 'test', messageCode: 'E66', transactionId, seriesKind: 'actual', profileKey: 'E66', profileVersion: null, rulePackHash: null, guideRevision: '25-A-4', sourceType: 'ediel_utilts',
    interpretation: { localPeriodStart: '2026-08-01T00:00:00Z', localPeriodEnd: '2026-09-01T00:00:00Z', localRegistration: null, resolutionValue: null, resolutionFormat: null, timezoneRaw: null, timezoneFormat: null, offsetMinutes: null, timestampPolicy: 'explicit-offset-v1' },
    observations: [{ ordinal: 0, sourceOrdinal: 0, quantity, periodStart: '2026-08-01T00:00:00.000Z', periodEnd: '2026-09-01T00:00:00.000Z', readAt: '2026-09-01T00:00:00.000Z', resolution: null, unit: 'kWh', quality: null, readingType: 'consumption', direction: 'consumption', registerCode: null, productCode: null, sourceLineReference: 'external-a', externalPoint: 'external-a', gridArea: null }],
    metering: attribution, billing: { ...attribution, requestScope: 'billing_underlay', periodStart: '2026-08-01T00:00:00.000Z', periodEnd: '2026-09-01T00:00:00.000Z', month: 9, year: 2026, status: 'received', sourceSystem: 'ediel_utilts', currency: 'SEK' }, billingContributionOrdinals: [0] }
}
/** External RPC response fixture. It does not stand in for PostgreSQL's hash
 * comparison: the real native suite exercises that authority separately. */
export function bindingRpcRows(input: UtiltsBoundPersistenceInput, outcomes?: unknown[]): unknown[] {
  return (outcomes ?? input.transactions.map(item => ({ transactionId: item.transactionId, disposition: item.disposition, responseType: item.responseType, persistenceStatus: item.disposition === 'accepted' ? 'persisted' : 'not_applicable' })))
    .map(value => {
      const row = value as UtiltsTransactionPersistenceResult
      const c = input.contracts.find(contract => contract.transactionId === row.transactionId)
      return { ...row, sourceBinding: { sourceMessageId: input.sourceMessageId, rawHash: createHash('sha256').update(input.rawPayload).digest('hex'), boundAt: '2026-09-23T00:00:00Z' },
        ...(row.persistenceStatus === 'persisted' ? { seriesId: 'series-' + row.transactionId, contractHash: 'a'.repeat(64), contractVersion: 1, consumptionContract: structuredClone(c) } : {}) }
    })
}
export function boundLegacySinkFixture(payload: Record<string, unknown>): UtiltsTransactionPersistenceResult[] {
  const txs = payload.transactions as { transactionId: string | null; quantities: { value: number }[] }[] | undefined
  const decisions = payload.utiltsTransactionDispositions as Pick<UtiltsTransactionPersistenceItem, 'transactionId' | 'disposition' | 'responseType' | 'issueCodes'>[] | undefined
  const outcomes = payload.utiltsTransactionPersistenceResults as unknown[] | undefined
  if (!txs || !decisions || !outcomes || !decisions.length) return []
  const ids = txs.map((tx, i) => tx.transactionId ?? `transaction-${i + 1}`)
  if (decisions.length !== ids.length || new Set(decisions.map(d => d.transactionId)).size !== decisions.length) return []
  const contracts = txs.map((tx, i) => {
    const c = boundFixtureContract(ids[i], tx.quantities?.[0]?.value ?? 0)
    if (!tx.quantities?.length) { c.observations = []; c.billingContributionOrdinals = []; c.billing.capability = 'skip'; c.billing.reason = 'no_eligible_observations' }
    return c
  })
  const input: UtiltsBoundPersistenceInput = { companyId: 'tenant-a', environment: 'test', sourceMessageId: 'message-a', messageCode: 'E66', rawPayload: 'synthetic-original', contracts,
    transactions: ids.map(id => ({ ...decisions.find(d => d.transactionId === id)!, transactionId: id, seriesKind: 'actual', meteringPointId: 'point-a', externalMeteringPointId: 'external-a', gridAreaId: null,
      periodStart: null, periodEnd: null, registrationDate: null, resolution: null, unit: 'KWH', reasonForTransaction: null, quantities: [] })) }
  try { return validateUtiltsPersistenceResults(input, bindingRpcRows(input, outcomes)) } catch { return [] }
}
