const fs = require('fs')
const path = require('path')

const root = process.cwd()
const registryPath = path.join(root, 'lib/ediel/rulebook/testCaseRuleRegistry.ts')
const migrationPath = path.join(root, 'supabase/migrations/20260605183000_batch4_canonical_edifact_rulebook.sql')
const pagePath = path.join(root, 'app/admin/ediel/certification/page.tsx')
const decisionPath = path.join(root, 'lib/ediel/decisionEngine.ts')
const tgtRegistryPath = path.join(root, 'lib/ediel/tgtRegistry.ts')
const systemTestPagePath = path.join(root, 'app/admin/ediel/system-tests/cases/[id]/page.tsx')
const systemTestActionsPath = path.join(root, 'app/admin/ediel/system-tests/actions.ts')
const tgtAutopilotPath = path.join(root, 'lib/ediel/tgtAutopilot.ts')

const tgtEdifactPath = path.join(root, 'lib/ediel/tgtEdifact.ts')

const required = [registryPath, migrationPath, pagePath, decisionPath, tgtRegistryPath, systemTestPagePath, systemTestActionsPath, tgtAutopilotPath, tgtEdifactPath]
const failures = []
for (const file of required) {
  if (!fs.existsSync(file)) failures.push(`Missing file: ${path.relative(root, file)}`)
}

const registry = fs.existsSync(registryPath) ? fs.readFileSync(registryPath, 'utf8') : ''
const migration = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, 'utf8') : ''
const decision = fs.existsSync(decisionPath) ? fs.readFileSync(decisionPath, 'utf8') : ''
const tgtRegistry = fs.existsSync(tgtRegistryPath) ? fs.readFileSync(tgtRegistryPath, 'utf8') : ''
const systemTestPage = fs.existsSync(systemTestPagePath) ? fs.readFileSync(systemTestPagePath, 'utf8') : ''
const systemTestActions = fs.existsSync(systemTestActionsPath) ? fs.readFileSync(systemTestActionsPath, 'utf8') : ''
const tgtAutopilot = fs.existsSync(tgtAutopilotPath) ? fs.readFileSync(tgtAutopilotPath, 'utf8') : ''
const tgtEdifact = fs.existsSync(tgtEdifactPath) ? fs.readFileSync(tgtEdifactPath, 'utf8') : ''

const requiredCases = [
  'L1','L2','L3','L4','L5','L7',
  'UL1','UL2','UL3','UL4','UL6',
  'E3','E4','E5','E6','E7','E8','UE1','UE2',
]
for (const code of requiredCases) {
  if (!registry.includes(`'${code}'`)) failures.push(`Missing certification case ${code} in registry`)
  if (!migration.includes(`'${code}'`)) failures.push(`Missing certification case ${code} in migration`)
}

const approvedIds = ['388756','388764','388765','388766','388767','388809','388810','388811','388812','388813','388814','389178','389280','389301']
for (const id of approvedIds) {
  if (!registry.includes(id)) failures.push(`Missing approved portal id ${id} in registry`)
  if (!migration.includes(id)) failures.push(`Missing approved portal id ${id} in migration`)
}

if (!registry.includes('389303') || !registry.includes('failed')) failures.push('E7 389303 must be failed active target')
if (!decision.includes('findCertificationCase')) failures.push('decisionEngine must use certification registry rather than hardcoded UE-only logic')
if (decision.includes("['UE1', 'UE2'].includes(testCase)")) failures.push('decisionEngine still contains direct UE1/UE2 decision hardcode')
if (!tgtRegistry.includes('portalAperakOutcome ?? "negative"')) failures.push('AGT E3/E4/E8 outbound cases must expect negative APERAK by default')
if (!tgtRegistry.includes('aperakOutcome: "negative"')) failures.push('E7 must be modeled as backend-driven negative APERAK in Systemtest')
if (!tgtRegistry.includes('family: "UTILTS_ERR"')) failures.push('UE1/UE2 must expect UTILTS_ERR, not positive APERAK')
if (!systemTestPage.includes('sendSystemTestOutboundMessageAction')) failures.push('Systemtest case page must expose outbound send action')
if (!systemTestPage.includes('Skicka från Systemtest')) failures.push('Systemtest outbound UI must send from the test-run page')
if (!systemTestActions.includes('sendSystemTestOutboundMessageAction')) failures.push('Systemtest outbound send server action missing')
if (!systemTestPage.includes('CreateAndSendSystemTestOutboundForRunForm')) failures.push('Systemtest case page must expose create-and-send outbound form when no draft is visible')
if (!systemTestPage.includes('Skapa och skicka PRODAT från Systemtest')) failures.push('Systemtest actor-to-portal UI must create and send PRODAT from the test page')
if (!systemTestActions.includes('createAndSendSystemTestOutboundForRunAction')) failures.push('Systemtest create-and-send outbound action missing')
if (!systemTestActions.includes('runTgtAutopilotForRun')) failures.push('Systemtest create-and-send action must create missing draft through autopilot')
if (!tgtAutopilot.includes('runtimeSuiteForRun')) failures.push('Autopilot must resolve AGT/TGT runtime suite from the test run')
if (!tgtEdifact.includes('fallbackEscoPermissionGridAreaId')) failures.push('E3/E4/E8 Systemtest builder must provide AGT grid-area fallback without imported TGT portal rows')
if (!tgtEdifact.includes('["E3", "E4", "E8"].includes(params.testCaseCode)')) failures.push('AGT actor-to-portal E3/E4/E8 must not be blocked by missing TGT portal testdata')
if (!tgtEdifact.includes('735999888000000113')) failures.push('E8 Z18V must have deterministic synthetic metering point fallback for Systemtest outbound')

if (failures.length > 0) {
  console.error('Certification regression failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Certification regression ok')
