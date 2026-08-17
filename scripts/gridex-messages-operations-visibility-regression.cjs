#!/usr/bin/env node
// Regression: Messages page operational visibility
// Verifies operational pre-message rows stay visible without duplicating rows
// that already have a canonical ediel_messages relation.

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

assert(/outbound_requests/.test(messagesPage), 'messages/page.tsx: queries outbound_requests table')
assert(/grid_owner_data_requests/.test(messagesPage), 'messages/page.tsx: queries grid_owner_data_requests table')
assert(/ediel_messages/.test(messagesPage), 'messages/page.tsx: still queries ediel_messages table')
assert(/Meddelande ej skapat|Väntar på finalisering|Uppgiftsbegäran|Förbereds/.test(messagesPage), 'messages/page.tsx: shows Swedish operational status labels for pre-message rows')

// The current schema uses the canonical outbound_request -> ediel_messages FK
// relation rather than a legacy scalar ediel_message_id column. Filtering the
// embedded relation to null has the same business invariant: only rows that do
// not yet have a message may appear as pre-message operational rows.
assert(
  /linked_ediel_messages:ediel_messages!ediel_messages_outbound_request_id_fkey\(id\)/.test(messagesPage) &&
    /\.is\('linked_ediel_messages', null\)/.test(messagesPage),
  'messages/page.tsx: outbound_requests query excludes rows already linked to ediel_messages'
)

assert(
  /pending.*queued.*processing|\.in\(.*status.*pending/.test(messagesPage) || /status.*in.*pending/.test(messagesPage),
  'messages/page.tsx: grid_owner_data_requests filtered by pending/queued/processing status'
)
assert(
  /companyId.*outbound|outbound.*companyId|scope\.companyId.*outbound|outbound.*scope\.companyId/s.test(messagesPage),
  'messages/page.tsx: outbound_requests query applies company scope filter'
)
assert(
  /companyId.*godr|godr.*companyId|scope\.companyId.*godr|godr.*scope\.companyId|grid_owner_data_requests[\s\S]{0,400}scope\.companyId/s.test(messagesPage),
  'messages/page.tsx: grid_owner_data_requests query applies company scope filter'
)
assert(/showOperationalRows/.test(messagesPage), 'messages/page.tsx: showOperationalRows flag controls when pre-message rows are shown')
assert(/isPlatformAdmin/.test(messagesPage), 'messages/page.tsx: isPlatformAdmin check present for showing technical details')
assert(/Utgående.*outbound|outbound.*Utgående/s.test(messagesPage), 'messages/page.tsx: outbound operational rows labelled "Utgående"')
assert(/\.not\('status', 'in', '\(\"sent\",\"completed\",\"cancelled\"\)'\)/.test(messagesPage), 'messages/page.tsx: pre-message outbound query includes failed rows and excludes only terminal rows')
assert(/Uppgiftsbegäran \/ PRODAT Z01/.test(messagesPage), 'messages/page.tsx: labels failed Z01 outbound as "Uppgiftsbegäran / PRODAT Z01"')
assert(/Route profile:/.test(messagesPage) && /Öppna kundkort/.test(messagesPage), 'messages/page.tsx: failed outbound row shows route/profile readiness and a customer link')

console.log('\n✓ Messages operations visibility regression passed.')
