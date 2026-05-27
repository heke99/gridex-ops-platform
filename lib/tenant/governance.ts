import { supabaseService } from '@/lib/supabase/service'

export type CompanyOperationalStatus =
  | 'active'
  | 'onboarding'
  | 'paused'
  | 'suspended'
  | 'archived'
  | 'pending_deletion'
  | 'deleted_test_only'

export type UserOperationalStatus =
  | 'active'
  | 'disabled'
  | 'removed_from_company'
  | 'invitation_revoked'
  | 'locked_security'

export type GovernanceEventAction =
  | 'SUPERADMIN_COMPANY_PAUSED'
  | 'SUPERADMIN_COMPANY_REACTIVATED'
  | 'SUPERADMIN_COMPANY_SUSPENDED'
  | 'SUPERADMIN_COMPANY_ARCHIVED'
  | 'SUPERADMIN_COMPANY_DELETION_REQUESTED'
  | 'SUPERADMIN_COMPANY_DELETED_TEST_ONLY'
  | 'SUPERADMIN_DELETE_BLOCKED_DUE_TO_HISTORY'
  | 'SUPERADMIN_USER_DISABLED'
  | 'SUPERADMIN_USER_REACTIVATED'
  | 'SUPERADMIN_USER_REMOVED_FROM_COMPANY'
  | 'SUPERADMIN_ROLE_CHANGED'
  | 'SUPERADMIN_COMPANY_CONTACTS_ANONYMIZED'
  | 'SUPERADMIN_OPEN_TASKS_TRANSFERRED'

export type GovernanceCount = {
  table: string
  label: string
  count: number
}

export type GovernanceCompany = {
  id: string
  name: string
  slug: string | null
  org_number: string | null
  status: CompanyOperationalStatus
  status_reason: string | null
  primary_contact_email: string | null
  primary_contact_name: string | null
  phone: string | null
  website: string | null
  created_at: string | null
  updated_at: string | null
  activeUsers: number
  pendingInvites: number
  customers: number
  contracts: number
  edielMessages: number
  meteringValues: number
  billingUnderlays: number
  partnerExports: number
  outboundRequests: number
  missingEdielProfile: boolean
  blockedBillingUnderlays: number
  latestAuditAt: string | null
  latestEdielAt: string | null
  deleteBlockers: GovernanceCount[]
  canHardDelete: boolean
}

export type CompanyUserGovernanceRow = {
  membershipId: string
  companyId: string
  userId: string
  email: string | null
  fullName: string | null
  membershipRole: string
  roleKey: string | null
  status: string
  invitedEmail: string | null
  invitedAt: string | null
  acceptedAt: string | null
  disabledAt: string | null
  removedAt: string | null
  userStatus: UserOperationalStatus | null
}

type CountFilter = {
  column: string
  value: string | number | boolean | string[]
  op?: 'eq' | 'in' | 'neq'
}

type CompanyRow = {
  id: string
  name: string
  slug?: string | null
  org_number?: string | null
  status?: string | null
  status_reason?: string | null
  primary_contact_email?: string | null
  primary_contact_name?: string | null
  phone?: string | null
  website?: string | null
  billing_contact_email?: string | null
  support_email?: string | null
  address_line_1?: string | null
  address_line_2?: string | null
  postal_code?: string | null
  city?: string | null
  country_code?: string | null
  ediel_id?: string | null
  actor_role?: string | null
  sender_sub_address?: string | null
  ediel_mailbox?: string | null
  operating_environment?: string | null
  production_status?: string | null
  live_ediel_enabled?: boolean | null
  live_approved_at?: string | null
  live_blocked_reason?: string | null
  production_ediel_id?: string | null
  production_mailbox?: string | null
  production_application_reference?: string | null
  production_counterparty_ediel_id?: string | null
  branding?: Record<string, unknown> | null
  created_at?: string | null
  updated_at?: string | null
}

const HISTORY_TABLES: Array<{ table: string; label: string }> = [
  { table: 'customers', label: 'kunder' },
  { table: 'customer_contracts', label: 'avtal' },
  { table: 'customer_authorization_documents', label: 'fullmakter/dokument' },
  { table: 'powers_of_attorney', label: 'fullmakter' },
  { table: 'supplier_switch_requests', label: 'switchärenden' },
  { table: 'grid_owner_data_requests', label: 'nätägarförfrågningar' },
  { table: 'ediel_messages', label: 'Ediel-meddelanden' },
  { table: 'metering_values', label: 'mätvärden' },
  { table: 'billing_underlays', label: 'faktureringsunderlag' },
  { table: 'partner_exports', label: 'exporthistorik' },
  { table: 'outbound_requests', label: 'utskick' },
]

