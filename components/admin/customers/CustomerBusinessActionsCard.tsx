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
  dryRunZ01RepairAction,
  repairZ01CustomerInfoRequestAction,
} from '@/app/admin/customers/[id]/business-actions'
import {
  buildCustomerCardSnapshot,
  type CustomerCardSnapshot,
} from '@/lib/customers/customerCardSnapshot'
import { meteringPointIdentityLabel } from '@/lib/customers/meteringIdentity'
import { buildCustomerCardWorkflow, type CustomerWorkflowStep } from '@/lib/customer-operations/customerCardWorkflow'
import { buildTenantCustomerCardView } from '@/lib/customer-operations/customerCardTenantView'
import type { EdielDispatchStateResult } from '@/lib/ediel/intent/dispatchState'
import {
  buildCustomerBusinessActionPlan,
  buildCustomerBusinessStatusCards,
  tenantBusinessActionStatusLabel,
} from '@/lib/customer-operations/customerBusinessActions'
import { customerStatusToneClass } from '@/lib/customer-operations/customerActionRegistry'
import type { ManualRequestSummary } from '@/lib/customer-operations/manualRequestSummary'

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
  dispatchState?: EdielDispatchStateResult | null
  manualRequests?: ManualRequestSummary[]
}

function manualRequestDate(value: string | null | undefined): string {
  if (!value) return '—'
  try {
    return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium' }).format(new Date(value))
  } catch {
    return '—'
  }
}

