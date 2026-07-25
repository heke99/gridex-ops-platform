// Central customer/contract-level billing readiness (faktureringsbarhet).
//
// This is the one place that answers "may this customer be invoiced for this
// delivery period?" as a structured, explainable decision. It composes the
// checks that already exist at other levels of the pipeline instead of
// replacing them:
//
//   * value level    – lib/billing/billingGate.ts (per normalized meter value)
//   * month level    – lib/billing/invoiceReadiness.ts (per billing month)
//   * export level   – billing_export_readiness_v (per underlay/export row)
//
// What was missing before this module: invoice recipient, invoice
// distribution (address/e-mail), VAT settings, payment terms and payment
// provider were never gated anywhere — they were silently snapshotted or
// defaulted at export time. The pure core below evaluates all fourteen
// billing-readiness criteria and is unit-testable without a database;
// evaluateBillingMonthInvoiceReadiness wires the account-level subset into the
// month gate so an invoice export can no longer be produced without a
// recipient or distribution channel.
//
// Billability is NEVER decided from a cached boolean column. Callers that
// persist a readiness flag must derive it from this function.

export type BillingBlocker = {
  code: string
  message: string
}

export type BillingWarning = {
  code: string
  message: string
}

export type BillingReadinessEvidence = Record<string, unknown>

export type BillingReadinessResult = {
  billable: boolean
  blockers: BillingBlocker[]
  warnings: BillingWarning[]
  evidence: BillingReadinessEvidence
}

/** Contract statuses that permit billing (aligned with lib/billing/billingGate.ts). */
export const BILLABLE_CONTRACT_STATUSES = new Set(['active'])

/** Supply-period statuses that count as active/confirmed delivery. */
export const BILLABLE_SUPPLY_PERIOD_STATUSES = new Set(['active', 'confirmed_by_grid_owner'])

const PRICE_AREAS = new Set(['SE1', 'SE2', 'SE3', 'SE4'])

