import { sanitizeExternalContractFlash } from '@/lib/external-contracts/publicIntakeFlash'
import { submitExternalContractAction } from './actions'


export default async function PublicContractIntakePage({ searchParams }: { searchParams?: Promise<{ bolag?: string; offer_reference?: string; status?: string; message?: string }> }) {
  const params = searchParams ? await searchParams : {}
  const companySlug = params?.bolag?.trim() ?? ''
  const offerReference = params?.offer_reference?.trim() ?? ''
  const flash = sanitizeExternalContractFlash(params?.status, params?.message)

  return (
    <main className="min-h-screen bg-slate-100 px-6 py-10 text-slate-950">
      <div className="mx-auto max-w-4xl space-y-6">
        <section className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">Elavtal</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight">Teckna avtal</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-700">
            Fyll i dina uppgifter så skickas din avtalsbegäran till elhandelsbolaget för granskning. Bytet av elleverantör startar först när bolaget har verifierat dina uppgifter.
          </p>
        </section>

        {flash ? (
          <section className={`rounded-3xl border p-5 text-sm font-semibold ${flash.status === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'}`}>
            {flash.message}
          </section>
        ) : null}

        {!companySlug || !offerReference ? (
          <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-sm leading-6 text-amber-900">
            Avtalsformuläret saknar en verifierbar bolags- eller avtalsreferens. Öppna formuläret via knappen på det publicerade avtalet.
          </section>
        ) : (
        <form action={submitExternalContractAction} className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
          <input type="hidden" name="company_slug" value={companySlug} />
          <input type="hidden" name="offer_reference" value={offerReference} />

          <div className="grid gap-5 md:grid-cols-2">
            <label className="text-sm font-medium text-slate-700">Kundtyp
              <select name="customer_type" className="mt-2 h-11 w-full rounded-2xl border border-slate-300 bg-white px-4 text-sm">
                <option value="private">Privatperson</option>
                <option value="business">Företag</option>
              </select>
            </label>
            <label className="text-sm font-medium text-slate-700">Önskat startdatum
              <input name="requested_start_date" type="date" className="mt-2 h-11 w-full rounded-2xl border border-slate-300 px-4 text-sm" />
            </label>
            <label className="text-sm font-medium text-slate-700">Förnamn
              <input name="first_name" className="mt-2 h-11 w-full rounded-2xl border border-slate-300 px-4 text-sm" />
            </label>
            <label className="text-sm font-medium text-slate-700">Efternamn
              <input name="last_name" className="mt-2 h-11 w-full rounded-2xl border border-slate-300 px-4 text-sm" />
            </label>
            <label className="text-sm font-medium text-slate-700">Företagsnamn
              <input name="company_name" className="mt-2 h-11 w-full rounded-2xl border border-slate-300 px-4 text-sm" />
            </label>
            <label className="text-sm font-medium text-slate-700">Organisationsnummer
              <input name="org_number" className="mt-2 h-11 w-full rounded-2xl border border-slate-300 px-4 text-sm" />
            </label>
            <label className="text-sm font-medium text-slate-700">Personnummer
              <input name="personal_number" className="mt-2 h-11 w-full rounded-2xl border border-slate-300 px-4 text-sm" />
            </label>
            <label className="text-sm font-medium text-slate-700">E-post
              <input name="email" type="email" required className="mt-2 h-11 w-full rounded-2xl border border-slate-300 px-4 text-sm" />
            </label>
            <label className="text-sm font-medium text-slate-700">Telefon
              <input name="phone" className="mt-2 h-11 w-full rounded-2xl border border-slate-300 px-4 text-sm" />
            </label>
            <label className="text-sm font-medium text-slate-700">Anläggnings-ID
              <input name="facility_id" className="mt-2 h-11 w-full rounded-2xl border border-slate-300 px-4 text-sm" />
            </label>
            <label className="text-sm font-medium text-slate-700">Mätpunkts-ID
              <input name="meter_point_id" className="mt-2 h-11 w-full rounded-2xl border border-slate-300 px-4 text-sm" />
            </label>
            <label className="text-sm font-medium text-slate-700">Prisområde
              <select name="price_area_code" className="mt-2 h-11 w-full rounded-2xl border border-slate-300 bg-white px-4 text-sm">
                <option value="">Vet ej</option>
                <option value="SE1">SE1</option>
                <option value="SE2">SE2</option>
                <option value="SE3">SE3</option>
                <option value="SE4">SE4</option>
              </select>
            </label>
            <label className="text-sm font-medium text-slate-700 md:col-span-2">Adress
              <input name="street" className="mt-2 h-11 w-full rounded-2xl border border-slate-300 px-4 text-sm" />
            </label>
            <label className="text-sm font-medium text-slate-700">Postnummer
              <input name="postal_code" className="mt-2 h-11 w-full rounded-2xl border border-slate-300 px-4 text-sm" />
            </label>
            <label className="text-sm font-medium text-slate-700">Ort
              <input name="city" className="mt-2 h-11 w-full rounded-2xl border border-slate-300 px-4 text-sm" />
            </label>
            <label className="text-sm font-medium text-slate-700">Inflyttsdatum
              <input name="move_in_date" type="date" className="mt-2 h-11 w-full rounded-2xl border border-slate-300 px-4 text-sm" />
            </label>
          </div>

          <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
            Genom att skicka in formuläret begär du att elhandelsbolaget granskar dina uppgifter. Avtalet börjar gälla först när bolaget har verifierat uppgifter, fullmakt och övriga förutsättningar.
          </div>

          <button className="mt-6 rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-800">
            Skicka avtalsbegäran
          </button>
        </form>
        )}
      </div>
    </main>
  )
}
