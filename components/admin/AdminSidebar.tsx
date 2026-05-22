// components/admin/AdminSidebar.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  getAdminPageRequirement,
  hasPermissionRequirement,
  type AdminPageKey,
} from "@/lib/admin/accessModel";

type NavItem = {
  href: string;
  label: string;
  description?: string;
  pageKey?: AdminPageKey;
  badge?: string;
  platformOnly?: boolean;
  requiresLiveCompany?: boolean;
};

type NavGroup = {
  title: string;
  description: string;
  items: NavItem[];
};

type AdminSidebarProps = {
  permissions: string[];
  isPlatformAdmin: boolean;
  workspaceName?: string | null;
  workspaceSubtitle?: string | null;
  isCompanyLiveEnabled?: boolean;
};

const NAV_GROUPS: NavGroup[] = [
  {
    title: "Översikt",
    description: "Daglig drift och prioriterade blockeringar",
    items: [
      {
        href: "/admin",
        label: "Driftöversikt",
        description: "Kunddrift, Ediel, mätvärden och åtgärder",
        pageKey: "dashboard",
      },
      {
        href: "/admin/controltower",
        label: "System Control Tower",
        description: "Fullmakter, switchar, mätvärden och handoff",
        pageKey: "operations.control_tower",
      },
    ],
  },
  {
    title: "Ediel Center",
    description: "Liveflöden, kvittenser, aktörer och drift",
    items: [
      {
        href: "/admin/ediel",
        label: "Ediel Live Center",
        description: "Produktion för PRODAT, UTILTS, CONTRL och APERAK",
        pageKey: "ediel.workspace",
        requiresLiveCompany: true,
      },
      {
        href: "/admin/ediel/control-tower",
        label: "Ediel Control Tower",
        description: "Kvittenser, dubbletter, fel och regelkonflikter",
        pageKey: "ediel.workspace",
        requiresLiveCompany: true,
      },
      {
        href: "/admin/ediel/messages",
        label: "Live-meddelanden",
        description: "Alla inkommande och utgående Ediel-meddelanden",
        pageKey: "ediel.workspace",
        requiresLiveCompany: true,
      },
      {
        href: "/admin/ediel/routes",
        label: "Adressering & routes",
        description: "Nätägare, leverantörer, BRP och route profiles",
        pageKey: "ediel.routes",
      },
      {
        href: "/admin/ediel/settings",
        label: "Ediel-inställningar",
        description: "Bolagets aktörsidentitet och Edielförutsättningar",
        pageKey: "ediel.routes",
      },
      {
        href: "/admin/company-actor-status",
        label: "Live-status & godkännande",
        description: "Se aktörsprofil, teststatus och om superadmin har aktiverat live",
        pageKey: "company.actor_status",
      },
      {
        href: "/admin/ediel/agt",
        label: "Aktörsgodkännande (AGT)",
        description: "Låst godkännandeyta för plattformsadmin",
        pageKey: "ediel.workspace",
        badge: "Admin",
        platformOnly: true,
      },
    ],
  },
  {
    title: "Kunder & avtal",
    description: "Kund, avtal, anläggning och mätpunkt",
    items: [
      {
        href: "/admin/customers",
        label: "Kundregister",
        description: "Sök kunder och öppna kundkort",
        pageKey: "customers.list",
      },
      {
        href: "/admin/customers/intake",
        label: "Nytt kundintag",
        description: "Skapa kund, anläggning, mätpunkt och fullmakt",
        pageKey: "customers.intake",
      },
      {
        href: "/admin/customers/imports",
        label: "Importgranskning",
        description: "PDF/bulk-rader som kräver manuell kontroll",
        pageKey: "customers.intake",
      },
      {
        href: "/admin/customers/duplicates",
        label: "Dubblettkontroll",
        description: "Möjliga dubbletter och manuell mergekontroll",
        pageKey: "customers.list",
      },
      {
        href: "/admin/customers/tenant-test",
        label: "Tenant-/rolltest",
        description: "Bolag A/B, roller och RLS-policyrapport",
        pageKey: "customers.intake",
      },
      {
        href: "/admin/contracts",
        label: "Avtal och kampanjer",
        description: "Avtalskatalog och prissättning",
        pageKey: "contracts.catalog",
      },
      {
        href: "/admin/pricing",
        label: "Prismotor",
        description: "Påslag, avgifter, elcertifikat och komponentregler",
        pageKey: "pricing.engine",
      },
      {
        href: "/admin/customers/segments",
        label: "Kundsegment",
        description: "Segment och urval för uppföljning",
        pageKey: "customers.segments",
      },
      {
        href: "/admin/customer-info-requests",
        label: "Uppgiftsbegäran",
        description: "Z01/Z02, fullmakter och mätvärdestillstånd",
        pageKey: "customer.info_requests",
      },
      {
        href: "/admin/customer-cases",
        label: "Kundärenden",
        description: "Ånger, nekade kunder och blockerade onboardingflöden",
        pageKey: "customer.cases",
      },
    ],
  },
  {
    title: "Fullmakter & onboarding",
    description: "Från signerad fullmakt till begärda uppgifter",
    items: [
      {
        href: "/admin/customers/intake",
        label: "Kundintag",
        description: "Starta kund, avtal och fullmaktsflöde",
        pageKey: "customers.intake",
      },
      {
        href: "/admin/operations/tasks",
        label: "Operationsuppgifter",
        description: "Blockerade fullmakter och saknade uppgifter",
        pageKey: "operations.tasks",
      },
      {
        href: "/admin/operations/sync",
        label: "Sync & readiness",
        description: "Synka kund, anläggning och switchberedskap",
        pageKey: "operations.sync",
      },
      {
        href: "/admin/operations/integrity",
        label: "Datakontroll",
        description: "Hitta fel i kund- och operationsdata",
        pageKey: "operations.integrity",
      },
    ],
  },
  {
    title: "Operations",
    description: "Leverantörsbyte, utskick och uppföljning",
    items: [
      {
        href: "/admin/operations",
        label: "Operationsöversikt",
        description: "Switchar, uppgifter och beredskap",
        pageKey: "operations.control_tower",
      },
      {
        href: "/admin/operations/switches",
        label: "Switchärenden",
        description: "Z03, svar, status och slutförande",
        pageKey: "operations.switches",
      },
      {
        href: "/admin/operations/ready-to-execute",
        label: "Redo att slutföra",
        description: "Accepterade flöden som kan aktiveras",
        pageKey: "operations.ready_to_execute",
      },
      {
        href: "/admin/operations/automation",
        label: "Automationsmotor",
        description: "Kund, avtal, mätvärden, blockers och ärenden",
        pageKey: "operations.automation",
      },
      {
        href: "/admin/operations/perioder",
        label: "Periodmotor",
        description: "Mätvärdesluckor, periodköer och begäran",
        pageKey: "operations.automation",
      },
      {
        href: "/admin/outbound",
        label: "Utskickskö",
        description: "Extern kommunikation och uppföljning",
        pageKey: "outbound.queue",
      },
      {
        href: "/admin/outbound/unresolved",
        label: "Ej matchade meddelanden",
        description: "Saknad rutt, kanal eller underlag",
        pageKey: "outbound.unresolved",
      },
      {
        href: "/admin/outbound/ready-switches",
        label: "Redo utskick",
        description: "Switchar som kan köas och skickas",
        pageKey: "outbound.ready_switches",
      },
    ],
  },
  {
    title: "Mätvärden & fakturaunderlag",
    description: "UTILTS, mätvärden och partnerhandoff",
    items: [
      {
        href: "/admin/metering",
        label: "Mätvärden",
        description: "Mätvärdesrequests och inkomna värden",
        pageKey: "metering.workspace",
      },
      {
        href: "/admin/billing",
        label: "Faktureringsunderlag",
        description: "Underlag till faktureringspartner",
        pageKey: "billing.workspace",
      },
      {
        href: "/admin/billing/export-center",
        label: "Exportcenter",
        description: "Redo rader, blockerade rader och exporthistorik",
        pageKey: "billing.export_center",
      },
      {
        href: "/admin/billing/quality",
        label: "Datakvalitet & readiness",
        description: "Kundredo-score för avtal, byte, fakturering och export",
        pageKey: "billing.workspace",
      },
      {
        href: "/admin/billing/ai-parser",
        label: "AI/OCR-granskning",
        description: "Manuell verifiering av scannade avtal och fullmakter",
        pageKey: "billing.import",
      },
      {
        href: "/admin/billing/import",
        label: "Importera underlag",
        description: "Billingfiler, normalisering och importfel",
        pageKey: "billing.import",
      },
      {
        href: "/admin/outbound/missing-meter-values",
        label: "Saknade mätvärden",
        description: "Perioder där mätdata saknas",
        pageKey: "outbound.missing_meter_values",
      },
      {
        href: "/admin/outbound/missing-billing-underlays",
        label: "Saknade underlag",
        description: "Faktureringsunderlag som blockerar export",
        pageKey: "outbound.missing_billing_underlays",
      },
      {
        href: "/admin/partner-exports",
        label: "Partnerexporter",
        description: "Handoff till extern partner",
        pageKey: "partner_exports.workspace",
      },
    ],
  },
  {
    title: "Masterdata",
    description: "Aktörs- och grunddata som driver automationen",
    items: [
      {
        href: "/admin/network-owners",
        label: "Nätägare",
        description: "Elnätsägare, nätområden och teknisk adressdata",
        pageKey: "masterdata.network_owners",
      },
      {
        href: "/admin/electricity-suppliers",
        label: "Elleverantörer",
        description: "Leverantörsregister och motparter",
        pageKey: "masterdata.electricity_suppliers",
      },
      {
        href: "/admin/price-area-localities",
        label: "Elområden",
        description: "Orter och SE1–SE4",
        pageKey: "masterdata.price_area_localities",
      },
      {
        href: "/admin/integrations/routes",
        label: "Kommunikationsrutter",
        description: "Generell routing utanför Ediel",
        pageKey: "integrations.routes",
      },
    ],
  },
  {
    title: "Aktörstest & produktion",
    description: "Tenantvis aktörsgodkännande, bevispaket och go-live",
    items: [
      {
        href: "/admin/platform/actor-testing",
        label: "Aktörstester",
        description: "Alla bolags AGT-status och testpaket",
        pageKey: "platform.actor_testing",
        platformOnly: true,
      },
      {
        href: "/admin/platform/go-live",
        label: "Produktionssättning",
        description: "Go-live checklistor och live-spärrar",
        pageKey: "platform.go_live",
        platformOnly: true,
      },
      {
        href: "/admin/platform/white-labels",
        label: "White-label plattformar",
        description: "Plattformsägare, kopplade bolag och scope",
        pageKey: "platform.white_labels",
        platformOnly: true,
      },
      {
        href: "/admin/whitelabel/companies",
        label: "Mina bolag",
        description: "White-label-admins egna bolag",
        pageKey: "whitelabel.companies",
      },
      {
        href: "/admin/whitelabel/actor-testing",
        label: "Mina aktörstester",
        description: "Aktörsteststatus för egna bolag",
        pageKey: "whitelabel.actor_testing",
      },
      {
        href: "/admin/whitelabel/go-live",
        label: "Produktionsstatus",
        description: "Go-live status för egna bolag",
        pageKey: "whitelabel.go_live",
      },
    ],
  },

  {
    title: "Plattform",
    description:
      "Endast superadmin: tenants, globala regler och systemstyrning",
    items: [
      {
        href: "/admin/companies",
        label: "Bolag på plattformen",
        description: "Skapa, pausa och styra elhandelsbolag",
        pageKey: "companies.manage",
        platformOnly: true,
      },
      {
        href: "/admin/users",
        label: "Alla användare",
        description: "Globala konton, roller och overrides",
        pageKey: "users.list",
        platformOnly: true,
      },
      {
        href: "/admin/roles",
        label: "Roller & behörigheter",
        description: "Global accessmodell",
        pageKey: "roles.catalog",
        platformOnly: true,
      },

      {
        href: "/admin/platform/usage",
        label: "Usage & SaaS-fakturering",
        description: "Volymer per tenant för framtida plattformsfakturering",
        pageKey: "platform.usage",
        platformOnly: true,
      },
      {
        href: "/admin/platform/ediel/rules",
        label: "Globala Ediel-regler",
        description: "Message rules och runtime-regler",
        pageKey: "platform.ediel.rules",
        platformOnly: true,
      },
      {
        href: "/admin/platform/ediel/versions",
        label: "Ediel-versioner",
        description: "Versioner och giltighetstider",
        pageKey: "platform.ediel.versions",
        platformOnly: true,
      },
      {
        href: "/admin/platform/ediel/routes",
        label: "Plattformsrutter",
        description: "Global route-governance",
        pageKey: "platform.ediel.routes",
        platformOnly: true,
      },
      {
        href: "/admin/platform/ediel/runtime",
        label: "Runtimekontroll",
        description: "Versioner, routes och ack-policy i drift",
        pageKey: "platform.ediel.runtime",
        platformOnly: true,
      },
    ],
  },
  {
    title: "Inställningar",
    description: "Bolagets egna inställningar och spårbarhet",
    items: [
      {
        href: "/admin/company-settings",
        label: "Bolagsinställningar",
        description: "Kontaktuppgifter, ansvariga och login-e-post",
        pageKey: "company.settings",
      },
      {
        href: "/admin/company-actor-status",
        label: "Aktörsinställningar",
        description: "Bolagets test- och produktionsstatus",
        pageKey: "company.actor_status",
      },
      {
        href: "/admin/audit",
        label: "Revisionslogg",
        description: "Historik och spårbarhet för behörigt scope",
        pageKey: "audit.log",
      },
    ],
  },
];
const EXACT_MATCH_ITEMS = new Set([
  "/admin",
  "/admin/ediel",
  "/admin/controltower",
]);

