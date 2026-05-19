'use client'

import { useMemo, useState } from 'react'
import {
  deleteCustomerForRecreateAction,
  saveCustomerProfileAction,
} from '@/app/admin/customers/[id]/profile-actions'

type CustomerProfile = {
  id: string
  customer_type: string | null
  status: string | null
  first_name: string | null
  last_name: string | null
  company_name: string | null
  personal_number: string | null
  org_number: string | null
  email: string | null
  phone: string | null
  apartment_number: string | null
}

function inputClassName() {
  return 'h-11 rounded-2xl border border-slate-300 bg-white px-4 dark:border-slate-700 dark:bg-slate-950 dark:text-white'
}

export default function CustomerProfileCard({
  customer,
}: {
  customer: CustomerProfile
}) {
  const [customerType, setCustomerType] = useState(customer.customer_type ?? 'private')


  const helperText = useMemo(() => {
    if (customerType === 'business') {
      return 'Företag sparas med företagsnamn och organisationsnummer. För- och efternamn används som kontaktperson.'
    }

    if (customerType === 'association') {
      return 'Förening sparas med föreningsnamn och organisationsnummer. För- och efternamn används som kontaktperson.'
    }

    return 'Privatkund sparas med personuppgifter som huvudidentitet. Företags- och organisationsfält döljs.'
  }, [customerType])

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
            Kundprofil
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Uppdatera kundtyp, identitet och kontaktuppgifter. Primär kontakt synkas automatiskt när du sparar.
          </p>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300">
        {helperText}
      </div>

      <form action={saveCustomerProfileAction} className="mt-6 grid gap-4 md:grid-cols-2">
        <input type="hidden" name="customer_id" value={customer.id} />

        <label className="grid gap-1 text-sm">
          <span className="text-slate-600 dark:text-slate-300">Kundtyp</span>
          <select
            name="customer_type"
            value={customerType}
            onChange={(event) => setCustomerType(event.target.value)}
            className={inputClassName()}
          >
            <option value="private">Privat</option>
            <option value="business">Företag</option>
            <option value="association">Förening</option>
          </select>
        </label>

        <label className="grid gap-1 text-sm">
          <span className="text-slate-600 dark:text-slate-300">Status</span>
          <select
            name="status"
            defaultValue={customer.status ?? 'draft'}
            className={inputClassName()}
          >
            <option value="draft">Förbereds</option>
            <option value="pending_verification">Väntar verifiering</option>
            <option value="active">Aktiv</option>
            <option value="inactive">Inaktiv</option>
            <option value="moved">Flyttad</option>
            <option value="terminated">Avslutad</option>
            <option value="blocked">Blockerad</option>
          </select>
        </label>

        <label className="grid gap-1 text-sm">
          <span className="text-slate-600 dark:text-slate-300">
            {customerType === 'private' ? 'Förnamn' : 'Kontaktperson förnamn'}
          </span>
          <input
            name="first_name"
            defaultValue={customer.first_name ?? ''}
            required
            className={inputClassName()}
          />
        </label>

        <label className="grid gap-1 text-sm">
          <span className="text-slate-600 dark:text-slate-300">
            {customerType === 'private' ? 'Efternamn' : 'Kontaktperson efternamn'}
          </span>
          <input
            name="last_name"
            defaultValue={customer.last_name ?? ''}
            required
            className={inputClassName()}
          />
        </label>

        {customerType !== 'private' ? (
          <label className="grid gap-1 text-sm md:col-span-2">
            <span className="text-slate-600 dark:text-slate-300">
              {customerType === 'association' ? 'Föreningsnamn' : 'Företagsnamn'}
            </span>
            <input
              name="company_name"
              defaultValue={customer.company_name ?? ''}
              required
              className={inputClassName()}
            />
          </label>
        ) : (
          <input type="hidden" name="company_name" value="" />
        )}

        {customerType === 'private' ? (
          <label className="grid gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Personnummer</span>
            <input
              name="personal_number"
              defaultValue={customer.personal_number ?? ''}
              className={inputClassName()}
            />
          </label>
        ) : (
          <input type="hidden" name="personal_number" value="" />
        )}

        {customerType !== 'private' ? (
          <label className="grid gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Organisationsnummer</span>
            <input
              name="org_number"
              defaultValue={customer.org_number ?? ''}
              required
              className={inputClassName()}
            />
          </label>
        ) : (
          <input type="hidden" name="org_number" value="" />
        )}

        <label className="grid gap-1 text-sm">
          <span className="text-slate-600 dark:text-slate-300">E-post</span>
          <input
            name="email"
            type="email"
            defaultValue={customer.email ?? ''}
            className={inputClassName()}
          />
        </label>

        <label className="grid gap-1 text-sm">
          <span className="text-slate-600 dark:text-slate-300">Telefon</span>
          <input
            name="phone"
            defaultValue={customer.phone ?? ''}
            className={inputClassName()}
          />
        </label>

        <label className="grid gap-1 text-sm md:col-span-2">
          <span className="text-slate-600 dark:text-slate-300">Lägenhetsnummer</span>
          <input
            name="apartment_number"
            defaultValue={customer.apartment_number ?? ''}
            className={inputClassName()}
          />
        </label>

        <div className="md:col-span-2 flex justify-end">
          <button className="inline-flex items-center rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-black dark:bg-white dark:text-slate-950">
            Spara kundprofil
          </button>
        </div>
      </form>

      <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-900/60 dark:bg-rose-950/30">
        <h3 className="text-sm font-semibold text-rose-800 dark:text-rose-200">
          Radera kund och skapa om
        </h3>
        <p className="mt-1 text-sm leading-6 text-rose-700 dark:text-rose-200/80">
          Använd endast för felaktiga testkunder eller kunder som ska läggas upp från början igen. Raderingen tar bort kund, anläggningar, mätpunkter, switchärenden, Ediel-loggar, portalåtkomst och relaterade underlag som är kopplade till kunden.
        </p>
        <form
          action={deleteCustomerForRecreateAction}
          onSubmit={(event) => {
            if (!window.confirm('Radera kunden permanent? Detta kan inte ångras.')) {
              event.preventDefault()
            }
          }}
          className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]"
        >
          <input type="hidden" name="customer_id" value={customer.id} />
          <label className="grid gap-1 text-sm">
            <span className="text-rose-700 dark:text-rose-200">Skriv RADERA för att bekräfta</span>
            <input
              name="confirm_delete"
              placeholder="Skriv RADERA för att bekräfta"
              className="h-11 rounded-2xl border border-rose-300 bg-white px-4 text-rose-950 dark:border-rose-900 dark:bg-slate-950 dark:text-white"
            />
          </label>
          <div className="flex items-end">
            <button className="inline-flex h-11 items-center rounded-2xl bg-rose-700 px-4 text-sm font-semibold text-white hover:bg-rose-800">
              Radera kund
            </button>
          </div>
        </form>
      </div>
    </section>
  )
}