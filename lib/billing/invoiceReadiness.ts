import { supabaseService } from '@/lib/supabase/service'
import { parseBillingMonth } from '@/lib/time/stockholm'
import { assertPlatformSchemaReady } from '@/lib/platform/schemaReadiness'
import {
  companyAllowsEstimatedMeteringValues,
  evaluateMeteringCompletenessForMonth,
} from '@/lib/metering/validation'
import {
  evaluateBillingReadinessCore,
  type BillingReadinessContract,
  type BillingReadinessCustomer,
} from '@/lib/billing/billingReadiness'

export type InvoiceReadinessStatus = 'ready' | 'blocked'
export type BillingPeriodLockStatus = 'open' | 'locked' | 'exported' | 'closed' | 'reopened'

export type InvoiceReadinessIssue = {
  code: string
  message: string
  severity: 'blocked' | 'warning'
}

type BillingPeriodLockRow = {
  id?: string
  company_id?: string | null
  billing_year?: number | null
  billing_month?: number | string | null
  status?: string | null
  locked_at?: string | null
  lock_reason?: string | null
  reason?: string | null
  metadata?: Record<string, unknown> | null
}

function isMissingRelationError(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null
  return Boolean(
    maybe &&
      (maybe.code === '42P01' ||
        maybe.code === '42703' ||
        maybe.code === '42883' ||
        maybe.code === 'PGRST202' ||
        maybe.code === 'PGRST204' ||
        maybe.code === 'PGRST205' ||
        /does not exist|schema cache|relation .* does not exist|column .* does not exist/i.test(maybe.message ?? ''))
  )
}

function normalizeBillingMonth(value: string): string {
  return parseBillingMonth(value.trim()).value
}

function monthParts(billingMonth: string): { billingMonth: string; year: number; month: number } {
  const normalized = normalizeBillingMonth(billingMonth)
  const [year, month] = normalized.split('-').map(Number)
  return { billingMonth: normalized, year, month }
}

function billingMonthBounds(value: string): { start: string; end: string } {
  const { billingMonth, year, month } = monthParts(value)
  const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
  return { start: `${billingMonth}-01`, end }
}

function isBlockingPeriodStatus(status: unknown): boolean {
  return ['locked', 'exported', 'closed'].includes(String(status ?? '').trim().toLowerCase())
}

async function getLegacyPricePeriodLock(input: { companyId: string; billingMonth: string; scope?: string | null }) {
  const lockScopes = input.scope ? [input.scope] : ['invoice_export', 'billing_period']
  const { data, error } = await supabaseService
    .from('price_period_locks')
    .select('id,billing_month,lock_scope,status,locked_at,reason')
    .eq('company_id', input.companyId)
    .eq('billing_month', input.billingMonth)
    .in('lock_scope', lockScopes)
    .eq('status', 'locked')
    .limit(1)

  if (error) {
    if (isMissingRelationError(error)) return null
    throw error
  }

  const row = (data ?? [])[0] as Record<string, unknown> | undefined
  return row ?? null
}

export async function getBillingPeriodLock(input: {
  companyId: string
  billingMonth: string
}): Promise<BillingPeriodLockRow | null> {
  const { billingMonth, year, month } = monthParts(input.billingMonth)

  const { data, error } = await supabaseService
    .from('billing_period_locks')
    .select('*')
    .eq('company_id', input.companyId)
    .eq('billing_year', year)
    .eq('billing_month', month)
    .limit(1)
    .maybeSingle()

  if (error) {
    if (!isMissingRelationError(error)) throw error
    const legacy = await getLegacyPricePeriodLock({ companyId: input.companyId, billingMonth })
    return legacy ? { ...legacy, billing_month: billingMonth, status: 'locked' } as BillingPeriodLockRow : null
  }

  return (data as BillingPeriodLockRow | null) ?? null
}

