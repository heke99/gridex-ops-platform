export type EmailProviderDomainRecord = {
  type: 'TXT' | 'CNAME' | 'MX'
  name: string
  value: string
  priority?: number | null
  status?: 'pending' | 'verified' | 'failed'
}

export type CreateDomainResult = {
  providerDomainId: string
  records: EmailProviderDomainRecord[]
  status: 'pending_dns' | 'verified' | 'failed'
}

export type VerifyDomainResult = {
  providerDomainId: string
  records: EmailProviderDomainRecord[]
  status: 'pending_dns' | 'verified' | 'failed'
}

export type SendEmailInput = {
  from: string
  to: string | string[]
  replyTo?: string
  subject: string
  html: string
  text?: string
}

export type SendEmailResult = {
  providerMessageId: string
  status: 'sent' | 'queued'
}

export interface EmailProvider {
  createDomain(domain: string): Promise<CreateDomainResult>
  verifyDomain(providerDomainId: string): Promise<VerifyDomainResult>
  sendEmail(input: SendEmailInput): Promise<SendEmailResult>
}
