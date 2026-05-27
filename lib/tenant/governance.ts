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

const COMPANY_FULL_SELECT = 'id, name, slug, org_number, status, status_reason, primary_contact_email, primary_contact_name, phone, website, billing_contact_email, support_email, address_line_1, address_line_2, postal_code, city, country_code, ediel_id, actor_role, sender_sub_address, ediel_mailbox, operating_environment, production_status, live_ediel_enabled, live_approved_at, live_blocked_reason, production_ediel_id, production_mailbox, production_application_reference, production_counterparty_ediel_id, branding, created_at, updated_at'
const COMPANY_SAFE_SELECT = 'id, name, slug, org_number, status, status_reason, primary_contact_email, primary_contact_name, phone, website, created_at, updated_at'
const COMPANY_MINIMAL_SELECT = 'id, name, status'

async function selectCompanyById(companyId: string, select: string) {
  return supabaseService
    .from('companies')
    .select(select)
    .eq('id', companyId)
    .maybeSingle()
}

export async function getCompanyById(companyId: string): Promise<CompanyRow | null> {
  const attempts = [COMPANY_FULL_SELECT, COMPANY_SAFE_SELECT, COMPANY_MINIMAL_SELECT]
  let lastError: unknown = null

  for (const select of attempts) {
    const { data, error } = await selectCompanyById(companyId, select)
    if (!error) return (data as CompanyRow | null) ?? null
    lastError = error
  }

  throw lastError
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

type RawCompanyMembership = {
  membershipId: string
  companyId: string
  userId: string
  membershipRole: string
  roleKey: string | null
  status: string
  invitedEmail: string | null
  invitedAt: string | null
  acceptedAt: string | null
  disabledAt: string | null
  removedAt: string | null
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function chunkStrings(values: string[], size: number): string[][] {
  const chunks: string[][] = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

async function loadAuthEmailsById(userIds: string[]): Promise<Map<string, string | null>> {
  const authEmailById = new Map<string, string | null>()
  const uniqueIds = Array.from(new Set(userIds.filter((value) => value.length > 0 && !value.includes('@'))))

  for (const idChunk of chunkStrings(uniqueIds, 10)) {
    await Promise.all(
      idChunk.map(async (userId) => {
        try {
          const { data, error } = await supabaseService.auth.admin.getUserById(userId)
          if (!error && data.user?.id) {
            authEmailById.set(userId, data.user.email ?? null)
          }
        } catch {
          // Auth lookup is best effort and must never crash the company users page.
        }
      })
    )
  }

  return authEmailById
}

function normalizeMembershipRole(row: Record<string, unknown>): string {
  const direct = stringOrNull(row.membership_role)
  if (direct) return direct

  const legacyRole = stringOrNull(row.role)
  if (!legacyRole) return 'member'
  if (legacyRole === 'company_admin') return 'admin'
  if (legacyRole === 'operations_manager' || legacyRole === 'operations_agent') return 'operations'
  if (legacyRole === 'customer_service_agent' || legacyRole === 'support') return 'support'
  if (legacyRole === 'finance_readonly' || legacyRole === 'executive_readonly') return 'viewer'
  return legacyRole
}

function normalizeRoleKeyFromMembership(row: Record<string, unknown>): string | null {
  const direct = stringOrNull(row.role_key)
  if (direct) return direct

  const legacyRole = stringOrNull(row.role)
  if (!legacyRole) return null
  if (legacyRole === 'owner' || legacyRole === 'admin' || legacyRole === 'company_admin') return 'company_admin'
  if (legacyRole === 'operations') return 'operations_manager'
  if (legacyRole === 'support' || legacyRole === 'customer_service') return 'customer_service_agent'
  if (legacyRole === 'finance') return 'finance_readonly'
  return legacyRole
}

function normalizeCompanyMembershipRow(row: Record<string, unknown>): RawCompanyMembership {
  const membershipId = String(row.id ?? `${row.company_id ?? 'company'}-${row.user_id ?? row.invited_email ?? 'unknown'}`)
  const userId = String(row.user_id ?? row.invited_user_id ?? row.email ?? row.invited_email ?? membershipId)

  return {
    membershipId,
    companyId: String(row.company_id ?? ''),
    userId,
    membershipRole: normalizeMembershipRole(row),
    roleKey: normalizeRoleKeyFromMembership(row),
    status: String(row.status ?? 'active'),
    invitedEmail: stringOrNull(row.invited_email) ?? stringOrNull(row.email),
    invitedAt: stringOrNull(row.invited_at) ?? stringOrNull(row.created_at),
    acceptedAt: stringOrNull(row.accepted_at) ?? stringOrNull(row.joined_at) ?? stringOrNull(row.created_at),
    disabledAt: stringOrNull(row.disabled_at),
    removedAt: stringOrNull(row.removed_at),
  }
}

async function loadCompanyMembershipRows(companyId: string): Promise<RawCompanyMembership[]> {
  const attempts = [
    {
      select: 'id, company_id, user_id, membership_role, role_key, status, invited_email, invited_at, accepted_at, disabled_at, removed_at',
      orderColumn: 'invited_at',
    },
    {
      select: 'id, company_id, user_id, membership_role, status, invited_at, accepted_at',
      orderColumn: 'invited_at',
    },
    {
      select: 'id, company_id, user_id, role, status, created_at, updated_at',
      orderColumn: 'created_at',
    },
    {
      select: 'id, company_id, user_id, role',
      orderColumn: null,
    },
  ]

  let lastError: unknown = null

  for (const attempt of attempts) {
    let query = supabaseService
      .from('company_memberships')
      .select(attempt.select)
      .eq('company_id', companyId)

    if (attempt.orderColumn) {
      query = query.order(attempt.orderColumn, { ascending: false })
    }

    const { data, error } = await query
    if (!error) {
      return ((data ?? []) as unknown as Array<Record<string, unknown>>).map(normalizeCompanyMembershipRow)
    }

    lastError = error
  }

  // Some older installs had invitations but no stable membership query shape. Do not let the
  // superadmin users page crash; show pending invitations as rows instead.
  try {
    const { data, error } = await supabaseService
      .from('company_invitations')
      .select('id, company_id, invited_user_id, invited_email, email, role_key, membership_role, status, created_at, accepted_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })

    if (!error) return ((data ?? []) as unknown as Array<Record<string, unknown>>).map(normalizeCompanyMembershipRow)
  } catch {
    // Keep throwing the original membership error below.
  }

  throw lastError
}

export async function listCompanyUsersForGovernance(companyId: string): Promise<CompanyUserGovernanceRow[]> {
  const memberships = await loadCompanyMembershipRows(companyId)
  const userIds = memberships
    .map((row) => row.userId)
    .filter((value) => value.length > 0 && !value.includes('@'))

  const profileById = new Map<string, { email: string | null; fullName: string | null; userStatus: UserOperationalStatus | null }>()

  if (userIds.length > 0) {
    const profileAttempts = [
      'id, email, full_name, user_status',
      'id, email, full_name',
      'id, email',
    ]

    for (const select of profileAttempts) {
      try {
        const { data, error } = await supabaseService
          .from('user_profiles')
          .select(select)
          .in('id', userIds)

        if (error) continue

        for (const profile of ((data ?? []) as unknown as Array<Record<string, unknown>>)) {
          profileById.set(String(profile.id), {
            email: stringOrNull(profile.email),
            fullName: stringOrNull(profile.full_name),
            userStatus: typeof profile.user_status === 'string' ? (profile.user_status as UserOperationalStatus) : null,
          })
        }
        break
      } catch {
        // Try next profile shape.
      }
    }
  }

  const missingAuthEmailIds = userIds.filter((userId) => !profileById.get(userId)?.email)
  const authEmailById = missingAuthEmailIds.length > 0
    ? await loadAuthEmailsById(missingAuthEmailIds)
    : new Map<string, string | null>()

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