function isActive(pathname: string, href: string) {
  if (EXACT_MATCH_ITEMS.has(href)) return pathname === href;
  return pathname.startsWith(href);
}

function canAccessNavItem(
  currentPermissions: string[],
  item: NavItem,
  isPlatformAdmin: boolean,
  isCompanyLiveEnabled: boolean,
) {
  if (item.platformOnly) return isPlatformAdmin;
  if (item.requiresLiveCompany && !isPlatformAdmin && !isCompanyLiveEnabled) return false;
  if (!item.pageKey) return true;
  return hasPermissionRequirement(
    currentPermissions,
    getAdminPageRequirement(item.pageKey),
  );
}

export default function AdminSidebar({
  permissions,
  isPlatformAdmin,
  workspaceName,
  workspaceSubtitle,
  isCompanyLiveEnabled = false,
}: AdminSidebarProps) {
  const pathname = usePathname();
  const displayName =
    workspaceName?.trim() ||
    (isPlatformAdmin ? "Gridex Plattform" : "Ditt bolag");
  const displaySubtitle =
    workspaceSubtitle?.trim() ||
    (isPlatformAdmin ? "SaaS-plattform" : "Bolagsyta");
  const initial = displayName.charAt(0).toUpperCase();

  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) =>
      canAccessNavItem(permissions, item, isPlatformAdmin, isCompanyLiveEnabled),
    ),
  })).filter((group) => group.items.length > 0);

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
            {isPlatformAdmin ? "Plattformskontroll" : "Bolagsyta"}
          </div>
          <h1 className="mt-3 text-lg font-semibold tracking-tight text-slate-950">
            {isPlatformAdmin ? "Kontrollcenter" : "Driftcenter"}
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            {isPlatformAdmin
              ? "Plattformsstyrning, tenants, Ediel och drift i samma arbetsyta."
              : isCompanyLiveEnabled
                ? "Live är aktiverat. Drift för kunder, Ediel, mätvärden och faktureringsunderlag i bolagets egen arbetsyta."
                : "Live Ediel är inte aktiverat än. Arbeta med kundintag, aktörsprofil och go-live-status tills superadmin godkänner live."}
          </p>
        </div>
      </div>

      <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5">
        {visibleGroups.map((group) => (
          <section
            key={group.title}
            className="rounded-3xl border border-transparent p-1"
          >
            <div className="px-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-800">
                {group.title}
              </h2>
              <p className="mt-1 text-xs leading-5 text-slate-700">
                {group.description}
              </p>
            </div>

            <div className="mt-3 space-y-1.5">
              {group.items.map((item) => {
                const active = isActive(pathname, item.href);

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`group relative block rounded-2xl border px-3 py-3 transition duration-150 ${
                      active
                        ? "border-emerald-200 bg-white text-slate-950 shadow-sm shadow-emerald-950/5 ring-1 ring-emerald-100"
                        : "border-transparent text-slate-700 hover:border-emerald-100 hover:bg-white/85 hover:text-slate-950 hover:shadow-sm hover:shadow-emerald-950/5"
                    }`}
                  >
                    <span
                      className={`absolute left-0 top-3 h-8 w-1 rounded-r-full transition ${
                        active
                          ? "bg-emerald-600"
                          : "bg-transparent group-hover:bg-emerald-200"
                      }`}
                    />
                    <div className="pl-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold">
                          {item.label}
                        </div>
                        <div className="flex items-center gap-2">
                          {item.badge ? (
                            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-800">
                              {item.badge}
                            </span>
                          ) : null}
                          {active ? (
                            <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/40" />
                          ) : null}
                        </div>
                      </div>
                      {item.description ? (
                        <div
                          className={`mt-1 text-xs leading-5 ${
                            active
                              ? "text-emerald-800"
                              : "text-slate-700 group-hover:text-slate-700"
                          }`}
                        >
                          {item.description}
                        </div>
                      ) : null}
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </nav>
    </aside>
  );
}
