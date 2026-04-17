import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminPageAccess } from '@/lib/admin/guards'
import { MASTERDATA_PERMISSIONS } from '@/lib/admin/masterdataPermissions'
import CustomerEdielOperationsCard from '@/components/admin/customers/CustomerEdielOperationsCard'
import {
  getCustomerSiteById,
  getMeteringPointById,
  listCustomerInternalNotesByCustomerId,
  listCustomerSitesByCustomerId,
  listGridOwners,
  listMasterdataAuditLogsForCustomer,
  listMeteringPointsBySiteIds,
  listPriceAreas,
} from '@/lib/masterdata/db'
import {
  listContractOffers,
  listCustomerContractsByCustomerId,
} from '@/lib/customer-contracts/db'
import CustomerSiteForm from '@/components/admin/masterdata/CustomerSiteForm'
import CustomerSitesTable from '@/components/admin/masterdata/CustomerSitesTable'
import MeteringPointForm from '@/components/admin/masterdata/MeteringPointForm'
import MeteringPointsTable from '@/components/admin/masterdata/MeteringPointsTable'
import { createCustomerInternalNoteAction } from './actions'
import type {
  AuditLogRow,
  CustomerInternalNoteRow,
  CustomerSiteRow,
  MeteringPointRow,
} from '@/lib/masterdata/types'
import type { OutboundRequestRow } from '@/lib/cis/types'
import type {
  PowerOfAttorneyRow,
  SupplierSwitchRequestRow,
  CustomerAuthorizationDocumentRow,
} from '@/lib/operations/types'
import type {
  CustomerAddressRow,
  CustomerContactRow,
  CustomerType,
} from '@/types/customers'
import CustomerBillingMeteringCard from '@/components/admin/customers/CustomerBillingMeteringCard'
import CustomerSwitchOperationsCard from '@/components/admin/customers/CustomerSwitchOperationsCard'
import CustomerContractsCard from '@/components/admin/customers/CustomerContractsCard'
import CustomerContactsAddressesCard from '@/components/admin/customers/CustomerContactsAddressesCard'
import CustomerProfileCard from '@/components/admin/customers/CustomerProfileCard'
import CustomerGridOwnerFileImportCard from '@/components/admin/customers/CustomerGridOwnerFileImportCard'
import CustomerContractOfferEligibilityCard from '@/components/admin/customers/CustomerContractOfferEligibilityCard'
import CustomerOperationsReadinessStrip from '@/components/admin/customers/CustomerOperationsReadinessStrip'
import CustomerAuthorizationDocumentsCard from '@/components/admin/customers/CustomerAuthorizationDocumentsCard'
import {
  listBillingUnderlaysByCustomerId,
  listGridOwnerDataRequestsByCustomerId,
  listMeteringValuesByCustomerId,
  listOutboundRequestsByCustomerId,
  listPartnerExportsByCustomerId,
} from '@/lib/cis/db'
import {
  listCustomerAuthorizationDocumentsByCustomerId,
  listPowersOfAttorneyByCustomerId,
  listSupplierSwitchEventsByRequestIds,
  listSupplierSwitchRequestsByCustomerId,
} from '@/lib/operations/db'
import { getSwitchLifecycle } from '@/lib/operations/controlTower'
import { getCustomerEdielDataBundle } from '@/lib/ediel/customerData'

export const dynamic = 'force-dynamic'

type CustomerRow = {
  id: string
  customer_type: string | null
  status: string | null
  first_name: string | null
  last_name: string | null
  full_name: string | null
  company_name: string | null
  email: string | null
  phone: string | null
  personal_number: string | null
  org_number: string | null
  customer_number: string | null
  apartment_number: string | null
  created_at: string
}

type CustomerPageProps = {
  params: Promise<{ id: string }>
  searchParams: Promise<{
    editSite?: string
    editMeteringPoint?: string
  }>
}

type CustomerLifecycleSummary = {
  blocked: number
  queuedForOutbound: number
  awaitingDispatch: number
  awaitingResponse: number
  readyToExecute: number
  failed: number
  completed: number
  activeOpen: number
  primaryLabel: string
  primaryHref: string
  primaryDescription: string
}

function formatCustomerName(customer: CustomerRow): string {
  if (customer.full_name?.trim()) return customer.full_name.trim()

  const fullName = [customer.first_name, customer.last_name]
    .filter(Boolean)
    .join(' ')
    .trim()

  if (fullName) return fullName
  if (customer.company_name?.trim()) return customer.company_name.trim()
  return 'Kund'
}

function normalizeCustomerType(value: string | null | undefined): CustomerType {
  if (value === 'business') return 'business'
  if (value === 'association') return 'association'
  return 'private'
}

function customerTypeLabel(value: string | null | undefined): string {
  const customerType = normalizeCustomerType(value)

  if (customerType === 'business') return 'Företag'
  if (customerType === 'association') return 'Förening'
  return 'Privatkund'
}

function customerTypeDescription(customerType: CustomerType): string {
  if (customerType === 'business') {
    return 'Företagskund där företagsnamn och organisationsnummer är huvudidentitet, medan kontaktperson hanteras separat.'
  }

  if (customerType === 'association') {
    return 'Föreningskund där föreningsnamn och organisationsnummer är huvudidentitet, medan kontaktperson hanteras separat.'
  }

  return 'Privatkund där personuppgifterna är huvudidentitet för kunden.'
}

function identityPrimaryLabel(customerType: CustomerType): string {
  return customerType === 'private' ? 'Personnummer' : 'Organisationsnummer'
}

