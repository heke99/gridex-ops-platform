import {
  createGridOwnerDataRequestAction,
  createSupplierSwitchRequestAction,
  startAutomaticOnboardingAction,
} from '@/app/admin/customers/[id]/actions'
import {
  endAgreementBusinessAction,
  registerCancellationBusinessAction,
  requestHistoricalMeteringAccessBusinessAction,
  requestMeteringAccessBusinessAction,
  sendCustomerConfirmationBusinessAction,
  terminateMeteringAccessBusinessAction,
} from '@/app/admin/customers/[id]/business-actions'
import type { CustomerContractRow } from '@/lib/customer-contracts/types'
import type { CustomerSiteRow, MeteringPointRow } from '@/lib/masterdata/types'
import type { CustomerAuthorizationDocumentRow, PowerOfAttorneyRow, SupplierSwitchRequestRow } from '@/lib/operations/types'
import type { CustomerInfoRequestRow } from '@/lib/onboarding/infoRequests'
import SubmitButton from '@/components/admin/customers/document-card/SubmitButton'
import { buildCustomerCardSnapshot } from '@/lib/customers/customerCardSnapshot'

type Props = {
  customerId: string
  sites: CustomerSiteRow[]
  meteringPoints: MeteringPointRow[]
  powersOfAttorney?: PowerOfAttorneyRow[]
  documents?: CustomerAuthorizationDocumentRow[]
  infoRequests?: CustomerInfoRequestRow[]
  contracts?: CustomerContractRow[]
  switchRequests?: SupplierSwitchRequestRow[]
}

function siteLabel(site: CustomerSiteRow | null): string {
  if (!site) return 'Ingen anläggning vald'
  return `${site.site_name}${site.facility_id ? ` · ${site.facility_id}` : ' · saknar anläggnings-ID'}`
}

function pointLabel(point: MeteringPointRow | null): string {
  if (!point) return 'Ingen mätpunkt vald'
  return point.meter_point_id || point.id
}

