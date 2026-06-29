import {
  getAdminPageRequirement,
  hasPermissionRequirement,
  type AdminPageKey,
} from '@/lib/admin/accessModel'

export type AdminNavigationMode = 'company_view' | 'platform_view'

export type AdminNavigationItem = {
  key: string
  label: string
  href: string
  description?: string
  section?: string
  pageKey?: AdminPageKey
  requiredRoles?: string[]
  requiredPermissions?: string[]
  platformOnly?: boolean
  companyVisible?: boolean
  requiresLiveCompany?: boolean
  children?: AdminNavigationItem[]
}

export type AdminNavigationGroup = {
  key: string
  title: string
  description: string
  items: AdminNavigationItem[]
}

export type AdminNavigationContext = {
  permissions: string[]
  isPlatformAdmin: boolean
  isCompanyLiveEnabled?: boolean
  mode?: AdminNavigationMode
}

const COMPANY_NAVIGATION: AdminNavigationGroup[] = [
  {
    key: 'overview',
    title: 'Översikt',
    description: 'Daglig drift och blockerare',
    items: [
      { key: 'dashboard', label: 'Översikt', href: '/admin', description: 'Status, arbetskö och nästa åtgärd', pageKey: 'dashboard' },
      { key: 'work_queue', label: 'Arbetskö', href: '/admin/work-queue', description: 'Kunder och driftuppgifter som kräver åtgärd', pageKey: 'operations.tasks' },
      { key: 'events', label: 'Händelser', href: '/admin/events', description: 'Samlad kund-, anläggnings- och automationshistorik', pageKey: 'operations.tasks' },
    ],
  },
  {
    key: 'customers',
    title: 'Kunder',
    description: 'Kund, intag och avtal',
    items: [
      { key: 'customers.list', label: 'Kunder', href: '/admin/customers', description: 'Sök kunder och öppna kundkort', pageKey: 'customers.list' },
      { key: 'customer_applications', label: 'Nya webbansökningar', href: '/admin/external-contract-intakes', description: 'Externa kundansökningar från hemsida/API', pageKey: 'customers.list' },
      { key: 'customers.intake', label: 'Kundintag', href: '/admin/customers/intake', description: 'Skapa kund, avtal och anläggning', pageKey: 'customers.intake' },
      { key: 'info_requests', label: 'Uppgiftsbegäran', href: '/admin/customer-info-requests', description: 'Kund-/anläggningsuppgifter och kompletteringar', pageKey: 'customer.info_requests' },
      { key: 'facility_requests', label: 'Anläggningsuppgifter', href: '/admin/facility-requests', description: 'Saknade anläggnings-ID, mätpunkter och nätägaruppgifter', pageKey: 'operations.tasks' },
      { key: 'messages', label: 'Meddelanden', href: '/admin/messages', description: 'EDIEL-meddelanden, utskick och kommunikationshistorik', pageKey: 'operations.tasks' },
    ],
  },
  {
    key: 'operations',
    title: 'Operations',
    description: 'Byten, mätvärden och underlag',
    items: [
      { key: 'switches', label: 'Leverantörsbyten', href: '/admin/operations/switches', description: 'Start, status och slutförande', pageKey: 'operations.switches' },
      { key: 'metering', label: 'Mätvärden', href: '/admin/metering', description: 'Mätvärdesrequests och inkomna värden', pageKey: 'metering.workspace' },
      { key: 'analytics', label: 'Analytics', href: '/admin/analytics', description: 'Kunder, mätpunkter, prognos och avvikelser', pageKey: 'analytics.workspace' },
      { key: 'billing', label: 'Fakturaunderlag', href: '/admin/billing', description: 'Underlag till fakturering/export', pageKey: 'billing.workspace' },
      { key: 'billing_export', label: 'Exportcenter', href: '/admin/billing/export-center', description: 'Redo rader, blockerare och exporthistorik', pageKey: 'billing.export_center' },
      { key: 'outbound', label: 'Utskick', href: '/admin/outbound', description: 'Extern kommunikation i affärsspråk', pageKey: 'outbound.queue' },
      { key: 'data_quality', label: 'Datakvalitet', href: '/admin/data-quality', description: 'Datakvalitet, fullmakter, webhooks och e-postdomäner', pageKey: 'operations.integrity' },
    ],
  },
  {
    key: 'settings',
    title: 'Inställningar',
    description: 'Bolagets egna inställningar',
    items: [
      { key: 'network_owners.company_mode', label: 'Nätägare', href: '/admin/network-owners', description: 'Central verifiering av nätägare, routes, subadresser och certifikat', pageKey: 'ediel.routes', platformOnly: true },
      { key: 'company_settings', label: 'Inställningar', href: '/admin/company-settings', description: 'Kontaktuppgifter och bolagsprofil', pageKey: 'company.settings' },
      { key: 'audit', label: 'Revisionslogg', href: '/admin/audit', description: 'Spårbarhet för behörigt scope', pageKey: 'audit.log' },
    ],
  },
]

