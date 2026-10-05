// masterplan: TR-04, AT-TR-04, SC-062
import { createHash } from 'node:crypto'
import { beforeEach, expect, it, vi } from 'vitest'
import { processInboundEmailMessage } from '@/lib/inbound-mail/edielInboundProcessor'

const io = vi.hoisted(() => ({
  row: {} as Record<string, unknown>, attachments: [] as Record<string, unknown>[],
  calls: [] as string[], rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  intakeReads: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[], candidateError: false, observationError: false,
  tenant: vi.fn(() => { throw new Error('DSN must not resolve a business tenant') }),
  task: vi.fn(() => { throw new Error('DSN must not create a business task') }),
}))
vi.mock('@/lib/inbound-mail/inboundTenantResolver', () => ({ resolveTenantForInboundEdiel: io.tenant }))
vi.mock('@/lib/inbound-mail/inboundTaskFactory', () => ({ createInboundMailTask: io.task }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from: (table: string) => {
    io.calls.push(table)
    if (!['inbound_email_messages', 'inbound_email_attachments'].includes(table)) throw new Error(`Unexpected business/ACK/AI DB port: ${table}`)
    const query = {
      select: () => query, eq: () => query, order: () => query, limit: () => query,
      update: (delta: Record<string, unknown>) => { io.updates.push(delta); return query },
      maybeSingle: async () => ({ data: io.row, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === 'inbound_email_attachments' ? io.attachments : null, error: null }).then(resolve),
    }
    return query
  },
  rpc: (name: string, args: Record<string, unknown>) => {
    if (name === 'ediel_read_unattributed_technical_intake_v1') {
      io.intakeReads.push(args)
      return Promise.resolve({ data: null, error: null })
    }
    io.rpcCalls.push({ name, args })
    if (name === 'gridex_ediel_dsn_attempt_candidates_v1') return Promise.resolve({
      data: [{ attemptId: '00000000-0000-4000-8000-000000000011', messageId: '00000000-0000-4000-8000-000000000012', lane: 'generic_journal' }],
      error: io.candidateError ? { message: 'candidate read held' } : null,
    })
    if (name !== 'ediel_record_dsn_source_observation_v1') throw new Error(`Unexpected business/ACK/AI RPC: ${name}`)
    const input = args.p_input as Record<string, unknown>
    return Promise.resolve({ error: io.observationError ? { message: 'source write held' } : null, data: {
      version: 1, observationId: '00000000-0000-4000-8000-000000000010',
      attemptId: '00000000-0000-4000-8000-000000000011', messageId: '00000000-0000-4000-8000-000000000012',
      sourceHash: input.sourceHash, observedAt: '2026-10-04T18:00:00Z', transportCorrelation: 'source_matched_unverified',
      authorizesResend: false, deliveryProven: false,
    } })
  },
} }))

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const edi = "UNB+UNOC:3+S+R+261004:1200+ORIGINAL'UNH+1+PRODAT:D:96A:UN:E2SE6A'BGM+Z01+DOC1+9'UNT+3+1'UNZ+1+ORIGINAL'"
const status = 'Reporting-MTA: dns; fixture.invalid\r\n\r\nFinal-Recipient: rfc822; recipient@fixture.invalid\r\nAction: failed\r\nStatus: 5.1.1\r\nDiagnostic-Code: smtp; 550 synthetic refusal'
const headers = `Message-ID: <original@fixture.invalid>\r\nContent-Type: application/EDIFACT\r\n\r\n${edi}`
const source = (encoded: boolean) => [
  'Content-Type: multipart/report; report-type=delivery-status; boundary=dsn', '', '--dsn',
  'Content-Type: message/delivery-status', ...(encoded ? ['Content-Transfer-Encoding: base64'] : []), '',
  encoded ? Buffer.from(status).toString('base64') : status, '', '--dsn', 'Content-Type: message/rfc822',
  ...(encoded ? ['Content-Transfer-Encoding: base64'] : []), '', encoded ? Buffer.from(headers).toString('base64') : headers, '--dsn--', '',
].join('\r\n')
beforeEach(() => {
  vi.clearAllMocks(); io.calls = []; io.rpcCalls = []; io.updates = []; io.attachments = []
  io.intakeReads = []
  io.candidateError = false; io.observationError = false
  io.row = { id: uid(3), company_id: uid(1), ediel_mailbox_id: uid(4), environment: 'test',
    ediel_mailboxes: { id: uid(4), company_id: uid(1), environment: 'test', is_active: true },
    raw_email: edi, raw_edifact_payload: edi, body_text: 'AI;synthetic;fixture', processing_status: 'received' }
})

