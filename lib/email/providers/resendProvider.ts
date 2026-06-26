import { Resend } from 'resend'
import type {
  CreateDomainResult,
  EmailProvider,
  EmailProviderDomainReadiness,
  EmailProviderDomainRecord,
  SendEmailInput,
  SendEmailResult,
  VerifyDomainResult,
} from './types'

type ResendDomainRecord = {
  record?: string | null
  type?: string | null
  name?: string | null
  value?: string | null
  priority?: number | null
  status?: string | null
}

type ResendDomainData = {
  id?: string | null
  name?: string | null
  status?: string | null
  records?: ResendDomainRecord[] | null
}

export class EmailProviderSafeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EmailProviderSafeError'
  }
}

function createResendClient() {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    throw new EmailProviderSafeError('Resend API-nyckel saknas. Lägg till RESEND_API_KEY i Vercel Production och deploya om.')
  }

  return new Resend(apiKey)
}

function normalizeDomain(value: string | null | undefined) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '')
}

function mapRecordStatus(status: string | null | undefined): 'pending' | 'verified' | 'failed' {
  if (status === 'verified') return 'verified'
  if (status === 'failed' || status === 'temporary_failure' || status === 'partially_failed') return 'failed'
  return 'pending'
}

function mapRecords(records: ResendDomainRecord[] | null | undefined): EmailProviderDomainRecord[] {
  return (records ?? [])
    .filter((record) => record.type === 'TXT' || record.type === 'CNAME' || record.type === 'MX')
    .map((record) => ({
      type: record.type as EmailProviderDomainRecord['type'],
      name: String(record.name ?? ''),
      value: String(record.value ?? ''),
      priority: typeof record.priority === 'number' ? record.priority : null,
      status: mapRecordStatus(record.status),
      purpose: record.record ? String(record.record) : null,
    }))
    .filter((record) => record.name.length > 0 && record.value.length > 0)
}

function aggregateStatus(records: EmailProviderDomainRecord[]): 'verified' | 'failed' | 'pending' | null {
  if (records.length === 0) return null
  if (records.some((record) => record.status === 'failed')) return 'failed'
  if (records.every((record) => record.status === 'verified')) return 'verified'
  return 'pending'
}

function isDkimRecord(record: EmailProviderDomainRecord) {
  const purpose = String(record.purpose ?? '').toLowerCase()
  const name = record.name.toLowerCase()
  const value = record.value.toLowerCase()
  return purpose.includes('dkim') || name.includes('._domainkey') || value.includes('.dkim.amazonses.com')
}

function isSpfRecord(record: EmailProviderDomainRecord) {
  const purpose = String(record.purpose ?? '').toLowerCase()
  const value = record.value.toLowerCase()
  return purpose.includes('spf') || (record.type === 'TXT' && value.includes('v=spf1') && value.includes('amazonses.com'))
}

function isMailFromMxRecord(record: EmailProviderDomainRecord) {
  const purpose = String(record.purpose ?? '').toLowerCase()
  const value = record.value.toLowerCase()
  return record.type === 'MX' && (purpose.includes('mx') || purpose.includes('mail') || value.includes('amazonses.com'))
}

function deriveReadiness(rawStatus: string | null | undefined, records: EmailProviderDomainRecord[]): EmailProviderDomainReadiness {
  const dkimStatus = aggregateStatus(records.filter(isDkimRecord))
  const spfStatus = aggregateStatus(records.filter(isSpfRecord))
  const mxStatus = aggregateStatus(records.filter(isMailFromMxRecord))
  const normalizedRawStatus = String(rawStatus ?? '').toLowerCase()

  const requiredStatuses = [dkimStatus, spfStatus, mxStatus].filter(Boolean) as Array<'verified' | 'failed' | 'pending'>
  const allKnownRequiredRecordsReady = requiredStatuses.length > 0 && requiredStatuses.every((status) => status === 'verified')
  const anyKnownRequiredRecordFailed = requiredStatuses.some((status) => status === 'failed')

  // Resend can report partially_verified when sending is verified but receiving is not enabled.
  // For Gridex tenant email, sending readiness is enough; receiving stays with the tenant mailbox provider.
  const resendSaysUsableForAtLeastOneCapability = normalizedRawStatus === 'verified' || normalizedRawStatus === 'partially_verified'
  const sendReady = !anyKnownRequiredRecordFailed && (resendSaysUsableForAtLeastOneCapability || allKnownRequiredRecordsReady)

  const readinessNotes: string[] = []
  if (!sendReady) {
    if (dkimStatus !== 'verified') readinessNotes.push('DKIM är inte verifierad hos Resend ännu.')
    if (spfStatus !== 'verified') readinessNotes.push('SPF/MAIL FROM är inte verifierad hos Resend ännu.')
    if (mxStatus === 'failed') readinessNotes.push('MAIL FROM/MX är felaktig hos DNS-leverantören.')
    if (normalizedRawStatus === 'pending' || normalizedRawStatus === 'not_started') readinessNotes.push('Resend har inte markerat domänen som sändklar ännu.')
  }

  return {
    sendReady,
    dkimStatus: dkimStatus ?? null,
    spfStatus: spfStatus ?? null,
    mxStatus: mxStatus ?? null,
    readinessStatus: sendReady ? 'ready' : 'pending_dns',
    readinessNotes,
  }
}