function poaStatusLabel(status: ManualRequestSummary['poaStatus']): string {
  if (status === 'finns') return 'Fullmakt finns'
  if (status === 'utgången') return 'Fullmakt utgången'
  return 'Fullmakt saknas'
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

function hiddenValue(value: string | null | undefined): string {
  return typeof value === 'string' ? value : ''
}

function repairEventSummary(event: Z01RepairEvent): string {
  const payload = event.payload ?? {}
  const blocker = typeof payload.blockerCode === 'string' ? payload.blockerCode : null
  const dryRun = payload.dryRun === true ? 'Torrkörning' : null
  return [dryRun, blocker, event.message].filter(Boolean).join(' · ') || 'Z01-reparation registrerad.'
}

function z01PayloadAny(event: Z01RepairEvent, key: string): unknown {
  const payload = event.payload ?? {}
  return payload[key]
}

function z01EventLabel(event: Z01RepairEvent): string {
  switch (event.event_type) {
    case 'z01_repair_blocked':
      return 'Blockerad'
    case 'z01_repair_failed':
      return 'Misslyckad'
    case 'z01_repair_completed':
      return 'Slutförd'
    case 'z01_dry_run_repair':
      return 'Torrkörning'
    default:
      return event.event_type || 'Z01-händelse'
  }
}

function z01EventDateLabel(value: string | null): string {
  if (!value) return 'Tid saknas'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Ogiltigt datum'
  return date.toLocaleString('sv-SE')
}

function z01EventEdielMessageLabel(event: Z01RepairEvent): string {
  const edielMessageId = z01PayloadAny(event, 'edielMessageId') ?? z01PayloadAny(event, 'ediel_message_id')
  return typeof edielMessageId === 'string' && edielMessageId.trim() ? edielMessageId.trim() : 'ej skapat'
}

export default function CustomerBusinessActionsCard({
  customerId,
  companyId,
  sites,
  meteringPoints,
  powersOfAttorney = [],
  documents = [],
  infoRequests = [],
  contracts = [],
  switchRequests = [],
  snapshot: suppliedSnapshot,
  isPlatformAdmin = false,
  z01RepairEvents = [],
  dispatchState = null,
  manualRequests = [],
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
    manualRequests,
    isPlatformAdmin,
    dispatchState,
  })

  const actions = buildCustomerBusinessActionPlan({
    workflow,
    snapshot,
    visibility: isPlatformAdmin ? 'superadmin' : 'tenant',
  })
  const workflowPrimaryAction = workflow.primaryAction
  const primaryAction = actions.find((action) => action.id === workflowPrimaryAction) ?? actions.find((action) => action.primary) ?? null
  const statusCards = buildCustomerBusinessStatusCards({ workflow, snapshot })
  const primarySite = snapshot.primarySite
  const primaryPoint = snapshot.primaryMeteringPoint

  // Tenants see the simplified business timeline (Swedish, six steps, no
  // internal pipeline stages). The full technical step chain (intents, outbox,
  // EDIEL SMTP, CONTRL/APERAK) is superadmin-only. Both views derive from the
  // same backend workflow/snapshot source of truth.
  const timelineSteps: CustomerWorkflowStep[] = isPlatformAdmin
    ? workflow.workflowSteps
    : buildTenantCustomerCardView({ snapshot, workflow, dispatchState }).processSteps.map((step) => ({
        id: step.id,
        label: step.label,
        explanation: step.explanation,
        status: step.status,
      }))

  return (
    <section className="space-y-4">
      <CustomerProcessTimeline
        steps={timelineSteps}
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
            <article
              key={card.id}
              className={`rounded-2xl border p-4 ${customerStatusToneClass(card.tone)}`}
            >
              <div className="text-xs font-semibold uppercase tracking-[0.14em] opacity-80">
                {card.label}
              </div>
              <div className="mt-2 text-lg font-semibold">{card.value}</div>
              <p className="mt-2 text-xs leading-5 opacity-90">{card.description}</p>
            </article>
          ))}
        </div>

        {manualRequests.length > 0 ? (
          <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">
              Begäran till nätägare
            </p>
            <div className="mt-3 space-y-3">
              {manualRequests.map((request) => (
                <article
                  key={request.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-950">
                      {request.statusLabel}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                      {request.channelLabel}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                    <span>{poaStatusLabel(request.poaStatus)}</span>
                    {request.sentAt ? <span>Skickad: {manualRequestDate(request.sentAt)}</span> : null}
                    {request.caseReference ? <span>Ärendenummer: {request.caseReference}</span> : null}
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : null}

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

        {isPlatformAdmin && (workflow.canRunRepair || workflow.canContinueFinalization) ? (
          <div className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.16em]">
                Tekniska åtgärder
              </p>
              <h3 className="text-lg font-semibold">
                {workflow.canContinueFinalization
                  ? 'Fortsätt Z01-finalisering'
                  : 'Z01-reparation kan köras'}
              </h3>
              <p className="max-w-3xl leading-6">
                Ingen SMTP skickas direkt. Åtgärden går via server-side Z01-reparation/finalizer och den vanliga guarded send-pipelinen.
              </p>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <form action={dryRunZ01RepairAction}>
                <input type="hidden" name="company_id" value={hiddenValue(companyId)} />
                <input type="hidden" name="customer_id" value={customerId} />
                <input
                  type="hidden"
                  name="customer_info_request_id"
                  value={hiddenValue(workflow.technicalDetails.customerInfoRequestId)}
                />
                <input
                  type="hidden"
                  name="grid_owner_data_request_id"
                  value={hiddenValue(workflow.technicalDetails.gridOwnerDataRequestId)}
                />
                <input type="hidden" name="environment" value="production" />
                <button
                  type="submit"
                  className="rounded-2xl border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-100"
                >
                  Granska Z01-finalisering
                </button>
              </form>

              <form action={repairZ01CustomerInfoRequestAction}>
                <input type="hidden" name="company_id" value={hiddenValue(companyId)} />
                <input type="hidden" name="customer_id" value={customerId} />
                <input
                  type="hidden"
                  name="customer_info_request_id"
                  value={hiddenValue(workflow.technicalDetails.customerInfoRequestId)}
                />
                <input
                  type="hidden"
                  name="grid_owner_data_request_id"
                  value={hiddenValue(workflow.technicalDetails.gridOwnerDataRequestId)}
                />
                <input type="hidden" name="environment" value="production" />
                <button
                  type="submit"
                  className="rounded-2xl bg-amber-900 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800"
                >
                  Fortsätt Z01-finalisering
                </button>
              </form>
            </div>
          </div>
        ) : null}

        {isPlatformAdmin && z01RepairEvents.length > 0 ? (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-800">
            <p className="font-semibold text-slate-950">Senaste Z01-reparation</p>
            <ul className="mt-2 space-y-2">
              {z01RepairEvents.slice(0, 3).map((event) => (
                <li key={event.id} className="rounded-xl bg-white px-3 py-2">
                  <span className="font-medium">{z01EventLabel(event)}</span>
                  <span className="ml-2 text-slate-600">{repairEventSummary(event)}</span>
                  <span className="ml-2 text-slate-500">{z01EventDateLabel(event.created_at)}</span>
                  <span className="ml-2 text-slate-500">Ediel: {z01EventEdielMessageLabel(event)}</span>
                </li>
              ))}
            </ul>
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
