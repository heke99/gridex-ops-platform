import { parseEdifactPayload } from '@/lib/inbound-mail/edielEmailParser'
import { normalizeImapMailboxFolder, resolveMailboxPasswordFromSecretReference } from '@/lib/inbound-mail/edielMailboxPoller'
import { supabaseService } from '@/lib/supabase/service'

export type InboundSmokeTestResult = {
  name: string
  status: 'pass' | 'warning' | 'fail'
  message: string
  details?: Record<string, unknown>
}

type MailboxConfigRow = {
  id: string
  mailbox_name: string | null
  email_address: string | null
  environment: string | null
  imap_host: string | null
  imap_port: number | null
  username: string | null
  secret_reference: string | null
  poll_interval_minutes: number | null
  metadata: Record<string, unknown> | null
  last_error: string | null
}

async function tableExists(table: string): Promise<boolean> {
  const { error } = await supabaseService.from(table).select('id', { head: true, count: 'exact' }).limit(1)
  return !error
}

function sampleParseTests(): InboundSmokeTestResult[] {
  const samples = [
    {
      name: 'Parse CONTRL',
      expectedFamily: 'CONTRL',
      payload: "UNB+UNOC:3+91100:ZZ:PRODAT+21660:ZZ+260528:1200+ABC123++23-DDQ-PRODAT'UNH+1+CONTRL:D:96A:UN:1.0'UCI+ABC123+91100:ZZ:PRODAT+21660:ZZ+7'UNT+3+1'UNZ+1+ABC123'",
    },
    {
      name: 'Parse APERAK',
      expectedFamily: 'APERAK',
      payload: "UNB+UNOC:3+91100:ZZ:PRODAT+21660:ZZ+260528:1201+ABC124++23-DDQ-PRODAT'UNH+1+APERAK:D:96A:UN:E2SE6A'BGM+313+APERAK1+9'RFF+ACW:ORIG1'ERC+40::260'FTX+AAO++105::260+The object could not be identified'UNT+6+1'UNZ+1+ABC124'",
    },
    {
      name: 'Parse UTILTS_ERR',
      expectedFamily: 'UTILTS_ERR',
      payload: "UNB+UNOC:3+91100:ZZ:UTILTS+21660:ZZ+260528:1202+ABC125++23-DDQ-UTILTS'UNH+1+UTILTS:D:02B:UN:E5SE5A'BGM+ERR+ERR1+9'RFF+TN:ORIGTN1'STS+E01::260+41+E50::260'UNT+5+1'UNZ+1+ABC125'",
    },
  ]

  return samples.map((sample) => {
    try {
      const parsed = parseEdifactPayload(sample.payload)
      const ok = parsed.messageFamily === sample.expectedFamily
      return {
        name: sample.name,
        status: ok ? 'pass' : 'fail',
        message: ok ? `${sample.expectedFamily} parser OK` : `Förväntade ${sample.expectedFamily}, fick ${parsed.messageFamily}`,
        details: { parsed },
      }
    } catch (error) {
      return {
        name: sample.name,
        status: 'fail',
        message: error instanceof Error ? error.message : 'Okänt parserfel',
      }
    }
  })
}

function mailboxLabel(mailbox: MailboxConfigRow): string {
  return mailbox.mailbox_name ?? mailbox.email_address ?? mailbox.id
}