function clean(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export type BillingReadinessContract = {
  id?: string | null
  company_id?: string | null
  customer_id?: string | null
  status?: string | null
  customer_site_id?: string | null
  site_id?: string | null
  contract_price_snapshot_id?: string | null
  pricing_snapshot_id?: string | null
  price_snapshot?: Record<string, unknown> | null
  vat_rate?: number | string | null
  invoice_recipient?: string | null
  invoice_email?: string | null
  invoice_reference?: string | null
  billing_street?: string | null
  billing_postal_code?: string | null
  billing_city?: string | null
  billing_address_same_as_site?: boolean | null
  export_blocked?: boolean | null
  export_block_reason?: string | null
  billing_blocker_reasons?: Array<Record<string, unknown>> | null
}

export type BillingReadinessCustomer = {
  id?: string | null
  company_id?: string | null
  customer_number?: string | null
  full_name?: string | null
  company_name?: string | null
  email?: string | null
  invoice_email?: string | null
  billing_street?: string | null
  billing_postal_code?: string | null
  billing_city?: string | null
}

export type BillingReadinessInput = {
  companyId: string
  customerId: string
  customer?: BillingReadinessCustomer | null
  contract: BillingReadinessContract | null
  /** The legal invoice issuer (tenant legal profile). */
  issuer?: { legalName?: string | null; orgNumber?: string | null } | null
  site?: { id?: string | null; company_id?: string | null; customer_id?: string | null } | null
  meteringPoint?: {
    id?: string | null
    company_id?: string | null
    customer_id?: string | null
    site_id?: string | null
    meter_point_id?: string | null
  } | null
  /** Supply periods covering the requested delivery period. */
  supplyPeriods?: Array<{
    id?: string | null
    status?: string | null
    start_date?: string | null
    end_date?: string | null
    actual_start_date?: string | null
    actual_end_date?: string | null
  }> | null
  billingPeriod?: { start: string; end: string } | null
  priceArea?: string | null
  meterValues?: {
    present: boolean
    estimatedOnly?: boolean
    estimationAllowed?: boolean
    missingCount?: number | null
  } | null
  /** Payment terms configuration; defaulted=true means a documented provider default applies. */
  paymentTerms?: { dueDays?: number | null; defaulted?: boolean } | null
  /** Active billing/invoicing provider connection (Capway/Fortnox/manual export). */
  paymentProvider?: {
    connectionId?: string | null
    provider?: string | null
    environment?: string | null
    status?: string | null
  } | null
  /**
   * Normalized tenant/provider billing profile. When supplied, every field is
   * a canonical readiness requirement; undefined keeps legacy pure-core
   * callers compatible while the database-backed month gate always supplies it.
   */
  billingProfile?: {
    profileId?: string | null
    status?: string | null
    distributionMethod?: string | null
    ocrPolicy?: string | null
    paymentReferencePolicy?: string | null
    siteAddress?: {
      street?: string | null
      postalCode?: string | null
      city?: string | null
    } | null
  }
  /** Externally supplied blockers (e.g. customer_operation_tasks of blocking type). */
  externalBlockers?: BillingBlocker[] | null
}

/**
 * Account-level readiness shared by the pure core and the month invoice gate:
 * recipient, distribution channel, VAT and payment terms. Pure and synchronous.
 */
export function evaluateContractBillingAccountReadiness(input: {
  contract: BillingReadinessContract | null
  customer?: BillingReadinessCustomer | null
  paymentTerms?: { dueDays?: number | null; defaulted?: boolean } | null
  billingProfile?: BillingReadinessInput['billingProfile']
}): { blockers: BillingBlocker[]; warnings: BillingWarning[]; evidence: BillingReadinessEvidence } {
  const blockers: BillingBlocker[] = []
  const warnings: BillingWarning[] = []
  const contract = input.contract
  const customer = input.customer ?? null

  const recipient =
    clean(contract?.invoice_recipient) ??
    clean(customer?.full_name) ??
    clean(customer?.company_name)
  if (!recipient) {
    blockers.push({
      code: 'invoice_recipient_missing',
      message: 'Fakturamottagare saknas på avtalet och kunden.',
    })
  }

  const invoiceEmail = clean(contract?.invoice_email) ?? clean(customer?.invoice_email) ?? clean(customer?.email)
  const billingStreet = clean(contract?.billing_street) ?? clean(customer?.billing_street)
  const billingPostalCode = clean(contract?.billing_postal_code) ?? clean(customer?.billing_postal_code)
  const billingCity = clean(contract?.billing_city) ?? clean(customer?.billing_city)
  const hasPostalAddress = Boolean(billingStreet && billingPostalCode && billingCity)
  const sameAsSite = contract?.billing_address_same_as_site === true
  const siteAddress = input.billingProfile?.siteAddress
  const siteAddressComplete = siteAddress === undefined
    ? sameAsSite
    : Boolean(clean(siteAddress?.street) && clean(siteAddress?.postalCode) && clean(siteAddress?.city))
  const hasResolvedPostalAddress = hasPostalAddress || (sameAsSite && siteAddressComplete)
  const hasDistribution = Boolean(invoiceEmail || hasResolvedPostalAddress)
  if (!hasDistribution) {
    blockers.push({
      code: 'invoice_distribution_missing',
      message: 'Varken fakturaadress, faktura-e-post eller "samma som anläggningsadress" finns.',
    })
  }

  const snapshot = (contract?.price_snapshot ?? null) as Record<string, unknown> | null
  const vatRate =
    numberOrNull(contract?.vat_rate) ??
    numberOrNull(snapshot?.vat_rate) ??
    numberOrNull(snapshot?.vatRate)
  if (vatRate === null) {
    blockers.push({
      code: 'vat_settings_missing',
      message: 'Momssats saknas på avtalet och i prissnapshotet.',
    })
  }

  const dueDays = numberOrNull(input.paymentTerms?.dueDays)
  if (dueDays === null) {
    if (input.paymentTerms?.defaulted) {
      warnings.push({
        code: 'payment_terms_defaulted',
        message: 'Betalningsvillkor är inte konfigurerade – fakturapartnerns standardvillkor används.',
      })
    } else {
      blockers.push({
        code: 'payment_terms_missing',
        message: 'Betalningsvillkor saknas och ingen dokumenterad standard är aktiv.',
      })
    }
  }

  const profile = input.billingProfile
  const profileId = clean(profile?.profileId)
  const profileStatus = clean(profile?.status)?.toLowerCase() ?? null
  const distributionMethod = clean(profile?.distributionMethod)?.toLowerCase() ?? null
  const ocrPolicy = clean(profile?.ocrPolicy)
  const paymentReferencePolicy = clean(profile?.paymentReferencePolicy)
  if (profile !== undefined) {
    if (!profileId) {
      blockers.push({
        code: 'invoice_profile_missing',
        message: 'Tenantens fakturaprofil saknar ett stabilt profil-ID.',
      })
    }
    if (profileStatus && !['ready', 'active'].includes(profileStatus)) {
      blockers.push({
        code: 'invoice_profile_not_ready',
        message: `Tenantens fakturaprofil har status "${profileStatus}".`,
      })
    }
    if (!distributionMethod) {
      blockers.push({
        code: 'invoice_distribution_method_missing',
        message: 'Fakturaprofilen saknar distributionsmetod.',
      })
    } else if (['email', 'e-mail'].includes(distributionMethod) && !invoiceEmail) {
      blockers.push({
        code: 'invoice_distribution_missing',
        message: 'Fakturaprofilen kräver e-post men faktura-e-post saknas.',
      })
    } else if (['postal', 'post', 'letter'].includes(distributionMethod) && !hasResolvedPostalAddress) {
      blockers.push({
        code: 'invoice_distribution_missing',
        message: 'Fakturaprofilen kräver postadress men en komplett fakturaadress saknas.',
      })
    } else if (
      ['einvoice', 'e_invoice', 'e-faktura'].includes(distributionMethod) &&
      !clean(contract?.invoice_reference)
    ) {
      blockers.push({
        code: 'invoice_reference_missing',
        message: 'Fakturaprofilen kräver e-fakturareferens men avtalet saknar fakturareferens.',
      })
    }
    if (!ocrPolicy) {
      blockers.push({
        code: 'ocr_policy_missing',
        message: 'Fakturaprofilen saknar OCR-policy.',
      })
    }
    if (!paymentReferencePolicy) {
      blockers.push({
        code: 'payment_reference_policy_missing',
        message: 'Fakturaprofilen saknar betalningsreferenspolicy.',
      })
    }
  }

  return {
    blockers,
    warnings,
    evidence: {
      invoice_recipient: recipient,
      invoice_email: invoiceEmail,
      has_postal_invoice_address: hasResolvedPostalAddress,
      billing_address_same_as_site: sameAsSite,
      vat_rate: vatRate,
      payment_terms_due_days: dueDays,
      payment_terms_defaulted: Boolean(input.paymentTerms?.defaulted),
      invoice_profile_id: profileId,
      invoice_profile_status: profileStatus,
      invoice_distribution_method: distributionMethod,
      ocr_policy: ocrPolicy,
      payment_reference_policy: paymentReferencePolicy,
    },
  }
}

function isoDate(value: unknown): string | null {
  const normalized = clean(value)
  return normalized && /^\d{4}-\d{2}-\d{2}/.test(normalized) ? normalized.slice(0, 10) : null
}

function periodsOverlap(input: {
  billingStart: string
  billingEnd: string
  supplyStart: string
  supplyEnd?: string | null
}): boolean {
  return input.supplyStart <= input.billingEnd && (!input.supplyEnd || input.supplyEnd >= input.billingStart)
}

/**
 * The canonical fourteen-point billing readiness decision. Pure: all data is
 * passed in, so the same rules run in unit tests, the month gate and any
 * future customer-card projection without divergence.
 *
 *  1. Contract is approved (signed/active).
 *  2. Tenant matches and a legal invoice issuer exists.
 *  3. Delivery period is active or confirmed (supply period model).
 *  4. Contract is linked to the right site.
 *  5. Metering point is correctly linked (tenant/customer/site + identity).
 *  6. Price snapshot exists.
 *  7. Price area is known (SE1–SE4).
 *  8. Meter values exist, or estimation is explicitly allowed.
 *  9. Invoice recipient exists.
 * 10. Invoice address or distribution channel exists.
 * 11. VAT settings exist.
 * 12. Payment terms exist (documented provider default allowed, as warning).
 * 13. Payment provider/connection exists (warning when manual export).
 * 14. No external billing blockers.
 */
export function evaluateBillingReadinessCore(input: BillingReadinessInput): BillingReadinessResult {
  const blockers: BillingBlocker[] = []
  const warnings: BillingWarning[] = []
  const contract = input.contract

  // 1 + 2: contract, tenant and issuer -----------------------------------
  if (!contract) {
    blockers.push({ code: 'contract_missing', message: 'Inget avtal är kopplat till kunden.' })
  } else {
    const status = clean(contract.status)?.toLowerCase() ?? ''
    if (status === 'signed') {
      blockers.push({
        code: 'delivery_not_started',
        message: 'Avtalet är signerat men ännu inte aktiverat för leverans och fakturering.',
      })
    } else if (!BILLABLE_CONTRACT_STATUSES.has(status)) {
      blockers.push({
        code: 'contract_not_approved',
        message: `Avtalet har status "${status || 'okänd'}" och är inte aktivt för fakturering.`,
      })
    }
    if (clean(contract.company_id) && contract.company_id !== input.companyId) {
      blockers.push({ code: 'tenant_mismatch', message: 'Avtalet tillhör en annan tenant.' })
    }
    if (clean(contract.customer_id) && contract.customer_id !== input.customerId) {
      blockers.push({ code: 'tenant_mismatch', message: 'Avtalet tillhör en annan kund.' })
    }
  }

  const issuerName = clean(input.issuer?.legalName)
  const issuerOrg = clean(input.issuer?.orgNumber)
  if (!issuerName || !issuerOrg) {
    blockers.push({
      code: 'invoice_issuer_missing',
      message: 'Tenantens juridiska fakturautställare (bolagsnamn + organisationsnummer) är inte komplett.',
    })
  }

  // 3: delivery -----------------------------------------------------------
  const billingStart = isoDate(input.billingPeriod?.start)
  const billingEnd = isoDate(input.billingPeriod?.end)
  if (!billingStart || !billingEnd || billingStart > billingEnd) {
    blockers.push({
      code: 'billing_period_invalid',
      message: 'Faktureringsperiodens start och slut måste vara giltiga datum.',
    })
  }
  const activeSupplyPeriods = (input.supplyPeriods ?? []).filter((period) => {
    if (!BILLABLE_SUPPLY_PERIOD_STATUSES.has(clean(period.status)?.toLowerCase() ?? '')) return false
    const supplyStart = isoDate(period.actual_start_date) ?? isoDate(period.start_date)
    const supplyEnd = isoDate(period.actual_end_date) ?? isoDate(period.end_date)
    return Boolean(
      billingStart &&
      billingEnd &&
      supplyStart &&
      periodsOverlap({ billingStart, billingEnd, supplyStart, supplyEnd }),
    )
  })
  if (activeSupplyPeriods.length === 0) {
    blockers.push({
      code: 'delivery_not_started',
      message: 'Ingen aktiv eller nätägarbekräftad leveransperiod överlappar faktureringsperioden.',
    })
  }

  // 4: contract ↔ site ----------------------------------------------------
  const siteId = clean(input.site?.id)
  if (contract && siteId) {
    const contractSiteId = clean(contract.customer_site_id) ?? clean(contract.site_id)
    if (contractSiteId && contractSiteId !== siteId) {
      blockers.push({
        code: 'contract_site_mismatch',
        message: 'Avtalet är kopplat till en annan anläggning än den som faktureras.',
      })
    }
  }
  if (input.site && clean(input.site.company_id) && input.site.company_id !== input.companyId) {
    blockers.push({ code: 'tenant_mismatch', message: 'Anläggningen tillhör en annan tenant.' })
  }

  // 5: metering point ------------------------------------------------------
  const meteringPoint = input.meteringPoint ?? null
  if (!meteringPoint || !clean(meteringPoint.id)) {
    blockers.push({ code: 'metering_point_required', message: 'Mätpunkt saknas för fakturering.' })
  } else {
    if (clean(meteringPoint.company_id) && meteringPoint.company_id !== input.companyId) {
      blockers.push({ code: 'tenant_mismatch', message: 'Mätpunkten tillhör en annan tenant.' })
    }
    if (clean(meteringPoint.customer_id) && meteringPoint.customer_id !== input.customerId) {
      blockers.push({ code: 'tenant_mismatch', message: 'Mätpunkten tillhör en annan kund.' })
    }
    if (siteId && clean(meteringPoint.site_id) && meteringPoint.site_id !== siteId) {
      blockers.push({
        code: 'metering_point_site_mismatch',
        message: 'Mätpunkten är kopplad till en annan anläggning.',
      })
    }
    if (!clean(meteringPoint.meter_point_id)) {
      blockers.push({ code: 'metering_point_required', message: 'Mätpunkten saknar mätpunkts-ID.' })
    }
  }

  // 6: price snapshot -------------------------------------------------------
  const hasSnapshot = Boolean(
    clean(contract?.contract_price_snapshot_id) ??
      clean(contract?.pricing_snapshot_id) ??
      (contract?.price_snapshot && Object.keys(contract.price_snapshot).length > 0 ? 'snapshot' : null),
  )
  if (contract && !hasSnapshot) {
    blockers.push({ code: 'price_snapshot_missing', message: 'Avtalet saknar ett låst prissnapshot.' })
  }

  // 7: price area -----------------------------------------------------------
  const priceArea = clean(input.priceArea)?.toUpperCase() ?? null
  if (!priceArea || !PRICE_AREAS.has(priceArea)) {
    blockers.push({ code: 'price_area_missing', message: 'Elområde (SE1–SE4) är inte känt.' })
  }

  // 8: meter values -----------------------------------------------------------
  const meterValues = input.meterValues ?? null
  if (!meterValues?.present) {
    blockers.push({ code: 'meter_values_missing', message: 'Mätvärden saknas för perioden.' })
  } else {
    if ((meterValues.missingCount ?? 0) > 0) {
      blockers.push({
        code: 'meter_values_missing',
        message: `Mätvärdesserien har ${meterValues.missingCount} luckor.`,
      })
    }
    if (meterValues.estimatedOnly && !meterValues.estimationAllowed) {
      blockers.push({
        code: 'estimated_values_not_allowed',
        message: 'Endast estimerade mätvärden finns och tenanten tillåter inte estimering.',
      })
    }
  }

  // 9–12: account-level ---------------------------------------------------------
  const account = evaluateContractBillingAccountReadiness({
    contract,
    customer: input.customer ?? null,
    paymentTerms: input.paymentTerms ?? null,
    billingProfile: input.billingProfile,
  })
  blockers.push(...account.blockers)
  warnings.push(...account.warnings)

  // 13: payment provider ---------------------------------------------------------
  const providerStatus = clean(input.paymentProvider?.status)?.toLowerCase() ?? null
  if (!input.paymentProvider || !clean(input.paymentProvider.provider)) {
    if (input.billingProfile !== undefined) {
      blockers.push({
        code: 'payment_provider_connection_missing',
        message: 'Ingen fakturapartner/betalkanal är konfigurerad för tenantens fakturaprofil.',
      })
    } else {
      warnings.push({
        code: 'payment_provider_connection_missing',
        message: 'Ingen fakturapartner/betalkanal är konfigurerad – manuell export krävs.',
      })
    }
  } else if (providerStatus && !['ready', 'active'].includes(providerStatus)) {
    blockers.push({
      code: 'billing_account_incomplete',
      message: `Fakturapartner-anslutningen har status "${providerStatus}".`,
    })
  }

  // 14: external blockers -----------------------------------------------------------
  if (contract?.export_blocked === true) {
    blockers.push({
      code: 'billing_blocked',
      message: clean(contract.export_block_reason) ?? 'Avtalet är exportblockerat.',
    })
  }
  for (const reason of contract?.billing_blocker_reasons ?? []) {
    const code = clean(reason.code) ?? 'billing_blocked'
    const message = clean(reason.message) ?? 'Avtalet har en faktureringsblockerare.'
    blockers.push({ code, message })
  }
  for (const blocker of input.externalBlockers ?? []) {
    blockers.push(blocker)
  }

  // Deduplicate identical code+message entries (idempotent composition).
  const seen = new Set<string>()
  const uniqueBlockers = blockers.filter((blocker) => {
    const key = `${blocker.code}:${blocker.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return {
    billable: uniqueBlockers.length === 0,
    blockers: uniqueBlockers,
    warnings,
    evidence: {
      version: 'billing_readiness_core_v2',
      data_sources: ['customer_contracts','customers','customer_sites','metering_points','customer_supply_periods','billing_underlays','contract_price_snapshots'],
      evaluated_at: new Date().toISOString(),
      company_id: input.companyId,
      customer_id: input.customerId,
      contract_id: clean(contract?.id),
      billing_period_start: billingStart,
      billing_period_end: billingEnd,
      overlapping_supply_period_ids: activeSupplyPeriods.map((period) => clean(period.id)).filter(Boolean),
      contract_status: clean(contract?.status),
      issuer_legal_name: issuerName,
      issuer_org_number: issuerOrg,
      active_supply_period_ids: activeSupplyPeriods.map((period) => clean(period.id)).filter(Boolean),
      price_area: priceArea,
      metering_point_id: clean(meteringPoint?.id),
      price_snapshot_present: hasSnapshot,
      meter_values: meterValues,
      ...account.evidence,
      payment_provider: clean(input.paymentProvider?.provider),
      payment_provider_connection_id: clean(input.paymentProvider?.connectionId),
      payment_provider_environment: clean(input.paymentProvider?.environment),
      payment_provider_status: providerStatus,
    },
  }
}
