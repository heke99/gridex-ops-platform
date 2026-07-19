#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
// TypeScript sources are formatter-dependent (single vs double quotes); the
// static assertions below are structural, so quotes are normalized for
// .ts/.tsx haystacks to keep the checks meaningful across formatter runs.
function read(file) {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  return /\.(ts|tsx)$/.test(file) ? source.replace(/"/g, "'") : source
}
function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`)
    process.exitCode = 1
  }
}

const prodatParser = read('lib/ediel/prodat/parser.ts')
const prodatExpected = read('lib/ediel/prodat/expectedContext.ts')
const prodatValidators = read('lib/ediel/prodat/validators.ts')
const tenantResolver = read('lib/ediel/core/tenantResolver.ts')
const utiltsEngine = read('lib/ediel/utiltsEngine.ts')
const utiltsFlow = read('lib/ediel/flows/utiltsDataRequest.ts')
const observationParser = read('lib/ediel/utilts/meteringObservationParser.ts')
const matching = read('lib/ediel/matching.ts')

assert(prodatParser.includes('reportStartDate: string | null'), 'PRODAT parser must expose DTM+90 reportStartDate')
assert(prodatParser.includes('reportEndDate: string | null'), 'PRODAT parser must expose DTM+91 reportEndDate')
assert(prodatParser.includes("lineDateTimeValue(line.segments, ['90'])"), 'PRODAT parser must read DTM+90 from line item')
assert(prodatParser.includes("lineDateTimeValue(line.segments, ['91'])"), 'PRODAT parser must read DTM+91 from line item')
assert(prodatParser.includes('isHistoricalMeteringRequest'), 'PRODAT parser must flag Z13VH/historical requests')
assert(prodatExpected.includes("expectedReportStartDate: value(fields, ['302'])"), 'TGT/expected context must map PRODAT field 302 to report start')
assert(prodatExpected.includes("expectedReportEndDate: value(fields, ['321'])"), 'TGT/expected context must map PRODAT field 321 to report end')
assert(prodatValidators.includes("fieldCode: '302'") && prodatValidators.includes("fieldCode: '321'"), 'PRODAT validator must validate report start/end fields')

assert(tenantResolver.includes('isReferenceRoutableAckFamily'), 'Tenant resolver must have ACK-only reference fallback guard')
assert(tenantResolver.includes("family === 'CONTRL'") && tenantResolver.includes("family === 'APERAK'") && tenantResolver.includes("family === 'UTILTS_ERR'"), 'Reference fallback must be limited to ACK/response families')
assert(tenantResolver.includes('referenceFallbackAllowed ? await evidenceFromOriginalReferences(snapshot) : []'), 'New inbound PRODAT/UTILTS must not resolve tenant through old business references')

assert(matching.includes('export async function matchMeteringPointIdByIdentifier'), 'Metering point identifier matcher must be reusable for UTILTS per-transaction matching')
assert(utiltsEngine.includes('transactionMatchesFromMessage'), 'UTILTS runtime must read per-transaction tenant/business matches')
assert(utiltsEngine.includes('UTILTS_${code}_UNKNOWN_METERING_POINT'), 'UTILTS runtime must still reject unmatched E66/E30 objects')
assert(utiltsEngine.includes('hasTransactionMatchSnapshot ? transactionMeteringPointResolved : resolvedObject'), 'UTILTS runtime must validate matched object per transaction before accepting interval counts')
assert(utiltsEngine.includes('hasTransactionMatchSnapshot ? transactionGridAreaResolved'), 'UTILTS runtime must validate grid area per transaction when match snapshots are available')

assert(utiltsFlow.includes('matchUtiltsTransactionsForTenant'), 'Inbound UTILTS flow must match every transaction/timeseries inside resolved tenant')
assert(utiltsFlow.includes('allUtiltsTransactionMeteringPointsMatched'), 'Inbound UTILTS flow must know when every timeseries object is safely matched')
assert(utiltsFlow.includes('utiltsTransactionMatches: transactionMatches'), 'Inbound UTILTS flow must persist transaction match evidence')
assert(utiltsFlow.includes('Inbound UTILTS matchades per tidsserie/anläggning inom tenant'), 'Inbound UTILTS flow must auto-ingest matched BRP/grid metering data without separate data request')
assert(utiltsFlow.includes('metering_point_not_matched_within_tenant'), 'Inbound UTILTS ingestion must skip unmatched objects instead of storing against first metering point')
assert(utiltsFlow.includes('externalMeteringPointId'), 'Inbound UTILTS metering series must carry external object id')
assert(utiltsFlow.includes('dateAddMinutes') && utiltsFlow.includes('resolutionMinutes'), 'Inbound UTILTS metering series must calculate interval periods from DTM+324/DTM+354')

assert(observationParser.includes('meteringPointExternalId'), 'Metering observation parser must preserve transaction metering point id')
assert(observationParser.includes('intervalPeriod'), 'Metering observation parser must calculate period per interval quantity')
assert(observationParser.includes('transactionIndex * 10000 + quantityIndex'), 'Metering observation parser must preserve source order across transactions')

if (process.exitCode) process.exit(process.exitCode)
console.log('ediel parsing + tenant hardening regression checks passed')
