import { supabaseService } from '@/lib/supabase/service'

export type CompanyLegalProfileInput = Record<string, unknown>

export type LegalProfileMissingField = {
  code: string
  label: string
  message: string
  edit_path: string
}

export type CompanyLegalProfileSyncResult = {
  company_id: string
  company_name: string
  completeness_status: string
  missing_fields: string[]
  missing_field_details: LegalProfileMissingField[]
  review_required: boolean
  reviewed_at: string | null
  updated_at: string | null
}

export const LEGAL_PROFILE_FIELD_COPY: Record<string, Omit<LegalProfileMissingField, 'code' | 'edit_path'>> = {
  legal_name: { label: 'Juridiskt bolagsnamn', message: 'Fyll i bolagets juridiska namn under Bolagsidentitet.' },
  organization_number: { label: 'Organisationsnummer', message: 'Fyll i ett giltigt svenskt organisationsnummer med tio siffror.' },
  postal_address: { label: 'Postadress', message: 'Fyll i gatuadress, postnummer, ort och land under Postadress.' },
  customer_service_email: { label: 'Kundservice', message: 'Fyll i en giltig e-postadress för kundservice.' },
  phone: { label: 'Telefon', message: 'Fyll i ett giltigt telefonnummer för kundservice.' },
  website: { label: 'Webbplats', message: 'Fyll i bolagets webbadress under Bolagsidentitet.' },
  complaints_contact: { label: 'Klagomålskontakt', message: 'Fyll i minst e-post, telefon eller komplett postadress under Klagomål.' },
  data_protection_contact: { label: 'Dataskyddskontakt', message: 'Fyll i minst e-post, telefon eller komplett postadress under Dataskydd.' },
  billing_information: { label: 'Faktureringskontakt', message: 'Fyll i minst e-post, telefon eller komplett faktureringsadress under Fakturering.' },
  dispute_resolution_information: { label: 'Tvistlösning', message: 'OPS-standard för tvistlösning kunde inte byggas. Kontakta plattformsadministratören.' },
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

export function legalProfileMissingFieldDetail(companyId: string, code: string): LegalProfileMissingField {
  const copy = LEGAL_PROFILE_FIELD_COPY[code] ?? {
    label: code.replaceAll('_', ' '),
    message: 'Komplettera uppgiften under Redigera bolagsuppgifter.',
  }
  return { code, ...copy, edit_path: `/admin/companies/${companyId}#company-profile` }
}

export function normalizeCompanyLegalProfileSyncResult(value: unknown, companyId: string): CompanyLegalProfileSyncResult {
  const row = record(value)
  const missingFields = stringArray(row.missing_fields)
  const details = Array.isArray(row.missing_field_details)
    ? row.missing_field_details
      .map(record)
      .map((detail) => ({
        code: nullableString(detail.code) ?? '',
        label: nullableString(detail.label) ?? '',
        message: nullableString(detail.message) ?? '',
        edit_path: nullableString(detail.edit_path) ?? `/admin/companies/${companyId}#company-profile`,
      }))
      .filter((detail) => detail.code)
    : missingFields.map((code) => legalProfileMissingFieldDetail(companyId, code))

  return {
    company_id: nullableString(row.company_id) ?? companyId,
    company_name: nullableString(row.company_name) ?? '',
    completeness_status: nullableString(row.completeness_status) ?? 'incomplete',
    missing_fields: missingFields,
    missing_field_details: details,
    review_required: row.review_required === true,
    reviewed_at: nullableString(row.reviewed_at),
    updated_at: nullableString(row.updated_at),
  }
}

export async function updateCompanyAndRebuildLegalProfile(input: {
  companyId: string
  actorUserId: string
  values: CompanyLegalProfileInput
  markReviewed: boolean
}): Promise<CompanyLegalProfileSyncResult> {
  const { data, error } = await supabaseService.rpc('gridex_update_company_and_rebuild_legal_profile', {
    p_company_id: input.companyId,
    p_actor_user_id: input.actorUserId,
    p_input: input.values,
    p_mark_reviewed: input.markReviewed,
  })
  if (error) throw error
  return normalizeCompanyLegalProfileSyncResult(data, input.companyId)
}

export async function rebuildCompanyLegalProfile(input: {
  companyId: string
  actorUserId: string
  markReviewed: boolean
}): Promise<CompanyLegalProfileSyncResult> {
  const { data, error } = await supabaseService.rpc('gridex_rebuild_company_legal_profile', {
    p_company_id: input.companyId,
    p_actor_user_id: input.actorUserId,
    p_mark_reviewed: input.markReviewed,
  })
  if (error) throw error
  return normalizeCompanyLegalProfileSyncResult(data, input.companyId)
}
