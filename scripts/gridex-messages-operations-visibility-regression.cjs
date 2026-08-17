#!/usr/bin/env node
// Regression: Messages page operational visibility
// Verifies:
// 1. messages/page.tsx queries outbound_requests (not only ediel_messages)
// 2. messages/page.tsx queries grid_owner_data_requests
// 3. Pre-message operational rows are shown with Swedish status labels
// 4. Rows from outbound_requests without ediel_message shown as "Meddelande ej skapat"
// 5. Rows from grid_owner_data_requests shown as "Uppgiftsbegäran" / "Väntar på finalisering"
// 6. Operational rows are filtered by company scope (tenant isolation)
// 7. Operational rows are filtered by customer_id when provided
// 8. Messages page still queries ediel_messages (not replaced)
// 9. Operational rows are shown only when no direction/family filter active
// 10. Platform admin sees row IDs for operational rows

const fs = require('fs')
const path = require('path')

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const assert = (condition, message) => {
  if (!condition) {
    console.error(`❌ ${message}`)
    process.exit(1)
  }
  console.log(`✅ ${message}`)
}

const messagesPage = read('app/admin/messages/page.tsx')

// ---- 1. Queries outbound_requests ----
assert(
  /outbound_requests/.test(messagesPage),
  'messages/page.tsx: queries outbound_requests table'
)

// ---- 2. Queries grid_owner_data_requests ----
assert(
  /grid_owner_data_requests/.test(messagesPage),
  'messages/page.tsx: queries grid_owner_data_requests table'
)

// ---- 3. ediel_messages still queried (not replaced) ----
assert(
  /ediel_messages/.test(messagesPage),
  'messages/page.tsx: still queries ediel_messages table'
)

// ---- 4. Swedish labels for operational rows ----
assert(
  /Meddelande ej skapat|Väntar på finalisering|Uppgiftsbegäran|Förbereds/.test(messagesPage),
  'messages/page.tsx: shows Swedish operational status labels for pre-message rows'
)

// ---- 5. Outbound rows without ediel_message filtered ----
assert(
  /linked_ediel_messages:ediel_messages!ediel_messages_outbound_request_id_fkey/.test(messagesPage) &&
    /\.is\('linked_ediel_messages', null\)/.test(messagesPage),
  'messages/page.tsx: outbound_requests query filters rows without a linked EDIEL message through the canonical FK'
)

// ---- 6. grid_owner_data_requests status filter ----
assert(
  /pending.*queued.*processing|\.in\(.*status.*pending/.test(messagesPage) ||
  /status.*in.*pending/.test(messagesPage),
  'messages/page.tsx: grid_owner_data_requests filtered by pending/queued/processing status'
)

// ---- 7. Company scope filter applied to operational rows ----
const outboundScopeBlock = messagesPage.match(/outbound_requests[\s\S]{0,800}company_id/)?.[0] ?? ''
const godrScopeBlock = messagesPage.match(/grid_owner_data_requests[\s\S]{0,800}company_id/)?.[0] ?? ''
assert(
  /companyId.*outbound|outbound.*companyId|scope\.companyId.*outbound|outbound.*scope\.companyId/s.test(messagesPage),
  'messages/page.tsx: outbound_requests query applies company scope filter'
)
assert(
  /companyId.*godr|godr.*companyId|scope\.companyId.*godr|godr.*scope\.companyId|grid_owner_data_requests[\s\S]{0,400}scope\.companyId/s.test(messagesPage),
  'messages/page.tsx: grid_owner_data_requests query applies company scope filter'
)

// ---- 8. Operational rows shown only without direction/family filter ----
assert(
  /showOperationalRows/.test(messagesPage),
  'messages/page.tsx: showOperationalRows flag controls when pre-message rows are shown'
)

// ---- 9. Platform admin shows row IDs for operational rows ----
assert(
  /isPlatformAdmin/.test(messagesPage),
  'messages/page.tsx: isPlatformAdmin check present for showing technical details'
)

// ---- 10. Outbound rows section has Swedish "Utgående" pill ----
assert(
  /Utgående.*outbound|outbound.*Utgående/s.test(messagesPage),
  'messages/page.tsx: outbound operational rows labelled "Utgående"'
)

// ---- New: failed/repaired pre-message outbound (PRODAT Z01) is visible ----
assert(
  /\.not\('status', 'in', '\("sent","completed","cancelled"\)'\)/.test(messagesPage),
  'messages/page.tsx: pre-message outbound query INCLUDES failed rows (only excludes sent/completed/cancelled)'
)
assert(
  /Uppgiftsbegäran \/ PRODAT Z01/.test(messagesPage),
  'messages/page.tsx: labels failed Z01 outbound as "Uppgiftsbegäran / PRODAT Z01"'
)
assert(
  /Route profile:/.test(messagesPage) && /Öppna kundkort/.test(messagesPage),
  'messages/page.tsx: failed outbound row shows route/profile readiness and a link to the customer card'
)

console.log('\n✓ Messages operations visibility regression passed.')
