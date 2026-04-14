'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

type NavItem = {
  href: string
  label: string
  description?: string
}

type NavGroup = {
  title: string
  description: string
  items: NavItem[]
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
      },
      {
        href: '/admin/customers/intake',
        label: 'Kundintag',
        description: 'Skapa kund enskilt eller i bulk',
      },
      {
        href: '/admin/contracts',
        label: 'Avtalskatalog',
        description: 'Valbara avtal och kampanjer',
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
      },
      {
        href: '/admin/operations/tasks',
        label: 'Tasks',
        description: 'Öppna, blockerade och klara uppgifter',
      },
      {
        href: '/admin/operations/switches',
        label: 'Switchar',
        description: 'Leverantörsbyten och livscykel',
      },
      {
        href: '/admin/operations/ready-to-execute',
        label: 'Ready to execute',
        description: 'Accepted + acknowledged att slutföra',
      },
      {
        href: '/admin/outbound',
        label: 'Outbound queue',
        description: 'Dispatch, retry och ack-status',
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
      },
      {
        href: '/admin/outbound/ready-switches',
        label: 'Bulk switch',
        description: 'Köa alla redo för byte',
      },
      {
        href: '/admin/outbound/missing-meter-values',
        label: 'Bulk mätvärden',
        description: 'Köa alla som saknar mätvärden',
      },
      {
        href: '/admin/outbound/missing-billing-underlays',
        label: 'Bulk billing',
        description: 'Köa alla som saknar billing-underlag',
      },
    ],
  },
  {
    title: 'Masterdata och integration',
    description: 'Detaljarbete och tekniska flöden',
    items: [
      {
        href: '/admin/metering',
        label: 'Metering',
        description: 'Requests och inkomna mätvärden',
      },
      {
        href: '/admin/billing',
        label: 'Billing',
        description: 'Billing underlag från nätägare',
      },
      {
        href: '/admin/partner-exports',
        label: 'Partner exports',
        description: 'Exportkö och extern handoff',
      },
      {
        href: '/admin/integrations/routes',
        label: 'Communication routes',
        description: 'Routning per nätägare och kanal',
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
      },
      {
        href: '/admin/roles',
        label: 'Roller',
        description: 'Behörigheter och rollstruktur',
      },
      {
        href: '/admin/audit',
        label: 'Audit',
        description: 'Loggar och historik',
      },
    ],
  },
]

function isActive(pathname: string, href: string) {
  if (href === '/admin') return pathname === '/admin'
  return pathname.startsWith(href)
}

export default function AdminSidebar() {
  const pathname = usePathname()

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
            Från överblick till rätt arbetsyta utan att tappa sammanhang
          </p>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
            Rekommenderat arbetsflöde
          </p>
          <p className="mt-2 text-sm text-slate-300">
            Börja i kundlistan eller operations control tower. Gå sedan vidare till kundkort, switchar, outbound eller ready-to-execute beroende på var kedjan fastnar.
          </p>
        </div>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-4 py-5">
        {NAV_GROUPS.map((group) => (
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

                      {active ? (
                        <span className="mt-1 inline-block h-2.5 w-2.5 rounded-full bg-emerald-400" />
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