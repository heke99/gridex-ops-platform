import Link from 'next/link'

export const revalidate = 3600

const platformHighlights = [
  'Kundintag och kundregister',
  'Anläggningar och mätpunkter',
  'Fullmakter och leverantörsbyten',
  'Avtal, kampanjer och prislogik',
  'Ediel-flöden och kvittenser',
  'Mätvärden och faktureringsunderlag',
]

const capabilities = [
  {
    title: 'Operations för elhandel',
    description:
      'Samla kundintag, fullmakter, switchärenden, anläggningsdata och avvikelser i en arbetsyta som är byggd för daglig drift.',
  },
  {
    title: 'Bolagsseparerad SaaS-modell',
    description:
      'Varje elhandelsbolag arbetar i sin egen miljö med egna användare, roller, kunder, avtal och operativa flöden.',
  },
  {
    title: 'Ediel kopplat till kundbilden',
    description:
      'Meddelanden och kvittenser ska kopplas till rätt kund, anläggning, mätpunkt och ärende utan att blanda driftdata mellan bolag.',
  },
  {
    title: 'Redo för partnerhandoff',
    description:
      'Exportera och följ upp data till faktureringspartner, integrationsflöden och interna kontrollpunkter med tydlig spårbarhet.',
  },
]

const workflowSteps = [
  'Skapa eller importera kund',
  'Koppla avtal och kampanj',
  'Samla fullmakt och anläggningsdata',
  'Starta och följ leverantörsbyte',
  'Synka mätvärden och underlag',
  'Följ avvikelser i operations',
]

