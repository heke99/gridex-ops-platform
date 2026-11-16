import { supabaseService } from '@/lib/supabase/service'
import type { EmailProviderDomainRecord } from './providers/types'

export type CompanyEmailDnsRecord = {
  id: string
  company_id: string
  email_setting_id: string
  record_type: 'TXT' | 'CNAME' | 'MX'
  name: string
  value: string
  priority: number | null
  status: 'pending' | 'verified' | 'failed'
  last_checked_at: string | null
  created_at: string
}

export async function getCompanyDnsRecords(companyId: string): Promise<CompanyEmailDnsRecord[]> {
  const { data, error } = await supabaseService
    .from('company_email_dns_records')
    .select('*')
    .eq('company_id', companyId)
    .order('record_type', { ascending: true })
    .order('name', { ascending: true })

  if (error) {
    if (['42P01', '42703', 'PGRST205'].includes(error.code ?? '')) return []
    throw error
  }

  return (data ?? []) as CompanyEmailDnsRecord[]
}

export async function replaceCompanyDnsRecords(
  companyId: string,
  emailSettingId: string,
  records: EmailProviderDomainRecord[]
) {
  const { error: deleteError } = await supabaseService
    .from('company_email_dns_records')
    .delete()
    .eq('company_id', companyId)
    .eq('email_setting_id', emailSettingId)

  if (deleteError) throw deleteError

  if (records.length === 0) return []

  const { data, error } = await supabaseService
    .from('company_email_dns_records')
    .insert(records.map((record) => ({
      company_id: companyId,
      email_setting_id: emailSettingId,
      record_type: record.type,
      name: record.name,
      value: record.value,
      priority: record.priority ?? null,
      status: record.status ?? 'pending',
      last_checked_at: new Date().toISOString(),
    })))
    .select('*')

  if (error) throw error
  return (data ?? []) as CompanyEmailDnsRecord[]
}

export async function updateDnsRecordStatuses(
  companyId: string,
  records: EmailProviderDomainRecord[]
) {
  const existing = await getCompanyDnsRecords(companyId)
  const byKey = new Map(existing.map((record) => [`${record.record_type}:${record.name}`, record]))
  const now = new Date().toISOString()

  await Promise.all(records.map(async (record) => {
    const current = byKey.get(`${record.type}:${record.name}`)
    if (!current) return

    const { error } = await supabaseService
      .from('company_email_dns_records')
      .update({
        value: record.value,
        priority: record.priority ?? null,
        status: record.status ?? 'pending',
        last_checked_at: now,
      })
      .eq('id', current.id)
      .eq('company_id', companyId)

    if (error) throw error
  }))

  return getCompanyDnsRecords(companyId)
}
