#!/usr/bin/env node
const fs = require('fs')
function read(path) { return fs.readFileSync(path, 'utf8') }
function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`)
    process.exitCode = 1
  } else {
    console.log(`ok: ${message}`)
  }
}

const workflow = read('lib/customer-operations/customerCardWorkflow.ts')
const card = read('components/admin/customers/CustomerBusinessActionsCard.tsx')
const prodat = read('lib/ediel/flows/prodatCustomerMasterdata.ts')
const finalizer = read('lib/customer-operations/z01Finalizer.ts')

assert(/canContinueFinalization/.test(workflow), 'workflow exposes canContinueFinalization')
assert(/production_route_profile_not_ready/.test(workflow) && /outboundRequestId/.test(workflow) && /!edielMessageId/.test(workflow), 'workflow shows continuation for stale production_route_profile_not_ready with outbound but no message')
assert(/Fortsätt Z01-finalisering/.test(card), 'customer UI shows Fortsätt Z01-finalisering')
assert(/repairZ01CustomerInfoRequestAction/.test(card), 'continuation reuses server-side Z01 repair/finalizer action')
assert(/Ingen SMTP skickas direkt/.test(card), 'UI states continuation does not send SMTP directly')
assert(/status\?: 'failed' \| 'prepared' \| 'queued' \| null/.test(prodat), 'persistOutboundRouteDecision supports successful prepared/queued status')
assert(/update\.blocking_reasons\s*=\s*\[\]/.test(prodat), 'successful fresh route decision clears stale outbound blocking reasons')
assert(/update\.required_admin_actions\s*=\s*\[\]/.test(prodat), 'successful fresh route decision clears stale admin actions')
assert(/update\.failure_reason\s*=\s*null/.test(prodat), 'successful fresh route decision clears stale failure reason')
assert(/status: 'prepared'/.test(prodat), 'Z01 success path persists prepared status before draft finalization')
assert(/status:\s*"z01_prepared"/.test(finalizer), 'finalizer syncs customer_info_requests to z01_prepared')
assert(/blocker_code:\s*null/.test(finalizer) && /blocker_reason:\s*null/.test(finalizer), 'finalizer clears customer_info_request blocker after success')
assert(/smtpSent:\s*false/.test(finalizer), 'finalizer result confirms no direct SMTP send')

if (process.exitCode) process.exit(process.exitCode)
