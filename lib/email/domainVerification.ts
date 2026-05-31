import { supabaseService } from '@/lib/supabase/service'
import {
  getCompanyEmailSettings,
  upsertCompanyEmailSettings,
  type CompanyEmailVerificationStatus,
} from './companyEmailSettings'
import { replaceCompanyDnsRecords, updateDnsRecordStatuses } from './dnsRecords'
import { getEmailProvider } from './providers'

function normalizeDomain(value: string | null | undefined) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
}

function emailDomain(value: string | null | undefined) {
  const parts = String(value ?? '').trim().toLowerCase().split('@')
  return parts.length === 2 ? parts[1] : ''
}

function assertDomainSetup(domain: string | null | undefined, senderEmail: string | null | undefined) {
  const normalizedDomain = normalizeDomain(domain)
  if (!normalizedDomain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(normalizedDomain)) {
    throw new Error('Ange en giltig domän innan verifiering startas.')
  }

  if (!senderEmail || emailDomain(senderEmail) !== normalizedDomain) {
    throw new Error('Avsändarmail måste ligga på samma domän som ska verifieras.')
  }

  return normalizedDomain
}

export async function startDomainVerification(companyId: string) {
  const settings = await getCompanyEmailSettings(companyId)
  if (!settings) throw new Error('E-postinställningar saknas. Spara avsändare först.')

  const domain = assertDomainSetup(settings.domain, settings.sender_email)
  const provider = getEmailProvider()
  const result = await provider.createDomain(domain)

  const updated = await upsertCompanyEmailSettings(companyId, {
    providerDomainId: result.providerDomainId,
    verificationStatus: result.status,
    verifiedAt: result.status === 'verified' ? new Date().toISOString() : null,
  })

  const records = await replaceCompanyDnsRecords(companyId, updated.id, result.records)
  return { status: result.status, records }
}

export async function checkDomainVerification(companyId: string) {
  const settings = await getCompanyEmailSettings(companyId)
  if (!settings?.provider_domain_id) {
    throw new Error('Domänverifiering är inte startad ännu.')
  }

  const provider = getEmailProvider()
  const result = await provider.verifyDomain(settings.provider_domain_id)
  const status: CompanyEmailVerificationStatus = result.status

  await upsertCompanyEmailSettings(companyId, {
    verificationStatus: status,
    verifiedAt: status === 'verified' ? new Date().toISOString() : settings.verified_at,
  })

  const records = await updateDnsRecordStatuses(companyId, result.records)

  await supabaseService
    .from('company_email_dns_records')
    .update({ last_checked_at: new Date().toISOString() })
    .eq('company_id', companyId)
    .then(() => null)

  return { status, records }
}
