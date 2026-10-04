import { beforeEach, expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { raw, line, alphabets, type Parts } from './fixtures/prodat-register'
import { head, own } from './fixtures/prodat-identity'
import { selectedAddressFact, selectedInvoiceeFact } from './fixtures/prodat-ud'
import { createProdatRegisterEvidence } from '@/lib/ediel/prodat/prodatRegisterEvidence'
import {preflightEdielMessageRow} from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import {assertProdatFreeTextSendBoundary} from '@/lib/ediel/prodat/prodatFreeText'
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'

const io = vi.hoisted(() => ({ effects: [] as string[], acceptedReads:vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from: () => { io.effects.push('db'); throw new Error('UNEXPECTED_DATABASE_BOUNDARY') },
  rpc: async (name:string,args:unknown) => {
    if(name==='gridex_ediel_negative_fixture_read_v1'){expect(args).toEqual({p_context:{companyId:'00000000-0000-4000-8000-000000000002',messageId:'00000000-0000-4000-8000-000000000001',actorUserId:'00000000-0000-4000-8000-000000000004'}});return {data:null,error:null}}
    if(['ediel_customer_masterdata_message_basis_v1','ediel_customer_life_event_message_basis_v1','ediel_brp_change_message_basis_v1','ediel_production_contract_message_basis_v1'].includes(name)){expect(args).toEqual({p_company_id:'00000000-0000-4000-8000-000000000002',p_message_id:'00000000-0000-4000-8000-000000000001',p_actor_user_id:'00000000-0000-4000-8000-000000000004'});return {data:null,error:null}}
    if(name==='ediel_require_brp_change_source_current_v1'){expect(args).toEqual({p_company_id:'00000000-0000-4000-8000-000000000002',p_message_id:'00000000-0000-4000-8000-000000000001'});return{data:null,error:null}}
    if(name==='resolve_canonical_ediel_rule_pack_with_witness_v1'){io.effects.push('rpc');return{data:[],error:null}}
    if(name!=='gridex_ediel_accepted_transport_projection_v1'){io.effects.push('rpc');throw new Error('UNEXPECTED_RPC_BOUNDARY')}
    expect(args).toEqual({p_company_id:'00000000-0000-4000-8000-000000000002',p_environment:'test',p_actor_user_id:'00000000-0000-4000-8000-000000000004',p_message_id:'00000000-0000-4000-8000-000000000001'})
    io.acceptedReads(name,args)
    return {data:null,error:null}
  },
} }))
vi.mock('@/lib/email/sendEdielEmail', () => ({ sendEdielEmail: () => {
  io.effects.push('provider'); throw new Error('UNEXPECTED_PROVIDER_BOUNDARY')
} }))
import { sendEdielMessageViaSmtp } from '@/lib/ediel/transport'

beforeEach(() => { io.effects = [];io.acceptedReads.mockClear() })
for (const code of ['Z01', 'Z13', 'Z14', 'Z15', 'Z18']) {
  for (const label of ['PRODAT', 'APERAK']) it(`actual SMTP blocks invalid FTX ${code}/${label} before route/context I/O`, async () => {
    const body: Parts[] = [...head(), line('1', '735123456789012345', undefined, '9'), ['FTX', 'ACB', '', '', ['X'.repeat(71)]]]
    const message = {
      id: '00000000-0000-4000-8000-000000000001', company_id: '00000000-0000-4000-8000-000000000002',
      direction: 'outbound', environment: 'test', message_standard: 'edifact', message_family: label, message_code: 'Z01',
      receiver_email: 'synthetic@example.invalid', communication_route_id: '00000000-0000-4000-8000-000000000003',
      raw_payload: raw(body, code), parsed_payload: { rulebookAllowInvalidSend: true, prodatEngine: { registerEvidence: { invalid: true } } },
    } as unknown as EdielMessageRow
    // Full UNSM rejects the physical 71-character text before national admission.
    // The separate pure national boundary must still diagnose this exact FTX.
    expect(()=>assertProdatFreeTextSendBoundary(message)).toThrow('PRODAT_FTX_')
    await expect(sendEdielMessageViaSmtp(message, { actorUserId: '00000000-0000-4000-8000-000000000004' })).rejects.toThrow('UNSM_ELEMENT_LENGTH_INVALID')
    expect(io.acceptedReads).toHaveBeenCalledExactlyOnceWith('gridex_ediel_accepted_transport_projection_v1',{p_company_id:message.company_id,p_environment:'test',p_actor_user_id:'00000000-0000-4000-8000-000000000004',p_message_id:message.id})
    expect(io.effects).toEqual([])
  })
}