function StatusPill({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${ok ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>
      {children}
    </span>
  )
}

function PrimaryAction({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-emerald-200 bg-white p-5 shadow-sm">
      <h3 className="text-base font-semibold text-slate-950">{title}</h3>
      <p className="mt-2 min-h-12 text-sm leading-6 text-slate-700">{text}</p>
      <div className="mt-4">{children}</div>
    </div>
  )
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
}: Props) {
  const snapshot = buildCustomerCardSnapshot({ sites, meteringPoints, powersOfAttorney, documents, infoRequests, contracts })
  const primarySite = snapshot.primarySite
  const primaryPoint = snapshot.primaryMeteringPoint
  const gridOwnerId = primaryPoint?.grid_owner_id ?? primarySite?.grid_owner_id ?? ''
  const defaultStartDate = primarySite?.move_in_date ?? ''
  const hasSignedPowerOfAttorney = snapshot.hasAuthorization
  const activeContract = contracts.find((contract) => ['active', 'signed', 'pending_signature'].includes(String(contract.status ?? ''))) ?? contracts[0] ?? null
  const activeSwitchRequest =
    switchRequests.find((request) =>
      request.site_id === primarySite?.id &&
      ['queued', 'validated', 'ready_to_send', 'submitted', 'waiting_response', 'cancellation_requested'].includes(String(request.status ?? ''))
    ) ??
    switchRequests.find((request) => ['queued', 'validated', 'ready_to_send', 'submitted', 'waiting_response'].includes(String(request.status ?? ''))) ??
    switchRequests[0] ??
    null
  const blockers = snapshot.switchBlockerLabels
  const openInfoRequest = infoRequests.find((row) => !['completed', 'cancelled', 'rejected'].includes(row.status))
  const recommendedAction = activeSwitchRequest ? 'Följ pågående leverantörsbyte' : snapshot.nextStepLabel
  const businessActionId = `${customerId}:${primarySite?.id ?? 'no-site'}:${primaryPoint?.id ?? 'no-meter'}`

  const renderBusinessActionHiddenFields = (action: string) => (
    <>
      <input type="hidden" name="customer_id" value={customerId} />
      <input type="hidden" name="site_id" value={primarySite?.id ?? ''} />
      <input type="hidden" name="metering_point_id" value={primaryPoint?.id ?? ''} />
      <input type="hidden" name="switch_request_id" value={activeSwitchRequest?.id ?? ''} />
      <input type="hidden" name="idempotency_key" value={`${action}:${businessActionId}:${activeSwitchRequest?.id ?? 'no-switch'}`} />
    </>
  )

  const missingSwitchRequestNotice = activeSwitchRequest ? null : (
    <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
      Skapa eller välj leverantörsbyte först så åtgärden kan kopplas rätt.
    </p>
  )

  return (
    <section className="rounded-3xl border border-emerald-200 bg-emerald-50/60 p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Kundens nästa steg</p>
          <h2 className="mt-2 text-lg font-semibold text-slate-950">Begär uppgifter eller begär leverantörsbyte</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700">
            Handläggaren väljer vad som ska hända. Systemet kontrollerar fullmakt, anläggning, mätpunkt, nätägare, juridiskt underlag, mail och teknisk sändning i bakgrunden.
          </p>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-emerald-800">
          {siteLabel(primarySite)} · {pointLabel(primaryPoint)}
        </span>
      </div>

      <div className="mt-5 rounded-3xl border border-emerald-100 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-950">Nästa rekommenderade steg</div>
            <p className="mt-1 text-sm text-slate-700">{recommendedAction}</p>
            <p className="mt-1 text-xs font-medium text-slate-600">{snapshot.nextStepDescription}</p>
          </div>
          {openInfoRequest ? <StatusPill ok>Uppgiftsbegäran finns</StatusPill> : null}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <StatusPill ok={hasSignedPowerOfAttorney}>{hasSignedPowerOfAttorney ? 'Fullmakt finns' : 'Fullmakt saknas'}</StatusPill>
          <StatusPill ok={snapshot.hasFacilityId}>{snapshot.hasFacilityId ? 'Anläggnings-ID finns' : 'Anläggnings-ID saknas'}</StatusPill>
          <StatusPill ok={snapshot.hasMeteringPoint}>{snapshot.hasMeteringPoint ? 'Mätpunkt finns' : 'Mätpunkt saknas'}</StatusPill>
          <StatusPill ok={snapshot.hasGridOwner}>{snapshot.hasGridOwner ? 'Nätägare finns' : 'Nätägare saknas'}</StatusPill>
        </div>
        {blockers.length > 0 ? (
          <p className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
            Leverantörsbyte kan inte startas ännu. Saknas: {blockers.join(', ')}.
          </p>
        ) : (
          <p className="mt-4 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900">
            Kunden ser redo ut för nästa kontroll. Systemet gör slutkontrollen innan något skickas.
          </p>
        )}
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <PrimaryAction title="Begär uppgifter" text="Systemet begär eller förbereder saknade uppgifter, försöker hitta nätägare automatiskt och skapar tydlig uppgift om granskning behövs.">
          <form action={startAutomaticOnboardingAction}>
            <input type="hidden" name="customer_id" value={customerId} />
            <input type="hidden" name="site_id" value={primarySite?.id ?? ''} />
            <SubmitButton idleLabel="Begär uppgifter" pendingLabel="Kontrollerar…" />
          </form>
        </PrimaryAction>

        <PrimaryAction title="Begär leverantörsbyte" text="Systemet kontrollerar fullmakt, avtal, mätpunkt, nätägare, juridiskt underlag och kontaktväg innan leverantörsbyte startas.">
          <form action={createSupplierSwitchRequestAction}>
            <input type="hidden" name="customer_id" value={customerId} />
            <input type="hidden" name="site_id" value={primarySite?.id ?? ''} />
            <input type="hidden" name="request_type" value={primarySite?.move_in_date ? 'move_in' : 'switch'} />
            <input type="hidden" name="requested_start_date" value={defaultStartDate} />
            <SubmitButton idleLabel="Begär leverantörsbyte" pendingLabel="Kontrollerar…" />
          </form>
        </PrimaryAction>
      </div>

      <details className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <summary className="cursor-pointer font-semibold text-slate-900">Fler åtgärder</summary>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <form action={sendCustomerConfirmationBusinessAction} className="rounded-2xl border border-slate-200 p-4">
            {renderBusinessActionHiddenFields('send_confirmation')}
            <SubmitButton idleLabel="Skicka bekräftelsemail" pendingLabel="Skickar…" />
          </form>
          <form action={registerCancellationBusinessAction} className="rounded-2xl border border-slate-200 p-4">
            {renderBusinessActionHiddenFields('register_cancellation')}
            <input type="hidden" name="reason" value="Kunden har registrerat ånger från kundkortet." />
            {missingSwitchRequestNotice}
            <SubmitButton idleLabel="Registrera ånger" pendingLabel="Registrerar…" />
          </form>
          <form action={endAgreementBusinessAction} className="rounded-2xl border border-slate-200 p-4">
            {renderBusinessActionHiddenFields(`end_agreement:${activeContract?.id ?? 'customer'}`)}
            <input type="hidden" name="reason" value="Avslut av avtal påbörjat från kundkortet." />
            {missingSwitchRequestNotice}
            <SubmitButton idleLabel="Avsluta avtal" pendingLabel="Startar…" />
          </form>
          <form action={createGridOwnerDataRequestAction} className="rounded-2xl border border-slate-200 p-4">
            <input type="hidden" name="customer_id" value={customerId} />
            <input type="hidden" name="site_id" value={primarySite?.id ?? ''} />
            <input type="hidden" name="metering_point_id" value={primaryPoint?.id ?? ''} />
            <input type="hidden" name="grid_owner_id" value={gridOwnerId} />
            <input type="hidden" name="request_scope" value="customer_masterdata" />
            <SubmitButton idleLabel="Begär anläggningsuppgifter" pendingLabel="Skapar…" />
          </form>
          <form action={requestMeteringAccessBusinessAction} className="rounded-2xl border border-slate-200 p-4">
            {renderBusinessActionHiddenFields('request_metering_access')}
            <SubmitButton idleLabel="Begär mätvärdesåtkomst" pendingLabel="Begär…" />
          </form>
          <form action={requestHistoricalMeteringAccessBusinessAction} className="rounded-2xl border border-slate-200 p-4">
            {renderBusinessActionHiddenFields('request_historical_metering_access')}
            <SubmitButton idleLabel="Hämta mätvärden" pendingLabel="Kontrollerar…" />
          </form>
          <form action={terminateMeteringAccessBusinessAction} className="rounded-2xl border border-slate-200 p-4">
            {renderBusinessActionHiddenFields('terminate_metering_access')}
            <SubmitButton idleLabel="Avsluta mätvärdesåtkomst" pendingLabel="Avslutar…" />
          </form>
        </div>
      </details>
    </section>
  )
}
