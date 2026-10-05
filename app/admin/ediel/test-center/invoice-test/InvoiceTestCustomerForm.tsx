'use client'

import { useMemo, useState } from 'react'
import { createInvoiceTestCustomerAction } from '@/app/admin/ediel/test-center/invoice-test/actions'

type OptionRow = {
  id: string
  name: string
  company_id?: string
  contract_type?: string | null
}

export default function InvoiceTestCustomerForm({
  companies,
  offers,
  initialCompanyId,
}: {
  companies: OptionRow[]
  offers: OptionRow[]
  initialCompanyId: string
}) {
  const [companyId, setCompanyId] = useState(initialCompanyId)
  const [contractOfferId, setContractOfferId] = useState('')
  const companyOffers = useMemo(
    () => offers.filter((offer) => offer.company_id === companyId),
    [offers, companyId],
  )

  return (
    <form action={createInvoiceTestCustomerAction} className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <label className="space-y-2 text-sm font-bold text-slate-800">
        <span>Bolag / tenant</span>
        <select
          name="companyId"
          required
          value={companyId}
          onChange={(event) => {
            setCompanyId(event.target.value)
            setContractOfferId('')
          }}
          className="w-full rounded-xl border border-slate-300 px-3 py-2"
        >
          <option value="">Välj bolag</option>
          {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
        </select>
      </label>

      <label className="space-y-2 text-sm font-bold text-slate-800 xl:col-span-2">
        <span>Riktigt internt avtal</span>
        <select
          name="contractOfferId"
          required
          value={contractOfferId}
          onChange={(event) => setContractOfferId(event.target.value)}
          disabled={!companyId}
          className="w-full rounded-xl border border-slate-300 px-3 py-2 disabled:bg-slate-100"
        >
          <option value="">{companyId ? 'Välj aktivt internt avtal' : 'Välj bolag först'}</option>
          {companyOffers.map((offer) => (
            <option key={offer.id} value={offer.id}>{offer.name} · {offer.contract_type ?? '—'}</option>
          ))}
        </select>
        {companyId && companyOffers.length === 0 ? (
          <span className="block text-xs font-semibold text-amber-700">Det finns inget aktivt internal-publication-ready avtal för valt bolag.</span>
        ) : null}
      </label>

      <label className="space-y-2 text-sm font-bold text-slate-800">
        <span>Avtalsstart</span>
        <input type="date" name="contractStartDate" required defaultValue="2026-07-01" className="w-full rounded-xl border border-slate-300 px-3 py-2" />
      </label>
      <label className="space-y-2 text-sm font-bold text-slate-800"><span>Förnamn</span><input name="firstName" required defaultValue="Test" className="w-full rounded-xl border border-slate-300 px-3 py-2" /></label>
      <label className="space-y-2 text-sm font-bold text-slate-800"><span>Efternamn</span><input name="lastName" required defaultValue="Fakturakund" className="w-full rounded-xl border border-slate-300 px-3 py-2" /></label>
      <label className="space-y-2 text-sm font-bold text-slate-800"><span>E-post</span><input type="email" name="email" required defaultValue="testfaktura@gridex.se" className="w-full rounded-xl border border-slate-300 px-3 py-2" /></label>
      <label className="space-y-2 text-sm font-bold text-slate-800"><span>Telefon</span><input name="phone" required defaultValue="0701234567" className="w-full rounded-xl border border-slate-300 px-3 py-2" /></label>
      <label className="space-y-2 text-sm font-bold text-slate-800"><span>Elområde för prissättning</span><select name="priceAreaCode" required defaultValue="SE3" className="w-full rounded-xl border border-slate-300 px-3 py-2"><option>SE1</option><option>SE2</option><option>SE3</option><option>SE4</option></select></label>
      <label className="space-y-2 text-sm font-bold text-slate-800 xl:col-span-2"><span>Adress</span><input name="street" required defaultValue="Testgatan 1" className="w-full rounded-xl border border-slate-300 px-3 py-2" /></label>
      <label className="space-y-2 text-sm font-bold text-slate-800"><span>Postnummer</span><input name="postalCode" required defaultValue="11122" className="w-full rounded-xl border border-slate-300 px-3 py-2" /></label>
      <label className="space-y-2 text-sm font-bold text-slate-800"><span>Ort</span><input name="city" required defaultValue="Stockholm" className="w-full rounded-xl border border-slate-300 px-3 py-2" /></label>
      <label className="space-y-2 text-sm font-bold text-slate-800"><span>Årsförbrukning kWh</span><input type="number" name="annualConsumptionKwh" min="0" defaultValue="12000" className="w-full rounded-xl border border-slate-300 px-3 py-2" /></label>
      <label className="space-y-2 text-sm font-bold text-slate-800"><span>Faktura-e-post</span><input type="email" name="invoiceEmail" required defaultValue="testfaktura@gridex.se" className="w-full rounded-xl border border-slate-300 px-3 py-2" /></label>

      <input type="hidden" name="siteName" value="Fakturatest-anläggning" />
      <input type="hidden" name="invoiceRecipient" value="Test Fakturakund" />

      <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm leading-6 text-sky-950 md:col-span-2 xl:col-span-4">
        <b>Anläggnings-ID, mätpunkts-ID, nätområde och mätarreferenser anges inte här.</b> De läses från den importerade EDIFACT-filen med samma canonical parser som produktionen och visas i nästa steg.
      </div>
      <div className="flex items-end xl:col-span-2 xl:col-start-3">
        <button className="w-full rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-black text-white hover:bg-emerald-800">Skapa testkund</button>
      </div>
    </form>
  )
}
