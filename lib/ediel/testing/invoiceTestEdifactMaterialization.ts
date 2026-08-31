import { supabaseService } from '@/lib/supabase/service'
import type { ParsedEdifactEnvelope } from '@/lib/inbound-mail/edielEmailParser'
import {
  assertInvoiceTestCustomer,
  INVOICE_TEST_CUSTOMER_KIND,
} from '@/lib/ediel/testing/invoiceTestCenterWorkspace'

type Row = Record<string, unknown>

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function objectValue(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
}

function firstReference(parsed: ParsedEdifactEnvelope, keys: string[]): { qualifier: string; value: string } | null {
  for (const key of keys) {
    const value = text(parsed.references[key]?.[0])
    if (value) return { qualifier: key, value }
  }
  return null
}

export type InvoiceTestEdifactIdentity = {
  primaryMeteringReference: string
  primaryReferenceSource: string
  facilityId: string | null
  gridAreaCode: string | null
  meterNumber: string | null
  transactionReference: string | null
  period: string | null
  senderEdielId: string | null
  receiverEdielId: string | null
  messageCode: string | null
  quantities: ParsedEdifactEnvelope['quantities']
}

export function deriveInvoiceTestEdifactIdentity(parsed: ParsedEdifactEnvelope): InvoiceTestEdifactIdentity {
  const loc172 = text(parsed.locations['172']?.[0])
  const fallback = firstReference(parsed, ['Z07', 'LI', 'TN', 'MG'])
  const primaryMeteringReference = loc172 ?? fallback?.value ?? null
  if (!primaryMeteringReference) {
    throw new Error('UTILTS saknar canonical anläggnings-/mätpunktsidentitet från LOC+172/Z07/LI/TN/MG.')
  }

  return {
    primaryMeteringReference,
    primaryReferenceSource: loc172 ? 'LOC+172' : `RFF+${fallback?.qualifier ?? 'UNKNOWN'}`,
    facilityId: loc172,
    gridAreaCode: text(parsed.locations['239']?.[0]),
    meterNumber: text(parsed.references.MG?.[0]),
    transactionReference: text(parsed.references.TN?.[0]) ?? text(parsed.transactionReference),
    period: text(parsed.dates['324']?.[0]),
    senderEdielId: text(parsed.senderEdielId),
    receiverEdielId: text(parsed.receiverEdielId),
    messageCode: text(parsed.messageCode),
    quantities: parsed.quantities,
  }
}

async function loadSingleTestSite(input: { companyId: string; customerId: string }) {
  const result = await supabaseService
    .from('customer_sites')
    .select('id,company_id,customer_id,facility_id,grid_area_code,grid_owner_id,price_area_code,site_type,metadata,is_test_data,archived_at')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('is_test_data', true)
    .is('archived_at', null)
    .limit(2)
  if (result.error) throw result.error
  const rows = (result.data ?? []) as Row[]
  if (rows.length !== 1) {
    throw new Error(rows.length === 0
      ? 'Fakturatest-kunden saknar en aktiv test-anläggning att binda EDIFACT till.'
      : 'Fakturatest-kunden har flera aktiva test-anläggningar; EDIFACT-bindning stoppad fail-closed.')
  }
  return rows[0]
}

function matchesIdentity(row: Row, identity: InvoiceTestEdifactIdentity) {
  return [
    row.meter_point_id,
    row.metering_point_id,
    row.site_facility_id,
    row.ediel_reference,
    row.anlage_id,
    row.ediel_metering_point_id,
  ].some((value) => text(value) === identity.primaryMeteringReference)
}