function mapStatus(rawStatus: string | null | undefined, readiness: EmailProviderDomainReadiness): 'pending_dns' | 'verified' | 'failed' {
  const status = String(rawStatus ?? '').toLowerCase()
  if (readiness.sendReady) return 'verified'
  if (status === 'failed' || status === 'partially_failed' || status === 'temporary_failure') return 'failed'
  return 'pending_dns'
}

function domainFromResponse(data: ResendDomainData): VerifyDomainResult {
  if (!data.id) throw new EmailProviderSafeError('Resend returnerade inget domän-ID.')
  const records = mapRecords(data.records)
  const readiness = deriveReadiness(data.status, records)
  return {
    providerDomainId: data.id,
    domain: data.name ?? null,
    records,
    status: mapStatus(data.status, readiness),
    ...readiness,
  }
}

function extractDomainList(data: unknown): ResendDomainData[] {
  if (Array.isArray(data)) return data as ResendDomainData[]
  if (data && typeof data === 'object') {
    const objectData = data as { data?: unknown }
    if (Array.isArray(objectData.data)) return objectData.data as ResendDomainData[]
  }
  return []
}

function providerError(context: string, error: unknown): EmailProviderSafeError {
  console.warn(`[resend] ${context}`, error)
  if (error instanceof EmailProviderSafeError) return error
  if (error instanceof Error && error.message) {
    return new EmailProviderSafeError(`Resend-fel: ${error.message}`)
  }

  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown; name?: unknown }).message
    const name = (error as { message?: unknown; name?: unknown }).name
    if (typeof message === 'string' && message.trim()) {
      return new EmailProviderSafeError(`Resend-fel${typeof name === 'string' ? ` (${name})` : ''}: ${message}`)
    }
  }

  return new EmailProviderSafeError('Resend kunde inte slutföra åtgärden. Kontrollera e-postinställningarna och försök igen.')
}

export class ResendEmailProvider implements EmailProvider {
  async createDomain(domain: string): Promise<CreateDomainResult> {
    try {
      const resend = createResendClient()
      const response = await resend.domains.create({ name: normalizeDomain(domain) })
      if (response.error || !response.data) throw response.error

      return domainFromResponse(response.data as ResendDomainData)
    } catch (error) {
      throw providerError('createDomain failed', error)
    }
  }

  async findDomainByName(domain: string): Promise<VerifyDomainResult | null> {
    try {
      const resend = createResendClient()
      const response = await resend.domains.list()
      if (response.error || !response.data) throw response.error

      const normalized = normalizeDomain(domain)
      const found = extractDomainList(response.data).find((item) => normalizeDomain(item.name) === normalized)
      if (!found?.id) return null

      const domainResponse = await resend.domains.get(found.id)
      if (domainResponse.error || !domainResponse.data) throw domainResponse.error
      return domainFromResponse(domainResponse.data as ResendDomainData)
    } catch (error) {
      throw providerError('findDomainByName failed', error)
    }
  }

  async verifyDomain(providerDomainId: string): Promise<VerifyDomainResult> {
    try {
      const resend = createResendClient()
      const verifyResponse = await resend.domains.verify(providerDomainId)
      if (verifyResponse.error) throw verifyResponse.error

      const domainResponse = await resend.domains.get(providerDomainId)
      if (domainResponse.error || !domainResponse.data) throw domainResponse.error

      return domainFromResponse(domainResponse.data as ResendDomainData)
    } catch (error) {
      throw providerError('verifyDomain failed', error)
    }
  }

  async sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
    try {
      const resend = createResendClient()
      const attachments =
        input.attachments && input.attachments.length > 0
          ? input.attachments.map((attachment) => ({
              filename: attachment.filename,
              content: attachment.content,
              contentType: attachment.contentType ?? undefined,
            }))
          : undefined
      const response = await resend.emails.send({
        from: input.from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        replyTo: input.replyTo,
        attachments,
        headers: input.idempotencyKey ? { 'Idempotency-Key': input.idempotencyKey } : undefined,
      } as never)

      if (response.error || !response.data) throw response.error

      return {
        providerMessageId: response.data.id,
        status: 'sent',
      }
    } catch (error) {
      throw providerError('sendEmail failed', error)
    }
  }
}
