import { supabaseService } from '@/lib/supabase/service'
import {
  getCompanyEmailSettings,
  upsertCompanyEmailSettings,
  type CompanyEmailVerificationStatus,
} from './companyEmailSettings'
import { replaceCompanyDnsRecords, updateDnsRecordStatuses } from './dnsRecords'
import { getEmailProvider } from './providers'
import type { CreateDomainResult, EmailProviderDomainRecord, VerifyDomainResult } from './providers/types'

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


function withGridexRequiredDnsRecords(domain: string, records: EmailProviderDomainRecord[]): EmailProviderDomainRecord[] {
  const normalized = normalizeDomain(domain)
  const byKey = new Map(records.map((record) => [`${record.type}:${record.name}:${record.value}`, record]))

  const required: EmailProviderDomainRecord[] = [
    {
      type: 'TXT',
      name: normalized,
      value: 'v=spf1 include:amazonses.com ~all',
      status: records.some((record) => record.type === 'TXT' && record.name === normalized && record.value.toLowerCase().includes('amazonses.com')) ? 'verified' : 'pending',
      purpose: 'root_spf_sending_policy',
    },
    {
      type: 'TXT',
      name: `_dmarc.${normalized}`,
      value: 'v=DMARC1; p=none; rua=mailto:dmarc@' + normalized,
      status: 'pending',
      purpose: 'dmarc_policy',
    },
  ]

  for (const record of required) {
    const key = `${record.type}:${record.name}:${record.value}`
    if (!byKey.has(key)) byKey.set(key, record)
  }

  return Array.from(byKey.values())
}

function dmarcStatusForReadyDomain(existingStatus: string | null | undefined) {
  return existingStatus === 'verified' || existingStatus === 'configured' ? existingStatus : 'configured'
}

function settingsPatchFromProviderResult(
  result: CreateDomainResult | VerifyDomainResult,
  existingDmarcStatus?: string | null
) {
  const status: CompanyEmailVerificationStatus = result.status
  const now = new Date().toISOString()
  return {
    providerDomainId: result.providerDomainId,
    verificationStatus: status,
    verifiedAt: status === 'verified' ? now : null,
    senderMode: status === 'verified' ? 'verified_domain' as const : 'fallback_platform_sender' as const,
    dkimStatus: result.dkimStatus ?? (status === 'verified' ? 'verified' : null),
    spfStatus: result.spfStatus ?? (status === 'verified' ? 'verified' : null),
    dmarcStatus: status === 'verified' ? dmarcStatusForReadyDomain(existingDmarcStatus) : existingDmarcStatus ?? null,
    readinessStatus: result.readinessStatus ?? (status === 'verified' ? 'ready' : 'pending_dns'),
    readinessNotes: result.readinessNotes ?? [],
    lastVerificationCheckedAt: now,
    blockLegalMailWhenUnverified: status !== 'verified',
  }
}

async function getOrCreateProviderDomain(domain: string) {
  const provider = getEmailProvider()
  const existing = await provider.findDomainByName(domain)
  if (existing) return existing
  return provider.createDomain(domain)
}

export async function startDomainVerification(companyId: string) {
  const settings = await getCompanyEmailSettings(companyId)
  if (!settings) throw new Error('E-postinställningar saknas. Spara avsändare först.')

  const domain = assertDomainSetup(settings.domain, settings.sender_email)
  const result = await getOrCreateProviderDomain(domain)

  const updated = await upsertCompanyEmailSettings(
    companyId,
    settingsPatchFromProviderResult(result, settings.dmarc_status)
  )

  const providerRecords = withGridexRequiredDnsRecords(domain, result.records)
  const records = await replaceCompanyDnsRecords(companyId, updated.id, providerRecords)
  return { status: result.status, records, sendReady: result.sendReady, readinessNotes: result.readinessNotes }
}

export async function checkDomainVerification(companyId: string) {
  const settings = await getCompanyEmailSettings(companyId)
  if (!settings) throw new Error('E-postinställningar saknas. Spara avsändare först.')

  const domain = assertDomainSetup(settings.domain, settings.sender_email)
  const provider = getEmailProvider()
  let result: VerifyDomainResult | CreateDomainResult
  if (settings.provider_domain_id) {
    try {
      result = await provider.verifyDomain(settings.provider_domain_id)
    } catch (error) {
      console.warn('[email] provider_domain_id verification failed, falling back to domain lookup', error)
      const found = await provider.findDomainByName(domain)
      if (!found) throw error
      result = found
    }
  } else {
    result = await getOrCreateProviderDomain(domain)
  }

  const updated = await upsertCompanyEmailSettings(
    companyId,
    settingsPatchFromProviderResult(result, settings.dmarc_status)
  )

  const providerRecords = withGridexRequiredDnsRecords(domain, result.records)
  const existingRecords = await updateDnsRecordStatuses(companyId, providerRecords)
  const records = existingRecords.length > 0
    ? existingRecords
    : await replaceCompanyDnsRecords(companyId, updated.id, providerRecords)

  await supabaseService
    .from('company_email_dns_records')
    .update({ last_checked_at: new Date().toISOString() })
    .eq('company_id', companyId)
    .then(() => null)

  return { status: result.status, records, sendReady: result.sendReady, readinessNotes: result.readinessNotes }
}
