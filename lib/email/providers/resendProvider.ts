import { Resend } from 'resend'
import type {
  CreateDomainResult,
  EmailProvider,
  EmailProviderDomainRecord,
  SendEmailInput,
  SendEmailResult,
  VerifyDomainResult,
} from './types'

type ResendDomainRecord = {
  type?: string
  name?: string
  value?: string
  priority?: number | null
  status?: string | null
}

type ResendDomainStatus = 'pending' | 'verified' | 'failed' | 'not_started' | 'partially_verified' | 'partially_failed'

export class EmailProviderSafeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EmailProviderSafeError'
  }
}

function createResendClient() {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    throw new EmailProviderSafeError('Resend API-nyckel saknas. Lägg till RESEND_API_KEY i servermiljön.')
  }

  return new Resend(apiKey)
}

function mapStatus(status: string | null | undefined): 'pending_dns' | 'verified' | 'failed' {
  if (status === 'verified') return 'verified'
  if (status === 'failed' || status === 'partially_failed') return 'failed'
  return 'pending_dns'
}

function mapRecordStatus(status: string | null | undefined): 'pending' | 'verified' | 'failed' {
  if (status === 'verified') return 'verified'
  if (status === 'failed' || status === 'temporary_failure') return 'failed'
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
    }))
    .filter((record) => record.name.length > 0 && record.value.length > 0)
}

function providerError(context: string, error: unknown): EmailProviderSafeError {
  console.warn(`[resend] ${context}`, error)
  if (error instanceof EmailProviderSafeError) return error
  return new EmailProviderSafeError('Resend kunde inte slutföra åtgärden. Kontrollera e-postinställningarna och försök igen.')
}

export class ResendEmailProvider implements EmailProvider {
  async createDomain(domain: string): Promise<CreateDomainResult> {
    try {
      const resend = createResendClient()
      const response = await resend.domains.create({ name: domain })
      if (response.error || !response.data) throw response.error

      return {
        providerDomainId: response.data.id,
        records: mapRecords(response.data.records as ResendDomainRecord[]),
        status: mapStatus(response.data.status as ResendDomainStatus),
      }
    } catch (error) {
      throw providerError('createDomain failed', error)
    }
  }

  async verifyDomain(providerDomainId: string): Promise<VerifyDomainResult> {
    try {
      const resend = createResendClient()
      const verifyResponse = await resend.domains.verify(providerDomainId)
      if (verifyResponse.error || !verifyResponse.data) throw verifyResponse.error

      const domainResponse = await resend.domains.get(providerDomainId)
      if (domainResponse.error || !domainResponse.data) throw domainResponse.error

      return {
        providerDomainId,
        records: mapRecords(domainResponse.data.records as ResendDomainRecord[]),
        status: mapStatus(domainResponse.data.status as ResendDomainStatus),
      }
    } catch (error) {
      throw providerError('verifyDomain failed', error)
    }
  }

  async sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
    try {
      const resend = createResendClient()
      const response = await resend.emails.send({
        from: input.from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        replyTo: input.replyTo,
      })

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
