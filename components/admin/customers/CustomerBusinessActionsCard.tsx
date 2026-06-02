import {
  createCustomerDataRequestPackageAction,
  createGridOwnerDataRequestAction,
  createSupplierSwitchRequestAction,
  registerCustomerLifecycleDecisionAction,
  startAutomaticOnboardingAction,
} from '@/app/admin/customers/[id]/actions'
import { sendCustomerConfirmationBusinessAction } from '@/app/admin/customers/[id]/business-actions'
import { missingBusinessDataMessage } from '@/lib/ediel/statusUi'
import type { CustomerContractRow } from '@/lib/customer-contracts/types'
import type { CustomerSiteRow, MeteringPointRow } from '@/lib/masterdata/types'
import type { PowerOfAttorneyRow } from '@/lib/operations/types'
import type { CustomerInfoRequestRow } from '@/lib/onboarding/infoRequests'
import SubmitButton from '@/components/admin/customers/document-card/SubmitButton'

type Props = {
  customerId: string
  sites: CustomerSiteRow[]
  meteringPoints: MeteringPointRow[]
  powersOfAttorney?: PowerOfAttorneyRow[]
  infoRequests?: CustomerInfoRequestRow[]
  contracts?: CustomerContractRow[]
}

function siteLabel(site: CustomerSiteRow | null): string {
  if (!site) return 'Ingen anläggning vald'
  return `${site.site_name}${site.facility_id ? ` · ${site.facility_id}` : ' · saknar anläggnings-ID'}`
}

function pointLabel(point: MeteringPointRow | null): string {
  if (!point) return 'Ingen mätpunkt vald'
  return point.meter_point_id || point.id
}

function ActionShell({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-sm font-semibold text-slate-950">{title}</div>
      <p className="mt-1 min-h-12 text-sm leading-5 text-slate-700">{text}</p>
      {children}
    </div>
  )
}

