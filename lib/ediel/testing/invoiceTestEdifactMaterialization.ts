import { supabaseService } from '@/lib/supabase/service'
import type { ParsedEdifactEnvelope } from '@/lib/inbound-mail/edielEmailParser'
import {
  assertInvoiceTestCustomer,
  INVOICE_TEST_CUSTOMER_KIND,
} from '@/lib/ediel/testing/invoiceTestCenterWorkspace'
import { resolveSingleInvoiceTestContractId } from '@/lib/ediel/testing/invoiceTestCenterCreation'
import { signInvoiceTestContractCanonically } from '@/lib/ediel/testing/invoiceTestContractLifecycle'

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

/**
 * Fakturatest never owns a separate masterdata parser. The values below are
 * derived exclusively from the canonical ParsedEdifactEnvelope produced by
 * the normal inbound parser. No facility/metering identity is invented here.
 */
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

async function loadCurrentTestPoints(input: { companyId: string; customerId: string }) {
  const result = await supabaseService
    .from('metering_points')
    .select('id,site_id,customer_id,meter_point_id,metering_point_id,site_facility_id,ediel_reference,anlage_id,ediel_metering_point_id,metadata,is_test_data,archived_at')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('is_test_data', true)
    .is('archived_at', null)
    .limit(2)
  if (result.error) throw result.error
  return (result.data ?? []) as Row[]
}

async function assertIdentityNotOwnedElsewhere(input: {
  companyId: string
  customerId: string
  identity: InvoiceTestEdifactIdentity
}) {
  const identity = input.identity.primaryMeteringReference
  const meterMatches = await supabaseService
    .from('metering_points')
    .select('id,company_id,customer_id')
    .or([
      `meter_point_id.eq.${identity}`,
      `metering_point_id.eq.${identity}`,
      `site_facility_id.eq.${identity}`,
      `ediel_reference.eq.${identity}`,
      `anlage_id.eq.${identity}`,
      `ediel_metering_point_id.eq.${identity}`,
    ].join(','))
    .limit(10)
  if (meterMatches.error) throw meterMatches.error
  const conflictingMeter = (meterMatches.data ?? []).some((row) =>
    text(row.company_id) !== input.companyId || text(row.customer_id) !== input.customerId,
  )
  if (conflictingMeter) {
    throw new Error('EDIFACT-identiteten är redan bunden utanför vald testkund. Fakturatest stoppades före masterdataändring.')
  }

  if (input.identity.facilityId) {
    const siteMatches = await supabaseService
      .from('customer_sites')
      .select('id,company_id,customer_id')
      .eq('company_id', input.companyId)
      .eq('facility_id', input.identity.facilityId)
      .limit(10)
    if (siteMatches.error) throw siteMatches.error
    const conflictingSite = (siteMatches.data ?? []).some((row) => text(row.customer_id) !== input.customerId)
    if (conflictingSite) {
      throw new Error('EDIFACT-anläggningen är redan bunden till en annan kund i valt bolag. Fakturatest stoppades före masterdataändring.')
    }
  }
}