export default function LandingPage() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#f7fbf8] text-slate-950">
      <section className="relative isolate border-b border-emerald-100 bg-gradient-to-br from-white via-emerald-50/70 to-[#f7fbf8]">
        <div className="absolute inset-x-0 top-0 -z-10 h-64 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.18),transparent_35%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.12),transparent_35%)]" />

        <header className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-6 sm:px-8">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-700 text-lg font-bold text-white shadow-sm shadow-emerald-700/20">
              G
            </span>
            <span>
              <span className="block text-sm font-semibold uppercase tracking-[0.2em] text-emerald-800">
                Gridex
              </span>
              <span className="block text-xs font-medium text-slate-500">
                Energy Operations Platform
              </span>
            </span>
          </Link>

          <nav className="hidden items-center gap-2 md:flex">
            <a href="#platform" className="rounded-full px-4 py-2 text-sm font-medium text-slate-600 hover:bg-white/70 hover:text-slate-950">
              Plattform
            </a>
            <a href="#workflow" className="rounded-full px-4 py-2 text-sm font-medium text-slate-600 hover:bg-white/70 hover:text-slate-950">
              Flöde
            </a>
            <a href="#saas" className="rounded-full px-4 py-2 text-sm font-medium text-slate-600 hover:bg-white/70 hover:text-slate-950">
              SaaS
            </a>
          </nav>

          <Link
            href="/login"
            className="rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-semibold text-white shadow-sm shadow-emerald-700/20 transition hover:bg-emerald-800"
          >
            Logga in
          </Link>
        </header>

        <div className="mx-auto grid max-w-7xl gap-12 px-6 pb-20 pt-12 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:pb-28 lg:pt-20">
          <div className="max-w-3xl">
            <div className="inline-flex rounded-full border border-emerald-200 bg-white/80 px-4 py-2 text-sm font-semibold text-emerald-800 shadow-sm">
              SaaS-plattform för moderna elhandelsbolag
            </div>
            <h1 className="mt-7 text-5xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-6xl lg:text-7xl">
              Drift, kunder och Ediel i ett sammanhållet system.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
              Gridex samlar kundintag, avtal, fullmakter, anläggningar, mätpunkter,
              leverantörsbyten och operativa ärenden i en professionell arbetsyta för
              elhandelsteam.
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/login"
                className="inline-flex items-center justify-center rounded-2xl bg-slate-950 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-slate-950/10 transition hover:bg-slate-800"
              >
                Öppna plattformen
              </Link>
              <a
                href="#platform"
                className="inline-flex items-center justify-center rounded-2xl border border-emerald-200 bg-white px-6 py-3.5 text-sm font-semibold text-emerald-900 shadow-sm transition hover:bg-emerald-50"
              >
                Se funktionerna
              </a>
            </div>

            <div className="mt-9 grid gap-3 sm:grid-cols-2">
              {platformHighlights.map((item) => (
                <div key={item} className="flex items-center gap-3 rounded-2xl border border-white/80 bg-white/75 px-4 py-3 text-sm font-medium text-slate-700 shadow-sm shadow-emerald-950/5 backdrop-blur">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[2.25rem] border border-emerald-100 bg-white/90 p-5 shadow-2xl shadow-emerald-950/10 backdrop-blur">
            <div className="rounded-[1.75rem] bg-slate-950 p-5 text-white">
              <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200">
                    Operations
                  </p>
                  <h2 className="mt-1 text-xl font-semibold">Daglig prioritering</h2>
                </div>
                <span className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-semibold text-emerald-200">
                  Bolagsseparerad
                </span>
              </div>

              <div className="mt-5 grid gap-3">
                {[
                  ['Kunder under onboarding', '24', 'Fullmakt, avtal och anläggning'],
                  ['Switchärenden', '12', 'Pågående leverantörsbyten'],
                  ['Åtgärder i kö', '7', 'Meddelanden och avvikelser'],
                  ['Klara för handoff', '18', 'Underlag till partner'],
                ].map(([label, value, hint]) => (
                  <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-white">{label}</p>
                        <p className="mt-1 text-xs text-slate-400">{hint}</p>
                      </div>
                      <p className="text-2xl font-semibold text-emerald-200">{value}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5 rounded-[1.75rem] border border-emerald-100 bg-emerald-50 p-5">
              <p className="text-sm font-semibold text-emerald-950">Kundkoppling</p>
              <p className="mt-2 text-sm leading-6 text-emerald-900/75">
                Inkommande data matchas mot kundnummer, org-/personnummer,
                anläggnings-id, mätpunkts-id och Ediel-referenser inom rätt bolagsmiljö.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="platform" className="mx-auto max-w-7xl px-6 py-20 sm:px-8">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-700">Plattform</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            Byggd för team som driver elhandel varje dag
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-600">
            Systemet ger en tydlig arbetsyta för affärsflödena runt kunder,
            avtal, leverantörsbyte, mätdata och operativa kontroller.
          </p>
        </div>

        <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {capabilities.map((item) => (
            <article key={item.title} className="rounded-[2rem] border border-emerald-100 bg-white p-6 shadow-sm shadow-emerald-950/5">
              <h3 className="text-lg font-semibold text-slate-950">{item.title}</h3>
              <p className="mt-3 text-sm leading-6 text-slate-600">{item.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="workflow" className="border-y border-emerald-100 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-20 sm:px-8">
          <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-700">Flöde</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
                Från ny kund till kontrollerad drift
              </h2>
              <p className="mt-4 text-base leading-7 text-slate-600">
                Varje steg ska kunna följas, korrigeras och granskas utan att operatören behöver jaga data mellan olika vyer.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {workflowSteps.map((step, index) => (
                <div key={step} className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-emerald-700 text-sm font-semibold text-white">
                      {index + 1}
                    </span>
                    <p className="font-semibold text-slate-950">{step}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="saas" className="mx-auto max-w-7xl px-6 py-20 sm:px-8">
        <div className="rounded-[2.25rem] border border-emerald-100 bg-gradient-to-br from-slate-950 to-emerald-950 p-8 text-white shadow-2xl shadow-emerald-950/15 sm:p-10 lg:p-12">
          <div className="grid gap-8 lg:grid-cols-[1fr_0.8fr] lg:items-center">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-200">SaaS</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
                Plattform för flera elhandelsbolag, med tydlig bolagsseparation.
              </h2>
              <p className="mt-4 max-w-2xl text-base leading-7 text-emerald-50/80">
                Superadmin kan skapa och bjuda in nya bolag. Varje bolag kan därefter
                hantera sina användare, roller och dagliga processer inom sin egen bolagsmiljö.
              </p>
            </div>

            <div className="grid gap-3">
              {['Superadmin skapar bolag', 'Bolagsansvarig bjuder in team', 'Roller styr arbetsytor', 'Kunddata hålls bolagsseparerad'].map((item) => (
                <div key={item} className="rounded-2xl border border-white/10 bg-white/[0.08] px-4 py-3 text-sm font-semibold text-white">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
