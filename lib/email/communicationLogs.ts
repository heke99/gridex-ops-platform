import { supabaseService } from '@/lib/supabase/service'

export type CommunicationLog = {
  id: string
  company_id: string
  customer_id: string | null
  site_id: string | null
  metering_point_id: string | null
  channel: string
  event_key: string | null
  template_key: string | null
  recipient_email: string
  sender_email: string | null
  reply_to_email: string | null
  subject: string | null
  sender_mode?: string | null
  from_name?: string | null
  domain_verified_at?: string | null
  template_version?: string | null
  status: 'queued' | 'sent' | 'delivered' | 'bounced' | 'complained' | 'failed' | 'cancelled'
  provider: string | null
  provider_message_id: string | null
  sent_at: string | null
  delivered_at: string | null
  bounced_at: string | null
  failed_at: string | null
  error_message: string | null
  created_by: string | null
  customer_number?: string | null
  external_customer_id?: string | null
  contract_id?: string | null
  metadata?: Record<string, unknown> | null
  handled_at?: string | null
  handled_by?: string | null
  handled_note?: string | null
  idempotency_key?: string | null
  created_at: string
}

type CreateCommunicationLogInput = {
  companyId: string
  customerId?: string | null
  siteId?: string | null
  meteringPointId?: string | null
  eventKey?: string | null
  templateKey?: string | null
  recipientEmail: string
  senderEmail?: string | null
  replyToEmail?: string | null
  subject?: string | null
  senderMode?: string | null
  fromName?: string | null
  domainVerifiedAt?: string | null
  templateVersion?: string | null
  status?: CommunicationLog['status']
  provider?: string | null
  createdBy?: string | null
  errorMessage?: string | null
  customerNumber?: string | null
  externalCustomerId?: string | null
  contractId?: string | null
  metadata?: Record<string, unknown>
  idempotencyKey?: string | null
}

export async function createCommunicationLog(input: CreateCommunicationLogInput) {
  const { data, error } = await supabaseService
    .from('communication_logs')
    .insert({
      company_id: input.companyId,
      customer_id: input.customerId ?? null,
      site_id: input.siteId ?? null,
      metering_point_id: input.meteringPointId ?? null,
      channel: 'email',
      event_key: input.eventKey ?? null,
      template_key: input.templateKey ?? null,
      recipient_email: input.recipientEmail,
      sender_email: input.senderEmail ?? null,
      reply_to_email: input.replyToEmail ?? null,
      subject: input.subject ?? null,
      sender_mode: input.senderMode ?? null,
      from_name: input.fromName ?? null,
      domain_verified_at: input.domainVerifiedAt ?? null,
      template_version: input.templateVersion ?? null,
      status: input.status ?? 'queued',
      provider: input.provider ?? 'resend',
      created_by: input.createdBy ?? null,
      error_message: input.errorMessage ?? null,
      customer_number: input.customerNumber ?? null,
      external_customer_id: input.externalCustomerId ?? null,
      contract_id: input.contractId ?? null,
      metadata: input.metadata ?? {},
      idempotency_key: input.idempotencyKey ?? null,
      failed_at: input.status === 'failed' ? new Date().toISOString() : null,
    })
    .select('*')
    .single()

  if (error) throw error
  return data as CommunicationLog
}

export async function replaceCommunicationLog(logId: string, input: CreateCommunicationLogInput) {
  const status = input.status ?? 'queued'
  const { data, error } = await supabaseService
    .from('communication_logs')
    .update({
      customer_id: input.customerId ?? null,
      site_id: input.siteId ?? null,
      metering_point_id: input.meteringPointId ?? null,
      channel: 'email',
      event_key: input.eventKey ?? null,
      template_key: input.templateKey ?? null,
      recipient_email: input.recipientEmail,
      sender_email: input.senderEmail ?? null,
      reply_to_email: input.replyToEmail ?? null,
      subject: input.subject ?? null,
      sender_mode: input.senderMode ?? null,
      from_name: input.fromName ?? null,
      domain_verified_at: input.domainVerifiedAt ?? null,
      template_version: input.templateVersion ?? null,
      status,
      provider: input.provider ?? 'resend',
      created_by: input.createdBy ?? null,
      error_message: input.errorMessage ?? null,
      customer_number: input.customerNumber ?? null,
      external_customer_id: input.externalCustomerId ?? null,
      contract_id: input.contractId ?? null,
      metadata: input.metadata ?? {},
      provider_message_id: null,
      sent_at: null,
      delivered_at: null,
      bounced_at: null,
      failed_at: status === 'failed' ? new Date().toISOString() : null,
    })
    .eq('id', logId)
    .select('*')
    .single()

  if (error) throw error
  return data as CommunicationLog
}

