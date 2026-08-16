export type ApiPermissionGroup = {
  groupKey: string
  label: string
  description: string
  category: 'website' | 'portal' | 'events'
  scopes: string[]
  recommendedDefault: boolean
  riskLevel: 'low' | 'normal' | 'high'
  sortOrder: number
}

export const INTEGRATION_API_PERMISSION_GROUPS: ApiPermissionGroup[] = [
  {
    groupKey: 'integration_context',
    label: 'Verifiera tenantidentitet',
    description: 'Integrationen får verifiera API-nyckelns opaka tenant_reference utan att exponera internt company_id.',
    category: 'website',
    scopes: ['integration_context.read'],
    recommendedDefault: true,
    riskLevel: 'low',
    sortOrder: 5,
  },
  {
    groupKey: 'website_quotes',
    label: 'Beräkna och validera canonical prisquote',
    description: 'Hemsidan får skapa en tenantbunden quote från exakt publicerad avtalsversion och valt SE-område och validera den före teckning.',
    category: 'website',
    scopes: ['website_quotes.write', 'website_quotes.validate'],
    recommendedDefault: true,
    riskLevel: 'normal',
    sortOrder: 8,
  },
  {
    groupKey: 'website_market_prices',
    label: 'Läs aktuellt spotpris',
    description: 'Hemsidan får läsa aktuellt normaliserat spotpris för det SE-område som OPS har bundit till resolution_id.',
    category: 'website',
    scopes: ['website_market_prices.read'],
    recommendedDefault: true,
    riskLevel: 'low',
    sortOrder: 9,
  },
  {
    groupKey: 'website_energy_area',
    label: 'Lös el- och nätområde',
    description: 'Hemsidan får använda OPS canonical resolver för prisområde, nätområde och nätägare före quote och teckning.',
    category: 'website',
    scopes: ['website_energy_area.resolve'],
    recommendedDefault: true,
    riskLevel: 'normal',
    sortOrder: 9,
  },
  {
    groupKey: 'website_switch_status',
    label: 'Läs leverantörsbytesstatus',
    description: 'Hemsidan får läsa aktuell tenant-skopad status och händelser för en inskickad kundansökan.',
    category: 'website',
    scopes: ['website_switch_status.read'],
    recommendedDefault: true,
    riskLevel: 'normal',
    sortOrder: 10,
  },
  {
    groupKey: 'api_contracts',
    label: 'Hämta API-publicerade avtal',
    description: 'Partnerintegrationer får läsa avtal som publicerats till den separata api-kanalen.',
    category: 'website',
    scopes: ['api_contracts.read'],
    recommendedDefault: false,
    riskLevel: 'low',
    sortOrder: 11,
  },
  {
    groupKey: 'api_contract_diagnostics',
    label: 'Diagnostisera API-publicerade avtal',
    description: 'Partnerintegrationer får läsa tenant-skopade blockerare för den separata api-kanalen.',
    category: 'website',
    scopes: ['api_contracts.diagnostics'],
    recommendedDefault: false,
    riskLevel: 'normal',
    sortOrder: 12,
  },
  {
    groupKey: 'website_contracts',
    label: 'Hämta avtal till hemsidan',
    description: 'Hemsidan får läsa publicerade elavtal för rätt bolag.',
    category: 'website',
    scopes: ['website_contracts.read'],
    recommendedDefault: true,
    riskLevel: 'low',
    sortOrder: 10,
  },
  {
    groupKey: 'website_contract_diagnostics',
    label: 'Diagnostisera hemsidans avtal',
    description: 'Serverintegrationer får läsa tenant-skopad avtals- och publiceringsdiagnostik.',
    category: 'website',
    scopes: ['website_contracts.diagnostics'],
    recommendedDefault: false,
    riskLevel: 'normal',
    sortOrder: 12,
  },
  {
    groupKey: 'website_legal',
    label: 'Hämta juridik och fullmakt till hemsidan',
    description: 'Hemsidan får läsa publicerade juridiska dokument och fullmaktskrav (legal bundle).',
    category: 'website',
    scopes: ['website_legal.read'],
    recommendedDefault: true,
    riskLevel: 'low',
    sortOrder: 15,
  },
  {
    groupKey: 'website_applications',
    label: 'Skicka kundansökningar',
    description: 'Hemsidan får skicka in nya kunder och teckningar till kundplattformen.',
    category: 'website',
    scopes: ['website_applications.write'],
    recommendedDefault: true,
    riskLevel: 'normal',
    sortOrder: 20,
  },
  {
    groupKey: 'partner_api',
    label: 'Partner API',
    description: 'Backendintegrationer får registrera och läsa sina kund-, anläggnings-, avtals-, fullmakts-, faktura- och mätdata samt hantera egna webhook-prenumerationer. Bolagskontext väljs alltid av API-nyckeln.',
    category: 'events',
    scopes: [
      'partner_contracts.write',
      'partner_customers.write',
      'partner_sites.write',
      'partner_power_of_attorney.write',
      'partner_webhooks.manage',
      'customer_contracts.read',
      'customer_profile.read',
      'customer_sites.read',
      'customer_power_of_attorney.read',
      'customer_invoices.read',
      'customer_metering.read',
    ],
    recommendedDefault: false,
    riskLevel: 'high',
    sortOrder: 25,
  },
  {
    groupKey: 'customer_portal',
    label: 'Mina sidor',
    description: 'Kunden kan se och komplettera uppgifter, avtal, anläggningar, fakturor och status.',
    category: 'portal',
    scopes: ['customer_portal.read', 'customer_portal.write'],
    recommendedDefault: true,
    riskLevel: 'normal',
    sortOrder: 30,
  },
  {
    groupKey: 'customer_events',
    label: 'Kundhändelser och status',
    description: 'Hemsidan kan skicka och läsa kundhändelser/statusar.',
    category: 'events',
    scopes: ['website_events.write', 'events.read'],
    recommendedDefault: true,
    riskLevel: 'low',
    sortOrder: 40,
  },
  {
    groupKey: 'documents_notifications',
    label: 'Dokument och notiser',
    description: 'Kunden kan se dokument/notiser och markera notiser som lästa i kundportalen.',
    category: 'portal',
    scopes: ['customer_documents.read', 'customer_documents.write', 'customer_notifications.read', 'customer_notifications.write'],
    recommendedDefault: true,
    riskLevel: 'normal',
    sortOrder: 50,
  },
  {
    groupKey: 'facility_power_of_attorney',
    label: 'Komplettera anläggning och fullmakt',
    description: 'Kommande mer granulär behörighet för kontaktuppgifter, anläggningsdata och fullmakt. Tills routes är helt uppdelade används customer_portal.write.',
    category: 'portal',
    scopes: ['customer_contact.write', 'customer_facility_data.write', 'customer_power_of_attorney.write'],
    recommendedDefault: true,
    riskLevel: 'high',
    sortOrder: 60,
  },
]