function mailboxConfigTest(mailbox: MailboxConfigRow): InboundSmokeTestResult {
  const problems: string[] = []
  const warnings: string[] = []

  if (!mailbox.imap_host?.trim()) problems.push('imap_host saknas')
  if (!mailbox.username?.trim()) problems.push('username saknas')
  if (!mailbox.secret_reference?.trim()) problems.push('secret_reference saknas')
  else if (!resolveMailboxPasswordFromSecretReference(mailbox)) problems.push('secret_reference pekar inte på ett tillgängligt env-lösenord')

  if (mailbox.imap_port !== null && (!Number.isFinite(mailbox.imap_port) || mailbox.imap_port <= 0)) problems.push('imap_port är ogiltig')
  if (mailbox.poll_interval_minutes !== null && mailbox.poll_interval_minutes <= 0) warnings.push('poll_interval_minutes bör vara större än 0')

  const rawFolder = mailbox.metadata?.imap_folder ?? mailbox.metadata?.folder
  const normalizedFolder = normalizeImapMailboxFolder(rawFolder)
  if (typeof rawFolder === 'string' && rawFolder.trim() && rawFolder.trim() !== normalizedFolder) {
    warnings.push(`IMAP-mapp "${rawFolder}" normaliseras till "${normalizedFolder}"`)
  }

  const status = problems.length > 0 ? 'fail' : warnings.length > 0 ? 'warning' : 'pass'
  return {
    name: `IMAP config: ${mailboxLabel(mailbox)}`,
    status,
    message: problems.length > 0 ? problems.join('. ') : warnings.length > 0 ? warnings.join('. ') : 'Aktiv mailbox har nödvändig IMAP-konfiguration.',
    details: {
      environment: mailbox.environment,
      hasImapHost: Boolean(mailbox.imap_host?.trim()),
      hasUsername: Boolean(mailbox.username?.trim()),
      hasSecretReference: Boolean(mailbox.secret_reference?.trim()),
      hasResolvedPassword: Boolean(resolveMailboxPasswordFromSecretReference(mailbox)),
      imapPort: mailbox.imap_port,
      pollIntervalMinutes: mailbox.poll_interval_minutes,
      normalizedFolder,
      lastError: mailbox.last_error,
    },
  }
}

async function mailboxConfigTests(): Promise<InboundSmokeTestResult[]> {
  const { data, error } = await supabaseService
    .from('ediel_mailboxes')
    .select('id,mailbox_name,email_address,environment,imap_host,imap_port,username,secret_reference,poll_interval_minutes,metadata,last_error')
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(50)

  if (error) {
    return [{
      name: 'IMAP mailbox config',
      status: 'fail',
      message: `Aktiva mailboxar kunde inte läsas: ${error.message}`,
    }]
  }

  const mailboxes = (data ?? []) as MailboxConfigRow[]
  if (mailboxes.length === 0) {
    return [{
      name: 'IMAP mailbox config',
      status: 'warning',
      message: 'Ingen aktiv Ediel-mailbox finns. Sync-knappen kan då inte hämta IMAP-mail.',
    }]
  }

  return [
    {
      name: 'IMAP active mailboxes',
      status: 'pass',
      message: `${mailboxes.length} aktiv(a) mailbox(ar) hittades för IMAP-sync.`,
      details: { count: mailboxes.length },
    },
    ...mailboxes.map(mailboxConfigTest),
  ]
}

export async function runInboundMailSmokeTests(): Promise<InboundSmokeTestResult[]> {
  const requiredTables = [
    'ediel_mailboxes',
    'inbound_email_messages',
    'inbound_email_attachments',
    'inbound_ediel_parse_results',
    'inbound_ediel_match_attempts',
    'inbound_processing_jobs',
    'customer_operation_tasks',
    'outbound_requests',
    'ediel_messages',
    'grid_owner_access_agreements',
  ]

  const tableResults: InboundSmokeTestResult[] = []
  for (const table of requiredTables) {
    const exists = await tableExists(table)
    tableResults.push({
      name: `Table: ${table}`,
      status: exists ? 'pass' : 'fail',
      message: exists ? 'Tabellen är läsbar med service client.' : 'Tabellen saknas eller kan inte läsas.',
    })
  }

  const cronSecretConfigured = Boolean(process.env.EDIEL_INBOUND_CRON_SECRET ?? process.env.CRON_SECRET)
  tableResults.push({
    name: 'Cron secret',
    status: cronSecretConfigured ? 'pass' : 'warning',
    message: cronSecretConfigured ? 'Intern cron-secret är konfigurerad.' : 'Ingen cron-secret hittades i env. Tillåt bara detta lokalt, inte production.',
  })

  return [...sampleParseTests(), ...tableResults, ...(await mailboxConfigTests())]
}
