// components/admin/AdminSidebar.tsx
'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  getAdminNavigationGroups,
  type AdminNavigationMode,
  type AdminNavigationItem,
} from '@/lib/admin/navigation'

type AdminSidebarProps = {
  permissions: string[]
  isPlatformAdmin: boolean
  workspaceName?: string | null
  workspaceSubtitle?: string | null
  isCompanyLiveEnabled?: boolean
}

const EXACT_MATCH_ITEMS = new Set(['/admin', '/admin/ediel', '/admin/controltower'])

function isActive(pathname: string, href: string) {
  if (EXACT_MATCH_ITEMS.has(href)) return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}

function modeHref(pathname: string, mode: AdminNavigationMode) {
  return `${pathname}?nav=${mode === 'platform_view' ? 'platform' : 'company'}`
}

function itemIsPlatformOnly(item: Pick<AdminNavigationItem, 'platformOnly'>) {
  return item.platformOnly === true
}

export default function AdminSidebar({
  permissions,
  isPlatformAdmin,
  workspaceName,
  workspaceSubtitle,
  isCompanyLiveEnabled = false,
}: AdminSidebarProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const requestedMode = searchParams.get('nav') === 'company' ? 'company_view' : 'platform_view'
  const mode: AdminNavigationMode = isPlatformAdmin ? requestedMode : 'company_view'
  const displayName = workspaceName?.trim() || (isPlatformAdmin ? 'Gridex Plattform' : 'Ditt bolag')
  const displaySubtitle = workspaceSubtitle?.trim() || (isPlatformAdmin ? 'SaaS-plattform' : 'Bolagsyta')
  const initial = displayName.charAt(0).toUpperCase()

  const visibleGroups = getAdminNavigationGroups({
    permissions,
    isPlatformAdmin,
    isCompanyLiveEnabled,
    mode,
  })

  return (
    <aside className="flex h-screen w-full flex-col border-r border-emerald-100/80 bg-gradient-to-b from-white via-[#fbfdfb] to-[#f7fbf8] text-slate-900 shadow-sm shadow-emerald-950/5">
      <div className="border-b border-emerald-100/80 bg-white/90 px-5 py-5 backdrop-blur-xl">
        <Link
          href="/admin"
          className="group flex items-center gap-3 rounded-3xl border border-emerald-100 bg-white p-3 shadow-sm shadow-emerald-950/5 transition hover:border-emerald-200 hover:shadow-md hover:shadow-emerald-950/10"
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
          <h1 className="mt-3 text-lg font-semibold tracking-tight text-slate-950">
            {mode === 'platform_view' ? 'Kontrollcenter' : 'Driftcenter'}
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            {mode === 'platform_view'
              ? 'Teknisk drift, tenants, Ediel, routes och governance samlat under färre menyer.'
              : isCompanyLiveEnabled
                ? 'Affärsvy för kunder, avtal, byten, mätvärden och faktureringsunderlag.'
                : 'Live Ediel är inte aktiverat än. Arbeta med kundintag, avtal och go-live-status tills live är godkänt.'}
          </p>

          {isPlatformAdmin ? (
            <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-white/70 p-1">
              <Link
                href={modeHref(pathname, 'platform_view')}
                className={`rounded-xl px-3 py-2 text-center text-xs font-semibold transition ${
                  mode === 'platform_view'
                    ? 'bg-emerald-700 text-white shadow-sm shadow-emerald-700/20'
                    : 'text-slate-700 hover:bg-emerald-50 hover:text-emerald-800'
                }`}
              >
                Plattform
              </Link>
              <Link
                href={modeHref(pathname, 'company_view')}
                className={`rounded-xl px-3 py-2 text-center text-xs font-semibold transition ${
                  mode === 'company_view'
                    ? 'bg-emerald-700 text-white shadow-sm shadow-emerald-700/20'
                    : 'text-slate-700 hover:bg-emerald-50 hover:text-emerald-800'
                }`}
              >
                Bolagsvy
              </Link>
            </div>
          ) : null}
        </div>
      </div>

      <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5">
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
                    aria-current={active ? 'page' : undefined}
                    className={`group relative block rounded-2xl border px-3 py-3 transition duration-150 ${
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
