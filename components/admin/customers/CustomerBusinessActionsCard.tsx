import Link from 'next/link'
import type { CustomerContractRow } from '@/lib/customer-contracts/types'
import type { CustomerSiteRow, MeteringPointRow } from '@/lib/masterdata/types'
import type {
  CustomerAuthorizationDocumentRow,
  PowerOfAttorneyRow,
  SupplierSwitchRequestRow,
} from '@/lib/operations/types'
import type { CustomerInfoRequestRow } from '@/lib/onboarding/infoRequests'
import CustomerOperationAutomationForm from '@/components/admin/customers/CustomerOperationAutomationForm'
import CustomerProcessTimeline from '@/components/admin/customers/CustomerProcessTimeline'
import {
  buildCustomerCardSnapshot,
  type CustomerCardSnapshot,
} from '@/lib/customers/customerCardSnapshot'
import { meteringPointIdentityLabel } from '@/lib/customers/meteringIdentity'
import { buildCustomerCardWorkflow } from '@/lib/customer-operations/customerCardWorkflow'
import {
  buildCustomerBusinessActionPlan,
  buildCustomerBusinessStatusCards,
  tenantBusinessActionStatusLabel,
} from '@/lib/customer-operations/customerBusinessActions'
import { customerStatusToneClass } from '@/lib/customer-operations/customerActionRegistry'

export type Z01RepairEvent = {
  id: string
  event_type: string
  message: string | null
  payload: Record<string, unknown> | null
  created_at: string | null
}

type Props = {
  customerId: string
  companyId?: string | null
  sites: CustomerSiteRow[]
  meteringPoints: MeteringPointRow[]
  powersOfAttorney?: PowerOfAttorneyRow[]
  documents?: CustomerAuthorizationDocumentRow[]
  infoRequests?: CustomerInfoRequestRow[]
  contracts?: CustomerContractRow[]
  switchRequests?: SupplierSwitchRequestRow[]
  snapshot?: CustomerCardSnapshot
  isPlatformAdmin?: boolean
  z01RepairEvents?: Z01RepairEvent[]
}

function pointLabel(point: MeteringPointRow | null): string {
  return meteringPointIdentityLabel(point) ?? 'Mätpunkts-ID saknas'
}

function siteLabel(site: CustomerSiteRow | null): string {
  if (!site) return 'Ingen anläggning vald'
  return `${site.site_name}${site.facility_id ? ` · ${site.facility_id}` : ''}`
}

function primaryActionTone(status: string): string {
  if (status === 'blocked') return 'border-amber-200 bg-amber-50 text-amber-950'
  if (status === 'waiting') return 'border-sky-200 bg-sky-50 text-sky-950'
  return 'border-emerald-200 bg-emerald-50 text-emerald-950'
}

export default function CustomerBusinessActionsCard({
  customerId,
  sites,
  meteringPoints,
  powersOfAttorney = [],
  documents = [],
  infoRequests = [],
  contracts = [],
  switchRequests = [],
  snapshot: suppliedSnapshot,
  isPlatformAdmin = false,
}: Props) {
  const snapshot =
    suppliedSnapshot ??
    buildCustomerCardSnapshot({
      sites,
      meteringPoints,
      powersOfAttorney,
      documents,
      infoRequests,
      contracts,
    })

  const workflow = buildCustomerCardWorkflow({
    customerId,
    snapshot,
    sites,
    meteringPoints,
    infoRequests,
    contracts,
    switchRequests,
    powersOfAttorney,
    isPlatformAdmin,
  })

  const actions = buildCustomerBusinessActionPlan({
    workflow,
    snapshot,
    visibility: isPlatformAdmin ? 'superadmin' : 'tenant',
  })
  const primaryAction = actions.find((action) => action.primary) ?? null
  const secondaryActions = actions.filter((action) => action.priority === 'secondary')
  const statusCards = buildCustomerBusinessStatusCards({ workflow, snapshot })
  const primarySite = snapshot.primarySite
  const primaryPoint = snapshot.primaryMeteringPoint

  return (
    <section className="space-y-4">
      <CustomerProcessTimeline
        steps={workflow.workflowSteps}
        showTechnical={isPlatformAdmin}
      />

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
              Kundprocess
            </p>
            <h2 className="mt-2 text-xl font-semibold text-slate-950">
              {workflow.adminMessage}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700">
              {workflow.nextRequiredAction ??
                'Här ser du var kunden befinner sig, vad som händer nu och vad som kräver åtgärd.'}
            </p>
          </div>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
            {siteLabel(primarySite)} · {pointLabel(primaryPoint)}
          </span>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {statusCards.map((card) => (
            <Link
              key={card.id}
              href={card.href ?? '#'}
              className={`rounded-2xl border p-4 transition hover:shadow-sm ${customerStatusToneClass(card.tone)}`}
            >
              <div className="text-xs font-semibold uppercase tracking-[0.14em] opacity-80">
                {card.label}
              </div>
              <div className="mt-2 text-lg font-semibold">{card.value}</div>
              <p className="mt-2 text-xs leading-5 opacity-90">{card.description}</p>
            </Link>
          ))}
        </div>

        {primaryAction ? (
          <div className={`mt-6 rounded-3xl border p-5 ${primaryActionTone(primaryAction.status)}`}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] opacity-80">
                  Nästa steg
                </p>
                <h3 className="mt-1 text-lg font-semibold">{primaryAction.label}</h3>
                <p className="mt-2 max-w-2xl text-sm leading-6 opacity-90">
                  {primaryAction.description}
                </p>
                {primaryAction.status === 'blocked' && workflow.blockerAdminMessage ? (
                  <p className="mt-2 text-sm font-semibold opacity-95">
                    {workflow.blockerAdminMessage}
                  </p>
                ) : null}
              </div>
              <div className="min-w-[220px]">
                {primaryAction.kind ? (
                  <CustomerOperationAutomationForm
                    kind={primaryAction.kind}
                    customerId={customerId}
                    siteId={primarySite?.id}
                    meteringPointId={primaryPoint?.id}
                    idleLabel={primaryAction.label}
                    pendingLabel="Startar…"
                  />
                ) : (
                  <span className="inline-flex rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm">
                    {tenantBusinessActionStatusLabel(primaryAction.status)}
                  </span>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {secondaryActions.length > 0 ? (
          <div className="mt-5 flex flex-wrap gap-3">
            {secondaryActions.map((action) => (
              <Link
                key={action.id}
                href={action.href ?? '#'}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                {action.label}
              </Link>
            ))}
          </div>
        ) : null}

        {isPlatformAdmin ? (
          <details className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
            <summary className="cursor-pointer font-semibold text-slate-900">
              Tekniska detaljer och felsökning
            </summary>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {Object.entries(workflow.technicalDetails).map(([key, value]) =>
                value ? (
                  <div key={key} className="rounded-xl bg-white px-3 py-2 font-mono text-xs text-slate-700">
                    {key}: {value}
                  </div>
                ) : null,
              )}
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                href={`/admin/customers/${customerId}?tab=ediel-operations`}
                className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                Öppna tekniska Ediel-detaljer
              </Link>
              <Link
                href={`/admin/customers/${customerId}?tab=data-requests`}
                className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                Öppna avancerade uppgiftsärenden
              </Link>
            </div>
          </details>
        ) : null}
      </section>
    </section>
  )
}
