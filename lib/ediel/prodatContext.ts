import type { SupabaseClient } from '@supabase/supabase-js'

type AnyRow = Record<string, unknown>

export type EdielProdatCandidateIssueSeverity = 'error' | 'warning' | 'info'

export type EdielProdatCandidateIssue = {
  severity: EdielProdatCandidateIssueSeverity
  code: string
  title: string
  description: string
}

export type EdielProdatProductionCandidate = {
  switchRequestId: string
  switchStatus: string
  requestType: string
  requestedStartDate: string | null
  externalReference: string | null
  customerId: string | null
  customerLabel: string
  customerIdentifier: string | null
  customerEmail: string | null
  customerPhone: string | null
  siteId: string | null
  siteLabel: string
  facilityId: string | null
  siteAddress: string | null
  annualConsumptionKwh: number | null
  meteringPointDbId: string | null
  meteringPointId: string | null
  meteringMethod: string | null
  portalMeteringMethod: string | null
  portalReasonForTransaction: string | null
  portalCustomerIdCodeListQualifier: string | null
  readingFrequency: string | null
  gridOwnerId: string | null
  gridOwnerName: string | null
  gridOwnerEdielId: string | null
  communicationRouteId: string | null
  communicationRouteName: string | null
  communicationRouteType: string | null
  powerOfAttorneyId: string | null
  powerOfAttorneyReference: string | null
  powerOfAttorneyStatus: string | null
  canCreateZ03: boolean
  canCreateZ04: boolean
  readyForPortalOrProduction: boolean
  issues: EdielProdatCandidateIssue[]
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function objectValue(value: unknown): AnyRow {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as AnyRow) : {}
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

function rowById(rows: AnyRow[]): Map<string, AnyRow> {
  return new Map(rows.map((row) => [String(row.id), row]))
}

function customerLabel(customer: AnyRow | null | undefined, customerId: string | null): string {
  if (!customer) return customerId ? `Kund ${customerId.slice(0, 8)}` : 'Okänd kund'
  return (
    asString(customer.full_name) ??
    asString(customer.company_name) ??
    [asString(customer.first_name), asString(customer.last_name)].filter(Boolean).join(' ').trim() ??
    asString(customer.customer_number) ??
    `Kund ${String(customer.id).slice(0, 8)}`
  ) || `Kund ${String(customer.id).slice(0, 8)}`
}

function customerIdentifier(customer: AnyRow | null | undefined): string | null {
  return asString(customer?.personal_number) ?? asString(customer?.org_number) ?? null
}

function siteLabel(site: AnyRow | null | undefined, siteId: string | null): string {
  if (!site) return siteId ? `Anläggning ${siteId.slice(0, 8)}` : 'Okänd anläggning'
  return asString(site.site_name) ?? asString(site.facility_id) ?? `Anläggning ${String(site.id).slice(0, 8)}`
}

function siteAddress(site: AnyRow | null | undefined): string | null {
  if (!site) return null
  const parts = [asString(site.street), asString(site.postal_code), asString(site.city)].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : null
}

function latestMatchingPoa(poas: AnyRow[], switchRow: AnyRow): AnyRow | null {
  const switchPoaId = asString(switchRow.power_of_attorney_id)
  if (switchPoaId) {
    const exact = poas.find((poa) => asString(poa.id) === switchPoaId)
    if (exact) return exact
  }

  const customerId = asString(switchRow.customer_id)
  const siteId = asString(switchRow.site_id)
  return (
    poas.find((poa) =>
      asString(poa.customer_id) === customerId &&
      (asString(poa.site_id) === siteId || asString(poa.site_id) === null) &&
      asString(poa.scope) === 'supplier_switch' &&
      asString(poa.status) === 'signed'
    ) ?? null
  )
}

function routeForGridOwner(routes: AnyRow[], gridOwnerId: string | null): AnyRow | null {
  return (
    routes.find((route) =>
      route.is_active === true &&
      asString(route.route_scope) === 'supplier_switch' &&
      gridOwnerId &&
      asString(route.grid_owner_id) === gridOwnerId
    ) ??
    routes.find((route) =>
      route.is_active === true &&
      asString(route.route_scope) === 'supplier_switch' &&
      !asString(route.grid_owner_id) &&
      ['ediel_partner', 'email_manual', 'file_export'].includes(asString(route.route_type) ?? '')
    ) ??
    null
  )
}

function addIssue(
  issues: EdielProdatCandidateIssue[],
  severity: EdielProdatCandidateIssueSeverity,
  code: string,
  title: string,
  description: string
) {
  issues.push({ severity, code, title, description })
}

function validateCandidate(input: {
  switchRow: AnyRow
  customer: AnyRow | null
  site: AnyRow | null
  meteringPoint: AnyRow | null
  gridOwner: AnyRow | null
  route: AnyRow | null
  poa: AnyRow | null
}): EdielProdatCandidateIssue[] {
  const issues: EdielProdatCandidateIssue[] = []

  if (!input.customer) addIssue(issues, 'error', 'customer_missing', 'Kund saknas', 'Switchärendet är inte kopplat till en kund.')
  if (input.customer && !customerIdentifier(input.customer)) addIssue(issues, 'error', 'customer_identifier_missing', 'Personnummer/orgnummer saknas', 'PRODAT får inte skapas utan säker kundidentifiering.')
  if (input.customer && !asString(input.customer.email) && !asString(input.customer.phone)) addIssue(issues, 'error', 'customer_contact_missing', 'Kontaktuppgift saknas', 'Outbound-valideringen kräver minst e-post eller telefon på kunden innan PRODAT-utkast får skapas.')
  if (!input.site) addIssue(issues, 'error', 'site_missing', 'Anläggning saknas', 'Switchärendet måste vara kopplat till en anläggning.')
  if (!asString(input.site?.facility_id)) addIssue(issues, 'error', 'facility_id_missing', 'Anläggnings-ID saknas', 'Anläggnings-ID krävs för Z03/Z04.')
  if (!input.meteringPoint) addIssue(issues, 'error', 'metering_point_missing', 'Mätpunkt saknas', 'Switchärendet måste vara kopplat till en mätpunkt.')
  if (!asString(input.meteringPoint?.meter_point_id)) addIssue(issues, 'error', 'metering_point_id_missing', 'Mätpunkts-ID saknas', 'Mätpunkts-ID krävs innan Ediel kan skickas.')
  if (!asString(input.switchRow.requested_start_date)) addIssue(issues, 'error', 'start_date_missing', 'Startdatum saknas', 'Avtalets startdatum måste vara satt.')
  if (!input.gridOwner) addIssue(issues, 'error', 'grid_owner_missing', 'Nätägare saknas', 'Nätägare behövs för routing och mottagare.')
  if (input.gridOwner && !asString(input.gridOwner.ediel_id)) addIssue(issues, 'error', 'grid_owner_ediel_missing', 'Nätägarens Ediel-ID saknas', 'Mottagarens Ediel-ID måste finnas på nätägaren.')
  if (!input.route) addIssue(issues, 'error', 'route_missing', 'Ediel-route saknas', 'Det finns ingen aktiv route för leverantörsbyte till nätägaren.')
  if (!input.poa) addIssue(issues, 'error', 'poa_missing', 'Signerad fullmakt saknas', 'Systemet spärrar Z03/Z04 tills signerad fullmakt eller komplett avtal finns.')
  if (input.poa && asString(input.poa.status) !== 'signed') addIssue(issues, 'error', 'poa_not_signed', 'Fullmakten är inte signerad', 'Endast signerad fullmakt får användas som underlag.')
  if (input.poa && !asString(input.poa.reference)) addIssue(issues, 'warning', 'poa_reference_missing', 'Fullmaktsreferens saknas', 'Lägg in referens så filen kan spåras mot avtal/fullmakt.')
  if (!asNumber(input.site?.annual_consumption_kwh)) addIssue(issues, 'warning', 'annual_consumption_missing', 'Årsförbrukning saknas', 'Rekommenderas för bättre PRODAT-underlag och färre manuella kompletteringar.')
  if (!asString(input.meteringPoint?.reading_frequency)) addIssue(issues, 'warning', 'reading_frequency_missing', 'Rapporteringsfrekvens saknas', 'Lägg in frekvens när nätägaren kräver det.')

  return issues
}

export async function listEdielProdatProductionCandidates(
  supabase: SupabaseClient,
  limit = 30
): Promise<EdielProdatProductionCandidate[]> {
  const { data: switches, error: switchesError } = await supabase
    .from('supplier_switch_requests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (switchesError) throw switchesError

  const switchRows = (switches ?? []) as AnyRow[]
  if (switchRows.length === 0) return []

  const customerIds = unique(switchRows.map((row) => asString(row.customer_id)))
  const siteIds = unique(switchRows.map((row) => asString(row.site_id)))
  const meteringPointIds = unique(switchRows.map((row) => asString(row.metering_point_id)))
  const gridOwnerIds = unique(switchRows.map((row) => asString(row.grid_owner_id)))

  const [customersRaw, sitesRaw, meteringPointsRaw, gridOwnersRaw, poasRaw, routesRaw] = await Promise.all([
    customerIds.length > 0
      ? supabase.from('customers').select('id,customer_type,status,first_name,last_name,full_name,company_name,personal_number,org_number,email,phone,customer_number').in('id', customerIds)
      : Promise.resolve({ data: [], error: null }),
    siteIds.length > 0
      ? supabase.from('customer_sites').select('*').in('id', siteIds)
      : Promise.resolve({ data: [], error: null }),
    meteringPointIds.length > 0
      ? supabase.from('metering_points').select('*').in('id', meteringPointIds)
      : Promise.resolve({ data: [], error: null }),
    gridOwnerIds.length > 0
      ? supabase.from('grid_owners').select('*').in('id', gridOwnerIds)
      : Promise.resolve({ data: [], error: null }),
    customerIds.length > 0
      ? supabase.from('powers_of_attorney').select('*').in('customer_id', customerIds).order('created_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    supabase.from('communication_routes').select('*').eq('route_scope', 'supplier_switch').order('updated_at', { ascending: false }),
  ])

  for (const result of [customersRaw, sitesRaw, meteringPointsRaw, gridOwnersRaw, poasRaw, routesRaw]) {
    if (result.error) throw result.error
  }

  const customersById = rowById((customersRaw.data ?? []) as AnyRow[])
  const sitesById = rowById((sitesRaw.data ?? []) as AnyRow[])
  const meteringPointsById = rowById((meteringPointsRaw.data ?? []) as AnyRow[])
  const gridOwnersById = rowById((gridOwnersRaw.data ?? []) as AnyRow[])
  const poas = (poasRaw.data ?? []) as AnyRow[]
  const routes = (routesRaw.data ?? []) as AnyRow[]

  return switchRows.map((switchRow) => {
    const customerId = asString(switchRow.customer_id)
    const siteId = asString(switchRow.site_id)
    const meteringPointDbId = asString(switchRow.metering_point_id)
    const gridOwnerId = asString(switchRow.grid_owner_id)
    const customer = customerId ? customersById.get(customerId) ?? null : null
    const site = siteId ? sitesById.get(siteId) ?? null : null
    const meteringPoint = meteringPointDbId ? meteringPointsById.get(meteringPointDbId) ?? null : null
    const gridOwner = gridOwnerId ? gridOwnersById.get(gridOwnerId) ?? null : null
    const route = routeForGridOwner(routes, gridOwnerId)
    const poa = latestMatchingPoa(poas, switchRow)
    const validationSnapshot = objectValue(switchRow.validation_snapshot)
    const portalData = objectValue(validationSnapshot.portalData)
    const portalOverrides = objectValue(portalData.testCaseOverrides)
    const portalMeteringMethod = asString(portalOverrides.meteringMethod) ?? asString(portalData.meteringMethod)
    const portalReasonForTransaction = asString(portalOverrides.reasonForTransaction) ?? asString(portalData.reasonForTransaction)
    const portalCustomerIdCodeListQualifier =
      asString(portalOverrides.customerIdCodeListQualifier) ?? asString(portalData.customerIdCodeListQualifier)
    const issues = validateCandidate({ switchRow, customer, site, meteringPoint, gridOwner, route, poa })
    const hasBlockingError = issues.some((issue) => issue.severity === 'error')
    const status = asString(switchRow.status) ?? 'unknown'
    const canCreate = !hasBlockingError && !['completed', 'cancelled'].includes(status)

    return {
      switchRequestId: String(switchRow.id),
      switchStatus: status,
      requestType: asString(switchRow.request_type) ?? 'switch',
      requestedStartDate: asString(switchRow.requested_start_date),
      externalReference: asString(switchRow.external_reference),
      customerId,
      customerLabel: customerLabel(customer, customerId),
      customerIdentifier: customerIdentifier(customer),
      customerEmail: asString(customer?.email),
      customerPhone: asString(customer?.phone),
      siteId,
      siteLabel: siteLabel(site, siteId),
      facilityId: asString(site?.facility_id),
      siteAddress: siteAddress(site),
      annualConsumptionKwh: asNumber(site?.annual_consumption_kwh),
      meteringPointDbId,
      meteringPointId: asString(meteringPoint?.meter_point_id),
      meteringMethod: asString(meteringPoint?.measurement_type),
      portalMeteringMethod,
      portalReasonForTransaction,
      portalCustomerIdCodeListQualifier,
      readingFrequency: asString(meteringPoint?.reading_frequency),
      gridOwnerId,
      gridOwnerName: asString(gridOwner?.name),
      gridOwnerEdielId: asString(gridOwner?.ediel_id),
      communicationRouteId: asString(route?.id),
      communicationRouteName: asString(route?.route_name),
      communicationRouteType: asString(route?.route_type),
      powerOfAttorneyId: asString(poa?.id),
      powerOfAttorneyReference: asString(poa?.reference),
      powerOfAttorneyStatus: asString(poa?.status),
      canCreateZ03: canCreate,
      canCreateZ04: canCreate,
      readyForPortalOrProduction: canCreate,
      issues,
    }
  })
}
