// masterplan: ENV-01, AT-ENV-01
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'

const io = vi.hoisted(() => ({ effects: [] as string[], acceptedReads:vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from: () => { io.effects.push('db'); throw new Error('UNEXPECTED_DATABASE_BOUNDARY') },
  rpc: async (name:string,args:unknown) => {
    if(name!=='gridex_ediel_accepted_transport_projection_v1'){io.effects.push('rpc');throw new Error('UNEXPECTED_RPC_BOUNDARY')}
    expect(args).toEqual({p_company_id:'00000000-0000-4000-8000-000000000002',p_environment:'test',p_actor_user_id:'synthetic-operator',p_message_id:'00000000-0000-4000-8000-000000000001'})
    io.acceptedReads(name,args)
    return {data:null,error:null}
  },
} }))
vi.mock('@/lib/email/sendEdielEmail', () => ({ sendEdielEmail: () => {
  io.effects.push('provider'); throw new Error('UNEXPECTED_PROVIDER_BOUNDARY')
} }))
import {
  buildInnerEdifactMimeForSmime, buildMultipartValidationBase64Mime,
  buildSinglePartEdielBase64Mime, buildSinglePartEdielMime,
} from '@/lib/ediel/transport/index.part-1'
import { sendEdielMessageViaSmtp } from '@/lib/ediel/transport'
import { createSmimeEncryptedPayloadReference } from '@/lib/ediel/transport/smime'

const headers = {
  from: 'sender@example.invalid', to: 'receiver@example.invalid',
  subject: 'EDIEL', filename: 'source.edi', contentType: 'application/EDIFACT',
  encoding: 'latin1' as const,
}
const mimeBuilders = [
  (text: string) => buildInnerEdifactMimeForSmime({ ...headers, decodedPayload: text }),
  (text: string) => buildSinglePartEdielBase64Mime({ ...headers, decodedPayload: text }),
  (text: string) => buildMultipartValidationBase64Mime({ ...headers, decodedPayload: text }),
  (text: string) => buildSinglePartEdielMime({ ...headers, rawPayload: text }),
]

