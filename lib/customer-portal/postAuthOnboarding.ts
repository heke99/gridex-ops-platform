import { getBaseAppUrl } from '@/lib/auth/urls'
import { supabaseService } from '@/lib/supabase/service'
import {
  getTenantEmailBranding,
  queueAndTrySendTenantEmail,
  renderTenantEmailLayout,
} from '@/lib/tenant/emailBranding'

function normalizeEmail(value: string | null | undefined) {
  const email = String(value ?? '').trim().toLowerCase()
  return email && email.includes('@') ? email : null
}

function clean(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function setupRedirectUrl() {
  return `${getBaseAppUrl()}/auth/callback?next=${encodeURIComponent('/login/update-password')}`
}

async function findAuthUserByEmail(email: string) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabaseService.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    const match = (data.users ?? []).find((user) => normalizeEmail(user.email) === email)
    if (match) return match
    if ((data.users ?? []).length < 1000) return null
  }
  return null
}

async function generatePortalSetupLink(email: string, existingUser: boolean) {
  const admin = supabaseService.auth.admin as unknown as {
    generateLink?: (params: Record<string, unknown>) => Promise<{
      data?: Record<string, unknown> | null
      error?: Error | null
    }>
  }
  if (typeof admin.generateLink !== 'function') {
    throw new Error('customer_portal_generate_link_unavailable')
  }

  const { data, error } = await admin.generateLink({
    type: existingUser ? 'recovery' : 'invite',
    email,
    options: { redirectTo: setupRedirectUrl() },
  })
  if (error) throw error

  const properties = data?.properties && typeof data.properties === 'object'
    ? data.properties as Record<string, unknown>
    : {}
  const actionLink = clean(properties.action_link) ?? clean(properties.actionLink) ?? clean(data?.action_link)
  const userRecord = data?.user && typeof data.user === 'object'
    ? data.user as Record<string, unknown>
    : null
  const generatedUserId = clean(userRecord?.id)
  if (!actionLink) throw new Error('customer_portal_setup_link_missing')
  return { actionLink, generatedUserId }
}

export type PostAuthPortalOnboardingResult = {
  status: 'sent' | 'already_linked'
  userId: string
  accountId: string | null
  identityId: string | null
  outboxId?: string
}

/**
 * Post-auth checkout deliberately allows a customer to sign the electricity
 * agreement before a Supabase Auth user exists. This function closes that loop:
 * it creates (or reuses) the Auth identity, binds it to the canonical customer,
 * and sends a tenant-branded one-time link that verifies the email and opens the
 * password setup screen.
 *
 * The operation is idempotent for the same company/customer/email. An already
 * invited/activated account is never sent a duplicate onboarding message by an
 * application retry.
 */
