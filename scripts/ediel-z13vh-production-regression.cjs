const fs = require('fs')
const path = require('path')

const root = process.cwd()
// TypeScript sources are formatter-dependent (single vs double quotes); the
// static assertions below are structural, so quotes are normalized for
// .ts/.tsx haystacks to keep the checks meaningful across formatter runs.
const read = (file) => {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  return /\.(ts|tsx)$/.test(file) ? source.replace(/"/g, "'") : source
}

// tgtEdifact.ts is a facade over split implementation parts; scan all of them.
const tgtEdifact = ['tgtEdifact.ts', 'tgtEdifact.part-1.ts', 'tgtEdifact.part-2.ts', 'tgtEdifact.part-3.ts', 'tgtEdifact.part-4.ts']
  .map((file) => read(`lib/ediel/testing/${file}`)).join('\n')
const genericBuilder = read('lib/ediel/prodat/builders/profileRenderer.ts')
// Production reason/date resolution moved to the canonical policy + date renderer.
const subtypeRegistry = read('lib/ediel/rulebook/prodatSubtypeRegistry.ts')
const dateSegments = read('lib/ediel/prodat/render/dateSegments.ts')
const payloadPreflight = read('lib/ediel/core/messageBuilder/payloadPreflight.ts')
const docs = read('docs/ai-context/05_PRODAT_RULES.md')

const failures = []

if (!tgtEdifact.includes('reasonForTransaction: isAgtZ13Vh')) failures.push('E4/Z13VH Systemtest fallback must override imported reasonForTransaction')
if (!tgtEdifact.includes("? 'S18'")) failures.push('E4/Z13VH Systemtest fallback must set reasonForTransaction S18')
if (!tgtEdifact.includes('const reasonForTransaction = isHistoricalPermissionTransaction(transactionType)')) failures.push('Permission line builder must force S18 for historical transaction type')
if (!tgtEdifact.includes('? historicalReportStartDateTime()')) failures.push('Z13VH Systemtest must use deterministic historical report start')
if (!tgtEdifact.includes('? historicalReportEndDateTime()')) failures.push('Z13VH Systemtest must use deterministic historical report end')
if (!tgtEdifact.includes('z13vh_reason_for_transaction_mismatch')) failures.push('Systemtest validation must block Z13VH payloads rendered with S17')
if (!genericBuilder.includes('subtypeOrReasonCode: input.variant ?? input.context.reasonForTransaction')) failures.push('Production builder must let explicit historical variant override stale portal reason')
if (!genericBuilder.includes('const reasonForTransaction = policy.transactionReasonCode') || !subtypeRegistry.includes("subtype: 'VH', transactionReasonCode: 'S18'")) failures.push('Production builder must resolve historical variant to S18')
if (!dateSegments.includes("reportStartDate: get(['reportStartDate','reportStartDateTime', ...(report ? ['startDate'] : [])])") || !dateSegments.includes("contractStartDate: get(['contractStartDate','agreementStartDateTime'")) failures.push('Production Z13VH must use reportStartDateTime/context.startDate, not agreementStartDateTime')
if (!payloadPreflight.includes('PRODAT_Z13VH_REASON_FOR_TRANSACTION_MISMATCH')) failures.push('Final payload preflight must block Z13VH/S17 mismatch before send')
if (!tgtEdifact.includes('CAV+::::${energyProductId}')) failures.push('Systemtest builder must render field 506 energy product as CAV+::::<id>, not CAV+:::<id>')
if (!tgtEdifact.includes('energy_product_cav_component_mismatch')) failures.push('Systemtest validation must block field 506 rendered in the wrong CAV component')
if (!genericBuilder.includes('function prodatCavValue2')) failures.push('Production builder must have a dedicated helper for CAV value component 2')
if (!genericBuilder.includes('prodatCavValue2(energyProductId, 35)')) failures.push('Production builder must render field 506 energy product as CAV+::::<id>')
if (!payloadPreflight.includes('PRODAT_ENERGY_PRODUCT_CAV_COMPONENT_MISMATCH')) failures.push('Final payload preflight must block field 506 rendered as CAV+:::<id> before send')
if (!docs.includes('Z13VH production correctness')) failures.push('PRODAT AI context must document Z13VH production correctness')

if (failures.length > 0) {
  console.error('Z13VH production regression failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Z13VH production regression ok')