export async function findCommunicationLogByIdempotencyKey(companyId: string, idempotencyKey: string): Promise<CommunicationLog | null> {
  const { data, error } = await supabaseService
    .from('communication_logs')
    .select('*')
    .eq('company_id', companyId)
    .eq('idempotency_key', idempotencyKey)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    if (['42P01', '42703', 'PGRST205'].includes(error.code ?? '')) return null
    throw error
  }

  return data as CommunicationLog | null
}

export async function markCommunicationSent(logId: string, providerMessageId: string) {
  const { data, error } = await supabaseService
    .from('communication_logs')
    .update({
      status: 'sent',
      provider_message_id: providerMessageId,
      sent_at: new Date().toISOString(),
      error_message: null,
    })
    .eq('id', logId)
    .select('*')
    .single()

  if (error) throw error
  return data as CommunicationLog
}

export async function markCommunicationFailed(logId: string, errorMessage: string) {
  const { data, error } = await supabaseService
    .from('communication_logs')
    .update({
      status: 'failed',
      error_message: errorMessage,
      failed_at: new Date().toISOString(),
    })
    .eq('id', logId)
    .select('*')
    .single()

  if (error) throw error
  return data as CommunicationLog
}

export async function markCommunicationDelivered(logId: string, occurredAt: string) {
  const { data, error } = await supabaseService
    .from('communication_logs')
    .update({
      status: 'delivered',
      delivered_at: occurredAt,
      error_message: null,
    })
    .eq('id', logId)
    .select('*')
    .single()

  if (error) throw error
  return data as CommunicationLog
}

export async function markCommunicationBounced(logId: string, errorMessage: string, occurredAt: string) {
  const { data, error } = await supabaseService
    .from('communication_logs')
    .update({
      status: 'bounced',
      error_message: errorMessage,
      bounced_at: occurredAt,
    })
    .eq('id', logId)
    .select('*')
    .single()

  if (error) throw error
  return data as CommunicationLog
}

export async function markCommunicationComplained(logId: string, errorMessage: string, occurredAt: string) {
  const { data, error } = await supabaseService
    .from('communication_logs')
    .update({
      status: 'complained',
      error_message: errorMessage,
      bounced_at: occurredAt,
    })
    .eq('id', logId)
    .select('*')
    .single()

  if (error) throw error
  return data as CommunicationLog
}

export async function getCustomerCommunicationLogs(companyId: string, customerId: string): Promise<CommunicationLog[]> {
  const { data, error } = await supabaseService
    .from('communication_logs')
    .select('*')
    .eq('company_id', companyId)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    if (['42P01', '42703', 'PGRST205'].includes(error.code ?? '')) return []
    throw error
  }

  return (data ?? []) as CommunicationLog[]
}

export async function getCompanyCommunicationLogs(
  companyId: string,
  filters: { status?: string; eventKey?: string; limit?: number } = {}
): Promise<CommunicationLog[]> {
  let query = supabaseService
    .from('communication_logs')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(filters.limit ?? 20)

  if (filters.status) query = query.eq('status', filters.status)
  if (filters.eventKey) query = query.eq('event_key', filters.eventKey)

  const { data, error } = await query
  if (error) {
    if (['42P01', '42703', 'PGRST205'].includes(error.code ?? '')) return []
    throw error
  }

  return (data ?? []) as CommunicationLog[]
}
