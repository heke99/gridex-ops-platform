'use client'

import { useEffect, useMemo, useState } from 'react'
import type { CustomerSiteRow } from '@/lib/masterdata/types'
import { createDynamicSupplierSwitchRequestAction } from '@/app/admin/customers/[id]/switch-create-actions'
import { useFormStatus } from 'react-dom'

type SupplierOption = {
  id: string
  name: string
  org_number: string | null
  is_active: boolean
}

type CustomerOptionPayload = {
  customer: {
    id: string
    customer_type: string | null
    first_name: string | null
    last_name: string | null
    company_name: string | null
    org_number: string | null
    personal_number: string | null
  } | null
  suppliers: SupplierOption[]
}

type Props = {
  customerId: string
  sites: CustomerSiteRow[]
}

function SubmitButton() {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-950"
    >
      {pending ? 'Skapar switchärende...' : 'Skapa switchärende'}
    </button>
  )
}

function customerTypeLabel(value: string | null | undefined) {
  if (value === 'business') return 'Företag'
  if (value === 'association') return 'Förening'
  return 'Privatkund'
}

export default function CustomerSwitchCreatePanel({
  customerId,
  sites,
}: Props) {
  const [payload, setPayload] = useState<CustomerOptionPayload | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let isMounted = true

    async function run() {
      try {
        const response = await fetch(
          `/api/admin/customer-switch-form-options?customerId=${customerId}`,
          { cache: 'no-store' }
        )
        const data = (await response.json()) as CustomerOptionPayload

        if (isMounted) {
          setPayload(data)
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    void run()

    return () => {
      isMounted = false
    }
  }, [customerId])

  const customer = payload?.customer ?? null
  const suppliers = payload?.suppliers ?? []

  const customerSummary = useMemo(() => {
    if (!customer) return 'Kunddata laddas...'

    if (customer.customer_type === 'private') {
      const name = [customer.first_name, customer.last_name].filter(Boolean).join(' ')
      return `${name || 'Privatkund'}${customer.personal_number ? ` • ${customer.personal_number}` : ''}`
    }

    return `${customer.company_name || 'Organisationskund'}${customer.org_number ? ` • ${customer.org_number}` : ''}`
  }, [customer])

  return (
    <div className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          Skapa nytt leverantörsbyte
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Formuläret anpassar sig efter kundtyp och låter dig spara nya elleverantörer
          direkt från kundkortet.
        </p>
      </div>

      <div className="space-y-4 p-6">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm dark:border-slate-800 dark:bg-slate-950">
          <div className="font-semibold text-slate-900 dark:text-white">
            {customerTypeLabel(customer?.customer_type)}
          </div>
          <div className="mt-1 text-slate-600 dark:text-slate-300">
            {customerSummary}
          </div>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Privatkund använder personidentitet från kundkortet. Företag/förening använder
            organisationsuppgifter från kundkortet. Här fyller du främst switchspecifika
            uppgifter och leverantörer.
          </div>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            Laddar leverantörsregister...
          </div>
        ) : sites.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            Kunden saknar anläggningar.
          </div>
        ) : (
          sites.map((site) => (
            <form
              key={site.id}
              action={createDynamicSupplierSwitchRequestAction}
              className="rounded-2xl border border-slate-200 p-5 dark:border-slate-800"
            >
              <input type="hidden" name="customer_id" value={customerId} />
              <input type="hidden" name="site_id" value={site.id} />

              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  {site.site_name}
                </span>
                {site.grid_owner_id ? (
                  <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
                    nätägare kopplad
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                    nätägare saknas
                  </span>
                )}
                {site.price_area_code ? (
                  <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                    {site.price_area_code}
                  </span>
                ) : null}
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="grid gap-2">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    Ärendetyp
                  </span>
                  <select
                    name="request_type"
                    defaultValue="switch"
                    className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                  >
                    <option value="switch">Byte av leverantör</option>
                    <option value="move_in">Inflytt</option>
                    <option value="move_out_takeover">Övertag vid utflytt</option>
                  </select>
                </label>

                <label className="grid gap-2">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    Önskat startdatum
                  </span>
                  <input
                    type="date"
                    name="requested_start_date"
                    defaultValue={site.move_in_date ?? ''}
                    className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                  />
                </label>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <label className="grid gap-2">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    {customer?.customer_type === 'private'
                      ? 'Privatkundens nuvarande elleverantör'
                      : 'Nuvarande elleverantör'}
                  </span>
                  <select
                    name="current_supplier_id"
                    defaultValue=""
                    className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                  >
                    <option value="">Välj från lista</option>
                    {suppliers.map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.name}
                        {supplier.org_number ? ` • ${supplier.org_number}` : ''}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-2">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    Nuvarande leverantör namn
                  </span>
                  <input
                    name="current_supplier_name"
                    defaultValue={site.current_supplier_name ?? ''}
                    className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                  />
                </label>

                <label className="grid gap-2">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    Nuvarande leverantör org.nr
                  </span>
                  <input
                    name="current_supplier_org_number"
                    defaultValue={site.current_supplier_org_number ?? ''}
                    className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                  />
                </label>

                <label className="grid gap-2">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    Nuvarande leverantör e-post
                  </span>
                  <input
                    name="current_supplier_email"
                    type="email"
                    className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                  />
                </label>

                <label className="grid gap-2">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    Nuvarande leverantör telefon
                  </span>
                  <input
                    name="current_supplier_phone"
                    className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                  />
                </label>

                <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 md:col-span-2">
                  <input
                    type="checkbox"
                    name="save_new_current_supplier"
                    value="true"
                    className="h-4 w-4"
                  />
                  Spara nuvarande leverantör i register om den inte redan finns
                </label>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <label className="grid gap-2">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    Ny / inkommande elleverantör
                  </span>
                  <select
                    name="incoming_supplier_id"
                    defaultValue=""
                    className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                  >
                    <option value="">Välj från lista</option>
                    {suppliers.map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.name}
                        {supplier.org_number ? ` • ${supplier.org_number}` : ''}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-2">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    Inkommande leverantör namn
                  </span>
                  <input
                    name="incoming_supplier_name"
                    defaultValue="Gridex"
                    className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                  />
                </label>

                <label className="grid gap-2">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    Inkommande leverantör org.nr
                  </span>
                  <input
                    name="incoming_supplier_org_number"
                    className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                  />
                </label>

                <label className="grid gap-2">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    Inkommande leverantör e-post
                  </span>
                  <input
                    name="incoming_supplier_email"
                    type="email"
                    className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                  />
                </label>

                <label className="grid gap-2">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    Inkommande leverantör telefon
                  </span>
                  <input
                    name="incoming_supplier_phone"
                    className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                  />
                </label>

                <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 md:col-span-2">
                  <input
                    type="checkbox"
                    name="save_new_incoming_supplier"
                    value="true"
                    className="h-4 w-4"
                  />
                  Spara inkommande leverantör i register om den inte redan finns
                </label>
              </div>

              <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                Routingen för dispatch styrs fortfarande av anläggningens nätägare
                via communication routes. Leverantörsregistret används här för korrekt
                switchdata och återanvändbara val.
              </div>

              <div className="mt-5">
                <SubmitButton />
              </div>
            </form>
          ))
        )}
      </div>
    </div>
  )
}