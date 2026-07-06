'use client'

import { useActionState } from 'react'
import { claimPortalCustomerAction, type PortalClaimActionState } from '@/lib/customer-portal/claim'

const initialState: PortalClaimActionState = {
  ok: false,
  message: '',
}

export default function ClaimCustomerForm({
  userEmail,
  companySlug,
}: {
  userEmail: string | null
  companySlug?: string | null
}) {
  const [state, formAction, isPending] = useActionState(claimPortalCustomerAction, initialState)

  return (
    <form action={formAction} className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
      {companySlug ? <input type="hidden" name="company_slug" value={companySlug} /> : null}
      <div>
        <h2 className="text-xl font-semibold text-slate-950">Koppla ditt kundkonto</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          För säker koppling måste alla uppgifter matcha samma kund: personnummer, e-post,
          namn och anläggnings-ID. Vi kopplar aldrig kundportal enbart på e-post.
        </p>
      </div>

      <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        Du är inloggad som <span className="font-semibold">{userEmail ?? 'okänd e-post'}</span>.
        Den e-postadressen måste finnas på kundkortet eller som kundkontakt.
      </div>

      {state.message ? (
        <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {state.message}
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <label className="grid gap-2">
          <span className="text-sm font-medium text-slate-700">E-post</span>
          <input
            name="email"
            type="email"
            defaultValue={userEmail ?? ''}
            className="h-11 rounded-2xl border border-slate-300 px-4 text-sm outline-none focus:border-slate-500"
          />
        </label>

        <label className="grid gap-2">
          <span className="text-sm font-medium text-slate-700">Personnummer</span>
          <input
            name="personal_number"
            placeholder="ÅÅÅÅMMDD-XXXX"
            autoComplete="off"
            className="h-11 rounded-2xl border border-slate-300 px-4 text-sm outline-none focus:border-slate-500"
            required
          />
        </label>

        <label className="grid gap-2">
          <span className="text-sm font-medium text-slate-700">Förnamn</span>
          <input
            name="first_name"
            autoComplete="given-name"
            className="h-11 rounded-2xl border border-slate-300 px-4 text-sm outline-none focus:border-slate-500"
          />
        </label>

        <label className="grid gap-2">
          <span className="text-sm font-medium text-slate-700">Efternamn</span>
          <input
            name="last_name"
            autoComplete="family-name"
            className="h-11 rounded-2xl border border-slate-300 px-4 text-sm outline-none focus:border-slate-500"
          />
        </label>

        <label className="grid gap-2 md:col-span-2">
          <span className="text-sm font-medium text-slate-700">Fullständigt namn om det skiljer sig från för-/efternamn</span>
          <input
            name="full_name"
            autoComplete="name"
            placeholder="Valfritt om förnamn och efternamn är ifyllda"
            className="h-11 rounded-2xl border border-slate-300 px-4 text-sm outline-none focus:border-slate-500"
          />
        </label>

        <label className="grid gap-2 md:col-span-2">
          <span className="text-sm font-medium text-slate-700">Anläggnings-ID eller mätpunkts-ID</span>
          <input
            name="installation_id"
            placeholder="Exempel: anläggnings-ID eller 735999..."
            autoComplete="off"
            className="h-11 rounded-2xl border border-slate-300 px-4 text-sm outline-none focus:border-slate-500"
            required
          />
        </label>
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
        <div className="font-semibold text-slate-900">Så skyddar vi kopplingen</div>
        <p className="mt-1">
          Alla fyra krav måste matcha samma kundkort. Om något inte stämmer skapas ingen
          portalåtkomst och ärendet måste hanteras av kundansvarig.
        </p>
      </div>

      <div className="mt-6 flex justify-end">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? 'Verifierar...' : 'Koppla konto'}
        </button>
      </div>
    </form>
  )
}
