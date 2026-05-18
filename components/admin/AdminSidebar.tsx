'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  getAdminPageRequirement,
  hasPermissionRequirement,
  type AdminPageKey,
} from '@/lib/admin/accessModel'

type NavTone = 'default' | 'primary' | 'warning'

type NavItem = {
  href: string
  label: string
  description?: string
  pageKey?: AdminPageKey
  tone?: NavTone
}

type NavGroup = {
  title: string
  description?: string
  items: NavItem[]
}

type AdminSidebarProps = {
  permissions: string[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Start',
    description: 'Daglig överblick och nästa åtgärd.',
    items: [
      {
        href: '/admin',
        label: 'Dashboard',
        description: 'Status för kunder, operations och Ediel',
        pageKey: 'dashboard',
        tone: 'primary',
      },
      {
        href: '/admin/operations',
        label: 'Operations',
        description: 'Switchar, tasks och blockerare',
        pageKey: 'operations.control_tower',
      },
    ],
  },
  {
    title: 'Kunder',
    description: 'Det operativa kundarbetet.',
    items: [
      {
        href: '/admin/customers',
        label: 'Kundlista',
        description: 'Sök kund och öppna kundkort',
        pageKey: 'customers.list',
        tone: 'primary',
      },
      {
        href: '/admin/customers/intake',
        label: 'Ny kund',
        description: 'Skapa eller importera kund',
        pageKey: 'customers.intake',
      },
      {
        href: '/admin/contracts',
        label: 'Avtal',
        description: 'Avtalskatalog och kampanjer',
        pageKey: 'contracts.catalog',
      },
      {
        href: '/admin/customers/segments',
        label: 'Segment',
        description: 'Kundgrupper och uppföljning',
        pageKey: 'customers.segments',
      },
    ],
  },
  {
    title: 'Ediel',
    description: 'AGT, meddelanden och drift. Inga manuella filgeneratorer i huvudflödet.',
    items: [
      {
        href: '/admin/ediel/agt',
        label: 'AGT leverantör',
        description: 'L1/L7 outbound, L2-L5 inbound',
        pageKey: 'ediel.workspace',
        tone: 'primary',
      },
      {
        href: '/admin/ediel/messages',
        label: 'Meddelanden',
        description: 'Inbox, outbox, payload och ACK-kedjor',
        pageKey: 'ediel.workspace',
      },
      {
        href: '/admin/ediel/control-tower',
        label: 'Control tower',
        description: 'Fel, väntande kvittenser och länkningsproblem',
        pageKey: 'ediel.workspace',
        tone: 'warning',
      },
      {
        href: '/admin/ediel/routes',
        label: 'Routes',
        description: 'Ediel-id, SMTP och runtime-profiler',
        pageKey: 'ediel.routes',
      },
      {
        href: '/admin/ediel/settings',
        label: 'Settings',
        description: 'Aktörskort, versioner och ack-policy',
        pageKey: 'ediel.routes',
      },
    ],
  },
  {
    title: 'Outbound',
    description: 'Extern kommunikation och undantag.',
    items: [
      {
        href: '/admin/outbound',
        label: 'Outbound queue',
        description: 'Dispatch, retry och ack-status',
        pageKey: 'outbound.queue',
      },
      {
        href: '/admin/outbound/unresolved',
        label: 'Unresolved',
        description: 'Saknar route eller kanal',
        pageKey: 'outbound.unresolved',
        tone: 'warning',
      },
      {
        href: '/admin/outbound/ready-switches',
        label: 'Bulk switch',
        description: 'Köa redo leverantörsbyten',
        pageKey: 'outbound.ready_switches',
      },
      {
        href: '/admin/outbound/missing-meter-values',
        label: 'Saknade mätvärden',
        description: 'Bulkbegäran för mätvärden',
        pageKey: 'outbound.missing_meter_values',
      },
      {
        href: '/admin/outbound/missing-billing-underlays',
        label: 'Saknat billingunderlag',
        description: 'Bulkbegäran för fakturaunderlag',
        pageKey: 'outbound.missing_billing_underlays',
      },
    ],
  },
  {
    title: 'Data',
    description: 'Masterdata och interna register.',
    items: [
      {
        href: '/admin/network-owners',
        label: 'Nätägare',
        description: 'Elnät, Ediel-id och områden',
        pageKey: 'masterdata.network_owners',
      },
      {
        href: '/admin/electricity-suppliers',
        label: 'Elleverantörer',
        description: 'Leverantörsregister',
        pageKey: 'masterdata.electricity_suppliers',
      },
      {
        href: '/admin/price-area-localities',
        label: 'Elområden',
        description: 'SE1-SE4 och orter',
        pageKey: 'masterdata.price_area_localities',
      },
      {
        href: '/admin/metering',
        label: 'Mätvärden',
        description: 'Requests och inkomna värden',
        pageKey: 'metering.workspace',
      },
      {
        href: '/admin/billing',
        label: 'Billing',
        description: 'Underlag till fakturering',
        pageKey: 'billing.workspace',
      },
      {
        href: '/admin/partner-exports',
        label: 'Partnerexporter',
        description: 'Handoff till extern fakturering',
        pageKey: 'partner_exports.workspace',
      },
      {
        href: '/admin/integrations/routes',
        label: 'Integration routes',
        description: 'Kommunikation utanför Ediel',
        pageKey: 'integrations.routes',
      },
    ],
  },
  {
    title: 'Admin',
    description: 'Behörighet och spårbarhet.',
    items: [
      {
        href: '/admin/users',
        label: 'Användare',
        description: 'Konton, roller och overrides',
        pageKey: 'users.list',
      },
      {
        href: '/admin/roles',
        label: 'Roller',
        description: 'RBAC och behörigheter',
        pageKey: 'roles.catalog',
      },
      {
        href: '/admin/audit',
        label: 'Audit',
        description: 'Loggar och ändringshistorik',
        pageKey: 'audit.log',
      },
    ],
  },
]

