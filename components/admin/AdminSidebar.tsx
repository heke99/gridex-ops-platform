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
    title: 'Överblick',
    description: 'Börja här för att förstå nuläget',
    items: [
      {
        href: '/admin',
        label: 'Översikt',
        description: 'Systemstatus och operativ överblick',
        pageKey: 'dashboard',
      },
      {
        href: '/admin/operations',
        label: 'Operations control tower',
        description: 'Vad kräver åtgärd nu',
        pageKey: 'operations.control_tower',
      },
    ],
  },
  {
    title: 'Kunder och avtal',
    description: 'Dagligt arbete kring kundstock och avtal',
    items: [
      {
        href: '/admin/customers',
        label: 'Kunder',
        description: 'Kundregister, sökning och prioritering',
        pageKey: 'customers.list',
      },
      {
        href: '/admin/customers/intake',
        label: 'Kundintag',
        description: 'Skapa kund enskilt eller i bulk',
        pageKey: 'customers.intake',
      },
      {
        href: '/admin/customers/segments',
        label: 'Kundsegment',
        description: 'Segmentering och uppföljning',
        pageKey: 'customers.segments',
      },
      {
        href: '/admin/contracts',
        label: 'Avtalskatalog',
        description: 'Valbara avtal och kampanjer',
        pageKey: 'contracts.catalog',
      },
    ],
  },
  {
    title: 'Operations',
    description: 'Switchar, outbound och uppföljning',
    items: [
      {
        href: '/admin/operations/integrity',
        label: 'Integrity dashboard',
        description: 'Mismatch, väntar aktiv, flytt, byte och exportredo',
        pageKey: 'operations.integrity',
      },
      {
        href: '/admin/operations/tasks',
        label: 'Tasks',
        description: 'Öppna, blockerade och klara uppgifter',
        pageKey: 'operations.tasks',
      },
      {
        href: '/admin/operations/switches',
        label: 'Switchar',
        description: 'Leverantörsbyten och livscykel',
        pageKey: 'operations.switches',
      },
      {
        href: '/admin/operations/ready-to-execute',
        label: 'Ready to execute',
        description: 'Accepted + acknowledged att slutföra',
        pageKey: 'operations.ready_to_execute',
      },
      {
        href: '/admin/outbound',
        label: 'Outbound queue',
        description: 'Dispatch, retry och ack-status',
        pageKey: 'outbound.queue',
      },
    ],
  },
  {
    title: 'Undantag och bulk',
    description: 'När något saknas eller fastnar',
    items: [
      {
        href: '/admin/outbound/unresolved',
        label: 'Unresolved',
        description: 'Requests utan route eller kanal',
        pageKey: 'outbound.unresolved',
      },
      {
        href: '/admin/outbound/ready-switches',
        label: 'Bulk switch',
        description: 'Köa alla redo för byte',
        pageKey: 'outbound.ready_switches',
      },
      {
        href: '/admin/outbound/missing-meter-values',
        label: 'Bulk mätvärden',
        description: 'Köa alla som saknar mätvärden',
        pageKey: 'outbound.missing_meter_values',
      },
      {
        href: '/admin/outbound/missing-billing-underlays',
        label: 'Bulk billing',
        description: 'Köa alla som saknar billing-underlag',
        pageKey: 'outbound.missing_billing_underlays',
      },
    ],
  },
  {
    title: 'Masterdata och integration',
    description: 'Detaljarbete och tekniska flöden',
    items: [
      {
        href: '/admin/network-owners',
        label: 'Nätägare',
        description: 'Register över elnätsägare',
        pageKey: 'masterdata.network_owners',
      },
      {
        href: '/admin/electricity-suppliers',
        label: 'Elleverantörer',
        description: 'Permanent register över leverantörer',
        pageKey: 'masterdata.electricity_suppliers',
      },
      {
        href: '/admin/price-area-localities',
        label: 'Elområdes-orter',
        description: 'Städer och orter för SE1–SE4',
        pageKey: 'masterdata.price_area_localities',
      },
      {
        href: '/admin/metering',
        label: 'Metering',
        description: 'Requests och inkomna mätvärden',
        pageKey: 'metering.workspace',
      },
      {
        href: '/admin/billing',
        label: 'Billing',
        description: 'Billing underlag från nätägare',
        pageKey: 'billing.workspace',
      },
      {
        href: '/admin/partner-exports',
        label: 'Partner exports',
        description: 'Exportkö och extern handoff',
        pageKey: 'partner_exports.workspace',
      },
      {
        href: '/admin/integrations/routes',
        label: 'Communication routes',
        description: 'Routning per nätägare och kanal',
        pageKey: 'integrations.routes',
      },
      {
        href: '/admin/ediel',
        label: 'Ediel workspace',
        description: 'Inbox, outbox, self-test och SMTP/IMAP-flöden',
        pageKey: 'ediel.workspace',
      },
      {
        href: '/admin/ediel/control-tower',
        label: 'Ediel control tower',
        description: 'Ack, failures, olänkade meddelanden och driftvy',
      },
      {
        href: '/admin/ediel/routes',
        label: 'Ediel-routes',
        description: 'Ediel-profiler, mailbox och transportinställningar',
        pageKey: 'ediel.routes',
      },
      {
        href: '/admin/ediel/settings',
        label: 'Ediel settings',
        description: 'Aktörskort, versionsregler och ack-policy',
      },
      {
        href: '/admin/ediel/ai-list',
        label: 'AI-/BI-listor',
        description: 'Import/exportvy och historik för AI-/BI-listor',
      },
    ],
  },
  {
    title: 'Styrning och access',
    description: 'Behörigheter, loggar och administration',
    items: [
      {
        href: '/admin/users',
        label: 'Användare',
        description: 'Roller, access och overrides',
        pageKey: 'users.list',
      },
      {
        href: '/admin/roles',
        label: 'Roller',
        description: 'Behörigheter och rollstruktur',
        pageKey: 'roles.catalog',
      },
      {
        href: '/admin/audit',
        label: 'Audit',
        description: 'Loggar och historik',
        pageKey: 'audit.log',
      },
    ],
  },
]

function isActive(pathname: string, href: string) {
  if (href === '/admin') return pathname === '/admin'
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
    <aside className="flex h-screen w-full flex-col border-r border-slate-800 bg-slate-950 text-slate-100">
      <div className="border-b border-slate-800 px-6 py-6">
        <div className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-300">
          Gridex Ops
        </div>

        <div className="mt-4">
          <h1 className="text-xl font-semibold tracking-tight text-white">
            Admin Console
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            Enterprise-vy för kunder, operations, integrationsflöden och styrning.
          </p>
        </div>
      </div>

      <nav className="min-h-0 flex-1 space-y-8 overflow-y-auto px-4 py-6">
        {visibleGroups.map((group) => (
          <section key={group.title}>
            <div className="px-2">
              <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                {group.title}
              </h2>
              <p className="mt-2 text-xs leading-5 text-slate-500">
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
                        ? 'border-slate-600 bg-slate-800 text-white'
                        : 'border-transparent text-slate-200 hover:border-slate-800 hover:bg-slate-900'
                    }`}
                  >
                    <div className="text-sm font-medium">{item.label}</div>
                    {item.description ? (
                      <div
                        className={`mt-1 text-xs leading-5 ${
                          active ? 'text-slate-300' : 'text-slate-500'
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