export async function ensurePostAuthCustomerPortalOnboarding(input: {
  companyId: string
  applicationId: string
  customerId: string
  customerNumber: string
  externalCustomerId: string
  customerEmail: string
  customerName?: string | null
}): Promise<PostAuthPortalOnboardingResult> {
  const email = normalizeEmail(input.customerEmail)
  if (!email) throw new Error('customer_portal_email_missing')

  const existingAccount = await supabaseService
    .from('customer_portal_accounts')
    .select('id,user_id,portal_user_id,user_email,email,invited_at,activated_at,status,is_active')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (existingAccount.error) throw existingAccount.error

  const existingLinkedUserId = clean(existingAccount.data?.user_id) ?? clean(existingAccount.data?.portal_user_id)
  const existingAccountEmail = normalizeEmail(existingAccount.data?.user_email ?? existingAccount.data?.email)
  if (
    existingLinkedUserId &&
    existingAccountEmail === email &&
    (existingAccount.data?.invited_at || existingAccount.data?.activated_at)
  ) {
    const identity = await supabaseService
      .from('customer_portal_identities')
      .select('id')
      .eq('company_id', input.companyId)
      .eq('customer_id', input.customerId)
      .eq('provider', 'gridex_website')
      .maybeSingle()
    if (identity.error) throw identity.error
    return {
      status: 'already_linked',
      userId: existingLinkedUserId,
      accountId: clean(existingAccount.data?.id),
      identityId: clean(identity.data?.id),
    }
  }

  const authUser = await findAuthUserByEmail(email)
  const generated = await generatePortalSetupLink(email, Boolean(authUser))
  const resolvedAuthUser = authUser ?? await findAuthUserByEmail(email)
  const userId = clean(resolvedAuthUser?.id) ?? generated.generatedUserId
  if (!userId) throw new Error('customer_portal_auth_user_missing_after_invite')

  const now = new Date().toISOString()
  const accountPayload = {
    company_id: input.companyId,
    customer_id: input.customerId,
    user_id: userId,
    portal_user_id: userId,
    external_account_id: userId,
    customer_number: input.customerNumber,
    external_customer_id: input.externalCustomerId,
    email,
    user_email: email,
    role: 'owner',
    status: 'active',
    is_active: true,
    invited_at: now,
    match_method: 'website_application_post_auth_invite',
    verified_identity_snapshot: {
      source: 'website_application_post_auth_invite',
      application_id: input.applicationId,
      email,
      customer_number: input.customerNumber,
      external_customer_id: input.externalCustomerId,
      auth_user_id: userId,
    },
    metadata: {
      source: 'website_customer_applications',
      application_id: input.applicationId,
      post_auth_onboarding: true,
    },
    updated_at: now,
  }

  let accountId = clean(existingAccount.data?.id)
  if (accountId) {
    const { error } = await supabaseService
      .from('customer_portal_accounts')
      .update(accountPayload)
      .eq('id', accountId)
      .eq('company_id', input.companyId)
      .eq('customer_id', input.customerId)
    if (error) throw error
  } else {
    const { data, error } = await supabaseService
      .from('customer_portal_accounts')
      .insert({ ...accountPayload, created_at: now })
      .select('id')
      .single()
    if (error) throw error
    accountId = clean(data?.id)
  }

  const identity = await supabaseService
    .from('customer_portal_identities')
    .select('id')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('provider', 'gridex_website')
    .maybeSingle()
  if (identity.error) throw identity.error
  let identityId = clean(identity.data?.id)
  const identityPayload = {
    auth_user_id: userId,
    customer_portal_user_id: userId,
    external_account_id: userId,
    email,
    status: 'active',
    match_strength: 'strong',
    match_method: 'website_application_post_auth_invite',
    linked_at: now,
    last_resolved_at: now,
    metadata: {
      source: 'website_customer_applications',
      application_id: input.applicationId,
      account_id: accountId,
      post_auth_onboarding: true,
    },
    updated_at: now,
  }
  if (identityId) {
    const { error } = await supabaseService
      .from('customer_portal_identities')
      .update(identityPayload)
      .eq('id', identityId)
      .eq('company_id', input.companyId)
      .eq('customer_id', input.customerId)
    if (error) throw error
  } else {
    const { data, error } = await supabaseService
      .from('customer_portal_identities')
      .insert({
        company_id: input.companyId,
        customer_id: input.customerId,
        provider: 'gridex_website',
        external_customer_id: input.externalCustomerId,
        customer_number: input.customerNumber,
        ...identityPayload,
        created_at: now,
      })
      .select('id')
      .single()
    if (error) throw error
    identityId = clean(data?.id)
  }

  const branding = await getTenantEmailBranding(input.companyId)
  const customerName = clean(input.customerName) ?? 'kund'
  const html = renderTenantEmailLayout({
    branding,
    title: 'Aktivera Mina sidor',
    intro: `Hej ${customerName}, ditt kundkonto hos ${branding.displayName} är klart.`,
    body: '<p>Bekräfta din e-postadress och välj ett lösenord för att aktivera Mina sidor. Där kan du följa ditt avtal och din leverans.</p><p>Länken är personlig. Om du inte känner igen registreringen ska du kontakta kundservice.</p>',
    ctaLabel: 'Bekräfta e-post och skapa lösenord',
    ctaUrl: generated.actionLink,
  })

  const delivery = await queueAndTrySendTenantEmail({
    companyId: input.companyId,
    customerId: input.customerId,
    emailType: 'customer_portal_activation',
    toEmail: email,
    subject: `${branding.displayName}: Aktivera Mina sidor`,
    htmlBody: html,
    textBody: `Hej ${customerName}. Bekräfta din e-post och skapa ett lösenord för Mina sidor via den personliga länken i detta meddelande.`,
    redirectUrl: generated.actionLink,
  })

  return {
    status: 'sent',
    userId,
    accountId,
    identityId,
    outboxId: clean((delivery as Record<string, unknown>).outboxId) ?? undefined,
  }
}
