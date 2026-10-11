// masterplan: TR-09, AT-TR-09
// T A.3.2.1 administrator alarm consumer: the protected alarm journal reaches an
// own-company operator page through the existing actor-checked RPC. The native
// owner/ACL proof is scripts/ediel-tr-09-reserve-source-native.test.ts.
import {renderToStaticMarkup} from 'react-dom/server'
import {beforeEach, describe, expect, it, vi} from 'vitest'

const company = '11111111-1111-4111-8111-111111111111'
const foreign = '22222222-2222-4222-8222-222222222222'
const actor = '33333333-3333-4333-8333-333333333333'
const reviewer = '44444444-4444-4444-8444-444444444444'
const io = vi.hoisted(() => ({
  rpc: vi.fn(),
  guard: {userId: '', companyId: '' as string | null, permissions: [] as string[], isPlatformAdmin: false},
  required: [] as unknown[],
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({supabaseService: {rpc: io.rpc}}))
vi.mock('@/lib/admin/guards', () => ({requireAdminPageAccess: async (requirement: unknown) => {io.required.push(requirement); return io.guard}}))

import {readEdielTransportExceptionAlarms} from '@/lib/ediel/transport/exception/administratorAlarms'
import Page from '@/app/admin/ediel/transport-exception-alarms/page'
import {getAdminNavigationGroups} from '@/lib/admin/navigation'

const row = (n: number, kase: string) => ({
  id: `aaaaaaaa-aaaa-4aaa-8aaa-00000000000${n}`,
  attemptId: `bbbbbbbb-bbbb-4bbb-8bbb-00000000000${n}`,
  messageId: `cccccccc-cccc-4ccc-8ccc-00000000000${n}`,
  responsibleUserId: reviewer,
  createdAt: `2026-10-10T10:0${n}:00Z`,
  facts: {case: kase, sourceDigest: 'a'.repeat(64), approvalDigest: 'b'.repeat(64), tlsEvidenceDigest: 'c'.repeat(64),
    mandatoryTls: true, validTo: '2026-10-11T10:00:00Z', administratorAlarm: true},
})
const bothCases = [row(1, 'recipient_certificate_unavailable'), row(2, 'crl_refresh_failure')]
const render = async () => renderToStaticMarkup(await Page())

beforeEach(() => {
  io.rpc.mockReset()
  io.required = []
  io.guard = {userId: actor, companyId: company, permissions: ['communication.write'], isPlatformAdmin: false}
})

describe('administrator alarm loader', () => {
  it('reads both reserve-case alarms for exactly the current company and actor', async () => {
    io.rpc.mockResolvedValue({data: bothCases, error: null})
    const alarms = await readEdielTransportExceptionAlarms({companyId: company, actorUserId: actor})
    expect(io.rpc).toHaveBeenCalledExactlyOnceWith('ediel_transport_exception_alarms_v1', {p_company_id: company, p_actor_user_id: actor})
    expect(alarms.map((a) => [a.reserveCase, a.knownReserveCase, a.responsibleUserId, a.validTo])).toEqual([
      ['recipient_certificate_unavailable', true, reviewer, '2026-10-11T10:00:00Z'],
      ['crl_refresh_failure', true, reviewer, '2026-10-11T10:00:00Z'],
    ])
  })

  it('propagates a foreign or unauthorized refusal instead of returning no alarms', async () => {
    io.rpc.mockResolvedValue({data: null, error: {code: '42501', message: 'transport_exception_current_actor_required'}})
    await expect(readEdielTransportExceptionAlarms({companyId: foreign, actorUserId: actor})).rejects.toMatchObject({code: '42501'})
  })

  it('refuses malformed identifiers before calling the protected RPC', async () => {
    await expect(readEdielTransportExceptionAlarms({companyId: 'not-a-uuid', actorUserId: actor})).rejects.toThrow()
    await expect(readEdielTransportExceptionAlarms({companyId: company, actorUserId: ''})).rejects.toThrow()
    expect(io.rpc).not.toHaveBeenCalled()
  })

  it.each([
    ['a non-alarm journal row', {...bothCases[0], facts: {...bothCases[0].facts, administratorAlarm: false}}],
    ['a row without mandatory TLS', {...bothCases[0], facts: {...bothCases[0].facts, mandatoryTls: false}}],
    ['an unexpected column', {...bothCases[0], rawPayload: 'UNB+...'}],
  ])('rejects %s rather than presenting it', async (_label, bad) => {
    io.rpc.mockResolvedValue({data: [bad], error: null})
    await expect(readEdielTransportExceptionAlarms({companyId: company, actorUserId: actor})).rejects.toThrow()
  })

  it('rejects two alarms for one operation attempt (one alarm per bounded attempt)', async () => {
    io.rpc.mockResolvedValue({data: [bothCases[0], {...bothCases[1], attemptId: bothCases[0].attemptId}], error: null})
    await expect(readEdielTransportExceptionAlarms({companyId: company, actorUserId: actor})).rejects.toThrow('ediel_transport_exception_alarm_duplicate_attempt')
  })

  it('keeps an unknown case visible and flagged instead of hiding it', async () => {
    io.rpc.mockResolvedValue({data: [row(3, 'future_case')], error: null})
    expect((await readEdielTransportExceptionAlarms({companyId: company, actorUserId: actor}))[0]).toMatchObject({reserveCase: 'future_case', knownReserveCase: false})
  })
})

describe('administrator alarm page', () => {
  it('requires communication.write and shows both reserve cases to the administrator', async () => {
    io.rpc.mockResolvedValue({data: bothCases, error: null})
    const html = await render()
    expect(io.required).toEqual([{allOf: ['communication.write']}])
    expect(io.rpc).toHaveBeenCalledExactlyOnceWith('ediel_transport_exception_alarms_v1', {p_company_id: company, p_actor_user_id: actor})
    expect(html).toContain('Mottagarcertifikat saknas (tom X.500-sökning)')
    expect(html).toContain('Spärrlistan kunde inte hämtas (föregående signerade CRL används)')
    expect(html).toContain(bothCases[0].messageId)
    expect(html).not.toContain('a'.repeat(64))
    expect(html).not.toContain('Inga larm')
  })

  it('fails closed: a refused or broken feed is an alert, never "no alarms"', async () => {
    io.rpc.mockResolvedValue({data: null, error: {code: '42501', message: 'transport_exception_current_actor_required'}})
    const html = await render()
    expect(html).toContain('role="alert"')
    expect(html).not.toContain('Inga larm')
  })

  it('does not query without a selected company', async () => {
    io.guard = {...io.guard, companyId: null}
    const html = await render()
    expect(io.rpc).not.toHaveBeenCalled()
    expect(html).toContain('Välj ett bolag')
  })

  it('shows an honest empty state only after a successful read', async () => {
    io.rpc.mockResolvedValue({data: [], error: null})
    expect(await render()).toContain('Inga larm för reservförfarande.')
  })
})

describe('administrator alarm navigation', () => {
  const hrefs = (permissions: string[]) => getAdminNavigationGroups({permissions, roles: ['company_admin'], isPlatformAdmin: false})
    .flatMap((group) => group.items.map((item) => item.href))
  it('is discoverable for a tenant administrator with communication.write and hidden without it', () => {
    expect(hrefs(['communication.write'])).toContain('/admin/ediel/transport-exception-alarms')
    expect(hrefs(['communication.read'])).not.toContain('/admin/ediel/transport-exception-alarms')
  })
})