export const BLOCKED_TENANT_WRITE_STATUSES = new Set<CompanyOperationalStatus>([
  'paused',
  'suspended',
  'archived',
  'pending_deletion',
  'deleted_test_only',
])

export function normalizeCompanyStatus(value: string | null | undefined): CompanyOperationalStatus {
  if (
    value === 'active' ||
    value === 'onboarding' ||
    value === 'paused' ||
    value === 'suspended' ||
    value === 'archived' ||
    value === 'pending_deletion' ||
    value === 'deleted_test_only'
  ) {
    return value
  }

  if (value === 'inactive') return 'suspended'
  return 'active'
}

export function isCompanyOperationalForWrites(status: string | null | undefined): boolean {
  return !BLOCKED_TENANT_WRITE_STATUSES.has(normalizeCompanyStatus(status))
}

export function getCompanyStatusCopy(status: string | null | undefined) {
  const normalized = normalizeCompanyStatus(status)

  const copy: Record<CompanyOperationalStatus, { label: string; tone: string; description: string }> = {
    active: {
      label: 'Aktivt',
      tone: 'border-emerald-200 bg-emerald-50 text-emerald-800',
      description: 'Bolaget kan skapa kunder, skicka Ediel, köra switchar och exportera underlag.',
    },
    onboarding: {
      label: 'Onboarding',
      tone: 'border-sky-200 bg-sky-50 text-sky-800',
      description: 'Bolaget är under uppsättning och kan arbeta operativt.',
    },
    paused: {
      label: 'Pausat',
      tone: 'border-amber-200 bg-amber-50 text-amber-800',
      description: 'Ny drift är stoppad. Historik ligger kvar i läsläge.',
    },
    suspended: {
      label: 'Avstängt',
      tone: 'border-red-200 bg-red-50 text-red-800',
      description: 'Bolaget är permanent stoppat men historiken bevaras.',
    },
    archived: {
      label: 'Arkiverat',
      tone: 'border-slate-200 bg-slate-50 text-slate-700',
      description: 'Bolaget är dolt från daglig drift men historik finns kvar.',
    },
    pending_deletion: {
      label: 'Radering begärd',
      tone: 'border-orange-200 bg-orange-50 text-orange-800',
      description: 'Bolaget väntar på raderingskontroll. Historiska kopplingar blockerar hård radering.',
    },
    deleted_test_only: {
      label: 'Raderat testbolag',
      tone: 'border-slate-300 bg-slate-100 text-slate-700',
      description: 'Endast för test-/felregistrering utan historik.',
    },
  }

  return copy[normalized]
}

async function safeCount(table: string, filters: CountFilter[] = []): Promise<number> {
  try {
    let query = supabaseService.from(table).select('id', { count: 'exact', head: true })

    for (const filter of filters) {
      if (filter.op === 'in' && Array.isArray(filter.value)) {
        query = query.in(filter.column, filter.value)
      } else if (filter.op === 'neq') {
        query = query.neq(filter.column, filter.value as string | number | boolean)
      } else {
        query = query.eq(filter.column, filter.value as string | number | boolean)
      }
    }

    const { count, error } = await query
    if (error) return 0
    return count ?? 0
  } catch {
    return 0
  }
}