async function bindInvoiceTestContractAndSupply(input: {
  companyId: string
  customerId: string
  siteId: string
  meteringPointId: string
  actorUserId: string
}) {
  const contractId = await resolveSingleInvoiceTestContractId({
    companyId: input.companyId,
    customerId: input.customerId,
  })
  const contractResult = await supabaseService
    .from('customer_contracts')
    .select('id,status,start_date,starts_at,metering_point_id,site_id,customer_site_id,metadata')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('id', contractId)
    .maybeSingle()
  if (contractResult.error) throw contractResult.error
  if (!contractResult.data) throw new Error('Fakturatest kunde inte återläsa testkundens canonical avtal.')
  let contract = contractResult.data as Row
  const currentMeteringPointId = text(contract.metering_point_id)
  const status = text(contract.status)

  if (status === 'pending_signature' || status === 'draft') {
    if (currentMeteringPointId && currentMeteringPointId !== input.meteringPointId) {
      throw new Error('Testavtalet är redan bundet till en annan mätpunkt före signering.')
    }
    const now = new Date().toISOString()
    const contractUpdate = await supabaseService
      .from('customer_contracts')
      .update({
        metering_point_id: input.meteringPointId,
        site_id: text(contract.site_id) ?? input.siteId,
        customer_site_id: text(contract.customer_site_id) ?? input.siteId,
        metadata: {
          ...objectValue(contract.metadata),
          invoice_test_edifact_binding: {
            metering_point_id: input.meteringPointId,
            site_id: input.siteId,
            bound_at: now,
            bound_by: input.actorUserId,
            test_only: true,
          },
        },
        updated_by: input.actorUserId,
        updated_at: now,
      })
      .eq('company_id', input.companyId)
      .eq('customer_id', input.customerId)
      .eq('id', contractId)
      .in('status', ['draft', 'pending_signature'])
      .select('id,status')
      .maybeSingle()
    if (contractUpdate.error) throw contractUpdate.error
    if (!contractUpdate.data) throw new Error('Fakturatest kunde inte binda mätpunkten till avtalet före signering.')

    await signInvoiceTestContractCanonically({
      companyId: input.companyId,
      customerId: input.customerId,
      contractId,
      actorUserId: input.actorUserId,
    })

    const signed = await supabaseService
      .from('customer_contracts')
      .select('id,status,start_date,starts_at,metering_point_id,site_id,customer_site_id,metadata')
      .eq('company_id', input.companyId)
      .eq('customer_id', input.customerId)
      .eq('id', contractId)
      .maybeSingle()
    if (signed.error) throw signed.error
    if (!signed.data || !['signed', 'active'].includes(String(signed.data.status))) {
      throw new Error('Fakturatest kunde inte verifiera canonical signering efter EDIFACT-bindning.')
    }
    contract = signed.data as Row
  } else if (!['signed', 'active'].includes(status ?? '')) {
    throw new Error(`Fakturatest-avtalet har ogiltig status för EDIFACT-bindning: ${status ?? 'saknas'}.`)
  }

  if (text(contract.metering_point_id) !== input.meteringPointId) {
    throw new Error('Signerade testavtalets låsta mätpunktsidentitet matchar inte importerad EDIFACT.')
  }

  const startDate = (text(contract.starts_at) ?? text(contract.start_date))?.slice(0, 10) ?? null
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw new Error('Fakturatest-avtalet saknar giltigt startdatum för leveransperioden.')
  }

  const periodResult = await supabaseService
    .from('customer_supply_periods')
    .select('id,company_id,customer_id,metering_point_id,contract_id,start_date,end_date,status')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .in('status', ['active', 'confirmed_by_grid_owner'])
    .limit(3)
  if (periodResult.error) throw periodResult.error
  const periods = (periodResult.data ?? []) as Row[]
  if (periods.length > 1) {
    throw new Error('Fakturatest-kunden har flera aktiva leveransperioder; billing-bindning stoppad fail-closed.')
  }
  if (periods.length === 1) {
    const existing = periods[0]
    if (
      text(existing.metering_point_id) !== input.meteringPointId ||
      text(existing.contract_id) !== contractId ||
      text(existing.start_date)?.slice(0, 10) !== startDate ||
      text(existing.end_date)
    ) {
      throw new Error('Fakturatest-kundens befintliga leveransperiod motsäger EDIFACT-/avtalsbindningen.')
    }
    return { contractId, supplyPeriodId: String(existing.id), startDate }
  }

  const now = new Date().toISOString()
  const insert = await supabaseService
    .from('customer_supply_periods')
    .insert({
      company_id: input.companyId,
      customer_id: input.customerId,
      metering_point_id: input.meteringPointId,
      contract_id: contractId,
      start_date: startDate,
      actual_start_date: startDate,
      end_date: null,
      source: 'invoice_test_center_edifact',
      source_process: 'invoice_test_center',
      status: 'active',
      metadata: {
        test_center: true,
        source: 'canonical_edifact_parser',
        bound_by: input.actorUserId,
        bound_at: now,
      },
      updated_at: now,
    })
    .select('id')
    .single()
  if (insert.error) throw insert.error
  return { contractId, supplyPeriodId: String(insert.data.id), startDate }
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
  const pointRows = await loadCurrentTestPoints(input)

  // Complete all identity checks before the first write so a mismatched file
  // cannot partially rewrite the selected Fakturatest customer graph.
  if (pointRows.length > 1) {
    throw new Error('Fakturatest-kunden har flera aktiva test-mätpunkter; EDIFACT-bindning stoppad fail-closed.')
  }
  if (pointRows.length === 1 && !matchesIdentity(pointRows[0], identity)) {
    throw new Error('Vald testkund är redan bunden till en annan EDIFACT-identitet. Radera testkunden och skapa en ny för den nya filen.')
  }
  const existingFacilityId = text(site.facility_id)
  if (existingFacilityId && identity.facilityId && existingFacilityId !== identity.facilityId) {
    throw new Error('Vald testkund är redan bunden till en annan EDIFACT-anläggning. Fakturatest stoppades före masterdataändring.')
  }
  await assertIdentityNotOwnedElsewhere({
    companyId: input.companyId,
    customerId: input.customerId,
    identity,
  })

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

  let meteringPointId: string
  let createdMeteringPoint = false

  if (pointRows.length === 1) {
    const existing = pointRows[0]
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
        status: 'active',
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
    meteringPointId = String(existing.id)
  } else {
    const pointMetadata = {
      test_center: {
        kind: INVOICE_TEST_CUSTOMER_KIND,
        version: 1,
        created_by: input.actorUserId,
        marked_at: now,
      },
      invoice_test_edifact: parsedMetadata,
    }
    const siteType = text(site.site_type)
    const measurementType = siteType === 'production' || siteType === 'mixed' ? siteType : 'consumption'
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
        metering_type: measurementType,
        measurement_type: measurementType,
        reading_frequency: 'hourly',
        is_settlement_relevant: true,
        status: 'active',
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
    meteringPointId = String(insert.data.id)
    createdMeteringPoint = true
  }

  const billingBinding = await bindInvoiceTestContractAndSupply({
    companyId: input.companyId,
    customerId: input.customerId,
    siteId,
    meteringPointId,
    actorUserId: input.actorUserId,
  })

  return {
    identity,
    siteId,
    meteringPointId,
    createdMeteringPoint,
    contractId: billingBinding.contractId,
    supplyPeriodId: billingBinding.supplyPeriodId,
  }
}

export async function loadInvoiceTestEdifactSummary(input: {
  companyId: string
  customerId: string
}): Promise<Row | null> {
  if (!input.companyId || !input.customerId) return null
  await assertInvoiceTestCustomer(input)
  const result = await supabaseService
    .from('metering_points')
    .select('id,metering_point_id,meter_point_id,site_facility_id,grid_area_code,meter_number,metadata,created_at,updated_at')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('is_test_data', true)
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (result.error) throw result.error
  if (!result.data) return null
  const row = result.data as Row
  return {
    id: row.id,
    metering_point_id: text(row.metering_point_id) ?? text(row.meter_point_id),
    facility_id: text(row.site_facility_id),
    grid_area_code: text(row.grid_area_code),
    meter_number: text(row.meter_number),
    imported: objectValue(objectValue(row.metadata).invoice_test_edifact),
    updated_at: row.updated_at,
  }
}