export async function assertBillingPeriodOpen(input: { companyId: string; billingMonth: string; scope?: string }) {
  const { billingMonth } = monthParts(input.billingMonth)
  const lock = await getBillingPeriodLock({ companyId: input.companyId, billingMonth })
  if (lock && isBlockingPeriodStatus(lock.status)) {
    throw new Error(`Fakturaperioden ${billingMonth} är ${lock.status}. Skapa kredit/omräkning eller lås upp perioden innan du ändrar underlag.`)
  }

  // Compatibility with older price_period_locks used by early pricing batches.
  const legacy = await getLegacyPricePeriodLock({ companyId: input.companyId, billingMonth, scope: input.scope })
  if (legacy) {
    throw new Error(`Fakturaperioden ${billingMonth} är låst för ${legacy.lock_scope ?? 'fakturering'}. Skapa kredit/omräkning i stället för att ändra perioden.`)
  }
}

export async function lockBillingPeriod(input: {
  companyId: string
  billingMonth: string
  status?: Exclude<BillingPeriodLockStatus, 'open' | 'reopened'>
  actorUserId?: string | null
  reason?: string | null
  metadata?: Record<string, unknown>
}) {
  const { billingMonth, year, month } = monthParts(input.billingMonth)
  const status = input.status ?? 'locked'
  const now = new Date().toISOString()

  const { data, error } = await supabaseService.from('billing_period_locks').upsert({
    company_id: input.companyId,
    billing_year: year,
    billing_month: month,
    status,
    locked_by: input.actorUserId ?? null,
    locked_at: now,
    unlocked_by: null,
    unlocked_at: null,
    lock_reason: input.reason ?? 'Fakturaperioden är låst.',
    metadata: input.metadata ?? {},
    updated_at: now,
  }, { onConflict: 'company_id,billing_year,billing_month' }).select('*').maybeSingle()

  if (error && !isMissingRelationError(error)) throw error

  await supabaseService.from('price_period_locks').upsert({
    company_id: input.companyId,
    billing_month: billingMonth,
    lock_scope: 'billing_period',
    status: 'locked',
    locked_by: input.actorUserId ?? null,
    locked_at: now,
    reason: input.reason ?? 'Fakturaperioden är låst.',
    metadata: input.metadata ?? {},
  }, { onConflict: 'company_id,billing_month,lock_scope' }).then(() => null)

  return data
}

export async function unlockBillingPeriod(input: {
  companyId: string
  billingMonth: string
  actorUserId?: string | null
  reason?: string | null
}) {
  const { billingMonth, year, month } = monthParts(input.billingMonth)
  const now = new Date().toISOString()

  const { data, error } = await supabaseService.from('billing_period_locks').upsert({
    company_id: input.companyId,
    billing_year: year,
    billing_month: month,
    status: 'reopened',
    unlocked_by: input.actorUserId ?? null,
    unlocked_at: now,
    lock_reason: input.reason ?? 'Fakturaperioden har låsts upp.',
    updated_at: now,
  }, { onConflict: 'company_id,billing_year,billing_month' }).select('*').maybeSingle()

  if (error && !isMissingRelationError(error)) throw error

  await supabaseService
    .from('price_period_locks')
    .update({ status: 'unlocked', unlocked_by: input.actorUserId ?? null, unlocked_at: now, updated_at: now })
    .eq('company_id', input.companyId)
    .eq('billing_month', billingMonth)
    .in('lock_scope', ['billing_period', 'invoice_export'])
    .then(() => null)

  // Locked pricing runs are DB-trigger protected; the only supported unlock path
  // is this audited RPC. Tolerate its absence until Migration B has been applied.
  const unlockRuns = await supabaseService.rpc('gridex_unlock_pricing_runs_for_month', {
    p_company_id: input.companyId,
    p_billing_month: billingMonth,
    p_actor_user_id: input.actorUserId ?? null,
    p_reason: input.reason ?? 'billing_period_unlocked',
  })
  if (unlockRuns.error && !isMissingRelationError(unlockRuns.error)) throw unlockRuns.error

  return data
}

export async function lockBillingPeriodForInvoiceExport(input: {
  companyId: string
  billingMonth: string
  actorUserId?: string | null
  exportRunId?: string | null
  reason?: string | null
}) {
  return lockBillingPeriod({
    companyId: input.companyId,
    billingMonth: input.billingMonth,
    status: 'exported',
    actorUserId: input.actorUserId,
    reason: input.reason ?? 'Fakturaperiod låst efter export till fakturapartner.',
    metadata: {
      export_run_id: input.exportRunId ?? null,
      locked_by_flow: 'invoice_export',
    },
  })
}

