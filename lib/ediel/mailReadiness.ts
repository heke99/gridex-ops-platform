import { promises as dns } from 'dns'
import net from 'net'

export type MailReadinessRecord = {
  type: 'MX' | 'TXT' | 'CNAME'
  host: string
  value: string
  purpose: string
}

export type MailLaneReadiness = {
  lane: 'ediel' | 'events'
  provider: 'strato' | 'resend'
  sender: string
  domain: string
  smtpHost?: string | null
  smtpPort?: number | null
  smtpSecure?: boolean | null
  appLevelDkimEnabled: boolean
  statuses: Array<{
    key: string
    status: 'ok' | 'warning' | 'error' | 'unknown'
    message: string
    diagnostics?: unknown
  }>
  requiredRecords: MailReadinessRecord[]
  lastCheckedAt: string
}

export const STRATO_EDIEL_DNS_RECORDS: MailReadinessRecord[] = [
  { type: 'MX', host: '@', value: 'smtpin.rzone.de.', purpose: 'Strato inbound MX for configured Ediel transport domain' },
  { type: 'TXT', host: '@', value: 'v=spf1 redirect=_spf.strato.com', purpose: 'SPF for Strato SMTP sender' },
  { type: 'CNAME', host: 'strato-dkim-0002._domainkey', value: 'strato-dkim-0002._domainkey.rzone.com.', purpose: 'Strato DKIM selector 0002' },
  { type: 'CNAME', host: 'strato-dkim-0003._domainkey', value: 'strato-dkim-0003._domainkey.rzone.com.', purpose: 'Strato DKIM selector 0003' },
  { type: 'TXT', host: '_dmarc', value: 'v=DMARC1; p=none; pct=100', purpose: 'DMARC monitoring for configured Ediel transport domain' },
]

export const RESEND_EVENTS_DNS_GUIDANCE: MailReadinessRecord[] = [
  { type: 'MX', host: 'events or send subdomain', value: 'Copy exact return-path MX from Resend dashboard', purpose: 'Resend bounces/return-path' },
  { type: 'TXT', host: 'events or send subdomain', value: 'Copy exact SPF from Resend dashboard', purpose: 'Resend SPF' },
  { type: 'TXT', host: 'resend._domainkey.events', value: 'Copy exact DKIM value from Resend dashboard', purpose: 'Resend DKIM; do not guess value' },
]

function envBool(name: string, fallback = false): boolean {
  const raw = String(process.env[name] ?? '').trim().toLowerCase()
  if (!raw) return fallback
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on'
}

function envNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name])
  return Number.isFinite(parsed) ? parsed : fallback
}

function firstNonBlank(...values: Array<string | undefined | null>): string | null {
  for (const value of values) {
    const trimmed = String(value ?? '').trim()
    if (trimmed) return trimmed
  }
  return null
}

function domainFromEmail(value: string | null | undefined): string | null {
  const email = firstNonBlank(value)
  const domain = email?.split('@')[1]?.trim().toLowerCase()
  return domain || null
}

function dnsHost(name: string, domain: string) {
  return name === '@' ? domain : `${name}.${domain}`
}

function flattenTxt(records: string[][]): string[] {
  return records.map((record) => record.join(''))
}

function status(key: string, ok: boolean | null, okMessage: string, badMessage: string, diagnostics?: unknown) {
  return {
    key,
    status: ok === null ? 'unknown' as const : ok ? 'ok' as const : 'warning' as const,
    message: ok === null ? `${key} kunde inte kontrolleras.` : ok ? okMessage : badMessage,
    diagnostics,
  }
}

async function checkTcp(host: string, port: number, timeoutMs = 3000): Promise<{ ok: boolean; error: string | null }> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    const timeout = setTimeout(() => {
      socket.destroy()
      resolve({ ok: false, error: `Timeout after ${timeoutMs}ms` })
    }, timeoutMs)
    socket.once('connect', () => {
      clearTimeout(timeout)
      socket.end()
      resolve({ ok: true, error: null })
    })
    socket.once('error', (error) => {
      clearTimeout(timeout)
      resolve({ ok: false, error: error.message })
    })
  })
}

export function edielSmtpConfig() {
  const from = firstNonBlank(process.env.EDIEL_SMTP_FROM)
  return {
    provider: firstNonBlank(process.env.EDIEL_EMAIL_PROVIDER, 'strato') ?? 'strato',
    host: firstNonBlank(process.env.EDIEL_SMTP_HOST, 'smtp.strato.de') ?? 'smtp.strato.de',
    port: envNumber('EDIEL_SMTP_PORT', 465),
    secure: envBool('EDIEL_SMTP_SECURE', true),
    user: firstNonBlank(process.env.EDIEL_SMTP_USER, from),
    password: firstNonBlank(process.env.EDIEL_SMTP_PASS, process.env.EDIEL_SMTP_PASSWORD) ?? '',
    from: from ?? '',
    replyTo: firstNonBlank(process.env.EDIEL_SMTP_REPLY_TO, from) ?? '',
    appLevelDkimEnabled: envBool('EDIEL_APP_DKIM_ENABLED', false),
  }
}

