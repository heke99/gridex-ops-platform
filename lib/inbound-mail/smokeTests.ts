import { parseEdifactPayload } from '@/lib/inbound-mail/edielEmailParser'
import { supabaseService } from '@/lib/supabase/service'

export type InboundSmokeTestResult = {
  name: string
  status: 'pass' | 'warning' | 'fail'
  message: string
  details?: Record<string, unknown>
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

  return [...sampleParseTests(), ...tableResults]
}