export async function evaluateBillingMonthInvoiceReadiness(input: {
  companyId: string
  billingMonth: string
}) {
  const { billingMonth, year, month } = monthParts(input.billingMonth)
  const issues: InvoiceReadinessIssue[] = []

  const periodLock = await getBillingPeriodLock({ companyId: input.companyId, billingMonth })
  if (periodLock && isBlockingPeriodStatus(periodLock.status)) {
    issues.push({ code: 'period_locked', message: `Fakturaperioden är ${periodLock.status}.`, severity: 'blocked' })
  }

  await assertPlatformSchemaReady()
  const underlays: Record<string, unknown>[] = []
  const pageSize = 1_000
  for (let from = 0; ; from += pageSize) {
    const underlayResult = await supabaseService
      .from('billing_underlays')
      .select('id,status,readiness_status,total_kwh,customer_id,contract_id,pricing_snapshot_id,calculated_total_sek_inc_vat,metering_point_id,missing_values_count,billing_period_start,billing_period_end')
      .eq('company_id', input.companyId)
      .eq('underlay_year', year)
      .eq('underlay_month', month)
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1)
    if (underlayResult.error) throw underlayResult.error
    const page = (underlayResult.data ?? []) as Record<string, unknown>[]
    underlays.push(...page)
    if (page.length < pageSize) break
  }

  if (underlays.length === 0) {
    issues.push({ code: 'no_underlays', message: 'Inga faktureringsunderlag finns för perioden.', severity: 'blocked' })
  }

  const blockedUnderlays = underlays.filter((row) => row.status !== 'validated' || row.readiness_status !== 'ready')
  if (blockedUnderlays.length > 0) {
    issues.push({ code: 'blocked_underlays', message: `${blockedUnderlays.length} faktureringsunderlag kräver granskning.`, severity: 'blocked' })
  }

  const missingPricing = underlays.filter((row) => row.calculated_total_sek_inc_vat === null || row.calculated_total_sek_inc_vat === undefined)
  if (missingPricing.length > 0) {
    issues.push({ code: 'missing_pricing', message: `${missingPricing.length} underlag saknar prisberäkning.`, severity: 'blocked' })
  }

  const missingSnapshot = underlays.filter((row) => !row.contract_id || !row.pricing_snapshot_id)
  if (missingSnapshot.length > 0) {
    issues.push({ code: 'missing_contract_or_snapshot', message: `${missingSnapshot.length} underlag saknar avtal eller prissnapshot.`, severity: 'blocked' })
  }

  const incompleteCoverage = underlays.filter((row) => Number(row.missing_values_count ?? 0) > 0)
  if (incompleteCoverage.length > 0) {
    issues.push({ code: 'incomplete_metering_coverage', message: `${incompleteCoverage.length} underlag har mätvärdesluckor.`, severity: 'blocked' })
  }

  // Full canonical gate. Every underlay is evaluated against contract, tenant,
  // customer, site, metering point, exact supply-period overlap, price snapshot,
  // price area, meter coverage, invoice account and external blockers.
  const contractIds = [...new Set(underlays.map((row) => (typeof row.contract_id === 'string' ? row.contract_id : '')).filter(Boolean))]
  const meteringPointIds = [...new Set(underlays.map((row) => (typeof row.metering_point_id === 'string' ? row.metering_point_id : '')).filter(Boolean))]
  const bounds = billingMonthBounds(billingMonth)

  const companyResult = await supabaseService
    .from('companies')
    .select('id,name,legal_name,org_number')
    .eq('id', input.companyId)
    .maybeSingle()
  if (companyResult.error) throw companyResult.error
  const company = companyResult.data as { name?: string | null; legal_name?: string | null; org_number?: string | null } | null

  const contractsById = new Map<string, BillingReadinessContract & { id: string; customer_id?: string | null; customer_site_id?: string | null; site_id?: string | null }>()
  if (contractIds.length > 0) {
    const contractResult = await supabaseService
      .from('customer_contracts')
      .select('id,company_id,customer_id,status,customer_site_id,site_id,contract_price_snapshot_id,pricing_snapshot_id,price_snapshot,invoice_recipient,invoice_email,billing_street,billing_postal_code,billing_city,billing_address_same_as_site,vat_rate,export_blocked,export_block_reason,billing_blocker_reasons')
      .eq('company_id', input.companyId)
      .in('id', contractIds)
    if (contractResult.error) throw contractResult.error
    for (const row of (contractResult.data ?? []) as Array<BillingReadinessContract & { id: string; customer_id?: string | null; customer_site_id?: string | null; site_id?: string | null }>) {
      contractsById.set(String(row.id), row)
    }
  }

  const customerIds = [...new Set([...contractsById.values()].map((row) => String(row.customer_id ?? '')).filter(Boolean))]
  const customersById = new Map<string, BillingReadinessCustomer>()
  if (customerIds.length > 0) {
    const customerResult = await supabaseService
      .from('customers')
      .select('id,company_id,customer_number,full_name,company_name,email,invoice_email,billing_street,billing_postal_code,billing_city')
      .eq('company_id', input.companyId)
      .in('id', customerIds)
    if (customerResult.error) throw customerResult.error
    for (const row of (customerResult.data ?? []) as BillingReadinessCustomer[]) customersById.set(String(row.id), row)
  }

  const siteIds = [...new Set([...contractsById.values()].map((row) => String(row.customer_site_id ?? row.site_id ?? '')).filter(Boolean))]
  const sitesById = new Map<string, Record<string, unknown>>()
  if (siteIds.length > 0) {
    const siteResult = await supabaseService
      .from('customer_sites')
      .select('id,company_id,customer_id,price_area_code')
      .eq('company_id', input.companyId)
      .in('id', siteIds)
    if (siteResult.error) throw siteResult.error
    for (const row of (siteResult.data ?? []) as Record<string, unknown>[]) sitesById.set(String(row.id), row)
  }

  const metersById = new Map<string, Record<string, unknown>>()
  if (meteringPointIds.length > 0) {
    const meterResult = await supabaseService
      .from('metering_points')
      .select('id,company_id,customer_id,site_id,customer_site_id,meter_point_id,metering_point_id,price_area_code,bidding_zone_code')
      .eq('company_id', input.companyId)
      .in('id', meteringPointIds)
    if (meterResult.error) throw meterResult.error
    for (const row of (meterResult.data ?? []) as Record<string, unknown>[]) metersById.set(String(row.id), row)
  }

  const supplyPeriodsByMeter = new Map<string, Record<string, unknown>[]>()
  if (meteringPointIds.length > 0) {
    const supplyResult = await supabaseService
      .from('customer_supply_periods')
      .select('id,company_id,customer_id,metering_point_id,contract_id,status,start_date,end_date,actual_start_date,actual_end_date')
      .eq('company_id', input.companyId)
      .in('metering_point_id', meteringPointIds)
      .lte('start_date', bounds.end)
      .or(`end_date.is.null,end_date.gte.${bounds.start}`)
    if (supplyResult.error) throw supplyResult.error
    for (const row of (supplyResult.data ?? []) as Record<string, unknown>[]) {
      const key = String(row.metering_point_id ?? '')
      if (!key) continue
      supplyPeriodsByMeter.set(key, [...(supplyPeriodsByMeter.get(key) ?? []), row])
    }
  }

  for (const underlay of underlays) {
    const underlayId = String(underlay.id ?? 'okänt')
    const contractId = typeof underlay.contract_id === 'string' ? underlay.contract_id : ''
    const meterId = typeof underlay.metering_point_id === 'string' ? underlay.metering_point_id : ''
    const contract = contractsById.get(contractId) ?? null
    const customerId = String(contract?.customer_id ?? underlay.customer_id ?? '')
    const customer = customerId ? customersById.get(customerId) ?? null : null
    const siteId = String(contract?.customer_site_id ?? contract?.site_id ?? '')
    const site = siteId ? sitesById.get(siteId) ?? null : null
    const meter = meterId ? metersById.get(meterId) ?? null : null
    const meterPointIdentity = String(meter?.meter_point_id ?? meter?.metering_point_id ?? '') || null
    const priceArea = String(meter?.price_area_code ?? meter?.bidding_zone_code ?? site?.price_area_code ?? '') || null
    const readiness = evaluateBillingReadinessCore({
      companyId: input.companyId,
      customerId,
      customer,
      contract,
      issuer: { legalName: company?.legal_name ?? company?.name ?? null, orgNumber: company?.org_number ?? null },
      site: site ? { id: String(site.id), company_id: String(site.company_id ?? ''), customer_id: String(site.customer_id ?? '') } : null,
      meteringPoint: meter ? {
        id: String(meter.id),
        company_id: String(meter.company_id ?? ''),
        customer_id: String(meter.customer_id ?? ''),
        site_id: String(meter.customer_site_id ?? meter.site_id ?? ''),
        meter_point_id: meterPointIdentity,
      } : null,
      supplyPeriods: (supplyPeriodsByMeter.get(meterId) ?? []) as Array<{ id?: string | null; status?: string | null; start_date?: string | null; end_date?: string | null; actual_start_date?: string | null; actual_end_date?: string | null }>,
      billingPeriod: {
        start: typeof underlay.billing_period_start === 'string' ? underlay.billing_period_start : bounds.start,
        end: typeof underlay.billing_period_end === 'string' ? underlay.billing_period_end : bounds.end,
      },
      priceArea,
      meterValues: {
        present: underlay.total_kwh !== null && underlay.total_kwh !== undefined,
        missingCount: Number(underlay.missing_values_count ?? 0),
        estimatedOnly: false,
        estimationAllowed: false,
      },
      paymentTerms: { dueDays: null, defaulted: true },
      paymentProvider: null,
      externalBlockers: null,
    })
    for (const blocker of readiness.blockers) {
      issues.push({ code: blocker.code, message: `${blocker.message} (underlag ${underlayId})`, severity: 'blocked' })
    }
    for (const warning of readiness.warnings) {
      issues.push({ code: warning.code, message: `${warning.message} (underlag ${underlayId})`, severity: 'warning' })
    }
  }

  // Metering completeness gate: final invoicing requires complete,
  // non-overlapping and (unless the tenant explicitly allows it) non-estimated
  // metering coverage for every billed metering point in the period.
  let meteringCompleteness: Awaited<ReturnType<typeof evaluateMeteringCompletenessForMonth>> | null = null
  const meteringPoints = underlays
    .map((row) => ({
      meteringPointId: typeof row.metering_point_id === 'string' ? row.metering_point_id : '',
      expectedKwh: typeof row.total_kwh === 'number' ? row.total_kwh : typeof row.total_kwh === 'string' ? Number(row.total_kwh) : null,
    }))
    .filter((entry) => entry.meteringPointId)
  if (meteringPoints.length > 0) {
    const allowEstimated = await companyAllowsEstimatedMeteringValues(input.companyId)
    meteringCompleteness = await evaluateMeteringCompletenessForMonth({
      companyId: input.companyId,
      billingMonth,
      meteringPoints,
      allowEstimatedValues: allowEstimated,
    })
    for (const issue of meteringCompleteness.issues) {
      issues.push({
        code: issue.code,
        message: issue.meteringPointId ? `${issue.message} (mätpunkt ${issue.meteringPointId})` : issue.message,
        severity: issue.severity,
      })
    }
  }

  const totalKwh = underlays.reduce((sum, row) => {
    const raw = row.total_kwh
    const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : 0
    return sum + (Number.isFinite(value) ? value : 0)
  }, 0)

  const status: InvoiceReadinessStatus = issues.some((issue) => issue.severity === 'blocked') ? 'blocked' : 'ready'

  if (underlays.length > 0) {
    const update = await supabaseService
      .from('billing_underlays')
      .update({
        invoice_readiness_status: status === 'ready' ? 'ready_for_invoice' : 'blocked',
        invoice_readiness_issues: issues,
        updated_at: new Date().toISOString(),
      })
      .eq('company_id', input.companyId)
      .eq('underlay_year', year)
      .eq('underlay_month', month)
      .select('id')
    if (update.error) throw update.error
    if ((update.data ?? []).length !== underlays.length) throw new Error('Fakturaunderlagets readiness kunde inte uppdateras fullständigt.')
  }

  return {
    billingMonth,
    status,
    underlayCount: underlays.length,
    readyUnderlayCount: underlays.length - blockedUnderlays.length,
    readyUnderlayIds: underlays.filter((row) => row.status === 'validated' && row.readiness_status === 'ready').map((row) => String(row.id)),
    pricedUnderlayCount: underlays.length - missingPricing.length,
    totalKwh,
    meteringCompleteness,
    issues,
  }
}
