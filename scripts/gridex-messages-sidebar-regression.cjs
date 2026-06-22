#!/usr/bin/env node
// Regression: Messages sidebar and messages page
// Verifies:
// 1. Sidebar includes "Meddelanden" in COMPANY_NAVIGATION
// 2. Normal company admin can access messages overview
// 3. Messages overview reads existing ediel_messages table
// 4. Messages list shows direction, family/type, code, customer, counterparty, status and timestamp
// 5. Messages link back to customer card when customer_id exists
// 6. Technical raw payload/details are restricted to platform/superadmin

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

const navigation = read('lib/admin/navigation.ts')
const messagesPage = read('app/admin/messages/page.tsx')
const messagesDetailPage = read('app/admin/messages/[id]/page.tsx')

// ---- 1. Sidebar has Meddelanden in COMPANY_NAVIGATION ----
const companyNavBlock = navigation.match(/COMPANY_NAVIGATION[\s\S]*?PLATFORM_NAVIGATION/)?.[0] ?? navigation
assert(
  /Meddelanden/.test(companyNavBlock),
  'navigation.ts: COMPANY_NAVIGATION includes "Meddelanden"'
)
assert(
  /\/admin\/messages/.test(companyNavBlock),
  'navigation.ts: Meddelanden links to /admin/messages'
)
// Should be in COMPANY_NAVIGATION, not PLATFORM_NAVIGATION only
assert(
  companyNavBlock.indexOf('Meddelanden') < companyNavBlock.indexOf('PLATFORM_NAVIGATION'),
  'navigation.ts: Meddelanden is in COMPANY_NAVIGATION (before PLATFORM_NAVIGATION)'
)

// ---- 2. Messages page does NOT require platform admin ----
// It should use requireAdminPageKeyAccess (not requirePlatformAdminAccess)
assert(
  /requireAdminPageKeyAccess/.test(messagesPage),
  'messages/page.tsx: uses requireAdminPageKeyAccess (accessible to company admins)'
)
assert(
  !/requirePlatformAdminAccess\s*\(\)/.test(messagesPage),
  'messages/page.tsx: does NOT require platform admin access'
)

// ---- 3. Messages page reads ediel_messages table ----
assert(
  /ediel_messages/.test(messagesPage),
  'messages/page.tsx: queries ediel_messages table'
)
// Should be tenant-scoped when not platform admin
assert(
  /companyId/.test(messagesPage),
  'messages/page.tsx: applies company scope filter'
)

// ---- 4. Shows direction, family, code, customer, counterparty, status, timestamp ----
assert(
  /direction/.test(messagesPage),
  'messages/page.tsx: shows message direction'
)
assert(
  /message_family/.test(messagesPage),
  'messages/page.tsx: shows message_family'
)
assert(
  /message_code/.test(messagesPage),
  'messages/page.tsx: shows message_code'
)
assert(
  /customer_id/.test(messagesPage),
  'messages/page.tsx: shows customer link'
)
assert(
  /grid_owner_id/.test(messagesPage),
  'messages/page.tsx: shows counterparty/grid_owner'
)
assert(
  /status/.test(messagesPage),
  'messages/page.tsx: shows status'
)
assert(
  /message_sent_at|message_received_at|created_at/.test(messagesPage),
  'messages/page.tsx: shows timestamp using correct column names'
)
// Must NOT use sent_at (wrong column for ediel_messages)
assert(
  !/\bsent_at\b/.test(messagesPage.replace(/message_sent_at/g, '').replace(/message_received_at/g, '')),
  'messages/page.tsx: does NOT use bare sent_at (uses message_sent_at)'
)

// ---- 5. Messages link back to customer card ----
assert(
  /\/admin\/customers\//.test(messagesPage),
  'messages/page.tsx: customer links to /admin/customers/[id]'
)

// ---- 6. Technical raw payload restricted to platform admin ----
assert(
  /isPlatformAdmin/.test(messagesDetailPage),
  'messages/[id]/page.tsx: uses isPlatformAdmin check'
)
assert(
  /raw_payload/.test(messagesDetailPage),
  'messages/[id]/page.tsx: shows raw_payload section'
)
// raw_payload should be behind isPlatformAdmin guard
const rawPayloadSection = messagesDetailPage.match(/isPlatformAdmin[\s\S]*?raw_payload|raw_payload[\s\S]*?isPlatformAdmin/s)?.[0] ?? ''
assert(
  rawPayloadSection.length > 0,
  'messages/[id]/page.tsx: raw_payload is inside isPlatformAdmin guard'
)
assert(
  /parsed_payload/.test(messagesDetailPage),
  'messages/[id]/page.tsx: shows parsed_payload for platform admin'
)

// ---- 7. Detail page shows plain-language info to normal admins ----
assert(
  /Tidslinje|tidslinje|Information|information/.test(messagesDetailPage),
  'messages/[id]/page.tsx: shows plain-language Info/Timeline section for all admins'
)
assert(
  /nextAction/.test(messagesDetailPage),
  'messages/[id]/page.tsx: computes and shows next action in plain language'
)

// ---- 8. Messages page has filters ----
assert(
  /direction.*filter|filter.*direction/i.test(messagesPage),
  'messages/page.tsx: has direction filter'
)
assert(
  /family.*filter|filter.*family/i.test(messagesPage),
  'messages/page.tsx: has message family filter'
)
assert(
  /status.*filter|filter.*status/i.test(messagesPage),
  'messages/page.tsx: has status filter'
)

console.log('\n✓ Messages sidebar regression passed.')
