/**
 * Clean website-flow regression (LIVE).
 *
 * Creates a unique customer application through the public Website API, then
 * follows the asynchronous continuation through the documented
 * application_number status endpoint and verifies the canonical database
 * aggregate. Internal UUIDs are obtained only from the service-role database
 * for test assertions; they are never expected in the public HTTP response.
 */
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

type JsonRecord = Record<string, unknown>

const baseUrl = process.env.GRIDEX_WEBSITE_API_BASE_URL
const apiKey = process.env.GRIDEX_WEBSITE_API_KEY
const dbUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const dbKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!baseUrl || !apiKey || !dbUrl || !dbKey) {
  console.error('clean-website-flow-regression requires GRIDEX_WEBSITE_API_BASE_URL, GRIDEX_WEBSITE_API_KEY, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(3)
}

const supabase: SupabaseClient = createClient(dbUrl, dbKey, { auth: { persistSession: false } })
const GRID_AREA = process.env.GRIDEX_CLEAN_FLOW_GRID_AREA ?? 'LKA'
const PRICE_AREA = process.env.GRIDEX_CLEAN_FLOW_PRICE_AREA ?? 'SE4'
const failures: string[] = []

function check(condition: boolean, message: string) {
  if (condition) console.log(`OK: ${message}`)
  else { failures.push(message); console.error(`FAIL: ${message}`) }
}
function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}
function isUuid(value: unknown): boolean {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}
function uniquePersonalNumber(): string {
  const year = 1960 + Math.floor(Math.random() * 30)
  const month = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0')
  const day = String(61 + Math.floor(Math.random() * 28)).padStart(2, '0')
  const serial = String(Math.floor(Math.random() * 9000) + 1000)
  return `${year}${month}${day}${serial}`
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function pollApplicationStatus(applicationNumber: string) {
  let last: JsonRecord = {}
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/v1/website/customer-applications/${encodeURIComponent(applicationNumber)}`, {
      headers: { authorization: `Bearer ${apiKey}` },
    })
    const body = record(await response.json().catch(() => ({})))
    check(response.ok, `application status responds (${response.status})`)
    if (!response.ok) return last
    last = record(body.data)
    const status = String(last.status ?? '')
    if (status && status !== 'processing') return last
    await sleep(2_000)
  }
  return last
}

async function main() {
  const runId = randomUUID().slice(0, 8)
  const externalCustomerId = `CLEAN-FLOW-${Date.now()}-${runId}`
  const email = `clean-flow-${Date.now()}-${runId}@example-test.gridex.se`
  const idempotencyKey = `clean-flow:${randomUUID()}`

  const offersResponse = await fetch(`${baseUrl}/api/v1/website/public-contracts`, {
    headers: { authorization: `Bearer ${apiKey}` },
  })
  const offersBody = record(await offersResponse.json().catch(() => ({})))
  check(offersResponse.ok, `public-contracts responds (${offersResponse.status})`)
  const offersData = record(offersBody.data)
  const offers = (
    Array.isArray(offersData.contracts) ? offersData.contracts :
    Array.isArray(offersBody.contracts) ? offersBody.contracts :
    Array.isArray(offersBody.offers) ? offersBody.offers : []
  ) as JsonRecord[]
  const offer = offers[0]
  check(Boolean(offer), 'at least one published public contract exists')
  if (!offer) return finish()

  const payload = {
    external_customer_id: externalCustomerId,
    source: 'clean_flow_regression',
    application_reference: `CLEANFLOW-${runId}`,
    customer: {
      customer_type: 'private', first_name: 'Clean', last_name: `Flow ${runId}`,
      email, phone: '+46700000000', personal_number: uniquePersonalNumber(),
    },
    site: {
      site_name: 'Clean flow site', street: 'Testgatan 1', postal_code: '26131',
      city: 'Landskrona', grid_area_code: GRID_AREA, price_area_code: PRICE_AREA,
    },
    contract: { offer_reference: String(offer.offer_reference ?? '') },
    consents: { terms: true, privacy: true, price_terms: true, power_of_attorney: true },
    powerOfAttorney: {
      accepted: true, signerName: `Clean Flow ${runId}`,
      signerIdentityNumber: uniquePersonalNumber(), method: 'website_checkbox_v2',
    },
  }

  const response = await fetch(`${baseUrl}/api/v1/website/customer-applications`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', authorization: `Bearer ${apiKey}`,
      'idempotency-key': idempotencyKey,
    },
    body: JSON.stringify(payload),
  })
  const body = record(await response.json().catch(() => ({})))
  const responseData = record(body.data)
  check(response.ok, `customer application accepted (${response.status})`)
  if (!response.ok) return finish()
  check(responseData.created_customer === true, 'created_customer=true (clean customer)')
  const applicationNumber = String(responseData.application_number ?? '')
  check(Boolean(applicationNumber), 'public response returns application_number')
  check(!('application_id' in responseData), 'public response does not expose application_id')
  check(String(responseData.next_step ?? '') === 'automatic_processing' || Boolean(responseData.next_action), 'public response hands off to automatic processing')

  const publicStatus = await pollApplicationStatus(applicationNumber)
  check(String(publicStatus.application_number ?? '') === applicationNumber, 'status endpoint resolves the same application_number')

  const applicationResult = await supabase
    .from('website_customer_applications')
    .select('id,company_id,customer_id,customer_site_id,application_number,price_plan_id,price_plan_version_id,grid_owner_information_request_id,status,next_step')
    .eq('application_number', applicationNumber)
    .eq('external_customer_id', externalCustomerId)
    .maybeSingle()
  check(!applicationResult.error && Boolean(applicationResult.data), 'canonical website application row exists')
  const application = record(applicationResult.data)
  const applicationId = String(application.id ?? '')
  const customerId = String(application.customer_id ?? '')
  const siteId = String(application.customer_site_id ?? '')
  check(isUuid(applicationId), 'internal application UUID exists in database only')
  check(isUuid(customerId), 'canonical customer row linked')
  check(isUuid(siteId), 'canonical customer site linked')
  check(isUuid(application.price_plan_id), 'price_plan_id resolved in canonical row')
  check(isUuid(application.price_plan_version_id), 'price_plan_version_id resolved in canonical row')

  const workflow = await supabase
    .from('customer_application_workflows')
    .select('id,state,next_action')
    .eq('company_id', application.company_id)
    .eq('customer_application_id', applicationId)
    .maybeSingle()
  check(!workflow.error && Boolean(workflow.data), 'canonical application workflow exists')
  const jobs = await supabase
    .from('customer_operation_jobs')
    .select('id,status,job_type')
    .eq('company_id', application.company_id)
    .eq('job_type', 'customer_application_continuation')
    .contains('payload', { application_id: applicationId })
  check(!jobs.error && (jobs.data?.length ?? 0) > 0, 'durable continuation job exists')

  const siteResult = await supabase.from('customer_sites').select('*').eq('id', siteId).eq('company_id', application.company_id).maybeSingle()
  const site = record(siteResult.data)
  check(String(site.grid_area_code ?? '') === GRID_AREA, `grid_area_code preserved (${GRID_AREA})`)
  check(String(site.price_area_code ?? '') === PRICE_AREA, `price_area_code preserved (${PRICE_AREA})`)

  const outbound = (await supabase.from('outbound_requests').select('id,status,business_process,message_code').eq('company_id', application.company_id).eq('customer_id', customerId)).data ?? []
  const activeMasterdata = (outbound as JsonRecord[]).filter((row) =>
    (String(row.business_process ?? '') === 'customer_masterdata' || String(row.message_code ?? '').toUpperCase() === 'Z01') &&
    ['queued', 'prepared', 'ready'].includes(String(row.status ?? '')))
  check(activeMasterdata.length === 0, 'no renderable Z01 outbound exists before facility identity')

  const switches = (await supabase.from('supplier_switch_requests').select('id,status').eq('company_id', application.company_id).eq('customer_id', customerId)).data ?? []
  check((switches as JsonRecord[]).length === 0, 'no supplier switch starts before facility/metering readiness')

  const requestId = String(application.grid_owner_information_request_id ?? '')
  if (requestId) {
    check(isUuid(requestId), 'durable grid-owner information request reference is an internal UUID')
    const outbox = await supabase.from('manual_email_outbox').select('id,to_email,recipient_resolution').eq('request_id', requestId)
    if (!outbox.error) {
      check((outbox.data?.length ?? 0) > 0, 'manual facility request has durable email outbox rows')
      for (const row of outbox.data ?? []) check(Boolean(row.recipient_resolution), `manual_email_outbox ${row.id} has recipient_resolution`)
    }
  }

  finish()
}

function finish() {
  if (failures.length) {
    console.error(`clean-website-flow-regression FAILED (${failures.length} failures).`)
    process.exit(1)
  }
  console.log('clean-website-flow-regression passed.')
}

main().catch((error) => {
  console.error('clean-website-flow-regression crashed:', error)
  process.exit(1)
})
