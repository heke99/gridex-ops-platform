#!/usr/bin/env node
// Regression: real tenant simplification of the customer card.
//
// Proves the customer card is ONE structured anchor-based page (not tab-driven)
// and that the tenant view never leaks technical Ediel/provider identifiers.

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
const assert = (condition, message) => {
  if (!condition) {
    console.error(`FAIL: ${message}`)
    process.exitCode = 1
  } else {
    console.log(`OK: ${message}`)
  }
}

const page = read('app/admin/customers/[id]/page.tsx')
const anchors = read('lib/customer-operations/customerCardAnchors.ts')
const legacyRedirect = read('components/admin/customers/CustomerCardLegacyTabRedirect.tsx')
const tenantView = read('lib/customer-operations/customerCardTenantView.ts')

// 1) One-page anchor navigation: all required anchors exist.
for (const anchor of [
  '#overview',
  '#avtal',
  '#anlaggning',
  '#data-requests',
  '#leverantorsbyte',
  '#fakturering',
  '#anteckningar',
  '#tekniskt',
]) {
  assert(page.includes(anchor), `quick navigation exposes ${anchor} anchor`)
}

// 2) Tab navigation is no longer the primary UX.
assert(!page.includes('function CustomerWorkspaceTabNav'), 'dead CustomerWorkspaceTabNav component is removed')
assert(!page.includes('?tab='), 'customer page generates no ?tab= links (anchors only)')

// 3) Legacy ?tab= deep links are mapped to anchors (not broken).
assert(anchors.includes('customerCardAnchor'), 'shared anchor mapping helper exists')
assert(anchors.includes('leverantorsbyte') && anchors.includes('anlaggning'), 'anchor map covers switch + facility anchors')
assert(anchors.includes('supplier-switch') && anchors.includes('facility:'), 'anchor map maps legacy supplier-switch + facility tab ids')
assert(page.includes('customerCardAnchor(') && page.includes('customerTabHref'), 'deep-link href resolves through the anchor map')
assert(legacyRedirect.includes("searchParams.delete('tab')") && legacyRedirect.includes('scrollIntoView'), 'legacy ?tab= is mapped to an anchor and the param is cleaned')
assert(page.includes('CustomerCardLegacyTabRedirect'), 'page mounts the legacy tab redirect helper')

// 4) Heavy / technical data is gated to platform admins (tenant page stays light).
for (const flag of [
  'const needsEdielData = isPlatformAdmin',
  'const needsAuditLogs = isPlatformAdmin',
  'const needsCommunicationLogs = isPlatformAdmin',
  'const needsPowerScopes = isPlatformAdmin',
]) {
  assert(page.includes(flag), `tenant page does not fetch heavy data: ${flag}`)
}

// 5) No technical leakage in the tenant view model (operational sections).
for (const leak of [
  'provider_message_id',
  'route_profile_id',
  'UNB',
  'UNH',
  'smtp',
  'imap',
]) {
  assert(!tenantView.includes(leak), `tenant view model has no technical token: ${leak}`)
}

if (process.exitCode) process.exit(process.exitCode)
console.log('Customer card real tenant simplification regression passed')