export default function CustomerBusinessActionsCard({
  customerId,
  sites,
  meteringPoints,
  powersOfAttorney = [],
  infoRequests = [],
  contracts = [],
}: Props) {
  const primarySite = sites.find((site) => site.status === 'active') ?? sites[0] ?? null
  const primaryPoint = primarySite
    ? meteringPoints.find((point) => point.site_id === primarySite.id && point.status === 'active') ??
      meteringPoints.find((point) => point.site_id === primarySite.id) ??
      null
    : meteringPoints[0] ?? null
  const gridOwnerId = primaryPoint?.grid_owner_id ?? primarySite?.grid_owner_id ?? ''
  const defaultStartDate = primarySite?.move_in_date ?? ''
  const hasSignedPowerOfAttorney = powersOfAttorney.some((row) => row.status === 'signed')
  const supplierInfoIsOpen = infoRequests.some((row) => row.target_party_type === 'current_supplier' && !['completed', 'cancelled', 'rejected'].includes(row.status))
  const supplierName = primarySite?.current_supplier_name ?? ''
  const activeContract = contracts.find((contract) => ['active', 'signed', 'pending_signature'].includes(String(contract.status ?? ''))) ?? contracts[0] ?? null
  const missingBusinessData = [primaryPoint ? null : 'Anläggnings-id', gridOwnerId ? null : 'Nätägare'].filter((value): value is string => Boolean(value))

  return (
    <section className="rounded-3xl border border-emerald-200 bg-emerald-50/60 p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Affärsåtgärder</p>
          <h2 className="mt-2 text-lg font-semibold text-slate-950">Starta rätt flöde utan tekniska val</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700">
            Knapparna använder kundens anläggning, mätpunkt, nätägare och behörigheter i bakgrunden. Handläggaren väljer affärsåtgärd; backend väljer rätt marknadsprocess.
          </p>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-emerald-800">
          {siteLabel(primarySite)} · {pointLabel(primaryPoint)}
        </span>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-emerald-100 bg-white p-4 text-sm shadow-sm md:col-span-4">
          <div className="font-semibold text-slate-950">Snabb preflight</div>
          <div className="mt-3 grid gap-2 md:grid-cols-4">
            <div className={`rounded-xl px-3 py-2 ${primarySite ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>{primarySite ? 'Anläggning vald' : 'Saknar anläggning'}</div>
            <div className={`rounded-xl px-3 py-2 ${primaryPoint ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>{primaryPoint ? 'Mätpunkt vald' : 'Saknar mätpunkt'}</div>
            <div className={`rounded-xl px-3 py-2 ${gridOwnerId ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>{gridOwnerId ? 'Nätägare finns' : 'Saknar nätägare'}</div>
            <div className={`rounded-xl px-3 py-2 ${hasSignedPowerOfAttorney ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>{hasSignedPowerOfAttorney ? 'Signerad fullmakt finns' : 'Fullmakt saknas'}</div>
          </div>
          {missingBusinessData.length > 0 ? (
            <pre className="mt-3 whitespace-pre-wrap rounded-2xl border border-red-200 bg-red-50 p-3 text-xs font-semibold leading-5 text-red-900">{missingBusinessDataMessage(missingBusinessData)}</pre>
          ) : (
            <p className="mt-3 text-xs leading-5 text-slate-600">Preflighten avgör om systemet kan starta åtgärden direkt, behöver komplettera kunddata eller ska skapa en uppföljningsuppgift.</p>
          )}
        </div>

        <ActionShell title="Starta automatisk onboarding" text="Systemet samlar in saknade uppgifter först och startar leverantörsbyte när kunden är redo.">
          <form action={startAutomaticOnboardingAction} className="mt-4">
            <input type="hidden" name="customer_id" value={customerId} />
            <input type="hidden" name="site_id" value={primarySite?.id ?? ''} />
            <SubmitButton idleLabel="Starta onboarding" pendingLabel="Startar…" />
          </form>
        </ActionShell>

        <ActionShell title="Starta leverantörsbyte" text="Startar leverantörsbyte. Backend sköter marknadsmeddelande, kö och kvittenser.">
          <form action={createSupplierSwitchRequestAction} className="mt-4">
            <input type="hidden" name="customer_id" value={customerId} />
            <input type="hidden" name="site_id" value={primarySite?.id ?? ''} />
            <input type="hidden" name="request_type" value={primarySite?.move_in_date ? 'move_in' : 'switch'} />
            <input type="hidden" name="requested_start_date" value={defaultStartDate} />
            <SubmitButton idleLabel="Starta byte" pendingLabel="Kontrollerar…" />
          </form>
        </ActionShell>

        <ActionShell title="Registrera ånger" text="Stoppar kundflödet internt och låter backend avgöra om avslut eller manuell uppgift behövs.">
          <form action={registerCustomerLifecycleDecisionAction} className="mt-4">
            <input type="hidden" name="customer_id" value={customerId} />
            <input type="hidden" name="decision_type" value="withdrawal" />
            <input type="hidden" name="scope_type" value="customer" />
            <input type="hidden" name="reason" value="Kunden har registrerat ånger från kundkortets affärsåtgärder." />
            <SubmitButton idleLabel="Registrera ånger" pendingLabel="Registrerar…" />
          </form>
        </ActionShell>

        <ActionShell title="Avsluta avtal" text="Påbörjar avslut och loggar händelsen på kundkortet. Backend avgör om marknadsmeddelande behövs.">
          <form action={registerCustomerLifecycleDecisionAction} className="mt-4">
            <input type="hidden" name="customer_id" value={customerId} />
            <input type="hidden" name="decision_type" value="withdrawal" />
            <input type="hidden" name="scope_type" value={activeContract ? 'contract' : 'customer'} />
            <input type="hidden" name="scope_id" value={activeContract?.id ?? ''} />
            <input type="hidden" name="reason" value="Avslut av avtal påbörjat från kundkortets affärsåtgärder." />
            <SubmitButton idleLabel="Avsluta avtal" pendingLabel="Startar avslut…" />
          </form>
        </ActionShell>

        <ActionShell title="Begär kund-/anläggningsuppgifter" text="Begär kund- och anläggningsuppgifter från rätt nätägare när fullmakt och kontaktväg finns.">
          <form action={createGridOwnerDataRequestAction} className="mt-4">
            <input type="hidden" name="customer_id" value={customerId} />
            <input type="hidden" name="site_id" value={primarySite?.id ?? ''} />
            <input type="hidden" name="metering_point_id" value={primaryPoint?.id ?? ''} />
            <input type="hidden" name="grid_owner_id" value={gridOwnerId} />
            <input type="hidden" name="request_scope" value="customer_masterdata" />
            <input type="hidden" name="business_action" value="request_customer_masterdata" />
            <input type="hidden" name="notes" value="Kundkort: begär kund-/anläggningsuppgifter om underlag saknas." />
            <SubmitButton idleLabel="Begär uppgifter" pendingLabel="Skapar…" />
          </form>
        </ActionShell>

        <ActionShell title="Begär uppgifter inför leverantörsbyte" text="Skapar uppföljning för bindningstid, uppsägning, brytavgift och slutdatum. Startar aldrig leverantörsbyte.">
          <form action={createCustomerDataRequestPackageAction} className="mt-4">
            <input type="hidden" name="customer_id" value={customerId} />
            <input type="hidden" name="site_id" value={primarySite?.id ?? ''} />
            <input type="hidden" name="metering_point_id" value={primaryPoint?.id ?? ''} />
            <input type="hidden" name="grid_owner_id" value={gridOwnerId} />
            <input type="hidden" name="request_target" value="current_supplier" />
            <input type="hidden" name="current_supplier_name" value={supplierName} />
            <input type="hidden" name="notes" value="Kundkort: begär kommersiella uppgifter från nuvarande leverantör." />
            {supplierInfoIsOpen ? <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">Öppen uppföljning finns redan</p> : null}
            <SubmitButton idleLabel="Begär leverantörssvar" pendingLabel="Skapar…" />
          </form>
        </ActionShell>

        <ActionShell title="Begär mätvärdesåtkomst" text="Begär mätvärdesåtkomst hos nätägaren. Kräver avtal/fullmakt och komplett anläggningsdata.">
          <form action={createGridOwnerDataRequestAction} className="mt-4">
            <input type="hidden" name="customer_id" value={customerId} />
            <input type="hidden" name="site_id" value={primarySite?.id ?? ''} />
            <input type="hidden" name="metering_point_id" value={primaryPoint?.id ?? ''} />
            <input type="hidden" name="grid_owner_id" value={gridOwnerId} />
            <input type="hidden" name="request_scope" value="metering_access" />
            <input type="hidden" name="business_action" value="request_metering_access" />
            <input type="hidden" name="notes" value="Kundkort: begär mätvärdesåtkomst." />
            <SubmitButton idleLabel="Begär åtkomst" pendingLabel="Kontrollerar…" />
          </form>
        </ActionShell>

        <ActionShell title="Hämta mätvärden" text="Skapar mätvärdesbegäran mot rätt nätägare när aktiv relation eller åtkomst finns.">
          <form action={createGridOwnerDataRequestAction} className="mt-4">
            <input type="hidden" name="customer_id" value={customerId} />
            <input type="hidden" name="site_id" value={primarySite?.id ?? ''} />
            <input type="hidden" name="metering_point_id" value={primaryPoint?.id ?? ''} />
            <input type="hidden" name="grid_owner_id" value={gridOwnerId} />
            <input type="hidden" name="request_scope" value="meter_values" />
            <input type="hidden" name="business_action" value="request_meter_values" />
            <input type="hidden" name="notes" value="Kundkort: hämta mätvärden." />
            <SubmitButton idleLabel="Hämta mätvärden" pendingLabel="Skapar…" />
          </form>
        </ActionShell>

        <ActionShell title="Begär historiska mätvärden" text="Kräver avslutad period senast igår och högst tre år bakåt.">
          <form action={createGridOwnerDataRequestAction} className="mt-4">
            <input type="hidden" name="customer_id" value={customerId} />
            <input type="hidden" name="site_id" value={primarySite?.id ?? ''} />
            <input type="hidden" name="metering_point_id" value={primaryPoint?.id ?? ''} />
            <input type="hidden" name="grid_owner_id" value={gridOwnerId} />
            <input type="hidden" name="request_scope" value="meter_values" />
            <input type="hidden" name="business_action" value="request_historical_metering_access" />
            <input type="hidden" name="notes" value="Kundkort: begär historiska mätvärden." />
            <div className="mb-4 grid gap-2">
              <label className="text-xs font-semibold text-slate-700">Startdatum
                <input className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" type="date" name="requested_period_start" required />
              </label>
              <label className="text-xs font-semibold text-slate-700">Slutdatum
                <input className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" type="date" name="requested_period_end" required />
              </label>
            </div>
            <SubmitButton idleLabel="Begär historik" pendingLabel="Kontrollerar…" />
          </form>
        </ActionShell>

        <ActionShell title="Avsluta mätvärdesåtkomst" text="Avslutar kundens mätvärdestillgång och väntar på bekräftelse från nätägaren.">
          <form action={createGridOwnerDataRequestAction} className="mt-4">
            <input type="hidden" name="customer_id" value={customerId} />
            <input type="hidden" name="site_id" value={primarySite?.id ?? ''} />
            <input type="hidden" name="metering_point_id" value={primaryPoint?.id ?? ''} />
            <input type="hidden" name="grid_owner_id" value={gridOwnerId} />
            <input type="hidden" name="request_scope" value="metering_access" />
            <input type="hidden" name="business_action" value="terminate_metering_access" />
            <input type="hidden" name="notes" value="Kundkort: avsluta mätvärdesåtkomst." />
            <SubmitButton idleLabel="Avsluta åtkomst" pendingLabel="Kontrollerar…" />
          </form>
        </ActionShell>

        <ActionShell title="Skicka bekräftelsemail" text="Köar kundkommunikation via bolagets mall och avsändarprofil. Marknadsmeddelanden påverkas inte av kundmail.">
          <form action={sendCustomerConfirmationBusinessAction} className="mt-4">
            <input type="hidden" name="customer_id" value={customerId} />
            <input type="hidden" name="event" value="supplier_switch_started" />
            <SubmitButton idleLabel="Skicka bekräftelse" pendingLabel="Köar…" />
          </form>
        </ActionShell>
      </div>
    </section>
  )
}
