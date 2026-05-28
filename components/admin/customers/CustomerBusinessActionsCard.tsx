import {
  createCustomerDataRequestPackageAction,
  createGridOwnerDataRequestAction,
  createSupplierSwitchRequestAction,
  startAutomaticOnboardingAction,
} from '@/app/admin/customers/[id]/actions'
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
}

function siteLabel(site: CustomerSiteRow | null): string {
  if (!site) return 'Ingen anläggning vald'
  return `${site.site_name}${site.facility_id ? ` · ${site.facility_id}` : ' · saknar anläggnings-ID'}`
}

function pointLabel(point: MeteringPointRow | null): string {
  if (!point) return 'Ingen mätpunkt vald'
  return point.meter_point_id || point.id
}

export default function CustomerBusinessActionsCard({ customerId, sites, meteringPoints, powersOfAttorney = [], infoRequests = [] }: Props) {
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

  return (
    <section className="rounded-3xl border border-emerald-200 bg-emerald-50/60 p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Affärsåtgärder</p>
          <h2 className="mt-2 text-lg font-semibold text-slate-950">Starta rätt flöde utan tekniska val</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700">
            Knapparna använder kundens anläggning, mätpunkt, nätägare och route-regler i bakgrunden. Mail till nuvarande leverantör används bara för uppgiftsinhämtning, aldrig för att starta leverantörsbyte.
          </p>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-emerald-800">
          {siteLabel(primarySite)} · {pointLabel(primaryPoint)}
        </span>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-emerald-100 bg-white p-4 text-sm shadow-sm md:col-span-3">
          <div className="font-semibold text-slate-950">Snabb preflight</div>
          <div className="mt-3 grid gap-2 md:grid-cols-4">
            <div className={`rounded-xl px-3 py-2 ${primarySite ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>{primarySite ? 'Anläggning vald' : 'Saknar anläggning'}</div>
            <div className={`rounded-xl px-3 py-2 ${primaryPoint ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>{primaryPoint ? 'Mätpunkt vald' : 'Saknar mätpunkt'}</div>
            <div className={`rounded-xl px-3 py-2 ${gridOwnerId ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>{gridOwnerId ? 'Nätägare finns' : 'Saknar nätägare'}</div>
            <div className={`rounded-xl px-3 py-2 ${hasSignedPowerOfAttorney ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>{hasSignedPowerOfAttorney ? 'Signerad fullmakt finns' : 'Fullmakt saknas'}</div>
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-600">Preflighten används för att avgöra om systemet ska begära Z01 först, skapa Z03 direkt, blockera eller skapa uppföljningsuppgift.</p>
        </div>
        <form action={startAutomaticOnboardingAction} className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm">
          <input type="hidden" name="customer_id" value={customerId} />
          <input type="hidden" name="site_id" value={primarySite?.id ?? ''} />
          <div className="text-sm font-semibold text-slate-950">Starta automatisk onboarding</div>
          <p className="mt-1 min-h-12 text-sm leading-5 text-slate-700">Systemet väljer Z01 först om data saknas, annars Z03 när kunden är redo.</p>
          <div className="mt-4"><SubmitButton idleLabel="Starta onboarding" pendingLabel="Startar…" /></div>
        </form>

        <form action={createGridOwnerDataRequestAction} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <input type="hidden" name="customer_id" value={customerId} />
          <input type="hidden" name="site_id" value={primarySite?.id ?? ''} />
          <input type="hidden" name="metering_point_id" value={primaryPoint?.id ?? ''} />
          <input type="hidden" name="grid_owner_id" value={gridOwnerId} />
          <input type="hidden" name="request_scope" value="customer_masterdata" />
          <input type="hidden" name="business_action" value="request_customer_masterdata" />
          <input type="hidden" name="notes" value="Kundkort: begär kund-/anläggningsuppgifter via Z01 om route är redo." />
          <div className="text-sm font-semibold text-slate-950">Begär kund-/anläggningsuppgifter</div>
          <p className="mt-1 min-h-12 text-sm leading-5 text-slate-700">Förbereder Z01/Z02-spår mot nätägaren när fullmakt och route finns.</p>
          <div className="mt-4"><SubmitButton idleLabel="Begär uppgifter" pendingLabel="Skapar…" /></div>
        </form>

        <form action={createCustomerDataRequestPackageAction} className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 shadow-sm">
          <input type="hidden" name="customer_id" value={customerId} />
          <input type="hidden" name="site_id" value={primarySite?.id ?? ''} />
          <input type="hidden" name="metering_point_id" value={primaryPoint?.id ?? ''} />
          <input type="hidden" name="grid_owner_id" value={gridOwnerId} />
          <input type="hidden" name="request_target" value="current_supplier" />
          <input type="hidden" name="current_supplier_name" value={supplierName} />
          <input type="hidden" name="notes" value="Kundkort: begär kommersiella uppgifter från nuvarande leverantör. Detta får inte starta leverantörsbyte." />
          <div className="text-sm font-semibold text-slate-950">Begär uppgifter inför leverantörsbyte</div>
          <p className="mt-1 min-h-12 text-sm leading-5 text-slate-700">Skapar manuell uppföljning för bindningstid, uppsägning, brytavgift och slutdatum. Startar aldrig Z03.</p>
          {supplierInfoIsOpen ? <p className="mt-2 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-amber-800">Öppen uppföljning finns redan</p> : null}
          <div className="mt-4"><SubmitButton idleLabel="Begär leverantörssvar" pendingLabel="Skapar…" /></div>
        </form>

        <form action={createSupplierSwitchRequestAction} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <input type="hidden" name="customer_id" value={customerId} />
          <input type="hidden" name="site_id" value={primarySite?.id ?? ''} />
          <input type="hidden" name="request_type" value={primarySite?.move_in_date ? 'move_in' : 'switch'} />
          <input type="hidden" name="requested_start_date" value={defaultStartDate} />
          <div className="text-sm font-semibold text-slate-950">Starta leverantörsbyte</div>
          <p className="mt-1 min-h-12 text-sm leading-5 text-slate-700">Skapar Z03-flöde. Vanlig mailväg blockeras av route-beslutet.</p>
          <div className="mt-4"><SubmitButton idleLabel="Starta byte" pendingLabel="Kontrollerar…" /></div>
        </form>

        <form action={createGridOwnerDataRequestAction} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <input type="hidden" name="customer_id" value={customerId} />
          <input type="hidden" name="site_id" value={primarySite?.id ?? ''} />
          <input type="hidden" name="metering_point_id" value={primaryPoint?.id ?? ''} />
          <input type="hidden" name="grid_owner_id" value={gridOwnerId} />
          <input type="hidden" name="request_scope" value="metering_access" />
          <input type="hidden" name="business_action" value="request_metering_access" />
          <input type="hidden" name="notes" value="Kundkort: begär mätvärdesåtkomst via PRODAT Z13." />
          <div className="text-sm font-semibold text-slate-950">Begär mätvärdesåtkomst</div>
          <p className="mt-1 min-h-12 text-sm leading-5 text-slate-700">Använder metering_access och 23-DGI-PRODAT. Kräver nätägaravtal/fullmaktsreferens.</p>
          <div className="mt-4"><SubmitButton idleLabel="Begär åtkomst" pendingLabel="Kontrollerar…" /></div>
        </form>

        <form action={createGridOwnerDataRequestAction} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <input type="hidden" name="customer_id" value={customerId} />
          <input type="hidden" name="site_id" value={primarySite?.id ?? ''} />
          <input type="hidden" name="metering_point_id" value={primaryPoint?.id ?? ''} />
          <input type="hidden" name="grid_owner_id" value={gridOwnerId} />
          <input type="hidden" name="request_scope" value="meter_values" />
          <input type="hidden" name="business_action" value="request_meter_values" />
          <input type="hidden" name="notes" value="Kundkort: hämta mätvärden när aktiv leveransrelation eller godkänd mätvärdesåtkomst finns." />
          <div className="text-sm font-semibold text-slate-950">Hämta mätvärden</div>
          <p className="mt-1 min-h-12 text-sm leading-5 text-slate-700">Skapar mätvärdesbegäran mot rätt meter_values-route.</p>
          <div className="mt-4"><SubmitButton idleLabel="Hämta mätvärden" pendingLabel="Skapar…" /></div>
        </form>

        <form action={createGridOwnerDataRequestAction} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <input type="hidden" name="customer_id" value={customerId} />
          <input type="hidden" name="site_id" value={primarySite?.id ?? ''} />
          <input type="hidden" name="metering_point_id" value={primaryPoint?.id ?? ''} />
          <input type="hidden" name="grid_owner_id" value={gridOwnerId} />
          <input type="hidden" name="request_scope" value="metering_access" />
          <input type="hidden" name="business_action" value="terminate_metering_access" />
          <input type="hidden" name="notes" value="Kundkort: avsluta mätvärdesåtkomst via PRODAT Z18 när aktivt tillstånd finns." />
          <div className="text-sm font-semibold text-slate-950">Avsluta mätvärdesåtkomst</div>
          <p className="mt-1 min-h-12 text-sm leading-5 text-slate-700">Använder samma metering_access-spår men med Z18-beslut i route/preflight.</p>
          <div className="mt-4"><SubmitButton idleLabel="Avsluta åtkomst" pendingLabel="Kontrollerar…" /></div>
        </form>
      </div>
    </section>
  )
}
