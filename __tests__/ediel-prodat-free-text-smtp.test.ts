import { beforeEach, expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { raw, line, type Parts } from './fixtures/prodat-register'
import { head } from './fixtures/prodat-identity'

const io = vi.hoisted(() => ({ effects: [] as string[] }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from: () => { io.effects.push('db'); throw new Error('UNEXPECTED_DATABASE_BOUNDARY') },
  rpc: () => { io.effects.push('rpc'); throw new Error('UNEXPECTED_RPC_BOUNDARY') },
} }))
vi.mock('@/lib/email/sendEdielEmail', () => ({ sendEdielEmail: () => {
  io.effects.push('provider'); throw new Error('UNEXPECTED_PROVIDER_BOUNDARY')
} }))
import { sendEdielMessageViaSmtp } from '@/lib/ediel/transport'

beforeEach(() => { io.effects = [] })
for (const code of ['Z01', 'Z13', 'Z14', 'Z15', 'Z18']) {
  for (const label of ['PRODAT', 'APERAK']) it(`actual SMTP blocks invalid FTX ${code}/${label} before route/context I/O`, async () => {
    const body: Parts[] = [...head(), line('1', '735123456789012345', undefined, '9'), ['FTX', 'ACB', '', '', ['X'.repeat(71)]]]
    const message = {
      id: '00000000-0000-4000-8000-000000000001', company_id: '00000000-0000-4000-8000-000000000002',
      direction: 'outbound', environment: 'test', message_standard: 'edifact', message_family: label, message_code: 'Z01',
      receiver_email: 'synthetic@example.invalid', communication_route_id: '00000000-0000-4000-8000-000000000003',
      raw_payload: raw(body, code), parsed_payload: { rulebookAllowInvalidSend: true, prodatEngine: { registerEvidence: { invalid: true } } },
    } as unknown as EdielMessageRow
    await expect(sendEdielMessageViaSmtp(message, { actorUserId: '00000000-0000-4000-8000-000000000004' })).rejects.toThrow('PRODAT_FTX_')
    expect(io.effects).toEqual([])
  })
}

for (const text of [false, true]) it(`valid optional FTX=${text} reaches the existing route boundary without a new text hold`, async () => {
  const body: Parts[] = [...head(), line('1', '735123456789012345', undefined, '9'), ...(text ? [['FTX', 'ACB', '', '', ['VALID TEXT']] as Parts] : [])]
  const message = {
    id: '00000000-0000-4000-8000-000000000001', company_id: '00000000-0000-4000-8000-000000000002',
    direction: 'outbound', environment: 'test', message_standard: 'edifact', message_family: 'PRODAT', message_code: 'Z01',
    receiver_email: 'synthetic@example.invalid', communication_route_id: '00000000-0000-4000-8000-000000000003',
    raw_payload: raw(body, 'Z01'), parsed_payload: {},
  } as unknown as EdielMessageRow
  const before = message.raw_payload
  await expect(sendEdielMessageViaSmtp(message, { actorUserId: '00000000-0000-4000-8000-000000000004' })).rejects.toThrow('UNEXPECTED_DATABASE_BOUNDARY')
  expect(io.effects).toEqual(['db'])
  expect(message.raw_payload).toBe(before)
})
