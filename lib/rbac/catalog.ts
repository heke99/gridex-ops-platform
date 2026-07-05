import type { AppRole } from '@/types/rbac'

export type RoleCatalogItem = {
  key: AppRole | string
  label: string
  description: string
  audience: 'internal' | 'customer' | 'integration'
  recommendedFor: string
  loginAllowed: boolean
}

export type BehörighetCatalogItem = {
  key: string
  label: string
  description: string
  area: string
  risk: 'low' | 'medium' | 'high'
}

export type PermissionCatalogItem = BehörighetCatalogItem

export const ROLE_CATALOG: RoleCatalogItem[] = [
  {
    key: 'super_admin',
    label: 'Super admin',
    description:
      'Full intern åtkomst. Kan styra roller, permissions och hela accessmodellen.',
    audience: 'internal',
    recommendedFor: 'Ägare eller plattformsansvarig.',
    loginAllowed: true,
  },
  {
    key: 'company_admin',
    label: 'Bolagsansvarig',
    description:
      'Administrerar användare och dagliga flöden inom sitt eget elhandelsbolag.',
    audience: 'internal',
    recommendedFor: 'Ansvarig hos elhandelsbolag på plattformen.',
    loginAllowed: true,
  },
  {
    key: 'admin',
    label: 'Admin',
    description:
      'Bred intern adminåtkomst för daglig styrning av system, användare och drift.',
    audience: 'internal',
    recommendedFor: 'Huvudadministratör eller driftansvarig.',
    loginAllowed: true,
  },
  {
    key: 'operations_manager',
    label: 'Operations manager',
    description:
      'Operativ ledarroll för switch, utskick, meterflöden och processuppföljning.',
    audience: 'internal',
    recommendedFor: 'Operations lead.',
    loginAllowed: true,
  },
  {
    key: 'operations_agent',
    label: 'Operations agent',
    description:
      'Daglig operativ handläggning av switch, meter, site och relaterade flöden.',
    audience: 'internal',
    recommendedFor: 'Operationshandläggare.',
    loginAllowed: true,
  },
  {
    key: 'customer_service_manager',
    label: 'Kundnära drift manager',
    description:
      'Leder kundnära drift och behöver läsa kundbild, kommunikation och avtal.',
    audience: 'internal',
    recommendedFor: 'Kundnära driftledare.',
    loginAllowed: true,
  },
  {
    key: 'customer_service_agent',
    label: 'Kundnära drift',
    description:
      'Roll för kundnära drift, kommunikation och läsning av centrala kundflöden.',
    audience: 'internal',
    recommendedFor: 'Kundnära drift.',
    loginAllowed: true,
  },
  {
    key: 'pricing_manager',
    label: 'Pricing manager',
    description:
      'Ansvarar för prisarbete, prisversioner och kampanjer.',
    audience: 'internal',
    recommendedFor: 'Pris- eller produktansvarig.',
    loginAllowed: true,
  },
  {
    key: 'pricing_approver',
    label: 'Pricing approver',
    description:
      'Kan granska och godkänna pricing utan full adminroll.',
    audience: 'internal',
    recommendedFor: 'Chef eller beslutsfattare för pricing.',
    loginAllowed: true,
  },
  {
    key: 'compliance_manager',
    label: 'Compliance manager',
    description:
      'Roll för revision, kontroll och efterlevnad.',
    audience: 'internal',
    recommendedFor: 'Compliance eller kontrollfunktion.',
    loginAllowed: true,
  },
  {
    key: 'sales_manager',
    label: 'Sales manager',
    description:
      'Kommersiell roll för kundinflöde, pipeline och säljrelaterad uppföljning.',
    audience: 'internal',
    recommendedFor: 'Säljledning.',
    loginAllowed: true,
  },
  {
    key: 'partner_manager',
    label: 'Partner manager',
    description:
      'Ansvarar för partnerexporter och externa integrationsrelationer.',
    audience: 'internal',
    recommendedFor: 'Partner- eller integrationsansvarig.',
    loginAllowed: true,
  },
  {
    key: 'finance_readonly',
    label: 'Finance readonly',
    description:
      'Läsbehörighet för ekonomi eller controller.',
    audience: 'internal',
    recommendedFor: 'Ekonomi eller controlling.',
    loginAllowed: true,
  },
  {
    key: 'executive_readonly',
    label: 'Executive readonly',
    description:
      'Läsroll för ledning med överblick men utan skrivåtkomst.',
    audience: 'internal',
    recommendedFor: 'VD, styrelse eller ledningsgrupp.',
    loginAllowed: true,
  },
  {
    key: 'partner_api_user',
    label: 'Partner API user',
    description:
      'Teknisk integrationsidentitet för partner eller systemkoppling.',
    audience: 'integration',
    recommendedFor: 'Extern eller teknisk integration.',
    loginAllowed: true,
  },
  {
    key: 'customer',
    label: 'Kund',
    description:
      'Klassning av kund i systemet. Ska inte användas för intern admininloggning.',
    audience: 'customer',
    recommendedFor: 'Kundobjekt eller framtida kundportal.',
    loginAllowed: false,
  },
]

