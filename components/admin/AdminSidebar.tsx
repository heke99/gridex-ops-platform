// components/admin/AdminSidebar.tsx
'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  getAdminNavigationGroups,
  type AdminNavigationMode,
} from '@/lib/admin/navigation'
import { findActiveAdminNavigationHref } from '@/lib/admin/navigationMatch'
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

  const activeHref = findActiveAdminNavigationHref(pathname, visibleGroups)

  const prefetchOnIntent = (href: string) => {
    if (activeHref !== href) {
      router.prefetch(href)
    }
  }

  return (
    <aside className="w-full border-b border-emerald-100 bg-white text-slate-900 lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:border-b-0 lg:border-r">
      <div className="border-b border-emerald-100 px-4 py-3">
        <Link
          href="/admin"
          prefetch={false}
          onPointerEnter={() => prefetchOnIntent('/admin')}
          onFocus={() => prefetchOnIntent('/admin')}
          className="flex min-w-0 items-center gap-3 rounded-xl p-1 hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-emerald-700"
        >
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-700 font-bold text-white">{initial}</span>
          <span className="min-w-0">
            <span className="block truncate text-[11px] font-semibold text-emerald-800">{displaySubtitle}</span>
            <span className="block truncate text-sm font-semibold text-slate-950">{displayName}</span>
          </span>
        </Link>

        {!isPlatformAdmin && !isCompanyLiveEnabled ? (
          <p className="mt-2 text-xs leading-5 text-amber-800">Live Ediel är inte aktiverat. Kundintag, avtal och go-live är tillgängliga.</p>
        ) : null}

        {isPlatformAdmin ? (
          <details className="mt-2 rounded-xl border border-emerald-100 bg-emerald-50/60">
            <summary className="cursor-pointer rounded-xl px-3 py-2 text-xs font-semibold text-emerald-900 hover:bg-emerald-100 focus-visible:outline-2 focus-visible:outline-emerald-700">
              Byt vy · {mode === 'platform_view' ? 'Plattform' : 'Bolagsvy'}
            </summary>
            <div className="space-y-3 p-3 pt-1">
              <form action={updateAdminNavigationPreference} className="grid grid-cols-2 gap-2">
                <input type="hidden" name="company_id" value={selectedCompanyId ?? ''} />
                <button type="submit" name="mode" value="platform" aria-pressed={mode === 'platform_view'} className={`rounded-lg px-3 py-2 text-xs font-semibold hover:brightness-95 focus-visible:outline-2 focus-visible:outline-emerald-700 ${mode === 'platform_view' ? 'bg-emerald-700 text-white' : 'border border-emerald-200 bg-white text-slate-700'}`}>Plattform</button>
                <button type="submit" name="mode" value="company" aria-pressed={mode === 'company_view'} className={`rounded-lg px-3 py-2 text-xs font-semibold hover:brightness-95 focus-visible:outline-2 focus-visible:outline-emerald-700 ${mode === 'company_view' ? 'bg-emerald-700 text-white' : 'border border-emerald-200 bg-white text-slate-700'}`}>Bolagsvy</button>
              </form>
              {mode === 'company_view' && companyOptions.length > 0 ? (
                <form action={updateAdminNavigationPreference}>
                  <input type="hidden" name="mode" value="company" />
                  <label className="block text-xs font-semibold text-emerald-900">
                    Aktivt bolag
                    <select name="company_id" value={selectedCompanyId ?? ''} onChange={(event) => event.currentTarget.form?.requestSubmit()} className="mt-1 w-full min-w-0 rounded-lg border border-emerald-200 bg-white px-2 py-2 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-emerald-700">
                      <option value="">Välj bolag</option>
                      {companyOptions.map((company) => <option key={company.id} value={company.id}>{company.name}{company.status ? ` (${company.status})` : ''}</option>)}
                    </select>
                  </label>
                </form>
              ) : null}
            </div>
          </details>
        ) : null}

        <nav aria-label="Huvudnavigation på mobil" className="mt-3 lg:hidden">
          <label htmlFor="admin-page-navigation" className="block text-xs font-semibold text-slate-700">Gå till sida</label>
            <select
              id="admin-page-navigation"
              name="admin_destination"
              value={activeHref ?? ''}
              onChange={(event) => { if (event.target.value) router.push(event.target.value) }}
              className="mt-1 w-full min-w-0 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-emerald-700"
            >
              <option value="" disabled>Välj sida</option>
              {visibleGroups.map((group) => <optgroup key={group.key} label={group.title}>{group.items.map((item) => <option key={item.key} value={item.href}>{item.label}</option>)}</optgroup>)}
            </select>
        </nav>
      </div>

      <nav aria-label="Huvudnavigation" className="hidden min-h-0 flex-1 space-y-2 overflow-y-auto p-3 lg:block">
        {visibleGroups.map((group, index) => (
          <details key={`${group.key}:${pathname}`} open={index === 0 || group.items.some((item) => item.href === activeHref)} className="rounded-xl border border-emerald-100/70">
            <summary className="cursor-pointer rounded-xl px-3 py-2.5 text-sm font-semibold text-emerald-900 hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-emerald-700">{group.title}</summary>
            <div className="space-y-1 px-2 pb-2">
              {group.items.map((item) => {
                const active = item.href === activeHref
                return (
                  <Link key={item.key} href={item.href} prefetch={false} onPointerEnter={() => prefetchOnIntent(item.href)} onFocus={() => prefetchOnIntent(item.href)} aria-current={active ? 'page' : undefined} title={item.description} className={`block rounded-lg border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-emerald-700 ${active ? 'border-emerald-200 bg-emerald-50 font-semibold text-emerald-950' : 'border-transparent text-slate-700 hover:border-emerald-100 hover:bg-emerald-50'}`}>
                    <span className="block break-words">{item.label}</span>
                    {active && item.description ? <span className="mt-1 block text-xs font-normal leading-5 text-emerald-900">{item.description}</span> : null}
                  </Link>
                )
              })}
            </div>
          </details>
        ))}
      </nav>
    </aside>
  )
}
