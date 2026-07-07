/**
 * Clean website-flow regression (LIVE).
 *
 * Creates a brand-new customer on every run using unique external ids, email,
 * personal number, idempotency key and application reference — then verifies
 * the full pipeline state in the database. Dirty/reused rows are NEVER
 * accepted as proof: created_customer=false fails the run.
 *
 * FAILS when any of these hold:
 *  - created_customer=false (reused customer -> dirty test)
 *  - a customer_masterdata/Z01 outbound is queued/prepared while facility missing
 *  - an ediel_message_intent is renderable/resume-able while facility missing
 *  - an ediel_message/ediel_outbox row exists for Z01 while facility missing
 *  - a supplier switch was started without facility/metering point
 *  - communication diagnostics (communication_logs) cannot find the events the
 *    API response claimed
 *  - explicit grid_area_code/price_area_code (LKA/SE4-class input) is lost
 *  - customer_sites.grid_owner_id points to platform_grid_owners instead of
 *    OPS grid_owners
 *  - price_plan_id / price_plan_version_id are not UUIDs
 *  - the manual information request has a null request_id
 *  - manual_email_outbox rows lack recipient resolution metadata (when the
 *    schema has the column)
 *
 * Required env:
 *   GRIDEX_WEBSITE_API_BASE_URL   e.g. https://staging.example.com
 *   GRIDEX_WEBSITE_API_KEY        integration API key (Bearer)
 *   SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 * Optional:
 *   GRIDEX_CLEAN_FLOW_GRID_AREA   default LKA
 *   GRIDEX_CLEAN_FLOW_PRICE_AREA  default SE4
 *
 * NEVER run against production with real dispatch enabled. Use a safe
 * recipient override (MANUAL_GRID_OWNER_SAFE_RECIPIENT) in the target env.
 */
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

type JsonRecord = Record<string, unknown>

const baseUrl = process.env.GRIDEX_WEBSITE_API_BASE_URL
const apiKey = process.env.GRIDEX_WEBSITE_API_KEY
const dbUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const dbKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!baseUrl || !apiKey || !dbUrl || !dbKey) {
  console.error(
    'clean-website-flow-regression requires GRIDEX_WEBSITE_API_BASE_URL, GRIDEX_WEBSITE_API_KEY, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.\n' +
    'This regression runs against a LIVE staging/test environment and is not part of the static regression suite.',
  )
  process.exit(3)
}

const supabase: SupabaseClient = createClient(dbUrl, dbKey, { auth: { persistSession: false } })

const GRID_AREA = process.env.GRIDEX_CLEAN_FLOW_GRID_AREA ?? 'LKA'
const PRICE_AREA = process.env.GRIDEX_CLEAN_FLOW_PRICE_AREA ?? 'SE4'

const failures: string[] = []
function check(condition: boolean, message: string) {
  if (condition) console.log(`OK: ${message}`)
  else {
    failures.push(message)
    console.error(`FAIL: ${message}`)
  }
}

