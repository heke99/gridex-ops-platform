import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Page from '@/app/admin/inbound-mail/diagnostics/page'

const { fetchDiagnostics, requirePlatformAdminAccess } = vi.hoisted(() => ({
  fetchDiagnostics: vi.fn<typeof fetch>(),
  requirePlatformAdminAccess: vi.fn(),
}))

vi.mock('@/lib/admin/guards', () => ({ requirePlatformAdminAccess }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: () => null }))
vi.mock('@/lib/inbound-mail/edielMailboxPoller', () => ({
  normalizeImapMailboxFolder: (value: unknown) => typeof value === 'string' ? value : 'INBOX',
  resolveMailboxPasswordFromSecretReference: () => 'synthetic secret lookup result',
}))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await vi.importActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js')
  return {
    supabaseService: createClient('https://diagnostics.test', 'synthetic-service-key', {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: fetchDiagnostics },
    }),
  }
})

const mailboxId = '425790b4-6bca-4045-b63b-e926630687ad'
const pollTime = '2026-11-19T08:15:00+00:00'
const mailbox = {
  id: mailboxId,
  company_id: null,
  mailbox_name: 'Ediel diagnostic fixture',
  email_address: 'mailbox@diagnostics.test',
  environment: 'production',
  imap_host: 'imap.diagnostics.test',
  imap_port: 993,
  username: 'synthetic-mailbox',
  secret_reference: 'env:SYNTHETIC_DIAGNOSTIC_REFERENCE',
  poll_interval_minutes: 5,
  metadata: { scope: 'platform_shared', imap_folder: 'INBOX' },
  last_polled_at: pollTime,
  last_error: null,
}

function setMailboxRead(body: unknown, status = 200) {
  fetchDiagnostics.mockImplementation(async (input, init) => {
    const url = new URL(String(input))
    expect(url.origin).toBe('https://diagnostics.test')
    if (init?.method === 'HEAD') return new Response(null, { headers: { 'Content-Range': '*/0' } })
    expect(init?.method).toBe('GET')
    expect(url.pathname).toBe('/rest/v1/ediel_mailboxes')
    expect(url.searchParams.get('is_active')).toBe('eq.true')
    expect(url.searchParams.get('order')).toBe('updated_at.desc')
    expect(url.searchParams.get('limit')).toBe('50')
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  })
}

beforeEach(() => {
  fetchDiagnostics.mockReset()
  requirePlatformAdminAccess.mockReset().mockResolvedValue({ email: 'admin@diagnostics.test' })
  vi.stubGlobal('React', React)
  vi.stubEnv('EDIEL_INBOUND_CRON_SECRET', 'synthetic-cron-ready')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('platform inbound mail diagnostics', () => {
  it('keeps the IMAP configuration result and reports a failed poll with safe correlation', async () => {
    const rawProviderError = 'synthetic provider connection diagnostic detail'
    setMailboxRead([{ ...mailbox, last_error: rawProviderError }])
    const html = renderToStaticMarkup(await Page())

    expect(html).not.toContain(rawProviderError)
    expect(html).not.toContain('synthetic secret lookup result')
    expect(html).toContain('IMAP config: Ediel diagnostic fixture')
    expect(html).toContain('Aktiv mailbox har nödvändig IMAP-konfiguration.')
    expect(html).toContain('IMAP senaste pollning: Ediel diagnostic fixture')
    expect(html).toContain('Senaste pollningen misslyckades. Kontrollera IMAP-inställningarna')
    expect(html).toContain(`&quot;mailboxId&quot;: &quot;${mailboxId}&quot;`)
    expect(html).toContain(`&quot;lastPolledAt&quot;: &quot;${pollTime}&quot;`)
    expect(requirePlatformAdminAccess).toHaveBeenCalledOnce()
    expect(fetchDiagnostics.mock.calls.filter(([, init]) => init?.method === 'GET')).toHaveLength(1)
  })

  it('shows a fixed retry and escalation step if the mailbox query fails', async () => {
    const rawStorageError = 'synthetic mailbox read diagnostic detail'
    setMailboxRead({ code: '42703', message: rawStorageError }, 400)
    const html = renderToStaticMarkup(await Page())

    expect(html).not.toContain(rawStorageError)
    expect(html).toContain('Aktiva brevlådor kunde inte läsas. Försök igen.')
    expect(html).toContain('Kontrollera databasanslutningen om felet kvarstår.')
    expect(html).not.toContain('Ingen aktiv Ediel-mailbox finns')
  })

  it('keeps configuration, parser and empty controls and does not infer a poll result from an attempt', async () => {
    setMailboxRead([mailbox])
    const html = renderToStaticMarkup(await Page())
    expect(html).toContain('Aktiv mailbox har nödvändig IMAP-konfiguration.')
    expect(html).toContain('Parse CONTRL')
    expect(html).toContain('Intern cron-secret är konfigurerad.')
    expect(html).not.toContain('IMAP senaste pollning:')

    setMailboxRead([])
    const empty = renderToStaticMarkup(await Page())
    expect(empty).toContain('Ingen aktiv Ediel-mailbox finns')
  })

  it('rejects access before any service request when the platform guard rejects', async () => {
    const denial = new Error('synthetic platform denial')
    requirePlatformAdminAccess.mockRejectedValueOnce(denial)
    await expect(Page()).rejects.toBe(denial)
    expect(fetchDiagnostics).not.toHaveBeenCalled()
  })
})
