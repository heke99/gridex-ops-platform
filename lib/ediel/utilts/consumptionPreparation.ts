import { supportedUtiltsConsumptionIdentity } from './consumptionIdentity'
import { flattenUtiltsTransactionSeries, matchForSeriesItem, stringOrNull, toMeteringReadingType, type UtiltsTransactionMatch } from '@/lib/ediel/flows/utiltsDataRequest.part-1'
import { matchMeteringPointIdByIdentifier, matchSiteAndCustomerForMeteringPoint } from '@/lib/ediel/matching'
import { localEdifactDateTimeToUtc, parseEdifactTimezoneOffsetFromSegments } from './timezone'
import { addNormalizedResolution, normalizeEdifactResolution } from './resolution'
import { resolveUtiltsTransactionId } from './transactionIdentity'
import { utiltsSeriesKind } from './transactionPersistence'
import { canonicalAbsoluteInstant, consumptionConflict, validateUtiltsConsumptionContract, type UtiltsConsumptionAttribution, type UtiltsConsumptionContractV1, type UtiltsBillingContext } from './consumptionContract'
import type { UtiltsRuntimeResult } from '@/lib/ediel/utiltsEngine'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { CanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import type { GridOwnerDataRequestRow } from '@/lib/cis/types'

export async function prepareUtiltsConsumptionContracts(input: {
  message: EdielMessageRow
  runtime: UtiltsRuntimeResult
  policy: CanonicalEdielPolicy
  matches: readonly UtiltsTransactionMatch[]
  dataRequest: GridOwnerDataRequestRow | null
  fallback: { customerId: string | null; siteId: string | null; meteringPointId: string | null; gridOwnerId: string | null }
  allowConsumption: boolean
}): Promise<UtiltsConsumptionContractV1[]> {
  const { message, runtime, policy } = input
  const companyId = stringOrNull(message.company_id)
  if (!companyId) consumptionConflict('company_missing')
  const timezone = parseEdifactTimezoneOffsetFromSegments(runtime.facts.rawSegments)
  const absolute = (value: unknown) => canonicalAbsoluteInstant(localEdifactDateTimeToUtc(stringOrNull(value), timezone))
  const noAttribution = (reason: string): UtiltsConsumptionAttribution => ({ capability: 'skip', reason, customerId: null, siteId: null, customerSiteId: null, meteringPointId: null, gridOwnerId: null, sourceRequestId: null })
  // Resolve local instants before the pure legacy extractor performs interval
  // arithmetic. Otherwise E30's local Date input would depend on the host TZ.
  const acceptedIds = new Set(runtime.transactionDispositions.flatMap((d, i) => d.disposition === 'accepted' ? [resolveUtiltsTransactionId(d.transactionId, i)] : []))
  const sourceTransactions = Array.isArray(runtime.normalizedPayload.transactions) ? runtime.normalizedPayload.transactions : []
  const projected = sourceTransactions.flatMap((value, index) => {
    const tx = value as Record<string, unknown>
    if (!input.allowConsumption || !acceptedIds.has(resolveUtiltsTransactionId(stringOrNull(tx.transactionId), index))) return []
    if (policy.code === 'E30') {
      const resolution = normalizeEdifactResolution({ value: stringOrNull(tx.resolution), format: stringOrNull(tx.resolutionFormat) })
      const quantities = Array.isArray(tx.quantities) ? tx.quantities : []
      return quantities.map((quantity, ordinal) => {
        const start = resolution ? addNormalizedResolution(stringOrNull(tx.deliveryPeriodStart), resolution, ordinal) : stringOrNull(tx.deliveryPeriodStart)
        const end = resolution ? addNormalizedResolution(start, resolution) : stringOrNull(tx.deliveryPeriodEnd)
        if ((!resolution && quantities.length > 1) || !start || !end || absolute(end) > absolute(tx.deliveryPeriodEnd)) consumptionConflict('observation_interval_unresolved')
        return { ...tx, deliveryPeriodStart: absolute(start), deliveryPeriodEnd: absolute(end), resolution, quantities: [quantity] }
      })
    }
    return [{ ...tx, deliveryPeriodStart: absolute(tx.deliveryPeriodStart), deliveryPeriodEnd: absolute(tx.deliveryPeriodEnd),
      resolution: normalizeEdifactResolution({ value: stringOrNull(tx.resolution), format: stringOrNull(tx.resolutionFormat) }) }]
  })
  const series = input.allowConsumption ? flattenUtiltsTransactionSeries({ ...runtime.normalizedPayload, transactions: projected }, message) : []
  const result: UtiltsConsumptionContractV1[] = []
  for (const [index, disposition] of runtime.transactionDispositions.entries()) {
    const transactionId = resolveUtiltsTransactionId(disposition.transactionId, index)
    const transaction = runtime.facts.transactions[index]
    if (!transaction || resolveUtiltsTransactionId(transaction.transactionId, index) !== transactionId) consumptionConflict('physical_membership')
    const consume = input.allowConsumption && disposition.disposition === 'accepted'
    const items = consume ? series.filter(item => (item.transactionReference ?? (runtime.facts.transactions.length === 1 ? transactionId : null)) === transactionId) : []
    let metering = noAttribution(consume ? 'no_eligible_observations' : 'no_consumption')
    if (items.length) {
      const identity = supportedUtiltsConsumptionIdentity(message.raw_payload ?? '', index)
      if (!identity || identity.transactionId !== transactionId || items.some(item => item.externalMeteringPointId !== identity.point)) consumptionConflict('identity_unsupported')
      const match = matchForSeriesItem(items[0], input.matches)
      let point = match?.meteringPointId ?? input.fallback.meteringPointId
      if (items[0].externalMeteringPointId && !match?.meteringPointId) point = await matchMeteringPointIdByIdentifier({ companyId, identifiers: [items[0].externalMeteringPointId] })
      const owner = point ? match?.customerId ? match : await matchSiteAndCustomerForMeteringPoint({ companyId, meteringPointId: point }) : null
      const customer = owner?.customerId ?? input.fallback.customerId
      metering = {
        capability: point && customer ? 'write' : 'skip', reason: !point ? 'metering_point_not_matched_within_tenant' : !customer ? 'customer_not_matched_for_metering_point' : null,
        customerId: customer, siteId: owner?.siteId ?? input.fallback.siteId, customerSiteId: owner?.siteId ?? input.fallback.siteId,
        meteringPointId: point, gridOwnerId: owner?.gridOwnerId ?? input.fallback.gridOwnerId, sourceRequestId: input.dataRequest?.id ?? null,
      }
    }
    const observations = items.map((item, ordinal) => {
      const tx = item.rawItem.transaction as Record<string, unknown>
      const qty = item.rawItem.quantity as Record<string, unknown>
      const readingType = toMeteringReadingType(item.readingType)
      const sourceQuantity = transaction.quantities.indexOf(qty as unknown as typeof transaction.quantities[number])
      return { ordinal, sourceOrdinal: sourceQuantity >= 0 ? sourceQuantity : ordinal, quantity: item.quantity,
        periodStart: absolute(item.periodStart), periodEnd: absolute(item.periodEnd), readAt: absolute(item.readAt),
        resolution: stringOrNull(tx.resolution) ?? stringOrNull(runtime.normalizedPayload.resolution), unit: 'kWh' as const,
        quality: item.qualityCode, readingType, direction: readingType === 'production' ? 'production' as const : 'consumption' as const,
        registerCode: stringOrNull(tx.registerCode) ?? stringOrNull(tx.register_code), productCode: stringOrNull(tx.productCode) ?? stringOrNull(tx.product_code),
        sourceLineReference: item.externalMeteringPointId ?? stringOrNull(qty.lineReference), externalPoint: item.externalMeteringPointId, gridArea: item.externalGridAreaId }
    })
    const billingAllowed = consume && observations.length > 0 && input.dataRequest?.request_scope === 'billing_underlay' && Boolean(input.fallback.customerId)
    const periodStart = consume && runtime.normalizedPayload.periodStart ? absolute(runtime.normalizedPayload.periodStart) : null
    const periodEnd = consume && runtime.normalizedPayload.periodEnd ? absolute(runtime.normalizedPayload.periodEnd) : null
    const date = periodEnd ?? periodStart
    const billing: UtiltsBillingContext = {
      ...noAttribution('billing_not_applicable'), ...input.fallback, customerSiteId: input.fallback.siteId,
      capability: billingAllowed ? 'write' : 'skip', reason: billingAllowed ? null : 'billing_not_applicable',
      sourceRequestId: input.dataRequest?.id ?? null, requestScope: input.dataRequest?.request_scope ?? null,
      periodStart, periodEnd, month: date ? new Date(date).getUTCMonth() + 1 : null, year: date ? new Date(date).getUTCFullYear() : null,
      status: 'received', sourceSystem: 'ediel_utilts', currency: 'SEK',
    }
    result.push(validateUtiltsConsumptionContract({
      version: 1, projectionVersion: 'utilts-consumption-v1', attributionVersion: 'tenant-match-v1', companyId, environment: message.environment,
      messageCode: policy.code, transactionId, seriesKind: utiltsSeriesKind(policy.code), profileKey: policy.profileKey,
      profileVersion: message.rule_profile_version ?? null, rulePackHash: message.rule_pack_checksum ?? null, guideRevision: policy.guide.guideRevision,
      interpretation: { localPeriodStart: transaction.deliveryPeriodStart, localPeriodEnd: transaction.deliveryPeriodEnd, localRegistration: transaction.registrationTime,
        resolutionValue: transaction.resolution, resolutionFormat: transaction.resolutionFormat, timezoneRaw: timezone?.raw ?? null,
        timezoneFormat: timezone?.format ?? null, offsetMinutes: timezone?.offsetMinutes ?? null, timestampPolicy: consume ? 'explicit-offset-v1' : 'no-consumption-v1' },
      observations, metering, billing, billingContributionOrdinals: billingAllowed ? observations.map(o => o.ordinal) : [], sourceType: 'ediel_utilts',
    }))
  }
  return result
}
