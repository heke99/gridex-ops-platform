import { publicReference } from '@/lib/integrations/publicReferences'

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {}
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberOrNull(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function scalar(
  source: JsonRecord,
  keys: string[],
): Record<string, unknown> {
  return Object.fromEntries(
    keys
      .filter((key) => Object.prototype.hasOwnProperty.call(source, key))
      .map((key) => [key, source[key] ?? null]),
  )
}

export function publicPortalCustomer(
  customer: unknown,
  identity: {
    external_customer_id?: string | null
    customer_number?: string | null
    email?: string | null
  },
): JsonRecord {
  const row = record(customer)
  return {
    customer_reference:
      text(identity.external_customer_id) ??
      text(identity.customer_number),
    customer_number:
      text(identity.customer_number) ?? text(row.customer_number),
    external_customer_id: text(identity.external_customer_id),
    customer_type: text(row.customer_type),
    status: text(row.status),
    display_name:
      text(row.full_name) ??
      text(row.company_name) ??
      text(row.name),
    first_name: text(row.first_name),
    last_name: text(row.last_name),
    company_name: text(row.company_name),
    email: text(identity.email) ?? text(row.email),
    phone: text(row.phone),
    created_at: text(row.created_at),
  }
}

export function publicPortalContract(
  companyId: string,
  value: unknown,
): JsonRecord {
  const row = record(value)
  return {
    contract_reference:
      text(row.customer_contract_reference) ??
      publicReference('contract', companyId, row.id),
    contract_number: text(row.contract_number),
    offer_reference: text(row.offer_reference),
    contract_name: text(row.contract_name),
    contract_type: text(row.contract_type),
    energy_direction: text(row.energy_direction) ?? 'consumption',
    status: text(row.status),
    start_date:
      text(row.actual_start_date) ??
      text(row.confirmed_start_date) ??
      text(row.starts_at) ??
      text(row.requested_start_date),
    end_date: text(row.ends_at),
    signed_at: text(row.signed_at),
    withdrawal_deadline_at: text(row.withdrawal_deadline_at),
    signature_snapshot_sha256: text(row.signature_snapshot_sha256),
    price_area: text(row.price_area_used),
    monthly_fee_sek: numberOrNull(row.monthly_fee_sek),
    invoice_fee_sek: numberOrNull(row.invoice_fee_sek),
    fixed_price_ore_per_kwh: numberOrNull(row.fixed_price_ore_per_kwh),
    markup_ore_per_kwh:
      numberOrNull(row.markup_ore_per_kwh) ??
      numberOrNull(row.spot_markup_ore_per_kwh) ??
      numberOrNull(row.variable_fee_ore_per_kwh),
    binding_months: numberOrNull(row.binding_months),
    notice_months: numberOrNull(row.notice_months),
    auto_renew_enabled: row.auto_renew_enabled === true,
    created_at: text(row.created_at),
  }
}

export function publicPortalSite(
  companyId: string,
  value: unknown,
): JsonRecord {
  const row = record(value)
  return {
    facility_reference:
      text(row.facility_reference) ??
      publicReference('facility', companyId, row.id),
    facility_id: text(row.facility_id),
    status: text(row.status),
    name: text(row.site_name),
    facility_type: text(row.site_type),
    address: {
      street: text(row.street),
      care_of: text(row.care_of),
      postal_code: text(row.postal_code),
      city: text(row.city),
      country: text(row.country) ?? 'SE',
    },
    price_area: text(row.price_area_code),
    grid_area_code: text(row.grid_area_code),
    move_in_date: text(row.move_in_date),
    move_out_date: text(row.move_out_date),
    annual_consumption_kwh: numberOrNull(row.annual_consumption_kwh),
    created_at: text(row.created_at),
  }
}

export function publicPortalMeteringPoint(
  companyId: string,
  value: unknown,
): JsonRecord {
  const row = record(value)
  return {
    metering_point_reference: publicReference(
      'metering_point',
      companyId,
      row.id,
    ),
    facility_reference: publicReference(
      'facility',
      companyId,
      row.customer_site_id ?? row.site_id,
    ),
    metering_point_id:
      text(row.metering_point_id) ??
      text(row.meter_point_id) ??
      text(row.ediel_metering_point_id),
    facility_id: text(row.site_facility_id),
    status: text(row.status),
    metering_type:
      text(row.metering_type) ?? text(row.measurement_type),
    resolution: text(row.reading_frequency),
    price_area: text(row.price_area_code),
    grid_area_code: text(row.grid_area_code),
    start_date: text(row.start_date),
    end_date: text(row.end_date),
    verification_status: text(row.verification_status),
    created_at: text(row.created_at),
  }
}

export function publicPortalInvoice(
  companyId: string,
  value: unknown,
): JsonRecord {
  const row = record(value)
  return {
    invoice_reference:
      text(row.partner_invoice_reference) ??
      text(row.invoice_number) ??
      publicReference('invoice', companyId, row.id),
    invoice_number: text(row.invoice_number),
    period_start: text(row.period_start),
    period_end: text(row.period_end),
    total_kwh: numberOrNull(row.total_kwh),
    amount_ex_vat: numberOrNull(row.amount_ex_vat),
    vat_amount: numberOrNull(row.vat_amount),
    amount_inc_vat: numberOrNull(row.amount_inc_vat),
    currency: text(row.currency) ?? 'SEK',
    issued_at: text(row.issued_at),
    due_date: text(row.due_date),
    paid_at: text(row.paid_at),
    status: text(row.status),
    created_at: text(row.created_at),
  }
}

export function publicPortalDocument(
  companyId: string,
  value: unknown,
): JsonRecord {
  const row = record(value)
  return {
    document_reference: publicReference('document', companyId, row.id),
    document_type: text(row.document_type),
    title: text(row.title),
    file_name: text(row.file_name),
    mime_type: text(row.mime_type),
    file_size_bytes: numberOrNull(row.file_size_bytes),
    status: text(row.status),
    secure_url: text(row.public_url),
    version: text(row.document_version),
    created_at: text(row.created_at) ?? text(row.uploaded_at),
  }
}

export function publicPortalLegalAcceptance(
  companyId: string,
  value: unknown,
): JsonRecord {
  const row = record(value)
  return {
    acceptance_reference: publicReference('acceptance', companyId, row.id),
    acceptance_type: text(row.acceptance_type),
    document_reference: publicReference(
      'legal_document',
      companyId,
      row.legal_bundle_version_document_id ?? row.legal_text_version_id,
    ),
    document_code: text(row.legal_module_key),
    document_version: text(row.legal_document_version),
    document_hash: text(row.legal_document_sha256),
    accepted_at: text(row.accepted_at),
    source: text(row.source),
    created_at: text(row.created_at),
  }
}

export function publicPortalPowerOfAttorney(
  companyId: string,
  value: unknown,
): JsonRecord {
  const row = record(value)
  return {
    power_of_attorney_reference:
      text(row.reference) ??
      publicReference('power_of_attorney', companyId, row.id),
    contract_reference: publicReference(
      'contract',
      companyId,
      row.contract_id,
    ),
    facility_reference: publicReference(
      'facility',
      companyId,
      row.customer_site_id ?? row.site_id,
    ),
    scope: text(row.scope),
    status: text(row.status),
    signed_at: text(row.signed_at),
    accepted_at: text(row.accepted_at),
    valid_from: text(row.valid_from),
    valid_to: text(row.valid_to) ?? text(row.valid_until),
    created_at: text(row.created_at),
  }
}

export function publicPortalEvent(
  companyId: string,
  value: unknown,
): JsonRecord {
  const row = record(value)
  return {
    event_reference: publicReference('event', companyId, row.id),
    event_type: text(row.event_type),
    event_version: numberOrNull(row.event_version) ?? 1,
    occurred_at: text(row.occurred_at) ?? text(row.created_at),
    source: text(row.source),
  }
}

export function publicPortalNotification(
  companyId: string,
  value: unknown,
): JsonRecord {
  const row = record(value)
  return {
    notification_reference: publicReference('notification', companyId, row.id),
    ...scalar(row, [
      'type',
      'title',
      'message',
      'severity',
      'status',
      'read_at',
      'created_at',
    ]),
  }
}

export function publicPortalMeteringValue(
  companyId: string,
  value: unknown,
): JsonRecord {
  const row = record(value)
  return {
    metering_value_reference: publicReference(
      'metering_value',
      companyId,
      row.id,
    ),
    metering_point_reference: publicReference(
      'metering_point',
      companyId,
      row.metering_point_id,
    ),
    period_start: text(row.period_start),
    period_end: text(row.period_end),
    resolution: text(row.resolution),
    quantity_kwh: numberOrNull(row.quantity_kwh),
    quality_status: text(row.quality_status),
    status: text(row.status),
    created_at: text(row.created_at),
  }
}

export function publicPortalApplication(
  companyId: string,
  value: unknown,
): JsonRecord {
  const row = record(value)
  return {
    application_reference: publicReference('application', companyId, row.id),
    contract_reference: publicReference('contract', companyId, row.contract_id),
    facility_reference: publicReference(
      'facility',
      companyId,
      row.customer_site_id,
    ),
    status: text(row.status),
    grid_area_code: text(row.grid_area_code),
    price_area: text(row.price_area_code),
    resolution_status: text(row.resolution_status),
    created_at: text(row.created_at),
    updated_at: text(row.updated_at),
  }
}

export type PublicPortalBundleRows = {
  contracts: JsonRecord[]
  sites: JsonRecord[]
  meteringPoints: JsonRecord[]
  invoices: JsonRecord[]
  meteringValues: JsonRecord[]
  documents: JsonRecord[]
  legalAcceptances: JsonRecord[]
  powersOfAttorney: JsonRecord[]
  notifications: JsonRecord[]
  events: JsonRecord[]
  applications: JsonRecord[]
}

export function publicPortalBundleRows(
  companyId: string,
  input: {
    contracts: unknown[]
    sites: unknown[]
    meteringPoints: unknown[]
    invoices: unknown[]
    meteringValues: unknown[]
    documents: unknown[]
    legalAcceptances: unknown[]
    powersOfAttorney: unknown[]
    notifications: unknown[]
    events: unknown[]
    applications: unknown[]
  },
): PublicPortalBundleRows {
  return {
    contracts: input.contracts.map((row) => publicPortalContract(companyId, row)),
    sites: input.sites.map((row) => publicPortalSite(companyId, row)),
    meteringPoints: input.meteringPoints.map((row) =>
      publicPortalMeteringPoint(companyId, row),
    ),
    invoices: input.invoices.map((row) => publicPortalInvoice(companyId, row)),
    meteringValues: input.meteringValues.map((row) =>
      publicPortalMeteringValue(companyId, row),
    ),
    documents: input.documents.map((row) => publicPortalDocument(companyId, row)),
    legalAcceptances: input.legalAcceptances.map((row) =>
      publicPortalLegalAcceptance(companyId, row),
    ),
    powersOfAttorney: input.powersOfAttorney.map((row) =>
      publicPortalPowerOfAttorney(companyId, row),
    ),
    notifications: input.notifications.map((row) =>
      publicPortalNotification(companyId, row),
    ),
    events: input.events.map((row) => publicPortalEvent(companyId, row)),
    applications: input.applications.map((row) =>
      publicPortalApplication(companyId, row),
    ),
  }
}

export type PublicPage<T> = {
  items: T[]
  page: {
    limit: number
    offset: number
    returned: number
    has_more: boolean
    next_cursor: string | null
  }
}

export function publicPageInput(searchParams: URLSearchParams): {
  limit: number | null
  cursor: string | null
} {
  const rawLimit = searchParams.get('limit')
  const parsed = rawLimit === null ? null : Number(rawLimit)
  return {
    limit:
      parsed !== null && Number.isInteger(parsed) && parsed > 0
        ? parsed
        : null,
    cursor: text(searchParams.get('cursor')),
  }
}

export function pagePublicItems<T>(
  items: T[],
  input: { limit?: number | null; cursor?: string | null },
): PublicPage<T> {
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 50), 1), 100)
  let offset = 0
  if (input.cursor) {
    try {
      const decoded = Buffer.from(input.cursor, 'base64url').toString('utf8')
      const parsed = Number(decoded)
      if (Number.isInteger(parsed) && parsed >= 0) offset = parsed
    } catch {
      offset = 0
    }
  }
  const pageItems = items.slice(offset, offset + limit)
  const nextOffset = offset + pageItems.length
  const hasMore = nextOffset < items.length
  return {
    items: pageItems,
    page: {
      limit,
      offset,
      returned: pageItems.length,
      has_more: hasMore,
      next_cursor: hasMore
        ? Buffer.from(String(nextOffset), 'utf8').toString('base64url')
        : null,
    },
  }
}