export function assertEdielSmtpReadiness() {
  const config = edielSmtpConfig()
  const missing: string[] = []
  if (!config.provider) missing.push('EDIEL_EMAIL_PROVIDER')
  if (!config.host) missing.push('EDIEL_SMTP_HOST')
  if (!config.port) missing.push('EDIEL_SMTP_PORT')
  if (!config.user) missing.push('EDIEL_SMTP_USER')
  if (!config.password) missing.push('EDIEL_SMTP_PASS eller EDIEL_SMTP_PASSWORD')
  if (!config.from) missing.push('EDIEL_SMTP_FROM')

  if (String(process.env.EMAIL_PROVIDER ?? '').toLowerCase() === 'strato') {
    throw new Error('Ediel mail readiness stoppad: EMAIL_PROVIDER får inte sättas till strato globalt. Resend ska vara default för applikationsmail; använd EDIEL_EMAIL_PROVIDER=strato för Ediel.')
  }

  if (config.provider.toLowerCase() === 'resend') {
    throw new Error('Ediel mail readiness stoppad: Ediel send path får inte använda Resend. Sätt EDIEL_EMAIL_PROVIDER=strato och EDIEL_SMTP_*.')
  }

  if (config.provider.toLowerCase() !== 'strato') {
    throw new Error(`Ediel mail readiness stoppad: okänd EDIEL_EMAIL_PROVIDER=${config.provider}. För Ediel ska provider vara strato.`)
  }

  if (missing.length > 0) {
    throw new Error(`Ediel SMTP saknar miljövariabler: ${missing.join(', ')}`)
  }

  const expectedMailbox = firstNonBlank(process.env.EDIEL_SHARED_MAILBOX_ADDRESS)
  if (expectedMailbox && (config.from.toLowerCase() !== expectedMailbox.toLowerCase() || String(config.user ?? '').toLowerCase() !== expectedMailbox.toLowerCase())) {
    throw new Error('Ediel SMTP måste använda den konfigurerade shared mailbox-adressen som user/from.')
  }

  if (config.appLevelDkimEnabled) {
    throw new Error('Ediel send readiness stoppad: app-level DKIM är aktiverad. Låt Strato/provider DKIM-signera Ediel SMTP.')
  }

  return config
}

export function resendEventsConfig() {
  const from = firstNonBlank(process.env.DEFAULT_FROM_EMAIL, process.env.RESEND_FROM_EMAIL, process.env.PLATFORM_FALLBACK_FROM_EMAIL) ?? ''
  return {
    provider: 'resend' as const,
    from,
    apiKeyConfigured: Boolean(process.env.RESEND_API_KEY),
  }
}

