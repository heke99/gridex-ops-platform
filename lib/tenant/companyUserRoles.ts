export type CompanyMembershipRoleOption = {
  value: string
  label: string
  description: string
}

export type CompanyUserRoleOption = {
  value: string
  label: string
  description: string
  recommendedMembershipRole: string
}

export const COMPANY_MEMBERSHIP_ROLE_OPTIONS: CompanyMembershipRoleOption[] = [
  { value: 'owner', label: 'Ägare', description: 'Högsta bolagsansvar inom tenant.' },
  { value: 'admin', label: 'Admin', description: 'Bred bolagsadministration.' },
  { value: 'company_admin', label: 'Bolagsansvarig', description: 'Ansvarig användare hos elhandelsbolaget.' },
  { value: 'operations', label: 'Operations', description: 'Daglig drift och handläggning.' },
  { value: 'support', label: 'Kundnära drift', description: 'Kundnära operativt arbete.' },
  { value: 'member', label: 'Medlem', description: 'Standardkoppling inom bolaget.' },
  { value: 'viewer', label: 'Läsroll', description: 'Läsbehörighet utan operativ ändring.' },
]

export const COMPANY_USER_ROLE_OPTIONS: CompanyUserRoleOption[] = [
  {
    value: 'company_admin',
    label: 'Bolagsansvarig',
    description: 'Kan administrera bolaget, användare och dagliga flöden.',
    recommendedMembershipRole: 'company_admin',
  },
  {
    value: 'admin',
    label: 'Admin',
    description: 'Bred daglig adminåtkomst inom bolaget.',
    recommendedMembershipRole: 'admin',
  },
  {
    value: 'operations_manager',
    label: 'Operationsansvarig',
    description: 'Kan leda switch, mätvärden, utskick och operationsflöden.',
    recommendedMembershipRole: 'operations',
  },
  {
    value: 'operations_agent',
    label: 'Operationshandläggare',
    description: 'Kan arbeta med daglig operationshandläggning.',
    recommendedMembershipRole: 'operations',
  },
  {
    value: 'customer_service_manager',
    label: 'Kundtjänstansvarig',
    description: 'Kan leda kundnära drift och hantera kundnära uppgifter.',
    recommendedMembershipRole: 'support',
  },
  {
    value: 'customer_service_agent',
    label: 'Kundtjänst',
    description: 'Kan hantera kundnära driftuppgifter och läsa kundbilden.',
    recommendedMembershipRole: 'support',
  },
  {
    value: 'sales_manager',
    label: 'Säljansvarig',
    description: 'Kan arbeta med kundintag och kommersiell uppföljning.',
    recommendedMembershipRole: 'member',
  },
  {
    value: 'pricing_manager',
    label: 'Prisansvarig',
    description: 'Kan arbeta med kampanjer, prisversioner och prisförslag.',
    recommendedMembershipRole: 'member',
  },
  {
    value: 'pricing_approver',
    label: 'Prisgodkännare',
    description: 'Kan granska och godkänna pricing.',
    recommendedMembershipRole: 'viewer',
  },
  {
    value: 'finance_readonly',
    label: 'Ekonomi',
    description: 'Kan läsa fakturering, export och ekonomirelaterade vyer.',
    recommendedMembershipRole: 'viewer',
  },
  {
    value: 'executive_readonly',
    label: 'Ledning',
    description: 'Kan se lednings- och rapportöverblick.',
    recommendedMembershipRole: 'viewer',
  },
  {
    value: 'compliance_manager',
    label: 'Compliance',
    description: 'Kan granska audit, kontrollspår och efterlevnad.',
    recommendedMembershipRole: 'viewer',
  },
  {
    value: 'partner_manager',
    label: 'Partneransvarig',
    description: 'Kan följa partnerexporter och integrationsflöden.',
    recommendedMembershipRole: 'member',
  },
  {
    value: 'partner_api_user',
    label: 'API-/partneranvändare',
    description: 'Teknisk integrationsidentitet med begränsad adminanvändning.',
    recommendedMembershipRole: 'member',
  },
]

export const COMPANY_ASSIGNABLE_MEMBERSHIP_ROLES = new Set(
  COMPANY_MEMBERSHIP_ROLE_OPTIONS.map((option) => option.value),
)

export const COMPANY_ASSIGNABLE_ROLE_KEYS = new Set(
  COMPANY_USER_ROLE_OPTIONS.map((option) => option.value),
)

export const COMPANY_PRIMARY_USER_ROLE_KEYS = COMPANY_USER_ROLE_OPTIONS.map((option) => option.value)

export function getCompanyMembershipRoleLabel(value: string | null | undefined) {
  return COMPANY_MEMBERSHIP_ROLE_OPTIONS.find((option) => option.value === value)?.label ?? value ?? '–'
}

export function getCompanyUserRoleLabel(value: string | null | undefined) {
  return COMPANY_USER_ROLE_OPTIONS.find((option) => option.value === value)?.label ?? value ?? '–'
}

export function parseCompanyAssignableMembershipRole(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim() || 'member'
  if (!COMPANY_ASSIGNABLE_MEMBERSHIP_ROLES.has(normalized)) {
    throw new Error('Bolagsrollen är inte tillåten på bolagsnivå.')
  }
  return normalized
}

export function parseCompanyAssignableRoleKey(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim() || 'company_admin'
  if (!COMPANY_ASSIGNABLE_ROLE_KEYS.has(normalized)) {
    throw new Error('Systemrollen är inte tillåten på bolagsnivå.')
  }
  return normalized
}


export function resolveCanonicalCompanyAccessRole(value: string | null | undefined): {
  roleKey: string
  membershipRole: string
} {
  const roleKey = parseCompanyAssignableRoleKey(value)
  const option = COMPANY_USER_ROLE_OPTIONS.find((candidate) => candidate.value === roleKey)
  if (!option) throw new Error('Systemrollen saknar canonical medlemskapsmappning.')
  return { roleKey, membershipRole: option.recommendedMembershipRole }
}
