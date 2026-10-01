// components/admin/AdminSidebar.tsx
'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  getAdminNavigationGroups,
  type AdminNavigationMode,
} from '@/lib/admin/navigation'
import { updateAdminNavigationPreference } from '@/app/admin/navigation-mode/actions'

type AdminSidebarProps = {
  permissions: string[]
  roles: string[]
  isPlatformAdmin: boolean
  workspaceName?: string | null
  workspaceSubtitle?: string | null
  isCompanyLiveEnabled?: boolean
  preferredMode?: AdminNavigationMode
  selectedCompanyId?: string | null
  companyOptions?: Array<{ id: string; name: string; status?: string | null }>
  compact?: boolean
}

const EXACT_MATCH_ITEMS = new Set([
  '/admin',
  '/admin/ediel',
  '/admin/controltower',
  '/admin/billing',
  '/admin/ediel/test-center',
])

function isActive(pathname: string, href: string) {
  if (EXACT_MATCH_ITEMS.has(href)) return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}

function itemIsPlatformOnly(item: { platformOnly?: boolean }) {
  return item.platformOnly === true
}

export default function AdminSidebar({
  permissions,
  roles,
  isPlatformAdmin,
  workspaceName,
  workspaceSubtitle,
  isCompanyLiveEnabled = false,
  preferredMode = 'platform_view',
  selectedCompanyId = null,
  companyOptions = [],
  compact = false,
}: AdminSidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const mode: AdminNavigationMode = isPlatformAdmin ? preferredMode : 'company_view'
  const displayName = workspaceName?.trim() || (isPlatformAdmin ? 'Gridex Plattform' : 'Ditt bolag')
  const displaySubtitle = workspaceSubtitle?.trim() || (isPlatformAdmin ? 'SaaS-plattform' : 'Bolagsyta')
  const initial = displayName.charAt(0).toUpperCase()

  const visibleGroups = getAdminNavigationGroups({
    permissions,
    roles,
    isPlatformAdmin,
    isCompanyLiveEnabled,
    mode,
  })

  const prefetchOnIntent = (href: string) => {
    if (!isActive(pathname, href)) {
      router.prefetch(href)
    }
  }

  return (
    <aside aria-label={mode === 'platform_view' ? 'Plattformens arbetsyta' : 'Tenantens arbetsyta'} className={`flex ${compact ? 'max-h-[75dvh] overflow-y-auto overscroll-contain' : 'h-dvh'} w-full flex-col border-r border-emerald-100/80 bg-gradient-to-b from-white via-[#fbfdfb] to-[#f7fbf8] text-slate-900 shadow-sm shadow-emerald-950/5`}>
      <div className="shrink-0 border-b border-emerald-100/80 bg-white/90 px-5 py-5 backdrop-blur-xl">
        <Link
          href="/admin"
          prefetch={false}
          onPointerEnter={() => prefetchOnIntent('/admin')}
          onFocus={() => prefetchOnIntent('/admin')}
          className="group flex items-center gap-3 rounded-3xl border border-emerald-100 bg-white p-3 shadow-sm shadow-emerald-950/5 transition hover:border-emerald-200 hover:shadow-md hover:shadow-emerald-950/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-700 text-base font-bold text-white shadow-sm shadow-emerald-700/20">
            {initial}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-xs font-semibold uppercase tracking-[0.2em] text-emerald-800">
              {displaySubtitle}
            </span>
            <span className="mt-0.5 block truncate text-sm font-semibold text-slate-950">
              {displayName}
            </span>
          </span>
        </Link>

        <div className="mt-5 rounded-3xl border border-emerald-100 bg-emerald-50/60 p-4">
          <div className="inline-flex rounded-full border border-emerald-200 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-800">
            {mode === 'platform_view' ? 'Plattformskontroll' : 'Bolagsyta'}
          </div>
          <p className="mt-3 text-lg font-semibold tracking-tight text-slate-950">
            {mode === 'platform_view' ? 'Kontrollcenter' : 'Driftcenter'}
          </p>
          <p className={`${compact ? 'hidden' : 'mt-2'} text-sm leading-6 text-slate-700`}>
            {mode === 'platform_view'
              ? 'Teknisk drift, tenants, Ediel, routes och governance samlat under färre menyer.'
              : isCompanyLiveEnabled
                ? 'Affärsvy för kunder, avtal, byten, mätvärden och faktureringsunderlag.'
                : 'Live Ediel är inte aktiverat än. Arbeta med kundintag, avtal och go-live-status tills live är godkänt.'}
          </p>

          {isPlatformAdmin ? (
            <form action={updateAdminNavigationPreference} className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-white/70 p-1">
              <input type="hidden" name="company_id" value={selectedCompanyId ?? ''} />
              <button
                type="submit"
                name="mode"
                value="platform"
                aria-pressed={mode === 'platform_view'}
                className={`min-h-11 rounded-xl px-3 py-2 text-center text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 ${
                  mode === 'platform_view'
                    ? 'bg-emerald-700 text-white shadow-sm shadow-emerald-700/20'
                    : 'text-slate-700 hover:bg-emerald-50 hover:text-emerald-800'
                }`}
              >
                Plattform
              </button>
              <button
                type="submit"
                name="mode"
                value="company"
                aria-pressed={mode === 'company_view'}
                className={`min-h-11 rounded-xl px-3 py-2 text-center text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 ${
                  mode === 'company_view'
                    ? 'bg-emerald-700 text-white shadow-sm shadow-emerald-700/20'
                    : 'text-slate-700 hover:bg-emerald-50 hover:text-emerald-800'
                }`}
              >
                Bolagsvy
              </button>
            </form>
          ) : null}

          {mode === 'company_view' && companyOptions.length > (isPlatformAdmin ? 0 : 1) ? (
            <form action={updateAdminNavigationPreference} className="mt-3 block">
              <input type="hidden" name="mode" value="company" />
              <label>
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-900">
                  Aktivt bolag
                </span>
                <select
                  name="company_id"
                  value={selectedCompanyId ?? ''}
                  onChange={(event) => event.currentTarget.form?.requestSubmit()}
                  className="mt-1 min-h-11 w-full rounded-2xl border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
                >
                  <option value="">Välj bolag</option>
                  {companyOptions.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.name}{company.status ? ` (${company.status})` : ''}
                    </option>
                  ))}
                </select>
              </label>
            </form>
          ) : null}
        </div>
      </div>

      <nav aria-label={mode === 'platform_view' ? 'Plattformsnavigation' : 'Tenantnavigation'} className={`${compact ? 'shrink-0' : 'min-h-0 flex-1 overflow-y-auto'} space-y-5 px-4 py-5`}>
        {visibleGroups.map((group) => (
          <section key={group.key} className="rounded-3xl border border-transparent p-1">
            <div className="px-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-800">
                {group.title}
              </h2>
              <p className="mt-1 text-xs leading-5 text-slate-700">{group.description}</p>
            </div>

            <div className="mt-3 space-y-1.5">
              {group.items.map((item) => {
                const active = isActive(pathname, item.href)

                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    prefetch={false}
                    onPointerEnter={() => prefetchOnIntent(item.href)}
                    onFocus={() => prefetchOnIntent(item.href)}
                    aria-current={active ? 'page' : undefined}
                    className={`group relative block rounded-2xl border px-3 py-3 transition duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 ${
                      active
                        ? 'border-emerald-200 bg-white text-slate-950 shadow-sm shadow-emerald-950/5 ring-1 ring-emerald-100'
                        : 'border-transparent text-slate-700 hover:border-emerald-100 hover:bg-white/85 hover:text-slate-950 hover:shadow-sm hover:shadow-emerald-950/5'
                    }`}
                  >
                    <span
                      className={`absolute left-0 top-3 h-8 w-1 rounded-r-full transition ${
                        active ? 'bg-emerald-600' : 'bg-transparent group-hover:bg-emerald-200'
                      }`}
                    />
                    <div className="pl-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold">{item.label}</div>
                        {itemIsPlatformOnly(item) && mode === 'platform_view' ? (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                            Plattform
                          </span>
                        ) : active ? (
                          <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/40" />
                        ) : null}
                      </div>
                      {item.description ? (
                        <div className={`mt-1 text-xs leading-5 ${active ? 'text-emerald-800' : 'text-slate-700 group-hover:text-slate-700'}`}>
                          {item.description}
                        </div>
                      ) : null}
                    </div>
                  </Link>
                )
              })}
            </div>
          </section>
        ))}
      </nav>
    </aside>
  )
}
