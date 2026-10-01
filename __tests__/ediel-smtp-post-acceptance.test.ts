import {transportJournalFixture} from './fixtures/ediel-transport-journal'
import {closureFixture} from './helpers/closureWireFixtures'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sendEdielMessageViaSmtp } from '@/lib/ediel/transport/index.part-2'
import { SmtpDeliveryUncertainError } from '@/lib/ediel/transport/smtpOutcome'
import type { EdielMessageRow } from '@/lib/ediel/types'

const mocks = vi.hoisted(() => ({ send: vi.fn(), status: vi.fn(), event: vi.fn(), auditError: null as Error | null,repairError:null as Error|null,rpc:vi.fn(),
 snapshot:{profileKey:'PRODAT:Z01:L:26.A:r3',profileVersionId:'00000000-0000-4000-8000-000000000097',version:'26.A:r3',checksum:'a'.repeat(64)} }))
vi.mock('@/lib/ediel/db', () => ({ updateEdielMessageStatus: mocks.status, createEdielMessageEvent: mocks.event, getEdielRouteProfileByCommunicationRouteId: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/email/sendEdielEmail', () => ({ sendEdielEmail: mocks.send }))
vi.mock('@/lib/ediel/mailReadiness', () => ({ assertEdielSmtpReadiness: () => ({ from: 'sender@example.test' }) }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {rpc:mocks.rpc, from: () => {const q={update:()=>q,eq:()=>q,then:(resolve:(r:{error:Error|null})=>unknown)=>Promise.resolve({error:mocks.auditError}).then(resolve)};return q} } }))
vi.mock('@/lib/ediel/transport/index.part-1', () => ({
  requireActorUserId: () => '00000000-0000-4000-8000-000000000003', assertTransportFamily: vi.fn(),
  encryptionModeFromMimeMode: () => 'none', applyMessageFamilyEncryptionPolicy: () => 'none', assertRouteTransportSecurity: vi.fn(),
  inferAttachmentExtension: () => 'edi', inferBodyText: () => "UNB+original'", resolveSmtpMimeMode: () => 'nodemailer-attachment',
  isEdifactMessage: () => true, normalizeEdifactForSmtp: (s: string) => s, extractEdielSubjectFromPayload: () => 'TEST',
  safePreview: (s: string) => s, storeTransportPayloadSnapshot: vi.fn().mockResolvedValue(undefined),
}))

// Admission is mocked for this persistence-only unit; the shared canonical
// policy still builds/seals/registers the real Z01 expectation plan.
vi.mock('@/lib/ediel/rulebook/sendGuards',async()=>{
 const {resolveCanonicalEdielPolicy}=await import('@/lib/ediel/rulebook/canonicalEdielPolicy')
 const admission=(message:EdielMessageRow)=>{
  expect(message).toMatchObject({id:'00000000-0000-4000-8000-000000000001',company_id:'00000000-0000-4000-8000-000000000002',environment:'test',direction:'outbound',message_family:'PRODAT',message_code:'Z01'})
  expect(message.raw_payload).toBe(raw)
  return{rulePackSnapshot:mocks.snapshot,canonicalPolicy:resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:'Z01',subtypeOrReasonCode:'Z22',direction:'outbound',referenceDate:'2026-09-30',applicationReference:'23-DDQ-PRODAT'})}
 }
 return{assertRulebookAllowsSend:admission,assertRegistryRulebookAllowsSend:async(message:EdielMessageRow)=>admission(message)}
})
let journal:ReturnType<typeof transportJournalFixture>
const uid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const raw=closureFixture({reason:'Z22'}).wire.replace('BGM+Z05','BGM+Z01')

describe('SMTP acceptance followed by persistence failure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auditError = null
    mocks.repairError=null
    journal=transportJournalFixture({repairFailure:()=>mocks.repairError,original:{companyId:uid(2),actorUserId:uid(3),messageId:uid(1),rawPayload:raw,rulePackSnapshot:mocks.snapshot}});mocks.rpc.mockImplementation(journal.rpc)
    mocks.send.mockImplementation(async(input,entry)=>{await journal.beforeProvider(input,entry);return{ accepted: ['recipient@example.test'], rejected: [], messageId: '<smtp1@example.test>' };})
    mocks.status.mockResolvedValue(undefined)
    mocks.event.mockResolvedValue(undefined)
  })
  const send = () => sendEdielMessageViaSmtp({ id: uid(1),company_id:uid(2),environment:'test',direction:'outbound',status:'queued',message_standard:'edifact',raw_payload:raw, message_family: 'PRODAT', message_code: 'Z01', receiver_email: 'recipient@example.test', file_name: 'message.edi' } as EdielMessageRow, { actorUserId: uid(3) })
  it.each(['atomic projection', 'event'])('preserves acceptance evidence when the %s write throws', async (failure) => {
    if (failure === 'atomic projection') mocks.repairError=new Error('DB unavailable')
    else mocks.event.mockImplementation(async (event) => { if (event.eventType === 'sent') throw new Error('DB unavailable') })
    await expect(send()).rejects.toMatchObject({ code: 'ediel_delivery_uncertain', smtpMessageId: '<smtp1@example.test>' })
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(journal.actions).toContain('observe')
    mocks.repairError=null
    await expect(send()).resolves.toMatchObject({messageId:'<smtp1@example.test>'})
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })
  it('preserves successful SMTP results when persistence succeeds', async () => {
    await expect(send()).resolves.toMatchObject({ messageId: '<smtp1@example.test>' })
    expect(journal.actions).toEqual(['prepare','enter','observe','repair','register'])
  })
  it('treats a returned audit persistence error as reconciliation-required', async () => {
    mocks.auditError = new Error('Audit update rejected')
    await expect(send()).rejects.toMatchObject({ code: 'ediel_delivery_uncertain', smtpMessageId: '<smtp1@example.test>' })
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(journal.actions).toContain('observe')
  })
  it('does not relabel a pre-send failure as uncertain', async () => {
    mocks.event.mockRejectedValue(new Error('Pre-send event failed'))
    await expect(send()).rejects.not.toBeInstanceOf(SmtpDeliveryUncertainError)
    expect(mocks.send).not.toHaveBeenCalled()
  })
})
