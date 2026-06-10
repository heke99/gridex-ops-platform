import { supabaseService } from '@/lib/supabase/service'

export type CompanyEmailVerificationStatus = 'not_started' | 'pending_dns' | 'verified' | 'failed' | 'disabled'

export type CompanyEmailSettings = {
  id: string
  company_id: string
  sender_name: string | null
  sender_email: string | null
  reply_to_email: string | null
  support_email: string | null
  domain: string | null
  provider: string
  provider_domain_id: string | null
  verification_status: CompanyEmailVerificationStatus
  verified_at: string | null
  is_active: boolean
  sender_mode?: 'verified_domain' | 'fallback_platform_sender' | 'disabled' | null
  fallback_allowed?: boolean | null
  block_legal_mail_when_unverified?: boolean | null
  dkim_status?: string | null
  spf_status?: string | null
  dmarc_status?: string | null
  last_verification_checked_at?: string | null
  readiness_status?: string | null
  readiness_notes?: unknown
  created_at: string
  updated_at: string
}

export type EffectiveSender = {
  from: string
  replyTo: string | undefined
  mode: 'verified_domain' | 'fallback'
  senderEmail: string
  fromName?: string
  domainVerifiedAt?: string | null
}

type CompanyEmailSettingsInput = {
  senderName?: string | null
  senderEmail?: string | null
  replyToEmail?: string | null
  supportEmail?: string | null
  domain?: string | null
  providerDomainId?: string | null
  verificationStatus?: CompanyEmailVerificationStatus
  verifiedAt?: string | null
  isActive?: boolean
  senderMode?: 'verified_domain' | 'fallback_platform_sender' | 'disabled' | null
  fallbackAllowed?: boolean | null
  blockLegalMailWhenUnverified?: boolean | null
  dkimStatus?: string | null
  spfStatus?: string | null
  dmarcStatus?: string | null
  lastVerificationCheckedAt?: string | null
  readinessStatus?: string | null
  readinessNotes?: unknown
}

type CompanyRow = {
  id: string
  name: string
  support_email?: string | null
  primary_contact_email?: string | null
  billing_contact_email?: string | null
}

export const DEFAULT_FROM_EMAIL = process.env.DEFAULT_FROM_EMAIL ?? 'noreply@gridex.se'
export const DEFAULT_FROM_NAME = process.env.DEFAULT_FROM_NAME ?? 'Gridex'
export const DEFAULT_REPLY_TO = process.env.DEFAULT_REPLY_TO ?? 'support@gridex.se'

function clean(value: string | null | undefined) {
  const trimmed = String(value ?? '').trim()
  return trimmed.length > 0 ? trimmed : null
}

function cleanEmail(value: string | null | undefined) {
  return clean(value)?.toLowerCase() ?? null
}

function formatAddress(name: string, email: string) {
  return `${name.replace(/[<>"]/g, '').trim()} <${email}>`
}

async function getCompany(companyId: string): Promise<CompanyRow> {
  const { data, error } = await supabaseService
    .from('companies')
    .select('id, name, support_email, primary_contact_email, billing_contact_email')
    .eq('id', companyId)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('Bolaget hittades inte.')
  return data as CompanyRow
}

export async function getCompanyEmailSettings(companyId: string): Promise<CompanyEmailSettings | null> {
  const { data, error } = await supabaseService
    .from('company_email_settings')
    .select('*')
    .eq('company_id', companyId)
    .maybeSingle()

  if (error) {
    if (['42P01', '42703', 'PGRST205'].includes(error.code ?? '')) return null
    throw error
  }

  return data as CompanyEmailSettings | null
}

