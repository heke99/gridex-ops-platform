import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Page from '@/app/admin/ediel/mailboxes/page'

const { fetchMailboxes, requirePlatformAdminAccess } = vi.hoisted(() => ({
  fetchMailboxes: vi.fn<typeof fetch>(),
  requirePlatformAdminAccess: vi.fn(),
}))

vi.mock('@/lib/admin/guards', () => ({ requirePlatformAdminAccess }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: () => null }))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient: createSupabaseClient } = await vi.importActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js')
  return {
    supabaseService: createSupabaseClient('https://mailboxes.test', 'synthetic-service-key', {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: fetchMailboxes },
    }),
  }
})

const attemptAt = '2026-11-18T09:01:00Z'
const successAt = '2026-11-18T09:05:00Z'

function mailbox(name: string, fields: Record<string, unknown> = {}) {
  return {
    id: name,
    email_address: `${name}@mailboxes.test`,
    is_active: true,
    tls_required: true,
    security_status: 'not_checked',
    last_polled_at: null,
    last_error: null,
    ...fields,
  }
}

async function renderMailboxPage(rows: ReturnType<typeof mailbox>[]) {
  fetchMailboxes.mockResolvedValueOnce(new Response(JSON.stringify(rows), {
    headers: { 'Content-Type': 'application/json' },
  }))
  return renderToStaticMarkup(await Page())
}

function mailboxRow(html: string, name: string) {
  const row = html.match(/<tr\b[^>]*>.*?<\/tr>/g)?.find((candidate) => candidate.includes(`${name}@mailboxes.test`))
  expect(row).toBeDefined()
  return row!
}

function expectStatus(row: string, label: string, tone: 'slate' | 'emerald' | 'amber') {
  expect(row).toMatch(new RegExp(`<div class="[^"]+text-${tone}-\\d+[^"]*">${label}</div>`))
}