export async function materializeInvoiceTestEdifactMasterdata(input: {
  companyId: string
  customerId: string
  actorUserId: string
  parsed: ParsedEdifactEnvelope
  sourceSha256: string
}) {
  await assertInvoiceTestCustomer({ companyId: input.companyId, customerId: input.customerId })
  const identity = deriveInvoiceTestEdifactIdentity(input.parsed)
  const site = await loadSingleTestSite(input)
  const siteId = String(site.id)
  const now = new Date().toISOString()
  const parsedMetadata = {
    source: 'canonical_edifact_parser',
    imported_at: now,
    source_sha256: input.sourceSha256,
    primary_metering_reference: identity.primaryMeteringReference,
    primary_reference_source: identity.primaryReferenceSource,
    facility_id: identity.facilityId,
    grid_area_code: identity.gridAreaCode,
    meter_number: identity.meterNumber,
    transaction_reference: identity.transactionReference,
    period: identity.period,
    sender_ediel_id: identity.senderEdielId,
    receiver_ediel_id: identity.receiverEdielId,
    message_code: identity.messageCode,
    quantities: identity.quantities,
  }

  const siteMetadata = {
    ...objectValue(site.metadata),
    invoice_test_edifact: parsedMetadata,
  }
  const siteUpdate = await supabaseService
    .from('customer_sites')
    .update({
      ...(identity.facilityId ? { facility_id: identity.facilityId } : {}),
      ...(identity.gridAreaCode ? { grid_area_code: identity.gridAreaCode } : {}),
      metadata: siteMetadata,
      updated_by: input.actorUserId,
      updated_at: now,
    })
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('id', siteId)
    .eq('is_test_data', true)
    .is('archived_at', null)
    .select('id')
    .maybeSingle()
  if (siteUpdate.error) throw siteUpdate.error
  if (!siteUpdate.data) throw new Error('Fakturatest kunde inte verifiera EDIFACT-bindningen till test-anläggningen.')

  const points = await supabaseService
    .from('metering_points')
    .select('id,site_id,customer_id,meter_point_id,metering_point_id,site_facility_id,ediel_reference,anlage_id,ediel_metering_point_id,metadata,is_test_data,archived_at')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('is_test_data', true)
    .is('archived_at', null)
    .limit(2)
  if (points.error) throw points.error
  const pointRows = (points.data ?? []) as Row[]
  if (pointRows.length > 1) {
    throw new Error('Fakturatest-kunden har flera aktiva test-mätpunkter; EDIFACT-bindning stoppad fail-closed.')
  }

  if (pointRows.length === 1) {
    const existing = pointRows[0]
    if (!matchesIdentity(existing, identity)) {
      throw new Error('Vald testkund är redan bunden till en annan EDIFACT-identitet. Radera testkunden och skapa en ny för den nya filen.')
    }
    const metadata = {
      ...objectValue(existing.metadata),
      invoice_test_edifact: parsedMetadata,
    }
    const update = await supabaseService
      .from('metering_points')
      .update({
        ...(identity.facilityId ? { site_facility_id: identity.facilityId, anlage_id: identity.facilityId } : {}),
        ...(identity.gridAreaCode ? { grid_area_code: identity.gridAreaCode } : {}),
        ...(identity.meterNumber ? { meter_number: identity.meterNumber } : {}),
        ediel_reference: identity.primaryMeteringReference,
        metadata,
        updated_by: input.actorUserId,
        updated_at: now,
      })
      .eq('company_id', input.companyId)
      .eq('customer_id', input.customerId)
      .eq('id', String(existing.id))
      .eq('is_test_data', true)
      .is('archived_at', null)
      .select('id')
      .maybeSingle()
    if (update.error) throw update.error
    if (!update.data) throw new Error('Fakturatest kunde inte verifiera uppdaterad EDIFACT-mätpunkt.')
    return { identity, siteId, meteringPointId: String(existing.id), createdMeteringPoint: false }
  }

  const pointMetadata = {
    test_center: {
      kind: INVOICE_TEST_CUSTOMER_KIND,
      version: 1,
      created_by: input.actorUserId,
      marked_at: now,
    },
    invoice_test_edifact: parsedMetadata,
  }
  const insert = await supabaseService
    .from('metering_points')
    .insert({
      company_id: input.companyId,
      customer_id: input.customerId,
      site_id: siteId,
      customer_site_id: siteId,
      metering_point_id: identity.primaryMeteringReference,
      meter_point_id: identity.primaryMeteringReference,
      ediel_metering_point_id: identity.primaryMeteringReference,
      ediel_reference: identity.primaryMeteringReference,
      site_facility_id: identity.facilityId ?? identity.primaryMeteringReference,
      anlage_id: identity.facilityId,
      grid_area_code: identity.gridAreaCode,
      meter_number: identity.meterNumber,
      grid_owner_id: text(site.grid_owner_id),
      price_area_code: text(site.price_area_code),
      metering_type: text(site.site_type) === 'production' ? 'production' : 'consumption',
      measurement_type: text(site.site_type) === 'production' ? 'production' : 'consumption',
      reading_frequency: 'hourly',
      is_settlement_relevant: true,
      status: 'draft',
      is_test_data: true,
      metadata: pointMetadata,
      created_by: input.actorUserId,
      updated_by: input.actorUserId,
      created_at: now,
      updated_at: now,
    })
    .select('id')
    .single()
  if (insert.error) throw insert.error

  return { identity, siteId, meteringPointId: String(insert.data.id), createdMeteringPoint: true }
}