describe('ENV-01 lossless bytes at every SMTP packaging boundary', () => {
  beforeEach(() => { io.effects = [];io.acceptedReads.mockClear() })

  for (const [index, build] of mimeBuilders.entries()) {
    for (const character of ['€', '\uD800', '😀']) {
      it(`MIME mode ${index} rejects unrepresentable content before encoding`, () => {
        expect(() => build(`FTX+AAO+++PRIVATE${character}'`)).toThrow('edifact_character_not_iso8859_1')
      })
    }
    it(`MIME mode ${index} preserves Swedish ISO8859-1 bytes`, () => {
      const source = "FTX+AAO+++ÅÄÖåäöé'"
      const mime = build(source).toString('latin1')
      if (index === 3) expect(mime).toContain(source)
      else expect(mime).toContain(Buffer.from(source, 'latin1').toString('base64'))
    })
    it.each(['\0', '\t', '\u007f', '\u0080', '\u009f', '\r\n'])(`MIME mode ${index} rejects UNOC control data (%j)`, character => {
      expect(() => build(`FTX+AAO+++PRIVATE${character}ID'`)).toThrow('edifact_character_not_unoc')
    })
  }

  it('cannot label UTF8 bytes as EDIFACT through a MIME encoding override', () => {
    const options = { ...headers, encoding: 'utf8' as const, decodedPayload: "FTX+AAO+++Åsa'" }
    for (const build of [buildInnerEdifactMimeForSmime, buildSinglePartEdielBase64Mime, buildMultipartValidationBase64Mime]) {
      expect(() => build(options)).toThrow('edifact_mime_encoding_invalid')
    }
    expect(() => buildSinglePartEdielMime({ ...options, rawPayload: options.decodedPayload })).toThrow('edifact_mime_encoding_invalid')
  })

  it('retains UTF8 for XML content and separates MIME header CRLF from EDIFACT data', () => {
    const source = '<name>Åsa €</name>'
    const mime = buildSinglePartEdielBase64Mime({ ...headers, contentType: 'application/xml', encoding: 'utf8', decodedPayload: source })
    expect(mime.toString('ascii')).toContain(Buffer.from(source, 'utf8').toString('base64'))
    expect(buildSinglePartEdielMime({ ...headers, rawPayload: "FTX+AAO+++Åsa'" }).toString('latin1')).toContain("\r\n\r\nFTX+AAO+++Åsa'\r\n")
  })

  it('the actual send path rejects before route, archive, attempt or provider effects', async () => {
    const message = {
      id: '00000000-0000-4000-8000-000000000001', company_id: '00000000-0000-4000-8000-000000000002',
      direction: 'outbound', environment: 'test', message_standard: 'edifact',
      message_family: 'CONTRL', message_code: 'CONTRL',
      communication_route_id: '00000000-0000-4000-8000-000000000003',
      receiver_email: headers.to, raw_payload: "UNB+UNOC:3+S+R+260930:1200+I'FTX+AAO+++€'UNZ+1+I'",
      parsed_payload: {},
    } as unknown as EdielMessageRow
    const before = message.raw_payload
    await expect(sendEdielMessageViaSmtp(message, { actorUserId: 'synthetic-operator' }))
      .rejects.toThrow('edifact_character_not_iso8859_1')
    expect(io.acceptedReads).toHaveBeenCalledExactlyOnceWith('gridex_ediel_accepted_transport_projection_v1',{p_company_id:message.company_id,p_environment:'test',p_actor_user_id:'synthetic-operator',p_message_id:message.id})
    expect(io.effects).toEqual([])
    expect(message.raw_payload).toBe(before)
  })

  it('the direct S/MIME adapter rejects before certificate work or temporary files', async () => {
    await expect(createSmimeEncryptedPayloadReference({ rawEdifact: "FTX+AAO+++€'", publicCertificatePem: '' }))
      .rejects.toThrow('edifact_character_not_iso8859_1')
    expect(io.effects).toEqual([])
  })

  it.each(['\0', '\t', '\u0085', '\n'])('rejects control data on actual fresh SMTP and direct S/MIME paths (%j)', async character => {
    const raw = `UNB+UNOC:3+S+R+261004:1200+I'FTX+AAO+++PRIVATE${character}ID'UNZ+1+I'`
    const message = { id: '00000000-0000-4000-8000-000000000001', company_id: '00000000-0000-4000-8000-000000000002',
      direction: 'outbound', environment: 'test', message_standard: 'edifact', message_family: 'PRODAT', message_code: 'Z01',
      receiver_email: headers.to, raw_payload: raw, parsed_payload: {} } as unknown as EdielMessageRow
    const before = structuredClone(message)
    await expect(sendEdielMessageViaSmtp(message, { actorUserId: 'synthetic-operator' })).rejects.toThrow('edifact_character_not_unoc')
    await expect(createSmimeEncryptedPayloadReference({ rawEdifact: raw, publicCertificatePem: '' })).rejects.toThrow('edifact_character_not_unoc')
    expect(io.effects).toEqual([])
    expect(message).toEqual(before)
  })

  it.each(['PRODAT', 'UTILTS', 'APERAK'])('requires UNOC:3 before fresh %s effects', async family => {
    for (const syntax of ['UNOB:3', 'UNOC:2', 'UNOC:4']) {
      const message = { id: '00000000-0000-4000-8000-000000000001', company_id: '00000000-0000-4000-8000-000000000002',
        direction: 'outbound', environment: 'test', message_standard: 'edifact', message_family: family,
        message_code: family === 'PRODAT' ? 'Z01' : family === 'UTILTS' ? 'E66' : 'APERAK',
        receiver_email: headers.to, raw_payload: `UNB+${syntax}+S+R+261004:1200+I'UNH+1+${family}:D:96A:UN:GUIDE'UNT+2+1'UNZ+1+I'`,
        parsed_payload: {} } as unknown as EdielMessageRow
      const before = structuredClone(message)
      await expect(sendEdielMessageViaSmtp(message, { actorUserId: 'synthetic-operator' })).rejects.toThrow('edifact_unoc_syntax_3_required')
      expect(io.effects).toEqual([])
      expect(message).toEqual(before)
    }
  })

  it('preserves CONTRL UNOB:2 compatibility at the actual fresh send gate', async () => {
    const message = { id: '00000000-0000-4000-8000-000000000001', company_id: '00000000-0000-4000-8000-000000000002',
      direction: 'outbound', environment: 'test', message_standard: 'edifact', message_family: 'CONTRL', message_code: 'CONTRL',
      receiver_email: headers.to, raw_payload: "UNB+UNOB:2+S+R+261004:1200+I'UNH+1+CONTRL:2:2:UN:EDIEL2'UCI+ORIGINAL+R+S+1'UNT+3+1'UNZ+1+I'", parsed_payload: {} } as unknown as EdielMessageRow
    // A declared downstream DB port interrupts after the real encoding guard;
    // this compatibility control makes no send or delivery claim.
    await expect(sendEdielMessageViaSmtp(message, { actorUserId: 'synthetic-operator' }))
      .rejects.toThrow(/UNEXPECTED_(RPC|DATABASE)_BOUNDARY/)
    expect(io.acceptedReads).toHaveBeenCalledTimes(1)
    expect(io.effects).toHaveLength(1)
  })

  it.each(['PRODAT', 'UTILTS'])('cannot bypass the byte boundary by marking physical %s as XML', async (family) => {
    const message = { id: '00000000-0000-4000-8000-000000000001', company_id: '00000000-0000-4000-8000-000000000002',
      direction: 'outbound', environment: 'test', message_standard: 'xml', mime_type: 'application/xml',
      message_family: family, message_code: family === 'PRODAT' ? 'Z01' : 'E66', receiver_email: headers.to,
      raw_payload: `UNB+UNOC:3+S+R+260930:1200+I'UNH+1+${family}:D:96A:UN:GUIDE'FTX+AAO+++€'UNT+3+1'UNZ+1+I'`,
      parsed_payload: {}, } as unknown as EdielMessageRow
    const before=structuredClone(message)
    await expect(sendEdielMessageViaSmtp(message, { actorUserId: 'synthetic-operator' })).rejects.toThrow('EDIEL_WIRE_FORMAT_IDENTITY_MISMATCH')
    expect(io.acceptedReads).toHaveBeenCalledExactlyOnceWith('gridex_ediel_accepted_transport_projection_v1',{p_company_id:message.company_id,p_environment:'test',p_actor_user_id:'synthetic-operator',p_message_id:message.id})
    expect(io.effects).toEqual([])
    expect(message).toEqual(before)
  })
})
