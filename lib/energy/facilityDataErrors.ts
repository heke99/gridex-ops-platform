import { supabaseService } from '@/lib/supabase/service'

export type FacilityBusinessErrorCode =
  | 'facility_data_invalid'
  | 'customer_information_mismatch'
  | 'grid_owner_rejected_request'
  | 'negative_aperak_received'
  | 'z02_rejected'
  | 'needs_customer_correction'
  | 'needs_grid_owner_followup'
  | 'duplicate_facility_id'
  | 'cross_tenant_facility_conflict'
  | 'protected_identity'
  | 'timeout'

export type FacilityBusinessError = {
  code: FacilityBusinessErrorCode
  status: string
  issueType: string
  title: string
  message: string
  recommendedAction: string
  retryAllowed: boolean
  requiresCustomerContact: boolean
  requiresGridOwnerContact: boolean
  requiresSuperadminReview: boolean
}

type FacilityConflictRow = {
  id: string
  company_id: string
  customer_id: string | null
  facility_id: string | null
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function missingSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? ''
  const message = (error as { message?: string } | null)?.message ?? ''
  return ['42P01', '42703', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist/i.test(message)
}

export function normalizeFacilityId(value: unknown): string | null {
  const raw = clean(value)
  if (!raw) return null
  return raw.replace(/\s+/g, '').toUpperCase()
}

export function normalizeMeteringPointId(value: unknown): string | null {
  const raw = clean(value)
  if (!raw) return null
  return raw.replace(/\s+/g, '').toUpperCase()
}

export function mapFacilityBusinessError(code: FacilityBusinessErrorCode, details: Partial<FacilityBusinessError> = {}): FacilityBusinessError {
  const catalog: Record<FacilityBusinessErrorCode, FacilityBusinessError> = {
    facility_data_invalid: {
      code,
      status: 'facility_data_invalid',
      issueType: 'facility_data_invalid',
      title: 'Anläggningsuppgifter kunde inte verifieras',
      message: 'Anläggnings-ID, mätpunkt eller nätägarsvar stämmer inte.',
      recommendedAction: 'Stoppa leverantörsbyte, visa felet i kundansökan och begär rätt uppgifter från kund eller nätägare.',
      retryAllowed: false,
      requiresCustomerContact: true,
      requiresGridOwnerContact: true,
      requiresSuperadminReview: false,
    },
    customer_information_mismatch: {
      code,
      status: 'customer_information_mismatch',
      issueType: 'customer_information_mismatch',
      title: 'Kunduppgifter matchar inte',
      message: 'Nätägaren eller valideringen anger att kundidentiteten inte matchar anläggningen.',
      recommendedAction: 'Kontrollera personnummer/organisationsnummer med kunden och kör ny readiness-check efter rättning.',
      retryAllowed: false,
      requiresCustomerContact: true,
      requiresGridOwnerContact: true,
      requiresSuperadminReview: false,
    },
    grid_owner_rejected_request: {
      code,
      status: 'grid_owner_rejected_request',
      issueType: 'grid_owner_rejected_request',
      title: 'Nätägaren avvisade begäran',
      message: 'Begäran är affärsmässigt avvisad och får inte leda till automatisk switch.',
      recommendedAction: 'Läs nätägarens svar, kontrollera nätområde och skapa uppföljning innan nytt meddelande skickas.',
      retryAllowed: false,
      requiresCustomerContact: false,
      requiresGridOwnerContact: true,
      requiresSuperadminReview: false,
    },
    negative_aperak_received: {
      code,
      status: 'negative_aperak_received',
      issueType: 'negative_aperak',
      title: 'Negativ APERAK mottagen',
      message: 'Mottagaren har tekniskt tagit emot meddelandet men avvisat innehållet.',
      recommendedAction: 'Mappa APERAK-koden till affärsåtgärd, stoppa processen och kör ny readiness-check efter rättning.',
      retryAllowed: false,
      requiresCustomerContact: true,
      requiresGridOwnerContact: true,
      requiresSuperadminReview: false,
    },
    z02_rejected: {
      code,
      status: 'z02_rejected',
      issueType: 'z02_rejected',
      title: 'Z02 avvisade anläggningskontrollen',
      message: 'Nätägaren bekräftade inte uppgifterna i Z01-flödet.',
      recommendedAction: 'Begär rätt anläggnings-/kunduppgifter och skicka inte Z03 förrän ny readiness-check är grön.',
      retryAllowed: false,
      requiresCustomerContact: true,
      requiresGridOwnerContact: true,
      requiresSuperadminReview: false,
    },
    needs_customer_correction: {
      code,
      status: 'needs_customer_correction',
      issueType: 'needs_customer_correction',
      title: 'Kunden behöver komplettera uppgifter',
      message: 'Ansökan saknar eller har fel uppgifter som kunden behöver rätta.',
      recommendedAction: 'Skapa kompletteringsbegäran, tillåt uppladdning av elnätsfaktura och kör ny validering efter rättning.',
      retryAllowed: false,
      requiresCustomerContact: true,
      requiresGridOwnerContact: false,
      requiresSuperadminReview: false,
    },
    needs_grid_owner_followup: {
      code,
      status: 'needs_grid_owner_followup',
      issueType: 'needs_grid_owner_followup',
      title: 'Nätägare behöver kontaktas',
      message: 'Systemet behöver få eller bekräfta strukturdata från nätägaren.',
      recommendedAction: 'Skapa nätägarbegäran via korrekt route och stoppa switch tills svaret är mottaget.',
      retryAllowed: true,
      requiresCustomerContact: false,
      requiresGridOwnerContact: true,
      requiresSuperadminReview: false,
    },
    duplicate_facility_id: {
      code,
      status: 'duplicate_facility_id',
      issueType: 'duplicate_facility_id',
      title: 'Anläggnings-ID finns redan i tenant',
      message: 'Samma anläggnings-ID finns redan hos ett kundkort i bolaget.',
      recommendedAction: 'Skapa inte dubblett. Öppna befintlig kund/anläggning och länka eller granska innan fortsatt handläggning.',
      retryAllowed: false,
      requiresCustomerContact: false,
      requiresGridOwnerContact: false,
      requiresSuperadminReview: false,
    },
    cross_tenant_facility_conflict: {
      code,
      status: 'manual_review',
      issueType: 'cross_tenant_facility_conflict',
      title: 'Anläggnings-ID behöver verifieras',
      message: 'Anläggnings-ID behöver verifieras innan automation. Andra tenants kunddata visas aldrig.',
      recommendedAction: 'Tillåt separat kundrelation, men stoppa automation tills anläggning, startdatum och fullmakt är verifierade.',
      retryAllowed: false,
      requiresCustomerContact: false,
      requiresGridOwnerContact: false,
      requiresSuperadminReview: true,
    },
    protected_identity: {
      code,
      status: 'protected_identity',
      issueType: 'protected_identity',
      title: 'Skyddad identitet',
      message: 'Kunden kräver skyddad hantering. Autosändning och vanlig e-post ska stoppas.',
      recommendedAction: 'Begränsa UI, skapa manual review och hantera via behörig roll.',
      retryAllowed: false,
      requiresCustomerContact: false,
      requiresGridOwnerContact: false,
      requiresSuperadminReview: true,
    },
    timeout: {
      code,
      status: 'waiting_grid_owner_response',
      issueType: 'timeout',
      title: 'Svar saknas inom SLA',
      message: 'Förväntat svar från route/nätägare saknas.',
      recommendedAction: 'Skapa uppföljning eller retry enligt feltyp. Affärsfel ska inte retry:as utan rättad data.',
      retryAllowed: true,
      requiresCustomerContact: false,
      requiresGridOwnerContact: true,
      requiresSuperadminReview: false,
    },
  }

  return { ...catalog[code], ...details, code }
}

export async function findFacilityConflicts(input: {
  companyId: string
  customerId?: string | null
  facilityId?: string | null
}): Promise<{ sameTenant: FacilityConflictRow[]; crossTenantExists: boolean }> {
  const facilityId = normalizeFacilityId(input.facilityId)
  if (!input.companyId || !facilityId) return { sameTenant: [], crossTenantExists: false }

  const sameTenant = await supabaseService
    .from('customer_sites')
    .select('id,company_id,customer_id,facility_id')
    .eq('company_id', input.companyId)
    .eq('facility_id', facilityId)
    .limit(10)

  if (sameTenant.error && !missingSchema(sameTenant.error)) throw sameTenant.error

  const crossTenant = await supabaseService
    .from('customer_sites')
    .select('id')
    .neq('company_id', input.companyId)
    .eq('facility_id', facilityId)
    .limit(1)

  if (crossTenant.error && !missingSchema(crossTenant.error)) throw crossTenant.error

  return {
    sameTenant: ((sameTenant.data ?? []) as FacilityConflictRow[]).filter((row) => row.customer_id !== input.customerId),
    crossTenantExists: (crossTenant.data ?? []).length > 0,
  }
}

export async function recordFacilityDataIssue(input: {
  companyId: string
  customerId?: string | null
  customerSiteId?: string | null
  meteringPointRowId?: string | null
  customerApplicationId?: string | null
  gridOwnerId?: string | null
  facilityId?: string | null
  meteringPointId?: string | null
  gridAreaCode?: string | null
  priceArea?: string | null
  source?: string | null
  sourceErrorCode?: string | null
  sourceErrorText?: string | null
  error: FacilityBusinessError
  metadata?: Record<string, unknown>
}) {
  const now = new Date().toISOString()
  const row = {
    company_id: input.companyId,
    customer_id: input.customerId ?? null,
    customer_site_id: input.customerSiteId ?? null,
    metering_point_id: input.meteringPointRowId ?? null,
    customer_application_id: input.customerApplicationId ?? null,
    grid_owner_id: input.gridOwnerId ?? null,
    issue_type: input.error.issueType,
    status: input.error.requiresSuperadminReview
      ? 'waiting_superadmin'
      : input.error.requiresGridOwnerContact
        ? 'waiting_grid_owner'
        : input.error.requiresCustomerContact
          ? 'waiting_customer'
          : 'open',
    severity: 'blocking',
    facility_id: normalizeFacilityId(input.facilityId),
    ediel_metering_point_id: normalizeMeteringPointId(input.meteringPointId),
    grid_area_code: clean(input.gridAreaCode),
    price_area: clean(input.priceArea),
    source: input.source ?? 'system',
    source_error_code: input.sourceErrorCode ?? input.error.code,
    source_error_text: input.sourceErrorText ?? input.error.message,
    recommended_action: input.error.recommendedAction,
    retry_allowed: input.error.retryAllowed,
    next_readiness_required: true,
    metadata: {
      title: input.error.title,
      message: input.error.message,
      status: input.error.status,
      ...(input.metadata ?? {}),
    },
  }

  const result = await supabaseService
    .from('facility_data_quality_issues')
    .insert(row)
    .select('id')
    .single()

  if (result.error && !missingSchema(result.error)) throw result.error

  if (input.customerSiteId) {
    const siteUpdate = await supabaseService
      .from('customer_sites')
      .update({
        facility_data_status: input.error.status,
        facility_data_last_error: input.error.recommendedAction,
        facility_data_last_error_code: input.error.code,
        updated_at: now,
      })
      .eq('company_id', input.companyId)
      .eq('id', input.customerSiteId)

    if (siteUpdate.error && !missingSchema(siteUpdate.error)) throw siteUpdate.error
  }

  return result.data?.id ? String(result.data.id) : null
}