beforeEach(() => {
  vi.stubGlobal('React', React)
  requirePlatformAdminAccess.mockReset().mockResolvedValue({ email: 'admin@mailboxes.test' })
  fetchMailboxes.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Ediel mailbox status page', () => {
  it('uses the existing platform-scoped read and distinguishes activation and configuration from checks', async () => {
    const html = await renderMailboxPage([
      mailbox('attempt', { last_polled_at: attemptAt }),
      mailbox('configured', { security_status: 'private_certificate_configured' }),
      mailbox('needs-certificate', { security_status: 'receiver_certificate_on_route_required' }),
      mailbox('unchecked', { security_status: 'synthetic-unrecognized-security-status', tls_required: false }),
      mailbox('test-exception', { security_status: 'test_unencrypted_allowed', environment: 'test' }),
      mailbox('production', { security_status: 'test_unencrypted_allowed', environment: 'production' }),
    ])

    expect(requirePlatformAdminAccess).toHaveBeenCalledOnce()
    expect(fetchMailboxes).toHaveBeenCalledOnce()
    const [url, init] = fetchMailboxes.mock.calls[0]
    const request = new URL(String(url))
    expect(request.pathname).toBe('/rest/v1/ediel_mailboxes')
    expect(Object.fromEntries(request.searchParams)).toEqual({ select: '*', order: 'email_address.asc', limit: '100' })
    expect(init?.method).toBe('GET')

    const attempted = mailboxRow(html, 'attempt')
    expectStatus(attempted, 'Aktiv', 'slate')
    expectStatus(attempted, 'Säkerhetsstatus okänd', 'slate')
    expectStatus(attempted, 'Pollresultat okänt', 'slate')
    expectStatus(attempted, 'TLS krävs', 'slate')
    expect(attempted).not.toContain('text-emerald-')
    expect(attempted).not.toContain('Öppna polldiagnostik')
    expect(attempted).toMatch(/Senaste pollförsök: [^—<]/)
    expect(attempted).toContain('Senaste lyckade poll: —')

    expectStatus(mailboxRow(html, 'configured'), 'Certifikat konfigurerat', 'slate')
    expectStatus(mailboxRow(html, 'needs-certificate'), 'Mottagarcertifikat krävs på rutten', 'amber')
    expectStatus(mailboxRow(html, 'unchecked'), 'Säkerhetsstatus okänd', 'slate')
    expectStatus(mailboxRow(html, 'unchecked'), 'TLS ej krav', 'amber')
    expectStatus(mailboxRow(html, 'test-exception'), 'Okrypterat tillåtet i test', 'slate')
    expectStatus(mailboxRow(html, 'production'), 'Säkerhetsstatus okänd', 'slate')
    expect(html).not.toContain('synthetic-unrecognized-security-status')
  })

  it('prioritizes explicit poll failures and only marks a confirmed current success green', async () => {
    const rawError = 'synthetic raw connection detail'
    const html = await renderMailboxPage([
      mailbox('failed', { last_error: rawError, last_polled_at: attemptAt, last_successful_poll_at: successAt }),
      mailbox('legacy-failed', { last_poll_status: 'failed', last_poll_at: attemptAt, last_successful_poll_at: successAt }),
      mailbox('confirmed', { last_polled_at: attemptAt, last_successful_poll_at: successAt }),
      mailbox('new-attempt', { last_polled_at: '2026-11-18T10:01:00Z', last_successful_poll_at: successAt }),
      mailbox('invalid-date', { last_polled_at: attemptAt, last_successful_poll_at: 'invalid', last_poll_status: 'ok' }),
      mailbox('locked', { last_polled_at: successAt, last_successful_poll_at: successAt, locked_at: successAt }),
      mailbox('new-legacy-attempt', { last_polled_at: attemptAt, last_poll_at: '2026-11-18T10:01:00Z', last_successful_poll_at: successAt }),
      mailbox('unknown-activation', { is_active: null, last_polled_at: attemptAt, last_successful_poll_at: successAt }),
      mailbox('inactive', { is_active: false, last_polled_at: attemptAt, last_successful_poll_at: successAt }),
    ])

    for (const name of ['failed', 'legacy-failed']) {
      const failed = mailboxRow(html, name)
      expectStatus(failed, 'Pollning misslyckades', 'amber')
      expect(failed).toMatch(/href="\/admin\/inbound-mail\/diagnostics">Öppna polldiagnostik<\/a>/)
    }
    expect(html).not.toContain(rawError)
    expectStatus(mailboxRow(html, 'confirmed'), 'Senaste poll lyckades', 'emerald')
    expectStatus(mailboxRow(html, 'new-attempt'), 'Pollresultat okänt', 'slate')
    expectStatus(mailboxRow(html, 'invalid-date'), 'Pollresultat okänt', 'slate')
    expectStatus(mailboxRow(html, 'locked'), 'Pollresultat okänt', 'slate')
    expectStatus(mailboxRow(html, 'new-legacy-attempt'), 'Pollresultat okänt', 'slate')
    expectStatus(mailboxRow(html, 'unknown-activation'), 'Aktivering okänd', 'slate')
    expectStatus(mailboxRow(html, 'unknown-activation'), 'Pollresultat okänt', 'slate')
    const inactive = mailboxRow(html, 'inactive')
    expectStatus(inactive, 'Inaktiv', 'slate')
    expectStatus(inactive, 'Pollning inaktiv', 'slate')
    expect(inactive).not.toContain('Senaste poll lyckades')
  })

  it('flags a stored failed security check and gives the operator a corrective action', async () => {
    const html = await renderMailboxPage([
      mailbox('security-failed', { security_status: 'failed' }),
      mailbox('security-unknown', { security_status: 'OKÄND' }),
    ])

    const failed = mailboxRow(html, 'security-failed')
    expectStatus(failed, 'Säkerhetskontrollen misslyckades', 'amber')
    expect(failed).toMatch(/href="\/admin\/ediel\/certificates">Kontrollera Ediel-certifikaten<\/a>/)
    expect(failed).not.toContain('text-emerald-')

    const unknown = mailboxRow(html, 'security-unknown')
    expectStatus(unknown, 'Säkerhetsstatus okänd', 'slate')
    expect(unknown).not.toContain('Kontrollera Ediel-certifikaten')
  })

  it('keeps the protected entry point and empty result', async () => {
    const denial = new Error('Synthetic platform access denial')
    requirePlatformAdminAccess.mockRejectedValueOnce(denial)
    await expect(Page()).rejects.toBe(denial)
    expect(fetchMailboxes).not.toHaveBeenCalled()

    const html = await renderMailboxPage([])
    expect(html).toContain('Inga mailboxes hittades.')
  })
})