export const CUSTOMER_PORTAL_SCOPES = [
  'integration_context.read',
  'website_quotes.write',
  'website_quotes.validate',
  'website_energy_area.resolve',
  'website_market_prices.read',
  'website_switch_status.read',
  'website_contracts.read',
  'customer_portal.read',
  'customer_portal.write',

  'customer_sync.write',
  'customer_profile.read',
  'customer_sites.read',
  'customer_contracts.read',
  'customer_invoices.read',
  'customer_metering.read',
  'customer_legal.read',
  'customer_events.read',
  'customer_power_of_attorney.read',
  'api_contracts.read',
  'api_contracts.diagnostics',
  'website_contracts.diagnostics',
  'website_legal.read',
  'website_applications.write',
  'website_events.write',
  'events.read',
  'customer_documents.read',
  'customer_documents.write',
  'customer_notifications.read',
  'customer_notifications.write',
  'customer_contact.write',
  'customer_facility_data.write',
  'customer_power_of_attorney.write',
  'partner_contracts.write',
  'partner_customers.write',
  'partner_sites.write',
  'partner_power_of_attorney.write',
  'partner_webhooks.manage',
] as const

export const INTEGRATION_API_SCOPE_OPTIONS = INTEGRATION_API_PERMISSION_GROUPS.flatMap((group) =>
  group.scopes.map((scope) => ({
    value: scope,
    label: `${group.label} · ${scope}`,
    description: group.description,
  }))
)

export type IntegrationApiScope = typeof INTEGRATION_API_SCOPE_OPTIONS[number]['value']

export const ALLOWED_INTEGRATION_API_SCOPE_VALUES = new Set<string>(
  INTEGRATION_API_SCOPE_OPTIONS.map((scope) => scope.value)
)

export const ALLOWED_INTEGRATION_API_PERMISSION_GROUPS = new Set<string>(
  INTEGRATION_API_PERMISSION_GROUPS.map((group) => group.groupKey)
)

export function scopesForPermissionGroups(groupKeys: unknown[]): string[] {
  const selected = new Set(
    groupKeys
      .flatMap((value) => String(value ?? '').split(/[\s,]+/))
      .map((value) => value.trim())
      .filter((value) => ALLOWED_INTEGRATION_API_PERMISSION_GROUPS.has(value))
  )

  const scopes = INTEGRATION_API_PERMISSION_GROUPS
    .filter((group) => selected.has(group.groupKey))
    .flatMap((group) => group.scopes)

  return Array.from(new Set(scopes))
}

export function recommendedPermissionGroups(): string[] {
  return INTEGRATION_API_PERMISSION_GROUPS
    .filter((group) => group.recommendedDefault)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((group) => group.groupKey)
}

export function permissionGroupLabelsForScopes(scopes: string[] | null | undefined): string[] {
  const scopeSet = new Set(scopes ?? [])
  return INTEGRATION_API_PERMISSION_GROUPS
    .filter((group) => group.scopes.some((scope) => scopeSet.has(scope)))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((group) => group.label)
}