for (const text of [false, true]) it(`valid optional FTX=${text} passes its text gate and holds without a qualified rule pack`, async () => {
  const object = own('1', '735123456789012345', 'OWN')
  const body: Parts[] = [...head(), ...object.slice(0, 2), ...(text ? [['FTX', 'ACB', '', '', ['VALID TEXT']] as Parts] : []), ...object.slice(2)]
  const payload = raw(body, 'Z01').replace('UNB+UNOC:3+S+R+', 'UNB+UNOC:3+12345:ZZ+54321:ZZ+')
  const wire = tokenizeEdifact(payload)
  const companyId = '00000000-0000-4000-8000-000000000002'
  const registerEvidence = createProdatRegisterEvidence({ code: 'Z01', rawSegments: wire.segments.map(s => s.raw), una: wire.una, facts: {
    market: 'electricity',
    endUserAddressObjects: [selectedAddressFact('735123456789012345', companyId, '9', '001', ['Street'])],
    invoiceeObjects: [selectedInvoiceeFact('735123456789012345', companyId, '9', '001', ['Street'], '', '12345', 'City')],
  } })
  const message = {
    id: '00000000-0000-4000-8000-000000000001', company_id: '00000000-0000-4000-8000-000000000002',
    direction: 'outbound', environment: 'test', message_standard: 'edifact', message_family: 'PRODAT', message_code: 'Z01',
    receiver_email: 'synthetic@example.invalid', communication_route_id: '00000000-0000-4000-8000-000000000003',
    raw_payload: payload, created_at: '2026-09-17T11:00:00Z', parsed_payload: { prodatEngine: { registerEvidence } },
  } as unknown as EdielMessageRow
  const before = message.raw_payload
  expect(preflightEdielMessageRow(message,'send').issues.filter(issue=>issue.code.startsWith('PRODAT_FTX_'))).toEqual([])
  await expect(sendEdielMessageViaSmtp(message, { actorUserId: '00000000-0000-4000-8000-000000000004' })).rejects.toThrow('CANONICAL_RULE_PACK_EVIDENCE_NOT_ACTIVE')
  expect(io.acceptedReads).toHaveBeenCalledExactlyOnceWith('gridex_ediel_accepted_transport_projection_v1',{p_company_id:message.company_id,p_environment:'test',p_actor_user_id:'00000000-0000-4000-8000-000000000004',p_message_id:message.id})
  expect(io.effects).toEqual(['rpc'])
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
    // Full UNSM rejects the physical 71-character text before national admission.
    // The separate pure national boundary must still diagnose this exact FTX.
    expect(()=>assertProdatFreeTextSendBoundary(message)).toThrow('PRODAT_FTX_')
    await expect(sendEdielMessageViaSmtp(message, { actorUserId: '00000000-0000-4000-8000-000000000004' })).rejects.toThrow('UNSM_ELEMENT_LENGTH_INVALID')
    expect(io.acceptedReads).toHaveBeenCalledExactlyOnceWith('gridex_ediel_accepted_transport_projection_v1',{p_company_id:message.company_id,p_environment:'test',p_actor_user_id:'00000000-0000-4000-8000-000000000004',p_message_id:message.id})
    expect(io.effects).toEqual([])
    expect(message.raw_payload).toBe(payload)
  })
}