const PERMISSION_CATALOG: BehörighetCatalogItem[] = [
  {
    key: 'tenants.read',
    label: 'Läsa bolag',
    description: 'Kan se bolag på plattformen.',
    area: 'SaaS',
    risk: 'medium',
  },
  {
    key: 'tenants.write',
    label: 'Skapa och ändra bolag',
    description: 'Kan skapa nya elhandelsbolag och uppdatera bolagsinformation.',
    area: 'SaaS',
    risk: 'high',
  },
  {
    key: 'tenants.invite',
    label: 'Bjuda in till bolag',
    description: 'Kan koppla användare till ett elhandelsbolag.',
    area: 'SaaS',
    risk: 'high',
  },
  {
    key: 'users.read',
    label: 'Läsa användare',
    description: 'Kan se användarlistan och öppna användarkort.',
    area: 'Access',
    risk: 'medium',
  },
  {
    key: 'users.write',
    label: 'Skapa eller ändra användare',
    description: 'Kan skapa konton eller ändra användarrelaterad accesslogik.',
    area: 'Access',
    risk: 'high',
  },
  {
    key: 'roles.manage',
    label: 'Hantera roller',
    description: 'Kan tilldela eller ta bort roller för användare.',
    area: 'Access',
    risk: 'high',
  },
  {
    key: 'permissions.manage',
    label: 'Hantera individuella behörigheter',
    description: 'Kan sätta individuella allow/deny-overrides per behörighet.',
    area: 'Access',
    risk: 'high',
  },
  {
    key: 'customers.read',
    label: 'Läsa kunder',
    description: 'Kan se kundregister och kundkort.',
    area: 'Kunder',
    risk: 'low',
  },
  {
    key: 'customers.write',
    label: 'Ändra kunder',
    description: 'Kan ändra kunddata.',
    area: 'Kunder',
    risk: 'high',
  },
  {
    key: 'contracts.read',
    label: 'Läsa avtal',
    description: 'Kan se avtal och kontraktsdata.',
    area: 'Avtal',
    risk: 'low',
  },
  {
    key: 'contracts.write',
    label: 'Ändra avtal',
    description: 'Kan ändra avtal och kontraktsdata.',
    area: 'Avtal',
    risk: 'high',
  },
  {
    key: 'documents.read',
    label: 'Läsa dokument',
    description: 'Kan se uppladdade dokument och dokumentstatus.',
    area: 'Dokument',
    risk: 'low',
  },
  {
    key: 'documents.write',
    label: 'Ändra dokument',
    description: 'Kan ladda upp eller ändra dokument.',
    area: 'Dokument',
    risk: 'high',
  },
  {
    key: 'communication.read',
    label: 'Läsa kommunikation',
    description: 'Kan läsa kommunikationshistorik och utskick.',
    area: 'Kommunikation',
    risk: 'low',
  },
  {
    key: 'communication.send',
    label: 'Skicka kommunikation',
    description: 'Kan skicka meddelanden eller kommunikation.',
    area: 'Kommunikation',
    risk: 'high',
  },
  {
    key: 'cases.read',
    label: 'Läsa driftuppgifter',
    description: 'Kan läsa driftuppgifter kopplade till kund.',
    area: 'Drift',
    risk: 'low',
  },
  {
    key: 'cases.write',
    label: 'Ändra driftuppgifter',
    description: 'Kan skapa eller ändra driftuppgifter kopplade till kund.',
    area: 'Drift',
    risk: 'high',
  },
  {
    key: 'switching.read',
    label: 'Läsa switch',
    description: 'Kan se switchflöden och leverantörsbyten.',
    area: 'Operations',
    risk: 'low',
  },
  {
    key: 'switching.write',
    label: 'Ändra switch',
    description: 'Kan skapa eller ändra switchflöden.',
    area: 'Operations',
    risk: 'high',
  },
  {
    key: 'metering.read',
    label: 'Läsa mätning',
    description: 'Kan läsa meteringdata.',
    area: 'Metering',
    risk: 'low',
  },
  {
    key: 'metering.write',
    label: 'Ändra mätning',
    description: 'Kan ändra meteringflöden.',
    area: 'Metering',
    risk: 'high',
  },
  {
    key: 'metering_points.read',
    label: 'Läsa mätpunkter',
    description: 'Kan läsa mätpunkter.',
    area: 'Metering',
    risk: 'low',
  },
  {
    key: 'metering_points.write',
    label: 'Ändra mätpunkter',
    description: 'Kan ändra mätpunkter.',
    area: 'Metering',
    risk: 'high',
  },
  {
    key: 'sites.read',
    label: 'Läsa anläggningar',
    description: 'Kan läsa sites/anläggningar.',
    area: 'Masterdata',
    risk: 'low',
  },
  {
    key: 'sites.write',
    label: 'Ändra anläggningar',
    description: 'Kan ändra sites/anläggningar.',
    area: 'Masterdata',
    risk: 'high',
  },
  {
    key: 'masterdata.read',
    label: 'Läsa masterdata',
    description: 'Kan läsa masterdata.',
    area: 'Masterdata',
    risk: 'low',
  },
  {
    key: 'masterdata.write',
    label: 'Ändra masterdata',
    description: 'Kan ändra masterdata.',
    area: 'Masterdata',
    risk: 'high',
  },
  {
    key: 'billing_underlay.read',
    label: 'Läsa billing underlag',
    description: 'Kan se billing-underlag.',
    area: 'Billing',
    risk: 'medium',
  },
  {
    key: 'billing_underlay.export',
    label: 'Exportera billing underlag',
    description: 'Kan exportera billing-underlag.',
    area: 'Billing',
    risk: 'high',
  },
  {
    key: 'partner_exports.read',
    label: 'Läsa partnerexporter',
    description: 'Kan läsa partnerexporter.',
    area: 'Partner',
    risk: 'medium',
  },
  {
    key: 'partner_exports.write',
    label: 'Ändra partnerexporter',
    description: 'Kan skapa eller ändra partnerexporter.',
    area: 'Partner',
    risk: 'high',
  },
  {
    key: 'poa.read',
    label: 'Läsa fullmakter',
    description: 'Kan läsa powers of attorney.',
    area: 'POA',
    risk: 'low',
  },
  {
    key: 'poa.write',
    label: 'Ändra fullmakter',
    description: 'Kan ändra powers of attorney.',
    area: 'POA',
    risk: 'high',
  },
  {
    key: 'pricing.read',
    label: 'Läsa pricing',
    description: 'Kan läsa pricing.',
    area: 'Pricing',
    risk: 'medium',
  },
  {
    key: 'pricing.write',
    label: 'Ändra pricing',
    description: 'Kan ändra pricing.',
    area: 'Pricing',
    risk: 'high',
  },
  {
    key: 'pricing.publish',
    label: 'Publicera pricing',
    description: 'Kan publicera pricing.',
    area: 'Pricing',
    risk: 'high',
  },
  {
    key: 'integrations.read',
    label: 'Läsa integrationer',
    description: 'Kan läsa webhookar och integrationsinställningar för bolaget.',
    area: 'Integrationer',
    risk: 'medium',
  },
  {
    key: 'integrations.write',
    label: 'Ändra integrationer',
    description: 'Kan hantera webhookar och integrationsinställningar för bolaget.',
    area: 'Integrationer',
    risk: 'high',
  },
  {
    key: 'reports.read',
    label: 'Läsa rapporter',
    description: 'Kan läsa rapporter.',
    area: 'Rapporter',
    risk: 'low',
  },
  {
    key: 'audit.read',
    label: 'Läsa auditloggar',
    description: 'Kan läsa auditloggar.',
    area: 'Audit',
    risk: 'medium',
  },
]

