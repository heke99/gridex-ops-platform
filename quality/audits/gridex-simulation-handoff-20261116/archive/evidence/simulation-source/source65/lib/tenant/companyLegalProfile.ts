import { supabaseService } from '@/lib/supabase/service'

export type CompanyLegalProfileInput = Record<string, unknown>

export type LegalProfileEditSection =
  | 'company_profile'
  | 'company_address'
  | 'company_complaints'
  | 'company_data_protection'
  | 'company_billing'

export type LegalProfileMissingField = {
  code: string
  label: string
  message: string
  edit_section: LegalProfileEditSection
  edit_path: string
}

export type LegalProfileCompletenessStatus =
  | 'incomplete'
  | 'complete_unreviewed'
  | 'verified'
  | 'blocked'

export type CompanyLegalProfileSyncResult = {
  company_id: string
  company_name: string
  completeness_status: LegalProfileCompletenessStatus
  missing_fields: string[]
  missing_field_details: LegalProfileMissingField[]
  review_required: boolean
  reviewed_at: string | null
  updated_at: string | null
}

type FieldCopy = {
  label: string
  message: string
  edit_section: LegalProfileEditSection
}

export const LEGAL_PROFILE_FIELD_COPY: Record<string, FieldCopy> = {
  legal_name: { label: 'Juridiskt bolagsnamn', message: 'Fyll i bolagets juridiska namn under Bolagsidentitet.', edit_section: 'company_profile' },
  organization_number: { label: 'Organisationsnummer', message: 'Fyll i ett giltigt svenskt organisationsnummer med korrekt kontrollsiffra.', edit_section: 'company_profile' },
  postal_address: { label: 'Postadress', message: 'Fyll i gatuadress, postnummer, ort och land under Postadress.', edit_section: 'company_address' },
  customer_service_email: { label: 'Kundservice', message: 'Fyll i en giltig e-postadress för kundservice.', edit_section: 'company_profile' },
  phone: { label: 'Telefon', message: 'Fyll i ett giltigt telefonnummer för kundservice.', edit_section: 'company_profile' },
  website: { label: 'Webbplats', message: 'Fyll i bolagets webbadress under Bolagsidentitet.', edit_section: 'company_profile' },
  complaints_contact: { label: 'Klagomålskontakt', message: 'Fyll i minst e-post, telefon eller komplett postadress under Klagomål.', edit_section: 'company_complaints' },
  data_protection_contact: { label: 'Dataskyddskontakt', message: 'Fyll i minst e-post, telefon eller komplett postadress under Dataskydd.', edit_section: 'company_data_protection' },
  billing_information: { label: 'Faktureringskontakt', message: 'Fyll i minst e-post, telefon eller komplett faktureringsadress under Fakturering.', edit_section: 'company_billing' },
  dispute_resolution_information: { label: 'Tvistlösning', message: 'OPS-standard för tvistlösning kunde inte byggas. Kontakta plattformsadministratören.', edit_section: 'company_profile' },
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function completenessStatus(value: unknown): LegalProfileCompletenessStatus {
  if (value === 'verified' || value === 'blocked' || value === 'complete_unreviewed') return value
  if (value === 'complete') return 'complete_unreviewed'
  return 'incomplete'
}

function editSection(value: unknown, code: string): LegalProfileEditSection {
  if (
    value === 'company_address' ||
    value === 'company_complaints' ||
    value === 'company_data_protection' ||
    value === 'company_billing' ||
    value === 'company_profile'
  ) return value
  return LEGAL_PROFILE_FIELD_COPY[code]?.edit_section ?? 'company_profile'
}

export function legalProfileEditPath(input: {
  companyId: string
  editSection: LegalProfileEditSection
  isPlatformAdmin?: boolean
}): string {
  const anchor = input.editSection === 'company_profile' ? 'company-profile' : input.editSection.replaceAll('_', '-')
  return input.isPlatformAdmin === false
    ? `/admin/company-settings#${anchor}`
    : `/admin/companies/${input.companyId}#${anchor}`
}

export function legalProfileMissingFieldDetail(
  companyId: string,
  code: string,
  isPlatformAdmin = true,
): LegalProfileMissingField {
  const copy = LEGAL_PROFILE_FIELD_COPY[code] ?? {
    label: code.replaceAll('_', ' '),
    message: 'Komplettera uppgiften under Redigera bolagsuppgifter.',
    edit_section: 'company_profile' as const,
  }
  return {
    code,
    ...copy,
    edit_path: legalProfileEditPath({ companyId, editSection: copy.edit_section, isPlatformAdmin }),
  }
}

export function normalizeCompanyLegalProfileSyncResult(
  value: unknown,
  companyId: string,
  options: { isPlatformAdmin?: boolean } = {},
): CompanyLegalProfileSyncResult {
  const row = record(value)
  const missingFields = stringArray(row.missing_fields)
  const details = Array.isArray(row.missing_field_details)
    ? row.missing_field_details
      .map(record)
      .map((detail) => {
        const code = nullableString(detail.code) ?? ''
        const section = editSection(detail.edit_section, code)
        return {
          code,
          label: nullableString(detail.label) ?? LEGAL_PROFILE_FIELD_COPY[code]?.label ?? code.replaceAll('_', ' '),
          message: nullableString(detail.message) ?? LEGAL_PROFILE_FIELD_COPY[code]?.message ?? 'Komplettera uppgiften under Redigera bolagsuppgifter.',
          edit_section: section,
          edit_path: legalProfileEditPath({ companyId, editSection: section, isPlatformAdmin: options.isPlatformAdmin }),
        }
      })
      .filter((detail) => detail.code)
    : missingFields.map((code) => legalProfileMissingFieldDetail(companyId, code, options.isPlatformAdmin ?? true))

  return {
    company_id: nullableString(row.company_id) ?? companyId,
    company_name: nullableString(row.company_name) ?? '',
    completeness_status: completenessStatus(row.completeness_status),
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
}): Promise<CompanyLegalProfileSyncResult> {
  const { data, error } = await supabaseService.rpc('gridex_update_company_and_rebuild_legal_profile', {
    p_company_id: input.companyId,
    p_actor_user_id: input.actorUserId,
    p_input: input.values,
    p_mark_reviewed: false,
  })
  if (error) throw error
  return normalizeCompanyLegalProfileSyncResult(data, input.companyId)
}

export async function rebuildCompanyLegalProfile(input: {
  companyId: string
  actorUserId: string
}): Promise<CompanyLegalProfileSyncResult> {
  const { data, error } = await supabaseService.rpc('gridex_rebuild_company_legal_profile', {
    p_company_id: input.companyId,
    p_actor_user_id: input.actorUserId,
    p_mark_reviewed: false,
  })
  if (error) throw error
  return normalizeCompanyLegalProfileSyncResult(data, input.companyId)
}

export async function reviewCompanyLegalProfile(input: {
  companyId: string
  actorUserId: string
}): Promise<CompanyLegalProfileSyncResult> {
  const { data, error } = await supabaseService.rpc('gridex_review_company_legal_profile', {
    p_company_id: input.companyId,
    p_actor_user_id: input.actorUserId,
  })
  if (error) throw error
  return normalizeCompanyLegalProfileSyncResult(data, input.companyId)
}
