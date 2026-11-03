import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Utvecklardokumentation | Gridex',
  description: 'Gridex utvecklardokumentation och API-guider.',
}

// Public, static documentation with no tenant/customer/private data.
// Safe to serve from the CDN with ISR (Group A).
export const revalidate = 3600

export default function DevelopersPage() {
  return (
    <main className="min-h-screen bg-[#f7fbf8] text-slate-950">
      <section className="border-b border-emerald-100 bg-gradient-to-br from-white via-emerald-50 to-[#f7fbf8]">
        <div className="mx-auto max-w-5xl px-6 py-16 sm:px-8 lg:py-24">
          <Link href="/" className="inline-flex items-center gap-3 rounded-full border border-emerald-100 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 shadow-sm">
            ← Till Gridex
          </Link>
          <h1 className="mt-8 text-4xl font-semibold tracking-[-0.035em] sm:text-6xl">
            Guider för Gridex API
          </h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-600">
            Guider för att koppla din webbplats, Mina sidor och dina partnerintegrationer till Gridex API.
          </p>
          <p className="mt-3 max-w-3xl text-base leading-7 text-slate-700">
            Du kan fortsätta använda en API-version som stöds även när dokumentationen uppdateras.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-12 sm:px-8">
        <Link
          href="/developers/customer-portal-api"
          className="block rounded-[2rem] border border-emerald-100 bg-white p-8 shadow-sm shadow-emerald-950/5 transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-emerald-950/10"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Webb och kundportal</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Koppla hemsida och Mina sidor till Gridex API</h2>
          <p className="mt-3 max-w-3xl text-base leading-7 text-slate-600">
            Lär dig att visa avtal, ta emot kundansökningar och koppla kundernas inloggning till Mina sidor. Guiden visar också hur du hämtar kunduppgifter och tar emot automatiska uppdateringar från Gridex.
          </p>
          <span className="mt-6 inline-flex rounded-2xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">
            Öppna online-guiden
          </span>
        </Link>
      </section>
    </main>
  )
}
