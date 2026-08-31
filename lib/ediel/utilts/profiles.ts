import { getCanonicalUtiltsProfile } from '@/lib/ediel/rulebook/utiltsRulebook'
import type { UtiltsRuntimeFacts, UtiltsValidationIssue } from '@/lib/ediel/utiltsEngine'
import { expectedObservationCountForResolution } from '@/lib/ediel/utilts/resolution'
import { resolveUtiltsTransactionId } from '@/lib/ediel/utilts/transactionIdentity'

function issue(code: string, title: string, description: string, reference?: string | null): UtiltsValidationIssue {
  return {
    severity: 'error',
    kind: 'application',
    code,
    title,
    description,
    aperakErcCode: '41',
    aperakFieldCode: '512',
    aperakText: 'MANDATORY FIELD MISSING',
    referenceQualifier: reference ? 'ACW' : null,
    referenceNumber: reference ?? null,
    lineItemReference: reference ?? null,
  }
}

function qualifier(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase()
}

function intervalQuantities(
  messageCode: string | null | undefined,
  quantities: Array<{ qualifier: string | null; value: number | null; raw: string }>,
) {
  if (String(messageCode ?? '').trim().toUpperCase() !== 'E66') return quantities

  // Field 516 in the Swedish 25-A-3 matrix is QTY+136 (periodic energy).
  // Field 517 is QTY+220 (meter reading). Register readings are evidence for
  // E66 reconciliation, not interval energy rows and must never inflate the
  // expected observation count.
  return quantities.filter((quantity) => qualifier(quantity.qualifier) === '136')
}

export function validateCanonicalUtiltsProfile(facts: UtiltsRuntimeFacts): UtiltsValidationIssue[] {
  const profile = getCanonicalUtiltsProfile(facts.messageCode)
  if (!profile) return [issue('UTILTS_PROFILE_MISSING', 'UTILTS-profil saknas', `Ingen aktiv profil finns för ${facts.messageCode ?? '(saknas)'}.`)]
  if (profile.messageCode === 'ERR') return []

  const transactions = facts.transactions.length > 0 ? facts.transactions : [{
    transactionId: facts.transactionId,
    meterPointId: facts.meterPointId,
    gridAreaId: facts.gridAreaId,
    deliveryPeriodStart: facts.deliveryPeriodStart,
    deliveryPeriodEnd: facts.deliveryPeriodEnd,
    resolution: facts.resolution,
    resolutionFormat: null,
    unit: facts.unit,
    quantities: facts.quantities,
  }]
  const issues: UtiltsValidationIssue[] = []
  if (profile.requiresTransaction && transactions.length === 0) issues.push(issue('UTILTS_TRANSACTION_REQUIRED', 'Transaktion saknas', `${profile.profileKey} kräver minst en transaktion.`))

  transactions.forEach((transaction, index) => {
    const reference = resolveUtiltsTransactionId(
      transaction.transactionId ?? facts.transactionId,
      index,
    )
    if (!transaction.transactionId) issues.push(issue('UTILTS_TRANSACTION_ID_MISSING', 'Transaktions-id saknas', `${profile.profileKey} kräver IDE+24 eller TN-referens per transaktion.`, reference))
    if (profile.requiresMeteringPoint && !transaction.meterPointId && !facts.meterPointId) issues.push(issue('UTILTS_PROFILE_METERING_POINT_MISSING', 'Anläggnings-id saknas', `${profile.profileKey} kräver LOC+172 per transaktion.`, reference))
    if (profile.requiresGridArea && !transaction.gridAreaId && !facts.gridAreaId) issues.push(issue('UTILTS_PROFILE_GRID_AREA_MISSING', 'Nätområde saknas', `${profile.profileKey} kräver LOC+239.`, reference))
    if (profile.requiresPeriod && (!(transaction.deliveryPeriodStart ?? facts.deliveryPeriodStart) || !(transaction.deliveryPeriodEnd ?? facts.deliveryPeriodEnd))) issues.push(issue('UTILTS_PROFILE_PERIOD_MISSING', 'Leveransperiod saknas', `${profile.profileKey} kräver både start och slut i DTM+324.`, reference))
    if (profile.requiresResolution && !(transaction.resolution ?? facts.resolution)) issues.push(issue('UTILTS_PROFILE_RESOLUTION_MISSING', 'Upplösning saknas', `${profile.profileKey} kräver DTM+354.`, reference))
    if (profile.requiresUnit && !(transaction.unit ?? facts.unit)) issues.push(issue('UTILTS_PROFILE_UNIT_MISSING', 'Enhet saknas', `${profile.profileKey} kräver MEA-enhet.`, reference))
    const quantities = transaction.quantities?.length ? transaction.quantities : facts.quantities
    if (profile.requiresQuantities && quantities.length === 0) issues.push(issue('UTILTS_PROFILE_QUANTITY_MISSING', 'Mätvärden saknas', `${profile.profileKey} kräver QTY-värden.`, reference))

    const countedQuantities = intervalQuantities(facts.messageCode, quantities)
    if (profile.validatesDst && countedQuantities.length > 0) {
      const expected = expectedObservationCountForResolution({
        start: transaction.deliveryPeriodStart ?? facts.deliveryPeriodStart,
        end: transaction.deliveryPeriodEnd ?? facts.deliveryPeriodEnd,
        value: transaction.resolution ?? facts.resolution,
        format: transaction.resolutionFormat ?? null,
      })
      if (expected !== null && countedQuantities.length !== expected) {
        issues.push({
          ...issue('UTILTS_DST_INTERVAL_COUNT_MISMATCH', 'Fel antal intervall', `${profile.profileKey} förväntar ${expected} energiobservationer utifrån leveransperiod och DTM+354 men innehåller ${countedQuantities.length}.`, reference),
          kind: 'functional',
          utiltsErrCode: 'E87',
        })
      }
    }
  })
  return issues
}
