import { saveGridOwnerAgreementAction } from '@/app/admin/agreements/grid-owners/actions'

type Option = { id: string; name: string | null }

type RouteOption = {
  id: string
  route_name: string | null
  route_scope: string | null
  route_type: string | null
  grid_owner_id: string | null
}

type Props = {
  companies: Option[]
  gridOwners: Array<Option & { ediel_id?: string | null; owner_code?: string | null }>
  routes: RouteOption[]
}

export default function GridOwnerAgreementForm({ companies, gridOwners, routes }: Props) {
  return (
    <form action={saveGridOwnerAgreementAction} className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-sm shadow-emerald-950/5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Nytt nätägaravtal</p>
        <h2 className="mt-2 text-lg font-semibold text-slate-950">Avtal och referenskrav</h2>
        <p className="mt-1 text-sm leading-6 text-slate-700">
          Används av route engine för att blockera Z13/Z18 när aktivt nätägaravtal eller referenskrav saknas.
        </p>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <label className="text-sm font-medium text-slate-800">
          Bolag
          <select name="company_id" className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900">
            <option value="">Globalt/plattform</option>
            {companies.map((company) => <option key={company.id} value={company.id}>{company.name ?? company.id}</option>)}
          </select>
        </label>

        <label className="text-sm font-medium text-slate-800">
          Nätägare
          <select name="grid_owner_id" required className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900">
            <option value="">Välj nätägare</option>
            {gridOwners.map((owner) => (
              <option key={owner.id} value={owner.id}>{owner.name ?? owner.id}{owner.ediel_id ? ` · ${owner.ediel_id}` : ''}</option>
            ))}
          </select>
        </label>

        <label className="text-sm font-medium text-slate-800">
          Avtalstyp
          <select name="agreement_type" defaultValue="metering_access" className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900">
            <option value="metering_access">Mätvärdesåtkomst</option>
            <option value="customer_masterdata">Kund-/anläggningsuppgifter</option>
            <option value="supplier_switch">Leverantörsbyte</option>
            <option value="billing_underlay">Faktureringsunderlag</option>
            <option value="general_ediel">Generellt Ediel</option>
          </select>
        </label>

        <label className="text-sm font-medium text-slate-800">
          Route scope
          <select name="agreement_scope" defaultValue="metering_access" className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900">
            <option value="metering_access">metering_access</option>
            <option value="customer_masterdata">customer_masterdata</option>
            <option value="supplier_switch">supplier_switch</option>
            <option value="meter_values">meter_values</option>
            <option value="billing_underlay">billing_underlay</option>
            <option value="partner_export">partner_export</option>
          </select>
        </label>

        <label className="text-sm font-medium text-slate-800">
          Status
          <select name="status" defaultValue="draft" className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900">
            <option value="draft">Utkast</option>
            <option value="active">Aktivt</option>
            <option value="expired">Utgånget</option>
            <option value="blocked">Blockerat</option>
          </select>
        </label>

        <label className="text-sm font-medium text-slate-800">
          Avtalsreferens
          <input name="agreement_reference" className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm" placeholder="Ex. avtals-/fullmaktsreferens" />
        </label>

        <label className="text-sm font-medium text-slate-800">
          Giltig från
          <input name="valid_from" type="date" className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm" />
        </label>

        <label className="text-sm font-medium text-slate-800">
          Giltig till
          <input name="valid_to" type="date" className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm" />
        </label>

        <label className="text-sm font-medium text-slate-800">
          Receiver Ediel-id
          <input name="preferred_receiver_ediel_id" className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm" placeholder="Nätägarens Ediel-id" />
        </label>

        <label className="text-sm font-medium text-slate-800">
          Receiver subaddress
          <input name="preferred_receiver_sub_address" className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm" placeholder="Valfritt" />
        </label>

        <label className="text-sm font-medium text-slate-800">
          Application Reference
          <input name="preferred_application_reference" defaultValue="23-DGI-PRODAT" className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm" />
        </label>

        <label className="text-sm font-medium text-slate-800">
          Preferred route
          <select name="preferred_route_id" className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900">
            <option value="">Automatiskt routeval</option>
            {routes.map((route) => (
              <option key={route.id} value={route.id}>{route.route_name ?? route.id} · {route.route_scope ?? 'scope saknas'} · {route.route_type ?? 'typ saknas'}</option>
            ))}
          </select>
        </label>

        <label className="text-sm font-medium text-slate-800">
          Dokument/PDF-path
          <input name="document_path" className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm" placeholder="storage path eller dokumentreferens" />
        </label>

        <label className="text-sm font-medium text-slate-800 md:col-span-2">
          Referenskrav JSON
          <textarea name="reference_requirements" rows={4} className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 font-mono text-xs" placeholder='{"requires_agreement_reference": true}' />
        </label>
      </div>

      <div className="mt-5 grid gap-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-4 text-sm text-slate-700 md:grid-cols-3">
        <label className="flex items-center gap-2"><input name="requires_customer_authorization" type="checkbox" defaultChecked /> Kundfullmakt krävs</label>
        <label className="flex items-center gap-2"><input name="requires_metering_point_id" type="checkbox" defaultChecked /> Mätpunkt krävs</label>
        <label className="flex items-center gap-2"><input name="requires_facility_id" type="checkbox" /> Anläggnings-id krävs</label>
        <label className="flex items-center gap-2"><input name="requires_customer_personal_number" type="checkbox" /> Person-/orgnr krävs</label>
        <label className="flex items-center gap-2"><input name="requires_report_period" type="checkbox" /> Rapportperiod krävs</label>
      </div>

      <div className="mt-5 flex justify-end">
        <button className="rounded-2xl bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-emerald-700/20 hover:bg-emerald-800">
          Spara nätägaravtal
        </button>
      </div>
    </form>
  )
}
