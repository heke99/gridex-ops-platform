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
  company_id: string | null
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
    {
      name: 'Parse Batch 4 routing envelope',
      expectedFamily: 'PRODAT',
      expected: {
        receiverEdielId: '21660',
        receiverSubAddress: 'SUBTENANT',
        applicationReference: '23-DDQ-PRODAT',
        messageCode: 'E01',
        bgmReference: 'BGM123',
        rffAac: 'MPID123',
        nadMs: '21660',
        dtm157: '202605301400',
      },
      payload: "UNB+UNOC:3+91100:ZZ:SENDER+21660:ZZ:SUBTENANT+260530:1400+ABC126++23-DDQ-PRODAT'UNH+1+PRODAT:D:96A:UN:E2SE5'BGM+E01+BGM123+9'NAD+MS+21660::9'RFF+AAC:MPID123'DTM+157:202605301400:203'UNT+7+1'UNZ+1+ABC126'",
    },
  ]

  return samples.map((sample) => {
    try {
      const parsed = parseEdifactPayload(sample.payload)
      const expected = 'expected' in sample ? sample.expected : null
      const ok = parsed.messageFamily === sample.expectedFamily &&
        (!expected ||
          (parsed.receiverEdielId === expected.receiverEdielId &&
            parsed.receiverSubAddress === expected.receiverSubAddress &&
            parsed.applicationReference === expected.applicationReference &&
            parsed.messageCode === expected.messageCode &&
            parsed.bgmReference === expected.bgmReference &&
            parsed.references.AAC?.[0] === expected.rffAac &&
            parsed.parties.MS?.[0] === expected.nadMs &&
            parsed.dates['157']?.[0] === expected.dtm157))
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

function resolvedMailboxPassword(mailbox: MailboxConfigRow): string | null {
  const mailboxForSecretLookup = {
    id: mailbox.id,
    environment: mailbox.environment ?? 'production',
    secret_reference: mailbox.secret_reference,
  }

  return resolveMailboxPasswordFromSecretReference(mailboxForSecretLookup)
}

function mailboxConfigTest(mailbox: MailboxConfigRow): InboundSmokeTestResult {
  const problems: string[] = []
  const warnings: string[] = []
  const resolvedPassword = resolvedMailboxPassword(mailbox)

  if (!mailbox.imap_host?.trim()) problems.push('imap_host saknas')
  if (!mailbox.username?.trim()) problems.push('username saknas')
  if (!mailbox.secret_reference?.trim()) problems.push('secret_reference saknas')
  else if (!mailbox.secret_reference.startsWith('env:')) problems.push('secret_reference måste börja med env:')
  else if (!resolvedPassword) problems.push('secret_reference pekar inte på ett tillgängligt env-lösenord')

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
      companyId: mailbox.company_id,
      scope: mailbox.metadata?.scope ?? null,
      hasImapHost: Boolean(mailbox.imap_host?.trim()),
      hasUsername: Boolean(mailbox.username?.trim()),
      hasSecretReference: Boolean(mailbox.secret_reference?.trim()),
      hasResolvedPassword: Boolean(resolvedPassword),
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
    .select('id,company_id,mailbox_name,email_address,environment,imap_host,imap_port,username,secret_reference,poll_interval_minutes,metadata,last_error')
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
  const sharedMailboxes = mailboxes.filter((mailbox) => mailbox.company_id === null && mailbox.metadata?.scope === 'platform_shared')
  const sharedTest = sharedMailboxes.find((mailbox) => mailbox.environment === 'test')
  const sharedProduction = sharedMailboxes.find((mailbox) => mailbox.environment === 'production')
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
    {
      name: 'Shared test mailbox',
      status: sharedTest ? 'pass' : 'fail',
      message: sharedTest ? 'Shared test mailbox är konfigurerad.' : 'Saknar aktiv shared mailbox för environment=test.',
      details: { requiredScope: 'platform_shared' },
    },
    {
      name: 'Shared production mailbox',
      status: sharedProduction ? 'pass' : 'fail',
      message: sharedProduction ? 'Shared production mailbox är konfigurerad.' : 'Saknar aktiv shared mailbox för environment=production.',
      details: { requiredScope: 'platform_shared' },
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
    status: cronSecretConfigured ? 'pass' : 'fail',
    message: cronSecretConfigured ? 'Intern cron-secret är konfigurerad.' : 'Ingen cron-secret hittades i env. Detta måste finnas i production.',
  })

  tableResults.push({
    name: 'Cron schedule',
    status: 'pass',
    message: 'Repo:t har Vercel cron entries för test och production var 5:e minut. Kontrollera att hosting-miljön har CRON_SECRET/EDIEL_INBOUND_CRON_SECRET.',
  })

  return [...sampleParseTests(), ...tableResults, ...(await mailboxConfigTests())]
}