export async function getMailReadiness(): Promise<{ ediel: MailLaneReadiness; events: MailLaneReadiness }> {
  const checkedAt = new Date().toISOString()
  const edielConfig = edielSmtpConfig()
  const resendConfig = resendEventsConfig()
  const edielDomain = firstNonBlank(process.env.EDIEL_MAIL_DOMAIN, domainFromEmail(edielConfig.from))
  const eventDomain = domainFromEmail(resendConfig.from)

  const [mx, rootTxt, dmarcTxt, dkim2, dkim3, tcp] = await Promise.all([
    edielDomain ? dns.resolveMx(edielDomain).catch((error) => ({ error })) : Promise.resolve({ error: new Error('EDIEL_MAIL_DOMAIN/EDIEL_SMTP_FROM saknas') }),
    edielDomain ? dns.resolveTxt(edielDomain).then(flattenTxt).catch((error) => ({ error })) : Promise.resolve({ error: new Error('EDIEL_MAIL_DOMAIN/EDIEL_SMTP_FROM saknas') }),
    edielDomain ? dns.resolveTxt(`_dmarc.${edielDomain}`).then(flattenTxt).catch((error) => ({ error })) : Promise.resolve({ error: new Error('EDIEL_MAIL_DOMAIN/EDIEL_SMTP_FROM saknas') }),
    edielDomain ? dns.resolveCname(`strato-dkim-0002._domainkey.${edielDomain}`).catch((error) => ({ error })) : Promise.resolve({ error: new Error('EDIEL_MAIL_DOMAIN/EDIEL_SMTP_FROM saknas') }),
    edielDomain ? dns.resolveCname(`strato-dkim-0003._domainkey.${edielDomain}`).catch((error) => ({ error })) : Promise.resolve({ error: new Error('EDIEL_MAIL_DOMAIN/EDIEL_SMTP_FROM saknas') }),
    checkTcp(edielConfig.host, edielConfig.port),
  ])

  const mxValues = Array.isArray(mx) ? mx.map((item) => item.exchange.toLowerCase()) : []
  const txtValues = Array.isArray(rootTxt) ? rootTxt : []
  const dmarcValues = Array.isArray(dmarcTxt) ? dmarcTxt : []
  const spfRecords = txtValues.filter((item) => item.toLowerCase().startsWith('v=spf1'))
  const dkim2Values = Array.isArray(dkim2) ? dkim2.map((item) => item.toLowerCase()) : []
  const dkim3Values = Array.isArray(dkim3) ? dkim3.map((item) => item.toLowerCase()) : []

  const edielStatuses: MailLaneReadiness['statuses'] = [
    status('mx', mxValues.some((value) => value === 'smtpin.rzone.de'), 'MX pekar mot Strato.', 'MX saknar smtpin.rzone.de.', mx),
    status('spf', spfRecords.includes('v=spf1 redirect=_spf.strato.com'), 'SPF matchar Strato redirect.', spfRecords.length > 1 ? 'Flera SPF-records finns; detta bryter SPF.' : 'SPF matchar inte Strato-värdet.', spfRecords),
    status('dkim_0002', dkim2Values.includes('strato-dkim-0002._domainkey.rzone.com'), 'Strato DKIM 0002 finns.', 'Strato DKIM 0002 saknas/fel.', dkim2),
    status('dkim_0003', dkim3Values.includes('strato-dkim-0003._domainkey.rzone.com'), 'Strato DKIM 0003 finns.', 'Strato DKIM 0003 saknas/fel.', dkim3),
    status('dmarc', dmarcValues.some((value) => value.toLowerCase().startsWith('v=dmarc1')), 'DMARC finns.', 'DMARC saknas.', dmarcTxt),
    {
      key: 'ediel_sender_configured',
      status: edielConfig.from && edielDomain ? 'ok' : 'error',
      message: edielConfig.from && edielDomain
        ? 'Ediel shared mailbox-avsändare är konfigurerad via miljövariabler.'
        : 'EDIEL_SMTP_FROM eller EDIEL_MAIL_DOMAIN saknas. Shared mailbox måste konfigureras per miljö.',
    },
    {
      key: 'app_level_dkim',
      status: edielConfig.appLevelDkimEnabled ? 'error' : 'ok',
      message: edielConfig.appLevelDkimEnabled
        ? 'App-level DKIM är på för Ediel. Stäng av tills Strato-signering är verifierad.'
        : 'App-level DKIM är av; Strato/provider ska DKIM-signera Ediel SMTP.',
    },
    {
      key: 'provider_separation',
      status: String(process.env.EMAIL_PROVIDER ?? 'resend').toLowerCase() === 'strato' || edielConfig.provider.toLowerCase() === 'resend' ? 'error' : 'ok',
      message: String(process.env.EMAIL_PROVIDER ?? 'resend').toLowerCase() === 'strato'
        ? 'EMAIL_PROVIDER=strato får inte användas globalt; appmail ska fortsatt gå via Resend.'
        : edielConfig.provider.toLowerCase() === 'resend'
          ? 'EDIEL_EMAIL_PROVIDER får inte vara resend.'
          : 'Resend och Ediel/Strato är separerade.',
    },
    {
      key: 'smtp_tcp',
      status: tcp.ok ? 'ok' : 'warning',
      message: tcp.ok ? 'SMTP-host kan nås via TCP.' : `SMTP TCP kunde inte verifieras: ${tcp.error ?? 'okänt fel'}`,
      diagnostics: tcp,
    },
  ]

  return {
    ediel: {
      lane: 'ediel',
      provider: 'strato',
      sender: edielConfig.from,
      domain: edielDomain ?? 'saknas',
      smtpHost: edielConfig.host,
      smtpPort: edielConfig.port,
      smtpSecure: edielConfig.secure,
      appLevelDkimEnabled: edielConfig.appLevelDkimEnabled,
      statuses: edielStatuses,
      requiredRecords: edielDomain
        ? STRATO_EDIEL_DNS_RECORDS.map((record) => ({ ...record, host: dnsHost(record.host, edielDomain) }))
        : STRATO_EDIEL_DNS_RECORDS,
      lastCheckedAt: checkedAt,
    },
    events: {
      lane: 'events',
      provider: 'resend',
      sender: resendConfig.from,
      domain: eventDomain ?? 'saknas',
      appLevelDkimEnabled: false,
      statuses: [
        {
          key: 'resend_api_key',
          status: resendConfig.apiKeyConfigured ? 'ok' : 'warning',
          message: resendConfig.apiKeyConfigured ? 'RESEND_API_KEY är konfigurerad.' : 'RESEND_API_KEY saknas i denna runtime.',
        },
        {
          key: 'event_sender_domain',
          status: eventDomain ? 'ok' : 'warning',
          message: eventDomain
            ? 'Event-avsändare är konfigurerad via miljövariabler. Tenant-specifika kundmail ska fortfarande använda verifierad bolagsdomän.'
            : 'Event-/fallback-avsändare saknas. Sätt DEFAULT_FROM_EMAIL, RESEND_FROM_EMAIL eller PLATFORM_FALLBACK_FROM_EMAIL.',
        },
      ],
      requiredRecords: RESEND_EVENTS_DNS_GUIDANCE,
      lastCheckedAt: checkedAt,
    },
  }
}
