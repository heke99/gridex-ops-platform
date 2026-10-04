// masterplan: TR-01, AT-TR-01
import { beforeEach, expect, it, vi } from 'vitest'
import { assertNoTgtLeakageInProductionMessage, evaluateEdielProductionSendLock } from '@/lib/ediel/core/productionGuards'
import type { EdielMessageRow } from '@/lib/ediel/types'

const io = vi.hoisted(() => ({ rpc: vi.fn(), provider: vi.fn(), from: vi.fn(), filters: [] as unknown[][],
  portals: [] as { company_id: string; environment: string; is_active: boolean; role: string; email: string; email_address?: string }[], readError: null as Error | null }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.rpc, from: io.from } }))
vi.mock('@/lib/email/sendEdielEmail', () => ({ sendEdielEmail: io.provider }))
import { sendEdielMessageViaSmtp } from '@/lib/ediel/transport/index.part-2'

const message = (email: string) => ({ id: 'recipient-boundary', company_id: 'own-company',
  environment: 'production', direction: 'outbound', status: 'queued', test_flag: 0,
  message_family: 'PRODAT', message_code: 'Z13', message_version: 'E2SE6A', message_standard: 'edifact',
  sender_ediel_id: '21660', receiver_ediel_id: '54321', receiver_email: email,
  application_reference: '23-DGI-PRODAT', communication_route_id: 'manual-counterparty-route', raw_payload: 'UNCHANGED-SYNTHETIC-ORIGINAL',
} as EdielMessageRow)

beforeEach(() => {
  vi.clearAllMocks()
  io.filters = []; io.portals = []; io.readError = null
  io.from.mockImplementation((table: string) => {
    if (table !== 'ediel_counterparties') throw new Error('unexpected tenant read')
    const query = { select: vi.fn(() => query), eq: (key: string, value: unknown) => { io.filters.push([key, value]); return query },
      or: async () => ({ error: io.readError, data: io.portals.filter(row => io.filters.every(([key, value]) => row[key as keyof typeof row] === value) && row.role === 'test_portal') }) }
    return query
  })
  // Existing accepted-receipt lookup is a read-only port. Other authority
  // callers are rejected, so the fixture cannot authorize a production send.
  io.rpc.mockImplementation(async (name: string) => name === 'gridex_ediel_accepted_transport_projection_v1'
    ? { data: null, error: null } : { data: null, error: new Error('unexpected authority call') })
})

it.each(['91100@ediel.se', '91109@ediel.se', ' PORTAL@EDIEL.SE ', 'Portal <91100@ediel.se>', 'dso@example.invalid, 91100@ediel.se',
  '91100@ediel.se(Portal)', 'Portal <91100@ediel.se(Portal)>', 'Group: dso@example.invalid, 91100@ediel.se;'])
  ('TR-01 blocks actual portal SMTP recipient %s despite real-party production addressing', async email => {
    const row = message(email), original = structuredClone(row)
    expect(evaluateEdielProductionSendLock(row).issues).toContainEqual(expect.objectContaining({ code: 'ediel_portal_email_in_production', severity: 'blocked' }))
    expect(() => assertNoTgtLeakageInProductionMessage(row)).toThrow(/TGT/)
    await expect(sendEdielMessageViaSmtp(row, { actorUserId: 'own-actor' })).rejects.toThrow(/ediel_portal_email_in_production/)
    expect(io.provider).not.toHaveBeenCalled()
    expect(io.rpc.mock.calls.every(([name]) => name === 'gridex_ediel_accepted_transport_projection_v1')).toBe(true)
    expect(row).toEqual(original)
  })

it.each(['dso@example.invalid', '91100@ediel.se.example.invalid', '"Operations @ediel.se support" <dso@example.invalid>'])('TR-01 retains ordinary counterparty destination %s', async email => {
  expect(evaluateEdielProductionSendLock(message(email)).locked).toBe(false)
  expect(() => assertNoTgtLeakageInProductionMessage(message(email))).not.toThrow()
  await expect(sendEdielMessageViaSmtp(message(email), { actorUserId: 'own-actor' })).rejects.not.toThrow(/ediel_portal_email_in_production/)
})

it('TR-01 blocks the configured tenant portal alias outside the standard portal domain', async () => {
  io.portals = [{ company_id: 'own-company', environment: 'test', is_active: true, role: 'test_portal', email: 'Portal <Custom@portal.example.invalid>' }]
  const row = message('custom@portal.example.invalid (Portal)'), original = structuredClone(row)
  await expect(sendEdielMessageViaSmtp(row, { actorUserId: 'own-actor' })).rejects.toThrow(/ediel_portal_email_in_production/)
  expect(io.provider).not.toHaveBeenCalled()
  expect(io.filters).toEqual(expect.arrayContaining([['company_id', 'own-company'], ['environment', 'test'], ['is_active', true]]))
  expect(io.rpc.mock.calls.every(([name]) => name === 'gridex_ediel_accepted_transport_projection_v1')).toBe(true)
  expect(row).toEqual(original)
})

it('TR-01 does not read another tenant or inactive portal as own production recipient policy', async () => {
  io.portals = [
    { company_id: 'other-company', environment: 'test', is_active: true, role: 'test_portal', email: 'dso@example.invalid' },
    { company_id: 'own-company', environment: 'test', is_active: false, role: 'test_portal', email: 'dso@example.invalid' },
  ]
  await expect(sendEdielMessageViaSmtp(message('dso@example.invalid'), { actorUserId: 'own-actor' })).rejects.not.toThrow(/ediel_portal_email_in_production/)
  expect(io.filters).toContainEqual(['company_id', 'own-company'])
  expect(io.provider).not.toHaveBeenCalled()
})

it('TR-01 holds a production send when the configured portal policy cannot be read', async () => {
  io.readError = new Error('synthetic portal policy unavailable')
  await expect(sendEdielMessageViaSmtp(message('dso@example.invalid'), { actorUserId: 'own-actor' })).rejects.toThrow(/portal policy unavailable/)
  expect(io.provider).not.toHaveBeenCalled()
})

it('TR-01 retains the explicit test-environment portal destination', () => {
  const row = { ...message('91100@ediel.se'), environment: 'test' as const }
  expect(evaluateEdielProductionSendLock(row).locked).toBe(false)
  expect(() => assertNoTgtLeakageInProductionMessage(row)).not.toThrow()
})
