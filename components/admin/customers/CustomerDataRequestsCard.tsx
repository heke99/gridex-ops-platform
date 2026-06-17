import {
  createCustomerDataRequestPackageAction,
  registerCurrentSupplierResponseAction,
} from '@/app/admin/customers/[id]/actions'
import type { CustomerSiteRow, MeteringPointRow } from '@/lib/masterdata/types'
import type { CustomerInfoRequestRow } from '@/lib/onboarding/infoRequests'
import type { PowerOfAttorneyRow, CustomerAuthorizationDocumentRow } from '@/lib/operations/types'
import type { GridOwnerRow } from '@/lib/masterdata/types'
import SubmitButton from '@/components/admin/customers/document-card/SubmitButton'

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function simpleRequestLabel(value: string): string {
  switch (value) {
    case 'z01_customer_masterdata':
      return 'Nätägare'
    case 'current_supplier_contract_info':
      return 'Nuvarande leverantör'
    default:
      return value
  }
}

function simpleStatus(value: string): { label: string; className: string; description: string } {
  switch (value) {
    case 'draft':
      return { label: 'Utkast', className: 'bg-slate-100 text-slate-700', description: 'Sparad men inte redo.' }
    case 'ready_to_send':
    case 'z01_prepared':
      return { label: 'Redo att skickas', className: 'bg-emerald-100 text-emerald-700', description: 'Systemet har förberett begäran.' }
    case 'sent':
    case 'sent_to_grid_owner':
      return { label: 'Skickad', className: 'bg-emerald-100 text-emerald-700', description: 'Begäran är skickad eller köad i utskick.' }
    case 'waiting_for_contrl':
    case 'waiting_for_aperak':
    case 'waiting_for_z02':
    case 'kräver granskning':
      return { label: 'Väntar på svar', className: 'bg-amber-100 text-amber-700', description: 'Följ upp när svar kommer.' }
    case 'z02_received':
    case 'completed':
      return { label: 'Svar mottaget', className: 'bg-emerald-100 text-emerald-700', description: 'Uppgifter finns eller är klara.' }
    case 'negative_aperak':
    case 'rejected':
      return { label: 'Nekad', className: 'bg-red-100 text-red-700', description: 'Begäran behöver rättas eller följas upp.' }
    case 'missing_authorization':
      return { label: 'Saknar fullmakt', className: 'bg-red-100 text-red-700', description: 'Signerad fullmakt krävs innan utskick.' }
    case 'kontaktväg_missing':
      return { label: 'Saknar kontaktväg', className: 'bg-red-100 text-red-700', description: 'Mottagare/teknisk sändning-kontaktväg saknas.' }
    case 'cancelled':
      return { label: 'Avbruten', className: 'bg-slate-200 text-slate-700', description: 'Begäran är stoppad.' }
    default:
      return { label: value, className: 'bg-slate-100 text-slate-700', description: 'Status från systemet.' }
  }
}

function findSiteName(sites: CustomerSiteRow[], siteId: string | null): string {
  if (!siteId) return 'Kundnivå'
  return sites.find((site) => site.id === siteId)?.site_name ?? 'Anläggning'
}

function signedPoaLabel(row: PowerOfAttorneyRow): string {
  return [row.reference, row.site_id ? 'anläggningsnivå' : 'kundnivå', row.valid_to ? `giltig till ${row.valid_to}` : null]
    .filter(Boolean)
    .join(' · ') || row.id
}

