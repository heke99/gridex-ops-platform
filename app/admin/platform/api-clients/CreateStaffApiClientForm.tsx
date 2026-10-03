'use client'

import { useActionState } from 'react'
import {
  createStaffIntegrationApiClientAction,
  type CreateStaffApiClientState,
} from './staffActions'

const INITIAL_STATE: CreateStaffApiClientState = { ok: false, message: '' }
const STAFF_SCOPES = [
  'staff_sessions.write',
  'staff_context.read',
  'staff_customers.read',
  'staff_support.read',
  'staff_support.write',
] as const

type CompanyOption = { id: string; name: string; status: string | null }

export default function CreateStaffApiClientForm({
  companies,
  defaultCompanyId = '',
}: {
  companies: CompanyOption[]
  defaultCompanyId?: string
}) {
  const [state, formAction, pending] = useActionState(createStaffIntegrationApiClientAction, INITIAL_STATE)

  return (
    <section id="staff-api-client" aria-labelledby="staff-api-client-heading" className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">Personalintegration</p>
      <h2 id="staff-api-client-heading" className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Intern support</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
        Skapa en separat API-nyckel för personalens support på <strong>https://support123.gridex.se</strong>.
        Varje medarbetare loggar in med sitt eget OPS-konto och behåller sina bolagsbehörigheter.
      </p>

      {state.message ? (
        <div role={state.ok ? 'status' : 'alert'} className={`mt-5 rounded-2xl border p-4 text-sm ${state.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-800'}`}>
          <p className="font-semibold">{state.message}</p>
          {state.ok && state.token ? (
            <div className="mt-4 rounded-2xl border border-emerald-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-800">Personalnyckel · visas bara en gång</p>
              <code className="mt-2 block break-all rounded-xl bg-slate-950 p-3 text-xs text-emerald-100">{state.token}</code>
              <p className="mt-3 text-xs leading-5 text-slate-600">
                Kopiera nyckeln nu och spara den som <strong>GRIDEX_STAFF_API_KEY</strong> i supportwebbens servermiljö.
                Den ska hållas separat från hemsidans <strong>GRIDEX_API_KEY</strong> och får aldrig läggas i webbläsarkod.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      <form action={formAction} aria-busy={pending} className="mt-6 grid gap-5 lg:grid-cols-2">
        <label className="grid gap-2">
          <span className="text-sm font-semibold text-slate-800">Bolag för intern support</span>
          <select name="companyId" required defaultValue={defaultCompanyId} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900">
            <option value="">Välj bolag</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>{company.name}{company.status ? ` (${company.status})` : ''}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-2">
          <span className="text-sm font-semibold text-slate-800">Namn på personalens API-klient</span>
          <input name="name" required maxLength={120} defaultValue="Gridex intern support" className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm" />
        </label>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 lg:col-span-2">
          <p className="text-sm font-semibold text-slate-800">Fasta behörigheter för personalintegration</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {STAFF_SCOPES.map((scope) => <li key={scope}><code className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700">{scope}</code></li>)}
          </ul>
          <p className="mt-3 text-xs leading-5 text-slate-600">Nyckeln gäller supportwebben på https://support123.gridex.se. Personalens egna OPS-behörigheter kontrolleras för varje åtgärd.</p>
        </div>
        <button type="submit" disabled={pending} className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60 lg:col-span-2">
          {pending ? 'Skapar personalnyckel…' : 'Skapa separat personalnyckel'}
        </button>
      </form>
    </section>
  )
}
