import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseEdifactEnvelope } from '@/lib/ediel/transport/index.part-1'
import { parseInboundProdat } from '@/lib/ediel/prodat/compatAdapter'
import { buildAckDraftForSource } from '@/lib/ediel/ack'
import { createEdielMessage } from '@/lib/ediel/db'
import { preflightEdielPayload } from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import { resolveProdatPermissionAperakValidationIssues } from '@/lib/ediel/testing/prodatPermissionEngine'
import type { EdielMessageRow, CreateEdielMessageInput } from '@/lib/ediel/types'

const db = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: db }))
beforeEach(() => {
  db.from.mockReset()
  db.from.mockImplementation(() => { throw new Error('Unexpected database access in document read test') })
})

// Independently specified synthetic wires; these are NOT original TGT cases.
const escape = (value: string) => value.replace(/[?:+']/g, char => `?${char}`)
function payload(id: string, code = 'Z03', options: { rawId?: boolean; function?: string; ack?: string; body?: string[] } = {}): string {
  const parts = [
    'UNH+UNH-OTHER+PRODAT:D:97A:UN:E2SE6A',
    `BGM+${escape(code)}+${options.rawId ? id : escape(id)}+${options.function ?? '9'}+${options.ack ?? 'AB'}`,
    'DTM+137:202609171200:203',
    'NAD+FR+12345:160:SVK', 'NAD+DO+54321:160:SVK',
    'LIN+1++735999999999999999:::9', ...(options.body ?? []),
  ]
  return "UNA:+.? 'UNB+UNOC:3+12345:14+54321:14+260917:1200+INTERCHANGE++23-DDQ-PRODAT'"
    + [...parts, `UNT+${parts.length + 1}+UNH-OTHER`, 'UNZ+1+INTERCHANGE'].join("'") + "'"
}
function message(raw: string | null, code = 'Z03'): EdielMessageRow {
  return {
    id: 'source-id', company_id: 'tenant-A', direction: 'inbound', message_family: 'PRODAT',
    message_code: code, message_standard: 'edifact', environment: 'test', raw_payload: raw,
    parsed_payload: { documentReference: 'STALE-PARSED', messageReference: 'UNH-OTHER' },
    external_reference: 'STALE-ROW', transaction_reference: 'CASE', interchange_reference: 'INTERCHANGE',
    sender_ediel_id: '12345', receiver_ediel_id: '54321', application_reference: '23-DDQ-PRODAT',
    grid_owner_data_request_id: 'request-id',
  } as unknown as EdielMessageRow
}

describe('real ingress, ACK and preflight read the same source BGM', () => {
  for (const id of ['000aBc', 'DOC:1', 'DOC+1', "DOC'1", 'DOC?', 'D'.repeat(35)]) {
    it(`preserves ${JSON.stringify(id)} independently of UNH/stale snapshots`, () => {
      const raw = payload(id)
      const envelope = parseEdifactEnvelope(raw, 'PRODAT', 'Z04')
      expect(envelope.externalReference).toBe(id)
      expect(envelope.code).toBe('Z03')
      expect(envelope.parsedPayload).toMatchObject({ documentReference: id, bgmReference: id, bgm: `BGM+Z03+${escape(id)}+9+AB` })
      expect(parseInboundProdat(raw).externalReference).toBe(id)
      const source = message(raw)
      const before = JSON.stringify(source)
      const ack = buildAckDraftForSource({ sourceMessage: source, ackFamily: 'APERAK', outcome: 'positive' })
      expect(ack.rawPayload).toContain(`RFF+ACW:${escape(id)}'`)
      expect(ack.rawPayload).not.toContain('RFF+ACW:STALE')
      expect(JSON.stringify(source)).toBe(before)
      const preflight = preflightEdielPayload({ rawPayload: raw, messageStandard: 'edifact', mode: 'send' })
      expect(preflight.family).toBe('PRODAT'); expect(preflight.code).toBe('Z03')
      expect(preflight.issues.filter(issue => issue.code === 'UNT_COUNT_MISMATCH' || (issue.code === 'PROFILE_FIELD_LENGTH_EXCEEDED' && issue.segment?.startsWith('BGM+')))).toEqual([])
      expect(db.from).not.toHaveBeenCalled()
    })
  }
  for (const id of ['', 'DOC:OTHER']) {
    it(`cannot invent BGM identity from UNH/ON/ACE/row (${JSON.stringify(id)})`, () => {
      const raw = payload(id, 'Z03', { rawId: true, body: ['RFF+ON:OTHER', 'RFF+ACE:OTHER', 'BGM+Z03+LATER+9+AB'] })
      expect(parseEdifactEnvelope(raw, 'PRODAT', 'Z03').externalReference).toBeNull()
      expect(parseInboundProdat(raw).externalReference).toBeNull()
      expect(() => buildAckDraftForSource({ sourceMessage: message(raw), ackFamily: 'APERAK', outcome: 'negative' }))
        .toThrow('aperak_prodat_document_reference_required')
      expect(db.from).not.toHaveBeenCalled()
    })
  }
  for (const code of ['', 'Z03:DECOY']) {
    it(`cannot replace wire function ${JSON.stringify(code)} with row/fallback Z03`, async () => {
      const raw = payload('DOCUMENT', code)
      expect(parseEdifactEnvelope(raw, 'PRODAT', 'Z03').code).toBe(code)
      expect(parseInboundProdat(raw).messageCode).toBe(code || null)
      expect((await resolveProdatPermissionAperakValidationIssues({ message: message(raw, 'Z14') }))).toEqual([])
      expect(db.from).not.toHaveBeenCalled()
    })
  }
  it('reads semicolon-UNA document headers without interpreting them as AI lists', () => {
    const raw = 'UNA*;.! ~UNB;UNOC*3;12345*14;54321*14;260917*1200;INTERCHANGE;;23-DDQ-PRODAT~'
      + 'UNH;UNH-OTHER;PRODAT*D*97A*UN*E2SE6A~BGM;Z03;EDIEL!;DOC!*!!;9;AB~LIN;1;;OBJECT***9~UNT;4;UNH-OTHER~UNZ;1;INTERCHANGE~'
    const envelope = parseEdifactEnvelope(raw, 'OTHER', 'OTHER')
    expect(envelope.family).toBe('PRODAT'); expect(envelope.code).toBe('Z03')
    expect(envelope.externalReference).toBe('EDIEL;DOC*!')
    expect(envelope.messageVersion).toBe('PRODAT:D:97A:UN:E2SE6A')
    expect(parseInboundProdat(raw).externalReference).toBe('EDIEL;DOC*!')
  })
  for (const [id, tooLong] of [['A'.repeat(35), false], ['A'.repeat(36), true], ['A'.repeat(32) + '?X?X', true]] as const) {
    it(`preflight measures decoded BGM length ${id.length} exactly once`, () => {
      const result = preflightEdielPayload({ rawPayload: payload(id), messageStandard: 'edifact', mode: 'send' })
      expect(result.issues.some(issue => issue.code === 'PROFILE_FIELD_LENGTH_EXCEEDED' && issue.segment?.startsWith('BGM+'))).toBe(tooLong)
    })
  }
})

describe('document identity persistence is wire-backed and typed', () => {
  for (const variant of ['present', 'empty', 'composite', 'undecodable', 'legacy'] as const) {
    it(`${variant} BGM never becomes an unrelated DOC/UNH id`, async () => {
      const raw = variant === 'legacy' ? null : payload(variant === 'empty' ? '' : variant === 'composite' ? 'DOCUMENT:OTHER' : 'DOC+?:1', 'Z03', { rawId: variant === 'composite' }) + (variant === 'undecodable' ? '?' : '')
      const row = message(raw)
      const saved: Array<Record<string, unknown>> = []
      db.from.mockImplementation((table: string) => {
        if (table === 'ediel_business_references') return { upsert: vi.fn(async (rows: Array<Record<string, unknown>>) => { saved.push(...rows); return { error: null } }) }
        if (!['ediel_messages', 'ediel_message_events'].includes(table)) throw new Error(`Unexpected table ${table}`)
        const q = { insert: vi.fn(), select: vi.fn(), eq: vi.fn(), single: vi.fn(), maybeSingle: vi.fn() }
        q.insert.mockReturnValue(q); q.select.mockReturnValue(q); q.eq.mockReturnValue(q)
        q.single.mockResolvedValue({ data: table === 'ediel_messages' ? row : { id: 'event-id' }, error: null })
        q.maybeSingle.mockResolvedValue({ data: row, error: null })
        return q
      })
      const original = JSON.stringify(row)
      await createEdielMessage({ direction: 'inbound', messageFamily: 'PRODAT', messageCode: 'Z03', messageStandard: 'edifact', environment: 'test', rawPayload: raw } as CreateEdielMessageInput)
      const ref = (type: string) => saved.find(item => item.reference_type === type)?.reference_value
      expect(ref('BGM_REF')).toBe(variant === 'legacy' ? 'STALE-ROW' : variant === 'present' ? 'DOC+?:1' : undefined)
      expect(ref('DOC_REF')).toBe(variant === 'legacy' ? 'STALE-PARSED' : undefined)
      expect(saved.every(item => item.company_id === 'tenant-A' && item.source_message_id === 'source-id' && item.business_object_id === 'request-id')).toBe(true)
      expect(JSON.stringify(row)).toBe(original)
    })
  }
})
