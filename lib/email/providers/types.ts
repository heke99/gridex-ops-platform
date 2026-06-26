export type EmailProviderDomainRecord = {
  type: 'TXT' | 'CNAME' | 'MX'
  name: string
  value: string
  priority?: number | null
  status?: 'pending' | 'verified' | 'failed'
  purpose?: string | null
}

export type EmailProviderDomainReadiness = {
  sendReady: boolean
  dkimStatus?: string | null
  spfStatus?: string | null
  mxStatus?: string | null
  readinessStatus?: string | null
  readinessNotes?: string[]
}

export type CreateDomainResult = {
  providerDomainId: string
  domain?: string | null
  records: EmailProviderDomainRecord[]
  status: 'pending_dns' | 'verified' | 'failed'
} & EmailProviderDomainReadiness

export type VerifyDomainResult = {
  providerDomainId: string
  domain?: string | null
  records: EmailProviderDomainRecord[]
  status: 'pending_dns' | 'verified' | 'failed'
} & EmailProviderDomainReadiness

export type EmailAttachment = {
  filename: string
  /** Base64-encoded content. */
  content: string
  contentType?: string | null
}

export type SendEmailInput = {
  from: string
  to: string | string[]
  replyTo?: string
  subject: string
  html: string
  text?: string
  /** Stable key used by the transport provider for safe reconciliation. */
  idempotencyKey?: string
  /** Optional file attachments (e.g. power of attorney snapshot). */
  attachments?: EmailAttachment[]
}

export type SendEmailResult = {
  providerMessageId: string
  status: 'sent' | 'queued'
}

export interface EmailProvider {
  createDomain(domain: string): Promise<CreateDomainResult>
  findDomainByName(domain: string): Promise<VerifyDomainResult | null>
  verifyDomain(providerDomainId: string): Promise<VerifyDomainResult>
  sendEmail(input: SendEmailInput): Promise<SendEmailResult>
}