export async function upsertCompanyEmailSettings(companyId: string, input: CompanyEmailSettingsInput) {
  const payload: Record<string, unknown> = {
    company_id: companyId,
    provider: 'resend',
    updated_at: new Date().toISOString(),
  }

  if ('senderName' in input) payload.sender_name = clean(input.senderName)
  if ('senderEmail' in input) payload.sender_email = cleanEmail(input.senderEmail)
  if ('replyToEmail' in input) payload.reply_to_email = cleanEmail(input.replyToEmail)
  if ('supportEmail' in input) payload.support_email = cleanEmail(input.supportEmail)
  if ('domain' in input) payload.domain = clean(input.domain)?.toLowerCase() ?? null
  if ('providerDomainId' in input) payload.provider_domain_id = clean(input.providerDomainId)
  if ('verificationStatus' in input && input.verificationStatus) payload.verification_status = input.verificationStatus
  if ('verifiedAt' in input) payload.verified_at = input.verifiedAt ?? null
  if ('isActive' in input && typeof input.isActive === 'boolean') payload.is_active = input.isActive
  if ('senderMode' in input) payload.sender_mode = input.senderMode ?? 'fallback_platform_sender'
  if ('fallbackAllowed' in input && typeof input.fallbackAllowed === 'boolean') payload.fallback_allowed = input.fallbackAllowed
  if ('blockLegalMailWhenUnverified' in input && typeof input.blockLegalMailWhenUnverified === 'boolean') payload.block_legal_mail_when_unverified = input.blockLegalMailWhenUnverified
  if ('dkimStatus' in input) payload.dkim_status = input.dkimStatus ?? null
  if ('spfStatus' in input) payload.spf_status = input.spfStatus ?? null
  if ('dmarcStatus' in input) payload.dmarc_status = input.dmarcStatus ?? null
  if ('lastVerificationCheckedAt' in input) payload.last_verification_checked_at = input.lastVerificationCheckedAt ?? null
  if ('readinessStatus' in input) payload.readiness_status = input.readinessStatus ?? null
  if ('readinessNotes' in input) payload.readiness_notes = input.readinessNotes ?? []

  const { data, error } = await supabaseService
    .from('company_email_settings')
    .upsert(payload, { onConflict: 'company_id' })
    .select('*')
    .single()

  if (error) throw error
  return data as CompanyEmailSettings
}

export async function disableCompanyEmailSettings(companyId: string) {
  return upsertCompanyEmailSettings(companyId, {
    isActive: false,
    verificationStatus: 'disabled',
  })
}

export async function seedDefaultCompanyEmailSettings(companyId: string) {
  const [company, existing] = await Promise.all([
    getCompany(companyId),
    getCompanyEmailSettings(companyId),
  ])

  if (existing) return existing

  return upsertCompanyEmailSettings(companyId, {
    senderName: company.name,
    supportEmail: company.support_email ?? company.primary_contact_email ?? company.billing_contact_email ?? DEFAULT_REPLY_TO,
    replyToEmail: company.support_email ?? company.primary_contact_email ?? DEFAULT_REPLY_TO,
    isActive: true,
  })
}

export async function getEffectiveSender(companyId: string, options: { legalOrCritical?: boolean } = {}): Promise<EffectiveSender> {
  const [company, settings] = await Promise.all([
    getCompany(companyId),
    getCompanyEmailSettings(companyId),
  ])

  if (settings && (!settings.is_active || settings.sender_mode === 'disabled')) {
    throw new Error('E-postavsändaren är avstängd för bolaget. Aktivera avsändaren på bolagskortet innan utskick.')
  }

  if (settings?.sender_mode === 'fallback_platform_sender' && settings.fallback_allowed === false) {
    throw new Error('Fallback-avsändare är avstängd för bolaget. Verifiera domänen innan utskick.')
  }

  if (options.legalOrCritical && settings?.block_legal_mail_when_unverified && settings.verification_status !== 'verified') {
    throw new Error('Bolagets domän måste vara verifierad innan juridiska eller kritiska kundmail skickas.')
  }

  if (
    settings?.verification_status === 'verified' &&
    settings.is_active &&
    settings.sender_mode !== 'disabled' &&
    settings.sender_email &&
    settings.sender_name
  ) {
    return {
      from: formatAddress(settings.sender_name, settings.sender_email),
      replyTo: settings.reply_to_email ?? settings.support_email ?? undefined,
      mode: 'verified_domain',
      senderEmail: settings.sender_email,
      fromName: settings.sender_name,
      domainVerifiedAt: settings.verified_at,
    }
  }

  const fallbackName = `${company.name} via ${DEFAULT_FROM_NAME}`
  const replyTo =
    settings?.support_email ??
    settings?.reply_to_email ??
    company.support_email ??
    company.primary_contact_email ??
    DEFAULT_REPLY_TO

  return {
    from: formatAddress(fallbackName, DEFAULT_FROM_EMAIL),
    replyTo: replyTo ?? undefined,
    mode: 'fallback',
    senderEmail: DEFAULT_FROM_EMAIL,
    fromName: fallbackName,
    domainVerifiedAt: null,
  }
}
