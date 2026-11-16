'use client'

import { useEffect, useMemo, useState } from 'react'
import type { CustomerSiteRow } from '@/lib/masterdata/types'
import { createDynamicSupplierSwitchRequestAction } from '@/app/admin/customers/[id]/switch-create-actions'
import { useFormStatus } from 'react-dom'
import type { OwnElectricitySupplierResolution } from '@/lib/masterdata/selfSupplier'

type SupplierOption = {
 id: string
 name: string
 org_number: string | null
 is_active: boolean
 is_own_supplier: boolean
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
 ownSupplier: SupplierOption | null
 ownSupplierResolution: OwnElectricitySupplierResolution
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
 className="inline-flex items-center justify-center rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 "
 >
 {pending ? 'Startar leverantörsbyte...' : 'Starta leverantörsbyte'}
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
 const ownSupplier = payload?.ownSupplier ?? null

 const customerSummary = useMemo(() => {
 if (!customer) return 'Kunddata laddas...'

 if (customer.customer_type === 'private') {
 const name = [customer.first_name, customer.last_name].filter(Boolean).join(' ')
 return `${name || 'Privatkund'}${customer.personal_number ? ` • ${customer.personal_number}` : ''}`
 }

 return `${customer.company_name || 'Organisationskund'}${customer.org_number ? ` • ${customer.org_number}` : ''}`
 }, [customer])

 return (
 <div className="rounded-3xl border border-slate-200 bg-white shadow-sm ">
 <div className="border-b border-slate-200 px-6 py-5 ">
 <h2 className="text-lg font-semibold text-slate-900 ">
 Starta leverantörsbyte
 </h2>
 <p className="mt-1 text-sm text-slate-700 ">
 Välj anläggning, startdatum och de uppgifter som behövs för att starta kundens leverantörsbyte.
 </p>
 </div>

 <div className="space-y-4 p-6">
 <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm ">
 <div className="font-semibold text-slate-900 ">
 {customerTypeLabel(customer?.customer_type)}
 </div>
 <div className="mt-1 text-slate-700 ">
 {customerSummary}
 </div>
 <div className="mt-2 text-xs text-slate-700 ">
 Kundens identitet hämtas från kundkortet. Här väljer du bara det som behövs för bytet.
 </div>
 </div>

 <div
 className={`rounded-2xl border px-4 py-3 text-sm ${
 ownSupplier
 ? 'border-emerald-200 bg-emerald-50 text-emerald-900 '
 : 'border-amber-200 bg-amber-50 text-amber-900 '
 }`}
 >
 <div className="font-semibold">
 {ownSupplier
 ? 'Egen leverantör är vald'
 : 'Egen leverantör behöver väljas'}
 </div>
 <div className="mt-1">
 {ownSupplier
 ? `${ownSupplier.name}${ownSupplier.org_number ? ` • ${ownSupplier.org_number}` : ''}`
 : 'Välj vilken leverantör som är ert bolag innan bytet skickas vidare.'}
 </div>

 </div>

 {loading ? (
 <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-700 ">
 Laddar leverantörer...
 </div>
 ) : sites.length === 0 ? (
 <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-700 ">
 Kunden saknar anläggningar.
 </div>
 ) : (
 sites.map((site) => (
 <form
 key={site.id}
 action={createDynamicSupplierSwitchRequestAction}
 className="rounded-2xl border border-slate-200 p-5 "
 >
 <input type="hidden" name="customer_id" value={customerId} />
 <input type="hidden" name="site_id" value={site.id} />

 <div className="flex flex-wrap items-center gap-2">
 <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 ">
 {site.site_name}
 </span>
 {site.grid_owner_id ? (
 <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 ">
 nätägare kopplad
 </span>
 ) : (
 <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700 ">
 nätägare saknas
 </span>
 )}
 {site.price_area_code ? (
 <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 ">
 {site.price_area_code}
 </span>
 ) : null}
 </div>

 <input type="hidden" name="request_type" value="switch" />
 <input type="hidden" name="switch_direction" value="to_us" />
 <input type="hidden" name="current_supplier_name" value={site.current_supplier_name ?? ''} />
 <input type="hidden" name="current_supplier_org_number" value={site.current_supplier_org_number ?? ''} />

 <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
 <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
 <div className="font-semibold text-slate-950">Kontrollera uppgifterna</div>
 <p className="mt-1">
 Bytet startas för vald anläggning. Nuvarande leverantör och tekniska uppgifter hämtas från kundkortet när de finns.
 </p>
 </div>
 <label className="grid gap-2">
 <span className="text-sm font-medium text-slate-700 ">
 Önskat startdatum
 </span>
 <input
 type="date"
 name="requested_start_date"
 defaultValue={site.move_in_date ?? ''}
 className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 "
 />
 </label>
 </div>

 <details className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
 <summary className="cursor-pointer font-semibold text-slate-900">Visa uppgifter som används</summary>
 <div className="mt-3 grid gap-3 md:grid-cols-2">
 <div>
 <div className="text-xs uppercase tracking-[0.14em] text-slate-600">Nuvarande leverantör</div>
 <div className="mt-1 font-medium text-slate-900">{site.current_supplier_name ?? 'Saknas'}</div>
 </div>
 <div>
 <div className="text-xs uppercase tracking-[0.14em] text-slate-600">Egen leverantör</div>
 <div className="mt-1 font-medium text-slate-900">{ownSupplier?.name ?? 'Behöver väljas av plattformsadmin'}</div>
 </div>
 </div>
 </details>

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