function isIgnorableSchemaError(error: { code?: string | null; message?: string | null } | null | undefined) {
  if (!error) return false
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(error.code ?? '')
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function inferCompanyUserRoleKey(value: string | null | undefined): string | null {
  if (!value) return null
  const normalized = value.trim()
  if (!normalized) return null
  if (normalized === 'owner' || normalized === 'admin' || normalized === 'company_admin') return 'company_admin'
  if (normalized === 'operations') return 'operations_manager'
  if (normalized === 'support') return 'customer_service_agent'
  if (normalized === 'viewer') return 'executive_readonly'
  return normalized
}

async function listCompanyMembershipRowsForGovernance(companyId: string): Promise<Array<Record<string, unknown>>> {
  const full = await supabaseService
    .from('company_memberships')
    .select('id, company_id, user_id, membership_role, role_key, role, status, invited_email, invited_at, accepted_at, disabled_at, removed_at, joined_at, created_at')
    .eq('company_id', companyId)
    .order('invited_at', { ascending: false })

  if (!full.error) return (full.data ?? []) as Array<Record<string, unknown>>
  if (!isIgnorableSchemaError(full.error)) throw full.error

  const fallback = await supabaseService
    .from('company_memberships')
    .select('id, company_id, user_id, role, status, invited_email, joined_at, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })

  if (fallback.error) throw fallback.error
  return (fallback.data ?? []) as Array<Record<string, unknown>>
}

async function latestTimestamp(table: string, companyId: string, column = 'created_at'): Promise<string | null> {
  try {
    const { data, error } = await supabaseService
      .from(table)
      .select(column)
      .eq('company_id', companyId)
      .order(column, { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error || !data) return null
    const row = data as unknown as Record<string, unknown>
    return typeof row[column] === 'string' ? row[column] : null
  } catch {
    return null
  }
}

export async function getCompanyById(companyId: string): Promise<CompanyRow | null> {
  const { data, error } = await supabaseService
    .from('companies')
    .select('id, name, slug, org_number, status, status_reason, primary_contact_email, primary_contact_name, phone, website, billing_contact_email, support_email, address_line_1, address_line_2, postal_code, city, country_code, ediel_id, actor_role, sender_sub_address, ediel_mailbox, operating_environment, production_status, live_ediel_enabled, live_approved_at, live_blocked_reason, production_ediel_id, production_mailbox, production_application_reference, production_counterparty_ediel_id, branding, created_at, updated_at')
    .eq('id', companyId)
    .maybeSingle()

  if (error) throw error
  return (data as CompanyRow | null) ?? null
}

export async function getCompanyDeleteBlockers(companyId: string): Promise<GovernanceCount[]> {
  const counts = await Promise.all(
    HISTORY_TABLES.map(async (item) => ({
      ...item,
      count: await safeCount(item.table, [{ column: 'company_id', value: companyId }]),
    }))
  )

  return counts.filter((item) => item.count > 0)
}

export async function getCompanyGovernanceSummary(company: CompanyRow): Promise<GovernanceCompany> {
  const companyId = company.id
  const [
    activeUsers,
    pendingInvites,
    customers,
    contracts,
    edielMessages,
    meteringValues,
    billingUnderlays,
    partnerExports,
    outboundRequests,
    actorProfiles,
    blockedBillingUnderlays,
    latestAuditAt,
    latestEdielAt,
    deleteBlockers,
  ] = await Promise.all([
    safeCount('company_memberships', [
      { column: 'company_id', value: companyId },
      { column: 'status', value: 'active' },
    ]),
    safeCount('company_invitations', [
      { column: 'company_id', value: companyId },
      { column: 'status', value: 'pending' },
    ]),
    safeCount('customers', [{ column: 'company_id', value: companyId }]),
    safeCount('customer_contracts', [{ column: 'company_id', value: companyId }]),
    safeCount('ediel_messages', [{ column: 'company_id', value: companyId }]),
    safeCount('metering_values', [{ column: 'company_id', value: companyId }]),
    safeCount('billing_underlays', [{ column: 'company_id', value: companyId }]),
    safeCount('partner_exports', [{ column: 'company_id', value: companyId }]),
    safeCount('outbound_requests', [{ column: 'company_id', value: companyId }]),
    safeCount('ediel_actor_settings', [
      { column: 'company_id', value: companyId },
      { column: 'is_active', value: true },
    ]),
    safeCount('billing_underlays', [
      { column: 'company_id', value: companyId },
      { column: 'readiness_status', value: 'export_ready', op: 'neq' },
    ]),
    latestTimestamp('audit_logs', companyId),
    latestTimestamp('ediel_messages', companyId),
    getCompanyDeleteBlockers(companyId),
  ])

  return {
    id: company.id,
    name: company.name,
    slug: company.slug ?? null,
    org_number: company.org_number ?? null,
    status: normalizeCompanyStatus(company.status),
    status_reason: company.status_reason ?? null,
    primary_contact_email: company.primary_contact_email ?? null,
    primary_contact_name: company.primary_contact_name ?? null,
    phone: company.phone ?? null,
    website: company.website ?? null,
    created_at: company.created_at ?? null,
    updated_at: company.updated_at ?? null,
    activeUsers,
    pendingInvites,
    customers,
    contracts,
    edielMessages,
    meteringValues,
    billingUnderlays,
    partnerExports,
    outboundRequests,
    missingEdielProfile: actorProfiles === 0,
    blockedBillingUnderlays,
    latestAuditAt,
    latestEdielAt,
    deleteBlockers,
    canHardDelete: deleteBlockers.length === 0,
  }
}

export async function listCompanyGovernanceSummaries(): Promise<GovernanceCompany[]> {
  const { data, error } = await supabaseService
    .from('companies')
    .select('id, name, slug, org_number, status, status_reason, primary_contact_email, primary_contact_name, phone, website, billing_contact_email, support_email, address_line_1, address_line_2, postal_code, city, country_code, ediel_id, actor_role, sender_sub_address, ediel_mailbox, operating_environment, production_status, live_ediel_enabled, live_approved_at, live_blocked_reason, production_ediel_id, production_mailbox, production_application_reference, production_counterparty_ediel_id, branding, created_at, updated_at')
    .neq('status', 'deleted_test_only')
    .order('created_at', { ascending: false })

  if (error) throw error

  return Promise.all(((data as CompanyRow[] | null) ?? []).map(getCompanyGovernanceSummary))
}

export async function requireCompanyOperationalForWrites(companyId: string): Promise<CompanyRow> {
  const company = await getCompanyById(companyId)

  if (!company) {
    throw new Error('Bolaget hittades inte.')
  }

  if (!isCompanyOperationalForWrites(company.status)) {
    const copy = getCompanyStatusCopy(company.status)
    throw new Error(`${copy.label}: ny drift är blockerad för bolaget. Historik kan fortfarande läsas.`)
  }

  return company
}

export async function logTenantGovernanceEvent(input: {
  action: GovernanceEventAction
  actorUserId: string | null
  companyId?: string | null
  targetUserId?: string | null
  reason?: string | null
  metadata?: Record<string, unknown>
}) {
  const metadata = input.metadata ?? {}

  try {
    await supabaseService.from('tenant_governance_events').insert({
      company_id: input.companyId ?? null,
      target_user_id: input.targetUserId ?? null,
      actor_user_id: input.actorUserId,
      action: input.action,
      reason: input.reason ?? null,
      metadata,
    })
  } catch {
    // Do not block the operational action if the optional governance table is not deployed yet.
  }

  try {
    await supabaseService.from('audit_logs').insert({
      actor_user_id: input.actorUserId,
      company_id: input.companyId ?? null,
      entity_type: input.targetUserId ? 'user' : 'company',
      entity_id: input.targetUserId ?? input.companyId ?? null,
      action: input.action,
      new_values: {
        reason: input.reason ?? null,
        ...metadata,
      },
    })
  } catch {
    // Older installs may not have the same audit_logs shape. Governance event above remains source of truth.
  }
}

export async function listCompanyUsersForGovernance(companyId: string): Promise<CompanyUserGovernanceRow[]> {
  const rows = await listCompanyMembershipRowsForGovernance(companyId)

  const memberships = rows
    .map((row) => {
      const userId = asStringOrNull(row.user_id)
      const membershipRole = asStringOrNull(row.membership_role) ?? asStringOrNull(row.role) ?? 'member'
      const invitedAt = asStringOrNull(row.invited_at) ?? asStringOrNull(row.joined_at) ?? asStringOrNull(row.created_at)
      const status = asStringOrNull(row.status) ?? 'active'
      const acceptedAt = asStringOrNull(row.accepted_at) ?? (status === 'active' ? invitedAt : null)

      if (!userId) return null

      return {
        membershipId: String(row.id),
        companyId: String(row.company_id),
        userId,
        membershipRole,
        roleKey: asStringOrNull(row.role_key) ?? inferCompanyUserRoleKey(membershipRole),
        status,
        invitedEmail: asStringOrNull(row.invited_email),
        invitedAt,
        acceptedAt,
        disabledAt: asStringOrNull(row.disabled_at),
        removedAt: asStringOrNull(row.removed_at),
      }
    })
    .filter((row): row is Omit<CompanyUserGovernanceRow, 'email' | 'fullName' | 'userStatus'> => Boolean(row))

  const userIds = memberships.map((row) => row.userId)
  const profileById = new Map<string, { email: string | null; fullName: string | null; userStatus: UserOperationalStatus | null }>()

  if (userIds.length > 0) {
    try {
      const { data: profiles } = await supabaseService
        .from('user_profiles')
        .select('id, email, full_name, user_status')
        .in('id', userIds)

      for (const profile of ((profiles ?? []) as Array<Record<string, unknown>>)) {
        profileById.set(String(profile.id), {
          email: typeof profile.email === 'string' ? profile.email : null,
          fullName: typeof profile.full_name === 'string' ? profile.full_name : null,
          userStatus: typeof profile.user_status === 'string' ? (profile.user_status as UserOperationalStatus) : null,
        })
      }
    } catch {
      // Profiles are optional.
    }
  }

  const authEmailById = new Map<string, string | null>()
  try {
    const { data: authUsers } = await supabaseService.auth.admin.listUsers()
    for (const user of authUsers.users ?? []) {
      if (userIds.includes(user.id)) authEmailById.set(user.id, user.email ?? null)
    }
  } catch {
    // Auth lookup is best effort.
  }

  return memberships.map((row) => {
    const profile = profileById.get(row.userId)
    return {
      ...row,
      email: profile?.email ?? authEmailById.get(row.userId) ?? row.invitedEmail,
      fullName: profile?.fullName ?? null,
      userStatus: profile?.userStatus ?? null,
    }
  })
}