export default function CustomerDataRequestsCard({
  customerId,
  sites,
  meteringPoints,
  gridOwners,
  infoRequests,
  powersOfAttorney,
  documents,
}: {
  customerId: string
  sites: CustomerSiteRow[]
  meteringPoints: MeteringPointRow[]
  gridOwners: GridOwnerRow[]
  infoRequests: CustomerInfoRequestRow[]
  powersOfAttorney: PowerOfAttorneyRow[]
  documents: CustomerAuthorizationDocumentRow[]
}) {
  const signedPowers = powersOfAttorney.filter((row) => row.status === 'signed')
  const activePowerDocuments = documents.filter((row) => row.document_type === 'power_of_attorney' && row.status !== 'archived')
  const currentSupplierRequests = infoRequests.filter((request) =>
    request.target_party_type === 'current_supplier' || request.request_type === 'current_supplier_contract_info'
  )
  const defaultCurrentSupplierRequest = currentSupplierRequests.find((request) => !['completed', 'cancelled', 'rejected'].includes(request.status)) ?? currentSupplierRequests[0] ?? null
  const defaultSite = sites.find((site) => site.status === 'active') ?? sites[0] ?? null

  return (
    <section className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Begär uppgifter</h2>
            <p className="mt-1 text-sm leading-6 text-slate-700">
              Välj vad handläggaren behöver. Systemet använder rätt flöde i bakgrunden: nätägare kontaktas automatiskt när kontaktväg finns, nuvarande leverantör blir ett manuellt uppföljningsärende.
            </p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${signedPowers.length ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
            {signedPowers.length ? 'Fullmakt finns' : 'Fullmakt saknas'}
          </span>
        </div>

        <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          <div className="font-semibold text-slate-900">Regel</div>
          <p className="mt-1">
            Kunden får finnas sparad även om data saknas. Men uppgiftsbegäran stoppas om signerad fullmakt saknas.
          </p>
        </div>

        <form action={createCustomerDataRequestPackageAction} className="mt-6 space-y-4">
          <input type="hidden" name="customer_id" value={customerId} />

          <label className="grid gap-1 text-sm">
            <span className="font-medium text-slate-700">Vad vill du begära?</span>
            <select name="request_target" defaultValue="both" className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900">
              <option value="grid_owner">Från nätägare</option>
              <option value="current_supplier">Från nuvarande leverantör</option>
              <option value="both">Från båda</option>
            </select>
          </label>

          <label className="grid gap-1 text-sm">
            <span className="font-medium text-slate-700">Signerad fullmakt</span>
            <select name="power_of_attorney_id" defaultValue={signedPowers[0]?.id ?? ''} className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900">
              <option value="">Välj automatiskt senaste signerade fullmakt</option>
              {signedPowers.map((row) => (
                <option key={row.id} value={row.id}>{signedPoaLabel(row)}</option>
              ))}
            </select>
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-slate-700">Anläggning</span>
              <select name="site_id" defaultValue={sites[0]?.id ?? ''} className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900">
                <option value="">Välj anläggning</option>
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>{site.site_name} · {site.facility_id ?? 'saknar anläggnings-id'}</option>
                ))}
              </select>
            </label>

            <label className="grid gap-1 text-sm">
              <span className="font-medium text-slate-700">Mätpunkt</span>
              <select name="mätpunkt" defaultValue={meteringPoints[0]?.id ?? ''} className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900">
                <option value="">Välj mätpunkt om den finns</option>
                {meteringPoints.map((point) => (
                  <option key={point.id} value={point.id}>{point.meter_point_id || point.id}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-slate-700">Nätägare</span>
              <select name="nätägare" defaultValue="" className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900">
                <option value="">Använd anläggningens nätägare</option>
                {gridOwners.map((owner) => (
                  <option key={owner.id} value={owner.id}>{owner.name}</option>
                ))}
              </select>
            </label>

            <label className="grid gap-1 text-sm">
              <span className="font-medium text-slate-700">Nuvarande leverantör</span>
              <input name="current_supplier_name" placeholder="Fyll i om känt" className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900" />
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-slate-700">Period från</span>
              <input name="requested_period_start" type="date" className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900" />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-slate-700">Period till</span>
              <input name="requested_period_end" type="date" className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900" />
            </label>
          </div>

          <label className="grid gap-1 text-sm">
            <span className="font-medium text-slate-700">Referens / anteckning</span>
            <input name="external_reference" placeholder="Valfri intern referens" className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900" />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="font-medium text-slate-700">Meddelande till handläggning</span>
            <textarea name="notes" rows={4} placeholder="T.ex. kunden saknar anläggnings-id och vill byta leverantör." className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900" />
          </label>

          <SubmitButton idleLabel="Begär uppgifter" pendingLabel="Skapar begäran..." />
        </form>
      </div>

      <div className="space-y-6">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-semibold text-slate-900">Fullmakter på kunden</h3>
          <p className="mt-1 text-sm text-slate-700">Signerad fullmakt låser upp uppgiftsbegäran. Osignerade dokument visas som underlag men stoppar utskick.</p>
          <div className="mt-4 grid gap-3">
            {signedPowers.length === 0 && activePowerDocuments.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-700">Ingen fullmakt finns ännu.</div>
            ) : null}
            {signedPowers.map((row) => (
              <div key={row.id} className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                <div className="font-semibold">Signerad fullmakt</div>
                <div className="mt-1">{signedPoaLabel(row)}</div>
                <div className="mt-1 text-xs">Signerad: {formatDateTime(row.signed_at)}</div>
              </div>
            ))}
            {activePowerDocuments.filter((doc) => !doc.power_of_attorney_id).map((doc) => (
              <div key={doc.id} className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <div className="font-semibold">Fullmaktsdokument behöver verifieras</div>
                <div className="mt-1">{doc.title ?? doc.file_name ?? doc.id}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-amber-200 bg-amber-50/60 p-6 shadow-sm">
          <h3 className="text-base font-semibold text-slate-900">Registrera leverantörssvar</h3>
          <p className="mt-1 text-sm leading-6 text-slate-700">Spara bindningstid, brytavgift och rekommenderat bytesdatum. Svaret uppdaterar kundens preflight och får aldrig skapa ett leverantörsbyte.</p>
          <form action={registerCurrentSupplierResponseAction} className="mt-4 space-y-4">
            <input type="hidden" name="customer_id" value={customerId} />
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-slate-700">Anläggning</span>
              <select name="site_id" defaultValue={defaultSite?.id ?? ''} className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900">
                <option value="">Välj anläggning</option>
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>{site.site_name} · {site.facility_id ?? 'saknar anläggnings-id'}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-slate-700">Koppla till uppgiftsbegäran</span>
              <select name="customer_info_request_id" defaultValue={defaultCurrentSupplierRequest?.id ?? ''} className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900">
                <option value="">Ingen / manuell registrering</option>
                {currentSupplierRequests.map((request) => (
                  <option key={request.id} value={request.id}>{simpleRequestLabel(request.request_type)} · {simpleStatus(request.status).label} · {formatDateTime(request.created_at)}</option>
                ))}
              </select>
            </label>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-slate-700">Svar från leverantör</span>
                <select name="response_status" defaultValue="free_to_switch" className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900">
                  <option value="free_to_switch">Kunden kan byta</option>
                  <option value="binding_period">Bindningstid finns</option>
                  <option value="termination_fee">Brytavgift finns</option>
                  <option value="blocked">Leverantören avråder/blockerar</option>
                  <option value="waiting_response">Väntar svar</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-slate-700">Bindning/slutdatum</span>
                <input name="contract_end_date" type="date" className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900" />
              </label>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-slate-700">Uppsägningstid</span>
                <input name="notice_period" placeholder="T.ex. 1 månad" className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900" />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-slate-700">Brytavgift</span>
                <input name="termination_fee" type="number" step="0.01" placeholder="0" className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900" />
              </label>
            </div>
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-slate-700">Rekommenderat bytesdatum</span>
              <input name="recommended_switch_date" type="date" className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900" />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-slate-700">Kommentar</span>
              <textarea name="response_notes" rows={3} className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900" placeholder="Sammanfatta svaret från leverantören." />
            </label>
            <SubmitButton idleLabel="Spara leverantörssvar" pendingLabel="Sparar..." />
          </form>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Senaste uppgiftsbegäran</h3>
              <p className="mt-1 text-sm text-slate-700">Enkel status för handläggaren.</p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{infoRequests.length}</span>
          </div>

          <div className="mt-4 space-y-3">
            {infoRequests.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-700">Inga uppgiftsbegäran finns ännu.</div>
            ) : (
              infoRequests.slice(0, 8).map((request) => {
                const status = simpleStatus(request.status)
                return (
                  <article key={request.id} className="rounded-2xl border border-slate-200 p-4 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-slate-950">{simpleRequestLabel(request.request_type)}</div>
                        <div className="mt-1 text-xs text-slate-700">{findSiteName(sites, request.site_id)} · {formatDateTime(request.created_at)}</div>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${status.className}`}>{status.label}</span>
                    </div>
                    <p className="mt-3 text-slate-700">{status.description}</p>
                    {request.blocker_reason ? <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-800">{request.blocker_reason}</div> : null}
                  </article>
                )
              })
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