const PLATFORM_NAVIGATION: AdminNavigationGroup[] = [
  {
    key: 'overview',
    title: 'Översikt',
    description: 'Platform dashboard, statistik och arbetskö',
    items: [
      { key: 'platform.dashboard', label: 'Plattformsöversikt', href: '/admin', description: 'Överblick över tenants och drift', pageKey: 'dashboard' },
      { key: 'platform.usage', label: 'Bolagsstatistik', href: '/admin/platform/usage', description: 'Volymer per tenant för framtida fakturering', pageKey: 'platform.usage', platformOnly: true },
      { key: 'platform.analytics', label: 'Plattformsanalys', href: '/admin/platform/analytics', description: 'Prognos, datakvalitet och volymer per tenant', pageKey: 'platform.analytics', platformOnly: true },
      { key: 'platform.work_queue', label: 'Arbetskö', href: '/admin/work-queue', description: 'Blockerare och manuella åtgärder', pageKey: 'operations.tasks' },
      { key: 'platform.events', label: 'Händelser', href: '/admin/events', description: 'Samlad kund-, anläggnings- och automationshistorik', pageKey: 'operations.tasks' },
    ],
  },
  {
    key: 'companies',
    title: 'Bolag',
    description: 'Tenants, användare och go-live',
    items: [
      { key: 'companies.manage', label: 'Alla bolag', href: '/admin/companies', description: 'Skapa, pausa och styra bolag', pageKey: 'companies.manage', platformOnly: true },
      { key: 'users.roles', label: 'Användare & roller', href: '/admin/users', description: 'Konton, roller och overrides', pageKey: 'users.list', platformOnly: true },
      { key: 'go_live', label: 'Go-live readiness', href: '/admin/platform/go-live', description: 'Produktionssättning och spärrar', pageKey: 'platform.go_live', platformOnly: true },
      { key: 'legal_readiness', label: 'Juridisk readiness', href: '/admin/platform/legal-readiness', description: 'Juridik/fullmakt per bolag och misslyckade ansökningar', pageKey: 'platform.go_live', platformOnly: true },
    ],
  },
  {
    key: 'customers_contracts',
    title: 'Kunder & avtal',
    description: 'Kundregister, intag och prisvillkor',
    items: [
      { key: 'customers.list', label: 'Kunder', href: '/admin/customers', description: 'Sök kunder och öppna kundkort', pageKey: 'customers.list' },
      { key: 'customer_applications', label: 'Nya webbansökningar', href: '/admin/external-contract-intakes', description: 'Externa kundansökningar från hemsida/API, blockerare och redo-kontroll', pageKey: 'customers.list' },
      { key: 'customers.intake', label: 'Kundintag', href: '/admin/customers/intake', description: 'Skapa kund, anläggning och fullmakt', pageKey: 'customers.intake' },
      { key: 'contracts', label: 'Avtal', href: '/admin/contracts', description: 'Avtalskatalog och kampanjer', pageKey: 'contracts.catalog' },
      { key: 'pricing', label: 'Prismotor', href: '/admin/pricing', description: 'Påslag, avgifter och komponentregler', pageKey: 'pricing.engine' },
    ],
  },
  {
    key: 'operations',
    title: 'Operations',
    description: 'Byten, uppgifter, mätvärden och fakturering',
    items: [
      { key: 'switches', label: 'Leverantörsbyten', href: '/admin/operations/switches', description: 'Z03/Z04-flöden i affärsvy', pageKey: 'operations.switches' },
      { key: 'info_requests', label: 'Uppgiftsbegäran', href: '/admin/customer-info-requests', description: 'Z01/Z02 och kompletteringar', pageKey: 'customer.info_requests' },
      { key: 'facility_requests', label: 'Anläggningsuppgifter', href: '/admin/facility-requests', description: 'Saknade anläggnings-ID, mätpunkter och nätägaruppgifter', pageKey: 'operations.tasks' },
      { key: 'metering', label: 'Mätvärdesåtkomst', href: '/admin/metering', description: 'Mätvärden och tillstånd', pageKey: 'metering.workspace' },
      { key: 'analytics', label: 'Analytics', href: '/admin/analytics', description: 'Kunder, mätpunkter, prognos och avvikelser', pageKey: 'analytics.workspace' },
      { key: 'billing', label: 'Fakturaunderlag', href: '/admin/billing', description: 'Underlag och exportberedskap', pageKey: 'billing.workspace' },
      { key: 'data_quality', label: 'Datakvalitet', href: '/admin/data-quality', description: 'Datakvalitet, fullmakter, webhooks och e-postdomäner', pageKey: 'operations.integrity' },
    ],
  },
  {
    key: 'ediel_control',
    title: 'Ediel Control Tower',
    description: 'Meddelanden, kvittenser och blockers',
    items: [
      { key: 'ediel.control_tower', label: 'Ediel kontrollvy', href: '/admin/ediel/control-tower', description: 'ACK-kedjor, dubbletter och blockeringar', pageKey: 'ediel.control_tower', platformOnly: true },
      { key: 'ediel.messages.global', label: 'Ediel-meddelanden', href: '/admin/platform/ediel/messages', description: 'Global inbound/outbound-vy per tenant, typ, status och miljö', pageKey: 'ediel.workspace', platformOnly: true },
      { key: 'ediel.messages', label: 'Operativ meddelandevy', href: '/admin/ediel/messages', description: 'Inkommande och utgående Ediel med ACK-kedjor', pageKey: 'ediel.workspace', platformOnly: true },
      { key: 'ediel.workspace', label: 'Ediel workspace', href: '/admin/ediel', description: 'PRODAT, UTILTS, CONTRL och APERAK', pageKey: 'ediel.workspace', platformOnly: true },
      { key: 'ediel.test_center', label: 'Testcenter', href: '/admin/ediel/test-center', description: 'L1-L7, UL1-UL6, E3-E8 och UE1-UE2', pageKey: 'platform.actor_testing', platformOnly: true },
      { key: 'ediel.system_tests', label: 'Systemtest', href: '/admin/ediel/system-tests', description: 'TGT/AGT-testcenter med filtrering och körbara testfall', pageKey: 'platform.actor_testing', platformOnly: true },
      { key: 'ediel.unresolved', label: 'Osäkra matchningar', href: '/admin/ediel/unresolved', description: 'Osäkra tenant-, route- och objektmatchningar', pageKey: 'ediel.control_tower', platformOnly: true },
      { key: 'ediel.rule_center', label: 'Regelcenter', href: '/admin/platform/ediel/rules', description: 'Ediel-regler, versioner och runtime-styrning', pageKey: 'platform.ediel.runtime', platformOnly: true },
      { key: 'ediel.ai_list', label: 'AI-lista', href: '/admin/ediel/ai-list', description: 'AI/BI-listor och avvikelsekontroll', pageKey: 'ediel.workspace', platformOnly: true },
      { key: 'ediel.agt', label: 'Aktörstester', href: '/admin/ediel/agt', description: 'AGT-status och testpaket', pageKey: 'platform.actor_testing', platformOnly: true },
    ],
  },
  {
    key: 'routes_agreements',
    title: 'Routes & avtal',
    description: 'Teknisk adressering och nätägaravtal',
    items: [
      { key: 'communication_routes', label: 'Kommunikationsvägar', href: '/admin/ediel/routes', description: 'Routes och Ediel route profiles', pageKey: 'ediel.routes', platformOnly: true },
      { key: 'ediel.actors', label: 'Aktörer', href: '/admin/ediel/actors', description: 'Ediel-ID, roller, subadresser och miljö', pageKey: 'ediel.routes', platformOnly: true },
      { key: 'network_owners', label: 'Nätägare', href: '/admin/network-owners', description: 'Verifierade nätägare, PRODAT/UTILTS-route, subadress och certifikat', pageKey: 'ediel.routes', platformOnly: true },
      { key: 'ediel.route_readiness', label: 'Routeberedskap', href: '/admin/ediel/route-readiness', description: 'Saknade routes, contact-only suppliers och launch-spärrar', pageKey: 'ediel.routes', platformOnly: true },
      { key: 'ediel.auto_readiness', label: 'Aktörsberedskap', href: '/admin/ediel/auto-readiness', description: 'Backfill, certifikatkontroll och säker auto-send per aktör', pageKey: 'ediel.routes', platformOnly: true },
      { key: 'ediel.certificates', label: 'Certifikat', href: '/admin/ediel/certificates', description: 'S/MIME-certifikatmetadata och status', pageKey: 'ediel.routes', platformOnly: true },
      { key: 'grid_owner_agreements', label: 'Nätägaravtal', href: '/admin/agreements/grid-owners', description: 'Avtal och referenskrav per nätägare', platformOnly: true },
      { key: 'ediel_settings', label: 'Application Reference', href: '/admin/ediel/settings', description: 'Aktörsidentitet, subadresser och regler', pageKey: 'ediel.routes', platformOnly: true },
      { key: 'platform_runtime', label: 'Routebeslut', href: '/admin/platform/ediel/runtime', description: 'Beslutslogg och skyddsregler', pageKey: 'platform.ediel.runtime', platformOnly: true },
    ],
  },
  {
    key: 'inbound_mail',
    title: 'Inbound Mail Engine',
    description: 'Mailboxar, parser och matchningskö',
    items: [
      { key: 'inbound_mail.workspace', label: 'Mailboxar', href: '/admin/inbound-mail', description: 'Inkommande mail, parserresultat och osäkra matchningar', platformOnly: true },
      { key: 'inbound_mail.diagnostics', label: 'Diagnostik', href: '/admin/inbound-mail/diagnostics', description: 'Smoke tests för parser, tabeller och cron-secret', platformOnly: true },
      { key: 'outbound_unresolved', label: 'Osäkra matchningar', href: '/admin/outbound/unresolved', description: 'Meddelanden som kräver manuell granskning', pageKey: 'outbound.unresolved' },
    ],
  },
  {
    key: 'system_governance',
    title: 'System & governance',
    description: 'RBAC, audit och driftspärrar',
    items: [
      { key: 'roles', label: 'RBAC', href: '/admin/roles', description: 'Roller och behörigheter', pageKey: 'roles.catalog', platformOnly: true },
      { key: 'audit', label: 'Audit logs', href: '/admin/audit', description: 'Revision och spårbarhet', pageKey: 'audit.log' },
      { key: 'api_clients', label: 'API-klienter', href: '/admin/platform/api-clients', description: 'Tokens och scopes för Gridex hemsida och externa portaler', pageKey: 'platform.security', platformOnly: true },
      { key: 'data_cleanup', label: 'Datahantering', href: '/admin/platform/data-cleanup', description: 'Arkivera och rensa testdata säkert', pageKey: 'platform.security', platformOnly: true },
      { key: 'security', label: 'Produktionsskydd', href: '/admin/platform/security', description: 'Tenant-isolering och systemdiagnostik', pageKey: 'platform.security', platformOnly: true },
      { key: 'system_health', label: 'Systemstatus', href: '/admin/system-health', description: 'Driftstatus för API, Ediel, webhooks, routes och fakturering', pageKey: 'platform.security', platformOnly: true },
      { key: 'auth_diag', label: 'Systemdiagnostik', href: '/admin/system/auth-diagnostics', description: 'Auth och accessdiagnostik', platformOnly: true },
    ],
  },
]

export function canAccessAdminNavigationItem(
  item: AdminNavigationItem,
  context: AdminNavigationContext
): boolean {
  if (item.platformOnly && !context.isPlatformAdmin) return false
  if (item.requiresLiveCompany && !context.isPlatformAdmin && !context.isCompanyLiveEnabled) return false
  if (context.isPlatformAdmin) return true

  if (item.requiredPermissions?.length) {
    return hasPermissionRequirement(context.permissions, { anyOf: item.requiredPermissions })
  }

  if (!item.pageKey) return true
  return hasPermissionRequirement(context.permissions, getAdminPageRequirement(item.pageKey))
}

export function getAdminNavigationGroups(context: AdminNavigationContext): AdminNavigationGroup[] {
  const mode = context.isPlatformAdmin ? context.mode ?? 'platform_view' : 'company_view'
  const groups = mode === 'platform_view' ? PLATFORM_NAVIGATION : COMPANY_NAVIGATION

  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => canAccessAdminNavigationItem(item, context)),
    }))
    .filter((group) => group.items.length > 0)
}
