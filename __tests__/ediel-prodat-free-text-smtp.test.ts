import { beforeEach, expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { raw, line, alphabets, type Parts } from './fixtures/prodat-register'
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

// Review5753067624: leading APERAK must not hide the first PRODAT from the
// pure pre-I/O hold. This is a single interchange, not concatenated UNAs.
for (const alphabet of alphabets) for (const label of ['APERAK', 'PRODAT']) {
  it(`leading APERAK cannot bypass actual SMTP FTX hold ${label}/${alphabet.join('')}`, async () => {
    const [c, e, , t] = alphabet
    const prodat = raw([...head(), line('1', '735123456789012345', undefined, '9'), ['FTX', 'ACB', '', '', ['X'.repeat(71)]]], 'Z01', alphabet)
    const offset = prodat.indexOf(`UNH${e}`)
    const leading = [
      `UNH${e}A${e}APERAK${c}D${c}96A${c}UN${c}E2SE6A`, `BGM${e}11${e}ACK${e}9`,
      `DTM${e}137${c}202609201200${c}203`, `RFF${e}ACW${c}ORIGINAL`, `ERC${e}100`, `UNT${e}6${e}A`,
    ].join(t) + t
    const payload = (prodat.slice(0, offset) + leading + prodat.slice(offset)).replace(`UNZ${e}1${e}I${t}`, `UNZ${e}2${e}I${t}`)
    const message = {
      id: '00000000-0000-4000-8000-000000000001', company_id: '00000000-0000-4000-8000-000000000002',
      direction: 'outbound', environment: 'test', message_standard: 'edifact', message_family: label, message_code: 'ERR',
      receiver_email: 'synthetic@example.invalid', communication_route_id: '00000000-0000-4000-8000-000000000003',
      raw_payload: payload, parsed_payload: { rulebookAllowInvalidSend: true },
    } as unknown as EdielMessageRow
    await expect(sendEdielMessageViaSmtp(message, { actorUserId: '00000000-0000-4000-8000-000000000004' })).rejects.toThrow('PRODAT_FTX_')
    expect(io.effects).toEqual([])
    expect(message.raw_payload).toBe(payload)
  })
}
