/** Simulated DSO bytes enter ordinary canonical intake; no status writes. */
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
const ROOT = '/workspace/elklart-runtime'
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)
const sha = value => createHash('sha256').update(value).digest('hex')
function requireValue(value, message) { if (!value) throw new Error(message) }
export function privateFile(file) {
  const resolved = path.resolve(file)
  requireValue(resolved.startsWith(ROOT + '/'), 'Fixture must be under private runtime')
  for (let current = resolved; current !== path.dirname(current); current = path.dirname(current)) requireValue(!fs.lstatSync(current).isSymbolicLink(), 'Symlink refused')
  const stat = fs.statSync(resolved)
  requireValue(stat.isFile() && stat.uid === process.getuid() && !(stat.mode & 0o7077), 'Private mode0600 file required')
  return resolved
}
export function validateFixture(fixture, raw) {
  requireValue(['anna-start', 'samir-move-in', 'jonas-end', 'meter-values', 'meter-correction'].includes(fixture.scenario), 'Unknown scenario')
  for (const key of ['companyId', 'actorUserId', 'customerId', 'siteId', 'meteringPointId']) requireValue(uuid(fixture[key]), 'Missing fixture UUID: ' + key)
  requireValue(['internal_test', 'production_dry_run'].includes(fixture.mode), 'Only ordinary non-AGT/TGT intake modes allowed')
  requireValue(fixture.rawSha256 === sha(raw), 'Exact input-byte hash mismatch')
  requireValue(typeof fixture.mailboxMessageId === 'string' && /^[a-z0-9_-]{8,100}$/i.test(fixture.mailboxMessageId), 'Stable fictional mailbox message identity required')
  for (const key of ['senderEmail', 'receiverEmail']) requireValue(/^[a-z0-9._+-]+@elklart\.example\.invalid$/i.test(fixture[key]), 'Fictional endpoint required: ' + key)
  requireValue(raw.length > 0 && raw.length <= 2_000_000 && raw.toString('utf8').includes('UNB+'), 'EDIFACT bytes required')
  if (['anna-start', 'samir-move-in'].includes(fixture.scenario)) requireValue(uuid(fixture.switchRequestId) && typeof fixture.expectedMarketStartAt === 'string' && Number.isFinite(Date.parse(fixture.expectedMarketStartAt)), 'Own ordinary switch and exact expected market start required')
  if (fixture.scenario === 'jonas-end') requireValue(uuid(fixture.supplyPeriodId) && typeof fixture.expectedMarketEndAt === 'string' && Number.isFinite(Date.parse(fixture.expectedMarketEndAt)), 'Own active supply and exact expected market end required')
  if (fixture.scenario.startsWith('meter-')) requireValue(Array.isArray(fixture.expectedReadings) && fixture.expectedReadings.length > 0 && fixture.expectedReadings.every(row => typeof row.periodStart === 'string' && typeof row.periodEnd === 'string' && Number.isFinite(Date.parse(row.periodStart)) && Date.parse(row.periodEnd) > Date.parse(row.periodStart) && typeof row.kwh === 'number' && Number.isFinite(row.kwh)), 'Exact expected reading intervals/quantities required')
  if (fixture.scenario === 'meter-correction') requireValue(uuid(fixture.previousMessageId), 'Previous ordinary source message required for correction')
  return fixture
}
async function row(client, table, id, companyId) {
  let query = client.from(table).select('*').eq('id', id)
  if (companyId) query = query.eq('company_id', companyId)
  const result = await query.single(); if (result.error) throw new Error('Readback failed for ' + table + ': ' + result.error.code)
  return result.data
}
export async function preflight(client, fixture) {
  const company = await row(client, 'companies', fixture.companyId)
  requireValue(company.slug === 'elklart-demo' && company.name === 'Elklart Demo' && company.status === 'active', 'Only active dedicated Elklart Demo tenant allowed')
  const actor = await row(client, 'user_profiles', fixture.actorUserId)
  requireValue(actor.user_status === 'active', 'Active ordinary staff actor required')
  const customer = await row(client, 'customers', fixture.customerId, fixture.companyId)
  const site = await row(client, 'customer_sites', fixture.siteId, fixture.companyId)
  const point = await row(client, 'metering_points', fixture.meteringPointId, fixture.companyId)
  requireValue(customer.id === site.customer_id && point.customer_id === customer.id && [point.site_id, point.customer_site_id].includes(site.id), 'Fixture customer/site/point graph mismatch')
  requireValue(point.grid_owner_id && (point.normalized_metering_point_id || point.meter_point_id || point.metering_point_id), 'Verified ordinary DSO/point prerequisite missing')
  if (fixture.switchRequestId) {
    const request = await row(client, 'supplier_switch_requests', fixture.switchRequestId, fixture.companyId)
    requireValue(request.customer_id === customer.id && request.site_id === site.id && request.metering_point_id === point.id, 'Own switch correlation mismatch')
    if (fixture.scenario === 'samir-move-in') requireValue(request.request_type === 'move_in', 'Samir must have ordinary move-in request')
  }
  if (fixture.supplyPeriodId) {
    const period = await row(client, 'customer_supply_periods', fixture.supplyPeriodId, fixture.companyId)
    requireValue(period.customer_id === customer.id && period.metering_point_id === point.id, 'Own supply period mismatch')
  }
  if (fixture.previousMessageId) {
    const message = await row(client, 'ediel_messages', fixture.previousMessageId, fixture.companyId)
    requireValue(message.message_family === 'UTILTS' && message.direction === 'inbound', 'Correction previous source must be own inbound UTILTS')
  }
  // These readbacks establish fixture custody only. Ordinary canonical intake
  // separately verifies actor permissions, legal actors and source authority.
  return { companyId: company.id, customerId: customer.id, siteId: site.id, meteringPointId: point.id }
}
async function readOutcome(client, fixture, messageId) {
  const companyId = fixture.companyId
  const message = await row(client, 'ediel_messages', messageId, companyId)
  const periods = await client.from('customer_supply_periods').select('id,customer_id,metering_point_id,market_start_at,market_end_at,actual_start_date,actual_end_date,status,source_message_id,source_end_message_id,source_switch_request_id').eq('company_id', companyId).eq('customer_id', fixture.customerId).eq('metering_point_id', fixture.meteringPointId)
  const readings = await client.from('metering_values').select('id,period_start,period_end,value_kwh,quantity_kwh,quantity,is_current,utilts_message_id,source_message_id,source_ediel_message_id').eq('company_id', companyId).eq('customer_id', fixture.customerId).eq('metering_point_id', fixture.meteringPointId).limit(20000)
  const events = await client.from('ediel_message_events').select('event_type,event_status,message,payload').eq('company_id', companyId).eq('ediel_message_id', messageId).order('created_at')
  for (const result of [periods, readings, events]) if (result.error) throw new Error('Outcome readback failed: ' + result.error.code)
  return { message: { id: message.id, status: message.status, message_family: message.message_family, message_code: message.message_code, syntax_check_status: message.syntax_check_status, functional_check_status: message.functional_check_status, failure_reason: message.failure_reason }, periods: periods.data, readings: readings.data, events: events.data }
}
export function assertOutcome(fixture, messageId, outcome) {
  if (fixture.expectedMarketStartAt) requireValue(outcome.periods.some(period => period.source_message_id === messageId && period.source_switch_request_id === fixture.switchRequestId && Date.parse(period.market_start_at) === Date.parse(fixture.expectedMarketStartAt)), 'Confirmed ordinary source-bound start not established')
  if (fixture.expectedMarketEndAt) requireValue(outcome.periods.some(period => period.id === fixture.supplyPeriodId && period.source_end_message_id === messageId && Date.parse(period.market_end_at) === Date.parse(fixture.expectedMarketEndAt)), 'Confirmed ordinary source-bound end not established')
  const sourceMatches = reading => reading.utilts_message_id === messageId || reading.source_message_id === messageId || reading.source_ediel_message_id === messageId
  for (const expected of fixture.expectedReadings ?? []) requireValue(outcome.readings.some(reading => sourceMatches(reading) && reading.is_current === true && Date.parse(reading.period_start) === Date.parse(expected.periodStart) && Date.parse(reading.period_end) === Date.parse(expected.periodEnd) && Number(reading.value_kwh ?? reading.quantity_kwh ?? reading.quantity) === expected.kwh), 'Expected current source-bound reading missing')
  if (fixture.previousMessageId) requireValue(outcome.readings.some(reading => (reading.utilts_message_id === fixture.previousMessageId || reading.source_message_id === fixture.previousMessageId || reading.source_ediel_message_id === fixture.previousMessageId) && reading.is_current === false), 'Correction did not preserve superseded source history')
}
export async function main(args) {
  const fixturePath = args.find(value => value.startsWith('--fixture='))?.slice(10)
  requireValue(fixturePath, 'Use --fixture=/workspace/elklart-runtime/...json [--apply]; default is read-only preflight')
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  requireValue(url === 'http://localhost:54321', 'Only dedicated localhost OPS Supabase is allowed')
  requireValue(process.env.SUPABASE_URL === url && process.env.NEXT_PUBLIC_SUPABASE_URL === url, 'Public/service Supabase endpoint mismatch')
  const client = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const fixture = JSON.parse(fs.readFileSync(privateFile(fixturePath), 'utf8'))
  const raw = fs.readFileSync(privateFile(fixture.rawFile))
  validateFixture(fixture, raw)
  const custody = await preflight(client, fixture)
  if (!args.includes('--apply')) { console.log(JSON.stringify({ status: 'preflight_only', ...custody, scenario: fixture.scenario, pending: 'Canonical actor/source/grammar/market prerequisites are evaluated by ordinary runtime during apply; preflight grants no business authority' })); return }
  const output = ROOT + '/ops/ediel-runs'
  fs.mkdirSync(output, { recursive: true, mode: 0o700 })
  const evidence = { ...custody, scenario: fixture.scenario, rawSha256: fixture.rawSha256, status: 'started', startedAt: new Date().toISOString() }
  const evidenceFile = output + '/' + randomUUID() + '.json'
  try {
    const { require: tsRequire } = await import('/workspace/elklart-runtime/ediel-deps/node_modules/tsx/dist/cjs/api/index.mjs')
    const { registerEdielFile, parseEdielFile } = tsRequire(path.resolve('lib/ediel/fileEngine.ts'), import.meta.url)
    const { processInboundEdielMessage } = tsRequire(path.resolve('lib/ediel/flows/inboundProcessing.ts'), import.meta.url)
    const rawText = new TextDecoder('utf-8', { fatal: true }).decode(raw)
    const parsed = parseEdielFile(rawText, path.basename(fixture.rawFile))
    const expectedCode = fixture.scenario === 'jonas-end' ? 'Z05' : fixture.scenario.startsWith('meter-') ? 'E66' : 'Z04'
    requireValue(parsed.messageCode === expectedCode && parsed.messageFamily === (expectedCode === 'E66' ? 'UTILTS' : 'PRODAT'), 'Input message family/code does not match requested scenario')
    const intake = await registerEdielFile({ actorUserId: fixture.actorUserId, companyId: fixture.companyId, direction: 'inbound', mode: fixture.mode, rawPayload: rawText, fileName: path.basename(fixture.rawFile), mailbox: 'local-simulated-dso', mailboxMessageId: fixture.mailboxMessageId, senderEmail: fixture.senderEmail, receiverEmail: fixture.receiverEmail })
    evidence.messageId = intake.id
    await processInboundEdielMessage({ actorUserId: fixture.actorUserId, edielMessageId: intake.id })
    evidence.outcome = await readOutcome(client, fixture, intake.id)
    assertOutcome(fixture, intake.id, evidence.outcome)
    evidence.status = 'verified_ordinary_flow'
  } catch (error) { evidence.status = 'blocked_or_failed'; evidence.error = error.message; throw error }
  finally { evidence.finishedAt = new Date().toISOString(); fs.writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2), { mode: 0o600 }); console.log(JSON.stringify({ status: evidence.status, evidenceFile })) }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1 })
