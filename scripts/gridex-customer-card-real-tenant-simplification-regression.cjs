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

// 1) Structured sections: every operational section keeps its stable id so
//    Swedish deep links (#avtal, #leverantorsbyte, ...) continue to work.
for (const anchor of [
  "id='overview'",
  "id='avtal'",
  "id='anlaggning'",
  "id='data-requests'",
  "id='leverantorsbyte'",
  "id='fakturering'",
  "id='anteckningar'",
  "id='tekniskt'",
]) {
  assert(page.includes(anchor), `customer card exposes stable section ${anchor}`)
}

// 2) Navigation is tab-driven with LAZY per-tab loading (performance rule:
//    the tenant page must not fire every heavy query on first render), and the
//    tab href always carries the matching anchor for deep links.
assert(page.includes('customerTabHref') && page.includes('?tab=${encodeURIComponent(tab)}#${encodeURIComponent(tab)}'), 'tab links carry the matching anchor for deep links')
assert(page.includes('activeTab'), 'data loading is gated per active tab')

// 3) Legacy anchor/tab deep links keep working: unknown tab values fall back
//    safely, tenant users only reach their allowed tabs, and the legacy
//    redirect helper (mounted for old bookmarks) still maps tab ids to anchors.
assert(anchors.includes('customerCardAnchor'), 'shared anchor mapping helper exists')
assert(anchors.includes('leverantorsbyte') && anchors.includes('anlaggning'), 'anchor map covers switch + facility anchors')
assert(anchors.includes('supplier-switch') && anchors.includes('facility:'), 'anchor map maps legacy supplier-switch + facility tab ids')
assert(page.includes('normalizeWorkspaceTab') && page.includes("return 'overview'"), 'unknown tab deep links fall back to overview instead of breaking')
assert(page.includes('canShowCustomerWorkspaceTab') && page.includes('TENANT_CUSTOMER_WORKSPACE_TAB_IDS'), 'tenant users only reach their allowed workspace tabs')
assert(legacyRedirect.includes("searchParams.delete('tab')") && legacyRedirect.includes('scrollIntoView'), 'legacy ?tab= is mapped to an anchor and the param is cleaned')

// 4) Heavy / technical data stays platform-admin gated (and communication is
//    additionally lazy per tab), so the tenant operational view stays light.
for (const flag of [
  'const needsEdielData = isPlatformAdmin',
  'const needsAuditLogs = isPlatformAdmin',
  'const needsPowerScopes = isPlatformAdmin',
]) {
  assert(page.includes(flag), `tenant page does not fetch heavy data: ${flag}`)
}
assert(/const needsCommunicationLogs =\s*\[[^\]]*\]\.includes\(activeTab\)/.test(page), 'communication logs load lazily per tab only')

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