const roleMap = new Map(ROLE_CATALOG.map((role) => [role.key, role]))
const permissionMap = new Map(PERMISSION_CATALOG.map((permission) => [permission.key, permission]))

function titleCase(value: string): string {
  return value
    .split(/[_./-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function getRoleMeta(roleKey: string): RoleCatalogItem {
  return (
    roleMap.get(roleKey) ?? {
      key: roleKey,
      label: titleCase(roleKey),
      description: 'Ingen manuell beskrivning finns ännu för denna roll.',
      audience: 'internal',
      recommendedFor: 'Intern användning efter granskning.',
      loginAllowed: true,
    }
  )
}

export function getBehörighetMeta(permissionKey: string): BehörighetCatalogItem {
  return (
    permissionMap.get(permissionKey) ?? {
      key: permissionKey,
      label: titleCase(permissionKey),
      description: 'Ingen manuell beskrivning finns ännu för denna behörighet.',
      area: permissionKey.includes('.')
        ? titleCase(permissionKey.split('.')[0] ?? 'Övrigt')
        : 'Övrigt',
      risk:
        permissionKey.endsWith('.write') ||
        permissionKey.endsWith('.manage') ||
        permissionKey.endsWith('.publish') ||
        permissionKey.endsWith('.export')
          ? 'high'
          : 'medium',
    }
  )
}

export function getInternalRoleOptions<T extends { id: string; key: string; name: string }>(
  roles: T[]
): T[] {
  return roles.filter((role) => role.key !== 'customer')
}

export function sortBehörigheter<T extends { key: string }>(permissions: T[]): T[] {
  return [...permissions].sort((a, b) => {
    const areaCompare = getBehörighetMeta(a.key).area.localeCompare(
      getBehörighetMeta(b.key).area,
      'sv'
    )

    if (areaCompare !== 0) return areaCompare

    return getBehörighetMeta(a.key).label.localeCompare(
      getBehörighetMeta(b.key).label,
      'sv'
    )
  })
}

export function getPermissionMeta(permissionKey: string): PermissionCatalogItem {
  return getBehörighetMeta(permissionKey)
}

export function sortPermissions<T extends { key: string }>(permissions: T[]): T[] {
  return sortBehörigheter(permissions)
}
