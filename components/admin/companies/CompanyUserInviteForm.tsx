'use client'

import { useActionState } from 'react'
import { inviteCompanyUserAction, type CompanyActionState } from '@/app/admin/companies/actions'
import {
  COMPANY_MEMBERSHIP_ROLE_OPTIONS,
  COMPANY_USER_ROLE_OPTIONS,
} from '@/lib/tenant/companyUserRoles'

const initialState: CompanyActionState = { ok: false, message: '' }

export default function CompanyUserInviteForm({
  companyId,
  compact = false,
}: {
  companyId: string
  compact?: boolean
}) {
  const [state, formAction, pending] = useActionState(inviteCompanyUserAction, initialState)

  return (
    <form action={formAction} className={compact ? 'grid gap-3' : 'mt-4 grid gap-3 lg:grid-cols-[1fr_1fr_190px_180px_220px_140px]'}>
      <input type="hidden" name="company_id" value={companyId} />
      <input
        name="email"
        type="email"
        required
        placeholder="namn@bolag.se"
        className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
      />
      <input
        name="full_name"
        placeholder="Namn"
        className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
      />
      <input
        name="temporary_password"
        type="text"
        minLength={8}
        required
        placeholder="Temporärt lösenord"
        className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
      />
      <select name="membership_role" defaultValue="admin" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm">
        {COMPANY_MEMBERSHIP_ROLE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <select name="role_key" defaultValue="company_admin" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm">
        {COMPANY_USER_ROLE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <button
        disabled={pending}
        className="rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        {pending ? 'Lägger till…' : 'Lägg till'}
      </button>
      {state.message ? (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm ${
            state.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'
          } ${compact ? '' : 'lg:col-span-6'}`}
        >
          {state.message}
        </div>
      ) : null}
    </form>
  )
}
