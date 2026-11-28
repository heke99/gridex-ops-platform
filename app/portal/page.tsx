import { portalInvoiceTitle } from '@/lib/customer-portal/labels'
import Link from 'next/link'
import { getPortalOverviewData } from '@/lib/customer-portal/db'
import { switchPortalAccountAction } from './actions'
import {
  formatDate,
  formatKwh,
  formatPeriod,
  formatInvoiceMoney,
  invoiceStatusLabel,
  invoiceStatusTone,
  isCancelledOrCreditedInvoice,
  PORTAL_CONSUMPTION_BOUNDARY_NOTICE,
  PORTAL_CONSUMPTION_REVIEW_NOTICES,
} from '@/lib/customer-portal/format'

export const dynamic = 'force-dynamic'

function EmptyPortalState({ brandName, accountSwitchFailed }: { brandName: string; accountSwitchFailed: boolean }) {
  return (
    <section className="rounded-[32px] border border-amber-200 bg-amber-50 p-8">
      <h2 className="text-xl font-semibold text-amber-950">Ingen kundkoppling hittades</h2>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-amber-900">
        Ditt login är aktivt, men det är ännu inte kopplat till ett kundkonto hos {brandName}.
        Koppla kontot säkert med personnummer, e-post, namn och anläggnings-ID.
      </p>
      {accountSwitchFailed ? (
        <p role="alert" className="mt-3 max-w-3xl text-sm leading-6 text-amber-900">
          Det gick inte att avsluta din inloggning. Försök igen.
        </p>
      ) : null}
      <div className="mt-5 flex flex-wrap gap-3">
        <Link
          href="/portal/koppla-kund"
          className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-black"
        >
          Koppla mitt kundkonto
        </Link>
        <form action={switchPortalAccountAction}>
          <button
            type="submit"
            className="rounded-2xl border border-amber-300 bg-white px-4 py-2.5 text-sm font-semibold text-amber-900 hover:bg-amber-100"
          >
            Byt inloggning
          </button>
        </form>
      </div>
    </section>
  )
}

export default async function CustomerPortalPage({
  searchParams,
}: {
  searchParams?: Promise<{ kopplad?: string; konto?: string }>
}) {
  const params = searchParams ? await searchParams : {}
  const { context, invoices, sites, meteringPoints, consumptionMonths, customerStatus, portalDisplayName } =
    await getPortalOverviewData()

  if (context.customerIds.length === 0) {
    return (
      <EmptyPortalState
        brandName={context.branding.brandName}
        accountSwitchFailed={params.konto === 'byte-misslyckades'}
      />
    )
  }

  const brandName = context.branding.brandName
  const latestInvoice = invoices[0] ?? null
  const latestConsumption = consumptionMonths[0] ?? null
  const primaryCustomer = context.customers[0] ?? null

  return (
    <div className="space-y-8">
      {params?.kopplad === '1' ? (
        <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-900">
          Kundkontot är kopplat. Dina fakturor, anläggningar och förbrukning visas nu här.
        </section>
      ) : null}

      <section className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
              Kundportal
            </div>
            <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
              Välkommen{portalDisplayName ? `, ${portalDisplayName}` : ''}
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">
              Här ser du dina fakturor, din förbrukning och dina anläggningar.
              Fakturorna visas först när din faktura har skapats och bekräftats.
            </p>
            <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              <div className="font-semibold">{customerStatus.label}</div>
              <p className="mt-1 leading-6">{customerStatus.message}</p>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-slate-50 px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Kundnummer
            </p>
            <p className="mt-2 text-sm font-medium text-slate-900">
              {primaryCustomer?.customer_number ?? '—'}
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-slate-500">Senaste faktura</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
            {formatInvoiceMoney(latestInvoice?.amount_inc_vat, latestInvoice?.currency)}
          </p>
          <p className="mt-2 text-sm text-slate-600">
            {latestInvoice ? formatPeriod(latestInvoice.period_start, latestInvoice.period_end) : 'Ingen faktura ännu'}
          </p>
        </article>

        <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-slate-500">Senaste förbrukning</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
            {latestConsumption?.totalKwh === null ? 'Summa otillgänglig' : formatKwh(latestConsumption?.totalKwh)}
          </p>
          <p className="mt-2 text-sm text-slate-600">
            {latestConsumption?.label ?? 'Inga mätvärden ännu'}
          </p>
          {latestConsumption?.reviewReasons?.map((reason) => (
            <p key={reason} className="mt-2 text-sm text-slate-600">{PORTAL_CONSUMPTION_REVIEW_NOTICES[reason]}</p>
          ))}
          {latestConsumption?.needsFinerIntervals ? (
            <p className="mt-2 text-sm text-slate-600">{PORTAL_CONSUMPTION_BOUNDARY_NOTICE}</p>
          ) : null}
        </article>

        <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-slate-500">Anläggningar</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
            {sites.length}
          </p>
          <p className="mt-2 text-sm text-slate-600">Kopplade till ditt kundkonto.</p>
        </article>

        <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-slate-500">Mätpunkter</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
            {meteringPoints.length}
          </p>
          <p className="mt-2 text-sm text-slate-600">{meteringPoints.length > 0 ? 'Under dina anläggningar.' : 'Vi visar dem här när anläggningsuppgifterna är verifierade.'}</p>
        </article>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold text-slate-950">Senaste fakturor</h2>
            <Link href="/portal/fakturor" className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Visa alla
            </Link>
          </div>

          <div className="mt-5 space-y-3">
            {invoices.slice(0, 5).map((invoice) => (
              <Link key={invoice.id} href={`/portal/fakturor/${invoice.id}`} className="block rounded-2xl border border-slate-200 p-4 hover:bg-slate-50">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-950">
                      {portalInvoiceTitle(invoice)}
                    </div>
                    <div className="mt-1 text-sm text-slate-500">
                      {formatPeriod(invoice.period_start, invoice.period_end)}
                      {isCancelledOrCreditedInvoice(invoice.status) ? null : <> · Förfallodatum {formatDate(invoice.due_date)}</>}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-slate-950">{formatInvoiceMoney(invoice.amount_inc_vat, invoice.currency)}</div>
                    <span className={`mt-1 inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${invoiceStatusTone(invoice.status)}`}>
                      {invoiceStatusLabel(invoice.status)}
                    </span>
                  </div>
                </div>
              </Link>
            ))}

            {invoices.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
                Du har inga fakturor ännu.
              </div>
            ) : null}
          </div>
        </div>

        <aside className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Så fungerar fakturorna</h2>
          <div className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
            <p>{brandName} tar emot mätvärden från nätägaren och tar fram ditt fakturaunderlag.</p>
            <p>
              Här visas utfärdade fakturor, både de som skapas direkt och de som hanteras via en fakturapartner.
              Preliminära underlag visas inte i fakturalistan.
            </p>
          </div>
        </aside>
      </section>
    </div>
  )
}
