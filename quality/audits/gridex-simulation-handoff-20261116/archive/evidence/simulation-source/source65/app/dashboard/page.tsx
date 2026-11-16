import Link from 'next/link'
import { readCompanySelectionAccess } from '@/lib/tenant/companySelectionAccess'
import { redirect } from 'next/navigation'
import { getVerifiedAuthUser } from '@/lib/auth/currentUser'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { readAuthenticatedTenantContext } from '@/lib/auth/authenticatedTenantContext'

export const dynamic = 'force-dynamic'

function DashboardCard({
  title,
  description,
  href,
  cta,
  tone = 'default',
}: {
  title: string
  description: string
  href: string
  cta: string
  tone?: 'default' | 'primary'
}) {
  return (
    <div
      className={`rounded-[2rem] border p-6 shadow-sm ${
        tone === 'primary'
          ? 'border-emerald-200 bg-emerald-700 text-white shadow-emerald-700/15'
          : 'border-emerald-100 bg-white shadow-emerald-950/5'
      }`}
    >
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className={`mt-3 text-sm leading-6 ${tone === 'primary' ? 'text-emerald-50/85' : 'text-slate-600'}`}>
        {description}
      </p>
      <div className="mt-6">
        <Link
          href={href}
          className={`inline-flex items-center rounded-2xl px-4 py-2.5 text-sm font-semibold transition ${
            tone === 'primary'
              ? 'bg-white text-emerald-900 hover:bg-emerald-50'
              : 'border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
          }`}
        >
          {cta}
        </Link>
      </div>
    </div>
  )
}

async function userHasPlatformRole(userId: string) {
  try {
    // Only the request-cached, server-verified user below supplies this UID.
    const supabase = await createSupabaseServerClient()
    const context = await readAuthenticatedTenantContext(supabase, userId)
    return context.is_platform_admin
  } catch {
    return false
  }
}

export default async function DashboardPage() {
  const user = await getVerifiedAuthUser()

  if (!user) redirect('/login')

  const [isPlatformAdmin, companyScope] = await Promise.all([
    userHasPlatformRole(user.id),
    getOperationalCompanyScope(user.id),
  ])
  const companyName = companyScope.companyName ?? 'ditt elbolag'
  const selection = !isPlatformAdmin && companyScope.companyId && companyScope.memberships?.length > 1
    ? await readCompanySelectionAccess(companyScope.companyId).catch(() => null)
    : null

  const valueCards = isPlatformAdmin
    ? [
        ['Kunddrift', 'Samlad kundbild med avtal, anläggningar och dokument.'],
        ['Operations', 'Prioriterade ärenden, switchar och avvikelser.'],
        ['Plattformsstyrning', 'Bolag, globala användare och rollstyrning.'],
        ['Handoff', 'Underlag och externa flöden med spårbarhet.'],
      ]
    : [
        ['Kunddrift', 'Kunder, avtal, anläggningar och dokument för ditt bolag.'],
        ['Operations', 'Fullmakter, leverantörsbyten, mätdata och avvikelser.'],
        ['Ediel och routing', 'Bolagets egna Edielflöden, kvittenser och aktörsprofil.'],
        ['Fakturaunderlag', 'Mätvärden, underlag och exportstatus för ditt bolag.'],
      ]

  return (
    <div className="space-y-8">
      <section className="rounded-[2.25rem] border border-emerald-100 bg-gradient-to-br from-white to-emerald-50 p-8 shadow-sm shadow-emerald-950/5">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="inline-flex items-center rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">
              {isPlatformAdmin ? 'Plattformsöversikt' : 'Bolagsyta'}
            </div>

            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
              {isPlatformAdmin ? 'Gridex Platform Operations' : `Välkommen till ${companyName}`}
            </h1>

            <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600 sm:text-lg">
              {isPlatformAdmin
                ? 'Härifrån hanteras plattformens bolag, globala användare, roller, Ediel-regler och driftuppföljning.'
                : 'Härifrån hanterar ditt team kunder, avtal, anläggningar, mätpunkter, leverantörsbyten, mätdata och operativa uppföljningar för ert eget bolag.'}
            </p>
          </div>

          <div className="rounded-3xl border border-white bg-white/80 px-5 py-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Inloggad</p>
            <p className="mt-2 text-sm font-semibold text-slate-900">{user.email ?? 'Användare'}</p>
          </div>
        </div>
      </section>

      {selection && selection.companies.length > 1 ? (
        <form method="post" action="/dashboard/company-selection" className="flex flex-wrap items-center gap-3 rounded-3xl border border-emerald-100 bg-white p-5">
          <label htmlFor="dashboard-company" className="text-sm font-semibold">Aktivt bolag</label>
          <select id="dashboard-company" name="company_id" defaultValue={selection.selectedCompanyId} className="rounded-xl border border-emerald-200 px-3 py-2">
            {selection.companies.map(company => <option key={company.companyId} value={company.companyId}>{company.companyName}</option>)}
          </select>
          <button type="submit" className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">Välj bolag</button>
        </form>
      ) : null}

      <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {valueCards.map(([title, body]) => (
          <div key={title} className="rounded-[2rem] border border-emerald-100 bg-white p-6 shadow-sm shadow-emerald-950/5">
            <p className="text-sm font-semibold text-emerald-700">{title}</p>
            <p className="mt-3 text-sm leading-6 text-slate-600">{body}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <DashboardCard
          title={isPlatformAdmin ? 'Plattformens kontrollcenter' : 'Öppna bolagets arbetsyta'}
          description={
            isPlatformAdmin
              ? 'Öppna superadminytan för plattformens bolag, användare, roller, kunddrift, operations och systemkontroll.'
              : 'Öppna arbetsytan för kunddrift, operations, Ediel, mätvärden och faktureringsunderlag inom ditt eget bolag.'
          }
          href="/admin"
          cta={isPlatformAdmin ? 'Öppna plattform' : 'Öppna arbetsyta'}
          tone="primary"
        />

        {isPlatformAdmin ? (
          <DashboardCard
            title="Bolag på plattformen"
            description="Skapa, pausa och granska elhandelsbolag. Den här vägen är endast för superadmin/platform admin."
            href="/admin/companies"
            cta="Öppna bolag"
          />
        ) : (
          <DashboardCard
            title="Bolagsinställningar"
            description="Hantera ert eget bolags kontaktuppgifter, Ediel-profil och interna användare."
            href="/admin/company-settings"
            cta="Öppna inställningar"
          />
        )}

        <DashboardCard
          title="Operations"
          description="Följ kundintag, fullmakter, leverantörsbyten, mätdata och operativa avvikelser."
          href="/admin/operations"
          cta="Öppna operations"
        />

        <DashboardCard
          title="Kundregister"
          description="Sök kund, öppna kundkort och följ anläggningar, mätpunkter, avtal och intern historik."
          href="/admin/customers"
          cta="Öppna kunder"
        />
      </section>
    </div>
  )
}
