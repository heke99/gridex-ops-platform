// app/admin/operations/integrity/page.tsx
import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminPageAccess } from '@/lib/admin/guards'
import { MASTERDATA_PERMISSIONS } from '@/lib/admin/masterdataPermissions'
import { getCustomers } from '@/lib/customers/getCustomers'
import type { ReactNode } from 'react'
import { listMeteringPointsBySiteIds } from '@/lib/masterdata/db'
import {
  listAllBillingUnderlays,
  listAllGridOwnerDataRequests,
  listAllMeteringValues,
  listAllPartnerExports,
} from '@/lib/cis/db'
import {
  listAllSupplierSwitchRequests,
  listPowersOfAttorneyByCustomerId,
} from '@/lib/operations/db'
import { evaluateSiteSwitchReadiness } from '@/lib/operations/readiness'
import { getBillingExportReadiness } from '@/lib/operations/controlTower'
import {
  runBulkQueueMissingBillingUnderlaysFromIntegrityAction,
  runBulkQueueMissingMeterValuesFromIntegrityAction,
  runBulkQueueReadyBillingExportsFromIntegrityAction,
  runBulkQueueReadySupplierSwitchesFromIntegrityAction,
} from './actions'
import type { CustomerSiteRow, MeteringPointRow } from '@/lib/masterdata/types'
import type {
  BillingUnderlayRow,
  GridOwnerDataRequestRow,
  MeteringValueRow,
  PartnerExportRow,
} from '@/lib/cis/types'
import type { CustomerContractRow } from '@/lib/customer-contracts/types'
import type {
  PowerOfAttorneyRow,
  SupplierSwitchRequestRow,
} from '@/lib/operations/types'

export const dynamic = 'force-dynamic'

type DashboardRow = {
  customerId: string
  customerName: string
  customerType: string | null
  customerStatus: string | null
  email: string | null
  phone: string | null
  reason: string
  hint?: string
  customerHref: string
  workspaceHref: string
  workspaceLabel: string
  detailHref?: string
  detailLabel?: string
}

type QueueCardProps = {
  title: string
  count: number
  description: string
  href: string
  tone?: 'neutral' | 'danger' | 'warning' | 'info' | 'success'
}

type QueueSectionProps = {
  id: string
  title: string
  subtitle: string
  rows: DashboardRow[]
  emptyText: string
  workspaceHref: string
  workspaceLabel: string
  workspaceDescription: string
  bulkAction?: {
    label: string
    description: string
    form: ReactNode
  }
}

type PageProps = {
  searchParams: Promise<{
    status?: string
    action?: string
    period?: string
    message?: string
    createdCount?: string
    skippedCount?: string
    candidateCount?: string
    batchKey?: string
  }>
}

