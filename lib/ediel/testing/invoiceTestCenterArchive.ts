import { supabaseService } from '@/lib/supabase/service'
import {
  INVOICE_TEST_CUSTOMER_KIND,
  INVOICE_TEST_CUSTOMER_SOURCE,
  assertInvoiceTestCustomer,
  resetInvoiceTestCustomerRun,
} from '@/lib/ediel/testing/invoiceTestCenterWorkspace'

type Row = Record<string, unknown>

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function objectValue(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
}

function testMarker(metadata: unknown): Row {
  return objectValue(objectValue(metadata).test_center)
}

function originalIdentifiers(metadata: unknown, fallback: Row): Row {
  const existing = objectValue(testMarker(metadata).archived_original_identifiers)
  return Object.keys(existing).length > 0 ? existing : fallback
}

function assertMarkedGraphRow(row: Row, label: string) {
  if (text(testMarker(row.metadata).kind) !== INVOICE_TEST_CUSTOMER_KIND) {
    throw new Error(`Fakturatest vägrade arkivera ${label}: testmarkören saknas.`)
  }
}

export async function archiveInvoiceTestCustomerSafely(input: {
  companyId: string
  customerId: string
  actorUserId: string
}) {
  const customer = await assertInvoiceTestCustomer({ ...input, allowArchived: true })
  if (text(customer.archived_at)) {
    return { customerId: input.customerId, archivedAt: text(customer.archived_at) }
  }

  await resetInvoiceTestCustomerRun(input)

  const [sitesResult, pointsResult, contractsResult] = await Promise.all([
    supabaseService
      .from('customer_sites')
      .select('id,facility_id,facility_reference,metadata,archived_at,is_test_data')
      .eq('company_id', input.companyId)
      .eq('customer_id', input.customerId)
      .eq('is_test_data', true),
    supabaseService
      .from('metering_points')
      .select('id,site_id,meter_point_id,metering_point_id,ediel_metering_point_id,ediel_reference,site_facility_id,anlage_id,metadata,archived_at,is_test_data')
      .eq('company_id', input.companyId)
      .eq('customer_id', input.customerId)
      .eq('is_test_data', true),
    supabaseService
      .from('customer_contracts')
      .select('id,status,ends_at,metadata')
      .eq('company_id', input.companyId)
      .eq('customer_id', input.customerId),
  ])
  if (sitesResult.error) throw sitesResult.error
  if (pointsResult.error) throw pointsResult.error
  if (contractsResult.error) throw contractsResult.error

  const sites = (sitesResult.data ?? []) as Row[]
  const points = (pointsResult.data ?? []) as Row[]
  const contracts = (contractsResult.data ?? []) as Row[]

  // A freshly created Fakturatest customer intentionally has no metering point
  // until the first canonical EDIFACT import. Safe removal must therefore accept
  // zero or one test point. More than one point is still an integrity violation.
  if (sites.length !== 1 || contracts.length !== 1 || points.length > 1) {
    throw new Error('Fakturatest vägrade arkivera: testkunden måste ha exakt en testanläggning, exakt ett canonical avtal och högst en testmätpunkt.')
  }

  assertMarkedGraphRow(sites[0], 'testanläggningen')
  assertMarkedGraphRow(contracts[0], 'testavtalet')
  if (points.length === 1) assertMarkedGraphRow(points[0], 'testmätpunkten')

  const now = new Date().toISOString()
  const reason = 'Arkiverad från Fakturatest. Provider-/auditspår bevaras.'
  const site = sites[0]
  const point = points[0] ?? null
  const contract = contracts[0]
  const siteId = String(site.id)
  const pointId = point ? String(point.id) : null
  const contractId = String(contract.id)
  const archivedFacilityId = `ARCHIVED-FAKTURATEST-SITE-${siteId}`
  const archivedMeteringPointId = pointId ? `ARCHIVED-FAKTURATEST-MP-${pointId}` : null

  const contractMetadata = {
    ...objectValue(contract.metadata),
    test_center: {
      ...testMarker(contract.metadata),
      kind: INVOICE_TEST_CUSTOMER_KIND,
      archived_at: now,
    },
  }
  const contractUpdate = await supabaseService
    .from('customer_contracts')
    .update({
      status: 'cancelled',
      ends_at: text(contract.ends_at) ?? now,
      metadata: contractMetadata,
      updated_by: input.actorUserId,
      updated_at: now,
    })
    .eq('company_id', input.companyId)
    .eq('id', contractId)
    .select('id')
    .maybeSingle()
  if (contractUpdate.error) throw contractUpdate.error
  if (!contractUpdate.data) throw new Error('Fakturatest kunde inte verifiera avslut av testavtalet.')

  if (point && pointId && archivedMeteringPointId) {
    const pointMetadata = {
      ...objectValue(point.metadata),
      test_center: {
        ...testMarker(point.metadata),
        kind: INVOICE_TEST_CUSTOMER_KIND,
        archived_at: now,
        archived_original_identifiers: originalIdentifiers(point.metadata, {
          meter_point_id: text(point.meter_point_id),
          metering_point_id: text(point.metering_point_id),
          ediel_metering_point_id: text(point.ediel_metering_point_id),
          ediel_reference: text(point.ediel_reference),
          site_facility_id: text(point.site_facility_id),
          anlage_id: text(point.anlage_id),
        }),
      },
    }
    const pointUpdate = await supabaseService
      .from('metering_points')
      .update({
        meter_point_id: archivedMeteringPointId,
        metering_point_id: archivedMeteringPointId,
        ediel_metering_point_id: archivedMeteringPointId,
        ediel_reference: null,
        site_facility_id: archivedFacilityId,
        anlage_id: null,
        status: 'ended',
        archived_at: now,
        archived_by: input.actorUserId,
        archive_reason: reason,
        metadata: pointMetadata,
        updated_by: input.actorUserId,
        updated_at: now,
      })
      .eq('company_id', input.companyId)
      .eq('id', pointId)
      .eq('is_test_data', true)
      .select('id')
      .maybeSingle()
    if (pointUpdate.error) throw pointUpdate.error
    if (!pointUpdate.data) throw new Error('Fakturatest kunde inte verifiera arkivering av testmätpunkten.')
  }

  const siteMetadata = {
    ...objectValue(site.metadata),
    test_center: {
      ...testMarker(site.metadata),
      kind: INVOICE_TEST_CUSTOMER_KIND,
      archived_at: now,
      archived_original_identifiers: originalIdentifiers(site.metadata, {
        facility_id: text(site.facility_id),
        facility_reference: text(site.facility_reference),
      }),
    },
  }
  const siteUpdate = await supabaseService
    .from('customer_sites')
    .update({
      facility_id: archivedFacilityId,
      status: 'closed',
      archived_at: now,
      archived_by: input.actorUserId,
      archive_reason: reason,
      is_active: false,
      metadata: siteMetadata,
      updated_by: input.actorUserId,
      updated_at: now,
    })
    .eq('company_id', input.companyId)
    .eq('id', siteId)
    .eq('is_test_data', true)
    .select('id')
    .maybeSingle()
  if (siteUpdate.error) throw siteUpdate.error
  if (!siteUpdate.data) throw new Error('Fakturatest kunde inte verifiera arkivering av testanläggningen.')

  const customerUpdate = await supabaseService
    .from('customers')
    .update({
      archived_at: now,
      archived_by: input.actorUserId,
      archive_reason: reason,
      updated_by: input.actorUserId,
      updated_at: now,
    })
    .eq('company_id', input.companyId)
    .eq('id', input.customerId)
    .eq('is_test_data', true)
    .eq('source', INVOICE_TEST_CUSTOMER_SOURCE)
    .select('id')
    .maybeSingle()
  if (customerUpdate.error) throw customerUpdate.error
  if (!customerUpdate.data) throw new Error('Fakturatest kunde inte verifiera arkivering av testkunden.')

  return { customerId: input.customerId, archivedAt: now }
}
