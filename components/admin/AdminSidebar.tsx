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
    title: 'Översikt',
    description: 'Daglig prioritering och driftläge',
    items: [
      {
        href: '/admin',
        label: 'Systemöversikt',
        description: 'Kunddrift, Ediel-status och åtgärder',
        pageKey: 'dashboard',
      },
      {
        href: '/admin/controltower',
        label: 'Control Tower',
        description: 'Blockeringar, fullmakter, Ediel och handoff',
        pageKey: 'operations.control_tower',
      },
      {
        href: '/admin/operations',
        label: 'Operationsöversikt',
        description: 'Switchar, uppgifter och beredskap',
        pageKey: 'operations.control_tower',
      },
    ],
  },
  {
    title: 'Kunder & avtal',
    description: 'Kund, avtal, anläggning och mätpunkt',
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
      {
        href: '/admin/customers/segments',
        label: 'Kundsegment',
        description: 'Segment och urval för uppföljning',
        pageKey: 'customers.segments',
      },
    ],
  },
  {
    title: 'Fullmakter & onboarding',
    description: 'Från signerad fullmakt till begärda uppgifter',
    items: [
      {
        href: '/admin/customers/intake',
        label: 'Kundintag',
        description: 'Starta kund, avtal och fullmaktsflöde',
        pageKey: 'customers.intake',
      },
      {
        href: '/admin/operations/tasks',
        label: 'Operationsuppgifter',
        description: 'Blockerade fullmakter och saknade uppgifter',
        pageKey: 'operations.tasks',
      },
      {
        href: '/admin/operations/sync',
        label: 'Sync & readiness',
        description: 'Synka kund, anläggning och switchberedskap',
        pageKey: 'operations.sync',
      },
      {
        href: '/admin/operations/integrity',
        label: 'Datakontroll',
        description: 'Hitta fel i kund- och operationsdata',
        pageKey: 'operations.integrity',
      },
    ],
  },
  {
    title: 'Operations',
    description: 'Leverantörsbyte, outbounds och uppföljning',
    items: [
      {
        href: '/admin/operations/switches',
        label: 'Switchärenden',
        description: 'Z03, svar, status och slutförande',
        pageKey: 'operations.switches',
      },
      {
        href: '/admin/operations/ready-to-execute',
        label: 'Redo att slutföra',
        description: 'Accepterade flöden som kan aktiveras',
        pageKey: 'operations.ready_to_execute',
      },
      {
        href: '/admin/outbound',
        label: 'Utskickskö',
        description: 'Extern kommunikation och uppföljning',
        pageKey: 'outbound.queue',
      },
      {
        href: '/admin/outbound/unresolved',
        label: 'Ej matchade meddelanden',
        description: 'Saknad rutt, kanal eller underlag',
        pageKey: 'outbound.unresolved',
      },
      {
        href: '/admin/outbound/ready-switches',
        label: 'Redo outbounds',
        description: 'Switchar som kan köas och skickas',
        pageKey: 'outbound.ready_switches',
      },
    ],
  },
  {
    title: 'Ediel & meddelanden',
    description: 'Produktion och godkännandeflöden hålls åtskilda',
    items: [
      {
        href: '/admin/ediel',
        label: 'Ediel-center',
        description: 'Välj live, AGT eller konfiguration',
        pageKey: 'ediel.workspace',
      },
      {
        href: '/admin/ediel/messages',
        label: 'Meddelanden',
        description: 'PRODAT, UTILTS, CONTRL och APERAK',
        pageKey: 'ediel.workspace',
      },
      {
        href: '/admin/ediel/control-tower',
        label: 'Ediel Control Tower',
        description: 'Fel, försenade kvittenser och dubbletter',
        pageKey: 'ediel.workspace',
      },
      {
        href: '/admin/ediel/agt',
        label: 'Leverantörsgodkännande',
        description: 'AGT L1–L7 och UTILTS UL-flöden',
        pageKey: 'ediel.workspace',
      },
      {
        href: '/admin/ediel/routes',
        label: 'Rutter och profiler',
        description: 'Bolag, mailbox, SMTP och profiler',
        pageKey: 'ediel.routes',
      },
      {
        href: '/admin/ediel/settings',
        label: 'Inställningar',
        description: 'Aktörskort, versioner och ack-policy',
        pageKey: 'ediel.routes',
      },
    ],
  },
  {
    title: 'Mätvärden & fakturaunderlag',
    description: 'UTILTS, mätvärden och partnerhandoff',
    items: [
      {
        href: '/admin/metering',
        label: 'Mätvärden',
        description: 'Mätvärdesrequests och inkomna värden',
        pageKey: 'metering.workspace',
      },
      {
        href: '/admin/billing',
        label: 'Faktureringsunderlag',
        description: 'Underlag till faktureringspartner',
        pageKey: 'billing.workspace',
      },
      {
        href: '/admin/outbound/missing-meter-values',
        label: 'Saknade mätvärden',
        description: 'Perioder där mätdata saknas',
        pageKey: 'outbound.missing_meter_values',
      },
      {
        href: '/admin/outbound/missing-billing-underlays',
        label: 'Saknade underlag',
        description: 'Billingunderlag som blockerar export',
        pageKey: 'outbound.missing_billing_underlays',
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
    title: 'Masterdata',
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
        label: 'Kommunikationsrutter',
        description: 'Generell routing utanför Ediel',
        pageKey: 'integrations.routes',
      },
    ],
  },
  {
    title: 'Inställningar',
    description: 'Bolag, användare, roller och spårbarhet',
    items: [
      {
        href: '/admin/companies',
        label: 'Elhandelsbolag',
        description: 'Skapa bolag och bjud in ansvariga',
        pageKey: 'companies.manage',
      },
      {
        href: '/admin/users',
        label: 'Användare',
        description: 'Konton, roller och individuella behörigheter',
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
        label: 'Revisionslogg',
        description: 'Historik och spårbarhet',
        pageKey: 'audit.log',
      },
    ],
  },
]
const EXACT_MATCH_ITEMS = new Set(['/admin', '/admin/ediel', '/admin/controltower'])

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
    <aside className="flex h-screen w-full flex-col border-r border-emerald-100/80 bg-gradient-to-b from-white via-[#fbfdfb] to-[#f7fbf8] text-slate-900 shadow-sm shadow-emerald-950/5">
      <div className="border-b border-emerald-100/80 bg-white/90 px-5 py-5 backdrop-blur-xl">
        <Link href="/admin" className="group flex items-center gap-3 rounded-3xl border border-emerald-100 bg-white p-3 shadow-sm shadow-emerald-950/5 transition hover:border-emerald-200 hover:shadow-md hover:shadow-emerald-950/10">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-700 text-base font-bold text-white shadow-sm shadow-emerald-700/20">
            G
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-semibold uppercase tracking-[0.2em] text-emerald-800">
              Gridex
            </span>
            <span className="mt-0.5 block truncate text-sm font-semibold text-slate-950">
              Operations Center
            </span>
          </span>
        </Link>

        <div className="mt-5 rounded-3xl border border-emerald-100 bg-emerald-50/60 p-4">
          <div className="inline-flex rounded-full border border-emerald-200 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-800">
            SaaS Control
          </div>
          <h1 className="mt-3 text-lg font-semibold tracking-tight text-slate-950">
            Kontrollcenter
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Kunder, Ediel, switching och partnerhandoff i samma professionella arbetsyta.
          </p>
        </div>
      </div>

      <nav className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-5">
        {visibleGroups.map((group) => (
          <section key={group.title} className="rounded-3xl border border-transparent p-1">
            <div className="px-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-800">
                {group.title}
              </h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {group.description}
              </p>
            </div>

            <div className="mt-3 space-y-1.5">
              {group.items.map((item) => {
                const active = isActive(pathname, item.href)

                return (
                  <Link
                    key={item.href}
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
                        {active ? (
                          <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/40" />
                        ) : null}
                      </div>
                      {item.description ? (
                        <div
                          className={`mt-1 text-xs leading-5 ${
                            active ? 'text-emerald-800' : 'text-slate-500 group-hover:text-slate-600'
                          }`}
                        >
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
