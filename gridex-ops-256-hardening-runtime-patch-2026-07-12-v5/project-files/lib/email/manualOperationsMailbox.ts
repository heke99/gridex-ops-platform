// lib/email/manualOperationsMailbox.ts
//
// Resolver for the MANUAL operations mailbox (separate from the Ediel mailbox).
//
// Concept separation (do NOT mix):
//   * manual_communication_mailboxes = Gridex SENDER/REPLY + inbound IMAP mailbox
//     for MANUAL (non-Ediel) grid-owner communication.
//   * grid_owner_contact_channels    = RECIPIENT addresses per grid owner.
//   * ediel_mailboxes                = Ediel/EDIFACT transport ONLY (ediel@gridex.se).
//
// Manual supplier-switch / power-of-attorney / facility-information e-mail MUST be
// sent from the configured manual operations mailbox, never from ediel@gridex.se.
//
// OUTBOUND TRANSPORT (intentional, Option 1):
//   * The manual mailbox here supplies the SENDER/REPLY-TO identity
//     (leverantorsbyte@gridex.se) only.
//   * Actual delivery is done by Resend (see manualEmailOutbox worker /
//     getEmailProvider), NOT via the IMAP/SMTP credentials stored on the
//     mailbox row.
//   * Inbound replies are read from the Strato IMAP mailbox.
//   * Therefore sent mail will NOT appear in the Strato "Sent" folder, and the
//     stored SMTP settings are NOT used for outbound sending. Do not present
//     them in the UI as if they were.

import { supabaseService } from '@/lib/supabase/service'

type JsonRecord = Record<string, unknown>

export type ManualMailboxChannelType =
  | 'facility_information_request'
  | 'supplier_switch_manual'
  | 'power_of_attorney'
  | 'ai_list'
  | 'escalation'

export type ManualOperationsMailbox = {
  id: string
  companyId: string | null
  mailboxType: string
  environment: string
  fromEmail: string
  replyToEmail: string | null
  imapHost: string | null
  imapPort: number | null
  imapUsername: string | null
  imapSecretReference: string | null
  imapFolder: string | null
  imapSecure: boolean
  isActive: boolean
  isVerified: boolean
  metadata: JsonRecord
}

// Maps the grid_owner_contact_channels channel type to a manual mailbox purpose.
const CHANNEL_TO_MAILBOX_TYPE: Record<ManualMailboxChannelType, string> = {
  facility_information_request: 'facility_information_request',
  supplier_switch_manual: 'manual_supplier_switch',
  power_of_attorney: 'power_of_attorney',
  ai_list: 'ai_list',
  escalation: 'escalation',
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function missingSchema(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? '')
  const message = String((error as { message?: unknown } | null)?.message ?? '')
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code) || /schema cache|does not exist/i.test(message)
}

// Default environment for manual mailbox selection. Manual flows do not carry an
// explicit Ediel test/production environment, so resolve from config.
export function resolveManualMailboxEnvironment(): 'test' | 'production' {
  const configured = clean(process.env.GRIDEX_MANUAL_OPS_ENVIRONMENT)?.toLowerCase()
  if (configured === 'test' || configured === 'production') return configured
  return String(process.env.NODE_ENV ?? '').toLowerCase() === 'production' ? 'production' : 'test'
}

// The Ediel transport sender must never be used for manual e-mail.
export function isEdielReservedSender(email: string | null | undefined): boolean {
  const candidate = clean(email)?.toLowerCase()
  if (!candidate) return false
  const reserved = new Set(
    [process.env.EDIEL_SMTP_FROM, process.env.EDIEL_SMTP_REPLY_TO, 'ediel@gridex.se']
      .map((value) => clean(value)?.toLowerCase())
      .filter((value): value is string => Boolean(value)),
  )
  return reserved.has(candidate)
}

function toMailbox(row: JsonRecord): ManualOperationsMailbox | null {
  const fromEmail = clean(row.from_email)
  if (!fromEmail) return null
  return {
    id: String(row.id),
    companyId: clean(row.company_id),
    mailboxType: clean(row.mailbox_type) ?? 'general_manual_operations',
    environment: clean(row.environment) ?? 'test',
    fromEmail,
    replyToEmail: clean(row.reply_to_email) ?? fromEmail,
    imapHost: clean(row.imap_host),
    imapPort: typeof row.imap_port === 'number' ? row.imap_port : null,
    imapUsername: clean(row.imap_username),
    imapSecretReference: clean(row.imap_secret_reference),
    imapFolder: clean(row.imap_folder) ?? 'INBOX',
    imapSecure: row.imap_secure !== false,
    isActive: row.is_active !== false,
    isVerified: row.is_verified === true,
    metadata: (row.metadata as JsonRecord | null) ?? {},
  }
}