function QueueCard({
  title,
  count,
  description,
  href,
  tone = 'neutral',
}: QueueCardProps) {
  const toneClass =
    tone === 'danger'
      ? 'border-rose-200 bg-rose-50/70 dark:border-rose-900/40 dark:bg-rose-950/20'
      : tone === 'warning'
        ? 'border-amber-200 bg-amber-50/70 dark:border-amber-900/40 dark:bg-amber-950/20'
        : tone === 'info'
          ? 'border-blue-200 bg-blue-50/70 dark:border-blue-900/40 dark:bg-blue-950/20'
          : tone === 'success'
            ? 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/40 dark:bg-emerald-950/20'
            : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'

  return (
    <Link
      href={href}
      className={`block rounded-3xl border p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${toneClass}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
            {title}
          </p>
          <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">
            {count}
          </p>
        </div>

        <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300">
          Öppna
        </span>
      </div>

      <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
        {description}
      </p>
    </Link>
  )
}

function BulkActionButton({
  action,
  hiddenFields,
  label,
  variant = 'dark',
}: {
  action: (formData: FormData) => Promise<void>
  hiddenFields?: Array<{ name: string; value: string }>
  label: string
  variant?: 'dark' | 'warning' | 'success' | 'neutral'
}) {
  const className =
    variant === 'warning'
      ? 'rounded-2xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-700'
      : variant === 'success'
        ? 'rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700'
        : variant === 'neutral'
          ? 'rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800'
          : 'rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-black dark:bg-white dark:text-slate-950'

  return (
    <form action={action}>
      {hiddenFields?.map((field) => (
        <input
          key={`${field.name}:${field.value}`}
          type="hidden"
          name={field.name}
          value={field.value}
        />
      ))}
      <button className={className}>{label}</button>
    </form>
  )
}

function previousMonthPeriod(): { label: string; start: string; end: string } {
  const now = new Date()
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const year = prev.getUTCFullYear()
  const month = prev.getUTCMonth()
  const start = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10)
  const end = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10)
  const label = `${year}-${String(month + 1).padStart(2, '0')}`

  return { label, start, end }
}

function customerDisplayName(
  customer: Awaited<ReturnType<typeof getCustomers>>[number]
): string {
  return (
    customer.full_name ??
    customer.company_name ??
    [customer.first_name, customer.last_name].filter(Boolean).join(' ').trim() ??
    'Kund'
  )
}

function isTerminalSwitchStatus(status: SupplierSwitchRequestRow['status']): boolean {
  return ['completed', 'failed', 'rejected'].includes(status)
}

function FeedbackBanner({
  status,
  action,
  period,
  message,
  createdCount,
  skippedCount,
  candidateCount,
  batchKey,
}: {
  status: string | undefined
  action: string | undefined
  period: string | undefined
  message: string | undefined
  createdCount: string | undefined
  skippedCount: string | undefined
  candidateCount: string | undefined
  batchKey: string | undefined
}) {
  if (!status || !action) return null

  const actionLabelMap: Record<string, string> = {
    bulk_queue_missing_meter_values: 'Köa saknade mätvärden',
    bulk_queue_missing_billing_underlays: 'Köa saknade billing-underlag',
    bulk_queue_ready_supplier_switches: 'Köa redo switchar',
    bulk_queue_ready_billing_exports: 'Skapa redo exportbatch',
  }

  const actionLabel = actionLabelMap[action] ?? action
  const periodLabel = period ? ` för ${period}` : ''

  const created = createdCount ? Number(createdCount) : null
  const skipped = skippedCount ? Number(skippedCount) : null
  const candidates = candidateCount ? Number(candidateCount) : null

  if (status === 'success') {
    return (
      <section className="rounded-3xl border border-emerald-200 bg-emerald-50 px-6 py-5 shadow-sm dark:border-emerald-900/40 dark:bg-emerald-950/20">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="text-base font-semibold text-emerald-900 dark:text-emerald-200">
              Åtgärden kördes klart
            </h2>
            <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-300">
              {actionLabel}
              {periodLabel} har körts.
            </p>

            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {typeof created === 'number' ? (
                <span className="rounded-full border border-emerald-300 px-3 py-1 text-emerald-900 dark:border-emerald-800 dark:text-emerald-200">
                  Skapade: {created}
                </span>
              ) : null}
              {typeof skipped === 'number' ? (
                <span className="rounded-full border border-emerald-300 px-3 py-1 text-emerald-900 dark:border-emerald-800 dark:text-emerald-200">
                  Hoppade över: {skipped}
                </span>
              ) : null}
              {typeof candidates === 'number' ? (
                <span className="rounded-full border border-emerald-300 px-3 py-1 text-emerald-900 dark:border-emerald-800 dark:text-emerald-200">
                  Kandidater: {candidates}
                </span>
              ) : null}
              {batchKey ? (
                <span className="rounded-full border border-emerald-300 px-3 py-1 font-mono text-emerald-900 dark:border-emerald-800 dark:text-emerald-200">
                  Batch: {batchKey}
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/admin/outbound"
              className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800"
            >
              Öppna outbound
            </Link>
            <Link
              href="/admin/operations"
              className="rounded-2xl border border-emerald-300 px-4 py-2.5 text-sm font-semibold text-emerald-900 hover:bg-emerald-100 dark:border-emerald-800 dark:text-emerald-200 dark:hover:bg-emerald-950/30"
            >
              Öppna operations
            </Link>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="rounded-3xl border border-rose-200 bg-rose-50 px-6 py-5 shadow-sm dark:border-rose-900/40 dark:bg-rose-950/20">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h2 className="text-base font-semibold text-rose-900 dark:text-rose-200">
            Åtgärden misslyckades
          </h2>
          <p className="mt-1 text-sm text-rose-800 dark:text-rose-300">
            {actionLabel}
            {periodLabel} gick inte igenom.
          </p>
          {message ? (
            <p className="mt-2 text-sm text-rose-700 dark:text-rose-300">
              Felmeddelande: {message}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/admin/billing"
            className="rounded-2xl border border-rose-300 px-4 py-2.5 text-sm font-semibold text-rose-900 hover:bg-rose-100 dark:border-rose-800 dark:text-rose-200 dark:hover:bg-rose-950/30"
          >
            Öppna billing
          </Link>
          <Link
            href="/admin/outbound"
            className="rounded-2xl bg-rose-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-800"
          >
            Öppna outbound
          </Link>
        </div>
      </div>
    </section>
  )
}

function ActionStrip({
  period,
}: {
  period: { label: string; start: string; end: string }
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
            Operativa snabbvägar och bulk actions
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Hoppa direkt till rätt queue eller kör batchåtgärder utan att lämna kontrolltornet.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
          Aktiv kontrollperiod: <strong>{period.label}</strong>
        </div>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Link
          href="/admin/operations/switches?stage=blocked"
          className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-semibold text-slate-900 transition hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-950 dark:text-white dark:hover:bg-slate-900"
        >
          Blockerade switchar
        </Link>

        <Link
          href="/admin/operations/switches?requestType=switch"
          className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-semibold text-slate-900 transition hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-950 dark:text-white dark:hover:bg-slate-900"
        >
          Alla öppna byten
        </Link>

        <Link
          href="/admin/operations/switches?requestType=move_in"
          className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-semibold text-slate-900 transition hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-950 dark:text-white dark:hover:bg-slate-900"
        >
          Flytt in
        </Link>

        <Link
          href="/admin/operations/switches?requestType=move_out_takeover"
          className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-semibold text-slate-900 transition hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-950 dark:text-white dark:hover:bg-slate-900"
        >
          Övertag vid utflytt
        </Link>

        <Link
          href={`/admin/outbound/missing-meter-values?period=${period.label}`}
          className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm font-semibold text-amber-900 transition hover:bg-amber-100 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200 dark:hover:bg-amber-950/30"
        >
          Saknade mätvärden
        </Link>

        <Link
          href={`/admin/outbound/missing-billing-underlays?period=${period.label}`}
          className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm font-semibold text-amber-900 transition hover:bg-amber-100 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200 dark:hover:bg-amber-950/30"
        >
          Saknade billing-underlag
        </Link>

        <Link
          href="/admin/partner-exports"
          className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm font-semibold text-emerald-900 transition hover:bg-emerald-100 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-200 dark:hover:bg-emerald-950/30"
        >
          Partner exports
        </Link>

        <Link
          href="/admin/operations/ready-to-execute"
          className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-4 text-sm font-semibold text-blue-900 transition hover:bg-blue-100 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-blue-200 dark:hover:bg-blue-950/30"
        >
          Ready to execute
        </Link>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <BulkActionButton
          action={runBulkQueueMissingMeterValuesFromIntegrityAction}
          hiddenFields={[{ name: 'period_month', value: period.label }]}
          label={`Köa saknade mätvärden ${period.label}`}
          variant="warning"
        />

        <BulkActionButton
          action={runBulkQueueMissingBillingUnderlaysFromIntegrityAction}
          hiddenFields={[{ name: 'period_month', value: period.label }]}
          label={`Köa billing-underlag ${period.label}`}
          variant="warning"
        />

        <form action={runBulkQueueReadySupplierSwitchesFromIntegrityAction}>
          <button className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-black dark:bg-white dark:text-slate-950">
            Köa alla redo switchar
          </button>
        </form>

        <BulkActionButton
          action={runBulkQueueReadyBillingExportsFromIntegrityAction}
          hiddenFields={[{ name: 'period_month', value: period.label }]}
          label={`Skapa exportbatch ${period.label}`}
          variant="success"
        />
      </div>
    </section>
  )
}

function QueueSection({
  id,
  title,
  subtitle,
  rows,
  emptyText,
  workspaceHref,
  workspaceLabel,
  workspaceDescription,
  bulkAction,
}: QueueSectionProps) {
  return (
    <section
      id={id}
      className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
              {title}
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {subtitle}
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href={workspaceHref}
              className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-black dark:bg-white dark:text-slate-950"
            >
              {workspaceLabel}
            </Link>
            <Link
              href="/admin/customers/segments"
              className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Kundsegment
            </Link>
          </div>
        </div>

        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          {workspaceDescription}
        </p>

        {bulkAction ? (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900 dark:text-white">
                  {bulkAction.label}
                </div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {bulkAction.description}
                </div>
              </div>
              <div>{bulkAction.form}</div>
            </div>
          </div>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <div className="p-10 text-center text-sm text-slate-500 dark:text-slate-400">
          {emptyText}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-950/50">
              <tr className="border-b border-slate-200 text-left dark:border-slate-800">
                <th className="px-6 py-4 font-semibold text-slate-600 dark:text-slate-300">
                  Kund
                </th>
                <th className="px-6 py-4 font-semibold text-slate-600 dark:text-slate-300">
                  Typ / status
                </th>
                <th className="px-6 py-4 font-semibold text-slate-600 dark:text-slate-300">
                  Kontakt
                </th>
                <th className="px-6 py-4 font-semibold text-slate-600 dark:text-slate-300">
                  Orsak
                </th>
                <th className="px-6 py-4 font-semibold text-slate-600 dark:text-slate-300">
                  Nästa arbetsyta
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={`${id}:${row.customerId}:${row.reason}`}
                  className="border-b border-slate-100 align-top dark:border-slate-800"
                >
                  <td className="px-6 py-4">
                    <div className="font-medium text-slate-950 dark:text-white">
                      {row.customerName}
                    </div>
                    <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {row.customerId}
                    </div>
                  </td>

                  <td className="px-6 py-4 text-slate-600 dark:text-slate-300">
                    <div>{row.customerType ?? '—'}</div>
                    <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {row.customerStatus ?? '—'}
                    </div>
                  </td>

                  <td className="px-6 py-4 text-slate-600 dark:text-slate-300">
                    <div>{row.email ?? '—'}</div>
                    <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {row.phone ?? '—'}
                    </div>
                  </td>

                  <td className="px-6 py-4 text-slate-700 dark:text-slate-200">
                    <div>{row.reason}</div>
                    {row.hint ? (
                      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {row.hint}
                      </div>
                    ) : null}
                  </td>

                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-2">
                      <Link
                        href={row.customerHref}
                        className="inline-flex items-center rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        Öppna kund
                      </Link>
                      <Link
                        href={row.workspaceHref}
                        className="inline-flex items-center rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-black dark:bg-white dark:text-slate-950"
                      >
                        {row.workspaceLabel}
                      </Link>
                      {row.detailHref && row.detailLabel ? (
                        <Link
                          href={row.detailHref}
                          className="inline-flex items-center rounded-2xl border border-indigo-300 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-950/30"
                        >
                          {row.detailLabel}
                        </Link>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default async function AdminOperationsIntegrityPage({
  searchParams,
}: PageProps) {
  await requireAdminPageAccess([MASTERDATA_PERMISSIONS.READ])

  const resolvedSearchParams = await searchParams

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const customers = await getCustomers({ query: '' })
  const customerIds = customers.map((customer) => customer.id)

  const [
    sitesResponse,
    contractsResponse,
    switchRequests,
    dataRequests,
    billingUnderlays,
    partnerExports,
    allMeteringValues,
  ] = await Promise.all([
    supabase.from('customer_sites').select('*').in('customer_id', customerIds),
    supabase.from('customer_contracts').select('*').in('customer_id', customerIds),
    listAllSupplierSwitchRequests(supabase, {
      status: 'all',
      requestType: 'all',
      query: '',
    }),
    listAllGridOwnerDataRequests({ status: 'all', scope: 'all', query: '' }),
    listAllBillingUnderlays({ status: 'all', query: '' }),
    listAllPartnerExports({ status: 'all', exportKind: 'all', query: '' }),
    listAllMeteringValues({ query: '' }),
  ])

  if (sitesResponse.error) throw sitesResponse.error
  if (contractsResponse.error) throw contractsResponse.error

  const sites = (sitesResponse.data ?? []) as CustomerSiteRow[]
  const contracts = (contractsResponse.data ?? []) as CustomerContractRow[]
  const meteringPoints = await listMeteringPointsBySiteIds(
    supabase,
    sites.map((site) => site.id)
  )

  const period = previousMonthPeriod()

  const sitesByCustomerId = new Map<string, CustomerSiteRow[]>()
  const meteringPointsBySiteId = new Map<string, MeteringPointRow[]>()
  const contractsByCustomerId = new Map<string, CustomerContractRow[]>()
  const switchesByCustomerId = new Map<string, SupplierSwitchRequestRow[]>()
  const dataRequestsByCustomerId = new Map<string, GridOwnerDataRequestRow[]>()
  const underlaysByCustomerId = new Map<string, BillingUnderlayRow[]>()
  const exportsByCustomerId = new Map<string, PartnerExportRow[]>()
  const valuesByMeteringPointId = new Map<string, MeteringValueRow[]>()
  const powersOfAttorneyByCustomerId = new Map<string, PowerOfAttorneyRow[]>()

  for (const site of sites) {
    const current = sitesByCustomerId.get(site.customer_id) ?? []
    current.push(site)
    sitesByCustomerId.set(site.customer_id, current)
  }

  for (const point of meteringPoints) {
    const current = meteringPointsBySiteId.get(point.site_id) ?? []
    current.push(point)
    meteringPointsBySiteId.set(point.site_id, current)
  }

  for (const contract of contracts) {
    const current = contractsByCustomerId.get(contract.customer_id) ?? []
    current.push(contract)
    contractsByCustomerId.set(contract.customer_id, current)
  }

  for (const request of switchRequests) {
    const current = switchesByCustomerId.get(request.customer_id) ?? []
    current.push(request)
    switchesByCustomerId.set(request.customer_id, current)
  }

  for (const request of dataRequests) {
    const current = dataRequestsByCustomerId.get(request.customer_id) ?? []
    current.push(request)
    dataRequestsByCustomerId.set(request.customer_id, current)
  }

  for (const underlay of billingUnderlays) {
    const current = underlaysByCustomerId.get(underlay.customer_id) ?? []
    current.push(underlay)
    underlaysByCustomerId.set(underlay.customer_id, current)
  }

  for (const partnerExport of partnerExports) {
    const current = exportsByCustomerId.get(partnerExport.customer_id) ?? []
    current.push(partnerExport)
    exportsByCustomerId.set(partnerExport.customer_id, current)
  }

  for (const value of allMeteringValues) {
    const current = valuesByMeteringPointId.get(value.metering_point_id) ?? []
    current.push(value)
    valuesByMeteringPointId.set(value.metering_point_id, current)
  }

  const poaResults = await Promise.all(
    customerIds.map(async (customerId) => ({
      customerId,
      powers: await listPowersOfAttorneyByCustomerId(supabase, customerId),
    }))
  )

  for (const result of poaResults) {
    powersOfAttorneyByCustomerId.set(result.customerId, result.powers)
  }

  const mismatchRows: DashboardRow[] = []
  const waitingActivationRows: DashboardRow[] = []
  const moveRows: DashboardRow[] = []
  const switchRows: DashboardRow[] = []
  const missingMeterValuesRows: DashboardRow[] = []
  const importErrorRows: DashboardRow[] = []
  const readyForExportRows: DashboardRow[] = []

  for (const customer of customers) {
    const customerSites = sitesByCustomerId.get(customer.id) ?? []
    const customerContracts = contractsByCustomerId.get(customer.id) ?? []
    const customerSwitches = switchesByCustomerId.get(customer.id) ?? []
    const customerDataRequests = dataRequestsByCustomerId.get(customer.id) ?? []
    const customerUnderlays = underlaysByCustomerId.get(customer.id) ?? []
    const customerExports = exportsByCustomerId.get(customer.id) ?? []
    const customerPowers = powersOfAttorneyByCustomerId.get(customer.id) ?? []

    const customerHref = `/admin/customers/${customer.id}`

    const baseRow = {
      customerId: customer.id,
      customerName: customerDisplayName(customer),
      customerType: customer.customer_type,
      customerStatus: customer.status,
      email: customer.email,
      phone: customer.phone,
      customerHref,
    }

    const hasSignedOrActiveContract = customerContracts.some((contract) =>
      ['signed', 'active'].includes(contract.status)
    )

    if (hasSignedOrActiveContract && customerSites.length === 0) {
      mismatchRows.push({
        ...baseRow,
        reason: 'Kunden har signerat/aktivt avtal men saknar anläggning.',
        hint: 'Skapa site innan flödet går vidare.',
        workspaceHref: customerHref,
        workspaceLabel: 'Rätta kundkort',
      })
    }

    if (customerSites.length > 0) {
      const sitesWithoutMeteringPoint = customerSites.filter((site) => {
        const sitePoints = meteringPointsBySiteId.get(site.id) ?? []
        return sitePoints.length === 0
      })

      if (sitesWithoutMeteringPoint.length > 0) {
        mismatchRows.push({
          ...baseRow,
          reason: `${sitesWithoutMeteringPoint.length} anläggning(ar) saknar mätpunkt.`,
          hint: sitesWithoutMeteringPoint.map((site) => site.site_name).slice(0, 3).join(', '),
          workspaceHref: customerHref,
          workspaceLabel: 'Lägg till mätpunkt',
        })
      }
    }

    const readinessIssues = customerSites.flatMap((site) => {
      const readiness = evaluateSiteSwitchReadiness({
        site,
        meteringPoints: meteringPointsBySiteId.get(site.id) ?? [],
        powersOfAttorney: customerPowers,
      })

      if (readiness.isReady) return []

      return readiness.issues.map((issue) => ({
        siteName: site.site_name,
        title: issue.title,
      }))
    })

    if (readinessIssues.length > 0) {
      mismatchRows.push({
        ...baseRow,
        reason: 'Kunden har blockerande readiness-problem i switchflödet.',
        hint: readinessIssues
          .slice(0, 3)
          .map((issue) => `${issue.siteName}: ${issue.title}`)
          .join(' • '),
        workspaceHref: '/admin/operations/switches?stage=blocked',
        workspaceLabel: 'Öppna blockerad kö',
      })
    }

    const waitingContracts = customerContracts.filter((contract) =>
      ['pending_signature', 'signed'].includes(contract.status)
    )

    if (waitingContracts.length > 0 && customer.status !== 'active') {
      waitingActivationRows.push({
        ...baseRow,
        reason: `${waitingContracts.length} avtal väntar på aktivering eller slutsteg.`,
        hint: waitingContracts
          .slice(0, 3)
          .map((contract) => `${contract.contract_name} (${contract.status})`)
          .join(' • '),
        workspaceHref: customerHref,
        workspaceLabel: 'Öppna kund & avtal',
      })
    }

    const openMoveRequests = customerSwitches.filter(
      (request) =>
        ['move_in', 'move_out_takeover'].includes(request.request_type) &&
        !isTerminalSwitchStatus(request.status)
    )

    if (openMoveRequests.length > 0) {
      moveRows.push({
        ...baseRow,
        reason: `${openMoveRequests.length} öppna flyttärende(n).`,
        hint: openMoveRequests
          .slice(0, 3)
          .map((request) => `${request.request_type} • ${request.status}`)
          .join(' • '),
        workspaceHref: `/admin/operations/switches?q=${customer.id}`,
        workspaceLabel: 'Öppna switchrad',
      })
    }

    const openSwitchRequests = customerSwitches.filter(
      (request) => request.request_type === 'switch' && !isTerminalSwitchStatus(request.status)
    )

    if (openSwitchRequests.length > 0) {
      switchRows.push({
        ...baseRow,
        reason: `${openSwitchRequests.length} öppna leverantörsbyte(n).`,
        hint: openSwitchRequests
          .slice(0, 3)
          .map((request) => `${request.status}`)
          .join(' • '),
        workspaceHref: `/admin/operations/switches?q=${customer.id}`,
        workspaceLabel: 'Öppna switchrad',
      })
    }

    const missingMeterValuePoints = customerSites.flatMap((site) => {
      const sitePoints = meteringPointsBySiteId.get(site.id) ?? []

      return sitePoints.filter((point) => {
        const values = valuesByMeteringPointId.get(point.id) ?? []

        const hasValueInPeriod = values.some((value) => {
          const periodStart = value.period_start ?? ''
          const periodEnd = value.period_end ?? ''

          return (
            (periodStart && periodStart >= period.start && periodStart <= period.end) ||
            (periodEnd && periodEnd >= period.start && periodEnd <= period.end)
          )
        })

        return !hasValueInPeriod
      })
    })

    if (missingMeterValuePoints.length > 0) {
      missingMeterValuesRows.push({
        ...baseRow,
        reason: `${missingMeterValuePoints.length} mätpunkt(er) saknar mätvärden för ${period.label}.`,
        hint: missingMeterValuePoints
          .slice(0, 3)
          .map((point) => point.meter_point_id)
          .join(' • '),
        workspaceHref: `/admin/outbound/missing-meter-values?period=${period.label}`,
        workspaceLabel: 'Öppna mätvärdeskö',
      })
    }

    const failedDataRequests = customerDataRequests.filter(
      (request) => request.status === 'failed'
    )
    const failedUnderlays = customerUnderlays.filter(
      (underlay) => underlay.status === 'failed'
    )
    const failedExports = customerExports.filter(
      (partnerExport) => partnerExport.status === 'failed'
    )

    if (
      failedDataRequests.length > 0 ||
      failedUnderlays.length > 0 ||
      failedExports.length > 0
    ) {
      const firstFailedDataRequest = failedDataRequests[0] ?? null

      importErrorRows.push({
        ...baseRow,
        reason: 'Kunden har import- eller handoff-fel.',
        hint: [
          failedDataRequests.length > 0
            ? `${failedDataRequests.length} request-fel`
            : null,
          failedUnderlays.length > 0
            ? `${failedUnderlays.length} billing-fel`
            : null,
          failedExports.length > 0
            ? `${failedExports.length} export-fel`
            : null,
        ]
          .filter(Boolean)
          .join(' • '),
        workspaceHref: customerHref,
        workspaceLabel: 'Felsök kundkort',
        detailHref: firstFailedDataRequest
          ? `/admin/operations/grid-owner-requests/${firstFailedDataRequest.id}`
          : undefined,
        detailLabel: firstFailedDataRequest ? 'Öppna failed request' : undefined,
      })
    }

    const exportMap = new Map(
      customerExports
        .filter((row) => row.billing_underlay_id)
        .map((row) => [row.billing_underlay_id as string, row])
    )

    const readyUnderlays = customerUnderlays.filter((underlay) =>
      getBillingExportReadiness({
        underlay,
        existingExport: exportMap.get(underlay.id) ?? null,
      }).isReady
    )

    if (readyUnderlays.length > 0) {
      readyForExportRows.push({
        ...baseRow,
        reason: `${readyUnderlays.length} billing-underlag redo för partnerexport.`,
        hint: readyUnderlays
          .slice(0, 3)
          .map(
            (underlay) =>
              `${underlay.underlay_year ?? '—'}-${String(
                underlay.underlay_month ?? ''
              ).padStart(2, '0')}`
          )
          .join(' • '),
        workspaceHref: '/admin/partner-exports',
        workspaceLabel: 'Öppna exportkö',
      })
    }
  }

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Customer Integrity / Operations Dashboard"
        subtitle="Samlad kontrollvy för mismatch, väntar aktiv, flytt, byte, saknade mätvärden, importfel och redo för export."
        userEmail={user?.email ?? null}
      />

      <div className="space-y-6 p-8">
        <FeedbackBanner
  status={resolvedSearchParams.status}
  action={resolvedSearchParams.action}
  period={resolvedSearchParams.period}
  message={resolvedSearchParams.message}
  createdCount={resolvedSearchParams.createdCount}
  skippedCount={resolvedSearchParams.skippedCount}
  candidateCount={resolvedSearchParams.candidateCount}
  batchKey={resolvedSearchParams.batchKey}
/>

        <ActionStrip period={period} />

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <QueueCard
            title="Kunder med mismatch"
            count={mismatchRows.length}
            description="Kunder där kärndata, site/mätpunkt eller readiness inte hänger ihop."
            href="#mismatch"
            tone="danger"
          />
          <QueueCard
            title="Väntar aktiv"
            count={waitingActivationRows.length}
            description="Kunder med avtal i pending_signature eller signed som ännu inte är hela vägen aktiva."
            href="#waiting-activation"
            tone="warning"
          />
          <QueueCard
            title="Flytt"
            count={moveRows.length}
            description="Kunder med öppna move_in eller move_out_takeover."
            href="#moves"
            tone="info"
          />
          <QueueCard
            title="Byte"
            count={switchRows.length}
            description="Kunder med öppna leverantörsbyten."
            href="#switches"
            tone="info"
          />
          <QueueCard
            title={`Saknat mätunderlag (${period.label})`}
            count={missingMeterValuesRows.length}
            description="Kunder vars mätpunkter saknar mätvärden för föregående period."
            href="#missing-meter-values"
            tone="warning"
          />
          <QueueCard
            title="Importfel"
            count={importErrorRows.length}
            description="Kunder med failed requests, failed billing underlays eller failed partner exports."
            href="#import-errors"
            tone="danger"
          />
          <QueueCard
            title="Redo för export"
            count={readyForExportRows.length}
            description="Kunder med billing-underlag som är klara att skickas vidare till partner."
            href="#ready-for-export"
            tone="success"
          />
          <QueueCard
            title="Kundsegment"
            count={customers.length}
            description="Hoppa till kundsegment för signerat, väntar aktiv, flytt och byte."
            href="/admin/customers/segments"
            tone="neutral"
          />
        </section>

        <QueueSection
          id="mismatch"
          title="Kunder med mismatch"
          subtitle="Visar kunder där avtal, site, mätpunkt eller readiness inte är logiskt synkade."
          rows={mismatchRows}
          emptyText="Inga mismatch-kunder hittades."
          workspaceHref="/admin/operations/switches?stage=blocked"
          workspaceLabel="Öppna blockerad kö"
          workspaceDescription="Bästa första arbetsytan här är blockerade switchar eller kundkortet om site/mätpunkt saknas."
          bulkAction={{
            label: 'Massåtgärd för switch-ready ärenden',
            description:
              'Köar alla redan redo supplier switches i ett svep utan att du behöver öppna varje kund för sig.',
            form: (
              <form action={runBulkQueueReadySupplierSwitchesFromIntegrityAction}>
                <button className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-black dark:bg-white dark:text-slate-950">
                  Köa alla redo switchar
                </button>
              </form>
            ),
          }}
        />

        <QueueSection
          id="waiting-activation"
          title="Kunder som väntar aktiv"
          subtitle="Kunder med pending_signature eller signed där kundflödet ännu inte nått aktivt läge."
          rows={waitingActivationRows}
          emptyText="Inga kunder väntar på aktivering just nu."
          workspaceHref="/admin/customers/segments?segment=pending_activation"
          workspaceLabel="Öppna segmentet väntar aktiv"
          workspaceDescription="Börja i kundkortet och kontrollera avtal, switchstatus och om anläggning/mätpunkt är färdigregistrerad."
        />

        <QueueSection
          id="moves"
          title="Kunder med flytt"
          subtitle="Öppna move_in eller move_out_takeover som ännu inte är avslutade."
          rows={moveRows}
          emptyText="Inga öppna flyttärenden hittades."
          workspaceHref="/admin/operations/switches?requestType=move_in"
          workspaceLabel="Öppna flyttkö"
          workspaceDescription="Använd switchlistan för att följa öppna move_in och move_out_takeover samt deras readiness och outbound-läge."
        />

        <QueueSection
          id="switches"
          title="Kunder med byte"
          subtitle="Öppna leverantörsbyten som fortfarande kräver uppföljning."
          rows={switchRows}
          emptyText="Inga öppna leverantörsbyten hittades."
          workspaceHref="/admin/operations/switches?requestType=switch"
          workspaceLabel="Öppna bytekö"
          workspaceDescription="Härifrån går du vidare till switchlistan för detaljerad uppföljning av stage, outbound och kvittens."
          bulkAction={{
            label: 'Masskö för redo byten',
            description:
              'Kör en batch som lägger redo switchar i outbound-kön direkt från kontrolltornet.',
            form: (
              <form action={runBulkQueueReadySupplierSwitchesFromIntegrityAction}>
                <button className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-black dark:bg-white dark:text-slate-950">
                  Köa redo byten
                </button>
              </form>
            ),
          }}
        />

        <QueueSection
          id="missing-meter-values"
          title={`Kunder med saknat mätpunktsunderlag (${period.label})`}
          subtitle="Kunder vars mätpunkter saknar registrerade mätvärden för föregående månad."
          rows={missingMeterValuesRows}
          emptyText="Alla kunder med mätpunkter har mätvärden för perioden."
          workspaceHref={`/admin/outbound/missing-meter-values?period=${period.label}`}
          workspaceLabel="Öppna mätvärdeskö"
          workspaceDescription="Använd bulk-kön för att identifiera saknade periodvärden och köa begäran utan dubbletter."
          bulkAction={{
            label: `Köa saknade mätvärden för ${period.label}`,
            description:
              'Skapar bulk requests för alla saknade mätvärden i perioden utan att duplicera redan registrerat underlag.',
            form: (
              <BulkActionButton
                action={runBulkQueueMissingMeterValuesFromIntegrityAction}
                hiddenFields={[{ name: 'period_month', value: period.label }]}
                label={`Köa mätvärden ${period.label}`}
                variant="warning"
              />
            ),
          }}
        />

        <QueueSection
          id="import-errors"
          title="Kunder med importfel"
          subtitle="Failed nätägarförfrågningar, failed billing underlays eller failed partner exports."
          rows={importErrorRows}
          emptyText="Inga importfel hittades."
          workspaceHref="/admin/billing"
          workspaceLabel="Öppna billing / importflöden"
          workspaceDescription="Börja i kundkortet för kundspecifika fel eller gå vidare till billing, metering och partner exports för bredare felsökning."
        />

        <QueueSection
          id="ready-for-export"
          title="Kunder redo för export"
          subtitle="Billing-underlag som är mottagna/validerade och ännu inte har aktiv partnerexport."
          rows={readyForExportRows}
          emptyText="Inga kunder är redo för export just nu."
          workspaceHref="/admin/partner-exports"
          workspaceLabel="Öppna exportkö"
          workspaceDescription="Det här är arbetsytan för billing-underlag som är redo att skickas vidare till partnern."
          bulkAction={{
            label: `Skapa exportbatch för ${period.label}`,
            description:
              'Skapar partner exports för alla redo billing-underlag i vald period, men hoppar över sådant som redan har aktiv export.',
            form: (
              <BulkActionButton
                action={runBulkQueueReadyBillingExportsFromIntegrityAction}
                hiddenFields={[{ name: 'period_month', value: period.label }]}
                label={`Skapa exportbatch ${period.label}`}
                variant="success"
              />
            ),
          }}
        />

        <QueueSection
          id="missing-billing-underlays"
          title={`Saknade billing-underlag (${period.label})`}
          subtitle="Den här batchen hjälper dig att köa underlagsförfrågningar för mätpunkter som ännu inte fått billing-underlag."
          rows={[]}
          emptyText="Använd knappen nedan för att köa saknade billing-underlag för vald period."
          workspaceHref={`/admin/outbound/missing-billing-underlays?period=${period.label}`}
          workspaceLabel="Öppna billing-underlagskö"
          workspaceDescription="Bra när du ser att mätvärden finns men billing-underlag ännu inte kommit in från nätägaren."
          bulkAction={{
            label: `Köa saknade billing-underlag för ${period.label}`,
            description:
              'Skapar bulk billing-underlagsrequests för vald period utan att duplicera redan existerande underlag.',
            form: (
              <BulkActionButton
                action={runBulkQueueMissingBillingUnderlaysFromIntegrityAction}
                hiddenFields={[{ name: 'period_month', value: period.label }]}
                label={`Köa billing-underlag ${period.label}`}
                variant="warning"
              />
            ),
          }}
        />
      </div>
    </div>
  )
}