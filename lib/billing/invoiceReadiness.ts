import { supabaseService } from '@/lib/supabase/service'

export type InvoiceReadinessStatus = 'ready' | 'blocked'

export type InvoiceReadinessIssue = {
  code: string
  message: string
  severity: 'blocked' | 'warning'
}

function isMissingRelationError(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null
  return Boolean(
    maybe &&
      (maybe.code === '42P01' ||
        maybe.code === '42703' ||
        maybe.code === 'PGRST205' ||
        /does not exist|schema cache|relation .* does not exist/i.test(maybe.message ?? ''))
  )
}

function normalizeBillingMonth(value: string): string {
  const trimmed = value.trim()
  if (!/^\d{4}-\d{2}$/.test(trimmed)) throw new Error('Fakturamånad måste anges som YYYY-MM.')
  return trimmed
}

export async function assertBillingPeriodOpen(input: { companyId: string; billingMonth: string; scope?: string }) {
  const billingMonth = normalizeBillingMonth(input.billingMonth)
  const lockScopes = input.scope ? [input.scope] : ['invoice_export', 'billing_period']
  const { data, error } = await supabaseService
    .from('price_period_locks')
    .select('id,billing_month,lock_scope,status,locked_at,reason')
    .eq('company_id', input.companyId)
    .eq('billing_month', billingMonth)
    .in('lock_scope', lockScopes)
    .eq('status', 'locked')
    .limit(1)

  if (error) {
    if (isMissingRelationError(error)) return
    throw error
  }

  const lock = (data ?? [])[0] as Record<string, unknown> | undefined
  if (lock) {
    throw new Error(`Fakturaperioden ${billingMonth} är låst för ${lock.lock_scope ?? 'fakturering'}. Skapa kredit/omräkning i stället för att ändra perioden.`)
  }
}

export async function lockBillingPeriodForInvoiceExport(input: {
  companyId: string
  billingMonth: string
  actorUserId?: string | null
  exportRunId?: string | null
  reason?: string | null
}) {
  const billingMonth = normalizeBillingMonth(input.billingMonth)
  const { error } = await supabaseService.from('price_period_locks').upsert({
    company_id: input.companyId,
    billing_month: billingMonth,
    lock_scope: 'invoice_export',
    status: 'locked',
    locked_by: input.actorUserId ?? null,
    locked_at: new Date().toISOString(),
    reason: input.reason ?? 'Fakturaperiod låst efter export till fakturapartner.',
    metadata: {
      export_run_id: input.exportRunId ?? null,
      locked_by_flow: 'invoice_export',
    },
  }, { onConflict: 'company_id,billing_month,lock_scope' })
  if (error) throw error
}

export async function evaluateBillingMonthInvoiceReadiness(input: {
  companyId: string
  billingMonth: string
}) {
  const billingMonth = normalizeBillingMonth(input.billingMonth)
  const [year, month] = billingMonth.split('-').map(Number)
  const issues: InvoiceReadinessIssue[] = []

  const periodLock = await supabaseService
    .from('price_period_locks')
    .select('id,lock_scope,status')
    .eq('company_id', input.companyId)
    .eq('billing_month', billingMonth)
    .eq('status', 'locked')
    .in('lock_scope', ['invoice_export', 'billing_period'])
    .limit(1)

  if (periodLock.error && !isMissingRelationError(periodLock.error)) throw periodLock.error
  if ((periodLock.data ?? []).length > 0) {
    issues.push({ code: 'period_locked', message: 'Fakturaperioden är redan låst.', severity: 'blocked' })
  }

  const underlayResult = await supabaseService
    .from('billing_underlays')
    .select('id,status,readiness_status,total_kwh,contract_id,pricing_snapshot_id,calculated_total_sek_inc_vat')
    .eq('company_id', input.companyId)
    .eq('underlay_year', year)
    .eq('underlay_month', month)
    .limit(10_000)

  if (underlayResult.error) throw underlayResult.error
  const underlays = (underlayResult.data ?? []) as Record<string, unknown>[]

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

  const totalKwh = underlays.reduce((sum, row) => {
    const raw = row.total_kwh
    const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : 0
    return sum + (Number.isFinite(value) ? value : 0)
  }, 0)

  return {
    billingMonth,
    status: issues.some((issue) => issue.severity === 'blocked') ? 'blocked' as InvoiceReadinessStatus : 'ready' as InvoiceReadinessStatus,
    underlayCount: underlays.length,
    readyUnderlayCount: underlays.length - blockedUnderlays.length,
    pricedUnderlayCount: underlays.length - missingPricing.length,
    totalKwh,
    issues,
  }
}