it.each(['raw_email', 'body_text', 'attachment'] as const)('quarantines valid attributed %s through actual parser/candidate/source/status owners', async field => {
  // The original EDIFACT and technical-list fallback are both present. Only
  // declared DB/RPC ports are finite fixtures; all DSN adapters execute.
  const raw = source(true), before = structuredClone(io.row)
  if (field === 'attachment') io.attachments = [{ id: uid(8), raw_text: raw, is_edifact_candidate: true, filename: 'dsn.eml' }]
  else io.row[field] = raw
  expect(await processInboundEmailMessage({ inboundEmailMessageId: uid(3), actorUserId: uid(2) })).toEqual({ status: 'manual_review', companyId: uid(1), parseResultId: null })
  expect(io.intakeReads).toEqual([{ p_inbound_email_message_id: uid(3), p_source_message_id: null, p_actor_user_id: uid(2) }])
  expect(io.rpcCalls.map(c => c.name)).toEqual(['gridex_ediel_dsn_attempt_candidates_v1', 'ediel_record_dsn_source_observation_v1'])
  expect(io.rpcCalls[0].args).toEqual({ p_company_id: uid(1), p_environment: 'test', p_mailbox_id: uid(4), p_rfc_message_id: '<original@fixture.invalid>', p_final_recipient: 'recipient@fixture.invalid' })
  expect(io.rpcCalls[1].args.p_input).toMatchObject({ companyId: uid(1), actorUserId: uid(2), inboundEmailMessageId: uid(3),
    sourceField: field, attachmentId: field === 'attachment' ? uid(8) : null, sourceHash: createHash('sha256').update(raw).digest('hex'),
    report: { originalMessageIds: ['<original@fixture.invalid>'], recipients: [{ finalRecipient: { type: 'rfc822', address: 'recipient@fixture.invalid' }, action: 'failed', status: '5.1.1', diagnosticCode: { type: 'smtp', text: '550 synthetic refusal' } }], issues: [] } })
  expect(io.updates).toHaveLength(1)
  expect(io.updates[0]).toMatchObject({ company_id: uid(1), processing_status: 'manual_review', match_status: 'dsn_transport_review',
    match_payload: { transportCorrelation: 'unverified', observationStatus: 'source_matched_unverified',
      sourceObservation: { attemptId: uid(11), messageId: uid(12), authorizesResend: false, deliveryProven: false } } })
  expect(io.calls).toEqual(field === 'attachment' ? ['inbound_email_messages', 'inbound_email_attachments', 'inbound_email_messages'] : ['inbound_email_messages', 'inbound_email_messages'])
  expect(io.row.raw_edifact_payload).toBe(before.raw_edifact_payload)
  expect(io.tenant).not.toHaveBeenCalled(); expect(io.task).not.toHaveBeenCalled()
})

it.each(['candidate', 'observation'] as const)('keeps transport quarantine when the %s port fails', async failure => {
  io.row.raw_email = source(false); io.candidateError = failure === 'candidate'; io.observationError = failure === 'observation'
  expect(await processInboundEmailMessage({ inboundEmailMessageId: uid(3), actorUserId: uid(2) })).toMatchObject({ status: 'manual_review', parseResultId: null })
  expect(io.intakeReads).toEqual([{ p_inbound_email_message_id: uid(3), p_source_message_id: null, p_actor_user_id: uid(2) }])
  expect(io.rpcCalls).toHaveLength(failure === 'candidate' ? 1 : 2)
  expect(io.updates[0]).toMatchObject({ match_status: 'dsn_transport_review', match_payload: { sourceObservation: null,
    observationStatus: failure === 'candidate' ? 'not_qualified' : 'source_observation_held' } })
  expect(io.tenant).not.toHaveBeenCalled(); expect(io.task).not.toHaveBeenCalled()
})
