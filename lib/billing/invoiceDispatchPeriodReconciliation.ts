import 'server-only'

import { supabaseService } from '@/lib/supabase/service'

const monthPattern = /^[0-9]{4}-(0[1-9]|1[0-2])$/
const companyPattern = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
const maxDuePeriods = 10
const statuses = ['pending', 'locked', 'already_locked', 'superseded'] as const

type DuePeriod = { company_id: string; billing_month: string }

function isDuePeriod(value: unknown): value is DuePeriod {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return typeof row.company_id === 'string' && companyPattern.test(row.company_id)
    && typeof row.billing_month === 'string' && monthPattern.test(row.billing_month)
}

function receiptStatus(value: unknown, month: string) {
  if (!value || typeof value !== 'object') throw new Error('invoice_dispatch_period_invalid_receipt')
  const receipt = value as Record<string, unknown>
  const status = statuses.find(candidate => candidate === receipt.status)
  if (!status || receipt.billingMonth !== month) throw new Error('invoice_dispatch_period_invalid_receipt')
  return { status, failed: receipt.reason === 'reconcile_failed', companyInactive: receipt.reason === 'company_not_operational',
    reopened: receipt.currentPeriodStatus === 'reopened' }
}

async function reconcilePeriod(companyId: string, billingMonth: string, signal: AbortSignal) {
  const { data, error } = await supabaseService.rpc('gridex_reconcile_invoice_dispatch_period_v1', {
    p_company: companyId, p_month: billingMonth,
  }).abortSignal(signal)
  if (error) throw error
  return receiptStatus(data, billingMonth)
}

export async function reconcileVerifiedInvoiceDispatch(input: { companyId: string; itemId: string; billingMonth: string; actorUserId: string }) {
  const signal = AbortSignal.timeout(4_000)
  const { data, error } = await supabaseService.rpc('gridex_queue_invoice_dispatch_period_v1', {
    p_company: input.companyId, p_item: input.itemId, p_actor: input.actorUserId,
  }).abortSignal(signal)
  if (error) throw error
  const { status } = receiptStatus(data, input.billingMonth)
  if (status === 'locked' || status === 'already_locked') return 'locked' as const
  if (status === 'superseded') return 'not_locked' as const
  const result = await reconcilePeriod(input.companyId, input.billingMonth, signal)
  if (result.failed) throw new Error('invoice_dispatch_period_reconciliation_failed')
  return result.status === 'locked' || result.status === 'already_locked' ? 'locked' as const : 'not_locked' as const
}

export async function runInvoiceDispatchPeriodReconciliation() {
  const signal = AbortSignal.timeout(20_000)
  const { data, error } = await supabaseService.rpc('gridex_list_due_invoice_dispatch_periods_v1', {
    p_limit: maxDuePeriods,
  }).abortSignal(signal)
  if (error || !Array.isArray(data) || data.length > maxDuePeriods || !data.every(isDuePeriod)) {
    throw new Error('invoice_dispatch_period_invalid_batch')
  }
  const uniquePeriods = new Set(data.map(row => row.company_id.toLowerCase() + '/' + row.billing_month))
  if (uniquePeriods.size !== data.length) throw new Error('invoice_dispatch_period_duplicate_batch_item')
  const summary = { scanned: data.length, locked: 0, alreadyLocked: 0, superseded: 0, waiting: 0, deferred: 0, failed: 0 }
  for (const [index, row] of data.entries()) {
    if (signal.aborted) {
      summary.deferred = data.length - index
      break
    }
    try {
      const result = await reconcilePeriod(row.company_id, row.billing_month, signal)
      if (result.failed) summary.failed += 1
      else if (result.status === 'locked') summary.locked += 1
      else if (result.status === 'already_locked') summary.alreadyLocked += 1
      else if (result.status === 'superseded') summary.superseded += 1
      else summary.waiting += 1
    } catch {
      summary.failed += 1
    }
  }
  return summary
}

export async function readInvoiceDispatchPeriodStatus(companyId: string, billingMonth: string) {
  const { requirePermissionServer } = await import('@/lib/auth/requirePermissionServer')
  const { resolveAdminSelectedCompanyReadScope } = await import('@/lib/tenant/adminScope')
  const actor = await requirePermissionServer('billing_underlay.read')
  const scope = await resolveAdminSelectedCompanyReadScope(actor, { allowMissing: true })
  if (scope.companyId !== companyId || !companyPattern.test(companyId) || !monthPattern.test(billingMonth)) return null
  const { data, error } = await supabaseService.rpc('gridex_read_invoice_dispatch_period_v1', {
    p_company: companyId, p_month: billingMonth,
  })
  if (error) throw error
  if (data === null) return null
  return receiptStatus(data, billingMonth)
}
