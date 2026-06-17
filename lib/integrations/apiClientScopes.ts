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
    scopes: ['customer_documents.read', 'customer_notifications.read', 'customer_notifications.write'],
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
  'customer_portal.read',
  'customer_portal.write',
  'website_applications.write',
  'website_events.write',
  'events.read',
  'customer_documents.read',
  'customer_notifications.read',
  'customer_notifications.write',
  'customer_contact.write',
  'customer_facility_data.write',
  'customer_power_of_attorney.write',
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
