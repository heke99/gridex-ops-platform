const fs = require('fs')
const path = require('path')

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const tgtEdifact = read('lib/ediel/tgtEdifact.ts')
const genericBuilder = read('lib/ediel/prodat/builders/generic.ts')
const payloadPreflight = read('lib/ediel/core/messageBuilder/payloadPreflight.ts')
const docs = read('docs/ai-context/05_PRODAT_RULES.md')

const failures = []

if (!tgtEdifact.includes('reasonForTransaction: isAgtZ13Vh')) failures.push('E4/Z13VH Systemtest fallback must override imported reasonForTransaction')
if (!tgtEdifact.includes('? "S18"')) failures.push('E4/Z13VH Systemtest fallback must set reasonForTransaction S18')
if (!tgtEdifact.includes('const reasonForTransaction = isHistoricalPermissionTransaction(transactionType)')) failures.push('Permission line builder must force S18 for historical transaction type')
if (!tgtEdifact.includes('? historicalReportStartDateTime()')) failures.push('Z13VH Systemtest must use deterministic historical report start')
if (!tgtEdifact.includes('? historicalReportEndDateTime()')) failures.push('Z13VH Systemtest must use deterministic historical report end')
if (!tgtEdifact.includes('z13vh_reason_for_transaction_mismatch')) failures.push('Systemtest validation must block Z13VH payloads rendered with S17')
if (!genericBuilder.includes("isHistoricalPermissionReason(input.variant ?? context.reasonForTransaction ?? null)")) failures.push('Production builder must let explicit historical variant override stale portal reason')
if (!genericBuilder.includes("? 'S18'")) failures.push('Production builder must resolve historical variant to S18')
if (!genericBuilder.includes("portalDate102(portalData, 'reportStartDateTime') ?? prodatDate102(context.startDate)")) failures.push('Production Z13VH must use reportStartDateTime/context.startDate, not agreementStartDateTime')
if (!payloadPreflight.includes('PRODAT_Z13VH_REASON_FOR_TRANSACTION_MISMATCH')) failures.push('Final payload preflight must block Z13VH/S17 mismatch before send')
if (!docs.includes('Z13VH production correctness')) failures.push('PRODAT AI context must document Z13VH production correctness')

if (failures.length > 0) {
  console.error('Z13VH production regression failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Z13VH production regression ok')