function identityPrimaryValue(
  customer: CustomerRow,
  customerType: CustomerType
): string {
  return customerType === 'private'
    ? maskSensitiveValue(customer.personal_number)
    : customer.org_number ?? '—'
}

function identitySecondaryLabel(customerType: CustomerType): string {
  if (customerType === 'private') return 'Lägenhetsnummer'
  return customerType === 'association' ? 'Föreningsnamn' : 'Företagsnamn'
}

function identitySecondaryValue(
  customer: CustomerRow,
  customerType: CustomerType
): string {
  if (customerType === 'private') {
    return customer.apartment_number ?? '—'
  }

  return customer.company_name ?? '—'
}

function primaryContactHeading(customerType: CustomerType): string {
  if (customerType === 'private') return 'Huvudkontakt'
  return 'Primär kontaktperson'
}

function activeAddressHeading(customerType: CustomerType): string {
  if (customerType === 'private') return 'Aktiv adress'
  if (customerType === 'association') return 'Primär adress för föreningen'
  return 'Primär adress för företaget'
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'

  return new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function maskSensitiveValue(value: string | null): string {
  if (!value) return '—'
  if (value.length <= 4) return value
  return `${'*'.repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`
}

function statusTone(status: string | null): string {
  switch (status) {
    case 'active':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
    case 'draft':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
    case 'inactive':
    case 'closed':
      return 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
    default:
      return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
  }
}

function lifecycleTone(stage: string): string {
  if (['ready_to_execute', 'completed'].includes(stage)) {
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
  }

  if (['blocked', 'failed'].includes(stage)) {
    return 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
  }

  if (['awaiting_response'].includes(stage)) {
    return 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
  }

  return 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
}

function entityLabel(entityType: string): string {
  switch (entityType) {
    case 'customer':
      return 'Kund'
    case 'customer_site':
      return 'Anläggning'
    case 'metering_point':
      return 'Mätpunkt'
    default:
      return entityType
  }
}

function actionLabel(action: string): string {
  switch (action) {
    case 'insert':
      return 'Skapad'
    case 'update':
      return 'Uppdaterad'
    case 'delete':
      return 'Borttagen'
    case 'customer_created':
      return 'Kund skapad'
    default:
      return action
  }
}

function compactJson(value: Record<string, unknown> | null): string {
  if (!value) return '—'

  const keys = Object.keys(value)
  if (keys.length === 0) return '—'

  return keys
    .slice(0, 6)
    .map((key) => `${key}: ${String(value[key])}`)
    .join(' • ')
}

async function getCustomer(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  id: string
): Promise<CustomerRow | null> {
  const { data, error } = await supabase
    .from('customers')
    .select(
      'id, customer_type, status, first_name, last_name, full_name, company_name, email, phone, personal_number, org_number, customer_number, apartment_number, created_at'
    )
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  return (data as CustomerRow | null) ?? null
}

function ActorCell({
  actorUserId,
}: {
  actorUserId: string | null
}) {
  if (!actorUserId) {
    return <span className="text-slate-500 dark:text-slate-400">System</span>
  }

  return (
    <span className="font-mono text-xs text-slate-600 dark:text-slate-300">
      {actorUserId}
    </span>
  )
}

function requestSortTime(request: SupplierSwitchRequestRow): number {
  return new Date(
    request.completed_at ??
      request.failed_at ??
      request.submitted_at ??
      request.created_at
  ).getTime()
}

function outboundSortTime(outbound: OutboundRequestRow): number {
  return new Date(
    outbound.acknowledged_at ??
      outbound.failed_at ??
      outbound.sent_at ??
      outbound.prepared_at ??
      outbound.queued_at ??
      outbound.created_at
  ).getTime()
}

function getLatestOutboundForRequest(
  requestId: string,
  outboundRequests: OutboundRequestRow[]
): OutboundRequestRow | null {
  const rows = outboundRequests
    .filter(
      (row) =>
        row.request_type === 'supplier_switch' &&
        row.source_type === 'supplier_switch_request' &&
        row.source_id === requestId
    )
    .sort((a, b) => outboundSortTime(b) - outboundSortTime(a))

  return rows[0] ?? null
}

function buildCustomerLifecycleSummary(params: {
  sites: CustomerSiteRow[]
  switchRequests: SupplierSwitchRequestRow[]
  outboundRequests: OutboundRequestRow[]
}): CustomerLifecycleSummary {
  const { sites, switchRequests, outboundRequests } = params

  const latestRequestsBySite = sites
    .map((site) => {
      const requestsForSite = switchRequests
        .filter((request) => request.site_id === site.id)
        .sort((a, b) => requestSortTime(b) - requestSortTime(a))

      return requestsForSite[0] ?? null
    })
    .filter((request): request is SupplierSwitchRequestRow => Boolean(request))

  let blocked = 0
  let queuedForOutbound = 0
  let awaitingDispatch = 0
  let awaitingResponse = 0
  let readyToExecute = 0
  let failed = 0
  let completed = 0

  for (const request of latestRequestsBySite) {
    const outbound = getLatestOutboundForRequest(request.id, outboundRequests)

    const lifecycle = getSwitchLifecycle({
      request,
      readiness: null,
      outboundRequest: outbound,
    })

    switch (lifecycle.stage) {
      case 'blocked':
        blocked += 1
        break
      case 'queued_for_outbound':
        queuedForOutbound += 1
        break
      case 'awaiting_dispatch':
        awaitingDispatch += 1
        break
      case 'awaiting_response':
        awaitingResponse += 1
        break
      case 'ready_to_execute':
        readyToExecute += 1
        break
      case 'failed':
        failed += 1
        break
      case 'completed':
        completed += 1
        break
      default:
        break
    }
  }

  const activeOpen =
    blocked +
    queuedForOutbound +
    awaitingDispatch +
    awaitingResponse +
    readyToExecute +
    failed

  if (blocked > 0) {
    return {
      blocked,
      queuedForOutbound,
      awaitingDispatch,
      awaitingResponse,
      readyToExecute,
      failed,
      completed,
      activeOpen,
      primaryLabel: 'Blockerade switchar',
      primaryHref: '/admin/operations/switches?stage=blocked',
      primaryDescription:
        'Minst en anläggning stoppas av blockerare. Börja i blockerad kö eller öppna switchsektionen på kundkortet först.',
    }
  }

  if (readyToExecute > 0) {
    return {
      blocked,
      queuedForOutbound,
      awaitingDispatch,
      awaitingResponse,
      readyToExecute,
      failed,
      completed,
      activeOpen,
      primaryLabel: 'Redo att slutföra',
      primaryHref: '/admin/operations/ready-to-execute',
      primaryDescription:
        'Det finns kvitterade switchar som kan slutföras nu. Gå direkt till ready-to-execute-kön.',
    }
  }

  if (awaitingResponse > 0) {
    return {
      blocked,
      queuedForOutbound,
      awaitingDispatch,
      awaitingResponse,
      readyToExecute,
      failed,
      completed,
      activeOpen,
      primaryLabel: 'Väntar på kvittens',
      primaryHref: '/admin/operations/switches?stage=awaiting_response',
      primaryDescription:
        'Switchen är skickad och väntar på extern återkoppling eller uppföljning.',
    }
  }

  if (awaitingDispatch > 0) {
    return {
      blocked,
      queuedForOutbound,
      awaitingDispatch,
      awaitingResponse,
      readyToExecute,
      failed,
      completed,
      activeOpen,
      primaryLabel: 'Väntar på dispatch',
      primaryHref: '/admin/operations/switches?stage=awaiting_dispatch',
      primaryDescription:
        'Outbound finns men dispatchen är inte helt igenom ännu. Kontrollera outbound-läget.',
    }
  }

  if (queuedForOutbound > 0) {
    return {
      blocked,
      queuedForOutbound,
      awaitingDispatch,
      awaitingResponse,
      readyToExecute,
      failed,
      completed,
      activeOpen,
      primaryLabel: 'Saknar outbound',
      primaryHref: '/admin/operations/switches?stage=queued_for_outbound',
      primaryDescription:
        'Det finns switchar som saknar dispatchpost och behöver köas eller felsökas.',
    }
  }

  if (failed > 0) {
    return {
      blocked,
      queuedForOutbound,
      awaitingDispatch,
      awaitingResponse,
      readyToExecute,
      failed,
      completed,
      activeOpen,
      primaryLabel: 'Failed / rejected',
      primaryHref: '/admin/operations/switches?stage=failed',
      primaryDescription:
        'Minst ett ärende har brutit flödet och behöver manuell bedömning, retry eller korrigering.',
    }
  }

  return {
    blocked,
    queuedForOutbound,
    awaitingDispatch,
    awaitingResponse,
    readyToExecute,
    failed,
    completed,
    activeOpen,
    primaryLabel: 'Inga akuta switchblockerare',
    primaryHref: '/admin/customers',
    primaryDescription:
      'Kundens switchflöde har inga tydliga akuta blockerare just nu. Fortsätt från kundkortet eller granska detaljer längre ner.',
  }
}

function getBestContactEmail(
  customer: CustomerRow,
  contacts: CustomerContactRow[]
): string | null {
  if (customer.email?.trim()) return customer.email.trim()

  const primaryWithEmail =
    contacts.find((contact) => contact.is_primary && contact.email?.trim()) ?? null
  if (primaryWithEmail?.email?.trim()) return primaryWithEmail.email.trim()

  const firstWithEmail = contacts.find((contact) => contact.email?.trim()) ?? null
  return firstWithEmail?.email?.trim() ?? null
}

function getBestContactPhone(
  customer: CustomerRow,
  contacts: CustomerContactRow[]
): string | null {
  if (customer.phone?.trim()) return customer.phone.trim()

  const primaryWithPhone =
    contacts.find((contact) => contact.is_primary && contact.phone?.trim()) ?? null
  if (primaryWithPhone?.phone?.trim()) return primaryWithPhone.phone.trim()

  const firstWithPhone = contacts.find((contact) => contact.phone?.trim()) ?? null
  return firstWithPhone?.phone?.trim() ?? null
}

function SectionAnchor({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-36 space-y-3">
      <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-950">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  )
}

function QuickJumpLink({
  href,
  label,
  tone = 'default',
}: {
  href: string
  label: string
  tone?: 'default' | 'success' | 'info' | 'warning' | 'danger'
}) {
  const toneClass =
    tone === 'success'
      ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300'
      : tone === 'info'
        ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/20 dark:text-blue-300'
        : tone === 'warning'
          ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-300'
          : tone === 'danger'
            ? 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/20 dark:text-rose-300'
            : 'border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'

  return (
    <Link
      href={href}
      className={`inline-flex items-center rounded-2xl border px-4 py-2.5 text-sm font-semibold transition hover:opacity-90 ${toneClass}`}
    >
      {label}
    </Link>
  )
}

function StickyActionBar({
  lifecycleSummary,
  dataRequestsCount,
}: {
  lifecycleSummary: CustomerLifecycleSummary
  dataRequestsCount: number
}) {
  return (
    <div className="sticky top-3 z-20 rounded-3xl border border-slate-200 bg-white/95 p-4 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-900 dark:text-white">
            Snabbåtgärder
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Starta leverantörsbyte, begär uppgifter från nätägare eller hoppa direkt till Ediel utan att leta i kundkortet.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <QuickJumpLink href="#authorization-documents" label="Fullmakt / avtal" tone="success" />
          <QuickJumpLink href="#switch-operations" label="Nytt leverantörsbyte" tone="success" />
          <QuickJumpLink href="#billing-metering" label="Begär mätvärden" tone="warning" />
          <QuickJumpLink href="#billing-metering" label="Begär billingunderlag" tone="warning" />
          <QuickJumpLink href="#ediel-operations" label="Öppna Ediel" tone="info" />
          <QuickJumpLink href="#contracts" label="Avtal" />
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
          <div className="text-slate-500 dark:text-slate-400">Primär signal</div>
          <div className="mt-1 font-semibold text-slate-950 dark:text-white">
            {lifecycleSummary.primaryLabel}
          </div>
        </div>

        <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
          <div className="text-slate-500 dark:text-slate-400">Öppna switchflöden</div>
          <div className="mt-1 font-semibold text-slate-950 dark:text-white">
            {lifecycleSummary.activeOpen}
          </div>
        </div>

        <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
          <div className="text-slate-500 dark:text-slate-400">Ready to execute</div>
          <div className="mt-1 font-semibold text-slate-950 dark:text-white">
            {lifecycleSummary.readyToExecute}
          </div>
        </div>

        <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
          <div className="text-slate-500 dark:text-slate-400">Nätägarbegäran</div>
          <div className="mt-1 font-semibold text-slate-950 dark:text-white">
            {dataRequestsCount}
          </div>
        </div>
      </div>
    </div>
  )
}

function NotesSection({
  customerId,
  notes,
}: {
  customerId: string
  notes: CustomerInternalNoteRow[]
}) {
  return (
    <section className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
      <form
        action={createCustomerInternalNoteAction}
        className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="mb-5">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Intern anteckning
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Logga support- och driftinformation som inte hör hemma i kundens avtal eller adressfält.
          </p>
        </div>

        <input type="hidden" name="customer_id" value={customerId} />

        <label className="grid gap-2">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Anteckning
          </span>
          <textarea
            name="body"
            rows={8}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
            placeholder="Skriv intern notering för support, drift eller handläggning..."
          />
        </label>

        <div className="mt-6 flex justify-end">
          <button className="inline-flex items-center rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 dark:bg-white dark:text-slate-950">
            Spara anteckning
          </button>
        </div>
      </form>

      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Intern historik
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {notes.length} anteckningar kopplade till kunden.
          </p>
        </div>

        {notes.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500 dark:text-slate-400">
            Inga interna anteckningar ännu.
          </div>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {notes.map((note) => (
              <article key={note.id} className="p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm font-medium text-slate-900 dark:text-white">
                    Intern notering
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Skapad {formatDateTime(note.created_at)}
                  </div>
                </div>

                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-300">
                  {note.body}
                </p>

                <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-500 dark:text-slate-400">
                  <span>Skapad av: {note.created_by ?? 'System'}</span>
                  <span>Uppdaterad: {formatDateTime(note.updated_at)}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function AuditSection({
  auditLogs,
  sites,
  meteringPoints,
}: {
  auditLogs: AuditLogRow[]
  sites: CustomerSiteRow[]
  meteringPoints: MeteringPointRow[]
}) {
  const siteNameById = new Map(sites.map((site) => [site.id, site.site_name]))
  const meteringPointNameById = new Map(
    meteringPoints.map((point) => [point.id, point.meter_point_id])
  )

  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          Senaste ändringar
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Visar senaste audit-händelser för kund, anläggningar och mätpunkter.
        </p>
      </div>

      {auditLogs.length === 0 ? (
        <div className="p-10 text-center text-sm text-slate-500 dark:text-slate-400">
          Inga audit-händelser hittades ännu.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-950/50">
              <tr className="border-b border-slate-200 text-left dark:border-slate-800">
                <th className="px-6 py-4 font-semibold text-slate-600 dark:text-slate-300">
                  Tid
                </th>
                <th className="px-6 py-4 font-semibold text-slate-600 dark:text-slate-300">
                  Objekt
                </th>
                <th className="px-6 py-4 font-semibold text-slate-600 dark:text-slate-300">
                  Händelse
                </th>
                <th className="px-6 py-4 font-semibold text-slate-600 dark:text-slate-300">
                  Användare
                </th>
                <th className="px-6 py-4 font-semibold text-slate-600 dark:text-slate-300">
                  Detalj
                </th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.map((log) => {
                const title =
                  log.entity_type === 'customer_site'
                    ? siteNameById.get(log.entity_id) ?? log.entity_id
                    : log.entity_type === 'metering_point'
                      ? meteringPointNameById.get(log.entity_id) ?? log.entity_id
                      : log.entity_id

                return (
                  <tr key={log.id} className="align-top">
                    <td className="px-6 py-4 text-slate-600 dark:text-slate-300">
                      {formatDateTime(log.created_at)}
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-900 dark:text-white">
                        {entityLabel(log.entity_type)}
                      </div>
                      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {title}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-700 dark:text-slate-200">
                      {actionLabel(log.action)}
                    </td>
                    <td className="px-6 py-4">
                      <ActorCell actorUserId={log.actor_user_id} />
                    </td>
                    <td className="px-6 py-4 text-slate-600 dark:text-slate-300">
                      <div>{compactJson(log.new_values)}</div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default async function CustomerAdminDetailPage({
  params,
  searchParams,
}: CustomerPageProps) {
  await requireAdminPageAccess([MASTERDATA_PERMISSIONS.READ])

  const { id } = await params
  const resolvedSearchParams = await searchParams
  const editSiteId = resolvedSearchParams.editSite ?? null
  const editMeteringPointId = resolvedSearchParams.editMeteringPoint ?? null

  const supabase = await createSupabaseServerClient()

  const [
    customer,
    gridOwners,
    priceAreas,
    sites,
    notes,
    dataRequests,
    meteringValues,
    billingUnderlays,
    partnerExports,
    outboundRequests,
    switchRequests,
    contactsResponse,
    addressesResponse,
    contractOffers,
    customerContracts,
    powersOfAttorney,
    authorizationDocuments,
  ] = await Promise.all([
    getCustomer(supabase, id),
    listGridOwners(supabase),
    listPriceAreas(supabase),
    listCustomerSitesByCustomerId(supabase, id),
    listCustomerInternalNotesByCustomerId(id),
    listGridOwnerDataRequestsByCustomerId(id),
    listMeteringValuesByCustomerId(id),
    listBillingUnderlaysByCustomerId(id),
    listPartnerExportsByCustomerId(id),
    listOutboundRequestsByCustomerId(id),
    listSupplierSwitchRequestsByCustomerId(supabase, id),
    supabase
      .from('customer_contacts')
      .select('*')
      .eq('customer_id', id)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: false }),
    supabase
      .from('customer_addresses')
      .select('*')
      .eq('customer_id', id)
      .order('is_active', { ascending: false })
      .order('created_at', { ascending: false }),
    listContractOffers({ activeOnly: true }),
    listCustomerContractsByCustomerId(id),
    listPowersOfAttorneyByCustomerId(supabase, id),
    listCustomerAuthorizationDocumentsByCustomerId(supabase, id),
  ])

  if (!customer) {
    notFound()
  }

  if (contactsResponse.error) throw contactsResponse.error
  if (addressesResponse.error) throw addressesResponse.error

  const contacts = (contactsResponse.data ?? []) as CustomerContactRow[]
  const addresses = (addressesResponse.data ?? []) as CustomerAddressRow[]
  const poaRows = powersOfAttorney as PowerOfAttorneyRow[]
  const documentRows = authorizationDocuments as CustomerAuthorizationDocumentRow[]

  const [meteringPoints, switchEvents, edielData] = await Promise.all([
    listMeteringPointsBySiteIds(
      supabase,
      sites.map((site) => site.id)
    ),
    listSupplierSwitchEventsByRequestIds(
      supabase,
      switchRequests.map((request) => request.id)
    ),
    getCustomerEdielDataBundle({
      supabase,
      customerId: id,
      gridOwners,
    }),
  ])

  const selectedSite = editSiteId
    ? await getCustomerSiteById(supabase, editSiteId)
    : null

  const selectedMeteringPoint = editMeteringPointId
    ? await getMeteringPointById(supabase, editMeteringPointId)
    : null

  const safeSelectedSite =
    selectedSite && selectedSite.customer_id === id ? selectedSite : null

  const siteIds = new Set(sites.map((site) => site.id))
  const safeSelectedMeteringPoint =
    selectedMeteringPoint && siteIds.has(selectedMeteringPoint.site_id)
      ? selectedMeteringPoint
      : null

  const auditLogs = await listMasterdataAuditLogsForCustomer({
    customerId: id,
    siteIds: sites.map((site) => site.id),
    meteringPointIds: meteringPoints.map((point) => point.id),
    limit: 30,
  })

  const customerName = formatCustomerName(customer)
  const activeSites = sites.filter((site) => site.status === 'active').length
  const activeMeteringPoints = meteringPoints.filter(
    (point) => point.status === 'active'
  ).length

  const lifecycleSummary = buildCustomerLifecycleSummary({
    sites,
    switchRequests,
    outboundRequests,
  })

  const hasReadyEdielRoute = edielData.recommendationRoutes.some((route) => {
    const hasReceiver = Boolean(
      route.profile?.receiver_ediel_id?.trim() || route.grid_owner_ediel_id?.trim()
    )

    return Boolean(
      route.is_active &&
        route.profile?.is_enabled &&
        route.profile?.sender_ediel_id?.trim() &&
        route.profile?.mailbox?.trim() &&
        hasReceiver
    )
  })

  const hasUsablePowerOfAttorney = poaRows.some(
    (row) =>
      row.scope === 'supplier_switch' &&
      row.status === 'signed' &&
      Boolean(row.document_path?.trim())
  )

  const hasSwitchData = sites.some((site) => {
    const siteMeteringPoints = meteringPoints.filter((point) => point.site_id === site.id)
    const candidateMeteringPoint =
      siteMeteringPoints.find((point) => point.status === 'active') ??
      siteMeteringPoints.find((point) => point.status === 'pending_validation') ??
      siteMeteringPoints[0] ??
      null

    return Boolean(
      candidateMeteringPoint?.meter_point_id?.trim() &&
        (candidateMeteringPoint?.grid_owner_id ?? site.grid_owner_id) &&
        (candidateMeteringPoint?.price_area_code ?? site.price_area_code) &&
        site.current_supplier_name?.trim() &&
        site.move_in_date
    )
  })

  const readinessItems = [
    {
      label: 'Avtal',
      ok: customerContracts.length > 0,
      detail:
        customerContracts.length > 0
          ? `${customerContracts.length} registrerade`
          : 'Saknar kundavtal',
    },
    {
      label: 'Fullmakt',
      ok: hasUsablePowerOfAttorney,
      detail: hasUsablePowerOfAttorney
        ? 'Signerad fullmakt med dokument finns'
        : 'Saknar signerad fullmakt med fil',
    },
    {
      label: 'Anläggning',
      ok: sites.length > 0,
      detail: sites.length > 0 ? `${sites.length} st` : 'Ingen anläggning',
    },
    {
      label: 'Mätpunkt',
      ok: meteringPoints.length > 0,
      detail:
        meteringPoints.length > 0
          ? `${meteringPoints.length} st`
          : 'Ingen mätpunkt',
    },
    {
      label: 'Switch-data',
      ok: hasSwitchData,
      detail: hasSwitchData
        ? 'Minst en anläggning har masterdata för switch'
        : 'Nuvarande leverantör, nätägare, mätpunkt eller datum saknas',
    },
    {
      label: 'Switch',
      ok: switchRequests.length > 0,
      detail:
        switchRequests.length > 0
          ? `${switchRequests.length} ärenden`
          : 'Inget switchärende',
    },
    {
      label: 'Ediel-route',
      ok: hasReadyEdielRoute,
      detail: hasReadyEdielRoute ? 'Minst en route redo' : 'Route/profile blockerad',
    },
    {
      label: 'Outbound',
      ok: outboundRequests.some((row) => row.channel_type !== 'unresolved'),
      detail:
        outboundRequests.length > 0
          ? `${outboundRequests.length} poster`
          : 'Ingen outbound ännu',
    },
  ]

  const primaryContact =
    contacts.find((contact) => contact.is_primary) ?? contacts[0] ?? null
  const activeAddress =
    addresses.find((address) => address.is_active) ?? addresses[0] ?? null

  const displayEmail = getBestContactEmail(customer, contacts)
  const displayPhone = getBestContactPhone(customer, contacts)
  const normalizedCustomerType = normalizeCustomerType(customer.customer_type)
  const customerTypeUiLabel = customerTypeLabel(customer.customer_type)
  const primaryIdentityLabel = identityPrimaryLabel(normalizedCustomerType)
  const primaryIdentityValue = identityPrimaryValue(
    customer,
    normalizedCustomerType
  )
  const secondaryIdentityLabel = identitySecondaryLabel(normalizedCustomerType)
  const secondaryIdentityValue = identitySecondaryValue(
    customer,
    normalizedCustomerType
  )

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
              Kundkort v2
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">
                {customerName}
              </h1>
              <span
                className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusTone(
                  customer.status
                )}`}
              >
                {customer.status ?? 'okänd'}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap gap-2 text-sm text-slate-600 dark:text-slate-400">
              <span className="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800">
                {displayEmail ?? 'Ingen e-post'}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800">
                {displayPhone ?? 'Ingen telefon'}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800">
                {customerTypeUiLabel}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800">
                Kund-ID: {customer.id}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800">
                Kundnummer: {customer.customer_number ?? '—'}
              </span>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
              {customerTypeDescription(normalizedCustomerType)}
            </div>

            <div className="mt-4 grid gap-3 text-sm text-slate-600 dark:text-slate-400 sm:grid-cols-3">
              <div className="rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-950">
                <div className="text-xs uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                  {primaryIdentityLabel}
                </div>
                <div className="mt-1 font-medium text-slate-900 dark:text-white">
                  {primaryIdentityValue}
                </div>
              </div>

              <div className="rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-950">
                <div className="text-xs uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                  {secondaryIdentityLabel}
                </div>
                <div className="mt-1 font-medium text-slate-900 dark:text-white">
                  {secondaryIdentityValue}
                </div>
              </div>

              <div className="rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-950">
                <div className="text-xs uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                  Skapad
                </div>
                <div className="mt-1 font-medium text-slate-900 dark:text-white">
                  {formatDateTime(customer.created_at)}
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-950">
                <div className="text-xs uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                  {primaryContactHeading(normalizedCustomerType)}
                </div>
                <div className="mt-2 font-medium text-slate-900 dark:text-white">
                  {primaryContact?.name ??
                    (normalizedCustomerType === 'private'
                      ? customerName
                      : 'Ingen primär kontaktperson')}
                </div>
                <div className="mt-2 space-y-1 text-sm text-slate-600 dark:text-slate-300">
                  <div>E-post: {primaryContact?.email ?? displayEmail ?? '—'}</div>
                  <div>Telefon: {primaryContact?.phone ?? displayPhone ?? '—'}</div>
                  <div>Typ: {primaryContact?.type ?? '—'}</div>
                  <div>Titel: {primaryContact?.title ?? '—'}</div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-950">
                <div className="text-xs uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                  {activeAddressHeading(normalizedCustomerType)}
                </div>
                <div className="mt-2 font-medium text-slate-900 dark:text-white">
                  {activeAddress?.street_1 ?? 'Ingen aktiv adress'}
                </div>
                <div className="mt-2 space-y-1 text-sm text-slate-600 dark:text-slate-300">
                  <div>
                    {activeAddress
                      ? `${activeAddress.postal_code ?? '—'} ${activeAddress.city ?? ''}`
                      : '—'}
                  </div>
                  <div>Typ: {activeAddress?.type ?? '—'}</div>
                  <div>Land: {activeAddress?.country ?? '—'}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
              <div className="text-slate-500 dark:text-slate-400">Anläggningar</div>
              <div className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">
                {sites.length}
              </div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {activeSites} aktiva
              </div>
            </div>

            <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
              <div className="text-slate-500 dark:text-slate-400">Mätpunkter</div>
              <div className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">
                {meteringPoints.length}
              </div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {activeMeteringPoints} aktiva
              </div>
            </div>

            <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
              <div className="text-slate-500 dark:text-slate-400">Nätägar-requests</div>
              <div className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">
                {dataRequests.length}
              </div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                billing + metering
              </div>
            </div>

            <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
              <div className="text-slate-500 dark:text-slate-400">Partnerexporter</div>
              <div className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">
                {partnerExports.length}
              </div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                queued / sent / ack
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50/70 p-5 dark:border-slate-800 dark:bg-slate-950">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-white">
                Kundens arbetsyta
              </div>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Härifrån hoppar du direkt till leverantörsbyte, nätägarbegäran, Ediel och avtal utan att leta längre ner på sidan.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <QuickJumpLink href="#authorization-documents" label="Fullmakt / avtal" tone="success" />
              <QuickJumpLink href="#switch-operations" label="Starta leverantörsbyte" tone="success" />
              <QuickJumpLink href="#billing-metering" label="Begär uppgifter från nätägare" tone="warning" />
              <QuickJumpLink href="#ediel-operations" label="Öppna Ediel" tone="info" />
              <QuickJumpLink href="#contracts" label="Avtal" />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <QuickJumpLink href="#profile" label="Profil" />
            <QuickJumpLink href="#grid-owner-import" label="Grid owner import" />
            <QuickJumpLink href="#authorization-documents" label="Fullmakt / avtal" />
            <QuickJumpLink href="#switch-operations" label="Leverantörsbyte" />
            <QuickJumpLink href="#ediel-operations" label="Ediel" />
            <QuickJumpLink href="#billing-metering" label="Billing / metering" />
            <QuickJumpLink href="#contracts" label="Avtal" />
            <QuickJumpLink href="#contacts-addresses" label="Kontakter / adresser" />
            <QuickJumpLink href="#sites" label="Anläggningar" />
            <QuickJumpLink href="#metering-points" label="Mätpunkter" />
            <QuickJumpLink href="#notes" label="Anteckningar" />
            <QuickJumpLink href="#audit" label="Audit" />
          </div>
        </div>

        <div className="mt-6">
          <StickyActionBar
            lifecycleSummary={lifecycleSummary}
            dataRequestsCount={dataRequests.length}
          />
        </div>

        <div className="mt-6">
          <CustomerOperationsReadinessStrip items={readinessItems} />
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className="rounded-3xl border border-slate-200 bg-slate-50/70 p-5 dark:border-slate-800 dark:bg-slate-950">
            <div className="flex flex-wrap items-center gap-3">
              <div className="text-sm font-semibold text-slate-900 dark:text-white">
                Operations summary
              </div>
              <span
                className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${lifecycleTone(
                  lifecycleSummary.primaryLabel === 'Blockerade switchar'
                    ? 'blocked'
                    : lifecycleSummary.primaryLabel === 'Redo att slutföra'
                      ? 'ready_to_execute'
                      : lifecycleSummary.primaryLabel === 'Väntar på kvittens'
                        ? 'awaiting_response'
                        : lifecycleSummary.primaryLabel === 'Failed / rejected'
                          ? 'failed'
                          : lifecycleSummary.primaryLabel === 'Inga akuta switchblockerare'
                            ? 'completed'
                            : 'queued_for_outbound'
                )}`}
              >
                {lifecycleSummary.primaryLabel}
              </span>
            </div>

            <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
              {lifecycleSummary.primaryDescription}
            </p>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="text-slate-500 dark:text-slate-400">Aktiva öppna</div>
                <div className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">
                  {lifecycleSummary.activeOpen}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="text-slate-500 dark:text-slate-400">Ready to execute</div>
                <div className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">
                  {lifecycleSummary.readyToExecute}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="text-slate-500 dark:text-slate-400">Väntar svar</div>
                <div className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">
                  {lifecycleSummary.awaitingResponse}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="text-slate-500 dark:text-slate-400">Blockerade</div>
                <div className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">
                  {lifecycleSummary.blocked}
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                href={lifecycleSummary.primaryHref}
                className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-black dark:bg-white dark:text-slate-950"
              >
                Öppna rekommenderad arbetsyta
              </Link>

              <Link
                href="#switch-operations"
                className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Gå till leverantörsbyte
              </Link>

              <Link
                href="#billing-metering"
                className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Gå till nätägarbegäran
              </Link>

              <Link
                href="#ediel-operations"
                className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Gå till Ediel
              </Link>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
            <Link
              href="/admin/operations/switches?stage=queued_for_outbound"
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-950"
            >
              <div className="text-sm text-slate-500 dark:text-slate-400">Saknar outbound</div>
              <div className="mt-1 text-2xl font-semibold text-slate-950 dark:text-white">
                {lifecycleSummary.queuedForOutbound}
              </div>
            </Link>

            <Link
              href="/admin/operations/switches?stage=awaiting_dispatch"
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-950"
            >
              <div className="text-sm text-slate-500 dark:text-slate-400">Väntar dispatch</div>
              <div className="mt-1 text-2xl font-semibold text-slate-950 dark:text-white">
                {lifecycleSummary.awaitingDispatch}
              </div>
            </Link>

            <Link
              href="/admin/operations/switches?stage=failed"
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-950"
            >
              <div className="text-sm text-slate-500 dark:text-slate-400">Failed / rejected</div>
              <div className="mt-1 text-2xl font-semibold text-slate-950 dark:text-white">
                {lifecycleSummary.failed}
              </div>
            </Link>

            <Link
              href="/admin/operations/ready-to-execute"
              className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 shadow-sm transition hover:bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/10 dark:hover:bg-emerald-950/20"
            >
              <div className="text-sm text-slate-500 dark:text-slate-400">Completed / ready view</div>
              <div className="mt-1 text-2xl font-semibold text-slate-950 dark:text-white">
                {lifecycleSummary.completed + lifecycleSummary.readyToExecute}
              </div>
            </Link>
          </div>
        </div>
      </section>

      <SectionAnchor
        id="profile"
        title="Profil och erbjudanden"
        description="Kundens profil, status och kvalificerade avtalsmöjligheter."
      >
        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <CustomerProfileCard customer={customer} />
          <CustomerContractOfferEligibilityCard
            customerType={normalizedCustomerType}
            offers={contractOffers}
          />
        </section>
      </SectionAnchor>

      <SectionAnchor
        id="grid-owner-import"
        title="Grid owner import"
        description="Importera eller synka underlag från nätägarsidan för kunden."
      >
        <CustomerGridOwnerFileImportCard customerId={id} />
      </SectionAnchor>

      <SectionAnchor
        id="authorization-documents"
        title="Fullmakt och komplett avtal"
        description="Ladda upp dokument på kundkortet och skapa request-paket mot nätägare och nuvarande leverantör."
      >
        <CustomerAuthorizationDocumentsCard
          customerId={id}
          sites={sites}
          meteringPoints={meteringPoints}
          documents={documentRows}
          powersOfAttorney={poaRows}
        />
      </SectionAnchor>

      <SectionAnchor
        id="switch-operations"
        title="Leverantörsbyte"
        description="Här startar du nytt leverantörsbyte och följer kundens switchflöde."
      >
        <CustomerSwitchOperationsCard
          customerId={id}
          sites={sites}
          meteringPoints={meteringPoints}
          switchRequests={switchRequests}
          switchEvents={switchEvents}
          outboundRequests={outboundRequests}
          edielMessages={edielData.edielMessages}
          edielRecommendationRoutes={edielData.recommendationRoutes}
        />
      </SectionAnchor>

      <SectionAnchor
        id="ediel-operations"
        title="Ediel"
        description="Skapa, validera och följ Ediel-flödet för kundens switchar och nätägarrelaterade meddelanden."
      >
        <CustomerEdielOperationsCard
          customerId={id}
          sites={sites}
          meteringPoints={meteringPoints}
          gridOwners={gridOwners}
          switchRequests={switchRequests}
          dataRequests={dataRequests}
          communicationRoutes={edielData.communicationRoutes}
          routeProfiles={edielData.routeProfiles}
          edielMessages={edielData.edielMessages}
          recommendationRoutes={edielData.recommendationRoutes}
        />
      </SectionAnchor>

      <SectionAnchor
        id="billing-metering"
        title="Begär uppgifter från nätägare"
        description="Här begär du mätvärden, billingunderlag och övrigt underlag från nätägaren."
      >
        <CustomerBillingMeteringCard
          customerId={id}
          sites={sites}
          meteringPoints={meteringPoints}
          gridOwners={gridOwners}
          dataRequests={dataRequests}
          meteringValues={meteringValues}
          billingUnderlays={billingUnderlays}
          partnerExports={partnerExports}
          outboundRequests={outboundRequests}
        />
      </SectionAnchor>

      <SectionAnchor
        id="contracts"
        title="Avtal"
        description="Visa, hantera och uppdatera kundens avtal."
      >
        <CustomerContractsCard customerId={id} />
      </SectionAnchor>

      <SectionAnchor
        id="contacts-addresses"
        title="Kontakter och adresser"
        description="Primära kontaktpersoner, adresser och kundens kontaktstruktur."
      >
        <CustomerContactsAddressesCard
          customerId={id}
          customerType={normalizedCustomerType}
          contacts={contacts}
          addresses={addresses}
        />
      </SectionAnchor>

      <SectionAnchor
        id="sites"
        title="Anläggningar"
        description="Skapa eller redigera kundens anläggningar."
      >
        <section className="grid gap-6 xl:grid-cols-[460px_minmax(0,1fr)]">
          <CustomerSiteForm
            customerId={id}
            gridOwners={gridOwners}
            priceAreas={priceAreas}
            site={safeSelectedSite}
            cancelHref={`/admin/customers/${id}`}
          />
          <CustomerSitesTable
            customerId={id}
            sites={sites}
            gridOwners={gridOwners}
            meteringPoints={meteringPoints}
            selectedSiteId={safeSelectedSite?.id ?? null}
          />
        </section>
      </SectionAnchor>

      <SectionAnchor
        id="metering-points"
        title="Mätpunkter"
        description="Skapa eller redigera kundens mätpunkter."
      >
        <section className="grid gap-6 xl:grid-cols-[460px_minmax(0,1fr)]">
          <MeteringPointForm
            customerId={id}
            sites={sites}
            gridOwners={gridOwners}
            priceAreas={priceAreas}
            meteringPoint={safeSelectedMeteringPoint}
            cancelHref={`/admin/customers/${id}`}
          />
          <MeteringPointsTable
            customerId={id}
            meteringPoints={meteringPoints}
            sites={sites}
            gridOwners={gridOwners}
            selectedMeteringPointId={safeSelectedMeteringPoint?.id ?? null}
          />
        </section>
      </SectionAnchor>

      <SectionAnchor
        id="notes"
        title="Anteckningar"
        description="Intern support- och driftlogg för kunden."
      >
        <NotesSection customerId={id} notes={notes} />
      </SectionAnchor>

      <SectionAnchor
        id="audit"
        title="Audit"
        description="Senaste ändringar i kund, anläggningar och mätpunkter."
      >
        <AuditSection
          auditLogs={auditLogs}
          sites={sites}
          meteringPoints={meteringPoints}
        />
      </SectionAnchor>
    </div>
  )
}