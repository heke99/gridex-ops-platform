import 'server-only'
import { ApiInputError } from '@/lib/api/strictRequest'
import { tenantDb } from '@/lib/supabase/tenantDb'

export type SavedPortalAccountRole = 'owner' | 'billing' | 'viewer'
type SavedPortalAccount = {
  id: string
  role: SavedPortalAccountRole
}
type AccountRow = {
  id: string; company_id: string; customer_id: string; user_id: string | null; portal_user_id: string | null
  status: string; is_active: boolean; role: string
}
type AccountRead = PromiseLike<{ data: AccountRow[] | null; error: { code?: string } | null }> & {
  eq: (field: string, value: string) => AccountRead
  or: (filter: string) => AccountRead
  limit: (count: number) => AccountRead
}
type AccountInsert = {
  select: (columns: string) => { maybeSingle: () => PromiseLike<{ data: { id: string } | null; error: { code?: string } | null }> }
}

/** Read the exact current relationship; matching customer facts do not assign
 * a role or replace existing activation/verification evidence. */
export async function readSavedPortalAccount(input: {
  companyId: string
  customerId: string
  userId: string
  nativeUserOnly?: boolean
}): Promise<SavedPortalAccount | null> {
  const query = (tenantDb(input.companyId).from('customer_portal_accounts')
    .select('id,company_id,customer_id,user_id,portal_user_id,status,is_active,role') as AccountRead)
    .eq('customer_id', input.customerId)
    .or(`portal_user_id.eq.${input.userId},user_id.eq.${input.userId}`)
  const { data, error } = await query.limit(2)
  if (error) throw error
  if (!data?.length) return null
  if (data.length !== 1 || !data[0].id || !['owner', 'billing', 'viewer'].includes(data[0].role)) {
    throw new ApiInputError('Portalkopplingen kräver manuell kontroll.', 'portal_account_ambiguous', 409)
  }
  const row = data[0]
  if (row.company_id !== input.companyId || row.customer_id !== input.customerId ||
      (row.user_id !== input.userId && row.portal_user_id !== input.userId) ||
      row.status !== 'active' || row.is_active !== true) {
    throw new ApiInputError('Portalåtkomsten har spärrats.', 'portal_identity_revoked', 409)
  }
  // A portal issuer's saved subject alias is not a new native Auth binding.
  // Hold it instead of creating a second owner beside the existing account.
  if (input.nativeUserOnly && row.user_id !== input.userId) {
    throw new ApiInputError('Portalkopplingen kräver manuell kontroll.', 'portal_account_ambiguous', 409)
  }
  return { id: String(row.id), role: row.role as SavedPortalAccountRole }
}

/** A repeated native self-claim preserves the entire existing account row.
 * Only an actual new INSERT carries default-owner verification evidence. */
export async function insertNativePortalAccountPreservingExisting(input: {
  companyId: string
  customerId: string
  userId: string
  newAccount: Record<string, unknown>
}): Promise<{ created: boolean; account: SavedPortalAccount }> {
  const binding = { companyId: input.companyId, customerId: input.customerId, userId: input.userId, nativeUserOnly: true }
  const existing = await readSavedPortalAccount(binding)
  if (existing) return { created: false, account: existing }
  const inserted = await (tenantDb(input.companyId).from('customer_portal_accounts').insert({
    ...input.newAccount,
    company_id: input.companyId,
    customer_id: input.customerId,
    user_id: input.userId,
    role: 'owner',
    status: 'active',
    is_active: true,
  }) as AccountInsert).select('id').maybeSingle()
  if (inserted.error && inserted.error.code !== '23505') throw inserted.error
  const account = await readSavedPortalAccount(binding)
  if (!account || (!inserted.error && (!inserted.data?.id || String(inserted.data.id) !== account.id))) {
    throw new ApiInputError('Portalkopplingen kräver manuell kontroll.', 'portal_account_ambiguous', 409)
  }
  return { created: !inserted.error, account }
}
