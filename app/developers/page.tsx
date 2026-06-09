import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Developers | Gridex',
  description: 'Gridex utvecklardokumentation och API-guider.',
}

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
            Gridex Developer Documentation
          </h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-600">
            Här finns teknisk dokumentation för hemsidor, kundportaler och partnerintegrationer som ska koppla mot Gridex Ops Platform.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-12 sm:px-8">
        <Link
          href="/developers/customer-portal-api"
          className="block rounded-[2rem] border border-emerald-100 bg-white p-8 shadow-sm shadow-emerald-950/5 transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-emerald-950/10"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Customer Portal API</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Koppla extern hemsida till Gridex API</h2>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
            Guide för hur en extern hemsida, white-label kundportal eller partnerportal skapar kundansökningar, hämtar anläggningar/avtal/fakturor/mätvärden och tar emot webhooks från Gridex Ops API.
          </p>
          <span className="mt-6 inline-flex rounded-2xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">
            Öppna API-guiden
          </span>
        </Link>
      </section>
    </main>
  )
}
