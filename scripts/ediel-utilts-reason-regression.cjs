const fs = require('fs')
const path = require('path')

const root = process.cwd()
const utiltsEnginePath = path.join(root, 'lib/ediel/utiltsEngine.ts')
const ackPath = path.join(root, 'lib/ediel/ack.ts')
const systemTestActionsPath = path.join(root, 'app/admin/ediel/system-tests/actions.ts')
const adminActionsPath = path.join(root, 'app/admin/ediel/actions.ts')
const decisionEnginePath = path.join(root, 'lib/ediel/decisionEngine.ts')
const tgtRegistryPath = path.join(root, 'lib/ediel/testing/tgtRegistry.ts')
const utiltsAckOverridesPath = path.join(root, 'lib/ediel/testing/utiltsAckOverrides.ts')
const docsPath = path.join(root, 'docs/ai-context/06_UTILTS_RULES.md')

const files = [utiltsEnginePath, ackPath, systemTestActionsPath, adminActionsPath, decisionEnginePath, tgtRegistryPath, utiltsAckOverridesPath, docsPath]
const failures = []
function readWithParts(file) {
  if (!fs.existsSync(file)) return ''
  const dir = path.dirname(file)
  const base = path.basename(file, '.ts')
  const parts = fs.readdirSync(dir).filter((f) => f.startsWith(`${base}.part-`) && f.endsWith('.ts')).sort()
  return [file, ...parts.map((f) => path.join(dir, f))].map((f) => fs.readFileSync(f, 'utf8')).join('\n')
}
for (const file of files) {
  if (!fs.existsSync(file)) failures.push(`Missing file: ${path.relative(root, file)}`)
}

const utiltsEngine = readWithParts(utiltsEnginePath)
const ack = fs.existsSync(ackPath) ? fs.readFileSync(ackPath, 'utf8') : ''
const systemTestActions = readWithParts(systemTestActionsPath)
const adminActions = readWithParts(adminActionsPath)
const decisionEngine = fs.existsSync(decisionEnginePath) ? fs.readFileSync(decisionEnginePath, 'utf8') : ''
const tgtRegistry = readWithParts(tgtRegistryPath)
const utiltsAckOverrides = fs.existsSync(utiltsAckOverridesPath) ? fs.readFileSync(utiltsAckOverridesPath, 'utf8') : ''
const docs = fs.existsSync(docsPath) ? fs.readFileSync(docsPath, 'utf8') : ''

for (const code of ['E10', 'E14', 'E49', 'E55', 'E61']) {
  if (!utiltsAckOverrides.includes(code)) failures.push(`AGT UE allowed UTILTS_ERR code ${code} missing from contextual override`)
}

if (!utiltsAckOverrides.includes('AGT_UE_UTILTS_ERR_ALLOWED_CODES')) failures.push('Missing explicit AGT UE allowed-code policy')
if (!utiltsAckOverrides.includes('isAgtUeContext')) failures.push('Missing AGT UE context detector')
if (!utiltsAckOverrides.includes('remapAgtDetails')) failures.push('Missing AGT UE reason remapper')
if (!utiltsAckOverrides.includes("normalized === 'UE1' || normalized === 'UE2'")) failures.push('UE1/UE2 must be detected explicitly as AGT context')
if (!utiltsEngine.includes("utiltsErrCode: 'E87'")) failures.push('E87 must remain available for production/TGT period-resolution mismatches')
if (!docs.includes('live production') || !docs.includes('E87')) failures.push('UTILTS rules must document that E87 remains production-valid')
if (!utiltsAckOverrides.includes("code: 'E10'")) failures.push('AGT UE remapper should map non-processable metering point to E10')
if (!utiltsAckOverrides.includes("code: 'E49'")) failures.push('AGT UE remapper should map unknown grid area to E49')

if (!systemTestActions.includes('serializeUtiltsRuntimeUtiltsErrMessageText(ackPlan)')) failures.push('Systemtest UTILTS_ERR must serialize the overridden ack plan, not stale messageText')
if (!adminActions.includes('applyUtiltsTestAckPlanOverride')) failures.push('Admin ACK actions must apply the same contextual UTILTS reason override')
if (!decisionEngine.includes('serializeUtiltsRuntimeUtiltsErrMessageText(ackPlan)')) failures.push('Decision engine must return the contextual UTILTS_ERR reason code for AGT UE1/UE2')
if (!ack.includes(".map((token) => token.split('@')[0])")) failures.push('UTILTS_ERR builder must parse serialized detail tokens such as E10@TNREF')
if (!tgtRegistry.includes('family: "UTILTS_ERR"') || !tgtRegistry.includes('negativ UTILTS_ERR')) failures.push('UE1/UE2 registry must expect negative UTILTS_ERR, not positive APERAK')
if (!docs.includes('UE1/UE2') || !docs.includes('E10|E14|E49|E55|E61')) failures.push('AI context must record UE1/UE2 allowed-code policy')

if (failures.length > 0) {
  console.error('UTILTS reason-code regression failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('UTILTS reason-code regression ok')
