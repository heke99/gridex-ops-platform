import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'

const io = vi.hoisted(() => ({ effects: [] as string[] }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from: () => { io.effects.push('db'); throw new Error('UNEXPECTED_DATABASE_BOUNDARY') },
  rpc: () => { io.effects.push('rpc'); throw new Error('UNEXPECTED_RPC_BOUNDARY') },
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
  beforeEach(() => { io.effects = [] })

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
  }

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
    expect(io.effects).toEqual([])
    expect(message.raw_payload).toBe(before)
  })

  it('the direct S/MIME adapter rejects before certificate work or temporary files', async () => {
    await expect(createSmimeEncryptedPayloadReference({ rawEdifact: "FTX+AAO+++€'", publicCertificatePem: '' }))
      .rejects.toThrow('edifact_character_not_iso8859_1')
    expect(io.effects).toEqual([])
  })

  it.each(['PRODAT', 'UTILTS'])('cannot bypass the byte boundary by marking physical %s as XML', async (family) => {
    const message = { id: '00000000-0000-4000-8000-000000000001', company_id: '00000000-0000-4000-8000-000000000002',
      direction: 'outbound', environment: 'test', message_standard: 'xml', mime_type: 'application/xml',
      message_family: family, message_code: family === 'PRODAT' ? 'Z01' : 'E66', receiver_email: headers.to,
      raw_payload: `UNB+UNOC:3+S+R+260930:1200+I'UNH+1+${family}:D:96A:UN:GUIDE'FTX+AAO+++€'UNT+3+1'UNZ+1+I'`,
      parsed_payload: {}, } as unknown as EdielMessageRow
    await expect(sendEdielMessageViaSmtp(message, { actorUserId: 'synthetic-operator' })).rejects.toThrow('EDIEL_WIRE_FORMAT_IDENTITY_MISMATCH')
    expect(io.effects).toEqual([])
  })
})
