// reality-defects: J4 the reality scenario's own counterparty files (scripts/helpers/reality/parseConformanceWire.ts) are valid interchanges and their written expectations hold
//
// Offline guard for scripts/reality/chain-j4-parse-conformance.test.ts: each J4 file must be a valid envelope, and the
// parse it states (written from the guide) must equal what the inbound mail parser extracts. A file with an open defect
// is expected to differ until its patch lands. Synthetic data only.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { classifyCanonicalInboundAck } from '@/lib/ediel/ack/inboundAckOutcome'
import { qualifyInboundAckSourceCandidates } from '@/lib/ediel/ack/sourceCorrelation'
import { validateEdifactEnvelope } from '@/lib/ediel/core/edifactValidation'
import { parseEdifactPayload } from '@/lib/inbound-mail/edielEmailParser'
import { splitMimeParts } from '@/lib/inbound-mail/edielMailboxPoller.part-1'
import MailComposer from 'nodemailer/lib/mail-composer'
import { contrlAction8, correlatedDetailedContrl, correlatedObjectRejection, e66TwoPoints, j4MailOptions, unlinkedHeaderAperak, z06TwoObjects,
  type J4File } from '../scripts/helpers/reality/parseConformanceWire'

const Z03 = readFileSync('scripts/reality/fixtures-z03-normal-switch.edi', 'utf8')
const P = { issuer: '16700', receiver: '7300000000001', reference: 'J4WIRE1', meters: ['735999000000000017', '735999000000000024'] as [string, string], gridArea: 'ALS' }

/** Recursive subset equality, arrays element-wise (same rule as the scenario's subsetMismatches). */
function subset(actual: unknown, expected: unknown): void {
  if (expected === null || typeof expected !== 'object') return void expect(actual).toEqual(expected)
  if (Array.isArray(expected)) { expect(Array.isArray(actual) && actual.length).toBe(expected.length); expected.forEach((v, i) => subset((actual as unknown[])[i], v)); return }
  for (const [key, value] of Object.entries(expected as Record<string, unknown>)) subset((actual as Record<string, unknown>)?.[key], value)
}
function mail(file: J4File) {
  return Buffer.from(`From: dso@example.invalid\r\nTo: platform@example.invalid\r\nSubject: J4\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="b1"\r\n\r\n--b1\r\nContent-Type: text/plain\r\n\r\nEdiel\r\n--b1\r\nContent-Type: ${file.contentType}\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="${file.key}.edi"\r\n\r\n${file.bytes.toString('base64')}\r\n--b1--\r\n`, 'latin1')
}

const FILES: J4File[] = [
  e66TwoPoints(P), z06TwoObjects({ ...P, una: 'custom' }), z06TwoObjects({ ...P, una: 'default', contentType: 'application/EDIFACT; charset=utf-8', key: 'P-Z06-default-mislabelled' }),
  unlinkedHeaderAperak({ ...P, acknowledgedDocument: 'DOC?NOT-SENT' }), contrlAction8({ ...P, acknowledgedInterchange: 'NEVERSENT0001' }),
  correlatedObjectRejection(Z03), correlatedDetailedContrl(Z03),
]

describe('J4 reality files: valid wire, guide expectations hold through the real MIME decoder and parser', () => {
  for (const file of FILES) {
    it(file.key, () => {
      expect(validateEdifactEnvelope(file.edifact)).toMatchObject({ ok: true })
      const received = splitMimeParts(mail(file)).rawEdifactPayload
      expect(received).toBe(file.edifact)
      const parsed = parseEdifactPayload(received!)
      subset({ ...parsed, canonicalAck: classifyCanonicalInboundAck(parsed) }, file.expectedParse)
    })
  }

  it('the custom-UNA Z06 mislabelled as utf-8 is J4-D13 (open): decoded with U+FFFD today', () => {
    const file = z06TwoObjects({ ...P, una: 'custom', contentType: 'application/EDIFACT; charset=utf-8', key: 'x' })
    expect(splitMimeParts(mail(file)).rawEdifactPayload).not.toBe(file.edifact)
  })

  it('the scenario\'s own SMTP framing (nodemailer, base64, labelled content type) delivers each payload unchanged to the MIME decoder', async () => {
    for (const file of FILES) {
      const raw: Buffer = await new Promise((resolve, reject) => new MailComposer(j4MailOptions({ from: 'dso@example.invalid', to: 'platform@example.invalid', file, run: 'T' }))
        .compile().build((error, message) => error ? reject(error) : resolve(message)))
      expect(splitMimeParts(raw).rawEdifactPayload, file.key).toBe(file.edifact)
    }
  })

  it('correlated answers qualify exactly our Z03', () => {
    const source = { id: 'z03', company_id: 'c', environment: 'test', direction: 'outbound', raw_payload: Z03, message_family: 'PRODAT', message_sent_at: '2026-10-20T12:00:00Z' }
    for (const [file, family] of [[correlatedObjectRejection(Z03), 'APERAK'], [correlatedDetailedContrl(Z03), 'CONTRL']] as const) {
      expect(qualifyInboundAckSourceCandidates({ ackMessage: { id: 'a', company_id: 'c', environment: 'test', direction: 'inbound', raw_payload: file.edifact, message_family: family },
        candidates: [source] })).toMatchObject({ status: 'unique', candidateIds: ['z03'] })
    }
  })
})
