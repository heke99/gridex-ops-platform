// components/admin/AdminSidebar.tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  getAdminPageRequirement,
  hasPermissionRequirement,
  type AdminPageKey,
} from '@/lib/admin/accessModel'

type NavItem = {
  href: string
  label: string
  description?: string
  pageKey?: AdminPageKey
}

type NavGroup = {
  title: string
  description: string
  items: NavItem[]
}

type AdminSidebarProps = {
  permissions: string[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Start',
    description: 'Överblick och daglig prioritering',
    items: [
      {
        href: '/admin',
        label: 'Dashboard',
        description: 'Kunddrift, Ediel-status och åtgärder',
        pageKey: 'dashboard',
      },
      {
        href: '/admin/operations',
        label: 'Operations',
        description: 'Switchar, tasks och readiness',
        pageKey: 'operations.control_tower',
      },
      {
        href: '/admin/operations/sync',
        label: 'Kundsynk',
        description: 'Onboarding, avtal och datakoppling',
        pageKey: 'operations.sync',
      },
    ],
  },
  {
    title: 'Kunder',
    description: 'Allt som rör kund, avtal och anläggning',
    items: [
      {
        href: '/admin/customers',
        label: 'Kundregister',
        description: 'Sök kunder och öppna kundkort',
        pageKey: 'customers.list',
      },
      {
        href: '/admin/customers/intake',
        label: 'Nytt kundintag',
        description: 'Skapa kund, anläggning och mätpunkt',
        pageKey: 'customers.intake',
      },
      {
        href: '/admin/contracts',
        label: 'Avtal och kampanjer',
        description: 'Avtalskatalog och prissättning',
        pageKey: 'contracts.catalog',
      },
    ],
  },
  {
    title: 'Ediel',
    description: 'Liveflöden, AGT och konfiguration',
    items: [
      {
        href: '/admin/ediel',
        label: 'Ediel-center',
        description: 'Välj live, AGT eller konfiguration',
        pageKey: 'ediel.workspace',
      },
      {
        href: '/admin/ediel/messages',
        label: 'Live meddelanden',
        description: 'PRODAT, UTILTS, CONTRL och APERAK',
        pageKey: 'ediel.workspace',
      },
      {
        href: '/admin/ediel/control-tower',
        label: 'Control tower',
        description: 'Fel, overdue ACK och driftkontroll',
      },
      {
        href: '/admin/ediel/agt',
        label: 'AGT-arbetsyta',
        description: 'AGT-flöden separat från produktion',
        pageKey: 'ediel.workspace',
      },
      {
        href: '/admin/ediel/routes',
        label: 'Ediel-routing',
        description: 'Tenant, mailbox, SMTP och profiler',
        pageKey: 'ediel.routes',
      },
      {
        href: '/admin/ediel/settings',
        label: 'Aktörsinställningar',
        description: 'Aktörskort, versioner och ack-policy',
      },
    ],
  },
  {
    title: 'Data och handoff',
    description: 'Mätvärden, billing och externa exporter',
    items: [
      {
        href: '/admin/metering',
        label: 'Mätvärden',
        description: 'Mätvärdesrequests och inkomna värden',
        pageKey: 'metering.workspace',
      },
      {
        href: '/admin/billing',
        label: 'Billing-underlag',
        description: 'Underlag till faktureringspartner',
        pageKey: 'billing.workspace',
      },
      {
        href: '/admin/outbound',
        label: 'Outbound',
        description: 'Extern dispatch och retry',
        pageKey: 'outbound.queue',
      },
      {
        href: '/admin/outbound/unresolved',
        label: 'Ej matchade',
        description: 'Saknad kanal, route eller underlag',
        pageKey: 'outbound.unresolved',
      },
      {
        href: '/admin/partner-exports',
        label: 'Partnerexporter',
        description: 'Handoff till extern partner',
        pageKey: 'partner_exports.workspace',
      },
    ],
  },
  {
    title: 'Register',
    description: 'Grunddata som driver automationen',
    items: [
      {
        href: '/admin/network-owners',
        label: 'Nätägare',
        description: 'Elnätsägare och tekniska uppgifter',
        pageKey: 'masterdata.network_owners',
      },
      {
        href: '/admin/electricity-suppliers',
        label: 'Elleverantörer',
        description: 'Leverantörsregister och motparter',
        pageKey: 'masterdata.electricity_suppliers',
      },
      {
        href: '/admin/price-area-localities',
        label: 'Elområden',
        description: 'Orter och SE1–SE4',
        pageKey: 'masterdata.price_area_localities',
      },
      {
        href: '/admin/integrations/routes',
        label: 'Communication routes',
        description: 'Generell routing utanför Ediel',
        pageKey: 'integrations.routes',
      },
    ],
  },
  {
    title: 'Admin',
    description: 'SaaS-konton, roller och spårbarhet',
    items: [
      {
        href: '/admin/companies',
        label: 'Företag',
        description: 'Bolagskonton och tenant-ansvariga',
        pageKey: 'companies.manage',
      },
      {
        href: '/admin/users',
        label: 'Användare',
        description: 'Konton, roller och behörigheter',
        pageKey: 'users.list',
      },
      {
        href: '/admin/roles',
        label: 'Roller',
        description: 'Behörigheter och rollmodell',
        pageKey: 'roles.catalog',
      },
      {
        href: '/admin/audit',
        label: 'Audit log',
        description: 'Historik och spårbarhet',
        pageKey: 'audit.log',
      },
    ],
  },
]

const EXACT_MATCH_ITEMS = new Set(['/admin', '/admin/ediel'])

function isActive(pathname: string, href: string) {
  if (EXACT_MATCH_ITEMS.has(href)) return pathname === href
  return pathname.startsWith(href)
}

function canAccessNavItem(currentPermissions: string[], item: NavItem) {
  if (!item.pageKey) return true
  return hasPermissionRequirement(
    currentPermissions,
    getAdminPageRequirement(item.pageKey)
  )
}

export default function AdminSidebar({ permissions }: AdminSidebarProps) {
  const pathname = usePathname()

  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => canAccessNavItem(permissions, item)),
  })).filter((group) => group.items.length > 0)

  return (
    <aside className="flex h-screen w-full flex-col border-r border-emerald-100 bg-white text-slate-900 shadow-xl shadow-emerald-950/5">
      <div className="border-b border-emerald-100 bg-gradient-to-br from-white to-emerald-50 px-6 py-6">
        <div className="inline-flex items-center rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">
          GridCore SaaS
        </div>

        <div className="mt-4">
          <h1 className="text-xl font-semibold tracking-tight text-slate-950">
            Control Center
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Kunder, Ediel, switching och partnerhandoff med tenant-säker åtkomst.
          </p>
        </div>
      </div>

      <nav className="min-h-0 flex-1 space-y-7 overflow-y-auto px-4 py-6">
        {visibleGroups.map((group) => (
          <section key={group.title}>
            <div className="px-2">
              <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                {group.title}
              </h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {group.description}
              </p>
            </div>

            <div className="mt-3 space-y-1">
              {group.items.map((item) => {
                const active = isActive(pathname, item.href)

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`block rounded-2xl border px-3 py-3 transition ${
                      active
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-950 shadow-sm'
                        : 'border-transparent text-slate-700 hover:border-emerald-100 hover:bg-emerald-50/60'
                    }`}
                  >
                    <div className="text-sm font-medium">{item.label}</div>
                    {item.description ? (
                      <div
                        className={`mt-1 text-xs leading-5 ${
                          active ? 'text-emerald-800/75' : 'text-slate-500'
                        }`}
                      >
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
