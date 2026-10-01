import {transportJournalFixture} from './fixtures/ediel-transport-journal'
import { beforeEach, expect, it, vi } from 'vitest'
import { closureFixture } from './helpers/closureWireFixtures'
import type { EdielMessageRow } from '@/lib/ediel/types'

const io = vi.hoisted(() => ({
  provider: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.rpc } }))
vi.mock('@/lib/email/sendEdielEmail', () => ({
  sendEdielEmail: async (_input: unknown, entry?: import('@/lib/email/sendEdielEmail').EdielProviderEntry) => {
    await journal.beforeProvider(_input as import('@/lib/email/sendEdielEmail').SendEdielEmailInput,entry)
    io.provider()
    return { accepted: ['receiver@example.invalid'], rejected: [], messageId: 'synthetic' }
  },
}))

let journal:ReturnType<typeof transportJournalFixture>
beforeEach(() => {
 journal=transportJournalFixture()
  vi.clearAllMocks()
  // This is the old SQL result for a stale non-Z08 row code and a malformed
  // raw Z08 body. The real SQL boundary is exercised by the native companion.
  io.rpc.mockImplementation(async(name,args)=>name==='gridex_outbound_dispatch_v1'?{data:{scoped:false},error:null}:journal.rpc(name,args))
})

it('holds a potential Z08 before SMTP when the database does not scope its original', async () => {
  const { sendCorrectionFencedEmail } = await import('@/lib/ediel/sources/correctionOutboundDispatch')
  const raw = closureFixture({ reason: 'Z25' }).wire.replace('BGM+Z05', 'BGM+Z08').slice(0, -1)
  const message = {
    id: '00000000-0000-4000-8000-000000000001', company_id: '00000000-0000-4000-8000-000000000002',
    environment: 'test', direction: 'outbound', message_family: 'PRODAT', message_code: 'Z01', raw_payload: raw,
  } as EdielMessageRow

  await expect(sendCorrectionFencedEmail(
    { from:'sender@example.invalid',to: 'receiver@example.invalid', subject: 'synthetic' },
    { message, actorUserId: '00000000-0000-4000-8000-000000000003', mimeMode: 'synthetic',
      payload: Buffer.from(raw, 'utf8'), encoding: 'latin1' },
  )).rejects.toThrow('outbound_dispatch_scope_mismatch')
  expect(io.provider).not.toHaveBeenCalled()
})

it('journals a valid non-Z08 outbound PRODAT before its provider entry', async () => {
  const { sendCorrectionFencedEmail } = await import('@/lib/ediel/sources/correctionOutboundDispatch')
  const raw = closureFixture().wire.replace('BGM+Z05', 'BGM+Z03')
  const message = {
    id: '00000000-0000-4000-8000-000000000004', company_id: '00000000-0000-4000-8000-000000000002',
    environment: 'test', direction: 'outbound', message_family: 'PRODAT', message_code: 'Z03', raw_payload: raw,
  } as EdielMessageRow

  await expect(sendCorrectionFencedEmail(
    { from:'sender@example.invalid',to: 'receiver@example.invalid', subject: 'synthetic' },
    { message, actorUserId: '00000000-0000-4000-8000-000000000003', mimeMode: 'synthetic',
      payload: Buffer.from(raw, 'utf8'), encoding: 'latin1' },
  )).resolves.toMatchObject({ accepted: ['receiver@example.invalid'] })
  expect(io.provider).toHaveBeenCalledOnce()
  expect(journal.actions).toEqual(['prepare','enter','observe'])
})

it('journals a canonical Z08 LK exemption without weakening the sealed H lane', async () => {
  io.rpc.mockImplementation(async(name,args)=>name==='gridex_outbound_dispatch_v1'?{data:{scoped:false,unscopedReason:'canonical_lk_exemption'},error:null}:journal.rpc(name,args))
  const { sendCorrectionFencedEmail } = await import('@/lib/ediel/sources/correctionOutboundDispatch')
  const raw = closureFixture({ reason: 'Z23' }).wire.replace('BGM+Z05', 'BGM+Z08')
  const message = {
    id: '00000000-0000-4000-8000-000000000005', company_id: '00000000-0000-4000-8000-000000000002',
    environment: 'test', direction: 'outbound', message_family: 'PRODAT', message_code: 'Z08', raw_payload: raw,
    rule_profile_key: 'PRODAT:Z08:LK:26.A:r3',
  } as EdielMessageRow

  await expect(sendCorrectionFencedEmail(
    { from:'sender@example.invalid',to: 'receiver@example.invalid', subject: 'synthetic' },
    { message, actorUserId: '00000000-0000-4000-8000-000000000003', mimeMode: 'synthetic',
      payload: Buffer.from(raw, 'utf8'), encoding: 'latin1' },
  )).resolves.toMatchObject({ accepted: ['receiver@example.invalid'] })
  expect(io.provider).toHaveBeenCalledOnce()
  expect(journal.actions).toEqual(['prepare','enter','observe'])
})

it('holds an entered unknown generic attempt on retry without another provider call',async()=>{
 const {sendCorrectionFencedEmail}=await import('@/lib/ediel/sources/correctionOutboundDispatch')
 const raw=closureFixture().wire.replace('BGM+Z05','BGM+Z03')
 const message={id:'00000000-0000-4000-8000-000000000006',company_id:'00000000-0000-4000-8000-000000000002',environment:'test',direction:'outbound',message_family:'PRODAT',message_code:'Z03',raw_payload:raw} as EdielMessageRow
 io.provider.mockImplementation(()=>{throw Error('connection response lost after provider entry')})
 const send=()=>sendCorrectionFencedEmail({from:'sender@example.invalid',to:'receiver@example.invalid',subject:'synthetic'}, {message,actorUserId:'00000000-0000-4000-8000-000000000003',mimeMode:'synthetic',payload:Buffer.from(raw,'utf8'),encoding:'latin1'})
 await expect(send()).rejects.toMatchObject({code:'ediel_delivery_uncertain'})
 await expect(send()).rejects.toMatchObject({code:'ediel_delivery_uncertain'})
 expect(io.provider).toHaveBeenCalledOnce()
 expect(journal.actions).toEqual(['prepare','enter','observe','prepare'])
})
