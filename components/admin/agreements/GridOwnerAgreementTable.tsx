import { archiveGridOwnerAgreementAction } from '@/app/admin/agreements/grid-owners/actions'
import type { GridOwnerAccessAgreementRow } from '@/lib/routes/gridOwnerAgreements'

type Lookup = Record<string, string>

type Props = {
  agreements: GridOwnerAccessAgreementRow[]
  companyById: Lookup
  gridOwnerById: Lookup
  routeById: Lookup
}

function statusTone(status: string) {
  if (status === 'active') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (status === 'blocked') return 'border-red-200 bg-red-50 text-red-800'
  if (status === 'expired') return 'border-amber-200 bg-amber-50 text-amber-800'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

export default function GridOwnerAgreementTable({ agreements, companyById, gridOwnerById, routeById }: Props) {
  if (agreements.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-emerald-200 bg-white p-8 text-center text-sm text-slate-700">
        Inga nätägaravtal finns ännu. Lägg in första avtalet innan Z13 kan skickas säkert för mätvärdesåtkomst.
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-emerald-100 bg-white shadow-sm shadow-emerald-950/5">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100 text-sm">
          <thead className="bg-emerald-50/60 text-left text-xs font-semibold uppercase tracking-[0.14em] text-emerald-800">
            <tr>
              <th className="px-4 py-3">Nätägare</th>
              <th className="px-4 py-3">Bolag</th>
              <th className="px-4 py-3">Scope</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Referens</th>
              <th className="px-4 py-3">Route</th>
              <th className="px-4 py-3">Giltighet</th>
              <th className="px-4 py-3 text-right">Åtgärd</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {agreements.map((agreement) => (
              <tr key={agreement.id} className="align-top">
                <td className="px-4 py-4 font-semibold text-slate-950">
                  {agreement.grid_owner_id ? gridOwnerById[agreement.grid_owner_id] ?? agreement.grid_owner_id : '—'}
                  <div className="mt-1 text-xs font-normal text-slate-500">{agreement.preferred_receiver_ediel_id ?? 'Receiver Ediel-id saknas'}</div>
                </td>
                <td className="px-4 py-4 text-slate-700">
                  {agreement.company_id ? companyById[agreement.company_id] ?? agreement.company_id : 'Globalt'}
                </td>
                <td className="px-4 py-4 text-slate-700">
                  <div className="font-medium text-slate-900">{agreement.agreement_scope}</div>
                  <div className="mt-1 text-xs text-slate-500">{agreement.agreement_type}</div>
                </td>
                <td className="px-4 py-4">
                  <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone(String(agreement.status))}`}>
                    {agreement.status}
                  </span>
                </td>
                <td className="px-4 py-4 text-slate-700">
                  <div>{agreement.agreement_reference ?? 'Saknas'}</div>
                  <div className="mt-1 text-xs text-slate-500">{agreement.preferred_application_reference ?? 'App ref ej satt'}</div>
                </td>
                <td className="px-4 py-4 text-slate-700">
                  {agreement.preferred_route_id ? routeById[agreement.preferred_route_id] ?? agreement.preferred_route_id : 'Automatiskt'}
                </td>
                <td className="px-4 py-4 text-slate-700">
                  {agreement.valid_from ?? '—'} → {agreement.valid_to ?? 'tills vidare'}
                </td>
                <td className="px-4 py-4 text-right">
                  <form action={archiveGridOwnerAgreementAction}>
                    <input type="hidden" name="id" value={agreement.id} />
                    <button className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                      Arkivera
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
