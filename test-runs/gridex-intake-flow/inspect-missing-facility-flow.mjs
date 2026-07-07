import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE

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

async function print(label, promise) {
  const { data, error } = await promise
  console.log(`\n# ${label}`)
  if (error) {
    console.log(JSON.stringify({ error }, null, 2))
    return null
  }
  console.log(JSON.stringify(data, null, 2))
  return data
}

function containsAny(row, values) {
  const text = JSON.stringify(row)
  return values.some((value) => value && text.includes(value))
}

await print(
  '1. Customer',
  supabase
    .from('customers')
    .select('*')
    .eq('id', ids.customerId)
)

await print(
  '2. Customer site raw',
  supabase
    .from('customer_sites')
    .select('*')
    .eq('id', ids.siteId)
)

await print(
  '3. Power of attorney raw',
  supabase
    .from('powers_of_attorney')
    .select('*')
    .eq('id', ids.poaId)
)

await print(
  '4. Authorization documents',
  supabase
    .from('customer_authorization_documents')
    .select('*')
    .eq('customer_id', ids.customerId)
    .order('created_at', { ascending: false })
)

await print(
  '5. Authorization scopes',
  supabase
    .from('authorization_scopes')
    .select('*')
    .eq('customer_id', ids.customerId)
    .order('created_at', { ascending: false })
)

await print(
  '6. Grid owner information request raw',
  supabase
    .from('grid_owner_information_requests')
    .select('*')
    .eq('id', ids.manualRequestId)
)

const manualEmailRows = await print(
  '7. Recent manual_email_outbox rows, filtered locally',
  supabase
    .from('manual_email_outbox')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)
)

if (Array.isArray(manualEmailRows)) {
  const matches = manualEmailRows.filter((row) =>
    containsAny(row, [ids.manualRequestId, ids.customerId])
  )
  console.log('\n# 7B. Matching manual_email_outbox rows')
  console.log(JSON.stringify(matches, null, 2))
}

await print(
  '8. EDIEL intents for customer',
  supabase
    .from('ediel_message_intents')
    .select('*')
    .eq('customer_id', ids.customerId)
    .order('created_at', { ascending: false })
)

await print(
  '9. Outbound requests for customer',
  supabase
    .from('outbound_requests')
    .select('*')
    .eq('customer_id', ids.customerId)
    .order('created_at', { ascending: false })
)

await print(
  '10. Customer communications',
  supabase
    .from('customer_communications')
    .select('*')
    .eq('customer_id', ids.customerId)
    .order('created_at', { ascending: false })
)

console.log('\n# What we are checking')
console.log(`
Expected:
- customer_sites has grid_area_code LKA
- customer_sites has price_area_code SE4
- customer_sites has no facility/anläggnings-ID
- grid_owner_information_requests exists for the manual request
- manual_email_outbox has a row linked to request/customer
- ediel_message_intents may contain Z01, but must NOT be rendered/queued/sent
- outbound_requests may exist, but must be blocked/draft/not dispatched if facility is missing
`)
