'use client'

import { useActionState, useState } from 'react'
import { enrollExternalStaffAdminAction } from '@/app/admin/companies/[id]/staff-enrollment-actions'
import type {
  ExternalStaffEnrollmentClient,
  ExternalStaffEnrollmentState,
} from '@/lib/auth/externalStaffEnrollmentAdmin'
import { COMPANY_USER_ROLE_OPTIONS } from '@/lib/tenant/companyUserRoles'

const initialState: ExternalStaffEnrollmentState = { ok: false, message: '' }
const fieldClass =
  'mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm'

export default function ExternalStaffEnrollmentForm({
  companyId,
  clients,
  idempotencyKey,
}: {
  companyId: string
  clients: ExternalStaffEnrollmentClient[]
  idempotencyKey: string
}) {
  const [commandKey] = useState(idempotencyKey)
  const [clientId, setClientId] = useState('')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [state, action, pending] = useActionState(
    enrollExternalStaffAdminAction.bind(null, companyId),
    initialState,
  )

  if (!clients.length)
    return (
      <p className="mt-3 text-sm text-amber-900">
        Ingen tillgänglig personalportalanslutning kunde verifieras. Kontrollera
        bolagets registrering och din behörighet.
      </p>
    )

  return (
    <form action={action} className="mt-4 space-y-3">
      <input type="hidden" name="idempotency_key" value={commandKey} />
      <fieldset
        disabled={pending || state.ok}
        className="grid gap-3 md:grid-cols-2"
      >
        <label className="text-sm font-medium text-slate-800">
          Personalportal
          <select
            name="api_client_id"
            required
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            className={fieldClass}
          >
            <option value="" disabled>
              Välj registrerad anslutning
            </option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium text-slate-800">
          Administratörens roll
          <select
            name="role_key"
            required
            value={role}
            onChange={(event) => setRole(event.target.value)}
            className={fieldClass}
          >
            <option value="" disabled>
              Välj roll
            </option>
            {COMPANY_USER_ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium text-slate-800">
          E-post
          <input
            name="email"
            type="email"
            autoComplete="off"
            required
            maxLength={320}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="text-sm font-medium text-slate-800">
          Namn
          <input
            name="full_name"
            autoComplete="off"
            maxLength={160}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={fieldClass}
          />
        </label>
        <button
          type="submit"
          className="rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400 md:col-span-2"
        >
          {pending
            ? 'Registrerar inbjudan…'
            : state.ok
              ? 'Inbjudan registrerad'
              : 'Bjud in till personalportalen'}
        </button>
      </fieldset>
      {state.message ? (
        <p
          role="status"
          aria-live="polite"
          className={`rounded-xl border p-3 text-sm ${state.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  )
}
