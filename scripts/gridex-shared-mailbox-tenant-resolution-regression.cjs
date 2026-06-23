#!/usr/bin/env node
// Regression: Shared mailbox tenant resolution
// Verifies:
// 1. Inbound does NOT resolve tenant from the mailbox alone (shared mailbox is
//    stored with company_id null; mailbox tenant is only a conflict check).
// 2. Inbound uses Ediel ID / subaddress / application reference / message context.
// 3. Production/test mailbox + environment are not mixed (env-scoped lookups).
// 4. Unresolved / ambiguous inbound goes to manual review.

const fs = require('fs')
const path = require('path')

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const assert = (condition, message) => {
  if (!condition) {
    console.error(`\u274c ${message}`)
    process.exit(1)
  }
  console.log(`\u2705 ${message}`)
}

const poller = read('lib/inbound-mail/edielMailboxPoller.ts')
const resolver = read('lib/ediel/tenant/resolveInboundTenant.ts')
const processor = read('lib/inbound-mail/edielInboundProcessor.ts')

// ---- 1. Shared mailbox stores company_id null; never tenant by mailbox alone ----
assert(
  /isPlatformSharedMailbox/.test(poller),
  'edielMailboxPoller.ts: detects platform shared mailbox (isPlatformSharedMailbox)',
)
assert(
  /isPlatformSharedMailbox\(input\.mailbox\)\s*\?\s*null/.test(poller.replace(/\s+/g, ' ')) ||
    /\?\s*null\s*:\s*input\.mailbox\.company_id/.test(poller.replace(/\s+/g, ' ')),
  'edielMailboxPoller.ts: shared mailbox stores company_id = null (tenant not from mailbox)',
)

// ---- 2. Inbound resolution uses EDIFACT identity signals ----
for (const signal of ['ediel_id', 'subaddress', 'application_reference', 'message_family']) {
  assert(resolver.includes(signal), `resolveInboundTenant.ts: uses ${signal} as a resolution signal`)
}
assert(
  /ediel_route_profiles/.test(resolver) && /ediel_actor_settings/.test(resolver),
  'resolveInboundTenant.ts: resolves tenant from route profiles + actor settings (not mailbox)',
)

// ---- 3. Environment is never mixed ----
assert(
  /\.eq\(['"]environment['"], input\.environment\)/.test(resolver) || /environment.*input\.environment/.test(resolver),
  'resolveInboundTenant.ts: scopes resolution by environment',
)

// ---- 4. Ambiguous / unresolved => manual review ----
assert(
  /status:\s*'ambiguous'/.test(resolver) && /status:\s*'unresolved'/.test(resolver),
  'resolveInboundTenant.ts: returns ambiguous/unresolved statuses (fails closed)',
)
assert(
  /manual_review/.test(processor),
  'edielInboundProcessor.ts: routes unresolved/ambiguous inbound to manual_review',
)

console.log('\n\u2713 Shared mailbox tenant resolution regression passed.')
