/* eslint-disable @typescript-eslint/no-require-imports */
// Regression: all outbound EDIEL rendering flows through the sanctioned
// RenderGateway (intent -> validate -> render -> ediel_messages -> ediel_outbox
// with full linkage), stale intents are re-validated on idempotent reuse, and
// customer_masterdata no longer renders inline.
const fs = require('fs')

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
}

const failures = []
function mustInclude(file, needle, why) {
  if (!read(file).includes(needle)) failures.push(`Missing "${needle}" in ${file} (${why})`)
}

const gateway = 'lib/ediel/intent/renderGateway.ts'
const masterdata = 'lib/ediel/flows/prodatCustomerMasterdata.ts'
const engine = 'lib/ediel/intent/intentEngine.ts'

// Gateway renderer exists for customer_masterdata with controlled failure.
mustInclude(gateway, 'export async function renderAndQueueCustomerMasterdataZ01', 'sanctioned masterdata renderer')
mustInclude(gateway, 'export async function renderAndQueueFacilityLookupZ01', 'facility lookup renderer intact')
const gatewaySrc = read(gateway)
const mdIdx = gatewaySrc.indexOf('renderAndQueueCustomerMasterdataZ01')
const mdBlock = gatewaySrc.slice(mdIdx)
for (const needle of ['loadValidatedIntent', 'classifyRenderError', 'linkEdielMessage', 'queuePreparedEdielMessage', "renderStatus: 'rendered'", "outboxStatus: 'queued'", 'intent_id']) {
  if (!mdBlock.includes(needle)) failures.push(`customer_masterdata gateway renderer missing "${needle}"`)
}

// Business flow calls the gateway instead of rendering inline.
mustInclude(masterdata, 'renderAndQueueCustomerMasterdataZ01({', 'flow must call the gateway')
mustInclude(masterdata, 'z01_render_gateway_blocked', 'blocked render is persisted as controlled blocker')
const masterdataSrc = read(masterdata)
const prepareIdx = masterdataSrc.indexOf('export async function prepareAndQueueProdatZ01FromDataRequest')
const tail = masterdataSrc.slice(prepareIdx)
if (tail.includes('finalizeOutboundDraft({')) {
  failures.push('prepareAndQueueProdatZ01FromDataRequest must not call finalizeOutboundDraft inline (gateway only)')
}
if (tail.includes('queuePreparedEdielMessage({')) {
  failures.push('prepareAndQueueProdatZ01FromDataRequest must not queue messages inline (gateway only)')
}

// Idempotent reuse re-validates stale intents (draft rows can never slip back).
mustInclude(engine, 'idempotent_reuse_revalidation', 'idempotent hit must re-run the validation gate')
mustInclude(engine, 'alreadyRenderedOrQueued', 'rendered/queued intents are not churned')

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`)
  process.exit(1)
}
console.log('gridex-ediel-intent-outbox-bridge-regression: all checks passed')
