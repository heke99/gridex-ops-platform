import { supabaseService } from '@/lib/supabase/service'
import {
  INVOICE_TEST_CUSTOMER_KIND,
  INVOICE_TEST_CUSTOMER_SOURCE,
} from '@/lib/ediel/testing/invoiceTestCenterWorkspace'

type Row = Record<string, unknown>

type QuarantineInput = {
  companyId: string
  customerId: string
  siteId: string | null
  meteringPointId: string | null
  actorUserId: string
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function objectValue(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
}

function marker(metadata: unknown): Row {
  return objectValue(objectValue(metadata).test_center)
}

export async function quarantineCreatedInvoiceTestGraph(input: QuarantineInput) {
  const now = new Date().toISOString()
  const reason = 'Fakturatest-markering/signering misslyckades; nyss skapad kundgraf arkiverades fail-closed.'
  const archivedFacilityId = input.siteId ? `ARCHIVED-FAKTURATEST-SITE-${input.siteId}` : null

  if (input.meteringPointId) {
    const current = await supabaseService
      .from('metering_points')
      .select('id,meter_point_id,metering_point_id,ediel_reference,site_facility_id,metadata')
      .eq('company_id', input.companyId)
      .eq('id', input.meteringPointId)
      .maybeSingle()
    if (current.error) throw current.error
    if (current.data) {
      const row = current.data as Row
      const metadata = {
        ...objectValue(row.metadata),
        test_center: {
          ...marker(row.metadata),
          kind: INVOICE_TEST_CUSTOMER_KIND,
          version: 1,
          quarantined_at: now,
          archived_original_identifiers: {
            meter_point_id: text(row.meter_point_id),
            metering_point_id: text(row.metering_point_id),
            ediel_reference: text(row.ediel_reference),
            site_facility_id: text(row.site_facility_id),
          },
        },
      }
      const meteringPoint = await supabaseService
        .from('metering_points')
        .update({
          meter_point_id: `ARCHIVED-FAKTURATEST-MP-${input.meteringPointId}`,
          metering_point_id: `ARCHIVED-FAKTURATEST-MP-${input.meteringPointId}`,
          ediel_reference: null,
          site_facility_id: archivedFacilityId ?? text(row.site_facility_id),
          status: 'ended',
          metadata,
          is_test_data: true,
          archived_at: now,
          archived_by: input.actorUserId,
          archive_reason: reason,
          updated_by: input.actorUserId,
          updated_at: now,
        })
        .eq('company_id', input.companyId)
        .eq('id', input.meteringPointId)
        .select('id')
        .maybeSingle()
      if (meteringPoint.error) throw meteringPoint.error
      if (!meteringPoint.data) throw new Error('Fakturatest-karantän kunde inte verifiera testmätpunkten.')
    }
  }

  if (input.siteId) {
    const current = await supabaseService
      .from('customer_sites')
      .select('id,facility_id,facility_reference,metadata')
      .eq('company_id', input.companyId)
      .eq('id', input.siteId)
      .maybeSingle()
    if (current.error) throw current.error
    if (current.data) {
      const row = current.data as Row
      const metadata = {
        ...objectValue(row.metadata),
        test_center: {
          ...marker(row.metadata),
          kind: INVOICE_TEST_CUSTOMER_KIND,
          version: 1,
          quarantined_at: now,
          archived_original_identifiers: {
            facility_id: text(row.facility_id),
            facility_reference: text(row.facility_reference),
          },
        },
      }
      const site = await supabaseService
        .from('customer_sites')
        .update({
          facility_id: archivedFacilityId,
          status: 'closed',
          metadata,
          is_test_data: true,
          is_active: false,
          archived_at: now,
          archived_by: input.actorUserId,
          archive_reason: reason,
          updated_by: input.actorUserId,
          updated_at: now,
        })
        .eq('company_id', input.companyId)
        .eq('id', input.siteId)
        .select('id')
        .maybeSingle()
      if (site.error) throw site.error
      if (!site.data) throw new Error('Fakturatest-karantän kunde inte verifiera testanläggningen.')
    }
  }

  const contracts = await supabaseService
    .from('customer_contracts')
    .select('id,metadata,status')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
  if (contracts.error) throw contracts.error
  for (const raw of (contracts.data ?? []) as Row[]) {
    const contractId = text(raw.id)
    if (!contractId) continue
    const metadata = {
      ...objectValue(raw.metadata),
      test_center: {
        ...marker(raw.metadata),
        kind: INVOICE_TEST_CUSTOMER_KIND,
        version: 1,
        quarantined_at: now,
      },
    }
    if (!['cancelled', 'terminated', 'expired'].includes(text(raw.status) ?? '')) {
      const contract = await supabaseService
        .from('customer_contracts')
        .update({
          status: 'cancelled',
          ended_at: now,
          status_reason_code: 'invoice_test_quarantine',
          metadata,
          updated_by: input.actorUserId,
          updated_at: now,
        })
        .eq('company_id', input.companyId)
        .eq('id', contractId)
      if (contract.error) throw contract.error
    }
  }

  const customerCurrent = await supabaseService
    .from('customers')
    .select('id,metadata')
    .eq('company_id', input.companyId)
    .eq('id', input.customerId)
    .maybeSingle()
  if (customerCurrent.error) throw customerCurrent.error
  const customerMetadata = {
    ...objectValue((customerCurrent.data as Row | null)?.metadata),
    test_center: {
      ...marker((customerCurrent.data as Row | null)?.metadata),
      kind: INVOICE_TEST_CUSTOMER_KIND,
      version: 1,
      quarantined_at: now,
    },
  }
  const customer = await supabaseService
    .from('customers')
    .update({
      source: INVOICE_TEST_CUSTOMER_SOURCE,
      is_test_data: true,
      metadata: customerMetadata,
      archived_at: now,
      archived_by: input.actorUserId,
      archive_reason: reason,
      updated_by: input.actorUserId,
      updated_at: now,
    })
    .eq('company_id', input.companyId)
    .eq('id', input.customerId)
    .select('id')
    .maybeSingle()
  if (customer.error) throw customer.error
  if (!customer.data) {
    throw new Error('Fakturatest-karantän kunde inte verifiera den nyss skapade kunden.')
  }

  return { quarantinedAt: now, customerId: input.customerId }
}