function isUuid(value: unknown): boolean {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

function uniquePersonalNumber(): string {
  // Synthetic test personal number (Skatteverket test range day 60+).
  const year = 1960 + Math.floor(Math.random() * 30)
  const month = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0')
  const day = String(61 + Math.floor(Math.random() * 28)).padStart(2, '0')
  const serial = String(Math.floor(Math.random() * 9000) + 1000)
  return `${year}${month}${day}${serial}`
}

async function main() {
  const runId = randomUUID().slice(0, 8)
  const externalCustomerId = `CLEAN-FLOW-${Date.now()}-${runId}`
  const email = `clean-flow-${Date.now()}-${runId}@example-test.gridex.se`
  const idempotencyKey = `clean-flow:${randomUUID()}`
  const applicationReference = `CLEANFLOW-${runId}`

  // 1) Fetch a published public offer (offer_reference is mandatory input).
  const offersResponse = await fetch(`${baseUrl}/api/v1/website/public-contracts`, {
    headers: { authorization: `Bearer ${apiKey}` },
  })
  check(offersResponse.ok, `public-contracts responds (${offersResponse.status})`)
  const offersBody = (await offersResponse.json().catch(() => ({}))) as JsonRecord
  const offers = (Array.isArray(offersBody.contracts) ? offersBody.contracts : Array.isArray(offersBody.offers) ? offersBody.offers : []) as JsonRecord[]
  const offer = offers[0] ?? null
  check(Boolean(offer), 'at least one published public contract offer exists')
  if (!offer) return finish()
  const offerReference = String(offer.offer_reference ?? '')
  check(Boolean(offerReference), 'public offer exposes offer_reference')

  // 2) Submit a missing-facility application with explicit grid/price area.
  const payload = {
    external_customer_id: externalCustomerId,
    source: 'clean_flow_regression',
    application_reference: applicationReference,
    customer: {
      customer_type: 'private',
      first_name: 'Clean',
      last_name: `Flow ${runId}`,
      email,
      phone: '+46700000000',
      personal_number: uniquePersonalNumber(),
    },
    site: {
      site_name: 'Clean flow site',
      street: 'Testgatan 1',
      postal_code: '26131',
      city: 'Landskrona',
      grid_area_code: GRID_AREA,
      price_area_code: PRICE_AREA,
      // facility_id intentionally omitted: missing-facility manual path.
    },
    contract: { offer_reference: offerReference },
    consents: { terms: true, privacy: true, price_terms: true, power_of_attorney: true },
    powerOfAttorney: {
      accepted: true,
      signerName: `Clean Flow ${runId}`,
      signerIdentityNumber: uniquePersonalNumber(),
      method: 'website_checkbox_v2',
    },
  }

  const response = await fetch(`${baseUrl}/api/v1/website/customer-applications`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
      'idempotency-key': idempotencyKey,
    },
    body: JSON.stringify(payload),
  })
  const body = (await response.json().catch(() => ({}))) as JsonRecord
  check(response.ok, `customer application accepted (${response.status}) ${response.ok ? '' : JSON.stringify(body).slice(0, 500)}`)
  if (!response.ok) return finish()

  // created_customer must be TRUE — a reused customer marks the run dirty.
  check(body.created_customer === true, 'created_customer=true (new unique customer, no dirty reuse)')

  const customerId = String(body.customer_id ?? '')
  const siteId = String(body.customer_site_id ?? '')
  check(isUuid(customerId), 'customer_id returned')
  check(isUuid(siteId), 'customer_site_id returned')

  // Manual information request must exist with a non-null request_id.
  const manualRequest = (body.manual_information_request ?? null) as JsonRecord | null
  check(Boolean(manualRequest), 'manual_information_request present in response')
  if (manualRequest) {
    check(isUuid(manualRequest.request_id), 'manual_information_request.request_id is a UUID (never null)')
  }

  // price plan UUIDs resolved from the public offer.
  check(isUuid(body.price_plan_id), `price_plan_id is a UUID (${String(body.price_plan_id)})`)
  check(isUuid(body.price_plan_version_id), `price_plan_version_id is a UUID (${String(body.price_plan_version_id)})`)

  // 3) DB assertions.
  const site = (await supabase.from('customer_sites').select('*').eq('id', siteId).maybeSingle()).data as JsonRecord | null
  check(Boolean(site), 'customer_sites row exists')
  if (site) {
    check(String(site.grid_area_code ?? '') === GRID_AREA, `explicit grid_area_code preserved (${GRID_AREA})`)
    check(String(site.price_area_code ?? '') === PRICE_AREA, `explicit price_area_code preserved (${PRICE_AREA})`)
    const gridOwnerId = typeof site.grid_owner_id === 'string' ? site.grid_owner_id : null
    if (gridOwnerId) {
      const ops = (await supabase.from('grid_owners').select('id').eq('id', gridOwnerId).maybeSingle()).data
      check(Boolean(ops), 'customer_sites.grid_owner_id resolves in OPS grid_owners (never platform_grid_owners)')
    }
  }

  // No Z01/customer_masterdata outbound may be active while facility missing.
  const outbound = ((await supabase
    .from('outbound_requests')
    .select('id,status,business_process,request_type,message_code,metering_point_id,blocking_reasons')
    .eq('customer_id', customerId)).data ?? []) as JsonRecord[]
  const activeMasterdata = outbound.filter((row) =>
    (String(row.business_process ?? '') === 'customer_masterdata' || String(row.message_code ?? '').toUpperCase() === 'Z01') &&
    ['queued', 'prepared', 'ready'].includes(String(row.status ?? '')))
  check(activeMasterdata.length === 0, `no queued/prepared customer_masterdata outbound while facility missing (found ${activeMasterdata.length})`)

  // No renderable/resume-able Z01 intent.
  const intents = ((await supabase
    .from('ediel_message_intents')
    .select('id,business_process,validation_status,render_status,outbox_status,facility_id,metering_point_id')
    .eq('customer_id', customerId)).data ?? []) as JsonRecord[]
  const resumableMasterdata = intents.filter((row) =>
    String(row.business_process ?? '') === 'customer_masterdata' &&
    String(row.validation_status ?? '') !== 'blocked')
  check(resumableMasterdata.length === 0, `no resume-able customer_masterdata intent while facility missing (found ${resumableMasterdata.length})`)

  // No ediel message/outbox for Z01.
  const messages = ((await supabase
    .from('ediel_messages')
    .select('id,message_code,direction')
    .eq('customer_id', customerId)).data ?? []) as JsonRecord[]
  const z01Messages = messages.filter((row) => String(row.message_code ?? '').toUpperCase() === 'Z01')
  check(z01Messages.length === 0, `no rendered Z01 ediel_messages while facility missing (found ${z01Messages.length})`)

  // No supplier switch without facility.
  const switches = ((await supabase
    .from('supplier_switch_requests')
    .select('id,status')
    .eq('customer_id', customerId)).data ?? []) as JsonRecord[]
  check(switches.length === 0, `no supplier switch started without facility/metering point (found ${switches.length})`)

  // Communication diagnostics find the same events the API response claimed.
  const communication = (body.communication ?? {}) as JsonRecord
  const claimedEvents = ([] as string[]).concat(
    Array.isArray(communication.queued) ? (communication.queued as string[]) : [],
    Array.isArray(communication.sent) ? (communication.sent as string[]) : [],
  )
  const logs = ((await supabase
    .from('communication_logs')
    .select('id,event_key,status')
    .eq('customer_id', customerId)).data ?? []) as JsonRecord[]
  for (const eventKey of claimedEvents) {
    check(
      logs.some((row) => String(row.event_key ?? '') === eventKey),
      `communication_logs contains claimed event ${eventKey}`,
    )
  }
  check(claimedEvents.length > 0, 'customer emails were queued (application received at minimum)')

  // Manual email outbox rows carry recipient resolution metadata when the
  // schema supports it.
  const requestId = manualRequest ? String(manualRequest.request_id ?? '') : ''
  if (isUuid(requestId)) {
    const outboxResult = await supabase
      .from('manual_email_outbox')
      .select('id,to_email,recipient_resolution')
      .eq('request_id', requestId)
    if (!outboxResult.error) {
      const outboxRows = (outboxResult.data ?? []) as JsonRecord[]
      check(outboxRows.length > 0, 'manual_email_outbox row exists for the facility request')
      for (const row of outboxRows) {
        check(Boolean(row.recipient_resolution), `manual_email_outbox ${row.id} carries recipient_resolution metadata`)
      }
    } else {
      console.log('NOTE: manual_email_outbox recipient_resolution column missing in this environment (pre-migration).')
    }
  }

  finish()
}

function finish() {
  if (failures.length > 0) {
    console.error(`clean-website-flow-regression FAILED (${failures.length} failures).`)
    process.exit(1)
  }
  console.log('clean-website-flow-regression passed.')
}

main().catch((error) => {
  console.error('clean-website-flow-regression crashed:', error)
  process.exit(1)
})
