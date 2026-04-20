'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

type NavItem = {
  href: string
  label: string
  description?: string
  requiredPermissions?: string[]
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
      },
      {
        href: '/admin/operations',
        label: 'Operations control tower',
        description: 'Vad kräver åtgärd nu',
        requiredPermissions: ['masterdata.read'],
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
        requiredPermissions: ['masterdata.read'],
      },
      {
        href: '/admin/customers/intake',
        label: 'Kundintag',
        description: 'Skapa kund enskilt eller i bulk',
        requiredPermissions: ['masterdata.read'],
      },
      {
        href: '/admin/customers/segments',
        label: 'Kundsegment',
        description: 'Segmentering och uppföljning',
        requiredPermissions: ['masterdata.read'],
      },
      {
        href: '/admin/contracts',
        label: 'Avtalskatalog',
        description: 'Valbara avtal och kampanjer',
        requiredPermissions: ['pricing.read'],
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
        requiredPermissions: ['masterdata.read'],
      },
      {
        href: '/admin/operations/tasks',
        label: 'Tasks',
        description: 'Öppna, blockerade och klara uppgifter',
        requiredPermissions: ['masterdata.read'],
      },
      {
        href: '/admin/operations/switches',
        label: 'Switchar',
        description: 'Leverantörsbyten och livscykel',
        requiredPermissions: ['masterdata.read'],
      },
      {
        href: '/admin/operations/ready-to-execute',
        label: 'Ready to execute',
        description: 'Accepted + acknowledged att slutföra',
        requiredPermissions: ['masterdata.read'],
      },
      {
        href: '/admin/outbound',
        label: 'Outbound queue',
        description: 'Dispatch, retry och ack-status',
        requiredPermissions: ['masterdata.read'],
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
        requiredPermissions: ['masterdata.read'],
      },
      {
        href: '/admin/outbound/ready-switches',
        label: 'Bulk switch',
        description: 'Köa alla redo för byte',
        requiredPermissions: ['switching.read'],
      },
      {
        href: '/admin/outbound/missing-meter-values',
        label: 'Bulk mätvärden',
        description: 'Köa alla som saknar mätvärden',
        requiredPermissions: ['metering.read'],
      },
      {
        href: '/admin/outbound/missing-billing-underlays',
        label: 'Bulk billing',
        description: 'Köa alla som saknar billing-underlag',
        requiredPermissions: ['billing_underlay.read'],
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
        requiredPermissions: ['masterdata.read'],
      },
      {
        href: '/admin/electricity-suppliers',
        label: 'Elleverantörer',
        description: 'Permanent register över leverantörer',
        requiredPermissions: ['masterdata.read'],
      },
      {
        href: '/admin/price-area-localities',
        label: 'Elområdes-orter',
        description: 'Städer och orter för SE1–SE4',
        requiredPermissions: ['masterdata.read'],
      },
      {
        href: '/admin/metering',
        label: 'Metering',
        description: 'Requests och inkomna mätvärden',
        requiredPermissions: ['metering.read'],
      },
      {
        href: '/admin/billing',
        label: 'Billing',
        description: 'Billing underlag från nätägare',
        requiredPermissions: ['billing_underlay.read'],
      },
      {
        href: '/admin/partner-exports',
        label: 'Partner exports',
        description: 'Exportkö och extern handoff',
        requiredPermissions: ['partner_exports.read'],
      },
      {
        href: '/admin/integrations/routes',
        label: 'Communication routes',
        description: 'Routning per nätägare och kanal',
        requiredPermissions: ['masterdata.read'],
      },
      {
        href: '/admin/ediel',
        label: 'Ediel',
        description: 'Inbox, outbox, self-test och SMTP/IMAP-flöden',
        requiredPermissions: ['communication.read'],
      },
      {
        href: '/admin/ediel/routes',
        label: 'Ediel-routes',
        description: 'Ediel-profiler, mailbox och transportinställningar',
        requiredPermissions: ['masterdata.read', 'switching.read'],
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
        requiredPermissions: ['users.read'],
      },
      {
        href: '/admin/roles',
        label: 'Roller',
        description: 'Behörigheter och rollstruktur',
        requiredPermissions: ['users.read', 'roles.manage', 'permissions.manage'],
      },
      {
        href: '/admin/audit',
        label: 'Audit',
        description: 'Loggar och historik',
        requiredPermissions: ['audit.read'],
      },
    ],
  },
]

function isActive(pathname: string, href: string) {
  if (href === '/admin') return pathname === '/admin'
  return pathname.startsWith(href)
}

function hasAnyPermission(
  currentPermissions: string[],
  requiredPermissions?: string[]
) {
  if (!requiredPermissions || requiredPermissions.length === 0) return true

  return requiredPermissions.some((permission) =>
    currentPermissions.includes(permission)
  )
}

export default function AdminSidebar({ permissions }: AdminSidebarProps) {
  const pathname = usePathname()

  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) =>
      hasAnyPermission(permissions, item.requiredPermissions)
    ),
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
          <p className="mt-1 text-sm text-slate-400">
            Visa bara de arbetsytor användaren faktiskt får använda
          </p>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
            Permission-styrd meny
          </p>
          <p className="mt-2 text-sm text-slate-300">
            Menyn filtreras nu efter faktiska page-guards i systemet. Det minskar felklick och gör varje roll tydligare.
          </p>
        </div>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-4 py-5">
        {visibleGroups.map((group) => (
          <section key={group.title}>
            <div className="px-2">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                {group.title}
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {group.description}
              </p>
            </div>

            <div className="mt-3 space-y-2">
              {group.items.map((item) => {
                const active = isActive(pathname, item.href)

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={[
                      'block rounded-2xl border px-4 py-3 transition',
                      active
                        ? 'border-slate-600 bg-slate-800'
                        : 'border-transparent bg-transparent hover:border-slate-800 hover:bg-slate-900',
                    ].join(' ')}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p
                          className={[
                            'text-sm font-semibold',
                            active ? 'text-white' : 'text-slate-200',
                          ].join(' ')}
                        >
                          {item.label}
                        </p>
                        {item.description ? (
                          <p
                            className={[
                              'mt-1 text-xs leading-5',
                              active ? 'text-slate-300' : 'text-slate-500',
                            ].join(' ')}
                          >
                            {item.description}
                          </p>
                        ) : null}
                      </div>
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