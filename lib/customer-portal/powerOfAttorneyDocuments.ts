import { supabaseService } from '@/lib/supabase/service'
import type { PortalCustomerContext } from '@/lib/customer-portal/apiData'
import { isMissingPortalSchemaError } from '@/lib/customer-portal/customerResolver'

type PoaRow = Record<string, unknown>

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function rows(value: unknown): PoaRow[] {
  return Array.isArray(value) ? (value as unknown as PoaRow[]) : []
}

function isSigned(row: PoaRow) {
  return text(row.status)?.toLowerCase() === 'signed'
}

function poaTitle(row: PoaRow) {
  const reference = text(row.reference)
  return reference ? `Signerad fullmakt ${reference}` : 'Signerad fullmakt'
}

function documentPayload(row: PoaRow, context: PortalCustomerContext) {
  const snapshot = objectValue(row.fullmakt_snapshot)
  const metadata = objectValue(row.metadata)
  const acceptedAt = text(row.accepted_at) ?? text(row.signed_at) ?? text(row.created_at)

  return {
    company_id: context.companyId,
    customer_id: context.customerId,
    customer_number: context.customerNumber ?? text(row.customer_number),
    external_customer_id: context.externalCustomerId ?? text(row.external_customer_id),
    customer_site_id: text(row.customer_site_id) ?? text(row.site_id),
    metering_point_id: text(row.metering_point_id),
    contract_id: text(row.contract_id),
    customer_contract_id: text(row.customer_contract_id),
    power_of_attorney_id: text(row.id),
    document_type: 'power_of_attorney',
    title: poaTitle(row),
    file_name: `fullmakt-${text(row.reference) ?? text(row.id) ?? 'kund'}.json`,
    mime_type: 'application/json',
    file_size_bytes: null,
    storage_bucket: null,
    file_path: null,
    public_url: null,
    source_system: 'ops_powers_of_attorney',
    source: 'powers_of_attorney_backfill',
    status: 'available',
    document_version: text(objectValue(snapshot.legal_text).version) ?? text(metadata.version) ?? 'snapshot',
    raw_payload: {
      source: 'powers_of_attorney',
      power_of_attorney_id: text(row.id),
      reference: text(row.reference),
      scope: text(row.scope),
      status: text(row.status),
      accepted_at: acceptedAt,
      signed_at: text(row.signed_at),
      valid_from: text(row.valid_from),
      valid_to: text(row.valid_to),
      valid_until: text(row.valid_until),
      legal_bundle_version_document_id: text(row.legal_bundle_version_document_id),
      legal_text_version_id: text(row.legal_text_version_id),
      snapshot,
    },
    metadata: {
      generated_from: 'powers_of_attorney.fullmakt_snapshot',
      generated_by: 'ops_portal_bundle_document_backfill',
      document_kind: 'power_of_attorney_snapshot',
      power_of_attorney_id: text(row.id),
      reference: text(row.reference),
      accepted_at: acceptedAt,
      immutable_legal_acceptances: 'not_updated',
    },
    audit: {
      created_from: 'portal_bundle_or_migration_backfill',
      legal_acceptances_mutated: false,
    },
    updated_at: new Date().toISOString(),
  }
}

async function loadSignedPowersOfAttorney(context: PortalCustomerContext): Promise<PoaRow[]> {
  const selects = [
    'id,company_id,customer_id,customer_number,external_customer_id,contract_id,customer_contract_id,customer_site_id,site_id,metering_point_id,scope,status,signed_at,accepted_at,valid_from,valid_to,valid_until,legal_bundle_version_document_id,legal_text_version_id,fullmakt_snapshot,metadata,reference,created_at',
    'id,company_id,customer_id,contract_id,customer_site_id,site_id,scope,status,signed_at,accepted_at,legal_bundle_version_document_id,legal_text_version_id,fullmakt_snapshot,metadata,reference,created_at',
    'id,company_id,customer_id,site_id,scope,status,signed_at,reference,created_at',
  ]

  // query-loop-budget: bounded-schema-fallback max=3
  for (const select of selects) {
    const { data, error } = await supabaseService
      .from('powers_of_attorney')
      .select(select)
      .eq('company_id', context.companyId)
      .eq('customer_id', context.customerId)
      .order('created_at', { ascending: false })
      .limit(100)

    if (!error) return rows(data).filter(isSigned)
    if (!isMissingPortalSchemaError(error)) throw error
  }
  return []
}

async function existingDocumentIds(context: PortalCustomerContext, poaIds: string[]): Promise<Set<string>> {
  if (poaIds.length === 0) return new Set()
  const { data, error } = await supabaseService
    .from('customer_documents')
    .select('power_of_attorney_id')
    .eq('company_id', context.companyId)
    .eq('customer_id', context.customerId)
    .eq('document_type', 'power_of_attorney')
    .in('power_of_attorney_id', poaIds)

  if (error) {
    if (isMissingPortalSchemaError(error)) return new Set()
    throw error
  }

  return new Set((data ?? []).map((row) => text((row as Record<string, unknown>).power_of_attorney_id)).filter((value): value is string => Boolean(value)))
}

export async function ensurePowerOfAttorneyDocumentsForPortalCustomer(context: PortalCustomerContext) {
  const powers = await loadSignedPowersOfAttorney(context)
  const ids = powers.map((row) => text(row.id)).filter((value): value is string => Boolean(value))
  const existing = await existingDocumentIds(context, ids)
  const rows = powers
    .filter((row) => {
      const id = text(row.id)
      return id && !existing.has(id)
    })
    .map((row) => documentPayload(row, context))

  if (rows.length === 0) return { created: 0, skipped: ids.length }

  const { error } = await supabaseService
    .from('customer_documents')
    .insert(rows)

  if (error) {
    if (isMissingPortalSchemaError(error)) return { created: 0, skipped: ids.length, warning: 'customer_documents_schema_missing' }
    throw error
  }

  return { created: rows.length, skipped: ids.length - rows.length }
}
