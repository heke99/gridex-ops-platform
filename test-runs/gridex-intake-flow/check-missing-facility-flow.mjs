import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE

if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(url, key, {
  auth: { persistSession: false },
})

const ids = {
  customerId: process.env.CUSTOMER_ID,
  siteId: process.env.CUSTOMER_SITE_ID,
  manualRequestId: process.env.MANUAL_REQUEST_ID,
  poaId: process.env.POA_ID,
}

async function q(label, table, queryFn) {
  const { data, error } = await queryFn(supabase.from(table))
  console.log(`\n# ${label}`)
  if (error) {
    console.log(JSON.stringify({ error }, null, 2))
    return
  }
  console.log(JSON.stringify(data, null, 2))
}

await q('1. Customer', 'customers', (t) =>
  t.select('id, customer_number, email, created_at')
    .eq('id', ids.customerId)
)

await q('2. Customer site - ska ha LKA/SE4 och sakna facility', 'customer_sites', (t) =>
  t.select('id, customer_id, grid_area_code, price_area_code, grid_owner_id, facility_id, metering_point_id, status, created_at, updated_at')
    .eq('id', ids.siteId)
)

await q('3. Power of attorney', 'powers_of_attorney', (t) =>
  t.select('id, customer_id, document_id, status, externally_sendable, created_at')
    .eq('id', ids.poaId)
)

await q('4. Authorization documents', 'customer_authorization_documents', (t) =>
  t.select('id, customer_id, power_of_attorney_id, status, document_type, created_at')
    .eq('customer_id', ids.customerId)
    .order('created_at', { ascending: false })
)

await q('5. Authorization scopes', 'authorization_scopes', (t) =>
  t.select('id, customer_id, authorization_document_id, scope_type, status, created_at')
    .eq('customer_id', ids.customerId)
    .order('created_at', { ascending: false })
)

await q('6. Manual grid owner information request', 'grid_owner_information_requests', (t) =>
  t.select('id, customer_id, site_id, status, request_type, channel, case_reference, created_at, sent_at, completed_at')
    .eq('id', ids.manualRequestId)
)

await q('7. Manual email outbox', 'manual_email_outbox', (t) =>
  t.select('id, status, recipient_email, subject, created_at, sent_at, error_message')
    .eq('request_id', ids.manualRequestId)
    .order('created_at', { ascending: false })
)

await q('8. EDIEL intents - ska helst vara tomt eller ingen skickad Z01', 'ediel_message_intents', (t) =>
  t.select('id, business_process, message_code, render_status, outbox_status, ediel_message_id, outbound_request_id, created_at')
    .eq('customer_id', ids.customerId)
    .order('created_at', { ascending: false })
)

await q('9. Customer communications', 'customer_communication_logs', (t) =>
  t.select('id, event_key, recipient_email, subject, status, provider, created_at, sent_at, error_message')
    .eq('customer_id', ids.customerId)
    .order('created_at', { ascending: false })
)
