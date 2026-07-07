/**
 * Safe repair / diagnostic script for missing-facility Z01 (customer_masterdata)
 * split-brain rows.
 *
 * DEFAULT MODE IS DRY-RUN (report only). Nothing is mutated unless --apply is
 * passed. Nothing is EVER deleted.
 *
 * What it detects:
 *  1. outbound_requests with business_process/request_type customer_masterdata,
 *     status in (queued, prepared, ready), metering_point_id IS NULL and no
 *     facility identity in payload.site — the dangerous "queued Z01 without
 *     facility" state.
 *  2. ediel_message_intents for customer_masterdata with facility_id IS NULL,
 *     metering_point_id IS NULL and validation_status != 'blocked' and no
 *     rendered ediel_message — resume-able intents that must be blocked.
 *  3. Rows already linked to a rendered/sent ediel_message or ediel_outbox —
 *     REPORTED as high-risk historical data, NEVER mutated.
 *  4. Dirty/manual-SQL metadata rows (manual_test_patch, manual_sql,
 *     route_materialized_manually) — report only.
 *  5. customer_sites whose grid_owner_id is a platform_grid_owners.id instead
 *     of an OPS grid_owners.id — repairable via ops_grid_owner_id with --apply.
 *
 * What --apply changes:
 *  - Unsent split-brain outbound_requests: status -> 'failed' (the codebase's
 *    blocked vocabulary for outbound rows; excluded from the active-row unique
 *    index), blocking_reasons += facility_or_metering_point_missing,
 *    required_admin_actions += request_facility_information, failure_reason
 *    set, metadata.repaired_by_script recorded. Payload/audit preserved.
 *  - Unrendered intents: validation_status -> 'blocked' with blocking_reasons;
 *    render_status/outbox_status untouched.
 *  - Wrong-namespace site grid_owner_id: remapped to
 *    platform_grid_owners.ops_grid_owner_id when a mapping exists (otherwise
 *    reported only).
 *
 * What it refuses to touch:
 *  - Any outbound/intent linked to an existing ediel_message or ediel_outbox
 *    row (sent or unsent-but-rendered) — manual review required.
 *  - Dirty/test-metadata rows (report only).
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node --experimental-strip-types scripts/gridex/repairMissingFacilityZ01Rows.ts [--apply] [--company <uuid>]
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

type JsonRecord = Record<string, unknown>

const APPLY = process.argv.includes('--apply')
const companyFlagIndex = process.argv.indexOf('--company')
const COMPANY_ID = companyFlagIndex > -1 ? process.argv[companyFlagIndex + 1] ?? null : null

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY are required.')
  process.exit(1)
}

const supabase: SupabaseClient = createClient(url, key, { auth: { persistSession: false } })

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {}
}

function missingSchema(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? '')
  const message = String((error as { message?: unknown } | null)?.message ?? '')
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code) || /schema cache|does not exist/i.test(message)
}

function payloadFacilityIdentity(payload: JsonRecord): string | null {
  const site = record(payload.site)
  const meteringPoint = record(payload.metering_point)
  return (
    text(site.facility_id) ??
    text(site.normalized_facility_id) ??
    text(meteringPoint.meter_point_id) ??
    text(meteringPoint.ediel_reference) ??
    text(meteringPoint.site_facility_id) ??
    text(payload.facility_id)
  )
}

const DIRTY_MARKERS = ['manual_test_patch', 'manual_sql', 'route_materialized_manually'] as const

function dirtyMarkersIn(payload: JsonRecord): string[] {
  const serialized = JSON.stringify(payload ?? {})
  return DIRTY_MARKERS.filter((marker) => serialized.includes(marker))
}

async function hasLinkedMessageOrOutbox(input: {
  outboundRequestId?: string | null
  intentId?: string | null
  edielMessageId?: string | null
}): Promise<{ linked: boolean; details: string[] }> {
  const details: string[] = []
  if (text(input.edielMessageId)) {
    details.push(`ediel_message:${input.edielMessageId}`)
  }
  if (text(input.outboundRequestId)) {
    const messages = await supabase
      .from('ediel_messages')
      .select('id,status')
      .eq('outbound_request_id', input.outboundRequestId as string)
      .limit(5)
    if (!messages.error) {
      for (const row of messages.data ?? []) details.push(`ediel_message:${(row as JsonRecord).id}:${(row as JsonRecord).status}`)
    }
  }
  if (text(input.intentId)) {
    const outbox = await supabase
      .from('ediel_outbox')
      .select('id,status')
      .eq('intent_id', input.intentId as string)
      .limit(5)
    if (!outbox.error) {
      for (const row of outbox.data ?? []) details.push(`ediel_outbox:${(row as JsonRecord).id}:${(row as JsonRecord).status}`)
    }
  }
  return { linked: details.length > 0, details }
}

async function repairOutboundRows(summary: JsonRecord[]) {
  let query = supabase
    .from('outbound_requests')
    .select('id,company_id,customer_id,site_id,metering_point_id,status,request_type,business_process,message_code,blocking_reasons,required_admin_actions,payload,source_type,source_id')
    .in('status', ['queued', 'prepared', 'ready'])
    .is('metering_point_id', null)
    .limit(500)
  if (COMPANY_ID) query = query.eq('company_id', COMPANY_ID)

  const { data, error } = await query
  if (error) {
    if (missingSchema(error)) {
      summary.push({ check: 'outbound_requests', skipped: 'schema_missing' })
      return
    }
    throw error
  }

  for (const raw of (data ?? []) as JsonRecord[]) {
    const requestType = String(raw.request_type ?? '')
    const businessProcess = String(raw.business_process ?? '')
    const messageCode = String(raw.message_code ?? '')
    const isMasterdata =
      businessProcess === 'customer_masterdata' ||
      requestType.startsWith('customer_masterdata') ||
      messageCode.toUpperCase() === 'Z01'
    if (!isMasterdata) continue

    const payload = record(raw.payload)
    if (payloadFacilityIdentity(payload)) continue

    const dirty = dirtyMarkersIn(payload)
    const linked = await hasLinkedMessageOrOutbox({ outboundRequestId: String(raw.id) })

    const finding: JsonRecord = {
      check: 'outbound_customer_masterdata_missing_facility',
      outbound_request_id: raw.id,
      company_id: raw.company_id,
      customer_id: raw.customer_id,
      site_id: raw.site_id,
      status: raw.status,
      blocking_reasons: raw.blocking_reasons,
      dirty_markers: dirty,
      linked_rows: linked.details,
    }

    if (linked.linked) {
      finding.action = 'REPORT_ONLY_high_risk_historical_row_with_rendered_or_sent_message'
      summary.push(finding)
      continue
    }

    if (!APPLY) {
      finding.action = 'WOULD_block (rerun with --apply)'
      summary.push(finding)
      continue
    }

    const existingReasons = Array.isArray(raw.blocking_reasons) ? (raw.blocking_reasons as JsonRecord[]) : []
    const existingActions = Array.isArray(raw.required_admin_actions) ? (raw.required_admin_actions as unknown[]) : []
    const update = await supabase
      .from('outbound_requests')
      .update({
        status: 'failed',
        failed_at: new Date().toISOString(),
        failure_reason:
          'Blockerad av repair-script: anläggnings-ID/mätpunkts-ID saknas. Begär uppgifter från nätägaren innan Z01 kan förberedas.',
        blocking_reasons: [
          ...existingReasons,
          { code: 'facility_or_metering_point_missing', message: 'Anläggnings-ID/mätpunkts-ID saknas.' },
        ],
        required_admin_actions: [...existingActions, 'request_facility_information'],
        payload: {
          ...payload,
          repaired_by_script: {
            script: 'repairMissingFacilityZ01Rows',
            previous_status: raw.status,
            repaired_at: new Date().toISOString(),
          },
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', String(raw.id))
      .in('status', ['queued', 'prepared', 'ready'])
    finding.action = update.error ? `APPLY_FAILED: ${update.error.message}` : 'BLOCKED (status=failed + blockers)'
    summary.push(finding)
  }
}

async function repairIntentRows(summary: JsonRecord[]) {
  let query = supabase
    .from('ediel_message_intents')
    .select('id,company_id,customer_id,customer_site_id,business_process,message_code,facility_id,metering_point_id,validation_status,render_status,outbox_status,ediel_message_id,blocking_reasons,payload')
    .eq('business_process', 'customer_masterdata')
    .is('facility_id', null)
    .is('metering_point_id', null)
    .neq('validation_status', 'blocked')
    .limit(500)
  if (COMPANY_ID) query = query.eq('company_id', COMPANY_ID)

  const { data, error } = await query
  if (error) {
    if (missingSchema(error)) {
      summary.push({ check: 'ediel_message_intents', skipped: 'schema_missing' })
      return
    }
    throw error
  }

  for (const raw of (data ?? []) as JsonRecord[]) {
    const payload = record(raw.payload)
    const dirty = dirtyMarkersIn(payload)
    const linked = await hasLinkedMessageOrOutbox({ intentId: String(raw.id), edielMessageId: text(raw.ediel_message_id) })

    const finding: JsonRecord = {
      check: 'intent_customer_masterdata_missing_facility',
      intent_id: raw.id,
      company_id: raw.company_id,
      customer_id: raw.customer_id,
      validation_status: raw.validation_status,
      render_status: raw.render_status,
      outbox_status: raw.outbox_status,
      dirty_markers: dirty,
      linked_rows: linked.details,
    }

    if (linked.linked) {
      finding.action = 'REPORT_ONLY_high_risk_historical_row_with_rendered_or_sent_message'
      summary.push(finding)
      continue
    }

    if (!APPLY) {
      finding.action = 'WOULD_block (rerun with --apply)'
      summary.push(finding)
      continue
    }

    const existingReasons = Array.isArray(raw.blocking_reasons) ? (raw.blocking_reasons as JsonRecord[]) : []
    const update = await supabase
      .from('ediel_message_intents')
      .update({
        validation_status: 'blocked',
        blocking_reasons: [
          ...existingReasons,
          {
            code: 'facility_or_metering_point_missing',
            message: 'Anläggnings-ID/mätpunkts-ID saknas. Blockerad av repair-script.',
            severity: 'block',
            details: { required_admin_action: 'request_facility_information', repaired_by_script: 'repairMissingFacilityZ01Rows' },
          },
        ],
        updated_at: new Date().toISOString(),
      })
      .eq('id', String(raw.id))
      .neq('validation_status', 'blocked')
    finding.action = update.error ? `APPLY_FAILED: ${update.error.message}` : 'BLOCKED (validation_status=blocked)'
    summary.push(finding)
  }
}

async function detectWrongNamespaceGridOwners(summary: JsonRecord[]) {
  let query = supabase
    .from('customer_sites')
    .select('id,company_id,customer_id,grid_owner_id')
    .not('grid_owner_id', 'is', null)
    .limit(2000)
  if (COMPANY_ID) query = query.eq('company_id', COMPANY_ID)
  const sites = await query
  if (sites.error) {
    if (missingSchema(sites.error)) {
      summary.push({ check: 'customer_sites_grid_owner_namespace', skipped: 'schema_missing' })
      return
    }
    throw sites.error
  }

  const gridOwnerIds = Array.from(
    new Set(((sites.data ?? []) as JsonRecord[]).map((row) => text(row.grid_owner_id)).filter((value): value is string => Boolean(value))),
  )
  if (gridOwnerIds.length === 0) return

  const opsRows = await supabase.from('grid_owners').select('id').in('id', gridOwnerIds)
  if (opsRows.error) {
    if (missingSchema(opsRows.error)) return
    throw opsRows.error
  }
  const opsIds = new Set(((opsRows.data ?? []) as JsonRecord[]).map((row) => String(row.id)))
  const suspect = gridOwnerIds.filter((id) => !opsIds.has(id))
  if (suspect.length === 0) return

  const platformRows = await supabase
    .from('platform_grid_owners')
    .select('id,ops_grid_owner_id,name')
    .in('id', suspect)
  const platformMap = new Map<string, JsonRecord>()
  if (!platformRows.error) {
    for (const row of (platformRows.data ?? []) as JsonRecord[]) platformMap.set(String(row.id), row)
  }

  for (const row of (sites.data ?? []) as JsonRecord[]) {
    const gridOwnerId = text(row.grid_owner_id)
    if (!gridOwnerId || opsIds.has(gridOwnerId)) continue
    const platform = platformMap.get(gridOwnerId) ?? null
    const opsMapped = platform ? text(platform.ops_grid_owner_id) : null
    const finding: JsonRecord = {
      check: 'customer_sites_grid_owner_wrong_namespace',
      site_id: row.id,
      company_id: row.company_id,
      customer_id: row.customer_id,
      grid_owner_id: gridOwnerId,
      namespace: platform ? 'platform_grid_owners' : 'unknown',
      ops_grid_owner_id: opsMapped,
    }
    if (!APPLY || !opsMapped) {
      finding.action = opsMapped ? 'WOULD_remap_to_ops (rerun with --apply)' : 'REPORT_ONLY_no_ops_mapping'
      summary.push(finding)
      continue
    }
    const update = await supabase
      .from('customer_sites')
      .update({ grid_owner_id: opsMapped, updated_at: new Date().toISOString() })
      .eq('id', String(row.id))
      .eq('grid_owner_id', gridOwnerId)
    finding.action = update.error ? `APPLY_FAILED: ${update.error.message}` : 'REMAPPED_to_ops_grid_owner'
    summary.push(finding)
  }
}

async function main() {
  const summary: JsonRecord[] = []
  console.log(`repairMissingFacilityZ01Rows: mode=${APPLY ? 'APPLY' : 'DRY-RUN'}${COMPANY_ID ? ` company=${COMPANY_ID}` : ''}`)
  await repairOutboundRows(summary)
  await repairIntentRows(summary)
  await detectWrongNamespaceGridOwners(summary)

  if (summary.length === 0) {
    console.log('No split-brain Z01 rows, resume-able missing-facility intents or wrong-namespace grid owners found.')
    return
  }
  for (const finding of summary) {
    console.log(JSON.stringify(finding))
  }
  const highRisk = summary.filter((finding) => String(finding.action ?? '').startsWith('REPORT_ONLY_high_risk'))
  if (highRisk.length > 0) {
    console.log(`WARNING: ${highRisk.length} high-risk historical row(s) with rendered/sent messages require MANUAL review. This script never mutates them.`)
  }
  console.log(`Total findings: ${summary.length}. Mode=${APPLY ? 'APPLY' : 'DRY-RUN'}.`)
}

main().catch((error) => {
  console.error('repairMissingFacilityZ01Rows failed:', error)
  process.exit(1)
})