function isActive(pathname: string, href: string) {
  if (href === '/admin') return pathname === '/admin'
  return pathname === href || pathname.startsWith(`${href}/`)
}

function canAccessNavItem(currentPermissions: string[], item: NavItem) {
  if (!item.pageKey) return true
  return hasPermissionRequirement(
    currentPermissions,
    getAdminPageRequirement(item.pageKey)
  )
}

function itemToneClass(active: boolean, tone: NavTone = 'default') {
  if (active) return 'border-slate-500 bg-slate-800 text-white shadow-sm'

  if (tone === 'primary') {
    return 'border-slate-700/70 bg-slate-900/70 text-white hover:border-slate-600 hover:bg-slate-800'
  }

  if (tone === 'warning') {
    return 'border-amber-500/30 bg-amber-500/10 text-amber-100 hover:border-amber-400/50 hover:bg-amber-500/20'
  }

  return 'border-transparent text-slate-200 hover:border-slate-800 hover:bg-slate-900'
}

export default function AdminSidebar({ permissions }: AdminSidebarProps) {
  const pathname = usePathname()

  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => canAccessNavItem(permissions, item)),
  })).filter((group) => group.items.length > 0)

  return (
    <aside className="flex h-screen w-full flex-col border-r border-slate-800 bg-slate-950 text-slate-100">
      <div className="border-b border-slate-800 px-5 py-5">
        <Link href="/admin" className="block rounded-3xl border border-slate-800 bg-slate-900/70 p-4 transition hover:bg-slate-900">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Gridex Ops
              </div>
              <h1 className="mt-1 text-lg font-semibold tracking-tight text-white">
                Admin Console
              </h1>
            </div>
            <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-xs font-semibold text-emerald-200">
              SaaS-ready
            </span>
          </div>
          <p className="mt-3 text-sm leading-5 text-slate-400">
            Kund, switching, Ediel och billing i ett tydligt operationsflöde.
          </p>
        </Link>
      </div>

      <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5">
        {visibleGroups.map((group) => (
          <section key={group.title}>
            <div className="mb-2 px-2">
              <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                {group.title}
              </h2>
              {group.description ? (
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  {group.description}
                </p>
              ) : null}
            </div>

            <div className="space-y-1">
              {group.items.map((item) => {
                const active = isActive(pathname, item.href)

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`block rounded-2xl border px-3 py-3 transition ${itemToneClass(active, item.tone)}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold">{item.label}</div>
                      {active ? (
                        <span className="h-2 w-2 rounded-full bg-emerald-300" />
                      ) : null}
                    </div>
                    {item.description ? (
                      <div className={`mt-1 text-xs leading-5 ${active ? 'text-slate-300' : 'text-slate-500'}`}>
                        {item.description}
                      </div>
                    ) : null}
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