// Score a candidate mailbox: tenant override > platform default; environment
// match > mismatch; specific purpose > general. Higher is better.
function scoreMailbox(mailbox: ManualOperationsMailbox, input: {
  companyId: string
  environment: string
  preferredType: string
}): number {
  let score = 0
  if (mailbox.companyId === input.companyId) score += 100
  if (mailbox.environment === input.environment) score += 10
  if (mailbox.mailboxType === input.preferredType) score += 5
  else if (mailbox.mailboxType === 'general_manual_operations') score += 2
  if (mailbox.isVerified) score += 1
  return score
}

// Resolves the manual operations mailbox to send FROM for a given tenant +
// channel. Tenant override (company_id) takes precedence over the platform
// default (company_id null). Returns null when nothing is configured (caller
// must then block manual sending with a Swedish business blocker; NEVER fall
// back to ediel@gridex.se).
export async function resolveManualOperationsMailbox(input: {
  companyId: string
  channelType?: ManualMailboxChannelType
  environment?: 'test' | 'production'
}): Promise<ManualOperationsMailbox | null> {
  const environment = input.environment ?? resolveManualMailboxEnvironment()
  const preferredType = input.channelType ? CHANNEL_TO_MAILBOX_TYPE[input.channelType] : 'general_manual_operations'

  const { data, error } = await supabaseService
    .from('manual_communication_mailboxes')
    .select('id,company_id,mailbox_type,environment,from_email,reply_to_email,imap_host,imap_port,imap_username,imap_secret_reference,imap_folder,imap_secure,is_active,is_verified,verified_at,metadata')
    .eq('is_active', true)
    .eq('is_verified', true)
    .eq('environment', environment)
    .in('mailbox_type', [preferredType, 'general_manual_operations'])
    .or(`company_id.is.null,company_id.eq.${input.companyId}`)
    .order('verified_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: true })
  if (error) {
    if (missingSchema(error)) return null
    throw error
  }

  const candidates = ((data ?? []) as JsonRecord[])
    .map(toMailbox)
    .filter((mailbox): mailbox is ManualOperationsMailbox => Boolean(mailbox))
    .filter((mailbox) => mailbox.isVerified && mailbox.environment === environment)
    .filter((mailbox) => mailbox.mailboxType === preferredType || mailbox.mailboxType === 'general_manual_operations')
    // Never use the reserved Ediel sender as a manual mailbox.
    .filter((mailbox) => !isEdielReservedSender(mailbox.fromEmail))

  if (candidates.length === 0) return null

  candidates.sort((a, b) => {
    const scoreDiff = scoreMailbox(b, { companyId: input.companyId, environment, preferredType }) -
      scoreMailbox(a, { companyId: input.companyId, environment, preferredType })
    return scoreDiff || a.id.localeCompare(b.id)
  })
  const winner = candidates[0] ?? null
  const equallyPreferred = winner
    ? candidates.filter((candidate) => scoreMailbox(candidate, { companyId: input.companyId, environment, preferredType }) === scoreMailbox(winner, { companyId: input.companyId, environment, preferredType }))
    : []
  if (equallyPreferred.length > 1) {
    throw new Error(`Flera verifierade manuella brevlådor har samma prioritet för ${preferredType}/${environment}. Markera en entydig tenantbrevlåda.`)
  }
  return winner
}

// Resolves the inbound IMAP password for a manual mailbox from its env-only
// secret reference, mirroring the Ediel secret-reference resolution pattern.
export function resolveManualMailboxSecret(
  reference: string | null | undefined,
  mailboxId: string,
): string | null {
  const ref = clean(reference)
  if (ref?.startsWith('env:')) {
    const value = clean(process.env[ref.slice(4)])
    if (value) return value
  } else if (ref) {
    const direct = clean(process.env[ref])
    if (direct) return direct
  }
  const mailboxSpecific = clean(process.env[`MANUAL_MAILBOX_${mailboxId.replace(/-/g, '_').toUpperCase()}_PASSWORD`])
  if (mailboxSpecific) return mailboxSpecific
  return (
    clean(process.env.MANUAL_OPS_IMAP_PASS) ??
    clean(process.env.MANUAL_OPS_IMAP_PASSWORD) ??
    null
  )
}
